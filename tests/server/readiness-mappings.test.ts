import { beforeAll, describe, expect, it } from 'vitest';
import type { CoverageGroupDef, HoldReasonCode, PublishedLine, TreatmentCoverageMapping } from '../../src/engine/types';
import { computeReadiness } from '../../src/server/readiness';
import type { ClinicReadiness, ReadinessClinicInput, ReadinessContext } from '../../src/server/readiness';
import { makeExcludedMapping, unusableMappingVariants } from '../fixtures/engine/mappings.fixture';
import { makeLine } from '../fixtures/engine/lines.fixture';
import { testGroups } from '../fixtures/engine/profiles.fixture';
import {
  ALL_CELLS,
  B_FEE,
  T_A,
  T_B,
  T_C,
  TEST_CTX,
  allProfiles,
  allScope,
  bundleOf,
  cellName,
  clinicOf,
  coveredMapping,
  defaultBaseFeeLines,
  defaultLines,
  defaultMappings,
  engineHoldOf,
  estimateFor,
  profileOf,
  sameCell,
  seededRandom,
  shuffled,
  snapshotOf,
} from '../fixtures/server/readiness.fixture';

// AC-011j 표 M (치료별 매핑, design.md DD-23): 병원 × 게시된 줄 × 15칸.
// 줄 행의 기대값은 같은 입력으로 estimate() 가 그 줄에 내는 보류 코드다 (엔진이 판정한다).
// 표 M 은 묶음의 가용성을 보지 않으므로(표 S 의 몫) 이 파일의 세계는 모두 ACTIVE 묶음이다. 가용성 무관은 따로 시험한다.

const reportOf = (clinic: ReadinessClinicInput, ctx: ReadinessContext = TEST_CTX): ClinicReadiness => computeReadiness(snapshotOf([clinic]), ctx).clinics[0]!;

const mappingRow = (report: ClinicReadiness, treatmentId: string, cell: (typeof ALL_CELLS)[number]) => {
  const row = report.mappings.find((candidate) => candidate.treatmentId === treatmentId && sameCell(candidate.cell, cell));
  if (row === undefined) throw new Error(`표 M 행이 없다: ${treatmentId} ${cellName(cell)}`);
  return row;
};

/** 모든 칸·모든 줄의 행이 estimate() 와 같다. 프로필 칸이 해석되고 묶음이 ACTIVE 인 세계에서만 쓴다. */
function expectMappingsAgree(clinic: ReadinessClinicInput, ctx: ReadinessContext, label: string): ClinicReadiness {
  const report = reportOf(clinic, ctx);
  for (const cell of ALL_CELLS) {
    const est = estimateFor(clinic, cell, ctx)!;
    for (const line of [...clinic.lines, ...clinic.baseFeeLines]) {
      const where = `${label} · ${line.treatmentId} · ${cellName(cell)}`;
      const row = mappingRow(report, line.treatmentId, cell);
      const code = engineHoldOf(est, line.treatmentId);
      if (code === null) {
        const result = est.lines.find((candidate) => candidate.treatmentId === line.treatmentId)!;
        expect(row, where).toEqual({ treatmentId: line.treatmentId, isBaseFee: line.isBaseFee, cell, status: 'READY', confirmedExclusion: result.state === 'EXCLUDED_CONFIRMED' });
      } else {
        expect(row, where).toEqual({ treatmentId: line.treatmentId, isBaseFee: line.isBaseFee, cell, status: 'NOT_READY', code });
      }
    }
  }
  return report;
}

const withMappings = (replacement: TreatmentCoverageMapping[], targetId: string): TreatmentCoverageMapping[] => [
  ...defaultMappings().filter((mapping) => mapping.treatmentId !== targetId),
  ...replacement,
];

const inScope = (mapping: TreatmentCoverageMapping): TreatmentCoverageMapping => ({ ...mapping, scope: allScope() });

interface Variant {
  name: string;
  /** 대상 줄의 모든 칸에서 기대하는 상태. 코드가 있으면 (엔진이 정한 코드가 이것과도 같은지) 함께 확인한다. */
  code: HoldReasonCode | null;
  confirmedExclusion?: boolean;
  mappings?: (id: string) => TreatmentCoverageMapping[];
  line?: (line: PublishedLine) => PublishedLine;
  ctx?: ReadinessContext;
}

