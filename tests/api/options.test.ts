import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/clinics/[slug]/insurance/options/route';
import * as optionsRoute from '../../src/app/api/clinics/[slug]/insurance/options/route';
import { GENERATIONS } from '../../src/engine/types';
import { assignRuleScope } from '../../src/server/rule-scope';
import { INSURER_TYPES } from '../../src/server/readiness';
import { createMemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_PO_1 } from '../fixtures/server/actors.fixture';
import {
  CLINIC_1_SLUG,
  CLINIC_2_SLUG,
  CollectingLog,
  createTestServices,
  publishBundleAndAssign,
  publishSecondClinicCatalog,
  publishedCatalogWorld,
  suspendBundle,
  useTestServices,
} from '../fixtures/server/api-composition.fixture';
import { makeClinic } from '../fixtures/server/entities.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { approveSpec, publishRefs, validSpec } from '../fixtures/server/versioning.fixture';
import { callGet, collectKeys, repoWith } from './helpers';

// AC-018b (integration): GET /api/clinics/{slug}/insurance/options — 카드 5/3/3, 안내 문구(1544-8069 문자열, "1588" 없음),
//   ruleBundleVersion·ruleBundleStatus 는 병원의 규칙 사용 범위가 가리키는 묶음의 값(범위가 없으면 둘 다 null), no-store, 없는 slug 는 404.
// AC-011g (integration): 묶음이 중지(SUSPENDED)된 병원도 같은 묶음 id, 상태 SUSPENDED, 카드 5/3/3, no-store, 규칙 사용 범위 기록은 바뀌지 않는다.
// AC-021e 의 options 쪽 헤더(no-store). 모든 시험은 실제 route.ts 의 GET 을 부른다.

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

const call = (slug: string) => callGet(GET, slug, 'insurance/options');

interface OptionsBody {
  ruleBundleVersion: string | null;
  ruleBundleStatus: string | null;
  generations: Array<{ code: string; label: string; period: string }>;
  insurerTypes: Array<{ code: string; label: string; help: string }>;
  causes: Array<{ code: string; label: string; help: string }>;
  guidance: { generationUnknown: string };
}

// 카드 문구의 출처: 세대 5장 = 기획서 §3 표('선택 카드'·'이미지 기준 가입기간 안내'), 보험사 형태 3장 = 기획서 §4 화면 2, 원인 3장 = 기획서 §4 화면 3,
// 안내 문구 = 기획서 §4 화면 1 ('가입 시기를 모르실 때' 안내 문구로 고정).
const EXPECTED_GENERATIONS = [
  { code: 'GEN1_AS', label: '1세대(A·S)', period: '2009.08.01 이전' },
  { code: 'GEN2_C1', label: '2세대(C1)', period: '2009.08.01~2015.09.01 이전' },
  { code: 'GEN2_5_C2', label: '2.5세대(C2)', period: '2015.09.01~2017.04.01 이전' },
  { code: 'GEN3_C3', label: '3세대(C3)', period: '2017.04.01~2021.07.01 이전' },
  { code: 'GEN4_C4', label: '4세대(C4)', period: '2021.07.01부터의 4세대 계약' },
];
const EXPECTED_INSURER_TYPES = [
  { code: 'NON_LIFE', label: '손해보험사', help: '손해보험사에서 가입한 실손보험' },
  { code: 'LIFE', label: '생명보험사', help: '생명보험사에서 가입한 실손보험' },
  { code: 'MUTUAL_AID', label: '그외 공제 조합', help: '우체국, 새마을금고 공제회, 농협' },
];
const EXPECTED_CAUSES = [
  { code: 'INJURY', label: '다쳐서 왔어요 (상해)', help: '넘어짐, 부딪힘, 화상처럼 갑작스러운 사고로 다친 경우' },
  { code: 'ILLNESS', label: '아파서 왔어요 (질병)', help: '통증, 염증, 질환처럼 몸에 생긴 병으로 치료받는 경우' },
  { code: 'UNKNOWN', label: '잘 모르겠어요', help: '상해일 때와 질병일 때 필요한 서류를 모두 안내' },
];
const EXPECTED_GUIDANCE = '보험증권이나 보험사 앱에서 가입일을 확인해 주세요. 확인이 어려우면 1544-8069로 문의해 주세요.';

function expectCards(body: OptionsBody): void {
  expect(body.generations).toEqual(EXPECTED_GENERATIONS);
  expect(body.insurerTypes).toEqual(EXPECTED_INSURER_TYPES);
  expect(body.causes).toEqual(EXPECTED_CAUSES);
  expect(body.guidance).toEqual({ generationUnknown: EXPECTED_GUIDANCE });
}

