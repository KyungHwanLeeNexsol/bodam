'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { SessionResponse } from './api-types';
import { AdminNav } from './AdminNav';
import { BUNDLE_COPY as COPY } from './bundle-copy';
import {
  baseView,
  bundleFailureMessage,
  candidateView,
  failureCodeOf,
  initialSelection,
  previewRequestOf,
  previewView,
  publishGateOf,
  publishedMessage,
  reconcileSelection,
  recordOf,
  refKey,
  selectBase,
  toggleMapping,
} from './bundle-model';
import type { BundleSelection, PreviewRecord } from './bundle-model';
import type { BundlePreviewResponse, BundlePublishOverview, BundlePublishResponse } from './bundle-types';
import { adminRequest as request } from './transport';

// 규칙 묶음 게시 화면 (SPEC-REIMBURSEMENT-001 M7 묶음 구성). 검토 담당자(RV)가 기준 묶음 하나를 고르고 승인된 매핑을 더해 새 규칙 묶음을 만든다: 고르기 → 미리보기 → 게시.
// 게시는 어느 병원에도 적용되지 않는다: 이 화면에는 병원을 고르거나 적용하는 어떤 조작도 없고, 성공 문구가 그 사실을 말한다(적용은 플랫폼 운영자의 규칙 사용 범위 화면).
// 접근 판정과 모든 규칙(기준 묶음이 사용 가능한가·이미 담긴 매핑·겹침·확인값·게시 전제)은 서버가 한다. 이 화면은 401·403 응답을 안내로 보이고, 게시 단추를 미리보기와 같은 선택일 때만 연다.
// 시험 문구이며 최종 안내 문구가 아니다.
//
// 화면 표지(data-*) — 시험이 쓰는 안정된 이름:
//   main[data-admin-state]                loading | unauthenticated | forbidden | error | ready   (ready 일 때 data-admin-page="bundles")
//   [data-admin-nav] / [data-admin-nav-link=review-queue|bundles] / [data-admin-user]
//   [data-admin-message=ok|error]         결과 문장(aria-live 영역 안). data-admin-message-code = PUBLISHED | 서버 사유/결함 코드 | HTTP_<상태>, ok 게시 문장에는 data-admin-published=<새 묶음 id>
//   [data-admin-bundle-bases] 안: [data-admin-base=<묶음 id>][data-admin-base-status=ACTIVE|SUSPENDED], input[data-admin-base-radio=<묶음 id>](중지된 묶음은 disabled), [data-admin-base-unavailable], [data-admin-base-clinics]
//   [data-admin-bundles-empty]            게시된 묶음이 없을 때
//   [data-admin-candidates] 안: tr[data-admin-candidate=<매핑 id>@<버전>][data-admin-candidate-id][data-admin-candidate-version][data-selected=true|false][data-admin-candidate-fingerprint=CURRENT|STALE|UNKNOWN],
//        input[data-admin-candidate-check], [data-admin-candidate-treatment|-clinic|-decision|-scope|-validity|-approver|-fingerprint-text|-warning|-note|-in-bundles]
//   [data-admin-candidates-empty] / [data-admin-unreadable]
//   [data-admin-selected-count] / button[data-admin-action=preview] / button[data-admin-action=publish] / [data-admin-preview-hint] / [data-admin-publish-hint]
//   [data-admin-preview][data-admin-preview-publishable=true|false] 안: [data-admin-preview-group=PROFILE|MAPPING|DOCUMENT_RULE_SET],
//        li[data-admin-preview-item][data-admin-preview-kind][data-admin-preview-id][data-admin-preview-source=BASE|ADDED], [data-admin-preview-summary], [data-admin-preview-defect=<코드>], [data-admin-preview-conflict=<매핑 키>], [data-admin-preview-clean]

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'ready';
type Busy = 'idle' | 'preview' | 'publish';
type Banner = { kind: 'ok' | 'error'; text: string; code: string; bundleId: string | null };

