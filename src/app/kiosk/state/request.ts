import type { EstimateResponseDto, EstimateResultState } from './api-types';
import type { TransportInit } from './deps';
import type { KioskEvent } from './events';
import { beginRefresh } from './refresh';
import type { Env, KioskState, RefreshReason, ScreenState } from './session-store';

// 계산 요청의 생명주기: 시도 시작, 결말 분류, 단 하나의 정리 지점 settleRequest (SPEC-REIMBURSEMENT-001 M5.B, design.md DD-09 "요청 생명주기", DD-19 "키오스크의 응답 처리").
// 이 모듈은 순수하다: 타이머·AbortController·전송은 만들지도 부르지도 않는다. 그 부수 효과는 컨트롤러가 활성 요청이 생기고 사라지는 것을 따라가며 한다(request-effects.ts).
// 그래서 "정리"(activeRequest 해제·로딩 표시 끔)와 화면 전이가 한 번에 일어나고, 타이머·컨트롤러의 정리는 같은 dispatch 안에서 알림보다 먼저 이어서 일어난다.
// 상태 쪽 가져오기는 타입뿐이다(session-store.ts 가 이 모듈의 cancelRequest 를 부르므로 런타임 가져오기가 순환하지 않게 한다).

/** DD-09 요청 생명주기 표의 여섯 결말. */
export type SettleOutcome = 'SUCCEEDED' | 'VERSION_MISMATCH' | 'REJECTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

/** 결말과 그 결말이 화면 처리에 필요로 하는 값. 정리(settleRequest 2단계)는 모든 결말이 같고 3단계의 화면 처리만 다르다. */
export type Settlement =
  | { readonly outcome: 'SUCCEEDED'; readonly response: EstimateResponseDto }
  | { readonly outcome: 'VERSION_MISMATCH' }
  | { readonly outcome: 'REJECTED'; readonly code: 'NO_TREATMENT_SELECTED' | 'TREATMENT_NOT_PUBLISHED' }
  | { readonly outcome: 'FAILED' | 'EXPIRED' | 'CANCELLED' };

// ───────────────────────── 요청 본문 ─────────────────────────

/** 계산 요청 본문: DD-19 의 여섯 필드뿐이고 이 순서다. 시도 식별자·가격·병원 ID 는 없다(AC-016k). */
export interface EstimateRequestBody {
  readonly catalogVersion: string;
  readonly ruleBundleVersion: string | null;
  readonly generation: string;
  readonly insurerType: string;
  readonly cause: string;
  readonly treatmentIds: readonly string[];
}

/** 지금 상태에서 보낼 수 있는 본문. 세대·형태·원인이 모두 있고, 병원이 카탈로그를 게시했고(catalogVersion 이 있고), 치료를 하나 이상 골랐을 때만 있다. */
export function buildEstimateBody(state: KioskState): EstimateRequestBody | null {
  const { generation, insurerType, cause, treatmentIds } = state.inputs;
  const { catalogVersion, ruleBundleVersion } = state.clinic.versions;
  if (generation === null || insurerType === null || cause === null || catalogVersion === null || treatmentIds.length === 0) return null;
  return { catalogVersion, ruleBundleVersion, generation, insurerType, cause, treatmentIds: [...treatmentIds] };
}

/** 본문이 없으면 null. 시도 식별자는 이 함수에 들어오지 않는다: 전송 인자를 만드는 곳이 그 값을 볼 길이 없다(AC-016k, 정적 검사로 확인). */
export function buildEstimateCall(state: KioskState): { readonly url: string; readonly init: Omit<TransportInit, 'signal'> } | null {
  const body = buildEstimateBody(state);
  if (body === null) return null;
  return {
    url: `/api/clinics/${encodeURIComponent(state.clinic.catalog.clinic.slug)}/estimate`,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  };
}

// ───────────────────────── 시작 ─────────────────────────

/**
 * "예상 부담액 확인"(통신 오류 화면은 "다시 시도")을 누를 수 있는가: 4단계이거나 통신 오류 화면이고, 보낼 본문이 있고, 갱신이 필요하지 않을 때 (DD-09 규칙 1).
 * 갱신이 필요하다는 것은 갱신이 진행 중이거나 실패해 있다는 것(refreshState !== 'NONE')이다.
 */
export function canBeginRequest(state: KioskState): boolean {
  return (
    (state.screen === 'K03_Treatments' || state.screen === 'KXX_Error_Network') &&
    state.refreshState === 'NONE' &&
    buildEstimateBody(state) !== null
  );
}

/**
 * 새 계산 시도를 시작한다: 이전 활성 요청이 있으면 먼저 CANCELLED 로 풀고, 새 시도를 활성 요청으로 기록하고 \`Calculating\` 으로 간다.
 * 이 시도의 요청 전송과 시간 제한 타이머는 컨트롤러가 활성 요청이 생긴 것을 보고 시작한다. 보낼 수 없는 상태이면 null.
 */
export function beginRequest(state: KioskState, env: Env): KioskState | null {
  if (!canBeginRequest(state)) return null;
  const settled = cancelRequest(state);
  return { ...settled, screen: 'Calculating', activeRequest: { requestId: env.newRequestId(), sessionId: settled.sessionId, inputRevision: settled.inputRevision } };
}

