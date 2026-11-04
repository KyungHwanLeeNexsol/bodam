'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { formatSeoulMinute } from '../clock';
import type { ApiFailure, CatalogVersionRow, OptionsResponse, PreviewResponse, SessionResponse, TreatmentsResponse } from './api-types';
import { ADMIN_COPY as COPY } from './copy';
import { EMPTY_ADD_FORM, appendAddition, bodyOfDraft, buildAddition, draftBodyOf, isEmptyBody, moveRow, nextDraftKey, previewSelection, removeAddition, restoreWorking, rowViews, sameBody, summaryOf, toggleHidden } from './draft-model';
import type { AddError, AddField, AddForm, WorkingState } from './draft-model';
import { failureMessage } from './failure-message';
import type { FailureKind } from './failure-message';
import { adminRequest as request } from './transport';

// 치료 관리 화면 (SPEC-REIMBURSEMENT-001 M7, 디자인 A02 치료 목록·A03 치료 수정·A04 게시 미리보기).
// 가격 수정 · 새 치료 추가 · 숨기기 · 표시 순서 → 초안 저장 → 미리보기 → 게시. 모든 처리는 /api/admin/** 가 하고 이 화면은 서버가 준 값만 보인다(보험금·한도·공제·보장 분류를 화면에서 계산하거나 정하지 않는다).
// 권한·인증 판정은 서버가 한다: 이 화면은 401·403 응답을 안내로 보일 뿐 자기 판단으로 기능을 열지 않는다.
// 화면이 들고 있는 것은 "원하는 초안 전체"(draft-model.ts 의 WorkingState)다. 세션 값(입력 중인 가격·새 치료 입력칸·미리보기 결과)은 화면 안에만 있고 저장소·주소·분석으로 내보내지 않는다.

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'ready';
type Banner = { kind: 'ok' | 'error'; text: string };

const won = (value: number): string => `${value.toLocaleString('ko-KR')}${COPY.priceUnit}`;
const money = (value: number | null): string => (value === null ? COPY.needsCheck : won(value));
const benefitLabel = (type: string): string => (type === 'BENEFIT' ? COPY.benefit : COPY.nonBenefit);

