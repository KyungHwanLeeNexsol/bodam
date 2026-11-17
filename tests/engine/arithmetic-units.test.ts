import { describe, expect, it } from 'vitest';
import { BASIS_POINTS_SCALE, ROUNDING_HALF } from '../../src/engine/constants';
import { appliedDeduction, computeNominalDeduction } from '../../src/engine/deduction';
import { allocatePool, groupPayout, isRemainingLimitAssumed, limitAmount } from '../../src/engine/limit';
import { applyRounding, floorDivide } from '../../src/engine/rounding';
import { sumGroupShares } from '../../src/engine/sum';
import type { DeductionRule, LimitRule } from '../../src/engine/types';
import { oracleNominalDeduction, oraclePool } from '../fixtures/engine/oracle.fixture';
import { makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다. 공제 방식 이름만 SPEC 의 닫힌 목록과 같다.

describe('constants — 척도 상수 (DD-02)', () => {
  it('B = 10000, H = 5000 (B 의 절반)', () => {
    expect(BASIS_POINTS_SCALE).toBe(10000);
    expect(ROUNDING_HALF).toBe(5000);
    expect(ROUNDING_HALF * 2).toBe(BASIS_POINTS_SCALE);
  });
});

describe('floorDivide — 정확한 내림 나눗셈', () => {
  it.each([
    [0, 10000, 0],
    [9999, 10000, 0],
    [10000, 10000, 1],
    [9007199254739999, 10000, 900719925473], // .9999 — 부동소수점 나눗셈이면 올림될 수 있는 값
    [9007199254740000, 10000, 900719925474],
    [9007199254740991, 10000, 900719925474],
  ])('floor(%i / %i) = %i', (value, divisor, expected) => {
    expect(floorDivide(value, divisor)).toBe(expected);
  });
});

describe('applyRounding — TRUNCATE 는 버림, ROUND_HALF_UP 은 5000 을 더한 뒤 버림 (AC-003b)', () => {
  it('TRUNCATE: 4999 -> 0, 5000 -> 0, 9999 -> 0, 10000 -> 1, 12345 -> 1', () => {
    for (const [value, expected] of [[4999, 0], [5000, 0], [9999, 0], [10000, 1], [12345, 1]] as const) {
      expect(applyRounding(value, 'TRUNCATE')).toEqual({ ok: true, value: expected });
    }
  });

  it('ROUND_HALF_UP: 4999 -> 0, 5000 -> 1, 14999 -> 1, 15000 -> 2 (경계 쌍)', () => {
    for (const [value, expected] of [[4999, 0], [5000, 1], [14999, 1], [15000, 2]] as const) {
      expect(applyRounding(value, 'ROUND_HALF_UP')).toEqual({ ok: true, value: expected });
    }
  });

  it('ROUND_HALF_UP 의 덧셈이 S 를 넘으면 ROUND_ADD 로 거절한다 (곱 9007199254740000 은 TRUNCATE 에서 정상)', () => {
    expect(applyRounding(9007199254740000, 'ROUND_HALF_UP')).toEqual({ ok: false, reason: 'OVERFLOW', step: 'ROUND_ADD' });
    expect(applyRounding(9007199254740000, 'TRUNCATE')).toEqual({ ok: true, value: 900719925474 });
    expect(applyRounding(9007199254730000, 'ROUND_HALF_UP')).toEqual({ ok: true, value: 900719925473 });
  });
});

describe('computeNominalDeduction — 닫힌 공제 방식 네 가지 (DD-02)', () => {
  const shares = (G: number, N: number) => ({ G, N, E: G + N });

  it('FIXED: D = fixed (비율 곱 없음)', () => {
    expect(computeNominalDeduction({ kind: 'FIXED', fixed: 10_000 }, shares(100, 900))).toEqual({ ok: true, D: 10_000 });
  });

  it('RATE_WITH_FIXED_FLOOR: D = max(fixed, round(rate × E))', () => {
    const rule = (rounding: 'TRUNCATE' | 'ROUND_HALF_UP'): DeductionRule => ({
      kind: 'RATE_WITH_FIXED_FLOOR',
      fixed: 100,
      rate: 2500,
      rounding,
    });
    // rate × E = 2500 × 1001 = 2502500 -> /10000 = 250.25
    expect(computeNominalDeduction(rule('TRUNCATE'), shares(1001, 0))).toEqual({ ok: true, D: 250 });
    expect(computeNominalDeduction(rule('ROUND_HALF_UP'), shares(1001, 0))).toEqual({ ok: true, D: 250 });
    // 2500 × 1002 = 2505000 -> 250.5: TRUNCATE 250, ROUND_HALF_UP 251
    expect(computeNominalDeduction(rule('TRUNCATE'), shares(1002, 0))).toEqual({ ok: true, D: 250 });
    expect(computeNominalDeduction(rule('ROUND_HALF_UP'), shares(1002, 0))).toEqual({ ok: true, D: 251 });
    // 바닥: 비율 공제가 fixed 보다 작으면 fixed
    expect(computeNominalDeduction(rule('TRUNCATE'), shares(100, 0))).toEqual({ ok: true, D: 100 });
  });

  it('SPLIT_RATE_WITH_FIXED_FLOOR: 두 곱의 합에 한 번만 반올림한다 (곱마다 반올림하지 않는다)', () => {
    const rule: DeductionRule = {
      kind: 'SPLIT_RATE_WITH_FIXED_FLOOR',
      fixed: 0,
      rateBenefit: 5000,
      rateNonBenefit: 5000,
      rounding: 'ROUND_HALF_UP',
    };
    // 곱마다 반올림하면 (5000+5000)/10000 = 1 이 두 번 -> 2. 합에 한 번이면 (10000+5000)/10000 = 1.
    expect(computeNominalDeduction(rule, shares(1, 1))).toEqual({ ok: true, D: 1 });
    expect(oracleNominalDeduction(rule, 1n, 1n)).toBe(1n);
  });

  it('CAPPED_RATE_WITH_FIXED_FLOOR: D = min(E, max(fixed, round(rate × E)))', () => {
    const rule: DeductionRule = { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 10_000, rate: 2000, rounding: 'TRUNCATE' };
    expect(computeNominalDeduction(rule, shares(4_000, 0))).toEqual({ ok: true, D: 4_000 }); // E 보다 크면 E 로 자른다
    expect(computeNominalDeduction(rule, shares(14_000, 0))).toEqual({ ok: true, D: 10_000 });
    expect(computeNominalDeduction(rule, shares(110_000, 0))).toEqual({ ok: true, D: 22_000 });
  });

  it('모든 방식에서 BigInt 오라클과 같다 (고정 격자)', () => {
    const rules: DeductionRule[] = [
      { kind: 'FIXED', fixed: 777 },
      { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 500, rate: 3333, rounding: 'TRUNCATE' },
      { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 500, rate: 3333, rounding: 'ROUND_HALF_UP' },
      { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 500, rateBenefit: 1234, rateNonBenefit: 4321, rounding: 'TRUNCATE' },
      { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 500, rateBenefit: 1234, rateNonBenefit: 4321, rounding: 'ROUND_HALF_UP' },
      { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 500, rate: 9999, rounding: 'ROUND_HALF_UP' },
    ];
    for (const rule of rules) {
      for (const G of [0, 1, 17, 4_999, 123_457]) {
        for (const N of [0, 3, 50_001, 987_654]) {
          const result = computeNominalDeduction(rule, shares(G, N));
          expect(result).toEqual({ ok: true, D: Number(oracleNominalDeduction(rule, BigInt(G), BigInt(N))) });
        }
      }
    }
  });

  describe('실패 단계 이름 (DD-24 검사 연산 순서)', () => {
    const rate = (rate: number, rounding: 'TRUNCATE' | 'ROUND_HALF_UP'): DeductionRule => ({
      kind: 'RATE_WITH_FIXED_FLOOR',
      fixed: 10_000,
      rate,
      rounding,
    });
    const split = (rounding: 'TRUNCATE' | 'ROUND_HALF_UP', rateBenefit = 10000, rateNonBenefit = 10000): DeductionRule => ({
      kind: 'SPLIT_RATE_WITH_FIXED_FLOOR',
      fixed: 10_000,
      rateBenefit,
      rateNonBenefit,
      rounding,
    });

    it.each([
      ['1b RATE TRUNCATE 10000', rate(10000, 'TRUNCATE'), shares(900719925475, 0), 'RATE_PRODUCT'],
      ['2b RATE TRUNCATE 2000', rate(2000, 'TRUNCATE'), shares(4503599627371, 0), 'RATE_PRODUCT'],
      ['3b RATE HALF_UP 10000 (곱은 안전, + H 에서 넘침)', rate(10000, 'ROUND_HALF_UP'), shares(900719925474, 0), 'ROUND_ADD'],
      ['3c RATE HALF_UP 10000 (곱이 먼저 넘침)', rate(10000, 'ROUND_HALF_UP'), shares(900719925475, 0), 'RATE_PRODUCT'],
      ['4b RATE HALF_UP 2000', rate(2000, 'ROUND_HALF_UP'), shares(4503599627368, 0), 'ROUND_ADD'],
      ['5a CAPPED TRUNCATE', { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 10_000, rate: 10000, rounding: 'TRUNCATE' } as DeductionRule, shares(900719925475, 0), 'RATE_PRODUCT'],
      ['6b SPLIT TRUNCATE (곱은 안전, 합에서 넘침)', split('TRUNCATE'), shares(450359962737, 450359962738), 'SPLIT_SUM'],
      ['7b SPLIT HALF_UP (합은 안전, + H 에서 넘침)', split('ROUND_HALF_UP'), shares(450359962737, 450359962737), 'ROUND_ADD'],
      ['8a SPLIT 급여 곱 하나가 넘침', split('TRUNCATE'), shares(900719925475, 0), 'SPLIT_PRODUCT_BENEFIT'],
      ['8b SPLIT 비급여 곱 하나가 넘침', split('ROUND_HALF_UP'), shares(0, 900719925475), 'SPLIT_PRODUCT_NON_BENEFIT'],
      ['8b-2 둘 다 넘치면 먼저 평가하는 급여 곱', split('TRUNCATE'), shares(900719925475, 900719925475), 'SPLIT_PRODUCT_BENEFIT'],
    ] as const)('%s -> %s', (_name, rule, input, step) => {
      expect(computeNominalDeduction(rule as DeductionRule, input)).toEqual({ ok: false, step });
    });

    it.each([
      ['1a', rate(10000, 'TRUNCATE'), shares(900719925474, 0)],
      ['2a', rate(2000, 'TRUNCATE'), shares(4503599627370, 0)],
      ['3a', rate(10000, 'ROUND_HALF_UP'), shares(900719925473, 0)],
      ['4a', rate(2000, 'ROUND_HALF_UP'), shares(4503599627367, 0)],
      ['4c TRUNCATE 에서는 정상', rate(2000, 'TRUNCATE'), shares(4503599627368, 0)],
      ['6a', split('TRUNCATE'), shares(450359962737, 450359962737)],
      ['7a', split('ROUND_HALF_UP'), shares(450359962736, 450359962737)],
      ['9a 비율 0 이면 E 가 커도 넘치지 않음', rate(0, 'ROUND_HALF_UP'), shares(900719925475, 0)],
      ['9b 한쪽 비율이 0 이면 그 몫이 커도 넘치지 않음', split('TRUNCATE', 0, 10000), shares(900719925475, 0)],
    ])('정상 행 %s 는 오라클과 같다', (_name, rule, input) => {
      const result = computeNominalDeduction(rule, input);
      expect(result).toEqual({ ok: true, D: Number(oracleNominalDeduction(rule, BigInt(input.G), BigInt(input.N))) });
    });
  });
});

describe('appliedDeduction — D_applied = min(D, E)', () => {
  it('D 가 E 보다 크면 E, 아니면 D', () => {
    expect(appliedDeduction(10_000, 4_000)).toBe(4_000);
    expect(appliedDeduction(10_000, 10_000)).toBe(10_000);
    expect(appliedDeduction(10_000, 84_000)).toBe(10_000);
  });
});

describe('limit — 한도 값과 그룹 지급액 (DD-02)', () => {
  const rules: Array<[string, LimitRule, number | 'UNLIMITED', boolean]> = [
    ['PER_VISIT_PAYOUT', { kind: 'PER_VISIT_PAYOUT', amount: 250_000, limitBasis: 'PAYOUT' }, 250_000, false],
    ['PER_ACCIDENT', { kind: 'PER_ACCIDENT', amount: 300_000, limitBasis: 'PAYOUT' }, 300_000, true],
    ['ANNUAL', { kind: 'ANNUAL', amount: 400_000, limitBasis: 'PAYOUT' }, 400_000, true],
    ['COUNT', { kind: 'COUNT', perUseAmount: 50_000, limitBasis: 'PAYOUT' }, 50_000, true],
    ['UNLIMITED_DECLARED', { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'TEST_FIXTURE_CLAUSE' }, 'UNLIMITED', false],
  ];

  it.each(rules)('%s: L 과 잔여 한도 가정 여부', (_name, rule, expectedL, assumed) => {
    expect(limitAmount(rule)).toBe(expectedL);
    expect(isRemainingLimitAssumed(rule)).toBe(assumed);
  });

  it('P = min(max(E − D, 0), L): 한도가 공제 뒤에 적용된다 (AC-002g)', () => {
    expect(groupPayout(400_000, 10_000, 250_000)).toBe(250_000); // 390,000 이 아니라 한도 250,000
    expect(groupPayout(124_000, 10_000, 250_000)).toBe(114_000);
    expect(groupPayout(4_000, 10_000, 250_000)).toBe(0); // E − D 가 음수이면 0
    expect(groupPayout(124_000, 24_800, 'UNLIMITED')).toBe(99_200);
    expect(groupPayout(100, 0, 0)).toBe(0);
  });
});

describe('allocatePool — groupOrder 순서의 공유 한도 배분 (AC-003f)', () => {
  it('앞선 그룹이 먼저 채우고 남은 한도만 다음 그룹이 받는다', () => {
    expect(allocatePool([60_000, 50_000], 100_000)).toEqual([60_000, 40_000]);
    expect(allocatePool([50_000, 60_000], 100_000)).toEqual([50_000, 50_000]);
    expect(allocatePool([120_000, 10_000], 100_000)).toEqual([100_000, 0]);
  });

  it('총합은 순서와 무관하게 min(Σ P, 풀 한도)이고 각 몫은 P 이하이며 음수가 아니다', () => {
    const payouts = [30_000, 80_000, 5_000, 0, 41_000];
    for (const limit of [0, 1, 50_000, 100_000, 155_999, 156_000, 500_000]) {
      const pooled = allocatePool(payouts, limit);
      const reversed = allocatePool([...payouts].reverse(), limit);
      const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
      expect(sum(pooled)).toBe(Math.min(sum(payouts), limit));
      expect(sum(reversed)).toBe(sum(pooled));
      pooled.forEach((value, index) => {
        expect(value).toBeLessThanOrEqual(payouts[index] as number);
        expect(value).toBeGreaterThanOrEqual(0);
      });
      expect(pooled.map(BigInt)).toEqual(oraclePool(payouts.map(BigInt), BigInt(limit)));
    }
  });

  it('UNLIMITED 풀은 P_pooled = P 다', () => {
    expect(allocatePool([30_000, 80_000], 'UNLIMITED')).toEqual([30_000, 80_000]);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const payouts = [30_000, 80_000];
    allocatePool(payouts, 50_000);
    expect(payouts).toEqual([30_000, 80_000]);
  });
});

describe('sumGroupShares — 그룹의 급여 몫 G, 비급여 몫 N, 합계 E', () => {
  it('급여·비급여 줄을 나누어 더한다 (E = G + N)', () => {
    const lines = [
      makeLine('A', 10_000, { benefitType: 'BENEFIT' }),
      makeLine('B', 70_000, { benefitType: 'NON_BENEFIT' }),
      makeLine('C', 4_000, { benefitType: 'BENEFIT' }),
    ];
    expect(sumGroupShares(lines)).toEqual({ G: 14_000, N: 70_000, E: 84_000 });
  });

  it('줄이 없으면 모두 0 이다', () => {
    expect(sumGroupShares([])).toEqual({ G: 0, N: 0, E: 0 });
  });
});
