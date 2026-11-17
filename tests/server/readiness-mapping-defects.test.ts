import { describe, expect, it } from 'vitest';
import type { CoverageGroupDef, HoldReasonCode, TreatmentCoverageMapping } from '../../src/engine/types';
import { computeReadiness } from '../../src/server/readiness';
import type { ClinicReadiness, ReadinessClinicInput, ReadinessContext } from '../../src/server/readiness';
import { makeExcludedMapping, unusableMappingVariants } from '../fixtures/engine/mappings.fixture';
import { testGroups } from '../fixtures/engine/profiles.fixture';
import {
  ALL_CELLS,
  B_FEE,
  OPERATING_ONLY_CTX,
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
  defaultMappings,
  engineHoldOf,
  estimateFor,
  operatingBundleOf,
  operatingClinicOf,
  profileOf,
  sameCell,
  snapshotOf,
} from '../fixtures/server/readiness.fixture';

// AC-011j 보강 (M3.E 보강 세션): 기존 readiness-mappings.test.ts 가 다루지 않은 줄.
//   (a) 사용 불가 상태의 EXCLUDED 매핑 전부 (기존: 6가지 상태만) 가 `READY (EXCLUDED_CONFIRMED)` 가 되지 않는다
//   (b) 매핑의 출처 TEST_FIXTURE 를 운영 허용 출처에서 어긋나게 한 경우 (COVERED 와 EXCLUDED)
//   (c) 사용 불가 후보가 여럿일 때의 코드 우선순위: 사용 불가 종류 13가지의 모든 순서쌍이 estimate() 와 같다 (배열 순서에 달라지지 않는다)
//   (d) 공유 한도 풀의 값 결함 종류별: 그 풀의 멤버 그룹으로 가는 줄만 막힌다
//   (e) scope 가 비었거나 다른 칸만 있는 매핑, 공통 기본비용 줄의 scope 결함
// 기대값은 같은 입력으로 estimate() 가 그 줄에 내는 보류 코드다 (엔진이 판정한다).

const reportOf = (clinic: ReadinessClinicInput, ctx: ReadinessContext = TEST_CTX): ClinicReadiness => computeReadiness(snapshotOf([clinic]), ctx).clinics[0]!;

const mappingRow = (report: ClinicReadiness, treatmentId: string, cell: (typeof ALL_CELLS)[number]) => {
  const row = report.mappings.find((candidate) => candidate.treatmentId === treatmentId && sameCell(candidate.cell, cell));
  if (row === undefined) throw new Error(`표 M 행이 없다: ${treatmentId} ${cellName(cell)}`);
  return row;
};

/** 그 줄의 모든 칸에서 표 M 행이 estimate() 가 그 줄에 낸 결과와 같다. 프로필 칸이 해석되는 세계에서만 쓴다. 엔진이 낸 코드(없으면 null)를 돌려준다. */
function expectLineAgrees(clinic: ReadinessClinicInput, ctx: ReadinessContext, treatmentId: string, label: string): Array<string | null> {
  const report = reportOf(clinic, ctx);
  const line = [...clinic.lines, ...clinic.baseFeeLines].find((candidate) => candidate.treatmentId === treatmentId)!;
  const codes: Array<string | null> = [];
  for (const cell of ALL_CELLS) {
    const est = estimateFor(clinic, cell, ctx)!;
    const code = engineHoldOf(est, treatmentId);
    const row = mappingRow(report, treatmentId, cell);
    const where = `${label} · ${treatmentId} · ${cellName(cell)}`;
    if (code === null) {
      const result = est.lines.find((candidate) => candidate.treatmentId === treatmentId)!;
      expect(row, where).toEqual({ treatmentId, isBaseFee: line.isBaseFee, cell, status: 'READY', confirmedExclusion: result.state === 'EXCLUDED_CONFIRMED' });
    } else {
      expect(row, where).toEqual({ treatmentId, isBaseFee: line.isBaseFee, cell, status: 'NOT_READY', code });
    }
    codes.push(code);
  }
  return codes;
}

const inScope = (mapping: TreatmentCoverageMapping): TreatmentCoverageMapping => ({ ...mapping, scope: allScope() });
const withMappings = (replacement: TreatmentCoverageMapping[], targetId: string): TreatmentCoverageMapping[] => [
  ...defaultMappings().filter((mapping) => mapping.treatmentId !== targetId),
  ...replacement,
];

