import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import type { AdminIdentity } from '../../src/server/admin/auth';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { handleOptions } from '../../src/server/api/options';
import { DEFAULT_IDLE_THRESHOLDS, IDLE_SCREEN_KINDS, MIN_IDLE_LEAD_SECONDS } from '../../src/server/idle-policy';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG } from '../fixtures/server/api-composition.fixture';
import { T1 } from '../fixtures/server/base-fee.fixture';
import { composeWorld } from '../fixtures/server/bundle-compose.fixture';
import { changedKeys } from '../fixtures/server/catalog-structure.fixture';
import { OTHER_CLINIC_ID } from '../fixtures/server/versioning.fixture';

// 병원별 무조작 정책 설정 (M7 병원별 무조작 정책 설정, AC-023d · AC-023f · AC-022a · AC-015i). 모두 handleAdmin(실제 관리자 핸들러)과 공개 핸들러를 지난다.
//   HA  GET /api/admin/clinics/{clinicId}/idle-policy     — 읽기 { clinic, idlePolicy, customizedScreens, defaults, minLeadSeconds, policyDigest }
//   HA  PUT /api/admin/clinics/{clinicId}/idle-policy     — 조건부 저장(전체 교체). 본문 { screens(일부 가능), completionHoldSeconds: 양의 정수 | null, expectedDigest: GET 의 policyDigest }
//                                                            지문이 현재 저장 상태와 다르면 409 IDLE_POLICY_CHANGED(정책·감사 기록 그대로), 지문 누락·형식 오류는 400. 동시 저장 방어 묶음은 파일 끝에 있다.
//   (save 도우미는 보내기 직전에 현재 지문을 읽어 담는다. 지문이 낡은 경우를 보는 시험은 도우미 없이 지문을 직접 정해 보낸다. 실제 DB 의 동시성은 보지 않는다: 같은 저장소 트랜잭션 안의 비교만 본다.)
// 세계: 병원 A(=병원 1, 규칙 묶음 있음)·병원 B(=병원 2). 두 병원 모두 정책을 저장한 적이 없다.
// 경로 → 소속·역할(403) → 병원(404) → 본문(400) 순서이고, 거절은 정책 저장소도 감사 기록도 바꾸지 않는다(저장소 전체 사본으로 비교한다).

const BASE = 'http://localhost/api/admin';
const CLINIC_A = TEST_FIXTURE_CLINIC_ID;
const CLINIC_B = OTHER_CLINIC_ID;
const path = (clinicId: string): string => `clinics/${encodeURIComponent(clinicId)}/idle-policy`;

const PLATFORM_HA: AdminIdentity = { userId: 'TEST_FIXTURE_HA_PLATFORM', memberships: [{ clinicId: null, role: 'HA' }] };
const GHOST_HA: AdminIdentity = { userId: 'TEST_FIXTURE_HA_GHOST', memberships: [{ clinicId: 'TEST_FIXTURE_CLINIC_GHOST', role: 'HA' }] };

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type Who = TestAccountKey | AdminIdentity | null;

function setup() {
  const { world } = composeWorld();
  const as = (who: Who) => adminServicesOf(world, { authenticator: staticAuthenticator(who === null ? null : typeof who === 'string' ? identityOf(who) : who) }).admin;
  const api = adminServicesOf(world, { authenticator: staticAuthenticator(null) }).api;
  // 세계를 만드는 과정(게시·지정)이 감사 기록을 이미 남긴다: 시험은 그 뒤에 새로 쌓인 기록만 본다.
  const baseline = world.repo.listAuditLog().length;
  return { world, repo: world.repo, as, api, state: () => world.repo.exportState(), audit: () => world.repo.listAuditLog().slice(baseline) };
}

type Setup = ReturnType<typeof setup>;

const segmentsOf = (value: string): string[] => value.split('/').filter((part) => part !== '').map(decodeURIComponent);

function call(admin: ReturnType<Setup['as']>, method: string, target: string, body?: unknown, extra: RequestInit = {}): Promise<Response> {
  const init: RequestInit = { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...extra };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return handleAdmin(admin, new Request(`${BASE}/${target}`, init), segmentsOf(target));
}

const callRaw = (admin: ReturnType<Setup['as']>, method: string, target: string, text: string): Promise<Response> =>
  handleAdmin(admin, new Request(`${BASE}/${target}`, { method, body: text, headers: { 'content-type': 'application/json' } }), segmentsOf(target));

const json = async (response: Response): Promise<Json> => (await response.json()) as Json;

type Screens = Record<string, { warnSeconds: unknown; resetSeconds: unknown }>;
const putBody = (screens: Screens, completionHoldSeconds: unknown = null) => ({ screens, completionHoldSeconds });

/** 지금 저장 상태의 지문(GET policyDigest). */
async function digestOf(world: Setup, who: Who = 'ha-clinic-1', clinicId: string = CLINIC_A): Promise<string> {
  const view = await json(await call(world.as(who), 'GET', path(clinicId)));
  return view.policyDigest as string;
}

/**
 * 병원 A 에 HA 가 저장한다: 보내기 직전에 현재 지문을 읽어 expectedDigest 로 담는다(본문에 이미 expectedDigest 가 있으면 그대로 둔다; 객체가 아닌 본문은 그대로 보낸다).
 * 값 검사·감사 기록·병원 분리를 보는 시험이 쓴다. 동시 저장 방어(지문이 낡은 경우)를 보는 시험은 이 도우미를 쓰지 않고 지문을 직접 정해 보낸다.
 */
