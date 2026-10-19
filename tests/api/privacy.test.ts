import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import type { ServerLogEntry } from '../../src/server/api/log';
import { CollectingLog, CLINIC_1_SLUG, createTestServices, useTestServices } from '../fixtures/server/api-composition.fixture';
import type { ApiServices } from '../../src/server/api/services';
import { GEN, INSURER, buildWorld, requestBody } from '../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../fixtures/server/estimate-world.fixture';
import { T1, T2 } from '../fixtures/server/base-fee.fixture';
import { countingCache, currentBody, estimateSpy } from './cache-contract-helpers';
import { CONTRACT_FIELDS } from '../../src/server/api/estimate-request';
import { repoWith } from './helpers';
import { callPost, callPostRequest, callPostWithJson } from './post-helpers';

// AC-016e · AC-016n (integration): 환자가 고른 값(세대·보험사 형태·치료 원인·치료 id)과 키오스크 시도 식별자(requestId: 본문·헤더 x-request-id·쿼리)는
// 서버 로그, 저장소 쓰기, 서버 메모리의 캐시·맵·모듈 상태 어디에도 남지 않고, 서버는 requestId 를 읽지 않는다 (design.md DD-09 · REQ-API-002).
// 방법: 실제 route.ts 의 POST 로 요청을 여러 건 보낸 뒤 (a) 로그 수집기, (b) 저장소 전체 덤프의 전후 비교, (c) 묶음 내용 캐시, (d) 서비스 객체가 들고 있는 모든 것,
// (e) src/server·src/app 모듈이 내보내는 값(모듈 수준 상태)을 훑는다. 표지 값은 어디에도 없는 고유 문자열이라 한 글자라도 나오면 잡힌다.
// '없음' 이 빈 검사가 되지 않도록 검사기 자체의 대조군(표지를 심은 구조는 찾아낸다)과, 표지가 실제로 요청에 실려 있다는 대조군을 함께 둔다.
// 한계는 파일 끝 설명과 progress.md 에 적는다: 클로저 안의 비공개 상태는 모듈 내보내기 훑기로 보이지 않는다(공개된 캐시·저장소·로그·서비스는 위 (a)~(d)가 직접 본다).

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

vi.mock('../../src/engine/estimate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/estimate')>();
  return { ...real, estimate: vi.fn(real.estimate) };
});

beforeEach(() => {
  useTestServices(null);
  estimateSpy.mockClear();
});

const MARKER = 'TEST_FIXTURE_MARKER_REQUEST_ID_9d41c7e2';

// ───────────────────────── 검사기 ─────────────────────────

/** 값 안에 needle 이 문자열(키·값·Map 키/값·Set 원소 포함)로 나오는지 깊이 훑는다. 함수는 훑지 않는다(클로저는 보이지 않는다). 순환을 따라가지 않는다. */
function deepContains(value: unknown, needle: string, seen: WeakSet<object> = new WeakSet()): boolean {
  if (typeof value === 'string') return value.includes(needle);
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Map) {
    return [...value].some(([key, inner]) => deepContains(key, needle, seen) || deepContains(inner, needle, seen));
  }
  if (value instanceof Set) {
    return [...value].some((inner) => deepContains(inner, needle, seen));
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8').includes(needle);
  }
  return Reflect.ownKeys(value).some((key) => (typeof key === 'string' && key.includes(needle)) || deepContains((value as Record<PropertyKey, unknown>)[key], needle, seen));
}

describe('검사기 자체의 대조군: 표지를 심은 구조는 어디에 있든 찾아낸다', () => {
  it.each<[string, unknown]>([
    ['문자열', `a-${MARKER}-b`],
    ['객체 값', { a: { b: [1, 2, { c: MARKER }] } }],
    ['객체 키', { [MARKER]: 1 }],
    ['Map 키', new Map([[MARKER, 1]])],
    ['Map 값', new Map([['k', { deep: [MARKER] }]])],
    ['Set 원소', new Set([MARKER])],
    ['배열 안의 Map 안의 Set', [new Map([['k', new Set([MARKER])]])]],
    ['바이트 배열', new TextEncoder().encode(`x${MARKER}`)],
    ['클래스 인스턴스의 비공개처럼 보이는 필드', new (class Holder { private hidden = { requestIdKeyedCache: new Map([[MARKER, true]]) }; })()],
  ])('%s', (_label, structure) => {
    expect(deepContains(structure, MARKER)).toBe(true);
  });

  it('표지가 없으면 찾지 않고(거짓 양성 없음), 순환 구조에서도 끝난다', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    expect(deepContains(cyclic, MARKER)).toBe(false);
    expect(deepContains([new Map([['k', new Set(['v'])]]), { a: 1 }, null, undefined, 3], MARKER)).toBe(false);
  });
});

