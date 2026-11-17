import { describe, expect, it } from 'vitest';
import type { CoverageReviewRequest } from '../../src/server/domain/entities';
import type { ItemVersionRef } from '../../src/server/domain/items';
import { approveMappingForReviewRequest, createMappingDraftForReviewRequest, rejectMappingForReviewRequest, submitMappingForReviewRequest } from '../../src/server/mapping-review';
import type { MappingDraftInput } from '../../src/server/mapping-review';
import { createCoverageReviewRequest, createMappingDraftFromRequest } from '../../src/server/review-request';
import { readClinicReviewRequestViews, readReviewEntry, readReviewHistory, readReviewQueue } from '../../src/server/review-request-read';
import { repoWith } from '../api/helpers';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeCatalogVersion, makeClinic, makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { TEST_FIXTURE_TREATMENT_ID, adoptTreatmentVersion, baseContent, newWorld, seedTreatment } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 검토 대기열·이력의 읽기 보기 (M7 매핑 검토). 읽기만 한다. 현재 게시값은 네 가지 상태(PUBLISHED/HIDDEN/NOT_IN_CATALOG/UNREADABLE)로 나뉘고,
// 읽지 못한 것(UNREADABLE)이 "목록에 없음"으로 보이는 일이 없어야 한다. 병원 관리자 보기는 분류 표지 하나만 더하고 RV 내부 자료(매핑·작성자·검토 기준)는 싣지 않는다.

const T1 = TEST_FIXTURE_TREATMENT_ID;
const T2 = 'TEST_FIXTURE_TREATMENT_2';
const AUTHOR = TEST_FIXTURE_RV_AUTHOR;
const APPROVER = TEST_FIXTURE_RV_APPROVER;
const SOURCE = { insurerDocumentId: 'TEST_FIXTURE_DOC', revisionDate: '2026-01-01', clauseOrPage: 'TEST_FIXTURE_P1', effectiveDate: '2026-01-01', verifiedBy: 'TEST_FIXTURE_V', verifiedAt: '2026-01-02' };

const input = (): MappingDraftInput => ({
  scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
  decision: 'COVERED',
  groupKey: 'TEST_FIXTURE_GROUP',
  validity: { from: '2026-01-01', to: '2026-12-31' },
  policySources: [{ ...SOURCE }],
  origin: 'TEST_FIXTURE',
});

function setup(treatment: Parameters<typeof seedTreatment>[1] = {}): { world: World; request: CoverageReviewRequest } {
  const world = newWorld();
  seedTreatment(world.repo, treatment);
  return { world, request: open(world, T1) };
}

function open(world: World, treatmentId: string): CoverageReviewRequest {
  return createCoverageReviewRequest(world.deps, TEST_FIXTURE_HA_1, {
    clinicId: TEST_FIXTURE_CLINIC_ID,
    treatmentId,
    proposed: { benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A'], calcClass: 'GENERAL_BENEFIT' },
  });
}

/** 같은 병원의 현재 카탈로그에 둘째 치료(T2)를 더한다. */
function addSecondTreatment(world: World): void {
  world.repo.saveTreatment(makeTreatment({ id: T2, sortOrder: 2 }));
  const second = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentId: T2, treatmentCode: 'TEST_FIXTURE_TC_2', displayName: 'TEST_FIXTURE 시험 치료 2' });
  world.repo.putTreatmentVersion(second);
  const catalog = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_2', treatmentVersionIds: ['TEST_FIXTURE_TV_1', second.id], baseFeeIds: [] });
  world.repo.putCatalogVersion(catalog);
  world.repo.saveClinic(makeClinic({ currentCatalogVersionId: catalog.id }));
}

const draft = (world: World, request: CoverageReviewRequest): ItemVersionRef => createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, input()).draft.ref;
const entryOf = (world: World, requestId: string) => readReviewQueue(world.repo).find((entry) => entry.id === requestId)!;

