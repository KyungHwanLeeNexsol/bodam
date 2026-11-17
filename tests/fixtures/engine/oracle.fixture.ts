import type { DeductionRule, LimitRule } from '../../../src/engine/types';

// 독립 오라클. design.md DD-02 의 식을 BigInt 로 따로 써 둔 기준 계산이며 src/engine 의 코드를 가져오지 않는다.
// 시험 자료(TEST_FIXTURE)의 값만 다루고 실제 보험 값이 아니다.

const SCALE = 10000n;
const HALF = 5000n;

function round(x: bigint, rounding: 'TRUNCATE' | 'ROUND_HALF_UP'): bigint {
  return rounding === 'TRUNCATE' ? x / SCALE : (x + HALF) / SCALE;
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** 명목 공제 D. G·N 은 급여·비급여 몫, E = G + N. */
export function oracleNominalDeduction(rule: DeductionRule, G: bigint, N: bigint): bigint {
  const E = G + N;
  switch (rule.kind) {
    case 'FIXED':
      return BigInt(rule.fixed);
    case 'RATE_WITH_FIXED_FLOOR':
      return max(BigInt(rule.fixed), round(BigInt(rule.rate) * E, rule.rounding));
    case 'SPLIT_RATE_WITH_FIXED_FLOOR':
      return max(
        BigInt(rule.fixed),
        round(BigInt(rule.rateBenefit) * G + BigInt(rule.rateNonBenefit) * N, rule.rounding),
      );
    case 'CAPPED_RATE_WITH_FIXED_FLOOR':
      return min(E, max(BigInt(rule.fixed), round(BigInt(rule.rate) * E, rule.rounding)));
  }
}

export function oracleLimit(rule: LimitRule): bigint | 'UNLIMITED' {
  switch (rule.kind) {
    case 'UNLIMITED_DECLARED':
      return 'UNLIMITED';
    case 'COUNT':
      return BigInt(rule.perUseAmount);
    default:
      return BigInt(rule.amount);
  }
}

export interface OracleGroup {
  E: bigint;
  D: bigint;
  Dapplied: bigint;
  P: bigint;
}

/** 그룹 지급액 P = min(max(E − D, 0), L), 실제 적용 공제 D_applied = min(D, E). */
export function oracleGroup(deduction: DeductionRule, limit: LimitRule, G: bigint, N: bigint): OracleGroup {
  const E = G + N;
  const D = oracleNominalDeduction(deduction, G, N);
  const L = oracleLimit(limit);
  const afterDeduction = max(E - D, 0n);
  return { E, D, Dapplied: min(D, E), P: L === 'UNLIMITED' ? afterDeduction : min(afterDeduction, L) };
}

/** 공유 한도 풀: groupOrder 순서의 P 목록을 받아 P_pooled 목록을 돌려준다. */
export function oraclePool(payouts: bigint[], limit: bigint | 'UNLIMITED'): bigint[] {
  if (limit === 'UNLIMITED') return [...payouts];
  let remaining = limit;
  return payouts.map((p) => {
    const pooled = min(p, remaining);
    remaining -= pooled;
    return pooled;
  });
}
