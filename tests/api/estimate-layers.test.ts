import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import * as estimateRoute from '../../src/app/api/clinics/[slug]/estimate/route';
import { optionCards } from '../../src/server/api/options-cards';
import type { CommonBaseFee, TreatmentVersion } from '../../src/server/domain/entities';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { CLINIC_1_SLUG, publishBundleAndAssign, publishSecondClinicCatalog, suspendBundle, useTestServices } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, T1, T2, makeBaseFeeVersion, publishFeeCatalog } from '../fixtures/server/base-fee.fixture';
import { makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { buildWorld, requestBody, specOf } from '../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../fixtures/server/estimate-world.fixture';
import { adoptTreatmentVersion } from '../fixtures/server/lifecycle.fixture';
import { validCatalogRequest } from '../fixtures/server/publish.fixture';
import { OTHER_CLINIC_TREATMENT_ID, publishCatalogOf } from '../fixtures/server/versioning.fixture';
import { estimateBody, expectNoStoreJson, expectOnlySlugLookup, expectRejection, nonZeroReads, serve } from './estimate-helpers';
import { callPost, callPostRaw, callPostWithJson } from './post-helpers';

// 계산 요청 POST /api/clinics/{slug}/estimate 의 요청 검증의 층 (design.md DD-19 "요청 검증의 층", DD-14 처리 순서).
//   AC-006f (층 구분: 400 대 422), AC-021a (공개 오류 표 전체), AC-021h~m (거절 조건이 겹칠 때의 순서),
//   AC-020a (409 본문), AC-019b (다른 병원·미게시 치료 ID), AC-021e (모든 응답이 no-store).
// 모든 시험은 실제 route.ts 의 POST 를 부른다. 시험 자료는 전부 TEST_FIXTURE 이고 시험 구성을 통해서만 들어온다.

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

const post = (slug: string, body: unknown) => callPost(POST, slug, body);

beforeEach(() => {
  useTestServices(null);
});

/** 병원 1 에 카탈로그와 규칙 묶음이 있는 기본 세계 + 시험 구성. */
function ready(): EstimateWorld {
  const w = buildWorld();
  serve(w);
  return w;
}

/** 병원 1 의 카탈로그를 새로 게시한다 (버전이 바뀐다). 치료 버전과 기본비용을 고른다. */
function republish(w: EstimateWorld, treatmentVersions: TreatmentVersion[], commonBaseFees: CommonBaseFee[] = [makeBaseFeeVersion(1)]) {
  return publishCatalogOf(w.world, { treatmentVersions, commonBaseFees });
}

const [TV1, TV2] = validCatalogRequest().treatmentVersions as [TreatmentVersion, TreatmentVersion];

describe('라우트 모양', () => {
  it('estimate 라우트는 POST 하나만 내보낸다', () => {
    expect(Object.keys(estimateRoute)).toEqual(['POST']);
  });
});

describe('AC-006f · AC-021a 층 0: 병원 확인', () => {
  it('없는 slug 는 404 CLINIC_NOT_FOUND 이고 no-store 다', async () => {
    const w = ready();
    expectRejection(await post('nope', requestBody(w)), 404, 'CLINIC_NOT_FOUND');
  });

  it('병원 확인이 요청 구조보다 앞선다: 없는 slug 에는 본문을 읽지도 않는다', async () => {
    ready();
    const json = vi.fn(() => Promise.resolve({ not: 'read' }));
    expectRejection(await callPostWithJson(POST, 'nope', json), 404, 'CLINIC_NOT_FOUND');
    expect(json).not.toHaveBeenCalled();
  });

  it.each([['대소문자가 다르다', 'Test-Fixture-Clinic-1'], ['끝에 공백', 'test-fixture-clinic-1 '], ['병원 id', TEST_FIXTURE_CLINIC_ID]])('slug 는 정확히 같아야 한다: %s -> 404', async (_label, slug) => {
    const w = ready();
    expectRejection(await post(slug, requestBody(w)), 404, 'CLINIC_NOT_FOUND');
  });
});

describe('AC-006f · AC-021a 층 1: 요청 구조 (400 INVALID_REQUEST)', () => {
  it.each([
    ['JSON 형식이 깨진 본문', '{not json'],
    ['빈 본문', ''],
    ['JSON null', 'null'],
    ['JSON 배열', '[]'],
    ['JSON 숫자', '5'],
    ['JSON 문자열', '"text"'],
    ['JSON 불리언', 'true'],
  ])('본문이 객체가 아니다: %s -> 400', async (_label, raw) => {
    ready();
    expectRejection(await callPostRaw(POST, CLINIC_1_SLUG, raw), 400, 'INVALID_REQUEST');
  });

  it('본문이 아예 없어도 400 이다', async () => {
    ready();
    expectRejection(await callPostRaw(POST, CLINIC_1_SLUG, null), 400, 'INVALID_REQUEST');
  });

  it.each(['catalogVersion', 'ruleBundleVersion', 'generation', 'insurerType', 'cause', 'treatmentIds'])('필수 필드 %s 가 없으면 400 이다', async (field) => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { [field]: undefined })), 400, 'INVALID_REQUEST');
  });

  it('ruleBundleVersion 은 null 이 허용된다 (키가 없을 때만 누락): 규칙 사용 범위가 없는 병원은 null 로 요청해 200 을 받는다', async () => {
    const w = buildWorld({ spec: null });
    serve(w);
    const result = await post(CLINIC_1_SLUG, requestBody(w));
    expect(result.status).toBe(200);
    expect(estimateBody(result).versions.ruleBundleVersion).toBeNull();
  });

  it.each([
    ['catalogVersion 이 숫자', { catalogVersion: 5 }],
    ['catalogVersion 이 null', { catalogVersion: null }],
    ['catalogVersion 이 배열', { catalogVersion: ['x'] }],
    ['catalogVersion 이 객체', { catalogVersion: {} }],
    ['ruleBundleVersion 이 숫자', { ruleBundleVersion: 5 }],
    ['ruleBundleVersion 이 불리언', { ruleBundleVersion: true }],
    ['ruleBundleVersion 이 객체', { ruleBundleVersion: {} }],
    ['ruleBundleVersion 이 배열', { ruleBundleVersion: ['x'] }],
    ['generation 이 숫자', { generation: 5 }],
    ['generation 이 null', { generation: null }],
    ['generation 이 배열', { generation: ['GEN4_C4'] }],
    ['insurerType 이 숫자', { insurerType: 5 }],
    ['insurerType 이 null', { insurerType: null }],
    ['cause 가 숫자', { cause: 5 }],
    ['cause 가 null', { cause: null }],
    ['treatmentIds 가 문자열', { treatmentIds: 'TEST_FIXTURE_TREATMENT_1' }],
    ['treatmentIds 가 null', { treatmentIds: null }],
    ['treatmentIds 가 객체', { treatmentIds: {} }],
    ['treatmentIds 가 숫자', { treatmentIds: 5 }],
    ['treatmentIds 에 숫자 요소', { treatmentIds: [T1, 2] }],
    ['treatmentIds 에 null 요소', { treatmentIds: [null] }],
    ['treatmentIds 에 배열 요소', { treatmentIds: [[T1]] }],
    ['treatmentIds 에 객체 요소', { treatmentIds: [{ id: T1 }] }],
  ])('JSON 형식이 틀리면 400 이다: %s', async (_label, patch) => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, patch)), 400, 'INVALID_REQUEST');
  });

  it.each([
    ['insurerType 이 열거 밖', { insurerType: 'XXX' }],
    ['insurerType 의 대소문자가 다르다', { insurerType: 'non_life' }],
    ['insurerType 에 공백', { insurerType: 'NON_LIFE ' }],
    ['insurerType 이 빈 문자열', { insurerType: '' }],
    ['cause 가 열거 밖', { cause: 'XXX' }],
    ['cause 의 대소문자가 다르다', { cause: 'injury' }],
    ['cause 에 공백', { cause: 'UNKNOWN ' }],
    ['cause 가 빈 문자열', { cause: '' }],
  ])('열거값 밖의 문자열은 400 이다 (422 가 아니다): %s', async (_label, patch) => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, patch)), 400, 'INVALID_REQUEST');
  });
});

