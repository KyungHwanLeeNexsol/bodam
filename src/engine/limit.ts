import type { LimitRule, Won } from './types';

// 한도와 그룹 지급액, 공유 한도 풀 배분 (design.md DD-02 "공제·한도·원 단위 처리", "그룹과 공유 한도").
// 값 무효·누락·지원 밖 종류는 group-values.ts 가 먼저 걸러내므로 여기서는 유효한 규칙만 받는다.

/** L: PER_VISIT_PAYOUT·PER_ACCIDENT·ANNUAL 은 amount, COUNT 는 perUseAmount, UNLIMITED_DECLARED 는 상한 없음. */
export function limitAmount(rule: LimitRule): Won | 'UNLIMITED' {
  switch (rule.kind) {
    case 'UNLIMITED_DECLARED':
      return 'UNLIMITED';
    case 'COUNT':
      return rule.perUseAmount;
    default:
      return rule.amount;
  }
}

/** PER_ACCIDENT·ANNUAL·COUNT 는 잔여 한도를 묻지 않고 한도가 그대로 남아 있다고 보므로 가정 코드를 낸다. */
export function isRemainingLimitAssumed(rule: LimitRule): boolean {
  return rule.kind === 'PER_ACCIDENT' || rule.kind === 'ANNUAL' || rule.kind === 'COUNT';
}

/**
 * 그룹 지급액 P = min(max(E − D, 0), L). 공유 한도를 적용하기 전의 값이다.
 * 한도는 공제 뒤에 적용한다(E − D 를 먼저 구한 뒤 L 로 자른다). E 와 D 는 안전 정수이고 D ≤ S 이므로 E − D 는 넘치지 않는다.
 */
export function groupPayout(E: Won, D: Won, L: Won | 'UNLIMITED'): Won {
  const afterDeduction = Math.max(E - D, 0);
  return L === 'UNLIMITED' ? afterDeduction : Math.min(afterDeduction, L);
}

/**
 * 공유 한도 풀 배분: groupOrder 순서의 그룹 지급액 P 를 받아 순서대로 남은 한도에서 채운다.
 * remaining 은 풀 한도에서 시작해 P_pooled = min(P, remaining), remaining -= P_pooled 로 줄어든다.
 * 정수 연산뿐이라 반올림도 나머지도 없다. 합계는 순서와 무관하게 min(Σ P, 풀 한도)이고 몫만 순서에 따라 달라진다.
 * UNLIMITED_DECLARED 풀은 P_pooled = P 다.
 */
export function allocatePool(payouts: readonly Won[], limit: Won | 'UNLIMITED'): Won[] {
  if (limit === 'UNLIMITED') {
    return [...payouts];
  }
  let remaining = limit;
  return payouts.map((payout) => {
    const pooled = Math.min(payout, remaining);
    remaining -= pooled;
    return pooled;
  });
}
