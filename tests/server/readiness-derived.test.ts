import { beforeAll, describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import { selectDocumentRuleSet } from '../../src/engine/documents';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import { HOLD_REASON_CODES } from '../../src/engine/types';
import type { CoverageGroupDef, DocumentRuleSet, PublishedLine, RuleBundleSnapshot, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../src/engine/types';
import { computeReadiness, renderReadinessReport } from '../../src/server/readiness';
import type { ClinicReadiness, ReadinessClinicInput, ReadinessContext, ReadinessReport } from '../../src/server/readiness';
import { planningExampleRuleSet } from '../fixtures/engine/document-rules.fixture';
import { makeLine } from '../fixtures/engine/lines.fixture';
import { makeExcludedMapping, unusableMappingVariants } from '../fixtures/engine/mappings.fixture';
import { testGroups } from '../fixtures/engine/profiles.fixture';
import {
  ALL_CELLS,
  B_FEE,
  T_A,
  T_B,
  TEST_CTX,
  allProfiles,
  allScope,
  bundleOf,
  clinicOf,
  coveredMapping,
  defaultMappings,
  expectCalculationAgrees,
  pick,
  profileOf,
  rowOfCell,
  sameCell,
  seededRandom,
  snapshotOf,
} from '../fixtures/server/readiness.fixture';

// AC-011l 병원별 두 조건 (design.md DD-23): calculationReady(15칸)와 documentReady 는 합치지 않는다.
//   calculationReady[칸] = S == ACTIVE ∧ P(병원 보기)[칸] == READY ∧ 게시된 치료 ≥ 1 ∧ ∀ 줄: M[줄][칸] == READY
//   documentReady        = S == ACTIVE ∧ D == READY
// (6) 호출 감시와 가져오기 검사는 readiness-reuse.test.ts 가 맡는다.

const reportOf = (clinic: ReadinessClinicInput, ctx: ReadinessContext = TEST_CTX): ClinicReadiness => computeReadiness(snapshotOf([clinic]), ctx).clinics[0]!;

describe('AC-011l (1) 두 값은 별개이고 합친 "준비 완료" 표현이 없다', () => {
  const REPORT_WORLDS: Array<[string, ReadinessClinicInput]> = [
    ['모두 준비됨', clinicOf(bundleOf())],
    ['범위 없음', clinicOf(null)],
    ['묶음 중지', clinicOf(bundleOf({ status: 'SUSPENDED' }))],
    ['서류만 불가', clinicOf(bundleOf({ documentRuleSet: { ...planningExampleRuleSet(), state: 'DRAFT' } }))],
  ];

  it.each(REPORT_WORLDS)('%s: 병원 보고에 calculationReady 15행과 documentReady 한 값이 따로 있다', (_name, clinic) => {
    const report = reportOf(clinic);
    expect(report.calculationReady.map((row) => row.cell)).toEqual(ALL_CELLS);
    expect(['READY', 'NOT_READY']).toContain(report.documentReady.status);
  });

  const collectKeys = (value: unknown, out: Set<string> = new Set()): Set<string> => {
    if (Array.isArray(value)) value.forEach((entry) => collectKeys(entry, out));
    else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        out.add(key);
        collectKeys(entry, out);
      }
    }
    return out;
  };

  it.each(REPORT_WORLDS)('%s: 보고의 어떤 키도 두 조건을 합친 값(ready, overall 등)이 아니다', (_name, clinic) => {
    const keys = [...collectKeys(computeReadiness(snapshotOf([clinic]), TEST_CTX))];
    expect(keys.filter((key) => /ready|overall|summary|operational/i.test(key)).sort()).toEqual(['calculationReady', 'documentReady']);
  });

  it.each(REPORT_WORLDS)('%s: 출력 문자열에 합친 준비 완료 표현이 없고 두 값은 서로 다른 줄에 나온다', (_name, clinic) => {
    const text = renderReadinessReport(computeReadiness(snapshotOf([clinic]), TEST_CTX));
    expect(text).not.toMatch(/준비 ?완료|fully ?ready|all ?ready|overall|운영 ?준비|clinic ?ready|hospital ?ready/i);
    const lines = text.split('\n');
    expect(lines.filter((line) => line.includes('calculationReady'))).toHaveLength(15);
    expect(lines.filter((line) => line.includes('documentReady'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('calculationReady') && line.includes('documentReady'))).toEqual([]);
  });

  it('출력 문자열은 NOT_READY 이면 막힌 단계와 코드를 함께 적는다', () => {
    const text = renderReadinessReport(computeReadiness(snapshotOf([clinicOf(null)]), TEST_CTX));
    expect(text).toContain('calculationReady[GEN1_AS/NON_LIFE] NOT_READY stage=S code=CLINIC_RULE_SCOPE_ABSENT');
    expect(text).toContain('documentReady NOT_READY stage=S code=CLINIC_RULE_SCOPE_ABSENT');
    const ready = renderReadinessReport(computeReadiness(snapshotOf([clinicOf(bundleOf())]), TEST_CTX));
    expect(ready).toContain('calculationReady[GEN1_AS/NON_LIFE] READY');
    expect(ready).toContain('documentReady READY');
    expect(ready).toContain('platformProfile[GEN1_AS/NON_LIFE] READY bundles=TEST_BUNDLE_A');
    expect(ready).toContain('scope: READY ACTIVE bundle=TEST_BUNDLE_A');
    expect(ready).toContain('documents: READY set=TEST_DOCUMENT_RULES_PLANNING_EXAMPLE/v1');
  });

  it('줄 단계에서 막히면 막힌 줄과 코드를 같은 줄에 적고, 서류만 막히면 단계 D 와 세부 사유를 적는다', () => {
    const blocked = clinicOf(bundleOf({ mappings: defaultMappings().filter((mapping) => mapping.treatmentId !== T_B), documentRuleSet: { ...planningExampleRuleSet(), state: 'DRAFT' } }));
    const text = renderReadinessReport(computeReadiness(snapshotOf([blocked]), TEST_CTX));
    expect(text).toContain('calculationReady[GEN1_AS/NON_LIFE] NOT_READY stage=M lines=T-B:MAPPING_ABSENT');
    expect(text).toContain('documentReady NOT_READY stage=D code=RULES_UNAVAILABLE detail=STATE_DRAFT');
    expect(text).toContain('documents: NOT_READY RULES_UNAVAILABLE detail=STATE_DRAFT');
    expect(text).toContain('mappings: 60 rows, 15 NOT_READY');
    expect(text).toContain('platformProfile[GEN1_AS/NON_LIFE] READY bundles=TEST_BUNDLE_A');
    const empty = renderReadinessReport(computeReadiness(snapshotOf([clinicOf(null)]), TEST_CTX));
    expect(empty).toContain('platformProfile[GEN1_AS/NON_LIFE] NOT_READY code=PROFILE_ABSENT');
    expect(empty).toContain('scope: NOT_READY SCOPE_ABSENT code=CLINIC_RULE_SCOPE_ABSENT');
  });
});

describe('AC-011l (2) 표 P 하나가 READY 여도 calculationReady 가 되지 않는다', () => {
  const cell = ALL_CELLS[0]!;
  const rowOf = (clinic: ReadinessClinicInput, snapshotExtras: RuleBundleSnapshot[] = []) =>
    rowOfCell(computeReadiness(snapshotOf([clinic], snapshotExtras), TEST_CTX).clinics[0]!.calculationReady, cell);

  it('플랫폼 보기 READY 인데 병원이 범위가 없으면 S 단계에서 막힌다', () => {
    const platformReady = computeReadiness(snapshotOf([clinicOf(null)], [bundleOf()]), TEST_CTX);
    expect(rowOfCell(platformReady.platformProfiles, cell).status).toBe('READY');
    expect(rowOf(clinicOf(null), [bundleOf()])).toEqual({ cell, status: 'NOT_READY', stage: 'S', code: 'CLINIC_RULE_SCOPE_ABSENT' });
  });

  it('플랫폼 보기 READY 인데 병원의 묶음이 중지이면 S 단계에서 막힌다 (사유는 RULE_BUNDLE_SUSPENDED)', () => {
    expect(rowOf(clinicOf(bundleOf({ id: 'TEST_BUNDLE_SUSP', status: 'SUSPENDED' })), [bundleOf({ id: 'TEST_BUNDLE_OTHER' })])).toEqual({
      cell,
      status: 'NOT_READY',
      stage: 'S',
      code: 'RULE_BUNDLE_SUSPENDED',
    });
  });

  it('병원 보기 P 가 READY 여도 표 M 에 NOT_READY 줄이 하나라도 있으면 NOT_READY 이고 막힌 줄과 코드를 모두 낸다', () => {
    const mappings = defaultMappings().filter((mapping) => mapping.treatmentId !== T_B && mapping.treatmentId !== B_FEE);
    const clinic = clinicOf(bundleOf({ mappings }));
    const report = reportOf(clinic);
    expect(report.profiles.every((row) => row.status === 'READY')).toBe(true);
    expect(rowOf(clinic)).toEqual({
      cell,
      status: 'NOT_READY',
      stage: 'M',
      lines: [
        { treatmentId: B_FEE, code: 'MAPPING_ABSENT' },
        { treatmentId: T_B, code: 'MAPPING_ABSENT' },
      ],
    });
    expectCalculationAgrees(report, clinic, TEST_CTX, '줄 둘이 막힘');
  });

  it('병원 보기 P 가 READY 여도 게시된 치료가 없으면(공통 기본비용만 있어도) NOT_READY (NO_PUBLISHED_TREATMENT) 이고 estimate() 는 입력을 거절한다', () => {
    const clinic = clinicOf(bundleOf(), { lines: [] });
    expect(reportOf(clinic).profiles.every((row) => row.status === 'READY')).toBe(true);
    expect(rowOf(clinic)).toEqual({ cell, status: 'NOT_READY', stage: 'TREATMENT', code: 'NO_PUBLISHED_TREATMENT' });
    const outcome = estimate(
      { generation: cell.generation, insurerType: cell.insurerType, treatmentIds: [], lines: [], baseFeeLines: clinic.baseFeeLines, bundle: clinic.bundle, at: TEST_CTX.at, acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] } },
      { digest: TEST_CTX.digest },
    );
    expect(outcome).toEqual({ ok: false, rejection: { code: 'NO_TREATMENT_SELECTED' } });
  });

  it('치료도 기본비용도 없는 병원도 NO_PUBLISHED_TREATMENT 다', () => {
    expect(rowOf(clinicOf(bundleOf(), { lines: [], baseFeeLines: [] }))).toMatchObject({ status: 'NOT_READY', stage: 'TREATMENT' });
  });

  it('막힌 단계의 우선순위는 S → P → 게시된 치료 → M 이다', () => {
    const noTreatment = { lines: [] as PublishedLine[] };
    const brokenProfile = (status: RuleBundleSnapshot['status']) => bundleOf({ status, profiles: allProfiles(cell, (p) => ({ ...p, state: 'DRAFT' })), mappings: [] });
    expect(rowOf(clinicOf(brokenProfile('SUSPENDED'), noTreatment))).toMatchObject({ stage: 'S', code: 'RULE_BUNDLE_SUSPENDED' });
    expect(rowOf(clinicOf(brokenProfile('ACTIVE'), noTreatment))).toMatchObject({ stage: 'P', code: 'PROFILE_DRAFT' });
    expect(rowOf(clinicOf(bundleOf({ mappings: [] }), noTreatment))).toMatchObject({ stage: 'TREATMENT' });
    expect(rowOf(clinicOf(bundleOf({ mappings: [] })))).toMatchObject({ stage: 'M' });
  });

  it('칸마다 독립이다: 한 칸의 프로필 결함이 다른 칸의 calculationReady 를 바꾸지 않는다', () => {
    const clinic = clinicOf(bundleOf({ profiles: allProfiles(cell, (p) => ({ ...p, state: 'UNDER_REREVIEW' })) }));
    const rows = reportOf(clinic).calculationReady;
    expect(rowOfCell(rows, cell)).toMatchObject({ status: 'NOT_READY', stage: 'P', code: 'PROFILE_UNDER_REREVIEW' });
    expect(rows.filter((row) => !sameCell(row.cell, cell)).every((row) => row.status === 'READY')).toBe(true);
  });
});

