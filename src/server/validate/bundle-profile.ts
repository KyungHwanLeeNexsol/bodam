import { checkProfileStructure } from '../../engine/profile-structure';
import { isBasisPoints, isWon } from '../../engine/numeric';
import type { StandardAssumptionProfile } from '../../engine/types';
import type { Defect } from '../domain/errors';
import { GENERATION_VALUES, INSURER_TYPES, expectValue, isAbsent, isOneOf, isPlainObject } from './shape';

// 규칙 묶음 게시 검증: 프로필 칸 키 · 구조 · 값 범위 (design.md DD-02 "프로필 구조 검사와 영향 범위", DD-24 "필드별 범위", AC-011h·AC-011i).
//   · 구조: 엔진의 checkProfileStructure 를 그대로 부르고 결함 경로에 묶음 경로를 붙인다 (두 번째 구현 없음).
//   · 값: fixed·amount·perUseAmount·풀 한도 금액은 Won, rate·rateBenefit·rateNonBenefit 은 BasisPoints (엔진의 isWon·isBasisPoints).
// 공식 지원 여부(공제·한도의 종류, limitBasis, 조항 참조)는 게시 거절 사유가 아니다: 계산 때의 보류 사유(PROFILE_FORMULA_UNSUPPORTED·
// PROFILE_SOURCE_INCOMPLETE)다. 그래서 알 수 없는 종류는 조용히 지나가고 그 안의 값은 읽지 않는다.

const isGeneration = isOneOf(GENERATION_VALUES);
const isInsurerType = isOneOf(INSURER_TYPES);
const isRounding = (value: unknown): boolean => value === 'TRUNCATE' || value === 'ROUND_HALF_UP';

const amount = (out: Defect[], value: unknown, path: string): void => void expectValue(out, value, path, isWon);
const rate = (out: Defect[], value: unknown, path: string): void => void expectValue(out, value, path, isBasisPoints);
const rounding = (out: Defect[], value: unknown, path: string): void => void expectValue(out, value, path, isRounding);
/** 한도 기준은 PAYOUT 만 계산식이 있다. 빠졌으면(없음·null) 값 결함이고, 다른 값(COVERED_COST 포함)은 지원 밖이라 결함이 아니다. */
const limitBasis = (out: Defect[], value: unknown, path: string): void => {
  if (isAbsent(value)) {
    out.push({ code: 'VALUE_MISSING', path });
  }
};

// @MX:NOTE: [AUTO] 아래 deduction·limit 검사는 엔진 group-values.ts 의 deductionFindings·limitFindings 의 "값" 판정(PROFILE_VALUE_MISSING·
// PROFILE_VALUE_INVALID)을 그대로 따른다. 게시는 통과했는데 계산은 PROFILE_VALUE_INVALID 인 일이 없어야 하므로 둘이 어긋나면 안 된다.
// 엔진 쪽을 바꾸면 tests/server/validate-bundle-profile.test.ts 의 일치 시험(고정 시드)이 깨진다. 지원 밖 판정은 일부러 따르지 않는다.
function checkDeduction(out: Defect[], rule: unknown, path: string): void {
  if (isAbsent(rule)) {
    out.push({ code: 'VALUE_MISSING', path });
    return;
  }
  if (typeof rule !== 'object') {
    return;
  }
  const fields = rule as Record<string, unknown>;
  switch (fields.kind) {
    case 'FIXED':
      amount(out, fields.fixed, `${path}.fixed`);
      break;
    case 'RATE_WITH_FIXED_FLOOR':
    case 'CAPPED_RATE_WITH_FIXED_FLOOR':
      amount(out, fields.fixed, `${path}.fixed`);
      rate(out, fields.rate, `${path}.rate`);
      rounding(out, fields.rounding, `${path}.rounding`);
      break;
    case 'SPLIT_RATE_WITH_FIXED_FLOOR':
      amount(out, fields.fixed, `${path}.fixed`);
      rate(out, fields.rateBenefit, `${path}.rateBenefit`);
      rate(out, fields.rateNonBenefit, `${path}.rateNonBenefit`);
      rounding(out, fields.rounding, `${path}.rounding`);
      break;
    default:
      break;
  }
}

function checkLimit(out: Defect[], rule: unknown, path: string): void {
  if (isAbsent(rule)) {
    out.push({ code: 'VALUE_MISSING', path });
    return;
  }
  if (typeof rule !== 'object') {
    return;
  }
  const fields = rule as Record<string, unknown>;
  switch (fields.kind) {
    case 'PER_VISIT_PAYOUT':
    case 'PER_ACCIDENT':
    case 'ANNUAL':
      amount(out, fields.amount, `${path}.amount`);
      limitBasis(out, fields.limitBasis, `${path}.limitBasis`);
      break;
    case 'COUNT':
      amount(out, fields.perUseAmount, `${path}.perUseAmount`);
      limitBasis(out, fields.limitBasis, `${path}.limitBasis`);
      break;
    default:
      // UNLIMITED_DECLARED(조항 참조는 계산 때의 몫)와 알 수 없는 종류는 값을 읽지 않는다.
      break;
  }
}

/**
 * 프로필 하나를 본다. 보고 순서: 칸 키(generation → insurerType) → 구조(엔진 순서) → 그룹 값(그룹 순서대로 deduction → limit) → 풀 값(풀 순서대로).
 * 항목 모양이 틀린 그룹·풀은 값을 읽지 않는다(구조 결함이 이미 보고한다). 풀의 값은 멤버 그룹이 없어도 검사한다(AC-011i: 풀의 금액이
 * DD-24 범위 밖인 경우도 그룹 값과 같이 거절). 구조가 올바른지(ok)를 돌려주어 묶음 교차 검사가 믿을 수 있는 프로필만 쓰게 한다.
 */
export function checkProfile(out: Defect[], profile: StandardAssumptionProfile, path: string): { structureOk: boolean } {
  expectValue(out, profile.generation, `${path}.generation`, isGeneration);
  expectValue(out, profile.insurerType, `${path}.insurerType`, isInsurerType);

  const structure = checkProfileStructure(profile);
  if (!structure.ok) {
    for (const defect of structure.defects) {
      out.push({ code: defect.code, path: `${path}.${defect.path}` });
    }
  }

  const groups: unknown = profile.groups;
  if (Array.isArray(groups)) {
    for (let index = 0; index < groups.length; index += 1) {
      const group: unknown = groups[index];
      if (isPlainObject(group)) {
        checkDeduction(out, group.deduction, `${path}.groups[${index}].deduction`);
        checkLimit(out, group.limit, `${path}.groups[${index}].limit`);
      }
    }
  }
  const pools: unknown = profile.sharedLimitPools;
  if (Array.isArray(pools)) {
    for (let index = 0; index < pools.length; index += 1) {
      const pool: unknown = pools[index];
      if (isPlainObject(pool)) {
        checkLimit(out, pool.limit, `${path}.sharedLimitPools[${index}].limit`);
      }
    }
  }
  return { structureOk: structure.ok };
}
