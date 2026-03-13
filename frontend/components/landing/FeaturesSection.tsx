/**
 * 피처 섹션 - 4개 기능 카드 (보상 안내, 약관 분석, 거절 분석, 보험사 비교)
 */
import { Shield, FileText, AlertTriangle, BarChart3 } from 'lucide-react'

/* 피처 카드 데이터 */
const features = [
  {
    icon: Shield,
    iconBg: '#0D6E6E14',
    iconColor: '#0D6E6E',
    title: '보담 보상 안내',
    description: 'AI가 보험 약관을 분석하여 청구 가능한 보상 항목을 상세하게 안내해드립니다.',
  },
  {
    icon: FileText,
    iconBg: '#0D6E6E14',
    iconColor: '#0D6E6E',
    title: '약관 분석',
    description: '복잡한 보험 약관을 쉬운 언어로 풀어드려, 내 보험의 보장 범위를 명확히 파악할 수 있습니다.',
  },
  {
    icon: AlertTriangle,
    iconBg: '#E07B5414',
    iconColor: '#E07B54',
    title: '거절 분석',
    description: '보험 보상이 거절된 경우, 사유를 분석하고 대응 방안을 제시해드립니다.',
  },
  {
    icon: BarChart3,
    iconBg: '#0D6E6E14',
    iconColor: '#0D6E6E',
    title: '보험사 비교',
    description: '주요 보험사의 약관과 보상 기준을 비교하여 최적의 선택을 도와드립니다.',
  },
]

export default function FeaturesSection() {
  return (
    <section id="features" className="bg-[#FAFAFA] py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6">
        {/* 섹션 헤더 */}
        <div className="mb-16 text-center">
          <p
            className="mb-4 font-mono text-sm font-semibold tracking-widest text-[#0D6E6E]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            FEATURES
          </p>
          <h2
            className="text-4xl font-bold text-[#1A1A1A]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            보험 보상의 모든 것을 한곳에서
          </h2>
        </div>

        {/* 피처 카드 그리드 */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-[12px] border border-[#E5E5E5] bg-white p-6 transition-shadow hover:shadow-md"
            >
              {/* 아이콘 */}
              <div
                className="mb-5 flex h-12 w-12 items-center justify-center rounded-[12px]"
                style={{ backgroundColor: feature.iconBg }}
              >
                <feature.icon
                  className="h-6 w-6"
                  style={{ color: feature.iconColor }}
                />
              </div>

              {/* 타이틀 */}
              <h3
                className="mb-3 text-lg font-bold text-[#1A1A1A]"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {feature.title}
              </h3>

              {/* 설명 */}
              <p className="text-[13px] leading-relaxed text-[#666666]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
