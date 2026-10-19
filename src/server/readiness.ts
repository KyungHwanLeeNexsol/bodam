import { selectDocumentRuleSet } from '../engine/documents';
import { checkGroupValues } from '../engine/group-values';
import { checkProfileStructure } from '../engine/profile-structure';
import { decideLine, profileHasGroup, resolveMapping, resolveProfile } from '../engine/resolve';
import type { Cell, ProfileResolution } from '../engine/resolve';
import { GENERATIONS } from '../engine/types';
import type {
  CoverageGroupDef,
  DocumentRuleSet,
  HoldReasonCode,
  InsurerType,
  Origin,
  PublishedLine,
  RuleBundleSnapshot,
  StandardAssumptionProfile,
} from '../engine/types';
import { bundleHoldCode, documentRuleSetToRuleItem, isBundleUsable, isUsable } from '../engine/usability';
import type { BundleUnusableReason, ItemUsabilityReason, UsabilityContext } from '../engine/usability';
import { compareCodePoints } from '../engine/validate';
import { canonicalDigest } from './digest';
import type { RuleBundleVersion } from './domain/entities';
import { DomainError } from './domain/errors';
import { formatRef } from './domain/items';
import type { ItemVersionRecordOf } from './domain/items';
import { toEngineBaseFeeLine, toEngineDocumentRuleSet, toEngineMapping, toEnginePublishedLine, toEngineProfile } from './domain/projection';
import { selectPublishedTreatments } from './published-treatments';
import type { PublishedTreatmentDefect } from './published-treatments';
import type { Repository } from './repo/interfaces';

// 운영 준비 상태 계산 (SPEC-REIMBURSEMENT-001 M3.E, design.md DD-23, REQ-DATA-004, AC-011c·j·k·l).
// "준비 완료" 하나로 줄이지 않는다. 계산이 실제로 기대는 자료 네 가지를 네 개의 표로 따로 내고, 병원마다 서로 독립인 두 조건
// (calculationReady 15칸, documentReady)을 그 표들에서 유도한다.
//   표 P  프로필 칸 (세대 5 × 보험사 형태 3 = 15칸): 플랫폼 보기(모든 묶음)와 병원 보기(병원의 규칙 사용 범위가 가리키는 묶음)
//   표 M  치료별 매핑 (병원 × 게시된 줄 × 15칸): 묶음의 가용성은 보지 않는다(표 S 의 몫)
//   표 D  서류 규칙 (병원)
//   표 S  규칙 사용 범위와 묶음 상태 (병원)
//
// 규칙 0 (두 번째 구현 없음): 이 모듈은 상태·출처·유효 기간·약관 출처·승인자·해시를 스스로 비교하지 않는다. 판정은 모두 estimate() 가
// 쓰는 엔진 함수(isBundleUsable, isUsable, resolveProfile, resolveMapping, decideLine, checkGroupValues, selectDocumentRuleSet)를
// 그대로 불러 얻고, 같은 순서로 같은 인자를 넘긴다. 새 보류 코드는 없다. 이 규칙은 readiness-reuse.test.ts 가 가져오기·비교 금지·호출 감시로 지킨다.
// 준비 상태가 보지 않는 것: CALC_RANGE_EXCEEDED 와 INVALID_NUMERIC_INPUT 은 저장 자료가 아니라 환자가 고른 금액의 크기에 달려 있다(DD-24).
//
// 두 층이다. computeReadiness 는 스냅샷만 읽는 순수 함수이고(입력을 바꾸지 않으며 결과는 입력과 분리된 복사본), loadReadinessSnapshot 은
// 저장소를 읽기만 해서 스냅샷을 만든다(항목의 현재 상태와 묶음 가용성은 호출마다 새로 읽는다, DD-14). 시각과 허용 출처, 해시 함수는 주입받는다.

// ───────────────────────── 구성 ─────────────────────────

/** 보험사 형태 3종 (손해보험사 / 생명보험사 / 그외 공제 조합). */
export const INSURER_TYPES: readonly InsurerType[] = Object.freeze(['NON_LIFE', 'LIFE', 'MUTUAL_AID'] as const);

/** 프로필 칸 15개. 세대가 바깥, 보험사 형태가 안쪽 순서다. 모든 보고의 칸 순서가 이 순서이며 보고에는 칸의 복사본을 싣는다. */
export const READINESS_CELLS: readonly Cell[] = Object.freeze(
  GENERATIONS.flatMap((generation) => INSURER_TYPES.map((insurerType) => Object.freeze({ generation, insurerType }))),
);

