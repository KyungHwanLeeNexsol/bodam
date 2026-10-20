import { sumLineAmounts } from '../../../engine/numeric';
import type { BenefitTypeCode, CatalogTreatmentDto } from './api-types';
import { treatmentsPerPage } from './display';
import { canRetryRefresh, treatmentsLocked } from './refresh';
import { canBeginRequest, isLoading } from './request';
import type { KioskState } from './session-store';
import { STEP_INDEX, STEP_NEXT, STEP_TOTAL } from './steps';

// 상태에서 읽는 파생 값 (SPEC-REIMBURSEMENT-001 M5.A, design.md DD-07·DD-09·DD-12). 모두 순수 함수이고 상태를 바꾸지 않는다.
// 화면(M6)은 상태를 직접 해석하지 않고 이 함수들로 읽는다: 버튼 활성, 단계 표시, 선택 요약, 치료 목록의 한 쪽.

/** "다음" 버튼 활성: 1-3단계에서 그 단계의 값이 있을 때만 (AC-012b). 4단계의 다음 동작은 "예상 부담액 확인"(canRequestEstimate)이다. */
export function canGoNext(state: KioskState): boolean {
  return STEP_NEXT[state.screen]?.ready(state.inputs) ?? false;
}

/**
 * "예상 부담액 확인" 활성(통신 오류 화면의 "다시 시도" 포함): 보낼 입력이 갖춰졌고 자료 갱신이 필요하지 않을 때만 (AC-012b, DD-09 규칙 1).
 * 갱신이 진행 중이거나 실패해 있거나 시작을 기다리면 비활성이다. 판정은 상태 기계가 사건을 받을 때 쓰는 것과 같은 함수(canBeginRequest)다.
 */
export const canRequestEstimate = canBeginRequest;

/** 로딩 표시(계산 중): 활성 요청이 있는 동안 켜져 있다. */
export const selectIsLoading = isLoading;

/** 갱신의 화면 표시 값 (DD-09 규칙 2·3·5): 진행 중 표시, 실패 안내와 인라인 "다시 시도", 치료 카드·"이전" 잠금, 선택에서 빠진 치료의 안내. */
export function selectRefresh(state: KioskState): {
  readonly running: boolean;
  readonly failed: boolean;
  readonly canRetry: boolean;
  readonly locked: boolean;
  readonly notice: KioskState['refreshNotice'];
} {
  return { running: state.refreshState === 'RUNNING', failed: state.refreshState === 'FAILED', canRetry: canRetryRefresh(state), locked: treatmentsLocked(state), notice: state.refreshNotice };
}

/** 입력 단계 표시(1/4 ~ 4/4, AC-012a). 입력 단계가 아닌 화면은 null. */
export function selectStep(state: KioskState): { readonly index: 1 | 2 | 3 | 4; readonly total: number } | null {
  const index = STEP_INDEX[state.screen];
  return index === undefined ? null : { index, total: STEP_TOTAL };
}

export interface SelectionTotals {
  readonly selectedCount: number;
  readonly benefit: number;
  readonly nonBenefit: number;
  /** 총 예상 결제액(병원 결제액 T). 선택 요약이며 보험 계산 결과가 아니다. */
  readonly total: number;
}

// @MX:NOTE: [AUTO] 합산은 엔진의 검사 덧셈(sumLineAmounts, 서버가 병원 결제액 T 를 구하는 같은 함수)으로 한다. 키오스크가 합계 식을 따로 두지 않는다(AC-019c).
// 엔진의 그룹 합계(sumGroupShares)는 PublishedLine 전체를 요구하는데 선택 요약은 금액과 급여 구분만 쓰므로 그 함수는 쓰지 않는다.
function sumWon(amounts: readonly number[]): number {
  const sum = sumLineAmounts(amounts);
  if (!sum.ok) throw new RangeError(`선택 요약의 합계가 안전한 범위를 넘었다: ${sum.reason}`);
  return sum.value;
}

/**
 * 선택 요약 (AC-012f): 고른 치료의 급여·비급여 합계와 총 예상 결제액. 공통 기본비용이 등록된 병원은 치료를 하나 이상 골랐을 때 기본비용 줄이 들어간다.
 * 카탈로그에 없는 치료 id 는 넣지 않는다. 고르는 순서와 무관하다.
 */
export function selectTotals(state: KioskState): SelectionTotals {
  const { treatments, baseFees } = state.clinic.catalog;
  const selected = treatments.filter((treatment) => state.inputs.treatmentIds.includes(treatment.treatmentId));
  const lines = [
    ...selected.map((treatment) => ({ benefitType: treatment.benefitType, amount: treatment.patientAmount })),
    ...(selected.length === 0 ? [] : baseFees.map((fee) => ({ benefitType: fee.benefitType, amount: fee.amount }))),
  ];
  const amountsOf = (benefitType: BenefitTypeCode): number[] => lines.filter((line) => line.benefitType === benefitType).map((line) => line.amount);
  const benefit = sumWon(amountsOf('BENEFIT'));
  const nonBenefit = sumWon(amountsOf('NON_BENEFIT'));
  return { selectedCount: selected.length, benefit, nonBenefit, total: sumWon([benefit, nonBenefit]) };
}

export interface TreatmentPageItem {
  readonly treatment: CatalogTreatmentDto;
  readonly selected: boolean;
}

export interface TreatmentPage {
  readonly items: readonly TreatmentPageItem[];
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly pageSize: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
}

/**
 * 치료 목록의 지금 쪽 (DD-12): 한 쪽 개수는 표시 설정이 정한다(큰 글자 2개, 그 밖 4개). 쪽 번호는 보던 첫 치료의 위치(`treatmentPageOffset`)가
 * 들어 있는 쪽이다. 그래서 큰 글자를 켜고 꺼도 보던 치료가 보이는 쪽으로 맞춰지고, 치료 수가 줄어 위치가 범위를 벗어나면 마지막 쪽이 된다.
 */
export function selectTreatmentPage(state: KioskState): TreatmentPage {
  const pageSize = treatmentsPerPage(state.display);
  const all = state.clinic.catalog.treatments;
  const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
  const pageIndex = Math.min(Math.floor(state.treatmentPageOffset / pageSize), pageCount - 1);
  const items = all.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((treatment) => ({ treatment, selected: state.inputs.treatmentIds.includes(treatment.treatmentId) }));
  return { items, pageIndex, pageCount, pageSize, hasPrev: pageIndex > 0, hasNext: pageIndex < pageCount - 1 };
}
