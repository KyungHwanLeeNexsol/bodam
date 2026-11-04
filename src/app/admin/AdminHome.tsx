'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { SessionResponse } from './api-types';
import { ADMIN_COPY as COPY } from './copy';
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
  return (
    <main className="admin-root" data-admin-state="ready">
      <h1 className="admin-title">보담 관리자</h1>
      <p className="admin-sub">{COPY.sessionAs}: <span data-admin-user>{state.session.userId}</span></p>
      {clinics.length === 0 ? (
        <p className="admin-banner">{COPY.forbidden}</p>
      ) : (
        <ul className="admin-history">
          {clinics.map((membership) => (
            <li key={membership.clinicId}>
              <a className="admin-link" href={`/admin/${encodeURIComponent(membership.clinicId as string)}/treatments`}>{COPY.title} — {membership.clinicId}</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
