import { compareCodePoints } from '../engine/validate';
import { appendAudit } from './audit';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { CatalogChangeSummary, CatalogVersion, CommonBaseFee, TreatmentVersion } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import { assertNoDefects, validateCatalogPublish } from './publish-validate';
import type { CatalogPublishConfig } from './publish-validate';
import { triggerReReview } from './re-review';

// 카탈로그 게시 서비스 (SPEC-REIMBURSEMENT-001 M3.D1, design.md DD-14·DD-16·DD-24, 역할 HA).
//   publishCatalog          — 한 병원의 치료 버전·공통 기본비용을 새 CatalogVersion 으로 게시한다 (AC-009a, AC-009c, AC-010c, AC-011h)
//   restoreCatalogVersion   — 이전 CatalogVersion 의 사본을 같은 게시 경로로 새 id 에 게시한다 (AC-011b)
// 게시는 하나의 저장소 트랜잭션이다: 검증 → 소유 확인 → 치료 버전·기본비용·카탈로그 쓰기 → 병원의 현재 카탈로그 갱신 →
// 치료 버전마다 재검토 전환 → 감사 기록. 어느 단계든 던지면 쓰기 전부(감사 기록 포함)가 되돌려지고 이전 카탈로그가 현재로 남는다.
// 역할만 본다: 병원 소유·소속·인증은 M7(AC-022a)이 하며 여기에 구현하지 않는다.

/** 소유 확인: 검증이 끝난 요청의 치료 버전이 이 병원의 치료에 속하는지, 공통 기본비용이 이 병원의 것인지. 검증기는 병원 id 를 받지 않는다. */
function ownershipDefects(deps: ServiceDeps, clinicId: string, versions: readonly TreatmentVersion[], fees: readonly CommonBaseFee[]): Defect[] {
  const out: Defect[] = [];
  versions.forEach((version, index) => {
    const treatment = deps.repo.getTreatment(version.treatmentId);
    if (treatment === null) {
      out.push({ code: 'TREATMENT_ABSENT', path: `treatmentVersions[${index}].treatmentId` });
    } else if (treatment.clinicId !== clinicId) {
      out.push({ code: 'TREATMENT_CLINIC_MISMATCH', path: `treatmentVersions[${index}].treatmentId` });
    }
  });
  fees.forEach((fee, index) => {
    if (fee.clinicId !== clinicId) {
      out.push({ code: 'BASE_FEE_CLINIC_MISMATCH', path: `commonBaseFees[${index}].clinicId` });
    }
  });
  return out;
}

const sortedIds = (ids: Iterable<string>): string[] => [...ids].sort(compareCodePoints);

/**
 * 변경 요약: 병원의 직전 현재 카탈로그와 비교한 추가·제거·가격 변경 치료 id (코드 포인트 순)와 공통 기본비용 구성의 변경 여부.
 * 가격 변경은 같은 치료의 patientAmount 가 달라진 경우뿐이다(표시 이름 등은 변경이 아니다). 직전 카탈로그가 없으면 비교 대상이 비어 있다.
 */
function summarize(deps: ServiceDeps, previous: CatalogVersion | null, versions: readonly TreatmentVersion[], baseFeeIds: readonly string[]): CatalogChangeSummary {
  // 카탈로그가 담은 id 는 저장소가 쓸 때 존재를 확인했다(putCatalogVersion).
  const before = new Map((previous?.treatmentVersionIds ?? []).map((id) => deps.repo.getTreatmentVersion(id)!).map((version) => [version.treatmentId, version.patientAmount]));
  const after = new Map(versions.map((version) => [version.treatmentId, version.patientAmount]));
  const previousFees = new Set(previous?.baseFeeIds ?? []);
  const nextFees = new Set(baseFeeIds);
  return {
    addedTreatmentIds: sortedIds([...after.keys()].filter((id) => !before.has(id))),
    removedTreatmentIds: sortedIds([...before.keys()].filter((id) => !after.has(id))),
    priceChangedTreatmentIds: sortedIds([...after].filter(([id, amount]) => before.has(id) && before.get(id) !== amount).map(([id]) => id)),
    baseFeesChanged: previousFees.size !== nextFees.size || [...nextFees].some((id) => !previousFees.has(id)),
  };
}

interface AuditChoice {
  action: string;
  reason: string | null;
}

