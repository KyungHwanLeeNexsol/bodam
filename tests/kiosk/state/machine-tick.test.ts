import { describe, expect, it } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { EVENT_SPECS, reduce } from '../../../src/app/kiosk/state/machine';
import type { KioskState, OverlayState } from '../../../src/app/kiosk/state/session-store';
import { SCREEN_STATES } from '../../../src/app/kiosk/state/session-store';
import { DD10_SCREENS, T_XRAY, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, resultSessionAt, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';

// 시계 사건(TICK)의 전이 규칙을 reduce 수준에서 본다 (design.md DD-07 전이표 "무조작 경고 시점"·"초기화 시점", DD-10, DD-13).
// 컨트롤러와 가짜 시계가 보는 것은 idle-timers.test.ts 다. 여기서는 시각을 직접 넣어 경계(정확히 그 시각, 직전, 많이 늦음)를 한 줄씩 본다.
// 마지막 조작은 1,000ms, 입력 단계는 100/120초, 결과 단계는 160/180초(DD-10 기본값)다.

const TOUCH = 1_000;
const tick = (state: KioskState, now: number): KioskState => reduce(state, { type: 'TICK' }, makeEnv(now, sequenceIds('NEW')));
const input = (patch: Partial<KioskState> = {}): KioskState => resultSessionAt('K03_Treatments', { lastInteractionAt: TOUCH, ...patch });
const dialog = (openedAt: number, resetAt: number): OverlayState => ({ kind: 'TIMEOUT_DIALOG', openedAt, resetAt });

describe('경고 시각: 마지막 조작 + 경고 시간', () => {
  it('정확히 그 시각에 TimeoutDialog 가 열린다. 초기화 시각은 마지막 조작 + 초기화 시간이고 선택·화면·마지막 조작 시각은 그대로다', () => {
    const state = input();
    const next = tick(state, TOUCH + 100_000);
    expect(next.overlay).toEqual(dialog(TOUCH + 100_000, TOUCH + 120_000));
    expect(next.screen).toBe('K03_Treatments');
    expect(next.inputs).toBe(state.inputs);
    expect(next.derived).toBe(state.derived);
    expect(next.sessionId).toBe(state.sessionId);
    expect(next.lastInteractionAt).toBe(TOUCH);
  });

  it('1ms 이르면 거절한다 (같은 상태 참조)', () => {
    const state = input();
    expect(tick(state, TOUCH + 100_000 - 1)).toBe(state);
  });

  it('늦게 열려도 초기화 시각은 마지막 조작에서 센 값이다: 열린 시각 + 20초가 아니다', () => {
    const next = tick(input(), TOUCH + 110_000);
    expect(next.overlay).toEqual(dialog(TOUCH + 110_000, TOUCH + 120_000));
  });

  it('경고와 초기화 시각이 모두 지났으면 겹침창 없이 한 번에 초기화한다: K00_Start, 새 sessionId, 선택·결과 삭제', () => {
    const next = tick(input(), TOUCH + 500_000);
    expect(next.screen).toBe('K00_Start');
    expect(next.overlay.kind).toBe('NONE');
    expect(next.sessionId).toBe('NEW-1');
    expect(next.inputs).toEqual({ generation: null, insurerType: null, cause: null, treatmentIds: [] });
    expect(next.derived.estimate).toBeNull();
    expect(next.lastInteractionAt).toBe(TOUCH + 500_000);
  });

  it('정확히 초기화 시각이면 경고를 거치지 않고 초기화한다', () => {
    expect(tick(input(), TOUCH + 120_000).screen).toBe('K00_Start');
  });

  it('화면 종류별 임계값을 쓴다: 결과 화면은 160초, 병원 정책이 있으면 그 값이다', () => {
    const result = resultSessionAt('K04_Result', { lastInteractionAt: TOUCH });
    expect(tick(result, TOUCH + 159_999)).toBe(result);
    expect(tick(result, TOUCH + 160_000).overlay).toEqual(dialog(TOUCH + 160_000, TOUCH + 180_000));
    const custom = resultSessionAt('K02_Type', { lastInteractionAt: TOUCH }, { catalog: makeCatalog({ idlePolicy: { screens: { ...DD10_SCREENS, INPUT: { warnSeconds: 90, resetSeconds: 110 } }, completionHoldSeconds: null } }) });
    expect(tick(custom, TOUCH + 90_000).overlay).toEqual(dialog(TOUCH + 90_000, TOUCH + 110_000));
  });

  it('화면 종류가 바뀌어도 경과 시간은 마지막 조작부터 계속 센다: 임계값만 새 화면 종류의 값이다 (DD-07 규칙 4)', () => {
    // 입력 단계(100초)였던 세션이 서버 응답으로 결과 화면이 되었다고 보고, 마지막 조작은 그대로 TOUCH 다.
    const state = resultSessionAt('K04_Result', { lastInteractionAt: TOUCH });
    expect(tick(state, TOUCH + 100_000)).toBe(state);
  });
});

describe('겹침창과 시계', () => {
  it('ResetConfirm 이 열려 있어도 경고 시각에는 TimeoutDialog 가 ResetConfirm 을 대신한다. 초기화 시각은 늦춰지지 않는다', () => {
    const next = tick(input({ overlay: { kind: 'RESET_CONFIRM' } }), TOUCH + 100_000);
    expect(next.overlay).toEqual(dialog(TOUCH + 100_000, TOUCH + 120_000));
  });

  it('ResetConfirm 이 열려 있는 동안 경고 전의 시계 사건은 거절한다', () => {
    const state = input({ overlay: { kind: 'RESET_CONFIRM' } });
    expect(tick(state, TOUCH + 99_999)).toBe(state);
  });

  it('열린 TimeoutDialog 는 정해 둔 초기화 시각에 초기화한다: 마지막 조작이나 화면 종류가 달라도 움직이지 않는다', () => {
    const state = input({ overlay: dialog(TOUCH + 100_000, TOUCH + 120_000), lastInteractionAt: TOUCH + 50_000 });
    expect(tick(state, TOUCH + 119_999)).toBe(state);
    const next = tick(state, TOUCH + 120_000);
    expect(next.screen).toBe('K00_Start');
    expect(next.overlay.kind).toBe('NONE');
  });
});

describe('무조작 타이머가 없는 화면', () => {
  it('K00_Start 의 시계 사건은 거절한다', () => {
    const state = stateAt('K00_Start', { lastInteractionAt: TOUCH });
    expect(tick(state, TOUCH + 10_000_000)).toBe(state);
  });

  it('K06_Complete: 병원이 정한 시간이 지나면 K00_Start, 정하지 않았으면(null) 아무리 지나도 거절한다 — 10초 같은 값으로 바꿔 쓰지 않는다 (DD-13)', () => {
    const hold = (completionHoldSeconds: number | null) =>
      stateAt('K06_Complete', { sessionStartedAt: 10_000 }, { catalog: makeCatalog({ idlePolicy: { screens: { ...DD10_SCREENS }, completionHoldSeconds } }) });
    const timed = hold(25);
    expect(tick(timed, 10_000 + 24_999)).toBe(timed);
    const back = tick(timed, 10_000 + 25_000);
    expect(back.screen).toBe('K00_Start');
    expect(back.sessionId).toBe('NEW-1');
    const manual = hold(null);
    expect(tick(manual, 10_000 + 10_000)).toBe(manual);
    expect(tick(manual, 10_000 + 10_000_000)).toBe(manual);
  });
});

// 전이 함수는 받은 상태를 고치지 않는다: 깊이 얼린 상태에 모든 사건을 모든 화면·겹침창에서 보내도 예외가 나지 않는다
// (엄격 모드에서 얼린 객체를 고치면 TypeError). 컨트롤러는 이전 상태를 구독자·시험이 그대로 쥐고 있다고 가정한다.
describe('불변성', () => {
  function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
  }

  const EVENTS: KioskEvent[] = [
    { type: 'START' },
    { type: 'SELECT_GENERATION', code: 'GEN4_C4' },
    { type: 'SELECT_INSURER_TYPE', code: 'LIFE' },
    { type: 'SELECT_CAUSE', code: 'UNKNOWN' },
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
    { type: 'REQUEST_HOME' },
    { type: 'CONFIRM_RESET' },
    { type: 'CANCEL_RESET' },
    { type: 'CONTINUE_USING' },
    { type: 'COMPLETE_USE' },
    { type: 'BACK_TO_START' },
    { type: 'TOGGLE_LARGE_TEXT' },
    { type: 'INTERACTION' },
    { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' },
    { type: 'PAGE_RESTORED' },
    { type: 'TICK' },
    { type: 'REQUEST_ESTIMATE' },
    { type: 'ESTIMATE_RESPONDED', requestId: 'RID-FREEZE-0001', status: 200, body: {} },
    { type: 'ESTIMATE_FAILED', requestId: 'RID-FREEZE-0001' },
    { type: 'ESTIMATE_EXPIRED', requestId: 'RID-FREEZE-0001' },
    { type: 'RETRY_REFRESH' },
    { type: 'REFRESH_RESOLVED', refreshId: 'RFR-FREEZE-0001', catalog: {}, options: {} },
    { type: 'REFRESH_FAILED', refreshId: 'RFR-FREEZE-0001' },
    { type: 'REFRESH_EXPIRED', refreshId: 'RFR-FREEZE-0001' },
  ];
  const OVERLAYS: OverlayState[] = [{ kind: 'NONE' }, { kind: 'RESET_CONFIRM' }, dialog(TOUCH + 100_000, TOUCH + 120_000)];

  it('사건 목록이 EVENT_SPECS 의 모든 사건 종류를 다룬다 (빈 구멍 방지)', () => {
    expect(EVENTS.map((event) => event.type).sort()).toEqual(Object.keys(EVENT_SPECS).sort());
  });

  it('모든 화면 × 겹침창 × 사건에서 받은 상태를 고치지 않는다', () => {
    const env = makeEnv(TOUCH + 1_000_000, sequenceIds('NEW'));
    for (const screen of SCREEN_STATES) {
      for (const overlay of OVERLAYS) {
        const state = deepFreeze(resultSessionAt(screen, { overlay, inputs: FULL_INPUTS, lastInteractionAt: TOUCH, derived: { estimate: { state: 'ESTIMATED' }, documents: null, basis: null, returnContext: { resultVariant: 'NORMAL' } } }));
        for (const event of EVENTS) expect(() => reduce(state, event, env), `${screen} ${overlay.kind} ${event.type}`).not.toThrow();
      }
    }
  });
});