// ───────────────────────── 시험 세계 ─────────────────────────

interface Run {
  w: EstimateWorld;
  log: CollectingLog;
  services: ApiServices;
  cache: ReturnType<typeof countingCache>['cache'];
}

function runWorld(): Run {
  const w = buildWorld();
  const log = new CollectingLog();
  const { cache } = countingCache();
  const services = createTestServices({ repo: w.world.repo, log, bundleCache: cache });
  useTestServices(services);
  return { w, log, services, cache };
}

const post = (body: unknown) => callPost(POST, CLINIC_1_SLUG, body);

/** 환자 선택의 격자: 다섯 세대 × 세 보험사 형태, 원인과 치료 조합은 돌려 가며 바꾼다. 15건이고 모두 서로 다른 (세대, 보험사 형태) 쌍이다. */
const GENERATIONS = ['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4'] as const;
const INSURER_TYPES = ['NON_LIFE', 'LIFE', 'MUTUAL_AID'] as const;
const CAUSES = ['INJURY', 'ILLNESS', 'UNKNOWN'] as const;
const TREATMENT_SETS = [[T1], [T2], [T1, T2], [T2, T1, T1]] as const;

function selectionGrid(w: EstimateWorld): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  let turn = 0;
  for (const generation of GENERATIONS) {
    for (const insurerType of INSURER_TYPES) {
      bodies.push(currentBody(w, { generation, insurerType, cause: CAUSES[turn % CAUSES.length], treatmentIds: [...TREATMENT_SETS[turn % TREATMENT_SETS.length]!] }));
      turn += 1;
    }
  }
  return bodies;
}

