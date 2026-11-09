import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { publishCatalog } from '../../src/server/catalog-publish';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1 } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, T1, T2 } from '../fixtures/server/base-fee.fixture';
import { T3, addThirdTreatment, additionBody, changedKeys, repoThrowingOn } from '../fixtures/server/catalog-structure.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import type { MemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';

// 관리자 API: 숨긴 치료 다시 표시 (M7). 모두 handleAdmin(관리자)·handleCatalog·handleEstimate(공개 키오스크 경로)를 지난다.
// 세계: 병원 1 에 치료 셋(T1·T2·T3, 표시 순서 T1·T2·T3)과 공통 기본비용·승인된 매핑(T1·T2)·게시된 규칙 묶음. T3 에는 승인된 매핑이 없다(NEEDS_REVIEW). 병원 2 는 따로 있다.
// 모든 숨김은 실제 경로(초안 저장 → 미리보기 → 게시)로 하고, 저장소에 active 를 직접 쓰는 길은 "범위 밖 변경" 시험에서만 쓴다.

const BASE = 'http://localhost/api/admin';
const CLINIC = `clinics/${TEST_FIXTURE_CLINIC_ID}`;
const OTHER = `clinics/${OTHER_CLINIC_ID}`;
const NOT_ISSUED = 'a'.repeat(64);
const PREVIEW_BODY = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const ADDED_1 = 'TEST_FIXTURE_ADDED_TREATMENT_1';
const A = 'NEW_A';

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type AdminOf = ReturnType<typeof adminServicesOf>['admin'];

