/**
 * 헤더 컴포넌트 - 로고, 네비게이션, 로그인/시작하기 버튼
 */
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import Logo from '@/components/ui/Logo'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#E5E5E5] bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* 로고 */}
        <Link href="/" className="flex items-center">
          <Logo size="md" />
        </Link>

        {/* 우측 버튼 */}
        <div className="flex items-center">
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
