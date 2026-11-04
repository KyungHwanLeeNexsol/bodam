import { CLINIC_1_SLUG, CLINIC_2_SLUG, createTestServices, publishSecondClinicCatalog } from '../../fixtures/server/api-composition.fixture';
import { makeTreatment } from '../../fixtures/server/entities.fixture';
import { buildWorld } from '../../fixtures/server/estimate-world.fixture';
import { validCatalogRequest } from '../../fixtures/server/publish.fixture';
import type { AdminServices } from '../../../src/server/admin/services';
import { createAdminServices } from '../../../src/server/admin/services';
import type { ApiServices } from '../../../src/server/api/services';
import { TestAdminAuthenticator } from '../../fixtures/server/admin.fixture';

// 시험 자료(TEST_FIXTURE). 브라우저 시험의 "실제 핸들러" 층이 쓰는 세계: 서비스 경로로 게시한 두 병원이다. 운영 자료가 아니다. src/ 는 이 파일을 가져오지 않는다(tests/boundary/production-no-fixtures.test.ts).
//  - 병원 1: 계산 요청 통합 시험(tests/api)과 같은 세계다. 치료 둘(급여 10,000 · 비급여 10,000)과 공통 기본비용(급여 5,000)을 게시하고, 4세대(C4) · 손해보험사 칸의 표준 가정과
//    세 항목 모두 보장 대상인 매핑·서류 규칙을 담은 규칙 묶음을 게시해 범위를 지정했다 → 4세대 · 손해보험사로 계산하면 정상(ESTIMATED, 병원 결제액 25,000 / 보험금 24,000 / 수령 후 1,000)이다.
//    다른 세대·형태 칸은 프로필이 없어 보류(ON_HOLD)로 나온다.
//    눈으로 구분할 수 있도록 두 치료의 이름과 표시 순서를 다르게 한다: 1번 "시험 치료 A (급여)", 2번 "시험 치료 B (비급여)" (표시 순서 1, 2). 이름은 이 하네스에서만 바꾸고 공유 시험 자료(tests/fixtures)는 그대로다.
//  - 병원 2: 카탈로그만 게시했고 규칙 사용 범위가 없다 → 어떤 선택이든 보류(ON_HOLD, 범위 없음)로 나온다.
// 실제 핸들러가 내는 정상·보류 응답을 브라우저로 보는 데 쓴다. 보장 제외(ESTIMATED_WITH_EXCLUSIONS)는 이 세계에 없고, 실제 핸들러의 응답으로 그리는 시험은 단위 층(tests/kiosk/view)에 있다.

export const HARNESS_CLINIC_SLUG = CLINIC_1_SLUG;
export const HARNESS_HOLD_CLINIC_SLUG = CLINIC_2_SLUG;

/** 병원 1 의 두 치료의 하네스 전용 이름. 둘 다 시험 자료임이 이름에서 드러난다. */
export const HARNESS_TREATMENT_NAMES = { first: 'TEST_FIXTURE 시험 치료 A (급여)', second: 'TEST_FIXTURE 시험 치료 B (비급여)' } as const;

export interface Harness {
  /** 공개 API(키오스크)가 쓰는 서비스. */
  services: ApiServices;
  /** 관리자 API 가 쓰는 서비스. 저장소는 위 서비스와 같은 것이다: 관리자가 게시한 가격이 키오스크에 바로 보인다(M7 첫 기능). */
  admin: AdminServices;
  /** 시험 로그인이 세션을 만드는 시험 인증기(tests/ 에만 있다). 운영 구성에는 없다. */
  authenticator: TestAdminAuthenticator;
}

/** 두 병원의 세계 하나와 그 위의 공개 서비스·관리자 서비스. 같은 저장소·시계·식별자 생성기를 쓴다. */
export function buildHarness(): Harness {
  const [first, second] = validCatalogRequest().treatmentVersions;
  const { world } = buildWorld({
    treatments: [
      { ...first!, displayName: HARNESS_TREATMENT_NAMES.first },
      { ...second!, displayName: HARNESS_TREATMENT_NAMES.second },
    ],
  });
  // 표시 순서를 1, 2 로 분명히 한다(공유 시험 자료는 둘 다 1 이라 id 순으로 갈린다).
  world.repo.saveTreatment(makeTreatment({ id: first!.treatmentId, sortOrder: 1 }));
  world.repo.saveTreatment(makeTreatment({ id: second!.treatmentId, sortOrder: 2 }));
  publishSecondClinicCatalog(world);
  const services = createTestServices({ repo: world.repo });
  const authenticator = new TestAdminAuthenticator();
  const admin = createAdminServices({ api: services, clock: world.clock, ids: world.ids, authenticator, newTreatmentOrigin: 'TEST_FIXTURE' });
  return { services, admin, authenticator };
}

export function buildHarnessServices(): ApiServices {
  return buildHarness().services;
}
