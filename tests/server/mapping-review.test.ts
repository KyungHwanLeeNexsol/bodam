import { describe, expect, it } from 'vitest';
import { submitForReview } from '../../src/server/approval';
import { createDraft } from '../../src/server/authoring';
import type { CoverageReviewRequest } from '../../src/server/domain/entities';
import type { ItemVersionRef } from '../../src/server/domain/items';
import { coverageFingerprintOf } from '../../src/server/fingerprint';
import {
  approveMappingForReviewRequest,
  checkApprovalBasis,
  createMappingDraftForReviewRequest,
  rejectMappingForReviewRequest,
  submitMappingForReviewRequest,
} from '../../src/server/mapping-review';
import type { MappingDraftInput } from '../../src/server/mapping-review';
import { createCoverageReviewRequest, createMappingDraftFromRequest } from '../../src/server/review-request';
import { repoWith } from '../api/helpers';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { TEST_FIXTURE_NOW, makeCatalogVersion, makeClinic, makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_FIXTURE_TREATMENT_ID, adoptTreatmentVersion, baseContent, newWorld, seedTreatment } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import { changedKeys } from '../fixtures/server/catalog-structure.fixture';

// 매핑 검토 서비스 (M7 매핑 검토): 열린 검토 요청 → RV 매핑 초안 → 작성자 제출 → 다른 RV 승인/반려.
// 승인은 "검토 기록"일 뿐이다: 매핑이 APPROVED 가 되고 요청이 닫힐 뿐 치료·카탈로그·규칙 묶음·범위·키오스크 계산은 바뀌지 않는다.
// 모든 거절은 아무것도 쓰지 않는다(저장소 전체 비교).

const T1 = TEST_FIXTURE_TREATMENT_ID;
const AUTHOR = TEST_FIXTURE_RV_AUTHOR;
const APPROVER = TEST_FIXTURE_RV_APPROVER;
const SOURCE = { insurerDocumentId: 'TEST_FIXTURE_DOC', revisionDate: '2026-01-01', clauseOrPage: 'TEST_FIXTURE_P1', effectiveDate: '2026-01-01', verifiedBy: 'TEST_FIXTURE_V', verifiedAt: '2026-01-02' };

function draftInput(overrides: Partial<MappingDraftInput> = {}): MappingDraftInput {
  return {
    scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
    decision: 'COVERED',
    groupKey: 'TEST_FIXTURE_GROUP',
    validity: { from: '2026-01-01', to: '2026-12-31' },
    policySources: [{ ...SOURCE }],
    origin: 'TEST_FIXTURE',
    ...overrides,
  };
}

function setup(treatment: Parameters<typeof seedTreatment>[1] = {}): { world: World; request: CoverageReviewRequest } {
  const world = newWorld();
  seedTreatment(world.repo, treatment);
  const request = openRequest(world);
  return { world, request };
}

function openRequest(world: World, treatmentId: string = T1): CoverageReviewRequest {
  return createCoverageReviewRequest(world.deps, TEST_FIXTURE_HA_1, {
    clinicId: TEST_FIXTURE_CLINIC_ID,
    treatmentId,
    proposed: { benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A'], calcClass: 'GENERAL_BENEFIT' },
  });
}

function drafted(world: World, request: CoverageReviewRequest): ItemVersionRef {
  return createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput()).draft.ref;
}

function submitted(world: World, request: CoverageReviewRequest): ItemVersionRef {
  const ref = drafted(world, request);
  submitMappingForReviewRequest(world.deps, AUTHOR, request.id, ref);
  return ref;
}

/** 수정 전/후가 같은지 한 번에 확인하는 도우미. */
function expectNothingWritten(world: World, before: Record<string, unknown>): void {
  expect(snapshotOf(world.repo)).toEqual(before);
}

const stateOf = (world: World, ref: ItemVersionRef) => world.repo.getItemState(ref)!;
const requestOf = (world: World, id: string) => world.repo.getCoverageReviewRequest(id)!;

