"use client"

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
    <div className="flex w-full justify-start">
      <div className="flex max-w-[75%] flex-col items-start gap-1">
        {/* 메시지 버블 */}
        <div className="rounded-[12px] rounded-tl-[4px] bg-white px-4 py-3 shadow-sm">
          {isEmpty ? (
            // 타이핑 인디케이터 (세 개의 도트)
            <div className="flex items-center gap-1 py-1" aria-label="입력 중">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#666666] [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#666666] [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#666666]" />
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#1A1A1A]">
              {content}
              {/* 깜박이는 커서 */}
              <span
                className={cn("ml-0.5 inline-block h-4 w-0.5 bg-[#1A1A1A] animate-pulse")}
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
