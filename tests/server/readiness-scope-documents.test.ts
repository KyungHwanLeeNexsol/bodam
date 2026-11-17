import { describe, expect, it } from 'vitest';
import { deriveDocuments, selectDocumentRuleSet } from '../../src/engine/documents';
import { documentRuleSetToRuleItem, isBundleUsable, isUsable } from '../../src/engine/usability';
import type { DocumentRuleSet, LifecycleState, RuleBundleSnapshot } from '../../src/engine/types';
import { computeReadiness } from '../../src/server/readiness';
import type { ClinicReadiness, ReadinessClinicInput, ReadinessContext } from '../../src/server/readiness';
import { planningExampleRuleSet, ruleSetOf, rule } from '../fixtures/engine/document-rules.fixture';
import { testPolicySource } from '../fixtures/engine/profiles.fixture';
import { ALL_CELLS, OPERATING_ONLY_CTX, TEST_CTX, bundleOf, clinicOf, estimateFor, snapshotOf } from '../fixtures/server/readiness.fixture';

// AC-011k 표 S(규칙 사용 범위와 묶음 상태)와 표 D(서류 규칙), design.md DD-23.
// 표 S 의 값은 isBundleUsable 의 결과 그대로이고, 표 D 의 판정은 selectDocumentRuleSet 의 결과 그대로다.
// 표 D 의 세부 사유(보고용)는 ItemUsabilityReason 이며 엔진의 isUsable 이 낸 사유와도 맞춘다.

const reportOf = (clinic: ReadinessClinicInput, ctx: ReadinessContext = TEST_CTX): ClinicReadiness => computeReadiness(snapshotOf([clinic]), ctx).clinics[0]!;

describe('AC-011k 표 S', () => {
  it('규칙 사용 범위 없음: SCOPE_ABSENT → CLINIC_RULE_SCOPE_ABSENT, 묶음 정보 없음', () => {
    const gate = isBundleUsable(null);
    expect(gate).toEqual({ usable: false, reason: 'SCOPE_ABSENT' });
    expect(reportOf(clinicOf(null)).scope).toEqual({ status: 'NOT_READY', value: 'SCOPE_ABSENT', code: 'CLINIC_RULE_SCOPE_ABSENT', bundleId: null, contentHash: null });
  });

  it('묶음 SUSPENDED: BUNDLE_SUSPENDED → RULE_BUNDLE_SUSPENDED, 묶음 id·내용 해시는 그대로 나온다', () => {
    const active = bundleOf({ id: 'TEST_BUNDLE_S', contentHash: 'TEST_HASH_S' });
    const suspended: RuleBundleSnapshot = { ...active, status: 'SUSPENDED' };
    expect(isBundleUsable(suspended)).toEqual({ usable: false, reason: 'BUNDLE_SUSPENDED' });
    expect(reportOf(clinicOf(suspended)).scope).toEqual({ status: 'NOT_READY', value: 'BUNDLE_SUSPENDED', code: 'RULE_BUNDLE_SUSPENDED', bundleId: 'TEST_BUNDLE_S', contentHash: 'TEST_HASH_S' });
    // 중지 전후로 묶음 id·내용 해시는 같다.
    const before = reportOf(clinicOf(active)).scope;
    const after = reportOf(clinicOf(suspended)).scope;
    expect(before).toMatchObject({ bundleId: 'TEST_BUNDLE_S', contentHash: 'TEST_HASH_S' });
    expect(after).toMatchObject({ bundleId: before.bundleId, contentHash: before.contentHash });
  });

  it('ACTIVE 만 READY 이고 묶음 id와 내용 해시를 함께 낸다', () => {
    expect(reportOf(clinicOf(bundleOf({ id: 'TEST_BUNDLE_S', contentHash: 'TEST_HASH_S' }))).scope).toEqual({
      status: 'READY',
      value: 'ACTIVE',
      bundleId: 'TEST_BUNDLE_S',
      contentHash: 'TEST_HASH_S',
    });
  });

  it('알 수 없는 status 값은 ACTIVE 로 추정하지 않는다 (isBundleUsable 의 판정 그대로)', () => {
    const odd = { ...bundleOf(), status: 'ARCHIVED' } as unknown as RuleBundleSnapshot;
    expect(isBundleUsable(odd).usable).toBe(false);
    expect(reportOf(clinicOf(odd)).scope).toMatchObject({ status: 'NOT_READY', value: 'BUNDLE_SUSPENDED', code: 'RULE_BUNDLE_SUSPENDED' });
  });
});

// ───────────────────────── 표 D ─────────────────────────

const base = (): DocumentRuleSet => planningExampleRuleSet();
const withState = (state: LifecycleState): DocumentRuleSet => ({ ...base(), state });

