/**
 * How It Works 섹션 - 3단계 이용 방법
 */

/* 단계 데이터 */
const steps = [
  {
    number: '1',
    title: '질문 입력',
    description: '보험 관련 궁금한 점이나 보상 청구에 대한 상황을 자유롭게 입력하세요.',
  },
  {
    number: '2',
    title: 'AI 분석',
    description: '보담 AI가 약관 데이터베이스를 분석하여 맞춤형 보상 안내를 제공합니다.',
  },
  {
    number: '3',
    title: '보상 청구',
    description: '상세한 안내에 따라 필요한 서류를 준비하고 정확하게 보상을 청구하세요.',
  },
]

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6">
        {/* 섹션 헤더 */}
        <div className="mb-16 text-center">
          <p
            className="mb-4 font-mono text-sm font-semibold tracking-widest text-[#0D6E6E]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            HOW IT WORKS
          </p>
          <h2
            className="text-4xl font-bold text-[#1A1A1A]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            간단한 3단계로 시작하세요
          </h2>
        </div>

        {/* 단계 목록 */}
        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((step, idx) => (
            <div key={step.number} className="relative flex flex-col items-center text-center">
              {/* 연결선 (마지막 단계 제외) */}
              {idx < steps.length - 1 && (
                <div className="absolute left-[calc(50%+36px)] top-7 hidden h-px w-[calc(100%-72px)] bg-[#E5E5E5] md:block" />
              )}

              {/* 단계 번호 원 */}
              <div
                className="mb-6 flex h-[56px] w-[56px] items-center justify-center rounded-[28px] bg-[#0D6E6E] text-xl font-bold text-white shadow-lg"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {step.number}
              </div>

              {/* 타이틀 */}
              <h3
                className="mb-3 text-xl font-bold text-[#1A1A1A]"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {step.title}
              </h3>

              {/* 설명 */}
              <p className="text-sm leading-relaxed text-[#666666]">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
