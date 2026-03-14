/**
 * 로그인 페이지 (SPEC-AUTH-001 Module 5)
 */

import React from 'react'
import { LoginForm } from '@/components/auth/LoginForm'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-bold text-[#1A1A1A]">로그인</h1>
        <LoginForm />
        <p className="mt-4 text-center text-sm text-[#666666]">
          계정이 없으신가요?{' '}
          <a href="/register" className="text-blue-600 hover:underline">
            회원가입
          </a>
        </p>
      </div>
    </div>
  )
}
