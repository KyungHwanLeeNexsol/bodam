import { DOCUMENT_CODE_LINE } from './types';
import type { DocumentRuleSet, RuleBundleSnapshot } from './types';
import { documentRuleSetToRuleItem, isBundleUsable, isUsable } from './usability';
import type { UsabilityContext } from './usability';
import { compareCodePoints } from './validate';

// 서류 규칙 묶음의 구조 검사와 사용 가능한 묶음 고르기 (design.md DD-06, DD-04).
// 이 파일에는 서류 산출(deriveDocuments) 자체가 아직 없다. 여기 있는 것은 산출이 기대는 두 가지다:
//  1) checkDocumentRuleSetStructure — 규칙 묶음 게시 검증(M3, AC-007f)과 엔진이 같은 함수를 쓰는 순수 구조 검사
//  2) selectDocumentRuleSet — 묶음 단위 선행 판정 → 항목 판정 → 구조 검사를 거쳐 쓸 수 있는 묶음만 돌려주는 함수

// ───────────────────────── 구조 검사 (DD-06 "규칙 평가" 9번, REQ-DATA-005) ─────────────────────────

export type DocumentRuleSetDefectCode =
  | 'RULE_SET_NOT_OBJECT'
  | 'RULES_NOT_ARRAY'
  | 'RULE_ENTRY_INVALID'
  | 'DOCUMENT_CODE_INVALID'
  | 'REASON_INVALID'
  | 'PRIORITY_INVALID'
  | 'WHEN_NOT_OBJECT'
  | 'WHEN_UNKNOWN_KEY'
  | 'WHEN_VALUE_INVALID';

export interface DocumentRuleSetDefect {
  code: DocumentRuleSetDefectCode;
  /** 어긋난 필드 경로. 규칙 묶음 자신이 객체가 아니면 `ruleSet`, 그 밖에는 `rules[3].when.imaging` 처럼 묶음 안의 경로다. */
  path: string;
}

export type DocumentRuleSetStructureResult = { ok: true } | { ok: false; defects: DocumentRuleSetDefect[] };

