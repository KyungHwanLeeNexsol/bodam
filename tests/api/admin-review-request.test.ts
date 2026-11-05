import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reject, submitForReview } from '../../src/server/approval';
import { handleAdmin } from '../../src/server/admin/router';
import type { AdminIdentity } from '../../src/server/admin/auth';
import { handleCatalog } from '../../src/server/api/catalog';
import { handleEstimate } from '../../src/server/api/estimate';
import { silentLog } from '../../src/server/api/log';
import { createOperatingAdminServices, createOperatingServices } from '../../src/server/composition';
import { canonicalDigest } from '../../src/server/digest';
import { createMappingDraftFromRequest } from '../../src/server/review-request';
import { readReadiness } from '../../src/server/readiness';
import type { ReadinessContext } from '../../src/server/readiness';
import type { MemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, TEST_ACCEPTED_ORIGINS, TEST_TODAY, publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { T1, T2 } from '../fixtures/server/base-fee.fixture';
import { T3, addThirdTreatment, additionBody, changedKeys, repoThrowingOn } from '../fixtures/server/catalog-structure.fixture';
import { CounterIdGenerator, FixedClock } from '../fixtures/server/clock.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { baseContent } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';
import { collectKeys, repoWith } from './helpers';

// 검토 요청 관리자 API (M7 검토 요청, design.md 권한 표 · DD-19 관리자 API · AC-022a-c · AC-023a-c · AC-024). 모두 handleAdmin 을 지난다.
//   POST /api/admin/clinics/{clinicId}/treatments/{treatmentId}/review-requests   HA (자기 병원)  — 검토 요청 제출
//   GET  /api/admin/clinics/{clinicId}/review-requests                            HA (자기 병원)  — 읽기 전용 목록 (DD-19 표에는 없고 권한 표의 HA 읽기 권한에서 더한 경로)
//   GET  /api/admin/review-queue                                                  RV (플랫폼 단위) — 모든 병원의 열린 요청
// 요청은 제안 기록일 뿐이다: 어떤 치료·분류·매핑·규칙 묶음·카탈로그·키오스크 계산도 바뀌지 않는다 (AC-023c 의 "새 초안 치료 버전" 은 소유자 결정으로 만들지 않는다).
// 세계: 병원 1 에 치료 셋(T1·T2·T3)과 승인된 매핑·게시된 규칙 묶음, 병원 2 에 치료 하나. 시험 계정: ha-clinic-1 · ha-clinic-2 · rv-1(플랫폼 RV) · po-1.

const BASE = 'http://localhost/api/admin';
const CLINIC = `clinics/${TEST_FIXTURE_CLINIC_ID}`;
const OTHER = `clinics/${OTHER_CLINIC_ID}`;
const PREVIEW_BODY = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const ADDED_1 = 'TEST_FIXTURE_ADDED_TREATMENT_1';
const QUEUE = 'review-queue';
const READINESS_CTX: ReadinessContext = { at: TEST_TODAY, acceptedOrigins: TEST_ACCEPTED_ORIGINS, digest: canonicalDigest };

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type AdminOf = ReturnType<typeof adminServicesOf>['admin'];

const PROPOSAL = { benefitType: 'NON_BENEFIT', procedureCodes: ['TEST_FIXTURE_PROPOSED_PROC_A', 'TEST_FIXTURE_PROPOSED_PROC_B'], calcClass: 'MAJOR_THREE_NON_BENEFIT' };
const bodyOf = (overrides: Record<string, unknown> = {}) => ({ proposed: { ...PROPOSAL, ...overrides } });
const requestPath = (clinic: string, treatmentId: string): string => `${clinic}/treatments/${encodeURIComponent(treatmentId)}/review-requests`;

function segmentsOf(path: string): string[] {
  return path.split('/').filter((part) => part !== '').map(decodeURIComponent);
}

function call(admin: AdminOf, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const init: RequestInit = { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return handleAdmin(admin, new Request(`${BASE}/${path}`, init), segmentsOf(path));
}

const callRaw = (admin: AdminOf, method: string, path: string, text: string): Promise<Response> =>
  handleAdmin(admin, new Request(`${BASE}/${path}`, { method, body: text, headers: { 'content-type': 'application/json' } }), segmentsOf(path));

const json = async (response: Response): Promise<Json> => (await response.json()) as Json;

interface SetupOptions {
  wrapRepo?: (repo: MemoryRepository) => MemoryRepository;
}

function setup(options: SetupOptions = {}) {
  const built = buildWorld();
  publishSecondClinicCatalog(built.world);
  addThirdTreatment(built.world);
  // 서비스는 (실패 주입 대역일 수 있는) 감싼 저장소를 쓰고, 상태 비교와 직접 읽기는 실제 저장소로 한다.
  const wrapped = options.wrapRepo === undefined ? built.world.repo : options.wrapRepo(built.world.repo);
  const serviceWorld: World = { ...built.world, repo: wrapped, deps: { ...built.world.deps, repo: wrapped } };
  /** 계정(또는 직접 만든 신원, null = 인증 없음)으로 일하는 관리자 서비스. 모두 같은 저장소를 본다. */
  const as = (who: TestAccountKey | AdminIdentity | null): AdminOf =>
    adminServicesOf(serviceWorld, { authenticator: staticAuthenticator(who === null ? null : typeof who === 'string' ? identityOf(who) : who) }).admin;
  const api = adminServicesOf(serviceWorld, { authenticator: staticAuthenticator(null) }).api;
  const repo = built.world.repo;
  return { ...built, repo, as, api, state: () => repo.exportState() };
}

type Setup = ReturnType<typeof setup>;

const submit = (world: Setup, account: TestAccountKey, treatmentId: string, clinicPath: string = CLINIC, body: unknown = bodyOf()): Promise<Response> =>
  call(world.as(account), 'POST', requestPath(clinicPath, treatmentId), body);

const publicCatalog = async (world: Setup): Promise<Json> => json(await handleCatalog(world.api, CLINIC_1_SLUG));

/** 병원 1 의 현재 카탈로그·규칙 묶음으로 공개 계산(키오스크 경로)을 한다. */
async function publicEstimate(world: Setup, treatmentIds: string[]): Promise<{ status: number; body: Json }> {
  const catalogVersion = (await publicCatalog(world)).catalogVersion as string;
  const response = await handleEstimate(world.api, CLINIC_1_SLUG, () =>
    Promise.resolve({ catalogVersion, ruleBundleVersion: world.bundle!.id, generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN', treatmentIds }),
  );
  return { status: response.status, body: await json(response) };
}

/** 기존 관리자 흐름(초안 → 미리보기 → 게시)으로 병원 1 의 카탈로그를 바꾼다. */
async function publishDraft(world: Setup, draft: unknown): Promise<void> {
  const admin = world.as('ha-clinic-1');
  expect((await call(admin, 'PUT', `${CLINIC}/catalog/draft`, draft)).status).toBe(200);
  const preview = await call(admin, 'POST', `${CLINIC}/catalog/preview`, PREVIEW_BODY);
  expect(preview.status).toBe(200);
  const published = await call(admin, 'POST', `${CLINIC}/catalog/publish`, { publishConfirmation: (await json(preview)).publishConfirmation });
  expect(published.status).toBe(200);
}

/** 요청 하나를 RV 가 반려로 닫는다 (도메인 서비스 경로). */
function closeByRejection(world: Setup, requestId: string, treatmentId: string = T1): void {
  const deps = world.world.deps;
  const draft = createMappingDraftFromRequest(deps, TEST_FIXTURE_RV_AUTHOR, requestId, baseContent('MAPPING', 7, treatmentId));
  submitForReview(deps, TEST_FIXTURE_RV_AUTHOR, draft.ref);
  reject(deps, TEST_FIXTURE_RV_APPROVER, draft.ref, 'TEST_FIXTURE 반려 사유');
}

const VIEW_KEYS = ['id', 'proposed', 'rejectionReason', 'requestedAt', 'requestedBy', 'status', 'treatmentId', 'treatmentName'];

describe('인증·권한 표: 역할 × 자원 × 동작 (거절은 모두 저장 상태가 그대로다)', () => {
  const HA1_REQUESTS = requestPath(CLINIC, T1);
  const REQUEST_LIST = `${CLINIC}/review-requests`;

  // [이름, 계정(null=인증 없음), 방법, 경로, 본문, 기대 상태, 기대 본문]
  const REJECTIONS: Array<[string, TestAccountKey | null, string, string, unknown, number, Json]> = [
    ['제출 · 인증 없음', null, 'POST', HA1_REQUESTS, bodyOf(), 401, { error: 'UNAUTHENTICATED' }],
    ['제출 · 다른 병원 HA', 'ha-clinic-2', 'POST', HA1_REQUESTS, bodyOf(), 403, { error: 'FORBIDDEN' }],
    ['제출 · RV', 'rv-1', 'POST', HA1_REQUESTS, bodyOf(), 403, { error: 'FORBIDDEN' }],
    ['제출 · PO', 'po-1', 'POST', HA1_REQUESTS, bodyOf(), 403, { error: 'FORBIDDEN' }],
    ['제출 · HA 가 다른 병원 경로로', 'ha-clinic-1', 'POST', requestPath(OTHER, OTHER_CLINIC_TREATMENT_ID), bodyOf(), 403, { error: 'FORBIDDEN' }],
    ['제출 · 없는 병원(소속 없음)은 있는 병원과 같은 403', 'ha-clinic-1', 'POST', requestPath('clinics/GHOST_CLINIC', T1), bodyOf(), 403, { error: 'FORBIDDEN' }],
    ['목록 · 인증 없음', null, 'GET', REQUEST_LIST, undefined, 401, { error: 'UNAUTHENTICATED' }],
    ['목록 · 다른 병원 HA', 'ha-clinic-2', 'GET', REQUEST_LIST, undefined, 403, { error: 'FORBIDDEN' }],
    ['목록 · RV (병원 목록은 HA 자기 병원 전용)', 'rv-1', 'GET', REQUEST_LIST, undefined, 403, { error: 'FORBIDDEN' }],
    ['목록 · PO', 'po-1', 'GET', REQUEST_LIST, undefined, 403, { error: 'FORBIDDEN' }],
    ['대기열 · 인증 없음', null, 'GET', QUEUE, undefined, 401, { error: 'UNAUTHENTICATED' }],
    ['대기열 · HA(병원 1)', 'ha-clinic-1', 'GET', QUEUE, undefined, 403, { error: 'FORBIDDEN' }],
    ['대기열 · HA(병원 2)', 'ha-clinic-2', 'GET', QUEUE, undefined, 403, { error: 'FORBIDDEN' }],
    ['대기열 · PO', 'po-1', 'GET', QUEUE, undefined, 403, { error: 'FORBIDDEN' }],
  ];

  it.each(REJECTIONS)('%s → %i', async (_name, account, method, path, body, status, expected) => {
    const world = setup();
    const before = world.state();
    const response = await call(world.as(account), method, path, body);
    expect(response.status).toBe(status);
    expect(await json(response)).toEqual(expected);
    expect(world.state()).toEqual(before);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('병원에 매인 RV·플랫폼 단위 HA 는 병원 관리자도 플랫폼 검토 담당자도 아니다 (소속이 정확히 맞아야 한다)', async () => {
    const world = setup();
    const before = world.state();
    const clinicBoundRv: AdminIdentity = { userId: 'TEST_FIXTURE_RV_BOUND', memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'RV' }] };
    const platformHa: AdminIdentity = { userId: 'TEST_FIXTURE_HA_PLATFORM', memberships: [{ clinicId: null, role: 'HA' }] };
    for (const identity of [clinicBoundRv, platformHa]) {
      expect((await call(world.as(identity), 'POST', requestPath(CLINIC, T1), bodyOf())).status).toBe(403);
      expect((await call(world.as(identity), 'GET', `${CLINIC}/review-requests`)).status).toBe(403);
    }
    for (const identity of [clinicBoundRv, platformHa]) {
      expect((await call(world.as(identity), 'GET', QUEUE)).status).toBe(403);
    }
    expect(world.state()).toEqual(before);
  });

  it('여러 소속을 가진 신원: HA(병원 1) + 플랫폼 RV 이면 둘 다 쓸 수 있고 서로의 범위를 넘지 않는다', async () => {
    const world = setup();
    const both: AdminIdentity = { userId: 'TEST_FIXTURE_BOTH', memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'HA' }, { clinicId: null, role: 'RV' }] };
    expect((await call(world.as(both), 'POST', requestPath(CLINIC, T1), bodyOf())).status).toBe(200);
    expect((await call(world.as(both), 'GET', QUEUE)).status).toBe(200);
    expect((await call(world.as(both), 'POST', requestPath(OTHER, OTHER_CLINIC_TREATMENT_ID), bodyOf())).status).toBe(403);
  });

  it('처리 순서: 401 → 404/405 → 403 → 404(병원) → 400(본문) → 도메인', async () => {
    const world = setup();
    const before = world.state();
    // 405 는 403 보다 앞선다 (인증은 됐고 경로는 맞지만 메서드가 틀림): 소속이 없어도 405.
    expect((await call(world.as('ha-clinic-1'), 'POST', QUEUE)).status).toBe(405);
    expect((await call(world.as('rv-1'), 'GET', requestPath(CLINIC, T1))).status).toBe(405);
    expect((await call(world.as('ha-clinic-2'), 'POST', `${CLINIC}/review-requests`, bodyOf())).status).toBe(405);
    // 401 은 405 보다 앞선다.
    expect((await call(world.as(null), 'DELETE', QUEUE)).status).toBe(401);
    // 403 은 본문 400 보다 앞선다: 소속이 없으면 깨진 본문도 403.
    expect((await callRaw(world.as('ha-clinic-2'), 'POST', requestPath(CLINIC, T1), '{not json')).status).toBe(403);
    // 소속은 있으나 저장소에 없는 병원이면 404 (본문 검사 전).
    const ghostHa: AdminIdentity = { userId: 'TEST_FIXTURE_HA_GHOST', memberships: [{ clinicId: 'GHOST_CLINIC', role: 'HA' }] };
    expect((await callRaw(world.as(ghostHa), 'POST', requestPath('clinics/GHOST_CLINIC', T1), '{not json')).status).toBe(404);
    expect((await call(world.as(ghostHa), 'GET', 'clinics/GHOST_CLINIC/review-requests')).status).toBe(404);
    expect(world.state()).toEqual(before);
  });

  it('메서드가 맞지 않으면 405 (세 경로 모두, 인증된 요청에서만) — 저장 상태는 그대로다', async () => {
    const world = setup();
    const before = world.state();
    const admin = world.as('ha-clinic-1');
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect((await call(admin, method, requestPath(CLINIC, T1), method === 'GET' ? undefined : bodyOf())).status, `${method} 제출 경로`).toBe(405);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await call(admin, method, `${CLINIC}/review-requests`, method === 'GET' ? undefined : bodyOf())).status, `${method} 목록 경로`).toBe(405);
      expect((await call(world.as('rv-1'), method, QUEUE, bodyOf())).status, `${method} 대기열 경로`).toBe(405);
    }
    expect(world.state()).toEqual(before);
  });

  it('모르는 경로는 404 (인증된 요청에서만)', async () => {
    const world = setup();
    const admin = world.as('ha-clinic-1');
    for (const path of [`${CLINIC}/treatments/${T1}`, `${CLINIC}/treatments/${T1}/review-requests/extra`, `${CLINIC}/treatments/${T1}/reviews`, `${CLINIC}/review-requests/extra`, `${QUEUE}/extra`, `${CLINIC}/review-queue`, 'clinics/review-queue']) {
      expect((await call(admin, 'GET', path)).status, path).toBe(404);
    }
    expect((await call(world.as(null), 'GET', `${QUEUE}/extra`)).status).toBe(401);
  });

  it('역할·병원·사용자는 본문이나 헤더에서 읽지 않는다 (위조해도 서버가 검증한 신원만 쓴다)', async () => {
    const world = setup();
    const before = world.state();
    const forged = { 'x-role': 'RV', 'x-clinic-id': TEST_FIXTURE_CLINIC_ID, cookie: 'bodam_test_session=TEST_FIXTURE_SESSION_1_rv-1' };
    expect((await call(world.as('ha-clinic-2'), 'POST', requestPath(CLINIC, T1), bodyOf(), forged)).status).toBe(403);
    expect((await call(world.as('ha-clinic-1'), 'GET', QUEUE, undefined, forged)).status).toBe(403);
    for (const key of ['requestedBy', 'role', 'clinicId', 'status']) {
      const response = await call(world.as('ha-clinic-1'), 'POST', requestPath(CLINIC, T1), { ...bodyOf(), [key]: 'RV' });
      expect(response.status).toBe(400);
      expect((await json(response)).defects).toEqual([{ code: 'UNKNOWN_FIELD', path: `request.${key}` }]);
    }
    expect(world.state()).toEqual(before);
  });
});

