import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import { resolveProfile } from '../../src/engine/resolve';
import type { CoverageGroupDef, EstimateInput, SharedLimitPool, StandardAssumptionProfile } from '../../src/engine/types';
import { isUsable, profileContent, profileToRuleItem } from '../../src/engine/usability';
import type { UsabilityContext } from '../../src/engine/usability';
import { UNLIMITED, group, perVisit } from '../fixtures/engine/cases.fixture';
import { bundleWith, makeInput, makeLine } from '../fixtures/engine/lines.fixture';
import { makeMapping } from '../fixtures/engine/mappings.fixture';
import { TEST_AT, TEST_CELL, makeProfile, testDigest } from '../fixtures/engine/profiles.fixture';

// R2 외부 검토 수정: 프로필 내용 해시의 입력은 groups 를 groupKey 순으로, sharedLimitPools 를 poolKey 순으로 정규화한 사본이다
// (유니코드 코드 포인트 순, 안정 정렬). groupOrder 는 공유 한도 배분 순서를 정하는 데이터이므로 저장된 순서 그대로 해시 입력에 든다.
// 같은 규칙을 다른 배열 순서로 저장해도 같은 해시이고, 실제 규칙 값이 바뀌면 옛 해시와 어긋난다.
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.

const ctx: UsabilityContext = { at: TEST_AT, acceptedOrigins: ['OPERATING', 'TEST_FIXTURE'], digest: testDigest };

const GA = 'TEST_GROUP_A';
const GB = 'TEST_GROUP_B';
const GC = 'TEST_GROUP_C';
const GD = 'TEST_GROUP_D';
const P1 = 'TEST_POOL_1';
const P2 = 'TEST_POOL_2';
const P3 = 'TEST_POOL_3';

/** 저장 순서가 키 순서(A,B,C,D)와 다르고, groupOrder 는 저장 순서와도 키 순서와도 다르다. */
function originalGroups(): CoverageGroupDef[] {
  return [
    group(GC, { kind: 'FIXED', fixed: 1_000 }, UNLIMITED, P2),
    group(GA, { kind: 'FIXED', fixed: 1_000 }, perVisit(100_000), P1),
    group(GD, { kind: 'FIXED', fixed: 1_000 }, UNLIMITED),
    group(GB, { kind: 'FIXED', fixed: 1_000 }, perVisit(100_000), P1),
  ];
}
function originalPools(): SharedLimitPool[] {
  return [
    { poolKey: P2, limit: perVisit(12_000) },
    { poolKey: P3, limit: perVisit(1) },
    { poolKey: P1, limit: perVisit(60_000) },
  ];
}
const ORIGINAL_ORDER = [GB, GD, GA, GC];

const original: StandardAssumptionProfile = makeProfile({ groups: originalGroups(), sharedLimitPools: originalPools(), groupOrder: [...ORIGINAL_ORDER] });
const ORIGINAL_HASH = original.contentHash;

const LINES = [makeLine('T-A', 50_000), makeLine('T-B', 40_000), makeLine('T-C', 30_000), makeLine('T-D', 10_000)];
const MAPPINGS = [makeMapping('T-A', { groupKey: GA }), makeMapping('T-B', { groupKey: GB }), makeMapping('T-C', { groupKey: GC }), makeMapping('T-D', { groupKey: GD })];

