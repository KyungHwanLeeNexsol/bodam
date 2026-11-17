import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REQUEST_TIMEOUT_MS, resolveDeps } from '../../../src/app/kiosk/state/deps';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import {
  abortsOnSettle,
  beginRequest,
  buildEstimateBody,
  buildEstimateCall,
  canBeginRequest,
  cancelRequest,
  classifyResponse,
  isEstimateOutcomeEvent,
  isLoading,
  outcomeOfEvent,
  settleOnEvent,
  settleRequest,
  settlementOf,
} from '../../../src/app/kiosk/state/request';
import type { SettleOutcome } from '../../../src/app/kiosk/state/request';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { createClinicData } from '../../../src/app/kiosk/state/session-store';
import { makeCatalog, makeOptions, T_XRAY } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, markerIds, stateAt } from '../../fixtures/kiosk/state.fixture';
import { REPLIES, errorBody, estimateOk } from '../../fixtures/kiosk/transport.fixture';

// 계산 요청 생명주기의 순수 함수를 직접 본다 (design.md DD-09 "요청 생명주기" 1~3단계, DD-19 클라이언트 처리 표).
// 부수 효과(타이머·취소·전송)는 request-lifecycle.test.ts 가 컨트롤러 위에서 본다.

afterEach(() => {
  vi.unstubAllGlobals();
});

const env = makeEnv(5_000, undefined, markerIds('RID-UNIT'));
const k03 = (patch: Partial<KioskState> = {}): KioskState => stateAt('K03_Treatments', { inputs: FULL_INPUTS, inputRevision: 2, ...patch });
const inFlight = (patch: Partial<KioskState> = {}, requestId = 'RID-UNIT-A'): KioskState => {
  const base = stateAt('Calculating', { inputs: FULL_INPUTS, inputRevision: 2, ...patch });
  return { ...base, activeRequest: { requestId, sessionId: base.sessionId, inputRevision: base.inputRevision } };
};

describe('settleRequest 1단계: 활성 요청과 맞지 않으면 아무것도 바꾸지 않는다', () => {
  it('활성 요청이 없다', () => {
    const state = k03();
    expect(settleRequest(state, 'RID-UNIT-A', { outcome: 'FAILED' })).toBe(state);
  });

  it('requestId 가 다르다', () => {
    const state = inFlight();
    expect(settleRequest(state, 'RID-UNIT-OTHER', { outcome: 'FAILED' })).toBe(state);
  });

  it('활성 요청의 sessionId 가 지금 세션과 다르다 (방어): 완료 계열 결말은 버리고 상태 참조가 그대로다', () => {
    const state = { ...inFlight(), sessionId: 'SESSION-OTHER' };
    for (const outcome of ['FAILED', 'EXPIRED'] as const) expect(settleRequest(state, 'RID-UNIT-A', { outcome })).toBe(state);
    expect(settleRequest(state, 'RID-UNIT-A', { outcome: 'SUCCEEDED', response: estimateOk() })).toBe(state);
  });

  it('활성 요청의 inputRevision 이 지금과 다르다 (방어): 완료 계열 결말은 버린다', () => {
    const state = { ...inFlight(), inputRevision: 99 };
    expect(settleRequest(state, 'RID-UNIT-A', { outcome: 'VERSION_MISMATCH' })).toBe(state);
  });

  it('취소는 requestId 만 본다: 세션·입력 번호가 어긋난 활성 요청도 풀린다 (초기화·입력 변경이 자기 값을 바꾸기 전에 부르는 정리다)', () => {
    const state = { ...inFlight(), sessionId: 'SESSION-OTHER', inputRevision: 99 };
    const released = settleRequest(state, 'RID-UNIT-A', { outcome: 'CANCELLED' });
    expect(released.activeRequest).toBeNull();
    expect(released.screen).toBe('Calculating');
    expect(cancelRequest(state).activeRequest).toBeNull();
  });
});

