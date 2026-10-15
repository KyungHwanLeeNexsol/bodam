import type {
  ApproverRecord,
  HoldReasonCode,
  LifecycleState,
  Origin,
  PolicySourceRef,
  RuleBundleSnapshot,
  RuleItemHeader,
  StandardAssumptionProfile,
  TreatmentCoverageMapping,
} from './types';

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
 * 프로필 내용 해시의 대상: 머리 정보(상태·출처·유효 기간·약관 출처·승인자)와 contentHash 자신을 뺀 계산 내용.
 * 해시를 만드는 쪽(M3)과 검사하는 쪽(엔진)이 같은 대상을 써야 하므로 여기서 한 번만 정한다.
 */
export function profileContent(profile: StandardAssumptionProfile): unknown {
  return {
    id: profile.id,
    version: profile.version,
    generation: profile.generation,
    insurerType: profile.insurerType,
    groups: profile.groups,
    groupOrder: profile.groupOrder,
    sharedLimitPools: profile.sharedLimitPools,
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
