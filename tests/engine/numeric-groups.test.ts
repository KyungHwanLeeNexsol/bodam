import { describe, expect, it } from 'vitest';
import { groupPayout } from '../../src/engine/limit';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import { estimate } from '../../src/engine/estimate';
import type { DeductionRule, FailedStepName, PublishedLine } from '../../src/engine/types';
import { oracleGroup } from '../fixtures/engine/oracle.fixture';
import { UNLIMITED, caseInput, group, perVisit, runEstimate } from '../fixtures/engine/cases.fixture';
import { T_PHYSIO, T_ULTRA, T_XRAY, makeLine } from '../fixtures/engine/lines.fixture';
import { testDigest } from '../fixtures/engine/profiles.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.
// AC-003h: 공제 방식 x 원 단위 처리 x 비율마다 다른 계산 범위 경계. 표의 수는 S = 9007199254740991 에서만 유도한 정확한 정수이며
// 줄 수는 가져온 MAX_AMOUNT_WON 에서 올림으로 계산한다(시험에 하드코딩하지 않는다).

const G1 = 'TEST_GROUP_ONE';
const S = Number.MAX_SAFE_INTEGER;

/** total 원을 줄 하나가 MAX_AMOUNT_WON 을 넘지 않는 줄들로 나눈다. */
function linesFor(total: number, benefitType: 'BENEFIT' | 'NON_BENEFIT', prefix: string): PublishedLine[] {
  const count = Math.ceil(total / MAX_AMOUNT_WON);
  return Array.from({ length: count }, (_unused, index) => {
    const amount = index < count - 1 ? MAX_AMOUNT_WON : total - (count - 1) * MAX_AMOUNT_WON;
    return makeLine(`${prefix}-${String(index).padStart(6, '0')}`, amount, { benefitType });
  });
}

const rate = (rate: number, rounding: 'TRUNCATE' | 'ROUND_HALF_UP', kind: 'RATE_WITH_FIXED_FLOOR' | 'CAPPED_RATE_WITH_FIXED_FLOOR' = 'RATE_WITH_FIXED_FLOOR'): DeductionRule => ({
  kind,
  fixed: 10_000,
  rate,
  rounding,
});
const split = (rounding: 'TRUNCATE' | 'ROUND_HALF_UP', rateBenefit: number, rateNonBenefit: number): DeductionRule => ({
  kind: 'SPLIT_RATE_WITH_FIXED_FLOOR',
  fixed: 10_000,
  rateBenefit,
  rateNonBenefit,
  rounding,
});

interface Row {
  name: string;
  deduction: DeductionRule;
  G: number;
  N: number;
  /** 정상이면 'OK', 아니면 처음 실패한 단계 이름. */
  expect: 'OK' | FailedStepName;
  /** 표에 적힌 정상 행의 기대값(오라클과 별개로 표의 숫자를 그대로 확인한다). */
  table?: { D: number; D_applied: number; P: number };
}