/**
 * 준비 상태 계산의 주입 구성(DD-23 규칙 0). at 은 판정 기준일(YYYY-MM-DD), acceptedOrigins 는 규칙 데이터와 줄의 허용 출처,
 * digest 는 내용 해시 함수다. 항목 판정의 UsabilityContext 는 rules 쪽 허용 출처로 만든다(DD-04).
 */
export interface ReadinessContext {
  at: string;
  acceptedOrigins: { rules: readonly Origin[]; lines: readonly Origin[] };
  digest: (content: unknown) => string;
}

/**
 * 운영 구성: 규칙 데이터와 줄 모두 OPERATING 출처만 받고 해시는 운영 해시(canonicalDigest)다.
 * 이 구성에서는 DEMO·시험 출처 자료가 모두 사용 불가로 나온다(AC-010c).
 */
export function operatingReadinessContext(at: string): ReadinessContext {
  return { at, acceptedOrigins: { rules: ['OPERATING'], lines: ['OPERATING'] }, digest: canonicalDigest };
}

/**
 * 시험이 호출 순서와 횟수를 감시할 수 있도록 바꿔 끼울 수 있는 엔진 함수들. 기본값은 엔진의 실제 함수다(estimateFront 의 FrontFunctions 와 같은 방식).
 * 바꿔 끼우는 것은 감시와 "이 함수를 바꾸면 표가 따라 바뀐다"는 시험을 위한 것이며 운영 경로에서는 쓰지 않는다.
 */
export interface ReadinessFunctions {
  isBundleUsable: typeof isBundleUsable;
  isUsable: typeof isUsable;
  resolveProfile: typeof resolveProfile;
  checkProfileStructure: typeof checkProfileStructure;
  resolveMapping: typeof resolveMapping;
  decideLine: typeof decideLine;
  checkGroupValues: typeof checkGroupValues;
  selectDocumentRuleSet: typeof selectDocumentRuleSet;
}

const REAL_FUNCTIONS: ReadinessFunctions = {
  isBundleUsable,
  isUsable,
  resolveProfile,
  checkProfileStructure,
  resolveMapping,
  decideLine,
  checkGroupValues,
  selectDocumentRuleSet,
};

// ───────────────────────── 스냅샷 (입력) ─────────────────────────

/**
 * 병원 하나의 입력: 규칙 사용 범위가 가리키는 묶음(없으면 null)과 현재 카탈로그의 게시 줄(치료 줄, 공통 기본비용 줄).
 * 치료 줄은 현재 게시된 치료(활성 치료)의 줄이다: 공개 카탈로그와 계산 요청이 보는 치료와 같은 집합이다(published-treatments.ts).
 */
export interface ReadinessClinicInput {
  clinicId: string;
  slug: string;
  bundle: RuleBundleSnapshot | null;
  lines: PublishedLine[];
  baseFeeLines: PublishedLine[];
}

/** 병원들과 모든 규칙 묶음(내용 + 방금 읽은 항목 상태 + 방금 읽은 가용성). 플랫폼 보기는 bundles 전부를 후보로 본다. */
export interface ReadinessSnapshot {
  bundles: RuleBundleSnapshot[];
  clinics: ReadinessClinicInput[];
}

// ───────────────────────── 보고 (출력) ─────────────────────────

/** 표 P 플랫폼 보기의 한 칸. READY 이면 그 칸의 프로필을 내는 ACTIVE 후보 묶음 id(id 순). */
export type PlatformProfileRow = { cell: Cell } & ({ status: 'READY'; bundleIds: string[] } | { status: 'NOT_READY'; code: HoldReasonCode });

/** 표 P 병원 보기의 한 칸. */
export type ClinicProfileRow = { cell: Cell } & (
  | { status: 'READY'; bundleId: string; profileId: string; profileVersion: string }
  | { status: 'NOT_READY'; code: HoldReasonCode }
);

/** 표 S. 값은 isBundleUsable 의 결과 그대로(SCOPE_ABSENT, BUNDLE_SUSPENDED, ACTIVE)이고 ACTIVE 만 READY 다. */
export type ScopeRow =
  | { status: 'READY'; value: 'ACTIVE'; bundleId: string; contentHash: string }
  | { status: 'NOT_READY'; value: BundleUnusableReason; code: HoldReasonCode; bundleId: string | null; contentHash: string | null };

/** 표 M 의 한 행. READY 이고 confirmedExclusion 이면 보고에 `READY (EXCLUDED_CONFIRMED)` 로 적는다. */
export type MappingRow = { treatmentId: string; isBaseFee: boolean; cell: Cell } & (
  | { status: 'READY'; confirmedExclusion: boolean }
  | { status: 'NOT_READY'; code: HoldReasonCode }
);

