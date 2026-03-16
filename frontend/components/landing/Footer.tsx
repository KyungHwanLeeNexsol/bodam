/**
 * 푸터 컴포넌트 - 로고, 3컬럼 링크, 저작권
 */
import Link from 'next/link'
import Logo from '@/components/ui/Logo'

const serviceLinks = [
  { label: '보담 보상 안내', href: '/chat' },
  { label: '약관 분석', href: '#features' },
  { label: '보험사 비교', href: '#features' },
  { label: '거절 분석', href: '#features' },
]

const companyLinks = [
  { label: '회사 소개', href: '#' },
  { label: '채용', href: '#' },
  { label: '블로그', href: '#' },
  { label: '문의하기', href: '#' },
]

const legalLinks = [
  { label: '이용약관', href: '/terms' },
  { label: '개인정보처리방침', href: '/privacy' },
  { label: '쿠키 정책', href: '#' },
]

export default function Footer(): JSX.Element {
  return (
    <footer className="bg-[#1A1A1A] px-[120px] py-12">
      {/* 상단: 브랜드 + 3컬럼 링크 */}
      <div className="mb-10 flex items-start justify-between">
        {/* 브랜드 */}
        <div className="flex w-[300px] flex-col gap-3">
          <Logo size="md" />
          <p className="text-[13px] leading-relaxed text-[#888888]">
            보험 보상 안내 플랫폼<br />
            보험의 복잡함을 간단하게 풀어드립니다
          </p>
        </div>

        {/* 3컬럼 링크 */}
        <div className="flex gap-20">
          {/* 서비스 */}
          <div className="flex flex-col gap-4">
            <span className="font-mono text-[11px] font-semibold tracking-[2px] text-white">
              서비스
            </span>
            {serviceLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-[#888888] transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* 회사 */}
          <div className="flex flex-col gap-4">
            <span className="font-mono text-[11px] font-semibold tracking-[2px] text-white">
              회사
            </span>
            {companyLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-[#888888] transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* 법적고지 */}
          <div className="flex flex-col gap-4">
            <span className="font-mono text-[11px] font-semibold tracking-[2px] text-white">
              법적고지
            </span>
            {legalLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-[#888888] transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* 구분선 */}
      <div className="h-px bg-[#333333]" />

      {/* 저작권 */}
      <p className="mt-10 text-center text-[12px] text-[#666666]">
        © 2026 보담(Bodam). All rights reserved.
      </p>
    </footer>
  )
}