describe('AC-006f · AC-021a 층 2: 지원 세대와 빈 치료 (422)', () => {
  it.each([['5세대', 'GEN5_C5'], ['빈 문자열', ''], ['소문자', 'gen4_c4'], ['끝에 공백', 'GEN4_C4 '], ['보험 용어', 'C4']])('generation 이 문자열이지만 다섯 값 밖이면 422 UNSUPPORTED_GENERATION 이다 (400 이 아니다): %s', async (_label, generation) => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { generation })), 422, 'UNSUPPORTED_GENERATION');
  });

  it('treatmentIds 가 빈 배열이면 422 NO_TREATMENT_SELECTED 다', async () => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: [] })), 422, 'NO_TREATMENT_SELECTED');
  });

  it('두 코드가 겹치면 UNSUPPORTED_GENERATION 이 먼저다 (DD-03 순서)', async () => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { generation: 'GEN5_C5', treatmentIds: [] })), 422, 'UNSUPPORTED_GENERATION');
  });

  it.each(['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4'])('다섯 세대 값 %s 는 층 2 를 통과해 200 이다', async (generation) => {
    const w = ready();
    expect((await post(CLINIC_1_SLUG, requestBody(w, { generation }))).status).toBe(200);
  });

  it.each(optionCards().insurerTypes.map((card) => card.code))('options 카드의 보험사 형태 %s 와 원인 카드의 세 코드는 모두 층 1 을 통과한다 (열거값이 카드와 같다)', async (insurerType) => {
    const w = ready();
    for (const cause of optionCards().causes.map((card) => card.code)) {
      expect((await post(CLINIC_1_SLUG, requestBody(w, { insurerType, cause }))).status, `${insurerType}/${cause}`).toBe(200);
    }
  });
});

