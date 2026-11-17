import { describe, expect, it } from 'vitest';
import { isBundleUsable } from '../../src/engine/usability';
import { estimateFront } from '../../src/engine/estimate';
import type { EstimateFront } from '../../src/engine/estimate';
import type {
  EstimateInput,
  HoldReasonCode,
  LifecycleState,
  PolicySourceRef,
  RuleBundleSnapshot,
  StandardAssumptionProfile,
  TreatmentCoverageMapping,
} from '../../src/engine/types';
import { makeExcludedMapping, makeMapping, unusableMappingVariants } from '../fixtures/engine/mappings.fixture';
import { makeProfile, testDigest, testGroups, testPolicySource } from '../fixtures/engine/profiles.fixture';
import {
  T_INJECT,
  T_PHYSIO,
  T_ULTRA,
  T_XRAY,
  bundleWith,
  exampleBaseFeeLine,
  exampleLines,
  exampleMappings,
  makeBundle,
  makeInput,
  makeLine,
} from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이나 승인 기록이 아니다.
// 이 파일은 estimate() 앞단(입력 검증 → 묶음 선행 판정 → 프로필 → 줄 판정)의 보류 행렬을 시험한다.
// 산술(그룹 값 검사, 공제, 한도)은 M1.3 이며 여기서는 다루지 않는다.

function front(input: EstimateInput): EstimateFront {
  const result = estimateFront(input, { digest: testDigest });
  if (!result.ok) {
    throw new Error(`거절되었다: ${result.rejection.code}`);
  }
  return result.front;
}

const ALL_IDS_SORTED = [T_INJECT, T_PHYSIO, T_ULTRA, T_XRAY];

function expectAllOnHold(result: EstimateFront, code: HoldReasonCode): void {
  expect(result.blocked).toBe(code);
  expect(result.profile).toBeNull();
  expect(result.hasHold).toBe(true);
  expect(result.lines.map((decision) => decision.line.treatmentId)).toEqual(ALL_IDS_SORTED);
  for (const decision of result.lines) {
    expect(decision.state).toBe('ON_HOLD');
    expect(decision.holdReason).toBe(code);
    expect('groupKey' in decision).toBe(false);
  }
  // 보류여도 예상 병원 결제액은 숫자다.
  expect(result.validated.hospitalPayment).toBe(124_000);
}

function expectOnlyOneOnHold(result: EstimateFront, id: string, code: HoldReasonCode): void {
  expect(result.blocked).toBeNull();
  expect(result.hasHold).toBe(true);
  for (const decision of result.lines) {
    if (decision.line.treatmentId === id) {
      expect(decision.state).toBe('ON_HOLD');
      expect(decision.holdReason).toBe(code);
    } else {
      expect(decision.state).toBe('ESTIMATED');
      expect(decision.groupKey).toBe('TEST_GROUP_BENEFIT');
    }
  }
}

