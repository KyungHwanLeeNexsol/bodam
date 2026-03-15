"use client"

import { Menu, X, Bot, Share2, Ellipsis } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatLayoutProps {
  children: React.ReactNode
  sidebar: React.ReactNode
  sidebarOpen: boolean
  onToggleSidebar: () => void
  sessionTitle?: string | null
}

// @MX:NOTE: 채팅 전체 레이아웃 - 사이드바(세션 목록)와 채팅 영역 배치
// 데스크톱: 280px 고정 사이드바 + 메인 영역
// 모바일: 오버레이 사이드바 (backdrop 포함)
export default function ChatLayout({
  children,
  sidebar,
  sidebarOpen,
  onToggleSidebar,
  sessionTitle,
}: ChatLayoutProps) {
  return (
    <div className="relative flex h-screen bg-white">
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
          "hidden md:relative md:flex md:w-[280px] md:flex-col md:border-r md:border-[#E2E8F0]",
          // 모바일: 오버레이 사이드바
          sidebarOpen && "fixed inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-[#E2E8F0] shadow-lg md:shadow-none"
        )}
      >
        {/* 모바일 닫기 버튼 */}
        <button
          onClick={onToggleSidebar}
          className="absolute right-3 top-3 rounded-[8px] p-1.5 text-[#94A3B8] hover:bg-gray-100 md:hidden"
          aria-label="사이드바 닫기"
        >
          <X className="h-4 w-4" />
        </button>

        {sidebar}
      </aside>

      {/* 메인 채팅 영역 */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* 모바일 햄버거 버튼 */}
        <div className="flex items-center border-b border-[#E2E8F0] px-4 py-3 md:hidden">
          <button
            onClick={onToggleSidebar}
            className="rounded-[8px] p-1.5 text-[#475569] hover:bg-gray-100"
            aria-label="메뉴 열기"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {/* 데스크톱 채팅 헤더 */}
        {sessionTitle && (
          <div className="hidden md:flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EEF2FF]">
                <Bot className="h-5 w-5 text-[#4F46E5]" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-base font-semibold text-[#0F172A]">{sessionTitle}</span>
                <span className="text-xs text-[#94A3B8]">보담과 대화 중</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#475569] hover:bg-gray-50" aria-label="공유">
                <Share2 className="h-[18px] w-[18px]" />
              </button>
              <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#475569] hover:bg-gray-50" aria-label="더보기">
                <Ellipsis className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        )}

        {children}
      </main>
    </div>
  )
}
