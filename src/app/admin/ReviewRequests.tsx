'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { formatSeoulMinute } from '../clock';
import type { SessionResponse, TreatmentsResponse } from './api-types';
import { AdminNav } from './AdminNav';
import { REVIEW_COPY as COPY } from './review-copy';
import { haClassificationNotice } from './mapping-model';
import { CALC_CLASS_CHOICES, benefitLabel, calcClassLabel, codesToText, hasOpenRequest, initialReviewForm, latestByTreatment, requestBodyOf, reviewFailureMessage, statusLabel } from './review-model';
import type { ReviewForm } from './review-model';
import type { CalcClass, ReviewRequestView, ReviewRequestsResponse, SubmitResponse } from './review-types';
import { adminRequest as request } from './transport';

// 보장 검토 요청 화면 (SPEC-REIMBURSEMENT-001 M7 검토 요청). 병원 관리자가 자기 병원의 게시된 치료에 대해 검토를 요청하고, 요청의 처리 상태를 읽는다.
// 요청은 제안 기록일 뿐이다: 이 화면은 치료·분류·매핑·가격을 바꾸지 않고, 승인·반려·매핑 같은 처리 동작을 두지 않는다(상태는 읽기만 한다).
// 모든 처리는 /api/admin/** 가 하고 이 화면은 서버가 준 값만 보인다. 인증·권한 판정은 서버가 하고, 이 화면은 401·403 응답을 안내로 보일 뿐이다.

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'ready';
type Banner = { kind: 'ok' | 'error'; text: string };

