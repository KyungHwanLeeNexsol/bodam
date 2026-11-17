import { describe, expect, it } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { idleResetAt } from '../../../src/app/kiosk/state/idle';
import { EVENT_SPECS, reduce } from '../../../src/app/kiosk/state/machine';
import type { KioskState, OverlayState, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { DD10_SCREENS, T_XRAY, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, resultSessionAt, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';
import { MISMATCH_BODY, REPLIES, catalogBody, estimateOk, optionsBody } from '../../fixtures/kiosk/transport.fixture';

// 타이머 콜백이 늦어도 초기화 기한이 모든 사건보다 먼저다 (design.md DD-07 규칙 4, DD-10, AC-015a·b·c·d·h·i·k, AC-016h·i·j·k, AC-020e·g 의 시간 경계).
// 만료는 TICK 이 돌았는지가 아니라 사건을 적용하기 전 상태의 초기화 시각과 주입한 시계(env.now)로 정한다: 지금 >= 초기화 시각이면
// 환자 조작이든 서버 결말이든 TICK 이든 어떤 사건보다 먼저 세션을 지우고 K00_Start 를 연다. 기한 직전(지금 < 초기화 시각)에는 아무것도 달라지지 않는다.
// 컨트롤러와 효과 계층이 이 전이를 어떻게 받아 자원을 푸는지는 idle-expiry-controller.test.ts 가 본다.

const T0 = 1_000;
const SECOND = 1_000;

interface Scene {
  readonly name: string;
  readonly warnSeconds: number;
  readonly resetSeconds: number;
  make(): KioskState;
}

// 큰 글자 보기를 켜 두고(초기화가 끈다), 치료 목록 위치를 옮겨 두어(초기화가 0 으로 돌린다) "지워졌다"를 값으로 본다.
const lived = { lastInteractionAt: T0, sessionStartedAt: T0, display: { largeText: true, orientation: 'PORTRAIT' }, treatmentPageOffset: 2, refreshNotice: { removed: [] } } as const;
const ACTIVE_REQUEST = { requestId: 'REQ-1', sessionId: 'SESSION-1', inputRevision: 3 } as const;
const ACTIVE_REFRESH = { refreshId: 'RFR-1', sessionId: 'SESSION-1', inputRevision: 3, reason: 'VERSION_MISMATCH' } as const;

const EXPIRING: readonly Scene[] = [
  { name: 'K01_Generation (입력 단계, 선택 있음)', warnSeconds: 100, resetSeconds: 120, make: () => resultSessionAt('K01_Generation', lived) },
  { name: 'K03_Treatments (입력 단계, 치료 선택 있음)', warnSeconds: 100, resetSeconds: 120, make: () => resultSessionAt('K03_Treatments', lived) },
  { name: 'K04_Result (결과 단계 180초)', warnSeconds: 160, resetSeconds: 180, make: () => resultSessionAt('K04_Result', lived) },
  { name: 'Calculating (활성 요청)', warnSeconds: 100, resetSeconds: 120, make: () => stateAt('Calculating', { ...lived, inputs: FULL_INPUTS, inputRevision: 3, activeRequest: ACTIVE_REQUEST }) },
  { name: 'K03_Treatments 갱신 진행 (RUNNING, 활성 갱신)', warnSeconds: 100, resetSeconds: 120, make: () => resultSessionAt('K03_Treatments', { ...lived, refreshState: 'RUNNING', activeRefresh: ACTIVE_REFRESH }) },
  { name: 'K03_Treatments 갱신 실패 (FAILED)', warnSeconds: 100, resetSeconds: 120, make: () => resultSessionAt('K03_Treatments', { ...lived, refreshState: 'FAILED' }) },
];

const NEVER_EXPIRING: readonly { readonly name: string; readonly make: () => KioskState }[] = [
  { name: 'K00_Start', make: () => stateAt('K00_Start', { lastInteractionAt: T0, sessionStartedAt: T0 }) },
  { name: 'K06_Complete (자동 복귀 없음)', make: () => stateAt('K06_Complete', { lastInteractionAt: T0, sessionStartedAt: T0 }) },
];

type OverlayName = OverlayState['kind'];
const overlayOf = (name: OverlayName, scene: Scene): OverlayState =>
  name === 'TIMEOUT_DIALOG' ? { kind: name, openedAt: T0 + scene.warnSeconds * SECOND, resetAt: T0 + scene.resetSeconds * SECOND } : { kind: name };
const OVERLAY_NAMES: readonly OverlayName[] = ['NONE', 'RESET_CONFIRM', 'TIMEOUT_DIALOG'];

/** 사건 종류마다 하나 이상. 결말 사건의 식별자는 위 장면의 활성 요청·갱신과 같아서 평소라면 반영될 사건이다. */
const EVENTS: readonly KioskEvent[] = [
  // 환자 조작
  { type: 'START' },
  { type: 'SELECT_GENERATION', code: 'GEN2_C1' },
  { type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' },
  { type: 'SELECT_CAUSE', code: 'INJURY' },
  { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY },
  { type: 'NEXT' },
  { type: 'PREV' },
  { type: 'TREATMENTS_NEXT_PAGE' },
  { type: 'TREATMENTS_PREV_PAGE' },
  { type: 'OPEN_GENERATION_HELP' },
  { type: 'CLOSE_GENERATION_HELP' },
  { type: 'OPEN_DOCUMENTS' },
  { type: 'OPEN_BASIS' },
  { type: 'RETURN_TO_RESULT' },
  { type: 'RESELECT_TREATMENTS' },
  { type: 'EDIT_INSURANCE' },
  { type: 'REQUEST_ESTIMATE' },
  { type: 'RETRY_REFRESH' },
  { type: 'REQUEST_HOME' },
  { type: 'CONFIRM_RESET' },
  { type: 'CANCEL_RESET' },
  { type: 'CONTINUE_USING' },
  { type: 'COMPLETE_USE' },
  { type: 'BACK_TO_START' },
  { type: 'TOGGLE_LARGE_TEXT' },
  { type: 'INTERACTION' },
  // 계산 요청 결말 (SYSTEM)
  { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: 200, body: estimateOk('ESTIMATED') },
  { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: REPLIES.mismatch.status, body: MISMATCH_BODY },
  { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: REPLIES.notPublished.status, body: REPLIES.notPublished.body },
  { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: REPLIES.noTreatment.status, body: REPLIES.noTreatment.body },
  { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: REPLIES.serverError.status, body: REPLIES.serverError.body },
  { type: 'ESTIMATE_FAILED', requestId: 'REQ-1' },
  { type: 'ESTIMATE_EXPIRED', requestId: 'REQ-1' },
  // 자료 갱신 결말 (SYSTEM)
  { type: 'REFRESH_RESOLVED', refreshId: 'RFR-1', catalog: catalogBody(), options: optionsBody() },
  { type: 'REFRESH_FAILED', refreshId: 'RFR-1' },
  { type: 'REFRESH_EXPIRED', refreshId: 'RFR-1' },
  // 시스템
  { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' },
  { type: 'PAGE_RESTORED' },
  { type: 'TICK' },
];

const label = (event: KioskEvent): string => (event.type === 'ESTIMATE_RESPONDED' ? `${event.type} ${event.status}` : event.type);

interface Counted {
  readonly env: ReturnType<typeof makeEnv>;
  readonly issued: { request: number; refresh: number };
}
/** 시각 `now` 의 환경. 새 세션 식별자는 EXP-1... 이고, 계산·갱신 시도 식별자가 발급되면 센다(만료 초기화는 갱신을 시작하지 않는다). */
function envAt(now: number): Counted {
  const issued = { request: 0, refresh: 0 };
  const env = makeEnv(
    now,
    sequenceIds('EXP'),
    () => {
      issued.request += 1;
      return 'RID-NEW';
    },
    () => {
      issued.refresh += 1;
      return 'RFR-NEW';
    },
  );
  return { env, issued };
}

/** 만료 초기화가 만든 새 세션이어야 하는 값 전부. */
function expectFreshSession(next: KioskState, before: KioskState, now: number, orientation = before.display.orientation): void {
  expect(next.screen).toBe('K00_Start');
  expect(next.overlay).toEqual({ kind: 'NONE' });
  expect(next.sessionId).toBe('EXP-1');
  expect(next.sessionId).not.toBe(before.sessionId);
  expect(next.inputs).toEqual({ generation: null, insurerType: null, cause: null, treatmentIds: [] });
  expect(next.inputRevision).toBe(0);
  expect(next.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
  expect(next.display).toEqual({ largeText: false, orientation });
  expect(next.activeRequest).toBeNull();
  expect(next.activeRefresh).toBeNull();
  expect(next.refreshState).toBe('NONE');
  expect(next.refreshNotice).toBeNull();
  expect(next.treatmentPageOffset).toBe(0);
  expect(next.lastInteractionAt).toBe(now);
  expect(next.sessionStartedAt).toBe(now);
  expect(next.clinic).toBe(before.clinic);
}

/** 시각 필드만 지우고 견준다: 같은 사건을 이른 시각에 적용한 결과와 기한 직전에 적용한 결과가 다르지 않다는 것을 보는 도구. */
const withoutClock = (state: KioskState): KioskState => ({ ...state, lastInteractionAt: 0, sessionStartedAt: 0 });

describe('분류표 점검', () => {
  it('시험의 사건 목록이 모든 사건 종류를 한 번 이상 포함한다 (새 사건이 생기면 이 시험이 알려 준다)', () => {
    expect(new Set(EVENTS.map((event) => event.type))).toEqual(new Set(Object.keys(EVENT_SPECS)));
  });
});

describe('idleResetAt: 사건을 적용하기 전 상태의 초기화 시각', () => {
  it('겹침창이 없으면 마지막 환자 조작 + 현재 화면 종류의 초기화 시간이다', () => {
    expect(idleResetAt(resultSessionAt('K03_Treatments', { lastInteractionAt: T0 }))).toBe(T0 + 120 * SECOND);
    expect(idleResetAt(resultSessionAt('K04_Result', { lastInteractionAt: T0 }))).toBe(T0 + 180 * SECOND);
    expect(idleResetAt(resultSessionAt('K07_Documents', { lastInteractionAt: T0 }))).toBe(T0 + 180 * SECOND);
    expect(idleResetAt(resultSessionAt('K04_Result_Hold', { lastInteractionAt: T0 }))).toBe(T0 + 180 * SECOND);
    expect(idleResetAt(resultSessionAt('KXX_Error_Network', { lastInteractionAt: T0 }))).toBe(T0 + 120 * SECOND);
  });

  it('병원 정책의 값을 쓴다', () => {
    const catalog = makeCatalog({ idlePolicy: { screens: { ...DD10_SCREENS, INPUT: { warnSeconds: 50, resetSeconds: 70 } }, completionHoldSeconds: null } });
    expect(idleResetAt(resultSessionAt('K02_Type', { lastInteractionAt: T0 }, { catalog }))).toBe(T0 + 70 * SECOND);
  });

  it('ResetConfirm 이 열려 있어도 늦춰지지 않는다', () => {
    expect(idleResetAt(resultSessionAt('K03_Treatments', { lastInteractionAt: T0, overlay: { kind: 'RESET_CONFIRM' } }))).toBe(T0 + 120 * SECOND);
  });

  it('열린 TimeoutDialog 는 열릴 때 정한 초기화 시각이다: 화면 종류나 마지막 조작이 달라져도 움직이지 않는다', () => {
    const overlay: OverlayState = { kind: 'TIMEOUT_DIALOG', openedAt: T0 + 100 * SECOND, resetAt: T0 + 120 * SECOND };
    expect(idleResetAt(resultSessionAt('K04_Result', { lastInteractionAt: T0 + 50 * SECOND, overlay }))).toBe(T0 + 120 * SECOND);
  });

  it('무조작 타이머가 없는 화면(K00_Start, K06_Complete)은 null 이다 (겹침창 값이 있어도 일정과 같은 규칙이다)', () => {
    const overlay: OverlayState = { kind: 'TIMEOUT_DIALOG', openedAt: T0, resetAt: T0 + SECOND };
    for (const screen of ['K00_Start', 'K06_Complete'] as const satisfies readonly ScreenState[]) {
      expect(idleResetAt(stateAt(screen))).toBeNull();
      expect(idleResetAt(stateAt(screen, { overlay }))).toBeNull();
    }
  });
});

describe('기한 이후: 만료 초기화가 모든 사건보다 먼저다', () => {
  for (const scene of EXPIRING) {
    describe.each(OVERLAY_NAMES)(`${scene.name} · 겹침창 %s`, (overlayName) => {
      const resetAt = T0 + scene.resetSeconds * SECOND;
      const before = (): KioskState => ({ ...scene.make(), overlay: overlayOf(overlayName, scene) });

      it.each(EVENTS.map((event) => [label(event), event] as const))('정확히 초기화 시각(resetAt)에 온 %s 은 새 세션 K00_Start 로 대신한다', (_name, event) => {
        const { env, issued } = envAt(resetAt);
        const state = before();
        const next = reduce(state, event, env);
        expectFreshSession(next, state, resetAt, event.type === 'ORIENTATION_CHANGED' ? event.orientation : state.display.orientation);
        expect(issued).toEqual({ request: 0, refresh: 0 });
      });

      it.each(EVENTS.map((event) => [label(event), event] as const))('초기화 시각 1ms 뒤에 온 %s 도 같다 (타이머가 늦은 경우)', (_name, event) => {
        const { env, issued } = envAt(resetAt + 1);
        const state = before();
        const next = reduce(state, event, env);
        expectFreshSession(next, state, resetAt + 1, event.type === 'ORIENTATION_CHANGED' ? event.orientation : state.display.orientation);
        expect(issued).toEqual({ request: 0, refresh: 0 });
      });
    });
  }

  it('늦은 409·422(TREATMENT_NOT_PUBLISHED)는 갱신을 시작하지 않는다: 시도 식별자를 새로 발급하지 않고 활성 갱신이 없다', () => {
    const scene = EXPIRING[3] as Scene;
    for (const reply of [REPLIES.mismatch, REPLIES.notPublished]) {
      const { env, issued } = envAt(T0 + 120 * SECOND);
      const next = reduce(scene.make(), { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: reply.status, body: reply.body }, env);
      expect(next.activeRefresh).toBeNull();
      expect(next.refreshState).toBe('NONE');
      expect(issued.refresh).toBe(0);
    }
  });

  it('만료 초기화 뒤 옛 요청·갱신의 결말은 새 세션에 아무것도 쓰지 못한다 (거절: 같은 상태 참조)', () => {
    const request = envAt(T0 + 120 * SECOND);
    const expired = (EXPIRING[3] as Scene).make();
    const fresh = reduce(expired, { type: 'INTERACTION' }, request.env);
    expectFreshSession(fresh, expired, T0 + 120 * SECOND);
    const later = envAt(T0 + 120 * SECOND + 5);
    for (const event of EVENTS.filter((candidate) => candidate.type.startsWith('ESTIMATE_') || candidate.type.startsWith('REFRESH_'))) {
      expect(reduce(fresh, event, later.env), label(event)).toBe(fresh);
    }
  });

  it('ORIENTATION_CHANGED 가 만료를 일으켜도 새 세션은 새로 관찰한 방향을 가진다 (방향은 기기의 관찰이다). 같은 방향이면 그대로다', () => {
    const state = resultSessionAt('K03_Treatments', { ...lived, display: { largeText: true, orientation: 'PORTRAIT' } });
    const { env } = envAt(T0 + 120 * SECOND);
    const changed = reduce(state, { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' }, env);
    expectFreshSession(changed, state, T0 + 120 * SECOND, 'LANDSCAPE');
    const landscape = { ...state, display: { largeText: true, orientation: 'LANDSCAPE' } } as const;
    expectFreshSession(reduce(landscape, { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' }, envAt(T0 + 120 * SECOND).env), landscape, T0 + 120 * SECOND, 'LANDSCAPE');
    expectFreshSession(reduce(landscape, { type: 'ORIENTATION_CHANGED', orientation: 'PORTRAIT' }, envAt(T0 + 120 * SECOND).env), landscape, T0 + 120 * SECOND, 'PORTRAIT');
    // 다른 사건은 예전 방향을 그대로 이어받는다.
    expectFreshSession(reduce(landscape, { type: 'INTERACTION' }, envAt(T0 + 120 * SECOND).env), landscape, T0 + 120 * SECOND, 'LANDSCAPE');
  });
});

describe('기한 직전과 기한 없는 화면: 달라지는 것이 없다', () => {
  for (const scene of EXPIRING) {
    describe.each(OVERLAY_NAMES)(`${scene.name} · 겹침창 %s`, (overlayName) => {
      const resetAt = T0 + scene.resetSeconds * SECOND;
      const state = (): KioskState => ({ ...scene.make(), overlay: overlayOf(overlayName, scene) });

      // TICK 은 시각으로 도래 여부가 갈리므로 따로 본다.
      it.each(EVENTS.filter((event) => event.type !== 'TICK').map((event) => [label(event), event] as const))('초기화 시각 1ms 전의 %s 은 마지막 조작 직후에 적용한 결과와 같다 (시각 필드 제외)', (_name, event) => {
        const early = reduce(state(), event, envAt(T0).env);
        const justBefore = reduce(state(), event, envAt(resetAt - 1).env);
        expect(withoutClock(justBefore)).toEqual(withoutClock(early));
      });
    });
  }

  it('열린 TimeoutDialog 에서 초기화 시각 1ms 전의 "계속 사용할게요"는 겹침창을 닫고 마지막 조작 시각을 지금으로 바꾼다 (세션은 그대로)', () => {
    const scene = EXPIRING[1] as Scene;
    const state: KioskState = { ...scene.make(), overlay: overlayOf('TIMEOUT_DIALOG', scene) };
    const now = T0 + 120 * SECOND - 1;
    const next = reduce(state, { type: 'CONTINUE_USING' }, envAt(now).env);
    expect(next.overlay).toEqual({ kind: 'NONE' });
    expect(next.lastInteractionAt).toBe(now);
    expect(next.sessionId).toBe(state.sessionId);
    expect(next.screen).toBe('K03_Treatments');
    expect(next.inputs).toBe(state.inputs);
  });

  it('TimeoutDialog 아래에서 기한 전에 도착한 서버 결말은 밑 화면에 곧바로 반영되고 마지막 조작 시각과 겹침창의 초기화 시각을 움직이지 않는다', () => {
    const scene = EXPIRING[3] as Scene;
    const state: KioskState = { ...scene.make(), overlay: overlayOf('TIMEOUT_DIALOG', scene) };
    const now = T0 + 120 * SECOND - 1;
    const next = reduce(state, { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: 200, body: estimateOk('ESTIMATED') }, envAt(now).env);
    expect(next.screen).toBe('K04_Result');
    expect(next.activeRequest).toBeNull();
    expect(next.lastInteractionAt).toBe(T0);
    expect(next.overlay).toBe(state.overlay);
    expect(next.sessionId).toBe(state.sessionId);
  });

  it('기한 전의 409 는 (양성 대조) 갱신을 시작한다', () => {
    const scene = EXPIRING[3] as Scene;
    const { env, issued } = envAt(T0 + 120 * SECOND - 1);
    const next = reduce(scene.make(), { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: 409, body: MISMATCH_BODY }, env);
    expect(next.refreshState).toBe('RUNNING');
    expect(next.activeRefresh?.refreshId).toBe('RFR-NEW');
    expect(issued.refresh).toBe(1);
  });

  it('TICK: 열린 TimeoutDialog 의 초기화 시각 1ms 전에는 거절하고, 그 시각에는 초기화한다', () => {
    const scene = EXPIRING[1] as Scene;
    const state: KioskState = { ...scene.make(), overlay: overlayOf('TIMEOUT_DIALOG', scene) };
    expect(reduce(state, { type: 'TICK' }, envAt(T0 + 120 * SECOND - 1).env)).toBe(state);
    expectFreshSession(reduce(state, { type: 'TICK' }, envAt(T0 + 120 * SECOND).env), state, T0 + 120 * SECOND);
  });

  it('TICK: 겹침창이 없고 경고 시각이 지났으나 초기화 시각 전이면 TimeoutDialog 를 연다 (초기화 시각은 마지막 조작에서 센 값)', () => {
    const state = (EXPIRING[1] as Scene).make();
    const next = reduce(state, { type: 'TICK' }, envAt(T0 + 110 * SECOND).env);
    expect(next.overlay).toEqual({ kind: 'TIMEOUT_DIALOG', openedAt: T0 + 110 * SECOND, resetAt: T0 + 120 * SECOND });
    expect(next.sessionId).toBe(state.sessionId);
  });

  for (const scene of NEVER_EXPIRING) {
    // K00_Start·K06_Complete 는 무조작 타이머가 없다. 아주 늦게 온 사건도 만료 초기화가 아니라 평소 규칙대로 처리된다(TICK 은 K06 자동 복귀 쪽이 따로 본다).
    it.each(EVENTS.filter((event) => event.type !== 'TICK').map((event) => [label(event), event] as const))(`${scene.name}: 한참 뒤의 %s 은 마지막 조작 직후에 적용한 결과와 같다 (시각 필드 제외)`, (_name, event) => {
      const early = reduce(scene.make(), event, envAt(T0).env);
      const late = reduce(scene.make(), event, envAt(T0 + 100_000 * SECOND).env);
      expect(withoutClock(late)).toEqual(withoutClock(early));
    });
  }

  it('K06_Complete: 자동 복귀 시간이 양수이면 도래한 TICK 으로 K00_Start 로 돌아가고, 없으면(null) 늦은 TICK 도 아무 일 없다', () => {
    const timed = stateAt('K06_Complete', { sessionStartedAt: T0, lastInteractionAt: T0 }, { catalog: makeCatalog({ idlePolicy: { screens: DD10_SCREENS, completionHoldSeconds: 30 } }) });
    expect(reduce(timed, { type: 'TICK' }, envAt(T0 + 30 * SECOND - 1).env)).toBe(timed);
    expect(reduce(timed, { type: 'TICK' }, envAt(T0 + 30 * SECOND).env).screen).toBe('K00_Start');
    const manual = (NEVER_EXPIRING[1] as { make(): KioskState }).make();
    expect(reduce(manual, { type: 'TICK' }, envAt(T0 + 100_000 * SECOND).env)).toBe(manual);
  });
});

describe('시나리오: 기한을 정하는 쪽이 어느 값인가', () => {
  const CALCULATING = (): KioskState => (EXPIRING[3] as Scene).make();

  it('열린 TimeoutDialog 의 초기화 시각이 밑 화면 정책보다 먼저다: 120초 화면에서 열린 겹침창은, 밑 화면이 180초 화면이 된 뒤에도 120초에 초기화한다', () => {
    const opened = reduce(CALCULATING(), { type: 'TICK' }, envAt(T0 + 100 * SECOND).env);
    expect(opened.overlay).toEqual({ kind: 'TIMEOUT_DIALOG', openedAt: T0 + 100 * SECOND, resetAt: T0 + 120 * SECOND });
    const answered = reduce(opened, { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: 200, body: estimateOk('ESTIMATED') }, envAt(T0 + 110 * SECOND).env);
    expect(answered.screen).toBe('K04_Result');
    expect(answered.overlay).toBe(opened.overlay);
    // 결과 화면의 180초 정책만 보면 아직 기한 전이지만, 고정된 120초가 먼저다.
    expectFreshSession(reduce(answered, { type: 'TOGGLE_LARGE_TEXT' }, envAt(T0 + 120 * SECOND + 1).env), answered, T0 + 120 * SECOND + 1);
    expect(reduce(answered, { type: 'CONTINUE_USING' }, envAt(T0 + 120 * SECOND - 1).env).overlay).toEqual({ kind: 'NONE' });
  });

  it('겹침창이 없으면 현재 화면 종류의 정책과 바뀌지 않은 마지막 조작 시각으로 센다: 120초 화면이 180초 화면이 되면 기한은 180초다', () => {
    const answered = reduce(CALCULATING(), { type: 'ESTIMATE_RESPONDED', requestId: 'REQ-1', status: 200, body: estimateOk('ESTIMATED') }, envAt(T0 + 110 * SECOND).env);
    expect(answered.screen).toBe('K04_Result');
    expect(answered.lastInteractionAt).toBe(T0);
    const stillAlive = reduce(answered, { type: 'TOGGLE_LARGE_TEXT' }, envAt(T0 + 120 * SECOND + 1).env);
    expect(stillAlive.sessionId).toBe(answered.sessionId);
    expect(stillAlive.screen).toBe('K04_Result');
    expect(stillAlive.display.largeText).toBe(false);
    expectFreshSession(reduce(answered, { type: 'TOGGLE_LARGE_TEXT' }, envAt(T0 + 180 * SECOND).env), answered, T0 + 180 * SECOND, answered.display.orientation);
  });

  it('ResetConfirm 이 열려 있는 것은 기한을 늦추지 않는다: "처음으로"를 누른 시각부터 세고 그 사이 열려 있었다는 이유로 연장되지 않는다', () => {
    const input = (EXPIRING[1] as Scene).make();
    const pressed = reduce(input, { type: 'REQUEST_HOME' }, envAt(T0 + 50 * SECOND).env);
    expect(pressed.overlay.kind).toBe('RESET_CONFIRM');
    expect(pressed.lastInteractionAt).toBe(T0 + 50 * SECOND);
    expect(reduce(pressed, { type: 'CANCEL_RESET' }, envAt(T0 + 50 * SECOND + 120 * SECOND - 1).env).overlay.kind).toBe('NONE');
    expectFreshSession(reduce(pressed, { type: 'CANCEL_RESET' }, envAt(T0 + 50 * SECOND + 120 * SECOND).env), pressed, T0 + 170 * SECOND);
  });

  it('만료 초기화는 새 세션의 마지막 조작·세션 시작 시각을 만료 시점의 지금으로 둔다: 곧바로 새 기한이 시작된다', () => {
    const next = reduce((EXPIRING[1] as Scene).make(), { type: 'INTERACTION' }, envAt(T0 + 500 * SECOND).env);
    expect(next.lastInteractionAt).toBe(T0 + 500 * SECOND);
    expect(idleResetAt(next)).toBeNull();
    const started = reduce(next, { type: 'START' }, envAt(T0 + 501 * SECOND).env);
    expect(started.screen).toBe('K01_Generation');
    expect(idleResetAt(started)).toBe(T0 + 501 * SECOND + 120 * SECOND);
  });
});
