import type { ReactElement } from 'react';
import { ADMIN_COPY } from './copy';
import { REVIEW_COPY } from './review-copy';

// 관리자 화면 사이의 작은 이동 줄 (SPEC-REIMBURSEMENT-001 M7 검토 요청). 병원 화면 둘(가격 관리·검토 요청)과 검토 담당자의 대기열 화면이 같이 쓴다.
// 이동만 한다: 권한·인증 판정은 각 화면이 자기 서버 응답으로 한다. 검토 담당자는 병원에 묶이지 않으므로 대기열 화면의 이동 줄에는 병원 id 도 병원 화면 링크도 없다.

export type AdminNavProps = { clinicId: string; current: 'treatments' | 'review-requests' } | { clinicId?: undefined; current: 'review-queue' };

export function AdminNav(props: AdminNavProps): ReactElement {
  if (props.current === 'review-queue') {
    return (
      <nav aria-label={REVIEW_COPY.navLabel} className="admin-nav" data-admin-nav>
        <a className="admin-link" href="/admin/review-queue" aria-current="page">
          {REVIEW_COPY.navReviewQueue}
        </a>
        <span className="admin-nav-title">{REVIEW_COPY.queueTitle}</span>
      </nav>
    );
  }
  const { clinicId, current } = props;
  const base = `/admin/${encodeURIComponent(clinicId)}`;
  return (
    <nav aria-label={REVIEW_COPY.navLabel} className="admin-nav" data-admin-nav>
      <a className="admin-link" href={`${base}/treatments`} {...(current === 'treatments' ? { 'aria-current': 'page' as const } : {})}>
        {REVIEW_COPY.navTreatments}
      </a>
      <a className="admin-link" href={`${base}/review-requests`} {...(current === 'review-requests' ? { 'aria-current': 'page' as const } : {})}>
        {REVIEW_COPY.navReviewRequests}
      </a>
      <span className="admin-nav-title">{current === 'treatments' ? ADMIN_COPY.title : REVIEW_COPY.title}</span>
    </nav>
  );
}
