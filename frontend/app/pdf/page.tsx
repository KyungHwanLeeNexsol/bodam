'use client'

/**
 * PDF 분석 메인 페이지 (SPEC-PDF-001)
 *
 * 인증이 필요한 페이지. 미인증 시 /login으로 리다이렉트.
 * 상태 머신: idle -> uploading -> analyzing -> ready
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { analyzePdfApi } from '@/lib/pdf'
import type { CoverageAnalysis, TokenUsage } from '@/lib/pdf'
import PDFUploader from '@/components/pdf/PDFUploader'
import AnalysisResult from '@/components/pdf/AnalysisResult'
import PDFChat from '@/components/pdf/PDFChat'
import SessionList from '@/components/pdf/SessionList'

type PageState = 'idle' | 'analyzing' | 'ready'

interface AnalysisData {
  sessionId: string
  uploadId: string
  filename: string
  analysis: CoverageAnalysis
  tokenUsage: TokenUsage
}

export default function PDFPage() {
  const router = useRouter()
  const { token, isAuthenticated, isInitialized } = useAuth()

  const [pageState, setPageState] = useState<PageState>('idle')
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // 인증 확인 - 초기화 완료 후 토큰 없으면 로그인 페이지로 이동
  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      void router.push('/login')
    }
  }, [isInitialized, isAuthenticated, router])

  const handleUploadComplete = useCallback(
    async (uploadId: string, filename: string) => {
      if (!token) return

      setPageState('analyzing')
      setAnalyzeError(null)

      try {
        const result = await analyzePdfApi(uploadId, token)
        setAnalysisData({
          sessionId: result.session_id,
          uploadId,
          filename,
          analysis: result.analysis,
          tokenUsage: result.token_usage,
        })
        setPageState('ready')
      } catch (err) {
        setAnalyzeError(err instanceof Error ? err.message : 'PDF 분석에 실패했습니다.')
        setPageState('idle')
      }
    },
    [token]
  )

  const handleSelectSession = useCallback((sessionId: string) => {
    void router.push(`/pdf/${sessionId}`)
  }, [router])

  // 인증 로딩 중이면 아무것도 렌더링하지 않음
  if (!token) {
    return null
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* 헤더 */}
      <header className="border-b border-[#E5E5E5] bg-white px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/chat" className="text-sm text-[#666] hover:text-[#1A1A1A]">
              AI 상담
            </a>
            <span className="text-[#E5E5E5]">/</span>
            <h1 className="text-sm font-semibold text-[#1A1A1A]">약관 PDF 분석</h1>
          </div>
          <a
            href="/chat"
            className="rounded-md border border-[#E5E5E5] px-3 py-1.5 text-xs text-[#666] hover:bg-gray-50"
          >
            AI 상담으로 돌아가기
          </a>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          {/* 왼쪽 컬럼: 업로더 + 세션 목록 */}
          <div className="space-y-6">
            {/* PDF 업로더 */}
            <div className="rounded-xl border border-[#E5E5E5] bg-white p-4">
              <h2 className="mb-4 text-sm font-semibold text-[#1A1A1A]">약관 PDF 업로드</h2>
              {pageState === 'idle' && (
                <PDFUploader token={token} onUploadComplete={(id, name) => void handleUploadComplete(id, name)} />
              )}
              {pageState === 'analyzing' && (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#E5E5E5] border-t-[#1A1A1A]" />
                  <p className="text-sm text-[#666]">약관을 분석하고 있습니다...</p>
                  <p className="mt-1 text-xs text-[#999]">잠시만 기다려주세요</p>
                </div>
              )}
              {pageState === 'ready' && analysisData && (
                <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2">
                  <svg
                    className="h-4 w-4 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <div>
                    <p className="text-xs font-medium text-green-700">분석 완료</p>
                    <p className="text-xs text-green-600 truncate max-w-[200px]">{analysisData.filename}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPageState('idle')
                      setAnalysisData(null)
                    }}
                    className="ml-auto text-xs text-green-600 hover:underline"
                  >
                    새 파일
                  </button>
                </div>
              )}

              {/* 분석 오류 */}
              {analyzeError && (
                <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                  {analyzeError}
                </p>
              )}
            </div>

            {/* 세션 목록 */}
            <div className="rounded-xl border border-[#E5E5E5] bg-white p-4">
              <SessionList token={token} onSelectSession={handleSelectSession} />
            </div>
          </div>

          {/* 오른쪽 컬럼: 분석 결과 + 채팅 */}
          <div className="space-y-4">
            {pageState === 'idle' && !analysisData && (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#E5E5E5] bg-white py-20">
                <svg
                  className="mb-4 h-12 w-12 text-[#CCC]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-sm font-medium text-[#999]">PDF를 업로드하면 분석 결과가 여기에 표시됩니다</p>
                <p className="mt-1 text-xs text-[#CCC]">
                  담보목록, 보상조건, 면책사항을 자동으로 추출합니다
                </p>
              </div>
            )}

            {pageState === 'ready' && analysisData && (
              <>
                {/* 분석 결과 */}
                <div className="rounded-xl border border-[#E5E5E5] bg-white p-4">
                  <AnalysisResult
                    analysis={analysisData.analysis}
                    tokenUsage={analysisData.tokenUsage}
                  />
                </div>

                {/* 채팅 */}
                <div className="rounded-xl border border-[#E5E5E5] bg-white p-4">
                  <PDFChat
                    uploadId={analysisData.uploadId}
                    sessionId={analysisData.sessionId}
                    token={token}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
