import { DOCUMENT_CODE_LINE, DOCUMENT_LINE_KEYS } from './types';
import type {
  Cause,
  DocumentFlags,
  DocumentLine,
  DocumentLineKey,
  DocumentRule,
  DocumentRuleSet,
  DocumentScope,
  DocumentsResult,
  DocumentWhen,
  InsurerType,
  OverallState,
  RuleBundleSnapshot,
} from './types';
import { documentRuleSetToRuleItem, isBundleUsable, isUsable } from './usability';
import type { UsabilityContext } from './usability';
import { compareCodePoints } from './validate';

// 서류 규칙 묶음의 구조 검사, 사용 가능한 묶음 고르기, 필요 서류 산출 (design.md DD-06, DD-04).
//  1) checkDocumentRuleSetStructure — 규칙 묶음 게시 검증(M3, AC-007f)과 엔진이 같은 함수를 쓰는 순수 구조 검사
//  2) selectDocumentRuleSet — 묶음 단위 선행 판정 → 항목 판정 → 구조 검사를 거쳐 쓸 수 있는 묶음만 돌려주는 함수
//  3) deriveDocuments — 쓸 수 있는 묶음과 선택한 치료의 서류 표시로 고정 9줄을 만드는 순수 함수(estimate() 와 별개다, DD-01)

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
 * `reason` 은 문자열이어야 하고 앞뒤 공백(공백·탭·줄바꿈·NBSP·표의 공백 등 String.prototype.trim 이 지우는 문자)을 뺀 길이가 1 이상이어야
 * 한다. 공백뿐인 사유는 빈 문자열과 같은 REASON_INVALID 다. 이는 판정일 뿐이다 — 사유 원문은 어디서도 다듬거나 바꾸지 않는다
 * (결과의 reasons 와 내용 해시 입력에는 받은 문자열이 그대로 들어간다).
 *
 * 규칙의 수와 상해·질병 전용 줄의 수는 결함이 아니다. 빈 `rules: []` 는 현재 구조 계약에서 유효하다(구조 결함이 아니다) —
 * 게시 검증이 거절하는 목록(DD-06 9번, AC-007f)에 없고, 이 경우의 산출은 항상 필요한 영수증·세부내역서 줄만 남는다.
 * 출처·약관 출처·승인자·내용 해시는 항목 판정(isUsable)이 보며 이 검사의 몫이 아니다.
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
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 1) {
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

// ───────────────────────── 필요 서류 산출 (DD-06, AC-007a~l) ─────────────────────────

export interface DeriveDocumentsInput {
  overallState: OverallState;
  cause: Cause;
  insurerType: InsurerType;
  /** 선택한 치료 전부(중복 제거 뒤). 확인된 제외 줄도 포함하고 공통 기본비용 줄은 넣지 않는다. 줄 상태는 입력 형식에 없다. */
  treatments: Array<{ documentFlags: DocumentFlags }>;
  clinicSetting: 'OUTPATIENT_ONLY';
  /** 호출하는 쪽이 selectDocumentRuleSet 으로 고른 묶음, 없으면 null. */
  ruleSet: DocumentRuleSet | null;
}

type FlagKey = 'imaging' | 'biopsy' | 'opinionRequired';
const FLAG_KEYS: readonly FlagKey[] = ['imaging', 'biopsy', 'opinionRequired'];

/** 영수증·세부내역서 줄은 규칙과 무관하게 항상 필요하다(기획서 §4). 사유 없이 필요할 수 있는 줄은 이 줄뿐이다. */
const ALWAYS_REQUIRED_LINE: DocumentLineKey = 'RECEIPT_AND_ITEMIZED';

/** 한 번의 평가가 보는 사실. 원인은 평가마다 INJURY 또는 ILLNESS 하나다. */
interface EvaluationFacts {
  cause: 'INJURY' | 'ILLNESS';
  insurerType: unknown;
  clinicSetting: unknown;
  flags: Record<FlagKey, boolean>;
}

/** 줄 하나의 사유 후보. 우선순위가 작을수록, 같으면 사유가 코드 포인트 순에서 앞설수록 이긴다. */
interface Winner {
  priority: number;
  reason: string;
}

/** 입력으로 받을 수 있는 열거값. 목록 밖의 값(대소문자·공백이 다른 값 포함)은 입력 결함이며 다른 값으로 바꿔 읽지 않는다. */
const CAUSE_VALUES: readonly unknown[] = ['INJURY', 'ILLNESS', 'UNKNOWN'];
const INSURER_TYPE_VALUES: readonly unknown[] = ['NON_LIFE', 'LIFE', 'MUTUAL_AID'];
const CLINIC_SETTING_VALUES: readonly unknown[] = ['OUTPATIENT_ONLY'];

/**
 * 선택한 치료의 서류 표시를 표시마다 OR 로 합치면서(DD-06 "규칙 평가" 4번) 입력을 함께 검사한다. 모든 요소를 센다.
 * 배열이 아니거나, 요소가 null·배열·원시값(희소 배열의 빈 칸 포함)이거나, documentFlags 가 객체가 아니거나, 세 표시값 가운데
 * 하나라도 불리언(`typeof === 'boolean'`)이 아니면 null 이다 — 입력 결함이다. 강제 변환하지 않고(문자열 "true"·숫자 1 도 결함),
 * 올바른 요소만 골라 세지도 않는다(결함이 하나라도 있으면 전체가 결함). 추가 속성은 허용하며 읽지 않는다. 던지지 않는다.
 * 서버가 검증된 줄로 치료를 만들기 전(M4)의 안전망이다. `treatments: []` 는 결함이 아니며 표시가 모두 false 다.
 */
function collectFlags(treatments: unknown): Record<FlagKey, boolean> | null {
  if (!Array.isArray(treatments)) {
    return null;
  }
  const found: Record<FlagKey, boolean> = { imaging: false, biopsy: false, opinionRequired: false };
  // 인덱스로 돌아 희소 배열의 빈 칸도 undefined 요소로 잡는다.
  for (let index = 0; index < treatments.length; index += 1) {
    const treatment: unknown = treatments[index];
    if (!isRecord(treatment) || !isRecord(treatment.documentFlags)) {
      return null;
    }
    for (const key of FLAG_KEYS) {
      const flag: unknown = treatment.documentFlags[key];
      if (typeof flag !== 'boolean') {
        return null;
      }
      if (flag) {
        found[key] = true;
      }
    }
  }
  return found;
}

/** 규칙 안은 AND, 적히지 않은 키는 와일드카드, `when: {}` 는 언제나 맞는다(DD-06 "규칙 평가" 1·5·6번). */
function matches(when: DocumentWhen, facts: EvaluationFacts): boolean {
  if (when.cause !== undefined && when.cause !== facts.cause) {
    return false;
  }
  // INPATIENT 는 이 MVP 에서 맞는 일이 없다(입원은 범위 밖). OUTPATIENT 는 clinicSetting 이 OUTPATIENT_ONLY 일 때만 맞는다.
  if (when.setting !== undefined && !(when.setting === 'OUTPATIENT' && facts.clinicSetting === 'OUTPATIENT_ONLY')) {
    return false;
  }
  if (when.insurerType !== undefined && when.insurerType !== facts.insurerType) {
    return false;
  }
  for (const key of FLAG_KEYS) {
    if (when[key] !== undefined && !facts.flags[key]) {
      return false;
    }
  }
  return true;
}

/** 사유 선택의 키: 우선순위 오름차순, 같으면 사유의 유니코드 코드 포인트 순(UTF-16 코드 유닛 순이 아니다). 배열 위치는 쓰지 않는다. */
function beats(candidate: Winner, current: Winner | undefined): boolean {
  if (current === undefined) {
    return true;
  }
  if (candidate.priority !== current.priority) {
    return candidate.priority < current.priority;
  }
  return compareCodePoints(candidate.reason, current.reason) < 0;
}

/** 한 번의 평가: 맞는 규칙을 줄로 모으고 줄마다 이기는 규칙 하나를 남긴다(DD-06 "규칙 평가" 2·3·7번). 줄이 맵에 있으면 필요하다. */
function evaluate(rules: readonly DocumentRule[], facts: EvaluationFacts): Map<DocumentLineKey, Winner> {
  const winners = new Map<DocumentLineKey, Winner>();
  for (const rule of rules) {
    if (!matches(rule.when, facts)) {
      continue;
    }
    const line = DOCUMENT_CODE_LINE[rule.documentCode];
    const candidate: Winner = { priority: rule.priority, reason: rule.reason };
    if (beats(candidate, winners.get(line))) {
      winners.set(line, candidate);
    }
  }
  return winners;
}

function reasonsOf(winner: Winner | undefined): string[] {
  return winner === undefined ? [] : [winner.reason];
}

/**
 * 원인 모름에서 두 평가 모두 필요한 COMMON 줄의 사유. 두 평가의 이긴 사유를 우선순위 오름차순으로 두고(우선순위가 같으면
 * 상해 평가의 사유가 먼저, SPEC 제안) 문장이 같은 사유는 하나로 모은다. 한쪽에만 사유가 있으면(영수증 줄만 가능) 그 사유다.
 */
function commonReasons(injury: Winner | undefined, illness: Winner | undefined): string[] {
  const ordered = [injury, illness].filter((winner): winner is Winner => winner !== undefined);
  const [head, tail] = ordered;
  if (head !== undefined && tail !== undefined && tail.priority < head.priority) {
    ordered.reverse();
  }
  return [...new Set(ordered.map((winner) => winner.reason))];
}

/** 줄 객체의 속성 순서는 line, required, scope, reasons 로 고정하고 없는 속성은 두지 않는다(직렬화 비교가 의미를 갖는다). */
function buildLine(line: DocumentLineKey, required: boolean, scope: DocumentScope | undefined, reasons: string[]): DocumentLine {
  const built: DocumentLine = { line, required };
  if (scope !== undefined) {
    built.scope = scope;
  }
  if (reasons.length > 0) {
    built.reasons = reasons;
  }
  return built;
}

// @MX:ANCHOR: [AUTO] 필요 서류 산출. 서버의 estimate 경로(M4)와 서류 화면 표시 입력(M6), 준비 상태 계산의 서류 동치 시험(M3 표 D)이 같은 함수를 쓴다.
// @MX:REASON: 규칙 평가·사유 선택·원인 모름 이중 평가가 한 곳에만 있어야 같은 입력이 화면마다 다른 서류를 내지 않는다(DD-06).
/**
 * 필요 서류를 산출한다. 순수 함수이며 던지지 않고 입력을 바꾸지 않는다. 반환:
 *  - 전체 결과가 ESTIMATED / ESTIMATED_WITH_EXCLUSIONS 가 아니면 null: ON_HOLD 는 물론 알 수 없는 상태 값도 null 이다
 *    (모르는 상태에서는 서류 목록을 보이지 않는다). 입력 자체가 객체가 아니어도 null 이다.
 *  - 입력이 틀렸거나 서류 규칙 묶음이 없거나 구조가 틀리면 RULES_UNAVAILABLE(던지지 않고, 일부만 쓰지 않고, 입력을 바꾸지 않는다):
 *    treatments 가 배열이 아니거나 요소·documentFlags·세 표시값(imaging·biopsy·opinionRequired, 불리언만) 가운데 하나라도 틀린 경우
 *    (올바른 요소만 골라 세지 않는다), cause 가 정확히 INJURY / ILLNESS / UNKNOWN 이 아닌 경우(UNKNOWN 으로 바꿔 읽지 않는다),
 *    insurerType 이 정확히 NON_LIFE / LIFE / MUTUAL_AID 가 아닌 경우, clinicSetting 이 정확히 OUTPATIENT_ONLY 가 아닌 경우.
 *    이 입력 검사는 위의 null 판정(전체 결과·입력 객체)보다 뒤다 — 보류에서는 입력이 틀려도 null 이다.
 *    서류 규칙 묶음은 호출하는 쪽이 이미 selectDocumentRuleSet 으로 항목 판정을 마쳤더라도 구조 검사를 한 번 더 한다 —
 *    틀린 묶음이 던지거나 고쳐진 채 쓰이지 않게 하는 최후의 안전망이다(머리 정보는 보지 않는다).
 *  - 그 밖에는 AVAILABLE: 고정 9줄(DOCUMENT_LINE_KEYS 순서, 범위와 무관)을 한 번씩.
 *
 * 치료 요소와 documentFlags 의 추가 속성은 허용한다. 빈 `treatments: []` 는 유효하며 표시가 모두 없는 것과 같다.
 *
 * 원인 INJURY / ILLNESS 는 그 원인으로 한 번(SINGLE_CAUSE, 줄에 scope 없음), 명시적 UNKNOWN 은 INJURY 와
 * ILLNESS 로 각각 평가한다(UNKNOWN_CAUSE) — 원인을 하나로 고르지 않는다. 줄은 두 평가에서 모두 필요하면 COMMON, 한쪽에서만
 * 필요하면 INJURY_ONLY / ILLNESS_ONLY, 둘 다 필요하지 않으면 필요 없는 COMMON 이다. 전용 줄의 수에는 상한이 없다.
 * 사유는 받은 문자열 그대로 싣는다(공백을 다듬지 않는다).
 */
export function deriveDocuments(input: DeriveDocumentsInput): DocumentsResult | null {
  if (!isRecord(input)) {
    return null;
  }
  if (input.overallState !== 'ESTIMATED' && input.overallState !== 'ESTIMATED_WITH_EXCLUSIONS') {
    return null;
  }
  const flags = collectFlags(input.treatments);
  const candidate: unknown = input.ruleSet;
  if (
    flags === null ||
    !CAUSE_VALUES.includes(input.cause) ||
    !INSURER_TYPE_VALUES.includes(input.insurerType) ||
    !CLINIC_SETTING_VALUES.includes(input.clinicSetting) ||
    !checkDocumentRuleSetStructure(candidate).ok
  ) {
    return { state: 'RULES_UNAVAILABLE' };
  }
  const ruleSet = candidate as DocumentRuleSet;
  const shared = { insurerType: input.insurerType, clinicSetting: input.clinicSetting, flags };
  const cause = input.cause;

  if (cause === 'INJURY' || cause === 'ILLNESS') {
    const winners = evaluate(ruleSet.rules, { ...shared, cause });
    const lines = DOCUMENT_LINE_KEYS.map((key) => {
      const winner = winners.get(key);
      return buildLine(key, key === ALWAYS_REQUIRED_LINE || winner !== undefined, undefined, reasonsOf(winner));
    });
    return { state: 'AVAILABLE', mode: 'SINGLE_CAUSE', lines, ruleSetId: ruleSet.id, ruleSetVersion: ruleSet.version, origin: ruleSet.origin };
  }

  const injury = evaluate(ruleSet.rules, { ...shared, cause: 'INJURY' });
  const illness = evaluate(ruleSet.rules, { ...shared, cause: 'ILLNESS' });
  const lines = DOCUMENT_LINE_KEYS.map((key) => {
    const injuryWinner = injury.get(key);
    const illnessWinner = illness.get(key);
    const injuryRequired = key === ALWAYS_REQUIRED_LINE || injuryWinner !== undefined;
    const illnessRequired = key === ALWAYS_REQUIRED_LINE || illnessWinner !== undefined;
    if (injuryRequired && illnessRequired) {
      return buildLine(key, true, 'COMMON', commonReasons(injuryWinner, illnessWinner));
    }
    if (injuryRequired) {
      return buildLine(key, true, 'INJURY_ONLY', reasonsOf(injuryWinner));
    }
    if (illnessRequired) {
      return buildLine(key, true, 'ILLNESS_ONLY', reasonsOf(illnessWinner));
    }
    return buildLine(key, false, 'COMMON', []);
  });
  return { state: 'AVAILABLE', mode: 'UNKNOWN_CAUSE', lines, ruleSetId: ruleSet.id, ruleSetVersion: ruleSet.version, origin: ruleSet.origin };
}
