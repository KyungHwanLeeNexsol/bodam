"use client"

import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GuidanceData, Source } from "@/lib/types/chat"
import GuidanceCard from "./GuidanceCard"

interface StreamingMessageProps {
  content: string
  sources?: Source[]
  guidance?: GuidanceData
}

// @MX:NOTE: 스트리밍 중인 어시스턴트 메시지를 표시하는 컴포넌트
// 빈 content일 때는 타이핑 인디케이터(세 점)를 표시
export default function StreamingMessage({ content, sources: _sources, guidance }: StreamingMessageProps) {
  const isEmpty = content.length === 0

  return (
    <div className="flex w-full gap-3">
      {/* AI 아바타 */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#4F46E5]">
        <Bot className="h-5 w-5 text-white" />
      </div>

      {/* AI 메시지 영역 */}
      <div className="flex max-w-[560px] flex-col items-start gap-3">
        <div className="rounded-[16px] rounded-bl-[4px] border border-[#E2E8F0] bg-white px-5 py-[18px]">
          {isEmpty ? (
            <div className="flex items-center gap-1.5 py-1" aria-label="입력 중">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#94A3B8] [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#CBD5E1] [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#E2E8F0]" />
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-[#0F172A]">
              {content}
              <span
                className={cn("ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[#0F172A]")}
                aria-hidden="true"
              />
            </p>
          )}
        </div>

        {/* 분쟁 가이던스 카드 (스트리밍 중 표시) */}
        {guidance && <GuidanceCard guidance={guidance} />}
      </div>
    </div>
  )
}
