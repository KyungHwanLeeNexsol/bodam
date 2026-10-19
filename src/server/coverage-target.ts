import type { CommonBaseFee, TreatmentVersion } from './domain/entities';
import { coverageFingerprintOf, coverageFingerprintOfBaseFee } from './fingerprint';
import type { Repository } from './repo/interfaces';
import { currentTreatmentVersion, pickCurrentVersion } from './treatment-current';

// 매핑이 가리키는 "현재 보장 대상" 조회 (design.md DD-15 지문 방어, DD-03: 공통 기본비용도 치료와 같은 매핑 판정을 거친다).
// 매핑의 treatmentId 는 치료 id 이거나 공통 기본비용의 안정 식별자(baseFeeId)다. 두 종류는 한 id 공간을 쓰므로 어느 쪽인지 모호하지 않다
// (저장소 백스톱: repo/memory 의 putCommonBaseFee·saveTreatment). 매핑 승인(approval.ts)이 지문을 고정할 때와 규칙 묶음 게시(bundle-publish.ts)가
// 고정 지문이 낡지 않았는지 볼 때가 모두 이 조회만 쓴다. 구현이 둘이면 승인은 통과하고 게시는 거절되는 어긋남이 생긴다.

type CoverageTargetReads = Pick<
  Repository,
  'getTreatment' | 'getClinicCurrentCatalogVersion' | 'listTreatmentVersions' | 'listCommonBaseFeeVersions'
>;

/** 현재 보장 대상: 종류, 현재 버전, 그 버전의 지문. */
export type CoverageTarget =
  | { kind: 'TREATMENT'; version: TreatmentVersion; fingerprint: string }
  | { kind: 'BASE_FEE'; fee: CommonBaseFee; fingerprint: string };

/**
 * 공통 기본비용의 현재 버전: 그 기본비용이 속한 병원의 현재 카탈로그 버전에 든 버전(쓰기 순서상 첫 번째 일치)이고, 현재 카탈로그에 없으면
 * (또는 병원에 현재 카탈로그가 없으면) 쓰기 순서상 가장 나중 버전. 버전이 하나도 없으면 null. 선택 규칙은 치료 버전과 같은 pickCurrentVersion 이다.
 * [문서에 없음] 같은 기본비용의 모든 버전은 한 병원의 것이다(카탈로그 게시의 소유 확인이 막는다). 병원은 쓰기 순서상 첫 버전에서 읽는다.
 */
function currentBaseFeeVersion(repo: CoverageTargetReads, baseFeeId: string): CommonBaseFee | null {
  const versions = repo.listCommonBaseFeeVersions(baseFeeId);
  const first = versions[0];
  const catalog = first === undefined ? null : repo.getClinicCurrentCatalogVersion(first.clinicId);
  return pickCurrentVersion(versions, catalog?.baseFeeIds ?? []);
}

// @MX:ANCHOR: [AUTO] 현재 보장 대상 조회의 단일 구현. 매핑 승인(지문 고정)과 규칙 묶음 게시(고정 지문의 낡음 검사)가 부른다.
// @MX:REASON: "현재 게시된 버전"(DD-15)을 고르는 규칙과 그 버전의 지문이 한 곳에서 나와야 승인 때 고정한 지문과 게시 때 비교하는 지문이 어긋나지 않는다. 치료만 보는 조회가 남으면 기본비용 매핑이 TREATMENT_VERSION_ABSENT 로 막힌다.
/**
 * 매핑 대상 id 의 현재 보장 대상: 치료이면 현재 치료 버전(currentTreatmentVersion 의 규칙)과 그 지문, 아니면 공통 기본비용의 현재 버전과 그 지문.
 * 치료도 기본비용도 아니면(또는 버전이 하나도 없으면) null — 호출자가 TREATMENT_VERSION_ABSENT 로 거절한다. 읽기만 한다.
 */
export function currentCoverageTarget(repo: CoverageTargetReads, targetId: string): CoverageTarget | null {
  const version = currentTreatmentVersion(repo, targetId);
  if (version !== null) {
    return { kind: 'TREATMENT', version, fingerprint: coverageFingerprintOf(version) };
  }
  const fee = currentBaseFeeVersion(repo, targetId);
  return fee === null ? null : { kind: 'BASE_FEE', fee, fingerprint: coverageFingerprintOfBaseFee(fee) };
}
