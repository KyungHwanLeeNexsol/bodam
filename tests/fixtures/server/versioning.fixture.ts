import type { PublishedLine, RuleBundleSnapshot } from '../../../src/engine/types';
import { approve, submitForReview } from '../../../src/server/approval';
import { createDraft } from '../../../src/server/authoring';
import { publishCatalog } from '../../../src/server/catalog-publish';
import { publishRuleBundle } from '../../../src/server/bundle-publish';
import type { Actor } from '../../../src/server/domain/actor';
import type { CatalogVersion, RuleBundleVersion, TreatmentVersion } from '../../../src/server/domain/entities';
import type { DocumentRuleSetRecordContent, ItemContentByKind, ItemKind, ItemVersionRecordOf, ItemVersionRef, MappingContent, ProfileContent } from '../../../src/server/domain/items';
import { toEngineDocumentRuleSet, toEngineMapping, toEngineProfile } from '../../../src/server/domain/projection';
import { coverageFingerprintOf } from '../../../src/server/fingerprint';
import type { CatalogPublishConfig } from '../../../src/server/publish-validate';
import type { MemoryRepository } from '../../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from './actors.fixture';
import { makeClinic, makeTreatment, makeTreatmentVersion } from './entities.fixture';
import { baseContent, newWorld, seedTreatment } from './lifecycle.fixture';
import type { World } from './lifecycle.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from './publish.fixture';
import type { CatalogRequestFixture } from './publish.fixture';

// 시험 자료(TEST_FIXTURE). 게시 서비스(M3.D1) 시험이 쓰는 세계: 카탈로그 세계, 규칙 묶음 세계, 엔진 연동 도우미.
// 모든 주체·id 는 시험용 가짜 값이며 실제 운영 계정·승인 기록이 아니다. 묶음 게시자는 작성자·승인자와 다른 RV 시험 주체다.

/** 규칙 묶음을 게시하는 RV 시험 주체 (작성자·승인자와 다르다). */
export const TEST_FIXTURE_RV_PUBLISHER: Actor = { id: 'TEST_FIXTURE_RV_PUBLISHER', role: 'RV' };

// ───────────────────────── 카탈로그 세계 ─────────────────────────

/** 병원 하나와 치료 둘(TEST_FIXTURE_TREATMENT_1·2). 카탈로그는 아직 게시되지 않았다. */
export function catalogWorld(): World {
  const world = newWorld();
  world.repo.saveClinic(makeClinic());
  world.repo.saveTreatment(makeTreatment());
  world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_2' }));
  return world;
}

/** 병원 둘째와 그 병원의 치료 하나. 다른 병원의 자료를 가리키는 거절 시험용. */
export const OTHER_CLINIC_ID = 'TEST_FIXTURE_CLINIC_2';
export const OTHER_CLINIC_TREATMENT_ID = 'TEST_FIXTURE_OTHER_TREATMENT_1';
export function addOtherClinic(repo: MemoryRepository): void {
  repo.saveClinic(makeClinic({ id: OTHER_CLINIC_ID, slug: 'test-fixture-clinic-2' }));
  repo.saveTreatment(makeTreatment({ id: OTHER_CLINIC_TREATMENT_ID, clinicId: OTHER_CLINIC_ID }));
}

/** 치료 하나(TREATMENT_1)와 기본비용 하나만 담은 카탈로그 요청. 치료 버전의 필드를 바꾸려면 overrides 를 넘긴다. */
export function singleTreatmentRequest(overrides: Partial<TreatmentVersion> = {}): CatalogRequestFixture {
  const full = validCatalogRequest();
  return {
    treatmentVersions: [makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1', ...overrides })],
    commonBaseFees: [full.commonBaseFees[0]!],
  };
}

export function publishCatalogOf(
  world: World,
  request: CatalogRequestFixture = validCatalogRequest(),
  config: CatalogPublishConfig = TEST_CATALOG_CONFIG,
  actor: Actor = TEST_FIXTURE_HA_1,
): CatalogVersion {
  return publishCatalog(world.deps, actor, TEST_FIXTURE_CLINIC_ID, request, config);
}

// ───────────────────────── 규칙 묶음 세계 ─────────────────────────

export interface BundleSpec {
  profiles: ProfileContent[];
  mappings: MappingContent[];
  documentRuleSet: DocumentRuleSetRecordContent | null;
}

export interface BundleRefs {
  profiles: ItemVersionRef[];
  mappings: ItemVersionRef[];
  documentRuleSet: ItemVersionRef | null;
}

/** 병원·치료 하나(TEST_FIXTURE_TREATMENT_1)·치료 버전 하나·카탈로그 하나가 저장소에 있는 세계 (매핑 승인이 지문을 고정할 수 있다). */
export function bundleWorld(): World {
  const world = newWorld();
  seedTreatment(world.repo);
  return world;
}

/** n 번째 올바른 묶음 내용: 프로필(GEN4_C4 · NON_LIFE 칸) 하나, COVERED 매핑 하나(치료 1), 서류 규칙 묶음 하나. */
export function validSpec(n = 1): BundleSpec {
  return {
    profiles: [baseContent('PROFILE', n)],
    mappings: [baseContent('MAPPING', n)],
    documentRuleSet: baseContent('DOCUMENT_RULE_SET', n),
  };
}

function approvedRef<K extends ItemKind>(world: World, kind: K, content: ItemContentByKind[K]): ItemVersionRef {
  const ref = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, content).ref;
  submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, ref);
  approve(world.deps, TEST_FIXTURE_RV_APPROVER, ref);
  return ref;
}

