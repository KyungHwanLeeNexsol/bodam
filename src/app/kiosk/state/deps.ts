import type { RefreshOutcome } from './refresh';
import type { SettleOutcome } from './request';
import type { ScreenState } from './session-store';

// 키오스크 상태 기계의 바깥 의존성: 시계, 타이머, 식별자 발급, 계산 요청의 전송, 로그·분석 출구 (SPEC-REIMBURSEMENT-001 M5.A·M5.B, design.md DD-09·DD-10).
// 모두 주입할 수 있고, 주입하지 않으면 전역 값을 "부를 때마다" 찾아 쓴다. 그래서 시험은 vi.useFakeTimers() 로 시계와 타이머를 통째로 가로챌 수 있고
// 운영 코드에는 시험용 덮어쓰기 훅이 없다. 모듈 수준 상태도 없다.

/** 타이머 핸들. 발급한 쪽(setTimeout)만 의미를 알고 상태 기계는 되돌려 줄 뿐이다. */
export type TimerHandle = unknown;

/** 전송이 받는 요청 설정. fetch 의 RequestInit 중 키오스크가 쓰는 칸뿐이다. 계산 시도 식별자(requestId)는 어느 칸에도 들어가지 않는다(AC-016k). */
export interface TransportInit {
  readonly method: 'POST' | 'GET';
  readonly headers: Readonly<Record<string, string>>;
  /** POST 에만 있다. GET(자료 갱신)은 본문이 없다. */
  readonly body?: string;
  readonly signal: AbortSignal;
}

/** 전송이 돌려주는 응답. fetch 의 Response 가 그대로 맞는다. */
export interface TransportResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

/** fetch 모양의 전송 함수. 연결 실패나 취소(abort)는 거절(reject)로 알린다. */
export type Transport = (url: string, init: TransportInit) => Promise<TransportResponse>;

/** 클라이언트 로그 한 줄 (AC-016l). 종류와 상태 번호만 담고 시도 식별자·입력·금액은 담지 않는다. */
export interface ClientLogEntry {
  readonly level: 'warn' | 'error';
  readonly code: string;
  readonly status?: number;
}

/** 단계 수준의 익명 분석 이벤트 (기획서 §8, AC-016l). 화면 이름과 결말 종류뿐이며 입력값·식별자는 담지 않는다. */
export type AnalyticsEvent =
  | { readonly type: 'SCREEN'; readonly screen: ScreenState }
  | { readonly type: 'ESTIMATE_OUTCOME'; readonly outcome: SettleOutcome }
  | { readonly type: 'REFRESH_OUTCOME'; readonly outcome: RefreshOutcome };

export interface KioskDeps {
  /** 지금 시각(밀리초). 흐름의 차이만 쓰므로 어느 기준이든 단조 증가하면 된다. 기본값은 성능 시계라 벽시계 조정에 흔들리지 않는다. */
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** 초기화마다 새 세션 식별자를 만든다(DD-09). 기본값은 crypto.randomUUID(). */
  newSessionId(): string;
  /** 계산 시도마다 새 식별자를 만든다(DD-09). 키오스크 메모리 안에서만 쓰고 요청·저장소·로그·분석에 싣지 않는다. 기본값은 crypto.randomUUID(). */
  newRequestId(): string;
  /** 자료 갱신 시도마다 새 식별자를 만든다(DD-09 규칙 4). 계산 시도 식별자와 다른 값이고 같은 방식으로 메모리에만 둔다. 기본값은 crypto.randomUUID(). */
  newRefreshId(): string;
  /**
   * 계산 요청·자료 갱신의 전송. 기본값은 전역 fetch 를 부를 때마다 찾아 쓰고, 익명이고 저장되지 않는 호출로 보낸다:
   * 쿠키·인증을 싣지 않고(credentials 'omit') 응답을 캐시하지 않는다(cache 'no-store', DD-14·DD-19의 no-store).
   */
  transport: Transport;
  /** 계산 요청 시도 하나의 시간 제한(밀리초). 넘으면 그 시도는 EXPIRED 로 끝난다(plan.md §E #21). 기본값 15초는 수락된 제안값이다. */
  requestTimeoutMs: number;
  /** 자료 갱신 시도 하나(두 GET 전체)의 시간 제한(밀리초). 계산 요청의 제한과 같은 값을 기본으로 쓴다(DD-09 규칙 7). */
  refreshTimeoutMs: number;
  log(entry: ClientLogEntry): void;
  analytics(event: AnalyticsEvent): void;
}

// @MX:NOTE: [AUTO] setTimeout 은 2^31-1 ms(약 24.8일)를 넘는 지연을 1 ms 로 줄여 바로 울린다. 병원 정책의 큰 임계값이나 주입한 시간 제한이 이 값을 넘어도 타이머가 즉시 울리며
// 바쁜 반복을 하지 않도록 모든 타이머 지연은 이 상한으로 줄여 건다. 무조작 일정은 일찍 울리면 TICK 이 거절되고 남은 시간으로 다시 걸리므로 제 시각에 수렴한다.
// 요청·갱신 시간 제한은 상한에서 만료된다(24.8일보다 긴 제한은 의미가 없다).
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** 타이머에 거는 지연: 음수는 0, 상한을 넘으면 상한이다. */
export function timerDelay(delayMs: number): number {
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(0, delayMs));
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_REFRESH_TIMEOUT_MS = 15_000;

/** 주입하지 않은 칸은 기본값으로 채운다. 기본값은 전역을 호출 시점에 찾는다. */
export function resolveDeps(partial: Partial<KioskDeps>): KioskDeps {
  return {
    now: partial.now ?? (() => performance.now()),
    setTimeout: partial.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
    clearTimeout: partial.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
    newSessionId: partial.newSessionId ?? (() => crypto.randomUUID()),
    newRequestId: partial.newRequestId ?? (() => crypto.randomUUID()),
    newRefreshId: partial.newRefreshId ?? (() => crypto.randomUUID()),
    transport: partial.transport ?? ((url, init) => fetch(url, { ...init, credentials: 'omit', cache: 'no-store' })),
    requestTimeoutMs: partial.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    refreshTimeoutMs: partial.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS,
    log: partial.log ?? (() => undefined),
    analytics: partial.analytics ?? (() => undefined),
  };
}
