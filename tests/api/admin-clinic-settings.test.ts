import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import type { AdminIdentity } from '../../src/server/admin/auth';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { handleOptions } from '../../src/server/api/options';
import { CHANGE_HISTORY_ACTIONS } from '../../src/server/change-history';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG } from '../fixtures/server/api-composition.fixture';
import { T1 } from '../fixtures/server/base-fee.fixture';
import { composeWorld } from '../fixtures/server/bundle-compose.fixture';
import { changedKeys } from '../fixtures/server/catalog-structure.fixture';
import { OTHER_CLINIC_ID } from '../fixtures/server/versioning.fixture';

// 병원 기본 정보(병원명·상담번호) 설정 (M7 병원 설정, DD-17 권한 표 · AC-022a · AC-023e). 모두 handleAdmin(실제 관리자 핸들러)과 공개 핸들러를 지난다.
//   HA  GET /api/admin/clinics/{clinicId}/settings   — 읽기 { clinic, serviceDisplayName, settings: { name, contact }, catalogVersion, settingsDigest }
//   HA  PUT /api/admin/clinics/{clinicId}/settings   — 조건부 저장. 본문 { name, contact, expectedDigest: GET 의 settingsDigest }. 지문이 다르면 409 CLINIC_SETTINGS_CHANGED(병원·감사 기록 그대로)
// 세계: 병원 A(=병원 1, 규칙 묶음·카탈로그 있음)·병원 B(=병원 2). 시험 세계의 상담번호 'TEST_FIXTURE_CONTACT' 는 전화번호 형식이 아니라, 저장하는 시험은 올바른 상담번호를 함께 보낸다.
// 경로 → 소속·역할(403) → 병원(404) → 본문(400) 순서이고, 거절은 병원 기록도 감사 기록도 바꾸지 않는다(저장소 전체 사본으로 비교한다).

const BASE = 'http://localhost/api/admin';
const CLINIC_A = TEST_FIXTURE_CLINIC_ID;
const CLINIC_B = OTHER_CLINIC_ID;
const VALID_CONTACT = '02-123-4567';
const path = (clinicId: string): string => `clinics/${encodeURIComponent(clinicId)}/settings`;

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

/** 병원의 설정 보기(GET). */
const viewOf = async (world: Setup, clinicId: string = CLINIC_A, who: Who = 'ha-clinic-1'): Promise<Json> => json(await call(world.as(who), 'GET', path(clinicId)));
const digestOf = async (world: Setup, clinicId: string = CLINIC_A, who: Who = 'ha-clinic-1'): Promise<string> => (await viewOf(world, clinicId, who)).settingsDigest as string;

/**
 * 병원 A 에 HA 가 저장한다: 보내기 직전에 현재 지문을 읽어 expectedDigest 로 담는다(본문에 이미 expectedDigest 가 있으면 그대로 둔다; 객체가 아닌 본문은 그대로 보낸다).
 * 값 검사·감사 기록·병원 분리를 보는 시험이 쓴다. 동시 저장 방어(지문이 낡은 경우)를 보는 시험은 이 도우미를 쓰지 않고 지문을 직접 정해 보낸다.
 */
async function save(world: Setup, body: unknown, who: Who = 'ha-clinic-1'): Promise<Response> {
  const payload = typeof body === 'object' && body !== null && !Array.isArray(body) && !('expectedDigest' in body) ? { ...body, expectedDigest: await digestOf(world, CLINIC_A, who) } : body;
  return call(world.as(who), 'PUT', path(CLINIC_A), payload);
}

const valid = (overrides: Record<string, unknown> = {}) => ({ name: '새 병원 이름', contact: VALID_CONTACT, ...overrides });

async function publicCatalog(world: Setup, slug: string): Promise<{ text: string; body: Json }> {
  const response = await handleCatalog(world.api, slug);
  const text = await response.text();
  return { text, body: JSON.parse(text) as Json };
}