/** 병원 1(묶음 1 지정)과 병원 2(묶음 2 지정)가 있는 세계. 두 병원이 서로 다른 규칙 묶음을 쓴다. */
function twoClinicWorld(): { world: World; bundle1: string; bundle2: string } {
  const { world } = publishedCatalogWorld();
  publishSecondClinicCatalog(world);
  const bundle1 = publishBundleAndAssign(world, 1).id;
  const bundle2 = publishBundleAndAssign(world, 2, 'TEST_FIXTURE_CLINIC_2').id;
  return { world, bundle1, bundle2 };
}

beforeEach(() => {
  useTestServices(null);
});

describe('라우트 모양', () => {
  it('options 라우트는 GET 하나만 내보낸다', () => {
    expect(Object.keys(optionsRoute)).toEqual(['GET']);
  });
});

describe('AC-018b 없는 slug', () => {
  it('404 { error: CLINIC_NOT_FOUND } 이고 no-store 다', async () => {
    useTestServices(createTestServices({ repo: createMemoryRepository() }));
    const result = await call('nope');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'CLINIC_NOT_FOUND' });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('content-type')).toBe('application/json');
  });

  it.each([['대소문자가 다르다', 'Test-Fixture-Clinic-1'], ['끝에 공백', 'test-fixture-clinic-1 '], ['병원 id', TEST_FIXTURE_CLINIC_ID]])('slug 는 정확히 같아야 한다: %s -> 404', async (_label, slug) => {
    const { world } = publishedCatalogWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    expect((await call(slug)).status).toBe(404);
  });
});

describe('AC-018b 카드와 안내 문구', () => {
  it('세대 5장·형태 3장·원인 3장과 안내 문구가 기획서 문구 그대로 나온다 (규칙 범위가 없는 병원)', async () => {
    const { world } = publishedCatalogWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const result = await call(CLINIC_1_SLUG);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('content-type')).toBe('application/json');
    const body = result.body as OptionsBody;
    expectCards(body);
    expect(body.generations).toHaveLength(5);
    expect(body.insurerTypes).toHaveLength(3);
    expect(body.causes).toHaveLength(3);
  });

  it('카드 코드는 엔진이 받는 열거와 같다 (세대는 GENERATIONS, 형태는 INSURER_TYPES 와 같은 순서)', async () => {
    const { world } = publishedCatalogWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as OptionsBody;
    expect(body.generations.map((card) => card.code)).toEqual([...GENERATIONS]);
    expect(body.insurerTypes.map((card) => card.code)).toEqual([...INSURER_TYPES]);
    expect(body.causes.map((card) => card.code)).toEqual(['INJURY', 'ILLNESS', 'UNKNOWN']);
  });

  it('1544-8069 는 문자열로만 들어 있고 "1588" 은 응답 어디에도 없다', async () => {
    const { world } = publishedCatalogWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const result = await call(CLINIC_1_SLUG);
    expect((result.body as OptionsBody).guidance.generationUnknown).toContain('1544-8069');
    expect(result.text).not.toContain('1588');
    expect(result.text.match(/1544-8069/g)).toHaveLength(1);
  });

  it('깊은 키 검사: 응답의 키는 DD-19 모양의 닫힌 목록뿐이다 (항목·검토 내부 정보가 없다)', async () => {
    const { world } = twoClinicWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const keys = collectKeys((await call(CLINIC_1_SLUG)).body);
    expect([...keys].sort()).toEqual(['causes', 'code', 'generationUnknown', 'generations', 'guidance', 'help', 'insurerTypes', 'label', 'period', 'ruleBundleStatus', 'ruleBundleVersion'].sort());
  });

  it('승인된 프로필이 하나도 없는 병원(규칙 범위 없음)도 카드를 숨기지 않는다 (DD-05)', async () => {
    const { world } = publishedCatalogWorld();
    expect(world.repo.listRuleBundleVersions()).toEqual([]);
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as OptionsBody;
    expectCards(body);
    expect(body.ruleBundleVersion).toBeNull();
    expect(body.ruleBundleStatus).toBeNull();
  });

  it('카탈로그를 게시한 적 없는 병원도 카드를 받는다', async () => {
    const repo = createMemoryRepository();
    repo.saveClinic(makeClinic());
    useTestServices(createTestServices({ repo }));
    const body = (await call(CLINIC_1_SLUG)).body as OptionsBody;
    expectCards(body);
    expect(body).toMatchObject({ ruleBundleVersion: null, ruleBundleStatus: null });
  });

  it('프로필이 없는 묶음을 쓰는 병원도 카드 5/3/3 을 받고 묶음 id 와 상태가 그대로 나온다', async () => {
    const { world } = publishedCatalogWorld();
    const spec = validSpec(3);
    const bundle = publishRefs(world, approveSpec(world, { ...spec, profiles: [] }));
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, bundle.id);
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as OptionsBody;
    expectCards(body);
    expect(body).toMatchObject({ ruleBundleVersion: bundle.id, ruleBundleStatus: 'ACTIVE' });
  });

  it('카드는 병원·묶음과 무관하게 같다: 두 병원의 카드 부분이 완전히 같다', async () => {
    const { world } = twoClinicWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const first = (await call(CLINIC_1_SLUG)).body as OptionsBody;
    const second = (await call(CLINIC_2_SLUG)).body as OptionsBody;
    const cards = ({ generations, insurerTypes, causes, guidance }: OptionsBody) => ({ generations, insurerTypes, causes, guidance });
    expect(cards(first)).toEqual(cards(second));
  });
});

