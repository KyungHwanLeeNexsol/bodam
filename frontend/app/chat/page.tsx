"use client"

// @MX:ANCHOR: 채팅 페이지 메인 컴포넌트 - useReducer 기반 상태 관리
// @MX:REASON: M3 핵심 컴포넌트. ChatApiClient, ChatLayout, SessionList, MessageBubble 등 모든 채팅 컴포넌트를 통합

import { useReducer, useEffect, useRef, useMemo, useCallback, useState } from "react"
import { X, BookOpen } from "lucide-react"
import { ChatApiClient } from "@/lib/api/chat-client"
import { JITApiClient } from "@/lib/api/jit-client"
import ChatLayout from "@/components/chat/ChatLayout"
import SessionList from "@/components/chat/SessionList"
import MessageList from "@/components/chat/MessageList"
import MessageBubble from "@/components/chat/MessageBubble"
import StreamingMessage from "@/components/chat/StreamingMessage"
import ChatInput from "@/components/chat/ChatInput"
import EmptyState from "@/components/chat/EmptyState"
import DocumentSourcePanel from "@/components/chat/DocumentSourcePanel"
import {
  SessionListSkeleton,
  MessageListSkeleton,
} from "@/components/chat/LoadingStates"
import type {
  ChatMessage,
  ChatSessionListItem,
  GuidanceData,
  MessageMetadata,
  Source,
  SSEEvent,
  // @MX:NOTE: [AUTO] PaginatedSessionListResponse - SPEC-CHAT-PERF-001 페이지네이션 응답 타입
  PaginatedSessionListResponse,
} from "@/lib/types/chat"
import type { DocumentMeta } from "@/lib/api/jit-client"

// ──────────────────────────────────────────────
// 상태 타입 정의
// ──────────────────────────────────────────────

interface ChatState {
  sessions: ChatSessionListItem[]
  // @MX:NOTE: [AUTO] hasMore - SPEC-CHAT-PERF-001 페이지네이션 여부 플래그
  hasMore: boolean
  currentSessionId: string | null
  messages: ChatMessage[]
  isLoading: boolean
  isStreaming: boolean
  streamingContent: string
  streamingSources: Source[]
  streamingGuidance: GuidanceData | null
  error: string | null
  sidebarOpen: boolean
  // @MX:NOTE: JIT 문서 소스 상태 - DocumentSourcePanel과 동기화
  documentSource: DocumentMeta | null
  documentPanelExpanded: boolean
}

type ChatAction =
  | { type: "SET_SESSIONS"; sessions: ChatSessionListItem[] }
  // SPEC-CHAT-PERF-001: 기존 목록에 세션을 추가 (더 보기용)
  | { type: "APPEND_SESSIONS"; sessions: ChatSessionListItem[] }
  | { type: "SET_HAS_MORE"; hasMore: boolean }
  | { type: "SET_CURRENT_SESSION"; sessionId: string | null }
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "ADD_MESSAGE"; message: ChatMessage }
  | { type: "START_STREAMING" }
  | { type: "APPEND_TOKEN"; token: string }
  | { type: "SET_SOURCES"; sources: Source[] }
  | { type: "SET_GUIDANCE"; guidance: GuidanceData }
  | { type: "END_STREAMING"; message: ChatMessage }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SET_DOCUMENT"; document: DocumentMeta }
  | { type: "CLEAR_DOCUMENT" }
  | { type: "TOGGLE_DOCUMENT_PANEL" }
  // SPEC-CHAT-UX-001: SSE title_update 이벤트로 세션 제목 업데이트
  | { type: "UPDATE_SESSION_TITLE"; sessionId: string; title: string }

// ──────────────────────────────────────────────
// 초기 상태 및 리듀서
// ──────────────────────────────────────────────

const initialState: ChatState = {
  sessions: [],
  hasMore: false,
  currentSessionId: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  streamingSources: [],
  streamingGuidance: null,
  error: null,
  sidebarOpen: false,
  documentSource: null,
  documentPanelExpanded: false,
}

