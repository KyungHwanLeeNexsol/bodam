/**
 * AuthContext 단위 테스트 (SPEC-AUTH-001 Module 5)
 *
 * JWT 저장, AuthContext 상태 관리, 로그아웃 동작을 검증.
 */

import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

  describe('userProfile', () => {
    beforeEach(() => {
      // fetch 전역 모킹
      vi.stubGlobal('fetch', vi.fn())
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('초기 상태에서 userProfile은 null이어야 한다', async () => {
      const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

      function TestComponent() {
        const { userProfile } = useAuth()
        return <div>{userProfile ? 'has-profile' : 'no-profile'}</div>
      }

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      )

      expect(screen.getByText('no-profile')).toBeDefined()
    })

    it('login 후 userProfile이 설정되어야 한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'uuid-1',
          email: 'test@example.com',
          full_name: '홍길동',
          is_active: true,
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

      function TestComponent() {
        const { userProfile, login } = useAuth()
        return (
          <div>
            <span data-testid="profile-email">{userProfile?.email ?? 'none'}</span>
            <span data-testid="profile-name">{userProfile?.fullName ?? 'none'}</span>
            <button onClick={() => login('test.jwt.token')}>로그인</button>
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

      await waitFor(() => {
        expect(screen.getByTestId('profile-email').textContent).toBe('test@example.com')
        expect(screen.getByTestId('profile-name').textContent).toBe('홍길동')
      })
    })

    it('full_name이 null이면 userProfile.fullName이 null이어야 한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'uuid-1',
          email: 'noname@example.com',
          full_name: null,
          is_active: true,
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

      function TestComponent() {
        const { userProfile, login } = useAuth()
        return (
          <div>
            <span data-testid="profile-name">{userProfile?.fullName ?? 'null-name'}</span>
            <button onClick={() => login('test.jwt.token')}>로그인</button>
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

      await waitFor(() => {
        expect(screen.getByTestId('profile-name').textContent).toBe('null-name')
      })
    })

    it('logout 후 userProfile이 null로 초기화되어야 한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'uuid-1',
          email: 'test@example.com',
          full_name: '홍길동',
          is_active: true,
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

      function TestComponent() {
        const { userProfile, login, logout } = useAuth()
        return (
          <div>
            <span data-testid="profile-email">{userProfile?.email ?? 'none'}</span>
            <button onClick={() => login('test.jwt.token')}>로그인</button>
            <button onClick={logout}>로그아웃</button>
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

      await waitFor(() => {
        expect(screen.getByTestId('profile-email').textContent).toBe('test@example.com')
      })

      await act(async () => {
        screen.getByText('로그아웃').click()
      })

      expect(screen.getByTestId('profile-email').textContent).toBe('none')
    })

    it('localStorage에 토큰이 있으면 마운트 시 userProfile을 조회해야 한다', async () => {
      localStorageMock.getItem.mockReturnValueOnce('existing.jwt.token')

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'uuid-1',
          email: 'restored@example.com',
          full_name: '복원사용자',
          is_active: true,
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const { AuthProvider, useAuth } = await import('@/contexts/AuthContext')

      function TestComponent() {
        const { userProfile } = useAuth()
        return <span data-testid="profile-email">{userProfile?.email ?? 'none'}</span>
      }

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('profile-email').textContent).toBe('restored@example.com')
      })
    })
  })
})
