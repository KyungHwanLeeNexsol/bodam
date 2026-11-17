import type { BenefitTypeCode, CatalogDto, OptionsDto } from './api-types';
import { EMPTY_DERIVED, createClinicData } from './defaults';
import type { KioskEvent } from './events';
import type { Env, KioskState, RefreshReason } from './session-store';

// catalog·options 갱신의 생명주기: 시작, 결말 분류, 단 하나의 정리 지점 settleRefresh, 한 단계 반영
// (SPEC-REIMBURSEMENT-001 M5.C, design.md DD-09 "자료 갱신 생명주기" 규칙 1~7, DD-07 표 2, DD-08 "409·422 뒤 자료 갱신 반영", DD-19).
// request.ts 와 같은 구조다: 이 모듈은 순수하고, 두 GET 요청·시간 제한 타이머·취소 수단은 컨트롤러가 활성 갱신이 생기고 사라지는 것을 따라가며 맡는다(refresh-effects.ts).
// 상태 쪽 가져오기는 타입뿐이다(session-store.ts 가 이 모듈의 cancelRefresh 를 부르므로 런타임 가져오기가 순환하지 않게 한다).

/** DD-09 갱신 생명주기의 네 결말. */
export type RefreshOutcome = 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export type RefreshSettlement =
  | { readonly outcome: 'SUCCEEDED'; readonly catalog: CatalogDto; readonly options: OptionsDto }
  | { readonly outcome: 'FAILED' | 'EXPIRED' | 'CANCELLED' };

// ───────────────────────── 시작 ─────────────────────────

/** 인라인 "다시 시도"를 누를 수 있는가: 갱신이 실패해 있는 4단계다. 이 시도는 계산이 아니라 갱신을 먼저 실행한다 (DD-09 규칙 3). */
export function canRetryRefresh(state: KioskState): boolean {
  return state.screen === 'K03_Treatments' && state.refreshState === 'FAILED' && state.activeRefresh === null;
}

/** 치료 카드와 "이전"이 잠겨 있는가: 갱신이 진행 중인 동안이다 (DD-09 규칙 5, SPEC 제안). 잠금은 화면(M6)이 이 값으로 건다: 상태 기계는 잠금을 거치지 않고 들어온 입력 변경도 받아들여 진행 중인 갱신을 취소한다(AC-020g 3). 처음으로·쪽 이동·큰 글자 전환은 입력 변경이 아니라서 잠기지 않는다. */
export function treatmentsLocked(state: KioskState): boolean {
  return state.refreshState === 'RUNNING';
}

/**
 * 새 갱신 시도를 시작한다: 이전 활성 갱신이 있으면 먼저 CANCELLED 로 풀고, 새 시도를 활성 갱신으로 기록하고 `refreshState = RUNNING` 으로 둔다.
 * 화면은 `K03_Treatments` 안에서 그대로다(새 화면 없음). 두 GET 과 시간 제한 타이머는 컨트롤러가 활성 갱신이 생긴 것을 보고 시작한다.
 */
export function beginRefresh(state: KioskState, env: Env, reason: RefreshReason): KioskState {
  const settled = cancelRefresh(state);
  return { ...settled, refreshState: 'RUNNING', activeRefresh: { refreshId: env.newRefreshId(), sessionId: settled.sessionId, inputRevision: settled.inputRevision, reason } };
}

/** 갱신이 받는 두 GET 의 주소. 갱신 식별자는 이 함수에 들어오지 않는다: 주소를 만드는 곳이 그 값을 볼 길이 없다(AC-016o, 정적 검사로 확인). */
export function buildRefreshUrls(state: KioskState): { readonly catalog: string; readonly options: string } {
  const base = `/api/clinics/${encodeURIComponent(state.clinic.catalog.clinic.slug)}`;
  return { catalog: `${base}/catalog`, options: `${base}/insurance/options` };
}

// ───────────────────────── 응답 읽기 ─────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isWon = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isBenefitType = (value: unknown): value is BenefitTypeCode => value === 'BENEFIT' || value === 'NON_BENEFIT';
const everyRecord = (value: unknown, check: (entry: Record<string, unknown>) => boolean): boolean => Array.isArray(value) && value.every((entry) => isRecord(entry) && check(entry));

