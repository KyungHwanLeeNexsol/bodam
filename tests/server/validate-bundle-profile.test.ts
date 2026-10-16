import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import { checkGroupValues } from '../../src/engine/group-values';
import { checkProfileStructure } from '../../src/engine/profile-structure';
import type { ProfileStructureDefectCode } from '../../src/engine/profile-structure';
import type { CoverageGroupDef, StandardAssumptionProfile } from '../../src/engine/types';
import { isUsable, profileContent, profileToRuleItem } from '../../src/engine/usability';
import { canonicalDigest } from '../../src/server/digest';
import { validateRuleBundlePublish } from '../../src/server/publish-validate';
import { TEST_AT } from '../fixtures/engine/profiles.fixture';
import { requestOf, resolverOf, sealedProfile, validBundleItems } from '../fixtures/server/publish.fixture';
import type { BundleItems } from '../fixtures/server/publish.fixture';
import { seededRandom, setAt, unsetAt } from '../fixtures/server/mutate.fixture';

// 규칙 묶음 게시 검증: 프로필 구조(엔진 checkProfileStructure 재사용)와 값 범위(DD-24).
// 값 판정은 엔진 checkGroupValues(계산 때)와 어긋나면 안 된다: 게시는 통과했는데 계산은 PROFILE_VALUE_INVALID 인 일이 없어야 한다.
// 공식 지원 여부(종류·limitBasis·조항 참조)는 게시 거절 사유가 아니라 계산 때의 보류 사유다 (AC-011i, DD-02).

const P = 'bundle.profiles[0]';

/** 프로필을 올바른 해시로 다시 봉인한다(내용을 바꾼 시험이 봉인 결함 때문에 흐려지지 않게). */
function reseal(profile: StandardAssumptionProfile): StandardAssumptionProfile {
  return { ...profile, contentHash: canonicalDigest(profileContent(profile)) };
}

/** 프로필 하나(인덱스 0)만 담은 묶음을 검증한다. 묶음 안의 다른 항목은 없다. */
function check(profile: unknown) {
  const items: BundleItems = { profiles: [profile as StandardAssumptionProfile], mappings: [], documentRuleSet: null };
  return validateRuleBundlePublish(requestOf(items), resolverOf(items));
}

const base = sealedProfile();

/** 값 하나를 바꾸고 다시 봉인한 프로필. */
function edited(path: ReadonlyArray<string | number>, value: unknown): StandardAssumptionProfile {
  return reseal(setAt(base, path, value));
}
function removed(path: ReadonlyArray<string | number>): StandardAssumptionProfile {
  return reseal(unsetAt(base, path));
}

describe('올바른 프로필', () => {
  it('결함이 없다', () => {
    expect(check(base)).toEqual([]);
  });

  it('공유 한도 풀이 있는 프로필도 결함이 없다', () => {
    const pooled = reseal({
      ...base,
      groups: [{ ...base.groups[0]!, sharedLimitPoolKey: 'TEST_POOL_1' }, base.groups[1]!],
      sharedLimitPools: [{ poolKey: 'TEST_POOL_1', limit: { kind: 'ANNUAL', amount: 500_000, limitBasis: 'PAYOUT' } }],
    });
    expect(check(pooled)).toEqual([]);
  });
});

describe('세대와 보험사 형태 (칸 키)', () => {
  it('목록 밖이면 칸 검사가 읽을 수 없으므로 VALUE_INVALID', () => {
    expect(check(edited(['generation'], 'GEN9'))).toEqual([{ code: 'VALUE_INVALID', path: `${P}.generation` }]);
    expect(check(edited(['insurerType'], 'BANK'))).toEqual([{ code: 'VALUE_INVALID', path: `${P}.insurerType` }]);
  });

  it('없으면 VALUE_MISSING', () => {
    expect(check(removed(['generation']))).toEqual([{ code: 'VALUE_MISSING', path: `${P}.generation` }]);
    expect(check(removed(['insurerType']))).toEqual([{ code: 'VALUE_MISSING', path: `${P}.insurerType` }]);
  });
});

