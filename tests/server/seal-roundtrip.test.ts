import { describe, expect, it } from 'vitest';
import { documentRuleSetContent, documentRuleSetToRuleItem, isUsable, profileContent, profileToRuleItem } from '../../src/engine/usability';
import type { UsabilityContext } from '../../src/engine/usability';
import type { CoverageGroupDef, DocumentRuleSet, StandardAssumptionProfile } from '../../src/engine/types';
import { canonicalDigest } from '../../src/server/digest';
import { toEngineDocumentRuleSet, toEngineProfile } from '../../src/server/domain/projection';
import { TEST_FIXTURE_APPROVER, TEST_AT, makeProfile } from '../fixtures/engine/profiles.fixture';
import { planningExampleRuleSet } from '../fixtures/engine/document-rules.fixture';
import { documentRuleSetRecord, profileRecord } from '../fixtures/server/items.fixture';
import { newRepo, transitionInput } from '../fixtures/server/repo.fixture';

// 기반 점검(AC-011a 의 소유는 M3.D): 운영 해시 canonicalDigest 로 봉인한 프로필·서류 규칙 묶음이
// 엔진의 같은 함수(profileContent / documentRuleSetContent / isUsable)로 검증된다.
// 해시를 만드는 쪽과 검사하는 쪽이 정규화 구현을 하나만 공유함을 보인다.

const ctx: UsabilityContext = { at: TEST_AT, acceptedOrigins: ['TEST_FIXTURE'], digest: canonicalDigest };