const ROWS: Row[] = [
  { name: '1a RATE TRUNCATE 10000 E = 900719925474', deduction: rate(10000, 'TRUNCATE'), G: 900719925474, N: 0, expect: 'OK', table: { D: 900719925474, D_applied: 900719925474, P: 0 } },
  { name: '1b RATE TRUNCATE 10000 E = 900719925475', deduction: rate(10000, 'TRUNCATE'), G: 900719925475, N: 0, expect: 'RATE_PRODUCT' },
  { name: '2a RATE TRUNCATE 2000 E = 4503599627370', deduction: rate(2000, 'TRUNCATE'), G: 4503599627370, N: 0, expect: 'OK', table: { D: 900719925474, D_applied: 900719925474, P: 3602879701896 } },
  { name: '2b RATE TRUNCATE 2000 E = 4503599627371', deduction: rate(2000, 'TRUNCATE'), G: 4503599627371, N: 0, expect: 'RATE_PRODUCT' },
  { name: '3a RATE HALF_UP 10000 E = 900719925473', deduction: rate(10000, 'ROUND_HALF_UP'), G: 900719925473, N: 0, expect: 'OK', table: { D: 900719925473, D_applied: 900719925473, P: 0 } },
  { name: '3b RATE HALF_UP 10000 E = 900719925474 (곱은 안전, + H 에서 넘침)', deduction: rate(10000, 'ROUND_HALF_UP'), G: 900719925474, N: 0, expect: 'ROUND_ADD' },
  { name: '3c RATE HALF_UP 10000 E = 900719925475 (곱이 먼저 넘침)', deduction: rate(10000, 'ROUND_HALF_UP'), G: 900719925475, N: 0, expect: 'RATE_PRODUCT' },
  { name: '4a RATE HALF_UP 2000 E = 4503599627367', deduction: rate(2000, 'ROUND_HALF_UP'), G: 4503599627367, N: 0, expect: 'OK', table: { D: 900719925473, D_applied: 900719925473, P: 3602879701894 } },
  { name: '4b RATE HALF_UP 2000 E = 4503599627368', deduction: rate(2000, 'ROUND_HALF_UP'), G: 4503599627368, N: 0, expect: 'ROUND_ADD' },
  { name: '4c RATE TRUNCATE 2000 E = 4503599627368 (4b 와 같은 E, TRUNCATE 에서는 정상)', deduction: rate(2000, 'TRUNCATE'), G: 4503599627368, N: 0, expect: 'OK', table: { D: 900719925473, D_applied: 900719925473, P: 3602879701895 } },
  { name: '4c-2 RATE TRUNCATE 2000 E = 4503599627370 (여전히 정상)', deduction: rate(2000, 'TRUNCATE'), G: 4503599627370, N: 0, expect: 'OK' },
  { name: '5a CAPPED TRUNCATE 10000 E = 900719925474', deduction: rate(10000, 'TRUNCATE', 'CAPPED_RATE_WITH_FIXED_FLOOR'), G: 900719925474, N: 0, expect: 'OK', table: { D: 900719925474, D_applied: 900719925474, P: 0 } },
  { name: '5a-2 CAPPED TRUNCATE 10000 E = 900719925475', deduction: rate(10000, 'TRUNCATE', 'CAPPED_RATE_WITH_FIXED_FLOOR'), G: 900719925475, N: 0, expect: 'RATE_PRODUCT' },
  { name: '5b CAPPED HALF_UP 2000 E = 4503599627367', deduction: rate(2000, 'ROUND_HALF_UP', 'CAPPED_RATE_WITH_FIXED_FLOOR'), G: 4503599627367, N: 0, expect: 'OK', table: { D: 900719925473, D_applied: 900719925473, P: 3602879701894 } },
  { name: '5b-2 CAPPED HALF_UP 2000 E = 4503599627368', deduction: rate(2000, 'ROUND_HALF_UP', 'CAPPED_RATE_WITH_FIXED_FLOOR'), G: 4503599627368, N: 0, expect: 'ROUND_ADD' },
  { name: '6a SPLIT TRUNCATE 10000/10000 (G, N) = (450359962737, 450359962737)', deduction: split('TRUNCATE', 10000, 10000), G: 450359962737, N: 450359962737, expect: 'OK', table: { D: 900719925474, D_applied: 900719925474, P: 0 } },
  { name: '6b SPLIT TRUNCATE (G, N) = (450359962737, 450359962738) (곱은 안전, 합에서 넘침)', deduction: split('TRUNCATE', 10000, 10000), G: 450359962737, N: 450359962738, expect: 'SPLIT_SUM' },
  { name: '7a SPLIT HALF_UP (G, N) = (450359962736, 450359962737)', deduction: split('ROUND_HALF_UP', 10000, 10000), G: 450359962736, N: 450359962737, expect: 'OK', table: { D: 900719925473, D_applied: 900719925473, P: 0 } },
  { name: '7b SPLIT HALF_UP (G, N) = (450359962737, 450359962737) (합은 안전, + H 에서 넘침; 6a 와 같은 쌍)', deduction: split('ROUND_HALF_UP', 10000, 10000), G: 450359962737, N: 450359962737, expect: 'ROUND_ADD' },
  { name: '8a SPLIT 급여 곱 하나가 넘침 (TRUNCATE)', deduction: split('TRUNCATE', 10000, 10000), G: 900719925475, N: 0, expect: 'SPLIT_PRODUCT_BENEFIT' },
  { name: '8a-2 SPLIT 급여 곱 하나가 넘침 (HALF_UP)', deduction: split('ROUND_HALF_UP', 10000, 10000), G: 900719925475, N: 0, expect: 'SPLIT_PRODUCT_BENEFIT' },
  { name: '8b SPLIT 비급여 곱 하나가 넘침', deduction: split('TRUNCATE', 10000, 10000), G: 0, N: 900719925475, expect: 'SPLIT_PRODUCT_NON_BENEFIT' },
  { name: '8b-2 SPLIT 둘 다 넘치면 처음 실패한 급여 곱', deduction: split('TRUNCATE', 10000, 10000), G: 900719925475, N: 900719925475, expect: 'SPLIT_PRODUCT_BENEFIT' },
  { name: '9a RATE 비율 0 이면 E 가 커도 정상 (TRUNCATE)', deduction: rate(0, 'TRUNCATE'), G: 900719925475, N: 0, expect: 'OK', table: { D: 10_000, D_applied: 10_000, P: 900719915475 } },
  { name: '9a-2 RATE 비율 0 이면 E 가 커도 정상 (HALF_UP)', deduction: rate(0, 'ROUND_HALF_UP'), G: 900719925475, N: 0, expect: 'OK', table: { D: 10_000, D_applied: 10_000, P: 900719915475 } },
  { name: '9b SPLIT rateBenefit 0 / rateNonBenefit 10000, G = 900719925475, N = 0', deduction: split('TRUNCATE', 0, 10000), G: 900719925475, N: 0, expect: 'OK', table: { D: 10_000, D_applied: 10_000, P: 900719915475 } },
  { name: '9c FIXED 10,000 은 곱이 없어 E = 900719925475 에서도 정상', deduction: { kind: 'FIXED', fixed: 10_000 }, G: 900719925475, N: 0, expect: 'OK', table: { D: 10_000, D_applied: 10_000, P: 900719915475 } },
];