function publishNew(deps: ServiceDeps, actor: Actor, clinicId: string, request: unknown, config: CatalogPublishConfig, audit: AuditChoice): CatalogVersion {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    const clinic = deps.repo.getClinic(clinicId);
    if (clinic === null) {
      throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
    }
    // 검증이 통과하면 요청은 형식이 맞는 치료 버전·공통 기본비용 배열을 가진 객체다.
    assertNoDefects(validateCatalogPublish(request, config));
    const { treatmentVersions, commonBaseFees } = request as { treatmentVersions: TreatmentVersion[]; commonBaseFees: CommonBaseFee[] };
    assertNoDefects(ownershipDefects(deps, clinicId, treatmentVersions, commonBaseFees));

    // 아래부터 쓰기다. id 는 검증이 끝난 뒤에야 만든다(거절이 생성기를 소비하지 않는다).
    const previous = deps.repo.getClinicCurrentCatalogVersion(clinicId);
    const baseFeeIds = commonBaseFees.map((fee) => fee.id);
    const catalog: CatalogVersion = {
      id: deps.ids.next('CATALOG'),
      clinicId,
      treatmentVersionIds: treatmentVersions.map((version) => version.id),
      baseFeeIds,
      publishedBy: { id: actor.id, role: actor.role },
      publishedAt: deps.clock.now(),
      changeSummary: summarize(deps, previous, treatmentVersions, baseFeeIds),
    };
    treatmentVersions.forEach((version) => deps.repo.putTreatmentVersion(version));
    commonBaseFees.forEach((fee) => deps.repo.putCommonBaseFee(fee));
    deps.repo.putCatalogVersion(catalog);
    deps.repo.saveClinic({ ...clinic, currentCatalogVersionId: catalog.id });
    // 보장 판단 필드가 바뀐 치료 버전이면 그 치료의 APPROVED·PUBLISHED 매핑이 UNDER_REREVIEW 가 된다. 가격만 바뀐 게시는 아무것도 옮기지 않는다 (DD-16).
    treatmentVersions.forEach((version) => triggerReReview(deps, actor, version));
    appendAudit(deps, actor, { action: audit.action, target: `CATALOG/${catalog.id}`, beforeVersion: previous?.id ?? null, afterVersion: catalog.id, reason: audit.reason });
    return catalog;
  });
}

// @MX:ANCHOR: [AUTO] 카탈로그 게시의 단일 진입점. 관리자 API(M7)·준비 상태 시험(M3.E)·계산 API 시험(M4)·재검토/가격 시험이 모두 부른다.
// @MX:REASON: 검증·소유 확인·재검토 전환·현재 카탈로그 갱신이 한 트랜잭션에서 함께 일어나야 한다. 한 단계라도 빠지면 가격은 게시됐는데 매핑이 승인 상태로 남거나, 거절된 게시가 현재 카탈로그를 바꾼다.
/**
 * HA 가 한 병원의 카탈로그를 게시한다. 새 id 의 CatalogVersion 이 쓰이고(가격만 바뀐 게시도 마찬가지) 병원의 현재 카탈로그가 된다.
 * 결함이 있으면(검증기의 형식·범위·출처·중복 결함, 소유 결함) PUBLISH_VALIDATION_FAILED 로 던지고 저장소는 호출 전과 같다.
 * 요청의 치료 버전·기본비용은 저장소가 복사해 저장한다(요청 객체를 바꾸지 않는다). `config.acceptedLineOrigins` 가 허용 출처다 —
 * 운영 구성은 ['OPERATING'] 이므로 DEMO·TEST_FIXTURE 는 거절된다 (AC-010c).
 */
export function publishCatalog(deps: ServiceDeps, actor: Actor, clinicId: string, request: unknown, config: CatalogPublishConfig): CatalogVersion {
  return publishNew(deps, actor, clinicId, request, config, { action: 'CATALOG_PUBLISH', reason: null });
}

/**
 * 이전 카탈로그 버전의 사본을 새 id 로 게시한다(복구). 같은 게시 경로를 지나므로 검증·소유 확인·재검토 전환·HA 역할 규칙이 그대로 적용되고,
 * 옛 내용이 지금의 게시 규칙을 통과하지 못하면 유형 있는 거절이며 아무것도 저장되지 않는다. 원본과 그 밖의 기존 버전·이력은 건드리지 않는다.
 * 병원은 원본의 병원이다. 감사 기록의 사유 `RESTORE_OF:<원본 id>` 가 원본을 가리킨다.
 */
export function restoreCatalogVersion(deps: ServiceDeps, actor: Actor, sourceCatalogVersionId: string, config: CatalogPublishConfig): CatalogVersion {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    const source = deps.repo.getCatalogVersion(sourceCatalogVersionId);
    if (source === null) {
      throw new DomainError('NOT_FOUND', `카탈로그 버전 '${sourceCatalogVersionId}' 이(가) 없다`);
    }
    const request = {
      treatmentVersions: source.treatmentVersionIds.map((id) => deps.repo.getTreatmentVersion(id)),
      commonBaseFees: source.baseFeeIds.map((id) => deps.repo.getCommonBaseFee(id)),
    };
    return publishNew(deps, actor, source.clinicId, request, config, { action: 'CATALOG_RESTORE', reason: `RESTORE_OF:${source.id}` });
  });
}
