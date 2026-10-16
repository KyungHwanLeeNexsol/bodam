import type { ApproverRecord, LifecycleState } from '../engine/types';
import { appendAudit } from './audit';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import { DomainError } from './domain/errors';
import { formatRef, isMappingRecord } from './domain/items';
import type { ItemStateRecord, ItemVersionRecord, ItemVersionRef } from './domain/items';
import { coverageFingerprintOf } from './fingerprint';
import { assertTransition } from './lifecycle';
import { closeReviewRequestForMapping } from './review-request';
import { currentTreatmentVersion } from './treatment-current';

// 제출·승인·반려·항목 중지와 시스템 전이 (design.md DD-17 생명주기 표, 소유자 결정 #31 본인 승인 금지).
// 세 종류의 규칙 항목이 같은 서비스를 쓰고 같은 전이 표(lifecycle.ts)를 공유한다. 역할만 본다: 소유·인증은 M7.
// 모든 서비스는 하나의 저장소 트랜잭션 안에서 돌고, 거절하면 쓰기 전부(상태 기록·감사 기록·검토 요청 포함)가 되돌려진다.
// 감사 기록의 이전/이후 값은 생명주기 상태다 [문서에 없음: 'beforeVersion'/'afterVersion' 이라는 이름과 달리 상태 전이는 상태를 담는다].

function load(deps: ServiceDeps, ref: ItemVersionRef): { record: ItemVersionRecord; state: ItemStateRecord } {
  const record = deps.repo.getItemVersion(ref);
  if (record === null) {
    throw new DomainError('NOT_FOUND', `항목 ${formatRef(ref)} 이(가) 없다`);
  }
  const state = deps.repo.getItemState(ref);
  if (state === null) {
    throw new DomainError('NOT_FOUND', `항목 ${formatRef(ref)} 의 상태 기록이 없다`);
  }
  return { record, state };
}

function requireReason(reason: string): void {
  if (reason.trim() === '') {
    throw new DomainError('REASON_REQUIRED', '사유가 필요하다 (비어 있거나 공백뿐일 수 없다)', [{ code: 'EMPTY', path: 'reason' }]);
  }
}

interface Change {
  to: LifecycleState;
  action: string;
  reason: string | null;
  at: string;
  /** 승인일 때만: 전이 뒤의 승인자 기록과 고정 지문. 없으면 현재 값을 이어 간다. */
  approval?: { approver: ApproverRecord; fingerprint: string | null };
}

/** 전이를 이력에 쓰고 감사 기록을 남긴다. 전이 표 검사는 부르는 쪽이 먼저 끝냈다. */
function apply(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef, current: ItemStateRecord, change: Change): void {
  deps.repo.recordItemTransition(ref, {
    from: current.state,
    to: change.to,
    actor,
    at: change.at,
    reason: change.reason,
    approverAfter: change.approval === undefined ? current.approver : change.approval.approver,
    approvedFingerprintAfter: change.approval === undefined ? current.approvedFingerprint : change.approval.fingerprint,
  });
  appendAudit(deps, actor, { action: change.action, target: formatRef(ref), beforeVersion: current.state, afterVersion: change.to, reason: change.reason });
}

/** RV 가 하는 일반 전이 한 건: 역할 → (사유) → 상태 읽기 → 전이 표 → 기록. */
function rvTransition(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef, to: LifecycleState, action: string, reason: string | null): void {
  requireRole(actor, 'RV');
  deps.repo.transaction(() => {
    const { state } = load(deps, ref);
    assertTransition(state.state, to);
    apply(deps, actor, ref, state, { to, action, reason, at: deps.clock.now() });
  });
}

/** 작성자가 DRAFT 를 검토에 제출한다. 작성자가 아닌 주체는 NOT_ITEM_AUTHOR [문서에 없음: DD-17 표의 "작성자의 검토 제출"을 따랐다]. */
export function submitForReview(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef): void {
  requireRole(actor, 'RV');
  deps.repo.transaction(() => {
    const { record, state } = load(deps, ref);
    assertTransition(state.state, 'REVIEW_REQUESTED');
    if (record.authorId !== actor.id) {
      throw new DomainError('NOT_ITEM_AUTHOR', `항목 ${formatRef(ref)} 의 검토 제출은 작성자만 할 수 있다`);
    }
    apply(deps, actor, ref, state, { to: 'REVIEW_REQUESTED', action: 'ITEM_SUBMIT', reason: null, at: deps.clock.now() });
  });
}

/**
 * 매핑 승인이 고정할 치료 버전의 지문 (DD-15). [문서에 없음] 지문을 만들 치료 버전은 병원의 현재 카탈로그 버전에 든 그 치료의
 * 버전이고, 현재 카탈로그에 없으면 쓰기 순서상 가장 나중 버전이다. 버전이 하나도 없으면 TREATMENT_VERSION_ABSENT.
 */