describe('AC-003h 계산 범위 경계 (공제 방식 x 원 단위 처리 x 비율, 엔진 수준)', () => {
  it.each(ROWS)('$name', ({ deduction, G, N, expect: expected, table }) => {
    const lines = [...linesFor(G, 'BENEFIT', 'G'), ...linesFor(N, 'NON_BENEFIT', 'N')];
    const total = G + N;
    const result = runEstimate(caseInput({ groups: [group(G1, deduction, UNLIMITED)], lines }));

    // 예상 병원 결제액은 줄 금액의 정확한 합이다 (잘라 맞추지 않는다).
    expect(result.amounts.hospitalPayment).toBe(total);
    const entry = result.groups[0]!;
    expect(entry).toMatchObject({ groupKey: G1, E: total, G, N });

    if (expected === 'OK') {
      const oracle = oracleGroup(deduction, UNLIMITED, BigInt(G), BigInt(N));
      expect(result.state).toBe('ESTIMATED');
      expect(entry).toMatchObject({
        state: 'ESTIMATED',
        D: Number(oracle.D),
        D_applied: Number(oracle.Dapplied),
        P: Number(oracle.P),
        P_pooled: Number(oracle.P),
      });
      if (table) expect(entry).toMatchObject(table);
      expect(result.amounts.expectedInsurancePayout).toBe(Number(oracle.P));
      expect(result.amounts.expectedOutOfPocketAfterPayout).toBe(total - Number(oracle.P));
    } else {
      expect(result.state).toBe('ON_HOLD');
      expect(entry).toMatchObject({ state: 'ON_HOLD', holdReason: 'CALC_RANGE_EXCEEDED', D: null, D_applied: null, L: null, P: null, P_pooled: null });
      expect(entry.trace[0]?.failedStep).toBe(expected);
      expect(result.basis.steps[0]?.failedStep).toBe(expected);
      expect(result.amounts.expectedInsurancePayout).toBeNull();
      expect(result.amounts.expectedOutOfPocketAfterPayout).toBeNull();
      expect(result.lines.every((line) => line.state === 'ON_HOLD' && line.holdReason === 'CALC_RANGE_EXCEEDED' && !('groupKey' in line))).toBe(true);
    }
  });
});