function call(admin: AdminOf, method: string, path: string, body?: unknown): Promise<Response> {
  const segments = path.split('/').filter((part) => part !== '').map(decodeURIComponent);
  const init: RequestInit = { method, headers: body === undefined ? {} : { 'content-type': 'application/json' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return handleAdmin(admin, new Request(`${BASE}/${path}`, init), segments);
}

const json = async (response: Response): Promise<Json> => (await response.json()) as Json;

function setup(account: TestAccountKey | null, options: { wrapRepo?: (repo: MemoryRepository) => MemoryRepository } = {}) {
  const built = buildWorld();
  publishSecondClinicCatalog(built.world);
  addThirdTreatment(built.world);
  const wrapped = options.wrapRepo === undefined ? built.world.repo : options.wrapRepo(built.world.repo);
  const world: World = { ...built.world, repo: wrapped, deps: { ...built.world.deps, repo: wrapped } };
  const services = adminServicesOf(world, { authenticator: staticAuthenticator(account === null ? null : identityOf(account)) });
  return { ...built, ...services };
}

type Setup = ReturnType<typeof setup>;

const putDraft = (admin: AdminOf, body: unknown): Promise<Response> => call(admin, 'PUT', `${CLINIC}/catalog/draft`, body);
const previewOf = (admin: AdminOf, body: unknown = PREVIEW_BODY): Promise<Response> => call(admin, 'POST', `${CLINIC}/catalog/preview`, body);
const publish = (admin: AdminOf, body: unknown): Promise<Response> => call(admin, 'POST', `${CLINIC}/catalog/publish`, body);
const treatmentsOf = async (admin: AdminOf): Promise<Json> => json(await call(admin, 'GET', `${CLINIC}/treatments`));

async function previewConfirmation(admin: AdminOf, body: unknown = PREVIEW_BODY): Promise<string> {
  const response = await previewOf(admin, body);
  expect(response.status).toBe(200);
  return (await json(response)).publishConfirmation as string;
}

const publicCatalog = async (world: Setup): Promise<Json> => json(await handleCatalog(world.api, CLINIC_1_SLUG));
const publicOrder = async (world: Setup): Promise<Array<[string, number, number]>> =>
  (await publicCatalog(world)).treatments.map((row: Json) => [row.treatmentId, row.patientAmount, row.order]);

async function publicEstimate(world: Setup, treatmentIds: string[]): Promise<{ status: number; body: Json }> {
  const catalogVersion = (await publicCatalog(world)).catalogVersion as string;
  const response = await handleEstimate(world.api, CLINIC_1_SLUG, () =>
    Promise.resolve({ catalogVersion, ruleBundleVersion: world.bundle!.id, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds }),
  );
  return { status: response.status, body: await json(response) };
}

/** 실제 경로(저장 → 미리보기 → 게시)로 치료를 숨긴다. */
async function hide(world: Setup, ids: string[]): Promise<void> {
  expect((await putDraft(world.admin, { deactivations: ids })).status).toBe(200);
  expect((await publish(world.admin, { publishConfirmation: await previewConfirmation(world.admin) })).status).toBe(200);
}

const activeOf = (world: Setup, id: string): boolean => world.world.repo.getTreatment(id)!.active;

describe('숨김 목록 조회: GET treatments 의 hiddenTreatments', () => {
  it('숨긴 치료가 없으면 빈 목록이고, 숨기고 게시하면 그 치료가 예전 표시 순서로 나온다. 표시 중인 목록과 공개 목록에는 없다', async () => {
    const world = setup('ha-clinic-1');
    expect((await treatmentsOf(world.admin)).hiddenTreatments).toEqual([]);

    await hide(world, [T2]);
    const list = await treatmentsOf(world.admin);
    expect(list.hiddenTreatments).toHaveLength(1);
    expect(list.hiddenTreatments[0]).toMatchObject({ treatmentId: T2, patientAmount: 10_000, order: 1 });
    expect(Object.keys(list.hiddenTreatments[0]).sort()).toEqual(Object.keys(list.treatments[0]).sort()); // 표시 중인 치료 한 줄과 같은 모양
    expect(list.treatments.map((row: Json) => row.treatmentId)).toEqual([T1, T3]);
    expect(JSON.stringify(await publicCatalog(world))).not.toContain(T2);
    expect(JSON.stringify(await publicCatalog(world))).not.toContain('hiddenTreatments');
  });

  it('여러 개는 예전 표시 순서(sortOrder, 같으면 치료 id)다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T3, T2]);
    expect((await treatmentsOf(world.admin)).hiddenTreatments.map((row: Json) => row.treatmentId)).toEqual([T2, T3]);
  });

  it('다른 병원의 숨긴 치료는 나오지 않고, 다른 병원 관리자는 자기 병원 것만 본다', async () => {
    const world = setup('ha-clinic-1');
    world.world.repo.saveTreatment({ ...world.world.repo.getTreatment(OTHER_CLINIC_TREATMENT_ID)!, active: false }); // 병원 2 의 숨긴 치료(범위 밖 변경)
    await hide(world, [T2]);
    expect(JSON.stringify((await treatmentsOf(world.admin)).hiddenTreatments)).not.toContain(OTHER_CLINIC_TREATMENT_ID);

    const other = setup('ha-clinic-2');
    other.world.repo.saveTreatment({ ...other.world.repo.getTreatment(OTHER_CLINIC_TREATMENT_ID)!, active: false });
    const list = await json(await call(other.admin, 'GET', `${OTHER}/treatments`));
    expect(list.hiddenTreatments.map((row: Json) => row.treatmentId)).toEqual([OTHER_CLINIC_TREATMENT_ID]);
    expect(JSON.stringify(list)).not.toContain(T1);
  });

  it('현재 카탈로그가 버전을 담지 않은 비활성 치료는 나오지 않는다', async () => {
    const world = setup('ha-clinic-1');
    world.world.repo.saveTreatment({ id: 'TEST_FIXTURE_RETIRED', clinicId: TEST_FIXTURE_CLINIC_ID, sortOrder: 9, active: false });
    expect((await treatmentsOf(world.admin)).hiddenTreatments).toEqual([]);
  });

  it('인증 없음 401, 다른 병원 HA·RV·PO 403 이고 저장 상태는 그대로다', async () => {
    for (const [account, status] of [[null, 401], ['ha-clinic-2', 403], ['rv-1', 403], ['po-1', 403]] as const) {
      const world = setup(account);
      const before = world.world.repo.exportState();
      const response = await call(world.admin, 'GET', `${CLINIC}/treatments`);
      expect(response.status, String(account)).toBe(status);
      expect(JSON.stringify(await json(response))).not.toContain('hiddenTreatments');
      expect(world.world.repo.exportState()).toEqual(before);
    }
  });
});

describe('PUT draft: 다시 표시 저장은 공개 상태를 바꾸지 않는다', () => {
  it('200 이고 응답 초안에 reactivations 가 담긴다. 초안·감사 기록 말고는 저장소가 그대로이고 공개 목록·순서·가격이 같다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    const publicBefore = await publicOrder(world);
    const before = world.world.repo.exportState();

    const response = await putDraft(world.admin, { reactivations: [T2] });
    expect(response.status).toBe(200);
    const draft = (await json(response)).draft as Json;
    expect(draft).toMatchObject({ reactivations: [T2], deactivations: [], order: null, stale: false });
    expect(changedKeys(before, world.world.repo.exportState())).toEqual(['auditLog', 'catalogDrafts']);
    expect(await publicOrder(world)).toEqual(publicBefore);
    expect(activeOf(world, T2)).toBe(false);
    // 목록 응답의 초안과 같고, 응답 어디에도 revision 이 없다.
    expect((await treatmentsOf(world.admin)).draft).toEqual(draft);
    expect(JSON.stringify(draft)).not.toContain('revision');
  });

  it('PUT 은 초안 전체의 교체다: reactivations 를 빼고 보내면 다시 표시가 사라진다 (빠진 키 = 빈 목록)', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2], additions: [additionBody(A)] });
    const replaced = (await json(await putDraft(world.admin, { additions: [additionBody(A)] }))).draft as Json;
    expect(replaced.reactivations).toEqual([]);
    expect(replaced.additions).toHaveLength(1);
  });

  it.each<[string, unknown, string, string]>([
    ['배열이 아님', { reactivations: T2 }, 'NOT_ARRAY', 'reactivations'],
    ['같은 치료가 두 번', { reactivations: [T2, T2] }, 'DUPLICATE_TREATMENT_ID', 'reactivations[1]'],
    ['이미 표시 중인 치료', { reactivations: [T1] }, 'TREATMENT_ALREADY_VISIBLE', 'reactivations[0]'],
    ['없는 치료', { reactivations: ['TEST_FIXTURE_NO_SUCH'] }, 'TREATMENT_NOT_IN_CATALOG', 'reactivations[0]'],
    ['다른 병원의 표시 중인 치료', { reactivations: [OTHER_CLINIC_TREATMENT_ID] }, 'TREATMENT_NOT_IN_CATALOG', 'reactivations[0]'],
    ['숨김과 다시 표시를 함께', { deactivations: [T1], reactivations: [T1] }, 'REACTIVATION_CONFLICTS_WITH_DEACTIVATION', 'reactivations[0]'],
    ['다시 표시 치료의 가격 수정', { reactivations: [T2], priceEdits: [{ treatmentId: T2, patientAmount: 1_000 }] }, 'PRICE_EDIT_ON_REACTIVATED', 'priceEdits[0].treatmentId'],
    ['알 수 없는 키', { reactivations: [T2], reactivate: [T2] }, 'UNKNOWN_FIELD', 'request.reactivate'],
  ])('400 으로 거절하고 저장소는 그대로다: %s', async (_name, body, code, path) => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    const before = world.world.repo.exportState();
    const response = await putDraft(world.admin, body);
    expect(response.status).toBe(400);
    expect((await json(response)).defects).toContainEqual({ code, path });
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('다른 병원의 숨긴 치료도 없는 치료와 같은 응답이다 (다른 병원의 존재를 드러내지 않는다)', async () => {
    const world = setup('ha-clinic-1');
    world.world.repo.saveTreatment({ ...world.world.repo.getTreatment(OTHER_CLINIC_TREATMENT_ID)!, active: false });
    const other = await json(await putDraft(world.admin, { reactivations: [OTHER_CLINIC_TREATMENT_ID] }));
    const none = await json(await putDraft(world.admin, { reactivations: ['TEST_FIXTURE_NO_SUCH'] }));
    expect(other).toEqual(none);
  });

  it('다른 병원 HA 는 이 병원 경로로 다시 표시를 저장할 수 없다 (403)', async () => {
    const world = setup('ha-clinic-2');
    const before = world.world.repo.exportState();
    const response = await putDraft(world.admin, { reactivations: [T2] });
    expect(response.status).toBe(403);
    expect(world.world.repo.exportState()).toEqual(before);
  });
});

