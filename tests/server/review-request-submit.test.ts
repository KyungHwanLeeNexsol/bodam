import { describe, expect, it } from 'vitest';
import { approve, reject, submitForReview } from '../../src/server/approval';
import { publishCatalog } from '../../src/server/catalog-publish';
import type { ProposedCoverageInfo } from '../../src/server/domain/entities';
import { createMappingDraftFromRequest, submitCoverageReviewRequest } from '../../src/server/review-request';
import { readClinicReviewRequestViews, readReviewQueue, reviewRequestView } from '../../src/server/review-request-read';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { T1, T2 } from '../fixtures/server/base-fee.fixture';
import { T3, addThirdTreatment, changedKeys, repoThrowingOn } from '../fixtures/server/catalog-structure.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { baseContent } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID } from '../fixtures/server/versioning.fixture';
import { repoWith } from '../api/helpers';

// 병원 관리자의 검토 요청 제출 (M7 검토 요청, design.md 권한 표 · DD-19 · AC-023a/b/c, AC-022). 도메인 층 시험이다(HTTP 없음).
// 요청은 제안 기록일 뿐이다: 치료·치료 버전·카탈로그·매핑·규칙 묶음은 어떤 것도 바뀌지 않는다.
// 세계: 병원 1 에 치료 셋(T1·T2·T3)과 승인된 매핑·게시된 규칙 묶음, 병원 2 에 치료 하나.

const HA = TEST_FIXTURE_HA_1;
const CLINIC = TEST_FIXTURE_CLINIC_ID;
const PROPOSED: ProposedCoverageInfo = { benefitType: 'NON_BENEFIT', procedureCodes: ['TEST_FIXTURE_PROPOSED_PROC'], calcClass: 'MAJOR_THREE_NON_BENEFIT' };

function setup(): World {
  const { world } = buildWorld();
  publishSecondClinicCatalog(world);
  addThirdTreatment(world);
  return world;
}

const submit = (world: World, treatmentId: string, clinicId: string = CLINIC, proposed: ProposedCoverageInfo = PROPOSED) =>
  submitCoverageReviewRequest(world.deps, HA, clinicId, treatmentId, structuredClone(proposed));