describe('읽기: GET /clinics/{id}/settings', () => {
  it('바꿀 수 있는 병원명·상담번호, 읽기 전용 표시(병원 id·slug·종별·현재 카탈로그 버전·서비스 표시명 "보담"), 지문을 낸다. 읽기는 저장소를 바꾸지 않는다', async () => {
    const world = setup();
    const before = world.state();

    const response = await call(world.as('ha-clinic-1'), 'GET', path(CLINIC_A));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['catalogVersion', 'clinic', 'serviceDisplayName', 'settings', 'settingsDigest']);
    const clinic = world.repo.getClinic(CLINIC_A)!;
    expect(body.clinic).toEqual({ id: CLINIC_A, slug: CLINIC_1_SLUG, institutionType: 'CLINIC' });
    expect(body.settings).toEqual({ name: clinic.name, contact: clinic.contact });
    expect(body.catalogVersion).toBe(clinic.currentCatalogVersionId);
    expect(body.catalogVersion).not.toBeNull();
    expect(body.serviceDisplayName).toBe('보담');
    expect(body.settingsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('서비스 표시명은 병원명과 별도이고 공개 catalog 응답의 값과 같다. 같은 상태면 지문도 늘 같다', async () => {
    const world = setup();
    const view = await viewOf(world);
    const catalog = (await publicCatalog(world, CLINIC_1_SLUG)).body;
    expect(view.serviceDisplayName).toBe(catalog.serviceDisplayName);
    expect(view.serviceDisplayName).not.toBe(view.settings.name);
    expect(await digestOf(world)).toBe(view.settingsDigest);
  });

  it('병원 B 의 HA 는 자기 병원의 값을 본다 (병원마다 따로)', async () => {
    const world = setup();
    const b = await viewOf(world, CLINIC_B, 'ha-clinic-2');
    expect(b.clinic.id).toBe(CLINIC_B);
    expect(b.settings.name).toBe(world.repo.getClinic(CLINIC_B)!.name);
    expect(b.settingsDigest).not.toBe(await digestOf(world));
  });
});

describe('접근 판정: 인증 없음은 401, 다른 병원·RV·PO·병원에 매인 RV·플랫폼 HA 는 403, 거절은 저장소도 감사 기록도 바꾸지 않는다', () => {
  const VALID = { ...valid(), expectedDigest: 'a'.repeat(64) };

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
        const response = await call(world.as(who), method, path(CLINIC_A), method === 'PUT' ? { ...VALID, expectedDigest: await digestOf(world) } : undefined);
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

  it('다른 병원의 HA 는 자기 병원 값으로 병원 A 를 바꿀 수 없다: 본문에 병원 id 를 적어도, 병원 B 의 지문을 써도 403 이다', async () => {
    const world = setup();
    const before = world.state();
    const forged = await call(world.as('ha-clinic-2'), 'PUT', path(CLINIC_A), { ...valid(), clinicId: CLINIC_B, expectedDigest: await digestOf(world, CLINIC_B, 'ha-clinic-2') });
    expect(forged.status).toBe(403);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('요청의 헤더·쿼리·본문에 적은 역할·병원은 권한이 되지 않는다 (위조 시도는 401)', async () => {
    const world = setup();
    const before = world.state();
    const forged = await call(world.as(null), 'PUT', `${path(CLINIC_A)}?clinicId=${CLINIC_A}&role=HA`, VALID, { headers: { 'content-type': 'application/json', 'x-role': 'HA', 'x-clinic-id': CLINIC_A, cookie: 'role=HA' } });
    expect(forged.status).toBe(401);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('인증된 다른 병원 관리자가 헤더·쿼리로 병원 1 을 가장해도 403 이다 (신원은 인증기가 검증한 소속에서만 온다)', async () => {
    const world = setup();
    const before = world.state();
    const headers = { 'content-type': 'application/json', 'x-clinic-id': CLINIC_A, 'x-role': 'HA', cookie: 'role=HA; clinic=' + CLINIC_A };
    for (const method of ['GET', 'PUT'] as const) {
      const request = new Request(`${BASE}/${path(CLINIC_A)}?clinicId=${CLINIC_A}&role=HA`, { method, headers, ...(method === 'PUT' ? { body: JSON.stringify(VALID) } : {}) });
      const response = await handleAdmin(world.as('ha-clinic-2'), request, segmentsOf(path(CLINIC_A)));
      expect(response.status, method).toBe(403);
    }
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('판정 순서: 본문이 잘못돼도(JSON 아님·검사 위반) 권한이 없으면 400 이 아니라 403, 소속은 있는데 병원 기록이 없으면 404 가 먼저다', async () => {
    const world = setup();
    const before = world.state();
    const invalid = { name: '', contact: 'abc', expectedDigest: 'x' };
    expect((await call(world.as('ha-clinic-2'), 'PUT', path(CLINIC_A), invalid)).status).toBe(403);
    expect((await callRaw(world.as('ha-clinic-2'), 'PUT', path(CLINIC_A), '{not json')).status).toBe(403);
    expect((await call(world.as('rv-1'), 'PUT', path(CLINIC_A), invalid)).status).toBe(403);
    expect((await call(world.as('po-1'), 'PUT', path(CLINIC_A), invalid)).status).toBe(403);
    expect((await call(world.as(null), 'PUT', path(CLINIC_A), invalid)).status).toBe(401);
    expect((await call(world.as(GHOST_HA), 'PUT', path('TEST_FIXTURE_CLINIC_GHOST'), invalid)).status).toBe(404);
    expect((await callRaw(world.as(GHOST_HA), 'PUT', path('TEST_FIXTURE_CLINIC_GHOST'), '{not json')).status).toBe(404);
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });

  it('정해진 두 메서드 밖은 405 이고 아무것도 바뀌지 않는다', async () => {
    const world = setup();
    const before = world.state();
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const response = await call(world.as('ha-clinic-1'), method, path(CLINIC_A), method === 'DELETE' ? undefined : valid());
      expect(response.status).toBe(405);
    }
    expect(world.state()).toEqual(before);
  });
});

describe('저장: 병원 A 의 병원명·상담번호만 바뀐다', () => {
  it('저장하면 앞뒤 공백을 뗀 값이 저장되고 응답은 저장소에서 다시 읽은 값이며 이어서 읽은 GET 과 같다', async () => {
    const world = setup();
    const response = await save(world, valid({ name: '  새 병원 이름  ', contact: ' 02-123-4567 ' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(body.settings).toEqual({ name: '새 병원 이름', contact: VALID_CONTACT });
    expect(body).toEqual(await viewOf(world));
    expect(world.repo.getClinic(CLINIC_A)).toMatchObject({ name: '새 병원 이름', contact: VALID_CONTACT });
  });

  it('성공한 저장은 감사 기록 CLINIC_SETTINGS_SAVE 한 건을 남기고, 바뀌는 저장소 영역은 병원 기록과 감사 기록뿐이다', async () => {
    const world = setup();
    const state = world.state();
    const clinicBefore = world.repo.getClinic(CLINIC_A)!;
    expect((await save(world, valid())).status).toBe(200);
    const entries = world.audit();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ role: 'HA', action: 'CLINIC_SETTINGS_SAVE', target: `CLINIC/${CLINIC_A}/SETTINGS`, reason: null });
    expect(entries[0]!.actorId).toBe(identityOf('ha-clinic-1').userId);
    expect(entries[0]!.beforeVersion).not.toBe(entries[0]!.afterVersion);
    expect(changedKeys(state, world.state())).toEqual(['auditLog', 'clinics']);
    // 병원 기록에서도 바뀐 것은 병원명·상담번호뿐이다: id·slug·종별·현재 카탈로그 버전은 그대로다.
    expect(world.repo.getClinic(CLINIC_A)).toEqual({ ...clinicBefore, name: '새 병원 이름', contact: VALID_CONTACT });
  });

  it('병원 A 의 저장은 병원 B 를 바꾸지 않는다: B 의 병원 기록·설정 보기·공개 catalog 응답 글자가 전후로 같다', async () => {
    const world = setup();
    const bBefore = { clinic: world.repo.getClinic(CLINIC_B), view: await viewOf(world, CLINIC_B, 'ha-clinic-2'), publicText: (await publicCatalog(world, CLINIC_2_SLUG)).text };
    expect((await save(world, valid())).status).toBe(200);
    expect(world.repo.getClinic(CLINIC_B)).toEqual(bBefore.clinic);
    expect(await viewOf(world, CLINIC_B, 'ha-clinic-2')).toEqual(bBefore.view);
    expect((await publicCatalog(world, CLINIC_2_SLUG)).text).toBe(bBefore.publicText);
  });

  it('병원 B 의 HA 가 자기 병원을 저장해도 병원 A 는 그대로다', async () => {
    const world = setup();
    const aBefore = world.repo.getClinic(CLINIC_A);
    const digest = await digestOf(world, CLINIC_B, 'ha-clinic-2');
    const response = await call(world.as('ha-clinic-2'), 'PUT', path(CLINIC_B), { name: '병원 B 새 이름', contact: '032-999-8888', expectedDigest: digest });
    expect(response.status).toBe(200);
    expect(world.repo.getClinic(CLINIC_B)).toMatchObject({ name: '병원 B 새 이름', contact: '032-999-8888' });
    expect(world.repo.getClinic(CLINIC_A)).toEqual(aBefore);
  });

  it('병원은 경로가 정한다: 본문의 clinicId 는 400 FIELD_NOT_EDITABLE 로 거절되고 어느 병원도 바뀌지 않는다', async () => {
    const world = setup();
    const before = world.state();
    const response = await save(world, valid({ clinicId: CLINIC_B }));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'FIELD_NOT_EDITABLE', path: 'clinicId' }] });
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
  });
});

describe('키오스크 반영: 공개 catalog 응답은 병원명만 새 값이고 나머지는 그대로다 (AC-023e)', () => {
  async function publicSnapshot(world: Setup) {
    const catalogResponse = await publicCatalog(world, CLINIC_1_SLUG);
    const options = await (await handleOptions(world.api, CLINIC_1_SLUG)).text();
    const ruleBundleVersion = (JSON.parse(options) as Json).ruleBundleVersion as string;
    const estimate = await (
      await handleEstimate(world.api, CLINIC_1_SLUG, () =>
        Promise.resolve({ catalogVersion: catalogResponse.body.catalogVersion, ruleBundleVersion, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [T1] }),
      )
    ).text();
    return { catalog: catalogResponse, options, estimate };
  }

  it('저장 뒤 새로 읽은 catalog 응답의 clinic.displayName 은 새 병원명이고 serviceDisplayName 은 여전히 "보담"이며, 키 구성과 나머지 값은 전후로 같다', async () => {
    const world = setup();
    const before = await publicSnapshot(world);
    expect((await save(world, valid({ name: '새 병원 이름' }))).status).toBe(200);
    const after = await publicSnapshot(world);

    expect(after.catalog.body.clinic.displayName).toBe('새 병원 이름');
    expect(before.catalog.body.clinic.displayName).not.toBe('새 병원 이름');
    expect(after.catalog.body.serviceDisplayName).toBe('보담');
    expect(Object.keys(after.catalog.body)).toEqual(Object.keys(before.catalog.body));
    expect(Object.keys(after.catalog.body.clinic)).toEqual(['slug', 'displayName', 'setting']);
    const { clinic: clinicBefore, ...restBefore } = before.catalog.body;
    const { clinic: clinicAfter, ...restAfter } = after.catalog.body;
    expect(restAfter).toEqual(restBefore); // 치료·기본비용·카탈로그 버전·무조작 정책 모두
    expect({ ...clinicAfter, displayName: null }).toEqual({ ...clinicBefore, displayName: null });
    expect(after.options).toBe(before.options);
    expect(after.estimate).toBe(before.estimate);
    expect(JSON.parse(after.estimate).result.state).toBe('ESTIMATED');
  });

  it('상담번호는 공개 응답 어디에도 없다 (이번에는 관리자 화면에서만 다룬다)', async () => {
    const world = setup();
    expect((await save(world, valid({ contact: '1588-7777' }))).status).toBe(200);
    for (const text of [(await publicCatalog(world, CLINIC_1_SLUG)).text, await (await handleOptions(world.api, CLINIC_1_SLUG)).text()]) {
      expect(text).not.toContain('1588-7777');
      expect(text).not.toContain('contact');
    }
  });

  it('설정 저장은 치료·기본비용·규칙 묶음·범위·무조작 정책·카탈로그 기록을 바꾸지 않는다 (바뀐 저장소 영역은 병원 기록과 감사 기록뿐)', async () => {
    const world = setup();
    const state = world.state();
    expect((await save(world, valid())).status).toBe(200);
    expect(changedKeys(state, world.state())).toEqual(['auditLog', 'clinics']);
  });

  it('거절된 저장은 공개 응답도 바꾸지 않는다 (catalog 응답 글자가 전후로 같다)', async () => {
    const world = setup();
    await save(world, valid());
    const before = (await publicCatalog(world, CLINIC_1_SLUG)).text;
    await save(world, valid({ name: '   ' }));
    await call(world.as('rv-1'), 'PUT', path(CLINIC_A), { ...valid(), expectedDigest: await digestOf(world) });
    await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), { ...valid({ name: '낡은 지문' }), expectedDigest: 'b'.repeat(64) });
    expect((await publicCatalog(world, CLINIC_1_SLUG)).text).toBe(before);
  });
});

describe('저장 거절(400): 어긋난 필드마다 { code, path }, 저장소·감사 기록은 그대로다', () => {
  const cases: Array<[string, unknown, Array<{ code: string; path: string }>]> = [
    ['본문이 객체가 아님(배열)', [], [{ code: 'VALUE_INVALID', path: '' }]],
    ['본문이 null', null, [{ code: 'VALUE_INVALID', path: '' }]],
    ['병원명이 비어 있음', valid({ name: '' }), [{ code: 'VALUE_INVALID', path: 'name' }]],
    ['병원명이 공백뿐', valid({ name: '   ' }), [{ code: 'VALUE_INVALID', path: 'name' }]],
    ['병원명이 41자', valid({ name: '가'.repeat(41) }), [{ code: 'VALUE_INVALID', path: 'name' }]],
    ['병원명에 제어 문자', valid({ name: '병\n원' }), [{ code: 'VALUE_INVALID', path: 'name' }]],
    ['병원명이 글자가 아님', valid({ name: 123 }), [{ code: 'VALUE_INVALID', path: 'name' }]],
    ['병원명이 없음', { contact: VALID_CONTACT }, [{ code: 'VALUE_MISSING', path: 'name' }]],
    ['상담번호가 비어 있음', valid({ contact: '' }), [{ code: 'VALUE_INVALID', path: 'contact' }]],
    ['상담번호에 글자', valid({ contact: '02-abc-4567' }), [{ code: 'VALUE_INVALID', path: 'contact' }]],
    ['상담번호의 숫자가 3개', valid({ contact: '12-3' }), [{ code: 'VALUE_INVALID', path: 'contact' }]],
    ['상담번호가 21자', valid({ contact: '1'.repeat(21) }), [{ code: 'VALUE_INVALID', path: 'contact' }]],
    ['상담번호가 없음', { name: '새 병원' }, [{ code: 'VALUE_MISSING', path: 'contact' }]],
    ['빈 객체(지문은 도우미가 현재 값을 채운다)', {}, [{ code: 'VALUE_MISSING', path: 'name' }, { code: 'VALUE_MISSING', path: 'contact' }]],
    ['지문의 형식이 틀림', { ...valid(), expectedDigest: 'abc' }, [{ code: 'VALUE_INVALID', path: 'expectedDigest' }]],
    ['병원 id 를 적음', valid({ id: CLINIC_B }), [{ code: 'FIELD_NOT_EDITABLE', path: 'id' }]],
    ['slug 를 적음', valid({ slug: 'hacked' }), [{ code: 'FIELD_NOT_EDITABLE', path: 'slug' }]],
    ['종별을 적음', valid({ institutionType: 'HOSPITAL' }), [{ code: 'FIELD_NOT_EDITABLE', path: 'institutionType' }]],
    ['현재 카탈로그 버전을 적음', valid({ currentCatalogVersionId: 'OLD' }), [{ code: 'FIELD_NOT_EDITABLE', path: 'currentCatalogVersionId' }]],
    ['서비스 표시명을 적음', valid({ serviceDisplayName: '다른 이름' }), [{ code: 'FIELD_NOT_EDITABLE', path: 'serviceDisplayName' }]],
    ['알 수 없는 키', valid({ logo: 'x' }), [{ code: 'KEY_UNKNOWN', path: 'logo' }]],
    [
      '여러 결함은 병원명 → 상담번호 → 받지 않는 키(코드 포인트 순)로 모두 나온다',
      { zzz: 1, slug: 'x', contact: 'abc', name: '' },
      [
        { code: 'VALUE_INVALID', path: 'name' },
        { code: 'VALUE_INVALID', path: 'contact' },
        { code: 'FIELD_NOT_EDITABLE', path: 'slug' },
        { code: 'KEY_UNKNOWN', path: 'zzz' },
      ],
    ],
  ];

  for (const [label, body, defects] of cases) {
    it(label, async () => {
      const world = setup();
      const before = world.state();
      // save 도우미가 현재 지문을 담아 보낸다(지문이 이미 있거나 객체가 아닌 본문은 그대로).
      const response = await save(world, body);
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects });
      expect(world.state()).toEqual(before);
      expect(world.audit()).toEqual([]);
    });
  }

  it('지문 키가 없으면 400 VALUE_MISSING(경로 expectedDigest)이다: 병원명·상담번호가 올바라도 저장하지 않는다', async () => {
    const world = setup();
    const before = world.state();
    const response = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), valid());
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_MISSING', path: 'expectedDigest' }] });
    expect(world.state()).toEqual(before);
    expect(world.audit()).toEqual([]);
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

describe('동시 저장 방어: 두 창 (409 CLINIC_SETTINGS_CHANGED)', () => {
  const CONFLICT = { error: 'CONFLICT', reason: 'CLINIC_SETTINGS_CHANGED' };
  const putExact = (world: Setup, body: unknown, who: Who = 'ha-clinic-1'): Promise<Response> => call(world.as(who), 'PUT', path(CLINIC_A), body);
  const saves = (world: Setup) => world.audit().filter((entry) => entry.action === 'CLINIC_SETTINGS_SAVE');

  it('두 창이 같은 설정을 읽고 창 1 이 먼저 저장하면 창 2 의 낡은 저장은 409 이고 창 1 의 값·감사 기록·저장소는 그대로다. 자동 재시도·덮어쓰기는 없다', async () => {
    const world = setup();
    const digest1 = await digestOf(world);
    const digest2 = await digestOf(world);
    expect(digest2).toBe(digest1);

    expect((await putExact(world, { name: '창 1 의 이름', contact: '02-111-1111', expectedDigest: digest1 })).status).toBe(200);
    const afterFirst = world.state();
    const viewAfterFirst = await viewOf(world);

    const stale = await putExact(world, { name: '창 2 의 이름', contact: '02-222-2222', expectedDigest: digest2 });

    expect(stale.status).toBe(409);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect(await json(stale)).toEqual(CONFLICT);
    expect(world.state()).toEqual(afterFirst);
    expect(saves(world)).toHaveLength(1);
    expect(await viewOf(world)).toEqual(viewAfterFirst);
    expect(viewAfterFirst.settings).toEqual({ name: '창 1 의 이름', contact: '02-111-1111' });
    expect(world.repo.getClinic(CLINIC_B)!.name).not.toBe('창 1 의 이름');

    // 사람이 새로 읽은 지문으로 다시 보내야 저장된다.
    expect((await putExact(world, { name: '창 2 의 이름', contact: '02-222-2222', expectedDigest: viewAfterFirst.settingsDigest })).status).toBe(200);
    expect(saves(world)).toHaveLength(2);
  });

  it('성공한 저장의 지문은 한 번만 쓸 수 있다: 같은 요청을 다시 보내면 409 이고 감사 기록은 한 건이다', async () => {
    const world = setup();
    const body = { ...valid(), expectedDigest: await digestOf(world) };
    expect((await putExact(world, body)).status).toBe(200);
    const again = await putExact(world, body);
    expect(again.status).toBe(409);
    expect(await json(again)).toEqual(CONFLICT);
    expect(saves(world)).toHaveLength(1);
  });

  it('순서: 낡은 지문과 틀린 값이 함께 오면 409 가 먼저이고, 현재 지문과 틀린 값이면 400 이다', async () => {
    const world = setup();
    const stale = await digestOf(world);
    expect((await save(world, valid({ name: '앞선 저장' }))).status).toBe(200);
    const before = world.state();
    expect((await putExact(world, { name: '', contact: 'abc', expectedDigest: stale })).status).toBe(409);
    expect((await putExact(world, { name: '', contact: 'abc', expectedDigest: await digestOf(world) })).status).toBe(400);
    expect(world.state()).toEqual(before);
  });

  it('접근 판정의 순서는 그대로다: 지문이 낡았어도 인증 없음 401 · 권한 없음 403 · 병원 기록 없음 404 가 먼저다', async () => {
    const world = setup();
    const stale = { ...valid(), expectedDigest: 'c'.repeat(64) };
    expect((await putExact(world, stale, null)).status).toBe(401);
    expect((await putExact(world, stale, 'ha-clinic-2')).status).toBe(403);
    expect((await putExact(world, stale, 'rv-1')).status).toBe(403);
    expect((await call(world.as(GHOST_HA), 'PUT', path('TEST_FIXTURE_CLINIC_GHOST'), stale)).status).toBe(404);
  });
});

describe('설정을 읽은 뒤 카탈로그가 새로 게시된 경우', () => {
  const PREVIEW_BODY = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [T1] };

  /** 병원 A 의 HA 가 실제 흐름(초안 저장 → 미리보기 → 게시)으로 새 카탈로그를 게시하고 새 버전 id 를 돌려준다. */
  async function publishNewCatalog(world: Setup): Promise<string> {
    const draft = await call(world.as('ha-clinic-1'), 'PUT', `clinics/${CLINIC_A}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 11_000 }] });
    expect(draft.status).toBe(200);
    const preview = await call(world.as('ha-clinic-1'), 'POST', `clinics/${CLINIC_A}/catalog/preview`, PREVIEW_BODY);
    expect(preview.status).toBe(200);
    const published = await call(world.as('ha-clinic-1'), 'POST', `clinics/${CLINIC_A}/catalog/publish`, { publishConfirmation: (await json(preview)).publishConfirmation });
    expect(published.status).toBe(200);
    return (await json(published)).catalogVersion as string;
  }

  it('화면을 연 뒤 새 카탈로그가 게시돼도 저장은 막히지 않고, 저장 뒤에도 병원의 현재 카탈로그 버전은 새 버전이다 (과거 값으로 돌아가지 않는다)', async () => {
    const world = setup();
    const opened = await viewOf(world); // 화면을 연 순간: 옛 카탈로그 버전과 지문
    const oldVersion = opened.catalogVersion as string;

    const newVersion = await publishNewCatalog(world);
    expect(newVersion).not.toBe(oldVersion);
    expect(await digestOf(world)).toBe(opened.settingsDigest); // 지문은 카탈로그와 무관하다

    const response = await call(world.as('ha-clinic-1'), 'PUT', path(CLINIC_A), { ...valid(), expectedDigest: opened.settingsDigest });

    expect(response.status).toBe(200);
    expect(world.repo.getClinic(CLINIC_A)!.currentCatalogVersionId).toBe(newVersion);
    expect((await json(response)).catalogVersion).toBe(newVersion);
    expect((await publicCatalog(world, CLINIC_1_SLUG)).body.catalogVersion).toBe(newVersion);
    expect((await publicCatalog(world, CLINIC_1_SLUG)).body.clinic.displayName).toBe('새 병원 이름');
    // 새 카탈로그가 가격을 바꾼 치료는 저장 뒤에도 새 가격이다.
    const treatment = ((await publicCatalog(world, CLINIC_1_SLUG)).body.treatments as Json[]).find((entry) => entry.treatmentId === T1)!;
    expect(treatment.patientAmount).toBe(11_000);
  });

  it('반대 순서: 병원명을 먼저 저장한 뒤 카탈로그를 게시해도 새 병원명이 그대로다', async () => {
    const world = setup();
    expect((await save(world, valid({ name: '게시 전에 바꾼 이름' }))).status).toBe(200);
    const newVersion = await publishNewCatalog(world);
    expect(world.repo.getClinic(CLINIC_A)).toMatchObject({ name: '게시 전에 바꾼 이름', contact: VALID_CONTACT, currentCatalogVersionId: newVersion });
    expect((await publicCatalog(world, CLINIC_1_SLUG)).body.clinic.displayName).toBe('게시 전에 바꾼 이름');
  });
});

describe('변경 이력 화면은 이번 범위에서 바뀌지 않는다 (새 동작의 노출은 별도 작업)', () => {
  it('설정을 저장해도 변경 이력의 항목·허용 목록·건수는 그대로이고 CLINIC_SETTINGS_SAVE 는 나오지 않는다 (머리말의 병원 이름만 병원의 현재 이름으로 바뀐다)', async () => {
    const world = setup();
    const history = async (): Promise<Json> => json(await call(world.as('ha-clinic-1'), 'GET', 'audit-log'));
    const before = await history();
    expect((await save(world, valid())).status).toBe(200);
    expect(world.audit().some((entry) => entry.action === 'CLINIC_SETTINGS_SAVE')).toBe(true); // 감사 기록에는 남는다
    const after = await history();
    const { clinic: clinicBefore, ...restBefore } = before;
    const { clinic: clinicAfter, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore); // 항목·허용 목록·건수가 같다
    expect(clinicAfter).toEqual({ id: CLINIC_A, displayName: '새 병원 이름' });
    expect(clinicBefore.id).toBe(CLINIC_A);
    expect(after.coveredActions).toEqual([...CHANGE_HISTORY_ACTIONS]);
    expect([...CHANGE_HISTORY_ACTIONS]).toEqual(['CATALOG_DRAFT_SAVE', 'CATALOG_DRAFT_DISCARD', 'CATALOG_DRAFT_PUBLISH', 'IDLE_POLICY_SAVE']);
    expect(JSON.stringify(after)).not.toContain('CLINIC_SETTINGS_SAVE');
  });
});
