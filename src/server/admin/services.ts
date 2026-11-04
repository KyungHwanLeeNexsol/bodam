import type { ApiServices } from '../api/services';
import type { ServiceDeps } from '../deps';
import type { Clock, IdGenerator } from '../domain/ports';
import type { AdminAuthenticator } from './auth';

// 관리자 서비스 묶음 (SPEC-REIMBURSEMENT-001 M7). 공개 API 의 ApiServices 에 관리자만 더 필요한 것(시계·식별자 생성기·인증기)을 얹는다.
//  - 저장소·로그·허용 출처는 ApiServices 의 것을 그대로 쓴다: 같은 병원의 관리자 화면과 키오스크가 같은 저장소를 본다.
//  - 카탈로그 게시의 허용 출처(CatalogPublishConfig)는 ApiServices.acceptedOrigins.lines 에서 만든다: 운영 구성은 OPERATING 뿐이라 시험 자료 줄은 운영에서 게시되지 않는다(AC-010c).
//  - 시계와 식별자 생성기는 src/server 가 만들 수 없어서(tests/boundary/server-imports.test.ts) 바깥(src/app, 시험 구성)이 주입한다.
// 운영 구성은 src/server/composition.ts 의 createOperatingAdminServices 하나뿐이고 인증기가 UNCONNECTED 로 고정이다.

export interface AdminServices {
  readonly api: ApiServices;
  readonly deps: ServiceDeps;
  readonly authenticator: AdminAuthenticator;
}

export interface AdminServicesParts {
  api: ApiServices;
  clock: Clock;
  ids: IdGenerator;
  authenticator: AdminAuthenticator;
}

/** 관리자 서비스를 만든다. 운영 경로는 이 함수를 직접 부르지 않고 composition.ts 의 createOperatingAdminServices 를 부른다(인증기가 고정이다). */
export function createAdminServices(parts: AdminServicesParts): AdminServices {
  return Object.freeze({ api: parts.api, deps: { repo: parts.api.repo, clock: parts.clock, ids: parts.ids }, authenticator: parts.authenticator });
}