describe('submitCoverageReviewRequest: 성공', () => {
  it('열린 요청 한 건과 감사 기록 한 건만 만든다 (요청자는 행위자, 제안 값은 복사본)', () => {
    const world = setup();
    world.clock.set('2026-10-16T13:00:00.000Z');
    const before = world.repo.exportState();
    const proposed = structuredClone(PROPOSED);
    const created = submitCoverageReviewRequest(world.deps, HA, CLINIC, T1, proposed);

    expect(created).toMatchObject({ clinicId: CLINIC, treatmentId: T1, proposed: PROPOSED, requestedBy: { id: HA.id, role: 'HA' }, requestedAt: '2026-10-16T13:00:00.000Z', status: 'REVIEW_REQUESTED', rejectionReason: null, draftMappingRef: null, resultMappingRef: null });
    proposed.procedureCodes.push('나중에 바꿈');
    expect(world.repo.getCoverageReviewRequest(created.id)!.proposed).toEqual(PROPOSED);
    expect(changedKeys(before, world.repo.exportState())).toEqual(['auditLog', 'reviewRequests']);
    expect(world.repo.listAuditLog().at(-1)).toMatchObject({ action: 'REVIEW_REQUEST_CREATE', target: created.id, actorId: HA.id, role: 'HA' });
  });

  it('제안은 게시된 판단 값을 덮어쓰지 않는다: 치료 버전의 분류·급여 구분·치료 코드·행위 코드와 치료 기록이 그대로다', () => {
    const world = setup();
    const versionsBefore = world.repo.listTreatmentVersions(T1);
    const treatmentBefore = world.repo.getTreatment(T1);
    submit(world, T1);
    expect(world.repo.listTreatmentVersions(T1)).toEqual(versionsBefore);
    expect(versionsBefore[0]).toMatchObject({ calcClass: 'GENERAL_BENEFIT', benefitType: 'BENEFIT', treatmentCode: 'TEST_FIXTURE_TC_1', procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'] });
    expect(world.repo.getTreatment(T1)).toEqual(treatmentBefore);
    expect(world.repo.listItemVersions('MAPPING').length).toBeGreaterThan(0);
  });

  it('서로 다른 치료는 각자 열린 요청을 가질 수 있다', () => {
    const world = setup();
    const first = submit(world, T1);
    const second = submit(world, T2);
    expect(first.id).not.toBe(second.id);
    expect(world.repo.listCoverageReviewRequests(CLINIC).map((request) => request.treatmentId)).toEqual([T1, T2]);
  });
});

describe('submitCoverageReviewRequest: 거절 (저장 상태는 그대로)', () => {
  const rejection = (world: World, treatmentId: string, clinicId: string = CLINIC) => catchDomainError(() => submit(world, treatmentId, clinicId));

  it.each([
    ['없는 치료 id', 'TEST_FIXTURE_NO_SUCH_TREATMENT'],
    ['다른 병원의 치료 id', OTHER_CLINIC_TREATMENT_ID],
    ['빈 치료 id', ''],
  ])('%s: 같은 INVALID_INPUT TREATMENT_NOT_IN_CATALOG (다른 병원의 존재를 드러내지 않는다)', (_name, treatmentId) => {
    const world = setup();
    const before = world.repo.exportState();
    const error = rejection(world, treatmentId);
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toEqual([{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'treatmentId' }]);
    expect(world.repo.exportState()).toEqual(before);
  });

  it('숨긴(active=false) 치료도 현재 게시 치료가 아니므로 같은 거절이다', () => {
    const world = setup();
    world.repo.saveTreatment({ ...world.repo.getTreatment(T2)!, active: false });
    const before = world.repo.exportState();
    const hidden = rejection(world, T2);
    const unknown = rejection(world, 'TEST_FIXTURE_NO_SUCH_TREATMENT');
    expect([hidden.code, hidden.defects]).toEqual([unknown.code, unknown.defects]);
    expect(world.repo.exportState()).toEqual(before);
  });

  it('게시한 적이 없는 병원은 모든 치료가 없는 것과 같다 / 병원이 없으면 NOT_FOUND', () => {
    const world = setup();
    world.repo.saveClinic({ ...world.repo.getClinic(CLINIC)!, id: 'TEST_FIXTURE_CLINIC_EMPTY', slug: 'test-fixture-clinic-empty', currentCatalogVersionId: null });
    const before = world.repo.exportState();
    expect(rejection(world, T1, 'TEST_FIXTURE_CLINIC_EMPTY').defects).toEqual([{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'treatmentId' }]);
    expect(rejection(world, T1, 'TEST_FIXTURE_CLINIC_GHOST').code).toBe('NOT_FOUND');
    expect(world.repo.exportState()).toEqual(before);
  });

  it.each([TEST_FIXTURE_RV_AUTHOR, TEST_FIXTURE_PO_1])('역할 %o 는 제출할 수 없다 (ROLE_NOT_PERMITTED)', (actor) => {
    const world = setup();
    const before = world.repo.exportState();
    expect(catchDomainError(() => submitCoverageReviewRequest(world.deps, actor, CLINIC, T1, PROPOSED)).code).toBe('ROLE_NOT_PERMITTED');
    expect(world.repo.exportState()).toEqual(before);
  });

  it('카탈로그의 참조가 깨져 있으면 서버 데이터 결함(STATE_CONFLICT + 결함 코드)이고 아무것도 쓰지 않는다', () => {
    const world = setup();
    const before = world.repo.exportState();
    const broken = { ...world.deps, repo: repoWith(world.repo, { getTreatmentVersion: () => null }) };
    const error = catchDomainError(() => submitCoverageReviewRequest(broken, HA, CLINIC, T1, PROPOSED));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toEqual([{ code: 'TREATMENT_VERSION_MISSING', path: 'catalog' }]);
    expect(world.repo.exportState()).toEqual(before);
  });
});

describe('submitCoverageReviewRequest: 중복 요청 막기 (소유자 결정)', () => {
  it('같은 치료에 열린 요청이 있으면 STATE_CONFLICT REVIEW_ALREADY_REQUESTED 이고 아무것도 저장하지 않는다 (제안이 달라도 같다)', () => {
    const world = setup();
    const first = submit(world, T1);
    const before = world.repo.exportState();
    for (const proposed of [PROPOSED, { benefitType: 'BENEFIT', procedureCodes: [], calcClass: 'NEEDS_REVIEW' } as ProposedCoverageInfo]) {
      const error = catchDomainError(() => submit(world, T1, CLINIC, proposed));
      expect(error.code).toBe('STATE_CONFLICT');
      expect(error.defects).toEqual([{ code: 'REVIEW_ALREADY_REQUESTED', path: 'treatmentId' }]);
    }
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.listCoverageReviewRequests(CLINIC)).toHaveLength(1);
    expect(world.repo.getCoverageReviewRequest(first.id)).toEqual(first);
  });

  it('다른 병원의 열린 요청은 영향이 없다 (병원 2 의 치료는 병원 2 에서 따로 요청한다)', () => {
    const world = setup();
    submit(world, T1);
    expect(() => submit(world, OTHER_CLINIC_TREATMENT_ID, OTHER_CLINIC_ID)).not.toThrow();
  });

  it('요청이 승인으로 닫히면 같은 치료에 새 요청을 낼 수 있다 (실제 매핑 초안 → 제출 → 승인 흐름)', () => {
    const world = setup();
    const first = submit(world, T1);
    const draft = createMappingDraftFromRequest(world.deps, TEST_FIXTURE_RV_AUTHOR, first.id, baseContent('MAPPING', 1, T1));
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, draft.ref);
    approve(world.deps, TEST_FIXTURE_RV_APPROVER, draft.ref);
    expect(world.repo.getCoverageReviewRequest(first.id)!.status).toBe('APPROVED');

    const second = submit(world, T1);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('REVIEW_REQUESTED');
    // 이제 둘째가 열려 있으므로 또 막힌다.
    expect(catchDomainError(() => submit(world, T1)).defects).toEqual([{ code: 'REVIEW_ALREADY_REQUESTED', path: 'treatmentId' }]);
  });

  it('요청이 반려로 닫히면 같은 치료에 새 요청을 낼 수 있다', () => {
    const world = setup();
    const first = submit(world, T1);
    const draft = createMappingDraftFromRequest(world.deps, TEST_FIXTURE_RV_AUTHOR, first.id, baseContent('MAPPING', 1, T1));
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, draft.ref);
    reject(world.deps, TEST_FIXTURE_RV_APPROVER, draft.ref, 'TEST_FIXTURE 반려 사유');
    expect(world.repo.getCoverageReviewRequest(first.id)).toMatchObject({ status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 반려 사유' });
    expect(submit(world, T1).status).toBe('REVIEW_REQUESTED');
  });
});

describe('submitCoverageReviewRequest: 원자성', () => {
  it('요청을 저장한 뒤 감사 기록 쓰기가 실패하면 요청도 함께 되돌려진다', () => {
    const world = setup();
    const before = world.repo.exportState();
    const failing = repoThrowingOn(world.repo, 'appendAuditLog');
    expect(() => submitCoverageReviewRequest({ ...world.deps, repo: failing.repo }, HA, CLINIC, T1, PROPOSED)).toThrow('INJECTED_FAILURE:appendAuditLog');
    expect(failing.calls).toHaveLength(1);
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.listCoverageReviewRequests(CLINIC)).toEqual([]);
  });

  it('요청 저장 자체가 실패해도 아무것도 남지 않는다', () => {
    const world = setup();
    const before = world.repo.exportState();
    const failing = repoThrowingOn(world.repo, 'saveCoverageReviewRequest');
    expect(() => submitCoverageReviewRequest({ ...world.deps, repo: failing.repo }, HA, CLINIC, T1, PROPOSED)).toThrow('INJECTED_FAILURE:saveCoverageReviewRequest');
    expect(world.repo.exportState()).toEqual(before);
  });
});

