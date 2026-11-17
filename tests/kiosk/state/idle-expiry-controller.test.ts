import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKioskController } from '../../../src/app/kiosk/state/controller';
import type { KioskController } from '../../../src/app/kiosk/state/controller';
import type { AnalyticsEvent, ClientLogEntry } from '../../../src/app/kiosk/state/deps';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { selectLayout } from '../../../src/app/kiosk/state/display';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { DD10_SCREENS, makeCatalog, makeOptions, T_KIDNEY_SPRAY, T_XRAY } from '../../fixtures/kiosk/clinic.fixture';
import { markerIds } from '../../fixtures/kiosk/state.fixture';
import { MISMATCH_BODY, REPLIES, catalogBody, estimateOk, fakeTransport, optionsBody } from '../../fixtures/kiosk/transport.fixture';
import type { FakeTransport, PendingCall } from '../../fixtures/kiosk/transport.fixture';

// 타이머 콜백이 늦은 키오스크: 실제 컨트롤러에서 타이머 콜백과 주입한 시계를 따로 움직인다 (design.md DD-07 규칙 4, DD-09, DD-10, AC-015a·b·c·d·h·i·k, AC-016h·i·j·k, AC-020e·g).
// 가짜 시계(vi.useFakeTimers)는 시계와 타이머를 함께 흘려 보내서 "시계는 지났는데 콜백이 아직 안 돈" 상태를 만들 수 없다. 그래서 여기서는
//  - 시계(now)는 시험이 값을 직접 정하고,
//  - setTimeout 은 콜백을 기록만 해 두었다가 시험이 돌릴지 말지·언제 돌릴지를 정하고,
//  - 전송은 시험이 응답 시점을 정하는 대역(취소 신호를 따르지 않는다)이다.
// 만료는 TICK 이 돌았는지가 아니라 주입한 시계로 정해지고, 만료로 세션이 끝나면 효과 계층이 옛 요청·갱신을 취소로 다룬다(abort, 타이머 해제, 분석·로그의 CANCELLED).

const SECOND = 1_000;
// 무조작 타이머의 지연(경고 100초·초기화까지 20초 등)과 겹치지 않게 큰 값으로 둔다. 그래서 지연으로 타이머의 종류를 가릴 수 있다.
const REQUEST_MS = 777_000;
const REFRESH_MS = 888_000;

interface ManualTimer {
  readonly delay: number;
  readonly callback: () => void;
  active: boolean;
}

interface Rig {
  readonly controller: KioskController;
  readonly transport: FakeTransport;
  readonly timers: ManualTimer[];
  readonly logs: ClientLogEntry[];
  readonly analytics: AnalyticsEvent[];
  setNow(ms: number): void;
  sessionsIssued(): number;
  /** 풀리지 않았고 아직 돌지 않은 타이머. */
  pending(): ManualTimer[];
  /** 무조작 타이머 칸(컨트롤러는 하나만 건다). */
  idleTimer(): ManualTimer;
  timersWithDelay(delay: number): ManualTimer[];
  /** 타이머를 돌린다: 칸을 비우고 콜백을 부른다(진짜 타이머가 울릴 때와 같다). */
  fire(timer: ManualTimer): void;
  /** 이 시점 이후 알림으로 받은 상태. */
  watch(): KioskState[];
}

interface RigOptions {
  readonly completionHoldSeconds?: number | null;
  /** 취소 신호가 서지 않는다(AbortController.abort 가 아무 일도 하지 않는다). */
  readonly abortDoesNothing?: boolean;
}

let activeRig: Rig | null = null;

