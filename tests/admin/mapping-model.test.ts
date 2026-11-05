import { describe, expect, it } from 'vitest';
import { MAPPING_COPY } from '../../src/app/admin/review-copy';
import {
  GENERATION_CHOICES,
  INSURER_TYPE_CHOICES,
  approveBlockedText,
  basisText,
  classificationNotice,
  currentStateDisplay,
  haClassificationNotice,
  initialMappingForm,
  mappingBodyOf,
  mappingFailureMessage,
  mappingSuccessMessage,
  rejectReasonProblem,
  scopeKey,
  stageOf,
  toggleScope,
} from '../../src/app/admin/mapping-model';
import type { MappingForm } from '../../src/app/admin/mapping-model';
import type { BasisView, CurrentPublishedView, MappingSummaryView, ReviewQueueEntry } from '../../src/app/admin/review-types';

// 매핑 검토 화면의 순수 계산 (화면 코드 밖). 시험 자료(TEST_FIXTURE)만 쓴다.
// 서버가 권위이다: 이 파일의 판정(버튼이 보이는가·눌리는가)은 화면의 안내일 뿐이고, 서버가 같은 규칙을 다시 본다.

const AUTHOR = 'TEST_FIXTURE_RV_PERSON_1';
const OTHER = 'TEST_FIXTURE_RV_PERSON_2';

const mapping = (lifecycle: MappingSummaryView['lifecycle'], authorId = AUTHOR): MappingSummaryView => ({
  ref: { kind: 'MAPPING', id: 'TEST_FIXTURE_MAPPING_1', version: '1' },
  authorId,
  createdAt: '2026-11-01T01:00:00.000Z',
  lifecycle,
  decision: 'COVERED',
  scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
  groupKey: 'TEST_FIXTURE_GROUP',
  exclusionReason: null,
  validity: { from: '2026-01-01', to: '2026-12-31' },
  policySources: [],
});

