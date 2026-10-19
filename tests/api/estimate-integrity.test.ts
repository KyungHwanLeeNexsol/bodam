import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import { estimate } from '../../src/engine/estimate';
import type { PublishedLine } from '../../src/engine/types';
import type { BundleContent } from '../../src/server/api/bundle-content';
import type { PublishedCatalog } from '../../src/server/api/published-catalog';
import type { CatalogVersion, CommonBaseFee, TreatmentVersion } from '../../src/server/domain/entities';
import type { MemoryRepository } from '../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { CLINIC_1_SLUG, CollectingLog, createTestServices, suspendBundle, useTestServices } from '../fixtures/server/api-composition.fixture';
import { T1, T2, makeBaseFeeVersion } from '../fixtures/server/base-fee.fixture';
import { makeCatalogVersion, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { buildWorld, requestBody } from '../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../fixtures/server/estimate-world.fixture';
import { validCatalogRequest } from '../fixtures/server/publish.fixture';
import { estimateBody, expectNoStoreJson, nonZeroReads, serve } from './estimate-helpers';
import { repoWith } from './helpers';
import { callPost } from './post-helpers';

// AC-006i (integration, M4): 서버 데이터 무결성 결함과 엔진 거절은 결과 없이 HTTP 500 INTERNAL_ERROR 이다.
//   (1) 엔진의 INVALID_NUMERIC_INPUT · INPUT_INTEGRITY_VIOLATION 거절 -> 500 (금액·치료 id·내부 상세 없음)
//   (2) M1 엔진이 검사하지 않는 서버 책임 네 가지 (a)~(d): 서버의 줄 조립이 그 입력을 엔진에 넘기지 않는다
//   (3) 읽어 온 규칙 묶음의 구조 (i)~(vi): ACTIVE 묶음에만 적용하고, 범위 없음·중지 판정이 먼저이며 항목을 읽지 않는다
// 요청 거절(4xx)은 값이고 서버 데이터 결함은 형식을 갖춘 오류(ServerIntegrityError)다. 두 종류를 이 파일이 구분해서 확인한다.
// 결함 주입 방법: 운영 코드에는 시험 훅이 없다. 저장소 자료로 닿을 수 있는 결함은 저장소 자료를 직접 고치고(게시 검증을 거치지 않은 서버 상태),
// 닿을 수 없는 결함(저장소의 방어선과 조립 코드가 막는 것)은 한 단계 아래 모듈(estimate-lines 의 resolveLines, bundle-content 의 loadBundleContent)을
// vi.mock 으로 "실제 결과를 받아 한 군데만 망가뜨리는 통과형 감싸개"로 바꿔 넣는다.

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

vi.mock('../../src/engine/estimate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/estimate')>();
  return { ...real, estimate: vi.fn(real.estimate) };
});

interface Resolved {
  lines: PublishedLine[];
  baseFeeLines: PublishedLine[];
}

const hooks = vi.hoisted(() => ({
  resolve: null as null | ((out: { lines: unknown[]; baseFeeLines: unknown[] }, published: unknown, selectedIds: readonly string[]) => { lines: unknown[]; baseFeeLines: unknown[] }),
  content: null as null | ((out: unknown) => unknown),
  contentCalls: 0,
}));

vi.mock('../../src/server/api/estimate-lines', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/api/estimate-lines')>();
  return {
    ...real,
    resolveLines: (...args: Parameters<typeof real.resolveLines>) => {
      const out = real.resolveLines(...args);
      return hooks.resolve === null ? out : hooks.resolve(out, args[0], args[1]);
    },
  };
});

vi.mock('../../src/server/api/bundle-content', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/api/bundle-content')>();
  return {
    ...real,
    loadBundleContent: (...args: Parameters<typeof real.loadBundleContent>) => {
      hooks.contentCalls += 1;
      const out = real.loadBundleContent(...args);
      return hooks.content === null ? out : (hooks.content(out) as ReturnType<typeof real.loadBundleContent>);
    },
  };
});

// 출처 요약이 엔진의 resolveMapping 을 다시 부른다. estimate() 가 끝난 뒤의 호출만 "매핑을 정하지 못함"으로 바꾸는 통과형 감싸개다.
const resolveHooks = vi.hoisted(() => ({ afterEstimate: false }));
vi.mock('../../src/engine/resolve', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/resolve')>();
  return {
    ...real,
    resolveMapping: (...args: Parameters<typeof real.resolveMapping>) => (resolveHooks.afterEstimate ? ({ resolved: false, code: 'MAPPING_ABSENT' } as const) : real.resolveMapping(...args)),
  };
});

