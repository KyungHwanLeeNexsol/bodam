import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MessageBubble from '@/components/chat/MessageBubble'
import type { ChatMessage } from '@/lib/types/chat'

// 테스트용 메시지 팩토리
const makeMessage = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 'msg-1',
  session_id: 'session-1',
  role: 'user',
  content: '테스트 메시지입니다.',
  metadata: null,
  created_at: new Date().toISOString(),
  ...overrides,
})

describe('MessageBubble', () => {
  describe('사용자 메시지', () => {
    it('사용자 메시지를 오른쪽 정렬로 렌더링한다', () => {
      const message = makeMessage({ role: 'user', content: '안녕하세요!' })
      const { container } = render(<MessageBubble message={message} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('justify-end')
    })

    it('사용자 메시지 배경색은 브랜드 블루 색상이다', () => {
      const message = makeMessage({ role: 'user', content: '안녕하세요!' })
      render(<MessageBubble message={message} />)
      const bubble = screen.getByText('안녕하세요!').closest('div')
      expect(bubble?.className).toContain('bg-[#2563EB]')
    })

    it('사용자 메시지 내용을 표시한다', () => {
      const message = makeMessage({ role: 'user', content: '인공관절 수술 보험 질문입니다.' })
      render(<MessageBubble message={message} />)
      expect(screen.getByText('인공관절 수술 보험 질문입니다.')).toBeInTheDocument()
    })
  })

  describe('어시스턴트 메시지', () => {
    it('어시스턴트 메시지에 AI 아바타를 표시한다', () => {
      const message = makeMessage({ role: 'assistant', content: '안녕하세요! 도움이 필요하신가요?' })
      const { container } = render(<MessageBubble message={message} />)
      // AI 아바타 (bg-[#4F46E5] 원형)
      const avatar = container.querySelector('.bg-\\[\\#4F46E5\\]')
      expect(avatar).toBeInTheDocument()
    })

    it('어시스턴트 메시지 배경색은 흰색이다', () => {
      const message = makeMessage({ role: 'assistant', content: '도움이 필요하신가요?' })
      render(<MessageBubble message={message} />)
      const bubble = screen.getByText('도움이 필요하신가요?').closest('div')
      expect(bubble?.className).toContain('bg-white')
    })

    it('어시스턴트 메시지 내용을 표시한다', () => {
      const message = makeMessage({ role: 'assistant', content: '보험 약관에 따르면...' })
      render(<MessageBubble message={message} />)
      expect(screen.getByText('보험 약관에 따르면...')).toBeInTheDocument()
    })

    it('출처(sources)가 있으면 SourcesCard를 렌더링한다', () => {
      const message = makeMessage({
        role: 'assistant',
        content: '보험 답변입니다.',
        metadata: {
          sources: [
            { policy_name: '실손의료비보험', company_name: '삼성생명', similarity_score: 0.95 },
          ],
        },
      })
      render(<MessageBubble message={message} />)
      expect(screen.getByText(/참고 약관/)).toBeInTheDocument()
    })

    it('출처(sources)가 없으면 SourcesCard를 렌더링하지 않는다', () => {
      const message = makeMessage({ role: 'assistant', content: '답변입니다.', metadata: null })
      render(<MessageBubble message={message} />)
      expect(screen.queryByText(/참고 약관/)).not.toBeInTheDocument()
    })
  })

  describe('타임스탬프', () => {
    it('시간 형식으로 타임스탬프를 표시한다', () => {
      const date = new Date()
      date.setHours(14, 30, 0, 0)
      const message = makeMessage({ created_at: date.toISOString() })
      render(<MessageBubble message={message} />)
      expect(screen.getByText('오후 2:30')).toBeInTheDocument()
    })
  })
})
