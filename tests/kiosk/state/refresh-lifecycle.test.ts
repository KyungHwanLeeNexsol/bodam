import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { nextSchedule } from '../../../src/app/kiosk/state/idle';
import { settleRefresh } from '../../../src/app/kiosk/state/refresh';
import { canRequestEstimate, selectRefresh, selectTotals } from '../../../src/app/kiosk/state/selectors';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { T_KIDNEY_SPRAY, T_ULTRASOUND, T_XRAY, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, stateAt } from '../../fixtures/kiosk/state.fixture';
import { REPLIES, REFRESH_TIMEOUT_MS, catalogBody, errorBody, goToTreatments, optionsBody, startKiosk } from '../../fixtures/kiosk/transport.fixture';
import type { Kiosk } from '../../fixtures/kiosk/transport.fixture';
import { SECOND, currentRefresh, flush, repriced, resolveBoth, startRefreshing, stateOf, withoutKidney, withoutSelected } from './refresh-helpers';

// 409·422 뒤 catalog·options 갱신의 생명주기를 가짜 시계와 전송 대역 위에서 본다 (design.md DD-09 "자료 갱신 생명주기" 규칙 1~7).
// 닫는 AC: AC-020c, AC-020d, AC-020e, AC-020f, AC-020g, AC-016o. 겹침창 위의 결과(표 2)는 refresh-overlays.test.ts, 소스에 대한 정적 약속은 request-static.test.ts,
// 실제 Route Handler 와의 왕복은 refresh-integration.test.ts 가 본다.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('시작: 409·422 TREATMENT_NOT_PUBLISHED 뒤', () => {
  it.each([
    ['409 VERSION_MISMATCH', REPLIES.mismatch, 'VERSION_MISMATCH'],
    ['422 TREATMENT_NOT_PUBLISHED', REPLIES.notPublished, 'TREATMENT_NOT_PUBLISHED'],
  ] as const)('%s: 같은 전이에서 요청을 풀고 K03_Treatments 에서 갱신(%s)이 시작된다 — GET 두 개, 시간 제한 타이머 하나, 구독자는 한 번만 알림을 받는다', async (_name, answer, reason) => {
    const kiosk = startKiosk();
    goToTreatments(kiosk);
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    const seen: KioskState[] = [];
    kiosk.controller.subscribe((state) => seen.push(state));
    const idleOnly = vi.getTimerCount() - 1;
    const call = kiosk.transport.estimateCalls()[0]!;
    call.respond(answer.status, answer.body);
    await flush();

    expect(seen).toHaveLength(1);
    const state = stateOf(kiosk);
    expect(state).toMatchObject({ screen: 'K03_Treatments', refreshState: 'RUNNING', activeRequest: null });
    expect(state.activeRefresh).toEqual({ refreshId: 'RFR-TEST-0001', sessionId: state.sessionId, inputRevision: state.inputRevision, reason });
    expect(state.derived.estimate).toBeNull();
    expect(selectRefresh(state)).toMatchObject({ running: true, failed: false, canRetry: false, locked: true });
    expect(vi.getTimerCount()).toBe(idleOnly + 1);
    expect(kiosk.transport.refreshCalls().map((refresh) => [refresh.init.method, refresh.url])).toEqual([
      ['GET', '/api/clinics/test-fixture-clinic-1/catalog'],
      ['GET', '/api/clinics/test-fixture-clinic-1/insurance/options'],
    ]);
    kiosk.dispose();
  });

  it('갱신 중에는 화면이 치료 카드와 "이전"을 잠그도록 selectRefresh 가 알린다. 쪽 이동·큰 글자·방향 변경·처음으로는 잠기지 않고 갱신은 계속된다 (규칙 5)', async () => {
    const kiosk = startKiosk();
    await startRefreshing(kiosk);
    const before = stateOf(kiosk);
    expect(selectRefresh(before).locked).toBe(true);
    expect(kiosk.controller.dispatch({ type: 'TREATMENTS_NEXT_PAGE' })).toBe('APPLIED');
    expect(kiosk.controller.dispatch({ type: 'TOGGLE_LARGE_TEXT' })).toBe('APPLIED');
    expect(kiosk.controller.dispatch({ type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' })).toBe('APPLIED');
    expect(kiosk.controller.dispatch({ type: 'REQUEST_HOME' })).toBe('APPLIED');
    expect(stateOf(kiosk).activeRefresh).toEqual(before.activeRefresh);
    expect(stateOf(kiosk).refreshState).toBe('RUNNING');
    kiosk.dispose();
  });
});

describe('AC-020c: 갱신이 필요한 동안 계산 요청은 나가지 않는다', () => {
  it('한쪽(catalog)만 도착한 때에도 확인 버튼 값은 false 이고 강제로 들어온 사건은 거절되며 계산 요청은 0건이 더 나간다. 갱신이 성공해 반영된 뒤에야 풀린다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    refreshing.catalogCall.respond(200, catalogBody());
    await flush();
    expect(canRequestEstimate(stateOf(kiosk))).toBe(false);
    expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('IGNORED');
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    refreshing.optionsCall.respond(200, optionsBody());
    await flush();
    expect(canRequestEstimate(stateOf(kiosk))).toBe(true);
    expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
    expect(kiosk.transport.estimateCalls()).toHaveLength(2);
    kiosk.dispose();
  });

  it('진행 중(RUNNING)과 실패(FAILED) 모두에서 강제로 들어온 "예상 부담액 확인"·"다시 시도"(통신 오류 화면)는 거절되고 계산 요청이 하나도 더 나가지 않는다', async () => {
    const kiosk = startKiosk({ refreshTimeoutMs: REFRESH_TIMEOUT_MS });
    const refreshing = await startRefreshing(kiosk);
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    const durings: KioskState[] = [];
    for (const phase of ['RUNNING', 'FAILED'] as const) {
      if (phase === 'FAILED') {
        refreshing.catalogCall.respond(500, errorBody('INTERNAL_ERROR'));
        await flush();
      }
      const state = stateOf(kiosk);
      expect(state.refreshState).toBe(phase);
      expect(state.inputs.treatmentIds.length).toBeGreaterThan(1);
      expect(canRequestEstimate(state)).toBe(false);
      expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('IGNORED');
      durings.push(state);
      expect(stateOf(kiosk)).toBe(state);
    }
    expect(durings).toHaveLength(2);
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    kiosk.dispose();
  });

  it.each(['RUNNING', 'FAILED'] as const)('통신 오류 화면의 "다시 시도" (%s): 새 계산 요청을 보내지 않는다', (phase) => {
    const kiosk = startKiosk({ from: stateAt('KXX_Error_Network', { inputs: FULL_INPUTS, refreshState: phase }, { env: makeEnv(performance.now()) }) });
    expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('IGNORED');
    expect(kiosk.transport.estimateCalls()).toHaveLength(0);
    kiosk.dispose();
  });

  it('인라인 "다시 시도"는 진행 중이거나 갱신이 필요하지 않을 때 거절된다', async () => {
    const kiosk = startKiosk();
    expect(kiosk.controller.dispatch({ type: 'RETRY_REFRESH' })).toBe('IGNORED');
    await startRefreshing(kiosk);
    const running = stateOf(kiosk);
    expect(kiosk.controller.dispatch({ type: 'RETRY_REFRESH' })).toBe('IGNORED');
    expect(stateOf(kiosk)).toBe(running);
    kiosk.dispose();
  });
});

