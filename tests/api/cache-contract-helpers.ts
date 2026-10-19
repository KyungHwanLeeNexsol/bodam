import { vi } from 'vitest';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import { estimate } from '../../src/engine/estimate';
import type { EstimateInput, RuleBundleSnapshot } from '../../src/engine/types';
import { createBundleContentCache } from '../../src/server/api/bundle-content-cache';
import type { BundleContentCache } from '../../src/server/api/bundle-content-cache';
import { publishCatalog } from '../../src/server/catalog-publish';
import type { RuleBundleVersion } from '../../src/server/domain/entities';
import type { ItemVersionRecordOf, ItemVersionRef } from '../../src/server/domain/items';
import { assignRuleScope } from '../../src/server/rule-scope';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1 } from '../fixtures/server/actors.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG } from '../fixtures/server/api-composition.fixture';
import type { CollectingLog } from '../fixtures/server/api-composition.fixture';
import { GEN, INSURER, buildWorld, requestBody } from '../fixtures/server/estimate-world.fixture';
import type { EstimateWorld, WorldPlan } from '../fixtures/server/estimate-world.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { mappingRecord } from '../fixtures/server/items.fixture';
import { TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID, addOtherClinic, approveSpec, publishRefs } from '../fixtures/server/versioning.fixture';
import type { BundleRefs } from '../fixtures/server/versioning.fixture';
import { serve } from './estimate-helpers';
import type { EstimateBody, LineBody } from './estimate-helpers';
import type { Called } from './helpers';
import { callPost } from './post-helpers';

// 캐시 적중 계약 시험(M4.C)이 공유하는 도우미: 호출을 세는 캐시, 요청 한 번의 읽기 기록, 재승인 시나리오의 단계, 병원 둘의 세계.
// vi.mock 은 각 시험 파일이 직접 적는다(이 파일은 엔진 estimate 가 통과형 감시로 바뀌어 있다고 가정한다).

export const estimateSpy = vi.mocked(estimate);

/** 캐시 호출 횟수. lookups 는 조회 전체, hits 는 그중 적중, stores 는 저장 호출(= 내용을 새로 채운 횟수). */
export interface CacheCalls {
  lookups: number;
  hits: number;
  stores: number;
}

/** 실제 캐시를 감싸 호출을 센다. 공개 이름은 캐시 인터페이스와 같은 셋(lookup·store·entries)뿐이라 무효화 호출은 만들 수 없다. */
export function countingCache(inner: BundleContentCache = createBundleContentCache()): { cache: BundleContentCache; calls: CacheCalls } {
  const calls: CacheCalls = { lookups: 0, hits: 0, stores: 0 };
  const cache: BundleContentCache = {
    lookup(bundleId, contentHash) {
      calls.lookups += 1;
      const found = inner.lookup(bundleId, contentHash);
      if (found !== null) {
        calls.hits += 1;
      }
      return found;
    },
    store(content) {
      calls.stores += 1;
      inner.store(content);
    },
    entries: () => inner.entries(),
  };
  return { cache, calls };
}

/** 캐시를 쓰지 않는 대역: 항상 미적중이고 아무것도 저장하지 않는다. 캐시 적중 응답과 비교하는 기준(캐시 없는 서버)이다. */
export const NO_CACHE: BundleContentCache = { lookup: () => null, store: () => undefined, entries: () => [] };

export interface Ctx {
  w: EstimateWorld;
  cache: BundleContentCache;
  calls: CacheCalls;
  log: CollectingLog;
}

/** 세계를 만들고 호출을 세는 캐시와 함께 시험 구성으로 지정한다. */
export function ready(plan?: WorldPlan): Ctx {
  const w = buildWorld(plan);
  const { cache, calls } = countingCache();
  const log = serve(w, { bundleCache: cache });
  return { w, cache, calls, log };
}

/** 병원 1 의 현재 카탈로그와 (기본은 처음 규칙 사용 범위의) 묶음 버전을 담은 요청 본문. 카탈로그가 새로 게시됐으면 새 카탈로그 id 를 쓴다. */
export function currentBody(w: EstimateWorld, overrides: Record<string, unknown> = {}, bundle: RuleBundleVersion | null = w.bundle): Record<string, unknown> {
  const catalog = w.world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
  return requestBody({ catalog, bundle }, overrides);
}

export interface Sent {
  called: Called;
  body: EstimateBody;
  /** 이 요청 한 번 동안 저장소 읽기 호출 수. */
  reads: Record<string, number>;
  /** 이 요청이 엔진에 넘긴 입력. 엔진을 부르기 전에 끝난 요청(4xx)은 null. */
  engineInput: EstimateInput | null;
}

/** 요청 하나를 실제 POST 로 보내고, 그 요청만의 읽기 호출 수와 엔진 입력을 함께 돌려준다. */
export async function send(w: EstimateWorld, body: unknown, slug: string = CLINIC_1_SLUG): Promise<Sent> {
  w.world.repo.spy.reset();
  estimateSpy.mockClear();
  const called = await callPost(POST, slug, body);
  const reads = { ...w.world.repo.spy.counts } as Record<string, number>;
  const engineInput = estimateSpy.mock.calls.at(-1)?.[0] ?? null;
  return { called, body: called.body as EstimateBody, reads, engineInput };
}

export function lineOf(body: EstimateBody, treatmentId: string): LineBody {
  const found = body.result.lines.find((line) => line.treatmentId === treatmentId);
  if (found === undefined) {
    throw new Error(`TEST_FIXTURE: 응답에 ${treatmentId} 줄이 없다`);
  }
  return found;
}

/** 줄의 판정: 보류이면 보류 코드, 아니면 줄 상태. */
export const verdict = (body: EstimateBody, treatmentId: string): string => lineOf(body, treatmentId).holdReason ?? lineOf(body, treatmentId).state;

