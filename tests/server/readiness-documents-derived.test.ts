import { beforeAll, describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import { deriveDocuments, selectDocumentRuleSet } from '../../src/engine/documents';
import { documentRuleSetToRuleItem, isUsable } from '../../src/engine/usability';
import type { DocumentRuleSet, LifecycleState, PublishedLine, RuleBundleSnapshot, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../src/engine/types';
import { computeReadiness, renderReadinessReport } from '../../src/server/readiness';
import type { ClinicReadiness, ReadinessClinicInput, ReadinessContext, ReadinessReport } from '../../src/server/readiness';
import { planningExampleRuleSet, rule, ruleSetOf } from '../fixtures/engine/document-rules.fixture';
import { makeLine } from '../fixtures/engine/lines.fixture';
import { makeExcludedMapping, unusableMappingVariants } from '../fixtures/engine/mappings.fixture';
import { testPolicySource } from '../fixtures/engine/profiles.fixture';
import {
  ALL_CELLS,
  OPERATING_ONLY_CTX,
  TEST_CTX,
  allProfiles,
  allScope,
  bundleOf,
  clinicOf,
  coveredMapping,
  operatingBundleOf,
  operatingClinicOf,
  pick,
  seededRandom,
  snapshotOf,
} from '../fixtures/server/readiness.fixture';

// AC-011k·AC-011l 보강 (M3.E 보강 세션).
//   AC-011k: 서류 규칙 묶음의 어긋남을 한 번에 하나씩 모두 (약관 출처 6항목 각각, 승인자 id 빈 문자열, 달력에 없는 유효 기간, 운영 허용 출처의
//            TEST_FIXTURE 한 항목만)와, 실제 estimate() 의 전체 상태를 deriveDocuments() 에 먹여 얻은 결과와의 일치(AC-007d).
//   AC-011l (1) 출력 문자열 전체(렌더 문자열과 보고 객체의 모든 문자열·키)에 두 값을 합친 표현이 없다 — 고정 시드 상태 조합으로 많은 상태에서.
//   AC-011l (4) 서류 규칙 묶음만 사용 불가인 모든 종류에서 documentReady 만 NOT_READY 다.

const reportOf = (clinic: ReadinessClinicInput, ctx: ReadinessContext = TEST_CTX): ClinicReadiness => computeReadiness(snapshotOf([clinic]), ctx).clinics[0]!;
const usabilityCtx = (ctx: ReadinessContext) => ({ at: ctx.at, acceptedOrigins: ctx.acceptedOrigins.rules, digest: ctx.digest });

const base = (): DocumentRuleSet => planningExampleRuleSet();
const withState = (state: LifecycleState): DocumentRuleSet => ({ ...base(), state });
const SOURCE_FIELDS = Object.keys(testPolicySource('DOC')) as Array<keyof ReturnType<typeof testPolicySource>>;

/** 서류 규칙 묶음 한 항목의 어긋남. 헤더 변경은 내용 해시를 건드리지 않으므로 그 사유만 걸린다. 구조 결함은 해시를 다시 맞출 수 없어 따로 둔다. */
const DOC_DEFECTS: Array<[string, DocumentRuleSet | null]> = [
  ['묶음에 서류 규칙 묶음이 없음', null],
  ...(['DRAFT', 'REVIEW_REQUESTED', 'REJECTED', 'APPROVED', 'UNDER_REREVIEW', 'SUPERSEDED', 'EXPIRED', 'SUSPENDED'] as const).map((state): [string, DocumentRuleSet] => [`상태 ${state}`, withState(state)]),
  ['유효 기간 밖', { ...base(), validity: { from: '2025-01-01', to: '2025-12-31' } }],
  ['유효 기간이 달력에 없는 날짜', { ...base(), validity: { from: '2026-02-30', to: '2026-12-31' } }],
  ['약관 출처 없음(빈 목록)', { ...base(), policySources: [] }],
  ...SOURCE_FIELDS.map((field): [string, DocumentRuleSet] => [`약관 출처 ${field} 누락`, { ...base(), policySources: [{ ...testPolicySource('DOC'), [field]: '' }] }]),
  ['승인자 없음', { ...base(), approver: null }],
  ['승인자 id 가 빈 문자열', { ...base(), approver: { approverId: '', approvedAt: '2026-01-02' } }],
  ['내용 해시 불일치', { ...base(), contentHash: 'TEST_DIGEST_00000000' }],
  ['출처 DEMO', { ...base(), origin: 'DEMO' }],
  ['구조 결함(해시는 맞음)', ruleSetOf([rule('NOT_A_DOCUMENT_CODE' as unknown as 'RECEIPT', {}, '시험 문장', 1)])],
];

describe('AC-011k 표 D: 서류 규칙 묶음의 어긋남을 하나씩 모두', () => {
  it('변형 수 확인 (빈 시험 방지): 1 + 8 + 2 + 1 + 6 + 2 + 1 + 1 + 1', () => {
    expect(DOC_DEFECTS).toHaveLength(1 + 8 + 2 + 1 + SOURCE_FIELDS.length + 2 + 1 + 1 + 1);
    expect(SOURCE_FIELDS).toHaveLength(6);
  });

  it.each(DOC_DEFECTS)('%s: RULES_UNAVAILABLE, 세부 사유는 엔진 isUsable 의 사유 그대로(없음·구조 결함은 보고용 표시)', (_name, ruleSet) => {
    const bundle = bundleOf({ documentRuleSet: ruleSet });
    const clinic = clinicOf(bundle);
    const report = reportOf(clinic);
    expect(report.documents.status).toBe('NOT_READY');
    if (report.documents.status === 'READY') return;
    expect(report.documents.code).toBe('RULES_UNAVAILABLE');
    if (ruleSet === null) {
      expect(report.documents.detail).toBe('SET_ABSENT');
    } else {
      const verdict = isUsable(documentRuleSetToRuleItem(ruleSet), usabilityCtx(TEST_CTX));
      // 구조 결함은 해시까지 맞는 항목이라 isUsable 을 통과하고, 그 뒤 selectDocumentRuleSet 의 구조 검사에서 걸린다.
      expect(report.documents.detail).toBe(verdict.usable ? 'SET_STRUCTURE_INVALID' : verdict.reason);
    }
    expect(selectDocumentRuleSet(bundle, usabilityCtx(TEST_CTX))).toBeNull();
    expect(report.documentReady).toEqual({ status: 'NOT_READY', stage: 'D', code: 'RULES_UNAVAILABLE', detail: report.documents.detail });
  });

  it.each(DOC_DEFECTS)('%s: 묶음이 SUSPENDED 이면 세부 사유는 묶음 단계(BUNDLE_SUSPENDED)가 먼저다', (_name, ruleSet) => {
    const report = reportOf(clinicOf(bundleOf({ documentRuleSet: ruleSet, status: 'SUSPENDED' })));
    expect(report.documents).toEqual({ status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail: 'BUNDLE_SUSPENDED' });
    expect(report.documentReady).toEqual({ status: 'NOT_READY', stage: 'S', code: 'RULE_BUNDLE_SUSPENDED' });
  });

  it('운영 허용 출처에서 서류 규칙 묶음 하나만 TEST_FIXTURE 이면 그 사유(ORIGIN_NOT_ACCEPTED)만 막히고 나머지 자료는 모두 사용 가능하다', () => {
    const good = operatingClinicOf(operatingBundleOf());
    expect(reportOf(good, OPERATING_ONLY_CTX).documents.status).toBe('READY');
    const bad = operatingClinicOf(operatingBundleOf({ documentRuleSet: { ...planningExampleRuleSet(), origin: 'TEST_FIXTURE' } }));
    const report = reportOf(bad, OPERATING_ONLY_CTX);
    expect(report.documents).toEqual({ status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail: 'ORIGIN_NOT_ACCEPTED' });
    expect(report.documentReady).toEqual({ status: 'NOT_READY', stage: 'D', code: 'RULES_UNAVAILABLE', detail: 'ORIGIN_NOT_ACCEPTED' });
    expect(report.profiles.every((row) => row.status === 'READY')).toBe(true);
    expect(report.calculationReady).toEqual(reportOf(good, OPERATING_ONLY_CTX).calculationReady);
    expect(report.calculationReady.every((row) => row.status === 'READY')).toBe(true);
  });
});

describe('AC-011k 실제 estimate() 의 전체 상태를 deriveDocuments() 에 먹인 결과와 맞춘다 (AC-007d)', () => {
  /** 칸 하나에서 실제 estimate() 를 불러 그 전체 상태로 서류 산출을 한다. */
  function derivedFor(clinic: ReadinessClinicInput, cell: (typeof ALL_CELLS)[number], ctx: ReadinessContext) {
    const outcome = estimate(
      {
        generation: cell.generation,
        insurerType: cell.insurerType,
        treatmentIds: clinic.lines.map((line) => line.treatmentId),
        lines: clinic.lines,
        baseFeeLines: clinic.baseFeeLines,
        bundle: clinic.bundle,
        at: ctx.at,
        acceptedOrigins: { rules: [...ctx.acceptedOrigins.rules], lines: [...ctx.acceptedOrigins.lines] },
      },
      { digest: ctx.digest },
    );
    if (!outcome.ok) throw new Error('TEST_FIXTURE: estimate 가 입력을 거절했다');
    const derived = deriveDocuments({
      overallState: outcome.result.state,
      cause: 'UNKNOWN',
      insurerType: cell.insurerType,
      treatments: clinic.lines.map((line) => ({ documentFlags: line.documentFlags })),
      clinicSetting: 'OUTPATIENT_ONLY',
      ruleSet: selectDocumentRuleSet(clinic.bundle, usabilityCtx(ctx)),
    });
    return { state: outcome.result.state, derived };
  }

  it.each(DOC_DEFECTS)('%s: 계산이 보류가 아닌 칸에서는 RULES_UNAVAILABLE, 보류인 칸에서는 null (서류 안내가 없다). documentReady 는 NOT_READY', (_name, ruleSet) => {
    // (a) 계산이 모든 칸에서 가능한 세계
    const open = clinicOf(bundleOf({ documentRuleSet: ruleSet }));
    const openReport = reportOf(open);
    for (const cell of ALL_CELLS) {
      const { state, derived } = derivedFor(open, cell, TEST_CTX);
      expect(state, cell.generation).not.toBe('ON_HOLD');
      expect(derived, cell.generation).toEqual({ state: 'RULES_UNAVAILABLE' });
    }
    expect(openReport.documentReady.status).toBe('NOT_READY');
    // (b) 계산이 모든 칸에서 보류인 세계 (매핑 없음): 서류 규칙 묶음이 나쁘든 좋든 서류 산출은 null 이다 (RULES_UNAVAILABLE 은 보류가 아닐 때만).
    const held = clinicOf(bundleOf({ documentRuleSet: ruleSet, mappings: [] }));
    for (const cell of ALL_CELLS) {
      const { state, derived } = derivedFor(held, cell, TEST_CTX);
      expect(state, cell.generation).toBe('ON_HOLD');
      expect(derived, cell.generation).toBeNull();
    }
    expect(reportOf(held).calculationReady.every((row) => row.status === 'NOT_READY')).toBe(true);
    expect(reportOf(held).documentReady.status).toBe('NOT_READY');
  });

  it('사용 가능한 서류 규칙 묶음: 계산이 보류가 아니면 AVAILABLE 이고 documentReady 는 READY, 보류이면 null 이어도 documentReady 는 READY (두 조건은 독립)', () => {
    const open = clinicOf(bundleOf());
    expect(reportOf(open).documentReady).toEqual({ status: 'READY' });
    for (const cell of ALL_CELLS) expect(derivedFor(open, cell, TEST_CTX).derived?.state, cell.generation).toBe('AVAILABLE');
    const held = clinicOf(bundleOf({ mappings: [] }));
    expect(reportOf(held).documentReady).toEqual({ status: 'READY' });
    for (const cell of ALL_CELLS) expect(derivedFor(held, cell, TEST_CTX).derived, cell.generation).toBeNull();
  });
});

describe('AC-011l (4) 서류 규칙 묶음만 사용 불가이면 documentReady 만 NOT_READY 이고 calculationReady 는 그대로다 (모든 종류)', () => {
  const good = reportOf(clinicOf(bundleOf()));

  it.each(DOC_DEFECTS)('%s', (_name, ruleSet) => {
    const bad = reportOf(clinicOf(bundleOf({ documentRuleSet: ruleSet })));
    expect(good.documentReady).toEqual({ status: 'READY' });
    expect(bad.documentReady).toMatchObject({ status: 'NOT_READY', stage: 'D', code: 'RULES_UNAVAILABLE' });
    expect(bad.calculationReady).toEqual(good.calculationReady);
    expect(bad.calculationReady.every((row) => row.status === 'READY')).toBe(true);
    // 계산 쪽 표(P, M)와 표 S 도 그대로다.
    expect(bad.profiles).toEqual(good.profiles);
    expect(bad.mappings).toEqual(good.mappings);
    expect(bad.scope).toEqual(good.scope);
  });
});

// ───────────────────────── AC-011l (1) 합친 표현이 어디에도 없다 ─────────────────────────

/** 두 값을 합친 표현의 금지 목록. 한국어·영어, 띄어쓰기 변형 포함. */
const MERGED_PHRASE = /준비 ?완료|준비 ?됨|운영 ?준비|전체 ?준비|병원 ?준비|fully[ _-]?ready|all[ _-]?ready|overall|operational|clinic[ _-]?ready|hospital[ _-]?ready|is[ _-]?ready|ready[ _-]?to[ _-]?(?:operate|serve|launch)|go[ _-]?live/i;

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, out));
  else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      out.push(key);
      collectStrings(entry, out);
    }
  }
  return out;
}

