// 검토 요청 화면이 읽는 관리자 API 응답의 모양 (src/server/review-request-read.ts 의 보기). 화면 코드는 서버 모듈을 가져오지 않고 이 형식만 쓴다.

import type { BenefitType } from './api-types';

export type CalcClass = 'GENERAL_BENEFIT' | 'GENERAL_NON_BENEFIT' | 'MAJOR_THREE_NON_BENEFIT' | 'NEEDS_REVIEW';

export type ReviewStatus = 'REVIEW_REQUESTED' | 'APPROVED' | 'REJECTED';

export interface ProposedValues {
  benefitType: BenefitType;
  procedureCodes: string[];
  calcClass: CalcClass;
}

/** 요청 한 건. requestedBy 는 요청한 사용자 id 문자열이다. */
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

export interface ReviewQueueEntry extends ReviewRequestView {
  clinic: { id: string; name: string };
  current: CurrentPublishedView;
}

export interface ReviewRequestsResponse {
  reviewRequests: ReviewRequestView[];
}

export interface ReviewQueueResponse {
  queue: ReviewQueueEntry[];
}

export interface SubmitResponse {
  reviewRequest: ReviewRequestView;
}
