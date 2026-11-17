import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { publishCatalog } from '../../src/server/catalog-publish';
import { canonicalDigest } from '../../src/server/digest';
import { issuePublishConfirmation } from '../../src/server/publish-confirmation';
import { readReadiness } from '../../src/server/readiness';
import type { ReadinessContext } from '../../src/server/readiness';
import type { MemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1 } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG, TEST_ACCEPTED_ORIGINS, TEST_TODAY, publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_AMOUNT, BASE_FEE_ID, T1, T2 } from '../fixtures/server/base-fee.fixture';
import { T3, addThirdTreatment, repoThrowingOn } from '../fixtures/server/catalog-structure.fixture';
import { buildWorld, specOf } from '../fixtures/server/estimate-world.fixture';
import type { WorldPlan } from '../fixtures/server/estimate-world.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { OTHER_CLINIC_ID } from '../fixtures/server/versioning.fixture';

// 관리자 API 의 공통 기본비용 금액 수정 (M7): 같은 초안 → 미리보기 → 게시 흐름에 기본비용 금액이 함께 실린다. 모두 handleAdmin 을 지난다.
// 세계: 병원 1 에 치료 셋(T1·T2·T3)과 공통 기본비용 하나(BASE_FEE_ID, 5,000원)·승인된 매핑(T1·T2·기본비용)·게시된 규칙 묶음. 병원 2 는 따로 있고 자기 기본비용 하나를 가진다.
// 4세대 · 손해보험사로 T1 만 계산하면 병원 결제액은 치료 10,000 + 기본비용 5,000 = 15,000 이다.

const BASE = 'http://localhost/api/admin';
const CLINIC = `clinics/${TEST_FIXTURE_CLINIC_ID}`;
const OTHER = `clinics/${OTHER_CLINIC_ID}`;
const NOT_ISSUED = 'a'.repeat(64);
const PREVIEW_BODY = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const OTHER_FEE_ID = 'TEST_FIXTURE_FEE_OTHER_1';
const READINESS_CTX: ReadinessContext = { at: TEST_TODAY, acceptedOrigins: TEST_ACCEPTED_ORIGINS, digest: canonicalDigest };
const NEW_FEE_AMOUNT = 7_000;

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

function setup(account: TestAccountKey | null, options: { plan?: WorldPlan; wrapRepo?: (repo: MemoryRepository) => MemoryRepository } = {}) {
  const built = buildWorld(options.plan);
  publishSecondClinicCatalog(built.world);
  addThirdTreatment(built.world);
  const wrapped = options.wrapRepo === undefined ? built.world.repo : options.wrapRepo(built.world.repo);
  const world: World = { ...built.world, repo: wrapped, deps: { ...built.world.deps, repo: wrapped } };
  const services = adminServicesOf(world, { authenticator: staticAuthenticator(account === null ? null : identityOf(account)) });
  return { ...built, ...services };
}

type Setup = ReturnType<typeof setup>;

const putDraft = (admin: AdminOf, body: unknown, clinicPath = CLINIC): Promise<Response> => call(admin, 'PUT', `${clinicPath}/catalog/draft`, body);
const previewOf = (admin: AdminOf, body: unknown = PREVIEW_BODY): Promise<Response> => call(admin, 'POST', `${CLINIC}/catalog/preview`, body);
const publish = (admin: AdminOf, body: unknown): Promise<Response> => call(admin, 'POST', `${CLINIC}/catalog/publish`, body);
const listOf = async (admin: AdminOf, clinicPath = CLINIC): Promise<Json> => json(await call(admin, 'GET', `${clinicPath}/treatments`));
const feeBody = (amount: number, baseFeeId = BASE_FEE_ID) => ({ baseFeeEdits: [{ baseFeeId, amount }] });

async function previewConfirmation(admin: AdminOf, body: unknown): Promise<string> {
  const response = await previewOf(admin, body);
  expect(response.status).toBe(200);
  return (await json(response)).publishConfirmation as string;
}

const publicCatalog = async (world: Setup, slug = CLINIC_1_SLUG): Promise<Json> => json(await handleCatalog(world.api, slug));