describe('AC-011l (4) 서류 규칙 묶음만 사용 불가이면 documentReady 만 NOT_READY 다', () => {
  it.each(['DRAFT', 'SUSPENDED', 'UNDER_REREVIEW'] as const)('서류 규칙 묶음 상태 %s: calculationReady 15칸은 좋은 서류 규칙 묶음일 때와 같다', (state) => {
    const good = reportOf(clinicOf(bundleOf()));
    const bad = reportOf(clinicOf(bundleOf({ documentRuleSet: { ...planningExampleRuleSet(), state } })));
    expect(bad.documentReady).toMatchObject({ status: 'NOT_READY', stage: 'D', code: 'RULES_UNAVAILABLE' });
    expect(good.documentReady).toEqual({ status: 'READY' });
    expect(bad.calculationReady).toEqual(good.calculationReady);
    expect(bad.calculationReady.every((row) => row.status === 'READY')).toBe(true);
  });

  it('서류 규칙 묶음이 아예 없어도 calculationReady 는 그대로다', () => {
    const report = reportOf(clinicOf(bundleOf({ documentRuleSet: null })));
    expect(report.documentReady).toMatchObject({ status: 'NOT_READY', detail: 'SET_ABSENT' });
    expect(report.calculationReady.every((row) => row.status === 'READY')).toBe(true);
  });

  it('반대로 계산만 막혀도 documentReady 는 그대로다 (서류는 병원 단위, 계산은 칸 단위)', () => {
    const report = reportOf(clinicOf(bundleOf({ mappings: [] })));
    expect(report.calculationReady.every((row) => row.status === 'NOT_READY')).toBe(true);
    expect(report.documentReady).toEqual({ status: 'READY' });
  });
});

