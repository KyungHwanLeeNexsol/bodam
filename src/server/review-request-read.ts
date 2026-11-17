import { compareCodePoints } from '../engine/validate';
import type { BenefitType, CalcClass, Generation, InsurerType, LifecycleState, PolicySourceRef } from '../engine/types';
import { readCurrentPublishedState } from './current-published-state';
import type { CurrentPublishedState } from './current-published-state';
import type { CoverageReviewRequest, ReviewRequestStatus } from './domain/entities';
import { isMappingRecord } from './domain/items';
import type { ItemVersionRef } from './domain/items';
import { checkApprovalBasis } from './mapping-review';
import type { Repository } from './repo/interfaces';

// 검토 요청의 읽기 보기 (M7 검토 요청·매핑 검토). 읽기만 한다: 저장소를 바꾸지 않고, 쓰기 메서드를 부르지 않는다(Pick 으로 읽기 메서드만 받는다).
// 두 가지 보기가 있다.
//  - 병원 관리자(HA)용 ReviewRequestView: 요청의 상태·결과·반려 사유와 분류 표지(classification)만. 요청이 만드는 매핑 초안·결과 매핑 연결, 검토 기준, 작성자, 병원 id 는 싣지 않는다:
//    병원 관리자는 요청의 처리 결과를 읽을 뿐이고 RV 내부 자료(매핑·검토 기준)를 보지 않는다(권한 표: HA 는 검토 요청 상태·결과·반려 사유를 읽기만).
//  - 검토 담당자(RV)용 ReviewQueueEntry / ReviewHistoryEntry: 요청 보기에 병원·현재 게시 상태·매핑 요약·검토 기준 비교·승인 차단 사유를 더한다.
// 현재 게시 상태는 current-published-state.ts 하나로 읽고, 승인 차단 사유는 승인 서비스가 거절하는 판정(mapping-review.ts checkApprovalBasis)을 그대로 쓴다:
// 화면이 미리 보여 주는 이유와 서버가 실제로 거절하는 이유가 같은 코드에서 나온다.

/** 치료의 분류 표지. 현재 게시값을 읽을 수 없으면 UNKNOWN 이다 — 분류가 확인 필요가 아니라는 뜻이 아니다. */
export type Classification = 'NEEDS_REVIEW' | 'CLASSIFIED' | 'UNKNOWN';

/** 요청 한 건의 읽기 보기. requestedBy 는 요청한 사용자 id 문자열이다. */
export interface ReviewRequestView {
  id: string;
  treatmentId: string;
  /** 그 치료의 가장 최근(마지막으로 쓴) 버전의 표시 이름. 치료 버전이 하나도 없으면 null. */
  treatmentName: string | null;
  proposed: { benefitType: BenefitType; procedureCodes: string[]; calcClass: CalcClass };
  status: ReviewRequestStatus;
  rejectionReason: string | null;
  requestedAt: string;
  requestedBy: string;
  /** 현재 게시 버전의 분류: NEEDS_REVIEW(분류 확인 필요) · CLASSIFIED · UNKNOWN(현재 게시값을 읽을 수 없음: 숨김·목록에 없음·읽기 실패). */
  classification: Classification;
}

/** 대기열 항목이 함께 보여 주는, 그 병원의 현재 게시본에 있는 치료의 판단 필드. */
export interface CurrentTreatmentView {
  displayName: string;
  treatmentCode: string;
  benefitType: BenefitType;
  procedureCodes: string[];
  calcClass: CalcClass;
}

/**
 * 현재 게시 상태. PUBLISHED 만 값이 있다. HIDDEN(숨김)·NOT_IN_CATALOG(목록에 없음)·UNREADABLE(읽지 못함, defectCode)은 서로 다른 말이며
 * 읽지 못한 것을 "목록에 없음"으로 보여서는 안 된다.
 */
export type CurrentPublishedView = ({ state: 'PUBLISHED' } & CurrentTreatmentView) | { state: 'HIDDEN' } | { state: 'NOT_IN_CATALOG' } | { state: 'UNREADABLE'; defectCode: string };

