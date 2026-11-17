import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import type { AdminIdentity } from '../../src/server/admin/auth';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { CHANGE_HISTORY_ACTIONS } from '../../src/server/change-history';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { TEST_ACCOUNTS, adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, T1 } from '../fixtures/server/base-fee.fixture';
import { addThirdTreatment } from '../fixtures/server/catalog-structure.fixture';
import { makeAuditEntry } from '../fixtures/server/entities.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';

// 병원 관리자 변경 이력 조회 (M7 변경 이력): HA GET /api/admin/audit-log. 모두 handleAdmin(실제 관리자 핸들러)과 공개 핸들러를 지난다.
// 병원은 요청이 정하지 않는다: 서버가 검증한 신원의 HA 소속 병원 하나다. 이 자원은 쿼리·헤더·본문을 읽지 않는다.
// 세계: 병원 1(치료 셋, 기본비용 5,000원)·병원 2. 병원 1 의 HA 가 실제 흐름(초안 저장·폐기·게시, 무조작 정책 저장)을 지나 기록을 만들고 병원 2 의 HA 도 자기 기록을 만든다.

const BASE = 'http://localhost/api/admin';
const CLINIC_1 = TEST_FIXTURE_CLINIC_ID;
const CLINIC_2 = OTHER_CLINIC_ID;
const PREVIEW_BODY = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type Who = TestAccountKey | AdminIdentity | null;

function setup() {
  const built = buildWorld();
  publishSecondClinicCatalog(built.world);
  addThirdTreatment(built.world);
  const { world } = built;
  const as = (who: Who) => adminServicesOf(world, { authenticator: staticAuthenticator(who === null ? null : typeof who === 'string' ? identityOf(who) : who) }).admin;
  const api = adminServicesOf(world, { authenticator: staticAuthenticator(null) }).api;
  return { ...built, repo: world.repo, as, api, state: () => world.repo.exportState() };
}

type Setup = ReturnType<typeof setup>;
type Admin = ReturnType<Setup['as']>;

const segmentsOf = (value: string): string[] => value.split('/').filter((part) => part !== '').map(decodeURIComponent);

function call(admin: Admin, method: string, target: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: body === undefined ? {} : { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleAdmin(admin, new Request(`${BASE}/${target}`, init), segmentsOf(target.split('?')[0]!));
}

const json = async (response: Response): Promise<Json> => (await response.json()) as Json;
const history = (admin: Admin): Promise<Response> => call(admin, 'GET', 'audit-log');
const historyOf = async (world: Setup, who: Who): Promise<Json> => json(await history(world.as(who)));

// ── 실제 흐름으로 기록을 만든다 (병원 경로 API) ──
const draftPath = (clinic: string): string => `clinics/${clinic}/catalog/draft`;

async function saveDraft(world: Setup, who: Who, clinic: string, body: unknown): Promise<Json> {
  const response = await call(world.as(who), 'PUT', draftPath(clinic), body);
  expect(response.status).toBe(200);
  return json(response);
}

async function previewConfirmation(world: Setup, who: Who, clinic: string, treatmentIds: string[]): Promise<string> {
  const response = await call(world.as(who), 'POST', `clinics/${clinic}/catalog/preview`, { ...PREVIEW_BODY, treatmentIds });
  expect(response.status).toBe(200);
  return (await json(response)).publishConfirmation as string;
}

async function saveIdle(world: Setup, who: Who, clinic: string, completionHoldSeconds: number | null): Promise<void> {
  const digest = (await json(await call(world.as(who), 'GET', `clinics/${clinic}/idle-policy`))).policyDigest as string;
  const response = await call(world.as(who), 'PUT', `clinics/${clinic}/idle-policy`, { screens: {}, completionHoldSeconds, expectedDigest: digest });
  expect(response.status).toBe(200);
}

/** 병원 1 HA: 저장 → 저장 → 폐기 → 저장 → 미리보기 → 게시 → 무조작 정책 저장. 병원 2 HA: 자기 초안 저장·무조작 정책 저장을 사이사이에 넣는다. */
async function runFlows(world: Setup) {
  const feeSaved = await saveDraft(world, 'ha-clinic-1', CLINIC_1, { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 6_000 }] });
  await saveDraft(world, 'ha-clinic-2', CLINIC_2, { priceEdits: [{ treatmentId: OTHER_CLINIC_TREATMENT_ID, patientAmount: 34_000 }] });
  await saveDraft(world, 'ha-clinic-1', CLINIC_1, { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 7_000 }], priceEdits: [{ treatmentId: T1, patientAmount: 11_000 }] });
  expect((await call(world.as('ha-clinic-1'), 'DELETE', draftPath(CLINIC_1))).status).toBe(200);
  await saveIdle(world, 'ha-clinic-2', CLINIC_2, 90);
  const finalDraft = await saveDraft(world, 'ha-clinic-1', CLINIC_1, { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 7_000 }] });
  // 게시 전에 초안 revision 과 게시 확인값을 붙잡아 둔다: 이 값들이 이력 응답에 없어야 한다.
  const revision = world.repo.getCatalogDraft(CLINIC_1)!.revision;
  const confirmation = await previewConfirmation(world, 'ha-clinic-1', CLINIC_1, [T1]);
  const versionsBefore = ((await json(await call(world.as('ha-clinic-1'), 'GET', `clinics/${CLINIC_1}/catalog/versions`))).versions as Json[]).map((version) => version.id as string);
  const published = await call(world.as('ha-clinic-1'), 'POST', `clinics/${CLINIC_1}/catalog/publish`, { publishConfirmation: confirmation });
  expect(published.status).toBe(200);
  const publishedVersion = (await json(published)).catalogVersion as string;
  await saveIdle(world, 'ha-clinic-1', CLINIC_1, 45);
  await saveIdle(world, 'ha-clinic-2', CLINIC_2, 120);
  return { feeSaved, finalDraft, revision, confirmation, previousVersion: versionsBefore[0]!, publishedVersion };
}

