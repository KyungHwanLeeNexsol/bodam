'use client'

/**
 * 인증 Context (SPEC-AUTH-001 Module 5)
 *
 * JWT 토큰을 localStorage에 저장하고 전역 인증 상태를 관리.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

// localStorage 키 상수
const AUTH_TOKEN_KEY = 'auth_token'

interface AuthContextValue {
  /** 현재 인증 여부 */
  isAuthenticated: boolean
  /** 저장된 JWT 토큰 */
  token: string | null
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

  // 마운트 시 localStorage에서 토큰 복원
  useEffect(() => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY)
    if (storedToken) {
      setToken(storedToken)
      setIsAuthenticated(true)
    }
  }, [])

  const login = useCallback((newToken: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, newToken)
    document.cookie = `${AUTH_TOKEN_KEY}=${newToken}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`
    setToken(newToken)
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    document.cookie = `${AUTH_TOKEN_KEY}=; path=/; max-age=0`
    setToken(null)
    setIsAuthenticated(false)
  }, [])

  return (
    <AuthContext.Provider value={{ isAuthenticated, token, login, logout }}>
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