// @MX:NOTE: 채팅 상태 리듀서 - 모든 채팅 관련 상태 변경을 처리
function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions }
    // SPEC-CHAT-PERF-001: 기존 세션 목록 끝에 추가 (페이지네이션 더 보기)
    case "APPEND_SESSIONS":
      return { ...state, sessions: [...state.sessions, ...action.sessions] }
    case "SET_HAS_MORE":
      return { ...state, hasMore: action.hasMore }
    case "SET_CURRENT_SESSION":
      return { ...state, currentSessionId: action.sessionId }
    case "SET_MESSAGES":
      return { ...state, messages: action.messages }
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] }
    case "START_STREAMING":
      return { ...state, isStreaming: true, streamingContent: "", streamingSources: [], streamingGuidance: null }
    case "APPEND_TOKEN":
      return { ...state, streamingContent: state.streamingContent + action.token }
    case "SET_SOURCES":
      return { ...state, streamingSources: action.sources }
    case "SET_GUIDANCE":
      return { ...state, streamingGuidance: action.guidance }
    case "END_STREAMING":
      return {
        ...state,
        isStreaming: false,
        streamingContent: "",
        streamingSources: [],
        streamingGuidance: null,
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
    case "SET_DOCUMENT":
      return { ...state, documentSource: action.document, documentPanelExpanded: false }
    case "CLEAR_DOCUMENT":
      return { ...state, documentSource: null }
    case "TOGGLE_DOCUMENT_PANEL":
      return { ...state, documentPanelExpanded: !state.documentPanelExpanded }
    // SPEC-CHAT-UX-001: SSE title_update 이벤트 처리 - 세션 제목 실시간 업데이트
    case "UPDATE_SESSION_TITLE":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId ? { ...s, title: action.title } : s
        ),
      }
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
  const jitClient = useRef(new JITApiClient())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // @MX:NOTE: [AUTO] sessionOffset - SPEC-CHAT-PERF-001 페이지네이션 오프셋 추적
  const [sessionOffset, setSessionOffset] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // localStorage 키 생성 헬퍼
  const getDocStorageKey = useCallback(
    (sessionId: string) => `bodam_jit_doc_${sessionId}`,
    []
  )

  // 세션 목록 로딩 완료 여부 (스켈레톤 표시 제어)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)

  // @MX:NOTE: stale closure 방지를 위해 ref로 스트리밍 진행 중 값 추적
  const streamingContentRef = useRef("")
  const streamingSourcesRef = useRef<Source[]>([])
  const streamingGuidanceRef = useRef<GuidanceData | null>(null)

  // 메시지 또는 스트리밍 내용 변경 시 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.messages, state.streamingContent])

  // @MX:NOTE: [AUTO] documentSource → localStorage 저장 (세션별 키로 저장)
  // 새로고침 후 복원을 위해 documentSource가 설정될 때마다 저장
  useEffect(() => {
    const sessionId = state.currentSessionId
    if (!sessionId || !state.documentSource) return
    try {
      localStorage.setItem(getDocStorageKey(sessionId), JSON.stringify(state.documentSource))
    } catch {
      // localStorage 접근 불가 시 무시 (프라이빗 브라우징 등)
    }
  }, [state.documentSource, state.currentSessionId, getDocStorageKey])

  // @MX:NOTE: [AUTO] 세션 변경 시 localStorage에서 문서 복원 (Redis 검증 포함)
  // Redis TTL이 살아있으면 UI 상태를 복원하여 새로고침 후에도 약관 컨텍스트 유지
  useEffect(() => {
    const sessionId = state.currentSessionId
    if (!sessionId) return

    const stored = localStorage.getItem(getDocStorageKey(sessionId))
    if (!stored) return

    const verifyAndRestore = async () => {
      try {
        const meta = await jitClient.current.getDocumentMeta(sessionId)
        if (meta !== null) {
          // Redis에 문서가 살아있음 → UI 상태 복원
          const savedMeta = JSON.parse(stored) as import("@/lib/api/jit-client").DocumentMeta
          dispatch({ type: "SET_DOCUMENT", document: savedMeta })
        } else {
          // Redis TTL 만료 → localStorage 정리
          localStorage.removeItem(getDocStorageKey(sessionId))
        }
      } catch {
        // 네트워크 오류 시 복원 건너뜀 (localStorage는 유지)
      }
    }

    void verifyAndRestore()
  }, [state.currentSessionId, getDocStorageKey])

  // 마운트 시 세션 목록 로드 (SPEC-CHAT-PERF-001: 페이지네이션 적용)
  useEffect(() => {
    const load = async () => {
      dispatch({ type: "SET_LOADING", isLoading: true })
      try {
        const result = await chatClient.listSessions(20, 0)
        dispatch({ type: "SET_SESSIONS", sessions: result.sessions })
        dispatch({ type: "SET_HAS_MORE", hasMore: result.has_more })
        setSessionOffset(20)
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

  // @MX:ANCHOR: 세션 목록 더 보기 로드 함수 (페이지네이션)
  // @MX:REASON: SPEC-CHAT-PERF-001 - 다음 페이지 세션을 기존 목록에 append
  const handleLoadMore = useCallback(async () => {
    if (!state.hasMore || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const result: PaginatedSessionListResponse = await chatClient.listSessions(20, sessionOffset)
      dispatch({ type: "APPEND_SESSIONS", sessions: result.sessions })
      dispatch({ type: "SET_HAS_MORE", hasMore: result.has_more })
      setSessionOffset((prev) => prev + 20)
    } catch (err) {
      const message = err instanceof Error ? err.message : "세션 목록을 불러오지 못했습니다"
      dispatch({ type: "SET_ERROR", error: message })
    } finally {
      setIsLoadingMore(false)
    }
  }, [chatClient, state.hasMore, sessionOffset, isLoadingMore])

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
          case "guidance":
            streamingGuidanceRef.current = event.content
            dispatch({ type: "SET_GUIDANCE", guidance: event.content })
            break
          case "done": {
            const metadata: MessageMetadata | null =
              streamingSourcesRef.current.length > 0 || streamingGuidanceRef.current !== null
                ? {
                    sources:
                      streamingSourcesRef.current.length > 0
                        ? streamingSourcesRef.current
                        : undefined,
                    guidance: streamingGuidanceRef.current ?? undefined,
                  }
                : null
            const assistantMessage: ChatMessage = {
              id: event.message_id,
              session_id: sessionId,
              role: "assistant",
              content: streamingContentRef.current,
              metadata,
              created_at: new Date().toISOString(),
            }
            dispatch({ type: "END_STREAMING", message: assistantMessage })
            break
          }
          case "error":
            dispatch({ type: "SET_ERROR", error: event.content })
            break
          // SPEC-CHAT-UX-001: 스트리밍 중 세션 제목 자동 업데이트
          case "title_update":
            dispatch({ type: "UPDATE_SESSION_TITLE", sessionId, title: event.title })
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
      streamingGuidanceRef.current = null

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
      // 새 세션에서는 문서 패널 초기화
      dispatch({ type: "CLEAR_DOCUMENT" })
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
      // 세션 전환 시 문서 소스 초기화
      dispatch({ type: "CLEAR_DOCUMENT" })
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
          hasMore={state.hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={() => void handleLoadMore()}
        />
      )}
    </>
  )

  const currentSessionTitle = state.currentSessionId
    ? state.sessions.find((s) => s.id === state.currentSessionId)?.title ?? null
    : null

  return (
    <ChatLayout
      sidebar={sidebarContent}
      sidebarOpen={state.sidebarOpen}
      onToggleSidebar={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
      sessionTitle={currentSessionTitle}
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
                guidance={state.streamingGuidance ?? undefined}
              />
            )}
            <div ref={messagesEndRef} />
          </MessageList>
        )}

        {/* JIT 약관 문서 소스 패널 */}
        {state.currentSessionId !== null && (
          <div className="border-t border-[#E2E8F0] bg-white px-4 pt-3">
            {/* 문서 연결 상태 표시 / 패널 토글 */}
            {!state.documentSource && !state.documentPanelExpanded ? (
              <button
                type="button"
                onClick={() => dispatch({ type: "TOGGLE_DOCUMENT_PANEL" })}
                className="mb-2 flex items-center gap-1.5 text-xs text-[#94A3B8] transition-colors hover:text-[#475569]"
                aria-label="약관 문서 연결 패널 열기"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>약관 연결하기</span>
              </button>
            ) : null}

            {/* 문서가 연결되었을 때 인디케이터 또는 패널 */}
            {state.documentSource || state.documentPanelExpanded ? (
              <div className="mb-2">
                <DocumentSourcePanel
                  sessionId={state.currentSessionId}
                  currentDocument={state.documentSource}
                  onDocumentReady={(meta) =>
                    dispatch({ type: "SET_DOCUMENT", document: meta })
                  }
                  onDocumentRemoved={() => {
                    // localStorage에서도 삭제 (명시적 제거)
                    if (state.currentSessionId) {
                      try {
                        localStorage.removeItem(getDocStorageKey(state.currentSessionId))
                      } catch { /* 무시 */ }
                    }
                    dispatch({ type: "CLEAR_DOCUMENT" })
                    dispatch({ type: "TOGGLE_DOCUMENT_PANEL" })
                  }}
                />
              </div>
            ) : null}
          </div>
        )}

        {/* 채팅 입력창 (항상 표시) */}
        <ChatInput
          onSend={(content) => state.currentSessionId !== null
            ? void handleSendMessage(content)
            : void handleSendQuestion(content)
          }
          disabled={state.isStreaming}
        />
      </div>
    </ChatLayout>
  )
}
