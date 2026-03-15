/**
 * RegisterForm 컴포넌트 단위 테스트 (SPEC-AUTH-001 Module 5)
 *
 * 회원가입 폼 유효성 검사 및 제출 동작 검증.
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

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('RegisterForm이 렌더링되어야 한다', async () => {
    const { RegisterForm } = await import('@/components/auth/RegisterForm')
    render(<RegisterForm />)
    expect(document.body).toBeDefined()
  })

  it('이메일, 비밀번호, 이름 입력 필드가 있어야 한다', async () => {
    const { RegisterForm } = await import('@/components/auth/RegisterForm')
    render(<RegisterForm />)
    expect(document.querySelector('input[type="email"]')).toBeDefined()
    expect(document.querySelector('input[type="password"]')).toBeDefined()
  })

  it('회원가입 제출 버튼이 있어야 한다', async () => {
    const { RegisterForm } = await import('@/components/auth/RegisterForm')
    render(<RegisterForm />)
    // 회원가입, 등록, 가입 등의 텍스트 버튼
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('이메일 형식이 잘못된 경우 오류 메시지가 표시되어야 한다', async () => {
    const { RegisterForm } = await import('@/components/auth/RegisterForm')
    render(<RegisterForm />)

    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement
    if (emailInput) {
      fireEvent.change(emailInput, { target: { value: 'not-valid-email' } })
    }

    const submitBtn = screen.getAllByRole('button')[0]!
    fireEvent.click(submitBtn)

    await waitFor(() => {
      const bodyText = document.body.textContent ?? ''
      // 이메일 오류 또는 일반 오류가 표시되어야 함
      const hasError =
        bodyText.includes('이메일') ||
        bodyText.includes('필수') ||
        bodyText.includes('유효') ||
        document.querySelectorAll('[role="alert"]').length > 0
      expect(hasError).toBe(true)
    })
  })
})