function pooledGroups(): CoverageGroupDef[] {
  return [
    { groupKey: 'TEST_GROUP_C', deduction: { kind: 'FIXED', fixed: 3_000 }, limit: { kind: 'PER_VISIT_PAYOUT', amount: 300_000, limitBasis: 'PAYOUT' }, sharedLimitPoolKey: 'TEST_POOL_B' },
    { groupKey: 'TEST_GROUP_A', deduction: { kind: 'FIXED', fixed: 1_000 }, limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' }, sharedLimitPoolKey: 'TEST_POOL_A' },
    { groupKey: 'TEST_GROUP_B', deduction: { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 2_000, rate: 2_000, rounding: 'TRUNCATE' }, limit: { kind: 'PER_VISIT_PAYOUT', amount: 200_000, limitBasis: 'PAYOUT' } },
  ];
}

function sealedProfile(): StandardAssumptionProfile {
  const profile = makeProfile({
    groups: pooledGroups(),
    sharedLimitPools: [
      { poolKey: 'TEST_POOL_B', limit: { kind: 'PER_VISIT_PAYOUT', amount: 400_000, limitBasis: 'PAYOUT' } },
      { poolKey: 'TEST_POOL_A', limit: { kind: 'PER_VISIT_PAYOUT', amount: 150_000, limitBasis: 'PAYOUT' } },
    ],
  });
  return { ...profile, contentHash: canonicalDigest(profileContent(profile)) };
}

function sealedRuleSet(): DocumentRuleSet {
  const ruleSet = planningExampleRuleSet();
  return { ...ruleSet, contentHash: canonicalDigest(documentRuleSetContent(ruleSet)) };
}

/** 객체 키의 삽입 순서만 거꾸로 뒤집은 깊은 복사. 내용은 같다. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, inner]) => [key, reverseKeys(inner)]));
  }
  return value;
}

describe('프로필: 봉인과 검증이 같은 정규화를 쓴다', () => {
  it('canonicalDigest 로 봉인한 프로필을 엔진 isUsable 이 받아들인다', () => {
    expect(isUsable(profileToRuleItem(sealedProfile()), ctx)).toEqual({ usable: true });
  });

  it('groups·sharedLimitPools 를 다른 순서로 저장해도 원래 해시로 검증을 통과한다', () => {
    const profile = sealedProfile();
    const reordered: StandardAssumptionProfile = {
      ...profile,
      groups: [...profile.groups].reverse(),
      sharedLimitPools: [...profile.sharedLimitPools].reverse(),
    };
    expect(reordered.groups.map((group) => group.groupKey)).not.toEqual(profile.groups.map((group) => group.groupKey));
    expect(isUsable(profileToRuleItem(reordered), ctx)).toEqual({ usable: true });
  });

  it('객체 키 삽입 순서만 다른 프로필도 원래 해시로 통과한다 (운영 해시가 키 순서에 정규형이다)', () => {
    const profile = sealedProfile();
    const keysReversed = reverseKeys(profile) as StandardAssumptionProfile;
    expect(Object.keys(keysReversed)).toEqual([...Object.keys(profile)].reverse());
    expect(isUsable(profileToRuleItem(keysReversed), ctx)).toEqual({ usable: true });
  });

  const realChanges: Array<[string, (profile: StandardAssumptionProfile) => StandardAssumptionProfile]> = [
    ['공제 값', (p) => ({ ...p, groups: p.groups.map((group, index) => (index === 0 ? { ...group, deduction: { kind: 'FIXED', fixed: 3_001 } as const } : group)) })],
    ['한도 값', (p) => ({ ...p, groups: p.groups.map((group, index) => (index === 1 ? { ...group, limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_001, limitBasis: 'PAYOUT' } as const } : group)) })],
    ['groupOrder 순서', (p) => ({ ...p, groupOrder: [...p.groupOrder].reverse() })],
    ['공유 한도 풀 값', (p) => ({ ...p, sharedLimitPools: p.sharedLimitPools.map((pool, index) => (index === 0 ? { ...pool, limit: { kind: 'PER_VISIT_PAYOUT', amount: 1, limitBasis: 'PAYOUT' } as const } : pool)) })],
    ['세대', (p) => ({ ...p, generation: 'GEN3_C3' })],
    ['id', (p) => ({ ...p, id: 'TEST_PROFILE_OTHER' })],
    ['version', (p) => ({ ...p, version: 'v2' })],
  ];

  it.each(realChanges)('실제 규칙 값이 바뀌면 옛 해시로 INTEGRITY_MISMATCH: %s', (_label, change) => {
    const result = isUsable(profileToRuleItem(change(sealedProfile())), ctx);
    expect(result).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  });

  it('머리 정보(출처 구분·유효 기간·승인자)만 바뀌면 해시는 그대로다 (해시 입력에 들지 않는다)', () => {
    const profile = sealedProfile();
    const headerOnly: StandardAssumptionProfile = { ...profile, validity: { from: '2026-02-01', to: '2026-11-30' }, approver: { ...TEST_FIXTURE_APPROVER, approverId: 'TEST_FIXTURE_OTHER' } };
    expect(isUsable(profileToRuleItem(headerOnly), ctx)).toEqual({ usable: true });
  });

  it('엔진 시험 대역 해시(testDigest)로 봉인한 값은 운영 해시로는 검증되지 않는다 (두 해시를 섞어 쓰지 않는다)', () => {
    const viaTestDigest = makeProfile({ groups: pooledGroups() });
    expect(isUsable(profileToRuleItem(viaTestDigest), ctx)).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  });
});

describe('서류 규칙 묶음: 봉인과 검증이 같은 정규화를 쓴다', () => {
  it('canonicalDigest 로 봉인한 묶음을 엔진 isUsable 이 받아들인다', () => {
    expect(isUsable(documentRuleSetToRuleItem(sealedRuleSet()), ctx)).toEqual({ usable: true });
  });

  it('rules 를 다른 순서로 저장해도 원래 해시로 검증을 통과한다', () => {
    const ruleSet = sealedRuleSet();
    const reordered: DocumentRuleSet = { ...ruleSet, rules: [...ruleSet.rules].reverse() };
    expect(reordered.rules.map((rule) => rule.documentCode)).not.toEqual(ruleSet.rules.map((rule) => rule.documentCode));
    expect(isUsable(documentRuleSetToRuleItem(reordered), ctx)).toEqual({ usable: true });
  });

  it('규칙의 키 삽입 순서만 달라도 통과한다', () => {
    const ruleSet = sealedRuleSet();
    const keysReversed = reverseKeys(ruleSet) as DocumentRuleSet;
    expect(isUsable(documentRuleSetToRuleItem(keysReversed), ctx)).toEqual({ usable: true });
  });

  const realChanges: Array<[string, (ruleSet: DocumentRuleSet) => DocumentRuleSet]> = [
    ['사유 문장', (r) => ({ ...r, rules: r.rules.map((rule, index) => (index === 0 ? { ...rule, reason: `${rule.reason} 수정` } : rule)) })],
    ['우선순위', (r) => ({ ...r, rules: r.rules.map((rule, index) => (index === 1 ? { ...rule, priority: rule.priority + 1 } : rule)) })],
    ['조건(when)', (r) => ({ ...r, rules: r.rules.map((rule, index) => (index === 2 ? { ...rule, when: { cause: 'ILLNESS' as const } } : rule)) })],
    ['규칙 하나 제거', (r) => ({ ...r, rules: r.rules.slice(1) })],
    ['id', (r) => ({ ...r, id: 'TEST_DOCUMENT_RULES_OTHER' })],
  ];

  it.each(realChanges)('실제 규칙 내용이 바뀌면 옛 해시로 INTEGRITY_MISMATCH: %s', (_label, change) => {
    expect(isUsable(documentRuleSetToRuleItem(change(sealedRuleSet())), ctx)).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  });
});

describe('저장소를 거친 뒤에도 봉인이 유지된다 (내용 기록 + 현재 상태 → 엔진 형식)', () => {
  it('저장 → 읽기 → 상태를 채운 프로필·서류 규칙 묶음이 운영 해시로 검증을 통과한다', () => {
    const repo = newRepo();
    const profile = profileRecord();
    const rules = documentRuleSetRecord();
    for (const record of [profile, rules]) {
      repo.putItemVersion(record);
      repo.recordItemTransition(record.ref, transitionInput({ to: 'PUBLISHED', approverAfter: { ...TEST_FIXTURE_APPROVER } }));
    }
    const [profileState, rulesState] = repo.readItemStates([profile.ref, rules.ref]);
    const storedProfile = repo.getItemVersion(profile.ref) as typeof profile;
    const storedRules = repo.getItemVersion(rules.ref) as typeof rules;
    expect(isUsable(profileToRuleItem(toEngineProfile(storedProfile, profileState!)), ctx)).toEqual({ usable: true });
    expect(isUsable(documentRuleSetToRuleItem(toEngineDocumentRuleSet(storedRules, rulesState!)), ctx)).toEqual({ usable: true });
  });

  it('같은 내용이라도 현재 상태가 PUBLISHED 가 아니면 엔진이 상태 사유로 거절한다 (내용 해시는 상태와 무관)', () => {
    const repo = newRepo();
    const profile = profileRecord();
    repo.putItemVersion(profile);
    repo.recordItemTransition(profile.ref, transitionInput({ to: 'SUSPENDED', approverAfter: { ...TEST_FIXTURE_APPROVER } }));
    const [state] = repo.readItemStates([profile.ref]);
    const engine = toEngineProfile(repo.getItemVersion(profile.ref) as typeof profile, state!);
    expect(isUsable(profileToRuleItem(engine), ctx)).toEqual({ usable: false, reason: 'STATE_INVALID' });
  });

  it('승인자 기록이 없으면 PUBLISHED 여도 엔진이 APPROVER_MISSING 으로 거절한다', () => {
    const repo = newRepo();
    const profile = profileRecord();
    repo.putItemVersion(profile);
    repo.recordItemTransition(profile.ref, transitionInput({ to: 'PUBLISHED', approverAfter: null }));
    const [state] = repo.readItemStates([profile.ref]);
    const engine = toEngineProfile(repo.getItemVersion(profile.ref) as typeof profile, state!);
    expect(isUsable(profileToRuleItem(engine), ctx)).toEqual({ usable: false, reason: 'APPROVER_MISSING' });
  });
});
