import { afterEach, describe, expect, it, vi } from 'vitest';
import { clinicUrls, loadClinicData } from '../../../src/app/kiosk/runtime/load-clinic-data';
import type { ClinicLoadOutcome } from '../../../src/app/kiosk/runtime/load-clinic-data';
import { resolveDeps } from '../../../src/app/kiosk/state/deps';
import type { KioskDeps, Transport, TransportInit } from '../../../src/app/kiosk/state/deps';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';

// 시작 단계의 병원 자료 받기 (BRIEF D2): 두 GET 이 모두 200 이고 계약의 모양일 때만 READY. 전송·타이머는 모두 주입한다(실제로 기다리지 않는다, 새 fetch 도 없다).

const SLUG = 'test-fixture-clinic-1';

interface Call {
  readonly url: string;
  readonly init: TransportInit;
  respond(status: number, body: unknown): void;
  respondUnreadable(status: number): void;
  fail(): void;
}

function setup(overrides: Partial<KioskDeps> = {}) {
  const calls: Call[] = [];
  const transport: Transport = (url, init) =>
    new Promise((resolve, reject) => {
      calls.push({
        url,
        init,
        respond: (status, body) => resolve({ status, json: () => Promise.resolve(body) }),
        respondUnreadable: (status) => resolve({ status, json: () => Promise.reject(new Error('TEST_FIXTURE: JSON 이 아니다')) }),
        fail: () => reject(new Error('TEST_FIXTURE: 연결 실패')),
      });
    });
  const timers: Array<{ callback: () => void; delayMs: number; cleared: boolean }> = [];
  const deps = resolveDeps({
    transport,
    refreshTimeoutMs: 15_000,
    setTimeout: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    ...overrides,
  });
  const callTo = (suffix: string): Call => calls.find((call) => call.url.endsWith(suffix)) as Call;
  return { deps, calls, timers, catalog: () => callTo('/catalog'), options: () => callTo('/insurance/options') };
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('주소와 요청', () => {
  it('병원 slug 를 부호화한 두 주소다. 환자·시도 식별자가 들어갈 자리가 없다', () => {
    expect(clinicUrls(SLUG)).toEqual({ catalog: `/api/clinics/${SLUG}/catalog`, options: `/api/clinics/${SLUG}/insurance/options` });
    expect(clinicUrls('a b/한글').catalog).toBe('/api/clinics/a%20b%2F%ED%95%9C%EA%B8%80/catalog');
  });

  it('두 GET 을 함께 보낸다: 본문 없이 accept 헤더 하나, 취소 신호를 싣는다. 전역 fetch 는 부르지 않는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const t = setup();
    const result = loadClinicData(t.deps, SLUG, new AbortController().signal);
    await settle();
    expect(t.calls.map((call) => call.url)).toEqual([`/api/clinics/${SLUG}/catalog`, `/api/clinics/${SLUG}/insurance/options`]);
    for (const call of t.calls) {
      expect(call.init.method).toBe('GET');
      expect(call.init.headers).toEqual({ accept: 'application/json' });
      expect(call.init.body).toBeUndefined();
      expect(call.init.signal.aborted).toBe(false);
    }
    t.catalog().respond(200, makeCatalog());
    t.options().respond(200, makeOptions());
    await result;
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('결말', () => {
  async function run(catalog: (call: Call) => void, options: (call: Call) => void, slug = SLUG): Promise<{ outcome: ClinicLoadOutcome; t: ReturnType<typeof setup> }> {
    const t = setup();
    const pending = loadClinicData(t.deps, slug, new AbortController().signal);
    await settle();
    catalog(t.catalog());
    options(t.options());
    return { outcome: await pending, t };
  }
  const ok200 = (body: unknown) => (call: Call) => call.respond(200, body);

  it('둘 다 200 이고 올바르면 READY: 받은 자료 그대로이고 시간 제한 타이머는 치워진다', async () => {
    const catalog = makeCatalog();
    const options = makeOptions();
    const { outcome, t } = await run(ok200(catalog), ok200(options));
    expect(outcome).toEqual({ kind: 'READY', catalog, options });
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0]?.delayMs).toBe(15_000);
    expect(t.timers[0]?.cleared).toBe(true);
  });

  it('규칙 묶음이 중지(SUSPENDED)여도 READY 다 (계산이 보류로 끝나는 일이고 시작 실패가 아니다)', async () => {
    const { outcome } = await run(ok200(makeCatalog()), ok200(makeOptions({ ruleBundleStatus: 'SUSPENDED' })));
    expect(outcome.kind).toBe('READY');
  });

  it('catalog 가 404 면 NOT_FOUND', async () => {
    expect((await run((call) => call.respond(404, { error: 'CLINIC_NOT_FOUND' }), ok200(makeOptions()))).outcome).toEqual({ kind: 'NOT_FOUND' });
  });

  it('options 가 404 여도 NOT_FOUND', async () => {
    expect((await run(ok200(makeCatalog()), (call) => call.respond(404, { error: 'CLINIC_NOT_FOUND' }))).outcome).toEqual({ kind: 'NOT_FOUND' });
  });

  it('한쪽이 404 면 다른 쪽이 끝내 오지 않아도 바로 NOT_FOUND 다', async () => {
    const t = setup();
    const pending = loadClinicData(t.deps, SLUG, new AbortController().signal);
    await settle();
    t.catalog().respond(404, { error: 'CLINIC_NOT_FOUND' });
    expect(await pending).toEqual({ kind: 'NOT_FOUND' });
  });

  it.each([400, 401, 403, 409, 422, 429, 500, 502, 503, 204, 301])('상태 %i 은 FAILED (코드·상태를 화면에 올리지 않는다)', async (status) => {
    expect((await run((call) => call.respond(status, { error: 'X' }), ok200(makeOptions()))).outcome).toEqual({ kind: 'FAILED' });
    expect((await run(ok200(makeCatalog()), (call) => call.respond(status, { error: 'X' }))).outcome).toEqual({ kind: 'FAILED' });
  });

  it('연결 실패는 FAILED', async () => {
    expect((await run((call) => call.fail(), ok200(makeOptions()))).outcome).toEqual({ kind: 'FAILED' });
    expect((await run(ok200(makeCatalog()), (call) => call.fail())).outcome).toEqual({ kind: 'FAILED' });
  });

  it('본문을 읽을 수 없으면(JSON 이 아님) FAILED', async () => {
    expect((await run((call) => call.respondUnreadable(200), ok200(makeOptions()))).outcome).toEqual({ kind: 'FAILED' });
  });

  it('모양이 계약과 다르면 FAILED: 일부만 맞는 자료로 열지 않는다', async () => {
    expect((await run(ok200({ ...makeCatalog(), treatments: 'none' }), ok200(makeOptions()))).outcome).toEqual({ kind: 'FAILED' });
    expect((await run(ok200(makeCatalog()), ok200({ ...makeOptions(), generations: [] }))).outcome).toEqual({ kind: 'FAILED' });
    expect((await run(ok200({}), ok200({}))).outcome).toEqual({ kind: 'FAILED' });
  });

  it('응답한 병원이 요청한 병원과 다르면 FAILED (다른 병원의 가격을 보이지 않는다)', async () => {
    const other = makeCatalog({ clinic: { slug: 'test-fixture-clinic-2', displayName: 'TEST_FIXTURE 다른 의원', setting: 'OUTPATIENT_ONLY' } });
    expect((await run(ok200(other), ok200(makeOptions()))).outcome).toEqual({ kind: 'FAILED' });
  });

  it('치료가 0개이면 NO_TREATMENTS (시작할 수 없다)', async () => {
    const catalog = makeCatalog({ treatments: [] });
    expect((await run(ok200(catalog), ok200(makeOptions()))).outcome).toEqual({ kind: 'NO_TREATMENTS', catalog });
  });

  it('게시한 카탈로그가 없으면(catalogVersion null) 치료가 있어도 NO_TREATMENTS', async () => {
    const catalog = makeCatalog({ catalogVersion: null });
    expect((await run(ok200(catalog), ok200(makeOptions()))).outcome).toEqual({ kind: 'NO_TREATMENTS', catalog });
  });
});

describe('시간 제한과 취소', () => {
  it('시간 제한이 되면 FAILED 이고 전송을 취소한다 (취소 신호를 무시하고 끝내 응답하지 않는 전송이어도)', async () => {
    const t = setup();
    const pending = loadClinicData(t.deps, SLUG, new AbortController().signal);
    await settle();
    t.timers[0]?.callback();
    expect(await pending).toEqual({ kind: 'FAILED' });
    expect(t.calls.every((call) => call.init.signal.aborted)).toBe(true);
  });

  it('시간 제한은 주입한 값이다 (deps.refreshTimeoutMs)', async () => {
    const t = setup({ refreshTimeoutMs: 3_000 });
    const pending = loadClinicData(t.deps, SLUG, new AbortController().signal);
    await settle();
    expect(t.timers[0]?.delayMs).toBe(3_000);
    t.timers[0]?.callback();
    await pending;
  });

  it('이미 취소된 신호로는 전송을 시작하지 않고 FAILED 다', async () => {
    const t = setup();
    const abort = new AbortController();
    abort.abort();
    expect(await loadClinicData(t.deps, SLUG, abort.signal)).toEqual({ kind: 'FAILED' });
    expect(t.calls).toHaveLength(0);
    expect(t.timers).toHaveLength(0);
  });

  it('받는 동안 신호가 취소되면 두 전송을 취소한다. 취소한 시도의 결과는 호출하는 쪽이 쓰지 않는다', async () => {
    const t = setup();
    const abort = new AbortController();
    const pending = loadClinicData(t.deps, SLUG, abort.signal);
    await settle();
    abort.abort();
    expect(t.calls.every((call) => call.init.signal.aborted)).toBe(true);
    t.catalog().fail();
    t.options().fail();
    expect(await pending).toEqual({ kind: 'FAILED' });
  });

  it('끝난 뒤에는 시간 제한 타이머가 치워져 있고, 늦게 오는 응답은 아무것도 바꾸지 않는다', async () => {
    const t = setup();
    const pending = loadClinicData(t.deps, SLUG, new AbortController().signal);
    await settle();
    t.catalog().respond(404, {});
    expect(await pending).toEqual({ kind: 'NOT_FOUND' });
    expect(t.timers[0]?.cleared).toBe(true);
    t.options().respond(200, makeOptions());
    await settle();
  });
});

describe('끝난 뒤 남은 요청 정리 (F4)', () => {
  // 받기가 끝나는 순간(성공·실패·시간 제한) 아직 오가는 요청이 없도록 취소 신호로 정리한다. 결과는 바뀌지 않는다.
  const failures: Array<[string, (call: Call) => void]> = [
    ['404', (call) => call.respond(404, { error: 'CLINIC_NOT_FOUND' })],
    ['500', (call) => call.respond(500, { error: 'X' })],
    ['연결 실패', (call) => call.fail()],
  ];

  it.each(failures)('한쪽이 %s 로 먼저 끝나면 아직 오가는 다른 쪽 요청의 취소 신호가 켜진다', async (_name, fail) => {
    const t = setup();
    const pending = loadClinicData(t.deps, SLUG, new AbortController().signal);
    await settle();
    expect(t.calls.every((call) => !call.init.signal.aborted)).toBe(true);
    fail(t.catalog());
    await pending;
    expect(t.options().init.signal.aborted).toBe(true);
  });

  it('취소된 쪽이 취소 오류로 끝나도 결말은 처음 실패 그대로다 (늦은 결과를 쓰지 않는다)', async () => {
    const calls: Array<{ url: string; init: TransportInit; settleWith: (status: number) => void }> = [];
    const transport: Transport = (url, init) =>
      new Promise((resolve, reject) => {
        calls.push({ url, init, settleWith: (status) => resolve({ status, json: () => Promise.resolve({}) }) });
        init.signal.addEventListener('abort', () => reject(new Error('TEST_FIXTURE: 취소됨')), { once: true });
      });
    const t = setup({ transport });
    const pending = loadClinicData(t.deps, SLUG, new AbortController().signal);
    await settle();
    calls.find((call) => call.url.endsWith('/catalog'))?.settleWith(404);
    expect(await pending).toEqual({ kind: 'NOT_FOUND' });
    await settle();
    expect(calls.find((call) => call.url.endsWith('/insurance/options'))?.init.signal.aborted).toBe(true);
  });

  it('시간 제한으로 끝날 때도 두 요청이 취소된다 (한 번만 취소해도 결말은 FAILED 그대로)', async () => {
    const t = setup();
    const pending = loadClinicData(t.deps, SLUG, new AbortController().signal);
    await settle();
    t.timers[0]?.callback();
    expect(await pending).toEqual({ kind: 'FAILED' });
    expect(t.calls.every((call) => call.init.signal.aborted)).toBe(true);
  });

  it('둘 다 성공하면 본문을 모두 읽은 뒤에 정리하므로 결과가 그대로 READY 다 (읽는 도중 취소하지 않는다)', async () => {
    const catalog = makeCatalog();
    const options = makeOptions();
    const bodyReadAfterAbort: string[] = [];
    const transport: Transport = (url, init) =>
      Promise.resolve({
        status: 200,
        json: () => {
          if (init.signal.aborted) bodyReadAfterAbort.push(url);
          return init.signal.aborted ? Promise.reject(new Error('TEST_FIXTURE: 읽기 전에 취소됨')) : Promise.resolve(url.endsWith('/catalog') ? catalog : options);
        },
      });
    const t = setup({ transport });
    expect(await loadClinicData(t.deps, SLUG, new AbortController().signal)).toEqual({ kind: 'READY', catalog, options });
    expect(bodyReadAfterAbort).toEqual([]);
    expect(t.timers[0]?.cleared).toBe(true);
  });
});

describe('점으로만 된 slug (N7)', () => {
  // "." 와 ".." 는 encodeURIComponent 가 그대로 두어 주소 해석기가 다른 경로로 바꾼다. 요청을 만들지 않고 알 수 없는 병원과 같은 결말로 끝낸다.
  it.each(['.', '..', '...'])('slug "%s" 는 요청도 타이머도 없이 NOT_FOUND 다', async (slug) => {
    const t = setup();
    expect(await loadClinicData(t.deps, slug, new AbortController().signal)).toEqual({ kind: 'NOT_FOUND' });
    expect(t.calls).toHaveLength(0);
    expect(t.timers).toHaveLength(0);
  });

  it('점이 들어 있어도 점으로만 되지 않은 slug 는 평소대로 요청한다', async () => {
    const t = setup();
    const pending = loadClinicData(t.deps, 'a.b', new AbortController().signal);
    await settle();
    expect(t.calls.map((call) => call.url)).toEqual(['/api/clinics/a.b/catalog', '/api/clinics/a.b/insurance/options']);
    t.catalog().respond(404, {});
    expect(await pending).toEqual({ kind: 'NOT_FOUND' });
  });

  it('보통 slug 는 그대로, 공백·한글·슬래시는 지금처럼 부호화된다', () => {
    expect(clinicUrls('a.b').catalog).toBe('/api/clinics/a.b/catalog');
    expect(clinicUrls(SLUG).options).toBe(`/api/clinics/${SLUG}/insurance/options`);
    expect(clinicUrls('a b').catalog).toBe('/api/clinics/a%20b/catalog');
    expect(clinicUrls('한글').catalog).toBe('/api/clinics/%ED%95%9C%EA%B8%80/catalog');
  });
});
