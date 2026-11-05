import { describe, expect, it } from 'vitest';
import { BUNDLE_COPY, SCOPE_COPY } from '../../src/app/admin/bundle-copy';
import { navLinksOf, navTitleOf } from '../../src/app/admin/nav-model';
import { REVIEW_COPY } from '../../src/app/admin/review-copy';
import { ADMIN_COPY } from '../../src/app/admin/copy';

// 관리자 이동 줄의 순수 계산. 이동만 한다: 권한 판정은 각 화면이 자기 서버 응답으로 한다.
// 역할 경계: 검토 담당자(RV)의 줄에는 지정(규칙 사용 범위) 링크가 없고, 플랫폼 운영자(PO)의 줄에는 게시(묶음 게시) 링크가 없다.

describe('이동 줄 링크', () => {
  it('검토 대기열 화면과 묶음 게시 화면은 같은 두 링크(검토 대기열 ↔ 묶음 게시)를 보이고 현재 화면에 표시가 붙는다', () => {
    for (const current of ['review-queue', 'bundles'] as const) {
      const links = navLinksOf({ current });
      expect(links.map((link) => link.href)).toEqual(['/admin/review-queue', '/admin/bundles']);
      expect(links.map((link) => link.label)).toEqual([REVIEW_COPY.navReviewQueue, BUNDLE_COPY.navBundles]);
      expect(links.filter((link) => link.current).map((link) => link.href)).toEqual([current === 'review-queue' ? '/admin/review-queue' : '/admin/bundles']);
    }
  });

  it('규칙 사용 범위 화면(PO)은 자기 링크 하나뿐이다: 묶음 게시·검토 대기열 링크가 없다', () => {
    const links = navLinksOf({ current: 'rule-scope' });
    expect(links).toEqual([{ key: 'rule-scope', href: '/admin/rule-scope', label: SCOPE_COPY.navScope, current: true }]);
  });

  it('검토 담당자의 줄 어디에도 규칙 사용 범위 링크가 없고, 운영자의 줄 어디에도 묶음 게시 링크가 없다', () => {
    for (const current of ['review-queue', 'bundles'] as const) {
      expect(navLinksOf({ current }).map((link) => link.href)).not.toContain('/admin/rule-scope');
    }
    expect(navLinksOf({ current: 'rule-scope' }).map((link) => link.href)).not.toContain('/admin/bundles');
  });

  it('병원 화면의 줄은 지금처럼 병원 id 가 붙은 두 링크(가격 관리 · 검토 요청)이고 플랫폼 링크가 없다', () => {
    const links = navLinksOf({ clinicId: 'TEST_FIXTURE_CLINIC_1', current: 'review-requests' });
    expect(links.map((link) => link.href)).toEqual(['/admin/TEST_FIXTURE_CLINIC_1/treatments', '/admin/TEST_FIXTURE_CLINIC_1/review-requests']);
    expect(links.map((link) => link.label)).toEqual([REVIEW_COPY.navTreatments, REVIEW_COPY.navReviewRequests]);
    expect(links.filter((link) => link.current).map((link) => link.key)).toEqual(['review-requests']);
    expect(links.map((link) => link.href).join()).not.toMatch(/bundles|rule-scope|review-queue/);
  });

  it('병원 id 는 주소 조각으로 안전하게 바뀐다', () => {
    expect(navLinksOf({ clinicId: 'a b/c', current: 'treatments' })[0]!.href).toBe('/admin/a%20b%2Fc/treatments');
  });
});

describe('이동 줄 제목', () => {
  it('현재 화면의 이름을 보인다', () => {
    expect(navTitleOf('review-queue')).toBe(REVIEW_COPY.queueTitle);
    expect(navTitleOf('bundles')).toBe(BUNDLE_COPY.title);
    expect(navTitleOf('rule-scope')).toBe(SCOPE_COPY.title);
    expect(navTitleOf('treatments')).toBe(ADMIN_COPY.title);
    expect(navTitleOf('review-requests')).toBe(REVIEW_COPY.title);
  });
});
