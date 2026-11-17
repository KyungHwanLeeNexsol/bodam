import { timerDelay } from './deps';
import type { KioskDeps, TimerHandle } from './deps';
import type { KioskEvent } from './events';
import { abortsOnSettle, buildEstimateCall, outcomeOfEvent } from './request';
import type { KioskState } from './session-store';

// 계산 요청의 부수 효과: 전송, 시간 제한 타이머, 취소 수단, 로그와 분석 (SPEC-REIMBURSEMENT-001 M5.B, design.md DD-09, AC-016h~l).
// 전이 함수(reduce)는 순수하다. 이 모듈은 컨트롤러가 사건 하나를 적용할 때마다 이전 상태와 새 상태의 활성 요청(activeRequest)을 견주어
//  - 새 시도가 생겼으면 AbortController 를 만들고, 시간 제한 타이머를 걸고, 요청을 보낸다.
//  - 시도가 사라졌으면(settleRequest 가 풀었다) 타이머를 치우고, 시간 초과와 취소 계열일 때만 컨트롤러를 abort() 한다. 이미 끝난 요청은 취소할 것이 없다.
// 시도는 한 번에 하나다: 새 시도는 reduce 가 이전 시도를 먼저 CANCELLED 로 풀기 때문에 같은 견줌에서 "이전 시도 정리 → 새 시도 시작"이 이어서 일어난다.
// 시도 식별자(requestId)는 상태의 activeRequest 와 이 모듈의 결말 사건에만 있다. 전송 인자(주소·헤더·본문)는 buildEstimateCall(상태)가 식별자 없이 만든다.

export interface RequestEffects {
  /** 사건을 적용한 뒤 부른다. \`previous\` 는 컨트롤러가 켜질 때의 첫 호출에서만 null 이다. \`event\` 는 상태를 바꾼 사건. 첫 호출과 세션이 끝난 전이(만료 초기화 등: 컨트롤러가 취소로 넘긴다)는 null. */
  sync(previous: KioskState | null, next: KioskState, event: KioskEvent | null): void;
  /** 진행 중인 시도가 있으면 타이머를 치우고 취소한다. */
  dispose(): void;
}

interface Attempt {
  readonly requestId: string;
  readonly controller: AbortController;
  readonly timeoutHandle: TimerHandle;
}

export function createRequestEffects(deps: KioskDeps, dispatch: (event: KioskEvent) => unknown): RequestEffects {
  let attempt: Attempt | null = null;

  /** 지금의 시도를 푼다: 타이머를 치우고, 취소 계열일 때만 abort() 한다. */
  function release(abort: boolean): void {
    if (attempt === null) return;
    deps.clearTimeout(attempt.timeoutHandle);
    if (abort) attempt.controller.abort();
    attempt = null;
  }

  /** 요청을 보내고 결말을 사건으로 돌려준다. 던지지 않는다: 연결 실패·취소는 ESTIMATE_FAILED 다(활성 요청이 아니면 reduce 가 버린다). */
  async function send(requestId: string, state: KioskState, controller: AbortController): Promise<KioskEvent> {
    const call = buildEstimateCall(state);
    if (call === null) return { type: 'ESTIMATE_FAILED', requestId };
    try {
      const response = await deps.transport(call.url, { ...call.init, signal: controller.signal });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      return { type: 'ESTIMATE_RESPONDED', requestId, status: response.status, body };
    } catch {
      return { type: 'ESTIMATE_FAILED', requestId };
    }
  }

  function start(state: KioskState, requestId: string): void {
    const controller = new AbortController();
    attempt = { requestId, controller, timeoutHandle: deps.setTimeout(() => dispatch({ type: 'ESTIMATE_EXPIRED', requestId }), timerDelay(deps.requestTimeoutMs)) };
    void send(requestId, state, controller).then(dispatch);
  }

  // 로그는 오류·시간 초과·버전 불일치·거절의 종류만, 분석은 화면 이름과 결말 종류만 낸다. 입력값·금액·식별자는 어느 쪽에도 없다 (AC-016l).
  function report(previous: KioskState, next: KioskState, event: KioskEvent | null): void {
    if (previous.screen !== next.screen) deps.analytics({ type: 'SCREEN', screen: next.screen });
    if (previous.activeRequest === null || previous.activeRequest.requestId === next.activeRequest?.requestId) return;
    const outcome = outcomeOfEvent(event);
    deps.analytics({ type: 'ESTIMATE_OUTCOME', outcome });
    const status = event?.type === 'ESTIMATE_RESPONDED' ? { status: event.status } : {};
    if (outcome === 'FAILED' || outcome === 'EXPIRED') deps.log({ level: 'error', code: `ESTIMATE_${outcome}`, ...status });
    if (outcome === 'VERSION_MISMATCH' || outcome === 'REJECTED') deps.log({ level: 'warn', code: `ESTIMATE_${outcome}`, ...status });
  }

  return {
    sync(previous, next, event) {
      const before = previous?.activeRequest ?? null;
      const after = next.activeRequest;
      if (previous !== null) report(previous, next, event);
      if (before?.requestId === after?.requestId) return;
      release(abortsOnSettle(outcomeOfEvent(event)));
      if (after !== null) start(next, after.requestId);
    },
    dispose() {
      release(true);
    },
  };
}
