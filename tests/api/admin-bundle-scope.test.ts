import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import type { AdminIdentity } from '../../src/server/admin/auth';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { handleOptions } from '../../src/server/api/options';
import { createDraft } from '../../src/server/authoring';
import { computeBundlePublishConfirmation } from '../../src/server/bundle-compose';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import type { ItemVersionRef } from '../../src/server/domain/items';
import { assignRuleScope } from '../../src/server/rule-scope';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG } from '../fixtures/server/api-composition.fixture';
import { T1 } from '../fixtures/server/base-fee.fixture';
import { T3, approvedMapping, composeWorld } from '../fixtures/server/bundle-compose.fixture';
import { changedKeys } from '../fixtures/server/catalog-structure.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from '../fixtures/server/governance.fixture';
import { mappingRecord } from '../fixtures/server/items.fixture';
import { adoptTreatmentVersion } from '../fixtures/server/lifecycle.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';

// 묶음 게시 · 규칙 사용 범위 지정 관리자 API (M7 묶음 구성). 모두 handleAdmin 을 지난다. 경로마다 역할이 정해져 있다(플랫폼 단위 소속만 인정).
//   RV  GET  /api/admin/bundle-publish                       — 기준 묶음과 후보 매핑
//   RV  POST /api/admin/bundle-publish/preview               — 구성 미리보기(읽기 전용)
//   RV  POST /api/admin/bundle-publish                       — 게시(확인값 필요). 어느 병원에도 지정하지 않는다
//   PO  GET  /api/admin/rule-scope                           — 병원별 현재 범위와 묶음 목록
//   PO  POST /api/admin/rule-scope/clinics/{clinicId}        — 범위 지정(화면이 본 현재 범위 확인)
// 처리 순서: 401 → 404/405 → 403 → 400 → 도메인(404 · 409 · 400). 거절은 모두 저장 상태가 그대로다.

const BASE = 'http://localhost/api/admin';
const CLINIC_1 = TEST_FIXTURE_CLINIC_ID;
const CLINIC_2 = OTHER_CLINIC_ID;
const HASH = 'a'.repeat(64);

const CLINIC_BOUND_RV: AdminIdentity = { userId: 'TEST_FIXTURE_RV_BOUND', memberships: [{ clinicId: CLINIC_1, role: 'RV' }] };
const CLINIC_BOUND_PO: AdminIdentity = { userId: 'TEST_FIXTURE_PO_BOUND', memberships: [{ clinicId: CLINIC_1, role: 'PO' }] };
const PLATFORM_HA: AdminIdentity = { userId: 'TEST_FIXTURE_HA_PLATFORM', memberships: [{ clinicId: null, role: 'HA' }] };

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type Who = TestAccountKey | AdminIdentity | null;

function setup() {
  const built = composeWorld();
  const { world } = built;
  const as = (who: Who) => adminServicesOf(world, { authenticator: staticAuthenticator(who === null ? null : typeof who === 'string' ? identityOf(who) : who) }).admin;
  const api = adminServicesOf(world, { authenticator: staticAuthenticator(null) }).api;
  return { ...built, repo: world.repo, as, api, state: () => world.repo.exportState() };
}

type Setup = ReturnType<typeof setup>;

const segmentsOf = (path: string): string[] => path.split('/').filter((part) => part !== '').map(decodeURIComponent);

function call(admin: ReturnType<Setup['as']>, method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: body === undefined ? {} : { 'content-type': 'application/json' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return handleAdmin(admin, new Request(`${BASE}/${path}`, init), segmentsOf(path));
}

const callRaw = (admin: ReturnType<Setup['as']>, method: string, path: string, text: string): Promise<Response> =>
  handleAdmin(admin, new Request(`${BASE}/${path}`, { method, body: text, headers: { 'content-type': 'application/json' } }), segmentsOf(path));

const json = async (response: Response): Promise<Json> => (await response.json()) as Json;
const refBody = (ref: ItemVersionRef) => ({ id: ref.id, version: ref.version });
const previewBody = (baseBundleId: string, ...refs: ItemVersionRef[]) => ({ baseBundleId, mappings: refs.map(refBody) });
const publishBody = (baseBundleId: string, confirmation: string, ...refs: ItemVersionRef[]) => ({ baseBundleId, mappings: refs.map(refBody), publishConfirmation: confirmation });
const assignBody = (ruleBundleVersionId: string, expectedCurrentBundleId: string | null) => ({ ruleBundleVersionId, expectedCurrentBundleId });

/** 미리보기를 받아 확인값을 돌려준다(깨끗한 구성이어야 한다). */
async function confirmationFor(world: Setup, baseBundleId: string, ...refs: ItemVersionRef[]): Promise<string> {
  const response = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(baseBundleId, ...refs));
  expect(response.status).toBe(200);
  const confirmation = (await json(response)).publishConfirmation as string | null;
  expect(confirmation).toMatch(/^[0-9a-f]{64}$/);
  return confirmation as string;
}

