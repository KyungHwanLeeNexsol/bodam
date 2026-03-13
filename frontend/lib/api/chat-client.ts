import { parseSSEStream } from "@/lib/api/sse-parser"
import type {
  ChatSession,
  ChatSessionListItem,
  ChatSessionDetail,
  MessageSendResponse,
  SSEEvent,
} from "@/lib/types/chat"

// HTTP 상태 코드별 한국어 오류 메시지 매핑
const HTTP_ERROR_MESSAGES: Record<number, string> = {
  404: "세션을 찾을 수 없습니다",
  422: "입력값이 올바르지 않습니다",
  500: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요",
}

// 네트워크 오류 메시지
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크를 확인해 주세요"

/**
 * 보담 AI 보험 청구 안내 API 클라이언트
 * fetch API를 사용하여 백엔드와 통신합니다.
 */
export class ChatApiClient {
  readonly baseUrl: string

  constructor() {
    this.baseUrl =
      process.env["NEXT_PUBLIC_API_URL"] || "http://localhost:8000"
  }

  /**
   * HTTP 오류 응답을 한국어 메시지로 변환합니다.
   * @param response - fetch Response 객체
   * @throws 한국어 오류 메시지를 가진 Error
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    const errorMessage = HTTP_ERROR_MESSAGES[response.status]
    if (errorMessage) {
      throw new Error(errorMessage)
    }

    // 알 수 없는 상태 코드는 서버 응답의 detail 메시지 사용
    try {
      const data: unknown = await response.json()
      if (
        data &&
        typeof data === "object" &&
        "detail" in data &&
        typeof (data as Record<string, unknown>)["detail"] === "string"
      ) {
        throw new Error((data as Record<string, string>)["detail"])
      }
    } catch (e) {
      // json 파싱 실패 시 원래 에러 재던지기 방지
      if (e instanceof Error && e.message !== "Failed to parse JSON") {
        throw e
      }
    }

    throw new Error(`HTTP ${response.status} 오류가 발생했습니다`)
  }

  /**
   * 공통 fetch 요청 처리 (네트워크 오류 포함)
   * @param url - 요청 URL
   * @param options - fetch 옵션
   * @returns Response 객체
   */
  private async request(url: string, options: RequestInit): Promise<Response> {
    try {
      const response = await fetch(url, options)
      return response
    } catch {
      throw new Error(NETWORK_ERROR_MESSAGE)
    }
  }

  /**
   * 새 채팅 세션을 생성합니다.
   * @param title - 세션 제목 (선택)
   * @returns 생성된 ChatSession
   */
  async createSession(title?: string): Promise<ChatSession> {
    const body: Record<string, string> = {}
    if (title !== undefined) {
      body["title"] = title
    }

    const response = await this.request(
      `${this.baseUrl}/api/v1/chat/sessions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }

    return response.json() as Promise<ChatSession>
  }

  /**
   * 채팅 세션 목록을 조회합니다.
   * @param limit - 조회할 최대 개수 (선택)
   * @param offset - 건너뛸 개수 (선택)
   * @returns ChatSessionListItem 배열
   */
  async listSessions(
    limit?: number,
    offset?: number
  ): Promise<ChatSessionListItem[]> {
    let url = `${this.baseUrl}/api/v1/chat/sessions`

    // 쿼리 파라미터 구성
    const params: string[] = []
    if (limit !== undefined) {
      params.push(`limit=${limit}`)
    }
    if (offset !== undefined) {
      params.push(`offset=${offset}`)
    }
    if (params.length > 0) {
      url += `?${params.join("&")}`
    }

    const response = await this.request(url, { method: "GET" })

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }

    return response.json() as Promise<ChatSessionListItem[]>
  }

  /**
   * 특정 채팅 세션의 상세 정보를 조회합니다.
   * @param sessionId - 세션 ID
   * @returns ChatSessionDetail (메시지 목록 포함)
   */
  async getSession(sessionId: string): Promise<ChatSessionDetail> {
    const response = await this.request(
      `${this.baseUrl}/api/v1/chat/sessions/${sessionId}`,
      { method: "GET" }
    )

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }

    return response.json() as Promise<ChatSessionDetail>
  }

  /**
   * 채팅 세션을 삭제합니다.
   * @param sessionId - 삭제할 세션 ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await this.request(
      `${this.baseUrl}/api/v1/chat/sessions/${sessionId}`,
      { method: "DELETE" }
    )

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }
  }

  /**
   * 메시지를 전송하고 응답을 받습니다 (비스트리밍).
   * @param sessionId - 세션 ID
   * @param content - 전송할 메시지 내용
   * @returns MessageSendResponse (사용자 메시지 + 어시스턴트 메시지)
   */
  async sendMessage(
    sessionId: string,
    content: string
  ): Promise<MessageSendResponse> {
    const response = await this.request(
      `${this.baseUrl}/api/v1/chat/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }
    )

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }

    return response.json() as Promise<MessageSendResponse>
  }

  /**
   * SSE 스트리밍으로 메시지를 전송합니다.
   * @param sessionId - 세션 ID
   * @param content - 전송할 메시지 내용
   * @param onEvent - SSE 이벤트를 처리하는 콜백 함수
   */
  async streamMessage(
    sessionId: string,
    content: string,
    onEvent: (event: SSEEvent) => void
  ): Promise<void> {
    const response = await this.request(
      `${this.baseUrl}/api/v1/chat/sessions/${sessionId}/messages/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ content }),
      }
    )

    if (!response.ok) {
      await this.handleErrorResponse(response)
    }

    await parseSSEStream(response, onEvent)
  }
}
