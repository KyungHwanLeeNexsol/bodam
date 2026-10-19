import { describe, expect, it } from 'vitest';
import { toEngineBaseFeeLine, toEnginePublishedLine } from '../../src/server/domain/projection';
import { loadReadinessSnapshot, readReadiness } from '../../src/server/readiness';
import type { ReadinessReads } from '../../src/server/readiness';
import { makeTreatment } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { TEST_CTX } from '../fixtures/server/readiness.fixture';
import { snapshotOf as repoSnapshotOf } from '../fixtures/server/repo.fixture';
import { TEST_FIXTURE_CLINIC_ID, catalogWorld, publishCatalogOf } from '../fixtures/server/versioning.fixture';

// 준비 상태 스냅샷의 게시 줄은 공개 카탈로그·계산 요청과 같은 "현재 게시된 치료"(활성 치료)로 만든다 (공유 기준: src/server/published-treatments.ts).
// 비활성 치료의 줄은 스냅샷에 없고 공통 기본비용 줄은 그대로다. 저장소 결함은 준비 상태 쪽의 기존 방식(DomainError)으로 거절한다.

const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';

/** 병원 1 에 치료 둘(활성)과 공통 기본비용 둘을 담은 카탈로그를 게시한 세계 (규칙 묶음은 없다). */
function publishedWorld() {
  const world = catalogWorld();
  const catalog = publishCatalogOf(world, validCatalogRequest(), TEST_CATALOG_CONFIG);
  return { world, catalog };
}

const setActive = (world: ReturnType<typeof catalogWorld>, id: string, active: boolean): void => {
  world.repo.saveTreatment({ ...world.repo.getTreatment(id)!, active });
};

/** 이 스냅샷 읽기가 쓰는 읽기 메서드 이름. 이 밖의 속성에 닿으면 던진다 (쓰기 메서드 포함). */
const READ_METHODS = ['listClinics', 'getClinicRuleScope', 'getClinicCurrentCatalogVersion', 'getTreatmentVersion', 'getTreatment', 'getCommonBaseFee', 'listRuleBundleVersions', 'getBundleStatus', 'getItemVersion', 'readItemStates'] as const;

function readOnlyView<T extends object>(repo: T): { view: ReadinessReads; touched: Set<string> } {
  const touched = new Set<string>();
  const view = new Proxy(repo, {
    get(target, prop) {
      if (typeof prop === 'string' && !(READ_METHODS as readonly string[]).includes(prop)) {
        throw new Error(`TEST_FIXTURE: 읽기 전용 대리 객체가 '${prop}' 접근을 거절했다`);
      }
      touched.add(String(prop));
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as ReadinessReads;
  return { view, touched };
}

/** 읽기 메서드 하나만 바꾼 저장소 (프로토타입 연결이라 나머지는 진짜 저장소다). */
const withOverride = <T extends object>(repo: T, overrides: Record<string, () => unknown>): T =>
  Object.create(repo, Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, { value: fn }]))) as T;

