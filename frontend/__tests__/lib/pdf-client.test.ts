/**
 * PDF API 클라이언트 단위 테스트 (SPEC-PDF-001 M4)
 *
 * uploadPdfApi, analyzePdfApi, queryPdfStreamApi,
 * listSessionsApi, getSessionApi, deleteSessionApi 검증.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PdfUpload, PdfAnalysis, Session, SessionDetail } from '@/lib/pdf'

// fetch 모킹
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// XHR 인스턴스를 캡처하기 위한 변수
interface MockXHRInstance {
  upload: { onprogress: ((e: ProgressEvent) => void) | null }
  onload: (() => void) | null
  onerror: (() => void) | null
  ontimeout: (() => void) | null
  status: number
  responseText: string
  headers: Record<string, string>
}

let capturedXhr: MockXHRInstance | null = null

const OriginalXMLHttpRequest = global.XMLHttpRequest

// 성공 응답 헬퍼
function createSuccessResponse(data: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(data),
    body: null,
  } as unknown as Response
}

// 실패 응답 헬퍼
function createErrorResponse(status: number, data?: unknown): Response {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(data ?? { detail: '오류가 발생했습니다.' }),
    body: null,
  } as unknown as Response
}

// 더미 데이터
const dummyUpload: PdfUpload = {
  id: 'upload-001',
  filename: 'test.pdf',
  file_size: 1024,
  status: 'uploaded',
}

const dummyAnalysis: PdfAnalysis = {
  session_id: 'session-001',
  analysis: {
    담보목록: [{ 명칭: '사망담보', 보상금액: '1억', 조건: '일반사망' }],
    보상조건: ['질병으로 인한 사망'],
    면책사항: ['자살은 보상하지 않음'],
    보상한도: '1억원',
  },
  token_usage: {
    input_tokens: 1000,
    output_tokens: 500,
    cost_usd: 0.0015,
  },
}

const dummySession: Session = {
  id: 'session-001',
  title: '삼성화재 실손보험 분석',
  status: 'active',
  created_at: '2024-01-01T00:00:00Z',
}

const dummySessionDetail: SessionDetail = {
  ...dummySession,
  upload_id: 'upload-001',
  initial_analysis: dummyAnalysis.analysis,
  messages: [
    { role: 'user', content: '담보목록을 알려주세요' },
    { role: 'assistant', content: '사망담보가 있습니다.' },
  ],
}

describe('PDF API 클라이언트', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000')
    mockFetch.mockReset()
    capturedXhr = null
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    // XHR 모킹을 설정했으면 원래대로 복원
    if (global.XMLHttpRequest !== OriginalXMLHttpRequest) {
      global.XMLHttpRequest = OriginalXMLHttpRequest
    }
  })

  describe('uploadPdfApi', () => {
    function setupXhrMock() {
      capturedXhr = null
      // 클래스 형식으로 XHR 모킹 (new 키워드 지원)
      class MockXHR {
        upload = { onprogress: null as ((e: ProgressEvent) => void) | null }
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        ontimeout: (() => void) | null = null
        status = 200
        responseText = ''
        headers: Record<string, string> = {}

        constructor() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          capturedXhr = this
        }

        open(_method: string, _url: string) {}
        setRequestHeader(key: string, value: string) { this.headers[key] = value }
        send(_data: FormData) {}
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      global.XMLHttpRequest = MockXHR as any
    }

    it('XMLHttpRequest로 POST /api/v1/pdf/upload를 호출한다', async () => {
      setupXhrMock()

      const { uploadPdfApi } = await import('@/lib/pdf')
      const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' })
      const promise = uploadPdfApi(file, 'token-123')

      // 다음 마이크로태스크에서 XHR 이벤트 트리거
      await Promise.resolve()
      if (capturedXhr) {
        capturedXhr.status = 200
        capturedXhr.responseText = JSON.stringify(dummyUpload)
        capturedXhr.onload?.()
      }

      const result = await promise
      expect(result).toEqual(dummyUpload)
      expect(capturedXhr?.headers['Authorization']).toBe('Bearer token-123')
    })

    it('업로드 진행률 콜백을 호출한다', async () => {
      setupXhrMock()

      const { uploadPdfApi } = await import('@/lib/pdf')
      const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' })
      const onProgress = vi.fn()
      const promise = uploadPdfApi(file, 'token-123', onProgress)

      await Promise.resolve()
      if (capturedXhr) {
        // progress 이벤트 트리거
        const progressEvent = { lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent
        capturedXhr.upload.onprogress?.(progressEvent)

        // 완료
        capturedXhr.status = 200
        capturedXhr.responseText = JSON.stringify(dummyUpload)
        capturedXhr.onload?.()
      }

      await promise
      expect(onProgress).toHaveBeenCalledWith(50)
    })

    it('업로드 실패 시 에러를 던진다', async () => {
      setupXhrMock()

      const { uploadPdfApi } = await import('@/lib/pdf')
      const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' })
      const promise = uploadPdfApi(file, 'token-123')

      await Promise.resolve()
      if (capturedXhr) {
        capturedXhr.status = 400
        capturedXhr.responseText = JSON.stringify({ detail: 'PDF 업로드에 실패했습니다.' })
        capturedXhr.onload?.()
      }

      await expect(promise).rejects.toThrow('PDF 업로드에 실패했습니다.')
    })

    it('네트워크 오류 시 에러를 던진다', async () => {
      setupXhrMock()

      const { uploadPdfApi } = await import('@/lib/pdf')
      const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' })
      const promise = uploadPdfApi(file, 'token-123')

      await Promise.resolve()
      capturedXhr?.onerror?.()

      await expect(promise).rejects.toThrow('네트워크 오류가 발생했습니다.')
    })

    it('업로드 타임아웃 시 에러를 던진다', async () => {
      setupXhrMock()

      const { uploadPdfApi } = await import('@/lib/pdf')
      const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' })
      const promise = uploadPdfApi(file, 'token-123')

      await Promise.resolve()
      capturedXhr?.ontimeout?.()

      await expect(promise).rejects.toThrow('업로드 시간이 초과되었습니다.')
    })
  })

  describe('analyzePdfApi', () => {
    it('POST /api/v1/pdf/{uploadId}/analyze를 호출한다', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyAnalysis))

      const { analyzePdfApi } = await import('@/lib/pdf')
      await analyzePdfApi('upload-001', 'token-123')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/pdf/upload-001/analyze',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
          }),
        })
      )
    })

    it('PdfAnalysis 객체를 반환한다', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummyAnalysis))

      const { analyzePdfApi } = await import('@/lib/pdf')
      const result = await analyzePdfApi('upload-001', 'token-123')

      expect(result).toEqual(dummyAnalysis)
    })

    it('분석 실패 시 에러를 던진다', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(500, { detail: 'PDF 분석에 실패했습니다.' })
      )

      const { analyzePdfApi } = await import('@/lib/pdf')
      await expect(analyzePdfApi('upload-001', 'token-123')).rejects.toThrow(
        'PDF 분석에 실패했습니다.'
      )
    })

    it('상세 에러 없을 때 기본 메시지를 사용한다', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('parse error')),
      } as unknown as Response)

      const { analyzePdfApi } = await import('@/lib/pdf')
      await expect(analyzePdfApi('upload-001', 'token-123')).rejects.toThrow(
        'PDF 분석에 실패했습니다.'
      )
    })
  })

  describe('queryPdfStreamApi', () => {
    it('POST /api/v1/pdf/{uploadId}/query를 SSE로 호출한다', async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: 안녕하세요\n\ndata: [DONE]\n\n'))
          controller.close()
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as unknown as Response)

      const { queryPdfStreamApi } = await import('@/lib/pdf')
      const chunks: string[] = []
      for await (const chunk of queryPdfStreamApi('upload-001', '질문입니다', 'token-123')) {
        chunks.push(chunk)
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/pdf/upload-001/query',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ question: '질문입니다' }),
        })
      )
      expect(chunks).toContain('안녕하세요')
    })

    it('SSE 데이터 청크를 순서대로 yield한다', async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: 첫번째\n\ndata: 두번째\n\ndata: [DONE]\n\n'))
          controller.close()
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as unknown as Response)

      const { queryPdfStreamApi } = await import('@/lib/pdf')
      const chunks: string[] = []
      for await (const chunk of queryPdfStreamApi('upload-001', '질문', 'token-123')) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual(['첫번째', '두번째'])
    })

    it('[DONE]은 yield하지 않는다', async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: 내용\n\ndata: [DONE]\n\n'))
          controller.close()
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      } as unknown as Response)

      const { queryPdfStreamApi } = await import('@/lib/pdf')
      const chunks: string[] = []
      for await (const chunk of queryPdfStreamApi('upload-001', '질문', 'token-123')) {
        chunks.push(chunk)
      }

      expect(chunks).not.toContain('[DONE]')
    })

    it('요청 실패 시 에러를 던진다', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(400, { detail: '질문 처리에 실패했습니다.' })
      )

      const { queryPdfStreamApi } = await import('@/lib/pdf')
      const gen = queryPdfStreamApi('upload-001', '질문', 'token-123')
      await expect(gen.next()).rejects.toThrow('질문 처리에 실패했습니다.')
    })

    it('body가 null이면 에러를 던진다', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response)

      const { queryPdfStreamApi } = await import('@/lib/pdf')
      const gen = queryPdfStreamApi('upload-001', '질문', 'token-123')
      await expect(gen.next()).rejects.toThrow('스트림 응답을 받지 못했습니다.')
    })
  })

  describe('listSessionsApi', () => {
    it('GET /api/v1/pdf/sessions를 호출한다', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse([dummySession]))

      const { listSessionsApi } = await import('@/lib/pdf')
      await listSessionsApi('token-123')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/pdf/sessions',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        })
      )
    })

    it('Session 배열을 반환한다', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse([dummySession]))

      const { listSessionsApi } = await import('@/lib/pdf')
      const result = await listSessionsApi('token-123')

      expect(result).toEqual([dummySession])
    })

    it('실패 시 에러를 던진다', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(500, { detail: '세션 목록을 불러오지 못했습니다.' })
      )

      const { listSessionsApi } = await import('@/lib/pdf')
      await expect(listSessionsApi('token-123')).rejects.toThrow(
        '세션 목록을 불러오지 못했습니다.'
      )
    })
  })

  describe('getSessionApi', () => {
    it('GET /api/v1/pdf/sessions/{sessionId}를 호출한다', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummySessionDetail))

      const { getSessionApi } = await import('@/lib/pdf')
      await getSessionApi('session-001', 'token-123')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/pdf/sessions/session-001',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        })
      )
    })

    it('SessionDetail 객체를 반환한다', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(dummySessionDetail))

      const { getSessionApi } = await import('@/lib/pdf')
      const result = await getSessionApi('session-001', 'token-123')

      expect(result).toEqual(dummySessionDetail)
      expect(result.messages).toHaveLength(2)
    })

    it('존재하지 않는 세션 조회 시 에러를 던진다', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(404, { detail: '세션을 불러오지 못했습니다.' })
      )

      const { getSessionApi } = await import('@/lib/pdf')
      await expect(getSessionApi('nonexistent', 'token-123')).rejects.toThrow(
        '세션을 불러오지 못했습니다.'
      )
    })
  })

  describe('deleteSessionApi', () => {
    it('DELETE /api/v1/pdf/sessions/{sessionId}를 호출한다', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(null, 204))

      const { deleteSessionApi } = await import('@/lib/pdf')
      await deleteSessionApi('session-001', 'token-123')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/pdf/sessions/session-001',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        })
      )
    })

    it('void를 반환한다', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(null, 204))

      const { deleteSessionApi } = await import('@/lib/pdf')
      const result = await deleteSessionApi('session-001', 'token-123')

      expect(result).toBeUndefined()
    })

    it('삭제 실패 시 에러를 던진다', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(500, { detail: '세션 삭제에 실패했습니다.' })
      )

      const { deleteSessionApi } = await import('@/lib/pdf')
      await expect(deleteSessionApi('session-001', 'token-123')).rejects.toThrow(
        '세션 삭제에 실패했습니다.'
      )
    })
  })
})
