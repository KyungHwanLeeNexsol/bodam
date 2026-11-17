import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import type { DeductionRule, EstimateResult, LimitRule } from '../../src/engine/types';
import { oracleGroup } from '../fixtures/engine/oracle.fixture';
import {
  CASE_A,
  UNLIMITED,
  caseInput,
  group,
  perVisit,
  runEstimate,
} from '../fixtures/engine/cases.fixture';
import { T_INJECT, T_ULTRA, T_XRAY, makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다. AC-003a~g (규칙 모양의 경계) 를 estimate() 수준에서 시험한다.

function loose<T>(value: unknown): T {
  return value as T;
}

const G1 = 'TEST_GROUP_ONE';
const G2 = 'TEST_GROUP_TWO';

/** 항상 정상인 두 번째 그룹. 값 결함이 다른 그룹에 퍼지지 않는지 볼 때 쓴다. */
const HEALTHY = group(G2, { kind: 'FIXED', fixed: 1_000 }, perVisit(100_000));

function expectHeld(result: EstimateResult, code: string): void {
  expect(result.state).toBe('ON_HOLD');
  expect(result.amounts.expectedInsurancePayout).toBeNull();
  expect(result.amounts.expectedOutOfPocketAfterPayout).toBeNull();
  expect(result.amounts.hospitalPayment).toBe(124_000); // 보류여도 병원 결제액은 숫자다
  expect(result.holdReasons.every((entry) => entry.code === code)).toBe(true);
}

describe('AC-003a 비율 규칙에 rounding 이 없으면 기본 처리 방식으로 계산하지 않고 보류한다', () => {
  it.each([
    ['RATE_WITH_FIXED_FLOOR', { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 2000 }],
    ['CAPPED_RATE_WITH_FIXED_FLOOR', { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 2000 }],
    ['SPLIT_RATE_WITH_FIXED_FLOOR', { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rateBenefit: 1000, rateNonBenefit: 2000 }],
  ])('%s: 그 그룹의 줄이 PROFILE_VALUE_MISSING 으로 보류되고 전체가 ON_HOLD', (_name, rule) => {
    const result = runEstimate(caseInput({ groups: [group(G1, loose<DeductionRule>(rule), UNLIMITED)] }));
    expectHeld(result, 'PROFILE_VALUE_MISSING');
    expect(result.lines.every((line) => line.state === 'ON_HOLD' && line.holdReason === 'PROFILE_VALUE_MISSING')).toBe(true);
    expect(result.groups[0]).toMatchObject({ state: 'ON_HOLD', holdReason: 'PROFILE_VALUE_MISSING', D: null, P: null, P_pooled: null });
  });
});

describe('AC-003b 원 단위 처리: TRUNCATE 는 버림, ROUND_HALF_UP 은 5000 을 더한 뒤 버림', () => {
  const rate = (rounding: 'TRUNCATE' | 'ROUND_HALF_UP'): DeductionRule => ({
    kind: 'RATE_WITH_FIXED_FLOOR',
    fixed: 100,
    rate: 2500,
    rounding,
  });
  const run = (deduction: DeductionRule, lines = [makeLine(T_XRAY, 1_002)]) =>
    runEstimate(caseInput({ groups: [group(G1, deduction, UNLIMITED)], lines }));

  it('원 미만 단수(250.5)에서 두 방식의 결과가 갈린다', () => {
    const truncated = run(rate('TRUNCATE'));
    const rounded = run(rate('ROUND_HALF_UP'));
    expect(truncated.groups[0]).toMatchObject({ D: 250, P: 752 });
    expect(rounded.groups[0]).toMatchObject({ D: 251, P: 751 });
    const oracle = oracleGroup(rate('ROUND_HALF_UP'), UNLIMITED, 1002n, 0n);
    expect(rounded.groups[0]).toMatchObject({ D: Number(oracle.D), P: Number(oracle.P) });
  });

  it('SPLIT 은 두 곱의 합에 한 번만 적용한다 (곱마다 반올림하면 결과가 달라지는 입력)', () => {
    const split: DeductionRule = { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 0, rateBenefit: 5000, rateNonBenefit: 5000, rounding: 'ROUND_HALF_UP' };
    const lines = [makeLine(T_XRAY, 1, { benefitType: 'BENEFIT' }), makeLine(T_ULTRA, 1, { benefitType: 'NON_BENEFIT' })];
    const result = run(split, lines);
    // 합: 5000 + 5000 = 10000, + 5000 -> 15000 -> 1. 곱마다 반올림하면 1 + 1 = 2.
    expect(result.groups[0]).toMatchObject({ G: 1, N: 1, E: 2, D: 1, P: 1 });
  });
});

describe('AC-003c 닫힌 목록 밖의 공제 방식, 또는 limitBasis = COVERED_COST -> PROFILE_FORMULA_UNSUPPORTED', () => {
  it('닫힌 목록 밖의 공제 방식은 계산하지 않고 그 그룹을 보류한다', () => {
    const result = runEstimate(caseInput({ groups: [group(G1, loose<DeductionRule>({ kind: 'TIERED_BY_AGE', fixed: 1 }), UNLIMITED)] }));
    expectHeld(result, 'PROFILE_FORMULA_UNSUPPORTED');
  });

  it.each(['PER_VISIT_PAYOUT', 'PER_ACCIDENT', 'ANNUAL'])('%s 의 limitBasis = COVERED_COST 는 계산하지 않고 보류한다', (kind) => {
    const limit = loose<LimitRule>({ kind, amount: 100_000, limitBasis: 'COVERED_COST' });
    const result = runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 1_000 }, limit)] }));
    expectHeld(result, 'PROFILE_FORMULA_UNSUPPORTED');
  });

  it('COUNT 의 COVERED_COST 도 마찬가지다', () => {
    const limit = loose<LimitRule>({ kind: 'COUNT', perUseAmount: 100_000, limitBasis: 'COVERED_COST' });
    expectHeld(runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 1_000 }, limit)] })), 'PROFILE_FORMULA_UNSUPPORTED');
  });
});

