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
const ROUTES: Array<[string, string, unknown]> = [
  ['GET', 'session', undefined],
  ['GET', `${CLINIC}/treatments`, undefined],
  ['PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] }],
  ['DELETE', `${CLINIC}/catalog/draft`, undefined],
  ['POST', `${CLINIC}/catalog/preview`, { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' }],
  ['POST', `${CLINIC}/catalog/publish`, { draftDigest: 'x' }],
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
    expect(preview.draftDigest).toBe(draft.draftDigest);
    // 미리보기 계산은 공개 계산과 같은 결과를 낸다(현재 카탈로그 쪽 before 가 위의 공개 계산과 같다).
    expect(preview.before.result.amounts).toEqual(oldEstimate.body.result.amounts);

    // 5) 게시
    const published = await call(world.admin, 'POST', `${CLINIC}/catalog/publish`, { draftDigest: draft.draftDigest });
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
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const digest = (await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft.draftDigest as string;
    expect((await call(world.admin, 'POST', `${CLINIC}/catalog/publish`, { draftDigest: digest })).status).toBe(200);
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
      [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds: [OTHER_CLINIC_TREATMENT_ID] }, 'TREATMENT_NOT_IN_CATALOG'],
    ];
    for (const [body, code] of cases) {
      const response = await call(world.admin, 'POST', `${CLINIC}/catalog/preview`, body);
      expect(response.status, code).toBe(400);
      expect((await json(response)).defects.map((defect: Json) => defect.code)).toContain(code);
    }
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('게시 본문: draftDigest 없음·알 수 없는 키는 400', async () => {
    const world = setup('ha-clinic-1');
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const before = world.world.repo.exportState();
    expect((await call(world.admin, 'POST', `${CLINIC}/catalog/publish`, {})).status).toBe(400);
    expect((await call(world.admin, 'POST', `${CLINIC}/catalog/publish`, { draftDigest: 'x', priceEdits: [] })).status).toBe(400);
    expect(world.world.repo.exportState()).toEqual(before);
  });
});

describe('409: 충돌은 거절되고 저장 상태는 그대로다', () => {
  it('초안 없이 미리보기·게시하면 DRAFT_ABSENT', async () => {
    const world = setup('ha-clinic-1');
    const before = world.world.repo.exportState();
    for (const [path, body] of [[`${CLINIC}/catalog/preview`, { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' }], [`${CLINIC}/catalog/publish`, { draftDigest: 'x' }]] as const) {
      const response = await call(world.admin, 'POST', path, body);
      expect(response.status).toBe(409);
      expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_ABSENT' });
    }
    expect(world.world.repo.exportState()).toEqual(before);
  });

  it('미리보기를 본 뒤 초안이 바뀌면(다른 관리자가 다시 저장) 본 초안의 digest 로는 게시할 수 없다 (DRAFT_CHANGED)', async () => {
    const world = setup('ha-clinic-1');
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const seen = (await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft.draftDigest as string;
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 99_000 }] });
    const before = world.world.repo.exportState();
    const response = await call(world.admin, 'POST', `${CLINIC}/catalog/publish`, { draftDigest: seen });
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'DRAFT_CHANGED' });
    expect(world.world.repo.exportState()).toEqual(before);
    expect((await publicCatalog(world)).treatments[0].patientAmount).toBe(10_000);
  });

  it('초안이 근거한 카탈로그가 그 사이 바뀌었으면 게시도 미리보기도 DRAFT_STALE', async () => {
    const world = setup('ha-clinic-1');
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const digest = (await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft.draftDigest as string;
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
    const published = await call(world.admin, 'POST', `${CLINIC}/catalog/publish`, { draftDigest: digest });
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
    const saved = await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    expect(saved.status).toBe(200);
    const digest = ((await json(saved)).draft as Json).draftDigest as string;
    const before = world.world.repo.exportState();
    const response = await call(world.admin, 'POST', `${CLINIC}/catalog/publish`, { draftDigest: digest });
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
    await call(world.admin, 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const digest = (await json(await call(world.admin, 'GET', `${CLINIC}/treatments`))).draft.draftDigest as string;
    await call(world.admin, 'POST', `${CLINIC}/catalog/publish`, { draftDigest: digest });
    const audits = world.world.repo.listAuditLog().filter((entry) => entry.actorId === 'TEST_FIXTURE_HA_CLINIC_1');
    expect(audits.map((entry) => entry.action)).toEqual(['CATALOG_DRAFT_SAVE', 'CATALOG_PUBLISH', 'CATALOG_DRAFT_PUBLISH']);
    expect(audits.every((entry) => entry.role === 'HA')).toBe(true);
  });
});