/** 미리보기 → 게시를 API 로 한다. 새 묶음 id 를 돌려준다. */
async function publishVia(world: Setup, baseBundleId: string, ...refs: ItemVersionRef[]): Promise<string> {
  const response = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody(baseBundleId, await confirmationFor(world, baseBundleId, ...refs), ...refs));
  expect(response.status).toBe(200);
  return (await json(response)).bundle.id as string;
}

describe('인증·권한 표: 새 경로 다섯 개는 경로마다 정해진 플랫폼 단위 역할만 열린다 (거절은 저장 상태가 그대로)', () => {
  const RV_ROUTES: Array<[string, string, string, unknown]> = [
    ['개요', 'GET', 'bundle-publish', undefined],
    ['미리보기', 'POST', 'bundle-publish/preview', { baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }] }],
    ['게시', 'POST', 'bundle-publish', { baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }], publishConfirmation: HASH }],
  ];
  const PO_ROUTES: Array<[string, string, string, unknown]> = [
    ['개요', 'GET', 'rule-scope', undefined],
    ['지정', 'POST', `rule-scope/clinics/${CLINIC_1}`, assignBody('B', null)],
  ];
  const DENIED: Array<[string, Who, number, Json]> = [
    ['인증 없음', null, 401, { error: 'UNAUTHENTICATED' }],
    ['병원 1 HA', 'ha-clinic-1', 403, { error: 'FORBIDDEN' }],
    ['병원 2 HA', 'ha-clinic-2', 403, { error: 'FORBIDDEN' }],
    ['플랫폼 단위 HA', PLATFORM_HA, 403, { error: 'FORBIDDEN' }],
  ];
  const RV_DENIED: Array<[string, Who, number, Json]> = [
    ...DENIED,
    ['PO', 'po-1', 403, { error: 'FORBIDDEN' }],
    ['병원에 매인 RV', CLINIC_BOUND_RV, 403, { error: 'FORBIDDEN' }],
    ['병원에 매인 RV(시험 계정)', 'rv-clinic-1', 403, { error: 'FORBIDDEN' }],
  ];
  const PO_DENIED: Array<[string, Who, number, Json]> = [
    ...DENIED,
    ['RV', 'rv-1', 403, { error: 'FORBIDDEN' }],
    ['둘째 RV', 'rv-2', 403, { error: 'FORBIDDEN' }],
    ['병원에 매인 PO', CLINIC_BOUND_PO, 403, { error: 'FORBIDDEN' }],
  ];

  it.each([
    ...RV_ROUTES.flatMap(([name, method, path, body]) => RV_DENIED.map(([who, identity, status, expected]) => [`RV 경로 ${name}`, who, identity, method, path, body, status, expected] as const)),
    ...PO_ROUTES.flatMap(([name, method, path, body]) => PO_DENIED.map(([who, identity, status, expected]) => [`PO 경로 ${name}`, who, identity, method, path, body, status, expected] as const)),
  ])('%s · %s', async (_route, _who, identity, method, path, body, status, expected) => {
    const world = setup();
    const before = world.state();
    const response = await call(world.as(identity), method, path, body);
    expect(response.status).toBe(status);
    expect(await json(response)).toEqual(expected);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(world.state()).toEqual(before);
  });

  it('RV 는 PO 경로를, PO 는 RV 경로를 열지 못한다. 한 사람이 두 플랫폼 역할을 가지면 둘 다 연다 (역할이 서로를 넓히지 않는다)', async () => {
    const world = setup();
    const both: AdminIdentity = { userId: 'TEST_FIXTURE_BOTH', memberships: [{ clinicId: null, role: 'RV' }, { clinicId: null, role: 'PO' }] };
    expect((await call(world.as('rv-1'), 'GET', 'rule-scope')).status).toBe(403);
    expect((await call(world.as('po-1'), 'GET', 'bundle-publish')).status).toBe(403);
    expect((await call(world.as(both), 'GET', 'rule-scope')).status).toBe(200);
    expect((await call(world.as(both), 'GET', 'bundle-publish')).status).toBe(200);
  });

  it('처리 순서: 401 → 405 → 403 → 400 → 도메인. 405 는 소속과 무관하게 인증된 요청에 나가고, 403 은 본문 검사와 병원·묶음 존재 확인보다 앞선다', async () => {
    const world = setup();
    const before = world.state();
    const wrongMethods: Array<[string, string]> = [
      ['PUT', 'bundle-publish'],
      ['DELETE', 'bundle-publish'],
      ['GET', 'bundle-publish/preview'],
      ['PUT', 'bundle-publish/preview'],
      ['POST', 'rule-scope'],
      ['DELETE', 'rule-scope'],
      ['GET', `rule-scope/clinics/${CLINIC_1}`],
      ['PUT', `rule-scope/clinics/${CLINIC_1}`],
    ];
    for (const [method, path] of wrongMethods) {
      expect((await call(world.as(null), method, path)).status, `${method} ${path} 인증 없음`).toBe(401);
      expect((await call(world.as('ha-clinic-1'), method, path, method === 'GET' ? undefined : {})).status, `${method} ${path} HA`).toBe(405);
      expect((await call(world.as('po-1'), method, path, method === 'GET' ? undefined : {})).status, `${method} ${path} PO`).toBe(405);
    }
    // 403 이 400·404 보다 앞선다.
    expect((await callRaw(world.as('ha-clinic-1'), 'POST', 'bundle-publish/preview', '{not json')).status).toBe(403);
    expect((await call(world.as('rv-1'), 'POST', 'rule-scope/clinics/TEST_FIXTURE_NO_SUCH_CLINIC', assignBody('B', null))).status).toBe(403);
    expect((await call(world.as('ha-clinic-1'), 'POST', 'rule-scope/clinics/TEST_FIXTURE_NO_SUCH_CLINIC', assignBody('B', null))).status).toBe(403);
    expect(world.state()).toEqual(before);
  });

  it('모르는 경로는 404 (인증된 요청에서만): 모양이 비슷한 경로도 열리지 않는다', async () => {
    const world = setup();
    const paths = ['bundle-publish/extra', 'bundle-publish/preview/extra', 'bundle-publishes', 'rule-scope/extra', 'rule-scope/clinics', `rule-scope/clinics/${CLINIC_1}/extra`, `rule-scope/bundles/${CLINIC_1}`, 'rule-scope/clinics//'];
    for (const path of paths) {
      expect((await call(world.as('rv-1'), 'POST', path, {})).status, path).toBe(404);
      expect((await call(world.as('po-1'), 'POST', path, {})).status, path).toBe(404);
    }
    expect((await call(world.as(null), 'POST', 'bundle-publish/extra', {})).status).toBe(401);
  });

  it('역할·병원·사용자·행위자는 본문에서 읽지 않는다 (알 수 없는 키는 400, 병원은 경로가 정한다)', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const before = world.state();
    for (const key of ['role', 'actor', 'clinicId', 'status', 'publishedBy', 'kind']) {
      const preview = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', { ...previewBody(world.base.id, added), [key]: 'RV' });
      expect(preview.status, key).toBe(400);
      expect((await json(preview)).defects).toEqual([{ code: 'UNKNOWN_FIELD', path: `request.${key}` }]);
    }
    const assign = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_2}`, { ...assignBody(world.base.id, null), clinicId: CLINIC_1 });
    expect(assign.status).toBe(400);
    expect((await json(assign)).defects).toEqual([{ code: 'UNKNOWN_FIELD', path: 'request.clinicId' }]);
    expect(world.state()).toEqual(before);
  });
});

describe('본문 형식 검사: 모두 400 이고 저장 상태가 그대로다', () => {
  it.each([
    ['미리보기', 'rv-1', 'bundle-publish/preview'],
    ['게시', 'rv-1', 'bundle-publish'],
    ['지정', 'po-1', `rule-scope/clinics/${CLINIC_2}`],
  ] as const)('%s · JSON 이 아닌 본문은 NOT_JSON', async (_name, who, path) => {
    const world = setup();
    const before = world.state();
    for (const text of ['{not json', '', 'undefined']) {
      const response = await callRaw(world.as(who), 'POST', path, text);
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'NOT_JSON', path: 'request' }] });
    }
    expect(world.state()).toEqual(before);
  });

  it('미리보기·게시: 빈 매핑 목록, 중복 매핑, 형식이 틀린 확인값', async () => {
    const world = setup();
    const before = world.state();
    const cases: Array<[string, unknown, Array<{ code: string; path: string }>]> = [
      ['bundle-publish/preview', { baseBundleId: 'B', mappings: [] }, [{ code: 'MAPPINGS_EMPTY', path: 'mappings' }]],
      ['bundle-publish/preview', { baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }, { id: 'M', version: '1' }] }, [{ code: 'DUPLICATE_MAPPING', path: 'mappings[1]' }]],
      ['bundle-publish', { baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }] }, [{ code: 'VALUE_MISSING', path: 'publishConfirmation' }]],
      ['bundle-publish', { baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }], publishConfirmation: 'zz' }, [{ code: 'VALUE_INVALID', path: 'publishConfirmation' }]],
      ['bundle-publish', [], [{ code: 'NOT_OBJECT', path: 'request' }]],
    ];
    for (const [path, body, defects] of cases) {
      const response = await call(world.as('rv-1'), 'POST', path, body);
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects });
    }
    expect(world.state()).toEqual(before);
  });

  it('지정: expectedCurrentBundleId 키는 필수이고(null 허용), 병원 id 는 본문이 아니라 경로다', async () => {
    const world = setup();
    const before = world.state();
    const missing = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_2}`, { ruleBundleVersionId: world.base.id });
    expect(missing.status).toBe(400);
    expect((await json(missing)).defects).toEqual([{ code: 'VALUE_MISSING', path: 'expectedCurrentBundleId' }]);
    expect(world.state()).toEqual(before);
  });
});

