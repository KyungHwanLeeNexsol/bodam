import { describe, expect, it } from 'vitest';
import { approve, submitForReview } from '../../src/server/approval';
import { createDraft } from '../../src/server/authoring';
import { publishBundleFromBase, previewBundlePublish } from '../../src/server/bundle-compose';
import { readBundlePublishOverview } from '../../src/server/bundle-overview';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { triggerReReviewForTarget } from '../../src/server/re-review';
import { repoWith } from '../api/helpers';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { T3, approvedMapping, composeWorld } from '../fixtures/server/bundle-compose.fixture';
import { makeReviewRequest, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from '../fixtures/server/governance.fixture';
import { mappingRecord } from '../fixtures/server/items.fixture';
import { adoptTreatmentVersion, forceState } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import { OTHER_CLINIC_ID, TEST_FIXTURE_RV_PUBLISHER } from '../fixtures/server/versioning.fixture';

// 묶음 게시 화면의 읽기 보기 (readBundlePublishOverview): 고를 수 있는 기준 묶음과 승인된 매핑 후보. 읽기만 하고, 읽지 못하는 한 건 때문에 던지지 않는다.

describe('readBundlePublishOverview: 기준 묶음', () => {
  it('게시된 묶음을 상태·게시 정보·항목 수·현재 범위가 가리키는 병원과 함께 낸다', () => {
    const { world, base } = composeWorld();

    const overview = readBundlePublishOverview(world.repo);

    expect(overview.bases).toEqual([
      {
        bundleId: base.id,
        status: 'ACTIVE',
        publishedAt: base.publishedAt,
        publishedBy: base.publishedBy.id,
        contentHash: base.contentHash,
        itemCounts: { profiles: 1, mappings: 3, documentRuleSets: 1 },
        clinics: [{ clinicId: TEST_FIXTURE_CLINIC_ID, slug: 'test-fixture-clinic-1' }],
      },
    ]);
    expect(overview.candidates).toEqual([]);
    expect(overview.unreadable).toEqual([]);
  });

  it('최신 묶음이 먼저 나오고, 중지된 묶음은 SUSPENDED 로 함께 나온다. 새 묶음은 아직 어느 병원에도 지정되지 않았다', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const confirmation = previewBundlePublish(world.deps, TEST_FIXTURE_RV_PUBLISHER, { baseBundleId: base.id, mappings: [added] }).publishConfirmation as string;
    const next = publishBundleFromBase(world.deps, TEST_FIXTURE_RV_PUBLISHER, { baseBundleId: base.id, mappings: [added], publishConfirmation: confirmation });
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, base.id, 'TEST_FIXTURE 중지');

    const { bases } = readBundlePublishOverview(world.repo);

    expect(bases.map((entry) => [entry.bundleId, entry.status, entry.clinics.length])).toEqual([
      [next.id, 'ACTIVE', 0],
      [base.id, 'SUSPENDED', 1],
    ]);
    expect(bases[0]?.itemCounts).toEqual({ profiles: 1, mappings: 4, documentRuleSets: 1 });
  });
});

