'use client'

/**
 * 회원가입 폼 컴포넌트 (SPEC-AUTH-001 Module 5)
 *
 * react-hook-form + zod 유효성 검사 기반 회원가입 폼.
 * 성공 시 /login으로 리다이렉트.
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { registerApi } from '@/lib/auth'
import { SocialLoginButtons } from './SocialLoginButtons'

// 회원가입 완료 모달 컴포넌트
function RegisterSuccessModal({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white px-6 py-8 shadow-lg text-center">
        {/* 체크 아이콘 */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#E6F4F4]">
          <svg
            className="h-7 w-7 text-[#0D6E6E]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-[#1A1A1A]">회원가입이 완료되었습니다!</h2>
        <p className="mb-6 text-sm text-[#666]">
          보담에 오신 것을 환영합니다.
          <br />
          로그인 후 서비스를 이용해보세요.
        </p>
        <button
          type="button"
          onClick={onConfirm}
          className="w-full rounded-lg bg-[#0D6E6E] py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-80"
        >
          로그인하러 가기
        </button>
      </div>
    </div>
  )
}

// 회원가입 폼 유효성 스키마
const registerSchema = z.object({
  email: z.string().min(1, '이메일을 입력해주세요.').email('유효한 이메일 주소를 입력해주세요.'),
  password: z
    .string()
    .min(8, '비밀번호는 최소 8자 이상이어야 합니다.')
    .refine((v) => !v.match(/^[a-zA-Z]+$/), '비밀번호는 알파벳만으로 구성될 수 없습니다.')
    .refine((v) => !v.match(/^\d+$/), '비밀번호는 숫자만으로 구성될 수 없습니다.'),
  full_name: z.string().optional(),
})

type RegisterFormData = z.infer<typeof registerSchema>

/**
 * RegisterForm 컴포넌트
 *
 * 이메일/비밀번호/이름 회원가입 폼. 한국어 오류 메시지 표시.
 */
export function RegisterForm() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true)
    setServerError(null)

    try {
      await registerApi({
        email: data.email,
        password: data.password,
        full_name: data.full_name,
      })
      setShowSuccessModal(true)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : '회원가입에 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      {showSuccessModal && (
        <RegisterSuccessModal onConfirm={() => router.push('/login')} />
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium text-[#1A1A1A]">
          이메일
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="w-full rounded-md border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] placeholder-[#999] outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A]"
          placeholder="example@email.com"
          {...register('email')}
        />
        {errors.email && (
          <p role="alert" className="text-xs text-red-500">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium text-[#1A1A1A]">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          className="w-full rounded-md border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A]"
          placeholder="8자 이상 입력"
          {...register('password')}
        />
        {errors.password && (
          <p role="alert" className="text-xs text-red-500">
            {errors.password.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="full_name" className="block text-sm font-medium text-[#1A1A1A]">
          이름 <span className="text-[#999]">(선택)</span>
        </label>
        <input
          id="full_name"
          type="text"
          autoComplete="name"
          className="w-full rounded-md border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] placeholder-[#999] outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A]"
          placeholder="홍길동"
          {...register('full_name')}
        />
      </div>

      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-md bg-[#1A1A1A] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {isLoading ? '가입 중...' : '회원가입'}
      </button>

      {/* 소셜 로그인 구분선 */}
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[#E5E5E5]" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-2 text-[#999]">또는</span>
        </div>
      </div>

      {/* 소셜 로그인 버튼 */}
        <SocialLoginButtons />
      </form>
    </>
  )
}