describe('POST preview: 다시 표시를 게시했을 때의 목록과 엔진 판단 (읽기만 한다)', () => {
  it('목록만 보는 미리보기: 계산 비교는 null, afterList 에 다시 표시 치료가 기존 표시 치료의 뒤에 놓이고 저장소는 그대로다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2] });
    const before = world.world.repo.exportState();
    const publicBefore = await publicOrder(world);

    const response = await previewOf(world.admin);
    expect(response.status).toBe(200);
    const preview = await json(response);
    expect(world.world.repo.exportState()).toEqual(before);
    expect(await publicOrder(world)).toEqual(publicBefore);

    expect(preview.before).toBeNull();
    expect(preview.after).toBeNull();
    expect(preview.beforeList.map((row: Json) => row.treatmentId)).toEqual([T1, T3]);
    expect(preview.afterList.map((row: Json) => [row.treatmentId, row.position])).toEqual([[T1, 1], [T3, 2], [T2, 3]]);
    expect(preview.changes.reactivated).toHaveLength(1);
    expect(preview.changes.reactivated[0]).toMatchObject({ treatmentId: T2, patientAmount: 10_000, position: 3 });
    expect(preview.changes).toMatchObject({ priceChanges: [], baseFeeChanges: [], added: [], deactivated: [], reordered: [] });
    expect(preview.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
  });

  it('승인된 매핑이 남아 있는 치료는 엔진이 계산하고, 승인이 없는 치료는 계속 보류(ON_HOLD)다: 다시 표시는 승인이 아니다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2, T3]);
    await putDraft(world.admin, { reactivations: [T2, T3] });
    const preview = await json(await previewOf(world.admin));
    const byId = Object.fromEntries(preview.changes.reactivated.map((row: Json) => [row.treatmentId, row]));
    expect(byId[T2].calculation).toEqual({ state: 'ESTIMATED', lineState: 'ESTIMATED', holdReasons: [] });
    expect(byId[T3].calculation).toEqual({ state: 'ON_HOLD', lineState: 'ON_HOLD', holdReasons: ['MAPPING_ABSENT'] });
    // 금액은 싣지 않는다.
    expect(JSON.stringify(byId[T3].calculation)).not.toMatch(/amount|payout|Payment/i);
  });

  it('가격을 바꾼 치료를 계산 대상으로 함께 두면 before·after 비교도 나가고 다시 표시 치료의 판단도 함께 나간다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2], priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const preview = await json(await previewOf(world.admin));
    expect(preview.before.result.state).toBe('ESTIMATED');
    expect(preview.after.result.state).toBe('ESTIMATED');
    expect(preview.changes.reactivated[0].calculation.state).toBe('ESTIMATED');
    expect(preview.changes.priceChanges).toEqual([{ treatmentId: T1, displayName: expect.any(String), before: 10_000, after: 12_000 }]);
  });

  it('숨긴 치료를 계산 대상으로 직접 고르는 것은 계속 거절한다 (다시 표시는 초안이 하며, 선택은 표시 중인 치료만)', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2] });
    const response = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T2] });
    expect(response.status).toBe(400);
    expect((await json(response)).defects).toContainEqual({ code: 'TREATMENT_NOT_IN_CATALOG', path: 'request.treatmentIds' });
  });

  it('저장 뒤 대상이 이미 표시 중이 되었으면 낡은 초안처럼 409 DRAFT_STALE 이고 확인값을 내지 않는다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2] });
    world.world.repo.saveTreatment({ ...world.world.repo.getTreatment(T2)!, active: true }); // 범위 밖 변경
    const response = await previewOf(world.admin);
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
  });
});