/** `when` 의 키 여섯과 값 규칙. 열거 키는 목록 안의 값만, 플래그 키는 `true` 만 유효하다. 순서가 결함 보고의 고정 순서다. */
const WHEN_KEY_RULES: ReadonlyArray<{ key: string; allowed: readonly unknown[] }> = [
  { key: 'cause', allowed: ['INJURY', 'ILLNESS'] },
  { key: 'setting', allowed: ['OUTPATIENT', 'INPATIENT'] },
  { key: 'insurerType', allowed: ['NON_LIFE', 'LIFE', 'MUTUAL_AID'] },
  { key: 'imaging', allowed: [true] },
  { key: 'biopsy', allowed: [true] },
  { key: 'opinionRequired', allowed: [true] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 0 이상의 안전 정수. 0 과 Number.MAX_SAFE_INTEGER 는 유효하고 음수·소수·NaN·Infinity·초과·문자열은 무효다. */
function isPriority(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** 규칙 하나의 `when` 결함. `when` 이 객체가 아니면 그 결함 하나만, 객체이면 알 수 없는 키(코드 포인트 순)보다 알려진 키(고정 순서)를 먼저 본다. */
function checkWhen(when: unknown, path: string, defects: DocumentRuleSetDefect[]): void {
  if (!isRecord(when)) {
    defects.push({ code: 'WHEN_NOT_OBJECT', path });
    return;
  }
  for (const { key, allowed } of WHEN_KEY_RULES) {
    if (Object.hasOwn(when, key) && !allowed.includes(when[key])) {
      defects.push({ code: 'WHEN_VALUE_INVALID', path: `${path}.${key}` });
    }
  }
  const known = WHEN_KEY_RULES.map((entry) => entry.key);
  for (const key of Object.keys(when).sort(compareCodePoints)) {
    if (!known.includes(key)) {
      defects.push({ code: 'WHEN_UNKNOWN_KEY', path: `${path}.${key}` });
    }
  }
}

// @MX:ANCHOR: [AUTO] 서류 규칙 묶음 구조 검사. 엔진(selectDocumentRuleSet)과 규칙 묶음 게시 검증(M3, AC-007f)이 같은 함수를 쓴다.
// @MX:REASON: 구조 결함이 있는 서류 규칙 묶음은 서류 산출에 쓰지 않는다. 두 번째 구현이 있으면 게시와 산출이 어긋난다(DD-06 9번).
/**
 * 서류 규칙 묶음의 구조 결함을 모두 모아 고정된 순서로 돌려준다: 규칙 배열 순서대로, 한 규칙 안에서는
 * 항목 모양 → documentCode → reason → priority → when(알려진 키의 값 → 알 수 없는 키) 순이다. 던지지 않으며 입력을 바꾸지 않는다.
 * 규칙이 배열이 아니면 그 결함 하나만, 규칙 항목이 배열이 아닌 객체가 아니면(희소 배열의 빈 칸 포함) 그 항목 하나만 보고하고
 * 그 항목은 더 읽지 않는다.
 *
 * 규칙의 수와 상해·질병 전용 줄의 수는 결함이 아니다. 빈 `rules: []` 도 구조 결함이 아니다 — 게시 검증이 거절하는 목록
 * (DD-06 9번, AC-007f)에 없고, 이 경우의 산출은 항상 필요한 영수증·세부내역서 줄만 남는다. 출처·약관 출처·승인자·내용 해시는
 * 항목 판정(isUsable)이 보며 이 검사의 몫이 아니다.
 */
export function checkDocumentRuleSetStructure(ruleSet: unknown): DocumentRuleSetStructureResult {
  if (!isRecord(ruleSet)) {
    return { ok: false, defects: [{ code: 'RULE_SET_NOT_OBJECT', path: 'ruleSet' }] };
  }
  const rules: unknown = ruleSet.rules;
  if (!Array.isArray(rules)) {
    return { ok: false, defects: [{ code: 'RULES_NOT_ARRAY', path: 'rules' }] };
  }
  const defects: DocumentRuleSetDefect[] = [];
  // 인덱스로 돌아 희소 배열의 빈 칸도 undefined 항목으로 잡는다.
  for (let index = 0; index < rules.length; index += 1) {
    const entry: unknown = rules[index];
    const path = `rules[${index}]`;
    if (!isRecord(entry)) {
      defects.push({ code: 'RULE_ENTRY_INVALID', path });
      continue;
    }
    if (typeof entry.documentCode !== 'string' || !Object.hasOwn(DOCUMENT_CODE_LINE, entry.documentCode)) {
      defects.push({ code: 'DOCUMENT_CODE_INVALID', path: `${path}.documentCode` });
    }
    if (typeof entry.reason !== 'string' || entry.reason === '') {
      defects.push({ code: 'REASON_INVALID', path: `${path}.reason` });
    }
    if (!isPriority(entry.priority)) {
      defects.push({ code: 'PRIORITY_INVALID', path: `${path}.priority` });
    }
    checkWhen(entry.when, `${path}.when`, defects);
  }
  return defects.length === 0 ? { ok: true } : { ok: false, defects };
}

// ───────────────────────── 사용 가능한 서류 규칙 묶음 고르기 (DD-04, DD-06) ─────────────────────────

// @MX:ANCHOR: [AUTO] 서류 규칙 묶음 선택. 서류 산출(deriveDocuments 호출 쪽)과 운영 준비 상태 계산(M3, 표 D)이 같은 함수를 부른다.
// @MX:REASON: 묶음 단위 선행 판정이 항목 판정보다 먼저이고 묶음 안의 항목을 읽지 않는 순서가 한 곳에만 있어야 한다(DD-04).
/**
 * 쓸 수 있는 서류 규칙 묶음을 돌려주고, 쓸 수 없으면 null 이다(호출하는 쪽이 null 을 RULES_UNAVAILABLE 로 바꾼다).
 * 순서: ① 묶음 단위 선행 판정(isBundleUsable) — 규칙 사용 범위가 없거나(bundle = null) 묶음이 중지이면 묶음 안의 항목을
 * 하나도 읽지 않고 null ② 서류 규칙 묶음이 없거나 객체가 아니면 null ③ 항목 판정(isUsable, 출처·상태·유효 기간·약관 출처·
 * 승인자·무결성 순; 새로 구현하지 않고 그대로 부른다) ④ 구조 검사. 무결성이 구조보다 먼저이며, 어느 쪽이든 결과는 null 이다.
 * 어긋난 묶음을 고치거나 일부만 쓰지 않는다. 던지지 않는다(해시 함수가 던지는 경우는 주입한 쪽의 책임이다).
 */
export function selectDocumentRuleSet(bundle: RuleBundleSnapshot | null, ctx: UsabilityContext): DocumentRuleSet | null {
  const gate = isBundleUsable(bundle);
  if (!gate.usable) {
    return null;
  }
  const ruleSet: unknown = gate.bundle.documentRuleSet;
  if (!isRecord(ruleSet)) {
    return null;
  }
  const candidate = ruleSet as unknown as DocumentRuleSet;
  if (!isUsable(documentRuleSetToRuleItem(candidate), ctx).usable) {
    return null;
  }
  return checkDocumentRuleSetStructure(candidate).ok ? candidate : null;
}
