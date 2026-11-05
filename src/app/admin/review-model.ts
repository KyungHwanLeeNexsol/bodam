import type { ApiFailure, BenefitType, TreatmentRow } from './api-types';
import { REVIEW_COPY as COPY } from './review-copy';
import type { CalcClass, CurrentPublishedView, CurrentTreatmentView, ProposedValues, ReviewRequestView } from './review-types';
import type { Api } from './transport';

// 검토 요청 화면의 순수 계산 (SPEC-REIMBURSEMENT-001 M7 검토 요청). React·네트워크·시계를 쓰지 않는다.
// 서버가 권위이다: 이 파일은 입력을 요청 본문 모양으로 옮기고(공백 정리까지만), 치료마다 가장 최근 요청을 고르고, 서버 거절을 문장으로 바꾼다.
// 보험 계산 분류를 화면이 정하지 않는다: 사용자가 고른 값을 그대로 제안으로 보낸다.

/** 보험 계산 분류의 선택지. 서버가 받는 네 값이고 이름은 기획서의 "보험 계산 분류"를 그대로 따른다. */
export const CALC_CLASS_CHOICES: ReadonlyArray<{ code: CalcClass; label: string }> = [
  { code: 'GENERAL_BENEFIT', label: '일반 급여' },
  { code: 'GENERAL_NON_BENEFIT', label: '일반 비급여' },
  { code: 'MAJOR_THREE_NON_BENEFIT', label: '3대 비급여' },
  { code: 'NEEDS_REVIEW', label: '추가 검토 필요' },
];

export const calcClassLabel = (code: CalcClass): string => CALC_CLASS_CHOICES.find((choice) => choice.code === code)?.label ?? code;
export const benefitLabel = (type: BenefitType): string => (type === 'BENEFIT' ? COPY.benefit : COPY.nonBenefit);

