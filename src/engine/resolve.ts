import { checkProfileStructure } from './profile-structure';
import {
  isUsable,
  mappingHoldCode,
  mappingToRuleItem,
  profileHoldCode,
  profileToRuleItem,
} from './usability';
import type { MappingHoldCode, ProfileItemHoldCode, UsabilityContext } from './usability';
import type {
  Generation,
  HoldReasonCode,
  InsurerType,
  LineState,
  Origin,
  PublishedLine,
  RuleBundleSnapshot,
  StandardAssumptionProfile,
  TreatmentCoverageMapping,
} from './types';

// 프로필 칸 조회·매핑 조회·줄 판정 (design.md DD-03 "매핑 조회 resolveMapping", DD-04 호출 순서 3~6).
// estimate() 와 운영 준비 상태 계산(DD-23, M3)이 같은 함수를 부른다. 두 번째 구현은 없다.

export interface Cell {
  generation: Generation;
  insurerType: InsurerType;
}

/** 시험이 호출 순서와 횟수를 감시할 수 있도록 밖에서 바꿔 끼울 수 있는 의존 함수. 기본값은 이 패키지의 실제 함수다. */
export interface ResolveDeps {
  isUsable: typeof isUsable;
  checkProfileStructure: typeof checkProfileStructure;
}

const DEFAULT_RESOLVE_DEPS: ResolveDeps = { isUsable, checkProfileStructure };

// ───────────────────────── 프로필 칸 조회 ─────────────────────────

export type ProfileResolution =
  | { resolved: true; profile: StandardAssumptionProfile }
  | { resolved: false; code: ProfileItemHoldCode | 'PROFILE_ABSENT' };

// @MX:ANCHOR: [AUTO] 프로필 칸 조회. estimate() 앞단과 운영 준비 상태 계산(M3, 표 P)이 모두 부른다.
// @MX:REASON: 칸 조회 → isUsable → 구조 검사의 한 묶음이 두 곳에서 어긋나면 "준비 완료인데 계산은 보류"가 생긴다(DD-23 규칙 0).
/**
 * (세대, 보험사 형태) 칸에서 프로필 하나를 찾아 사용 가능 판정과 구조 검사까지 거친다.
 * 칸에 프로필이 0개면 PROFILE_ABSENT, 2개 이상이면 PROFILE_INVALID(구조 결함, 하나를 골라 쓰지 않는다).
 * 다른 칸의 값을 대신 쓰지 않는다(대체 금지).
 */
export function resolveProfile(
  bundle: RuleBundleSnapshot,
  cell: Cell,
  ctx: UsabilityContext,
  deps: ResolveDeps = DEFAULT_RESOLVE_DEPS,
): ProfileResolution {
  const profiles = Array.isArray(bundle.profiles) ? bundle.profiles : [];
  const inCell = profiles.filter(
    (profile) => profile.generation === cell.generation && profile.insurerType === cell.insurerType,
  );
  const [only] = inCell;
  if (only === undefined) {
    return { resolved: false, code: 'PROFILE_ABSENT' };
  }
  if (inCell.length >= 2) {
    return { resolved: false, code: 'PROFILE_INVALID' };
  }
  const usable = deps.isUsable(profileToRuleItem(only), ctx);
  if (!usable.usable) {
    return { resolved: false, code: profileHoldCode(usable.reason) };
  }
  if (!deps.checkProfileStructure(only).ok) {
    return { resolved: false, code: 'PROFILE_INVALID' };
  }
  return { resolved: true, profile: only };
}

// ───────────────────────── 매핑 조회 ─────────────────────────

export type MappingResolution =
  | { resolved: true; mapping: TreatmentCoverageMapping }
  | { resolved: false; code: MappingHoldCode };