const SEED = 20261019;
const TRIALS = 200;

const DOC_FAULTS: Array<DocumentRuleSet | null> = [null, withState('DRAFT'), withState('SUSPENDED'), { ...base(), approver: null }, { ...base(), contentHash: 'TEST_DIGEST_00000000' }];
const PROFILE_FAULTS: Array<(profiles: StandardAssumptionProfile[]) => StandardAssumptionProfile[]> = [
  (profiles) => profiles,
  (profiles) => profiles.slice(1),
  () => allProfiles(ALL_CELLS[3]!, (p) => ({ ...p, state: 'DRAFT' })),
  () => allProfiles(ALL_CELLS[9]!, (p) => ({ ...p, state: 'UNDER_REREVIEW' })),
  () => allProfiles(ALL_CELLS[0]!, (p) => [p, { ...p, id: `${p.id}_2` }]),
];
const MAPPING_FAULTS: Array<(id: string) => TreatmentCoverageMapping[]> = [
  (id) => [coveredMapping(id)],
  (id) => [coveredMapping(id)],
  () => [],
  (id) => [{ ...makeExcludedMapping(id), scope: allScope() }],
  (id) => [{ ...unusableMappingVariants(id)['DRAFT']!.make(`TEST_MAPPING_${id}_U`), scope: allScope() }],
  (id) => [coveredMapping(id), coveredMapping(id, { id: `TEST_MAPPING_${id}_2` })],
];