const UNUSABLE_NAMES = Object.keys(unusableMappingVariants('PLACEHOLDER'));
const unusableOf = (name: string, treatmentId: string, id: string): TreatmentCoverageMapping => inScope(unusableMappingVariants(treatmentId)[name]!.make(id));

describe('AC-011j (2) 사용 불가 상태의 EXCLUDED 매핑은 어떤 사용 불가 종류여도 제외 확인이 아니라 그 상태의 코드다', () => {
  it('사용 불가 종류 13가지 (기존 시험이 다룬 6가지 상태 + REVIEW_REQUESTED, APPROVED 미게시, 지문 불일치, 유효 기간 밖, 약관 출처 누락, 승인자 누락, 허용 밖 출처)', () => {
    expect(UNUSABLE_NAMES).toHaveLength(13);
  });

  it.each(UNUSABLE_NAMES.flatMap((name) => [T_A, B_FEE].map((target) => [name, target] as const)))('EXCLUDED 인 %s · 대상 %s', (name, target) => {
    const excluded = (() => {
      const unusable = unusableMappingVariants(target)[name]!.make(`TEST_MAPPING_${target}_U`);
      // 같은 사용 불가 결함을 EXCLUDED 매핑에 입힌다 (groupKey 없음, 사유 있음).
      const { groupKey: _omitted, ...rest } = unusable;
      return { ...rest, decision: 'EXCLUDED' as const, exclusionReason: 'TEST_FIXTURE_EXCLUSION_REASON', scope: allScope() };
    })();
    const clinic = clinicOf(bundleOf({ mappings: withMappings([excluded], target) }), {});
    const codes = expectLineAgrees(clinic, TEST_CTX, target, `EXCLUDED ${name}`);
    // 엔진이 낸 코드는 15칸 모두 같고 보류 코드다 (확인된 제외가 아니다).
    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).not.toBeNull();
    const report = reportOf(clinic);
    for (const cell of ALL_CELLS) {
      const row = mappingRow(report, target, cell);
      expect(row.status, cellName(cell)).toBe('NOT_READY');
      // 줄 하나의 상태가 다른 줄의 행을 바꾸지 않는다.
      for (const other of [T_A, T_B, T_C, B_FEE].filter((id) => id !== target)) {
        expect(mappingRow(report, other, cell), `${other} ${cellName(cell)}`).toMatchObject({ status: 'READY', confirmedExclusion: false });
      }
    }
  });
});

describe('AC-011j (1) 매핑의 출처가 운영 허용 출처(OPERATING 만)에서 TEST_FIXTURE 이면 MAPPING_INVALID 다', () => {
  const asFixture = (mapping: TreatmentCoverageMapping): TreatmentCoverageMapping => ({ ...mapping, origin: 'TEST_FIXTURE' });
  const operatingMapping = (id: string): TreatmentCoverageMapping => ({ ...coveredMapping(id), origin: 'OPERATING' });

  it.each([T_A, B_FEE])('COVERED · 대상 %s: 그 줄만 MAPPING_INVALID, 나머지 줄은 READY (estimate() 와 같다)', (target) => {
    const others = defaultMappings().filter((mapping) => mapping.treatmentId !== target).map((mapping) => ({ ...mapping, origin: 'OPERATING' as const }));
    const clinic = operatingClinicOf(operatingBundleOf({ mappings: [...others, asFixture(operatingMapping(target))] }));
    const codes = expectLineAgrees(clinic, OPERATING_ONLY_CTX, target, 'COVERED TEST_FIXTURE 출처');
    expect(codes.every((code) => code === 'MAPPING_INVALID')).toBe(true);
    const report = reportOf(clinic, OPERATING_ONLY_CTX);
    for (const other of [T_A, T_B, T_C, B_FEE].filter((id) => id !== target)) {
      for (const cell of ALL_CELLS) expect(mappingRow(report, other, cell), `${other} ${cellName(cell)}`).toMatchObject({ status: 'READY', confirmedExclusion: false });
    }
  });

  it.each([T_A, B_FEE])('EXCLUDED · 대상 %s: 제외 확인이 아니라 MAPPING_INVALID', (target) => {
    const others = defaultMappings().filter((mapping) => mapping.treatmentId !== target).map((mapping) => ({ ...mapping, origin: 'OPERATING' as const }));
    const excluded: TreatmentCoverageMapping = { ...makeExcludedMapping(target), scope: allScope(), origin: 'TEST_FIXTURE' };
    const clinic = operatingClinicOf(operatingBundleOf({ mappings: [...others, excluded] }));
    const codes = expectLineAgrees(clinic, OPERATING_ONLY_CTX, target, 'EXCLUDED TEST_FIXTURE 출처');
    expect(codes.every((code) => code === 'MAPPING_INVALID')).toBe(true);
  });

  it('같은 자료를 OPERATING 출처로 두면 사용 가능한 EXCLUDED 는 READY (EXCLUDED_CONFIRMED) 다 (거절 이유가 출처뿐이라는 증거)', () => {
    const others = defaultMappings().filter((mapping) => mapping.treatmentId !== T_A).map((mapping) => ({ ...mapping, origin: 'OPERATING' as const }));
    const excluded: TreatmentCoverageMapping = { ...makeExcludedMapping(T_A), scope: allScope(), origin: 'OPERATING' };
    const clinic = operatingClinicOf(operatingBundleOf({ mappings: [...others, excluded] }));
    const codes = expectLineAgrees(clinic, OPERATING_ONLY_CTX, T_A, 'EXCLUDED OPERATING');
    expect(codes.every((code) => code === null)).toBe(true);
    expect(mappingRow(reportOf(clinic, OPERATING_ONLY_CTX), T_A, ALL_CELLS[0]!)).toMatchObject({ status: 'READY', confirmedExclusion: true });
  });
});