describe('프로필 구조 결함 — 엔진 checkProfileStructure 를 그대로 부르고 묶음 경로를 붙인다', () => {
  const group = (key: string, extra: Partial<CoverageGroupDef> = {}): CoverageGroupDef => ({
    groupKey: key,
    deduction: { kind: 'FIXED', fixed: 1_000 },
    limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' },
    ...extra,
  });
  const pool = { poolKey: 'TEST_POOL_1', limit: { kind: 'ANNUAL', amount: 500_000, limitBasis: 'PAYOUT' } } as const;
  const cases: Array<[ProfileStructureDefectCode, string, StandardAssumptionProfile]> = [
    ['EMPTY_PROFILE', 'groups', reseal({ ...base, groups: [], groupOrder: [] })],
    ['GROUP_ENTRY_INVALID', 'groups[1]', reseal({ ...base, groups: [group('A'), null as never], groupOrder: ['A'] })],
    ['EMPTY_GROUP_KEY', 'groups[1].groupKey', reseal({ ...base, groups: [group('A'), group('')], groupOrder: ['A', ''] })],
    ['DUPLICATE_GROUP_KEY', 'groups[1].groupKey', reseal({ ...base, groups: [group('A'), group('A')], groupOrder: ['A'] })],
    ['POOLS_NOT_ARRAY', 'sharedLimitPools', reseal({ ...base, sharedLimitPools: null as never })],
    ['POOL_ENTRY_INVALID', 'sharedLimitPools[0]', reseal({ ...base, sharedLimitPools: [5 as never] })],
    ['EMPTY_POOL_KEY', 'sharedLimitPools[0].poolKey', reseal({ ...base, sharedLimitPools: [{ ...pool, poolKey: '' }] })],
    ['DUPLICATE_POOL_KEY', 'sharedLimitPools[1].poolKey', reseal({ ...base, sharedLimitPools: [pool, { ...pool }] })],
    ['UNKNOWN_POOL_REFERENCE', 'groups[0].sharedLimitPoolKey', reseal({ ...base, groups: [group('A', { sharedLimitPoolKey: 'NO_SUCH' }), group('B')], groupOrder: ['A', 'B'] })],
    ['GROUP_ORDER_MISSING_KEY', 'groupOrder', reseal({ ...base, groupOrder: ['TEST_GROUP_BENEFIT'] })],
    ['GROUP_ORDER_DUPLICATE_KEY', 'groupOrder[2]', reseal({ ...base, groupOrder: ['TEST_GROUP_BENEFIT', 'TEST_GROUP_NON_BENEFIT', 'TEST_GROUP_BENEFIT'] })],
    ['GROUP_ORDER_UNKNOWN_KEY', 'groupOrder[2]', reseal({ ...base, groupOrder: ['TEST_GROUP_BENEFIT', 'TEST_GROUP_NON_BENEFIT', 'NO_SUCH_GROUP'] })],
  ];

  it.each(cases)('%s → %s 경로의 결함 하나이고 엔진 판정과 코드·순서가 같다', (code, relativePath, profile) => {
    const engine = checkProfileStructure(profile);
    expect(engine.ok).toBe(false);
    const engineDefects = engine.ok ? [] : engine.defects;
    expect(engineDefects.map((defect) => defect.code)).toContain(code);
    expect(check(profile)).toEqual(engineDefects.map((defect) => ({ code: defect.code, path: `${P}.${defect.path}` })));
    expect(check(profile)).toContainEqual({ code, path: `${P}.${relativePath}` });
  });

  it('구조가 올바른 프로필은 엔진도 ok 이고 게시 검증도 결함이 없다', () => {
    expect(checkProfileStructure(base)).toEqual({ ok: true });
    expect(check(base)).toEqual([]);
  });

  it('멤버가 없는 풀은 구조 결함이 아니다 (거절하지 않는다)', () => {
    const memberless = reseal({ ...base, sharedLimitPools: [pool] });
    expect(checkProfileStructure(memberless)).toEqual({ ok: true });
    expect(check(memberless)).toEqual([]);
  });

  it('구조 결함이 여럿이면 엔진의 고정 순서(그룹 → 풀 → 풀 참조 → groupOrder)를 그대로 따른다', () => {
    const profile = reseal({
      ...base,
      groups: [group('A', { sharedLimitPoolKey: 'NO_SUCH' }), group('A')],
      sharedLimitPools: [pool, { ...pool }],
      groupOrder: ['A', 'Z'],
    });
    expect(check(profile).map((defect) => defect.code)).toEqual([
      'DUPLICATE_GROUP_KEY',
      'DUPLICATE_POOL_KEY',
      'UNKNOWN_POOL_REFERENCE',
      'GROUP_ORDER_UNKNOWN_KEY',
    ]);
  });
});

// ───────────────────────── 값 범위 ─────────────────────────

const WON_INVALID: Array<[string, unknown]> = [
  ['-1', -1],
  ['소수', 0.5],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['문자열', '1000'],
  ['불리언', true],
  ['MAX_AMOUNT_WON + 1', MAX_AMOUNT_WON + 1],
  ['-0', -0],
];
const BP_INVALID: Array<[string, unknown]> = [
  ['-1', -1],
  ['10001', 10_001],
  ['소수', 0.5],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['문자열', '5000'],
  ['MAX_AMOUNT_WON (금액 상한은 비율 상한이 아니다)', MAX_AMOUNT_WON],
  ['-0', -0],
];

interface FieldSpec {
  name: string;
  type: 'won' | 'bp';
}
interface RuleSpec {
  kind: string;
  fields: FieldSpec[];
  /** 올바른 값으로 채운 규칙. */
  make: () => Record<string, unknown>;
}