describe('AC-008a 프로필 보류 행렬 — 예시 4종이 모두 사용 가능하게 매핑되어 있고 프로필만 바꾼다', () => {
  const cases: Array<[string, Partial<StandardAssumptionProfile>, HoldReasonCode]> = [
    ['출처 DEMO', { origin: 'DEMO' }, 'PROFILE_DEMO'],
    ['DRAFT', { state: 'DRAFT' }, 'PROFILE_DRAFT'],
    ['REVIEW_REQUESTED', { state: 'REVIEW_REQUESTED' }, 'PROFILE_UNAPPROVED'],
    ['REJECTED', { state: 'REJECTED' }, 'PROFILE_UNAPPROVED'],
    ['APPROVED(미게시)', { state: 'APPROVED' }, 'PROFILE_UNAPPROVED'],
    ['UNDER_REREVIEW', { state: 'UNDER_REREVIEW' }, 'PROFILE_UNDER_REREVIEW'],
    ['SUPERSEDED', { state: 'SUPERSEDED' }, 'PROFILE_INVALID'],
    ['EXPIRED', { state: 'EXPIRED' }, 'PROFILE_INVALID'],
    ['SUSPENDED', { state: 'SUSPENDED' }, 'PROFILE_INVALID'],
    ['유효 기간 밖', { validity: { from: '2025-01-01', to: '2025-12-31' } }, 'PROFILE_INVALID'],
    ['내용 해시 불일치', { contentHash: 'TEST_DIGEST_00000000' }, 'PROFILE_INVALID'],
    ['약관 출처 없음', { policySources: [] }, 'PROFILE_SOURCE_INCOMPLETE'],
    ['승인자 없음', { approver: null }, 'PROFILE_SOURCE_INCOMPLETE'],
  ];

  it.each(cases)('프로필 %s → 모든 줄 %s', (_name, overrides, code) => {
    const result = front(makeInput({ bundle: bundleWith(makeProfile(overrides)) }));
    expectAllOnHold(result, code);
  });

  it.each<keyof PolicySourceRef>([
    'insurerDocumentId',
    'revisionDate',
    'clauseOrPage',
    'effectiveDate',
    'verifiedBy',
    'verifiedAt',
  ])('약관 출처 6항목 중 %s 누락 → PROFILE_SOURCE_INCOMPLETE', (field) => {
    const profile = makeProfile({ policySources: [{ ...testPolicySource(), [field]: '' }] });
    expectAllOnHold(front(makeInput({ bundle: bundleWith(profile) })), 'PROFILE_SOURCE_INCOMPLETE');
  });

  it('규칙 허용 출처가 OPERATING 뿐일 때의 TEST_FIXTURE 프로필 → PROFILE_DEMO', () => {
    const input = makeInput({ acceptedOrigins: { rules: ['OPERATING'], lines: ['OPERATING', 'TEST_FIXTURE'] } });
    expectAllOnHold(front(input), 'PROFILE_DEMO');
  });

  it('칸에 프로필 기록이 없으면 PROFILE_ABSENT', () => {
    expectAllOnHold(front(makeInput({ bundle: makeBundle({ profiles: [] }) })), 'PROFILE_ABSENT');
  });

  it('묶음의 profiles 가 배열이 아니면 기록이 없는 것으로 보고 PROFILE_ABSENT (값을 추정하지 않는다)', () => {
    const bundle = { ...makeBundle(), profiles: undefined as unknown as StandardAssumptionProfile[] };
    expectAllOnHold(front(makeInput({ bundle })), 'PROFILE_ABSENT');
  });

  it('묶음의 mappings 가 배열이 아니면 모든 줄이 MAPPING_ABSENT 로 보류된다', () => {
    const bundle = { ...makeBundle(), mappings: undefined as unknown as TreatmentCoverageMapping[] };
    const result = front(makeInput({ bundle }));
    expect(result.blocked).toBeNull();
    expect(result.lines.every((decision) => decision.holdReason === 'MAPPING_ABSENT')).toBe(true);
  });

  it('허용 출처 목록이 없으면 아무 출처도 허용하지 않는 것으로 본다 (규칙 쪽은 PROFILE_DEMO, 줄 쪽은 LINE_ORIGIN_NOT_ACCEPTED)', () => {
    const noRules = makeInput({ acceptedOrigins: undefined as unknown as EstimateInput['acceptedOrigins'] });
    expectAllOnHold(front(noRules), 'PROFILE_DEMO');
    const noLines = makeInput({
      acceptedOrigins: { rules: ['TEST_FIXTURE'], lines: undefined as unknown as never[] },
    });
    const result = front(noLines);
    expect(result.lines.every((decision) => decision.holdReason === 'LINE_ORIGIN_NOT_ACCEPTED')).toBe(true);
  });

  it('같은 (세대, 보험사 형태) 칸에 프로필이 둘 이상(둘 다 사용 가능)이면 하나를 골라 쓰지 않고 PROFILE_INVALID', () => {
    const first = makeProfile({ id: 'TEST_PROFILE_1' });
    const second = makeProfile({ id: 'TEST_PROFILE_2' });
    expectAllOnHold(front(makeInput({ bundle: makeBundle({ profiles: [first, second] }) })), 'PROFILE_INVALID');
    expectAllOnHold(front(makeInput({ bundle: makeBundle({ profiles: [second, first] }) })), 'PROFILE_INVALID');
  });

  describe('구조 결함(각각 따로) → 모든 줄 PROFILE_INVALID', () => {
    const [groupA, groupB] = testGroups() as [ReturnType<typeof testGroups>[number], ReturnType<typeof testGroups>[number]];
    const pool = { poolKey: 'TEST_POOL_1', limit: { kind: 'PER_VISIT_PAYOUT', amount: 50_000, limitBasis: 'PAYOUT' } as const };
    const structural: Array<[string, Partial<StandardAssumptionProfile>]> = [
      ['빈 groupKey', { groups: [{ ...groupA, groupKey: '' }, groupB], groupOrder: ['', groupB.groupKey] }],
      ['중복 groupKey', { groups: [groupA, { ...groupB, groupKey: groupA.groupKey }], groupOrder: [groupA.groupKey] }],
      ['빈 poolKey', { sharedLimitPools: [{ ...pool, poolKey: '' }] }],
      ['중복 poolKey', { sharedLimitPools: [pool, pool] }],
      ['없는 풀을 가리키는 sharedLimitPoolKey', { groups: [{ ...groupA, sharedLimitPoolKey: 'TEST_POOL_MISSING' }, groupB] }],
      ['groupOrder 에서 빠진 키', { groupOrder: [groupA.groupKey] }],
      ['groupOrder 의 중복 키', { groupOrder: [groupA.groupKey, groupB.groupKey, groupB.groupKey] }],
      ['groupOrder 의 없는 키', { groupOrder: [groupA.groupKey, groupB.groupKey, 'TEST_GROUP_GHOST'] }],
      ['그룹이 하나도 없는 빈 프로필', { groups: [], groupOrder: [] }],
    ];

    it.each(structural)('%s', (_name, overrides) => {
      expectAllOnHold(front(makeInput({ bundle: bundleWith(makeProfile(overrides)) })), 'PROFILE_INVALID');
    });
  });

  it('묶음 단위: 규칙 묶음이 SUSPENDED 이면 프로필이 사용 가능해도 모든 줄 RULE_BUNDLE_SUSPENDED', () => {
    expectAllOnHold(front(makeInput({ bundle: makeBundle({ status: 'SUSPENDED' }) })), 'RULE_BUNDLE_SUSPENDED');
  });

  it('결과는 실행마다 같다 (결정성)', () => {
    const input = makeInput({ bundle: bundleWith(makeProfile({ state: 'DRAFT' })) });
    expect(JSON.stringify(front(input))).toBe(JSON.stringify(front(input)));
  });
});

