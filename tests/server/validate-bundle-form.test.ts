import { describe, expect, it } from 'vitest';
import { validateRuleBundlePublish } from '../../src/server/publish-validate';
import type { BundleItemResolver } from '../../src/server/publish-validate';
import { mappingRef, profileRef, requestOf, resolverOf, ruleSetRef, sealedProfile, validBundleItems } from '../fixtures/server/publish.fixture';
import { setAt, unsetAt } from '../fixtures/server/mutate.fixture';

// 규칙 묶음 게시 검증 1층: 컨테이너와 항목의 형식 (AC-011i 의 `M3 · 미구현` 하위 기준).
// M1 엔진은 묶음 컨테이너의 잘못된 항목을 막지 않는다(null 항목은 TypeError). 이 층이 그 보장을 맡는다.
// 어떤 쓰레기 입력에서도 던지지 않고, 어긋난 필드 경로를 돌려준다.

const items = validBundleItems();
const request = requestOf(items);
const resolver = resolverOf(items);

function check(req: unknown, res: BundleItemResolver = resolver) {
  return validateRuleBundlePublish(req, res);
}

describe('올바른 묶음', () => {
  it('결함이 없다', () => {
    expect(check(request)).toEqual([]);
  });

  it('프로필·매핑이 빈 배열이고 서류 규칙 묶음이 null 이어도 형식 결함이 아니다', () => {
    expect(check({ profiles: [], mappings: [], documentRuleSet: null })).toEqual([]);
  });
});

describe('요청 자체의 모양', () => {
  it.each([null, undefined, 5, 'x', true, []])('요청이 객체가 아니면(%j) NOT_OBJECT 하나', (garbage) => {
    expect(check(garbage)).toEqual([{ code: 'NOT_OBJECT', path: 'bundle' }]);
  });
});

describe('profiles · mappings 가 배열이 아닌 묶음 (각각 따로)', () => {
  const garbages: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['객체', { 0: 'x' }],
    ['문자열', 'x'],
    ['숫자', 5],
    ['불리언', true],
  ];

  it.each(garbages)('profiles = %s 이고 나머지는 유효하면 NOT_ARRAY 하나뿐이다', (_name, garbage) => {
    expect(check({ ...request, profiles: garbage })).toEqual([{ code: 'NOT_ARRAY', path: 'bundle.profiles' }]);
  });

  it.each(garbages)('mappings = %s 이고 나머지는 유효하면 NOT_ARRAY 하나뿐이다', (_name, garbage) => {
    expect(check({ ...request, mappings: garbage })).toEqual([{ code: 'NOT_ARRAY', path: 'bundle.mappings' }]);
  });

  it('profiles 가 없는 키(필드 누락)여도 NOT_ARRAY 이다', () => {
    expect(check(unsetAt(request, ['profiles']))).toEqual([{ code: 'NOT_ARRAY', path: 'bundle.profiles' }]);
    expect(check(unsetAt(request, ['mappings']))).toEqual([{ code: 'NOT_ARRAY', path: 'bundle.mappings' }]);
  });

  it('둘 다 틀리면 profiles → mappings 순으로 둘 다 보고한다', () => {
    expect(check({ profiles: null, mappings: null, documentRuleSet: null })).toEqual([
      { code: 'NOT_ARRAY', path: 'bundle.profiles' },
      { code: 'NOT_ARRAY', path: 'bundle.mappings' },
    ]);
  });
});