/** 쉼표로 구분한 행위 코드 글자를 목록으로. 항목 앞뒤 공백을 지우고 빈 항목은 버린다(서버는 공백뿐인 항목을 거절하므로 편의로만 한다). */
export function parseCodesText(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export const codesToText = (codes: readonly string[]): string => codes.join(', ');

/** 입력칸의 값. calcClass 가 빈 글자면 아직 고르지 않은 것이다. */
export interface ReviewForm {
  benefitType: BenefitType;
  codesText: string;
  calcClass: CalcClass | '';
}

/** 급여 구분과 행위 코드는 치료의 지금 값으로 채운다. 보험 계산 분류의 지금 값은 병원 관리자 응답에 없으므로 고르지 않은 상태로 둔다. */
export function initialReviewForm(treatment: TreatmentRow): ReviewForm {
  return { benefitType: treatment.benefitType, codesText: codesToText(treatment.procedureCodes), calcClass: '' };
}

export type RequestBodyResult = { ok: true; body: { proposed: { benefitType: BenefitType; procedureCodes: string[]; calcClass: CalcClass } } } | { ok: false; field: 'calcClass' };

/** 입력을 요청 본문으로. 서버로 가기 전에 화면에서 막는 것은 분류를 고르지 않은 경우뿐이다. */
export function requestBodyOf(form: ReviewForm): RequestBodyResult {
  if (form.calcClass === '') return { ok: false, field: 'calcClass' };
  return { ok: true, body: { proposed: { benefitType: form.benefitType, procedureCodes: parseCodesText(form.codesText), calcClass: form.calcClass } } };
}

/**
 * 치료마다 가장 최근 요청. 요청 시각(ISO 8601, 같은 길이)이 가장 늦은 것을 고르고, 같으면 목록에서 앞선 것을 고른다(서버는 최신순으로 준다).
 */
export function latestByTreatment(requests: readonly ReviewRequestView[]): Map<string, ReviewRequestView> {
  const latest = new Map<string, ReviewRequestView>();
  for (const request of requests) {
    const known = latest.get(request.treatmentId);
    if (known === undefined || request.requestedAt > known.requestedAt) latest.set(request.treatmentId, request);
  }
  return latest;
}

/** 열린 요청: 상태가 "검토 요청됨"인 것뿐이다. 승인·반려된 요청은 닫힌 요청이라 새 요청을 막지 않는다. */
export const hasOpenRequest = (request: ReviewRequestView | undefined): boolean => request !== undefined && request.status === 'REVIEW_REQUESTED';

export function statusLabel(request: ReviewRequestView | undefined): string {
  if (request === undefined) return COPY.statusNone;
  return request.status === 'REVIEW_REQUESTED' ? COPY.statusRequested : request.status === 'APPROVED' ? COPY.statusApproved : COPY.statusRejected;
}

/** 대기열이 값 하나를 보이는 세 칸의 글자. 현재 게시값과 제안값을 같은 모양으로 놓아 나란히 읽게 한다. */
export interface ValueLines {
  benefit: string;
  procedures: string;
  calcClass: string;
}

export type ValueField = 'benefitType' | 'procedureCodes' | 'calcClass';

const linesOf = (benefitType: BenefitType, procedureCodes: readonly string[], calcClass: CalcClass): ValueLines => ({
  benefit: benefitLabel(benefitType),
  procedures: procedureCodes.length === 0 ? COPY.noProcedure : codesToText(procedureCodes),
  calcClass: calcClassLabel(calcClass),
});

export const proposedLines = (proposed: ProposedValues): ValueLines => linesOf(proposed.benefitType, proposed.procedureCodes, proposed.calcClass);

/** 현재 게시본에 그 치료가 없으면(null) 값 줄도 없다. 화면이 "현재 게시 목록에 없음"을 보인다. */
export const currentLines = (current: CurrentTreatmentView | null): ValueLines | null => (current === null ? null : linesOf(current.benefitType, current.procedureCodes, current.calcClass));

/** 현재 게시 상태에서 값이 있는 경우(PUBLISHED)만 판단 필드를 낸다. 숨김·목록에 없음·읽지 못함은 null. */
export const publishedValuesOf = (current: CurrentPublishedView): CurrentTreatmentView | null => (current.state === 'PUBLISHED' ? current : null);

/** 값이 없는 이유: 숨김·목록에 없음은 NOT_PUBLISHED("현재 게시 목록에 없음"), 서버가 읽지 못한 것은 UNREADABLE(별도 문구). 값이 있으면 null. */
export function missingCurrentReason(current: CurrentPublishedView): 'NOT_PUBLISHED' | 'UNREADABLE' | null {
  if (current.state === 'PUBLISHED') return null;
  return current.state === 'UNREADABLE' ? 'UNREADABLE' : 'NOT_PUBLISHED';
}

/** 대기열 항목의 달라지는 칸. 읽지 못해 비교할 수 없으면 표시하지 않는다(없는 값과 다르다고 말하지 않는다). */
export const differingFieldsOf = (current: CurrentPublishedView, proposed: ProposedValues): ValueField[] =>
  current.state === 'UNREADABLE' ? [] : differingFields(publishedValuesOf(current), proposed);

/** 제안값이 현재 게시값과 다른 칸. 행위 코드는 순서가 달라도 같은 목록으로 본다. 현재 값이 없으면 비교할 수 없어 셋 모두 다른 것으로 본다. */
export function differingFields(current: CurrentTreatmentView | null, proposed: ProposedValues): ValueField[] {
  if (current === null) return ['benefitType', 'procedureCodes', 'calcClass'];
  const fields: ValueField[] = [];
  if (current.benefitType !== proposed.benefitType) fields.push('benefitType');
  if (codesToText([...current.procedureCodes].sort()) !== codesToText([...proposed.procedureCodes].sort())) fields.push('procedureCodes');
  if (current.calcClass !== proposed.calcClass) fields.push('calcClass');
  return fields;
}

/** 칸 경로(proposed.procedureCodes[1] 같은 서버 결함 경로)로 어느 칸의 문제인지 고른다. 모르는 경로는 null. */
function fieldMessage(path: string): string | null {
  if (path.startsWith('proposed.benefitType')) return COPY.errors.benefitType;
  if (path.startsWith('proposed.procedureCodes')) return COPY.errors.procedureCodes;
  if (path.startsWith('proposed.calcClass')) return COPY.errors.calcClass;
  return null;
}

/** 검토 요청 제출이 거절됐을 때의 문장. 코드를 그대로 보이지 않고, 요청도 치료도 바뀌지 않았다는 말을 늘 붙인다. */
export function reviewFailureMessage(result: Api<unknown>): string {
  const failure = result.body as ApiFailure;
  let core: string;
  if (result.status === 401) {
    core = COPY.unauthenticated;
  } else if (result.status === 403) {
    core = COPY.forbiddenClinic;
  } else if (result.status === 409) {
    core = failure.reason === 'REVIEW_ALREADY_REQUESTED' ? COPY.errors.alreadyRequested : COPY.errors.generic;
  } else if (result.status === 400) {
    const defects = failure.defects ?? [];
    const messages = new Set<string>();
    if (defects.some((defect) => defect.code === 'TREATMENT_NOT_IN_CATALOG')) messages.add(COPY.errors.notInCatalog);
    for (const defect of defects) {
      const text = fieldMessage(defect.path);
      if (text !== null) messages.add(text);
    }
    core = messages.size > 0 ? [...messages].join(' ') : COPY.errors.generic;
  } else {
    core = result.status >= 500 ? COPY.errors.server : COPY.errors.generic;
  }
  return `${core} ${COPY.nothingChanged}`;
}
