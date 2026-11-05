import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { submitForReview } from '../../src/server/approval';
import { createDraft } from '../../src/server/authoring';
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
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { adminServicesOf, identityOf, staticAuthenticator } from '../fixtures/server/admin.fixture';
import type { TestAccountKey } from '../fixtures/server/admin.fixture';
import { CLINIC_1_SLUG, TEST_ACCEPTED_ORIGINS, TEST_TODAY, publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { T1, T2 } from '../fixtures/server/base-fee.fixture';
import { T3, addThirdTreatment, additionBody, changedKeys } from '../fixtures/server/catalog-structure.fixture';
import { CounterIdGenerator, FixedClock } from '../fixtures/server/clock.fixture';
import { makeCatalogVersion, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { adoptTreatmentVersion, baseContent } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';
import { collectKeys, repoWith } from './helpers';

// 매핑 검토 관리자 API (M7 매핑 검토, design.md 권한 표 · DD-19 · AC-022a-c · AC-024). 모두 handleAdmin 을 지난다. 전부 RV(플랫폼 단위 소속) 전용이다.
//   GET  /api/admin/review-history                                          — 닫힌 요청 이력
//   POST /api/admin/review-requests/{reviewRequestId}/mappings              — 매핑 초안 작성
//   POST /api/admin/mappings/{mappingId}/versions/{version}/submit          — 작성자가 검토 제출 (본문 { reviewRequestId })
//   POST /api/admin/mappings/{mappingId}/versions/{version}/approve         — 다른 RV 가 승인 (본문 { reviewRequestId })
//   POST /api/admin/mappings/{mappingId}/versions/{version}/reject          — 다른 RV 가 사유와 함께 반려 (본문 { reviewRequestId, reason })
// 승인은 검토 기록이다: 치료 분류·카탈로그·규칙 묶음·범위·키오스크 계산을 바꾸지 않는다 (매핑은 APPROVED 가 될 뿐 PUBLISHED 가 되지 않는다).
// 세계: 병원 1 에 치료 셋(T1·T2·T3)과 승인된 매핑·게시된 규칙 묶음, 병원 2 에 치료 하나. 시험 계정: ha-clinic-1 · ha-clinic-2 · rv-1(플랫폼 RV) · po-1, 그리고 둘째 플랫폼 RV.

const BASE = 'http://localhost/api/admin';
const CLINIC = `clinics/${TEST_FIXTURE_CLINIC_ID}`;
const QUEUE = 'review-queue';
const HISTORY = 'review-history';
const PREVIEW_BODY = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const ADDED_1 = 'TEST_FIXTURE_ADDED_TREATMENT_1';
const READINESS_CTX: ReadinessContext = { at: TEST_TODAY, acceptedOrigins: TEST_ACCEPTED_ORIGINS, digest: canonicalDigest };

/** 둘째 플랫폼 단위 RV (rv-1 과 다른 사람: 작성자와 승인자를 가르는 데 쓴다). */
const RV2: AdminIdentity = { userId: 'TEST_FIXTURE_RV_PERSON_2', memberships: [{ clinicId: null, role: 'RV' }] };
const CLINIC_BOUND_RV: AdminIdentity = { userId: 'TEST_FIXTURE_RV_BOUND', memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'RV' }] };
const PLATFORM_HA: AdminIdentity = { userId: 'TEST_FIXTURE_HA_PLATFORM', memberships: [{ clinicId: null, role: 'HA' }] };

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type AdminOf = ReturnType<typeof adminServicesOf>['admin'];
type Who = TestAccountKey | AdminIdentity | null;

const SOURCE = { insurerDocumentId: 'TEST_FIXTURE_DOC', revisionDate: '2026-01-01', clauseOrPage: 'TEST_FIXTURE_P1', effectiveDate: '2026-01-01', verifiedBy: 'TEST_FIXTURE_V', verifiedAt: '2026-01-02' };
const MAPPING = {
  scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
  decision: 'COVERED',
  groupKey: 'TEST_FIXTURE_GROUP',
  validity: { from: '2026-01-01', to: '2026-12-31' },
  policySources: [SOURCE],
};
const draftBody = (overrides: Record<string, unknown> = {}) => ({ mapping: { ...MAPPING, ...overrides } });
const refBody = (reviewRequestId: string) => ({ reviewRequestId });
const rejectBody = (reviewRequestId: string, reason = 'TEST_FIXTURE 반려 사유') => ({ reviewRequestId, reason });
const PROPOSAL = { benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROPOSED_PROC'], calcClass: 'GENERAL_BENEFIT' };

const draftPath = (requestId: string): string => `review-requests/${encodeURIComponent(requestId)}/mappings`;
const itemPath = (mappingId: string, version: string, action: 'submit' | 'approve' | 'reject'): string => `mappings/${encodeURIComponent(mappingId)}/versions/${encodeURIComponent(version)}/${action}`;

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

function setup() {
  const built = buildWorld();
  publishSecondClinicCatalog(built.world);
  addThirdTreatment(built.world);
  // 서비스(읽기 포함)가 보는 저장소. unreadable 을 켜면 치료 버전 조회가 비어 현재 카탈로그 참조가 깨진 것처럼 읽힌다(서버 데이터 결함 흉내). 비교와 직접 쓰기는 실제 저장소로 한다.
  const control = { unreadable: false };
  const real = built.world.repo;
  const wrapped = repoWith(real, { getTreatmentVersion: (id: string) => (control.unreadable ? null : real.getTreatmentVersion(id)) } as never) as unknown as MemoryRepository;
  const serviceWorld: World = { ...built.world, repo: wrapped, deps: { ...built.world.deps, repo: wrapped } };
  const as = (who: Who): AdminOf => adminServicesOf(serviceWorld, { authenticator: staticAuthenticator(who === null ? null : typeof who === 'string' ? identityOf(who) : who) }).admin;
  const api = adminServicesOf(serviceWorld, { authenticator: staticAuthenticator(null) }).api;
  return { ...built, repo: real, as, api, control, state: () => real.exportState() };
}

type Setup = ReturnType<typeof setup>;

/** HA 가 검토 요청을 낸다 (API 경로). 요청 id 를 돌려준다. */
async function requestFor(world: Setup, treatmentId: string = T1): Promise<string> {
  const response = await call(world.as('ha-clinic-1'), 'POST', `${CLINIC}/treatments/${encodeURIComponent(treatmentId)}/review-requests`, { proposed: PROPOSAL });
  expect(response.status).toBe(200);
  return (await json(response)).reviewRequest.id as string;
}

/** RV 가 초안을 만든다 (API 경로). */
async function draftFor(world: Setup, requestId: string, who: Who = 'rv-1'): Promise<{ id: string; version: string; entry: Json }> {
  const response = await call(world.as(who), 'POST', draftPath(requestId), draftBody());
  expect(response.status).toBe(200);
  const entry = (await json(response)).entry as Json;
  return { id: entry.mapping.ref.id as string, version: entry.mapping.ref.version as string, entry };
}

/** 요청 → 초안 → 제출까지. */
async function submittedFor(world: Setup, treatmentId: string = T1): Promise<{ requestId: string; id: string; version: string }> {
  const requestId = await requestFor(world, treatmentId);
  const draft = await draftFor(world, requestId);
  const response = await call(world.as('rv-1'), 'POST', itemPath(draft.id, draft.version, 'submit'), refBody(requestId));
  expect(response.status).toBe(200);
  return { requestId, id: draft.id, version: draft.version };
}

const approveCall = (world: Setup, flow: { requestId: string; id: string; version: string }, who: Who = RV2): Promise<Response> =>
  call(world.as(who), 'POST', itemPath(flow.id, flow.version, 'approve'), refBody(flow.requestId));

const publicCatalog = async (world: Setup): Promise<Json> => json(await handleCatalog(world.api, CLINIC_1_SLUG));

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
  expect((await call(admin, 'POST', `${CLINIC}/catalog/publish`, { publishConfirmation: (await json(preview)).publishConfirmation })).status).toBe(200);
}

