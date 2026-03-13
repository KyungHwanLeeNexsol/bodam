import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ChatApiClient } from "@/lib/api/chat-client"
import type {
  ChatSession,
  ChatSessionListItem,
  ChatSessionDetail,
  ChatMessage,
  MessageSendResponse,
  Source,
} from "@/lib/types/chat"

// fetch 모킹
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// 테스트용 더미 데이터
const dummySession: ChatSession = {
  id: "session-001",
  title: "보험 청구 문의",
  user_id: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
}

const dummyMessage: ChatMessage = {
  id: "msg-001",
  session_id: "session-001",
  role: "user",
  content: "보험 청구 방법을 알려주세요",
  metadata: null,
  created_at: "2024-01-01T00:00:00Z",
}

const dummyAssistantMessage: ChatMessage = {
  id: "msg-002",
  session_id: "session-001",
  role: "assistant",
  content: "보험 청구는 다음과 같이 진행합니다",
  metadata: null,
  created_at: "2024-01-01T00:00:00Z",
}

// 성공 응답을 생성하는 헬퍼 함수
function createSuccessResponse(data: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response
}

// 실패 응답을 생성하는 헬퍼 함수
function createErrorResponse(status: number, data?: unknown): Response {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(data ?? { detail: "Error" }),
  } as unknown as Response
}

