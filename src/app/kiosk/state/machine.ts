import { changeOrientation, toggleLargeText } from './display';
import type { KioskEvent, KioskEventType } from './events';
import { idleResetAt, idleScreenKindOf, nextSchedule } from './idle';
import { beginRefresh, canRetryRefresh, settleRefreshOnEvent } from './refresh';
import { beginRequest, settleOnEvent } from './request';
import { selectTreatmentPage } from './selectors';
import { applyInputs, hasPatientInput, resetSession } from './session-store';
import type { Env, KioskState, OverlayKind, OverlayState, PatientInputs, ResultVariant, ScreenState } from './session-store';
import { STEP_NEXT, STEP_PREV } from './steps';

// 키오스크 상태 기계의 전이 함수 (SPEC-REIMBURSEMENT-001 M5.A, design.md DD-07 전이표, DD-08 무효화, DD-10 무조작, DD-11 복귀 정보, DD-13 이용 완료).
// `reduce(state, event, env)` 는 순수 함수다: 시계와 새 세션 식별자는 `env` 로만 받고 바깥을 읽지 않는다. 사건을 거절하면 같은 상태 참조를 돌려주고,
// 받아들이면 항상 새 객체를 돌려준다(컨트롤러는 참조 비교로 알림 여부를 정한다).
// 사건마다 EVENT_SPECS 에 한 줄이 있다: 종류(PATIENT/SYSTEM), 받는 겹침창, 전이. `Record<KioskEventType, …>` 라서 새 사건을 더하면서 분류를 빠뜨리면 컴파일이 막는다.
// M5.B·C 는 계산 응답·시간 초과·자료 갱신 결말 사건을 `events.ts` 에 더하고 이 표에 SYSTEM 으로 한 줄씩 더한다. 구조를 바꿀 필요가 없다.

export type EventKind = 'PATIENT' | 'SYSTEM';

type EventOf<T extends KioskEventType> = Extract<KioskEvent, { type: T }>;

interface EventSpec<T extends KioskEventType> {
  /** PATIENT 는 받아들이면 마지막 조작 시각을 지금으로 바꾼다. SYSTEM(방향 관찰·시계·페이지 복원, 그리고 서버 응답)은 시계를 건드리지 않는다 (DD-10, AC-015d). */
  readonly kind: EventKind;
  /** 이 사건을 받는 겹침창. 겹침창은 동시에 하나만 열리고, 목록에 없는 겹침창이 열려 있으면 사건은 거절된다 (DD-07). */
  readonly overlays: readonly OverlayKind[];
  /** 전이. 받아들이지 않으면 null (같은 화면에서 쓸 수 없는 사건, 버튼이 없는 동작). */
  apply(state: KioskState, event: EventOf<T>, env: Env): KioskState | null;
}

const CLOSED: OverlayState = { kind: 'NONE' };
const ONLY_CLOSED: readonly OverlayKind[] = ['NONE'];
const EVERY_OVERLAY: readonly OverlayKind[] = ['NONE', 'RESET_CONFIRM', 'TIMEOUT_DIALOG'];

const RESULT_SCREENS: readonly ScreenState[] = ['K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold'];
/** "이용 완료"(통신 오류 화면은 "이용 종료")가 있는 화면. 계산 중과 입력 단계에는 없다. */
const COMPLETABLE_SCREENS: readonly ScreenState[] = [...RESULT_SCREENS, 'K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown', 'KXX_Error_Network'];
const RETURNABLE_SCREENS: readonly ScreenState[] = ['K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown'];
/** 서류·근거 화면으로 가는 결과 화면과 그 복귀 정보. 보류 결과에는 두 버튼이 없다. */
const VARIANT_OF_RESULT: Readonly<Partial<Record<ScreenState, ResultVariant>>> = { K04_Result: 'NORMAL', K04_Result_NotCovered: 'NOT_COVERED' };
const RESULT_OF_VARIANT: Readonly<Record<ResultVariant, ScreenState>> = { NORMAL: 'K04_Result', NOT_COVERED: 'K04_Result_NotCovered' };

const moveTo = (state: KioskState, screen: ScreenState): KioskState => ({ ...state, screen });
const closeOverlay = (state: KioskState): KioskState => ({ ...state, overlay: CLOSED });