function inputFor(profile: StandardAssumptionProfile): EstimateInput {
  return makeInput({ lines: LINES, treatmentIds: LINES.map((line) => line.treatmentId), bundle: bundleWith(profile, MAPPINGS) });
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** 옛 해시를 그대로 둔 채 내용만 바꾼 프로필. 해시를 다시 만들지 않는다. */
function withOldHash(changes: Partial<StandardAssumptionProfile>): StandardAssumptionProfile {
  return { ...original, ...changes, contentHash: ORIGINAL_HASH };
}

function expectUsable(profile: StandardAssumptionProfile, label: string): void {
  expect(isUsable(profileToRuleItem(profile), ctx), label).toEqual({ usable: true });
  expect(resolveProfile(bundleWith(profile, MAPPINGS), TEST_CELL, ctx), label).toEqual({ resolved: true, profile });
}

function expectIntegrityFailure(profile: StandardAssumptionProfile, label: string): void {
  expect(isUsable(profileToRuleItem(profile), ctx), label).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  expect(resolveProfile(bundleWith(profile, MAPPINGS), TEST_CELL, ctx), label).toEqual({ resolved: false, code: 'PROFILE_INVALID' });
  const outcome = estimate(inputFor(profile), { digest: testDigest });
  if (!outcome.ok) throw new Error(`${label}: 거절되었다`);
  expect(outcome.result.state, label).toBe('ON_HOLD');
  expect(outcome.result.amounts.expectedInsurancePayout, label).toBeNull();
  expect(outcome.result.lines.every((line) => line.state === 'ON_HOLD' && line.holdReason === 'PROFILE_INVALID'), label).toBe(true);
}

describe('기준 프로필 확인 (빈 시험 방지)', () => {
  it('그룹 4개·풀 3개이고 저장 순서는 키 순서와 다르며, 해시는 독립적으로 정규화한 내용의 해시와 같다', () => {
    expect(original.groups).toHaveLength(4);
    expect(original.sharedLimitPools).toHaveLength(3);
    expect(original.groups.map((entry) => entry.groupKey)).not.toEqual([GA, GB, GC, GD]);
    expect(original.sharedLimitPools.map((entry) => entry.poolKey)).not.toEqual([P1, P2, P3]);
    // 정규화 오라클: 키 순서로 직접 정렬한 내용의 해시. profileContent 를 거치지 않는다.
    const byKey = <T,>(items: T[], key: (item: T) => string) => [...items].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
    const expected = testDigest({
      id: original.id,
      version: original.version,
      generation: original.generation,
      insurerType: original.insurerType,
      groups: byKey(original.groups, (entry) => entry.groupKey),
      groupOrder: ORIGINAL_ORDER,
      sharedLimitPools: byKey(original.sharedLimitPools, (entry) => entry.poolKey),
    });
    expect(ORIGINAL_HASH).toBe(expected);
    expectUsable(original, '원본');
  });

  it('해시 입력은 키 순서로 정렬된 사본이다: groups 와 sharedLimitPools 는 정렬되고 groupOrder 는 저장된 순서 그대로다', () => {
    const content = profileContent(original) as { groups: CoverageGroupDef[]; sharedLimitPools: SharedLimitPool[]; groupOrder: string[] };
    expect(content.groups.map((entry) => entry.groupKey)).toEqual([GA, GB, GC, GD]);
    expect(content.sharedLimitPools.map((entry) => entry.poolKey)).toEqual([P1, P2, P3]);
    expect(content.groupOrder).toEqual(ORIGINAL_ORDER);
    expect(content.groups).not.toBe(original.groups); // 사본이다
    expect(content.sharedLimitPools).not.toBe(original.sharedLimitPools);
  });

  it('시험용 해시 대역은 객체 키 삽입 순서에 영향을 받지 않는다 (운영 해시도 같은 성질이어야 한다: M3 책임)', () => {
    expect(testDigest({ a: 1, b: { c: 2, d: [{ x: 1, y: 2 }] } })).toBe(testDigest({ b: { d: [{ y: 2, x: 1 }], c: 2 }, a: 1 }));
    // 배열 요소의 순서는 해시를 바꾼다: 배열 정규화는 profileContent 의 몫이다.
    expect(testDigest({ list: [1, 2] })).not.toBe(testDigest({ list: [2, 1] }));
  });
});

describe('groups·sharedLimitPools 저장 순서가 달라도 같은 해시 입력이고, 옛 해시를 다시 만들지 않고 그대로 쓴다', () => {
  const groupPerms = permutations(originalGroups());
  const poolPerms = permutations(originalPools());

  it('그룹 순열 24가지 × 풀 순열 6가지(곱 144가지) 모두: 내용 JSON 동일, 옛 해시와 일치, 사용 가능', () => {
    expect(groupPerms).toHaveLength(24);
    expect(poolPerms).toHaveLength(6);
    const baseline = JSON.stringify(profileContent(original));
    let checked = 0;
    for (const groups of groupPerms) {
      for (const pools of poolPerms) {
        const reordered: StandardAssumptionProfile = { ...original, groups, sharedLimitPools: pools, contentHash: ORIGINAL_HASH };
        const label = `${groups.map((entry) => entry.groupKey).join('')}/${pools.map((entry) => entry.poolKey).join('')}`;
        expect(JSON.stringify(profileContent(reordered)), label).toBe(baseline);
        expect(testDigest(profileContent(reordered)), label).toBe(ORIGINAL_HASH);
        expectUsable(reordered, label);
        checked += 1;
      }
    }
    expect(checked).toBe(144);
  });

  it('그룹만, 풀만 바꾼 경우도 각각 확인한다 (단독 순열)', () => {
    for (const groups of groupPerms) expectUsable({ ...original, groups, contentHash: ORIGINAL_HASH }, 'groups');
    for (const pools of poolPerms) expectUsable({ ...original, sharedLimitPools: pools, contentHash: ORIGINAL_HASH }, 'pools');
  });

  it('저장 순서가 달라도 계산 결과는 바이트 단위로 같다 (공유 한도 배분은 groupOrder 가 정하며 풀이 실제로 금액을 줄인다)', () => {
    const baseline = estimate(inputFor(original), { digest: testDigest });
    if (!baseline.ok) throw new Error('unreachable');
    expect(baseline.result.state).toBe('ESTIMATED');
    const pooled = baseline.result.groups.map((entry) => [entry.groupKey, entry.P, entry.P_pooled]);
    // 풀 P1(한도 60,000): groupOrder 에서 B 가 A 보다 앞이므로 B 가 39,000 을 먼저 가져가고 A 는 21,000 만 남는다.
    expect(pooled).toEqual([
      [GB, 39_000, 39_000],
      [GD, 9_000, 9_000],
      [GA, 49_000, 21_000],
      [GC, 29_000, 12_000],
    ]);
    const expected = JSON.stringify(baseline);
    let compared = 0;
    for (const groups of groupPerms) {
      for (const pools of poolPerms) {
        const reordered: StandardAssumptionProfile = { ...original, groups, sharedLimitPools: pools, contentHash: ORIGINAL_HASH };
        expect(JSON.stringify(estimate(inputFor(reordered), { digest: testDigest }))).toBe(expected);
        compared += 1;
      }
    }
    expect(compared).toBe(144);
  });
});

describe('실제 규칙 값이 바뀌면 옛 해시와 어긋나 INTEGRITY_MISMATCH → PROFILE_INVALID 다 (같은 공개 경로로 확인)', () => {
  const mapGroup = (key: string, change: (entry: CoverageGroupDef) => CoverageGroupDef) =>
    originalGroups().map((entry) => (entry.groupKey === key ? change(entry) : entry));

  const cases: Array<[string, Partial<StandardAssumptionProfile>]> = [
    ['공제 고정액', { groups: mapGroup(GA, (entry) => ({ ...entry, deduction: { kind: 'FIXED', fixed: 1_001 } })) }],
    ['공제 방식', { groups: mapGroup(GA, (entry) => ({ ...entry, deduction: { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 1_000, rounding: 'TRUNCATE' } })) }],
    ['그룹 한도 금액', { groups: mapGroup(GB, (entry) => ({ ...entry, limit: perVisit(99_999) })) }],
    ['그룹의 sharedLimitPoolKey (다른 풀로)', { groups: mapGroup(GA, (entry) => ({ ...entry, sharedLimitPoolKey: P2 })) }],
    ['그룹의 sharedLimitPoolKey (제거)', { groups: mapGroup(GA, ({ sharedLimitPoolKey: _removed, ...rest }) => rest) }],
    ['풀 한도 금액', { sharedLimitPools: originalPools().map((entry) => (entry.poolKey === P1 ? { ...entry, limit: perVisit(59_999) } : entry)) }],
    ['groupKey 이름 바꿈 (정렬 위치는 같음)', { groups: mapGroup(GD, (entry) => ({ ...entry, groupKey: 'TEST_GROUP_E' })) }],
    ['그룹 추가', { groups: [...originalGroups(), group('TEST_GROUP_E', { kind: 'FIXED', fixed: 5 }, UNLIMITED)] }],
    ['그룹 제거', { groups: originalGroups().filter((entry) => entry.groupKey !== GD) }],
    ['풀 추가', { sharedLimitPools: [...originalPools(), { poolKey: 'TEST_POOL_4', limit: perVisit(2) }] }],
    ['풀 제거', { sharedLimitPools: originalPools().filter((entry) => entry.poolKey !== P3) }],
    ['풀 이름 바꿈', { sharedLimitPools: originalPools().map((entry) => (entry.poolKey === P3 ? { ...entry, poolKey: 'TEST_POOL_9' } : entry)) }],
    ['프로필 버전', { version: 'v2' }],
  ];

  it.each(cases)('%s', (_name, changes) => {
    const changed = withOldHash(changes);
    expect(testDigest(profileContent(changed))).not.toBe(ORIGINAL_HASH);
    expectIntegrityFailure(changed, _name);
  });

  it('값을 바꾸고 순서도 바꾼 경우도 순서가 아니라 값 때문에 어긋난다', () => {
    const groups = mapGroup(GA, (entry) => ({ ...entry, deduction: { kind: 'FIXED' as const, fixed: 1_001 } })).reverse();
    expectIntegrityFailure(withOldHash({ groups }), '값+순서');
  });
});

describe('groupOrder 는 의미 있는 데이터다: 순서를 바꾸면 해시 입력이 바뀌고 옛 해시와 어긋난다', () => {
  const orders = permutations(ORIGINAL_ORDER).filter((order) => order.join() !== ORIGINAL_ORDER.join());

  it('groupKey 집합이 같은 다른 groupOrder(23가지)는 모두 해시 입력이 다르고 옛 해시와 어긋난다', () => {
    expect(orders).toHaveLength(23);
    const baseline = JSON.stringify(profileContent(original));
    for (const order of orders) {
      const changed = withOldHash({ groupOrder: order });
      expect(JSON.stringify(profileContent(changed)), order.join()).not.toBe(baseline);
      expect(testDigest(profileContent(changed)), order.join()).not.toBe(ORIGINAL_HASH);
      expectIntegrityFailure(changed, order.join());
    }
  });

  it('groupOrder 는 정렬되지 않는다: 해시 입력의 groupOrder 는 저장된 순서이며 groups 를 어떻게 섞어도 그대로다', () => {
    for (const groups of permutations(originalGroups()).slice(0, 6)) {
      const content = profileContent({ ...original, groups }) as { groupOrder: string[] };
      expect(content.groupOrder).toEqual(ORIGINAL_ORDER);
    }
  });

  it('유효해 보이는 다른 groupOrder 로 해시를 다시 만들면 공유 한도 배분 결과가 실제로 달라진다', () => {
    const swapped = makeProfile({ groups: originalGroups(), sharedLimitPools: originalPools(), groupOrder: [GA, GB, GC, GD] });
    expect(swapped.contentHash).not.toBe(ORIGINAL_HASH);
    const outcome = estimate(inputFor(swapped), { digest: testDigest });
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.result.groups.map((entry) => [entry.groupKey, entry.P_pooled])).toEqual([
      [GA, 49_000],
      [GB, 11_000],
      [GC, 12_000],
      [GD, 9_000],
    ]);
  });
});

