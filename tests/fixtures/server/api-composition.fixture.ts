import { assignRuleScope } from '../../../src/server/rule-scope';
import { suspendRuleBundle } from '../../../src/server/bundle-status';
import type { ApiServices, AcceptedOrigins } from '../../../src/server/api/services';
import type { ServerLog, ServerLogEntry } from '../../../src/server/api/log';
import type { CatalogVersion, RuleBundleVersion } from '../../../src/server/domain/entities';
import type { Repository } from '../../../src/server/repo/interfaces';
import { publishCatalog } from '../../../src/server/catalog-publish';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1 } from './actors.fixture';
import { makeCommonBaseFee, makeTreatmentVersion } from './entities.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from './governance.fixture';
import type { World } from './lifecycle.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from './publish.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID, addOtherClinic, approveSpec, catalogWorld, publishCatalogOf, publishRefs, validSpec } from './versioning.fixture';

// 시험 자료(TEST_FIXTURE). API 통합 시험(M4)이 쓰는 시험 구성(TEST composition)과 세계 만들기 도우미다.
// 운영 구성(src/server/composition.ts)은 OPERATING 출처만 받지만, 시험 구성은 시험 자료의 출처(TEST_FIXTURE·DEMO)도 받는다.
// 이 파일은 tests/ 아래에만 있고 운영 진입점(src/server/composition.ts, src/app/**)은 이 파일을 가져오지 않는다(AC-010b, 경계 시험이 지킨다).
// 실제 route.ts 의 GET·POST 가 서비스를 얻는 길은 src/app/services.ts 의 getApiServices() 하나이고, 시험은 그 모듈을 vi.mock 으로 바꿔
// useTestServices 로 정한 시험 구성을 돌려준다. 운영 코드에는 덮어쓰는 훅이 없다.

/** 시험 구성의 허용 출처: 시험 자료(TEST_FIXTURE)와 DEMO 도 받는다. 운영 구성은 OPERATING 하나뿐이다. */
export const TEST_ACCEPTED_ORIGINS: AcceptedOrigins = { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] };

/** 로그 항목을 모으는 수집기. 사본을 저장해 나중에 항목을 고쳐도 기록이 바뀌지 않는다. */
export class CollectingLog implements ServerLog {
  readonly entries: ServerLogEntry[] = [];

  record(entry: ServerLogEntry): void {
    this.entries.push({ ...entry });
  }
}

/** 시험 구성의 판정 기준일. 시험 항목의 유효 기간(2026-01-01 ~ 2026-12-31) 안이다. 시스템 시계를 읽지 않는 고정 값이다. */
export const TEST_TODAY = '2026-10-15';

export interface TestServicesOptions {
  repo: Repository;
  log?: ServerLog;
  acceptedOrigins?: AcceptedOrigins;
  /** 판정 기준일(YYYY-MM-DD). 없으면 TEST_TODAY. */
  today?: () => string;
}

/** 시험 구성. 운영 구성과 같은 ApiServices 모양이고 허용 출처와 판정 기준일만 시험 값이다. */
export function createTestServices(options: TestServicesOptions): ApiServices {
  return {
    repo: options.repo,
    log: options.log ?? new CollectingLog(),
    acceptedOrigins: options.acceptedOrigins ?? TEST_ACCEPTED_ORIGINS,
    today: options.today ?? (() => TEST_TODAY),
  };
}

let active: ApiServices | null = null;

/** vi.mock 한 getApiServices 가 돌려줄 시험 구성을 정한다. null 이면 해제한다. */
export function useTestServices(services: ApiServices | null): void {
  active = services;
}

/** vi.mock 한 getApiServices 의 본문. 정하지 않았는데 불리면 시험 오류다. */
export function activeTestServices(): ApiServices {
  if (active === null) {
    throw new Error('TEST_FIXTURE: useTestServices 로 시험 구성을 정하지 않았다');
  }
  return active;
}

// ───────────────────────── 세계 만들기 ─────────────────────────
// 모두 실제 도메인 서비스 경로(게시 → 작성 → 제출 → 승인 → 묶음 게시 → 범위 지정)로 만든다. 저장소를 직접 쓰는 것은 병원·치료 시드뿐이다.

export const CLINIC_1_SLUG = 'test-fixture-clinic-1';
export const CLINIC_2_SLUG = 'test-fixture-clinic-2';

/** 병원 1 에 치료 둘(TREATMENT_1·2)과 공통 기본비용 둘을 담은 카탈로그를 게시한 세계. 규칙 묶음은 아직 없다. */
export function publishedCatalogWorld(): { world: World; catalog: CatalogVersion } {
  const world = catalogWorld();
  const catalog = publishCatalogOf(world, validCatalogRequest(), TEST_CATALOG_CONFIG);
  return { world, catalog };
}

/** 병원 2 와 그 병원의 치료 하나를 담은 카탈로그를 게시한다 (병원 1 의 자료와 겹치지 않는다). */
export function publishSecondClinicCatalog(world: World): CatalogVersion {
  addOtherClinic(world.repo);
  return publishCatalog(
    world.deps,
    TEST_FIXTURE_HA_1,
    OTHER_CLINIC_ID,
    {
      treatmentVersions: [makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_OTHER_1', treatmentId: OTHER_CLINIC_TREATMENT_ID, displayName: 'TEST_FIXTURE 병원2 치료', patientAmount: 33_000 })],
      commonBaseFees: [makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_OTHER_1', clinicId: OTHER_CLINIC_ID, displayName: 'TEST_FIXTURE 병원2 기본비용', amount: 3_300 })],
    },
    TEST_CATALOG_CONFIG,
  );
}

/** n 번째 올바른 묶음(프로필·매핑·서류 규칙)을 서비스 경로로 승인·게시하고 병원에 범위를 지정한다. 카탈로그가 먼저 게시돼 있어야 한다(매핑 승인이 지문을 고정). */
export function publishBundleAndAssign(world: World, n = 1, clinicId: string = TEST_FIXTURE_CLINIC_ID): RuleBundleVersion {
  const bundle = publishRefs(world, approveSpec(world, validSpec(n)));
  assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicId, bundle.id);
  return bundle;
}

/** 묶음을 중지한다 (RV). 규칙 사용 범위는 바뀌지 않는다. */
export function suspendBundle(world: World, bundleId: string): void {
  suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundleId, 'TEST_FIXTURE 중지 사유');
}