/** 내용마다 서비스 경로(작성 → 제출 → 승인)로 APPROVED 항목을 만들고 요청용 참조를 돌려준다. */
export function approveSpec(world: World, spec: BundleSpec): BundleRefs {
  return {
    profiles: spec.profiles.map((content) => approvedRef(world, 'PROFILE', content)),
    mappings: spec.mappings.map((content) => approvedRef(world, 'MAPPING', content)),
    documentRuleSet: spec.documentRuleSet === null ? null : approvedRef(world, 'DOCUMENT_RULE_SET', spec.documentRuleSet),
  };
}

export function publishRefs(world: World, refs: unknown, actor: Actor = TEST_FIXTURE_RV_PUBLISHER): RuleBundleVersion {
  return publishRuleBundle(world.deps, actor, refs);
}

/** n 번째 올바른 묶음을 만들어 게시한다. */
export function publishedBundleOf(world: World, n = 1): { bundle: RuleBundleVersion; refs: BundleRefs } {
  const refs = approveSpec(world, validSpec(n));
  return { bundle: publishRefs(world, refs), refs };
}

// ───────────────────────── 엔진 연동 ─────────────────────────

/** 저장된 게시 묶음을 엔진 입력(RuleBundleSnapshot)으로 조립한다: 바뀌지 않는 내용 + 방금 읽은 상태 + 방금 읽은 가용성. */
export function engineSnapshotOf(repo: MemoryRepository, bundleId: string): RuleBundleSnapshot {
  const bundle = repo.getRuleBundleVersion(bundleId);
  const status = repo.getBundleStatus(bundleId);
  if (bundle === null || status === null) {
    throw new Error(`TEST_FIXTURE: 묶음 ${bundleId} 이(가) 없다`);
  }
  const states = repo.readItemStates(bundle.itemRefs);
  const snapshot: RuleBundleSnapshot = { id: bundle.id, contentHash: bundle.contentHash, status, profiles: [], mappings: [], documentRuleSet: null };
  bundle.itemRefs.forEach((ref, index) => {
    const record = repo.getItemVersion(ref);
    const state = states[index];
    if (record === null || state === null || state === undefined) {
      throw new Error(`TEST_FIXTURE: 항목 ${ref.kind}/${ref.id}/${ref.version} 의 내용 또는 상태가 없다`);
    }
    if (ref.kind === 'PROFILE') {
      snapshot.profiles.push(toEngineProfile(record as ItemVersionRecordOf<'PROFILE'>, state));
    } else if (ref.kind === 'MAPPING') {
      snapshot.mappings.push(toEngineMapping(record as ItemVersionRecordOf<'MAPPING'>, state));
    } else {
      snapshot.documentRuleSet = toEngineDocumentRuleSet(record as ItemVersionRecordOf<'DOCUMENT_RULE_SET'>, state);
    }
  });
  return snapshot;
}

/** 치료 버전에서 엔진의 게시 줄을 만든다 (지문은 치료 버전의 보장 판단 필드에서 나온다). */
export function lineOfVersion(version: TreatmentVersion): PublishedLine {
  return {
    treatmentId: version.treatmentId,
    treatmentVersionId: version.id,
    displayName: version.displayName,
    benefitType: version.benefitType,
    calcClass: version.calcClass,
    patientAmount: version.patientAmount,
    coverageFingerprint: coverageFingerprintOf(version),
    isBaseFee: false,
    documentFlags: { ...version.documentFlags },
    origin: version.origin,
  };
}

export { TEST_FIXTURE_CLINIC_ID };
