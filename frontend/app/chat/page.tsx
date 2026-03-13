"use client"

// @MX:ANCHOR: 채팅 페이지 메인 컴포넌트 - useReducer 기반 상태 관리
// @MX:REASON: M3 핵심 컴포넌트. ChatApiClient, ChatLayout, SessionList, MessageBubble 등 모든 채팅 컴포넌트를 통합

import { useReducer, useEffect, useRef, useMemo, useCallback, useState } from "react"
import { X } from "lucide-react"
import { ChatApiClient } from "@/lib/api/chat-client"
import ChatLayout from "@/components/chat/ChatLayout"
import SessionList from "@/components/chat/SessionList"
import MessageList from "@/components/chat/MessageList"
import MessageBubble from "@/components/chat/MessageBubble"
import StreamingMessage from "@/components/chat/StreamingMessage"
import ChatInput from "@/components/chat/ChatInput"
import EmptyState from "@/components/chat/EmptyState"
import {
  SessionListSkeleton,
  MessageListSkeleton,
} from "@/components/chat/LoadingStates"
import type {
  ChatMessage,
  ChatSessionListItem,
  Source,
  SSEEvent,
} from "@/lib/types/chat"

// ──────────────────────────────────────────────
// 상태 타입 정의
// ──────────────────────────────────────────────

interface ChatState {
  sessions: ChatSessionListItem[]
  currentSessionId: string | null
  messages: ChatMessage[]
  isLoading: boolean
  isStreaming: boolean
  streamingContent: string
  streamingSources: Source[]
  error: string | null
  sidebarOpen: boolean
}

type ChatAction =
  | { type: "SET_SESSIONS"; sessions: ChatSessionListItem[] }
  | { type: "SET_CURRENT_SESSION"; sessionId: string | null }
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "ADD_MESSAGE"; message: ChatMessage }
  | { type: "START_STREAMING" }
  | { type: "APPEND_TOKEN"; token: string }
  | { type: "SET_SOURCES"; sources: Source[] }
  | { type: "END_STREAMING"; message: ChatMessage }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "TOGGLE_SIDEBAR" }

// ──────────────────────────────────────────────
// 초기 상태 및 리듀서
// ──────────────────────────────────────────────

const initialState: ChatState = {
  sessions: [],
  currentSessionId: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  streamingSources: [],
  error: null,
  sidebarOpen: false,
}

// @MX:NOTE: 채팅 상태 리듀서 - 모든 채팅 관련 상태 변경을 처리
function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions }
    case "SET_CURRENT_SESSION":
      return { ...state, currentSessionId: action.sessionId }
    case "SET_MESSAGES":
      return { ...state, messages: action.messages }
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] }
    case "START_STREAMING":
      return { ...state, isStreaming: true, streamingContent: "", streamingSources: [] }
    case "APPEND_TOKEN":
      return { ...state, streamingContent: state.streamingContent + action.token }
    case "SET_SOURCES":
      return { ...state, streamingSources: action.sources }
    case "END_STREAMING":
      return {
        ...state,
        isStreaming: false,
        streamingContent: "",
        streamingSources: [],
        messages: [...state.messages, action.message],
      }
    case "SET_ERROR":
      return { ...state, error: action.error, isStreaming: false }
    case "CLEAR_ERROR":
      return { ...state, error: null }
    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading }
    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarOpen: !state.sidebarOpen }
    default:
      return state
  }
}

// ──────────────────────────────────────────────
// 채팅 페이지 컴포넌트
// ──────────────────────────────────────────────

