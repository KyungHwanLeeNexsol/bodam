import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKioskController, createKioskControllerFromState } from '../../../src/app/kiosk/state/controller';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';

// 컨트롤러(getState · dispatch · subscribe · select · dispose)와 의존성 주입. 증거: AC-015a~d 의 타이머 연결 부분.
// 닫는 AC 는 없다. 알림은 상태가 바뀔 때마다 한 번, 반쯤 적용된 스냅샷 없이 순서대로 간다.

const INIT = { catalog: makeCatalog(), options: makeOptions() };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('초기 상태', () => {
  it('K00_Start 의 빈 세션이고 병원 자료와 두 버전을 담고 있다. 세션 식별자와 시각은 주입한 값이다', () => {
    const controller = createKioskController({ now: () => 777, newSessionId: () => 'SESSION-FIXED' }, INIT);
    const state = controller.getState();
    expect(state.screen).toBe('K00_Start');
    expect(state.sessionId).toBe('SESSION-FIXED');
    expect(state.lastInteractionAt).toBe(777);
    expect(state.sessionStartedAt).toBe(777);
    expect(state.clinic.catalog).toBe(INIT.catalog);
    expect(state.clinic.options).toBe(INIT.options);
    expect(state.clinic.versions).toEqual({ catalogVersion: 'TEST_FIXTURE_CATALOG_V1', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1' });
    expect(state.refreshState).toBe('NONE');
    expect(state.activeRequest).toBeNull();
    expect(state.activeRefresh).toBeNull();
    expect(state.display).toEqual({ largeText: false, orientation: 'PORTRAIT' });
  });

  it('관찰한 화면 방향을 초기값으로 받을 수 있다 (표시 관찰값이며 세션 데이터가 아니다)', () => {
    expect(createKioskController({}, { ...INIT, orientation: 'LANDSCAPE' }).getState().display.orientation).toBe('LANDSCAPE');
  });
});

describe('dispatch 와 알림', () => {
  it('받아들인 사건은 "APPLIED", 거절한 사건은 "IGNORED" 이고 거절하면 알림이 없고 상태 참조가 그대로다', () => {
    const controller = createKioskController({}, INIT);
    const seen: KioskState[] = [];
    controller.subscribe((state) => seen.push(state));
    const before = controller.getState();
    expect(controller.dispatch({ type: 'NEXT' })).toBe('IGNORED');
    expect(controller.getState()).toBe(before);
    expect(seen).toEqual([]);
    expect(controller.dispatch({ type: 'START' })).toBe('APPLIED');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(controller.getState());
  });

  it('상태가 바뀔 때마다 알림이 정확히 한 번 간다: 사건 하나 = 알림 하나', () => {
    const controller = createKioskController({}, INIT);
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.dispatch({ type: 'START' });
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' });
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' });
    controller.dispatch({ type: 'NEXT' });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('알림을 받는 쪽이 읽는 getState() 와 받은 상태가 같고, 타이머도 이미 새 상태에 맞춰져 있다', () => {
    const controller = createKioskController({}, INIT);
    let timersSeen = -1;
    let same = false;
    controller.subscribe((state) => {
      same = state === controller.getState();
      timersSeen = vi.getTimerCount();
    });
    controller.dispatch({ type: 'START' });
    expect(same).toBe(true);
    expect(timersSeen).toBe(1);
  });

  it('구독 해제하면 더는 알림이 가지 않는다', () => {
    const controller = createKioskController({}, INIT);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.dispatch({ type: 'START' });
    unsubscribe();
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('알림 도중 다른 구독을 해제하면 그 구독은 이번 알림을 받지 않는다. 알림 도중 새로 구독한 쪽은 이번 알림을 받지 않는다', () => {
    const controller = createKioskController({}, INIT);
    const calls: string[] = [];
    const first = (): void => {
      calls.push('first');
      unsubscribeSecond();
      controller.subscribe(() => calls.push('late'));
    };
    controller.subscribe(first);
    const unsubscribeSecond = controller.subscribe(() => calls.push('second'));
    controller.dispatch({ type: 'START' });
    expect(calls).toEqual(['first']);
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' });
    expect(calls).toEqual(['first', 'first', 'late']);
  });

  it('알림 도중의 dispatch 는 상태에 곧바로 반영되지만 알림은 순서대로 쌓여, 모든 구독이 같은 순서의 상태를 받는다', () => {
    const controller = createKioskController({}, INIT);
    const one: KioskState[] = [];
    const two: KioskState[] = [];
    let chained = false;
    controller.subscribe((state) => {
      one.push(state);
      if (!chained && state.screen === 'K01_Generation') {
        chained = true;
        controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN4_C4' });
        expect(controller.getState().inputs.generation).toBe('GEN4_C4');
        expect(two).toEqual([]);
      }
    });
    controller.subscribe((state) => two.push(state));
    controller.dispatch({ type: 'START' });
    expect(one.map((state) => state.inputs.generation)).toEqual([null, 'GEN4_C4']);
    expect(two.map((state) => state.inputs.generation)).toEqual([null, 'GEN4_C4']);
  });

  it('select 는 현재 상태와 지금 시각으로 값을 읽는다', () => {
    const controller = createKioskController({ now: () => 4_321 }, INIT);
    expect(controller.select((state, now) => [state.screen, now])).toEqual(['K00_Start', 4_321]);
  });
});

describe('dispose', () => {
  it('걸려 있는 타이머를 풀고 구독을 모두 지운다. 이후 사건은 받지 않는다', () => {
    const controller = createKioskController({}, INIT);
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.dispatch({ type: 'START' });
    expect(vi.getTimerCount()).toBe(1);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' })).toBe('IGNORED');
    vi.advanceTimersByTime(1_000_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getState().screen).toBe('K01_Generation');
  });

  it('타이머가 없을 때의 dispose 도 안전하다', () => {
    const controller = createKioskController({}, INIT);
    controller.dispose();
    expect(controller.dispatch({ type: 'START' })).toBe('IGNORED');
  });
});

describe('의존성 주입: 시계·타이머·세션 식별자', () => {
  interface Fake {
    clock: { now: number };
    scheduled: Array<{ handle: number; delay: number; callback: () => void; cleared: boolean }>;
  }

  function fakeScheduler(): { fake: Fake; deps: { now: () => number; setTimeout: (callback: () => void, ms: number) => number; clearTimeout: (handle: number) => void } } {
    const fake: Fake = { clock: { now: 1_000 }, scheduled: [] };
    return {
      fake,
      deps: {
        now: () => fake.clock.now,
        setTimeout: (callback, ms) => {
          const handle = fake.scheduled.length + 1;
          fake.scheduled.push({ handle, delay: ms, callback, cleared: false });
          return handle;
        },
        clearTimeout: (handle) => {
          const entry = fake.scheduled.find((candidate) => candidate.handle === handle);
          if (entry) entry.cleared = true;
        },
      },
    };
  }

  it('주입한 setTimeout/clearTimeout/now 만 쓴다: 지연은 (일정 시각 - 지금), 새 일정이 오면 이전 핸들을 푼다', () => {
    const { fake, deps } = fakeScheduler();
    const controller = createKioskController({ ...deps, newSessionId: sequenceIds('INJECTED') }, INIT);
    expect(fake.scheduled).toEqual([]);
    controller.dispatch({ type: 'START' });
    expect(fake.scheduled.map((entry) => entry.delay)).toEqual([100_000]);
    fake.clock.now = 11_000;
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' });
    expect(fake.scheduled.map((entry) => [entry.delay, entry.cleared])).toEqual([
      [100_000, true],
      [100_000, false],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('타이머가 제때 돌면 경고 → 초기화 순으로 일정이 이어진다 (주입한 타이머 콜백을 직접 부른다)', () => {
    const { fake, deps } = fakeScheduler();
    const controller = createKioskController({ ...deps, newSessionId: sequenceIds('INJECTED') }, INIT);
    controller.dispatch({ type: 'START' });
    fake.clock.now = 1_000 + 100_000;
    fake.scheduled[0]?.callback();
    expect(controller.getState().overlay.kind).toBe('TIMEOUT_DIALOG');
    expect(fake.scheduled[1]?.delay).toBe(20_000);
    fake.clock.now = 1_000 + 120_000;
    fake.scheduled[1]?.callback();
    expect(controller.getState().screen).toBe('K00_Start');
    // INJECTED-1 은 초기 세션, INJECTED-2 는 "시작하기"의 새 세션, 초기화가 INJECTED-3 을 발급한다
    expect(controller.getState().sessionId).toBe('INJECTED-3');
    expect(fake.scheduled).toHaveLength(2);
  });

  it('타이머가 일정보다 일찍 돌면 상태를 바꾸지 않고 남은 시간만큼 다시 건다', () => {
    const { fake, deps } = fakeScheduler();
    const controller = createKioskController(deps, INIT);
    controller.dispatch({ type: 'START' });
    fake.clock.now = 1_000 + 99_000;
    const before = controller.getState();
    fake.scheduled[0]?.callback();
    expect(controller.getState()).toBe(before);
    expect(fake.scheduled.map((entry) => entry.delay)).toEqual([100_000, 1_000]);
  });

  it('타이머가 많이 늦게 돌아도(경고와 초기화 시각이 모두 지남) 겹침창이 깜박이지 않고 한 번에 초기화된다', () => {
    const { fake, deps } = fakeScheduler();
    const controller = createKioskController({ ...deps, newSessionId: sequenceIds('LATE') }, INIT);
    controller.dispatch({ type: 'START' });
    const seen: KioskState[] = [];
    controller.subscribe((state) => seen.push(state));
    fake.clock.now = 1_000 + 500_000;
    fake.scheduled[0]?.callback();
    expect(seen.map((state) => [state.screen, state.overlay.kind])).toEqual([['K00_Start', 'NONE']]);
  });

  it('주입하지 않으면 전역 setTimeout/clearTimeout 을 부를 때마다 찾아 쓴다 (가짜 시계가 나중에 들어와도 잡힌다)', () => {
    const controller = createKioskController({}, INIT);
    const set = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    controller.dispatch({ type: 'START' });
    expect(set).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN1_AS' });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(2);
    set.mockRestore();
    clear.mockRestore();
  });

  it('시계의 기본값은 성능 시계(performance.now)다: 가짜 시계를 따라간다', () => {
    const controller = createKioskController({}, INIT);
    vi.advanceTimersByTime(5_000);
    controller.dispatch({ type: 'START' });
    expect(controller.getState().lastInteractionAt).toBe(performance.now());
    expect(controller.getState().lastInteractionAt).toBeGreaterThanOrEqual(5_000);
  });

  it('세션 식별자 발급기의 기본값은 crypto.randomUUID 다: 형식이 UUID 이고 초기화마다 다르다', () => {
    const controller = createKioskController({}, INIT);
    const first = controller.getState().sessionId;
    controller.dispatch({ type: 'PAGE_RESTORED' });
    const second = controller.getState().sessionId;
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });
});

describe('createKioskControllerFromState: 상태를 직접 구성해 시작한다 (시험·화면 조립용, 저장이나 복원이 아니다)', () => {
  it('주어진 상태에서 시작하고 그 상태에 맞는 타이머를 건다', () => {
    const env = makeEnv(performance.now());
    const state = stateAt('K03_Treatments', { inputs: FULL_INPUTS }, { env });
    const controller = createKioskControllerFromState({}, state);
    expect(controller.getState()).toBe(state);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('K00_Start 에서 시작하면 타이머가 없다', () => {
    createKioskControllerFromState({}, stateAt('K00_Start'));
    expect(vi.getTimerCount()).toBe(0);
  });
});