describe('RV · 개요 (GET /bundle-publish)', () => {
  it('기준 묶음과 승인된 후보 매핑을 낸다. 읽기만 한다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const before = world.state();

    const response = await call(world.as('rv-1'), 'GET', 'bundle-publish');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['bases', 'candidates', 'unreadable']);
    expect(body.bases).toHaveLength(1);
    expect(body.bases[0]).toMatchObject({ bundleId: world.base.id, status: 'ACTIVE', itemCounts: { profiles: 1, mappings: 3, documentRuleSets: 1 }, clinics: [{ clinicId: CLINIC_1, slug: CLINIC_1_SLUG }] });
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ mappingRef: added, treatmentId: T3, approvedFingerprint: 'CURRENT', target: { displayName: 'TEST_FIXTURE 치료 3', clinicSlug: CLINIC_1_SLUG } });
    expect(world.state()).toEqual(before);
  });
});

describe('RV · 미리보기 (POST /bundle-publish/preview)', () => {
  it('깨끗한 구성: 합친 항목 · 결함 없음 · 충돌 없음 · 확인값. 저장 상태는 그대로다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const before = world.state();

    const response = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(world.base.id, added));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['base', 'conflicts', 'defects', 'items', 'publishConfirmation']);
    expect(body.base).toMatchObject({ bundleId: world.base.id, status: 'ACTIVE', itemCount: 5 });
    expect(body.items).toHaveLength(6);
    expect(body.items.filter((item: Json) => item.source === 'ADDED')).toEqual([expect.objectContaining({ kind: 'MAPPING', id: added.id, version: added.version, state: 'APPROVED', path: 'bundle.mappings[3]' })]);
    expect(body.defects).toEqual([]);
    expect(body.conflicts).toEqual([]);
    expect(body.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
    expect(world.state()).toEqual(before);
  });

  it('충돌이나 결함이 있어도 200 이고 이유를 담는다 (확인값은 null). 저장 상태는 그대로다', async () => {
    const world = setup();
    const clash = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_T1_CLASH', T1);
    const draft = createDraft(world.world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord(T3, { id: 'TEST_FIXTURE_MAPPING_DRAFT' }).content).ref;
    const before = world.state();

    const conflicting = await json(await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(world.base.id, clash)));
    expect(conflicting.publishConfirmation).toBeNull();
    expect(conflicting.conflicts).toEqual([
      expect.objectContaining({ mappingRef: clash, path: 'mappings[0]', treatmentId: T1, conflictsWith: [expect.objectContaining({ source: 'BASE', cells: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }] })] }),
    ]);
    const defective = await json(await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(world.base.id, draft)));
    expect(defective.publishConfirmation).toBeNull();
    expect(defective.defects).toContainEqual({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: 'bundle.mappings[3].state' });
    expect(world.state()).toEqual(before);
  });

  it('기준 묶음이 없으면 404, 중지됐으면 409 BASE_BUNDLE_NOT_ACTIVE, 고른 매핑이 없으면 404, 이미 기준 묶음에 있으면 409 MAPPING_ALREADY_IN_BASE', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const inBase = world.base.itemRefs.find((ref) => ref.kind === 'MAPPING') as ItemVersionRef;
    const before = world.state();

    const noBase = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody('TEST_FIXTURE_NO_SUCH_BUNDLE', added));
    expect([noBase.status, await json(noBase)]).toEqual([404, { error: 'NOT_FOUND' }]);
    const noMapping = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', { baseBundleId: world.base.id, mappings: [{ id: 'TEST_FIXTURE_NO_SUCH_MAPPING', version: 'v1' }] });
    expect([noMapping.status, await json(noMapping)]).toEqual([404, { error: 'NOT_FOUND' }]);
    const already = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(world.base.id, inBase));
    expect([already.status, await json(already)]).toEqual([409, { error: 'CONFLICT', reason: 'MAPPING_ALREADY_IN_BASE' }]);
    expect(world.state()).toEqual(before);

    suspendRuleBundle(world.world.deps, TEST_FIXTURE_RV_SUSPENDER, world.base.id, 'TEST_FIXTURE 중지');
    const suspendedBefore = world.state();
    const suspended = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', previewBody(world.base.id, added));
    expect([suspended.status, await json(suspended)]).toEqual([409, { error: 'CONFLICT', reason: 'BASE_BUNDLE_NOT_ACTIVE' }]);
    expect(world.state()).toEqual(suspendedBefore);
  });
});