describe('AC-008b 매핑 보류 행렬 — 프로필은 사용 가능하고 신장분사치료 매핑만 바꾼다', () => {
  const others = [T_XRAY, T_ULTRA, T_PHYSIO].map((id) => makeMapping(id));
  const withInject = (...mappings: TreatmentCoverageMapping[]) => makeInput({ bundle: bundleWith(makeProfile(), [...others, ...mappings]) });

  it('매핑 기록 없음 → MAPPING_ABSENT', () => {
    expectOnlyOneOnHold(front(withInject()), T_INJECT, 'MAPPING_ABSENT');
  });

  it.each(Object.entries(unusableMappingVariants(T_INJECT)))('사용 불가 상태 %s → 그 줄만 해당 코드', (_name, variant) => {
    expectOnlyOneOnHold(front(withInject(variant.make('TEST_X'))), T_INJECT, variant.code);
  });

  it('사용 가능한 매핑이 2개 이상이면 MAPPING_INVALID', () => {
    const result = front(withInject(makeMapping(T_INJECT, { id: 'TEST_A' }), makeMapping(T_INJECT, { id: 'TEST_B' })));
    expectOnlyOneOnHold(result, T_INJECT, 'MAPPING_INVALID');
  });

  it('사용 가능한 COVERED 매핑의 groupKey 가 프로필에 없으면 MAPPING_GROUP_NOT_IN_PROFILE', () => {
    const mapping = makeMapping(T_INJECT, { groupKey: 'TEST_GROUP_NOT_IN_PROFILE' });
    expectOnlyOneOnHold(front(withInject(mapping)), T_INJECT, 'MAPPING_GROUP_NOT_IN_PROFILE');
  });

  it.each(Object.entries(unusableMappingVariants(T_INJECT)))(
    'EXCLUDED 매핑이 사용 불가(%s)이면 제외 확인이 아니라 그 상태의 보류 코드다',
    (_name, variant) => {
      const { groupKey: _dropped, ...rest } = variant.make('TEST_X');
      const excluded: TreatmentCoverageMapping = { ...rest, decision: 'EXCLUDED', exclusionReason: 'TEST_FIXTURE_REASON' };
      const result = front(withInject(excluded));
      expectOnlyOneOnHold(result, T_INJECT, variant.code);
      expect(result.lines.some((decision) => decision.state === 'EXCLUDED_CONFIRMED')).toBe(false);
    },
  );

  it('사용 가능한 EXCLUDED 매핑은 EXCLUDED_CONFIRMED 이며 보류가 아니다 (전체 hasHold 도 false)', () => {
    const result = front(withInject(makeExcludedMapping(T_INJECT)));
    expect(result.hasHold).toBe(false);
    const decision = result.lines.find((entry) => entry.line.treatmentId === T_INJECT);
    expect(decision?.state).toBe('EXCLUDED_CONFIRMED');
    expect(decision?.exclusionReason).toBe('TEST_FIXTURE_EXCLUSION_REASON');
  });

  it('모든 줄이 사용 가능하게 매핑되면 보류가 없다 (hasHold = false)', () => {
    const result = front(makeInput());
    expect(result.blocked).toBeNull();
    expect(result.hasHold).toBe(false);
    expect(result.profile?.id).toBe('TEST_PROFILE_1');
    expect(result.lines.every((decision) => decision.state === 'ESTIMATED')).toBe(true);
  });
});

