import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_WON, MAX_BASIS_POINTS } from '../../src/engine/limits';
import type { CoverageGroupDef, EstimateResult, SharedLimitPool } from '../../src/engine/types';
import { caseInput, group, perVisit, runEstimate } from '../fixtures/engine/cases.fixture';
import type { CaseOptions } from '../fixtures/engine/cases.fixture';
import { makeLine } from '../fixtures/engine/lines.fixture';
import { oracleGroup, oracleLimit, oraclePool } from '../fixtures/engine/oracle.fixture';

// AC-001a/c 의 동작 증거(주 증거): 입력을 고정하고 TEST_FIXTURE 프로필의 숫자 필드(고정 공제, 각 비율, 급여·비급여 비율,
// 한도 금액, 1회 사용액, 공유 한도 풀의 한도)를 한 번에 하나씩 바꿔 계산하면, 그룹 지급액 P·P_pooled 와 전체 금액이
// 시험 안에서 DD-02 의 식으로 따로 써 둔 기준 계산(독립 BigInt 오라클)이 예측한 값과 정확히 같게 바뀐다.
// 같은 (세대, 보험사 형태) 칸에 서로 다른 TEST_FIXTURE 프로필 둘을 쓰면 결과가 다르다. 값이 빠지면 0 이나 기본값으로 채우지 않고 보류한다.
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.

const GA = 'TEST_GROUP_SA';
const GB = 'TEST_GROUP_SB';
const GC = 'TEST_GROUP_SC';
const GD = 'TEST_GROUP_SD';
const POOL = 'TEST_POOL_S';

interface State {
  groups: CoverageGroupDef[];
  pools: SharedLimitPool[];
}

/** 모든 공제·한도 종류와 공유 한도 풀을 한 번씩 쓰는 기준 프로필. 기준 상태에서 풀 한도가 실제로 GB 의 몫을 줄인다. */
function baseState(): State {
  return {
    groups: [
      group(GA, { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 1_500, rounding: 'TRUNCATE' }, perVisit(60_000), POOL),
      group(
        GB,
        { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 2_000, rateBenefit: 1_000, rateNonBenefit: 2_500, rounding: 'ROUND_HALF_UP' },
        { kind: 'PER_ACCIDENT', amount: 55_000, limitBasis: 'PAYOUT' },
        POOL,
      ),
      group(GC, { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 500, rate: 3_000, rounding: 'TRUNCATE' }, { kind: 'COUNT', perUseAmount: 30_000, limitBasis: 'PAYOUT' }),
      group(GD, { kind: 'FIXED', fixed: 3_000 }, { kind: 'ANNUAL', amount: 50_000, limitBasis: 'PAYOUT' }),
    ],
    pools: [{ poolKey: POOL, limit: perVisit(70_000) }],
  };
}

const LINE_SPECS: Array<{ id: string; amount: number; benefit: boolean; group: string }> = [
  { id: 'S-A1', amount: 30_000, benefit: true, group: GA },
  { id: 'S-A2', amount: 4_000, benefit: true, group: GA },
  { id: 'S-B1', amount: 20_000, benefit: true, group: GB },
  { id: 'S-B2', amount: 45_000, benefit: false, group: GB },
  { id: 'S-C1', amount: 12_000, benefit: false, group: GC },
  { id: 'S-D1', amount: 9_000, benefit: true, group: GD },
];
const TOTAL = LINE_SPECS.reduce((sum, spec) => sum + spec.amount, 0);

