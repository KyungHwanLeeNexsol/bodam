/**
 * T-004: SSE 파서 JIT 이벤트 타입 테스트 (SPEC-JIT-002)
 *
 * searching_document 및 document_ready 이벤트 파싱 검증.
 */

import { describe, it, expect } from "vitest"
import { parseSSEStream } from "@/lib/api/sse-parser"
import type { SSEEvent } from "@/lib/types/chat"

function createMockResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })

  return { body: stream } as unknown as Response
}

describe("parseSSEStream - JIT 이벤트 타입", () => {
  it("searching_document 이벤트를 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"searching_document","product_name":"DB손보 아이사랑보험"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: "searching_document",
      product_name: "DB손보 아이사랑보험",
    })
  })

  it("document_ready 이벤트를 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"document_ready","product_name":"DB손보 아이사랑보험","page_count":42,"source_url":"https://example.com/doc.pdf"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: "document_ready",
      product_name: "DB손보 아이사랑보험",
      page_count: 42,
      source_url: "https://example.com/doc.pdf",
    })
  })

  it("document_ready 이벤트에서 source_url이 없으면 빈 문자열로 처리한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"document_ready","product_name":"삼성화재 운전자보험","page_count":10}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    const evt = events[0]
    expect(evt.type).toBe("document_ready")
    if (evt.type === "document_ready") {
      expect(evt.source_url).toBe("")
    }
  })

  it("searching_document 이벤트에서 product_name이 없으면 무시된다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"searching_document"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    // product_name이 없으면 null 반환 → 이벤트 무시
    expect(events).toHaveLength(0)
  })

  it("document_ready 이벤트에서 page_count가 없으면 무시된다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"document_ready","product_name":"삼성화재"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    // page_count가 없으면 null 반환 → 이벤트 무시
    expect(events).toHaveLength(0)
  })

  // SPEC-JIT-003: document_not_found 이벤트 파싱 테스트
  it("document_not_found 이벤트를 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"document_not_found","product_name":"DB손보 아이사랑보험"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: "document_not_found",
      product_name: "DB손보 아이사랑보험",
    })
  })

  it("document_not_found 이벤트에서 product_name이 없으면 무시된다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"document_not_found"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(0)
  })

  it("JIT 이벤트가 기존 token/done 이벤트와 함께 처리된다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"searching_document","product_name":"삼성화재 운전자보험"}\n\n',
      'data: {"type":"document_ready","product_name":"삼성화재 운전자보험","page_count":30,"source_url":"https://example.com"}\n\n',
      'data: {"type":"token","content":"보험 내용 입니다"}\n\n',
      'data: {"type":"done","message_id":"msg-123"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(4)
    expect(events[0].type).toBe("searching_document")
    expect(events[1].type).toBe("document_ready")
    expect(events[2].type).toBe("token")
    expect(events[3].type).toBe("done")
  })
})
