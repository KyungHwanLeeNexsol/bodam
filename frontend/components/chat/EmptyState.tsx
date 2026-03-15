"use client"

import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"

const SUGGESTED_QUESTIONS = [
  "인공관절 수술 보험 보상이 되나요?",
  "교통사고 입원 보상 범위가 어떻게 되나요?",
  "실손보험 청구 절차를 알려주세요",
  "암 진단비 보험금은 얼마인가요?",
] as const

interface EmptyStateProps {
  onSendQuestion: (question: string) => void
}

// @MX:NOTE: 채팅 시작 전 웰컴 화면 - 제안 질문 칩으로 빠른 시작 유도
export default function EmptyState({ onSendQuestion }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#F8FAFC] px-4 py-12">
      {/* 브랜드 아이콘 */}
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#EEF2FF]">
        <Bot className="h-8 w-8 text-[#4F46E5]" />
      </div>

      {/* 타이틀 */}
      <h1 className="mb-2 bg-gradient-to-r from-[#2563EB] to-[#4F46E5] bg-clip-text text-2xl font-bold text-transparent">보담</h1>

      {/* 서브타이틀 */}
      <p className="mb-8 text-center text-[#94A3B8]">무엇이든 물어보세요</p>

      {/* 제안 질문 칩 */}
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTED_QUESTIONS.map((question) => (
          <button
            key={question}
            onClick={() => onSendQuestion(question)}
            className={cn(
              "cursor-pointer rounded-[20px] border border-[#E2E8F0] bg-white px-4 py-2",
              "text-sm text-[#475569] transition-colors",
              "hover:border-[#2563EB] hover:bg-[#EEF2FF] hover:text-[#2563EB]",
              "focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
            )}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  )
}
