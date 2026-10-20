import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { settleRequest } from '../../../src/app/kiosk/state/request';
import { canRequestEstimate, selectIsLoading } from '../../../src/app/kiosk/state/selectors';
import type { KioskState, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { T_XRAY } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, stateAt } from '../../fixtures/kiosk/state.fixture';
import { REPLIES, REQUEST_TIMEOUT_MS, errorBody, goToTreatments, startKiosk } from '../../fixtures/kiosk/transport.fixture';
import type { Kiosk, PendingCall, Reply } from '../../fixtures/kiosk/transport.fixture';

// 계산 요청의 생명주기를 가짜 시계와 전송 대역 위에서 본다 (design.md DD-09 "요청 생명주기", DD-19 "키오스크의 응답 처리").
// 닫는 AC: AC-016h, AC-016i, AC-016j, AC-016k, AC-016l. 증거: AC-014a 의 요청 쪽, AC-013d 의 응답 처리 표.
// 겹침창이 열린 동안의 결말(DD-07 표 1)은 request-overlays.test.ts, 소스에 대한 정적 약속은 request-static.test.ts 가 본다.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const stateOf = (kiosk: Kiosk): KioskState => kiosk.controller.getState();
const requestIdOf = (kiosk: Kiosk): string => {
  const active = stateOf(kiosk).activeRequest;
  if (active === null) throw new Error('활성 요청이 없다');
  return active.requestId;
};

/** 4단계까지 가서 "예상 부담액 확인"을 누른다. 시도의 전송 호출을 돌려준다. */
function begin(kiosk: Kiosk): PendingCall {
  goToTreatments(kiosk);
  expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
  return kiosk.transport.calls[kiosk.transport.calls.length - 1] as PendingCall;
}

async function reply(call: PendingCall, answer: Reply): Promise<void> {
  call.respond(answer.status, answer.body);
  await flush();
}

describe('시작: "예상 부담액 확인"', () => {
  it('Calculating 으로 가고, 활성 요청이 기록되고, 요청이 한 번 나가고, 시간 제한 타이머가 정확히 하나 늘고, 로딩 표시가 켜진다', () => {
    const kiosk = startKiosk();
    goToTreatments(kiosk);
    const before = vi.getTimerCount();
    const sessionId = stateOf(kiosk).sessionId;
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    const state = stateOf(kiosk);
    expect(state.screen).toBe('Calculating');
    expect(state.activeRequest).toEqual({ requestId: 'RID-TEST-0001', sessionId, inputRevision: state.inputRevision });
    expect(kiosk.transport.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(before + 1);
    expect(selectIsLoading(state)).toBe(true);
    kiosk.dispose();
  });

  it('요청: 병원 slug 의 estimate 경로에 POST, 헤더는 content-type 하나, 본문은 여섯 필드가 이 순서로 (AC-016k 3)', () => {
    const kiosk = startKiosk();
    const call = begin(kiosk);
    expect(call.url).toBe('/api/clinics/test-fixture-clinic-1/estimate');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ 'content-type': 'application/json' });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(call.body())).toEqual(['catalogVersion', 'ruleBundleVersion', 'generation', 'insurerType', 'cause', 'treatmentIds']);
    expect(call.body()).toEqual({
      catalogVersion: 'TEST_FIXTURE_CATALOG_V1',
      ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1',
      generation: 'GEN2_C1',
      insurerType: 'NON_LIFE',
      cause: 'UNKNOWN',
      treatmentIds: [T_XRAY, 'TEST_FIXTURE_TREATMENT_3'],
    });
    kiosk.dispose();
  });

  it.each([
    ['치료가 없다', { inputs: { ...FULL_INPUTS, treatmentIds: [] } }],
    ['갱신이 진행 중이다', { refreshState: 'RUNNING' as const }],
    ['갱신이 실패해 있다', { refreshState: 'FAILED' as const }],
    ['원인이 없다', { inputs: { ...FULL_INPUTS, cause: null } }],
  ])('강제로 들어온 사건도 거절한다 — 요청을 보내지 않는다: %s', (_name, patch) => {
    const kiosk = startKiosk({ from: stateAt('K03_Treatments', { inputs: FULL_INPUTS, ...patch }, { env: makeEnv(performance.now()) }) });
    expect(canRequestEstimate(stateOf(kiosk))).toBe(false);
    const before = stateOf(kiosk);
    expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('IGNORED');
    expect(stateOf(kiosk)).toBe(before);
    expect(kiosk.transport.calls).toHaveLength(0);
    kiosk.dispose();
  });

  it('통신 오류 화면에서 갱신이 필요하지 않으면 "다시 시도"가 같은 입력으로 새 시도를 낸다 (DD-07 KXX_Error_Network 행)', async () => {
    const kiosk = startKiosk();
    const first = begin(kiosk);
    await reply(first, REPLIES.serverError);
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    const revision = stateOf(kiosk).inputRevision;
    expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
    expect(stateOf(kiosk).activeRequest).toMatchObject({ requestId: 'RID-TEST-0002', inputRevision: revision });
    expect(kiosk.transport.calls).toHaveLength(2);
    expect(kiosk.transport.calls[1]?.init.body).toBe(first.init.body);
    kiosk.dispose();
  });

  it('통신 오류 화면에서도 갱신이 필요하면 새 시도를 보내지 않는다 (DD-09 규칙 1)', () => {
    const kiosk = startKiosk({ from: stateAt('KXX_Error_Network', { inputs: FULL_INPUTS, refreshState: 'FAILED' }, { env: makeEnv(performance.now()) }) });
    expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('IGNORED');
    expect(kiosk.transport.calls).toHaveLength(0);
    kiosk.dispose();
  });
});

