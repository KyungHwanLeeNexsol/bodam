/**
 * /chat 페이지 통합 테스트
 *
 * 테스트 범위:
 * 1. 페이지 렌더링 및 세션 목록 로드
 * 2. 새 세션 생성
 * 3. 세션 선택 시 메시지 로드
 * 4. 메시지 전송 및 스트리밍 응답
 * 5. 세션 미선택 시 EmptyState 표시
 * 6. 오류 처리 및 에러 배너 표시
 */

import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Mock } from "vitest"
import type {
  ChatSessionListItem,
  ChatSessionDetail,
  ChatSession,
  SSEEvent,
} from "@/lib/types/chat"

// ChatApiClient 메서드 목 저장소
const mockListSessions = vi.fn()
const mockCreateSession = vi.fn()
const mockGetSession = vi.fn()
const mockDeleteSession = vi.fn()
const mockSendMessage = vi.fn()
const mockStreamMessage = vi.fn()

// ChatApiClient 클래스 목 - 반드시 생성자처럼 동작해야 함
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

import ChatPage from "@/app/chat/page"

// 테스트용 데이터 팩토리
const makeSessions = (count: number): ChatSessionListItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `session-${i + 1}`,
    title: `테스트 대화 ${i + 1}`,
    user_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    message_count: 2,
  }))

const makeSessionDetail = (sessionId: string): ChatSessionDetail => ({
  id: sessionId,
  title: "테스트 대화",
  user_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  messages: [
    {
      id: "msg-1",
      session_id: sessionId,
      role: "user",
      content: "안녕하세요",
      metadata: null,
      created_at: new Date().toISOString(),
    },
    {
      id: "msg-2",
      session_id: sessionId,
      role: "assistant",
      content: "안녕하세요! 도움이 필요하신가요?",
      metadata: null,
      created_at: new Date().toISOString(),
    },
  ],
})

const makeNewSession = (id = "new-session-1"): ChatSession => ({
  id,
  title: "새 대화",
  user_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})