describe('AC-008c 분류 확인 필요', () => {
  it('신장분사치료 치료 버전의 calcClass 가 NEEDS_REVIEW 이면 그 줄만 CLASSIFICATION_NEEDS_REVIEW', () => {
    const lines = exampleLines().map((line) => (line.treatmentId === T_INJECT ? { ...line, calcClass: 'NEEDS_REVIEW' as const } : line));
    expectOnlyOneOnHold(front(makeInput({ lines })), T_INJECT, 'CLASSIFICATION_NEEDS_REVIEW');
  });
});

describe('AC-008d 칸 조회 — 다른 칸의 값을 쓰지 않는다', () => {
  it('(2세대(C1), 손해보험사) 칸에 프로필이 없으면 PROFILE_ABSENT 이고 다른 칸의 프로필은 쓰이지 않는다', () => {
    const otherGeneration = makeProfile({ id: 'TEST_PROFILE_C2', generation: 'GEN2_5_C2', insurerType: 'NON_LIFE' });
    const otherInsurer = makeProfile({ id: 'TEST_PROFILE_C1_LIFE', generation: 'GEN2_C1', insurerType: 'LIFE' });
    const input = makeInput({
      generation: 'GEN2_C1',
      insurerType: 'NON_LIFE',
      bundle: makeBundle({ profiles: [otherGeneration, otherInsurer] }),
    });
    expectAllOnHold(front(input), 'PROFILE_ABSENT');
  });

  it('칸이 일치하면 그 칸의 프로필이 쓰인다', () => {
    const c1Life = makeProfile({ id: 'TEST_PROFILE_C1_LIFE', generation: 'GEN2_C1', insurerType: 'LIFE' });
    const mappings = exampleMappings().map((mapping) => ({
      ...mapping,
      scope: [{ generation: 'GEN2_C1' as const, insurerType: 'LIFE' as const }],
    }));
    const input = makeInput({
      generation: 'GEN2_C1',
      insurerType: 'LIFE',
      bundle: makeBundle({ profiles: [makeProfile(), c1Life], mappings }),
    });
    const result = front(input);
    expect(result.profile?.id).toBe('TEST_PROFILE_C1_LIFE');
    expect(result.hasHold).toBe(false);
  });

  it('알 수 없는 insurerType 이면 어느 칸과도 맞지 않아 PROFILE_ABSENT 다', () => {
    const input = makeInput({ insurerType: 'UNKNOWN_KIND' as unknown as 'LIFE' });
    expectAllOnHold(front(input), 'PROFILE_ABSENT');
  });
});

