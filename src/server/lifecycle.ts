import type { LifecycleState } from '../engine/types';
import { DomainError } from './domain/errors';

// 항목 생명주기 상태 기계 (design.md DD-17 "생명주기" 표). 프로필·매핑·서류 규칙 묶음 세 종류가 이 표 하나를 공유한다.
// 이 파일은 표(데이터)와 전이 검사만 갖는다. 누가(역할)·무엇을 기록하며 전이하는지는 approval.ts 와 re-review.ts 의 서비스가 맡고,
// 모든 서비스는 상태를 바꾸기 전에 assertTransition 을 부른다.

/** DD-17 의 아홉 상태. */
export const LIFECYCLE_STATES: readonly LifecycleState[] = Object.freeze([
  'DRAFT',
  'REVIEW_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'UNDER_REREVIEW',
  'SUPERSEDED',
  'EXPIRED',
  'SUSPENDED',
] as const);

/**
 * 상태마다 나가는 전이. 이 표에 없는 쌍은 모두 거절이다.
 * REJECTED·SUSPENDED 는 새 버전(DRAFT)으로만 이어지고, SUPERSEDED·EXPIRED 는 끝이다. 넷 모두 나가는 전이가 없다.
 * UNDER_REREVIEW → APPROVED 는 같은 버전의 재승인이다 (지문과 승인자를 새로 고정한다, approval.ts).
 */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = Object.freeze({
  DRAFT: Object.freeze(['REVIEW_REQUESTED'] as const),
  REVIEW_REQUESTED: Object.freeze(['APPROVED', 'REJECTED'] as const),
  APPROVED: Object.freeze(['PUBLISHED', 'UNDER_REREVIEW'] as const),
  PUBLISHED: Object.freeze(['SUSPENDED', 'SUPERSEDED', 'UNDER_REREVIEW', 'EXPIRED'] as const),
  REJECTED: Object.freeze([] as const),
  UNDER_REREVIEW: Object.freeze(['APPROVED', 'REJECTED'] as const),
  SUPERSEDED: Object.freeze([] as const),
  EXPIRED: Object.freeze([] as const),
  SUSPENDED: Object.freeze([] as const),
});

/** from → to 가 표에 있는지. 알 수 없는 상태 값(상속 속성 이름 포함)은 허용으로 추정하지 않는다. */
export function isTransitionAllowed(from: LifecycleState, to: LifecycleState): boolean {
  return Object.hasOwn(LIFECYCLE_TRANSITIONS, from) && LIFECYCLE_TRANSITIONS[from].includes(to);
}

// @MX:ANCHOR: [AUTO] 전이 검사의 단일 진입점. 제출·승인·반려·중지·게시·대체·만료·재검토 전환이 모두 상태를 바꾸기 전에 부른다.
// @MX:REASON: 서비스마다 자기 전이 조건을 따로 적으면 같은 상태 쌍이 동작마다 다르게 허용된다. 표 하나와 이 검사 하나가 DD-17 의 유일한 구현이다.
/** 표에 없는 전이는 STATE_CONFLICT 로 거절한다 (메시지와 결함에 from·to 를 담는다). */
export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!isTransitionAllowed(from, to)) {
    throw new DomainError('STATE_CONFLICT', `상태 ${String(from)} 에서 ${String(to)} 로 바꿀 수 없다 (DD-17 전이 표에 없다)`, [{ code: 'TRANSITION_NOT_ALLOWED', path: 'state' }]);
  }
}