function randomWorld(random: () => number): { clinic: ReadinessClinicInput; extraBundles: RuleBundleSnapshot[] } {
  const count = Math.floor(random() * 4);
  const lines: PublishedLine[] = ['T-1', 'T-2', 'T-3'].slice(0, count).map((id, index) => makeLine(id, 1_000 * (index + 1)));
  const baseFeeLines: PublishedLine[] = random() < 0.5 ? [makeLine('B-1', 500, { isBaseFee: true })] : [];
  const mappings = [...lines, ...baseFeeLines].flatMap((line) => pick(MAPPING_FAULTS, random)(line.treatmentId));
  const roll = random();
  const profiles = pick(PROFILE_FAULTS, random)(allProfiles());
  const bundle = roll < 0.12 ? null : bundleOf({ status: roll < 0.3 ? 'SUSPENDED' : 'ACTIVE', profiles, mappings, documentRuleSet: random() < 0.6 ? planningExampleRuleSet() : pick(DOC_FAULTS, random) });
  return { clinic: clinicOf(bundle, { lines, baseFeeLines }), extraBundles: random() < 0.3 ? [bundleOf({ id: 'TEST_BUNDLE_EXTRA', status: random() < 0.5 ? 'SUSPENDED' : 'ACTIVE' })] : [] };
}