describe('settleRequest 2·3단계: 풀고 나서 화면을 바꾼다 (한 번에)', () => {
  it.each([
    [{ outcome: 'FAILED' }, 'KXX_Error_Network'],
    [{ outcome: 'EXPIRED' }, 'KXX_Error_Network'],
    [{ outcome: 'VERSION_MISMATCH' }, 'K03_Treatments'],
    [{ outcome: 'REJECTED', code: 'NO_TREATMENT_SELECTED' }, 'K03_Treatments'],
    [{ outcome: 'REJECTED', code: 'TREATMENT_NOT_PUBLISHED' }, 'K03_Treatments'],
    [{ outcome: 'CANCELLED' }, 'Calculating'],
  ] as const)('%j -> %s', (settlement, screen) => {
    const state = inFlight();
    const next = settleRequest(state, 'RID-UNIT-A', settlement);
    expect(next.activeRequest).toBeNull();
    expect(isLoading(next)).toBe(false);
    expect(next.screen).toBe(screen);
    expect(next.inputs).toBe(state.inputs);
    expect(next.lastInteractionAt).toBe(state.lastInteractionAt);
    expect(next.derived).toBe(state.derived);
  });

  it('첫 유효 호출만 처리하고 같은 시도의 다음 호출은 같은 상태 참조를 돌려준다', () => {
    const state = inFlight();
    const first = settleRequest(state, 'RID-UNIT-A', { outcome: 'FAILED' });
    expect(first).not.toBe(state);
    expect(settleRequest(first, 'RID-UNIT-A', { outcome: 'FAILED' })).toBe(first);
    expect(settleRequest(first, 'RID-UNIT-A', { outcome: 'SUCCEEDED', response: estimateOk() })).toBe(first);
  });

  it('settleRequest 자체는 갱신을 시작하지 않는다: 409·422 의 갱신은 settleOnEvent 가 이어서 시작한다', () => {
    for (const settlement of [{ outcome: 'VERSION_MISMATCH' }, { outcome: 'REJECTED', code: 'TREATMENT_NOT_PUBLISHED' }] as const) {
      const next = settleRequest(inFlight(), 'RID-UNIT-A', settlement);
      expect(next.refreshState).toBe('NONE');
      expect(next.activeRefresh).toBeNull();
    }
  });

  it('성공: 결과(응답 전체)와 서류를 저장하고 근거·복귀 정보는 비운 채 두며, 결과 종류별 화면으로 간다', () => {
    const response = estimateOk('ESTIMATED_WITH_EXCLUSIONS');
    const next = settleRequest(inFlight(), 'RID-UNIT-A', { outcome: 'SUCCEEDED', response });
    expect(next.screen).toBe('K04_Result_NotCovered');
    expect(next.derived.estimate).toEqual({ state: 'ESTIMATED_WITH_EXCLUSIONS', response });
    expect(next.derived.estimate?.response).toBe(response);
    expect(next.derived.documents).toBe(response.documents);
    expect(next.derived.basis).toBeNull();
    expect(next.derived.returnContext).toBeNull();
  });
});

