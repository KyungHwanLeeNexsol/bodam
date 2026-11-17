import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/clinics/[slug]/catalog/route';
import * as catalogRoute from '../../src/app/api/clinics/[slug]/catalog/route';
import { coverageFingerprintOf } from '../../src/server/fingerprint';
import { DEFAULT_IDLE_THRESHOLDS, saveClinicIdlePolicy } from '../../src/server/idle-policy';
import { createMemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1 } from '../fixtures/server/actors.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG, CollectingLog, createTestServices, publishBundleAndAssign, publishSecondClinicCatalog, suspendBundle, useTestServices } from '../fixtures/server/api-composition.fixture';
import { makeClinic, makeCommonBaseFee, makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { catalogWorld, publishCatalogOf } from '../fixtures/server/versioning.fixture';
import { callGet, collectKeys, repoWith } from './helpers';

// AC-018a (integration): GET /api/clinics/{slug}/catalog — 표시 필드만, idlePolicy, 없는 slug 는 404 CLINIC_NOT_FOUND.
// AC-021e 의 catalog 쪽 헤더(no-store)도 같이 본다(계산·options 응답은 각자의 시험이 본다).
// 모든 시험은 실제 route.ts 의 GET 을 부른다. 서비스는 시험 구성(TEST composition)이 vi.mock 으로 들어온다.

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

const call = (slug: string) => callGet(GET, slug, 'catalog');

interface CatalogBody {
  clinic: { slug: string; displayName: string; setting: string };
  serviceDisplayName: string;
  catalogVersion: string | null;
  treatments: Array<{ treatmentId: string; displayName: string; description: string; benefitType: string; patientAmount: number; priceCondition: string; order: number }>;
  baseFees: Array<{ baseFeeId: string; displayName: string; benefitType: string; amount: number }>;
  baseFeeIncluded: string;
  idlePolicy: { screens: Record<string, { warnSeconds: number; resetSeconds: number }>; completionHoldSeconds: number | null };
}

/** 치료 둘(이름·금액·설명이 서로 다른 값)과 기본비용 둘을 게시한 병원 1 의 세계. */
function distinctWorld(): { world: World; catalogId: string } {
  const world = catalogWorld();
  const catalog = publishCatalogOf(
    world,
    {
      treatmentVersions: [
        makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1', treatmentId: 'TEST_FIXTURE_TREATMENT_1', displayName: 'TEST_FIXTURE 치료 가', description: 'TEST_FIXTURE 설명 가', patientAmount: 12_000 }),
        makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentId: 'TEST_FIXTURE_TREATMENT_2', displayName: 'TEST_FIXTURE 치료 나', description: 'TEST_FIXTURE 설명 나', benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT', patientAmount: 34_000 }),
      ],
      commonBaseFees: [
        makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_1', displayName: 'TEST_FIXTURE 기본비용 가', amount: 5_000 }),
        makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_2', displayName: 'TEST_FIXTURE 기본비용 나', benefitType: 'NON_BENEFIT', amount: 700 }),
      ],
    },
    TEST_CATALOG_CONFIG,
  );
  return { world, catalogId: catalog.id };
}

const PRICE_CONDITION = 'TEST_FIXTURE_PATIENT · TEST_FIXTURE_ASSUMPTION · 기준일 2026-10-16';

beforeEach(() => {
  useTestServices(null);
});

describe('라우트 모양', () => {
  it('catalog 라우트는 GET 하나만 내보낸다 (본문을 읽는 메서드가 없다)', () => {
    expect(Object.keys(catalogRoute)).toEqual(['GET']);
  });

  it('params 는 약속(Promise)으로 받는다: 풀린 약속의 slug 로 병원을 찾는다', async () => {
    const { world } = distinctWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const response = await GET(new Request('http://localhost/x'), { params: new Promise((resolve) => setTimeout(() => resolve({ slug: CLINIC_1_SLUG }), 1)) });
    expect(response.status).toBe(200);
  });
});

describe('AC-018a 없는 slug', () => {
  it('저장소에 병원이 없으면 404 { error: CLINIC_NOT_FOUND } 이고 no-store 다', async () => {
    useTestServices(createTestServices({ repo: createMemoryRepository() }));
    const result = await call('anything');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'CLINIC_NOT_FOUND' });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('content-type')).toBe('application/json');
  });

  it.each([
    ['대소문자가 다르다', 'TEST-FIXTURE-CLINIC-1'],
    ['끝에 공백이 붙었다', 'test-fixture-clinic-1 '],
    ['앞부분만 같다', 'test-fixture-clinic'],
    ['뒤에 글자가 붙었다', 'test-fixture-clinic-10'],
    ['빈 문자열', ''],
    ['병원 id 는 slug 가 아니다', TEST_FIXTURE_CLINIC_ID],
    ['프로토타입 이름', '__proto__'],
  ])('slug 는 정확히 같아야 한다: %s -> 404', async (_label, slug) => {
    const { world } = distinctWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const result = await call(slug);
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'CLINIC_NOT_FOUND' });
  });

  it('없는 slug 의 404 는 저장소를 아무것도 바꾸지 않는다', async () => {
    const { world } = distinctWorld();
    const before = world.repo.exportState();
    useTestServices(createTestServices({ repo: world.repo }));
    await call('nope');
    expect(world.repo.exportState()).toEqual(before);
  });
});

