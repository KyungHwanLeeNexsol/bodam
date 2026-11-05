import type { Treatment, TreatmentVersion } from './domain/entities';
import { selectPublishedTreatments } from './published-treatments';
import type { PublishedTreatmentDefect } from './published-treatments';
import type { Repository } from './repo/interfaces';

// 한 치료가 병원의 "현재 게시 목록"에 어떤 상태로 있는지 (M7 매핑 검토, design.md DD-19). 검토 대기열의 "현재 게시값" 칸과
// 매핑 승인 때의 확인(mapping-review.ts)이 모두 이 함수 하나만 쓴다: 화면이 보여 준 상태와 서버가 승인 때 본 상태가 갈라지지 않게 하기 위해서다.
// "현재 게시 치료"의 정의는 selectPublishedTreatments 하나이며 여기서 두 번째 정의를 만들지 않는다.
//
// 읽기만 한다(Pick 으로 읽기 메서드만 받는다). 서버 데이터 결함은 던지지 않고 UNREADABLE 로 알린다 — 읽지 못한 것을 "목록에 없음"으로
// 돌려주면 승인자가 "숨겼거나 내렸다"고 오해하므로 두 가지는 절대 섞지 않는다.

/**
 *  - PUBLISHED: 현재 카탈로그가 담은 활성 치료. 치료·그 버전·카탈로그 버전 id.
 *  - HIDDEN: 그 병원의 치료이고 active=false (숨김).
 *  - NOT_IN_CATALOG: 병원에 현재 카탈로그가 없거나, 치료가 거기에 없거나, 모르는 치료이거나, 다른 병원의 치료이다
 *    (다른 병원 자료의 존재를 드러내지 않도록 모두 같은 답이다).
 *  - UNREADABLE: 현재 카탈로그의 참조가 저장소와 맞지 않아(서버 데이터 결함) 게시 집합을 읽을 수 없다. code 는 PublishedTreatmentDefect 의 코드다.
 */
export type CurrentPublishedState =
  | { kind: 'PUBLISHED'; treatment: Treatment; version: TreatmentVersion; catalogVersionId: string }
  | { kind: 'HIDDEN' }
  | { kind: 'NOT_IN_CATALOG' }
  | { kind: 'UNREADABLE'; code: PublishedTreatmentDefect['code'] };

type StateReads = Pick<Repository, 'getClinicCurrentCatalogVersion' | 'getTreatmentVersion' | 'getTreatment'>;

/** selectPublishedTreatments 의 fail 콜백(돌아오지 않는다)이 던지는 이 파일 안의 표지. 밖으로 새지 않고 아래에서 잡는다. */
class CatalogDefectSignal extends Error {
  constructor(readonly code: PublishedTreatmentDefect['code']) {
    super(`현재 카탈로그의 참조가 저장소와 맞지 않는다 (${code})`);
  }
}

// @MX:ANCHOR: [AUTO] 현재 게시 상태 읽기의 단일 구현. 검토 대기열 보기와 이력 보기, 매핑 초안 작성·승인 확인이 부른다.
// @MX:REASON: 화면에 보인 "현재 게시값/숨김/목록에 없음/읽지 못함"과 승인 때 서버가 거절하는 사유가 한 곳에서 나와야 한다. 둘이 갈라지면 승인자가 본 것과 다른 근거로 승인이 거절되거나 통과한다.
/**
 * 병원 clinicId 의 현재 카탈로그에서 치료 treatmentId 의 상태를 읽는다. 던지지 않는다(저장소 자체의 오류는 제외).
 * 카탈로그 항목 중 하나라도 결함이 있으면 그 항목이 이 치료의 것이 아니어도 UNREADABLE 이다: 게시 집합 전체를 믿을 수 없으므로
 * 어느 치료에 대해서도 "있다/없다"를 단정하지 않는다.
 */
export function readCurrentPublishedState(repo: StateReads, clinicId: string, treatmentId: string): CurrentPublishedState {
  const catalog = repo.getClinicCurrentCatalogVersion(clinicId);
  if (catalog === null) {
    return { kind: 'NOT_IN_CATALOG' };
  }
  let published;
  try {
    published = selectPublishedTreatments(repo, clinicId, catalog, (defect) => {
      throw new CatalogDefectSignal(defect.code);
    });
  } catch (error) {
    if (error instanceof CatalogDefectSignal) {
      return { kind: 'UNREADABLE', code: error.code };
    }
    throw error;
  }
  const found = published.find(({ treatment }) => treatment.id === treatmentId);
  if (found !== undefined) {
    return { kind: 'PUBLISHED', treatment: found.treatment, version: found.version, catalogVersionId: catalog.id };
  }
  const treatment = repo.getTreatment(treatmentId);
  if (treatment !== null && treatment.clinicId === clinicId && !treatment.active) {
    return { kind: 'HIDDEN' };
  }
  return { kind: 'NOT_IN_CATALOG' };
}
