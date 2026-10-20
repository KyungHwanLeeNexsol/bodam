import type { IdlePolicyDto, IdleScreenKind, IdleThresholdDto } from './api-types';
import type { KioskState, ScreenState } from './session-store';

// 무조작 정책: 병원별 임계값의 읽기와 다음 일정의 계산 (SPEC-REIMBURSEMENT-001 M5.A, design.md DD-10·DD-13·DD-19, AC-015).
// 이 모듈은 순수 함수만 둔다. 타이머를 거는 일은 controller.ts 가 하고, 이 모듈의 nextSchedule 이 "다음에 언제 무슨 일이 일어나야 하는가"를 상태에서 읽어 준다.
// 그래서 일정은 상태의 함수다: 환자 조작(마지막 조작 시각)·화면 종류·겹침창이 바뀌면 일정이 저절로 따라가고, 서버 응답이나 화면 종류의 변화만으로는
// 마지막 조작 시각이 움직이지 않는다(경과 시간은 마지막 환자 조작부터 계속 세고 임계값만 새 화면 종류의 값으로 바뀐다, DD-07 규칙 4).

export const IDLE_SCREEN_KINDS: readonly IdleScreenKind[] = ['INPUT', 'RESULT', 'BASIS_AND_DOCUMENTS', 'HOLD_RESULT', 'NOTICE_PROGRESS_ERROR'];

// @MX:NOTE: [AUTO] DD-10 표의 기본값(초)을 키오스크 쪽에도 둔다: 응답이 화면 종류를 빠뜨리거나 정책이 없을 때 쓴다. 서버의 같은 표(src/server/idle-policy.ts)를 가져오지
// 않는 것은 키오스크가 서버 모듈에 닿지 않게 하려는 것이며, 두 표가 같다는 사실은 tests/kiosk/state/idle-policy.test.ts 가 값으로 대조한다.
export const DEFAULT_IDLE_THRESHOLDS: Readonly<Record<IdleScreenKind, IdleThresholdDto>> = {
  INPUT: { warnSeconds: 100, resetSeconds: 120 },
  RESULT: { warnSeconds: 160, resetSeconds: 180 },
  BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 },
  HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 },
  NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 },
};

/** 읽은 정책: 다섯 화면 종류가 항상 모두 있다. `completionHoldSeconds` 는 양의 정수이거나 null(자동 복귀 없음)이다. */
export interface ResolvedIdlePolicy {
  readonly screens: Readonly<Record<IdleScreenKind, IdleThresholdDto>>;
  readonly completionHoldSeconds: number | null;
}

/** 서버의 저장 검증(0 이상, 초기화 > 경고)과 같은 기준으로 읽을 수 있는 값인가. 응답이 틀린 값을 주어도 키오스크가 이상한 임계값으로 동작하지 않게 한다. */
function isReadableThreshold(value: unknown): value is IdleThresholdDto {
  if (typeof value !== 'object' || value === null) return false;
  const { warnSeconds, resetSeconds } = value as Record<string, unknown>;
  return (
    typeof warnSeconds === 'number' && typeof resetSeconds === 'number' && Number.isFinite(warnSeconds) && Number.isFinite(resetSeconds) && warnSeconds >= 0 && resetSeconds > warnSeconds
  );
}

// @MX:NOTE: [AUTO] completionHoldSeconds 가 null 이면 자동 복귀가 없다(DD-13). 클라이언트는 null 을 어떤 값(예: 10초)으로도 바꿔 쓰지 않는다. plan.md §E #12 의 10초는 서버 쪽 기본값
// 논의이며, 병원이 값을 저장했을 때만 응답에 들어와 이 함수가 그대로 읽는다.
/**
 * catalog 응답의 `idlePolicy` 를 키오스크가 쓰는 정책으로 읽는다(DD-19). 응답에 담긴 화면 종류는 응답 값을, 빠졌거나 읽을 수 없는 화면 종류는 DD-10 표의 값을 쓴다.
 * 정책이 없으면(undefined) 표의 값이다. 돌려주는 값은 응답 객체와 별개의 사본이다.
 */
export function resolveIdlePolicy(policy: IdlePolicyDto | undefined): ResolvedIdlePolicy {
  const screens = {} as Record<IdleScreenKind, IdleThresholdDto>;
  for (const kind of IDLE_SCREEN_KINDS) {
    const given: unknown = policy?.screens?.[kind];
    const source = isReadableThreshold(given) ? given : DEFAULT_IDLE_THRESHOLDS[kind];
    screens[kind] = { warnSeconds: source.warnSeconds, resetSeconds: source.resetSeconds };
  }
  const hold: unknown = policy?.completionHoldSeconds;
  return { screens, completionHoldSeconds: typeof hold === 'number' && Number.isSafeInteger(hold) && hold >= 1 ? hold : null };
}