const DEDUCTIONS: RuleSpec[] = [
  { kind: 'FIXED', fields: [{ name: 'fixed', type: 'won' }], make: () => ({ kind: 'FIXED', fixed: 1_000 }) },
  {
    kind: 'RATE_WITH_FIXED_FLOOR',
    fields: [{ name: 'fixed', type: 'won' }, { name: 'rate', type: 'bp' }],
    make: () => ({ kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 2_000, rounding: 'TRUNCATE' }),
  },
  {
    kind: 'CAPPED_RATE_WITH_FIXED_FLOOR',
    fields: [{ name: 'fixed', type: 'won' }, { name: 'rate', type: 'bp' }],
    make: () => ({ kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 2_000, rounding: 'ROUND_HALF_UP' }),
  },
  {
    kind: 'SPLIT_RATE_WITH_FIXED_FLOOR',
    fields: [{ name: 'fixed', type: 'won' }, { name: 'rateBenefit', type: 'bp' }, { name: 'rateNonBenefit', type: 'bp' }],
    make: () => ({ kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rateBenefit: 2_000, rateNonBenefit: 3_000, rounding: 'TRUNCATE' }),
  },
];
const LIMITS: RuleSpec[] = [
  { kind: 'PER_VISIT_PAYOUT', fields: [{ name: 'amount', type: 'won' }], make: () => ({ kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' }) },
  { kind: 'PER_ACCIDENT', fields: [{ name: 'amount', type: 'won' }], make: () => ({ kind: 'PER_ACCIDENT', amount: 100_000, limitBasis: 'PAYOUT' }) },
  { kind: 'ANNUAL', fields: [{ name: 'amount', type: 'won' }], make: () => ({ kind: 'ANNUAL', amount: 100_000, limitBasis: 'PAYOUT' }) },
  { kind: 'COUNT', fields: [{ name: 'perUseAmount', type: 'won' }], make: () => ({ kind: 'COUNT', perUseAmount: 30_000, limitBasis: 'PAYOUT' }) },
];

/** 값이 놓이는 세 자리: 그룹의 공제, 그룹의 한도, 공유 한도 풀의 한도. 각 자리에 규칙 하나를 넣은 프로필과 그 규칙의 보고 경로를 만든다. */
interface Place {
  label: string;
  specs: RuleSpec[];
  build: (rule: Record<string, unknown>) => StandardAssumptionProfile;
  prefix: string;
}
const POOLED_GROUP = (): CoverageGroupDef => ({ ...base.groups[0]!, sharedLimitPoolKey: 'TEST_POOL_1' });
const PLACES: Place[] = [
  {
    label: '그룹 공제',
    specs: DEDUCTIONS,
    build: (rule) => reseal({ ...base, groups: [{ ...base.groups[0]!, deduction: rule as never }, base.groups[1]!] }),
    prefix: `${P}.groups[0].deduction`,
  },
  {
    label: '그룹 한도',
    specs: LIMITS,
    build: (rule) => reseal({ ...base, groups: [{ ...base.groups[0]!, limit: rule as never }, base.groups[1]!] }),
    prefix: `${P}.groups[0].limit`,
  },
  {
    label: '공유 한도 풀 한도',
    specs: LIMITS,
    build: (rule) =>
      reseal({ ...base, groups: [POOLED_GROUP(), base.groups[1]!], sharedLimitPools: [{ poolKey: 'TEST_POOL_1', limit: rule as never }] }),
    prefix: `${P}.sharedLimitPools[0].limit`,
  },
];

describe.each(PLACES)('$label 의 값 범위 (DD-24)', ({ specs, build, prefix }) => {
  describe.each(specs)('$kind', ({ fields, make }) => {
    it('올바른 값은 결함이 없다', () => {
      expect(check(build(make()))).toEqual([]);
    });

    describe.each(fields)('$name ($type)', ({ name, type }) => {
      const invalid = type === 'won' ? WON_INVALID : BP_INVALID;
      const validBoundaries = type === 'won' ? [0, 1, MAX_AMOUNT_WON] : [0, 1, 10_000];

      it.each(invalid)('%s → VALUE_INVALID 이고 어긋난 필드 경로가 붙는다', (_label, value) => {
        expect(check(build({ ...make(), [name]: value }))).toEqual([{ code: 'VALUE_INVALID', path: `${prefix}.${name}` }]);
      });

      it.each(validBoundaries)('경계값 %s 는 허용한다', (value) => {
        expect(check(build({ ...make(), [name]: value }))).toEqual([]);
      });

      it('없거나 null 이면 VALUE_MISSING (0·기본값으로 채우지 않는다)', () => {
        const without = make();
        delete without[name];
        expect(check(build(without))).toEqual([{ code: 'VALUE_MISSING', path: `${prefix}.${name}` }]);
        expect(check(build({ ...make(), [name]: null }))).toEqual([{ code: 'VALUE_MISSING', path: `${prefix}.${name}` }]);
      });
    });
  });
});

describe('값 범위: 금액은 0 이상 MAX_AMOUNT_WON, 비율은 0 이상 10000 (경계 한 쌍)', () => {
  it('금액 MAX_AMOUNT_WON 은 허용하고 MAX_AMOUNT_WON + 1 은 거절한다', () => {
    expect(check(edited(['groups', 0, 'deduction', 'fixed'], MAX_AMOUNT_WON))).toEqual([]);
    expect(check(edited(['groups', 0, 'deduction', 'fixed'], MAX_AMOUNT_WON + 1))).toEqual([{ code: 'VALUE_INVALID', path: `${P}.groups[0].deduction.fixed` }]);
  });

  it('비율 0 과 10000 은 허용하고 10001 과 -1 은 거절한다', () => {
    const rated = (rate: unknown) => reseal({ ...base, groups: [{ ...base.groups[0]!, deduction: { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 0, rate: rate as number, rounding: 'TRUNCATE' } }, base.groups[1]!] });
    expect(check(rated(0))).toEqual([]);
    expect(check(rated(10_000))).toEqual([]);
    expect(check(rated(10_001))).toEqual([{ code: 'VALUE_INVALID', path: `${P}.groups[0].deduction.rate` }]);
    expect(check(rated(-1))).toEqual([{ code: 'VALUE_INVALID', path: `${P}.groups[0].deduction.rate` }]);
  });

  it('어긋난 필드 경로 예시: 둘째 그룹의 공제 비율 → bundle.profiles[0].groups[1].deduction.rate', () => {
    const profile = reseal({
      ...base,
      groups: [base.groups[0]!, { ...base.groups[1]!, deduction: { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 0, rate: 10_001, rounding: 'TRUNCATE' } }],
    });
    expect(check(profile)).toEqual([{ code: 'VALUE_INVALID', path: 'bundle.profiles[0].groups[1].deduction.rate' }]);
  });
});

describe('값 범위: 원 단위 처리(rounding)와 한도 기준(limitBasis)의 빠짐·틀림', () => {
  it.each(['RATE_WITH_FIXED_FLOOR', 'CAPPED_RATE_WITH_FIXED_FLOOR', 'SPLIT_RATE_WITH_FIXED_FLOOR'])('%s: rounding 이 목록 밖이면 VALUE_INVALID, 없으면 VALUE_MISSING, 두 값은 유효하다', (kind) => {
    const spec = DEDUCTIONS.find((candidate) => candidate.kind === kind)!;
    const place = PLACES[0]!;
    for (const ok of ['TRUNCATE', 'ROUND_HALF_UP']) {
      expect(check(place.build({ ...spec.make(), rounding: ok }))).toEqual([]);
    }
    for (const bad of ['ROUND', '', 'truncate', 1, true]) {
      expect(check(place.build({ ...spec.make(), rounding: bad }))).toEqual([{ code: 'VALUE_INVALID', path: `${place.prefix}.rounding` }]);
    }
    for (const gone of [undefined, null]) {
      expect(check(place.build({ ...spec.make(), rounding: gone }))).toEqual([{ code: 'VALUE_MISSING', path: `${place.prefix}.rounding` }]);
    }
  });

  it('FIXED 공제는 rounding 을 보지 않는다', () => {
    expect(check(PLACES[0]!.build({ kind: 'FIXED', fixed: 5, rounding: 'garbage' }))).toEqual([]);
  });

  it.each(LIMITS.map((spec) => spec.kind))('%s 한도: limitBasis 가 없거나 null 이면 VALUE_MISSING', (kind) => {
    const spec = LIMITS.find((candidate) => candidate.kind === kind)!;
    for (const [place] of [[PLACES[1]!], [PLACES[2]!]]) {
      for (const gone of [undefined, null]) {
        expect(check(place!.build({ ...spec.make(), limitBasis: gone }))).toEqual([{ code: 'VALUE_MISSING', path: `${place!.prefix}.limitBasis` }]);
      }
    }
  });

  it('공제나 한도 규칙 자체가 없거나 null 이면 VALUE_MISSING', () => {
    const noDeduction = reseal({ ...base, groups: [{ ...base.groups[0]!, deduction: undefined as never }, base.groups[1]!] });
    const nullLimit = reseal({ ...base, groups: [{ ...base.groups[0]!, limit: null as never }, base.groups[1]!] });
    const nullPoolLimit = reseal({ ...base, groups: [POOLED_GROUP(), base.groups[1]!], sharedLimitPools: [{ poolKey: 'TEST_POOL_1', limit: null as never }] });
    expect(check(noDeduction)).toEqual([{ code: 'VALUE_MISSING', path: `${P}.groups[0].deduction` }]);
    expect(check(nullLimit)).toEqual([{ code: 'VALUE_MISSING', path: `${P}.groups[0].limit` }]);
    expect(check(nullPoolLimit)).toEqual([{ code: 'VALUE_MISSING', path: `${P}.sharedLimitPools[0].limit` }]);
  });
});

describe('공식 지원 여부는 게시 거절 사유가 아니다 (계산 때의 보류 사유)', () => {
  const group0 = (patch: Partial<CoverageGroupDef>): StandardAssumptionProfile => reseal({ ...base, groups: [{ ...base.groups[0]!, ...patch }, base.groups[1]!] });

  const unsupported: Array<[string, StandardAssumptionProfile, 'PROFILE_FORMULA_UNSUPPORTED' | 'PROFILE_SOURCE_INCOMPLETE']> = [
    ['알 수 없는 공제 종류', group0({ deduction: { kind: 'MYSTERY', fixed: 1 } as never }), 'PROFILE_FORMULA_UNSUPPORTED'],
    ['공제가 객체가 아님', group0({ deduction: 'FIXED' as never }), 'PROFILE_FORMULA_UNSUPPORTED'],
    ['알 수 없는 한도 종류', group0({ limit: { kind: 'MYSTERY', amount: 1 } as never }), 'PROFILE_FORMULA_UNSUPPORTED'],
    ['한도가 객체가 아님', group0({ limit: 'ANNUAL' as never }), 'PROFILE_FORMULA_UNSUPPORTED'],
    ['limitBasis = COVERED_COST', group0({ limit: { kind: 'ANNUAL', amount: 1, limitBasis: 'COVERED_COST' } }), 'PROFILE_FORMULA_UNSUPPORTED'],
    ['limitBasis 가 목록 밖 문자열', group0({ limit: { kind: 'ANNUAL', amount: 1, limitBasis: 'WHATEVER' as never } }), 'PROFILE_FORMULA_UNSUPPORTED'],
    ['UNLIMITED_DECLARED 에 조항 참조가 없음', group0({ limit: { kind: 'UNLIMITED_DECLARED', policyClauseRef: '' } }), 'PROFILE_SOURCE_INCOMPLETE'],
    ['UNLIMITED_DECLARED 에 조항 참조 필드 자체가 없음', group0({ limit: { kind: 'UNLIMITED_DECLARED' } as never }), 'PROFILE_SOURCE_INCOMPLETE'],
  ];

  it.each(unsupported)('%s → 엔진은 %s 로 보류하지만 게시 검증은 결함을 내지 않는다', (_name, profile, engineCode) => {
    const target = profile.groups[0]!;
    expect(checkGroupValues(target, profile)).toBe(engineCode);
    expect(check(profile)).toEqual([]);
  });

  it('UNLIMITED_DECLARED 에 조항 참조가 있는 한도도 결함이 없다', () => {
    expect(check(group0({ limit: { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'TEST_FIXTURE_CLAUSE' } }))).toEqual([]);
  });

  it('지원 밖 풀 한도(COVERED_COST)도 결함이 없다', () => {
    const profile = reseal({
      ...base,
      groups: [POOLED_GROUP(), base.groups[1]!],
      sharedLimitPools: [{ poolKey: 'TEST_POOL_1', limit: { kind: 'ANNUAL', amount: 5, limitBasis: 'COVERED_COST' } }],
    });
    expect(check(profile)).toEqual([]);
  });
});

describe('공유 한도 풀의 값 결함', () => {
  const poolLimit = (limit: unknown, members: boolean): StandardAssumptionProfile =>
    reseal({
      ...base,
      groups: members ? [POOLED_GROUP(), base.groups[1]!] : base.groups,
      sharedLimitPools: [{ poolKey: 'TEST_POOL_1', limit: limit as never }],
    });
  const badLimit = { kind: 'ANNUAL', amount: MAX_AMOUNT_WON + 1, limitBasis: 'PAYOUT' };

  it('멤버가 있는 풀의 금액이 범위 밖이면 풀 경로로 거절한다', () => {
    expect(check(poolLimit(badLimit, true))).toEqual([{ code: 'VALUE_INVALID', path: `${P}.sharedLimitPools[0].limit.amount` }]);
  });

  it('멤버가 없는 풀의 금액이 범위 밖이어도 거절한다 (AC-011i: 풀의 금액이 DD-24 범위 밖인 경우도 그룹 값과 같이 거절)', () => {
    expect(check(poolLimit(badLimit, false))).toEqual([{ code: 'VALUE_INVALID', path: `${P}.sharedLimitPools[0].limit.amount` }]);
  });

  it('멤버가 없는 올바른 풀은 허용한다 (AC-011i: 멤버가 없는 풀은 거절하지 않는다)', () => {
    expect(check(poolLimit({ kind: 'ANNUAL', amount: 0, limitBasis: 'PAYOUT' }, false))).toEqual([]);
  });

  it('풀 값 결함은 풀 하나에 한 번만 보고되고, 멤버 그룹의 경로로 번지지 않는다', () => {
    const defects = check(poolLimit(badLimit, true));
    expect(defects.filter((defect) => defect.path.includes('groups['))).toEqual([]);
  });

  it('그룹 값 결함과 풀 값 결함은 따로 보고한다: 그룹 → 풀 순서', () => {
    const profile = reseal({
      ...base,
      groups: [{ ...POOLED_GROUP(), deduction: { kind: 'FIXED', fixed: -1 } }, base.groups[1]!],
      sharedLimitPools: [{ poolKey: 'TEST_POOL_1', limit: badLimit as never }],
    });
    expect(check(profile)).toEqual([
      { code: 'VALUE_INVALID', path: `${P}.groups[0].deduction.fixed` },
      { code: 'VALUE_INVALID', path: `${P}.sharedLimitPools[0].limit.amount` },
    ]);
  });
});

describe('결함 보고 순서와 비정상 입력', () => {
  it('구조 결함이 먼저, 그 뒤에 값 결함(그룹 → 풀)이다', () => {
    const profile = reseal({
      ...base,
      groups: [{ ...base.groups[0]!, deduction: { kind: 'FIXED', fixed: -5 } }, base.groups[1]!],
      groupOrder: ['TEST_GROUP_BENEFIT'],
    });
    expect(check(profile)).toEqual([
      { code: 'GROUP_ORDER_MISSING_KEY', path: `${P}.groupOrder` },
      { code: 'VALUE_INVALID', path: `${P}.groups[0].deduction.fixed` },
    ]);
  });

  it('그룹 항목이 객체가 아니면 항목 모양 결함 하나이고 그 항목의 값은 읽지 않는다', () => {
    const profile = reseal({ ...base, groups: [null as never, base.groups[1]!], groupOrder: ['TEST_GROUP_NON_BENEFIT'] });
    expect(check(profile)).toEqual([{ code: 'GROUP_ENTRY_INVALID', path: `${P}.groups[0]` }]);
  });

  it('풀 항목이 객체가 아니면 항목 모양 결함 하나이고 그 항목의 값은 읽지 않는다', () => {
    const profile = reseal({ ...base, sharedLimitPools: ['x' as never, [] as never] });
    expect(check(profile)).toEqual([
      { code: 'POOL_ENTRY_INVALID', path: `${P}.sharedLimitPools[0]` },
      { code: 'POOL_ENTRY_INVALID', path: `${P}.sharedLimitPools[1]` },
    ]);
  });

  it('groups 가 배열이 아니면 EMPTY_PROFILE 하나뿐이다 (값 검사로 번지지 않는다)', () => {
    expect(check(reseal({ ...base, groups: 'x' as never }))).toEqual([{ code: 'EMPTY_PROFILE', path: `${P}.groups` }]);
  });

  it.each([undefined, null, 5, 'x', true, {}])('sharedLimitPools = %j 도 던지지 않는다', (garbage) => {
    expect(() => check(reseal({ ...base, sharedLimitPools: garbage as never }))).not.toThrow();
  });
});

// ───────────────────────── 봉인 ─────────────────────────

describe('봉인: 게시 검증과 엔진 무결성 판정이 같은 정규화를 쓴다', () => {
  const ctx = { at: TEST_AT, acceptedOrigins: ['TEST_FIXTURE'] as const, digest: canonicalDigest };
  const integrityOf = (profile: StandardAssumptionProfile): 'OK' | 'MISMATCH' => {
    const verdict = isUsable(profileToRuleItem(profile), ctx);
    return verdict.usable || verdict.reason !== 'INTEGRITY_MISMATCH' ? 'OK' : 'MISMATCH';
  };
  const publishIntegrity = (profile: StandardAssumptionProfile): 'OK' | 'MISMATCH' =>
    check(profile).some((defect) => defect.code === 'INTEGRITY_MISMATCH') ? 'MISMATCH' : 'OK';

  it('원래 순서의 해시는 groups·sharedLimitPools 를 다른 순서로 저장한 같은 프로필에서도 통과한다 (AC-011a 의 (i))', () => {
    const pooled = reseal({
      ...base,
      groups: [{ ...base.groups[0]!, sharedLimitPoolKey: 'POOL_A' }, { ...base.groups[1]!, sharedLimitPoolKey: 'POOL_B' }],
      sharedLimitPools: [
        { poolKey: 'POOL_A', limit: { kind: 'ANNUAL', amount: 10, limitBasis: 'PAYOUT' } },
        { poolKey: 'POOL_B', limit: { kind: 'ANNUAL', amount: 20, limitBasis: 'PAYOUT' } },
      ],
    });
    const shuffled: StandardAssumptionProfile = { ...pooled, groups: [...pooled.groups].reverse(), sharedLimitPools: [...pooled.sharedLimitPools].reverse() };
    expect(shuffled.contentHash).toBe(pooled.contentHash);
    expect(check(shuffled)).toEqual([]);
    expect(integrityOf(shuffled)).toBe('OK');
  });

  it('실제 규칙 값이나 groupOrder 가 바뀌면 옛 해시로는 실패한다 (AC-011a 의 (ii))', () => {
    const reorderedGroupOrder: StandardAssumptionProfile = { ...base, groupOrder: [...base.groupOrder].reverse() };
    const changedValue: StandardAssumptionProfile = { ...base, groups: [{ ...base.groups[0]!, deduction: { kind: 'FIXED', fixed: 1_001 } }, base.groups[1]!] };
    const renamedGroup: StandardAssumptionProfile = { ...base, groups: [{ ...base.groups[0]!, groupKey: 'TEST_GROUP_RENAMED' }, base.groups[1]!], groupOrder: ['TEST_GROUP_RENAMED', 'TEST_GROUP_NON_BENEFIT'] };
    for (const tampered of [reorderedGroupOrder, changedValue, renamedGroup]) {
      expect(publishIntegrity(tampered)).toBe('MISMATCH');
      expect(integrityOf(tampered)).toBe('MISMATCH');
    }
  });

  it('엔진 시험용 해시(testDigest)로 봉인한 프로필은 운영 해시와 달라 거절된다 (이전 방식의 해시 자료에 기대지 않는다)', () => {
    const legacy = { ...base, contentHash: 'TEST_DIGEST_0badf00d' };
    expect(check(legacy)).toEqual([{ code: 'INTEGRITY_MISMATCH', path: `${P}.contentHash` }]);
  });

  it('게시 검증의 봉인 판정은 엔진 isUsable 의 무결성 판정과 변형 전체에서 같다', () => {
    const variants = [
      base,
      { ...base, contentHash: 'x' },
      reseal({ ...base, version: 'v2' }),
      { ...base, version: 'v2' },
      { ...base, groups: [...base.groups].reverse() },
      { ...base, groupOrder: [] },
    ];
    for (const variant of variants) {
      expect(publishIntegrity(variant)).toBe(integrityOf(variant));
    }
  });
});

// ───────────────────────── 계산 때 값 검사와의 일치 ─────────────────────────

describe('게시 값 검사는 엔진 checkGroupValues 와 어긋나지 않는다', () => {
  const SEED = 20_261_016;
  const TRIALS = 800;

  const AMOUNT_OK: unknown[] = [0, 1, 1_000, 100_000, MAX_AMOUNT_WON];
  const AMOUNTS: unknown[] = [...AMOUNT_OK, MAX_AMOUNT_WON + 1, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '1000', null, undefined, -0, true];
  const RATE_OK: unknown[] = [0, 2_000, 5_000, 10_000];
  const RATES: unknown[] = [...RATE_OK, 10_001, -1, 0.5, Number.NaN, '5000', null, undefined, -0];
  const ROUNDING_OK: unknown[] = ['TRUNCATE', 'ROUND_HALF_UP'];
  const ROUNDINGS: unknown[] = [...ROUNDING_OK, 'ROUND', '', null, undefined, 1];
  const BASIS_OK: unknown[] = ['PAYOUT'];
  const BASES: unknown[] = ['PAYOUT', 'PAYOUT', undefined, null];

  function generate(random: () => number): StandardAssumptionProfile {
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
    // 규칙 하나마다 "깨끗한" 규칙(모든 값이 올바름)과 "어딘가 틀릴 수 있는" 규칙을 섞어, 양쪽 판정이 모두 충분히 나오게 한다.
    const deduction = (): unknown => {
      const clean = random() < 0.35;
      const amount = (): unknown => pick(clean ? AMOUNT_OK : AMOUNTS);
      const rate = (): unknown => pick(clean ? RATE_OK : RATES);
      const rounding = (): unknown => pick(clean ? ROUNDING_OK : ROUNDINGS);
      if (!clean && random() < 0.05) return pick([undefined, null]);
      switch (pick(['FIXED', 'RATE_WITH_FIXED_FLOOR', 'CAPPED_RATE_WITH_FIXED_FLOOR', 'SPLIT_RATE_WITH_FIXED_FLOOR'])) {
        case 'FIXED':
          return { kind: 'FIXED', fixed: amount() };
        case 'SPLIT_RATE_WITH_FIXED_FLOOR':
          return { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: amount(), rateBenefit: rate(), rateNonBenefit: rate(), rounding: rounding() };
        case 'CAPPED_RATE_WITH_FIXED_FLOOR':
          return { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: amount(), rate: rate(), rounding: rounding() };
        default:
          return { kind: 'RATE_WITH_FIXED_FLOOR', fixed: amount(), rate: rate(), rounding: rounding() };
      }
    };
    const limit = (): unknown => {
      const clean = random() < 0.4;
      const amount = (): unknown => pick(clean ? AMOUNT_OK : AMOUNTS);
      const basis = (): unknown => pick(clean ? BASIS_OK : BASES);
      if (!clean && random() < 0.05) return pick([undefined, null]);
      switch (pick(['PER_VISIT_PAYOUT', 'PER_ACCIDENT', 'ANNUAL', 'COUNT', 'UNLIMITED_DECLARED'])) {
        case 'UNLIMITED_DECLARED':
          return { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'TEST_FIXTURE_CLAUSE' };
        case 'COUNT':
          return { kind: 'COUNT', perUseAmount: amount(), limitBasis: basis() };
        case 'ANNUAL':
          return { kind: 'ANNUAL', amount: amount(), limitBasis: basis() };
        case 'PER_ACCIDENT':
          return { kind: 'PER_ACCIDENT', amount: amount(), limitBasis: basis() };
        default:
          return { kind: 'PER_VISIT_PAYOUT', amount: amount(), limitBasis: basis() };
      }
    };
    const poolCount = Math.floor(random() * 4);
    const pools = Array.from({ length: poolCount }, (_, index) => ({ poolKey: `POOL_${index}`, limit: limit() }));
    const groupCount = 1 + Math.floor(random() * 4);
    const groups = Array.from({ length: groupCount }, (_, index) => ({
      groupKey: `GROUP_${index}`,
      deduction: deduction(),
      limit: limit(),
      ...(poolCount > 0 && random() < 0.6 ? { sharedLimitPoolKey: `POOL_${Math.floor(random() * poolCount)}` } : {}),
    }));
    return reseal({ ...base, groups: groups as never, groupOrder: groups.map((group) => group.groupKey), sharedLimitPools: pools as never });
  }

  const isNumericHold = (code: string | null): boolean => code === 'PROFILE_VALUE_MISSING' || code === 'PROFILE_VALUE_INVALID';

  it(`고정 시드 ${SEED} 로 만든 프로필 ${TRIALS}개에서 게시 판정과 엔진 판정이 그룹·풀·풀 멤버마다 같다`, () => {
    console.info(`[validate-bundle-profile] 일치 시험 seed=${SEED} trials=${TRIALS}`);
    const random = seededRandom(SEED);
    const tally = { groupBad: 0, groupOk: 0, poolBad: 0, poolOk: 0, memberBad: 0 };

    for (let trial = 0; trial < TRIALS; trial += 1) {
      const profile = generate(random);
      expect(checkProfileStructure(profile)).toEqual({ ok: true });
      const defects = check(profile);
      // 구조가 올바르고 봉인을 맞췄으므로 남는 결함은 값 결함뿐이다.
      expect(defects.every((defect) => defect.code === 'VALUE_MISSING' || defect.code === 'VALUE_INVALID')).toBe(true);
      const bad = (prefix: string): boolean => defects.some((defect) => defect.path.startsWith(`${prefix}.`) || defect.path === prefix);

      // 풀: 그 풀을 가리키는 시험용 그룹(값은 모두 올바름)을 엔진에 물어 풀 자신의 판정을 얻는다 (멤버가 없는 풀도 같은 방식으로 판정된다).
      const poolBad = profile.sharedLimitPools.map((pool, index) => {
        const probe: CoverageGroupDef = {
          groupKey: 'PROBE',
          deduction: { kind: 'FIXED', fixed: 0 },
          limit: { kind: 'PER_VISIT_PAYOUT', amount: 0, limitBasis: 'PAYOUT' },
          sharedLimitPoolKey: pool.poolKey,
        };
        const engine = isNumericHold(checkGroupValues(probe, profile));
        const publish = bad(`${P}.sharedLimitPools[${index}]`);
        expect(publish).toBe(engine);
        tally[publish ? 'poolBad' : 'poolOk'] += 1;
        return publish;
      });

      profile.groups.forEach((group, index) => {
        const { sharedLimitPoolKey: _pool, ...ownOnly } = group;
        const engineOwn = isNumericHold(checkGroupValues(ownOnly, profile));
        const publishOwn = bad(`${P}.groups[${index}]`);
        expect(publishOwn).toBe(engineOwn);
        tally[publishOwn ? 'groupBad' : 'groupOk'] += 1;

        // 풀 멤버: 엔진은 풀 결함을 멤버 그룹의 결함으로 읽는다. 게시는 같은 결함을 풀 경로로 보고하므로 합쳐서 같아야 한다.
        const poolIndex = profile.sharedLimitPools.findIndex((pool) => pool.poolKey === group.sharedLimitPoolKey);
        const engineReal = isNumericHold(checkGroupValues(group, profile));
        const viaPool = poolIndex >= 0 && poolBad[poolIndex] === true;
        expect(engineReal).toBe(publishOwn || viaPool);
        if (viaPool) tally.memberBad += 1;
      });
    }

    // 시험이 허공을 치지 않았음을 보인다: 양쪽 판정이 충분히 나왔다.
    expect(tally.groupBad).toBeGreaterThan(100);
    expect(tally.groupOk).toBeGreaterThan(100);
    expect(tally.poolBad).toBeGreaterThan(30);
    expect(tally.poolOk).toBeGreaterThan(30);
    expect(tally.memberBad).toBeGreaterThan(20);
  });
});
