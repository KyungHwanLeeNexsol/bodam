import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import type {
  CoverageGroupDef,
  DeductionRule,
  EstimateResult,
  LimitRule,
  PublishedLine,
  SharedLimitPool,
  TreatmentCoverageMapping,
} from '../../src/engine/types';
import { oracleGroup, oraclePool } from '../fixtures/engine/oracle.fixture';
import { makeExcludedMapping, makeMapping } from '../fixtures/engine/mappings.fixture';
import { runEstimate, caseInput } from '../fixtures/engine/cases.fixture';
import { makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.
// AC-005a 속성 기반 시험. 고정 시드로 무작위 생성한 입력의 불변 조건을 본다. 시드와 시행 수는 아래 상수에 고정되어 있고 시험 제목에 기록된다.

const SEED = 20261015;
const TRIALS = 400;

/** 고정 시드 선형 합동 생성기. 시험 입력은 결정적이다. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state;
  };
  return {
    int: (maxInclusive: number): number => next() % (maxInclusive + 1),
    pick: <T,>(items: readonly T[]): T => items[next() % items.length] as T,
    chance: (percent: number): boolean => next() % 100 < percent,
  };
}

type Random = ReturnType<typeof makeRandom>;

function randomDeduction(random: Random): DeductionRule {
  const rounding = random.pick(['TRUNCATE', 'ROUND_HALF_UP'] as const);
  const fixed = random.pick([0, 1, 500, 10_000, random.int(60_000)]);
  const rate = () => random.pick([0, 1, 1000, 2000, 3333, 9999, 10000, random.int(10000)]);
  switch (random.int(3)) {
    case 0:
      return { kind: 'FIXED', fixed };
    case 1:
      return { kind: 'RATE_WITH_FIXED_FLOOR', fixed, rate: rate(), rounding };
    case 2:
      return { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed, rateBenefit: rate(), rateNonBenefit: rate(), rounding };
    default:
      return { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed, rate: rate(), rounding };
  }
}

function randomLimit(random: Random): LimitRule {
  const amount = random.pick([0, 1, 5_000, 100_000, random.int(400_000)]);
  switch (random.int(4)) {
    case 0:
      return { kind: 'PER_VISIT_PAYOUT', amount, limitBasis: 'PAYOUT' };
    case 1:
      return { kind: 'PER_ACCIDENT', amount, limitBasis: 'PAYOUT' };
    case 2:
      return { kind: 'ANNUAL', amount, limitBasis: 'PAYOUT' };
    case 3:
      return { kind: 'COUNT', perUseAmount: amount, limitBasis: 'PAYOUT' };
    default:
      return { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'TEST_FIXTURE_CLAUSE_REF' };
  }
}

interface Trial {
  input: ReturnType<typeof caseInput>;
  groups: CoverageGroupDef[];
  pools: SharedLimitPool[];
  lines: PublishedLine[];
}

function randomTrial(random: Random, index: number): Trial {
  const groupCount = 1 + random.int(2);
  const poolKey = 'TEST_POOL';
  const usePool = groupCount >= 2 && random.chance(50);
  const groups: CoverageGroupDef[] = Array.from({ length: groupCount }, (_unused, g) => {
    const key = `TEST_GROUP_${g}`;
    const def: CoverageGroupDef = { groupKey: key, deduction: randomDeduction(random), limit: randomLimit(random) };
    return usePool ? { ...def, sharedLimitPoolKey: poolKey } : def;
  });
  const pools: SharedLimitPool[] = usePool ? [{ poolKey, limit: randomLimit(random) }] : [];

  // 일부 시행은 무효 값을 심어 그 그룹을 보류시킨다.
  if (random.chance(5)) {
    groups[0] = { ...groups[0]!, deduction: { kind: 'FIXED', fixed: -1 } as DeductionRule };
  }

  const lineCount = 1 + random.int(5);
  const lines: PublishedLine[] = [];
  const mappings: TreatmentCoverageMapping[] = [];
  for (let i = 0; i < lineCount; i += 1) {
    const id = `T${index}-${i}`;
    const amount = random.pick([0, 1, 4_000, 10_000, 70_000, random.int(500_000), random.chance(5) ? MAX_AMOUNT_WON : 123]);
    const benefitType = random.chance(50) ? ('BENEFIT' as const) : ('NON_BENEFIT' as const);
    const calcClass = random.chance(5) ? ('NEEDS_REVIEW' as const) : ('GENERAL_BENEFIT' as const);
    lines.push(makeLine(id, amount, { benefitType, calcClass }));
    const roll = random.int(99);
    if (roll < 12) continue; // 매핑 없음 -> 보류
    mappings.push(
      roll < 25
        ? makeExcludedMapping(id) // 확인된 제외
        : makeMapping(id, { groupKey: (random.pick(groups) as CoverageGroupDef).groupKey }),
    );
  }
  return { input: caseInput({ groups, pools, lines, mappings }), groups, pools, lines };
}

function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectNumbers(item, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((item) => collectNumbers(item, out));
  return out;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** AC-005a 의 불변 조건. 정상 계산이든 그룹 CALC_RANGE_EXCEEDED 보류든 모두 지켜야 한다. */
function expectInvariants(result: EstimateResult): void {
  const { hospitalPayment, expectedInsurancePayout, expectedOutOfPocketAfterPayout } = result.amounts;
  const held = result.state === 'ON_HOLD';

  // 두 값은 함께 null 이거나 함께 정수이며, 보류일 때만 null 이다.
  expect(expectedInsurancePayout === null).toBe(expectedOutOfPocketAfterPayout === null);
  expect(expectedInsurancePayout === null).toBe(held);
  if (!held) {
    const payout = expectedInsurancePayout as number;
    expect(payout).toBeGreaterThanOrEqual(0);
    expect(payout).toBeLessThanOrEqual(hospitalPayment);
    expect(payout + (expectedOutOfPocketAfterPayout as number)).toBe(hospitalPayment);
    expect(sum(result.groups.map((entry) => entry.P_pooled as number))).toBe(payout);
  }

  for (const entry of result.groups) {
    if (entry.state === 'ESTIMATED') {
      const P = entry.P as number;
      const pooled = entry.P_pooled;
      expect(P).toBeGreaterThanOrEqual(0);
      expect(P).toBeLessThanOrEqual(entry.E);
      if (pooled !== null) {
        expect(pooled).toBeGreaterThanOrEqual(0);
        expect(pooled).toBeLessThanOrEqual(P);
      }
    } else {
      expect([entry.D, entry.D_applied, entry.P, entry.P_pooled]).toEqual([null, null, null, null]);
    }
  }

  // 공유 풀 지급 합은 풀 한도를 넘지 않는다는 점은 아래 오라클 비교(Σ P_pooled = min(Σ P, 풀 한도))가 증명한다.

  // 보류 줄의 금액은 어느 그룹 E 에도 없다: 그룹 E 의 합 = ESTIMATED 줄 금액의 합.
  const estimatedSum = sum(result.lines.filter((line) => line.state === 'ESTIMATED').map((line) => line.patientAmount));
  expect(sum(result.groups.filter((entry) => entry.state === 'ESTIMATED').map((entry) => entry.E))).toBe(estimatedSum);
  for (const line of result.lines) {
    if (line.state !== 'ESTIMATED') expect('groupKey' in line).toBe(false);
  }

  // 음수 금액이 없고 NaN·Infinity·안전 정수가 아닌 수가 없다. 직렬화에서 null 로 바뀌어 보류처럼 보이는 일도 없다.
  for (const value of collectNumbers(result)) {
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);

  // 병원 결제액은 줄 금액 전체의 합이다 (보류·제외 포함).
  expect(hospitalPayment).toBe(sum(result.lines.map((line) => line.patientAmount)));
}

/** 독립 오라클: 보류가 없는 결과의 그룹 값과 합계를 DD-02 의 식으로 따로 계산해 비교한다. */
function expectMatchesOracle(trial: Trial, result: EstimateResult): void {
  if (result.state === 'ON_HOLD') return;
  const pool = trial.pools[0];
  const perGroup = result.groups.map((entry) => {
    const def = trial.groups.find((candidate) => candidate.groupKey === entry.groupKey) as CoverageGroupDef;
    const members = result.lines.filter((line) => line.state === 'ESTIMATED' && line.groupKey === entry.groupKey);
    const G = BigInt(sum(members.filter((line) => line.benefitType === 'BENEFIT').map((line) => line.patientAmount)));
    const N = BigInt(sum(members.filter((line) => line.benefitType === 'NON_BENEFIT').map((line) => line.patientAmount)));
    return { entry, def, oracle: oracleGroup(def.deduction, def.limit, G, N) };
  });
  for (const { entry, oracle } of perGroup) {
    expect(entry).toMatchObject({ E: Number(oracle.E), D: Number(oracle.D), D_applied: Number(oracle.Dapplied), P: Number(oracle.P) });
  }
  let total = 0n;
  const pooled = perGroup.filter(({ def }) => def.sharedLimitPoolKey !== undefined);
  if (pool !== undefined && pooled.length > 0) {
    const limit = pool.limit.kind === 'UNLIMITED_DECLARED' ? 'UNLIMITED' : BigInt(pool.limit.kind === 'COUNT' ? pool.limit.perUseAmount : pool.limit.amount);
    const shares = oraclePool(pooled.map(({ oracle }) => oracle.P), limit);
    pooled.forEach(({ entry }, index) => expect(entry.P_pooled).toBe(Number(shares[index])));
    total += shares.reduce((a, b) => a + b, 0n);
  }
  for (const { def, entry, oracle } of perGroup) {
    if (def.sharedLimitPoolKey === undefined) {
      expect(entry.P_pooled).toBe(Number(oracle.P));
      total += oracle.P;
    }
  }
  expect(result.amounts.expectedInsurancePayout).toBe(Number(total));
}

describe(`AC-005a 속성 기반 불변 조건 (고정 시드 ${SEED}, 시행 ${TRIALS})`, () => {
  it('무작위 TEST_FIXTURE 입력(치료 수·금액·그룹·공제 방식·한도·제외·보류·풀 조합)에서 모든 불변 조건이 지켜지고 보류 없는 결과는 오라클과 같다', () => {
    const random = makeRandom(SEED);
    const kinds = { held: 0, estimated: 0, withExclusions: 0, pooled: 0 };
    for (let index = 0; index < TRIALS; index += 1) {
      const trial = randomTrial(random, index);
      const result = runEstimate(trial.input);
      expectInvariants(result);
      expectMatchesOracle(trial, result);
      if (result.state === 'ON_HOLD') kinds.held += 1;
      else if (result.state === 'ESTIMATED') kinds.estimated += 1;
      else kinds.withExclusions += 1;
      if (trial.pools.length > 0) kinds.pooled += 1;
    }
    // 생성 범위가 세 상태와 풀을 모두 덮었는지 확인한다(시험이 한쪽으로 쏠려 무의미해지지 않도록).
    expect(kinds.held).toBeGreaterThan(20);
    expect(kinds.estimated).toBeGreaterThan(20);
    expect(kinds.withExclusions).toBeGreaterThan(5);
    expect(kinds.pooled).toBeGreaterThan(20);
  });
});

describe('AC-005a 경계 근처 값 (AC-003h 표의 정상 최대와 첫 초과, ±1) 을 섞은 시행', () => {
  const BOUNDARIES: Array<{ rate: number; rounding: 'TRUNCATE' | 'ROUND_HALF_UP'; E: number }> = [
    { rate: 10000, rounding: 'TRUNCATE', E: 900719925474 },
    { rate: 10000, rounding: 'TRUNCATE', E: 900719925475 },
    { rate: 10000, rounding: 'ROUND_HALF_UP', E: 900719925473 },
    { rate: 10000, rounding: 'ROUND_HALF_UP', E: 900719925474 },
    { rate: 2000, rounding: 'ROUND_HALF_UP', E: 4503599627367 },
    { rate: 2000, rounding: 'ROUND_HALF_UP', E: 4503599627368 },
    { rate: 2000, rounding: 'TRUNCATE', E: 4503599627370 },
    { rate: 2000, rounding: 'TRUNCATE', E: 4503599627371 },
  ];

  it.each(BOUNDARIES)('비율 $rate $rounding E = $E: 정상 계산이거나 그룹 CALC_RANGE_EXCEEDED 보류이고 어느 쪽이든 불변 조건을 지킨다', ({ rate, rounding, E }) => {
    const count = Math.ceil(E / MAX_AMOUNT_WON);
    const lines = Array.from({ length: count }, (_unused, i) => makeLine(`B-${String(i).padStart(6, '0')}`, i < count - 1 ? MAX_AMOUNT_WON : E - (count - 1) * MAX_AMOUNT_WON));
    const group: CoverageGroupDef = { groupKey: 'TEST_GROUP_B', deduction: { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 10_000, rate, rounding }, limit: { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'TEST_FIXTURE_CLAUSE_REF' } };
    const result = runEstimate(caseInput({ groups: [group], lines }));
    expectInvariants(result);
    expect(['ESTIMATED', 'ON_HOLD']).toContain(result.state);
    if (result.state === 'ON_HOLD') {
      expect(result.groups[0]).toMatchObject({ holdReason: 'CALC_RANGE_EXCEEDED' });
    } else {
      expectMatchesOracle({ input: caseInput({ groups: [group], lines }), groups: [group], pools: [], lines }, result);
    }
  });
});