describe('AC-018a 게시 카탈로그: 표시 필드만', () => {
  it('병원·서비스명·카탈로그 버전·치료·기본비용·idlePolicy 를 DD-19 모양대로 낸다', async () => {
    const { world, catalogId } = distinctWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const result = await call(CLINIC_1_SLUG);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('content-type')).toBe('application/json');
    expect(result.body).toEqual({
      clinic: { slug: CLINIC_1_SLUG, displayName: 'TEST_FIXTURE 시험 의원', setting: 'OUTPATIENT_ONLY' },
      serviceDisplayName: '보담',
      catalogVersion: catalogId,
      treatments: [
        { treatmentId: 'TEST_FIXTURE_TREATMENT_1', displayName: 'TEST_FIXTURE 치료 가', description: 'TEST_FIXTURE 설명 가', benefitType: 'BENEFIT', patientAmount: 12_000, priceCondition: PRICE_CONDITION, order: 1 },
        { treatmentId: 'TEST_FIXTURE_TREATMENT_2', displayName: 'TEST_FIXTURE 치료 나', description: 'TEST_FIXTURE 설명 나', benefitType: 'NON_BENEFIT', patientAmount: 34_000, priceCondition: PRICE_CONDITION, order: 1 },
      ],
      baseFees: [
        { baseFeeId: 'TEST_FIXTURE_FEE_1', displayName: 'TEST_FIXTURE 기본비용 가', benefitType: 'BENEFIT', amount: 5_000 },
        { baseFeeId: 'TEST_FIXTURE_FEE_2', displayName: 'TEST_FIXTURE 기본비용 나', benefitType: 'NON_BENEFIT', amount: 700 },
      ],
      baseFeeIncluded: 'INCLUDED',
      idlePolicy: { screens: DEFAULT_IDLE_THRESHOLDS, completionHoldSeconds: null },
    });
  });

  it('catalogVersion 은 병원의 현재 카탈로그 버전 id 이고 가격만 바뀐 새 게시도 새 버전이다', async () => {
    const { world, catalogId } = distinctWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    expect((await call(CLINIC_1_SLUG)).body).toMatchObject({ catalogVersion: catalogId });
    const republished = publishCatalogOf(
      world,
      {
        treatmentVersions: [
          makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1B', treatmentId: 'TEST_FIXTURE_TREATMENT_1', displayName: 'TEST_FIXTURE 치료 가', description: 'TEST_FIXTURE 설명 가', patientAmount: 13_000 }),
        ],
        commonBaseFees: [],
      },
      TEST_CATALOG_CONFIG,
    );
    const after = (await call(CLINIC_1_SLUG)).body as CatalogBody;
    expect(republished.id).not.toBe(catalogId);
    expect(after.catalogVersion).toBe(republished.id);
    expect(after.treatments.map((t) => [t.treatmentId, t.patientAmount])).toEqual([['TEST_FIXTURE_TREATMENT_1', 13_000]]);
    expect(after.baseFees).toEqual([]);
    expect(after.baseFeeIncluded).toBe('NOT_REGISTERED');
  });

  it('치료는 order(sortOrder) 순이고 같은 order 는 treatmentId 의 코드 포인트 순이다', async () => {
    const { world } = distinctWorld();
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_1', sortOrder: 5 }));
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_2', sortOrder: 2 }));
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as CatalogBody;
    expect(body.treatments.map((t) => [t.treatmentId, t.order])).toEqual([
      ['TEST_FIXTURE_TREATMENT_2', 2],
      ['TEST_FIXTURE_TREATMENT_1', 5],
    ]);
  });

  it('비활성 치료는 현재 게시 카탈로그에 없는 것으로 보고 싣지 않는다', async () => {
    const { world } = distinctWorld();
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_2', active: false }));
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as CatalogBody;
    expect(body.treatments.map((t) => t.treatmentId)).toEqual(['TEST_FIXTURE_TREATMENT_1']);
  });

  it('깊은 키 검사: 응답 어디에도 검토 상태·지문·검토자·출처·보장 판단 필드의 키가 없다', async () => {
    const { world } = distinctWorld();
    publishBundleAndAssign(world);
    useTestServices(createTestServices({ repo: world.repo }));
    const result = await call(CLINIC_1_SLUG);
    const keys = collectKeys(result.body);
    expect([...keys].sort()).toEqual(
      [
        'amount', 'baseFeeId', 'baseFeeIncluded', 'baseFees', 'benefitType', 'catalogVersion', 'clinic', 'completionHoldSeconds', 'description', 'displayName', 'idlePolicy',
        'order', 'patientAmount', 'priceCondition', 'resetSeconds', 'screens', 'serviceDisplayName', 'setting', 'slug', 'treatmentId', 'treatments', 'warnSeconds',
        ...Object.keys(DEFAULT_IDLE_THRESHOLDS),
      ].sort(),
    );
    const forbidden = /state|fingerprint|review|approv|author|publisher|origin|calcClass|treatmentCode|procedureCode|documentFlags|effectiveDate|contact|clinicId|hash|bundle|scope|version$/i;
    expect([...keys].filter((key) => forbidden.test(key))).toEqual(['catalogVersion']);
  });

  it('값 검사: 보장 판단 필드의 값(행위 코드·치료 코드·지문)과 병원 연락처, 병원 id 가 본문 어디에도 없다', async () => {
    const { world } = distinctWorld();
    publishBundleAndAssign(world);
    useTestServices(createTestServices({ repo: world.repo }));
    const result = await call(CLINIC_1_SLUG);
    const version = world.repo.getTreatmentVersion('TEST_FIXTURE_TV_1')!;
    for (const secret of [version.treatmentCode, ...version.procedureCodes, coverageFingerprintOf(version), 'TEST_FIXTURE_CONTACT', TEST_FIXTURE_CLINIC_ID, 'TEST_FIXTURE_TV_1', 'TEST_FIXTURE_BUNDLE', 'TEST_FIXTURE_FEE_CODE']) {
      expect(result.text, secret).not.toContain(secret);
    }
    expect(result.text).not.toMatch(/TEST_FIXTURE_(PROFILE|MAPPING|DOCUMENT_RULE_SET)/);
  });

  it('규칙 묶음·항목 상태를 읽지 않는다 (카탈로그 응답은 묶음 상태와 무관하다)', async () => {
    const { world } = distinctWorld();
    publishBundleAndAssign(world);
    world.repo.spy.reset();
    useTestServices(createTestServices({ repo: world.repo }));
    await call(CLINIC_1_SLUG);
    const counts = world.repo.spy.counts;
    for (const name of ['readItemStates', 'getItemState', 'getItemVersion', 'listItemVersions', 'getRuleBundleVersion', 'getBundleStatus', 'getClinicRuleScope'] as const) {
      expect(counts[name], name).toBe(0);
    }
  });

  it('읽기 전용이다: 호출 전후로 저장소 전체가 같다', async () => {
    const { world } = distinctWorld();
    const before = world.repo.exportState();
    useTestServices(createTestServices({ repo: world.repo }));
    await call(CLINIC_1_SLUG);
    await call(CLINIC_1_SLUG);
    expect(world.repo.exportState()).toEqual(before);
  });

  it('같은 요청을 두 번 부르면 같은 본문이다 (요청마다 새로 읽어 만든다)', async () => {
    const { world } = distinctWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    expect((await call(CLINIC_1_SLUG)).text).toBe((await call(CLINIC_1_SLUG)).text);
  });
});

