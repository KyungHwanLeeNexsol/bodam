import type { AdminServices } from '../server/admin/services';
import { createOperatingAdminServices } from '../server/composition';
import { systemClock, systemIds } from './clock';
import { getApiServices } from './services';

// 운영 관리자 연결 (SPEC-REIMBURSEMENT-001 M7). 관리자 API route 가 서비스를 얻는 유일한 길이다.
//  - 저장소는 공개 API 와 같은 것이다(getApiServices 의 저장소): 같은 병원의 관리자 화면과 키오스크가 같은 저장소를 본다.
//  - 인증 공급자가 연결되지 않아(plan.md §E #2) 운영 구성의 인증기는 어떤 요청도 인증하지 않는다 → 운영에서 모든 관리자 API 는 401 이고 관리자 기능을 쓸 수 없다.
//  - 이 모듈에는 인증기를 바꾸는 setter·환경 변수 훅·헤더로 역할을 정하는 길이 없다. 시험은 이 모듈이 아니라 시험 앞단(tests/e2e/harness)의 구성을 쓴다.
//  - 모듈 수준 상태가 없다: 호출마다 가벼운 묶음을 만들며, 공유하는 상태(저장소)는 getApiServices 가 가진다.

/** 운영 관리자 서비스. 부를 때마다 새로 만들지만 저장소·로그는 공개 API 와 같다. */
export function getAdminServices(): AdminServices {
  return createOperatingAdminServices({ api: getApiServices(), clock: systemClock, ids: systemIds });
}
