import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKioskController } from '../../../src/app/kiosk/state/controller';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { markerIds, sequenceIds } from '../../fixtures/kiosk/state.fixture';
import { REPLIES, errorBody, goToTreatments } from '../../fixtures/kiosk/transport.fixture';
import type { Kiosk } from '../../fixtures/kiosk/transport.fixture';

// 키오스크의 기본 전송(주입하지 않을 때 쓰는 전역 fetch)은 익명이고 저장되지 않는다: 쿠키·인증을 싣지 않고(credentials: 'omit') 응답을 캐시하지 않는다(cache: 'no-store').
// design.md DD-14·DD-19 (계산 응답은 Cache-Control: no-store), AC-016f/AC-016k. 시험은 fetch 를 이 시험 안에서만 가로챈다(운영 코드에 시험용 훅이 없다).
// 계산 시도 식별자(requestId)와 갱신 식별자(refreshId)는 이 호출 인자 어디에도 없다.

interface Seen {
  readonly url: string;
  readonly init: Record<string, unknown>;
}

let seen: Seen[];

beforeEach(() => {
  vi.useFakeTimers();
  seen = [];
  vi.stubGlobal('fetch', (url: string, init: Record<string, unknown>) => {
    seen.push({ url, init });
    // 계산 요청(POST)은 409, 갱신 GET 은 500 으로 끝낸다 (둘 다 한 번씩 지나가면 된다)
    const reply = init.method === 'POST' ? REPLIES.mismatch : { status: 500, body: errorBody('INTERNAL_ERROR') };
    return Promise.resolve({ status: reply.status, json: () => Promise.resolve(reply.body) });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('기본 전송', () => {
  it('계산 요청(POST)과 갱신 GET 두 개 모두 credentials omit · cache no-store 로 나가고, 그 밖의 칸은 method·headers·body·signal 뿐이다', async () => {
    const controller = createKioskController({ newRequestId: markerIds('RID-TEST'), newRefreshId: markerIds('RFR-TEST'), newSessionId: sequenceIds('NEW') }, { catalog: makeCatalog(), options: makeOptions() });
    goToTreatments({ controller } as Kiosk);
    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.map((call) => `${String(call.init.method)} ${call.url}`)).toEqual([
      'POST /api/clinics/test-fixture-clinic-1/estimate',
      'GET /api/clinics/test-fixture-clinic-1/catalog',
      'GET /api/clinics/test-fixture-clinic-1/insurance/options',
    ]);
    for (const call of seen) {
      expect(call.init.credentials).toBe('omit');
      expect(call.init.cache).toBe('no-store');
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      const keys = Object.keys(call.init).sort();
      expect(keys).toEqual(call.init.method === 'POST' ? ['body', 'cache', 'credentials', 'headers', 'method', 'signal'] : ['cache', 'credentials', 'headers', 'method', 'signal']);
      // 식별자 표지 값이 주소·헤더·본문 어디에도 없다 (대조군은 다음 시험이다: 식별자는 실제로 발급되어 메모리에 있었다)
      expect(JSON.stringify([call.url, call.init.method, call.init.headers, call.init.body ?? null])).not.toMatch(/RID-TEST|RFR-TEST/);
    }
    controller.dispose();
  });

  it('식별자 표지 값은 발급기에서 실제로 쓰였다 (활성 요청·활성 갱신에 있었다는 대조군)', async () => {
    const controller = createKioskController({ newRequestId: markerIds('RID-TEST'), newRefreshId: markerIds('RFR-TEST'), newSessionId: sequenceIds('NEW') }, { catalog: makeCatalog(), options: makeOptions() });
    const active: string[] = [];
    controller.subscribe((state) => {
      if (state.activeRequest !== null) active.push(state.activeRequest.requestId);
      if (state.activeRefresh !== null) active.push(state.activeRefresh.refreshId);
    });
    goToTreatments({ controller } as Kiosk);
    controller.dispatch({ type: 'REQUEST_ESTIMATE' });
    await vi.advanceTimersByTimeAsync(0);
    expect(active).toEqual(['RID-TEST-0001', 'RFR-TEST-0001']);
    controller.dispose();
  });
});