describe('AC-011l (5) 운영 데이터가 없는 저장소(병원은 있고 규칙 사용 범위가 없음)', () => {
  const report = computeReadiness(snapshotOf([clinicOf(null)]), TEST_CTX);
  const clinic = report.clinics[0]!;

  it('표 S SCOPE_ABSENT, 표 D RULES_UNAVAILABLE, 표 M 모든 줄 MAPPING_ABSENT, 표 P(플랫폼 보기) 15칸 PROFILE_ABSENT', () => {
    expect(clinic.scope).toMatchObject({ status: 'NOT_READY', value: 'SCOPE_ABSENT' });
    expect(clinic.documents).toEqual({ status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail: 'SCOPE_ABSENT' });
    expect(clinic.mappings.every((row) => row.status === 'NOT_READY' && row.code === 'MAPPING_ABSENT')).toBe(true);
    expect(report.platformProfiles.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_ABSENT')).toBe(true);
  });

  it('calculationReady 15칸과 documentReady 가 모두 NOT_READY 이고 막힌 단계는 S 다', () => {
    expect(clinic.calculationReady).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', stage: 'S', code: 'CLINIC_RULE_SCOPE_ABSENT' })));
    expect(clinic.documentReady).toEqual({ status: 'NOT_READY', stage: 'S', code: 'CLINIC_RULE_SCOPE_ABSENT' });
  });

  it('보고에 나온 코드는 DD-03 의 보류 코드 21개이거나 보고용 표시(RULES_UNAVAILABLE, NO_PUBLISHED_TREATMENT)뿐이다 (새 보류 코드 없음)', () => {
    expect(codesOf(report).filter((code) => !allowedCodes.has(code))).toEqual([]);
  });

  it('병원이 없는 저장소는 병원 보고가 비고 플랫폼 보기만 15행이다', () => {
    const empty = computeReadiness({ bundles: [], clinics: [] }, TEST_CTX);
    expect(empty.clinics).toEqual([]);
    expect(empty.platformProfiles).toHaveLength(15);
  });
});

const allowedCodes = new Set<string>([...HOLD_REASON_CODES, 'RULES_UNAVAILABLE', 'NO_PUBLISHED_TREATMENT']);

/** 보고 안의 모든 `code` 값 (병원 보고의 줄별 코드 포함). */
function codesOf(report: ReadinessReport): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'code' && typeof entry === 'string') out.push(entry);
        else walk(entry);
      }
    }
  };
  walk(report);
  return out;
}