// ───────────────────────── 결말 분류 (DD-19 클라이언트 처리 표) ─────────────────────────

const RESULT_SCREEN: Readonly<Record<EstimateResultState, ScreenState>> = {
  ESTIMATED: 'K04_Result',
  ESTIMATED_WITH_EXCLUSIONS: 'K04_Result_NotCovered',
  ON_HOLD: 'K04_Result_Hold',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResultState(value: unknown): value is EstimateResultState {
  return typeof value === 'string' && Object.hasOwn(RESULT_SCREEN, value);
}

/** 금액: 0 이상의 안전한 정수(−0 제외). 병원 결제액은 줄 금액의 합이라 줄 상한(10억)을 넘을 수 있어 그 상한은 보지 않는다. */
function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

/**
 * 200 본문이 키오스크가 쓰는 모양인가: 결과 종류가 세 값 안에 있고 결과·금액·버전이 객체이다. 금액은 서버 계약대로다(engine EstimateResult.amounts):
 * 병원 결제액은 항상 금액이고, 예상 보험금·보험금 후 부담액은 보류(ON_HOLD)일 때만 null 이며 그 밖의 결과(정상·보장 제외)에서는 금액이다.
 * 아니면 계약 결함이라 결과로 쓰지 않는다(0원이나 빈 결과를 화면에 올리지 않는다, AC-013d).
 */
function parseEstimateResponse(body: unknown): EstimateResponseDto | null {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.amounts) || !isRecord(body.versions)) return null;
  const { state, amounts } = body.result;
  if (!isResultState(state) || !isAmount(amounts.hospitalPayment)) return null;
  const payouts = [amounts.expectedInsurancePayout, amounts.expectedOutOfPocketAfterPayout];
  if (!payouts.every((payout) => (state === 'ON_HOLD' ? payout === null : isAmount(payout)))) return null;
  if (body.documents !== null && !isRecord(body.documents)) return null;
  return body as unknown as EstimateResponseDto;
}

/**
 * 응답(상태 번호와 파싱한 본문)을 결말로 분류한다 (DD-19):
 * 200 → SUCCEEDED, 409 \`VERSION_MISMATCH\` → VERSION_MISMATCH, 422 \`NO_TREATMENT_SELECTED\`·\`TREATMENT_NOT_PUBLISHED\` → REJECTED,
 * 그 밖의 4xx(400·404·422 \`UNSUPPORTED_GENERATION\`)·5xx·읽을 수 없는 본문 → FAILED. 어느 경우에도 0원이나 빈 결과를 만들지 않는다.
 */
export function classifyResponse(status: number, body: unknown): Settlement {
  const code = isRecord(body) && typeof body.error === 'string' ? body.error : null;
  if (status === 200) {
    const response = parseEstimateResponse(body);
    return response === null ? { outcome: 'FAILED' } : { outcome: 'SUCCEEDED', response };
  }
  if (status === 409 && code === 'VERSION_MISMATCH') return { outcome: 'VERSION_MISMATCH' };
  if (status === 422 && (code === 'NO_TREATMENT_SELECTED' || code === 'TREATMENT_NOT_PUBLISHED')) return { outcome: 'REJECTED', code };
  return { outcome: 'FAILED' };
}

export type EstimateOutcomeEvent = Extract<KioskEvent, { type: 'ESTIMATE_RESPONDED' | 'ESTIMATE_FAILED' | 'ESTIMATE_EXPIRED' }>;

export function isEstimateOutcomeEvent(event: KioskEvent): event is EstimateOutcomeEvent {
  return event.type === 'ESTIMATE_RESPONDED' || event.type === 'ESTIMATE_FAILED' || event.type === 'ESTIMATE_EXPIRED';
}

/** 결말 사건이 가리키는 결말. */
export function settlementOf(event: EstimateOutcomeEvent): Settlement {
  switch (event.type) {
    case 'ESTIMATE_RESPONDED':
      return classifyResponse(event.status, event.body);
    case 'ESTIMATE_FAILED':
      return { outcome: 'FAILED' };
    case 'ESTIMATE_EXPIRED':
      return { outcome: 'EXPIRED' };
  }
}

/** 활성 요청을 푼 사건이 만든 결말: 결말 사건이면 그 결말이고, 그 밖의 사건(초기화·입력 변경·새 시도)이 풀었다면 CANCELLED 다. */
export function outcomeOfEvent(event: KioskEvent | null): SettleOutcome {
  return event !== null && isEstimateOutcomeEvent(event) ? settlementOf(event).outcome : 'CANCELLED';
}

/** 컨트롤러가 취소 수단을 쓰는 결말: 시간 초과와 취소 계열뿐이다. 이미 끝난 요청(200·409·422·그 밖의 오류·연결 실패)은 취소할 것이 없다 (DD-09 2단계). */
export function abortsOnSettle(outcome: SettleOutcome): boolean {
  return outcome === 'EXPIRED' || outcome === 'CANCELLED';
}

