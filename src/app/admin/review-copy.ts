// 검토 요청·매핑 검토 화면 문구 (SPEC-REIMBURSEMENT-001 M7 검토 요청·매핑 검토). **시험용 문구이며 최종 문구가 아니다** — 최종 문구 승인이 아니다(plan.md §E 의 관리자 문구는 소유자 확인 전).
// 보험 설명을 새로 쓰지 않는다. 보험 계산 분류의 이름은 기획서(보담_기획설계_v0.2.md 의 "보험 계산 분류": 일반 급여/일반 비급여/3대 비급여/추가 검토 필요)를 그대로 쓴다.
// 요청은 제안 기록일 뿐이다: 이 화면의 어느 문구도 요청이 치료·분류·보험금 계산을 바꾼다고 말하지 않는다.
// 매핑 승인은 검토 기록이다: 어느 문구도 승인이 환자 화면·키오스크 계산에 반영되었다고 말하지 않는다(규칙 묶음 게시는 이 화면의 일이 아니다).

import { ADMIN_COPY } from './copy';

const NOTHING_CHANGED = '요청은 만들어지지 않았고 치료 목록·분류·보험금 계산도 바뀌지 않았습니다. 입력한 내용은 화면에 그대로 남아 있습니다.';

export const REVIEW_COPY = {
  // 병원 관리자: 검토 요청
  title: '보장 검토 요청',
  subtitle: '게시된 치료의 급여 구분·행위 코드·보험 계산 분류를 바꿔야 한다고 생각하면 검토를 요청합니다. 이 화면에서는 요청을 보내고 처리 상태를 읽을 수 있습니다.',
  proposalNote:
    '검토 요청은 제안일 뿐입니다. 요청을 보내도 치료 목록·분류·보험금 계산은 바뀌지 않습니다. 검토 담당자가 요청을 처리하고, 이후 게시에서 반영되기 전까지는 지금 값으로 계산됩니다.',
  loading: ADMIN_COPY.loading,
  unauthenticated: ADMIN_COPY.unauthenticated,
  forbiddenClinic: '이 병원의 검토 요청을 보낼 권한이 없습니다. 병원 관리자 권한이 있는 계정으로 로그인해 주세요.',
  loadFailed: ADMIN_COPY.loadFailed,
  retry: ADMIN_COPY.retry,
  clinicLabel: ADMIN_COPY.clinicLabel,
  sessionAs: ADMIN_COPY.sessionAs,
  listTitle: '게시된 치료',
  emptyList: '게시된 치료가 없습니다.',
  colTreatment: '치료',
  colBenefit: '급여 구분',
  colTreatmentCode: '치료 코드',
  colProcedure: '행위 코드',
  colStatus: '현재 검토 상태',
  colAction: '요청',
  benefit: ADMIN_COPY.benefit,
  nonBenefit: ADMIN_COPY.nonBenefit,
  noProcedure: '없음',
  statusNone: '요청 없음',
  statusRequested: '검토 요청됨 (대기 중)',
  // 승인은 검토 기록이다: 병원 관리자에게 환자 화면에 아직 반영되지 않았다는 말까지 한 문장으로 보인다.
  statusApproved: '검토 승인됨 — 환자 화면에는 아직 반영되지 않았습니다',
  statusRejected: '반려됨',
  rejectionReasonLabel: '반려 사유',
  openForm: '검토 요청',
  openFormLabel: (name: string): string => `${name} 검토 요청`,
  openRequestBlocked: '이미 검토 중인 요청이 있습니다',
  closeForm: '닫기',
  formTitle: (name: string): string => `"${name}" 검토 요청`,
  fieldBenefit: '급여 구분',
  fieldProcedure: '행위 코드 (쉼표로 구분, 비워도 됨)',
  fieldCalcClass: '보험 계산 분류',
  calcClassPlaceholder: '선택해 주세요',
  calcClassRequired: '보험 계산 분류를 골라 주세요.',
  formHint: '제안하는 값을 적어 주세요. 이 값이 바로 적용되지는 않습니다.',
  submit: '검토 요청 보내기',
  sending: '보내는 중입니다…',
  sent: '검토 요청을 보냈습니다. 요청은 제안 기록일 뿐이라 치료 목록·분류·보험금 계산은 바뀌지 않았습니다.',
  historyTitle: '보낸 요청',
  historyNone: '보낸 요청이 없습니다.',
  colRequestedAt: '요청일',
  colProposed: '제안한 값',
  colResult: '처리 상태',
  proposedLine: (benefit: string, codes: string, calcClass: string): string => `${benefit} · 행위 코드 ${codes} · ${calcClass}`,
  nothingChanged: NOTHING_CHANGED,
  errors: {
    alreadyRequested: '이미 검토 중인 요청이 있습니다.',
    notInCatalog: '게시된 치료가 아닙니다.',
    benefitType: '급여 구분 값이 올바르지 않습니다.',
    procedureCodes: '행위 코드에 비어 있거나 공백뿐인 항목이 있습니다.',
    calcClass: '보험 계산 분류를 골라 주세요.',
    generic: '요청을 처리하지 못했습니다. 입력을 확인해 주세요.',
    server: '서버 오류로 처리하지 못했습니다.',
  },
  // 이동
  navTreatments: ADMIN_COPY.title,
  navReviewRequests: '검토 요청',
  navReviewQueue: '검토 대기열',
  navLabel: '관리자 메뉴',
  homeTitle: '보담 관리자',
  homeClinicLine: (clinicId: string): string => `병원 ${clinicId}`,
  homeNoAccess: ADMIN_COPY.forbidden,

  // 검토 담당자: 대기열
  queueTitle: '검토 대기열',
  queueNote: '검토 요청마다 매핑 초안 작성 → 검토 제출 → 다른 검토 담당자의 승인 또는 반려 순서로 처리합니다. 승인은 검토 기록이며 환자 화면에는 반영되지 않습니다.',
  queueEmpty: '처리 전 요청이 없습니다',
  queueForbidden: '검토 담당자만 볼 수 있습니다',
  queueUnauthenticated: ADMIN_COPY.unauthenticated,
  colClinic: '병원',
  colRequestedBy: '요청자',
  colValues: '현재 게시값 / 병원이 제안한 값',
  currentLabel: '현재 게시값',
  proposedLabel: '병원이 제안한 값',
  fieldBenefitShort: '급여 구분',
  fieldProcedureShort: '행위 코드',
  fieldCalcClassShort: '보험 계산 분류',
} as const;

