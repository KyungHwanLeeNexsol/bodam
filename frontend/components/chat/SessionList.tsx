"use client"

import { Plus, Trash2, Settings, MessageSquare, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import type { ChatSessionListItem } from "@/lib/types/chat"

interface SessionListProps {
  sessions: ChatSessionListItem[]
  currentSessionId: string | null
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onNewSession: () => void
  // SPEC-CHAT-PERF-001: 페이지네이션 props
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

// 날짜 그룹 라벨 생성
const getDateGroup = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (targetDate.getTime() === today.getTime()) return "오늘"
  if (targetDate.getTime() === yesterday.getTime()) return "어제"
  if (targetDate.getTime() > today.getTime() - 7 * 86400000) return "이번 주"
  return "이전"
}

// 시간 포맷 (오후 2:34)
const formatTime = (dateString: string): string => {
  const date = new Date(dateString)
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const period = hours < 12 ? "오전" : "오후"
  const h = hours % 12 || 12
  return `${period} ${h}:${String(minutes).padStart(2, "0")}`
}

// @MX:ANCHOR: 채팅 세션 목록 사이드바 컴포넌트 (선택/삭제/신규 생성)
// @MX:REASON: ChatLayout의 사이드바 핵심 컴포넌트로 SessionList 테스트에서 참조됨
export default function SessionList({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: SessionListProps) {
  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (window.confirm("이 대화를 삭제하시겠습니까?")) {
      onDeleteSession(sessionId)
    }
  }

  const { logout, userProfile } = useAuth()

  // 사용자 이름 결정: full_name > email prefix > 기본값
  const userName = userProfile?.fullName
    || (userProfile?.email ? userProfile.email.split('@')[0] : '사용자')
  const userInitial = (userName ?? '사').charAt(0).toUpperCase()

  // 세션을 날짜 그룹으로 분류
  const groupedSessions = sessions.reduce<Record<string, ChatSessionListItem[]>>((acc, session) => {
    const group = getDateGroup(session.updated_at)
    if (!acc[group]) acc[group] = []
    acc[group].push(session)
    return acc
  }, {})

  const groupOrder = ["오늘", "어제", "이번 주", "이전"]

  return (
    <div className="flex h-full flex-col bg-[#F8FAFC]">
      {/* 사이드바 헤더: 로고 + 새 대화 버튼 */}
      <div className="flex items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gradient-to-b from-[#2563EB] to-[#4F46E5]">
            <span className="text-xs font-bold text-white">B</span>
          </div>
          <span className="bg-gradient-to-r from-[#2563EB] to-[#4F46E5] bg-clip-text text-xl font-bold text-transparent">보담</span>
        </div>
        <button
          onClick={onNewSession}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-2 text-white transition-colors hover:bg-[#2563EB]/90"
        >
          <Plus className="h-4 w-4" />
          <span className="text-[13px] font-medium">새 대화</span>
        </button>
      </div>

      {/* 검색 바 */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5">
          <Search className="h-4 w-4 text-[#94A3B8]" />
          <span className="text-[13px] text-[#94A3B8]">대화 검색...</span>
        </div>
      </div>

      {/* 세션 목록 */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="py-4 text-center text-xs text-[#94A3B8]">대화 내역이 없습니다</p>
        ) : (
          <>
            {groupOrder.map((group) => {
              const items = groupedSessions[group]
              if (!items || items.length === 0) return null
              return (
                <div key={group}>
                  {/* 날짜 그룹 라벨 */}
                  <div className="px-5 pb-1 pt-4">
                    <span className="text-[11px] font-semibold tracking-wider text-[#94A3B8]">{group.toUpperCase()}</span>
                  </div>
                  {/* 세션 아이템 */}
                  {items.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => onSelectSession(session.id)}
                      data-testid="session-item"
                      className={cn(
                        "group flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left transition-colors",
                        currentSessionId === session.id
                          ? "bg-white"
                          : "hover:bg-white/60"
                      )}
                    >
                      <MessageSquare
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          currentSessionId === session.id ? "text-[#2563EB]" : "text-[#94A3B8]"
                        )}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={cn(
                            "truncate text-sm",
                            currentSessionId === session.id ? "font-medium text-[#0F172A]" : "text-[#475569]"
                          )}
                        >
                          {session.title}
                        </span>
                        <span className="text-[11px] text-[#94A3B8]">{formatTime(session.updated_at)}</span>
                      </div>
                      {/* 삭제 버튼 */}
                      <span
                        role="button"
                        aria-label="삭제"
                        onClick={(e) => handleDelete(e, session.id)}
                        className="ml-1 shrink-0 cursor-pointer rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 text-[#94A3B8] hover:bg-red-100 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
            {/* 더 보기 버튼 (SPEC-CHAT-PERF-001: has_more가 true일 때만 표시) */}
            {hasMore && onLoadMore && (
              <div className="px-5 py-3">
                <button
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  aria-label="더 보기"
                  className="w-full rounded-lg border border-[#E2E8F0] py-2 text-[13px] text-[#94A3B8] transition-colors hover:border-[#CBD5E1] hover:text-[#475569] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoadingMore ? "불러오는 중..." : "더 보기"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 유저 프로필 */}
      <div className="flex items-center gap-3 border-t border-[#E2E8F0] px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-sm font-semibold text-white">
          {userInitial}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-sm font-medium text-[#0F172A]">{userName}</p>
          <p className="truncate text-xs text-[#94A3B8]">{userProfile?.email ?? ''}</p>
        </div>
        <button
          onClick={logout}
          className="cursor-pointer text-[#94A3B8] transition-colors hover:text-[#475569]"
          aria-label="로그아웃"
          title="로그아웃"
        >
          <Settings className="h-4.5 w-4.5" />
        </button>
      </div>
    </div>
  )
}
