import { describe, expect, it } from 'vitest';
import { selectPublishedBaseFees } from '../../src/server/published-base-fees';
import type { PublishedBaseFeeDefect } from '../../src/server/published-base-fees';
import { makeCatalogVersion, makeCommonBaseFee } from '../fixtures/server/entities.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { snapshotOf as repoSnapshotOf } from '../fixtures/server/repo.fixture';
import { TEST_FIXTURE_CLINIC_ID, catalogWorld, publishCatalogOf } from '../fixtures/server/versioning.fixture';

// 현재 게시된 공통 기본비용의 단일 선택 기준 (src/server/published-base-fees.ts): 카탈로그의 기본비용 버전 → 존재 확인 → 병원 소유 확인, 카탈로그 순서.
// 결함 처리는 호출한 층이 주입한다(공개 API 는 ServerIntegrityError, 준비 상태는 DomainError). 이 시험은 주입된 실패 함수가 받은 결함을 그대로 본다.
// 깨진 저장소(없는 기본비용, 다른 병원 소유 기본비용)는 저장소가 그런 쓰기를 거절하므로 "읽기 메서드 결과만 바꾼" 저장소로 만든다 (데이터 결함 시험).

const FEE_1 = 'TEST_FIXTURE_FEE_1';
const FEE_2 = 'TEST_FIXTURE_FEE_2';
const OTHER_CLINIC = 'TEST_FIXTURE_CLINIC_OTHER';

/** 던진 결함을 그대로 꺼내 보기 위한 주입용 실패 함수. */
class Defective extends Error {
  constructor(readonly defect: PublishedBaseFeeDefect) {
    super(defect.code);
  }
}
const fail = (defect: PublishedBaseFeeDefect): never => {
  throw new Defective(defect);
};

function defectOf(action: () => unknown): PublishedBaseFeeDefect {
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

/** 읽기 메서드 하나만 바꾼 저장소 (프로토타입 연결이라 나머지는 진짜 저장소다). */
const withOverride = <T extends object>(repo: T, overrides: Record<string, (...args: never[]) => unknown>): T =>
  Object.create(repo, Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, { value: fn }]))) as T;

describe('selectPublishedBaseFees: 소유가 맞는 기본비용 전부를 카탈로그 순서로', () => {
  it('카탈로그가 담은 기본비용 버전을 담긴 순서 그대로 돌려준다 (저장소의 기록과 같은 내용)', () => {
    const { world, catalog } = publishedWorld();
    const selected = selectPublishedBaseFees(world.repo, TEST_FIXTURE_CLINIC_ID, catalog, fail);
    expect(selected.map((fee) => fee.id)).toEqual([FEE_1, FEE_2]);
    expect(selected).toEqual(catalog.baseFeeIds.map((id) => world.repo.getCommonBaseFee(id)));
  });

  it('정렬하지 않는다: 카탈로그에 적힌 순서가 그대로다 (baseFeeId 순 표시는 호출한 층의 몫)', () => {
    const { world, catalog } = publishedWorld();
    const reversed = makeCatalogVersion({ ...catalog, baseFeeIds: [...catalog.baseFeeIds].reverse() });
    expect(selectPublishedBaseFees(world.repo, TEST_FIXTURE_CLINIC_ID, reversed, fail).map((fee) => fee.id)).toEqual([FEE_2, FEE_1]);
  });

  it('카탈로그가 기본비용을 담지 않았으면 빈 목록이다 (실패 함수는 불리지 않는다)', () => {
    const { world, catalog } = publishedWorld();
    expect(selectPublishedBaseFees(world.repo, TEST_FIXTURE_CLINIC_ID, makeCatalogVersion({ ...catalog, baseFeeIds: [] }), fail)).toEqual([]);
  });
});

