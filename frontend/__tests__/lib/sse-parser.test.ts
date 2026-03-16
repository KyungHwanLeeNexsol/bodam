import { describe, it, expect, vi } from "vitest"
import { parseSSEStream } from "@/lib/api/sse-parser"
import type { SSEEvent, Source } from "@/lib/types/chat"

// ReadableStream을 생성하는 헬퍼 함수
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

  return {
    body: stream,
  } as unknown as Response
}

describe("parseSSEStream", () => {
  // token 이벤트 파싱 테스트
  it("단일 token 이벤트를 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"token","content":"보험"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "token", content: "보험" })
  })

  // sources 이벤트 파싱 테스트
  it("sources 이벤트를 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    const sources: Source[] = [
      {
        policy_name: "실손의료보험",
        company_name: "삼성화재",
        chunk_text: "보험금 지급 조건",
        similarity_score: 0.95,
      },
    ]
    const response = createMockResponse([
      `data: ${JSON.stringify({ type: "sources", content: sources })}\n\n`,
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "sources", content: sources })
  })

  // done 이벤트 파싱 테스트
  it("done 이벤트를 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    const messageId = "550e8400-e29b-41d4-a716-446655440000"
    const response = createMockResponse([
      `data: {"type":"done","message_id":"${messageId}"}\n\n`,
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "done", message_id: messageId })
  })

  // error 이벤트 파싱 테스트
  it("error 이벤트를 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"error","content":"처리 중 오류가 발생했습니다"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: "error",
      content: "처리 중 오류가 발생했습니다",
    })
  })

  // 한 청크에 여러 이벤트가 포함된 경우
  it("한 청크에 여러 이벤트가 포함된 경우 모두 파싱한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      'data: {"type":"token","content":"보"}\n\ndata: {"type":"token","content":"험"}\n\ndata: {"type":"done","message_id":"abc123"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({ type: "token", content: "보" })
    expect(events[1]).toEqual({ type: "token", content: "험" })
    expect(events[2]).toEqual({ type: "done", message_id: "abc123" })
  })

  // 여러 청크로 나뉜 이벤트 버퍼링 테스트
  it("불완전한 청크를 버퍼링하여 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    // 이벤트가 두 청크로 분할된 경우
    const response = createMockResponse([
      'data: {"type":"token","cont',
      'ent":"보험"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "token", content: "보험" })
  })

  // 빈 줄 무시 테스트
  it("빈 줄을 무시한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      "\n\n",
      'data: {"type":"token","content":"테스트"}\n\n',
      "\n",
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "token", content: "테스트" })
  })

  // 주석 줄(`:` 시작) 무시 테스트
  it("콜론으로 시작하는 주석 줄을 무시한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      ": keep-alive\n\n",
      'data: {"type":"token","content":"테스트"}\n\n',
      ": another comment\n\n",
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "token", content: "테스트" })
  })

  // 잘못된 JSON 무시 테스트
  it("잘못된 JSON 데이터를 무시한다", async () => {
    const events: SSEEvent[] = []
    const response = createMockResponse([
      "data: {invalid json}\n\n",
      'data: {"type":"token","content":"유효한 이벤트"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "token", content: "유효한 이벤트" })
  })

  // guidance 이벤트 파싱 테스트
  it("guidance 이벤트를 올바르게 파싱한다", async () => {
    const events: SSEEvent[] = []
    const guidanceData = {
      dispute_type: "claim_denial",
      ambiguous_clauses: [],
      precedents: [],
      probability: { overall_score: 0.65, factors: [], confidence: 0.7, disclaimer: "" },
      evidence_strategy: { required_documents: [], recommended_documents: [], preparation_tips: [], timeline_advice: "" },
      escalation: { recommended_level: "fss_complaint", reason: "", next_steps: [], estimated_duration: "", cost_estimate: "" },
      disclaimer: "본 정보는 교육적 목적이며...",
      confidence: 0.7,
    }
    const response = createMockResponse([
      `data: ${JSON.stringify({ type: "guidance", content: guidanceData })}\n\n`,
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "guidance", content: guidanceData })
  })

  // body가 null인 경우 에러 테스트
  it("response.body가 null이면 에러를 던진다", async () => {
    const events: SSEEvent[] = []
    const response = { body: null } as unknown as Response

    await expect(
      parseSSEStream(response, (event) => events.push(event))
    ).rejects.toThrow()
  })

  // 여러 청크에 걸친 복합 시나리오
  it("여러 청크에 걸쳐 완전한 스트림을 처리한다", async () => {
    const events: SSEEvent[] = []
    const sources: Source[] = [
      { policy_name: "암보험", company_name: "현대해상" },
    ]
    const response = createMockResponse([
      'data: {"type":"token","content":"안"}\n\n',
      'data: {"type":"token","content":"녕"}\n\n',
      `data: ${JSON.stringify({ type: "sources", content: sources })}\n\n`,
      'data: {"type":"done","message_id":"msg-001"}\n\n',
    ])

    await parseSSEStream(response, (event) => events.push(event))

    expect(events).toHaveLength(4)
    expect(events[0]).toEqual({ type: "token", content: "안" })
    expect(events[1]).toEqual({ type: "token", content: "녕" })
    expect(events[2]).toEqual({ type: "sources", content: sources })
    expect(events[3]).toEqual({ type: "done", message_id: "msg-001" })
  })
})
