/**
 * 랜딩 페이지 테스트 (RED 단계)
 * 랜딩 페이지의 핵심 섹션이 렌더링되는지 검증합니다.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import HomePage from '@/app/page'

describe('랜딩 페이지', () => {
  it('히어로 섹션에 헤드라인이 표시된다', () => {
    render(<HomePage />)
    // 히어로 섹션 헤드라인 확인
    expect(screen.getByText(/보험 보상,/)).toBeTruthy()
  })

  it('피처 섹션이 표시된다', () => {
    render(<HomePage />)
    // 피처 섹션 레이블 확인
    expect(screen.getByText(/FEATURES/)).toBeTruthy()
  })

  it('How It Works 섹션이 표시된다', () => {
    render(<HomePage />)
    // 섹션 타이틀 확인
    expect(screen.getByText(/HOW IT WORKS/)).toBeTruthy()
  })

  it('트러스트 섹션에 지표가 표시된다', () => {
    render(<HomePage />)
    // 보험사 수 지표 확인
    expect(screen.getByText(/10\+/)).toBeTruthy()
  })

  it('CTA 섹션이 표시된다', () => {
    render(<HomePage />)
    // CTA 섹션 헤드라인 확인 (getAllByText로 여러 요소 허용)
    const ctaElements = screen.getAllByText(/지금 바로/)
    expect(ctaElements.length).toBeGreaterThan(0)
  })
})