/** [이름, 기대 세부 사유, 서류 규칙 묶음, 구성]. 세부 사유는 AC-011k 가 든 목록이다. 헤더 변경은 내용 해시를 건드리지 않는다. */
const DOCUMENT_VARIANTS: Array<[string, string, DocumentRuleSet | null, ReadinessContext]> = [
  ['묶음에 서류 규칙 묶음이 없음', 'SET_ABSENT', null, TEST_CTX],
  ['운영 허용 출처에서의 TEST_FIXTURE', 'ORIGIN_NOT_ACCEPTED', base(), OPERATING_ONLY_CTX],
  ['상태 DRAFT', 'STATE_DRAFT', withState('DRAFT'), TEST_CTX],
  ['상태 REVIEW_REQUESTED', 'STATE_UNAPPROVED', withState('REVIEW_REQUESTED'), TEST_CTX],
  ['상태 APPROVED(미게시)', 'STATE_UNAPPROVED', withState('APPROVED'), TEST_CTX],
  ['상태 REJECTED', 'STATE_REJECTED', withState('REJECTED'), TEST_CTX],
  ['상태 UNDER_REREVIEW', 'STATE_UNDER_REREVIEW', withState('UNDER_REREVIEW'), TEST_CTX],
  ['상태 SUPERSEDED', 'STATE_INVALID', withState('SUPERSEDED'), TEST_CTX],
  ['상태 EXPIRED', 'STATE_INVALID', withState('EXPIRED'), TEST_CTX],
  ['상태 SUSPENDED', 'STATE_INVALID', withState('SUSPENDED'), TEST_CTX],
  ['유효 기간 밖', 'OUTSIDE_VALIDITY', { ...base(), validity: { from: '2025-01-01', to: '2025-12-31' } }, TEST_CTX],
  ['약관 출처 누락', 'SOURCE_INCOMPLETE', { ...base(), policySources: [{ ...testPolicySource('DOC'), clauseOrPage: '' }] }, TEST_CTX],
  ['승인자 누락', 'APPROVER_MISSING', { ...base(), approver: null }, TEST_CTX],
  ['내용 해시 불일치', 'INTEGRITY_MISMATCH', { ...base(), contentHash: 'TEST_DIGEST_00000000' }, TEST_CTX],
  [
    '구조 결함(해시는 맞음)',
    'SET_STRUCTURE_INVALID',
    ruleSetOf([rule('NOT_A_DOCUMENT_CODE' as unknown as 'RECEIPT', {}, '시험 문장', 1)]),
    TEST_CTX,
  ],
];