describe('AC-021h 겹침 (a): 열거 밖의 cause + 옛 버전 -> 400 (층 1 이 층 3 보다 앞선다)', () => {
  const staleCatalog = { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD' };
  const staleBundle = { ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_OLD' };

  it.each([['옛 catalogVersion', staleCatalog], ['옛 ruleBundleVersion', staleBundle], ['둘 다 옛 값', { ...staleCatalog, ...staleBundle }]])('%s: 400 INVALID_REQUEST 이고 409 가 아니며 latest·changes 가 없다', async (_label, stale) => {
    const w = ready();
    w.world.repo.spy.reset();
    const result = await post(CLINIC_1_SLUG, requestBody(w, { ...stale, cause: 'NOT_A_CAUSE' }));
    expectRejection(result, 400, 'INVALID_REQUEST');
    expect(result.text).not.toContain('latest');
    expect(result.text).not.toContain('changes');
    expectOnlySlugLookup(w.world.repo);
  });

  it('generation 이 열거 밖이어도 cause 도 열거 밖이면 422 가 아니라 400 이다 (층 1 이 층 2 보다 앞선다)', async () => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { generation: 'GEN5_C5', cause: 'NOT_A_CAUSE' })), 400, 'INVALID_REQUEST');
  });

  it('treatmentIds 가 빈 배열이어도 insurerType 이 열거 밖이면 400 이다', async () => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: [], insurerType: 'NOT_A_TYPE' })), 400, 'INVALID_REQUEST');
  });
});

describe('AC-021i 겹침 (b): 지원 밖 세대 + 옛 버전 -> 422 UNSUPPORTED_GENERATION (층 2 가 층 3 보다 앞선다)', () => {
  it.each([['옛 catalogVersion', { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD' }], ['옛 ruleBundleVersion', { ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_OLD' }]])('%s: 422 이고 409 가 아니며 층 3 의 읽기가 일어나지 않는다', async (_label, stale) => {
    const w = ready();
    w.world.repo.spy.reset();
    const result = await post(CLINIC_1_SLUG, requestBody(w, { ...stale, generation: 'GEN5_C5' }));
    expectRejection(result, 422, 'UNSUPPORTED_GENERATION');
    expect(result.text).not.toContain('latest');
    expectOnlySlugLookup(w.world.repo);
  });
});