describe('AC-003d PER_ACCIDENT, ANNUAL, COUNT 한도는 적용되고 REMAINING_LIMIT_ASSUMED 가정이 붙는다', () => {
  const limits: Array<[string, LimitRule, number]> = [
    ['PER_ACCIDENT', { kind: 'PER_ACCIDENT', amount: 50_000, limitBasis: 'PAYOUT' }, 50_000],
    ['ANNUAL', { kind: 'ANNUAL', amount: 60_000, limitBasis: 'PAYOUT' }, 60_000],
    ['COUNT', { kind: 'COUNT', perUseAmount: 70_000, limitBasis: 'PAYOUT' }, 70_000],
  ];

  it.each(limits)('%s: 한도가 적용된다', (_name, limit, cap) => {
    const result = runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 10_000 }, limit)] }));
    expect(result.groups[0]).toMatchObject({ L: cap, P: cap });
    expect(result.amounts.expectedInsurancePayout).toBe(cap);
    expect(result.assumptions).toContain('REMAINING_LIMIT_ASSUMED');
  });

  it('PER_VISIT_PAYOUT 과 UNLIMITED_DECLARED 는 잔여 한도 가정을 내지 않는다', () => {
    for (const limit of [perVisit(50_000), UNLIMITED]) {
      const result = runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 10_000 }, limit)] }));
      expect(result.assumptions).not.toContain('REMAINING_LIMIT_ASSUMED');
    }
  });

  it('보류 결과에는 잔여 한도 가정을 싣지 않는다 (보험금을 보이지 않으므로)', () => {
    const result = runEstimate(
      caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 10_000 }, limits[0]![1]), group(G2, loose<DeductionRule>({ kind: 'X' }), UNLIMITED)], assign: { [T_XRAY]: G1, [T_ULTRA]: G2 } }),
    );
    expect(result.state).toBe('ON_HOLD');
    expect(result.assumptions).toEqual(['PERSONAL_CONTRACT_NOT_CONFIRMED']);
  });
});

describe('AC-003e UNLIMITED_DECLARED 에 조항 참조가 없으면 PROFILE_SOURCE_INCOMPLETE', () => {
  it.each([
    ['조항 참조 필드 없음', { kind: 'UNLIMITED_DECLARED' }],
    ['빈 문자열', { kind: 'UNLIMITED_DECLARED', policyClauseRef: '' }],
  ])('%s', (_name, limit) => {
    const result = runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 1_000 }, loose<LimitRule>(limit))] }));
    expectHeld(result, 'PROFILE_SOURCE_INCOMPLETE');
  });
});

