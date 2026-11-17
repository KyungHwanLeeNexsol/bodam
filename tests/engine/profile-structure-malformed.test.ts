import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import { checkProfileStructure } from '../../src/engine/profile-structure';
import type { ProfileStructureDefect } from '../../src/engine/profile-structure';
import { resolveProfile } from '../../src/engine/resolve';
import type { EstimateInput, SharedLimitPool, StandardAssumptionProfile } from '../../src/engine/types';
import { isUsable, profileContent, profileToRuleItem } from '../../src/engine/usability';
import type { UsabilityContext } from '../../src/engine/usability';
import { CASE_D, CASE_D_ASSIGN, G_BENEFIT, G_NON_BENEFIT, caseInput, group, perVisit } from '../fixtures/engine/cases.fixture';
import { bundleWith, exampleBaseFeeLine, makeInput } from '../fixtures/engine/lines.fixture';
import { TEST_AT, TEST_CELL, makeProfile, testDigest, testGroups, withValidHash } from '../fixtures/engine/profiles.fixture';

// S1 외부 검토 수정: 잘못된 프로필 구조(그룹·풀 항목이 null 이거나 객체가 아님, sharedLimitPools 가 배열이 아님)는
// 예외 없이 구조 결함이 되어 기존 PROFILE_INVALID 보류로 가야 한다. 해시는 잘못된 내용 자체에 맞춰 만들어(무결성 통과)
// 구조 검사까지 닿게 한다. 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.

const ctx: UsabilityContext = { at: TEST_AT, acceptedOrigins: ['OPERATING', 'TEST_FIXTURE'], digest: testDigest };
const [GA, GB] = testGroups();
const A = (GA as NonNullable<typeof GA>).groupKey;
const B = (GB as NonNullable<typeof GB>).groupKey;
const POOL = 'TEST_POOL_1';
const VALID_POOL: SharedLimitPool = { poolKey: POOL, limit: perVisit(50_000) };
const MISMATCHED_HASH = 'TEST_DIGEST_00000000';

/** 해시가 잘못된 내용에 맞는 프로필. makeProfile 은 groups 를 읽어 기본 groupOrder 를 만드므로 유효한 프로필 위에 덮어쓴다. */
function malformed(overrides: Record<string, unknown>): StandardAssumptionProfile {
  return withValidHash({ ...makeProfile(), ...overrides } as StandardAssumptionProfile);
}

function defectsOf(profile: StandardAssumptionProfile): ProfileStructureDefect[] {
  const result = checkProfileStructure(profile);
  if (result.ok) throw new Error('구조 결함을 기대했으나 ok 였다');
  return result.defects;
}

function inputFor(profile: StandardAssumptionProfile, withBaseFee = false): EstimateInput {
  return makeInput({ bundle: bundleWith(profile), ...(withBaseFee ? { baseFeeLines: [exampleBaseFeeLine()] } : {}) });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const ENTRY_SHAPES: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['숫자 7', 7],
  ['문자열 "x"', 'x'],
  ['빈 배열', []],
  ['배열 [1]', [1]],
  ['불리언 true', true],
];
const POOLS_CONTAINER_SHAPES: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['객체 {}', {}],
  ['유사 배열 {length:0}', { length: 0 }],
  ['문자열 "abc"', 'abc'],
  ['숫자 7', 7],
  ['불리언 true', true],
];

