import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKioskController, createKioskControllerFromState } from '../../../src/app/kiosk/state/controller';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { DD10_SCREENS, makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { makeEnv, resultSessionAt, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';

// 컨트롤러의 가장자리: 구독자가 예외를 던질 때, 같은 함수를 두 번 구독할 때, 경고 알림 시점의 타이머, 이용 완료 화면의 자동 복귀.
// 기본 동작은 controller.test.ts 와 idle-timers.test.ts 가 본다.

const INIT = { catalog: makeCatalog(), options: makeOptions() };
const SECOND = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('구독자가 예외를 던질 때', () => {
  it('dispatch 로 예외가 전해지지만 상태는 이미 반영되어 있다. 알림 도중 쌓인 남은 알림은 버려져 다음 dispatch 가 오래된 상태를 다시 알리지 않는다', () => {
    const controller = createKioskController({}, INIT);
    const seen: KioskState[] = [];
    let armed = true;
    controller.subscribe(() => {
      if (!armed) return;
      armed = false;
      controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' });
      throw new Error('구독자 오류');
    });
    controller.subscribe((state) => seen.push(state));
    expect(() => controller.dispatch({ type: 'START' })).toThrow('구독자 오류');
    expect(controller.getState().inputs.generation).toBe('GEN1_AS');
    expect(seen).toEqual([]);
    expect(controller.dispatch({ type: 'NEXT' })).toBe('APPLIED');
    expect(seen.map((state) => state.screen)).toEqual(['K02_Type']);
  });

  it('예외 뒤에도 타이머는 새 상태에 맞춰져 있다', () => {
    const controller = createKioskController({}, INIT);
    controller.subscribe(() => {
      throw new Error('구독자 오류');
    });
    expect(() => controller.dispatch({ type: 'START' })).toThrow();
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('구독', () => {
  it('같은 함수를 두 번 구독하면 두 번 알림을 받고, 해제는 구독마다 따로다', () => {
    const controller = createKioskController({}, INIT);
    const listener = vi.fn();
    const first = controller.subscribe(listener);
    controller.subscribe(listener);
    controller.dispatch({ type: 'START' });
    expect(listener).toHaveBeenCalledTimes(2);
    first();
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('해제 함수를 두 번 불러도 안전하다', () => {
    const controller = createKioskController({}, INIT);
    const unsubscribe = controller.subscribe(() => undefined);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('시계가 일으킨 변화의 알림', () => {
  it('경고 알림을 받는 쪽이 읽는 시점에 초기화 타이머가 이미 걸려 있다 (타이머 칸 하나)', () => {
    const state = resultSessionAt('K03_Treatments', {}, { env: makeEnv(performance.now()) });
    const controller = createKioskControllerFromState({ newSessionId: sequenceIds('NEW') }, state);
    const timers: number[] = [];
    controller.subscribe((next) => timers.push(next.overlay.kind === 'TIMEOUT_DIALOG' ? vi.getTimerCount() : -1));
    vi.advanceTimersByTime(100 * SECOND);
    expect(timers).toEqual([1]);
    vi.advanceTimersByTime(20 * SECOND);
    expect(controller.getState().screen).toBe('K00_Start');
    expect(timers).toEqual([1, -1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('시계가 일으킨 변화는 마지막 조작 시각을 움직이지 않는다 (경고가 열려도 초기화 시각이 늘지 않는다)', () => {
    const state = resultSessionAt('K03_Treatments', {}, { env: makeEnv(performance.now()) });
    const controller = createKioskControllerFromState({}, state);
    vi.advanceTimersByTime(100 * SECOND);
    expect(controller.getState().overlay.kind).toBe('TIMEOUT_DIALOG');
    expect(controller.getState().lastInteractionAt).toBe(state.lastInteractionAt);
  });
});

describe('K06_Complete 의 자동 복귀 (DD-13)', () => {
  const policy = (completionHoldSeconds: number | null) => ({ catalog: makeCatalog({ idlePolicy: { screens: { ...DD10_SCREENS }, completionHoldSeconds } }) });

  it('이용 완료 화면에서 큰 글자를 눌러도 자동 복귀 시각은 화면이 열린 때부터 센다 (환자 조작이 연장하지 않는다)', () => {
    const start = makeEnv(performance.now());
    const controller = createKioskControllerFromState({}, stateAt('K06_Complete', { sessionStartedAt: start.now }, { ...policy(25), env: start }));
    vi.advanceTimersByTime(10 * SECOND);
    expect(controller.dispatch({ type: 'TOGGLE_LARGE_TEXT' })).toBe('APPLIED');
    expect(controller.getState().display.largeText).toBe(true);
    vi.advanceTimersByTime(15 * SECOND - 1);
    expect(controller.getState().screen).toBe('K06_Complete');
    vi.advanceTimersByTime(1);
    expect(controller.getState().screen).toBe('K00_Start');
    expect(controller.getState().display.largeText).toBe(false);
  });

  it('자동 복귀 뒤에는 타이머가 없다', () => {
    const start = makeEnv(performance.now());
    createKioskControllerFromState({}, stateAt('K06_Complete', { sessionStartedAt: start.now }, { ...policy(5), env: start }));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(5 * SECOND);
    expect(vi.getTimerCount()).toBe(0);
  });
});
