"use client"

import { cn } from "@/lib/utils"

// @MX:NOTE: 로딩 스켈레톤 컴포넌트 - SessionList와 MessageList 로딩 상태에 사용

// 세션 목록 스켈레톤 (5개 항목)
export function SessionListSkeleton() {
  return (
    <div className="space-y-1 px-3 py-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-9 animate-pulse rounded-[8px] bg-gray-200"
        />
      ))}
    </div>
  )
}

// 메시지 목록 스켈레톤 (3개 버블, 좌우 교대)
export function MessageListSkeleton() {
  const sides: Array<"left" | "right"> = ["left", "right", "left"]

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {sides.map((side, i) => (
        <div
          key={i}
          className={cn(
            "flex w-full",
            side === "right" ? "justify-end" : "justify-start"
          )}
        >
          <div
            className={cn(
              "h-12 animate-pulse rounded-[12px] bg-gray-200",
              side === "right" ? "w-48" : "w-64"
            )}
          />
        </div>
      ))}
    </div>
  )
}
