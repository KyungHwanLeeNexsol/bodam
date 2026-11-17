import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { silentLog } from '../../src/server/api/log';
import { createOperatingAdminServices, createOperatingServices } from '../../src/server/composition';
import { canonicalDigest } from '../../src/server/digest';
import { readReadiness } from '../../src/server/readiness';
import type { ReadinessContext } from '../../src/server/readiness';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, TEST_ACCEPTED_ORIGINS, TEST_TODAY, publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { T1, T2 } from '../fixtures/server/base-fee.fixture';
import { T3, addThirdTreatment, additionBody, repoThrowingOn } from '../fixtures/server/catalog-structure.fixture';
import { CounterIdGenerator, FixedClock } from '../fixtures/server/clock.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import type { MemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';

// 관리자 API 의 구조 편집 (M7): 새 치료 추가 · 숨김 · 표시 순서를 같은 초안 → 미리보기 → 게시 흐름으로 다룬다. 모두 handleAdmin 을 지난다.
// 세계: 병원 1 에 치료 셋(T1·T2·T3, 표시 순서 T1·T2·T3)과 공통 기본비용·승인된 매핑(T1·T2)·게시된 규칙 묶음. T3 에는 매핑이 없다. 병원 2 는 따로 있다.

const BASE = 'http://localhost/api/admin';
const CLINIC = `clinics/${TEST_FIXTURE_CLINIC_ID}`;
const NOT_ISSUED = 'a'.repeat(64);
const PREVIEW_BODY = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const ADDED_1 = 'TEST_FIXTURE_ADDED_TREATMENT_1';
const ADDED_2 = 'TEST_FIXTURE_ADDED_TREATMENT_2';
const A = 'NEW_A';
const B = 'NEW_B';
const READINESS_CTX: ReadinessContext = { at: TEST_TODAY, acceptedOrigins: TEST_ACCEPTED_ORIGINS, digest: canonicalDigest };

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

function setup(account: TestAccountKey | null, options: { linesOrigins?: ('OPERATING' | 'TEST_FIXTURE' | 'DEMO')[]; wrapRepo?: (repo: MemoryRepository) => MemoryRepository } = {}) {
  const built = buildWorld();
  publishSecondClinicCatalog(built.world);
  addThirdTreatment(built.world);
  // 서비스는 (실패 주입 대역일 수 있는) 감싼 저장소를 쓰고, 반환하는 world 와 상태 비교는 실제 저장소다.
  const wrapped = options.wrapRepo === undefined ? built.world.repo : options.wrapRepo(built.world.repo);
  const world: World = { ...built.world, repo: wrapped, deps: { ...built.world.deps, repo: wrapped } };
  const services = adminServicesOf(world, {
    authenticator: staticAuthenticator(account === null ? null : identityOf(account)),
    ...(options.linesOrigins === undefined ? {} : { api: { acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: options.linesOrigins } } }),
  });
  return { ...built, ...services };
}

type Setup = ReturnType<typeof setup>;

const putDraft = (admin: AdminOf, body: unknown): Promise<Response> => call(admin, 'PUT', `${CLINIC}/catalog/draft`, body);
const previewOf = (admin: AdminOf, body: unknown = PREVIEW_BODY): Promise<Response> => call(admin, 'POST', `${CLINIC}/catalog/preview`, body);
const publish = (admin: AdminOf, body: unknown): Promise<Response> => call(admin, 'POST', `${CLINIC}/catalog/publish`, body);

async function previewConfirmation(admin: AdminOf, body: unknown = PREVIEW_BODY): Promise<string> {
  const response = await previewOf(admin, body);
  expect(response.status).toBe(200);
  return (await json(response)).publishConfirmation as string;
}

const publicCatalog = async (world: Setup): Promise<Json> => json(await handleCatalog(world.api, CLINIC_1_SLUG));
const publicOrder = async (world: Setup): Promise<Array<[string, number, number]>> =>
  (await publicCatalog(world)).treatments.map((row: Json) => [row.treatmentId, row.patientAmount, row.order]);

