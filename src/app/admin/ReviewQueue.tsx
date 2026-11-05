'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { formatSeoulMinute } from '../clock';
import { AdminNav } from './AdminNav';
import { REVIEW_COPY as COPY } from './review-copy';
import { currentLines, differingFields, proposedLines, statusLabel } from './review-model';
import type { ValueField, ValueLines } from './review-model';
import type { ReviewQueueEntry, ReviewQueueResponse } from './review-types';
import { adminRequest as request } from './transport';

// 검토 대기열 화면 (SPEC-REIMBURSEMENT-001 M7 검토 요청). 검토 담당자(RV)가 모든 병원의 처리 전 검토 요청을 읽는다. 읽기 전용이다.
// 이 화면에는 승인·반려·매핑 같은 처리 동작이 없다(다음 단계). 요청은 제안 기록일 뿐이라 이 화면을 열어도 치료·분류·매핑·규칙·보험금 계산은 바뀌지 않는다.
// 접근 판정과 자료는 /api/admin/review-queue 가 한다: 이 화면은 401·403 응답을 안내로 보일 뿐이고 역할을 스스로 판단하지 않는다.

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'ready';

function ValueBlock({ label, kind, lines, differs }: { label: string; kind: 'current' | 'proposed'; lines: ValueLines | null; differs: readonly ValueField[] }): ReactElement {
  const mark = (field: ValueField): { 'data-differs'?: 'true' } => (kind === 'proposed' && differs.includes(field) ? { 'data-differs': 'true' } : {});
  return (
    <div className="admin-queue-values" data-admin-queue-values={kind}>
      <span className="admin-sub2">{label}</span>
      {lines === null ? (
        <span data-admin-queue-not-published>{COPY.notInPublished}</span>
      ) : (
        <dl className="admin-queue-lines">
          <div {...mark('benefitType')}>
            <dt>{COPY.fieldBenefitShort}</dt>
            <dd data-admin-queue-field="benefit">{lines.benefit}</dd>
          </div>
          <div {...mark('procedureCodes')}>
            <dt>{COPY.fieldProcedureShort}</dt>
            <dd data-admin-queue-field="procedures">{lines.procedures}</dd>
          </div>
          <div {...mark('calcClass')}>
            <dt>{COPY.fieldCalcClassShort}</dt>
            <dd data-admin-queue-field="calcClass">{lines.calcClass}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

export function ReviewQueue(): ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [queue, setQueue] = useState<ReviewQueueEntry[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const result = await request<ReviewQueueResponse>('GET', '/api/admin/review-queue', undefined, signal);
        if (result.status === 401) return setPhase('unauthenticated');
        if (result.status === 403) return setPhase('forbidden');
        if (result.status !== 200) return setPhase('error');
        setQueue((result.body as ReviewQueueResponse).queue);
        setPhase('ready');
      } catch {
        if (!signal.aborted) setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

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
        <h1 className="admin-title">{COPY.queueTitle}</h1>
        <p role="alert" className="admin-banner admin-banner--error">
          {phase === 'unauthenticated' ? COPY.queueUnauthenticated : phase === 'forbidden' ? COPY.queueForbidden : COPY.loadFailed}
        </p>
        {phase === 'error' ? (
          <button type="button" className="admin-btn" onClick={() => { setPhase('loading'); setReloadKey((key) => key + 1); }}>
            {COPY.retry}
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <main className="admin-root" data-admin-state="ready" data-admin-page="review-queue">
      <header className="admin-header">
        <AdminNav current="review-queue" />
        <h1 className="admin-title">{COPY.queueTitle}</h1>
        <p className="admin-note" data-admin-queue-note>{COPY.queueNote}</p>
      </header>

      {queue.length === 0 ? (
        <p className="admin-banner" data-admin-queue-empty>{COPY.queueEmpty}</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-table--queue" data-admin-queue-list>
            <thead>
              <tr>
                <th scope="col">{COPY.colClinic}</th>
                <th scope="col">{COPY.colTreatment}</th>
                <th scope="col">{COPY.colRequestedAt}</th>
                <th scope="col">{COPY.colRequestedBy}</th>
                <th scope="col">{COPY.colResult}</th>
                <th scope="col">{COPY.colValues}</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((entry) => {
                const differs = differingFields(entry.current, entry.proposed);
                return (
                  <tr key={entry.id} data-admin-queue-row={entry.id}>
                    <td data-admin-queue-clinic>{entry.clinic.name}</td>
                    <th scope="row"><span className="admin-name" data-admin-queue-treatment>{entry.treatmentName ?? entry.treatmentId}</span></th>
                    <td className="admin-nowrap" data-admin-queue-requested-at>{formatSeoulMinute(entry.requestedAt)}</td>
                    <td data-admin-queue-requester>{entry.requestedBy}</td>
                    <td className="admin-nowrap"><span className="admin-pill" data-admin-queue-status={entry.status}>{statusLabel(entry)}</span></td>
                    <td>
                      <ValueBlock label={COPY.currentLabel} kind="current" lines={currentLines(entry.current)} differs={differs} />
                      <ValueBlock label={COPY.proposedLabel} kind="proposed" lines={proposedLines(entry.proposed)} differs={differs} />
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
