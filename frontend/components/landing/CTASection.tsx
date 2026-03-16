/**
 * CTA 섹션 - 최종 행동 유도 섹션
 */
import Link from 'next/link'
import { Button } from '@/components/ui/button'

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
            무료로 시작하고, 보담이 여러분의 보험 보상을 안내해드립니다
          </p>

          {/* CTA 버튼 */}
          <Link href="/chat">
            <Button
              size="lg"
              className="rounded-[8px] bg-[#0D6E6E] px-10 py-4 text-base font-semibold text-white hover:bg-[#0a5a5a]"
            >
              무료로 시작하기
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
