/**
 * CTA 섹션 - 최종 행동 유도 섹션
 */
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { MessageCircle } from 'lucide-react'

export default function CTASection() {
  return (
    <section className="bg-[#FAFAFA] py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col items-center text-center">
          {/* 헤드라인 */}
          <h2
            className="mb-6 max-w-2xl text-4xl font-bold leading-tight text-[#1A1A1A]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            지금 바로 보험 보상 안내를 받아보세요
          </h2>

          {/* 서브텍스트 */}
          <p className="mb-10 text-lg text-[#666666]">
            복잡한 보험 절차, 보담이 쉽게 도와드립니다. 무료로 시작하세요.
          </p>

          {/* CTA 버튼 */}
          <Link href="/chat">
            <Button
              size="lg"
              className="rounded-[8px] bg-[#0D6E6E] px-10 py-6 text-base text-white hover:bg-[#0a5a5a]"
            >
              <MessageCircle className="mr-2 h-5 w-5" />
              무료 상담 시작하기
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
