"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Source } from "@/lib/types/chat"

interface SourcesCardProps {
  sources: Source[]
}

// 유사도 점수를 퍼센트 문자열로 변환
const formatSimilarity = (score: number): string => {
  return `${Math.round(score * 100)}%`
}

// @MX:ANCHOR: 어시스턴트 메시지의 참고 약관 목록을 표시하는 카드 컴포넌트
// @MX:REASON: MessageBubble에서 직접 참조되며 SourcesCard 테스트에서도 독립적으로 사용됨
export default function SourcesCard({ sources }: SourcesCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpand = () => {
    setIsExpanded((prev) => !prev)
  }

  return (
    <div className="mt-2 rounded-[8px] border border-gray-200 bg-gray-50 text-sm">
      {/* 헤더 - 클릭으로 펼치기/접기 */}
      <button
        onClick={toggleExpand}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[#666666] hover:text-[#1A1A1A]"
        aria-expanded={isExpanded}
        aria-label="참고 약관 토글"
      >
        <span className="font-medium">참고 약관 {sources.length}건</span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {/* 출처 목록 - 펼쳐진 상태에서만 표시 */}
      {isExpanded && (
        <div className="border-t border-gray-200 px-3 py-2">
          <ul className="space-y-2">
            {sources.map((source, index) => (
              <li key={index} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[#1A1A1A]">{source.policy_name}</p>
                  <p className="text-xs text-[#666666]">{source.company_name}</p>
                </div>
                {source.similarity_score !== undefined && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      source.similarity_score >= 0.9
                        ? "bg-green-100 text-green-700"
                        : source.similarity_score >= 0.8
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-600"
                    )}
                  >
                    {formatSimilarity(source.similarity_score)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