/**
 * 표 D 의 세부 사유(보고용 표시이며 보류 코드가 아니다): 묶음 단계(SCOPE_ABSENT, BUNDLE_SUSPENDED), 묶음에 서류 규칙 묶음이 없음(SET_ABSENT),
 * 항목 판정의 사유(ItemUsabilityReason), 구조 결함(SET_STRUCTURE_INVALID, [문서에 없음]: DD-23 이 구조 결함의 세부 표시를 정하지 않아 더했다).
 */
export type DocumentUnavailableDetail = BundleUnusableReason | 'SET_ABSENT' | 'SET_STRUCTURE_INVALID' | ItemUsabilityReason;

export type DocumentRow =
  | { status: 'READY'; ruleSetId: string; ruleSetVersion: string }
  | { status: 'NOT_READY'; code: 'RULES_UNAVAILABLE'; detail: DocumentUnavailableDetail };

/**
 * calculationReady 의 한 칸. NOT_READY 이면 판정 순서의 첫 단계로 보고한다: S(표 S 의 코드) → P(표 P 병원 보기의 코드) →
 * TREATMENT(게시된 치료 없음, 보고용 표시이며 보류 코드가 아니다) → M(표 M 의 NOT_READY 줄과 줄별 코드, 줄 id 순).
 */
export type CalculationRow = { cell: Cell } & (
  | { status: 'READY' }
  | { status: 'NOT_READY'; stage: 'S' | 'P'; code: HoldReasonCode }
  | { status: 'NOT_READY'; stage: 'TREATMENT'; code: 'NO_PUBLISHED_TREATMENT' }
  | { status: 'NOT_READY'; stage: 'M'; lines: Array<{ treatmentId: string; code: HoldReasonCode }> }
);

/** documentReady = S == ACTIVE ∧ D == READY. 막힌 단계가 S 이면 S 의 코드, D 이면 RULES_UNAVAILABLE 과 세부 사유. */
export type DocumentReadyRow =
  | { status: 'READY' }
  | { status: 'NOT_READY'; stage: 'S'; code: HoldReasonCode }
  | { status: 'NOT_READY'; stage: 'D'; code: 'RULES_UNAVAILABLE'; detail: DocumentUnavailableDetail };

export interface ClinicReadiness {
  clinicId: string;
  slug: string;
  scope: ScopeRow;
  profiles: ClinicProfileRow[];
  /** 줄 id 의 코드 포인트 순, 같은 줄 안에서는 READINESS_CELLS 순. */
  mappings: MappingRow[];
  documents: DocumentRow;
  calculationReady: CalculationRow[];
  documentReady: DocumentReadyRow;
}

export interface ReadinessReport {
  platformProfiles: PlatformProfileRow[];
  /** 병원 id 의 코드 포인트 순. */
  clinics: ClinicReadiness[];
}

// ───────────────────────── 프로필 칸 ─────────────────────────

type ProfileStage = { ready: true; bundleId: string; profile: StandardAssumptionProfile } | { ready: false; code: HoldReasonCode };

/**
 * estimate() 앞단의 묶음 → 프로필 두 단계와 같다(estimateFront): 묶음이 사용 불가이면 그 코드, 아니면 resolveProfile 의 결과.
 * 묶음 안의 항목은 묶음이 사용 불가이면 한 번도 읽지 않는다.
 */
function profileStage(bundle: RuleBundleSnapshot | null, cell: Cell, uctx: UsabilityContext, fns: ReadinessFunctions): ProfileStage {
  const gate = fns.isBundleUsable(bundle);
  if (!gate.usable) {
    return { ready: false, code: bundleHoldCode(gate.reason) };
  }
  const resolution = resolveProfileIn(gate.bundle, cell, uctx, fns);
  return resolution.resolved
    ? { ready: true, bundleId: gate.bundle.id, profile: resolution.profile }
    : { ready: false, code: resolution.code };
}

const resolveProfileIn = (bundle: RuleBundleSnapshot, cell: Cell, uctx: UsabilityContext, fns: ReadinessFunctions): ProfileResolution =>
  fns.resolveProfile(bundle, cell, uctx, { isUsable: fns.isUsable, checkProfileStructure: fns.checkProfileStructure });