const unusable = unusableMappingVariants('PLACEHOLDER');

const VARIANTS: Variant[] = [
  { name: '매핑 없음', code: 'MAPPING_ABSENT', mappings: () => [] },
  ...Object.entries(unusable).map(([name, variant]): Variant => ({
    name: `사용 불가 COVERED 매핑 ${name}`,
    code: variant.code,
    mappings: (id) => [inScope(unusableMappingVariants(id)[name]!.make(`TEST_MAPPING_${id}_U`))],
  })),
  {
    name: '사용 불가 후보와 사용 가능한 후보 하나가 함께 있으면 사용 가능한 하나로 확정',
    code: null,
    mappings: (id) => [coveredMapping(id), inScope(unusableMappingVariants(id)['DRAFT']!.make(`TEST_MAPPING_${id}_U`))],
  },
  {
    name: '사용 가능한 COVERED 후보 둘',
    code: 'MAPPING_INVALID',
    mappings: (id) => [coveredMapping(id), coveredMapping(id, { id: `TEST_MAPPING_${id}_2` })],
  },
  {
    name: '사용 가능한 COVERED 와 EXCLUDED 가 섞인 후보 둘',
    code: 'MAPPING_INVALID',
    mappings: (id) => [coveredMapping(id), { ...makeExcludedMapping(id, { id: `TEST_MAPPING_${id}_2` }), scope: allScope() }],
  },
  { name: '필드 규칙을 어긴 저장 매핑: COVERED 에 groupKey 없음', code: 'MAPPING_INVALID', mappings: (id) => [coveredMapping(id, { groupKey: '' })] },
  {
    name: '필드 규칙을 어긴 저장 매핑: COVERED 에 exclusionReason',
    code: 'MAPPING_INVALID',
    mappings: (id) => [coveredMapping(id, { exclusionReason: 'TEST_FIXTURE_REASON' })],
  },
  {
    name: '필드 규칙을 어긴 저장 매핑: EXCLUDED 에 groupKey',
    code: 'MAPPING_INVALID',
    mappings: (id) => [{ ...makeExcludedMapping(id), scope: allScope(), groupKey: 'TEST_GROUP_BENEFIT' }],
  },
  {
    name: '필드 규칙을 어긴 저장 매핑: EXCLUDED 에 사유 없음',
    code: 'MAPPING_INVALID',
    mappings: (id) => [{ ...makeExcludedMapping(id), scope: allScope(), exclusionReason: '' }],
  },
  {
    name: '필드 규칙을 어긴 저장 매핑: decision 이 두 값 밖',
    code: 'MAPPING_INVALID',
    mappings: (id) => [coveredMapping(id, { decision: 'MAYBE' as unknown as 'COVERED' })],
  },
  { name: '사용 가능한 COVERED 의 groupKey 가 프로필에 없음', code: 'MAPPING_GROUP_NOT_IN_PROFILE', mappings: (id) => [coveredMapping(id, { groupKey: 'TEST_GROUP_NOT_IN_PROFILE' })] },
  { name: '사용 가능한 EXCLUDED 매핑', code: null, confirmedExclusion: true, mappings: (id) => [{ ...makeExcludedMapping(id), scope: allScope() }] },
  ...(['DRAFT', 'REJECTED', 'UNDER_REREVIEW', 'SUSPENDED', 'EXPIRED', 'SUPERSEDED'] as const).map((state): Variant => ({
    name: `사용 불가 상태(${state})의 EXCLUDED 매핑은 제외 확인이 아니라 그 상태의 코드`,
    code: state === 'DRAFT' ? 'MAPPING_UNREVIEWED' : state === 'REJECTED' ? 'MAPPING_REJECTED' : state === 'UNDER_REREVIEW' ? 'MAPPING_UNDER_REREVIEW' : 'MAPPING_INVALID',
    mappings: (id) => [{ ...makeExcludedMapping(id, { state }), scope: allScope() }],
  })),
  { name: '줄 출처가 허용 밖', code: 'LINE_ORIGIN_NOT_ACCEPTED', line: (line) => ({ ...line, origin: 'DEMO' }), ctx: { ...TEST_CTX, acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE'] } } },
  { name: 'calcClass 가 NEEDS_REVIEW', code: 'CLASSIFICATION_NEEDS_REVIEW', line: (line) => ({ ...line, calcClass: 'NEEDS_REVIEW' }) },
  { name: '급여 구분을 알 수 없음', code: 'CLASSIFICATION_NEEDS_REVIEW', line: (line) => ({ ...line, benefitType: 'UNKNOWN' as unknown as 'BENEFIT' }) },
  { name: '줄 출처가 허용 밖이면 매핑이 없어도 줄 단계 코드가 먼저다', code: 'LINE_ORIGIN_NOT_ACCEPTED', mappings: () => [], line: (line) => ({ ...line, origin: 'DEMO' }), ctx: { ...TEST_CTX, acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE'] } } },
];

/** 대상 줄(치료 T-A, 공통 기본비용 B-FEE) 하나에만 변형을 적용한 병원. 다른 줄은 사용 가능한 COVERED 매핑이다. */
function clinicWith(variant: Variant, targetId: string): ReadinessClinicInput {
  const lines = defaultLines();
  const baseFeeLines = defaultBaseFeeLines();
  const mutate = variant.line ?? ((line: PublishedLine) => line);
  return clinicOf(bundleOf({ mappings: variant.mappings === undefined ? defaultMappings() : withMappings(variant.mappings(targetId), targetId) }), {
    lines: lines.map((line) => (line.treatmentId === targetId ? mutate(line) : line)),
    baseFeeLines: baseFeeLines.map((line) => (line.treatmentId === targetId ? mutate(line) : line)),
  });
}

describe('AC-011j (1) 줄 한 개의 상태를 바꾸면 그 줄 행의 사유가 estimate() 가 그 줄에 내는 코드와 같다', () => {
  it.each(VARIANTS.flatMap((variant) => [T_A, B_FEE].map((target) => [variant.name, target, variant] as const)))('%s · 대상 %s', (_name, target, variant) => {
    const ctx = variant.ctx ?? TEST_CTX;
    const clinic = clinicWith(variant, target);
    const report = expectMappingsAgree(clinic, ctx, variant.name);
    for (const cell of ALL_CELLS) {
      const row = mappingRow(report, target, cell);
      if (variant.code === null) {
        expect(row, cellName(cell)).toMatchObject({ status: 'READY', confirmedExclusion: variant.confirmedExclusion === true });
      } else {
        expect(row, cellName(cell)).toEqual({ treatmentId: target, isBaseFee: target === B_FEE, cell, status: 'NOT_READY', code: variant.code });
      }
      // 줄 하나의 상태가 다른 줄의 행을 바꾸지 않는다.
      for (const other of [T_A, T_B, T_C, B_FEE].filter((id) => id !== target)) {
        expect(mappingRow(report, other, cell), `${other} ${cellName(cell)}`).toMatchObject({ status: 'READY', confirmedExclusion: false });
      }
    }
  });
});

describe('AC-011j (1) scope 에 그 칸이 없는 매핑만 있으면 그 칸만 MAPPING_ABSENT', () => {
  it.each(ALL_CELLS.map((cell) => [cellName(cell), cell] as const))('빠진 칸 %s', (_name, missing) => {
    const clinic = clinicOf(
      bundleOf({ mappings: withMappings([coveredMapping(T_A, { scope: allScope().filter((entry) => !sameCell(entry, missing)) })], T_A) }),
    );
    const report = expectMappingsAgree(clinic, TEST_CTX, `scope 에서 ${cellName(missing)} 제외`);
    for (const cell of ALL_CELLS) {
      const row = mappingRow(report, T_A, cell);
      expect(row.status, cellName(cell)).toBe(sameCell(cell, missing) ? 'NOT_READY' : 'READY');
      if (sameCell(cell, missing)) expect(row).toMatchObject({ code: 'MAPPING_ABSENT' });
    }
  });
});

// ───────────────────────── 그룹 값 결함 ─────────────────────────

const group = (index: 0 | 1): CoverageGroupDef => testGroups()[index]!;

describe('AC-011j (1) 매핑이 가리키는 그룹의 값 결함', () => {
  const DEFECTS: Array<[string, CoverageGroupDef, HoldReasonCode]> = [
    ['공제 고정액 없음', { ...group(0), deduction: { kind: 'FIXED' } as unknown as CoverageGroupDef['deduction'] }, 'PROFILE_VALUE_MISSING'],
    ['공제 고정액 음수', { ...group(0), deduction: { kind: 'FIXED', fixed: -1 } }, 'PROFILE_VALUE_INVALID'],
    ['지원하지 않는 공제 종류', { ...group(0), deduction: { kind: 'MYSTERY' } as unknown as CoverageGroupDef['deduction'] }, 'PROFILE_FORMULA_UNSUPPORTED'],
    ['한도 없음 선언에 조항 참조가 없음', { ...group(0), limit: { kind: 'UNLIMITED_DECLARED', policyClauseRef: '' } }, 'PROFILE_SOURCE_INCOMPLETE'],
  ];

  it.each(DEFECTS)('%s: 그 칸에서 그 그룹으로 가는 줄만 %s', (_name, bad, code) => {
    for (const target of ALL_CELLS) {
      const clinic = clinicOf(
        bundleOf({
          profiles: allProfiles(target, (_p, cell) => profileOf(cell, { groups: [bad, group(1)] })),
          mappings: [coveredMapping(T_A), coveredMapping(T_B, { groupKey: 'TEST_GROUP_NON_BENEFIT' }), coveredMapping(T_C), coveredMapping(B_FEE)],
        }),
      );
      const report = expectMappingsAgree(clinic, TEST_CTX, `${_name} @ ${cellName(target)}`);
      for (const cell of ALL_CELLS) {
        for (const id of [T_A, T_C, B_FEE]) {
          const row = mappingRow(report, id, cell);
          if (sameCell(cell, target)) expect(row, `${id} ${cellName(cell)}`).toMatchObject({ status: 'NOT_READY', code });
          else expect(row.status, `${id} ${cellName(cell)}`).toBe('READY');
        }
        expect(mappingRow(report, T_B, cell).status, cellName(cell)).toBe('READY');
      }
    }
  });

  it('공유 한도 풀의 값 결함은 그 풀 멤버 그룹의 줄만 막는다', () => {
    const poolMember = (groupKey: string): CoverageGroupDef => ({
      groupKey,
      deduction: { kind: 'FIXED', fixed: 1_000 },
      limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' },
      sharedLimitPoolKey: 'TEST_POOL',
    });
    const alone: CoverageGroupDef = { groupKey: 'TEST_GROUP_ALONE', deduction: { kind: 'FIXED', fixed: 1_000 }, limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' } };
    const badPool = { poolKey: 'TEST_POOL', limit: { kind: 'PER_VISIT_PAYOUT', limitBasis: 'PAYOUT' } as unknown as CoverageGroupDef['limit'] };
    const target = ALL_CELLS[7]!;
    const clinic = clinicOf(
      bundleOf({
        profiles: allProfiles(target, (_p, cell) => profileOf(cell, { groups: [poolMember('TEST_GROUP_P1'), poolMember('TEST_GROUP_P2'), alone], sharedLimitPools: [badPool] })),
        mappings: [
          coveredMapping(T_A, { groupKey: 'TEST_GROUP_P1' }),
          coveredMapping(T_B, { groupKey: 'TEST_GROUP_P2' }),
          coveredMapping(T_C, { groupKey: 'TEST_GROUP_ALONE' }),
          coveredMapping(B_FEE, { groupKey: 'TEST_GROUP_ALONE' }),
        ],
      }),
    );
    const report = expectMappingsAgree(clinic, TEST_CTX, '풀 값 결함');
    expect(mappingRow(report, T_A, target)).toMatchObject({ status: 'NOT_READY', code: 'PROFILE_VALUE_MISSING' });
    expect(mappingRow(report, T_B, target)).toMatchObject({ status: 'NOT_READY', code: 'PROFILE_VALUE_MISSING' });
    expect(mappingRow(report, T_C, target).status).toBe('READY');
    expect(mappingRow(report, B_FEE, target).status).toBe('READY');
  });
});

// ───────────────────────── 프로필 칸이 해석되지 않을 때 ─────────────────────────

describe('AC-011j (3) 사용 가능한 COVERED 매핑이어도 그 칸의 프로필이 해석되지 않으면 사유는 표 P(병원 보기)의 같은 칸 사유', () => {
  const BROKEN: Array<[string, Parameters<typeof allProfiles>[1]]> = [
    ['프로필 없음', () => []],
    ['프로필 DRAFT', (p) => ({ ...p, state: 'DRAFT' })],
    ['프로필 UNDER_REREVIEW', (p) => ({ ...p, state: 'UNDER_REREVIEW' })],
    ['해시 불일치', (p) => ({ ...p, contentHash: 'TEST_DIGEST_00000000' })],
    ['같은 칸에 프로필 둘', (p) => [p, { ...p, id: `${p.id}_2` }]],
  ];

  it.each(BROKEN)('%s', (_name, change) => {
    const mappings = [coveredMapping(T_A), coveredMapping(T_B), { ...makeExcludedMapping(T_C), scope: allScope() }, coveredMapping(B_FEE)];
    for (const target of ALL_CELLS) {
      const clinic = clinicOf(bundleOf({ profiles: allProfiles(target, change), mappings }));
      const report = reportOf(clinic);
      const profileRow = report.profiles.find((row) => sameCell(row.cell, target))!;
      expect(profileRow.status).toBe('NOT_READY');
      if (profileRow.status === 'READY') continue;
      const est = estimateFor(clinic, target, TEST_CTX)!;
      for (const id of [T_A, T_B, B_FEE]) {
        // 엔진은 프로필 단계에서 모든 줄을 막고, 표 M 은 사용 가능한 COVERED 줄의 사유로 같은 코드를 쓴다.
        expect(mappingRow(report, id, target), `${id} ${cellName(target)}`).toMatchObject({ status: 'NOT_READY', code: profileRow.code });
        expect(engineHoldOf(est, id)).toBe(profileRow.code);
      }
      // 확인된 제외(EXCLUDED)는 그룹을 보지 않으므로 표 M 에서는 READY (EXCLUDED_CONFIRMED) 다. 칸의 준비 여부는 표 P 단계가 먼저 막는다.
      expect(mappingRow(report, T_C, target)).toMatchObject({ status: 'READY', confirmedExclusion: true });
      expect(report.calculationReady.find((row) => sameCell(row.cell, target))).toMatchObject({ status: 'NOT_READY', stage: 'P', code: profileRow.code });
      // 다른 칸은 영향이 없다.
      for (const cell of ALL_CELLS.filter((candidate) => !sameCell(candidate, target))) {
        expect(mappingRow(report, T_A, cell).status).toBe('READY');
      }
    }
  });
});

// ───────────────────────── 독립성·순서·범위 없음·가용성 ─────────────────────────

describe('AC-011j (4) 결과가 배열 순서에 달라지지 않는다', () => {
  const SEED = 20261016;
  beforeAll(() => {
    console.info(`AC-011j 배열 순서 시험: seed=${SEED}`);
  });

  /** 줄마다 다른 상태를 가진 병원: 사용 가능, 매핑 없음, 미검토, 후보 둘, 제외, 그룹 없음. */
  function mixedClinic(): ReadinessClinicInput {
    const lines = [...defaultLines(), makeLine('T-D', 1_000), makeLine('T-E', 2_000), makeLine('T-F', 3_000)];
    const mappings = [
      coveredMapping(T_A),
      inScope(unusableMappingVariants(T_B)['DRAFT']!.make('TEST_MAPPING_T-B_U')),
      coveredMapping('T-D'),
      coveredMapping('T-D', { id: 'TEST_MAPPING_T-D_2' }),
      { ...makeExcludedMapping('T-E'), scope: allScope() },
      coveredMapping('T-F', { groupKey: 'TEST_GROUP_NOT_IN_PROFILE' }),
      coveredMapping(B_FEE),
    ];
    return clinicOf(bundleOf({ mappings }), { lines });
  }

  it(`bundle.mappings·프로필·줄·기본비용 줄·묶음·병원 순서를 seed=${SEED} 로 20번 섞어도 병원 보고 전체가 같다`, () => {
    const random = seededRandom(SEED);
    const base = mixedClinic();
    const baseline = computeReadiness(snapshotOf([base]), TEST_CTX);
    // 시험이 의미 있으려면 섞을 대상이 서로 다른 상태를 가져야 한다.
    const rows = baseline.clinics[0]!.mappings;
    expect(new Set(rows.map((row) => (row.status === 'READY' ? `READY:${row.confirmedExclusion}` : row.code))).size).toBeGreaterThanOrEqual(5);
    for (let round = 0; round < 20; round += 1) {
      const bundle = { ...base.bundle!, mappings: shuffled(base.bundle!.mappings, random), profiles: shuffled(base.bundle!.profiles, random) };
      const clinic: ReadinessClinicInput = { ...base, bundle, lines: shuffled(base.lines, random), baseFeeLines: shuffled(base.baseFeeLines, random) };
      expect(computeReadiness(snapshotOf(shuffled([clinic, clinicOf(null, { clinicId: 'TEST_CLINIC_0', slug: 'zero' })], random), shuffled([bundle], random)), TEST_CTX).clinics.find((entry) => entry.clinicId === 'TEST_CLINIC_1')).toEqual(baseline.clinics[0]);
    }
  });

  it('행은 줄 id 의 코드 포인트 순, 같은 줄 안에서는 칸 순서다', () => {
    const rows = reportOf(mixedClinic()).mappings;
    const lineIds = [...new Set(rows.map((row) => row.treatmentId))];
    expect(lineIds).toEqual([...lineIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(rows).toHaveLength(lineIds.length * 15);
    expect(rows.slice(0, 15).map((row) => row.cell)).toEqual(ALL_CELLS);
    expect(rows.filter((row) => row.isBaseFee).every((row) => row.treatmentId === B_FEE)).toBe(true);
  });
});

describe('AC-011j (5) 규칙 사용 범위가 없는 병원', () => {
  it('줄 출처와 분류가 통과하는 모든 줄이 MAPPING_ABSENT 이고 통과하지 못한 줄은 줄 단계 코드다', () => {
    const lines = [defaultLines()[0]!, { ...defaultLines()[1]!, origin: 'DEMO' as const }, { ...defaultLines()[2]!, calcClass: 'NEEDS_REVIEW' as const }];
    const ctx: ReadinessContext = { ...TEST_CTX, acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE'] } };
    const report = reportOf(clinicOf(null, { lines }), ctx);
    for (const cell of ALL_CELLS) {
      expect(mappingRow(report, T_A, cell)).toMatchObject({ status: 'NOT_READY', code: 'MAPPING_ABSENT' });
      expect(mappingRow(report, T_B, cell)).toMatchObject({ status: 'NOT_READY', code: 'LINE_ORIGIN_NOT_ACCEPTED' });
      expect(mappingRow(report, T_C, cell)).toMatchObject({ status: 'NOT_READY', code: 'CLASSIFICATION_NEEDS_REVIEW' });
      expect(mappingRow(report, B_FEE, cell)).toMatchObject({ status: 'NOT_READY', code: 'MAPPING_ABSENT' });
    }
  });

  it('범위가 없는 병원의 모든 줄이 15칸 모두 MAPPING_ABSENT 이다 (기본 줄 구성)', () => {
    const report = reportOf(clinicOf(null));
    expect(report.mappings).toHaveLength(4 * 15);
    expect(report.mappings.every((row) => row.status === 'NOT_READY' && row.code === 'MAPPING_ABSENT')).toBe(true);
  });
});

describe('표 M 은 묶음의 가용성을 보지 않는다 (표 S 의 몫)', () => {
  it('같은 묶음이 ACTIVE 여도 SUSPENDED 여도 표 M 은 같다', () => {
    const mappings = [...defaultMappings().filter((mapping) => mapping.treatmentId !== T_B), { ...makeExcludedMapping(T_B), scope: allScope() }];
    const active = reportOf(clinicOf(bundleOf({ mappings, status: 'ACTIVE' })));
    const suspended = reportOf(clinicOf(bundleOf({ mappings, status: 'SUSPENDED' })));
    expect(suspended.mappings).toEqual(active.mappings);
    expect(active.mappings.some((row) => row.status === 'READY' && row.confirmedExclusion)).toBe(true);
  });

  it('프로필이 해석되지 않는 칸의 표 M 사유도 가용성에 달라지지 않는다 (묶음이 중지여도 RULE_BUNDLE_SUSPENDED 로 덮지 않는다)', () => {
    const profiles = allProfiles(ALL_CELLS[0]!, (p) => ({ ...p, state: 'DRAFT' }));
    const active = reportOf(clinicOf(bundleOf({ profiles, status: 'ACTIVE' })));
    const suspended = reportOf(clinicOf(bundleOf({ profiles, status: 'SUSPENDED' })));
    expect(suspended.mappings).toEqual(active.mappings);
    expect(mappingRow(suspended, T_A, ALL_CELLS[0]!)).toMatchObject({ status: 'NOT_READY', code: 'PROFILE_DRAFT' });
  });
});
