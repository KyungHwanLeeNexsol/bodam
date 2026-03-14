/**
 * 회원가입 페이지 (SPEC-AUTH-001 Module 5)
 */

import React from 'react'
import { RegisterForm } from '@/components/auth/RegisterForm'

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-bold text-[#1A1A1A]">회원가입</h1>
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-[#666666]">
          이미 계정이 있으신가요?{' '}
          <a href="/login" className="text-blue-600 hover:underline">
            로그인
          </a>
        </p>
      </div>
    </div>
  )
}