/**
 * 플랫폼 보기에서 후보가 여럿이고 모두 사용 불가일 때 사유를 하나로 정하는 고정 우선순위(DD-23 SPEC 결정, 보고용이며 계산에는 쓰이지 않는다).
 * 앞쪽일수록 사용 가능해질 가능성이 가깝다. 후보의 배열 순서와 무관하다.
 */
const PLATFORM_PRIORITY: readonly HoldReasonCode[] = [
  'PROFILE_UNDER_REREVIEW',
  'PROFILE_UNAPPROVED',
  'PROFILE_DRAFT',
  'PROFILE_SOURCE_INCOMPLETE',
  'PROFILE_INVALID',
  'PROFILE_DEMO',
  'RULE_BUNDLE_SUSPENDED',
];

/** 후보 = 그 칸의 프로필을 담은 묶음. 칸에 프로필이 하나도 없는 묶음은 후보가 아니다. */
function isCandidate(bundle: RuleBundleSnapshot, cell: Cell): boolean {
  return Array.isArray(bundle.profiles) && bundle.profiles.some((profile) => profile.generation === cell.generation && profile.insurerType === cell.insurerType);
}

function platformRows(bundles: readonly RuleBundleSnapshot[], uctx: UsabilityContext, fns: ReadinessFunctions): PlatformProfileRow[] {
  return READINESS_CELLS.map((cell): PlatformProfileRow => {
    const readyBundleIds: string[] = [];
    const codes = new Set<HoldReasonCode>();
    for (const bundle of bundles.filter((candidate) => isCandidate(candidate, cell))) {
      const stage = profileStage(bundle, cell, uctx, fns);
      if (stage.ready) {
        readyBundleIds.push(stage.bundleId);
      } else {
        codes.add(stage.code);
      }
    }
    if (readyBundleIds.length > 0) {
      return { cell: { ...cell }, status: 'READY', bundleIds: readyBundleIds.sort(compareCodePoints) };
    }
    // 후보가 없으면 codes 도 비어 있다. 후보가 있으면 후보마다 코드가 하나씩 있으므로 우선순위 목록에서 반드시 하나가 나온다.
    const code = codes.size === 0 ? 'PROFILE_ABSENT' : (PLATFORM_PRIORITY.find((candidate) => codes.has(candidate)) as HoldReasonCode);
    return { cell: { ...cell }, status: 'NOT_READY', code };
  });
}

// ───────────────────────── 표 S ─────────────────────────

function scopeRow(bundle: RuleBundleSnapshot | null, fns: ReadinessFunctions): ScopeRow {
  const gate = fns.isBundleUsable(bundle);
  if (gate.usable) {
    return { status: 'READY', value: 'ACTIVE', bundleId: gate.bundle.id, contentHash: gate.bundle.contentHash };
  }
  return {
    status: 'NOT_READY',
    value: gate.reason,
    code: bundleHoldCode(gate.reason),
    bundleId: bundle === null ? null : bundle.id,
    contentHash: bundle === null ? null : bundle.contentHash,
  };
}

// ───────────────────────── 표 D ─────────────────────────

/**
 * 서류 규칙 묶음을 쓸 수 없는 이유의 보고용 표시. 쓸 수 있는지는 selectDocumentRuleSet 이 정하고(호출하는 쪽), 이 함수는 null 이 나온 뒤에만 불린다.
 * 순서는 그 함수와 같다: 묶음 → 서류 규칙 묶음 있음 → 항목 판정(isUsable) → 남는 것은 구조 결함뿐이다.
 */
function unavailableDetail(bundle: RuleBundleSnapshot | null, uctx: UsabilityContext, fns: ReadinessFunctions): DocumentUnavailableDetail {
  const gate = fns.isBundleUsable(bundle);
  if (!gate.usable) {
    return gate.reason;
  }
  const ruleSet: unknown = gate.bundle.documentRuleSet;
  if (typeof ruleSet !== 'object' || ruleSet === null || Array.isArray(ruleSet)) {
    return 'SET_ABSENT';
  }
  const verdict = fns.isUsable(documentRuleSetToRuleItem(ruleSet as DocumentRuleSet), uctx);
  return verdict.usable ? 'SET_STRUCTURE_INVALID' : verdict.reason;
}

function documentRow(bundle: RuleBundleSnapshot | null, uctx: UsabilityContext, fns: ReadinessFunctions): DocumentRow {
  const selected = fns.selectDocumentRuleSet(bundle, uctx);
  if (selected !== null) {
    return { status: 'READY', ruleSetId: selected.id, ruleSetVersion: selected.version };
  }
  return { status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail: unavailableDetail(bundle, uctx, fns) };
}

// ───────────────────────── 표 M ─────────────────────────

