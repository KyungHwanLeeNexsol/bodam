import { describe, expect, it } from 'vitest';
import { selectPublishedTreatments } from '../../src/server/published-treatments';
import type { PublishedTreatmentDefect } from '../../src/server/published-treatments';
import { makeCatalogVersion, makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { snapshotOf as repoSnapshotOf } from '../fixtures/server/repo.fixture';
import { TEST_FIXTURE_CLINIC_ID, catalogWorld, publishCatalogOf } from '../fixtures/server/versioning.fixture';

// 현재 게시된 치료의 단일 선택 기준 (src/server/published-treatments.ts): 카탈로그의 치료 버전 → 치료 → 병원 소유 확인 → 활성만, 카탈로그 순서.
// 결함 처리는 호출한 층이 주입한다(공개 API 는 ServerIntegrityError, 준비 상태는 DomainError). 이 시험은 주입된 실패 함수가 받은 결함을 그대로 본다.

const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';

/** 던진 결함을 그대로 꺼내 보기 위한 주입용 실패 함수. */
class Defective extends Error {
  constructor(readonly defect: PublishedTreatmentDefect) {
    super(defect.code);
  }
}
const fail = (defect: PublishedTreatmentDefect): never => {
  throw new Defective(defect);
};

function defectOf(action: () => unknown): PublishedTreatmentDefect {
  try {
    action();
  } catch (error) {
    if (error instanceof Defective) return error.defect;
    throw error;
  }
  throw new Error('TEST_FIXTURE: 결함이 던져져야 하는데 아무것도 던져지지 않았다');
}

function publishedWorld() {
  const world = catalogWorld();
  const catalog = publishCatalogOf(world, validCatalogRequest(), TEST_CATALOG_CONFIG);
  return { world, catalog };
}

const setActive = (world: ReturnType<typeof catalogWorld>, id: string, active: boolean): void => {
  world.repo.saveTreatment({ ...world.repo.getTreatment(id)!, active });
};

/** 읽기 메서드 하나만 바꾼 저장소 (프로토타입 연결이라 나머지는 진짜 저장소다). */
const withOverride = <T extends object>(repo: T, overrides: Record<string, () => unknown>): T =>
  Object.create(repo, Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, { value: fn }]))) as T;

const idsOf =(selected: ReturnType<typeof selectPublishedTreatments>): string[] => selected.map(({ treatment }) => treatment.id);