describe('AC-018b 규칙 묶음 버전과 상태', () => {
  it('범위가 없으면 둘 다 null', async () => {
    const { world } = publishedCatalogWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as OptionsBody;
    expect(body.ruleBundleVersion).toBeNull();
    expect(body.ruleBundleStatus).toBeNull();
  });

  it('범위가 있으면 가리키는 묶음 id 와 ACTIVE', async () => {
    const { world } = publishedCatalogWorld();
    const bundle = publishBundleAndAssign(world);
    useTestServices(createTestServices({ repo: world.repo }));
    const body = (await call(CLINIC_1_SLUG)).body as OptionsBody;
    expect(body).toMatchObject({ ruleBundleVersion: bundle.id, ruleBundleStatus: 'ACTIVE' });
  });

  it('서로 다른 묶음을 쓰는 두 병원은 각자의 묶음 id 를 받는다', async () => {
    const { world, bundle1, bundle2 } = twoClinicWorld();
    expect(bundle1).not.toBe(bundle2);
    useTestServices(createTestServices({ repo: world.repo }));
    expect(((await call(CLINIC_1_SLUG)).body as OptionsBody)).toMatchObject({ ruleBundleVersion: bundle1, ruleBundleStatus: 'ACTIVE' });
    expect(((await call(CLINIC_2_SLUG)).body as OptionsBody)).toMatchObject({ ruleBundleVersion: bundle2, ruleBundleStatus: 'ACTIVE' });
  });

  it('범위를 새 묶음으로 다시 지정하면 다음 요청에 새 묶음 id 가 나온다 (요청마다 새로 읽는다)', async () => {
    const { world, bundle1 } = twoClinicWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    expect(((await call(CLINIC_1_SLUG)).body as OptionsBody).ruleBundleVersion).toBe(bundle1);
    const replacement = publishRefs(world, approveSpec(world, validSpec(4)));
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, replacement.id);
    expect(((await call(CLINIC_1_SLUG)).body as OptionsBody).ruleBundleVersion).toBe(replacement.id);
  });
});

