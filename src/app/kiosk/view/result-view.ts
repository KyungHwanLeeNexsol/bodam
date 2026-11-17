import type { EstimateResponseDto, EstimateResultState } from '../state/api-types';
import { selectTotals } from '../state/selectors';
import type { KioskState } from '../state/session-store';
import { COPY } from './copy';
import { AMOUNT_UNKNOWN_LABEL, formatWon } from './format';
import { groupHoldReasons } from './hold-reasons';
import type { HoldGroupView } from './hold-reasons';
import { isWon, list } from './response-read';
import { describeSelection } from './selection-view';

// 결과 화면의 읽기 전용 값 (SPEC-REIMBURSEMENT-001 M6 S3a, design.md DD-07·DD-21·DD-22, AC-013a·b·c, AC-010e, AC-019c).
// 순수 함수다: 상태(저장된 계산 응답과 입력, 병원 자료)에서 화면이 그릴 문자열만 만든다. 보험 계산은 없다.
//  - 세 금액은 응답(state.derived.estimate.response)의 값 그대로다. 값이 없는 금액(null, 보류 결과)은 "확인 필요"이고 어떤 경우에도 0원이 되지 않는다.
//  - 병원 결제액의 급여·비급여 내역만 선택 요약(selectTotals, 엔진 sumLineAmounts)의 값이고, 합이 응답의 병원 결제액과 같을 때만 보인다(AC-019c).
//  - 환자 화면에 내부 코드·참고 그룹 값·"N"·결과 문구 원칙(보류)이 나오지 않도록 이 모양에는 그런 칸이 없다(referenceGroups 는 읽지도 않는다).

export type ResultKind = 'NORMAL' | 'NOT_COVERED' | 'HOLD';
export type ResultActionKey = 'DOCUMENTS' | 'BASIS' | 'RESELECT' | 'EDIT_INSURANCE' | 'HOME' | 'COMPLETE';

const KIND_OF_STATE: Readonly<Record<EstimateResultState, ResultKind>> = { ESTIMATED: 'NORMAL', ESTIMATED_WITH_EXCLUSIONS: 'NOT_COVERED', ON_HOLD: 'HOLD' };

/** 동작의 고정 순서. 서류·근거는 계산이 끝난 결과에만 있고 보류 결과는 네 개뿐이다(AC-013c·e). */
const ACTIONS: Readonly<Record<ResultKind, readonly ResultActionKey[]>> = {
  NORMAL: ['DOCUMENTS', 'BASIS', 'RESELECT', 'EDIT_INSURANCE', 'HOME', 'COMPLETE'],
  NOT_COVERED: ['DOCUMENTS', 'BASIS', 'RESELECT', 'EDIT_INSURANCE', 'HOME', 'COMPLETE'],
  HOLD: ['RESELECT', 'EDIT_INSURANCE', 'HOME', 'COMPLETE'],
};

export interface AmountView {
  readonly label: string;
  /** 금액 문자열("124,000원") 또는 "확인 필요". */
  readonly text: string;
  /** 숫자로 알려진 금액인가. false 이면 text 는 "확인 필요"다. */
  readonly known: boolean;
  readonly note: string;
}

export interface ExclusionView {
  readonly name: string;
  readonly amount: string;
  readonly reason: string;
}

export interface ResultView {
  readonly kind: ResultKind;
  /** 운영이 아닌 자료(origin !== OPERATING)로 계산한 결과인가 (AC-010e). */
  readonly testData: boolean;
  /** "2세대(C1) · 손해보험사". options 응답의 label 이고, 찾지 못한 부분은 코드를 보이지 않고 빠진다. */
  readonly insuranceLabel: string | null;
  readonly treatmentNames: readonly string[];
  /** "X-ray, 초음파, 신장분사치료, 물리치료 (4개)". */
  readonly treatmentSummary: string;
  /** 가로형의 한 줄: "2세대(C1) · 손해보험사 · 치료 4개". */
  readonly compactCondition: string;
  readonly hospital: AmountView & { readonly split: string | null };
  readonly payout: AmountView;
  readonly afterPayout: AmountView;
  readonly exclusions: readonly ExclusionView[];
  readonly exclusionNotes: readonly string[];
  readonly holdGroups: readonly HoldGroupView[];
  readonly actions: readonly ResultActionKey[];
}

// @MX:NOTE: [AUTO] 값이 없는 금액(null·없음·읽을 수 없는 값)은 어떤 경우에도 0원이 되지 않고 "확인 필요"다(기획서 §4, AC-013c). 0 은 "받을 돈이 없다"는 뜻으로 읽히기 때문이다.
// 병원 결제액의 급여·비급여 내역은 선택 요약의 합이 응답의 병원 결제액과 같을 때만 보인다(AC-019c): 합이 맞지 않는 숫자를 나란히 놓지 않는다.
/** 값이 금액이면 금액 문자열, 아니면(null·없음·읽을 수 없는 값) "확인 필요". 0원으로 바꾸지 않는다. */
function amountOf(label: string, note: string, value: unknown): AmountView {
  return isWon(value) ? { label, text: formatWon(value), known: true, note } : { label, text: AMOUNT_UNKNOWN_LABEL, known: false, note };
}

