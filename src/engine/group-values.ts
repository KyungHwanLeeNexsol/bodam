import { isBasisPoints, isWon } from './numeric';
import type { CoverageGroupDef, HoldReasonCode, StandardAssumptionProfile } from './types';

// 그룹 값 검사 (design.md DD-02 "프로필 구조 검사와 영향 범위", DD-03 보류 사유 코드, DD-24).
// 저장 자료(프로필의 그룹 규칙과 그 그룹이 속한 공유 한도 풀)만으로 정해지는 검사다.
// 환자가 고른 금액의 크기에 달린 CALC_RANGE_EXCEEDED 는 여기서 보지 않는다(산술 단계의 몫, DD-23).
// estimate() 와 운영 준비 상태 계산(M3)이 같은 함수를 부른다. 값을 고치거나 0·기본값으로 대신하지 않는다.

export type GroupValueHoldCode = Extract<
  HoldReasonCode,
  | 'PROFILE_SOURCE_INCOMPLETE'
  | 'PROFILE_FORMULA_UNSUPPORTED'
  | 'PROFILE_VALUE_MISSING'
  | 'PROFILE_VALUE_INVALID'
>;

/** 한 그룹에 코드가 여럿 해당하면 코드 종류의 우선순위가 먼저다 (DD-02). */
const CODE_PRIORITY: readonly GroupValueHoldCode[] = [
  'PROFILE_SOURCE_INCOMPLETE',
  'PROFILE_FORMULA_UNSUPPORTED',
  'PROFILE_VALUE_MISSING',
  'PROFILE_VALUE_INVALID',
];

type Finding = GroupValueHoldCode | null;

function isAbsent(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

/** 금액: 없음·null 은 MISSING, Won 이 아니면(음수·소수·NaN·Infinity·문자열·MAX_AMOUNT_WON 초과) INVALID. */
function amountFinding(value: unknown): Finding {
  if (isAbsent(value)) return 'PROFILE_VALUE_MISSING';
  return isWon(value) ? null : 'PROFILE_VALUE_INVALID';
}

function rateFinding(value: unknown): Finding {
  if (isAbsent(value)) return 'PROFILE_VALUE_MISSING';
  return isBasisPoints(value) ? null : 'PROFILE_VALUE_INVALID';
}

/** 원 단위 처리: 기본값이 없으므로 빠지면 MISSING. 두 값 밖의 값은 INVALID. */
function roundingFinding(value: unknown): Finding {
  if (isAbsent(value)) return 'PROFILE_VALUE_MISSING';
  return value === 'TRUNCATE' || value === 'ROUND_HALF_UP' ? null : 'PROFILE_VALUE_INVALID';
}

/** 한도 기준: PAYOUT 만 지원한다. COVERED_COST 와 그 밖의 값은 계산식이 없으므로 지원 밖이다. */
function limitBasisFinding(value: unknown): Finding {
  if (isAbsent(value)) return 'PROFILE_VALUE_MISSING';
  return value === 'PAYOUT' ? null : 'PROFILE_FORMULA_UNSUPPORTED';
}

function deductionFindings(rule: unknown): Finding[] {
  if (isAbsent(rule)) return ['PROFILE_VALUE_MISSING'];
  if (typeof rule !== 'object') return ['PROFILE_FORMULA_UNSUPPORTED'];
  const fields = rule as Record<string, unknown>;
  switch (fields.kind) {
    case 'FIXED':
      return [amountFinding(fields.fixed)];
    case 'RATE_WITH_FIXED_FLOOR':
    case 'CAPPED_RATE_WITH_FIXED_FLOOR':
      return [amountFinding(fields.fixed), rateFinding(fields.rate), roundingFinding(fields.rounding)];
    case 'SPLIT_RATE_WITH_FIXED_FLOOR':
      return [
        amountFinding(fields.fixed),
        rateFinding(fields.rateBenefit),
        rateFinding(fields.rateNonBenefit),
        roundingFinding(fields.rounding),
      ];
    default:
      return ['PROFILE_FORMULA_UNSUPPORTED'];
  }
}

function limitFindings(rule: unknown): Finding[] {
  if (isAbsent(rule)) return ['PROFILE_VALUE_MISSING'];
  if (typeof rule !== 'object') return ['PROFILE_FORMULA_UNSUPPORTED'];
  const fields = rule as Record<string, unknown>;
  switch (fields.kind) {
    case 'UNLIMITED_DECLARED': {
      // 한도 없음은 약관 조항 참조가 있을 때만 허용한다. 조항 없이 허용하면 한도가 없다고 단정할 근거가 사라진다.
      const ref = fields.policyClauseRef;
      return [typeof ref === 'string' && ref.trim() !== '' ? null : 'PROFILE_SOURCE_INCOMPLETE'];
    }
    case 'PER_VISIT_PAYOUT':
    case 'PER_ACCIDENT':
    case 'ANNUAL':
      return [amountFinding(fields.amount), limitBasisFinding(fields.limitBasis)];
    case 'COUNT':
      return [amountFinding(fields.perUseAmount), limitBasisFinding(fields.limitBasis)];
    default:
      return ['PROFILE_FORMULA_UNSUPPORTED'];
  }
}

// @MX:ANCHOR: [AUTO] 그룹 값 검사. estimate() 의 그룹 단계와 운영 준비 상태 계산(M3, 표 P)이 같은 함수를 부른다.
// @MX:REASON: 준비 상태와 계산이 값 검사를 따로 구현하면 "준비 완료인데 계산은 보류"가 생긴다(DD-23 규칙 0).
/**
 * 그룹 자신의 deduction·limit 과 그 그룹이 속한 공유 한도 풀의 limit 을 검사한다.
 * 해당하는 코드가 여럿이면 우선순위(조항 누락 → 지원 밖 → 값 없음 → 값 무효)가 높은 코드 하나를 돌려준다.
 * 풀의 결함은 그 풀의 멤버 그룹에만 영향을 준다. 없는 풀을 가리키는 참조는 구조 결함이므로 구조 검사가 걸러내며 여기서는 건너뛴다.
 */
export function checkGroupValues(
  group: CoverageGroupDef,
  profile: StandardAssumptionProfile,
): GroupValueHoldCode | null {
  const findings: Finding[] = [...deductionFindings(group.deduction), ...limitFindings(group.limit)];

  const poolKey: unknown = group.sharedLimitPoolKey;
  const pools = Array.isArray(profile.sharedLimitPools) ? profile.sharedLimitPools : [];
  const pool = poolKey === undefined ? undefined : pools.find((candidate) => candidate.poolKey === poolKey);
  if (pool !== undefined) {
    findings.push(...limitFindings(pool.limit));
  }

  return CODE_PRIORITY.find((code) => findings.includes(code)) ?? null;
}