describe('결말 사건과 결말', () => {
  it('settleOnEvent: 맞지 않으면 null (전이 함수가 거절로 다룬다), 맞으면 새 상태', () => {
    const state = inFlight();
    expect(settleOnEvent(state, { type: 'ESTIMATE_FAILED', requestId: 'RID-UNIT-X' }, env)).toBeNull();
    expect(settleOnEvent(state, { type: 'ESTIMATE_EXPIRED', requestId: 'RID-UNIT-A' }, env)?.screen).toBe('KXX_Error_Network');
    expect(settleOnEvent(state, { type: 'ESTIMATE_FAILED', requestId: 'RID-UNIT-A' }, env)?.screen).toBe('KXX_Error_Network');
    expect(settleOnEvent(state, { type: 'ESTIMATE_RESPONDED', requestId: 'RID-UNIT-A', status: 200, body: REPLIES.ok('ON_HOLD').body }, env)?.screen).toBe('K04_Result_Hold');
  });

  it('settleOnEvent: 409 와 422 TREATMENT_NOT_PUBLISHED 는 요청을 푼 같은 전이에서 갱신을 시작한다. 맞지 않는(늦은) 409 는 갱신을 시작하지 못한다', () => {
    const state = inFlight();
    const mismatch = settleOnEvent(state, { type: 'ESTIMATE_RESPONDED', requestId: 'RID-UNIT-A', status: 409, body: REPLIES.mismatch.body }, env);
    expect(mismatch).toMatchObject({ screen: 'K03_Treatments', activeRequest: null, refreshState: 'RUNNING', activeRefresh: { reason: 'VERSION_MISMATCH' } });
    const unpublished = settleOnEvent(state, { type: 'ESTIMATE_RESPONDED', requestId: 'RID-UNIT-A', status: 422, body: REPLIES.notPublished.body }, env);
    expect(unpublished?.activeRefresh?.reason).toBe('TREATMENT_NOT_PUBLISHED');
    expect(settleOnEvent(state, { type: 'ESTIMATE_RESPONDED', requestId: 'RID-UNIT-OLD', status: 409, body: REPLIES.mismatch.body }, env)).toBeNull();
    const noTreatment = settleOnEvent(state, { type: 'ESTIMATE_RESPONDED', requestId: 'RID-UNIT-A', status: 422, body: REPLIES.noTreatment.body }, env);
    expect(noTreatment).toMatchObject({ screen: 'K03_Treatments', refreshState: 'NONE', activeRefresh: null });
  });

  it('settlementOf / outcomeOfEvent: 결말 사건은 그 결말, 그 밖의 사건이 활성 요청을 풀면 CANCELLED, 첫 동기화(사건 없음)도 CANCELLED', () => {
    const rid = 'RID-UNIT-A';
    expect(settlementOf({ type: 'ESTIMATE_EXPIRED', requestId: rid })).toEqual({ outcome: 'EXPIRED' });
    expect(settlementOf({ type: 'ESTIMATE_FAILED', requestId: rid })).toEqual({ outcome: 'FAILED' });
    expect(outcomeOfEvent({ type: 'ESTIMATE_RESPONDED', requestId: rid, status: 409, body: REPLIES.mismatch.body })).toBe('VERSION_MISMATCH');
    for (const event of [{ type: 'REQUEST_HOME' }, { type: 'CONFIRM_RESET' }, { type: 'PAGE_RESTORED' }, { type: 'TICK' }, { type: 'REQUEST_ESTIMATE' }] as KioskEvent[]) {
      expect(isEstimateOutcomeEvent(event), event.type).toBe(false);
      expect(outcomeOfEvent(event), event.type).toBe('CANCELLED');
    }
    expect(outcomeOfEvent(null)).toBe('CANCELLED');
  });

  it('abortsOnSettle: 시간 초과와 취소 계열만 취소 수단을 쓴다. 이미 끝난 요청은 아니다', () => {
    const all: SettleOutcome[] = ['SUCCEEDED', 'VERSION_MISMATCH', 'REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED'];
    expect(all.filter(abortsOnSettle)).toEqual(['EXPIRED', 'CANCELLED']);
  });
});