/** 범위가 없으면 매핑 자료는 빈 집합으로 본다(DD-23 표 M). */
const EMPTY_BUNDLE: RuleBundleSnapshot = { id: '', contentHash: '', status: 'ACTIVE', profiles: [], mappings: [], documentRuleSet: null };

// 프로필 칸이 해석되지 않았을 때 decideLine 의 profile 인자 자리를 채운다. 이 경우 lookupGroup 을 바꿔 끼우므로 읽히지 않는다.
const NO_PROFILE = { groups: [] } as unknown as StandardAssumptionProfile;

type MappingVerdict = { status: 'READY'; confirmedExclusion: boolean } | { status: 'NOT_READY'; code: HoldReasonCode };

// @MX:NOTE: [AUTO] 표 M 은 묶음의 가용성을 보지 않는다(DD-23: 표 S 의 몫). 프로필 칸이 해석되지 않을 때의 사유도 묶음이 중지여서가 아니라
// resolveProfile 의 코드다 [문서에 없음: DD-23 은 "표 P(병원 보기)의 같은 칸 사유"라고 적지만 표 P 병원 보기는 중지된 묶음을 RULE_BUNDLE_SUSPENDED 로 낸다].
// 가용성이 ACTIVE 일 때는 두 해석이 같고, 중지일 때는 calculationReady 가 S 단계에서 먼저 막으므로 보고되는 결과는 같다.

/**
 * 줄 하나 × 칸 하나. 줄 판정 decideLine(줄 출처 → 분류 → resolveMapping → groupKey)을 estimate() 와 같은 인자로 부르고, 사용 가능한 COVERED 이면
 * 그 그룹을 checkGroupValues 로 검사한다. 묶음의 가용성은 보지 않는다(표 S 의 몫): 프로필 칸은 resolveProfile 로 직접 해석한다.
 * 확인된 제외(EXCLUDED_CONFIRMED)는 결과가 결정적이므로 READY 다. 사용 가능한 COVERED 인데 프로필이 해석되지 않으면 그룹을 볼 수 없어
 * NOT_READY 이고 사유는 그 칸의 프로필 단계 코드다(표 P 병원 보기의 같은 칸 사유).
 */
function mappingVerdict(
  line: PublishedLine,
  bundle: RuleBundleSnapshot,
  cell: Cell,
  profile: ProfileResolution,
  uctx: UsabilityContext,
  ctx: ReadinessContext,
  fns: ReadinessFunctions,
): MappingVerdict {
  const decision = fns.decideLine(
    { line, bundle, profile: profile.resolved ? profile.profile : NO_PROFILE, cell, ctx: uctx, acceptedLineOrigins: ctx.acceptedOrigins.lines },
    {
      resolveMapping: (target, targetBundle, targetCell, targetCtx) => fns.resolveMapping(target, targetBundle, targetCell, targetCtx, { isUsable: fns.isUsable }),
      lookupGroup: profile.resolved ? profileHasGroup : () => true,
    },
  );
  if (decision.state === 'ON_HOLD') {
    return { status: 'NOT_READY', code: decision.holdReason as HoldReasonCode };
  }
  if (decision.state === 'EXCLUDED_CONFIRMED') {
    return { status: 'READY', confirmedExclusion: true };
  }
  if (!profile.resolved) {
    return { status: 'NOT_READY', code: profile.code };
  }
  // lookupGroup 이 통과했으므로 그룹은 프로필에 있다.
  const group = profile.profile.groups.find((candidate) => candidate.groupKey === decision.groupKey) as CoverageGroupDef;
  const valueCode = fns.checkGroupValues(group, profile.profile);
  return valueCode === null ? { status: 'READY', confirmedExclusion: false } : { status: 'NOT_READY', code: valueCode };
}

// ───────────────────────── 병원 ─────────────────────────