function TextField(props: { label: string; value: string; onChange: (value: string) => void; error: AddError | undefined; inputMode?: 'numeric'; placeholder?: string }): ReactElement {
  return (
    <div className="admin-field">
      <label className="admin-label">
        {props.label}
        <input
          className="admin-input admin-input--text"
          autoComplete="off"
          value={props.value}
          aria-invalid={props.error !== undefined}
          onChange={(event) => props.onChange(event.target.value)}
          {...(props.inputMode === undefined ? {} : { inputMode: props.inputMode })}
          {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
        />
      </label>
      {props.error !== undefined ? <span role="alert" className="admin-field-error">{COPY.addErrors[props.error]}</span> : null}
    </div>
  );
}

const EMPTY_WORKING: WorkingState = { priceTexts: {}, hidden: [], additions: [], rowOrder: [] };

export function TreatmentPrices({ clinicId }: { clinicId: string }): ReactElement {
  const base = `/api/admin/clinics/${encodeURIComponent(clinicId)}`;
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [data, setData] = useState<TreatmentsResponse | null>(null);
  const [versions, setVersions] = useState<CatalogVersionRow[]>([]);
  const [working, setWorking] = useState<WorkingState>(EMPTY_WORKING);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [condition, setCondition] = useState({ generation: '', insurerType: '', cause: '' });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [message, setMessage] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<AddForm>(EMPTY_ADD_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<AddField, AddError>>>({});
  const [addStatus, setAddStatus] = useState<Banner | null>(null);

  /** 서버가 준 데이터로 화면 상태를 다시 세운다: 초안이 있으면 초안의 값, 없으면 게시된 값. */
  const adopt = useCallback((next: TreatmentsResponse) => {
    setData(next);
    setWorking(restoreWorking(next.treatments, next.draft));
  }, []);

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
        const body = list.body as TreatmentsResponse;
        adopt(body);
        const versionsResult = await request<{ versions: CatalogVersionRow[] }>('GET', `${base}/catalog/versions`, undefined, signal);
        if (versionsResult.status === 200) setVersions((versionsResult.body as { versions: CatalogVersionRow[] }).versions);
        // 미리보기 조건의 선택지는 공개 options 응답(서버가 정한 카드)을 그대로 쓴다. 화면에 세대·보험사 형태 목록을 적어 두지 않는다.
        const optionsResult = await request<OptionsResponse>('GET', `/api/clinics/${encodeURIComponent(body.clinic.slug)}/insurance/options`, undefined, signal);
        if (optionsResult.status === 200) {
          const loaded = optionsResult.body as OptionsResponse;
          setOptions(loaded);
          setCondition((current) => (current.generation === '' ? { generation: loaded.generations.at(-1)?.code ?? '', insurerType: loaded.insurerTypes[0]?.code ?? '', cause: loaded.causes.at(-1)?.code ?? '' } : current));
        }
        setPhase('ready');
      } catch {
        if (!signal.aborted) setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [base, adopt, reloadKey]);

  const rows = data?.treatments ?? [];
  const draft = data?.draft ?? null;
  const { body, invalid } = useMemo(() => draftBodyOf(working, rows), [working, rows]);
  const views = useMemo(() => rowViews(working, rows), [working, rows]);
  const summary = summaryOf(body);
  const hasChange = !isEmptyBody(body);
  /** 화면의 원하는 초안이 서버에 저장된 초안과 구조까지 같은가(가격·새 치료 내용·숨김·순서). */
  const savedMatches = useMemo(() => draft !== null && sameBody(body, bodyOfDraft(draft)), [draft, body]);
  const previewCurrent = preview !== null && draft !== null && preview.draftDigest === draft.draftDigest && savedMatches;
  const selection = useMemo(() => previewSelection(rows, draft, picked), [rows, draft, picked]);
  const lookup = useMemo(() => new Map(rows.map((row) => [row.treatmentId, row])), [rows]);

  /** 화면 상태를 바꾼다. 이미 본 미리보기는 낡은 것이 되므로 버린다(다시 미리보기를 해야 게시할 수 있다). */
  const edit = (change: (state: WorkingState) => WorkingState): void => {
    setWorking(change);
    setPreview(null);
  };

  /** 서버의 현재 상태를 다시 읽는다. adoptWorking 이 true 면 화면 입력도 서버의 초안 값으로 다시 세우고, false 면 사용자의 입력을 그대로 둔다. */
  const refresh = useCallback(
    async (adoptWorking: boolean) => {
      const list = await request<TreatmentsResponse>('GET', `${base}/treatments`);
      if (list.status === 200) {
        if (adoptWorking) adopt(list.body as TreatmentsResponse);
        else setData(list.body as TreatmentsResponse);
      }
      const versionsResult = await request<{ versions: CatalogVersionRow[] }>('GET', `${base}/catalog/versions`);
      if (versionsResult.status === 200) setVersions((versionsResult.body as { versions: CatalogVersionRow[] }).versions);
    },
    [base, adopt],
  );

  const run = async (work: () => Promise<void>, failure: FailureKind): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch {
      setMessage({ kind: 'error', text: `${COPY.errors.server} ${COPY.nothingChanged[failure]}` });
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = (): Promise<void> =>
    run(async () => {
      const result = await request<{ draft: unknown }>('PUT', `${base}/catalog/draft`, body);
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: failureMessage(result, 'save') });
        return;
      }
      setPreview(null);
      await refresh(true);
      setMessage({ kind: 'ok', text: COPY.saved });
    }, 'save');

  const discardDraft = (): Promise<void> =>
    run(async () => {
      const result = await request<{ discarded: boolean }>('DELETE', `${base}/catalog/draft`);
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: failureMessage(result, 'discard') });
        return;
      }
      setPreview(null);
      await refresh(true);
      setMessage({ kind: 'ok', text: COPY.discarded });
    }, 'discard');

  const runPreview = (): Promise<void> =>
    run(async () => {
      // 계산 대상 = 가격을 바꾼 치료(고정) + 사용자가 더 고른 치료. 숨길 치료는 보내지 않는다. 계산할 치료가 없으면 treatmentIds 를 빼서 서버가 금액 비교 없이 목록만 만들게 한다.
      const treatmentIds = selection.treatmentIds;
      const payload = { ...condition, ...(treatmentIds.length > 0 ? { treatmentIds } : {}) };
      const result = await request<PreviewResponse>('POST', `${base}/catalog/preview`, payload);
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: failureMessage(result, 'preview') });
        // 화면이 아는 초안이 서버와 달라 변경 치료가 빠졌다고 서버가 알려 주면 서버 상태만 다시 읽는다(사용자의 입력은 그대로 둔다).
        if ((result.body as ApiFailure).defects?.some((defect) => defect.code === 'CHANGED_TREATMENT_NOT_INCLUDED')) await refresh(false);
        return;
      }
      setPreview(result.body as PreviewResponse);
    }, 'preview');

  const publish = (): Promise<void> =>
    run(async () => {
      if (preview === null) return;
      // 게시 권한은 미리보기 응답이 준 게시 확인값뿐이다(목록·저장 응답의 draftDigest 는 화면이 상태를 비교하는 데만 쓴다).
      const result = await request<{ catalogVersion: string }>('POST', `${base}/catalog/publish`, { publishConfirmation: preview.publishConfirmation });
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: failureMessage(result, 'publish') });
        // 충돌(확인값이 맞지 않음·초안이 낡음)이면 지금 쥔 미리보기를 버리고 서버 상태를 다시 읽는다: 미리보기를 다시 실행해야 게시할 수 있다. 사용자의 입력은 그대로 둔다.
        if (result.status === 409) {
          setPreview(null);
          await refresh(false);
        }
        return;
      }
      setPreview(null);
      setPicked({});
      await refresh(true);
      setMessage({ kind: 'ok', text: COPY.publishedDone((result.body as { catalogVersion: string }).catalogVersion) });
    }, 'publish');

  const submitAddition = (): void => {
    if (working.additions.length >= 50) {
      setAddStatus({ kind: 'error', text: COPY.addTooMany });
      return;
    }
    const built = buildAddition(form, nextDraftKey(working, rows));
    if (!built.ok) {
      setFormErrors(built.errors);
      setAddStatus(null);
      return;
    }
    edit((state) => appendAddition(state, built.addition));
    setForm(EMPTY_ADD_FORM);
    setFormErrors({});
    setAddStatus({ kind: 'ok', text: COPY.addDone(built.addition.displayName) });
  };

  const setField = <K extends keyof AddForm>(key: K, value: AddForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as AddField];
      return next;
    });
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

  const noCatalog = data?.catalogVersion === null || rows.length === 0;
  const canSave = !busy && !invalid && hasChange && !(draft !== null && savedMatches);
  const canPreview = !busy && draft !== null && !draft.stale && savedMatches;
  const canPublish = !busy && previewCurrent && draft !== null && !draft.stale;

  return (
    <main className="admin-root" data-admin-state="ready">
      <header className="admin-header">
        <h1 className="admin-title">{COPY.title}</h1>
        <p className="admin-sub">{COPY.subtitle}</p>
        <dl className="admin-meta">
          <div>
            <dt>{COPY.clinicLabel}</dt>
            <dd data-admin-clinic>{data?.clinic.displayName}</dd>
          </div>
          <div>
            <dt>{COPY.catalogVersionLabel}</dt>
            <dd data-admin-catalog-version>{data?.catalogVersion ?? '-'}</dd>
          </div>
          <div>
            <dt>{COPY.sessionAs}</dt>
            <dd data-admin-user>{session?.userId}</dd>
          </div>
        </dl>
      </header>

      <div aria-live="polite" className="admin-live">
        {message !== null ? (
          <p role={message.kind === 'error' ? 'alert' : 'status'} className={`admin-banner admin-banner--${message.kind}`} data-admin-message={message.kind}>
            {message.text}
          </p>
        ) : null}
      </div>

      {noCatalog ? (
        <p className="admin-banner">{COPY.noCatalog}</p>
      ) : (
        <section aria-labelledby="admin-prices-heading">
          <h2 id="admin-prices-heading" className="admin-h2">{COPY.listTitle}</h2>
          <p className="admin-note">{COPY.readOnlyNote}</p>
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-list="working">
              <thead>
                <tr>
                  <th scope="col" className="admin-num">{COPY.colPosition}</th>
                  <th scope="col">{COPY.colTreatment}</th>
                  <th scope="col" className="admin-nowrap">{COPY.colBenefit}</th>
                  <th scope="col" className="admin-num">{COPY.published}</th>
                  <th scope="col" className="admin-num">{COPY.newPrice}</th>
                  <th scope="col" className="admin-nowrap">{COPY.colStatus}</th>
                  <th scope="col" className="admin-nowrap">{COPY.colControls}</th>
                </tr>
              </thead>
              <tbody>
                {views.map((view) => {
                  const added = view.isNew ? working.additions.find((entry) => entry.draftKey === view.key) : undefined;
                  const source = view.treatmentId === null ? undefined : lookup.get(view.treatmentId);
                  const codes = added ?? source;
                  return (
                    <tr
                      key={view.key}
                      className={view.hidden ? 'admin-row--hidden' : undefined}
                      data-admin-row={view.key}
                      data-changed={view.priceChanged}
                      data-hidden={view.hidden}
                      data-new={view.isNew}
                    >
                      <td className="admin-num" data-admin-position>
                        {view.position === null ? <span title={COPY.positionHiddenNote}>{COPY.positionNone}</span> : view.position}
                      </td>
                      <th scope="row">
                        <span className={view.hidden ? 'admin-name admin-name--hidden' : 'admin-name'}>{view.displayName}</span>
                        <span className="admin-sub2">
                          {view.isNew ? '' : `ID ${view.key} · `}
                          {COPY.code} {codes?.treatmentCode} · {COPY.procedure} {(codes?.procedureCodes ?? []).join(', ')}
                        </span>
                      </th>
                      <td className="admin-nowrap">{benefitLabel(view.benefitType)}</td>
                      <td className="admin-num" data-admin-current>
                        {view.currentPrice === null ? COPY.positionNone : won(view.currentPrice)}
                      </td>
                      <td className="admin-num">
                        {view.isNew ? (
                          <span data-admin-new-price>{won(view.newPrice ?? 0)}</span>
                        ) : (
                          <>
                            <input
                              className="admin-input"
                              inputMode="numeric"
                              autoComplete="off"
                              aria-label={COPY.newPriceLabel(view.displayName)}
                              aria-invalid={view.priceInvalid}
                              value={view.priceText ?? ''}
                              disabled={busy || view.hidden}
                              onChange={(event) => {
                                const text = event.target.value;
                                edit((state) => ({ ...state, priceTexts: { ...state.priceTexts, [view.key]: text } }));
                              }}
                            />
                            {view.priceInvalid ? <span role="alert" className="admin-field-error">{COPY.priceInvalid}</span> : null}
                          </>
                        )}
                      </td>
                      <td className="admin-nowrap" data-admin-status>
                        {view.isNew ? <span className="admin-pill admin-pill--new" data-admin-badge="new">{COPY.newBadge}</span> : null}
                        {view.hidden ? <span className="admin-pill admin-pill--hidden" data-admin-badge="hidden">{COPY.hiddenBadge}</span> : null}
                        {view.priceChanged ? <span className="admin-pill admin-pill--changed" data-admin-badge="changed">{COPY.changed}</span> : null}
                        {view.moved ? <span className="admin-pill admin-pill--moved" data-admin-badge="moved">{COPY.movedBadge}</span> : null}
                        {!view.isNew && !view.hidden && !view.priceChanged && !view.moved ? <span className="admin-status-none" data-admin-badge="none">{COPY.unchanged}</span> : null}
                      </td>
                      <td className="admin-nowrap admin-controls">
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          data-admin-move="up"
                          aria-label={COPY.moveUpLabel(view.displayName)}
                          disabled={busy || !view.canMoveUp}
                          onClick={() => edit((state) => moveRow(state, view.key, -1))}
                        >
                          {COPY.moveUp}
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          data-admin-move="down"
                          aria-label={COPY.moveDownLabel(view.displayName)}
                          disabled={busy || !view.canMoveDown}
                          onClick={() => edit((state) => moveRow(state, view.key, 1))}
                        >
                          {COPY.moveDown}
                        </button>
                        {view.isNew ? (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            data-admin-remove
                            aria-label={COPY.removeLabel(view.displayName)}
                            disabled={busy}
                            onClick={() => edit((state) => removeAddition(state, view.key))}
                          >
                            {COPY.removeNew}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            data-admin-hide={view.hidden ? 'on' : 'off'}
                            aria-label={view.hidden ? COPY.unhideLabel(view.displayName) : COPY.hideLabel(view.displayName)}
                            disabled={busy}
                            onClick={() => edit((state) => toggleHidden(state, view.key))}
                          >
                            {view.hidden ? COPY.unhide : COPY.hide}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="admin-working-summary" data-admin-working-summary>{COPY.workingSummary(summary)}</p>
          <p className="admin-draft-status" data-admin-draft={draft === null ? 'none' : draft.stale ? 'stale' : 'saved'}>
            {draft === null ? COPY.draftStatusNone : draft.stale ? COPY.draftStale : COPY.draftStatusSaved}
          </p>

          <div className="admin-actions">
            <button type="button" className="admin-btn admin-btn--primary" disabled={!canSave} onClick={() => void saveDraft()}>
              {COPY.saveDraft}
            </button>
            <button type="button" className="admin-btn" disabled={busy || draft === null} onClick={() => void discardDraft()}>
              {COPY.discardDraft}
            </button>
          </div>
          {!canSave && !hasChange && draft === null ? <p className="admin-hint">{COPY.saveHint}</p> : null}
        </section>
      )}

      {!noCatalog ? (
        <section aria-labelledby="admin-add-heading" className="admin-add" data-admin-add-section>
          <h2 id="admin-add-heading" className="admin-h2">{COPY.addTitle}</h2>
          <p className="admin-note" data-admin-add-note>{COPY.addNote}</p>
          <form
            className="admin-add-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitAddition();
            }}
          >
            <fieldset className="admin-fieldset" disabled={busy}>
              <legend>{COPY.addTitle}</legend>
              <TextField label={COPY.addDisplayName} value={form.displayName} error={formErrors.displayName} onChange={(value) => setField('displayName', value)} />
              <TextField label={COPY.addDescription} value={form.description} error={undefined} onChange={(value) => setField('description', value)} />
              <div className="admin-field">
                <label className="admin-label">
                  {COPY.addBenefit}
                  <select className="admin-select" value={form.benefitType} onChange={(event) => setField('benefitType', event.target.value === 'NON_BENEFIT' ? 'NON_BENEFIT' : 'BENEFIT')}>
                    <option value="BENEFIT">{COPY.benefit}</option>
                    <option value="NON_BENEFIT">{COPY.nonBenefit}</option>
                  </select>
                </label>
              </div>
              <TextField label={COPY.addAmount} value={form.patientAmount} error={formErrors.patientAmount} inputMode="numeric" onChange={(value) => setField('patientAmount', value)} />
              <TextField label={COPY.addTreatmentCode} value={form.treatmentCode} error={formErrors.treatmentCode} onChange={(value) => setField('treatmentCode', value)} />
              <TextField label={COPY.addProcedureCodes} value={form.procedureCodes} error={undefined} onChange={(value) => setField('procedureCodes', value)} />
            </fieldset>
            <fieldset className="admin-fieldset" disabled={busy}>
              <legend>{COPY.addDocuments}</legend>
              <label className="admin-check">
                <input type="checkbox" checked={form.imaging} onChange={(event) => setField('imaging', event.target.checked)} />
                {COPY.addImaging}
              </label>
              <label className="admin-check">
                <input type="checkbox" checked={form.biopsy} onChange={(event) => setField('biopsy', event.target.checked)} />
                {COPY.addBiopsy}
              </label>
              <label className="admin-check">
                <input type="checkbox" checked={form.opinionRequired} onChange={(event) => setField('opinionRequired', event.target.checked)} />
                {COPY.addOpinion}
              </label>
            </fieldset>
            <fieldset className="admin-fieldset" disabled={busy}>
              <legend>{COPY.addCondition}</legend>
              <TextField label={COPY.addPatientType} value={form.patientType} error={formErrors.patientType} onChange={(value) => setField('patientType', value)} />
              <TextField label={COPY.addAssumption} value={form.assumption} error={formErrors.assumption} onChange={(value) => setField('assumption', value)} />
              <TextField label={COPY.addReferenceDate} value={form.referenceDate} error={formErrors.referenceDate} placeholder="2026-01-31" onChange={(value) => setField('referenceDate', value)} />
              <TextField label={COPY.addEffectiveDate} value={form.effectiveDate} error={formErrors.effectiveDate} placeholder="2026-01-31" onChange={(value) => setField('effectiveDate', value)} />
            </fieldset>
            <div className="admin-actions">
              <button type="submit" className="admin-btn" disabled={busy}>{COPY.addSubmit}</button>
            </div>
            <p className="admin-hint">{COPY.addHintLocal}</p>
            {addStatus !== null ? (
              <p role={addStatus.kind === 'error' ? 'alert' : 'status'} className={`admin-banner admin-banner--${addStatus.kind}`} data-admin-add-status={addStatus.kind}>
                {addStatus.text}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {!noCatalog ? (
        <section aria-labelledby="admin-preview-heading" className="admin-preview" data-admin-preview-section>
          <h2 id="admin-preview-heading" className="admin-h2">{COPY.previewTitle}</h2>
          <p className="admin-note">{COPY.previewNote}</p>
          <fieldset className="admin-fieldset" disabled={busy}>
            <legend>{COPY.previewCondition}</legend>
            {(
              [
                ['generation', COPY.generation, options?.generations ?? []],
                ['insurerType', COPY.insurerType, options?.insurerTypes ?? []],
                ['cause', COPY.cause, options?.causes ?? []],
              ] as const
            ).map(([key, label, list]) => (
              <label key={key} className="admin-label">
                {label}
                <select className="admin-select" value={condition[key]} onChange={(event) => { setCondition((current) => ({ ...current, [key]: event.target.value })); setPreview(null); }}>
                  {list.map((option) => (
                    <option key={option.code} value={option.code}>{option.label}</option>
                  ))}
                </select>
              </label>
            ))}
            <div className="admin-checks" role="group" aria-label={COPY.previewTreatments}>
              <span className="admin-label-text">{COPY.previewTreatments}</span>
              {selection.offered.map((row) => {
                const required = selection.required.has(row.treatmentId);
                return (
                  <label key={row.treatmentId} className="admin-check" data-admin-pick={row.treatmentId} data-required={required}>
                    <input
                      type="checkbox"
                      checked={required || (picked[row.treatmentId] ?? false)}
                      disabled={required}
                      onChange={(event) => { setPicked((current) => ({ ...current, [row.treatmentId]: event.target.checked })); setPreview(null); }}
                    />
                    {row.displayName}
                    {required ? <span className="admin-sub2"> · {COPY.previewRequiredPick}</span> : null}
                  </label>
                );
              })}
            </div>
            <p className="admin-hint">{COPY.previewTreatmentsNote}</p>
          </fieldset>
          <div className="admin-actions">
            <button type="button" className="admin-btn" disabled={!canPreview} onClick={() => void runPreview()}>
              {COPY.runPreview}
            </button>
          </div>
          {!canPreview ? <p className="admin-hint">{COPY.previewHint}</p> : null}

          {preview !== null ? (
            <div data-admin-preview aria-live="polite">
              <h3 className="admin-h3">{COPY.changesTitle}</h3>
              <div className="admin-changes-groups" data-admin-changes>
                {preview.changes.priceChanges.length > 0 ? (
                  <>
                    <h4 className="admin-h4">{COPY.priceChangesTitle}</h4>
                    <ul className="admin-changes">
                      {preview.changes.priceChanges.map((change) => (
                        <li key={change.treatmentId} data-admin-change={change.treatmentId}>
                          {change.displayName}: {won(change.before)} → <strong>{won(change.after)}</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {preview.changes.added.length > 0 ? (
                  <>
                    <h4 className="admin-h4">{COPY.addedTitle}</h4>
                    <ul className="admin-changes">
                      {preview.changes.added.map((entry) => {
                        const reasons = entry.calculation.holdReasons.length > 0 ? entry.calculation.holdReasons : entry.calculation.state === 'ON_HOLD' ? ['UNKNOWN'] : [];
                        return (
                          <li key={entry.draftKey} data-admin-added={entry.draftKey}>
                            <strong>{entry.displayName}</strong> · {COPY.addedLine(benefitLabel(entry.benefitType), entry.patientAmount)}
                            <span className="admin-calc" data-admin-added-state={entry.calculation.state}>
                              {COPY.stateLabel(entry.calculation.state)}
                              {reasons.length > 0 ? ` (${COPY.holdPrefix}: ${[...new Set(reasons.map((code) => COPY.holdReason(code)))].join(', ')})` : ''}
                              {' · '}
                              {COPY.expectedPayout}: {COPY.needsCheck}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : null}
                {preview.changes.deactivated.length > 0 ? (
                  <>
                    <h4 className="admin-h4">{COPY.deactivatedTitle}</h4>
                    <ul className="admin-changes">
                      {preview.changes.deactivated.map((entry) => (
                        <li key={entry.treatmentId} data-admin-deactivated={entry.treatmentId}>
                          {entry.displayName}: {COPY.deactivatedLine}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {preview.changes.reordered.length > 0 ? (
                  <>
                    <h4 className="admin-h4">{COPY.reorderedTitle}</h4>
                    <ul className="admin-changes">
                      {preview.changes.reordered.map((entry) => (
                        <li key={entry.treatmentId} data-admin-reordered={entry.treatmentId}>
                          {entry.displayName}: {COPY.reorderedLine(entry.before, entry.after)}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>

              <h3 className="admin-h3">{COPY.listsTitle}</h3>
              <div className="admin-lists" data-admin-lists>
                {(['before', 'after'] as const).map((side) => (
                  <div key={side} className="admin-list-col">
                    <h4 className="admin-h4">{side === 'before' ? COPY.listBefore : COPY.listAfter}</h4>
                    <ol className="admin-preview-list" data-admin-preview-list={side}>
                      {(side === 'before' ? preview.beforeList : preview.afterList).map((entry) => (
                        <li key={entry.key} data-admin-preview-row={entry.key} data-new={entry.isNew}>
                          {entry.displayName} · {won(entry.patientAmount)}
                          {entry.isNew ? <span className="admin-pill admin-pill--new"> {COPY.listNewMark}</span> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>

              {preview.before !== null && preview.after !== null ? (
                <table className="admin-table admin-compare">
                  <thead>
                    <tr>
                      <th scope="col" />
                      <th scope="col" className="admin-num">{COPY.before}</th>
                      <th scope="col" className="admin-num">{COPY.after}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr data-admin-compare="state">
                      <th scope="row">계산 상태</th>
                      <td className="admin-num">{COPY.stateLabel(preview.before.result.state)}</td>
                      <td className="admin-num">{COPY.stateLabel(preview.after.result.state)}</td>
                    </tr>
                    <tr data-admin-compare="hospital">
                      <th scope="row">{COPY.hospitalPayment}</th>
                      <td className="admin-num">{won(preview.before.result.amounts.hospitalPayment)}</td>
                      <td className="admin-num">{won(preview.after.result.amounts.hospitalPayment)}</td>
                    </tr>
                    <tr data-admin-compare="payout">
                      <th scope="row">{COPY.expectedPayout}</th>
                      <td className="admin-num">{money(preview.before.result.amounts.expectedInsurancePayout)}</td>
                      <td className="admin-num">{money(preview.after.result.amounts.expectedInsurancePayout)}</td>
                    </tr>
                    <tr data-admin-compare="after">
                      <th scope="row">{COPY.afterPayout}</th>
                      <td className="admin-num">{money(preview.before.result.amounts.expectedOutOfPocketAfterPayout)}</td>
                      <td className="admin-num">{money(preview.after.result.amounts.expectedOutOfPocketAfterPayout)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="admin-hint" data-admin-no-compare>{COPY.noCompare}</p>
              )}
            </div>
          ) : null}

          <div className="admin-actions">
            <button type="button" className="admin-btn admin-btn--primary" disabled={!canPublish} onClick={() => void publish()}>
              {COPY.publish}
            </button>
          </div>
          {!canPublish ? <p className="admin-hint">{COPY.publishHint}</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="admin-history-heading">
        <h2 id="admin-history-heading" className="admin-h2">{COPY.historyTitle}</h2>
        {versions.length === 0 ? (
          <p className="admin-hint">{COPY.historyNone}</p>
        ) : (
          <ol className="admin-history">
            {versions.map((version) => (
              <li key={version.id} data-admin-version={version.id} data-current={version.current}>
                <strong>{version.id}</strong> {version.current ? <span className="admin-pill">{COPY.historyCurrent}</span> : null}
                <span className="admin-sub2">
                  {' '}
                  {formatSeoulMinute(version.publishedAt)} · {COPY.historyPublishedBy} {version.publishedBy} ·{' '}
                  {COPY.historySummary({
                    added: version.changeSummary.addedTreatmentIds.length,
                    hidden: (version.changeSummary.deactivatedTreatmentIds ?? []).length,
                    reordered: (version.changeSummary.reorderedTreatmentIds ?? []).length,
                    priceChanged: version.changeSummary.priceChangedTreatmentIds.length,
                  })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