describe('classifyResponse (DD-19 클라이언트 처리 표)', () => {
  it.each([
    [200, estimateOk('ESTIMATED'), 'SUCCEEDED'],
    [200, estimateOk('ESTIMATED_WITH_EXCLUSIONS'), 'SUCCEEDED'],
    [200, estimateOk('ON_HOLD'), 'SUCCEEDED'],
    [409, REPLIES.mismatch.body, 'VERSION_MISMATCH'],
    [422, errorBody('NO_TREATMENT_SELECTED'), 'REJECTED'],
    [422, errorBody('TREATMENT_NOT_PUBLISHED'), 'REJECTED'],
    [422, errorBody('UNSUPPORTED_GENERATION'), 'FAILED'],
    [400, errorBody('INVALID_REQUEST'), 'FAILED'],
    [404, errorBody('CLINIC_NOT_FOUND'), 'FAILED'],
    [500, errorBody('INTERNAL_ERROR'), 'FAILED'],
    [503, undefined, 'FAILED'],
    [409, errorBody('OTHER'), 'FAILED'],
    [409, undefined, 'FAILED'],
    [200, undefined, 'FAILED'],
    [200, [], 'FAILED'],
    [200, { ...estimateOk(), result: null }, 'FAILED'],
    [200, { ...estimateOk(), versions: 'x' }, 'FAILED'],
    [201, estimateOk(), 'FAILED'],
  ])('상태 %i, 본문 %j -> %s', (status, body, outcome) => {
    expect(classifyResponse(status, body).outcome).toBe(outcome);
  });

  it('금액이 숫자가 아닌 200 은 결과로 쓰지 않는다 (0원이나 빈 결과를 만들지 않는다)', () => {
    const broken = estimateOk();
    const body = { ...broken, result: { ...broken.result, amounts: { ...broken.result.amounts, hospitalPayment: '124000' } } };
    expect(classifyResponse(200, body)).toEqual({ outcome: 'FAILED' });
  });

  // 200 본문의 금액 검사 (DD-19, AC-013d): 읽을 수 없는 본문은 결과가 아니라 통신 오류이고, 0원이나 빈 결과를 만들지 않는다.
  // 서버는 보류(ON_HOLD)일 때만 보험금 두 값을 null 로 내고 그 밖의 결과(정상·보장 제외)는 숫자로 낸다 (engine types.ts EstimateResult.amounts).
  const withAmounts = (state: 'ESTIMATED' | 'ESTIMATED_WITH_EXCLUSIONS' | 'ON_HOLD', amounts: Record<string, unknown>) => {
    const base = estimateOk(state);
    return { ...base, result: { ...base.result, amounts: { ...base.result.amounts, ...amounts } } };
  };

  it.each([
    ['병원 결제액이 음수 소수다', 'ESTIMATED', { hospitalPayment: -5.5 }],
    ['병원 결제액이 음수다', 'ESTIMATED', { hospitalPayment: -1 }],
    ['병원 결제액이 소수다', 'ESTIMATED', { hospitalPayment: 1.5 }],
    ['병원 결제액이 -0 이다', 'ESTIMATED', { hospitalPayment: -0 }],
    ['병원 결제액이 NaN 이다', 'ESTIMATED', { hospitalPayment: Number.NaN }],
    ['병원 결제액이 무한대다', 'ESTIMATED', { hospitalPayment: Number.POSITIVE_INFINITY }],
    ['병원 결제액이 안전한 정수 범위를 넘는다', 'ESTIMATED', { hospitalPayment: Number.MAX_SAFE_INTEGER + 2 }],
    ['병원 결제액이 null 이다', 'ESTIMATED', { hospitalPayment: null }],
    ['병원 결제액이 없다', 'ESTIMATED', { hospitalPayment: undefined }],
    ['정상 결과인데 예상 보험금이 없다', 'ESTIMATED', { expectedInsurancePayout: undefined }],
    ['정상 결과인데 예상 보험금이 null 이다', 'ESTIMATED', { expectedInsurancePayout: null }],
    ['정상 결과인데 보험금 후 부담액이 없다', 'ESTIMATED', { expectedOutOfPocketAfterPayout: undefined }],
    ['정상 결과인데 보험금 후 부담액이 null 이다', 'ESTIMATED', { expectedOutOfPocketAfterPayout: null }],
    ['정상 결과인데 예상 보험금이 음수다', 'ESTIMATED', { expectedInsurancePayout: -1 }],
    ['정상 결과인데 보험금 후 부담액이 소수다', 'ESTIMATED', { expectedOutOfPocketAfterPayout: 0.5 }],
    ['정상 결과인데 예상 보험금이 문자열이다', 'ESTIMATED', { expectedInsurancePayout: '60000' }],
    ['보장 제외 결과인데 예상 보험금이 없다', 'ESTIMATED_WITH_EXCLUSIONS', { expectedInsurancePayout: undefined }],
    ['보장 제외 결과인데 보험금 후 부담액이 null 이다', 'ESTIMATED_WITH_EXCLUSIONS', { expectedOutOfPocketAfterPayout: null }],
    ['보류 결과인데 예상 보험금이 숫자다', 'ON_HOLD', { expectedInsurancePayout: 1_000 }],
    ['보류 결과인데 보험금 후 부담액이 숫자다', 'ON_HOLD', { expectedOutOfPocketAfterPayout: 1_000 }],
    ['보류 결과인데 보험금 칸이 없다(null 이 아니다)', 'ON_HOLD', { expectedInsurancePayout: undefined }],
  ] as const)('금액이 계약과 다르면(%s) FAILED 다', (_name, state, amounts) => {
    expect(classifyResponse(200, withAmounts(state, amounts))).toEqual({ outcome: 'FAILED' });
  });

  it.each([
    ['정상', 'ESTIMATED', {}],
    ['보장 제외', 'ESTIMATED_WITH_EXCLUSIONS', {}],
    ['보류 (보험금 두 값 null)', 'ON_HOLD', {}],
    ['금액 0 은 숫자로서 유효하다 (0원의 의미는 서버가 정한다)', 'ESTIMATED', { hospitalPayment: 0, expectedInsurancePayout: 0, expectedOutOfPocketAfterPayout: 0 }],
    ['병원 결제액이 엔진의 줄 상한(10억)을 넘는 합계도 안전한 정수면 유효하다', 'ESTIMATED', { hospitalPayment: 3_000_000_000 }],
  ] as const)('계약대로의 금액은(%s) SUCCEEDED 다', (_name, state, amounts) => {
    expect(classifyResponse(200, withAmounts(state, amounts)).outcome).toBe('SUCCEEDED');
  });

  it('성공은 응답 전체를 그대로 싣는다', () => {
    const body = estimateOk();
    const settlement = classifyResponse(200, body);
    expect(settlement.outcome === 'SUCCEEDED' && settlement.response).toBe(body);
  });
});