/** 모든 변형: 이름, 프로필, 기대 결함 목록. */
interface Variant {
  name: string;
  profile: StandardAssumptionProfile;
  defects: ProfileStructureDefect[];
}
function variants(): Variant[] {
  const list: Variant[] = [];
  for (const [name, entry] of ENTRY_SHAPES) {
    list.push({
      name: `그룹 항목 ${name}`,
      profile: malformed({ groups: [GA, entry, GB], groupOrder: [A, B] }),
      defects: [{ code: 'GROUP_ENTRY_INVALID', path: 'groups[1]' }],
    });
  }
  for (const [name, entry] of ENTRY_SHAPES) {
    list.push({
      name: `풀 항목 ${name}`,
      profile: malformed({ groups: [{ ...GA, sharedLimitPoolKey: POOL }, GB], groupOrder: [A, B], sharedLimitPools: [VALID_POOL, entry] }),
      defects: [{ code: 'POOL_ENTRY_INVALID', path: 'sharedLimitPools[1]' }],
    });
  }
  for (const [name, container] of POOLS_CONTAINER_SHAPES) {
    list.push({
      name: `sharedLimitPools ${name}`,
      profile: malformed({ sharedLimitPools: container }),
      defects: [{ code: 'POOLS_NOT_ARRAY', path: 'sharedLimitPools' }],
    });
  }
  return list;
}
const VARIANTS = variants();

