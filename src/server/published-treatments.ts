import type { CatalogVersion, Treatment, TreatmentVersion } from './domain/entities';
import type { Repository } from './repo/interfaces';

// 현재 게시된 치료의 선택 기준 (SPEC-REIMBURSEMENT-001 M4, design.md DD-19 비활성 치료 제외, DD-23 규칙 0).
// 공개 카탈로그(M4.A)와 계산 요청의 치료 ID 대조·줄 조립(M4.B)과 운영 준비 상태의 게시 줄(M3.E)이 같은 기준을 쓰도록 이 파일 한 곳에 둔다:
// "현재 게시 카탈로그에 있는 치료" 의 정의가 둘이면 계산에서 ESTIMATED 인 선택이 준비 상태에서는 NOT_READY 이거나 그 반대가 되는 어긋남이 생긴다.
// 이 파일은 도메인 엔티티와 저장소 인터페이스의 형식만 가져온다(src/server/api 를 가져오지 않는다): 호출한 층마다 결함의 오류 종류가 다르므로
// 결함은 호출한 쪽이 주입하는 실패 함수로 알린다(공개 경로는 ServerIntegrityError, 준비 상태는 DomainError).

/** 현재 게시된 치료 한 건: 활성 치료와 카탈로그가 담은 그 치료의 버전. */
export interface PublishedTreatment {
  treatment: Treatment;
  version: TreatmentVersion;
}

/**
 * 카탈로그가 담은 참조가 저장소와 맞지 않는 결함(서버 데이터 무결성 결함). code 는 공개 경로의 ServerIntegrityCode 와 같은 이름이다.
 *  - TREATMENT_VERSION_MISSING: 카탈로그가 담은 치료 버전이 저장소에 없다.
 *  - TREATMENT_MISSING: 치료 버전이 가리키는 치료가 저장소에 없다.
 *  - TREATMENT_CLINIC_MISMATCH: 카탈로그가 담은 치료가 다른 병원의 것이다 (clinicId 는 기대한 병원이다).
 */
export type PublishedTreatmentDefect =
  | { code: 'TREATMENT_VERSION_MISSING'; treatmentVersionId: string }
  | { code: 'TREATMENT_MISSING'; treatmentVersionId: string; treatmentId: string }
  | { code: 'TREATMENT_CLINIC_MISMATCH'; treatmentId: string; clinicId: string };

type PublishedTreatmentReads = Pick<Repository, 'getTreatmentVersion' | 'getTreatment'>;

// @MX:NOTE: [AUTO] [문서에 없음] 비활성(active=false) 치료는 현재 게시 카탈로그에 없는 것으로 본다: DD-19 층 4 가 "비활성·미게시 치료 ID" 를 TREATMENT_NOT_PUBLISHED 로 보내고,
// 공개 카탈로그 응답에도 싣지 않으며, 준비 상태도 같은 치료 집합을 본다(계산이 하지 못하는 치료 때문에 준비 상태가 막히거나, 계산할 치료가 없는데 준비 완료로 나오지 않게).
// 카탈로그 버전은 불변이라 비활성은 치료 쪽(가변 기록)의 active 로 판단한다. 공통 기본비용은 이 기준과 별개다(등록된 것이 전부 자동 포함된다).
/**
 * 병원의 현재 카탈로그가 담은 치료 버전을 카탈로그에 적힌 순서대로 하나씩 치료·소유 병원까지 확인하고, 활성 치료의 (치료, 치료 버전) 짝만 고른다.
 * 확인 순서는 항목마다 치료 버전 → 치료 → 소유 병원 → 활성이고, 깨진 참조(활성 여부와 무관)는 처음 걸린 하나를 fail 로 알린다 (fail 은 돌아오지 않는다).
 * 정렬하지 않는다(표시 순서는 호출한 층의 몫이다). 읽기만 하며 저장소를 바꾸지 않는다.
 */
export function selectPublishedTreatments(
  repo: PublishedTreatmentReads,
  clinicId: string,
  catalog: CatalogVersion,
  fail: (defect: PublishedTreatmentDefect) => never,
): PublishedTreatment[] {
  const published: PublishedTreatment[] = [];
  for (const treatmentVersionId of catalog.treatmentVersionIds) {
    const version = repo.getTreatmentVersion(treatmentVersionId);
    if (version === null) {
      return fail({ code: 'TREATMENT_VERSION_MISSING', treatmentVersionId });
    }
    const treatment = repo.getTreatment(version.treatmentId);
    if (treatment === null) {
      return fail({ code: 'TREATMENT_MISSING', treatmentVersionId, treatmentId: version.treatmentId });
    }
    if (treatment.clinicId !== clinicId) {
      return fail({ code: 'TREATMENT_CLINIC_MISMATCH', treatmentId: treatment.id, clinicId });
    }
    if (treatment.active) {
      published.push({ treatment, version });
    }
  }
  return published;
}
