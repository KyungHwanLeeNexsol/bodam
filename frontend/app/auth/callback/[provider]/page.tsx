'use client'

/**
 * OAuth 콜백 처리 페이지 (SPEC-OAUTH-001)
 *
 * 소셜 로그인 제공자로부터 리다이렉트된 후 처리를 담당.
 *
 * 플로우:
 *   1. URL의 code, state 파라미터 추출
 *   2. oauthCallbackApi 호출
 *   3. 성공: AuthContext login() 호출 후 /chat으로 이동
 *   4. 409 충돌: AccountMergeDialog 표시
 *   5. 오류: 에러 메시지 표시
 */

import { useRouter, useSearchParams } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'

import { AccountMergeDialog } from '@/components/auth/AccountMergeDialog'
import { useAuth } from '@/contexts/AuthContext'
import { oauthCallbackApi, OAuthConflictDetail } from '@/lib/auth'

interface MergeState {
  provider: string
  mergeToken: string
}

interface PageProps {
  params: Promise<{ provider: string }>
}

/**
 * OAuthCallbackPage 컴포넌트
 *
 * Next.js App Router의 동적 라우트 [provider] 파라미터 사용.
 */
export default function OAuthCallbackPage({ params }: PageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login } = useAuth()

  const [status, setStatus] = useState<'loading' | 'error' | 'merge'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mergeState, setMergeState] = useState<MergeState | null>(null)
  const [resolvedProvider, setResolvedProvider] = useState<string | null>(null)

  // 중복 실행 방지 ref (React Strict Mode 에서 두 번 실행되는 것 방지)
  const hasCalled = useRef(false)

  useEffect(() => {
    // params Promise 해제
    params.then(({ provider }) => {
      setResolvedProvider(provider)
    })
  }, [params])

  useEffect(() => {
    if (!resolvedProvider || hasCalled.current) return
    hasCalled.current = true

    const code = searchParams.get('code')
    const state = searchParams.get('state')

    // 비동기 함수 내에서 상태 업데이트 (lint 규칙: set-state-in-effect 방지)
    const processCallback = async () => {
      // 필수 파라미터 누락 시 오류
      if (!code || !state) {
        setStatus('error')
        setErrorMessage('소셜 로그인 정보가 올바르지 않습니다. 다시 시도해주세요.')
        return
      }

      try {
        const result = await oauthCallbackApi(resolvedProvider, code, state)
        login(result.access_token)
        router.push('/chat')
      } catch (err) {
        if (err instanceof Error) {
          // 409 충돌 처리: 기존 계정과 병합 다이얼로그 표시
          const conflictErr = err as Error & { conflict?: OAuthConflictDetail }
          if (conflictErr.conflict) {
            setMergeState({
              provider: conflictErr.conflict.provider,
              mergeToken: conflictErr.conflict.merge_token,
            })
            setStatus('merge')
            return
          }
          setErrorMessage(err.message)
        } else {
          setErrorMessage('소셜 로그인 처리 중 오류가 발생했습니다.')
        }
        setStatus('error')
      }
    }

    processCallback()
  }, [resolvedProvider, searchParams, login, router])

  // 병합 다이얼로그 상태
  if (status === 'merge' && mergeState) {
    return (
      <AccountMergeDialog provider={mergeState.provider} mergeToken={mergeState.mergeToken} />
    )
  }

  // 오류 상태
  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] px-4">
        <div className="w-full max-w-sm text-center">
          <p className="mb-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorMessage ?? '소셜 로그인에 실패했습니다.'}
          </p>
          <a
            href="/login"
            className="text-sm font-medium text-[#1A1A1A] underline underline-offset-4 hover:opacity-70"
          >
            로그인 페이지로 돌아가기
          </a>
        </div>
      </div>
    )
  }

  // 로딩 상태 (기본)
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
      <div className="text-center">
        <div
          className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#E5E5E5] border-t-[#1A1A1A]"
          role="status"
          aria-label="로그인 처리 중"
        />
        <p className="text-sm text-[#666]">소셜 로그인 처리 중...</p>
      </div>
    </div>
  )
}