describe('초안 작성 (createMappingDraftForReviewRequest)', () => {
  it('서버가 매핑 내용을 만든다: id 는 생성기, 버전 "1", 치료는 요청의 치료, 작성자는 행위자이고 상태는 DRAFT', () => {
    const { world, request } = setup();
    world.clock.set('2026-10-20T01:00:00.000Z');
    const { draft, request: updated } = createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput());
    expect(draft.ref).toEqual({ kind: 'MAPPING', id: 'TEST_FIXTURE_MAPPING_1', version: '1' });
    expect(draft.content).toEqual({
      id: 'TEST_FIXTURE_MAPPING_1',
      version: '1',
      treatmentId: T1,
      scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
      decision: 'COVERED',
      groupKey: 'TEST_FIXTURE_GROUP',
      origin: 'TEST_FIXTURE',
      validity: { from: '2026-01-01', to: '2026-12-31' },
      policySources: [SOURCE],
    });
    expect(draft.authorId).toBe(AUTHOR.id);
    expect(stateOf(world, draft.ref).state).toBe('DRAFT');
    expect(updated.draftMappingRef).toEqual(draft.ref);
    expect(requestOf(world, request.id)).toEqual(updated);
    expect(updated.status).toBe('REVIEW_REQUESTED');
  });

  it('EXCLUDED 도 만든다: groupKey 없이 제외 사유를 담는다', () => {
    const { world, request } = setup();
    const { draft } = createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput({ decision: 'EXCLUDED', groupKey: undefined, exclusionReason: 'TEST_FIXTURE 제외 사유' }));
    expect(draft.content).toMatchObject({ decision: 'EXCLUDED', exclusionReason: 'TEST_FIXTURE 제외 사유' });
    expect('groupKey' in draft.content).toBe(false);
  });

  it('검토 기준(reviewedBasis)을 그 시점의 현재 게시 버전에서 떠 둔다: 지문 · 판단 필드(행위 코드는 코드 포인트 순) · 카탈로그 버전 · 시각', () => {
    const { world, request } = setup({ procedureCodes: ['TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_A'] });
    world.clock.set('2026-10-20T02:00:00.000Z');
    const { request: updated } = createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput());
    const version = world.repo.getTreatmentVersion('TEST_FIXTURE_TV_1')!;
    expect(updated.reviewedBasis).toEqual({
      fingerprint: coverageFingerprintOf(version),
      fields: { treatmentCode: 'TEST_FIXTURE_TC_1', procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'], benefitType: 'BENEFIT', calcClass: 'GENERAL_BENEFIT' },
      catalogVersionId: 'TEST_FIXTURE_CATALOG_1',
      capturedAt: '2026-10-20T02:00:00.000Z',
    });
    // 저장소의 치료 버전은 건드리지 않는다(정렬은 떠 둔 사본에만).
    expect(world.repo.getTreatmentVersion('TEST_FIXTURE_TV_1')!.procedureCodes).toEqual(['TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_A']);
  });

  it('치료가 요청의 치료와 다르게 오면 기존 REF_CONTENT_MISMATCH 가 막는다 (아무것도 쓰지 않는다)', () => {
    const { world, request } = setup();
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput({ treatmentId: 'TEST_FIXTURE_TREATMENT_2' })));
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expectNothingWritten(world, before);
  });

  it('요청과 같은 치료를 명시해도 된다', () => {
    const { world, request } = setup();
    const { draft } = createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput({ treatmentId: T1 }));
    expect(draft.content.treatmentId).toBe(T1);
  });

  it.each([['HA', TEST_FIXTURE_HA_1], ['PO', TEST_FIXTURE_PO_1]])('역할 %s 는 만들 수 없다 (ROLE_NOT_PERMITTED)', (_name, actor) => {
    const { world, request } = setup();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createMappingDraftForReviewRequest(world.deps, actor, request.id, draftInput())).code).toBe('ROLE_NOT_PERMITTED');
    expectNothingWritten(world, before);
  });

  it('요청이 없으면 NOT_FOUND', () => {
    const { world } = setup();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createMappingDraftForReviewRequest(world.deps, AUTHOR, 'TEST_FIXTURE_NO_SUCH', draftInput())).code).toBe('NOT_FOUND');
    expectNothingWritten(world, before);
  });

  it('이미 초안이 있거나 닫힌 요청이면 STATE_CONFLICT (기존 규칙)', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput())).code).toBe('STATE_CONFLICT');
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);
    const afterClose = snapshotOf(world.repo);
    expect(catchDomainError(() => createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput())).code).toBe('STATE_CONFLICT');
    expectNothingWritten(world, afterClose);
    expect(before).not.toEqual(afterClose);
  });

  it('숨긴 치료: STATE_CONFLICT TREATMENT_HIDDEN, 아무것도 쓰지 않는다', () => {
    const { world, request } = setup();
    world.repo.saveTreatment(makeTreatment({ active: false }));
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput()));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toEqual([{ code: 'TREATMENT_HIDDEN', path: 'catalog' }]);
    expectNothingWritten(world, before);
  });

  it('현재 카탈로그에 없는 치료: TREATMENT_NOT_IN_CATALOG', () => {
    const { world, request } = setup();
    dropTreatmentFromCatalog(world);
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => createMappingDraftForReviewRequest(world.deps, AUTHOR, request.id, draftInput()));
    expect(error.defects).toEqual([{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'catalog' }]);
    expectNothingWritten(world, before);
  });

  it('현재 게시값을 읽을 수 없으면(카탈로그 참조 결함): CURRENT_VALUES_UNREADABLE', () => {
    const { world, request } = setup();
    const before = snapshotOf(world.repo);
    const broken = { ...world.deps, repo: repoWith(world.repo, { getTreatmentVersion: () => null }) as typeof world.repo };
    const error = catchDomainError(() => createMappingDraftForReviewRequest(broken, AUTHOR, request.id, draftInput()));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toEqual([{ code: 'CURRENT_VALUES_UNREADABLE', path: 'catalog' }]);
    expectNothingWritten(world, before);
  });
});

