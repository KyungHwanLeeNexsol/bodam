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
      router.push('/login')
    } catch (error) {
      setServerError(error instanceof Error ? error.message : '회원가입에 실패했습니다.')
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
          autoComplete="new-password"
          {...register('password')}
        />
        {errors.password && (
          <p role="alert" className="error">
            {errors.password.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="full_name">이름 (선택)</label>
        <input
          id="full_name"
          type="text"
          autoComplete="name"
          {...register('full_name')}
        />
      </div>

      {serverError && (
        <p role="alert" className="error">
          {serverError}
        </p>
      )}

      <button type="submit" disabled={isLoading}>
        {isLoading ? '가입 중...' : '회원가입'}
      </button>
    </form>
  )
}