async function save(world: Setup, body: unknown, who: Who = 'ha-clinic-1'): Promise<Response> {
  const payload = typeof body === 'object' && body !== null && !Array.isArray(body) && !('expectedDigest' in body) ? { ...body, expectedDigest: await digestOf(world, who) } : body;
  return call(world.as(who), 'PUT', path(CLINIC_A), payload);
}

async function publicCatalog(world: Setup, slug: string): Promise<{ text: string; body: Json }> {
  const response = await handleCatalog(world.api, slug);
  const text = await response.text();
  return { text, body: JSON.parse(text) as Json };
}

const defaultsAsJson = (): Json => JSON.parse(JSON.stringify(DEFAULT_IDLE_THRESHOLDS)) as Json;

describe('읽기: GET /clinics/{id}/idle-policy', () => {
  it('저장한 적 없는 병원은 DD-10 표의 기본값 다섯 종류와 completionHoldSeconds null, 직접 저장한 종류 없음을 낸다. 읽기는 저장소를 바꾸지 않는다', async () => {
    const world = setup();
    const before = world.state();

    const response = await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['clinic', 'customizedScreens', 'defaults', 'idlePolicy', 'minLeadSeconds', 'policyDigest']);
    expect(body.policyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.clinic).toEqual({ id: CLINIC_A, slug: CLINIC_1_SLUG, displayName: expect.any(String) });
    expect(body.idlePolicy).toEqual({ screens: defaultsAsJson(), completionHoldSeconds: null });
    expect(body.customizedScreens).toEqual([]);
    expect(body.defaults).toEqual(defaultsAsJson());
    expect(body.minLeadSeconds).toBe(MIN_IDLE_LEAD_SECONDS);
    expect(Object.keys(body.idlePolicy.screens)).toEqual([...IDLE_SCREEN_KINDS]);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('관리자 보기의 idlePolicy 는 공개 catalog 응답의 idlePolicy 와 같다 (저장 전·후 모두)', async () => {
    const world = setup();
    const admin = (await json(await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A)))).idlePolicy;
    expect((await publicCatalog(world, CLINIC_1_SLUG)).body.idlePolicy).toEqual(admin);

    await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));
    const after = (await json(await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A)))).idlePolicy;
    expect((await publicCatalog(world, CLINIC_1_SLUG)).body.idlePolicy).toEqual(after);
  });
});

