"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GuidanceData } from "@/lib/types/chat"
import { DISPUTE_TYPE_LABELS, ESCALATION_LABELS } from "@/lib/types/chat"

interface GuidanceCardProps {
  guidance: GuidanceData
}

// 승소 확률 점수에 따른 색상 클래스 반환
const getProbabilityColorClass = (score: number): string => {
  if (score >= 0.7) return "text-green-700"
  if (score >= 0.5) return "text-amber-700"
  return "text-red-700"
}

// @MX:ANCHOR: 분쟁 가이던스 카드 컴포넌트 - 접기/펼치기 지원
// @MX:REASON: MessageBubble, StreamingMessage에서 참조되며 분쟁 가이던스 UI의 핵심 단위 컴포넌트
export default function GuidanceCard({ guidance }: GuidanceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpand = () => {
    setIsExpanded((prev) => !prev)
  }

  const disputeLabel = DISPUTE_TYPE_LABELS[guidance.dispute_type] ?? guidance.dispute_type

  return (
    <div className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 text-sm">
      {/* 헤더 - 클릭으로 펼치기/접기 */}
      <button
        onClick={toggleExpand}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-amber-800 hover:text-amber-900"
        aria-expanded={isExpanded}
        aria-label="분쟁 가이던스 토글"
      >
        <span className="font-medium">분쟁 가이던스 · {disputeLabel}</span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" />
        )}
      </button>

      {/* 펼쳐진 내용 */}
      {isExpanded && (
        <div className="border-t border-amber-200 px-3 py-3 space-y-4">
          {/* 관련 판례 섹션 */}
          {guidance.precedents.length > 0 && (
            <section>
              <h4 className="mb-2 font-semibold text-amber-900">
                관련 판례 {guidance.precedents.length}건
              </h4>
              <ul className="space-y-2">
                {guidance.precedents.map((p) => (
                  <li key={p.case_number} className="rounded-[6px] bg-white px-3 py-2 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-[#1A1A1A]">
                          {p.case_number}{" "}
                          <span className="font-normal text-[#666666]">({p.court_name})</span>
                        </p>
                        <p className="mt-0.5 text-xs text-[#666666]">{p.decision_date}</p>
                        <p className="mt-1 text-xs text-[#1A1A1A]">{p.summary}</p>
                        {p.key_ruling && (
                          <p className="mt-1 text-xs italic text-amber-800">
                            핵심 판결: {p.key_ruling}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                          p.relevance_score >= 0.9
                            ? "bg-green-100 text-green-700"
                            : p.relevance_score >= 0.7
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-600"
                        )}
                      >
                        관련도 {Math.round(p.relevance_score * 100)}%
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 승소 가능성 섹션 */}
          {guidance.probability && (
            <section>
              <h4 className="mb-2 font-semibold text-amber-900">승소 가능성</h4>
              <div className="rounded-[6px] bg-white px-3 py-2 shadow-sm">
                <p
                  className={cn(
                    "text-2xl font-bold",
                    getProbabilityColorClass(guidance.probability.overall_score)
                  )}
                >
                  {Math.round(guidance.probability.overall_score * 100)}%
                </p>
                {guidance.probability.factors.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {guidance.probability.factors.map((factor, i) => (
                      <li key={i} className="text-xs text-[#666666]">
                        · {factor}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* 필요 서류 섹션 */}
          {guidance.evidence_strategy && (
            <section>
              <h4 className="mb-2 font-semibold text-amber-900">필요 서류</h4>
              <ul className="space-y-1">
                {guidance.evidence_strategy.required_documents.map((doc, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-[#1A1A1A]">
                    <span className="text-green-600">✓</span>
                    {doc}
                    <span className="text-amber-700">(필수)</span>
                  </li>
                ))}
                {guidance.evidence_strategy.recommended_documents.map((doc, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-[#666666]">
                    <span className="text-gray-400">○</span>
                    {doc}
                    <span>(권장)</span>
                  </li>
                ))}
              </ul>
              {guidance.evidence_strategy.timeline_advice && (
                <p className="mt-1.5 text-xs text-amber-800">
                  기한: {guidance.evidence_strategy.timeline_advice}
                </p>
              )}
            </section>
          )}

          {/* 대응 단계 섹션 */}
          {guidance.escalation && (
            <section>
              <h4 className="mb-2 font-semibold text-amber-900">대응 단계</h4>
              <div className="rounded-[6px] bg-white px-3 py-2 shadow-sm">
                <p className="font-medium text-[#1A1A1A]">
                  권장:{" "}
                  {ESCALATION_LABELS[guidance.escalation.recommended_level] ??
                    guidance.escalation.recommended_level}
                </p>
                {guidance.escalation.reason && (
                  <p className="mt-0.5 text-xs text-[#666666]">{guidance.escalation.reason}</p>
                )}
                {guidance.escalation.next_steps.length > 0 && (
                  <ol className="mt-2 list-decimal list-inside space-y-0.5">
                    {guidance.escalation.next_steps.map((step, i) => (
                      <li key={i} className="text-xs text-[#1A1A1A]">
                        {step}
                      </li>
                    ))}
                  </ol>
                )}
                <div className="mt-1.5 flex gap-3 text-xs text-[#666666]">
                  {guidance.escalation.estimated_duration && (
                    <span>예상 기간: {guidance.escalation.estimated_duration}</span>
                  )}
                  {guidance.escalation.cost_estimate && (
                    <span>비용: {guidance.escalation.cost_estimate}</span>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* 면책 고지 - 항상 표시 (ACC-14) */}
      <div className="border-t border-amber-200 px-3 py-2 text-xs text-amber-700">
        {guidance.disclaimer}
      </div>
    </div>
  )
}