describe('AC-021j 겹침 (c): 빈 treatmentIds + 옛 버전 -> 422 NO_TREATMENT_SELECTED (층 2 가 층 3 보다 앞선다)', () => {
  it.each([['옛 catalogVersion', { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD' }], ['옛 ruleBundleVersion', { ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_OLD' }]])('%s: 422 이고 409 가 아니며 층 3 의 읽기가 일어나지 않는다', async (_label, stale) => {
    const w = ready();
    w.world.repo.spy.reset();
    const result = await post(CLINIC_1_SLUG, requestBody(w, { ...stale, treatmentIds: [] }));
    expectRejection(result, 422, 'NO_TREATMENT_SELECTED');
    expect(result.text).not.toContain('latest');
    expectOnlySlugLookup(w.world.repo);
  });

  it('generation 도 열거 밖이면 UNSUPPORTED_GENERATION 이 먼저다', async () => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD', generation: 'GEN5_C5', treatmentIds: [] })), 422, 'UNSUPPORTED_GENERATION');
  });
});

describe('AC-020a 409 VERSION_MISMATCH 본문 (DD-14)', () => {
  it('옛 catalogVersion: 본문은 DD-14 형식이고 결과가 없다', async () => {
    const w = ready();
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD' }));
    expect(result.status).toBe(409);
    expectNoStoreJson(result);
    expect(result.body).toEqual({
      error: 'VERSION_MISMATCH',
      latest: { catalogVersion: w.catalog.id, ruleBundleVersion: w.bundle!.id, ruleBundleStatus: 'ACTIVE' },
      // [문서에 없음] 서버가 모르는 catalogVersion 은 가격이 같다고 보일 수 없어 priceChanged 가 true 다.
      changes: { priceChanged: true, ruleChanged: false, treatmentsUnpublished: [] },
    });
    for (const absent of ['result', 'versions', 'documents', 'amounts']) {
      expect(result.text).not.toContain(absent);
    }
  });

  it('가격만 바뀐 새 카탈로그: priceChanged true, ruleChanged false, 내려간 치료 없음 (계속 409)', async () => {
    const w = ready();
    const old = w.catalog;
    const next = republish(w, [{ ...TV1, id: 'TEST_FIXTURE_TV_1_NEW_PRICE', patientAmount: 12_000 }, TV2]);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: old.id }));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: 'VERSION_MISMATCH',
      latest: { catalogVersion: next.id, ruleBundleVersion: w.bundle!.id, ruleBundleStatus: 'ACTIVE' },
      changes: { priceChanged: true, ruleChanged: false, treatmentsUnpublished: [] },
    });
  });

  it('가격이 그대로인 새 카탈로그(치료를 내린 게시): priceChanged false, 내려간 치료가 담긴다', async () => {
    const w = ready();
    const old = w.catalog;
    const next = republish(w, [TV1]);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: old.id }));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: 'VERSION_MISMATCH',
      latest: { catalogVersion: next.id, ruleBundleVersion: w.bundle!.id, ruleBundleStatus: 'ACTIVE' },
      changes: { priceChanged: false, ruleChanged: false, treatmentsUnpublished: [T2] },
    });
  });

  it('공통 기본비용 가격만 바뀐 새 카탈로그도 priceChanged true 다', async () => {
    const w = ready();
    const old = w.catalog;
    publishFeeCatalog(w.world, [makeBaseFeeVersion(2, { amount: 7_000 })]);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: old.id }));
    expect(result.status).toBe(409);
    expect((result.body as { changes: { priceChanged: boolean } }).changes.priceChanged).toBe(true);
  });

  it('치료를 더하기만 한 새 카탈로그(옛 카탈로그에 없던 치료)는 priceChanged false 다', async () => {
    const w = buildWorld({ treatments: [TV1], spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }, { target: BASE_FEE_ID, kind: 'COVERED' }] }) });
    serve(w);
    const old = w.catalog;
    const next = republish(w, [TV1, TV2]);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: old.id }));
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ latest: { catalogVersion: next.id }, changes: { priceChanged: false, ruleChanged: false, treatmentsUnpublished: [] } });
  });

  it('공통 기본비용을 새로 등록한 카탈로그(옛 카탈로그에 기본비용이 없었다)도 priceChanged false 다', async () => {
    const w = buildWorld({ fees: [], spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }, { target: T2, kind: 'COVERED' }] }) });
    serve(w);
    const old = w.catalog;
    publishFeeCatalog(w.world, [makeBaseFeeVersion(1)]);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: old.id }));
    expect(result.status).toBe(409);
    expect((result.body as { changes: unknown }).changes).toEqual({ priceChanged: false, ruleChanged: false, treatmentsUnpublished: [] });
  });

  it('다른 병원의 catalogVersion 은 모르는 값처럼 다룬다 (priceChanged true, 다른 병원의 자료를 읽어 비교하지 않는다)', async () => {
    const w = ready();
    const second = publishSecondClinicCatalog(w.world);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: second.id }));
    expect(result.status).toBe(409);
    expect((result.body as { changes: { priceChanged: boolean } }).changes.priceChanged).toBe(true);
    expect(result.text).not.toContain(second.id);
  });

  it('옛 ruleBundleVersion: ruleChanged true, priceChanged false, latest 는 새 묶음과 그 가용성이다', async () => {
    const w = ready();
    const old = w.bundle!;
    const next = publishBundleAndAssign(w.world, 2);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { ruleBundleVersion: old.id }));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: 'VERSION_MISMATCH',
      latest: { catalogVersion: w.catalog.id, ruleBundleVersion: next.id, ruleBundleStatus: 'ACTIVE' },
      changes: { priceChanged: false, ruleChanged: true, treatmentsUnpublished: [] },
    });
  });

  it('두 버전이 모두 옛 값이면 두 변경이 모두 true 다', async () => {
    const w = ready();
    const old = { catalog: w.catalog, bundle: w.bundle! };
    republish(w, [{ ...TV1, id: 'TEST_FIXTURE_TV_1_NEW_PRICE', patientAmount: 12_000 }, TV2]);
    publishBundleAndAssign(w.world, 2);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: old.catalog.id, ruleBundleVersion: old.bundle.id }));
    expect(result.status).toBe(409);
    expect((result.body as { changes: unknown }).changes).toEqual({ priceChanged: true, ruleChanged: true, treatmentsUnpublished: [] });
  });

  it('규칙 사용 범위가 있는 병원에 null 을 담으면 409 이고 ruleChanged true 다', async () => {
    const w = ready();
    const result = await post(CLINIC_1_SLUG, requestBody(w, { ruleBundleVersion: null }));
    expect(result.status).toBe(409);
    expect((result.body as { changes: unknown }).changes).toEqual({ priceChanged: false, ruleChanged: true, treatmentsUnpublished: [] });
  });

  it('규칙 사용 범위가 없는 병원에 묶음 id 를 담으면 409 이고 latest 의 묶음 둘이 null 이다', async () => {
    const w = buildWorld({ spec: null });
    serve(w);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_OLD' }));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: 'VERSION_MISMATCH',
      latest: { catalogVersion: w.catalog.id, ruleBundleVersion: null, ruleBundleStatus: null },
      changes: { priceChanged: false, ruleChanged: true, treatmentsUnpublished: [] },
    });
  });

  it('묶음이 중지된 병원의 409 는 latest.ruleBundleStatus 가 SUSPENDED 다', async () => {
    const w = ready();
    suspendBundle(w.world, w.bundle!.id);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD' }));
    expect(result.status).toBe(409);
    expect((result.body as { latest: { ruleBundleStatus: string } }).latest.ruleBundleStatus).toBe('SUSPENDED');
  });

  it('카탈로그를 게시한 적 없는 병원에는 어떤 catalogVersion 이든 409 이고 latest.catalogVersion 은 null 이다 [문서에 없음]', async () => {
    const w = buildWorld({ spec: null });
    w.world.repo.saveClinic({ ...w.world.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, currentCatalogVersionId: null });
    serve(w);
    const result = await post(CLINIC_1_SLUG, requestBody(w));
    expect(result.status).toBe(409);
    expect((result.body as { latest: { catalogVersion: string | null } }).latest.catalogVersion).toBeNull();
  });

  it('409 경로가 읽는 것: 병원 확인, 규칙 범위, 묶음 가용성, 카탈로그뿐이다 (묶음 내용·항목 상태는 읽지 않는다)', async () => {
    const w = ready();
    w.world.repo.spy.reset();
    await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD' }));
    const reads = nonZeroReads(w.world.repo);
    expect(Object.keys(reads).sort()).toEqual(
      ['getBundleStatus', 'getCatalogVersion', 'getClinicCurrentCatalogVersion', 'getClinicRuleScope', 'getCommonBaseFee', 'getTreatment', 'getTreatmentVersion', 'listClinics'].sort(),
    );
    expect(reads.listClinics).toBe(1);
    expect(reads.getClinicRuleScope).toBe(1);
    expect(reads.getBundleStatus).toBe(1);
    for (const itemRead of ['readItemStates', 'getItemVersion', 'getRuleBundleVersion', 'getItemState']) {
      expect(reads[itemRead], itemRead).toBeUndefined();
    }
  });
});

