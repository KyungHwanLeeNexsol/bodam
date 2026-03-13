"use client"

import { Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChatSessionListItem } from "@/lib/types/chat"

interface SessionListProps {
  sessions: ChatSessionListItem[]
  currentSessionId: string | null
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onNewSession: () => void
}

// @MX:ANCHOR: 채팅 세션 목록 사이드바 컴포넌트 (선택/삭제/신규 생성)
// @MX:REASON: ChatLayout의 사이드바 핵심 컴포넌트로 SessionList 테스트에서 참조됨
export default function SessionList({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
}: SessionListProps) {
  // 세션 삭제 처리 (확인 다이얼로그 포함)
  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (window.confirm("이 대화를 삭제하시겠습니까?")) {
      onDeleteSession(sessionId)
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#FAFAFA]">
      {/* 새 대화 버튼 */}
      <div className="p-3">
        <button
          onClick={onNewSession}
          className={cn(
            "flex w-full items-center gap-2 rounded-[8px] px-3 py-2",
            "bg-[#0D6E6E] text-white transition-colors hover:bg-[#0D6E6E]/90"
          )}
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">새 대화</span>
        </button>
      </div>

      {/* 세션 목록 */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {sessions.length === 0 ? (
          <p className="py-4 text-center text-xs text-[#666666]">대화 내역이 없습니다</p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  onClick={() => onSelectSession(session.id)}
                  data-testid="session-item"
                  className={cn(
                    "group flex w-full items-center justify-between rounded-[8px] px-3 py-2",
                    "text-left transition-colors hover:bg-[#0D6E6E]/5",
                    currentSessionId === session.id
                      ? "bg-[#0D6E6E]/10 text-[#0D6E6E]"
                      : "text-[#1A1A1A]"
                  )}
                >
                  {/* 세션 제목 */}
                  <span className="flex-1 truncate text-sm">{session.title}</span>

                  {/* 삭제 버튼 (hover 시 표시) */}
                  <span
                    role="button"
                    aria-label="삭제"
                    onClick={(e) => handleDelete(e, session.id)}
                    className={cn(
                      "ml-2 shrink-0 rounded p-0.5",
                      "opacity-0 group-hover:opacity-100",
                      "text-[#666666] hover:bg-red-100 hover:text-red-500",
                      "transition-opacity"
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
