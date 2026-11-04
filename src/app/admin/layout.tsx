import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './admin.css';

// 관리자 화면 레이아웃 (SPEC-REIMBURSEMENT-001 M7). 병원 직원이 PC 브라우저로 쓰는 화면이며 키오스크와 따로 둔다: 키오스크 화면 어디에도 이 경로로 가는 링크·숨은 입력이 없다(AC-016f).
// 검색에 노출하지 않는다. 문서 응답은 Cache-Control: no-store 이다(next.config.mjs).

export const metadata: Metadata = {
  title: '보담 관리자',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin-shell">{children}</div>;
}
