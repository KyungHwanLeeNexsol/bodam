import { describe, expect, it } from 'vitest';
import { createDraft } from '../../src/server/authoring';
import { computeBundlePublishConfirmation, previewBundlePublish, publishBundleFromBase } from '../../src/server/bundle-compose';
import type { BundleChoice } from '../../src/server/bundle-compose';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { canonicalDigest } from '../../src/server/digest';
import type { RuleBundleVersion } from '../../src/server/domain/entities';
import type { ItemVersionRef } from '../../src/server/domain/items';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { T1 } from '../fixtures/server/base-fee.fixture';
import { T3, approvedMapping, composeWorld } from '../fixtures/server/bundle-compose.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from '../fixtures/server/governance.fixture';
import { mappingRecord } from '../fixtures/server/items.fixture';
import { adoptTreatmentVersion } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import { OTHER_CLINIC_ID, TEST_FIXTURE_RV_PUBLISHER, publishRefs } from '../fixtures/server/versioning.fixture';

// 묶음 구성: 기준 묶음(ACTIVE) + 승인된 매핑 → 새 RuleBundleVersion (RV, 미리보기 → 게시). 게시는 어느 병원에도 범위를 지정하지 않는다.
// 모든 거절은 저장소 전체 비교가 같아야 한다(아무것도 쓰지 않는다). 모든 id·주체는 TEST_FIXTURE 다.

const RV = TEST_FIXTURE_RV_PUBLISHER;
const CELL = { generation: 'GEN4_C4', insurerType: 'NON_LIFE' } as const;
const OTHER_CELL = { generation: 'GEN1_AS', insurerType: 'LIFE' } as const;

const choice = (base: RuleBundleVersion, ...mappings: ItemVersionRef[]): BundleChoice => ({ baseBundleId: base.id, mappings });
const baseMappingRef = (base: RuleBundleVersion, treatmentId: string): ItemVersionRef => base.itemRefs.find((ref) => ref.kind === 'MAPPING' && ref.id === `TEST_FIXTURE_MAPPING_${treatmentId}`) as ItemVersionRef;
const newBundlesOf = (repo: ReturnType<typeof composeWorld>['world']['repo'], base: RuleBundleVersion) => repo.listRuleBundleVersions().filter((bundle) => bundle.id !== base.id);