describe('결말에 따른 화면 (DD-19 클라이언트 처리 표)', () => {
  it.each([
    ['ESTIMATED', 'K04_Result'],
    ['ESTIMATED_WITH_EXCLUSIONS', 'K04_Result_NotCovered'],
    ['ON_HOLD', 'K04_Result_Hold'],
  ] as const)('200 %s -> %s: 결과와 서류가 저장되고 선택·inputRevision·마지막 조작 시각은 그대로다', async (resultState, screen) => {
    const kiosk = startKiosk();
    const call = begin(kiosk);
    const before = stateOf(kiosk);
    await reply(call, REPLIES.ok(resultState));
    const state = stateOf(kiosk);
    expect(state.screen).toBe(screen);
    expect(state.derived.estimate?.state).toBe(resultState);
    expect(state.derived.estimate?.response?.result.amounts.hospitalPayment).toBe(124_000);
    expect(state.derived.documents).toEqual(resultState === 'ON_HOLD' ? null : { state: 'RULES_UNAVAILABLE' });
    expect(state.derived.basis).toBeNull();
    expect(state.derived.returnContext).toBeNull();
    expect(state.inputs).toBe(before.inputs);
    expect(state.inputRevision).toBe(before.inputRevision);
    expect(state.lastInteractionAt).toBe(before.lastInteractionAt);
    kiosk.dispose();
  });

  it.each([
    ['409 VERSION_MISMATCH', REPLIES.mismatch, 'VERSION_MISMATCH'],
    ['422 TREATMENT_NOT_PUBLISHED', REPLIES.notPublished, 'TREATMENT_NOT_PUBLISHED'],
  ] as const)('%s -> K03_Treatments, 결과는 저장하지 않고 같은 전이에서 갱신(%s)이 시작된다. 확인 버튼은 비활성이다', async (_name, answer, reason) => {
    const kiosk = startKiosk();
    const call = begin(kiosk);
    await reply(call, answer);
    const state = stateOf(kiosk);
    expect(state.screen).toBe('K03_Treatments');
    expect(state.derived.estimate).toBeNull();
    expect(state.refreshState).toBe('RUNNING');
    expect(state.activeRefresh).toMatchObject({ refreshId: 'RFR-TEST-0001', reason, inputRevision: state.inputRevision });
    expect(canRequestEstimate(state)).toBe(false);
    // 계산 요청은 더 나가지 않고 갱신 GET 두 개가 나간다
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    expect(kiosk.transport.refreshCalls().map((refresh) => refresh.url)).toEqual(['/api/clinics/test-fixture-clinic-1/catalog', '/api/clinics/test-fixture-clinic-1/insurance/options']);
    kiosk.dispose();
  });

  it('422 NO_TREATMENT_SELECTED -> K03_Treatments, 결과 없음, 갱신은 필요하지 않다', async () => {
    const kiosk = startKiosk();
    await reply(begin(kiosk), REPLIES.noTreatment);
    const state = stateOf(kiosk);
    expect(state.screen).toBe('K03_Treatments');
    expect(state.refreshState).toBe('NONE');
    expect(state.activeRefresh).toBeNull();
    expect(state.derived.estimate).toBeNull();
    kiosk.dispose();
  });

  it.each([
    ['400 INVALID_REQUEST', REPLIES.badRequest],
    ['404 CLINIC_NOT_FOUND', REPLIES.notFound],
    ['422 UNSUPPORTED_GENERATION', REPLIES.unsupportedGeneration],
    ['500 INTERNAL_ERROR', REPLIES.serverError],
    ['409 인데 코드가 다르다', { status: 409, body: errorBody('SOMETHING_ELSE') }],
    ['본문이 객체가 아니다', { status: 500, body: 'oops' }],
    ['200 인데 결과 종류가 세 값 밖이다', { status: 200, body: { versions: {}, result: { state: 'ZERO', amounts: { hospitalPayment: 0 } }, documents: null } }],
    ['200 인데 결과 객체가 없다', { status: 200, body: { versions: {}, documents: null } }],
    ['200 인데 서류가 객체도 null 도 아니다', { status: 200, body: { versions: {}, result: { state: 'ESTIMATED', amounts: { hospitalPayment: 1, expectedInsurancePayout: 0, expectedOutOfPocketAfterPayout: 1 } }, documents: 'x' } }],
  ] as Array<[string, Reply]>)('%s -> KXX_Error_Network: 결과를 저장하지 않고 0원을 만들지 않는다', async (_name, answer) => {
    const kiosk = startKiosk();
    await reply(begin(kiosk), answer);
    const state = stateOf(kiosk);
    expect(state.screen).toBe('KXX_Error_Network');
    expect(state.derived.estimate).toBeNull();
    expect(state.derived.documents).toBeNull();
    kiosk.dispose();
  });

  it('연결 실패 -> KXX_Error_Network', async () => {
    const kiosk = startKiosk();
    begin(kiosk).fail();
    await flush();
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    kiosk.dispose();
  });

  it.each([200, 500])('응답 본문을 읽지 못하면(%i) KXX_Error_Network', async (status) => {
    const kiosk = startKiosk();
    begin(kiosk).respondUnreadable(status);
    await flush();
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    expect(stateOf(kiosk).derived.estimate).toBeNull();
    kiosk.dispose();
  });

  it('시간 제한 -> KXX_Error_Network: 시도 시작 15초 뒤 (기본 제한)', async () => {
    const kiosk = startKiosk();
    begin(kiosk);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(stateOf(kiosk).screen).toBe('Calculating');
    await vi.advanceTimersByTimeAsync(1);
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    expect(stateOf(kiosk).derived.estimate).toBeNull();
    kiosk.dispose();
  });

  it('주입하지 않으면 시간 제한은 15초다', async () => {
    const kiosk = startKiosk();
    const call = begin(kiosk);
    expect(call.init.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(call.init.signal.aborted).toBe(true);
    kiosk.dispose();
  });
});

type Ending = {
  readonly name: string;
  readonly screen: ScreenState;
  /** 이 결말에서 컨트롤러가 abort() 되어야 하는가 (시간 초과와 취소 계열만). */
  readonly aborted: boolean;
  /** 끝낸 뒤 무조작 타이머가 남는 화면인가. */
  readonly idleTimer: boolean;
  /** 409·422 TREATMENT_NOT_PUBLISHED 는 갱신을 시작해 그 시간 제한 타이머가 하나 남는다. */
  readonly refresh?: boolean;
  readonly options?: { requestTimeoutMs: number };
  readonly run: (kiosk: Kiosk, call: PendingCall) => Promise<void>;
};

const answer = (name: string, reply_: Reply, screen: ScreenState, refresh = false): Ending => ({
  name,
  screen,
  aborted: false,
  idleTimer: true,
  refresh,
  run: (_kiosk, call) => reply(call, reply_),
});

const ENDINGS: Ending[] = [
  answer('200 ESTIMATED', REPLIES.ok('ESTIMATED'), 'K04_Result'),
  answer('200 ESTIMATED_WITH_EXCLUSIONS', REPLIES.ok('ESTIMATED_WITH_EXCLUSIONS'), 'K04_Result_NotCovered'),
  answer('200 ON_HOLD', REPLIES.ok('ON_HOLD'), 'K04_Result_Hold'),
  answer('409', REPLIES.mismatch, 'K03_Treatments', true),
  answer('422 NO_TREATMENT_SELECTED', REPLIES.noTreatment, 'K03_Treatments'),
  answer('422 TREATMENT_NOT_PUBLISHED', REPLIES.notPublished, 'K03_Treatments', true),
  answer('400', REPLIES.badRequest, 'KXX_Error_Network'),
  answer('404', REPLIES.notFound, 'KXX_Error_Network'),
  answer('422 UNSUPPORTED_GENERATION', REPLIES.unsupportedGeneration, 'KXX_Error_Network'),
  answer('5xx', REPLIES.serverError, 'KXX_Error_Network'),
  { name: '연결 실패', screen: 'KXX_Error_Network', aborted: false, idleTimer: true, run: async (_kiosk, call) => { call.fail(); await flush(); } },
  { name: '클라이언트 시간 초과', screen: 'KXX_Error_Network', aborted: true, idleTimer: true, run: async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS); } },
  {
    name: '대기 중 초기화 (처음으로 + 확인)',
    screen: 'K00_Start',
    aborted: true,
    idleTimer: false,
    run: async (kiosk) => {
      kiosk.controller.dispatch({ type: 'REQUEST_HOME' });
      kiosk.controller.dispatch({ type: 'CONFIRM_RESET' });
    },
  },
  {
    name: '대기 중 초기화 (무조작 초기화)',
    screen: 'K00_Start',
    aborted: true,
    idleTimer: false,
    options: { requestTimeoutMs: 500_000 },
    run: async () => { await vi.advanceTimersByTimeAsync(120_000); },
  },
  { name: '대기 중 초기화 (새로고침 복원)', screen: 'K00_Start', aborted: true, idleTimer: false, run: async (kiosk) => { kiosk.controller.dispatch({ type: 'PAGE_RESTORED' }); } },
];