describe('AC-011g 묶음 중지', () => {
  it('중지된 묶음: 같은 묶음 id, 상태 SUSPENDED, 카드 5/3/3, no-store, 규칙 사용 범위 기록은 그대로다', async () => {
    const { world, bundle1 } = twoClinicWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    const scopeBefore = world.repo.getClinicRuleScope(TEST_FIXTURE_CLINIC_ID);
    const historyBefore = world.repo.listClinicRuleScopeHistory(TEST_FIXTURE_CLINIC_ID);
    const activeBody = (await call(CLINIC_1_SLUG)).body as OptionsBody;
    expect(activeBody.ruleBundleStatus).toBe('ACTIVE');

    suspendBundle(world, bundle1);
    const result = await call(CLINIC_1_SLUG);
    const body = result.body as OptionsBody;
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(body.ruleBundleVersion).toBe(bundle1);
    expect(body.ruleBundleStatus).toBe('SUSPENDED');
    expectCards(body);
    expect(body.generations).toHaveLength(5);
    expect(body.insurerTypes).toHaveLength(3);
    expect(body.causes).toHaveLength(3);
    expect(world.repo.getClinicRuleScope(TEST_FIXTURE_CLINIC_ID)).toEqual(scopeBefore);
    expect(world.repo.listClinicRuleScopeHistory(TEST_FIXTURE_CLINIC_ID)).toEqual(historyBefore);
  });

  it('중지는 같은 서비스 인스턴스의 다음 요청에 바로 보인다 (이전 응답이 남지 않는다)', async () => {
    const { world, bundle1 } = twoClinicWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    expect(((await call(CLINIC_1_SLUG)).body as OptionsBody).ruleBundleStatus).toBe('ACTIVE');
    suspendBundle(world, bundle1);
    expect(((await call(CLINIC_1_SLUG)).body as OptionsBody).ruleBundleStatus).toBe('SUSPENDED');
    expect(((await call(CLINIC_1_SLUG)).body as OptionsBody).ruleBundleStatus).toBe('SUSPENDED');
  });

  it('한 병원의 묶음 중지는 다른 묶음을 쓰는 병원에 영향이 없다', async () => {
    const { world, bundle1, bundle2 } = twoClinicWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    suspendBundle(world, bundle1);
    expect(((await call(CLINIC_2_SLUG)).body as OptionsBody)).toMatchObject({ ruleBundleVersion: bundle2, ruleBundleStatus: 'ACTIVE' });
  });

  it('같은 묶음을 쓰는 두 병원은 모두 SUSPENDED 로 보인다', async () => {
    const { world, bundle1 } = twoClinicWorld();
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, 'TEST_FIXTURE_CLINIC_2', bundle1);
    suspendBundle(world, bundle1);
    useTestServices(createTestServices({ repo: world.repo }));
    for (const slug of [CLINIC_1_SLUG, CLINIC_2_SLUG]) {
      expect(((await call(slug)).body as OptionsBody)).toMatchObject({ ruleBundleVersion: bundle1, ruleBundleStatus: 'SUSPENDED' });
    }
  });
});

describe('읽는 것: 범위와 가용성만 (항목은 읽지 않는다)', () => {
  it('규칙 범위 읽기 1회와 묶음 가용성 읽기 1회만 하고 항목 내용·상태·묶음 내용·카탈로그는 읽지 않는다', async () => {
    const { world } = twoClinicWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    world.repo.spy.reset();
    await call(CLINIC_1_SLUG);
    const counts = world.repo.spy.counts;
    expect(counts.getClinicRuleScope).toBe(1);
    expect(counts.getBundleStatus).toBe(1);
    for (const name of [
      'readItemStates', 'getItemState', 'getItemVersion', 'listItemVersions', 'getRuleBundleVersion', 'listRuleBundleVersions',
      'getClinicCurrentCatalogVersion', 'getCatalogVersion', 'getTreatment', 'getTreatmentVersion', 'getCommonBaseFee', 'getIdlePolicy',
    ] as const) {
      expect(counts[name], name).toBe(0);
    }
  });

  it('범위가 없는 병원은 가용성을 읽지 않는다', async () => {
    const { world } = publishedCatalogWorld();
    useTestServices(createTestServices({ repo: world.repo }));
    world.repo.spy.reset();
    await call(CLINIC_1_SLUG);
    expect(world.repo.spy.counts.getClinicRuleScope).toBe(1);
    expect(world.repo.spy.counts.getBundleStatus).toBe(0);
  });

  it('읽기 전용이다: 호출 전후로 저장소 전체가 같다', async () => {
    const { world, bundle1 } = twoClinicWorld();
    suspendBundle(world, bundle1);
    const before = world.repo.exportState();
    useTestServices(createTestServices({ repo: world.repo }));
    await call(CLINIC_1_SLUG);
    await call(CLINIC_2_SLUG);
    expect(world.repo.exportState()).toEqual(before);
  });
});

describe('서버 데이터 무결성 결함', () => {
  it('범위는 있는데 그 묶음의 가용성 기록이 없으면 500 INTERNAL_ERROR 이다 (status 를 null 로 흘리지 않는다)', async () => {
    const { world } = publishedCatalogWorld();
    publishBundleAndAssign(world);
    const log = new CollectingLog();
    useTestServices(createTestServices({ repo: repoWith(world.repo, { getBundleStatus: () => null }), log }));
    const result = await call(CLINIC_1_SLUG);
    expect(result.status).toBe(500);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(log.entries).toEqual([{ event: 'SERVER_INTEGRITY_ERROR', code: 'BUNDLE_AVAILABILITY_MISSING' }]);
  });
});
