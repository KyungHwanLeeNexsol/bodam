'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { SessionResponse } from './api-types';
import { AdminNav } from './AdminNav';
import { SETTINGS_COPY as COPY } from './clinic-settings-copy';
import { contactHint, formFromServer, isDirty, isOutcomeUnknown, isSettingsChanged, isSettingsView, nameHint, putBodyOf, saveFailureMessage, serverMatchesForm } from './clinic-settings-model';
import type { FormState } from './clinic-settings-model';
import type { ClinicSettingsView } from './clinic-settings-types';
import { adminRequest as request } from './transport';

// 병원 기본 정보 화면 (SPEC-REIMBURSEMENT-001 M7 병원 설정). 병원 관리자(HA)가 자기 병원의 병원명과 상담번호를 고친다.
//  - 바꿀 수 있는 것은 두 값뿐이다. 서비스 이름("보담")·병원 식별자·slug·종별·현재 카탈로그 버전은 보이기만 하고 입력 칸이 없다(요청 본문에도 담지 않는다).
//  - 서버가 최종 방어선이다: 저장 요청은 이 입력이 근거로 삼은 읽기 응답의 settingsDigest 를 expectedDigest 로 담아 보낸다. 그 사이 다른 창·다른 사람이 저장했으면 서버가 409 CLINIC_SETTINGS_CHANGED 로 거절하고 아무것도 저장하지 않는다.
//    화면은 자동으로 덮어쓰거나 다시 보내지 않는다: 입력을 남긴 채 다른 곳에서 바뀌었다고 알리고, "서버 값 다시 읽기" 를 누르기 전까지 저장 단추를 막는다(같은 낡은 지문으로는 다시 거절될 뿐이다).
//    그 사이 새 카탈로그가 게시된 것은 충돌이 아니다(지문에 카탈로그 버전이 없고, 서버는 방금 읽은 병원 기록에 두 필드만 덮어쓴다).
//  - 저장이 성공하면 서버 값을 다시 읽어 보인다. 응답을 받지 못했거나 서버 오류이면 저장 실패로 단정하지 않고 서버 값을 다시 읽어 입력과 같은지 알린다.
//  - 이미 열려 있는 키오스크 화면에는 닿지 않는다(키오스크 화면을 새로 열 때 catalog 응답으로 병원명을 읽는다). 상담번호는 키오스크에 표시하지 않는다. 접근 판정과 값의 검사는 서버가 한다. 시험 문구이며 최종 안내 문구가 아니다.
//
// 화면 표지(data-*) — 시험이 쓰는 안정된 이름:
//   main[data-admin-state]                loading | unauthenticated | forbidden | notfound | error | ready   (ready 일 때 data-admin-page="settings")
//   [data-admin-nav] / [data-admin-nav-link=settings] / [data-admin-user] / [data-settings-clinic](저장된 병원명)
//   읽기 전용: [data-settings-service] · [data-settings-clinic-id] · [data-settings-slug] · [data-settings-type] · [data-settings-catalog-version]
//   입력: input[data-settings-name] · input[data-settings-contact] · [data-settings-name-hint] · [data-settings-contact-hint]
//   button[data-settings-save] · button[data-settings-reload] · button[data-settings-recheck](결과가 확실하지 않을 때만) · [data-settings-dirty=true|false] · [data-settings-stale](서버가 "그 사이 바뀌었다" 고 거절한 뒤 다시 읽기 전까지만)
//   [data-admin-message=ok|error][data-admin-message-code=SAVED|SAVED_READ_FAILED|CLINIC_SETTINGS_CHANGED|LOST_CONFIRMED|LOST_NOT_SAVED|LOST_UNVERIFIED|RECHECK_FAILED|RELOAD_FAILED|HTTP_<상태>]

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'notfound' | 'error' | 'ready';
type Banner = { kind: 'ok' | 'error'; text: string; code: string };

const settingsPath = (clinicId: string): string => `/api/admin/clinics/${encodeURIComponent(clinicId)}/settings`;

/** 저장·읽기 요청이 이 시간 안에 끝나지 않으면 응답이 끊긴 것으로 보고 서버 값을 다시 읽는 길로 간다(무한히 기다리지 않는다). */
const REQUEST_TIMEOUT_MS = 15_000;

function MessageLine({ message }: { message: Banner }): ReactElement {
  return (
    <p role={message.kind === 'error' ? 'alert' : 'status'} className={`admin-banner admin-banner--${message.kind}`} data-admin-message={message.kind} data-admin-message-code={message.code}>
      {message.text}
    </p>
  );
}

