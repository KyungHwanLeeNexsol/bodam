import { describe, expect, it } from 'vitest';
import { approve, reject, submitForReview, suspendItem } from '../../src/server/approval';
import { createDraft, createNextDraft, editDraft } from '../../src/server/authoring';
import type { ProposedCoverageInfo } from '../../src/server/domain/entities';
import type { MappingContent } from '../../src/server/domain/items';
import { createCoverageReviewRequest, createMappingDraftFromRequest, readClinicReviewRequests, readReviewRequest } from '../../src/server/review-request';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeClinic, makeTreatment } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_FIXTURE_TREATMENT_ID, baseContent, forceState, newWorld, seedTreatment } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 매핑 작성 주체와 검토 요청 기록 (design.md DD-17 "매핑 작성 주체", DD-18 CoverageReviewRequest, 소유자 결정 #34).
// HA 의 "검토 요청"은 기록만 만들고 매핑을 만들지 않는다. RV 가 그 요청으로 매핑 초안을 만들고, 승인·반려가 요청을 닫는다.
// AC-024a·AC-025b·AC-022 는 M7 이 닫는다: 여기서는 도메인 서비스 쪽 증거만 낸다.

const PROPOSED: ProposedCoverageInfo = { benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A'], calcClass: 'GENERAL_BENEFIT' };

function setup(): World {
  const w = newWorld();
  seedTreatment(w.repo);
  return w;
}

function request(w: World) {
  return createCoverageReviewRequest(w.deps, TEST_FIXTURE_HA_1, { clinicId: TEST_FIXTURE_CLINIC_ID, treatmentId: TEST_FIXTURE_TREATMENT_ID, proposed: structuredClone(PROPOSED) });
}

function mappingContent(n = 1): MappingContent {
  return baseContent('MAPPING', n);
}

/** 요청 → RV 가 만든 매핑 초안 → 제출까지 마친 상태. */
function submittedFromRequest(w: World) {
  const created = request(w);
  const draft = createMappingDraftFromRequest(w.deps, TEST_FIXTURE_RV_AUTHOR, created.id, mappingContent());
  submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, draft.ref);
  return { created, ref: draft.ref };
}

describe('검토 요청 만들기 (HA)', () => {
  it('HA 가 만들면 REVIEW_REQUESTED 기록 하나만 생기고 매핑은 만들어지지 않는다', () => {
    const w = setup();
    w.clock.set('2026-10-16T13:00:00.000Z');
    const created = request(w);

    expect(created).toEqual({
      id: 'TEST_FIXTURE_REVIEW_REQUEST_1',
      clinicId: TEST_FIXTURE_CLINIC_ID,
      treatmentId: TEST_FIXTURE_TREATMENT_ID,
      proposed: PROPOSED,
      requestedBy: { id: 'TEST_FIXTURE_HA_1', role: 'HA' },
      requestedAt: '2026-10-16T13:00:00.000Z',
      status: 'REVIEW_REQUESTED',
      rejectionReason: null,
      draftMappingRef: null,
      resultMappingRef: null,
    });
    expect(w.repo.getCoverageReviewRequest(created.id)).toEqual(created);
    expect(w.repo.listItemVersions('MAPPING')).toEqual([]);
    expect(w.repo.listAuditLog()).toEqual([
      {
        id: 'TEST_FIXTURE_AUDIT_1',
        actorId: 'TEST_FIXTURE_HA_1',
        role: 'HA',
        action: 'REVIEW_REQUEST_CREATE',
        target: created.id,
        beforeVersion: null,
        afterVersion: 'REVIEW_REQUESTED',
        reason: null,
        at: '2026-10-16T13:00:00.000Z',
      },
    ]);
  });

  it.each([TEST_FIXTURE_RV_AUTHOR, TEST_FIXTURE_PO_1])('역할 %o 는 만들 수 없다 (ROLE_NOT_PERMITTED)', (actor) => {
    const w = setup();
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => createCoverageReviewRequest(w.deps, actor, { clinicId: TEST_FIXTURE_CLINIC_ID, treatmentId: TEST_FIXTURE_TREATMENT_ID, proposed: PROPOSED })).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('치료가 없으면 NOT_FOUND, 병원이 없으면 NOT_FOUND, 다른 병원의 치료이면 REF_CONTENT_MISMATCH 이다', () => {
    const w = setup();
    w.repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_2', slug: 'test-fixture-clinic-2', currentCatalogVersionId: null }));
    w.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_OF_CLINIC_2', clinicId: 'TEST_FIXTURE_CLINIC_2' }));
    const before = snapshotOf(w.repo);
    const attempt = (clinicId: string, treatmentId: string) => () => createCoverageReviewRequest(w.deps, TEST_FIXTURE_HA_1, { clinicId, treatmentId, proposed: PROPOSED });
    expect(catchDomainError(attempt(TEST_FIXTURE_CLINIC_ID, 'TEST_FIXTURE_NOPE')).code).toBe('NOT_FOUND');
    expect(catchDomainError(attempt('TEST_FIXTURE_CLINIC_NOPE', TEST_FIXTURE_TREATMENT_ID)).code).toBe('NOT_FOUND');
    expect(catchDomainError(attempt(TEST_FIXTURE_CLINIC_ID, 'TEST_FIXTURE_TREATMENT_OF_CLINIC_2')).code).toBe('REF_CONTENT_MISMATCH');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('제안 정보는 복사해 저장한다 (호출자가 나중에 고쳐도 기록은 그대로)', () => {
    const w = setup();
    const proposed = structuredClone(PROPOSED);
    const created = createCoverageReviewRequest(w.deps, TEST_FIXTURE_HA_1, { clinicId: TEST_FIXTURE_CLINIC_ID, treatmentId: TEST_FIXTURE_TREATMENT_ID, proposed });
    proposed.procedureCodes.push('MUTATED');
    created.proposed.procedureCodes.push('MUTATED');
    expect(w.repo.getCoverageReviewRequest(created.id)?.proposed.procedureCodes).toEqual(['TEST_FIXTURE_PROC_A']);
  });
});

describe('매핑 초안은 RV 만 만든다 (소유자 결정 #34)', () => {
  it('HA 는 요청으로도, 직접도 매핑 초안을 만들 수 없다 (ROLE_NOT_PERMITTED, 전후 비교가 같다)', () => {
    const w = setup();
    const created = request(w);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => createMappingDraftFromRequest(w.deps, TEST_FIXTURE_HA_1, created.id, mappingContent())).code).toBe('ROLE_NOT_PERMITTED');
    expect(catchDomainError(() => createDraft(w.deps, TEST_FIXTURE_HA_1, 'MAPPING', mappingContent())).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.listItemVersions('MAPPING')).toEqual([]);
  });

  it('RV 가 요청으로 만든 초안: 작성자는 RV, 요청에는 초안 링크가 남고 요청은 아직 열려 있다', () => {
    const w = setup();
    const created = request(w);
    const draft = createMappingDraftFromRequest(w.deps, TEST_FIXTURE_RV_AUTHOR, created.id, mappingContent());
    expect(draft.authorId).toBe('TEST_FIXTURE_RV_AUTHOR');
    expect(w.repo.getItemState(draft.ref)?.state).toBe('DRAFT');
    expect(w.repo.getCoverageReviewRequest(created.id)).toEqual({ ...created, draftMappingRef: draft.ref });
    expect(w.repo.listAuditLog().map((entry) => entry.action)).toEqual(['REVIEW_REQUEST_CREATE', 'ITEM_CREATE_DRAFT', 'REVIEW_REQUEST_DRAFT_LINK']);
    expect(w.repo.listAuditLog().at(-1)).toMatchObject({ actorId: 'TEST_FIXTURE_RV_AUTHOR', role: 'RV', target: created.id, beforeVersion: 'REVIEW_REQUESTED', afterVersion: 'REVIEW_REQUESTED' });
  });

  it('요청이 없으면 NOT_FOUND, 요청의 치료와 다른 치료를 가리키는 내용이면 REF_CONTENT_MISMATCH 이다', () => {
    const w = setup();
    const created = request(w);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => createMappingDraftFromRequest(w.deps, TEST_FIXTURE_RV_AUTHOR, 'TEST_FIXTURE_NOPE', mappingContent())).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => createMappingDraftFromRequest(w.deps, TEST_FIXTURE_RV_AUTHOR, created.id, baseContent('MAPPING', 1, 'TEST_FIXTURE_TREATMENT_OTHER'))).code).toBe('REF_CONTENT_MISMATCH');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('한 요청에 초안은 하나뿐이다 (두 번째는 STATE_CONFLICT), 닫힌 요청에도 만들 수 없다', () => {
    const w = setup();
    const created = request(w);
    createMappingDraftFromRequest(w.deps, TEST_FIXTURE_RV_AUTHOR, created.id, mappingContent(1));
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => createMappingDraftFromRequest(w.deps, TEST_FIXTURE_RV_AUTHOR, created.id, mappingContent(2))).code).toBe('STATE_CONFLICT');
    expect(snapshotOf(w.repo)).toEqual(before);

    const w2 = setup();
    const { created: closed, ref } = submittedFromRequest(w2);
    approve(w2.deps, TEST_FIXTURE_RV_APPROVER, ref);
    expect(w2.repo.getCoverageReviewRequest(closed.id)?.status).toBe('APPROVED');
    expect(catchDomainError(() => createMappingDraftFromRequest(w2.deps, TEST_FIXTURE_RV_AUTHOR, closed.id, mappingContent(3))).code).toBe('STATE_CONFLICT');
  });
});

