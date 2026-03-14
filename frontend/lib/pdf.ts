/**
 * PDF API 클라이언트 유틸리티 (SPEC-PDF-001)
 *
 * PDF 업로드, 분석, 쿼리, 세션 관리 API와 통신하는 함수 모음.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ──────────────────────────────────────────────
// 타입 정의
// ──────────────────────────────────────────────

export interface PdfUpload {
  id: string
  filename: string
  file_size: number
  status: string
}

export interface Coverage {
  명칭: string
  보상금액: string
  조건: string
}

export interface CoverageAnalysis {
  담보목록: Coverage[]
  보상조건: string[]
  면책사항: string[]
  보상한도?: string
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface PdfAnalysis {
  session_id: string
  analysis: CoverageAnalysis
  token_usage: TokenUsage
}

export interface Session {
  id: string
  title: string
  status: string
  created_at: string
}

export interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SessionDetail extends Session {
  upload_id?: string
  initial_analysis?: CoverageAnalysis
  messages: SessionMessage[]
}

// ──────────────────────────────────────────────
// API 함수
// ──────────────────────────────────────────────

/**
 * PDF 파일 업로드 (XMLHttpRequest 기반 - 진행률 지원)
 *
 * @param file - 업로드할 PDF 파일
 * @param token - JWT 인증 토큰
 * @param onProgress - 진행률 콜백 (0~100)
 * @returns 업로드된 PDF 정보
 */
export function uploadPdfApi(
  file: File,
  token: string,
  onProgress?: (percent: number) => void
): Promise<PdfUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100)
        onProgress(percent)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as PdfUpload)
        } catch {
          reject(new Error('서버 응답을 처리하지 못했습니다.'))
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText) as { detail?: string }
          reject(new Error(err.detail ?? 'PDF 업로드에 실패했습니다.'))
        } catch {
          reject(new Error('PDF 업로드에 실패했습니다.'))
        }
      }
    }

    xhr.onerror = () => reject(new Error('네트워크 오류가 발생했습니다.'))
    xhr.ontimeout = () => reject(new Error('업로드 시간이 초과되었습니다.'))

    xhr.open('POST', `${API_BASE}/api/v1/pdf/upload`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.send(formData)
  })
}

/**
 * PDF 분석 요청
 *
 * @param uploadId - 업로드된 PDF ID
 * @param token - JWT 인증 토큰
 * @returns 분석 결과 (담보목록, 보상조건, 면책사항)
 */
export async function analyzePdfApi(uploadId: string, token: string): Promise<PdfAnalysis> {
  const response = await fetch(`${API_BASE}/api/v1/pdf/${uploadId}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'PDF 분석에 실패했습니다.' })) as { detail?: string }
    throw new Error(error.detail ?? 'PDF 분석에 실패했습니다.')
  }

  return response.json() as Promise<PdfAnalysis>
}

/**
 * PDF에 대한 질문 스트리밍 (SSE)
 *
 * @param uploadId - 업로드된 PDF ID
 * @param question - 질문 내용
 * @param token - JWT 인증 토큰
 * @yields SSE 스트림에서 수신된 텍스트 청크
 */
export async function* queryPdfStreamApi(
  uploadId: string,
  question: string,
  token: string
): AsyncGenerator<string> {
  const response = await fetch(`${API_BASE}/api/v1/pdf/${uploadId}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ question }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '질문 처리에 실패했습니다.' })) as { detail?: string }
    throw new Error(error.detail ?? '질문 처리에 실패했습니다.')
  }

  if (!response.body) {
    throw new Error('스트림 응답을 받지 못했습니다.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data && data !== '[DONE]') {
            yield data
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 세션 목록 조회
 *
 * @param token - JWT 인증 토큰
 * @returns 세션 목록
 */
export async function listSessionsApi(token: string): Promise<Session[]> {
  const response = await fetch(`${API_BASE}/api/v1/pdf/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '세션 목록을 불러오지 못했습니다.' })) as { detail?: string }
    throw new Error(error.detail ?? '세션 목록을 불러오지 못했습니다.')
  }

  return response.json() as Promise<Session[]>
}

/**
 * 세션 상세 조회
 *
 * @param sessionId - 세션 ID
 * @param token - JWT 인증 토큰
 * @returns 세션 상세 정보 및 메시지 히스토리
 */
export async function getSessionApi(sessionId: string, token: string): Promise<SessionDetail> {
  const response = await fetch(`${API_BASE}/api/v1/pdf/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '세션을 불러오지 못했습니다.' })) as { detail?: string }
    throw new Error(error.detail ?? '세션을 불러오지 못했습니다.')
  }

  return response.json() as Promise<SessionDetail>
}

/**
 * 세션 삭제
 *
 * @param sessionId - 세션 ID
 * @param token - JWT 인증 토큰
 */
export async function deleteSessionApi(sessionId: string, token: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/pdf/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '세션 삭제에 실패했습니다.' })) as { detail?: string }
    throw new Error(error.detail ?? '세션 삭제에 실패했습니다.')
  }
}