describe('AC-011k 표 D: 표 S 가 ACTIVE 이고 서류 규칙 묶음이 사용 가능할 때만 READY', () => {
  it('사용 가능한 서류 규칙 묶음이면 READY 이고 묶음 id와 버전을 낸다', () => {
    const set = base();
    expect(reportOf(clinicOf(bundleOf({ documentRuleSet: set }))).documents).toEqual({ status: 'READY', ruleSetId: set.id, ruleSetVersion: set.version });
  });

  it.each(DOCUMENT_VARIANTS)('%s → NOT_READY, 사유 RULES_UNAVAILABLE, 세부 %s', (_name, detail, ruleSet, ctx) => {
    const bundle = bundleOf({ documentRuleSet: ruleSet });
    const clinic = clinicOf(bundle);
    const report = reportOf(clinic, ctx);
    expect(report.documents).toEqual({ status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail });
    expect(report.documentReady).toEqual({ status: 'NOT_READY', stage: 'D', code: 'RULES_UNAVAILABLE', detail });

    // 항목 단계 사유는 엔진의 isUsable 이 낸 사유와 같다.
    if (ruleSet !== null && detail !== 'SET_STRUCTURE_INVALID') {
      const verdict = isUsable(documentRuleSetToRuleItem(ruleSet), { at: ctx.at, acceptedOrigins: ctx.acceptedOrigins.rules, digest: ctx.digest });
      expect(verdict).toEqual({ usable: false, reason: detail });
    }

    // 같은 입력의 서류 산출과 맞춘다 (AC-007d): 계산이 ON_HOLD 가 아니고 서류 규칙 묶음을 쓸 수 없으면 RULES_UNAVAILABLE.
    const est = estimateFor(clinic, ALL_CELLS[0]!, ctx);
    const overallState = est === null || est.state === 'ON_HOLD' ? 'ESTIMATED' : est.state;
    const derived = deriveDocuments({
      overallState,
      cause: 'UNKNOWN',
      insurerType: 'NON_LIFE',
      treatments: clinic.lines.map((line) => ({ documentFlags: line.documentFlags })),
      clinicSetting: 'OUTPATIENT_ONLY',
      ruleSet: selectDocumentRuleSet(bundle, { at: ctx.at, acceptedOrigins: ctx.acceptedOrigins.rules, digest: ctx.digest }),
    });
    expect(derived).toEqual({ state: 'RULES_UNAVAILABLE' });
  });

  it('사용 가능한 서류 규칙 묶음이면 서류 산출도 AVAILABLE 이다 (READY 와 일치)', () => {
    const bundle = bundleOf();
    const clinic = clinicOf(bundle);
    const est = estimateFor(clinic, ALL_CELLS[0]!, TEST_CTX)!;
    expect(est.state).not.toBe('ON_HOLD');
    const derived = deriveDocuments({
      overallState: est.state,
      cause: 'UNKNOWN',
      insurerType: 'NON_LIFE',
      treatments: clinic.lines.map((line) => ({ documentFlags: line.documentFlags })),
      clinicSetting: 'OUTPATIENT_ONLY',
      ruleSet: selectDocumentRuleSet(bundle, { at: TEST_CTX.at, acceptedOrigins: TEST_CTX.acceptedOrigins.rules, digest: TEST_CTX.digest }),
    });
    expect(derived?.state).toBe('AVAILABLE');
    expect(reportOf(clinic).documents.status).toBe('READY');
  });

  it('서류 규칙 묶음이 객체가 아닌 값(문자열·배열)이어도 던지지 않고 SET_ABSENT 로 본다', () => {
    for (const odd of ['TEST_NOT_A_SET', []]) {
      const report = reportOf(clinicOf(bundleOf({ documentRuleSet: odd as unknown as DocumentRuleSet })));
      expect(report.documents).toEqual({ status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail: 'SET_ABSENT' });
    }
  });

  it('표 S 가 ACTIVE 가 아니면 서류 규칙 묶음이 아무리 좋아도 표 D 는 NOT_READY 이고 세부 사유는 묶음 단계다', () => {
    const good = base();
    expect(reportOf(clinicOf(null)).documents).toEqual({ status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail: 'SCOPE_ABSENT' });
    expect(reportOf(clinicOf(bundleOf({ documentRuleSet: good, status: 'SUSPENDED' }))).documents).toEqual({
      status: 'NOT_READY',
      code: 'RULES_UNAVAILABLE',
      detail: 'BUNDLE_SUSPENDED',
    });
    // 묶음이 중지면 서류 규칙 묶음이 사용 불가여도 묶음 단계가 먼저다 (selectDocumentRuleSet 의 순서: 묶음 → 항목).
    expect(reportOf(clinicOf(bundleOf({ documentRuleSet: withState('DRAFT'), status: 'SUSPENDED' }))).documents).toMatchObject({ detail: 'BUNDLE_SUSPENDED' });
  });

  it('documentReady 는 표 S 와 표 D 에서 유도된다: 막힌 단계(S 또는 D)와 그 코드를 함께 낸다', () => {
    expect(reportOf(clinicOf(null)).documentReady).toEqual({ status: 'NOT_READY', stage: 'S', code: 'CLINIC_RULE_SCOPE_ABSENT' });
    expect(reportOf(clinicOf(bundleOf({ status: 'SUSPENDED' }))).documentReady).toEqual({ status: 'NOT_READY', stage: 'S', code: 'RULE_BUNDLE_SUSPENDED' });
    expect(reportOf(clinicOf(bundleOf())).documentReady).toEqual({ status: 'READY' });
  });
});

describe('AC-011k 병원마다 독립이다', () => {
  it('한 병원의 묶음 중지가 그 묶음을 쓰지 않는 병원의 행을 바꾸지 않는다', () => {
    const bundleA = bundleOf({ id: 'TEST_BUNDLE_A' });
    const bundleB = bundleOf({ id: 'TEST_BUNDLE_B' });
    const clinicA = clinicOf(bundleA, { clinicId: 'TEST_CLINIC_A', slug: 'a' });
    const clinicB = clinicOf(bundleB, { clinicId: 'TEST_CLINIC_B', slug: 'b' });
    const before = computeReadiness(snapshotOf([clinicA, clinicB]), TEST_CTX);
    const after = computeReadiness(snapshotOf([{ ...clinicA, bundle: { ...bundleA, status: 'SUSPENDED' } }, clinicB]), TEST_CTX);
    const pick = (report: typeof before, id: string) => report.clinics.find((clinic) => clinic.clinicId === id)!;
    expect(pick(after, 'TEST_CLINIC_B')).toEqual(pick(before, 'TEST_CLINIC_B'));
    expect(pick(before, 'TEST_CLINIC_A').scope.status).toBe('READY');
    expect(pick(after, 'TEST_CLINIC_A').scope).toMatchObject({ status: 'NOT_READY', code: 'RULE_BUNDLE_SUSPENDED' });
    expect(pick(after, 'TEST_CLINIC_A').documents).toMatchObject({ status: 'NOT_READY', detail: 'BUNDLE_SUSPENDED' });
    expect(pick(after, 'TEST_CLINIC_B').documents.status).toBe('READY');
  });

  it('같은 묶음을 쓰는 두 병원은 같은 판정을 받는다', () => {
    const shared = bundleOf({ status: 'SUSPENDED' });
    const report = computeReadiness(snapshotOf([clinicOf(shared, { clinicId: 'TEST_CLINIC_A', slug: 'a' }), clinicOf(shared, { clinicId: 'TEST_CLINIC_B', slug: 'b' })]), TEST_CTX);
    const [a, b] = report.clinics;
    expect({ ...a!, clinicId: '', slug: '' }).toEqual({ ...b!, clinicId: '', slug: '' });
  });
});