export function ReviewRequests({ clinicId }: { clinicId: string }): ReactElement {
  const base = `/api/admin/clinics/${encodeURIComponent(clinicId)}`;
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [data, setData] = useState<TreatmentsResponse | null>(null);
  const [requests, setRequests] = useState<ReviewRequestView[]>([]);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [calcMissing, setCalcMissing] = useState(false);
  const [message, setMessage] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const sessionResult = await request<SessionResponse>('GET', '/api/admin/session', undefined, signal);
        if (sessionResult.status === 401) return setPhase('unauthenticated');
        if (sessionResult.status !== 200) return setPhase('error');
        setSession(sessionResult.body as SessionResponse);
        const list = await request<TreatmentsResponse>('GET', `${base}/treatments`, undefined, signal);
        if (list.status === 401) return setPhase('unauthenticated');
        if (list.status === 403) return setPhase('forbidden');
        if (list.status !== 200) return setPhase('error');
        const sentResult = await request<ReviewRequestsResponse>('GET', `${base}/review-requests`, undefined, signal);
        if (sentResult.status === 401) return setPhase('unauthenticated');
        if (sentResult.status === 403) return setPhase('forbidden');
        if (sentResult.status !== 200) return setPhase('error');
        setData(list.body as TreatmentsResponse);
        setRequests((sentResult.body as ReviewRequestsResponse).reviewRequests);
        setPhase('ready');
      } catch {
        if (!signal.aborted) setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [base, reloadKey]);

  /** 서버의 현재 상태(치료 목록과 요청 목록)를 다시 읽는다. 읽지 못해도 화면의 입력은 건드리지 않는다. */
  const refresh = useCallback(async () => {
    const list = await request<TreatmentsResponse>('GET', `${base}/treatments`);
    if (list.status === 200) setData(list.body as TreatmentsResponse);
    const sentResult = await request<ReviewRequestsResponse>('GET', `${base}/review-requests`);
    if (sentResult.status === 200) setRequests((sentResult.body as ReviewRequestsResponse).reviewRequests);
  }, [base]);

  const treatments = data?.treatments ?? [];
  const latest = useMemo(() => latestByTreatment(requests), [requests]);

  const openForm = (treatmentId: string): void => {
    const treatment = treatments.find((entry) => entry.treatmentId === treatmentId);
    if (treatment === undefined) return;
    setOpenFor(treatmentId);
    setForm(initialReviewForm(treatment));
    setCalcMissing(false);
    setMessage(null);
  };

  const closeForm = (): void => {
    setOpenFor(null);
    setForm(null);
    setCalcMissing(false);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (openFor === null || form === null || busy) return;
    const built = requestBodyOf(form);
    if (!built.ok) {
      setCalcMissing(true);
      return;
    }
    setCalcMissing(false);
    setBusy(true);
    setMessage(null);
    try {
      const result = await request<SubmitResponse>('POST', `${base}/treatments/${encodeURIComponent(openFor)}/review-requests`, built.body);
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: reviewFailureMessage(result) });
        // 이미 열린 요청이 있다는 거절(409)이나 그 사이 숨겨져 더는 게시 목록에 없는 치료라는 거절(400)이면 화면의 상태도 서버와 맞춘다. 입력한 내용은 그대로 둔다.
        if (result.status === 409 || result.status === 400) await refresh();
        return;
      }
      closeForm();
      await refresh();
      setMessage({ kind: 'ok', text: COPY.sent });
    } catch {
      setMessage({ kind: 'error', text: reviewFailureMessage({ status: 500, body: { error: 'INTERNAL' } }) });
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'loading') {
    return (
      <main className="admin-root" data-admin-state="loading">
        <p role="status">{COPY.loading}</p>
      </main>
    );
  }
  if (phase === 'unauthenticated' || phase === 'forbidden' || phase === 'error') {
    return (
      <main className="admin-root" data-admin-state={phase}>
        <h1 className="admin-title">{COPY.title}</h1>
        <p role="alert" className="admin-banner admin-banner--error">
          {phase === 'unauthenticated' ? COPY.unauthenticated : phase === 'forbidden' ? COPY.forbiddenClinic : COPY.loadFailed}
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
    <main className="admin-root" data-admin-state="ready" data-admin-page="review-requests">
      <header className="admin-header">
        <AdminNav clinicId={clinicId} current="review-requests" />
        <h1 className="admin-title">{COPY.title}</h1>
        <p className="admin-sub">{COPY.subtitle}</p>
        <dl className="admin-meta">
          <div>
            <dt>{COPY.clinicLabel}</dt>
            <dd data-admin-clinic>{data?.clinic.displayName}</dd>
          </div>
          <div>
            <dt>{COPY.sessionAs}</dt>
            <dd data-admin-user>{session?.userId}</dd>
          </div>
        </dl>
      </header>

      <p className="admin-note" data-admin-review-note>{COPY.proposalNote}</p>

      <div aria-live="polite" className="admin-live">
        {message !== null ? (
          <p role={message.kind === 'error' ? 'alert' : 'status'} className={`admin-banner admin-banner--${message.kind}`} data-admin-message={message.kind}>
            {message.text}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="admin-review-list-heading">
        <h2 id="admin-review-list-heading" className="admin-h2">{COPY.listTitle}</h2>
        {treatments.length === 0 ? (
          <p className="admin-banner">{COPY.emptyList}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--review" data-admin-review-list>
              <thead>
                <tr>
                  <th scope="col">{COPY.colTreatment}</th>
                  <th scope="col">{COPY.colBenefit}</th>
                  <th scope="col">{COPY.colTreatmentCode}</th>
                  <th scope="col">{COPY.colProcedure}</th>
                  <th scope="col">{COPY.colStatus}</th>
                  <th scope="col">{COPY.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {treatments.map((treatment) => {
                  const current = latest.get(treatment.treatmentId);
                  const blocked = hasOpenRequest(current);
                  const formOpen = openFor === treatment.treatmentId && form !== null;
                  return (
                    <Fragment key={treatment.treatmentId}>
                      <tr data-admin-review-row={treatment.treatmentId}>
                        <th scope="row"><span className="admin-name">{treatment.displayName}</span></th>
                        <td className="admin-nowrap">{benefitLabel(treatment.benefitType)}</td>
                        <td>{treatment.treatmentCode}</td>
                        <td>{treatment.procedureCodes.length === 0 ? COPY.noProcedure : codesToText(treatment.procedureCodes)}</td>
                        <td>
                          <span className="admin-pill admin-pill--wrap" data-admin-review-status={current === undefined ? 'NONE' : current.status}>{statusLabel(current)}</span>
                          {current !== undefined && current.status === 'REJECTED' && current.rejectionReason !== null ? (
                            <span className="admin-sub2" data-admin-review-reason>{COPY.rejectionReasonLabel}: {current.rejectionReason}</span>
                          ) : null}
                          {current !== undefined && haClassificationNotice(current) !== null ? (
                            <span className="admin-sub2" data-admin-review-classification={current.classification}>{haClassificationNotice(current)}</span>
                          ) : null}
                        </td>
                        <td>
                          <div className="admin-controls">
                            <button
                              type="button"
                              className="admin-btn admin-btn--small"
                              aria-label={COPY.openFormLabel(treatment.displayName)}
                              disabled={busy || blocked}
                              onClick={() => openForm(treatment.treatmentId)}
                            >
                              {COPY.openForm}
                            </button>
                            {blocked ? <span className="admin-status-none" data-admin-review-blocked>{COPY.openRequestBlocked}</span> : null}
                          </div>
                        </td>
                      </tr>
                      {formOpen ? (
                        <tr data-admin-review-form-row={treatment.treatmentId}>
                          <td colSpan={6}>
                            <form onSubmit={(event) => void submit(event)} data-admin-review-form={treatment.treatmentId} aria-label={COPY.formTitle(treatment.displayName)}>
                              <fieldset className="admin-fieldset">
                                <legend>{COPY.formTitle(treatment.displayName)}</legend>
                                <label className="admin-label">
                                  {COPY.fieldBenefit}
                                  <select
                                    className="admin-select"
                                    value={form.benefitType}
                                    onChange={(event) => setForm({ ...form, benefitType: event.target.value === 'BENEFIT' ? 'BENEFIT' : 'NON_BENEFIT' })}
                                  >
                                    <option value="BENEFIT">{COPY.benefit}</option>
                                    <option value="NON_BENEFIT">{COPY.nonBenefit}</option>
                                  </select>
                                </label>
                                <label className="admin-label">
                                  {COPY.fieldProcedure}
                                  <input className="admin-input admin-input--text" autoComplete="off" value={form.codesText} onChange={(event) => setForm({ ...form, codesText: event.target.value })} />
                                </label>
                                <div className="admin-field">
                                  <label className="admin-label">
                                    {COPY.fieldCalcClass}
                                    <select
                                      className="admin-select"
                                      value={form.calcClass}
                                      aria-invalid={calcMissing}
                                      onChange={(event) => {
                                        setCalcMissing(false);
                                        setForm({ ...form, calcClass: event.target.value as CalcClass | '' });
                                      }}
                                    >
                                      <option value="">{COPY.calcClassPlaceholder}</option>
                                      {CALC_CLASS_CHOICES.map((choice) => (
                                        <option key={choice.code} value={choice.code}>{choice.label}</option>
                                      ))}
                                    </select>
                                  </label>
                                  {calcMissing ? <span role="alert" className="admin-field-error">{COPY.calcClassRequired}</span> : null}
                                </div>
                                <p className="admin-hint">{COPY.formHint}</p>
                                <div className="admin-actions">
                                  <button type="submit" className="admin-btn admin-btn--primary" disabled={busy}>{busy ? COPY.sending : COPY.submit}</button>
                                  <button type="button" className="admin-btn" disabled={busy} onClick={closeForm}>{COPY.closeForm}</button>
                                </div>
                              </fieldset>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="admin-review-sent-heading">
        <h2 id="admin-review-sent-heading" className="admin-h2">{COPY.historyTitle}</h2>
        {requests.length === 0 ? (
          <p className="admin-hint" data-admin-review-sent-empty>{COPY.historyNone}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-review-sent>
              <thead>
                <tr>
                  <th scope="col">{COPY.colRequestedAt}</th>
                  <th scope="col">{COPY.colTreatment}</th>
                  <th scope="col">{COPY.colProposed}</th>
                  <th scope="col">{COPY.colResult}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((entry) => (
                  <tr key={entry.id} data-admin-review-sent-item={entry.id}>
                    <td className="admin-nowrap">{formatSeoulMinute(entry.requestedAt)}</td>
                    <td>{entry.treatmentName ?? entry.treatmentId}</td>
                    <td>
                      {COPY.proposedLine(
                        benefitLabel(entry.proposed.benefitType),
                        entry.proposed.procedureCodes.length === 0 ? COPY.noProcedure : codesToText(entry.proposed.procedureCodes),
                        calcClassLabel(entry.proposed.calcClass),
                      )}
                    </td>
                    <td>
                      <span className="admin-pill admin-pill--wrap" data-admin-review-sent-status={entry.status}>{statusLabel(entry)}</span>
                      {entry.status === 'REJECTED' && entry.rejectionReason !== null ? (
                        <span className="admin-sub2" data-admin-review-sent-reason>{COPY.rejectionReasonLabel}: {entry.rejectionReason}</span>
                      ) : null}
                      {haClassificationNotice(entry) !== null ? (
                        <span className="admin-sub2" data-admin-review-sent-classification={entry.classification}>{haClassificationNotice(entry)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
