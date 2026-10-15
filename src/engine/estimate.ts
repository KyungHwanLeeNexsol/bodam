import { computeNominalDeduction, appliedDeduction } from './deduction';
import { checkGroupValues } from './group-values';
import { allocatePool, groupPayout, isRemainingLimitAssumed, limitAmount } from './limit';
import { checkProfileStructure } from './profile-structure';
import { decideLine, profileHasGroup, resolveMapping, resolveProfile } from './resolve';
import type { Cell, LineDecision } from './resolve';
import { sumGroupShares } from './sum';
import { bundleHoldCode, isBundleUsable, isUsable } from './usability';
import type { UsabilityContext } from './usability';
import { compareCodePoints, validateEstimateInput } from './validate';
import type { ValidatedInput } from './validate';
import type { CheckedResult } from './numeric';
import type {
  AssumptionCode,
  CoverageGroupDef,
  EngineRejection,
  EstimateInput,
  EstimateResult,
  FailedStepName,
  FormulaStep,
  GroupResult,
  HoldReasonCode,
  LineResult,
  OverallState,
  Origin,
  StandardAssumptionProfile,
  Won,
} from './types';

// estimate(): 입력 검증 → 묶음 선행 판정 → 프로필 → 줄 판정(앞단, DD-04 호출 순서 1~6) → 그룹 값 검사 →
// 그룹 산술(공제, 한도, 공유 한도) → 상태 합성과 출력 조립 (DD-04 호출 순서 7~8, DD-03 출력, DD-24).
// 결과의 금액은 모두 정수 원이다. 거절된 입력은 0원 결과를 만들지 않고, 보류 결과는 보험금 숫자를 싣지 않는다.

/** 시험이 호출 순서와 횟수를 감시할 수 있도록 바꿔 끼울 수 있는 함수들. 기본값은 이 패키지의 실제 함수다. */
export interface FrontFunctions {
  isBundleUsable: typeof isBundleUsable;
  resolveProfile: typeof resolveProfile;
  isUsable: typeof isUsable;
  checkProfileStructure: typeof checkProfileStructure;
  resolveMapping: typeof resolveMapping;
}

export interface FrontDeps {
  /** 내용 해시 함수 (주입). 엔진은 해시 구현을 가져오지 않는다 (DD-04). */
  digest: (content: unknown) => string;
  /** 병원 결제액 T 의 검사 합산 함수. 기본값 sumLineAmounts. 넘침 경계를 시험 대역으로 일으킬 때 쓴다. */
  sum?: (amounts: readonly number[]) => CheckedResult;
  functions?: Partial<FrontFunctions>;
}

export interface EstimateFront {
  /** 중복 제거·정렬을 마친 입력과 예상 병원 결제액 T. 보류여도 T 는 숫자다. */
  validated: ValidatedInput;
  /** 묶음 단계나 프로필 단계에서 모든 줄이 막혔으면 그 보류 코드, 아니면 null. */
  blocked: HoldReasonCode | null;
  /** 사용 가능으로 확정된 프로필. blocked 가 있으면 null. */
  profile: StandardAssumptionProfile | null;
  /** 치료 줄과 공통 기본비용 줄의 판정. treatmentId 의 유니코드 코드 포인트 오름차순. */
  lines: LineDecision[];
  /**
   * 줄 단위까지의 보류가 있는지(blocked 이거나 ON_HOLD 줄이 있음).
   * 그룹 단위 보류(값 무효·계산 범위 초과·지원 밖 공식)는 estimate() 의 그룹 단계가 더하므로 여기에 포함되지 않는다.
   */
  hasHold: boolean;
}

export type EstimateFrontResult = { ok: true; front: EstimateFront } | { ok: false; rejection: EngineRejection };

function asOrigins(value: unknown): readonly Origin[] {
  return Array.isArray(value) ? (value as Origin[]) : [];
}

// @MX:ANCHOR: [AUTO] estimate() 앞단. 서버 계산 경로(M4)와 키오스크 미리보기(M6)가 같은 엔진 모듈로 이 판정을 거친다.
// @MX:REASON: 거절 → 묶음 → 프로필 → 줄 순서와 "묶음 중지·범위 없음이면 항목 판정을 한 번도 부르지 않는다"는 약속이 깨지면 보류 코드가 어긋난다(DD-04).
/**
 * 입력을 검증하고 묶음·프로필·줄을 판정한다. 기대되는 입력 결함은 던지지 않고 거절 결과로 돌려준다.
 * 묶음이 없거나 중지이면 항목 판정(isUsable)·프로필 칸 조회·구조 검사·매핑 조회를 한 번도 부르지 않는다.
 */