describe('checkProfileStructure — 잘못된 모양은 던지지 않고 구조 결함이다', () => {
  it('변형 수 확인 (빈 시험 방지)', () => {
    expect(VARIANTS).toHaveLength(7 + 7 + 7);
  });

  it.each(VARIANTS.map((variant) => [variant.name, variant] as const))('%s -> ok:false 와 기대 결함, 던지지 않는다', (_name, variant) => {
    expect(() => checkProfileStructure(variant.profile)).not.toThrow();
    expect(checkProfileStructure(variant.profile)).toEqual({ ok: false, defects: variant.defects });
  });

  it('유효한 그룹 집합에 null 항목 하나가 섞여도 그 결함을 보고한다 (첫 항목·끝 항목도)', () => {
    expect(defectsOf(malformed({ groups: [null, GA, GB], groupOrder: [A, B] }))).toEqual([{ code: 'GROUP_ENTRY_INVALID', path: 'groups[0]' }]);
    expect(defectsOf(malformed({ groups: [GA, GB, null], groupOrder: [A, B] }))).toEqual([{ code: 'GROUP_ENTRY_INVALID', path: 'groups[2]' }]);
    expect(defectsOf(malformed({ groups: [GA, GB], groupOrder: [A, B], sharedLimitPools: [null, VALID_POOL] }))).toEqual([
      { code: 'POOL_ENTRY_INVALID', path: 'sharedLimitPools[0]' },
    ]);
  });

  it('잘못된 항목은 따라오는 EMPTY_GROUP_KEY·EMPTY_POOL_KEY 같은 잡음을 만들지 않는다 (항목 하나에 결함 하나)', () => {
    expect(defectsOf(malformed({ groups: [null, null, GA, GB], groupOrder: [A, B] }))).toEqual([
      { code: 'GROUP_ENTRY_INVALID', path: 'groups[0]' },
      { code: 'GROUP_ENTRY_INVALID', path: 'groups[1]' },
    ]);
    expect(defectsOf(malformed({ sharedLimitPools: [null, 7, 'x'] }))).toEqual([
      { code: 'POOL_ENTRY_INVALID', path: 'sharedLimitPools[0]' },
      { code: 'POOL_ENTRY_INVALID', path: 'sharedLimitPools[1]' },
      { code: 'POOL_ENTRY_INVALID', path: 'sharedLimitPools[2]' },
    ]);
  });

  it('모든 그룹 항목이 잘못되어도 던지지 않는다 (groupOrder 의 키는 없는 키가 된다)', () => {
    const result = checkProfileStructure(malformed({ groups: [null, 7], groupOrder: [A, B] }));
    expect(result).toEqual({
      ok: false,
      defects: [
        { code: 'GROUP_ENTRY_INVALID', path: 'groups[0]' },
        { code: 'GROUP_ENTRY_INVALID', path: 'groups[1]' },
        { code: 'GROUP_ORDER_UNKNOWN_KEY', path: 'groupOrder[0]' },
        { code: 'GROUP_ORDER_UNKNOWN_KEY', path: 'groupOrder[1]' },
      ],
    });
  });

  it('sharedLimitPools 가 배열이 아니면 빈 목록으로 대신하지 않고 결함이다. 풀 참조는 풀이 없는 것으로 보고 이어서 보고한다', () => {
    for (const [, container] of POOLS_CONTAINER_SHAPES) {
      expect(defectsOf(malformed({ sharedLimitPools: container, groups: [{ ...GA, sharedLimitPoolKey: POOL }, GB] }))).toEqual([
        { code: 'POOLS_NOT_ARRAY', path: 'sharedLimitPools' },
        { code: 'UNKNOWN_POOL_REFERENCE', path: 'groups[0].sharedLimitPoolKey' },
      ]);
    }
  });

  it('진짜 빈 배열 []은 풀 참조가 없으면 계속 유효하다 (정상 프로필도 그대로 ok)', () => {
    expect(checkProfileStructure(malformed({ sharedLimitPools: [] }))).toEqual({ ok: true });
    expect(checkProfileStructure(makeProfile())).toEqual({ ok: true });
    expect(checkProfileStructure(malformed({ groups: [{ ...GA, sharedLimitPoolKey: POOL }, GB], sharedLimitPools: [VALID_POOL] }))).toEqual({ ok: true });
  });

  it('결함 순서는 고정이다: 그룹(키·항목) → 풀(배열 여부·항목·키) → 풀 참조 → groupOrder', () => {
    const profile = malformed({
      groups: [{ ...GA, groupKey: '', sharedLimitPoolKey: 'TEST_POOL_MISSING' }, null, GB],
      sharedLimitPools: [null, { poolKey: '', limit: perVisit(1) }],
      groupOrder: [B, B, 'TEST_GROUP_GHOST'],
    });
    const expected = [
      { code: 'EMPTY_GROUP_KEY', path: 'groups[0].groupKey' },
      { code: 'GROUP_ENTRY_INVALID', path: 'groups[1]' },
      { code: 'POOL_ENTRY_INVALID', path: 'sharedLimitPools[0]' },
      { code: 'EMPTY_POOL_KEY', path: 'sharedLimitPools[1].poolKey' },
      { code: 'UNKNOWN_POOL_REFERENCE', path: 'groups[0].sharedLimitPoolKey' },
      { code: 'GROUP_ORDER_MISSING_KEY', path: 'groupOrder' },
      { code: 'GROUP_ORDER_DUPLICATE_KEY', path: 'groupOrder[1]' },
      { code: 'GROUP_ORDER_UNKNOWN_KEY', path: 'groupOrder[2]' },
    ];
    expect(defectsOf(profile)).toEqual(expected);
    expect(defectsOf(profile)).toEqual(expected); // 같은 입력은 같은 순서
    const notArray = malformed({
      groups: [{ ...GA, groupKey: '', sharedLimitPoolKey: 'TEST_POOL_MISSING' }, GB],
      sharedLimitPools: 'abc',
      groupOrder: [B],
    });
    expect(defectsOf(notArray).map((defect) => defect.code)).toEqual(['EMPTY_GROUP_KEY', 'POOLS_NOT_ARRAY', 'UNKNOWN_POOL_REFERENCE', 'GROUP_ORDER_MISSING_KEY']);
  });

  it('groups 가 없거나 비어 있거나 배열이 아니면 이전처럼 EMPTY_PROFILE 하나다 (조기 반환 유지)', () => {
    for (const groups of [[], null, undefined, {}, 'abc', 7]) {
      expect(checkProfileStructure(malformed({ groups, groupOrder: [], sharedLimitPools: null }))).toEqual({
        ok: false,
        defects: [{ code: 'EMPTY_PROFILE', path: 'groups' }],
      });
    }
  });

  it('입력을 바꾸지 않는다 (깊게 얼린 프로필)', () => {
    for (const variant of VARIANTS) {
      const frozen = deepFreeze(structuredClone(variant.profile));
      const snapshot = structuredClone(variant.profile);
      expect(checkProfileStructure(frozen)).toEqual({ ok: false, defects: variant.defects });
      expect(frozen, variant.name).toEqual(snapshot);
    }
  });
});

