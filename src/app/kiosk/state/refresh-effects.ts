import { timerDelay } from './deps';
import type { KioskDeps, TimerHandle } from './deps';
import type { KioskEvent } from './events';
import { abortsOnRefreshSettle, buildRefreshUrls, outcomeOfRefreshEvent } from './refresh';
import type { KioskState } from './session-store';

// 자료 갱신의 부수 효과: 두 GET, 시간 제한 타이머 하나, 취소 수단, 로그와 분석 (SPEC-REIMBURSEMENT-001 M5.C, design.md DD-09 "자료 갱신 생명주기" 규칙 3·4·7, AC-020e·AC-016o).
// request-effects.ts 와 같은 구조다. 컨트롤러가 사건 하나를 적용할 때마다 이전 상태와 새 상태의 활성 갱신(activeRefresh)을 견주어
//  - 새 갱신이 생겼으면 GET 두 개를 보내고(요청마다 AbortController 하나) 갱신 전체에 시간 제한 타이머 하나를 건다.
//  - 갱신이 사라졌으면(settleRefresh 가 풀었다) 타이머를 치우고, 시간 초과와 취소 계열일 때만 취소 수단을 쓴다. 이미 끝난 갱신은 취소할 것이 없다.
// 결말 사건은 시도마다 정확히 하나만 보낸다: 둘 중 하나가 먼저 실패하면 곧바로 실패 사건이고(남은 응답은 활성 갱신이 풀린 뒤라 버려진다), 둘 다 200 으로 읽혔을 때만 성공 사건이다.
// 갱신 식별자(refreshId)는 상태의 activeRefresh 와 이 모듈의 결말 사건에만 있다. 두 GET 의 주소·헤더는 buildRefreshUrls(상태)가 식별자 없이 만든다.

export interface RefreshEffects {
  /** 사건을 적용한 뒤 부른다. `previous` 는 컨트롤러가 켜질 때의 첫 호출에서만 null 이다. `event` 는 상태를 바꾼 사건. 첫 호출과 세션이 끝난 전이(만료 초기화 등: 컨트롤러가 취소로 넘긴다)는 null. */
  sync(previous: KioskState | null, next: KioskState, event: KioskEvent | null): void;
  /** 진행 중인 갱신이 있으면 타이머를 치우고 취소한다. */
  dispose(): void;
}

interface Attempt {
  readonly controllers: readonly AbortController[];
  readonly timeoutHandle: TimerHandle;
}

export function createRefreshEffects(deps: KioskDeps, dispatch: (event: KioskEvent) => unknown): RefreshEffects {
  let attempt: Attempt | null = null;

  function release(abort: boolean): void {
    if (attempt === null) return;
    deps.clearTimeout(attempt.timeoutHandle);
    if (abort) for (const controller of attempt.controllers) controller.abort();
    attempt = null;
  }

  /** GET 하나: 200 이고 JSON 으로 읽을 수 있을 때만 본문을 돌려준다. 그 밖(연결 실패·취소·다른 상태 번호·읽을 수 없는 본문)은 거절한다. */
  async function load(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await deps.transport(url, { method: 'GET', headers: { accept: 'application/json' }, signal });
    if (response.status !== 200) throw new Error('자료 갱신 응답이 200 이 아니다');
    return response.json();
  }

  function start(state: KioskState, refreshId: string): void {
    const controllers = [new AbortController(), new AbortController()] as const;
    const urls = buildRefreshUrls(state);
    attempt = { controllers, timeoutHandle: deps.setTimeout(() => dispatch({ type: 'REFRESH_EXPIRED', refreshId }), timerDelay(deps.refreshTimeoutMs)) };
    void Promise.all([load(urls.catalog, controllers[0].signal), load(urls.options, controllers[1].signal)])
      .then(
        ([catalog, options]): KioskEvent => ({ type: 'REFRESH_RESOLVED', refreshId, catalog, options }),
        (): KioskEvent => ({ type: 'REFRESH_FAILED', refreshId }),
      )
      .then(dispatch);
  }

  // 로그는 실패·시간 초과의 종류만, 분석은 결말 종류만 낸다. 식별자·입력값·병원 자료는 어느 쪽에도 없다 (AC-016o).
  function report(previous: KioskState, next: KioskState, event: KioskEvent | null): void {
    if (previous.activeRefresh === null || previous.activeRefresh.refreshId === next.activeRefresh?.refreshId) return;
    const outcome = outcomeOfRefreshEvent(event, previous);
    deps.analytics({ type: 'REFRESH_OUTCOME', outcome });
    if (outcome === 'FAILED' || outcome === 'EXPIRED') deps.log({ level: 'error', code: `REFRESH_${outcome}` });
  }

  return {
    sync(previous, next, event) {
      const before = previous?.activeRefresh ?? null;
      const after = next.activeRefresh;
      if (previous !== null) report(previous, next, event);
      if (before?.refreshId === after?.refreshId) return;
      release(previous !== null && abortsOnRefreshSettle(outcomeOfRefreshEvent(event, previous)));
      if (after !== null) start(next, after.refreshId);
    },
    dispose() {
      release(true);
    },
  };
}
