// 공개 API 응답 도우미 (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-19 오류 표, AC-021e).
// 모든 응답(성공·오류 모두)은 `Cache-Control: no-store` 와 `content-type: application/json` 을 가진다. 이 파일이 응답을 만드는 유일한 곳이므로
// 헤더를 빠뜨린 응답이 나올 길이 없다. 표준 Web `Response` 만 쓰고 Next.js 를 가져오지 않는다.
// 이 헤더는 서버 안의 내용 캐시(M4.C)와 별개다: 브라우저·중간 캐시가 응답을 저장하지 못하게 하는 것이다.

/**
 * 공개 오류 코드와 HTTP 상태 (DD-19 오류 표의 공개 경로 행). 409 `VERSION_MISMATCH` 는 본문에 `latest`·`changes` 가 붙어 모양이 달라서
 * 이 표가 아니라 계산 서비스(M4.B)가 따로 만든다.
 */
export const ERROR_STATUS = {
  CLINIC_NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  UNSUPPORTED_GENERATION: 422,
  NO_TREATMENT_SELECTED: 422,
  TREATMENT_NOT_PUBLISHED: 422,
  INTERNAL_ERROR: 500,
} as const;
export type ApiErrorCode = keyof typeof ERROR_STATUS;

// @MX:ANCHOR: [AUTO] 공개 API 응답의 단일 생성점. catalog·options·오류 응답과 계산 응답(M4.B)이 모두 부른다.
// @MX:REASON: 헤더(no-store, content-type)가 응답마다 따로 붙으면 한 경로가 빠졌을 때 병원 데이터나 중지 사실이 캐시에 남는다(AC-021e).
/** JSON 본문 응답. 항상 no-store 이고 content-type 은 application/json 이다. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** 오류 응답: 상태는 코드에서 정해지고 본문은 `{ "error": "<CODE>" }` 하나뿐이다. 금액·치료 id·스택·내부 상세를 담지 않는다. */
export function errorResponse(code: ApiErrorCode): Response {
  return jsonResponse(ERROR_STATUS[code], { error: code });
}
