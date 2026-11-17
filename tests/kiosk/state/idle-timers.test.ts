import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKioskController, createKioskControllerFromState } from '../../../src/app/kiosk/state/controller';
import type { KioskController } from '../../../src/app/kiosk/state/controller';
import { selectTimeoutDialog } from '../../../src/app/kiosk/state/idle';
import type { KioskState, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { DD10_SCREENS, makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, resultSessionAt, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';
import type { InitialOptions } from '../../fixtures/kiosk/state.fixture';

// DD-10 무조작 타이머를 가짜 시계로 시험한다. 닫는 AC: AC-015a, AC-015b, AC-015c, AC-015d, AC-015h. 증거: AC-015e·f·g·j·k, AC-014c 는 없음.
// 시계·타이머는 컨트롤러 의존성의 기본값(호출 시점에 찾는 전역 setTimeout·clearTimeout·성능 시계)을 vitest 가짜 시계가 가로챈다.
// 서버 응답이 시간을 다시 세지 않는다는 쪽은 M5.B 의 응답 사건이 생긴 뒤 AC-015l~p 가 본다. 여기서는 그 사건이 들어갈 자리(시스템 사건은 시계를 건드리지 않는다)를 event-classes.test.ts 가 본다.

const SECOND = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

interface Harness {
  controller: KioskController;
  /** 알림마다 받은 상태. */
  history: KioskState[];
  /** 지금 시각(가짜 시계, 밀리초). */
  now: () => number;
}

function harness(controller: KioskController): Harness {
  const history: KioskState[] = [];
  controller.subscribe((state) => history.push(state));
  return { controller, history, now: () => performance.now() };
}

/** 지정한 화면에서 시작하는 컨트롤러. 시작 시각 = 지금의 가짜 시계. 새 세션 식별자는 NEW-1, NEW-2... */
function at(screen: ScreenState, patch: Partial<KioskState> = {}, init: InitialOptions = {}, result = true): Harness {
  const env = makeEnv(performance.now());
  const state = result ? resultSessionAt(screen, patch, { ...init, env }) : stateAt(screen, patch, { ...init, env });
  return harness(createKioskControllerFromState({ newSessionId: sequenceIds('NEW') }, state));
}

function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

const screenOf = (h: Harness): ScreenState => h.controller.getState().screen;
const overlayOf = (h: Harness): string => h.controller.getState().overlay.kind;

/** 경고·초기화 임계값 검사: 경고 직전에는 겹침창 없음, 경고 시각에 TimeoutDialog, 초기화 직전까지 유지, 초기화 시각에 K00_Start. */
function expectIdleCycle(h: Harness, warnSeconds: number, resetSeconds: number): void {
  const sessionBefore = h.controller.getState().sessionId;
  const screenBefore = screenOf(h);
  advance(warnSeconds * SECOND - 1);
  expect(overlayOf(h)).toBe('NONE');
  expect(screenOf(h)).toBe(screenBefore);
  advance(1);
  expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  expect(screenOf(h)).toBe(screenBefore);
  advance((resetSeconds - warnSeconds) * SECOND - 1);
  expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  expect(screenOf(h)).toBe(screenBefore);
  advance(1);
  const after = h.controller.getState();
  expect(after.screen).toBe('K00_Start');
  expect(after.overlay.kind).toBe('NONE');
  expect(after.sessionId).not.toBe(sessionBefore);
  expect(vi.getTimerCount()).toBe(0);
}

describe('AC-015a: 입력 단계는 100초에 TimeoutDialog, 120초에 초기화되어 K00_Start 로 간다', () => {
  it.each(['K01_Generation', 'K02_Type', 'K02b_Cause', 'K03_Treatments'] as const)('%s (선택이 있는 세션)', (screen) => {
    const h = at(screen);
    expectIdleCycle(h, 100, 120);
    expect(h.controller.getState().inputs).toEqual({ generation: null, insurerType: null, cause: null, treatmentIds: [] });
  });

  it('시작 화면에서 시작하기를 눌러 들어간 K01 도 같다 (실제 사건으로 가는 경로)', () => {
    const controller = createKioskController({ newSessionId: sequenceIds('NEW') }, { catalog: makeCatalog(), options: makeOptions() });
    const h = harness(controller);
    controller.dispatch({ type: 'START' });
    advance(30 * SECOND);
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN3_C3' });
    expect(screenOf(h)).toBe('K01_Generation');
    expectIdleCycle(h, 100, 120);
  });

  it('초기화는 세션을 비우고 새 sessionId 로 K00_Start 를 연다: 이전 선택이 남지 않는다', () => {
    const h = at('K03_Treatments');
    advance(120 * SECOND);
    const state = h.controller.getState();
    expect(state.sessionId).toBe('NEW-1');
    expect(state.inputs.treatmentIds).toEqual([]);
    expect(state.derived.estimate).toBeNull();
  });
});

describe('AC-015b: 결과·근거·서류·보류 결과는 160초 경고, 180초 초기화 — 결과 화면으로 돌아가지 않고 K06_Complete 를 거치지 않는다', () => {
  const SCREENS = ['K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold', 'K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown'] as const;

  it.each(SCREENS.flatMap((screen) => (['PORTRAIT', 'LANDSCAPE'] as const).map((orientation) => [screen, orientation] as const)))('%s (%s)', (screen, orientation) => {
    const h = at(screen, {}, { orientation });
    expectIdleCycle(h, 160, 180);
    const visited = h.history.map((state) => state.screen);
    expect(visited).not.toContain('K06_Complete');
    expect(visited.filter((name) => name !== 'K00_Start' && name !== screen)).toEqual([]);
    expect(screenOf(h)).toBe('K00_Start');
  });
});

describe('AC-015c: 세대 확인 안내·계산 중·통신 오류는 100초 경고, 120초 초기화 (잠정 값)', () => {
  it('K01_Generation_Unknown (실제 사건으로 들어간다)', () => {
    const h = at('K01_Generation', {}, {}, false);
    h.controller.dispatch({ type: 'OPEN_GENERATION_HELP' });
    expect(screenOf(h)).toBe('K01_Generation_Unknown');
    expectIdleCycle(h, 100, 120);
  });

  it.each(['Calculating', 'KXX_Error_Network'] as const)('%s', (screen) => {
    expectIdleCycle(at(screen), 100, 120);
  });
});

describe('AC-015d: 환자의 조작만 무조작 시간을 0초부터 다시 센다', () => {
  it('입력 단계 60초 지점의 터치(INTERACTION)는 경고를 160초 지점으로 미룬다', () => {
    const h = at('K03_Treatments');
    advance(60 * SECOND);
    h.controller.dispatch({ type: 'INTERACTION' });
    advance(99 * SECOND + 999);
    expect(overlayOf(h)).toBe('NONE');
    advance(1);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  });

  it('화면 방향 변경은 터치도 키 입력도 아니므로 경고 시각이 그대로다 (DD-08 표)', () => {
    const h = at('K03_Treatments');
    advance(60 * SECOND);
    h.controller.dispatch({ type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' });
    advance(40 * SECOND - 1);
    expect(overlayOf(h)).toBe('NONE');
    advance(1);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  });

  it('결과·근거·서류 사이를 오가는 환자 조작마다 새 화면 종류의 임계값으로 0초부터 다시 센다', () => {
    const h = at('K04_Result');
    advance(150 * SECOND);
    h.controller.dispatch({ type: 'OPEN_BASIS' });
    expect(screenOf(h)).toBe('K04_Basis_Calculation');
    advance(159 * SECOND + 999);
    expect(overlayOf(h)).toBe('NONE');
    advance(1);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
    h.controller.dispatch({ type: 'CONTINUE_USING' });
    advance(100 * SECOND);
    h.controller.dispatch({ type: 'RETURN_TO_RESULT' });
    expect(screenOf(h)).toBe('K04_Result');
    advance(159 * SECOND + 999);
    expect(overlayOf(h)).toBe('NONE');
    advance(1);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  });

  it.each([
    ['큰 글자 전환', { type: 'TOGGLE_LARGE_TEXT' }],
    ['같은 값 다시 선택', { type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' }],
    ['이전', { type: 'PREV' }],
    ['다음', { type: 'NEXT' }],
  ] as const)('%s 도 환자 조작이라 시간을 다시 센다', (_name, event) => {
    const h = at('K02_Type');
    advance(90 * SECOND);
    expect(h.controller.dispatch(event)).toBe('APPLIED');
    advance(99 * SECOND + 999);
    expect(overlayOf(h)).toBe('NONE');
    advance(1);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  });

  it('거절된 사건(버튼이 없는 동작)은 시간을 다시 세지 않는다', () => {
    const h = at('K02_Type');
    advance(90 * SECOND);
    expect(h.controller.dispatch({ type: 'START' })).toBe('IGNORED');
    advance(10 * SECOND);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  });
});

describe('AC-015h: K00_Start 와 K06_Complete 는 무조작 타이머가 동작하지 않는다', () => {
  it('K00_Start: 타이머가 하나도 걸려 있지 않고 오래 두어도 아무 일도 없다', () => {
    const controller = createKioskController({}, { catalog: makeCatalog(), options: makeOptions() });
    const h = harness(controller);
    expect(vi.getTimerCount()).toBe(0);
    advance(3_600 * SECOND);
    expect(screenOf(h)).toBe('K00_Start');
    expect(h.history).toEqual([]);
  });

  it('K06_Complete(completionHoldSeconds null): 타이머 없음, 1시간이 지나도 K06 에 머문다 (자동 복귀가 없다)', () => {
    const h = at('K04_Result');
    h.controller.dispatch({ type: 'COMPLETE_USE' });
    expect(screenOf(h)).toBe('K06_Complete');
    expect(vi.getTimerCount()).toBe(0);
    advance(3_600 * SECOND);
    expect(screenOf(h)).toBe('K06_Complete');
  });

  it('입력 단계로 들어가기 전의 시작 화면에서 첫 조작을 하면 비로소 타이머가 걸린다', () => {
    const controller = createKioskController({}, { catalog: makeCatalog(), options: makeOptions() });
    expect(vi.getTimerCount()).toBe(0);
    controller.dispatch({ type: 'START' });
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('completionHoldSeconds: 양의 정수면 그만큼 뒤 K00_Start, null 이면 자동 복귀 없음 (DD-13)', () => {
  const policy = (completionHoldSeconds: number | null) => ({ catalog: makeCatalog({ idlePolicy: { screens: { ...DD10_SCREENS }, completionHoldSeconds } }) });

  it('이용 완료 → K06_Complete 가 그려지기 전에 세션이 비어 있고, 25초 뒤 K00_Start 로 간다 (AC-015f 증거)', () => {
    const h = at('K04_Result', {}, policy(25));
    h.controller.dispatch({ type: 'COMPLETE_USE' });
    const complete = h.controller.getState();
    expect(h.history[0]?.screen).toBe('K06_Complete');
    expect(h.history[0]?.inputs).toEqual({ generation: null, insurerType: null, cause: null, treatmentIds: [] });
    expect(h.history[0]?.derived.estimate).toBeNull();
    advance(25 * SECOND - 1);
    expect(screenOf(h)).toBe('K06_Complete');
    advance(1);
    expect(screenOf(h)).toBe('K00_Start');
    expect(h.controller.getState().sessionId).not.toBe(complete.sessionId);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('"처음 화면으로"를 먼저 누르면 걸려 있던 자동 복귀 타이머가 풀린다', () => {
    const h = at('K04_Result', {}, policy(25));
    h.controller.dispatch({ type: 'COMPLETE_USE' });
    expect(vi.getTimerCount()).toBe(1);
    h.controller.dispatch({ type: 'BACK_TO_START' });
    expect(screenOf(h)).toBe('K00_Start');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('값이 null 이면 10초가 지나도 K06 에 머문다: 10 으로 바꿔 쓰지 않는다', () => {
    const h = at('K04_Result', {}, policy(null));
    h.controller.dispatch({ type: 'COMPLETE_USE' });
    advance(10 * SECOND);
    advance(60 * SECOND);
    expect(screenOf(h)).toBe('K06_Complete');
  });
});

describe('AC-015e·AC-015g·AC-015j 증거: 일반 화면의 "처음으로"와 TimeoutDialog 안의 "처음으로"', () => {
  it('입력이 있는 세션: 일반 화면에서는 ResetConfirm 이 먼저, 확인하면 K06 없이 K00 (AC-015g)', () => {
    const h = at('K04_Result');
    h.controller.dispatch({ type: 'REQUEST_HOME' });
    expect(overlayOf(h)).toBe('RESET_CONFIRM');
    h.controller.dispatch({ type: 'CONFIRM_RESET' });
    expect(screenOf(h)).toBe('K00_Start');
    expect(h.history.map((state) => state.screen)).not.toContain('K06_Complete');
    expect(h.controller.getState().sessionId).toBe('NEW-1');
  });

  it('입력이 있는 세션: ResetConfirm 을 취소하면 선택·결과·화면이 그대로 남는다 (AC-015g)', () => {
    const h = at('K04_Result');
    const before = h.controller.getState();
    h.controller.dispatch({ type: 'REQUEST_HOME' });
    h.controller.dispatch({ type: 'CANCEL_RESET' });
    const after = h.controller.getState();
    expect(after.screen).toBe('K04_Result');
    expect(after.inputs).toBe(before.inputs);
    expect(after.derived).toBe(before.derived);
    expect(after.sessionId).toBe(before.sessionId);
  });

  it.each([
    ['입력이 있는 세션', true],
    ['입력이 없는 세션', false],
  ])('TimeoutDialog 안의 "처음으로"(%s): 겹침창 기록에 ResetConfirm 이 없고 바로 K00_Start 다 (AC-015e)', (_name, hasInput) => {
    const h = hasInput ? at('K04_Result') : at('K01_Generation', {}, {}, false);
    advance(hasInput ? 160 * SECOND : 100 * SECOND);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
    h.controller.dispatch({ type: 'REQUEST_HOME' });
    expect(screenOf(h)).toBe('K00_Start');
    const overlays = h.history.map((state) => state.overlay.kind);
    expect(overlays).not.toContain('RESET_CONFIRM');
    expect(h.history.map((state) => state.screen)).not.toContain('K06_Complete');
    expect(h.controller.getState().sessionId).toBe('NEW-1');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('입력이 없는 세션의 일반 화면: "처음으로"는 ResetConfirm 없이 바로 K00_Start (AC-015j)', () => {
    const h = at('K01_Generation', {}, {}, false);
    h.controller.dispatch({ type: 'REQUEST_HOME' });
    expect(screenOf(h)).toBe('K00_Start');
    expect(h.history.map((state) => state.overlay.kind)).not.toContain('RESET_CONFIRM');
  });

  it('"계속 사용할게요"를 반복해도 누를 때마다 시간이 다시 시작하고 직전 화면으로 돌아온다 (AC-015e)', () => {
    const h = at('K03_Treatments', { inputs: FULL_INPUTS });
    advance(100 * SECOND);
    for (let round = 1; round <= 3; round += 1) {
      expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
      advance(7 * SECOND);
      h.controller.dispatch({ type: 'CONTINUE_USING' });
      expect(overlayOf(h)).toBe('NONE');
      expect(screenOf(h)).toBe('K03_Treatments');
      expect(h.controller.getState().inputs).toBe(FULL_INPUTS);
      advance(100 * SECOND - 1);
      expect(overlayOf(h)).toBe('NONE');
      advance(1);
    }
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  });
});

describe('AC-015k 증거: ResetConfirm 이 열린 채 경고 시점이 되면 TimeoutDialog 로 바뀌고 초기화 시점은 늦춰지지 않는다', () => {
  /** 입력 단계에서 t = 30초에 "처음으로"를 눌러 ResetConfirm 을 연 세션(마지막 터치 = 30초). */
  function withResetConfirm(): Harness {
    const h = at('K03_Treatments', { inputs: FULL_INPUTS });
    advance(30 * SECOND);
    h.controller.dispatch({ type: 'REQUEST_HOME' });
    expect(overlayOf(h)).toBe('RESET_CONFIRM');
    return h;
  }

  it('경고 시점에 ResetConfirm 이 닫히고 TimeoutDialog 가 열린다. 두 겹침창이 동시에 열린 순간이 없다', () => {
    const h = withResetConfirm();
    advance(100 * SECOND - 1);
    expect(overlayOf(h)).toBe('RESET_CONFIRM');
    advance(1);
    const state = h.controller.getState();
    expect(state.overlay.kind).toBe('TIMEOUT_DIALOG');
    expect(state.screen).toBe('K03_Treatments');
    expect(state.inputs).toBe(FULL_INPUTS);
    const overlays = h.history.map((entry) => entry.overlay.kind);
    expect(overlays.filter((kind) => kind === 'RESET_CONFIRM' || kind === 'TIMEOUT_DIALOG')).toEqual(['RESET_CONFIRM', 'TIMEOUT_DIALOG']);
  });

  it('초기화 시점은 ResetConfirm 을 열려고 마지막으로 누른 터치에서 정책 시간(120초)이 지난 때다: ResetConfirm 이 없을 때와 같다', () => {
    const withConfirm = withResetConfirm();
    const openedAtTouch = withConfirm.now();
    advance(120 * SECOND - 1);
    expect(screenOf(withConfirm)).toBe('K03_Treatments');
    advance(1);
    expect(screenOf(withConfirm)).toBe('K00_Start');
    expect(withConfirm.now() - openedAtTouch).toBe(120 * SECOND);
  });

  it('열린 TimeoutDialog 의 초기화 시각은 열릴 때 정해져 바뀌지 않고, 남은 시간은 계속 준다', () => {
    const h = withResetConfirm();
    advance(100 * SECOND);
    const opened = selectTimeoutDialogOf(h);
    expect(opened.remainingMs).toBe(20 * SECOND);
    advance(5 * SECOND);
    h.controller.dispatch({ type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' });
    h.controller.dispatch({ type: 'INTERACTION' });
    const later = selectTimeoutDialogOf(h);
    expect(later.resetAt).toBe(opened.resetAt);
    expect(later.remainingMs).toBe(15 * SECOND);
  });

  it('그 TimeoutDialog 에서 "계속 사용할게요"를 누르면 ResetConfirm 이 아니라 그 아래 화면으로 돌아온다', () => {
    const h = withResetConfirm();
    advance(100 * SECOND);
    h.controller.dispatch({ type: 'CONTINUE_USING' });
    expect(overlayOf(h)).toBe('NONE');
    expect(screenOf(h)).toBe('K03_Treatments');
    expect(h.controller.getState().inputs).toBe(FULL_INPUTS);
  });

  it('TimeoutDialog 가 열려 있는 동안 ResetConfirm 을 여는 입력은 없다 ("처음으로"는 즉시 초기화다)', () => {
    const h = withResetConfirm();
    advance(100 * SECOND);
    h.controller.dispatch({ type: 'REQUEST_HOME' });
    expect(screenOf(h)).toBe('K00_Start');
    expect(h.history.map((entry) => entry.overlay.kind).filter((kind) => kind === 'RESET_CONFIRM')).toHaveLength(1);
  });

  it('ResetConfirm 의 버튼을 포함한 환자의 터치는 무조작 시간을 다시 세게 한다 (취소 터치)', () => {
    const h = withResetConfirm();
    advance(50 * SECOND);
    h.controller.dispatch({ type: 'CANCEL_RESET' });
    expect(overlayOf(h)).toBe('NONE');
    advance(99 * SECOND + 999);
    expect(overlayOf(h)).toBe('NONE');
    advance(1);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  });

  it('ResetConfirm 위에서의 터치(INTERACTION)도 시간을 다시 세고 ResetConfirm 은 열려 있다', () => {
    const h = withResetConfirm();
    advance(60 * SECOND);
    h.controller.dispatch({ type: 'INTERACTION' });
    advance(99 * SECOND + 999);
    expect(overlayOf(h)).toBe('RESET_CONFIRM');
    advance(1);
    expect(overlayOf(h)).toBe('TIMEOUT_DIALOG');
  });
});

describe('타이머 칸은 하나다', () => {
  it('어느 시점에도 걸려 있는 타이머가 하나를 넘지 않고, 초기화로 K00 에 가면 0 개다', () => {
    const h = at('K03_Treatments', { inputs: FULL_INPUTS });
    const counts: number[] = [vi.getTimerCount()];
    for (const event of [{ type: 'INTERACTION' }, { type: 'TOGGLE_LARGE_TEXT' }, { type: 'REQUEST_HOME' }, { type: 'CANCEL_RESET' }, { type: 'PREV' }] as const) {
      h.controller.dispatch(event);
      counts.push(vi.getTimerCount());
    }
    advance(200 * SECOND);
    counts.push(vi.getTimerCount());
    expect(Math.max(...counts.slice(0, -1))).toBe(1);
    expect(counts[counts.length - 1]).toBe(0);
    expect(screenOf(h)).toBe('K00_Start');
  });

  it('같은 일정이면 타이머를 다시 걸지 않는다 (시계를 건드리지 않는 사건 뒤에도 같은 타이머가 남는다)', () => {
    const h = at('K03_Treatments');
    const spy = vi.spyOn(globalThis, 'setTimeout');
    h.controller.dispatch({ type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' });
    expect(spy).not.toHaveBeenCalled();
    advance(SECOND);
    h.controller.dispatch({ type: 'INTERACTION' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

function selectTimeoutDialogOf(h: Harness): { resetAt: number; remainingMs: number } {
  const dialog = selectTimeoutDialog(h.controller.getState(), h.now());
  if (dialog === null) throw new Error('TimeoutDialog 가 열려 있지 않다');
  return dialog;
}
