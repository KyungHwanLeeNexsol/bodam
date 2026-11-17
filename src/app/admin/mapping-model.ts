import type { ApiFailure } from './api-types';
import { isCalendarDate } from './draft-model';
import { MAPPING_COPY as COPY } from './review-copy';
import type { BasisView, Classification, CurrentPublishedView, Generation, InsurerType, PolicySource, ReviewQueueEntry } from './review-types';
import type { Api } from './transport';

// 매핑 검토 화면의 순수 계산 (SPEC-REIMBURSEMENT-001 M7 매핑 검토). React·네트워크·시계를 쓰지 않는다.
// 서버가 권위이다: 여기서 정하는 "버튼이 보인다·눌린다"는 화면의 안내일 뿐이고, 같은 규칙(본인 승인 금지·작성자만 제출·현재 게시 상태·검토 기준)을 서버가 다시 본다.
// 서버 거절은 쉬운 문장으로 바꾸고 늘 "저장된 내용은 바뀌지 않았습니다"로 끝낸다(원문 코드를 보이지 않는다. 읽지 못함의 오류 코드는 currentStateDisplay 만 보인다).

// ───────────────────────── 현재 게시 상태 · 분류 안내 ─────────────────────────

/** 현재 게시 상태의 표시. 네 상태는 서로 다른 말이다: 숨긴 것·읽지 못한 것을 "목록에 없다"고 말하지 않는다. PUBLISHED 는 값이 있어 문구가 없다. */
export function currentStateDisplay(current: CurrentPublishedView): { state: CurrentPublishedView['state']; text: string | null } {
  switch (current.state) {
    case 'PUBLISHED':
      return { state: 'PUBLISHED', text: null };
    case 'HIDDEN':
      return { state: 'HIDDEN', text: COPY.currentHidden };
    case 'NOT_IN_CATALOG':
      return { state: 'NOT_IN_CATALOG', text: COPY.currentNotInCatalog };
    case 'UNREADABLE':
      return { state: 'UNREADABLE', text: COPY.currentUnreadable(current.defectCode) };
  }
}

/**
 * 검토 담당자 쪽 분류 안내. 분류가 정해진 치료는 안내가 없다.
 * "분류를 읽지 못했습니다"는 현재 게시값을 읽지 못한 경우(UNREADABLE)에만 말한다: 숨긴 치료·목록에 없는 치료도 서버 분류 표지는 UNKNOWN 이지만 읽기 실패가 아니므로
 * 그 이유는 현재 게시 상태 문구(숨긴 치료입니다 / 현재 게시 목록에 없습니다)가 이미 말하고 여기서는 안내를 내지 않는다(숨김을 읽기 실패처럼 보이지 않는다).
 */
export function classificationNotice(classification: Classification, current: CurrentPublishedView): string | null {
  if (classification === 'NEEDS_REVIEW') return COPY.classificationNeedsReview;
  return classification === 'UNKNOWN' && current.state === 'UNREADABLE' ? COPY.classificationUnknown : null;
}

/** 병원 관리자 쪽 분류 안내: 열린 요청과 승인된 요청에서 분류 확인이 남은 치료에만 나온다. */
export function haClassificationNotice(request: { status: 'REVIEW_REQUESTED' | 'APPROVED' | 'REJECTED'; classification: Classification }): string | null {
  return request.classification === 'NEEDS_REVIEW' && (request.status === 'REVIEW_REQUESTED' || request.status === 'APPROVED') ? COPY.haClassificationNeedsReview : null;
}

// ───────────────────────── 검토 기준 · 승인이 막힌 이유 ─────────────────────────

/** 검토 기준 비교 문구. 바뀐 항목은 사람이 읽는 이름으로 나열한다. 비교하지 못한 이유는 현재 게시 상태로 가른다(숨김·목록에 없음은 게시값이 없는 것이고, 읽기 실패와 다르다). */
export function basisText(basis: BasisView, current: CurrentPublishedView): string {
  switch (basis.check) {
    case 'MATCH':
      return COPY.basisMatch;
    case 'MISSING':
      return COPY.basisMissing;
    case 'UNCHECKABLE':
      return current.state === 'UNREADABLE' ? COPY.basisUncheckable : COPY.basisUncheckableNoValue;
    case 'CHANGED': {
      const names = basis.changedFields.map((field) => (COPY.judgmentFields as Record<string, string>)[field] ?? field);
      return COPY.basisChanged(names.join(', '));
    }
  }
}