function clinicReadiness(clinic: ReadinessClinicInput, ctx: ReadinessContext, uctx: UsabilityContext, fns: ReadinessFunctions): ClinicReadiness {
  const scope = scopeRow(clinic.bundle, fns);
  const documents = documentRow(clinic.bundle, uctx, fns);

  const profileStages = READINESS_CELLS.map((cell) => profileStage(clinic.bundle, cell, uctx, fns));
  const profiles = READINESS_CELLS.map((cell, index): ClinicProfileRow => {
    const stage = profileStages[index] as ProfileStage;
    return stage.ready
      ? { cell: { ...cell }, status: 'READY', bundleId: stage.bundleId, profileId: stage.profile.id, profileVersion: stage.profile.version }
      : { cell: { ...cell }, status: 'NOT_READY', code: stage.code };
  });

  // 표 M: 줄 × 칸. 줄은 id 순으로 정렬한 사본이다(입력 배열을 바꾸지 않는다).
  const mappingBundle = clinic.bundle === null ? EMPTY_BUNDLE : clinic.bundle;
  const resolutions = READINESS_CELLS.map((cell) => resolveProfileIn(mappingBundle, cell, uctx, fns));
  const lines = [...clinic.lines, ...clinic.baseFeeLines].sort((a, b) => compareCodePoints(a.treatmentId, b.treatmentId));
  const grid = lines.map((line) =>
    READINESS_CELLS.map(
      (cell, index): MappingRow => ({
        treatmentId: line.treatmentId,
        isBaseFee: line.isBaseFee,
        cell: { ...cell },
        ...mappingVerdict(line, mappingBundle, cell, resolutions[index] as ProfileResolution, uctx, ctx, fns),
      }),
    ),
  );

  const calculationReady = READINESS_CELLS.map((cell, index): CalculationRow => {
    const base = { cell: { ...cell } };
    if (scope.status === 'NOT_READY') {
      return { ...base, status: 'NOT_READY', stage: 'S', code: scope.code };
    }
    const profile = profiles[index] as ClinicProfileRow;
    if (profile.status === 'NOT_READY') {
      return { ...base, status: 'NOT_READY', stage: 'P', code: profile.code };
    }
    if (clinic.lines.length === 0) {
      return { ...base, status: 'NOT_READY', stage: 'TREATMENT', code: 'NO_PUBLISHED_TREATMENT' };
    }
    const blocked = grid.flatMap((row) => {
      const entry = row[index] as MappingRow;
      return entry.status === 'NOT_READY' ? [{ treatmentId: entry.treatmentId, code: entry.code }] : [];
    });
    return blocked.length === 0 ? { ...base, status: 'READY' } : { ...base, status: 'NOT_READY', stage: 'M', lines: blocked };
  });

  const documentReady: DocumentReadyRow =
    scope.status === 'NOT_READY'
      ? { status: 'NOT_READY', stage: 'S', code: scope.code }
      : documents.status === 'READY'
        ? { status: 'READY' }
        : { status: 'NOT_READY', stage: 'D', code: documents.code, detail: documents.detail };

  return { clinicId: clinic.clinicId, slug: clinic.slug, scope, profiles, mappings: grid.flat(), documents, calculationReady, documentReady };
}

// @MX:ANCHOR: [AUTO] 운영 준비 상태 계산의 단일 진입점. 저장소 읽기(readReadiness), 준비 상태 시험(M3.E), 운영 개시 관문의 보고(M8), 계산 경로 점검(M4)이 부른다.
// @MX:REASON: 네 표와 두 조건이 estimate() 와 같은 엔진 함수에서만 나와야 "준비 완료인데 계산은 보류"가 생기지 않는다(DD-23 규칙 0). 판정을 이 파일에서 따로 구현하는 순간 그 약속이 깨진다.
/**
 * 스냅샷을 읽기만 하는 순수 함수. 입력을 바꾸지 않고 결과는 입력의 객체를 담지 않은 복사본이며, 같은 입력이면 배열 순서와 무관하게 같은 결과를 낸다
 * (병원은 id 순, 줄은 id 순, 칸은 READINESS_CELLS 순). 던지지 않는다(해시 함수가 던지는 경우는 주입한 쪽의 책임이다).
 * 한 표의 READY 만으로 병원이나 운영이 준비되었다고 보고하는 경로는 없다: 보고는 (칸별 calculationReady, documentReady) 짝이고
 * NOT_READY 이면 막힌 단계와 코드를 함께 담는다.
 */
export function computeReadiness(snapshot: ReadinessSnapshot, ctx: ReadinessContext, functions: Partial<ReadinessFunctions> = {}): ReadinessReport {
  const fns: ReadinessFunctions = { ...REAL_FUNCTIONS, ...functions };
  const uctx: UsabilityContext = { at: ctx.at, acceptedOrigins: ctx.acceptedOrigins.rules, digest: ctx.digest };
  return {
    platformProfiles: platformRows(snapshot.bundles, uctx, fns),
    clinics: [...snapshot.clinics].sort((a, b) => compareCodePoints(a.clinicId, b.clinicId)).map((clinic) => clinicReadiness(clinic, ctx, uctx, fns)),
  };
}

// ───────────────────────── 저장소 읽기 ─────────────────────────

