import { describe, expect, it } from 'vitest';
import type { CoverageGroupDef, DeductionRule, LimitRule, SharedLimitPool } from '../../src/engine/types';
import { UNLIMITED, caseInput, group, perVisit, runEstimate } from '../fixtures/engine/cases.fixture';
import { T_INJECT, T_ULTRA, T_XRAY, makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다. AC-008m: 프로필 구조 결함과 공유 한도 풀의 값 결함의 영향 범위.

const G1 = 'TEST_GROUP_ONE';
const G2 = 'TEST_GROUP_TWO';
const G3 = 'TEST_GROUP_THREE';
const POOL = 'TEST_POOL_ONE';
const FIXED_10K: DeductionRule = { kind: 'FIXED', fixed: 10_000 };

function loose<T>(value: unknown): T {
  return value as T;
}

// 초음파 70,000 -> G1, 신장분사치료 40,000 -> G2 (둘 다 풀 멤버), X-ray 10,000 -> G3 (풀 밖).
const LINES = [makeLine(T_ULTRA, 70_000), makeLine(T_INJECT, 40_000), makeLine(T_XRAY, 10_000)];
const ASSIGN = { [T_ULTRA]: G1, [T_INJECT]: G2, [T_XRAY]: G3 };

function groupsWithPool(g1: Partial<CoverageGroupDef> = {}): CoverageGroupDef[] {
  return [
    { ...group(G1, FIXED_10K, perVisit(250_000), POOL), ...g1 },
    group(G2, FIXED_10K, perVisit(250_000), POOL),
    group(G3, { kind: 'FIXED', fixed: 1_000 }, perVisit(250_000)),
  ];
}

function run(poolLimit: unknown, g1: Partial<CoverageGroupDef> = {}) {
  const pools: SharedLimitPool[] = [{ poolKey: POOL, limit: loose<LimitRule>(poolLimit) }];
  return runEstimate(caseInput({ groups: groupsWithPool(g1), pools, lines: LINES, assign: ASSIGN }));
}

function expectPoolMembersHeld(result: ReturnType<typeof run>, code: string): void {
  expect(result.state).toBe('ON_HOLD');
  for (const key of [G1, G2]) {
    expect(result.groups.find((entry) => entry.groupKey === key)).toMatchObject({ state: 'ON_HOLD', holdReason: code, D: null, P: null, P_pooled: null });
  }
  // 풀의 멤버가 아닌 그룹은 정상 ESTIMATED 이고 참고 그룹이다. 무효 풀의 멤버 그룹은 모두 보류라서 참고 그룹에 없다.
  expect(result.groups.find((entry) => entry.groupKey === G3)).toMatchObject({ state: 'ESTIMATED', E: 10_000, P: 9_000, P_pooled: 9_000 });
  expect(result.referenceGroups).toEqual([{ groupKey: G3, P: 9_000, isReference: true }]);
  expect(result.amounts.hospitalPayment).toBe(120_000);
  expect(result.amounts.expectedInsurancePayout).toBeNull();
}

describe('AC-008m 구조 결함이 하나라도 있으면 프로필 전체를 믿을 수 없어 모든 줄이 PROFILE_INVALID', () => {
  const [a, b] = [group(G1, FIXED_10K, perVisit(250_000)), group(G2, FIXED_10K, perVisit(250_000))] as const;
  const pool: SharedLimitPool = { poolKey: POOL, limit: perVisit(80_000) };
  const cases: Array<[string, Parameters<typeof caseInput>[0]]> = [
    ['빈 groupKey', { groups: [{ ...a, groupKey: '' }, b], groupOrder: ['', G2] }],
    ['중복 groupKey', { groups: [a, { ...b, groupKey: G1 }], groupOrder: [G1] }],
    ['빈 poolKey', { groups: [a, b], pools: [{ ...pool, poolKey: '' }] }],
    ['중복 poolKey', { groups: [a, b], pools: [pool, pool] }],
    ['없는 풀을 가리키는 sharedLimitPoolKey', { groups: [{ ...a, sharedLimitPoolKey: 'TEST_POOL_MISSING' }, b] }],
    ['groupOrder 에서 빠진 키', { groups: [a, b], groupOrder: [G1] }],
    ['groupOrder 의 중복 키', { groups: [a, b], groupOrder: [G1, G2, G2] }],
    ['groupOrder 의 없는 키', { groups: [a, b], groupOrder: [G1, G2, 'TEST_GHOST'] }],
    ['그룹이 하나도 없는 빈 프로필', { groups: [], groupOrder: [] }],
  ];

  it.each(cases)('%s -> 모든 줄 PROFILE_INVALID, ESTIMATED 그룹 없음, referenceGroups 비어 있음', (_name, options) => {
    const result = runEstimate(caseInput({ ...options, lines: LINES, assign: { [T_ULTRA]: G1, [T_INJECT]: G2, [T_XRAY]: G1 } }));
    expect(result.state).toBe('ON_HOLD');
    expect(result.lines.every((line) => line.state === 'ON_HOLD' && line.holdReason === 'PROFILE_INVALID')).toBe(true);
    expect(result.groups.filter((entry) => entry.state === 'ESTIMATED')).toEqual([]);
    expect(result.referenceGroups).toEqual([]);
    expect(result.amounts.expectedInsurancePayout).toBeNull();
    expect(result.amounts.hospitalPayment).toBe(120_000);
  });
});

describe('AC-008m 풀 한도의 종류: 지원하는 종류는 계산하고 지원 밖은 멤버 그룹만 보류한다', () => {
  it.each([
    ['PER_VISIT_PAYOUT', { kind: 'PER_VISIT_PAYOUT', amount: 80_000, limitBasis: 'PAYOUT' }, false],
    ['PER_ACCIDENT', { kind: 'PER_ACCIDENT', amount: 80_000, limitBasis: 'PAYOUT' }, true],
    ['ANNUAL', { kind: 'ANNUAL', amount: 80_000, limitBasis: 'PAYOUT' }, true],
    ['COUNT', { kind: 'COUNT', perUseAmount: 80_000, limitBasis: 'PAYOUT' }, true],
  ])('%s 풀은 계산되고 Σ P_pooled = min(Σ P, 풀 한도) (REMAINING_LIMIT_ASSUMED = %s)', (_name, limit, assumed) => {
    const result = run(limit);
    expect(result.state).toBe('ESTIMATED');
    const pooled = result.groups.filter((entry) => entry.sharedLimitPoolKey === POOL);
    expect(pooled.reduce((sum, entry) => sum + (entry.P_pooled as number), 0)).toBe(Math.min(pooled.reduce((sum, entry) => sum + (entry.P as number), 0), 80_000));
    expect(result.assumptions.includes('REMAINING_LIMIT_ASSUMED')).toBe(assumed);
  });

  it('조항 참조가 있는 UNLIMITED_DECLARED 풀은 P_pooled = P', () => {
    const result = run(UNLIMITED);
    expect(result.groups.map((entry) => entry.P_pooled)).toEqual(result.groups.map((entry) => entry.P));
  });

  it('조항 참조가 없는 UNLIMITED_DECLARED 풀은 멤버 그룹이 PROFILE_SOURCE_INCOMPLETE', () => {
    expectPoolMembersHeld(run({ kind: 'UNLIMITED_DECLARED' }), 'PROFILE_SOURCE_INCOMPLETE');
  });

  it('limitBasis = COVERED_COST 인 풀은 멤버 그룹이 PROFILE_FORMULA_UNSUPPORTED', () => {
    expectPoolMembersHeld(run({ kind: 'PER_VISIT_PAYOUT', amount: 80_000, limitBasis: 'COVERED_COST' }), 'PROFILE_FORMULA_UNSUPPORTED');
  });

  it('닫힌 목록 밖의 종류인 풀은 멤버 그룹이 PROFILE_FORMULA_UNSUPPORTED', () => {
    expectPoolMembersHeld(run({ kind: 'LIFETIME', amount: 80_000, limitBasis: 'PAYOUT' }), 'PROFILE_FORMULA_UNSUPPORTED');
  });
});

describe('AC-008m 풀 한도의 값 결함은 멤버 그룹만 보류한다', () => {
  it('풀의 한도 값이 없거나 null 이면 멤버 그룹만 PROFILE_VALUE_MISSING', () => {
    expectPoolMembersHeld(run(null), 'PROFILE_VALUE_MISSING');
    expectPoolMembersHeld(run({ kind: 'PER_VISIT_PAYOUT', limitBasis: 'PAYOUT' }), 'PROFILE_VALUE_MISSING');
  });

  it.each([
    ['음수', -1],
    ['소수', 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['문자열', '80000'],
    ['MAX_AMOUNT_WON 초과', 1_000_000_001],
  ])('풀의 한도 금액이 %s 이면 멤버 그룹만 PROFILE_VALUE_INVALID', (_name, amount) => {
    expectPoolMembersHeld(run({ kind: 'PER_VISIT_PAYOUT', amount, limitBasis: 'PAYOUT' }), 'PROFILE_VALUE_INVALID');
  });

  it('다른 (유효한) 풀의 그룹은 영향을 받지 않는다', () => {
    const groups = [
      group(G1, FIXED_10K, perVisit(250_000), POOL),
      group(G2, FIXED_10K, perVisit(250_000), 'TEST_POOL_GOOD'),
      group(G3, { kind: 'FIXED', fixed: 1_000 }, perVisit(250_000)),
    ];
    const pools: SharedLimitPool[] = [
      { poolKey: POOL, limit: loose<LimitRule>({ kind: 'PER_VISIT_PAYOUT', amount: -1, limitBasis: 'PAYOUT' }) },
      { poolKey: 'TEST_POOL_GOOD', limit: perVisit(20_000) },
    ];
    const result = runEstimate(caseInput({ groups, pools, lines: LINES, assign: ASSIGN }));
    expect(result.groups.find((entry) => entry.groupKey === G1)).toMatchObject({ state: 'ON_HOLD', holdReason: 'PROFILE_VALUE_INVALID' });
    expect(result.groups.find((entry) => entry.groupKey === G2)).toMatchObject({ state: 'ESTIMATED', P: 30_000, P_pooled: 20_000 });
    expect(result.referenceGroups.map((entry) => [entry.groupKey, entry.P])).toEqual([[G2, 20_000], [G3, 9_000]]);
  });

  it('멤버 그룹이 하나도 없는 풀은 결함이 있어도 아무 영향이 없고 그 풀을 뺀 프로필과 결과가 같다', () => {
    const groups = [group(G1, FIXED_10K, perVisit(250_000)), group(G3, { kind: 'FIXED', fixed: 1_000 }, perVisit(250_000))];
    const lines = [makeLine(T_ULTRA, 70_000), makeLine(T_XRAY, 10_000)];
    const assign = { [T_ULTRA]: G1, [T_XRAY]: G3 };
    const bad: SharedLimitPool = { poolKey: 'TEST_POOL_EMPTY', limit: loose<LimitRule>({ kind: 'PER_VISIT_PAYOUT', amount: -9, limitBasis: 'COVERED_COST' }) };
    const withBadPool = runEstimate(caseInput({ groups, pools: [bad], lines, assign }));
    const withoutPool = runEstimate(caseInput({ groups, lines, assign }));
    expect(JSON.stringify(withBadPool)).toBe(JSON.stringify(withoutPool));
    expect(withBadPool.state).toBe('ESTIMATED');
  });
});

describe('AC-008m 한 그룹에 코드가 여럿 해당하면 코드 종류 우선순위가 먼저다', () => {
  it('그룹 자신의 값이 무효이고 풀이 지원 밖 공식이면 후자(PROFILE_FORMULA_UNSUPPORTED)', () => {
    const result = run(
      { kind: 'PER_VISIT_PAYOUT', amount: 80_000, limitBasis: 'COVERED_COST' },
      { deduction: loose<DeductionRule>({ kind: 'FIXED', fixed: -1 }) },
    );
    expect(result.groups.find((entry) => entry.groupKey === G1)).toMatchObject({ holdReason: 'PROFILE_FORMULA_UNSUPPORTED' });
  });

  it('그룹 자신의 값이 없음이고 풀 값이 무효이면 전자(PROFILE_VALUE_MISSING)', () => {
    const result = run(
      { kind: 'PER_VISIT_PAYOUT', amount: -1, limitBasis: 'PAYOUT' },
      { deduction: loose<DeductionRule>({ kind: 'FIXED', fixed: null }) },
    );
    expect(result.groups.find((entry) => entry.groupKey === G1)).toMatchObject({ holdReason: 'PROFILE_VALUE_MISSING' });
    // 같은 풀의 다른 멤버는 풀 값 결함 자체의 코드를 받는다.
    expect(result.groups.find((entry) => entry.groupKey === G2)).toMatchObject({ holdReason: 'PROFILE_VALUE_INVALID' });
  });
});
