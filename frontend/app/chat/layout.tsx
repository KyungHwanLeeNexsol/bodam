import type { Metadata } from "next"

// 채팅 페이지 메타데이터
export const metadata: Metadata = {
  title: "보담 AI 상담",
  description: "보험 보상 관련 질문에 대해 AI가 답변해 드립니다.",
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children
}
