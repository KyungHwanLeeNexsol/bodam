import { formatSeoulMinute } from '../clock';
import type { ApiFailure } from './api-types';
import { SCOPE_COPY as COPY } from './bundle-copy';
import { bundleStatusText, shortBundleId } from './bundle-model';
import type { BundleAvailability, BundleSummary, ClinicScopeRow } from './bundle-types';
import type { Api } from './transport';

// 규칙 사용 범위 화면의 순수 계산 (SPEC-REIMBURSEMENT-001 M7 묶음 구성, 역할 PO). React·네트워크·시계를 쓰지 않는다.
// 서버가 권위이다: 여기서 정하는 "적용 단추가 눌린다"는 화면의 안내일 뿐이고, 병원·묶음 존재와 화면이 본 현재 적용본의 비교(SCOPE_CHANGED)는 서버가 한다.
// 지정은 병원 한 곳씩이다: 이 파일에는 여러 병원을 한꺼번에 바꾸는 계산이 없다.

// ───────────────────────── 현재 적용본 ─────────────────────────

export interface CurrentView {
  /** 현재 적용본의 전체 묶음 id. 지정된 묶음이 없으면 null. */
  bundleId: string | null;
  /** 화면에 보이는 한 줄(줄인 id 또는 "지정된 묶음 없음"). */
  text: string;
  status: BundleAvailability | null;
  statusText: string | null;
  assignedText: string | null;
  /** 현재 적용본이 중지된 묶음일 때의 안내. 아니면 null. */
  note: string | null;
}

export function currentView(row: ClinicScopeRow): CurrentView {
  if (row.current === null) return { bundleId: null, text: COPY.currentNone, status: null, statusText: null, assignedText: null, note: null };
  const { bundleId, status, assignedAt, assignedBy } = row.current;
  return {
    bundleId,
    text: shortBundleId(bundleId),
    status,
    statusText: bundleStatusText(status),
    assignedText: COPY.assignedLine(formatSeoulMinute(assignedAt), assignedBy),
    note: status === 'SUSPENDED' ? COPY.currentSuspendedNote : null,
  };
}

// ───────────────────────── 바꿀 묶음 ─────────────────────────

export interface BundleOption {
  value: string;
  label: string;
  /** 사용 가능한 묶음만 고를 수 있다. 중지된 묶음(과 상태를 알 수 없는 묶음)은 목록에 있되 고를 수 없고, 이유가 label 에 글로 있다. */
  disabled: boolean;
  status: BundleAvailability | null;
}

const isSelectable = (bundle: Pick<BundleSummary, 'status'>): boolean => bundle.status === 'ACTIVE';

export function bundleOptions(bundles: readonly BundleSummary[]): BundleOption[] {
  return bundles.map((bundle) => {
    const line = COPY.optionLine(shortBundleId(bundle.bundleId), bundleStatusText(bundle.status), formatSeoulMinute(bundle.publishedAt));
    return { value: bundle.bundleId, label: isSelectable(bundle) ? line : COPY.optionSuspended(line), disabled: !isSelectable(bundle), status: bundle.status };
  });
}

// ───────────────────────── 적용 확인 ─────────────────────────

export interface ConfirmState {
  enabled: boolean;
  /** 고른 묶음이 다를 때의 "현재 X → 바꿀 Y" 한 줄. 확인할 수 없으면 null. */
  line: string | null;
  /** 확인할 수 없는 이유(고르지 않았으면 null). */
  hint: string | null;
}

/** 이 병원 줄에서 고른 묶음(selectedId, ''이면 고르지 않음)을 적용 확인할 수 있는가. */
export function confirmStateOf(row: ClinicScopeRow, selectedId: string, bundles: readonly BundleSummary[]): ConfirmState {
  if (selectedId === '') return { enabled: false, line: null, hint: null };
  const chosen = bundles.find((bundle) => bundle.bundleId === selectedId);
  if (chosen === undefined) return { enabled: false, line: null, hint: COPY.failure.notFound };
  if (!isSelectable(chosen)) return { enabled: false, line: null, hint: COPY.suspendedHint };
  if (row.current !== null && row.current.bundleId === selectedId) return { enabled: false, line: null, hint: COPY.sameAsCurrent };
  return { enabled: true, line: COPY.changeLine(row.current === null ? COPY.currentNone : shortBundleId(row.current.bundleId), shortBundleId(selectedId)), hint: null };
}