/** 화면 → 무조작 정책의 화면 종류 (DD-10 표의 행). `K00_Start`·`K06_Complete` 는 지울 환자 데이터가 없어 타이머가 없다. */
const SCREEN_IDLE_KIND: Readonly<Record<ScreenState, IdleScreenKind | null>> = {
  K00_Start: null,
  K01_Generation: 'INPUT',
  K01_Generation_Unknown: 'NOTICE_PROGRESS_ERROR',
  K02_Type: 'INPUT',
  K02b_Cause: 'INPUT',
  K03_Treatments: 'INPUT',
  Calculating: 'NOTICE_PROGRESS_ERROR',
  K04_Result: 'RESULT',
  K04_Result_NotCovered: 'RESULT',
  K04_Result_Hold: 'HOLD_RESULT',
  KXX_Error_Network: 'NOTICE_PROGRESS_ERROR',
  K04_Basis_Calculation: 'BASIS_AND_DOCUMENTS',
  K07_Documents: 'BASIS_AND_DOCUMENTS',
  K07_Documents_Unknown: 'BASIS_AND_DOCUMENTS',
  K06_Complete: null,
};

export function idleScreenKindOf(screen: ScreenState): IdleScreenKind | null {
  return SCREEN_IDLE_KIND[screen];
}

/** 상태 기계가 다음에 해야 할 일. `at` 은 deps.now() 기준 밀리초다. */
export type Schedule =
  | { readonly kind: 'WARN'; readonly at: number }
  | { readonly kind: 'RESET'; readonly at: number }
  | { readonly kind: 'COMPLETION_RETURN'; readonly at: number };

/** 마지막 환자 조작에서 센 현재 화면 종류의 경고·초기화 시각. 무조작 타이머가 없는 화면(K00_Start·K06_Complete)이면 null. */
export function idleDeadlines(state: KioskState): { readonly warnAt: number; readonly resetAt: number } | null {
  const kind = idleScreenKindOf(state.screen);
  if (kind === null) return null;
  const threshold = state.clinic.idle.screens[kind];
  return { warnAt: state.lastInteractionAt + threshold.warnSeconds * 1000, resetAt: state.lastInteractionAt + threshold.resetSeconds * 1000 };
}

// @MX:ANCHOR: [AUTO] 모든 타이머 일정(경고·초기화·이용 완료 자동 복귀)의 단일 출처. 컨트롤러의 타이머 칸 하나가 이 함수의 값만 따라간다.
// @MX:REASON: 일정이 상태 밖에서 따로 계산되면 환자 조작·화면 종류 변화·겹침창과 어긋난다. DD-10 의 모든 규칙(마지막 환자 조작에서 세기, 화면 종류가 바뀌어도 경과 유지,
// 열린 TimeoutDialog 의 초기화 시각 고정, ResetConfirm 이 초기화를 늦추지 않음)이 여기 한 곳에 있다.
/**
 * 상태에서 다음 일정을 읽는다.
 *  - `K00_Start`: 없음. `K06_Complete`: `completionHoldSeconds` 가 양의 정수면 세션이 열린 시각 + 그 값, null 이면 없음(자동 복귀 없음).
 *  - TimeoutDialog 가 열려 있으면 열릴 때 정해 둔 초기화 시각(화면 종류나 마지막 조작이 바뀌어도 움직이지 않는다).
 *  - 그 밖(겹침창 없음, 또는 ResetConfirm: 그 시간이 초기화를 늦추지 않는다)에는 마지막 환자 조작 + 현재 화면 종류의 경고 시간이다.
 */
export function nextSchedule(state: KioskState): Schedule | null {
  if (state.screen === 'K06_Complete') {
    const hold = state.clinic.idle.completionHoldSeconds;
    return hold === null ? null : { kind: 'COMPLETION_RETURN', at: state.sessionStartedAt + hold * 1000 };
  }
  const deadlines = idleDeadlines(state);
  if (deadlines === null) return null;
  return state.overlay.kind === 'TIMEOUT_DIALOG' ? { kind: 'RESET', at: state.overlay.resetAt } : { kind: 'WARN', at: deadlines.warnAt };
}

export interface TimeoutDialogView {
  readonly openedAt: number;
  readonly resetAt: number;
  /** 초기화까지 남은 시간(밀리초, 0 아래로 내려가지 않는다). 화면이 남은 시간을 그릴 때 읽는다. */
  readonly remainingMs: number;
}

/** 열려 있는 TimeoutDialog 의 표시용 값. 열려 있지 않으면 null. `nowMs` 는 deps.now() 와 같은 기준이다. */
export function selectTimeoutDialog(state: KioskState, nowMs: number): TimeoutDialogView | null {
  const overlay = state.overlay;
  return overlay.kind === 'TIMEOUT_DIALOG' ? { openedAt: overlay.openedAt, resetAt: overlay.resetAt, remainingMs: Math.max(0, overlay.resetAt - nowMs) } : null;
}
