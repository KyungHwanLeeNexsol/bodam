"use client"

import { useState, useRef, useCallback } from "react"
import { Send } from "lucide-react"
import { cn } from "@/lib/utils"

// 최대 입력 글자 수
const MAX_CHARS = 5000
// 카운터 표시 시작 글자 수
const COUNTER_THRESHOLD = 4000

interface ChatInputProps {
  onSend: (content: string) => void
  disabled?: boolean
}

// @MX:ANCHOR: 채팅 입력 컴포넌트 (Enter 전송, Shift+Enter 줄바꿈, 글자 수 제한)
// @MX:REASON: ChatArea에서 사용되며 사용자 입력의 핵심 진입점
export default function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 텍스트 자동 높이 조절
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    const maxHeight = 5 * 24 + 16 // 5행 * 줄 높이 + 패딩
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // 5000자 초과 입력 방지
    if (e.target.value.length > MAX_CHARS) return
    setValue(e.target.value)
    adjustHeight()
  }

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue("")
    // 높이 초기화
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const showCounter = value.length > COUNTER_THRESHOLD

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      <div className="flex items-end gap-2 rounded-[12px] border border-gray-300 bg-white px-3 py-2 focus-within:border-[#0D6E6E] focus-within:ring-1 focus-within:ring-[#0D6E6E]">
        {/* 텍스트 입력 영역 */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="보험에 대해 궁금한 점을 물어보세요..."
          rows={1}
          className={cn(
            "max-h-[136px] flex-1 resize-none bg-transparent text-sm text-[#1A1A1A] outline-none placeholder:text-[#666666]",
            disabled && "cursor-not-allowed opacity-50"
          )}
          aria-label="메시지 입력"
        />

        {/* 전송 버튼 */}
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className={cn(
            "shrink-0 rounded-[8px] p-1.5 transition-colors",
            disabled || !value.trim()
              ? "cursor-not-allowed text-gray-300"
              : "text-[#0D6E6E] hover:bg-[#0D6E6E]/10"
          )}
          aria-label="전송"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>

      {/* 글자 수 카운터 (4000자 초과 시 표시) */}
      {showCounter && (
        <p
          className={cn(
            "mt-1 text-right text-xs",
            value.length >= MAX_CHARS ? "text-red-500" : "text-[#666666]"
          )}
        >
          {value.length} / {MAX_CHARS}
        </p>
      )}
    </div>
  )
}
