import type { ReactElement } from 'react';
import { navLinksOf, navTitleOf } from './nav-model';
import type { NavProps } from './nav-model';
import { REVIEW_COPY } from './review-copy';

// 관리자 화면 사이의 작은 이동 줄 (SPEC-REIMBURSEMENT-001 M7). 병원 화면 둘(가격 관리·검토 요청), 검토 담당자 화면 둘(검토 대기열·묶음 게시), 운영자 화면 하나(규칙 사용 범위)가 같이 쓴다.
// 이동만 한다: 권한·인증 판정은 각 화면이 자기 서버 응답으로 한다. 어떤 링크를 보이는지는 순수 함수(nav-model.ts)가 정한다 — 검토 담당자의 줄에는 규칙 사용 범위 링크가 없고
// 운영자의 줄에는 묶음 게시 링크가 없다. 플랫폼 화면은 병원에 묶이지 않으므로 병원 id 도 병원 화면 링크도 없다.

export type AdminNavProps = NavProps;

export function AdminNav(props: AdminNavProps): ReactElement {
  return (
    <nav aria-label={REVIEW_COPY.navLabel} className="admin-nav" data-admin-nav>
      {navLinksOf(props).map((link) => (
        <a key={link.key} className="admin-link" href={link.href} data-admin-nav-link={link.key} {...(link.current ? { 'aria-current': 'page' as const } : {})}>
          {link.label}
        </a>
      ))}
      <span className="admin-nav-title">{navTitleOf(props.current)}</span>
    </nav>
  );
}