describe('접근 판정: 인증 없음은 401, 다른 병원·RV·PO·병원에 매인 RV·플랫폼 HA 는 403, 거절은 저장소도 감사 기록도 바꾸지 않는다', () => {
  const VALID = putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15);

  for (const method of ['GET', 'PUT'] as const) {
    it(`${method}: 인증이 없으면 401 (병원이 있든 없든 같다)`, async () => {
      const world = setup();
      const before = world.state();
      for (const clinicId of [CLINIC_A, 'TEST_FIXTURE_CLINIC_GHOST']) {
        const response = await call(world.as(null), method, path(clinicId), method === 'PUT' ? VALID : undefined);
        expect(response.status).toBe(401);
        expect(await json(response)).toEqual({ error: 'UNAUTHENTICATED' });
      }
      expect(world.state()).toEqual(before);
      expect(world.audit()).toEqual([]);
    });

    const forbidden: Array<[string, Who]> = [
      ['다른 병원의 병원 관리자(HA)', 'ha-clinic-2'],
      ['플랫폼 단위 검토 담당자(RV)', 'rv-1'],
      ['병원 1 에 매인 검토 담당자(RV)', 'rv-clinic-1'],
      ['플랫폼 운영자(PO)', 'po-1'],
      ['병원에 매이지 않은 HA 소속', PLATFORM_HA],
    ];
    for (const [label, who] of forbidden) {
      it(`${method}: ${label} 는 403 이고 저장소·감사 기록이 그대로다`, async () => {
        const world = setup();
        const before = world.state();
        const response = await call(world.as(who), method, path(CLINIC_A), method === 'PUT' ? VALID : undefined);
        expect(response.status).toBe(403);
        expect(await json(response)).toEqual({ error: 'FORBIDDEN' });
        expect(world.state()).toEqual(before);
        expect(world.audit()).toEqual([]);
      });
    }

    it(`${method}: 없는 병원은 소속이 없으면 403 이다 (병원의 존재를 알리지 않는다). 소속은 있는데 병원 기록이 없으면 404`, async () => {
      const world = setup();
      const before = world.state();
      const none = await call(world.as('ha-clinic-1'), method, path('TEST_FIXTURE_CLINIC_GHOST'), method === 'PUT' ? VALID : undefined);
      expect(none.status).toBe(403);
      const ghost = await call(world.as(GHOST_HA), method, path('TEST_FIXTURE_CLINIC_GHOST'), method === 'PUT' ? VALID : undefined);
      expect(ghost.status).toBe(404);
      expect(await json(ghost)).toEqual({ error: 'NOT_FOUND' });
      expect(world.state()).toEqual(before);
      expect(world.audit()).toEqual([]);
    });
  }

  it('요청의 헤더·쿼리·본문에 적은 역할·병원은 권한이 되지 않는다 (위조 시도는 401, 다른 병원 관리자는 본문의 병원 id 로도 403)', async () => {
    const world = setup();
    const before = world.state();
    const forged = await call(world.as(null), 'PUT', `${path(CLINIC_A)}?clinicId=${CLINIC_A}&role=HA`, VALID, { headers: { 'content-type': 'application/json', 'x-role': 'HA', 'x-clinic-id': CLINIC_A, cookie: 'role=HA' } });
    expect(forged.status).toBe(401);
    const bodyClinic = await call(world.as('ha-clinic-2'), 'PUT', path(CLINIC_A), { ...VALID, clinicId: CLINIC_B });
    expect(bodyClinic.status).toBe(403);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('인증된 다른 병원 관리자가 헤더·쿼리로 병원 1 을 가장해도 403 이다 (신원은 인증기가 검증한 소속에서만 온다)', async () => {
    const world = setup();
    const before = world.state();
    const forged = { 'content-type': 'application/json', 'x-clinic-id': CLINIC_A, 'x-role': 'HA', cookie: 'role=HA; clinic=' + CLINIC_A };
    for (const method of ['GET', 'PUT'] as const) {
      // 쿼리는 요청 주소에만 붙이고 경로 조각(segments)에는 넣지 않는다(실제 route.ts 가 하는 대로).
      const request = new Request(`${BASE}/${path(CLINIC_A)}?clinicId=${CLINIC_A}&role=HA`, { method, headers: forged, ...(method === 'PUT' ? { body: JSON.stringify(VALID) } : {}) });
      const response = await handleAdmin(world.as('ha-clinic-2'), request, segmentsOf(path(CLINIC_A)));
      expect(response.status, method).toBe(403);
    }
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('판정 순서: 본문이 잘못돼도(JSON 아님·검사 위반) 권한이 없으면 400 이 아니라 403, 소속은 있는데 병원 기록이 없으면 404 가 먼저다', async () => {
    const world = setup();
    const before = world.state();
    const invalid = putBody({ INPUT: { warnSeconds: 100, resetSeconds: 101 } }, 0);
    expect((await call(world.as('ha-clinic-2'), 'PUT', path(CLINIC_A), invalid)).status).toBe(403);
    expect((await callRaw(world.as('ha-clinic-2'), 'PUT', path(CLINIC_A), '{not json')).status).toBe(403);
    expect((await call(world.as('rv-1'), 'PUT', path(CLINIC_A), invalid)).status).toBe(403);
    expect((await call(world.as(null), 'PUT', path(CLINIC_A), invalid)).status).toBe(401);
    expect((await call(world.as(GHOST_HA), 'PUT', path('TEST_FIXTURE_CLINIC_GHOST'), invalid)).status).toBe(404);
    expect((await callRaw(world.as(GHOST_HA), 'PUT', path('TEST_FIXTURE_CLINIC_GHOST'), '{not json')).status).toBe(404);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('정해진 두 메서드 밖은 405 이고 아무것도 바뀌지 않는다', async () => {
    const world = setup();
    const before = world.state();
    for (const method of ['POST', 'DELETE']) {
      const response = await call(world.as('ha-clinic-1'), method, path(CLINIC_A), method === 'POST' ? VALID : undefined);
      expect(response.status).toBe(405);
    }
    expect(world.state()).toEqual(before);
  });
});

describe('저장: PUT 은 정책 전체를 바꾼다 (생략한 화면 종류는 기본값으로 돌아간다)', () => {
  it('일부 화면 종류만 보내면 그 종류만 직접 저장되고 나머지는 기본값이다. 응답은 저장소에서 다시 읽은 값이고 GET·공개 catalog 와 같다', async () => {
    const world = setup();
    const response = await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(body.customizedScreens).toEqual(['INPUT']);
    expect(body.idlePolicy.completionHoldSeconds).toBe(15);
    expect(body.idlePolicy.screens.INPUT).toEqual({ warnSeconds: 90, resetSeconds: 110 });
    for (const kind of IDLE_SCREEN_KINDS.filter((entry) => entry !== 'INPUT')) {
      expect(body.idlePolicy.screens[kind], kind).toEqual(DEFAULT_IDLE_THRESHOLDS[kind]);
    }
    expect(await json(await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A)))).toEqual(body);
    expect((await publicCatalog(world, CLINIC_1_SLUG)).body.idlePolicy).toEqual(body.idlePolicy);
  });

  it('두 번째 저장이 앞의 저장을 통째로 바꾼다: 이번 본문에 없는 종류는 앞서 직접 저장했어도 기본값으로 돌아가고, 자동 복귀는 null 로 돌아간다', async () => {
    const world = setup();
    await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 }, RESULT: { warnSeconds: 30, resetSeconds: 60 } }, 20));

    const second = await save(world, putBody({ RESULT: { warnSeconds: 40, resetSeconds: 70 } }, null));

    expect(second.status).toBe(200);
    const body = await json(second);
    expect(body.customizedScreens).toEqual(['RESULT']);
    expect(body.idlePolicy.screens.RESULT).toEqual({ warnSeconds: 40, resetSeconds: 70 });
    expect(body.idlePolicy.screens.INPUT).toEqual(DEFAULT_IDLE_THRESHOLDS.INPUT);
    expect(body.idlePolicy.completionHoldSeconds).toBeNull();
  });

  it('screens 가 빈 객체이면 모든 종류가 기본값으로 돌아간다 (직접 저장한 종류 없음)', async () => {
    const world = setup();
    await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));
    const response = await save(world, putBody({}, null));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.customizedScreens).toEqual([]);
    expect(body.idlePolicy).toEqual({ screens: defaultsAsJson(), completionHoldSeconds: null });
  });

  it('다섯 종류를 한 번에 저장할 수 있고 다섯 종류가 모두 직접 저장으로 읽힌다', async () => {
    const world = setup();
    const screens: Screens = {};
    IDLE_SCREEN_KINDS.forEach((kind, index) => {
      screens[kind] = { warnSeconds: 30 + index, resetSeconds: 60 + index };
    });
    const body = await json(await save(world, putBody(screens, 7)));
    expect(body.customizedScreens).toEqual([...IDLE_SCREEN_KINDS]);
    IDLE_SCREEN_KINDS.forEach((kind, index) => expect(body.idlePolicy.screens[kind]).toEqual({ warnSeconds: 30 + index, resetSeconds: 60 + index }));
  });

  it('간격 하한은 20초 이상이다: 정확히 20초는 저장되고(경고 0 포함) 19초는 거절된다', async () => {
    const world = setup();
    expect((await save(world, putBody({ INPUT: { warnSeconds: 100, resetSeconds: 120 } }))).status).toBe(200);
    expect((await save(world, putBody({ INPUT: { warnSeconds: 0, resetSeconds: 20 } }))).status).toBe(200);
    const before = world.state();
    const tooShort = await save(world, putBody({ INPUT: { warnSeconds: 100, resetSeconds: 119 } }));
    expect(tooShort.status).toBe(400);
    expect(world.state()).toEqual(before);
  });

  it('completionHoldSeconds: null(자동 복귀 없음)과 양의 정수가 저장된다. 20초 하한도 기본 시간도 없다 (1초·5초·3600초 모두 저장)', async () => {
    const world = setup();
    for (const hold of [null, 1, 5, 3600]) {
      const response = await save(world, putBody({}, hold));
      expect(response.status, String(hold)).toBe(200);
      expect((await json(response)).idlePolicy.completionHoldSeconds, String(hold)).toBe(hold);
      expect((await publicCatalog(world, CLINIC_1_SLUG)).body.idlePolicy.completionHoldSeconds, String(hold)).toBe(hold);
    }
    // 정책을 저장한 적 없는 병원 B 는 null(기본 시간을 만들어 쓰지 않는다).
    expect((await publicCatalog(world, CLINIC_2_SLUG)).body.idlePolicy.completionHoldSeconds).toBeNull();
  });

  it('병원은 경로가 정한다: 본문의 clinicId 는 읽지 않는다', async () => {
    const world = setup();
    const response = await save(world, { ...putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15), clinicId: CLINIC_B });
    expect(response.status).toBe(200);
    expect(world.repo.getIdlePolicy(CLINIC_A)).not.toBeNull();
    expect(world.repo.getIdlePolicy(CLINIC_B)).toBeNull();
  });

  it('성공한 저장은 감사 기록 IDLE_POLICY_SAVE 한 건(수행자·역할·대상·이전/이후 지문)을 남기고, 바뀌는 저장소 영역은 정책과 감사 기록뿐이다', async () => {
    const world = setup();
    const before = world.state();
    world.world.clock.set('2026-10-20T01:00:00.000Z');

    await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));
    await save(world, putBody({}, null));

    const entries = world.audit().filter((entry) => entry.action === 'IDLE_POLICY_SAVE');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ actorId: identityOf('ha-clinic-1').userId, role: 'HA', target: `CLINIC/${CLINIC_A}/IDLE_POLICY`, beforeVersion: null, reason: null, at: '2026-10-20T01:00:00.000Z' });
    expect(entries[1]?.beforeVersion).toBe(entries[0]?.afterVersion);
    expect(entries[1]?.afterVersion).not.toBe(entries[0]?.afterVersion);
    expect(changedKeys(before, world.state())).toEqual(['auditLog', 'idlePolicies']);
  });

  it('병원 A 의 저장은 병원 B 를 바꾸지 않는다: B 의 정책·공개 catalog 응답 글자가 전후로 같다', async () => {
    const world = setup();
    const catalogBefore = (await publicCatalog(world, CLINIC_2_SLUG)).text;
    const policyBefore = world.repo.getIdlePolicy(CLINIC_B);
    const bView = await json(await call(world.as('ha-clinic-2'), 'GET', path(CLINIC_B)));

    await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));

    expect(world.repo.getIdlePolicy(CLINIC_B)).toEqual(policyBefore);
    expect((await publicCatalog(world, CLINIC_2_SLUG)).text).toBe(catalogBefore);
    expect(await json(await call(world.as('ha-clinic-2'), 'GET', path(CLINIC_B)))).toEqual(bView);
    expect(bView.customizedScreens).toEqual([]);
    // 병원 A 의 정책은 병원 A 의 관리자에게만 열린다.
    expect((await call(world.as('ha-clinic-2'), 'GET', path(CLINIC_A))).status).toBe(403);
  });
});

