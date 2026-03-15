import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import GuidanceCard from '@/components/chat/GuidanceCard'
import type { GuidanceData } from '@/lib/types/chat'

const mockGuidance: GuidanceData = {
  dispute_type: "claim_denial",
  ambiguous_clauses: [],
  precedents: [
    {
      case_number: "2023다56789",
      court_name: "대법원",
      decision_date: "2023-06-15",
      summary: "보험금 지급 거절 사건에서 소비자 승소",
      relevance_score: 0.92,
      key_ruling: "약관 해석은 소비자에게 유리하게 해석해야 한다",
    },
  ],
  probability: {
    overall_score: 0.72,
    factors: ["유리한 판례 존재", "약관 모호성"],
    confidence: 0.8,
    disclaimer: "확률 산정은 참고용입니다",
  },
  evidence_strategy: {
    required_documents: ["진료기록부", "보험증권"],
    recommended_documents: ["의사소견서"],
    preparation_tips: ["시간순으로 정리하세요"],
    timeline_advice: "3년 이내 청구",
  },
  escalation: {
    recommended_level: "fss_complaint",
    reason: "보험사 거절 시 금감원 민원이 효과적",
    next_steps: ["금감원 민원 접수", "분쟁조정 신청"],
    estimated_duration: "2-3개월",
    cost_estimate: "무료",
  },
  disclaimer: "본 정보는 참고용이며 법적 조언이 아닙니다.",
  confidence: 0.85,
}

describe('GuidanceCard', () => {
  it('기본 접힘 상태에서 헤더에 분쟁 유형과 라벨을 표시한다', () => {
    render(<GuidanceCard guidance={mockGuidance} />)
    expect(screen.getByText(/분쟁 가이던스/)).toBeInTheDocument()
    expect(screen.getByText(/보험금 지급 거절/)).toBeInTheDocument()
  })

  it('기본 상태에서 판례 내용은 보이지 않는다', () => {
    render(<GuidanceCard guidance={mockGuidance} />)
    expect(screen.queryByText('2023다56789')).not.toBeInTheDocument()
  })

  it('헤더 클릭 시 펼쳐져서 판례 정보를 표시한다', () => {
    render(<GuidanceCard guidance={mockGuidance} />)
    fireEvent.click(screen.getByLabelText('분쟁 가이던스 토글'))
    expect(screen.getByText('2023다56789')).toBeInTheDocument()
  })

  it('펼침 시 승소 확률을 표시한다', () => {
    render(<GuidanceCard guidance={mockGuidance} />)
    fireEvent.click(screen.getByLabelText('분쟁 가이던스 토글'))
    expect(screen.getByText(/72%/)).toBeInTheDocument()
  })

  it('펼침 시 필요 서류를 표시한다', () => {
    render(<GuidanceCard guidance={mockGuidance} />)
    fireEvent.click(screen.getByLabelText('분쟁 가이던스 토글'))
    expect(screen.getByText(/진료기록부/)).toBeInTheDocument()
    expect(screen.getByText(/보험증권/)).toBeInTheDocument()
  })

  it('펼침 시 에스컬레이션 단계를 표시한다', () => {
    render(<GuidanceCard guidance={mockGuidance} />)
    fireEvent.click(screen.getByLabelText('분쟁 가이던스 토글'))
    expect(screen.getByText(/금감원 민원 접수/)).toBeInTheDocument()
  })

  it('면책 고지는 항상 표시된다 (접힌 상태에서도)', () => {
    render(<GuidanceCard guidance={mockGuidance} />)
    expect(screen.getByText(/본 정보는 참고용/)).toBeInTheDocument()
  })

  it('펼쳐진 상태에서 다시 접을 수 있다', () => {
    render(<GuidanceCard guidance={mockGuidance} />)
    fireEvent.click(screen.getByLabelText('분쟁 가이던스 토글'))
    expect(screen.getByText('2023다56789')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('분쟁 가이던스 토글'))
    expect(screen.queryByText('2023다56789')).not.toBeInTheDocument()
  })
})
