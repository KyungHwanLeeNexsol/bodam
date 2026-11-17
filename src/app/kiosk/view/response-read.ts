// 계산 응답을 읽는 보기 모양들의 공통 방어 도구 (SPEC-REIMBURSEMENT-001 M6 S3a·S3b).
// 응답 본문은 상태 기계가 큰 모양(결과 종류·금액·버전)만 검사해서 저장하므로 줄·그룹·근거·서류의 안쪽은 믿지 않고 읽는다: 읽을 수 없는 칸은 던지지 않고 "없음"으로 읽는다.

/** 배열이면 그대로, 아니면(없음·읽을 수 없는 값) 빈 배열. */
export function list<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

/** 금액: 0 이상의 안전한 정수. */
export function isWon(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