describe('읽기 보기: reviewRequestView · readClinicReviewRequestViews', () => {
  it('보기의 키는 정해진 목록뿐이다: 매핑 참조·병원 id·요청자 역할을 싣지 않고, 요청자는 사용자 id 문자열이다', () => {
    const world = setup();
    const created = submit(world, T1);
    const view = reviewRequestView(world.repo, created);
    expect(Object.keys(view).sort()).toEqual(['classification', 'id', 'proposed', 'rejectionReason', 'requestedAt', 'requestedBy', 'status', 'treatmentId', 'treatmentName']);
    expect(view).toEqual({
      id: created.id,
      treatmentId: T1,
      treatmentName: world.repo.listTreatmentVersions(T1).at(-1)!.displayName,
      proposed: PROPOSED,
      status: 'REVIEW_REQUESTED',
      rejectionReason: null,
      requestedAt: created.requestedAt,
      requestedBy: HA.id,
      classification: 'CLASSIFIED',
    });
    expect(JSON.stringify(view)).not.toMatch(/draftMappingRef|resultMappingRef|clinicId/);
  });

  it('치료 이름은 그 치료의 가장 최근 버전의 표시 이름이다', () => {
    const world = setup();
    const created = submit(world, T1);
    const current = world.repo.getClinicCurrentCatalogVersion(CLINIC)!;
    const versions = current.treatmentVersionIds.map((id) => world.repo.getTreatmentVersion(id)!);
    publishCatalog(
      world.deps,
      HA,
      CLINIC,
      {
        treatmentVersions: versions.map((version) => (version.treatmentId === T1 ? makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1_NEXT', treatmentId: T1, displayName: 'TEST_FIXTURE 새 이름', patientAmount: 12_000 }) : version)),
        commonBaseFees: current.baseFeeIds.map((id) => world.repo.getCommonBaseFee(id)!),
      },
      TEST_CATALOG_CONFIG,
    );
    expect(reviewRequestView(world.repo, created).treatmentName).toBe('TEST_FIXTURE 새 이름');
  });

  it('치료 버전이 하나도 없으면 treatmentName 은 null 이다', () => {
    const world = setup();
    const created = submit(world, T1);
    expect(reviewRequestView(repoWith(world.repo, { listTreatmentVersions: () => [] }), created).treatmentName).toBeNull();
  });

  it('병원 목록은 최신순(요청 시각 내림차순, 같으면 id 코드 포인트 내림차순)이고 그 병원의 요청만 담는다', () => {
    const world = setup();
    world.clock.set('2026-10-16T10:00:00.000Z');
    const a = submit(world, T1);
    world.clock.set('2026-10-16T12:00:00.000Z');
    const b = submit(world, T2);
    const c = submit(world, T3); // b 와 같은 시각: id 가 더 큰 쪽(c)이 앞이다
    world.clock.set('2026-10-16T11:00:00.000Z');
    submit(world, OTHER_CLINIC_TREATMENT_ID, OTHER_CLINIC_ID);
    expect(readClinicReviewRequestViews(world.repo, CLINIC).map((view) => view.id)).toEqual([c.id, b.id, a.id]);
    expect(readClinicReviewRequestViews(world.repo, OTHER_CLINIC_ID)).toHaveLength(1);
    expect(readClinicReviewRequestViews(world.repo, 'TEST_FIXTURE_CLINIC_GHOST')).toEqual([]);
  });

  it('닫힌 요청의 처리 결과(상태·반려 사유)를 보여 주되 결과 매핑 id 는 싣지 않는다', () => {
    const world = setup();
    const first = submit(world, T1);
    const draft = createMappingDraftFromRequest(world.deps, TEST_FIXTURE_RV_AUTHOR, first.id, baseContent('MAPPING', 1, T1));
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, draft.ref);
    reject(world.deps, TEST_FIXTURE_RV_APPROVER, draft.ref, 'TEST_FIXTURE 반려 사유');
    const [view] = readClinicReviewRequestViews(world.repo, CLINIC);
    expect(view).toMatchObject({ id: first.id, status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 반려 사유' });
    expect(JSON.stringify(view)).not.toContain(draft.ref.id);
  });
});

describe('읽기 보기: readReviewQueue (RV 대기열)', () => {
  it('모든 병원의 열린 요청만, 오래된 순(요청 시각 오름차순, 같으면 병원 id, 요청 id)으로 낸다', () => {
    const world = setup();
    world.clock.set('2026-10-16T10:00:00.000Z');
    const c1 = submit(world, T1);
    world.clock.set('2026-10-16T09:00:00.000Z');
    const c2 = submit(world, OTHER_CLINIC_TREATMENT_ID, OTHER_CLINIC_ID);
    world.clock.set('2026-10-16T10:00:00.000Z');
    const c3 = submit(world, T2);
    // 닫힌 요청은 대기열에 없다.
    world.clock.set('2026-10-16T08:00:00.000Z');
    const closed = submit(world, T3);
    world.repo.saveCoverageReviewRequest({ ...closed, status: 'APPROVED' });

    const queue = readReviewQueue(world.repo);
    expect(queue.map((entry) => entry.id)).toEqual([c2.id, c1.id, c3.id]);
    expect(queue.map((entry) => entry.clinic.id)).toEqual([OTHER_CLINIC_ID, CLINIC, CLINIC]);
    expect(queue.every((entry) => entry.status === 'REVIEW_REQUESTED')).toBe(true);
  });

  it('항목: 병원 {id, name} · 보기 필드 · 현재 게시본의 치료 내용(current)', () => {
    const world = setup();
    const created = submit(world, T1);
    const [entry] = readReviewQueue(world.repo);
    expect(entry).toEqual({
      ...reviewRequestView(world.repo, created),
      clinic: { id: CLINIC, name: world.repo.getClinic(CLINIC)!.name },
      current: { state: 'PUBLISHED', displayName: world.repo.listTreatmentVersions(T1).at(-1)!.displayName, treatmentCode: 'TEST_FIXTURE_TC_1', benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'], calcClass: 'GENERAL_BENEFIT' },
      // 매핑 초안이 아직 없다: 매핑 칸은 비고, 검토 기준도 없으며, 승인할 대상이 없으므로 승인 차단 사유도 없다.
      mapping: null,
      basis: { check: 'MISSING', changedFields: [], reviewed: null },
      approvalBlockedReason: null,
    });
  });

  it('현재 카탈로그가 없으면 current 는 { state: NOT_IN_CATALOG } 이다 (null 이 아니다)', () => {
    const world = setup();
    submit(world, T1);
    const empty = repoWith(world.repo, { getClinicCurrentCatalogVersion: () => null });
    expect(readReviewQueue(empty)[0]!.current).toEqual({ state: 'NOT_IN_CATALOG' });
  });

  it('요청이 하나도 없으면 빈 목록이다', () => {
    expect(readReviewQueue(setup().repo)).toEqual([]);
  });

  it('읽기만 한다: 저장소 상태가 그대로다', () => {
    const world = setup();
    submit(world, T1);
    const before = world.repo.exportState();
    readReviewQueue(world.repo);
    readClinicReviewRequestViews(world.repo, CLINIC);
    expect(world.repo.exportState()).toEqual(before);
  });
});