/** 병원 1 의 공개 계산(키오스크 경로). catalogVersion 을 생략하면 지금의 현재 카탈로그다. */
async function publicEstimate(world: Setup, treatmentIds: string[], catalogVersion?: string): Promise<{ status: number; body: Json }> {
  const version = catalogVersion ?? ((await publicCatalog(world)).catalogVersion as string);
  const response = await handleEstimate(world.api, CLINIC_1_SLUG, () =>
    Promise.resolve({ catalogVersion: version, ruleBundleVersion: world.bundle!.id, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds }),
  );
  return { status: response.status, body: await json(response) };
}

/** 저장소 덤프에서 내용이 달라진 최상위 키. */
const changedKeys = (before: Record<string, unknown>, after: Record<string, unknown>): string[] =>
  Object.keys(after)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();

describe('인증·권한: 기본비용 수정도 같은 경계를 지난다 (저장 상태는 그대로)', () => {
  it('인증 없음 401', async () => {
    const world = setup(null);
    const before = world.world.repo.exportState();
    const response = await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    expect(response.status).toBe(401);
    expect(world.world.repo.exportState()).toEqual(before);
  });

  for (const [label, account] of [['다른 병원의 관리자(HA)', 'ha-clinic-2'], ['검토 담당자(RV)', 'rv-1'], ['플랫폼 운영자(PO)', 'po-1']] as const) {
    it(`${label} 는 이 병원의 기본비용 초안을 저장할 수 없다 (403)`, async () => {
      const world = setup(account);
      const before = world.world.repo.exportState();
      const response = await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
      expect(response.status).toBe(403);
      expect(world.world.repo.exportState()).toEqual(before);
    });
  }

  it('다른 병원 HA 가 자기 병원 경로로 이 병원의 baseFeeId 를 고치려 해도 거절한다 (없는 baseFeeId 와 같은 코드, 다른 병원의 존재를 드러내지 않는다)', async () => {
    const world = setup('ha-clinic-2');
    const before = world.world.repo.exportState();
    const response = await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT, BASE_FEE_ID), OTHER);
    expect(response.status).toBe(400);
    expect((await json(response)).defects).toEqual([{ code: 'BASE_FEE_NOT_IN_CATALOG', path: 'baseFeeEdits[0].baseFeeId' }]);
    const missing = await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT, 'NO_SUCH_FEE'), OTHER);
    expect((await json(missing)).defects).toEqual([{ code: 'BASE_FEE_NOT_IN_CATALOG', path: 'baseFeeEdits[0].baseFeeId' }]);
    expect(world.world.repo.exportState()).toEqual(before);
  });
});

describe('GET treatments: 기본비용 표시와 초안', () => {
  it('현재 게시 기본비용을 싣고, 초안이 없으면 draft 는 null 이다', async () => {
    const world = setup('ha-clinic-1');
    const list = await listOf(world.admin);
    expect(list.baseFees).toEqual([{ baseFeeId: BASE_FEE_ID, displayName: expect.any(String), benefitType: 'BENEFIT', amount: BASE_FEE_AMOUNT }]);
    expect(list.draft).toBeNull();
  });

  it('기본비용이 없는 병원은 baseFees 가 빈 목록이고, 어떤 baseFeeId 도 고칠 수 없다', async () => {
    const world = setup('ha-clinic-2');
    const current = world.world.repo.getClinicCurrentCatalogVersion(OTHER_CLINIC_ID)!;
    publishCatalog(
      world.world.deps,
      TEST_FIXTURE_HA_1,
      OTHER_CLINIC_ID,
      { treatmentVersions: current.treatmentVersionIds.map((id) => world.world.repo.getTreatmentVersion(id)!), commonBaseFees: [] },
      TEST_CATALOG_CONFIG,
    );
    expect((await listOf(world.admin, OTHER)).baseFees).toEqual([]);
    const before = world.world.repo.exportState();
    const response = await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT, OTHER_FEE_ID), OTHER);
    expect(response.status).toBe(400);
    expect((await json(response)).defects).toEqual([{ code: 'BASE_FEE_NOT_IN_CATALOG', path: 'baseFeeEdits[0].baseFeeId' }]);
    expect(world.world.repo.exportState()).toEqual(before);
  });
});

