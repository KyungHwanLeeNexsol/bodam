/**
 * PDFChat 컴포넌트 단위 테스트 (SPEC-PDF-001 M4)
 *
 * REQ-PDF-404: PDF 분석 후 Q&A 채팅 인터페이스
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PDFChat from '@/components/pdf/PDFChat'

// queryPdfStreamApi 모킹
vi.mock('@/lib/pdf', () => ({
  queryPdfStreamApi: vi.fn(),
}))

import { queryPdfStreamApi } from '@/lib/pdf'

const mockQueryPdfStreamApi = vi.mocked(queryPdfStreamApi)

// AsyncGenerator를 반환하는 헬퍼
async function* makeStream(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk
  }
}

// 빈 스트림
async function* emptyStream(): AsyncGenerator<string> {}

describe('PDFChat', () => {
  const defaultProps = {
    uploadId: 'upload-001',
    sessionId: 'session-001',
    token: 'test-token-123',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('기본 렌더링', () => {
    it('"약관 내용 질문하기" 제목을 표시한다', () => {
      render(<PDFChat {...defaultProps} />)
      expect(screen.getByText('약관 내용 질문하기')).toBeInTheDocument()
    })

    it('질문 입력 텍스트에어리어를 렌더링한다', () => {
      render(<PDFChat {...defaultProps} />)
      expect(screen.getByLabelText('질문 입력')).toBeInTheDocument()
    })

    it('"전송" 버튼을 렌더링한다', () => {
      render(<PDFChat {...defaultProps} />)
      expect(screen.getByLabelText('전송')).toBeInTheDocument()
    })

    it('메시지가 없을 때 안내 문구를 표시한다', () => {
      render(<PDFChat {...defaultProps} />)
      expect(
        screen.getByText('약관 내용에 대해 궁금한 점을 질문해보세요.')
      ).toBeInTheDocument()
    })

    it('초기 메시지가 있으면 표시한다', () => {
      const initialMessages = [
        { role: 'user' as const, content: '담보 내용이 궁금해요' },
        { role: 'assistant' as const, content: '사망담보가 있습니다.' },
      ]
      render(<PDFChat {...defaultProps} initialMessages={initialMessages} />)
      expect(screen.getByText('담보 내용이 궁금해요')).toBeInTheDocument()
      expect(screen.getByText('사망담보가 있습니다.')).toBeInTheDocument()
    })
  })

  describe('REQ-PDF-404: 메시지 전송', () => {
    it('전송 버튼 클릭 시 queryPdfStreamApi를 호출한다', async () => {
      mockQueryPdfStreamApi.mockReturnValueOnce(makeStream(['응답입니다.']))

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '보장 내용이 궁금합니다' } })

      const sendButton = screen.getByLabelText('전송')
      fireEvent.click(sendButton)

      await waitFor(() => {
        expect(mockQueryPdfStreamApi).toHaveBeenCalledWith(
          'upload-001',
          '보장 내용이 궁금합니다',
          'test-token-123'
        )
      })
    })

    it('Enter 키로 메시지를 전송한다', async () => {
      mockQueryPdfStreamApi.mockReturnValueOnce(makeStream(['응답']))

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '질문입니다' } })
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

      await waitFor(() => {
        expect(mockQueryPdfStreamApi).toHaveBeenCalledTimes(1)
      })
    })

    it('Shift+Enter는 메시지를 전송하지 않는다', async () => {
      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '질문입니다' } })
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

      expect(mockQueryPdfStreamApi).not.toHaveBeenCalled()
    })

    it('입력이 비어있으면 전송하지 않는다', async () => {
      render(<PDFChat {...defaultProps} />)

      const sendButton = screen.getByLabelText('전송')
      fireEvent.click(sendButton)

      expect(mockQueryPdfStreamApi).not.toHaveBeenCalled()
    })

    it('공백만 있는 입력은 전송하지 않는다', async () => {
      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '   ' } })

      const sendButton = screen.getByLabelText('전송')
      fireEvent.click(sendButton)

      expect(mockQueryPdfStreamApi).not.toHaveBeenCalled()
    })
  })

  describe('메시지 표시', () => {
    it('사용자 메시지를 전송 후 채팅창에 표시한다', async () => {
      mockQueryPdfStreamApi.mockReturnValueOnce(emptyStream())

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '담보 알려주세요' } })
      fireEvent.click(screen.getByLabelText('전송'))

      await waitFor(() => {
        expect(screen.getByText('담보 알려주세요')).toBeInTheDocument()
      })
    })

    it('스트리밍 응답을 받아 어시스턴트 메시지로 표시한다', async () => {
      mockQueryPdfStreamApi.mockReturnValueOnce(makeStream(['담보목록에는', ' 사망담보가 있습니다.']))

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '담보 알려주세요' } })
      fireEvent.click(screen.getByLabelText('전송'))

      await waitFor(() => {
        expect(screen.getByText('담보목록에는 사망담보가 있습니다.')).toBeInTheDocument()
      })
    })

    it('전송 후 입력 필드가 초기화된다', async () => {
      mockQueryPdfStreamApi.mockReturnValueOnce(emptyStream())

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '질문입니다' } })
      fireEvent.click(screen.getByLabelText('전송'))

      await waitFor(() => {
        expect(textarea).toHaveValue('')
      })
    })
  })

  describe('스트리밍 상태', () => {
    it('스트리밍 중 "분석 중" 인디케이터를 표시한다', async () => {
      let resolveStream: () => void
      const streamPromise = new Promise<void>((resolve) => {
        resolveStream = resolve
      })

      async function* slowStream(): AsyncGenerator<string> {
        await streamPromise
        yield '응답'
      }

      mockQueryPdfStreamApi.mockReturnValueOnce(slowStream())

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '질문' } })
      fireEvent.click(screen.getByLabelText('전송'))

      await waitFor(() => {
        expect(screen.getByLabelText('분석 중')).toBeInTheDocument()
      })

      resolveStream!()
    })

    it('스트리밍 중 입력 필드가 비활성화된다', async () => {
      let resolveStream: () => void
      const streamPromise = new Promise<void>((resolve) => {
        resolveStream = resolve
      })

      async function* slowStream(): AsyncGenerator<string> {
        await streamPromise
        yield '응답'
      }

      mockQueryPdfStreamApi.mockReturnValueOnce(slowStream())

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '질문' } })
      fireEvent.click(screen.getByLabelText('전송'))

      await waitFor(() => {
        expect(screen.getByLabelText('질문 입력')).toBeDisabled()
      })

      resolveStream!()
    })

    it('스트리밍 중 전송 버튼이 비활성화된다', async () => {
      let resolveStream: () => void
      const streamPromise = new Promise<void>((resolve) => {
        resolveStream = resolve
      })

      async function* slowStream(): AsyncGenerator<string> {
        await streamPromise
        yield '응답'
      }

      mockQueryPdfStreamApi.mockReturnValueOnce(slowStream())

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '질문' } })
      fireEvent.click(screen.getByLabelText('전송'))

      await waitFor(() => {
        expect(screen.getByLabelText('전송')).toBeDisabled()
      })

      resolveStream!()
    })
  })

  describe('에러 처리', () => {
    it('API 오류 시 에러 메시지를 표시한다', async () => {
      mockQueryPdfStreamApi.mockImplementationOnce(async function* () {
        throw new Error('질문 처리에 실패했습니다.')
      })

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '질문입니다' } })
      fireEvent.click(screen.getByLabelText('전송'))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent('질문 처리에 실패했습니다.')
      })
    })

    it('에러 후 입력 필드가 다시 활성화된다', async () => {
      mockQueryPdfStreamApi.mockImplementationOnce(async function* () {
        throw new Error('오류')
      })

      render(<PDFChat {...defaultProps} />)

      const textarea = screen.getByLabelText('질문 입력')
      fireEvent.change(textarea, { target: { value: '질문' } })
      fireEvent.click(screen.getByLabelText('전송'))

      await waitFor(() => {
        expect(textarea).not.toBeDisabled()
      })
    })
  })

  describe('REQ-PDF-406: 모바일 반응형', () => {
    it('레이아웃 오류 없이 렌더링된다', () => {
      const { container } = render(<PDFChat {...defaultProps} />)
      expect(container.firstChild).toBeTruthy()
    })
  })
})