/** 병원 1 의 현재 카탈로그·규칙 묶음으로 공개 계산(키오스크 경로)을 한다. */
async function publicEstimate(world: Setup, treatmentIds: string[]): Promise<{ status: number; body: Json }> {
  const catalogVersion = (await publicCatalog(world)).catalogVersion as string;
  const response = await handleEstimate(world.api, CLINIC_1_SLUG, () =>
    Promise.resolve({ catalogVersion, ruleBundleVersion: world.bundle!.id, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds }),
  );
  return { status: response.status, body: await json(response) };
}

const FULL_DRAFT = () => ({
  priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }],
  additions: [additionBody(A, { patientAmount: 7_000 }), additionBody(B, { patientAmount: 8_000, benefitType: 'NON_BENEFIT' })],
  deactivations: [T2],
  order: [B, T3, T1, A],
});

describe('인증·권한: 구조 편집도 같은 경계를 지난다 (저장 상태는 그대로)', () => {
  const ROUTES: Array<[string, string, unknown]> = [
    ['PUT', `${CLINIC}/catalog/draft`, FULL_DRAFT()],
    ['POST', `${CLINIC}/catalog/preview`, PREVIEW_BODY],
    ['POST', `${CLINIC}/catalog/publish`, { publishConfirmation: NOT_ISSUED }],
  ];

  it.each(ROUTES)('인증 없음 401: %s /api/admin/%s', async (method, path, body) => {
    const world = setup(null);
    const before = world.world.repo.exportState();
    const response = await call(world.admin, method, path, body);
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: 'UNAUTHENTICATED' });
    expect(world.world.repo.exportState()).toEqual(before);
  });

  for (const [label, account] of [['다른 병원의 관리자(HA)', 'ha-clinic-2'], ['검토 담당자(RV)', 'rv-1'], ['플랫폼 운영자(PO)', 'po-1']] as const) {
    it.each(ROUTES)(`${label} 403: %s /api/admin/%s`, async (method, path, body) => {
      const world = setup(account);
      const before = world.world.repo.exportState();
      const response = await call(world.admin, method, path, body);
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: 'FORBIDDEN' });
      expect(world.world.repo.exportState()).toEqual(before);
    });
  }

  it('다른 병원 HA 가 자기 병원 경로로 이 병원의 치료 id 를 숨기려 해도 거절한다 (없는 치료와 같은 코드, 다른 병원의 존재를 드러내지 않는다)', async () => {
    const world = setup('ha-clinic-2');
    const response = await call(world.admin, 'PUT', `clinics/${OTHER_CLINIC_ID}/catalog/draft`, { deactivations: [T1] });
    expect(response.status).toBe(400);
    expect((await json(response)).defects).toContainEqual({ code: 'TREATMENT_NOT_IN_CATALOG', path: 'deactivations[0]' });
  });
});