/** 현재 카탈로그를 다른 치료만 담는 새 카탈로그로 바꿔 T1 이 게시 목록에서 빠지게 한다. */
function dropTreatmentFromCatalog(world: World): void {
  world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_2', sortOrder: 2 }));
  const other = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentId: 'TEST_FIXTURE_TREATMENT_2' });
  world.repo.putTreatmentVersion(other);
  const catalog = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_DROP', treatmentVersionIds: [other.id], baseFeeIds: [] });
  world.repo.putCatalogVersion(catalog);
  world.repo.saveClinic(makeClinic({ currentCatalogVersionId: catalog.id }));
}

describe('제출 · 승인 · 반려의 정상 흐름', () => {
  it('요청 → RV-1 초안 → RV-1 제출 → RV-2 승인: 요청 APPROVED(결과 매핑 연결) · 매핑 APPROVED(PUBLISHED 아님) · 승인 지문은 현재 게시 지문과 같다', () => {
    const { world, request } = setup();
    const ref = drafted(world, request);
    submitMappingForReviewRequest(world.deps, AUTHOR, request.id, ref);
    expect(stateOf(world, ref).state).toBe('REVIEW_REQUESTED');
    expect(requestOf(world, request.id).status).toBe('REVIEW_REQUESTED');

    world.clock.set('2026-10-21T05:00:00.000Z');
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);

    const state = stateOf(world, ref);
    expect(state.state).toBe('APPROVED');
    expect(state.approver).toEqual({ approverId: APPROVER.id, approvedAt: '2026-10-21T05:00:00.000Z' });
    expect(state.approvedFingerprint).toBe(coverageFingerprintOf(world.repo.getTreatmentVersion('TEST_FIXTURE_TV_1')!));
    expect(state.approvedFingerprint).toBe(requestOf(world, request.id).reviewedBasis!.fingerprint);
    const closed = requestOf(world, request.id);
    expect(closed.status).toBe('APPROVED');
    expect(closed.resultMappingRef).toEqual(ref);
    expect(closed.rejectionReason).toBeNull();
  });

  it('승인은 검토 기록만 바꾼다: 요청 · 매핑 상태 · 감사 기록 말고는 저장소의 어느 것도 바뀌지 않는다 (치료·카탈로그·규칙 묶음·범위·무조작 정책 포함)', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);
    const after = snapshotOf(world.repo);
    expect(changedKeys(before, after)).toEqual(['auditLog', 'itemStates', 'reviewRequests']);
    for (const key of ['clinics', 'treatments', 'treatmentVersions', 'baseFees', 'catalogVersions', 'catalogDrafts', 'itemVersions', 'bundles', 'bundleEvents', 'scopeHistory', 'policySources', 'insurers', 'idlePolicies']) {
      expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
    }
  });

  it('반려: 사유가 요청에 남고 요청은 REJECTED, 결과 매핑은 없으며 매핑은 REJECTED', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    rejectMappingForReviewRequest(world.deps, APPROVER, request.id, ref, 'TEST_FIXTURE 반려 사유');
    const closed = requestOf(world, request.id);
    expect(closed).toMatchObject({ status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 반려 사유', resultMappingRef: null });
    expect(stateOf(world, ref).state).toBe('REJECTED');
    expect(changedKeys(before, snapshotOf(world.repo))).toEqual(['auditLog', 'itemStates', 'reviewRequests']);
  });

  it('작성자 본인도 반려할 수 있다 (도메인이 일부러 허용한 규칙을 그대로 둔다)', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    rejectMappingForReviewRequest(world.deps, AUTHOR, request.id, ref, 'TEST_FIXTURE 작성자 철회');
    expect(requestOf(world, request.id).status).toBe('REJECTED');
  });

  it('분류 확인 필요(NEEDS_REVIEW) 치료도 초안 · 제출 · 승인이 된다 (검토 기록일 뿐이므로)', () => {
    const { world, request } = setup({ calcClass: 'NEEDS_REVIEW' });
    const ref = submitted(world, request);
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);
    expect(stateOf(world, ref).state).toBe('APPROVED');
    expect(requestOf(world, request.id).status).toBe('APPROVED');
    // 치료 버전의 분류는 그대로다.
    expect(world.repo.getTreatmentVersion('TEST_FIXTURE_TV_1')!.calcClass).toBe('NEEDS_REVIEW');
  });
});

