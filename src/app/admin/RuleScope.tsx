'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { SessionResponse } from './api-types';
import { AdminNav } from './AdminNav';
import { SCOPE_COPY as COPY } from './bundle-copy';
import { failureCodeOf } from './bundle-model';
import type { BundleSummary, ClinicScopeRow, RuleScopeAssignResponse, RuleScopeOverview } from './bundle-types';
import { applyAssigned, assignRequestOf, assignedMessage, bundleOptions, confirmStateOf, currentView, reconcileDrafts, scopeFailureMessage, setDraft } from './scope-model';
import type { Drafts } from './scope-model';
import { adminRequest as request } from './transport';

// 규칙 사용 범위 화면 (SPEC-REIMBURSEMENT-001 M7 묶음 구성). 플랫폼 운영자(PO)가 병원마다 어떤 규칙 묶음으로 계산할지 지정한다.
// 병원 한 곳씩만 바꾼다: 병원 줄마다 자기 확인 단추가 있고, 모든 병원에 한꺼번에 적용하는 조작은 없다. 이 화면에는 묶음을 게시하는 조작이 없다(게시는 검토 담당자의 일이다).
// 요청에는 화면이 불러온 그 병원의 현재 적용본(없으면 null)을 함께 보낸다. 그 사이 다른 곳에서 바뀌었으면 서버가 거절하고(SCOPE_CHANGED) 이 화면은 전체를 다시 불러온다.
// 접근 판정과 모든 규칙은 서버가 한다. 이 화면은 401·403 응답을 안내로 보인다. 시험 문구이며 최종 안내 문구가 아니다.
//
// 화면 표지(data-*) — 시험이 쓰는 안정된 이름:
//   main[data-admin-state]                loading | unauthenticated | forbidden | error | ready   (ready 일 때 data-admin-page="rule-scope")
//   [data-admin-nav] / [data-admin-nav-link=rule-scope] / [data-admin-user]
//   [data-admin-scope-empty]              병원이 없을 때 / [data-admin-scope-no-bundles] 게시된 묶음이 없을 때
//   tr[data-admin-scope-row=<병원 id>][data-admin-scope-current=<현재 묶음 id 또는 빈 문자열>] 안:
//        [data-admin-scope-clinic], [data-admin-scope-current-bundle=<전체 묶음 id>](지정된 묶음이 없으면 없다), [data-admin-scope-current-none], [data-admin-scope-current-status=ACTIVE|SUSPENDED|UNKNOWN],
//        [data-admin-scope-assigned], select[data-admin-scope-select=<병원 id>] (option[value]·disabled), [data-admin-scope-change](현재 X → 바꿀 Y), [data-admin-scope-hint],
//        button[data-admin-scope-confirm=<병원 id>]
//   [data-admin-message=ok|error][data-admin-message-code=ASSIGNED|SCOPE_CHANGED|…|HTTP_<상태>][data-admin-message-clinic=<병원 id>]   병원이 정해진 결과는 그 병원 줄 안에, 그 밖은 위 aria-live 영역에 보인다

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'ready';
type Banner = { kind: 'ok' | 'error'; text: string; code: string; clinicId: string | null };

function MessageLine({ message }: { message: Banner }): ReactElement {
  return (
    <p
      role={message.kind === 'error' ? 'alert' : 'status'}
      className={`admin-banner admin-banner--${message.kind}`}
      data-admin-message={message.kind}
      data-admin-message-code={message.code}
      {...(message.clinicId !== null ? { 'data-admin-message-clinic': message.clinicId } : {})}
    >
      {message.text}
    </p>
  );
}

