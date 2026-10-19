import type { BundleAvailability, Clinic } from '../domain/entities';
import type { Repository } from '../repo/interfaces';
import type { BundleRef } from './bundle-ref';
import { ServerIntegrityError } from './integrity';
import type { EstimateRequest } from './estimate-request';
import type { PublishedCatalog } from './published-catalog';

// 현재 버전 비교와 409 VERSION_MISMATCH 본문 (SPEC-REIMBURSEMENT-001 M4.B, design.md DD-14·DD-19 층 3, AC-020a·AC-021k).
// 병원의 현재 버전 = 그 병원의 최신 CatalogVersion id 와 그 병원 ClinicRuleScope 가 가리키는 묶음 id. 요청의 두 값이 둘 다 같아야 계산한다.
// 이 파일은 층 0~2 를 통과한 요청에서만 불린다. 읽는 것은 카탈로그(현재 것과, 달랐다면 클라이언트가 본 옛 것)뿐이고 항목 상태·묶음 내용은 읽지 않는다.

type CatalogReads = Pick<Repository, 'getCatalogVersion' | 'getTreatmentVersion' | 'getCommonBaseFee'>;

/** 409 본문 (DD-14). 결과 객체·금액은 없다. */
export interface VersionMismatchBody {
  error: 'VERSION_MISMATCH';
  latest: { catalogVersion: string | null; ruleBundleVersion: string | null; ruleBundleStatus: BundleAvailability | null };
  changes: { priceChanged: boolean; ruleChanged: boolean; treatmentsUnpublished: string[] };
}

/** 요청이 본 두 버전이 모두 병원의 현재 값과 같은가. 묶음이 중지(SUSPENDED)여도 버전만 같으면 같다(중지는 층 5 의 결과, DD-14). */
export function versionsMatch(request: EstimateRequest, published: PublishedCatalog, bundle: BundleRef): boolean {
  return request.catalogVersion === (published.catalog?.id ?? null) && request.ruleBundleVersion === bundle.ruleBundleVersionId;
}

// @MX:NOTE: [AUTO] [문서에 없음] priceChanged 의 정의. DD-14 는 필드 이름만 정하고 계산 근거를 적지 않았다. 클라이언트가 본 카탈로그(요청의 catalogVersion)와 현재 카탈로그를 견주어
// 둘 다에 있는 치료(treatmentId)나 공통 기본비용(baseFeeId)의 가격이 달라졌으면 true 다. 치료를 내리거나 더하기만 했으면 false 다(그것은 treatmentsUnpublished 가 알린다).
// 서버가 모르는 값이거나 다른 병원의 카탈로그 id 이면 가격이 같다고 보일 수 없으므로 true 다(다른 병원의 자료를 읽어 견주지 않는다). 카탈로그 버전은 같고 묶음만 다르면 false 다.
function priceChanged(repo: CatalogReads, clinic: Clinic, request: EstimateRequest, published: PublishedCatalog): boolean {
  if (request.catalogVersion === (published.catalog?.id ?? null)) {
    return false;
  }
  const seen = repo.getCatalogVersion(request.catalogVersion);
  if (seen === null || seen.clinicId !== clinic.id) {
    return true;
  }
  const seenTreatments = new Map<string, number>();
  for (const versionId of seen.treatmentVersionIds) {
    const version = repo.getTreatmentVersion(versionId);
    if (version === null) {
      throw new ServerIntegrityError('TREATMENT_VERSION_MISSING');
    }
    seenTreatments.set(version.treatmentId, version.patientAmount);
  }
  const seenFees = new Map<string, number>();
  for (const feeVersionId of seen.baseFeeIds) {
    const fee = repo.getCommonBaseFee(feeVersionId);
    if (fee === null) {
      throw new ServerIntegrityError('BASE_FEE_MISSING');
    }
    seenFees.set(fee.baseFeeId, fee.amount);
  }
  return (
    published.treatments.some(({ version }) => seenTreatments.has(version.treatmentId) && seenTreatments.get(version.treatmentId) !== version.patientAmount) ||
    published.baseFees.some((fee) => seenFees.has(fee.baseFeeId) && seenFees.get(fee.baseFeeId) !== fee.amount)
  );
}

// @MX:NOTE: [AUTO] treatmentsUnpublished (DD-14, SPEC 제안·승인 전): 요청의 treatmentIds 가운데 병원의 현재 게시 카탈로그에 없는 치료 ID 를 요청에 적힌 순서대로 중복 없이 담는다.
// 요청 파서가 이미 중복을 없애고 순서를 지켰으므로 그대로 거른다. 다른 병원의 ID 도 같은 배열에 담긴다.
/** 409 본문을 만든다. 읽기만 한다. */
export function versionMismatchBody(repo: CatalogReads, clinic: Clinic, request: EstimateRequest, published: PublishedCatalog, bundle: BundleRef): VersionMismatchBody {
  const publishedIds = new Set(published.treatments.map(({ treatment }) => treatment.id));
  return {
    error: 'VERSION_MISMATCH',
    latest: {
      catalogVersion: published.catalog?.id ?? null,
      ruleBundleVersion: bundle.ruleBundleVersionId,
      ruleBundleStatus: bundle.ruleBundleStatus,
    },
    changes: {
      priceChanged: priceChanged(repo, clinic, request, published),
      ruleChanged: request.ruleBundleVersion !== bundle.ruleBundleVersionId,
      treatmentsUnpublished: request.treatmentIds.filter((id) => !publishedIds.has(id)),
    },
  };
}