describe('역할 · 작성자 규칙', () => {
  it.each([['HA', TEST_FIXTURE_HA_1], ['PO', TEST_FIXTURE_PO_1]])('역할 %s: 제출 · 승인 · 반려 모두 ROLE_NOT_PERMITTED 이고 아무것도 쓰지 않는다', (_name, actor) => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => submitMappingForReviewRequest(world.deps, actor, request.id, ref)).code).toBe('ROLE_NOT_PERMITTED');
    expect(catchDomainError(() => approveMappingForReviewRequest(world.deps, actor, request.id, ref)).code).toBe('ROLE_NOT_PERMITTED');
    expect(catchDomainError(() => rejectMappingForReviewRequest(world.deps, actor, request.id, ref, 'TEST_FIXTURE 사유')).code).toBe('ROLE_NOT_PERMITTED');
    expectNothingWritten(world, before);
  });

  it('제출은 작성자만: 다른 RV 는 NOT_ITEM_AUTHOR', () => {
    const { world, request } = setup();
    const ref = drafted(world, request);
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => submitMappingForReviewRequest(world.deps, APPROVER, request.id, ref)).code).toBe('NOT_ITEM_AUTHOR');
    expectNothingWritten(world, before);
  });

  it('작성자 본인의 승인은 SELF_APPROVAL_FORBIDDEN', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => approveMappingForReviewRequest(world.deps, AUTHOR, request.id, ref)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    expectNothingWritten(world, before);
  });

  it('비었거나 공백뿐인 반려 사유는 REASON_REQUIRED', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    for (const reason of ['', '   ', '\n\t']) {
      expect(catchDomainError(() => rejectMappingForReviewRequest(world.deps, APPROVER, request.id, ref, reason)).code).toBe('REASON_REQUIRED');
    }
    expectNothingWritten(world, before);
  });

  it('제출 전(DRAFT)의 매핑을 승인 · 반려하면 전이 표가 막는다 (STATE_CONFLICT TRANSITION_NOT_ALLOWED)', () => {
    const { world, request } = setup();
    const ref = drafted(world, request);
    const before = snapshotOf(world.repo);
    for (const act of [
      () => approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref),
      () => rejectMappingForReviewRequest(world.deps, APPROVER, request.id, ref, 'TEST_FIXTURE 사유'),
    ]) {
      const error = catchDomainError(act);
      expect(error.code).toBe('STATE_CONFLICT');
      expect(error.defects[0]!.code).toBe('TRANSITION_NOT_ALLOWED');
    }
    expectNothingWritten(world, before);
  });

  it('이미 제출한 매핑을 다시 제출하면 TRANSITION_NOT_ALLOWED', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => submitMappingForReviewRequest(world.deps, AUTHOR, request.id, ref));
    expect(error.defects[0]!.code).toBe('TRANSITION_NOT_ALLOWED');
    expectNothingWritten(world, before);
  });
});

