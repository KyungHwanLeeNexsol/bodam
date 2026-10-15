import type {
  ApproverRecord,
  DocumentRuleSet,
  HoldReasonCode,
  LifecycleState,
  Origin,
  PolicySourceRef,
  RuleBundleSnapshot,
  RuleItemHeader,
  StandardAssumptionProfile,
  TreatmentCoverageMapping,
} from './types';
import { compareCodePoints } from './validate';

// 단일 사용 가능 판정 (design.md DD-04).
// 책임이 다른 두 함수로 나뉜다. isBundleUsable 은 묶음의 가용성만 보고 묶음 안의 항목을 읽지 않는다.
// isUsable 은 이미 isBundleUsable 을 통과한 묶음 안의 항목 하나만 보고 묶음 상태는 보지 않는다.

// ───────────────────────── 형식 ─────────────────────────

export interface UsabilityContext {
  /** 판정 기준일 (주입). */
  at: string;
  /** 규칙 데이터의 허용 출처 (acceptedOrigins.rules). */
  acceptedOrigins: readonly Origin[];
  /** 내용 해시 함수 (주입). 엔진은 해시 구현을 가져오지 않는다. */
  digest: (content: unknown) => string;
}

/** 항목 단위 사유. 묶음 사유(SCOPE_ABSENT, BUNDLE_SUSPENDED)는 여기에 없다. */
export type ItemUsabilityReason =
  | 'ORIGIN_NOT_ACCEPTED'
  | 'STATE_DRAFT'
  | 'STATE_UNAPPROVED'
  | 'STATE_REJECTED'
  | 'STATE_UNDER_REREVIEW'
  | 'STATE_INVALID'
  | 'OUTSIDE_VALIDITY'
  | 'SOURCE_INCOMPLETE'
  | 'APPROVER_MISSING'
  | 'INTEGRITY_MISMATCH';

export type BundleUnusableReason = 'SCOPE_ABSENT' | 'BUNDLE_SUSPENDED';

/** 프로필·매핑·서류 규칙 묶음을 판정 대상으로 펼친 모양. 무결성 입력만 종류마다 다르다. */
export type RuleItem =
  | (RuleItemHeader & { kind: 'PROFILE' | 'DOCUMENT_RULE_SET'; contentHash: string; content: unknown })
  | (RuleItemHeader & { kind: 'MAPPING'; approvedFingerprint: string; currentFingerprint: string });

// ───────────────────────── 묶음 단위 선행 판정 ─────────────────────────

// @MX:ANCHOR: [AUTO] 묶음 단위 선행 판정. estimate() 앞단과 운영 준비 상태 계산(M3)이 같은 함수를 부른다.
// @MX:REASON: 규칙 사용 범위 없음·묶음 중지를 항목 판정보다 먼저, 항목을 읽지 않고 가려내는 단 하나의 구현이어야 한다(DD-04).
/**
 * 묶음의 가용성만 본다. 묶음 안의 항목(profiles·mappings·documentRuleSet)은 읽지 않는다.
 * ACTIVE 만 사용 가능이다. 알 수 없는 status 값은 ACTIVE 로 추정하지 않고 사용 불가로 본다.
 */
export function isBundleUsable(
  bundle: RuleBundleSnapshot | null,
): { usable: true; bundle: RuleBundleSnapshot } | { usable: false; reason: BundleUnusableReason } {
  if (bundle === null) {
    return { usable: false, reason: 'SCOPE_ABSENT' };
  }
  if (bundle.status !== 'ACTIVE') {
    return { usable: false, reason: 'BUNDLE_SUSPENDED' };
  }
  return { usable: true, bundle };
}

