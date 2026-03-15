'use client'

/**
 * PDF 세션 목록 컴포넌트 (SPEC-PDF-001)
 *
 * 과거 PDF 분석 세션 목록을 카드 형태로 표시.
 * 세션 선택 및 삭제 기능 지원.
 */

import { useCallback, useEffect, useState } from 'react'
import { listSessionsApi, deleteSessionApi } from '@/lib/pdf'
import type { Session } from '@/lib/pdf'

interface SessionListProps {
  token: string
  onSelectSession: (sessionId: string) => void
}

const DEFAULT_STATUS = { label: '활성', className: 'bg-green-100 text-green-700' } as const

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: DEFAULT_STATUS,
  expired: { label: '만료', className: 'bg-gray-100 text-gray-500' },
  deleted: { label: '삭제됨', className: 'bg-red-100 text-red-400 line-through' },
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * SessionList 컴포넌트
 *
 * 분석 세션 목록 표시. 삭제 시 인라인 확인 UI(모달 없음) 사용.
 */
export default function SessionList({ token, onSelectSession }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await listSessionsApi(token)
        setSessions(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : '세션 목록을 불러오지 못했습니다.')
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [token])

  const handleDelete = useCallback(
    async (sessionId: string) => {
      setDeletingId(sessionId)
      setConfirmDeleteId(null)
      try {
        await deleteSessionApi(sessionId, token)
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      } catch (err) {
        setError(err instanceof Error ? err.message : '세션 삭제에 실패했습니다.')
      } finally {
        setDeletingId(null)
      }
    },
    [token]
  )

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
        {error}
      </p>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <svg
          className="mb-3 h-10 w-10 text-[#CCC]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm text-[#999]">분석한 약관이 없습니다</p>
        <p className="mt-1 text-xs text-[#CCC]">PDF를 업로드하여 약관을 분석해보세요</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[#999]">이전 분석 세션</h3>
      <ul className="space-y-2" role="list" aria-label="분석 세션 목록">
        {sessions.map((session) => {
          const statusInfo = STATUS_LABELS[session.status] ?? DEFAULT_STATUS
          const isDeleting = deletingId === session.id
          const isConfirming = confirmDeleteId === session.id

          return (
            <li key={session.id}>
              <div className="group relative rounded-lg border border-[#E5E5E5] bg-white p-3 transition-colors hover:border-[#CCC] hover:bg-gray-50">
                {/* 세션 정보 클릭 영역 */}
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className="w-full text-left"
                  aria-label={`세션 선택: ${session.title}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 truncate text-sm font-medium text-[#1A1A1A]">
                      {session.title}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#999]">{formatDate(session.created_at)}</p>
                </button>

                {/* 삭제 확인 UI */}
                {isConfirming ? (
                  <div className="mt-2 flex items-center gap-2 border-t border-[#F0F0F0] pt-2">
                    <span className="flex-1 text-xs text-[#666]">삭제하시겠습니까?</span>
                    <button
                      type="button"
                      onClick={() => void handleDelete(session.id)}
                      disabled={isDeleting}
                      className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {isDeleting ? '삭제 중...' : '삭제'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded px-2 py-1 text-xs text-[#666] hover:bg-gray-100"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(session.id)}
                    className="absolute right-2 top-2 hidden rounded p-1 text-[#CCC] hover:bg-red-50 hover:text-red-500 group-hover:block"
                    aria-label={`세션 삭제: ${session.title}`}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