describe('profiles · mappings 항목의 모양', () => {
  const garbages: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['숫자', 7],
    ['문자열', 'ref'],
    ['불리언', false],
    ['배열', [{ kind: 'PROFILE', id: 'a', version: 'v1' }]],
  ];

  it.each(garbages)('프로필 항목이 %s 이면 NOT_OBJECT 이고 경로에 인덱스가 붙는다', (_name, garbage) => {
    const bad = setAt({ ...request, profiles: [request.profiles[0], request.profiles[0], null] }, ['profiles', 2], garbage);
    const defects = check(bad);
    expect(defects).toContainEqual({ code: 'NOT_OBJECT', path: 'bundle.profiles[2]' });
    expect(defects.filter((defect) => defect.code === 'NOT_OBJECT')).toHaveLength(1);
  });

  it.each(garbages)('매핑 항목이 %s 이면 NOT_OBJECT', (_name, garbage) => {
    const bad = { ...request, mappings: [garbage, ...request.mappings] };
    expect(check(bad)).toEqual([{ code: 'NOT_OBJECT', path: 'bundle.mappings[0]' }]);
  });

  it('희소 배열의 빈 칸도 항목 결함이다', () => {
    const sparse = new Array(2);
    sparse[0] = request.mappings[0];
    expect(check({ ...request, mappings: sparse })).toEqual([{ code: 'NOT_OBJECT', path: 'bundle.mappings[1]' }]);
  });

  it('올바른 항목은 이웃의 결함에 영향받지 않고 다음 층까지 간다', () => {
    const tampered = sealedProfile({ contentHash: 'TEST_FIXTURE_WRONG_HASH' });
    const mixed = { profiles: [null, profileRef(tampered)], mappings: [], documentRuleSet: null };
    const res = resolverOf({ profiles: [tampered], mappings: [], documentRuleSet: null });
    expect(check(mixed, res)).toEqual([
      { code: 'NOT_OBJECT', path: 'bundle.profiles[0]' },
      { code: 'INTEGRITY_MISMATCH', path: 'bundle.profiles[1].contentHash' },
    ]);
  });
});

