"use client"

import { useState, useRef, useCallback } from "react"
import { Paperclip, Send, Bone, Car, Receipt } from "lucide-react"
import { cn } from "@/lib/utils"

const MAX_CHARS = 5000
const COUNTER_THRESHOLD = 4000

const QUICK_CHIPS = [
  { label: "인공관절 수술", icon: Bone },
  { label: "교통사고 입원", icon: Car },
  { label: "실손보험 청구", icon: Receipt },
] as const

interface ChatInputProps {
  onSend: (content: string) => void
  disabled?: boolean
}

// @MX:ANCHOR: 채팅 입력 컴포넌트 (Pencil 디자인 기준)
// @MX:REASON: ChatArea에서 사용되며 사용자 입력의 핵심 진입점
export default function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    const maxHeight = 5 * 24 + 16
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.length > MAX_CHARS) return
    setValue(e.target.value)
    adjustHeight()
  }

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue("")
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
  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className="border-t border-[#E2E8F0] bg-white px-8 pb-5 pt-3">
      {/* Quick Chips */}
      <div className="flex gap-2 pb-3">
        {QUICK_CHIPS.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => onSend(label)}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-[20px] border border-[#E2E8F0] px-3.5 py-2 text-[13px] text-[#475569] transition-colors hover:border-[#2563EB] hover:bg-[#EEF2FF] hover:text-[#2563EB] disabled:opacity-50"
          >
            <Icon className="h-3.5 w-3.5 text-[#2563EB]" />
            {label}
          </button>
        ))}
      </div>

      {/* 입력 행: 첨부 + 텍스트 + 전송 */}
      <div className="flex items-center gap-2.5">
        {/* 첨부 버튼 */}
        <button
          type="button"
          className="flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-[#E2E8F0] text-[#475569] transition-colors hover:bg-[#F8FAFC]"
          aria-label="파일 첨부"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        {/* 텍스트 입력 */}
        <div className="flex flex-1 items-center rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-4">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="보험에 대해 궁금한 점을 물어보세요..."
            rows={1}
            className={cn(
              "h-[42px] max-h-[136px] flex-1 resize-none bg-transparent py-2.5 text-sm text-[#0F172A] outline-none placeholder:text-[#94A3B8]",
              disabled && "cursor-not-allowed opacity-50"
            )}
            aria-label="메시지 입력"
          />
        </div>

        {/* 전송 버튼 */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            "flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-[10px] transition-colors",
            canSend
              ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
              : "cursor-not-allowed bg-[#E2E8F0] text-[#94A3B8]"
          )}
          aria-label="전송"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>

      {/* 글자 수 카운터 */}
      {showCounter && (
        <p
          className={cn(
            "mt-1 text-right text-xs",
            value.length >= MAX_CHARS ? "text-red-500" : "text-[#94A3B8]"
          )}
        >
          {value.length} / {MAX_CHARS}
        </p>
      )}

      {/* 면책 문구 */}
      <p className="mt-3 text-center text-[11px] text-[#94A3B8]">
        보담은 참고용 정보를 제공하며, 정확한 보상 여부는 보험사에 확인하세요.
      </p>
    </div>
  )
}