/** 갱신 응답 가운데 키오스크가 읽는 칸이 계약의 모양인가. 틀린 모양은 반영하지 않는다(서버 결함이나 중간 변조를 화면에 올리지 않는다). */
function parseCatalog(body: unknown): CatalogDto | null {
  if (!isRecord(body) || !isRecord(body.clinic) || !isText(body.clinic.slug) || !isText(body.clinic.displayName) || !isText(body.serviceDisplayName)) return null;
  if (!(body.catalogVersion === null || isText(body.catalogVersion))) return null;
  if (body.baseFeeIncluded !== 'INCLUDED' && body.baseFeeIncluded !== 'NOT_REGISTERED') return null;
  if (body.idlePolicy !== undefined && !isRecord(body.idlePolicy)) return null;
  const treatment = (entry: Record<string, unknown>): boolean =>
    isText(entry.treatmentId) && isText(entry.displayName) && isText(entry.description) && isText(entry.priceCondition) && isBenefitType(entry.benefitType) && isWon(entry.patientAmount) && typeof entry.order === 'number';
  const baseFee = (entry: Record<string, unknown>): boolean => isText(entry.baseFeeId) && isText(entry.displayName) && isBenefitType(entry.benefitType) && isWon(entry.amount);
  return everyRecord(body.treatments, treatment) && everyRecord(body.baseFees, baseFee) ? (body as unknown as CatalogDto) : null;
}

function parseOptions(body: unknown): OptionsDto | null {
  if (!isRecord(body) || !(body.ruleBundleVersion === null || isText(body.ruleBundleVersion))) return null;
  if (!(body.ruleBundleStatus === null || body.ruleBundleStatus === 'ACTIVE' || body.ruleBundleStatus === 'SUSPENDED')) return null;
  if (!isRecord(body.guidance) || !isText(body.guidance.generationUnknown)) return null;
  const card = (entry: Record<string, unknown>): boolean => isText(entry.code) && isText(entry.label);
  return everyRecord(body.generations, card) && everyRecord(body.insurerTypes, card) && everyRecord(body.causes, card) ? (body as unknown as OptionsDto) : null;
}

export type RefreshOutcomeEvent = Extract<KioskEvent, { type: 'REFRESH_RESOLVED' | 'REFRESH_FAILED' | 'REFRESH_EXPIRED' }>;

export function isRefreshOutcomeEvent(event: KioskEvent): event is RefreshOutcomeEvent {
  return event.type === 'REFRESH_RESOLVED' || event.type === 'REFRESH_FAILED' || event.type === 'REFRESH_EXPIRED';
}

/**
 * 결말 사건이 가리키는 결말. 두 응답이 모두 읽을 수 있는 모양이고 같은 병원의 것일 때만 SUCCEEDED 다. 한쪽이라도 틀린 모양이거나 다른 병원의 자료면 FAILED 이고
 * 도착한 다른 쪽도 쓰지 않는다 (DD-09 규칙 3).
 */
export function refreshSettlementOf(event: RefreshOutcomeEvent, state: KioskState): RefreshSettlement {
  switch (event.type) {
    case 'REFRESH_RESOLVED': {
      const catalog = parseCatalog(event.catalog);
      const options = parseOptions(event.options);
      return catalog === null || options === null || catalog.clinic.slug !== state.clinic.catalog.clinic.slug ? { outcome: 'FAILED' } : { outcome: 'SUCCEEDED', catalog, options };
    }
    case 'REFRESH_FAILED':
      return { outcome: 'FAILED' };
    case 'REFRESH_EXPIRED':
      return { outcome: 'EXPIRED' };
  }
}

/** 활성 갱신을 푼 사건이 만든 결말: 결말 사건이면 그 결말이고, 그 밖의 사건(초기화·입력 변경·새 시도)이 풀었다면 CANCELLED 다. `previous` 는 그 사건을 적용하기 전의 상태다. */
export function outcomeOfRefreshEvent(event: KioskEvent | null, previous: KioskState): RefreshOutcome {
  return event !== null && isRefreshOutcomeEvent(event) ? refreshSettlementOf(event, previous).outcome : 'CANCELLED';
}

/** 컨트롤러가 취소 수단을 쓰는 결말: 시간 초과와 취소 계열뿐이다. 이미 끝난 갱신(성공·실패)은 취소할 것이 없다 (DD-09 규칙 4와 요청 생명주기 2단계). */
export function abortsOnRefreshSettle(outcome: RefreshOutcome): boolean {
  return outcome === 'EXPIRED' || outcome === 'CANCELLED';
}

// ───────────────────────── 정리와 반영 ─────────────────────────

/**
 * 성공한 갱신을 한 단계로 반영한다 (DD-09 규칙 2, DD-08): 게시 중인 선택만 유지하고 내려간 치료는 안내와 함께 빼고, 병원 자료·두 버전·무조작 정책을 함께 바꾸고,
 * 갱신 상태를 NONE 으로 돌린다. 합계는 새 카탈로그에서 선택자가 읽는다. 결과·서류·근거·복귀 정보는 옛 버전의 것이라 지운다.
 * 선택이 하나라도 빠졌으면 치료 묶음이 바뀐 것이므로 `inputRevision` 이 한 번 오른다. 무조작 시간은 건드리지 않는다.
 */