describe('요청 본문과 시작', () => {
  it('본문은 여섯 필드가 정해진 순서이고, 치료 목록은 상태의 배열을 그대로 쓰지 않고 복사한다', () => {
    const state = k03();
    const body = buildEstimateBody(state);
    expect(Object.keys(body ?? {})).toEqual(['catalogVersion', 'ruleBundleVersion', 'generation', 'insurerType', 'cause', 'treatmentIds']);
    expect(body?.treatmentIds).toEqual(state.inputs.treatmentIds);
    expect(body?.treatmentIds).not.toBe(state.inputs.treatmentIds);
  });

  it.each([
    ['세대 없음', { inputs: { ...FULL_INPUTS, generation: null } }],
    ['형태 없음', { inputs: { ...FULL_INPUTS, insurerType: null } }],
    ['원인 없음', { inputs: { ...FULL_INPUTS, cause: null } }],
    ['치료 없음', { inputs: { ...FULL_INPUTS, treatmentIds: [] } }],
    ['카탈로그를 게시한 적 없는 병원 (catalogVersion null)', { clinic: createClinicData(makeCatalog({ catalogVersion: null }), makeOptions()) }],
  ])('보낼 본문이 없다: %s', (_name, patch) => {
    expect(buildEstimateBody(k03(patch))).toBeNull();
    expect(buildEstimateCall(k03(patch))).toBeNull();
    expect(canBeginRequest(k03(patch))).toBe(false);
    expect(beginRequest(k03(patch), env)).toBeNull();
  });

  it('규칙 묶음이 없는 병원은 ruleBundleVersion 을 null 로 보낸다', () => {
    const state = k03({ clinic: createClinicData(makeCatalog(), makeOptions({ ruleBundleVersion: null })) });
    expect(buildEstimateBody(state)?.ruleBundleVersion).toBeNull();
  });

  it('주소의 slug 는 경로 조각으로 인코딩한다', () => {
    const catalog = makeCatalog({ clinic: { slug: 'a b/c', displayName: 'x', setting: 'OUTPATIENT_ONLY' } });
    expect(buildEstimateCall(k03({ clinic: createClinicData(catalog, makeOptions()) }))?.url).toBe('/api/clinics/a%20b%2Fc/estimate');
  });

  it('beginRequest: K03 에서 새 시도를 활성 요청으로 기록하고 Calculating 으로 간다. 식별자는 env 발급기에서 한 번만 받는다', () => {
    const state = k03();
    const next = beginRequest(state, env);
    expect(next?.screen).toBe('Calculating');
    expect(next?.activeRequest).toEqual({ requestId: 'RID-UNIT-0001', sessionId: state.sessionId, inputRevision: 2 });
    expect(next?.inputs).toBe(state.inputs);
    expect(beginRequest(state, env)?.activeRequest?.requestId).toBe('RID-UNIT-0002');
  });

  it('beginRequest: 활성 요청이 있으면 그것을 먼저 풀고 새 시도로 교체한다', () => {
    const base = k03();
    const state = { ...base, activeRequest: { requestId: 'RID-UNIT-OLD', sessionId: base.sessionId, inputRevision: base.inputRevision } };
    const next = beginRequest(state, env);
    expect(next?.activeRequest?.requestId).toMatch(/^RID-UNIT-[0-9]{4}$/);
    expect(next?.activeRequest).toEqual({ requestId: expect.not.stringContaining('OLD'), sessionId: base.sessionId, inputRevision: base.inputRevision });
  });

  it('KXX_Error_Network 의 "다시 시도"도 같은 입력으로 시작한다. 갱신이 필요하면 시작하지 않는다', () => {
    const retry = stateAt('KXX_Error_Network', { inputs: FULL_INPUTS, inputRevision: 2 });
    expect(beginRequest(retry, env)?.activeRequest?.inputRevision).toBe(2);
    expect(beginRequest({ ...retry, refreshState: 'FAILED' }, env)).toBeNull();
    expect(beginRequest({ ...retry, refreshState: 'RUNNING' }, env)).toBeNull();
    expect(beginRequest(stateAt('K04_Result', { inputs: FULL_INPUTS }), env)).toBeNull();
  });

  it('치료 id 한 개짜리 선택도 본문이 된다', () => {
    expect(buildEstimateBody(k03({ inputs: { ...FULL_INPUTS, treatmentIds: [T_XRAY] } }))?.treatmentIds).toEqual([T_XRAY]);
  });
});