function rig(options: RigOptions = {}): Rig {
  let now = 0;
  let sessions = 0;
  const timers: ManualTimer[] = [];
  const transport = fakeTransport();
  const logs: ClientLogEntry[] = [];
  const analytics: AnalyticsEvent[] = [];
  const abort = vi.spyOn(AbortController.prototype, 'abort');
  if (options.abortDoesNothing === true) abort.mockImplementation(() => undefined);
  const controller = createKioskController(
    {
      now: () => now,
      setTimeout: (callback, delay) => {
        const timer: ManualTimer = { delay, callback, active: true };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (handle) => {
        (handle as ManualTimer).active = false;
      },
      newSessionId: () => {
        sessions += 1;
        return `NEW-${sessions}`;
      },
      newRequestId: markerIds('RID-TEST'),
      newRefreshId: markerIds('RFR-TEST'),
      transport: transport.transport,
      requestTimeoutMs: REQUEST_MS,
      refreshTimeoutMs: REFRESH_MS,
      log: (entry) => logs.push(entry),
      analytics: (event) => analytics.push(event),
    },
    { catalog: makeCatalog({ idlePolicy: { screens: DD10_SCREENS, completionHoldSeconds: options.completionHoldSeconds ?? null } }), options: makeOptions() },
  );
  const pending = (): ManualTimer[] => timers.filter((timer) => timer.active);
  const result: Rig = {
    controller,
    transport,
    timers,
    logs,
    analytics,
    setNow: (ms) => {
      now = ms;
    },
    sessionsIssued: () => sessions,
    pending,
    idleTimer: () => {
      const idle = pending().filter((timer) => timer.delay !== REQUEST_MS && timer.delay !== REFRESH_MS);
      expect(idle).toHaveLength(1);
      return idle[0] as ManualTimer;
    },
    timersWithDelay: (delay) => timers.filter((timer) => timer.delay === delay),
    fire: (timer) => {
      timer.active = false;
      timer.callback();
    },
    watch: () => {
      const seen: KioskState[] = [];
      controller.subscribe((state) => seen.push(state));
      return seen;
    },
  };
  activeRig = result;
  return result;
}

afterEach(() => {
  activeRig?.controller.dispose();
  activeRig = null;
  vi.restoreAllMocks();
});

/** 지연된 비동기 결말(전송 응답 -> 사건)이 모두 반영되도록 매크로태스크 하나를 기다린다. 컨트롤러 타이머는 주입한 것이라 진짜 setTimeout 이다. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const stateOf = (r: Rig): KioskState => r.controller.getState();
const send = (r: Rig, event: KioskEvent): void => {
  expect(r.controller.dispatch(event), JSON.stringify(event)).toBe('APPLIED');
};

/** 시작부터 4단계까지 (세대 2, 형태 NON_LIFE, 원인 UNKNOWN, 치료 둘). 모두 시각 0 에서 한다: 마지막 조작 시각이 0 이다. */
function toTreatments(r: Rig): void {
  for (const event of [
    { type: 'START' },
    { type: 'SELECT_GENERATION', code: 'GEN2_C1' },
    { type: 'NEXT' },
    { type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' },
    { type: 'NEXT' },
    { type: 'SELECT_CAUSE', code: 'UNKNOWN' },
    { type: 'NEXT' },
    { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY },
    { type: 'TOGGLE_TREATMENT', treatmentId: T_KIDNEY_SPRAY },
  ] as const) {
    send(r, event);
  }
}

/** 경고 시각(100초)에 무조작 타이머 콜백을 돌려 TimeoutDialog 를 연다. 초기화 시각(120초)용 타이머 칸은 돌리지 않고 남겨 둔다. */
function openWarning(r: Rig): void {
  r.setNow(100 * SECOND);
  r.fire(r.idleTimer());
  expect(stateOf(r).overlay).toEqual({ kind: 'TIMEOUT_DIALOG', openedAt: 100 * SECOND, resetAt: 120 * SECOND });
  expect(r.idleTimer().delay).toBe(20 * SECOND);
}

/** 계산 요청을 보내 계산 중인 세션을 만든다. */
function requesting(r: Rig): PendingCall {
  toTreatments(r);
  send(r, { type: 'REQUEST_ESTIMATE' });
  expect(stateOf(r).screen).toBe('Calculating');
  return r.transport.estimateCalls()[0] as PendingCall;
}

/** 409 로 갱신이 진행 중인 세션 (시각 0 에서 시작). */
async function refreshing(r: Rig): Promise<{ catalogCall: PendingCall; optionsCall: PendingCall }> {
  const call = requesting(r);
  call.respond(409, MISMATCH_BODY);
  await flush();
  expect(stateOf(r).refreshState).toBe('RUNNING');
  const [catalogCall, optionsCall] = r.transport.refreshCalls() as [PendingCall, PendingCall];
  return { catalogCall, optionsCall };
}

interface Observed {
  readonly before: KioskState;
  readonly seen: KioskState[];
}

/** 시험이 만료를 일으키는 동작(`trigger`)을 하고, 그 결과가 "옛 세션을 지우고 새 세션 K00_Start 를 연 것"인지 본다. 구독자 알림은 한 번, 새 세션 식별자는 한 번 발급된다. */
async function expectExpiry(r: Rig, trigger: () => void | Promise<void>): Promise<Observed> {
  const before = stateOf(r);
  const issued = r.sessionsIssued();
  const seen = r.watch();
  await trigger();
  const after = stateOf(r);
  expect(after.screen).toBe('K00_Start');
  expect(after.overlay).toEqual({ kind: 'NONE' });
  expect(after.sessionId).not.toBe(before.sessionId);
  expect(after.inputs).toEqual({ generation: null, insurerType: null, cause: null, treatmentIds: [] });
  expect(after.inputRevision).toBe(0);
  expect(after.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
  expect(after.display.largeText).toBe(false);
  expect(after.activeRequest).toBeNull();
  expect(after.activeRefresh).toBeNull();
  expect(after.refreshState).toBe('NONE');
  expect(after.clinic).toBe(before.clinic);
  expect(r.sessionsIssued()).toBe(issued + 1);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toBe(after);
  // 만료 뒤에는 어느 타이머도 남지 않는다: 무조작 칸은 K00_Start 에 일정이 없어 비고, 요청·갱신 시간 제한 타이머는 풀렸다.
  expect(r.pending()).toEqual([]);
  return { before, seen };
}

const outcomesOf = (r: Rig, type: 'ESTIMATE_OUTCOME' | 'REFRESH_OUTCOME'): string[] => r.analytics.flatMap((event) => (event.type === type ? [event.outcome] : []));

/** 시도 식별자는 요청 주소·헤더·본문·로그·분석 어디에도 실리지 않는다. */
function expectNoIdentifierLeak(r: Rig): void {
  const wire = r.transport.calls.map((call) => [call.url, call.init.headers, call.init.body]);
  expect(JSON.stringify([wire, r.logs, r.analytics])).not.toMatch(/RID-TEST|RFR-TEST/);
}

describe('검토자 재현 1~3: TICK 콜백이 늦었을 때 기한이 지난 세션이 되살아나지 않는다', () => {
  it('1) 열린 TimeoutDialog 의 초기화 TICK 을 돌리지 않고 시계만 120.001초로 옮긴 뒤 "계속 사용할게요" -> 연장되지 않고 새 세션 K00_Start', async () => {
    const r = rig();
    send(r, { type: 'START' });
    send(r, { type: 'SELECT_GENERATION', code: 'GEN2_C1' });
    expect(stateOf(r).screen).toBe('K01_Generation');
    openWarning(r);
    r.setNow(120_001);
    await expectExpiry(r, () => {
      expect(r.controller.dispatch({ type: 'CONTINUE_USING' })).toBe('APPLIED');
    });
    expectNoIdentifierLeak(r);
  });

  it('2) 경고·초기화 TICK 을 모두 돌리지 않고 시계만 120.001초로 옮긴 뒤 INTERACTION -> 옛 선택이 남지 않고 마지막 조작 시각도 이어지지 않는다', async () => {
    const r = rig();
    send(r, { type: 'START' });
    send(r, { type: 'SELECT_GENERATION', code: 'GEN2_C1' });
    expect(r.idleTimer().delay).toBe(100 * SECOND);
    r.setNow(120_001);
    const { before } = await expectExpiry(r, () => {
      expect(r.controller.dispatch({ type: 'INTERACTION' })).toBe('APPLIED');
    });
    expect(before.inputs.generation).toBe('GEN2_C1');
    expect(stateOf(r).lastInteractionAt).toBe(120_001);
  });

  it('3) 요청 시간 제한을 길게 두고 TimeoutDialog 를 연 뒤 초기화 TICK 없이 120.001초에 활성 요청의 200 응답이 도착 -> 결과가 새 세션에 쓰이지 않고 요청은 취소로 끝난다', async () => {
    const r = rig();
    const call = requesting(r);
    openWarning(r);
    r.setNow(120_001);
    await expectExpiry(r, async () => {
      call.respond(200, estimateOk('ESTIMATED'));
      await flush();
    });
    const state = stateOf(r);
    expect(state.derived.estimate).toBeNull();
    // 효과 계층: 응답 사건이 요청을 푼 것처럼 보이지만 실제로는 세션이 끝나 취소된 것이다.
    expect(call.init.signal.aborted).toBe(true);
    expect(r.timersWithDelay(REQUEST_MS).every((timer) => !timer.active)).toBe(true);
    expect(outcomesOf(r, 'ESTIMATE_OUTCOME')).toEqual(['CANCELLED']);
    expect(r.logs).toEqual([]);
    expect(r.transport.calls).toHaveLength(1);
    expectNoIdentifierLeak(r);
  });
});

describe('기한이 지난 뒤 도착한 계산 요청 결말: 새 세션에 쓰지 않고, 갱신을 시작하지 않고, 취소로 끝난다', () => {
  const ARRIVALS: readonly (readonly [string, (r: Rig, call: PendingCall) => void])[] = [
    ['200 정상 응답', (_r, call) => call.respond(200, estimateOk('ESTIMATED'))],
    ['200 보류 응답', (_r, call) => call.respond(200, estimateOk('ON_HOLD'))],
    ['409 VERSION_MISMATCH', (_r, call) => call.respond(REPLIES.mismatch.status, REPLIES.mismatch.body)],
    ['422 TREATMENT_NOT_PUBLISHED', (_r, call) => call.respond(REPLIES.notPublished.status, REPLIES.notPublished.body)],
    ['422 NO_TREATMENT_SELECTED', (_r, call) => call.respond(REPLIES.noTreatment.status, REPLIES.noTreatment.body)],
    ['500 서버 오류', (_r, call) => call.respond(REPLIES.serverError.status, REPLIES.serverError.body)],
    ['연결 실패', (_r, call) => call.fail()],
    ['요청 시간 제한 콜백', (r) => r.fire(r.timersWithDelay(REQUEST_MS)[0] as ManualTimer)],
  ];

  it.each(ARRIVALS)('%s', async (_name, arrive) => {
    const r = rig();
    const call = requesting(r);
    openWarning(r);
    r.setNow(120_001);
    await expectExpiry(r, async () => {
      arrive(r, call);
      await flush();
    });
    expect(r.transport.calls).toHaveLength(1);
    expect(r.transport.refreshCalls()).toEqual([]);
    expect(call.init.signal.aborted).toBe(true);
    expect(outcomesOf(r, 'ESTIMATE_OUTCOME')).toEqual(['CANCELLED']);
    expect(r.logs).toEqual([]);
    expect(r.timersWithDelay(REQUEST_MS).every((timer) => !timer.active)).toBe(true);
    expectNoIdentifierLeak(r);
  });

  it('겹침창 없이 늦은 TICK 앞에 도착한 409 도 같다 (기한을 정하는 것은 겹침창이 아니라 시계다)', async () => {
    const r = rig();
    const call = requesting(r);
    r.setNow(120_001);
    await expectExpiry(r, async () => {
      call.respond(REPLIES.mismatch.status, REPLIES.mismatch.body);
      await flush();
    });
    expect(r.transport.refreshCalls()).toEqual([]);
    expect(outcomesOf(r, 'ESTIMATE_OUTCOME')).toEqual(['CANCELLED']);
  });
});

describe('기한이 지난 뒤 도착한 자료 갱신 결말: 새 세션과 병원 자료에 쓰지 않고 취소로 끝난다', () => {
  const ARRIVALS: readonly (readonly [string, (r: Rig, calls: { catalogCall: PendingCall; optionsCall: PendingCall }) => void])[] = [
    [
      '두 GET 이 모두 200 (REFRESH_RESOLVED)',
      (_r, { catalogCall, optionsCall }) => {
        catalogCall.respond(200, catalogBody());
        optionsCall.respond(200, optionsBody());
      },
    ],
    ['한쪽 GET 의 연결 실패 (REFRESH_FAILED)', (_r, { catalogCall }) => catalogCall.fail()],
    ['갱신 시간 제한 콜백 (REFRESH_EXPIRED)', (r) => r.fire(r.timersWithDelay(REFRESH_MS)[0] as ManualTimer)],
  ];

  it.each(ARRIVALS)('%s', async (_name, arrive) => {
    const r = rig();
    const calls = await refreshing(r);
    openWarning(r);
    r.setNow(120_001);
    const { before } = await expectExpiry(r, async () => {
      arrive(r, calls);
      await flush();
    });
    // 새 카탈로그가 병원 자료에 반영되지 않았다.
    expect(stateOf(r).clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V1');
    expect(before.clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V1');
    expect(calls.catalogCall.init.signal.aborted).toBe(true);
    expect(calls.optionsCall.init.signal.aborted).toBe(true);
    expect(r.timersWithDelay(REFRESH_MS).every((timer) => !timer.active)).toBe(true);
    expect(outcomesOf(r, 'REFRESH_OUTCOME')).toEqual(['CANCELLED']);
    expect(r.logs.filter((entry) => entry.code.startsWith('REFRESH_'))).toEqual([]);
    expect(r.transport.refreshCalls()).toHaveLength(2);
    expectNoIdentifierLeak(r);
  });
});

describe('만료 뒤 늦게 오는 것들은 새 세션을 건드리지 못한다', () => {
  it('취소 신호가 서지 않는 전송이어도 옛 요청의 응답이 만료 뒤에 도착하면 새 세션은 그대로다 (요청 식별자 보호)', async () => {
    const r = rig({ abortDoesNothing: true });
    const call = requesting(r);
    r.setNow(120_001);
    await expectExpiry(r, () => {
      send(r, { type: 'INTERACTION' });
    });
    expect(call.init.signal.aborted).toBe(false);
    const fresh = stateOf(r);
    const seen = r.watch();
    const analyticsBefore = r.analytics.length;
    r.setNow(120_002);
    call.respond(200, estimateOk('ESTIMATED'));
    await flush();
    expect(stateOf(r)).toBe(fresh);
    expect(seen).toEqual([]);
    expect(r.analytics).toHaveLength(analyticsBefore);
    expect(r.transport.calls).toHaveLength(1);
  });

  it('취소 신호가 서지 않는 전송이어도 옛 갱신의 응답이 만료 뒤에 도착하면 병원 자료와 새 세션은 그대로다 (갱신 식별자 보호)', async () => {
    const r = rig({ abortDoesNothing: true });
    const calls = await refreshing(r);
    r.setNow(120_001);
    await expectExpiry(r, () => {
      send(r, { type: 'INTERACTION' });
    });
    const fresh = stateOf(r);
    const seen = r.watch();
    const analyticsBefore = r.analytics.length;
    r.setNow(120_002);
    calls.catalogCall.respond(200, catalogBody());
    calls.optionsCall.respond(200, optionsBody());
    await flush();
    expect(stateOf(r)).toBe(fresh);
    expect(fresh.clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V1');
    expect(seen).toEqual([]);
    expect(r.analytics).toHaveLength(analyticsBefore);
  });

  it('이미 풀린 옛 타이머 콜백(무조작·요청 시간 제한·갱신 시간 제한)을 늦게 돌려도 상태와 알림은 그대로다', async () => {
    const r = rig();
    await refreshing(r);
    openWarning(r);
    r.setNow(120_001);
    await expectExpiry(r, () => {
      send(r, { type: 'INTERACTION' });
    });
    const fresh = stateOf(r);
    const seen = r.watch();
    r.setNow(130 * SECOND);
    for (const timer of r.timers) timer.callback();
    expect(r.timersWithDelay(REQUEST_MS).length).toBeGreaterThan(0);
    expect(r.timersWithDelay(REFRESH_MS).length).toBeGreaterThan(0);
    expect(stateOf(r)).toBe(fresh);
    expect(seen).toEqual([]);
    expect(r.pending()).toEqual([]);
  });

  it('새 세션에서 옛 요청 식별자의 결말 사건을 직접 보내도 거절된다', async () => {
    const r = rig();
    const call = requesting(r);
    const oldRequestId = stateOf(r).activeRequest?.requestId as string;
    r.setNow(120_001);
    await expectExpiry(r, () => {
      send(r, { type: 'INTERACTION' });
    });
    expect(call.init.signal.aborted).toBe(true);
    expect(r.controller.dispatch({ type: 'ESTIMATE_RESPONDED', requestId: oldRequestId, status: 200, body: estimateOk() })).toBe('IGNORED');
    expect(r.controller.dispatch({ type: 'ESTIMATE_EXPIRED', requestId: oldRequestId })).toBe('IGNORED');
  });
});

describe('ORIENTATION_CHANGED 는 기기의 관찰이다', () => {
  it('만료를 일으킨 방향 변경이어도 새 세션은 새로 관찰한 방향을 가진다', async () => {
    const r = rig();
    toTreatments(r);
    send(r, { type: 'TOGGLE_LARGE_TEXT' });
    r.setNow(120_001);
    await expectExpiry(r, () => {
      expect(r.controller.dispatch({ type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' })).toBe('APPLIED');
    });
    expect(selectLayout(stateOf(r))).toEqual({ screen: 'K00_Start', orientation: 'LANDSCAPE', largeText: false });
  });
});

describe('기한 전에는 아무것도 달라지지 않는다 (회귀)', () => {
  it('초기화 시각 1ms 전의 "계속 사용할게요"는 세션을 이어 간다: 겹침창이 닫히고, 마지막 조작이 지금으로 바뀌고, 무조작 타이머는 새 경고 시각으로 다시 걸린다', () => {
    const r = rig();
    toTreatments(r);
    openWarning(r);
    r.setNow(120 * SECOND - 1);
    const before = stateOf(r);
    send(r, { type: 'CONTINUE_USING' });
    const after = stateOf(r);
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.screen).toBe('K03_Treatments');
    expect(after.overlay).toEqual({ kind: 'NONE' });
    expect(after.lastInteractionAt).toBe(120 * SECOND - 1);
    expect(after.inputs).toBe(before.inputs);
    expect(r.idleTimer().delay).toBe(100 * SECOND);
  });

  it('TimeoutDialog 아래에서 기한 전에 도착한 올바른 응답은 밑 화면에 곧바로 반영되고, 겹침창의 초기화 시각·마지막 조작 시각·무조작 타이머를 움직이지 않는다. 그 뒤 기한이 지나면 고정된 초기화 시각에 지운다', async () => {
    const r = rig();
    const call = requesting(r);
    openWarning(r);
    const resetTimer = r.idleTimer();
    r.setNow(110 * SECOND);
    call.respond(200, estimateOk('ESTIMATED'));
    await flush();
    const answered = stateOf(r);
    expect(answered.screen).toBe('K04_Result');
    expect(answered.derived.estimate?.state).toBe('ESTIMATED');
    expect(answered.overlay).toEqual({ kind: 'TIMEOUT_DIALOG', openedAt: 100 * SECOND, resetAt: 120 * SECOND });
    expect(answered.lastInteractionAt).toBe(0);
    expect(r.idleTimer()).toBe(resetTimer);
    expect(resetTimer.active).toBe(true);
    expect(outcomesOf(r, 'ESTIMATE_OUTCOME')).toEqual(['SUCCEEDED']);
    // 결과 화면의 정책은 180초이지만 열린 겹침창의 초기화 시각(120초)이 먼저다.
    r.setNow(120_001);
    await expectExpiry(r, () => {
      send(r, { type: 'TOGGLE_LARGE_TEXT' });
    });
  });

  it('기한 전의 409 는 갱신을 시작한다 (양성 대조)', async () => {
    const r = rig();
    await refreshing(r);
    expect(stateOf(r).activeRefresh).not.toBeNull();
    expect(r.transport.refreshCalls()).toHaveLength(2);
  });

  it('이용 완료 화면(K06_Complete): 자동 복귀 시간이 양수이면 시각이 지난 뒤의 사건도 만료가 아니고, 타이머가 울리면 K00_Start 로 돌아간다', async () => {
    const r = rig({ completionHoldSeconds: 30 });
    const call = requesting(r);
    call.respond(200, estimateOk('ESTIMATED'));
    await flush();
    r.setNow(1_000);
    send(r, { type: 'COMPLETE_USE' });
    expect(stateOf(r).screen).toBe('K06_Complete');
    const returnTimer = r.idleTimer();
    expect(returnTimer.delay).toBe(30 * SECOND);
    r.setNow(1_000 + 600 * SECOND);
    const session = stateOf(r).sessionId;
    send(r, { type: 'TOGGLE_LARGE_TEXT' });
    expect(stateOf(r).screen).toBe('K06_Complete');
    expect(stateOf(r).sessionId).toBe(session);
    expect(stateOf(r).display.largeText).toBe(true);
    r.fire(returnTimer);
    expect(stateOf(r).screen).toBe('K00_Start');
    expect(stateOf(r).sessionId).not.toBe(session);
  });

  it('이용 완료 화면(K06_Complete): 자동 복귀가 없으면(null) 아무리 늦은 사건도 만료가 아니고 타이머가 없다 (수동으로만 돌아간다)', async () => {
    const r = rig({ completionHoldSeconds: null });
    const call = requesting(r);
    call.respond(200, estimateOk('ESTIMATED'));
    await flush();
    r.setNow(1_000);
    send(r, { type: 'COMPLETE_USE' });
    expect(stateOf(r).screen).toBe('K06_Complete');
    expect(r.pending()).toEqual([]);
    r.setNow(1_000 + 100_000 * SECOND);
    send(r, { type: 'TOGGLE_LARGE_TEXT' });
    expect(stateOf(r).screen).toBe('K06_Complete');
    send(r, { type: 'BACK_TO_START' });
    expect(stateOf(r).screen).toBe('K00_Start');
  });

  it('시작 화면(K00_Start)은 타이머가 없고, 아주 늦은 "시작하기"도 평소대로 입력 단계를 연다', () => {
    const r = rig();
    expect(r.pending()).toEqual([]);
    r.setNow(100_000 * SECOND);
    send(r, { type: 'START' });
    expect(stateOf(r).screen).toBe('K01_Generation');
    expect(r.idleTimer().delay).toBe(100 * SECOND);
  });
});