/** 병원 1 의 현재 카탈로그에서 치료 하나를 뺀 새 카탈로그를 현재로 만든다 (저장소 직접). */
function dropFromCatalog(world: Setup, treatmentId: string): void {
  const current = world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
  const kept = current.treatmentVersionIds.filter((id) => world.repo.getTreatmentVersion(id)!.treatmentId !== treatmentId);
  const catalog = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_DROP', treatmentVersionIds: kept, baseFeeIds: current.baseFeeIds });
  world.repo.putCatalogVersion(catalog);
  world.repo.saveClinic({ ...world.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, currentCatalogVersionId: catalog.id });
}

const REJECTED_STATE_KEYS = ['auditLog', 'itemStates', 'reviewRequests'];

describe('인증·권한 표: 새 경로 다섯 개는 모두 플랫폼 단위 RV 전용이다 (거절은 저장 상태가 그대로)', () => {
  // [이름, 방법, 경로, 본문]
  const ROUTES: Array<[string, string, string, unknown]> = [
    ['이력', 'GET', HISTORY, undefined],
    ['초안 작성', 'POST', draftPath('TEST_FIXTURE_REVIEW_REQUEST_1'), draftBody()],
    ['제출', 'POST', itemPath('TEST_FIXTURE_MAPPING_1', '1', 'submit'), refBody('TEST_FIXTURE_REVIEW_REQUEST_1')],
    ['승인', 'POST', itemPath('TEST_FIXTURE_MAPPING_1', '1', 'approve'), refBody('TEST_FIXTURE_REVIEW_REQUEST_1')],
    ['반려', 'POST', itemPath('TEST_FIXTURE_MAPPING_1', '1', 'reject'), rejectBody('TEST_FIXTURE_REVIEW_REQUEST_1')],
  ];
  const IDENTITIES: Array<[string, Who, number, Json]> = [
    ['인증 없음', null, 401, { error: 'UNAUTHENTICATED' }],
    ['병원 1 HA', 'ha-clinic-1', 403, { error: 'FORBIDDEN' }],
    ['다른 병원 HA', 'ha-clinic-2', 403, { error: 'FORBIDDEN' }],
    ['PO', 'po-1', 403, { error: 'FORBIDDEN' }],
    ['병원에 매인 RV', CLINIC_BOUND_RV, 403, { error: 'FORBIDDEN' }],
    ['플랫폼 단위 HA', PLATFORM_HA, 403, { error: 'FORBIDDEN' }],
  ];

  it.each(ROUTES.flatMap(([name, method, path, body]) => IDENTITIES.map(([who, identity, status, expected]) => [name, who, identity, method, path, body, status, expected] as const)))(
    '%s · %s',
    async (_route, _who, identity, method, path, body, status, expected) => {
      const world = setup();
      const request = await requestFor(world);
      const before = world.state();
      const response = await call(world.as(identity), method, path.replace('TEST_FIXTURE_REVIEW_REQUEST_1', request), body);
      expect(response.status).toBe(status);
      expect(await json(response)).toEqual(expected);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(world.state()).toEqual(before);
    },
  );

  it('브라우저 시험이 쓰는 시험 계정과 같은 신원이다: rv-2 는 둘째 플랫폼 RV, rv-clinic-1 은 병원 1 에 매인 RV (RV 경로 403)', async () => {
    expect(identityOf('rv-2')).toEqual(RV2);
    expect(identityOf('rv-clinic-1').memberships).toEqual([{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'RV' }]);
    const world = setup();
    expect((await call(world.as('rv-2'), 'GET', HISTORY)).status).toBe(200);
    expect((await call(world.as('rv-clinic-1'), 'GET', HISTORY)).status).toBe(403);
    expect((await call(world.as('rv-clinic-1'), 'GET', QUEUE)).status).toBe(403);
  });

  it('여러 소속: 병원 1 HA + 플랫폼 RV 이면 RV 경로를 쓸 수 있다 (HA 소속이 RV 권한을 막지 않고, RV 소속이 병원 권한을 넓히지도 않는다)', async () => {
    const world = setup();
    const both: AdminIdentity = { userId: 'TEST_FIXTURE_BOTH', memberships: [{ clinicId: TEST_FIXTURE_CLINIC_ID, role: 'HA' }, { clinicId: null, role: 'RV' }] };
    expect((await call(world.as(both), 'GET', HISTORY)).status).toBe(200);
    expect((await call(world.as(both), 'GET', `clinics/${OTHER_CLINIC_ID}/review-requests`)).status).toBe(403);
  });

  it('처리 순서: 401 → 405 → 403 → 400 → 도메인(404·409…). 405 는 소속과 무관하게 인증된 요청에 나가고, 403 은 본문 검사보다 앞선다', async () => {
    const world = setup();
    const before = world.state();
    const wrongMethods: Array<[string, string]> = [
      ['POST', HISTORY],
      ['PUT', HISTORY],
      ['GET', draftPath('R1')],
      ['DELETE', draftPath('R1')],
      ['GET', itemPath('M1', '1', 'approve')],
      ['PUT', itemPath('M1', '1', 'submit')],
      ['PATCH', itemPath('M1', '1', 'reject')],
    ];
    for (const [method, path] of wrongMethods) {
      expect((await call(world.as(null), method, path)).status, `${method} ${path} 인증 없음`).toBe(401);
      expect((await call(world.as('ha-clinic-1'), method, path, method === 'GET' ? undefined : {})).status, `${method} ${path} HA`).toBe(405);
      expect((await call(world.as('rv-1'), method, path, method === 'GET' ? undefined : {})).status, `${method} ${path} RV`).toBe(405);
    }
    // 403 이 400 보다 앞선다: 소속이 없으면 깨진 본문도 403.
    expect((await callRaw(world.as('ha-clinic-1'), 'POST', draftPath('R1'), '{not json')).status).toBe(403);
    // RV 의 깨진 본문은 400, 형식이 맞은 본문이 없는 요청을 가리키면 404.
    expect((await callRaw(world.as('rv-1'), 'POST', draftPath('R1'), '{not json')).status).toBe(400);
    expect((await call(world.as('rv-1'), 'POST', draftPath('TEST_FIXTURE_NO_SUCH'), draftBody())).status).toBe(404);
    expect(world.state()).toEqual(before);
  });

  it('모르는 경로는 404 (인증된 요청에서만): 모양이 비슷한 경로도 열리지 않는다', async () => {
    const world = setup();
    const paths = [
      'review-history/extra',
      'review-requests',
      'review-requests/R1',
      'review-requests/R1/mappings/extra',
      'review-requests/R1/approve',
      'mappings/M1/versions/1',
      'mappings/M1/versions/1/publish',
      'mappings/M1/versions/1/approve/extra',
      'mappings/M1/approve',
      'mappings/M1/versions//approve',
      `${CLINIC}/review-history`,
      `${CLINIC}/mappings/M1/versions/1/approve`,
    ];
    for (const path of paths) {
      expect((await call(world.as('rv-1'), 'POST', path, {})).status, path).toBe(404);
    }
    expect((await call(world.as(null), 'POST', 'mappings/M1/versions/1/publish', {})).status).toBe(401);
  });

  it('역할·병원·사용자·행위자는 본문이나 헤더에서 읽지 않는다 (위조해도 검증된 신원만 쓴다)', async () => {
    const world = setup();
    const requestId = await requestFor(world);
    const before = world.state();
    const forged = { 'x-role': 'RV', 'x-user-id': 'TEST_FIXTURE_RV_PERSON_2', 'x-clinic-id': TEST_FIXTURE_CLINIC_ID, cookie: 'bodam_test_session=TEST_FIXTURE_SESSION_1_rv-1' };
    expect((await call(world.as('ha-clinic-1'), 'POST', draftPath(requestId), draftBody(), forged)).status).toBe(403);
    expect((await call(world.as('ha-clinic-1'), 'GET', HISTORY, undefined, forged)).status).toBe(403);
    for (const key of ['role', 'actor', 'authorId', 'clinicId', 'status', 'origin', 'state', 'approver', 'approvedFingerprint', 'id', 'version']) {
      const response = await call(world.as('rv-1'), 'POST', draftPath(requestId), draftBody({ [key]: 'RV' }));
      expect(response.status, key).toBe(400);
      expect((await json(response)).defects).toEqual([{ code: 'UNKNOWN_FIELD', path: `mapping.${key}` }]);
    }
    for (const key of ['role', 'actor', 'status', 'approvedBy']) {
      const response = await call(world.as('rv-1'), 'POST', itemPath('M1', '1', 'approve'), { ...refBody(requestId), [key]: 'RV' });
      expect(response.status, key).toBe(400);
      expect((await json(response)).defects).toEqual([{ code: 'UNKNOWN_FIELD', path: `request.${key}` }]);
    }
    expect(world.state()).toEqual(before);
  });
});

