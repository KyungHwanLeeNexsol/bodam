/**
 * 헤더 컴포넌트 - 로고, 네비게이션, 로그인/시작하기 버튼
 */
import Link from 'next/link'
import { Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#E5E5E5] bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#2563EB] to-[#4F46E5]">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="bg-gradient-to-r from-[#2563EB] to-[#4F46E5] bg-clip-text text-xl font-bold text-transparent">
            보담
          </span>
        </Link>

        {/* 네비게이션 */}
        <nav className="hidden items-center gap-8 md:flex">
          <Link
            href="#features"
            className="text-sm text-[#666666] transition-colors hover:text-[#1A1A1A]"
          >
            기능
          </Link>
          <Link
            href="#how-it-works"
            className="text-sm text-[#666666] transition-colors hover:text-[#1A1A1A]"
          >
            이용 방법
          </Link>
          <Link
            href="#trust"
            className="text-sm text-[#666666] transition-colors hover:text-[#1A1A1A]"
          >
            데이터
          </Link>
          <Link
            href="/chat"
            className="text-sm font-medium text-[#0D6E6E] transition-colors hover:text-[#0a5a5a]"
          >
            상담하기
          </Link>
        </nav>

        {/* 우측 버튼 */}
        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button
              variant="ghost"
              className="text-sm text-[#666666] hover:text-[#1A1A1A]"
            >
              로그인
            </Button>
          </Link>
          <Link href="/chat">
            <Button
              className="rounded-[8px] bg-[#0D6E6E] px-5 text-sm text-white hover:bg-[#0a5a5a]"
            >
              시작하기
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
