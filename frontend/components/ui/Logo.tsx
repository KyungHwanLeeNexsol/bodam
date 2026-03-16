'use client'

import { Shield } from 'lucide-react'

interface LogoProps {
  /** true면 흰색 텍스트 버전 (Footer용) */
  white?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const sizeMap = {
  sm: { mark: 28, icon: 16, radius: 8, text: 18, gap: 8 },
  md: { mark: 36, icon: 20, radius: 10, text: 24, gap: 10 },
  lg: { mark: 44, icon: 24, radius: 12, text: 30, gap: 12 },
}

export default function Logo({ white = false, size = 'md' }: LogoProps) {
  const s = sizeMap[size]

  return (
    <div className="flex items-center" style={{ gap: s.gap }}>
      {/* Logo Mark */}
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: s.mark,
          height: s.mark,
          borderRadius: s.radius,
          background: white
            ? 'linear-gradient(180deg, #3B82F6 0%, #6366F1 100%)'
            : 'linear-gradient(180deg, #2563EB 0%, #4F46E5 100%)',
        }}
      >
        <Shield
          style={{ width: s.icon, height: s.icon }}
          className="text-white"
          strokeWidth={2.5}
        />
      </div>

      {/* Logo Wordmark */}
      <span
        className="font-bold leading-none"
        style={{
          fontFamily: 'Pretendard, sans-serif',
          fontSize: s.text,
          ...(white
            ? { color: '#FFFFFF' }
            : {
                background: 'linear-gradient(90deg, #2563EB 0%, #4F46E5 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }),
        }}
      >
        보담
      </span>
    </div>
  )
}
