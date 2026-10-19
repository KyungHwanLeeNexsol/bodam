import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/clinics/[slug]/catalog/route';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import type { Cell } from '../../src/engine/resolve';
import { canonicalDigest } from '../../src/server/digest';
import { readReadiness } from '../../src/server/readiness';
import type { ClinicReadiness, ReadinessContext } from '../../src/server/readiness';
import { CLINIC_1_SLUG, TEST_ACCEPTED_ORIGINS, TEST_TODAY, useTestServices } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, READY_CELL, T1, T2 } from '../fixtures/server/base-fee.fixture';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { buildWorld, requestBody, specOf } from '../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../fixtures/server/estimate-world.fixture';
import { ALL_CELLS, cellName, rowOfCell, sameCell } from '../fixtures/server/readiness.fixture';
import { estimateBody, expectRejection, serve } from './estimate-helpers';
import { callGet } from './helpers';
import { callPost } from './post-helpers';

// 공개 카탈로그·준비 상태·계산 요청이 "현재 게시된 치료"를 같은 기준으로 센다 (외부 검토 지적, design.md DD-19 비활성 치료 제외 + DD-23 규칙 0).
// 같은 저장소 상태에서 (1) GET …/catalog 의 치료와 기본비용, (2) readReadiness 의 병원 보고, (3) 게시된 치료 전부를 고른 POST …/estimate 의 응답을 맞대어 본다.
// 환자가 고른 치료의 부분집합이 아니라 현재 게시 카탈로그 전체를 고른 경우다: 이때 준비 상태 READY 와 계산 ESTIMATED 가 어긋나면 안 된다.
// 모든 시험은 실제 route.ts 의 GET·POST 를 부르고 준비 상태는 시험 구성과 같은 허용 출처·기준일·해시로 읽는다. 자료는 전부 TEST_FIXTURE 다.

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

beforeEach(() => {
  useTestServices(null);
});

/** 시험 구성과 같은 허용 출처·기준일·해시의 준비 상태 구성. */
const READINESS_CTX: ReadinessContext = { at: TEST_TODAY, acceptedOrigins: TEST_ACCEPTED_ORIGINS, digest: canonicalDigest };

interface CatalogBody {
  catalogVersion: string | null;
  treatments: Array<{ treatmentId: string }>;
  baseFees: Array<{ baseFeeId: string }>;
  baseFeeIncluded: string;
}

/** 치료 둘 중 T2 에는 매핑이 없고 T1 과 공통 기본비용은 모든 게 갖춰진 세계. 프로필은 GEN4_C4 · NON_LIFE 한 칸뿐이다. */
function worldWithUnmappedT2(): EstimateWorld {
  const w = buildWorld({ spec: specOf({ mappings: [{ target: T1, kind: 'COVERED' }, { target: BASE_FEE_ID, kind: 'COVERED' }] }) });
  serve(w);
  return w;
}

/** 치료 둘 모두의 매핑이 있는 세계 (전부 비활성으로 만드는 시험용). */
function fullyMappedWorld(): EstimateWorld {
  const w = buildWorld();
  serve(w);
  return w;
}

/** 치료의 활성 여부만 바꾼다 (그 치료의 다른 필드는 그대로). 시험이 비활성을 만드는 방법은 기존 시험과 같은 saveTreatment 다. */
function setActive(w: EstimateWorld, treatmentId: string, active: boolean): void {
  w.world.repo.saveTreatment({ ...w.world.repo.getTreatment(treatmentId)!, active });
}

const publicCatalog = async (): Promise<CatalogBody> => (await callGet(GET, CLINIC_1_SLUG, 'catalog')).body as CatalogBody;

const clinicReadiness = (w: EstimateWorld): ClinicReadiness => readReadiness(w.world.repo, READINESS_CTX).clinics.find((clinic) => clinic.clinicId === TEST_FIXTURE_CLINIC_ID)!;

/** 공개 카탈로그의 치료 전부를 고른 계산 요청 (환자가 현재 게시된 치료를 전부 고른 경우). */
async function estimateOverAllPublished(w: EstimateWorld, cell: Cell) {
  const catalog = await publicCatalog();
  const called = await callPost(POST, CLINIC_1_SLUG, requestBody(w, { generation: cell.generation, insurerType: cell.insurerType, treatmentIds: catalog.treatments.map((treatment) => treatment.treatmentId) }));
  return { called, catalog };
}

