import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/domain/errors';
import { toEngineBaseFeeLine } from '../../src/server/domain/projection';
import { loadReadinessSnapshot, readReadiness } from '../../src/server/readiness';
import { makeCommonBaseFee } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { TEST_CTX } from '../fixtures/server/readiness.fixture';
import { snapshotOf as repoSnapshotOf } from '../fixtures/server/repo.fixture';
import { TEST_FIXTURE_CLINIC_ID, catalogWorld, publishCatalogOf } from '../fixtures/server/versioning.fixture';

// 준비 상태 스냅샷의 공통 기본비용 줄은 공개 카탈로그와 같은 공유 기준(src/server/published-base-fees.ts)으로 만든다: 없음과 병원 소유 확인.
// 이 시험의 "없다"·"다른 병원 소유"는 저장소가 그런 쓰기를 거절하므로 읽기 메서드(getCommonBaseFee)의 결과만 바꾼 데이터 결함 시험이다.
// 정상 경로(소유가 맞는 기본비용)는 줄로 그대로 들어간다. 저장소 결함은 준비 상태 쪽의 기존 방식(DomainError)으로 거절한다.

const FEE_1 = 'TEST_FIXTURE_FEE_1';
const OTHER_CLINIC = 'TEST_FIXTURE_CLINIC_OTHER';

/** 병원 1 에 치료 둘(활성)과 공통 기본비용 둘을 담은 카탈로그를 게시한 세계 (규칙 묶음은 없다). */
function publishedWorld() {
  const world = catalogWorld();
  const catalog = publishCatalogOf(world, validCatalogRequest(), TEST_CATALOG_CONFIG);
  return { world, catalog };
}

/** 읽기 메서드 하나만 바꾼 저장소 (프로토타입 연결이라 나머지는 진짜 저장소다). */
const withOverride = <T extends object>(repo: T, overrides: Record<string, (...args: never[]) => unknown>): T =>
  Object.create(repo, Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, { value: fn }]))) as T;

describe('loadReadinessSnapshot: 소유가 맞는 공통 기본비용은 줄로 들어간다', () => {
  it('카탈로그가 담은 순서대로 기본비용 줄이 있고 내용은 기본비용의 변환 그대로다', () => {
    const { world, catalog } = publishedWorld();
    const [clinic] = loadReadinessSnapshot(world.repo).clinics;
    expect(clinic!.baseFeeLines).toEqual(catalog.baseFeeIds.map((id) => toEngineBaseFeeLine(world.repo.getCommonBaseFee(id)!)));
    expect(clinic!.baseFeeLines.every((line) => line.isBaseFee)).toBe(true);
    expect(clinic!.baseFeeLines).toHaveLength(2);
  });
});

describe('loadReadinessSnapshot: 다른 병원 소유 공통 기본비용은 거절한다 (데이터 결함 시험, 읽기 메서드 결과만 바꾼 저장소)', () => {
  it('REF_CONTENT_MISMATCH 이고 메시지에 기본비용 식별자와 병원이 있다 (줄이 되지도, 조용히 빠지지도 않는다)', () => {
    const { world } = publishedWorld();
    const foreign = makeCommonBaseFee({ id: FEE_1, clinicId: OTHER_CLINIC });
    const before = repoSnapshotOf(world.repo);
    const error = catchDomainError(() => loadReadinessSnapshot(withOverride(world.repo, { getCommonBaseFee: () => foreign })));
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expect(error.message).toContain(FEE_1);
    expect(error.message).toContain(TEST_FIXTURE_CLINIC_ID);
    expect(repoSnapshotOf(world.repo)).toEqual(before);
  });

  it('readReadiness 도 보고를 만들지 않고 같은 DomainError 로 거절한다', () => {
    const { world } = publishedWorld();
    const foreign = makeCommonBaseFee({ id: FEE_1, clinicId: OTHER_CLINIC });
    const repo = withOverride(world.repo, { getCommonBaseFee: () => foreign });
    let report: unknown = null;
    const error = catchDomainError(() => {
      report = readReadiness(repo, TEST_CTX);
    });
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expect(report).toBeNull();
  });

  it('둘째 기본비용만 다른 병원 소유여도 거절한다 (모든 기본비용을 확인한다)', () => {
    const { world } = publishedWorld();
    const repo = withOverride(world.repo, {
      getCommonBaseFee: (id: string) => (id === 'TEST_FIXTURE_FEE_2' ? makeCommonBaseFee({ id, clinicId: OTHER_CLINIC }) : world.repo.getCommonBaseFee(id)),
    });
    const error = catchDomainError(() => loadReadinessSnapshot(repo));
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expect(error.message).toContain('TEST_FIXTURE_FEE_2');
  });
});

describe('loadReadinessSnapshot: 없는 공통 기본비용은 기존 방식 그대로 NOT_FOUND 로 거절한다 (데이터 결함 시험, 읽기 메서드 결과만 바꾼 저장소)', () => {
  it('메시지가 기존과 한 글자도 다르지 않다', () => {
    const { world } = publishedWorld();
    const error = catchDomainError(() => loadReadinessSnapshot(withOverride(world.repo, { getCommonBaseFee: () => null })));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe(`공통 기본비용 '${FEE_1}' 이(가) 없다 (저장소가 일관되지 않아 준비 상태를 낼 수 없다)`);
  });
});