/** 입력 단계의 카드 선택: 그 화면에서, options 응답에 있는 카드만 받는다. 값이 같으면 DD-08 대로 파생 데이터를 건드리지 않는다. */
function selectCard(state: KioskState, screen: ScreenState, cards: readonly { readonly code: string }[], code: string, patch: Partial<PatientInputs>): KioskState | null {
  return state.screen === screen && cards.some((card) => card.code === code) ? applyInputs(state, { ...state.inputs, ...patch }) : null;
}

/** 결과 화면에서 근거·서류 화면으로: 저장된 결과가 있을 때만, 복귀 정보에 결과 종류만 기록한다 (DD-11). */
function leaveResult(state: KioskState, screen: ScreenState): KioskState | null {
  const resultVariant = VARIANT_OF_RESULT[state.screen];
  return resultVariant === undefined || state.derived.estimate === null ? null : { ...moveTo(state, screen), derived: { ...state.derived, returnContext: { resultVariant } } };
}

/** 쪽 이동: 보던 쪽에서 `step` 쪽 만큼 옮긴다. 이동할 쪽이 없으면(버튼이 없다) 거절한다. */
function turnPage(state: KioskState, step: 1 | -1): KioskState | null {
  const page = selectTreatmentPage(state);
  if (state.screen !== 'K03_Treatments' || !(step === 1 ? page.hasNext : page.hasPrev)) return null;
  return { ...state, treatmentPageOffset: (page.pageIndex + step) * page.pageSize };
}

// 환자 입력이 하나라도 있으면 확인창을 먼저 띄운다. TimeoutDialog 안에서는 그 자체가 확인 단계라 바로 지운다 (DD-13, plan.md §E #36).
function requestHome(state: KioskState, env: Env): KioskState | null {
  if (idleScreenKindOf(state.screen) === null) return null;
  return state.overlay.kind === 'TIMEOUT_DIALOG' || !hasPatientInput(state.inputs) ? resetSession(state, env, 'K00_Start') : { ...state, overlay: { kind: 'RESET_CONFIRM' } };
}

// 시계 사건: 일정(nextSchedule)이 지금 도래했을 때만 받는다. 경고는 TimeoutDialog 를 열되(ResetConfirm 이 열려 있으면 그것을 대신한다), 이용 완료 화면의 자동 복귀는 초기화한다.
// 초기화 기한이 지난 뒤의 TICK 은 여기 오기 전에 reduce 의 만료 관문이 이미 초기화했다(경고와 초기화 시각이 모두 지났어도 겹침창 없이 한 번에 초기화된다).
// 열릴 때 정한 초기화 시각은 이후 바뀌지 않는다 (DD-07 규칙 4).
function tick(state: KioskState, env: Env): KioskState | null {
  const schedule = nextSchedule(state);
  if (schedule === null || env.now < schedule.at) return null;
  const resetAt = schedule.kind === 'WARN' ? idleResetAt(state) : null;
  return resetAt === null ? resetSession(state, env, 'K00_Start') : { ...state, overlay: { kind: 'TIMEOUT_DIALOG', openedAt: env.now, resetAt } };
}

// 무조작 만료: 사건을 적용하기 전 상태의 초기화 시각이 지났으면 어떤 사건보다 먼저 세션을 지우고 K00_Start 를 연다 (DD-07 규칙 4, DD-10).
// TICK 콜백이 늦어도(타이머 지연·절전) 만료가 TICK 에만 걸려 있지 않다: 환자 조작·계산/갱신 결말·방향 관찰·시계 사건 모두 같은 기한을 본다. 기한 직전(지금 < 초기화 시각)에는 아무것도 달라지지 않는다.
// 활성 요청·갱신은 resetSession 이 CANCELLED 로 풀고, 늦게 온 409·422 는 갱신을 시작하지 못한다(관문이 settleOnEvent 보다 앞이다).
// 방향 관찰(ORIENTATION_CHANGED)은 세션이 아니라 기기의 관찰이라, 그 사건이 만료를 일으켜도 새 세션은 새로 관찰한 방향을 가진다.
function expire(state: KioskState, event: KioskEvent, env: Env): KioskState {
  const fresh = resetSession(state, env, 'K00_Start');
  return event.type === 'ORIENTATION_CHANGED' ? (changeOrientation(fresh, event.orientation) ?? fresh) : fresh;
}