describe('RV · 게시 (POST /bundle-publish)', () => {
  it('새 묶음을 만든다: 응답은 묶음 요약과 지정된 병원 없음. 바뀌는 영역은 감사 · 묶음 · 가용성 기록 · 항목 상태뿐이고 범위 이력은 그대로다', async () => {
    const world = setup();
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const confirmation = await confirmationFor(world, world.base.id, added);
    const before = world.state();
    world.world.clock.set('2026-10-18T09:00:00.000Z');

    const response = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody(world.base.id, confirmation, added));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['assignedClinics', 'bundle']);
    expect(body.assignedClinics).toEqual([]);
    expect(body.bundle).toMatchObject({ status: 'ACTIVE', publishedAt: '2026-10-18T09:00:00.000Z', publishedBy: identityOf('rv-1').userId, contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(body.bundle.itemRefs).toHaveLength(6);
    expect(body.bundle.itemRefs).toContainEqual(added);

    const after = world.state();
    expect(changedKeys(before, after)).toEqual(['auditLog', 'bundleEvents', 'bundles', 'itemStates']);
    expect(world.repo.getItemState(added)?.state).toBe('PUBLISHED');
    expect(world.repo.getClinicRuleScope(CLINIC_1)?.ruleBundleVersionId).toBe(world.base.id);
    expect(world.repo.getClinicRuleScope(CLINIC_2)).toBeNull();
    const audit = world.repo.listAuditLog();
    expect(audit.filter((entry) => entry.action === 'BUNDLE_PUBLISH' && entry.target === `BUNDLE/${body.bundle.id}`)).toHaveLength(1);
    expect(audit.filter((entry) => entry.action === 'BUNDLE_PUBLISH').at(-1)).toMatchObject({ actorId: identityOf('rv-1').userId, role: 'RV' });
    expect(audit.some((entry) => entry.action === 'CLINIC_SCOPE_ASSIGN' && entry.at === '2026-10-18T09:00:00.000Z')).toBe(false);
  });

  it('확인값이 없는 요청 · 다른 구성의 확인값 · 다른 관리자의 확인값은 409 PREVIEW_REQUIRED 이고 저장 상태가 그대로다', async () => {
    const world = setup();
    const a = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_A', T3, { scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }] });
    const b = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_B', T3, { scope: [{ generation: 'GEN1_AS', insurerType: 'LIFE' }] });
    const confirmationForA = await confirmationFor(world, world.base.id, a);
    const otherAdmin = computeBundlePublishConfirmation(world.world.deps, { id: identityOf('rv-2').userId, role: 'RV' }, { baseBundleId: world.base.id, mappings: [a] });
    const before = world.state();

    for (const [name, body, who] of [
      ['임의의 확인값', publishBody(world.base.id, HASH, a), 'rv-1'],
      ['다른 구성의 확인값', publishBody(world.base.id, confirmationForA, a, b), 'rv-1'],
      ['다른 관리자의 확인값', publishBody(world.base.id, otherAdmin, a), 'rv-1'],
      ['다른 관리자가 같은 확인값을 보냄', publishBody(world.base.id, confirmationForA, a), 'rv-2'],
    ] as const) {
      const response = await call(world.as(who), 'POST', 'bundle-publish', body);
      expect([response.status, await json(response)], name).toEqual([409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' }]);
      expect(world.state(), name).toEqual(before);
    }
  });

  it('충돌은 409 MAPPING_CONFLICT, 기준 묶음이 없으면 404, 중지됐으면 409 BASE_BUNDLE_NOT_ACTIVE, 이미 기준 묶음에 있으면 409 MAPPING_ALREADY_IN_BASE 이고 저장 상태가 그대로다', async () => {
    const world = setup();
    const clash = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_T1_CLASH', T1);
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const inBase = world.base.itemRefs.find((ref) => ref.kind === 'MAPPING') as ItemVersionRef;
    const rv = { id: identityOf('rv-1').userId, role: 'RV' } as const;
    const confirmationFor_ = (...refs: ItemVersionRef[]) => computeBundlePublishConfirmation(world.world.deps, rv, { baseBundleId: world.base.id, mappings: refs });
    const before = world.state();

    const conflict = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody(world.base.id, confirmationFor_(clash), clash));
    expect([conflict.status, await json(conflict)]).toEqual([409, { error: 'CONFLICT', reason: 'MAPPING_CONFLICT' }]);
    const noBase = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody('TEST_FIXTURE_NO_SUCH_BUNDLE', HASH, added));
    expect([noBase.status, await json(noBase)]).toEqual([404, { error: 'NOT_FOUND' }]);
    const already = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody(world.base.id, HASH, inBase));
    expect([already.status, await json(already)]).toEqual([409, { error: 'CONFLICT', reason: 'MAPPING_ALREADY_IN_BASE' }]);
    expect(world.state()).toEqual(before);

    const confirmation = await confirmationFor(world, world.base.id, added);
    suspendRuleBundle(world.world.deps, TEST_FIXTURE_RV_SUSPENDER, world.base.id, 'TEST_FIXTURE 중지');
    const suspendedBefore = world.state();
    const suspended = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody(world.base.id, confirmation, added));
    expect([suspended.status, await json(suspended)]).toEqual([409, { error: 'CONFLICT', reason: 'BASE_BUNDLE_NOT_ACTIVE' }]);
    expect(world.state()).toEqual(suspendedBefore);
  });

  it('승인되지 않은 매핑은 400 (기존 게시 전제 ITEM_STATE_NOT_PUBLISHABLE), 승인 뒤 치료가 바뀌었으면 400 FINGERPRINT_STALE 이다. 저장 상태가 그대로다', async () => {
    const world = setup();
    const draft = createDraft(world.world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord(T3, { id: 'TEST_FIXTURE_MAPPING_DRAFT' }).content).ref;
    const rv = { id: identityOf('rv-1').userId, role: 'RV' } as const;
    const before = world.state();

    const notApproved = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody(world.base.id, computeBundlePublishConfirmation(world.world.deps, rv, { baseBundleId: world.base.id, mappings: [draft] }), draft));
    expect(notApproved.status).toBe(400);
    const notApprovedBody = await json(notApproved);
    expect(notApprovedBody.error).toBe('INVALID_REQUEST');
    expect(notApprovedBody.defects).toContainEqual({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: 'bundle.mappings[3].state' });
    expect(world.state()).toEqual(before);

    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const confirmation = await confirmationFor(world, world.base.id, added);
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3B', treatmentId: T3, treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    const staleBefore = world.state();
    const stale = await call(world.as('rv-1'), 'POST', 'bundle-publish', publishBody(world.base.id, confirmation, added));
    expect(stale.status).toBe(400);
    expect((await json(stale)).defects).toContainEqual({ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[3].approvedFingerprint' });
    expect(world.state()).toEqual(staleBefore);
  });
});

