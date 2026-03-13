"use client"

import { Shield } from "lucide-react"
import { cn } from "@/lib/utils"

// 제안 질문 목록
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
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      {/* 브랜드 아이콘 */}
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#0D6E6E]/10">
        <Shield className="h-8 w-8 text-[#0D6E6E]" />
      </div>

      {/* 타이틀 */}
      <h1 className="mb-2 text-2xl font-bold text-[#1A1A1A]">보담</h1>

      {/* 서브타이틀 */}
      <p className="mb-8 text-center text-[#666666]">무엇이든 물어보세요</p>

      {/* 제안 질문 칩 */}
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTED_QUESTIONS.map((question) => (
          <button
            key={question}
            onClick={() => onSendQuestion(question)}
            className={cn(
              "rounded-[20px] border border-gray-200 bg-white px-4 py-2",
              "text-sm text-[#1A1A1A] transition-colors",
              "hover:border-[#0D6E6E] hover:bg-[#0D6E6E]/5 hover:text-[#0D6E6E]",
              "focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
            )}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  )
}
