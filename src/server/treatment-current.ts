import type { TreatmentVersion } from './domain/entities';
import type { Repository } from './repo/interfaces';

// 치료의 "현재 치료 버전" (design.md DD-15 지문 방어). 매핑 승인이 지문을 고정할 때(approval.ts)와 규칙 묶음 게시가 고정 지문이
// 낡지 않았는지 볼 때(bundle-publish.ts)가 같은 규칙으로 같은 버전을 고른다. 구현이 둘이면 승인은 통과하고 게시는 거절되는 어긋남이 생긴다.

type CurrentVersionReads = Pick<Repository, 'getTreatment' | 'getClinicCurrentCatalogVersion' | 'listTreatmentVersions'>;

// @MX:ANCHOR: [AUTO] 현재 치료 버전 선택의 단일 구현. 매핑 승인(지문 고정), 규칙 묶음 게시(고정 지문의 낡음 검사), 이후 준비 상태 계산(M3.E)이 부른다.
// @MX:REASON: [문서에 없음] "현재 게시된 치료 버전"(DD-15)을 고르는 규칙이 한 곳에 있어야 승인 때 고정한 지문과 게시 때 비교하는 지문이 같은 버전에서 나온다.
/**
 * 치료의 현재 버전: 그 치료가 속한 병원의 현재 카탈로그 버전에 든 그 치료의 버전(쓰기 순서상 첫 번째 일치)이고,
 * 현재 카탈로그에 없으면(또는 병원에 현재 카탈로그가 없으면) 쓰기 순서상 가장 나중 버전이다. 버전이 하나도 없으면 null.
 */
export function currentTreatmentVersion(repo: CurrentVersionReads, treatmentId: string): TreatmentVersion | null {
  const treatment = repo.getTreatment(treatmentId);
  const catalog = treatment === null ? null : repo.getClinicCurrentCatalogVersion(treatment.clinicId);
  const inCatalog = new Set(catalog?.treatmentVersionIds ?? []);
  const versions = repo.listTreatmentVersions(treatmentId);
  return versions.find((candidate) => inCatalog.has(candidate.id)) ?? versions.at(-1) ?? null;
}
