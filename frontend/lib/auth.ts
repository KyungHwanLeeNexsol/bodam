/**
 * 인증 API 클라이언트 유틸리티 (SPEC-AUTH-001 Module 5)
 *
 * 백엔드 인증 API와 통신하는 함수 모음.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  email: string
  password: string
  full_name?: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface UserResponse {
  id: string
  email: string
  full_name: string | null
  is_active: boolean
}

/**
 * 로그인 API 호출
 *
 * @param payload - 이메일, 비밀번호
 * @returns JWT 토큰 응답
 * @throws 인증 실패 시 오류
 */
export async function loginApi(payload: LoginPayload): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '로그인에 실패했습니다.' }))
    throw new Error(error.detail ?? '이메일 또는 비밀번호가 올바르지 않습니다')
  }

  return response.json()
}

/**
 * 회원가입 API 호출
 *
 * @param payload - 이메일, 비밀번호, 이름
 * @returns 생성된 사용자 정보
 * @throws 중복 이메일 또는 유효성 오류 시 오류
 */
export async function registerApi(payload: RegisterPayload): Promise<UserResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '회원가입에 실패했습니다.' }))
    throw new Error(error.detail ?? '회원가입에 실패했습니다.')
  }

  return response.json()
}