describe('AC-021k 겹침 (d): 옛 catalogVersion + 그 사이 내려간 치료 -> 409 (3층이 4층보다 앞선다)', () => {
  it('카탈로그 v1(T1·T2)에서 T2 를 내려 v2 를 게시했다: v1 과 [T1, T2] 는 422 가 아니라 409 이고 treatmentsUnpublished = [T2]', async () => {
    const w = ready();
    const v1 = w.catalog;
    const v2 = republish(w, [TV1]);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: v1.id, treatmentIds: [T1, T2] }));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: 'VERSION_MISMATCH',
      latest: { catalogVersion: v2.id, ruleBundleVersion: w.bundle!.id, ruleBundleStatus: 'ACTIVE' },
      changes: { priceChanged: false, ruleChanged: false, treatmentsUnpublished: [T2] },
    });
  });

  it('병원 2 의 치료 id Z 를 더하면 treatmentsUnpublished = [T2, Z] (요청에 적힌 순서)', async () => {
    const w = ready();
    const v1 = w.catalog;
    republish(w, [TV1]);
    publishSecondClinicCatalog(w.world);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: v1.id, treatmentIds: [T1, T2, OTHER_CLINIC_TREATMENT_ID] }));
    expect(result.status).toBe(409);
    expect((result.body as { changes: { treatmentsUnpublished: string[] } }).changes.treatmentsUnpublished).toEqual([T2, OTHER_CLINIC_TREATMENT_ID]);
  });

  it('요청에 적힌 순서를 따르고 중복은 한 번만 담긴다', async () => {
    const w = ready();
    const v1 = w.catalog;
    republish(w, [TV1]);
    publishSecondClinicCatalog(w.world);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: v1.id, treatmentIds: [OTHER_CLINIC_TREATMENT_ID, T1, T2, T2, OTHER_CLINIC_TREATMENT_ID] }));
    expect((result.body as { changes: { treatmentsUnpublished: string[] } }).changes.treatmentsUnpublished).toEqual([OTHER_CLINIC_TREATMENT_ID, T2]);
  });

  it('요청의 id 가 모두 v2 에서도 게시 중이면 treatmentsUnpublished 는 빈 배열이고 여전히 409 다', async () => {
    const w = ready();
    const v1 = w.catalog;
    republish(w, [TV1]);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: v1.id, treatmentIds: [T1] }));
    expect(result.status).toBe(409);
    expect((result.body as { changes: { treatmentsUnpublished: string[] } }).changes.treatmentsUnpublished).toEqual([]);
  });

  it('비활성이 된 치료도 현재 카탈로그에 없는 것으로 담긴다', async () => {
    const w = ready();
    w.world.repo.saveTreatment(makeTreatment({ id: T1, active: false }));
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD', treatmentIds: [T1, T2] }));
    expect((result.body as { changes: { treatmentsUnpublished: string[] } }).changes.treatmentsUnpublished).toEqual([T1]);
  });
});

