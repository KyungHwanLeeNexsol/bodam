import type { ServiceDeps } from '../../../src/server/deps';
import type { CatalogVersion } from '../../../src/server/domain/entities';
import { publishCatalog } from '../../../src/server/catalog-publish';
import type { MemoryRepository } from '../../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1 } from './actors.fixture';
import { makeTreatment, makeTreatmentVersion } from './entities.fixture';
import type { World } from './lifecycle.fixture';
import { TEST_CATALOG_CONFIG } from './publish.fixture';

// 시험 자료(TEST_FIXTURE). 카탈로그 초안의 구조 편집(새 치료·숨김·표시 순서) 시험이 쓰는 도우미. 모든 값은 시험용 가짜 값이다.

export const T3 = 'TEST_FIXTURE_TREATMENT_3';

/**
 * 병원 1 의 카탈로그를 치료 셋(T1·T2·T3)으로 다시 게시한다. T1·T2 의 sortOrder 는 둘 다 1(같으면 id 순)이고 T3 는 3, T3 의 가격은 11,000원이다.
 * 표시 순서는 T1, T2, T3 다. T3 에는 승인된 매핑이 없다. 새 카탈로그를 돌려준다. displayName 을 생략하면 'TEST_FIXTURE 치료 3' 이다(브라우저 시험의 묶음 시연 세계가 눈에 띄는 이름을 넘긴다).
 */
export function addThirdTreatment(world: World, displayName: string = 'TEST_FIXTURE 치료 3'): CatalogVersion {
  world.repo.saveTreatment(makeTreatment({ id: T3, sortOrder: 3 }));
  const current = world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
  const versions = current.treatmentVersionIds.map((id) => world.repo.getTreatmentVersion(id)!);
  return publishCatalog(
    world.deps,
    TEST_FIXTURE_HA_1,
    TEST_FIXTURE_CLINIC_ID,
    {
      treatmentVersions: [...versions, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3', treatmentId: T3, displayName, patientAmount: 11_000 })],
      commonBaseFees: current.baseFeeIds.map((id) => world.repo.getCommonBaseFee(id)!),
    },
    TEST_CATALOG_CONFIG,
  );
}

/** 올바른 새 치료 요청 한 건(요청 본문의 additions 원소). overrides 로 필드를 바꾸거나 키를 더한다(undefined 면 키를 뺀다). */
export function additionBody(draftKey: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    draftKey,
    displayName: `TEST_FIXTURE 새 치료 ${draftKey}`,
    description: 'TEST_FIXTURE 새 치료 설명',
    benefitType: 'BENEFIT',
    patientAmount: 7_000,
    treatmentCode: `TEST_FIXTURE_NEW_TC_${draftKey}`,
    procedureCodes: ['TEST_FIXTURE_NEW_PROC_A'],
    documentFlags: { imaging: false, biopsy: true, opinionRequired: false },
    amountCondition: { patientType: 'TEST_FIXTURE_PATIENT', assumption: 'TEST_FIXTURE_ASSUMPTION', referenceDate: '2026-11-01' },
    effectiveDate: '2026-11-01',
    ...overrides,
  };
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) delete body[key];
  }
  return body;
}

/** 두 저장소 덤프에서 내용이 달라진 최상위 키(코드 포인트 순). */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/**
 * 저장소 호출을 감싸는 대역. 이름이 method 인 메서드를 afterCalls 번 정상 호출한 다음부터는 던진다(실패 주입). 그 밖의 메서드는 그대로 위임한다.
 * transaction 도 위임하므로 감싼 저장소로 서비스를 돌리면 서비스의 모든 호출이 이 대역을 지난다. calls 로 호출 인자를 본다.
 */
export function repoThrowingOn(repo: MemoryRepository, method: string, afterCalls = 0): { repo: MemoryRepository; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const proxy = new Proxy(repo, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') {
        return value;
      }
      if (property === method) {
        return (...args: unknown[]) => {
          calls.push(args);
          if (calls.length > afterCalls) {
            throw new Error(`INJECTED_FAILURE:${method}`);
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
  return { repo: proxy, calls };
}

/** 쓰기 호출만 기록하는 대역(던지지 않는다). */
export function repoRecording(repo: MemoryRepository, method: string): { repo: MemoryRepository; calls: unknown[][] } {
  return repoThrowingOn(repo, method, Number.POSITIVE_INFINITY);
}

/** 세계의 서비스 의존성에서 저장소만 바꾼 것. */
export function depsOver(world: World, repo: MemoryRepository): ServiceDeps {
  return { ...world.deps, repo };
}