describe('AC-018a idlePolicy', () => {
  it('저장된 정책이 없는 병원: DD-10 표의 다섯 화면 값과 completionHoldSeconds null', async () => {
    const { world } = distinctWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as CatalogBody;
    expect(body.idlePolicy).toEqual({
      screens: {
        INPUT: { warnSeconds: 100, resetSeconds: 120 },
        RESULT: { warnSeconds: 160, resetSeconds: 180 },
        BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 },
        HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 },
        NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 },
      },
      completionHoldSeconds: null,
    });
  });

  it('저장된 정책이 있는 병원: 저장한 화면 종류는 저장한 값, 저장하지 않은 화면 종류는 표의 값, completionHoldSeconds 는 저장한 값', async () => {
    const { world } = distinctWorld();
    saveClinicIdlePolicy(world.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, {
      screens: { INPUT: { warnSeconds: 50, resetSeconds: 90 }, HOLD_RESULT: { warnSeconds: 10, resetSeconds: 40 } },
      completionHoldSeconds: 30,
    });
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as CatalogBody;
    expect(body.idlePolicy).toEqual({
      screens: {
        INPUT: { warnSeconds: 50, resetSeconds: 90 },
        RESULT: { warnSeconds: 160, resetSeconds: 180 },
        BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 },
        HOLD_RESULT: { warnSeconds: 10, resetSeconds: 40 },
        NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 },
      },
      completionHoldSeconds: 30,
    });
  });

  it('정책은 병원마다 따로다: 병원 1 의 정책이 병원 2 에 나오지 않는다', async () => {
    const { world } = distinctWorld();
    publishSecondClinicCatalog(world);
    saveClinicIdlePolicy(world.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: { INPUT: { warnSeconds: 50, resetSeconds: 90 } }, completionHoldSeconds: 30 });
    useTestServices(createTestServices({ repo: world.repo }));
    const second = (await call(CLINIC_2_SLUG)).body as CatalogBody;
    expect(second.idlePolicy).toEqual({ screens: DEFAULT_IDLE_THRESHOLDS, completionHoldSeconds: null });
  });
});

