'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { formatSeoulMinute } from '../clock';
import type { SessionResponse } from './api-types';
import { AdminNav } from './AdminNav';
import {
  GENERATION_CHOICES,
  INSURER_TYPE_CHOICES,
  basisText,
  classificationNotice,
  currentStateDisplay,
  initialMappingForm,
  mappingBodyOf,
  mappingFailureMessage,
  mappingSuccessMessage,
  rejectReasonProblem,
  scopeKey,
  stageOf,
  toggleScope,
} from './mapping-model';
import type { MappingAction, MappingForm, MappingProblem } from './mapping-model';
import { MAPPING_COPY as MAPPING, REVIEW_COPY as COPY } from './review-copy';
import { currentLines, differingFieldsOf, proposedLines, publishedValuesOf, statusLabel } from './review-model';
import type { ValueField, ValueLines } from './review-model';
import type { EntryResponse, MappingSummaryView, ReviewHistoryEntry, ReviewHistoryResponse, ReviewQueueEntry, ReviewQueueResponse } from './review-types';
import { adminRequest as request } from './transport';

// 검토 대기열 화면 (SPEC-REIMBURSEMENT-001 M7 검토 요청·매핑 검토). 검토 담당자(RV)가 모든 병원의 처리 전 검토 요청을 읽고,
// 요청마다 매핑 초안 작성 → 검토 제출 → (작성자가 아닌) 다른 검토 담당자의 승인 또는 사유와 함께 반려까지 처리한다.
// 승인은 검토 기록이다: 이 화면의 어느 문구도 승인이 환자 화면·키오스크 계산에 반영되었다고 말하지 않는다(규칙 묶음 게시는 이 화면의 일이 아니다).
// 접근 판정·자료·모든 규칙(본인 승인 금지·작성자만 제출·현재 게시 상태·검토 기준)은 서버가 한다. 이 화면은 401·403 응답을 안내로 보이고, 로그인한 사용자 id 는
// 단추를 보이고 숨기는 안내에만 쓴다(서버가 같은 규칙을 다시 거절한다). 시험 문구이며 최종 보험 안내 문구가 아니다.

type Phase = 'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'ready';
type Banner = { kind: 'ok' | 'error'; text: string; requestId: string | null };