describe('요청과 매핑의 연결 확인 (linkage)', () => {
  const services = [
    ['제출', (w: World, actor: typeof AUTHOR, requestId: string, ref: ItemVersionRef) => submitMappingForReviewRequest(w.deps, actor, requestId, ref)],
    ['승인', (w: World, actor: typeof AUTHOR, requestId: string, ref: ItemVersionRef) => approveMappingForReviewRequest(w.deps, actor, requestId, ref)],
    ['반려', (w: World, actor: typeof AUTHOR, requestId: string, ref: ItemVersionRef) => rejectMappingForReviewRequest(w.deps, actor, requestId, ref, 'TEST_FIXTURE 사유')],
  ] as const;

  it.each(services)('요청 없이 따로 만든 매핑(%s): REF_CONTENT_MISMATCH MAPPING_NOT_LINKED_TO_REQUEST — 매핑 상태는 그대로다', (_name, run) => {
    const { world, request } = setup();
    const loose = createDraft(world.deps, AUTHOR, 'MAPPING', baseContent('MAPPING', 9));
    submitForReview(world.deps, AUTHOR, loose.ref);
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => run(world, APPROVER, request.id, loose.ref));
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expect(error.defects).toEqual([{ code: 'MAPPING_NOT_LINKED_TO_REQUEST', path: 'mapping' }]);
    expectNothingWritten(world, before);
    // 요청에 초안이 연결된 뒤에도, 그 요청이 가리키는 다른 매핑은 이 따로 만든 매핑을 대신할 수 없다.
    drafted(world, request);
    const before2 = snapshotOf(world.repo);
    expect(catchDomainError(() => run(world, APPROVER, request.id, loose.ref)).defects[0]!.code).toBe('MAPPING_NOT_LINKED_TO_REQUEST');
    expectNothingWritten(world, before2);
  });

  it.each(services)('다른 요청에 연결된 매핑(%s)은 이 요청으로 처리할 수 없다', (_name, run) => {
    const { world, request: first } = setup();
    const second = openRequest(world); // 도메인 서비스는 같은 치료에 열린 요청 둘을 허용한다 (제출 서비스만 하나로 막는다)
    const ref = submitted(world, first);
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => run(world, APPROVER, second.id, ref));
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expect(error.defects[0]!.code).toBe('MAPPING_NOT_LINKED_TO_REQUEST');
    expectNothingWritten(world, before);
  });

  it.each(services)('참조의 버전이나 종류가 다르면(%s) 연결되지 않은 것이다', (_name, run) => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    for (const wrong of [{ ...ref, version: '2' }, { ...ref, id: 'TEST_FIXTURE_MAPPING_999' }, { ...ref, kind: 'PROFILE' as const }]) {
      expect(catchDomainError(() => run(world, APPROVER, request.id, wrong)).defects[0]!.code).toBe('MAPPING_NOT_LINKED_TO_REQUEST');
    }
    expectNothingWritten(world, before);
  });

  it.each(services)('없는 요청(%s)은 NOT_FOUND', (_name, run) => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => run(world, APPROVER, 'TEST_FIXTURE_NO_SUCH', ref)).code).toBe('NOT_FOUND');
    expectNothingWritten(world, before);
  });

  it.each(services)('이미 닫힌 요청(%s): STATE_CONFLICT REVIEW_REQUEST_CLOSED — 닫힌 뒤의 재처리를 막는다', (_name, run) => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => run(world, APPROVER, request.id, ref));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects[0]!.code).toBe('REVIEW_REQUEST_CLOSED');
    expectNothingWritten(world, before);
  });

  it('연결된 매핑의 치료가 요청의 치료와 다르면(저장된 자료가 어긋난 경우) 거절한다', () => {
    const { world, request } = setup();
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_2', sortOrder: 2 }));
    const stray = createDraft(world.deps, AUTHOR, 'MAPPING', baseContent('MAPPING', 8, 'TEST_FIXTURE_TREATMENT_2'));
    submitForReview(world.deps, AUTHOR, stray.ref);
    world.repo.saveCoverageReviewRequest({ ...requestOf(world, request.id), draftMappingRef: stray.ref });
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => approveMappingForReviewRequest(world.deps, APPROVER, request.id, stray.ref));
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expect(error.defects).toEqual([{ code: 'MAPPING_TREATMENT_MISMATCH', path: 'mapping' }]);
    expectNothingWritten(world, before);
  });
});

