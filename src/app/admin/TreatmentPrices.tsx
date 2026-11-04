'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { formatSeoulMinute } from '../clock';
import type { ApiFailure, CatalogVersionRow, OptionsResponse, PreviewResponse, SessionResponse, TreatmentRow, TreatmentsResponse } from './api-types';
import { ADMIN_COPY as COPY } from './copy';
import { adminRequest as request } from './transport';
import type { Api } from './transport';

// 치료 가격 관리 화면 (SPEC-REIMBURSEMENT-001 M7 첫 기능, 디자인 A02 치료 목록·A03 치료 수정·A04 게시 미리보기).
// 가격 수정 → 초안 저장 → 미리보기 → 게시. 모든 처리는 /api/admin/** 가 하고 이 화면은 서버가 준 값만 보인다(보험금·한도·공제를 화면에서 계산하거나 정하지 않는다).
// 권한·인증 판정은 서버가 한다: 이 화면은 401·403 응답을 안내로 보일 뿐 자기 판단으로 기능을 열지 않는다.
// 세션 값(입력 중인 가격·미리보기 결과)은 화면 안에만 있고 저장소·주소·분석으로 내보내지 않는다.

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'ready';

const won = (value: number): string => `${value.toLocaleString('ko-KR')}${COPY.priceUnit}`;
const money = (value: number | null): string => (value === null ? COPY.needsCheck : won(value));
const isAmountText = (text: string): boolean => /^\d+$/.test(text.trim());

/** 서버 거절을 사람이 읽는 문장으로: 코드를 그대로 보이지 않는다. 입력은 바뀌지 않았다는 사실을 함께 알린다. */
function failureMessage(result: Api<unknown>): string {
  const failure = result.body as ApiFailure;
  if (result.status === 409) {
    return failure.reason === 'DRAFT_CHANGED' ? COPY.errors.changed : failure.reason === 'DRAFT_STALE' ? COPY.errors.stale : failure.reason === 'DRAFT_ABSENT' ? COPY.errors.absent : COPY.errors.generic;
  }
  if (result.status === 400) {
    const codes = (failure.defects ?? []).map((defect) => defect.code);
    if (codes.includes('ORIGIN_NOT_ACCEPTED')) return COPY.errors.originNotAccepted;
    if (codes.includes('NO_PRICE_CHANGE')) return COPY.errors.noChange;
    if (codes.includes('TREATMENT_NOT_IN_CATALOG')) return COPY.errors.notInCatalog;
    if (codes.includes('VALUE_INVALID') || codes.includes('VALUE_MISSING')) return COPY.errors.amount;
    return COPY.errors.generic;
  }
  return result.status >= 500 ? COPY.errors.server : COPY.errors.generic;
}