/** 서버가 알려 준 승인 차단 사유 코드를 문장으로. 모르는 코드는 일반 문장이다(코드를 그대로 보이지 않는다). */
export function approveBlockedText(code: string): string {
  return (COPY.approveBlocked as Record<string, string>)[code] ?? COPY.approveBlockedGeneric;
}

// ───────────────────────── 처리 단계와 단추 ─────────────────────────

export interface StageView {
  kind: 'NO_MAPPING' | 'DRAFT' | 'REVIEW' | 'CLOSED';
  canDraft: boolean;
  draftBlockedText: string | null;
  canSubmit: boolean;
  /** DRAFT 이고 로그인한 사람이 작성자가 아닐 때, 제출을 기다리는 작성자 id. */
  waitingForAuthor: string | null;
  showApprove: boolean;
  approveEnabled: boolean;
  approveBlockedText: string | null;
  /** REVIEW 이고 로그인한 사람이 작성자일 때: 승인 단추 대신 안내만 보인다. */
  authorCannotApprove: boolean;
  /** 반려는 검토 중(REVIEW_REQUESTED)인 매핑에서 어느 검토 담당자든 할 수 있다(도메인이 작성자의 반려도 허용한다). */
  canReject: boolean;
}

const NO_BUTTONS: StageView = {
  kind: 'CLOSED',
  canDraft: false,
  draftBlockedText: null,
  canSubmit: false,
  waitingForAuthor: null,
  showApprove: false,
  approveEnabled: false,
  approveBlockedText: null,
  authorCannotApprove: false,
  canReject: false,
};

/**
 * 한 항목의 매핑 처리 단계와 단추. viewerId 는 /api/admin/session 이 알려 준 로그인 사용자 id 이고, 모르면(null) 작성자가 아닌 것으로 본다 — 안내일 뿐이며 서버가 다시 거절한다.
 */
export function stageOf(entry: ReviewQueueEntry, viewerId: string | null): StageView {
  const mapping = entry.mapping;
  if (mapping === null) {
    if (entry.status !== 'REVIEW_REQUESTED') return NO_BUTTONS;
    const state = entry.current.state;
    const canDraft = state === 'PUBLISHED';
    return { ...NO_BUTTONS, kind: 'NO_MAPPING', canDraft, draftBlockedText: state === 'PUBLISHED' ? null : COPY.draftBlocked[state] };
  }
  const isAuthor = viewerId !== null && viewerId === mapping.authorId;
  if (mapping.lifecycle === 'DRAFT') {
    return { ...NO_BUTTONS, kind: 'DRAFT', canSubmit: isAuthor, waitingForAuthor: isAuthor ? null : mapping.authorId };
  }
  if (mapping.lifecycle === 'REVIEW_REQUESTED') {
    const blocked = entry.approvalBlockedReason;
    return {
      ...NO_BUTTONS,
      kind: 'REVIEW',
      showApprove: !isAuthor,
      approveEnabled: !isAuthor && blocked === null,
      approveBlockedText: !isAuthor && blocked !== null ? approveBlockedText(blocked) : null,
      authorCannotApprove: isAuthor,
      canReject: true,
    };
  }
  return NO_BUTTONS;
}

/** 반려 사유는 필수다(서버도 막는다). 문제가 없으면 null. */
export function rejectReasonProblem(text: string): string | null {
  return text.trim() === '' ? COPY.rejectReasonRequired : null;
}

// ───────────────────────── 매핑 초안 입력 → 요청 본문 ─────────────────────────

export const GENERATION_CHOICES: ReadonlyArray<{ code: Generation; label: string }> = [
  { code: 'GEN1_AS', label: '1세대(A·S)' },
  { code: 'GEN2_C1', label: '2세대(C1)' },
  { code: 'GEN2_5_C2', label: '2.5세대(C2)' },
  { code: 'GEN3_C3', label: '3세대(C3)' },
  { code: 'GEN4_C4', label: '4세대(C4)' },
];