describe('승인·반려가 요청을 닫는다', () => {
  it('매핑을 승인하면 요청이 APPROVED 로 닫히고 결과 매핑 버전이 담긴다', () => {
    const w = setup();
    const { created, ref } = submittedFromRequest(w);
    w.clock.set('2026-10-16T14:00:00.000Z');
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);

    expect(w.repo.getCoverageReviewRequest(created.id)).toEqual({ ...created, status: 'APPROVED', draftMappingRef: ref, resultMappingRef: ref, rejectionReason: null });
    expect(w.repo.listAuditLog().filter((entry) => entry.action === 'REVIEW_REQUEST_CLOSE')).toEqual([
      {
        id: expect.any(String),
        actorId: 'TEST_FIXTURE_RV_APPROVER',
        role: 'RV',
        action: 'REVIEW_REQUEST_CLOSE',
        target: created.id,
        beforeVersion: 'REVIEW_REQUESTED',
        afterVersion: 'APPROVED',
        reason: null,
        at: '2026-10-16T14:00:00.000Z',
      },
    ]);
  });

  it('매핑을 반려하면 요청이 REJECTED 로 닫히고 반려 사유가 담기며 결과 매핑은 없다', () => {
    const w = setup();
    const { created, ref } = submittedFromRequest(w);
    reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 반려 사유');
    expect(w.repo.getCoverageReviewRequest(created.id)).toEqual({ ...created, status: 'REJECTED', draftMappingRef: ref, resultMappingRef: null, rejectionReason: 'TEST_FIXTURE 반려 사유' });
    expect(w.repo.listAuditLog().at(-1)).toMatchObject({ action: 'REVIEW_REQUEST_CLOSE', target: created.id, beforeVersion: 'REVIEW_REQUESTED', afterVersion: 'REJECTED', reason: 'TEST_FIXTURE 반려 사유' });
  });

  it('본인 승인이 거절되면 요청도 열린 채 그대로다 (저장소 전후 비교가 같다)', () => {
    const w = setup();
    const { created, ref } = submittedFromRequest(w);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => approve(w.deps, TEST_FIXTURE_RV_AUTHOR, ref)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getCoverageReviewRequest(created.id)?.status).toBe('REVIEW_REQUESTED');
    expect(w.repo.getCoverageReviewRequest(created.id)?.resultMappingRef).toBeNull();
  });

  it('반려 사유가 비어 거절되면 요청도 그대로다', () => {
    const w = setup();
    const { created, ref } = submittedFromRequest(w);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, '  ')).code).toBe('REASON_REQUIRED');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getCoverageReviewRequest(created.id)?.status).toBe('REVIEW_REQUESTED');
  });

  it('이미 닫힌 요청은 나중의 재검토·재승인·재반려로 바뀌지 않는다', () => {
    const w = setup();
    const { created, ref } = submittedFromRequest(w);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    const closed = w.repo.getCoverageReviewRequest(created.id);
    const closeEntries = () => w.repo.listAuditLog().filter((entry) => entry.action === 'REVIEW_REQUEST_CLOSE').length;
    expect(closeEntries()).toBe(1);

    forceState(w.repo, ref, 'UNDER_REREVIEW');
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, ref);
    forceState(w.repo, ref, 'UNDER_REREVIEW');
    reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 재검토 반려');
    expect(w.repo.getCoverageReviewRequest(created.id)).toEqual(closed);
    expect(closeEntries()).toBe(1);
  });

  it('요청 없이 만든 매핑을 승인해도 다른 열린 요청은 닫히지 않는다', () => {
    const w = setup();
    const unrelated = request(w);
    const direct = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingContent(7));
    submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, direct.ref);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, direct.ref);
    expect(w.repo.getCoverageReviewRequest(unrelated.id)).toEqual(unrelated);
    expect(w.repo.listAuditLog().some((entry) => entry.action === 'REVIEW_REQUEST_CLOSE')).toBe(false);
  });

  it('치료가 저장소에 없는 매핑을 반려해도 닫을 요청이 없어 그냥 반려된다', () => {
    const w = newWorld();
    const draft = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingContent());
    submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, draft.ref);
    reject(w.deps, TEST_FIXTURE_RV_APPROVER, draft.ref, 'TEST_FIXTURE 사유');
    expect(w.repo.getItemState(draft.ref)?.state).toBe('REJECTED');
    expect(w.repo.listAuditLog().some((entry) => entry.action === 'REVIEW_REQUEST_CLOSE')).toBe(false);
  });

  it('프로필·서류 규칙 묶음의 승인은 검토 요청과 무관하다', () => {
    const w = setup();
    const unrelated = request(w);
    for (const kind of ['PROFILE', 'DOCUMENT_RULE_SET'] as const) {
      const draft = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
      submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, draft.ref);
      approve(w.deps, TEST_FIXTURE_RV_APPROVER, draft.ref);
    }
    expect(w.repo.getCoverageReviewRequest(unrelated.id)).toEqual(unrelated);
  });
});