describe('POST publish: 다시 표시 게시', () => {
  it('한 바퀴: 숨김 게시 → 숨김 목록 → 다시 표시 초안(공개 목록 불변) → 미리보기 → 게시 → 공개 목록·계산에 다시 나타난다', async () => {
    const world = setup('ha-clinic-1');
    const baseline = await publicEstimate(world, [T2]);
    expect(baseline.status).toBe(200);
    await hide(world, [T2]);
    expect((await publicEstimate(world, [T2])).status).toBe(422); // 숨기면 환자가 고를 수 없다
    expect((await treatmentsOf(world.admin)).hiddenTreatments.map((row: Json) => row.treatmentId)).toEqual([T2]);

    await putDraft(world.admin, { reactivations: [T2] });
    expect(await publicOrder(world)).toEqual([[T1, 10_000, 1], [T3, 11_000, 3]]);
    const oldVersion = (await publicCatalog(world)).catalogVersion as string;

    const confirmation = await previewConfirmation(world.admin);
    expect(await publicOrder(world)).toEqual([[T1, 10_000, 1], [T3, 11_000, 3]]); // 미리보기만으로 공개 목록이 바뀌지 않는다
    const response = await publish(world.admin, { publishConfirmation: confirmation });
    expect(response.status).toBe(200);
    const published = await json(response);
    expect(published.catalogVersion).not.toBe(oldVersion);
    expect(published.changeSummary).toEqual({ addedTreatmentIds: [], removedTreatmentIds: [], priceChangedTreatmentIds: [], baseFeesChanged: false, reactivatedTreatmentIds: [T2] });

    expect(await publicOrder(world)).toEqual([[T1, 10_000, 1], [T3, 11_000, 2], [T2, 10_000, 3]]);
    const after = await publicEstimate(world, [T2]);
    expect(after.status).toBe(200);
    expect(after.body.result).toEqual(baseline.body.result); // 숨기기 전과 같은 엔진 판정
    const list = await treatmentsOf(world.admin);
    expect(list.draft).toBeNull();
    expect(list.hiddenTreatments).toEqual([]);
    expect(list.treatments.map((row: Json) => row.treatmentId)).toEqual([T1, T3, T2]);
  });

  it('미리보기의 판단과 게시 뒤 공개 계산의 판단이 같다: 승인된 매핑이 없던 치료는 게시 뒤에도 보류이고 보험금이 없다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T3]);
    await putDraft(world.admin, { reactivations: [T3] });
    const preview = await json(await previewOf(world.admin));
    const previewed = preview.changes.reactivated[0].calculation as Json;
    expect(previewed).toEqual({ state: 'ON_HOLD', lineState: 'ON_HOLD', holdReasons: ['MAPPING_ABSENT'] });
    expect((await publish(world.admin, { publishConfirmation: preview.publishConfirmation })).status).toBe(200);

    const live = await publicEstimate(world, [T3]);
    expect(live.status).toBe(200);
    expect(live.body.result.state).toBe(previewed.state);
    expect(live.body.result.holdReasons.filter((reason: Json) => reason.treatmentId === T3).map((reason: Json) => reason.code)).toEqual(previewed.holdReasons);
    expect(live.body.result.amounts.expectedInsurancePayout).toBeNull();
    expect(live.body.result.amounts.expectedOutOfPocketAfterPayout).toBeNull();
  });

  it('분류가 NEEDS_REVIEW 인 치료(새로 추가했다가 숨긴 치료)를 다시 표시해도 분류는 그대로이고 계속 보류다: 자동 승인·자동 매핑은 없다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { additions: [additionBody(A)] });
    expect((await publish(world.admin, { publishConfirmation: await previewConfirmation(world.admin) })).status).toBe(200);
    expect(world.world.repo.getTreatmentVersion(world.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!.treatmentVersionIds.find((id) => world.world.repo.getTreatmentVersion(id)!.treatmentId === ADDED_1)!)!.calcClass).toBe('NEEDS_REVIEW');
    await hide(world, [ADDED_1]);

    const before = world.world.repo.exportState();
    await putDraft(world.admin, { reactivations: [ADDED_1] });
    const preview = await json(await previewOf(world.admin));
    expect(preview.changes.reactivated[0].calculation).toEqual({ state: 'ON_HOLD', lineState: 'ON_HOLD', holdReasons: ['CLASSIFICATION_NEEDS_REVIEW'] });
    expect((await publish(world.admin, { publishConfirmation: preview.publishConfirmation })).status).toBe(200);

    const live = await publicEstimate(world, [ADDED_1]);
    expect(live.body.result.state).toBe('ON_HOLD');
    expect(live.body.result.holdReasons).toContainEqual({ treatmentId: ADDED_1, code: 'CLASSIFICATION_NEEDS_REVIEW' });
    expect(live.body.result.amounts.expectedInsurancePayout).toBeNull();
    // 분류·매핑·승인 지문은 그대로: 치료 버전·항목(매핑) 저장소는 다시 표시 전후가 같다.
    const after = world.world.repo.exportState();
    expect(after['treatmentVersions']).toEqual(before['treatmentVersions']);
    expect(after['itemVersions']).toEqual(before['itemVersions']);
  });

  it('미리보기 없이·틀린 확인값으로는 게시할 수 없다: 409 PREVIEW_REQUIRED, 숨긴 상태·공개 목록·초안이 그대로다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2] });
    const before = world.world.repo.exportState();
    for (const wrong of [NOT_ISSUED, 'b'.repeat(64)]) {
      const response = await publish(world.admin, { publishConfirmation: wrong });
      expect(response.status).toBe(409);
      expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    }
    expect((await publish(world.admin, {})).status).toBe(400);
    expect(world.world.repo.exportState()).toEqual(before);
    expect(activeOf(world, T2)).toBe(false);
    expect(await publicOrder(world)).toEqual([[T1, 10_000, 1], [T3, 11_000, 3]]);
  });

  it('다시 표시 A 의 확인값으로 다시 표시 B 를 게시할 수 없다 (409 PREVIEW_REQUIRED). 대상도 순서도 확인값에 묶인다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2, T3]);
    await putDraft(world.admin, { reactivations: [T2] });
    const forT2 = await previewConfirmation(world.admin);
    await putDraft(world.admin, { reactivations: [T3] });
    const wrongTarget = await publish(world.admin, { publishConfirmation: forT2 });
    expect(wrongTarget.status).toBe(409);
    expect(await json(wrongTarget)).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });

    await putDraft(world.admin, { reactivations: [T2, T3], order: [T3, T1, T2] });
    const forFirstOrder = await previewConfirmation(world.admin);
    await putDraft(world.admin, { reactivations: [T2, T3], order: [T2, T3, T1] });
    expect((await publish(world.admin, { publishConfirmation: forFirstOrder })).status).toBe(409);
    expect(activeOf(world, T2) || activeOf(world, T3)).toBe(false);
  });

  it('초안이 근거한 카탈로그가 바뀐 뒤에는 미리보기·게시 모두 409 DRAFT_STALE 이고 숨긴 상태 그대로다 (옛 카탈로그 버전)', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2] });
    const confirmation = await previewConfirmation(world.admin);
    const current = world.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
    publishCatalog(
      world.world.deps,
      TEST_FIXTURE_HA_1,
      TEST_FIXTURE_CLINIC_ID,
      { treatmentVersions: current.treatmentVersionIds.map((id) => world.world.repo.getTreatmentVersion(id)!), commonBaseFees: current.baseFeeIds.map((id) => world.world.repo.getCommonBaseFee(id)!) },
      TEST_CATALOG_CONFIG,
    );
    const before = world.world.repo.exportState();
    for (const response of [await previewOf(world.admin), await publish(world.admin, { publishConfirmation: confirmation })]) {
      expect(response.status).toBe(409);
      expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
    }
    expect(world.world.repo.exportState()).toEqual(before);
    expect(activeOf(world, T2)).toBe(false);
  });

  it('다른 병원은 그대로다: 병원 2 의 치료 기록·현재 카탈로그·공개 카탈로그', async () => {
    const world = setup('ha-clinic-1');
    const otherBefore = JSON.stringify([world.world.repo.getClinic(OTHER_CLINIC_ID), world.world.repo.listTreatments(OTHER_CLINIC_ID), await json(await handleCatalog(world.api, 'test-fixture-clinic-2'))]);
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2] });
    expect((await publish(world.admin, { publishConfirmation: await previewConfirmation(world.admin) })).status).toBe(200);
    expect(JSON.stringify([world.world.repo.getClinic(OTHER_CLINIC_ID), world.world.repo.listTreatments(OTHER_CLINIC_ID), await json(await handleCatalog(world.api, 'test-fixture-clinic-2'))])).toBe(otherBefore);
  });

  it('보장 판단은 건드리지 않는다: 치료 버전·매핑·승인 지문·규칙 묶음·범위는 게시 전후가 같고, 바뀌는 것은 카탈로그·병원 포인터·치료 기록·초안·감사 기록뿐이다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2] });
    const confirmation = await previewConfirmation(world.admin);
    const before = world.world.repo.exportState();
    expect((await publish(world.admin, { publishConfirmation: confirmation })).status).toBe(200);
    expect(changedKeys(before, world.world.repo.exportState())).toEqual(['auditLog', 'catalogDrafts', 'catalogVersions', 'clinics', 'treatments']);
  });

  it('기존 초안과 함께 보존된다: 가격·기본비용·새 치료·숨김·다시 표시가 한 초안, 한 미리보기, 한 게시로 모두 적용된다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    const saved = (await json(await putDraft(world.admin, {
      priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }],
      baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 6_000 }],
      additions: [additionBody(A)],
      deactivations: [T3],
      reactivations: [T2],
    }))).draft as Json;
    expect(saved).toMatchObject({ priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 6_000 }], deactivations: [T3], reactivations: [T2], order: null });
    expect(saved.additions).toHaveLength(1);
    expect((await treatmentsOf(world.admin)).draft).toEqual(saved);

    const preview = await json(await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] }));
    expect(preview.afterList.map((row: Json) => row.treatmentId)).toEqual([T1, T2, null]);
    expect(preview.changes).toMatchObject({ priceChanges: [{ treatmentId: T1 }], baseFeeChanges: [{ baseFeeId: BASE_FEE_ID }], deactivated: [{ treatmentId: T3 }], reactivated: [{ treatmentId: T2 }] });
    expect(preview.changes.added).toHaveLength(1);

    const published = await json(await publish(world.admin, { publishConfirmation: preview.publishConfirmation }));
    expect(published.changeSummary).toMatchObject({ addedTreatmentIds: [ADDED_1], priceChangedTreatmentIds: [T1], baseFeesChanged: true, deactivatedTreatmentIds: [T3], reactivatedTreatmentIds: [T2] });
    expect(await publicOrder(world)).toEqual([[T1, 12_000, 1], [T2, 10_000, 2], [ADDED_1, 7_000, 3]]);
  });

  it('게시 도중 저장소 쓰기가 실패하면 500 이고 모두 되돌려진다: 새 카탈로그·active·순서·초안·감사 기록', async () => {
    // 첫 closeCatalogDraft(숨김 게시)는 통과하고, 두 번째(다시 표시 게시)에서 실패한다.
    const world = setup('ha-clinic-1', { wrapRepo: (repo) => repoThrowingOn(repo, 'closeCatalogDraft', 1).repo });
    await hide(world, [T2]);
    await putDraft(world.admin, { reactivations: [T2] });
    const confirmation = await previewConfirmation(world.admin);
    const before = world.world.repo.exportState();
    const publicBefore = await publicOrder(world);
    const response = await publish(world.admin, { publishConfirmation: confirmation });
    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: 'INTERNAL_ERROR' });
    expect(world.world.repo.exportState()).toEqual(before);
    expect(activeOf(world, T2)).toBe(false);
    expect(await publicOrder(world)).toEqual(publicBefore);
    expect(world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).not.toBeNull();
  });
});