/** 매핑 초안 요약 (RV 전용). lifecycle 은 매핑 항목의 현재 생명주기 상태이며 상태 기록이 없는 데이터 결함이면 null 이다. */
export interface MappingSummaryView {
  ref: { kind: 'MAPPING'; id: string; version: string };
  authorId: string;
  createdAt: string;
  lifecycle: LifecycleState | null;
  decision: 'COVERED' | 'EXCLUDED';
  scope: Array<{ generation: Generation; insurerType: InsurerType }>;
  groupKey: string | null;
  exclusionReason: string | null;
  validity: { from: string; to: string };
  policySources: PolicySourceRef[];
}

/**
 * 검토 기준 비교 (RV 전용). check: MATCH(같다) · CHANGED(검토 뒤 판단 필드가 바뀜, changedFields) · MISSING(기준이 기록되지 않음 — 초안 전이거나 옛 요청) ·
 * UNCHECKABLE(현재 게시값을 읽을 수 없어 비교하지 못함). reviewed 는 검토 때 떠 둔 판단 필드(없으면 null)이며 지문은 싣지 않는다.
 */
export interface BasisView {
  check: 'MATCH' | 'CHANGED' | 'MISSING' | 'UNCHECKABLE';
  changedFields: string[];
  reviewed: { treatmentCode: string; procedureCodes: string[]; benefitType: BenefitType; calcClass: CalcClass } | null;
}

/**
 * RV 대기열 항목: 요청 보기 + 병원 + 현재 게시 상태 + 매핑 요약 + 검토 기준 비교.
 * approvalBlockedReason 은 지금 승인하면 검토 기준 때문에 거절될 때의 사유 코드(승인 서비스가 던지는 코드와 같다)이고, 막을 이유가 없거나 매핑 초안이 없거나
 * 요청이 이미 닫혔으면 null 이다.
 */
export interface ReviewQueueEntry extends ReviewRequestView {
  clinic: { id: string; name: string };
  current: CurrentPublishedView;
  mapping: MappingSummaryView | null;
  basis: BasisView;
  approvalBlockedReason: string | null;
}

/** 이력 항목: 대기열 항목 + 처리 결과. closedBy·closedAt 은 연결된 매핑의 닫는 전이(승인/반려)에서 읽고 없으면 null 이다. */
export interface ReviewHistoryEntry extends ReviewQueueEntry {
  resultMappingRef: { kind: ItemVersionRef['kind']; id: string; version: string } | null;
  closedBy: string | null;
  closedAt: string | null;
}

type StateReads = Pick<Repository, 'getClinicCurrentCatalogVersion' | 'getTreatmentVersion' | 'getTreatment'>;
type ViewReads = StateReads & Pick<Repository, 'listTreatmentVersions'>;
type ClinicViewReads = ViewReads & Pick<Repository, 'listCoverageReviewRequests'>;
type EntryReads = ViewReads & Pick<Repository, 'getClinic' | 'getCoverageReviewRequest' | 'getItemVersion' | 'getItemState'>;
type ListReads = EntryReads & Pick<Repository, 'listClinics' | 'listCoverageReviewRequests'>;

function classificationOf(state: CurrentPublishedState): Classification {
  if (state.kind !== 'PUBLISHED') {
    return 'UNKNOWN';
  }
  return state.version.calcClass === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'CLASSIFIED';
}

function viewOf(repo: Pick<Repository, 'listTreatmentVersions'>, request: CoverageReviewRequest, state: CurrentPublishedState): ReviewRequestView {
  const versions = repo.listTreatmentVersions(request.treatmentId);
  return {
    id: request.id,
    treatmentId: request.treatmentId,
    treatmentName: versions[versions.length - 1]?.displayName ?? null,
    proposed: { benefitType: request.proposed.benefitType, procedureCodes: [...request.proposed.procedureCodes], calcClass: request.proposed.calcClass },
    status: request.status,
    rejectionReason: request.rejectionReason,
    requestedAt: request.requestedAt,
    requestedBy: request.requestedBy.id,
    classification: classificationOf(state),
  };
}