const PUBLISHED: CurrentPublishedView = { state: 'PUBLISHED', displayName: 'TEST_FIXTURE 시험 치료 A', treatmentCode: 'TEST_FIXTURE_TC_1', benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A'], calcClass: 'GENERAL_BENEFIT' };
const MATCH: BasisView = { check: 'MATCH', changedFields: [], reviewed: null };

function entry(overrides: Partial<ReviewQueueEntry> = {}): ReviewQueueEntry {
  return {
    id: 'TEST_FIXTURE_REVIEW_REQUEST_1',
    treatmentId: 'TEST_FIXTURE_TREATMENT_1',
    treatmentName: 'TEST_FIXTURE 시험 치료 A',
    proposed: { benefitType: 'BENEFIT', procedureCodes: [], calcClass: 'GENERAL_BENEFIT' },
    status: 'REVIEW_REQUESTED',
    rejectionReason: null,
    requestedAt: '2026-11-01T00:00:00.000Z',
    requestedBy: 'TEST_FIXTURE_HA_CLINIC_1',
    classification: 'CLASSIFIED',
    clinic: { id: 'TEST_FIXTURE_CLINIC_1', name: 'TEST_FIXTURE 시험 의원' },
    current: PUBLISHED,
    mapping: null,
    basis: MATCH,
    approvalBlockedReason: null,
    ...overrides,
  };
}

const reply = (status: number, body: unknown) => ({ status, body: body as never });

describe('currentStateDisplay: 현재 게시 상태 네 가지는 서로 다른 말이다', () => {
  it('PUBLISHED 는 값이 있고 문구가 없다', () => {
    expect(currentStateDisplay(PUBLISHED)).toEqual({ state: 'PUBLISHED', text: null });
  });

  it('HIDDEN 은 숨긴 치료 문구다', () => {
    expect(currentStateDisplay({ state: 'HIDDEN' })).toEqual({ state: 'HIDDEN', text: '숨긴 치료입니다(현재 게시값 없음)' });
  });

  it('NOT_IN_CATALOG 는 목록에 없다는 문구다', () => {
    expect(currentStateDisplay({ state: 'NOT_IN_CATALOG' })).toEqual({ state: 'NOT_IN_CATALOG', text: '현재 게시 목록에 없습니다' });
  });

  it('UNREADABLE 은 오류 코드를 보이고 "목록에 없다는 뜻이 아님"을 말한다', () => {
    expect(currentStateDisplay({ state: 'UNREADABLE', defectCode: 'TREATMENT_VERSION_MISSING' })).toEqual({
      state: 'UNREADABLE',
      text: '현재 게시값을 읽지 못했습니다(오류 코드 TREATMENT_VERSION_MISSING) — 목록에 없다는 뜻이 아닙니다',
    });
  });

  it('HIDDEN 과 UNREADABLE 의 문구는 어디에도 "목록에 없습니다"가 아니다 — 읽지 못한 것·숨긴 것을 목록에 없다고 말하지 않는다', () => {
    const notInList = currentStateDisplay({ state: 'NOT_IN_CATALOG' }).text as string;
    const hidden = currentStateDisplay({ state: 'HIDDEN' }).text as string;
    const unreadable = currentStateDisplay({ state: 'UNREADABLE', defectCode: 'TREATMENT_MISSING' }).text as string;
    expect(hidden).not.toBe(notInList);
    expect(unreadable).not.toBe(notInList);
    expect(hidden).not.toContain(notInList);
    expect(hidden).not.toContain('목록에 없');
    // 읽지 못함의 문구에서 "목록에 없"은 부정("없다는 뜻이 아닙니다")으로만 나온다.
    expect(unreadable.replace('목록에 없다는 뜻이 아닙니다', '')).not.toContain('목록에 없');
    expect(unreadable).not.toContain(notInList);
  });
});

describe('classificationNotice: 치료 분류 안내', () => {
  it('분류 확인 필요는 승인해도 분류가 바뀌지 않아 환자 화면 계산이 가능해지지 않는다고 말한다', () => {
    expect(classificationNotice('NEEDS_REVIEW')).toBe('치료 분류 처리가 남아 있습니다. 매핑을 승인해도 분류가 바뀌지 않으므로 이 승인만으로 환자 화면 계산이 가능해지지 않습니다.');
  });

  it('읽지 못한 분류(UNKNOWN)는 읽지 못했다고 말하고, 분류가 정해진 치료는 안내가 없다', () => {
    expect(classificationNotice('UNKNOWN')).toContain('읽지 못');
    expect(classificationNotice('CLASSIFIED')).toBeNull();
  });

  it('병원 관리자 쪽 안내는 열린 요청과 승인된 요청의 분류 확인 필요에만 나온다', () => {
    expect(haClassificationNotice({ status: 'REVIEW_REQUESTED', classification: 'NEEDS_REVIEW' })).toBe(MAPPING_COPY.haClassificationNeedsReview);
    expect(haClassificationNotice({ status: 'APPROVED', classification: 'NEEDS_REVIEW' })).toBe(MAPPING_COPY.haClassificationNeedsReview);
    expect(haClassificationNotice({ status: 'REJECTED', classification: 'NEEDS_REVIEW' })).toBeNull();
    expect(haClassificationNotice({ status: 'APPROVED', classification: 'CLASSIFIED' })).toBeNull();
    expect(haClassificationNotice({ status: 'REVIEW_REQUESTED', classification: 'UNKNOWN' })).toBeNull();
  });
});

describe('basisText: 검토 기준 비교 문구', () => {
  it('네 가지가 서로 다르다', () => {
    expect(basisText({ check: 'MATCH', changedFields: [], reviewed: null })).toBe('검토 기준과 같음');
    expect(basisText({ check: 'MISSING', changedFields: [], reviewed: null })).toBe('검토 기준이 기록되지 않음');
    expect(basisText({ check: 'UNCHECKABLE', changedFields: [], reviewed: null })).toContain('비교하지 못');
  });

  it('CHANGED 는 바뀐 항목을 사람이 읽는 이름으로 나열한다', () => {
    const text = basisText({ check: 'CHANGED', changedFields: ['procedureCodes', 'calcClass'], reviewed: null });
    expect(text).toContain('행위 코드');
    expect(text).toContain('보험 계산 분류');
    expect(text).not.toContain('procedureCodes');
  });
});

describe('approveBlockedText: 승인이 막힌 이유', () => {
  it.each(['TREATMENT_HIDDEN', 'TREATMENT_NOT_IN_CATALOG', 'CURRENT_VALUES_UNREADABLE', 'REVIEW_BASIS_MISSING', 'REVIEWED_FIELDS_CHANGED'])('%s 는 사람이 읽는 문장이고 코드를 보이지 않는다', (code) => {
    const text = approveBlockedText(code);
    expect(text).not.toContain(code);
    expect(text).toContain('승인할 수 없');
  });

  it('모르는 코드도 일반 문장으로 막는다 (코드를 그대로 보이지 않는다)', () => {
    expect(approveBlockedText('SOMETHING_NEW')).not.toContain('SOMETHING_NEW');
  });
});

describe('stageOf: 매핑 처리 단계와 단추', () => {
  it('매핑이 없고 현재 게시 상태가 PUBLISHED 이면 초안 작성이 가능하다', () => {
    expect(stageOf(entry(), OTHER)).toMatchObject({ kind: 'NO_MAPPING', canDraft: true, draftBlockedText: null, canSubmit: false, showApprove: false, canReject: false });
  });

  it.each([
    ['HIDDEN', { state: 'HIDDEN' } as CurrentPublishedView, '숨긴 치료'],
    ['NOT_IN_CATALOG', { state: 'NOT_IN_CATALOG' } as CurrentPublishedView, '목록에 없'],
    ['UNREADABLE', { state: 'UNREADABLE', defectCode: 'TREATMENT_MISSING' } as CurrentPublishedView, '읽지 못'],
  ])('매핑이 없어도 현재 게시 상태가 %s 이면 초안 작성이 막히고 이유 문장이 있다', (_name, current, reason) => {
    const stage = stageOf(entry({ current }), OTHER);
    expect(stage.canDraft).toBe(false);
    expect(stage.draftBlockedText).toContain(reason);
  });

  it('DRAFT: 작성자에게는 검토 제출이, 다른 RV 에게는 작성자를 기다리는 문장이 보인다. 승인·반려는 없다', () => {
    const own = stageOf(entry({ mapping: mapping('DRAFT') }), AUTHOR);
    expect(own).toMatchObject({ kind: 'DRAFT', canSubmit: true, waitingForAuthor: null, showApprove: false, canReject: false });
    const other = stageOf(entry({ mapping: mapping('DRAFT') }), OTHER);
    expect(other).toMatchObject({ kind: 'DRAFT', canSubmit: false, waitingForAuthor: AUTHOR, showApprove: false, canReject: false });
  });

  it('REVIEW_REQUESTED: 작성자 본인에게는 승인 단추가 없고 안내만 있다. 반려는 본인도 할 수 있다', () => {
    const stage = stageOf(entry({ mapping: mapping('REVIEW_REQUESTED') }), AUTHOR);
    expect(stage).toMatchObject({ kind: 'REVIEW', showApprove: false, approveEnabled: false, authorCannotApprove: true, canReject: true, canSubmit: false });
  });

  it('REVIEW_REQUESTED: 다른 RV 에게는 승인 단추가 있고, 승인 차단 사유가 없으면 눌린다', () => {
    const stage = stageOf(entry({ mapping: mapping('REVIEW_REQUESTED') }), OTHER);
    expect(stage).toMatchObject({ kind: 'REVIEW', showApprove: true, approveEnabled: true, approveBlockedText: null, authorCannotApprove: false, canReject: true });
  });

  it('REVIEW_REQUESTED: 승인 차단 사유가 있으면 승인은 보이되 눌리지 않고 이유 문장이 붙는다. 반려는 계속 된다', () => {
    const stage = stageOf(entry({ mapping: mapping('REVIEW_REQUESTED'), approvalBlockedReason: 'TREATMENT_HIDDEN', current: { state: 'HIDDEN' } }), OTHER);
    expect(stage.showApprove).toBe(true);
    expect(stage.approveEnabled).toBe(false);
    expect(stage.approveBlockedText).toBe(approveBlockedText('TREATMENT_HIDDEN'));
    expect(stage.canReject).toBe(true);
  });

  it('로그인 사용자를 모르면(null) 작성자가 아닌 것으로 본다 — 안내일 뿐이고 서버가 다시 거절한다', () => {
    const stage = stageOf(entry({ mapping: mapping('REVIEW_REQUESTED') }), null);
    expect(stage.authorCannotApprove).toBe(false);
    expect(stage.showApprove).toBe(true);
  });

  it('이미 처리된 매핑(APPROVED 등)은 CLOSED 이고 어떤 단추도 없다', () => {
    expect(stageOf(entry({ mapping: mapping('APPROVED'), status: 'APPROVED' }), OTHER)).toMatchObject({ kind: 'CLOSED', canDraft: false, canSubmit: false, showApprove: false, canReject: false });
  });
});

describe('rejectReasonProblem: 반려 사유는 필수이다', () => {
  it('비었거나 공백뿐이면 안내 문장을 낸다 (서버도 막는다)', () => {
    expect(rejectReasonProblem('')).toBe('사유를 입력해 주세요');
    expect(rejectReasonProblem('   \n\t')).toBe('사유를 입력해 주세요');
    expect(rejectReasonProblem('TEST_FIXTURE 사유')).toBeNull();
  });
});

describe('매핑 초안 입력 → 요청 본문', () => {
  const filled = (overrides: Partial<MappingForm> = {}): MappingForm => ({
    ...initialMappingForm(),
    groupKey: ' TEST_FIXTURE_GROUP ',
    scope: [scopeKey('GEN4_C4', 'NON_LIFE')],
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    source: { insurerDocumentId: 'TEST_FIXTURE_DOC', revisionDate: '2026-01-01', clauseOrPage: 'TEST_FIXTURE_P1', effectiveDate: '2026-01-01', verifiedBy: 'TEST_FIXTURE_V', verifiedAt: '2026-01-02' },
    ...overrides,
  });

  it('선택지: 세대 다섯 × 보험사 형태 셋', () => {
    expect(GENERATION_CHOICES.map((choice) => choice.code)).toEqual(['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4']);
    expect(INSURER_TYPE_CHOICES.map((choice) => choice.code)).toEqual(['NON_LIFE', 'LIFE', 'MUTUAL_AID']);
  });

  it('처음 상태는 보장함(COVERED)이고 범위는 비어 있다', () => {
    expect(initialMappingForm()).toMatchObject({ decision: 'COVERED', scope: [], groupKey: '', exclusionReason: '' });
  });

  it('COVERED: 그룹 키(다듬음)를 싣고 제외 사유는 입력칸에 남아 있어도 싣지 않는다', () => {
    const result = mappingBodyOf(filled({ exclusionReason: '남은 값' }));
    expect(result).toEqual({
      ok: true,
      body: {
        mapping: {
          scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
          decision: 'COVERED',
          groupKey: 'TEST_FIXTURE_GROUP',
          validity: { from: '2026-01-01', to: '2026-12-31' },
          policySources: [{ insurerDocumentId: 'TEST_FIXTURE_DOC', revisionDate: '2026-01-01', clauseOrPage: 'TEST_FIXTURE_P1', effectiveDate: '2026-01-01', verifiedBy: 'TEST_FIXTURE_V', verifiedAt: '2026-01-02' }],
        },
      },
    });
  });

  it('EXCLUDED: 제외 사유를 싣고 그룹 키는 입력칸에 남아 있어도 싣지 않는다', () => {
    const result = mappingBodyOf(filled({ decision: 'EXCLUDED', exclusionReason: ' TEST_FIXTURE 제외 ' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.mapping).toMatchObject({ decision: 'EXCLUDED', exclusionReason: 'TEST_FIXTURE 제외' });
    expect('groupKey' in result.body.mapping).toBe(false);
  });

  it('범위는 세대 × 보험사 형태 목록의 순서로 낸다 (체크한 순서와 무관)', () => {
    const result = mappingBodyOf(filled({ scope: [scopeKey('GEN4_C4', 'LIFE'), scopeKey('GEN1_AS', 'NON_LIFE'), scopeKey('GEN4_C4', 'NON_LIFE')] }));
    expect(result.ok && result.body.mapping.scope).toEqual([
      { generation: 'GEN1_AS', insurerType: 'NON_LIFE' },
      { generation: 'GEN4_C4', insurerType: 'NON_LIFE' },
      { generation: 'GEN4_C4', insurerType: 'LIFE' },
    ]);
  });

  it('범위 칸을 켜고 끈다', () => {
    const on = toggleScope(initialMappingForm(), scopeKey('GEN3_C3', 'LIFE'));
    expect(on.scope).toEqual([scopeKey('GEN3_C3', 'LIFE')]);
    expect(toggleScope(on, scopeKey('GEN3_C3', 'LIFE')).scope).toEqual([]);
  });

  it.each([
    ['범위가 하나도 없음', { scope: [] }, 'scope'],
    ['COVERED 인데 그룹 키가 공백뿐', { groupKey: '   ' }, 'groupKey'],
    ['EXCLUDED 인데 제외 사유가 비어 있음', { decision: 'EXCLUDED' as const, exclusionReason: '' }, 'exclusionReason'],
    ['시작일이 비어 있음', { validFrom: '' }, 'validFrom'],
    ['종료일이 달력에 없는 날짜', { validTo: '2026-02-30' }, 'validTo'],
    ['시작일이 종료일보다 늦음', { validFrom: '2026-12-31', validTo: '2026-01-01' }, 'validRange'],
    ['약관 출처 문서 id 가 비어 있음', { source: { ...filled().source, insurerDocumentId: ' ' } }, 'source.insurerDocumentId'],
    ['약관 출처 확인일이 비어 있음', { source: { ...filled().source, verifiedAt: '' } }, 'source.verifiedAt'],
  ])('화면에서 막는다: %s → %s', (_name, overrides, problem) => {
    const result = mappingBodyOf(filled(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toContain(problem);
  });

  it('문제는 모두 모아 알려 준다', () => {
    const result = mappingBodyOf({ ...initialMappingForm() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual(expect.arrayContaining(['scope', 'groupKey', 'validFrom', 'validTo', 'source.insurerDocumentId', 'source.revisionDate', 'source.clauseOrPage', 'source.effectiveDate', 'source.verifiedBy', 'source.verifiedAt']));
    }
  });
});

describe('mappingFailureMessage: 서버 거절의 모든 사유를 쉬운 문장으로', () => {
  const NOTHING = '저장된 내용은 바뀌지 않았습니다.';
  const RAW_CODES = /[A-Z]{3,}_[A-Z_]+/;

  // [상태, 본문, 문장에 들어 있어야 하는 말]
  const CASES: Array<[number, unknown, string]> = [
    [401, { error: 'UNAUTHENTICATED' }, '로그인'],
    [403, { error: 'FORBIDDEN', reason: 'SELF_APPROVAL_FORBIDDEN' }, '본인이 작성한 매핑은 승인할 수 없'],
    [403, { error: 'FORBIDDEN', reason: 'NOT_ITEM_AUTHOR' }, '작성자만'],
    [403, { error: 'FORBIDDEN' }, '검토 담당자'],
    [404, { error: 'NOT_FOUND' }, '찾을 수 없'],
    [409, { error: 'CONFLICT', reason: 'MAPPING_NOT_LINKED_TO_REQUEST' }, '이 검토 요청의 매핑이 아닙'],
    [409, { error: 'CONFLICT', reason: 'MAPPING_TREATMENT_MISMATCH' }, '치료가 다릅'],
    [409, { error: 'CONFLICT', reason: 'REF_CONTENT_MISMATCH' }, '치료가 다릅'],
    [409, { error: 'CONFLICT', reason: 'REVIEW_REQUEST_CLOSED' }, '이미 처리'],
    [409, { error: 'CONFLICT', reason: 'MAPPING_DRAFT_ALREADY_EXISTS' }, '이미 매핑 초안'],
    [409, { error: 'CONFLICT', reason: 'TRANSITION_NOT_ALLOWED' }, '현재 단계'],
    [409, { error: 'CONFLICT', reason: 'TREATMENT_HIDDEN' }, '숨긴 치료'],
    [409, { error: 'CONFLICT', reason: 'TREATMENT_NOT_IN_CATALOG' }, '게시 목록에 없'],
    [409, { error: 'CONFLICT', reason: 'CURRENT_VALUES_UNREADABLE' }, '읽지 못'],
    [409, { error: 'CONFLICT', reason: 'REVIEW_BASIS_MISSING' }, '검토 기준'],
    [409, { error: 'CONFLICT', reason: 'REVIEWED_FIELDS_CHANGED' }, '바뀌어'],
    [409, { error: 'CONFLICT', reason: 'TREATMENT_VERSION_ABSENT' }, '치료 버전'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'EMPTY', path: 'reason' }] }, '사유'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_MISSING', path: 'reason' }] }, '사유'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'SCOPE_EMPTY', path: 'mapping.scope' }] }, '적용 범위'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'DATE_INVALID', path: 'mapping.validity.from' }] }, '유효 기간'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALIDITY_RANGE_INVALID', path: 'mapping.validity' }] }, '유효 기간'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'GROUP_KEY_REQUIRED', path: 'mapping.groupKey' }] }, '그룹 키'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'EXCLUSION_REASON_REQUIRED', path: 'mapping.exclusionReason' }] }, '제외 사유'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'POLICY_SOURCE_INCOMPLETE', path: 'mapping.policySources[0].clauseOrPage' }] }, '약관 출처'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'POLICY_SOURCES_MISSING', path: 'mapping.policySources' }] }, '약관 출처'],
    [400, { error: 'INVALID_REQUEST', defects: [{ code: 'NOT_JSON', path: 'request' }] }, '입력을 확인'],
    [500, { error: 'INTERNAL_ERROR' }, '서버 오류'],
    [418, {}, '처리하지 못'],
  ];

  it.each(CASES)('%i %j → 쉬운 문장 + 아무것도 바뀌지 않았다는 말', (status, body, expected) => {
    const text = mappingFailureMessage(reply(status, body));
    expect(text).toContain(expected);
    expect(text.endsWith(NOTHING)).toBe(true);
    expect(text).not.toMatch(RAW_CODES);
  });

  it('서로 다른 거절 사유는 서로 다른 문장이다 (409 사유 열두 가지)', () => {
    const reasons = CASES.filter(([status]) => status === 409).map(([, body]) => (body as { reason: string }).reason);
    const texts = reasons.map((reason) => mappingFailureMessage(reply(409, { error: 'CONFLICT', reason })));
    // REF_CONTENT_MISMATCH 와 MAPPING_TREATMENT_MISMATCH 는 같은 말(치료가 다름)이라 한 문장으로 묶인다.
    expect(new Set(texts).size).toBe(reasons.length - 1);
  });

  it('모르는 409 사유도 일반 문장으로 막는다', () => {
    const text = mappingFailureMessage(reply(409, { error: 'CONFLICT', reason: 'SOMETHING_NEW' }));
    expect(text).not.toContain('SOMETHING_NEW');
    expect(text.endsWith(NOTHING)).toBe(true);
  });
});

describe('mappingSuccessMessage', () => {
  it('승인은 검토 기록이며 환자 화면에는 아직 반영되지 않았다고 말한다', () => {
    const text = mappingSuccessMessage('approve');
    expect(text).toContain('검토 기록');
    expect(text).toContain('환자 화면에는 아직 반영되지 않았');
  });

  it('나머지 동작도 문장이 있고 승인 문장과 다르다', () => {
    const texts = (['draft', 'submit', 'reject'] as const).map(mappingSuccessMessage);
    expect(new Set([...texts, mappingSuccessMessage('approve')]).size).toBe(4);
    for (const text of texts) expect(text).not.toContain('반영되었습니다');
  });
});
