"use client"

import { forwardRef } from "react"

interface MessageListProps {
  children: React.ReactNode
}

// @MX:NOTE: 메시지 목록 스크롤 컨테이너 - forwardRef로 부모에서 auto-scroll 제어 가능
const MessageList = forwardRef<HTMLDivElement, MessageListProps>(({ children }, ref) => {
  return (
    <div
      ref={ref}
      className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
    >
      {children}
    </div>
  )
})

MessageList.displayName = "MessageList"

export default MessageList