describe('AC-020d: 두 응답이 모두 도착한 뒤에만, 한 단계로 반영한다', () => {
  it('catalog 만 도착, options 만 도착한 동안에는 화면·자료·버튼·구독자 알림이 모두 그대로다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    const before = stateOf(kiosk);
    const seen: KioskState[] = [];
    kiosk.controller.subscribe((state) => seen.push(state));
    refreshing.catalogCall.respond(200, catalogBody());
    await flush();
    expect(stateOf(kiosk)).toBe(before);
    expect(seen).toEqual([]);
    expect(canRequestEstimate(stateOf(kiosk))).toBe(false);
    refreshing.optionsCall.respond(200, optionsBody());
    await flush();
    expect(seen).toHaveLength(1);
    kiosk.dispose();

    const other = startKiosk();
    const second = await startRefreshing(other);
    const otherBefore = stateOf(other);
    second.optionsCall.respond(200, optionsBody());
    await flush();
    expect(stateOf(other)).toBe(otherBefore);
    other.dispose();
  });

  it('둘 다 도착하면 한 번의 알림으로: 자료·두 버전·무조작 정책이 함께 바뀌고 갱신 상태와 타이머가 정리되고 확인 버튼이 활성이다. 선택·inputRevision·무조작 시계는 그대로다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    const before = stateOf(kiosk);
    const idleOnly = vi.getTimerCount() - 1;
    const seen: KioskState[] = [];
    let timersAtNotify = -1;
    kiosk.controller.subscribe((state) => {
      seen.push(state);
      timersAtNotify = vi.getTimerCount();
    });
    const catalog = repriced();
    const options = optionsBody();
    await resolveBoth(refreshing, catalog, options);

    expect(seen).toHaveLength(1);
    expect(timersAtNotify).toBe(idleOnly);
    const state = stateOf(kiosk);
    expect(seen[0]).toBe(state);
    expect(state.screen).toBe('K03_Treatments');
    expect(state.refreshState).toBe('NONE');
    expect(state.activeRefresh).toBeNull();
    expect(state.clinic.catalog).toBe(catalog);
    expect(state.clinic.options).toBe(options);
    expect(state.clinic.versions).toEqual({ catalogVersion: 'TEST_FIXTURE_CATALOG_V2', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V2' });
    expect(state.clinic.idle.screens.INPUT).toEqual({ warnSeconds: 90, resetSeconds: 110 });
    expect(state.inputs).toBe(before.inputs);
    expect(state.inputRevision).toBe(before.inputRevision);
    expect(state.refreshNotice).toBeNull();
    expect(state.lastInteractionAt).toBe(before.lastInteractionAt);
    expect(canRequestEstimate(state)).toBe(true);
    expect(selectRefresh(state)).toMatchObject({ running: false, failed: false, locked: false, notice: null });
    // 새 합계는 새 카탈로그에서 읽는다 (X-ray 12,000 급여 + 신장분사치료 40,000 비급여)
    expect(selectTotals(state)).toEqual({ selectedCount: 2, benefit: 12_000, nonBenefit: 40_000, total: 52_000 });
    // 무조작 경과는 이어서 센다: 경고 시각은 마지막 환자 조작 + 새 정책의 90초
    expect(nextSchedule(state)).toEqual({ kind: 'WARN', at: before.lastInteractionAt + 90 * SECOND });
    kiosk.dispose();
  });

  it('선택 [X, Y, Z] 에서 Y 가 내려가고 가격과 options 버전이 바뀐 경우: 알림 1회로 [X, Z] 와 Y 의 안내, 새 합계, 새 자료·버전이 함께 들어오고 inputRevision 은 한 번 오른다. 무조작 경과는 이어진다', async () => {
    const kiosk = startKiosk();
    goToTreatments(kiosk);
    kiosk.controller.dispatch({ type: 'TOGGLE_TREATMENT', treatmentId: T_ULTRASOUND });
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    kiosk.transport.estimateCalls()[0]!.respond(409, REPLIES.mismatch.body);
    await flush();
    const refreshing = currentRefresh(kiosk);
    const before = stateOf(kiosk);
    expect(before.inputs.treatmentIds).toEqual([T_XRAY, T_KIDNEY_SPRAY, T_ULTRASOUND]);
    const seen: KioskState[] = [];
    kiosk.controller.subscribe((state) => seen.push(state));
    const catalog = catalogBody({
      treatments: withoutKidney().treatments.map((treatment) => (treatment.treatmentId === T_XRAY ? { ...treatment, patientAmount: 11_000 } : treatment)),
    });
    refreshing.catalogCall.respond(200, catalog);
    await flush();
    expect(seen).toEqual([]);
    refreshing.optionsCall.respond(200, optionsBody());
    await flush();

    expect(seen).toHaveLength(1);
    const state = stateOf(kiosk);
    expect(state.inputs.treatmentIds).toEqual([T_XRAY, T_ULTRASOUND]);
    expect(state.refreshNotice?.removed.map((entry) => entry.treatmentId)).toEqual([T_KIDNEY_SPRAY]);
    expect(state.inputRevision).toBe(before.inputRevision + 1);
    // 엔진 합산 함수로 낸 새 합계: X-ray 11,000 + 초음파 4,000 (급여)
    expect(selectTotals(state)).toEqual({ selectedCount: 2, benefit: 15_000, nonBenefit: 0, total: 15_000 });
    expect(state.clinic.versions).toEqual({ catalogVersion: 'TEST_FIXTURE_CATALOG_V2', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V2' });
    expect(state.refreshState).toBe('NONE');
    expect(canRequestEstimate(state)).toBe(true);
    expect(state.lastInteractionAt).toBe(before.lastInteractionAt);
    expect(nextSchedule(state)).toEqual(nextSchedule(before));
    kiosk.dispose();
  });

  it('내려간 치료는 안내와 함께 선택에서 빠진다: 게시 중인 선택만 유지, inputRevision +1, 파생 데이터 삭제, 합계는 남은 치료의 것', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    const before = stateOf(kiosk);
    await resolveBoth(refreshing, withoutKidney());
    const state = stateOf(kiosk);
    expect(state.inputs.treatmentIds).toEqual([T_XRAY]);
    expect(state.inputs.generation).toBe(before.inputs.generation);
    expect(state.inputRevision).toBe(before.inputRevision + 1);
    expect(state.refreshNotice).toEqual({ removed: [{ treatmentId: T_KIDNEY_SPRAY, displayName: 'TEST_FIXTURE 신장분사치료' }] });
    expect(state.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(selectTotals(state)).toEqual({ selectedCount: 1, benefit: 10_000, nonBenefit: 0, total: 10_000 });
    expect(canRequestEstimate(state)).toBe(true);
    expect(state.refreshState).toBe('NONE');
    kiosk.dispose();
  });

  it('선택이 모두 내려가면 확인 버튼은 기존 규칙대로 비활성이다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    await resolveBoth(refreshing, withoutSelected());
    const state = stateOf(kiosk);
    expect(state.inputs.treatmentIds).toEqual([]);
    expect(state.refreshNotice?.removed.map((entry) => entry.treatmentId)).toEqual([T_XRAY, T_KIDNEY_SPRAY]);
    expect(state.refreshState).toBe('NONE');
    expect(canRequestEstimate(state)).toBe(false);
    expect(selectTotals(state).selectedCount).toBe(0);
    kiosk.dispose();
  });

  it('안내는 다음 입력 변경 때 사라진다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    await resolveBoth(refreshing, withoutKidney());
    expect(stateOf(kiosk).refreshNotice).not.toBeNull();
    kiosk.controller.dispatch({ type: 'TOGGLE_TREATMENT', treatmentId: 'TEST_FIXTURE_TREATMENT_4' });
    expect(stateOf(kiosk).refreshNotice).toBeNull();
    kiosk.dispose();
  });

  it('갱신이 성공해도 결과는 나오지 않는다: 환자가 다시 확인해야 하고, 그때 보내는 요청은 새 버전을 싣는다 (AC-020e 마지막 항, AC-020b)', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    await resolveBoth(refreshing, withoutKidney());
    expect(stateOf(kiosk).derived.estimate).toBeNull();
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    expect(kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
    const second = kiosk.transport.estimateCalls()[1]!;
    expect(second.body()).toMatchObject({ catalogVersion: 'TEST_FIXTURE_CATALOG_V2', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V2', treatmentIds: [T_XRAY] });
    kiosk.dispose();
  });
});

describe('AC-020e: 실패·시간 초과는 아무것도 반영하지 않는다', () => {
  const FAILURES: Array<[string, (kiosk: Kiosk) => Promise<void>]> = [
    ['catalog 가 500', async (kiosk) => { currentRefresh(kiosk).catalogCall.respond(500, errorBody('INTERNAL_ERROR')); await flush(); }],
    ['options 가 500', async (kiosk) => { currentRefresh(kiosk).optionsCall.respond(500, errorBody('INTERNAL_ERROR')); await flush(); }],
    ['catalog 가 404', async (kiosk) => { currentRefresh(kiosk).catalogCall.respond(404, errorBody('CLINIC_NOT_FOUND')); await flush(); }],
    ['catalog 연결 실패', async (kiosk) => { currentRefresh(kiosk).catalogCall.fail(); await flush(); }],
    ['options 연결 실패', async (kiosk) => { currentRefresh(kiosk).optionsCall.fail(); await flush(); }],
    ['catalog 본문이 JSON 이 아니다', async (kiosk) => { currentRefresh(kiosk).catalogCall.respondUnreadable(200); await flush(); }],
    ['catalog 는 성공, options 는 500', async (kiosk) => { const r = currentRefresh(kiosk); r.catalogCall.respond(200, catalogBody()); r.optionsCall.respond(500, errorBody('INTERNAL_ERROR')); await flush(); }],
    ['options 는 성공, catalog 는 연결 실패', async (kiosk) => { const r = currentRefresh(kiosk); r.optionsCall.respond(200, optionsBody()); r.catalogCall.fail(); await flush(); }],
    ['둘 다 실패', async (kiosk) => { const r = currentRefresh(kiosk); r.catalogCall.fail(); r.optionsCall.respond(500, errorBody('INTERNAL_ERROR')); await flush(); }],
    ['catalog 본문의 모양이 틀렸다', async (kiosk) => { const r = currentRefresh(kiosk); r.catalogCall.respond(200, { not: 'a catalog' }); r.optionsCall.respond(200, optionsBody()); await flush(); }],
    ['options 본문의 모양이 틀렸다', async (kiosk) => { const r = currentRefresh(kiosk); r.catalogCall.respond(200, catalogBody()); r.optionsCall.respond(200, []); await flush(); }],
    ['다른 병원의 catalog 가 왔다', async (kiosk) => { const r = currentRefresh(kiosk); r.catalogCall.respond(200, catalogBody({ clinic: { slug: 'other-clinic', displayName: 'x', setting: 'OUTPATIENT_ONLY' } })); r.optionsCall.respond(200, optionsBody()); await flush(); }],
    ['200 이 아닌 2xx', async (kiosk) => { const r = currentRefresh(kiosk); r.catalogCall.respond(204, null); r.optionsCall.respond(200, optionsBody()); await flush(); }],
    ['시간 제한 도달', async () => { await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS); }],
  ];

  it.each(FAILURES)('%s: refreshState FAILED, 자료·선택·합계는 이전 그대로, 확인 버튼 비활성, 화면은 K03_Treatments(통신 오류 화면이 아니다), 계산 요청 없음', async (name, fail) => {
    const kiosk = startKiosk({ refreshTimeoutMs: REFRESH_TIMEOUT_MS });
    await startRefreshing(kiosk);
    const before = stateOf(kiosk);
    const timers = vi.getTimerCount();
    await fail(kiosk);

    const state = stateOf(kiosk);
    expect(state.refreshState).toBe('FAILED');
    expect(state.activeRefresh).toBeNull();
    expect(state.screen).toBe('K03_Treatments');
    expect(state.clinic).toBe(before.clinic);
    expect(state.inputs).toBe(before.inputs);
    expect(state.inputRevision).toBe(before.inputRevision);
    expect(state.refreshNotice).toBeNull();
    expect(selectTotals(state)).toEqual(selectTotals(before));
    expect(canRequestEstimate(state)).toBe(false);
    expect(selectRefresh(state)).toMatchObject({ running: false, failed: true, canRetry: true, locked: false });
    expect(state.lastInteractionAt).toBe(before.lastInteractionAt);
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    // 타이머 하나(갱신 시간 제한)가 풀렸다
    expect(vi.getTimerCount()).toBe(timers - 1);
    // 이미 끝난 실패는 취소할 것이 없고, 시간 초과만 두 GET 을 취소한다
    expect(kiosk.abortCalls()).toBe(name === '시간 제한 도달' ? 2 : 0);
    kiosk.dispose();
  });

  it('먼저 실패한 쪽이 곧바로 결말이다: 나머지 응답이 늦게 와도 아무것도 바뀌지 않는다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    refreshing.catalogCall.fail();
    await flush();
    const failed = stateOf(kiosk);
    expect(failed.refreshState).toBe('FAILED');
    refreshing.optionsCall.respond(200, optionsBody());
    await flush();
    expect(stateOf(kiosk)).toBe(failed);
    kiosk.dispose();
  });

  it('인라인 "다시 시도"는 계산이 아니라 갱신을 새 식별자로 먼저 실행하고, 환자 조작이라 무조작 시간을 다시 센다. 두 번째 실패도 같은 상태다', async () => {
    const kiosk = startKiosk();
    const first = await startRefreshing(kiosk);
    first.catalogCall.fail();
    await flush();
    await vi.advanceTimersByTimeAsync(20 * SECOND);
    const failed = stateOf(kiosk);

    expect(kiosk.controller.dispatch({ type: 'RETRY_REFRESH' })).toBe('APPLIED');
    const retrying = stateOf(kiosk);
    expect(retrying.refreshState).toBe('RUNNING');
    expect(retrying.activeRefresh).toMatchObject({ refreshId: 'RFR-TEST-0002', reason: 'RETRY' });
    expect(retrying.lastInteractionAt).toBe(performance.now());
    expect(retrying.lastInteractionAt).toBeGreaterThan(failed.lastInteractionAt);
    expect(kiosk.transport.refreshCalls()).toHaveLength(4);
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    expect(canRequestEstimate(retrying)).toBe(false);

    const second = currentRefresh(kiosk);
    second.optionsCall.respond(500, errorBody('INTERNAL_ERROR'));
    await flush();
    expect(stateOf(kiosk)).toMatchObject({ refreshState: 'FAILED', activeRefresh: null, screen: 'K03_Treatments' });
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);

    kiosk.controller.dispatch({ type: 'RETRY_REFRESH' });
    await resolveBoth(currentRefresh(kiosk), withoutKidney());
    expect(stateOf(kiosk)).toMatchObject({ refreshState: 'NONE', activeRefresh: null });
    expect(canRequestEstimate(stateOf(kiosk))).toBe(true);
    kiosk.dispose();
  });
});

