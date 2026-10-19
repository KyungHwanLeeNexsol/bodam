import { silentLog } from '../server/api/log';
import type { ApiServices } from '../server/api/services';
import { createOperatingServices } from '../server/composition';
import { createMemoryRepository } from '../server/repo/memory/memory-repository';

// 운영 연결 (SPEC-REIMBURSEMENT-001 M4.A). 모든 route.ts 가 서비스를 얻는 유일한 길이다.
//  - 저장소는 비어 있는 메모리 구현이다. DB 제품은 정해지지 않았고(plan.md §E #1) 운영 데이터도 없으므로 어떤 slug 도 404 CLINIC_NOT_FOUND 다.
//    이것은 기대한 동작이며, 시험 자료로 채우거나 우회하지 않는다.
//  - 이 모듈에는 서비스를 바꾸는 setter 나 환경 변수 훅이 없다. 시험은 이 모듈을 vi.mock 으로 통째로 바꿔 시험 구성을 넣는다(tests/ 아래에서만).
//  - 이 파일과 이 파일이 가져오는 모든 모듈은 시험·시험 자료를 가져오지 않는다(tests/boundary/production-no-fixtures.test.ts).

let services: ApiServices | null = null;

// @MX:ANCHOR: [AUTO] 모든 route.ts 의 서비스 취득점. catalog·options·estimate(M4.B) 라우트가 부른다.
// @MX:REASON: 서비스를 얻는 길이 둘이면 시험 구성이 운영 경로로 들어오거나 운영 경로가 시험 구성을 건너뛴다. 이 한 함수를 vi.mock 하는 것만이 시험의 주입 지점이다.
/** 운영 서비스. 처음 부를 때 한 번 만들고 이후에는 같은 인스턴스를 돌려준다. */
export function getApiServices(): ApiServices {
  services ??= createOperatingServices({ repo: createMemoryRepository(), log: silentLog });
  return services;
}
