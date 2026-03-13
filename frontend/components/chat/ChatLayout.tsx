"use client"

import { Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatLayoutProps {
  children: React.ReactNode
  sidebar: React.ReactNode
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

// @MX:NOTE: 채팅 전체 레이아웃 - 사이드바(세션 목록)와 채팅 영역 배치
// 데스크톱: 280px 고정 사이드바 + 메인 영역
// 모바일: 오버레이 사이드바 (backdrop 포함)
export default function ChatLayout({
  children,
  sidebar,
  sidebarOpen,
  onToggleSidebar,
}: ChatLayoutProps) {
  return (
    <div className="relative flex h-screen bg-[#FAFAFA]">
      {/* 모바일 backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={onToggleSidebar}
          aria-hidden="true"
        />
      )}

      {/* 사이드바 */}
      <aside
        className={cn(
          // 데스크톱: 고정 사이드바
          "hidden md:relative md:flex md:w-[280px] md:flex-col md:border-r md:border-gray-200",
          // 모바일: 오버레이 사이드바
          sidebarOpen && "fixed inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-gray-200 shadow-lg md:shadow-none"
        )}
      >
        {/* 모바일 닫기 버튼 */}
        <button
          onClick={onToggleSidebar}
          className="absolute right-3 top-3 rounded-[8px] p-1.5 text-[#666666] hover:bg-gray-100 md:hidden"
          aria-label="사이드바 닫기"
        >
          <X className="h-4 w-4" />
        </button>

        {sidebar}
      </aside>

      {/* 메인 채팅 영역 */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* 모바일 햄버거 버튼 */}
        <div className="flex items-center border-b border-gray-200 px-4 py-3 md:hidden">
          <button
            onClick={onToggleSidebar}
            className="rounded-[8px] p-1.5 text-[#666666] hover:bg-gray-100"
            aria-label="메뉴 열기"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {children}
      </main>
    </div>
  )
}