/** 요청 한 건의 병원 관리자용 보기. 제안 값과 행위 코드는 복사본이다. */
export function reviewRequestView(repo: ViewReads, request: CoverageReviewRequest): ReviewRequestView {
  return viewOf(repo, request, readCurrentPublishedState(repo, request.clinicId, request.treatmentId));
}

/** 병원 한 곳의 요청 전부(닫힌 것 포함)를 최신순으로: 요청 시각 내림차순, 같으면 요청 id 의 코드 포인트 내림차순. */
export function readClinicReviewRequestViews(repo: ClinicViewReads, clinicId: string): ReviewRequestView[] {
  return repo
    .listCoverageReviewRequests(clinicId)
    .sort((a, b) => compareCodePoints(b.requestedAt, a.requestedAt) || compareCodePoints(b.id, a.id))
    .map((request) => reviewRequestView(repo, request));
}

function currentViewOf(state: CurrentPublishedState): CurrentPublishedView {
  switch (state.kind) {
    case 'PUBLISHED':
      return {
        state: 'PUBLISHED',
        displayName: state.version.displayName,
        treatmentCode: state.version.treatmentCode,
        benefitType: state.version.benefitType,
        procedureCodes: [...state.version.procedureCodes],
        calcClass: state.version.calcClass,
      };
    case 'HIDDEN':
      return { state: 'HIDDEN' };
    case 'NOT_IN_CATALOG':
      return { state: 'NOT_IN_CATALOG' };
    case 'UNREADABLE':
      return { state: 'UNREADABLE', defectCode: state.code };
  }
}

function mappingViewOf(repo: EntryReads, request: CoverageReviewRequest): MappingSummaryView | null {
  const ref = request.draftMappingRef;
  if (ref === null) {
    return null;
  }
  const record = repo.getItemVersion(ref);
  if (record === null || !isMappingRecord(record)) {
    return null;
  }
  const { content } = record;
  return {
    ref: { kind: 'MAPPING', id: record.ref.id, version: record.ref.version },
    authorId: record.authorId,
    createdAt: record.createdAt,
    lifecycle: repo.getItemState(ref)?.state ?? null,
    decision: content.decision,
    scope: content.scope.map((cell) => ({ generation: cell.generation, insurerType: cell.insurerType })),
    groupKey: content.groupKey ?? null,
    exclusionReason: content.exclusionReason ?? null,
    validity: { from: content.validity.from, to: content.validity.to },
    policySources: content.policySources.map((source) => ({ ...source })),
  };
}

function basisViewOf(repo: StateReads, request: CoverageReviewRequest): { basis: BasisView; blockedReason: string | null } {
  const reviewed = request.reviewedBasis === undefined ? null : { ...request.reviewedBasis.fields, procedureCodes: [...request.reviewedBasis.fields.procedureCodes] };
  const check = checkApprovalBasis(repo, request);
  if (check.ok) {
    return { basis: { check: 'MATCH', changedFields: [], reviewed }, blockedReason: null };
  }
  const kind = check.code === 'REVIEWED_FIELDS_CHANGED' ? 'CHANGED' : check.code === 'REVIEW_BASIS_MISSING' ? 'MISSING' : 'UNCHECKABLE';
  return { basis: { check: kind, changedFields: [...check.changedFields], reviewed }, blockedReason: check.code };
}

/** 요청 한 건의 대기열 모양 보기(상태와 무관). 병원이 없는 데이터 결함이면 null. */
function entryOf(repo: EntryReads, request: CoverageReviewRequest): ReviewQueueEntry | null {
  const clinic = repo.getClinic(request.clinicId);
  if (clinic === null) {
    return null;
  }
  const state = readCurrentPublishedState(repo, request.clinicId, request.treatmentId);
  const mapping = mappingViewOf(repo, request);
  const { basis, blockedReason } = basisViewOf(repo, request);
  return {
    ...viewOf(repo, request, state),
    clinic: { id: clinic.id, name: clinic.name },
    current: currentViewOf(state),
    mapping,
    basis,
    // 승인할 매핑이 없거나 요청이 닫혔으면 "승인이 막힌 이유"는 뜻이 없다.
    approvalBlockedReason: mapping !== null && request.status === 'REVIEW_REQUESTED' ? blockedReason : null,
  };
}

