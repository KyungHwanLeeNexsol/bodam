import { currentCoverageTarget } from './coverage-target';
import type { Repository } from './repo/interfaces';

// 매핑이 가리키는 보장 대상(치료 또는 공통 기본비용)의 화면용 이름표 (M7 묶음 구성: 후보 목록과 미리보기가 같은 함수를 쓴다). 읽기만 한다.
// 현재 보장 대상 조회(coverage-target.ts)를 그대로 쓰므로 "현재 버전"을 고르는 규칙이 승인·게시와 같다. 읽을 수 없는 것은 null 로 두고 던지지 않는다 —
// 이름을 모른다는 것이 대상이 없다는 뜻은 아니므로 호출한 쪽이 "알 수 없음"과 "없음"을 가른다.

export interface CoverageTargetLabel {
  /** TREATMENT = 치료, BASE_FEE = 공통 기본비용, UNKNOWN = 치료도 기본비용도 읽을 수 없다(버전이 하나도 없거나 id 가 맞지 않음). */
  kind: 'TREATMENT' | 'BASE_FEE' | 'UNKNOWN';
  displayName: string | null;
  clinicId: string | null;
  clinicSlug: string | null;
}

type LabelReads = Pick<Repository, 'getTreatment' | 'getClinicCurrentCatalogVersion' | 'listTreatmentVersions' | 'listCommonBaseFeeVersions' | 'getClinic'>;

export function describeCoverageTarget(repo: LabelReads, targetId: string): CoverageTargetLabel {
  const current = currentCoverageTarget(repo, targetId);
  const treatment = repo.getTreatment(targetId);
  const clinicId = current !== null && current.kind === 'BASE_FEE' ? current.fee.clinicId : treatment === null ? null : treatment.clinicId;
  const clinic = clinicId === null ? null : repo.getClinic(clinicId);
  return {
    kind: current === null ? 'UNKNOWN' : current.kind,
    displayName: current === null ? null : current.kind === 'TREATMENT' ? current.version.displayName : current.fee.displayName,
    clinicId,
    clinicSlug: clinic === null ? null : clinic.slug,
  };
}