// ───────────────────────── 항목 단위 판정 ─────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD 이면서 달력에 있는 날짜인지 본다. 해석할 수 없는 날짜는 유효 기간 밖으로 다룬다. */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = ISO_DATE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 시작일과 종료일 당일을 모두 포함한다. 문자열 비교는 YYYY-MM-DD 형식에서 날짜 순서와 같다. */
function isWithinValidity(validity: RuleItemHeader['validity'] | undefined, at: string): boolean {
  if (validity === undefined || validity === null) {
    return false;
  }
  const { from, to } = validity;
  return isIsoDate(from) && isIsoDate(to) && isIsoDate(at) && from <= at && at <= to;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

const POLICY_SOURCE_FIELDS: ReadonlyArray<keyof PolicySourceRef> = [
  'insurerDocumentId',
  'revisionDate',
  'clauseOrPage',
  'effectiveDate',
  'verifiedBy',
  'verifiedAt',
];

/** 약관 출처가 1개 이상이고 모든 출처가 여섯 항목을 모두 채웠는지 본다. */
function arePolicySourcesComplete(sources: readonly PolicySourceRef[] | undefined): boolean {
  if (!Array.isArray(sources) || sources.length === 0) {
    return false;
  }
  return sources.every(
    (source) =>
      source !== null &&
      typeof source === 'object' &&
      POLICY_SOURCE_FIELDS.every((field) => isNonEmptyString(source[field])),
  );
}

function isApproverComplete(approver: ApproverRecord | null | undefined): boolean {
  return (
    approver !== null &&
    approver !== undefined &&
    isNonEmptyString(approver.approverId) &&
    isNonEmptyString(approver.approvedAt)
  );
}

function stateReason(state: LifecycleState): ItemUsabilityReason | null {
  switch (state) {
    case 'PUBLISHED':
      return null;
    case 'DRAFT':
      return 'STATE_DRAFT';
    case 'REVIEW_REQUESTED':
    case 'APPROVED':
      return 'STATE_UNAPPROVED';
    case 'REJECTED':
      return 'STATE_REJECTED';
    case 'UNDER_REREVIEW':
      return 'STATE_UNDER_REREVIEW';
    default:
      // SUPERSEDED, EXPIRED, SUSPENDED 와 알 수 없는 값은 모두 무효로 본다(사용 가능으로 추정하지 않는다).
      return 'STATE_INVALID';
  }
}

function isIntegral(item: RuleItem, ctx: UsabilityContext): boolean {
  if (item.kind === 'MAPPING') {
    return isNonEmptyString(item.approvedFingerprint) && item.approvedFingerprint === item.currentFingerprint;
  }
  return isNonEmptyString(item.contentHash) && ctx.digest(item.content) === item.contentHash;
}

// @MX:ANCHOR: [AUTO] 항목 단위 사용 가능 판정. 프로필 칸 조회, 매핑 후보 조회, 서류 규칙 묶음 판정(M2), 준비 상태 계산(M3)이 모두 부른다.
// @MX:REASON: 출처 → 상태 → 유효 기간 → 약관 출처 → 승인자 → 무결성 순서로 처음 걸린 사유 하나를 돌려주는 단일 구현이어야 보류 코드가 어긋나지 않는다(DD-04).
/**
 * 항목 하나의 출처·상태·유효 기간·약관 출처·승인자·무결성만 판정한다. 묶음과 줄은 읽지 않는다.
 * 검사 순서도 이 순서이며(무결성이 마지막) 처음 걸린 사유 하나를 돌려준다.
 */
export function isUsable(
  item: RuleItem,
  ctx: UsabilityContext,
): { usable: true } | { usable: false; reason: ItemUsabilityReason } {
  if (!ctx.acceptedOrigins.includes(item.origin)) {
    return { usable: false, reason: 'ORIGIN_NOT_ACCEPTED' };
  }
  const byState = stateReason(item.state);
  if (byState !== null) {
    return { usable: false, reason: byState };
  }
  if (!isWithinValidity(item.validity, ctx.at)) {
    return { usable: false, reason: 'OUTSIDE_VALIDITY' };
  }
  if (!arePolicySourcesComplete(item.policySources)) {
    return { usable: false, reason: 'SOURCE_INCOMPLETE' };
  }
  if (!isApproverComplete(item.approver)) {
    return { usable: false, reason: 'APPROVER_MISSING' };
  }
  if (!isIntegral(item, ctx)) {
    return { usable: false, reason: 'INTEGRITY_MISMATCH' };
  }
  return { usable: true };
}

// ───────────────────────── 항목 만들기 ─────────────────────────

/**
 * 배열 항목이 모두 문자열 키(keyName)를 가진 객체이면 키의 유니코드 코드 포인트 순으로 정렬한 사본을, 아니면 받은 값 그대로 돌려준다.
 * 원본 배열과 항목은 바꾸지 않는다. 같은 키(중복)는 안정 정렬로 입력 순서를 유지하며 하나로 합치지 않는다.
 * 배열이 아니거나 키가 문자열이 아닌 항목(null, 키 없음, 숫자 키)이 섞여 있으면 정렬하지 않는다: 구조 결함을 정렬로
 * 유효해 보이게 고치지 않으며, 그런 프로필은 구조 검사(profile-structure.ts)가 PROFILE_INVALID 로 거절한다. 던지지 않는다.
 */
function sortedByKey(items: unknown, keyName: 'groupKey' | 'poolKey'): unknown {
  const keyed = (entry: unknown): entry is Record<typeof keyName, string> =>
    typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>)[keyName] === 'string';
  if (!Array.isArray(items) || !items.every(keyed)) {
    return items;
  }
  return [...items].sort((x: Record<typeof keyName, string>, y: Record<typeof keyName, string>) => compareCodePoints(x[keyName], y[keyName]));
}

