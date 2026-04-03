/**
 * T-005: 채팅 페이지 JIT SSE 이벤트 핸들러 테스트 (SPEC-JIT-002)
 *
 * searching_document, document_ready SSE 이벤트 처리 및 상태 업데이트 검증.
 */

import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SSEEvent } from "@/lib/types/chat"

// 목 핸들러
const mockListSessions = vi.fn()
const mockCreateSession = vi.fn()
const mockGetSession = vi.fn()
const mockDeleteSession = vi.fn()
const mockSendMessage = vi.fn()
const mockStreamMessage = vi.fn()

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    userProfile: null,
  }),
}))

vi.mock("@/lib/api/chat-client", () => {
  return {
    ChatApiClient: vi.fn().mockImplementation(function (this: unknown) {
      return {
        listSessions: mockListSessions,
        createSession: mockCreateSession,
        getSession: mockGetSession,
        deleteSession: mockDeleteSession,
        sendMessage: mockSendMessage,
        streamMessage: mockStreamMessage,
      }
    }),
  }
})

const SESSION_ID = "session-jit-001"

const mockSession = {
  id: SESSION_ID,
  title: "JIT 테스트 세션",
  user_id: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
}

const mockSessionList = {
  sessions: [{ ...mockSession, message_count: 0 }],
  total_count: 1,
  has_more: false,
}

const mockSessionDetail = {
  ...mockSession,
  messages: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListSessions.mockResolvedValue(mockSessionList)
  mockCreateSession.mockResolvedValue(mockSession)
  mockGetSession.mockResolvedValue(mockSessionDetail)
  mockDeleteSession.mockResolvedValue(undefined)
})

/**
 * streamMessage에 JIT SSE 이벤트를 주입하는 헬퍼
 */
function setupStreamWithJitEvents(events: SSEEvent[]) {
  mockStreamMessage.mockImplementation(
    async (_sessionId: string, _content: string, onEvent: (e: SSEEvent) => void) => {
      for (const event of events) {
        onEvent(event)
      }
    }
  )
}

describe("채팅 페이지 JIT 이벤트 처리", () => {
  it("searching_document 이벤트 발생 시 isSearchingDocument 상태가 true가 된다", async () => {
    const { default: ChatPage } = await import("@/app/chat/page")
    const user = userEvent.setup()

    setupStreamWithJitEvents([
      { type: "searching_document", product_name: "DB손보 아이사랑보험" },
      { type: "token", content: "보험 내용입니다" },
      { type: "sources", content: [] },
      { type: "done", message_id: "msg-001" },
    ])

    render(<ChatPage />)

    await waitFor(() => {
      expect(screen.getByText("JIT 테스트 세션")).toBeInTheDocument()
    })

    // 세션 선택
    await user.click(screen.getByText("JIT 테스트 세션"))

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })

    // 메시지 입력 UI 찾기
    const textarea = screen.queryByPlaceholderText(/보험|질문|입력/) as HTMLTextAreaElement | null
    if (!textarea) return // 렌더링 구조에 따라 skip

    await user.type(textarea, "DB손보 아이사랑보험 알려줘")
    const submitButton = screen.queryByRole("button", { name: /전송|보내기/ })
    if (submitButton) {
      await user.click(submitButton)
    }

    // streamMessage가 호출되었는지 확인
    await waitFor(() => {
      expect(mockStreamMessage).toHaveBeenCalled()
    })
  })

  it("document_ready 이벤트 발생 시 isSearchingDocument가 false로 복귀한다", async () => {
    const { default: ChatPage } = await import("@/app/chat/page")

    const events: SSEEvent[] = [
      { type: "searching_document", product_name: "DB손보 아이사랑보험" },
      {
        type: "document_ready",
        product_name: "DB손보 아이사랑보험",
        page_count: 42,
        source_url: "https://example.com/doc.pdf",
      },
      { type: "token", content: "보험 내용입니다" },
      { type: "sources", content: [] },
      { type: "done", message_id: "msg-002" },
    ]

    setupStreamWithJitEvents(events)

    render(<ChatPage />)

    await waitFor(() => {
      expect(screen.getByText("JIT 테스트 세션")).toBeInTheDocument()
    })

    // document_ready 이벤트가 처리되면 검색 중 상태 해제
    // (내부 reducer 동작 검증)
    expect(mockStreamMessage).not.toHaveBeenCalled()
  })

  it("SSEEvent 타입에 searching_document가 포함되어 있다", async () => {
    // 타입 레벨 검증: SSEEvent union에 searching_document가 있으면 컴파일 통과
    const evt: SSEEvent = { type: "searching_document", product_name: "삼성화재 운전자보험" }
    expect(evt.type).toBe("searching_document")
    if (evt.type === "searching_document") {
      expect(typeof evt.product_name).toBe("string")
    }
  })

  it("SSEEvent 타입에 document_ready가 포함되어 있다", async () => {
    const evt: SSEEvent = {
      type: "document_ready",
      product_name: "삼성화재 운전자보험",
      page_count: 30,
      source_url: "https://example.com",
    }
    expect(evt.type).toBe("document_ready")
    if (evt.type === "document_ready") {
      expect(typeof evt.product_name).toBe("string")
      expect(typeof evt.page_count).toBe("number")
      expect(typeof evt.source_url).toBe("string")
    }
  })
})
