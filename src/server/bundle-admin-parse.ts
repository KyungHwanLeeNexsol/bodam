import type { Defect } from './domain/errors';
import type { ItemVersionRef } from './domain/items';
import { PUBLISH_CONFIRMATION_PATTERN } from './publish-confirmation';
import { isNonEmptyString, isPlainObject } from './validate/shape';

// 묶음 구성과 규칙 사용 범위 지정 요청 본문의 형식 검사 (M7 묶음 구성, mapping-review-parse.ts 와 같은 방식). 순수 함수다: 저장소를 읽지 않고, 던지지 않고, 입력을 바꾸지 않는다.
// 이 파일은 "모양"만 본다. 기준 묶음이 있는지·ACTIVE 인지·매핑이 있는지·충돌·확인값이 맞는지는 서비스(bundle-compose.ts, rule-scope-admin.ts)가 저장소를 읽어 본다.
// 모든 단계의 키가 엄격하다: 아래 말고는 모두 UNKNOWN_FIELD 다. 행위자·역할·병원 id·항목 종류는 본문으로 받지 않는다 — 매핑의 종류는 서버가 MAPPING 으로 붙이고,
// 병원 id 는 경로가 정하며, 행위자는 검증된 신원이 정한다.
//
// 미리보기 본문  { baseBundleId, mappings: [{ id, version }] }
// 게시 본문      { baseBundleId, mappings: [{ id, version }], publishConfirmation }   (확인값: 소문자 16진수 64자)
// 범위 지정 본문 { ruleBundleVersionId, expectedCurrentBundleId }   (expectedCurrentBundleId 키는 필수이고 null 이 "범위가 없다고 보았다"는 뜻이다)
// 중지 본문      { reason }   (묶음 id 는 경로가 정한다. 사유가 비었는지는 서비스가 본다)

const PREVIEW_KEYS: readonly string[] = ['baseBundleId', 'mappings'];
const PUBLISH_KEYS: readonly string[] = ['baseBundleId', 'mappings', 'publishConfirmation'];
const MAPPING_KEYS: readonly string[] = ['id', 'version'];
const ASSIGN_KEYS: readonly string[] = ['ruleBundleVersionId', 'expectedCurrentBundleId'];
const SUSPEND_KEYS: readonly string[] = ['reason'];

const missingOrInvalid = (value: unknown): string => (value === undefined || value === null ? 'VALUE_MISSING' : 'VALUE_INVALID');

function rejectUnknownKeys(out: Defect[], entry: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) {
      out.push({ code: 'UNKNOWN_FIELD', path: `${at}.${key}` });
    }
  }
}

function checkNonEmptyString(out: Defect[], value: unknown, path: string): void {
  if (!isNonEmptyString(value)) {
    out.push({ code: missingOrInvalid(value), path });
  }
}

/** 기준 묶음 id 와 고른 매핑 목록의 검사. 성공이면 종류를 MAPPING 으로 붙인 참조 목록을 돌려준다(그 밖에는 null). */
function checkChoice(out: Defect[], body: Record<string, unknown>): ItemVersionRef[] | null {
  checkNonEmptyString(out, body.baseBundleId, 'baseBundleId');
  const mappings = body.mappings;
  if (!Array.isArray(mappings)) {
    out.push({ code: missingOrInvalid(mappings), path: 'mappings' });
    return null;
  }
  if (mappings.length === 0) {
    out.push({ code: 'MAPPINGS_EMPTY', path: 'mappings' });
    return null;
  }
  const before = out.length;
  const refs: ItemVersionRef[] = [];
  const seen = new Set<string>();
  mappings.forEach((entry: unknown, index) => {
    const at = `mappings[${index}]`;
    if (!isPlainObject(entry)) {
      out.push({ code: 'VALUE_INVALID', path: at });
      return;
    }
    rejectUnknownKeys(out, entry, MAPPING_KEYS, at);
    checkNonEmptyString(out, entry.id, `${at}.id`);
    checkNonEmptyString(out, entry.version, `${at}.version`);
    if (isNonEmptyString(entry.id) && isNonEmptyString(entry.version)) {
      const key = JSON.stringify([entry.id, entry.version]);
      if (seen.has(key)) {
        out.push({ code: 'DUPLICATE_MAPPING', path: at });
      }
      seen.add(key);
      refs.push({ kind: 'MAPPING', id: entry.id, version: entry.version });
    }
  });
  return out.length === before ? refs : null;
}

