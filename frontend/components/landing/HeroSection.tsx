/**
 * 히어로 섹션 - 배지, 타이틀, 서브타이틀, CTA 버튼, 채팅 미리보기
 */
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { MessageCircle, ArrowRight, Bot, User, Shield } from 'lucide-react'

/* 채팅 미리보기 목업 데이터 */
const chatMessages = [
  {
    role: 'bot',
    content: '안녕하세요! 보험 보상에 대해 궁금한 점이 있으신가요?',
  },
  {
    role: 'user',
    content: '자동차 사고 후 보상 청구는 어떻게 하나요?',
  },
  {
    role: 'bot',
    content:
      '자동차 사고 보상을 위해 먼저 사고 증명서와 진단서를 준비하세요. 해당 서류를 바탕으로 보험사에 청구서를 제출하시면 됩니다.',
  },
]

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-white py-20 lg:py-28">
      {/* 배경 그라데이션 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#0D6E6E0A] via-transparent to-[#2563EB0A]" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          {/* 좌측: 텍스트 콘텐츠 */}
          <div className="flex flex-col gap-8">
            {/* 배지 */}
            <div className="inline-flex w-fit items-center gap-2 rounded-[20px] bg-[#0D6E6E14] px-4 py-2">
              <Shield className="h-4 w-4 text-[#0D6E6E]" />
              <span className="text-sm font-medium text-[#0D6E6E]">
                보담 보험 보상 안내 플랫폼
              </span>
            </div>

            {/* 헤드라인 */}
            <h1
              className="text-5xl font-bold leading-tight text-[#1A1A1A]"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              보험 보상,
              <br />
              보담이 안내해드릴게요
            </h1>

            {/* 서브타이틀 */}
            <p className="text-lg leading-relaxed text-[#666666]">
              복잡한 보험 약관과 보상 절차를 AI가 쉽게 안내해드립니다.
              <br />
              지금 바로 전문적인 보험 보상 안내를 경험해보세요.
            </p>

            {/* CTA 버튼 */}
            <div className="flex flex-wrap gap-4">
              <Link href="/chat">
                <Button
                  size="lg"
                  className="rounded-[8px] bg-[#0D6E6E] px-8 py-6 text-base text-white hover:bg-[#0a5a5a]"
                >
                  <MessageCircle className="mr-2 h-5 w-5" />
                  무료로 시작하기
                </Button>
              </Link>
              <Link href="#how-it-works">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-[8px] border-[#0D6E6E] px-8 py-6 text-base text-[#0D6E6E] hover:bg-[#0D6E6E14]"
                >
                  이용 방법 보기
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
            </div>
          </div>

          {/* 우측: 채팅 미리보기 카드 */}
          <div className="flex justify-center lg:justify-end">
            <div className="w-full max-w-[480px] rounded-[12px] border border-[#E5E5E5] bg-white shadow-xl">
              {/* 카드 헤더 */}
              <div className="flex items-center gap-3 border-b border-[#E5E5E5] px-6 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0D6E6E14]">
                  <Bot className="h-5 w-5 text-[#0D6E6E]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#1A1A1A]">보담 AI 상담사</p>
                  <p className="text-xs text-[#888888]">실시간 보험 보상 안내</p>
                </div>
                <div className="ml-auto flex h-2 w-2 rounded-full bg-green-500" />
              </div>

              {/* 채팅 메시지 */}
              <div className="flex flex-col gap-4 p-6">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {/* 아바타 */}
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                        msg.role === 'bot' ? 'bg-[#0D6E6E14]' : 'bg-[#2563EB14]'
                      }`}
                    >
                      {msg.role === 'bot' ? (
                        <Bot className="h-4 w-4 text-[#0D6E6E]" />
                      ) : (
                        <User className="h-4 w-4 text-[#2563EB]" />
                      )}
                    </div>

                    {/* 말풍선 */}
                    <div
                      className={`max-w-[75%] rounded-[12px] px-4 py-3 text-sm leading-relaxed ${
                        msg.role === 'bot'
                          ? 'bg-[#FAFAFA] text-[#1A1A1A]'
                          : 'bg-[#0D6E6E] text-white'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {/* 입력창 */}
                <div className="mt-2 flex items-center gap-3 rounded-[8px] border border-[#E5E5E5] px-4 py-3">
                  <span className="flex-1 text-sm text-[#888888]">
                    보험 관련 질문을 입력하세요...
                  </span>
                  <ArrowRight className="h-4 w-4 text-[#0D6E6E]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