describe('저장 거절(400): 어긋난 필드마다 { code, path }, 저장소·감사 기록은 그대로다', () => {
  const OK_INPUT = { warnSeconds: 90, resetSeconds: 110 };
  const cases: Array<[string, unknown, Array<{ code: string; path: string }>]> = [
    ['본문이 객체가 아님(배열)', [], [{ code: 'VALUE_INVALID', path: '' }]],
    ['본문이 null', null, [{ code: 'VALUE_INVALID', path: '' }]],
    ['빈 객체: screens 와 completionHoldSeconds 모두 빠짐', {}, [{ code: 'VALUE_MISSING', path: 'screens' }, { code: 'VALUE_MISSING', path: 'completionHoldSeconds' }]],
    ['screens 가 객체가 아님', { screens: 'x', completionHoldSeconds: null }, [{ code: 'VALUE_INVALID', path: 'screens' }]],
    ['completionHoldSeconds 키가 없음(생략은 null 이 아니다)', { screens: {} }, [{ code: 'VALUE_MISSING', path: 'completionHoldSeconds' }]],
    ['알 수 없는 화면 종류', putBody({ K00_Start: OK_INPUT }), [{ code: 'SCREEN_UNKNOWN', path: 'screens.K00_Start' }]],
    ['화면 종류 값이 객체가 아님', putBody({ INPUT: 5 as never }), [{ code: 'VALUE_INVALID', path: 'screens.INPUT' }]],
    ['초기화 시간이 없음', putBody({ INPUT: { warnSeconds: 90 } as never }), [{ code: 'VALUE_MISSING', path: 'screens.INPUT.resetSeconds' }]],
    ['경고 시간이 null', putBody({ INPUT: { warnSeconds: null, resetSeconds: 110 } }), [{ code: 'VALUE_MISSING', path: 'screens.INPUT.warnSeconds' }]],
    ['소수', putBody({ INPUT: { warnSeconds: 90.5, resetSeconds: 120 } }), [{ code: 'VALUE_INVALID', path: 'screens.INPUT.warnSeconds' }]],
    ['글자로 쓴 숫자', putBody({ INPUT: { warnSeconds: '90', resetSeconds: 120 } }), [{ code: 'VALUE_INVALID', path: 'screens.INPUT.warnSeconds' }]],
    ['음수', putBody({ INPUT: { warnSeconds: 90, resetSeconds: -1 } }), [{ code: 'VALUE_INVALID', path: 'screens.INPUT.resetSeconds' }]],
    ['안전 정수 밖의 값', putBody({ INPUT: { warnSeconds: 1e21, resetSeconds: 120 } }), [{ code: 'VALUE_INVALID', path: 'screens.INPUT.warnSeconds' }]],
    ['경고 = 초기화', putBody({ INPUT: { warnSeconds: 100, resetSeconds: 100 } }), [{ code: 'LEAD_TIME_TOO_SHORT', path: 'screens.INPUT.resetSeconds' }]],
    ['경고 > 초기화', putBody({ INPUT: { warnSeconds: 130, resetSeconds: 100 } }), [{ code: 'LEAD_TIME_TOO_SHORT', path: 'screens.INPUT.resetSeconds' }]],
    ['간격 19초', putBody({ RESULT: { warnSeconds: 100, resetSeconds: 119 } }), [{ code: 'LEAD_TIME_TOO_SHORT', path: 'screens.RESULT.resetSeconds' }]],
    ['completionHoldSeconds 0', putBody({}, 0), [{ code: 'VALUE_INVALID', path: 'completionHoldSeconds' }]],
    ['completionHoldSeconds 음수', putBody({}, -5), [{ code: 'VALUE_INVALID', path: 'completionHoldSeconds' }]],
    ['completionHoldSeconds 소수', putBody({}, 1.5), [{ code: 'VALUE_INVALID', path: 'completionHoldSeconds' }]],
    ['completionHoldSeconds 글자', putBody({}, '10'), [{ code: 'VALUE_INVALID', path: 'completionHoldSeconds' }]],
    ['completionHoldSeconds 참/거짓', putBody({}, true), [{ code: 'VALUE_INVALID', path: 'completionHoldSeconds' }]],
    [
      '여러 결함은 키를 쓴 순서와 무관하게 화면 종류 이름 순서, 그다음 completionHoldSeconds 순서로 모두 나온다',
      putBody({ RESULT: { warnSeconds: 100, resetSeconds: 110 }, INPUT: { warnSeconds: 'x', resetSeconds: 120 } }, 0),
      [
        { code: 'VALUE_INVALID', path: 'screens.INPUT.warnSeconds' },
        { code: 'LEAD_TIME_TOO_SHORT', path: 'screens.RESULT.resetSeconds' },
        { code: 'VALUE_INVALID', path: 'completionHoldSeconds' },
      ],
    ],
    ['한 종류가 틀리면 올바른 다른 종류도 저장되지 않는다', putBody({ INPUT: OK_INPUT, RESULT: { warnSeconds: 5, resetSeconds: 6 } }, 15), [{ code: 'LEAD_TIME_TOO_SHORT', path: 'screens.RESULT.resetSeconds' }]],
  ];

  it.each(cases)('%s', async (_label, body, defects) => {
    const world = setup();
    // 앞서 저장해 둔 정책이 거절로 지워지거나 바뀌지 않는지 보려고 저장된 상태에서 시작한다.
    await save(world, putBody({ INPUT: OK_INPUT }, 15));
    const before = world.state();

    const response = await save(world, body);

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects });
    expect(world.state()).toEqual(before);
    expect(world.audit().filter((entry) => entry.action === 'IDLE_POLICY_SAVE')).toHaveLength(1);
  });

  it('화면 종류 이름으로 쓴 __proto__·constructor·toString 은 알 수 없는 종류로 거절되고 객체 원형이 오염되지 않는다', async () => {
    const world = setup();
    const before = world.state();
    const digest = await digestOf(world);
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const response = await callRaw(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), `{"screens":{"${key}":{"warnSeconds":1,"resetSeconds":50}},"completionHoldSeconds":null,"expectedDigest":"${digest}"}`);
      expect(response.status, key).toBe(400);
      expect(await json(response), key).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'SCREEN_UNKNOWN', path: `screens.${key}` }] });
    }
    expect(({} as Json)['warnSeconds']).toBeUndefined();
    expect(world.state()).toEqual(before);
  });

  it('screens 가 배열이면 거절되고, 안전 정수의 경계(2^53-1)는 저장되며 그 위(2^53)는 거절된다', async () => {
    const world = setup();
    const array = await save(world, { screens: [], completionHoldSeconds: null });
    expect([array.status, await json(array)]).toEqual([400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_INVALID', path: 'screens' }] }]);
    const edge = await callRaw(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), `{"screens":{"INPUT":{"warnSeconds":0,"resetSeconds":9007199254740991}},"completionHoldSeconds":9007199254740991,"expectedDigest":"${await digestOf(world)}"}`);
    expect(edge.status).toBe(200);
    const before = world.state();
    const over = await callRaw(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), `{"screens":{"INPUT":{"warnSeconds":0,"resetSeconds":9007199254740992}},"completionHoldSeconds":null,"expectedDigest":"${await digestOf(world)}"}`);
    expect([over.status, await json(over)]).toEqual([400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_INVALID', path: 'screens.INPUT.resetSeconds' }] }]);
    expect(world.state()).toEqual(before);
  });

  it('JSON 이 아닌 본문은 400 NOT_JSON 이고 아무것도 바뀌지 않는다', async () => {
    const world = setup();
    const before = world.state();
    const response = await callRaw(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), '{not json');
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'NOT_JSON', path: 'request' }] });
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });
});

