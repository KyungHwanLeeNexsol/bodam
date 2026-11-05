import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import type { AdminIdentity } from '../../src/server/admin/auth';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { handleOptions } from '../../src/server/api/options';
import type { ItemVersionRef } from '../../src/server/domain/items';
import { assignRuleScope } from '../../src/server/rule-scope';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_PO_1 } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG } from '../fixtures/server/api-composition.fixture';
import { T1 } from '../fixtures/server/base-fee.fixture';
import { T3, approvedMapping, composeWorld } from '../fixtures/server/bundle-compose.fixture';
import { changedKeys } from '../fixtures/server/catalog-structure.fixture';
import { makeBundleVersion, makeClinic } from '../fixtures/server/entities.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';

// 규칙 묶음 중지와 병원별 재지정 (M7 묶음 중지, AC-025f · DD-14 · DD-17). 모두 handleAdmin(실제 관리자 핸들러)과 공개 핸들러를 지난다.
//   RV  POST /api/admin/rule-bundles/{bundleId}/suspend       — 본문 { reason }. 응답 { bundle, suspension, affectedClinics }
//   PO  POST /api/admin/rule-scope/clinics/{clinicId}         — 지정하려는 묶음이 지정 트랜잭션 안에서 ACTIVE 가 아니면 409 BUNDLE_NOT_ACTIVE
// 세계: 병원 A(=병원 1)·B(=병원 2)는 지금 묶음 X 를 쓴다. 병원 C 는 다른 묶음 Y 를 쓰고, 병원 D 는 예전에 X 를 썼다가 지금은 Y 를 쓴다.
// 중지는 묶음의 가용성만 바꾼다: 묶음 내용·항목 상태·병원별 지정은 그대로이고, 되살리는 길도 자동 교체도 없다. 복구는 PO 가 병원마다 정상 묶음으로 따로 재지정하는 것이다.

const BASE = 'http://localhost/api/admin';
const CLINIC_A = TEST_FIXTURE_CLINIC_ID;
const CLINIC_B = OTHER_CLINIC_ID;
const CLINIC_C = 'TEST_FIXTURE_CLINIC_3';
const CLINIC_D = 'TEST_FIXTURE_CLINIC_4';
const SLUG_C = 'test-fixture-clinic-3';
const SLUG_D = 'test-fixture-clinic-4';
const REASON = 'TEST_FIXTURE 약관 개정으로 묶음 중지';

const CLINIC_BOUND_RV: AdminIdentity = { userId: 'TEST_FIXTURE_RV_BOUND', memberships: [{ clinicId: CLINIC_A, role: 'RV' }] };
const PLATFORM_HA: AdminIdentity = { userId: 'TEST_FIXTURE_HA_PLATFORM', memberships: [{ clinicId: null, role: 'HA' }] };

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type Who = TestAccountKey | AdminIdentity | null;