/**
 * 프로필 내용 해시의 입력. 이 함수 하나가 정규화의 전부이며 다음 두 쪽이 똑같이 쓴다.
 *  (a) 해시를 만드는 쪽(M3 게시·봉인)과 (b) 해시를 검사하는 쪽(엔진의 isIntegral / profileToRuleItem).
 *  두 번째 구현을 만들지 않는다: 정규화가 어긋나면 같은 규칙인데 INTEGRITY_MISMATCH → PROFILE_INVALID 가 난다.
 *
 * 해시 입력에 드는 필드: id, version, generation, insurerType, groups, groupOrder, sharedLimitPools.
 * 머리 정보(state, origin, validity, policySources, approver)와 contentHash 자신은 뺀다.
 *
 * 정규화: groups 는 groupKey 순, sharedLimitPools 는 poolKey 순(코드 포인트 순)으로 정렬한 사본이다.
 * 같은 규칙을 다른 배열 순서로 저장해도 같은 해시 입력이 된다. groupOrder 는 공유 한도 배분 순서를 정하는 데이터이므로
 * 정렬하지 않고 저장된 순서 그대로 넣는다(순서가 바뀌면 해시 입력도 바뀐다). 구조 결함은 고치지 않는다(sortedByKey 참조).
 *
 * 해시 함수(ctx.digest)의 책임: 이 내용은 객체이므로 digest 는 객체 키 삽입 순서에 영향을 받지 않아야 한다(키 순서 정규화된 직렬화).
 * 배열 요소 순서는 의미로 보고 그대로 해시한다 — 배열 정규화는 이 함수가 이미 끝냈다.
 * 운영 해시 구현은 M3 의 일이며, 시험의 testDigest 는 그 성질을 흉내 낸 대역일 뿐이다.
 */
export function profileContent(profile: StandardAssumptionProfile): unknown {
  return {
    id: profile.id,
    version: profile.version,
    generation: profile.generation,
    insurerType: profile.insurerType,
    groups: sortedByKey(profile.groups, 'groupKey'),
    groupOrder: profile.groupOrder,
    sharedLimitPools: sortedByKey(profile.sharedLimitPools, 'poolKey'),
  };
}

export function profileToRuleItem(profile: StandardAssumptionProfile): RuleItem {
  return {
    kind: 'PROFILE',
    state: profile.state,
    origin: profile.origin,
    validity: profile.validity,
    policySources: profile.policySources,
    approver: profile.approver,
    contentHash: profile.contentHash,
    content: profileContent(profile),
  };
}