describe('PUT draft: 구조 편집 저장', () => {
  it('새 섹션을 저장하면 200 이고 응답에 additions·deactivations·order 가 담긴다 (기존 필드 이름은 그대로)', async () => {
    const world = setup('ha-clinic-1');
    const response = await putDraft(world.admin, FULL_DRAFT());
    expect(response.status).toBe(200);
    const draft = (await json(response)).draft as Json;
    expect(Object.keys(draft).sort()).toEqual(['additions', 'baseCatalogVersionId', 'baseFeeEdits', 'deactivations', 'draftDigest', 'order', 'priceEdits', 'reactivations', 'stale', 'updatedAt', 'updatedBy']);
    expect(draft['baseFeeEdits']).toEqual([]);
    expect(draft['reactivations']).toEqual([]);
    expect(draft).toMatchObject({ stale: false, priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], deactivations: [T2], order: [B, T3, T1, A] });
    expect(draft.additions).toEqual(FULL_DRAFT().additions);
    expect(draft.draftDigest).toMatch(/^[0-9a-f]{64}$/);
    // 저장 응답과 목록 응답은 같은 초안을 보인다.
    expect((await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft).toEqual(draft);
  });

  it('이전 모양의 요청 { priceEdits } 는 그대로 동작하고 새 필드는 빈 값이다', async () => {
    const world = setup('ha-clinic-1');
    const response = await putDraft(world.admin, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    expect(response.status).toBe(200);
    expect((await json(response)).draft).toMatchObject({ priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], additions: [], deactivations: [], order: null });
  });

  it('저장은 공개 상태를 바꾸지 않는다: 저장소는 초안·감사 기록만 다르고, 공개 카탈로그·준비 상태·공개 계산 응답이 전과 같다', async () => {
    const world = setup('ha-clinic-1');
    const stateBefore = world.world.repo.exportState();
    const catalogBefore = await publicCatalog(world);
    const readinessBefore = readReadiness(world.world.repo, READINESS_CTX);
    const estimateBefore = await publicEstimate(world, [T1, T2, T3]);
    expect(estimateBefore.status).toBe(200);

    expect((await putDraft(world.admin, FULL_DRAFT())).status).toBe(200);

    const stateAfter = world.world.repo.exportState();
    const changed = Object.keys(stateAfter).filter((key) => JSON.stringify(stateBefore[key]) !== JSON.stringify(stateAfter[key]));
    expect(changed.sort()).toEqual(['auditLog', 'catalogDrafts']);
    expect(await publicCatalog(world)).toEqual(catalogBefore);
    expect(readReadiness(world.world.repo, READINESS_CTX)).toEqual(readinessBefore);
    expect(await publicEstimate(world, [T1, T2, T3])).toEqual(estimateBefore);
    expect(await publicOrder(world)).toEqual([[T1, 10_000, 1], [T2, 10_000, 1], [T3, 11_000, 3]]);
  });

  it('draftKey 가 다른 병원의 치료 id 여도 저장된다: 같은 병원 안의 충돌만 거절하므로 다른 병원 치료의 존재가 응답으로 드러나지 않는다', async () => {
    const world = setup('ha-clinic-1');
    const response = await putDraft(world.admin, { additions: [additionBody(OTHER_CLINIC_TREATMENT_ID)] });
    expect(response.status).toBe(200);
    expect((await json(response)).draft.additions.map((row: Json) => row.draftKey)).toEqual([OTHER_CLINIC_TREATMENT_ID]);
    // 같은 병원의 치료 id 와 겹치면 여전히 거절한다 (아래 BAD 표의 'draftKey 가 기존 치료 id').
  });

  it('모든 치료를 숨기는 초안은 400 NO_TREATMENT_REMAINS 이고 공개 카탈로그·초안이 그대로다. 새 치료를 더하거나 하나를 남기면 저장된다', async () => {
    const world = setup('ha-clinic-1');
    const catalogBefore = await publicCatalog(world);
    const response = await putDraft(world.admin, { deactivations: [T1, T2, T3] });
    expect(response.status).toBe(400);
    expect((await json(response)).defects).toEqual([{ code: 'NO_TREATMENT_REMAINS', path: 'deactivations' }]);
    expect(await publicCatalog(world)).toEqual(catalogBefore);
    expect(world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).toBeNull();
    expect((await putDraft(world.admin, { deactivations: [T1, T2] })).status).toBe(200);
    expect((await putDraft(world.admin, { deactivations: [T1, T2, T3], additions: [additionBody(A)] })).status).toBe(200);
    expect(await publicCatalog(world)).toEqual(catalogBefore);
  });

  const BAD: Array<[string, unknown, string, string]> = [
    ['숨기는 치료에 가격 수정', { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], deactivations: [T1] }, 'PRICE_EDIT_ON_DEACTIVATED', 'priceEdits[0].treatmentId'],
    ['모든 치료를 숨김 (남는 치료가 없음)', { deactivations: [T1, T2, T3] }, 'NO_TREATMENT_REMAINS', 'deactivations'],
    ['없는 치료를 숨김', { deactivations: ['NO_SUCH'] }, 'TREATMENT_NOT_IN_CATALOG', 'deactivations[0]'],
    ['새 치료에 분류를 보냄', { additions: [additionBody(A, { calcClass: 'GENERAL_BENEFIT' })] }, 'UNKNOWN_FIELD', 'additions[0].calcClass'],
    ['새 치료에 출처를 보냄', { additions: [additionBody(A, { origin: 'OPERATING' })] }, 'UNKNOWN_FIELD', 'additions[0].origin'],
    ['새 치료 가격 음수', { additions: [additionBody(A, { patientAmount: -5 })] }, 'VALUE_INVALID', 'additions[0].patientAmount'],
    ['달력에 없는 기준일', { additions: [additionBody(A, { effectiveDate: '2026-02-30' })] }, 'VALUE_INVALID', 'additions[0].effectiveDate'],
    ['draftKey 가 기존 치료 id', { additions: [additionBody(T1)] }, 'DRAFT_KEY_COLLIDES', 'additions[0].draftKey'],
    ['순서에 새 치료 빠짐', { additions: [additionBody(A)], order: [T1, T2, T3] }, 'ORDER_INCOMPLETE', 'order'],
    ['순서에 모르는 항목', { order: [T1, T2, T3, 'X'] }, 'ORDER_UNKNOWN_ENTRY', 'order[3]'],
    ['순서에 중복', { order: [T1, T2, T3, T3] }, 'DUPLICATE_ORDER_ENTRY', 'order[3]'],
    ['변경 없음 ({})', {}, 'NO_DRAFT_CHANGE', 'request'],
    ['변경 없음 (이전 모양)', { priceEdits: [{ treatmentId: T1, patientAmount: 10_000 }] }, 'NO_PRICE_CHANGE', 'priceEdits'],
    ['최상위 알 수 없는 키', { deactivations: [T2], ruleBundleVersion: 'X' }, 'UNKNOWN_FIELD', 'request.ruleBundleVersion'],
    ['새 치료 51건', { additions: Array.from({ length: 51 }, (_v, index) => additionBody(`K${index}`)) }, 'TOO_MANY_ADDITIONS', 'additions'],
  ];
  it.each(BAD)('400: %s — 어긋난 경로와 함께 거절되고 저장 상태는 그대로다', async (_name, body, code, path) => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { deactivations: [T3] });
    const before = world.world.repo.exportState();
    const response = await putDraft(world.admin, body);
    expect(response.status).toBe(400);
    const parsed = await json(response);
    expect(parsed.error).toBe('INVALID_REQUEST');
    expect(parsed.defects).toContainEqual({ code, path });
    expect(world.world.repo.exportState()).toEqual(before);
  });
});