export type BundlePreviewParse = { ok: true; baseBundleId: string; mappings: ItemVersionRef[] } | { ok: false; defects: Defect[] };

/** 미리보기 본문 `{ baseBundleId, mappings: [{ id, version }] }` 의 형식 검사. 결함은 모두 모아서 돌려준다(최상위 알 수 없는 키 → 기준 묶음 id → 매핑 목록). */
export function parseBundlePreviewBody(body: unknown): BundlePreviewParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  rejectUnknownKeys(defects, body, PREVIEW_KEYS, 'request');
  const mappings = checkChoice(defects, body);
  return defects.length > 0 || mappings === null ? { ok: false, defects } : { ok: true, baseBundleId: body.baseBundleId as string, mappings };
}

export type BundlePublishParse = { ok: true; baseBundleId: string; mappings: ItemVersionRef[]; publishConfirmation: string } | { ok: false; defects: Defect[] };

/** 게시 본문 `{ baseBundleId, mappings, publishConfirmation }` 의 형식 검사. 확인값은 소문자 16진수 64자여야 한다(맞는지는 서비스가 본다). */
export function parseBundlePublishBody(body: unknown): BundlePublishParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  rejectUnknownKeys(defects, body, PUBLISH_KEYS, 'request');
  const mappings = checkChoice(defects, body);
  const confirmation = body.publishConfirmation;
  if (typeof confirmation !== 'string' || !PUBLISH_CONFIRMATION_PATTERN.test(confirmation)) {
    defects.push({ code: missingOrInvalid(confirmation), path: 'publishConfirmation' });
  }
  if (defects.length > 0 || mappings === null) {
    return { ok: false, defects };
  }
  return { ok: true, baseBundleId: body.baseBundleId as string, mappings, publishConfirmation: confirmation as string };
}

export type BundleSuspendParse = { ok: true; reason: string } | { ok: false; defects: Defect[] };

/**
 * 묶음 중지 본문 `{ reason }` 의 형식 검사. 사유는 문자열이어야 한다(키 없음·null → VALUE_MISSING, 문자열이 아님 → VALUE_INVALID). 알 수 없는 키는 모두 UNKNOWN_FIELD 다.
 * 비었거나 공백뿐인 사유는 여기서 거르지 않는다: 도메인 서비스(suspendRuleBundle)가 역할 확인 뒤에 REASON_REQUIRED(경로 reason)로 거절하고, 라우터가 400 INVALID_REQUEST 로 바꾼다.
 * 묶음 id 는 경로가 정하고 행위자는 검증된 신원이 정하므로 본문으로 받지 않는다.
 */
export function parseBundleSuspendBody(body: unknown): BundleSuspendParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  rejectUnknownKeys(defects, body, SUSPEND_KEYS, 'request');
  const reason = body.reason;
  if (typeof reason !== 'string') {
    defects.push({ code: missingOrInvalid(reason), path: 'reason' });
  }
  return defects.length > 0 ? { ok: false, defects } : { ok: true, reason: reason as string };
}

export type RuleScopeAssignParse = { ok: true; ruleBundleVersionId: string; expectedCurrentBundleId: string | null } | { ok: false; defects: Defect[] };

/** 범위 지정 본문 `{ ruleBundleVersionId, expectedCurrentBundleId }` 의 형식 검사. expectedCurrentBundleId 는 키가 있어야 하고 문자열이거나 null 이다. */
export function parseRuleScopeAssignBody(body: unknown): RuleScopeAssignParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  rejectUnknownKeys(defects, body, ASSIGN_KEYS, 'request');
  checkNonEmptyString(defects, body.ruleBundleVersionId, 'ruleBundleVersionId');
  const expected = body.expectedCurrentBundleId;
  if (expected === undefined) {
    defects.push({ code: 'VALUE_MISSING', path: 'expectedCurrentBundleId' });
  } else if (expected !== null && !isNonEmptyString(expected)) {
    defects.push({ code: 'VALUE_INVALID', path: 'expectedCurrentBundleId' });
  }
  return defects.length > 0 ? { ok: false, defects } : { ok: true, ruleBundleVersionId: body.ruleBundleVersionId as string, expectedCurrentBundleId: expected as string | null };
}
