'use client'

/**
 * 분석 결과 컴포넌트 (SPEC-PDF-001)
 *
 * PDF 분석 결과를 아코디언 형식으로 표시.
 * 담보목록, 보상조건, 면책사항 섹션.
 */

import { useState } from 'react'
import type { CoverageAnalysis, TokenUsage } from '@/lib/pdf'

interface AnalysisResultProps {
  analysis: CoverageAnalysis
  tokenUsage: TokenUsage
}

interface AccordionSectionProps {
  title: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  icon?: React.ReactNode
  variant?: 'default' | 'warning'
}

function AccordionSection({
  title,
  isOpen,
  onToggle,
  children,
  icon,
  variant = 'default',
}: AccordionSectionProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E5E5]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span
            className={`text-sm font-medium ${variant === 'warning' ? 'text-amber-700' : 'text-[#1A1A1A]'}`}
          >
            {title}
          </span>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-[#666] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div
        className={`transition-all duration-200 ${isOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 overflow-hidden opacity-0'}`}
      >
        <div className="border-t border-[#E5E5E5] px-4 py-3">{children}</div>
      </div>
    </div>
  )
}

/**
 * AnalysisResult 컴포넌트
 *
 * 보험 약관 분석 결과를 아코디언 형식으로 렌더링.
 * 담보목록은 테이블, 보상조건/면책사항은 불릿 목록으로 표시.
 */
export default function AnalysisResult({ analysis, tokenUsage }: AnalysisResultProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['coverage']))

  const toggleSection = (section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const formatCost = (usd: number): string => {
    return `$${usd.toFixed(4)}`
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-[#1A1A1A]">분석 결과</h2>

      {/* 담보 목록 */}
      <AccordionSection
        title={`담보 목록 (${analysis.담보목록.length}개)`}
        isOpen={openSections.has('coverage')}
        onToggle={() => toggleSection('coverage')}
        icon={
          <svg
            className="h-4 w-4 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        }
      >
        {analysis.담보목록.length === 0 ? (
          <p className="text-sm text-[#666]">담보 목록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E5E5]">
                  <th className="pb-2 pr-3 text-left font-medium text-[#666]">명칭</th>
                  <th className="pb-2 pr-3 text-left font-medium text-[#666]">보상금액</th>
                  <th className="pb-2 text-left font-medium text-[#666]">조건</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F0]">
                {analysis.담보목록.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-2 pr-3 font-medium text-[#1A1A1A]">{item.명칭}</td>
                    <td className="py-2 pr-3 text-[#333]">{item.보상금액}</td>
                    <td className="py-2 text-[#666]">{item.조건}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {analysis.보상한도 && (
          <p className="mt-2 text-xs text-[#666]">보상 한도: {analysis.보상한도}</p>
        )}
      </AccordionSection>

      {/* 보상 조건 */}
      <AccordionSection
        title={`보상 조건 (${analysis.보상조건.length}개)`}
        isOpen={openSections.has('conditions')}
        onToggle={() => toggleSection('conditions')}
        icon={
          <svg
            className="h-4 w-4 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            />
          </svg>
        }
      >
        {analysis.보상조건.length === 0 ? (
          <p className="text-sm text-[#666]">보상 조건 정보가 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {analysis.보상조건.map((condition, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-[#333]">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
                {condition}
              </li>
            ))}
          </ul>
        )}
      </AccordionSection>

      {/* 면책 사항 */}
      <AccordionSection
        title={`면책 사항 (${analysis.면책사항.length}개)`}
        isOpen={openSections.has('exclusions')}
        onToggle={() => toggleSection('exclusions')}
        variant="warning"
        icon={
          <svg
            className="h-4 w-4 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        }
      >
        {analysis.면책사항.length === 0 ? (
          <p className="text-sm text-[#666]">면책 사항 정보가 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {analysis.면책사항.map((exclusion, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-amber-800">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                {exclusion}
              </li>
            ))}
          </ul>
        )}
      </AccordionSection>

      {/* 토큰 사용량 배지 */}
      <div className="flex items-center gap-2 text-xs text-[#999]">
        <span className="rounded-full bg-gray-100 px-2 py-0.5">
          입력 {tokenUsage.input_tokens.toLocaleString()} 토큰
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5">
          출력 {tokenUsage.output_tokens.toLocaleString()} 토큰
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5">{formatCost(tokenUsage.cost_usd)}</span>
      </div>
    </div>
  )
}