describe('AC-016j: 어떤 결말이든 끝낸 직후 남는 것이 없다', () => {
  it.each(ENDINGS)('$name', async (ending) => {
    const kiosk = startKiosk(ending.options);
    goToTreatments(kiosk);
    const idleOnly = vi.getTimerCount();
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    const call = kiosk.transport.calls[0] as PendingCall;
    const requestId = requestIdOf(kiosk);
    // 요청 중: 시간 제한 타이머가 정확히 하나 늘고 컨트롤러는 아직 abort 되지 않았다
    expect(vi.getTimerCount()).toBe(idleOnly + 1);
    expect(kiosk.abortCalls()).toBe(0);
    const touched = stateOf(kiosk).lastInteractionAt;

    await ending.run(kiosk, call);

    const state = stateOf(kiosk);
    expect(state.screen).toBe(ending.screen);
    // (1) 활성 요청 해제 (3) 로딩 표시 끔
    expect(state.activeRequest).toBeNull();
    expect(selectIsLoading(state)).toBe(false);
    // (2) 그 시도의 타이머가 남지 않는다: 시작 전 값(무조작 타이머만)으로 돌아온다. 초기화로 K00 에 가면 무조작 타이머도 없다
    expect(vi.getTimerCount()).toBe((ending.idleTimer ? idleOnly : 0) + (ending.refresh === true ? 1 : 0));
    // (4) abort() 는 시간 초과와 취소 계열에서만, 정확히 한 번
    expect(kiosk.abortCalls()).toBe(ending.aborted ? 1 : 0);
    expect(call.init.signal.aborted).toBe(ending.aborted);
    // (9) 서버 결말은 무조작 시간을 다시 세지 않는다
    if (ending.idleTimer) expect(state.lastInteractionAt).toBe(touched);

    // (5) 시계를 시간 제한 이상으로 보내도 같다: 성공한 결과가 통신 오류로 바뀌지 않는다
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2);
    expect(stateOf(kiosk).screen).toBe(ending.screen);
    expect(stateOf(kiosk).activeRequest).toBeNull();
    expect(kiosk.abortCalls()).toBe(ending.aborted ? 1 : 0);
    const settled = stateOf(kiosk);

    // (6) 정리 전에 잡아 둔 타이머 콜백, 같은 시도의 settleRequest, 같은 시도의 늦은 결말 사건을 다시 불러도 아무것도 바뀌지 않는다
    for (const callback of kiosk.requestTimerCallbacks) callback();
    expect(stateOf(kiosk)).toBe(settled);
    expect(settleRequest(settled, requestId, { outcome: 'FAILED' })).toBe(settled);
    expect(settleRequest(settled, requestId, { outcome: 'EXPIRED' })).toBe(settled);
    for (const event of [
      { type: 'ESTIMATE_RESPONDED', requestId, status: 200, body: REPLIES.ok().body },
      { type: 'ESTIMATE_RESPONDED', requestId, status: 409, body: REPLIES.mismatch.body },
      { type: 'ESTIMATE_FAILED', requestId },
      { type: 'ESTIMATE_EXPIRED', requestId },
    ] as KioskEvent[]) {
      expect(kiosk.controller.dispatch(event)).toBe('IGNORED');
    }
    expect(stateOf(kiosk)).toBe(settled);
    expect(kiosk.abortCalls()).toBe(ending.aborted ? 1 : 0);
    expect(vi.getTimerCount()).toBe((ending.idleTimer ? idleOnly : 0) + (ending.refresh === true ? 1 : 0));
    kiosk.dispose();
  });
});