/** 사용 가능한 후보가 없을 때 고르는 고정 우선순위. 앞쪽일수록 다음 검토자 동작으로 사용 가능해질 가능성이 가깝다(SPEC 결정). */
const MAPPING_CODE_PRIORITY: readonly MappingHoldCode[] = [
  'MAPPING_UNDER_REREVIEW',
  'MAPPING_UNREVIEWED',
  'MAPPING_REJECTED',
  'MAPPING_INVALID',
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * 필드 규칙 방어. 게시 검증을 통과한 매핑은 규칙을 지키므로 이 위반은 저장 데이터 결함에서만 생긴다.
 * COVERED: groupKey 필수, exclusionReason 없음. EXCLUDED: groupKey 없음, exclusionReason 필수. decision 은 두 값뿐이다.
 */
function violatesMappingFieldRules(mapping: TreatmentCoverageMapping): boolean {
  if (mapping.decision === 'COVERED') {
    return !isNonEmptyString(mapping.groupKey) || mapping.exclusionReason !== undefined;
  }
  if (mapping.decision === 'EXCLUDED') {
    return mapping.groupKey !== undefined || !isNonEmptyString(mapping.exclusionReason);
  }
  return true;
}

// @MX:ANCHOR: [AUTO] 매핑 조회. 줄 판정(decideLine)을 거쳐 estimate() 와 운영 준비 상태 계산(M3, 표 M)이 부른다.
// @MX:REASON: 보장 여부의 유일한 출처가 매핑이므로 후보 범위·사용 가능 개수·우선순위가 한 곳에서 결정적으로 정해져야 한다(DD-03).
/**
 * 줄의 매핑 후보를 찾아 하나로 확정한다. 배열 순서에 기대는 단계는 없다.
 * 1) 후보 범위: treatmentId 가 같고 scope 에 이 칸이 든 매핑. 없으면 MAPPING_ABSENT.
 * 2) 후보마다 isUsable. 무결성(지문)이 마지막 검사이며 어긋난 후보는 사용 가능으로 세지 않는다.
 * 3) 사용 가능한 후보가 정확히 하나면 확정, 둘 이상이면 MAPPING_INVALID(모호), 없으면 고정 우선순위 코드 하나.
 */
export function resolveMapping(
  line: PublishedLine,
  bundle: RuleBundleSnapshot,
  cell: Cell,
  ctx: UsabilityContext,
  deps: Pick<ResolveDeps, 'isUsable'> = DEFAULT_RESOLVE_DEPS,
): MappingResolution {
  const mappings = Array.isArray(bundle.mappings) ? bundle.mappings : [];
  const candidates = mappings.filter(
    (mapping) =>
      mapping.treatmentId === line.treatmentId &&
      Array.isArray(mapping.scope) &&
      mapping.scope.some((entry) => entry.generation === cell.generation && entry.insurerType === cell.insurerType),
  );
  if (candidates.length === 0) {
    return { resolved: false, code: 'MAPPING_ABSENT' };
  }

  const usable: TreatmentCoverageMapping[] = [];
  const codes = new Set<MappingHoldCode>();
  for (const candidate of candidates) {
    const result = deps.isUsable(mappingToRuleItem(candidate, line.coverageFingerprint), ctx);
    if (result.usable) {
      usable.push(candidate);
    } else {
      codes.add(mappingHoldCode(result.reason));
    }
  }

  const [confirmed] = usable;
  if (usable.length >= 2) {
    return { resolved: false, code: 'MAPPING_INVALID' };
  }
  if (confirmed !== undefined) {
    return violatesMappingFieldRules(confirmed)
      ? { resolved: false, code: 'MAPPING_INVALID' }
      : { resolved: true, mapping: confirmed };
  }
  // 후보가 하나 이상이고 사용 가능한 후보가 없으면 후보마다 코드가 하나씩 있으므로 우선순위 목록에서 반드시 하나가 나온다.
  const picked = MAPPING_CODE_PRIORITY.find((code) => codes.has(code)) as MappingHoldCode;
  return { resolved: false, code: picked };
}

// ───────────────────────── 줄 판정 ─────────────────────────

export interface LineDecision {
  line: PublishedLine;
  state: LineState;
  /** ESTIMATED 줄에만 있다. */
  groupKey?: string;
  /** ON_HOLD 줄에만 있다. */
  holdReason?: HoldReasonCode;
  /** EXCLUDED_CONFIRMED 줄에만 있다. */
  exclusionReason?: string;
}

export interface DecideLineArgs {
  line: PublishedLine;
  bundle: RuleBundleSnapshot;
  profile: StandardAssumptionProfile;
  cell: Cell;
  ctx: UsabilityContext;
  /** 줄 허용 출처 (acceptedOrigins.lines). */
  acceptedLineOrigins: readonly Origin[];
}

export interface DecideDeps {
  resolveMapping: typeof resolveMapping;
  /** 프로필에 그 그룹 키가 있는지. COVERED 매핑에만 부른다. */
  lookupGroup: (profile: StandardAssumptionProfile, groupKey: string) => boolean;
}

/** 기본 그룹 조회: 프로필의 그룹 중 그 키를 가진 그룹이 있는지. */
export function profileHasGroup(profile: StandardAssumptionProfile, groupKey: string): boolean {
  return profile.groups.some((group) => group.groupKey === groupKey);
}

const DEFAULT_DECIDE_DEPS: DecideDeps = { resolveMapping, lookupGroup: profileHasGroup };

// @MX:ANCHOR: [AUTO] 줄 판정. estimate() 앞단과 운영 준비 상태 계산(M3, 표 M)이 같은 함수를 부른다.
// @MX:REASON: 줄 출처 → 분류 → 매핑 조회 → groupKey 의 판정 순서가 두 곳에서 갈라지면 한 줄에 여러 사유가 겹칠 때 보류 코드가 달라진다(DD-03).
/**
 * 줄 하나의 상태를 정한다. 판정 순서(한 줄에 여러 사유가 겹치면 첫 번째 하나만 기록):
 * 줄 출처 → 분류(NEEDS_REVIEW) → 매핑 조회 → 확정된 COVERED 매핑의 groupKey.
 * 확정된 EXCLUDED 매핑은 그룹을 조회하지 않고 EXCLUDED_CONFIRMED 다. 제외 지름길은 없다.
 * 공통 기본비용 줄도 치료와 같은 판정을 거친다.
 */
export function decideLine(args: DecideLineArgs, deps: DecideDeps = DEFAULT_DECIDE_DEPS): LineDecision {
  const { line, bundle, profile, cell, ctx, acceptedLineOrigins } = args;

  if (!acceptedLineOrigins.includes(line.origin)) {
    return { line, state: 'ON_HOLD', holdReason: 'LINE_ORIGIN_NOT_ACCEPTED' };
  }
  if (line.calcClass === 'NEEDS_REVIEW') {
    return { line, state: 'ON_HOLD', holdReason: 'CLASSIFICATION_NEEDS_REVIEW' };
  }

  const resolution = deps.resolveMapping(line, bundle, cell, ctx);
  if (!resolution.resolved) {
    return { line, state: 'ON_HOLD', holdReason: resolution.code };
  }

  const { mapping } = resolution;
  if (mapping.decision === 'EXCLUDED') {
    return { line, state: 'EXCLUDED_CONFIRMED', exclusionReason: mapping.exclusionReason as string };
  }
  const groupKey = mapping.groupKey as string;
  if (!deps.lookupGroup(profile, groupKey)) {
    return { line, state: 'ON_HOLD', holdReason: 'MAPPING_GROUP_NOT_IN_PROFILE' };
  }
  return { line, state: 'ESTIMATED', groupKey };
}