describe('PUT draft: 기본비용 금액 수정 저장', () => {
  it('200 이고 응답·목록의 draft 에 baseFeeEdits 가 담긴다. 저장은 초안 기록과 감사 기록만 바꾸고 공개 카탈로그·준비 상태·공개 계산은 전과 같다', async () => {
    const world = setup('ha-clinic-1');
    const stateBefore = world.world.repo.exportState();
    const catalogBefore = await publicCatalog(world);
    const readinessBefore = readReadiness(world.world.repo, READINESS_CTX);
    const estimateBefore = await publicEstimate(world, [T1]);
    expect(estimateBefore.body.result.amounts.hospitalPayment).toBe(10_000 + BASE_FEE_AMOUNT);

    const response = await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    expect(response.status).toBe(200);
    const draft = (await json(response)).draft as Json;
    expect(draft).toMatchObject({ stale: false, priceEdits: [], baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: NEW_FEE_AMOUNT }] });
    expect((await listOf(world.admin)).draft).toEqual(draft);

    expect(changedKeys(stateBefore, world.world.repo.exportState())).toEqual(['auditLog', 'catalogDrafts']);
    expect(await publicCatalog(world)).toEqual(catalogBefore);
    expect(readReadiness(world.world.repo, READINESS_CTX)).toEqual(readinessBefore);
    expect(await publicEstimate(world, [T1])).toEqual(estimateBefore);
    // 기본비용 버전도 만들지 않았다: 이 기본비용의 기록은 처음 버전 하나뿐이다.
    expect(world.world.repo.listCommonBaseFeeVersions(BASE_FEE_ID)).toHaveLength(1);
  });

  it('치료 가격·구조 편집과 같은 본문으로 함께 저장되고 함께 돌려받는다 (한 번의 저장이 원하는 초안 전체다)', async () => {
    const world = setup('ha-clinic-1');
    const body = { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], ...feeBody(NEW_FEE_AMOUNT), deactivations: [T2], order: [T3, T1] };
    const draft = (await json(await putDraft(world.admin, body))).draft as Json;
    expect(draft).toMatchObject({ priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: NEW_FEE_AMOUNT }], deactivations: [T2], order: [T3, T1] });
    // 같은 본문을 다시 저장해도 둘 다 남는다.
    const again = (await json(await putDraft(world.admin, body))).draft as Json;
    expect(again).toMatchObject({ priceEdits: draft.priceEdits, baseFeeEdits: draft.baseFeeEdits, deactivations: [T2], order: [T3, T1] });
    expect(again.draftDigest).toBe(draft.draftDigest);
  });

  it('PUT 은 초안 전체의 교체다: 기본비용 키가 없는 본문은 기본비용 수정을 비운다 (화면은 늘 전체를 보낸다)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], ...feeBody(NEW_FEE_AMOUNT) });
    const replaced = (await json(await putDraft(world.admin, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] }))).draft as Json;
    expect(replaced.baseFeeEdits).toEqual([]);
    expect(replaced.priceEdits).toEqual([{ treatmentId: T1, patientAmount: 12_000 }]);
  });

  it('현재 금액과 같은 수정은 변경이 아니다: 걸러지고, 변경이 하나도 없으면 400 NO_DRAFT_CHANGE 이다. 상한(10억)은 허용하고 0 도 허용한다', async () => {
    const world = setup('ha-clinic-1');
    const same = await putDraft(world.admin, feeBody(BASE_FEE_AMOUNT));
    expect(same.status).toBe(400);
    expect((await json(same)).defects).toEqual([{ code: 'NO_DRAFT_CHANGE', path: 'request' }]);
    const mixed = (await json(await putDraft(world.admin, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], ...feeBody(BASE_FEE_AMOUNT) }))).draft as Json;
    expect(mixed.baseFeeEdits).toEqual([]);
    for (const amount of [0, 1_000_000_000]) {
      const response = await putDraft(world.admin, feeBody(amount));
      expect(response.status, String(amount)).toBe(200);
      expect(((await json(response)).draft as Json).baseFeeEdits).toEqual([{ baseFeeId: BASE_FEE_ID, amount }]);
    }
  });

  const BAD: Array<[string, unknown, string, string]> = [
    ['음수 금액', feeBody(-1), 'VALUE_INVALID', 'baseFeeEdits[0].amount'],
    ['소수 금액', feeBody(1500.5), 'VALUE_INVALID', 'baseFeeEdits[0].amount'],
    ['문자열 금액', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: '7000' }] }, 'VALUE_INVALID', 'baseFeeEdits[0].amount'],
    ['null 금액', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: null }] }, 'VALUE_MISSING', 'baseFeeEdits[0].amount'],
    ['금액 없음', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID }] }, 'VALUE_MISSING', 'baseFeeEdits[0].amount'],
    ['상한(10억) 초과', feeBody(1_000_000_001), 'VALUE_INVALID', 'baseFeeEdits[0].amount'],
    ['안전 정수 밖 금액', feeBody(Number.MAX_SAFE_INTEGER + 2), 'VALUE_INVALID', 'baseFeeEdits[0].amount'],
    ['baseFeeId 없음', { baseFeeEdits: [{ amount: 7_000 }] }, 'VALUE_MISSING', 'baseFeeEdits[0].baseFeeId'],
    ['빈 baseFeeId', feeBody(7_000, ''), 'VALUE_INVALID', 'baseFeeEdits[0].baseFeeId'],
    ['없는 baseFeeId', feeBody(7_000, 'NO_SUCH_FEE'), 'BASE_FEE_NOT_IN_CATALOG', 'baseFeeEdits[0].baseFeeId'],
    ['다른 병원의 baseFeeId', feeBody(7_000, OTHER_FEE_ID), 'BASE_FEE_NOT_IN_CATALOG', 'baseFeeEdits[0].baseFeeId'],
    ['버전 id 를 baseFeeId 로 보냄', feeBody(7_000, `${BASE_FEE_ID}_V1`), 'BASE_FEE_NOT_IN_CATALOG', 'baseFeeEdits[0].baseFeeId'],
    ['치료 id 를 baseFeeId 로 보냄', feeBody(7_000, T1), 'BASE_FEE_NOT_IN_CATALOG', 'baseFeeEdits[0].baseFeeId'],
    ['같은 기본비용 두 번', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 7_000 }, { baseFeeId: BASE_FEE_ID, amount: 8_000 }] }, 'DUPLICATE_BASE_FEE_ID', 'baseFeeEdits[1].baseFeeId'],
    ['목록이 아님', { baseFeeEdits: { baseFeeId: BASE_FEE_ID, amount: 7_000 } }, 'NOT_ARRAY', 'baseFeeEdits'],
    ['항목이 객체가 아님', { baseFeeEdits: ['x'] }, 'NOT_OBJECT', 'baseFeeEdits[0]'],
    // 보장 판단 필드와 식별 필드는 요청이 정하지 못한다.
    ['코드를 바꾸려 함', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 7_000, code: 'X' }] }, 'UNKNOWN_FIELD', 'baseFeeEdits[0].code'],
    ['급여 구분을 바꾸려 함', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 7_000, benefitType: 'NON_BENEFIT' }] }, 'UNKNOWN_FIELD', 'baseFeeEdits[0].benefitType'],
    ['이름을 바꾸려 함', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 7_000, displayName: 'X' }] }, 'UNKNOWN_FIELD', 'baseFeeEdits[0].displayName'],
    ['병원 id 를 보냄', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 7_000, clinicId: OTHER_CLINIC_ID }] }, 'UNKNOWN_FIELD', 'baseFeeEdits[0].clinicId'],
    ['버전 id·출처를 보냄', { baseFeeEdits: [{ baseFeeId: BASE_FEE_ID, amount: 7_000, id: 'FORGED', origin: 'OPERATING' }] }, 'UNKNOWN_FIELD', 'baseFeeEdits[0].id'],
    ['새 기본비용 등록 시도(amount 와 이름)', { baseFeeEdits: [{ baseFeeId: 'BRAND_NEW_FEE', amount: 7_000, displayName: '새 기본비용' }] }, 'UNKNOWN_FIELD', 'baseFeeEdits[0].displayName'],
    ['새 기본비용 등록 시도(없는 id)', feeBody(7_000, 'BRAND_NEW_FEE'), 'BASE_FEE_NOT_IN_CATALOG', 'baseFeeEdits[0].baseFeeId'],
  ];
  it.each(BAD)('400: %s — 어긋난 경로와 함께 거절되고 저장 상태(기존 초안 포함)는 그대로다', async (_name, body, code, path) => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const before = world.world.repo.exportState();
    const response = await putDraft(world.admin, body);
    expect(response.status).toBe(400);
    const parsed = await json(response);
    expect(parsed.error).toBe('INVALID_REQUEST');
    expect(parsed.defects).toContainEqual({ code, path });
    expect(world.world.repo.exportState()).toEqual(before);
    expect((await listOf(world.admin)).draft.priceEdits).toEqual([{ treatmentId: T1, patientAmount: 12_000 }]);
  });
});