describe('AC-016j: 입력 변경과 새 시도로 교체 (활성 요청이 있는 상태를 직접 구성해 시작한다)', () => {
  function withActive(requestId: string): KioskState {
    const base = stateAt('K03_Treatments', { inputs: FULL_INPUTS }, { env: makeEnv(performance.now()) });
    return { ...base, activeRequest: { requestId, sessionId: base.sessionId, inputRevision: base.inputRevision } };
  }

  it('시작할 때 활성 요청이 있으면 시도가 하나 걸려 있다: 전송이 한 번 나가고 시간 제한 타이머가 걸린다', () => {
    const kiosk = startKiosk({ from: withActive('RID-FORCED-A') });
    expect(kiosk.transport.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(2);
    kiosk.dispose();
  });

  it('대기 중 입력 변경 (실제 변경): 이전 시도를 취소(abort)하고 정리하며 늦은 결과는 반영되지 않는다', async () => {
    const kiosk = startKiosk({ from: withActive('RID-FORCED-A') });
    const call = kiosk.transport.calls[0] as PendingCall;
    const revision = stateOf(kiosk).inputRevision;
    expect(kiosk.controller.dispatch({ type: 'TOGGLE_TREATMENT', treatmentId: 'TEST_FIXTURE_TREATMENT_4' })).toBe('APPLIED');
    const state = stateOf(kiosk);
    expect(state.activeRequest).toBeNull();
    expect(state.inputRevision).toBe(revision + 1);
    expect(vi.getTimerCount()).toBe(1);
    expect(kiosk.abortCalls()).toBe(1);
    expect(call.init.signal.aborted).toBe(true);
    await reply(call, REPLIES.ok());
    kiosk.controller.dispatch({ type: 'ESTIMATE_EXPIRED', requestId: 'RID-FORCED-A' });
    expect(stateOf(kiosk)).toBe(state);
    kiosk.dispose();
  });

  it('같은 값을 다시 고르면 입력 변경이 아니라서 진행 중인 시도는 그대로다', () => {
    const kiosk = startKiosk({ from: { ...withActive('RID-FORCED-A'), screen: 'K02_Type' } });
    kiosk.controller.dispatch({ type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' });
    expect(stateOf(kiosk).activeRequest?.requestId).toBe('RID-FORCED-A');
    expect(kiosk.abortCalls()).toBe(0);
    expect(vi.getTimerCount()).toBe(2);
    kiosk.dispose();
  });

  it('새 시도로 교체: 이전 시도를 먼저 취소하고, 새 시도의 타이머 하나만 남고, 이전 시도의 늦은 결말은 새 시도를 건드리지 못한다 (AC-016j 6)', async () => {
    const kiosk = startKiosk({ from: withActive('RID-FORCED-A') });
    const a = kiosk.transport.calls[0] as PendingCall;
    const aTimer = kiosk.requestTimerCallbacks[0] as () => void;
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    const b = kiosk.transport.calls[1] as PendingCall;
    const state = stateOf(kiosk);
    expect(state.screen).toBe('Calculating');
    expect(state.activeRequest?.requestId).toBe('RID-TEST-0001');
    expect(a.init.signal.aborted).toBe(true);
    expect(b.init.signal.aborted).toBe(false);
    expect(kiosk.abortCalls()).toBe(1);
    expect(vi.getTimerCount()).toBe(2); // 무조작 타이머 + B 의 시간 제한 타이머
    // A 의 늦은 추가 호출: 응답(실제 경로), 오류·409·시간 초과(직접), 타이머 콜백, settleRequest 직접 호출
    await reply(a, REPLIES.ok());
    for (const event of [
      { type: 'ESTIMATE_RESPONDED', requestId: 'RID-FORCED-A', status: 409, body: REPLIES.mismatch.body },
      { type: 'ESTIMATE_RESPONDED', requestId: 'RID-FORCED-A', status: 500, body: REPLIES.serverError.body },
      { type: 'ESTIMATE_FAILED', requestId: 'RID-FORCED-A' },
      { type: 'ESTIMATE_EXPIRED', requestId: 'RID-FORCED-A' },
    ] as KioskEvent[]) {
      expect(kiosk.controller.dispatch(event)).toBe('IGNORED');
    }
    aTimer();
    expect(settleRequest(state, 'RID-FORCED-A', { outcome: 'FAILED' })).toBe(state);
    expect(stateOf(kiosk)).toBe(state);
    expect(vi.getTimerCount()).toBe(2);
    expect(kiosk.abortCalls()).toBe(1);
    // B 는 제때 만료된다
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    expect(b.init.signal.aborted).toBe(true);
    kiosk.dispose();
  });

  it('시작할 때 활성 요청이 있어도 보낼 본문이 없으면(입력 부족) 연결 실패로 끝난다 — 0원이나 빈 결과를 만들지 않는다', async () => {
    const base = stateAt('K03_Treatments', { inputs: { ...FULL_INPUTS, cause: null } }, { env: makeEnv(performance.now()) });
    const kiosk = startKiosk({ from: { ...base, activeRequest: { requestId: 'RID-FORCED-B', sessionId: base.sessionId, inputRevision: base.inputRevision } } });
    await flush();
    expect(kiosk.transport.calls).toHaveLength(0);
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    expect(stateOf(kiosk).derived.estimate).toBeNull();
    kiosk.dispose();
  });

  it('dispose: 진행 중인 시도의 타이머를 치우고 전송을 취소한다', () => {
    const kiosk = startKiosk({ from: withActive('RID-FORCED-A') });
    const call = kiosk.transport.calls[0] as PendingCall;
    kiosk.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(call.init.signal.aborted).toBe(true);
    kiosk.dispose();
  });
});

describe('AC-016h: 시간 초과 뒤 "다시 시도"(B)가 진행 중일 때 이전 시도(A)의 늦은 결과는 아무것도 바꾸지 못한다', () => {
  it('A 의 늦은 성공·4xx·5xx·409·시간 초과 콜백이 차례로 와도 B 의 상태·결과·로딩 표시·타이머는 그대로이고, 그 뒤 B 의 정상 응답만 반영된다', async () => {
    const kiosk = startKiosk();
    const a = begin(kiosk);
    const aId = requestIdOf(kiosk);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(stateOf(kiosk).screen).toBe('KXX_Error_Network');
    const aTimer = kiosk.requestTimerCallbacks[0] as () => void;
    expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
    const b = kiosk.transport.calls[1] as PendingCall;
    const bState = stateOf(kiosk);
    const bId = requestIdOf(kiosk);
    expect(bId).not.toBe(aId);
    const timers = vi.getTimerCount();
    const aborts = kiosk.abortCalls();

    await reply(a, REPLIES.ok());
    expect(stateOf(kiosk)).toBe(bState);
    for (const event of [
      { type: 'ESTIMATE_RESPONDED', requestId: aId, status: 400, body: REPLIES.badRequest.body },
      { type: 'ESTIMATE_RESPONDED', requestId: aId, status: 500, body: REPLIES.serverError.body },
      { type: 'ESTIMATE_RESPONDED', requestId: aId, status: 409, body: REPLIES.mismatch.body },
      { type: 'ESTIMATE_RESPONDED', requestId: aId, status: 422, body: REPLIES.notPublished.body },
      { type: 'ESTIMATE_EXPIRED', requestId: aId },
    ] as KioskEvent[]) {
      expect(kiosk.controller.dispatch(event)).toBe('IGNORED');
    }
    aTimer();
    expect(stateOf(kiosk)).toBe(bState);
    expect(selectIsLoading(stateOf(kiosk))).toBe(true);
    expect(stateOf(kiosk).screen).toBe('Calculating');
    expect(vi.getTimerCount()).toBe(timers);
    expect(kiosk.abortCalls()).toBe(aborts);
    expect(kiosk.transport.calls).toHaveLength(2);

    await reply(b, REPLIES.ok('ESTIMATED_WITH_EXCLUSIONS'));
    expect(stateOf(kiosk).screen).toBe('K04_Result_NotCovered');
    expect(stateOf(kiosk).activeRequest).toBeNull();
    kiosk.dispose();
  });
});

describe('AC-016i: 취소는 abort() 가 아무 일도 하지 않아도 requestId 보호만으로 늦은 결과를 막는다', () => {
  const LATE: Array<[string, (requestId: string) => KioskEvent]> = [
    ['200', (requestId) => ({ type: 'ESTIMATE_RESPONDED', requestId, status: 200, body: REPLIES.ok().body })],
    ['409', (requestId) => ({ type: 'ESTIMATE_RESPONDED', requestId, status: 409, body: REPLIES.mismatch.body })],
    ['422 TREATMENT_NOT_PUBLISHED', (requestId) => ({ type: 'ESTIMATE_RESPONDED', requestId, status: 422, body: REPLIES.notPublished.body })],
    ['5xx', (requestId) => ({ type: 'ESTIMATE_RESPONDED', requestId, status: 500, body: REPLIES.serverError.body })],
    ['연결 실패', (requestId) => ({ type: 'ESTIMATE_FAILED', requestId })],
    ['시간 초과', (requestId) => ({ type: 'ESTIMATE_EXPIRED', requestId })],
  ];

  const WAYS: Array<[string, (kiosk: Kiosk) => Promise<void>]> = [
    ['처음으로 + 확인', async (kiosk) => { kiosk.controller.dispatch({ type: 'REQUEST_HOME' }); kiosk.controller.dispatch({ type: 'CONFIRM_RESET' }); }],
    ['TimeoutDialog 의 처음으로', async (kiosk) => { await vi.advanceTimersByTimeAsync(100_000); kiosk.controller.dispatch({ type: 'REQUEST_HOME' }); }],
    ['무조작 초기화', async () => { await vi.advanceTimersByTimeAsync(120_000); }],
    ['새로고침·페이지 캐시 복원', async (kiosk) => { kiosk.controller.dispatch({ type: 'PAGE_RESTORED' }); }],
  ];

  it.each(WAYS)('%s 뒤: 늦은 결말 전부(실제 응답 경로 포함)를 abort() 없이도 버린다', async (_name, way) => {
    const kiosk = startKiosk({ abortDoesNothing: true, requestTimeoutMs: 500_000 });
    const call = begin(kiosk);
    const requestId = requestIdOf(kiosk);
    await way(kiosk);
    const reset = stateOf(kiosk);
    expect(reset.screen).toBe('K00_Start');
    expect(reset.activeRequest).toBeNull();
    // abort 는 불렸지만(호출 수) 아무 일도 하지 않았다: 신호는 취소되지 않았다
    expect(kiosk.abortCalls()).toBe(1);
    expect(call.init.signal.aborted).toBe(false);
    await reply(call, REPLIES.ok());
    for (const [, make] of LATE) expect(kiosk.controller.dispatch(make(requestId))).toBe('IGNORED');
    expect(stateOf(kiosk)).toBe(reset);
    expect(vi.getTimerCount()).toBe(0);
    expect(kiosk.transport.calls).toHaveLength(1);
    kiosk.dispose();
  });

  it('AC-016c: 응답 전에 초기화하고 다음 환자가 시작한 뒤 응답이 도착해도 새 세션의 화면은 바뀌지 않는다 (sessionId 가 다르다)', async () => {
    const kiosk = startKiosk({ abortDoesNothing: true });
    const call = begin(kiosk);
    const oldSession = stateOf(kiosk).sessionId;
    kiosk.controller.dispatch({ type: 'PAGE_RESTORED' });
    kiosk.controller.dispatch({ type: 'START' });
    kiosk.controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN4_C4' });
    const next = stateOf(kiosk);
    expect(next).toMatchObject({ screen: 'K01_Generation', activeRequest: null });
    expect(next.sessionId).not.toBe(oldSession);
    await reply(call, REPLIES.ok());
    expect(stateOf(kiosk)).toBe(next);
    kiosk.dispose();
  });

  it('요청 만료 뒤: abort() 가 아무 일도 하지 않아도 늦게 온 응답은 반영되지 않는다', async () => {
    const kiosk = startKiosk({ abortDoesNothing: true });
    const call = begin(kiosk);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const expired = stateOf(kiosk);
    expect(expired.screen).toBe('KXX_Error_Network');
    await reply(call, REPLIES.ok());
    expect(stateOf(kiosk)).toBe(expired);
    kiosk.dispose();
  });
});

describe('AC-016k: 계산 시도 식별자(requestId)는 요청 본문·헤더·URL 어디에도 없다', () => {
  const MARKER = /RID-TEST-\d{4}/;
  const hasRequestIdKey = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    return Object.entries(value).some(([key, child]) => /request.?id/i.test(key) || hasRequestIdKey(child));
  };

  it('첫 시도, 시간 초과 뒤 다시 시도, 409, 그 밖의 오류 뒤 재시도까지 여러 건을 보내도 표지 값이 새지 않는다. 대조군: 요청 중 표지 값은 activeRequest 에 있다', async () => {
    const calls: PendingCall[] = [];
    const markersInFlight: string[] = [];

    // 병원 하나: 시간 초과 -> 다시 시도 -> 5xx -> 다시 시도 -> 200
    const first = startKiosk();
    calls.push(begin(first));
    markersInFlight.push(requestIdOf(first));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    first.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    calls.push(first.transport.calls[1] as PendingCall);
    markersInFlight.push(requestIdOf(first));
    await reply(first.transport.calls[1] as PendingCall, REPLIES.serverError);
    first.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    calls.push(first.transport.calls[2] as PendingCall);
    markersInFlight.push(requestIdOf(first));
    await reply(first.transport.calls[2] as PendingCall, REPLIES.ok());

    // 다른 세션: 409
    const second = startKiosk();
    calls.push(begin(second));
    markersInFlight.push(requestIdOf(second));
    await reply(second.transport.calls[0] as PendingCall, REPLIES.mismatch);

    expect(calls).toHaveLength(4);
    // (1) 대조군: 요청 중 표지 값이 메모리의 activeRequest 에 있었다
    expect(markersInFlight.every((id) => MARKER.test(id))).toBe(true);
    for (const call of calls) {
      // (2) 본문 전체 문자열, 모든 헤더(이름과 값), URL 어디에도 표지 값이 없고 requestid 이름의 키·헤더도 없다
      expect(call.init.body).not.toMatch(MARKER);
      expect(call.url).not.toMatch(MARKER);
      expect(JSON.stringify(call.init.headers)).not.toMatch(MARKER);
      expect(Object.keys(call.init.headers).some((name) => /request.?id/i.test(name))).toBe(false);
      expect(hasRequestIdKey(call.body())).toBe(false);
      expect(call.url).not.toMatch(/[?#]/);
      // (3) 본문은 여섯 필드뿐이다
      expect(Object.keys(call.body())).toEqual(['catalogVersion', 'ruleBundleVersion', 'generation', 'insurerType', 'cause', 'treatmentIds']);
    }
    first.dispose();
    second.dispose();
  });
});

describe('AC-016l: 로그와 분석 이벤트에는 requestId 도 표지 값도 없고, 분석은 단계 수준 익명 필드뿐이다', () => {
  it('정상 결과, 오류, 시간 초과, 409, 초기화를 지나는 시나리오', async () => {
    const logs: unknown[] = [];
    const analytics: unknown[] = [];
    const markersSeen: string[] = [];

    const ok = startKiosk();
    await reply(begin(ok), REPLIES.ok());
    ok.controller.dispatch({ type: 'COMPLETE_USE' });
    logs.push(...ok.logs);
    analytics.push(...ok.analytics);

    const failing = startKiosk();
    begin(failing);
    markersSeen.push(requestIdOf(failing));
    await reply(failing.transport.calls[0] as PendingCall, REPLIES.serverError);
    failing.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    failing.controller.dispatch({ type: 'COMPLETE_USE' });
    logs.push(...failing.logs);
    analytics.push(...failing.analytics);

    const mismatch = startKiosk();
    await reply(begin(mismatch), REPLIES.mismatch);
    mismatch.controller.dispatch({ type: 'REQUEST_HOME' });
    mismatch.controller.dispatch({ type: 'CONFIRM_RESET' });
    logs.push(...mismatch.logs);
    analytics.push(...mismatch.analytics);

    const cancelled = startKiosk();
    begin(cancelled);
    cancelled.controller.dispatch({ type: 'REQUEST_HOME' });
    cancelled.controller.dispatch({ type: 'CONFIRM_RESET' });
    logs.push(...cancelled.logs);
    analytics.push(...cancelled.analytics);

    // 대조군: 수집 장치가 실제로 받았다
    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(analytics.length).toBeGreaterThan(8);
    expect(logs).toEqual(
      expect.arrayContaining([
        { level: 'error', code: 'ESTIMATE_FAILED', status: 500 },
        { level: 'error', code: 'ESTIMATE_EXPIRED' },
        { level: 'warn', code: 'ESTIMATE_VERSION_MISMATCH', status: 409 },
      ]),
    );
    expect(markersSeen.every((id) => /^RID-TEST-\d{4}$/.test(id))).toBe(true);

    const text = JSON.stringify([logs, analytics]);
    expect(text).not.toMatch(/RID-TEST/);
    expect(text).not.toMatch(/request.?id/i);
    // 분석 이벤트는 단계(화면 이름)와 결말 종류뿐이다: 입력값·금액·식별자 칸이 없다
    for (const event of analytics as Array<Record<string, unknown>>) {
      expect(['SCREEN', 'ESTIMATE_OUTCOME', 'REFRESH_OUTCOME']).toContain(event.type);
      expect(Object.keys(event).sort()).toEqual(event.type === 'SCREEN' ? ['screen', 'type'] : ['outcome', 'type']);
    }
    expect(analytics).toEqual(expect.arrayContaining([{ type: 'ESTIMATE_OUTCOME', outcome: 'SUCCEEDED' }, { type: 'ESTIMATE_OUTCOME', outcome: 'CANCELLED' }, { type: 'SCREEN', screen: 'K04_Result' }]));
    for (const kiosk of [ok, failing, mismatch, cancelled]) kiosk.dispose();
  });

  it('로그와 분석을 주입하지 않아도 동작한다 (기본값은 아무 일도 하지 않는다)', async () => {
    const { createKioskController } = await import('../../../src/app/kiosk/state/controller');
    const { makeCatalog, makeOptions } = await import('../../fixtures/kiosk/clinic.fixture');
    const { fakeTransport } = await import('../../fixtures/kiosk/transport.fixture');
    const transport = fakeTransport();
    const controller = createKioskController({ transport: transport.transport }, { catalog: makeCatalog(), options: makeOptions() });
    for (const event of [{ type: 'START' }, { type: 'SELECT_GENERATION', code: 'GEN2_C1' }] as const) controller.dispatch(event);
    expect(() => controller.dispatch({ type: 'PAGE_RESTORED' })).not.toThrow();
    controller.dispose();
  });
});
