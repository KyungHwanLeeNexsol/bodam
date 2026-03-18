/**
 * PDFUploader 컴포넌트 단위 테스트 (SPEC-PDF-001 M4)
 *
 * REQ-PDF-401: 드래그 앤 드롭 + 파일 피커 업로드
 * REQ-PDF-402: 업로드 진행률 표시
 * REQ-PDF-405: 클라이언트 사이드 50MB 파일 크기 검증
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PDFUploader from '@/components/pdf/PDFUploader'

// uploadPdfApi 모킹
vi.mock('@/lib/pdf', () => ({
  uploadPdfApi: vi.fn(),
}))

import { uploadPdfApi } from '@/lib/pdf'

const mockUploadPdfApi = vi.mocked(uploadPdfApi)

// 테스트용 PDF 파일 생성 헬퍼
function createPdfFile(name = 'test.pdf', sizeBytes = 1024): File {
  const content = new Array(sizeBytes).fill('a').join('')
  return new File([content], name, { type: 'application/pdf' })
}

// 50MB를 초과하는 파일 생성
function createLargeFile(name = 'large.pdf'): File {
  const sizeBytes = 51 * 1024 * 1024 // 51MB
  return new File([new ArrayBuffer(sizeBytes)], name, { type: 'application/pdf' })
}

describe('PDFUploader', () => {
  const defaultProps = {
    token: 'test-token-123',
    onUploadComplete: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('기본 렌더링', () => {
    it('드래그 앤 드롭 영역을 렌더링한다', () => {
      render(<PDFUploader {...defaultProps} />)
      expect(
        screen.getByText('PDF 약관 파일을 여기에 드래그하거나 클릭하여 선택하세요')
      ).toBeInTheDocument()
    })

    it('최대 파일 크기 안내 문구를 표시한다', () => {
      render(<PDFUploader {...defaultProps} />)
      expect(screen.getByText('PDF 파일 최대 50MB')).toBeInTheDocument()
    })

    it('숨겨진 파일 입력 필드를 렌더링한다', () => {
      render(<PDFUploader {...defaultProps} />)
      const input = screen.getByLabelText('PDF 파일 선택')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'file')
      expect(input).toHaveAttribute('accept', 'application/pdf')
    })

    it('업로드 영역에 접근성 role이 있다', () => {
      render(<PDFUploader {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'PDF 파일 업로드 영역' })).toBeInTheDocument()
    })
  })

  describe('REQ-PDF-405: 파일 크기 검증 (50MB 제한)', () => {
    it('50MB 이하 PDF 파일은 업로드를 시작한다', async () => {
      mockUploadPdfApi.mockResolvedValueOnce({
        id: 'upload-001',
        filename: 'test.pdf',
        file_size: 1024,
        status: 'uploaded',
      })

      render(<PDFUploader {...defaultProps} />)

      const file = createPdfFile('test.pdf', 1024)
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockUploadPdfApi).toHaveBeenCalledTimes(1)
      })
    })

    it('50MB 초과 파일은 에러 메시지를 표시하고 업로드하지 않는다', async () => {
      render(<PDFUploader {...defaultProps} />)

      const largeFile = createLargeFile()
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [largeFile] } })

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent('50MB를 초과할 수 없습니다')
      })

      expect(mockUploadPdfApi).not.toHaveBeenCalled()
    })

    it('PDF가 아닌 파일은 에러 메시지를 표시한다', async () => {
      render(<PDFUploader {...defaultProps} />)

      const txtFile = new File(['content'], 'test.txt', { type: 'text/plain' })
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [txtFile] } })

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('PDF 파일만 업로드 가능합니다')
      })

      expect(mockUploadPdfApi).not.toHaveBeenCalled()
    })
  })

  describe('REQ-PDF-401: 파일 선택 업로드', () => {
    it('파일 입력 변경 시 업로드가 시작된다', async () => {
      mockUploadPdfApi.mockResolvedValueOnce({
        id: 'upload-001',
        filename: 'test.pdf',
        file_size: 1024,
        status: 'uploaded',
      })

      render(<PDFUploader {...defaultProps} />)

      const file = createPdfFile()
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockUploadPdfApi).toHaveBeenCalledWith(
          file,
          'test-token-123',
          expect.any(Function)
        )
      })
    })

    it('업로드 완료 후 onUploadComplete 콜백을 호출한다', async () => {
      const onUploadComplete = vi.fn()
      mockUploadPdfApi.mockResolvedValueOnce({
        id: 'upload-999',
        filename: 'result.pdf',
        file_size: 2048,
        status: 'uploaded',
      })

      render(<PDFUploader token="test-token" onUploadComplete={onUploadComplete} />)

      const file = createPdfFile('result.pdf')
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(onUploadComplete).toHaveBeenCalledWith('upload-999', 'result.pdf')
      })
    })

    it('업로드 실패 시 에러 메시지를 표시한다', async () => {
      mockUploadPdfApi.mockRejectedValueOnce(new Error('서버 오류가 발생했습니다.'))

      render(<PDFUploader {...defaultProps} />)

      const file = createPdfFile()
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('서버 오류가 발생했습니다.')
      })
    })
  })

  describe('REQ-PDF-401: 드래그 앤 드롭 업로드', () => {
    it('dragover 시 드래그 상태로 전환한다', () => {
      render(<PDFUploader {...defaultProps} />)

      const dropZone = screen.getByRole('button', { name: 'PDF 파일 업로드 영역' })
      fireEvent.dragOver(dropZone)

      // isDragging 상태 변화는 클래스 변화로 확인
      expect(dropZone.className).toContain('border-[#1A1A1A]')
    })

    it('dragleave 시 드래그 상태가 해제된다', () => {
      render(<PDFUploader {...defaultProps} />)

      const dropZone = screen.getByRole('button', { name: 'PDF 파일 업로드 영역' })
      fireEvent.dragOver(dropZone)
      fireEvent.dragLeave(dropZone)

      expect(dropZone.className).not.toContain('border-[#1A1A1A]')
    })

    it('drop 시 파일 업로드가 시작된다', async () => {
      mockUploadPdfApi.mockResolvedValueOnce({
        id: 'upload-001',
        filename: 'dropped.pdf',
        file_size: 1024,
        status: 'uploaded',
      })

      render(<PDFUploader {...defaultProps} />)

      const file = createPdfFile('dropped.pdf')
      const dropZone = screen.getByRole('button', { name: 'PDF 파일 업로드 영역' })

      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file] },
      })

      await waitFor(() => {
        expect(mockUploadPdfApi).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('REQ-PDF-402: 업로드 진행률 표시', () => {
    it('업로드 중 진행률 바를 표시한다', async () => {
      // uploadPdfApi가 진행률 콜백을 호출하고 나서 완료되는 mock
      mockUploadPdfApi.mockImplementationOnce(async (_file, _token, onProgress) => {
        onProgress?.(30)
        return { id: 'upload-001', filename: 'test.pdf', file_size: 1024, status: 'uploaded' }
      })

      render(<PDFUploader {...defaultProps} />)

      const file = createPdfFile()
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument()
      })
    })

    it('업로드 중 진행률 퍼센트 텍스트를 표시한다', async () => {
      let progressCallback: ((p: number) => void) | undefined
      mockUploadPdfApi.mockImplementationOnce((_file, _token, onProgress) => {
        progressCallback = onProgress
        return new Promise((resolve) =>
          setTimeout(() => resolve({ id: 'u1', filename: 'f.pdf', file_size: 1, status: 'ok' }), 100)
        )
      })

      render(<PDFUploader {...defaultProps} />)

      const file = createPdfFile()
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [file] } })

      // 진행률 콜백 수동 호출
      await waitFor(() => {
        progressCallback?.(75)
      })

      await waitFor(() => {
        expect(screen.getByText('75%')).toBeInTheDocument()
      })
    })

    it('업로드 완료 후 진행률 바가 사라진다', async () => {
      mockUploadPdfApi.mockResolvedValueOnce({
        id: 'upload-001',
        filename: 'test.pdf',
        file_size: 1024,
        status: 'uploaded',
      })

      render(<PDFUploader {...defaultProps} />)

      const file = createPdfFile()
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      })
    })
  })

  describe('선택된 파일 표시', () => {
    it('유효한 파일 선택 시 파일명을 표시한다', async () => {
      mockUploadPdfApi.mockImplementationOnce(() => new Promise(() => {})) // pending

      render(<PDFUploader {...defaultProps} />)

      const file = createPdfFile('my-document.pdf')
      const input = screen.getByLabelText('PDF 파일 선택')
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('my-document.pdf')).toBeInTheDocument()
      })
    })
  })

  describe('REQ-PDF-406: 모바일 반응형', () => {
    it('레이아웃 오류 없이 렌더링된다', () => {
      const { container } = render(<PDFUploader {...defaultProps} />)
      expect(container.firstChild).toBeTruthy()
    })
  })
})
