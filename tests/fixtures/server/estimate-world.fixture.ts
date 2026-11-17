import type { Origin } from '../../../src/engine/types';
import type { CatalogVersion, CommonBaseFee, RuleBundleVersion, TreatmentVersion } from '../../../src/server/domain/entities';
import type { MappingContent } from '../../../src/server/domain/items';
import { makeExcludedMapping } from '../engine/mappings.fixture';
import { BASE_FEE_ID, T1, T2, makeBaseFeeVersion, publishAndAssign } from './base-fee.fixture';
import { TEST_FIXTURE_CLINIC_ID } from './actors.fixture';
import { documentRuleSetRecord, mappingRecord, profileRecord } from './items.fixture';
import type { World } from './lifecycle.fixture';
import { validCatalogRequest } from './publish.fixture';
import { approveSpec, catalogWorld, publishCatalogOf } from './versioning.fixture';
import type { BundleSpec } from './versioning.fixture';

// 시험 자료(TEST_FIXTURE). 계산 요청(POST …/estimate) 통합 시험이 쓰는 세계 만들기 도우미.
// 모든 단계는 실제 도메인 서비스로 지난다: 카탈로그 게시 → 항목 작성 → 제출 → (작성자와 다른 RV) 승인 → 묶음 게시 → PO 범위 지정.
// 저장소에 승인 상태나 지문을 직접 넣는 길은 만들지 않는다. 모든 id·금액·코드는 시험용 가짜 값이다.

export const GEN = 'GEN4_C4';
export const INSURER = 'NON_LIFE';

/** 치료 둘(각 10,000원)과 공통 기본비용(5,000원)의 합 = 예상 병원 결제액 T. */
export const FULL_HOSPITAL_PAYMENT = 25_000;

export interface MappingPlan {
  /** 매핑의 대상(치료 id 또는 공통 기본비용의 안정 식별자). */
  target: string;
  kind: 'COVERED' | 'EXCLUDED';
  origin?: Origin;
}

export interface SpecPlan {
  /** 항목 id 에 붙이는 접미어. 같은 세계에 둘째 묶음을 게시할 때 항목 id 가 겹치지 않게 한다. */
  idSuffix?: string;
  profileOrigin?: Origin;
  /** null 이면 서류 규칙 묶음을 담지 않는다. */
  ruleSetOrigin?: Origin | null;
  mappings?: MappingPlan[];
}

/** 기본 매핑: 치료 둘과 공통 기본비용 모두 COVERED. */
export const DEFAULT_MAPPINGS: MappingPlan[] = [
  { target: T1, kind: 'COVERED' },
  { target: T2, kind: 'COVERED' },
  { target: BASE_FEE_ID, kind: 'COVERED' },
];

function mappingContentOf(plan: MappingPlan, suffix: string): MappingContent {
  const id = `TEST_FIXTURE_MAPPING_${plan.target}${suffix}`;
  const origin = plan.origin === undefined ? {} : { origin: plan.origin };
  if (plan.kind === 'COVERED') {
    return mappingRecord(plan.target, { id, ...origin }).content;
  }
  const { state: _state, approver: _approver, approvedFingerprint: _fingerprint, ...content } = makeExcludedMapping(plan.target, { id, ...origin });
  return content;
}

/** 규칙 묶음 내용: 프로필 하나(GEN4_C4 · NON_LIFE 칸), 계획한 매핑들, 서류 규칙 묶음. */
export function specOf(plan: SpecPlan = {}): BundleSpec {
  const suffix = plan.idSuffix ?? '';
  const profileOrigin = plan.profileOrigin === undefined ? {} : { origin: plan.profileOrigin };
  const ruleSetOrigin = plan.ruleSetOrigin === undefined || plan.ruleSetOrigin === null ? {} : { origin: plan.ruleSetOrigin };
  return {
    profiles: [profileRecord({ id: `TEST_FIXTURE_PROFILE_1${suffix}`, ...profileOrigin }).content],
    mappings: (plan.mappings ?? DEFAULT_MAPPINGS).map((mapping) => mappingContentOf(mapping, suffix)),
    documentRuleSet: plan.ruleSetOrigin === null ? null : documentRuleSetRecord({ id: `TEST_FIXTURE_DOCUMENT_RULE_SET_1${suffix}`, ...ruleSetOrigin }).content,
  };
}

export interface WorldPlan {
  treatments?: TreatmentVersion[];
  fees?: CommonBaseFee[];
  /** undefined 이면 기본 규칙 묶음, null 이면 묶음을 게시하지 않는다(규칙 사용 범위 없음). */
  spec?: BundleSpec | null;
}

export interface EstimateWorld {
  world: World;
  catalog: CatalogVersion;
  /** 규칙 묶음을 게시하지 않은 세계에서는 null. */
  bundle: RuleBundleVersion | null;
}

/** 병원 1 에 카탈로그(치료 둘 + 공통 기본비용 하나)와 규칙 묶음을 서비스 경로로 만들고 범위를 지정한 세계. */
export function buildWorld(plan: WorldPlan = {}): EstimateWorld {
  const world = catalogWorld();
  const catalog = publishCatalogOf(world, {
    treatmentVersions: plan.treatments ?? validCatalogRequest().treatmentVersions,
    commonBaseFees: plan.fees ?? [makeBaseFeeVersion(1)],
  });
  const spec = plan.spec === undefined ? specOf() : plan.spec;
  const bundle = spec === null ? null : publishAndAssign(world, approveSpec(world, spec));
  return { world, catalog, bundle };
}

/** 모든 출처가 OPERATING 인 세계를 만들고 한 군데씩만 출처를 바꾸기 위한 계획. */
export type OriginSlot = 'profile' | 'mappingT1' | 'mappingT2' | 'mappingFee' | 'ruleSet' | 'treatments' | 'baseFee';
export const ORIGIN_SLOTS: readonly OriginSlot[] = ['profile', 'mappingT1', 'mappingT2', 'mappingFee', 'ruleSet', 'treatments', 'baseFee'];

export function originWorld(overrides: Partial<Record<OriginSlot, Origin>> = {}): EstimateWorld {
  const origin = (slot: OriginSlot): Origin => overrides[slot] ?? 'OPERATING';
  return buildWorld({
    treatments: validCatalogRequest(origin('treatments')).treatmentVersions,
    fees: [makeBaseFeeVersion(1, { origin: origin('baseFee') })],
    spec: specOf({
      profileOrigin: origin('profile'),
      ruleSetOrigin: origin('ruleSet'),
      mappings: [
        { target: T1, kind: 'COVERED', origin: origin('mappingT1') },
        { target: T2, kind: 'COVERED', origin: origin('mappingT2') },
        { target: BASE_FEE_ID, kind: 'COVERED', origin: origin('mappingFee') },
      ],
    }),
  });
}

/** 병원 1 의 현재 버전을 담은 올바른 요청 본문. overrides 로 필드를 바꾸거나(undefined 면 키를 뺀다) 덧붙인다. */
export function requestBody(w: Pick<EstimateWorld, 'catalog' | 'bundle'>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    catalogVersion: w.catalog.id,
    ruleBundleVersion: w.bundle === null ? null : w.bundle.id,
    generation: GEN,
    insurerType: INSURER,
    cause: 'UNKNOWN',
    treatmentIds: [T1, T2],
    ...overrides,
  };
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) delete body[key];
  }
  return body;
}

export { TEST_FIXTURE_CLINIC_ID };
