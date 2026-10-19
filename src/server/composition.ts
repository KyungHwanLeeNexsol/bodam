import type { ServerLog } from './api/log';
import type { AcceptedOrigins, ApiServices } from './api/services';
import type { Repository } from './repo/interfaces';

// 운영 구성 (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-04·DD-19, AC-010b). 운영 서비스를 만드는 유일한 곳이다.
//  - 규칙 데이터와 줄의 허용 출처는 OPERATING 하나로 고정이다. 이 값을 매개변수로 받지 않고 덮어쓰는 훅도 없다: 시험 자료의 출처는 이 구성을 지나갈 수 없다.
//  - 시험 자료는 시험 구성(tests/ 아래)이 따로 만든 서비스로만 들어온다. 이 파일과 이 파일이 가져오는 모든 모듈은 시험·시험 자료 모듈을 가져오지 않는다
//    (tests/boundary/production-no-fixtures.test.ts 가 진입점에서 닿는 그래프 전체를 검사한다).
//  - 시계·난수·환경 같은 실행 환경 의존이 없다(tests/boundary/server-imports.test.ts 가 src/server 전체를 검사한다). 필요한 환경 의존(M4.B 의 시스템 날짜 등)은
//    src/app 의 연결 모듈이 만들어 주입한다.
//  - 운영 데이터는 아직 없다. 운영 저장소는 비어 있는 메모리 구현이므로 어떤 slug 도 404 CLINIC_NOT_FOUND 이고, 이것은 기대한 동작이다.

/** 운영 허용 출처: 규칙과 줄 모두 OPERATING 만. 얼려 있어 고칠 수 없다. */
export const OPERATING_ACCEPTED_ORIGINS: AcceptedOrigins = Object.freeze({
  rules: Object.freeze(['OPERATING'] as const),
  lines: Object.freeze(['OPERATING'] as const),
});

export interface OperatingDeps {
  repo: Repository;
  log: ServerLog;
}

// @MX:ANCHOR: [AUTO] 운영 서비스 구성의 단일 진입점. src/app/services.ts(모든 route.ts 가 거치는 연결)와 구성 시험이 부른다.
// @MX:REASON: 허용 출처가 이 한 곳에서만 정해져야 "운영 구성은 OPERATING 만 받는다"가 구성 하나를 보고 증명된다. 매개변수로 열면 시험 출처가 운영 경로로 샌다.
/** 운영 서비스를 만든다. 저장소와 로그 출구만 받고, 허용 출처는 OPERATING 으로 고정이다. */
export function createOperatingServices(deps: OperatingDeps): ApiServices {
  return Object.freeze({ repo: deps.repo, log: deps.log, acceptedOrigins: OPERATING_ACCEPTED_ORIGINS });
}