const estimateSpy = vi.mocked(estimate);

beforeEach(() => {
  useTestServices(null);
  hooks.resolve = null;
  hooks.content = null;
  hooks.contentCalls = 0;
  resolveHooks.afterEstimate = false;
  estimateSpy.mockClear();
});

const post = (body: unknown) => callPost(POST, CLINIC_1_SLUG, body);

function ready(plan?: Parameters<typeof buildWorld>[0]): { w: EstimateWorld; log: CollectingLog } {
  const w = buildWorld(plan);
  return { w, log: serve(w) };
}

/** 500 응답의 공통 확인: 본문은 { error } 하나, 결과·금액·치료 id·스택·내부 상세 없음, 로그는 사건 이름과 코드뿐. */
function expectInternalError(called: Awaited<ReturnType<typeof post>>, log: CollectingLog, code: string): void {
  expect(called.status).toBe(500);
  expectNoStoreJson(called);
  expect(called.body).toEqual({ error: 'INTERNAL_ERROR' });
  for (const leaked of ['result', 'amounts', 'hospitalPayment', 'TEST_FIXTURE', 'Error', ' at ', '10000', '25000', '-1']) {
    expect(called.text, leaked).not.toContain(leaked);
  }
  expect(log.entries).toEqual([{ event: 'SERVER_INTEGRITY_ERROR', code }]);
  for (const entry of log.entries) {
    expect(Object.keys(entry).sort()).toEqual(['code', 'event']);
  }
}

/** 병원 1 의 현재 카탈로그를 직접 바꿔 놓는다 (게시 검증을 거치지 않은 서버 상태). */
function swapCatalog(repo: MemoryRepository, id: string, treatmentVersions: TreatmentVersion[], fees: CommonBaseFee[]): CatalogVersion {
  for (const version of treatmentVersions) repo.putTreatmentVersion(version);
  for (const fee of fees) repo.putCommonBaseFee(fee);
  const catalog = makeCatalogVersion({ id, treatmentVersionIds: treatmentVersions.map((version) => version.id), baseFeeIds: fees.map((fee) => fee.id) });
  repo.putCatalogVersion(catalog);
  repo.saveClinic({ ...repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, currentCatalogVersionId: catalog.id });
  return catalog;
}

const [TV1, TV2] = validCatalogRequest().treatmentVersions as [TreatmentVersion, TreatmentVersion];

describe('AC-006i (1) 엔진의 INVALID_NUMERIC_INPUT 거절은 500 INTERNAL_ERROR 이다', () => {
  it.each([
    ['음수', -1],
    ['소수', 1.5],
    ['NaN', Number.NaN],
    ['무한대', Number.POSITIVE_INFINITY],
    ['한도(10억원) 초과', 1_000_000_001],
    ['안전 정수 밖', Number.MAX_SAFE_INTEGER + 2],
  ])('저장된 치료 줄 금액이 무효(%s)이면 500 이고 엔진은 불렸지만 결과가 없다', async (_label, patientAmount) => {
    const { w, log } = ready();
    const catalog = swapCatalog(w.world.repo, 'TEST_FIXTURE_CATALOG_BROKEN', [{ ...TV1, id: 'TEST_FIXTURE_TV_BROKEN', patientAmount }, TV2], [makeBaseFeeVersion(1)]);
    const result = await post(requestBody({ catalog, bundle: w.bundle }));
    expectInternalError(result, log, 'ENGINE_INVALID_NUMERIC_INPUT');
    expect(estimateSpy).toHaveBeenCalledTimes(1);
  });

  it('저장된 공통 기본비용 금액이 무효여도 500 이다', async () => {
    const { w, log } = ready();
    const catalog = swapCatalog(w.world.repo, 'TEST_FIXTURE_CATALOG_BROKEN', [TV1, TV2], [makeBaseFeeVersion(5, { amount: -5 })]);
    expectInternalError(await post(requestBody({ catalog, bundle: w.bundle })), log, 'ENGINE_INVALID_NUMERIC_INPUT');
  });

  it('무효 금액의 치료를 고르지 않으면(공통 기본비용도 정상) 그 줄은 엔진에 가지 않아 200 이다', async () => {
    const { w } = ready();
    const catalog = swapCatalog(w.world.repo, 'TEST_FIXTURE_CATALOG_BROKEN', [{ ...TV1, id: 'TEST_FIXTURE_TV_BROKEN', patientAmount: -1 }, TV2], [makeBaseFeeVersion(1)]);
    const result = await post(requestBody({ catalog, bundle: w.bundle }, { treatmentIds: [T2] }));
    expect(result.status).toBe(200);
  });
});

