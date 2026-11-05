'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { SessionResponse } from './api-types';
import { AdminNav } from './AdminNav';
import { IDLE_COPY as COPY, IDLE_SCREEN_LABEL } from './idle-policy-copy';
import { editRow, formFromServer, holdHint, isDirty, isOutcomeUnknown, isPolicyView, requestBodyOf, revertRow, rowHint, sameServerSettings, saveFailureMessage, serverMatchesBody, setHoldEnabled, setHoldText } from './idle-policy-model';
import type { FormState } from './idle-policy-model';
import { IDLE_SCREEN_KINDS } from './idle-policy-types';
import type { IdlePolicyBody, IdlePolicyView } from './idle-policy-types';
import { adminRequest as request } from './transport';

// 병원 무조작 정책 화면 (SPEC-REIMBURSEMENT-001 M7 병원별 무조작 정책 설정). 병원 관리자(HA)가 자기 병원의 화면 종류별 경고·초기화 시간과 이용 완료 화면의 자동 복귀 시간을 고친다.
//  - 저장은 정책 전체를 바꾼다(PUT): 직접 설정한 화면 종류만 본문에 담고, 기본값을 따르는 종류는 담지 않는다(서버가 기본값으로 읽는다). 일부만 고쳐도 다른 설정을 잃지 않는다(idle-policy-model.ts).
//  - 저장이 성공하면 서버 값을 다시 읽어 보인다. 응답을 받지 못했거나 서버 오류이면 저장 실패로 단정하지 않고 서버 값을 다시 읽어 입력과 같은지 알린다.
//  - 저장 직전에 서버 값을 다시 읽어 이 화면이 근거로 삼은 값과 같은지 본다: 다른 창·다른 사람이 그 사이 저장했으면 아무것도 저장하지 않고 서버 값을 다시 보인다(PUT 이 전체 교체라 낡은 화면이 다른 설정을 지우지 않게 한다).
//    서버에 저장 시각·버전 비교(expectedDigest)가 없어 읽기와 저장 사이의 아주 짧은 틈은 남는다.
//  - 이미 열려 있는 키오스크 세션에는 닿지 않는다(키오스크 화면을 새로 열 때 catalog 응답으로 읽는다). 접근 판정과 값의 검사는 서버가 한다. 시험 문구이며 최종 안내 문구가 아니다.
//
// 화면 표지(data-*) — 시험이 쓰는 안정된 이름:
//   main[data-admin-state]                loading | unauthenticated | forbidden | notfound | error | ready   (ready 일 때 data-admin-page="idle-policy")
//   [data-admin-nav] / [data-admin-nav-link=idle-policy] / [data-admin-user]
//   tr[data-idle-row=<화면 종류>] 안: input[data-idle-warn=<종류>] · input[data-idle-reset=<종류>] · [data-idle-source=<종류>][data-idle-source-kind=default|custom] · [data-idle-default=<종류>] · button[data-idle-revert=<종류>] · [data-idle-hint=<종류>]
//   input[data-idle-hold-enabled] · input[data-idle-hold-seconds] · [data-idle-hold-state] · [data-idle-hold-hint]
//   button[data-idle-save] · button[data-idle-reload] · button[data-idle-recheck](결과가 확실하지 않을 때만) · [data-idle-dirty=true|false]
//   [data-admin-message=ok|error][data-admin-message-code=SAVED|SAVED_READ_FAILED|SERVER_CHANGED|PRECHECK_FAILED|LOST_CONFIRMED|LOST_NOT_SAVED|LOST_UNVERIFIED|RECHECK_FAILED|HTTP_<상태>]

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'notfound' | 'error' | 'ready';
type Banner = { kind: 'ok' | 'error'; text: string; code: string };

const policyPath = (clinicId: string): string => `/api/admin/clinics/${encodeURIComponent(clinicId)}/idle-policy`;

/** 저장·읽기 요청이 이 시간 안에 끝나지 않으면 응답이 끊긴 것으로 보고 서버 값을 다시 읽는 길로 간다(무한히 기다리지 않는다). */
const REQUEST_TIMEOUT_MS = 15_000;

function MessageLine({ message }: { message: Banner }): ReactElement {
  return (
    <p role={message.kind === 'error' ? 'alert' : 'status'} className={`admin-banner admin-banner--${message.kind}`} data-admin-message={message.kind} data-admin-message-code={message.code}>
      {message.text}
    </p>
  );
}

