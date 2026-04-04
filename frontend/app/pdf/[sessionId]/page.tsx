'use client'

/**
 * PDF 세션 상세 페이지 (SPEC-PDF-001)
 *
 * 특정 세션의 분석 결과와 메시지 히스토리를 표시.
 * 인증 필요. 미인증 시 /login으로 리다이렉트.
 */

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getSessionApi } from '@/lib/pdf'
import type { SessionDetail } from '@/lib/pdf'
import AnalysisResult from '@/components/pdf/AnalysisResult'
import PDFChat from '@/components/pdf/PDFChat'

interface PageProps {
  params: Promise<{ sessionId: string }>
}

export default function PDFSessionPage({ params }: PageProps) {
  const { sessionId } = use(params)
  const router = useRouter()
  const { token, isAuthenticated, isInitialized } = useAuth()

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 인증 확인 - 초기화 완료 후 토큰 없으면 로그인 페이지로 이동
  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      void router.push('/login')
    }
  }, [isInitialized, isAuthenticated, router])

  // 세션 데이터 로드
  useEffect(() => {
    if (!token || !sessionId) return

    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await getSessionApi(sessionId, token)
        setSession(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : '세션을 불러오지 못했습니다.')
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [sessionId, token])

  if (!token) {
    return null
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* 헤더 */}
      <header className="border-b border-[#E5E5E5] bg-white px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/pdf')}
            className="flex items-center gap-1.5 text-sm text-[#666] hover:text-[#1A1A1A]"
            aria-label="PDF 분석 목록으로 돌아가기"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            돌아가기
          </button>
          <span className="text-[#E5E5E5]">/</span>
          <h1 className="truncate text-sm font-semibold text-[#1A1A1A]">
            {isLoading ? '세션 불러오는 중...' : (session?.title ?? '세션 상세')}
          </h1>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 md:px-6">
        {/* 로딩 상태 */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#E5E5E5] border-t-[#1A1A1A]" />
            <p className="text-sm text-[#666]">세션을 불러오고 있습니다...</p>
          </div>
        )}

        {/* 오류 상태 */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
            <button
              type="button"
              onClick={() => router.push('/pdf')}
              className="mt-2 text-xs text-red-600 underline hover:no-underline"
            >
              목록으로 돌아가기
            </button>
          </div>
        )}

        {/* 세션 데이터 */}
        {!isLoading && session && (
          <>
            {/* 분석 결과 */}
            {session.initial_analysis && (
              <div className="rounded-xl border border-[#E5E5E5] bg-white p-4">
                <AnalysisResult
                  analysis={session.initial_analysis}
                  tokenUsage={{ input_tokens: 0, output_tokens: 0, cost_usd: 0 }}
                />
              </div>
            )}

            {/* 채팅 */}
            {session.upload_id && (
              <div className="rounded-xl border border-[#E5E5E5] bg-white p-4">
                <PDFChat
                  uploadId={session.upload_id}
                  sessionId={session.id}
                  token={token}
                  initialMessages={session.messages}
                />
              </div>
            )}

            {/* 업로드 ID가 없는 경우 */}
            {!session.upload_id && (
              <div className="rounded-xl border border-[#E5E5E5] bg-white p-8 text-center">
                <p className="text-sm text-[#999]">이 세션에는 연결된 PDF가 없습니다.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