describe('AC-006i (1) 엔진의 INPUT_INTEGRITY_VIOLATION 거절은 500 INTERNAL_ERROR 이다', () => {
  it('같은 치료의 줄이 내용이 달라 충돌하는 카탈로그(한 치료가 두 버전으로 담김) -> 500', async () => {
    const { w, log } = ready();
    const catalog = swapCatalog(w.world.repo, 'TEST_FIXTURE_CATALOG_DUP', [TV1, { ...TV1, id: 'TEST_FIXTURE_TV_1_DUP', patientAmount: 11_000 }, TV2], [makeBaseFeeVersion(1)]);
    expectInternalError(await post(requestBody({ catalog, bundle: w.bundle })), log, 'ENGINE_INPUT_INTEGRITY_VIOLATION');
    expect(estimateSpy).toHaveBeenCalledTimes(1);
  });

  it('같은 공통 기본비용의 줄이 내용이 달라 충돌하는 카탈로그 -> 500', async () => {
    const { w, log } = ready();
    const catalog = swapCatalog(w.world.repo, 'TEST_FIXTURE_CATALOG_DUP', [TV1, TV2], [makeBaseFeeVersion(1), makeBaseFeeVersion(2, { amount: 6_000 })]);
    expectInternalError(await post(requestBody({ catalog, bundle: w.bundle })), log, 'ENGINE_INPUT_INTEGRITY_VIOLATION');
  });

  it('내용이 완전히 같은 중복 줄은 충돌이 아니다: 한 번으로 세어 200 이고 병원 결제액이 늘지 않는다', async () => {
    const { w } = ready();
    const catalog = swapCatalog(w.world.repo, 'TEST_FIXTURE_CATALOG_SAME', [TV1, TV1, TV2], [makeBaseFeeVersion(1)]);
    const result = await post(requestBody({ catalog, bundle: w.bundle }));
    expect(result.status).toBe(200);
    expect(estimateBody(result).result.amounts.hospitalPayment).toBe(25_000);
  });
});

