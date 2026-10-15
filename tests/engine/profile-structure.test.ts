import { describe, expect, it } from 'vitest';
import { checkProfileStructure } from '../../src/engine/profile-structure';
import type { StandardAssumptionProfile } from '../../src/engine/types';
import { makeProfile, testGroups } from '../fixtures/engine/profiles.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.
// 구조 검사는 입력만으로 결과가 정해지는 순수 함수다 (design.md DD-02 "프로필 구조 검사와 영향 범위").

const A = 'TEST_GROUP_BENEFIT';
const B = 'TEST_GROUP_NON_BENEFIT';
const POOL_LIMIT = { kind: 'PER_VISIT_PAYOUT', amount: 50_000, limitBasis: 'PAYOUT' } as const;

function profileWith(overrides: Partial<StandardAssumptionProfile>): StandardAssumptionProfile {
  return makeProfile(overrides);
}

describe('checkProfileStructure — 정상', () => {
  it('구조 결함이 없는 프로필은 ok 다', () => {
    expect(checkProfileStructure(makeProfile())).toEqual({ ok: true });
  });

  it('멤버 그룹이 하나도 없는 풀은 허용하며 아무 영향이 없다', () => {
    const profile = profileWith({ sharedLimitPools: [{ poolKey: 'TEST_POOL_EMPTY', limit: POOL_LIMIT }] });
    expect(checkProfileStructure(profile)).toEqual({ ok: true });
  });

  it('풀의 한도 값 결함은 구조 결함이 아니다 (값 검사는 M1.3 의 그룹 값 검사가 한다)', () => {
    const profile = profileWith({
      sharedLimitPools: [{ poolKey: 'TEST_POOL_BAD_VALUE', limit: { ...POOL_LIMIT, amount: -1 } }],
    });
    expect(checkProfileStructure(profile)).toEqual({ ok: true });
  });

  it('그룹이 풀을 가리키고 풀이 존재하면 ok 다', () => {
    const groups = testGroups();
    groups[0] = { ...groups[0]!, sharedLimitPoolKey: 'TEST_POOL_1' };
    const profile = profileWith({ groups, sharedLimitPools: [{ poolKey: 'TEST_POOL_1', limit: POOL_LIMIT }] });
    expect(checkProfileStructure(profile)).toEqual({ ok: true });
  });

  it('입력 프로필을 바꾸지 않는다', () => {
    const profile = makeProfile();
    const before = JSON.stringify(profile);
    checkProfileStructure(profile);
    expect(JSON.stringify(profile)).toBe(before);
  });
});

describe('checkProfileStructure — 구조 결함 아홉 가지 (AC-008a 구조 결함 행, 각각 따로)', () => {
  it('1. 그룹이 하나도 없는 빈 프로필 → EMPTY_PROFILE', () => {
    const profile = profileWith({ groups: [], groupOrder: [] });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'EMPTY_PROFILE', path: 'groups' }],
    });
  });

  it('2. 빈 groupKey → EMPTY_GROUP_KEY', () => {
    const groups = testGroups();
    groups[0] = { ...groups[0]!, groupKey: '' };
    const profile = profileWith({ groups, groupOrder: ['', B] });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'EMPTY_GROUP_KEY', path: 'groups[0].groupKey' }],
    });
  });

  it('3. 중복 groupKey → DUPLICATE_GROUP_KEY (두 번째 등장 위치를 가리킨다)', () => {
    const groups = testGroups();
    groups[1] = { ...groups[1]!, groupKey: A };
    const profile = profileWith({ groups, groupOrder: [A] });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'DUPLICATE_GROUP_KEY', path: 'groups[1].groupKey' }],
    });
  });

  it('4. 빈 poolKey → EMPTY_POOL_KEY', () => {
    const profile = profileWith({ sharedLimitPools: [{ poolKey: '', limit: POOL_LIMIT }] });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'EMPTY_POOL_KEY', path: 'sharedLimitPools[0].poolKey' }],
    });
  });

  it('5. 중복 poolKey → DUPLICATE_POOL_KEY', () => {
    const profile = profileWith({
      sharedLimitPools: [
        { poolKey: 'TEST_POOL_1', limit: POOL_LIMIT },
        { poolKey: 'TEST_POOL_1', limit: POOL_LIMIT },
      ],
    });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'DUPLICATE_POOL_KEY', path: 'sharedLimitPools[1].poolKey' }],
    });
  });

  it('6. 없는 풀을 가리키는 sharedLimitPoolKey → UNKNOWN_POOL_REFERENCE', () => {
    const groups = testGroups();
    groups[1] = { ...groups[1]!, sharedLimitPoolKey: 'TEST_POOL_MISSING' };
    const profile = profileWith({ groups });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'UNKNOWN_POOL_REFERENCE', path: 'groups[1].sharedLimitPoolKey' }],
    });
  });

  it('7. groupOrder 에서 빠진 키 → GROUP_ORDER_MISSING_KEY', () => {
    const profile = profileWith({ groupOrder: [A] });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'GROUP_ORDER_MISSING_KEY', path: 'groupOrder' }],
    });
  });

  it('8. groupOrder 의 중복 키 → GROUP_ORDER_DUPLICATE_KEY', () => {
    const profile = profileWith({ groupOrder: [A, B, B] });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'GROUP_ORDER_DUPLICATE_KEY', path: 'groupOrder[2]' }],
    });
  });

  it('9. groupOrder 의 없는 키 → GROUP_ORDER_UNKNOWN_KEY', () => {
    const profile = profileWith({ groupOrder: [A, B, 'TEST_GROUP_GHOST'] });
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'GROUP_ORDER_UNKNOWN_KEY', path: 'groupOrder[2]' }],
    });
  });
});