describe('AC-018a 병원마다 다른 카탈로그', () => {
  it('두 병원은 각자의 치료·기본비용·카탈로그 버전만 낸다', async () => {
    const { world, catalogId } = distinctWorld();
    const second = publishSecondClinicCatalog(world);
    useTestServices(createTestServices({ repo: world.repo }));
    const first = (await call(CLINIC_1_SLUG)).body as CatalogBody;
    const other = (await call(CLINIC_2_SLUG)).body as CatalogBody;
    expect(first.catalogVersion).toBe(catalogId);
    expect(other.catalogVersion).toBe(second.id);
    expect(other.catalogVersion).not.toBe(first.catalogVersion);
    expect(other.treatments.map((t) => [t.treatmentId, t.displayName, t.patientAmount])).toEqual([['TEST_FIXTURE_OTHER_TREATMENT_1', 'TEST_FIXTURE 병원2 치료', 33_000]]);
    expect(other.baseFees).toEqual([{ baseFeeId: 'TEST_FIXTURE_FEE_OTHER_1', displayName: 'TEST_FIXTURE 병원2 기본비용', benefitType: 'BENEFIT', amount: 3_300 }]);
    expect(first.treatments.map((t) => t.treatmentId)).not.toContain('TEST_FIXTURE_OTHER_TREATMENT_1');
    expect(other.clinic.slug).toBe(CLINIC_2_SLUG);
  });
});

describe('AC-018a 규칙 범위가 없거나 승인된 프로필이 없는 병원도 카탈로그를 받는다', () => {
  it('규칙 사용 범위가 없는 병원: 200 이고 카탈로그와 idlePolicy 가 나온다', async () => {
    const { world, catalogId } = distinctWorld();
    expect(world.repo.getClinicRuleScope(TEST_FIXTURE_CLINIC_ID)).toBeNull();
    useTestServices(createTestServices({ repo: world.repo }));
    const result = await call(CLINIC_1_SLUG);
    expect(result.status).toBe(200);
    expect((result.body as CatalogBody).catalogVersion).toBe(catalogId);
  });

  it('묶음이 중지돼도 카탈로그 응답은 그대로다', async () => {
    const { world } = distinctWorld();
    const bundle = publishBundleAndAssign(world);
    useTestServices(createTestServices({ repo: world.repo }));
    const before = (await call(CLINIC_1_SLUG)).text;
    suspendBundle(world, bundle.id);
    expect((await call(CLINIC_1_SLUG)).text).toBe(before);
  });
});

