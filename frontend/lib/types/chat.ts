// 채팅 세션 기본 정보
export interface ChatSession {
  id: string
  title: string
  user_id: string | null
  created_at: string
  updated_at: string
}

// 채팅 세션 목록 항목 (메시지 수 포함)
export interface ChatSessionListItem {
  id: string
  title: string
  user_id: string | null
  created_at: string
  updated_at: string
  message_count: number
}

// 채팅 메시지
export interface ChatMessage {
  id: string
  session_id: string
  role: "user" | "assistant" | "system"
  content: string
  metadata: MessageMetadata | null
  created_at: string
}

// 분쟁 유형
export type DisputeType =
  | "claim_denial"
  | "coverage_dispute"
  | "incomplete_sale"
  | "premium_dispute"
  | "contract_cancel"
  | "other"

// 분쟁 유형 한국어 라벨 맵
export const DISPUTE_TYPE_LABELS: Record<DisputeType, string> = {
  claim_denial: "보험금 지급 거절",
  coverage_dispute: "보장 범위 분쟁",
  incomplete_sale: "불완전판매",
  premium_dispute: "보험료 분쟁",
  contract_cancel: "계약 해지 분쟁",
  other: "기타",
}

// 에스컬레이션 단계
export type EscalationLevel =
  | "self_resolution"
  | "company_complaint"
  | "fss_complaint"
  | "dispute_mediation"
  | "legal_action"

// 에스컬레이션 단계 한국어 라벨 맵
export const ESCALATION_LABELS: Record<EscalationLevel, string> = {
  self_resolution: "자체 해결",
  company_complaint: "보험사 민원",
  fss_complaint: "금감원 민원",
  dispute_mediation: "분쟁조정",
  legal_action: "법적 소송",
}

// 판례 요약
export interface PrecedentSummary {
  case_number: string
  court_name: string
  decision_date: string
  summary: string
  relevance_score: number
  key_ruling: string
}

// 승소 확률
export interface ProbabilityScore {
  overall_score: number
  factors: string[]
  confidence: number
  disclaimer: string
}

// 증거 전략
export interface EvidenceStrategy {
  required_documents: string[]
  recommended_documents: string[]
  preparation_tips: string[]
  timeline_advice: string
}

// 에스컬레이션 권장
export interface EscalationRecommendation {
  recommended_level: EscalationLevel
  reason: string
  next_steps: string[]
  estimated_duration: string
  cost_estimate: string
}

// 모호한 약관 조항
export interface AmbiguousClause {
  clause_text: string
  ambiguity_reason: string
  consumer_favorable_interpretation: string
  insurer_favorable_interpretation: string
  recommendation: string
}

// 분쟁 가이던스 데이터 (통합)
export interface GuidanceData {
  dispute_type: DisputeType
  ambiguous_clauses: AmbiguousClause[]
  precedents: PrecedentSummary[]
  probability: ProbabilityScore | null
  evidence_strategy: EvidenceStrategy | null
  escalation: EscalationRecommendation | null
  disclaimer: string
  confidence: number
}

// 메시지 메타데이터
export interface MessageMetadata {
  sources?: Source[]
  model?: string
  tokens_used?: { prompt: number; completion: number }
  search_query?: string
  guidance?: GuidanceData
}

// 보험 정책 출처 정보
export interface Source {
  policy_name: string
  company_name: string
  chunk_text?: string
  similarity_score?: number
}

// 채팅 세션 상세 정보 (메시지 목록 포함)
export interface ChatSessionDetail {
  id: string
  title: string
  user_id: string | null
  created_at: string
  updated_at: string
  messages: ChatMessage[]
}

// 메시지 전송 응답
export interface MessageSendResponse {
  user_message: ChatMessage
  assistant_message: ChatMessage
}

// SSE 이벤트 타입 (판별 유니온)
export type SSEEvent =
  | { type: "token"; content: string }
  | { type: "sources"; content: Source[] }
  | { type: "guidance"; content: GuidanceData }
  | { type: "done"; message_id: string }
  | { type: "error"; content: string }

// API 오류 응답
export interface ApiError {
  detail: string
  error_code?: string
}
