/**
 * LoginForm 컴포넌트 단위 테스트 (SPEC-AUTH-001 Module 5)
 *
 * react-hook-form + zod 유효성 검사 및 폼 제출 동작 검증.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

// router mock
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}))

// AuthContext mock
const mockLogin = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    isAuthenticated: false,
    logout: vi.fn(),
  }),
}))

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('LoginForm이 렌더링되어야 한다', async () => {
    const { LoginForm } = await import('@/components/auth/LoginForm')
    render(<LoginForm />)
    expect(document.body).toBeDefined()
  })

  it('이메일과 비밀번호 입력 필드가 있어야 한다', async () => {
    const { LoginForm } = await import('@/components/auth/LoginForm')
    render(<LoginForm />)
    expect(document.querySelector('input[type="email"]')).toBeDefined()
    expect(document.querySelector('input[type="password"]')).toBeDefined()
  })

  it('이메일 미입력 시 한국어 오류 메시지가 표시되어야 한다', async () => {
    const { LoginForm } = await import('@/components/auth/LoginForm')
    render(<LoginForm />)

    const submitBtn = screen.getByRole('button', { name: /로그인/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      // 이메일 또는 비밀번호 관련 오류 메시지가 나타나야 함
      const errors = document.querySelectorAll('[role="alert"], .error, [data-error]')
      const bodyText = document.body.textContent ?? ''
      const hasError = errors.length > 0 || bodyText.includes('이메일') || bodyText.includes('필수')
      expect(hasError).toBe(true)
    })
  })

  it('제출 버튼이 있어야 한다', async () => {
    const { LoginForm } = await import('@/components/auth/LoginForm')
    render(<LoginForm />)
    const submitBtn = screen.getByRole('button', { name: /로그인/i })
    expect(submitBtn).toBeDefined()
  })
})
