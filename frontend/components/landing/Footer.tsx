/**
 * 푸터 컴포넌트 - 로고, 링크, 저작권
 */
import Link from 'next/link'
import { Shield } from 'lucide-react'

/* 푸터 링크 */
const footerLinks = [
  { label: '서비스 소개', href: '#features' },
  { label: '이용 방법', href: '#how-it-works' },
  { label: '개인정보 처리방침', href: '/privacy' },
  { label: '이용약관', href: '/terms' },
]

export default function Footer() {
  return (
    <footer className="bg-[#1A1A1A] py-12">
      <div className="mx-auto max-w-7xl px-6">
        {/* 상단: 로고 + 설명 + 링크 */}
        <div className="mb-8 flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          {/* 로고 */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10">
                <Shield className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-bold text-white">보담</span>
            </div>
            <p className="max-w-xs text-sm text-white/50">
              AI 기반 보험 보상 안내 플랫폼으로 복잡한 보험 절차를 쉽게 해결하세요.
            </p>
          </div>

          {/* 링크 목록 */}
          <nav className="flex flex-wrap gap-x-8 gap-y-3">
            {footerLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-white/50 transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* 구분선 */}
        <div className="border-t border-[#333333] pt-8">
          <p className="text-center text-sm text-white/30">
            © 2026 보담(Bodam). All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
