import { checkProfileStructure } from './profile-structure';
import { decideLine, profileHasGroup, resolveMapping, resolveProfile } from './resolve';
import type { Cell, LineDecision } from './resolve';
import { bundleHoldCode, isBundleUsable, isUsable } from './usability';
import type { UsabilityContext } from './usability';
import { compareCodePoints, validateEstimateInput } from './validate';
import type { ValidatedInput } from './validate';
import type { CheckedResult } from './numeric';
import type { EngineRejection, EstimateInput, HoldReasonCode, Origin, StandardAssumptionProfile } from './types';

// estimate() 의 앞단 (design.md DD-04 호출 순서 1~6):
// 입력 검증 → 묶음 선행 판정 → 프로필 칸 조회·사용 가능·구조 → 줄마다(줄 출처 → 분류 → 매핑 조회 → groupKey).
// 산술(그룹 값 검사, 공제, 한도, 상태 합성, 출력 조립)은 M1.3 이 이 결과에 이어서 같은 파일에 붙인다.
// 이 앞단은 금액을 계산하지 않는다. 병원 결제액 T 는 입력 검증이 구한 검사 합산 값을 그대로 싣는다.

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
   * 줄 단위까지의 보류가 있는지(blocked 이거나 ON_HOLD 줄이 있음). true 이면 예상 보험금과 수령 후 부담은 null 이 된다.
   * 그룹 단위 보류(값 무효·계산 범위 초과·지원 밖 공식)는 M1.3 의 그룹 값 검사가 더하므로 여기에 포함되지 않는다.
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
