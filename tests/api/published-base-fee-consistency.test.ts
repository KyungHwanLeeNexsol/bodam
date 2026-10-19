import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/clinics/[slug]/catalog/route';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import type { Cell } from '../../src/engine/resolve';
import { canonicalDigest } from '../../src/server/digest';
import { DomainError } from '../../src/server/domain/errors';
import { readReadiness } from '../../src/server/readiness';
import type { ClinicReadiness, ReadinessContext } from '../../src/server/readiness';
import type { Repository } from '../../src/server/repo/interfaces';
import { CLINIC_1_SLUG, CollectingLog, TEST_ACCEPTED_ORIGINS, TEST_TODAY, createTestServices, useTestServices } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, READY_CELL, T1, T2 } from '../fixtures/server/base-fee.fixture';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { buildWorld, requestBody } from '../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../fixtures/server/estimate-world.fixture';
import { ALL_CELLS, cellName, rowOfCell, sameCell } from '../fixtures/server/readiness.fixture';
import { snapshotOf as repoSnapshotOf } from '../fixtures/server/repo.fixture';
import { estimateBody, expectRejection } from './estimate-helpers';
import { callGet, repoWith } from './helpers';
import { callPost } from './post-helpers';

// 공개 카탈로그·계산 요청·준비 상태가 "현재 게시 카탈로그의 공통 기본비용"을 같은 기준으로 확인한다
// (외부 검토 지적, design.md DD-19 + DD-23 규칙 0, 공유 기준: src/server/published-base-fees.ts).
// 같은 저장소 인스턴스에서 (1) GET …/catalog, (2) POST …/estimate, (3) readReadiness 를 맞대어 본다. 모두 실제 route.ts 의 GET·POST 를 부른다.
//
// (a) 소유가 맞는 기본비용: 15칸에서 준비 상태 READY ⇔ 계산 ESTIMATED, 기본비용은 계산 줄·카탈로그·준비 상태 표 M 에 모두 들어 있다.
// (b)(c) 은 데이터 결함 시험이다: 저장소가 "다른 병원 소유 기본비용"이나 "카탈로그가 가리키는 기본비용 없음"이 되는 쓰기를 거절하므로(서비스 경로로 만들 수 없다)
//   읽기 메서드 getCommonBaseFee 의 결과만 바꾼 읽기 덮어쓰기(repoWith, 프록시)로 만든다. API 와 준비 상태가 정확히 같은 덮어쓴 저장소를 본다.
//   두 경우 모두 저장소 내용이 호출 전후로 같고(전체 스냅샷 비교) 쓰기 메서드에 닿지 않았음을 함께 본다. 자료는 전부 TEST_FIXTURE 다.

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

beforeEach(() => {
  useTestServices(null);
});

const OTHER_CLINIC = 'TEST_FIXTURE_CLINIC_ELSE';

/** 시험 구성과 같은 허용 출처·기준일·해시의 준비 상태 구성. */
const READINESS_CTX: ReadinessContext = { at: TEST_TODAY, acceptedOrigins: TEST_ACCEPTED_ORIGINS, digest: canonicalDigest };

interface CatalogBody {
  catalogVersion: string | null;
  treatments: Array<{ treatmentId: string }>;
  baseFees: Array<{ baseFeeId: string }>;
  baseFeeIncluded: string;
}

/** 치료 둘과 공통 기본비용의 매핑이 모두 있는 세계 (GEN4_C4 · NON_LIFE 한 칸이 준비된다). */
const fullyMappedWorld = (): EstimateWorld => buildWorld();