describe('HA 는 읽기 전용이다', () => {
  it('요청의 상태·결과·반려 사유를 읽을 수 있고, 읽기는 저장소를 바꾸지 않으며 복사본을 돌려준다', () => {
    const w = setup();
    const { created, ref } = submittedFromRequest(w);
    reject(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 반려 사유');
    const second = request(w);
    const before = snapshotOf(w.repo);

    const read = readReviewRequest(w.repo, created.id);
    expect(read).toMatchObject({ status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 반려 사유', resultMappingRef: null });
    expect(readReviewRequest(w.repo, 'TEST_FIXTURE_NOPE')).toBeNull();
    expect(readClinicReviewRequests(w.repo, TEST_FIXTURE_CLINIC_ID).map((entry) => entry.id)).toEqual([created.id, second.id]);
    expect(readClinicReviewRequests(w.repo, 'TEST_FIXTURE_CLINIC_NOPE')).toEqual([]);

    (read as { status: string }).status = 'MUTATED';
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('HA 역할로는 그 매핑을 수정·제출·승인·반려·중지·다음 버전 만들기 어느 것도 할 수 없다', () => {
    const w = setup();
    const created = request(w);
    const draft = createMappingDraftFromRequest(w.deps, TEST_FIXTURE_RV_AUTHOR, created.id, mappingContent());
    const asHa = { id: TEST_FIXTURE_RV_AUTHOR.id, role: 'HA' as const };
    const before = snapshotOf(w.repo);
    const attempts = [
      () => editDraft(w.deps, TEST_FIXTURE_HA_1, draft.ref, mappingContent(), null),
      () => submitForReview(w.deps, asHa, draft.ref),
      () => approve(w.deps, TEST_FIXTURE_HA_1, draft.ref),
      () => reject(w.deps, TEST_FIXTURE_HA_1, draft.ref, 'TEST_FIXTURE 사유'),
      () => suspendItem(w.deps, TEST_FIXTURE_HA_1, draft.ref, 'TEST_FIXTURE 사유'),
      () => createNextDraft(w.deps, TEST_FIXTURE_HA_1, draft.ref, 'v2'),
    ];
    for (const attempt of attempts) {
      expect(catchDomainError(attempt).code).toBe('ROLE_NOT_PERMITTED');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});