describe('승인 시점 확인: 현재 게시값이 검토 때와 같아야 한다', () => {
  /** 현재 치료 버전을 필드만 바꾼 새 버전으로 갈아 끼워 새 카탈로그 버전을 현재로 만든다. */
  function changeVersion(world: World, overrides: Parameters<typeof makeTreatmentVersion>[0]): void {
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: `TEST_FIXTURE_TV_NEXT_${Object.keys(overrides!).join('_')}`, ...overrides }));
  }

  it('숨긴 치료: TREATMENT_HIDDEN (path catalog)', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    world.repo.saveTreatment(makeTreatment({ active: false }));
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toEqual([{ code: 'TREATMENT_HIDDEN', path: 'catalog' }]);
    expectNothingWritten(world, before);
    expect(stateOf(world, ref).state).toBe('REVIEW_REQUESTED');
    expect(requestOf(world, request.id).status).toBe('REVIEW_REQUESTED');
  });

  it('현재 카탈로그에 없는 치료: TREATMENT_NOT_IN_CATALOG', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    dropTreatmentFromCatalog(world);
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref));
    expect(error.defects).toEqual([{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'catalog' }]);
    expectNothingWritten(world, before);
  });

  it('현재 게시값을 읽을 수 없음: CURRENT_VALUES_UNREADABLE', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    const before = snapshotOf(world.repo);
    const broken = { ...world.deps, repo: repoWith(world.repo, { getTreatment: () => null }) as typeof world.repo };
    const error = catchDomainError(() => approveMappingForReviewRequest(broken, APPROVER, request.id, ref));
    expect(error.defects).toEqual([{ code: 'CURRENT_VALUES_UNREADABLE', path: 'catalog' }]);
    expectNothingWritten(world, before);
  });

  it('검토 기준이 없는 요청(옛 경로로 만든 초안): REVIEW_BASIS_MISSING — 확인할 수 없는 승인은 거절한다 (닫는 쪽으로 실패)', () => {
    const { world, request } = setup();
    const legacy = createMappingDraftFromRequest(world.deps, AUTHOR, request.id, baseContent('MAPPING', 5));
    submitForReview(world.deps, AUTHOR, legacy.ref);
    expect(requestOf(world, request.id).reviewedBasis).toBeUndefined();
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => approveMappingForReviewRequest(world.deps, APPROVER, request.id, legacy.ref));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toEqual([{ code: 'REVIEW_BASIS_MISSING', path: 'reviewedBasis' }]);
    expectNothingWritten(world, before);
    // 반려는 지문과 무관하므로 같은 요청도 반려할 수 있다.
    rejectMappingForReviewRequest(world.deps, APPROVER, request.id, legacy.ref, 'TEST_FIXTURE 사유');
    expect(requestOf(world, request.id).status).toBe('REJECTED');
  });

  it.each([
    ['treatmentCode', { treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }],
    ['procedureCodes', { procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_C'] }],
    ['benefitType', { benefitType: 'NON_BENEFIT' as const }],
    ['calcClass', { calcClass: 'NEEDS_REVIEW' as const }],
  ])('검토 뒤에 %s 가 바뀌면 REVIEWED_FIELDS_CHANGED (path = 필드 이름) — 승인은 거절되고 상태는 그대로다', (field, change) => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    changeVersion(world, change);
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toEqual([{ code: 'REVIEWED_FIELDS_CHANGED', path: field }]);
    expectNothingWritten(world, before);
  });

  it('여러 필드가 바뀌면 필드마다 결함 하나, 판단 필드 목록의 순서로', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    changeVersion(world, { calcClass: 'NEEDS_REVIEW', treatmentCode: 'TEST_FIXTURE_TC_CHANGED' });
    const error = catchDomainError(() => approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref));
    expect(error.defects).toEqual([
      { code: 'REVIEWED_FIELDS_CHANGED', path: 'treatmentCode' },
      { code: 'REVIEWED_FIELDS_CHANGED', path: 'calcClass' },
    ]);
  });

  it('가격만 바뀌면 (새 카탈로그 버전이 생겨도) 승인은 통과하고, 고정되는 지문은 검토 때와 같다', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    changeVersion(world, { patientAmount: 99_000 });
    expect(world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!.id).not.toBe('TEST_FIXTURE_CATALOG_1');
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);
    expect(stateOf(world, ref).approvedFingerprint).toBe(requestOf(world, request.id).reviewedBasis!.fingerprint);
  });

  it('행위 코드의 순서만 바뀌면 바뀐 것이 아니다', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    changeVersion(world, { procedureCodes: ['TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_A'] });
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);
    expect(requestOf(world, request.id).status).toBe('APPROVED');
  });

  it('가드가 앞서더라도 반려는 막지 않는다 (숨긴 치료의 요청도 닫을 수 있다)', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    world.repo.saveTreatment(makeTreatment({ active: false }));
    rejectMappingForReviewRequest(world.deps, APPROVER, request.id, ref, 'TEST_FIXTURE 치료가 내려갔다');
    expect(requestOf(world, request.id).status).toBe('REJECTED');
  });
});