function pinnedFingerprint(deps: ServiceDeps, treatmentId: string): string {
  const version = currentTreatmentVersion(deps.repo, treatmentId);
  if (version === null) {
    throw new DomainError('TREATMENT_VERSION_ABSENT', `치료 '${treatmentId}' 의 버전이 없어 승인 지문을 고정할 수 없다`);
  }
  return coverageFingerprintOf(version);
}

// @MX:ANCHOR: [AUTO] 승인의 단일 진입점. 첫 승인과 재승인(UNDER_REREVIEW → APPROVED)이 모두 지나가며 본인 승인 금지와 지문 고정이 여기서 일어난다.
// @MX:REASON: 작성자 != 승인자 규칙(소유자 결정 #31)과 승인 시점 지문 고정(DD-15)이 한 곳에 있어야 한다. 우회 경로가 하나라도 생기면 본인 승인이나 낡은 지문이 승인으로 남는다.
/**
 * RV 가 승인한다 (REVIEW_REQUESTED 또는 UNDER_REREVIEW → APPROVED). 승인자 id 가 항목 버전의 작성자 id 와 같으면
 * SELF_APPROVAL_FORBIDDEN 이고 상태·승인자 기록·감사 기록·검토 요청 어느 것도 바뀌지 않는다. 재승인도 같은 규칙이다.
 * 승인자 기록(승인자 id·시각)을 새로 쓰고, 매핑이면 그 시점의 지문을 새로 고정한다. 이전 값은 상태 이력에 남는다.
 * 매핑이 검토 요청에서 온 것이면 같은 트랜잭션에서 요청을 APPROVED 로 닫는다.
 */
export function approve(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef): void {
  requireRole(actor, 'RV');
  deps.repo.transaction(() => {
    const { record, state } = load(deps, ref);
    assertTransition(state.state, 'APPROVED');
    if (record.authorId === actor.id) {
      throw new DomainError('SELF_APPROVAL_FORBIDDEN', `작성자 본인(${actor.id})은 자기 항목 ${formatRef(ref)} 을(를) 승인할 수 없다`);
    }
    const at = deps.clock.now();
    const fingerprint = isMappingRecord(record) ? pinnedFingerprint(deps, record.content.treatmentId) : null;
    apply(deps, actor, ref, state, { to: 'APPROVED', action: 'ITEM_APPROVE', reason: null, at, approval: { approver: { approverId: actor.id, approvedAt: at }, fingerprint } });
    if (isMappingRecord(record)) {
      closeReviewRequestForMapping(deps, actor, record.content.treatmentId, ref, { status: 'APPROVED' });
    }
  });
}

/**
 * RV 가 반려한다 (REVIEW_REQUESTED 또는 UNDER_REREVIEW → REJECTED). 비었거나 공백뿐인 사유는 REASON_REQUIRED.
 * 본인 승인 금지 규칙은 반려에 적용하지 않는다. 승인자 기록과 고정 지문은 건드리지 않는다.
 * 매핑이 검토 요청에서 온 것이면 같은 트랜잭션에서 요청을 REJECTED 로 닫고 반려 사유를 담는다.
 */
export function reject(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef, reason: string): void {
  requireRole(actor, 'RV');
  requireReason(reason);
  deps.repo.transaction(() => {
    const { record, state } = load(deps, ref);
    assertTransition(state.state, 'REJECTED');
    apply(deps, actor, ref, state, { to: 'REJECTED', action: 'ITEM_REJECT', reason, at: deps.clock.now() });
    if (isMappingRecord(record)) {
      closeReviewRequestForMapping(deps, actor, record.content.treatmentId, ref, { status: 'REJECTED', reason });
    }
  });
}

/** 항목 하나의 명시적 중지 (PUBLISHED → SUSPENDED). RV, 사유 필수. 규칙 묶음 중지(M3.D)와 별개이며 그 항목을 담은 모든 묶음에 영향을 준다. */
export function suspendItem(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef, reason: string): void {
  requireRole(actor, 'RV');
  requireReason(reason);
  rvTransition(deps, actor, ref, 'SUSPENDED', 'ITEM_SUSPEND', reason);
}

// 아래 셋은 규칙 묶음 게시(M3.D)가 항목 상태를 옮길 때 쓰는 시스템 전이다. 전이 표와 역할(RV: 묶음 게시는 RV 의 일)을 확인한다.

/** APPROVED → PUBLISHED (규칙 묶음 게시). */
export function markPublished(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef): void {
  rvTransition(deps, actor, ref, 'PUBLISHED', 'ITEM_PUBLISH', null);
}

/** PUBLISHED → SUPERSEDED (새 버전 게시). */
export function markSuperseded(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef): void {
  rvTransition(deps, actor, ref, 'SUPERSEDED', 'ITEM_SUPERSEDE', null);
}

/** PUBLISHED → EXPIRED (유효 기간 종료). */
export function markExpired(deps: ServiceDeps, actor: Actor, ref: ItemVersionRef): void {
  rvTransition(deps, actor, ref, 'EXPIRED', 'ITEM_EXPIRE', null);
}