export const EVENT_SPECS: { readonly [T in KioskEventType]: EventSpec<T> } = {
  // 시작과 입력 단계
  // "시작하기"는 새 빈 세션을 연다 (DD-07 "전체 삭제(빈 세션 생성)", AC-012a). 새 sessionId·빈 선택·빈 파생 데이터를 만들되(남은 요청·갱신이 있으면 resetSession 이 먼저 취소한다)
  // 표시 설정(큰 글자 보기·관찰한 화면 방향)은 유지한다: 시작은 초기화 경로가 아니다 [문서에 없음, 소유자 확인 필요: 큰 글자가 다음 환자에게 이어질 수 있는 곳은 K00 에서 켠 경우뿐이다].
  START: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    apply: (state, _event, env) => (state.screen === 'K00_Start' ? { ...resetSession(state, env, 'K00_Start'), screen: 'K01_Generation', display: state.display } : null),
  },
  SELECT_GENERATION: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    apply: (state, event) => selectCard(state, 'K01_Generation', state.clinic.options.generations, event.code, { generation: event.code }),
  },
  SELECT_INSURER_TYPE: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    apply: (state, event) => selectCard(state, 'K02_Type', state.clinic.options.insurerTypes, event.code, { insurerType: event.code }),
  },
  SELECT_CAUSE: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    apply: (state, event) => selectCard(state, 'K02b_Cause', state.clinic.options.causes, event.code, { cause: event.code }),
  },
  TOGGLE_TREATMENT: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    // 치료는 집합이다: 이미 고른 치료를 다시 누르면 해제되고 수량은 없다 (AC-012e).
    apply: (state, event) => {
      if (state.screen !== 'K03_Treatments' || !state.clinic.catalog.treatments.some((treatment) => treatment.treatmentId === event.treatmentId)) return null;
      const ids = state.inputs.treatmentIds;
      return applyInputs(state, { ...state.inputs, treatmentIds: ids.includes(event.treatmentId) ? ids.filter((id) => id !== event.treatmentId) : [...ids, event.treatmentId] });
    },
  },
  NEXT: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    apply: (state) => {
      const step = STEP_NEXT[state.screen];
      return step?.ready(state.inputs) ? moveTo(state, step.to) : null;
    },
  },
  PREV: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    apply: (state) => {
      const to = STEP_PREV[state.screen];
      return to === undefined ? null : moveTo(state, to);
    },
  },
  TREATMENTS_NEXT_PAGE: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state) => turnPage(state, 1) },
  TREATMENTS_PREV_PAGE: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state) => turnPage(state, -1) },
  OPEN_GENERATION_HELP: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state) => (state.screen === 'K01_Generation' ? moveTo(state, 'K01_Generation_Unknown') : null) },
  CLOSE_GENERATION_HELP: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state) => (state.screen === 'K01_Generation_Unknown' ? moveTo(state, 'K01_Generation') : null) },

  // 결과·근거·서류
  OPEN_DOCUMENTS: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    apply: (state) => (state.inputs.cause === null ? null : leaveResult(state, state.inputs.cause === 'UNKNOWN' ? 'K07_Documents_Unknown' : 'K07_Documents')),
  },
  OPEN_BASIS: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state) => leaveResult(state, 'K04_Basis_Calculation') },
  RETURN_TO_RESULT: {
    kind: 'PATIENT',
    overlays: ONLY_CLOSED,
    apply: (state) => (RETURNABLE_SCREENS.includes(state.screen) && state.derived.returnContext !== null ? moveTo(state, RESULT_OF_VARIANT[state.derived.returnContext.resultVariant]) : null),
  },
  RESELECT_TREATMENTS: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state) => (RESULT_SCREENS.includes(state.screen) ? moveTo(state, 'K03_Treatments') : null) },
  EDIT_INSURANCE: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state) => (RESULT_SCREENS.includes(state.screen) ? moveTo(state, 'K01_Generation') : null) },

  // 계산 요청 (M5.B). 시작은 환자의 조작이다. 결말(응답·오류·시간 초과)은 SYSTEM 이라 무조작 시간을 다시 세지 않고 어느 겹침창 위에서도 곧바로 밑 화면에 반영된다 (DD-07 "겹침창이 열려 있는 동안 도착하는 요청 결말" 규칙 1·4).
  // 결말의 정리와 화면 전이는 request.ts 의 settleRequest 한 곳에서 하고 여기서는 부르기만 한다.
  REQUEST_ESTIMATE: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state, _event, env) => beginRequest(state, env) },
  ESTIMATE_RESPONDED: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleOnEvent },
  ESTIMATE_FAILED: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleOnEvent },
  ESTIMATE_EXPIRED: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleOnEvent },

  // 자료 갱신 (M5.C). 인라인 "다시 시도"는 환자의 조작이라 무조작 시간을 다시 센다. 결말은 SYSTEM 이라 다시 세지 않고 어느 겹침창 위에서도 곧바로 밑 화면에 반영된다 (DD-07 표 2).
  // 결말의 정리와 반영은 refresh.ts 의 settleRefresh 한 곳에서 하고 여기서는 부르기만 한다.
  RETRY_REFRESH: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state, _event, env) => (canRetryRefresh(state) ? beginRefresh(state, env, 'RETRY') : null) },
  REFRESH_RESOLVED: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleRefreshOnEvent },
  REFRESH_FAILED: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleRefreshOnEvent },
  REFRESH_EXPIRED: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleRefreshOnEvent },

  // 처음으로·겹침창·이용 완료
  REQUEST_HOME: { kind: 'PATIENT', overlays: ['NONE', 'TIMEOUT_DIALOG'], apply: (state, _event, env) => requestHome(state, env) },
  CONFIRM_RESET: { kind: 'PATIENT', overlays: ['RESET_CONFIRM'], apply: (state, _event, env) => resetSession(state, env, 'K00_Start') },
  CANCEL_RESET: { kind: 'PATIENT', overlays: ['RESET_CONFIRM'], apply: closeOverlay },
  CONTINUE_USING: { kind: 'PATIENT', overlays: ['TIMEOUT_DIALOG'], apply: closeOverlay },
  // 먼저 전체 삭제, 그다음 K06_Complete (DD-13): 화면이 그려질 때 이미 세션이 비어 있다.
  COMPLETE_USE: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state, _event, env) => (COMPLETABLE_SCREENS.includes(state.screen) ? resetSession(state, env, 'K06_Complete') : null) },
  BACK_TO_START: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: (state, _event, env) => (state.screen === 'K06_Complete' ? resetSession(state, env, 'K00_Start') : null) },

  // 표시 설정과 일반 조작
  TOGGLE_LARGE_TEXT: { kind: 'PATIENT', overlays: ONLY_CLOSED, apply: toggleLargeText },
  // 화면에 닿은 일반 터치(버튼이 아닌 곳). ResetConfirm 이 열려 있어도 시간을 다시 센다 (DD-07 겹침창 규칙, AC-015k). TimeoutDialog 는 "계속 사용할게요"로만 시간을 다시 센다.
  INTERACTION: { kind: 'PATIENT', overlays: ['NONE', 'RESET_CONFIRM'], apply: (state) => (idleScreenKindOf(state.screen) === null ? null : state) },

  // 시스템
  ORIENTATION_CHANGED: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: (state, event) => changeOrientation(state, event.orientation) },
  PAGE_RESTORED: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: (state, _event, env) => resetSession(state, env, 'K00_Start') },
  TICK: { kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: (state, _event, env) => tick(state, env) },
};

