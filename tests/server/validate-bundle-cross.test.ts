import { describe, expect, it } from 'vitest';
import type { Generation, InsurerType, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../src/engine/types';
import { validateRuleBundlePublish } from '../../src/server/publish-validate';
import { makeExcludedMapping, makeMapping } from '../fixtures/engine/mappings.fixture';
import { requestOf, resolverOf, sealedProfile, validBundleItems } from '../fixtures/server/publish.fixture';
import type { BundleItems } from '../fixtures/server/publish.fixture';
import { setAt } from '../fixtures/server/mutate.fixture';

// 규칙 묶음 게시 검증: 묶음 교차 검사 (AC-011i 세 번째 항목, design.md DD-03·DD-18).
//   · 매핑 scope 의 한 칸에 같은 묶음의 프로필이 있는데 그 프로필에 매핑의 groupKey 가 없는 COVERED 매핑
//   · 같은 (세대, 보험사 형태) 칸에 프로필 둘 이상
//   · 같은 매핑 id 의 버전 둘 이상
// 프로필이 없는 칸을 scope 로 가진 매핑은 거절하지 않는다(그 칸의 계산은 PROFILE_ABSENT 로 보류된다).

const GENERATIONS: Generation[] = ['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4'];
const TYPES: InsurerType[] = ['NON_LIFE', 'LIFE', 'MUTUAL_AID'];

function check(items: BundleItems) {
  return validateRuleBundlePublish(requestOf(items), resolverOf(items));
}

const cellProfile = (generation: Generation, insurerType: InsurerType, overrides: Partial<StandardAssumptionProfile> = {}): StandardAssumptionProfile =>
  sealedProfile({ id: `TEST_PROFILE_${generation}_${insurerType}`, generation, insurerType, ...overrides });

const base = validBundleItems();
const profile = base.profiles[0] as StandardAssumptionProfile; // GEN4_C4 · NON_LIFE, 그룹 TEST_GROUP_BENEFIT·TEST_GROUP_NON_BENEFIT
const covered = (treatmentId: string, overrides: Partial<TreatmentCoverageMapping> = {}) => makeMapping(treatmentId, overrides);
const bundle = (profiles: StandardAssumptionProfile[], mappings: TreatmentCoverageMapping[]): BundleItems => ({ profiles, mappings, documentRuleSet: base.documentRuleSet });

describe('COVERED 매핑의 groupKey 가 scope 칸의 프로필에 있는가', () => {
  it('프로필에 있는 그룹을 가리키면 결함이 없다', () => {
    expect(check(bundle([profile], [covered('T1', { groupKey: 'TEST_GROUP_NON_BENEFIT' })]))).toEqual([]);
  });

  it('프로필에 없는 그룹이면 MAPPING_GROUP_NOT_IN_PROFILE 이고 경로는 매핑의 groupKey 다', () => {
    expect(check(bundle([profile], [covered('T1', { groupKey: 'TEST_FIXTURE_NO_SUCH_GROUP' })]))).toEqual([
      { code: 'MAPPING_GROUP_NOT_IN_PROFILE', path: 'bundle.mappings[0].groupKey' },
    ]);
  });

  it('풀 키는 그룹 키가 아니다: 프로필의 poolKey 를 groupKey 로 쓰면 결함', () => {
    const pooled = sealedProfile({ groups: [{ ...profile.groups[0]!, sharedLimitPoolKey: 'TEST_POOL_1' }, profile.groups[1]!], sharedLimitPools: [{ poolKey: 'TEST_POOL_1', limit: { kind: 'ANNUAL', amount: 1, limitBasis: 'PAYOUT' } }] });
    expect(check(bundle([pooled], [covered('T1', { groupKey: 'TEST_POOL_1' })]))).toEqual([{ code: 'MAPPING_GROUP_NOT_IN_PROFILE', path: 'bundle.mappings[0].groupKey' }]);
  });

  it('인덱스는 매핑 목록의 위치다: 둘째 매핑만 틀리면 mappings[1]', () => {
    const items = bundle([profile], [covered('T1'), covered('T2', { groupKey: 'NO_SUCH' })]);
    expect(check(items)).toEqual([{ code: 'MAPPING_GROUP_NOT_IN_PROFILE', path: 'bundle.mappings[1].groupKey' }]);
  });

  it('scope 칸에 프로필이 없으면 거절하지 않는다 (그 칸은 계산 때 PROFILE_ABSENT)', () => {
    const items = bundle([profile], [covered('T1', { groupKey: 'NO_SUCH', scope: [{ generation: 'GEN1_AS', insurerType: 'MUTUAL_AID' }] })]);
    expect(check(items)).toEqual([]);
  });

  it('프로필이 하나도 없는 묶음의 매핑은 모두 허용한다', () => {
    expect(check(bundle([], [covered('T1', { groupKey: 'NO_SUCH' }), makeExcludedMapping('T2')]))).toEqual([]);
  });

  it('scope 가 여러 칸이면 프로필이 있는 칸마다 확인하고, 프로필이 없는 칸은 건너뛴다', () => {
    const other = cellProfile('GEN3_C3', 'LIFE', { groups: [profile.groups[1]!], groupOrder: [profile.groups[1]!.groupKey] });
    const mapping = covered('T1', {
      groupKey: 'TEST_GROUP_BENEFIT',
      scope: [
        { generation: 'GEN4_C4', insurerType: 'NON_LIFE' },
        { generation: 'GEN3_C3', insurerType: 'LIFE' },
        { generation: 'GEN1_AS', insurerType: 'LIFE' },
      ],
    });
    // GEN4_C4·NON_LIFE 에는 그룹이 있고 GEN3_C3·LIFE 에는 없다 → 매핑 하나에 결함 하나(칸마다 되풀이하지 않는다).
    expect(check(bundle([profile, other], [mapping]))).toEqual([{ code: 'MAPPING_GROUP_NOT_IN_PROFILE', path: 'bundle.mappings[0].groupKey' }]);
  });

  it('scope 의 모든 칸이 그룹을 가지면 결함이 없다', () => {
    const other = cellProfile('GEN3_C3', 'LIFE');
    const mapping = covered('T1', {
      scope: [
        { generation: 'GEN4_C4', insurerType: 'NON_LIFE' },
        { generation: 'GEN3_C3', insurerType: 'LIFE' },
      ],
    });
    expect(check(bundle([profile, other], [mapping]))).toEqual([]);
  });

  it('EXCLUDED 매핑은 그룹을 조회하지 않는다 (groupKey 가 없다)', () => {
    const excluded = makeExcludedMapping('T1', { scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }] });
    expect(check(bundle([profile], [excluded]))).toEqual([]);
  });

  it('scope 항목이 형식에 어긋나면 그 항목은 칸으로 세지 않는다 (SCOPE_INVALID 만 낸다)', () => {
    const mapping = setAt(covered('T1', { groupKey: 'NO_SUCH' }), ['scope'], [{ generation: 'GEN9', insurerType: 'NON_LIFE' }, null]);
    expect(check(bundle([profile], [mapping])).map((defect) => defect.code)).toEqual(['SCOPE_INVALID', 'SCOPE_INVALID']);
  });

  it('구조 결함이 있는 프로필은 그룹 목록을 믿을 수 없으므로 그룹 교차 검사에서 뺀다 (구조 결함이 먼저 거절한다)', () => {
    const broken = sealedProfile({ groups: [profile.groups[0]!, { ...profile.groups[0]! }], groupOrder: ['TEST_GROUP_BENEFIT'] });
    const result = check(bundle([broken], [covered('T1', { groupKey: 'NO_SUCH' })]));
    expect(result).toEqual([{ code: 'DUPLICATE_GROUP_KEY', path: 'bundle.profiles[0].groups[1].groupKey' }]);
  });

  it('값이 틀린 프로필(구조는 정상)은 그룹 교차 검사에 그대로 참여한다', () => {
    const badValue = sealedProfile({ groups: [{ ...profile.groups[0]!, deduction: { kind: 'FIXED', fixed: -1 } }, profile.groups[1]!] });
    expect(check(bundle([badValue], [covered('T1', { groupKey: 'NO_SUCH' })])).map((defect) => defect.code)).toEqual(['VALUE_INVALID', 'MAPPING_GROUP_NOT_IN_PROFILE']);
  });
});

