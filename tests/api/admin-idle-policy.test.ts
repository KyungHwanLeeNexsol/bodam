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
//   HA  GET /api/admin/clinics/{clinicId}/idle-policy     — 읽기 { clinic, idlePolicy, customizedScreens, defaults, minLeadSeconds }
//   HA  PUT /api/admin/clinics/{clinicId}/idle-policy     — 저장(전체 교체). 본문 { screens(일부 가능), completionHoldSeconds: 양의 정수 | null }
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
    expect(Object.keys(body).sort()).toEqual(['clinic', 'customizedScreens', 'defaults', 'idlePolicy', 'minLeadSeconds']);
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

    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));
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
    const response = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));

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
    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 }, RESULT: { warnSeconds: 30, resetSeconds: 60 } }, 20));

    const second = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ RESULT: { warnSeconds: 40, resetSeconds: 70 } }, null));

    expect(second.status).toBe(200);
    const body = await json(second);
    expect(body.customizedScreens).toEqual(['RESULT']);
    expect(body.idlePolicy.screens.RESULT).toEqual({ warnSeconds: 40, resetSeconds: 70 });
    expect(body.idlePolicy.screens.INPUT).toEqual(DEFAULT_IDLE_THRESHOLDS.INPUT);
    expect(body.idlePolicy.completionHoldSeconds).toBeNull();
  });

  it('screens 가 빈 객체이면 모든 종류가 기본값으로 돌아간다 (직접 저장한 종류 없음)', async () => {
    const world = setup();
    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));
    const response = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({}, null));
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
    const body = await json(await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody(screens, 7)));
    expect(body.customizedScreens).toEqual([...IDLE_SCREEN_KINDS]);
    IDLE_SCREEN_KINDS.forEach((kind, index) => expect(body.idlePolicy.screens[kind]).toEqual({ warnSeconds: 30 + index, resetSeconds: 60 + index }));
  });

  it('간격 하한은 20초 이상이다: 정확히 20초는 저장되고(경고 0 포함) 19초는 거절된다', async () => {
    const world = setup();
    expect((await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 100, resetSeconds: 120 } }))).status).toBe(200);
    expect((await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 0, resetSeconds: 20 } }))).status).toBe(200);
    const before = world.state();
    const tooShort = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 100, resetSeconds: 119 } }));
    expect(tooShort.status).toBe(400);
    expect(world.state()).toEqual(before);
  });

  it('completionHoldSeconds: null(자동 복귀 없음)과 양의 정수가 저장된다. 20초 하한도 기본 시간도 없다 (1초·5초·3600초 모두 저장)', async () => {
    const world = setup();
    for (const hold of [null, 1, 5, 3600]) {
      const response = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({}, hold));
      expect(response.status, String(hold)).toBe(200);
      expect((await json(response)).idlePolicy.completionHoldSeconds, String(hold)).toBe(hold);
      expect((await publicCatalog(world, CLINIC_1_SLUG)).body.idlePolicy.completionHoldSeconds, String(hold)).toBe(hold);
    }
    // 정책을 저장한 적 없는 병원 B 는 null(기본 시간을 만들어 쓰지 않는다).
    expect((await publicCatalog(world, CLINIC_2_SLUG)).body.idlePolicy.completionHoldSeconds).toBeNull();
  });

  it('병원은 경로가 정한다: 본문의 clinicId 는 읽지 않는다', async () => {
    const world = setup();
    const response = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), { ...putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15), clinicId: CLINIC_B });
    expect(response.status).toBe(200);
    expect(world.repo.getIdlePolicy(CLINIC_A)).not.toBeNull();
    expect(world.repo.getIdlePolicy(CLINIC_B)).toBeNull();
  });

  it('성공한 저장은 감사 기록 IDLE_POLICY_SAVE 한 건(수행자·역할·대상·이전/이후 지문)을 남기고, 바뀌는 저장소 영역은 정책과 감사 기록뿐이다', async () => {
    const world = setup();
    const before = world.state();
    world.world.clock.set('2026-10-20T01:00:00.000Z');

    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));
    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({}, null));

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

    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 90, resetSeconds: 110 } }, 15));

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
    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: OK_INPUT }, 15));
    const before = world.state();

    const response = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), body);

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects });
    expect(world.state()).toEqual(before);
    expect(world.audit().filter((entry) => entry.action === 'IDLE_POLICY_SAVE')).toHaveLength(1);
  });

  it('화면 종류 이름으로 쓴 __proto__·constructor·toString 은 알 수 없는 종류로 거절되고 객체 원형이 오염되지 않는다', async () => {
    const world = setup();
    const before = world.state();
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const response = await callRaw(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), `{"screens":{"${key}":{"warnSeconds":1,"resetSeconds":50}},"completionHoldSeconds":null}`);
      expect(response.status, key).toBe(400);
      expect(await json(response), key).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'SCREEN_UNKNOWN', path: `screens.${key}` }] });
    }
    expect(({} as Json)['warnSeconds']).toBeUndefined();
    expect(world.state()).toEqual(before);
  });

  it('screens 가 배열이면 거절되고, 안전 정수의 경계(2^53-1)는 저장되며 그 위(2^53)는 거절된다', async () => {
    const world = setup();
    const array = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), { screens: [], completionHoldSeconds: null });
    expect([array.status, await json(array)]).toEqual([400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_INVALID', path: 'screens' }] }]);
    const edge = await callRaw(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), '{"screens":{"INPUT":{"warnSeconds":0,"resetSeconds":9007199254740991}},"completionHoldSeconds":9007199254740991}');
    expect(edge.status).toBe(200);
    const before = world.state();
    const over = await callRaw(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), '{"screens":{"INPUT":{"warnSeconds":0,"resetSeconds":9007199254740992}},"completionHoldSeconds":null}');
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

    const saved = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 20, resetSeconds: 40 }, RESULT: { warnSeconds: 50, resetSeconds: 80 } }, 5));
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
    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 20, resetSeconds: 40 } }, 5));
    const before = (await publicCatalog(world, CLINIC_1_SLUG)).text;
    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), putBody({ INPUT: { warnSeconds: 100, resetSeconds: 101 } }, 5));
    await call(world.as('rv-1'), 'PUT', path(CLINIC_A), putBody({}, null));
    expect((await publicCatalog(world, CLINIC_1_SLUG)).text).toBe(before);
  });
});
