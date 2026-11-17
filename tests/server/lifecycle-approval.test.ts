import { describe, expect, it } from 'vitest';
import type { LifecycleState } from '../../src/engine/types';
import { approve, markExpired, markPublished, markSuperseded, reject, submitForReview, suspendItem } from '../../src/server/approval';
import type { Actor } from '../../src/server/domain/actor';
import { coverageFingerprintOf } from '../../src/server/fingerprint';
import {
  TEST_FIXTURE_HA_1,
  TEST_FIXTURE_PO_1,
  TEST_FIXTURE_RV_APPROVER,
  TEST_FIXTURE_RV_APPROVER_2,
  TEST_FIXTURE_RV_AUTHOR,
} from '../fixtures/server/actors.fixture';
import { makeCatalogVersion, makeClinic, makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { profileRecord } from '../fixtures/server/items.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import {
  ALL_STATES,
  ITEM_KINDS,
  adoptTreatmentVersion,
  approvedOf,
  draftOf,
  forceState,
  itemInState,
  newWorld,
  publishedOf,
  reviewRequestedOf,
  seedTreatment,
} from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 제출·승인·반려·중지와 시스템 전이 (design.md DD-17 생명주기, 소유자 결정 #31 본인 승인 금지).
// 세 종류(프로필·매핑·서류 규칙 묶음)가 같은 규칙을 따른다.

function world(): World {
  const created = newWorld();
  seedTreatment(created.repo);
  return created;
}

function asRole(actor: Actor, role: 'HA' | 'PO'): Actor {
  return { id: actor.id, role };
}

describe.each(ITEM_KINDS)('제출 (%s)', (kind) => {
  it('작성자가 DRAFT 를 제출하면 REVIEW_REQUESTED 가 되고 이력과 감사 기록이 남는다', () => {
    const w = world();
    const ref = draftOf(w, kind);
    w.clock.set('2026-10-16T10:00:00.000Z');
    submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, ref);
    const state = w.repo.getItemState(ref);
    expect(state?.state).toBe('REVIEW_REQUESTED');
    expect(state?.approver).toBeNull();
    expect(state?.history.at(-1)).toEqual({
      from: 'DRAFT',
      to: 'REVIEW_REQUESTED',
      actorId: 'TEST_FIXTURE_RV_AUTHOR',
      role: 'RV',
      at: '2026-10-16T10:00:00.000Z',
      reason: null,
      approver: null,
      approvedFingerprint: null,
    });
    expect(w.repo.listAuditLog().at(-1)).toEqual({
      id: 'TEST_FIXTURE_AUDIT_2',
      actorId: 'TEST_FIXTURE_RV_AUTHOR',
      role: 'RV',
      action: 'ITEM_SUBMIT',
      target: `${kind}/${ref.id}/${ref.version}`,
      beforeVersion: 'DRAFT',
      afterVersion: 'REVIEW_REQUESTED',
      reason: null,
      at: '2026-10-16T10:00:00.000Z',
    });
  });

  it('작성자가 아닌 RV 는 제출할 수 없다 (NOT_ITEM_AUTHOR, 전후 비교가 같다) [문서에 없음]', () => {
    const w = world();
    const ref = draftOf(w, kind);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => submitForReview(w.deps, TEST_FIXTURE_RV_APPROVER, ref)).code).toBe('NOT_ITEM_AUTHOR');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it.each(['HA', 'PO'] as const)('작성자 id 라도 역할이 %s 이면 제출할 수 없다 (ROLE_NOT_PERMITTED)', (role) => {
    const w = world();
    const ref = draftOf(w, kind);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => submitForReview(w.deps, asRole(TEST_FIXTURE_RV_AUTHOR, role), ref)).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('없는 항목은 NOT_FOUND 이다', () => {
    const w = world();
    expect(catchDomainError(() => submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, { kind, id: 'TEST_FIXTURE_NOPE', version: 'v1' })).code).toBe('NOT_FOUND');
  });
});

