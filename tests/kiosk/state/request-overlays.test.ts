import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { selectTimeoutDialog } from '../../../src/app/kiosk/state/idle';
import type { KioskState, OverlayKind, RefreshReason, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { REPLIES, goToTreatments, startKiosk } from '../../fixtures/kiosk/transport.fixture';
import type { Kiosk, KioskOptions, PendingCall, Reply } from '../../fixtures/kiosk/transport.fixture';

// 겹침창이 열려 있는 동안 도착하는 요청 결말 (design.md DD-07 "겹침창이 열려 있는 동안 도착하는 요청 결말" 표 1과 규칙 1~5).
// 증거: AC-015l, AC-015m, AC-015n, AC-015o, AC-015p (unit 부분. e2e 는 M6). 가짜 시계, 전송 대역, 표지 발급기.
// 무조작 정책은 Calculating 이 경고 100초·초기화 120초(DD-10 잠정 값)다. 요청 시간 제한은 시험마다 주입한다(기본 시험은 길게 해 만료가 끼어들지 않게 한다).

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SECOND = 1_000;
const LONG = { requestTimeoutMs: 500 * SECOND };
type Overlay = Exclude<OverlayKind, 'NONE'>;

const stateOf = (kiosk: Kiosk): KioskState => kiosk.controller.getState();
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const screens = (history: KioskState[]): string[] => history.map((state) => state.screen);

interface Scene {
  readonly kiosk: Kiosk;
  readonly call: PendingCall;
  readonly requestId: string;
  /** 알림마다 받은 상태 (겹침창이 열린 뒤부터). */
  readonly history: KioskState[];
}

/** 계산 중(Calculating)인 세션 위에 겹침창을 연다. ResetConfirm 은 "처음으로"로, TimeoutDialog 는 경고 시각(100초)까지 기다려서 연다. */
async function openOver(overlay: Overlay, options: KioskOptions = LONG): Promise<Scene> {
  const kiosk = startKiosk(options);
  goToTreatments(kiosk);
  kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
  const call = kiosk.transport.calls[0] as PendingCall;
  const requestId = stateOf(kiosk).activeRequest?.requestId as string;
  if (overlay === 'RESET_CONFIRM') kiosk.controller.dispatch({ type: 'REQUEST_HOME' });
  else await vi.advanceTimersByTimeAsync(100 * SECOND);
  expect(stateOf(kiosk).overlay.kind).toBe(overlay);
  expect(stateOf(kiosk).screen).toBe('Calculating');
  const history: KioskState[] = [];
  kiosk.controller.subscribe((state) => history.push(state));
  return { kiosk, call, requestId, history };
}

const dismiss = (scene: Scene, overlay: Overlay): void => {
  scene.kiosk.controller.dispatch({ type: overlay === 'RESET_CONFIRM' ? 'CANCEL_RESET' : 'CONTINUE_USING' });
};

interface Outcome {
  readonly name: string;
  readonly screen: ScreenState;
  /** 409·422 TREATMENT_NOT_PUBLISHED 는 같은 전이에서 갱신을 시작한다. */
  readonly refresh: RefreshReason | null;
  readonly estimateState: string | null;
  readonly arrive: (scene: Scene) => Promise<void>;
}

const respondWith = (name: string, reply: Reply, screen: ScreenState, refresh: RefreshReason | null = null, estimateState: string | null = null): Outcome => ({
  name,
  screen,
  refresh,
  estimateState,
  arrive: async (scene) => {
    scene.call.respond(reply.status, reply.body);
    await flush();
  },
});

const OUTCOMES: Outcome[] = [
  respondWith('200 ESTIMATED', REPLIES.ok('ESTIMATED'), 'K04_Result', null, 'ESTIMATED'),
  respondWith('200 ESTIMATED_WITH_EXCLUSIONS', REPLIES.ok('ESTIMATED_WITH_EXCLUSIONS'), 'K04_Result_NotCovered', null, 'ESTIMATED_WITH_EXCLUSIONS'),
  respondWith('200 ON_HOLD', REPLIES.ok('ON_HOLD'), 'K04_Result_Hold', null, 'ON_HOLD'),
  respondWith('409 VERSION_MISMATCH', REPLIES.mismatch, 'K03_Treatments', 'VERSION_MISMATCH'),
  respondWith('422 TREATMENT_NOT_PUBLISHED', REPLIES.notPublished, 'K03_Treatments', 'TREATMENT_NOT_PUBLISHED'),
  respondWith('422 NO_TREATMENT_SELECTED', REPLIES.noTreatment, 'K03_Treatments'),
  respondWith('422 UNSUPPORTED_GENERATION', REPLIES.unsupportedGeneration, 'KXX_Error_Network'),
  respondWith('400', REPLIES.badRequest, 'KXX_Error_Network'),
  respondWith('5xx', REPLIES.serverError, 'KXX_Error_Network'),
  { name: '연결 실패', screen: 'KXX_Error_Network', refresh: null, estimateState: null, arrive: async (scene) => { scene.call.fail(); await flush(); } },
  {
    name: '요청 시간 제한 도달 (EXPIRED)',
    screen: 'KXX_Error_Network',
    refresh: null,
    estimateState: null,
    arrive: async (scene) => {
      // 시간 제한 타이머의 콜백이 돌았을 때와 같다 (시간 제한을 실제로 흘려 보내는 시험은 AC-015p 절이 한다)
      scene.kiosk.controller.dispatch({ type: 'ESTIMATE_EXPIRED', requestId: scene.requestId });
    },
  },
];

const OVERLAYS: Overlay[] = ['RESET_CONFIRM', 'TIMEOUT_DIALOG'];
const MATRIX = OVERLAYS.flatMap((overlay) => OUTCOMES.map((outcome) => [overlay, outcome.name, outcome] as const));

describe('표 1: 겹침창이 열려 있는 동안 활성 요청의 결말이 도착한다 (AC-015l·AC-015n·AC-015o 의 도착 순서 (가): 닫기 전)', () => {
  it.each(MATRIX)('%s 위에서 %s 가 도착하면 밑 화면에 곧바로 반영되고 겹침창은 열린 채 그대로다', async (overlay, _name, outcome) => {
    const scene = await openOver(overlay);
    const { kiosk } = scene;
    const before = stateOf(kiosk);
    const dialogBefore = selectTimeoutDialog(before, performance.now());

    await outcome.arrive(scene);

    const state = stateOf(kiosk);
    // 도착한 순간 밑 화면 상태가 이미 바뀌어 있다
    expect(state.screen).toBe(outcome.screen);
    expect(state.activeRefresh?.reason ?? null).toBe(outcome.refresh);
    expect(state.refreshState).toBe(outcome.refresh === null ? 'NONE' : 'RUNNING');
    expect(state.derived.estimate?.state ?? null).toBe(outcome.estimateState);
    expect(state.activeRequest).toBeNull();
    // 겹침창은 자동으로 닫히거나 확인되지 않는다. 열린 TimeoutDialog 의 초기화 시각은 움직이지 않는다
    expect(state.overlay).toEqual(before.overlay);
    if (overlay === 'TIMEOUT_DIALOG') expect(selectTimeoutDialog(state, performance.now())).toEqual(dialogBefore);
    // 서버 결말은 무조작 시간을 다시 세지 않고, 선택·inputRevision·sessionId 는 그대로다
    expect(state.lastInteractionAt).toBe(before.lastInteractionAt);
    expect(state.inputs).toBe(before.inputs);
    expect(state.inputRevision).toBe(before.inputRevision);
    expect(state.sessionId).toBe(before.sessionId);
    // 요청 시간 제한 타이머는 풀렸고 무조작 타이머(와 갱신을 시작했다면 그 갱신의 시간 제한 타이머)만 남았다
    expect(vi.getTimerCount()).toBe(outcome.refresh === null ? 1 : 2);

    // 닫으면 Calculating 이 아니라 이미 반영된 화면이 드러난다
    dismiss(scene, overlay);
    const closed = stateOf(kiosk);
    expect(closed.overlay.kind).toBe('NONE');
    expect(closed.screen).toBe(outcome.screen);
    expect(closed.inputs).toBe(before.inputs);
    expect(closed.sessionId).toBe(before.sessionId);
    // 닫는 환자 조작만 무조작 시간을 다시 센다
    expect(closed.lastInteractionAt).toBe(performance.now());
    kiosk.dispose();
  });
});

describe('표 1: 도착 순서 (나): 환자가 겹침창을 먼저 닫고 나서 결말이 도착한다 — 끝 화면이 같다', () => {
  it.each(MATRIX)('%s 를 닫은 뒤 %s 가 도착하면', async (overlay, _name, outcome) => {
    const scene = await openOver(overlay);
    const { kiosk } = scene;
    const before = stateOf(kiosk);

    dismiss(scene, overlay);
    // 닫은 직후에는 아직 계산 중이다 (결말이 오기 전)
    expect(stateOf(kiosk).screen).toBe('Calculating');
    expect(stateOf(kiosk).activeRequest).not.toBeNull();
    const touched = stateOf(kiosk).lastInteractionAt;

    await outcome.arrive(scene);
    const state = stateOf(kiosk);
    expect(state.screen).toBe(outcome.screen);
    expect(state.activeRefresh?.reason ?? null).toBe(outcome.refresh);
    expect(state.refreshState).toBe(outcome.refresh === null ? 'NONE' : 'RUNNING');
    expect(state.derived.estimate?.state ?? null).toBe(outcome.estimateState);
    expect(state.overlay.kind).toBe('NONE');
    expect(state.lastInteractionAt).toBe(touched);
    expect(state.inputs).toBe(before.inputs);
    expect(state.inputRevision).toBe(before.inputRevision);
    expect(state.sessionId).toBe(before.sessionId);
    kiosk.dispose();
  });
});

describe('AC-015m: 초기화가 확정된 뒤에 활성이었던 요청의 결말이 도착하면 어느 것도 반영되지 않는다', () => {
  const WAYS: Array<[string, Overlay, (scene: Scene) => Promise<void>]> = [
    ['ResetConfirm 의 확인', 'RESET_CONFIRM', async (scene) => { scene.kiosk.controller.dispatch({ type: 'CONFIRM_RESET' }); }],
    ['TimeoutDialog 안의 처음으로', 'TIMEOUT_DIALOG', async (scene) => { scene.kiosk.controller.dispatch({ type: 'REQUEST_HOME' }); }],
    ['무조작 초기화 (TimeoutDialog 가 열린 채 초기화 시각 도달)', 'TIMEOUT_DIALOG', async () => { await vi.advanceTimersByTimeAsync(20 * SECOND); }],
  ];

  const LATE = (requestId: string): KioskEvent[] => [
    { type: 'ESTIMATE_RESPONDED', requestId, status: 409, body: REPLIES.mismatch.body },
    { type: 'ESTIMATE_RESPONDED', requestId, status: 422, body: REPLIES.notPublished.body },
    { type: 'ESTIMATE_RESPONDED', requestId, status: 500, body: REPLIES.serverError.body },
    { type: 'ESTIMATE_FAILED', requestId },
    { type: 'ESTIMATE_EXPIRED', requestId },
  ];

  it.each(WAYS)('%s 뒤: 200, 409, 그 밖의 오류, 시간 초과가 차례로 와도 새 세션의 K00_Start 가 그대로다 (abort() 가 아무 일도 하지 않아도 같다)', async (_name, overlay, way) => {
    const scene = await openOver(overlay, { ...LONG, abortDoesNothing: true });
    const { kiosk } = scene;
    const before = stateOf(kiosk);
    const callsBefore = kiosk.transport.calls.length;
    await way(scene);

    const reset = stateOf(kiosk);
    expect(reset.screen).toBe('K00_Start');
    expect(reset.overlay.kind).toBe('NONE');
    expect(reset.sessionId).not.toBe(before.sessionId);
    expect(reset.inputs).toEqual({ generation: null, insurerType: null, cause: null, treatmentIds: [] });
    expect(reset.activeRequest).toBeNull();
    expect(reset.activeRefresh).toBeNull();
    expect(reset.refreshState).toBe('NONE');

    scene.call.respond(200, REPLIES.ok().body);
    await flush();
    for (const event of LATE(scene.requestId)) expect(kiosk.controller.dispatch(event)).toBe('IGNORED');
    for (const callback of kiosk.requestTimerCallbacks) callback();

    expect(stateOf(kiosk)).toBe(reset);
    expect(screens(scene.history)).not.toContain('K06_Complete');
    expect(scene.history.at(-1)).toBe(reset);
    // 로딩 표시와 대기 타이머가 새 세션에 남지 않고, 갱신(다시 받기)도 시작되지 않았다
    expect(vi.getTimerCount()).toBe(0);
    expect(kiosk.transport.calls).toHaveLength(callsBefore);
    kiosk.dispose();
  });

  it.each(OVERLAYS)('반대 순서 (%s): 결말이 먼저 반영된 뒤 초기화하면 반영됐던 결과가 세션 삭제와 함께 지워진다', async (overlay) => {
    const scene = await openOver(overlay);
    await respondWith('200', REPLIES.ok(), 'K04_Result').arrive(scene);
    expect(stateOf(scene.kiosk).derived.estimate?.state).toBe('ESTIMATED');
    scene.kiosk.controller.dispatch({ type: 'REQUEST_HOME' });
    if (overlay === 'RESET_CONFIRM') scene.kiosk.controller.dispatch({ type: 'CONFIRM_RESET' });
    const state = stateOf(scene.kiosk);
    expect(state.screen).toBe('K00_Start');
    expect(state.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(vi.getTimerCount()).toBe(0);
    scene.kiosk.dispose();
  });
});

describe('AC-015n: Calculating 위의 TimeoutDialog 와 초기화 시점', () => {
  it('(1) 초기화 시점 전에 200 이 도착하면 밑 화면은 결과가 되지만 TimeoutDialog 는 열린 채이고 초기화 시각은 그대로다. 그 시각에 K00_Start 로 가서 결과가 지워진다', async () => {
    const scene = await openOver('TIMEOUT_DIALOG');
    const { kiosk } = scene;
    const opened = stateOf(kiosk).overlay;
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    await respondWith('200', REPLIES.ok(), 'K04_Result').arrive(scene);
    expect(stateOf(kiosk).screen).toBe('K04_Result');
    expect(stateOf(kiosk).overlay).toEqual(opened);
    expect(selectTimeoutDialog(stateOf(kiosk), performance.now())?.remainingMs).toBe(15 * SECOND);
    await vi.advanceTimersByTimeAsync(15 * SECOND - 1);
    expect(stateOf(kiosk).screen).toBe('K04_Result');
    await vi.advanceTimersByTimeAsync(1);
    const reset = stateOf(kiosk);
    expect(reset.screen).toBe('K00_Start');
    expect(reset.derived.estimate).toBeNull();
    expect(screens(scene.history)).not.toContain('K06_Complete');
    kiosk.dispose();
  });
});

describe('AC-015o: TimeoutDialog 의 "계속 사용할게요"와 결말', () => {
  it('결말이 먼저 도착한 경우: 계속 사용하면 Calculating 이 아니라 반영된 결과이고, 그 화면 종류의 임계값(160/180초)으로 다시 센다', async () => {
    const scene = await openOver('TIMEOUT_DIALOG');
    await respondWith('200', REPLIES.ok(), 'K04_Result').arrive(scene);
    dismiss(scene, 'TIMEOUT_DIALOG');
    expect(stateOf(scene.kiosk).screen).toBe('K04_Result');
    await vi.advanceTimersByTimeAsync(160 * SECOND - 1);
    expect(stateOf(scene.kiosk).overlay.kind).toBe('NONE');
    await vi.advanceTimersByTimeAsync(1);
    expect(stateOf(scene.kiosk).overlay.kind).toBe('TIMEOUT_DIALOG');
    scene.kiosk.dispose();
  });

  it('결말이 나중에 도착한 경우: 계속 사용한 뒤 Calculating 에서 정상 반영된다. 응답만으로는 무조작 시간이 다시 시작하지 않는다', async () => {
    const scene = await openOver('TIMEOUT_DIALOG');
    dismiss(scene, 'TIMEOUT_DIALOG');
    expect(stateOf(scene.kiosk).screen).toBe('Calculating');
    await vi.advanceTimersByTimeAsync(30 * SECOND);
    const touched = stateOf(scene.kiosk).lastInteractionAt;
    await respondWith('200', REPLIES.ok('ON_HOLD'), 'K04_Result_Hold').arrive(scene);
    expect(stateOf(scene.kiosk).screen).toBe('K04_Result_Hold');
    expect(stateOf(scene.kiosk).lastInteractionAt).toBe(touched);
    await vi.advanceTimersByTimeAsync(130 * SECOND - 1);
    expect(stateOf(scene.kiosk).overlay.kind).toBe('NONE');
    await vi.advanceTimersByTimeAsync(1);
    expect(stateOf(scene.kiosk).overlay.kind).toBe('TIMEOUT_DIALOG');
    scene.kiosk.dispose();
  });
});

describe('AC-015p: 요청 시간 제한과 무조작 경고 시간의 관계 (제한은 주입값이다)', () => {
  it('(가) 제한이 경고 시간(100초)보다 짧고 환자 조작이 없으면 TimeoutDialog 가 열리기 전에 만료된다', async () => {
    const kiosk = startKiosk({ requestTimeoutMs: 50 * SECOND });
    goToTreatments(kiosk);
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await vi.advanceTimersByTimeAsync(50 * SECOND);
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    expect(stateOf(kiosk).overlay.kind).toBe('NONE');
    expect(kiosk.abortCalls()).toBe(1);
    kiosk.dispose();
  });

  it('(가) 제한이 경고 시간보다 짧아도 ResetConfirm 은 환자 조작으로 열리므로 그 위에서 만료될 수 있다: 컨트롤러를 abort 하고 KXX_Error_Network 가 되며 ResetConfirm 은 열린 채이고 만료는 시간을 다시 세지 않는다', async () => {
    const scene = await openOver('RESET_CONFIRM', { requestTimeoutMs: 50 * SECOND });
    const { kiosk } = scene;
    const touched = stateOf(kiosk).lastInteractionAt;
    await vi.advanceTimersByTimeAsync(50 * SECOND);
    const state = stateOf(kiosk);
    expect(state.screen).toBe('KXX_Error_Network');
    expect(state.overlay.kind).toBe('RESET_CONFIRM');
    expect(state.activeRequest).toBeNull();
    expect(state.lastInteractionAt).toBe(touched);
    expect(kiosk.abortCalls()).toBe(1);
    expect(scene.call.init.signal.aborted).toBe(true);
    // 만료 뒤 늦게 온 응답은 버려진다
    scene.call.respond(200, REPLIES.ok().body);
    await flush();
    expect(stateOf(kiosk)).toBe(state);
    dismiss(scene, 'RESET_CONFIRM');
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    kiosk.dispose();
  });

  it.each([
    ['경고 시간 이상 (110초)', 110 * SECOND],
    ['경고 시간과 같다 (100초)', 100 * SECOND],
  ])('(나) 제한이 %s 이면 TimeoutDialog 가 열린 채 만료될 수 있다: 밑 화면이 KXX_Error_Network 가 되고 겹침창과 초기화 시각(120초)은 그대로다. 닫으면 KXX_Error_Network 가 보인다', async (_name, timeout) => {
    const kiosk = startKiosk({ requestTimeoutMs: timeout });
    goToTreatments(kiosk);
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    const call = kiosk.transport.calls[0] as PendingCall;
    const startedAt = performance.now();
    await vi.advanceTimersByTimeAsync(timeout);
    const state = stateOf(kiosk);
    expect(state.screen).toBe('KXX_Error_Network');
    expect(state.overlay).toMatchObject({ kind: 'TIMEOUT_DIALOG', resetAt: startedAt + 120 * SECOND });
    expect(kiosk.abortCalls()).toBe(1);
    call.respond(200, REPLIES.ok().body);
    await flush();
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    kiosk.controller.dispatch({ type: 'CONTINUE_USING' });
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    expect(stateOf(kiosk).overlay.kind).toBe('NONE');
    kiosk.dispose();
  });

  it('(나) 만료 뒤 초기화 시각에 도달하면 K00_Start 다', async () => {
    const kiosk = startKiosk({ requestTimeoutMs: 110 * SECOND });
    goToTreatments(kiosk);
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await vi.advanceTimersByTimeAsync(120 * SECOND);
    expect(stateOf(kiosk).screen).toBe('K00_Start');
    expect(vi.getTimerCount()).toBe(0);
    kiosk.dispose();
  });

  it('(다) 제한이 초기화 시간(120초) 이상이면 만료 전에 무조작 초기화가 먼저 와서 요청이 취소되고 제한은 쓰이지 않는다', async () => {
    const kiosk = startKiosk({ requestTimeoutMs: 130 * SECOND });
    goToTreatments(kiosk);
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await vi.advanceTimersByTimeAsync(120 * SECOND);
    expect(stateOf(kiosk).screen).toBe('K00_Start');
    expect(kiosk.abortCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(20 * SECOND);
    expect(kiosk.logs.filter((entry) => entry.code === 'ESTIMATE_EXPIRED')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    kiosk.dispose();
  });
});