/**
 * 15칸 각각에서 준비 상태와 계산 응답이 같은 말을 하는지 본다 (엔진이 판정하고 기대값을 손으로 적지 않는다):
 *  - calculationReady == READY   ⇔ 응답 result.state 가 ESTIMATED
 *  - NOT_READY 의 S·P 단계: 응답 result.state 는 ON_HOLD 이고 모든 줄(고른 치료와 공통 기본비용)이 그 칸의 코드로 보류
 *  - NOT_READY 의 M 단계: 응답의 보류 (줄, 코드) 집합이 보고의 줄 목록과 같다
 * 준비된 칸의 목록을 돌려준다(빈 시험을 막으려고 호출한 쪽이 개수를 단언한다).
 */
async function expectReadinessAgreesWithEstimate(w: EstimateWorld, report: ClinicReadiness): Promise<Cell[]> {
  const ready: Cell[] = [];
  for (const cell of ALL_CELLS) {
    const where = cellName(cell);
    const row = rowOfCell(report.calculationReady, cell);
    const { called, catalog } = await estimateOverAllPublished(w, cell);
    expect(called.status, where).toBe(200);
    const body = estimateBody(called);
    if (row.status === 'READY') {
      expect(body.result.state, where).toBe('ESTIMATED');
      ready.push(cell);
      continue;
    }
    expect(body.result.state, where).toBe('ON_HOLD');
    const holds = body.result.holdReasons.map((hold) => `${hold.treatmentId}:${hold.code}`).sort();
    if (row.stage === 'M') {
      expect(holds, where).toEqual(row.lines.map((line) => `${line.treatmentId}:${line.code}`).sort());
    } else {
      expect(['S', 'P'], where).toContain(row.stage);
      const every = [...catalog.treatments.map((treatment) => treatment.treatmentId), ...catalog.baseFees.map((fee) => fee.baseFeeId)];
      expect(holds, where).toEqual(every.map((id) => `${id}:${(row as { code: string }).code}`).sort());
    }
  }
  return ready;
}

/**
 * 등록된 공통 기본비용이 세 경로 모두에서 그대로 들어가 있다:
 *  - 공개 카탈로그의 baseFees 에 있고 baseFeeIncluded 가 INCLUDED
 *  - 준비 상태 표 M 에 기본비용 줄(isBaseFee)이 15칸 모두 있고 준비된 칸에서는 READY
 *  - 계산 경로: 고를 수 있는 치료가 아니다(그 id 로 요청하면 422 TREATMENT_NOT_PUBLISHED)
 */
async function expectBaseFeeStillIncluded(w: EstimateWorld, report: ClinicReadiness): Promise<void> {
  const catalog = await publicCatalog();
  expect(catalog.baseFees.map((fee) => fee.baseFeeId)).toEqual([BASE_FEE_ID]);
  expect(catalog.baseFeeIncluded).toBe('INCLUDED');
  expect(catalog.treatments.map((treatment) => treatment.treatmentId)).not.toContain(BASE_FEE_ID);

  const feeRows = report.mappings.filter((row) => row.isBaseFee);
  expect(feeRows.map((row) => row.treatmentId)).toEqual(Array<string>(ALL_CELLS.length).fill(BASE_FEE_ID));
  expect(feeRows.filter((row) => row.status === 'READY').map((row) => row.cell)).toEqual([READY_CELL]);

  const called = await callPost(POST, CLINIC_1_SLUG, requestBody(w, { treatmentIds: [BASE_FEE_ID] }));
  expectRejection(called, 422, 'TREATMENT_NOT_PUBLISHED');
}