describe('AC-011j (1) 사용 불가 후보가 둘일 때 코드는 estimate() 와 같고 후보 배열 순서에 달라지지 않는다', () => {
  const pairs = UNUSABLE_NAMES.flatMap((first) => UNUSABLE_NAMES.map((second) => [first, second] as const));

  it('모든 순서쌍 13 × 13 = 169 개 (빈 시험 방지)', () => {
    expect(pairs).toHaveLength(169);
  });

  it('순서쌍 169 개 각각: 두 후보 중 어느 쪽이 앞에 와도 표 M 의 15칸 행이 estimate() 와 같다', () => {
    const codesByPair = new Map<string, string | null>();
    for (const [first, second] of pairs) {
      const clinic = clinicOf(bundleOf({ mappings: withMappings([unusableOf(first, T_A, 'TEST_MAPPING_U1'), unusableOf(second, T_A, 'TEST_MAPPING_U2')], T_A) }));
      const codes = expectLineAgrees(clinic, TEST_CTX, T_A, `${first} + ${second}`);
      expect(new Set(codes).size, `${first} + ${second}`).toBe(1);
      expect(codes[0], `${first} + ${second}`).not.toBeNull();
      codesByPair.set(`${first}|${second}`, codes[0]!);
    }
    // 순서를 바꾼 쌍의 코드가 같다 (후보 배열 순서에 달라지지 않는다).
    for (const first of UNUSABLE_NAMES) {
      for (const second of UNUSABLE_NAMES) {
        expect(codesByPair.get(`${first}|${second}`), `${first} ↔ ${second}`).toBe(codesByPair.get(`${second}|${first}`));
      }
    }
  });

  it('사용 불가 후보 둘에 사용 가능한 후보 하나가 더해지면 사용 가능한 하나로 확정된다 (순서쌍 13 × 13 중 대각선)', () => {
    for (const name of UNUSABLE_NAMES) {
      const clinic = clinicOf(bundleOf({ mappings: withMappings([unusableOf(name, T_A, 'TEST_MAPPING_U1'), coveredMapping(T_A), unusableOf(name, T_A, 'TEST_MAPPING_U2')], T_A) }));
      expect(expectLineAgrees(clinic, TEST_CTX, T_A, `사용 가능 하나 + ${name} 둘`).every((code) => code === null)).toBe(true);
    }
  });
});