const NEWEST_FIRST_CLINIC_1 = ['IDLE_POLICY_SAVE', 'CATALOG_DRAFT_PUBLISH', 'CATALOG_DRAFT_SAVE', 'CATALOG_DRAFT_DISCARD', 'CATALOG_DRAFT_SAVE', 'CATALOG_DRAFT_SAVE'];

describe('인증·권한 (저장소는 읽기 전에 거절한다)', () => {
  it('인증 없음은 401 이고 메서드가 틀려도 인증이 먼저다', async () => {
    const world = setup();
    const before = world.state();
    const response = await history(world.as(null));
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: 'UNAUTHENTICATED' });
    expect((await call(world.as(null), 'POST', 'audit-log', {})).status).toBe(401);
    expect(world.state()).toEqual(before);
  });

  const OUT_OF_SCOPE: Array<[string, Who]> = [
    ['검토 담당자(RV, 플랫폼 단위)', 'rv-1'],
    ['둘째 검토 담당자(RV)', 'rv-2'],
    ['병원에 매인 검토 담당자(RV)', 'rv-clinic-1'],
    ['플랫폼 운영자(PO)', 'po-1'],
    ['병원에 매이지 않은 HA 소속', { userId: 'TEST_FIXTURE_HA_PLATFORM', memberships: [{ clinicId: null, role: 'HA' }] }],
    ['소속이 하나도 없는 신원', { userId: 'TEST_FIXTURE_NOBODY', memberships: [] }],
    ['RV 와 PO 를 함께 가진 신원', { userId: 'TEST_FIXTURE_RV_PO', memberships: [{ clinicId: null, role: 'RV' }, { clinicId: null, role: 'PO' }] }],
  ];
  for (const [label, who] of OUT_OF_SCOPE) {
    it(`이번 조회 범위 밖 역할은 403 이다: ${label}`, async () => {
      const world = setup();
      await runFlows(world);
      const before = world.state();
      const response = await history(world.as(who));
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: 'FORBIDDEN' });
      expect(world.state()).toEqual(before);
    });
  }

  it('HA 소속에 RV·PO 소속이 더해져도 볼 수 있는 것은 HA 소속 병원의 이력뿐이다', async () => {
    const world = setup();
    await runFlows(world);
    const mixed: AdminIdentity = { userId: 'TEST_FIXTURE_HA_AND_RV', memberships: [{ clinicId: null, role: 'RV' }, { clinicId: CLINIC_1, role: 'HA' }, { clinicId: null, role: 'PO' }] };
    const body = await historyOf(world, mixed);
    expect(body.clinic.id).toBe(CLINIC_1);
    expect(body.entries.map((entry: Json) => entry.action)).toEqual(NEWEST_FIRST_CLINIC_1);
  });

  it('병원에 매인 HA 소속이 둘 이상이면 병원을 하나로 정할 수 없어 409 이다. 같은 병원을 두 번 적은 소속은 하나로 본다', async () => {
    const world = setup();
    await runFlows(world);
    const before = world.state();
    const two: AdminIdentity = { userId: 'TEST_FIXTURE_HA_TWO', memberships: [{ clinicId: CLINIC_1, role: 'HA' }, { clinicId: CLINIC_2, role: 'HA' }] };
    const response = await history(world.as(two));
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'CLINIC_AMBIGUOUS' });
    expect(world.state()).toEqual(before);
    const duplicated: AdminIdentity = { userId: 'TEST_FIXTURE_HA_DUP', memberships: [{ clinicId: CLINIC_1, role: 'HA' }, { clinicId: CLINIC_1, role: 'HA' }] };
    expect((await history(world.as(duplicated))).status).toBe(200);
  });

  it('소속 병원이 없으면 404 이다 (다른 병원의 존재는 알리지 않는다)', async () => {
    const world = setup();
    const ghost: AdminIdentity = { userId: 'TEST_FIXTURE_HA_GHOST', memberships: [{ clinicId: 'TEST_FIXTURE_CLINIC_GHOST', role: 'HA' }] };
    const response = await history(world.as(ghost));
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: 'NOT_FOUND' });
  });

  it('읽기 전용 자원이다: GET 이 아닌 메서드는 405 이고 하위 경로는 404 이며 저장소는 그대로다', async () => {
    const world = setup();
    await runFlows(world);
    const before = world.state();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await call(world.as('ha-clinic-1'), method, 'audit-log', method === 'DELETE' ? undefined : { action: 'X' });
      expect(response.status, method).toBe(405);
      expect(await json(response)).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    }
    for (const target of ['audit-log/1', 'audit-log/entries', `clinics/${CLINIC_1}/audit-log`]) {
      expect((await call(world.as('ha-clinic-1'), 'GET', target)).status, target).toBe(404);
    }
    expect(world.state()).toEqual(before);
  });
});