// @MX:ANCHOR: ChatPage - /chat 라우트의 메인 페이지
// @MX:REASON: 모든 채팅 기능의 진입점. M3 통합 테스트의 렌더링 대상
export default function ChatPage() {
  const [state, dispatch] = useReducer(chatReducer, initialState)
  const chatClient = useMemo(() => new ChatApiClient(), [])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 세션 목록 로딩 완료 여부 (스켈레톤 표시 제어)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)

  // @MX:NOTE: stale closure 방지를 위해 ref로 스트리밍 진행 중 값 추적
  const streamingContentRef = useRef("")
  const streamingSourcesRef = useRef<Source[]>([])

  // 메시지 또는 스트리밍 내용 변경 시 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.messages, state.streamingContent])

  // 마운트 시 세션 목록 로드
  useEffect(() => {
    const load = async () => {
      dispatch({ type: "SET_LOADING", isLoading: true })
      try {
        const sessions = await chatClient.listSessions()
        dispatch({ type: "SET_SESSIONS", sessions })
      } catch (err) {
        const message = err instanceof Error ? err.message : "세션 목록을 불러오지 못했습니다"
        dispatch({ type: "SET_ERROR", error: message })
      } finally {
        dispatch({ type: "SET_LOADING", isLoading: false })
        setSessionsLoaded(true)
      }
    }
    void load()
  }, [chatClient])

  // ──────────────────────────────────────────────
  // SSE 스트리밍 핵심 로직 (중복 제거 목적으로 추출)
  // ──────────────────────────────────────────────

  // @MX:NOTE: 스트리밍 이벤트 핸들러 생성 헬퍼
  // sessionId를 인자로 받아 SSE 이벤트 콜백을 반환
  const makeStreamHandler = useCallback(
    (sessionId: string) =>
      (event: SSEEvent) => {
        switch (event.type) {
          case "token":
            streamingContentRef.current += event.content
            dispatch({ type: "APPEND_TOKEN", token: event.content })
            break
          case "sources":
            streamingSourcesRef.current = event.content
            dispatch({ type: "SET_SOURCES", sources: event.content })
            break
          case "done": {
            const assistantMessage: ChatMessage = {
              id: event.message_id,
              session_id: sessionId,
              role: "assistant",
              content: streamingContentRef.current,
              metadata:
                streamingSourcesRef.current.length > 0
                  ? { sources: streamingSourcesRef.current }
                  : null,
              created_at: new Date().toISOString(),
            }
            dispatch({ type: "END_STREAMING", message: assistantMessage })
            break
          }
          case "error":
            dispatch({ type: "SET_ERROR", error: event.content })
            break
        }
      },
    []
  )

  // 세션에 메시지를 스트리밍으로 전송하는 공통 함수
  const sendStreamingMessage = useCallback(
    async (sessionId: string, content: string) => {
      // 스트리밍 ref 초기화
      streamingContentRef.current = ""
      streamingSourcesRef.current = []

      // 사용자 메시지 낙관적 추가
      const userMessage: ChatMessage = {
        id: `temp-user-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content,
        metadata: null,
        created_at: new Date().toISOString(),
      }
      dispatch({ type: "ADD_MESSAGE", message: userMessage })
      dispatch({ type: "START_STREAMING" })

      try {
        await chatClient.streamMessage(sessionId, content, makeStreamHandler(sessionId))
      } catch (err) {
        const message = err instanceof Error ? err.message : "메시지 전송 중 오류가 발생했습니다"
        dispatch({ type: "SET_ERROR", error: message })
      }
    },
    [chatClient, makeStreamHandler]
  )

  // ──────────────────────────────────────────────
  // 세션 핸들러
  // ──────────────────────────────────────────────

  const handleNewSession = useCallback(async () => {
    try {
      const session = await chatClient.createSession()
      const item: ChatSessionListItem = { ...session, message_count: 0 }
      dispatch({ type: "SET_SESSIONS", sessions: [item, ...state.sessions] })
      dispatch({ type: "SET_CURRENT_SESSION", sessionId: session.id })
      dispatch({ type: "SET_MESSAGES", messages: [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : "새 대화를 만들지 못했습니다"
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [chatClient, state.sessions])

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (state.sidebarOpen) {
        dispatch({ type: "TOGGLE_SIDEBAR" })
      }
      dispatch({ type: "SET_CURRENT_SESSION", sessionId })
      dispatch({ type: "SET_LOADING", isLoading: true })
      try {
        const detail = await chatClient.getSession(sessionId)
        dispatch({ type: "SET_MESSAGES", messages: detail.messages })
      } catch (err) {
        const message = err instanceof Error ? err.message : "대화를 불러오지 못했습니다"
        dispatch({ type: "SET_ERROR", error: message })
      } finally {
        dispatch({ type: "SET_LOADING", isLoading: false })
      }
    },
    [chatClient, state.sidebarOpen]
  )

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await chatClient.deleteSession(sessionId)
        const updated = state.sessions.filter((s) => s.id !== sessionId)
        dispatch({ type: "SET_SESSIONS", sessions: updated })
        if (state.currentSessionId === sessionId) {
          dispatch({ type: "SET_CURRENT_SESSION", sessionId: null })
          dispatch({ type: "SET_MESSAGES", messages: [] })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "대화를 삭제하지 못했습니다"
        dispatch({ type: "SET_ERROR", error: message })
      }
    },
    [chatClient, state.sessions, state.currentSessionId]
  )

  // ──────────────────────────────────────────────
  // 메시지 전송 핸들러
  // ──────────────────────────────────────────────

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!state.currentSessionId || state.isStreaming) return
      await sendStreamingMessage(state.currentSessionId, content)
    },
    [sendStreamingMessage, state.currentSessionId, state.isStreaming]
  )

  // EmptyState 제안 질문 클릭 처리
  const handleSendQuestion = useCallback(
    async (question: string) => {
      if (state.currentSessionId) {
        void handleSendMessage(question)
        return
      }
      // 세션 없으면 먼저 생성
      try {
        const session = await chatClient.createSession()
        const item: ChatSessionListItem = { ...session, message_count: 0 }
        dispatch({ type: "SET_SESSIONS", sessions: [item, ...state.sessions] })
        dispatch({ type: "SET_CURRENT_SESSION", sessionId: session.id })
        dispatch({ type: "SET_MESSAGES", messages: [] })
        await sendStreamingMessage(session.id, question)
      } catch (err) {
        const message = err instanceof Error ? err.message : "오류가 발생했습니다"
        dispatch({ type: "SET_ERROR", error: message })
      }
    },
    [chatClient, state.currentSessionId, state.sessions, handleSendMessage, sendStreamingMessage]
  )

  // ──────────────────────────────────────────────
  // 렌더링
  // ──────────────────────────────────────────────

  const sidebarContent = (
    <>
      {!sessionsLoaded ? (
        <SessionListSkeleton />
      ) : (
        <SessionList
          sessions={state.sessions}
          currentSessionId={state.currentSessionId}
          onSelectSession={(id) => void handleSelectSession(id)}
          onDeleteSession={(id) => void handleDeleteSession(id)}
          onNewSession={() => void handleNewSession()}
        />
      )}
    </>
  )

  return (
    <ChatLayout
      sidebar={sidebarContent}
      sidebarOpen={state.sidebarOpen}
      onToggleSidebar={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
    >
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 오류 배너 */}
        {state.error && (
          <div className="flex items-center justify-between bg-red-50 px-4 py-2 text-sm text-red-700">
            <span>{state.error}</span>
            <button
              onClick={() => dispatch({ type: "CLEAR_ERROR" })}
              aria-label="오류 닫기"
              className="ml-2 rounded p-0.5 hover:bg-red-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* 메시지 영역 */}
        {state.currentSessionId === null ? (
          <EmptyState onSendQuestion={(q) => void handleSendQuestion(q)} />
        ) : state.isLoading ? (
          <MessageListSkeleton />
        ) : (
          <MessageList ref={null}>
            {state.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {state.isStreaming && (
              <StreamingMessage
                content={state.streamingContent}
                sources={state.streamingSources}
              />
            )}
            <div ref={messagesEndRef} />
          </MessageList>
        )}

        {/* 채팅 입력창 (세션 선택 시만 표시) */}
        {state.currentSessionId !== null && (
          <ChatInput
            onSend={(content) => void handleSendMessage(content)}
            disabled={state.isStreaming}
          />
        )}
      </div>
    </ChatLayout>
  )
}
