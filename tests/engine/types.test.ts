import { describe, expect, it } from 'vitest';
import {
  ASSUMPTION_CODES,
  ENGINE_REJECTION_CODES,
  GENERATIONS,
  HOLD_REASON_CODES,
} from '../../src/engine/types';
import type {
  CoverageGroupDef,
  EstimateInput,
  EstimateResult,
  GroupResult,
  LineResult,
} from '../../src/engine/types';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.
// 이 파일은 형식 수준 시험이다. `satisfies Record<keyof X, true>` 는 키 집합이 형식과 정확히 같아야 컴파일되므로
// 형식에 필드가 더해지거나 빠지면 `npx tsc --noEmit` 이 실패한다.

describe('열거값 — design.md DD-03', () => {
  it('세대 열거는 다섯 값이다', () => {
    expect([...GENERATIONS]).toEqual(['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4']);
  });

  it('보류 사유 코드는 DD-03 표의 21개이며 서로 다르다', () => {
    expect([...HOLD_REASON_CODES]).toEqual([
      'CLINIC_RULE_SCOPE_ABSENT',
      'RULE_BUNDLE_SUSPENDED',
      'PROFILE_ABSENT',
      'PROFILE_DEMO',
      'PROFILE_DRAFT',
      'PROFILE_UNAPPROVED',
      'PROFILE_UNDER_REREVIEW',
      'PROFILE_INVALID',
      'PROFILE_SOURCE_INCOMPLETE',
      'PROFILE_FORMULA_UNSUPPORTED',
      'PROFILE_VALUE_MISSING',
      'PROFILE_VALUE_INVALID',
      'CALC_RANGE_EXCEEDED',
      'LINE_ORIGIN_NOT_ACCEPTED',
      'CLASSIFICATION_NEEDS_REVIEW',
      'MAPPING_ABSENT',
      'MAPPING_UNREVIEWED',
      'MAPPING_REJECTED',
      'MAPPING_UNDER_REREVIEW',
      'MAPPING_INVALID',
      'MAPPING_GROUP_NOT_IN_PROFILE',
    ]);
    expect(new Set(HOLD_REASON_CODES).size).toBe(21);
  });

  it('가정 코드는 DD-03 표의 다섯 개이며 표의 행 순서다', () => {
    expect([...ASSUMPTION_CODES]).toEqual([
      'STANDARD_PROFILE_APPLIED',
      'ALL_COVERED_AND_LIMIT_REMAINS',
      'REMAINING_COVERED_AND_LIMIT_REMAINS',
      'REMAINING_LIMIT_ASSUMED',
      'PERSONAL_CONTRACT_NOT_CONFIRMED',
    ]);
  });

  it('엔진 입력 거절 코드는 판정 순서대로 넷이며 보류 코드가 아니다', () => {
    expect([...ENGINE_REJECTION_CODES]).toEqual([
      'UNSUPPORTED_GENERATION',
      'NO_TREATMENT_SELECTED',
      'INPUT_INTEGRITY_VIOLATION',
      'INVALID_NUMERIC_INPUT',
    ]);
    for (const code of ENGINE_REJECTION_CODES) {
      expect((HOLD_REASON_CODES as readonly string[]).includes(code)).toBe(false);
    }
  });
});

describe('형식 수준: estimate() 입력에 치료 원인 인자가 없다 (AC-006d 형식 부분, 증거만)', () => {
  const estimateInputKeys = {
    generation: true,
    insurerType: true,
    treatmentIds: true,
    lines: true,
    baseFeeLines: true,
    bundle: true,
    at: true,
    acceptedOrigins: true,
  } satisfies Record<keyof EstimateInput, true>;

  it('입력 키 집합에 cause 가 없고 형식 키 집합과 같다', () => {
    expect(Object.keys(estimateInputKeys).sort()).toEqual(
      ['acceptedOrigins', 'at', 'baseFeeLines', 'bundle', 'generation', 'insurerType', 'lines', 'treatmentIds'],
    );
    expect(Object.keys(estimateInputKeys)).not.toContain('cause');
  });

  it('cause 필드를 넣으면 컴파일 오류다 (tsc 가 확인하는 부분)', () => {
    // @ts-expect-error EstimateInput 에는 cause 가 없으므로 이 줄은 컴파일 오류여야 한다.
    const withCause: EstimateInput = { ...({} as EstimateInput), cause: 'UNKNOWN' };
    expect(withCause).toBeDefined();
  });
});

describe('형식 수준: 줄 단위 지급액 필드가 없다 (DD-02/DD-03 SPEC 결정)', () => {
  const lineResultKeys = {
    treatmentId: true,
    displayName: true,
    benefitType: true,
    patientAmount: true,
    isBaseFee: true,
    origin: true,
    state: true,
    groupKey: true,
    holdReason: true,
    exclusionReason: true,
  } satisfies Record<keyof LineResult, true>;

  it('LineResult 의 금액 필드는 patientAmount 하나뿐이다', () => {
    const keys = Object.keys(lineResultKeys);
    expect(keys).toContain('patientAmount');
    expect(keys.filter((key) => /payout|insurance|deduct|payment/i.test(key))).toEqual([]);
  });

  const groupResultKeys = {
    groupKey: true,
    state: true,
    G: true,
    N: true,
    E: true,
    D: true,
    D_applied: true,
    L: true,
    P: true,
    P_pooled: true,
    holdReason: true,
    sharedLimitPoolKey: true,
    trace: true,
  } satisfies Record<keyof GroupResult, true>;

  it('GroupResult 는 공유 한도 적용 전 P 와 적용 후 P_pooled 를 모두 가진다', () => {
    const keys = Object.keys(groupResultKeys);
    expect(keys).toContain('P');
    expect(keys).toContain('P_pooled');
  });

  const coverageGroupDefKeys = {
    groupKey: true,
    deduction: true,
    limit: true,
    sharedLimitPoolKey: true,
  } satisfies Record<keyof CoverageGroupDef, true>;

  it('CoverageGroupDef 의 키 집합은 groupKey·deduction·limit·sharedLimitPoolKey 뿐이며 coverage 와 exclusionReason 이 없다 (AC-008j 형식 부분, 증거만)', () => {
    const keys = Object.keys(coverageGroupDefKeys);
    expect(keys.sort()).toEqual(['deduction', 'groupKey', 'limit', 'sharedLimitPoolKey']);
    expect(keys).not.toContain('coverage');
    expect(keys).not.toContain('exclusionReason');
  });

  it('제외 항목의 payout 은 리터럴 상수 0 이다 (계산값이 아님)', () => {
    const zero: EstimateResult['excludedItems'][number]['payout'] = 0;
    // @ts-expect-error payout 은 리터럴 0 이므로 1 은 컴파일 오류여야 한다.
    const one: EstimateResult['excludedItems'][number]['payout'] = 1;
    expect(zero).toBe(0);
    expect(one).toBe(1);
  });
});