describe('AC-003g 프로필 값이 무효이면 그 그룹만 PROFILE_VALUE_INVALID, 없거나 null 이면 PROFILE_VALUE_MISSING', () => {
  const bad = [
    ['음수', -1],
    ['소수', 1000.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['문자열', '1000'],
    ['MAX_AMOUNT_WON 초과', MAX_AMOUNT_WON + 1],
  ] as const;

  it.each(bad)('고정 공제 금액이 %s 이면 그 그룹만 보류하고 다른 그룹은 정상 계산한다 (0·기본값으로 계산하지 않는다)', (_name, value) => {
    const result = runEstimate(
      caseInput({
        groups: [group(G1, loose<DeductionRule>({ kind: 'FIXED', fixed: value }), UNLIMITED), HEALTHY],
        assign: { [T_XRAY]: G1, [T_ULTRA]: G2, [T_INJECT]: G2 },
      }),
    );
    expect(result.state).toBe('ON_HOLD');
    expect(result.amounts.hospitalPayment).toBe(124_000);
    expect(result.groups.find((entry) => entry.groupKey === G1)).toMatchObject({ state: 'ON_HOLD', holdReason: 'PROFILE_VALUE_INVALID', D: null, P: null });
    expect(result.groups.find((entry) => entry.groupKey === G2)).toMatchObject({ state: 'ESTIMATED', E: 110_000 });
    expect(result.referenceGroups.map((entry) => entry.groupKey)).toEqual([G2]);
    expect(result.lines.find((line) => line.treatmentId === T_XRAY)).toMatchObject({ state: 'ON_HOLD', holdReason: 'PROFILE_VALUE_INVALID' });
  });

  it.each([
    ['비율이 0 미만', -1],
    ['비율이 10000 초과', 10001],
  ])('%s -> PROFILE_VALUE_INVALID', (_name, rate) => {
    const rule = loose<DeductionRule>({ kind: 'RATE_WITH_FIXED_FLOOR', fixed: 0, rate, rounding: 'TRUNCATE' });
    expectHeld(runEstimate(caseInput({ groups: [group(G1, rule, UNLIMITED)] })), 'PROFILE_VALUE_INVALID');
  });

  it('값이 없거나 null 이면 PROFILE_VALUE_MISSING', () => {
    for (const fixed of [undefined, null]) {
      expectHeld(runEstimate(caseInput({ groups: [group(G1, loose<DeductionRule>({ kind: 'FIXED', fixed }), UNLIMITED)] })), 'PROFILE_VALUE_MISSING');
    }
  });

  it('한도 금액이 무효이면 PROFILE_VALUE_INVALID', () => {
    const limit = loose<LimitRule>({ kind: 'PER_VISIT_PAYOUT', amount: -5, limitBasis: 'PAYOUT' });
    expectHeld(runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 1_000 }, limit)] })), 'PROFILE_VALUE_INVALID');
  });

  it('경계값 MAX_AMOUNT_WON, 비율 10000, 0 은 유효하다', () => {
    const maxFixed = runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: MAX_AMOUNT_WON }, UNLIMITED)] }));
    expect(maxFixed.state).toBe('ESTIMATED');
    expect(maxFixed.groups[0]).toMatchObject({ D: MAX_AMOUNT_WON, D_applied: 124_000, P: 0 });
    for (const rate of [0, 10000]) {
      const result = runEstimate(
        caseInput({ groups: [group(G1, { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 0, rate, rounding: 'TRUNCATE' }, UNLIMITED)] }),
      );
      expect(result.state).toBe('ESTIMATED');
      expect(result.groups[0]).toMatchObject({ D: rate === 0 ? 0 : 124_000 });
    }
    const maxLimit = runEstimate(caseInput({ groups: [group(G1, { kind: 'FIXED', fixed: 0 }, perVisit(MAX_AMOUNT_WON))] }));
    expect(maxLimit.groups[0]).toMatchObject({ L: MAX_AMOUNT_WON, P: 124_000 });
  });

  it('무효 값을 가진 입력 프로필 객체를 고치지 않는다', () => {
    const input = caseInput({ groups: [group(G1, loose<DeductionRule>({ kind: 'FIXED', fixed: -1 }), UNLIMITED)] });
    const before = JSON.stringify(input);
    runEstimate(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('기준선: 정상 규칙 (CASE_A) 은 보류 없이 계산된다', () => {
  it('대조', () => {
    expect(runEstimate(caseInput({ groups: CASE_A })).state).toBe('ESTIMATED');
  });
});