describe('POST preview: 기본비용 수정은 계산한 미리보기로만 확인값을 받는다', () => {
  it('계산할 치료 없이는 확인값을 내지 않는다: treatmentIds 를 생략해도, 숨기는 치료만 골라도 400 이고 저장소는 그대로다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { ...feeBody(NEW_FEE_AMOUNT), deactivations: [T2] });
    const before = world.world.repo.exportState();
    const omitted = await previewOf(world.admin);
    expect(omitted.status).toBe(400);
    const omittedBody = await json(omitted);
    expect(omittedBody.defects).toContainEqual({ code: 'BASE_FEE_PREVIEW_NEEDS_TREATMENT', path: 'request.treatmentIds' });
    expect(JSON.stringify(omittedBody)).not.toContain('publishConfirmation');

    const hiddenOnly = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T2] });
    expect(hiddenOnly.status).toBe(400);
    expect(JSON.stringify(await json(hiddenOnly))).not.toContain('publishConfirmation');
    const empty = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [] });
    expect(empty.status).toBe(400);
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('치료를 고르면 같은 엔진으로 현재 게시본(옛 금액)과 초안 적용본(새 금액)을 계산하고 변경 목록에 기본비용이 나온다. 읽기만 한다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    const before = world.world.repo.exportState();
    const response = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
    expect(response.status).toBe(200);
    const preview = await json(response);
    expect(world.world.repo.exportState()).toEqual(before);
    // 읽기만 한다: 새 기본비용 버전 id 를 만들지 않았다.
    expect(world.world.ids.next('COMMON_BASE_FEE_VERSION')).toBe('TEST_FIXTURE_COMMON_BASE_FEE_VERSION_1');

    expect(preview.request.treatmentIds).toEqual([T1]);
    expect(preview.priceChanges).toEqual([]);
    expect(preview.changes.baseFeeChanges).toEqual([{ baseFeeId: BASE_FEE_ID, displayName: expect.any(String), before: BASE_FEE_AMOUNT, after: NEW_FEE_AMOUNT }]);
    expect(preview.before.result.state).toBe('ESTIMATED');
    expect(preview.after.result.state).toBe('ESTIMATED');
    expect(preview.before.result.amounts.hospitalPayment).toBe(10_000 + BASE_FEE_AMOUNT);
    expect(preview.after.result.amounts.hospitalPayment).toBe(10_000 + NEW_FEE_AMOUNT);
    expect(preview.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
    // 목록은 치료 목록 그대로다(기본비용은 치료가 아니다).
    expect(preview.afterList).toEqual(preview.beforeList);
  });

  it('가격을 바꾼 치료를 계산에서 빼면 기본비용이 함께 있어도 400 CHANGED_TREATMENT_NOT_INCLUDED 이다 (기존 방어 유지)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], ...feeBody(NEW_FEE_AMOUNT) });
    const before = world.world.repo.exportState();
    const response = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T3] });
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(body.defects).toContainEqual({ code: 'CHANGED_TREATMENT_NOT_INCLUDED', path: 'request.treatmentIds' });
    expect(JSON.stringify(body)).not.toContain('publishConfirmation');
    expect(world.world.repo.exportState()).toEqual(before);
    // 생략하면 변경 치료가 자동으로 들어가 계산된다(기본비용은 자동 포함).
    const auto = await json(await previewOf(world.admin));
    expect(auto.request.treatmentIds).toEqual([T1]);
    expect(auto.after.result.amounts.hospitalPayment).toBe(12_000 + NEW_FEE_AMOUNT);
  });
});