export function ClinicSettings({ clinicId }: { clinicId: string }): ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [viewer, setViewer] = useState<string | null>(null);
  /** 서버에 저장된 값으로 알고 있는 가장 최근 값(저장할 것이 있는지 비교하는 기준). */
  const [view, setView] = useState<ClinicSettingsView | null>(null);
  /** 지금 입력 칸이 근거로 삼은 서버 값. 저장 요청의 expectedDigest 가 이 값의 지문이다. */
  const [formBase, setFormBase] = useState<ClinicSettingsView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  /** 응답을 받지 못한 저장의 입력: 서버 값을 아직 확인하지 못했을 때 "서버 값 다시 확인" 이 이 입력과 비교한다. */
  const [pendingCheck, setPendingCheck] = useState<FormState | null>(null);
  /** 서버가 409 CLINIC_SETTINGS_CHANGED 로 거절한 지문. 입력이 근거로 삼은 지문이 이 값이면 저장할 수 없다(서버 값을 다시 읽어 근거가 바뀌면 저절로 풀린다). */
  const [rejectedDigest, setRejectedDigest] = useState<string | null>(null);
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
        const result = await request<ClinicSettingsView>('GET', settingsPath(clinicId), undefined, signal);
        if (result.status === 401) return setPhase('unauthenticated');
        if (result.status === 403) return setPhase('forbidden');
        if (result.status === 404) return setPhase('notfound');
        if (result.status !== 200) return setPhase('error');
        if (!isSettingsView(result.body)) return setPhase('error');
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
  const fetchView = useCallback(async (): Promise<ClinicSettingsView | null> => {
    try {
      const result = await request<ClinicSettingsView>('GET', settingsPath(clinicId), undefined, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      return result.status === 200 && isSettingsView(result.body) ? result.body : null;
    } catch {
      return null;
    }
  }, [clinicId]);

  /**
   * 서버 값을 화면의 기준으로 삼고 입력도 그 값으로 채운다. 새로 읽은 값 위에서 시작하므로 이전 409 로 막아 둔 표지도 푼다:
   * 서버 지문은 저장 사건이 아니라 상태를 견주므로(A → B → A 는 같은 지문) 지문이 같다고 해서 다시 막으면 사람이 새로 읽고도 저장할 수 없다.
   */
  const adopt = (fresh: ClinicSettingsView): void => {
    setView(fresh);
    setFormBase(fresh);
    setForm(formFromServer(fresh));
    setRejectedDigest(null);
  };

  const save = async (): Promise<void> => {
    if (busy || view === null || form === null || formBase === null || !isDirty(form, view) || rejectedDigest === formBase.settingsDigest) return;
    const submitted = form;
    setBusy(true);
    setMessage(null);
    setPendingCheck(null);
    try {
      let result: Awaited<ReturnType<typeof request<ClinicSettingsView>>> | null = null;
      try {
        result = await request<ClinicSettingsView>('PUT', settingsPath(clinicId), putBodyOf(submitted, formBase), AbortSignal.timeout(REQUEST_TIMEOUT_MS));
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
          // 저장 응답은 성공이지만 다시 읽지 못했다: 저장 응답이 쓸 수 있는 모양이면 그 값을 보인다.
          if (isSettingsView(result.body)) adopt(result.body);
          setMessage({ kind: 'ok', text: COPY.savedReadFailed, code: 'SAVED_READ_FAILED' });
        }
        return;
      }
      if (result !== null && isSettingsChanged(result)) {
        // 다른 곳에서 먼저 저장됐다(서버의 조건부 저장이 거절): 서버의 설정은 그대로이고 입력은 남는다. 자동으로 덮어쓰거나 다시 보내지 않고, 사람이 서버 값을 다시 읽게 한다.
        setRejectedDigest(formBase.settingsDigest);
        setMessage({ kind: 'error', text: saveFailureMessage(result), code: 'CLINIC_SETTINGS_CHANGED' });
        return;
      }
      if (result !== null && !isOutcomeUnknown(result.status)) {
        // 서버가 분명히 거절했다(4xx): 서버의 설정은 그대로이고 입력은 남는다.
        setMessage({ kind: 'error', text: saveFailureMessage(result), code: `HTTP_${result.status}` });
        return;
      }
      // 응답이 없거나 서버 오류: 저장됐는지 단정하지 않고 서버 값을 다시 읽어 입력과 비교한다.
      const fresh = await fetchView();
      if (fresh === null) {
        setPendingCheck(submitted);
        setMessage({ kind: 'error', text: COPY.lostUnverified, code: 'LOST_UNVERIFIED' });
      } else if (serverMatchesForm(fresh, submitted)) {
        adopt(fresh);
        setMessage({ kind: 'ok', text: COPY.lostConfirmed, code: 'LOST_CONFIRMED' });
      } else {
        setView(fresh); // 저장할 것이 있는지의 기준만 서버 값으로 바꾸고 입력과 입력의 근거(formBase)는 그대로 둔다: 다시 저장하면 서버의 조건부 저장이 그 사이의 변경을 가린다.
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
      } else if (serverMatchesForm(fresh, pendingCheck)) {
        // 확인하는 사이에 입력을 더 고쳤으면 그 입력을 지우지 않는다.
        if (form === null || (form.name === pendingCheck.name && form.contact === pendingCheck.contact)) adopt(fresh);
        else {
          setView(fresh);
          setFormBase(fresh);
          setRejectedDigest(null);
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
  const stale = formBase !== null && rejectedDigest === formBase.settingsDigest;
  const nameProblem = nameHint(form);
  const contactProblem = contactHint(form);

  return (
    <main className="admin-root" data-admin-state="ready" data-admin-page="settings">
      <header className="admin-header">
        <AdminNav clinicId={clinicId} current="settings" />
        <h1 className="admin-title">{COPY.title}</h1>
        <p className="admin-sub2">{COPY.clinicLabel}: <span data-settings-clinic>{view.settings.name}</span> · {COPY.sessionAs}: <span data-admin-user>{viewer ?? '-'}</span></p>
        <p className="admin-note" data-settings-note>{COPY.note}</p>
        <p className="admin-note" data-settings-apply-note>{COPY.applyNote}</p>
      </header>

      <section aria-labelledby="settings-readonly-title">
        <h2 id="settings-readonly-title" className="admin-sub2">{COPY.readonlyTitle}</h2>
        <dl className="admin-readonly">
          <dt>{COPY.serviceLabel}</dt>
          <dd>
            <span data-settings-service>{view.serviceDisplayName}</span> <span className="admin-sub2">{COPY.serviceNote}</span>
          </dd>
          <dt>{COPY.clinicIdLabel}</dt>
          <dd data-settings-clinic-id>{view.clinic.id}</dd>
          <dt>{COPY.slugLabel}</dt>
          <dd data-settings-slug>{view.clinic.slug}</dd>
          <dt>{COPY.typeLabel}</dt>
          <dd data-settings-type>{COPY.typeNames[view.clinic.institutionType] ?? view.clinic.institutionType}</dd>
          <dt>{COPY.versionLabel}</dt>
          <dd data-settings-catalog-version>{view.catalogVersion ?? COPY.versionNone}</dd>
        </dl>
      </section>

      <fieldset className="admin-fieldset" data-settings-editable>
        <legend>{COPY.editableTitle}</legend>
        <div className="admin-settings-field">
          <label htmlFor="settings-name">{COPY.nameLabel}</label>
          <input
            id="settings-name"
            className="admin-input admin-input--wide"
            type="text"
            autoComplete="off"
            {...(nameProblem !== null ? { 'aria-invalid': true, 'aria-describedby': 'settings-name-hint' } : { 'aria-describedby': 'settings-name-help' })}
            value={form.name}
            disabled={busy}
            data-settings-name
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <span id="settings-name-help" className="admin-sub2">{COPY.nameHelp}</span>
          {nameProblem !== null ? <span id="settings-name-hint" className="admin-field-error" data-settings-name-hint>{nameProblem}</span> : null}
        </div>
        <div className="admin-settings-field">
          <label htmlFor="settings-contact">{COPY.contactLabel}</label>
          <input
            id="settings-contact"
            className="admin-input admin-input--wide"
            type="text"
            inputMode="tel"
            autoComplete="off"
            {...(contactProblem !== null ? { 'aria-invalid': true, 'aria-describedby': 'settings-contact-hint' } : { 'aria-describedby': 'settings-contact-help' })}
            value={form.contact}
            disabled={busy}
            data-settings-contact
            onChange={(event) => setForm({ ...form, contact: event.target.value })}
          />
          <span id="settings-contact-help" className="admin-sub2">{COPY.contactHelp}</span>
          {contactProblem !== null ? <span id="settings-contact-hint" className="admin-field-error" data-settings-contact-hint>{contactProblem}</span> : null}
        </div>
      </fieldset>

      <div aria-live="polite" className="admin-live" tabIndex={-1} ref={messageRef} data-settings-live>
        {message !== null ? <MessageLine message={message} /> : null}
      </div>

      <div className="admin-actions">
        <button type="button" className="admin-btn admin-btn--primary" disabled={busy || !dirty || stale} data-settings-save onClick={() => void save()}>
          {busy ? COPY.saving : COPY.save}
        </button>
        <button type="button" className="admin-btn" disabled={busy} data-settings-reload onClick={() => void reload()}>
          {COPY.reload}
        </button>
        {pendingCheck !== null ? (
          <button type="button" className="admin-btn" disabled={busy} data-settings-recheck onClick={() => void recheck()}>
            {COPY.recheck}
          </button>
        ) : null}
        <span className="admin-sub2" data-settings-dirty={dirty ? 'true' : 'false'}>{dirty ? COPY.dirtyNote : COPY.cleanNote}</span>
        {stale ? <span className="admin-sub2" data-settings-stale>{COPY.staleNote}</span> : null}
      </div>
    </main>
  );
}