describe('(a) 활성 치료는 갖춰져 있고 비활성 치료에만 매핑이 없다: 준비 상태와 계산이 같은 말을 한다', () => {
  it('비활성이 되기 전에는 T2 의 매핑 없음이 준비된 칸을 막는다 (설정이 의미가 있다는 확인)', async () => {
    const w = worldWithUnmappedT2();
    const report = clinicReadiness(w);
    expect(rowOfCell(report.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'NOT_READY', stage: 'M', lines: [{ treatmentId: T2, code: 'MAPPING_ABSENT' }] });
    expect(await expectReadinessAgreesWithEstimate(w, report)).toEqual([]);
  });

  it('T2 를 비활성으로 하면 공개 카탈로그와 준비 상태 모두에서 빠지고, 준비된 칸의 준비 상태 READY 와 계산 ESTIMATED 가 같다', async () => {
    const w = worldWithUnmappedT2();
    setActive(w, T2, false);

    const catalog = await publicCatalog();
    expect(catalog.treatments.map((treatment) => treatment.treatmentId)).toEqual([T1]);

    const report = clinicReadiness(w);
    // 비활성 치료의 표 M 줄이 없고, 따라서 MAPPING_ABSENT 로 막히지 않는다.
    expect(report.mappings.some((row) => row.treatmentId === T2)).toBe(false);
    expect(rowOfCell(report.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY' });

    const ready = await expectReadinessAgreesWithEstimate(w, report);
    expect(ready).toHaveLength(1); // 빈 시험 방지: 준비된 칸이 정확히 하나이고
    expect(sameCell(ready[0]!, READY_CELL)).toBe(true);

    // 그 칸의 계산 응답: 치료는 T1 뿐이고 공통 기본비용이 자동으로 들어가 ESTIMATED.
    const { called } = await estimateOverAllPublished(w, READY_CELL);
    const body = estimateBody(called);
    expect(body.result.state).toBe('ESTIMATED');
    expect(body.result.lines.map((line) => [line.treatmentId, line.isBaseFee, line.state])).toEqual([
      [BASE_FEE_ID, true, 'ESTIMATED'],
      [T1, false, 'ESTIMATED'],
    ]);
    expect(body.result.amounts.baseFeeIncluded).toBe('INCLUDED');
    expect(body.result.holdReasons).toEqual([]);

    await expectBaseFeeStillIncluded(w, report);
  });
});

describe('(b) 모든 치료가 비활성이다: 공개 카탈로그는 비고 준비 상태도 준비되지 않았으며 계산도 할 수 없다', () => {
  it('공개 치료 목록 [], 준비된 칸 없음(프로필·범위가 쓸 만한 칸은 TREATMENT 단계 NO_PUBLISHED_TREATMENT), 계산은 422', async () => {
    const w = fullyMappedWorld();
    // 비활성이 되기 전에는 같은 칸이 준비되어 있다 (설정이 의미가 있다는 확인).
    expect(rowOfCell(clinicReadiness(w).calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY' });
    setActive(w, T1, false);
    setActive(w, T2, false);

    const catalog = await publicCatalog();
    expect(catalog.treatments).toEqual([]);

    const report = clinicReadiness(w);
    expect(report.mappings.filter((row) => !row.isBaseFee)).toEqual([]);
    expect(rowOfCell(report.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'NOT_READY', stage: 'TREATMENT', code: 'NO_PUBLISHED_TREATMENT' });
    expect(report.calculationReady.filter((row) => row.status === 'READY')).toEqual([]);

    // 계산: 비활성 치료 id 는 게시되지 않은 것이고, 빈 선택은 선택 없음이다.
    expectRejection(await callPost(POST, CLINIC_1_SLUG, requestBody(w, { treatmentIds: [T1] })), 422, 'TREATMENT_NOT_PUBLISHED');
    expectRejection(await callPost(POST, CLINIC_1_SLUG, requestBody(w, { treatmentIds: [T1, T2] })), 422, 'TREATMENT_NOT_PUBLISHED');
    expectRejection(await callPost(POST, CLINIC_1_SLUG, requestBody(w, { treatmentIds: [] })), 422, 'NO_TREATMENT_SELECTED');

    await expectBaseFeeStillIncluded(w, report);
  });
});

describe('(c) 비활성이었던 치료를 다시 활성으로 하면 세 경로에 모두 다시 나타난다', () => {
  it('T2 가 공개 카탈로그와 준비 상태에 돌아오고, 매핑 없음(MAPPING_ABSENT)으로 준비된 칸이 막히며 계산도 같은 보류를 낸다', async () => {
    const w = worldWithUnmappedT2();
    setActive(w, T2, false);
    expect(rowOfCell(clinicReadiness(w).calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY' });

    setActive(w, T2, true);

    const catalog = await publicCatalog();
    expect(catalog.treatments.map((treatment) => treatment.treatmentId)).toEqual([T1, T2]);

    const report = clinicReadiness(w);
    expect(report.mappings.filter((row) => row.treatmentId === T2)).toHaveLength(ALL_CELLS.length);
    expect(rowOfCell(report.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'NOT_READY', stage: 'M', lines: [{ treatmentId: T2, code: 'MAPPING_ABSENT' }] });

    const { called } = await estimateOverAllPublished(w, READY_CELL);
    const body = estimateBody(called);
    expect(body.result.state).toBe('ON_HOLD');
    expect(body.result.holdReasons).toEqual([{ treatmentId: T2, code: 'MAPPING_ABSENT' }]);
    // 공통 기본비용은 이 보류에서도 줄로 들어 있고 스스로는 막히지 않는다.
    expect(body.result.lines.find((line) => line.treatmentId === BASE_FEE_ID)).toMatchObject({ isBaseFee: true, state: 'ESTIMATED' });

    expect(await expectReadinessAgreesWithEstimate(w, report)).toEqual([]);
    await expectBaseFeeStillIncluded(w, report);
  });
});
