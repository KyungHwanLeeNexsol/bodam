import type { ItemTransitionInput, ItemVersionRef } from '../../../src/server/domain/items';
import { createMemoryRepository } from '../../../src/server/repo/memory/memory-repository';
import type { MemoryRepository } from '../../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_RV_AUTHOR } from './actors.fixture';
import {
  TEST_FIXTURE_NOW,
  makeAuditEntry,
  makeBundleVersion,
  makeCatalogVersion,
  makeClinic,
  makeCommonBaseFee,
  makeIdlePolicy,
  makeInsurer,
  makePolicySource,
  makeReviewRequest,
  makeScope,
  makeStatusEvent,
  makeTreatment,
  makeTreatmentVersion,
} from './entities.fixture';
import { documentRuleSetRecord, mappingRecord, profileRecord } from './items.fixture';

// 시험 자료(TEST_FIXTURE). 메모리 저장소를 만들고, 저장소 전체 상태를 비교용 값으로 떠 내는 도우미다.

export function newRepo(): MemoryRepository {
  return createMemoryRepository();
}

/**
 * 저장소 전체(모든 엔티티·상태 기록·감사 기록·묶음 상태 사건)의 깊은 복사본.
 * 거절 경로의 "저장소 전후 비교가 같다"를 `expect(snapshotOf(repo)).toEqual(before)` 로 확인한다.
 * 읽기 감시 카운터는 저장소 상태가 아니므로 포함하지 않는다.
 */
export function snapshotOf(repo: MemoryRepository): Record<string, unknown> {
  return repo.exportState();
}

export function transitionInput(overrides: Partial<ItemTransitionInput> = {}): ItemTransitionInput {
  return {
    from: null,
    to: 'DRAFT',
    actor: { ...TEST_FIXTURE_RV_AUTHOR },
    at: TEST_FIXTURE_NOW,
    reason: null,
    approverAfter: null,
    approvedFingerprintAfter: null,
    ...overrides,
  };
}

export interface SeededWorld {
  profileRef: ItemVersionRef;
  mappingRef: ItemVersionRef;
  documentRuleSetRef: ItemVersionRef;
  clinicId: string;
  bundleId: string;
}

/** 모든 엔티티 종류를 한 건 이상 담은 저장소 상태를 만든다. 거절 경로의 전후 비교가 의미 있도록 일부러 채운다. */
export function seedWorld(repo: MemoryRepository): SeededWorld {
  const profile = profileRecord();
  const mapping = mappingRecord();
  const rules = documentRuleSetRecord();
  repo.transaction(() => {
    repo.saveClinic(makeClinic());
    repo.saveTreatment(makeTreatment());
    repo.putTreatmentVersion(makeTreatmentVersion());
    repo.putCommonBaseFee(makeCommonBaseFee());
    repo.putCatalogVersion(makeCatalogVersion());
    repo.saveClinic(makeClinic({ currentCatalogVersionId: makeCatalogVersion().id }));
    repo.saveInsurer(makeInsurer());
    repo.putPolicySource(makePolicySource());
    for (const record of [profile, mapping, rules]) {
      repo.putItemVersion(record);
      repo.recordItemTransition(record.ref, transitionInput());
    }
    repo.putRuleBundleVersion(makeBundleVersion({ itemRefs: [profile.ref, mapping.ref, rules.ref] }));
    repo.appendBundleStatusEvent(makeStatusEvent());
    repo.assignClinicRuleScope(makeScope());
    repo.saveIdlePolicy(makeIdlePolicy());
    repo.saveCoverageReviewRequest(makeReviewRequest());
    repo.appendAuditLog(makeAuditEntry());
  });
  return {
    profileRef: profile.ref,
    mappingRef: mapping.ref,
    documentRuleSetRef: rules.ref,
    clinicId: TEST_FIXTURE_CLINIC_ID,
    bundleId: makeBundleVersion().id,
  };
}