/**
 * 대기열 항목에 처리 결과 칸을 더한다. 열려 있는 요청은 세 칸이 모두 null 이다.
 * closedBy·closedAt 은 연결된 매핑의 상태 이력에서 요청이 닫힌 결과(APPROVED/REJECTED)로 들어간 첫 전이의 수행자 id·시각이다. 연결된 매핑이 없거나
 * 그 전이가 없으면 null 이다(지어내지 않는다).
 */
function historyEntryOf(repo: EntryReads, request: CoverageReviewRequest, entry: ReviewQueueEntry): ReviewHistoryEntry {
  const closing = request.draftMappingRef === null || request.status === 'REVIEW_REQUESTED' ? undefined : repo.getItemState(request.draftMappingRef)?.history.find((transition) => transition.to === request.status);
  const resultRef = request.resultMappingRef;
  return {
    ...entry,
    resultMappingRef: resultRef === null ? null : { kind: resultRef.kind, id: resultRef.id, version: resultRef.version },
    closedBy: closing?.actorId ?? null,
    closedAt: closing?.at ?? null,
  };
}

/**
 * 요청 id 하나의 보기(열린 요청이든 닫힌 요청이든). 요청이 없으면 null. 처리 서비스의 성공 응답이 화면을 새로 고치는 데 쓴다.
 * 모양은 이력 항목이다(대기열 항목 + 처리 결과 칸): 열린 요청에서는 처리 결과 칸이 null 이고, 닫는 처리(승인·반려)의 응답에서는 채워진다.
 */
export function readReviewEntry(repo: EntryReads, requestId: string): ReviewHistoryEntry | null {
  const request = repo.getCoverageReviewRequest(requestId);
  const entry = request === null ? null : entryOf(repo, request);
  return request === null || entry === null ? null : historyEntryOf(repo, request, entry);
}

/**
 * RV 대기열: 모든 병원의 열린 요청(REVIEW_REQUESTED)만, 오래된 순으로: 요청 시각 오름차순, 같으면 병원 id, 요청 id 의 코드 포인트 순.
 * 현재 게시 상태는 요청마다 current-published-state 로 읽는다: 숨김·목록에 없음·읽지 못함이 서로 다른 값으로 나가고, 깨진 참조에서 던지지 않는다.
 */
export function readReviewQueue(repo: ListReads): ReviewQueueEntry[] {
  return repo
    .listClinics()
    .flatMap((clinic) => repo.listCoverageReviewRequests(clinic.id).filter((request) => request.status === 'REVIEW_REQUESTED'))
    .flatMap((request) => {
      const entry = entryOf(repo, request);
      return entry === null ? [] : [{ clinicId: request.clinicId, entry }];
    })
    .sort((a, b) => compareCodePoints(a.entry.requestedAt, b.entry.requestedAt) || compareCodePoints(a.clinicId, b.clinicId) || compareCodePoints(a.entry.id, b.entry.id))
    .map(({ entry }) => entry);
}

/**
 * RV 이력: 모든 병원의 닫힌 요청(APPROVED·REJECTED)을 최신순으로: 요청 시각 내림차순, 같으면 요청 id 의 코드 포인트 내림차순.
 * 처리 결과 칸(resultMappingRef·closedBy·closedAt)은 historyEntryOf 의 정의를 따른다. 현재 게시값·검토 기준 비교는 지금 시점의 값이다.
 */
export function readReviewHistory(repo: ListReads): ReviewHistoryEntry[] {
  return repo
    .listClinics()
    .flatMap((clinic) => repo.listCoverageReviewRequests(clinic.id).filter((request) => request.status !== 'REVIEW_REQUESTED'))
    .flatMap((request) => {
      const entry = entryOf(repo, request);
      return entry === null ? [] : [historyEntryOf(repo, request, entry)];
    })
    .sort((a, b) => compareCodePoints(b.requestedAt, a.requestedAt) || compareCodePoints(b.id, a.id));
}
