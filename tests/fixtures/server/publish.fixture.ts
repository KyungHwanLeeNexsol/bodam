import type { DocumentRule, DocumentRuleSet, Origin, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../../src/engine/types';
import { documentRuleSetContent, profileContent } from '../../../src/engine/usability';
import { canonicalDigest } from '../../../src/server/digest';
import type { CommonBaseFee, TreatmentVersion } from '../../../src/server/domain/entities';
import type { ItemVersionRef } from '../../../src/server/domain/items';
import type { BundleItemResolver, CatalogPublishConfig } from '../../../src/server/publish-validate';
import { planningExampleRuleSet, ruleSetOf } from '../engine/document-rules.fixture';
import { makeExcludedMapping, makeMapping } from '../engine/mappings.fixture';
import { makeProfile, testGroups } from '../engine/profiles.fixture';
import { makeCommonBaseFee, makeTreatmentVersion } from './entities.fixture';

// 시험 자료(TEST_FIXTURE). 게시 검증기(M3.C) 시험이 쓰는 올바른 카탈로그 요청과 올바른 규칙 묶음.
// 엔진 시험 자료의 내용을 재사용하고, 내용 해시만 운영 해시(canonicalDigest)로 다시 봉인한다.
// 모든 id·이름·금액은 시험용 가짜 값이며 어떤 운영 자료와도 관계가 없다.

// ───────────────────────── 카탈로그 ─────────────────────────

export const OPERATING_CATALOG_CONFIG: CatalogPublishConfig = { acceptedLineOrigins: ['OPERATING'] };
export const TEST_CATALOG_CONFIG: CatalogPublishConfig = { acceptedLineOrigins: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] };

export interface CatalogRequestFixture {
  treatmentVersions: TreatmentVersion[];
  commonBaseFees: CommonBaseFee[];
}

/** 올바른 카탈로그 요청: 치료 버전 둘(서로 다른 treatmentId)과 공통 기본비용 둘. 출처를 바꾸려면 origin 을 넘긴다. */
export function validCatalogRequest(origin: Origin = 'TEST_FIXTURE'): CatalogRequestFixture {
  return {
    treatmentVersions: [
      makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1', treatmentId: 'TEST_FIXTURE_TREATMENT_1', origin }),
      makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentId: 'TEST_FIXTURE_TREATMENT_2', origin, benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT' }),
    ],
    commonBaseFees: [
      makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_1', origin }),
      makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_2', origin, amount: 0 }),
    ],
  };
}

// ───────────────────────── 규칙 묶음 ─────────────────────────

/** 엔진 형식으로 합쳐진 묶음 항목(내용 + 방금 읽은 상태). 검증기의 해석기가 돌려주는 값이다. */
export interface BundleItems {
  profiles: StandardAssumptionProfile[];
  mappings: TreatmentCoverageMapping[];
  documentRuleSet: DocumentRuleSet | null;
}

/** 운영 해시로 봉인한 프로필. contentHash 를 직접 넘기면 그 값을 그대로 둔다(불일치 시험). */
export function sealedProfile(overrides: Partial<StandardAssumptionProfile> = {}): StandardAssumptionProfile {
  const base = makeProfile({ ...overrides, contentHash: overrides.contentHash ?? '' });
  return overrides.contentHash === undefined ? { ...base, contentHash: canonicalDigest(profileContent(base)) } : base;
}

/** 운영 해시로 봉인한 서류 규칙 묶음. rules 를 넘기지 않으면 기획서 예시 규칙을 쓴다. */
export function sealedRuleSet(rules?: DocumentRule[], overrides: Partial<DocumentRuleSet> = {}): DocumentRuleSet {
  const hash = overrides.contentHash ?? '';
  const base = rules === undefined ? planningExampleRuleSet({ ...overrides, contentHash: hash }) : ruleSetOf(rules, { ...overrides, contentHash: hash });
  return overrides.contentHash === undefined ? { ...base, contentHash: canonicalDigest(documentRuleSetContent(base)) } : base;
}

/** 올바른 묶음: 프로필 하나(GEN4_C4 · NON_LIFE 칸), 매핑 둘(COVERED 하나, EXCLUDED 하나), 서류 규칙 묶음 하나. */
export function validBundleItems(): BundleItems {
  return {
    profiles: [sealedProfile()],
    mappings: [makeMapping('TEST_FIXTURE_TREATMENT_1'), makeExcludedMapping('TEST_FIXTURE_TREATMENT_2')],
    documentRuleSet: sealedRuleSet(),
  };
}

export function profileRef(item: { id: string; version: string }): ItemVersionRef {
  return { kind: 'PROFILE', id: item.id, version: item.version };
}
export function mappingRef(item: { id: string; version: string }): ItemVersionRef {
  return { kind: 'MAPPING', id: item.id, version: item.version };
}
export function ruleSetRef(item: { id: string; version: string }): ItemVersionRef {
  return { kind: 'DOCUMENT_RULE_SET', id: item.id, version: item.version };
}

/** 항목 목록을 참조 목록 요청으로 바꾼다. 참조는 항목의 id·version 에서 만든다. */
export function requestOf(items: BundleItems): { profiles: ItemVersionRef[]; mappings: ItemVersionRef[]; documentRuleSet: ItemVersionRef | null } {
  return {
    profiles: items.profiles.map(profileRef),
    mappings: items.mappings.map(mappingRef),
    documentRuleSet: items.documentRuleSet === null ? null : ruleSetRef(items.documentRuleSet),
  };
}

function key(ref: ItemVersionRef): string {
  return `${ref.kind}/${ref.id}/${ref.version}`;
}

/**
 * 항목 목록으로 해석기를 만든다. 같은 (종류, id, version) 이 여럿이면 첫 번째를 준다.
 * 호출을 기록하므로 시험이 "형식이 틀린 참조로는 해석기를 부르지 않는다"를 확인할 수 있다.
 */
export function resolverOf(items: BundleItems): BundleItemResolver & { calls: ItemVersionRef[] } {
  const calls: ItemVersionRef[] = [];
  const index = new Map<string, unknown>();
  for (const item of items.profiles) {
    if (!index.has(key(profileRef(item)))) index.set(key(profileRef(item)), item);
  }
  for (const item of items.mappings) {
    if (!index.has(key(mappingRef(item)))) index.set(key(mappingRef(item)), item);
  }
  if (items.documentRuleSet !== null) {
    index.set(key(ruleSetRef(items.documentRuleSet)), items.documentRuleSet);
  }
  const lookup = (ref: ItemVersionRef): unknown => {
    calls.push(ref);
    return index.get(key(ref)) ?? null;
  };
  return {
    calls,
    profile: (ref) => lookup(ref) as StandardAssumptionProfile | null,
    mapping: (ref) => lookup(ref) as TreatmentCoverageMapping | null,
    documentRuleSet: (ref) => lookup(ref) as DocumentRuleSet | null,
  };
}

/** 같은 칸에 프로필 하나 더, 두 번째 칸에 프로필, 다른 모양의 서류 규칙 묶음처럼 시험이 자주 쓰는 두 번째 항목. */
export function secondProfile(overrides: Partial<StandardAssumptionProfile> = {}): StandardAssumptionProfile {
  return sealedProfile({ id: 'TEST_PROFILE_2', generation: 'GEN3_C3', ...overrides });
}

export { testGroups };