function lines() {
  return LINE_SPECS.map((spec) =>
    makeLine(spec.id, spec.amount, spec.benefit ? {} : { benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT' }),
  );
}

function compute(state: State, extra: Partial<CaseOptions> = {}): EstimateResult {
  return runEstimate(
    caseInput({
      groups: state.groups,
      pools: state.pools,
      groupOrder: state.groups.map((entry) => entry.groupKey),
      assign: Object.fromEntries(LINE_SPECS.map((spec) => [spec.id, spec.group])),
      lines: lines(),
      ...extra,
    }),
  );
}

interface Expected {
  groups: Array<{ groupKey: string; D: number; D_applied: number; P: number; P_pooled: number }>;
  payout: number;
}

/** 독립 오라클로 기대값을 구한다. 풀은 groupOrder(= groups 순서) 로 남은 한도를 나눠 준다. */
function expectedFor(state: State): Expected {
  const rows = state.groups.map((def) => {
    let G = 0n;
    let N = 0n;
    for (const spec of LINE_SPECS.filter((candidate) => candidate.group === def.groupKey)) {
      if (spec.benefit) G += BigInt(spec.amount);
      else N += BigInt(spec.amount);
    }
    const result = oracleGroup(def.deduction, def.limit, G, N);
    return { groupKey: def.groupKey, poolKey: def.sharedLimitPoolKey, D: result.D, D_applied: result.Dapplied, P: result.P, pooled: result.P };
  });
  for (const pool of state.pools) {
    const members = rows.filter((row) => row.poolKey === pool.poolKey);
    const allocated = oraclePool(
      members.map((row) => row.P),
      oracleLimit(pool.limit),
    );
    members.forEach((row, index) => {
      row.pooled = allocated[index] as bigint;
    });
  }
  return {
    groups: rows.map((row) => ({ groupKey: row.groupKey, D: Number(row.D), D_applied: Number(row.D_applied), P: Number(row.P), P_pooled: Number(row.pooled) })),
    payout: Number(rows.reduce((sum, row) => sum + row.pooled, 0n)),
  };
}

function expectMatchesOracle(result: EstimateResult, state: State, label: string): void {
  const expected = expectedFor(state);
  expect(result.state, label).toBe('ESTIMATED');
  expect(
    result.groups.map((entry) => ({ groupKey: entry.groupKey, D: entry.D, D_applied: entry.D_applied, P: entry.P, P_pooled: entry.P_pooled })),
    label,
  ).toEqual(expected.groups);
  expect(result.amounts, label).toMatchObject({
    hospitalPayment: TOTAL,
    expectedInsurancePayout: expected.payout,
    expectedOutOfPocketAfterPayout: TOTAL - expected.payout,
  });
}

// ───────────────────────── 숫자 필드 열거 ─────────────────────────

type Path = Array<string | number>;
interface Field {
  path: Path;
  label: string;
  kind: 'won' | 'bp';
  value: number;
}

const BP_KEYS = new Set(['rate', 'rateBenefit', 'rateNonBenefit']);

/** 프로필의 숫자 필드를 빠짐없이 모은다(숫자인 잎 전부). 새 숫자 필드가 생기면 자동으로 시험 대상에 든다. */
function numericFields(state: State): Field[] {
  const found: Field[] = [];
  const walk = (value: unknown, path: Path): void => {
    if (typeof value === 'number') {
      const key = String(path[path.length - 1]);
      found.push({ path, label: path.join('.'), kind: BP_KEYS.has(key) ? 'bp' : 'won', value });
    } else if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, [...path, index]));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
    }
  };
  walk(state, []);
  return found;
}

function withFieldChanged(state: State, path: Path, change: { set: number } | { remove: true }): State {
  const clone = structuredClone(state);
  let cursor = clone as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if ('remove' in change) delete cursor[last];
  else cursor[last] = change.set;
  return clone;
}

function variantsOf(field: Field): number[] {
  const upper = field.kind === 'won' ? MAX_AMOUNT_WON : MAX_BASIS_POINTS;
  const candidates =
    field.kind === 'won'
      ? [0, 1, field.value - 1, field.value + 1, field.value * 2, MAX_AMOUNT_WON]
      : [0, 1, field.value - 1, field.value + 1, MAX_BASIS_POINTS - 1, MAX_BASIS_POINTS];
  return [...new Set(candidates)].filter((candidate) => candidate >= 0 && candidate <= upper && candidate !== field.value);
}

const BASE = baseState();
const FIELDS = numericFields(BASE);
const BASE_RESULT = compute(BASE);

describe('기준 상태 확인 (빈 시험 방지)', () => {
  it('기준 프로필은 오라클과 같은 값을 내고, 공제·한도·풀이 모두 실제로 값에 관여한다', () => {
    expectMatchesOracle(BASE_RESULT, BASE, '기준');
    expect(BASE_RESULT.groups.map((entry) => entry.P)).toEqual([28_900, 51_750, 8_400, 6_000]);
    expect(BASE_RESULT.groups.map((entry) => entry.P_pooled)).toEqual([28_900, 41_100, 8_400, 6_000]); // 풀 한도 70,000 이 GB 를 줄였다
    expect(BASE_RESULT.amounts).toMatchObject({ hospitalPayment: 120_000, expectedInsurancePayout: 84_400, expectedOutOfPocketAfterPayout: 35_600 });
  });

  it('숫자 필드 13개(고정 공제 4, 비율 4, 한도 금액 4, 풀 한도 1)를 빠짐없이 열거했다', () => {
    expect(FIELDS.map((field) => field.label).sort()).toEqual(
      [
        'groups.0.deduction.fixed',
        'groups.0.deduction.rate',
        'groups.0.limit.amount',
        'groups.1.deduction.fixed',
        'groups.1.deduction.rateBenefit',
        'groups.1.deduction.rateNonBenefit',
        'groups.1.limit.amount',
        'groups.2.deduction.fixed',
        'groups.2.deduction.rate',
        'groups.2.limit.perUseAmount',
        'groups.3.deduction.fixed',
        'groups.3.limit.amount',
        'pools.0.limit.amount',
      ].sort(),
    );
    expect(FIELDS.filter((field) => field.kind === 'bp')).toHaveLength(4);
  });
});