/** 배열이 아닌 객체(null 제외)인지. 서류 규칙 항목의 모양을 읽기 전에 가려내는 데 쓴다. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 문자열이면 그 문자열, 아니면 빈 문자열. 정렬 키가 던지거나 비교가 흔들리지 않게 하려는 것이며 값을 고치지 않는다. */
function textKey(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 비교할 수 있는 숫자(NaN 제외)인지. Infinity 는 비교가 되므로 포함한다. */
function isRankable(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/** 숫자 우선순위는 오름차순, 숫자가 아닌 값은 모든 숫자 뒤에 두며 그들끼리는 동률이다(다음 키가 가른다). */
function comparePriority(a: unknown, b: unknown): number {
  if (isRankable(a) && isRankable(b)) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (isRankable(a)) {
    return -1;
  }
  return isRankable(b) ? 1 : 0;
}

/**
 * `when` 을 비교 키 문자열로 만든다: 키를 코드 포인트 순으로 정렬해 `키=종류:값` 을 이어 붙인다. 던지지 않는다.
 * 유효한 `when` 의 값은 문자열이거나 `true` 뿐이라 이 키로 충분하다. 객체가 아닌 `when` 은 빈 문자열이다.
 * 객체·배열 값은 내용을 보지 않고 종류만 쓴다(그런 값은 구조 검사가 거절한다).
 */
function whenSortKey(when: unknown): string {
  if (!isPlainRecord(when)) {
    return '';
  }
  return Object.keys(when)
    .sort(compareCodePoints)
    .map((key) => {
      const value = when[key];
      return `${key}=${typeof value}:${typeof value === 'object' ? '' : String(value)}`;
    })
    .join(';');
}

/** 서류 규칙 한 쌍의 총순서: documentCode → priority → reason → when 키. 모두 같으면 0(안정 정렬이 입력 순서를 유지한다). */
function compareDocumentRules(x: Record<string, unknown>, y: Record<string, unknown>): number {
  return (
    compareCodePoints(textKey(x.documentCode), textKey(y.documentCode)) ||
    comparePriority(x.priority, y.priority) ||
    compareCodePoints(textKey(x.reason), textKey(y.reason)) ||
    compareCodePoints(whenSortKey(x.when), whenSortKey(y.when))
  );
}

/**
 * 규칙이 배열이고 모든 항목이 배열이 아닌 객체이면 총순서로 정렬한 사본을, 아니면 받은 값 그대로 돌려준다.
 * 원본 배열과 항목은 바꾸지 않는다. 배열이 아니거나 null·원시값·배열 항목이 섞여 있으면 정렬하지 않는다:
 * 구조 결함을 정렬로 유효해 보이게 고치지 않으며, 그런 서류 규칙 묶음은 구조 검사(documents.ts)가 거절한다. 던지지 않는다.
 */
function sortedDocumentRules(rules: unknown): unknown {
  // Array.from 은 희소 배열의 빈 칸을 undefined 항목으로 바꿔 every 가 건너뛰지 못하게 한다(빈 칸이 있으면 정렬하지 않는다).
  if (!Array.isArray(rules) || !Array.from(rules).every(isPlainRecord)) {
    return rules;
  }
  return [...rules].sort(compareDocumentRules);
}

/**
 * 서류 규칙 묶음 내용 해시의 입력. 이 함수 하나가 정규화의 전부이며 다음 두 쪽이 똑같이 쓴다.
 *  (a) 해시를 만드는 쪽(M3 게시·봉인)과 (b) 해시를 검사하는 쪽(엔진의 isIntegral / documentRuleSetToRuleItem).
 *  두 번째 구현을 만들지 않는다: 정규화가 어긋나면 같은 규칙인데 INTEGRITY_MISMATCH 가 나 서류가 RULES_UNAVAILABLE 이 된다.
 *
 * 해시 입력에 드는 필드: id, version, rules. 머리 정보(state, origin, validity, policySources, approver)와
 * contentHash 자신은 뺀다.
 *
 * 정규화: rules 는 documentCode → priority(오름차순, 숫자가 아닌 값은 뒤) → reason → when 키 순의 총순서(문자열은 유니코드
 * 코드 포인트 순)로 정렬한 사본이다. 같은 규칙을 다른 배열 순서로 저장해도 같은 해시 입력이 된다(규칙의 위치는 의미가 없다,
 * DD-06 "규칙 평가" 8번). 배열이 아니거나 배열이 아닌 객체가 아닌 항목이 있으면 고치지 않고 받은 그대로 둔다(구조 검사가 거절한다).
 *
 * 해시 함수(ctx.digest)의 책임: 이 내용은 객체이므로 digest 는 객체 키 삽입 순서에 영향을 받지 않아야 한다(키 순서 정규화된
 * 직렬화). 운영 해시 구현은 M3 의 일이며, 시험의 testDigest 는 그 성질을 흉내 낸 대역일 뿐이다.
 */
export function documentRuleSetContent(ruleSet: DocumentRuleSet): unknown {
  return {
    id: ruleSet.id,
    version: ruleSet.version,
    rules: sortedDocumentRules(ruleSet.rules),
  };
}

export function documentRuleSetToRuleItem(ruleSet: DocumentRuleSet): RuleItem {
  return {
    kind: 'DOCUMENT_RULE_SET',
    state: ruleSet.state,
    origin: ruleSet.origin,
    validity: ruleSet.validity,
    policySources: ruleSet.policySources,
    approver: ruleSet.approver,
    contentHash: ruleSet.contentHash,
    content: documentRuleSetContent(ruleSet),
  };
}

/** currentFingerprint 는 항목 안의 값이 아니라 호출하는 쪽이 줄의 coverageFingerprint 에서 채워 넘긴다. */
export function mappingToRuleItem(mapping: TreatmentCoverageMapping, currentFingerprint: string): RuleItem {
  return {
    kind: 'MAPPING',
    state: mapping.state,
    origin: mapping.origin,
    validity: mapping.validity,
    policySources: mapping.policySources,
    approver: mapping.approver,
    approvedFingerprint: mapping.approvedFingerprint,
    currentFingerprint,
  };
}

// ───────────────────────── 사유 → 보류 코드 (DD-04 표) ─────────────────────────

/** isUsable 의 사유에서 나오는 프로필 보류 코드. 프로필 칸 조회가 더하는 PROFILE_ABSENT 는 resolveProfile 이 낸다. */
export type ProfileItemHoldCode = Extract<
  HoldReasonCode,
  | 'PROFILE_DEMO'
  | 'PROFILE_DRAFT'
  | 'PROFILE_UNAPPROVED'
  | 'PROFILE_UNDER_REREVIEW'
  | 'PROFILE_INVALID'
  | 'PROFILE_SOURCE_INCOMPLETE'
>;

/** 매핑 후보 하나의 보류 코드(isUsable 사유에서 나오는 것)와 후보가 없을 때의 MAPPING_ABSENT. */
export type MappingHoldCode = Extract<
  HoldReasonCode,
  'MAPPING_ABSENT' | 'MAPPING_UNREVIEWED' | 'MAPPING_REJECTED' | 'MAPPING_UNDER_REREVIEW' | 'MAPPING_INVALID'
>;

const PROFILE_CODES: Record<ItemUsabilityReason, ProfileItemHoldCode> = {
  ORIGIN_NOT_ACCEPTED: 'PROFILE_DEMO',
  STATE_DRAFT: 'PROFILE_DRAFT',
  STATE_UNAPPROVED: 'PROFILE_UNAPPROVED',
  STATE_REJECTED: 'PROFILE_UNAPPROVED',
  STATE_UNDER_REREVIEW: 'PROFILE_UNDER_REREVIEW',
  STATE_INVALID: 'PROFILE_INVALID',
  OUTSIDE_VALIDITY: 'PROFILE_INVALID',
  SOURCE_INCOMPLETE: 'PROFILE_SOURCE_INCOMPLETE',
  APPROVER_MISSING: 'PROFILE_SOURCE_INCOMPLETE',
  INTEGRITY_MISMATCH: 'PROFILE_INVALID',
};

const MAPPING_CODES: Record<ItemUsabilityReason, MappingHoldCode> = {
  ORIGIN_NOT_ACCEPTED: 'MAPPING_INVALID',
  STATE_DRAFT: 'MAPPING_UNREVIEWED',
  STATE_UNAPPROVED: 'MAPPING_UNREVIEWED',
  STATE_REJECTED: 'MAPPING_REJECTED',
  STATE_UNDER_REREVIEW: 'MAPPING_UNDER_REREVIEW',
  STATE_INVALID: 'MAPPING_INVALID',
  OUTSIDE_VALIDITY: 'MAPPING_INVALID',
  SOURCE_INCOMPLETE: 'MAPPING_INVALID',
  APPROVER_MISSING: 'MAPPING_INVALID',
  INTEGRITY_MISMATCH: 'MAPPING_UNDER_REREVIEW',
};

export function profileHoldCode(reason: ItemUsabilityReason): ProfileItemHoldCode {
  return PROFILE_CODES[reason];
}

export function mappingHoldCode(reason: ItemUsabilityReason): MappingHoldCode {
  return MAPPING_CODES[reason];
}

export function bundleHoldCode(reason: BundleUnusableReason): HoldReasonCode {
  return reason === 'SCOPE_ABSENT' ? 'CLINIC_RULE_SCOPE_ABSENT' : 'RULE_BUNDLE_SUSPENDED';
}