describe('POST publish: 기본비용 금액 수정 게시', () => {
  it('한 바퀴: 저장 → 공개 계산 불변 → 미리보기 없이 게시 거절 → 미리보기 → 게시 → 새 기본비용과 병원 결제액이 공개 계산에 반영된다', async () => {
    const world = setup('ha-clinic-1');
    const oldCatalog = await publicCatalog(world);
    const oldVersion = oldCatalog.catalogVersion as string;
    const oldFeeVersionId = world.catalog.baseFeeIds[0]!;
    const itemsBefore = { versions: world.world.repo.exportState().itemVersions, states: world.world.repo.exportState().itemStates };
    const otherBefore = { catalog: await publicCatalog(world, CLINIC_2_SLUG), current: world.world.repo.getClinicCurrentCatalogVersion(OTHER_CLINIC_ID)!.id };

    // 1) 초안 저장: 공개 계산·카탈로그 불변.
    expect((await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT))).status).toBe(200);
    expect(await publicCatalog(world)).toEqual(oldCatalog);
    expect((await publicEstimate(world, [T1])).body.result.amounts.hospitalPayment).toBe(15_000);

    // 2) 미리보기 없이 게시 거절 (발급된 적 없는 값 · 빈 본문).
    const beforeRejected = world.world.repo.exportState();
    const rejected = await publish(world.admin, { publishConfirmation: NOT_ISSUED });
    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    expect((await publish(world.admin, {})).status).toBe(400);
    expect(world.world.repo.exportState()).toEqual(beforeRejected);
    expect((await publicEstimate(world, [T1])).body.result.amounts.hospitalPayment).toBe(15_000);

    // 3) 미리보기 → 게시.
    const confirmation = await previewConfirmation(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
    const response = await publish(world.admin, { publishConfirmation: confirmation });
    expect(response.status).toBe(200);
    const published = await json(response);
    expect(published.catalogVersion).not.toBe(oldVersion);
    expect(published.changeSummary).toEqual({ addedTreatmentIds: [], removedTreatmentIds: [], priceChangedTreatmentIds: [], baseFeesChanged: true });

    // 4) 새 카탈로그: 같은 baseFeeId 의 새 버전 id, 새 금액. 옛 버전 기록은 그대로 남는다.
    const catalog = world.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
    expect(catalog.id).toBe(published.catalogVersion);
    expect(catalog.baseFeeIds).toHaveLength(1);
    expect(catalog.baseFeeIds[0]).not.toBe(oldFeeVersionId);
    expect(catalog.baseFeeIds[0]).toBe('TEST_FIXTURE_COMMON_BASE_FEE_VERSION_1');
    const fee = world.world.repo.getCommonBaseFee(catalog.baseFeeIds[0]!)!;
    const oldFee = world.world.repo.getCommonBaseFee(oldFeeVersionId)!;
    expect(fee).toEqual({ ...oldFee, id: catalog.baseFeeIds[0], amount: NEW_FEE_AMOUNT });
    expect(oldFee.amount).toBe(BASE_FEE_AMOUNT);

    // 5) 공개 계산: 새 기본비용이 병원 결제액에 들어간다. 치료 가격·다른 줄은 그대로다.
    const live = await publicEstimate(world, [T1]);
    expect(live.status).toBe(200);
    expect(live.body.result.state).toBe('ESTIMATED');
    expect(live.body.result.amounts.hospitalPayment).toBe(10_000 + NEW_FEE_AMOUNT);
    expect((await publicEstimate(world, [T1, T2])).body.result.amounts.hospitalPayment).toBe(20_000 + NEW_FEE_AMOUNT);
    expect((await publicCatalog(world)).treatments.map((row: Json) => [row.treatmentId, row.patientAmount])).toEqual(oldCatalog.treatments.map((row: Json) => [row.treatmentId, row.patientAmount]));

    // 6) 보장 판단·매핑 상태는 그대로다: 항목 버전·항목 상태 기록이 한 글자도 바뀌지 않았다.
    expect({ versions: world.world.repo.exportState().itemVersions, states: world.world.repo.exportState().itemStates }).toEqual(itemsBefore);

    // 7) 초안은 닫혔고 감사 기록이 남았다. 다른 병원은 그대로다.
    expect((await listOf(world.admin)).draft).toBeNull();
    expect(world.world.repo.listAuditLog().map((entry) => entry.action)).toContain('CATALOG_DRAFT_PUBLISH');
    expect(await publicCatalog(world, CLINIC_2_SLUG)).toEqual(otherBefore.catalog);
    expect(world.world.repo.getClinicCurrentCatalogVersion(OTHER_CLINIC_ID)!.id).toBe(otherBefore.current);
  });

  it('옛 카탈로그 버전을 든 공개 계산 요청은 게시 뒤 409 이고, 새 버전으로 다시 보내면 새 금액이다', async () => {
    const world = setup('ha-clinic-1');
    const oldVersion = (await publicCatalog(world)).catalogVersion as string;
    await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    const confirmation = await previewConfirmation(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
    expect((await publish(world.admin, { publishConfirmation: confirmation })).status).toBe(200);
    const stale = await publicEstimate(world, [T1], oldVersion);
    expect(stale.status).toBe(409);
    expect((await publicEstimate(world, [T1])).body.result.amounts.hospitalPayment).toBe(10_000 + NEW_FEE_AMOUNT);
  });

  it('치료 가격 수정·숨김·순서와 기본비용 수정이 함께 게시되고 함께 보존된다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], ...feeBody(NEW_FEE_AMOUNT), deactivations: [T2], order: [T3, T1] });
    const preview = await json(await previewOf(world.admin));
    expect(preview.request.treatmentIds).toEqual([T1]);
    expect(preview.after.result.amounts.hospitalPayment).toBe(12_000 + NEW_FEE_AMOUNT);
    const response = await publish(world.admin, { publishConfirmation: preview.publishConfirmation });
    expect(response.status).toBe(200);
    expect((await json(response)).changeSummary).toMatchObject({ priceChangedTreatmentIds: [T1], baseFeesChanged: true, deactivatedTreatmentIds: [T2], reorderedTreatmentIds: [T1, T3] });
    const catalog = await publicCatalog(world);
    expect(catalog.treatments.map((row: Json) => [row.treatmentId, row.patientAmount, row.order])).toEqual([[T3, 11_000, 1], [T1, 12_000, 2]]);
    expect((await publicEstimate(world, [T1])).body.result.amounts.hospitalPayment).toBe(12_000 + NEW_FEE_AMOUNT);
    expect((await publicEstimate(world, [T3])).body.result.amounts.hospitalPayment).toBe(11_000 + NEW_FEE_AMOUNT);
  });

  it('확인값은 기본비용 수정에 묶인다: 금액만 다른 초안·기본비용만 비운 초안·같은 내용을 다시 저장한 초안 모두 앞선 확인값으로 게시할 수 없다 (409 PREVIEW_REQUIRED)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    const confirmationA = await previewConfirmation(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });

    await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT + 1));
    expect((await publish(world.admin, { publishConfirmation: confirmationA })).status).toBe(409);

    await putDraft(world.admin, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    expect((await publish(world.admin, { publishConfirmation: confirmationA })).status).toBe(409);

    await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    const resaved = await publish(world.admin, { publishConfirmation: confirmationA });
    expect(resaved.status).toBe(409);
    expect(await json(resaved)).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    expect(await publicEstimate(world, [T1])).toMatchObject({ body: { result: { amounts: { hospitalPayment: 15_000 } } } });
  });

  it('초안이 근거한 카탈로그가 그 사이 바뀌었으면 미리보기도 게시도 409 DRAFT_STALE 이고 새 기본비용 버전이 생기지 않는다', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    const confirmation = await previewConfirmation(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
    // 이 API 밖에서 같은 병원의 카탈로그가 다시 게시되었다.
    const current = world.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
    publishCatalog(
      world.world.deps,
      TEST_FIXTURE_HA_1,
      TEST_FIXTURE_CLINIC_ID,
      { treatmentVersions: current.treatmentVersionIds.map((id) => world.world.repo.getTreatmentVersion(id)!), commonBaseFees: current.baseFeeIds.map((id) => world.world.repo.getCommonBaseFee(id)!) },
      TEST_CATALOG_CONFIG,
    );
    const before = world.world.repo.exportState();
    const preview = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
    expect(preview.status).toBe(409);
    expect(await json(preview)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
    const published = await publish(world.admin, { publishConfirmation: confirmation });
    expect(published.status).toBe(409);
    expect(await json(published)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
    expect(world.world.repo.exportState()).toEqual(before);
    expect((await listOf(world.admin)).draft.stale).toBe(true);
  });

  it('저장 뒤 현재 카탈로그의 기본비용 구성이 달라져 초안의 baseFeeId 가 없어졌으면 미리보기도 게시도 409 DRAFT_STALE 이다 (같은 카탈로그 id 여도)', async () => {
    const world = setup('ha-clinic-1');
    await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    const confirmation = await previewConfirmation(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
    // 저장 시점의 초안을 저장소에서 직접 비틀어(가져오기 결함 모사) 현재 카탈로그에 없는 baseFeeId 를 가리키게 한다. 저장소 백스톱은 이 병원의 기본비용만 받으므로 같은 병원의 다른 id 로 둔다.
    const draft = world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)!;
    world.world.repo.putCommonBaseFee({ id: 'TEST_FIXTURE_FEE_UNLISTED_V1', baseFeeId: 'TEST_FIXTURE_FEE_UNLISTED', clinicId: TEST_FIXTURE_CLINIC_ID, displayName: '목록에 없는 기본비용', benefitType: 'BENEFIT', amount: 1_000, code: 'X', origin: 'TEST_FIXTURE' });
    world.world.repo.saveCatalogDraft({ ...draft, baseFeeEdits: [{ baseFeeId: 'TEST_FIXTURE_FEE_UNLISTED', amount: 2_000 }] });
    const before = world.world.repo.exportState();
    const preview = await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
    expect(preview.status).toBe(409);
    expect(await json(preview)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
    expect((await publish(world.admin, { publishConfirmation: confirmation })).status).toBe(409);
    // 비틀어 둔 초안에 대해 서버가 발급했을 확인값(유효한 값)을 직접 계산해도 게시는 낡은 초안으로 거절한다: 확인값이 맞는 것과 초안이 현재 카탈로그에 맞는 것은 따로 본다.
    const tampered = world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)!;
    const valid = issuePublishConfirmation(tampered, identityOf('ha-clinic-1').userId);
    const stale = await publish(world.admin, { publishConfirmation: valid });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('기본비용 매핑이 없는 병원은 게시 뒤에도 보류(ON_HOLD)가 그대로다: 임의로 보장되는 것으로 바뀌지 않고, 금액만 병원 결제액에 반영된다', async () => {
    const world = setup('ha-clinic-1', { plan: { spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }, { target: T2, kind: 'COVERED' }] }) } });
    const before = await publicEstimate(world, [T1]);
    expect(before.body.result.state).toBe('ON_HOLD');
    expect(before.body.result.holdReasons.length).toBeGreaterThan(0);
    expect(before.body.result.amounts.expectedInsurancePayout).toBeNull();

    await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
    const preview = await json(await previewOf(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] }));
    expect(preview.before.result.state).toBe('ON_HOLD');
    expect(preview.after.result.state).toBe('ON_HOLD');
    expect(preview.after.result.holdReasons).toEqual(preview.before.result.holdReasons);
    expect(preview.after.result.amounts.expectedInsurancePayout).toBeNull();
    const itemsBefore = world.world.repo.exportState().itemStates;
    expect((await publish(world.admin, { publishConfirmation: preview.publishConfirmation })).status).toBe(200);

    const live = await publicEstimate(world, [T1]);
    expect(live.body.result.state).toBe('ON_HOLD');
    expect(live.body.result.holdReasons).toEqual(before.body.result.holdReasons);
    expect(live.body.result.amounts.expectedInsurancePayout).toBeNull();
    expect(live.body.result.amounts.hospitalPayment).toBe(10_000 + NEW_FEE_AMOUNT);
    expect(world.world.repo.exportState().itemStates).toEqual(itemsBefore);
  });

  it('게시 도중 저장소 쓰기가 실패하면 500 이고 모두 되돌려진다: 새 기본비용 버전·카탈로그·초안·감사 기록', async () => {
    for (const method of ['putCommonBaseFee', 'putCatalogVersion', 'closeCatalogDraft']) {
      const world = setup('ha-clinic-1', { wrapRepo: (repo) => repoThrowingOn(repo, method).repo });
      await putDraft(world.admin, feeBody(NEW_FEE_AMOUNT));
      const confirmation = await previewConfirmation(world.admin, { ...PREVIEW_BODY, treatmentIds: [T1] });
      const before = world.world.repo.exportState();
      const response = await publish(world.admin, { publishConfirmation: confirmation });
      expect(response.status, method).toBe(500);
      expect(world.world.repo.exportState(), method).toEqual(before);
      expect((await publicEstimate(world, [T1])).body.result.amounts.hospitalPayment, method).toBe(15_000);
    }
  });
});