describe('설정 저장은 가격·보장 규칙·계산 결과·카탈로그 버전을 바꾸지 않는다 (AC-015i)', () => {
  async function publicSnapshot(world: Setup) {
    const catalogResponse = await publicCatalog(world, CLINIC_1_SLUG);
    const { idlePolicy: _idlePolicy, ...catalogWithoutPolicy } = catalogResponse.body;
    const options = await (await handleOptions(world.api, CLINIC_1_SLUG)).text();
    const ruleBundleVersion = (JSON.parse(options) as Json).ruleBundleVersion as string;
    const estimate = await (
      await handleEstimate(world.api, CLINIC_1_SLUG, () =>
        Promise.resolve({ catalogVersion: catalogResponse.body.catalogVersion, ruleBundleVersion, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [T1] }),
      )
    ).text();
    return { catalogWithoutPolicy, options, estimate };
  }

  it('저장 전후로 catalogVersion 과 치료·가격(idlePolicy 만 뺀 catalog 응답), 보험 선택지, 계산 응답의 글자가 같고, 바뀐 것은 idlePolicy 뿐이다', async () => {
    const world = setup();
    const before = await publicSnapshot(world);
    const policyBefore = (await publicCatalog(world, CLINIC_1_SLUG)).body.idlePolicy;
    const state = world.state();

    const saved = await save(world, putBody({ INPUT: { warnSeconds: 20, resetSeconds: 40 }, RESULT: { warnSeconds: 50, resetSeconds: 80 } }, 5));
    expect(saved.status).toBe(200);

    const after = await publicSnapshot(world);
    expect(after.catalogWithoutPolicy).toEqual(before.catalogWithoutPolicy);
    expect(after.options).toBe(before.options);
    expect(after.estimate).toBe(before.estimate);
    expect(JSON.parse(after.estimate).result.state).toBe('ESTIMATED');
    expect((await publicCatalog(world, CLINIC_1_SLUG)).body.idlePolicy).not.toEqual(policyBefore);
    // 치료·치료 버전·카탈로그·규칙 묶음·범위·병원 기록 같은 저장소 영역은 하나도 바뀌지 않았다.
    expect(changedKeys(state, world.state())).toEqual(['auditLog', 'idlePolicies']);
  });

  it('거절된 저장은 공개 응답도 바꾸지 않는다 (catalog 응답 글자가 전후로 같다)', async () => {
    const world = setup();
    await save(world, putBody({ INPUT: { warnSeconds: 20, resetSeconds: 40 } }, 5));
    const before = (await publicCatalog(world, CLINIC_1_SLUG)).text;
    await save(world, putBody({ INPUT: { warnSeconds: 100, resetSeconds: 101 } }, 5));
    await call(world.as('rv-1'), 'PUT', path(CLINIC_A), putBody({}, null));
    expect((await publicCatalog(world, CLINIC_1_SLUG)).text).toBe(before);
  });
});