describe('checkProfileStructure — 방어와 결정성', () => {
  it('groups 가 배열이 아니면 빈 프로필로 본다', () => {
    const profile = { ...makeProfile(), groups: undefined as unknown as never[] };
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [{ code: 'EMPTY_PROFILE', path: 'groups' }],
    });
  });

  it('groupKey 가 문자열이 아니면 빈 키로 본다', () => {
    const groups = testGroups();
    groups[0] = { ...groups[0]!, groupKey: 7 as unknown as string };
    const result = checkProfileStructure(profileWith({ groups, groupOrder: [B] }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.defects[0]).toEqual({ code: 'EMPTY_GROUP_KEY', path: 'groups[0].groupKey' });
  });

  it('groupOrder 가 배열이 아니면 모든 키가 빠진 것으로 본다', () => {
    const profile = { ...makeProfile(), groupOrder: undefined as unknown as string[] };
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [
        { code: 'GROUP_ORDER_MISSING_KEY', path: 'groupOrder' },
        { code: 'GROUP_ORDER_MISSING_KEY', path: 'groupOrder' },
      ],
    });
  });

  // S1 외부 검토 수정으로 기대값을 바꾼 시험이다. 이전에는 배열이 아닌 sharedLimitPools 를 조용히 빈 목록으로 대신해
  // 풀 참조 결함 하나만 보고했다(참조가 없으면 ok 였고 이어지는 계산이 던졌다). 지금은 배열이 아닌 것 자체가
  // POOLS_NOT_ARRAY 결함이고, 풀 참조 검사만 풀이 없는 것으로 보고 이어서 보고한다. 상세 시험은 profile-structure-malformed.test.ts.
  it('sharedLimitPools 가 배열이 아니면 POOLS_NOT_ARRAY 결함이고 풀 참조는 풀이 없는 것으로 보고 이어서 보고한다', () => {
    const groups = testGroups();
    groups[0] = { ...groups[0]!, sharedLimitPoolKey: 'TEST_POOL_1' };
    const profile = { ...profileWith({ groups }), sharedLimitPools: undefined as unknown as never[] };
    expect(checkProfileStructure(profile)).toEqual({
      ok: false,
      defects: [
        { code: 'POOLS_NOT_ARRAY', path: 'sharedLimitPools' },
        { code: 'UNKNOWN_POOL_REFERENCE', path: 'groups[0].sharedLimitPoolKey' },
      ],
    });
  });

  it('결함이 여럿이면 모두 고정된 순서(그룹, 풀, 풀 참조, groupOrder)로 모은다', () => {
    const groups = testGroups();
    groups[0] = { ...groups[0]!, groupKey: '', sharedLimitPoolKey: 'TEST_POOL_MISSING' };
    const profile = profileWith({
      groups,
      sharedLimitPools: [{ poolKey: '', limit: POOL_LIMIT }],
      groupOrder: [B, B, 'TEST_GROUP_GHOST'],
    });
    const first = checkProfileStructure(profile);
    expect(first).toEqual({
      ok: false,
      defects: [
        { code: 'EMPTY_GROUP_KEY', path: 'groups[0].groupKey' },
        { code: 'EMPTY_POOL_KEY', path: 'sharedLimitPools[0].poolKey' },
        { code: 'UNKNOWN_POOL_REFERENCE', path: 'groups[0].sharedLimitPoolKey' },
        { code: 'GROUP_ORDER_MISSING_KEY', path: 'groupOrder' },
        { code: 'GROUP_ORDER_DUPLICATE_KEY', path: 'groupOrder[1]' },
        { code: 'GROUP_ORDER_UNKNOWN_KEY', path: 'groupOrder[2]' },
      ],
    });
    expect(checkProfileStructure(profile)).toEqual(first);
  });
});
