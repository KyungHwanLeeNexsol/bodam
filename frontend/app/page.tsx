/**
 * 보담 랜딩 페이지
 * 히어로, 피처, 이용방법, 트러스트, CTA 섹션으로 구성
 */
import Header from '@/components/landing/Header'
import HeroSection from '@/components/landing/HeroSection'
import FeaturesSection from '@/components/landing/FeaturesSection'
import HowItWorksSection from '@/components/landing/HowItWorksSection'
import TrustSection from '@/components/landing/TrustSection'
import CTASection from '@/components/landing/CTASection'
import Footer from '@/components/landing/Footer'

export default function HomePage() {
  return (
    <main>
      <Header />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <TrustSection />
      <CTASection />
      <Footer />
    </main>
  )
}