describe('PO · 규칙 사용 범위 (GET /rule-scope, POST /rule-scope/clinics/{clinicId})', () => {
  it('개요: 병원별 현재 범위와 묶음 목록. 읽기만 한다', async () => {
    const world = setup();
    const before = world.state();

    const response = await call(world.as('po-1'), 'GET', 'rule-scope');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['bundles', 'clinics']);
    expect(body.clinics.map((clinic: Json) => [clinic.clinicId, clinic.current === null ? null : clinic.current.bundleId])).toEqual([
      [CLINIC_1, world.base.id],
      [CLINIC_2, null],
    ]);
    expect(body.bundles.map((bundle: Json) => [bundle.bundleId, bundle.status])).toEqual([[world.base.id, 'ACTIVE']]);
    expect(world.state()).toEqual(before);
  });

  it('지정: 그 병원의 범위만 바뀌고 응답은 갱신된 병원 줄과 새 범위다. 바뀌는 영역은 감사 · 범위 이력뿐이다', async () => {
    const world = setup();
    const next = await publishVia(world, world.base.id, approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3'));
    const before = world.state();
    world.world.clock.set('2026-10-18T10:00:00.000Z');
    const response = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_2}`, assignBody(next, null));

    expect(response.status).toBe(200);
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['clinic', 'scope']);
    expect(body.clinic).toMatchObject({ clinicId: CLINIC_2, slug: CLINIC_2_SLUG, current: { bundleId: next, status: 'ACTIVE', assignedAt: '2026-10-18T10:00:00.000Z', assignedBy: identityOf('po-1').userId } });
    expect(body.scope).toEqual({ clinicId: CLINIC_2, ruleBundleVersionId: next, assignedAt: '2026-10-18T10:00:00.000Z', assignedBy: identityOf('po-1').userId });
    expect(changedKeys(before, world.state())).toEqual(['auditLog', 'scopeHistory']);
    expect(world.repo.getClinicRuleScope(CLINIC_1)?.ruleBundleVersionId).toBe(world.base.id);
    expect(world.repo.listAuditLog().at(-1)).toMatchObject({ action: 'CLINIC_SCOPE_ASSIGN', target: `CLINIC/${CLINIC_2}`, beforeVersion: null, afterVersion: next, actorId: identityOf('po-1').userId, role: 'PO' });
  });

  it('그 사이 범위가 바뀌었으면 409 SCOPE_CHANGED, 없는 병원 · 없는 묶음은 404 이고 저장 상태가 그대로다', async () => {
    const world = setup();
    const next = await publishVia(world, world.base.id, approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3'));
    const before = world.state();

    const changed = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_1}`, assignBody(next, null));
    expect([changed.status, await json(changed)]).toEqual([409, { error: 'CONFLICT', reason: 'SCOPE_CHANGED' }]);
    const wrongBundle = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_1}`, assignBody(next, next));
    expect([wrongBundle.status, await json(wrongBundle)]).toEqual([409, { error: 'CONFLICT', reason: 'SCOPE_CHANGED' }]);
    const noClinic = await call(world.as('po-1'), 'POST', 'rule-scope/clinics/TEST_FIXTURE_NO_SUCH_CLINIC', assignBody(next, null));
    expect([noClinic.status, await json(noClinic)]).toEqual([404, { error: 'NOT_FOUND' }]);
    const noBundle = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_1}`, assignBody('TEST_FIXTURE_NO_SUCH_BUNDLE', world.base.id));
    expect([noBundle.status, await json(noBundle)]).toEqual([404, { error: 'NOT_FOUND' }]);
    expect(world.state()).toEqual(before);
  });
});