describe('대기열 항목: current (네 가지 상태)', () => {
  it('PUBLISHED: 판단 필드를 싣는다', () => {
    const { world, request } = setup();
    expect(entryOf(world, request.id).current).toEqual({
      state: 'PUBLISHED',
      displayName: 'TEST_FIXTURE 시험 치료',
      treatmentCode: 'TEST_FIXTURE_TC_1',
      benefitType: 'BENEFIT',
      procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'],
      calcClass: 'GENERAL_BENEFIT',
    });
  });

  it('HIDDEN: 요청을 낸 뒤 치료를 숨기면 { state: HIDDEN } — 목록에 없음과 구분된다', () => {
    const { world, request } = setup();
    world.repo.saveTreatment(makeTreatment({ active: false }));
    const entry = entryOf(world, request.id);
    expect(entry.current).toEqual({ state: 'HIDDEN' });
    expect(entry.classification).toBe('UNKNOWN');
  });

  it('NOT_IN_CATALOG: 현재 카탈로그가 그 치료를 담지 않는다', () => {
    const { world, request } = setup();
    world.repo.saveTreatment(makeTreatment({ id: T2, sortOrder: 2 }));
    const other = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentId: T2 });
    world.repo.putTreatmentVersion(other);
    const catalog = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_DROP', treatmentVersionIds: [other.id], baseFeeIds: [] });
    world.repo.putCatalogVersion(catalog);
    world.repo.saveClinic(makeClinic({ currentCatalogVersionId: catalog.id }));
    expect(entryOf(world, request.id).current).toEqual({ state: 'NOT_IN_CATALOG' });
  });

  it('UNREADABLE: 카탈로그 참조 결함은 { state: UNREADABLE, defectCode } 이다 — 던지지 않고 "목록에 없음"으로 읽지도 않는다', () => {
    const { world, request } = setup();
    const broken = repoWith(world.repo, { getTreatmentVersion: () => null });
    const [entry] = readReviewQueue(broken);
    expect(entry!.id).toBe(request.id);
    expect(entry!.current).toEqual({ state: 'UNREADABLE', defectCode: 'TREATMENT_VERSION_MISSING' });
    expect(entry!.classification).toBe('UNKNOWN');
    expect(entry!.basis.check).toBe('UNCHECKABLE');
  });
});

describe('분류 표지 (classification)', () => {
  it('분류 확인 필요(NEEDS_REVIEW) 치료는 NEEDS_REVIEW, 그 밖의 분류는 CLASSIFIED', () => {
    const needs = setup({ calcClass: 'NEEDS_REVIEW' });
    expect(entryOf(needs.world, needs.request.id).classification).toBe('NEEDS_REVIEW');
    const classified = setup({ calcClass: 'MAJOR_THREE_NON_BENEFIT' });
    expect(entryOf(classified.world, classified.request.id).classification).toBe('CLASSIFIED');
  });

  it('병원 관리자 보기도 분류 표지를 받는다 — 읽지 못하면 UNKNOWN', () => {
    const { world, request } = setup({ calcClass: 'NEEDS_REVIEW' });
    expect(readClinicReviewRequestViews(world.repo, TEST_FIXTURE_CLINIC_ID)[0]!.classification).toBe('NEEDS_REVIEW');
    world.repo.saveTreatment(makeTreatment({ active: false }));
    expect(readClinicReviewRequestViews(world.repo, TEST_FIXTURE_CLINIC_ID)[0]).toMatchObject({ id: request.id, classification: 'UNKNOWN' });
  });

  it('병원 관리자 보기는 RV 내부 자료를 싣지 않는다 (키는 분류 표지만 늘었다)', () => {
    const { world, request } = setup();
    submitMappingForReviewRequest(world.deps, AUTHOR, request.id, draft(world, request));
    const [view] = readClinicReviewRequestViews(world.repo, TEST_FIXTURE_CLINIC_ID);
    expect(Object.keys(view!).sort()).toEqual(['classification', 'id', 'proposed', 'rejectionReason', 'requestedAt', 'requestedBy', 'status', 'treatmentId', 'treatmentName']);
    expect(JSON.stringify(view)).not.toMatch(/mapping|MAPPING|basis|authorId|fingerprint|TEST_FIXTURE_RV/i);
  });
});

