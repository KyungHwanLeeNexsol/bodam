import type { BundleAvailability } from '../domain/entities';
import type { Repository } from '../repo/interfaces';
import { readClinicRuleBundle } from '../rule-scope';
import { ServerIntegrityError } from './integrity';

// 병원이 지금 쓰는 규칙 묶음의 참조 (SPEC-REIMBURSEMENT-001 M4.A·M4.B, design.md DD-14 "규칙 묶음 가용성과 중지").
// options 응답(M4.A)과 계산 요청의 버전 비교·계산(M4.B)이 같은 읽기를 쓴다: 규칙 범위 읽기 1회와 (범위가 있으면) 가용성 읽기 1회. 항목은 읽지 않는다.

/** 범위가 없으면 둘 다 null, 있으면 묶음 id 와 그 묶음의 가용성이다. */
export type BundleRef = { ruleBundleVersionId: null; ruleBundleStatus: null } | { ruleBundleVersionId: string; ruleBundleStatus: BundleAvailability };

// @MX:NOTE: [AUTO] [문서에 없음] 범위가 묶음을 가리키는데 그 묶음의 가용성 기록이 하나도 없으면(게시는 첫 ACTIVE 기록을 같은 트랜잭션에 쓰므로 정상 경로에서는 없는 상태)
// status 를 null 로 흘리지 않고 서버 데이터 무결성 결함(500)으로 낸다. null 은 "범위 없음" 의 뜻으로만 쓴다.
/** 병원의 현재 범위가 가리키는 묶음과 그 가용성을 읽는다. 호출마다 새로 읽고 저장소를 바꾸지 않는다. */
export function readBundleRef(repo: Pick<Repository, 'getClinicRuleScope' | 'getBundleStatus'>, clinicId: string): BundleRef {
  const { ruleBundleVersionId, ruleBundleStatus } = readClinicRuleBundle(repo, clinicId);
  if (ruleBundleVersionId === null) {
    return { ruleBundleVersionId: null, ruleBundleStatus: null };
  }
  if (ruleBundleStatus === null) {
    throw new ServerIntegrityError('BUNDLE_AVAILABILITY_MISSING');
  }
  return { ruleBundleVersionId, ruleBundleStatus };
}
