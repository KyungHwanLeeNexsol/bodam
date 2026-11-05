// 검토 요청·매핑 검토 화면이 읽는 관리자 API 응답의 모양 (src/server/review-request-read.ts 의 보기와 src/server/admin/router.ts 의 응답). 화면 코드는 서버 모듈을 가져오지 않고 이 형식만 쓴다.

import type { BenefitType } from './api-types';

export type CalcClass = 'GENERAL_BENEFIT' | 'GENERAL_NON_BENEFIT' | 'MAJOR_THREE_NON_BENEFIT' | 'NEEDS_REVIEW';

export type ReviewStatus = 'REVIEW_REQUESTED' | 'APPROVED' | 'REJECTED';

/** 치료 분류 표지: 분류 확인 필요 · 분류됨 · 현재 게시값을 읽을 수 없어 알 수 없음. */
export type Classification = 'NEEDS_REVIEW' | 'CLASSIFIED' | 'UNKNOWN';

export interface ProposedValues {
  benefitType: BenefitType;
  procedureCodes: string[];
  calcClass: CalcClass;
}

/** 요청 한 건. requestedBy 는 요청한 사용자 id 문자열이다. 병원 관리자도 이 모양을 읽는다(분류 표지 말고는 검토 담당자 내부 자료가 없다). */
export interface ReviewRequestView {
  id: string;
  treatmentId: string;
  /** 치료 버전이 하나도 없으면 null. */
  treatmentName: string | null;
  proposed: ProposedValues;
  status: ReviewStatus;
  rejectionReason: string | null;
  requestedAt: string;
  requestedBy: string;
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
 * 현재 게시 상태 (서버가 네 가지로 나눠 준다). PUBLISHED 만 값이 있다.
 * HIDDEN(숨김)·NOT_IN_CATALOG(목록에 없음)과 UNREADABLE(서버가 현재 게시값을 읽지 못함, defectCode)은 다른 말이며 읽지 못한 것을 "목록에 없음"으로 보이지 않는다.
 */
export type CurrentPublishedView = ({ state: 'PUBLISHED' } & CurrentTreatmentView) | { state: 'HIDDEN' } | { state: 'NOT_IN_CATALOG' } | { state: 'UNREADABLE'; defectCode: string };

export type Generation = 'GEN1_AS' | 'GEN2_C1' | 'GEN2_5_C2' | 'GEN3_C3' | 'GEN4_C4';
export type InsurerType = 'NON_LIFE' | 'LIFE' | 'MUTUAL_AID';

/** 매핑 항목의 생명주기 상태. 상태 기록이 없는 데이터 결함이면 null. */
export type LifecycleState = 'DRAFT' | 'REVIEW_REQUESTED' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'UNDER_REREVIEW' | 'SUPERSEDED' | 'EXPIRED' | 'SUSPENDED';

export interface PolicySource {
  insurerDocumentId: string;
  revisionDate: string;
  clauseOrPage: string;
  effectiveDate: string;
  verifiedBy: string;
  verifiedAt: string;
}

/** 매핑 초안 요약 (검토 담당자 전용). */
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
  policySources: PolicySource[];
}

export type JudgmentField = 'treatmentCode' | 'procedureCodes' | 'benefitType' | 'calcClass';

/** 검토 기준 비교 (검토 담당자 전용). reviewed 는 검토를 시작할 때 떠 둔 판단 필드(없으면 null). */
export interface BasisView {
  check: 'MATCH' | 'CHANGED' | 'MISSING' | 'UNCHECKABLE';
  changedFields: string[];
  reviewed: { treatmentCode: string; procedureCodes: string[]; benefitType: BenefitType; calcClass: CalcClass } | null;
}

/** 승인이 검토 기준 때문에 막힐 때 서버가 알려 주는 사유 코드(승인 서비스가 거절하는 코드와 같다). */
export type ApprovalBlockedReason = 'TREATMENT_HIDDEN' | 'TREATMENT_NOT_IN_CATALOG' | 'CURRENT_VALUES_UNREADABLE' | 'REVIEW_BASIS_MISSING' | 'REVIEWED_FIELDS_CHANGED';

export interface ReviewQueueEntry extends ReviewRequestView {
  clinic: { id: string; name: string };
  current: CurrentPublishedView;
  mapping: MappingSummaryView | null;
  basis: BasisView;
  /** 서버는 문자열을 준다. 위 다섯 코드가 아닌 값이 와도 화면은 일반 문장으로 막는다. */
  approvalBlockedReason: string | null;
}

/** 이력 항목: 대기열 항목 + 처리 결과 칸. 처리 중인 요청에서는 세 칸이 모두 null 이다. */
export interface ReviewHistoryEntry extends ReviewQueueEntry {
  resultMappingRef: { kind: string; id: string; version: string } | null;
  closedBy: string | null;
  closedAt: string | null;
}

export interface ReviewRequestsResponse {
  reviewRequests: ReviewRequestView[];
}

export interface ReviewQueueResponse {
  queue: ReviewQueueEntry[];
}

export interface ReviewHistoryResponse {
  'history': ReviewHistoryEntry[];
}

/** 초안 작성·제출·승인·반려의 성공 응답: 그 요청의 갱신된 항목. */
export interface EntryResponse {
  entry: ReviewHistoryEntry;
}

export interface SubmitResponse {
  reviewRequest: ReviewRequestView;
}
