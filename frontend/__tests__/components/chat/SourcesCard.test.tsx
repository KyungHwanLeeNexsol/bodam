import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SourcesCard from '@/components/chat/SourcesCard'
import type { Source } from '@/lib/types/chat'

const mockSources: Source[] = [
  { policy_name: '실손의료비보험 표준약관', company_name: '삼성생명', similarity_score: 0.95 },
  { policy_name: '암보험 특별약관', company_name: 'KB손해보험', similarity_score: 0.87 },
  { policy_name: '상해보험 보통약관', company_name: '현대해상', similarity_score: 0.82 },
]

describe('SourcesCard', () => {
  describe('기본 렌더링', () => {
    it('출처 수를 포함한 헤더를 렌더링한다', () => {
      render(<SourcesCard sources={mockSources} />)
      expect(screen.getByText(/참고 약관 3건/)).toBeInTheDocument()
    })

    it('출처가 1개일 때 "1건"을 표시한다', () => {
      render(<SourcesCard sources={[mockSources[0]!]} />)
      expect(screen.getByText(/참고 약관 1건/)).toBeInTheDocument()
    })

    it('기본 상태는 접힌 상태(collapsed)이다', () => {
      render(<SourcesCard sources={mockSources} />)
      // 접힌 상태에서는 출처 내용이 보이지 않는다
      expect(screen.queryByText('삼성생명')).not.toBeInTheDocument()
    })
  })

  describe('펼치기/접기 토글', () => {
    it('헤더 클릭 시 출처 목록을 펼친다', () => {
      render(<SourcesCard sources={mockSources} />)
      fireEvent.click(screen.getByText(/참고 약관 3건/))
      // 펼쳐진 상태에서 출처 정보가 표시된다
      expect(screen.getByText('삼성생명')).toBeInTheDocument()
      expect(screen.getByText('실손의료비보험 표준약관')).toBeInTheDocument()
    })

    it('펼쳐진 상태에서 헤더 클릭 시 다시 접힌다', () => {
      render(<SourcesCard sources={mockSources} />)
      // 펼치기
      fireEvent.click(screen.getByText(/참고 약관 3건/))
      expect(screen.getByText('삼성생명')).toBeInTheDocument()
      // 접기
      fireEvent.click(screen.getByText(/참고 약관 3건/))
      expect(screen.queryByText('삼성생명')).not.toBeInTheDocument()
    })

    it('펼쳐진 상태에서 모든 출처를 표시한다', () => {
      render(<SourcesCard sources={mockSources} />)
      fireEvent.click(screen.getByText(/참고 약관 3건/))
      expect(screen.getByText('삼성생명')).toBeInTheDocument()
      expect(screen.getByText('KB손해보험')).toBeInTheDocument()
      expect(screen.getByText('현대해상')).toBeInTheDocument()
    })
  })

  describe('출처 정보 표시', () => {
    it('출처 정책명을 표시한다', () => {
      render(<SourcesCard sources={mockSources} />)
      fireEvent.click(screen.getByText(/참고 약관/))
      expect(screen.getByText('실손의료비보험 표준약관')).toBeInTheDocument()
    })

    it('회사명을 표시한다', () => {
      render(<SourcesCard sources={mockSources} />)
      fireEvent.click(screen.getByText(/참고 약관/))
      expect(screen.getByText('삼성생명')).toBeInTheDocument()
    })

    it('유사도 점수를 퍼센트로 표시한다', () => {
      render(<SourcesCard sources={mockSources} />)
      fireEvent.click(screen.getByText(/참고 약관/))
      // 0.95 -> "95%" 형태로 표시
      expect(screen.getByText(/95%/)).toBeInTheDocument()
    })
  })
})
