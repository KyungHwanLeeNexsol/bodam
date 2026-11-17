import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './kiosk/styles/tokens.css';
import './kiosk/styles/fonts.css';
import './kiosk/styles/kiosk.css';
import './kiosk/styles/inputs.css';
import './kiosk/styles/results.css';
import './kiosk/styles/sheets.css';

// 루트 레이아웃 (SPEC-REIMBURSEMENT-001 M6, BRIEF D1·D6·D7). 한국어 문서이고, 전역 스타일은 키오스크 변수·글꼴·규칙 세 파일이다.
// 검색 노출을 막는다: 병원 안에서만 쓰는 화면이다.

export const metadata: Metadata = {
  title: '보담 · 실손보험 예상 부담액 안내',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