export interface AssignRequest {
  ruleBundleVersionId: string;
  /** 화면이 불러온 이 병원의 현재 적용본 묶음 id. 지정된 묶음이 없었으면 null. 서버가 그 사이 바뀌었는지 본다. */
  expectedCurrentBundleId: string | null;
}

/** 요청 본문. 병원은 경로가 정하므로 본문에 없다. 확인할 수 없는 선택이면 null. */
export function assignRequestOf(row: ClinicScopeRow, selectedId: string, bundles: readonly BundleSummary[]): AssignRequest | null {
  return confirmStateOf(row, selectedId, bundles).enabled ? { ruleBundleVersionId: selectedId, expectedCurrentBundleId: row.current === null ? null : row.current.bundleId } : null;
}

// ───────────────────────── 줄 갱신 · 선택 유지 ─────────────────────────

/** 지정 응답의 병원 줄로 그 병원만 바꾼다. 다른 병원 줄은 같은 객체 그대로다. */
export function applyAssigned(rows: readonly ClinicScopeRow[], updated: ClinicScopeRow): ClinicScopeRow[] {
  return rows.map((row) => (row.clinicId === updated.clinicId ? updated : row));
}

/** 병원 id → 고른 묶음 id. 고르지 않은 병원은 키가 없다. */
export type Drafts = Readonly<Record<string, string>>;

/**
 * 전체를 다시 불러온 뒤 병원별 선택을 정리한다. 현재 적용본이 그대로이고 고른 묶음이 여전히 고를 수 있는 병원의 선택만 남긴다.
 * resetClinicIds(거절된 병원)의 선택은 지운다: 화면이 본 값이 틀렸으니 운영자가 다시 고르게 한다.
 */
export function reconcileDrafts(drafts: Drafts, oldRows: readonly ClinicScopeRow[], newRows: readonly ClinicScopeRow[], bundles: readonly BundleSummary[], resetClinicIds: readonly string[]): Drafts {
  const out: Record<string, string> = {};
  const currentOf = (rows: readonly ClinicScopeRow[], clinicId: string): string | null | undefined => {
    const found = rows.find((row) => row.clinicId === clinicId);
    return found === undefined ? undefined : found.current === null ? null : found.current.bundleId;
  };
  for (const [clinicId, selectedId] of Object.entries(drafts)) {
    const before = currentOf(oldRows, clinicId);
    const after = currentOf(newRows, clinicId);
    const bundle = bundles.find((entry) => entry.bundleId === selectedId);
    if (selectedId !== '' && !resetClinicIds.includes(clinicId) && after !== undefined && before === after && bundle !== undefined && isSelectable(bundle)) out[clinicId] = selectedId;
  }
  return out;
}

// ───────────────────────── 서버 거절 · 성공 안내 ─────────────────────────

/** 서버 거절을 문장으로. 코드 글자를 보이지 않고, 늘 이 병원의 지정이 바뀌지 않았다는 말로 끝난다. */
export function scopeFailureMessage(result: Api<unknown>): string {
  const failure = result.body as ApiFailure;
  let core: string;
  switch (result.status) {
    case 401:
      core = COPY.unauthenticated;
      break;
    case 403:
      core = COPY.forbidden;
      break;
    case 404:
      core = COPY.failure.notFound;
      break;
    case 409:
      core = failure.reason === 'SCOPE_CHANGED' ? COPY.failure.scopeChanged : COPY.failure.conflictGeneric;
      break;
    case 400:
      core = COPY.failure.generic;
      break;
    default:
      core = result.status >= 500 ? COPY.failure.server : COPY.failure.generic;
  }
  return `${core} ${COPY.nothingChanged}`;
}

export const assignedMessage = (clinicName: string, bundleId: string): string => COPY.assigned(clinicName, shortBundleId(bundleId));
