'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { formatSeoulMinute } from '../clock';
import { AdminNav } from './AdminNav';
import { CHANGE_COPY as COPY } from './change-history-copy';
import { actionLabel, describeVersion, outcomeOf, roleLabel, scopeNotice, targetLabel, truncationNotice } from './change-history-model';
import type { HistoryOutcome } from './change-history-model';
import { adminRequest as request } from './transport';

// 변경 이력 화면 (SPEC-REIMBURSEMENT-001 M7 변경 이력). 병원 관리자가 자기 병원의 카탈로그 초안 저장·폐기·게시와 무조작 시간 저장 기록을 최신순으로 읽는다.
// 읽기 전용이다: 수정·삭제·복구 단추가 없고, 서버를 부르는 것은 GET 하나(다시 불러오기 포함)뿐이다. 모든 판정은 서버가 하고 이 화면은 서버가 준 값만 보인다.
// 병원은 서버가 검증한 소속으로 정해진다. 이 화면의 주소에 있는 병원 id 는 위치 정보일 뿐이라 요청에 싣지 않고, 서버가 정한 병원이 주소의 병원과 다르면 이력을 보이지 않는다.
// 이 화면은 "모든 변경 이력"이 아니다 — 다루는 동작의 목록은 서버가 알리고(coveredActions) 화면은 그 목록을 그대로 안내한다. 기록에 없는 과거 값은 짐작해 채우지 않는다.

export function ChangeHistory({ clinicId }: { clinicId: string }): ReactElement {
  // null = 불러오는 중.
  const [outcome, setOutcome] = useState<HistoryOutcome | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await request<unknown>('GET', '/api/admin/audit-log', undefined, controller.signal);
        setOutcome(outcomeOf(result.status, result.body, clinicId));
      } catch {
        if (!controller.signal.aborted) setOutcome({ phase: 'error' });
      }
    })();
    return () => controller.abort();
  }, [clinicId, reloadKey]);

  if (outcome === null) {
    return (
      <main className="admin-root" data-admin-state="loading">
        <p role="status">{COPY.loading}</p>
      </main>
    );
  }

  if (outcome.phase !== 'ready') {
    return (
      <main className="admin-root" data-admin-state={outcome.phase} data-admin-page="change-history">
        <h1 className="admin-title">{COPY.title}</h1>
        <p role="alert" className="admin-banner admin-banner--error">{COPY.failure[outcome.phase]}</p>
        {outcome.phase === 'error' ? (
          <button type="button" className="admin-btn" onClick={() => { setOutcome(null); setReloadKey((key) => key + 1); }}>
            {COPY.retry}
          </button>
        ) : null}
      </main>
    );
  }

  const { data } = outcome;
  const cut = truncationNotice(data.page);

  return (
    <main className="admin-root" data-admin-state="ready" data-admin-page="change-history">
      <header className="admin-header">
        <AdminNav clinicId={clinicId} current="change-history" />
        <h1 className="admin-title">{COPY.title}</h1>
        <p className="admin-sub">{COPY.subtitle}</p>
        <dl className="admin-meta">
          <div>
            <dt>{COPY.clinicLabel}</dt>
            <dd data-admin-clinic>{data.clinic.displayName}</dd>
          </div>
        </dl>
      </header>

      <p className="admin-note" data-admin-changes-scope>{scopeNotice(data.coveredActions)}</p>
      <p className="admin-hint" data-admin-changes-readonly>{COPY.readOnlyNote}</p>
      <p className="admin-hint" data-admin-changes-no-detail>{COPY.noDetailNote}</p>
      {cut !== null ? <p role="status" className="admin-banner" data-admin-changes-truncated>{cut}</p> : null}

      <section aria-labelledby="admin-changes-heading">
        <h2 id="admin-changes-heading" className="admin-h2">{COPY.listTitle}</h2>
        {data.entries.length === 0 ? (
          <p className="admin-banner" data-admin-changes-empty>{COPY.empty}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--changes" data-admin-changes-list data-admin-changes-total={data.page.total}>
              <thead>
                <tr>
                  <th scope="col">{COPY.colSequence}</th>
                  <th scope="col">{COPY.colAt}</th>
                  <th scope="col">{COPY.colActor}</th>
                  <th scope="col">{COPY.colAction}</th>
                  <th scope="col">{COPY.colTarget}</th>
                  <th scope="col">{COPY.colBefore}</th>
                  <th scope="col">{COPY.colAfter}</th>
                  <th scope="col">{COPY.colReason}</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => {
                  const before = describeVersion(entry.action, entry.beforeVersion);
                  const after = describeVersion(entry.action, entry.afterVersion);
                  return (
                    <tr key={entry.sequence} data-admin-changes-row={entry.sequence} data-admin-changes-action={entry.action}>
                      <td className="admin-nowrap">{entry.sequence}</td>
                      <td className="admin-nowrap">{formatSeoulMinute(entry.at)}</td>
                      <td>
                        <span data-admin-changes-actor>{entry.actor.id}</span>
                        <span className="admin-sub2" data-admin-changes-role={entry.actor.role}>{roleLabel(entry.actor.role)}</span>
                      </td>
                      <td><span className="admin-pill admin-pill--plain">{actionLabel(entry.action)}</span></td>
                      <td>
                        <span>{targetLabel(entry.action)}</span>
                        <span className="admin-sub2 admin-mono" data-admin-changes-target>{entry.target}</span>
                      </td>
                      <td>
                        {before.kind === 'none' ? (
                          <span className="admin-status-none" data-admin-changes-before="none">{before.text}</span>
                        ) : (
                          <span className="admin-mono" title={before.full ?? undefined} data-admin-changes-before={before.kind}>{before.text}</span>
                        )}
                      </td>
                      <td>
                        {after.kind === 'none' ? (
                          <span className="admin-status-none" data-admin-changes-after="none">{after.text}</span>
                        ) : (
                          <span className="admin-mono" title={after.full ?? undefined} data-admin-changes-after={after.kind}>{after.text}</span>
                        )}
                      </td>
                      <td>
                        {entry.reason === null ? (
                          <span className="admin-status-none" data-admin-changes-reason="none">{COPY.noReason}</span>
                        ) : (
                          <span className="admin-mono" data-admin-changes-reason>{entry.reason}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