describe('POST preview: 구조 편집 미리보기', () => {
  it('목록·변경 목록: beforeList/afterList/changes 를 싣고, 숨기는 치료는 계산에 넣지 않으며, 가격이 바뀐 치료는 계산한다. 읽기만 하고 식별자를 쓰지 않는다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, FULL_DRAFT());
    const before = world.world.repo.exportState();
    const response = await previewOf(world.admin);
    expect(response.status).toBe(200);
    const preview = await json(response);
    // 읽기만 한다: 저장소 전체가 같고, 새 치료 id·치료 버전 id 도 쓰지 않았다.
    expect(world.world.repo.exportState()).toEqual(before);
    expect(world.world.ids.next('TREATMENT')).toBe(ADDED_1);
    expect(world.world.ids.next('TREATMENT_VERSION')).toBe('TEST_FIXTURE_TREATMENT_VERSION_1');

    expect(preview.request.treatmentIds).toEqual([T1]);
    expect(preview.priceChanges).toEqual([{ treatmentId: T1, displayName: expect.any(String), before: 10_000, after: 12_000 }]);
    expect(preview.before.result.state).toBe('ESTIMATED');
    expect(preview.after.result.state).toBe('ESTIMATED');
    expect(preview.after.result.amounts.hospitalPayment).toBe(17_000);

    expect(preview.beforeList).toEqual([
      { key: T1, treatmentId: T1, displayName: expect.any(String), patientAmount: 10_000, position: 1, isNew: false },
      { key: T2, treatmentId: T2, displayName: expect.any(String), patientAmount: 10_000, position: 2, isNew: false },
      { key: T3, treatmentId: T3, displayName: 'TEST_FIXTURE 치료 3', patientAmount: 11_000, position: 3, isNew: false },
    ]);
    expect(preview.afterList).toEqual([
      { key: `NEW:${B}`, treatmentId: null, displayName: `TEST_FIXTURE 새 치료 ${B}`, patientAmount: 8_000, position: 1, isNew: true },
      { key: T3, treatmentId: T3, displayName: 'TEST_FIXTURE 치료 3', patientAmount: 11_000, position: 2, isNew: false },
      { key: T1, treatmentId: T1, displayName: expect.any(String), patientAmount: 12_000, position: 3, isNew: false },
      { key: `NEW:${A}`, treatmentId: null, displayName: `TEST_FIXTURE 새 치료 ${A}`, patientAmount: 7_000, position: 4, isNew: true },
    ]);
    expect(preview.changes.priceChanges).toEqual(preview.priceChanges);
    expect(preview.changes.deactivated).toEqual([{ treatmentId: T2, displayName: expect.any(String) }]);
    expect(preview.changes.reordered).toEqual([
      { treatmentId: T1, displayName: expect.any(String), before: 1, after: 3 },
      { treatmentId: T3, displayName: 'TEST_FIXTURE 치료 3', before: 3, after: 2 },
    ]);
    expect(preview.changes.added.map((row: Json) => [row.draftKey, row.displayName, row.patientAmount, row.benefitType])).toEqual([
      [A, `TEST_FIXTURE 새 치료 ${A}`, 7_000, 'BENEFIT'],
      [B, `TEST_FIXTURE 새 치료 ${B}`, 8_000, 'NON_BENEFIT'],
    ]);
  });

  it('새 치료의 계산 결과는 엔진이 말한 보류(ON_HOLD)와 사유 그대로이고, 보험금 같은 금액은 싣지 않는다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { additions: [additionBody(A), additionBody(B, { benefitType: 'NON_BENEFIT' })] });
    const preview = await json(await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] }));
    for (const row of preview.changes.added) {
      expect(row.calculation).toEqual({ state: 'ON_HOLD', lineState: 'ON_HOLD', holdReasons: ['CLASSIFICATION_NEEDS_REVIEW'] });
      expect(JSON.stringify(row)).not.toMatch(/Payout|payout|OutOfPocket|amounts/);
    }
  });

  it('가격 수정이 없는 초안(새 치료·숨김·순서만)도 미리보기가 된다: 계산은 null 이고 목록·변경 목록과 게시 확인값은 나온다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { deactivations: [T2], order: [T3, T1] });
    const response = await previewOf(world.admin);
    expect(response.status).toBe(200);
    const preview = await json(response);
    expect(preview.before).toBeNull();
    expect(preview.after).toBeNull();
    expect(preview.request.treatmentIds).toEqual([]);
    expect(preview.priceChanges).toEqual([]);
    expect(preview.afterList.map((row: Json) => row.treatmentId)).toEqual([T3, T1]);
    expect(preview.changes.deactivated.map((row: Json) => row.treatmentId)).toEqual([T2]);
    expect(preview.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
    expect((await publish(world.admin, { publishConfirmation: preview.publishConfirmation })).status).toBe(200);
    expect((await publicCatalog(world)).treatments.map((row: Json) => row.treatmentId)).toEqual([T3, T1]);
  });

  it('가격 수정이 없어도 treatmentIds 를 명시하면 그 치료는 계산한다 (숨기는 치료는 고를 수 없다)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { deactivations: [T2] });
    const calculated = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
    expect(calculated.status).toBe(200);
    const preview = await json(calculated);
    expect(preview.before.result.state).toBe('ESTIMATED');
    expect(preview.after.result.state).toBe('ESTIMATED');

    const before = world.world.repo.exportState();
    const hidden = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1, T2] });
    expect(hidden.status).toBe(400);
    const body = await json(hidden);
    expect(body.defects).toContainEqual({ code: 'TREATMENT_DEACTIVATED_IN_DRAFT', path: 'request.treatmentIds' });
    expect(JSON.stringify(body)).not.toContain('publishConfirmation');
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('가격이 바뀐 치료를 빼면 여전히 400 CHANGED_TREATMENT_NOT_INCLUDED 이고 확인값이 없다 (구조 편집이 있어도)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, FULL_DRAFT());
    const before = world.world.repo.exportState();
    const response = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T3] });
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(body.defects).toContainEqual({ code: 'CHANGED_TREATMENT_NOT_INCLUDED', path: 'request.treatmentIds' });
    expect(JSON.stringify(body)).not.toContain('publishConfirmation');
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('저장한 뒤 치료 기록이 바뀌어 초안의 구조가 현재 게시 치료와 맞지 않으면 미리보기도 게시도 409 DRAFT_STALE 이다 (확인값을 내지 않는다)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { order: [T3, T1, T2] });
    const confirmation = await previewConfirmation(world.admin);
    // 저장 뒤에 T3 가 (이 API 밖에서) 비활성이 되었다: 초안의 순서가 가리키는 치료가 현재 목록에 없다.
    world.world.repo.saveTreatment({ ...world.world.repo.getTreatment(T3)!, active: false });
    const before = world.world.repo.exportState();
    const preview = await previewOf(world.admin);
    expect(preview.status).toBe(409);
    expect(await json(preview)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
    const published = await publish(world.admin, { publishConfirmation: confirmation });
    expect(published.status).toBe(409);
    expect(await json(published)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('계산 조건이 틀리면 계산할 치료가 없는 초안이어도 400 이다 (세대·보험사 유형·원인은 늘 필요하다)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { deactivations: [T2] });
    for (const [body, code] of [
      [{ generation: 'GEN9', insurerType: 'NON_LIFE', cause: 'UNKNOWN' }, 'UNSUPPORTED_GENERATION'],
      [{ generation: 'GEN4_C4', insurerType: 'BANK', cause: 'UNKNOWN' }, 'INVALID_REQUEST'],
      [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [] }, 'NO_TREATMENT_SELECTED'],
    ] as const) {
      const response = await previewOf(world.admin, body);
      expect(response.status, code).toBe(400);
      expect((await json(response)).defects.map((defect: Json) => defect.code)).toContain(code);
    }
  });
});