describe('loadReadinessSnapshot: 게시 줄은 활성 치료만, 공통 기본비용 줄은 그대로', () => {
  it('비활성 치료의 줄은 없고 공통 기본비용 줄 둘은 그대로 있다', () => {
    const { world, catalog } = publishedWorld();
    setActive(world, T2, false);
    const [clinic] = loadReadinessSnapshot(world.repo).clinics;
    expect(clinic!.lines.map((line) => line.treatmentId)).toEqual([T1]);
    expect(clinic!.baseFeeLines).toEqual(catalog.baseFeeIds.map((id) => toEngineBaseFeeLine(world.repo.getCommonBaseFee(id)!)));
    expect(clinic!.baseFeeLines).toHaveLength(2);
  });

  it('모든 치료가 비활성이면 치료 줄은 비고 공통 기본비용 줄은 그대로다', () => {
    const { world } = publishedWorld();
    setActive(world, T1, false);
    setActive(world, T2, false);
    const [clinic] = loadReadinessSnapshot(world.repo).clinics;
    expect(clinic!.lines).toEqual([]);
    expect(clinic!.baseFeeLines).toHaveLength(2);
  });

  it('다시 활성으로 하면 줄이 돌아온다 (카탈로그 버전의 순서대로, 줄 내용은 치료 버전의 변환 그대로)', () => {
    const { world, catalog } = publishedWorld();
    setActive(world, T2, false);
    setActive(world, T2, true);
    const [clinic] = loadReadinessSnapshot(world.repo).clinics;
    expect(clinic!.lines).toEqual(catalog.treatmentVersionIds.map((id) => toEnginePublishedLine(world.repo.getTreatmentVersion(id)!)));
  });

  it('카탈로그를 게시한 적 없는 병원은 줄이 없다', () => {
    const world = catalogWorld();
    const [clinic] = loadReadinessSnapshot(world.repo).clinics;
    expect(clinic!.lines).toEqual([]);
    expect(clinic!.baseFeeLines).toEqual([]);
  });

  it('표 M 에도 비활성 치료의 줄이 없다 (보고까지 이어진다)', () => {
    const { world } = publishedWorld();
    setActive(world, T2, false);
    const report = readReadiness(world.repo, TEST_CTX).clinics[0]!;
    expect([...new Set(report.mappings.map((row) => row.treatmentId))].sort()).toEqual([T1, 'TEST_FIXTURE_FEE_1', 'TEST_FIXTURE_FEE_2'].sort());
  });

  it('스냅샷은 여전히 저장소와 분리된 복사본이다', () => {
    const { world } = publishedWorld();
    setActive(world, T2, false);
    const snapshot = loadReadinessSnapshot(world.repo);
    snapshot.clinics[0]!.lines.length = 0;
    snapshot.clinics[0]!.baseFeeLines.length = 0;
    const again = loadReadinessSnapshot(world.repo).clinics[0]!;
    expect(again.lines.map((line) => line.treatmentId)).toEqual([T1]);
    expect(again.baseFeeLines).toHaveLength(2);
  });

  it('읽기 전용이다: 읽기 메서드만 열린 대리 객체로도 같은 스냅샷이 나오고(getTreatment 포함 열 개), 호출 전후로 저장소 전체가 같다', () => {
    const { world } = publishedWorld();
    setActive(world, T2, false);
    const before = repoSnapshotOf(world.repo);
    const { view, touched } = readOnlyView(world.repo);
    expect(loadReadinessSnapshot(view)).toEqual(loadReadinessSnapshot(world.repo));
    expect(repoSnapshotOf(world.repo)).toEqual(before);
    expect(touched.has('getTreatment')).toBe(true);
    expect(() => (view as unknown as { saveTreatment: unknown }).saveTreatment).toThrow(/saveTreatment/);
  });
});

describe('저장소가 깨져 있으면 준비 상태 쪽 방식(DomainError)으로 거절한다', () => {
  it('치료 버전이 없다 -> NOT_FOUND', () => {
    const { world } = publishedWorld();
    const error = catchDomainError(() => loadReadinessSnapshot(withOverride(world.repo, { getTreatmentVersion: () => null })));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain('치료 버전');
  });

  it('치료 버전이 가리키는 치료가 없다 -> NOT_FOUND', () => {
    const { world } = publishedWorld();
    const error = catchDomainError(() => loadReadinessSnapshot(withOverride(world.repo, { getTreatment: () => null })));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain(T1);
  });

  it('카탈로그가 담은 치료가 다른 병원의 것이다 -> REF_CONTENT_MISMATCH (게시 줄이 되지도, 조용히 빠지지도 않는다)', () => {
    const { world } = publishedWorld();
    const foreign = makeTreatment({ id: T1, clinicId: 'TEST_FIXTURE_CLINIC_OTHER' });
    const error = catchDomainError(() => loadReadinessSnapshot(withOverride(world.repo, { getTreatment: () => foreign })));
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expect(error.message).toContain(T1);
    expect(error.message).toContain(TEST_FIXTURE_CLINIC_ID);
  });

  it('비활성이어도 깨진 참조는 거절한다 (활성 검사보다 앞선다: 공개 카탈로그와 같은 순서)', () => {
    const { world } = publishedWorld();
    const inactiveForeign = makeTreatment({ id: T1, clinicId: 'TEST_FIXTURE_CLINIC_OTHER', active: false });
    expect(catchDomainError(() => loadReadinessSnapshot(withOverride(world.repo, { getTreatment: () => inactiveForeign }))).code).toBe('REF_CONTENT_MISMATCH');
  });
});