export const INSURER_TYPE_CHOICES: ReadonlyArray<{ code: InsurerType; label: string }> = [
  { code: 'NON_LIFE', label: '손해보험사' },
  { code: 'LIFE', label: '생명보험사' },
  { code: 'MUTUAL_AID', label: '그외 공제 조합' },
];

/** 범위 칸 하나의 키(체크박스 값). */
export const scopeKey = (generation: Generation, insurerType: InsurerType): string => `${generation}|${insurerType}`;

export interface MappingForm {
  decision: 'COVERED' | 'EXCLUDED';
  groupKey: string;
  exclusionReason: string;
  /** 켜 둔 범위 칸의 키 목록. */
  scope: readonly string[];
  validFrom: string;
  validTo: string;
  source: PolicySource;
}

export function initialMappingForm(): MappingForm {
  return {
    decision: 'COVERED',
    groupKey: '',
    exclusionReason: '',
    scope: [],
    validFrom: '',
    validTo: '',
    source: { insurerDocumentId: '', revisionDate: '', clauseOrPage: '', effectiveDate: '', verifiedBy: '', verifiedAt: '' },
  };
}

export function toggleScope(form: MappingForm, key: string): MappingForm {
  return { ...form, scope: form.scope.includes(key) ? form.scope.filter((entry) => entry !== key) : [...form.scope, key] };
}

export interface MappingDraftBody {
  mapping: {
    scope: Array<{ generation: Generation; insurerType: InsurerType }>;
    decision: 'COVERED' | 'EXCLUDED';
    groupKey?: string;
    exclusionReason?: string;
    validity: { from: string; to: string };
    policySources: PolicySource[];
  };
}

/** 화면이 막는 입력 문제. 서버가 같은 검사를 다시 한다. 'source.<칸>' 은 약관 출처의 어느 칸이 빈 것인지다. */
export type MappingProblem = 'scope' | 'groupKey' | 'exclusionReason' | 'validFrom' | 'validTo' | 'validRange' | `source.${keyof PolicySource}`;

const SOURCE_KEYS: ReadonlyArray<keyof PolicySource> = ['insurerDocumentId', 'revisionDate', 'clauseOrPage', 'effectiveDate', 'verifiedBy', 'verifiedAt'];

/**
 * 입력을 요청 본문으로. 앞뒤 공백을 지우고, 판정에 맞지 않는 칸(보장함의 제외 사유, 보장 제외의 그룹 키)은 입력칸에 남아 있어도 싣지 않는다.
 * 범위는 세대 × 보험사 형태 목록의 순서로 낸다. 문제는 모두 모아 알려 준다.
 */
export function mappingBodyOf(form: MappingForm): { ok: true; body: MappingDraftBody } | { ok: false; problems: MappingProblem[] } {
  const problems: MappingProblem[] = [];
  const scope = GENERATION_CHOICES.flatMap((generation) =>
    INSURER_TYPE_CHOICES.filter((insurer) => form.scope.includes(scopeKey(generation.code, insurer.code))).map((insurer) => ({ generation: generation.code, insurerType: insurer.code })),
  );
  if (scope.length === 0) problems.push('scope');
  const groupKey = form.groupKey.trim();
  const exclusionReason = form.exclusionReason.trim();
  if (form.decision === 'COVERED' && groupKey === '') problems.push('groupKey');
  if (form.decision === 'EXCLUDED' && exclusionReason === '') problems.push('exclusionReason');
  const from = form.validFrom.trim();
  const to = form.validTo.trim();
  const fromOk = isCalendarDate(from);
  const toOk = isCalendarDate(to);
  if (!fromOk) problems.push('validFrom');
  if (!toOk) problems.push('validTo');
  if (fromOk && toOk && from > to) problems.push('validRange');
  const source = Object.fromEntries(SOURCE_KEYS.map((key) => [key, form.source[key].trim()])) as unknown as PolicySource;
  for (const key of SOURCE_KEYS) {
    if (source[key] === '') problems.push(`source.${key}`);
  }
  if (problems.length > 0) return { ok: false, problems };
  const mapping: MappingDraftBody['mapping'] = { scope, decision: form.decision, validity: { from, to }, policySources: [source] };
  if (form.decision === 'COVERED') mapping.groupKey = groupKey;
  else mapping.exclusionReason = exclusionReason;
  return { ok: true, body: { mapping } };
}