/** 스냅샷을 만드는 데 쓰는 읽기 메서드들. 쓰기 메서드는 받지 않는다(읽기 전용을 형식으로 보인다). */
export type ReadinessReads = Pick<
  Repository,
  | 'listClinics'
  | 'getClinicRuleScope'
  | 'getClinicCurrentCatalogVersion'
  | 'getTreatmentVersion'
  | 'getTreatment'
  | 'getCommonBaseFee'
  | 'listRuleBundleVersions'
  | 'getBundleStatus'
  | 'getItemVersion'
  | 'readItemStates'
>;

/**
 * [문서에 없음] 저장소가 가리키는 자료가 없으면(깨진 저장소) 상태를 추측하지 않고 NOT_FOUND 로 거절한다. 서비스 경로로는 생길 수 없는 경우다:
 * 게시는 묶음·가용성 기록·항목 상태를 한 트랜잭션에 쓰고, 저장소는 없는 자료를 가리키는 쓰기를 거절한다.
 */
const INCONSISTENT_STORE = '저장소가 일관되지 않아 준비 상태를 낼 수 없다';

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new DomainError('NOT_FOUND', `${what} 이(가) 없다 (${INCONSISTENT_STORE})`);
  }
  return value;
}

/**
 * 공유 선택 기준(published-treatments.ts)이 알린 결함을 이 층의 깨진 저장소 거절(DomainError)로 바꾼다. 공개 경로의 ServerIntegrityError 와 같은 세 결함이고
 * 같은 순서로 걸린다. 운영자 보고 경로라서 어느 자료인지(id)를 메시지에 싣는다.
 */
function publishedTreatmentFailure(defect: PublishedTreatmentDefect): never {
  switch (defect.code) {
    case 'TREATMENT_VERSION_MISSING':
      throw new DomainError('NOT_FOUND', `치료 버전 '${defect.treatmentVersionId}' 이(가) 없다 (${INCONSISTENT_STORE})`);
    case 'TREATMENT_MISSING':
      throw new DomainError('NOT_FOUND', `치료 버전 '${defect.treatmentVersionId}' 이(가) 가리키는 치료 '${defect.treatmentId}' 이(가) 없다 (${INCONSISTENT_STORE})`);
    case 'TREATMENT_CLINIC_MISMATCH':
      throw new DomainError('REF_CONTENT_MISMATCH', `카탈로그가 담은 치료 '${defect.treatmentId}' 이(가) 병원 '${defect.clinicId}' 의 것이 아니다 (${INCONSISTENT_STORE})`);
  }
}

/** 묶음 하나를 엔진 입력으로 조립한다: 바뀌지 않는 항목 내용 + 방금 읽은 항목 상태(projection.ts 의 단일 합성) + 방금 읽은 가용성. */
function assembleBundle(repo: ReadinessReads, version: RuleBundleVersion): RuleBundleSnapshot {
  const states = repo.readItemStates(version.itemRefs);
  const snapshot: RuleBundleSnapshot = {
    id: version.id,
    contentHash: version.contentHash,
    status: must(repo.getBundleStatus(version.id), `묶음 '${version.id}' 의 가용성 기록`),
    profiles: [],
    mappings: [],
    documentRuleSet: null,
  };
  version.itemRefs.forEach((ref, index) => {
    const record = must(repo.getItemVersion(ref), `항목 ${formatRef(ref)} 의 내용`);
    const state = must(states[index], `항목 ${formatRef(ref)} 의 상태 기록`);
    if (ref.kind === 'PROFILE') {
      snapshot.profiles.push(toEngineProfile(record as ItemVersionRecordOf<'PROFILE'>, state));
    } else if (ref.kind === 'MAPPING') {
      snapshot.mappings.push(toEngineMapping(record as ItemVersionRecordOf<'MAPPING'>, state));
    } else if (snapshot.documentRuleSet === null) {
      // [문서에 없음] 묶음 게시는 서류 규칙 묶음을 하나만 허용한다. 둘 이상이 저장돼 있으면(서비스로는 만들 수 없다) 저장된 itemRefs 순서의 첫 번째만 쓴다.
      snapshot.documentRuleSet = toEngineDocumentRuleSet(record as ItemVersionRecordOf<'DOCUMENT_RULE_SET'>, state);
    }
  });
  return snapshot;
}

