/**
 * 푸터 컴포넌트 - 로고, 링크, 저작권
 */
import Link from 'next/link'
import Image from 'next/image'

const footerLinks = [
  { label: '이용약관', href: '/terms' },
  { label: '개인정보처리방침', href: '/privacy' },
  { label: '쿠키 정책', href: '#' },
  { label: '문의하기', href: '#' },
]

export default function Footer() {
  return (
    <footer className="bg-[#1A1A1A] px-[120px] py-12">
      {/* 상단: 브랜드 좌측 + 링크 우측 */}
      <div className="mb-10 flex w-full items-center justify-between">
        {/* 브랜드 */}
        <div className="flex w-[300px] flex-col gap-3">
          <Image
            src="/logo.png"
            alt="보담 로고"
            width={273}
            height={108}
            className="h-8 w-auto"
          />
          <p className="text-[13px] leading-relaxed text-[#888888]">
            보험 보상 안내 플랫폼<br />
            보험의 복잡함을 간단하게 풀어드립니다
          </p>
        </div>

        {/* 링크 (· 구분자) */}
        <div className="flex items-center gap-4">
          {footerLinks.map((link, i) => (
            <>
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-[#888888] transition-colors hover:text-white"
              >
                {link.label}
              </Link>
              {i < footerLinks.length - 1 && (
                <span key={`sep-${i}`} className="text-[13px] text-[#555555]">·</span>
              )}
            </>
          ))}
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