describe('해시 입력(profileContent·profileToRuleItem)은 같은 모양에서도 던지지 않는다', () => {
  it.each(VARIANTS.map((variant) => [variant.name, variant] as const))('%s', (_name, variant) => {
    expect(() => profileContent(variant.profile)).not.toThrow();
    expect(() => profileToRuleItem(variant.profile)).not.toThrow();
    // 해시는 잘못된 내용 자체에 맞게 만들었으므로 무결성은 통과한다 -> 구조 검사까지 닿는다.
    expect(isUsable(profileToRuleItem(variant.profile), ctx)).toEqual({ usable: true });
  });
});

describe('resolveProfile — 기존 PROFILE_INVALID 보류로 간다', () => {
  it.each(VARIANTS.map((variant) => [variant.name, variant] as const))('%s -> {resolved:false, code:PROFILE_INVALID}, 던지지 않는다', (_name, variant) => {
    const bundle = bundleWith(variant.profile);
    expect(() => resolveProfile(bundle, TEST_CELL, ctx)).not.toThrow();
    expect(resolveProfile(bundle, TEST_CELL, ctx)).toEqual({ resolved: false, code: 'PROFILE_INVALID' });
  });

  it('해시가 맞지 않으면 구조 검사 전에 무결성에서 PROFILE_INVALID 다 (기존 순서: 무결성 → 구조). 구조 검사는 부르지 않는다', () => {
    for (const variant of VARIANTS) {
      const mismatched = { ...variant.profile, contentHash: MISMATCHED_HASH };
      let structureCalls = 0;
      const deps = {
        isUsable,
        checkProfileStructure: (profile: StandardAssumptionProfile) => {
          structureCalls += 1;
          return checkProfileStructure(profile);
        },
      };
      expect(isUsable(profileToRuleItem(mismatched), ctx), variant.name).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
      expect(resolveProfile(bundleWith(mismatched), TEST_CELL, ctx, deps), variant.name).toEqual({ resolved: false, code: 'PROFILE_INVALID' });
      expect(structureCalls, variant.name).toBe(0);
    }
  });
});

describe('estimate() 끝에서 끝까지 — 예외 없이 전체 ON_HOLD, 모든 줄 PROFILE_INVALID, 보험금 숫자 없음', () => {
  // 기준: 이미 있는 구조 결함(중복 groupKey) 프로필의 결과 모양. 새 결과 모양을 만들지 않는다.
  const duplicateKeys = malformed({ groups: [GA, { ...GB, groupKey: A }], groupOrder: [A] });

  it.each([false, true])('기본비용 줄 %s', (withBaseFee) => {
    const reference = estimate(inputFor(duplicateKeys, withBaseFee), { digest: testDigest });
    if (!reference.ok) throw new Error('unreachable');
    expect(reference.result.state).toBe('ON_HOLD');

    const hospitalPayment = withBaseFee ? 129_000 : 124_000; // 예시 4종 124,000 (+ 기본비용 5,000)
    for (const variant of VARIANTS) {
      const outcome = estimate(inputFor(variant.profile, withBaseFee), { digest: testDigest });
      if (!outcome.ok) throw new Error(`${variant.name}: 거절되었다`);
      const result = outcome.result;
      expect(result.state, variant.name).toBe('ON_HOLD');
      expect(result.lines.length, variant.name).toBe(withBaseFee ? 5 : 4);
      expect(result.lines.every((line) => line.state === 'ON_HOLD' && line.holdReason === 'PROFILE_INVALID'), variant.name).toBe(true);
      expect(result.amounts.hospitalPayment, variant.name).toBe(hospitalPayment);
      expect(result.amounts.expectedInsurancePayout, variant.name).toBeNull();
      expect(result.amounts.expectedOutOfPocketAfterPayout, variant.name).toBeNull();
      expect(result.amounts.baseFeeIncluded, variant.name).toBe(withBaseFee ? 'INCLUDED' : 'NOT_REGISTERED');
      expect(result.groups, variant.name).toEqual([]);
      expect(result.referenceGroups, variant.name).toEqual([]);
      expect(result.excludedItems, variant.name).toEqual([]);
      // 이미 있는 PROFILE_INVALID 결과와 모양이 같다.
      expect(result, variant.name).toEqual(reference.result);
    }
  });

  it('해시가 맞지 않는 같은 변형도 예외 없이 PROFILE_INVALID 다 (무결성 경로)', () => {
    for (const variant of VARIANTS) {
      const outcome = estimate(inputFor({ ...variant.profile, contentHash: MISMATCHED_HASH }), { digest: testDigest });
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.result.state, variant.name).toBe('ON_HOLD');
      expect(outcome.result.lines.every((line) => line.holdReason === 'PROFILE_INVALID'), variant.name).toBe(true);
      expect(outcome.result.amounts.expectedInsurancePayout, variant.name).toBeNull();
    }
  });

  it('입력을 바꾸지 않는다 (깊게 얼린 입력과 계산 뒤 비교)', () => {
    for (const variant of VARIANTS) {
      const input = inputFor(variant.profile, true);
      const snapshot = structuredClone(input);
      const frozen = deepFreeze(structuredClone(input));
      const outcome = estimate(frozen, { digest: testDigest });
      const plain = estimate(input, { digest: testDigest });
      expect(JSON.stringify(outcome), variant.name).toBe(JSON.stringify(plain));
      expect(input, variant.name).toEqual(snapshot);
    }
  });
});

