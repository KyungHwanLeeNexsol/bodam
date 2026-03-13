/**
 * 트러스트 섹션 - 신뢰 지표 (보험사, 약관, 보상 사례)
 */

/* 지표 데이터 */
const metrics = [
  {
    value: '10+',
    label: '보험사',
    description: '국내 주요 보험사',
  },
  {
    value: '1,000+',
    label: '약관',
    description: '분석된 보험 약관',
  },
  {
    value: '50,000+',
    label: '보상 사례',
    description: '누적 보상 안내 건수',
  },
]

export default function TrustSection() {
  return (
    <section id="trust" className="bg-[#0D6E6E] py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6">
        {/* 섹션 헤더 */}
        <div className="mb-16 text-center">
          <h2
            className="mb-4 text-3xl font-bold text-white md:text-[32px]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            국내 10대 보험사 약관 데이터 보유
          </h2>
          <p className="text-lg text-white/80">
            신뢰할 수 있는 데이터를 기반으로 정확한 보험 보상 안내를 제공합니다.
          </p>
        </div>

        {/* 지표 그리드 */}
        <div className="grid gap-8 md:grid-cols-3">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="flex flex-col items-center text-center"
            >
              {/* 수치 */}
              <p
                className="mb-2 text-[40px] font-bold text-white"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {metric.value}
              </p>

              {/* 라벨 */}
              <p className="mb-1 text-lg font-semibold text-white/90">
                {metric.label}
              </p>

              {/* 설명 */}
              <p className="text-sm text-white/60">
                {metric.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
