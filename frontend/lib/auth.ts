/**
 * 인증 API 클라이언트 유틸리티 (SPEC-AUTH-001 Module 5, SPEC-OAUTH-001)
 *
 * 백엔드 인증 API와 통신하는 함수 모음.
 * 소셜 로그인(OAuth2) 관련 함수 포함.
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

// ─── OAuth2 소셜 로그인 (SPEC-OAUTH-001) ─────────────────────────────────────

/** OAuth 콜백 응답 타입 */
export interface OAuthCallbackResponse {
  access_token: string
  token_type: string
  is_new_user: boolean
}

/** OAuth 계정 병합 요청 페이로드 */
export interface OAuthMergePayload {
  provider: string
  merge_token: string
  password: string
}

/** 소셜 계정 정보 응답 타입 */
export interface SocialAccountResponse {
  provider: string
  provider_email: string | null
  provider_name: string | null
  connected_at: string
}

/** 409 충돌 시 반환되는 에러 상세 타입 */
export interface OAuthConflictDetail {
  message: string
  merge_token: string
  provider: string
}

/**
 * OAuth 인가 URL 반환
 *
 * 브라우저를 이 URL로 리다이렉트하면 소셜 로그인 플로우가 시작됨.
 *
 * @param provider - 'kakao' | 'naver' | 'google'
 * @returns 백엔드 OAuth 인가 엔드포인트 URL
 */
export function getOAuthAuthorizeUrl(provider: string): string {
  return `${API_BASE_URL}/api/v1/auth/oauth/${provider}/authorize`
}

/**
 * OAuth 콜백 처리 API 호출
 *
 * 소셜 로그인 제공자로부터 전달된 code, state 파라미터를 백엔드로 전송.
 *
 * @param provider - 'kakao' | 'naver' | 'google'
 * @param code - 인가 코드
 * @param state - CSRF 방지 state 값
 * @returns JWT 토큰 및 신규 가입 여부
 * @throws 409 충돌 시 OAuthConflictDetail 포함 에러
 */
export async function oauthCallbackApi(
  provider: string,
  code: string,
  state: string,
): Promise<OAuthCallbackResponse> {
  const url = new URL(`${API_BASE_URL}/api/v1/auth/oauth/${provider}/callback`)
  url.searchParams.set('code', code)
  url.searchParams.set('state', state)

  const response = await fetch(url.toString(), { method: 'GET' })

  if (response.status === 409) {
    const error = await response.json().catch(() => ({ detail: {} }))
    const conflictError = new Error('이미 가입된 이메일입니다. 기존 계정에 연결하시겠습니까?')
    ;(conflictError as Error & { conflict: OAuthConflictDetail }).conflict = error.detail as OAuthConflictDetail
    throw conflictError
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '소셜 로그인에 실패했습니다.' }))
    throw new Error(
      typeof error.detail === 'string' ? error.detail : '소셜 로그인에 실패했습니다.',
    )
  }

  return response.json()
}

/**
 * OAuth 계정 병합 API 호출
 *
 * 기존 이메일 계정에 소셜 계정을 연결할 때 사용.
 *
 * @param payload - provider, merge_token, password
 * @returns JWT 토큰 및 신규 가입 여부
 */
export async function oauthMergeApi(payload: OAuthMergePayload): Promise<OAuthCallbackResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/oauth/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '계정 연결에 실패했습니다.' }))
    throw new Error(
      typeof error.detail === 'string' ? error.detail : '계정 연결에 실패했습니다.',
    )
  }

  return response.json()
}

/**
 * 연결된 소셜 계정 목록 조회
 *
 * @param token - JWT 액세스 토큰
 * @returns 소셜 계정 목록
 */
export async function getSocialAccountsApi(token: string): Promise<SocialAccountResponse[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/social-accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error('소셜 계정 목록을 불러오는데 실패했습니다.')
  }

  return response.json()
}

/**
 * 소셜 계정 연결 해제
 *
 * @param token - JWT 액세스 토큰
 * @param provider - 연결 해제할 소셜 제공자
 */
export async function unlinkSocialAccountApi(token: string, provider: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/social-accounts/${provider}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error('소셜 계정 연결 해제에 실패했습니다.')
  }
}