describe('AC-001c 프로필 숫자 필드를 하나씩 바꾸면 결과가 오라클의 예측과 정확히 같게 바뀐다', () => {
  it.each(FIELDS.map((field) => [field.label, field] as const))('%s', (_label, field) => {
    const variants = variantsOf(field);
    expect(variants.length).toBeGreaterThanOrEqual(4);
    let moved = 0;
    for (const value of variants) {
      const changed = withFieldChanged(BASE, field.path, { set: value });
      const result = compute(changed);
      expectMatchesOracle(result, changed, `${field.label} = ${value}`);
      if (JSON.stringify([result.groups, result.amounts]) !== JSON.stringify([BASE_RESULT.groups, BASE_RESULT.amounts])) moved += 1;
    }
    // 이 필드가 결과에 쓰이지 않거나 코드에 박혀 있다면 어떤 값으로 바꿔도 결과가 그대로다.
    expect(moved, `${field.label}: 값을 바꿔도 결과가 변하지 않았다`).toBeGreaterThanOrEqual(1);
  });

  it('공유 한도에 묶이지 않은 그룹의 필드를 바꾸면 다른 그룹의 결과는 그대로다 (필드 사이에 새는 값이 없다)', () => {
    for (const field of FIELDS.filter((candidate) => candidate.path[0] === 'groups' && [2, 3].includes(candidate.path[1] as number))) {
      const owner = field.path[1] as number;
      for (const value of variantsOf(field)) {
        const result = compute(withFieldChanged(BASE, field.path, { set: value }));
        result.groups.forEach((entry, index) => {
          if (index !== owner) expect(entry, `${field.label} = ${value}`).toEqual(BASE_RESULT.groups[index]);
        });
      }
    }
  });

  it('숫자 필드가 빠지면 0 이나 기본값으로 채우지 않고 그 그룹을 보류한다 (13개 필드 모두)', () => {
    for (const field of FIELDS) {
      const result = compute(withFieldChanged(BASE, field.path, { remove: true }));
      expect(result.state, field.label).toBe('ON_HOLD');
      expect(result.amounts.expectedInsurancePayout, field.label).toBeNull();
      expect(result.amounts.expectedOutOfPocketAfterPayout, field.label).toBeNull();
      expect(result.holdReasons.length, field.label).toBeGreaterThan(0);
      expect(
        result.holdReasons.every((reason) => reason.code === 'PROFILE_VALUE_MISSING'),
        `${field.label}: ${JSON.stringify(result.holdReasons)}`,
      ).toBe(true);
    }
  });
});

describe('같은 (세대, 보험사 형태) 칸에 서로 다른 TEST_FIXTURE 프로필 둘을 쓰면 결과가 다르다', () => {
  it('프로필 B 는 프로필 A 와 숫자만 다르고, 각각 오라클과 같은 결과를 낸다', () => {
    const stateB: State = baseState();
    // 모든 숫자 필드를 다른 값으로 바꾼 두 번째 TEST_FIXTURE 프로필.
    for (const field of numericFields(stateB)) {
      const next = field.kind === 'bp' ? field.value + 500 : field.value + 777;
      Object.assign(stateB, withFieldChanged(stateB, field.path, { set: next }));
    }
    expect(numericFields(stateB).map((field) => field.value)).not.toEqual(FIELDS.map((field) => field.value));

    const resultA = compute(BASE, { profile: { id: 'TEST_PROFILE_A', version: 'v1' } });
    const resultB = compute(stateB, { profile: { id: 'TEST_PROFILE_B', version: 'v2' } });
    expectMatchesOracle(resultA, BASE, '프로필 A');
    expectMatchesOracle(resultB, stateB, '프로필 B');
    expect(resultA.state).toBe(resultB.state);
    expect(resultA.amounts.hospitalPayment).toBe(resultB.amounts.hospitalPayment); // 같은 입력 가격
    expect(resultA.amounts.expectedInsurancePayout).not.toBe(resultB.amounts.expectedInsurancePayout);
    expect(resultA.groups.map((entry) => entry.P)).not.toEqual(resultB.groups.map((entry) => entry.P));
    expect(resultA.basis.profile?.id).toBe('TEST_PROFILE_A');
    expect(resultB.basis.profile?.id).toBe('TEST_PROFILE_B');
  });

  it('숫자가 같고 식별자·버전만 다른 프로필은 같은 금액을 내고 계산 근거만 다르다', () => {
    const first = compute(BASE, { profile: { id: 'TEST_PROFILE_X', version: 'v1' } });
    const second = compute(BASE, { profile: { id: 'TEST_PROFILE_Y', version: 'v9' } });
    expect(second.groups).toEqual(first.groups);
    expect(second.amounts).toEqual(first.amounts);
    expect(second.basis.profile?.id).not.toBe(first.basis.profile?.id);
    expect(second.basis.profile?.version).not.toBe(first.basis.profile?.version);
  });
});