const MAPPING_NOTHING_CHANGED = '저장된 내용은 바뀌지 않았습니다.';

// 매핑 검토 (검토 담당자 대기열 · 이력, 병원 관리자 안내). 시험용 문구다.
export const MAPPING_COPY = {
  // 현재 게시 상태: 네 가지는 서로 다른 말이다. 숨긴 것·읽지 못한 것을 "목록에 없다"고 말하지 않는다.
  currentHidden: '숨긴 치료입니다(현재 게시값 없음)',
  currentNotInCatalog: '현재 게시 목록에 없습니다',
  currentUnreadable: (code: string): string => `현재 게시값을 읽지 못했습니다(오류 코드 ${code}) — 목록에 없다는 뜻이 아닙니다`,

  // 치료 분류 안내
  classificationNeedsReview: '치료 분류 처리가 남아 있습니다. 매핑을 승인해도 분류가 바뀌지 않으므로 이 승인만으로 환자 화면 계산이 가능해지지 않습니다.',
  classificationUnknown: '치료 분류를 읽지 못했습니다(현재 게시값을 읽을 수 없는 상태입니다).',
  haClassificationNeedsReview: '이 치료는 분류 확인이 남아 있습니다. 검토가 승인되어도 분류 처리가 끝나기 전에는 환자 화면 계산이 가능해지지 않습니다.',

  // 반영 안내: 모든 항목에 늘 보인다.
  reflectionNote: '승인은 검토 기록입니다. 환자 화면 반영(규칙 묶음 게시)은 별도 단계이며 여기서는 하지 않습니다.',

  // 처리 단계
  stageTitle: '매핑 처리',
  noMapping: '아직 매핑 초안이 없습니다.',
  draftButton: '매핑 초안 작성',
  draftBlocked: {
    HIDDEN: '숨긴 치료이므로 매핑 초안을 만들 수 없습니다.',
    NOT_IN_CATALOG: '현재 게시 목록에 없는 치료이므로 매핑 초안을 만들 수 없습니다.',
    UNREADABLE: '현재 게시값을 읽지 못해 매핑 초안을 만들 수 없습니다.',
  },
  waitingForAuthor: (authorId: string): string => `작성자 ${authorId} 가 제출하기를 기다립니다`,
  submitButton: '검토 제출',
  approveButton: '승인',
  rejectButton: '반려',
  authorCannotApprove: '본인이 작성한 매핑은 승인할 수 없습니다',
  rejectReasonLabel: '반려 사유 (필수)',
  rejectReasonRequired: '사유를 입력해 주세요',
  rejectConfirm: '반려 확정',
  cancel: '취소',
  busy: '처리하는 중입니다…',
  authorLabel: '작성자',
  decisionLabel: '판정',
  decisionCovered: '보장함',
  decisionExcluded: '보장 제외',
  groupKeyLabel: '그룹 키',
  exclusionReasonLabel: '제외 사유',
  scopeLabel: '적용 범위',
  validityLabel: '유효 기간',
  sourceLabel: '약관 출처',
  basisLabel: '검토 기준',

  // 검토 기준 비교
  basisMatch: '검토 기준과 같음',
  basisMissing: '검토 기준이 기록되지 않음',
  basisUncheckable: '현재 게시값을 읽을 수 없어 검토 기준과 비교하지 못함',
  basisChanged: (fields: string): string => `검토를 시작한 뒤 바뀐 항목: ${fields}`,
  judgmentFields: { treatmentCode: '치료 코드', procedureCodes: '행위 코드', benefitType: '급여 구분', calcClass: '보험 계산 분류' } as const,

  // 승인이 막힌 이유
  approveBlocked: {
    TREATMENT_HIDDEN: '숨긴 치료라서 승인할 수 없습니다. 반려로 요청을 닫을 수 있습니다.',
    TREATMENT_NOT_IN_CATALOG: '현재 게시 목록에 없는 치료라서 승인할 수 없습니다. 반려로 요청을 닫을 수 있습니다.',
    CURRENT_VALUES_UNREADABLE: '현재 게시값을 읽지 못해 승인할 수 없습니다.',
    REVIEW_BASIS_MISSING: '검토 기준이 기록되지 않아 승인할 수 없습니다.',
    REVIEWED_FIELDS_CHANGED: '검토를 시작한 뒤 치료의 보장 판단 항목이 바뀌어 승인할 수 없습니다. 반려로 요청을 닫을 수 있습니다.',
  },
  approveBlockedGeneric: '지금은 승인할 수 없습니다.',

  // 매핑 초안 입력
  formTitle: '매핑 초안 작성',
  formTestData: '입력하는 값은 시험 자료입니다. 실제 보험사 약관 근거가 아니며 환자 화면에는 반영되지 않습니다.',
  formCovered: '보장함',
  formExcluded: '보장 제외',
  fieldDecision: '판정',
  fieldGroupKey: '그룹 키',
  fieldExclusionReason: '제외 사유',
  fieldScope: '적용 범위 (하나 이상 선택)',
  fieldValidFrom: '유효 기간 시작일 (YYYY-MM-DD)',
  fieldValidTo: '유효 기간 종료일 (YYYY-MM-DD)',
  fieldSourceTitle: '약관 출처 (한 건)',
  sourceFields: {
    insurerDocumentId: '보험사 문서 식별',
    revisionDate: '개정일',
    clauseOrPage: '조항 또는 쪽',
    effectiveDate: '효력일',
    verifiedBy: '확인자',
    verifiedAt: '확인일',
  } as const,
  formSubmit: '초안 저장',
  formProblems: {
    scope: '적용 범위를 하나 이상 선택해 주세요.',
    groupKey: '그룹 키를 입력해 주세요.',
    exclusionReason: '제외 사유를 입력해 주세요.',
    validFrom: '유효 기간 시작일을 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.',
    validTo: '유효 기간 종료일을 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.',
    validRange: '유효 기간의 시작일은 종료일보다 늦을 수 없습니다.',
    source: '약관 출처의 모든 칸을 입력해 주세요.',
  },

  // 성공 안내
  success: {
    draft: '매핑 초안을 만들었습니다. 아직 검토에 제출되지 않았습니다.',
    submit: '검토에 제출했습니다. 다른 검토 담당자의 승인 또는 반려를 기다립니다.',
    approve: '승인했습니다. 이 승인은 검토 기록이며 환자 화면에는 아직 반영되지 않았습니다.',
    reject: '반려했습니다. 병원 관리자가 반려 사유를 읽을 수 있습니다.',
  },

  // 거절 안내: 모두 "저장된 내용은 바뀌지 않았습니다"로 끝난다.
  nothingChanged: MAPPING_NOTHING_CHANGED,
  failure: {
    unauthenticated: '로그인이 필요합니다.',
    selfApproval: '본인이 작성한 매핑은 승인할 수 없습니다.',
    notAuthor: '작성자만 검토에 제출할 수 있습니다.',
    forbidden: '검토 담당자 권한이 필요합니다.',
    notFound: '검토 요청 또는 매핑을 찾을 수 없습니다.',
    notLinked: '이 매핑은 이 검토 요청의 매핑이 아닙니다.',
    treatmentMismatch: '매핑과 검토 요청의 치료가 다릅니다.',
    closed: '이 검토 요청은 이미 처리되었습니다.',
    draftExists: '이 검토 요청에는 이미 매핑 초안이 있습니다.',
    transition: '매핑이 현재 단계에서는 이 처리를 할 수 없습니다.',
    versionAbsent: '승인 기준으로 삼을 치료 버전을 찾을 수 없습니다.',
    reasonRequired: '반려 사유를 입력해 주세요.',
    scope: '적용 범위를 하나 이상 선택해 주세요.',
    validity: '유효 기간을 확인해 주세요(YYYY-MM-DD, 시작일이 종료일보다 늦을 수 없습니다).',
    groupKey: '그룹 키를 확인해 주세요(보장함에는 필요하고 보장 제외에는 쓰지 않습니다).',
    exclusionReason: '제외 사유를 확인해 주세요(보장 제외에는 필요하고 보장함에는 쓰지 않습니다).',
    policySource: '약관 출처의 모든 칸을 입력해 주세요.',
    invalid: '입력을 확인해 주세요.',
    server: '서버 오류로 처리하지 못했습니다.',
    generic: '처리하지 못했습니다.',
    conflictGeneric: '현재 상태와 맞지 않아 처리하지 못했습니다.',
  },

  // 처리 완료(이력)
  historyTitle: '처리 완료',
  historyEmpty: '처리 완료된 요청이 없습니다.',
  historyClosedBy: '처리한 사람',
  historyClosedAt: '처리 시각',
  historyResultMapping: '결과 매핑',
  historyNoResultMapping: '없음',
  historyNote: '읽기 전용 기록입니다.',
  sessionAs: '로그인한 사용자',
} as const;
