'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { SessionResponse } from './api-types';
import { BUNDLE_COPY, SCOPE_COPY } from './bundle-copy';
import { ADMIN_COPY as COPY } from './copy';
import { IDLE_COPY } from './idle-policy-copy';
import { REVIEW_COPY } from './review-copy';
import { adminRequest } from './transport';

// 관리자 입구 (SPEC-REIMBURSEMENT-001 M7): 서버가 검증한 신원의 소속 병원 가운데 병원 관리자(HA) 소속만 가격 관리로 이어 준다.
// 인증이 없으면(운영 구성은 공급자가 연결되기 전까지 항상) 안내만 보이고 어떤 기능도 열리지 않는다.

type State = { kind: 'loading' } | { kind: 'unauthenticated' } | { kind: 'error' } | { kind: 'ready'; session: SessionResponse };

export function AdminHome(): ReactElement {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await adminRequest<SessionResponse>('GET', '/api/admin/session', undefined, controller.signal);
        if (result.status === 401) return setState({ kind: 'unauthenticated' });
        if (result.status !== 200) return setState({ kind: 'error' });
        setState({ kind: 'ready', session: result.body as SessionResponse });
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, []);

  if (state.kind === 'loading') {
    return (
      <main className="admin-root" data-admin-state="loading">
        <p role="status">{COPY.loading}</p>
      </main>
    );
  }
  if (state.kind !== 'ready') {
    return (
      <main className="admin-root" data-admin-state={state.kind}>
        <h1 className="admin-title">보담 관리자</h1>
        <p role="alert" className="admin-banner admin-banner--error">{state.kind === 'unauthenticated' ? COPY.unauthenticated : COPY.loadFailed}</p>
      </main>
    );
  }
  const clinics = state.session.memberships.filter((membership) => membership.role === 'HA' && membership.clinicId !== null);
  // 검토 담당자(RV)는 병원에 묶이지 않는 소속(clinicId null)만 대기열로 이어 준다. 병원에 묶인 RV 소속은 서버가 대기열을 거절하므로 링크를 만들지 않는다.
  const isReviewer = state.session.memberships.some((membership) => membership.role === 'RV' && membership.clinicId === null);
  // 플랫폼 운영자(PO)도 병원에 묶이지 않는 소속만 규칙 사용 범위로 이어 준다. 검토 담당자에게는 지정 링크가, 운영자에게는 게시 링크가 없다(링크는 안내일 뿐 서버가 같은 역할을 다시 본다).
  const isOperator = state.session.memberships.some((membership) => membership.role === 'PO' && membership.clinicId === null);
  return (
    <main className="admin-root" data-admin-state="ready">
      <h1 className="admin-title">보담 관리자</h1>
      <p className="admin-sub">{COPY.sessionAs}: <span data-admin-user>{state.session.userId}</span></p>
      {clinics.length === 0 && !isReviewer && !isOperator ? (
        <p className="admin-banner">{COPY.forbidden}</p>
      ) : (
        <ul className="admin-history">
          {clinics.map((membership) => {
            const base = `/admin/${encodeURIComponent(membership.clinicId as string)}`;
            return (
              <li key={membership.clinicId}>
                <a className="admin-link" href={`${base}/treatments`}>{COPY.title} — {membership.clinicId}</a>
                {' · '}
                <a className="admin-link" href={`${base}/review-requests`}>{REVIEW_COPY.navReviewRequests} — {membership.clinicId}</a>
                {' · '}
                <a className="admin-link" href={`${base}/idle-policy`}>{IDLE_COPY.navIdlePolicy} — {membership.clinicId}</a>
              </li>
            );
          })}
          {isReviewer ? (
            <li>
              <a className="admin-link" href="/admin/review-queue">{REVIEW_COPY.navReviewQueue}</a>
              {' · '}
              <a className="admin-link" href="/admin/bundles">{BUNDLE_COPY.navBundles}</a>
            </li>
          ) : null}
          {isOperator ? (
            <li>
              <a className="admin-link" href="/admin/rule-scope">{SCOPE_COPY.navScope}</a>
            </li>
          ) : null}
        </ul>
      )}
    </main>
  );
}
