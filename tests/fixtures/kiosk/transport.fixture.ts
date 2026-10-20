import { vi } from 'vitest';
import type { CatalogDto, EstimateResponseDto, EstimateResultState, OptionsDto } from '../../../src/app/kiosk/state/api-types';
import { createKioskController, createKioskControllerFromState } from '../../../src/app/kiosk/state/controller';
import type { KioskController } from '../../../src/app/kiosk/state/controller';
import type { AnalyticsEvent, ClientLogEntry, KioskDeps, Transport, TransportInit } from '../../../src/app/kiosk/state/deps';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { makeCatalog, makeOptions, T_KIDNEY_SPRAY, T_XRAY } from './clinic.fixture';
import { markerIds, sequenceIds } from './state.fixture';

// 시험 자료(TEST_FIXTURE). 계산 요청 생명주기 시험이 쓰는 전송 대역과 키오스크 조립 도구.
// 전송은 호출마다 약속(promise)을 쥐고 있다가 시험이 결말을 정해 주는 대역이다: 응답 시점을 시험이 정한다. 취소 신호(signal)를 일부러 무시할 수도 있다.

export interface PendingCall {
  readonly url: string;
  readonly init: TransportInit;
  /** 이 호출의 본문을 파싱한 값(POST 만). */
  body(): Record<string, unknown>;
  respond(status: number, body: unknown): void;
  /** 응답 본문을 읽다가 실패하는 응답 (JSON 이 아님). */
  respondUnreadable(status: number): void;
  /** 연결 실패. */
  fail(): void;
}

export interface FakeTransport {
  readonly transport: Transport;
  /** 모든 호출(계산 요청 POST 와 갱신 GET 모두). */
  readonly calls: PendingCall[];
  /** 계산 요청(POST) 호출만. */
  estimateCalls(): PendingCall[];
  /** 갱신(GET) 호출만, 보낸 순서대로. */
  refreshCalls(): PendingCall[];
}

export function fakeTransport(): FakeTransport {
  const calls: PendingCall[] = [];
  const transport: Transport = (url, init) =>
    new Promise((resolve, reject) => {
      calls.push({
        url,
        init,
        body: () => JSON.parse(init.body ?? 'null') as Record<string, unknown>,
        respond: (status, body) => resolve({ status, json: () => Promise.resolve(body) }),
        respondUnreadable: (status) => resolve({ status, json: () => Promise.reject(new Error('TEST_FIXTURE: JSON 이 아니다')) }),
        fail: () => reject(new Error('TEST_FIXTURE: 연결 실패')),
      });
    });
  return { transport, calls, estimateCalls: () => calls.filter((call) => call.init.method === 'POST'), refreshCalls: () => calls.filter((call) => call.init.method === 'GET') };
}