describe('AC-019b · AC-021l 겹침 (e): 최신 버전 + 미게시 치료 ID 또는 다른 병원의 치료 ID -> 422 TREATMENT_NOT_PUBLISHED (4층)', () => {
  it('병원 1 의 비활성 치료 ID -> 422', async () => {
    const w = ready();
    w.world.repo.saveTreatment(makeTreatment({ id: T1, active: false }));
    const result = await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: [T1, T2] }));
    expectRejection(result, 422, 'TREATMENT_NOT_PUBLISHED');
  });

  it('병원 1 에 속하지만 현재 카탈로그에 든 적 없는 치료 ID -> 422', async () => {
    const w = ready();
    w.world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_3', sortOrder: 3 }));
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: [T1, 'TEST_FIXTURE_TREATMENT_3'] })), 422, 'TREATMENT_NOT_PUBLISHED');
  });

  it('카탈로그에서 내려간 치료 ID(최신 버전으로 요청) -> 422', async () => {
    const w = ready();
    const v2 = republish(w, [TV1]);
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: v2.id, treatmentIds: [T1, T2] })), 422, 'TREATMENT_NOT_PUBLISHED');
  });

  it('병원 2 의 치료 ID -> 422 이고 응답에 병원 2 의 치료 이름·가격이 없다', async () => {
    const w = ready();
    publishSecondClinicCatalog(w.world);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: [T1, OTHER_CLINIC_TREATMENT_ID] }));
    expectRejection(result, 422, 'TREATMENT_NOT_PUBLISHED');
    for (const leaked of ['병원2', '33000', OTHER_CLINIC_TREATMENT_ID]) {
      expect(result.text).not.toContain(leaked);
    }
  });

  it('어느 병원에도 없는 ID -> 422', async () => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: ['NO_SUCH_TREATMENT'] })), 422, 'TREATMENT_NOT_PUBLISHED');
  });

  it('공통 기본비용의 안정 식별자는 치료 ID 로 고를 수 없다 -> 422', async () => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: [T1, BASE_FEE_ID] })), 422, 'TREATMENT_NOT_PUBLISHED');
  });

  it('하나만 섞여 있어도 요청 전체가 422 다 (게시 중인 치료가 함께 있어도)', async () => {
    const w = ready();
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: [T1, T2, 'NO_SUCH_TREATMENT'] })), 422, 'TREATMENT_NOT_PUBLISHED');
  });

  it('같은 요청에서 두 버전 가운데 하나만 옛 값으로 바꾸면 409 로 바뀐다 (3층이 4층보다 앞선다)', async () => {
    const w = ready();
    const bad = { treatmentIds: [T1, 'NO_SUCH_TREATMENT'] };
    expect((await post(CLINIC_1_SLUG, requestBody(w, { ...bad, catalogVersion: 'TEST_FIXTURE_CATALOG_OLD' }))).status).toBe(409);
    expect((await post(CLINIC_1_SLUG, requestBody(w, { ...bad, ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_OLD' }))).status).toBe(409);
    expect((await post(CLINIC_1_SLUG, requestBody(w, bad))).status).toBe(422);
  });

  it('422 경로는 항목 상태·묶음 내용을 읽지 않는다', async () => {
    const w = ready();
    w.world.repo.spy.reset();
    await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: ['NO_SUCH_TREATMENT'] }));
    const reads = nonZeroReads(w.world.repo);
    for (const itemRead of ['readItemStates', 'getItemVersion', 'getRuleBundleVersion', 'getItemState']) {
      expect(reads[itemRead], itemRead).toBeUndefined();
    }
  });
});