describe('미리보기 (previewBundlePublish)', () => {
  it('기준 묶음의 항목 전부(BASE)와 고른 매핑(ADDED)을 요청 순서(프로필 → 매핑 → 서류 규칙 묶음)로 낸다. 결함·충돌이 없으면 확인값이 있고 저장소는 그대로다', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const before = snapshotOf(world.repo);

    const preview = previewBundlePublish(world.deps, RV, choice(base, added));

    expect(snapshotOf(world.repo)).toEqual(before);
    expect(preview.defects).toEqual([]);
    expect(preview.conflicts).toEqual([]);
    expect(preview.publishConfirmation).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.base).toEqual({ bundleId: base.id, status: 'ACTIVE', contentHash: base.contentHash, itemCount: base.itemRefs.length });
    expect(preview.items.map((item) => [item.kind, item.source, item.path])).toEqual([
      ['PROFILE', 'BASE', 'bundle.profiles[0]'],
      ['MAPPING', 'BASE', 'bundle.mappings[0]'],
      ['MAPPING', 'BASE', 'bundle.mappings[1]'],
      ['MAPPING', 'BASE', 'bundle.mappings[2]'],
      ['MAPPING', 'ADDED', 'bundle.mappings[3]'],
      ['DOCUMENT_RULE_SET', 'BASE', 'bundle.documentRuleSet'],
    ]);
    expect(preview.items.every((item) => item.state === 'PUBLISHED' || item.source === 'ADDED')).toBe(true);
    const addedItem = preview.items.find((item) => item.source === 'ADDED');
    expect(addedItem).toMatchObject({ id: added.id, version: added.version, state: 'APPROVED', label: { treatmentId: T3, decision: 'COVERED', scope: [CELL] } });
  });

  it('같은 입력이면 확인값이 같고, 고른 매핑의 순서는 확인값에 영향을 주지 않는다', () => {
    const { world, base } = composeWorld();
    const a = approvedMapping(world, 'TEST_FIXTURE_MAPPING_A', T3, { scope: [CELL] });
    const b = approvedMapping(world, 'TEST_FIXTURE_MAPPING_B', T3, { scope: [OTHER_CELL] });

    const first = previewBundlePublish(world.deps, RV, choice(base, a, b));
    const again = previewBundlePublish(world.deps, RV, choice(base, a, b));
    const swapped = previewBundlePublish(world.deps, RV, choice(base, b, a));

    expect(first.publishConfirmation).not.toBeNull();
    expect(again.publishConfirmation).toBe(first.publishConfirmation);
    expect(swapped.publishConfirmation).toBe(first.publishConfirmation);
  });

  it('확인값은 관리자·기준 묶음·고른 매핑에 묶인다', () => {
    const { world, base } = composeWorld();
    const a = approvedMapping(world, 'TEST_FIXTURE_MAPPING_A', T3, { scope: [CELL] });
    const b = approvedMapping(world, 'TEST_FIXTURE_MAPPING_B', T3, { scope: [OTHER_CELL] });
    const otherBase = publishRefs(world, { profiles: base.itemRefs.filter((r) => r.kind === 'PROFILE'), mappings: base.itemRefs.filter((r) => r.kind === 'MAPPING'), documentRuleSet: base.itemRefs.find((r) => r.kind === 'DOCUMENT_RULE_SET') ?? null });

    const mine = computeBundlePublishConfirmation(world.deps, RV, choice(base, a));
    expect(computeBundlePublishConfirmation(world.deps, { ...RV, id: 'TEST_FIXTURE_RV_OTHER' }, choice(base, a))).not.toBe(mine);
    expect(computeBundlePublishConfirmation(world.deps, RV, choice(base, b))).not.toBe(mine);
    expect(computeBundlePublishConfirmation(world.deps, RV, choice(base, a, b))).not.toBe(mine);
    expect(computeBundlePublishConfirmation(world.deps, RV, choice(otherBase, a))).not.toBe(mine);
  });

  it('같은 치료의 다른 칸 매핑은 충돌이 아니다 (칸이 겹치지 않는다)', () => {
    const { world, base } = composeWorld();
    const other = approvedMapping(world, 'TEST_FIXTURE_MAPPING_T1_OTHER_CELL', T1, { scope: [OTHER_CELL] });

    const preview = previewBundlePublish(world.deps, RV, choice(base, other));

    expect(preview.conflicts).toEqual([]);
    expect(preview.defects).toEqual([]);
    expect(preview.publishConfirmation).not.toBeNull();
  });

  it('기준 묶음의 매핑과 같은 치료·겹치는 칸이면 충돌로 낸다 (어느 기존 매핑과 겹치는지, 겹치는 칸만). 확인값은 없다', () => {
    const { world, base } = composeWorld();
    const clash = approvedMapping(world, 'TEST_FIXTURE_MAPPING_T1_CLASH', T1, { scope: [OTHER_CELL, CELL] });
    const before = snapshotOf(world.repo);

    const preview = previewBundlePublish(world.deps, RV, choice(base, clash));

    expect(snapshotOf(world.repo)).toEqual(before);
    expect(preview.conflicts).toEqual([
      { mappingRef: clash, path: 'mappings[0]', treatmentId: T1, conflictsWith: [{ ref: baseMappingRef(base, T1), source: 'BASE', cells: [CELL] }] },
    ]);
    expect(preview.publishConfirmation).toBeNull();
  });

  it('고른 매핑끼리 겹쳐도 충돌이다 (두 매핑 모두 보고한다)', () => {
    const { world, base } = composeWorld();
    const a = approvedMapping(world, 'TEST_FIXTURE_MAPPING_A', T3);
    const b = approvedMapping(world, 'TEST_FIXTURE_MAPPING_B', T3);

    const preview = previewBundlePublish(world.deps, RV, choice(base, a, b));

    expect(preview.conflicts.map((conflict) => [conflict.mappingRef.id, conflict.path, conflict.conflictsWith.map((other) => [other.ref.id, other.source])])).toEqual([
      ['TEST_FIXTURE_MAPPING_A', 'mappings[0]', [['TEST_FIXTURE_MAPPING_B', 'ADDED']]],
      ['TEST_FIXTURE_MAPPING_B', 'mappings[1]', [['TEST_FIXTURE_MAPPING_A', 'ADDED']]],
    ]);
    expect(preview.publishConfirmation).toBeNull();
  });

  it('승인되지 않은 매핑(초안)은 공유 판정의 결함 ITEM_STATE_NOT_PUBLISHABLE 로 나오고 확인값이 없다', () => {
    const { world, base } = composeWorld();
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord(T3, { id: 'TEST_FIXTURE_MAPPING_DRAFT' }).content).ref;

    const preview = previewBundlePublish(world.deps, RV, choice(base, draft));

    expect(preview.defects).toContainEqual({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: 'bundle.mappings[3].state' });
    expect(preview.items.find((item) => item.source === 'ADDED')?.state).toBe('DRAFT');
    expect(preview.publishConfirmation).toBeNull();
  });

  it('치료의 보장 판단 필드가 승인 뒤에 바뀌었으면 FINGERPRINT_STALE 이고 확인값이 없다', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3B', treatmentId: T3, treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));

    const preview = previewBundlePublish(world.deps, RV, choice(base, added));

    expect(preview.defects).toContainEqual({ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[3].approvedFingerprint' });
    expect(preview.publishConfirmation).toBeNull();
  });

  it('기준 묶음이 없으면 NOT_FOUND, 중지됐으면 BASE_BUNDLE_NOT_ACTIVE, 고른 매핑이 없으면 NOT_FOUND, 이미 기준 묶음에 있으면 MAPPING_ALREADY_IN_BASE', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const before = snapshotOf(world.repo);

    expect(catchDomainError(() => previewBundlePublish(world.deps, RV, { baseBundleId: 'TEST_FIXTURE_NO_SUCH_BUNDLE', mappings: [added] })).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => previewBundlePublish(world.deps, RV, choice(base, { kind: 'MAPPING', id: 'TEST_FIXTURE_NO_SUCH_MAPPING', version: 'v1' }))).code).toBe('NOT_FOUND');
    // 종류가 매핑이 아닌 항목 id 를 매핑으로 가리켜도 없는 것이다.
    const profileRef = base.itemRefs.find((ref) => ref.kind === 'PROFILE') as ItemVersionRef;
    expect(catchDomainError(() => previewBundlePublish(world.deps, RV, choice(base, { kind: 'MAPPING', id: profileRef.id, version: profileRef.version }))).code).toBe('NOT_FOUND');
    const inBase = catchDomainError(() => previewBundlePublish(world.deps, RV, choice(base, baseMappingRef(base, T1), added)));
    expect(inBase.code).toBe('STATE_CONFLICT');
    expect(inBase.defects).toEqual([{ code: 'MAPPING_ALREADY_IN_BASE', path: 'mappings[0]' }]);
    expect(snapshotOf(world.repo)).toEqual(before);

    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, base.id, 'TEST_FIXTURE 중지');
    const suspendedBefore = snapshotOf(world.repo);
    const suspended = catchDomainError(() => previewBundlePublish(world.deps, RV, choice(base, added)));
    expect(suspended.code).toBe('STATE_CONFLICT');
    expect(suspended.defects).toEqual([{ code: 'BASE_BUNDLE_NOT_ACTIVE', path: 'baseBundleId' }]);
    expect(snapshotOf(world.repo)).toEqual(suspendedBefore);
  });

  it.each([
    ['HA', TEST_FIXTURE_HA_1],
    ['PO', TEST_FIXTURE_PO_1],
  ])('%s 는 미리보기를 할 수 없다 (ROLE_NOT_PERMITTED, 저장소 그대로)', (_name, actor) => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => previewBundlePublish(world.deps, actor, choice(base, added))).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(world.repo)).toEqual(before);
  });
});