function applyRefresh(released: KioskState, catalog: CatalogDto, options: OptionsDto): KioskState {
  const published = new Set(catalog.treatments.map((treatment) => treatment.treatmentId));
  const { treatmentIds } = released.inputs;
  const removed = treatmentIds.filter((id) => !published.has(id));
  const base: KioskState = { ...released, clinic: createClinicData(catalog, options), refreshState: 'NONE', derived: EMPTY_DERIVED };
  if (removed.length === 0) return { ...base, refreshNotice: null };
  const nameOf = (id: string): string => released.clinic.catalog.treatments.find((treatment) => treatment.treatmentId === id)?.displayName ?? id;
  return {
    ...base,
    inputs: { ...released.inputs, treatmentIds: treatmentIds.filter((id) => published.has(id)) },
    inputRevision: released.inputRevision + 1,
    refreshNotice: { removed: removed.map((treatmentId) => ({ treatmentId, displayName: nameOf(treatmentId) })) },
  };
}

// @MX:ANCHOR: [AUTO] catalog·options 갱신의 모든 결말(성공·실패·시간 초과·취소)이 거치는 유일한 정리 지점. activeRefresh 를 null 로 하는 곳은 이 함수 하나다.
// @MX:REASON: 정리와 반영이 흩어지면 끝난 갱신의 타이머·로딩 표시가 남거나, 이전 갱신 A 의 늦은 결과가 새 갱신 B 의 결과·확인 버튼 상태를 망가뜨리거나, 초기화·입력 변경 뒤의 늦은 결과가
// 새 세션에 써진다(AC-020f·AC-020g). request-static.test.ts 가 이 약속을 소스에서 지킨다.
/**
 * 한 갱신 시도의 결말을 처리한다 (DD-09 "자료 갱신 생명주기" 규칙 4와 요청의 settleRequest 와 같은 구조).
 *  1. 활성 갱신이 없거나 refreshId·sessionId·inputRevision 가운데 하나라도 지금과 다르면 아무것도 바꾸지 않는다(같은 상태 참조). 반영 직전에 평가하므로 이 반영이 일으키는
 *     inputRevision 증가가 가드를 깨지 않는다. 취소(CANCELLED)는 세션·입력 번호를 보지 않고 refreshId 만 본다: 그 값을 바꾸는 동작이 자기 값을 바꾸기 전에 부르는 정리이기 때문이다.
 *  2. 아니면 활성 갱신을 풀고(로딩 표시는 refreshState 에서 읽으므로 같이 꺼진다)
 *  3. 성공이면 한 단계로 반영하고, 실패·시간 초과·취소이면 `refreshState = FAILED` 로 두고 아무것도 반영하지 않는다(자료·선택·합계는 이전 그대로, 확인 버튼 비활성).
 * 무조작 시간은 건드리지 않는다. 타이머·AbortController 는 이 함수가 아니라 컨트롤러가 활성 갱신이 사라진 것을 보고 푼다(abortsOnRefreshSettle).
 */
export function settleRefresh(state: KioskState, refreshId: string, settlement: RefreshSettlement): KioskState {
  const active = state.activeRefresh;
  if (active === null || active.refreshId !== refreshId) return state;
  if (settlement.outcome !== 'CANCELLED' && (active.sessionId !== state.sessionId || active.inputRevision !== state.inputRevision)) return state;
  const released: KioskState = { ...state, activeRefresh: null };
  return settlement.outcome === 'SUCCEEDED' ? applyRefresh(released, settlement.catalog, settlement.options) : { ...released, refreshState: 'FAILED' };
}

/** 결말 사건을 반영한다. 버려졌으면(활성 갱신과 맞지 않음) null 이라서 전이 함수가 그 사건을 거절로 다룬다. */
export function settleRefreshOnEvent(state: KioskState, event: RefreshOutcomeEvent): KioskState | null {
  const next = settleRefresh(state, event.refreshId, refreshSettlementOf(event, state));
  return next === state ? null : next;
}

/** 초기화·입력 변경·새 시도로 활성 갱신을 푼다. 활성 갱신이 없으면 같은 상태. 푼 갱신은 실패 상태가 된다(초기화는 이어서 NONE 으로 돌린다). */
export function cancelRefresh(state: KioskState): KioskState {
  return state.activeRefresh === null ? state : settleRefresh(state, state.activeRefresh.refreshId, { outcome: 'CANCELLED' });
}
