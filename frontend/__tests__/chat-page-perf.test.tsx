/**
 * SPEC-CHAT-PERF-001 T-005/T-006: 프론트엔드 페이지네이션 상태 테스트
 *
 * T-005: 마운트 시 listSessions(20, 0)으로 초기 호출 검증
 * T-006: Load More 클릭 시 listSessions(20, offset)으로 추가 호출 검증
 */

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PaginatedSessionListResponse } from "@/lib/types/chat"

// ChatApiClient 메서드 목 저장소
const mockListSessions = vi.fn()
const mockCreateSession = vi.fn()
const mockGetSession = vi.fn()
const mockDeleteSession = vi.fn()
const mockSendMessage = vi.fn()
const mockStreamMessage = vi.fn()

// useAuth 모킹
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    userProfile: null,
  }),
}))

// ChatApiClient 클래스 목
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

// 페이지네이션 응답 팩토리
function makePaginatedResponse(
  count: number,
  hasMore = false,
  totalCount?: number
): PaginatedSessionListResponse {
  return {
    sessions: Array.from({ length: count }, (_, i) => ({
      id: `session-${i + 1}`,
      title: `테스트 대화 ${i + 1}`,
      user_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 0,
    })),
    total_count: totalCount ?? count,
    has_more: hasMore,
  }
}

describe("SPEC-CHAT-PERF-001 프론트엔드 페이지네이션", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSession.mockResolvedValue({
      id: "new-session",
      title: "새 대화",
      user_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    mockGetSession.mockResolvedValue({
      id: "session-1",
      title: "테스트 대화",
      user_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [],
    })
    mockDeleteSession.mockResolvedValue(undefined)
  })

  describe("T-005: 마운트 시 초기 로드", () => {
    it("마운트 시 listSessions(20, 0)으로 호출해야 함", async () => {
      // 빈 목록으로 응답
      mockListSessions.mockResolvedValue(makePaginatedResponse(0))

      render(<ChatPage />)

      // listSessions가 호출될 때까지 대기
      await waitFor(() => {
        expect(mockListSessions).toHaveBeenCalled()
      })

      // limit=20, offset=0으로 첫 호출 검증
      expect(mockListSessions).toHaveBeenCalledWith(20, 0)
    })

    it("초기 로드 시 offset은 항상 0이어야 함", async () => {
      mockListSessions.mockResolvedValue(makePaginatedResponse(3))

      render(<ChatPage />)

      await waitFor(() => {
        expect(mockListSessions).toHaveBeenCalled()
      })

      // 첫 번째 호출의 두 번째 인수(offset)가 0인지 확인
      const firstCall = mockListSessions.mock.calls[0]
      expect(firstCall[1]).toBe(0)
    })
  })

  describe("T-006: Load More 버튼 페이지네이션", () => {
    it("has_more=true 일 때 Load More 버튼이 표시된다", async () => {
      // has_more=true: 더 많은 세션이 있음
      mockListSessions.mockResolvedValue(
        makePaginatedResponse(20, true, 45)
      )

      render(<ChatPage />)

      await waitFor(() => {
        expect(screen.getByText(/더 보기|Load More|더 불러오기/i)).toBeInTheDocument()
      })
    })

    it("Load More 클릭 시 offset=20으로 listSessions를 호출한다", async () => {
      const user = userEvent.setup()
      // 1차 로드: 20개, has_more=true
      mockListSessions
        .mockResolvedValueOnce(makePaginatedResponse(20, true, 45))
        // 2차 로드: 다음 20개
        .mockResolvedValueOnce(makePaginatedResponse(20, true, 45))

      render(<ChatPage />)

      // 초기 로드 완료 대기
      await waitFor(() => {
        expect(mockListSessions).toHaveBeenCalledWith(20, 0)
      })

      // Load More 버튼 클릭
      const loadMoreBtn = await screen.findByText(/더 보기|Load More|더 불러오기/i)
      await user.click(loadMoreBtn)

      // 두 번째 호출: limit=20, offset=20
      await waitFor(() => {
        expect(mockListSessions).toHaveBeenCalledWith(20, 20)
      })
    })
  })
})