describe('AC-020f: 이전 갱신 A 의 늦은 결과는 새 갱신 B 를 건드리지 못한다', () => {
  it('A 가 실패한 뒤 "다시 시도"(B)가 진행 중일 때 A 의 늦은 성공·실패·타이머 콜백·settleRefresh 직접 호출이 와도 B 의 상태·자료·로딩·타이머·취소 호출 수·남은 무조작 시간이 그대로이고, 그 뒤 B 의 성공만 반영된다', async () => {
    const kiosk = startKiosk({ refreshTimeoutMs: REFRESH_TIMEOUT_MS });
    const a = await startRefreshing(kiosk);
    const aTimer = kiosk.refreshTimerCallbacks[0]!;
    a.catalogCall.fail();
    await flush();
    kiosk.controller.dispatch({ type: 'RETRY_REFRESH' });
    const b = currentRefresh(kiosk);
    const snapshot = (): unknown[] => [stateOf(kiosk), vi.getTimerCount(), kiosk.abortCalls(), stateOf(kiosk).refreshState, stateOf(kiosk).screen, nextSchedule(stateOf(kiosk))];
    const before = snapshot();

    // A 의 늦은 성공(실제 응답 경로)과 늦은 직접 사건들
    a.optionsCall.respond(200, optionsBody());
    await flush();
    for (const event of [
      { type: 'REFRESH_RESOLVED', refreshId: a.refreshId, catalog: catalogBody(), options: optionsBody() },
      { type: 'REFRESH_FAILED', refreshId: a.refreshId },
      { type: 'REFRESH_EXPIRED', refreshId: a.refreshId },
    ] as KioskEvent[]) {
      expect(kiosk.controller.dispatch(event)).toBe('IGNORED');
    }
    aTimer();
    expect(settleRefresh(stateOf(kiosk), a.refreshId, { outcome: 'SUCCEEDED', catalog: catalogBody(), options: optionsBody() })).toBe(stateOf(kiosk));
    expect(settleRefresh(stateOf(kiosk), a.refreshId, { outcome: 'FAILED' })).toBe(stateOf(kiosk));
    expect(snapshot()).toEqual(before);
    expect(stateOf(kiosk).refreshState).toBe('RUNNING');
    expect(stateOf(kiosk).clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V1');

    // B 는 제때 성공한다
    await resolveBoth(b, withoutKidney());
    expect(stateOf(kiosk).clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V2');
    expect(stateOf(kiosk).refreshState).toBe('NONE');
    kiosk.dispose();
  });

  it('A 의 시간 초과 뒤 B 가 진행 중일 때 A 의 늦은 응답은 B 의 시간 제한을 건드리지 못한다 (B 는 제때 만료된다)', async () => {
    const kiosk = startKiosk({ refreshTimeoutMs: REFRESH_TIMEOUT_MS });
    const a = await startRefreshing(kiosk);
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(stateOf(kiosk).refreshState).toBe('FAILED');
    kiosk.controller.dispatch({ type: 'RETRY_REFRESH' });
    const b = currentRefresh(kiosk);
    await resolveBoth(a);
    expect(stateOf(kiosk).refreshState).toBe('RUNNING');
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(stateOf(kiosk).refreshState).toBe('FAILED');
    expect(b.catalogCall.init.signal.aborted).toBe(true);
    kiosk.dispose();
  });

  it('같은 갱신 B 가 실패한 직후의 늦은 성공도 상태를 바꾸지 못한다 (성공 직후의 늦은 실패와 짝)', async () => {
    const kiosk = startKiosk({ refreshTimeoutMs: REFRESH_TIMEOUT_MS });
    const b = await startRefreshing(kiosk);
    b.catalogCall.fail();
    await flush();
    const failed = stateOf(kiosk);
    const timers = vi.getTimerCount();
    const aborts = kiosk.abortCalls();
    const schedule = nextSchedule(failed);
    await resolveBoth(b, withoutKidney());
    expect(kiosk.controller.dispatch({ type: 'REFRESH_RESOLVED', refreshId: b.refreshId, catalog: catalogBody(), options: optionsBody() })).toBe('IGNORED');
    expect(settleRefresh(failed, b.refreshId, { outcome: 'SUCCEEDED', catalog: catalogBody(), options: optionsBody() })).toBe(failed);
    expect(stateOf(kiosk)).toBe(failed);
    expect(stateOf(kiosk).refreshState).toBe('FAILED');
    expect(vi.getTimerCount()).toBe(timers);
    expect(kiosk.abortCalls()).toBe(aborts);
    expect(nextSchedule(stateOf(kiosk))).toEqual(schedule);
    kiosk.dispose();
  });

  it('같은 갱신을 여러 번 정리해도 첫 유효 호출만 처리한다: 이후 호출은 상태·타이머·취소 호출 수·남은 무조작 시간을 바꾸지 않는다', async () => {
    const kiosk = startKiosk({ refreshTimeoutMs: REFRESH_TIMEOUT_MS });
    const a = await startRefreshing(kiosk);
    await resolveBoth(a, withoutKidney());
    const settled = stateOf(kiosk);
    const timers = vi.getTimerCount();
    const aborts = kiosk.abortCalls();
    const schedule = nextSchedule(settled);
    for (const event of [
      { type: 'REFRESH_RESOLVED', refreshId: a.refreshId, catalog: catalogBody(), options: optionsBody() },
      { type: 'REFRESH_FAILED', refreshId: a.refreshId },
      { type: 'REFRESH_EXPIRED', refreshId: a.refreshId },
    ] as KioskEvent[]) {
      expect(kiosk.controller.dispatch(event)).toBe('IGNORED');
    }
    for (const callback of kiosk.refreshTimerCallbacks) callback();
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS * 2 - 1);
    expect(settleRefresh(settled, a.refreshId, { outcome: 'FAILED' })).toBe(settled);
    expect(stateOf(kiosk).refreshState).toBe('NONE');
    expect(stateOf(kiosk).inputRevision).toBe(settled.inputRevision);
    expect(vi.getTimerCount()).toBe(timers);
    expect(kiosk.abortCalls()).toBe(aborts);
    expect(nextSchedule(stateOf(kiosk))).toEqual(schedule);
    kiosk.dispose();
  });
});

describe('AC-020g: 초기화·입력 변경과 갱신 결과의 경합', () => {
  const LATE_RESULTS = (refreshId: string): KioskEvent[] => [
    { type: 'REFRESH_RESOLVED', refreshId, catalog: catalogBody(), options: optionsBody() },
    { type: 'REFRESH_FAILED', refreshId },
    { type: 'REFRESH_EXPIRED', refreshId },
  ];

  const RESETS: Array<[string, (kiosk: Kiosk) => Promise<void>]> = [
    ['처음으로 + 확인', async (kiosk) => { kiosk.controller.dispatch({ type: 'REQUEST_HOME' }); kiosk.controller.dispatch({ type: 'CONFIRM_RESET' }); }],
    ['TimeoutDialog 의 처음으로', async (kiosk) => { await vi.advanceTimersByTimeAsync(100 * SECOND); kiosk.controller.dispatch({ type: 'REQUEST_HOME' }); }],
    ['무조작 초기화', async () => { await vi.advanceTimersByTimeAsync(120 * SECOND); }],
    ['새로고침·페이지 캐시 복원', async (kiosk) => { kiosk.controller.dispatch({ type: 'PAGE_RESTORED' }); }],
  ];

  it.each(RESETS)('%s 뒤 도착한 갱신 결과는 반영되지 않는다 (abort() 가 아무 일도 하지 않아도 같다): 새 세션의 K00_Start 가 그대로이고 갱신 상태·타이머가 남지 않는다', async (_name, reset) => {
    const kiosk = startKiosk({ abortDoesNothing: true });
    const refreshing = await startRefreshing(kiosk);
    const before = stateOf(kiosk);
    const getsBefore = kiosk.transport.refreshCalls().length;
    await reset(kiosk);

    const fresh = stateOf(kiosk);
    expect(fresh).toMatchObject({ screen: 'K00_Start', refreshState: 'NONE', activeRefresh: null, activeRequest: null });
    expect(fresh.sessionId).not.toBe(before.sessionId);
    expect(kiosk.abortCalls()).toBe(2);
    expect(refreshing.catalogCall.init.signal.aborted).toBe(false);
    await resolveBoth(refreshing, withoutKidney());
    for (const event of LATE_RESULTS(refreshing.refreshId)) expect(kiosk.controller.dispatch(event)).toBe('IGNORED');
    for (const callback of kiosk.refreshTimerCallbacks) callback();

    expect(stateOf(kiosk)).toBe(fresh);
    expect(fresh.clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V1');
    expect(vi.getTimerCount()).toBe(0);
    expect(kiosk.transport.refreshCalls()).toHaveLength(getsBefore);
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    kiosk.dispose();
  });

  it('abort() 가 정상 동작하면 초기화 때 두 GET 의 신호가 취소된다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    kiosk.controller.dispatch({ type: 'PAGE_RESTORED' });
    expect(refreshing.catalogCall.init.signal.aborted).toBe(true);
    expect(refreshing.optionsCall.init.signal.aborted).toBe(true);
    kiosk.dispose();
  });

  it.each([
    ['치료 추가', { type: 'TOGGLE_TREATMENT', treatmentId: 'TEST_FIXTURE_TREATMENT_4' }],
    ['치료 해제', { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY }],
  ] as const)('잠금을 거치지 않고 상태 기계에 직접 넣은 %s: 진행 중인 갱신을 취소하고 이후 도착한 성공을 반영하지 않으며 FAILED, 확인 버튼 비활성이다 (AC-020g 3)', async (_name, event) => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    const before = stateOf(kiosk);
    expect(kiosk.controller.dispatch(event)).toBe('APPLIED');
    const changed = stateOf(kiosk);
    expect(changed.inputRevision).toBe(before.inputRevision + 1);
    expect(changed.activeRefresh).toBeNull();
    expect(changed.refreshState).toBe('FAILED');
    expect(canRequestEstimate(changed)).toBe(false);
    expect(selectRefresh(changed)).toMatchObject({ running: false, failed: true, canRetry: true });
    expect(kiosk.abortCalls()).toBe(2);
    expect(refreshing.catalogCall.init.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await resolveBoth(refreshing, withoutKidney());
    expect(kiosk.controller.dispatch({ type: 'REFRESH_RESOLVED', refreshId: refreshing.refreshId, catalog: catalogBody(), options: optionsBody() })).toBe('IGNORED');
    expect(stateOf(kiosk)).toBe(changed);
    expect(stateOf(kiosk).clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V1');
    expect(kiosk.transport.estimateCalls()).toHaveLength(1);
    kiosk.dispose();
  });

  it('이전 단계로 돌아가 선택을 바꾸는 경로도 같다: "이전" 자체는 입력 변경이 아니라 갱신이 계속되고, 선택을 실제로 바꾸는 순간 취소된다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    expect(kiosk.controller.dispatch({ type: 'PREV' })).toBe('APPLIED');
    expect(stateOf(kiosk)).toMatchObject({ screen: 'K02b_Cause', refreshState: 'RUNNING' });
    expect(kiosk.controller.dispatch({ type: 'SELECT_CAUSE', code: 'UNKNOWN' })).toBe('APPLIED');
    expect(stateOf(kiosk).refreshState).toBe('RUNNING');
    expect(kiosk.controller.dispatch({ type: 'SELECT_CAUSE', code: 'INJURY' })).toBe('APPLIED');
    const changed = stateOf(kiosk);
    expect(changed).toMatchObject({ refreshState: 'FAILED', activeRefresh: null });
    await resolveBoth(refreshing, withoutKidney());
    expect(stateOf(kiosk)).toBe(changed);
    kiosk.dispose();
  });

  it('잠금을 거치지 않는 경로로 입력이 실제로 바뀌면(강제 구성) 진행 중인 갱신을 취소하고 결과를 쓰지 않으며 FAILED 로 두어 확인 버튼이 비활성이다', async () => {
    const base = stateAt('K02_Type', { inputs: FULL_INPUTS, refreshState: 'RUNNING', inputRevision: 3 }, { env: makeEnv(performance.now()) });
    const forced: KioskState = { ...base, activeRefresh: { refreshId: 'RFR-FORCED-A', sessionId: base.sessionId, inputRevision: 3, reason: 'VERSION_MISMATCH' } };
    const kiosk = startKiosk({ from: forced });
    const refreshing = currentRefresh(kiosk);
    expect(kiosk.controller.dispatch({ type: 'SELECT_INSURER_TYPE', code: 'LIFE' })).toBe('APPLIED');
    const state = stateOf(kiosk);
    expect(state.inputs.insurerType).toBe('LIFE');
    expect(state.inputRevision).toBe(4);
    expect(state.activeRefresh).toBeNull();
    expect(state.refreshState).toBe('FAILED');
    expect(canRequestEstimate({ ...state, screen: 'K03_Treatments' })).toBe(false);
    expect(kiosk.abortCalls()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    await resolveBoth(refreshing, withoutKidney());
    expect(stateOf(kiosk)).toBe(state);
    kiosk.dispose();
  });

  it('같은 값을 다시 고르면 입력 변경이 아니라서 진행 중인 갱신이 그대로다', () => {
    const base = stateAt('K02_Type', { inputs: FULL_INPUTS, refreshState: 'RUNNING' }, { env: makeEnv(performance.now()) });
    const forced: KioskState = { ...base, activeRefresh: { refreshId: 'RFR-FORCED-A', sessionId: base.sessionId, inputRevision: base.inputRevision, reason: 'RETRY' } };
    const kiosk = startKiosk({ from: forced });
    kiosk.controller.dispatch({ type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' });
    expect(stateOf(kiosk).activeRefresh?.refreshId).toBe('RFR-FORCED-A');
    expect(kiosk.abortCalls()).toBe(0);
    kiosk.dispose();
  });

  it('활성 갱신이 있는 상태에서 시작하면 두 GET 이 나가고, 새 갱신이 시작되면 이전 갱신을 먼저 취소한다 (교체)', () => {
    const base = stateAt('K03_Treatments', { inputs: FULL_INPUTS, refreshState: 'FAILED' }, { env: makeEnv(performance.now()) });
    const forced: KioskState = { ...base, refreshState: 'RUNNING', activeRefresh: { refreshId: 'RFR-FORCED-A', sessionId: base.sessionId, inputRevision: base.inputRevision, reason: 'VERSION_MISMATCH' } };
    const kiosk = startKiosk({ from: forced });
    expect(kiosk.transport.refreshCalls()).toHaveLength(2);
    // 이음매 확인: 실패시킨 뒤의 재시도는 새 식별자다 (교체 경로는 settleRefresh 단위 시험이 본다)
    kiosk.controller.dispatch({ type: 'REFRESH_FAILED', refreshId: 'RFR-FORCED-A' });
    kiosk.controller.dispatch({ type: 'RETRY_REFRESH' });
    expect(stateOf(kiosk).activeRefresh?.refreshId).toBe('RFR-TEST-0001');
    expect(kiosk.transport.refreshCalls()).toHaveLength(4);
    kiosk.dispose();
  });

  it('dispose: 진행 중인 갱신의 타이머를 치우고 두 GET 을 취소한다', async () => {
    const kiosk = startKiosk();
    const refreshing = await startRefreshing(kiosk);
    kiosk.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(refreshing.catalogCall.init.signal.aborted).toBe(true);
    expect(refreshing.optionsCall.init.signal.aborted).toBe(true);
    kiosk.dispose();
  });
});

describe('AC-016o: 갱신 식별자(refreshId)는 GET 의 주소·헤더·본문, 로그, 분석 어디에도 없다', () => {
  const MARKER = /RFR-TEST-\d{4}|RID-TEST-\d{4}/;
  const hasIdKey = (value: unknown): boolean => typeof value === 'object' && value !== null && Object.entries(value).some(([key, child]) => /(request|refresh).?id/i.test(key) || hasIdKey(child));

  it('409 뒤 갱신 성공, 갱신 실패 뒤 인라인 재시도, 초기화까지 진행해도 표지 값이 새지 않는다. 대조군: 갱신 중 refreshId 표지가 activeRefresh 에 있고 계산 requestId 표지와 다르다', async () => {
    const kiosk = startKiosk();
    const controlGroup: Array<{ refreshId: string; requestId: string }> = [];

    // 1) 409 -> 갱신 성공
    goToTreatments(kiosk);
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    const requestId = stateOf(kiosk).activeRequest!.requestId;
    kiosk.transport.estimateCalls()[0]!.respond(409, REPLIES.mismatch.body);
    await flush();
    controlGroup.push({ refreshId: stateOf(kiosk).activeRefresh!.refreshId, requestId });
    await resolveBoth(currentRefresh(kiosk), withoutKidney());
    // 2) 다시 확인 -> 422 -> 갱신 실패 -> 인라인 재시도
    kiosk.controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    kiosk.transport.estimateCalls()[1]!.respond(422, REPLIES.notPublished.body);
    await flush();
    controlGroup.push({ refreshId: stateOf(kiosk).activeRefresh!.refreshId, requestId: 'RID-TEST-0002' });
    currentRefresh(kiosk).optionsCall.fail();
    await flush();
    kiosk.controller.dispatch({ type: 'RETRY_REFRESH' });
    controlGroup.push({ refreshId: stateOf(kiosk).activeRefresh!.refreshId, requestId: 'RID-TEST-0002' });
    // 3) 초기화
    kiosk.controller.dispatch({ type: 'PAGE_RESTORED' });

    // (1) 대조군
    expect(controlGroup).toHaveLength(3);
    for (const { refreshId, requestId: rid } of controlGroup) {
      expect(refreshId).toMatch(/^RFR-TEST-\d{4}$/);
      expect(rid).toMatch(/^RID-TEST-\d{4}$/);
      expect(refreshId).not.toBe(rid);
    }
    // (2) 모든 요청(GET 포함)의 주소·헤더·본문
    const gets = kiosk.transport.refreshCalls();
    expect(gets).toHaveLength(6);
    for (const call of kiosk.transport.calls) {
      expect(call.url).not.toMatch(MARKER);
      expect(call.url).not.toMatch(/[?#]/);
      expect(JSON.stringify(call.init.headers)).not.toMatch(MARKER);
      expect(hasIdKey(call.init.headers)).toBe(false);
      expect(call.init.body ?? '').not.toMatch(MARKER);
      expect(hasIdKey(call.init.body === undefined ? null : call.body())).toBe(false);
    }
    for (const call of gets) {
      expect(call.init.body).toBeUndefined();
      expect(call.init.headers).toEqual({ accept: 'application/json' });
    }
    // (3) 로그와 분석: 대조군으로 개수를 확인하고 표지 값과 id 키가 없다
    expect(kiosk.logs).toEqual(expect.arrayContaining([{ level: 'warn', code: 'ESTIMATE_VERSION_MISMATCH', status: 409 }, { level: 'error', code: 'REFRESH_FAILED' }]));
    expect(kiosk.analytics).toEqual(
      expect.arrayContaining([
        { type: 'REFRESH_OUTCOME', outcome: 'SUCCEEDED' },
        { type: 'REFRESH_OUTCOME', outcome: 'FAILED' },
        { type: 'REFRESH_OUTCOME', outcome: 'CANCELLED' },
      ]),
    );
    const text = JSON.stringify([kiosk.logs, kiosk.analytics]);
    expect(text).not.toMatch(MARKER);
    expect(text).not.toMatch(/(request|refresh).?id/i);
    kiosk.dispose();
  });

  it('시간 초과 로그도 종류만 담는다', async () => {
    const kiosk = startKiosk({ refreshTimeoutMs: REFRESH_TIMEOUT_MS });
    await startRefreshing(kiosk);
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(kiosk.logs).toContainEqual({ level: 'error', code: 'REFRESH_EXPIRED' });
    expect(JSON.stringify(kiosk.logs)).not.toMatch(/RFR-TEST|RID-TEST/);
    kiosk.dispose();
  });

  it('계산 요청 쪽 식별자 검사(AC-016k·AC-016l)는 그대로 통과한다: 계산 POST 에 두 표지 값 어느 것도 없다', async () => {
    const kiosk = startKiosk();
    await startRefreshing(kiosk);
    for (const call of kiosk.transport.estimateCalls()) {
      expect(`${call.url}${JSON.stringify(call.init.headers)}${call.init.body}`).not.toMatch(/RFR-TEST|RID-TEST/);
      expect(Object.keys(call.body())).toEqual(['catalogVersion', 'ruleBundleVersion', 'generation', 'insurerType', 'cause', 'treatmentIds']);
    }
    kiosk.dispose();
  });
});

describe('기본값', () => {
  it('갱신 식별자와 시간 제한을 주입하지 않아도 동작한다: 식별자는 UUID, 시간 제한은 15초', async () => {
    const { createKioskController } = await import('../../../src/app/kiosk/state/controller');
    const { fakeTransport } = await import('../../fixtures/kiosk/transport.fixture');
    const transport = fakeTransport();
    const controller = createKioskController({ transport: transport.transport, newRequestId: () => 'RID-DEFAULTS-1' }, { catalog: makeCatalog(), options: { ...optionsBody(), ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1' } });
    for (const event of [{ type: 'START' }, { type: 'SELECT_GENERATION', code: 'GEN2_C1' }, { type: 'NEXT' }, { type: 'SELECT_INSURER_TYPE', code: 'LIFE' }, { type: 'NEXT' }, { type: 'SELECT_CAUSE', code: 'INJURY' }, { type: 'NEXT' }, { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY }, { type: 'REQUEST_ESTIMATE' }] as const) {
      controller.dispatch(event);
    }
    transport.estimateCalls()[0]!.respond(409, REPLIES.mismatch.body);
    await flush();
    expect(controller.getState().activeRefresh?.refreshId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const signal = transport.refreshCalls()[0]!.init.signal;
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    controller.dispose();
  });
});
