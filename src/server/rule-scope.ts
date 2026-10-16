import { appendAudit } from './audit';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { BundleAvailability, ClinicRuleScope } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Repository } from './repo/interfaces';

// 병원별 규칙 사용 범위(ClinicRuleScope) 지정과 읽기 (SPEC-REIMBURSEMENT-001 M3.D2, design.md DD-14·DD-17).
// 지정은 플랫폼 운영자(PO)만 한다(DD-17 권한 표). 역할만 본다: 병원 소속·인증·401/403 은 M7(AC-022a)이다.
// 지정은 이력에 더하고 현재 값이 된다. 묶음 중지는 범위를 바꾸지 않는다(bundle-status.ts).

/** 병원 하나가 지금 쓰는 묶음과 그 묶음의 현재 가용성. 범위가 없으면 둘 다 null (M4 options 응답의 `ruleBundleVersion`·`ruleBundleStatus`). */
export interface ClinicRuleBundleStatus {
  ruleBundleVersionId: string | null;
  ruleBundleStatus: BundleAvailability | null;
}

export interface AffectedClinic {
  clinicId: string;
  slug: string;
}

/**
 * PO 가 병원의 규칙 사용 범위를 지정한다. 병원·묶음이 있어야 한다(NOT_FOUND).
 * [문서에 없음] 중지된 묶음도 지정할 수 있다: DD-14 는 범위가 중지된 묶음을 계속 가리킨다고만 적고 지정을 막지 않으며,
 * 막는 규칙을 더하는 쪽이 더 큰 동작이다. 계산은 그 묶음을 RULE_BUNDLE_SUSPENDED 보류로 다룬다. 같은 묶음을 다시 지정해도 이력에 남는다.
 */
export function assignRuleScope(deps: ServiceDeps, actor: Actor, clinicId: string, bundleId: string): ClinicRuleScope {
  requireRole(actor, 'PO');
  return deps.repo.transaction(() => {
    if (deps.repo.getClinic(clinicId) === null) {
      throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
    }
    if (deps.repo.getRuleBundleVersion(bundleId) === null) {
      throw new DomainError('NOT_FOUND', `규칙 묶음 '${bundleId}' 이(가) 없다`);
    }
    const previous = deps.repo.getClinicRuleScope(clinicId);
    const scope: ClinicRuleScope = { clinicId, ruleBundleVersionId: bundleId, assignedBy: { id: actor.id, role: actor.role }, assignedAt: deps.clock.now() };
    deps.repo.assignClinicRuleScope(scope);
    appendAudit(deps, actor, {
      action: 'CLINIC_SCOPE_ASSIGN',
      target: `CLINIC/${clinicId}`,
      beforeVersion: previous === null ? null : previous.ruleBundleVersionId,
      afterVersion: bundleId,
      reason: null,
    });
    return scope;
  });
}

/** 병원의 현재 범위가 가리키는 묶음 id 와 그 묶음의 현재 가용성을 읽는다. 호출마다 저장소에서 새로 읽고 저장소를 바꾸지 않는다. */
export function readClinicRuleBundle(repo: Pick<Repository, 'getClinicRuleScope' | 'getBundleStatus'>, clinicId: string): ClinicRuleBundleStatus {
  const scope = repo.getClinicRuleScope(clinicId);
  if (scope === null) {
    return { ruleBundleVersionId: null, ruleBundleStatus: null };
  }
  return { ruleBundleVersionId: scope.ruleBundleVersionId, ruleBundleStatus: repo.getBundleStatus(scope.ruleBundleVersionId) };
}

/** 영향을 받는 병원 = 현재 범위가 그 묶음 id 를 가리키는 병원 (DD-14). 지난 범위 이력은 세지 않는다. 병원 id 순. */
export function findAffectedClinics(repo: Pick<Repository, 'listClinics' | 'getClinicRuleScope'>, bundleId: string): AffectedClinic[] {
  return repo
    .listClinics()
    .filter((clinic) => repo.getClinicRuleScope(clinic.id)?.ruleBundleVersionId === bundleId)
    .map((clinic) => ({ clinicId: clinic.id, slug: clinic.slug }));
}