describe('AC-011j (1) 공유 한도 풀의 값 결함은 종류와 관계없이 그 풀의 멤버 그룹으로 가는 줄만 막는다', () => {
  const POOL_DEFECTS: Array<[string, unknown, HoldReasonCode]> = [
    ['풀 한도 금액 없음', { kind: 'PER_VISIT_PAYOUT', limitBasis: 'PAYOUT' }, 'PROFILE_VALUE_MISSING'],
    ['풀 한도 금액 음수', { kind: 'PER_VISIT_PAYOUT', amount: -1, limitBasis: 'PAYOUT' }, 'PROFILE_VALUE_INVALID'],
    ['풀 한도 금액이 소수', { kind: 'ANNUAL', amount: 1.5, limitBasis: 'PAYOUT' }, 'PROFILE_VALUE_INVALID'],
    ['풀 한도 기준이 지원 밖', { kind: 'PER_VISIT_PAYOUT', amount: 50_000, limitBasis: 'COVERED_COST' }, 'PROFILE_FORMULA_UNSUPPORTED'],
    ['풀 한도 종류가 지원 밖', { kind: 'MYSTERY' }, 'PROFILE_FORMULA_UNSUPPORTED'],
    ['풀 한도 없음 선언에 조항 참조가 없음', { kind: 'UNLIMITED_DECLARED', policyClauseRef: '' }, 'PROFILE_SOURCE_INCOMPLETE'],
  ];

  const member = (groupKey: string): CoverageGroupDef => ({
    groupKey,
    deduction: { kind: 'FIXED', fixed: 1_000 },
    limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' },
    sharedLimitPoolKey: 'TEST_POOL',
  });
  const alone: CoverageGroupDef = { groupKey: 'TEST_GROUP_ALONE', deduction: { kind: 'FIXED', fixed: 1_000 }, limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' } };
  const mappings = [
    coveredMapping(T_A, { groupKey: 'TEST_GROUP_P1' }),
    coveredMapping(T_B, { groupKey: 'TEST_GROUP_P2' }),
    coveredMapping(T_C, { groupKey: 'TEST_GROUP_ALONE' }),
    coveredMapping(B_FEE, { groupKey: 'TEST_GROUP_ALONE' }),
  ];

  it.each(POOL_DEFECTS)('%s → %s: 15칸 각각에서 그 칸의 멤버 그룹 줄(T-A, T-B)만 막힌다', (_name, limit, code) => {
    for (const target of ALL_CELLS) {
      const badPool = { poolKey: 'TEST_POOL', limit: limit as CoverageGroupDef['limit'] };
      // 모든 칸이 같은 그룹 구성을 갖고, 결함 있는 풀은 대상 칸에만 둔다 (다른 칸의 풀은 정상).
      const goodPool = { poolKey: 'TEST_POOL', limit: { kind: 'PER_VISIT_PAYOUT', amount: 50_000, limitBasis: 'PAYOUT' } as const };
      const clinic = clinicOf(
        bundleOf({
          profiles: ALL_CELLS.map((cell) => profileOf(cell, { groups: [member('TEST_GROUP_P1'), member('TEST_GROUP_P2'), alone], sharedLimitPools: [sameCell(cell, target) ? badPool : goodPool] })),
          mappings,
        }),
      );
      const report = reportOf(clinic);
      for (const cell of ALL_CELLS) {
        const where = `${_name} @ ${cellName(target)} · ${cellName(cell)}`;
        for (const id of [T_A, T_B]) {
          const est = estimateFor(clinic, cell, TEST_CTX)!;
          if (sameCell(cell, target)) {
            expect(mappingRow(report, id, cell), where).toMatchObject({ status: 'NOT_READY', code });
            expect(engineHoldOf(est, id), where).toBe(code);
          } else {
            expect(mappingRow(report, id, cell).status, where).toBe('READY');
            expect(engineHoldOf(est, id), where).toBeNull();
          }
        }
        for (const id of [T_C, B_FEE]) expect(mappingRow(report, id, cell).status, `${where} · ${id}`).toBe('READY');
      }
    }
  });
});

describe('AC-011j (1) scope 가 비었거나 다른 칸만 있는 매핑', () => {
  it.each([T_A, B_FEE])('scope 가 빈 배열: 15칸 모두 MAPPING_ABSENT · 대상 %s', (target) => {
    const clinic = clinicOf(bundleOf({ mappings: withMappings([coveredMapping(target, { scope: [] })], target) }));
    expect(expectLineAgrees(clinic, TEST_CTX, target, 'scope 빈 배열').every((code) => code === 'MAPPING_ABSENT')).toBe(true);
  });

  it.each(ALL_CELLS.map((cell) => [cellName(cell), cell] as const))('공통 기본비용 줄: scope 에 %s 칸만 있으면 그 칸만 READY, 나머지 14칸은 MAPPING_ABSENT', (_name, only) => {
    const clinic = clinicOf(bundleOf({ mappings: withMappings([coveredMapping(B_FEE, { scope: [{ ...only }] })], B_FEE) }));
    const codes = expectLineAgrees(clinic, TEST_CTX, B_FEE, `scope ${cellName(only)} 만`);
    ALL_CELLS.forEach((cell, index) => expect(codes[index], cellName(cell)).toBe(sameCell(cell, only) ? null : 'MAPPING_ABSENT'));
  });
});
