import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SessionList from '@/components/chat/SessionList'
import type { ChatSessionListItem } from '@/lib/types/chat'

// 테스트용 세션 목록
const mockSessions: ChatSessionListItem[] = [
  {
    id: 'session-1',
    title: '실손보험 문의',
    user_id: 'user-1',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    message_count: 5,
  },
  {
    id: 'session-2',
    title: '암 진단비 질문',
    user_id: 'user-1',
    created_at: '2024-01-14T09:00:00Z',
    updated_at: '2024-01-14T09:20:00Z',
    message_count: 3,
  },
  {
    id: 'session-3',
    title: '교통사고 보상',
    user_id: 'user-1',
    created_at: '2024-01-13T08:00:00Z',
    updated_at: '2024-01-13T08:10:00Z',
    message_count: 2,
  },
]

describe('SessionList', () => {
  describe('기본 렌더링', () => {
    it('세션 목록을 렌더링한다', () => {
      render(
        <SessionList
          sessions={mockSessions}
          currentSessionId={null}
          onSelectSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onNewSession={vi.fn()}
        />
      )
      expect(screen.getByText('실손보험 문의')).toBeInTheDocument()
      expect(screen.getByText('암 진단비 질문')).toBeInTheDocument()
      expect(screen.getByText('교통사고 보상')).toBeInTheDocument()
    })

    it('"새 대화" 버튼을 렌더링한다', () => {
      render(
        <SessionList
          sessions={mockSessions}
          currentSessionId={null}
          onSelectSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onNewSession={vi.fn()}
        />
      )
      expect(screen.getByText('새 대화')).toBeInTheDocument()
    })

    it('세션이 없을 때 빈 목록을 렌더링한다', () => {
      render(
        <SessionList
          sessions={[]}
          currentSessionId={null}
          onSelectSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onNewSession={vi.fn()}
        />
      )
      expect(screen.getByText('새 대화')).toBeInTheDocument()
      expect(screen.queryByText('실손보험 문의')).not.toBeInTheDocument()
    })
  })

  describe('세션 선택', () => {
    it('세션 클릭 시 onSelectSession을 호출한다', () => {
      const onSelectSession = vi.fn()
      render(
        <SessionList
          sessions={mockSessions}
          currentSessionId={null}
          onSelectSession={onSelectSession}
          onDeleteSession={vi.fn()}
          onNewSession={vi.fn()}
        />
      )
      fireEvent.click(screen.getByText('실손보험 문의'))
      expect(onSelectSession).toHaveBeenCalledWith('session-1')
    })

    it('현재 선택된 세션은 하이라이트 배경을 가진다', () => {
      render(
        <SessionList
          sessions={mockSessions}
          currentSessionId="session-1"
          onSelectSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onNewSession={vi.fn()}
        />
      )
      const sessionItem = screen.getByText('실손보험 문의').closest('button') ??
        screen.getByText('실손보험 문의').closest('[data-testid="session-item"]')
      expect(sessionItem?.className).toContain('bg-[#0D6E6E]/10')
    })
  })

  describe('세션 삭제', () => {
    beforeEach(() => {
      // window.confirm을 모킹
      vi.spyOn(window, 'confirm').mockReturnValue(true)
    })

    it('삭제 확인 시 onDeleteSession을 호출한다', () => {
      const onDeleteSession = vi.fn()
      render(
        <SessionList
          sessions={mockSessions}
          currentSessionId={null}
          onSelectSession={vi.fn()}
          onDeleteSession={onDeleteSession}
          onNewSession={vi.fn()}
        />
      )
      // 삭제 버튼 클릭 (data-testid 사용)
      const deleteButtons = screen.getAllByRole('button', { name: /삭제/ })
      fireEvent.click(deleteButtons[0]!)
      expect(window.confirm).toHaveBeenCalledWith('이 대화를 삭제하시겠습니까?')
      expect(onDeleteSession).toHaveBeenCalledWith('session-1')
    })

    it('삭제 취소 시 onDeleteSession을 호출하지 않는다', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const onDeleteSession = vi.fn()
      render(
        <SessionList
          sessions={mockSessions}
          currentSessionId={null}
          onSelectSession={vi.fn()}
          onDeleteSession={onDeleteSession}
          onNewSession={vi.fn()}
        />
      )
      const deleteButtons = screen.getAllByRole('button', { name: /삭제/ })
      fireEvent.click(deleteButtons[0]!)
      expect(onDeleteSession).not.toHaveBeenCalled()
    })
  })

  describe('"새 대화" 버튼', () => {
    it('"새 대화" 클릭 시 onNewSession을 호출한다', () => {
      const onNewSession = vi.fn()
      render(
        <SessionList
          sessions={mockSessions}
          currentSessionId={null}
          onSelectSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onNewSession={onNewSession}
        />
      )
      fireEvent.click(screen.getByText('새 대화'))
      expect(onNewSession).toHaveBeenCalled()
    })
  })
})
