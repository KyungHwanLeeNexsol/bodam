import { MAX_AMOUNT_WON, MAX_BASIS_POINTS, SAFE_INTEGER_MAX } from './limits';

// 값을 고쳐 쓰는 변환(Number(), parseInt, 반올림, 기본값 채우기)은 하지 않는다.
// 무효 값은 거절 결과로 알릴 뿐 0·NaN·정상처럼 보이는 숫자로 바꾸지 않는다.
// 범위 초과도 금액·비율을 잘라 맞추지 않고 실패 단계 이름과 함께 거절한다 (design.md DD-24).

/** DD-24 "계산 단계의 검사 연산 순서" 표와 예상 병원 결제액 합산의 실패 단계 이름. */
export type CheckedStep =
  | 'RATE_PRODUCT'
  | 'ROUND_ADD'
  | 'SPLIT_PRODUCT_BENEFIT'
  | 'SPLIT_PRODUCT_NON_BENEFIT'
  | 'SPLIT_SUM'
  | 'HOSPITAL_PAYMENT_SUM';

/** OVERFLOW: 정확한 결과가 S 를 넘음. INVALID_OPERAND: 피연산자가 0 이상의 안전 정수(−0 제외)가 아님. */
export type CheckedFailureReason = 'OVERFLOW' | 'INVALID_OPERAND';

export type CheckedResult =
  | { ok: true; value: number }
  | { ok: false; reason: CheckedFailureReason; step: CheckedStep | null };

function fail(reason: CheckedFailureReason, step: CheckedStep | null): CheckedResult {
  return { ok: false, reason, step };
}

/** 0 이상의 안전 정수이면서 −0 이 아닌 값. 상한은 보지 않는다(합계 E·G·N·T 는 MAX_AMOUNT_WON 을 넘을 수 있다). */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

/** Won: 0 이상 MAX_AMOUNT_WON 이하의 안전 정수이며 −0 이 아니다. */
export function isWon(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value <= MAX_AMOUNT_WON;
}

/**
 * BasisPoints: 0 이상 10000 이하의 안전 정수.
 * −0 은 거절한다. DD-24 정의는 −0 을 따로 적지 않았으나 −0 은 고쳐 쓴 값의 흔적이라
 * 보류 쪽으로 기울어 무효로 본다 (progress.md §E.2 M1.1 가정).
 */
export function isBasisPoints(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value <= MAX_BASIS_POINTS;
}

// @MX:ANCHOR: [AUTO] 검사 덧셈. 합계 T, 반올림 덧셈, SPLIT 합이 모두 이 함수를 거친다(M1.1 sumLineAmounts, M1.3 공제 계산).
// @MX:REASON: 정확한 결과가 S 를 넘는 연산을 조용히 통과시키면 부동소수점이 정밀도를 잃은 금액이 결과에 나간다(DD-24).
/** 검사 덧셈. 정확한 결과 a + b 가 S 이하일 때만 통과한다. */
export function checkedAdd(a: number, b: number, step: CheckedStep | null = null): CheckedResult {
  if (!isNonNegativeSafeInteger(a) || !isNonNegativeSafeInteger(b)) {
    return fail('INVALID_OPERAND', step);
  }
  // a 와 b 는 0 이상 S 이하이므로 S − a 는 정확하다. 덧셈 결과가 부동소수점으로 감기는 일을 피하려고 사전 검사로 판정한다.
  if (b > SAFE_INTEGER_MAX - a) {
    return fail('OVERFLOW', step);
  }
  return { ok: true, value: a + b };
}

// @MX:ANCHOR: [AUTO] 검사 곱셈. RATE_PRODUCT, SPLIT_PRODUCT_BENEFIT, SPLIT_PRODUCT_NON_BENEFIT 단계가 모두 이 함수를 거친다(M1.3 공제 계산).
// @MX:REASON: 곱은 `비율 × 금액`이며 금액 × 10000 이 아니다. 비율마다 경계가 다르므로 정확한 BigInt 곱으로 판정한다(DD-24).
/** 검사 곱셈 `비율(basis points) × 금액`. 정확한 곱이 S 이하일 때만 통과한다. */
export function checkedMulBp(rate: number, amount: number, step: CheckedStep | null = null): CheckedResult {
  if (!isBasisPoints(rate) || !isNonNegativeSafeInteger(amount)) {
    return fail('INVALID_OPERAND', step);
  }
  const exact = BigInt(rate) * BigInt(amount);
  if (exact > BigInt(SAFE_INTEGER_MAX)) {
    return fail('OVERFLOW', step);
  }
  return { ok: true, value: Number(exact) };
}

/** 줄 금액 합산. 예상 병원 결제액 T 를 검사 덧셈으로 구하며 실패 단계 이름은 HOSPITAL_PAYMENT_SUM 이다. */
export function sumLineAmounts(amounts: readonly number[]): CheckedResult {
  let total = 0;
  for (const amount of amounts) {
    const next = checkedAdd(total, amount, 'HOSPITAL_PAYMENT_SUM');
    if (!next.ok) {
      return next;
    }
    total = next.value;
  }
  return { ok: true, value: total };
}