describe('AC-018a 카탈로그를 게시한 적 없는 병원 [문서에 없음]', () => {
  it('200, catalogVersion null, 치료·기본비용 빈 배열, NOT_REGISTERED, idlePolicy 는 표의 값', async () => {
    const repo = createMemoryRepository();
    repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_9', slug: 'test-fixture-clinic-9', name: 'TEST_FIXTURE 빈 의원' }));
    useTestServices(createTestServices({ repo }));
    const result = await call('test-fixture-clinic-9');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      clinic: { slug: 'test-fixture-clinic-9', displayName: 'TEST_FIXTURE 빈 의원', setting: 'OUTPATIENT_ONLY' },
      serviceDisplayName: '보담',
      catalogVersion: null,
      treatments: [],
      baseFees: [],
      baseFeeIncluded: 'NOT_REGISTERED',
      idlePolicy: { screens: DEFAULT_IDLE_THRESHOLDS, completionHoldSeconds: null },
    });
  });
});

describe('서버 데이터 무결성 결함은 500 INTERNAL_ERROR 하나로 나간다', () => {
  type Case = [string, (world: World) => Parameters<typeof repoWith>[1], string];
  const cases: Case[] = [
    ['현재 카탈로그가 담은 치료 버전이 없다', () => ({ getTreatmentVersion: () => null }), 'TREATMENT_VERSION_MISSING'],
    ['치료 버전이 가리키는 치료가 없다', () => ({ getTreatment: () => null }), 'TREATMENT_MISSING'],
    ['카탈로그가 다른 병원의 치료를 담았다', (world) => ({ getTreatment: () => ({ ...world.repo.getTreatment('TEST_FIXTURE_TREATMENT_1')!, clinicId: 'TEST_FIXTURE_CLINIC_ELSE' }) }), 'TREATMENT_CLINIC_MISMATCH'],
    ['현재 카탈로그가 담은 기본비용 버전이 없다', () => ({ getCommonBaseFee: () => null }), 'BASE_FEE_MISSING'],
    ['카탈로그가 다른 병원의 기본비용을 담았다', (world) => ({ getCommonBaseFee: () => ({ ...world.repo.getCommonBaseFee('TEST_FIXTURE_FEE_1')!, clinicId: 'TEST_FIXTURE_CLINIC_ELSE' }) }), 'BASE_FEE_CLINIC_MISMATCH'],
  ];

  it.each(cases)('%s -> 500, 본문에 금액·치료 id·내부 상세가 없고 로그는 코드뿐이다', async (_label, overrides, code) => {
    const { world } = distinctWorld();
    const log = new CollectingLog();
    useTestServices(createTestServices({ repo: repoWith(world.repo, overrides(world)), log }));
    const result = await call(CLINIC_1_SLUG);
    expect(result.status).toBe(500);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.body).toEqual({ error: 'INTERNAL_ERROR' });
    for (const leaked of ['12000', '34000', 'TEST_FIXTURE', 'at ', 'Error']) {
      expect(result.text).not.toContain(leaked);
    }
    expect(log.entries).toEqual([{ event: 'SERVER_INTEGRITY_ERROR', code }]);
  });

  it('저장소가 예기치 못한 오류를 던져도 500 이고 오류 내용은 응답과 로그에 나가지 않는다', async () => {
    const log = new CollectingLog();
    const repo = repoWith(createMemoryRepository(), {
      listClinics: () => {
        throw new Error('SECRET_REPO_FAILURE 환자 선택 T-777');
      },
    });
    useTestServices(createTestServices({ repo, log }));
    const result = await call(CLINIC_1_SLUG);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(result.text).not.toContain('SECRET');
    expect(log.entries).toEqual([{ event: 'UNEXPECTED_ERROR', code: 'UNEXPECTED' }]);
  });
});