describe('selectPublishedTreatments: 활성 치료만 카탈로그 순서로', () => {
  it('모두 활성이면 카탈로그가 담은 순서대로 (치료, 치료 버전) 짝을 돌려준다', () => {
    const { world, catalog } = publishedWorld();
    const selected = selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, catalog, fail);
    expect(selected.map(({ version }) => version.id)).toEqual(catalog.treatmentVersionIds);
    expect(selected).toEqual(catalog.treatmentVersionIds.map((id) => ({ treatment: world.repo.getTreatment(world.repo.getTreatmentVersion(id)!.treatmentId), version: world.repo.getTreatmentVersion(id) })));
  });

  it('비활성 치료는 고르지 않는다 (나머지의 상대 순서는 그대로)', () => {
    const { world, catalog } = publishedWorld();
    setActive(world, T1, false);
    expect(idsOf(selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual([T2]);
    setActive(world, T1, true);
    setActive(world, T2, false);
    expect(idsOf(selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual([T1]);
  });

  it('모두 비활성이면 빈 목록이다 (실패 함수는 불리지 않는다)', () => {
    const { world, catalog } = publishedWorld();
    setActive(world, T1, false);
    setActive(world, T2, false);
    expect(selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, catalog, fail)).toEqual([]);
  });

  it('다시 활성으로 하면 다시 고른다 (치료 쪽 가변 기록의 active 만 본다)', () => {
    const { world, catalog } = publishedWorld();
    setActive(world, T2, false);
    setActive(world, T2, true);
    expect(idsOf(selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual([T1, T2]);
  });

  it('카탈로그가 치료 버전을 담지 않았으면 빈 목록이다', () => {
    const { world } = publishedWorld();
    expect(selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, makeCatalogVersion({ treatmentVersionIds: [] }), fail)).toEqual([]);
  });

  it('정렬하지 않는다: 카탈로그에 적힌 순서가 그대로다 (표시 순서는 호출한 층의 몫)', () => {
    const { world, catalog } = publishedWorld();
    const reversed = makeCatalogVersion({ ...catalog, treatmentVersionIds: [...catalog.treatmentVersionIds].reverse() });
    expect(idsOf(selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, reversed, fail))).toEqual([T2, T1]);
  });
});

describe('selectPublishedTreatments: 깨진 참조는 주입된 실패 함수로 알린다', () => {
  it('치료 버전이 저장소에 없다 -> TREATMENT_VERSION_MISSING', () => {
    const { world, catalog } = publishedWorld();
    const broken = makeCatalogVersion({ ...catalog, treatmentVersionIds: ['TEST_FIXTURE_TV_GHOST'] });
    expect(defectOf(() => selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, broken, fail))).toEqual({ code: 'TREATMENT_VERSION_MISSING', treatmentVersionId: 'TEST_FIXTURE_TV_GHOST' });
  });

  it('치료 버전이 가리키는 치료가 없다 -> TREATMENT_MISSING', () => {
    const { world, catalog } = publishedWorld();
    // 치료가 없는 치료 버전은 저장소가 쓰기를 거절하므로(서비스 경로로도 만들 수 없다) 읽기 결과만 바꾼 깨진 저장소로 만든다.
    const orphan = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_ORPHAN', treatmentId: 'TEST_FIXTURE_NO_SUCH_TREATMENT' });
    const repo = withOverride(world.repo, { getTreatmentVersion: () => orphan });
    const broken = makeCatalogVersion({ ...catalog, treatmentVersionIds: ['TEST_FIXTURE_TV_ORPHAN'] });
    expect(defectOf(() => selectPublishedTreatments(repo, TEST_FIXTURE_CLINIC_ID, broken, fail))).toEqual({
      code: 'TREATMENT_MISSING',
      treatmentVersionId: 'TEST_FIXTURE_TV_ORPHAN',
      treatmentId: 'TEST_FIXTURE_NO_SUCH_TREATMENT',
    });
  });

  it('다른 병원의 치료를 담았다 -> TREATMENT_CLINIC_MISMATCH (소유 확인, 활성 여부와 무관하게 앞선다)', () => {
    const { world, catalog } = publishedWorld();
    // 다른 병원 소유 치료는 저장소가 (없는 병원을 가리키는 쓰기로) 거절하므로 읽기 결과만 바꾼 깨진 저장소로 만든다.
    const foreign = makeTreatment({ id: T1, clinicId: 'TEST_FIXTURE_CLINIC_OTHER' });
    expect(defectOf(() => selectPublishedTreatments(withOverride(world.repo, { getTreatment: () => foreign }), TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual({
      code: 'TREATMENT_CLINIC_MISMATCH',
      treatmentId: T1,
      clinicId: TEST_FIXTURE_CLINIC_ID,
    });
    const inactiveForeign = makeTreatment({ id: T1, clinicId: 'TEST_FIXTURE_CLINIC_OTHER', active: false });
    expect(defectOf(() => selectPublishedTreatments(withOverride(world.repo, { getTreatment: () => inactiveForeign }), TEST_FIXTURE_CLINIC_ID, catalog, fail)).code).toBe('TREATMENT_CLINIC_MISMATCH');
  });

  it('결함 검사는 카탈로그 순서로 한 항목씩이다: 앞 항목이 정상이어도 뒤 항목의 결함에서 던진다, 앞 항목의 결함이 먼저 나간다', () => {
    const { world, catalog } = publishedWorld();
    const mixed = makeCatalogVersion({ ...catalog, treatmentVersionIds: [catalog.treatmentVersionIds[0]!, 'TEST_FIXTURE_TV_GHOST'] });
    expect(defectOf(() => selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, mixed, fail)).code).toBe('TREATMENT_VERSION_MISSING');
    const doubled = makeCatalogVersion({ ...catalog, treatmentVersionIds: ['TEST_FIXTURE_TV_GHOST_1', 'TEST_FIXTURE_TV_GHOST_2'] });
    expect(defectOf(() => selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, doubled, fail))).toMatchObject({ treatmentVersionId: 'TEST_FIXTURE_TV_GHOST_1' });
  });
});

describe('selectPublishedTreatments: 읽기만 한다', () => {
  it('치료 버전과 치료 조회 두 읽기 메서드만 쓰고 저장소를 바꾸지 않는다', () => {
    const { world, catalog } = publishedWorld();
    setActive(world, T2, false);
    const before = repoSnapshotOf(world.repo);
    const touched = new Set<string>();
    const view = new Proxy(world.repo, {
      get(target, prop) {
        if (prop !== 'getTreatmentVersion' && prop !== 'getTreatment') {
          throw new Error(`TEST_FIXTURE: 읽기 전용 대리 객체가 '${String(prop)}' 접근을 거절했다`);
        }
        touched.add(prop);
        return (target[prop] as (id: string) => unknown).bind(target);
      },
    });
    expect(idsOf(selectPublishedTreatments(view, TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual([T1]);
    expect([...touched].sort()).toEqual(['getTreatment', 'getTreatmentVersion']);
    expect(repoSnapshotOf(world.repo)).toEqual(before);
  });

  it('입력 카탈로그를 바꾸지 않는다', () => {
    const { world, catalog } = publishedWorld();
    const frozenCopy = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    selectPublishedTreatments(world.repo, TEST_FIXTURE_CLINIC_ID, catalog, fail);
    expect(catalog).toEqual(frozenCopy);
  });
});
