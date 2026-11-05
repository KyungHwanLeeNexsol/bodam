import type { ApiFailure } from './api-types';
import { IDLE_COPY as COPY, IDLE_SCREEN_LABEL } from './idle-policy-copy';
import { IDLE_SCREEN_KINDS } from './idle-policy-types';
import type { IdlePolicyBody, IdlePolicyView, IdleScreenKind, IdleThreshold } from './idle-policy-types';
import type { Api } from './transport';

// 병원 무조작 정책 화면의 순수 계산 (SPEC-REIMBURSEMENT-001 M7 병원별 무조작 정책 설정). React·네트워크·시계를 쓰지 않는다.
// 서버가 권위이다: 여기서 보이는 안내(hint)는 입력을 막지 않는다. 값의 검사(정수·경고 < 초기화·간격 ≥ 하한)는 서버가 하고, 서버가 거절하면 화면은 그 결함을 문장으로 보인다.
//
// 저장(PUT)은 정책 전체를 바꾼다: 본문에 없는 화면 종류는 서버가 기본값으로 돌린다. 그래서 화면 상태는 화면 종류마다 "기본값을 따른다(useDefault)"를 따로 갖고,
//  - 서버에서 읽은 값으로 화면을 채울 때: 병원이 직접 저장한 종류(customizedScreens)만 useDefault=false 이다.
//  - 값을 고치면 그 종류는 useDefault=false 가 된다(직접 설정). "기본값으로 되돌리기" 는 값을 기본값으로 채우고 useDefault=true 로 한다.
//  - 저장 본문에는 useDefault=false 인 종류만 담는다 → 고치지 않은 직접 설정은 그대로 다시 보내져 잃지 않고, 기본값을 따르던 종류는 기본값을 따른 채로 남는다.

export interface RowForm {
  warn: string;
  reset: string;
  /** true 면 저장 본문에 담지 않는다(서버가 기본값으로 읽는다). */
  useDefault: boolean;
}

export interface FormState {
  rows: Record<IdleScreenKind, RowForm>;
  holdEnabled: boolean;
  holdText: string;
}

// ───────────────────────── 서버 값 ↔ 화면 상태 ─────────────────────────

export function formFromServer(view: IdlePolicyView): FormState {
  const rows = {} as Record<IdleScreenKind, RowForm>;
  for (const kind of IDLE_SCREEN_KINDS) {
    const threshold = view.idlePolicy.screens[kind];
    rows[kind] = { warn: String(threshold.warnSeconds), reset: String(threshold.resetSeconds), useDefault: !view.customizedScreens.includes(kind) };
  }
  const hold = view.idlePolicy.completionHoldSeconds;
  return { rows, holdEnabled: hold !== null, holdText: hold === null ? '' : String(hold) };
}

function updateRow(form: FormState, kind: IdleScreenKind, row: RowForm): FormState {
  return { ...form, rows: { ...form.rows, [kind]: row } };
}

/**
 * 값을 고친다. 서버에서 읽을 때 기본값을 따르던 종류(base.customizedScreens 에 없음)는 값이 기본값과 같아지는 동안 계속 기본값을 따른다
 * (101 로 고쳤다가 100 으로 되돌려도 직접 설정이 되어 저장되지 않는다). 그 밖의 경우 고치면 직접 설정이 된다.
 */
export function editRow(form: FormState, kind: IdleScreenKind, field: 'warn' | 'reset', text: string, base: IdlePolicyView): FormState {
  const row = form.rows[kind];
  const next = { ...row, [field]: text };
  const initial = base.defaults[kind];
  const followsDefault = !base.customizedScreens.includes(kind) && next.warn.trim() === String(initial.warnSeconds) && next.reset.trim() === String(initial.resetSeconds);
  return updateRow(form, kind, { ...next, useDefault: followsDefault });
}

