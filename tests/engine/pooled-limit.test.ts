import { describe, expect, it } from 'vitest';
import type { DeductionRule, LimitRule, SharedLimitPool } from '../../src/engine/types';
import { oraclePool } from '../fixtures/engine/oracle.fixture';
import { UNLIMITED, caseInput, group, perVisit, runEstimate } from '../fixtures/engine/cases.fixture';
import { T_INJECT, T_ULTRA, makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다. 공유 한도 풀: 합계는 한 번만 적용되고 몫은 groupOrder 로 배분된다.

const G1 = 'TEST_GROUP_ONE';
const G2 = 'TEST_GROUP_TWO';
const POOL = 'TEST_POOL_ONE';
const FIXED_10K: DeductionRule = { kind: 'FIXED', fixed: 10_000 };

// 초음파(70,000) -> G1, 신장분사치료(40,000) -> G2. 공제 10,000 뒤 P 는 G1 = 60,000, G2 = 30,000 (합 90,000).
const LINES = [makeLine(T_ULTRA, 70_000), makeLine(T_INJECT, 40_000)];
const ASSIGN = { [T_ULTRA]: G1, [T_INJECT]: G2 };

function pooled(poolLimit: LimitRule, order: string[] = [G1, G2]) {
  const groups = [
    group(G1, FIXED_10K, perVisit(250_000), POOL),
    group(G2, FIXED_10K, perVisit(250_000), POOL),
  ];
  const pools: SharedLimitPool[] = [{ poolKey: POOL, limit: poolLimit }];
  return runEstimate(caseInput({ groups, pools, groupOrder: order, assign: ASSIGN, lines: LINES }));
}

describe('AC-003f 같은 풀의 두 그룹의 지급 합이 풀 한도를 넘으면 합계는 풀 한도이고 줄어든 금액은 groupOrder 로 배분된다', () => {
  it('풀 한도 80,000: 합 90,000 -> G1 60,000(전액), G2 20,000(남은 한도), 합계 = 풀 한도', () => {
    const result = pooled(perVisit(80_000));
    expect(result.groups.map((entry) => [entry.groupKey, entry.P, entry.P_pooled])).toEqual([
      [G1, 60_000, 60_000],
      [G2, 30_000, 20_000],
    ]);
    expect(result.amounts).toMatchObject({ hospitalPayment: 110_000, expectedInsurancePayout: 80_000, expectedOutOfPocketAfterPayout: 30_000 });
  });

  it('groupOrder 를 바꾸면 그룹별 몫만 바뀌고 합계는 같다 (G2 먼저: 30,000 + 50,000)', () => {
    const first = pooled(perVisit(80_000), [G1, G2]);
    const swapped = pooled(perVisit(80_000), [G2, G1]);
    expect(swapped.groups.map((entry) => [entry.groupKey, entry.P_pooled])).toEqual([
      [G2, 30_000],
      [G1, 50_000],
    ]);
    expect(swapped.amounts.expectedInsurancePayout).toBe(first.amounts.expectedInsurancePayout);
  });

  it('풀 한도가 지급 합 이상이면 줄어드는 금액이 없다 (P_pooled = P)', () => {
    for (const limit of [90_000, 90_001, 1_000_000]) {
      const result = pooled(perVisit(limit));
      expect(result.groups.map((entry) => entry.P_pooled)).toEqual([60_000, 30_000]);
    }
  });

  it('풀 한도 0 이면 모든 몫이 0 이고 풀 한도를 넘거나 두 번 지급되지 않는다', () => {
    const result = pooled(perVisit(0));
    expect(result.groups.map((entry) => entry.P_pooled)).toEqual([0, 0]);
    expect(result.amounts.expectedInsurancePayout).toBe(0);
  });

  it('경계: 풀 한도가 합과 같으면(90,000) 그대로이고 1 작으면(89,999) 마지막 그룹이 1 줄어든다', () => {
    expect(pooled(perVisit(90_000)).groups.map((entry) => entry.P_pooled)).toEqual([60_000, 30_000]);
    expect(pooled(perVisit(89_999)).groups.map((entry) => entry.P_pooled)).toEqual([60_000, 29_999]);
  });

  it('조항 참조가 있는 UNLIMITED_DECLARED 풀은 P_pooled = P 다', () => {
    const result = pooled(UNLIMITED);
    expect(result.groups.map((entry) => entry.P_pooled)).toEqual([60_000, 30_000]);
  });

  it('독립 오라클과 같다 (여러 풀 한도 x 두 순서)', () => {
    for (const limit of [0, 1, 29_999, 30_000, 59_999, 60_000, 80_000, 89_999, 90_000]) {
      for (const order of [[G1, G2], [G2, G1]]) {
        const result = pooled(perVisit(limit), order);
        const payoutsInOrder = order.map((key) => (key === G1 ? 60_000n : 30_000n));
        expect(result.groups.map((entry) => BigInt(entry.P_pooled as number))).toEqual(oraclePool(payoutsInOrder, BigInt(limit)));
      }
    }
  });
});

describe('풀 한도 종류와 가정 코드', () => {
  it.each([
    ['PER_ACCIDENT', { kind: 'PER_ACCIDENT', amount: 80_000, limitBasis: 'PAYOUT' } as LimitRule, true],
    ['ANNUAL', { kind: 'ANNUAL', amount: 80_000, limitBasis: 'PAYOUT' } as LimitRule, true],
    ['COUNT', { kind: 'COUNT', perUseAmount: 80_000, limitBasis: 'PAYOUT' } as LimitRule, true],
    ['PER_VISIT_PAYOUT', perVisit(80_000), false],
    ['UNLIMITED_DECLARED', UNLIMITED, false],
  ])('풀 한도 %s: REMAINING_LIMIT_ASSUMED 여부 = %s', (_name, limit, assumed) => {
    const result = pooled(limit as LimitRule);
    expect(result.assumptions.includes('REMAINING_LIMIT_ASSUMED')).toBe(assumed);
  });
});

describe('AC-004h 출력 일관성 (풀 포함)', () => {
  it('Σ P_pooled = 예상 보험금, 병원 결제액 − 보험금 = 수령 후 부담, 풀마다 Σ P_pooled = min(Σ P, 풀 한도), P_pooled ≤ P ≤ E', () => {
    const result = pooled(perVisit(80_000));
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    expect(sum(result.groups.map((entry) => entry.P_pooled as number))).toBe(result.amounts.expectedInsurancePayout);
    expect((result.amounts.hospitalPayment as number) - (result.amounts.expectedInsurancePayout as number)).toBe(result.amounts.expectedOutOfPocketAfterPayout);
    expect(sum(result.groups.map((entry) => entry.P_pooled as number))).toBe(Math.min(sum(result.groups.map((entry) => entry.P as number)), 80_000));
    for (const entry of result.groups) {
      expect(entry.P_pooled as number).toBeLessThanOrEqual(entry.P as number);
      expect(entry.P as number).toBeLessThanOrEqual(entry.E);
    }
  });

  it('basis 의 그룹별 단계가 groups[] 와 같은 순서·같은 값이며 풀 키를 담는다', () => {
    const result = pooled(perVisit(80_000));
    expect(result.basis.steps).toEqual(result.groups.flatMap((entry) => entry.trace));
    expect(result.basis.steps.map((step) => [step.groupKey, step.E, step.D, step.D_applied, step.L, step.P, step.P_pooled, step.poolKey])).toEqual([
      [G1, 70_000, 10_000, 10_000, 250_000, 60_000, 60_000, POOL],
      [G2, 40_000, 10_000, 10_000, 250_000, 30_000, 20_000, POOL],
    ]);
  });

  it('직렬화한 결과도 어긋나지 않는다 (JSON 왕복 후 같은 값)', () => {
    const result = pooled(perVisit(80_000));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('보류 그룹과 한도를 공유하는 그룹은 참고 그룹에 넣지 않는다 (AC-004d 후반)', () => {
  it('같은 풀의 한 그룹이 그룹 단위 보류(PROFILE_FORMULA_UNSUPPORTED)이면 풀의 나머지 그룹은 referenceGroups 에 없고 P_pooled 는 null', () => {
    const groups = [
      group(G1, FIXED_10K, perVisit(250_000), POOL),
      group(G2, { kind: 'TIERED' } as unknown as DeductionRule, perVisit(250_000), POOL),
      group('TEST_GROUP_THREE', FIXED_10K, perVisit(250_000)),
    ];
    const pools: SharedLimitPool[] = [{ poolKey: POOL, limit: perVisit(80_000) }];
    const lines = [makeLine(T_ULTRA, 70_000), makeLine(T_INJECT, 40_000), makeLine('T-THIRD', 30_000)];
    const result = runEstimate(
      caseInput({ groups, pools, lines, assign: { [T_ULTRA]: G1, [T_INJECT]: G2, 'T-THIRD': 'TEST_GROUP_THREE' } }),
    );
    expect(result.state).toBe('ON_HOLD');
    expect(result.groups.find((entry) => entry.groupKey === G1)).toMatchObject({ state: 'ESTIMATED', P: 60_000, P_pooled: null });
    expect(result.groups.find((entry) => entry.groupKey === G2)).toMatchObject({ state: 'ON_HOLD', holdReason: 'PROFILE_FORMULA_UNSUPPORTED' });
    // 풀과 무관한 그룹만 참고 그룹이다.
    expect(result.referenceGroups).toEqual([{ groupKey: 'TEST_GROUP_THREE', P: 20_000, isReference: true }]);
  });

  it('보류가 없는 풀은 전체가 ON_HOLD 일 때(다른 줄 보류) 참고 그룹에 풀 적용 후 몫으로 들어간다', () => {
    const groups = [group(G1, FIXED_10K, perVisit(250_000), POOL), group(G2, FIXED_10K, perVisit(250_000), POOL)];
    const pools: SharedLimitPool[] = [{ poolKey: POOL, limit: perVisit(80_000) }];
    const lines = [makeLine(T_ULTRA, 70_000), makeLine(T_INJECT, 40_000), makeLine('T-UNMAPPED', 5_000)];
    const mappingsFor = [T_ULTRA, T_INJECT];
    const base = caseInput({ groups, pools, lines, assign: { [T_ULTRA]: G1, [T_INJECT]: G2 } });
    // 미매핑 줄 하나만 보류시키기 위해 그 줄의 매핑을 뺀다.
    const bundle = { ...base.bundle!, mappings: base.bundle!.mappings.filter((mapping) => mappingsFor.includes(mapping.treatmentId)) };
    const result = runEstimate({ ...base, bundle });
    expect(result.state).toBe('ON_HOLD');
    expect(result.referenceGroups).toEqual([
      { groupKey: G1, P: 60_000, isReference: true },
      { groupKey: G2, P: 20_000, isReference: true },
    ]);
    expect(result.amounts.expectedInsurancePayout).toBeNull();
  });
});

describe('풀의 멤버 가운데 줄이 하나도 없는 그룹은 배분에 끼지 않는다', () => {
  it('줄이 없는 멤버 그룹은 결과에 나오지 않고 남은 한도를 쓰지 않는다', () => {
    const groups = [
      group(G1, FIXED_10K, perVisit(250_000), POOL),
      group(G2, FIXED_10K, perVisit(250_000), POOL),
    ];
    const pools: SharedLimitPool[] = [{ poolKey: POOL, limit: perVisit(50_000) }];
    const result = runEstimate(caseInput({ groups, pools, assign: { [T_ULTRA]: G1 }, lines: [makeLine(T_ULTRA, 70_000)] }));
    expect(result.groups.map((entry) => entry.groupKey)).toEqual([G1]);
    expect(result.groups[0]).toMatchObject({ P: 60_000, P_pooled: 50_000 });
  });
});
