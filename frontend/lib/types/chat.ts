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

// 메시지 메타데이터
export interface MessageMetadata {
  sources?: Source[]
  model?: string
  tokens_used?: { prompt: number; completion: number }
  search_query?: string
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
  | { type: "done"; message_id: string }
  | { type: "error"; content: string }

// API 오류 응답
export interface ApiError {
  detail: string
  error_code?: string
}