export function IdlePolicy({ clinicId }: { clinicId: string }): ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [viewer, setViewer] = useState<string | null>(null);
  /** 서버에 저장된 값으로 알고 있는 가장 최근 값(저장할 것이 있는지 비교하는 기준). */
  const [view, setView] = useState<IdlePolicyView | null>(null);
  /** 지금 입력 칸이 근거로 삼은 서버 값. 저장 직전에 서버 값이 이것과 다르면 화면이 낡은 것이다. */
  const [formBase, setFormBase] = useState<IdlePolicyView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  /** 응답을 받지 못한 저장의 본문: 서버 값을 아직 확인하지 못했을 때 "서버 값 다시 확인" 이 이 본문과 비교한다. */
  const [pendingCheck, setPendingCheck] = useState<IdlePolicyBody | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const messageRef = useRef<HTMLDivElement | null>(null);

  // 결과 안내가 나타나면 초점을 그 영역으로 옮긴다: 저장·확인 단추가 눌린 뒤 비활성이 되어도 키보드·화면 낭독 사용자가 자리를 잃지 않는다.
  useEffect(() => {
    if (message !== null) messageRef.current?.focus();
  }, [message]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const sessionResult = await request<SessionResponse>('GET', '/api/admin/session', undefined, signal);
        if (sessionResult.status === 200) setViewer((sessionResult.body as SessionResponse).userId);
        const result = await request<IdlePolicyView>('GET', policyPath(clinicId), undefined, signal);
        if (result.status === 401) return setPhase('unauthenticated');
        if (result.status === 403) return setPhase('forbidden');
        if (result.status === 404) return setPhase('notfound');
        if (result.status !== 200) return setPhase('error');
        if (!isPolicyView(result.body)) return setPhase('error');
        const loaded = result.body;
        setView(loaded);
        setFormBase(loaded);
        setForm(formFromServer(loaded));
        setPhase('ready');
      } catch {
        if (!signal.aborted) setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [clinicId, reloadKey]);

  /** 서버에 저장된 값을 읽는다. 읽지 못하면(응답 없음·200 이 아님) null 이고 화면은 그대로다. */
  const fetchView = useCallback(async (): Promise<IdlePolicyView | null> => {
    try {
      const result = await request<IdlePolicyView>('GET', policyPath(clinicId), undefined, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      return result.status === 200 && isPolicyView(result.body) ? result.body : null;
    } catch {
      return null;
    }
  }, [clinicId]);

  /** 서버 값을 화면의 기준으로 삼고 입력도 그 값으로 채운다. */
  const adopt = (fresh: IdlePolicyView): void => {
    setView(fresh);
    setFormBase(fresh);
    setForm(formFromServer(fresh));
  };

  const save = async (): Promise<void> => {
    if (busy || view === null || form === null || formBase === null || !isDirty(form, view)) return;
    const body = requestBodyOf(form);
    setBusy(true);
    setMessage(null);
    setPendingCheck(null);
    try {
      // 저장 직전 확인: 이 화면이 근거로 삼은 서버 값이 그대로일 때만 저장한다. PUT 은 전체 교체라 낡은 화면으로 저장하면 그 사이 다른 곳에서 저장된 설정이 지워진다.
      const current = await fetchView();
      if (current === null) {
        setMessage({ kind: 'error', text: COPY.precheckFailed, code: 'PRECHECK_FAILED' });
        return;
      }
      if (!sameServerSettings(current, formBase)) {
        adopt(current);
        setMessage({ kind: 'error', text: COPY.serverChanged, code: 'SERVER_CHANGED' });
        return;
      }
      let result: Awaited<ReturnType<typeof request<IdlePolicyView>>> | null = null;
      try {
        result = await request<IdlePolicyView>('PUT', policyPath(clinicId), body, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      } catch {
        result = null; // 응답이 끊겼다: 서버가 저장했는지 알 수 없다.
      }
      if (result !== null && result.status === 200) {
        // 저장 성공: 저장 응답을 믿고 끝내지 않고 서버 값을 다시 읽어 보인다.
        const fresh = await fetchView();
        if (fresh !== null) {
          adopt(fresh);
          setMessage({ kind: 'ok', text: COPY.saved, code: 'SAVED' });
        } else {
          // 저장 응답은 성공이지만 다시 읽지 못했다: 저장 응답이 쓸 수 있는 모양이면 그 값을, 아니면 입력을 그대로 두고 알린다.
          if (isPolicyView(result.body)) adopt(result.body);
          setMessage({ kind: 'ok', text: COPY.savedReadFailed, code: 'SAVED_READ_FAILED' });
        }
        return;
      }
      if (result !== null && !isOutcomeUnknown(result.status)) {
        // 서버가 분명히 거절했다(4xx): 서버의 설정은 그대로이고 입력은 남는다.
        setMessage({ kind: 'error', text: saveFailureMessage(result, view.minLeadSeconds), code: `HTTP_${result.status}` });
        return;
      }
      // 응답이 없거나 서버 오류: 저장됐는지 단정하지 않고 서버 값을 다시 읽어 입력과 비교한다.
      const fresh = await fetchView();
      if (fresh === null) {
        setPendingCheck(body);
        setMessage({ kind: 'error', text: COPY.lostUnverified, code: 'LOST_UNVERIFIED' });
      } else if (serverMatchesBody(fresh, body)) {
        adopt(fresh);
        setMessage({ kind: 'ok', text: COPY.lostConfirmed, code: 'LOST_CONFIRMED' });
      } else {
        setView(fresh); // 저장할 것이 있는지의 기준만 서버 값으로 바꾸고 입력과 입력의 근거(formBase)는 그대로 둔다: 다시 저장하면 저장 직전 확인이 그 사이의 변경을 가린다.
        setMessage({ kind: 'error', text: COPY.lostNotSaved, code: 'LOST_NOT_SAVED' });
      }
    } finally {
      setBusy(false);
    }
  };

  /** 서버 값을 확인하지 못한 저장을 다시 확인한다. */
  const recheck = async (): Promise<void> => {
    if (busy || pendingCheck === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const fresh = await fetchView();
      if (fresh === null) {
        setMessage({ kind: 'error', text: COPY.recheckFailed, code: 'RECHECK_FAILED' });
      } else if (serverMatchesBody(fresh, pendingCheck)) {
        // 확인하는 사이에 입력을 더 고쳤으면 그 입력을 지우지 않는다(서버는 이미 보낸 본문과 같으므로 그 위에서 고친 것이다).
        if (form === null || JSON.stringify(requestBodyOf(form)) === JSON.stringify(pendingCheck)) adopt(fresh);
        else {
          setView(fresh);
          setFormBase(fresh);
        }
        setPendingCheck(null);
        setMessage({ kind: 'ok', text: COPY.lostConfirmed, code: 'LOST_CONFIRMED' });
      } else {
        setView(fresh);
        setPendingCheck(null);
        setMessage({ kind: 'error', text: COPY.lostNotSaved, code: 'LOST_NOT_SAVED' });
      }
    } finally {
      setBusy(false);
    }
  };

  /** 저장하지 않은 입력을 버리고 서버 값을 다시 읽는다. */
  const reload = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const fresh = await fetchView();
      if (fresh === null) {
        setMessage({ kind: 'error', text: COPY.loadFailed, code: 'RELOAD_FAILED' });
      } else {
        adopt(fresh);
        setPendingCheck(null);
      }
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
  if (phase !== 'ready' || view === null || form === null) {
    return (
      <main className="admin-root" data-admin-state={phase}>
        <h1 className="admin-title">{COPY.title}</h1>
        <p role="alert" className="admin-banner admin-banner--error">
          {phase === 'unauthenticated' ? COPY.unauthenticated : phase === 'forbidden' ? COPY.forbidden : phase === 'notfound' ? COPY.notFound : COPY.loadFailed}
        </p>
        {phase === 'error' ? (
          <button type="button" className="admin-btn" onClick={() => { setPhase('loading'); setReloadKey((key) => key + 1); }}>
            {COPY.retry}
          </button>
        ) : null}
      </main>
    );
  }

  const dirty = isDirty(form, view);
  const holdProblem = holdHint(form);
  const holdSeconds = view.idlePolicy.completionHoldSeconds;

  return (
    <main className="admin-root" data-admin-state="ready" data-admin-page="idle-policy">
      <header className="admin-header">
        <AdminNav clinicId={clinicId} current="idle-policy" />
        <h1 className="admin-title">{COPY.title}</h1>
        <p className="admin-sub2">{COPY.clinicLabel}: <span data-idle-clinic>{view.clinic.displayName}</span> · {COPY.sessionAs}: <span data-admin-user>{viewer ?? '-'}</span></p>
        <p className="admin-note" data-idle-note>{COPY.note}</p>
        <p className="admin-note" data-idle-apply-note>{COPY.applyNote}</p>
        <p className="admin-note" data-idle-replace-note>{COPY.replaceNote}</p>
      </header>

      <div className="admin-table-wrap">
        <table className="admin-table admin-table--idle">
          <caption className="admin-sub2">{COPY.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{COPY.colScreen}</th>
              <th scope="col">{COPY.colWarn}</th>
              <th scope="col">{COPY.colReset}</th>
              <th scope="col">{COPY.colSource}</th>
              <th scope="col">{COPY.colControls}</th>
            </tr>
          </thead>
          <tbody>
            {IDLE_SCREEN_KINDS.map((kind) => {
              const row = form.rows[kind];
              const label = IDLE_SCREEN_LABEL[kind];
              const hint = row.useDefault ? null : rowHint(row, view.minLeadSeconds);
              const base = view.defaults[kind];
              const hintId = `idle-hint-${kind}`;
              return (
                <tr key={kind} data-idle-row={kind}>
                  <th scope="row">
                    <span className="admin-name">{label.name}</span>
                    <span className="admin-sub2">{label.detail}</span>
                  </th>
                  <td>
                    <input
                      className="admin-input admin-input--seconds"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={COPY.warnLabel(label.name)}
                      {...(hint !== null ? { 'aria-invalid': true, 'aria-describedby': hintId } : {})}
                      value={row.warn}
                      disabled={busy}
                      data-idle-warn={kind}
                      onChange={(event) => setForm(editRow(form, kind, 'warn', event.target.value, formBase ?? view))}
                    />
                  </td>
                  <td>
                    <input
                      className="admin-input admin-input--seconds"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={COPY.resetLabel(label.name)}
                      {...(hint !== null ? { 'aria-invalid': true, 'aria-describedby': hintId } : {})}
                      value={row.reset}
                      disabled={busy}
                      data-idle-reset={kind}
                      onChange={(event) => setForm(editRow(form, kind, 'reset', event.target.value, formBase ?? view))}
                    />
                    {hint !== null ? <span id={hintId} className="admin-field-error" data-idle-hint={kind}>{hint}</span> : null}
                  </td>
                  <td>
                    <span className={`admin-pill${row.useDefault ? ' admin-pill--plain' : ''}`} data-idle-source={kind} data-idle-source-kind={row.useDefault ? 'default' : 'custom'}>
                      {row.useDefault ? COPY.sourceDefault : COPY.sourceCustom}
                    </span>
                    <span className="admin-sub2" data-idle-default={kind}>{COPY.defaultLine(base.warnSeconds, base.resetSeconds)}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn--small"
                      aria-label={COPY.revertDefaultLabel(label.name)}
                      disabled={busy || row.useDefault}
                      data-idle-revert={kind}
                      onClick={() => setForm(revertRow(form, kind, view.defaults))}
                    >
                      {COPY.revertDefault}
                    </button>
                    {row.useDefault && view.customizedScreens.includes(kind) ? <span className="admin-sub2" data-idle-reverted={kind}>{COPY.revertedNote}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <fieldset className="admin-fieldset" data-idle-hold>
        <legend>{COPY.holdTitle}</legend>
        <p className="admin-note">{COPY.holdNote}</p>
        <div className="admin-idle-hold-row">
          <label className="admin-check">
            <input type="checkbox" checked={form.holdEnabled} disabled={busy} data-idle-hold-enabled onChange={(event) => setForm(setHoldEnabled(form, event.target.checked))} />
            <span>{COPY.holdToggle}</span>
          </label>
          <label className="admin-check">
            <span>{COPY.holdSeconds}</span>
            <input
              className="admin-input admin-input--seconds"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              {...(holdProblem !== null ? { 'aria-invalid': true, 'aria-describedby': 'idle-hold-hint' } : {})}
              value={form.holdText}
              disabled={busy || !form.holdEnabled}
              data-idle-hold-seconds
              onChange={(event) => setForm(setHoldText(form, event.target.value))}
            />
          </label>
        </div>
        {holdProblem !== null ? <span id="idle-hold-hint" className="admin-field-error" data-idle-hold-hint>{holdProblem}</span> : null}
        <p className="admin-sub2" data-idle-hold-state>{holdSeconds === null ? COPY.holdOffState : COPY.holdOnState(holdSeconds)}</p>
      </fieldset>

      <div aria-live="polite" className="admin-live" tabIndex={-1} ref={messageRef} data-idle-live>
        {message !== null ? <MessageLine message={message} /> : null}
      </div>

      <div className="admin-actions">
        <button type="button" className="admin-btn admin-btn--primary" disabled={busy || !dirty} data-idle-save onClick={() => void save()}>
          {busy ? COPY.saving : COPY.save}
        </button>
        <button type="button" className="admin-btn" disabled={busy} data-idle-reload onClick={() => void reload()}>
          {COPY.reload}
        </button>
        {pendingCheck !== null ? (
          <button type="button" className="admin-btn" disabled={busy} data-idle-recheck onClick={() => void recheck()}>
            {COPY.recheck}
          </button>
        ) : null}
        <span className="admin-sub2" data-idle-dirty={dirty ? 'true' : 'false'}>{dirty ? COPY.dirtyNote : COPY.cleanNote}</span>
      </div>
    </main>
  );
}