describe(`AC-011l (1) 출력 문자열 전체에 합친 "준비 완료" 표현이 없다 (고정 시드 상태 조합, seed=${SEED}, 시행 ${TRIALS}회)`, () => {
  beforeAll(() => {
    console.info(`AC-011l 출력 문자열 시험: seed=${SEED}, 시행 수=${TRIALS}`);
  });

  it('금지 표현의 정규식이 실제로 합친 표현을 잡는다 (빈 시험 방지)', () => {
    for (const sample of ['병원 준비 완료', '운영 준비됨', 'Fully Ready', 'overall ready', 'clinicReady', 'all-ready', 'hospital_ready', 'ready to operate', 'go live']) {
      expect(sample, sample).toMatch(MERGED_PHRASE);
    }
    for (const sample of ['calculationReady', 'documentReady', 'READY', 'NOT_READY', 'platformProfile[GEN1_AS/NON_LIFE] READY bundles=TEST_BUNDLE_A']) {
      expect(sample, sample).not.toMatch(MERGED_PHRASE);
    }
  });

  it('렌더된 문자열: 병원마다 calculationReady 15줄과 documentReady 1줄이 따로 있고, 한 줄에 둘이 함께 나오지 않으며, NOT_READY 이면 단계와 코드가 같은 줄에 있다', () => {
    const random = seededRandom(SEED);
    const seen = { calcReady: 0, calcBlocked: 0, docReady: 0, docBlocked: 0 };
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const { clinic, extraBundles } = randomWorld(random);
      const report = computeReadiness(snapshotOf([clinic], extraBundles), TEST_CTX);
      const text = renderReadinessReport(report);
      const where = `시행 ${trial}`;
      expect(text, where).not.toMatch(MERGED_PHRASE);
      const lines = text.split('\n');
      expect(lines.filter((line) => line.includes('calculationReady')), where).toHaveLength(15);
      expect(lines.filter((line) => line.includes('documentReady')), where).toHaveLength(1);
      expect(lines.filter((line) => line.includes('calculationReady') && line.includes('documentReady')), where).toEqual([]);
      for (const line of lines.filter((candidate) => candidate.includes('Ready') && candidate.includes('NOT_READY'))) {
        expect(line, `${where} · ${line}`).toMatch(/stage=(?:S|P|TREATMENT|M|D)/);
        expect(line, `${where} · ${line}`).toMatch(/code=[A-Z_]+|lines=\S+/);
      }
      // 보고 객체의 모든 문자열 값과 키에도 합친 표현이 없다.
      expect(collectStrings(report).filter((s) => MERGED_PHRASE.test(s)), where).toEqual([]);
      const row = report.clinics[0]!;
      seen[row.calculationReady.some((entry) => entry.status === 'READY') ? 'calcReady' : 'calcBlocked'] += 1;
      seen[row.documentReady.status === 'READY' ? 'docReady' : 'docBlocked'] += 1;
    }
    console.info(`AC-011l 출력 문자열 시험 분포 (병원 단위): ${JSON.stringify(seen)}`);
    // 시험이 의미 있으려면 두 값이 서로 다른 조합으로 실제로 나와야 한다.
    for (const [name, count] of Object.entries(seen)) expect(count, `${name} 가 나온 횟수`).toBeGreaterThan(10);
  });

  it('어떤 보고에서도 한 값만으로 병원 전체를 읽을 수 없다: READY 인 calculationReady 가 있어도 documentReady 는 따로 NOT_READY 일 수 있고 그 반대도 있다', () => {
    const random = seededRandom(SEED);
    const combos = new Set<string>();
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const { clinic, extraBundles } = randomWorld(random);
      const row = computeReadiness(snapshotOf([clinic], extraBundles), TEST_CTX).clinics[0] as ClinicReadiness;
      combos.add(`${row.calculationReady.some((entry) => entry.status === 'READY') ? 'C' : '-'}${row.documentReady.status === 'READY' ? 'D' : '-'}`);
    }
    expect([...combos].sort()).toEqual(['--', '-D', 'C-', 'CD']);
  });
});