describe('POST …/treatments/{treatmentId}/review-requests: 제출', () => {
  it('200: 열린 요청을 만들고 { reviewRequest } 보기로 돌려준다. 요청자는 검증된 신원이다', async () => {
    const world = setup();
    world.world.clock.set('2026-10-17T05:30:00.000Z');
    const response = await submit(world, 'ha-clinic-1', T1);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(Object.keys(body)).toEqual(['reviewRequest']);
    expect(Object.keys(body.reviewRequest).sort()).toEqual(VIEW_KEYS);
    expect(body.reviewRequest).toEqual({
      id: 'TEST_FIXTURE_REVIEW_REQUEST_1',
      treatmentId: T1,
      treatmentName: world.repo.listTreatmentVersions(T1).at(-1)!.displayName,
      proposed: PROPOSAL,
      status: 'REVIEW_REQUESTED',
      rejectionReason: null,
      requestedAt: '2026-10-17T05:30:00.000Z',
      requestedBy: 'TEST_FIXTURE_HA_CLINIC_1',
    });
    // 저장된 기록과 감사 기록
    expect(world.repo.getCoverageReviewRequest('TEST_FIXTURE_REVIEW_REQUEST_1')).toMatchObject({ clinicId: TEST_FIXTURE_CLINIC_ID, requestedBy: { id: 'TEST_FIXTURE_HA_CLINIC_1', role: 'HA' }, status: 'REVIEW_REQUESTED', draftMappingRef: null, resultMappingRef: null });
    expect(world.repo.listAuditLog().at(-1)).toMatchObject({ action: 'REVIEW_REQUEST_CREATE', actorId: 'TEST_FIXTURE_HA_CLINIC_1', role: 'HA', target: 'TEST_FIXTURE_REVIEW_REQUEST_1' });
    // 매핑 id·병원 id 는 응답 어디에도 없다.
    expect([...collectKeys(body)].filter((key) => /mapping|clinicId/i.test(key))).toEqual([]);
  });

  it('제안한 값이 게시된 판단 값과 같아도 달라도 같은 요청 기록이다 (분류 NEEDS_REVIEW·빈 행위 코드 포함)', async () => {
    const world = setup();
    const proposed = { benefitType: 'BENEFIT', procedureCodes: [], calcClass: 'NEEDS_REVIEW' };
    const response = await submit(world, 'ha-clinic-1', T2, CLINIC, { proposed });
    expect(response.status).toBe(200);
    expect((await json(response)).reviewRequest.proposed).toEqual(proposed);
  });

  it('치료 id 는 경로에서 디코딩한 값이다 (특수 문자가 들어간 id 도 같은 규칙)', async () => {
    const world = setup();
    const response = await submit(world, 'ha-clinic-1', 'TEST_FIXTURE 없는/치료#1');
    expect(response.status).toBe(400);
    expect((await json(response)).defects).toEqual([{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'treatmentId' }]);
  });

  const BAD_BODIES: Array<[string, unknown, string, string]> = [
    ['본문이 객체가 아님', [], 'NOT_OBJECT', 'request'],
    ['proposed 없음', {}, 'VALUE_MISSING', 'proposed'],
    ['proposed 가 null', { proposed: null }, 'VALUE_MISSING', 'proposed'],
    ['proposed 가 배열', { proposed: [] }, 'VALUE_INVALID', 'proposed'],
    ['급여 구분 없음', bodyOf({ benefitType: undefined }), 'VALUE_MISSING', 'proposed.benefitType'],
    ['급여 구분이 목록 밖', bodyOf({ benefitType: 'FREE' }), 'VALUE_INVALID', 'proposed.benefitType'],
    ['분류 없음', bodyOf({ calcClass: undefined }), 'VALUE_MISSING', 'proposed.calcClass'],
    ['분류가 목록 밖', bodyOf({ calcClass: 'general_benefit' }), 'VALUE_INVALID', 'proposed.calcClass'],
    ['행위 코드 없음', bodyOf({ procedureCodes: undefined }), 'VALUE_MISSING', 'proposed.procedureCodes'],
    ['행위 코드가 배열이 아님', bodyOf({ procedureCodes: 'A' }), 'VALUE_INVALID', 'proposed.procedureCodes'],
    ['행위 코드 항목이 빈 문자열', bodyOf({ procedureCodes: ['A', ''] }), 'VALUE_INVALID', 'proposed.procedureCodes[1]'],
    ['행위 코드 항목이 공백뿐', bodyOf({ procedureCodes: [' \t\n '] }), 'VALUE_INVALID', 'proposed.procedureCodes[0]'],
    ['행위 코드 항목이 문자열이 아님', bodyOf({ procedureCodes: [1] }), 'VALUE_INVALID', 'proposed.procedureCodes[0]'],
    ['proposed 의 알 수 없는 키', bodyOf({ treatmentCode: 'X' }), 'UNKNOWN_FIELD', 'proposed.treatmentCode'],
    ['최상위의 알 수 없는 키', { ...bodyOf(), treatmentId: T2 }, 'UNKNOWN_FIELD', 'request.treatmentId'],
  ];
  it.each(BAD_BODIES)('400: %s — 어긋난 경로와 함께 거절되고 저장 상태는 그대로다', async (_name, body, code, path) => {
    const world = setup();
    const before = world.state();
    const response = await submit(world, 'ha-clinic-1', T1, CLINIC, body);
    expect(response.status).toBe(400);
    const parsed = await json(response);
    expect(parsed.error).toBe('INVALID_REQUEST');
    expect(parsed.defects).toContainEqual({ code, path });
    expect(world.state()).toEqual(before);
  });

  it('400 NOT_JSON: 깨진 JSON·빈 본문', async () => {
    const world = setup();
    const before = world.state();
    for (const text of ['{not json', '', 'undefined']) {
      const response = await callRaw(world.as('ha-clinic-1'), 'POST', requestPath(CLINIC, T1), text);
      expect(response.status, text).toBe(400);
      expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'NOT_JSON', path: 'request' }] });
    }
    expect(world.state()).toEqual(before);
  });

  it('본문 결함이 치료 확인보다 먼저다: 본문도 틀리고 치료도 없으면 본문 결함만 나온다', async () => {
    const world = setup();
    const response = await submit(world, 'ha-clinic-1', 'NO_SUCH', CLINIC, { proposed: { benefitType: 'X' } });
    expect(response.status).toBe(400);
    expect((await json(response)).defects.map((defect: Json) => defect.path)).toEqual(['proposed.benefitType', 'proposed.procedureCodes', 'proposed.calcClass']);
  });

  it('없는 치료 · 다른 병원의 치료 · 숨긴 치료는 응답이 완전히 같다 (400 TREATMENT_NOT_IN_CATALOG, 다른 병원 자료의 존재를 드러내지 않는다)', async () => {
    const world = setup();
    await publishDraft(world, { deactivations: [T2] });
    const before = world.state();
    const responses = [];
    for (const treatmentId of ['TEST_FIXTURE_NO_SUCH_TREATMENT', OTHER_CLINIC_TREATMENT_ID, T2]) {
      const response = await submit(world, 'ha-clinic-1', treatmentId);
      responses.push({ status: response.status, body: await json(response) });
    }
    expect(responses[0]).toEqual({ status: 400, body: { error: 'INVALID_REQUEST', defects: [{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'treatmentId' }] } });
    expect(responses[1]).toEqual(responses[0]);
    expect(responses[2]).toEqual(responses[0]);
    expect(world.state()).toEqual(before);
    // 같은 응답이 반대 방향에도 성립한다: 병원 2 의 HA 가 병원 1 의 치료 id 를 자기 경로로 보내도 같다.
    const reverse = await submit(world, 'ha-clinic-2', T1, OTHER);
    expect({ status: reverse.status, body: await json(reverse) }).toEqual(responses[0]);
    expect(world.state()).toEqual(before);
  });

  it('병원 관리자 화면이 요청 후보로 읽는 치료 목록(GET …/treatments)은 서버가 받는 치료와 같은 집합이다: 숨긴 치료는 목록에 없고 보내도 거절된다', async () => {
    const world = setup();
    await publishDraft(world, { deactivations: [T2] });
    const list = await json(await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/treatments`));
    const listed: string[] = list.treatments.map((row: Json) => row.treatmentId);
    expect(listed).not.toContain(T2);
    expect(listed).toContain(T1);
    // 목록에 있는 치료는 모두 받아 주고, 목록에 없는 숨긴 치료는 받지 않는다.
    for (const treatmentId of listed) expect((await submit(world, 'ha-clinic-1', treatmentId)).status, treatmentId).toBe(200);
    expect((await submit(world, 'ha-clinic-1', T2)).status).toBe(400);
  });

  it('409 REVIEW_ALREADY_REQUESTED: 같은 치료에 열린 요청이 있으면 아무것도 저장하지 않는다. 다른 치료·다른 병원은 막지 않는다', async () => {
    const world = setup();
    expect((await submit(world, 'ha-clinic-1', T1)).status).toBe(200);
    const before = world.state();
    const duplicate = await submit(world, 'ha-clinic-1', T1, CLINIC, bodyOf({ calcClass: 'NEEDS_REVIEW' }));
    expect(duplicate.status).toBe(409);
    expect(await json(duplicate)).toEqual({ error: 'CONFLICT', reason: 'REVIEW_ALREADY_REQUESTED' });
    expect(world.state()).toEqual(before);
    expect(world.repo.listCoverageReviewRequests(TEST_FIXTURE_CLINIC_ID)).toHaveLength(1);

    expect((await submit(world, 'ha-clinic-1', T2)).status).toBe(200);
    expect((await submit(world, 'ha-clinic-2', OTHER_CLINIC_TREATMENT_ID, OTHER)).status).toBe(200);
  });

  it('요청이 닫히면(반려) 같은 치료에 새 요청을 낼 수 있다. 새 요청이 열려 있는 동안은 다시 막힌다', async () => {
    const world = setup();
    const first = await json(await submit(world, 'ha-clinic-1', T1));
    closeByRejection(world, first.reviewRequest.id);
    const second = await submit(world, 'ha-clinic-1', T1);
    expect(second.status).toBe(200);
    const created = (await json(second)).reviewRequest;
    expect(created.id).not.toBe(first.reviewRequest.id);
    expect(created.status).toBe('REVIEW_REQUESTED');
    expect((await submit(world, 'ha-clinic-1', T1)).status).toBe(409);
  });

  it('저장 도중 쓰기가 실패하면 500 이고 모두 되돌려진다 (요청 기록·감사 기록)', async () => {
    const world = setup({ wrapRepo: (repo) => repoThrowingOn(repo, 'appendAuditLog').repo });
    const before = world.state();
    const response = await submit(world, 'ha-clinic-1', T1);
    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: 'INTERNAL_ERROR' });
    expect(world.state()).toEqual(before);
  });

  it('카탈로그 참조가 깨진 서버 데이터는 500 이다 (요청 쪽 잘못으로 보내지 않는다)', async () => {
    const world = setup({ wrapRepo: (repo) => repoWith(repo, { getTreatmentVersion: () => null }) as unknown as MemoryRepository });
    const before = world.state();
    const response = await submit(world, 'ha-clinic-1', T1);
    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: 'INTERNAL_ERROR' });
    expect(world.state()).toEqual(before);
  });
});

describe('GET …/review-requests: 병원 관리자의 읽기 전용 목록', () => {
  it('자기 병원의 요청만 최신순으로 낸다: { reviewRequests: [보기] }', async () => {
    const world = setup();
    world.world.clock.set('2026-10-17T01:00:00.000Z');
    const a = (await json(await submit(world, 'ha-clinic-1', T1))).reviewRequest;
    world.world.clock.set('2026-10-17T03:00:00.000Z');
    const b = (await json(await submit(world, 'ha-clinic-1', T2))).reviewRequest;
    world.world.clock.set('2026-10-17T02:00:00.000Z');
    await submit(world, 'ha-clinic-2', OTHER_CLINIC_TREATMENT_ID, OTHER);

    const response = await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/review-requests`);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(Object.keys(body)).toEqual(['reviewRequests']);
    expect(body.reviewRequests.map((row: Json) => row.id)).toEqual([b.id, a.id]);
    expect(body.reviewRequests.every((row: Json) => Object.keys(row).sort().join() === VIEW_KEYS.join())).toBe(true);
    expect(body.reviewRequests[1]).toEqual(a);

    const other = await json(await call(world.as('ha-clinic-2'), 'GET', `${OTHER}/review-requests`));
    expect(other.reviewRequests.map((row: Json) => row.treatmentId)).toEqual([OTHER_CLINIC_TREATMENT_ID]);
  });

  it('요청이 없으면 빈 목록이고, 읽기는 저장 상태를 바꾸지 않는다', async () => {
    const world = setup();
    const before = world.state();
    expect(await json(await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/review-requests`))).toEqual({ reviewRequests: [] });
    expect(world.state()).toEqual(before);
  });

  it('처리 결과를 읽을 수 있다: 반려 사유가 보이고, 결과·초안 매핑 id 는 보이지 않는다', async () => {
    const world = setup();
    const created = (await json(await submit(world, 'ha-clinic-1', T1))).reviewRequest;
    closeByRejection(world, created.id);
    const body = await json(await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/review-requests`));
    expect(body.reviewRequests).toEqual([{ ...created, status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 반려 사유' }]);
    expect([...collectKeys(body)].filter((key) => /mapping/i.test(key))).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('TEST_FIXTURE_MAPPING');
  });
});

describe('GET /review-queue: 검토 담당자(RV)의 대기열', () => {
  it('모든 병원의 열린 요청을 오래된 순으로 낸다: { queue: [{ clinic, ...보기, current }] }', async () => {
    const world = setup();
    world.world.clock.set('2026-10-17T03:00:00.000Z');
    const first = (await json(await submit(world, 'ha-clinic-1', T1))).reviewRequest;
    world.world.clock.set('2026-10-17T01:00:00.000Z');
    const second = (await json(await submit(world, 'ha-clinic-2', OTHER_CLINIC_TREATMENT_ID, OTHER, bodyOf({ calcClass: 'GENERAL_BENEFIT', benefitType: 'BENEFIT' })))).reviewRequest;
    world.world.clock.set('2026-10-17T02:00:00.000Z');
    const third = (await json(await submit(world, 'ha-clinic-1', T3))).reviewRequest;
    // 닫힌 요청은 대기열에서 빠진다.
    world.world.clock.set('2026-10-17T00:00:00.000Z');
    const closed = (await json(await submit(world, 'ha-clinic-1', T2))).reviewRequest;
    closeByRejection(world, closed.id, T2);

    const before = world.state();
    const response = await call(world.as('rv-1'), 'GET', QUEUE);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(world.state()).toEqual(before);
    expect(Object.keys(body)).toEqual(['queue']);
    expect(body.queue.map((row: Json) => row.id)).toEqual([second.id, third.id, first.id]);
    expect(body.queue.map((row: Json) => row.clinic.id)).toEqual([OTHER_CLINIC_ID, TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_CLINIC_ID]);
    expect(Object.keys(body.queue[0]).sort()).toEqual([...VIEW_KEYS, 'clinic', 'current'].sort());
    expect(body.queue[2]).toEqual({
      ...first,
      clinic: { id: TEST_FIXTURE_CLINIC_ID, name: world.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!.name },
      current: { displayName: first.treatmentName, treatmentCode: 'TEST_FIXTURE_TC_1', benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'], calcClass: 'GENERAL_BENEFIT' },
    });
    expect(body.queue[0].clinic).toEqual({ id: OTHER_CLINIC_ID, name: world.repo.getClinic(OTHER_CLINIC_ID)!.name });
    expect(body.queue[0].current).toMatchObject({ displayName: 'TEST_FIXTURE 병원2 치료' });
    expect([...collectKeys(body)].filter((key) => /mapping/i.test(key))).toEqual([]);
  });

  it('요청을 낸 뒤 그 치료를 숨겨 게시하면 요청은 대기열에 남고 current 만 null 이다 (현재 게시 치료의 정의는 제출 규칙과 같다)', async () => {
    const world = setup();
    const submitted = (await json(await submit(world, 'ha-clinic-1', T2))).reviewRequest;
    const keptOther = (await json(await submit(world, 'ha-clinic-1', T1))).reviewRequest;
    await publishDraft(world, { deactivations: [T2] });
    const before = world.state();
    const body = await json(await call(world.as('rv-1'), 'GET', QUEUE));
    expect(world.state()).toEqual(before);
    expect(body.queue.map((row: Json) => row.id).sort()).toEqual([submitted.id, keptOther.id].sort());
    const hidden = body.queue.find((row: Json) => row.id === submitted.id);
    expect(hidden).toEqual({ ...submitted, clinic: { id: TEST_FIXTURE_CLINIC_ID, name: world.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!.name }, current: null });
    // 숨기지 않은 치료의 현재 게시값은 그대로 채워진다.
    expect(body.queue.find((row: Json) => row.id === keptOther.id).current).toMatchObject({ treatmentCode: 'TEST_FIXTURE_TC_1' });
  });

  it('요청이 없으면 { queue: [] } 이다', async () => {
    const world = setup();
    expect(await json(await call(world.as('rv-1'), 'GET', QUEUE))).toEqual({ queue: [] });
  });
});

describe('불변식: 요청은 제안 기록일 뿐이다', () => {
  it('I1. 성공한 요청은 검토 요청 저장과 감사 기록만 바꾼다 (저장소 전체 비교). 제안은 게시된 판단 값을 덮어쓰지 않는다', async () => {
    const world = setup();
    const before = world.state();
    const treatmentIds = [T1, T2, T3];
    const versionsBefore = treatmentIds.map((id) => world.repo.listTreatmentVersions(id));
    const response = await submit(world, 'ha-clinic-1', T1, CLINIC, bodyOf({ benefitType: 'NON_BENEFIT', calcClass: 'NEEDS_REVIEW', procedureCodes: ['TEST_FIXTURE_ZZZ'] }));
    expect(response.status).toBe(200);

    const after = world.state();
    expect(changedKeys(before, after)).toEqual(['auditLog', 'reviewRequests']);
    // 바뀐 두 저장소도 정확히 한 건씩만 늘었다.
    expect((after.reviewRequests as unknown[]).length).toBe((before.reviewRequests as unknown[]).length + 1);
    expect((after.auditLog as unknown[]).length).toBe((before.auditLog as unknown[]).length + 1);
    // 판단 값 한 곳씩 직접 확인: 치료 기록(활성·순서)·치료 버전(분류·급여 구분·치료 코드·행위 코드)·카탈로그·병원·항목 버전/상태·묶음·범위·초안.
    expect(treatmentIds.map((id) => world.repo.listTreatmentVersions(id))).toEqual(versionsBefore);
    expect(world.repo.listTreatmentVersions(T1)[0]).toMatchObject({ calcClass: 'GENERAL_BENEFIT', benefitType: 'BENEFIT', treatmentCode: 'TEST_FIXTURE_TC_1', procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'] });
    for (const key of ['clinics', 'treatments', 'treatmentVersions', 'baseFees', 'catalogVersions', 'catalogDrafts', 'itemVersions', 'itemStates', 'bundles', 'bundleEvents', 'scopeHistory', 'policySources', 'insurers', 'idlePolicies']) {
      expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
    }
  });

  it('I1b. 이미 올려 둔 초안도 요청에 영향을 받지 않는다 (요청은 초안을 만들지도 바꾸지도 않는다)', async () => {
    const world = setup();
    expect((await call(world.as('ha-clinic-1'), 'PUT', `${CLINIC}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] })).status).toBe(200);
    const draftBefore = world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID);
    expect((await submit(world, 'ha-clinic-1', T1)).status).toBe(200);
    expect(world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).toEqual(draftBefore);
  });

  it('I2. 공개 카탈로그·준비 상태·공개 계산이 요청 전후 같다. 분류 확인이 필요한 새 치료는 요청 뒤에도 보류(ON_HOLD)다', async () => {
    const world = setup();
    // 기존 관리자 흐름으로 새 치료를 게시한다: 분류는 서버가 NEEDS_REVIEW 로 정한다.
    await publishDraft(world, { additions: [additionBody('NEW_A')] });
    expect(world.repo.listTreatmentVersions(ADDED_1)[0]).toMatchObject({ calcClass: 'NEEDS_REVIEW' });

    const catalogBefore = await publicCatalog(world);
    const readinessBefore = readReadiness(world.repo, READINESS_CTX);
    const selections = [[T1], [ADDED_1], [T1, ADDED_1], [T1, T2]];
    const estimatesBefore = await Promise.all(selections.map((ids) => publicEstimate(world, ids)));
    expect(estimatesBefore[1]!.body.result.state).toBe('ON_HOLD');
    expect(estimatesBefore[1]!.body.result.holdReasons).toContainEqual({ treatmentId: ADDED_1, code: 'CLASSIFICATION_NEEDS_REVIEW' });
    expect(estimatesBefore[0]!.body.result.state).toBe('ESTIMATED');

    // 새 치료와 기존 치료 모두 요청하고, 분류를 "일반 급여"로 제안해도 계산은 그대로다.
    expect((await submit(world, 'ha-clinic-1', ADDED_1, CLINIC, bodyOf({ benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' }))).status).toBe(200);
    expect((await submit(world, 'ha-clinic-1', T1, CLINIC, bodyOf({ benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT' }))).status).toBe(200);

    expect(await publicCatalog(world)).toEqual(catalogBefore);
    expect(readReadiness(world.repo, READINESS_CTX)).toEqual(readinessBefore);
    const estimatesAfter = await Promise.all(selections.map((ids) => publicEstimate(world, ids)));
    expect(estimatesAfter).toEqual(estimatesBefore);
    expect(estimatesAfter[1]!.body.result.state).toBe('ON_HOLD');
    expect(estimatesAfter[1]!.body.result.holdReasons).toContainEqual({ treatmentId: ADDED_1, code: 'CLASSIFICATION_NEEDS_REVIEW' });
    expect(world.repo.listTreatmentVersions(ADDED_1)[0]).toMatchObject({ calcClass: 'NEEDS_REVIEW' });
  });

  it('I3. 거절된 요청(400·409·403·401·404·405)은 어느 것도 저장소를 바꾸지 않는다 (한 번에 모아 비교)', async () => {
    const world = setup();
    expect((await submit(world, 'ha-clinic-1', T1)).status).toBe(200);
    const before = world.state();
    const attempts: Array<[TestAccountKey | null, string, string, unknown]> = [
      ['ha-clinic-1', 'POST', requestPath(CLINIC, T1), bodyOf()], // 409
      ['ha-clinic-1', 'POST', requestPath(CLINIC, 'NO_SUCH'), bodyOf()], // 400
      ['ha-clinic-1', 'POST', requestPath(CLINIC, T2), { proposed: {} }], // 400
      ['ha-clinic-1', 'POST', requestPath(CLINIC, OTHER_CLINIC_TREATMENT_ID), bodyOf()], // 400
      ['ha-clinic-2', 'POST', requestPath(CLINIC, T2), bodyOf()], // 403
      ['rv-1', 'POST', requestPath(CLINIC, T2), bodyOf()], // 403
      ['po-1', 'POST', requestPath(CLINIC, T2), bodyOf()], // 403
      [null, 'POST', requestPath(CLINIC, T2), bodyOf()], // 401
      ['ha-clinic-1', 'PUT', requestPath(CLINIC, T2), bodyOf()], // 405
      ['ha-clinic-1', 'POST', `${CLINIC}/treatments/${T2}`, bodyOf()], // 404
    ];
    for (const [account, method, path, body] of attempts) {
      const response = await call(world.as(account), method, path, body);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(world.state(), `${account} ${method} ${path}`).toEqual(before);
    }
  });

  it('I4. 병원 사이에 새지 않는다: 병원 1 의 HA 는 병원 2 의 경로·목록·요청에 닿지 못하고, 병원 목록은 자기 병원 요청만 담는다. RV 대기열만 두 병원을 함께 본다', async () => {
    const world = setup();
    const mine = (await json(await submit(world, 'ha-clinic-1', T1))).reviewRequest;
    const theirs = (await json(await submit(world, 'ha-clinic-2', OTHER_CLINIC_TREATMENT_ID, OTHER))).reviewRequest;

    expect((await submit(world, 'ha-clinic-1', OTHER_CLINIC_TREATMENT_ID, OTHER)).status).toBe(403);
    expect((await call(world.as('ha-clinic-1'), 'GET', `${OTHER}/review-requests`)).status).toBe(403);
    const ownList = await json(await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/review-requests`));
    expect(ownList.reviewRequests.map((row: Json) => row.id)).toEqual([mine.id]);
    expect(JSON.stringify(ownList)).not.toContain(theirs.id);
    expect(JSON.stringify(ownList)).not.toContain('병원2');

    const queue = await json(await call(world.as('rv-1'), 'GET', QUEUE));
    expect(queue.queue.map((row: Json) => row.id).sort()).toEqual([mine.id, theirs.id].sort());
  });

  it('I5. 병원 관리자에게 검토 요청 생성 말고는 쓰기 길이 없다: 승인·반려·닫기·매핑 수정·"검토 완료" 표시에 해당하는 경로는 404/405 이고 저장 상태가 그대로다', async () => {
    const world = setup();
    const created = (await json(await submit(world, 'ha-clinic-1', T1))).reviewRequest;
    const before = world.state();
    const id = created.id as string;
    const paths = [
      `${CLINIC}/review-requests/${id}`,
      `${CLINIC}/review-requests/${id}/approve`,
      `${CLINIC}/review-requests/${id}/reject`,
      `${CLINIC}/review-requests/${id}/close`,
      `${CLINIC}/review-requests/${id}/complete`,
      `${CLINIC}/review-requests/${id}/mapping`,
      `${CLINIC}/treatments/${T1}/mapping`,
      `${CLINIC}/treatments/${T1}/review-requests/${id}`,
      `${CLINIC}/mappings`,
      `${CLINIC}/mappings/approve`,
      `${QUEUE}/${id}`,
      `${QUEUE}/${id}/approve`,
      `${QUEUE}/${id}/reject`,
      'mappings',
      'rule-bundles/publish',
      `${CLINIC}/classification`,
    ];
    for (const account of ['ha-clinic-1', 'rv-1'] as const) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const path of paths) {
          const response = await call(world.as(account), method, path, method === 'GET' ? undefined : { status: 'APPROVED' });
          expect([404, 405], `${account} ${method} ${path}`).toContain(response.status);
        }
      }
    }
    // 만든 요청 자체를 바꾸는 방법도 없다: 같은 경로의 PUT/PATCH/DELETE 는 405.
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect((await call(world.as('ha-clinic-1'), method, requestPath(CLINIC, T1), bodyOf())).status).toBe(405);
      expect((await call(world.as('ha-clinic-1'), method, `${CLINIC}/review-requests`, bodyOf())).status).toBe(405);
    }
    expect(world.state()).toEqual(before);
  });

  it('I5b. 라우터의 경로 표가 이 기능 이전 여섯 경로에 검토 요청 두 경로를 더한 것뿐이다 (HA 쓰기는 초안 저장·버리기·미리보기·게시·검토 요청 제출 다섯 가지)', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/server/admin/router.ts', import.meta.url)), 'utf8');
    const routes = [...source.matchAll(/\{ method: '([A-Z]+)', tail: \[([^\]]*)\], handler: (\w+) \}/g)].map((match) => `${match[1]} ${match[2]!.replaceAll("'", '').replaceAll(' ', '')}`);
    expect(routes).toEqual([
      'GET treatments',
      'PUT catalog,draft',
      'DELETE catalog,draft',
      'POST catalog,preview',
      'POST catalog,publish',
      'GET catalog,versions',
      'GET review-requests',
      'POST treatments,:treatmentId,review-requests',
    ]);
  });
});

