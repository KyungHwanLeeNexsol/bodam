// 비율 처리 척도 상수 (design.md DD-02, DD-24). 보험 업무 값이 아니다.
// 이 파일과 limits.ts·numeric.ts 만 숫자 리터럴 선언이 허용되는 곳이다 (DD-02 상수 규칙).
// 비율은 basis points 로만 저장하므로 `비율 × 금액` 을 이 척도로 나누어 원 단위로 만든다.

/** 척도 B: 10000 basis points = 100%. */
export const BASIS_POINTS_SCALE = 10_000;

/** 척도의 절반 H: ROUND_HALF_UP 이 곱에 더하는 값. */
export const ROUNDING_HALF = 5_000;
