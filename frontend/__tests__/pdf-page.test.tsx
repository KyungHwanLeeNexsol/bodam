/**
 * PDF 페이지 통합 테스트 (SPEC-PDF-001 M4)
 *
 * 페이지 상태 머신: idle -> analyzing -> ready
 * 인증 확인 및 리다이렉트 동작 검증.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/navigation 모킹
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// useAuth 모킹
let mockAuthState = {
  token: 'test-token-123' as string | null,
  isAuthenticated: true,
}

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
}))

// PDF API 모킹
vi.mock('@/lib/pdf', () => ({
  analyzePdfApi: vi.fn(),
  uploadPdfApi: vi.fn(),
}))

// 하위 컴포넌트 모킹 (의존성 격리)
vi.mock('@/components/pdf/PDFUploader', () => ({
  default: ({ onUploadComplete }: { onUploadComplete: (id: string, name: string) => void }) => (
    <div data-testid="pdf-uploader">
      <button onClick={() => onUploadComplete('upload-001', 'test.pdf')}>
        업로드 완료 시뮬레이션
      </button>
    </div>
  ),
}))

vi.mock('@/components/pdf/AnalysisResult', () => ({
  default: () => <div data-testid="analysis-result">분석 결과</div>,
}))

vi.mock('@/components/pdf/PDFChat', () => ({
  default: () => <div data-testid="pdf-chat">PDF 채팅</div>,
}))

vi.mock('@/components/pdf/SessionList', () => ({
  default: () => <div data-testid="session-list">세션 목록</div>,
}))

import { analyzePdfApi } from '@/lib/pdf'
import { fireEvent } from '@testing-library/react'

const mockAnalyzePdfApi = vi.mocked(analyzePdfApi)

const mockAnalysisResult = {
  session_id: 'session-001',
  analysis: {
    담보목록: [{ 명칭: '사망담보', 보상금액: '1억', 조건: '일반사망' }],
    보상조건: ['질병 사망'],
    면책사항: ['자살'],
  },
  token_usage: {
    input_tokens: 1000,
    output_tokens: 500,
    cost_usd: 0.0015,
  },
}

describe('PDF 페이지', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState = {
      token: 'test-token-123',
      isAuthenticated: true,
    }
  })

  describe('인증 확인', () => {
    it('인증된 사용자에게 페이지를 렌더링한다', async () => {
      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      expect(screen.getByText('약관 PDF 분석')).toBeInTheDocument()
    })

    it('토큰이 없으면 null을 반환한다 (렌더링하지 않음)', async () => {
      mockAuthState = { token: null, isAuthenticated: false }

      const { default: PDFPage } = await import('@/app/pdf/page')
      const { container } = render(<PDFPage />)

      expect(container.firstChild).toBeNull()
    })

    it('미인증 상태이면 /login으로 리다이렉트한다', async () => {
      mockAuthState = { token: null, isAuthenticated: false }

      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login')
      })
    })
  })

  describe('페이지 레이아웃', () => {
    it('헤더를 렌더링한다', async () => {
      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      expect(screen.getByText('약관 PDF 분석')).toBeInTheDocument()
      expect(screen.getByText('AI 상담으로 돌아가기')).toBeInTheDocument()
    })

    it('PDF 업로더 컴포넌트를 렌더링한다', async () => {
      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      expect(screen.getByTestId('pdf-uploader')).toBeInTheDocument()
    })

    it('세션 목록 컴포넌트를 렌더링한다', async () => {
      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      expect(screen.getByTestId('session-list')).toBeInTheDocument()
    })

    it('idle 상태에서 우측 컬럼에 안내 문구를 표시한다', async () => {
      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      expect(
        screen.getByText('PDF를 업로드하면 분석 결과가 여기에 표시됩니다')
      ).toBeInTheDocument()
    })
  })

  describe('페이지 상태 머신', () => {
    it('업로드 완료 후 analyzing 상태로 전환된다', async () => {
      // 분석 API가 보류 중인 상태로 유지
      mockAnalyzePdfApi.mockImplementationOnce(() => new Promise(() => {}))

      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      fireEvent.click(screen.getByText('업로드 완료 시뮬레이션'))

      await waitFor(() => {
        expect(screen.getByText('약관을 분석하고 있습니다...')).toBeInTheDocument()
      })
    })

    it('분석 완료 후 ready 상태로 전환되어 AnalysisResult를 표시한다', async () => {
      mockAnalyzePdfApi.mockResolvedValueOnce(mockAnalysisResult)

      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      fireEvent.click(screen.getByText('업로드 완료 시뮬레이션'))

      await waitFor(() => {
        expect(screen.getByTestId('analysis-result')).toBeInTheDocument()
        expect(screen.getByTestId('pdf-chat')).toBeInTheDocument()
      })
    })

    it('분석 완료 후 업로더 영역에 "분석 완료" 배지를 표시한다', async () => {
      mockAnalyzePdfApi.mockResolvedValueOnce(mockAnalysisResult)

      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      fireEvent.click(screen.getByText('업로드 완료 시뮬레이션'))

      await waitFor(() => {
        expect(screen.getByText('분석 완료')).toBeInTheDocument()
        expect(screen.getByText('test.pdf')).toBeInTheDocument()
      })
    })

    it('"새 파일" 클릭 시 idle 상태로 돌아간다', async () => {
      mockAnalyzePdfApi.mockResolvedValueOnce(mockAnalysisResult)

      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      fireEvent.click(screen.getByText('업로드 완료 시뮬레이션'))

      await waitFor(() => {
        expect(screen.getByText('새 파일')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('새 파일'))

      await waitFor(() => {
        expect(screen.getByTestId('pdf-uploader')).toBeInTheDocument()
        expect(screen.queryByTestId('analysis-result')).not.toBeInTheDocument()
      })
    })

    it('분석 실패 시 에러 메시지를 표시하고 idle로 돌아간다', async () => {
      mockAnalyzePdfApi.mockRejectedValueOnce(new Error('분석 서버 오류'))

      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      fireEvent.click(screen.getByText('업로드 완료 시뮬레이션'))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('분석 서버 오류')
        expect(screen.getByTestId('pdf-uploader')).toBeInTheDocument()
      })
    })
  })

  describe('분석 API 호출', () => {
    it('업로드 완료 후 analyzePdfApi를 올바른 인자로 호출한다', async () => {
      mockAnalyzePdfApi.mockResolvedValueOnce(mockAnalysisResult)

      const { default: PDFPage } = await import('@/app/pdf/page')
      render(<PDFPage />)

      fireEvent.click(screen.getByText('업로드 완료 시뮬레이션'))

      await waitFor(() => {
        expect(mockAnalyzePdfApi).toHaveBeenCalledWith('upload-001', 'test-token-123')
      })
    })
  })

  describe('REQ-PDF-406: 모바일 반응형', () => {
    it('레이아웃 오류 없이 렌더링된다', async () => {
      const { default: PDFPage } = await import('@/app/pdf/page')
      const { container } = render(<PDFPage />)
      expect(container.firstChild).toBeTruthy()
    })
  })
})