describe('대기열 항목: 매핑 · 검토 기준 · 승인 차단 사유', () => {
  it('매핑 초안 뒤: 매핑 요약 · 검토 기준 일치(MATCH) · 승인 차단 없음', () => {
    const { world, request } = setup({ procedureCodes: ['TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_A'] });
    world.clock.set('2026-10-20T01:00:00.000Z');
    const ref = draft(world, request);
    const entry = entryOf(world, request.id);
    expect(entry.mapping).toEqual({
      ref,
      authorId: AUTHOR.id,
      createdAt: '2026-10-20T01:00:00.000Z',
      lifecycle: 'DRAFT',
      decision: 'COVERED',
      scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
      groupKey: 'TEST_FIXTURE_GROUP',
      exclusionReason: null,
      validity: { from: '2026-01-01', to: '2026-12-31' },
      policySources: [SOURCE],
    });
    expect(entry.basis).toEqual({
      check: 'MATCH',
      changedFields: [],
      reviewed: { treatmentCode: 'TEST_FIXTURE_TC_1', procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'], benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' },
    });
    expect(entry.approvalBlockedReason).toBeNull();
    expect(Object.keys(entry).sort()).toEqual(['approvalBlockedReason', 'basis', 'classification', 'clinic', 'current', 'id', 'mapping', 'proposed', 'rejectionReason', 'requestedAt', 'requestedBy', 'status', 'treatmentId', 'treatmentName']);
  });

  it('EXCLUDED 매핑은 groupKey 가 null, exclusionReason 이 값이다', () => {
    const { world, request } = setup();
    createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, { ...input(), decision: 'EXCLUDED', groupKey: undefined, exclusionReason: 'TEST_FIXTURE 제외' });
    expect(entryOf(world, request.id).mapping).toMatchObject({ decision: 'EXCLUDED', groupKey: null, exclusionReason: 'TEST_FIXTURE 제외' });
  });

  it('매핑의 생명주기는 제출하면 REVIEW_REQUESTED 로 따라간다', () => {
    const { world, request } = setup();
    const ref = draft(world, request);
    submitMappingForReviewRequest(world.deps, AUTHOR, request.id, ref);
    expect(entryOf(world, request.id).mapping!.lifecycle).toBe('REVIEW_REQUESTED');
  });

  it('검토 뒤 판단 필드가 바뀌면 CHANGED + 바뀐 필드 + 승인 차단 사유(서비스가 거절하는 코드 그대로)', () => {
    const { world, request } = setup();
    draft(world, request);
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_NEXT', calcClass: 'NEEDS_REVIEW' }));
    const entry = entryOf(world, request.id);
    expect(entry.basis.check).toBe('CHANGED');
    expect(entry.basis.changedFields).toEqual(['calcClass']);
    expect(entry.basis.reviewed!.calcClass).toBe('GENERAL_BENEFIT');
    expect(entry.approvalBlockedReason).toBe('REVIEWED_FIELDS_CHANGED');
    expect(entry.classification).toBe('NEEDS_REVIEW');
    expect(entry.current).toMatchObject({ state: 'PUBLISHED', calcClass: 'NEEDS_REVIEW' });
  });

  it('가격만 바뀐 새 카탈로그는 MATCH 다', () => {
    const { world, request } = setup();
    draft(world, request);
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_NEXT', patientAmount: 77_000 }));
    expect(entryOf(world, request.id).basis.check).toBe('MATCH');
  });

  it('치료가 숨겨지면 검토 기준을 비교할 수 없다: UNCHECKABLE · TREATMENT_HIDDEN (기준 값은 그대로 보인다)', () => {
    const { world, request } = setup();
    draft(world, request);
    world.repo.saveTreatment(makeTreatment({ active: false }));
    const entry = entryOf(world, request.id);
    expect(entry.basis.check).toBe('UNCHECKABLE');
    expect(entry.basis.reviewed).not.toBeNull();
    expect(entry.approvalBlockedReason).toBe('TREATMENT_HIDDEN');
  });

  it('읽지 못하면 UNCHECKABLE · CURRENT_VALUES_UNREADABLE', () => {
    const { world, request } = setup();
    draft(world, request);
    const [entry] = readReviewQueue(repoWith(world.repo, { getTreatment: () => null }));
    expect(entry!.basis.check).toBe('UNCHECKABLE');
    expect(entry!.approvalBlockedReason).toBe('CURRENT_VALUES_UNREADABLE');
    expect(entry!.current).toMatchObject({ state: 'UNREADABLE' });
  });

  it('검토 기준이 없는 초안(옛 경로): MISSING · REVIEW_BASIS_MISSING', () => {
    const { world, request } = setup();
    createMappingDraftFromRequest(world.deps, AUTHOR, request.id, baseContent('MAPPING', 3));
    const entry = entryOf(world, request.id);
    expect(entry.mapping).not.toBeNull();
    expect(entry.basis).toEqual({ check: 'MISSING', changedFields: [], reviewed: null });
    expect(entry.approvalBlockedReason).toBe('REVIEW_BASIS_MISSING');
  });

  it('읽기만 한다 (저장소 전체가 그대로)', () => {
    const { world, request } = setup();
    draft(world, request);
    const before = snapshotOf(world.repo);
    readReviewQueue(world.repo);
    readReviewHistory(world.repo);
    readReviewEntry(world.repo, request.id);
    expect(snapshotOf(world.repo)).toEqual(before);
  });
});

describe('readReviewEntry: 요청 한 건의 대기열 모양 보기 (성공 응답이 쓴다)', () => {
  it('열린 요청도 닫힌 요청도 같은 모양으로 읽는다. 없는 요청은 null', () => {
    const { world, request } = setup();
    const ref = draft(world, request);
    submitMappingForReviewRequest(world.deps, AUTHOR, request.id, ref);
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);
    const entry = readReviewEntry(world.repo, request.id)!;
    expect(entry).toMatchObject({ id: request.id, status: 'APPROVED', mapping: { lifecycle: 'APPROVED' }, approvalBlockedReason: null });
    expect(entry.basis.check).toBe('MATCH');
    expect(readReviewEntry(world.repo, 'TEST_FIXTURE_NO_SUCH')).toBeNull();
  });
});

