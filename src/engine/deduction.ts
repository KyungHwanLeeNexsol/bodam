import { checkedAdd, checkedMulBp } from './numeric';
import type { CheckedResult } from './numeric';
import { applyRounding } from './rounding';
import type { GroupShares } from './sum';
import type { BasisPoints, DeductionRule, FailedStepName, Rounding, Won } from './types';

// 명목 공제 D 와 실제 적용 공제 (design.md DD-02 공제식, DD-24 검사 연산 순서).
// 값 무효·누락은 group-values.ts 가 먼저 걸러내므로 여기서는 유효한 규칙만 받는다.
// 어느 단계든 정확한 결과가 S 를 넘으면 값을 잘라 맞추지 않고 실패 단계 이름과 함께 알린다.

export type DeductionResult = { ok: true; D: Won } | { ok: false; step: FailedStepName };

type Failure = Extract<CheckedResult, { ok: false }>;

function failed(result: Failure): { ok: false; step: FailedStepName } {
  // 이 파일의 검사 연산은 모두 단계 이름을 넘기므로 step 은 항상 있다.
  return { ok: false, step: result.step as FailedStepName };
}

/** round(rate × base): 곱(RATE_PRODUCT) → 원 단위 처리(ROUND_ADD). */
function roundedRate(rate: BasisPoints, base: Won, rounding: Rounding): CheckedResult {
  const product = checkedMulBp(rate, base, 'RATE_PRODUCT');
  return product.ok ? applyRounding(product.value, rounding) : product;
}

// @MX:ANCHOR: [AUTO] 명목 공제 계산. 그룹마다 한 번 불리고 estimate() 와 준비 상태 확인이 같은 식을 쓴다.
// @MX:REASON: 공제는 그룹당 한 번이어야 하고(치료마다 공제 금지) 검사 연산 순서가 CALC_RANGE_EXCEEDED 의 실패 단계 이름을 정한다(DD-02, DD-24).
/**
 * 공제 방식별 명목 공제 D:
 * - FIXED: fixed
 * - RATE_WITH_FIXED_FLOOR: max(fixed, round(rate × E))
 * - SPLIT_RATE_WITH_FIXED_FLOOR: max(fixed, round(rateBenefit × G + rateNonBenefit × N)) — 반올림은 합에 한 번만 한다
 * - CAPPED_RATE_WITH_FIXED_FLOOR: min(E, max(fixed, round(rate × E)))
 */
export function computeNominalDeduction(rule: DeductionRule, shares: GroupShares): DeductionResult {
  switch (rule.kind) {
    case 'FIXED':
      return { ok: true, D: rule.fixed };

    case 'RATE_WITH_FIXED_FLOOR': {
      const rounded = roundedRate(rule.rate, shares.E, rule.rounding);
      return rounded.ok ? { ok: true, D: Math.max(rule.fixed, rounded.value) } : failed(rounded);
    }

    case 'SPLIT_RATE_WITH_FIXED_FLOOR': {
      const benefit = checkedMulBp(rule.rateBenefit, shares.G, 'SPLIT_PRODUCT_BENEFIT');
      if (!benefit.ok) return failed(benefit);
      const nonBenefit = checkedMulBp(rule.rateNonBenefit, shares.N, 'SPLIT_PRODUCT_NON_BENEFIT');
      if (!nonBenefit.ok) return failed(nonBenefit);
      const sum = checkedAdd(benefit.value, nonBenefit.value, 'SPLIT_SUM');
      if (!sum.ok) return failed(sum);
      const rounded = applyRounding(sum.value, rule.rounding);
      return rounded.ok ? { ok: true, D: Math.max(rule.fixed, rounded.value) } : failed(rounded);
    }

    case 'CAPPED_RATE_WITH_FIXED_FLOOR': {
      const rounded = roundedRate(rule.rate, shares.E, rule.rounding);
      return rounded.ok
        ? { ok: true, D: Math.min(shares.E, Math.max(rule.fixed, rounded.value)) }
        : failed(rounded);
    }
  }
}

/** 실제 적용 공제 D_applied = min(D, E). 명목 D 는 E 보다 클 수 있다(작은 비용). */
export function appliedDeduction(D: Won, E: Won): Won {
  return Math.min(D, E);
}
