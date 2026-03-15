'use client'

/**
 * 소셜 로그인 버튼 컴포넌트 (SPEC-OAUTH-001)
 *
 * 카카오, 네이버, 구글 OAuth2 로그인 버튼 제공.
 * 각 버튼 클릭 시 백엔드 OAuth 인가 엔드포인트로 리다이렉트.
 */

import React from 'react'

import { getOAuthAuthorizeUrl } from '@/lib/auth'

interface SocialButtonConfig {
  /** OAuth 제공자 식별자 */
  provider: string
  /** 버튼에 표시할 레이블 */
  label: string
  /** 버튼 배경색 */
  bgColor: string
  /** 버튼 텍스트 색상 */
  textColor: string
  /** 버튼 테두리 색상 (선택) */
  borderColor?: string
}

// 소셜 로그인 버튼 설정 목록
const SOCIAL_BUTTONS: SocialButtonConfig[] = [
  { provider: 'kakao', label: '카카오로 로그인', bgColor: '#FEE500', textColor: '#000000' },
  { provider: 'naver', label: '네이버로 로그인', bgColor: '#03C75A', textColor: '#FFFFFF' },
  {
    provider: 'google',
    label: '구글로 로그인',
    bgColor: '#FFFFFF',
    textColor: '#1A1A1A',
    borderColor: '#E5E5E5',
  },
]

/**
 * SocialLoginButtons 컴포넌트
 *
 * LoginForm / RegisterForm 하단에 렌더링.
 * 버튼 클릭 시 window.location.href로 백엔드 OAuth 인가 URL로 이동.
 */
export function SocialLoginButtons() {
  // OAuth 인가 URL로 전체 페이지 이동 (window.location.assign 사용으로 immutability 규칙 준수)
  const handleSocialLogin = (provider: string) => {
    window.location.assign(getOAuthAuthorizeUrl(provider))
  }

  return (
    <div className="space-y-2">
      {SOCIAL_BUTTONS.map(({ provider, label, bgColor, textColor, borderColor }) => (
        <button
          key={provider}
          type="button"
          onClick={() => handleSocialLogin(provider)}
          className="w-full rounded-md py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: bgColor,
            color: textColor,
            border: borderColor ? `1px solid ${borderColor}` : 'none',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