describe('운영 구성: 인증 공급자가 연결되기 전에는 세 경로 모두 401 이다', () => {
  it('운영 관리자 서비스는 시험 쿠키·역할 헤더를 위조해도 인증하지 않는다 (저장 상태 불변)', async () => {
    const { world } = buildWorld();
    const api = createOperatingServices({ repo: world.repo, log: silentLog, today: () => TEST_TODAY });
    const admin = createOperatingAdminServices({ api, clock: new FixedClock(), ids: new CounterIdGenerator() });
    const before = world.repo.exportState();
    const forged = { cookie: 'bodam_test_session=TEST_FIXTURE_SESSION_1_ha-clinic-1', 'x-role': 'RV' };
    const attempts: Array<[string, string, unknown]> = [
      ['POST', requestPath(CLINIC, T1), bodyOf()],
      ['GET', `${CLINIC}/review-requests`, undefined],
      ['GET', QUEUE, undefined],
      // 경로·메서드가 틀려도 인증이 먼저다.
      ['DELETE', QUEUE, undefined],
      ['GET', `${QUEUE}/extra`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      const response = await call(admin, method, path, body, forged);
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await json(response)).toEqual({ error: 'UNAUTHENTICATED' });
    }
    expect(world.repo.exportState()).toEqual(before);
  });
});
