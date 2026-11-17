import type { TreatmentCoverageMapping } from '../engine/types';
import type { PolicySourceRef } from '../engine/types';
import { isCalendarDate } from './catalog-draft-parse';
import type { Defect } from './domain/errors';
import type { MappingDraftInput } from './mapping-review';
import { checkMappingFields } from './validate/bundle-mapping';
import { POLICY_SOURCE_FIELDS, isNonEmptyString, isPlainObject } from './validate/shape';

// 매핑 검토 요청 본문의 형식 검사 (M7 매핑 검토, review-request-parse.ts 와 같은 방식). 순수 함수다: 저장소를 읽지 않고, 던지지 않고, 입력을 바꾸지 않는다.
// 이 파일은 "모양"만 본다. 요청이 열려 있는지·연결됐는지·치료가 현재 게시 목록에 있는지는 mapping-review.ts 가 저장소를 읽어 본다.
// 모든 단계의 키가 엄격하다: 아래 말고는 모두 UNKNOWN_FIELD 다. 매핑의 id·버전·치료 연결·출처(origin)·상태·승인자·지문·작성자·병원은
// 서버가 정하는 값이라 본문으로 보낼 길이 없다 (치료만 선택적으로 적을 수 있고, 요청의 치료와 다르면 서비스가 거절한다).
//
// 초안 본문: { mapping: { treatmentId?, scope, decision, groupKey?, exclusionReason?, validity: { from, to }, policySources } }.
// 판정 필드 규칙(COVERED ⇒ groupKey 필수·사유 없음, EXCLUDED ⇒ groupKey 없음·사유 필수)과 범위 항목의 열거는 규칙 묶음 게시 검증과 같은
// checkMappingFields 를 그대로 쓴다: 게시 때 거절될 매핑을 초안에서 먼저 받아 두는 일이 없게 한다. 그 검사는 빈 범위를 허용하지만(게시 검증의 결정),
// 여기서는 범위가 하나도 없는 매핑은 무엇에도 적용되지 않으므로 SCOPE_EMPTY 로 거절한다.

const TOP_LEVEL_KEYS: readonly string[] = ['mapping'];
const MAPPING_KEYS: readonly string[] = ['treatmentId', 'scope', 'decision', 'groupKey', 'exclusionReason', 'validity', 'policySources'];
const SCOPE_KEYS: readonly string[] = ['generation', 'insurerType'];
const VALIDITY_KEYS: readonly string[] = ['from', 'to'];
const REF_KEYS: readonly string[] = ['reviewRequestId'];
const REJECT_KEYS: readonly string[] = ['reviewRequestId', 'reason'];

/** 값이 없거나(undefined·null) 형식이 틀렸을 때의 결함 코드. */
const missingOrInvalid = (value: unknown): string => (value === undefined || value === null ? 'VALUE_MISSING' : 'VALUE_INVALID');

function rejectUnknownKeys(out: Defect[], entry: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) {
      out.push({ code: 'UNKNOWN_FIELD', path: `${at}.${key}` });
    }
  }
}

export type MappingDraftParse = { ok: true; input: Omit<MappingDraftInput, 'origin'> } | { ok: false; defects: Defect[] };

function checkScope(out: Defect[], scope: unknown, at: string): void {
  if (!Array.isArray(scope)) {
    return; // 배열이 아니면 checkMappingFields 가 SCOPE_INVALID 로 알렸다.
  }
  if (scope.length === 0) {
    out.push({ code: 'SCOPE_EMPTY', path: at });
  }
  scope.forEach((entry: unknown, index) => {
    if (isPlainObject(entry)) {
      rejectUnknownKeys(out, entry, SCOPE_KEYS, `${at}[${index}]`);
    }
  });
}

function checkValidity(out: Defect[], validity: unknown, at: string): void {
  if (!isPlainObject(validity)) {
    out.push({ code: missingOrInvalid(validity), path: at });
    return;
  }
  rejectUnknownKeys(out, validity, VALIDITY_KEYS, at);
  const fromOk = isCalendarDate(validity.from);
  const toOk = isCalendarDate(validity.to);
  if (!fromOk) {
    out.push({ code: 'DATE_INVALID', path: `${at}.from` });
  }
  if (!toOk) {
    out.push({ code: 'DATE_INVALID', path: `${at}.to` });
  }
  // 날짜 문자열은 YYYY-MM-DD 이므로 문자열 비교가 날짜 순서와 같다.
  if (fromOk && toOk && (validity.from as string) > (validity.to as string)) {
    out.push({ code: 'VALIDITY_RANGE_INVALID', path: at });
  }
}

/** 약관 출처: 1개 이상이고 항목마다 여섯 칸이 비어 있지 않은 문자열이다 (규칙 묶음 게시 검증의 머리 검사와 같은 기준과 같은 결함 코드). */
function checkPolicySources(out: Defect[], sources: unknown, at: string): void {
  if (!Array.isArray(sources) || sources.length === 0) {
    out.push({ code: 'POLICY_SOURCES_MISSING', path: at });
    return;
  }
  sources.forEach((source: unknown, index) => {
    const entryAt = `${at}[${index}]`;
    if (!isPlainObject(source)) {
      out.push({ code: 'POLICY_SOURCE_INCOMPLETE', path: entryAt });
      return;
    }
    rejectUnknownKeys(out, source, POLICY_SOURCE_FIELDS, entryAt);
    for (const field of POLICY_SOURCE_FIELDS) {
      if (!isNonEmptyString(source[field])) {
        out.push({ code: 'POLICY_SOURCE_INCOMPLETE', path: `${entryAt}.${field}` });
      }
    }
  });
}

