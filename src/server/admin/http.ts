import { jsonResponse } from '../api/http';
import type { Defect } from '../domain/errors';

// 관리자 API 응답 도우미 (SPEC-REIMBURSEMENT-001 M7, design.md DD-19 오류 표의 관리자 행). 모든 응답은 공개 API 와 같은 단일 생성점(api/http.ts)을 거쳐
// 항상 `Cache-Control: no-store` 와 `content-type: application/json` 을 가진다. 오류 본문은 `{ "error": "<CODE>" }` 이고, 어긋난 필드 경로(400)와 충돌 사유(409)만 더 담는다.
// 금액·내부 id·스택·다른 병원의 존재 여부는 오류 본문에 없다.

export const ADMIN_ERROR_STATUS = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;
export type AdminErrorCode = keyof typeof ADMIN_ERROR_STATUS;

export function adminError(code: AdminErrorCode, extra: Record<string, unknown> = {}): Response {
  return jsonResponse(ADMIN_ERROR_STATUS[code], { error: code, ...extra });
}

/** 400: 어긋난 필드마다 `{ code, path }` (DD-19 "수치 범위 위반 … 어긋난 필드 경로와 함께 거절"). */
export function invalidRequest(defects: readonly Defect[]): Response {
  return adminError('INVALID_REQUEST', { defects: defects.map((defect) => ({ code: defect.code, path: defect.path })) });
}

export function ok(body: unknown): Response {
  return jsonResponse(200, body);
}
