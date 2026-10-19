import type { TreatmentVersion } from './domain/entities';
import type { Repository } from './repo/interfaces';

// 치료의 "현재 치료 버전" (design.md DD-15 지문 방어). 승인과 규칙 묶음 게시는 이 파일을 직접 부르지 않고 coverage-target.ts 의 조회를 부르며,
// 그 조회가 치료 쪽에서 이 규칙을 쓰고 공통 기본비용 쪽에서 같은 선택 규칙(pickCurrentVersion)을 쓴다. 구현이 둘이면 승인은 통과하고
// 게시는 거절되는 어긋남이 생긴다.

type CurrentVersionReads = Pick<Repository, 'getTreatment' | 'getClinicCurrentCatalogVersion' | 'listTreatmentVersions'>;

// @MX:ANCHOR: [AUTO] 현재 치료 버전 선택의 단일 구현. 현재 보장 대상 조회(coverage-target.ts)를 거쳐 매핑 승인(지문 고정)과 규칙 묶음 게시(고정 지문의 낡음 검사)가 부른다.
// @MX:REASON: [문서에 없음] "현재 게시된 치료 버전"(DD-15)을 고르는 규칙이 한 곳에 있어야 승인 때 고정한 지문과 게시 때 비교하는 지문이 같은 버전에서 나온다.
/**
 * 치료의 현재 버전: 그 치료가 속한 병원의 현재 카탈로그 버전에 든 그 치료의 버전(쓰기 순서상 첫 번째 일치)이고,
 * 현재 카탈로그에 없으면(또는 병원에 현재 카탈로그가 없으면) 쓰기 순서상 가장 나중 버전이다. 버전이 하나도 없으면 null.
 */
export function currentTreatmentVersion(repo: CurrentVersionReads, treatmentId: string): TreatmentVersion | null {
  const treatment = repo.getTreatment(treatmentId);
  const catalog = treatment === null ? null : repo.getClinicCurrentCatalogVersion(treatment.clinicId);
  return pickCurrentVersion(repo.listTreatmentVersions(treatmentId), catalog?.treatmentVersionIds ?? []);
}

// @MX:NOTE: [AUTO] "현재 버전" 선택 규칙의 단일 본문. 치료 버전(이 파일)과 공통 기본비용 버전(coverage-target.ts)이 같은 규칙을 쓴다.
/**
 * 버전 목록(쓰기 순서)에서 현재 버전을 고른다: 병원의 현재 카탈로그 버전이 담은 버전 id 에 드는 첫 번째 버전, 없으면 쓰기 순서상 가장 나중 버전,
 * 목록이 비면 null.
 */
export function pickCurrentVersion<V extends { id: string }>(versions: readonly V[], catalogVersionIds: readonly string[]): V | null {
  const inCatalog = new Set(catalogVersionIds);
  return versions.find((candidate) => inCatalog.has(candidate.id)) ?? versions.at(-1) ?? null;
}