describe('끝에서 끝까지: 승인된 매핑 → RV 가 새 묶음 게시 → PO 가 한 병원에 지정 → 그 병원의 공개 옵션 · 계산이 새 묶음을 쓴다', () => {
  type PublicCall = { status: number; text: string; body: Json };

  async function optionsOf(world: Setup, slug: string): Promise<PublicCall> {
    const response = await handleOptions(world.api, slug);
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as Json };
  }

  async function estimateOf(world: Setup, slug: string, ruleBundleVersion: string | null, treatmentIds: string[]): Promise<PublicCall> {
    const catalogVersion = ((await (await handleCatalog(world.api, slug)).json()) as Json).catalogVersion as string;
    const response = await handleEstimate(world.api, slug, () => Promise.resolve({ catalogVersion, ruleBundleVersion, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds }));
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as Json };
  }

  const lineOf = (call: PublicCall, treatmentId: string): Json => (call.body.result.lines as Json[]).find((line) => line.treatmentId === treatmentId) as Json;

  it('게시만으로는 병원이 달라지지 않고, 지정 뒤에는 그 병원만 새 묶음을 쓴다 (이전 묶음을 본 요청은 VERSION_MISMATCH)', async () => {
    const world = setup();
    // 병원 2 도 기준 묶음을 쓰게 해 둔다: 지정 뒤에도 병원 2 는 그대로여야 한다.
    assignRuleScope(world.world.deps, TEST_FIXTURE_PO_1, CLINIC_2, world.base.id);
    const baseId = world.base.id;
    const added = approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const treatments = [T1, T3];

    // 게시 전: 기준 묶음에 매핑이 없는 T3 는 보류(MAPPING_ABSENT)다.
    const optionsBefore = await optionsOf(world, CLINIC_1_SLUG);
    const estimateBefore = await estimateOf(world, CLINIC_1_SLUG, baseId, treatments);
    const otherOptionsBefore = await optionsOf(world, CLINIC_2_SLUG);
    const otherEstimateBefore = await estimateOf(world, CLINIC_2_SLUG, baseId, [OTHER_CLINIC_TREATMENT_ID]);
    expect(otherEstimateBefore.status).toBe(200);
    expect(optionsBefore.body.ruleBundleVersion).toBe(baseId);
    expect(estimateBefore.status).toBe(200);
    expect(lineOf(estimateBefore, T1).state).toBe('ESTIMATED');
    expect(lineOf(estimateBefore, T3)).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_ABSENT' });

    // RV 가 게시한다.
    const next = await publishVia(world, baseId, added);
    expect(next).not.toBe(baseId);

    // 게시 뒤 지정 전: 병원 1·2 의 옵션과 계산(같은 요청)은 한 글자도 달라지지 않는다.
    expect((await optionsOf(world, CLINIC_1_SLUG)).text).toBe(optionsBefore.text);
    expect((await estimateOf(world, CLINIC_1_SLUG, baseId, treatments)).text).toBe(estimateBefore.text);
    expect((await optionsOf(world, CLINIC_2_SLUG)).text).toBe(otherOptionsBefore.text);

    // RV 는 지정할 수 없다. PO 가 병원 1 만 지정한다.
    expect((await call(world.as('rv-1'), 'POST', `rule-scope/clinics/${CLINIC_1}`, assignBody(next, baseId))).status).toBe(403);
    expect((await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_1}`, assignBody(next, baseId))).status).toBe(200);

    // 병원 1: 옵션이 새 묶음을 가리키고, T3 가 계산된다. 이전 묶음을 본 요청은 409 VERSION_MISMATCH.
    const optionsAfter = await optionsOf(world, CLINIC_1_SLUG);
    expect(optionsAfter.body).toMatchObject({ ruleBundleVersion: next, ruleBundleStatus: 'ACTIVE' });
    const stale = await estimateOf(world, CLINIC_1_SLUG, baseId, treatments);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'VERSION_MISMATCH', latest: { ruleBundleVersion: next, ruleBundleStatus: 'ACTIVE' }, changes: { ruleChanged: true } });
    const estimateAfter = await estimateOf(world, CLINIC_1_SLUG, next, treatments);
    expect(estimateAfter.status).toBe(200);
    expect(lineOf(estimateAfter, T1).state).toBe('ESTIMATED');
    expect(lineOf(estimateAfter, T3).state).toBe('ESTIMATED');
    expect(lineOf(estimateAfter, T3).holdReason).toBeUndefined();
    expect(estimateAfter.body.versions.ruleBundleVersion).toBe(next);

    // 병원 2: 옵션이 그대로이고 기준 묶음을 본 요청이 그대로 통한다.
    expect((await optionsOf(world, CLINIC_2_SLUG)).text).toBe(otherOptionsBefore.text);
    expect((await estimateOf(world, CLINIC_2_SLUG, baseId, [OTHER_CLINIC_TREATMENT_ID])).text).toBe(otherEstimateBefore.text);
    expect(world.repo.getClinicRuleScope(CLINIC_2)?.ruleBundleVersionId).toBe(baseId);
  });
});