describe('실제 흐름의 기록이 이력에 나타난다', () => {
  it('저장·폐기·게시·무조작 정책 저장이 최신순으로 한 줄씩 나오고, 초안 게시는 한 줄이다 (안쪽 CATALOG_PUBLISH 는 싣지 않는다)', async () => {
    const world = setup();
    const flows = await runFlows(world);
    const response = await history(world.as('ha-clinic-1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as Json;
    expect(Object.keys(body).sort()).toEqual(['clinic', 'coveredActions', 'entries', 'page']);
    expect(body.clinic).toEqual({ id: CLINIC_1, displayName: expect.any(String) });
    expect(body.coveredActions).toEqual([...CHANGE_HISTORY_ACTIONS]);
    expect(body.entries.map((entry: Json) => entry.action)).toEqual(NEWEST_FIRST_CLINIC_1);
    expect(body.entries.map((entry: Json) => entry.sequence)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(body.page).toEqual({ limit: 100, returned: 6, total: 6, truncated: false });
    // 안쪽 게시 기록은 저장소에는 있지만 이력에는 없다.
    expect(world.repo.listAuditLog().some((entry) => entry.action === 'CATALOG_PUBLISH' && entry.afterVersion === flows.publishedVersion)).toBe(true);
    expect(body.entries.some((entry: Json) => entry.action === 'CATALOG_PUBLISH')).toBe(false);
    for (const entry of body.entries as Json[]) {
      expect(Object.keys(entry).sort()).toEqual(['action', 'actor', 'afterVersion', 'at', 'beforeVersion', 'reason', 'sequence', 'target']);
      expect(entry.actor).toEqual({ id: TEST_ACCOUNTS['ha-clinic-1'].userId, role: 'HA' });
      expect(typeof entry.at).toBe('string');
    }
  });

  it('항목마다 기록된 대상·이전/이후 버전·사유가 그대로다', async () => {
    const world = setup();
    const flows = await runFlows(world);
    const entries = (await historyOf(world, 'ha-clinic-1')).entries as [Json, Json, Json, Json, Json, Json];
    const [idle, published, lastSave, discard, secondSave, firstSave] = entries;
    expect(idle).toMatchObject({ action: 'IDLE_POLICY_SAVE', target: `CLINIC/${CLINIC_1}/IDLE_POLICY`, reason: null });
    expect(idle.afterVersion).toMatch(/^[0-9a-f]{64}$/);
    // 게시: 이전/이후는 이 병원의 카탈로그 버전 id 이고 사유는 게시한 초안의 내용 지문을 가리킨다.
    expect(published).toMatchObject({ action: 'CATALOG_DRAFT_PUBLISH', target: `CATALOG/${flows.publishedVersion}`, beforeVersion: flows.previousVersion, afterVersion: flows.publishedVersion, reason: `DRAFT_OF:${flows.finalDraft.draft.draftDigest}` });
    // 저장·폐기: 이전/이후는 초안 내용 지문이다.
    expect(lastSave).toMatchObject({ action: 'CATALOG_DRAFT_SAVE', target: `CATALOG_DRAFT/${CLINIC_1}`, beforeVersion: null, afterVersion: flows.finalDraft.draft.draftDigest });
    expect(discard).toMatchObject({ action: 'CATALOG_DRAFT_DISCARD', target: `CATALOG_DRAFT/${CLINIC_1}`, afterVersion: null });
    expect(discard.beforeVersion).toBe(secondSave.afterVersion);
    expect(secondSave.beforeVersion).toBe(firstSave.afterVersion);
    expect(firstSave).toMatchObject({ beforeVersion: null, afterVersion: flows.feeSaved.draft.draftDigest });
  });

  it('병원 2 의 HA 는 병원 2 의 기록만 본다. 병원 1 의 기록이 합계·번호에 들어가지 않는다', async () => {
    const world = setup();
    await runFlows(world);
    const body = await historyOf(world, 'ha-clinic-2');
    expect(body.clinic.id).toBe(CLINIC_2);
    expect(body.entries.map((entry: Json) => [entry.sequence, entry.action, entry.target])).toEqual([
      [3, 'IDLE_POLICY_SAVE', `CLINIC/${CLINIC_2}/IDLE_POLICY`],
      [2, 'IDLE_POLICY_SAVE', `CLINIC/${CLINIC_2}/IDLE_POLICY`],
      [1, 'CATALOG_DRAFT_SAVE', `CATALOG_DRAFT/${CLINIC_2}`],
    ]);
    expect(body.entries.every((entry: Json) => entry.actor.id === TEST_ACCOUNTS['ha-clinic-2'].userId)).toBe(true);
    expect(body.page).toEqual({ limit: 100, returned: 3, total: 3, truncated: false });
    // 전제: 저장소의 허용 동작 기록은 두 병원 것을 합쳐 더 많다.
    expect(world.repo.listAuditLog().filter((entry) => (CHANGE_HISTORY_ACTIONS as readonly string[]).includes(entry.action)).length).toBe(9);
  });

  it('기록이 하나도 없는 병원은 빈 목록과 0건을 낸다', async () => {
    const world = setup();
    const body = await historyOf(world, 'ha-clinic-1');
    expect(body.entries).toEqual([]);
    expect(body.page).toEqual({ limit: 100, returned: 0, total: 0, truncated: false });
  });
});

describe('조작한 조회 조건과 소유 불명 기록은 결과를 바꾸지 못한다', () => {
  it('쿼리·헤더·쿠키·인증 헤더로 다른 병원·다른 역할·다른 사용자를 가장해도 응답이 한 글자도 다르지 않다', async () => {
    const world = setup();
    await runFlows(world);
    const baseline = await (await history(world.as('ha-clinic-1'))).text();
    const forged = [
      { query: `?clinicId=${CLINIC_2}`, headers: {} },
      { query: `?clinic=${CLINIC_2}&slug=test-fixture-clinic-2&limit=1&before=3&role=PO&actor=TEST_FIXTURE_HA_CLINIC_2`, headers: {} },
      { query: '', headers: { 'x-clinic-id': CLINIC_2, 'x-role': 'PO', 'x-user-id': TEST_ACCOUNTS['ha-clinic-2'].userId } },
      { query: '', headers: { authorization: 'Bearer forged', cookie: 'bodam_test_session=TEST_FIXTURE_SESSION_999_ha-clinic-2; role=PO', 'x-forwarded-user': 'po-1', 'x-http-method-override': 'POST' } },
      { query: `?clinicId=${CLINIC_2}&role=HA`, headers: { 'x-clinic-id': CLINIC_2, 'x-role': 'HA' } },
    ];
    for (const attempt of forged) {
      const request = new Request(`${BASE}/audit-log${attempt.query}`, { method: 'GET', headers: attempt.headers });
      const response = await handleAdmin(world.as('ha-clinic-1'), request, ['audit-log']);
      expect(response.status, attempt.query).toBe(200);
      expect(await response.text(), attempt.query).toBe(baseline);
    }
  });

  it('권한이 없는 신원은 조작한 값으로도 열 수 없다 (RV·PO·인증 없음)', async () => {
    const world = setup();
    await runFlows(world);
    const forgedHeaders = { 'x-clinic-id': CLINIC_1, 'x-role': 'HA', authorization: 'Bearer HA', cookie: 'role=HA' };
    for (const [who, status] of [['rv-1', 403], ['po-1', 403], [null, 401]] as const) {
      const request = new Request(`${BASE}/audit-log?clinicId=${CLINIC_1}&role=HA`, { method: 'GET', headers: forgedHeaders });
      const response = await handleAdmin(world.as(who), request, ['audit-log']);
      expect(response.status, String(who)).toBe(status);
      expect(JSON.stringify(await response.json())).not.toContain(CLINIC_1);
    }
  });

  it('소유를 확인할 수 없는 기록(없는 병원·없는 카탈로그·어긋난 버전·모양이 다른 대상)을 저장소에 더해도 이력도 합계도 그대로다', async () => {
    const world = setup();
    await runFlows(world);
    const baseline = await (await history(world.as('ha-clinic-1'))).text();
    const baseline2 = await (await history(world.as('ha-clinic-2'))).text();
    const current1 = world.repo.getClinicCurrentCatalogVersion(CLINIC_1)!.id;
    const current2 = world.repo.getClinicCurrentCatalogVersion(CLINIC_2)!.id;
    const crafted = [
      { action: 'CATALOG_DRAFT_SAVE', target: 'CATALOG_DRAFT/TEST_FIXTURE_CLINIC_GHOST' },
      { action: 'IDLE_POLICY_SAVE', target: 'CLINIC/TEST_FIXTURE_CLINIC_GHOST/IDLE_POLICY' },
      { action: 'CATALOG_DRAFT_SAVE', target: `CATALOG_DRAFT/${CLINIC_1}/extra` },
      { action: 'CATALOG_DRAFT_DISCARD', target: `catalog_draft/${CLINIC_1}` },
      { action: 'IDLE_POLICY_SAVE', target: `CLINIC/${CLINIC_1}/IDLE_POLICY ` },
      { action: 'CATALOG_DRAFT_PUBLISH', target: `CATALOG/${current1}`, beforeVersion: current2, afterVersion: current1 },
      { action: 'CATALOG_DRAFT_PUBLISH', target: `CATALOG/${current1}`, beforeVersion: null, afterVersion: current2 },
      { action: 'CATALOG_DRAFT_PUBLISH', target: 'CATALOG/TEST_FIXTURE_CATALOG_GHOST', beforeVersion: null, afterVersion: 'TEST_FIXTURE_CATALOG_GHOST' },
      { action: 'CATALOG_PUBLISH', target: `CATALOG/${current1}`, beforeVersion: null, afterVersion: current1 },
      { action: 'BUNDLE_SUSPEND', target: `CLINIC/${CLINIC_1}/IDLE_POLICY` },
    ];
    crafted.forEach((entry, index) => world.repo.appendAuditLog(makeAuditEntry({ id: `TEST_FIXTURE_AUDIT_CRAFTED_${index}`, role: 'HA', ...entry } as Parameters<typeof makeAuditEntry>[0])));
    expect(await (await history(world.as('ha-clinic-1'))).text()).toBe(baseline);
    expect(await (await history(world.as('ha-clinic-2'))).text()).toBe(baseline2);
  });

  it('시각이 같은 기록도 저장 순서로 갈린다 (시계가 멈춰 있는 세계의 실제 흐름)', async () => {
    const world = setup();
    await runFlows(world);
    const entries = (await historyOf(world, 'ha-clinic-1')).entries as Json[];
    // 시험 시계는 스스로 흐르지 않아 모든 기록의 시각이 같다.
    expect(new Set(entries.map((entry) => entry.at)).size).toBe(1);
    expect(entries.map((entry) => entry.sequence)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(entries.map((entry) => entry.action)).toEqual(NEWEST_FIRST_CLINIC_1);
  });
});

describe('읽기 전용이고 비밀을 싣지 않는다', () => {
  it('조회 전후 저장소 전체(감사 기록 포함)와 공개 카탈로그·계산 결과가 같다. 여러 번 읽어도 같은 응답이다', async () => {
    const world = setup();
    await runFlows(world);
    const publicCatalogText = async (): Promise<string> => (await handleCatalog(world.api, CLINIC_1_SLUG)).text();
    const publicEstimateText = async (): Promise<string> => {
      const catalog = JSON.parse(await publicCatalogText()) as Json;
      const response = await handleEstimate(world.api, CLINIC_1_SLUG, () =>
        Promise.resolve({ catalogVersion: catalog.catalogVersion, ruleBundleVersion: world.bundle!.id, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [T1] }),
      );
      return response.text();
    };
    const before = { state: world.state(), audit: world.repo.listAuditLog(), catalog: await publicCatalogText(), estimate: await publicEstimateText() };
    const first = await (await history(world.as('ha-clinic-1'))).text();
    const second = await (await history(world.as('ha-clinic-1'))).text();
    await history(world.as('ha-clinic-2'));
    expect(second).toBe(first);
    expect(world.state()).toEqual(before.state);
    expect(world.repo.listAuditLog()).toEqual(before.audit);
    expect(await publicCatalogText()).toBe(before.catalog);
    expect(await publicEstimateText()).toBe(before.estimate);
  });

  it('응답에 초안 revision·게시 확인값·인증 정보·감사 기록 id 가 없다', async () => {
    const world = setup();
    const flows = await runFlows(world);
    const text = await (await history(world.as('ha-clinic-1'))).text();
    const forbidden = [flows.revision, flows.confirmation, 'revision', 'publishConfirmation', 'memberships', 'bodam_test_session', 'authorization', 'TEST_FIXTURE_AUDIT_', 'TEST_FIXTURE_SESSION_'];
    for (const value of forbidden) {
      expect(text, value).not.toContain(value);
    }
    // 병원 2 의 흔적도 없다.
    expect(text).not.toContain(CLINIC_2);
    expect(text).not.toContain(TEST_ACCOUNTS['ha-clinic-2'].userId);
  });

  it('조회가 부르는 저장소 쓰기는 없다: 쓰기 메서드를 부르면 던지는 저장소 위에서도 같은 응답이 나온다', async () => {
    const world = setup();
    await runFlows(world);
    const expected = await (await history(world.as('ha-clinic-1'))).text();
    const writes = ['appendAuditLog', 'saveClinic', 'saveCatalogDraft', 'closeCatalogDraft', 'putCatalogVersion', 'saveIdlePolicy', 'putTreatmentVersion', 'putCommonBaseFee', 'saveTreatment', 'transaction'];
    const guarded = new Proxy(world.repo, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== 'function') return value;
        if (writes.includes(String(property))) {
          return () => {
            throw new Error(`조회가 저장소 쓰기를 불렀다: ${String(property)}`);
          };
        }
        return (...args: unknown[]) => (value as (...rest: unknown[]) => unknown).apply(target, args);
      },
    });
    const identity = identityOf('ha-clinic-1');
    const services = adminServicesOf({ ...world.world, repo: guarded, deps: { ...world.world.deps, repo: guarded } }, { authenticator: staticAuthenticator(identity) }).admin;
    const response = await history(services);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected);
  });
});