describe('AC-021m 겹침 (f): 최신 버전 + 중지된 묶음 -> 200 ON_HOLD (409 도 4xx 도 아니다)', () => {
  it('버전이 같고 묶음이 중지되면 200 ON_HOLD, 모든 줄 RULE_BUNDLE_SUSPENDED, hospitalPayment 는 숫자, 보험금 둘과 documents 는 null', async () => {
    const w = ready();
    suspendBundle(w.world, w.bundle!.id);
    const result = await post(CLINIC_1_SLUG, requestBody(w));
    expect(result.status).toBe(200);
    expectNoStoreJson(result);
    const body = estimateBody(result);
    expect(body.versions).toEqual({ catalogVersion: w.catalog.id, ruleBundleVersion: w.bundle!.id, ruleBundleStatus: 'SUSPENDED', profile: null });
    expect(body.result.state).toBe('ON_HOLD');
    expect(body.result.lines.map((line) => [line.treatmentId, line.state, line.holdReason])).toEqual([
      [BASE_FEE_ID, 'ON_HOLD', 'RULE_BUNDLE_SUSPENDED'],
      [T1, 'ON_HOLD', 'RULE_BUNDLE_SUSPENDED'],
      [T2, 'ON_HOLD', 'RULE_BUNDLE_SUSPENDED'],
    ]);
    expect(body.result.amounts).toEqual({ hospitalPayment: 25_000, baseFeeIncluded: 'INCLUDED', expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null });
    expect(body.documents).toBeNull();
  });

  it('같은 상태에서 미게시 치료 ID 를 더하면 422 다 (4층이 계산보다 앞서므로 보류 결과가 아니다)', async () => {
    const w = ready();
    suspendBundle(w.world, w.bundle!.id);
    expectRejection(await post(CLINIC_1_SLUG, requestBody(w, { treatmentIds: [T1, 'NO_SUCH_TREATMENT'] })), 422, 'TREATMENT_NOT_PUBLISHED');
  });

  it('같은 상태에서 옛 버전을 담으면 409 이고 latest.ruleBundleStatus 는 SUSPENDED 다 (3층)', async () => {
    const w = ready();
    suspendBundle(w.world, w.bundle!.id);
    const result = await post(CLINIC_1_SLUG, requestBody(w, { catalogVersion: 'TEST_FIXTURE_CATALOG_OLD' }));
    expect(result.status).toBe(409);
    expect((result.body as { latest: { ruleBundleStatus: string } }).latest.ruleBundleStatus).toBe('SUSPENDED');
  });
});

