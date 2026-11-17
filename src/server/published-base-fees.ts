import type { CatalogVersion, CommonBaseFee } from './domain/entities';
import type { Repository } from './repo/interfaces';

// 현재 게시된 공통 기본비용의 확인 기준 (SPEC-REIMBURSEMENT-001 M4, design.md DD-03·DD-23 규칙 0).
// 공개 카탈로그(M4.A)와 계산 요청(M4.B)과 운영 준비 상태의 기본비용 줄(M3.E)이 같은 기준을 쓰도록 이 파일 한 곳에 둔다:
// "카탈로그가 담은 기본비용이 쓸 수 있는 것" 의 정의가 둘이면 계산이 막히는 자료로 준비 상태가 READY 로 나오는 어긋남이 생긴다(치료의 published-treatments.ts 와 같은 이유).
// 이 파일은 도메인 엔티티와 저장소 인터페이스의 형식만 가져온다(src/server/api 를 가져오지 않는다): 호출한 층마다 결함의 오류 종류가 다르므로
// 결함은 호출한 쪽이 주입하는 실패 함수로 알린다(공개 경로는 ServerIntegrityError, 준비 상태는 DomainError).

/**
 * 카탈로그가 담은 기본비용 참조가 저장소와 맞지 않는 결함(서버 데이터 무결성 결함). code 는 공개 경로의 ServerIntegrityCode 와 같은 이름이다.
 *  - BASE_FEE_MISSING: 카탈로그가 담은 기본비용 버전이 저장소에 없다 (baseFeeVersionId 는 카탈로그에 적힌 버전 id 다).
 *  - BASE_FEE_CLINIC_MISMATCH: 카탈로그가 담은 기본비용이 다른 병원의 것이다 (clinicId 는 기대한 병원이다).
 */
export type PublishedBaseFeeDefect =
  | { code: 'BASE_FEE_MISSING'; baseFeeVersionId: string }
  | { code: 'BASE_FEE_CLINIC_MISMATCH'; baseFeeId: string; clinicId: string };

type PublishedBaseFeeReads = Pick<Repository, 'getCommonBaseFee'>;

// @MX:NOTE: [AUTO] 공통 기본비용은 등록된 것이 전부 자동 포함된다(활성 여부를 따로 두지 않는다, published-treatments.ts 의 비활성 치료 기준과 별개). 확인하는 것은 존재와 소유 병원 둘뿐이고
// 둘 중 하나라도 어긋나면 그 기본비용으로 줄을 만들 수 없다: 공개 경로는 500 으로, 준비 상태는 보고를 만들지 않고 거절한다(다른 병원의 금액이 이 병원 보고에 섞이지 않게).
/**
 * 병원의 현재 카탈로그가 담은 공통 기본비용을 카탈로그에 적힌 순서대로 하나씩 읽어 존재와 소유 병원을 확인하고, 확인된 기본비용을 모두 돌려준다.
 * 어긋난 참조는 처음 걸린 하나를 fail 로 알린다 (fail 은 돌아오지 않는다): 존재 → 소유 병원 순이고, 그 뒤 항목은 읽지 않는다.
 * 정렬하지 않는다(표시 순서인 baseFeeId 순은 호출한 층의 몫이다). 읽기만 하며 저장소를 바꾸지 않는다.
 */
export function selectPublishedBaseFees(
  repo: PublishedBaseFeeReads,
  clinicId: string,
  catalog: CatalogVersion,
  fail: (defect: PublishedBaseFeeDefect) => never,
): CommonBaseFee[] {
  const published: CommonBaseFee[] = [];
  for (const baseFeeVersionId of catalog.baseFeeIds) {
    const fee = repo.getCommonBaseFee(baseFeeVersionId);
    if (fee === null) {
      return fail({ code: 'BASE_FEE_MISSING', baseFeeVersionId });
    }
    if (fee.clinicId !== clinicId) {
      return fail({ code: 'BASE_FEE_CLINIC_MISMATCH', baseFeeId: fee.baseFeeId, clinicId });
    }
    published.push(fee);
  }
  return published;
}