/** 급여·비급여 내역: 0원인 쪽은 적지 않는다("급여 0원 + …" 같은 줄을 만들지 않는다). */
function splitText(benefit: number, nonBenefit: number): string | null {
  const parts = [...(benefit > 0 ? [`급여 ${formatWon(benefit)}`] : []), ...(nonBenefit > 0 ? [`비급여 ${formatWon(nonBenefit)}`] : [])];
  return parts.length === 0 ? null : parts.join(' + ');
}

/** 치료 id → 이름: 응답 줄의 이름이 먼저이고 병원 자료(카탈로그)가 그다음이다. 찾지 못하면 null (화면에 id 를 보이지 않는다). */
export function nameLookup(state: KioskState, response: EstimateResponseDto): (treatmentId: string) => string | null {
  const lines = list(response.result.lines);
  const catalog = state.clinic.catalog.treatments;
  return (treatmentId) => lines.find((entry) => entry.treatmentId === treatmentId)?.displayName ?? catalog.find((entry) => entry.treatmentId === treatmentId)?.displayName ?? null;
}

/** 확인된 제외 항목(보장 제외 결과): 이름·금액·사유는 응답의 값이다. 금액을 읽을 수 없으면 0원이 아니라 "확인 필요". */
export function exclusionsOf(response: EstimateResponseDto, nameOf: (treatmentId: string) => string | null): ExclusionView[] {
  return list(response.result.excludedItems).map((item) => ({ name: nameOf(item.treatmentId) ?? COPY.result.exclusion.title, amount: isWon(item.amount) ? formatWon(item.amount) : AMOUNT_UNKNOWN_LABEL, reason: item.reason }));
}

/** 나머지 항목 기준의 가정 문장(보장 제외 결과): 가정 코드에서 온다. */
export function exclusionNotesOf(response: EstimateResponseDto): string[] {
  const assumptions = list(response.result.assumptions);
  return [...(assumptions.includes('REMAINING_COVERED_AND_LIMIT_REMAINS') ? [COPY.result.exclusion.remaining] : []), ...(assumptions.includes('REMAINING_LIMIT_ASSUMED') ? [COPY.result.exclusion.limit] : [])];
}

/**
 * 결과 화면의 값. 저장된 응답이 없거나 화면이 기대하는 종류와 응답의 결과 종류가 다르면 null 이다
 * (화면은 이때 0원이나 빈 결과를 그리지 않고 안내 화면으로 간다).
 */
export function buildResultView(state: KioskState, expected: ResultKind): ResultView | null {
  const response = state.derived.estimate?.response;
  if (response === undefined) return null;
  const { result } = response;
  if (KIND_OF_STATE[result.state] !== expected) return null;

  const nameOf = nameLookup(state, response);
  // 선택한 치료의 이름과 보험 조건 이름은 결과·근거·서류 화면이 같은 값을 쓴다(selection-view).
  const { treatmentNames, insuranceLabel, treatmentSummary } = describeSelection(state, response);

  const totals = selectTotals(state);
  const split = totals.selectedCount > 0 && isWon(result.amounts.hospitalPayment) && totals.total === result.amounts.hospitalPayment ? splitText(totals.benefit, totals.nonBenefit) : null;

  const exclusions = expected === 'NOT_COVERED' ? exclusionsOf(response, nameOf) : [];
  const exclusionNotes = expected === 'NOT_COVERED' ? exclusionNotesOf(response) : [];

  return {
    kind: expected,
    testData: response.origin !== 'OPERATING',
    insuranceLabel,
    treatmentNames,
    treatmentSummary,
    compactCondition: [...(insuranceLabel === null ? [] : [insuranceLabel]), `치료 ${treatmentNames.length}개`].join(' · '),
    hospital: { ...amountOf(COPY.result.hospital.label, COPY.result.hospital.note, result.amounts.hospitalPayment), split },
    payout: amountOf(COPY.result.payout.label, COPY.result.payout.note, result.amounts.expectedInsurancePayout),
    afterPayout: amountOf(COPY.result.afterPayout.label, COPY.result.afterPayout.note, result.amounts.expectedOutOfPocketAfterPayout),
    exclusions,
    exclusionNotes,
    holdGroups: expected === 'HOLD' ? groupHoldReasons(list(result.holdReasons), nameOf) : [],
    actions: ACTIONS[expected],
  };
}