/** 200 응답 본문: 결과 종류만 바꾼 최소의 올바른 모양. 서류는 보류이면 null, 아니면 서류 규칙이 없는 모양이다. */
export function estimateOk(state: EstimateResultState = 'ESTIMATED'): EstimateResponseDto {
  return {
    versions: { catalogVersion: 'TEST_FIXTURE_CATALOG_V1', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1', ruleBundleStatus: state === 'ON_HOLD' ? 'SUSPENDED' : 'ACTIVE', profile: null },
    origin: 'TEST_FIXTURE',
    result: {
      state,
      amounts: { hospitalPayment: 124_000, baseFeeIncluded: 'NOT_REGISTERED', expectedInsurancePayout: state === 'ON_HOLD' ? null : 60_000, expectedOutOfPocketAfterPayout: state === 'ON_HOLD' ? null : 64_000 },
      lines: [],
      groups: [],
      referenceGroups: [],
      assumptions: [],
      holdReasons: [],
      excludedItems: [],
      basis: { ruleBundleId: null, profile: null, steps: [] },
    },
    documents: state === 'ON_HOLD' ? null : { state: 'RULES_UNAVAILABLE' },
  };
}

export const MISMATCH_BODY = { error: 'VERSION_MISMATCH', latest: { catalogVersion: 'TEST_FIXTURE_CATALOG_V2', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1', ruleBundleStatus: 'ACTIVE' }, changes: { priceChanged: true, ruleChanged: false, treatmentsUnpublished: [] } };
/** catalog·options GET 응답 본문: 기본 병원 자료에서 만든다. 치료 목록이나 버전을 바꿔 "새로 받은 자료"를 만든다. */
export function catalogBody(overrides: Partial<CatalogDto> = {}): CatalogDto {
  return makeCatalog({ catalogVersion: 'TEST_FIXTURE_CATALOG_V2', ...overrides });
}
export function optionsBody(overrides: Partial<OptionsDto> = {}): OptionsDto {
  return makeOptions({ ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V2', ...overrides });
}

export const errorBody = (error: string): { error: string } => ({ error });

/** 응답 한 건: 상태 번호와 본문. */
export interface Reply {
  readonly status: number;
  readonly body: unknown;
}
export const REPLIES = {
  ok: (state: EstimateResultState = 'ESTIMATED'): Reply => ({ status: 200, body: estimateOk(state) }),
  mismatch: { status: 409, body: MISMATCH_BODY },
  noTreatment: { status: 422, body: errorBody('NO_TREATMENT_SELECTED') },
  notPublished: { status: 422, body: errorBody('TREATMENT_NOT_PUBLISHED') },
  unsupportedGeneration: { status: 422, body: errorBody('UNSUPPORTED_GENERATION') },
  badRequest: { status: 400, body: errorBody('INVALID_REQUEST') },
  notFound: { status: 404, body: errorBody('CLINIC_NOT_FOUND') },
  serverError: { status: 500, body: errorBody('INTERNAL_ERROR') },
} as const;

export interface Kiosk {
  readonly controller: KioskController;
  readonly transport: FakeTransport;
  readonly logs: ClientLogEntry[];
  readonly analytics: AnalyticsEvent[];
  /** 요청 시간 제한 타이머(지연이 requestTimeoutMs 인 것)가 걸릴 때마다 그 콜백. 이미 풀린 타이머의 콜백을 직접 부르는 시험에 쓴다. */
  readonly requestTimerCallbacks: Array<() => void>;
  /** 갱신 시간 제한 타이머(지연이 refreshTimeoutMs 인 것)의 콜백. */
  readonly refreshTimerCallbacks: Array<() => void>;
  /** AbortController.prototype.abort 호출 수. */
  abortCalls(): number;
  dispose(): void;
}

export const REQUEST_TIMEOUT_MS = 15_000;
// 계산 요청의 제한(15초)과 다른 값이어야 시간 제한 타이머 콜백을 지연으로 가려 모을 수 있다.
export const REFRESH_TIMEOUT_MS = 17_000;

/** 표지 값 발급기: 계산 시도 `RID-TEST-0001...`, 갱신 시도 `RFR-TEST-0001...`, 세션 `NEW-1...`. */
export function markers(): Pick<KioskDeps, 'newRequestId' | 'newRefreshId' | 'newSessionId'> {
  return { newRequestId: markerIds('RID-TEST'), newRefreshId: markerIds('RFR-TEST'), newSessionId: sequenceIds('NEW') };
}

export interface KioskOptions {
  readonly requestTimeoutMs?: number;
  /** 갱신 시간 제한. 기본은 아주 길어서(500초) 계산 요청 시험에서 갱신이 끼어들어 만료되지 않는다. */
  readonly refreshTimeoutMs?: number;
  /** abort() 가 아무 일도 하지 않게 한다 (AC-016i: 취소 없이 requestId 보호만으로 막힌다). */
  readonly abortDoesNothing?: boolean;
  /** 주어진 상태에서 시작한다(활성 요청이 있는 상태를 직접 구성하는 시험). 없으면 K00_Start 의 빈 세션이다. */
  readonly from?: KioskState;
}

/**
 * 가짜 시계 위에서 시작한 키오스크: 전송·로그·분석·요청 타이머를 가로채 기록한다. 시계와 타이머는 전역(가짜 시계가 가로챈 것)을 쓴다.
 * 호출하는 쪽이 vi.useFakeTimers() 를 먼저 불러야 한다.
 */
export function startKiosk(options: KioskOptions = {}): Kiosk {
  const transport = fakeTransport();
  const logs: ClientLogEntry[] = [];
  const analytics: AnalyticsEvent[] = [];
  const requestTimerCallbacks: Array<() => void> = [];
  const refreshTimerCallbacks: Array<() => void> = [];
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const refreshTimeoutMs = options.refreshTimeoutMs ?? 500_000;
  const abort = vi.spyOn(AbortController.prototype, 'abort');
  if (options.abortDoesNothing === true) abort.mockImplementation(() => undefined);
  const deps = {
    ...markers(),
    transport: transport.transport,
    requestTimeoutMs,
    refreshTimeoutMs,
    log: (entry: ClientLogEntry) => logs.push(entry),
    analytics: (event: AnalyticsEvent) => analytics.push(event),
    setTimeout: (callback: () => void, delayMs: number) => {
      if (delayMs === requestTimeoutMs) requestTimerCallbacks.push(callback);
      if (delayMs === refreshTimeoutMs) refreshTimerCallbacks.push(callback);
      return setTimeout(callback, delayMs);
    },
  };
  const controller = options.from === undefined ? createKioskController(deps, { catalog: makeCatalog(), options: makeOptions() }) : createKioskControllerFromState(deps, options.from);
  return {
    controller,
    transport,
    logs,
    analytics,
    requestTimerCallbacks,
    refreshTimerCallbacks,
    abortCalls: () => abort.mock.calls.length,
    dispose: () => {
      controller.dispose();
      abort.mockRestore();
    },
  };
}

/** 시작 화면에서 4단계까지 실제 사건으로 진행한다 (세대 2, 형태 NON_LIFE, 원인 UNKNOWN, 치료 둘). */
export function goToTreatments(kiosk: Kiosk): void {
  const { controller } = kiosk;
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
    controller.dispatch(event);
  }
}
