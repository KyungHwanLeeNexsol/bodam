/**
 * AuthContext 단위 테스트 (SPEC-AUTH-001 Module 5)
 *
 * JWT 저장, AuthContext 상태 관리, 로그아웃 동작을 검증.
 */

import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('AuthContext', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('AuthProvider가 렌더링되어야 한다', async () => {
    const { AuthProvider } = await import('@/contexts/AuthContext')
    render(
      <AuthProvider>
        <div>테스트 콘텐츠</div>
      </AuthProvider>
    )
    expect(screen.getByText('테스트 콘텐츠')).toBeDefined()
  })

  it('초기 상태는 미인증이어야 한다', async () => {
    const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

    function TestComponent() {
      const { isAuthenticated } = useAuth()
      return <div>{isAuthenticated ? 'authenticated' : 'unauthenticated'}</div>
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    expect(screen.getByText('unauthenticated')).toBeDefined()
  })

  it('login 호출 후 isAuthenticated가 true가 되어야 한다', async () => {
    const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

    function TestComponent() {
      const { isAuthenticated, login } = useAuth()
      return (
        <div>
          <span>{isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
          <button onClick={() => login('test.jwt.token')}>로그인</button>
        </div>
      )
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    expect(screen.getByText('unauthenticated')).toBeDefined()

    await act(async () => {
      screen.getByText('로그인').click()
    })

    expect(screen.getByText('authenticated')).toBeDefined()
  })

  it('login 호출 시 토큰이 localStorage에 저장되어야 한다', async () => {
    const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

    function TestComponent() {
      const { login } = useAuth()
      return <button onClick={() => login('test.jwt.token')}>로그인</button>
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    await act(async () => {
      screen.getByText('로그인').click()
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_token', 'test.jwt.token')
  })

  it('logout 호출 후 isAuthenticated가 false가 되어야 한다', async () => {
    const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

    function TestComponent() {
      const { isAuthenticated, login, logout } = useAuth()
      return (
        <div>
          <span>{isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
          <button onClick={() => login('test.jwt.token')}>로그인</button>
          <button onClick={() => logout()}>로그아웃</button>
        </div>
      )
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    await act(async () => {
      screen.getByText('로그인').click()
    })
    expect(screen.getByText('authenticated')).toBeDefined()

    await act(async () => {
      screen.getByText('로그아웃').click()
    })
    expect(screen.getByText('unauthenticated')).toBeDefined()
  })

  it('logout 호출 시 localStorage에서 토큰이 제거되어야 한다', async () => {
    const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

    function TestComponent() {
      const { login, logout } = useAuth()
      return (
        <div>
          <button onClick={() => login('test.jwt.token')}>로그인</button>
          <button onClick={() => logout()}>로그아웃</button>
        </div>
      )
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    await act(async () => {
      screen.getByText('로그인').click()
    })

    await act(async () => {
      screen.getByText('로그아웃').click()
    })

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_token')
  })

  it('localStorage에 토큰이 있으면 초기 상태가 인증됨이어야 한다', async () => {
    localStorageMock.getItem.mockReturnValueOnce('existing.jwt.token')

    const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

    function TestComponent() {
      const { isAuthenticated } = useAuth()
      return <div>{isAuthenticated ? 'authenticated' : 'unauthenticated'}</div>
    }

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('authenticated')).toBeDefined()
    })
  })
})