describe('게시 (publishBundleFromBase)', () => {
  it('기준 묶음의 항목 전부 + 고른 매핑으로 새 묶음을 만든다: 매핑은 PUBLISHED 가 되고, 기준 묶음·병원 범위는 그대로이며, 어느 병원에도 지정하지 않는다', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const preview = previewBundlePublish(world.deps, RV, choice(base, added));
    const baseBefore = world.repo.getRuleBundleVersion(base.id);
    const baseEventsBefore = world.repo.listBundleStatusEvents(base.id);
    const scopeBefore = {
      clinic1: world.repo.listClinicRuleScopeHistory('TEST_FIXTURE_CLINIC_1'),
      clinic2: world.repo.listClinicRuleScopeHistory(OTHER_CLINIC_ID),
    };
    const auditBefore = world.repo.listAuditLog().length;
    world.clock.set('2026-10-17T08:00:00.000Z');

    const bundle = publishBundleFromBase(world.deps, RV, { ...choice(base, added), publishConfirmation: preview.publishConfirmation as string });

    expect(bundle.id).not.toBe(base.id);
    expect(bundle.publishedBy).toEqual({ id: RV.id, role: 'RV' });
    expect(bundle.publishedAt).toBe('2026-10-17T08:00:00.000Z');
    expect(bundle.itemRefs).toHaveLength(base.itemRefs.length + 1);
    for (const ref of [...base.itemRefs, added]) {
      expect(bundle.itemRefs).toContainEqual(ref);
    }
    expect(bundle.contentHash).not.toBe(base.contentHash);
    expect(world.repo.getRuleBundleVersion(bundle.id)).toEqual(bundle);
    expect(world.repo.getBundleStatus(bundle.id)).toBe('ACTIVE');
    expect(world.repo.getItemState(added)?.state).toBe('PUBLISHED');

    // 기준 묶음과 그 병원의 범위는 건드리지 않았고, 새 묶음은 어느 병원에도 지정되지 않았다.
    expect(world.repo.getRuleBundleVersion(base.id)).toEqual(baseBefore);
    expect(world.repo.listBundleStatusEvents(base.id)).toEqual(baseEventsBefore);
    expect(world.repo.getClinicRuleScope('TEST_FIXTURE_CLINIC_1')?.ruleBundleVersionId).toBe(base.id);
    expect(world.repo.listClinicRuleScopeHistory('TEST_FIXTURE_CLINIC_1')).toEqual(scopeBefore.clinic1);
    expect(world.repo.listClinicRuleScopeHistory(OTHER_CLINIC_ID)).toEqual(scopeBefore.clinic2);
    expect(world.repo.getClinicRuleScope(OTHER_CLINIC_ID)).toBeNull();

    // 감사 기록: 묶음 게시 한 건(+ 매핑 게시 전이 한 건), 범위 지정은 없다.
    const added_ = world.repo.listAuditLog().slice(auditBefore).map((entry) => entry.action);
    expect(added_.filter((action) => action === 'BUNDLE_PUBLISH')).toHaveLength(1);
    expect(added_).not.toContain('CLINIC_SCOPE_ASSIGN');
    expect(world.repo.listAuditLog().filter((entry) => entry.action === 'BUNDLE_PUBLISH').at(-1)).toMatchObject({ target: `BUNDLE/${bundle.id}`, afterVersion: bundle.id, actorId: RV.id, role: 'RV' });
  });

  it('확인값이 없거나 다르거나 다른 관리자의 것이면 PREVIEW_REQUIRED 이고 아무것도 쓰지 않는다', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const real = previewBundlePublish(world.deps, RV, choice(base, added)).publishConfirmation as string;
    const others = computeBundlePublishConfirmation(world.deps, { ...RV, id: 'TEST_FIXTURE_RV_OTHER' }, choice(base, added));
    const before = snapshotOf(world.repo);

    for (const provided of ['', 'not-a-hash', real.replace(/.$/, real.endsWith('0') ? '1' : '0'), others, canonicalDigest('nothing')]) {
      const error = catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, added), publishConfirmation: provided }));
      expect(error.code, provided).toBe('STATE_CONFLICT');
      expect(error.defects, provided).toEqual([{ code: 'PREVIEW_REQUIRED', path: 'publishConfirmation' }]);
      expect(snapshotOf(world.repo), provided).toEqual(before);
    }
  });

  it('미리보기 뒤에 입력이 바뀌면(다른 매핑 집합·다른 기준 묶음·고른 매핑의 상태가 바뀜) 그 확인값으로 게시할 수 없다', () => {
    const { world, base } = composeWorld();
    const a = approvedMapping(world, 'TEST_FIXTURE_MAPPING_A', T3, { scope: [CELL] });
    const b = approvedMapping(world, 'TEST_FIXTURE_MAPPING_B', T3, { scope: [OTHER_CELL] });
    const confirmForA = previewBundlePublish(world.deps, RV, choice(base, a)).publishConfirmation as string;

    // 다른 매핑 집합
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, a, b), publishConfirmation: confirmForA })).defects).toEqual([{ code: 'PREVIEW_REQUIRED', path: 'publishConfirmation' }]);
    expect(catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, b), publishConfirmation: confirmForA })).defects).toEqual([{ code: 'PREVIEW_REQUIRED', path: 'publishConfirmation' }]);
    // 다른 기준 묶음 (항목 집합은 같다)
    const otherBase = publishRefs(world, { profiles: base.itemRefs.filter((r) => r.kind === 'PROFILE'), mappings: base.itemRefs.filter((r) => r.kind === 'MAPPING'), documentRuleSet: base.itemRefs.find((r) => r.kind === 'DOCUMENT_RULE_SET') ?? null });
    const afterOtherBase = snapshotOf(world.repo);
    expect(catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(otherBase, a), publishConfirmation: confirmForA })).defects).toEqual([{ code: 'PREVIEW_REQUIRED', path: 'publishConfirmation' }]);
    expect(snapshotOf(world.repo)).toEqual(afterOtherBase);
    expect(before).not.toEqual(afterOtherBase); // 위 publishRefs 가 쓴 것이고, 거절된 시도는 아무것도 쓰지 않았다.

    // 고른 매핑의 상태가 바뀜: 다른 묶음 게시로 a 가 PUBLISHED 가 됐다.
    publishBundleFromBase(world.deps, RV, { ...choice(base, a), publishConfirmation: confirmForA });
    expect(world.repo.getItemState(a)?.state).toBe('PUBLISHED');
    const afterFirst = snapshotOf(world.repo);
    expect(catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, a), publishConfirmation: confirmForA })).defects).toEqual([{ code: 'PREVIEW_REQUIRED', path: 'publishConfirmation' }]);
    expect(snapshotOf(world.repo)).toEqual(afterFirst);
  });

  it('충돌이면 MAPPING_CONFLICT 이고 아무것도 쓰지 않는다 (기준 묶음의 매핑과 겹침 · 고른 매핑끼리 겹침)', () => {
    const { world, base } = composeWorld();
    const clash = approvedMapping(world, 'TEST_FIXTURE_MAPPING_T1_CLASH', T1);
    const a = approvedMapping(world, 'TEST_FIXTURE_MAPPING_A', T3);
    const b = approvedMapping(world, 'TEST_FIXTURE_MAPPING_B', T3);
    const before = snapshotOf(world.repo);

    // 확인값은 충돌 여부와 무관하게 계산할 수 있지만(미리보기는 충돌이면 내주지 않는다) 충돌 판정이 먼저다.
    const forged = computeBundlePublishConfirmation(world.deps, RV, choice(base, clash));
    const withBase = catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, clash), publishConfirmation: forged }));
    expect(withBase.code).toBe('STATE_CONFLICT');
    expect(withBase.defects).toEqual([{ code: 'MAPPING_CONFLICT', path: 'mappings[0]' }]);
    const among = catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, a, b), publishConfirmation: computeBundlePublishConfirmation(world.deps, RV, choice(base, a, b)) }));
    expect(among.defects).toEqual([
      { code: 'MAPPING_CONFLICT', path: 'mappings[0]' },
      { code: 'MAPPING_CONFLICT', path: 'mappings[1]' },
    ]);
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('기준 묶음이 없거나(NOT_FOUND) 중지됐거나(BASE_BUNDLE_NOT_ACTIVE) 고른 매핑이 없거나(NOT_FOUND) 이미 기준 묶음에 있으면(MAPPING_ALREADY_IN_BASE) 거절하고 아무것도 쓰지 않는다', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const confirmation = previewBundlePublish(world.deps, RV, choice(base, added)).publishConfirmation as string;
    const before = snapshotOf(world.repo);

    expect(catchDomainError(() => publishBundleFromBase(world.deps, RV, { baseBundleId: 'TEST_FIXTURE_NO_SUCH_BUNDLE', mappings: [added], publishConfirmation: confirmation })).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, { kind: 'MAPPING', id: 'TEST_FIXTURE_NO_SUCH_MAPPING', version: 'v1' }), publishConfirmation: confirmation })).code).toBe('NOT_FOUND');
    const inBase = catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, baseMappingRef(base, T1)), publishConfirmation: confirmation }));
    expect(inBase.defects).toEqual([{ code: 'MAPPING_ALREADY_IN_BASE', path: 'mappings[0]' }]);
    expect(snapshotOf(world.repo)).toEqual(before);

    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, base.id, 'TEST_FIXTURE 중지');
    const suspendedBefore = snapshotOf(world.repo);
    expect(catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, added), publishConfirmation: confirmation })).defects).toEqual([{ code: 'BASE_BUNDLE_NOT_ACTIVE', path: 'baseBundleId' }]);
    expect(snapshotOf(world.repo)).toEqual(suspendedBefore);
  });

  it('승인되지 않은 매핑은 기존 게시 전제(ITEM_STATE_NOT_PUBLISHABLE)가 거절한다: 매핑이 PUBLISHED 가 되지도, 묶음이 생기지도 않는다', () => {
    const { world, base } = composeWorld();
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord(T3, { id: 'TEST_FIXTURE_MAPPING_DRAFT' }).content).ref;
    const before = snapshotOf(world.repo);

    const error = catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, draft), publishConfirmation: computeBundlePublishConfirmation(world.deps, RV, choice(base, draft)) }));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toContainEqual({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: 'bundle.mappings[3].state' });
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(newBundlesOf(world.repo, base)).toEqual([]);
  });

  it('미리보기 뒤에 치료의 보장 판단 필드가 바뀌면 기존 FINGERPRINT_STALE 로 거절하고 아무것도 쓰지 않는다', () => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const confirmation = previewBundlePublish(world.deps, RV, choice(base, added)).publishConfirmation as string;
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3B', treatmentId: T3, treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    const before = snapshotOf(world.repo);

    const error = catchDomainError(() => publishBundleFromBase(world.deps, RV, { ...choice(base, added), publishConfirmation: confirmation }));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toContainEqual({ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[3].approvedFingerprint' });
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it.each([
    ['HA', TEST_FIXTURE_HA_1],
    ['PO', TEST_FIXTURE_PO_1],
  ])('%s 는 게시할 수 없다 (ROLE_NOT_PERMITTED, 저장소 그대로)', (_name, actor) => {
    const { world, base } = composeWorld();
    const added = approvedMapping(world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
    const confirmation = previewBundlePublish(world.deps, RV, choice(base, added)).publishConfirmation as string;
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => publishBundleFromBase(world.deps, actor, { ...choice(base, added), publishConfirmation: confirmation })).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('기준 묶음에 있는 같은 매핑 id 의 새 버전은 지원하지 않는다: 같은 치료·칸이면 충돌, 칸이 달라도 매핑 id 중복(MAPPING_ID_DUPLICATE)으로 게시 검증이 거절한다', () => {
    const { world, base } = composeWorld();
    const baseT1 = baseMappingRef(base, T1);
    const sameCell = approvedMapping(world, baseT1.id, T1, { version: 'v2' });
    const otherCell = approvedMapping(world, baseT1.id, T1, { version: 'v3', scope: [OTHER_CELL] });
    const before = snapshotOf(world.repo);

    expect(previewBundlePublish(world.deps, RV, choice(base, sameCell)).conflicts).toHaveLength(1);
    const preview = previewBundlePublish(world.deps, RV, choice(base, otherCell));
    expect(preview.conflicts).toEqual([]);
    expect(preview.defects.map((defect) => defect.code)).toContain('MAPPING_ID_DUPLICATE');
    expect(preview.publishConfirmation).toBeNull();
    expect(snapshotOf(world.repo)).toEqual(before);
  });
});
