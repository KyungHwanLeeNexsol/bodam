import { compareCodePoints } from '../../engine/validate';
import type { CatalogVersion, Clinic, CommonBaseFee, Treatment, TreatmentVersion } from '../domain/entities';
import type { Repository } from '../repo/interfaces';
import { ServerIntegrityError } from './integrity';

// 병원의 현재 게시 카탈로그 읽기 (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-14·DD-19·DD-03).
// catalog 응답(M4.A)과 계산 요청의 치료 ID 대조·엔진 줄 조립(M4.B)이 같은 읽기를 쓰도록 한 곳에 둔다:
// "현재 게시 카탈로그에 있는 치료" 의 정의가 둘이면 catalog 에 보이는 치료가 계산에서는 TREATMENT_NOT_PUBLISHED 가 되는 어긋남이 생긴다.

export interface PublishedTreatment {
  treatment: Treatment;
  version: TreatmentVersion;
}

export interface PublishedCatalog {
  /** 병원의 현재 카탈로그 버전. 게시한 적이 없으면 null (그때 치료와 기본비용은 빈 목록). */
  catalog: CatalogVersion | null;
  /** 노출 중인 치료(활성), 노출 순서(sortOrder) 오름차순이고 같으면 치료 id 의 코드 포인트 순. */
  treatments: PublishedTreatment[];
  /** 등록된 공통 기본비용, 안정 식별자(baseFeeId)의 코드 포인트 순. */
  baseFees: CommonBaseFee[];
}

type CatalogReads = Pick<Repository, 'getClinicCurrentCatalogVersion' | 'getTreatmentVersion' | 'getTreatment' | 'getCommonBaseFee'>;

// @MX:NOTE: [AUTO] [문서에 없음] 비활성(active=false) 치료는 현재 게시 카탈로그에 없는 것으로 본다: DD-19 층 4 가 "비활성·미게시 치료 ID" 를 TREATMENT_NOT_PUBLISHED 로 보내고,
// catalog 응답에도 싣지 않아야 키오스크가 고를 수 없는 치료를 보여 주지 않는다. 카탈로그 버전은 불변이라 비활성은 치료 쪽(가변 기록)의 active 로 판단한다.
/**
 * 병원의 현재 게시 카탈로그를 읽는다. 카탈로그가 담은 참조가 저장소와 맞지 않으면(버전·치료·기본비용이 없거나 다른 병원의 것) 서버 데이터 무결성 결함이다.
 * 항목(프로필·매핑·서류 규칙)과 묶음은 읽지 않는다. 저장소를 바꾸지 않는다.
 */
export function readPublishedCatalog(repo: CatalogReads, clinic: Clinic): PublishedCatalog {
  const catalog = repo.getClinicCurrentCatalogVersion(clinic.id);
  if (catalog === null) {
    return { catalog: null, treatments: [], baseFees: [] };
  }
  const treatments: PublishedTreatment[] = [];
  for (const versionId of catalog.treatmentVersionIds) {
    const version = repo.getTreatmentVersion(versionId);
    if (version === null) {
      throw new ServerIntegrityError('TREATMENT_VERSION_MISSING');
    }
    const treatment = repo.getTreatment(version.treatmentId);
    if (treatment === null) {
      throw new ServerIntegrityError('TREATMENT_MISSING');
    }
    if (treatment.clinicId !== clinic.id) {
      throw new ServerIntegrityError('TREATMENT_CLINIC_MISMATCH');
    }
    if (treatment.active) {
      treatments.push({ treatment, version });
    }
  }
  treatments.sort((a, b) => a.treatment.sortOrder - b.treatment.sortOrder || compareCodePoints(a.treatment.id, b.treatment.id));

  const baseFees: CommonBaseFee[] = [];
  for (const feeVersionId of catalog.baseFeeIds) {
    const fee = repo.getCommonBaseFee(feeVersionId);
    if (fee === null) {
      throw new ServerIntegrityError('BASE_FEE_MISSING');
    }
    if (fee.clinicId !== clinic.id) {
      throw new ServerIntegrityError('BASE_FEE_CLINIC_MISMATCH');
    }
    baseFees.push(fee);
  }
  baseFees.sort((a, b) => compareCodePoints(a.baseFeeId, b.baseFeeId));
  return { catalog, treatments, baseFees };
}
