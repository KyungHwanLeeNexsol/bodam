'use client'

/**
 * PDF 채팅 컴포넌트 (SPEC-PDF-001)
 *
 * PDF 분석 결과에 대한 질의응답 채팅 인터페이스.
 * SSE 스트리밍으로 실시간 응답 표시.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { queryPdfStreamApi } from '@/lib/pdf'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface PDFChatProps {
  uploadId: string
  sessionId: string
  token: string
  initialMessages?: Message[]
}

/**
 * PDFChat 컴포넌트
 *
 * 메시지 버블 형식의 채팅 인터페이스.
 * 사용자 입력을 받아 SSE 스트리밍으로 AI 응답 표시.
 */
export default function PDFChat({ uploadId, token, initialMessages = [] }: PDFChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 새 메시지가 추가될 때 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const handleSend = useCallback(async () => {
    const question = input.trim()
    if (!question || isStreaming) return

    setInput('')
    setError(null)
    setIsStreaming(true)
    setStreamingContent('')

    const userMessage: Message = { role: 'user', content: question }
    setMessages((prev) => [...prev, userMessage])

    let accumulated = ''

    try {
      for await (const chunk of queryPdfStreamApi(uploadId, question, token)) {
        accumulated += chunk
        setStreamingContent(accumulated)
      }

      if (accumulated) {
        const assistantMessage: Message = { role: 'assistant', content: accumulated }
        setMessages((prev) => [...prev, assistantMessage])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '질문 처리 중 오류가 발생했습니다.')
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }, [input, isStreaming, uploadId, token])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="mb-2 flex items-center gap-2">
        <svg
          className="h-4 w-4 text-[#666]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <h3 className="text-sm font-semibold text-[#1A1A1A]">약관 내용 질문하기</h3>
      </div>

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-[200px] max-h-[400px] pr-1">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[#999]">약관 내용에 대해 궁금한 점을 질문해보세요.</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[85%] rounded-lg px-3 py-2 text-sm
                ${msg.role === 'user'
                  ? 'bg-[#1A1A1A] text-white'
                  : 'bg-gray-100 text-[#1A1A1A]'
                }
              `}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}

        {/* 스트리밍 중 응답 */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-[#1A1A1A]">
              {streamingContent ? (
                <p className="whitespace-pre-wrap leading-relaxed">{streamingContent}</p>
              ) : (
                <div className="flex items-center gap-1.5" aria-label="분석 중">
                  <span className="text-[#666]">분석 중</span>
                  <span className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#666]" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#666]" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#666]" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 오류 메시지 */}
      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {/* 입력 영역 */}
      <div className="mt-3 flex gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="약관에 대해 질문하세요... (Enter로 전송)"
          rows={2}
          disabled={isStreaming}
          className="flex-1 resize-none rounded-md border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] placeholder-[#999] outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A] disabled:opacity-50"
          aria-label="질문 입력"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!input.trim() || isStreaming}
          className="shrink-0 self-end rounded-md bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="전송"
        >
          전송
        </button>
      </div>
    </div>
  )
}