describe("ChatPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 기본 mock 설정
    mockListSessions.mockResolvedValue([])
    mockCreateSession.mockResolvedValue(makeNewSession())
    mockGetSession.mockResolvedValue(makeSessionDetail("session-1"))
    mockDeleteSession.mockResolvedValue(undefined)
    mockSendMessage.mockResolvedValue(undefined)
    mockStreamMessage.mockResolvedValue(undefined)
  })

  describe("초기 렌더링", () => {
    it("페이지가 렌더링된다", async () => {
      render(<ChatPage />)
      // 어떤 형태로든 페이지가 렌더링되어야 함
      await waitFor(() => {
        expect(document.body).toBeTruthy()
      })
    })

    it("마운트 시 세션 목록을 로드한다", async () => {
      const sessions = makeSessions(2)
      mockListSessions.mockResolvedValue(sessions)

      render(<ChatPage />)

      // 세션 목록이 로드된 후 세션 제목이 표시됨
      await waitFor(() => {
        expect(screen.getByText("테스트 대화 1")).toBeInTheDocument()
        expect(screen.getByText("테스트 대화 2")).toBeInTheDocument()
      })
    })

    it("세션이 없을 때 EmptyState가 표시된다", async () => {
      mockListSessions.mockResolvedValue([])

      render(<ChatPage />)

      // EmptyState 컴포넌트의 텍스트 확인
      await waitFor(() => {
        expect(screen.getByText("보담")).toBeInTheDocument()
        expect(screen.getByText("무엇이든 물어보세요")).toBeInTheDocument()
      })
    })

    it("세션 목록 로드 중 스켈레톤이 표시된다", async () => {
      // 로딩이 지연되는 상황 시뮬레이션
      mockListSessions.mockImplementation(
        () => new Promise(() => {}) // 절대 resolve되지 않음
      )

      render(<ChatPage />)

      // 스켈레톤 로딩 상태 확인 (animate-pulse 클래스가 있는 요소)
      await waitFor(() => {
        const skeletons = document.querySelectorAll(".animate-pulse")
        expect(skeletons.length).toBeGreaterThan(0)
      })
    })
  })

  describe("새 세션 생성", () => {
    it("새 대화 버튼 클릭 시 세션이 생성된다", async () => {
      const user = userEvent.setup()
      const newSession = makeNewSession("created-session-1")
      mockCreateSession.mockResolvedValue(newSession)

      render(<ChatPage />)

      // 세션 목록 로드 대기
      await waitFor(() => {
        expect(screen.getByText("새 대화")).toBeInTheDocument()
      })

      // 새 대화 버튼 클릭
      await user.click(screen.getByText("새 대화"))

      // createSession이 호출되었는지 확인
      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalled()
      })
    })

    it("새 세션 생성 후 채팅 입력창이 표시된다", async () => {
      const user = userEvent.setup()
      const newSession = makeNewSession()
      mockCreateSession.mockResolvedValue(newSession)

      render(<ChatPage />)

      await waitFor(() => {
        expect(screen.getByText("새 대화")).toBeInTheDocument()
      })

      await user.click(screen.getByText("새 대화"))

      // 새 세션 선택 후 채팅 입력창이 표시되어야 함
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("보험에 대해 궁금한 점을 물어보세요...")
        ).toBeInTheDocument()
      })
    })
  })

  describe("세션 선택", () => {
    it("세션 클릭 시 메시지 목록을 로드한다", async () => {
      const user = userEvent.setup()
      const sessions = makeSessions(1)
      const sessionDetail = makeSessionDetail("session-1")
      mockListSessions.mockResolvedValue(sessions)
      mockGetSession.mockResolvedValue(sessionDetail)

      render(<ChatPage />)

      // 세션 목록 로드 대기
      await waitFor(() => {
        expect(screen.getByText("테스트 대화 1")).toBeInTheDocument()
      })

      // 세션 클릭
      await user.click(screen.getByText("테스트 대화 1"))

      // getSession이 호출되고 메시지가 표시됨
      await waitFor(() => {
        expect(mockGetSession).toHaveBeenCalledWith("session-1")
      })

      await waitFor(() => {
        expect(screen.getByText("안녕하세요")).toBeInTheDocument()
        expect(screen.getByText("안녕하세요! 도움이 필요하신가요?")).toBeInTheDocument()
      })
    })
  })

  describe("메시지 전송 및 스트리밍", () => {
    it("메시지 전송 시 사용자 메시지가 즉시 표시된다", async () => {
      const user = userEvent.setup()
      const sessions = makeSessions(1)
      const sessionDetail = makeSessionDetail("session-1")
      mockListSessions.mockResolvedValue(sessions)
      mockGetSession.mockResolvedValue(sessionDetail)

      // streamMessage는 즉시 done 이벤트를 발생시킴
      mockStreamMessage.mockImplementation(
        async (
          _sessionId: string,
          _content: string,
          onEvent: (event: SSEEvent) => void
        ) => {
          onEvent({
            type: "done",
            message_id: "assistant-msg-1",
          })
        }
      )

      render(<ChatPage />)

      // 세션 선택
      await waitFor(() => {
        expect(screen.getByText("테스트 대화 1")).toBeInTheDocument()
      })
      await user.click(screen.getByText("테스트 대화 1"))

      // 메시지 로드 대기
      await waitFor(() => {
        expect(screen.getByText("안녕하세요")).toBeInTheDocument()
      })

      // 새 메시지 입력 및 전송
      const input = screen.getByPlaceholderText("보험에 대해 궁금한 점을 물어보세요...")
      await user.type(input, "실손보험이 뭔가요?")
      await user.keyboard("{Enter}")

      // 사용자 메시지가 즉시 표시되어야 함
      await waitFor(() => {
        expect(screen.getByText("실손보험이 뭔가요?")).toBeInTheDocument()
      })
    })

    it("스트리밍 중 StreamingMessage가 표시된다", async () => {
      const user = userEvent.setup()
      const sessions = makeSessions(1)
      const sessionDetail = makeSessionDetail("session-1")
      mockListSessions.mockResolvedValue(sessions)
      mockGetSession.mockResolvedValue(sessionDetail)

      // streamMessage가 token 이벤트를 발생시키고 완료되지 않는 상황
      let streamResolve: (() => void) | undefined
      mockStreamMessage.mockImplementation(
        async (
          _sessionId: string,
          _content: string,
          onEvent: (event: SSEEvent) => void
        ) => {
          onEvent({ type: "token", content: "실손보험은 " })
          onEvent({ type: "token", content: "실제 치료비를 " })
          // done 이벤트를 지연시킴
          await new Promise<void>((resolve) => {
            streamResolve = resolve
          })
        }
      )

      render(<ChatPage />)

      await waitFor(() => {
        expect(screen.getByText("테스트 대화 1")).toBeInTheDocument()
      })
      await user.click(screen.getByText("테스트 대화 1"))

      await waitFor(() => {
        expect(screen.getByText("안녕하세요")).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText("보험에 대해 궁금한 점을 물어보세요...")
      await user.type(input, "실손보험이 뭔가요?")
      await user.keyboard("{Enter}")

      // 스트리밍 중 토큰이 표시되어야 함
      await waitFor(() => {
        expect(screen.getByText(/실손보험은/)).toBeInTheDocument()
      })

      // 정리
      act(() => {
        streamResolve?.()
      })
    })
  })

  describe("오류 처리", () => {
    it("세션 목록 로드 실패 시 오류가 처리된다", async () => {
      mockListSessions.mockRejectedValue(new Error("서버에 연결할 수 없습니다"))

      render(<ChatPage />)

      // 오류가 발생해도 앱이 크래시되지 않아야 함
      await waitFor(() => {
        expect(document.body).toBeTruthy()
      })
    })

    it("스트리밍 오류 발생 시 에러 배너가 표시된다", async () => {
      const user = userEvent.setup()
      const sessions = makeSessions(1)
      const sessionDetail = makeSessionDetail("session-1")
      mockListSessions.mockResolvedValue(sessions)
      mockGetSession.mockResolvedValue(sessionDetail)

      mockStreamMessage.mockImplementation(
        async (
          _sessionId: string,
          _content: string,
          onEvent: (event: SSEEvent) => void
        ) => {
          onEvent({ type: "error", content: "AI 서비스 오류가 발생했습니다" })
        }
      )

      render(<ChatPage />)

      await waitFor(() => {
        expect(screen.getByText("테스트 대화 1")).toBeInTheDocument()
      })
      await user.click(screen.getByText("테스트 대화 1"))

      await waitFor(() => {
        expect(screen.getByText("안녕하세요")).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText("보험에 대해 궁금한 점을 물어보세요...")
      await user.type(input, "오류 테스트")
      await user.keyboard("{Enter}")

      // 에러 메시지가 표시되어야 함
      await waitFor(() => {
        expect(screen.getByText("AI 서비스 오류가 발생했습니다")).toBeInTheDocument()
      })
    })

    it("에러 배너의 닫기 버튼으로 오류를 해제한다", async () => {
      const user = userEvent.setup()
      const sessions = makeSessions(1)
      const sessionDetail = makeSessionDetail("session-1")
      mockListSessions.mockResolvedValue(sessions)
      mockGetSession.mockResolvedValue(sessionDetail)

      mockStreamMessage.mockImplementation(
        async (
          _sessionId: string,
          _content: string,
          onEvent: (event: SSEEvent) => void
        ) => {
          onEvent({ type: "error", content: "테스트 오류" })
        }
      )

      render(<ChatPage />)

      await waitFor(() => {
        expect(screen.getByText("테스트 대화 1")).toBeInTheDocument()
      })
      await user.click(screen.getByText("테스트 대화 1"))

      await waitFor(() => {
        expect(screen.getByText("안녕하세요")).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText("보험에 대해 궁금한 점을 물어보세요...")
      await user.type(input, "오류 테스트")
      await user.keyboard("{Enter}")

      await waitFor(() => {
        expect(screen.getByText("테스트 오류")).toBeInTheDocument()
      })

      // 닫기 버튼 클릭
      const dismissButton = screen.getByLabelText("오류 닫기")
      await user.click(dismissButton)

      // 에러 메시지가 사라져야 함
      await waitFor(() => {
        expect(screen.queryByText("테스트 오류")).not.toBeInTheDocument()
      })
    })
  })

  describe("세션 삭제", () => {
    it("현재 세션 삭제 시 deleteSession이 호출된다", async () => {
      const user = userEvent.setup()
      const sessions = makeSessions(1)
      const sessionDetail = makeSessionDetail("session-1")
      mockListSessions.mockResolvedValue(sessions)
      mockGetSession.mockResolvedValue(sessionDetail)

      // window.confirm을 true로 목 처리
      vi.spyOn(window, "confirm").mockReturnValue(true)

      render(<ChatPage />)

      await waitFor(() => {
        expect(screen.getByText("테스트 대화 1")).toBeInTheDocument()
      })

      // 세션 선택
      await user.click(screen.getByText("테스트 대화 1"))

      await waitFor(() => {
        expect(screen.getByText("안녕하세요")).toBeInTheDocument()
      })

      // 삭제 버튼 클릭 (hover 상태에서 표시되는 버튼)
      const deleteButton = screen.getByRole("button", { name: "삭제" })
      await user.click(deleteButton)

      // deleteSession이 호출되어야 함
      await waitFor(() => {
        expect(mockDeleteSession).toHaveBeenCalledWith("session-1")
      })
    })
  })
})
