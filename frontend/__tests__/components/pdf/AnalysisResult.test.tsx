/**
 * AnalysisResult 컴포넌트 단위 테스트 (SPEC-PDF-001 M4)
 *
 * REQ-PDF-403: 분석 결과를 구조화된 카드로 표시 (담보목록, 보장조건, 면책사항)
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AnalysisResult from '@/components/pdf/AnalysisResult'
import type { CoverageAnalysis, TokenUsage } from '@/lib/pdf'

// 테스트용 분석 결과 더미 데이터
const mockAnalysis: CoverageAnalysis = {
  담보목록: [
    { 명칭: '사망담보', 보상금액: '1억원', 조건: '일반사망 시' },
    { 명칭: '후유장해담보', 보상금액: '최대 1억원', 조건: '80% 이상 후유장해' },
  ],
  보상조건: ['질병으로 인한 사망', '재해로 인한 사망'],
  면책사항: ['자살 또는 자해', '전쟁 및 천재지변'],
  보상한도: '총 1억원',
}

const mockTokenUsage: TokenUsage = {
  input_tokens: 1200,
  output_tokens: 450,
  cost_usd: 0.0018,
}

describe('AnalysisResult', () => {
  describe('기본 렌더링', () => {
    it('"분석 결과" 제목을 표시한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('분석 결과')).toBeInTheDocument()
    })

    it('담보 목록 섹션을 렌더링한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('담보 목록 (2개)')).toBeInTheDocument()
    })

    it('보상 조건 섹션을 렌더링한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('보상 조건 (2개)')).toBeInTheDocument()
    })

    it('면책 사항 섹션을 렌더링한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('면책 사항 (2개)')).toBeInTheDocument()
    })
  })

  describe('REQ-PDF-403: 담보목록 표시', () => {
    it('담보 목록이 기본으로 펼쳐진 상태이다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      // 기본으로 coverage 섹션이 열려있으므로 담보 항목이 보여야 함
      expect(screen.getByText('사망담보')).toBeInTheDocument()
      expect(screen.getByText('후유장해담보')).toBeInTheDocument()
    })

    it('담보목록 테이블 헤더를 표시한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('명칭')).toBeInTheDocument()
      expect(screen.getByText('보상금액')).toBeInTheDocument()
      expect(screen.getByText('조건')).toBeInTheDocument()
    })

    it('각 담보 항목의 명칭, 보상금액, 조건을 표시한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('사망담보')).toBeInTheDocument()
      expect(screen.getByText('1억원')).toBeInTheDocument()
      expect(screen.getByText('일반사망 시')).toBeInTheDocument()
    })

    it('보상한도가 있으면 표시한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('보상 한도: 총 1억원')).toBeInTheDocument()
    })

    it('담보목록이 비어있으면 안내 문구를 표시한다', () => {
      const emptyAnalysis = { ...mockAnalysis, 담보목록: [] }
      render(<AnalysisResult analysis={emptyAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('담보 목록이 없습니다.')).toBeInTheDocument()
    })
  })

  describe('REQ-PDF-403: 보상조건 표시', () => {
    it('보상 조건 섹션 클릭 시 내용이 펼쳐진다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)

      // 기본적으로 닫혀있는 보상 조건 섹션 클릭
      const conditionButton = screen.getByText('보상 조건 (2개)').closest('button')
      fireEvent.click(conditionButton!)

      expect(screen.getByText('질병으로 인한 사망')).toBeInTheDocument()
      expect(screen.getByText('재해로 인한 사망')).toBeInTheDocument()
    })

    it('보상조건이 비어있으면 안내 문구를 표시한다', () => {
      const emptyAnalysis = { ...mockAnalysis, 보상조건: [] }
      render(<AnalysisResult analysis={emptyAnalysis} tokenUsage={mockTokenUsage} />)

      const conditionButton = screen.getByText('보상 조건 (0개)').closest('button')
      fireEvent.click(conditionButton!)

      expect(screen.getByText('보상 조건 정보가 없습니다.')).toBeInTheDocument()
    })
  })

  describe('REQ-PDF-403: 면책사항 표시', () => {
    it('면책 사항 섹션 클릭 시 내용이 펼쳐진다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)

      const exclusionButton = screen.getByText('면책 사항 (2개)').closest('button')
      fireEvent.click(exclusionButton!)

      expect(screen.getByText('자살 또는 자해')).toBeInTheDocument()
      expect(screen.getByText('전쟁 및 천재지변')).toBeInTheDocument()
    })

    it('면책사항이 비어있으면 안내 문구를 표시한다', () => {
      const emptyAnalysis = { ...mockAnalysis, 면책사항: [] }
      render(<AnalysisResult analysis={emptyAnalysis} tokenUsage={mockTokenUsage} />)

      const exclusionButton = screen.getByText('면책 사항 (0개)').closest('button')
      fireEvent.click(exclusionButton!)

      expect(screen.getByText('면책 사항 정보가 없습니다.')).toBeInTheDocument()
    })
  })

  describe('아코디언 토글 동작', () => {
    it('열린 섹션을 클릭하면 닫힌다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)

      // 기본으로 열린 담보 목록 섹션 닫기
      const coverageButton = screen.getByText('담보 목록 (2개)').closest('button')
      fireEvent.click(coverageButton!)

      // aria-expanded가 false여야 함
      expect(coverageButton).toHaveAttribute('aria-expanded', 'false')
    })

    it('닫힌 섹션을 클릭하면 열린다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)

      const conditionButton = screen.getByText('보상 조건 (2개)').closest('button')
      // 기본 닫힌 상태 확인
      expect(conditionButton).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(conditionButton!)

      expect(conditionButton).toHaveAttribute('aria-expanded', 'true')
    })

    it('여러 섹션을 동시에 열 수 있다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)

      const conditionButton = screen.getByText('보상 조건 (2개)').closest('button')
      const exclusionButton = screen.getByText('면책 사항 (2개)').closest('button')

      fireEvent.click(conditionButton!)
      fireEvent.click(exclusionButton!)

      expect(conditionButton).toHaveAttribute('aria-expanded', 'true')
      expect(exclusionButton).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('토큰 사용량 표시', () => {
    it('입력 토큰 수를 표시한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('입력 1,200 토큰')).toBeInTheDocument()
    })

    it('출력 토큰 수를 표시한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('출력 450 토큰')).toBeInTheDocument()
    })

    it('비용을 달러 형식으로 표시한다', () => {
      render(<AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />)
      expect(screen.getByText('$0.0018')).toBeInTheDocument()
    })
  })

  describe('REQ-PDF-406: 모바일 반응형', () => {
    it('레이아웃 오류 없이 렌더링된다', () => {
      const { container } = render(
        <AnalysisResult analysis={mockAnalysis} tokenUsage={mockTokenUsage} />
      )
      expect(container.firstChild).toBeTruthy()
    })
  })
})