export function estimateFront(input: EstimateInput, deps: FrontDeps): EstimateFrontResult {
  const fns: FrontFunctions = {
    isBundleUsable,
    resolveProfile,
    isUsable,
    checkProfileStructure,
    resolveMapping,
    ...deps.functions,
  };

  const validation = validateEstimateInput(input, deps.sum);
  if (!validation.ok) {
    return { ok: false, rejection: validation.rejection };
  }
  const validated = validation.value;
  const allLines = [...validated.lines, ...validated.baseFeeLines].sort((a, b) =>
    compareCodePoints(a.treatmentId, b.treatmentId),
  );

  const blockAll = (code: HoldReasonCode): EstimateFrontResult => ({
    ok: true,
    front: {
      validated,
      blocked: code,
      profile: null,
      lines: allLines.map((line) => ({ line, state: 'ON_HOLD', holdReason: code })),
      hasHold: true,
    },
  });

  const gate = fns.isBundleUsable(input.bundle);
  if (!gate.usable) {
    return blockAll(bundleHoldCode(gate.reason));
  }

  const cell: Cell = { generation: validated.generation, insurerType: input.insurerType };
  const ctx: UsabilityContext = {
    at: input.at,
    acceptedOrigins: asOrigins(input.acceptedOrigins?.rules),
    digest: deps.digest,
  };

  const resolution = fns.resolveProfile(gate.bundle, cell, ctx, {
    isUsable: fns.isUsable,
    checkProfileStructure: fns.checkProfileStructure,
  });
  if (!resolution.resolved) {
    return blockAll(resolution.code);
  }

  const acceptedLineOrigins = asOrigins(input.acceptedOrigins?.lines);
  const decisions = allLines.map((line) =>
    decideLine(
      { line, bundle: gate.bundle, profile: resolution.profile, cell, ctx, acceptedLineOrigins },
      {
        resolveMapping: (target, bundle, targetCell, targetCtx) =>
          fns.resolveMapping(target, bundle, targetCell, targetCtx, { isUsable: fns.isUsable }),
        lookupGroup: profileHasGroup,
      },
    ),
  );

  return {
    ok: true,
    front: {
      validated,
      blocked: null,
      profile: resolution.profile,
      lines: decisions,
      hasHold: decisions.some((decision) => decision.state === 'ON_HOLD'),
    },
  };
}

// ───────────────────────── 그룹 산술 ─────────────────────────

/** 그룹 계산 중간 결과. 풀 배분 뒤에 GroupResult 와 FormulaStep 으로 마무리한다. */
interface GroupWork {
  def: CoverageGroupDef;
  result: GroupResult;
  /** 그룹이 속한 풀의 키. 없으면 undefined. */
  poolKey: string | undefined;
  /** 그룹 한도 또는 적용되는 풀 한도가 PER_ACCIDENT·ANNUAL·COUNT 인지. */
  limitAssumed: boolean;
  failedStep?: FailedStepName;
}

function holdWork(
  def: CoverageGroupDef,
  shares: { G: Won; N: Won; E: Won },
  holdReason: HoldReasonCode,
  failedStep?: FailedStepName,
): GroupWork {
  return {
    def,
    poolKey: def.sharedLimitPoolKey,
    limitAssumed: false,
    ...(failedStep === undefined ? {} : { failedStep }),
    result: {
      groupKey: def.groupKey,
      state: 'ON_HOLD',
      ...shares,
      D: null,
      D_applied: null,
      L: null,
      P: null,
      P_pooled: null,
      holdReason,
      ...(def.sharedLimitPoolKey === undefined ? {} : { sharedLimitPoolKey: def.sharedLimitPoolKey }),
      trace: [],
    },
  };
}

function computeGroup(
  def: CoverageGroupDef,
  members: readonly LineDecision[],
  profile: StandardAssumptionProfile,
): GroupWork {
  const shares = sumGroupShares(members.map((member) => member.line));

  // 저장 자료의 값 결함이 먼저다. 값을 고치거나 0·기본값으로 대신하지 않고 그 그룹만 보류한다.
  const valueCode = checkGroupValues(def, profile);
  if (valueCode !== null) {
    return holdWork(def, shares, valueCode);
  }

  const deduction = computeNominalDeduction(def.deduction, shares);
  if (!deduction.ok) {
    return holdWork(def, shares, 'CALC_RANGE_EXCEEDED', deduction.step);
  }

  const L = limitAmount(def.limit);
  const P = groupPayout(shares.E, deduction.D, L);
  const pool = def.sharedLimitPoolKey === undefined
    ? undefined
    : profile.sharedLimitPools.find((candidate) => candidate.poolKey === def.sharedLimitPoolKey);
  return {
    def,
    poolKey: def.sharedLimitPoolKey,
    limitAssumed: isRemainingLimitAssumed(def.limit) || (pool !== undefined && isRemainingLimitAssumed(pool.limit)),
    result: {
      groupKey: def.groupKey,
      state: 'ESTIMATED',
      ...shares,
      D: deduction.D,
      D_applied: appliedDeduction(deduction.D, shares.E),
      L,
      P,
      // 풀이 없는 그룹은 P_pooled = P. 풀이 있는 그룹은 아래 풀 배분이 정한다.
      P_pooled: def.sharedLimitPoolKey === undefined ? P : null,
      ...(def.sharedLimitPoolKey === undefined ? {} : { sharedLimitPoolKey: def.sharedLimitPoolKey }),
      trace: [],
    },
  };
}

