import { compareCodePoints } from '../engine/validate';
import type { BenefitType, CalcClass } from '../engine/types';
import type { CoverageReviewRequest, ReviewRequestStatus } from './domain/entities';
import type { Repository } from './repo/interfaces';

// 검토 요청의 읽기 보기 (M7 검토 요청). 읽기만 한다: 저장소를 바꾸지 않고, 쓰기 메서드를 부르지 않는다(Pick 으로 읽기 메서드만 받는다).
// 보기는 화면과 API 가 보여 줄 필드만 담는다. 요청이 만드는 매핑 초안·결과 매핑 연결(draftMappingRef·resultMappingRef)과 병원 id 는 싣지 않는다:
// 병원 관리자는 요청의 상태·결과·반려 사유를 읽을 뿐이고 매핑 자체를 보지 않는다(권한 표: HA 는 검토 요청 상태·결과·반려 사유를 읽기만).

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
}

/** 대기열 항목이 함께 보여 주는, 그 병원의 현재 게시본에 있는 치료의 판단 필드. */
export interface CurrentTreatmentView {
  displayName: string;
  treatmentCode: string;
  benefitType: BenefitType;
  procedureCodes: string[];
  calcClass: CalcClass;
}

/** RV 대기열 항목: 요청 보기 + 병원 + 현재 게시본의 치료 내용(그 병원의 현재 카탈로그에 그 치료가 없으면 null). */
export interface ReviewQueueEntry extends ReviewRequestView {
  clinic: { id: string; name: string };
  current: CurrentTreatmentView | null;
}

type ViewReads = Pick<Repository, 'listTreatmentVersions'>;
type ClinicViewReads = Pick<Repository, 'listCoverageReviewRequests' | 'listTreatmentVersions'>;
type QueueReads = Pick<Repository, 'listClinics' | 'listCoverageReviewRequests' | 'listTreatmentVersions' | 'getClinicCurrentCatalogVersion' | 'getTreatmentVersion'>;

/** 요청 한 건의 보기. 제안 값과 행위 코드는 복사본이다. */
export function reviewRequestView(repo: ViewReads, request: CoverageReviewRequest): ReviewRequestView {
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
  };
}

/** 병원 한 곳의 요청 전부(닫힌 것 포함)를 최신순으로: 요청 시각 내림차순, 같으면 요청 id 의 코드 포인트 내림차순. */
export function readClinicReviewRequestViews(repo: ClinicViewReads, clinicId: string): ReviewRequestView[] {
  return repo
    .listCoverageReviewRequests(clinicId)
    .sort((a, b) => compareCodePoints(b.requestedAt, a.requestedAt) || compareCodePoints(b.id, a.id))
    .map((request) => reviewRequestView(repo, request));
}

/**
 * RV 대기열: 모든 병원의 열린 요청(REVIEW_REQUESTED)만, 오래된 순으로: 요청 시각 오름차순, 같으면 병원 id, 요청 id 의 코드 포인트 순.
 * current 는 그 병원의 현재 카탈로그가 담은 그 치료의 버전이다(카탈로그에 그 치료가 없으면 null). 깨진 참조는 null 로 읽고 던지지 않는다.
 */
export function readReviewQueue(repo: QueueReads): ReviewQueueEntry[] {
  const entries: Array<{ clinicId: string; entry: ReviewQueueEntry }> = [];
  for (const clinic of repo.listClinics()) {
    const open = repo.listCoverageReviewRequests(clinic.id).filter((request) => request.status === 'REVIEW_REQUESTED');
    if (open.length === 0) {
      continue;
    }
    const catalog = repo.getClinicCurrentCatalogVersion(clinic.id);
    const currentByTreatment = new Map<string, CurrentTreatmentView>();
    for (const versionId of catalog === null ? [] : catalog.treatmentVersionIds) {
      const version = repo.getTreatmentVersion(versionId);
      if (version !== null) {
        currentByTreatment.set(version.treatmentId, {
          displayName: version.displayName,
          treatmentCode: version.treatmentCode,
          benefitType: version.benefitType,
          procedureCodes: [...version.procedureCodes],
          calcClass: version.calcClass,
        });
      }
    }
    for (const request of open) {
      entries.push({ clinicId: clinic.id, entry: { ...reviewRequestView(repo, request), clinic: { id: clinic.id, name: clinic.name }, current: currentByTreatment.get(request.treatmentId) ?? null } });
    }
  }
  return entries
    .sort((a, b) => compareCodePoints(a.entry.requestedAt, b.entry.requestedAt) || compareCodePoints(a.clinicId, b.clinicId) || compareCodePoints(a.entry.id, b.entry.id))
    .map(({ entry }) => entry);
}