describe('POST publish: 구조 편집 게시', () => {
  it('한 바퀴: 저장 → 미리보기 → 게시. 공개 카탈로그의 목록·순서·가격은 게시 뒤에만 바뀌고, 응답의 변경 요약에 구조 변경이 담긴다', async () => {
    const world = setup('ha-clinic-1');
    const oldVersion = (await publicCatalog(world)).catalogVersion as string;
    await putDraft(world.admin, FULL_DRAFT());
    const confirmation = await previewConfirmation(world.admin);
    expect(await publicOrder(world)).toEqual([[T1, 10_000, 1], [T2, 10_000, 1], [T3, 11_000, 3]]);

    const response = await publish(world.admin, { publishConfirmation: confirmation });
    expect(response.status).toBe(200);
    const published = await json(response);
    expect(published.catalogVersion).not.toBe(oldVersion);
    expect(published.changeSummary).toEqual({
      addedTreatmentIds: [ADDED_1, ADDED_2],
      removedTreatmentIds: [],
      priceChangedTreatmentIds: [T1],
      baseFeesChanged: false,
      deactivatedTreatmentIds: [T2],
      reorderedTreatmentIds: [T1, T3],
    });

    const catalog = await publicCatalog(world);
    expect(catalog.catalogVersion).toBe(published.catalogVersion);
    expect(await publicOrder(world)).toEqual([[ADDED_2, 8_000, 1], [T3, 11_000, 2], [T1, 12_000, 3], [ADDED_1, 7_000, 4]]);
    expect(catalog.treatments.map((row: Json) => row.displayName)).toEqual([`TEST_FIXTURE 새 치료 ${B}`, 'TEST_FIXTURE 치료 3', expect.any(String), `TEST_FIXTURE 새 치료 ${A}`]);
    // 보장 판단 필드는 공개 카탈로그에 없다.
    expect(JSON.stringify(catalog)).not.toMatch(/NEEDS_REVIEW|calcClass|treatmentCode|procedureCodes/);
    // 이력과 목록 응답.
    const versions = (await json(await call(world.admin, 'GET', `${CLINIC}/catalog/versions`))).versions as Json[];
    expect(versions[0]).toMatchObject({ id: published.catalogVersion, current: true, changeSummary: { deactivatedTreatmentIds: [T2] } });
    const list = await json(await call(world.admin, 'GET', `${CLINIC}/treatments`));
    expect(list.draft).toBeNull();
    expect(list.treatments.map((row: Json) => row.treatmentId)).toEqual([ADDED_2, T3, T1, ADDED_1]);
  });

  it('새 치료를 고른 공개 계산은 보류(ON_HOLD)이고 보험금이 없다. 기존 치료의 계산은 그대로 나온다. 숨긴 치료는 고를 수 없다 (422)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, FULL_DRAFT());
    expect((await publish(world.admin, { publishConfirmation: await previewConfirmation(world.admin) })).status).toBe(200);

    const added = await publicEstimate(world, [ADDED_1]);
    expect(added.status).toBe(200);
    expect(added.body.result.state).toBe('ON_HOLD');
    expect(added.body.result.amounts.expectedInsurancePayout).toBeNull();
    expect(added.body.result.amounts.expectedOutOfPocketAfterPayout).toBeNull();
    expect(added.body.result.holdReasons).toContainEqual({ treatmentId: ADDED_1, code: 'CLASSIFICATION_NEEDS_REVIEW' });
    expect(added.body.result.lines.find((line: Json) => line.treatmentId === ADDED_1)).toMatchObject({ state: 'ON_HOLD', holdReason: 'CLASSIFICATION_NEEDS_REVIEW' });

    // 기존 치료와 함께 골라도 전체가 보류이고 금액이 없다.
    const mixed = await publicEstimate(world, [T1, ADDED_2]);
    expect(mixed.body.result.state).toBe('ON_HOLD');
    expect(mixed.body.result.amounts.expectedInsurancePayout).toBeNull();

    const existing = await publicEstimate(world, [T1]);
    expect(existing.body.result.state).toBe('ESTIMATED');
    expect(existing.body.result.amounts.hospitalPayment).toBe(17_000);

    expect((await publicEstimate(world, [T2])).status).toBe(422);
  });

  it('미리보기의 새 치료 계산과 게시 뒤 공개 계산이 같은 판단을 낸다 (엔진의 보류 사유 일치)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { additions: [additionBody(A)] });
    const preview = await json(await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] }));
    const previewed = preview.changes.added[0].calculation as Json;
    expect((await publish(world.admin, { publishConfirmation: preview.publishConfirmation })).status).toBe(200);
    const live = await publicEstimate(world, [ADDED_1]);
    expect(live.body.result.state).toBe(previewed.state);
    expect(live.body.result.holdReasons.filter((reason: Json) => reason.treatmentId === ADDED_1).map((reason: Json) => reason.code)).toEqual(previewed.holdReasons);
  });

  it('확인값 없이·틀린 확인값으로는 게시할 수 없다: 409 PREVIEW_REQUIRED, 저장소·공개 목록·초안이 그대로다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, FULL_DRAFT());
    const before = world.world.repo.exportState();
    for (const wrong of [NOT_ISSUED, 'b'.repeat(64)]) {
      const response = await publish(world.admin, { publishConfirmation: wrong });
      expect(response.status).toBe(409);
      expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    }
    expect((await publish(world.admin, {})).status).toBe(400);
    expect(world.world.repo.exportState()).toEqual(before);
    expect(await publicOrder(world)).toEqual([[T1, 10_000, 1], [T2, 10_000, 1], [T3, 11_000, 3]]);
  });

  it('초안 A 의 확인값으로 초안 B 를 게시할 수 없다 — 순서만 다른 B 도, 숨김만 다른 B 도 (409 PREVIEW_REQUIRED)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { order: [T3, T1, T2] });
    const confirmationA = await previewConfirmation(world.admin);
    await putDraft(world.admin, { order: [T2, T1, T3] });
    const before = world.world.repo.exportState();
    const orderOnly = await publish(world.admin, { publishConfirmation: confirmationA });
    expect(orderOnly.status).toBe(409);
    expect(await json(orderOnly)).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });

    await putDraft(world.admin, { deactivations: [T2] });
    const confirmationDeactivate = await previewConfirmation(world.admin);
    await putDraft(world.admin, { deactivations: [T3] });
    const deactivationOnly = await publish(world.admin, { publishConfirmation: confirmationDeactivate });
    expect(deactivationOnly.status).toBe(409);
    expect(world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).not.toBeNull();
    expect(world.world.repo.exportState()).not.toEqual(before); // 두 번째 저장이 있었다
    expect(await publicOrder(world)).toEqual([[T1, 10_000, 1], [T2, 10_000, 1], [T3, 11_000, 3]]);
  });

  it('운영 허용 출처(OPERATING)에서는 시험 자료 출처의 새 치료를 게시하지 않는다: 400 + ORIGIN_NOT_ACCEPTED, 저장소·공개 목록·초안이 그대로다', async () => {
    const world = setup('ha-clinic-1', { linesOrigins: ['OPERATING'] });
    await putDraft(world.admin, { additions: [additionBody(A)] });
    const confirmation = await previewConfirmation(world.admin);
    const before = world.world.repo.exportState();
    const response = await publish(world.admin, { publishConfirmation: confirmation });
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(body.error).toBe('INVALID_REQUEST');
    expect(body.defects).toContainEqual({ code: 'ORIGIN_NOT_ACCEPTED', path: 'treatmentVersions[3].origin' });
    expect(world.world.repo.exportState()).toEqual(before);
    expect(world.world.ids.next('TREATMENT')).toBe(ADDED_1);
  });

  it('운영 관리자 서비스의 새 치료 출처는 OPERATING 이다 (시험 자료 출처를 정하는 길이 없다)', () => {
    const { world } = buildWorld();
    const api = createOperatingServices({ repo: world.repo, log: silentLog, today: () => TEST_TODAY });
    const admin = createOperatingAdminServices({ api, clock: new FixedClock(), ids: new CounterIdGenerator() });
    expect(admin.newTreatmentOrigin).toBe('OPERATING');
  });

  it('게시 도중 저장소 쓰기가 실패하면 500 이고 모두 되돌려진다: 새 치료 기록·치료 버전·카탈로그·숨김·순서·초안·감사 기록', async () => {
    const world = setup('ha-clinic-1', { wrapRepo: (repo) => repoThrowingOn(repo, 'closeCatalogDraft').repo });
    await putDraft(world.admin, FULL_DRAFT());
    const confirmation = await previewConfirmation(world.admin);
    const before = world.world.repo.exportState();
    const response = await publish(world.admin, { publishConfirmation: confirmation });
    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: 'INTERNAL_ERROR' });
    expect(world.world.repo.exportState()).toEqual(before);
    expect(world.world.repo.listTreatments(TEST_FIXTURE_CLINIC_ID).map((treatment) => [treatment.id, treatment.active, treatment.sortOrder])).toEqual([
      [T1, true, 1],
      [T2, true, 1],
      [T3, true, 3],
    ]);
  });
});