describe('동시 저장 방어: 조건부 저장 (expectedDigest · 409 IDLE_POLICY_CHANGED)', () => {
  const A_SAVE = putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, null);
  const B_SAVE = putBody({ HOLD_RESULT: { warnSeconds: 170, resetSeconds: 200 } }, 12);
  const CONFLICT = { error: 'CONFLICT', reason: 'IDLE_POLICY_CHANGED' };
  const withDigest = (body: Json, expectedDigest: unknown): Json => ({ ...body, expectedDigest });
  const putExact = (world: Setup, body: unknown, who: Who = 'ha-clinic-1'): Promise<Response> => call(world.as(who), 'PUT', path(CLINIC_A), body);
  const saves = (world: Setup) => world.audit().filter((entry) => entry.action === 'IDLE_POLICY_SAVE');

  it('GET 은 policyDigest 를 알린다: 소문자 16진수 64글자, 읽기는 지문도 저장소도 바꾸지 않고 같은 상태면 늘 같은 지문이다', async () => {
    const world = setup();
    const before = world.state();
    const first = await digestOf(world);
    const second = await digestOf(world);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('저장 상태가 다르면 지문이 다르다: 저장한 적 없음 · 비어 있게 저장 · 기본값과 같은 값을 직접 저장 · 직접 설정한 종류 · 자동 복귀 값 · 다른 병원', async () => {
    const world = setup();
    const digests: Record<string, string> = {};
    digests['저장한 적 없음'] = await digestOf(world);
    const unsavedView = await json(await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A)));

    await save(world, putBody({}, null));
    digests['비어 있게 저장'] = await digestOf(world);
    // 화면이 보는 값(기본값으로 채운 정책)은 "저장한 적 없음"과 같아도 지문은 다르다: 지문은 읽기 결과가 아니라 저장된 상태에서 계산한다.
    const emptyView = await json(await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A)));
    expect(emptyView.idlePolicy).toEqual(unsavedView.idlePolicy);
    expect(emptyView.customizedScreens).toEqual(unsavedView.customizedScreens);

    await save(world, putBody({ INPUT: { ...DEFAULT_IDLE_THRESHOLDS.INPUT } }, null));
    digests['기본값과 같은 값을 직접 저장'] = await digestOf(world);
    expect((await json(await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A)))).customizedScreens).toEqual(['INPUT']);

    await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, null));
    digests['INPUT 을 직접 설정'] = await digestOf(world);
    await save(world, putBody({ RESULT: { warnSeconds: 90, resetSeconds: 110 } }, null));
    digests['같은 값을 RESULT 에 설정'] = await digestOf(world);
    await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 }, RESULT: { warnSeconds: 90, resetSeconds: 110 } }, null));
    digests['두 종류를 설정'] = await digestOf(world);
    await save(world, putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 }, RESULT: { warnSeconds: 90, resetSeconds: 110 } }, 15));
    digests['자동 복귀 값 추가'] = await digestOf(world);

    const values = Object.values(digests);
    expect(new Set(values).size, JSON.stringify(digests)).toBe(values.length);
    // 병원 id 도 지문에 들어간다: 둘 다 저장한 적 없는 병원 A 와 B 의 지문이 다르다.
    expect(await digestOf(world, 'ha-clinic-2', CLINIC_B)).not.toBe(digests['저장한 적 없음']);
  });

  it('같은 상태로 되돌아오면 지문도 같다: 변경 감지는 저장 사건이 아니라 저장 상태를 견준다 (알려진 성질)', async () => {
    const world = setup();
    await save(world, A_SAVE);
    const original = await digestOf(world);
    await save(world, B_SAVE);
    expect(await digestOf(world)).not.toBe(original);
    await save(world, A_SAVE);
    expect(await digestOf(world)).toBe(original);
    // 되돌아온 상태에서는 낡은 지문도 지금 상태와 같으므로 받아들여진다.
    expect((await putExact(world, withDigest(B_SAVE, original))).status).toBe(200);
  });

  it('수정 전 재현의 순서: 두 창이 같은 정책을 읽고 B 가 먼저 저장하면 A 의 낡은 저장은 409 이고 B 의 설정·감사 기록·저장소는 그대로다', async () => {
    const world = setup();
    const digestA = await digestOf(world);
    const digestB = await digestOf(world);
    expect(digestB).toBe(digestA);

    expect((await putExact(world, withDigest(B_SAVE, digestB))).status).toBe(200);
    const afterB = world.state();
    const viewAfterB = await json(await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A)));
    const savesAfterB = saves(world).length;

    const stale = await putExact(world, withDigest(A_SAVE, digestA));

    expect(stale.status).toBe(409);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect(await json(stale)).toEqual(CONFLICT);
    expect(world.state()).toEqual(afterB);
    expect(saves(world)).toHaveLength(savesAfterB);
    expect(await json(await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A)))).toEqual(viewAfterB);
    expect(viewAfterB.customizedScreens).toEqual(['HOLD_RESULT']);
    expect(viewAfterB.idlePolicy.completionHoldSeconds).toBe(12);
    expect(world.repo.getIdlePolicy(CLINIC_B)).toBeNull();
  });

  it('수정 전 재현의 둘째 순서: 화면의 저장 직전 재조회를 통과(지문이 같음)한 뒤 B 가 저장해도 A 의 저장은 409 이다. 사람이 새로 읽은 지문으로 다시 보내야 저장된다', async () => {
    const world = setup();
    const base = await digestOf(world); // A 화면이 열린 순간
    const precheck = await digestOf(world); // A 의 저장 직전 재조회: 아직 같다
    expect(precheck).toBe(base);
    expect((await putExact(world, withDigest(B_SAVE, await digestOf(world)))).status).toBe(200); // 재조회와 저장 사이의 틈에서 B 가 저장
    const afterB = world.state();

    const stale = await putExact(world, withDigest(A_SAVE, base));
    expect([stale.status, await json(stale)]).toEqual([409, CONFLICT]);
    expect(world.state()).toEqual(afterB);

    // 자동 재시도는 없다: 같은 낡은 지문을 다시 보내도 같은 거절이다.
    expect((await putExact(world, withDigest(A_SAVE, base))).status).toBe(409);
    expect(world.state()).toEqual(afterB);

    // 사람이 서버 값을 다시 읽고(새 지문) 정해서 보내면 그때 저장된다.
    const fresh = await digestOf(world);
    expect(fresh).not.toBe(base);
    const retried = await putExact(world, withDigest(A_SAVE, fresh));
    expect(retried.status).toBe(200);
    expect((await json(retried)).customizedScreens).toEqual(['INPUT']);
  });

  it('성공한 저장의 지문은 한 번만 쓸 수 있다: 같은 요청을 다시 보내면 409 이고 감사 기록은 한 건이다', async () => {
    const world = setup();
    const body = withDigest(A_SAVE, await digestOf(world));
    expect((await putExact(world, body)).status).toBe(200);
    const after = world.state();
    const replay = await putExact(world, body);
    expect([replay.status, await json(replay)]).toEqual([409, CONFLICT]);
    expect(world.state()).toEqual(after);
    expect(saves(world)).toHaveLength(1);
  });

  it('순서: 지문 비교가 값 검사보다 먼저다. 낡은 지문과 틀린 값이 함께 오면 409 이고, 현재 지문과 틀린 값이면 400 이다. 둘 다 저장소·감사 기록을 바꾸지 않는다', async () => {
    const world = setup();
    const old = await digestOf(world);
    await save(world, B_SAVE);
    const before = world.state();
    const invalid = putBody({ INPUT: { warnSeconds: 100, resetSeconds: 101 } }, 0);

    const stale = await putExact(world, withDigest(invalid, old));
    expect([stale.status, await json(stale)]).toEqual([409, CONFLICT]);

    const current = await putExact(world, withDigest(invalid, await digestOf(world)));
    expect(current.status).toBe(400);
    expect(await json(current)).toEqual({
      error: 'INVALID_REQUEST',
      defects: [
        { code: 'LEAD_TIME_TOO_SHORT', path: 'screens.INPUT.resetSeconds' },
        { code: 'VALUE_INVALID', path: 'completionHoldSeconds' },
      ],
    });
    expect(world.state()).toEqual(before);
    expect(saves(world)).toHaveLength(1);
  });

  describe('지문 누락·형식 오류는 400 이고 아무것도 바뀌지 않는다', () => {
    const digest = '0123456789abcdef'.repeat(4);
    const cases: Array<[string, unknown, 'VALUE_MISSING' | 'VALUE_INVALID']> = [
      ['null', null, 'VALUE_MISSING'],
      ['숫자', 5, 'VALUE_INVALID'],
      ['빈 글자', '', 'VALUE_INVALID'],
      ['너무 짧은 16진수', 'abc123', 'VALUE_INVALID'],
      ['65글자', `${digest}0`, 'VALUE_INVALID'],
      ['대문자 16진수', digest.toUpperCase(), 'VALUE_INVALID'],
      ['앞뒤 공백', ` ${digest} `, 'VALUE_INVALID'],
      ['64글자지만 16진수가 아님', 'g'.repeat(64), 'VALUE_INVALID'],
      ['배열', [digest], 'VALUE_INVALID'],
      ['객체', { digest }, 'VALUE_INVALID'],
    ];

    it('expectedDigest 키가 없으면 VALUE_MISSING (경로 expectedDigest)', async () => {
      const world = setup();
      await save(world, B_SAVE);
      const before = world.state();
      const response = await putExact(world, A_SAVE);
      expect([response.status, await json(response)]).toEqual([400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_MISSING', path: 'expectedDigest' }] }]);
      expect(world.state()).toEqual(before);
      expect(saves(world)).toHaveLength(1);
    });

    it.each(cases)('%s', async (_label, value, code) => {
      const world = setup();
      await save(world, B_SAVE);
      const before = world.state();
      const response = await putExact(world, withDigest(A_SAVE, value));
      expect([response.status, await json(response)]).toEqual([400, { error: 'INVALID_REQUEST', defects: [{ code, path: 'expectedDigest' }] }]);
      expect(world.state()).toEqual(before);
      expect(saves(world)).toHaveLength(1);
    });

    it('지문이 없고 값도 틀리면 값의 결함이 먼저, 지문의 결함이 마지막에 모두 나온다 (형식이 틀린 지문은 비교하지 않는다)', async () => {
      const world = setup();
      const before = world.state();
      const response = await putExact(world, putBody({ INPUT: { warnSeconds: 100, resetSeconds: 101 } }, 0));
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({
        error: 'INVALID_REQUEST',
        defects: [
          { code: 'LEAD_TIME_TOO_SHORT', path: 'screens.INPUT.resetSeconds' },
          { code: 'VALUE_INVALID', path: 'completionHoldSeconds' },
          { code: 'VALUE_MISSING', path: 'expectedDigest' },
        ],
      });
      expect(world.state()).toEqual(before);
    });
  });

  it('다른 병원의 지문은 맞지 않는다: 병원 id 가 지문에 들어 있어 병원 B 의 지문으로는 병원 A 에 저장할 수 없다', async () => {
    const world = setup();
    const digestOfB = await digestOf(world, 'ha-clinic-2', CLINIC_B);
    const before = world.state();
    const response = await putExact(world, withDigest(A_SAVE, digestOfB));
    expect([response.status, await json(response)]).toEqual([409, CONFLICT]);
    expect(world.state()).toEqual(before);
    expect(world.repo.getIdlePolicy(CLINIC_A)).toBeNull();
  });

  it('성공한 저장: 감사 기록 한 건, 응답의 policyDigest 는 이어서 읽은 GET 과 같고 저장 전 지문과 다르다. 병원 B 의 정책과 지문은 그대로다', async () => {
    const world = setup();
    const digestBBefore = await digestOf(world, 'ha-clinic-2', CLINIC_B);
    const before = await digestOf(world);
    const state = world.state();

    const response = await putExact(world, withDigest(A_SAVE, before));

    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.policyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.policyDigest).not.toBe(before);
    expect(body.policyDigest).toBe(await digestOf(world));
    expect(saves(world)).toHaveLength(1);
    expect(changedKeys(state, world.state())).toEqual(['auditLog', 'idlePolicies']);
    expect(world.repo.getIdlePolicy(CLINIC_B)).toBeNull();
    expect(await digestOf(world, 'ha-clinic-2', CLINIC_B)).toBe(digestBBefore);
  });

  it('접근 판정의 순서는 그대로다: 지문이 낡았거나 틀려도 인증 없음 401 · 권한 없음 403 · 병원 기록 없음 404 가 먼저다', async () => {
    const world = setup();
    const before = world.state();
    const garbage = withDigest(A_SAVE, 'not-a-digest');
    const stale = withDigest(A_SAVE, '0'.repeat(64));
    expect((await call(world.as(null), 'PUT', path(CLINIC_A), stale)).status).toBe(401);
    expect((await call(world.as('ha-clinic-2'), 'PUT', path(CLINIC_A), stale)).status).toBe(403);
    expect((await call(world.as('rv-1'), 'PUT', path(CLINIC_A), garbage)).status).toBe(403);
    expect((await call(world.as(GHOST_HA), 'PUT', path('TEST_FIXTURE_CLINIC_GHOST'), stale)).status).toBe(404);
    expect((await call(world.as(GHOST_HA), 'PUT', path('TEST_FIXTURE_CLINIC_GHOST'), garbage)).status).toBe(404);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });
});