describe('같은 (세대, 보험사 형태) 칸의 프로필 둘 이상', () => {
  it('열다섯 칸에 프로필이 하나씩이면 결함이 없다', () => {
    const profiles = GENERATIONS.flatMap((generation) => TYPES.map((insurerType) => cellProfile(generation, insurerType)));
    expect(profiles).toHaveLength(15);
    expect(check(bundle(profiles, [covered('T1')]))).toEqual([]);
  });

  it('같은 칸에 프로필이 둘이면 둘 다 CELL_PROFILE_DUPLICATE 다 (어느 쪽이 옳은지 고르지 않는다)', () => {
    const twin = cellProfile('GEN4_C4', 'NON_LIFE', { id: 'TEST_PROFILE_TWIN' });
    expect(check(bundle([profile, twin], []))).toEqual([
      { code: 'CELL_PROFILE_DUPLICATE', path: 'bundle.profiles[0]' },
      { code: 'CELL_PROFILE_DUPLICATE', path: 'bundle.profiles[1]' },
    ]);
  });

  it('같은 칸에 셋이면 셋 모두, 다른 칸의 프로필은 보고하지 않는다', () => {
    const profiles = [profile, cellProfile('GEN3_C3', 'LIFE'), cellProfile('GEN4_C4', 'NON_LIFE', { id: 'TWIN_1' }), cellProfile('GEN4_C4', 'NON_LIFE', { id: 'TWIN_2' })];
    expect(check(bundle(profiles, [])).map((defect) => defect.path)).toEqual(['bundle.profiles[0]', 'bundle.profiles[2]', 'bundle.profiles[3]']);
  });

  it('세대만 다르거나 보험사 형태만 다르면 같은 칸이 아니다', () => {
    expect(check(bundle([profile, cellProfile('GEN3_C3', 'NON_LIFE'), cellProfile('GEN4_C4', 'LIFE')], []))).toEqual([]);
  });

  it('같은 프로필 참조를 두 번 담아도 같은 칸에 둘이다', () => {
    expect(check(bundle([profile, profile], [])).map((defect) => defect.code)).toEqual(['CELL_PROFILE_DUPLICATE', 'CELL_PROFILE_DUPLICATE']);
  });

  it('칸 키가 틀린 프로필은 칸으로 세지 않는다 (VALUE_INVALID 만 낸다)', () => {
    const bad1 = cellProfile('GEN4_C4', 'NON_LIFE', { id: 'BAD_1', generation: 'GEN9' as never });
    const bad2 = cellProfile('GEN4_C4', 'NON_LIFE', { id: 'BAD_2', generation: 'GEN9' as never });
    expect(check(bundle([bad1, bad2], [])).map((defect) => defect.code)).toEqual(['VALUE_INVALID', 'VALUE_INVALID']);
  });
});