describe('AC-006i (2) M1 엔진이 검사하지 않는 서버 책임 네 가지: 서버의 줄 조립이 그 입력을 엔진에 넘기지 않는다', () => {
  /** 통과형 감싸개가 받는 실제 결과에서 한 군데만 망가뜨린다. */
  const corrupt = (change: (out: Resolved, published: PublishedCatalog, selectedIds: readonly string[]) => Resolved) => {
    hooks.resolve = (out, published, selectedIds) => change(out as Resolved, published as PublishedCatalog, selectedIds);
  };

  it('대조군: 감싸개가 아무것도 바꾸지 않으면 200 이다', async () => {
    const { w } = ready();
    corrupt((out) => out);
    expect((await post(requestBody(w))).status).toBe(200);
  });

  it('(a) 선택한 treatmentId 에 게시된 줄이 없다 -> 500, 엔진은 불리지 않는다', async () => {
    const { w, log } = ready();
    corrupt((out) => ({ ...out, lines: out.lines.slice(1) }));
    expectInternalError(await post(requestBody(w)), log, 'ASSEMBLY_SELECTED_LINE_MISSING');
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it('(b) 선택하지 않은 treatmentId 의 줄이 엔진 입력에 들어간다 -> 500, 엔진은 불리지 않는다', async () => {
    const { w, log } = ready();
    corrupt((out, published) => {
      const unselected = published.treatments.find(({ treatment }) => treatment.id === T2)!;
      const extra: PublishedLine = { ...out.lines[0]!, treatmentId: unselected.treatment.id, treatmentVersionId: unselected.version.id };
      return { ...out, lines: [...out.lines, extra] };
    });
    expectInternalError(await post(requestBody(w, { treatmentIds: [T1] })), log, 'ASSEMBLY_UNSELECTED_LINE_PRESENT');
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it('(c) 같은 treatmentId 가 lines 와 baseFeeLines 양쪽에 있다 -> 500, 엔진은 불리지 않는다', async () => {
    const { w, log } = ready();
    corrupt((out) => ({ ...out, baseFeeLines: [...out.baseFeeLines, { ...out.lines[0]!, isBaseFee: true }] }));
    expectInternalError(await post(requestBody(w)), log, 'ASSEMBLY_LINE_IN_BOTH_ARRAYS');
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it('(d-1) baseFeeLines 안의 줄이 isBaseFee: false 이다 -> 500, 엔진은 불리지 않는다', async () => {
    const { w, log } = ready();
    corrupt((out) => ({ ...out, baseFeeLines: out.baseFeeLines.map((line) => ({ ...line, isBaseFee: false })) }));
    expectInternalError(await post(requestBody(w)), log, 'ASSEMBLY_BASE_FEE_FLAG_MISMATCH');
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it('(d-2) lines 안의 줄이 isBaseFee: true 이다 -> 500, 엔진은 불리지 않는다', async () => {
    const { w, log } = ready();
    corrupt((out) => ({ ...out, lines: out.lines.map((line, index) => (index === 0 ? { ...line, isBaseFee: true } : line)) }));
    expectInternalError(await post(requestBody(w)), log, 'ASSEMBLY_BASE_FEE_FLAG_MISMATCH');
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it('요청 거절(4xx)과 서버 결함(500)은 다르다: 같은 감싸개가 있어도 층 0~4 의 거절이 먼저 나가 4xx 이고 줄 조립에 닿지 않는다', async () => {
    const { w } = ready();
    corrupt((out) => ({ ...out, lines: out.lines.slice(1) }));
    expect((await post(requestBody(w, { treatmentIds: ['NO_SUCH'] }))).status).toBe(422);
    expect((await post(requestBody(w, { catalogVersion: 'OLD' }))).status).toBe(409);
  });
});

describe('AC-006i (3) 읽어 온 규칙 묶음의 구조: ACTIVE 묶음에만 적용한다', () => {
  type Content = BundleContent & Record<string, unknown>;
  const corrupt = (change: (content: Content) => unknown) => {
    hooks.content = (out) => change(out as Content);
  };

  it('대조군: 감싸개가 아무것도 바꾸지 않으면 200 이고 묶음 내용을 한 번 읽는다', async () => {
    const { w } = ready();
    corrupt((content) => content);
    expect((await post(requestBody(w))).status).toBe(200);
    expect(hooks.contentCalls).toBe(1);
  });

  it.each([
    ['(i) null 프로필 항목', (c: Content) => ({ ...c, profiles: [null] })],
    ['(i) 프로필 항목이 숫자', (c: Content) => ({ ...c, profiles: [5] })],
    ['(i) 프로필 항목이 문자열', (c: Content) => ({ ...c, profiles: ['x'] })],
    ['(i) 프로필 항목이 배열', (c: Content) => ({ ...c, profiles: [[]] })],
    ['(i) 프로필 항목이 undefined', (c: Content) => ({ ...c, profiles: [undefined] })],
    ['(i) 정상 항목 사이의 null 프로필', (c: Content) => ({ ...c, profiles: [...c.profiles, null] })],
    ['(i) 프로필 내용(content)이 null', (c: Content) => ({ ...c, profiles: [{ ...c.profiles[0]!, content: null }] })],
    ['(ii) null 매핑 항목', (c: Content) => ({ ...c, mappings: [null] })],
    ['(ii) 매핑 항목이 숫자', (c: Content) => ({ ...c, mappings: [5] })],
    ['(ii) 매핑 항목이 배열', (c: Content) => ({ ...c, mappings: [[]] })],
    ['(ii) 정상 항목 사이의 null 매핑', (c: Content) => ({ ...c, mappings: [...c.mappings, null] })],
    ['(ii) 매핑 내용(content)이 배열', (c: Content) => ({ ...c, mappings: [{ ...c.mappings[0]!, content: [] }] })],
    ['(iii) profiles = null', (c: Content) => ({ ...c, profiles: null })],
    ['(iii) profiles = undefined', (c: Content) => ({ ...c, profiles: undefined })],
    ['(iii) profiles = 객체', (c: Content) => ({ ...c, profiles: {} })],
    ['(iii) profiles = 문자열', (c: Content) => ({ ...c, profiles: 'x' })],
    ['(iii) profiles = 숫자', (c: Content) => ({ ...c, profiles: 5 })],
    ['(iii) mappings = null', (c: Content) => ({ ...c, mappings: null })],
    ['(iii) mappings = undefined', (c: Content) => ({ ...c, mappings: undefined })],
    ['(iii) mappings = 객체', (c: Content) => ({ ...c, mappings: {} })],
    ['(iii) mappings = 문자열', (c: Content) => ({ ...c, mappings: 'x' })],
    ['(iii) mappings = 숫자', (c: Content) => ({ ...c, mappings: 5 })],
  ])('ACTIVE 묶음의 %s -> 500, 결과·금액·치료 id·내부 상세가 없고 엔진은 불리지 않는다', async (_label, change) => {
    const { w, log } = ready();
    corrupt(change);
    expectInternalError(await post(requestBody(w)), log, 'BUNDLE_STRUCTURE_INVALID');
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it('구조 결함이 있으면 항목 상태를 읽지 않고 거절한다 (엔진 앞에서 막는다)', async () => {
    const { w } = ready();
    corrupt((c) => ({ ...c, profiles: null }));
    w.world.repo.spy.reset();
    await post(requestBody(w));
    expect(nonZeroReads(w.world.repo).readItemStates).toBeUndefined();
  });

  it('(iv) 같은 결함을 담은 SUSPENDED 묶음은 묶음 내용을 읽지 않고 200 ON_HOLD RULE_BUNDLE_SUSPENDED 다 (판정 순서가 바뀌지 않는다)', async () => {
    const { w } = ready();
    suspendBundle(w.world, w.bundle!.id);
    for (const change of [(c: Content) => ({ ...c, profiles: null }), (c: Content) => ({ ...c, mappings: null }), (c: Content) => ({ ...c, profiles: [null] }), (c: Content) => ({ ...c, mappings: [null] })]) {
      corrupt(change);
      w.world.repo.spy.reset();
      hooks.contentCalls = 0;
      const result = await post(requestBody(w));
      expect(result.status).toBe(200);
      const body = estimateBody(result);
      expect(new Set(body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['RULE_BUNDLE_SUSPENDED']));
      expect(hooks.contentCalls).toBe(0);
      const reads = nonZeroReads(w.world.repo);
      for (const itemRead of ['readItemStates', 'getItemVersion', 'getRuleBundleVersion']) {
        expect(reads[itemRead], itemRead).toBeUndefined();
      }
    }
  });

  it('(v) 규칙 사용 범위가 없으면 결함과 관계없이 CLINIC_RULE_SCOPE_ABSENT 다 (묶음 내용을 읽지 않는다)', async () => {
    const { w } = ready({ spec: null });
    corrupt((c) => ({ ...c, profiles: null, mappings: null }));
    const result = await post(requestBody(w));
    expect(result.status).toBe(200);
    expect(new Set(estimateBody(result).result.lines.map((line) => line.holdReason))).toEqual(new Set(['CLINIC_RULE_SCOPE_ABSENT']));
    expect(hooks.contentCalls).toBe(0);
  });

  it('(vi-1) 정상적인 빈 profiles [] 는 구조 결함이 아니다: 기존 엔진 판정 PROFILE_ABSENT 로 200 보류다', async () => {
    const { w } = ready();
    corrupt((c) => ({ ...c, profiles: [] }));
    const result = await post(requestBody(w));
    expect(result.status).toBe(200);
    const body = estimateBody(result);
    expect(new Set(body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['PROFILE_ABSENT']));
    expect(estimateSpy).toHaveBeenCalledTimes(1);
  });

  it('(vi-2) 정상적인 빈 mappings [] 도 구조 결함이 아니다: 줄마다 MAPPING_ABSENT 로 200 보류다', async () => {
    const { w } = ready();
    corrupt((c) => ({ ...c, mappings: [] }));
    const result = await post(requestBody(w));
    expect(result.status).toBe(200);
    const body = estimateBody(result);
    expect(new Set(body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['MAPPING_ABSENT']));
  });

  it('서류 규칙 묶음이 없는 묶음 내용은 구조 결함이 아니다 (범위 밖): documents 는 RULES_UNAVAILABLE', async () => {
    const { w } = ready();
    corrupt((c) => ({ ...c, documentRuleSet: null }));
    const result = await post(requestBody(w));
    expect(result.status).toBe(200);
    expect(estimateBody(result).documents).toEqual({ state: 'RULES_UNAVAILABLE' });
  });
});

describe('저장소 자료가 서로 맞지 않으면(서버 데이터 무결성 결함) 500 INTERNAL_ERROR 이다', () => {
  type Case = [label: string, overrides: (w: EstimateWorld) => Parameters<typeof repoWith>[1], code: string];
  const cases: Case[] = [
    ['규칙 범위가 가리키는 묶음의 가용성 기록이 없다', () => ({ getBundleStatus: () => null }), 'BUNDLE_AVAILABILITY_MISSING'],
    ['규칙 범위가 가리키는 묶음 기록이 없다', () => ({ getRuleBundleVersion: () => null }), 'BUNDLE_MISSING'],
    ['묶음이 담은 항목의 내용이 없다', () => ({ getItemVersion: () => null }), 'ITEM_CONTENT_MISSING'],
    ['묶음이 담은 항목의 상태 기록이 없다', () => ({ readItemStates: (refs: never) => (refs as unknown as unknown[]).map(() => null) }), 'ITEM_STATE_MISSING'],
    ['현재 카탈로그가 담은 치료 버전이 없다', () => ({ getTreatmentVersion: () => null }), 'TREATMENT_VERSION_MISSING'],
    ['현재 카탈로그가 담은 기본비용 버전이 없다', () => ({ getCommonBaseFee: () => null }), 'BASE_FEE_MISSING'],
  ];

  it.each(cases)('%s -> 500, 로그는 사건 이름과 코드뿐이다', async (_label, overrides, code) => {
    const w = buildWorld();
    const log = new CollectingLog();
    useTestServices(createTestServices({ repo: repoWith(w.world.repo, overrides(w)), log }));
    expectInternalError(await post(requestBody(w)), log, code);
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it('옛 카탈로그 버전이 담은 참조가 깨져 있으면 409 의 priceChanged 를 계산하다가 500 이다 (치료 버전 / 기본비용)', async () => {
    const brokenOld: Array<[Partial<CatalogVersion>, string]> = [
      [{ treatmentVersionIds: ['TEST_FIXTURE_TV_GONE'] }, 'TREATMENT_VERSION_MISSING'],
      [{ baseFeeIds: ['TEST_FIXTURE_FEE_GONE'] }, 'BASE_FEE_MISSING'],
    ];
    for (const [patch, code] of brokenOld) {
      const w = buildWorld();
      const log = new CollectingLog();
      const broken: CatalogVersion = { ...w.catalog, id: 'TEST_FIXTURE_CATALOG_BROKEN_OLD', ...patch };
      useTestServices(createTestServices({ repo: repoWith(w.world.repo, { getCatalogVersion: () => broken }), log }));
      expectInternalError(await post(requestBody(w, { catalogVersion: 'TEST_FIXTURE_CATALOG_BROKEN_OLD' })), log, code);
    }
  });

  it('예기치 못한 오류는 UNEXPECTED_ERROR 로 500 이고 오류 내용이 응답과 로그에 나가지 않는다', async () => {
    const w = buildWorld();
    const log = new CollectingLog();
    useTestServices(createTestServices({ repo: repoWith(w.world.repo, { readItemStates: () => { throw new Error('SECRET_FAILURE 환자 선택 T-777'); } }), log }));
    const result = await post(requestBody(w));
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'INTERNAL_ERROR' });
    expect(result.text).not.toContain('SECRET');
    expect(log.entries).toEqual([{ event: 'UNEXPECTED_ERROR', code: 'UNEXPECTED' }]);
  });

  it('엔진이 요청 거절 코드(UNSUPPORTED_GENERATION)를 낸다면 서버 결함이므로 500 이다 (서버가 먼저 걸렀어야 할 입력)', async () => {
    const { w, log } = ready();
    estimateSpy.mockImplementationOnce(() => ({ ok: false, rejection: { code: 'UNSUPPORTED_GENERATION' } }));
    expectInternalError(await post(requestBody(w)), log, 'ENGINE_UNSUPPORTED_GENERATION');
  });

  it('엔진이 판정을 끝낸 줄인데 출처 요약을 위한 매핑 판정이 매핑을 정하지 못하면 서버 결함이므로 500 이다', async () => {
    const { w, log } = ready();
    const actual = await vi.importActual<typeof import('../../src/engine/estimate')>('../../src/engine/estimate');
    estimateSpy.mockImplementationOnce((input, deps) => {
      const outcome = actual.estimate(input, deps);
      resolveHooks.afterEstimate = true;
      return outcome;
    });
    expectInternalError(await post(requestBody(w)), log, 'ORIGIN_MAPPING_UNRESOLVED');
  });

  it('엔진이 NO_TREATMENT_SELECTED 를 낸다면 서버 결함이므로 500 이다', async () => {
    const { w, log } = ready();
    estimateSpy.mockImplementationOnce(() => ({ ok: false, rejection: { code: 'NO_TREATMENT_SELECTED' } }));
    expectInternalError(await post(requestBody(w)), log, 'ENGINE_NO_TREATMENT_SELECTED');
  });
});