describe.each(ITEM_KINDS)('승인 (%s)', (kind) => {
  const expectedFingerprint = (): string | null => (kind === 'MAPPING' ? coverageFingerprintOf(makeTreatmentVersion()) : null);

  it('다른 주체(RV)가 승인하면 APPROVED, 승인자 기록이 생기고 이력·감사 기록이 남는다', () => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    w.clock.set('2026-10-16T11:00:00.000Z');
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);

    const state = w.repo.getItemState(ref);
    const approver = { approverId: 'TEST_FIXTURE_RV_APPROVER', approvedAt: '2026-10-16T11:00:00.000Z' };
    expect(state?.state).toBe('APPROVED');
    expect(state?.approver).toEqual(approver);
    expect(state?.approvedFingerprint).toBe(expectedFingerprint());
    expect(state?.history.at(-1)).toEqual({
      from: 'REVIEW_REQUESTED',
      to: 'APPROVED',
      actorId: 'TEST_FIXTURE_RV_APPROVER',
      role: 'RV',
      at: '2026-10-16T11:00:00.000Z',
      reason: null,
      approver,
      approvedFingerprint: expectedFingerprint(),
    });
    expect(w.repo.listAuditLog().at(-1)).toMatchObject({
      actorId: 'TEST_FIXTURE_RV_APPROVER',
      role: 'RV',
      action: 'ITEM_APPROVE',
      target: `${kind}/${ref.id}/${ref.version}`,
      beforeVersion: 'REVIEW_REQUESTED',
      afterVersion: 'APPROVED',
      reason: null,
    });
    // 승인 우회 표지는 감사 기록 어디에도 없다 (결정 #31).
    expect(Object.keys(w.repo.listAuditLog().at(-1) ?? {})).not.toContain('selfApproval');
  });

  it('승인해도 항목 버전의 내용은 바뀌지 않는다 (내용과 상태가 따로다)', () => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    const contentBefore = w.repo.getItemVersion(ref);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    expect(w.repo.getItemVersion(ref)).toEqual(contentBefore);
  });

  it('[AC-024a·AC-025b 의 도메인 쪽 증거] 작성자 본인의 승인은 SELF_APPROVAL_FORBIDDEN 이고 상태·승인자·감사 기록이 하나도 바뀌지 않는다', () => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => approve(w.deps, TEST_FIXTURE_RV_AUTHOR, ref));
    expect(error.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getItemState(ref)?.state).toBe('REVIEW_REQUESTED');
    expect(w.repo.getItemState(ref)?.approver).toBeNull();
    expect(w.repo.getItemState(ref)?.approvedFingerprint).toBeNull();
    expect(w.repo.listAuditLog().map((entry) => entry.action)).toEqual(['ITEM_CREATE_DRAFT', 'ITEM_SUBMIT']);
  });

  it('[AC-024a·AC-025b 의 도메인 쪽 증거] 본인 승인이 거절된 뒤 다른 주체의 승인은 성공한다', () => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    expect(catchDomainError(() => approve(w.deps, TEST_FIXTURE_RV_AUTHOR, ref)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    expect(w.repo.getItemState(ref)?.state).toBe('APPROVED');
    expect(w.repo.getItemState(ref)?.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER');
  });

  it('재승인(UNDER_REREVIEW → APPROVED)도 작성자 본인은 거절되고 전후 비교가 같다', () => {
    const w = world();
    const ref = approvedOf(w, kind);
    forceState(w.repo, ref, 'UNDER_REREVIEW');
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => approve(w.deps, TEST_FIXTURE_RV_AUTHOR, ref)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getItemState(ref)?.state).toBe('UNDER_REREVIEW');
  });

  it('재승인은 승인자 기록(과 매핑의 고정 지문)을 새 값으로 바꾸고 이전 값은 이력에 남는다', () => {
    const w = world();
    const ref = approvedOf(w, kind);
    const firstFingerprint = w.repo.getItemState(ref)?.approvedFingerprint;
    // 재승인 시점의 현재 치료 버전이 보장 판단 필드가 달라졌다고 하자 (매핑의 지문이 새 값으로 바뀌어야 한다).
    adoptTreatmentVersion(w.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', procedureCodes: ['TEST_FIXTURE_PROC_NEW'] }));
    forceState(w.repo, ref, 'UNDER_REREVIEW');
    w.clock.set('2026-10-20T00:00:00.000Z');
    approve(w.deps, TEST_FIXTURE_RV_APPROVER_2, ref);

    const state = w.repo.getItemState(ref);
    expect(state?.state).toBe('APPROVED');
    expect(state?.approver).toEqual({ approverId: 'TEST_FIXTURE_RV_APPROVER_2', approvedAt: '2026-10-20T00:00:00.000Z' });
    const reapproval = state?.history.at(-1);
    expect(reapproval?.from).toBe('UNDER_REREVIEW');
    expect(reapproval?.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER_2');
    // 첫 승인의 기록은 이력에 그대로 있다.
    const firstApproval = state?.history.find((step) => step.to === 'APPROVED');
    expect(firstApproval?.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER');
    expect(firstApproval?.approvedFingerprint ?? null).toBe(firstFingerprint ?? null);
    if (kind === 'MAPPING') {
      const replaced = coverageFingerprintOf(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', procedureCodes: ['TEST_FIXTURE_PROC_NEW'] }));
      expect(state?.approvedFingerprint).toBe(replaced);
      expect(replaced).not.toBe(firstFingerprint);
    } else {
      expect(state?.approvedFingerprint).toBeNull();
    }
  });

  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1])('역할 %o 는 승인할 수 없다 (ROLE_NOT_PERMITTED)', (actor) => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => approve(w.deps, actor, ref)).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('작성자 id 의 역할이 HA 여도 역할 때문에 먼저 거절된다 (역할 검사가 앞선다)', () => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    expect(catchDomainError(() => approve(w.deps, asRole(TEST_FIXTURE_RV_AUTHOR, 'HA'), ref)).code).toBe('ROLE_NOT_PERMITTED');
  });

  it('없는 항목은 NOT_FOUND 이다', () => {
    const w = world();
    expect(catchDomainError(() => approve(w.deps, TEST_FIXTURE_RV_APPROVER, { kind, id: 'TEST_FIXTURE_NOPE', version: 'v1' })).code).toBe('NOT_FOUND');
  });
});