function setup() {
  const built = composeWorld();
  const { world } = built;
  // B 도 X 를 쓰게 하고, 범위만 있으면 되는 병원 C·D 를 더한다(카탈로그는 필요 없다: 이 두 병원은 영향 목록에서 빠지는지만 본다).
  assignRuleScope(world.deps, TEST_FIXTURE_PO_1, CLINIC_B, built.base.id);
  world.repo.saveClinic(makeClinic({ id: CLINIC_C, slug: SLUG_C, name: 'TEST_FIXTURE 병원 C' }));
  world.repo.saveClinic(makeClinic({ id: CLINIC_D, slug: SLUG_D, name: 'TEST_FIXTURE 병원 D' }));
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
const suspendPath = (bundleId: string): string => `rule-bundles/${encodeURIComponent(bundleId)}/suspend`;
const assignBody = (ruleBundleVersionId: string, expectedCurrentBundleId: string | null) => ({ ruleBundleVersionId, expectedCurrentBundleId });
const refBody = (ref: ItemVersionRef) => ({ id: ref.id, version: ref.version });

/** 미리보기 → 게시를 API 로 한다. 기준 묶음에 매핑 하나를 더한 새 묶음 id 를 돌려준다. */
async function publishVia(world: Setup, baseBundleId: string, ...refs: ItemVersionRef[]): Promise<string> {
  const body = { baseBundleId, mappings: refs.map(refBody) };
  const preview = await call(world.as('rv-1'), 'POST', 'bundle-publish/preview', body);
  expect(preview.status).toBe(200);
  const confirmation = (await json(preview)).publishConfirmation as string;
  const response = await call(world.as('rv-1'), 'POST', 'bundle-publish', { ...body, publishConfirmation: confirmation });
  expect(response.status).toBe(200);
  return (await json(response)).bundle.id as string;
}

async function assignVia(world: Setup, clinicId: string, bundleId: string, expected: string | null): Promise<void> {
  const response = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${clinicId}`, assignBody(bundleId, expected));
  expect(response.status, await response.clone().text()).toBe(200);
}

/** X(=기준 묶음)와 Y(X 에 매핑을 더한 정상 묶음)를 두고 병원 네 곳을 시나리오대로 지정한다. */
async function scenario() {
  const world = setup();
  const x = world.base.id;
  const y = await publishVia(world, x, approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3'));
  await assignVia(world, CLINIC_C, y, null);
  await assignVia(world, CLINIC_D, x, null);
  await assignVia(world, CLINIC_D, y, x);
  return { ...world, x, y };
}

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

const holdReasons = (result: PublicCall): string[] => [...new Set((result.body.result.lines as Json[]).map((line) => String(line.holdReason)))];
const lineOf = (result: PublicCall, treatmentId: string): Json => (result.body.result.lines as Json[]).find((line) => line.treatmentId === treatmentId) as Json;

describe('AC-025f 묶음 X 중지: 영향 병원은 현재 X 를 쓰는 A·B 뿐이다', () => {
  it('RV 가 사유와 함께 중지하면 200, affectedClinics 는 A·B 정확히 (C 와 지난 이력만 있는 D 는 없다). 바뀌는 영역은 감사 기록과 가용성 기록뿐이다', async () => {
    const world = await scenario();
    const before = world.state();
    world.world.clock.set('2026-10-18T11:00:00.000Z');

    const response = await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(['affectedClinics', 'bundle', 'suspension']);
    expect(body.bundle).toEqual({ id: world.x, status: 'SUSPENDED' });
    expect(body.suspension).toEqual({ at: '2026-10-18T11:00:00.000Z', by: identityOf('rv-1').userId, role: 'RV', reason: REASON, previousStatus: 'ACTIVE' });
    expect(body.affectedClinics).toEqual([
      { clinicId: CLINIC_A, slug: CLINIC_1_SLUG },
      { clinicId: CLINIC_B, slug: CLINIC_2_SLUG },
    ]);

    // 중지는 묶음의 가용성만 바꾼다: 묶음 내용(bundles)·항목 상태(itemStates)·병원별 지정(scopes·scopeHistory)은 한 글자도 바뀌지 않는다.
    expect(changedKeys(before, world.state())).toEqual(['auditLog', 'bundleEvents']);
    expect(world.repo.getBundleStatus(world.x)).toBe('SUSPENDED');
    expect(world.repo.getBundleStatus(world.y)).toBe('ACTIVE');
    expect(world.repo.listBundleStatusEvents(world.x).map((event) => event.status)).toEqual(['ACTIVE', 'SUSPENDED']);
    for (const clinicId of [CLINIC_A, CLINIC_B]) {
      expect(world.repo.getClinicRuleScope(clinicId)?.ruleBundleVersionId).toBe(world.x);
    }
    expect(world.repo.listClinicRuleScopeHistory(CLINIC_D).map((scope) => scope.ruleBundleVersionId)).toEqual([world.x, world.y]);
  });

  it('감사 기록 한 건: 수행자·역할·시각·사유·이전/이후 상태·영향 병원 수', async () => {
    const world = await scenario();
    const auditBefore = world.repo.listAuditLog().length;
    world.world.clock.set('2026-10-18T11:00:00.000Z');

    expect((await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON })).status).toBe(200);

    const written = world.repo.listAuditLog().slice(auditBefore);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      action: 'BUNDLE_SUSPEND',
      target: `BUNDLE/${world.x}`,
      actorId: identityOf('rv-1').userId,
      role: 'RV',
      at: '2026-10-18T11:00:00.000Z',
      reason: REASON,
      beforeVersion: 'ACTIVE',
      afterVersion: 'SUSPENDED',
      affectedClinicCount: 2,
    });
  });

  it('게시만 하고 어느 병원에도 지정하지 않은 묶음을 중지하면 영향 병원은 빈 목록이고 감사 기록의 영향 병원 수는 0 이다', async () => {
    const world = await scenario();
    const z = await publishVia(world, world.x, approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_Z', T3, { scope: [{ generation: 'GEN1_AS', insurerType: 'LIFE' }] }));
    const response = await call(world.as('rv-1'), 'POST', suspendPath(z), { reason: REASON });
    expect(response.status).toBe(200);
    expect((await json(response)).affectedClinics).toEqual([]);
    expect(world.repo.listAuditLog().at(-1)).toMatchObject({ action: 'BUNDLE_SUSPEND', target: `BUNDLE/${z}`, affectedClinicCount: 0 });
    // X·Y 는 그대로 ACTIVE 이고 병원별 지정도 그대로다.
    expect(world.repo.getBundleStatus(world.x)).toBe('ACTIVE');
    expect(world.repo.getClinicRuleScope(CLINIC_A)?.ruleBundleVersionId).toBe(world.x);
  });

  it('Y 를 쓰는 C·D 는 Y 를 중지할 때만 영향 목록에 나온다 (X 를 중지할 때는 빠진다)', async () => {
    const world = await scenario();
    const response = await call(world.as('rv-1'), 'POST', suspendPath(world.y), { reason: REASON });
    expect(response.status).toBe(200);
    expect((await json(response)).affectedClinics).toEqual([
      { clinicId: CLINIC_C, slug: SLUG_C },
      { clinicId: CLINIC_D, slug: SLUG_D },
    ]);
    // X 는 그대로 ACTIVE, A·B 의 범위도 그대로.
    expect(world.repo.getBundleStatus(world.x)).toBe('ACTIVE');
    expect(world.repo.getClinicRuleScope(CLINIC_A)?.ruleBundleVersionId).toBe(world.x);
  });
});

describe('중지 직후: 기존 버전으로 계산해도 409 가 아니라 200 ON_HOLD / RULE_BUNDLE_SUSPENDED', () => {
  it('A·B 모두 같은 요청이 보류로 바뀌고 옵션은 SUSPENDED 를 가리키며, 범위 기록은 그대로다', async () => {
    const world = await scenario();
    const baselineA = await estimateOf(world, CLINIC_1_SLUG, world.x, [T1, T3]);
    expect(baselineA.status).toBe(200);
    expect(lineOf(baselineA, T1).state).toBe('ESTIMATED');
    const baselineB = await estimateOf(world, CLINIC_2_SLUG, world.x, [OTHER_CLINIC_TREATMENT_ID]);
    expect(baselineB.status).toBe(200);
    expect(holdReasons(baselineB)).not.toContain('RULE_BUNDLE_SUSPENDED');

    expect((await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON })).status).toBe(200);

    const a = await estimateOf(world, CLINIC_1_SLUG, world.x, [T1, T3]);
    const b = await estimateOf(world, CLINIC_2_SLUG, world.x, [OTHER_CLINIC_TREATMENT_ID]);
    for (const result of [a, b]) {
      expect(result.status).toBe(200);
      expect(result.body.result.state).toBe('ON_HOLD');
      expect(holdReasons(result)).toEqual(['RULE_BUNDLE_SUSPENDED']);
      expect(result.body.versions.ruleBundleVersion).toBe(world.x);
      expect(result.body.versions.ruleBundleStatus).toBe('SUSPENDED');
    }
    for (const slug of [CLINIC_1_SLUG, CLINIC_2_SLUG]) {
      expect((await optionsOf(world, slug)).body).toMatchObject({ ruleBundleVersion: world.x, ruleBundleStatus: 'SUSPENDED' });
    }
  });
});

describe('복구: PO 가 병원마다 정상 묶음으로 따로 재지정한다 (자동 교체도 되살리기도 없다)', () => {
  it('A 만 Y 로 재지정하면 A 만 계산이 복구되고, A 의 옛 버전(X) 요청은 409 VERSION_MISMATCH, B 는 계속 보류다', async () => {
    const world = await scenario();
    expect((await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON })).status).toBe(200);
    // 중지만으로는 아무 병원도 자동으로 옮겨지지 않았다.
    expect(world.repo.getClinicRuleScope(CLINIC_A)?.ruleBundleVersionId).toBe(world.x);
    expect(world.repo.getClinicRuleScope(CLINIC_B)?.ruleBundleVersionId).toBe(world.x);
    const scopeBefore = await json(await call(world.as('po-1'), 'GET', 'rule-scope'));
    expect(scopeBefore.clinics.map((clinic: Json) => [clinic.clinicId, clinic.current.bundleId, clinic.current.status])).toEqual([
      [CLINIC_A, world.x, 'SUSPENDED'],
      [CLINIC_B, world.x, 'SUSPENDED'],
      [CLINIC_C, world.y, 'ACTIVE'],
      [CLINIC_D, world.y, 'ACTIVE'],
    ]);
    expect(scopeBefore.bundles.map((bundle: Json) => [bundle.bundleId, bundle.status])).toEqual([
      [world.y, 'ACTIVE'],
      [world.x, 'SUSPENDED'],
    ]);
    const auditBefore = world.repo.listAuditLog().length;

    await assignVia(world, CLINIC_A, world.y, world.x);

    // A: 옵션이 정상 묶음을 가리키고, 옛 버전을 본 요청은 409, 새 버전 요청은 계산된다.
    expect((await optionsOf(world, CLINIC_1_SLUG)).body).toMatchObject({ ruleBundleVersion: world.y, ruleBundleStatus: 'ACTIVE' });
    const stale = await estimateOf(world, CLINIC_1_SLUG, world.x, [T1, T3]);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'VERSION_MISMATCH', latest: { ruleBundleVersion: world.y, ruleBundleStatus: 'ACTIVE' }, changes: { ruleChanged: true } });
    const recovered = await estimateOf(world, CLINIC_1_SLUG, world.y, [T1, T3]);
    expect(recovered.status).toBe(200);
    expect(lineOf(recovered, T1).state).toBe('ESTIMATED');
    expect(lineOf(recovered, T3).state).toBe('ESTIMATED');

    // B: 아직 X(중지) 그대로라서 같은 요청이 계속 보류다.
    expect(world.repo.getClinicRuleScope(CLINIC_B)?.ruleBundleVersionId).toBe(world.x);
    const stillHeld = await estimateOf(world, CLINIC_2_SLUG, world.x, [OTHER_CLINIC_TREATMENT_ID]);
    expect(stillHeld.status).toBe(200);
    expect(holdReasons(stillHeld)).toEqual(['RULE_BUNDLE_SUSPENDED']);

    // 재지정은 A 한 곳의 CLINIC_SCOPE_ASSIGN 한 건이다. X 는 끝까지 SUSPENDED 로 남는다.
    const written = world.repo.listAuditLog().slice(auditBefore);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ action: 'CLINIC_SCOPE_ASSIGN', target: `CLINIC/${CLINIC_A}`, beforeVersion: world.x, afterVersion: world.y, role: 'PO' });
    expect(world.repo.getBundleStatus(world.x)).toBe('SUSPENDED');
    expect(world.repo.listBundleStatusEvents(world.x).map((event) => event.status)).toEqual(['ACTIVE', 'SUSPENDED']);
  });
});

describe('PO 지정: 선택한 묶음이 ACTIVE 가 아니면 409 BUNDLE_NOT_ACTIVE 이고 저장 상태·감사 기록이 그대로다', () => {
  it('화면을 연 뒤(=묶음이 ACTIVE 로 보일 때) 중지된 묶음을 지정하려는 요청은 거절된다', async () => {
    const world = await scenario();
    // PO 의 화면은 중지 전에 열렸다: 병원 C 는 Y, X 는 ACTIVE 로 보였다. 그 사이 RV 가 X 를 중지한다.
    expect((await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON })).status).toBe(200);
    const before = world.state();

    const response = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_C}`, assignBody(world.x, world.y));

    expect([response.status, await json(response)]).toEqual([409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }]);
    expect(world.state()).toEqual(before);
    expect(world.repo.getClinicRuleScope(CLINIC_C)?.ruleBundleVersionId).toBe(world.y);
  });

  it('중지된 묶음을 쓰는 병원도 중지된 묶음 id 를 다시 지정하는 것은 거절된다 (같은 묶음 재지정 이력도 쓰이지 않는다)', async () => {
    const world = await scenario();
    expect((await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON })).status).toBe(200);
    const before = world.state();

    const response = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_A}`, assignBody(world.x, world.x));

    expect([response.status, await json(response)]).toEqual([409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }]);
    expect(world.state()).toEqual(before);
  });

  it('현재 범위가 맞지 않은 요청도 묶음이 중지됐으면 같은 사유로 거절된다 (묶음 가용성 확인이 범위 비교보다 앞선다)', async () => {
    const world = await scenario();
    expect((await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON })).status).toBe(200);
    const before = world.state();

    const response = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_C}`, assignBody(world.x, null));

    expect([response.status, await json(response)]).toEqual([409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }]);
    expect(world.state()).toEqual(before);
  });

  it('가용성 기록이 없는 묶음(게시 서비스를 거치지 않고 쓴 것)의 지정과 중지는 둘 다 409 BUNDLE_NOT_ACTIVE 이다', async () => {
    const world = await scenario();
    world.repo.putRuleBundleVersion(makeBundleVersion({ id: 'TEST_FIXTURE_BUNDLE_RAW', itemRefs: [...world.base.itemRefs] }));
    const before = world.state();

    const assign = await call(world.as('po-1'), 'POST', `rule-scope/clinics/${CLINIC_C}`, assignBody('TEST_FIXTURE_BUNDLE_RAW', world.y));
    expect([assign.status, await json(assign)]).toEqual([409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }]);
    const suspend = await call(world.as('rv-1'), 'POST', suspendPath('TEST_FIXTURE_BUNDLE_RAW'), { reason: REASON });
    expect([suspend.status, await json(suspend)]).toEqual([409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }]);
    expect(world.state()).toEqual(before);
  });

  it('정상(ACTIVE) 묶음의 지정은 그대로 된다 — 기존 미리보기 → 게시 → 지정 흐름은 바뀌지 않았다', async () => {
    const world = await scenario();
    const next = await publishVia(world, world.y, approvedMapping(world.world, 'TEST_FIXTURE_MAPPING_ADDED_T3_B', T3, { scope: [{ generation: 'GEN1_AS', insurerType: 'LIFE' }] }));
    await assignVia(world, CLINIC_C, next, world.y);
    expect(world.repo.getClinicRuleScope(CLINIC_C)?.ruleBundleVersionId).toBe(next);
  });
});

