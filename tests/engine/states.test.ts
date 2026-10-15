import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import type { EstimateInput, EstimateResult, PublishedLine, StandardAssumptionProfile } from '../../src/engine/types';
import { makeMapping } from '../fixtures/engine/mappings.fixture';
import { makeProfile, testDigest } from '../fixtures/engine/profiles.fixture';
import {
  CASE_A,
  CASE_D,
  CASE_D_ASSIGN,
  CASE_E,
  G_BENEFIT,
  G_NON_BENEFIT,
  G_ONE,
  UNLIMITED,
  caseInput,
  group,
  runEstimate,
} from '../fixtures/engine/cases.fixture';
import {
  T_BASE,
  T_INJECT,
  T_PHYSIO,
  T_ULTRA,
  T_XRAY,
  bundleWith,
  exampleBaseFeeLine,
  exampleLines,
  makeBundle,
  makeInput,
  makeLine,
} from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다. AC-004 결과 상태와 0원의 의미, 그리고 AC-008 보류 행렬의 결과 수준 부분.

const ALL_IDS = [T_XRAY, T_ULTRA, T_PHYSIO, T_INJECT];

/** 결과 객체 안의 모든 숫자가 안전 정수이고 NaN·Infinity 가 없는지 본다 (AC-005a 와 같은 검사). */
function expectOnlySafeIntegers(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isSafeInteger(value)).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach(expectOnlySafeIntegers);
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(expectOnlySafeIntegers);
  }
}

function expectHoldNoPayout(result: EstimateResult): void {
  expect(result.state).toBe('ON_HOLD');
  expect(result.amounts.expectedInsurancePayout).toBeNull();
  expect(result.amounts.expectedOutOfPocketAfterPayout).toBeNull();
  expect(Number.isSafeInteger(result.amounts.hospitalPayment)).toBe(true);
  expect(result.assumptions).toContain('PERSONAL_CONTRACT_NOT_CONFIRMED');
  expect(result.assumptions).not.toContain('STANDARD_PROFILE_APPLIED');
  expectOnlySafeIntegers(result);
}

describe('AC-004a 정상 계산 결과가 0원이면 0원과 계산 근거가 함께 나온다', () => {
  it('물리치료(4,000)만 + FIXED 10,000: 보험금 0, 계산 근거에 공제 단계가 있다', () => {
    const result = runEstimate(caseInput({ groups: CASE_A, lines: [makeLine(T_PHYSIO, 4_000)] }));
    expect(result.amounts.expectedInsurancePayout).toBe(0);
    expect(result.basis.steps).toHaveLength(1);
    expect(result.basis.steps[0]).toMatchObject({ D: 10_000, D_applied: 4_000, P: 0 });
  });
});

describe('AC-004b 모든 줄이 확인된 제외', () => {
  it('전체 ESTIMATED_WITH_EXCLUSIONS, 보험금 0, 수령 후 부담 = 병원 결제액, 각 제외 항목에 상수 payout 0 과 사유', () => {
    const result = runEstimate(caseInput({ groups: CASE_E, excluded: ALL_IDS }));
    expect(result.state).toBe('ESTIMATED_WITH_EXCLUSIONS');
    expect(result.amounts).toMatchObject({ hospitalPayment: 124_000, expectedInsurancePayout: 0, expectedOutOfPocketAfterPayout: 124_000 });
    expect(result.excludedItems).toHaveLength(4);
    expect(result.excludedItems.every((item) => item.payout === 0 && item.reason !== '')).toBe(true);
    expect(result.excludedItems.map((item) => item.treatmentId)).toEqual([...ALL_IDS].sort());
    expect(result.groups).toEqual([]);
    expect(result.assumptions).toEqual(['STANDARD_PROFILE_APPLIED', 'PERSONAL_CONTRACT_NOT_CONFIRMED']);
  });
});