describe('AC-008e 판정 순서 (증거만; 닫는 곳 M1.3): 묶음 → 프로필 칸 조회 → 프로필 isUsable → 프로필 구조 → 줄 출처 → 분류 → 매핑 조회 → groupKey', () => {
  const draftMapping = makeMapping(T_INJECT, { state: 'DRAFT' });
  const mappingsWithDraft = [...[T_XRAY, T_ULTRA, T_PHYSIO].map((id) => makeMapping(id)), draftMapping];

  it('프로필 사유와 매핑 사유가 겹치면 프로필 사유 하나만 기록된다', () => {
    const result = front(makeInput({ bundle: bundleWith(makeProfile({ state: 'DRAFT' }), mappingsWithDraft) }));
    expectAllOnHold(result, 'PROFILE_DRAFT');
  });

  it('프로필 구조 결함과 매핑 사유가 겹치면 PROFILE_INVALID 하나다', () => {
    const result = front(makeInput({ bundle: bundleWith(makeProfile({ groupOrder: [] }), mappingsWithDraft) }));
    expectAllOnHold(result, 'PROFILE_INVALID');
  });

  it('줄 출처와 매핑 사유가 겹치면 LINE_ORIGIN_NOT_ACCEPTED 가, 분류와 매핑 사유가 겹치면 CLASSIFICATION_NEEDS_REVIEW 가 이긴다', () => {
    const demoLines = exampleLines().map((line) => (line.treatmentId === T_INJECT ? { ...line, origin: 'DEMO' as const } : line));
    const originResult = front(
      makeInput({
        lines: demoLines,
        acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE'] },
        bundle: bundleWith(makeProfile(), mappingsWithDraft),
      }),
    );
    expectOnlyOneOnHold(originResult, T_INJECT, 'LINE_ORIGIN_NOT_ACCEPTED');

    const reviewLines = exampleLines().map((line) => (line.treatmentId === T_INJECT ? { ...line, calcClass: 'NEEDS_REVIEW' as const } : line));
    const reviewResult = front(makeInput({ lines: reviewLines, bundle: bundleWith(makeProfile(), mappingsWithDraft) }));
    expectOnlyOneOnHold(reviewResult, T_INJECT, 'CLASSIFICATION_NEEDS_REVIEW');
  });

  it('매핑 사유가 groupKey 단계보다 먼저다', () => {
    const mappings = [...mappingsWithDraft.slice(0, 3), { ...draftMapping, groupKey: 'TEST_GROUP_NOT_IN_PROFILE' }];
    expectOnlyOneOnHold(front(makeInput({ bundle: bundleWith(makeProfile(), mappings) })), T_INJECT, 'MAPPING_UNREVIEWED');
  });
});

describe('공통 기본비용 줄 (plan.md §E.9 #8 정정 문구)', () => {
  it('기본비용은 예상 병원 결제액에 들어가고, 보험금 계산 쪽에서는 치료와 같은 매핑 판정을 거친다', () => {
    const baseFee = exampleBaseFeeLine();
    const result = front(makeInput({ baseFeeLines: [baseFee], bundle: bundleWith(makeProfile(), [...exampleMappings(), makeMapping(baseFee.treatmentId)]) }));
    expect(result.validated.hospitalPayment).toBe(129_000);
    expect(result.hasHold).toBe(false);
    const entry = result.lines.find((decision) => decision.line.isBaseFee);
    expect(entry).toMatchObject({ state: 'ESTIMATED', groupKey: 'TEST_GROUP_BENEFIT' });
  });

  it('등록되었으나 매핑이 없으면 병원 결제액에는 들어가고 그 줄은 MAPPING_ABSENT 로 보류되어 전체가 보류다', () => {
    const baseFee = exampleBaseFeeLine();
    const result = front(makeInput({ baseFeeLines: [baseFee] }));
    expect(result.validated.hospitalPayment).toBe(129_000);
    expect(result.hasHold).toBe(true);
    expect(result.lines.find((decision) => decision.line.isBaseFee)).toMatchObject({
      state: 'ON_HOLD',
      holdReason: 'MAPPING_ABSENT',
    });
    expect(result.lines.filter((decision) => !decision.line.isBaseFee).every((d) => d.state === 'ESTIMATED')).toBe(true);
  });

  it('치료 줄과 기본비용 줄은 treatmentId 코드 포인트 순으로 한 목록에 합쳐진다', () => {
    const baseFee = makeLine('A-BASE', 100, { isBaseFee: true });
    const result = front(makeInput({ baseFeeLines: [baseFee] }));
    expect(result.lines.map((decision) => decision.line.treatmentId)).toEqual(['A-BASE', ...ALL_IDS_SORTED]);
  });
});

