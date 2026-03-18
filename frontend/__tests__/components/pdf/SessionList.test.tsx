/**
 * PDF SessionList 컴포넌트 단위 테스트 (SPEC-PDF-001 M4)
 *
 * 세션 목록 표시, 세션 선택, 세션 삭제(인라인 확인 UI) 검증.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SessionList from '@/components/pdf/SessionList'
import type { Session } from '@/lib/pdf'

// listSessionsApi, deleteSessionApi 모킹
vi.mock('@/lib/pdf', () => ({
  listSessionsApi: vi.fn(),
  deleteSessionApi: vi.fn(),
}))

import { listSessionsApi, deleteSessionApi } from '@/lib/pdf'

const mockListSessionsApi = vi.mocked(listSessionsApi)
const mockDeleteSessionApi = vi.mocked(deleteSessionApi)

// 테스트용 세션 목록
const mockSessions: Session[] = [
  {
    id: 'session-001',
    title: '삼성화재 실손보험 분석',
    status: 'active',
    created_at: '2024-01-15T10:30:00Z',
  },
  {
    id: 'session-002',
    title: '현대해상 암보험 분석',
    status: 'expired',
    created_at: '2024-01-10T14:20:00Z',
  },
]

describe('PDF SessionList', () => {
  const defaultProps = {
    token: 'test-token-123',
    onSelectSession: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('로딩 상태', () => {
    it('세션을 불러오는 동안 스켈레톤 UI를 표시한다', () => {
      // listSessionsApi가 pending 상태
      mockListSessionsApi.mockImplementationOnce(() => new Promise(() => {}))

      const { container } = render(<SessionList {...defaultProps} />)
      // 스켈레톤 div들이 animate-pulse 클래스를 가져야 함
      const skeletons = container.querySelectorAll('.animate-pulse')
      expect(skeletons.length).toBeGreaterThan(0)
    })
  })

  describe('세션 목록 표시', () => {
    it('세션 목록을 렌더링한다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('삼성화재 실손보험 분석')).toBeInTheDocument()
        expect(screen.getByText('현대해상 암보험 분석')).toBeInTheDocument()
      })
    })

    it('세션이 없으면 빈 상태 메시지를 표시한다', async () => {
      mockListSessionsApi.mockResolvedValueOnce([])

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('분석한 약관이 없습니다')).toBeInTheDocument()
        expect(screen.getByText('PDF를 업로드하여 약관을 분석해보세요')).toBeInTheDocument()
      })
    })

    it('"이전 분석 세션" 헤더를 표시한다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('이전 분석 세션')).toBeInTheDocument()
      })
    })

    it('세션 상태 배지를 표시한다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('활성')).toBeInTheDocument()
        expect(screen.getByText('만료')).toBeInTheDocument()
      })
    })

    it('세션 생성 날짜를 표시한다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        // 날짜 형식 확인 (한국어 날짜 포맷) - getAllByText로 여러 날짜 허용
        const dateElements = screen.getAllByText(/2024/)
        expect(dateElements.length).toBeGreaterThan(0)
      })
    })

    it('알 수 없는 상태는 기본 "활성" 배지를 사용한다', async () => {
      const sessionsWithUnknownStatus: Session[] = [
        { ...mockSessions[0]!, status: 'unknown_status' },
      ]
      mockListSessionsApi.mockResolvedValueOnce(sessionsWithUnknownStatus)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('활성')).toBeInTheDocument()
      })
    })
  })

  describe('세션 선택', () => {
    it('세션 클릭 시 onSelectSession을 호출한다', async () => {
      const onSelectSession = vi.fn()
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)

      render(<SessionList token="test-token" onSelectSession={onSelectSession} />)

      await waitFor(() => {
        expect(screen.getByText('삼성화재 실손보험 분석')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('세션 선택: 삼성화재 실손보험 분석'))
      expect(onSelectSession).toHaveBeenCalledWith('session-001')
    })
  })

  describe('세션 삭제 - 인라인 확인 UI', () => {
    it('삭제 버튼 클릭 시 인라인 확인 UI가 표시된다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('삼성화재 실손보험 분석')).toBeInTheDocument()
      })

      const deleteButton = screen.getByLabelText('세션 삭제: 삼성화재 실손보험 분석')
      fireEvent.click(deleteButton)

      expect(screen.getByText('삭제하시겠습니까?')).toBeInTheDocument()
      expect(screen.getByText('삭제')).toBeInTheDocument()
      expect(screen.getByText('취소')).toBeInTheDocument()
    })

    it('확인 "삭제" 클릭 시 deleteSessionApi를 호출한다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)
      mockDeleteSessionApi.mockResolvedValueOnce(undefined)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('삼성화재 실손보험 분석')).toBeInTheDocument()
      })

      // 삭제 버튼 클릭
      const deleteButton = screen.getByLabelText('세션 삭제: 삼성화재 실손보험 분석')
      fireEvent.click(deleteButton)

      // 확인 삭제 클릭
      fireEvent.click(screen.getByText('삭제'))

      await waitFor(() => {
        expect(mockDeleteSessionApi).toHaveBeenCalledWith('session-001', 'test-token-123')
      })
    })

    it('삭제 성공 후 목록에서 해당 세션이 제거된다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)
      mockDeleteSessionApi.mockResolvedValueOnce(undefined)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('삼성화재 실손보험 분석')).toBeInTheDocument()
      })

      const deleteButton = screen.getByLabelText('세션 삭제: 삼성화재 실손보험 분석')
      fireEvent.click(deleteButton)
      fireEvent.click(screen.getByText('삭제'))

      await waitFor(() => {
        expect(screen.queryByText('삼성화재 실손보험 분석')).not.toBeInTheDocument()
      })
    })

    it('"취소" 클릭 시 인라인 확인 UI가 닫힌다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('삼성화재 실손보험 분석')).toBeInTheDocument()
      })

      const deleteButton = screen.getByLabelText('세션 삭제: 삼성화재 실손보험 분석')
      fireEvent.click(deleteButton)

      expect(screen.getByText('삭제하시겠습니까?')).toBeInTheDocument()

      fireEvent.click(screen.getByText('취소'))

      expect(screen.queryByText('삭제하시겠습니까?')).not.toBeInTheDocument()
      expect(mockDeleteSessionApi).not.toHaveBeenCalled()
    })

    it('삭제 실패 시 에러 메시지를 표시한다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)
      mockDeleteSessionApi.mockRejectedValueOnce(new Error('세션 삭제에 실패했습니다.'))

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('삼성화재 실손보험 분석')).toBeInTheDocument()
      })

      const deleteButton = screen.getByLabelText('세션 삭제: 삼성화재 실손보험 분석')
      fireEvent.click(deleteButton)
      fireEvent.click(screen.getByText('삭제'))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('세션 삭제에 실패했습니다.')
      })
    })
  })

  describe('에러 처리', () => {
    it('세션 목록 로드 실패 시 에러 메시지를 표시한다', async () => {
      mockListSessionsApi.mockRejectedValueOnce(new Error('세션 목록을 불러오지 못했습니다.'))

      render(<SessionList {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('세션 목록을 불러오지 못했습니다.')
      })
    })
  })

  describe('REQ-PDF-406: 모바일 반응형', () => {
    it('레이아웃 오류 없이 렌더링된다', async () => {
      mockListSessionsApi.mockResolvedValueOnce(mockSessions)

      const { container } = render(<SessionList {...defaultProps} />)
      expect(container.firstChild).toBeTruthy()
    })
  })
})