/**
 * 공유 한도 풀 배분. 풀마다 멤버 그룹을 groupOrder 순서로 돌며 남은 한도에서 채운다.
 * 멤버 가운데 보류 그룹이 하나라도 있으면 그 지급액을 알 수 없으므로 나머지 멤버의 P_pooled 는 null 로 둔다.
 */
function allocatePools(works: GroupWork[], profile: StandardAssumptionProfile): void {
  for (const pool of profile.sharedLimitPools) {
    const members = works.filter((work) => work.poolKey === pool.poolKey);
    if (members.length === 0) continue;
    if (members.some((member) => member.result.state === 'ON_HOLD')) continue; // P_pooled 는 null 로 남는다
    const pooled = allocatePool(
      members.map((member) => member.result.P as Won),
      limitAmount(pool.limit),
    );
    members.forEach((member, index) => {
      member.result.P_pooled = pooled[index] as Won;
    });
  }
}

function toFormulaStep(work: GroupWork): FormulaStep {
  const { result } = work;
  return {
    groupKey: result.groupKey,
    E: result.E,
    D: result.D,
    D_applied: result.D_applied,
    L: result.L,
    P: result.P,
    P_pooled: result.P_pooled,
    ...(work.poolKey === undefined ? {} : { poolKey: work.poolKey }),
    ...(work.failedStep === undefined ? {} : { failedStep: work.failedStep }),
  };
}

/** 프로필의 groupOrder 순서로, 사용 가능한 줄이 하나라도 있는 그룹만 계산한다. */
function computeGroups(profile: StandardAssumptionProfile, decisions: readonly LineDecision[]): GroupWork[] {
  const byGroup = new Map<string, LineDecision[]>();
  for (const decision of decisions) {
    if (decision.state === 'ESTIMATED' && decision.groupKey !== undefined) {
      byGroup.set(decision.groupKey, [...(byGroup.get(decision.groupKey) ?? []), decision]);
    }
  }

  const works: GroupWork[] = [];
  for (const groupKey of profile.groupOrder) {
    const members = byGroup.get(groupKey);
    const def = profile.groups.find((candidate) => candidate.groupKey === groupKey);
    if (members !== undefined && def !== undefined) {
      works.push(computeGroup(def, members, profile));
    }
  }
  allocatePools(works, profile);
  for (const work of works) {
    work.result.trace = [toFormulaStep(work)];
  }
  return works;
}

// ───────────────────────── 출력 조립 ─────────────────────────

function toLineResult(decision: LineDecision, groupHolds: ReadonlyMap<string, HoldReasonCode>): LineResult {
  const { line } = decision;
  const base = {
    treatmentId: line.treatmentId,
    displayName: line.displayName,
    benefitType: line.benefitType,
    patientAmount: line.patientAmount,
    isBaseFee: line.isBaseFee,
    origin: line.origin,
  };
  if (decision.state === 'ESTIMATED') {
    const groupKey = decision.groupKey as string;
    const groupHold = groupHolds.get(groupKey);
    // 그룹 단위 보류이면 그 그룹의 줄은 보류 줄이 되어 어느 그룹에도 속하지 않는다(groupKey 없음).
    return groupHold === undefined
      ? { ...base, state: 'ESTIMATED', groupKey }
      : { ...base, state: 'ON_HOLD', holdReason: groupHold };
  }
  if (decision.state === 'EXCLUDED_CONFIRMED') {
    return { ...base, state: 'EXCLUDED_CONFIRMED', exclusionReason: decision.exclusionReason as string };
  }
  return { ...base, state: 'ON_HOLD', holdReason: decision.holdReason as HoldReasonCode };
}

