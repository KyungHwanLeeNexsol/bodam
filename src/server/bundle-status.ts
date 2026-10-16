import { appendAudit } from './audit';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { RuleBundleStatusEvent } from './domain/entities';
import { DomainError } from './domain/errors';
import { findAffectedClinics } from './rule-scope';
import type { AffectedClinic } from './rule-scope';

// 규칙 묶음 중지 서비스 (SPEC-REIMBURSEMENT-001 M3.D2, design.md DD-14 "규칙 묶음 가용성과 중지", DD-17 권한 표: 게시·중지는 RV, AC-011e).
//  - 중지는 가용성 사건 SUSPENDED 를 덧붙이는 것이 전부다. 묶음 기록(id·항목 참조·내용 해시·게시자·게시일), 묶음에 든 항목의 상태,
//    같은 항목 버전을 담은 다른 묶음, 병원의 규칙 사용 범위는 바뀌지 않는다. 앞의 ACTIVE 사건도 지우지 않는다.
//  - 다시 활성으로 돌리는 동작은 없다(DD-14). 그래서 이 모듈에는 되살리기 함수가 없다. 복구는 새 묶음 버전을 게시(restoreRuleBundle)하고
//    플랫폼 운영자가 영향을 받은 병원마다 범위를 다시 지정(assignRuleScope)하는 것이다. ACTIVE 를 다시 쓰려는 시도는 저장소의 사슬 검사가 막는다.
//  - 사유는 필수다. 비었거나 없거나 공백뿐인 사유는 REASON_REQUIRED(경로 reason)로 거절하고 아무것도 쓰지 않는다.
// 역할만 본다: 인증·401/403·HTTP 400 변환은 M7(AC-022a, AC-025f, AC-021f)이다.

export interface SuspendOutcome {
  /** 방금 덧붙인 SUSPENDED 사건. */
  event: RuleBundleStatusEvent;
  /** 현재 범위가 이 묶음을 가리키는 병원 (병원 id 순). 관리자 API 응답의 `affectedClinics` 가 된다(M7). */
  affectedClinics: AffectedClinic[];
}

function requireReason(reason: unknown): asserts reason is string {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new DomainError('REASON_REQUIRED', '중지 사유가 필요하다 (비어 있거나 공백뿐일 수 없다)', [{ code: 'EMPTY', path: 'reason' }]);
  }
}

// @MX:ANCHOR: [AUTO] 규칙 묶음 중지의 단일 진입점. 관리자 API(M7), 복구 경로 시험(AC-011f, M4), 준비 상태(M3.E)가 부른다.
// @MX:REASON: 가용성 사건·감사 기록·영향 병원 계산이 한 트랜잭션에서 같이 일어나야 한다. 사유 검사가 쓰기보다 앞서지 않으면 사유 없는 중지 기록이 남는다.
/**
 * RV 가 규칙 묶음을 중지한다: 가용성 사건 SUSPENDED 를 덧붙이고(수행자 id·역할·시각·사유·이전 상태 ACTIVE) 감사 기록을 남긴다.
 * 순서: 역할 → 사유 → 묶음 존재(NOT_FOUND) → 현재 상태가 ACTIVE 인지(아니면 STATE_CONFLICT: 이미 중지됐거나 가용성 기록이 없다) → 쓰기.
 */
export function suspendRuleBundle(deps: ServiceDeps, actor: Actor, bundleId: string, reason: string): SuspendOutcome {
  requireRole(actor, 'RV');
  requireReason(reason);
  return deps.repo.transaction(() => {
    if (deps.repo.getRuleBundleVersion(bundleId) === null) {
      throw new DomainError('NOT_FOUND', `규칙 묶음 '${bundleId}' 이(가) 없다`);
    }
    const current = deps.repo.getBundleStatus(bundleId);
    if (current !== 'ACTIVE') {
      throw new DomainError('STATE_CONFLICT', `규칙 묶음 '${bundleId}' 의 현재 가용성은 ${current ?? '(기록 없음)'} 이라 중지할 수 없다 (ACTIVE 만 중지할 수 있다)`);
    }
    const event: RuleBundleStatusEvent = { bundleId, status: 'SUSPENDED', actorId: actor.id, role: actor.role, at: deps.clock.now(), reason, previousStatus: 'ACTIVE' };
    deps.repo.appendBundleStatusEvent(event);
    const affectedClinics = findAffectedClinics(deps.repo, bundleId);
    appendAudit(deps, actor, {
      action: 'BUNDLE_SUSPEND',
      target: `BUNDLE/${bundleId}`,
      beforeVersion: 'ACTIVE',
      afterVersion: 'SUSPENDED',
      reason,
      affectedClinicCount: affectedClinics.length,
    });
    return { event, affectedClinics };
  });
}
