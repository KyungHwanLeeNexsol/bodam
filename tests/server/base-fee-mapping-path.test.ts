import { describe, expect, it } from 'vitest';
import { approve, submitForReview } from '../../src/server/approval';
import { createDraft } from '../../src/server/authoring';
import { coverageFingerprintOfBaseFee } from '../../src/server/fingerprint';
import { loadReadinessSnapshot } from '../../src/server/readiness';
import type { ClinicReadiness } from '../../src/server/readiness';
import { TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import {
  BASE_FEE_AMOUNT,
  BASE_FEE_ID,
  REPO_CTX,
  READY_CELL,
  TREATMENT_PAYMENT,
  approveFeeMapping,
  baseFeeCatalogWorld,
  baseFeeMappingContent,
  clinicReport,
  estimateOf,
  feeLineOf,
  feeRowAt,
  independentClinicInput,
  lineOfBaseFee,
  makeBaseFeeVersion,
  publishFeeCatalog,
  publishedBaseFeePath,
} from '../fixtures/server/base-fee.fixture';
import { ALL_CELLS, cellName, expectCalculationAgrees, estimateFor, rowOfCell, sameCell } from '../fixtures/server/readiness.fixture';

// 공통 기본비용 매핑 승인·게시 경로 (M3 외부 검토 보완 ①, plan.md §E #8 정정 수용, design.md DD-03·DD-15·DD-16).
// 공통 기본비용도 치료와 같은 보장 판단(매핑)을 거친다. 기본비용은 병원 지불액 T 에 항상 포함되고, 매핑이 없거나 쓸 수 없으면
// 보험 급여 계산 쪽만 보류된다(T 는 그대로). 이 시험은 모든 단계를 도메인 서비스로 지난다:
//   카탈로그 게시 → 매핑 작성 → 제출 → (작성자와 다른) RV 승인 → 규칙 묶음 게시 → PO 범위 지정 → 준비 상태 읽기 → estimate().
// 저장소에 승인 상태나 지문을 직접 넣지 않는다. 시험 자료는 전부 TEST_FIXTURE 다. 기존 AC 에 추가 근거를 주며 새 AC 를 닫지 않는다.

const ALL_IN = TREATMENT_PAYMENT + BASE_FEE_AMOUNT;

/** 병원 1 의 준비 상태 보고와 서비스와 따로 조립한 엔진 입력이 모든 칸에서 맞는지, 그리고 READY_CELL 의 줄별 판정이 맞는지 확인한다. */
function expectReadinessAgreesWithEngine(world: ReturnType<typeof baseFeeCatalogWorld>, label: string): ClinicReadiness {
  const report = clinicReport(world);
  const input = independentClinicInput(world);
  expectCalculationAgrees(report, input, REPO_CTX, label);
  const result = estimateOf(world);
  for (const line of result.lines) {
    const row = report.mappings.find((candidate) => candidate.treatmentId === line.treatmentId && sameCell(candidate.cell, READY_CELL))!;
    if (line.state === 'ON_HOLD') {
      expect(row, `${label} ${line.treatmentId}`).toMatchObject({ status: 'NOT_READY', code: line.holdReason });
    } else {
      expect(row, `${label} ${line.treatmentId}`).toMatchObject({ status: 'READY', confirmedExclusion: line.state === 'EXCLUDED_CONFIRMED' });
    }
  }
  return report;
}

describe('기본비용 매핑의 승인: 서비스 경로 (작성 → 제출 → 다른 RV 승인)', () => {
  it('작성자가 제출하고 다른 RV 가 승인하면 APPROVED 이고 고정 지문은 기본비용 현재 버전의 지문이다', () => {
    const world = baseFeeCatalogWorld();
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseFeeMappingContent('COVERED')).ref;
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, draft);

    approve(world.deps, TEST_FIXTURE_RV_APPROVER, draft);

    const state = world.repo.getItemState(draft)!;
    expect(state.state).toBe('APPROVED');
    expect(state.approver?.approverId).toBe(TEST_FIXTURE_RV_APPROVER.id);
    expect(state.approvedFingerprint).toBe(coverageFingerprintOfBaseFee(makeBaseFeeVersion(1)));
    // 매핑의 대상은 버전 id 가 아니라 기본비용의 안정 식별자다.
    expect(world.repo.getItemVersion(draft)?.content).toMatchObject({ treatmentId: BASE_FEE_ID });
  });

  it('승인된 매핑을 담은 묶음이 게시되고 항목은 PUBLISHED 가 된다 (고정 지문이 낡지 않았다)', () => {
    const { world, feeMapping } = publishedBaseFeePath('COVERED');
    expect(world.repo.getItemState(feeMapping!)?.state).toBe('PUBLISHED');
    expect(world.repo.getItemState(feeMapping!)?.approvedFingerprint).toBe(coverageFingerprintOfBaseFee(makeBaseFeeVersion(1)));
  });
});

