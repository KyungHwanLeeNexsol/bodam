// 금액 표시 (SPEC-REIMBURSEMENT-001 M6, BRIEF D9). 화면의 금액 문자열은 모두 이 함수를 거친다.
// 값이 없는 금액(null)을 0 으로 바꾸지 않는다: 보류 결과의 빈 금액은 "확인 필요"로 보인다(기획서 §4, 0원은 "받을 돈이 없다"는 뜻으로 읽힌다).

export const AMOUNT_UNKNOWN_LABEL = '확인 필요';

/** 원 단위 정수를 천 단위 쉼표와 "원" 으로 쓴다. 음수·소수·안전하지 않은 정수는 금액이 아니므로 예외다(표시 단계에서 몰래 고치지 않는다). */
export function formatWon(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`금액은 0 이상의 안전한 정수여야 한다: ${String(amount)}`);
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

/** 값이 있으면 금액 문자열, 없으면(null) "확인 필요". 어느 경우에도 0원으로 바꾸지 않는다. */
export function formatWonOrCheck(amount: number | null): string {
  return amount === null ? AMOUNT_UNKNOWN_LABEL : formatWon(amount);
}
