"use client"

import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/types/chat"
import SourcesCard from "./SourcesCard"

interface MessageBubbleProps {
  message: ChatMessage
}

// 상대적 시간 표시 (방금 전, N분 전, N시간 전 등)
const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return "방금 전"
  if (diffMins < 60) return `${diffMins}분 전`
  if (diffHours < 24) return `${diffHours}시간 전`
  return `${diffDays}일 전`
}

// @MX:ANCHOR: 채팅 메시지 버블 컴포넌트 (사용자/어시스턴트 구분 렌더링)
// @MX:REASON: MessageList, StreamingMessage에서 사용되며 채팅 UI의 핵심 단위 컴포넌트
export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const hasSources =
    message.role === "assistant" &&
    message.metadata?.sources !== undefined &&
    message.metadata.sources.length > 0

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[75%]",
          isUser ? "items-end" : "items-start",
          "flex flex-col gap-1"
        )}
      >
        {/* 메시지 버블 */}
        <div
          className={cn(
            "rounded-[12px] px-4 py-3",
            isUser
              ? "bg-[#0D6E6E] text-white rounded-tr-[4px]"
              : "bg-white text-[#1A1A1A] rounded-tl-[4px] shadow-sm"
          )}
        >
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
          </p>
        </div>

        {/* 참고 약관 출처 카드 (어시스턴트 메시지에만 표시) */}
        {hasSources && message.metadata?.sources && (
          <SourcesCard sources={message.metadata.sources} />
        )}

        {/* 타임스탬프 */}
        <span
          className={cn(
            "text-xs text-[#666666]",
            isUser ? "text-right" : "text-left"
          )}
        >
          {formatRelativeTime(message.created_at)}
        </span>
      </div>
    </div>
  )
}