// ───────────────────────── (3) 고정 시드 동치 행렬 ─────────────────────────

const SEED = 20261016;
const TRIALS = 300;

/** 시험 허용 출처에서 줄은 DEMO 를 허용하지 않는다 (줄 출처 결함 시험용). */
const PROPERTY_CTX: ReadinessContext = { ...TEST_CTX, acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE'] } };

const group = (index: 0 | 1): CoverageGroupDef => testGroups()[index]!;

const PROFILE_FAULTS: Array<(cell: (typeof ALL_CELLS)[number]) => StandardAssumptionProfile[]> = [
  (cell) => [{ ...profileOf(cell), state: 'DRAFT' }],
  (cell) => [{ ...profileOf(cell), state: 'UNDER_REREVIEW' }],
  (cell) => [{ ...profileOf(cell), contentHash: 'TEST_DIGEST_00000000' }],
  (cell) => [{ ...profileOf(cell), origin: 'DEMO' }],
  (cell) => [profileOf(cell), { ...profileOf(cell), id: `${profileOf(cell).id}_2` }],
  (cell) => [profileOf(cell, { groups: [] })],
  (cell) => [profileOf(cell, { groups: [{ ...group(0), deduction: { kind: 'FIXED' } as unknown as CoverageGroupDef['deduction'] }, group(1)] })],
  (cell) => [profileOf(cell, { groups: [{ ...group(0), limit: { kind: 'UNLIMITED_DECLARED', policyClauseRef: '' } }, group(1)] })],
  () => [],
];

function randomProfiles(random: () => number): StandardAssumptionProfile[] {
  return ALL_CELLS.flatMap((cell) => (random() < 0.8 ? [profileOf(cell)] : pick(PROFILE_FAULTS, random)(cell)));
}

type MappingMaker = (id: string, random: () => number) => TreatmentCoverageMapping[];

const MAPPING_KINDS: MappingMaker[] = [
  (id) => [coveredMapping(id)],
  (id) => [coveredMapping(id)],
  (id) => [coveredMapping(id)],
  (id) => [coveredMapping(id, { groupKey: 'TEST_GROUP_NON_BENEFIT' })],
  () => [],
  (id) => [{ ...makeExcludedMapping(id), scope: allScope() }],
  (id) => [{ ...unusableMappingVariants(id)['DRAFT']!.make(`TEST_MAPPING_${id}_U`), scope: allScope() }],
  (id) => [{ ...unusableMappingVariants(id)['UNDER_REREVIEW_STATE']!.make(`TEST_MAPPING_${id}_U`), scope: allScope() }],
  (id) => [{ ...unusableMappingVariants(id)['FINGERPRINT_MISMATCH']!.make(`TEST_MAPPING_${id}_U`), scope: allScope() }],
  (id) => [coveredMapping(id), coveredMapping(id, { id: `TEST_MAPPING_${id}_2` })],
  (id) => [coveredMapping(id, { groupKey: 'TEST_GROUP_NOT_IN_PROFILE' })],
  (id, random) => [coveredMapping(id, { scope: allScope().filter(() => random() < 0.8) })],
];

const DOCUMENT_FAULTS: Array<DocumentRuleSet | null> = [
  null,
  { ...planningExampleRuleSet(), state: 'DRAFT' },
  { ...planningExampleRuleSet(), contentHash: 'TEST_DIGEST_00000000' },
  { ...planningExampleRuleSet(), approver: null },
];

function randomClinic(random: () => number): { clinic: ReadinessClinicInput; ctx: ReadinessContext } {
  const treatmentCount = Math.floor(random() * 4);
  const lineIds = ['T-1', 'T-2', 'T-3'].slice(0, treatmentCount);
  const mutate = (line: PublishedLine): PublishedLine => {
    const roll = random();
    if (roll < 0.08) return { ...line, calcClass: 'NEEDS_REVIEW' };
    if (roll < 0.16) return { ...line, origin: 'DEMO' };
    return line;
  };
  const lines = lineIds.map((id, index) => mutate(makeLine(id, 1_000 * (index + 1), index === 1 ? { benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT' } : {})));
  const baseFeeLines = random() < 0.5 ? [mutate(makeLine('B-1', 500, { isBaseFee: true }))] : [];
  const mappings = [...lines, ...baseFeeLines].flatMap((line) => pick(MAPPING_KINDS, random)(line.treatmentId, random));
  const scopeRoll = random();
  const status: RuleBundleSnapshot['status'] = scopeRoll < 0.15 ? 'SUSPENDED' : 'ACTIVE';
  const documentRuleSet = random() < 0.7 ? planningExampleRuleSet() : pick(DOCUMENT_FAULTS, random);
  const bundle = scopeRoll >= 0.85 && scopeRoll < 0.95 ? null : bundleOf({ status, profiles: randomProfiles(random), mappings, documentRuleSet });
  return { clinic: clinicOf(bundle, { lines, baseFeeLines }), ctx: PROPERTY_CTX };
}

describe(`AC-011l (3) 고정 시드 동치 행렬 (seed=${SEED}, 시행 ${TRIALS}회)`, () => {
  beforeAll(() => {
    console.info(`AC-011l 동치 행렬 시험: seed=${SEED}, 시행 수=${TRIALS}`);
  });

  it('칸마다 calculationReady 와 estimate() 가 모든 시행에서 같고 NOT_READY 의 사유도 같으며, documentReady 는 서류 규칙 선택과 같다', () => {
    const random = seededRandom(SEED);
    const seen = { READY: 0, S: 0, P: 0, TREATMENT: 0, M: 0, docReady: 0, docBlocked: 0 };
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const { clinic, ctx } = randomClinic(random);
      // AC-011l (3): 금액은 AC-003h 의 경계(MAX_AMOUNT_WON, 합계의 안전 정수 한계)에 닿지 않는다. 한 시행의 줄 금액 합이 상한의 1/1000 도 안 된다.
      const amountTotal = [...clinic.lines, ...clinic.baseFeeLines].reduce((sum, line) => sum + line.patientAmount, 0);
      expect(amountTotal, `시행 ${trial} 금액 합`).toBeLessThan(MAX_AMOUNT_WON / 1000);
      const report = reportOf(clinic, ctx);
      expectCalculationAgrees(report, clinic, ctx, `시행 ${trial}`);
      for (const row of report.calculationReady) {
        if (row.status === 'READY') seen.READY += 1;
        else seen[row.stage] += 1;
      }
      const usable = clinic.bundle !== null && clinic.bundle.status === 'ACTIVE' && selectDocumentRuleSet(clinic.bundle, { at: ctx.at, acceptedOrigins: ctx.acceptedOrigins.rules, digest: ctx.digest }) !== null;
      expect(report.documentReady.status, `시행 ${trial}`).toBe(usable ? 'READY' : 'NOT_READY');
      seen[usable ? 'docReady' : 'docBlocked'] += 1;
      expect(codesOf({ platformProfiles: [], clinics: [report] }).filter((code) => !allowedCodes.has(code))).toEqual([]);
    }
    console.info(`AC-011l 행렬 분포 (칸 단위): ${JSON.stringify(seen)}`);
    // 시험이 의미 있으려면 모든 단계와 두 결과가 실제로 나와야 한다.
    for (const [name, count] of Object.entries(seen)) {
      expect(count, `${name} 가 나온 횟수`).toBeGreaterThan(20);
    }
  });
});

// ───────────────────────── 순수성·복사본 ─────────────────────────

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

describe('computeReadiness 는 순수하고 입력을 바꾸지 않으며 복사본을 돌려준다', () => {
  const build = () =>
    snapshotOf(
      [clinicOf(bundleOf({ mappings: [...defaultMappings().filter((m) => m.treatmentId !== T_A), coveredMapping(T_A, { groupKey: 'TEST_GROUP_NOT_IN_PROFILE' })] })), clinicOf(null, { clinicId: 'TEST_CLINIC_2', slug: 'two' })],
      [bundleOf({ id: 'TEST_BUNDLE_EXTRA' })],
    );

  it('깊이 얼린 입력으로도 던지지 않고 같은 입력이면 같은 결과를 낸다', () => {
    const snapshot = deepFreeze(build());
    const first = computeReadiness(snapshot, TEST_CTX);
    const second = computeReadiness(snapshot, TEST_CTX);
    expect(second).toEqual(first);
    expect(first.clinics).toHaveLength(2);
  });

  it('호출 전후로 입력이 깊이 같다', () => {
    const snapshot = build();
    const before = structuredClone(snapshot);
    computeReadiness(snapshot, TEST_CTX);
    expect(snapshot).toEqual(before);
  });

  it('결과를 고쳐도 입력과 다음 결과가 바뀌지 않는다 (입력의 객체를 결과에 그대로 싣지 않는다)', () => {
    const snapshot = build();
    const first = computeReadiness(snapshot, TEST_CTX);
    const pristine = structuredClone(first);
    for (const row of first.platformProfiles) row.cell.generation = 'GEN1_AS';
    for (const clinic of first.clinics) {
      for (const row of clinic.mappings) row.cell.insurerType = 'LIFE';
      clinic.calculationReady.length = 0;
    }
    expect(computeReadiness(snapshot, TEST_CTX)).toEqual(pristine);
    // 결과의 칸 객체가 입력(스냅샷 안의 어떤 객체)과 같은 참조가 아니다.
    const second = computeReadiness(snapshot, TEST_CTX);
    const inputObjects = new Set<unknown>();
    const collect = (value: unknown): void => {
      if (value !== null && typeof value === 'object') {
        inputObjects.add(value);
        Object.values(value).forEach(collect);
      }
    };
    collect(snapshot);
    const shared: unknown[] = [];
    const walk = (value: unknown): void => {
      if (value !== null && typeof value === 'object') {
        if (inputObjects.has(value)) shared.push(value);
        Object.values(value).forEach(walk);
      }
    };
    walk(second);
    expect(shared).toEqual([]);
  });

  it('병원은 병원 id 의 코드 포인트 순으로 낸다 (입력 순서와 무관)', () => {
    const report = computeReadiness(snapshotOf([clinicOf(null, { clinicId: 'TEST_CLINIC_B', slug: 'b' }), clinicOf(null, { clinicId: 'TEST_CLINIC_A', slug: 'a' })]), TEST_CTX);
    expect(report.clinics.map((entry) => entry.clinicId)).toEqual(['TEST_CLINIC_A', 'TEST_CLINIC_B']);
  });
});
