import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = '보담 - AI 보험 보상 안내 플랫폼'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(150deg, #F8FAFC 0%, #EEF2FF 50%, #F0F9FF 100%)',
          position: 'relative',
          overflow: 'hidden',
          padding: '0 100px',
          gap: 32,
        }}
      >
        {/* 데코 원 1 */}
        <div
          style={{
            position: 'absolute',
            width: 380,
            height: 380,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #2563EB12 0%, transparent 100%)',
            top: -100,
            right: 850 - 1200 + 380,
          }}
        />
        {/* 데코 원 2 */}
        <div
          style={{
            position: 'absolute',
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #4F46E510 0%, transparent 100%)',
            bottom: -80,
            left: -80,
          }}
        />
        {/* 데코 원 3 */}
        <div
          style={{
            position: 'absolute',
            width: 200,
            height: 200,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #10B98110 0%, transparent 100%)',
            bottom: 100,
            left: 500,
          }}
        />
        {/* 하단 accent 바 */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: 1200,
            height: 6,
            background: 'linear-gradient(90deg, #2563EB 0%, #4F46E5 50%, #10B981 100%)',
          }}
        />

        {/* 로고 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: 18,
              background: 'linear-gradient(180deg, #2563EB 0%, #4F46E5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* 방패 SVG */}
            <svg width="40" height="42" viewBox="0 0 20 22" fill="none">
              <path
                d="M10 1L2 5v6c0 5.25 3.4 10.15 8 11.35C14.6 21.15 18 16.25 18 11V5L10 1z"
                fill="white"
              />
            </svg>
          </div>
          <span
            style={{
              fontFamily: 'sans-serif',
              fontSize: 48,
              fontWeight: 700,
              background: 'linear-gradient(90deg, #2563EB 0%, #4F46E5 100%)',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            보담
          </span>
        </div>

        {/* 타이틀 */}
        <div
          style={{
            fontFamily: 'serif',
            fontSize: 52,
            fontWeight: 700,
            color: '#1A1A1A',
            textAlign: 'center',
            lineHeight: 1.2,
          }}
        >
          보험 보상, 보담이 안내해드릴게요
        </div>

        {/* 서브타이틀 */}
        <div
          style={{
            fontFamily: 'sans-serif',
            fontSize: 22,
            fontWeight: 400,
            color: '#666666',
            textAlign: 'center',
          }}
        >
          AI 기반 보험 약관 분석으로 정확한 보상 안내를 받아보세요
        </div>
      </div>
    ),
    { ...size }
  )
}
