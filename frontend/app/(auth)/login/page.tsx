/**
 * 로그인 페이지 (SPEC-AUTH-001 Module 5)
 *
 * Pencil 디자인(frame c43j1) 기준으로 구현:
 * - 로고 + 서브타이틀
 * - 탭 토글 (로그인/회원가입)
 * - LoginForm (소셜 → 구분선 → 이메일/비밀번호)
 * - 하단 회원가입 링크
 */

import Link from 'next/link'
import React from 'react'

import { LoginForm } from '@/components/auth/LoginForm'
import Logo from '@/components/ui/Logo'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
      {/* 카드: cornerRadius 16, padding [32,36], width 420 */}
      <div
        className="w-full bg-white"
        style={{
          maxWidth: 420,
          borderRadius: 16,
          padding: '32px 36px',
          boxShadow: '0 4px 24px 0 #00000008',
          border: '1px solid #E5E5E5',
        }}
      >
        {/* 로고 섹션 */}
        <div className="mb-6 flex flex-col items-center">
          <Link href="/" className="cursor-pointer">
            <Logo size="md" />
          </Link>
        </div>

        {/* 탭 토글: 로그인/회원가입 */}
        <div
          className="mb-6 flex gap-1"
          style={{
            backgroundColor: '#F0F0F0',
            borderRadius: 8,
            padding: 4,
          }}
        >
          {/* 로그인 탭 (활성) */}
          <div
            className="flex-1 py-2 text-center text-sm font-semibold text-[#1A1A1A]"
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 6,
              boxShadow: '0 1px 4px 0 #00000010',
            }}
          >
            로그인
          </div>
          {/* 회원가입 탭 (비활성) */}
          <Link
            href="/register"
            className="flex-1 cursor-pointer py-2 text-center text-sm font-medium text-[#AAAAAA] hover:text-[#1A1A1A] transition-colors"
          >
            회원가입
          </Link>
        </div>

        {/* 로그인 폼 */}
        <LoginForm />

        {/* 하단 회원가입 링크 */}
        <p className="mt-6 text-center text-[13px] text-[#888888]">
          계정이 없으신가요?{' '}
          <Link href="/register" className="cursor-pointer font-semibold text-[#0D6E6E] hover:underline">
            회원가입
          </Link>
        </p>
      </div>
    </div>
  )
}