function composeAssumptions(
  overallHold: boolean,
  lines: readonly LineResult[],
  works: readonly GroupWork[],
): AssumptionCode[] {
  const assumptions: AssumptionCode[] = [];
  if (!overallHold) {
    assumptions.push('STANDARD_PROFILE_APPLIED');
    const hasExcluded = lines.some((line) => line.state === 'EXCLUDED_CONFIRMED');
    if (!hasExcluded) {
      assumptions.push('ALL_COVERED_AND_LIMIT_REMAINS');
    } else if (lines.some((line) => line.state === 'ESTIMATED')) {
      assumptions.push('REMAINING_COVERED_AND_LIMIT_REMAINS');
    }
    if (works.some((work) => work.limitAssumed)) {
      assumptions.push('REMAINING_LIMIT_ASSUMED');
    }
  }
  assumptions.push('PERSONAL_CONTRACT_NOT_CONFIRMED');
  return assumptions;
}

function assembleResult(input: EstimateInput, front: EstimateFront): EstimateResult {
  const { validated, profile } = front;
  const works = profile === null ? [] : computeGroups(profile, front.lines);
  const groupHolds = new Map<string, HoldReasonCode>();
  for (const work of works) {
    if (work.result.state === 'ON_HOLD') {
      groupHolds.set(work.result.groupKey, work.result.holdReason as HoldReasonCode);
    }
  }

  const lines = front.lines.map((decision) => toLineResult(decision, groupHolds));
  const overallHold = lines.some((line) => line.state === 'ON_HOLD');
  const groups = works.map((work) => work.result);

  let state: OverallState = 'ESTIMATED';
  if (overallHold) {
    state = 'ON_HOLD';
  } else if (lines.some((line) => line.state === 'EXCLUDED_CONFIRMED')) {
    state = 'ESTIMATED_WITH_EXCLUSIONS';
  }

  // 보류가 없으면 보험금 = Σ P_pooled (정수 덧셈, 각 값이 T 이하라 넘치지 않는다). 보류이면 두 값 모두 null 이다.
  let expectedInsurancePayout: Won | null = null;
  let expectedOutOfPocketAfterPayout: Won | null = null;
  if (!overallHold) {
    expectedInsurancePayout = groups.reduce((sum, entry) => sum + (entry.P_pooled as Won), 0);
    expectedOutOfPocketAfterPayout = validated.hospitalPayment - expectedInsurancePayout;
  }

  return {
    state,
    amounts: {
      hospitalPayment: validated.hospitalPayment,
      baseFeeIncluded: validated.baseFeeLines.length > 0 ? 'INCLUDED' : 'NOT_REGISTERED',
      expectedInsurancePayout,
      expectedOutOfPocketAfterPayout,
    },
    lines,
    groups,
    // 참고 그룹: 전체가 ON_HOLD 일 때만, 보류 그룹과 한도를 공유하지 않는 ESTIMATED 그룹만. 보류 줄은 어느 그룹에도 없다.
    referenceGroups: overallHold
      ? groups
          .filter((entry) => entry.state === 'ESTIMATED' && entry.P_pooled !== null)
          .map((entry) => ({ groupKey: entry.groupKey, P: entry.P_pooled as Won, isReference: true as const }))
      : [],
    assumptions: composeAssumptions(overallHold, lines, works),
    holdReasons: lines
      .filter((line) => line.state === 'ON_HOLD')
      .map((line) => ({ treatmentId: line.treatmentId, code: line.holdReason as HoldReasonCode })),
    excludedItems: lines
      .filter((line) => line.state === 'EXCLUDED_CONFIRMED')
      .map((line) => ({
        treatmentId: line.treatmentId,
        amount: line.patientAmount,
        reason: line.exclusionReason as string,
        payout: 0 as const,
      })),
    basis: {
      ruleBundleId: input.bundle === null ? null : input.bundle.id,
      profile:
        profile === null
          ? null
          : {
              id: profile.id,
              version: profile.version,
              origin: profile.origin,
              policySources: profile.policySources,
            },
      steps: groups.flatMap((entry) => entry.trace),
    },
  };
}

export type EstimateOutcome = { ok: true; result: EstimateResult } | { ok: false; rejection: EngineRejection };

// @MX:ANCHOR: [AUTO] 계산의 단일 진입점. 서버 재계산(M4)과 키오스크 미리보기(M6)가 같은 엔진 모듈로 이 함수를 부른다.
// @MX:REASON: 서버와 클라이언트가 같은 코드를 쓴다는 약속(REQ-ENG-001)과 "거절은 0원 결과가 아니다", "보류는 보험금 숫자를 싣지 않는다"는 불변 조건이 모두 여기서 지켜진다.
/**
 * 모든 입력은 거절(rejection) 또는 결과(result) 중 하나가 된다. 치료 원인 인자는 받지 않는다(DD-01).
 * 같은 입력이면 배열 순서와 관계없이 같은 결과를 낸다.
 */
export function estimate(input: EstimateInput, deps: FrontDeps): EstimateOutcome {
  const front = estimateFront(input, deps);
  if (!front.ok) {
    return front;
  }
  return { ok: true, result: assembleResult(input, front.front) };
}