describe('AC-011l (1) 플랫폼 보기와 빈 저장소의 출력 문자열도 합친 표현이 없다', () => {
  const REPORTS: Array<[string, ReadinessReport]> = [
    ['병원도 묶음도 없는 저장소', computeReadiness({ bundles: [], clinics: [] }, TEST_CTX)],
    ['병원은 있고 범위가 없음', computeReadiness(snapshotOf([clinicOf(null)]), TEST_CTX)],
    ['플랫폼 보기 15칸 READY, 병원은 범위 없음', computeReadiness(snapshotOf([clinicOf(null)], [bundleOf()]), TEST_CTX)],
    ['모두 사용 가능', computeReadiness(snapshotOf([clinicOf(bundleOf())]), TEST_CTX)],
    ['운영 허용 출처의 TEST_FIXTURE 자료', computeReadiness(snapshotOf([clinicOf(bundleOf())]), OPERATING_ONLY_CTX)],
    ['여러 병원', computeReadiness(snapshotOf([clinicOf(bundleOf(), { clinicId: 'TEST_CLINIC_A', slug: 'a' }), clinicOf(null, { clinicId: 'TEST_CLINIC_B', slug: 'b' })]), TEST_CTX)],
  ];
  it.each(REPORTS)('%s', (_name, report) => {
    expect(renderReadinessReport(report)).not.toMatch(MERGED_PHRASE);
    expect(collectStrings(report).filter((s) => MERGED_PHRASE.test(s))).toEqual([]);
    // 표 P 하나만 READY 여도 그 줄이 병원 준비를 뜻하는 표현으로 나오지 않는다.
    const text = renderReadinessReport(report);
    for (const line of text.split('\n').filter((candidate) => candidate.startsWith('platformProfile'))) {
      expect(line).toMatch(/^platformProfile\[[A-Z0-9_./]+\] (?:READY bundles=\S+|NOT_READY code=[A-Z_]+)$/);
    }
  });
});