export function revertRow(form: FormState, kind: IdleScreenKind, defaults: Record<IdleScreenKind, IdleThreshold>): FormState {
  const base = defaults[kind];
  return updateRow(form, kind, { warn: String(base.warnSeconds), reset: String(base.resetSeconds), useDefault: true });
}

export const setHoldEnabled = (form: FormState, enabled: boolean): FormState => ({ ...form, holdEnabled: enabled });
export const setHoldText = (form: FormState, text: string): FormState => ({ ...form, holdText: text });

// ───────────────────────── 저장 본문 ─────────────────────────

/** 정수로 읽을 수 있는 글자(숫자만)는 숫자로, 아니면 다듬은 글자 그대로 보낸다 — 화면이 값을 몰래 고치지 않고 서버가 거절하게 한다. */
function numberOrText(text: string): number | string {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

export function requestBodyOf(form: FormState): IdlePolicyBody {
  const screens: IdlePolicyBody['screens'] = {};
  for (const kind of IDLE_SCREEN_KINDS) {
    const row = form.rows[kind];
    if (!row.useDefault) screens[kind] = { warnSeconds: numberOrText(row.warn), resetSeconds: numberOrText(row.reset) };
  }
  // 자동 복귀를 켜지 않으면 null(자동 복귀 없음). 켰는데 비어 있으면 빈 글자를 그대로 보내 서버가 거절하게 한다: 기본 시간을 만들어 채우지 않는다.
  return { screens, completionHoldSeconds: form.holdEnabled ? numberOrText(form.holdText) : null };
}

/** 서버에 지금 저장된 값을 같은 모양의 본문으로 옮긴 것(화면을 고치지 않고 저장했을 때 보내게 될 본문). */
export function bodyOfServer(view: IdlePolicyView): IdlePolicyBody {
  return requestBodyOf(formFromServer(view));
}

/** 키 순서와 상관없이 같은 본문인지 비교하기 위한 정본 글자. */
function canonical(body: IdlePolicyBody): string {
  return JSON.stringify([IDLE_SCREEN_KINDS.map((kind) => [kind, body.screens[kind] ?? null]), body.completionHoldSeconds]);
}

/** 화면의 값이 서버에 저장된 값과 다른가(저장할 것이 있는가). */
export const isDirty = (form: FormState, view: IdlePolicyView): boolean => canonical(requestBodyOf(form)) !== canonical(bodyOfServer(view));

/** 두 서버 값이 같은 설정인가(직접 저장한 종류의 집합·값, 자동 복귀 값). 화면이 낡았는지(다른 곳에서 저장됐는지) 가릴 때 쓴다. */
export const sameServerSettings = (a: IdlePolicyView, b: IdlePolicyView): boolean => canonical(bodyOfServer(a)) === canonical(bodyOfServer(b));

/**
 * 서버가 지금 가진 값이 이 본문을 저장한 결과와 같은가(응답이 끊긴 저장이 서버에 반영됐는지 다시 읽은 값으로 가린다).
 * 직접 저장한 종류의 집합과 그 값, 자동 복귀 값이 모두 같아야 한다(본문에 없는 종류는 서버가 기본값으로 읽으므로 집합이 같으면 같다).
 * 본문에 글자(서버가 받을 수 없는 값)가 들어 있으면 서버 값은 숫자뿐이라 같을 수 없다.
 */
export const serverMatchesBody = (view: IdlePolicyView, body: IdlePolicyBody): boolean => canonical(bodyOfServer(view)) === canonical(body);

// ───────────────────────── 응답 모양 확인 ─────────────────────────

const isThreshold = (value: unknown): boolean => typeof value === 'object' && value !== null && typeof (value as IdleThreshold).warnSeconds === 'number' && typeof (value as IdleThreshold).resetSeconds === 'number';
const hasAllKinds = (map: unknown): boolean => typeof map === 'object' && map !== null && IDLE_SCREEN_KINDS.every((kind) => isThreshold((map as Record<string, unknown>)[kind]));

/** 200 응답 본문이 화면이 쓰는 모양인가. 아니면(프록시의 HTML 등) 값으로 쓰지 않는다. */
export function isPolicyView(value: unknown): value is IdlePolicyView {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Record<string, unknown>;
  const policy = view['idlePolicy'] as { screens?: unknown; completionHoldSeconds?: unknown } | null | undefined;
  return (
    typeof policy === 'object' &&
    policy !== null &&
    hasAllKinds(policy.screens) &&
    (policy.completionHoldSeconds === null || typeof policy.completionHoldSeconds === 'number') &&
    Array.isArray(view['customizedScreens']) &&
    hasAllKinds(view['defaults']) &&
    typeof view['minLeadSeconds'] === 'number' &&
    typeof view['clinic'] === 'object' &&
    view['clinic'] !== null
  );
}

// ───────────────────────── 입력 안내 (막지 않는다) ─────────────────────────

const isCount = (text: string): boolean => /^\d+$/.test(text.trim());

/** 화면 종류 하나의 입력 안내. 문제가 없으면 null. */
export function rowHint(row: RowForm, minLead: number): string | null {
  if (!isCount(row.warn) || !isCount(row.reset)) return COPY.hintInteger;
  return Number(row.reset.trim()) - Number(row.warn.trim()) < minLead ? COPY.hintLead(minLead) : null;
}

export function holdHint(form: FormState): string | null {
  if (!form.holdEnabled) return null;
  const text = form.holdText.trim();
  return isCount(text) && Number(text) >= 1 ? null : COPY.hintHold;
}

// ───────────────────────── 서버 거절 → 문장 ─────────────────────────

const PATH = /^screens\.([A-Z_]+)(?:\.(warnSeconds|resetSeconds))?$/;

function defectLine(defect: { code: string; path: string }, minLead: number): string {
  if (defect.path === 'completionHoldSeconds') return defect.code === 'VALUE_MISSING' ? COPY.failure.holdMissing : COPY.failure.holdInvalid;
  const match = PATH.exec(defect.path);
  const kind = match === null ? undefined : IDLE_SCREEN_KINDS.find((candidate) => candidate === match[1]);
  const screen = kind === undefined ? null : IDLE_SCREEN_LABEL[kind].name;
  if (defect.code === 'SCREEN_UNKNOWN') return COPY.failure.screenUnknown;
  if (screen === null || match === null) return COPY.failure.other;
  const field = match[2];
  if (defect.code === 'LEAD_TIME_TOO_SHORT') return COPY.failure.lead(screen, minLead);
  if (defect.code === 'VALUE_MISSING') return field === 'resetSeconds' ? COPY.failure.resetMissing(screen) : COPY.failure.warnMissing(screen);
  return field === 'resetSeconds' ? COPY.failure.resetInvalid(screen) : COPY.failure.warnInvalid(screen);
}

/** 저장이 서버에서 분명히 거절된 응답(4xx)의 문장. 코드 글자를 보이지 않고, 늘 서버의 설정이 바뀌지 않았다는 말로 끝난다. */
export function saveFailureMessage(result: Api<unknown>, minLead: number): string {
  const failure = result.body as ApiFailure;
  switch (result.status) {
    case 401:
      return COPY.failure.unauthenticated;
    case 403:
      return COPY.failure.forbidden;
    case 404:
      return COPY.failure.notFound;
    case 400: {
      const lines = [...new Set((failure.defects ?? []).map((defect) => defectLine(defect, minLead)))];
      return lines.length === 0 ? COPY.failure.generic : `${COPY.failure.invalidIntro} ${lines.slice(0, 6).join(' ')} ${COPY.failure.invalidEnd}`;
    }
    default:
      return COPY.failure.generic;
  }
}

/** 응답을 받았지만 결과를 믿을 수 없는 경우(서버 오류): 저장 여부를 단정하지 않고 서버 값을 다시 읽는다. */
export const isOutcomeUnknown = (status: number): boolean => status >= 500;