// @MX:ANCHOR: [AUTO] 모든 화면 사건이 상태를 바꾸는 유일한 입구. 컨트롤러·시험·화면이 모두 이 함수를 거친다.
// @MX:REASON: 겹침창 허용 목록과 마지막 조작 시각 갱신이 여기 한 곳에서만 적용되어야 환자 사건과 시스템 사건의 구분(AC-015d)이 사건마다 흩어지지 않는다.
/**
 * 사건 하나를 적용한다. 거절하면 같은 `state` 참조를, 받아들이면 새 상태를 돌려준다. PATIENT 사건은 받아들이는 순간 마지막 조작 시각을 `env.now` 로 바꾼다.
 * 단 초기화 기한이 이미 지났으면(`env.now >= idleResetAt(state)`) 사건의 종류와 겹침창에 상관없이 먼저 만료 초기화한다.
 */
export function reduce(state: KioskState, event: KioskEvent, env: Env): KioskState {
  const resetAt = idleResetAt(state);
  if (resetAt !== null && env.now >= resetAt) return expire(state, event, env);
  // 사건 종류별 분류표를 합집합 사건 하나로 부르기 위한 좁힘이다. EventSpec.apply 는 메서드라 매개변수를 느슨하게 비교한다.
  const spec = EVENT_SPECS[event.type] as EventSpec<KioskEventType>;
  if (!spec.overlays.includes(state.overlay.kind)) return state;
  const next = spec.apply(state, event, env);
  if (next === null) return state;
  return spec.kind === 'PATIENT' ? { ...next, lastInteractionAt: env.now } : next;
}