describe('selectPublishedBaseFees: 깨진 참조는 주입된 실패 함수로 알린다 (읽기 결과만 바꾼 깨진 저장소)', () => {
  it('기본비용 버전이 저장소에 없다 -> BASE_FEE_MISSING (없는 버전 id 를 싣는다)', () => {
    const { world, catalog } = publishedWorld();
    expect(defectOf(() => selectPublishedBaseFees(withOverride(world.repo, { getCommonBaseFee: () => null }), TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual({
      code: 'BASE_FEE_MISSING',
      baseFeeVersionId: FEE_1,
    });
  });

  it('다른 병원의 기본비용을 담았다 -> BASE_FEE_CLINIC_MISMATCH (기본비용 식별자와 기대한 병원을 싣는다)', () => {
    const { world, catalog } = publishedWorld();
    const foreign = makeCommonBaseFee({ id: FEE_1, clinicId: OTHER_CLINIC });
    expect(defectOf(() => selectPublishedBaseFees(withOverride(world.repo, { getCommonBaseFee: () => foreign }), TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual({
      code: 'BASE_FEE_CLINIC_MISMATCH',
      baseFeeId: FEE_1,
      clinicId: TEST_FIXTURE_CLINIC_ID,
    });
  });

  it('결함 검사는 카탈로그 순서로 한 항목씩이다: 앞 항목의 결함이 먼저 나간다, 앞 항목이 정상이면 뒤 항목의 결함에서 던진다', () => {
    const { world, catalog } = publishedWorld();
    // 첫째는 없고 둘째는 다른 병원 것: 첫째(없음)가 먼저 나간다.
    const firstMissing = withOverride(world.repo, { getCommonBaseFee: (id: string) => (id === FEE_1 ? null : makeCommonBaseFee({ id, clinicId: OTHER_CLINIC })) });
    expect(defectOf(() => selectPublishedBaseFees(firstMissing, TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual({ code: 'BASE_FEE_MISSING', baseFeeVersionId: FEE_1 });
    // 첫째는 정상이고 둘째가 다른 병원 것: 둘째의 결함에서 던진다.
    const secondForeign = withOverride(world.repo, {
      getCommonBaseFee: (id: string) => (id === FEE_2 ? makeCommonBaseFee({ id, clinicId: OTHER_CLINIC }) : world.repo.getCommonBaseFee(id)),
    });
    expect(defectOf(() => selectPublishedBaseFees(secondForeign, TEST_FIXTURE_CLINIC_ID, catalog, fail))).toEqual({
      code: 'BASE_FEE_CLINIC_MISMATCH',
      baseFeeId: FEE_2,
      clinicId: TEST_FIXTURE_CLINIC_ID,
    });
  });

  it('첫 결함에서 멈춘다: 그 뒤 항목은 읽지 않는다', () => {
    const { world, catalog } = publishedWorld();
    const read: string[] = [];
    const repo = withOverride(world.repo, {
      getCommonBaseFee: (id: string) => {
        read.push(id);
        return null;
      },
    });
    defectOf(() => selectPublishedBaseFees(repo, TEST_FIXTURE_CLINIC_ID, catalog, fail));
    expect(read).toEqual([FEE_1]);
  });
});

describe('selectPublishedBaseFees: 읽기만 한다', () => {
  it('getCommonBaseFee 하나만 쓰고(카탈로그 항목마다 한 번) 저장소를 바꾸지 않는다', () => {
    const { world, catalog } = publishedWorld();
    const before = repoSnapshotOf(world.repo);
    const touched: string[] = [];
    const view = new Proxy(world.repo, {
      get(target, prop) {
        if (prop !== 'getCommonBaseFee') {
          throw new Error(`TEST_FIXTURE: 읽기 전용 대리 객체가 '${String(prop)}' 접근을 거절했다`);
        }
        touched.push(prop);
        return (target[prop] as (id: string) => unknown).bind(target);
      },
    });
    expect(selectPublishedBaseFees(view, TEST_FIXTURE_CLINIC_ID, catalog, fail)).toHaveLength(2);
    expect(touched).toEqual(['getCommonBaseFee', 'getCommonBaseFee']);
    expect(repoSnapshotOf(world.repo)).toEqual(before);
  });

  it('입력 카탈로그를 바꾸지 않는다', () => {
    const { world, catalog } = publishedWorld();
    const frozenCopy = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    selectPublishedBaseFees(world.repo, TEST_FIXTURE_CLINIC_ID, catalog, fail);
    expect(catalog).toEqual(frozenCopy);
  });
});