/** 엔진에 넘어간 묶음 스냅샷(보류 없는 ACTIVE 묶음이면 항상 있다). */
export function engineBundle(sent: Sent): RuleBundleSnapshot {
  const bundle = sent.engineInput?.bundle ?? null;
  if (bundle === null) {
    throw new Error('TEST_FIXTURE: 엔진 입력에 묶음이 없다');
  }
  return bundle;
}

/** 엔진에 넘어간 매핑 스냅샷 하나(대상 치료·기본비용 id 로 찾는다). */
export function engineMapping(sent: Sent, targetId: string) {
  const found = engineBundle(sent).mappings.find((mapping) => mapping.treatmentId === targetId);
  if (found === undefined) {
    throw new Error(`TEST_FIXTURE: 엔진 입력에 ${targetId} 의 매핑이 없다`);
  }
  return found;
}

/** 계산 한 번의 읽기가 "요청마다 새로 읽기" 계약을 지킨다: 규칙 범위 1, 가용성 1, 항목 상태 읽기 정확히 1, 항목별 상태 조회 0. */
export function freshReadCounts(reads: Record<string, number>): Record<string, number> {
  return { getClinicRuleScope: reads.getClinicRuleScope!, getBundleStatus: reads.getBundleStatus!, readItemStates: reads.readItemStates!, getItemState: reads.getItemState! };
}
export const FRESH_READS = { getClinicRuleScope: 1, getBundleStatus: 1, readItemStates: 1, getItemState: 0 };

// ───────────────────────── 묶음 구성 도우미 ─────────────────────────

/** 묶음 안의 매핑 항목 참조 가운데 대상(치료 또는 공통 기본비용 id)이 맞는 것. */
export function mappingRefFor(w: EstimateWorld, targetId: string): ItemVersionRef {
  const found = w.bundle!.itemRefs.find((ref) => ref.kind === 'MAPPING' && (w.world.repo.getItemVersion(ref) as ItemVersionRecordOf<'MAPPING'>).content.treatmentId === targetId);
  if (found === undefined) {
    throw new Error(`TEST_FIXTURE: 묶음에 ${targetId} 의 매핑이 없다`);
  }
  return found;
}

export function refOfKind(bundle: RuleBundleVersion, kind: ItemVersionRef['kind']): ItemVersionRef {
  const found = bundle.itemRefs.find((ref) => ref.kind === kind);
  if (found === undefined) {
    throw new Error(`TEST_FIXTURE: 묶음에 ${kind} 항목이 없다`);
  }
  return found;
}

/** 묶음의 항목 참조를 게시 요청 모양으로 되돌린다 (같은 항목을 담은 새 묶음을 게시할 때 쓴다). */
export function refsOf(bundle: RuleBundleVersion): BundleRefs {
  return {
    profiles: bundle.itemRefs.filter((ref) => ref.kind === 'PROFILE'),
    mappings: bundle.itemRefs.filter((ref) => ref.kind === 'MAPPING'),
    documentRuleSet: bundle.itemRefs.find((ref) => ref.kind === 'DOCUMENT_RULE_SET') ?? null,
  };
}

export interface TwoClinics extends Ctx {
  /** 병원 2 가 쓰는 묶음: 병원 1 의 묶음 X 와 프로필·서류 규칙 묶음 항목 버전을 공유하고 매핑은 병원 2 의 치료 하나뿐이다. */
  y: RuleBundleVersion;
  catalog2Id: string;
}

/**
 * 병원 1(묶음 X)과 병원 2(묶음 Y)가 같은 프로필 버전을 공유하는 세계. 병원 2 는 기본비용이 없는 카탈로그 하나와 치료 하나(OTHER_CLINIC_TREATMENT_ID)를 갖는다.
 * 모든 단계는 도메인 서비스로 지난다(카탈로그 게시, 매핑 작성·제출·승인, 묶음 게시, 범위 지정).
 */
export function twoClinics(): TwoClinics {
  const ctx = ready();
  const { world } = ctx.w;
  addOtherClinic(world.repo);
  const catalog2 = publishCatalog(
    world.deps,
    TEST_FIXTURE_HA_1,
    OTHER_CLINIC_ID,
    {
      treatmentVersions: [makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_OTHER_1', treatmentId: OTHER_CLINIC_TREATMENT_ID, displayName: 'TEST_FIXTURE 병원2 치료', patientAmount: 33_000 })],
      commonBaseFees: [],
    },
    TEST_CATALOG_CONFIG,
  );
  const own = approveSpec(world, { profiles: [], mappings: [mappingRecord(OTHER_CLINIC_TREATMENT_ID, { id: 'TEST_FIXTURE_MAPPING_OTHER' }).content], documentRuleSet: null });
  const x = refsOf(ctx.w.bundle!);
  const y = publishRefs(world, { profiles: x.profiles, mappings: own.mappings, documentRuleSet: x.documentRuleSet });
  assignRuleScope(world.deps, TEST_FIXTURE_PO_1, OTHER_CLINIC_ID, y.id);
  return { ...ctx, y, catalog2Id: catalog2.id };
}

/** 병원 2 의 올바른 요청 본문 (치료 하나). */
export function clinic2Body(t: Pick<TwoClinics, 'y' | 'catalog2Id'>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    catalogVersion: t.catalog2Id,
    ruleBundleVersion: t.y.id,
    generation: GEN,
    insurerType: INSURER,
    cause: 'UNKNOWN',
    treatmentIds: [OTHER_CLINIC_TREATMENT_ID],
    ...overrides,
  };
}

export { CLINIC_1_SLUG, CLINIC_2_SLUG };