describe('본문 형식 검사: 모두 400 이고 저장 상태가 그대로다', () => {
  const NOT_OBJECT = [{ code: 'NOT_OBJECT', path: 'request' }];
  const DRAFT_CASES: Array<[string, unknown, Array<{ code: string; path: string }>]> = [
    ['본문이 배열', [], NOT_OBJECT],
    ['mapping 없음', {}, [{ code: 'VALUE_MISSING', path: 'mapping' }]],
    ['최상위 알 수 없는 키', { ...draftBody(), extra: 1 }, [{ code: 'UNKNOWN_FIELD', path: 'request.extra' }]],
    ['decision 열거 밖', draftBody({ decision: 'MAYBE' }), [{ code: 'DECISION_INVALID', path: 'mapping.decision' }]],
    ['세대 열거 밖', draftBody({ scope: [{ generation: 'GEN9', insurerType: 'NON_LIFE' }] }), [{ code: 'SCOPE_INVALID', path: 'mapping.scope[0].generation' }]],
    ['빈 범위', draftBody({ scope: [] }), [{ code: 'SCOPE_EMPTY', path: 'mapping.scope' }]],
    ['빈 약관 출처', draftBody({ policySources: [] }), [{ code: 'POLICY_SOURCES_MISSING', path: 'mapping.policySources' }]],
    ['약관 출처 한 칸이 빔', draftBody({ policySources: [{ ...SOURCE, clauseOrPage: '' }] }), [{ code: 'POLICY_SOURCE_INCOMPLETE', path: 'mapping.policySources[0].clauseOrPage' }]],
    ['달력에 없는 날짜', draftBody({ validity: { from: '2026-02-30', to: '2026-12-31' } }), [{ code: 'DATE_INVALID', path: 'mapping.validity.from' }]],
    ['시작일 > 종료일', draftBody({ validity: { from: '2026-12-31', to: '2026-01-01' } }), [{ code: 'VALIDITY_RANGE_INVALID', path: 'mapping.validity' }]],
    ['COVERED 인데 groupKey 없음', { mapping: { ...MAPPING, groupKey: undefined } }, [{ code: 'GROUP_KEY_REQUIRED', path: 'mapping.groupKey' }]],
    ['EXCLUDED 인데 제외 사유 없음', { mapping: { ...MAPPING, decision: 'EXCLUDED', groupKey: undefined } }, [{ code: 'EXCLUSION_REASON_REQUIRED', path: 'mapping.exclusionReason' }]],
  ];

  it.each(DRAFT_CASES)('초안 작성 · %s', async (_name, body, defects) => {
    const world = setup();
    const requestId = await requestFor(world);
    const before = world.state();
    const response = await call(world.as('rv-1'), 'POST', draftPath(requestId), body);
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects });
    expect(world.state()).toEqual(before);
  });

  const REF_CASES: Array<[string, unknown, Array<{ code: string; path: string }>]> = [
    ['reviewRequestId 없음', {}, [{ code: 'VALUE_MISSING', path: 'reviewRequestId' }]],
    ['빈 reviewRequestId', { reviewRequestId: '' }, [{ code: 'VALUE_INVALID', path: 'reviewRequestId' }]],
    ['숫자 reviewRequestId', { reviewRequestId: 5 }, [{ code: 'VALUE_INVALID', path: 'reviewRequestId' }]],
    ['알 수 없는 키', { reviewRequestId: 'R1', note: 'x' }, [{ code: 'UNKNOWN_FIELD', path: 'request.note' }]],
    ['본문이 문자열', 'R1', NOT_OBJECT],
  ];

  it.each(['submit', 'approve'] as const)('%s · 본문 형식', async (action) => {
    const world = setup();
    const before = world.state();
    for (const [name, body, defects] of REF_CASES) {
      const response = await call(world.as('rv-1'), 'POST', itemPath('M1', '1', action), body);
      expect(response.status, name).toBe(400);
      expect(await json(response), name).toEqual({ error: 'INVALID_REQUEST', defects });
    }
    expect(world.state()).toEqual(before);
  });

  it('반려 · 사유가 없거나 비었거나 공백뿐이면 400, 알 수 없는 키도 400', async () => {
    const world = setup();
    const before = world.state();
    const cases: Array<[unknown, Array<{ code: string; path: string }>]> = [
      [{ reviewRequestId: 'R1' }, [{ code: 'VALUE_MISSING', path: 'reason' }]],
      [{ reviewRequestId: 'R1', reason: '' }, [{ code: 'EMPTY', path: 'reason' }]],
      [{ reviewRequestId: 'R1', reason: '   \n' }, [{ code: 'EMPTY', path: 'reason' }]],
      [{ reviewRequestId: 'R1', reason: 3 }, [{ code: 'VALUE_INVALID', path: 'reason' }]],
      [{ reason: 'x' }, [{ code: 'VALUE_MISSING', path: 'reviewRequestId' }]],
      [{ reviewRequestId: 'R1', reason: 'x', status: 'REJECTED' }, [{ code: 'UNKNOWN_FIELD', path: 'request.status' }]],
    ];
    for (const [body, defects] of cases) {
      const response = await call(world.as('rv-1'), 'POST', itemPath('M1', '1', 'reject'), body);
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects });
    }
    expect(world.state()).toEqual(before);
  });

  it.each([
    ['초안 작성', draftPath('R1')],
    ['제출', itemPath('M1', '1', 'submit')],
    ['승인', itemPath('M1', '1', 'approve')],
    ['반려', itemPath('M1', '1', 'reject')],
  ])('%s · JSON 이 아닌 본문은 NOT_JSON', async (_name, path) => {
    const world = setup();
    const before = world.state();
    for (const text of ['{not json', '', 'undefined']) {
      const response = await callRaw(world.as('rv-1'), 'POST', path, text);
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'NOT_JSON', path: 'request' }] });
    }
    expect(world.state()).toEqual(before);
  });
});