describe('AC-021a 공개 오류 표 전체 (상태 번호와 코드가 정확히 나온다)', () => {
  type Row = [label: string, status: number, code: string, run: (w: EstimateWorld) => Promise<Awaited<ReturnType<typeof post>>>];

  const bad = (patch: Record<string, unknown>) => (w: EstimateWorld) => post(CLINIC_1_SLUG, requestBody(w, patch));

  const ROWS: Row[] = [
    ['404 CLINIC_NOT_FOUND', 404, 'CLINIC_NOT_FOUND', (w) => post('nope', requestBody(w))],
    ['400 필수 필드 누락', 400, 'INVALID_REQUEST', bad({ cause: undefined })],
    ['400 JSON 형식 오류', 400, 'INVALID_REQUEST', bad({ treatmentIds: 'x' })],
    ['400 열거 밖 insurerType', 400, 'INVALID_REQUEST', bad({ insurerType: 'X' })],
    ['400 열거 밖 cause', 400, 'INVALID_REQUEST', bad({ cause: 'X' })],
    ['400 JSON 아님', 400, 'INVALID_REQUEST', () => callPostRaw(POST, CLINIC_1_SLUG, '{nope')],
    ['409 VERSION_MISMATCH', 409, 'VERSION_MISMATCH', bad({ catalogVersion: 'OLD' })],
    ['422 UNSUPPORTED_GENERATION', 422, 'UNSUPPORTED_GENERATION', bad({ generation: 'GEN5_C5' })],
    ['422 NO_TREATMENT_SELECTED', 422, 'NO_TREATMENT_SELECTED', bad({ treatmentIds: [] })],
    ['422 TREATMENT_NOT_PUBLISHED', 422, 'TREATMENT_NOT_PUBLISHED', bad({ treatmentIds: ['NO_SUCH_TREATMENT'] })],
    [
      '500 INTERNAL_ERROR (엔진 INVALID_NUMERIC_INPUT)',
      500,
      'INTERNAL_ERROR',
      () => {
        // 게시 검증을 거치지 않고 저장소에 직접 넣은 무효 금액 (AC-006i 의 서버 상태).
        const broken = buildWorld();
        adoptTreatmentVersion(broken.world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_BROKEN', treatmentId: T1, patientAmount: -1 }));
        const adopted = broken.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
        serve(broken);
        return post(CLINIC_1_SLUG, requestBody({ catalog: adopted, bundle: broken.bundle }, { treatmentIds: [T1] }));
      },
    ],
  ];

  it.each(ROWS)('%s', async (_label, status, code, run) => {
    const result = await run(ready());
    expect(result.status).toBe(status);
    expectNoStoreJson(result);
    if (status === 409) {
      expect((result.body as { error: string }).error).toBe(code);
    } else {
      expect(result.body).toEqual({ error: code });
    }
  });

  it('성공(200)과 보류(200)는 거절이 아니다: 올바른 요청 한 건은 정확히 200 이다', async () => {
    const w = ready();
    expect((await post(CLINIC_1_SLUG, requestBody(w))).status).toBe(200);
  });
});
