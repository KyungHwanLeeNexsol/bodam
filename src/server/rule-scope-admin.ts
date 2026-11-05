import { readBundleSummaries } from './bundle-overview';
import type { BundleSummaryView } from './bundle-overview';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { BundleAvailability, ClinicRuleScope } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Repository } from './repo/interfaces';
import { assignRuleScope } from './rule-scope';

// 규칙 사용 범위 지정 화면의 서비스 (SPEC-REIMBURSEMENT-001 M7 묶음 구성, 역할 PO). 기존 assignRuleScope(rule-scope.ts)를 감싸는 층이다.
//   readRuleScopeOverview     — 읽기 전용: 병원마다 현재 범위와 게시된 묶음 목록
//   assignRuleScopeChecked    — 화면이 본 현재 범위가 그 사이 바뀌지 않았을 때만 기존 assignRuleScope 로 지정한다(SCOPE_CHANGED)
// 지정은 PO 만 한다(DD-17): 묶음을 게시하는 RV 는 지정할 수 없고(bundle-compose.ts 는 범위를 건드리지 않는다), PO 는 게시할 수 없다.

export interface ClinicScopeRow {
  clinicId: string;
  slug: string;
  displayName: string;
  /** 현재 범위. 범위가 없으면 null. status 는 그 묶음의 지금 가용성(가용성 기록이 없으면 null). */
  current: { bundleId: string; status: BundleAvailability | null; assignedAt: string; assignedBy: string } | null;
}

export interface RuleScopeOverview {
  clinics: ClinicScopeRow[];
  /** 게시된 묶음 전부(ACTIVE · SUSPENDED), 최신순. 지정은 중지된 묶음도 막지 않는다(기존 계약): 화면이 중지된 묶음을 고르지 못하게 한다. */
  bundles: BundleSummaryView[];
}

type ScopeReads = Pick<Repository, 'getClinic' | 'getClinicRuleScope' | 'getBundleStatus'>;

function rowOf(repo: ScopeReads, clinic: { id: string; slug: string; name: string }): ClinicScopeRow {
  const scope = repo.getClinicRuleScope(clinic.id);
  return {
    clinicId: clinic.id,
    slug: clinic.slug,
    displayName: clinic.name,
    current: scope === null ? null : { bundleId: scope.ruleBundleVersionId, status: repo.getBundleStatus(scope.ruleBundleVersionId), assignedAt: scope.assignedAt, assignedBy: scope.assignedBy.id },
  };
}

/** 병원 한 곳의 한 줄. 병원이 없으면 null. 지정 응답이 화면의 그 줄을 새로 고치는 데 쓴다. */
export function readClinicScopeRow(repo: ScopeReads, clinicId: string): ClinicScopeRow | null {
  const clinic = repo.getClinic(clinicId);
  return clinic === null ? null : rowOf(repo, clinic);
}

/** 규칙 사용 범위 화면이 보여 줄 병원별 현재 범위와 묶음 목록. 읽기만 한다. 병원은 id 순이다. */
export function readRuleScopeOverview(repo: Repository): RuleScopeOverview {
  return { clinics: repo.listClinics().map((clinic) => rowOf(repo, clinic)), bundles: readBundleSummaries(repo) };
}

// @MX:ANCHOR: [AUTO] PO 의 규칙 사용 범위 지정 관리자 경로의 단일 진입점. 관리자 API(rule-scope 경로)와 시험이 부른다.
// @MX:REASON: "화면이 본 현재 범위"와 지정을 한 트랜잭션에서 비교해야 한다. 비교와 지정이 갈라지면 두 PO 가 같은 병원의 범위를 서로 모르게 덮어쓴다.
/**
 * PO 가 병원의 규칙 사용 범위를 지정한다. 순서: 역할 → 병원 있음(NOT_FOUND) → 묶음 있음(NOT_FOUND) → 현재 범위 비교(STATE_CONFLICT SCOPE_CHANGED) → 기존 assignRuleScope.
 * expectedCurrentBundleId 는 화면이 본 현재 범위의 묶음 id 이고, null 은 "범위가 없다고 보았다"는 뜻이다. 현재 범위가 다르면 아무것도 쓰지 않는다.
 * 같은 묶음을 다시 지정하는 것도 기존 계약대로 이력에 남는다(expected 가 현재와 같을 때). 중지된 묶음의 지정은 기존 계약(assignRuleScope)을 따라 막지 않는다.
 */
export function assignRuleScopeChecked(deps: ServiceDeps, actor: Actor, clinicId: string, bundleId: string, expectedCurrentBundleId: string | null): ClinicRuleScope {
  requireRole(actor, 'PO');
  return deps.repo.transaction(() => {
    if (deps.repo.getClinic(clinicId) === null) {
      throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
    }
    if (deps.repo.getRuleBundleVersion(bundleId) === null) {
      throw new DomainError('NOT_FOUND', `규칙 묶음 '${bundleId}' 이(가) 없다`);
    }
    const current = deps.repo.getClinicRuleScope(clinicId);
    if ((current === null ? null : current.ruleBundleVersionId) !== expectedCurrentBundleId) {
      throw new DomainError('STATE_CONFLICT', `병원 '${clinicId}' 의 규칙 사용 범위가 화면이 본 값과 달라졌다`, [{ code: 'SCOPE_CHANGED', path: 'expectedCurrentBundleId' }]);
    }
    return assignRuleScope(deps, actor, clinicId, bundleId);
  });
}