describe('정상 흐름: 병원 요청 → RV-1 초안 → RV-1 제출 → RV-2 승인', () => {
  it('각 단계의 응답은 갱신된 항목 { entry } 이고 대기열 · 이력 · 병원 목록이 따라간다', async () => {
    const world = setup();
    const requestId = await requestFor(world);

    // 대기열: 아직 매핑이 없다.
    const queue0 = (await json(await call(world.as('rv-1'), 'GET', QUEUE))).queue as Json[];
    expect(queue0.find((row) => row.id === requestId)).toMatchObject({ mapping: null, basis: { check: 'MISSING', changedFields: [], reviewed: null }, approvalBlockedReason: null, classification: 'CLASSIFIED', current: { state: 'PUBLISHED' } });

    // 초안 작성
    world.world.clock.set('2026-10-22T01:00:00.000Z');
    const created = await call(world.as('rv-1'), 'POST', draftPath(requestId), draftBody());
    expect(created.status).toBe(200);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const createdBody = await json(created);
    expect(Object.keys(createdBody)).toEqual(['entry']);
    const entry = createdBody.entry as Json;
    expect(entry).toMatchObject({
      id: requestId,
      status: 'REVIEW_REQUESTED',
      mapping: { ref: { kind: 'MAPPING', id: 'TEST_FIXTURE_MAPPING_1', version: '1' }, authorId: identityOf('rv-1').userId, createdAt: '2026-10-22T01:00:00.000Z', lifecycle: 'DRAFT', decision: 'COVERED', groupKey: 'TEST_FIXTURE_GROUP', exclusionReason: null },
      basis: { check: 'MATCH', changedFields: [] },
      approvalBlockedReason: null,
      resultMappingRef: null,
      closedBy: null,
      closedAt: null,
    });
    expect(Object.keys(entry).sort()).toEqual(
      ['approvalBlockedReason', 'basis', 'classification', 'clinic', 'closedAt', 'closedBy', 'current', 'id', 'mapping', 'proposed', 'rejectionReason', 'requestedAt', 'requestedBy', 'resultMappingRef', 'status', 'treatmentId', 'treatmentName'].sort(),
    );

    // 제출
    const submitted = await call(world.as('rv-1'), 'POST', itemPath('TEST_FIXTURE_MAPPING_1', '1', 'submit'), refBody(requestId));
    expect(submitted.status).toBe(200);
    expect((await json(submitted)).entry.mapping.lifecycle).toBe('REVIEW_REQUESTED');

    // 승인
    world.world.clock.set('2026-10-22T05:00:00.000Z');
    const approved = await approveCall(world, { requestId, id: 'TEST_FIXTURE_MAPPING_1', version: '1' });
    expect(approved.status).toBe(200);
    const closed = (await json(approved)).entry as Json;
    expect(closed).toMatchObject({
      status: 'APPROVED',
      rejectionReason: null,
      mapping: { lifecycle: 'APPROVED' },
      resultMappingRef: { kind: 'MAPPING', id: 'TEST_FIXTURE_MAPPING_1', version: '1' },
      closedBy: RV2.userId,
      closedAt: '2026-10-22T05:00:00.000Z',
      approvalBlockedReason: null,
    });

    // 매핑은 APPROVED 일 뿐 PUBLISHED 가 아니다.
    expect(world.repo.getItemState({ kind: 'MAPPING', id: 'TEST_FIXTURE_MAPPING_1', version: '1' })!.state).toBe('APPROVED');

    // 대기열에서 빠지고 이력에 들어간다.
    const queue1 = (await json(await call(world.as('rv-1'), 'GET', QUEUE))).queue as Json[];
    expect(queue1.map((row) => row.id)).not.toContain(requestId);
    const history = (await json(await call(world.as('rv-1'), 'GET', HISTORY))).history as Json[];
    expect(history.map((row) => row.id)).toEqual([requestId]);
    expect(history[0]).toEqual(closed);

    // 병원 관리자는 상태 · 결과와 분류 표지를 읽는다. RV 내부 자료는 없다.
    const ha = await json(await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/review-requests`));
    expect(ha.reviewRequests).toHaveLength(1);
    expect(ha.reviewRequests[0]).toMatchObject({ id: requestId, status: 'APPROVED', rejectionReason: null, classification: 'CLASSIFIED' });
    expect([...collectKeys(ha)].filter((key) => /mapping|basis|author|fingerprint|closed/i.test(key))).toEqual([]);
    expect(JSON.stringify(ha)).not.toContain('TEST_FIXTURE_MAPPING_1');
    expect(JSON.stringify(ha)).not.toContain(RV2.userId);
  });

  it('반려: 사유가 요청에 남고 병원 관리자가 읽는다. 결과 매핑은 없고 이력에 닫은 사람이 나온다', async () => {
    const world = setup();
    const flow = await submittedFor(world);
    world.world.clock.set('2026-10-22T06:00:00.000Z');
    const response = await call(world.as(RV2), 'POST', itemPath(flow.id, flow.version, 'reject'), rejectBody(flow.requestId, '  TEST_FIXTURE 약관 근거 부족  '));
    expect(response.status).toBe(200);
    expect((await json(response)).entry).toMatchObject({
      status: 'REJECTED',
      rejectionReason: '  TEST_FIXTURE 약관 근거 부족  ',
      resultMappingRef: null,
      mapping: { lifecycle: 'REJECTED' },
      closedBy: RV2.userId,
      closedAt: '2026-10-22T06:00:00.000Z',
    });
    const ha = await json(await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/review-requests`));
    expect(ha.reviewRequests[0]).toMatchObject({ status: 'REJECTED', rejectionReason: '  TEST_FIXTURE 약관 근거 부족  ' });
  });

  it('작성자 본인의 반려도 된다 (도메인이 허용한 규칙)', async () => {
    const world = setup();
    const flow = await submittedFor(world);
    const response = await call(world.as('rv-1'), 'POST', itemPath(flow.id, flow.version, 'reject'), rejectBody(flow.requestId));
    expect(response.status).toBe(200);
  });

  it('이력은 두 병원의 닫힌 요청을 최신순으로 함께 낸다', async () => {
    const world = setup();
    world.world.clock.set('2026-10-22T01:00:00.000Z');
    const first = await submittedFor(world, T1);
    world.world.clock.set('2026-10-22T02:00:00.000Z');
    const second = await submittedFor(world, T2);
    expect((await approveCall(world, first)).status).toBe(200);
    expect((await call(world.as(RV2), 'POST', itemPath(second.id, second.version, 'reject'), rejectBody(second.requestId))).status).toBe(200);
    const history = (await json(await call(world.as('rv-1'), 'GET', HISTORY))).history as Json[];
    expect(history.map((row) => row.id)).toEqual([second.requestId, first.requestId]);
    expect(history.map((row) => row.status)).toEqual(['REJECTED', 'APPROVED']);
    expect(history[0]!.clinic.id).toBe(TEST_FIXTURE_CLINIC_ID);
  });

  it('이력이 없으면 { history: [] } 이고 읽기는 저장 상태를 바꾸지 않는다', async () => {
    const world = setup();
    const before = world.state();
    const response = await call(world.as('rv-1'), 'GET', HISTORY);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ history: [] });
    expect(world.state()).toEqual(before);
  });

  it('경로의 id 는 디코딩된다: 슬래시를 담은 id 도 비정상 종료 없이 "연결되지 않은 매핑" 409 로 끝난다', async () => {
    const world = setup();
    const requestId = await requestFor(world);
    const before = world.state();
    const response = await call(world.as('rv-1'), 'POST', itemPath('A/B', '1', 'approve'), refBody(requestId));
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'CONFLICT', reason: 'MAPPING_NOT_LINKED_TO_REQUEST' });
    expect(world.state()).toEqual(before);
  });
});

