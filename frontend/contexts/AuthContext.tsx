'use client'

/**
 * 인증 Context (SPEC-AUTH-001 Module 5)
 *
 * JWT 토큰을 localStorage에 저장하고 전역 인증 상태를 관리.
 * SPEC-CHAT-UX-001: userProfile 상태 추가 (email, fullName)
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// localStorage 키 상수
const AUTH_TOKEN_KEY = 'auth_token'

// @MX:NOTE: [AUTO] UserProfile - /api/v1/auth/me 응답에서 추출한 사용자 정보
interface UserProfile {
  email: string
  fullName: string | null
}

interface AuthContextValue {
  /** 현재 인증 여부 */
  isAuthenticated: boolean
  /** localStorage 초기화 완료 여부 (토큰 확인 전 리다이렉트 방지용) */
  isInitialized: boolean
  /** 저장된 JWT 토큰 */
  token: string | null
  /** 사용자 프로필 (email, fullName) - 로그인 후 /api/v1/auth/me 조회 결과 */
  userProfile: UserProfile | null
  /** 로그인 처리: 토큰 저장 및 인증 상태 업데이트 */
  login: (token: string) => void
  /** 로그아웃 처리: 토큰 제거 및 인증 상태 초기화 */
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * AuthProvider 컴포넌트
 *
 * 애플리케이션 루트에 배치하여 하위 컴포넌트에서 useAuth 훅 사용 가능.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  // 로그인 시각 추적 - login() 직후 fetchUserProfile 401 경쟁 조건 방지용
  const loginTimestampRef = useRef<number>(0)

  // @MX:NOTE: [AUTO] fetchUserProfile - 토큰으로 /api/v1/auth/me 호출, 401 시 자동 로그아웃
  // @MX:WARN: [AUTO] 경쟁 조건 방지 - 401 시 현재 저장된 토큰과 요청 토큰이 같을 때만 삭제
  // @MX:REASON: OAuth 콜백에서 login(새토큰) 후 이전 fetchUserProfile(만료토큰)이 401로 새 토큰을 삭제하는 버그 방지
  const fetchUserProfile = useCallback(async (authToken: string) => {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || ''
      const res = await fetch(`${apiBase}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (res.ok) {
        const data = await res.json() as { email: string; full_name: string | null }
        setUserProfile({ email: data.email, fullName: data.full_name ?? null })
      } else if (res.status === 401) {
        // 경쟁 조건 방지 1: 요청한 토큰이 현재 저장된 토큰과 같을 때만 로그아웃
        // 경쟁 조건 방지 2: login() 직후 3초 이내 401은 일시적 오류로 간주하여 무시
        const currentToken = localStorage.getItem(AUTH_TOKEN_KEY)
        const isRecentLogin = Date.now() - loginTimestampRef.current < 3000
        if (currentToken === authToken && !isRecentLogin) {
          localStorage.removeItem(AUTH_TOKEN_KEY)
          document.cookie = `${AUTH_TOKEN_KEY}=; path=/; max-age=0`
          setToken(null)
          setIsAuthenticated(false)
          setUserProfile(null)
        }
      }
    } catch {
      // 네트워크 오류 시 인증 상태 유지 (오프라인 등)
    }
  }, [])

  // 마운트 시 localStorage에서 토큰 복원
  useEffect(() => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY)
    if (storedToken) {
      setToken(storedToken)
      setIsAuthenticated(true)
      void fetchUserProfile(storedToken)
    }
    setIsInitialized(true)
  }, [fetchUserProfile])

  const login = useCallback((newToken: string) => {
    loginTimestampRef.current = Date.now()
    localStorage.setItem(AUTH_TOKEN_KEY, newToken)
    document.cookie = `${AUTH_TOKEN_KEY}=${newToken}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`
    setToken(newToken)
    setIsAuthenticated(true)
    void fetchUserProfile(newToken)
  }, [fetchUserProfile])

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    document.cookie = `${AUTH_TOKEN_KEY}=; path=/; max-age=0`
    setToken(null)
    setIsAuthenticated(false)
    setUserProfile(null)
  }, [])

  return (
    <AuthContext.Provider value={{ isAuthenticated, isInitialized, token, userProfile, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * 인증 컨텍스트 훅
 *
 * AuthProvider 하위에서만 사용 가능.
 *
 * @throws AuthProvider 외부에서 사용 시 오류
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth는 AuthProvider 내부에서만 사용할 수 있습니다.')
  }
  return ctx
}