describe('중지 거절: 모두 저장 상태(감사 기록 포함)가 그대로다', () => {
  const DENIED: Array<[string, Who, number, Json]> = [
    ['인증 없음', null, 401, { error: 'UNAUTHENTICATED' }],
    ['병원 관리자(HA)', 'ha-clinic-1', 403, { error: 'FORBIDDEN' }],
    ['플랫폼 운영자(PO)', 'po-1', 403, { error: 'FORBIDDEN' }],
    ['플랫폼 단위 HA', PLATFORM_HA, 403, { error: 'FORBIDDEN' }],
    ['병원에 매인 RV', CLINIC_BOUND_RV, 403, { error: 'FORBIDDEN' }],
    ['병원에 매인 RV(시험 계정)', 'rv-clinic-1', 403, { error: 'FORBIDDEN' }],
  ];

  it.each(DENIED)('%s', async (_name, who, status, expected) => {
    const world = await scenario();
    const before = world.state();
    const response = await call(world.as(who), 'POST', suspendPath(world.x), { reason: REASON });
    expect([response.status, await json(response)]).toEqual([status, expected]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(world.state()).toEqual(before);
    expect(world.repo.getBundleStatus(world.x)).toBe('ACTIVE');
  });

  it('권한 확인이 본문 검사와 묶음 존재 확인보다 앞선다 (권한이 없으면 깨진 본문·없는 묶음도 403)', async () => {
    const world = await scenario();
    const before = world.state();
    expect((await callRaw(world.as('po-1'), 'POST', suspendPath(world.x), '{not json')).status).toBe(403);
    expect((await call(world.as('po-1'), 'POST', suspendPath('TEST_FIXTURE_NO_SUCH_BUNDLE'), { reason: '' })).status).toBe(403);
    expect(world.state()).toEqual(before);
  });

  it.each([
    ['빈 문자열', { reason: '' }, [{ code: 'EMPTY', path: 'reason' }]],
    ['공백뿐', { reason: '   ' }, [{ code: 'EMPTY', path: 'reason' }]],
    ['탭·줄바꿈뿐', { reason: '\t\n \r' }, [{ code: 'EMPTY', path: 'reason' }]],
    ['사유 키 없음', {}, [{ code: 'VALUE_MISSING', path: 'reason' }]],
    ['사유 null', { reason: null }, [{ code: 'VALUE_MISSING', path: 'reason' }]],
    ['사유가 숫자', { reason: 123 }, [{ code: 'VALUE_INVALID', path: 'reason' }]],
    ['알 수 없는 키', { reason: REASON, actor: 'x' }, [{ code: 'UNKNOWN_FIELD', path: 'request.actor' }]],
    ['묶음 id 를 본문으로', { reason: REASON, bundleId: 'x' }, [{ code: 'UNKNOWN_FIELD', path: 'request.bundleId' }]],
  ])('사유 문제 · %s → 400 INVALID_REQUEST', async (_name, body, defects) => {
    const world = await scenario();
    const before = world.state();
    const response = await call(world.as('rv-1'), 'POST', suspendPath(world.x), body);
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects });
    expect(world.state()).toEqual(before);
    expect(world.repo.getBundleStatus(world.x)).toBe('ACTIVE');
  });

  it('본문이 JSON 이 아니거나 객체가 아니면 400', async () => {
    const world = await scenario();
    const before = world.state();
    const notJson = await callRaw(world.as('rv-1'), 'POST', suspendPath(world.x), '{not json');
    expect([notJson.status, (await json(notJson)).defects]).toEqual([400, [{ code: 'NOT_JSON', path: 'request' }]]);
    const notObject = await call(world.as('rv-1'), 'POST', suspendPath(world.x), [REASON]);
    expect([notObject.status, (await json(notObject)).defects]).toEqual([400, [{ code: 'NOT_OBJECT', path: 'request' }]]);
    expect(world.state()).toEqual(before);
  });

  it('없는 묶음은 404, 메서드가 다르면 405 이다', async () => {
    const world = await scenario();
    const before = world.state();
    const missing = await call(world.as('rv-1'), 'POST', suspendPath('TEST_FIXTURE_NO_SUCH_BUNDLE'), { reason: REASON });
    expect([missing.status, await json(missing)]).toEqual([404, { error: 'NOT_FOUND' }]);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect((await call(world.as('rv-1'), method, suspendPath(world.x), method === 'GET' ? undefined : {})).status, method).toBe(405);
    }
    expect(world.state()).toEqual(before);
  });

  it('이미 중지된 묶음을 다시 중지하면 409 BUNDLE_NOT_ACTIVE 이고 두 번째 기록도 감사 기록도 쓰이지 않는다', async () => {
    const world = await scenario();
    expect((await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON })).status).toBe(200);
    const before = world.state();

    const again = await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: '다시 중지' });
    const otherRv = await call(world.as('rv-2'), 'POST', suspendPath(world.x), { reason: '다른 RV 의 중지' });

    expect([again.status, await json(again)]).toEqual([409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }]);
    expect([otherRv.status, await json(otherRv)]).toEqual([409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }]);
    expect(world.state()).toEqual(before);
    expect(world.repo.listBundleStatusEvents(world.x)).toHaveLength(2);
  });

  it('되살리기·자동 교체·병원 하나만 즉시 멈추는 경로는 없다 (모두 404 이고 저장 상태가 그대로다)', async () => {
    const world = await scenario();
    expect((await call(world.as('rv-1'), 'POST', suspendPath(world.x), { reason: REASON })).status).toBe(200);
    const before = world.state();
    const paths: Array<[string, Who, string]> = [
      ['되살리기', 'rv-1', `rule-bundles/${world.x}/activate`],
      ['재활성화', 'rv-1', `rule-bundles/${world.x}/resume`],
      ['자동 교체', 'rv-1', `rule-bundles/${world.x}/replace`],
      ['병원 긴급 중지(병원 경로)', 'ha-clinic-1', `clinics/${CLINIC_A}/suspend`],
      ['병원 긴급 중지(범위 경로)', 'po-1', `rule-scope/clinics/${CLINIC_A}/suspend`],
      ['병원 긴급 중지(RV)', 'rv-1', `clinics/${CLINIC_A}/rule-bundle/suspend`],
    ];
    for (const [name, who, path] of paths) {
      expect((await call(world.as(who), 'POST', path, { reason: REASON })).status, name).toBe(404);
    }
    expect(world.state()).toEqual(before);
    expect(world.repo.getBundleStatus(world.x)).toBe('SUSPENDED');
  });
});