describe('참조(ref)의 모양과 해석', () => {
  it.each([
    ['kind 가 없다', ['profiles', 0, 'kind'], 'unset', 'VALUE_MISSING', 'bundle.profiles[0].kind'],
    ['kind 가 다른 종류다', ['profiles', 0, 'kind'], 'MAPPING', 'VALUE_INVALID', 'bundle.profiles[0].kind'],
    ['kind 가 목록 밖이다', ['profiles', 0, 'kind'], 'profile', 'VALUE_INVALID', 'bundle.profiles[0].kind'],
    ['id 가 비어 있다', ['profiles', 0, 'id'], '', 'VALUE_INVALID', 'bundle.profiles[0].id'],
    ['id 가 문자열이 아니다', ['profiles', 0, 'id'], 5, 'VALUE_INVALID', 'bundle.profiles[0].id'],
    ['version 이 없다', ['profiles', 0, 'version'], 'unset', 'VALUE_MISSING', 'bundle.profiles[0].version'],
    ['version 이 비어 있다', ['profiles', 0, 'version'], '', 'VALUE_INVALID', 'bundle.profiles[0].version'],
    ['매핑 kind 가 PROFILE 이다', ['mappings', 1, 'kind'], 'PROFILE', 'VALUE_INVALID', 'bundle.mappings[1].kind'],
    ['매핑 id 가 null 이다', ['mappings', 0, 'id'], null, 'VALUE_MISSING', 'bundle.mappings[0].id'],
  ] as const)('%s → %s', (_name, path, value, code, reported) => {
    const bad = value === 'unset' ? unsetAt(request, path) : setAt(request, path, value);
    expect(check(bad)).toEqual([{ code, path: reported }]);
  });

  it('형식이 틀린 참조로는 해석기를 부르지 않는다', () => {
    const spy = resolverOf(items);
    check(setAt(request, ['profiles', 0, 'id'], ''), spy);
    expect(spy.calls.map((ref) => `${ref.kind}/${ref.id}`)).toEqual(['MAPPING/TEST_MAPPING_TEST_FIXTURE_TREATMENT_1', 'MAPPING/TEST_MAPPING_TEST_FIXTURE_TREATMENT_2', 'DOCUMENT_RULE_SET/TEST_DOCUMENT_RULES_PLANNING_EXAMPLE']);
  });

  it('해석되지 않는 참조는 REF_UNRESOLVABLE 이다 (프로필·매핑·서류 규칙 묶음 각각)', () => {
    const missing = { profiles: [profileRef({ id: 'TEST_FIXTURE_NO_SUCH', version: 'v9' })], mappings: [mappingRef({ id: 'TEST_FIXTURE_NO_SUCH', version: 'v9' })], documentRuleSet: ruleSetRef({ id: 'TEST_FIXTURE_NO_SUCH', version: 'v9' }) };
    expect(check(missing)).toEqual([
      { code: 'REF_UNRESOLVABLE', path: 'bundle.profiles[0]' },
      { code: 'REF_UNRESOLVABLE', path: 'bundle.mappings[0]' },
      { code: 'REF_UNRESOLVABLE', path: 'bundle.documentRuleSet' },
    ]);
  });

  it('해석기가 객체가 아닌 값을 돌려줘도 해석되지 않은 것으로 본다', () => {
    for (const garbage of [undefined, 5, 'x', true, []]) {
      const res: BundleItemResolver = {
        profile: () => garbage as never,
        mapping: () => garbage as never,
        documentRuleSet: () => garbage as never,
      };
      expect(check(request, res)).toEqual([
        { code: 'REF_UNRESOLVABLE', path: 'bundle.profiles[0]' },
        { code: 'REF_UNRESOLVABLE', path: 'bundle.mappings[0]' },
        { code: 'REF_UNRESOLVABLE', path: 'bundle.mappings[1]' },
        { code: 'REF_UNRESOLVABLE', path: 'bundle.documentRuleSet' },
      ]);
    }
  });

  it('프로필 자리에는 프로필 해석기만, 매핑 자리에는 매핑 해석기만 쓴다', () => {
    const seen: string[] = [];
    const res: BundleItemResolver = {
      profile: (ref) => (seen.push(`profile:${ref.id}`), items.profiles[0] ?? null),
      mapping: (ref) => (seen.push(`mapping:${ref.id}`), items.mappings.find((m) => m.id === ref.id) ?? null),
      documentRuleSet: (ref) => (seen.push(`docs:${ref.id}`), items.documentRuleSet),
    };
    expect(check(request, res)).toEqual([]);
    expect(seen).toEqual([
      'profile:TEST_PROFILE_1',
      'mapping:TEST_MAPPING_TEST_FIXTURE_TREATMENT_1',
      'mapping:TEST_MAPPING_TEST_FIXTURE_TREATMENT_2',
      'docs:TEST_DOCUMENT_RULES_PLANNING_EXAMPLE',
    ]);
  });
});

describe('documentRuleSet 자리', () => {
  it('null 은 서류 규칙 묶음이 없다는 뜻이며 형식 결함이 아니다', () => {
    expect(check({ ...request, documentRuleSet: null })).toEqual([]);
  });

  it('필드가 없거나 undefined 이면 "없다"로 추정하지 않고 VALUE_MISSING 이다', () => {
    expect(check(unsetAt(request, ['documentRuleSet']))).toEqual([{ code: 'VALUE_MISSING', path: 'bundle.documentRuleSet' }]);
    expect(check({ ...request, documentRuleSet: undefined })).toEqual([{ code: 'VALUE_MISSING', path: 'bundle.documentRuleSet' }]);
  });

  it.each([5, 'x', true, []])('객체가 아니면(%j) NOT_OBJECT', (garbage) => {
    expect(check({ ...request, documentRuleSet: garbage })).toEqual([{ code: 'NOT_OBJECT', path: 'bundle.documentRuleSet' }]);
  });

  it('참조 필드가 틀리면 필드 경로가 붙는다', () => {
    expect(check(setAt(request, ['documentRuleSet', 'kind'], 'PROFILE'))).toEqual([{ code: 'VALUE_INVALID', path: 'bundle.documentRuleSet.kind' }]);
    expect(check(setAt(request, ['documentRuleSet', 'id'], ''))).toEqual([{ code: 'VALUE_INVALID', path: 'bundle.documentRuleSet.id' }]);
  });
});