/** 저장소에서 접근한 속성 이름을 모으는 감싸개. 쓰기 메서드(save·put·revise·record·append·assign·transaction)에 닿았는지 보려고 쓴다. */
function recordAccess(repo: Repository): { repo: Repository; accessed: Set<string> } {
  const accessed = new Set<string>();
  const proxy = new Proxy(repo, {
    get(target, property, receiver) {
      if (typeof property === 'string') accessed.add(property);
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { repo: proxy, accessed };
}

const WRITE_METHOD = /^(save|put|revise|record|append|assign|transaction)/;

const clinicReadinessOf = (repo: Repository): ClinicReadiness => readReadiness(repo, READINESS_CTX).clinics.find((clinic) => clinic.clinicId === TEST_FIXTURE_CLINIC_ID)!;

/** 공개 카탈로그의 치료 전부를 고른 계산 요청 (환자가 현재 게시된 치료를 전부 고른 경우). */
async function estimateOverAllPublished(w: EstimateWorld, cell: Cell) {
  const catalog = (await callGet(GET, CLINIC_1_SLUG, 'catalog')).body as CatalogBody;
  const called = await callPost(POST, CLINIC_1_SLUG, requestBody(w, { generation: cell.generation, insurerType: cell.insurerType, treatmentIds: catalog.treatments.map((treatment) => treatment.treatmentId) }));
  return { called, catalog };
}

describe('(a) 소유가 맞는 공통 기본비용: 준비 상태와 계산이 같은 말을 하고 기본비용이 세 경로에 모두 들어 있다', () => {
  it('15칸 모두에서 준비 상태 READY ⇔ 계산 ESTIMATED 이고, 준비된 칸은 정확히 하나다', async () => {
    const w = fullyMappedWorld();
    useTestServices(createTestServices({ repo: w.world.repo }));
    const report = clinicReadinessOf(w.world.repo);

    const ready: Cell[] = [];
    for (const cell of ALL_CELLS) {
      const where = cellName(cell);
      const row = rowOfCell(report.calculationReady, cell);
      const { called } = await estimateOverAllPublished(w, cell);
      expect(called.status, where).toBe(200);
      const state = estimateBody(called).result.state;
      expect(state === 'ESTIMATED', where).toBe(row.status === 'READY');
      if (row.status === 'READY') ready.push(cell);
    }
    expect(ready).toHaveLength(1); // 빈 시험 방지
    expect(sameCell(ready[0]!, READY_CELL)).toBe(true);
  });

  it('기본비용은 계산 줄(isBaseFee)·카탈로그 baseFees·준비 상태 표 M 의 기본비용 줄 15칸에 모두 있다', async () => {
    const w = fullyMappedWorld();
    useTestServices(createTestServices({ repo: w.world.repo }));
    const report = clinicReadinessOf(w.world.repo);

    const { called, catalog } = await estimateOverAllPublished(w, READY_CELL);
    const body = estimateBody(called);
    expect(body.result.state).toBe('ESTIMATED');
    expect(body.result.lines.filter((line) => line.isBaseFee).map((line) => [line.treatmentId, line.state])).toEqual([[BASE_FEE_ID, 'ESTIMATED']]);
    expect(body.result.amounts.baseFeeIncluded).toBe('INCLUDED');
    expect(catalog.baseFees.map((fee) => fee.baseFeeId)).toEqual([BASE_FEE_ID]);
    expect(catalog.baseFeeIncluded).toBe('INCLUDED');

    const feeRows = report.mappings.filter((row) => row.isBaseFee);
    expect(feeRows.map((row) => row.treatmentId)).toEqual(Array<string>(ALL_CELLS.length).fill(BASE_FEE_ID));
    expect(feeRows.filter((row) => row.status === 'READY').map((row) => row.cell)).toEqual([READY_CELL]);
    expect(report.mappings.filter((row) => !row.isBaseFee).map((row) => row.treatmentId)).toEqual([...Array<string>(ALL_CELLS.length).fill(T1), ...Array<string>(ALL_CELLS.length).fill(T2)]);
  });
});

/**
 * 읽기 덮어쓴 저장소 하나를 API 와 준비 상태가 함께 본다. 반환: 세 호출의 결과와 덮어쓴 저장소가 닿은 속성.
 * 준비 상태는 던진 DomainError 를 잡아 돌려주고, 보고 객체가 만들어졌는지(report)도 알려 준다.
 */
async function runDefect(w: EstimateWorld, override: Partial<Record<keyof Repository, (...args: never[]) => unknown>>) {
  const { repo, accessed } = recordAccess(repoWith(w.world.repo, override));
  const log = new CollectingLog();
  useTestServices(createTestServices({ repo, log }));
  const before = repoSnapshotOf(w.world.repo);

  const catalog = await callGet(GET, CLINIC_1_SLUG, 'catalog');
  const estimate = await callPost(POST, CLINIC_1_SLUG, requestBody(w));

  let report: unknown = null;
  let thrown: unknown = null;
  try {
    report = readReadiness(repo, READINESS_CTX);
  } catch (error) {
    thrown = error;
  }
  return { catalog, estimate, report, thrown, log, accessed, unchanged: JSON.stringify(repoSnapshotOf(w.world.repo)) === JSON.stringify(before) };
}

describe('(b) 공통 기본비용이 다른 병원 소유다 (데이터 결함 시험: getCommonBaseFee 읽기 덮어쓰기)', () => {
  it('공개 카탈로그와 계산은 500 INTERNAL_ERROR 이고 준비 상태는 보고를 만들지 않고 DomainError(REF_CONTENT_MISMATCH)로 거절한다', async () => {
    const w = fullyMappedWorld();
    const real = w.world.repo;
    const result = await runDefect(w, { getCommonBaseFee: (id: string) => ({ ...real.getCommonBaseFee(id)!, clinicId: OTHER_CLINIC }) });

    expectRejection(result.catalog, 500, 'INTERNAL_ERROR');
    expectRejection(result.estimate, 500, 'INTERNAL_ERROR');
    for (const leaked of [BASE_FEE_ID, OTHER_CLINIC, 'TEST_FIXTURE', 'BASE_FEE_CLINIC_MISMATCH']) {
      expect(result.catalog.text).not.toContain(leaked);
      expect(result.estimate.text).not.toContain(leaked);
    }
    expect(result.log.entries).toEqual([
      { event: 'SERVER_INTEGRITY_ERROR', code: 'BASE_FEE_CLINIC_MISMATCH' },
      { event: 'SERVER_INTEGRITY_ERROR', code: 'BASE_FEE_CLINIC_MISMATCH' },
    ]);

    // 준비 상태: 어떤 칸에도 보고(READY 포함)를 만들지 않고 던진다.
    expect(result.report).toBeNull();
    expect(result.thrown).toBeInstanceOf(DomainError);
    expect((result.thrown as DomainError).code).toBe('REF_CONTENT_MISMATCH');
    expect((result.thrown as DomainError).message).toContain(TEST_FIXTURE_CLINIC_ID);
  });

  it('읽기만 한다: 호출 전후로 저장소 전체가 같고 쓰기 메서드에 닿지 않았다 (읽기는 실제로 일어났다)', async () => {
    const w = fullyMappedWorld();
    const real = w.world.repo;
    const result = await runDefect(w, { getCommonBaseFee: (id: string) => ({ ...real.getCommonBaseFee(id)!, clinicId: OTHER_CLINIC }) });
    expect(result.unchanged).toBe(true);
    expect(result.accessed.has('getCommonBaseFee')).toBe(true);
    expect([...result.accessed].filter((name) => WRITE_METHOD.test(name))).toEqual([]);
  });
});

describe('(c) 카탈로그가 가리키는 공통 기본비용이 없다 (데이터 결함 시험: getCommonBaseFee 읽기 덮어쓰기)', () => {
  it('공개 카탈로그와 계산은 기존 500 INTERNAL_ERROR 이고 준비 상태는 기존 DomainError(NOT_FOUND)와 같은 메시지로 거절한다', async () => {
    const w = fullyMappedWorld();
    const result = await runDefect(w, { getCommonBaseFee: () => null });

    expectRejection(result.catalog, 500, 'INTERNAL_ERROR');
    expectRejection(result.estimate, 500, 'INTERNAL_ERROR');
    expect(result.log.entries).toEqual([
      { event: 'SERVER_INTEGRITY_ERROR', code: 'BASE_FEE_MISSING' },
      { event: 'SERVER_INTEGRITY_ERROR', code: 'BASE_FEE_MISSING' },
    ]);

    expect(result.report).toBeNull();
    expect(result.thrown).toBeInstanceOf(DomainError);
    expect((result.thrown as DomainError).code).toBe('NOT_FOUND');
    expect((result.thrown as DomainError).message).toBe(`공통 기본비용 '${w.catalog.baseFeeIds[0]}' 이(가) 없다 (저장소가 일관되지 않아 준비 상태를 낼 수 없다)`);
  });

  it('읽기만 한다: 호출 전후로 저장소 전체가 같고 쓰기 메서드에 닿지 않았다', async () => {
    const w = fullyMappedWorld();
    const result = await runDefect(w, { getCommonBaseFee: () => null });
    expect(result.unchanged).toBe(true);
    expect(result.accessed.has('getCommonBaseFee')).toBe(true);
    expect([...result.accessed].filter((name) => WRITE_METHOD.test(name))).toEqual([]);
  });
});
