import { describe, expect, it } from 'vitest';
import { checkGroupValues } from '../../src/engine/group-values';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import type { CoverageGroupDef, DeductionRule, LimitRule, StandardAssumptionProfile } from '../../src/engine/types';
import { makeProfile } from '../fixtures/engine/profiles.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.
// 그룹 값 검사는 저장 자료만으로 정해지는 검사다(CALC_RANGE_EXCEEDED 는 제외, 산술 단계의 몫). 결과는 보류 코드 하나 또는 null.

const GOOD_DEDUCTION: DeductionRule = { kind: 'FIXED', fixed: 1_000 };
const GOOD_LIMIT: LimitRule = { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' };

/** 객체 안의 필드를 임의 값으로 바꾸는 시험용 변환. 엔진은 JS 호출자도 믿지 않는다. */
function loose<T>(value: unknown): T {
  return value as T;
}

function check(
  deduction: unknown = GOOD_DEDUCTION,
  limit: unknown = GOOD_LIMIT,
  pool?: { limit: unknown },
) {
  const group: CoverageGroupDef = {
    groupKey: 'TEST_GROUP_X',
    deduction: loose<DeductionRule>(deduction),
    limit: loose<LimitRule>(limit),
    ...(pool ? { sharedLimitPoolKey: 'TEST_POOL_X' } : {}),
  };
  const profile: StandardAssumptionProfile = makeProfile({
    groups: [group],
    sharedLimitPools: pool ? [{ poolKey: 'TEST_POOL_X', limit: loose<LimitRule>(pool.limit) }] : [],
  });
  return checkGroupValues(group, profile);
}

const INVALID_AMOUNTS: Array<[string, unknown]> = [
  ['음수 -1', -1],
  ['-0', -0],
  ['소수 0.5', 0.5],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['문자열 "1000"', '1000'],
  ['MAX_AMOUNT_WON + 1', MAX_AMOUNT_WON + 1],
  ['불리언', true],
];

const INVALID_RATES: Array<[string, unknown]> = [
  ['음수 -1', -1],
  ['10001 (상한 바로 바깥)', 10001],
  ['소수 0.5', 0.5],
  ['NaN', Number.NaN],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['문자열 "2000"', '2000'],
];

describe('checkGroupValues — 정상 (AC-003g 경계값 포함)', () => {
  it('유효한 그룹은 null 이다', () => {
    expect(check()).toBeNull();
  });

  it('경계값은 유효하다: 금액 0 과 MAX_AMOUNT_WON, 비율 0 과 10000', () => {
    expect(check({ kind: 'FIXED', fixed: 0 })).toBeNull();
    expect(check({ kind: 'FIXED', fixed: MAX_AMOUNT_WON })).toBeNull();
    for (const rate of [0, 10000]) {
      expect(check({ kind: 'RATE_WITH_FIXED_FLOOR', fixed: 0, rate, rounding: 'TRUNCATE' })).toBeNull();
    }
    expect(check(GOOD_DEDUCTION, { kind: 'PER_VISIT_PAYOUT', amount: MAX_AMOUNT_WON, limitBasis: 'PAYOUT' })).toBeNull();
  });

  it.each<[string, DeductionRule]>([
    ['FIXED', { kind: 'FIXED', fixed: 1_000 }],
    ['RATE_WITH_FIXED_FLOOR', { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 2000, rounding: 'ROUND_HALF_UP' }],
    ['SPLIT_RATE_WITH_FIXED_FLOOR', { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rateBenefit: 1000, rateNonBenefit: 2000, rounding: 'TRUNCATE' }],
    ['CAPPED_RATE_WITH_FIXED_FLOOR', { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 2000, rounding: 'TRUNCATE' }],
  ])('닫힌 공제 방식 %s 는 통과한다', (_name, rule) => {
    expect(check(rule)).toBeNull();
  });

  it.each<[string, LimitRule]>([
    ['PER_VISIT_PAYOUT', { kind: 'PER_VISIT_PAYOUT', amount: 1, limitBasis: 'PAYOUT' }],
    ['PER_ACCIDENT', { kind: 'PER_ACCIDENT', amount: 1, limitBasis: 'PAYOUT' }],
    ['ANNUAL', { kind: 'ANNUAL', amount: 1, limitBasis: 'PAYOUT' }],
    ['COUNT', { kind: 'COUNT', perUseAmount: 1, limitBasis: 'PAYOUT' }],
    ['UNLIMITED_DECLARED(조항 참조 있음)', { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'TEST_FIXTURE_CLAUSE' }],
  ])('닫힌 한도 종류 %s 는 통과한다', (_name, rule) => {
    expect(check(GOOD_DEDUCTION, rule)).toBeNull();
  });
});

describe('checkGroupValues — 공제 규칙', () => {
  it('deduction 이 없거나 null 이면 PROFILE_VALUE_MISSING (모든 그룹에 필수)', () => {
    expect(check(null)).toBe('PROFILE_VALUE_MISSING');
    // 기본 인자가 undefined 를 채우므로 deduction 필드가 아예 없는 그룹은 직접 구성한다.
    const group = loose<CoverageGroupDef>({ groupKey: 'TEST_GROUP_X', limit: GOOD_LIMIT });
    const profile = makeProfile({ groups: [{ groupKey: 'TEST_GROUP_X', deduction: GOOD_DEDUCTION, limit: GOOD_LIMIT }] });
    expect(checkGroupValues(group, profile)).toBe('PROFILE_VALUE_MISSING');
  });

  it('닫힌 목록 밖의 공제 방식은 PROFILE_FORMULA_UNSUPPORTED', () => {
    expect(check({ kind: 'TIERED_BY_AGE', fixed: 1_000 })).toBe('PROFILE_FORMULA_UNSUPPORTED');
    expect(check({ fixed: 1_000 })).toBe('PROFILE_FORMULA_UNSUPPORTED');
  });

  describe('FIXED', () => {
    it.each([['없음(undefined)', undefined], ['null', null]])('fixed %s -> PROFILE_VALUE_MISSING', (_n, value) => {
      expect(check({ kind: 'FIXED', fixed: value })).toBe('PROFILE_VALUE_MISSING');
    });
    it.each(INVALID_AMOUNTS)('fixed %s -> PROFILE_VALUE_INVALID', (_n, value) => {
      expect(check({ kind: 'FIXED', fixed: value })).toBe('PROFILE_VALUE_INVALID');
    });
  });

  describe.each([
    ['RATE_WITH_FIXED_FLOOR', { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 2000, rounding: 'TRUNCATE' }, ['rate']],
    ['CAPPED_RATE_WITH_FIXED_FLOOR', { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 2000, rounding: 'TRUNCATE' }, ['rate']],
    ['SPLIT_RATE_WITH_FIXED_FLOOR', { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 1_000, rateBenefit: 1000, rateNonBenefit: 2000, rounding: 'TRUNCATE' }, ['rateBenefit', 'rateNonBenefit']],
  ])('%s', (_name, base, rateFields) => {
    it('fixed 가 무효이면 PROFILE_VALUE_INVALID, 없으면 PROFILE_VALUE_MISSING', () => {
      expect(check({ ...base, fixed: -1 })).toBe('PROFILE_VALUE_INVALID');
      expect(check({ ...base, fixed: null })).toBe('PROFILE_VALUE_MISSING');
    });

    for (const field of rateFields) {
      it(`${field}: 없음·null -> MISSING, 무효 비율 -> INVALID`, () => {
        expect(check({ ...base, [field]: undefined })).toBe('PROFILE_VALUE_MISSING');
        expect(check({ ...base, [field]: null })).toBe('PROFILE_VALUE_MISSING');
        for (const [, value] of INVALID_RATES) {
          expect(check({ ...base, [field]: value })).toBe('PROFILE_VALUE_INVALID');
        }
      });
    }

    it('rounding 이 빠지면(없음·null) 기본값으로 계산하지 않고 PROFILE_VALUE_MISSING (AC-003a)', () => {
      expect(check({ ...base, rounding: undefined })).toBe('PROFILE_VALUE_MISSING');
      expect(check({ ...base, rounding: null })).toBe('PROFILE_VALUE_MISSING');
    });

    it('rounding 이 두 값 밖이면 PROFILE_VALUE_INVALID', () => {
      expect(check({ ...base, rounding: 'ROUND_UP' })).toBe('PROFILE_VALUE_INVALID');
      expect(check({ ...base, rounding: 5 })).toBe('PROFILE_VALUE_INVALID');
    });
  });
});

describe('checkGroupValues — 한도 규칙', () => {
  it('limit 이 없거나 null 이면 PROFILE_VALUE_MISSING', () => {
    expect(check(GOOD_DEDUCTION, null)).toBe('PROFILE_VALUE_MISSING');
  });

  it('닫힌 목록 밖의 한도 종류는 PROFILE_FORMULA_UNSUPPORTED', () => {
    expect(check(GOOD_DEDUCTION, { kind: 'LIFETIME', amount: 1, limitBasis: 'PAYOUT' })).toBe('PROFILE_FORMULA_UNSUPPORTED');
  });

  describe.each([
    ['PER_VISIT_PAYOUT', 'amount'],
    ['PER_ACCIDENT', 'amount'],
    ['ANNUAL', 'amount'],
    ['COUNT', 'perUseAmount'],
  ])('%s', (kind, field) => {
    const make = (overrides: Record<string, unknown>) => ({ kind, [field]: 1_000, limitBasis: 'PAYOUT', ...overrides });

    it(`${field} 가 없으면 MISSING, 무효이면 INVALID`, () => {
      expect(check(GOOD_DEDUCTION, make({ [field]: undefined }))).toBe('PROFILE_VALUE_MISSING');
      expect(check(GOOD_DEDUCTION, make({ [field]: null }))).toBe('PROFILE_VALUE_MISSING');
      for (const [, value] of INVALID_AMOUNTS) {
        expect(check(GOOD_DEDUCTION, make({ [field]: value }))).toBe('PROFILE_VALUE_INVALID');
      }
    });

    it('limitBasis = COVERED_COST 는 PROFILE_FORMULA_UNSUPPORTED (계산하지 않는다, AC-003c)', () => {
      expect(check(GOOD_DEDUCTION, make({ limitBasis: 'COVERED_COST' }))).toBe('PROFILE_FORMULA_UNSUPPORTED');
    });

    it('limitBasis 가 없으면 MISSING, 닫힌 목록 밖이면 PROFILE_FORMULA_UNSUPPORTED', () => {
      expect(check(GOOD_DEDUCTION, make({ limitBasis: undefined }))).toBe('PROFILE_VALUE_MISSING');
      expect(check(GOOD_DEDUCTION, make({ limitBasis: 'OTHER_BASIS' }))).toBe('PROFILE_FORMULA_UNSUPPORTED');
    });
  });

  it.each([
    ['조항 참조 없음(undefined)', undefined],
    ['빈 문자열', ''],
    ['공백뿐인 문자열', '   '],
    ['문자열이 아닌 값', 7],
  ])('UNLIMITED_DECLARED 의 %s -> PROFILE_SOURCE_INCOMPLETE (AC-003e)', (_name, ref) => {
    expect(check(GOOD_DEDUCTION, { kind: 'UNLIMITED_DECLARED', policyClauseRef: ref })).toBe('PROFILE_SOURCE_INCOMPLETE');
  });
});

describe('checkGroupValues — 공유 한도 풀 (AC-008m)', () => {
  const poolLimit = (overrides: Record<string, unknown> = {}) => ({
    kind: 'PER_VISIT_PAYOUT',
    amount: 50_000,
    limitBasis: 'PAYOUT',
    ...overrides,
  });

  it('유효한 풀 한도(네 종류와 조항 참조 있는 UNLIMITED_DECLARED)는 통과한다', () => {
    for (const limit of [
      poolLimit(),
      poolLimit({ kind: 'PER_ACCIDENT' }),
      poolLimit({ kind: 'ANNUAL' }),
      { kind: 'COUNT', perUseAmount: 1, limitBasis: 'PAYOUT' },
      { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'TEST_FIXTURE_CLAUSE' },
    ]) {
      expect(check(GOOD_DEDUCTION, GOOD_LIMIT, { limit })).toBeNull();
    }
  });

  it('풀 한도의 값이 없거나 null 이면 멤버 그룹이 PROFILE_VALUE_MISSING', () => {
    expect(check(GOOD_DEDUCTION, GOOD_LIMIT, { limit: null })).toBe('PROFILE_VALUE_MISSING');
    expect(check(GOOD_DEDUCTION, GOOD_LIMIT, { limit: poolLimit({ amount: undefined }) })).toBe('PROFILE_VALUE_MISSING');
  });

  it('풀 한도의 값이 무효이면 PROFILE_VALUE_INVALID', () => {
    for (const [, value] of INVALID_AMOUNTS) {
      expect(check(GOOD_DEDUCTION, GOOD_LIMIT, { limit: poolLimit({ amount: value }) })).toBe('PROFILE_VALUE_INVALID');
    }
  });

  it('풀 한도가 COVERED_COST 이거나 닫힌 목록 밖의 종류이면 PROFILE_FORMULA_UNSUPPORTED', () => {
    expect(check(GOOD_DEDUCTION, GOOD_LIMIT, { limit: poolLimit({ limitBasis: 'COVERED_COST' }) })).toBe('PROFILE_FORMULA_UNSUPPORTED');
    expect(check(GOOD_DEDUCTION, GOOD_LIMIT, { limit: poolLimit({ kind: 'LIFETIME' }) })).toBe('PROFILE_FORMULA_UNSUPPORTED');
  });

  it('조항 참조가 없는 UNLIMITED_DECLARED 풀은 PROFILE_SOURCE_INCOMPLETE', () => {
    expect(check(GOOD_DEDUCTION, GOOD_LIMIT, { limit: { kind: 'UNLIMITED_DECLARED' } })).toBe('PROFILE_SOURCE_INCOMPLETE');
  });

  it('풀의 멤버가 아닌 그룹은 풀의 결함 영향을 받지 않는다', () => {
    const member: CoverageGroupDef = { groupKey: 'TEST_MEMBER', deduction: GOOD_DEDUCTION, limit: GOOD_LIMIT, sharedLimitPoolKey: 'TEST_POOL_X' };
    const outsider: CoverageGroupDef = { groupKey: 'TEST_OUTSIDER', deduction: GOOD_DEDUCTION, limit: GOOD_LIMIT };
    const profile = makeProfile({
      groups: [member, outsider],
      sharedLimitPools: [{ poolKey: 'TEST_POOL_X', limit: loose<LimitRule>(poolLimit({ amount: -1 })) }],
    });
    expect(checkGroupValues(member, profile)).toBe('PROFILE_VALUE_INVALID');
    expect(checkGroupValues(outsider, profile)).toBeNull();
  });

  it('없는 풀을 가리키는 참조는 구조 결함이며 값 검사는 그 풀을 건너뛴다 (구조 검사가 먼저 걸러낸다)', () => {
    const group: CoverageGroupDef = { groupKey: 'TEST_G', deduction: GOOD_DEDUCTION, limit: GOOD_LIMIT, sharedLimitPoolKey: 'TEST_POOL_MISSING' };
    expect(checkGroupValues(group, makeProfile({ groups: [group] }))).toBeNull();
  });
});

describe('checkGroupValues — 코드 종류 우선순위: SOURCE_INCOMPLETE → FORMULA_UNSUPPORTED → VALUE_MISSING → VALUE_INVALID', () => {
  const invalidFixed = { kind: 'FIXED', fixed: -1 };
  const missingFixed = { kind: 'FIXED', fixed: null };
  const unsupportedLimit = { kind: 'PER_VISIT_PAYOUT', amount: 1_000, limitBasis: 'COVERED_COST' };
  const incompleteLimit = { kind: 'UNLIMITED_DECLARED' };
  const poolInvalid = { limit: { kind: 'PER_VISIT_PAYOUT', amount: -1, limitBasis: 'PAYOUT' } };
  const poolUnsupported = { limit: { kind: 'PER_VISIT_PAYOUT', amount: 1_000, limitBasis: 'COVERED_COST' } };

  it('그룹 자신의 값이 무효이고 풀이 지원 밖 공식이면 후자다', () => {
    expect(check(invalidFixed, GOOD_LIMIT, poolUnsupported)).toBe('PROFILE_FORMULA_UNSUPPORTED');
  });

  it('그룹 자신의 값이 없음이고 풀 값이 무효이면 전자다', () => {
    expect(check(missingFixed, GOOD_LIMIT, poolInvalid)).toBe('PROFILE_VALUE_MISSING');
  });

  it('조항 참조 누락이 지원 밖 공식·값 누락·값 무효보다 먼저다', () => {
    expect(check(invalidFixed, incompleteLimit)).toBe('PROFILE_SOURCE_INCOMPLETE');
    expect(check(missingFixed, incompleteLimit, poolUnsupported)).toBe('PROFILE_SOURCE_INCOMPLETE');
  });

  it('지원 밖 공식이 값 누락·값 무효보다 먼저다', () => {
    expect(check(missingFixed, unsupportedLimit)).toBe('PROFILE_FORMULA_UNSUPPORTED');
    expect(check(invalidFixed, unsupportedLimit)).toBe('PROFILE_FORMULA_UNSUPPORTED');
  });

  it('값 누락이 값 무효보다 먼저다', () => {
    expect(check(invalidFixed, { kind: 'PER_VISIT_PAYOUT', limitBasis: 'PAYOUT' })).toBe('PROFILE_VALUE_MISSING');
  });
});

describe('checkGroupValues — 객체가 아닌 규칙과 목록이 아닌 풀', () => {
  it('공제 규칙이나 한도 규칙이 객체가 아니면 지원 밖 공식으로 본다 (값을 추정하지 않는다)', () => {
    expect(check(5)).toBe('PROFILE_FORMULA_UNSUPPORTED');
    expect(check(GOOD_DEDUCTION, 'PER_VISIT_PAYOUT')).toBe('PROFILE_FORMULA_UNSUPPORTED');
  });

  it('프로필의 sharedLimitPools 가 배열이 아니면 풀 검사를 건너뛴다 (구조 검사가 먼저 걸러낸다)', () => {
    const group: CoverageGroupDef = { groupKey: 'TEST_G', deduction: GOOD_DEDUCTION, limit: GOOD_LIMIT, sharedLimitPoolKey: 'TEST_POOL_X' };
    const profile = { ...makeProfile({ groups: [group] }), sharedLimitPools: undefined as unknown as never[] };
    expect(checkGroupValues(group, profile)).toBeNull();
  });
});

describe('checkGroupValues — 입력을 바꾸지 않는다', () => {
  it('그룹과 프로필을 바꾸지 않는다', () => {
    const group: CoverageGroupDef = { groupKey: 'TEST_G', deduction: { kind: 'FIXED', fixed: -1 }, limit: GOOD_LIMIT };
    const profile = makeProfile({ groups: [group] });
    const before = JSON.stringify([group, profile]);
    checkGroupValues(group, profile);
    expect(JSON.stringify([group, profile])).toBe(before);
  });
});
