"use client"

import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/types/chat"
import SourcesCard from "./SourcesCard"
import GuidanceCard from "./GuidanceCard"

interface MessageBubbleProps {
  message: ChatMessage
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

// @MX:ANCHOR: 채팅 메시지 버블 컴포넌트 (사용자/어시스턴트 구분 렌더링)
// @MX:REASON: MessageList, StreamingMessage에서 사용되며 채팅 UI의 핵심 단위 컴포넌트
export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const hasSources =
    message.role === "assistant" &&
    message.metadata?.sources !== undefined &&
    message.metadata.sources.length > 0
  const hasGuidance =
    message.role === "assistant" && message.metadata?.guidance !== undefined

  if (isUser) {
    return (
      <div className="flex w-full items-end justify-end gap-3">
        <div className="flex flex-col items-end gap-3">
          <div className="rounded-[16px] rounded-tr-[4px] bg-[#2563EB] px-[18px] py-[14px]">
            <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.5] text-white">
              {message.content}
            </p>
          </div>
          <span className="text-[11px] text-[#94A3B8]">{formatTime(message.created_at)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full gap-3">
      {/* AI 아바타 */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#4F46E5]">
        <Bot className="h-5 w-5 text-white" />
      </div>

      {/* AI 메시지 영역 */}
      <div className="flex max-w-[560px] flex-col gap-3">
        <div className="rounded-[16px] rounded-bl-[4px] border border-[#E2E8F0] bg-white px-5 py-[18px]">
          <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-[#0F172A]">
            {message.content}
          </p>
        </div>

        {/* 참고 약관 출처 카드 */}
        {hasSources && message.metadata?.sources && (
          <SourcesCard sources={message.metadata.sources} />
        )}

        {/* 분쟁 가이던스 카드 */}
        {hasGuidance && message.metadata?.guidance && (
          <GuidanceCard guidance={message.metadata.guidance} />
        )}

        {/* 타임스탬프 */}
        <span className="text-[11px] text-[#94A3B8]">{formatTime(message.created_at)}</span>
      </div>
    </div>
  )
}