describe('승인: 프로필·서류 규칙 묶음은 치료 자료 없이도 승인되고 지문은 null 이다', () => {
  it.each(['PROFILE', 'DOCUMENT_RULE_SET'] as const)('%s', (kind) => {
    const w = newWorld();
    const ref = reviewRequestedOf(w, kind);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    expect(w.repo.getItemState(ref)?.state).toBe('APPROVED');
    expect(w.repo.getItemState(ref)?.approvedFingerprint).toBeNull();
  });
});

describe('매핑 승인이 고정하는 지문 (DD-15, 치료 버전 선택 규칙 [문서에 없음])', () => {
  function reviewRequestedMapping(w: World): ReturnType<typeof reviewRequestedOf> {
    return reviewRequestedOf(w, 'MAPPING');
  }

  it('현재 카탈로그 버전에 든 치료 버전의 지문을 고정한다 (더 나중에 쓴 다른 버전이 있어도)', () => {
    const w = newWorld();
    const { treatmentVersion } = seedTreatment(w.repo);
    // 카탈로그에 들지 않은, 더 나중에 쓴 버전. 쓰기 순서로는 이쪽이 최신이다.
    w.repo.putTreatmentVersion(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_LATER', procedureCodes: ['TEST_FIXTURE_PROC_OTHER'] }));
    const ref = reviewRequestedMapping(w);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    expect(w.repo.getItemState(ref)?.approvedFingerprint).toBe(coverageFingerprintOf(treatmentVersion));
  });

  it('가격·표시 이름만 다른 치료 버전은 같은 지문을 낸다 (지문은 보장 판단 필드만 본다)', () => {
    const w = newWorld();
    seedTreatment(w.repo, { patientAmount: 99_000, displayName: 'TEST_FIXTURE 다른 이름' });
    const ref = reviewRequestedMapping(w);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    expect(w.repo.getItemState(ref)?.approvedFingerprint).toBe(coverageFingerprintOf(makeTreatmentVersion()));
  });

  it('현재 카탈로그에 치료가 없으면 쓰기 순서상 가장 나중 버전의 지문을 고정한다 (카탈로그 자체가 없는 병원)', () => {
    const w = newWorld();
    w.repo.saveClinic(makeClinic());
    w.repo.saveTreatment(makeTreatment());
    w.repo.putTreatmentVersion(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_A', procedureCodes: ['TEST_FIXTURE_PROC_A'] }));
    const latest = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_B', procedureCodes: ['TEST_FIXTURE_PROC_B'] });
    w.repo.putTreatmentVersion(latest);
    const ref = reviewRequestedMapping(w);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    expect(w.repo.getItemState(ref)?.approvedFingerprint).toBe(coverageFingerprintOf(latest));
  });

  it('현재 카탈로그가 있어도 그 치료를 담지 않았으면 쓰기 순서상 가장 나중 버전을 쓴다', () => {
    const w = newWorld();
    w.repo.saveClinic(makeClinic());
    w.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_OTHER' }));
    w.repo.putTreatmentVersion(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_OTHER', treatmentId: 'TEST_FIXTURE_TREATMENT_OTHER' }));
    const catalog = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_OTHER', treatmentVersionIds: ['TEST_FIXTURE_TV_OTHER'], baseFeeIds: [] });
    w.repo.putCatalogVersion(catalog);
    w.repo.saveClinic(makeClinic({ currentCatalogVersionId: catalog.id }));
    w.repo.saveTreatment(makeTreatment());
    w.repo.putTreatmentVersion(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_A', procedureCodes: ['TEST_FIXTURE_PROC_A'] }));
    const latest = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_B', procedureCodes: ['TEST_FIXTURE_PROC_B'] });
    w.repo.putTreatmentVersion(latest);
    const ref = reviewRequestedMapping(w);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    expect(w.repo.getItemState(ref)?.approvedFingerprint).toBe(coverageFingerprintOf(latest));
  });

  it('치료 버전이 하나도 없으면 TREATMENT_VERSION_ABSENT 이고 아무것도 바뀌지 않는다', () => {
    const w = newWorld();
    w.repo.saveClinic(makeClinic());
    w.repo.saveTreatment(makeTreatment());
    const ref = reviewRequestedMapping(w);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref)).code).toBe('TREATMENT_VERSION_ABSENT');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getItemState(ref)?.state).toBe('REVIEW_REQUESTED');
  });

  it('치료 자체가 없어도 TREATMENT_VERSION_ABSENT 이다', () => {
    const w = newWorld();
    const ref = reviewRequestedMapping(w);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref)).code).toBe('TREATMENT_VERSION_ABSENT');
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe.each(ITEM_KINDS)('반려 (%s)', (kind) => {
  it('RV 가 사유와 함께 반려하면 REJECTED 가 되고 사유가 이력·감사 기록에 남는다', () => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    w.clock.set('2026-10-16T12:00:00.000Z');
    reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 반려 사유');
    const state = w.repo.getItemState(ref);
    expect(state?.state).toBe('REJECTED');
    expect(state?.history.at(-1)).toMatchObject({ from: 'REVIEW_REQUESTED', to: 'REJECTED', actorId: 'TEST_FIXTURE_RV_APPROVER', role: 'RV', reason: 'TEST_FIXTURE 반려 사유' });
    expect(state?.approver).toBeNull();
    expect(w.repo.listAuditLog().at(-1)).toMatchObject({
      action: 'ITEM_REJECT',
      actorId: 'TEST_FIXTURE_RV_APPROVER',
      beforeVersion: 'REVIEW_REQUESTED',
      afterVersion: 'REJECTED',
      reason: 'TEST_FIXTURE 반려 사유',
    });
  });

  it.each(['', ' ', '\n\t', '　'])('사유가 비었거나 공백뿐(%j)이면 REASON_REQUIRED 이고 전후 비교가 같다', (reason) => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, reason)).code).toBe('REASON_REQUIRED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('반려에는 본인 승인 금지 규칙을 적용하지 않는다: 작성자도 자기 항목을 반려할 수 있다', () => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    reject(w.deps, TEST_FIXTURE_RV_AUTHOR, ref, 'TEST_FIXTURE 철회');
    expect(w.repo.getItemState(ref)?.state).toBe('REJECTED');
  });

  it('재검토 중(UNDER_REREVIEW)인 항목도 반려할 수 있다', () => {
    const w = world();
    const ref = approvedOf(w, kind);
    forceState(w.repo, ref, 'UNDER_REREVIEW');
    reject(w.deps, TEST_FIXTURE_RV_APPROVER_2, ref, 'TEST_FIXTURE 재검토 반려');
    expect(w.repo.getItemState(ref)?.state).toBe('REJECTED');
  });

  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1])('역할 %o 는 반려할 수 없다 (ROLE_NOT_PERMITTED)', (actor) => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => reject(w.deps, actor, ref, 'TEST_FIXTURE 사유')).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('반려된 버전은 끝이다: 다시 제출·승인·반려할 수 없다 (새 버전 DRAFT 로만 이어진다)', () => {
    const w = world();
    const ref = reviewRequestedOf(w, kind);
    reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 반려');
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, ref)).code).toBe('STATE_CONFLICT');
    expect(catchDomainError(() => approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref)).code).toBe('STATE_CONFLICT');
    expect(catchDomainError(() => reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 또')).code).toBe('STATE_CONFLICT');
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe.each(ITEM_KINDS)('항목 단위 중지 (%s)', (kind) => {
  it('PUBLISHED 를 RV 가 사유와 함께 중지하면 SUSPENDED 가 되고 사유가 남는다', () => {
    const w = world();
    const ref = publishedOf(w, kind);
    suspendItem(w.deps, TEST_FIXTURE_RV_APPROVER_2, ref, 'TEST_FIXTURE 중지 사유');
    const state = w.repo.getItemState(ref);
    expect(state?.state).toBe('SUSPENDED');
    expect(state?.history.at(-1)).toMatchObject({ from: 'PUBLISHED', to: 'SUSPENDED', actorId: 'TEST_FIXTURE_RV_APPROVER_2', reason: 'TEST_FIXTURE 중지 사유' });
    expect(w.repo.listAuditLog().at(-1)).toMatchObject({ action: 'ITEM_SUSPEND', beforeVersion: 'PUBLISHED', afterVersion: 'SUSPENDED', reason: 'TEST_FIXTURE 중지 사유' });
  });

  it.each(['', '   ', '\n'])('사유가 비었거나 공백뿐(%j)이면 REASON_REQUIRED 이다', (reason) => {
    const w = world();
    const ref = publishedOf(w, kind);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => suspendItem(w.deps, TEST_FIXTURE_RV_APPROVER, ref, reason)).code).toBe('REASON_REQUIRED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1])('역할 %o 는 중지할 수 없다', (actor) => {
    const w = world();
    const ref = publishedOf(w, kind);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => suspendItem(w.deps, actor, ref, 'TEST_FIXTURE 사유')).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('중지된 버전은 새 버전으로만 이어진다: 어떤 시스템·승인 전이도 받지 않는다', () => {
    const w = world();
    const ref = publishedOf(w, kind);
    suspendItem(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 사유');
    const before = snapshotOf(w.repo);
    for (const attempt of [
      () => markPublished(w.deps, TEST_FIXTURE_RV_APPROVER, ref),
      () => markSuperseded(w.deps, TEST_FIXTURE_RV_APPROVER, ref),
      () => markExpired(w.deps, TEST_FIXTURE_RV_APPROVER, ref),
      () => approve(w.deps, TEST_FIXTURE_RV_APPROVER_2, ref),
    ]) {
      expect(catchDomainError(attempt).code).toBe('STATE_CONFLICT');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe.each(ITEM_KINDS)('시스템 전이 기본 동작 (%s): 게시·대체·만료는 표와 역할을 확인한다', (kind) => {
  it('APPROVED → PUBLISHED, PUBLISHED → SUPERSEDED, PUBLISHED → EXPIRED 가 각각 이력과 감사 기록을 남긴다', () => {
    const w = world();
    const first = approvedOf(w, kind, 1);
    markPublished(w.deps, TEST_FIXTURE_RV_APPROVER, first);
    expect(w.repo.getItemState(first)?.state).toBe('PUBLISHED');
    expect(w.repo.listAuditLog().at(-1)).toMatchObject({ action: 'ITEM_PUBLISH', beforeVersion: 'APPROVED', afterVersion: 'PUBLISHED' });
    // 게시해도 승인자와 고정 지문은 그대로 이어진다.
    expect(w.repo.getItemState(first)?.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER');

    markSuperseded(w.deps, TEST_FIXTURE_RV_APPROVER, first);
    expect(w.repo.getItemState(first)?.state).toBe('SUPERSEDED');
    expect(w.repo.listAuditLog().at(-1)).toMatchObject({ action: 'ITEM_SUPERSEDE', beforeVersion: 'PUBLISHED', afterVersion: 'SUPERSEDED' });

    const second = publishedOf(w, kind, 2);
    markExpired(w.deps, TEST_FIXTURE_RV_APPROVER, second);
    expect(w.repo.getItemState(second)?.state).toBe('EXPIRED');
    expect(w.repo.listAuditLog().at(-1)).toMatchObject({ action: 'ITEM_EXPIRE', beforeVersion: 'PUBLISHED', afterVersion: 'EXPIRED' });
  });

  it.each([
    ['markPublished', 'APPROVED', markPublished],
    ['markSuperseded', 'PUBLISHED', markSuperseded],
    ['markExpired', 'PUBLISHED', markExpired],
  ] as const)('%s : HA·PO 는 ROLE_NOT_PERMITTED, 없는 항목은 NOT_FOUND', (_name, from, run) => {
    const w = world();
    const ref = itemInState(w, kind, from);
    const before = snapshotOf(w.repo);
    for (const actor of [TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1]) {
      expect(catchDomainError(() => run(w.deps, actor, ref)).code).toBe('ROLE_NOT_PERMITTED');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(catchDomainError(() => run(w.deps, TEST_FIXTURE_RV_APPROVER, { kind, id: 'TEST_FIXTURE_NOPE', version: 'v1' })).code).toBe('NOT_FOUND');
  });
});

// ───────────────────────── 서비스 동작 × 9 상태 행렬 ─────────────────────────
// 모든 서비스 동작이 DD-17 전이 표 하나를 공유함을 보인다: 표에서 허용되는 (상태, 동작) 쌍만 성공하고 나머지는 STATE_CONFLICT 다.

/** 허용되는 (from → to) 전이 11개를 이 파일에 따로 적어 둔다 (lifecycle-table.test.ts 와 독립). */
const ALLOWED: ReadonlyArray<readonly [LifecycleState, LifecycleState]> = [
  ['DRAFT', 'REVIEW_REQUESTED'],
  ['REVIEW_REQUESTED', 'APPROVED'],
  ['REVIEW_REQUESTED', 'REJECTED'],
  ['APPROVED', 'PUBLISHED'],
  ['APPROVED', 'UNDER_REREVIEW'],
  ['PUBLISHED', 'SUSPENDED'],
  ['PUBLISHED', 'SUPERSEDED'],
  ['PUBLISHED', 'UNDER_REREVIEW'],
  ['PUBLISHED', 'EXPIRED'],
  ['UNDER_REREVIEW', 'APPROVED'],
  ['UNDER_REREVIEW', 'REJECTED'],
];

const OPERATIONS: ReadonlyArray<{ name: string; to: LifecycleState; run: (w: World, ref: ReturnType<typeof draftOf>) => void }> = [
  { name: 'submitForReview', to: 'REVIEW_REQUESTED', run: (w, ref) => submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, ref) },
  { name: 'approve', to: 'APPROVED', run: (w, ref) => approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref) },
  { name: 'reject', to: 'REJECTED', run: (w, ref) => reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 사유') },
  { name: 'markPublished', to: 'PUBLISHED', run: (w, ref) => markPublished(w.deps, TEST_FIXTURE_RV_APPROVER, ref) },
  { name: 'suspendItem', to: 'SUSPENDED', run: (w, ref) => suspendItem(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 사유') },
  { name: 'markSuperseded', to: 'SUPERSEDED', run: (w, ref) => markSuperseded(w.deps, TEST_FIXTURE_RV_APPROVER, ref) },
  { name: 'markExpired', to: 'EXPIRED', run: (w, ref) => markExpired(w.deps, TEST_FIXTURE_RV_APPROVER, ref) },
];

const matrix = ITEM_KINDS.flatMap((kind) =>
  ALL_STATES.flatMap((from) =>
    OPERATIONS.map((operation): [string, LifecycleState, string, LifecycleState, boolean] => [
      kind,
      from,
      operation.name,
      operation.to,
      ALLOWED.some(([a, b]) => a === from && b === operation.to),
    ]),
  ),
);

describe('서비스 동작 × 9 상태 행렬 (전이 표 하나를 모든 동작이 공유한다)', () => {
  it('3종류 × 9상태 × 7동작 = 189칸이다. 성공이 기대되는 칸은 종류마다 9개다 (표의 11쌍 중 UNDER_REREVIEW 로 가는 2쌍은 재검토 트리거의 몫이라 이 동작들에는 없다)', () => {
    expect(matrix).toHaveLength(189);
    expect(matrix.filter(([, , , , allowed]) => allowed)).toHaveLength(27);
  });

  it.each(matrix)('%s : %s 에서 %s (→ %s) 허용=%s', (kind, from, operationName, to, allowed) => {
    const w = world();
    const ref = itemInState(w, kind as (typeof ITEM_KINDS)[number], from);
    const operation = OPERATIONS.find((candidate) => candidate.name === operationName)!;
    const before = snapshotOf(w.repo);
    const auditCountBefore = w.repo.listAuditLog().length;
    if (allowed) {
      operation.run(w, ref);
      expect(w.repo.getItemState(ref)?.state).toBe(to);
      expect(w.repo.listAuditLog()).toHaveLength(auditCountBefore + 1);
      expect(w.repo.getItemState(ref)?.history.at(-1)).toMatchObject({ from, to });
    } else {
      const error = catchDomainError(() => operation.run(w, ref));
      expect(error.code).toBe('STATE_CONFLICT');
      expect(snapshotOf(w.repo)).toEqual(before);
    }
  });
});

describe('상태 기록이 없는 항목 버전', () => {
  it('내용만 있고 상태 기록이 없는 버전은 어떤 상태 변경도 NOT_FOUND 이다 (상태를 추정하지 않는다)', () => {
    const w = world();
    const record = profileRecord();
    w.repo.putItemVersion(record);
    const before = snapshotOf(w.repo);
    for (const attempt of [
      () => submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, record.ref),
      () => approve(w.deps, TEST_FIXTURE_RV_APPROVER, record.ref),
      () => reject(w.deps, TEST_FIXTURE_RV_APPROVER, record.ref, 'TEST_FIXTURE 사유'),
      () => markPublished(w.deps, TEST_FIXTURE_RV_APPROVER, record.ref),
    ]) {
      const error = catchDomainError(attempt);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toContain('상태 기록');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe('입력을 바꾸지 않는다', () => {
  it('얼려 둔 참조를 넘겨도 서비스가 던지지 않고 같은 참조로 계속 쓸 수 있다', () => {
    const w = world();
    const ref = Object.freeze({ ...draftOf(w, 'PROFILE') });
    expect(() => submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, ref)).not.toThrow();
    expect(() => approve(w.deps, Object.freeze({ ...TEST_FIXTURE_RV_APPROVER }), ref)).not.toThrow();
  });
});