describe('readReviewHistory: 닫힌 요청', () => {
  function twoClosed(): { world: World; approved: CoverageReviewRequest; rejected: CoverageReviewRequest; ref1: ItemVersionRef; ref2: ItemVersionRef } {
    const { world, request: approved } = setup();
    addSecondTreatment(world);
    world.clock.set('2026-10-20T01:00:00.000Z');
    const rejected = open(world, T2);
    world.clock.set('2026-10-20T02:00:00.000Z');
    const ref1 = draft(world, approved);
    submitMappingForReviewRequest(world.deps, AUTHOR, approved.id, ref1);
    const ref2 = draft(world, rejected);
    submitMappingForReviewRequest(world.deps, AUTHOR, rejected.id, ref2);
    world.clock.set('2026-10-21T03:00:00.000Z');
    approveMappingForReviewRequest(world.deps, APPROVER, approved.id, ref1);
    world.clock.set('2026-10-21T04:00:00.000Z');
    rejectMappingForReviewRequest(world.deps, APPROVER, rejected.id, ref2, 'TEST_FIXTURE 반려 사유');
    return { world, approved, rejected, ref1, ref2 };
  }

  it('닫힌 요청만, 요청 시각 내림차순으로 낸다. 열린 요청은 이력에 없다', () => {
    const { world, approved, rejected } = twoClosed();
    const stillOpen = open(world, T1);
    const history = readReviewHistory(world.repo);
    // approved 는 기본 시계(2026-10-16)에, rejected 는 2026-10-20 에 요청했다: 최신이 앞이다.
    expect(history.map((entry) => entry.id)).toEqual([rejected.id, approved.id]);
    expect(history.map((entry) => entry.id)).not.toContain(stillOpen.id);
    expect(history).toHaveLength(2);
    // 대기열에는 열린 것만 남는다.
    expect(readReviewQueue(world.repo).map((entry) => entry.id)).toEqual([stillOpen.id]);
  });

  it('항목: 결과 매핑 · 반려 사유 · 닫은 사람과 시각(연결된 매핑의 닫는 전이)', () => {
    const { world, approved, rejected, ref1 } = twoClosed();
    const byId = new Map(readReviewHistory(world.repo).map((entry) => [entry.id, entry]));
    expect(byId.get(approved.id)).toMatchObject({
      status: 'APPROVED',
      resultMappingRef: ref1,
      rejectionReason: null,
      closedBy: APPROVER.id,
      closedAt: '2026-10-21T03:00:00.000Z',
      approvalBlockedReason: null,
      mapping: { lifecycle: 'APPROVED' },
    });
    expect(byId.get(rejected.id)).toMatchObject({
      status: 'REJECTED',
      resultMappingRef: null,
      rejectionReason: 'TEST_FIXTURE 반려 사유',
      closedBy: APPROVER.id,
      closedAt: '2026-10-21T04:00:00.000Z',
      mapping: { lifecycle: 'REJECTED' },
    });
    expect(Object.keys(byId.get(approved.id)!).sort()).toEqual(
      ['approvalBlockedReason', 'basis', 'classification', 'clinic', 'closedAt', 'closedBy', 'current', 'id', 'mapping', 'proposed', 'rejectionReason', 'requestedAt', 'requestedBy', 'resultMappingRef', 'status', 'treatmentId', 'treatmentName'].sort(),
    );
  });

  it('요청 시각이 같으면 요청 id 의 코드 포인트 내림차순이다', () => {
    const { world, request } = setup();
    addSecondTreatment(world);
    const second = open(world, T2); // 같은 시각
    world.repo.saveCoverageReviewRequest({ ...world.repo.getCoverageReviewRequest(request.id)!, status: 'APPROVED' });
    world.repo.saveCoverageReviewRequest({ ...world.repo.getCoverageReviewRequest(second.id)!, status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 사유' });
    expect(readReviewHistory(world.repo).map((entry) => entry.id)).toEqual([second.id, request.id]);
  });

  it('매핑 없이 닫힌 요청의 닫은 사람·시각은 null 이다 (지어내지 않는다)', () => {
    const { world, request } = setup();
    world.repo.saveCoverageReviewRequest({ ...world.repo.getCoverageReviewRequest(request.id)!, status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 사유' });
    expect(readReviewHistory(world.repo)[0]).toMatchObject({ id: request.id, mapping: null, closedBy: null, closedAt: null, resultMappingRef: null });
  });

  it('닫힌 뒤에도 현재 게시값을 다시 읽는다: 숨긴 치료의 이력 항목은 HIDDEN 이다', () => {
    const { world, approved } = twoClosed();
    world.repo.saveTreatment(makeTreatment({ active: false }));
    expect(readReviewHistory(world.repo).find((entry) => entry.id === approved.id)!.current).toEqual({ state: 'HIDDEN' });
  });
});