describe('AC-004c 보류 줄이 있는 입력', () => {
  it('예상 보험금·수령 후 부담이 null 이고 병원 결제액은 124,000 이며 어디에도 0 이 들어가지 않는다', () => {
    const result = runEstimate(caseInput({ groups: CASE_E, mappings: exampleLines().filter((line) => line.treatmentId !== T_INJECT).map((line) => makeMapping(line.treatmentId, { groupKey: G_ONE })) }));
    expectHoldNoPayout(result);
    expect(result.amounts.hospitalPayment).toBe(124_000);
    const injectLine = result.lines.find((line) => line.treatmentId === T_INJECT)!;
    expect(injectLine).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_ABSENT' });
    expect('groupKey' in injectLine).toBe(false);
    expect(result.holdReasons).toEqual([{ treatmentId: T_INJECT, code: 'MAPPING_ABSENT' }]);
    // 어디에도 0 이 없다: 모든 금액 값은 null 이거나 0 이 아닌 값이다(보류 그룹의 D·P 는 null).
    expect(result.amounts.expectedInsurancePayout).not.toBe(0);
  });
});

describe('AC-004d 사례 D 시험 자료에서 신장분사치료 매핑만 없음', () => {
  it('신장분사치료 줄은 MAPPING_ABSENT 로 ON_HOLD 이고 어느 그룹에도 없으며, 급여 그룹 P = 4,000 과 일반 비급여 그룹 P = 40,000 이 참고 그룹이다', () => {
    const mappings = [T_XRAY, T_ULTRA, T_PHYSIO].map((id) => makeMapping(id, { groupKey: CASE_D_ASSIGN[id] as string }));
    const result = runEstimate(caseInput({ groups: CASE_D, mappings }));
    expect(result.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_ABSENT' });
    const benefit = result.groups.find((entry) => entry.groupKey === G_BENEFIT)!;
    const nonBenefit = result.groups.find((entry) => entry.groupKey === G_NON_BENEFIT)!;
    expect(benefit).toMatchObject({ E: 14_000, P: 4_000 });
    expect(nonBenefit).toMatchObject({ E: 70_000, D: 30_000, P: 40_000 }); // 보류 줄의 40,000 은 어느 그룹 E 에도 없다
    expect(result.referenceGroups).toEqual([
      { groupKey: G_BENEFIT, P: 4_000, isReference: true },
      { groupKey: G_NON_BENEFIT, P: 40_000, isReference: true },
    ]);
    expectHoldNoPayout(result);
  });
});

describe('AC-004e 가정 코드', () => {
  it('모든 줄 ESTIMATED 일 때만 ALL_COVERED_AND_LIMIT_REMAINS, 제외가 섞이면 REMAINING_COVERED_AND_LIMIT_REMAINS', () => {
    const all = runEstimate(caseInput({ groups: CASE_E }));
    expect(all.assumptions).toEqual(['STANDARD_PROFILE_APPLIED', 'ALL_COVERED_AND_LIMIT_REMAINS', 'PERSONAL_CONTRACT_NOT_CONFIRMED']);
    const mixed = runEstimate(caseInput({ groups: CASE_E, excluded: [T_INJECT] }));
    expect(mixed.assumptions).toEqual(['STANDARD_PROFILE_APPLIED', 'REMAINING_COVERED_AND_LIMIT_REMAINS', 'PERSONAL_CONTRACT_NOT_CONFIRMED']);
  });

  it('ON_HOLD 를 포함한 모든 결과에 PERSONAL_CONTRACT_NOT_CONFIRMED 가 있고 ON_HOLD 에는 STANDARD_PROFILE_APPLIED 가 없다', () => {
    const held = runEstimate(caseInput({ groups: CASE_E, mappings: [] }));
    expect(held.state).toBe('ON_HOLD');
    expect(held.assumptions).toEqual(['PERSONAL_CONTRACT_NOT_CONFIRMED']);
  });
});

describe('AC-004f 공통 기본비용 (plan.md §E.9 #8 정정 문구)', () => {
  const baseFee: PublishedLine = exampleBaseFeeLine();

  it('(1) 공통 기본비용이 없으면 NOT_REGISTERED 이고 병원 결제액에 기본비용이 없다', () => {
    const result = runEstimate(caseInput({ groups: CASE_A }));
    expect(result.amounts).toMatchObject({ baseFeeIncluded: 'NOT_REGISTERED', hospitalPayment: 124_000 });
  });

  it('(2) 기본비용이 등록되고 사용 가능한 매핑이 있으면 INCLUDED 이고 금액이 더해지며 그 줄도 계산된다', () => {
    const result = runEstimate(caseInput({ groups: CASE_A, baseFeeLines: [baseFee] }));
    expect(result.amounts).toMatchObject({ baseFeeIncluded: 'INCLUDED', hospitalPayment: 129_000, expectedInsurancePayout: 119_000, expectedOutOfPocketAfterPayout: 10_000 });
    expect(result.groups[0]).toMatchObject({ E: 129_000, P: 119_000 });
    expect(result.lines.find((line) => line.treatmentId === T_BASE)).toMatchObject({ isBaseFee: true, state: 'ESTIMATED' });
  });

  it('(3) 등록되었으나 매핑이 없으면 INCLUDED 이고 병원 결제액에는 더해지며 그 줄은 MAPPING_ABSENT 로 보류되어 전체가 ON_HOLD 다', () => {
    const mappings = exampleLines().map((line) => makeMapping(line.treatmentId, { groupKey: G_ONE }));
    const result = runEstimate(caseInput({ groups: CASE_A, baseFeeLines: [baseFee], mappings }));
    expect(result.amounts).toMatchObject({ baseFeeIncluded: 'INCLUDED', hospitalPayment: 129_000 });
    expect(result.lines.find((line) => line.treatmentId === T_BASE)).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_ABSENT' });
    expectHoldNoPayout(result);
  });

  it('기본비용 줄이 보류되어도(매핑 없음·사용 불가 매핑·출처 허용 밖) 금액은 병원 결제액에서 빠지지 않는다 (보장 여부와 무관)', () => {
    const base = exampleLines().map((line) => makeMapping(line.treatmentId, { groupKey: G_ONE }));
    const variants = [
      base,
      [...base, makeMapping(T_BASE, { state: 'DRAFT' })],
      [...base, makeMapping(T_BASE, { approvedFingerprint: 'TEST_FP_OLD' })],
    ];
    for (const mappings of variants) {
      const result = runEstimate(caseInput({ groups: CASE_A, baseFeeLines: [baseFee], mappings }));
      expect(result.amounts.hospitalPayment).toBe(129_000);
      expect(result.amounts.baseFeeIncluded).toBe('INCLUDED');
      expect(result.state).toBe('ON_HOLD');
    }
  });

  it('확인된 제외(EXCLUDED) 매핑의 기본비용은 병원 결제액에는 들어가고 보험금 계산에서만 빠진다', () => {
    const result = runEstimate(caseInput({ groups: CASE_A, baseFeeLines: [baseFee], excluded: [T_BASE] }));
    expect(result.amounts).toMatchObject({ hospitalPayment: 129_000, expectedInsurancePayout: 114_000 });
    expect(result.excludedItems).toEqual([{ treatmentId: T_BASE, amount: 5_000, reason: 'TEST_FIXTURE_EXCLUSION_REASON', payout: 0 }]);
    expect(result.groups[0]).toMatchObject({ E: 124_000 });
  });
});

describe('AC-004g 계산 근거', () => {
  it('사용한 규칙 묶음 버전, 프로필 id·버전·출처·약관 출처 참조, 그룹별 E·명목 D·실제 D·L·P·P_pooled 단계가 있다', () => {
    const result = runEstimate(caseInput({ groups: CASE_D, assign: CASE_D_ASSIGN }));
    expect(result.basis.ruleBundleId).toBe('TEST_BUNDLE_1');
    expect(result.basis.profile).toMatchObject({ id: 'TEST_PROFILE_1', version: 'v1', origin: 'TEST_FIXTURE' });
    expect(result.basis.profile?.policySources).toHaveLength(1);
    expect(result.basis.steps).toEqual([
      { groupKey: G_BENEFIT, E: 14_000, D: 10_000, D_applied: 10_000, L: 'UNLIMITED', P: 4_000, P_pooled: 4_000 },
      { groupKey: G_NON_BENEFIT, E: 110_000, D: 33_000, D_applied: 33_000, L: 'UNLIMITED', P: 77_000, P_pooled: 77_000 },
    ]);
  });
});

describe('AC-008a 결과 수준: 묶음·프로필 단계 보류는 모든 줄 ON_HOLD, 보험금·수령 후 부담 null', () => {
  const profileCases: Array<[string, Partial<StandardAssumptionProfile>]> = [
    ['DRAFT', { state: 'DRAFT' }],
    ['REVIEW_REQUESTED', { state: 'REVIEW_REQUESTED' }],
    ['UNDER_REREVIEW', { state: 'UNDER_REREVIEW' }],
    ['SUSPENDED', { state: 'SUSPENDED' }],
    ['유효 기간 밖', { validity: { from: '2025-01-01', to: '2025-12-31' } }],
    ['약관 출처 없음', { policySources: [] }],
    ['승인자 없음', { approver: null }],
    ['내용 해시 불일치', { contentHash: 'TEST_DIGEST_00000000' }],
    ['구조 결함(groupOrder 빠진 키)', { groupOrder: [] }],
  ];

  it.each(profileCases)('프로필 %s', (_name, overrides) => {
    const result = runEstimate(makeInput({ bundle: bundleWith(makeProfile(overrides)) }));
    expectHoldNoPayout(result);
    expect(result.amounts.hospitalPayment).toBe(124_000);
    expect(result.groups).toEqual([]);
    expect(result.referenceGroups).toEqual([]);
    expect(result.lines.every((line) => line.state === 'ON_HOLD')).toBe(true);
    expect(result.basis.profile).toBeNull();
    expect(result.basis.steps).toEqual([]);
    expect(result.holdReasons).toHaveLength(4);
  });

  it('기록이 없는 칸(PROFILE_ABSENT)도 같다', () => {
    const result = runEstimate(makeInput({ bundle: makeBundle({ profiles: [] }) }));
    expectHoldNoPayout(result);
    expect(result.holdReasons.every((entry) => entry.code === 'PROFILE_ABSENT')).toBe(true);
  });
});

describe('AC-008f/g 결과 수준: 규칙 사용 범위 없음·묶음 중지', () => {
  it('bundle = null 이면 모든 줄 CLINIC_RULE_SCOPE_ABSENT, 병원 결제액은 숫자, 보험금 null', () => {
    const result = runEstimate(makeInput({ bundle: null }));
    expectHoldNoPayout(result);
    expect(result.holdReasons.every((entry) => entry.code === 'CLINIC_RULE_SCOPE_ABSENT')).toBe(true);
    expect(result.basis.ruleBundleId).toBeNull();
  });

  it('SUSPENDED 묶음은 모든 줄 RULE_BUNDLE_SUSPENDED, 병원 결제액은 숫자, 보험금·수령 후 부담 null 이다 (서류 null 은 M2)', () => {
    const result = runEstimate(makeInput({ bundle: makeBundle({ status: 'SUSPENDED' }) }));
    expectHoldNoPayout(result);
    expect(result.holdReasons.every((entry) => entry.code === 'RULE_BUNDLE_SUSPENDED')).toBe(true);
    expect(result.basis.ruleBundleId).toBe('TEST_BUNDLE_1');
  });

  it('내용이 같은 ACTIVE 묶음은 정상 계산된다', () => {
    const active = runEstimate(makeInput({ bundle: makeBundle() }));
    expect(active.state).not.toBe('ON_HOLD');
    expect(active.amounts.expectedInsurancePayout).not.toBeNull();
  });
});

describe('AC-008e 결과 수준: 줄 단위 사유와 그룹 단위 사유가 겹칠 때', () => {
  it('매핑 사유가 있는 줄은 매핑 코드를, 사용 가능한 줄은 그룹 단위 PROFILE_SOURCE_INCOMPLETE 를 받는다', () => {
    const noClause = group(G_ONE, { kind: 'FIXED', fixed: 1_000 }, { kind: 'UNLIMITED_DECLARED' } as never);
    const mappings = exampleLines().map((line) =>
      makeMapping(line.treatmentId, { groupKey: G_ONE, ...(line.treatmentId === T_INJECT ? { state: 'DRAFT' as const } : {}) }),
    );
    const result = runEstimate(caseInput({ groups: [noClause], mappings }));
    expect(result.holdReasons).toEqual([
      { treatmentId: T_INJECT, code: 'MAPPING_UNREVIEWED' },
      { treatmentId: T_PHYSIO, code: 'PROFILE_SOURCE_INCOMPLETE' },
      { treatmentId: T_ULTRA, code: 'PROFILE_SOURCE_INCOMPLETE' },
      { treatmentId: T_XRAY, code: 'PROFILE_SOURCE_INCOMPLETE' },
    ]);
    expect(result.groups[0]).toMatchObject({ state: 'ON_HOLD', holdReason: 'PROFILE_SOURCE_INCOMPLETE', E: 84_000 });
    expectHoldNoPayout(result);
  });

  it('그룹 단위 사유의 우선순위는 계산 범위 초과보다 값 무효가 먼저다 (값 검사가 산술보다 앞선다)', () => {
    const invalid = group(G_ONE, { kind: 'RATE_WITH_FIXED_FLOOR', fixed: -1, rate: 10000, rounding: 'TRUNCATE' }, UNLIMITED);
    const result = runEstimate(caseInput({ groups: [invalid], lines: [makeLine(T_XRAY, 10_000)] }));
    expect(result.groups[0]).toMatchObject({ holdReason: 'PROFILE_VALUE_INVALID' });
  });

  it('한 그룹의 보류가 다른 그룹의 계산을 막지 않는다', () => {
    const broken = group('TEST_GROUP_BROKEN', { kind: 'FIXED', fixed: -1 }, UNLIMITED);
    const result = runEstimate(
      caseInput({ groups: [broken, ...CASE_A], assign: { [T_XRAY]: 'TEST_GROUP_BROKEN', [T_ULTRA]: G_ONE, [T_PHYSIO]: G_ONE, [T_INJECT]: G_ONE } }),
    );
    expect(result.groups.find((entry) => entry.groupKey === G_ONE)).toMatchObject({ state: 'ESTIMATED', E: 114_000, P: 104_000 });
    expect(result.referenceGroups).toEqual([{ groupKey: G_ONE, P: 104_000, isReference: true }]);
  });
});

describe('거절은 0원 결과를 만들지 않는다 (AC-006a/b/h, 결과 수준)', () => {
  const run = (overrides: Partial<EstimateInput>) => estimate(makeInput(overrides), { digest: testDigest });

  it.each([
    ['세대 열거 밖', { generation: 'GEN5_C5' as unknown as 'GEN1_AS' }, 'UNSUPPORTED_GENERATION'],
    ['치료 0개', { treatmentIds: [] }, 'NO_TREATMENT_SELECTED'],
    ['치료 줄 0개', { lines: [] }, 'NO_TREATMENT_SELECTED'],
    ['줄 금액 무효', { lines: [makeLine(T_XRAY, -1)], treatmentIds: [T_XRAY] }, 'INVALID_NUMERIC_INPUT'],
    ['줄 금액이 MAX_AMOUNT_WON 초과', { lines: [makeLine(T_XRAY, 1_000_000_001)], treatmentIds: [T_XRAY] }, 'INVALID_NUMERIC_INPUT'],
  ])('%s -> %s 거절, result 필드 자체가 없다', (_name, overrides, code) => {
    const outcome = run(overrides as Partial<EstimateInput>);
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ rejection: { code } });
    expect('result' in outcome).toBe(false);
    expect(JSON.stringify(outcome)).not.toMatch(/expectedInsurancePayout|hospitalPayment/);
  });
});

describe('결과의 모든 숫자는 안전 정수다', () => {
  it('정상·제외·보류 결과 모두 NaN·Infinity·비정수가 없다', () => {
    const results = [
      runEstimate(caseInput({ groups: CASE_A })),
      runEstimate(caseInput({ groups: CASE_E, excluded: [T_INJECT] })),
      runEstimate(caseInput({ groups: CASE_D, assign: CASE_D_ASSIGN, mappings: [] })),
      runEstimate(makeInput({ bundle: null })),
    ];
    results.forEach(expectOnlySafeIntegers);
  });

  it('보류 결과의 직렬화에 지급액 숫자가 없다 (보험금·수령 후 부담 null, 보류 그룹의 D·P null)', () => {
    const result = runEstimate(caseInput({ groups: CASE_E, mappings: [] }));
    expect(JSON.parse(JSON.stringify(result.amounts))).toEqual({
      hospitalPayment: 124_000,
      baseFeeIncluded: 'NOT_REGISTERED',
      expectedInsurancePayout: null,
      expectedOutOfPocketAfterPayout: null,
    });
  });
});