// ───────────────────────── 정리와 화면 전이 ─────────────────────────

/** 결말에 따른 화면 처리 (settleRequest 3단계). 정리가 끝난 상태를 받는다. */
function enterAfter(released: KioskState, settlement: Settlement): KioskState {
  switch (settlement.outcome) {
    case 'SUCCEEDED': {
      const { response } = settlement;
      return {
        ...released,
        screen: RESULT_SCREEN[response.result.state],
        derived: { estimate: { state: response.result.state, response }, documents: response.documents, basis: null, returnContext: null },
      };
    }
    case 'VERSION_MISMATCH':
    case 'REJECTED':
      // 4단계로 간다. 결과는 저장하지 않는다. 409·422 TREATMENT_NOT_PUBLISHED 의 갱신은 settleOnEvent 가 이어서 시작한다(refreshReasonOf).
      return { ...released, screen: 'K03_Treatments' };
    case 'FAILED':
    case 'EXPIRED':
      return { ...released, screen: 'KXX_Error_Network' };
    case 'CANCELLED':
      return released;
  }
}

// @MX:ANCHOR: [AUTO] 계산 요청의 모든 결말(응답·오류·시간 초과·취소)이 거치는 유일한 정리 지점. activeRequest 를 null 로 하는 곳은 이 함수 하나다.
// @MX:REASON: 정리와 화면 전이가 흩어지면 끝난 시도의 타이머·로딩 표시가 남거나(성공한 결과가 오류 화면으로 바뀌는 결함), 늦게 온 이전 시도의 결말이 새 시도를 망가뜨린다(AC-016h~j).
// request-static.test.ts 가 이 약속을 소스에서 지킨다.
/**
 * 한 시도의 결말을 처리한다 (DD-09 요청 생명주기).
 *  1. 활성 요청이 없거나 requestId·sessionId·inputRevision 가운데 하나라도 지금과 다르면 아무것도 바꾸지 않는다(같은 상태 참조를 돌려준다).
 *     취소(CANCELLED)는 세션·입력 번호를 보지 않고 requestId 만 본다: 세션과 입력을 바꾸는 동작이 자기 값을 바꾸기 전에 부르는 정리이기 때문이다.
 *  2. 아니면 활성 요청을 풀고(로딩 표시는 활성 요청에서 읽으므로 같이 꺼진다) 나서
 *  3. 결말에 따른 화면 전이를 한 번에 한다. 어느 결말도 2를 건너뛰지 않는다.
 * 같은 시도에 여러 번 불려도 첫 유효 호출만 2·3을 하고 이후 호출은 1에서 끝난다. 무조작 시간은 건드리지 않는다.
 * 타이머·AbortController 는 이 함수가 아니라 컨트롤러가 활성 요청이 사라진 것을 보고 푼다(abortsOnSettle).
 */
export function settleRequest(state: KioskState, requestId: string, settlement: Settlement): KioskState {
  const active = state.activeRequest;
  if (active === null || active.requestId !== requestId) return state;
  if (settlement.outcome !== 'CANCELLED' && (active.sessionId !== state.sessionId || active.inputRevision !== state.inputRevision)) return state;
  return enterAfter({ ...state, activeRequest: null }, settlement);
}

/** 갱신을 시작해야 하는 결말(409, 422 TREATMENT_NOT_PUBLISHED)의 갱신 이유. 그 밖의 결말은 null (DD-19). */
function refreshReasonOf(settlement: Settlement): RefreshReason | null {
  if (settlement.outcome === 'VERSION_MISMATCH') return 'VERSION_MISMATCH';
  return settlement.outcome === 'REJECTED' && settlement.code === 'TREATMENT_NOT_PUBLISHED' ? 'TREATMENT_NOT_PUBLISHED' : null;
}

/**
 * 결말 사건을 반영한다. 버려졌으면(활성 요청과 맞지 않음) null 이라서 전이 함수가 그 사건을 거절로 다룬다.
 * 요청을 푼 뒤에 갱신을 시작하므로(DD-09 요청 생명주기) 맞지 않는 결말(늦은 409 포함)은 갱신을 시작하지 못한다. 한 전이 안에서 일어나서 구독자는 중간 상태를 보지 않는다.
 */
export function settleOnEvent(state: KioskState, event: EstimateOutcomeEvent, env: Env): KioskState | null {
  const settlement = settlementOf(event);
  const next = settleRequest(state, event.requestId, settlement);
  if (next === state) return null;
  const reason = refreshReasonOf(settlement);
  return reason === null ? next : beginRefresh(next, env, reason);
}

/** 초기화·입력 변경·새 시도로 활성 요청을 푼다. 활성 요청이 없으면 같은 상태. 이 동작이 자기 전이를 이어서 실행한다. */
export function cancelRequest(state: KioskState): KioskState {
  return state.activeRequest === null ? state : settleRequest(state, state.activeRequest.requestId, { outcome: 'CANCELLED' });
}

/** 로딩 표시가 켜져 있는가: 활성 요청이 있는 동안이다. */
export function isLoading(state: KioskState): boolean {
  return state.activeRequest !== null;
}
