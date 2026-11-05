import { BUNDLE_COPY, SCOPE_COPY } from './bundle-copy';
import { ADMIN_COPY } from './copy';
import { REVIEW_COPY } from './review-copy';

// 관리자 화면 사이의 이동 줄을 계산한다 (순수 함수). 이동만 한다: 권한·인증 판정은 각 화면이 자기 서버 응답으로 한다.
// 역할 경계: 검토 담당자(RV)의 화면(검토 대기열 · 묶음 게시)에는 서로로 가는 링크만 있고 규칙 사용 범위 링크가 없다.
// 플랫폼 운영자(PO)의 화면(규칙 사용 범위)에는 자기 링크뿐이고 묶음 게시 링크가 없다. 병원 화면에는 플랫폼 링크가 없다.

export type NavCurrent = 'treatments' | 'review-requests' | 'review-queue' | 'bundles' | 'rule-scope';

export type NavProps = { clinicId: string; current: 'treatments' | 'review-requests' } | { clinicId?: undefined; current: 'review-queue' | 'bundles' | 'rule-scope' };

export interface NavLink {
  key: NavCurrent;
  href: string;
  label: string;
  current: boolean;
}

export function navLinksOf(props: NavProps): NavLink[] {
  if (props.clinicId === undefined) {
    if (props.current === 'rule-scope') return [{ key: 'rule-scope', href: '/admin/rule-scope', label: SCOPE_COPY.navScope, current: true }];
    return [
      { key: 'review-queue', href: '/admin/review-queue', label: REVIEW_COPY.navReviewQueue, current: props.current === 'review-queue' },
      { key: 'bundles', href: '/admin/bundles', label: BUNDLE_COPY.navBundles, current: props.current === 'bundles' },
    ];
  }
  const base = `/admin/${encodeURIComponent(props.clinicId)}`;
  return [
    { key: 'treatments', href: `${base}/treatments`, label: REVIEW_COPY.navTreatments, current: props.current === 'treatments' },
    { key: 'review-requests', href: `${base}/review-requests`, label: REVIEW_COPY.navReviewRequests, current: props.current === 'review-requests' },
  ];
}

/** 이동 줄 오른쪽에 보이는 현재 화면 이름. */
export function navTitleOf(current: NavCurrent): string {
  switch (current) {
    case 'treatments':
      return ADMIN_COPY.title;
    case 'review-requests':
      return REVIEW_COPY.title;
    case 'review-queue':
      return REVIEW_COPY.queueTitle;
    case 'bundles':
      return BUNDLE_COPY.title;
    case 'rule-scope':
      return SCOPE_COPY.title;
  }
}