describe("ChatApiClient", () => {
  let client: ChatApiClient

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000")
    client = new ChatApiClient()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe("생성자", () => {
    it("환경변수에서 baseUrl을 읽어온다", () => {
      vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.example.com")
      const customClient = new ChatApiClient()
      expect(customClient.baseUrl).toBe("http://api.example.com")
    })

    it("환경변수가 없으면 기본값 http://localhost:8000을 사용한다", () => {
      vi.stubEnv("NEXT_PUBLIC_API_URL", "")
      const defaultClient = new ChatApiClient()
      expect(defaultClient.baseUrl).toBe("http://localhost:8000")
    })
  })

  describe("createSession", () => {
    it("POST /api/v1/chat/sessions를 호출한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummySession))

      await client.createSession()

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/chat/sessions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      )
    })

    it("title이 있으면 body에 포함하여 전송한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummySession))

      await client.createSession("새 세션")

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ title: "새 세션" }),
        })
      )
    })

    it("title이 없으면 빈 body를 전송한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummySession))

      await client.createSession()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({}),
        })
      )
    })

    it("ChatSession 객체를 반환한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummySession))

      const result = await client.createSession()

      expect(result).toEqual(dummySession)
    })
  })

  describe("listSessions", () => {
    const dummyList: ChatSessionListItem[] = [
      { ...dummySession, message_count: 5 },
    ]

    it("GET /api/v1/chat/sessions를 호출한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyList))

      await client.listSessions()

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/chat/sessions",
        expect.objectContaining({ method: "GET" })
      )
    })

    it("limit와 offset 쿼리 파라미터를 전달한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyList))

      await client.listSessions(10, 20)

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/chat/sessions?limit=10&offset=20",
        expect.any(Object)
      )
    })

    it("파라미터 없이 호출하면 쿼리스트링이 없다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyList))

      await client.listSessions()

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/chat/sessions",
        expect.any(Object)
      )
    })

    it("ChatSessionListItem 배열을 반환한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyList))

      const result = await client.listSessions()

      expect(result).toEqual(dummyList)
    })
  })

  describe("getSession", () => {
    const dummyDetail: ChatSessionDetail = {
      ...dummySession,
      messages: [dummyMessage],
    }

    it("GET /api/v1/chat/sessions/{id}를 호출한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyDetail))

      await client.getSession("session-001")

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/chat/sessions/session-001",
        expect.objectContaining({ method: "GET" })
      )
    })

    it("ChatSessionDetail 객체를 반환한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyDetail))

      const result = await client.getSession("session-001")

      expect(result).toEqual(dummyDetail)
    })
  })

  describe("deleteSession", () => {
    it("DELETE /api/v1/chat/sessions/{id}를 호출한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(null, 204))

      await client.deleteSession("session-001")

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/chat/sessions/session-001",
        expect.objectContaining({ method: "DELETE" })
      )
    })

    it("void를 반환한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(null, 204))

      const result = await client.deleteSession("session-001")

      expect(result).toBeUndefined()
    })
  })

  describe("sendMessage", () => {
    const dummyResponse: MessageSendResponse = {
      user_message: dummyMessage,
      assistant_message: dummyAssistantMessage,
    }

    it("POST /api/v1/chat/sessions/{id}/messages를 호출한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyResponse))

      await client.sendMessage("session-001", "안녕하세요")

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/chat/sessions/session-001/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ content: "안녕하세요" }),
        })
      )
    })

    it("MessageSendResponse 객체를 반환한다", async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyResponse))

      const result = await client.sendMessage("session-001", "안녕하세요")

      expect(result).toEqual(dummyResponse)
    })
  })

  describe("streamMessage", () => {
    it("POST /api/v1/chat/sessions/{id}/messages/stream을 호출한다", async () => {
      // SSE 스트림 모킹
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"type":"done","message_id":"m1"}\n\n')
          )
          controller.close()
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as unknown as Response)

      await client.streamMessage("session-001", "안녕하세요", vi.fn())

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/chat/sessions/session-001/messages/stream",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ content: "안녕하세요" }),
        })
      )
    })

    it("SSE 이벤트를 onEvent 콜백으로 전달한다", async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"token","content":"보험"}\n\ndata: {"type":"done","message_id":"m1"}\n\n'
            )
          )
          controller.close()
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as unknown as Response)

      const onEvent = vi.fn()
      await client.streamMessage("session-001", "안녕하세요", onEvent)

      expect(onEvent).toHaveBeenCalledTimes(2)
      expect(onEvent).toHaveBeenNthCalledWith(1, {
        type: "token",
        content: "보험",
      })
      expect(onEvent).toHaveBeenNthCalledWith(2, {
        type: "done",
        message_id: "m1",
      })
    })
  })

  describe("에러 처리", () => {
    it("404 오류 시 한국어 메시지를 던진다", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(404))

      await expect(client.getSession("nonexistent")).rejects.toThrow(
        "세션을 찾을 수 없습니다"
      )
    })

    it("422 오류 시 한국어 메시지를 던진다", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(422))

      await expect(
        client.sendMessage("session-001", "")
      ).rejects.toThrow("입력값이 올바르지 않습니다")
    })

    it("500 오류 시 한국어 메시지를 던진다", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(500))

      await expect(client.listSessions()).rejects.toThrow(
        "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요"
      )
    })

    it("네트워크 오류 시 한국어 메시지를 던진다", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))

      await expect(client.listSessions()).rejects.toThrow(
        "서버에 연결할 수 없습니다. 네트워크를 확인해 주세요"
      )
    })

    it("알 수 없는 상태 코드 오류 시 detail 메시지를 던진다", async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(503, { detail: "서비스 불가" })
      )

      await expect(client.listSessions()).rejects.toThrow("서비스 불가")
    })

    it("스트리밍 요청의 404 오류 시 한국어 메시지를 던진다", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(404))

      await expect(
        client.streamMessage("nonexistent", "test", vi.fn())
      ).rejects.toThrow("세션을 찾을 수 없습니다")
    })
  })

  describe("Accept 헤더", () => {
    it("스트리밍 요청 시 Accept: text/event-stream 헤더를 포함한다", async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"type":"done","message_id":"m1"}\n\n')
          )
          controller.close()
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as unknown as Response)

      await client.streamMessage("session-001", "테스트", vi.fn())

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "text/event-stream",
          }),
        })
      )
    })
  })

  describe("Sources 타입 변환", () => {
    it("스트리밍에서 sources 이벤트의 similarity 필드를 올바르게 처리한다", async () => {
      const sources: Source[] = [
        {
          policy_name: "실손의료보험",
          company_name: "삼성화재",
          similarity_score: 0.95,
        },
      ]
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "sources", content: sources })}\n\ndata: {"type":"done","message_id":"m1"}\n\n`
            )
          )
          controller.close()
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as unknown as Response)

      const onEvent = vi.fn()
      await client.streamMessage("session-001", "테스트", onEvent)

      expect(onEvent).toHaveBeenCalledWith({
        type: "sources",
        content: sources,
      })
    })
  })
})