describe('기본 의존성 (주입하지 않은 칸)', () => {
  it('요청 시간 제한은 15초이고 로그·분석은 아무 일도 하지 않는다', () => {
    const deps = resolveDeps({});
    expect(deps.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(deps.log({ level: 'error', code: 'X' })).toBeUndefined();
    expect(deps.analytics({ type: 'ESTIMATE_OUTCOME', outcome: 'FAILED' })).toBeUndefined();
  });

  it('계산 시도 식별자는 crypto.randomUUID 다: UUID 형식이고 부를 때마다 다르다', () => {
    const { newRequestId } = resolveDeps({});
    const first = newRequestId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newRequestId()).not.toBe(first);
  });

  it('전송의 기본값은 전역 fetch 를 부를 때마다 찾아 쓴다 (나중에 바꿔 끼운 fetch 가 잡힌다)', async () => {
    const { transport } = resolveDeps({});
    const calls: Array<[string, unknown]> = [];
    vi.stubGlobal('fetch', (url: string, init: unknown) => {
      calls.push([url, init]);
      return Promise.resolve({ status: 204, json: () => Promise.resolve(null) });
    });
    const init = { method: 'POST', headers: {}, body: '{}', signal: new AbortController().signal } as const;
    const response = await transport('/x', init);
    expect(response.status).toBe(204);
    // 키오스크 호출은 익명이고 저장되지 않는다: 쿠키·인증을 싣지 않고(credentials omit) 응답을 캐시하지 않는다(cache no-store). default-transport.test.ts 가 전체 흐름으로 본다
    expect(calls).toEqual([['/x', { ...init, credentials: 'omit', cache: 'no-store' }]]);
  });
});

describe('200 본문의 서류 칸 (금액이 계약대로일 때)', () => {
  it('서류가 객체도 null 도 아니면 FAILED 다', () => {
    expect(classifyResponse(200, { ...estimateOk('ESTIMATED'), documents: 'x' })).toEqual({ outcome: 'FAILED' });
    expect(classifyResponse(200, { ...estimateOk('ESTIMATED'), documents: [] })).toEqual({ outcome: 'FAILED' });
  });
});