export function BundlePublish(): ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [viewer, setViewer] = useState<string | null>(null);
  const [overview, setOverview] = useState<BundlePublishOverview>({ bases: [], candidates: [], unreadable: [] });
  const [selection, setSelection] = useState<BundleSelection>({ baseBundleId: null, chosen: [] });
  const [record, setRecord] = useState<PreviewRecord | null>(null);
  const [message, setMessage] = useState<Banner | null>(null);
  const [busy, setBusy] = useState<Busy>('idle');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const sessionResult = await request<SessionResponse>('GET', '/api/admin/session', undefined, signal);
        if (sessionResult.status === 200) setViewer((sessionResult.body as SessionResponse).userId);
        const result = await request<BundlePublishOverview>('GET', '/api/admin/bundle-publish', undefined, signal);
        if (result.status === 401) return setPhase('unauthenticated');
        if (result.status === 403) return setPhase('forbidden');
        if (result.status !== 200) return setPhase('error');
        const loaded = result.body as BundlePublishOverview;
        setOverview(loaded);
        setSelection(initialSelection(loaded));
        setPhase('ready');
      } catch {
        if (!signal.aborted) setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  /** 서버의 현재 기준 묶음·후보를 다시 읽는다. 읽지 못해도 화면의 선택은 건드리지 않는다. */
  const load = useCallback(async (): Promise<BundlePublishOverview | null> => {
    try {
      const result = await request<BundlePublishOverview>('GET', '/api/admin/bundle-publish');
      if (result.status !== 200) return null;
      const loaded = result.body as BundlePublishOverview;
      setOverview(loaded);
      return loaded;
    } catch {
      return null;
    }
  }, []);

  /** 고른 내용이 바뀌면 미리보기를 지운다: 게시는 지금 선택과 같은 미리보기가 있을 때만 열린다. */
  const changeSelection = (next: BundleSelection): void => {
    setSelection(next);
    setRecord(null);
  };

  const preview = async (): Promise<void> => {
    const built = previewRequestOf(selection, overview.candidates);
    if (!built.ok || busy !== 'idle') return;
    setBusy('preview');
    setMessage(null);
    try {
      const result = await request<BundlePreviewResponse>('POST', '/api/admin/bundle-publish/preview', built.body);
      if (result.status !== 200) {
        setRecord(null);
        setMessage({ kind: 'error', text: bundleFailureMessage(result, 'preview'), code: failureCodeOf(result), bundleId: null });
        const next = await load();
        if (next !== null) setSelection((current) => reconcileSelection(current, next));
        return;
      }
      setRecord(recordOf(built.body, result.body as BundlePreviewResponse));
    } catch {
      setRecord(null);
      setMessage({ kind: 'error', text: bundleFailureMessage({ status: 500, body: { error: 'INTERNAL' } }, 'preview'), code: 'HTTP_500', bundleId: null });
    } finally {
      setBusy('idle');
    }
  };

  const publish = async (): Promise<void> => {
    const gate = publishGateOf(selection, overview.candidates, record);
    if (!gate.enabled || gate.body === null || busy !== 'idle') return;
    const items = record === null ? [] : record.preview.items;
    setBusy('publish');
    setMessage(null);
    try {
      const result = await request<BundlePublishResponse>('POST', '/api/admin/bundle-publish', gate.body);
      if (result.status !== 200) {
        // 거절된 게시의 확인값은 다시 쓰지 않는다: 미리보기를 지우고 서버의 현재 상태를 다시 읽는다.
        setRecord(null);
        setMessage({ kind: 'error', text: bundleFailureMessage(result, 'publish', items), code: failureCodeOf(result), bundleId: null });
        const next = await load();
        if (next !== null) setSelection((current) => reconcileSelection(current, next));
        return;
      }
      const bundleId = (result.body as BundlePublishResponse).bundle.id;
      setRecord(null);
      setMessage({ kind: 'ok', text: publishedMessage(bundleId), code: 'PUBLISHED', bundleId });
      const next = await load();
      setSelection(next === null ? { baseBundleId: selection.baseBundleId, chosen: [] } : initialSelection(next));
    } catch {
      setRecord(null);
      setMessage({ kind: 'error', text: bundleFailureMessage({ status: 500, body: { error: 'INTERNAL' } }, 'publish', items), code: 'HTTP_500', bundleId: null });
    } finally {
      setBusy('idle');
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

  const previewRequest = previewRequestOf(selection, overview.candidates);
  const gate = publishGateOf(selection, overview.candidates, record);
  const view = record === null ? null : previewView(record.preview);
  const idle = busy === 'idle';

  return (
    <main className="admin-root" data-admin-state="ready" data-admin-page="bundles">
      <header className="admin-header">
        <AdminNav current="bundles" />
        <h1 className="admin-title">{COPY.title}</h1>
        <p className="admin-note" data-admin-bundles-note>{COPY.note}</p>
        <p className="admin-sub2">{COPY.sessionAs}: <span data-admin-user>{viewer ?? '-'}</span></p>
      </header>

      <div aria-live="polite" className="admin-live">
        {message !== null ? (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`admin-banner admin-banner--${message.kind}`}
            data-admin-message={message.kind}
            data-admin-message-code={message.code}
            {...(message.bundleId !== null ? { 'data-admin-published': message.bundleId } : {})}
          >
            {message.text}
          </p>
        ) : null}
      </div>

      <section className="admin-bundle-section" aria-labelledby="admin-bundle-bases-heading" data-admin-bundle-bases>
        <h2 id="admin-bundle-bases-heading" className="admin-h2">{COPY.basesTitle}</h2>
        <p className="admin-hint">{COPY.basesNote}</p>
        {overview.bases.length === 0 ? (
          <p className="admin-banner" data-admin-bundles-empty>{COPY.basesEmpty}</p>
        ) : (
          <div className="admin-table-wrap" role="radiogroup" aria-labelledby="admin-bundle-bases-heading">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">{COPY.colSelect}</th>
                  <th scope="col">{COPY.colBundle}</th>
                  <th scope="col">{COPY.colStatus}</th>
                  <th scope="col">{COPY.colPublished}</th>
                  <th scope="col">{COPY.colItems}</th>
                  <th scope="col">{COPY.colClinics}</th>
                </tr>
              </thead>
              <tbody>
                {overview.bases.map((base) => {
                  const row = baseView(base);
                  return (
                    <tr key={row.bundleId} data-admin-base={row.bundleId} data-admin-base-status={base.status ?? 'UNKNOWN'} data-selected={String(selection.baseBundleId === row.bundleId)} data-unavailable={String(!row.selectable)}>
                      <td>
                        <input
                          type="radio"
                          name="admin-base-bundle"
                          value={row.bundleId}
                          aria-label={COPY.baseRadioLabel(row.shortId)}
                          checked={selection.baseBundleId === row.bundleId}
                          disabled={!row.selectable || !idle}
                          data-admin-base-radio={row.bundleId}
                          onChange={() => changeSelection(selectBase(selection, row.bundleId))}
                        />
                      </td>
                      <th scope="row">
                        <span className="admin-name" title={row.bundleId}>{row.shortId}</span>
                        {row.unavailableText !== null ? <span className="admin-sub2" data-admin-base-unavailable>{row.unavailableText}</span> : null}
                      </th>
                      <td>
                        <span className={`admin-pill${row.selectable ? '' : ' admin-pill--hidden'}`}>{row.statusText}</span>
                      </td>
                      <td>{row.publishedText}</td>
                      <td>{row.itemsText}</td>
                      <td data-admin-base-clinics>{row.clinicsText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-bundle-section" aria-labelledby="admin-bundle-candidates-heading" data-admin-candidates>
        <h2 id="admin-bundle-candidates-heading" className="admin-h2">{COPY.candidatesTitle}</h2>
        <p className="admin-hint">{COPY.candidatesNote}</p>
        {overview.candidates.length === 0 ? (
          <p className="admin-banner" data-admin-candidates-empty>{COPY.candidatesEmpty}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--bundle">
              <thead>
                <tr>
                  <th scope="col">{COPY.colPick}</th>
                  <th scope="col">{COPY.colTreatment}</th>
                  <th scope="col">{COPY.colClinic}</th>
                  <th scope="col">{COPY.colDecision}</th>
                  <th scope="col">{COPY.colScope}</th>
                  <th scope="col">{COPY.colValidity}</th>
                  <th scope="col">{COPY.colApprover}</th>
                  <th scope="col">{COPY.colFingerprint}</th>
                </tr>
              </thead>
              <tbody>
                {overview.candidates.map((candidate) => {
                  const key = refKey(candidate.mappingRef);
                  const row = candidateView(candidate, selection.chosen.includes(key));
                  return (
                    <tr
                      key={key}
                      data-admin-candidate={`${row.id}@${row.version}`}
                      data-admin-candidate-id={row.id}
                      data-admin-candidate-version={row.version}
                      data-admin-candidate-fingerprint={row.fingerprintState}
                      data-selected={String(row.selected)}
                    >
                      <td>
                        <input type="checkbox" aria-label={COPY.pickLabel(row.name)} checked={row.selected} disabled={!idle} data-admin-candidate-check onChange={() => changeSelection(toggleMapping(selection, key))} />
                      </td>
                      <th scope="row">
                        <span className="admin-name" data-admin-candidate-treatment>{row.name}</span>
                      </th>
                      <td data-admin-candidate-clinic>{row.clinicText}</td>
                      <td data-admin-candidate-decision>{row.decisionText}</td>
                      <td data-admin-candidate-scope>{row.scopeText}</td>
                      <td className="admin-nowrap" data-admin-candidate-validity>{row.validityText}</td>
                      <td data-admin-candidate-approver>{row.approverText}</td>
                      <td>
                        <span className={`admin-pill${row.fingerprintState === 'CURRENT' ? '' : ' admin-pill--changed'}`} data-admin-candidate-fingerprint-text>{row.fingerprintText}</span>
                        {row.warning !== null ? <span className="admin-bundle-warning" data-admin-candidate-warning>{row.warning}</span> : null}
                        {row.note !== null ? <span className="admin-bundle-note" data-admin-candidate-note>{row.note}</span> : null}
                        {row.alreadyInText !== null ? <span className="admin-bundle-note" data-admin-candidate-in-bundles>{row.alreadyInText}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {overview.unreadable.length > 0 ? <p className="admin-banner" data-admin-unreadable>{COPY.unreadableNote(overview.unreadable.length)}</p> : null}
      </section>

      <section className="admin-bundle-section" aria-label={COPY.previewTitle} data-admin-bundle-actions>
        <p className="admin-hint" data-admin-selected-count>{COPY.selectedCount(selection.chosen.length)}</p>
        <div className="admin-actions">
          <button type="button" className="admin-btn" data-admin-action="preview" aria-describedby="admin-preview-hint" disabled={!previewRequest.ok || !idle} onClick={() => void preview()}>
            {busy === 'preview' ? COPY.busy : COPY.previewButton}
          </button>
          <button type="button" className="admin-btn admin-btn--primary" data-admin-action="publish" aria-describedby="admin-publish-hint" disabled={!gate.enabled || !idle} onClick={() => void publish()}>
            {busy === 'publish' ? COPY.busy : COPY.publishButton}
          </button>
        </div>
        <p id="admin-preview-hint" className="admin-hint" data-admin-preview-hint>{previewRequest.ok ? '' : previewRequest.hint}</p>
        <p id="admin-publish-hint" className="admin-hint" data-admin-publish-hint>{gate.hint}</p>
      </section>

      {view !== null ? (
        <section className="admin-bundle-section" aria-labelledby="admin-bundle-preview-heading" aria-live="polite" data-admin-preview data-admin-preview-publishable={String(view.publishable)}>
          <h2 id="admin-bundle-preview-heading" className="admin-h2">{COPY.previewTitle}</h2>
          <p className="admin-hint">{COPY.previewNote}</p>
          <p className="admin-sub2" data-admin-preview-base>{view.baseText}</p>
          <p className="admin-note" data-admin-preview-summary>{view.summaryText}</p>
          {view.groups.map((group) => (
            <div key={group.kind} className="admin-preview-group" data-admin-preview-group={group.kind}>
              <h3 className="admin-h3">{group.title} ({group.items.length})</h3>
              {group.items.length === 0 ? (
                <p className="admin-hint">{COPY.groupEmpty}</p>
              ) : (
                <ul className="admin-preview-list admin-preview-items">
                  {group.items.map((item) => (
                    <li key={item.key} data-admin-preview-item data-admin-preview-kind={item.kind} data-admin-preview-id={item.id} data-admin-preview-source={item.source}>
                      <span className={`admin-pill admin-pill--${item.source === 'ADDED' ? 'added' : 'base'}`} data-admin-preview-source-text>{item.sourceText}</span>
                      <span data-admin-preview-item-text>{item.text}</span>
                      <span className="admin-bundle-note">{item.versionText} · {item.stateText}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {view.defectLines.length > 0 ? (
            <div className="admin-banner admin-banner--error" data-admin-preview-defects>
              <h3 className="admin-h3">{COPY.defectsTitle}</h3>
              <ul className="admin-preview-list">
                {view.defectLines.map((line, index) => (
                  <li key={`${line.code}-${index}`} data-admin-preview-defect={line.code}>{line.text}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.conflictLines.length > 0 ? (
            <div className="admin-banner admin-banner--error" data-admin-preview-conflicts>
              <h3 className="admin-h3">{COPY.conflictsTitle}</h3>
              <ul className="admin-preview-list">
                {view.conflictLines.map((line, index) => (
                  <li key={`${line.key}-${index}`} data-admin-preview-conflict={line.key}>{line.text}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.publishable ? (
            <p className="admin-banner admin-banner--ok" data-admin-preview-clean>{COPY.previewClean}</p>
          ) : (
            <p className="admin-hint" data-admin-preview-blocked>{COPY.previewBlocked}</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