describe('같은 매핑 id 의 버전 둘 이상', () => {
  it('같은 id 의 두 버전이면 둘 다 MAPPING_ID_DUPLICATE 이고 경로는 매핑의 id 다', () => {
    const v1 = covered('T1', { id: 'TEST_FIXTURE_MAPPING_X', version: 'v1' });
    const v2 = covered('T1', { id: 'TEST_FIXTURE_MAPPING_X', version: 'v2' });
    expect(check(bundle([profile], [v1, v2]))).toEqual([
      { code: 'MAPPING_ID_DUPLICATE', path: 'bundle.mappings[0].id' },
      { code: 'MAPPING_ID_DUPLICATE', path: 'bundle.mappings[1].id' },
    ]);
  });

  it('id 가 같으면 치료가 달라도 중복이다', () => {
    const a = covered('T1', { id: 'TEST_FIXTURE_MAPPING_X' });
    const b = covered('T2', { id: 'TEST_FIXTURE_MAPPING_X', version: 'v2' });
    expect(check(bundle([profile], [a, b])).map((defect) => defect.code)).toEqual(['MAPPING_ID_DUPLICATE', 'MAPPING_ID_DUPLICATE']);
  });

  it('같은 버전을 두 번 담아도 중복이다', () => {
    const a = covered('T1');
    expect(check(bundle([profile], [a, a])).map((defect) => defect.code)).toEqual(['MAPPING_ID_DUPLICATE', 'MAPPING_ID_DUPLICATE']);
  });

  it('id 가 다르면 같은 치료의 매핑이 여럿이어도 중복이 아니다 (후보 모호성은 계산이 가린다)', () => {
    expect(check(bundle([profile], [covered('T1', { id: 'M_A' }), covered('T1', { id: 'M_B' })]))).toEqual([]);
  });

  it('세 개 중 둘만 같으면 그 둘만 보고한다', () => {
    const items = bundle([profile], [covered('T1', { id: 'M_A' }), covered('T2', { id: 'M_B' }), covered('T3', { id: 'M_A', version: 'v2' })]);
    expect(check(items).map((defect) => defect.path)).toEqual(['bundle.mappings[0].id', 'bundle.mappings[2].id']);
  });
});

