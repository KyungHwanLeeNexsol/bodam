import type { GuidanceData, SSEEvent } from "@/lib/types/chat"

/**
 * SSE(Server-Sent Events) 스트림을 파싱하여 이벤트 콜백을 호출합니다.
 * @param response - fetch API의 Response 객체
 * @param onEvent - SSE 이벤트를 처리하는 콜백 함수
 */
export async function parseSSEStream(
  response: Response,
  onEvent: (event: SSEEvent) => void
): Promise<void> {
  if (!response.body) {
    throw new Error("응답 본문이 없습니다")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  // 불완전한 청크를 누적하는 버퍼
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        // 스트림 종료 시 버퍼에 남은 데이터 처리
        if (buffer.trim()) {
          processLine(buffer.trim(), onEvent)
        }
        break
      }

      // 청크를 문자열로 디코딩하여 버퍼에 추가
      buffer += decoder.decode(value, { stream: true })

      // 줄 단위로 분리하여 처리
      const lines = buffer.split("\n")

      // 마지막 줄은 불완전할 수 있으므로 버퍼에 유지
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        processLine(line, onEvent)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 단일 SSE 라인을 파싱하여 이벤트를 처리합니다.
 * @param line - 처리할 단일 줄
 * @param onEvent - SSE 이벤트를 처리하는 콜백 함수
 */
function processLine(line: string, onEvent: (event: SSEEvent) => void): void {
  // 빈 줄 무시
  if (!line.trim()) {
    return
  }

  // 주석 줄 무시 (콜론으로 시작)
  if (line.startsWith(":")) {
    return
  }

  // data: 접두사가 없는 줄 무시
  if (!line.startsWith("data:")) {
    return
  }

  // "data: " 접두사 제거
  const jsonStr = line.slice(5).trim()

  if (!jsonStr) {
    return
  }

  // JSON 파싱 시도
  try {
    const parsed: unknown = JSON.parse(jsonStr)
    const event = parseSSEEvent(parsed)
    if (event) {
      onEvent(event)
    }
  } catch {
    // 잘못된 JSON은 무시
  }
}

/**
 * 파싱된 JSON 객체를 SSEEvent 타입으로 변환합니다.
 * @param data - 파싱된 JSON 데이터
 * @returns SSEEvent 또는 null (유효하지 않은 경우)
 */
function parseSSEEvent(data: unknown): SSEEvent | null {
  if (!data || typeof data !== "object") {
    return null
  }

  const obj = data as Record<string, unknown>

  if (typeof obj["type"] !== "string") {
    return null
  }

  const type = obj["type"]

  switch (type) {
    case "token": {
      if (typeof obj["content"] !== "string") {
        return null
      }
      return { type: "token", content: obj["content"] }
    }

    case "sources": {
      if (!Array.isArray(obj["content"])) {
        return null
      }
      // Source 배열 검증
      const sources = obj["content"].filter(
        (s): s is { policy_name: string; company_name: string } =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as Record<string, unknown>)["policy_name"] === "string" &&
          typeof (s as Record<string, unknown>)["company_name"] === "string"
      )
      return { type: "sources", content: sources }
    }

    case "guidance": {
      if (!obj["content"] || typeof obj["content"] !== "object") {
        return null
      }
      return { type: "guidance", content: obj["content"] as GuidanceData }
    }

    case "done": {
      if (typeof obj["message_id"] !== "string") {
        return null
      }
      return { type: "done", message_id: obj["message_id"] }
    }

    case "error": {
      if (typeof obj["content"] !== "string") {
        return null
      }
      return { type: "error", content: obj["content"] }
    }

    case "title_update": {
      if (typeof obj["title"] !== "string") {
        return null
      }
      return { type: "title_update", title: obj["title"] }
    }

    case "searching_document": {
      if (typeof obj["product_name"] !== "string") {
        return null
      }
      return { type: "searching_document", product_name: obj["product_name"] }
    }

    case "document_ready": {
      if (typeof obj["product_name"] !== "string" || typeof obj["page_count"] !== "number") {
        return null
      }
      return {
        type: "document_ready",
        product_name: obj["product_name"],
        page_count: obj["page_count"],
        source_url: typeof obj["source_url"] === "string" ? obj["source_url"] : "",
      }
    }

    default:
      return null
  }
}
