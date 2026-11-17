import { describe, expect, it, vi } from 'vitest';
import { decideLine, resolveMapping } from '../../src/engine/resolve';
import type { LineDecision, MappingResolution } from '../../src/engine/resolve';
import { isUsable } from '../../src/engine/usability';
import type { UsabilityContext } from '../../src/engine/usability';
import type { LifecycleState, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../src/engine/types';
import { makeExcludedMapping, makeMapping, testFingerprint, unusableMappingVariants } from '../fixtures/engine/mappings.fixture';
import { TEST_AT, TEST_CELL, makeProfile, testDigest } from '../fixtures/engine/profiles.fixture';
import { bundleWith, makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이나 승인 기록이 아니다.

const ID = 'T-INJECT';
const line = makeLine(ID, 40_000);
const profile = makeProfile();
const ctx: UsabilityContext = {
  at: TEST_AT,
  acceptedOrigins: ['OPERATING', 'TEST_FIXTURE'],
  digest: testDigest,
};

function resolve(mappings: TreatmentCoverageMapping[]): MappingResolution {
  return resolveMapping(line, bundleWith(profile, mappings), TEST_CELL, ctx);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

/** 고정 시드 선형 합동 생성기로 만든 순열. 시험 입력은 결정적이다. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const UNUSABLE = unusableMappingVariants(ID);

describe('resolveMapping — 후보 구성 행렬 (AC-008h)', () => {
  it('1. 묶음에 이 treatmentId 의 매핑이 없으면 MAPPING_ABSENT 다', () => {
    expect(resolve([])).toEqual({ resolved: false, code: 'MAPPING_ABSENT' });
  });

  it('2. scope 에 이 칸이 없는 매핑(다른 세대·다른 보험사 형태)이나 다른 treatmentId 의 매핑은 후보가 아니다', () => {
    const otherGeneration = makeMapping(ID, { scope: [{ generation: 'GEN1_AS', insurerType: TEST_CELL.insurerType }] });
    const otherInsurer = makeMapping(ID, { scope: [{ generation: TEST_CELL.generation, insurerType: 'LIFE' }] });
    const otherTreatment = makeMapping('T-OTHER');
    expect(resolve([otherGeneration, otherInsurer, otherTreatment])).toEqual({
      resolved: false,
      code: 'MAPPING_ABSENT',
    });
  });

  it('2-b. scope 가 여러 칸을 담으면 그 가운데 이 칸이 있을 때 후보다', () => {
    const multi = makeMapping(ID, {
      scope: [{ generation: 'GEN1_AS', insurerType: 'LIFE' }, { ...TEST_CELL }],
    });
    expect(resolve([multi])).toEqual({ resolved: true, mapping: multi });
  });

  it('3. 사용 가능한 후보 1개는 그 매핑으로 확정한다', () => {
    const only = makeMapping(ID);
    expect(resolve([only])).toEqual({ resolved: true, mapping: only });
  });

  it.each(Object.entries(UNUSABLE))(
    '4. 사용 가능한 후보 1개 + 사용 불가 후보 1개(%s)는 사용 가능한 후보로 확정하고 사용 불가 코드는 기록되지 않는다',
    (_name, { make }) => {
      const usable = makeMapping(ID, { id: 'TEST_MAPPING_USABLE' });
      const unusable = make('TEST_MAPPING_UNUSABLE');
      for (const order of permutations([usable, unusable])) {
        expect(resolve(order)).toEqual({ resolved: true, mapping: usable });
      }
    },
  );

  it('5. 사용 가능한 후보 2개(둘 다 COVERED, groupKey 도 같음)는 MAPPING_INVALID(모호)다', () => {
    const a = makeMapping(ID, { id: 'TEST_A' });
    const b = makeMapping(ID, { id: 'TEST_B' });
    expect(resolve([a, b])).toEqual({ resolved: false, code: 'MAPPING_INVALID' });
    expect(resolve([b, a])).toEqual({ resolved: false, code: 'MAPPING_INVALID' });
  });

  it('6. 사용 가능한 COVERED 1개 + 사용 가능한 EXCLUDED 1개는 MAPPING_INVALID(모호)다: 보장도 제외도 이기지 않는다', () => {
    const covered = makeMapping(ID, { id: 'TEST_COVERED' });
    const excluded = makeExcludedMapping(ID, { id: 'TEST_EXCLUDED' });
    for (const order of permutations([covered, excluded])) {
      expect(resolve(order)).toEqual({ resolved: false, code: 'MAPPING_INVALID' });
    }
    const decision = decideLine(
      { line, bundle: bundleWith(profile, [covered, excluded]), profile, cell: TEST_CELL, ctx, acceptedLineOrigins: ['TEST_FIXTURE'] },
    );
    expect(decision.state).toBe('ON_HOLD');
    expect(decision.holdReason).toBe('MAPPING_INVALID');
  });

  it('7. 후보 2개 가운데 하나만 지문이 불일치하면 지문 불일치 후보는 세지 않으므로 나머지 1개로 확정한다(모호가 아님)', () => {
    const good = makeMapping(ID, { id: 'TEST_GOOD' });
    const stale = makeMapping(ID, { id: 'TEST_STALE', approvedFingerprint: 'TEST_FP_OLD' });
    for (const order of permutations([good, stale])) {
      expect(resolve(order)).toEqual({ resolved: true, mapping: good });
    }
  });

  it('8. 후보 2개가 모두 지문 불일치이면 사용 가능한 후보가 0개이므로 MAPPING_UNDER_REREVIEW 다', () => {
    const a = makeMapping(ID, { id: 'TEST_A', approvedFingerprint: 'TEST_FP_OLD_A' });
    const b = makeMapping(ID, { id: 'TEST_B', approvedFingerprint: 'TEST_FP_OLD_B' });
    expect(resolve([a, b])).toEqual({ resolved: false, code: 'MAPPING_UNDER_REREVIEW' });
  });

  it('9. 사용 가능한 후보 3개 이상은 MAPPING_INVALID 다', () => {
    const three = ['A', 'B', 'C'].map((suffix) => makeMapping(ID, { id: `TEST_${suffix}` }));
    for (const order of permutations(three)) {
      expect(resolve(order)).toEqual({ resolved: false, code: 'MAPPING_INVALID' });
    }
  });

  it('후보마다 isUsable 을 정확히 한 번씩 부르고 줄의 현재 지문을 넘긴다', () => {
    const spy = vi.fn(isUsable);
    const a = makeMapping(ID, { id: 'TEST_A' });
    const b = makeMapping(ID, { id: 'TEST_B', state: 'DRAFT' });
    resolveMapping(line, bundleWith(profile, [a, b, makeMapping('T-OTHER')]), TEST_CELL, ctx, { isUsable: spy });
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call[0]).toMatchObject({ kind: 'MAPPING', currentFingerprint: testFingerprint(ID) });
    }
  });
});

describe('resolveMapping — 사용 가능한 후보가 없을 때의 고정 우선순위 (AC-008i)', () => {
  // 우선순위: MAPPING_UNDER_REREVIEW > MAPPING_UNREVIEWED > MAPPING_REJECTED > MAPPING_INVALID
  const PRIORITY = ['MAPPING_UNDER_REREVIEW', 'MAPPING_UNREVIEWED', 'MAPPING_REJECTED', 'MAPPING_INVALID'] as const;
  const BY_CODE: Record<(typeof PRIORITY)[number], string> = {
    MAPPING_UNDER_REREVIEW: 'FINGERPRINT_MISMATCH',
    MAPPING_UNREVIEWED: 'DRAFT',
    MAPPING_REJECTED: 'REJECTED',
    MAPPING_INVALID: 'ORIGIN_DEMO',
  };

  function subsets<T>(items: readonly T[]): T[][] {
    return items
      .reduce<T[][]>((acc, item) => [...acc, ...acc.map((set) => [...set, item])], [[]])
      .filter((set) => set.length > 0);
  }

  it('코드가 서로 다른 후보의 모든 쌍·모든 3개 조합·4개 전부에서 가장 높은 우선순위 코드가 이기고, 모든 후보 순열에서 같다', () => {
    let checked = 0;
    for (const codes of subsets(PRIORITY)) {
      const mappings = codes.map((code, index) => UNUSABLE[BY_CODE[code]]!.make(`TEST_C${index}`));
      const expected = PRIORITY.find((code) => codes.includes(code));
      for (const order of permutations(mappings)) {
        expect(resolve(order)).toEqual({ resolved: false, code: expected });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('같은 코드를 받는 후보가 여럿이어도 그 코드다 (무효 상태 여러 종류 포함)', () => {
    const invalids = ['SUPERSEDED', 'EXPIRED', 'SUSPENDED', 'OUTSIDE_VALIDITY', 'SOURCE_MISSING', 'APPROVER_MISSING', 'ORIGIN_DEMO'].map(
      (name, index) => UNUSABLE[name]!.make(`TEST_I${index}`),
    );
    expect(resolve(invalids)).toEqual({ resolved: false, code: 'MAPPING_INVALID' });
    const drafts = ['DRAFT', 'REVIEW_REQUESTED', 'APPROVED_UNPUBLISHED'].map((name, index) => UNUSABLE[name]!.make(`TEST_D${index}`));
    expect(resolve(drafts)).toEqual({ resolved: false, code: 'MAPPING_UNREVIEWED' });
  });

  it('후보 하나가 사용 불가 사유를 여럿 가지면 isUsable 의 검사 순서에서 처음 걸린 사유가 그 후보의 코드를 정한다', () => {
    // DRAFT(상태) + 지문 불일치: 상태가 지문보다 앞서므로 MAPPING_UNREVIEWED
    const draftAndStale = makeMapping(ID, { state: 'DRAFT', approvedFingerprint: 'TEST_FP_OLD' });
    expect(resolve([draftAndStale])).toEqual({ resolved: false, code: 'MAPPING_UNREVIEWED' });
    // 허용 밖 출처 + REJECTED: 출처가 상태보다 앞서므로 MAPPING_INVALID
    const demoAndRejected = makeMapping(ID, { origin: 'DEMO', state: 'REJECTED' });
    expect(resolve([demoAndRejected])).toEqual({ resolved: false, code: 'MAPPING_INVALID' });
    // 승인자 없음 + 지문 불일치: 승인자가 지문보다 앞서므로 MAPPING_INVALID
    const noApproverAndStale = makeMapping(ID, { approver: null, approvedFingerprint: 'TEST_FP_OLD' });
    expect(resolve([noApproverAndStale])).toEqual({ resolved: false, code: 'MAPPING_INVALID' });
  });

  it('후보가 5개를 넘는 조합은 고정 시드 순열로 시험한다 (시드 20261015, 12개 후보)', () => {
    const names = ['FINGERPRINT_MISMATCH', 'UNDER_REREVIEW_STATE', 'DRAFT', 'REJECTED', 'ORIGIN_DEMO', 'SUPERSEDED'];
    const mappings = [...names, ...names].map((name, index) => UNUSABLE[name]!.make(`TEST_S${index}`));
    for (let trial = 0; trial < 20; trial += 1) {
      const shuffled = seededShuffle(mappings, 20261015 + trial);
      expect(resolve(shuffled)).toEqual({ resolved: false, code: 'MAPPING_UNDER_REREVIEW' });
    }
    const withoutRereview = mappings.filter((_m, index) => !['FINGERPRINT_MISMATCH', 'UNDER_REREVIEW_STATE'].includes(names[index % 6] as string));
    for (let trial = 0; trial < 20; trial += 1) {
      expect(resolve(seededShuffle(withoutRereview, 777 + trial))).toEqual({ resolved: false, code: 'MAPPING_UNREVIEWED' });
    }
  });
});

describe('resolveMapping — 필드 규칙 방어 (AC-008j 일부, 증거만; 닫는 곳 M1.3)', () => {
  const badMappings: Array<[string, TreatmentCoverageMapping]> = [
    ['COVERED 인데 groupKey 가 없음', makeMapping(ID, { groupKey: undefined as unknown as string })],
    ['COVERED 인데 groupKey 가 빈 문자열', makeMapping(ID, { groupKey: '' })],
    ['COVERED 인데 exclusionReason 이 있음', makeMapping(ID, { exclusionReason: 'TEST_FIXTURE_REASON' })],
    ['EXCLUDED 인데 groupKey 가 있음', makeExcludedMapping(ID, { groupKey: 'TEST_GROUP_BENEFIT' })],
    ['EXCLUDED 인데 exclusionReason 이 없음', makeExcludedMapping(ID, { exclusionReason: undefined as unknown as string })],
    ['EXCLUDED 인데 exclusionReason 이 빈 문자열', makeExcludedMapping(ID, { exclusionReason: '' })],
    ['decision 이 두 값 밖', makeMapping(ID, { decision: 'MAYBE' as unknown as 'COVERED' })],
  ];

  it.each(badMappings)('사용 가능으로 판정되어도 %s 이면 줄은 MAPPING_INVALID 로 보류된다', (_name, mapping) => {
    expect(resolve([mapping])).toEqual({ resolved: false, code: 'MAPPING_INVALID' });
    const decision = decideLine({
      line,
      bundle: bundleWith(profile, [mapping]),
      profile,
      cell: TEST_CELL,
      ctx,
      acceptedLineOrigins: ['TEST_FIXTURE'],
    });
    expect(decision.state).toBe('ON_HOLD');
    expect(decision.holdReason).toBe('MAPPING_INVALID');
  });
});

describe('decideLine — 줄 판정 순서와 상태 (줄 출처 → 분류 → 매핑 조회 → groupKey)', () => {
  const baseArgs = (
    mappings: TreatmentCoverageMapping[],
    overrides: Partial<Parameters<typeof decideLine>[0]> = {},
    p: StandardAssumptionProfile = profile,
  ): Parameters<typeof decideLine>[0] => ({
    line,
    bundle: bundleWith(p, mappings),
    profile: p,
    cell: TEST_CELL,
    ctx,
    acceptedLineOrigins: ['OPERATING', 'TEST_FIXTURE', 'DEMO'],
    ...overrides,
  });

  it('사용 가능한 COVERED 매핑이고 groupKey 가 프로필에 있으면 ESTIMATED 이며 그 그룹으로 간다', () => {
    const result: LineDecision = decideLine(baseArgs([makeMapping(ID)]));
    expect(result).toEqual({ line, state: 'ESTIMATED', groupKey: 'TEST_GROUP_BENEFIT' });
  });

  it('사용 가능한 COVERED 매핑이지만 groupKey 가 프로필에 없으면 MAPPING_GROUP_NOT_IN_PROFILE 로 보류된다', () => {
    const result = decideLine(baseArgs([makeMapping(ID, { groupKey: 'TEST_GROUP_NOT_IN_PROFILE' })]));
    expect(result).toEqual({ line, state: 'ON_HOLD', holdReason: 'MAPPING_GROUP_NOT_IN_PROFILE' });
    expect('groupKey' in result).toBe(false);
  });

  it('사용 가능한 EXCLUDED 매핑은 EXCLUDED_CONFIRMED 이고 그룹 조회를 하지 않는다 (호출 감시)', () => {
    const lookupGroup = vi.fn(() => true);
    const result = decideLine(baseArgs([makeExcludedMapping(ID)]), { resolveMapping, lookupGroup });
    expect(result).toEqual({ line, state: 'EXCLUDED_CONFIRMED', exclusionReason: 'TEST_FIXTURE_EXCLUSION_REASON' });
    expect(lookupGroup).not.toHaveBeenCalled();
  });

  it('프로필의 그룹 키가 무엇이든 EXCLUDED_CONFIRMED 결과는 같다', () => {
    const other = makeProfile({
      groups: [{ ...profile.groups[0]!, groupKey: 'TEST_GROUP_COMPLETELY_DIFFERENT' }],
    });
    const mapping = makeExcludedMapping(ID);
    expect(decideLine(baseArgs([mapping], {}, other))).toEqual(decideLine(baseArgs([mapping])));
  });

  it.each(Object.entries(UNUSABLE))(
    '제외 지름길 없음: EXCLUDED 매핑이 사용 불가(%s)이면 EXCLUDED_CONFIRMED 가 아니라 그 상태의 보류 코드를 받는다',
    (_name, { make, code }) => {
      const base = make('TEST_X');
      const excluded: TreatmentCoverageMapping = {
        ...base,
        decision: 'EXCLUDED',
        exclusionReason: 'TEST_FIXTURE_EXCLUSION_REASON',
      };
      delete (excluded as { groupKey?: string }).groupKey;
      const result = decideLine(baseArgs([excluded]));
      expect(result.state).toBe('ON_HOLD');
      expect(result.holdReason).toBe(code);
    },
  );

  it('calcClass 가 NEEDS_REVIEW 이면 사용 가능한 EXCLUDED 도 COVERED 도 CLASSIFICATION_NEEDS_REVIEW 이고 EXCLUDED_CONFIRMED 가 아니다', () => {
    const review = makeLine(ID, 40_000, { calcClass: 'NEEDS_REVIEW' });
    for (const mapping of [makeExcludedMapping(ID), makeMapping(ID)]) {
      const lookupGroup = vi.fn(() => true);
      const resolveSpy = vi.fn(resolveMapping);
      const result = decideLine(baseArgs([mapping], { line: review }), { resolveMapping: resolveSpy, lookupGroup });
      expect(result).toEqual({ line: review, state: 'ON_HOLD', holdReason: 'CLASSIFICATION_NEEDS_REVIEW' });
      expect(resolveSpy).not.toHaveBeenCalled();
    }
  });

  it('급여 구분(benefitType)이 BENEFIT/NON_BENEFIT 밖이면 어느 몫(G, N)에도 넣을 수 없으므로 CLASSIFICATION_NEEDS_REVIEW 로 보류한다', () => {
    for (const benefitType of ['SELF_PAY', undefined, null, 1]) {
      const odd = makeLine(ID, 40_000, { benefitType: benefitType as unknown as 'BENEFIT' });
      const resolveSpy = vi.fn(resolveMapping);
      const result = decideLine(baseArgs([makeMapping(ID)], { line: odd }), { resolveMapping: resolveSpy, lookupGroup: () => true });
      expect(result).toEqual({ line: odd, state: 'ON_HOLD', holdReason: 'CLASSIFICATION_NEEDS_REVIEW' });
      expect(resolveSpy).not.toHaveBeenCalled();
    }
  });

  it('판정 순서: 줄 출처가 분류보다, 분류가 매핑 사유보다 먼저다', () => {
    const demo = makeLine(ID, 40_000, { origin: 'DEMO', calcClass: 'NEEDS_REVIEW' });
    const draft = makeMapping(ID, { state: 'DRAFT' });
    expect(decideLine(baseArgs([draft], { line: demo, acceptedLineOrigins: ['OPERATING'] })).holdReason).toBe(
      'LINE_ORIGIN_NOT_ACCEPTED',
    );
    const review = makeLine(ID, 40_000, { calcClass: 'NEEDS_REVIEW' });
    expect(decideLine(baseArgs([draft], { line: review })).holdReason).toBe('CLASSIFICATION_NEEDS_REVIEW');
    expect(decideLine(baseArgs([draft])).holdReason).toBe('MAPPING_UNREVIEWED');
  });

  it('매핑 사유가 groupKey 단계보다 먼저다: 사용 불가 매핑의 groupKey 가 프로필에 없어도 매핑 코드다', () => {
    const result = decideLine(baseArgs([makeMapping(ID, { state: 'DRAFT', groupKey: 'TEST_GROUP_NOT_IN_PROFILE' })]));
    expect(result.holdReason).toBe('MAPPING_UNREVIEWED');
  });

  it('공통 기본비용 줄도 치료와 같은 판정을 거친다: 매핑이 없으면 MAPPING_ABSENT 로 보류된다 (plan.md §E.9 #8 정정 문구)', () => {
    const baseFee = makeLine('B-BASE', 5_000, { isBaseFee: true });
    const result = decideLine(baseArgs([], { line: baseFee }));
    expect(result).toEqual({ line: baseFee, state: 'ON_HOLD', holdReason: 'MAPPING_ABSENT' });
    const withMapping = decideLine(baseArgs([makeMapping('B-BASE')], { line: baseFee }));
    expect(withMapping).toEqual({ line: baseFee, state: 'ESTIMATED', groupKey: 'TEST_GROUP_BENEFIT' });
  });

  it('상태 값(LifecycleState)별 매핑이 아닌 값은 사용 가능으로 추정하지 않는다', () => {
    const odd = makeMapping(ID, { state: 'ARCHIVED' as unknown as LifecycleState });
    expect(decideLine(baseArgs([odd])).holdReason).toBe('MAPPING_INVALID');
  });
});
