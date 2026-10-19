import type { BundleAvailability } from '../domain/entities';
import { readClinicRuleBundle } from '../rule-scope';
import type { Repository } from '../repo/interfaces';
import { handleClinicRead } from './clinic';
import { ServerIntegrityError } from './integrity';
import { optionCards } from './options-cards';
import type { OptionCards } from './options-cards';
import type { ApiServices } from './services';

// GET /api/clinics/{slug}/insurance/options (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-05·DD-14·DD-19, AC-018b·AC-011g).
// 읽는 것은 병원의 규칙 사용 범위와 그 묶음의 현재 가용성뿐이다. 항목(프로필·매핑·서류 규칙)의 내용·상태·묶음 내용은 읽지 않고, 응답에도
// 항목에서 나온 값이 없다 [문서에 없음: 승인된 프로필이 없다는 이유로 카드를 숨기지 않는다는 DD-05 와 같은 뜻]. 가용성은 요청마다 새로 읽는다(DD-14).
// 묶음이 중지(SUSPENDED)돼도 규칙 사용 범위는 바뀌지 않고, 카드는 5 / 3 / 3 그대로이며, 중지는 ruleBundleStatus 로만 알린다.

export interface OptionsResponse extends OptionCards {
  /** 병원의 규칙 사용 범위가 가리키는 묶음 id(묶음이 중지된 동안에도 같다). 범위가 없으면 null. */
  ruleBundleVersion: string | null;
  /** 그 묶음의 가용성. 범위가 없으면 null. */
  ruleBundleStatus: BundleAvailability | null;
}

// @MX:NOTE: [AUTO] [문서에 없음] 범위가 묶음을 가리키는데 그 묶음의 가용성 기록이 하나도 없으면(게시는 첫 ACTIVE 기록을 같은 트랜잭션에 쓰므로 정상 경로에서는 없는 상태)
// status 를 null 로 흘리지 않고 서버 데이터 무결성 결함(500)으로 낸다. null 은 "범위 없음" 의 뜻으로만 쓴다.
/** options 응답 본문을 만든다. 규칙 범위 읽기 1회와 (범위가 있으면) 가용성 읽기 1회만 하고 저장소를 바꾸지 않는다. */
export function buildOptionsResponse(repo: Pick<Repository, 'getClinicRuleScope' | 'getBundleStatus'>, clinicId: string): OptionsResponse {
  const { ruleBundleVersionId, ruleBundleStatus } = readClinicRuleBundle(repo, clinicId);
  if (ruleBundleVersionId !== null && ruleBundleStatus === null) {
    throw new ServerIntegrityError('BUNDLE_AVAILABILITY_MISSING');
  }
  return { ruleBundleVersion: ruleBundleVersionId, ruleBundleStatus, ...optionCards() };
}

/** route.ts 의 GET 이 부르는 핸들러. */
export function handleOptions(services: ApiServices, slug: string): Promise<Response> {
  return handleClinicRead(services, slug, (clinic) => buildOptionsResponse(services.repo, clinic.id));
}