describe('형식 결함이 있으면 교차 검사를 하지 않는다 (전체 항목이 있어야 의미가 있다)', () => {
  it('프로필 항목이 null 이면 그 프로필이 있을 수도 있는 칸에 대한 그룹 교차 결함을 만들지 않는다', () => {
    // 매핑의 groupKey 는 어느 프로필에도 없지만, 프로필 목록이 온전하지 않으므로 교차 결함은 보고하지 않는다.
    const orphan = { ...items.mappings[0]!, id: 'TEST_FIXTURE_ORPHAN', groupKey: 'TEST_FIXTURE_NO_SUCH_GROUP' };
    const withOrphan = { ...items, mappings: [orphan] };
    const res = resolverOf(withOrphan);
    const req = { profiles: [null], mappings: [mappingRef(orphan)], documentRuleSet: null };
    expect(check(req, res)).toEqual([{ code: 'NOT_OBJECT', path: 'bundle.profiles[0]' }]);
  });

  it('온전한 항목들 사이에 형식 결함이 하나라도 있으면 그룹 교차·칸 중복·매핑 id 중복을 보고하지 않는다', () => {
    // 이 항목들만으로는 세 가지 교차 결함이 모두 난다: 프로필에 없는 그룹, 같은 칸의 프로필 둘, 같은 id 의 매핑 둘.
    const good = validBundleItems();
    const twin = sealedProfile({ id: 'TEST_PROFILE_TWIN' });
    const orphan = { ...good.mappings[0]!, id: 'TEST_FIXTURE_DUP', groupKey: 'TEST_FIXTURE_NO_SUCH_GROUP' };
    const dup = { ...good.mappings[0]!, id: 'TEST_FIXTURE_DUP', version: 'v2' };
    const items = { profiles: [good.profiles[0]!, twin], mappings: [orphan, dup], documentRuleSet: null };
    const res = resolverOf(items);
    const whole = requestOf(items);
    // 형식 결함이 없으면 세 가지가 모두 보고된다 (아래 대조).
    expect(check(whole, res).map((defect) => defect.code)).toEqual([
      'MAPPING_GROUP_NOT_IN_PROFILE',
      'CELL_PROFILE_DUPLICATE',
      'CELL_PROFILE_DUPLICATE',
      'MAPPING_ID_DUPLICATE',
      'MAPPING_ID_DUPLICATE',
    ]);
    // 매핑 목록 끝에 null 하나가 있으면 형식 결함 하나만 남는다.
    expect(check({ ...whole, mappings: [...whole.mappings, null] }, res)).toEqual([{ code: 'NOT_OBJECT', path: 'bundle.mappings[2]' }]);
  });
});

describe('어떤 쓰레기 입력에서도 던지지 않는다', () => {
  const garbage: unknown[] = [
    null,
    undefined,
    0,
    -0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '',
    'x',
    true,
    false,
    [],
    [null],
    [[]],
    [undefined],
    {},
    { kind: 5 },
    () => 1,
    Symbol('s'),
    10n,
    new Date(0),
    new Map(),
  ];

  it.each(garbage.map((value) => [String(typeof value), value] as const))('요청의 세 자리에 %s 를 넣어도 TypeError 가 없다', (_name, value) => {
    expect(() => check(value)).not.toThrow();
    expect(() => check({ profiles: value, mappings: value, documentRuleSet: value })).not.toThrow();
    expect(() => check({ profiles: [value], mappings: [value], documentRuleSet: value })).not.toThrow();
    expect(() => check({ profiles: [{ kind: 'PROFILE', id: 'a', version: 'v1', extra: value }], mappings: [value], documentRuleSet: null })).not.toThrow();
  });

  it('해석기가 쓰레기 항목을 돌려줘도 던지지 않는다', () => {
    for (const value of garbage) {
      const res: BundleItemResolver = { profile: () => value as never, mapping: () => value as never, documentRuleSet: () => value as never };
      expect(() => check(request, res)).not.toThrow();
    }
  });
});