describe('정상 프로필의 해시 입력·구조 검사·계산 결과는 수정 전과 같다 (수정 전 동작에서 구한 고정값)', () => {
  it('기본 프로필: 해시 입력 JSON, 해시, 구조 검사', () => {
    const profile = makeProfile();
    expect(JSON.stringify(profileContent(profile))).toBe(
      '{"id":"TEST_PROFILE_1","version":"v1","generation":"GEN4_C4","insurerType":"NON_LIFE","groups":[{"groupKey":"TEST_GROUP_BENEFIT","deduction":{"kind":"FIXED","fixed":1000},"limit":{"kind":"PER_VISIT_PAYOUT","amount":100000,"limitBasis":"PAYOUT"}},{"groupKey":"TEST_GROUP_NON_BENEFIT","deduction":{"kind":"FIXED","fixed":2000},"limit":{"kind":"PER_VISIT_PAYOUT","amount":200000,"limitBasis":"PAYOUT"}}],"groupOrder":["TEST_GROUP_BENEFIT","TEST_GROUP_NON_BENEFIT"],"sharedLimitPools":[]}',
    );
    expect(profile.contentHash).toBe('TEST_DIGEST_745503e9');
    expect(checkProfileStructure(profile)).toEqual({ ok: true });
  });

  it('계산 결과 전체의 시험용 해시: 기본 입력, 사례 D(두 그룹), 공유 한도 풀', () => {
    const profile = makeProfile();
    expect(testDigest(estimate(makeInput({ bundle: bundleWith(profile) }), { digest: testDigest }))).toBe('TEST_DIGEST_3cec813b');
    expect(testDigest(estimate(caseInput({ groups: CASE_D, assign: CASE_D_ASSIGN }), { digest: testDigest }))).toBe('TEST_DIGEST_ec1de793');
    const pooled = caseInput({
      groups: [
        group(G_BENEFIT, { kind: 'FIXED', fixed: 1_000 }, perVisit(100_000), 'TEST_POOL_P'),
        group(G_NON_BENEFIT, { kind: 'FIXED', fixed: 2_000 }, perVisit(100_000), 'TEST_POOL_P'),
      ],
      pools: [{ poolKey: 'TEST_POOL_P', limit: perVisit(30_000) }],
      assign: CASE_D_ASSIGN,
    });
    expect(testDigest(estimate(pooled, { digest: testDigest }))).toBe('TEST_DIGEST_78a047d8');
  });
});
