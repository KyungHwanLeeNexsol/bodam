import { resolveDeps } from './deps';
import { timerDelay } from './deps';
import type { KioskDeps, TimerHandle } from './deps';
import type { KioskEvent } from './events';
import { nextSchedule } from './idle';
import type { Schedule } from './idle';
import { reduce } from './machine';
import { createRefreshEffects } from './refresh-effects';
import { createRequestEffects } from './request-effects';
import { createInitialState } from './session-store';
import type { KioskInit, KioskState } from './session-store';

// 키오스크 컨트롤러: 상태 하나, 타이머 칸 하나, 구독자 목록을 가진 얇은 껍질 (SPEC-REIMBURSEMENT-001 M5.A, design.md DD-07·DD-10).
// 전이 규칙은 모두 machine.ts 의 reduce 에 있고, 일정은 모두 idle.ts 의 nextSchedule 에 있다. 이 파일이 하는 일은 셋뿐이다:
//  1. 사건을 reduce 에 넘겨 새 상태를 보관한다. 활성 요청이 생기고 사라지면 계산 요청의 전송·타이머·취소를 맞춘다(request-effects.ts).
//  2. 타이머 칸 하나가 nextSchedule(state) 를 따라가게 한다. 도래하면 TICK 사건을 보낸다.
//  3. 상태가 바뀔 때마다 구독자에게 한 번씩, 순서대로 알린다. 알림을 받는 쪽이 읽을 때는 타이머와 요청 자원이 이미 새 상태에 맞춰져 있다.
// 모듈 수준 상태가 없다: 컨트롤러마다 자기 상태·타이머를 클로저로 가진다.

export type DispatchResult = 'APPLIED' | 'IGNORED';
export type KioskListener = (state: KioskState) => void;

export interface KioskController {
  getState(): KioskState;
  /** 사건을 보낸다. 받아들이면 'APPLIED' 이고 구독자에게 알림이 한 번 간다. 거절하면 'IGNORED' 이고 상태 참조도 알림도 없다. */
  dispatch(event: KioskEvent): DispatchResult;
  /** 상태가 바뀔 때마다 부른다. 돌려주는 함수로 해제한다. */
  subscribe(listener: KioskListener): () => void;
  /** 현재 상태와 지금 시각(deps.now() 기준)으로 값을 읽는다. 남은 시간처럼 시각이 필요한 표시 값을 그릴 때 쓴다. */
  select<T>(selector: (state: KioskState, now: number) => T): T;
  /** 타이머와 구독을 모두 풀고 이후 사건을 받지 않는다. */
  dispose(): void;
}

interface TimerSlot {
  readonly schedule: Schedule;
  readonly handle: TimerHandle;
}

/** 키오스크가 켜진 직후(`K00_Start`)의 컨트롤러. 병원 자료는 화면의 시작 단계가 받아 넘긴다. */
export function createKioskController(partialDeps: Partial<KioskDeps>, init: KioskInit): KioskController {
  const deps = resolveDeps(partialDeps);
  return createKioskControllerFromState(deps, createInitialState(init, { now: deps.now(), newSessionId: deps.newSessionId, newRequestId: deps.newRequestId, newRefreshId: deps.newRefreshId }));
}

/**
 * 주어진 상태에서 시작하는 컨트롤러. 시험과 화면 조립이 원하는 화면에서 시작할 때 쓴다. 저장된 세션을 복원하는 길이 아니다(DD-09: 환자 상태는 메모리에만 있다).
 * 그 상태에 맞는 타이머를 바로 건다.
 */
export function createKioskControllerFromState(partialDeps: Partial<KioskDeps>, initial: KioskState): KioskController {
  const deps = resolveDeps(partialDeps);
  let state = initial;
  let slot: TimerSlot | null = null;
  let disposed = false;
  const listeners = new Set<{ readonly listener: KioskListener }>();
  const pending: KioskState[] = [];
  let notifying = false;
  // 계산 요청의 전송·시간 제한 타이머·취소 수단. 활성 요청이 생기고 사라지는 것을 따라간다(request-effects.ts). 무조작 타이머 칸과는 별개다.
  const requests = createRequestEffects(deps, (event) => dispatch(event));
  // catalog·options 갱신의 두 GET·시간 제한 타이머·취소 수단. 활성 갱신을 따라간다(refresh-effects.ts).
  const refreshes = createRefreshEffects(deps, (event) => dispatch(event));

  // 타이머 칸은 하나다. 일정이 같으면 그대로 두고(시계를 건드리지 않는 사건 뒤에 다시 걸지 않는다), 다르거나 없어졌으면 풀고 다시 건다.
  // 타이머가 울리면 칸을 비우고 TICK 을 보낸다: 일정보다 일찍 울렸으면 TICK 이 거절되고, 이 동기화가 남은 시간만큼 다시 건다.
  function syncTimer(): void {
    const schedule = disposed ? null : nextSchedule(state);
    if (slot !== null && schedule !== null && slot.schedule.kind === schedule.kind && slot.schedule.at === schedule.at) return;
    if (slot !== null) {
      deps.clearTimeout(slot.handle);
      slot = null;
    }
    if (schedule !== null) {
      slot = {
        schedule,
        handle: deps.setTimeout(() => {
          slot = null;
          dispatch({ type: 'TICK' });
        }, timerDelay(schedule.at - deps.now())),
      };
    }
  }

  // 알림 도중 들어온 dispatch 는 상태에 곧바로 반영하되 알림은 줄에 쌓아, 모든 구독자가 같은 순서의 상태를 받게 한다.
  // 한 상태를 알리는 동안 새로 구독한 쪽은 그 상태를 받지 않고, 해제한 쪽은 남은 알림을 받지 않는다.
  function notify(next: KioskState): void {
    pending.push(next);
    if (notifying) return;
    notifying = true;
    try {
      for (let queued = pending.shift(); queued !== undefined; queued = pending.shift()) {
        for (const entry of [...listeners]) {
          if (listeners.has(entry)) entry.listener(queued);
        }
      }
    } finally {
      // 구독자가 예외를 던지면 남은 알림은 버린다(getState 가 늘 최신이다). 그렇지 않으면 다음 dispatch 가 오래된 상태를 알리게 된다.
      pending.length = 0;
      notifying = false;
    }
  }

  function dispatch(event: KioskEvent): DispatchResult {
    if (disposed) return 'IGNORED';
    const previous = state;
    state = reduce(previous, event, { now: deps.now(), newSessionId: deps.newSessionId, newRequestId: deps.newRequestId, newRefreshId: deps.newRefreshId });
    if (state !== previous) {
      requests.sync(previous, state, event);
      refreshes.sync(previous, state, event);
    }
    syncTimer();
    if (state === previous) return 'IGNORED';
    notify(state);
    return 'APPLIED';
  }

  requests.sync(null, state, null);
  refreshes.sync(null, state, null);
  syncTimer();

  return {
    getState: () => state,
    dispatch,
    subscribe(listener) {
      const entry = { listener };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    select: (selector) => selector(state, deps.now()),
    dispose() {
      disposed = true;
      listeners.clear();
      requests.dispose();
      refreshes.dispose();
      syncTimer();
    },
  };
}
