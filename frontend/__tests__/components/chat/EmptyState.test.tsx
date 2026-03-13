import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import EmptyState from '@/components/chat/EmptyState'

// 제안 질문 목록 (스펙과 일치해야 함)
const SUGGESTED_QUESTIONS = [
  '인공관절 수술 보험 보상이 되나요?',
  '교통사고 입원 보상 범위가 어떻게 되나요?',
  '실손보험 청구 절차를 알려주세요',
  '암 진단비 보험금은 얼마인가요?',
]

describe('EmptyState', () => {
  describe('기본 렌더링', () => {
    it('보담 타이틀을 렌더링한다', () => {
      render(<EmptyState onSendQuestion={vi.fn()} />)
      expect(screen.getByText('보담')).toBeInTheDocument()
    })

    it('"무엇이든 물어보세요" 서브타이틀을 렌더링한다', () => {
      render(<EmptyState onSendQuestion={vi.fn()} />)
      expect(screen.getByText('무엇이든 물어보세요')).toBeInTheDocument()
    })

    it('Shield 아이콘 영역을 렌더링한다', () => {
      const { container } = render(<EmptyState onSendQuestion={vi.fn()} />)
      // lucide-react Shield 아이콘이 SVG로 렌더링된다
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('제안 질문 칩', () => {
    it('4개의 제안 질문을 모두 렌더링한다', () => {
      render(<EmptyState onSendQuestion={vi.fn()} />)
      SUGGESTED_QUESTIONS.forEach((question) => {
        expect(screen.getByText(question)).toBeInTheDocument()
      })
    })

    it('제안 질문 클릭 시 onSendQuestion을 해당 질문과 함께 호출한다', () => {
      const onSendQuestion = vi.fn()
      render(<EmptyState onSendQuestion={onSendQuestion} />)
      fireEvent.click(screen.getByText('인공관절 수술 보험 보상이 되나요?'))
      expect(onSendQuestion).toHaveBeenCalledWith('인공관절 수술 보험 보상이 되나요?')
    })

    it('각 제안 질문 칩은 클릭 가능하다', () => {
      const onSendQuestion = vi.fn()
      render(<EmptyState onSendQuestion={onSendQuestion} />)
      SUGGESTED_QUESTIONS.forEach((question) => {
        fireEvent.click(screen.getByText(question))
      })
      expect(onSendQuestion).toHaveBeenCalledTimes(4)
    })

    it('두 번째 제안 질문도 정확한 내용으로 콜백을 호출한다', () => {
      const onSendQuestion = vi.fn()
      render(<EmptyState onSendQuestion={onSendQuestion} />)
      fireEvent.click(screen.getByText('교통사고 입원 보상 범위가 어떻게 되나요?'))
      expect(onSendQuestion).toHaveBeenCalledWith('교통사고 입원 보상 범위가 어떻게 되나요?')
    })
  })
})
