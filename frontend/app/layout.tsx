import type { Metadata } from 'next'
import { Inter, Newsreader, JetBrains_Mono } from 'next/font/google'
import { AuthProvider } from '@/contexts/AuthContext'
import './globals.css'

/* 본문 폰트 - Inter */
const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

/* 헤딩 폰트 - Newsreader (serif) */
const newsreader = Newsreader({
  variable: '--font-heading',
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
})

/* 모노스페이스 폰트 - JetBrains Mono (배지, 라벨용) */
const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: '보담 - AI 보험 보상 안내 플랫폼',
  description:
    '보담은 AI를 활용한 보험 보상 안내 플랫폼으로, 복잡한 보험 약관을 쉽게 이해하고 정확한 보상 청구를 도와드립니다.',
  keywords: ['보험', '보상', 'AI', '약관', '보험청구', '보담'],
  openGraph: {
    title: '보담 - AI 보험 보상 안내 플랫폼',
    description: '복잡한 보험 약관을 쉽게 이해하고 정확한 보상 청구를 받으세요.',
    locale: 'ko_KR',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko">
      <body
        className={`${inter.variable} ${newsreader.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
