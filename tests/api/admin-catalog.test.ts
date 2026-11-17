import { describe, expect, it } from 'vitest';
import { handleAdmin } from '../../src/server/admin/router';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { silentLog } from '../../src/server/api/log';
import { createOperatingAdminServices, createOperatingServices } from '../../src/server/composition';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { T1, T2 } from '../fixtures/server/base-fee.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { CounterIdGenerator, FixedClock } from '../fixtures/server/clock.fixture';
import { makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';

// 관리자 API (M7 첫 기능): 인증 401, 권한·병원 소속 403, 잘못된 입력 400, 충돌 409, 그리고 가격 수정 → 초안 저장 → 미리보기 → 게시 → 공개 카탈로그·계산 반영의 한 바퀴.
// 처리 순서(인증 → 경로 → 소속·역할 → 병원 존재 → 본문)와 "거절은 저장소를 쓰지 않는다"를 저장소 전체 비교로 본다.

const BASE = 'http://localhost/api/admin';

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function call(admin: ReturnType<typeof adminServicesOf>['admin'], method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const segments = path.split('/').filter((part) => part !== '').map(decodeURIComponent);
  const init: RequestInit = { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return handleAdmin(admin, new Request(`${BASE}/${path}`, init), segments);
}

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

function setup(account: TestAccountKey | null, options: { linesOrigins?: ('OPERATING' | 'TEST_FIXTURE' | 'DEMO')[] } = {}) {
  const built = buildWorld();
  publishSecondClinicCatalog(built.world);
  const services = adminServicesOf(built.world, {
    authenticator: staticAuthenticator(account === null ? null : identityOf(account)),
    ...(options.linesOrigins === undefined ? {} : { api: { acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: options.linesOrigins } } }),
  });
  return { ...built, ...services };
}

const CLINIC = `clinics/${TEST_FIXTURE_CLINIC_ID}`;
/** 형식(소문자 16진수 64자)은 맞지만 서버가 발급한 적 없는 값. */
const NOT_ISSUED = 'a'.repeat(64);
const PREVIEW_BODY = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const ROUTES: Array<[string, string, unknown]> = [
  ['GET', 'session', undefined],
  ['GET', `${CLINIC}/treatments`, undefined],
  ['PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] }],
  ['DELETE', `${CLINIC}/catalog/draft`, undefined],
  ['POST', `${CLINIC}/catalog/preview`, { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' }],
  ['POST', `${CLINIC}/catalog/publish`, { publishConfirmation: NOT_ISSUED }],
  ['GET', `${CLINIC}/catalog/versions`, undefined],
];

const estimateBody = (catalogVersion: string, bundleId: string, treatmentIds: string[]) => ({ catalogVersion, ruleBundleVersion: bundleId, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds });

async function publicEstimate(world: ReturnType<typeof setup>, catalogVersion: string, treatmentIds: string[]): Promise<{ status: number; body: Json }> {
  const response = await handleEstimate(world.api, CLINIC_1_SLUG, () => Promise.resolve(estimateBody(catalogVersion, world.bundle!.id, treatmentIds)));
  return { status: response.status, body: await json(response) };
}

async function publicCatalog(world: ReturnType<typeof setup>): Promise<Json> {
  return json(await handleCatalog(world.api, CLINIC_1_SLUG));
}

type AdminOf = ReturnType<typeof adminServicesOf>['admin'];

/** 실제 미리보기 API 를 불러 성공을 확인하고, 그 응답이 준 게시 확인값을 돌려준다. */
async function previewConfirmation(admin: AdminOf, clinicPath: string = CLINIC): Promise<string> {
  const response = await call(admin, 'POST', `${clinicPath}/catalog/preview`, PREVIEW_BODY);
  expect(response.status).toBe(200);
  return (await json(response)).publishConfirmation as string;
}

const saveT1 = (admin: AdminOf, amount = 12_000): Promise<Response> => call(admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: amount }] });
const publish = (admin: AdminOf, body: unknown): Promise<Response> => call(admin, 'POST', `${CLINIC}/catalog/publish`, body);

describe('401: 인증이 없으면 모든 관리자 요청이 거절되고 저장 상태는 그대로다', () => {
  it.each(ROUTES)('%s /api/admin/%s', async (method, path, body) => {
    const world = setup(null);
    const before = world.world.repo.exportState();
    const response = await call(world.admin, method, path, body);
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: 'UNAUTHENTICATED' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('없는 경로·없는 병원도 인증 전에는 401 이다(존재를 알리지 않는다)', async () => {
    const world = setup(null);
    expect((await call(world.admin, 'GET', 'nowhere')).status).toBe(401);
    expect((await call(world.admin, 'GET', 'clinics/NO_SUCH/treatments')).status).toBe(401);
  });

  it('역할·병원·사용자를 헤더·쿼리·본문으로 주장해도 인증되지 않는다 (위조 시도 401)', async () => {
    const world = setup(null);
    const before = world.world.repo.exportState();
    const spoof = { 'x-role': 'HA', 'x-clinic-id': TEST_FIXTURE_CLINIC_ID, 'x-user-id': 'TEST_FIXTURE_HA_1', authorization: 'Bearer HA', cookie: 'role=HA; bodam_test_session=forged' };
    const response = await handleAdmin(
      world.admin,
      new Request(`${BASE}/${CLINIC}/catalog/draft?role=HA&clinicId=${TEST_FIXTURE_CLINIC_ID}&userId=TEST_FIXTURE_HA_1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...spoof },
        body: JSON.stringify({ role: 'HA', actor: { id: 'TEST_FIXTURE_HA_1', role: 'HA' }, priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] }),
      }),
      ['clinics', TEST_FIXTURE_CLINIC_ID, 'catalog', 'draft'],
    );
    expect(response.status).toBe(401);
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('인증기가 던지거나 신원 모양이 아닌 값을 내면 인증된 것으로 보지 않는다 (닫힌 쪽으로 실패)', async () => {
    const world = setup('ha-clinic-1');
    const throwing = { ...world.admin, authenticator: { authenticate: () => Promise.reject(new Error('공급자 장애')) } };
    expect((await call(throwing, 'GET', `${CLINIC}/treatments`)).status).toBe(401);
    for (const garbage of [{}, { userId: '', memberships: [] }, { userId: 'U', memberships: 'HA' }, 'HA']) {
      const odd = { ...world.admin, authenticator: { authenticate: () => Promise.resolve(garbage as never) } };
      expect((await call(odd, 'GET', `${CLINIC}/treatments`)).status).toBe(401);
    }
  });
});

describe('운영 구성: 인증 공급자가 연결되기 전에는 관리자 기능을 쓸 수 없다', () => {
  it('운영 관리자 서비스는 어떤 요청도 인증하지 않는다 (시험 쿠키·헤더 위조 포함 전부 401, 저장 상태 불변)', async () => {
    const { world } = buildWorld();
    const api = createOperatingServices({ repo: world.repo, log: silentLog, today: () => '2026-10-15' });
    const admin = createOperatingAdminServices({ api, clock: new FixedClock(), ids: new CounterIdGenerator() });
    const before = world.repo.exportState();
    for (const [method, path, body] of ROUTES) {
      const response = await call(admin, method, path, body, { cookie: 'bodam_test_session=TEST_FIXTURE_SESSION_1_ha-clinic-1', 'x-role': 'HA' });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(world.repo.exportState()).toEqual(before);
  });
});

describe('403: 역할이나 병원 소속이 맞지 않으면 거절되고 저장 상태는 그대로다', () => {
  const FORBIDDEN: Array<[string, TestAccountKey, string]> = [
    ['다른 병원의 관리자(HA)', 'ha-clinic-2', CLINIC],
    ['검토 담당자(RV)', 'rv-1', CLINIC],
    ['플랫폼 운영자(PO)', 'po-1', CLINIC],
  ];
  for (const [label, account, clinicPath] of FORBIDDEN) {
    it.each(ROUTES.filter(([, path]) => path !== 'session'))(`${label}: %s /api/admin/%s`, async (method, path, body) => {
      const world = setup(account);
      const before = world.world.repo.exportState();
      const response = await call(world.admin, method, path.replace(CLINIC, clinicPath), body);
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: 'FORBIDDEN' });
      expect(world.world.repo.exportState()).toEqual(before);
    });
  }

  it('소속이 없는 병원은 존재하지 않아도 403 이다 (병원 존재 여부를 알리지 않는다)', async () => {
    const world = setup('ha-clinic-1');
    expect((await call(world.admin, 'GET', 'clinics/NO_SUCH_CLINIC/treatments')).status).toBe(403);
    expect((await call(world.admin, 'GET', `clinics/${OTHER_CLINIC_ID}/treatments`)).status).toBe(403);
  });

  it('권한 있는 요청과 같은 모양의 위조 헤더(x-role 등)는 판정에 쓰이지 않는다: RV 가 x-role: HA 를 붙여도 403', async () => {
    const world = setup('rv-1');
    const before = world.world.repo.exportState();
    const response = await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] }, { 'x-role': 'HA', 'x-clinic-id': TEST_FIXTURE_CLINIC_ID });
    expect(response.status).toBe(403);
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('병원 2 의 관리자는 자기 병원의 치료 목록을 본다(소속이 맞으면 허용)', async () => {
    const world = setup('ha-clinic-2');
    const response = await call(world.admin, 'GET', `clinics/${OTHER_CLINIC_ID}/treatments`);
    expect(response.status).toBe(200);
    expect((await json(response)).treatments.map((row: Json) => row.treatmentId)).toEqual([OTHER_CLINIC_TREATMENT_ID]);
  });
});

describe('경로와 메서드', () => {
  it('모르는 경로 404, 허용하지 않는 메서드 405 (인증된 요청에서만)', async () => {
    const world = setup('ha-clinic-1');
    expect((await call(world.admin, 'GET', 'nowhere')).status).toBe(404);
    expect((await call(world.admin, 'GET', `${CLINIC}/catalog/publish`)).status).toBe(405);
    expect((await call(world.admin, 'POST', 'session')).status).toBe(405);
  });

  it('소속은 맞지만 저장소에 없는 병원이면 404 이다', async () => {
    const built = buildWorld();
    const services = adminServicesOf(built.world, { authenticator: staticAuthenticator({ userId: 'U', memberships: [{ clinicId: 'GHOST_CLINIC', role: 'HA' }] }) });
    expect((await call(services.admin, 'GET', 'clinics/GHOST_CLINIC/treatments')).status).toBe(404);
  });

  it('GET session 은 검증된 신원만 돌려준다', async () => {
    const world = setup('ha-clinic-1');
    const response = await call(world.admin, 'GET', 'session');
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ userId: 'TEST_FIXTURE_HA_CLINIC_1', memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'HA' }] });
  });
});

describe('가격 수정 → 초안 저장 → 미리보기 → 게시 → 공개 카탈로그·계산 반영', () => {
  it('한 바퀴: 초안은 공개 가격을 바꾸지 않고, 미리보기는 같은 엔진으로 게시 뒤 계산을 보이며, 게시 뒤에만 새 카탈로그와 계산이 바뀐다', async () => {
    const world = setup('ha-clinic-1');
    const oldCatalog = await publicCatalog(world);
    const oldVersion = oldCatalog.catalogVersion as string;
    expect(oldCatalog.treatments.map((row: Json) => [row.treatmentId, row.patientAmount])).toEqual([[T1, 10_000], [T2, 10_000]]);

    // 1) 기존 가격 확인
    const list = await json(await call(world.admin, 'GET', `${CLINIC}/treatments`));
    expect(list.catalogVersion).toBe(oldVersion);
    expect(list.treatments.map((row: Json) => [row.treatmentId, row.patientAmount])).toEqual([[T1, 10_000], [T2, 10_000]]);
    expect(list.draft).toBeNull();
    expect(list.treatments[0]).toMatchObject({ benefitType: 'BENEFIT', treatmentCode: expect.any(String), procedureCodes: expect.any(Array) });
    expect(JSON.stringify(list)).not.toMatch(/fingerprint|approvedFingerprint|origin|TEST_FIXTURE_RV/i);

    // 2) 초안 저장
    const saved = await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    expect(saved.status).toBe(200);
    const draft = (await json(saved)).draft as Json;
    expect(draft).toMatchObject({ baseCatalogVersionId: oldVersion, stale: false, priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });

    // 3) 키오스크(공개 API)는 아직 옛 가격과 옛 버전이다
    const stillOld = await publicCatalog(world);
    expect(stillOld.catalogVersion).toBe(oldVersion);
    expect(stillOld.treatments.map((row: Json) => row.patientAmount)).toEqual([10_000, 10_000]);
    const oldEstimate = await publicEstimate(world, oldVersion, [T1]);
    expect(oldEstimate.status).toBe(200);
    expect(oldEstimate.body.result.amounts.hospitalPayment).toBe(15_000); // 치료 10,000 + 공통 기본비용 5,000

    // 4) 미리보기: 같은 엔진으로 현재와 초안 계산을 나란히 (읽기만 한다)
    const stateBeforePreview = world.world.repo.exportState();
    const previewResponse = await call(world.admin, 'POST', `${CLINIC}/catalog/preview`, { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' });
    expect(previewResponse.status).toBe(200);
    const preview = await json(previewResponse);
    expect(world.world.repo.exportState()).toEqual(stateBeforePreview);
    expect(preview.basedOnCatalogVersion).toBe(oldVersion);
    expect(preview.request.treatmentIds).toEqual([T1]);
    expect(preview.priceChanges).toEqual([{ treatmentId: T1, displayName: expect.any(String), before: 10_000, after: 12_000 }]);
    expect(preview.before.result.state).toBe('ESTIMATED');
    expect(preview.after.result.state).toBe('ESTIMATED');
    expect(preview.before.result.amounts.hospitalPayment).toBe(15_000);
    expect(preview.after.result.amounts.hospitalPayment).toBe(17_000);
    expect(preview.after.result.amounts.expectedInsurancePayout).not.toBe(preview.before.result.amounts.expectedInsurancePayout);
    // 상태 비교용 지문은 목록·저장 응답과 같지만, 게시 확인값은 그것과 다른 값이다(지문으로는 게시할 수 없다).
    expect(preview.draftDigest).toBe(draft.draftDigest);
    expect(preview.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.publishConfirmation).not.toBe(draft.draftDigest);
    // 미리보기 계산은 공개 계산과 같은 결과를 낸다(현재 카탈로그 쪽 before 가 위의 공개 계산과 같다).
    expect(preview.before.result.amounts).toEqual(oldEstimate.body.result.amounts);

    // 5) 게시
    const published = await publish(world.admin, { publishConfirmation: preview.publishConfirmation });
    expect(published.status).toBe(200);
    const publishedBody = await json(published);
    expect(publishedBody.catalogVersion).not.toBe(oldVersion);
    expect(publishedBody.changeSummary.priceChangedTreatmentIds).toEqual([T1]);

    // 6) 새 카탈로그와 계산 결과 반영
    const newCatalog = await publicCatalog(world);
    expect(newCatalog.catalogVersion).toBe(publishedBody.catalogVersion);
    expect(newCatalog.treatments.map((row: Json) => [row.treatmentId, row.patientAmount])).toEqual([[T1, 12_000], [T2, 10_000]]);
    const newEstimate = await publicEstimate(world, newCatalog.catalogVersion as string, [T1]);
    expect(newEstimate.status).toBe(200);
    expect(newEstimate.body.result.state).toBe('ESTIMATED');
    expect(newEstimate.body.result.amounts).toEqual(preview.after.result.amounts);
    // 옛 버전을 본 키오스크 요청은 409 로 가격이 바뀌었음을 알린다.
    const stale = await publicEstimate(world, oldVersion, [T1]);
    expect(stale.status).toBe(409);
    expect(stale.body.changes.priceChanged).toBe(true);
    // 게시 뒤 초안은 없고 이력에 새 버전이 현재로 나온다.
    const after = await json(await call(world.admin, 'GET', `${CLINIC}/treatments`));
    expect(after.draft).toBeNull();
    const versions = (await json(await call(world.admin, 'GET', `${CLINIC}/catalog/versions`))).versions as Json[];
    expect(versions.map((row) => [row.id, row.current])).toEqual([[publishedBody.catalogVersion, true], [oldVersion, false]]);
    expect(versions[0]).toMatchObject({ publishedBy: 'TEST_FIXTURE_HA_CLINIC_1', changeSummary: { priceChangedTreatmentIds: [T1] } });
  });

  it('두 번째 병원의 가격·카탈로그는 첫 병원의 게시에 영향을 받지 않는다 (병원 격리)', async () => {
    const world = setup('ha-clinic-1');
    const other = world.world.repo.getClinicCurrentCatalogVersion(OTHER_CLINIC_ID)!;
    await saveT1(world.admin);
    const confirmation = await previewConfirmation(world.admin);
    expect((await publish(world.admin, { publishConfirmation: confirmation })).status).toBe(200);
    expect(world.world.repo.getClinicCurrentCatalogVersion(OTHER_CLINIC_ID)).toEqual(other);
  });

  it('초안을 버리면 GET 의 draft 가 null 이고 공개 가격은 그대로다', async () => {
    const world = setup('ha-clinic-1');
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T2, patientAmount: 1 }] });
    const response = await call(world.admin, 'DELETE', `${CLINIC}/catalog/draft`);
    expect(await json(response)).toEqual({ discarded: true });
    expect((await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft).toBeNull();
    expect((await json(await call(world.admin, 'DELETE', `${CLINIC}/catalog/draft`)))).toEqual({ discarded: false });
  });

  it('모든 응답은 no-store, application/json 이다 (성공·거절 모두)', async () => {
    const world = setup('ha-clinic-1');
    for (const [method, path, body] of ROUTES) {
      const response = await call(world.admin, method, path, body);
      expect(response.headers.get('cache-control'), `${method} ${path}`).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('application/json');
    }
  });
});

describe('400: 잘못된 입력은 어긋난 필드 경로와 함께 거절되고 저장 상태는 그대로다', () => {
  const BAD: Array<[string, unknown, string, string]> = [
    ['가격 음수', { priceEdits: [{ treatmentId: T1, patientAmount: -1 }] }, 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['가격 소수', { priceEdits: [{ treatmentId: T1, patientAmount: 99.5 }] }, 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['가격 범위 밖', { priceEdits: [{ treatmentId: T1, patientAmount: 9_999_999_999_999 }] }, 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['가격 문자열', { priceEdits: [{ treatmentId: T1, patientAmount: '12000' }] }, 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['다른 병원의 치료 id', { priceEdits: [{ treatmentId: OTHER_CLINIC_TREATMENT_ID, patientAmount: 5_000 }] }, 'TREATMENT_NOT_IN_CATALOG', 'priceEdits[0].treatmentId'],
    ['없는 치료 id', { priceEdits: [{ treatmentId: 'NO_SUCH', patientAmount: 5_000 }] }, 'TREATMENT_NOT_IN_CATALOG', 'priceEdits[0].treatmentId'],
    ['보장 판단 필드를 같이 보냄', { priceEdits: [{ treatmentId: T1, patientAmount: 12_000, benefitType: 'NON_BENEFIT' }] }, 'UNKNOWN_FIELD', 'priceEdits[0].benefitType'],
    ['규칙 묶음을 바꾸려는 필드', { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], ruleBundleVersion: 'X' }, 'UNKNOWN_FIELD', 'request.ruleBundleVersion'],
    ['변경 없음', { priceEdits: [{ treatmentId: T1, patientAmount: 10_000 }] }, 'NO_PRICE_CHANGE', 'priceEdits'],
    ['본문이 객체가 아님', [1], 'NOT_OBJECT', 'request'],
  ];
  it.each(BAD)('PUT draft: %s', async (_name, body, code, path) => {
    const world = setup('ha-clinic-1');
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T2, patientAmount: 15_000 }] });
    const before = world.world.repo.exportState();
    const response = await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, body);
    expect(response.status).toBe(400);
    const parsed = await json(response);
    expect(parsed.error).toBe('INVALID_REQUEST');
    expect(parsed.defects).toContainEqual({ code, path });
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('JSON 이 아닌 본문은 400 NOT_JSON', async () => {
    const world = setup('ha-clinic-1');
    const before = world.world.repo.exportState();
    const response = await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, '{not json');
    expect(response.status).toBe(400);
    expect((await json(response)).defects).toContainEqual({ code: 'NOT_JSON', path: 'request' });
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('미리보기: 알 수 없는 키·열거 밖 값·지원하지 않는 세대·초안에 없는 치료 선택은 400 이고 아무것도 쓰지 않는다', async () => {
    const world = setup('ha-clinic-1');
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const before = world.world.repo.exportState();
    const cases: Array<[unknown, string]> = [
      [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', price: 1 }, 'UNKNOWN_FIELD'],
      [{ generation: 'GEN4_C4', insurerType: 'BANK', cause: 'UNKNOWN' }, 'INVALID_REQUEST'],
      [{ generation: 'GEN9', insurerType: 'NON_LIFE', cause: 'UNKNOWN' }, 'UNSUPPORTED_GENERATION'],
      [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [] }, 'NO_TREATMENT_SELECTED'],
      // 변경 치료(T1)는 포함하고 다른 병원의 치료를 더한다: 포함 규칙은 통과하고 "현재 카탈로그에 없는 치료" 로 거절된다.
      [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [T1, OTHER_CLINIC_TREATMENT_ID] }, 'TREATMENT_NOT_IN_CATALOG'],
      // 변경 치료가 빠진 선택은 어떤 치료로 채워도 거절된다.
      [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [T2] }, 'CHANGED_TREATMENT_NOT_INCLUDED'],
      [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [OTHER_CLINIC_TREATMENT_ID] }, 'CHANGED_TREATMENT_NOT_INCLUDED'],
    ];
    for (const [body, code] of cases) {
      const response = await call(world.admin, 'POST', `${CLINIC}/catalog/preview`, body);
      expect(response.status, code).toBe(400);
      expect((await json(response)).defects.map((defect: Json) => defect.code)).toContain(code);
    }
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('게시 본문은 { publishConfirmation } 하나뿐이다: 없음·형식 위반·알 수 없는 키(옛 이름 draftDigest 포함)는 400 이고 아무것도 쓰지 않는다', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const digest = (await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft.draftDigest as string;
    const before = world.world.repo.exportState();
    const cases: Array<[string, unknown, string, string]> = [
      ['본문이 비어 있음', {}, 'VALUE_MISSING', 'publishConfirmation'],
      ['목록의 지문을 옛 이름 draftDigest 로', { draftDigest: digest }, 'UNKNOWN_FIELD', 'request.draftDigest'],
      ['목록의 지문을 옛 이름 draftDigest 로 (확인값 없음)', { draftDigest: digest }, 'VALUE_MISSING', 'publishConfirmation'],
      ['알 수 없는 키를 더함', { publishConfirmation: NOT_ISSUED, priceEdits: [] }, 'UNKNOWN_FIELD', 'request.priceEdits'],
      ['형식이 확인값이 아님', { publishConfirmation: 'x' }, 'VALUE_INVALID', 'publishConfirmation'],
      ['대문자 16진수', { publishConfirmation: 'A'.repeat(64) }, 'VALUE_INVALID', 'publishConfirmation'],
      ['문자열이 아님', { publishConfirmation: 123 }, 'VALUE_INVALID', 'publishConfirmation'],
    ];
    for (const [name, body, code, path] of cases) {
      const response = await publish(world.admin, body);
      expect(response.status, name).toBe(400);
      expect((await json(response)).defects, name).toContainEqual({ code, path });
    }
    expect((await publish(world.admin, [1])).status).toBe(400);
    expect(world.world.repo.exportState()).toEqual(before);
  });
});

describe('409: 충돌은 거절되고 저장 상태는 그대로다', () => {
  it('초안 없이 미리보기·게시하면 DRAFT_ABSENT', async () => {
    const world = setup('ha-clinic-1');
    const before = world.world.repo.exportState();
    for (const [path, body] of [[`${CLINIC}/catalog/preview`, { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' }], [`${CLINIC}/catalog/publish`, { publishConfirmation: NOT_ISSUED }]] as const) {
      const response = await call(world.admin, 'POST', path, body);
      expect(response.status).toBe(409);
      expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_ABSENT' });
    }
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('미리보기를 본 뒤 초안이 바뀌면(다시 저장) 본 초안의 확인값으로는 게시할 수 없다 (PREVIEW_REQUIRED)', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const seen = await previewConfirmation(world.admin);
    await saveT1(world.admin, 99_000);
    const before = world.world.repo.exportState();
    const response = await publish(world.admin, { publishConfirmation: seen });
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    expect(world.world.repo.exportState()).toEqual(before);
    expect((await publicCatalog(world)).treatments[0].patientAmount).toBe(10_000);
  });

  it('초안이 근거한 카탈로그가 그 사이 바뀌었으면 게시도 미리보기도 DRAFT_STALE', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const confirmation = await previewConfirmation(world.admin);
    // 다른 경로의 게시(예: 다른 도구)가 현재 카탈로그를 바꾼다. 도메인 서비스로 직접 같은 병원에 게시한다.
    const { publishCatalog } = await import('../../src/server/catalog-publish');
    const current = world.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
    const versions = current.treatmentVersionIds.map((id) => world.world.repo.getTreatmentVersion(id)!);
    publishCatalog(
      world.world.deps,
      { id: 'TEST_FIXTURE_HA_CLINIC_1', role: 'HA' },
      TEST_FIXTURE_CLINIC_ID,
      { treatmentVersions: [{ ...versions[0]!, id: 'TEST_FIXTURE_TV_RACE', patientAmount: 10_500 }, versions[1]!], commonBaseFees: current.baseFeeIds.map((id) => world.world.repo.getCommonBaseFee(id)!) },
      { acceptedLineOrigins: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] },
    );
    const before = world.world.repo.exportState();
    const published = await publish(world.admin, { publishConfirmation: confirmation });
    expect(published.status).toBe(409);
    expect(await json(published)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
    const preview = await call(world.admin, 'POST', `${CLINIC}/catalog/preview`, { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' });
    expect(preview.status).toBe(409);
    expect(world.world.repo.exportState()).toEqual(before);
    // 목록은 stale 표시를 준다.
    expect((await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft.stale).toBe(true);
  });
});

describe('게시 거절: 게시 검증이 거절하면 데이터가 하나도 바뀌지 않는다', () => {
  it('운영 허용 출처(OPERATING)는 시험 자료 줄을 거절한다: 400 + ORIGIN_NOT_ACCEPTED, 카탈로그·치료 버전·초안·감사 기록 불변, 공개 가격 그대로', async () => {
    const world = setup('ha-clinic-1', { linesOrigins: ['OPERATING'] });
    const saved = await saveT1(world.admin);
    expect(saved.status).toBe(200);
    const confirmation = await previewConfirmation(world.admin);
    const before = world.world.repo.exportState();
    const response = await publish(world.admin, { publishConfirmation: confirmation });
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(body.error).toBe('INVALID_REQUEST');
    expect(body.defects.some((defect: Json) => defect.code === 'ORIGIN_NOT_ACCEPTED')).toBe(true);
    expect(world.world.repo.exportState()).toEqual(before);
    expect((await publicCatalog(world)).treatments.map((row: Json) => row.patientAmount)).toEqual([10_000, 10_000]);
    expect(world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).not.toBeNull();
  });
});

describe('감사 기록', () => {
  it('초안 저장·게시마다 수행자(검증된 신원)와 역할이 남는다', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const confirmation = await previewConfirmation(world.admin);
    await publish(world.admin, { publishConfirmation: confirmation });
    const audits = world.world.repo.listAuditLog().filter((entry) => entry.actorId === 'TEST_FIXTURE_HA_CLINIC_1');
    expect(audits.map((entry) => entry.action)).toEqual(['CATALOG_DRAFT_SAVE', 'CATALOG_PUBLISH', 'CATALOG_DRAFT_PUBLISH']);
    expect(audits.every((entry) => entry.role === 'HA')).toBe(true);
  });
});

describe('미리보기 없이는 게시할 수 없다: 서버가 미리보기 성공 때 발급한 게시 확인값만 게시 권한이다', () => {
  const PREVIEW_REQUIRED = { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' };
  const publicPrices = async (world: ReturnType<typeof setup>): Promise<number[]> => (await publicCatalog(world)).treatments.map((row: Json) => row.patientAmount);

  it('미리보기 없이 저장 응답·목록의 지문으로는 게시할 수 없다 (옛 이름 draftDigest 는 400, 새 이름에 넣어도 409). 저장소·공개 가격·초안이 그대로다', async () => {
    const world = setup('ha-clinic-1');
    const saved = await saveT1(world.admin);
    const savedDigest = ((await json(saved)).draft as Json).draftDigest as string;
    const listDigest = (await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft.draftDigest as string;
    expect(listDigest).toBe(savedDigest);
    const before = world.world.repo.exportState();
    for (const digest of [savedDigest, listDigest]) {
      expect((await publish(world.admin, { draftDigest: digest })).status).toBe(400);
      const renamed = await publish(world.admin, { publishConfirmation: digest });
      expect(renamed.status).toBe(409);
      expect(await json(renamed)).toEqual(PREVIEW_REQUIRED);
    }
    expect(world.world.repo.exportState()).toEqual(before);
    expect(await publicPrices(world)).toEqual([10_000, 10_000]);
    expect(world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).not.toBeNull();
  });

  it('성공하지 못한 미리보기는 게시 확인값을 주지 않는다', async () => {
    const world = setup('ha-clinic-1');
    const noDraft = await call(world.admin, 'POST', `${CLINIC}/catalog/preview`, PREVIEW_BODY);
    expect(noDraft.status).toBe(409);
    expect(JSON.stringify(await json(noDraft))).not.toContain('publishConfirmation');
    await saveT1(world.admin);
    for (const bad of [{ ...PREVIEW_BODY, generation: 'GEN9' }, { ...PREVIEW_BODY, price: 1 }, { ...PREVIEW_BODY, treatmentIds: [OTHER_CLINIC_TREATMENT_ID] }, 'not json']) {
      const response = await call(world.admin, 'POST', `${CLINIC}/catalog/preview`, bad);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await json(response))).not.toContain('publishConfirmation');
    }
  });

  it('가격이 같아도 초안을 다시 저장하면 이전 미리보기의 확인값은 쓸 수 없고, 새 미리보기의 확인값은 쓸 수 있다', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const old = await previewConfirmation(world.admin);
    await saveT1(world.admin); // 같은 가격으로 다시 저장
    const before = world.world.repo.exportState();
    const rejected = await publish(world.admin, { publishConfirmation: old });
    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toEqual(PREVIEW_REQUIRED);
    expect(world.world.repo.exportState()).toEqual(before);
    expect(await publicPrices(world)).toEqual([10_000, 10_000]);

    const fresh = await previewConfirmation(world.admin);
    expect(fresh).not.toBe(old);
    expect((await publish(world.admin, { publishConfirmation: fresh })).status).toBe(200);
    expect(await publicPrices(world)).toEqual([12_000, 10_000]);
  });

  it('초안을 버렸다가 같은 가격으로 새로 만들어도 이전 확인값은 쓸 수 없다', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const old = await previewConfirmation(world.admin);
    expect(await json(await call(world.admin, 'DELETE', `${CLINIC}/catalog/draft`))).toEqual({ discarded: true });
    await saveT1(world.admin);
    const before = world.world.repo.exportState();
    const rejected = await publish(world.admin, { publishConfirmation: old });
    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toEqual(PREVIEW_REQUIRED);
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('기준 카탈로그가 바뀐 뒤 같은 수정 가격으로 초안을 다시 저장해도, 바뀌기 전 미리보기의 확인값은 쓸 수 없다', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const old = await previewConfirmation(world.admin);
    const { publishCatalog } = await import('../../src/server/catalog-publish');
    const current = world.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
    const versions = current.treatmentVersionIds.map((id) => world.world.repo.getTreatmentVersion(id)!);
    publishCatalog(
      world.world.deps,
      { id: 'TEST_FIXTURE_HA_CLINIC_1', role: 'HA' },
      TEST_FIXTURE_CLINIC_ID,
      { treatmentVersions: [{ ...versions[0]!, id: 'TEST_FIXTURE_TV_RACE', patientAmount: 10_500 }, versions[1]!], commonBaseFees: current.baseFeeIds.map((id) => world.world.repo.getCommonBaseFee(id)!) },
      { acceptedLineOrigins: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] },
    );
    expect((await saveT1(world.admin)).status).toBe(200); // 새 기준 카탈로그 위에 같은 가격 수정을 다시 저장
    const before = world.world.repo.exportState();
    const rejected = await publish(world.admin, { publishConfirmation: old });
    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toEqual(PREVIEW_REQUIRED);
    expect(world.world.repo.exportState()).toEqual(before);

    const fresh = await previewConfirmation(world.admin);
    expect((await publish(world.admin, { publishConfirmation: fresh })).status).toBe(200);
  });

  it('다른 관리자(같은 병원의 다른 HA)에게 발급된 확인값은 쓸 수 없다', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const issuedToFirst = await previewConfirmation(world.admin);
    const second = { ...world.admin, authenticator: staticAuthenticator({ userId: 'TEST_FIXTURE_HA_CLINIC_1_SECOND', memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'HA' }] }) };
    const before = world.world.repo.exportState();
    const rejected = await publish(second, { publishConfirmation: issuedToFirst });
    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toEqual(PREVIEW_REQUIRED);
    expect(world.world.repo.exportState()).toEqual(before);
    // 두 번째 관리자가 직접 미리보기를 하면 자기 확인값으로 게시한다(첫 관리자의 확인값은 여전히 첫 관리자 몫이다).
    expect((await publish(second, { publishConfirmation: await previewConfirmation(second) })).status).toBe(200);
  });

  it('다른 병원의 확인값은 쓸 수 없다 (한 관리자가 두 병원 소속이어도 병원에 묶여 있다). 다른 병원의 카탈로그·초안은 그대로다', async () => {
    const built = buildWorld();
    publishSecondClinicCatalog(built.world);
    const both = { userId: 'TEST_FIXTURE_HA_BOTH_CLINICS', memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'HA' as const }, { clinicId: OTHER_CLINIC_ID, role: 'HA' as const }] };
    const { admin } = adminServicesOf(built.world, { authenticator: staticAuthenticator(both) });
    const OTHER = `clinics/${OTHER_CLINIC_ID}`;
    await saveT1(admin);
    const clinic1Confirmation = await previewConfirmation(admin);
    expect((await call(admin, 'PUT', `${OTHER}/catalog/draft`, { priceEdits: [{ treatmentId: OTHER_CLINIC_TREATMENT_ID, patientAmount: 777 }] })).status).toBe(200);
    const otherCatalog = built.world.repo.getClinicCurrentCatalogVersion(OTHER_CLINIC_ID)!;
    const before = built.world.repo.exportState();
    const rejected = await call(admin, 'POST', `${OTHER}/catalog/publish`, { publishConfirmation: clinic1Confirmation });
    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toEqual(PREVIEW_REQUIRED);
    expect(built.world.repo.exportState()).toEqual(before);
    expect(built.world.repo.getClinicCurrentCatalogVersion(OTHER_CLINIC_ID)).toEqual(otherCatalog);
    expect(built.world.repo.getCatalogDraft(OTHER_CLINIC_ID)).not.toBeNull();
    // 병원 1 에서는 같은 확인값이 정상으로 쓰인다.
    expect((await publish(admin, { publishConfirmation: clinic1Confirmation })).status).toBe(200);
  });

  it('게시에 성공한 확인값을 다시 보내면 초안이 없으므로 DRAFT_ABSENT 이고 아무것도 바뀌지 않는다', async () => {
    const world = setup('ha-clinic-1');
    await saveT1(world.admin);
    const confirmation = await previewConfirmation(world.admin);
    expect((await publish(world.admin, { publishConfirmation: confirmation })).status).toBe(200);
    const before = world.world.repo.exportState();
    const replay = await publish(world.admin, { publishConfirmation: confirmation });
    expect(replay.status).toBe(409);
    expect(await json(replay)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_ABSENT' });
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('게시 확인값과 초안 버전 값은 미리보기 응답 밖의 어떤 응답에도 실리지 않는다', async () => {
    const world = setup('ha-clinic-1');
    const saved = await json(await saveT1(world.admin));
    const confirmation = await previewConfirmation(world.admin);
    const revision = world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)!.revision;
    const others = [
      JSON.stringify(saved),
      JSON.stringify(await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))),
      JSON.stringify(await json(await call(world.admin, 'GET', `${CLINIC}/catalog/versions`))),
      JSON.stringify(await json(await call(world.admin, 'GET', 'session'))),
      JSON.stringify(await json(await call(world.admin, 'DELETE', `${CLINIC}/catalog/draft`))),
    ];
    // 실패 응답(게시 거절 409·400, 미리보기 거절)도 값을 되돌려 주지 않는다.
    const failures: string[] = [];
    for (const failed of [
      await publish(world.admin, { publishConfirmation: NOT_ISSUED }),
      await publish(world.admin, { publishConfirmation: confirmation.toUpperCase() }),
      await publish(world.admin, { draftDigest: confirmation }),
      await call(world.admin, 'POST', `${CLINIC}/catalog/preview`, { ...PREVIEW_BODY, generation: 'GEN9' }),
    ]) {
      expect(failed.status).toBeGreaterThanOrEqual(400);
      failures.push(JSON.stringify(await json(failed)));
    }
    // 값(확인값·열쇠)은 어떤 응답에도 없다. 필드 이름 publishConfirmation 은 400 의 결함 경로에 나올 수 있으므로 성공 응답에서만 없어야 한다.
    for (const text of [...others, ...failures]) {
      expect(text).not.toContain(confirmation);
      expect(text).not.toContain(revision);
    }
    for (const text of others) {
      expect(text).not.toContain('publishConfirmation');
    }
    // 감사 기록에도 열쇠(revision)와 확인값이 남지 않는다.
    expect(JSON.stringify(world.world.repo.listAuditLog())).not.toContain(revision);
    expect(JSON.stringify(world.world.repo.listAuditLog())).not.toContain(confirmation);
  });
});

describe('미리보기 계산 대상: 가격이 바뀐 치료를 모두 포함해야 게시 확인값을 받는다', () => {
  const T3 = 'TEST_FIXTURE_TREATMENT_3';
  const NOT_INCLUDED = { code: 'CHANGED_TREATMENT_NOT_INCLUDED', path: 'request.treatmentIds' };
  const saveBoth = (admin: AdminOf): Promise<Response> => call(admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }, { treatmentId: T2, patientAmount: 9_000 }] });
  const previewOf = (admin: AdminOf, treatmentIds?: unknown, condition: Record<string, unknown> = PREVIEW_BODY): Promise<Response> =>
    call(admin, 'POST', `${CLINIC}/catalog/preview`, { ...condition, ...(treatmentIds === undefined ? {} : { treatmentIds }) });
  const pricesOf = async (world: ReturnType<typeof setup>): Promise<number[]> => (await publicCatalog(world)).treatments.map((row: Json) => row.patientAmount);

  /** 병원 1 에 치료 셋(T1·T2 와, 이 시험에서 가격을 바꾸지 않을 T3)이 게시된 세계. T3 는 승인된 매핑이 없다. */
  async function setupThree(): Promise<ReturnType<typeof setup>> {
    const world = setup('ha-clinic-1');
    world.world.repo.saveTreatment(makeTreatment({ id: T3, sortOrder: 3 }));
    const { publishCatalog } = await import('../../src/server/catalog-publish');
    const current = world.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
    const versions = current.treatmentVersionIds.map((id) => world.world.repo.getTreatmentVersion(id)!);
    publishCatalog(
      world.world.deps,
      { id: 'TEST_FIXTURE_HA_CLINIC_1', role: 'HA' },
      TEST_FIXTURE_CLINIC_ID,
      {
        treatmentVersions: [...versions, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3', treatmentId: T3, displayName: 'TEST_FIXTURE 치료 3', patientAmount: 11_000 })],
        commonBaseFees: current.baseFeeIds.map((id) => world.world.repo.getCommonBaseFee(id)!),
      },
      { acceptedLineOrigins: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] },
    );
    return world;
  }

  /** 거절된 미리보기의 공통 확인: 400, 어긋난 필드, 확인값·지문 없음, 저장소 전체와 초안이 호출 전과 같다. */
  async function expectRejected(world: ReturnType<typeof setup>, response: Response, before: unknown, name: string): Promise<void> {
    expect(response.status, name).toBe(400);
    const body = await json(response);
    expect(body.error, name).toBe('INVALID_REQUEST');
    expect(JSON.stringify(body), name).not.toContain('publishConfirmation');
    expect(JSON.stringify(body), name).not.toMatch(/[0-9a-f]{64}/);
    expect(world.world.repo.exportState(), name).toEqual(before);
    expect(world.world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID), name).not.toBeNull();
  }

  it('치료 두 개의 가격을 바꾸고 treatmentIds 를 생략하면 변경 치료 전체가 계산되고 확인값이 나온다 (기존 동작)', async () => {
    const world = setup('ha-clinic-1');
    await saveBoth(world.admin);
    const response = await previewOf(world.admin);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.request.treatmentIds).toEqual([T1, T2]);
    expect(body.priceChanges.map((row: Json) => row.treatmentId)).toEqual([T1, T2]);
    expect(body.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
    expect((await publish(world.admin, { publishConfirmation: body.publishConfirmation })).status).toBe(200);
    expect(await pricesOf(world)).toEqual([12_000, 9_000]);
  });

  it.each<[string, string[]]>([
    ['변경한 치료 중 T1 하나만', [T1]],
    ['변경한 치료 중 T2 하나만', [T2]],
  ])('두 치료를 바꾸고 %s 선택하면 400 CHANGED_TREATMENT_NOT_INCLUDED, 확인값 없음, 저장소 불변', async (name, ids) => {
    const world = setup('ha-clinic-1');
    await saveBoth(world.admin);
    const before = world.world.repo.exportState();
    const response = await previewOf(world.admin, ids);
    await expectRejected(world, response, before, name);
    // (response 본문은 한 번만 읽을 수 있으므로 결함은 새 요청으로 본다)
    expect((await json(await previewOf(world.admin, ids))).defects).toContainEqual(NOT_INCLUDED);
    expect(await pricesOf(world)).toEqual([10_000, 10_000]);
  });

  it('변경하지 않은 치료만 선택하면 400 이다 (T1·T2 를 바꾸고 T3 만 / T1 만 바꾸고 T2·T3 만)', async () => {
    const world = await setupThree();
    await saveBoth(world.admin);
    let before = world.world.repo.exportState();
    expect((await json(await previewOf(world.admin, [T3]))).defects).toContainEqual(NOT_INCLUDED);
    await expectRejected(world, await previewOf(world.admin, [T3]), before, 'T3 만');

    await saveT1(world.admin);
    before = world.world.repo.exportState();
    expect((await json(await previewOf(world.admin, [T2, T3]))).defects).toContainEqual(NOT_INCLUDED);
    await expectRejected(world, await previewOf(world.admin, [T2, T3]), before, 'T2·T3 만');
  });

  it('변경 전체를 명시하면(순서가 달라도) 200 이고 확인값으로 게시된다', async () => {
    const world = setup('ha-clinic-1');
    await saveBoth(world.admin);
    const response = await previewOf(world.admin, [T2, T1]);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect([...body.request.treatmentIds].sort()).toEqual([T1, T2]);
    expect((await publish(world.admin, { publishConfirmation: body.publishConfirmation })).status).toBe(200);
    expect(await pricesOf(world)).toEqual([12_000, 9_000]);
  });

  it('변경 전체와 변경하지 않은 추가 치료를 함께 선택하면 200 이고 추가 치료도 계산된다 (정상적인 추가 선택)', async () => {
    const world = await setupThree();
    await saveBoth(world.admin);
    const response = await previewOf(world.admin, [T1, T2, T3]);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.request.treatmentIds).toEqual([T1, T2, T3]);
    expect(body.priceChanges.map((row: Json) => row.treatmentId)).toEqual([T1, T2]); // 가격 변경 내역은 초안의 변경뿐이다
    expect(body.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
    expect((await publish(world.admin, { publishConfirmation: body.publishConfirmation })).status).toBe(200);
    expect(await pricesOf(world)).toEqual([12_000, 9_000, 11_000]);

    // 변경이 하나뿐인 초안에서도 추가 선택은 된다.
    await saveT1(world.admin, 13_000);
    const single = await previewOf(world.admin, [T1, T3]);
    expect(single.status).toBe(200);
    expect((await json(single)).request.treatmentIds).toEqual([T1, T3]);
  });

  it('중복·빈 선택·형식 오류로 포함 규칙을 우회할 수 없다: 모두 400 이고 확인값이 없다', async () => {
    const world = setup('ha-clinic-1');
    await saveBoth(world.admin);
    const before = world.world.repo.exportState();
    const cases: Array<[string, unknown]> = [
      ['같은 치료를 두 번', [T1, T1]],
      ['빈 선택', []],
      ['문자열 하나', T1],
      ['null', null],
      ['치료 id 가 아닌 값이 섞임', [T1, 7]],
      ['대소문자만 다른 id', [T1.toLowerCase(), T2]],
      ['앞뒤 공백이 붙은 id', [` ${T1}`, T2]],
    ];
    for (const [name, ids] of cases) {
      const response = await previewOf(world.admin, ids);
      expect(response.status, name).toBe(400);
      expect(JSON.stringify(await json(response)), name).not.toContain('publishConfirmation');
    }
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('보류(ON_HOLD)가 나오는 보험 조건의 기존 동작은 그대로다: 변경 치료를 모두 포함하면 200 + 확인값(보류 결과), 빠지면 400', async () => {
    const world = setup('ha-clinic-1');
    await saveBoth(world.admin);
    const held = { generation: 'GEN3_C3', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
    const response = await previewOf(world.admin, [T1, T2], held);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.before.result.state).toBe('ON_HOLD');
    expect(body.after.result.state).toBe('ON_HOLD');
    expect(body.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
    expect((await previewOf(world.admin, undefined, held)).status).toBe(200); // 생략도 그대로
    const before = world.world.repo.exportState();
    expect((await previewOf(world.admin, [T1], held)).status).toBe(400);
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('권한 검사는 포함 규칙보다 먼저다: 인증 없음 401, 다른 병원 HA·RV·PO 403 (선택이 불완전해도 400 이 아니다), 저장소 불변', async () => {
    for (const [account, status] of [[null, 401], ['ha-clinic-2', 403], ['rv-1', 403], ['po-1', 403]] as const) {
      const world = setup(account);
      const before = world.world.repo.exportState();
      const response = await previewOf(world.admin, [T3]);
      expect(response.status, String(account)).toBe(status);
      expect(JSON.stringify(await json(response)), String(account)).not.toContain('publishConfirmation');
      expect(world.world.repo.exportState(), String(account)).toEqual(before);
    }
  });

  it('거절된 미리보기 뒤에 변경 전체를 포함해 다시 하면 확인값을 받아 게시한다. 확인값의 결합·무효화는 그대로다 (초안을 다시 저장하면 이전 확인값은 못 쓴다)', async () => {
    const world = await setupThree();
    await saveBoth(world.admin);
    expect((await previewOf(world.admin, [T1])).status).toBe(400);
    const accepted = (await json(await previewOf(world.admin, [T1, T2, T3]))).publishConfirmation as string;
    expect(accepted).toMatch(/^[0-9a-f]{64}$/);

    await saveBoth(world.admin); // 같은 가격으로 다시 저장
    const before = world.world.repo.exportState();
    const rejected = await publish(world.admin, { publishConfirmation: accepted });
    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    expect(world.world.repo.exportState()).toEqual(before);

    const fresh = (await json(await previewOf(world.admin, [T2, T1]))).publishConfirmation as string;
    expect(fresh).not.toBe(accepted);
    expect((await publish(world.admin, { publishConfirmation: fresh })).status).toBe(200);
  });
});