describe('입력을 바꾸지 않는다', () => {
  it('깊게 얼린 프로필로 profileContent·profileToRuleItem·isUsable·resolveProfile 이 던지지 않고 원본이 그대로다', () => {
    const frozen = deepFreeze(structuredClone(original));
    const snapshot = structuredClone(original);
    expect(() => profileContent(frozen)).not.toThrow();
    expect(() => profileToRuleItem(frozen)).not.toThrow();
    expectUsable(frozen, '얼린 프로필');
    expect(frozen).toEqual(snapshot);
    expect(frozen.groups.map((entry) => entry.groupKey)).toEqual(snapshot.groups.map((entry) => entry.groupKey)); // 정렬이 원본 배열에 일어나지 않았다
  });
});

describe('구조가 잘못된 프로필도 던지지 않고 고쳐 쓰지 않는다', () => {
  const asProfile = (changes: Record<string, unknown>) => ({ ...original, ...changes }) as unknown as StandardAssumptionProfile;
  const contentOf = (profile: StandardAssumptionProfile) => profileContent(profile) as { groups: unknown; sharedLimitPools: unknown };

  const malformed: Array<[string, Record<string, unknown>]> = [
    ['groups 가 null', { groups: null }],
    ['groups 가 배열이 아닌 객체', { groups: { groupKey: GA } }],
    ['groups 가 문자열', { groups: 'abc' }],
    ['groups 에 null 항목', { groups: [null, ...originalGroups()] }],
    ['groups 에 숫자 항목', { groups: [7, ...originalGroups()] }],
    ['groupKey 가 숫자인 그룹', { groups: [{ groupKey: 5 }, ...originalGroups()] }],
    ['groupKey 가 없는 그룹', { groups: [{ deduction: { kind: 'FIXED', fixed: 1 } }, ...originalGroups()] }],
    ['sharedLimitPools 가 undefined', { sharedLimitPools: undefined }],
    ['sharedLimitPools 가 null', { sharedLimitPools: null }],
    ['sharedLimitPools 에 null 항목', { sharedLimitPools: [null, ...originalPools()] }],
    ['poolKey 가 숫자인 풀', { sharedLimitPools: [{ poolKey: 3, limit: perVisit(1) }, ...originalPools()] }],
    ['poolKey 가 없는 풀', { sharedLimitPools: [{ limit: perVisit(1) }, ...originalPools()] }],
    ['groupOrder 가 null', { groupOrder: null }],
  ];

  it.each(malformed)('%s: profileContent·profileToRuleItem 이 던지지 않는다', (_name, changes) => {
    const profile = asProfile(changes);
    expect(() => profileContent(profile)).not.toThrow();
    expect(() => profileToRuleItem(profile)).not.toThrow();
  });

  it('배열이 아니거나 키가 문자열이 아닌 항목이 섞인 배열은 순서를 그대로 둔다 (정렬로 유효해 보이게 만들지 않는다)', () => {
    const groupsAsObject = { groupKey: GA };
    expect(contentOf(asProfile({ groups: groupsAsObject })).groups).toBe(groupsAsObject);
    expect(contentOf(asProfile({ groups: null })).groups).toBeNull();
    expect(contentOf(asProfile({ sharedLimitPools: undefined })).sharedLimitPools).toBeUndefined();

    const mixedGroups = [{ groupKey: 'B' }, { groupKey: 5 }, null, { groupKey: 'A' }];
    expect(contentOf(asProfile({ groups: mixedGroups })).groups).toEqual([{ groupKey: 'B' }, { groupKey: 5 }, null, { groupKey: 'A' }]);
    const mixedPools = [{ poolKey: 'Z' }, { limit: 1 }, { poolKey: 'A' }];
    expect(contentOf(asProfile({ sharedLimitPools: mixedPools })).sharedLimitPools).toEqual([{ poolKey: 'Z' }, { limit: 1 }, { poolKey: 'A' }]);
    // 입력 배열 자체는 바뀌지 않는다.
    expect(mixedGroups.map((entry) => (entry === null ? null : entry.groupKey))).toEqual(['B', 5, null, 'A']);
  });

  it('중복 키는 안정 정렬로 입력 순서를 유지하고(하나로 합치지 않는다) 두 항목 모두 해시 입력에 남는다', () => {
    const duplicated = [{ groupKey: 'B', mark: 1 }, { groupKey: 'A', mark: 2 }, { groupKey: 'B', mark: 3 }];
    expect(contentOf(asProfile({ groups: duplicated })).groups).toEqual([
      { groupKey: 'A', mark: 2 },
      { groupKey: 'B', mark: 1 },
      { groupKey: 'B', mark: 3 },
    ]);
  });

  it('유니코드 코드 포인트 순이다 (대문자가 소문자보다 앞, "10" 이 "2" 보다 앞, 보충 문자는 BMP 문자 뒤)', () => {
    const keys = ['b', 'B', '2', '10', '\u{1F600}', '～', '가'];
    const groups = keys.map((groupKey) => ({ groupKey }));
    const sorted = (contentOf(asProfile({ groups })).groups as Array<{ groupKey: string }>).map((entry) => entry.groupKey);
    expect(sorted).toEqual(['10', '2', 'B', 'b', '가', '～', '\u{1F600}']);
  });
});