describe('변경 이력: 별도 감사 체계 없이 기존 초안 게시 기록으로 나타난다', () => {
  it('다시 표시 저장·게시는 CATALOG_DRAFT_SAVE / CATALOG_DRAFT_PUBLISH 로만 이력에 보이고, 허용 동작 목록은 그대로다', async () => {
    const world = setup('ha-clinic-1');
    await hide(world, [T2]);
    const coveredBefore = (await json(await call(world.admin, 'GET', 'audit-log'))).coveredActions;
    const lengthBefore = (await json(await call(world.admin, 'GET', 'audit-log'))).entries.length;

    const saved = (await json(await putDraft(world.admin, { reactivations: [T2] }))).draft as Json;
    const preview = await json(await previewOf(world.admin));
    expect(preview.draftDigest).toBe(saved.draftDigest);
    const published = await json(await publish(world.admin, { publishConfirmation: preview.publishConfirmation }));

    const history = await json(await call(world.admin, 'GET', 'audit-log'));
    expect(history.coveredActions).toEqual(coveredBefore);
    const added = history.entries.slice(0, history.entries.length - lengthBefore);
    expect(added.map((entry: Json) => entry.action)).toEqual(['CATALOG_DRAFT_PUBLISH', 'CATALOG_DRAFT_SAVE']); // 최신순
    expect(added[0]).toMatchObject({ target: `CATALOG/${published.catalogVersion}`, reason: `DRAFT_OF:${saved.draftDigest}` });
    expect(added[1]).toMatchObject({ target: `CATALOG_DRAFT/${TEST_FIXTURE_CLINIC_ID}` });
    expect(JSON.stringify(history)).not.toMatch(/REACTIVAT|RESHOW|UNHIDE/i);
  });
});
