import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import type { EstimateInput } from '../../src/engine/types';
import { testDigest } from '../fixtures/engine/profiles.fixture';
import {
  CASE_A,
  CASE_B,
  CASE_C,
  CASE_D,
  CASE_D_ASSIGN,
  CASE_E,
  G_BENEFIT,
  G_NON_BENEFIT,
  G_ONE,
  caseInput,
  group,
  perVisit,
  runEstimate,
} from '../fixtures/engine/cases.fixture';
import { T_INJECT, T_PHYSIO, T_ULTRA, T_XRAY, exampleLines, makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다. 기획서 §5 예시 4종의 금액(합계 124,000)을 옮긴 사본이다.

const TOTAL = 124_000;

describe('AC-002a~e 기획서 계산 예시 재현 (예상 병원 결제액은 모든 행에서 124,000원)', () => {
  it('AC-002a 사례 A: FIXED 10,000, PER_VISIT_PAYOUT 250,000 -> 보험금 114,000, 본인 부담 10,000', () => {
    const result = runEstimate(caseInput({ groups: CASE_A }));
    expect(result.state).toBe('ESTIMATED');
    expect(result.amounts).toEqual({
      hospitalPayment: TOTAL,
      baseFeeIncluded: 'NOT_REGISTERED',
      expectedInsurancePayout: 114_000,
      expectedOutOfPocketAfterPayout: 10_000,
    });
    expect(result.assumptions).toEqual(['STANDARD_PROFILE_APPLIED', 'ALL_COVERED_AND_LIMIT_REMAINS', 'PERSONAL_CONTRACT_NOT_CONFIRMED']);
    expect(result.holdReasons).toEqual([]);
    expect(result.excludedItems).toEqual([]);
  });

  it('AC-002b 사례 B: RATE_WITH_FIXED_FLOOR 10,000 / 2,000bp, UNLIMITED_DECLARED -> 99,200 / 24,800, D = 24,800', () => {
    const result = runEstimate(caseInput({ groups: CASE_B }));
    expect(result.amounts).toMatchObject({ hospitalPayment: TOTAL, expectedInsurancePayout: 99_200, expectedOutOfPocketAfterPayout: 24_800 });
    expect(result.groups[0]).toMatchObject({ E: TOTAL, D: 24_800, D_applied: 24_800, L: 'UNLIMITED', P: 99_200, P_pooled: 99_200 });
  });

  it('AC-002c 사례 C: SPLIT_RATE_WITH_FIXED_FLOOR 10,000 / 급여 1,000bp / 비급여 2,000bp -> 100,600 / 23,400, D = 23,400', () => {
    const result = runEstimate(caseInput({ groups: CASE_C }));
    expect(result.amounts).toMatchObject({ expectedInsurancePayout: 100_600, expectedOutOfPocketAfterPayout: 23_400 });
    expect(result.groups[0]).toMatchObject({ G: 14_000, N: 110_000, E: TOTAL, D: 23_400, P: 100_600 });
  });

  it('AC-002d 사례 D: 급여·일반 비급여 두 그룹 -> 81,000 (4,000 + 77,000) / 43,000, 두 공제가 합쳐지지 않는다', () => {
    const result = runEstimate(caseInput({ groups: CASE_D, assign: CASE_D_ASSIGN }));
    expect(result.amounts).toMatchObject({ expectedInsurancePayout: 81_000, expectedOutOfPocketAfterPayout: 43_000 });
    const [benefit, nonBenefit] = result.groups;
    expect(benefit).toMatchObject({ groupKey: G_BENEFIT, E: 14_000, D: 10_000, D_applied: 10_000, P: 4_000 }); // 14,000 이 아님
    expect(nonBenefit).toMatchObject({ groupKey: G_NON_BENEFIT, E: 110_000, D: 33_000, P: 77_000 });
    expect(result.groups).toHaveLength(2);
  });

  it('AC-002e 사례 E: 신장분사치료 매핑이 EXCLUDED -> 74,000 / 50,000, 그룹 E = 84,000, 제외 40,000 미포함', () => {
    const result = runEstimate(caseInput({ groups: CASE_E, excluded: [T_INJECT] }));
    expect(result.state).toBe('ESTIMATED_WITH_EXCLUSIONS');
    expect(result.amounts).toMatchObject({ hospitalPayment: TOTAL, expectedInsurancePayout: 74_000, expectedOutOfPocketAfterPayout: 50_000 });
    expect(result.groups[0]).toMatchObject({ E: 84_000, P: 74_000 });
    expect(result.excludedItems).toEqual([
      { treatmentId: T_INJECT, amount: 40_000, reason: 'TEST_FIXTURE_EXCLUSION_REASON', payout: 0 },
    ]);
    expect(result.assumptions).toContain('REMAINING_COVERED_AND_LIMIT_REMAINS');
    expect(result.assumptions).not.toContain('ALL_COVERED_AND_LIMIT_REMAINS');
    expect(result.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({
      state: 'EXCLUDED_CONFIRMED',
      exclusionReason: 'TEST_FIXTURE_EXCLUSION_REASON',
    });
  });
});

describe('AC-002f~j 계산 규칙', () => {
  it('AC-002f 고정 공제: E = 124,000, FIXED 10,000, PER_VISIT_PAYOUT 250,000 -> P = 114,000', () => {
    const result = runEstimate(caseInput({ groups: CASE_A }));
    expect(result.groups[0]).toMatchObject({ E: 124_000, D: 10_000, L: 250_000, P: 114_000 });
  });

  it('AC-002g 한도 순서: 400,000원 치료 하나 -> P = min(390,000, 250,000) = 250,000, 본인 부담 150,000 (240,000 이 아님)', () => {
    const lines = [makeLine('T-BIG', 400_000)];
    const result = runEstimate(caseInput({ groups: CASE_A, lines }));
    expect(result.groups[0]).toMatchObject({ E: 400_000, P: 250_000 });
    expect(result.amounts).toMatchObject({ expectedInsurancePayout: 250_000, expectedOutOfPocketAfterPayout: 150_000 });
  });

  it('AC-002h 작은 비용: 물리치료(4,000)만 -> P = 0, 명목 D = 10,000, 실제 D = 4,000, 본인 부담 4,000, 전체 ESTIMATED, 0원과 근거가 함께', () => {
    const lines = [makeLine(T_PHYSIO, 4_000)];
    const result = runEstimate(caseInput({ groups: CASE_A, lines }));
    expect(result.state).toBe('ESTIMATED');
    expect(result.groups[0]).toMatchObject({ E: 4_000, D: 10_000, D_applied: 4_000, P: 0 });
    expect(result.amounts).toMatchObject({ expectedInsurancePayout: 0, expectedOutOfPocketAfterPayout: 4_000 });
    expect(result.basis.steps).toHaveLength(1);
    expect(result.basis.steps[0]).toMatchObject({ groupKey: G_ONE, E: 4_000, D: 10_000, D_applied: 4_000, P: 0 });
  });

  it('AC-002i 공제 1회: X-ray 와 물리치료를 같은 그룹 FIXED 10,000 -> E = 14,000 에서 한 번만 공제해 P = 4,000', () => {
    const lines = [makeLine(T_XRAY, 10_000), makeLine(T_PHYSIO, 4_000)];
    const result = runEstimate(caseInput({ groups: CASE_A, lines }));
    expect(result.groups[0]).toMatchObject({ E: 14_000, D: 10_000, P: 4_000 });
  });

  it('AC-002j 줄 단위 지급액 없음: 세 치료가 같은 그룹이면 E = 84,000 에서 공제는 한 번, P = 74,000 = 예상 보험금', () => {
    const lines = [makeLine(T_XRAY, 10_000), makeLine(T_ULTRA, 70_000), makeLine(T_PHYSIO, 4_000)];
    const result = runEstimate(caseInput({ groups: CASE_A, lines }));
    expect(result.groups[0]).toMatchObject({ E: 84_000, P: 74_000 });
    expect(result.amounts.expectedInsurancePayout).toBe(74_000); // 치료마다 공제했다면 60,000
    const allowed = ['treatmentId', 'displayName', 'benefitType', 'patientAmount', 'isBaseFee', 'origin', 'state', 'groupKey'].sort();
    for (const line of result.lines) {
      expect(Object.keys(line).sort()).toEqual(allowed);
      expect(Object.keys(line).filter((key) => /payout|insurance|deduct/i.test(key))).toEqual([]);
    }
    expect(result.excludedItems).toEqual([]);
  });
});

describe('AC-006c 결과 수준: 중복된 치료 ID 는 한 번만 계산된다', () => {
  it('중복 입력에서 estimate().amounts.hospitalPayment = 124,000, 그룹 E 도 124,000', () => {
    const lines = exampleLines();
    const input = caseInput({
      groups: CASE_A,
      lines: [...lines, lines[0]!, lines[1]!],
      input: { treatmentIds: [...lines.map((line) => line.treatmentId), T_XRAY, T_ULTRA, T_XRAY] },
    });
    const result = runEstimate(input);
    expect(result.amounts.hospitalPayment).toBe(124_000);
    expect(result.groups[0]).toMatchObject({ E: 124_000, P: 114_000 });
    expect(result.lines).toHaveLength(4);
  });
});

describe('AC-006d 원인은 금액 계산에 쓰이지 않는다 (형식 부분은 types.test.ts)', () => {
  const run = (extra: Record<string, unknown>) => {
    const outcome = estimate({ ...caseInput({ groups: CASE_A }), ...extra } as EstimateInput, { digest: testDigest });
    return JSON.stringify(outcome);
  };

  it('원인 INJURY / ILLNESS / UNKNOWN 이 입력에 섞여 들어와도 결과가 바이트 단위로 같다', () => {
    const base = run({});
    for (const cause of ['INJURY', 'ILLNESS', 'UNKNOWN']) {
      expect(run({ cause })).toBe(base);
    }
  });
});

describe('AC-006e 원인 UNKNOWN 은 보류 사유가 아니다', () => {
  it('계산 가능한 입력은 ON_HOLD 가 아니고 holdReasons 가 비어 있다', () => {
    const result = runEstimate(caseInput({ groups: CASE_A }));
    expect(result.state).not.toBe('ON_HOLD');
    expect(result.holdReasons).toEqual([]);
  });
});

describe('그룹 정의가 하나뿐이어도 사용되지 않은 그룹은 groups[] 에 나오지 않는다', () => {
  it('프로필에 그룹이 셋이어도 줄이 있는 그룹만 결과에 나온다', () => {
    const groups = [
      group('TEST_GROUP_UNUSED_1', { kind: 'FIXED', fixed: 1 }, perVisit(1)),
      ...CASE_A,
      group('TEST_GROUP_UNUSED_2', { kind: 'FIXED', fixed: 1 }, perVisit(1)),
    ];
    const result = runEstimate(caseInput({ groups, assign: Object.fromEntries(exampleLines().map((line) => [line.treatmentId, G_ONE])) }));
    expect(result.groups.map((entry) => entry.groupKey)).toEqual([G_ONE]);
  });
});