export function RuleScope(): ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [viewer, setViewer] = useState<string | null>(null);
  const [rows, setRows] = useState<ClinicScopeRow[]>([]);
  const [bundles, setBundles] = useState<BundleSummary[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [message, setMessage] = useState<Banner | null>(null);
  const [busyClinic, setBusyClinic] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const sessionResult = await request<SessionResponse>('GET', '/api/admin/session', undefined, signal);
        if (sessionResult.status === 200) setViewer((sessionResult.body as SessionResponse).userId);
        const result = await request<RuleScopeOverview>('GET', '/api/admin/rule-scope', undefined, signal);
        if (result.status === 401) return setPhase('unauthenticated');
        if (result.status === 403) return setPhase('forbidden');
        if (result.status !== 200) return setPhase('error');
        const loaded = result.body as RuleScopeOverview;
        setRows(loaded.clinics);
        setBundles(loaded.bundles);
        setPhase('ready');
      } catch {
        if (!signal.aborted) setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  /** 서버의 현재 병원별 범위와 묶음 목록을 다시 읽는다. 읽지 못하면 null 이고 화면은 그대로다. */
  const load = useCallback(async (): Promise<RuleScopeOverview | null> => {
    try {
      const result = await request<RuleScopeOverview>('GET', '/api/admin/rule-scope');
      return result.status === 200 ? (result.body as RuleScopeOverview) : null;
    } catch {
      return null;
    }
  }, []);

  /** 이 병원 한 곳의 지정. 성공하면 응답의 병원 줄 하나만 바뀐다. 화면이 본 값이 틀렸다는 거절(409)과 없음(404)은 전체를 다시 불러온다. */
  const assign = async (row: ClinicScopeRow): Promise<void> => {
    const body = assignRequestOf(row, drafts[row.clinicId] ?? '', bundles);
    if (body === null || busyClinic !== null) return;
    setBusyClinic(row.clinicId);
    setMessage(null);
    try {
      const result = await request<RuleScopeAssignResponse>('POST', `/api/admin/rule-scope/clinics/${encodeURIComponent(row.clinicId)}`, body);
      if (result.status === 200) {
        const updated = (result.body as RuleScopeAssignResponse).clinic;
        setRows((current) => applyAssigned(current, updated));
        setDrafts((current) => setDraft(current, row.clinicId, ''));
        setMessage({ kind: 'ok', text: assignedMessage(updated.displayName, body.ruleBundleVersionId), code: 'ASSIGNED', clinicId: row.clinicId });
        return;
      }
      setMessage({ kind: 'error', text: scopeFailureMessage(result), code: failureCodeOf(result), clinicId: row.clinicId });
      if (result.status === 409 || result.status === 404) {
        const next = await load();
        if (next !== null) {
          setDrafts((current) => reconcileDrafts(current, rows, next.clinics, next.bundles, [row.clinicId]));
          setRows(next.clinics);
          setBundles(next.bundles);
        }
      }
    } catch {
      setMessage({ kind: 'error', text: scopeFailureMessage({ status: 500, body: { error: 'INTERNAL' } }), code: 'HTTP_500', clinicId: row.clinicId });
    } finally {
      setBusyClinic(null);
    }
  };

  if (phase === 'loading') {
    return (
      <main className="admin-root" data-admin-state="loading">
        <p role="status">{COPY.loading}</p>
      </main>
    );
  }
  if (phase !== 'ready') {
    return (
      <main className="admin-root" data-admin-state={phase}>
        <h1 className="admin-title">{COPY.title}</h1>
        <p role="alert" className="admin-banner admin-banner--error">
          {phase === 'unauthenticated' ? COPY.unauthenticated : phase === 'forbidden' ? COPY.forbidden : COPY.loadFailed}
        </p>
        {phase === 'error' ? (
          <button type="button" className="admin-btn" onClick={() => { setPhase('loading'); setReloadKey((key) => key + 1); }}>
            {COPY.retry}
          </button>
        ) : null}
      </main>
    );
  }

  const options = bundleOptions(bundles);
  const inRow = message !== null && message.clinicId !== null && rows.some((row) => row.clinicId === message.clinicId);
  const topMessage = message !== null && !inRow ? message : null;

  return (
    <main className="admin-root" data-admin-state="ready" data-admin-page="rule-scope">
      <header className="admin-header">
        <AdminNav current="rule-scope" />
        <h1 className="admin-title">{COPY.title}</h1>
        <p className="admin-note" data-admin-scope-note>{COPY.note}</p>
        <p className="admin-sub2">{COPY.sessionAs}: <span data-admin-user>{viewer ?? '-'}</span></p>
      </header>

      <div aria-live="polite" className="admin-live">
        {topMessage !== null ? <MessageLine message={topMessage} /> : null}
      </div>

      {bundles.length === 0 ? <p className="admin-banner" data-admin-scope-no-bundles>{COPY.bundlesEmpty}</p> : null}

      {rows.length === 0 ? (
        <p className="admin-banner" data-admin-scope-empty>{COPY.empty}</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-table--scope">
            <thead>
              <tr>
                <th scope="col">{COPY.colClinic}</th>
                <th scope="col">{COPY.colCurrent}</th>
                <th scope="col">{COPY.colChange}</th>
                <th scope="col">{COPY.colApply}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const current = currentView(row);
                const selectedId = drafts[row.clinicId] ?? '';
                const confirm = confirmStateOf(row, selectedId, bundles);
                const mine = message !== null && message.clinicId === row.clinicId ? message : null;
                const busy = busyClinic !== null;
                return (
                  <tr key={row.clinicId} data-admin-scope-row={row.clinicId} data-admin-scope-current={current.bundleId ?? ''}>
                    <th scope="row">
                      <span className="admin-name" data-admin-scope-clinic>{row.displayName}</span>
                      <span className="admin-sub2">{row.slug}</span>
                    </th>
                    <td>
                      {current.bundleId === null ? (
                        <span data-admin-scope-current-none>{current.text}</span>
                      ) : (
                        <>
                          <span className="admin-name" title={current.bundleId} data-admin-scope-current-bundle={current.bundleId}>{current.text}</span>
                          <span className={`admin-pill${current.status === 'ACTIVE' ? '' : ' admin-pill--hidden'}`} data-admin-scope-current-status={current.status ?? 'UNKNOWN'}>{current.statusText}</span>
                          <span className="admin-sub2" data-admin-scope-assigned>{current.assignedText}</span>
                          {current.note !== null ? <span className="admin-bundle-warning" data-admin-scope-current-note>{current.note}</span> : null}
                        </>
                      )}
                    </td>
                    <td>
                      <select
                        className="admin-select"
                        aria-label={COPY.selectLabel(row.displayName)}
                        value={selectedId}
                        disabled={busy}
                        data-admin-scope-select={row.clinicId}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDrafts((currentDrafts) => setDraft(currentDrafts, row.clinicId, value));
                          if (message !== null && message.clinicId === row.clinicId) setMessage(null);
                        }}
                      >
                        <option value="">{COPY.optionNone}</option>
                        {options.map((option) => (
                          <option key={option.value} value={option.value} disabled={option.disabled} data-admin-scope-option-status={option.status ?? 'UNKNOWN'}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {confirm.line !== null ? <span className="admin-bundle-change" data-admin-scope-change>{confirm.line}</span> : null}
                    </td>
                    <td>
                      <button type="button" className="admin-btn admin-btn--primary admin-btn--small" aria-label={COPY.confirmLabel(row.displayName)} disabled={!confirm.enabled || busy} data-admin-scope-confirm={row.clinicId} onClick={() => void assign(row)}>
                        {busyClinic === row.clinicId ? COPY.busy : COPY.confirmButton}
                      </button>
                      {confirm.hint !== null ? <span className="admin-sub2" data-admin-scope-hint>{confirm.hint}</span> : null}
                      {mine !== null ? <MessageLine message={mine} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