// ───────────────────────── 안내 문장 ─────────────────────────

export type MappingAction = 'draft' | 'submit' | 'approve' | 'reject';

export const mappingSuccessMessage = (action: MappingAction): string => COPY.success[action];

/** 400 의 결함 경로로 어느 입력의 문제인지 고른다. 모르는 경로는 일반 문장. */
function invalidMessage(failure: ApiFailure): string {
  const paths = (failure.defects ?? []).map((defect) => defect.path);
  const has = (prefix: string): boolean => paths.some((path) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`));
  if (has('reason')) return COPY.failure.reasonRequired;
  if (has('mapping.scope')) return COPY.failure.scope;
  if (has('mapping.validity')) return COPY.failure.validity;
  if (has('mapping.groupKey')) return COPY.failure.groupKey;
  if (has('mapping.exclusionReason')) return COPY.failure.exclusionReason;
  if (has('mapping.policySources')) return COPY.failure.policySource;
  return COPY.failure.invalid;
}

/** 409 의 사유를 문장으로. 초안 작성 중이면 현재 게시 상태 사유를 초안용 문장으로 말한다. */
function conflictMessage(reason: string | undefined, action: MappingAction | undefined): string {
  switch (reason) {
    case 'MAPPING_NOT_LINKED_TO_REQUEST':
      return COPY.failure.notLinked;
    case 'MAPPING_TREATMENT_MISMATCH':
    case 'REF_CONTENT_MISMATCH':
      return COPY.failure.treatmentMismatch;
    case 'REVIEW_REQUEST_CLOSED':
      return COPY.failure.closed;
    case 'MAPPING_DRAFT_ALREADY_EXISTS':
      return COPY.failure.draftExists;
    case 'TRANSITION_NOT_ALLOWED':
      return COPY.failure.transition;
    case 'TREATMENT_VERSION_ABSENT':
      return COPY.failure.versionAbsent;
    case 'TREATMENT_HIDDEN':
      return action === 'draft' ? COPY.draftBlocked.HIDDEN : approveBlockedText(reason);
    case 'TREATMENT_NOT_IN_CATALOG':
      return action === 'draft' ? COPY.draftBlocked.NOT_IN_CATALOG : approveBlockedText(reason);
    case 'CURRENT_VALUES_UNREADABLE':
      return action === 'draft' ? COPY.draftBlocked.UNREADABLE : approveBlockedText(reason);
    case 'REVIEW_BASIS_MISSING':
    case 'REVIEWED_FIELDS_CHANGED':
      return approveBlockedText(reason);
    default:
      return COPY.failure.conflictGeneric;
  }
}

/** 서버 거절을 쉬운 문장으로. 원문 코드를 보이지 않고, 늘 저장된 내용이 바뀌지 않았다는 말로 끝낸다. */
export function mappingFailureMessage(result: Api<unknown>, action?: MappingAction): string {
  const failure = result.body as ApiFailure;
  let core: string;
  switch (result.status) {
    case 401:
      core = COPY.failure.unauthenticated;
      break;
    case 403:
      core = failure.reason === 'SELF_APPROVAL_FORBIDDEN' ? COPY.failure.selfApproval : failure.reason === 'NOT_ITEM_AUTHOR' ? COPY.failure.notAuthor : COPY.failure.forbidden;
      break;
    case 404:
      core = COPY.failure.notFound;
      break;
    case 409:
      core = conflictMessage(failure.reason, action);
      break;
    case 400:
      core = invalidMessage(failure);
      break;
    default:
      core = result.status >= 500 ? COPY.failure.server : COPY.failure.generic;
  }
  return `${core} ${COPY.nothingChanged}`;
}