describe('AC-003h 10행: 줄 금액 합 T', () => {
  it('엔진 수준: 줄 금액은 모두 유효하나 합이 안전 정수를 넘으면 보류가 아니라 INVALID_NUMERIC_INPUT 거절이고 결과 객체가 없다 (합산 함수 시험 대역, 실제 9,007,200줄은 만들지 않는다)', () => {
    const input = caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 10_000 }, UNLIMITED)] });
    const outcome = estimate(input, { digest: testDigest, sum: () => ({ ok: false, reason: 'OVERFLOW', step: 'HOSPITAL_PAYMENT_SUM' }) });
    expect(outcome).toEqual({ ok: false, rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'HOSPITAL_PAYMENT_OVERFLOW' } });
    expect('result' in outcome).toBe(false);
  });

  it('줄을 S 에 가까운 합으로 만들 수 있는 가장 큰 입력(E = S 근처)도 실제 합산 경로로 통과한다: E = 900719925474 는 T 가 안전하다', () => {
    const result = runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 10_000 }, UNLIMITED)], lines: linesFor(900719925474, 'BENEFIT', 'G') }));
    expect(result.amounts.hospitalPayment).toBe(900719925474);
  });

  it('줄 수 계산: ceil((S + 1) / MAX_AMOUNT_WON) 줄이 있어야 T 가 넘친다 (제안값 1,000,000,000 이면 9,007,200줄)', () => {
    expect(Math.ceil((S + 1) / MAX_AMOUNT_WON)).toBe(9_007_200);
  });
});

describe('AC-003h 9c 함수 수준: E = S 에서도 P = S - 10,000', () => {
  it('groupPayout(S, 10,000, UNLIMITED) = 9007199254730991', () => {
    expect(groupPayout(S, 10_000, 'UNLIMITED')).toBe(9007199254730991);
  });
});

describe('AC-003h 11 잘라 맞추지 않음', () => {
  const ONE = group(G1, rate(10000, 'TRUNCATE'), UNLIMITED);
  const TWO = group('TEST_GROUP_TWO', { kind: 'FIXED', fixed: 10_000 }, perVisit(250_000));

  function build(first = ONE) {
    const overflowLines = linesFor(900719925475, 'BENEFIT', 'G');
    const second = [makeLine(T_XRAY, 10_000), makeLine(T_ULTRA, 70_000), makeLine(T_PHYSIO, 4_000)];
    const assign: Record<string, string> = { [T_XRAY]: 'TEST_GROUP_TWO', [T_ULTRA]: 'TEST_GROUP_TWO', [T_PHYSIO]: 'TEST_GROUP_TWO' };
    for (const line of overflowLines) assign[line.treatmentId] = G1;
    return caseInput({ groups: [first, TWO], lines: [...overflowLines, ...second], assign });
  }

  it('첫 그룹만 CALC_RANGE_EXCEEDED 로 보류되고 D·D_applied·P·P_pooled 가 모두 null 이며 둘째 그룹은 정상이다', () => {
    const input = build();
    const profileBefore = JSON.stringify(input.bundle!.profiles);
    const result = runEstimate(input);
    expect(result.state).toBe('ON_HOLD');
    expect(result.groups[0]).toMatchObject({ groupKey: G1, state: 'ON_HOLD', holdReason: 'CALC_RANGE_EXCEEDED', D: null, D_applied: null, P: null, P_pooled: null });
    expect(result.groups[1]).toMatchObject({ groupKey: 'TEST_GROUP_TWO', state: 'ESTIMATED', P: 74_000 });
    expect(result.referenceGroups).toEqual([{ groupKey: 'TEST_GROUP_TWO', P: 74_000, isReference: true }]);
    expect(result.amounts).toMatchObject({ hospitalPayment: 900720009475, expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null });
    // 프로필 객체는 계산 전후 깊은 비교로 같다 (비율 10000 이 줄어들지 않음).
    expect(JSON.stringify(input.bundle!.profiles)).toBe(profileBefore);
    expect(result.groups[0]!.trace[0]).toMatchObject({ D: null, P: null });
  });

  it.each(['TRUNCATE', 'ROUND_HALF_UP'] as const)('같은 E 에서 비율만 9999 로 낮춘 프로필은 %s 모두 정상이고 보류된 결과가 낮춘 비율의 값으로 채워지지 않는다', (rounding) => {
    const lines = linesFor(900719925475, 'BENEFIT', 'G');
    const lowered = rate(9999, rounding);
    const result = runEstimate(caseInput({ groups: [group(G1, lowered, UNLIMITED)], lines }));
    expect(result.groups[0]).toMatchObject({ D: 900629853482, P: 90071993, state: 'ESTIMATED' });
    const original = runEstimate(caseInput({ groups: [group(G1, rate(10000, rounding), UNLIMITED)], lines }));
    expect(original.groups[0]).toMatchObject({ state: 'ON_HOLD', holdReason: 'CALC_RANGE_EXCEEDED', P: null });
  });
});