function ValueBlock({ label, kind, lines, differs, absent }: { label: string; kind: 'current' | 'proposed'; lines: ValueLines | null; differs: readonly ValueField[]; absent: ReactElement | null }): ReactElement {
  const mark = (field: ValueField): { 'data-differs'?: 'true' } => (kind === 'proposed' && differs.includes(field) ? { 'data-differs': 'true' } : {});
  return (
    <div className="admin-queue-values" data-admin-queue-values={kind}>
      <span className="admin-sub2">{label}</span>
      {lines === null ? (
        absent
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

/** 현재 게시값이 없는 이유를 네 상태마다 다른 말로 보인다(숨김 · 목록에 없음 · 읽지 못함). 읽지 못한 것을 "목록에 없다"고 말하지 않는다. */
function absentText(entry: ReviewQueueEntry): ReactElement | null {
  const display = currentStateDisplay(entry.current);
  if (display.text === null) return null;
  const attribute = display.state === 'HIDDEN' ? { 'data-admin-queue-hidden': '' } : display.state === 'UNREADABLE' ? { 'data-admin-queue-unreadable': '' } : { 'data-admin-queue-not-published': '' };
  return <span {...attribute}>{display.text}</span>;
}

const decisionLabel = (decision: 'COVERED' | 'EXCLUDED'): string => (decision === 'COVERED' ? MAPPING.decisionCovered : MAPPING.decisionExcluded);

const scopeText = (scope: MappingSummaryView['scope']): string =>
  scope
    .map((cell) => `${GENERATION_CHOICES.find((choice) => choice.code === cell.generation)?.label ?? cell.generation} · ${INSURER_TYPE_CHOICES.find((choice) => choice.code === cell.insurerType)?.label ?? cell.insurerType}`)
    .join(' / ');

/** 매핑 초안 요약(읽기 전용). */
function MappingSummary({ mapping }: { mapping: MappingSummaryView }): ReactElement {
  const source = mapping.policySources[0];
  return (
    <dl className="admin-queue-lines admin-queue-mapping" data-admin-stage-summary>
      <div>
        <dt>{MAPPING.authorLabel}</dt>
        <dd data-admin-stage-author>{mapping.authorId}</dd>
      </div>
      <div>
        <dt>{MAPPING.decisionLabel}</dt>
        <dd data-admin-stage-decision>{decisionLabel(mapping.decision)}</dd>
      </div>
      {mapping.groupKey !== null ? (
        <div>
          <dt>{MAPPING.groupKeyLabel}</dt>
          <dd>{mapping.groupKey}</dd>
        </div>
      ) : null}
      {mapping.exclusionReason !== null ? (
        <div>
          <dt>{MAPPING.exclusionReasonLabel}</dt>
          <dd>{mapping.exclusionReason}</dd>
        </div>
      ) : null}
      <div>
        <dt>{MAPPING.scopeLabel}</dt>
        <dd>{scopeText(mapping.scope)}</dd>
      </div>
      <div>
        <dt>{MAPPING.validityLabel}</dt>
        <dd>{mapping.validity.from} ~ {mapping.validity.to}</dd>
      </div>
      {source !== undefined ? (
        <div>
          <dt>{MAPPING.sourceLabel}</dt>
          <dd>{source.insurerDocumentId} · {source.clauseOrPage}</dd>
        </div>
      ) : null}
    </dl>
  );
}

const PROBLEM_TEXT = (problem: MappingProblem): string => (problem.startsWith('source.') ? MAPPING.formProblems.source : MAPPING.formProblems[problem as Exclude<MappingProblem, `source.${string}`>]);

/** 매핑 초안 입력 양식. 입력 확인은 안내일 뿐이고 서버가 같은 검사를 다시 한다. */
function DraftForm({
  requestId,
  form,
  problems,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  requestId: string;
  form: MappingForm;
  problems: readonly MappingProblem[];
  busy: boolean;
  onChange: (next: MappingForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
}): ReactElement {
  const sourceKeys = Object.keys(MAPPING.sourceFields) as Array<keyof typeof MAPPING.sourceFields>;
  const shown = [...new Set(problems.map(PROBLEM_TEXT))];
  return (
    <form
      className="admin-queue-form"
      data-admin-draft-form={requestId}
      aria-label={MAPPING.formTitle}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
    >
      <p className="admin-hint" data-admin-draft-test-data>{MAPPING.formTestData}</p>
      <fieldset className="admin-fieldset admin-queue-fieldset">
        <legend>{MAPPING.fieldDecision}</legend>
        <label className="admin-check">
          <input type="radio" name={`decision-${requestId}`} checked={form.decision === 'COVERED'} onChange={() => onChange({ ...form, decision: 'COVERED' })} />
          {MAPPING.formCovered}
        </label>
        <label className="admin-check">
          <input type="radio" name={`decision-${requestId}`} checked={form.decision === 'EXCLUDED'} onChange={() => onChange({ ...form, decision: 'EXCLUDED' })} />
          {MAPPING.formExcluded}
        </label>
      </fieldset>
      {form.decision === 'COVERED' ? (
        <label className="admin-label">
          {MAPPING.fieldGroupKey}
          <input className="admin-input admin-input--text" autoComplete="off" value={form.groupKey} aria-invalid={problems.includes('groupKey')} onChange={(event) => onChange({ ...form, groupKey: event.target.value })} />
        </label>
      ) : (
        <label className="admin-label">
          {MAPPING.fieldExclusionReason}
          <input className="admin-input admin-input--text" autoComplete="off" value={form.exclusionReason} aria-invalid={problems.includes('exclusionReason')} onChange={(event) => onChange({ ...form, exclusionReason: event.target.value })} />
        </label>
      )}
      <fieldset className="admin-fieldset admin-queue-fieldset">
        <legend>{MAPPING.fieldScope}</legend>
        <table className="admin-table admin-queue-scope" data-admin-draft-scope>
          <thead>
            <tr>
              <th scope="col"><span className="admin-label-text">세대</span></th>
              {INSURER_TYPE_CHOICES.map((insurer) => (
                <th scope="col" key={insurer.code}>{insurer.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GENERATION_CHOICES.map((generation) => (
              <tr key={generation.code}>
                <th scope="row">{generation.label}</th>
                {INSURER_TYPE_CHOICES.map((insurer) => (
                  <td key={insurer.code}>
                    <input
                      type="checkbox"
                      aria-label={`${generation.label} · ${insurer.label}`}
                      checked={form.scope.includes(scopeKey(generation.code, insurer.code))}
                      onChange={() => onChange(toggleScope(form, scopeKey(generation.code, insurer.code)))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <div className="admin-queue-dates">
        <label className="admin-label">
          {MAPPING.fieldValidFrom}
          <input className="admin-input" autoComplete="off" placeholder="YYYY-MM-DD" value={form.validFrom} aria-invalid={problems.includes('validFrom') || problems.includes('validRange')} onChange={(event) => onChange({ ...form, validFrom: event.target.value })} />
        </label>
        <label className="admin-label">
          {MAPPING.fieldValidTo}
          <input className="admin-input" autoComplete="off" placeholder="YYYY-MM-DD" value={form.validTo} aria-invalid={problems.includes('validTo') || problems.includes('validRange')} onChange={(event) => onChange({ ...form, validTo: event.target.value })} />
        </label>
      </div>
      <fieldset className="admin-fieldset admin-queue-fieldset">
        <legend>{MAPPING.fieldSourceTitle}</legend>
        {sourceKeys.map((key) => (
          <label className="admin-label" key={key}>
            {MAPPING.sourceFields[key]}
            <input
              className="admin-input admin-input--text"
              autoComplete="off"
              value={form.source[key]}
              aria-invalid={problems.includes(`source.${key}`)}
              onChange={(event) => onChange({ ...form, source: { ...form.source, [key]: event.target.value } })}
            />
          </label>
        ))}
      </fieldset>
      {shown.length > 0 ? (
        <ul role="alert" className="admin-banner admin-banner--error admin-queue-problems" data-admin-draft-problems>
          {shown.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : null}
      <div className="admin-actions">
        <button type="submit" className="admin-btn admin-btn--primary" disabled={busy}>{busy ? MAPPING.busy : MAPPING.formSubmit}</button>
        <button type="button" className="admin-btn" disabled={busy} onClick={onCancel}>{MAPPING.cancel}</button>
      </div>
    </form>
  );
}

export function ReviewQueue(): ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [viewer, setViewer] = useState<string | null>(null);
  const [queue, setQueue] = useState<ReviewQueueEntry[]>([]);
  const [closed, setClosed] = useState<ReviewHistoryEntry[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [form, setForm] = useState<MappingForm>(initialMappingForm());
  const [problems, setProblems] = useState<MappingProblem[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reasonProblem, setReasonProblem] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const sessionResult = await request<SessionResponse>('GET', '/api/admin/session', undefined, signal);
        if (sessionResult.status === 200) setViewer((sessionResult.body as SessionResponse).userId);
        const result = await request<ReviewQueueResponse>('GET', '/api/admin/review-queue', undefined, signal);
        if (result.status === 401) return setPhase('unauthenticated');
        if (result.status === 403) return setPhase('forbidden');
        if (result.status !== 200) return setPhase('error');
        const done = await request<ReviewHistoryResponse>('GET', '/api/admin/review-history', undefined, signal);
        if (done.status !== 200) return setPhase('error');
        setQueue((result.body as ReviewQueueResponse).queue);
        setClosed((done.body as ReviewHistoryResponse)['history']);
        setPhase('ready');
      } catch {
        if (!signal.aborted) setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  /** 서버의 현재 상태(대기열과 처리 완료)를 다시 읽는다. 읽지 못해도 화면의 입력은 건드리지 않는다. */
  const refresh = useCallback(async () => {
    const result = await request<ReviewQueueResponse>('GET', '/api/admin/review-queue');
    if (result.status === 200) setQueue((result.body as ReviewQueueResponse).queue);
    const done = await request<ReviewHistoryResponse>('GET', '/api/admin/review-history');
    if (done.status === 200) setClosed((done.body as ReviewHistoryResponse)['history']);
  }, []);

  /** 쓰기 요청 하나. 성공하든 거절되든 서버의 현재 상태로 다시 읽는다. 거절 문장은 입력과 요청을 바꾸지 않았다는 말로 끝난다. */
  const act = async (action: MappingAction, requestId: string, path: string, body: unknown): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setMessage(null);
    try {
      const result = await request<EntryResponse>('POST', path, body);
      if (result.status !== 200) {
        setMessage({ kind: 'error', text: mappingFailureMessage(result, action), requestId });
        await refresh();
        return false;
      }
      setMessage({ kind: 'ok', text: mappingSuccessMessage(action), requestId: null });
      await refresh();
      return true;
    } catch {
      setMessage({ kind: 'error', text: mappingFailureMessage({ status: 500, body: { error: 'INTERNAL' } }, action), requestId });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const itemPath = (entry: ReviewQueueEntry, step: 'submit' | 'approve' | 'reject'): string =>
    entry.mapping === null ? '' : `/api/admin/mappings/${encodeURIComponent(entry.mapping.ref.id)}/versions/${encodeURIComponent(entry.mapping.ref.version)}/${step}`;

  const openDraft = (requestId: string): void => {
    setDraftFor(requestId);
    setForm(initialMappingForm());
    setProblems([]);
    setMessage(null);
  };

  const submitDraft = async (entry: ReviewQueueEntry): Promise<void> => {
    const built = mappingBodyOf(form);
    if (!built.ok) {
      setProblems(built.problems);
      return;
    }
    setProblems([]);
    const done = await act('draft', entry.id, `/api/admin/review-requests/${encodeURIComponent(entry.id)}/mappings`, built.body);
    if (done) setDraftFor(null);
  };

  const submitReview = (entry: ReviewQueueEntry): Promise<boolean> => act('submit', entry.id, itemPath(entry, 'submit'), { reviewRequestId: entry.id });
  const approve = (entry: ReviewQueueEntry): Promise<boolean> => act('approve', entry.id, itemPath(entry, 'approve'), { reviewRequestId: entry.id });

  const reject = async (entry: ReviewQueueEntry): Promise<void> => {
    const text = reasons[entry.id] ?? '';
    const problem = rejectReasonProblem(text);
    setReasonProblem(problem === null ? null : entry.id);
    if (problem !== null) return;
    const done = await act('reject', entry.id, itemPath(entry, 'reject'), { reviewRequestId: entry.id, reason: text });
    if (done) setReasons({ ...reasons, [entry.id]: '' });
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

  const inQueue = new Set(queue.map((entry) => entry.id));
  const topMessage = message !== null && (message.requestId === null || !inQueue.has(message.requestId)) ? message : null;

  return (
    <main className="admin-root" data-admin-state="ready" data-admin-page="review-queue">
      <header className="admin-header">
        <AdminNav current="review-queue" />
        <h1 className="admin-title">{COPY.queueTitle}</h1>
        <p className="admin-note" data-admin-queue-note>{COPY.queueNote}</p>
        <p className="admin-sub2">{MAPPING.sessionAs}: <span data-admin-user>{viewer ?? '-'}</span></p>
      </header>

      <div aria-live="polite" className="admin-live">
        {topMessage !== null ? (
          <p role={topMessage.kind === 'error' ? 'alert' : 'status'} className={`admin-banner admin-banner--${topMessage.kind}`} data-admin-message={topMessage.kind}>
            {topMessage.text}
          </p>
        ) : null}
      </div>

      {queue.length === 0 ? (
        <p className="admin-banner" data-admin-queue-empty>{COPY.queueEmpty}</p>
      ) : (
        <ul className="admin-queue-list" data-admin-queue-list>
          {queue.map((entry) => {
            const stage = stageOf(entry, viewer);
            const notice = classificationNotice(entry.classification);
            const differs = differingFieldsOf(entry.current, entry.proposed);
            const display = currentStateDisplay(entry.current);
            const mine = message !== null && message.requestId === entry.id ? message : null;
            return (
              <li key={entry.id} className="admin-queue-entry" data-admin-queue-row={entry.id}>
                <div className="admin-queue-head">
                  <span className="admin-name" data-admin-queue-treatment>{entry.treatmentName ?? entry.treatmentId}</span>
                  <span className="admin-pill" data-admin-queue-status={entry.status}>{statusLabel(entry)}</span>
                </div>
                <dl className="admin-queue-meta">
                  <div>
                    <dt>{COPY.colClinic}</dt>
                    <dd data-admin-queue-clinic>{entry.clinic.name}</dd>
                  </div>
                  <div>
                    <dt>{COPY.colRequestedAt}</dt>
                    <dd data-admin-queue-requested-at>{formatSeoulMinute(entry.requestedAt)}</dd>
                  </div>
                  <div>
                    <dt>{COPY.colRequestedBy}</dt>
                    <dd data-admin-queue-requester>{entry.requestedBy}</dd>
                  </div>
                </dl>

                <div className="admin-queue-columns">
                  <div data-admin-queue-current-state={display.state}>
                    <ValueBlock label={COPY.currentLabel} kind="current" lines={currentLines(publishedValuesOf(entry.current))} differs={differs} absent={absentText(entry)} />
                  </div>
                  <ValueBlock label={COPY.proposedLabel} kind="proposed" lines={proposedLines(entry.proposed)} differs={differs} absent={null} />
                </div>

                {notice !== null ? (
                  <p className="admin-banner admin-queue-notice" role="note" data-admin-queue-classification={entry.classification}>{notice}</p>
                ) : null}
                <p className="admin-hint admin-queue-reflection" data-admin-queue-reflection>{MAPPING.reflectionNote}</p>

                <section className="admin-queue-stage" aria-label={MAPPING.stageTitle} data-admin-queue-stage={stage.kind}>
                  <h2 className="admin-h3">{MAPPING.stageTitle}</h2>
                  {stage.kind === 'NO_MAPPING' ? (
                    <>
                      <p className="admin-hint">{MAPPING.noMapping}</p>
                      <div className="admin-actions">
                        <button type="button" className="admin-btn admin-btn--primary" disabled={busy || !stage.canDraft || draftFor === entry.id} onClick={() => openDraft(entry.id)}>
                          {MAPPING.draftButton}
                        </button>
                      </div>
                      {stage.draftBlockedText !== null ? <p className="admin-hint" data-admin-stage-blocked>{stage.draftBlockedText}</p> : null}
                      {draftFor === entry.id && stage.canDraft ? (
                        <DraftForm
                          requestId={entry.id}
                          form={form}
                          problems={problems}
                          busy={busy}
                          onChange={(next) => setForm(next)}
                          onSubmit={() => void submitDraft(entry)}
                          onCancel={() => { setDraftFor(null); setProblems([]); }}
                        />
                      ) : null}
                    </>
                  ) : null}

                  {entry.mapping !== null ? <MappingSummary mapping={entry.mapping} /> : null}

                  {stage.kind === 'DRAFT' ? (
                    <div className="admin-actions">
                      {stage.canSubmit ? (
                        <button type="button" className="admin-btn admin-btn--primary" disabled={busy} onClick={() => void submitReview(entry)}>{MAPPING.submitButton}</button>
                      ) : (
                        <span className="admin-hint" data-admin-stage-waiting>{MAPPING.waitingForAuthor(stage.waitingForAuthor ?? '')}</span>
                      )}
                    </div>
                  ) : null}

                  {stage.kind === 'REVIEW' ? (
                    <>
                      <p className="admin-hint" data-admin-stage-basis={entry.basis.check}>{MAPPING.basisLabel}: {basisText(entry.basis)}</p>
                      {stage.authorCannotApprove ? <p className="admin-banner" data-admin-stage-author-note>{MAPPING.authorCannotApprove}</p> : null}
                      <div className="admin-actions">
                        {stage.showApprove ? (
                          <button type="button" className="admin-btn admin-btn--primary" disabled={busy || !stage.approveEnabled} onClick={() => void approve(entry)}>{MAPPING.approveButton}</button>
                        ) : null}
                      </div>
                      {stage.approveBlockedText !== null ? <p className="admin-hint" data-admin-stage-blocked>{stage.approveBlockedText}</p> : null}
                      <div className="admin-queue-reject">
                        <label className="admin-label">
                          {MAPPING.rejectReasonLabel}
                          <textarea
                            className="admin-input admin-textarea"
                            rows={2}
                            value={reasons[entry.id] ?? ''}
                            aria-invalid={reasonProblem === entry.id}
                            onChange={(event) => {
                              setReasons({ ...reasons, [entry.id]: event.target.value });
                              if (reasonProblem === entry.id) setReasonProblem(null);
                            }}
                          />
                        </label>
                        {reasonProblem === entry.id ? <span role="alert" className="admin-field-error" data-admin-reject-problem>{MAPPING.rejectReasonRequired}</span> : null}
                        <div className="admin-actions">
                          <button type="button" className="admin-btn" disabled={busy} onClick={() => void reject(entry)}>{MAPPING.rejectButton}</button>
                        </div>
                      </div>
                    </>
                  ) : null}

                  {mine !== null ? (
                    <p role={mine.kind === 'error' ? 'alert' : 'status'} className={`admin-banner admin-banner--${mine.kind}`} data-admin-message={mine.kind}>{mine.text}</p>
                  ) : null}
                </section>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="admin-queue-closed-heading" data-admin-queue-done>
        <h2 id="admin-queue-closed-heading" className="admin-h2">{MAPPING.historyTitle}</h2>
        <p className="admin-hint">{MAPPING.historyNote}</p>
        {closed.length === 0 ? (
          <p className="admin-hint" data-admin-done-empty>{MAPPING.historyEmpty}</p>
        ) : (
          <ul className="admin-queue-list">
            {closed.map((entry) => (
              <li key={entry.id} className="admin-queue-entry admin-queue-entry--done" data-admin-done-item={entry.id}>
                <div className="admin-queue-head">
                  <span className="admin-name" data-admin-done-treatment>{entry.treatmentName ?? entry.treatmentId}</span>
                  <span className="admin-pill" data-admin-done-status={entry.status}>{statusLabel(entry)}</span>
                </div>
                <dl className="admin-queue-meta">
                  <div>
                    <dt>{COPY.colClinic}</dt>
                    <dd>{entry.clinic.name}</dd>
                  </div>
                  <div>
                    <dt>{MAPPING.historyClosedBy}</dt>
                    <dd data-admin-done-closed-by>{entry.closedBy ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>{MAPPING.historyClosedAt}</dt>
                    <dd data-admin-done-closed-at>{entry.closedAt === null ? '-' : formatSeoulMinute(entry.closedAt)}</dd>
                  </div>
                  <div>
                    <dt>{MAPPING.historyResultMapping}</dt>
                    <dd data-admin-done-result>{entry.resultMappingRef === null ? MAPPING.historyNoResultMapping : `${entry.resultMappingRef.id} (v${entry.resultMappingRef.version})`}</dd>
                  </div>
                </dl>
                {entry.rejectionReason !== null ? <p className="admin-sub2" data-admin-done-reason>{COPY.rejectionReasonLabel}: {entry.rejectionReason}</p> : null}
                <p className="admin-hint" data-admin-queue-reflection>{MAPPING.reflectionNote}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