/**
 * 매핑 초안 본문의 형식 검사. 던지지 않는다. 결함은 모두 모아서 돌려준다
 * (최상위 알 수 없는 키 → mapping 알 수 없는 키 → treatmentId → 판정 규칙(decision·groupKey·exclusionReason·범위 모양) → 범위 비어 있음·항목 키 → 유효 기간 → 약관 출처 순).
 * 성공하면 입력의 사본을 돌려준다(없는 선택 값은 키를 두지 않는다).
 */
export function parseMappingDraftBody(body: unknown): MappingDraftParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  rejectUnknownKeys(defects, body, TOP_LEVEL_KEYS, 'request');
  const mapping = body.mapping;
  if (!isPlainObject(mapping)) {
    defects.push({ code: missingOrInvalid(mapping), path: 'mapping' });
    return { ok: false, defects };
  }
  rejectUnknownKeys(defects, mapping, MAPPING_KEYS, 'mapping');

  const { treatmentId, scope, decision, groupKey, exclusionReason, validity, policySources } = mapping;
  if (treatmentId !== undefined && !isNonEmptyString(treatmentId)) {
    defects.push({ code: 'VALUE_INVALID', path: 'mapping.treatmentId' });
  }
  checkMappingFields(defects, { decision, groupKey, exclusionReason, scope } as unknown as TreatmentCoverageMapping, 'mapping');
  checkScope(defects, scope, 'mapping.scope');
  checkValidity(defects, validity, 'mapping.validity');
  checkPolicySources(defects, policySources, 'mapping.policySources');
  if (defects.length > 0) {
    return { ok: false, defects };
  }

  // 위 검사를 모두 통과했으므로 형식이 맞다. 선택 값은 있을 때만 옮긴다.
  const checked = mapping as {
    scope: MappingDraftInput['scope'];
    decision: MappingDraftInput['decision'];
    validity: { from: string; to: string };
    policySources: PolicySourceRef[];
  };
  const input: Omit<MappingDraftInput, 'origin'> = {
    scope: checked.scope.map((cell) => ({ generation: cell.generation, insurerType: cell.insurerType })),
    decision: checked.decision,
    validity: { from: checked.validity.from, to: checked.validity.to },
    policySources: checked.policySources.map((source) => ({ ...source })),
  };
  if (treatmentId !== undefined) {
    input.treatmentId = treatmentId as string;
  }
  if (groupKey !== undefined) {
    input.groupKey = groupKey as string;
  }
  if (exclusionReason !== undefined) {
    input.exclusionReason = exclusionReason as string;
  }
  return { ok: true, input };
}

function checkReviewRequestId(out: Defect[], value: unknown): void {
  if (value === undefined || value === null) {
    out.push({ code: 'VALUE_MISSING', path: 'reviewRequestId' });
  } else if (!isNonEmptyString(value)) {
    out.push({ code: 'VALUE_INVALID', path: 'reviewRequestId' });
  }
}

export type ReviewRequestRefParse = { ok: true; reviewRequestId: string } | { ok: false; defects: Defect[] };

/** 제출·승인 본문 `{ reviewRequestId }` 의 형식 검사. 매핑은 경로가, 행위자는 검증된 신원이 정한다. */
export function parseReviewRequestRefBody(body: unknown): ReviewRequestRefParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  rejectUnknownKeys(defects, body, REF_KEYS, 'request');
  checkReviewRequestId(defects, body.reviewRequestId);
  return defects.length > 0 ? { ok: false, defects } : { ok: true, reviewRequestId: body.reviewRequestId as string };
}

export type ReviewRejectParse = { ok: true; reviewRequestId: string; reason: string } | { ok: false; defects: Defect[] };

/** 반려 본문 `{ reviewRequestId, reason }` 의 형식 검사. 사유는 비어 있거나 공백뿐일 수 없고, 다듬지 않고 그대로 보존한다. */
export function parseReviewRejectBody(body: unknown): ReviewRejectParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  rejectUnknownKeys(defects, body, REJECT_KEYS, 'request');
  checkReviewRequestId(defects, body.reviewRequestId);
  const reason = body.reason;
  if (reason === undefined || reason === null) {
    defects.push({ code: 'VALUE_MISSING', path: 'reason' });
  } else if (typeof reason !== 'string') {
    defects.push({ code: 'VALUE_INVALID', path: 'reason' });
  } else if (reason.trim() === '') {
    defects.push({ code: 'EMPTY', path: 'reason' });
  }
  return defects.length > 0 ? { ok: false, defects } : { ok: true, reviewRequestId: body.reviewRequestId as string, reason: reason as string };
}