describe('입력 검증 거절은 그대로 전달되고 묶음·프로필 조회가 일어나지 않는다 (AC-006a 의 조회 부분)', () => {
  function spies() {
    const calls: string[] = [];
    const functions = {
      isBundleUsable: (bundle: RuleBundleSnapshot | null) => {
        calls.push('isBundleUsable');
        return isBundleUsable(bundle);
      },
    };
    return { calls, functions };
  }

  it.each([
    ['세대가 열거 밖(5세대)', { generation: 'GEN5_C5' as unknown as 'GEN1_AS' }, 'UNSUPPORTED_GENERATION'],
    ['치료 0개', { treatmentIds: [] }, 'NO_TREATMENT_SELECTED'],
    ['줄 금액이 무효', { lines: [makeLine(T_XRAY, -1)], treatmentIds: [T_XRAY] }, 'INVALID_NUMERIC_INPUT'],
  ])('%s → %s 로 거절되고 4세대 프로필 조회(묶음 판정 포함)가 일어나지 않는다', (_name, overrides, code) => {
    const { calls, functions } = spies();
    const result = estimateFront(makeInput(overrides as Partial<EstimateInput>), { digest: testDigest, functions });
    expect(result).toMatchObject({ ok: false, rejection: { code } });
    expect(calls).toEqual([]);
  });

  it('병원 결제액 합산 넘침(시험 대역)도 거절이며 조회가 일어나지 않는다', () => {
    const { calls, functions } = spies();
    const result = estimateFront(makeInput(), {
      digest: testDigest,
      functions,
      sum: () => ({ ok: false, reason: 'OVERFLOW', step: 'HOSPITAL_PAYMENT_SUM' }),
    });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_NUMERIC_INPUT' } });
    expect(calls).toEqual([]);
  });

  it('유효한 입력이면 묶음 판정이 한 번 일어난다', () => {
    const { calls, functions } = spies();
    estimateFront(makeInput(), { digest: testDigest, functions });
    expect(calls).toEqual(['isBundleUsable']);
  });
});

describe('배열 순서 독립 (AC-008k 의 앞단 부분, 증거만)', () => {
  function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [[...items]];
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
    );
  }

  it('bundle.mappings(후보가 여럿인 줄 포함)·bundle.profiles·lines·treatmentIds 순서를 바꿔도 결과가 같다', () => {
    const extraProfile = makeProfile({ id: 'TEST_PROFILE_OTHER_CELL', generation: 'GEN1_AS', insurerType: 'LIFE' });
    const mappings = [
      ...exampleMappings(),
      makeMapping(T_INJECT, { id: 'TEST_STALE', approvedFingerprint: 'TEST_FP_OLD' }),
      makeMapping(T_ULTRA, { id: 'TEST_DRAFT', state: 'DRAFT' }),
    ];
    const baseline = JSON.stringify(
      front(makeInput({ bundle: makeBundle({ profiles: [makeProfile(), extraProfile], mappings }) })),
    );
    for (const lines of permutations(exampleLines())) {
      for (const profiles of permutations([makeProfile(), extraProfile])) {
        const shuffledMappings = [...mappings].reverse();
        const input = makeInput({
          lines,
          treatmentIds: [...lines].reverse().map((line) => line.treatmentId),
          bundle: makeBundle({ profiles, mappings: shuffledMappings }),
        });
        expect(JSON.stringify(front(input))).toBe(baseline);
      }
    }
  });
});

describe('보류 줄은 어느 그룹에도 들어가지 않는다 (groupKey 없음)', () => {
  it('보류 줄의 결정에는 groupKey 가 없다', () => {
    const result = front(makeInput({ bundle: bundleWith(makeProfile(), []) }));
    for (const decision of result.lines) {
      expect(decision.state).toBe('ON_HOLD');
      expect('groupKey' in decision).toBe(false);
    }
  });

  it('상태 값이 알 수 없는 프로필은 사용 가능으로 추정하지 않는다', () => {
    const profile = makeProfile({ state: 'ARCHIVED' as unknown as LifecycleState });
    expectAllOnHold(front(makeInput({ bundle: bundleWith(profile) })), 'PROFILE_INVALID');
  });
});

describe('입력 객체를 바꾸지 않는다', () => {
  it('깊게 동결한 입력도 처리하고 같은 결과를 낸다', () => {
    const input = makeInput();
    const deepFreeze = (value: unknown): void => {
      if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
      }
    };
    const before = JSON.stringify(front(makeInput()));
    deepFreeze(input);
    expect(JSON.stringify(front(input))).toBe(before);
  });
});