describe('기본비용 줄: 준비 상태와 계산이 줄 단위로 같다', () => {
  it('저장소에서 읽은 기본비용 줄은 안정 식별자를 줄 id, 버전 id 를 줄 버전 id 로 하고 기대 모양과 같다', () => {
    const { world } = publishedBaseFeePath('COVERED');
    const [clinic] = loadReadinessSnapshot(world.repo).clinics;
    expect(clinic!.baseFeeLines).toEqual([lineOfBaseFee(makeBaseFeeVersion(1))]);
    expect(clinic!.baseFeeLines[0]).toMatchObject({ treatmentId: BASE_FEE_ID, treatmentVersionId: makeBaseFeeVersion(1).id, isBaseFee: true });
  });

  it('COVERED 매핑: 표 M 의 기본비용 줄이 READY 이고 calculationReady 가 READY 이며 estimate() 도 그 줄을 ESTIMATED 로 낸다', () => {
    const { world, bundle } = publishedBaseFeePath('COVERED');
    const report = expectReadinessAgreesWithEngine(world, 'COVERED');

    expect(feeRowAt(report)).toEqual({ treatmentId: BASE_FEE_ID, isBaseFee: true, cell: READY_CELL, status: 'READY', confirmedExclusion: false });
    expect(rowOfCell(report.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY' });
    expect(report.scope).toMatchObject({ status: 'READY', bundleId: bundle.id });

    const result = estimateOf(world);
    expect(result.state).toBe('ESTIMATED');
    expect(feeLineOf(result)).toMatchObject({ state: 'ESTIMATED', groupKey: 'TEST_GROUP_BENEFIT', isBaseFee: true });
    expect(result.amounts).toMatchObject({ hospitalPayment: ALL_IN, baseFeeIncluded: 'INCLUDED' });
    expect(result.holdReasons).toEqual([]);
  });

  it('EXCLUDED 매핑: 표 M 이 READY (EXCLUDED_CONFIRMED) 이고 estimate() 는 그 줄을 EXCLUDED_CONFIRMED 로 내며 병원 지불액에는 기본비용이 든다', () => {
    const { world } = publishedBaseFeePath('EXCLUDED');
    const report = expectReadinessAgreesWithEngine(world, 'EXCLUDED');

    expect(feeRowAt(report)).toEqual({ treatmentId: BASE_FEE_ID, isBaseFee: true, cell: READY_CELL, status: 'READY', confirmedExclusion: true });
    expect(rowOfCell(report.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY' });

    const result = estimateOf(world);
    expect(result.state).toBe('ESTIMATED_WITH_EXCLUSIONS');
    expect(feeLineOf(result)).toMatchObject({ state: 'EXCLUDED_CONFIRMED', isBaseFee: true });
    expect(result.excludedItems).toEqual([{ treatmentId: BASE_FEE_ID, amount: BASE_FEE_AMOUNT, reason: 'TEST_FIXTURE_EXCLUSION_REASON', payout: 0 }]);
    expect(result.amounts).toMatchObject({ hospitalPayment: ALL_IN, baseFeeIncluded: 'INCLUDED' });
  });

  it('매핑이 없으면 기존 보류 계약 그대로다: 그 줄만 MAPPING_ABSENT, 병원 지불액 T 는 기본비용을 포함한 채 그대로다', () => {
    const { world } = publishedBaseFeePath('NONE');
    const report = expectReadinessAgreesWithEngine(world, 'NONE');

    expect(feeRowAt(report)).toEqual({ treatmentId: BASE_FEE_ID, isBaseFee: true, cell: READY_CELL, status: 'NOT_READY', code: 'MAPPING_ABSENT' });
    expect(rowOfCell(report.calculationReady, READY_CELL)).toEqual({
      cell: READY_CELL,
      status: 'NOT_READY',
      stage: 'M',
      lines: [{ treatmentId: BASE_FEE_ID, code: 'MAPPING_ABSENT' }],
    });

    const result = estimateOf(world);
    expect(result.state).toBe('ON_HOLD');
    expect(result.holdReasons).toEqual([{ treatmentId: BASE_FEE_ID, code: 'MAPPING_ABSENT' }]);
    expect(result.lines.filter((line) => line.treatmentId !== BASE_FEE_ID).every((line) => line.state === 'ESTIMATED')).toBe(true);
    expect(result.amounts).toEqual({ hospitalPayment: ALL_IN, baseFeeIncluded: 'INCLUDED', expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null });
  });

  it('보장 판단 필드가 바뀐 새 버전을 게시하면 그 줄만 MAPPING_UNDER_REREVIEW 로 보류되고 병원 지불액 T 는 그대로다', () => {
    const { world } = publishedBaseFeePath('COVERED');
    publishFeeCatalog(world, [makeBaseFeeVersion(2, { code: 'TEST_FIXTURE_BASE_FEE_CODE_CHANGED' })]);
    const report = expectReadinessAgreesWithEngine(world, 'UNDER_REREVIEW');

    expect(feeRowAt(report)).toMatchObject({ status: 'NOT_READY', code: 'MAPPING_UNDER_REREVIEW' });
    const result = estimateOf(world);
    expect(result.holdReasons).toEqual([{ treatmentId: BASE_FEE_ID, code: 'MAPPING_UNDER_REREVIEW' }]);
    expect(result.amounts).toMatchObject({ hospitalPayment: ALL_IN, baseFeeIncluded: 'INCLUDED', expectedInsurancePayout: null });
  });

  it('병원 지불액 T 는 매핑 상태(있음·없음·재검토·제외)와 무관하게 같고 항상 기본비용을 포함한다', () => {
    const payments = {
      covered: estimateOf(publishedBaseFeePath('COVERED').world).amounts.hospitalPayment,
      excluded: estimateOf(publishedBaseFeePath('EXCLUDED').world).amounts.hospitalPayment,
      absent: estimateOf(publishedBaseFeePath('NONE').world).amounts.hospitalPayment,
    };
    const reReview = publishedBaseFeePath('COVERED').world;
    publishFeeCatalog(reReview, [makeBaseFeeVersion(2, { benefitType: 'NON_BENEFIT' })]);
    expect({ ...payments, underReReview: estimateOf(reReview).amounts.hospitalPayment }).toEqual({ covered: ALL_IN, excluded: ALL_IN, absent: ALL_IN, underReReview: ALL_IN });
  });

  it('기본비용이 등록돼 있으면 baseFeeIncluded 는 INCLUDED 이고, 등록하지 않은 병원은 NOT_REGISTERED 다', () => {
    const { world } = publishedBaseFeePath('COVERED');
    expect(estimateOf(world).amounts.baseFeeIncluded).toBe('INCLUDED');

    // 기본비용 없이 게시한 새 카탈로그: 같은 묶음·같은 칸에서 NOT_REGISTERED 이고 T 는 치료 합계뿐이다.
    publishFeeCatalog(world, []);
    const result = estimateOf(world);
    expect(result.amounts).toMatchObject({ hospitalPayment: TREATMENT_PAYMENT, baseFeeIncluded: 'NOT_REGISTERED' });
  });

  it.each([['COVERED'], ['EXCLUDED'], ['NONE']] as const)('%s: 15칸 모두에서 calculationReady 가 estimate() 와 같은 판정이다 (READY 는 프로필이 있는 한 칸뿐)', (kind) => {
    const { world } = publishedBaseFeePath(kind);
    const report = clinicReport(world);
    const input = independentClinicInput(world);
    for (const cell of ALL_CELLS) {
      const row = rowOfCell(report.calculationReady, cell);
      const result = estimateFor(input, cell, REPO_CTX)!;
      expect(row.status === 'READY', `${kind} ${cellName(cell)}`).toBe(result.state !== 'ON_HOLD');
      expect(row.status === 'READY', `${kind} ${cellName(cell)} READY 칸`).toBe(sameCell(cell, READY_CELL) && kind !== 'NONE');
    }
  });
});
