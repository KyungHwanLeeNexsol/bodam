import { BASIS_POINTS_SCALE, ROUNDING_HALF } from './constants';
import { checkedAdd } from './numeric';
import type { CheckedResult } from './numeric';
import type { Rounding } from './types';

// 원 단위 처리 (design.md DD-02, DD-24). 비율은 basis points 로만 저장하므로
// `비율 × 금액` 의 곱을 척도 B 로 나누어 원 단위로 만든다.
// TRUNCATE 는 버림, ROUND_HALF_UP 은 척도의 절반 H 를 더한 뒤 버림이다. 기본값은 없다.

/**
 * 0 이상의 정수 value 를 divisor 로 나눈 몫(내림). 부동소수점 나눗셈은 .9999 처럼 큰 값에서 올림될 수 있어
 * BigInt 로 정확히 나눈다. 결과는 피연산자보다 작으므로 검사하지 않는다.
 */
export function floorDivide(value: number, divisor: number): number {
  return Number(BigInt(value) / BigInt(divisor));
}

/**
 * 곱(또는 SPLIT 의 두 곱의 합) 하나에 원 단위 처리를 한 번 적용한다.
 * ROUND_HALF_UP 의 `+ H` 는 검사 덧셈이며 S 를 넘으면 ROUND_ADD 로 거절한다.
 */
export function applyRounding(value: number, rounding: Rounding): CheckedResult {
  if (rounding === 'TRUNCATE') {
    return { ok: true, value: floorDivide(value, BASIS_POINTS_SCALE) };
  }
  const added = checkedAdd(value, ROUNDING_HALF, 'ROUND_ADD');
  return added.ok ? { ok: true, value: floorDivide(added.value, BASIS_POINTS_SCALE) } : added;
}