export function TreatmentPrices({ clinicId }: { clinicId: string }): ReactElement {
  const base = `/api/admin/clinics/${encodeURIComponent(clinicId)}`;
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [data, setData] = useState<TreatmentsResponse | null>(null);
  const [versions, setVersions] = useState<CatalogVersionRow[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [condition, setCondition] = useState({ generation: '', insurerType: '', cause: '' });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /** 서버가 준 데이터로 입력 칸을 다시 채운다: 초안이 있으면 초안 가격, 없으면 게시된 가격. */
  const adopt = useCallback((next: TreatmentsResponse) => {
    setData(next);
    const drafted = new Map((next.draft?.priceEdits ?? []).map((edit) => [edit.treatmentId, edit.patientAmount]));
    setInputs(Object.fromEntries(next.treatments.map((row) => [row.treatmentId, String(drafted.get(row.treatmentId) ?? row.patientAmount)])));
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

  const rows: TreatmentRow[] = data?.treatments ?? [];
  const parsed = useMemo(() => rows.map((row) => ({ row, text: inputs[row.treatmentId] ?? String(row.patientAmount) })), [rows, inputs]);
  const invalid = parsed.some(({ text }) => !isAmountText(text));
  const edits = useMemo(
    () => parsed.filter(({ row, text }) => isAmountText(text) && Number(text) !== row.patientAmount).map(({ row, text }) => ({ treatmentId: row.treatmentId, patientAmount: Number(text) })),
    [parsed],
  );
  const draft = data?.draft ?? null;
  const savedMatches = useMemo(() => {
    if (draft === null || draft.priceEdits.length !== edits.length) return false;
    const saved = new Map(draft.priceEdits.map((edit) => [edit.treatmentId, edit.patientAmount]));
    return edits.every((edit) => saved.get(edit.treatmentId) === edit.patientAmount);
  }, [draft, edits]);
  const previewCurrent = preview !== null && draft !== null && preview.draftDigest === draft.draftDigest && savedMatches;

  const refresh = useCallback(async () => {
    const list = await request<TreatmentsResponse>('GET', `${base}/treatments`);
    if (list.status === 200) adopt(list.body as TreatmentsResponse);
    const versionsResult = await request<{ versions: CatalogVersionRow[] }>('GET', `${base}/catalog/versions`);
    if (versionsResult.status === 200) setVersions((versionsResult.body as { versions: CatalogVersionRow[] }).versions);
  }, [base, adopt]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch {
      setMessage({ kind: 'error', text: COPY.errors.server });
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = (): Promise<void> =>
    run(async () => {
      const result = await request<{ draft: unknown }>('PUT', `${base}/catalog/draft`, { priceEdits: edits });
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: failureMessage(result) });
        return;
      }
      setPreview(null);
      await refresh();
      setMessage({ kind: 'ok', text: COPY.saved });
    });

  const discardDraft = (): Promise<void> =>
    run(async () => {
      const result = await request<{ discarded: boolean }>('DELETE', `${base}/catalog/draft`);
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: failureMessage(result) });
        return;
      }
      setPreview(null);
      await refresh();
      setMessage({ kind: 'ok', text: COPY.discarded });
    });

  const runPreview = (): Promise<void> =>
    run(async () => {
      const selected = Object.entries(picked).filter(([, on]) => on).map(([id]) => id);
      const body = { ...condition, ...(selected.length > 0 ? { treatmentIds: selected } : {}) };
      const result = await request<PreviewResponse>('POST', `${base}/catalog/preview`, body);
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: failureMessage(result) });
        return;
      }
      setPreview(result.body as PreviewResponse);
    });

  const publish = (): Promise<void> =>
    run(async () => {
      if (preview === null) return;
      const result = await request<{ catalogVersion: string }>('POST', `${base}/catalog/publish`, { draftDigest: preview.draftDigest });
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: failureMessage(result) });
        // 충돌(초안이 바뀜·낡음)이면 서버 상태를 다시 읽어 화면을 맞춘다.
        if (result.status === 409) await refresh();
        return;
      }
      setPreview(null);
      await refresh();
      setMessage({ kind: 'ok', text: COPY.publishedDone((result.body as { catalogVersion: string }).catalogVersion) });
    });

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
  const canSave = !busy && !invalid && edits.length > 0 && !(draft !== null && savedMatches);
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
          <h2 id="admin-prices-heading" className="admin-h2">{COPY.published}</h2>
          <p className="admin-note">{COPY.readOnlyNote}</p>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">치료</th>
                <th scope="col" className="admin-nowrap">급여 구분</th>
                <th scope="col" className="admin-num">{COPY.published}</th>
                <th scope="col" className="admin-num">{COPY.newPrice}</th>
                <th scope="col" className="admin-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map(({ row, text }) => {
                const bad = !isAmountText(text);
                const changed = !bad && Number(text) !== row.patientAmount;
                return (
                  <tr key={row.treatmentId} data-admin-row={row.treatmentId} data-changed={changed}>
                    <th scope="row">
                      <span className="admin-name">{row.displayName}</span>
                      <span className="admin-sub2">ID {row.treatmentId} · {COPY.code} {row.treatmentCode} · {COPY.procedure} {row.procedureCodes.join(', ')}</span>
                    </th>
                    <td className="admin-nowrap">{row.benefitType === 'BENEFIT' ? COPY.benefit : COPY.nonBenefit}</td>
                    <td className="admin-num" data-admin-current>{won(row.patientAmount)}</td>
                    <td className="admin-num">
                      <input
                        className="admin-input"
                        inputMode="numeric"
                        autoComplete="off"
                        aria-label={`${row.displayName} 새 가격`}
                        aria-invalid={bad}
                        value={text}
                        disabled={busy}
                        onChange={(event) => setInputs((current) => ({ ...current, [row.treatmentId]: event.target.value }))}
                      />
                      {bad ? <span role="alert" className="admin-field-error">{COPY.priceInvalid}</span> : null}
                    </td>
                    <td className="admin-nowrap">{changed ? COPY.changed : COPY.unchanged}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

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
          {!canSave && edits.length === 0 && draft === null ? <p className="admin-hint">{COPY.saveHint}</p> : null}
        </section>
      )}

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
              {rows.map((row) => (
                <label key={row.treatmentId} className="admin-check">
                  <input type="checkbox" checked={picked[row.treatmentId] ?? false} onChange={(event) => { setPicked((current) => ({ ...current, [row.treatmentId]: event.target.checked })); setPreview(null); }} />
                  {row.displayName}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="admin-actions">
            <button type="button" className="admin-btn" disabled={!canPreview} onClick={() => void runPreview()}>
              {COPY.runPreview}
            </button>
          </div>
          {!canPreview ? <p className="admin-hint">{COPY.previewHint}</p> : null}

          {preview !== null ? (
            <div data-admin-preview aria-live="polite">
              <h3 className="admin-h3">{COPY.priceChangesTitle}</h3>
              <ul className="admin-changes">
                {preview.priceChanges.map((change) => (
                  <li key={change.treatmentId} data-admin-change={change.treatmentId}>
                    {change.displayName}: {won(change.before)} → <strong>{won(change.after)}</strong>
                  </li>
                ))}
              </ul>
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
                <span className="admin-sub2"> {formatSeoulMinute(version.publishedAt)} · {COPY.historyPublishedBy} {version.publishedBy} · {COPY.historyPriceChanged(version.changeSummary.priceChangedTreatmentIds.length)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