describe('AC-016e 계산 요청을 처리한 뒤 서버 저장소와 로그에 환자 선택·결과가 없다', () => {
  it('환자 선택이 서로 다른 15건(세대 × 보험사 형태 × 원인 × 치료 조합)을 보내도 저장소 덤프는 전후가 같고 로그는 비어 있다', async () => {
    const { w, log } = runWorld();
    const before = structuredClone(w.world.repo.exportState());
    const statuses: number[] = [];
    for (const body of selectionGrid(w)) {
      statuses.push((await post(body)).status);
    }
    expect(statuses).toHaveLength(15);
    expect(new Set(statuses)).toEqual(new Set([200]));
    expect(w.world.repo.exportState()).toEqual(before);
    expect(log.entries).toEqual([]);
  });

  it('요청마다 저장소 쓰기가 없다: 감사 기록·상태 이력·범위 이력·검토 요청의 개수가 요청 전후로 같다', async () => {
    const { w } = runWorld();
    const counts = () => ({ audit: w.world.repo.listAuditLog().length, scope: w.world.repo.listClinicRuleScopeHistory('TEST_FIXTURE_CLINIC_1').length, reviews: w.world.repo.listCoverageReviewRequests('TEST_FIXTURE_CLINIC_1').length, events: w.world.repo.listBundleStatusEvents(w.bundle!.id).length });
    const before = counts();
    for (const body of selectionGrid(w)) await post(body);
    expect(counts()).toEqual(before);
  });

  it('캐시는 요청 내용에 의존하지 않는다: 15건을 보낸 뒤의 캐시는 한 건만 보낸 뒤의 캐시와 깊이 같다', async () => {
    const one = runWorld();
    await post(currentBody(one.w));
    const many = runWorld();
    for (const body of selectionGrid(many.w)) await post(body);
    expect(many.cache.entries()).toEqual(one.cache.entries());
    expect(many.cache.entries()).toHaveLength(1);
  });

  it('거절 응답(400·422·409)에 쓴 환자 값(고유 표지)이 로그·저장소·캐시·서비스 어디에도 남지 않는다', async () => {
    const { w, log, services, cache } = runWorld();
    const before = structuredClone(w.world.repo.exportState());
    const marks = { generation: 'TEST_FIXTURE_MARK_GENERATION_31', insurerType: 'TEST_FIXTURE_MARK_INSURER_32', cause: 'TEST_FIXTURE_MARK_CAUSE_33', treatment: 'TEST_FIXTURE_MARK_TREATMENT_34', catalog: 'TEST_FIXTURE_MARK_CATALOG_35', bundle: 'TEST_FIXTURE_MARK_BUNDLE_36' };
    const results = await Promise.all([
      post(currentBody(w, { generation: marks.generation })), // 422 UNSUPPORTED_GENERATION
      post(currentBody(w, { insurerType: marks.insurerType })), // 400
      post(currentBody(w, { cause: marks.cause })), // 400
      post(currentBody(w, { treatmentIds: [marks.treatment] })), // 422 TREATMENT_NOT_PUBLISHED
      post(currentBody(w, { catalogVersion: marks.catalog, treatmentIds: [marks.treatment] })), // 409
      post(currentBody(w, { ruleBundleVersion: marks.bundle })), // 409
    ]);
    expect(results.map((result) => result.status)).toEqual([422, 400, 400, 422, 409, 409]);
    expect(log.entries).toEqual([]);
    expect(w.world.repo.exportState()).toEqual(before);
    for (const mark of Object.values(marks)) {
      expect(deepContains(w.world.repo.exportState(), mark), mark).toBe(false);
      expect(deepContains(log.entries, mark), mark).toBe(false);
      expect(deepContains(cache.entries(), mark), mark).toBe(false);
      expect(deepContains(services, mark), mark).toBe(false);
    }
  });

  it('서버 결함(500)이 나는 요청에서도 로그는 사건 이름과 닫힌 코드뿐이고 환자 선택이 들어가지 않으며 응답에도 없다', async () => {
    const w = buildWorld();
    const log = new CollectingLog();
    useTestServices(createTestServices({ repo: repoWith(w.world.repo, { getRuleBundleVersion: () => null }), log }));
    const selection = { generation: GEN, insurerType: INSURER, cause: 'INJURY', treatmentIds: [T1, T2] };
    const called = await post(requestBody(w, selection));
    expect(called.status).toBe(500);
    expect(called.body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(log.entries).toEqual([{ event: 'SERVER_INTEGRITY_ERROR', code: 'BUNDLE_MISSING' }]);
    for (const entry of log.entries as ServerLogEntry[]) {
      expect(Object.keys(entry).sort()).toEqual(['code', 'event']);
    }
    for (const value of [GEN, INSURER, 'INJURY', T1, T2]) {
      expect(JSON.stringify(log.entries), value).not.toContain(value);
      expect(called.text, value).not.toContain(value);
    }
  });

  it('예기치 못한 오류(UNEXPECTED)의 로그도 환자 선택 없이 코드 하나뿐이다', async () => {
    const w = buildWorld();
    const log = new CollectingLog();
    const boom = repoWith(w.world.repo, {
      getClinicRuleScope: () => {
        throw new Error(`TEST_FIXTURE 예기치 못한 오류 ${GEN} ${T1}`);
      },
    });
    useTestServices(createTestServices({ repo: boom, log }));
    const called = await post(requestBody(w, { cause: 'ILLNESS' }));
    expect(called.status).toBe(500);
    expect(log.entries).toEqual([{ event: 'UNEXPECTED_ERROR', code: 'UNEXPECTED' }]);
    expect(called.text).not.toContain(GEN);
    expect(called.text).not.toContain(T1);
  });
});

// ───────────────────────── AC-016n ─────────────────────────

interface Recorded {
  request: Request;
  /** 핸들러가 요청 객체에서 읽은 속성 이름 (읽은 순서). */
  accessed: string[];
}

/** 진짜 Request 를 Proxy 로 감싸 속성 읽기를 모두 기록한다. 본문은 진짜로 실려 있어 핸들러가 읽을 수 있다. */
function recordedRequest(init: { body: unknown; headerValue?: string; query?: string }): Recorded {
  const url = `http://localhost/api/clinics/${CLINIC_1_SLUG}/estimate${init.query === undefined ? '' : `?${init.query}`}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.headerValue !== undefined) {
    headers['x-request-id'] = init.headerValue;
  }
  const real = new Request(url, { method: 'POST', headers, body: JSON.stringify(init.body) });
  const accessed: string[] = [];
  const request = new Proxy(real, {
    get(target, property) {
      accessed.push(String(property));
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { request, accessed };
}

/** 본문 객체를 Proxy 로 감싸 읽은 이름을 기록한다. 객체 전체를 훑는 접근(ownKeys)은 이름 없이 따로 센다. */
function recordedBody(body: Record<string, unknown>): { proxy: Record<string, unknown>; names: Set<string>; enumerations: () => number } {
  const names = new Set<string>();
  let enumerations = 0;
  const proxy = new Proxy(body, {
    get(target, property) {
      // 약속(Promise)이 값을 풀 때 보는 then 은 서버 코드의 접근이 아니라 이 시험이 json() 을 약속으로 돌려주는 방식의 부산물이다 (M4.B 의 본문 접근 감시와 같다).
      if (property !== 'then') names.add(String(property));
      return Reflect.get(target, property);
    },
    has(target, property) {
      names.add(String(property));
      return Reflect.has(target, property);
    },
    ownKeys(target) {
      enumerations += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      names.add(String(property));
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  return { proxy, names, enumerations: () => enumerations };
}

describe('AC-016n 키오스크 시도 requestId (본문·헤더 x-request-id·쿼리)는 서버 어디에도 남지 않고 서버는 읽지 않는다', () => {
  it('대조군: 표지는 실제로 요청에 실려 있다 (헤더·쿼리·본문에서 꺼낼 수 있다)', async () => {
    const { request } = recordedRequest({ body: { requestId: MARKER }, headerValue: MARKER, query: `requestId=${MARKER}` });
    expect(request.url).toContain(MARKER);
    expect(new URL(request.url).searchParams.get('requestId')).toBe(MARKER);
    expect(request.headers.get('x-request-id')).toBe(MARKER);
    expect(((await request.json()) as { requestId: string }).requestId).toBe(MARKER);
  });

  const CARRIERS: Array<[string, (body: Record<string, unknown>) => Parameters<typeof recordedRequest>[0]]> = [
    ['본문 필드 requestId', (body) => ({ body: { ...body, requestId: MARKER } })],
    ['본문 필드 requestId (중첩)', (body) => ({ body: { ...body, meta: { attempt: { requestId: MARKER } }, request_id: MARKER } })],
    ['헤더 x-request-id', (body) => ({ body, headerValue: MARKER })],
    ['쿼리 requestId', (body) => ({ body, query: `requestId=${MARKER}` })],
    ['쿼리 x-request-id 와 attemptId', (body) => ({ body, query: `x-request-id=${MARKER}&attemptId=${MARKER}` })],
    ['본문·헤더·쿼리 모두', (body) => ({ body: { ...body, requestId: MARKER }, headerValue: MARKER, query: `requestId=${MARKER}` })],
  ];

  it.each(CARRIERS)('%s: 응답이 표지 없는 요청의 응답과 바이트까지 같고, 핸들러가 요청에서 읽은 것은 json() 뿐이다', async (_label, carry) => {
    const { w } = runWorld();
    const body = currentBody(w);
    const baseline = await post(body);
    expect(baseline.status).toBe(200);

    const recorded = recordedRequest(carry(body));
    const withMarker = await callPostRequest(POST, CLINIC_1_SLUG, recorded.request);
    expect(withMarker.status).toBe(200);
    expect(withMarker.text).toBe(baseline.text);
    expect(recorded.accessed).toEqual(['json']);
    expect(withMarker.text).not.toContain(MARKER);
  });

  it('거절 응답(400·409·422)과 500 응답도 표지가 있든 없든 같고, 표지는 응답에 나오지 않는다', async () => {
    const { w } = runWorld();
    const variants: Array<[number, Record<string, unknown>]> = [
      [400, currentBody(w, { cause: 'NO_SUCH_CAUSE' })],
      [409, currentBody(w, { catalogVersion: 'TEST_FIXTURE_OLD' })],
      [422, currentBody(w, { treatmentIds: ['TEST_FIXTURE_NO_SUCH'] })],
    ];
    for (const [status, body] of variants) {
      const baseline = await post(body);
      const recorded = recordedRequest({ body: { ...body, requestId: MARKER }, headerValue: MARKER, query: `requestId=${MARKER}` });
      const withMarker = await callPostRequest(POST, CLINIC_1_SLUG, recorded.request);
      expect(baseline.status).toBe(status);
      expect(withMarker.status).toBe(status);
      expect(withMarker.text).toBe(baseline.text);
      expect(recorded.accessed).toEqual(['json']);
    }
    // 500: 저장소가 묶음 기록을 잃은 상황
    const w2 = buildWorld();
    const log = new CollectingLog();
    useTestServices(createTestServices({ repo: repoWith(w2.world.repo, { getRuleBundleVersion: () => null }), log }));
    const baseline500 = await post(requestBody(w2));
    const recorded = recordedRequest({ body: { ...requestBody(w2), requestId: MARKER }, headerValue: MARKER, query: `requestId=${MARKER}` });
    const withMarker500 = await callPostRequest(POST, CLINIC_1_SLUG, recorded.request);
    expect([baseline500.status, withMarker500.status]).toEqual([500, 500]);
    expect(withMarker500.text).toBe(baseline500.text);
    expect(JSON.stringify(log.entries)).not.toContain(MARKER);
    expect(log.entries).toHaveLength(2);
  });

  it('본문 접근 감시: 표지가 든 본문에서도 서버가 읽은 이름은 계약의 여섯 이름뿐이다 (requestId 를 읽지 않고 본문 전체를 훑지도 않는다)', async () => {
    const { w } = runWorld();
    const watched = recordedBody({ ...currentBody(w), requestId: MARKER, request_id: MARKER });
    const called = await callPostWithJson(POST, CLINIC_1_SLUG, () => Promise.resolve(watched.proxy));
    expect(called.status).toBe(200);
    expect(watched.names.has('requestId')).toBe(false);
    expect(watched.names.has('request_id')).toBe(false);
    expect([...watched.names].every((name) => (CONTRACT_FIELDS as readonly string[]).includes(name))).toBe(true);
    expect(watched.names.size).toBeGreaterThan(0);
    expect(watched.enumerations()).toBe(0);
  });

  it('요청 여러 건(표지 있음·없음, 세 통로 섞어서) 뒤: 저장소 덤프 전후가 같고, 로그·저장소·캐시·서비스 객체 어디에도 표지가 없다', async () => {
    const { w, log, services, cache } = runWorld();
    const before = structuredClone(w.world.repo.exportState());
    const bodies = selectionGrid(w);
    for (const [index, body] of bodies.entries()) {
      const carrier = CARRIERS[index % CARRIERS.length]![1];
      const recorded = recordedRequest(carrier(body));
      await callPostRequest(POST, CLINIC_1_SLUG, recorded.request);
      expect(recorded.accessed).toEqual(['json']);
    }
    await post(currentBody(w, { treatmentIds: ['TEST_FIXTURE_NO_SUCH'] }));
    expect(w.world.repo.exportState()).toEqual(before);
    expect(deepContains(w.world.repo.exportState(), MARKER)).toBe(false);
    expect(deepContains(log.entries, MARKER)).toBe(false);
    expect(deepContains(cache.entries(), MARKER)).toBe(false);
    expect(deepContains(services, MARKER)).toBe(false);
    expect(log.entries).toEqual([]);
    expect(cache.entries()).toHaveLength(1);
  });

  it('src/server 와 src/app 모듈이 내보내는 값(모듈 수준 상태)에도 표지가 없다 (함수 안 클로저는 훑지 못한다: 한계)', async () => {
    const { w } = runWorld();
    for (const [index, body] of selectionGrid(w).entries()) {
      const recorded = recordedRequest(CARRIERS[index % CARRIERS.length]![1](body));
      await callPostRequest(POST, CLINIC_1_SLUG, recorded.request);
    }
    const root = fileURLToPath(new URL('../../src', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== 'engine') walk(full);
        } else if (/\.tsx?$/.test(name)) {
          files.push(full);
        }
      }
    };
    walk(root);
    let scannedValues = 0;
    for (const file of files) {
      const moduleExports = (await import(/* @vite-ignore */ file.replaceAll('\\', '/'))) as Record<string, unknown>;
      for (const [name, value] of Object.entries(moduleExports)) {
        if (typeof value === 'function') continue;
        scannedValues += 1;
        expect(deepContains(value, MARKER), `${file} ${name}`).toBe(false);
      }
    }
    expect(files.length).toBeGreaterThan(40);
    expect(scannedValues).toBeGreaterThan(20); // 빈 검사 방지: 함수가 아닌 내보내기(상수 표 등)를 실제로 훑었다
  });
});
