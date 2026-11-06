import { CHANGE_COPY as COPY } from './change-history-copy';
import type { ChangeHistoryEntryView, ChangeHistoryResponse } from './change-history-types';

// 변경 이력 화면의 순수 계산 (SPEC-REIMBURSEMENT-001 M7 변경 이력). 서버 응답을 화면 상태로 바꾸고 표시용 글자를 고른다. 읽기만 하고 어떤 값도 만들어 내지 않는다:
//  - 기록에 없는 과거 금액·상세 내용은 지금의 데이터로 짐작하지 않는다. 이전/이후 칸은 기록된 값(카탈로그 버전 또는 내용 지문)만 보인다.
//  - 서버가 낸 순서(최신순)를 그대로 쓴다. 화면이 시각으로 다시 정렬하지 않는다(시각이 같은 기록의 순서는 서버의 저장 순서가 정한다).

export type HistoryOutcome = { phase: 'ready'; data: ChangeHistoryResponse } | { phase: 'unauthenticated' | 'forbidden' | 'ambiguous' | 'notFound' | 'mismatch' | 'error' };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseEntry(value: unknown): ChangeHistoryEntryView | null {
  if (!isRecord(value)) return null;
  const { sequence, at, actor, action, target, beforeVersion, afterVersion, reason } = value;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || typeof at !== 'string' || typeof action !== 'string' || typeof target !== 'string') return null;
  if (!isRecord(actor) || typeof actor.id !== 'string' || typeof actor.role !== 'string') return null;
  if (!isNullableText(beforeVersion) || !isNullableText(afterVersion) || !isNullableText(reason)) return null;
  return { sequence, at, actor: { id: actor.id, role: actor.role }, action, target, beforeVersion, afterVersion, reason };
}

/** 서버 응답이 화면이 읽을 수 있는 모양이면 그 값을, 아니면 null 을 돌려준다(불러오지 못한 것으로 본다). 알 수 없는 속성은 옮기지 않는다. */
export function parseHistoryResponse(body: unknown): ChangeHistoryResponse | null {
  if (!isRecord(body)) return null;
  const { clinic, coveredActions, entries, page } = body;
  if (!isRecord(clinic) || typeof clinic.id !== 'string' || typeof clinic.displayName !== 'string') return null;
  if (!Array.isArray(coveredActions) || !coveredActions.every((action): action is string => typeof action === 'string')) return null;
  if (!Array.isArray(entries) || !isRecord(page)) return null;
  const { limit, returned, total, truncated } = page;
  if (!isCount(limit) || !isCount(returned) || !isCount(total) || typeof truncated !== 'boolean') return null;
  const parsed = entries.map(parseEntry);
  if (parsed.some((entry) => entry === null) || returned !== entries.length) return null;
  return { clinic: { id: clinic.id, displayName: clinic.displayName }, coveredActions: [...coveredActions], entries: parsed as ChangeHistoryEntryView[], page: { limit, returned, total, truncated } };
}

/**
 * 서버 응답(상태·본문)을 화면 단계로 바꾼다. 서버가 권위다: 401·403·404·409(병원을 하나로 정할 수 없음)는 안내로 보이고, 그 밖의 실패와 읽을 수 없는 본문은 불러오지 못한 것이다.
 * 이 화면의 주소에 있는 병원 id 는 위치 정보일 뿐이다: 서버가 정한 병원이 주소의 병원과 다르면 그 이력을 보이지 않는다(mismatch).
 */
export function outcomeOf(status: number, body: unknown, clinicId: string): HistoryOutcome {
  if (status === 401) return { phase: 'unauthenticated' };
  if (status === 403) return { phase: 'forbidden' };
  if (status === 404) return { phase: 'notFound' };
  if (status === 409) return isRecord(body) && body.reason === 'CLINIC_AMBIGUOUS' ? { phase: 'ambiguous' } : { phase: 'error' };
  if (status !== 200) return { phase: 'error' };
  const data = parseHistoryResponse(body);
  if (data === null) return { phase: 'error' };
  return data.clinic.id === clinicId ? { phase: 'ready', data } : { phase: 'mismatch' };
}

/** 동작의 사람이 읽는 이름. 모르는 동작은 기록된 코드를 그대로 보인다(이름을 지어내지 않는다). */
export const actionLabel = (action: string): string => COPY.actions[action] ?? action;

/** 대상의 종류. 기록된 대상 값 자체는 화면이 따로 보인다. */
export const targetLabel = (action: string): string => COPY.targets[action] ?? COPY.targetUnknown;

export const roleLabel = (role: string): string => COPY.roles[role] ?? role;

export interface VersionView {
  kind: 'none' | 'catalog' | 'digest';
  /** 화면에 보이는 글자. 내용 지문은 앞 12자만 보인다. */
  text: string;
  /** 기록된 전체 값(보이는 글자가 줄었을 때 마우스를 올리면 보인다). 없으면 null. */
  full: string | null;
}

const DIGEST_FORMAT = /^[0-9a-f]{64}$/;

/** 이전/이후 칸. 초안 게시는 카탈로그 버전 id, 그 밖의 동작은 내용 지문이다. 값이 없으면 "없음"이다. */
export function describeVersion(action: string, value: string | null): VersionView {
  if (value === null) return { kind: 'none', text: COPY.noVersion, full: null };
  if (action === 'CATALOG_DRAFT_PUBLISH') return { kind: 'catalog', text: value, full: value };
  return { kind: 'digest', text: DIGEST_FORMAT.test(value) ? `${value.slice(0, 12)}…` : value, full: value };
}

/** 서버가 알린 다루는 동작 목록으로 만든 안내 문장. 화면이 목록을 따로 정하지 않는다. */
export const scopeNotice = (coveredActions: readonly string[]): string => COPY.scopeNotice(coveredActions.map(actionLabel));

/** 가장 최근 기록만 돌려준 경우의 안내. 잘리지 않았으면 null. */
export const truncationNotice = (page: ChangeHistoryResponse['page']): string | null => (page.truncated ? COPY.truncated(page.returned, page.total) : null);
