'use client'

/**
 * 계정 병합 다이얼로그 컴포넌트 (SPEC-OAUTH-001)
 *
 * OAuth 콜백에서 409 충돌 응답 시 렌더링.
 * 기존 이메일 계정의 비밀번호를 입력받아 소셜 계정을 연결함.
 */

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import { oauthMergeApi } from '@/lib/auth'
import { useAuth } from '@/contexts/AuthContext'

interface AccountMergeDialogProps {
  /** OAuth 제공자 식별자 */
  provider: string
  /** 병합 요청에 필요한 임시 토큰 */
  mergeToken: string
}

/**
 * AccountMergeDialog 컴포넌트
 *
 * "연결" 버튼 클릭 시 oauthMergeApi 호출 후 /chat으로 이동.
 * "취소" 버튼 클릭 시 /login으로 이동.
 */
export function AccountMergeDialog({ provider, mergeToken }: AccountMergeDialogProps) {
  const router = useRouter()
  const { login } = useAuth()

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 제공자 한국어 표시명
  const providerLabel: Record<string, string> = {
    kakao: '카카오',
    naver: '네이버',
    google: '구글',
  }

  const handleMerge = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) {
      setError('비밀번호를 입력해주세요.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await oauthMergeApi({ provider, merge_token: mergeToken, password })
      login(result.access_token)
      router.push('/chat')
    } catch (err) {
      setError(err instanceof Error ? err.message : '계정 연결에 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    router.push('/login')
  }

  return (
    // 다이얼로그 오버레이
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white px-6 py-8 shadow-lg">
        <h2 className="mb-2 text-lg font-semibold text-[#1A1A1A]">이미 가입된 이메일입니다</h2>
        <p className="mb-6 text-sm text-[#666]">
          이 이메일 주소로 이미 가입된 계정이 있습니다.
          <br />
          기존 계정에 {providerLabel[provider] ?? provider} 로그인을 연결하려면
          <br />
          기존 계정의 비밀번호를 입력해주세요.
        </p>

        <form onSubmit={handleMerge} noValidate className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="merge-password" className="block text-sm font-medium text-[#1A1A1A]">
              비밀번호
            </label>
            <input
              id="merge-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A]"
              placeholder="기존 계정 비밀번호"
              disabled={isLoading}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isLoading}
              className="flex-1 rounded-md border border-[#E5E5E5] py-2.5 text-sm font-medium text-[#1A1A1A] transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 rounded-md bg-[#1A1A1A] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {isLoading ? '연결 중...' : '연결'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