describe('readBundlePublishOverview: 후보 매핑', () => {
  it('현재 APPROVED 인 매핑만 후보다 (초안·검토 요청·반려·이미 게시된 매핑은 아니다)', () => {
    const { world } = composeWorld();
    const approved = approvedMapping(world, 'TEST_FIXTURE_MAPPING_APPROVED');
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord(T3, { id: 'TEST_FIXTURE_MAPPING_DRAFT' }).content).ref;
    const requested = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord(T3, { id: 'TEST_FIXTURE_MAPPING_REQUESTED' }).content).ref;
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, requested);
    const rejected = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord(T3, { id: 'TEST_FIXTURE_MAPPING_REJECTED' }).content).ref;
    forceState(world.repo, rejected, 'REJECTED');
    const before = snapshotOf(world.repo);

    const { candidates } = readBundlePublishOverview(world.repo);

    expect(snapshotOf(world.repo)).toEqual(before);
    expect(candidates.map((candidate) => candidate.mappingRef)).toEqual([approved]);
    expect(candidates.map((candidate) => candidate.mappingRef.id)).not.toContain(draft.id);
  });

  it('후보 한 건: 치료 이름·병원, 범위·판정·유효 기간, 승인자, 고정 지문 상태(CURRENT), 검토 요청 연결, 들어 있는 묶음 없음', () => {
    const { world } = composeWorld();
    const ref = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    world.repo.saveCoverageReviewRequest(makeReviewRequest({ id: 'TEST_FIXTURE_REVIEW_REQUEST_T3', treatmentId: T3, status: 'APPROVED', draftMappingRef: ref, resultMappingRef: ref }));

    const { candidates } = readBundlePublishOverview(world.repo);

    expect(candidates).toEqual([
      {
        mappingRef: ref,
        treatmentId: T3,
        target: { kind: 'TREATMENT', displayName: 'TEST_FIXTURE 치료 3', clinicId: TEST_FIXTURE_CLINIC_ID, clinicSlug: 'test-fixture-clinic-1' },
        scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
        decision: 'COVERED',
        groupKey: 'TEST_GROUP_BENEFIT',
        exclusionReason: null,
        validity: { from: '2026-01-01', to: '2026-12-31' },
        approvedBy: TEST_FIXTURE_RV_APPROVER.id,
        approvedFingerprint: 'CURRENT',
        reviewRequestId: 'TEST_FIXTURE_REVIEW_REQUEST_T3',
        alreadyInBundles: [],
        readIssue: null,
      },
    ]);
  });

  it('치료의 보장 판단 필드가 승인 뒤에 바뀌었으면 STALE, 보장 대상 버전이 없으면 UNKNOWN(사유 포함)이다 — 후보에서 빼지 않는다', () => {
    const { world } = composeWorld();
    const stale = approvedMapping(world, 'TEST_FIXTURE_MAPPING_STALE_T3');
    const missing = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord('TEST_FIXTURE_TREATMENT_9', { id: 'TEST_FIXTURE_MAPPING_NO_TARGET' }).content).ref;
    forceState(world.repo, missing, 'APPROVED');
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3B', treatmentId: T3, treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));

    const { candidates } = readBundlePublishOverview(world.repo);

    const byId = new Map(candidates.map((candidate) => [candidate.mappingRef.id, candidate]));
    expect(byId.get(stale.id)).toMatchObject({ approvedFingerprint: 'STALE', readIssue: null });
    expect(byId.get(missing.id)).toMatchObject({ approvedFingerprint: 'UNKNOWN', readIssue: 'TARGET_VERSION_ABSENT', target: { kind: 'UNKNOWN', displayName: null } });
  });

  it('다시 승인돼 후보가 된 매핑은 이미 담긴 묶음 id 를 alreadyInBundles 로 알린다', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const choice = { baseBundleId: base.id, mappings: [added] };
    const next = publishBundleFromBase(world.deps, TEST_FIXTURE_RV_PUBLISHER, { ...choice, publishConfirmation: previewBundlePublish(world.deps, TEST_FIXTURE_RV_PUBLISHER, choice).publishConfirmation as string });
    expect(readBundlePublishOverview(world.repo).candidates).toEqual([]);

    triggerReReviewForTarget(world.deps, TEST_FIXTURE_RV_PUBLISHER, T3, 'TEST_FIXTURE_OTHER_FINGERPRINT');
    expect(world.repo.getItemState(added)?.state).toBe('UNDER_REREVIEW');
    approve(world.deps, TEST_FIXTURE_RV_APPROVER, added);

    const { candidates } = readBundlePublishOverview(world.repo);
    expect(candidates.map((candidate) => [candidate.mappingRef.id, candidate.alreadyInBundles])).toEqual([[added.id, [next.id]]]);
  });

  it('병원 2 치료의 매핑 후보는 병원 2 로 표시된다 (병원 1 의 자료와 섞이지 않는다)', () => {
    const { world } = composeWorld();
    const ref = approvedMapping(world, 'TEST_FIXTURE_MAPPING_OTHER', 'TEST_FIXTURE_OTHER_TREATMENT_1');

    const { candidates } = readBundlePublishOverview(world.repo);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ mappingRef: ref, target: { kind: 'TREATMENT', clinicId: OTHER_CLINIC_ID, clinicSlug: 'test-fixture-clinic-2' } });
  });

  it('한 건의 상태를 읽지 못해도 던지지 않고 unreadable 에 이유와 함께 남긴다 (없는 것처럼 숨기지 않는다). 나머지 후보는 그대로 나온다', () => {
    const { world } = composeWorld();
    const good = approvedMapping(world, 'TEST_FIXTURE_MAPPING_GOOD');
    const broken = approvedMapping(world, 'TEST_FIXTURE_MAPPING_BROKEN', T3, { scope: [{ generation: 'GEN1_AS', insurerType: 'LIFE' }] });
    const lying = repoWith(world.repo, {
      readItemStates: (refs: Array<{ id: string }>) => {
        if (refs.some((ref) => ref.id === broken.id)) {
          throw new Error('TEST_FIXTURE: 상태를 읽을 수 없다');
        }
        return world.repo.readItemStates(refs as never);
      },
    } as never);

    const overview = readBundlePublishOverview(lying);

    expect(overview.candidates.map((candidate) => candidate.mappingRef.id)).toEqual([good.id]);
    expect(overview.unreadable).toEqual([{ ref: broken, reason: 'READ_FAILED' }]);
  });

  it('보장 대상을 읽다 실패하면 후보는 남기고 지문 상태를 UNKNOWN(TARGET_UNREADABLE)으로 표시한다', () => {
    const { world } = composeWorld();
    const ref = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const lying = repoWith(world.repo, {
      listTreatmentVersions: () => {
        throw new Error('TEST_FIXTURE: 치료 버전을 읽을 수 없다');
      },
    } as never);

    const { candidates, unreadable } = readBundlePublishOverview(lying);

    expect(unreadable).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ mappingRef: ref, approvedFingerprint: 'UNKNOWN', readIssue: 'TARGET_UNREADABLE', target: { kind: 'UNKNOWN', displayName: null } });
  });
});
