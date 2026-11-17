import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKioskController, createKioskControllerFromState } from '../../../src/app/kiosk/state/controller';
import { MAX_TIMER_DELAY_MS } from '../../../src/app/kiosk/state/deps';
import { DD10_SCREENS, makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';
import { REPLIES, fakeTransport, goToTreatments } from '../../fixtures/kiosk/transport.fixture';
import type { Kiosk } from '../../fixtures/kiosk/transport.fixture';

// 타이머 지연의 상한 (setTimeout 은 2^31-1 ms 를 넘는 지연을 1 ms 로 줄여 바로 울린다): 모든 타이머 지연은 이 상한 아래로 줄여 건다.
// 무조작 일정은 일찍 울리면 TICK 이 거절되고 남은 시간으로 다시 걸리는 길(controller.test.ts)이 있어서, 상한으로 줄여도 제 시각에 수렴한다.
// 키오스크의 정확한 시각 값(DD-10 표, 병원 정책)은 바꾸지 않는다.

const MAX = 2_147_483_647;
const SECOND = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 건 타이머의 지연을 모두 기록하는 setTimeout 대역(실제 타이머는 가짜 시계로 넘긴다). */
function recorder(): { delays: number[]; setTimeout: (callback: () => void, delayMs: number) => unknown } {
  const delays: number[] = [];
  return {
    delays,
    setTimeout: (callback, delayMs) => {
      delays.push(delayMs);
      return setTimeout(callback, delayMs);
    },
  };
}

const hugeInput = (warn: number, reset: number) => makeCatalog({ idlePolicy: { screens: { ...DD10_SCREENS, INPUT: { warnSeconds: warn, resetSeconds: reset } }, completionHoldSeconds: null } });

describe('상한', () => {
  it('상한 값은 2^31-1 이다', () => {
    expect(MAX_TIMER_DELAY_MS).toBe(MAX);
  });
});

describe('무조작 타이머', () => {
  it('경고 시간이 상한을 넘으면 지연을 상한으로 줄여 걸고, 바쁜 반복 없이 제 시각에 경고와 초기화가 일어난다', async () => {
    const { delays, setTimeout: record } = recorder();
    const warn = 3_000_000; // 초 -> 3,000,000,000 ms > 2^31-1
    const state = stateAt('K03_Treatments', { inputs: FULL_INPUTS }, { catalog: hugeInput(warn, warn + 20), env: makeEnv(performance.now()) });
    const controller = createKioskControllerFromState({ setTimeout: record, newSessionId: sequenceIds('NEW') }, state);
    expect(delays).toEqual([MAX]);
    expect(vi.getTimerCount()).toBe(1);

    // 10 초 동안 타이머를 다시 걸지 않는다 (1 ms 로 줄어 바로 울렸다면 수천 번 다시 걸린다)
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(delays).toEqual([MAX]);
    expect(vi.getTimerCount()).toBe(1);

    // 상한 단위로 시계를 보낸다: 상한 지점에서 TICK 이 일찍이라 거절되고 남은 시간으로 다시 걸린다
    await vi.advanceTimersByTimeAsync(MAX - 10 * SECOND);
    expect(controller.getState().overlay.kind).toBe('NONE');
    expect(delays).toEqual([MAX, warn * SECOND - MAX]);
    expect(delays.every((delay) => delay <= MAX)).toBe(true);
    const warnAt = state.lastInteractionAt + warn * SECOND;
    await vi.advanceTimersByTimeAsync(warnAt - performance.now() - 1);
    expect(controller.getState().overlay.kind).toBe('NONE');
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().overlay.kind).toBe('TIMEOUT_DIALOG');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(20 * SECOND - 1);
    expect(controller.getState().screen).toBe('K03_Treatments');
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().screen).toBe('K00_Start');
    expect(vi.getTimerCount()).toBe(0);
    expect(delays.length).toBeLessThanOrEqual(4);
    controller.dispose();
  });

  it('이용 완료 화면의 자동 복귀(completionHoldSeconds)가 상한을 넘어도 같다', async () => {
    const { delays, setTimeout: record } = recorder();
    const hold = 3_000_000;
    const catalog = makeCatalog({ idlePolicy: { screens: { ...DD10_SCREENS }, completionHoldSeconds: hold } });
    const state = stateAt('K06_Complete', { sessionStartedAt: performance.now() }, { catalog, env: makeEnv(performance.now()) });
    const controller = createKioskControllerFromState({ setTimeout: record, newSessionId: sequenceIds('NEW') }, state);
    expect(delays).toEqual([MAX]);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(delays).toEqual([MAX]);
    await vi.advanceTimersByTimeAsync(hold * SECOND - 10 * SECOND - 1);
    expect(controller.getState().screen).toBe('K06_Complete');
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().screen).toBe('K00_Start');
    controller.dispose();
  });

  it('상한 이하의 지연은 줄이지 않는다 (DD-10 기본값: 입력 단계 경고 100초)', () => {
    const { delays, setTimeout: record } = recorder();
    const controller = createKioskController({ setTimeout: record }, { catalog: makeCatalog(), options: makeOptions() });
    controller.dispatch({ type: 'START' });
    expect(delays).toEqual([100 * SECOND]);
    controller.dispose();
  });
});

describe('요청·갱신 시간 제한 타이머', () => {
  it('주입한 시간 제한이 상한을 넘어도 지연은 상한으로 줄이고, 바로 만료되지 않는다', async () => {
    const { delays, setTimeout: record } = recorder();
    const transport = fakeTransport();
    const huge = 3_000_000_000;
    const controller = createKioskController(
      { setTimeout: record, transport: transport.transport, requestTimeoutMs: huge, refreshTimeoutMs: huge, newSessionId: sequenceIds('NEW') },
      { catalog: makeCatalog(), options: makeOptions() },
    );
    goToTreatments({ controller } as Kiosk);
    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    expect(delays).toContain(MAX);
    expect(delays.every((delay) => delay <= MAX)).toBe(true);
    const requestDelays = delays.length;
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(controller.getState().screen).toBe('Calculating');

    // 409 -> 갱신도 같은 상한을 쓴다
    transport.estimateCalls()[0]!.respond(REPLIES.mismatch.status, REPLIES.mismatch.body);
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().refreshState).toBe('RUNNING');
    expect(delays.length).toBeGreaterThan(requestDelays);
    expect(delays.every((delay) => delay <= MAX)).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(controller.getState().refreshState).toBe('RUNNING');
    controller.dispose();
  });
});