describe('구조 결함은 해시가 맞아도 PROFILE_INVALID 로 거절된다 (profile-structure.ts, resolveProfile 의 구조 검사)', () => {
  it('groupKey 가 중복된 프로필: 해시는 자기 내용에 맞아 무결성은 통과하지만 구조 검사에서 PROFILE_INVALID 이고 계산은 보류된다', () => {
    const duplicated = makeProfile({
      groups: [group(GA, { kind: 'FIXED', fixed: 1_000 }, UNLIMITED), group(GA, { kind: 'FIXED', fixed: 2_000 }, UNLIMITED)],
      groupOrder: [GA, GA],
    });
    expect(isUsable(profileToRuleItem(duplicated), ctx)).toEqual({ usable: true });
    expect(resolveProfile(bundleWith(duplicated, MAPPINGS), TEST_CELL, ctx)).toEqual({ resolved: false, code: 'PROFILE_INVALID' });
    const outcome = estimate(inputFor(duplicated), { digest: testDigest });
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.result.state).toBe('ON_HOLD');
    expect(outcome.result.lines.every((line) => line.holdReason === 'PROFILE_INVALID')).toBe(true);
    expect(outcome.result.amounts.expectedInsurancePayout).toBeNull();
  });

  it('중복 groupKey 항목의 입력 순서를 바꾸면 해시 입력이 달라지지만(합치지 않음) 어느 쪽이든 구조 검사로 거절된다', () => {
    const first = group(GA, { kind: 'FIXED', fixed: 1_000 }, UNLIMITED);
    const second = group(GA, { kind: 'FIXED', fixed: 2_000 }, UNLIMITED);
    const one = makeProfile({ groups: [first, second], groupOrder: [GA, GA] });
    const other = makeProfile({ groups: [second, first], groupOrder: [GA, GA] });
    expect(JSON.stringify(profileContent(one))).not.toBe(JSON.stringify(profileContent(other)));
    for (const profile of [one, other]) {
      expect(resolveProfile(bundleWith(profile, MAPPINGS), TEST_CELL, ctx)).toEqual({ resolved: false, code: 'PROFILE_INVALID' });
    }
  });

  it('poolKey 가 중복된 프로필도 PROFILE_INVALID 이다', () => {
    const duplicated = makeProfile({
      groups: originalGroups(),
      groupOrder: [...ORIGINAL_ORDER],
      sharedLimitPools: [...originalPools(), { poolKey: P1, limit: perVisit(5) }],
    });
    expect(isUsable(profileToRuleItem(duplicated), ctx)).toEqual({ usable: true });
    expect(resolveProfile(bundleWith(duplicated, MAPPINGS), TEST_CELL, ctx)).toEqual({ resolved: false, code: 'PROFILE_INVALID' });
  });
});
