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
import { SocialLoginButtons } from './SocialLoginButtons'

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
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {/* 소셜 로그인 버튼 */}
      <SocialLoginButtons />

      {/* 구분선 */}
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[#E5E5E5]" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-2 text-[#AAAAAA]">또는</span>
        </div>
      </div>

      {/* 이메일 필드 */}
      <div className="space-y-1">
        <label htmlFor="email" className="block text-[13px] font-medium text-[#1A1A1A]">
          이메일
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="w-full rounded-lg border border-[#E5E5E5] px-3.5 py-3 text-sm text-[#1A1A1A] placeholder-[#AAAAAA] outline-none focus:border-[#0D6E6E] focus:ring-1 focus:ring-[#0D6E6E]"
          placeholder="name@example.com"
          {...register('email')}
        />
        {errors.email && (
          <p role="alert" className="text-xs text-red-500">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* 비밀번호 필드 */}
      <div className="space-y-1">
        <label htmlFor="password" className="block text-[13px] font-medium text-[#1A1A1A]">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-lg border border-[#E5E5E5] px-3.5 py-3 text-sm text-[#1A1A1A] placeholder-[#AAAAAA] outline-none focus:border-[#0D6E6E] focus:ring-1 focus:ring-[#0D6E6E]"
          placeholder="비밀번호를 입력하세요"
          {...register('password')}
        />
        {errors.password && (
          <p role="alert" className="text-xs text-red-500">
            {errors.password.message}
          </p>
        )}
      </div>

      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {serverError}
        </p>
      )}

      {/* 로그인 버튼 */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-lg bg-[#0D6E6E] py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {isLoading ? '로그인 중...' : '로그인'}
      </button>

      {/* 비밀번호 찾기 */}
      <p className="text-center">
        <a href="#" className="text-[13px] text-[#0D6E6E] hover:underline">
          비밀번호를 잊으셨나요?
        </a>
      </p>
    </form>
  )
}
