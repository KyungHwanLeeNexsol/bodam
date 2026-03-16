/**
 * 회원가입 페이지 (SPEC-AUTH-001 Module 5)
 *
 * Pencil 디자인 기준으로 로그인 페이지와 동일한 카드/로고/탭 UI 적용.
 * 회원가입 탭이 활성 상태.
 */

import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

import { RegisterForm } from '@/components/auth/RegisterForm'

export default function RegisterPage() {
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
          <Image src="/logo.png" alt="보담" width={90} height={30} priority />
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
          {/* 로그인 탭 (비활성) */}
          <Link
            href="/login"
            className="flex-1 py-2 text-center text-sm font-medium text-[#AAAAAA] hover:text-[#1A1A1A] transition-colors"
          >
            로그인
          </Link>
          {/* 회원가입 탭 (활성) */}
          <div
            className="flex-1 py-2 text-center text-sm font-semibold text-[#1A1A1A]"
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 6,
              boxShadow: '0 1px 4px 0 #00000010',
            }}
          >
            회원가입
          </div>
        </div>

        {/* 회원가입 폼 */}
        <RegisterForm />

        {/* 하단 로그인 링크 */}
        <p className="mt-6 text-center text-[13px] text-[#888888]">
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="font-semibold text-[#0D6E6E] hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  )
}