describe('불변식: 승인은 검토 기록일 뿐이다 (치료 · 분류 · 카탈로그 · 규칙 묶음 · 범위 · 키오스크 계산이 그대로)', () => {
  it('승인 한 번이 바꾸는 저장소 영역은 감사 · 항목 상태 · 요청 셋뿐이고, 공개 카탈로그 · 준비 상태 · 공개 계산이 전후 같다', async () => {
    const world = setup();
    const flow = await submittedFor(world, T1);
    const selections = [[T1], [T1, T2]];
    const catalogBefore = await publicCatalog(world);
    const readinessBefore = readReadiness(world.repo, READINESS_CTX);
    const estimatesBefore = await Promise.all(selections.map((ids) => publicEstimate(world, ids)));
    expect(estimatesBefore[0]!.body.result.state).toBe('ESTIMATED');
    const before = world.state();
    const versionsBefore = [T1, T2, T3].map((id) => world.repo.listTreatmentVersions(id));

    expect((await approveCall(world, flow)).status).toBe(200);

    const after = world.state();
    expect(changedKeys(before, after)).toEqual(REJECTED_STATE_KEYS);
    for (const key of ['clinics', 'treatments', 'treatmentVersions', 'baseFees', 'catalogVersions', 'catalogDrafts', 'itemVersions', 'bundles', 'bundleEvents', 'scopeHistory', 'policySources', 'insurers', 'idlePolicies']) {
      expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
    }
    expect([T1, T2, T3].map((id) => world.repo.listTreatmentVersions(id))).toEqual(versionsBefore);
    expect(await publicCatalog(world)).toEqual(catalogBefore);
    expect(readReadiness(world.repo, READINESS_CTX)).toEqual(readinessBefore);
    expect(await Promise.all(selections.map((ids) => publicEstimate(world, ids)))).toEqual(estimatesBefore);
  });

  it('초안 작성은 요청 · 매핑(내용 · 상태) · 감사만, 제출은 매핑 상태 · 감사만 바꾼다', async () => {
    const world = setup();
    const requestId = await requestFor(world);
    const beforeDraft = world.state();
    const draft = await draftFor(world, requestId);
    const afterDraft = world.state();
    expect(changedKeys(beforeDraft, afterDraft)).toEqual(['auditLog', 'itemStates', 'itemVersions', 'reviewRequests']);
    expect(await json(await call(world.as('rv-1'), 'POST', itemPath(draft.id, draft.version, 'submit'), refBody(requestId)))).toMatchObject({ entry: { mapping: { lifecycle: 'REVIEW_REQUESTED' } } });
    expect(changedKeys(afterDraft, world.state())).toEqual(['auditLog', 'itemStates']);
  });

  it('분류 확인 필요(NEEDS_REVIEW) 치료: 초안 · 제출 · 승인이 되고, 분류 표지는 NEEDS_REVIEW 이며, 치료의 분류와 공개 계산(보류)은 그대로다', async () => {
    const world = setup();
    await publishDraft(world, { additions: [additionBody('NEW_A')] });
    expect(world.repo.listTreatmentVersions(ADDED_1)[0]).toMatchObject({ calcClass: 'NEEDS_REVIEW' });
    const selections = [[ADDED_1], [T1, ADDED_1]];
    const estimatesBefore = await Promise.all(selections.map((ids) => publicEstimate(world, ids)));
    expect(estimatesBefore[0]!.body.result.state).toBe('ON_HOLD');
    expect(estimatesBefore[0]!.body.result.holdReasons).toContainEqual({ treatmentId: ADDED_1, code: 'CLASSIFICATION_NEEDS_REVIEW' });

    const requestId = await requestFor(world, ADDED_1);
    const queue = (await json(await call(world.as('rv-1'), 'GET', QUEUE))).queue as Json[];
    expect(queue.find((row) => row.id === requestId)).toMatchObject({ classification: 'NEEDS_REVIEW', current: { state: 'PUBLISHED', calcClass: 'NEEDS_REVIEW' } });
    expect(
      (await json(await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/review-requests`))).reviewRequests.find((row: Json) => row.id === requestId),
    ).toMatchObject({ classification: 'NEEDS_REVIEW' });

    const draft = await draftFor(world, requestId);
    expect((await call(world.as('rv-1'), 'POST', itemPath(draft.id, draft.version, 'submit'), refBody(requestId))).status).toBe(200);
    expect((await approveCall(world, { requestId, id: draft.id, version: draft.version })).status).toBe(200);

    // 승인 뒤에도: 분류는 확인 필요 그대로, 계산은 보류 그대로.
    expect(world.repo.listTreatmentVersions(ADDED_1)[0]).toMatchObject({ calcClass: 'NEEDS_REVIEW' });
    const estimatesAfter = await Promise.all(selections.map((ids) => publicEstimate(world, ids)));
    expect(estimatesAfter).toEqual(estimatesBefore);
    expect(estimatesAfter[0]!.body.result.state).toBe('ON_HOLD');
    expect(world.repo.getItemState({ kind: 'MAPPING', id: draft.id, version: draft.version })!.state).toBe('APPROVED');
  });
});

describe('거절은 모두 의도한 상태 코드와 사유를 내고 500 이 되지 않으며 저장 상태가 그대로다', () => {
  async function expectRefusal(world: Setup, response: Response, status: number, body: Json, before: Record<string, unknown>): Promise<void> {
    expect(response.status).toBe(status);
    expect(await json(response)).toEqual(body);
    expect(world.state()).toEqual(before);
  }

  it('자기 승인 → 403 SELF_APPROVAL_FORBIDDEN', async () => {
    const world = setup();
    const flow = await submittedFor(world);
    const before = world.state();
    await expectRefusal(world, await approveCall(world, flow, 'rv-1'), 403, { error: 'FORBIDDEN', reason: 'SELF_APPROVAL_FORBIDDEN' }, before);
  });

  it('작성자가 아닌 RV 의 제출 → 403 NOT_ITEM_AUTHOR', async () => {
    const world = setup();
    const requestId = await requestFor(world);
    const draft = await draftFor(world, requestId);
    const before = world.state();
    await expectRefusal(world, await call(world.as(RV2), 'POST', itemPath(draft.id, draft.version, 'submit'), refBody(requestId)), 403, { error: 'FORBIDDEN', reason: 'NOT_ITEM_AUTHOR' }, before);
  });

  it('제출하기 전의 매핑 승인 · 반려, 이미 제출한 매핑의 재제출 → 409 TRANSITION_NOT_ALLOWED', async () => {
    const world = setup();
    const requestId = await requestFor(world);
    const draft = await draftFor(world, requestId);
    const before = world.state();
    const flow = { requestId, id: draft.id, version: draft.version };
    await expectRefusal(world, await approveCall(world, flow), 409, { error: 'CONFLICT', reason: 'TRANSITION_NOT_ALLOWED' }, before);
    await expectRefusal(world, await call(world.as(RV2), 'POST', itemPath(draft.id, draft.version, 'reject'), rejectBody(requestId)), 409, { error: 'CONFLICT', reason: 'TRANSITION_NOT_ALLOWED' }, before);
    expect((await call(world.as('rv-1'), 'POST', itemPath(draft.id, draft.version, 'submit'), refBody(requestId))).status).toBe(200);
    const afterSubmit = world.state();
    await expectRefusal(world, await call(world.as('rv-1'), 'POST', itemPath(draft.id, draft.version, 'submit'), refBody(requestId)), 409, { error: 'CONFLICT', reason: 'TRANSITION_NOT_ALLOWED' }, afterSubmit);
  });

  it('요청에 연결되지 않은 매핑(따로 만든 매핑 · 다른 요청의 매핑 · 틀린 버전) → 409 MAPPING_NOT_LINKED_TO_REQUEST', async () => {
    const world = setup();
    const first = await submittedFor(world, T1);
    const secondRequest = await requestFor(world, T2);
    // 요청 없이 따로 만든 매핑을 검토 제출까지 해 둔다.
    const loose = createDraft(world.world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseContent('MAPPING', 9, T2));
    submitForReview(world.world.deps, TEST_FIXTURE_RV_AUTHOR, loose.ref);
    const before = world.state();
    const linkageRefusal = { error: 'CONFLICT', reason: 'MAPPING_NOT_LINKED_TO_REQUEST' };
    // 따로 만든 매핑: 요청에 초안이 없는 경우 / 요청이 다른 초안을 가진 경우
    await expectRefusal(world, await call(world.as(RV2), 'POST', itemPath(loose.ref.id, loose.ref.version, 'approve'), refBody(secondRequest)), 409, linkageRefusal, before);
    await expectRefusal(world, await call(world.as(RV2), 'POST', itemPath(loose.ref.id, loose.ref.version, 'approve'), refBody(first.requestId)), 409, linkageRefusal, before);
    // 다른 요청의 매핑
    await expectRefusal(world, await approveCall(world, { requestId: secondRequest, id: first.id, version: first.version }), 409, linkageRefusal, before);
    await expectRefusal(world, await call(world.as(RV2), 'POST', itemPath(first.id, first.version, 'reject'), rejectBody(secondRequest)), 409, linkageRefusal, before);
    // 틀린 버전
    await expectRefusal(world, await approveCall(world, { requestId: first.requestId, id: first.id, version: '2' }), 409, linkageRefusal, before);
    // 없는 요청은 404
    await expectRefusal(world, await approveCall(world, { requestId: 'TEST_FIXTURE_NO_SUCH', id: first.id, version: first.version }), 404, { error: 'NOT_FOUND' }, before);
  });

  it('이미 닫힌 요청의 재처리 → 409 REVIEW_REQUEST_CLOSED, 닫힌 요청에 새 초안 → 409 REVIEW_REQUEST_CLOSED', async () => {
    const world = setup();
    const flow = await submittedFor(world);
    expect((await approveCall(world, flow)).status).toBe(200);
    const before = world.state();
    await expectRefusal(world, await approveCall(world, flow), 409, { error: 'CONFLICT', reason: 'REVIEW_REQUEST_CLOSED' }, before);
    await expectRefusal(world, await call(world.as(RV2), 'POST', itemPath(flow.id, flow.version, 'reject'), rejectBody(flow.requestId)), 409, { error: 'CONFLICT', reason: 'REVIEW_REQUEST_CLOSED' }, before);
    await expectRefusal(world, await call(world.as('rv-1'), 'POST', draftPath(flow.requestId), draftBody()), 409, { error: 'CONFLICT', reason: 'REVIEW_REQUEST_CLOSED' }, before);
  });

  it('한 요청에 초안은 하나: 두 번째 초안 → 409 MAPPING_DRAFT_ALREADY_EXISTS', async () => {
    const world = setup();
    const requestId = await requestFor(world);
    await draftFor(world, requestId);
    const before = world.state();
    await expectRefusal(world, await call(world.as('rv-1'), 'POST', draftPath(requestId), draftBody()), 409, { error: 'CONFLICT', reason: 'MAPPING_DRAFT_ALREADY_EXISTS' }, before);
  });

  it('요청의 치료와 다른 치료를 본문에 적으면 → 409 REF_CONTENT_MISMATCH', async () => {
    const world = setup();
    const requestId = await requestFor(world, T1);
    const before = world.state();
    await expectRefusal(world, await call(world.as('rv-1'), 'POST', draftPath(requestId), draftBody({ treatmentId: T2 })), 409, { error: 'CONFLICT', reason: 'REF_CONTENT_MISMATCH' }, before);
    // 같은 치료를 적으면 통과한다.
    expect((await call(world.as('rv-1'), 'POST', draftPath(requestId), draftBody({ treatmentId: T1 }))).status).toBe(200);
  });

  it('치료를 숨겨 게시한 뒤: 초안 작성 · 승인 → 409 TREATMENT_HIDDEN (반려는 된다)', async () => {
    const world = setup();
    const flow = await submittedFor(world, T2);
    const other = await requestFor(world, T3);
    await publishDraft(world, { deactivations: [T2, T3] });
    const before = world.state();
    await expectRefusal(world, await approveCall(world, flow), 409, { error: 'CONFLICT', reason: 'TREATMENT_HIDDEN' }, before);
    await expectRefusal(world, await call(world.as('rv-1'), 'POST', draftPath(other), draftBody()), 409, { error: 'CONFLICT', reason: 'TREATMENT_HIDDEN' }, before);
    // 대기열은 숨김을 "목록에 없음"과 구분해 낸다.
    const queue = (await json(await call(world.as('rv-1'), 'GET', QUEUE))).queue as Json[];
    expect(queue.find((row) => row.id === flow.requestId)).toMatchObject({ current: { state: 'HIDDEN' }, classification: 'UNKNOWN', basis: { check: 'UNCHECKABLE' }, approvalBlockedReason: 'TREATMENT_HIDDEN' });
    expect((await call(world.as(RV2), 'POST', itemPath(flow.id, flow.version, 'reject'), rejectBody(flow.requestId, 'TEST_FIXTURE 치료가 내려감'))).status).toBe(200);
  });

  it('현재 카탈로그에서 빠진 치료: 승인 → 409 TREATMENT_NOT_IN_CATALOG, 대기열은 NOT_IN_CATALOG', async () => {
    const world = setup();
    const flow = await submittedFor(world, T2);
    dropFromCatalog(world, T2);
    const before = world.state();
    await expectRefusal(world, await approveCall(world, flow), 409, { error: 'CONFLICT', reason: 'TREATMENT_NOT_IN_CATALOG' }, before);
    const queue = (await json(await call(world.as('rv-1'), 'GET', QUEUE))).queue as Json[];
    expect(queue.find((row) => row.id === flow.requestId)).toMatchObject({ current: { state: 'NOT_IN_CATALOG' }, approvalBlockedReason: 'TREATMENT_NOT_IN_CATALOG' });
  });

  it('현재 게시값을 읽지 못하면: 승인 · 초안 작성 → 409 CURRENT_VALUES_UNREADABLE (500 이 아니다), 대기열은 UNREADABLE 이고 "목록에 없음"으로 읽지 않는다', async () => {
    const world = setup();
    const flow = await submittedFor(world, T1);
    const other = await requestFor(world, T2);
    world.control.unreadable = true;
    const before = world.state();
    await expectRefusal(world, await approveCall(world, flow), 409, { error: 'CONFLICT', reason: 'CURRENT_VALUES_UNREADABLE' }, before);
    await expectRefusal(world, await call(world.as('rv-1'), 'POST', draftPath(other), draftBody()), 409, { error: 'CONFLICT', reason: 'CURRENT_VALUES_UNREADABLE' }, before);
    const queueResponse = await call(world.as('rv-1'), 'GET', QUEUE);
    expect(queueResponse.status).toBe(200);
    const queue = (await json(queueResponse)).queue as Json[];
    for (const row of queue) {
      expect(row.current).toEqual({ state: 'UNREADABLE', defectCode: 'TREATMENT_VERSION_MISSING' });
      expect(row.classification).toBe('UNKNOWN');
    }
    expect(queue.find((row) => row.id === flow.requestId)).toMatchObject({ basis: { check: 'UNCHECKABLE' }, approvalBlockedReason: 'CURRENT_VALUES_UNREADABLE' });
    // 병원 관리자 목록도 던지지 않고 UNKNOWN 으로 낸다.
    const ha = await call(world.as('ha-clinic-1'), 'GET', `${CLINIC}/review-requests`);
    expect(ha.status).toBe(200);
    expect(((await json(ha)).reviewRequests as Json[]).every((row) => row.classification === 'UNKNOWN')).toBe(true);
    world.control.unreadable = false;
  });

  it('검토 기준이 없는 초안(옛 서비스로 만든 것): 승인 → 409 REVIEW_BASIS_MISSING, 반려는 된다', async () => {
    const world = setup();
    const requestId = await requestFor(world);
    const legacy = createMappingDraftFromRequest(world.world.deps, TEST_FIXTURE_RV_AUTHOR, requestId, baseContent('MAPPING', 7, T1));
    submitForReview(world.world.deps, TEST_FIXTURE_RV_AUTHOR, legacy.ref);
    const before = world.state();
    await expectRefusal(world, await approveCall(world, { requestId, id: legacy.ref.id, version: legacy.ref.version }), 409, { error: 'CONFLICT', reason: 'REVIEW_BASIS_MISSING' }, before);
    const queue = (await json(await call(world.as('rv-1'), 'GET', QUEUE))).queue as Json[];
    expect(queue.find((row) => row.id === requestId)).toMatchObject({ basis: { check: 'MISSING' }, approvalBlockedReason: 'REVIEW_BASIS_MISSING' });
    expect((await call(world.as(RV2), 'POST', itemPath(legacy.ref.id, legacy.ref.version, 'reject'), rejectBody(requestId))).status).toBe(200);
  });

  it('검토 뒤 보장 판단 필드가 바뀌면 승인 → 409 REVIEWED_FIELDS_CHANGED, 대기열은 CHANGED + 바뀐 필드. 가격만 바뀌면 승인된다', async () => {
    const world = setup();
    const flow = await submittedFor(world, T1);
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1_NEXT', treatmentId: T1, calcClass: 'NEEDS_REVIEW' }));
    const before = world.state();
    await expectRefusal(world, await approveCall(world, flow), 409, { error: 'CONFLICT', reason: 'REVIEWED_FIELDS_CHANGED' }, before);
    const queue = (await json(await call(world.as('rv-1'), 'GET', QUEUE))).queue as Json[];
    expect(queue.find((row) => row.id === flow.requestId)).toMatchObject({
      basis: { check: 'CHANGED', changedFields: ['calcClass'], reviewed: { calcClass: 'GENERAL_BENEFIT' } },
      approvalBlockedReason: 'REVIEWED_FIELDS_CHANGED',
      classification: 'NEEDS_REVIEW',
    });

    const priceOnly = setup();
    const ok = await submittedFor(priceOnly, T1);
    adoptTreatmentVersion(priceOnly.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1_PRICE', treatmentId: T1, patientAmount: 88_000 }));
    expect((await approveCall(priceOnly, ok)).status).toBe(200);
  });

  it('다른 병원의 요청도 플랫폼 RV 는 처리할 수 있다 (두 병원을 함께 본다). 병원 2 의 요청을 병원 1 의 매핑으로 처리하는 것은 연결 확인이 막는다', async () => {
    const world = setup();
    const flow = await submittedFor(world, T1);
    const theirs = (await json(await call(world.as('ha-clinic-2'), 'POST', `clinics/${OTHER_CLINIC_ID}/treatments/${OTHER_CLINIC_TREATMENT_ID}/review-requests`, { proposed: PROPOSAL }))).reviewRequest.id as string;
    const before = world.state();
    await expectRefusal(world, await approveCall(world, { requestId: theirs, id: flow.id, version: flow.version }), 409, { error: 'CONFLICT', reason: 'MAPPING_NOT_LINKED_TO_REQUEST' }, before);
    const draft = await draftFor(world, theirs);
    expect(draft.entry.clinic.id).toBe(OTHER_CLINIC_ID);
  });

  it('오류 응답은 스택 · 다른 병원 자료 · 내부 id 를 싣지 않는다', async () => {
    const world = setup();
    const flow = await submittedFor(world);
    const response = await approveCall(world, flow, 'rv-1');
    const text = JSON.stringify(await json(response));
    expect(text).not.toMatch(/stack|TEST_FIXTURE_MAPPING|TEST_FIXTURE_TV_|at .*\(/);
  });
});

describe('경로 표', () => {
  const source = readFileSync(fileURLToPath(new URL('../../src/server/admin/router.ts', import.meta.url)), 'utf8');

  it('플랫폼 경로 표(병원 경로 표와 따로 둔다): 매핑 검토 RV 다섯 경로는 그대로이고, 묶음 구성 RV 셋 · 범위 지정 PO 둘이 경로마다 정해진 역할로 더해졌다', () => {
    const routes = [...source.matchAll(/\{ method: '([A-Z]+)', role: '([A-Z]+)', segments: \[([^\]]*)\], handler: (\w+) \}/g)].map((match) => `${match[2]} ${match[1]} ${match[3]!.replaceAll("'", '').replaceAll(' ', '')}`);
    expect(routes).toEqual([
      'RV GET review-history',
      'RV POST review-requests,:reviewRequestId,mappings',
      'RV POST mappings,:mappingId,versions,:version,submit',
      'RV POST mappings,:mappingId,versions,:version,approve',
      'RV POST mappings,:mappingId,versions,:version,reject',
      'RV GET bundle-publish',
      'RV POST bundle-publish,preview',
      'RV POST bundle-publish',
      'PO GET rule-scope',
      'PO POST rule-scope,clinics,:clinicId',
    ]);
  });

  it('게시(PUBLISHED) · 규칙 묶음 · 분류 전환으로 이어지는 경로는 없다', () => {
    expect(source).not.toMatch(/'publish'.*mappings|mappings.*'publish'|rule-bundles|classification'\]/);
  });
});

describe('운영 구성: 인증 공급자가 연결되기 전에는 새 경로도 모두 401 이다', () => {
  it('운영 관리자 서비스는 시험 쿠키 · 역할 헤더를 위조해도 인증하지 않는다 (저장 상태 불변)', async () => {
    const { world } = buildWorld();
    const api = createOperatingServices({ repo: world.repo, log: silentLog, today: () => TEST_TODAY });
    const admin = createOperatingAdminServices({ api, clock: new FixedClock(), ids: new CounterIdGenerator() });
    const before = world.repo.exportState();
    const forged = { cookie: 'bodam_test_session=TEST_FIXTURE_SESSION_1_rv-1', 'x-role': 'RV' };
    const attempts: Array<[string, string, unknown]> = [
      ['GET', HISTORY, undefined],
      ['POST', draftPath('R1'), draftBody()],
      ['POST', itemPath('M1', '1', 'submit'), refBody('R1')],
      ['POST', itemPath('M1', '1', 'approve'), refBody('R1')],
      ['POST', itemPath('M1', '1', 'reject'), rejectBody('R1')],
      // 경로 · 메서드가 틀려도 인증이 먼저다.
      ['DELETE', HISTORY, undefined],
      ['GET', itemPath('M1', '1', 'approve'), undefined],
      ['POST', 'mappings/M1/versions/1/publish', {}],
    ];
    for (const [method, path, body] of attempts) {
      const response = await call(admin, method, path, body, forged);
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await json(response)).toEqual({ error: 'UNAUTHENTICATED' });
    }
    expect(world.repo.exportState()).toEqual(before);
  });
});