describe('교차 결함 보고 순서와 배열 순서 독립', () => {
  const messy = (): BundleItems => {
    const twin = cellProfile('GEN4_C4', 'NON_LIFE', { id: 'TEST_PROFILE_TWIN' });
    const orphan = covered('T1', { id: 'M_ORPHAN', groupKey: 'NO_SUCH' });
    const v1 = covered('T2', { id: 'M_DUP', version: 'v1' });
    const v2 = covered('T2', { id: 'M_DUP', version: 'v2' });
    return bundle([profile, twin], [orphan, v1, v2]);
  };

  it('그룹 교차 → 칸 중복 → 매핑 id 중복 순서다', () => {
    expect(check(messy()).map((defect) => defect.code)).toEqual([
      'MAPPING_GROUP_NOT_IN_PROFILE',
      'CELL_PROFILE_DUPLICATE',
      'CELL_PROFILE_DUPLICATE',
      'MAPPING_ID_DUPLICATE',
      'MAPPING_ID_DUPLICATE',
    ]);
  });

  it('배열 순서를 바꿔도 결함 코드의 모음(multiset)이 같다', () => {
    const items = messy();
    const reference = check(items).map((defect) => defect.code).sort();
    const permutations: BundleItems[] = [
      { ...items, profiles: [...items.profiles].reverse() },
      { ...items, mappings: [...items.mappings].reverse() },
      { ...items, profiles: [...items.profiles].reverse(), mappings: [items.mappings[1]!, items.mappings[2]!, items.mappings[0]!] },
    ];
    for (const permuted of permutations) {
      expect(check(permuted).map((defect) => defect.code).sort()).toEqual(reference);
    }
  });

  it('올바른 묶음은 프로필·매핑 배열을 어떤 순서로 담아도 올바르다', () => {
    const profiles = GENERATIONS.slice(0, 3).map((generation) => cellProfile(generation, 'NON_LIFE'));
    const mappings = [covered('T1', { id: 'M_1' }), makeExcludedMapping('T2', { id: 'M_2' }), covered('T3', { id: 'M_3' })];
    const orders = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [1, 0, 2]];
    for (const order of orders) {
      expect(check(bundle(order.map((i) => profiles[i]!), order.map((i) => mappings[i]!)))).toEqual([]);
    }
  });
});
