// 기술 안전 한도. 보험 업무 값(공제·한도·비율·지급액)이 아니다 (design.md DD-24).
// 이 파일과 constants.ts·numeric.ts 만 숫자 리터럴 선언이 허용되는 곳이다 (DD-02 상수 규칙).

// @MX:NOTE: [AUTO] MAX_AMOUNT_WON = 1,000,000,000원은 사용자가 plan.md §E.9에서 수용한 기술 안전 한도다(소유자 보험 값 아님).
// 불변 조건: MAX_AMOUNT_WON × MAX_BASIS_POINTS ≤ SAFE_INTEGER_MAX. 줄 하나의 금액에 대한 비율 곱이 항상 안전 정수라는 것만 보장하며,
// 그룹 합계 E·G·N·T 에 대한 곱의 안전성은 보장하지 않는다. 그 검사는 numeric.ts 의 검사 연산이 단계마다 한다.
export const MAX_AMOUNT_WON = 1_000_000_000;

// 비율(BasisPoints)의 상한: 10000 = 100%. 비율 척도 B 와 값이 같지만 다른 개념이라 따로 둔다(척도는 constants.ts 에서 선언).
export const MAX_BASIS_POINTS = 10_000;

// DD-24 표기의 S. 검사 연산의 정확한 결과가 이 값을 넘으면 범위 초과다.
export const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;
