'use client'

/**
 * 로그인 폼 컴포넌트 (SPEC-AUTH-001 Module 5)
 *
 * react-hook-form + zod 유효성 검사 기반 로그인 폼.
 * 성공 시 JWT를 AuthContext에 저장하고 /chat으로 리다이렉트.
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { useAuth } from '@/contexts/AuthContext'
import { loginApi } from '@/lib/auth'

// 로그인 폼 유효성 스키마
const loginSchema = z.object({
  email: z.string().min(1, '이메일을 입력해주세요.').email('유효한 이메일 주소를 입력해주세요.'),
  password: z.string().min(1, '비밀번호를 입력해주세요.'),
})

type LoginFormData = z.infer<typeof loginSchema>

/**
 * LoginForm 컴포넌트
 *
 * 이메일/비밀번호 로그인 폼. 한국어 오류 메시지 표시.
 */
export function LoginForm() {
  const router = useRouter()
  const { login } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true)
    setServerError(null)

    try {
      const tokenResponse = await loginApi({
        email: data.email,
        password: data.password,
      })
      login(tokenResponse.access_token)
      router.push('/chat')
    } catch (error) {
      setServerError(error instanceof Error ? error.message : '이메일 또는 비밀번호가 올바르지 않습니다')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div>
        <label htmlFor="email">이메일</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          {...register('email')}
        />
        {errors.email && (
          <p role="alert" className="error">
            {errors.email.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register('password')}
        />
        {errors.password && (
          <p role="alert" className="error">
            {errors.password.message}
          </p>
        )}
      </div>

      {serverError && (
        <p role="alert" className="error">
          {serverError}
        </p>
      )}

      <button type="submit" disabled={isLoading}>
        {isLoading ? '로그인 중...' : '로그인'}
      </button>
    </form>
  )
}