describe('checkApprovalBasis (읽기 전용 판정)', () => {
  it('통과: { ok: true }', () => {
    const { world, request } = setup();
    drafted(world, request);
    expect(checkApprovalBasis(world.repo, requestOf(world, request.id))).toEqual({ ok: true });
  });

  it('코드와 바뀐 필드를 낸다 — 승인 서비스가 거절하는 코드와 같다', () => {
    const { world, request } = setup();
    drafted(world, request);
    adoptTreatmentVersion(world.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_NEXT', calcClass: 'NEEDS_REVIEW', benefitType: 'NON_BENEFIT' }));
    expect(checkApprovalBasis(world.repo, requestOf(world, request.id))).toEqual({ ok: false, code: 'REVIEWED_FIELDS_CHANGED', changedFields: ['benefitType', 'calcClass'] });
    world.repo.saveTreatment(makeTreatment({ active: false }));
    expect(checkApprovalBasis(world.repo, requestOf(world, request.id))).toEqual({ ok: false, code: 'TREATMENT_HIDDEN', changedFields: [] });
  });

  it('검토 기준이 없으면 REVIEW_BASIS_MISSING', () => {
    const { world, request } = setup();
    expect(checkApprovalBasis(world.repo, request)).toEqual({ ok: false, code: 'REVIEW_BASIS_MISSING', changedFields: [] });
  });

  it('읽기만 한다 (저장소 전체가 그대로)', () => {
    const { world, request } = setup();
    drafted(world, request);
    const before = snapshotOf(world.repo);
    checkApprovalBasis(world.repo, requestOf(world, request.id));
    expectNothingWritten(world, before);
  });
});

describe('감사 기록', () => {
  it('초안 작성은 연결과 검토 기준 확보를, 승인은 항목 승인과 요청 닫힘을 남긴다', () => {
    const { world, request } = setup();
    const ref = submitted(world, request);
    approveMappingForReviewRequest(world.deps, APPROVER, request.id, ref);
    expect(world.repo.listAuditLog().map((entry) => entry.action)).toEqual([
      'REVIEW_REQUEST_CREATE',
      'ITEM_CREATE_DRAFT',
      'REVIEW_REQUEST_DRAFT_LINK',
      'REVIEW_REQUEST_BASIS_CAPTURE',
      'ITEM_SUBMIT',
      'ITEM_APPROVE',
      'REVIEW_REQUEST_CLOSE',
    ]);
    expect(world.repo.listAuditLog().at(-1)!.at).toBe(TEST_FIXTURE_NOW);
  });
});