/**
 * 저장소를 읽기만 해서 스냅샷을 만든다. 아무것도 쓰지 않는다. 항목의 현재 상태와 묶음 가용성은 호출마다 새로 읽는다(캐시하지 않는다, DD-14).
 * 병원의 게시 줄 = 현재 카탈로그 버전에 든 치료 버전 가운데 활성 치료의 것(공개 카탈로그·계산 요청과 같은 선택, published-treatments.ts)과
 * 공통 기본비용 전부(projection.ts 의 줄 변환). 비활성 치료의 줄은 없다: 계산이 하지 못하는 치료가 준비 상태를 막거나 줄이 하나도 없는데 준비 완료로 나오지 않는다.
 * 결과는 저장소와 분리된 복사본이다.
 */
export function loadReadinessSnapshot(repo: ReadinessReads): ReadinessSnapshot {
  const bundles = repo.listRuleBundleVersions().map((version) => assembleBundle(repo, version));
  const byId = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const clinics = repo.listClinics().map((clinic): ReadinessClinicInput => {
    const scope = repo.getClinicRuleScope(clinic.id);
    const catalog = repo.getClinicCurrentCatalogVersion(clinic.id);
    return {
      clinicId: clinic.id,
      slug: clinic.slug,
      bundle: scope === null ? null : must(byId.get(scope.ruleBundleVersionId), `병원 '${clinic.id}' 의 규칙 사용 범위가 가리키는 묶음 '${scope.ruleBundleVersionId}'`),
      lines: catalog === null ? [] : selectPublishedTreatments(repo, clinic.id, catalog, publishedTreatmentFailure).map(({ version }) => toEnginePublishedLine(version)),
      baseFeeLines: catalog === null ? [] : catalog.baseFeeIds.map((id) => toEngineBaseFeeLine(must(repo.getCommonBaseFee(id), `공통 기본비용 '${id}'`))),
    };
  });
  return { bundles, clinics };
}

/** 저장소에서 읽어 바로 보고를 낸다 (loadReadinessSnapshot → computeReadiness). 쓰지 않는다. */
export function readReadiness(repo: ReadinessReads, ctx: ReadinessContext, functions: Partial<ReadinessFunctions> = {}): ReadinessReport {
  return computeReadiness(loadReadinessSnapshot(repo), ctx, functions);
}

// ───────────────────────── 문자열 보고 ─────────────────────────

const cellLabel = (cell: Cell): string => `${cell.generation}/${cell.insurerType}`;

function describeCalculation(row: CalculationRow): string {
  const label = `calculationReady[${cellLabel(row.cell)}]`;
  if (row.status === 'READY') {
    return `  ${label} READY`;
  }
  if (row.stage === 'M') {
    return `  ${label} NOT_READY stage=M lines=${row.lines.map((line) => `${line.treatmentId}:${line.code}`).join(',')}`;
  }
  return `  ${label} NOT_READY stage=${row.stage} code=${row.code}`;
}

function describeDocumentReady(row: DocumentReadyRow): string {
  if (row.status === 'READY') {
    return '  documentReady READY';
  }
  return row.stage === 'S' ? `  documentReady NOT_READY stage=S code=${row.code}` : `  documentReady NOT_READY stage=D code=${row.code} detail=${row.detail}`;
}

/**
 * 사람이 읽는 보고 문자열. 두 조건은 서로 다른 줄에 따로 나오고 합친 표현은 없다(AC-011l (1)).
 * calculationReady 는 칸마다 한 줄, documentReady 는 병원마다 한 줄이며 NOT_READY 이면 막힌 단계와 코드가 같은 줄에 붙는다.
 */
export function renderReadinessReport(report: ReadinessReport): string {
  const out: string[] = [];
  for (const row of report.platformProfiles) {
    out.push(`platformProfile[${cellLabel(row.cell)}] ${row.status === 'READY' ? `READY bundles=${row.bundleIds.join(',')}` : `NOT_READY code=${row.code}`}`);
  }
  for (const clinic of report.clinics) {
    const { scope, documents } = clinic;
    out.push(`clinic ${clinic.clinicId} (${clinic.slug})`);
    out.push(`  scope: ${scope.status} ${scope.value}${scope.status === 'READY' ? ` bundle=${scope.bundleId}` : ` code=${scope.code}`}`);
    out.push(`  documents: ${documents.status}${documents.status === 'READY' ? ` set=${documents.ruleSetId}/${documents.ruleSetVersion}` : ` ${documents.code} detail=${documents.detail}`}`);
    out.push(`  mappings: ${clinic.mappings.length} rows, ${clinic.mappings.filter((row) => row.status === 'NOT_READY').length} NOT_READY`);
    out.push(...clinic.calculationReady.map(describeCalculation));
    out.push(describeDocumentReady(clinic.documentReady));
  }
  return out.join('\n');
}
