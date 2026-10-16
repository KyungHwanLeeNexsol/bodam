import type { LifecycleState } from '../../../src/engine/types';
import { approve, markPublished, submitForReview } from '../../../src/server/approval';
import { createDraft } from '../../../src/server/authoring';
import type { ServiceDeps } from '../../../src/server/deps';
import type { Actor } from '../../../src/server/domain/actor';
import type { CatalogVersion, TreatmentVersion } from '../../../src/server/domain/entities';
import type { ItemContentByKind, ItemKind, ItemVersionRef } from '../../../src/server/domain/items';
import type { MemoryRepository } from '../../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from './actors.fixture';
import { makeCatalogVersion, makeClinic, makeTreatment, makeTreatmentVersion } from './entities.fixture';
import { CounterIdGenerator, FixedClock } from './clock.fixture';
import { documentRuleSetRecord, mappingRecord, profileRecord } from './items.fixture';
import { newRepo } from './repo.fixture';

// 시험 자료(TEST_FIXTURE). 생명주기 서비스 시험이 쓰는 세계(저장소·시계·식별자 생성기)와 항목을 원하는 상태로 데려가는 도우미.
// 서비스가 만든 항목은 서비스 경로(작성 → 제출 → 승인 → 게시)로, 서비스에 없는 상태는 저장소 원시 동작(forceState)으로 만든다.

export interface World {
  repo: MemoryRepository;
  clock: FixedClock;
  ids: CounterIdGenerator;
  deps: ServiceDeps;
}

export function newWorld(): World {
  const repo = newRepo();
  const clock = new FixedClock();
  const ids = new CounterIdGenerator();
  return { repo, clock, ids, deps: { repo, clock, ids } };
}

export const ITEM_KINDS: readonly ItemKind[] = ['PROFILE', 'MAPPING', 'DOCUMENT_RULE_SET'];

/** DD-17 생명주기의 아홉 상태. */
export const ALL_STATES: readonly LifecycleState[] = [
  'DRAFT',
  'REVIEW_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'UNDER_REREVIEW',
  'SUPERSEDED',
  'EXPIRED',
  'SUSPENDED',
];

export const TEST_FIXTURE_TREATMENT_ID = 'TEST_FIXTURE_TREATMENT_1';

/** n 번째 시험 항목의 내용 (id·version 은 n 으로 구분된다). 엔진 시험 자료의 내용을 재사용한다. */
export function baseContent<K extends ItemKind>(kind: K, n = 1, treatmentId = TEST_FIXTURE_TREATMENT_ID): ItemContentByKind[K] {
  const id = `TEST_FIXTURE_${kind}_${n}`;
  switch (kind) {
    case 'PROFILE':
      return profileRecord({ id }).content as ItemContentByKind[K];
    case 'MAPPING':
      return mappingRecord(treatmentId, { id }).content as ItemContentByKind[K];
    default:
      return documentRuleSetRecord({ id }).content as ItemContentByKind[K];
  }
}

/** 병원·치료·치료 버전 하나·그것을 담은 현재 카탈로그 버전. 매핑 승인이 지문을 고정하는 데 필요하다. */
export function seedTreatment(repo: MemoryRepository, version: Partial<TreatmentVersion> = {}): { treatmentVersion: TreatmentVersion; catalog: CatalogVersion } {
  const treatmentVersion = makeTreatmentVersion(version);
  repo.saveClinic(makeClinic());
  repo.saveTreatment(makeTreatment());
  repo.putTreatmentVersion(treatmentVersion);
  const catalog = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_1', treatmentVersionIds: [treatmentVersion.id], baseFeeIds: [] });
  repo.putCatalogVersion(catalog);
  repo.saveClinic(makeClinic({ currentCatalogVersionId: catalog.id }));
  return { treatmentVersion, catalog };
}

let adoptCounter = 0;

/** 치료 버전을 쓰고 그것을 (같은 치료의 옛 버전 대신) 담은 새 카탈로그 버전을 병원의 현재 값으로 만든다. */
export function adoptTreatmentVersion(repo: MemoryRepository, version: TreatmentVersion): CatalogVersion {
  adoptCounter += 1;
  repo.putTreatmentVersion(version);
  const current = repo.getClinicCurrentCatalogVersion(makeClinic().id);
  const kept = (current?.treatmentVersionIds ?? []).filter((id) => repo.getTreatmentVersion(id)?.treatmentId !== version.treatmentId);
  const catalog = makeCatalogVersion({ id: `TEST_FIXTURE_CATALOG_ADOPT_${adoptCounter}`, treatmentVersionIds: [...kept, version.id], baseFeeIds: [] });
  repo.putCatalogVersion(catalog);
  repo.saveClinic(makeClinic({ currentCatalogVersionId: catalog.id }));
  return catalog;
}

/** 서비스 경로로 만든 초안 (작성자 = author). */
export function draftOf(world: World, kind: ItemKind, n = 1, author: Actor = TEST_FIXTURE_RV_AUTHOR): ItemVersionRef {
  return createDraft(world.deps, author, kind, baseContent(kind, n)).ref;
}

export function reviewRequestedOf(world: World, kind: ItemKind, n = 1): ItemVersionRef {
  const ref = draftOf(world, kind, n);
  submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, ref);
  return ref;
}

export function approvedOf(world: World, kind: ItemKind, n = 1, approver: Actor = TEST_FIXTURE_RV_APPROVER): ItemVersionRef {
  const ref = reviewRequestedOf(world, kind, n);
  approve(world.deps, approver, ref);
  return ref;
}

export function publishedOf(world: World, kind: ItemKind, n = 1): ItemVersionRef {
  const ref = approvedOf(world, kind, n);
  markPublished(world.deps, TEST_FIXTURE_RV_APPROVER, ref);
  return ref;
}

/**
 * 전이 표를 보지 않고 저장소 원시 동작으로 항목을 to 상태에 놓는다 (서비스에 없는 길을 시험하기 위한 도우미).
 * 승인자·고정 지문은 그대로 이어 간다.
 */
export function forceState(repo: MemoryRepository, ref: ItemVersionRef, to: LifecycleState): void {
  const current = repo.getItemState(ref);
  repo.recordItemTransition(ref, {
    from: current?.state ?? null,
    to,
    actor: { ...TEST_FIXTURE_RV_AUTHOR },
    at: 'TEST_FIXTURE_FORCED',
    reason: null,
    approverAfter: current?.approver ?? null,
    approvedFingerprintAfter: current?.approvedFingerprint ?? null,
  });
}

/** 서비스로 만든 초안을 state 에 데려간다 (DRAFT 면 그대로). */
export function itemInState(world: World, kind: ItemKind, state: LifecycleState, n = 1): ItemVersionRef {
  const ref = draftOf(world, kind, n);
  if (state !== 'DRAFT') {
    forceState(world.repo, ref, state);
  }
  return ref;
}

export function auditActions(repo: MemoryRepository): string[] {
  return repo.listAuditLog().map((entry) => entry.action);
}
