import { describe, expect, it } from 'vitest';
import type { TreatmentCoverageMapping } from '../../src/engine/types';
import { makeExcludedMapping, makeMapping, unusableMappingVariants } from '../fixtures/engine/mappings.fixture';
import { CASE_A, G_ONE, UNLIMITED, caseInput, group, perVisit, runEstimate } from '../fixtures/engine/cases.fixture';
import { T_INJECT, T_PHYSIO, T_ULTRA, T_XRAY, exampleLines, makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.
// AC-008j: 보장 여부는 매핑의 decision 만이 정한다. 확인된 제외는 사용 가능한 EXCLUDED 매핑으로만 존재한다(제외 지름길 없음).

const ALL = [T_XRAY, T_ULTRA, T_PHYSIO, T_INJECT];

function mappingsWith(special: TreatmentCoverageMapping): TreatmentCoverageMapping[] {
  return [...ALL.filter((id) => id !== special.treatmentId).map((id) => makeMapping(id, { groupKey: G_ONE })), special];
}

describe('AC-008j 사용 가능한 COVERED 매핑', () => {
  it('groupKey 가 프로필에 있으면 ESTIMATED 이고 그 그룹의 E 에 들어간다', () => {
    const result = runEstimate(caseInput({ groups: CASE_A }));
    expect(result.lines.every((line) => line.state === 'ESTIMATED' && line.groupKey === G_ONE)).toBe(true);
    expect(result.groups[0]).toMatchObject({ E: 124_000 });
  });

  it('groupKey 가 프로필에 없으면 그 줄은 MAPPING_GROUP_NOT_IN_PROFILE 로 보류되고 어느 그룹 E 에도 들어가지 않는다', () => {
    const special = makeMapping(T_INJECT, { groupKey: 'TEST_GROUP_NOT_IN_PROFILE' });
    const result = runEstimate(caseInput({ groups: CASE_A, mappings: mappingsWith(special) }));
    expect(result.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_GROUP_NOT_IN_PROFILE' });
    expect(result.groups[0]).toMatchObject({ E: 84_000, P: 74_000 }); // 보류 줄의 40,000 이 없다
    expect(result.referenceGroups).toEqual([{ groupKey: G_ONE, P: 74_000, isReference: true }]);
  });
});

describe('AC-008j 사용 가능한 EXCLUDED 매핑', () => {
  it('EXCLUDED_CONFIRMED 이고 excludedItems 에 사유와 상수 payout 0 으로 들어가며 그룹 E 에 들어가지 않는다 (그 줄을 뺀 입력과 그룹 E 가 같다)', () => {
    const withExcluded = runEstimate(caseInput({ groups: CASE_A, excluded: [T_INJECT] }));
    const without = runEstimate(caseInput({ groups: CASE_A, lines: exampleLines().filter((line) => line.treatmentId !== T_INJECT) }));
    expect(withExcluded.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({ state: 'EXCLUDED_CONFIRMED' });
    expect(withExcluded.excludedItems).toEqual([{ treatmentId: T_INJECT, amount: 40_000, reason: 'TEST_FIXTURE_EXCLUSION_REASON', payout: 0 }]);
    expect(withExcluded.groups[0]!.E).toBe(without.groups[0]!.E);
    expect(withExcluded.groups[0]!.P).toBe(without.groups[0]!.P);
  });

  it('그룹 조회를 하지 않는다: 프로필의 그룹 키가 무엇이든 결과가 같다', () => {
    const base = runEstimate(caseInput({ groups: CASE_A, excluded: [T_INJECT] }));
    const renamed = runEstimate(
      caseInput({
        groups: [group('TEST_COMPLETELY_OTHER_KEY', { kind: 'FIXED', fixed: 10_000 }, perVisit(250_000))],
        excluded: [T_INJECT],
      }),
    );
    expect(renamed.excludedItems).toEqual(base.excludedItems);
    expect(renamed.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({ state: 'EXCLUDED_CONFIRMED' });
    expect(renamed.amounts).toEqual(base.amounts);
  });
});

describe('AC-008j 제외 지름길 없음', () => {
  it.each(Object.entries(unusableMappingVariants(T_INJECT)))(
    'EXCLUDED 매핑이 사용 불가(%s)이면 EXCLUDED_CONFIRMED 가 아니고 excludedItems 가 비어 있다',
    (_name, variant) => {
      const { groupKey: _dropped, ...rest } = variant.make('TEST_X');
      const excluded: TreatmentCoverageMapping = { ...rest, decision: 'EXCLUDED', exclusionReason: 'TEST_FIXTURE_REASON' };
      const result = runEstimate(caseInput({ groups: CASE_A, mappings: mappingsWith(excluded) }));
      expect(result.excludedItems).toEqual([]);
      expect(result.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({ state: 'ON_HOLD', holdReason: variant.code });
      expect(result.state).toBe('ON_HOLD');
    },
  );

  it('calcClass = NEEDS_REVIEW 는 사용 가능한 EXCLUDED 매핑이 있어도 사용 가능한 COVERED 매핑이 있어도 CLASSIFICATION_NEEDS_REVIEW 이고 제외가 아니다', () => {
    const lines = exampleLines().map((line) => (line.treatmentId === T_INJECT ? { ...line, calcClass: 'NEEDS_REVIEW' as const } : line));
    for (const special of [makeExcludedMapping(T_INJECT), makeMapping(T_INJECT, { groupKey: G_ONE })]) {
      const result = runEstimate(caseInput({ groups: CASE_A, lines, mappings: mappingsWith(special) }));
      expect(result.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({ state: 'ON_HOLD', holdReason: 'CLASSIFICATION_NEEDS_REVIEW' });
      expect(result.excludedItems).toEqual([]);
    }
  });

  it('매핑이 없거나 후보가 모호해도 제외로 추정하지 않는다', () => {
    const none = runEstimate(caseInput({ groups: CASE_A, mappings: ALL.filter((id) => id !== T_INJECT).map((id) => makeMapping(id, { groupKey: G_ONE })) }));
    expect(none.excludedItems).toEqual([]);
    const ambiguous = runEstimate(
      caseInput({ groups: CASE_A, mappings: [...mappingsWith(makeExcludedMapping(T_INJECT, { id: 'TEST_EX' })), makeMapping(T_INJECT, { id: 'TEST_CO', groupKey: G_ONE })] }),
    );
    expect(ambiguous.excludedItems).toEqual([]);
    expect(ambiguous.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({ holdReason: 'MAPPING_INVALID' });
  });
});

describe('AC-008j 필드 규칙 방어 (게시 검증을 거치지 않고 저장소에 직접 넣은 매핑)', () => {
  const bad: Array<[string, TreatmentCoverageMapping]> = [
    ['COVERED 에 groupKey 없음', makeMapping(T_INJECT, { groupKey: undefined as unknown as string })],
    ['COVERED 에 groupKey 빈 문자열', makeMapping(T_INJECT, { groupKey: '' })],
    ['COVERED 에 exclusionReason 있음', makeMapping(T_INJECT, { groupKey: G_ONE, exclusionReason: 'TEST_REASON' })],
    ['EXCLUDED 에 groupKey 있음', makeExcludedMapping(T_INJECT, { groupKey: G_ONE })],
    ['EXCLUDED 에 exclusionReason 없음', makeExcludedMapping(T_INJECT, { exclusionReason: undefined as unknown as string })],
    ['EXCLUDED 에 exclusionReason 빈 문자열', makeExcludedMapping(T_INJECT, { exclusionReason: '' })],
    ['decision 이 두 값 밖', makeMapping(T_INJECT, { decision: 'MAYBE' as unknown as 'COVERED' })],
  ];

  it.each(bad)('%s -> MAPPING_INVALID, ESTIMATED 도 EXCLUDED_CONFIRMED 도 아니다', (_name, mapping) => {
    const result = runEstimate(caseInput({ groups: CASE_A, mappings: mappingsWith(mapping) }));
    expect(result.lines.find((line) => line.treatmentId === T_INJECT)).toMatchObject({ state: 'ON_HOLD', holdReason: 'MAPPING_INVALID' });
    expect(result.excludedItems).toEqual([]);
    expect(result.groups[0]).toMatchObject({ E: 84_000 });
  });
});

describe('보류 줄과 제외 줄이 섞인 입력', () => {
  it('한 입력에 보류·제외·정상이 함께 있어도 보류 줄의 금액은 어느 그룹 E 에도 없다', () => {
    const lines = [makeLine(T_XRAY, 10_000), makeLine(T_ULTRA, 70_000), makeLine(T_PHYSIO, 4_000), makeLine(T_INJECT, 40_000)];
    const mappings = [
      makeMapping(T_XRAY, { groupKey: G_ONE }),
      makeExcludedMapping(T_ULTRA),
      makeMapping(T_PHYSIO, { groupKey: G_ONE }),
      // T_INJECT 매핑 없음 -> 보류
    ];
    const result = runEstimate(caseInput({ groups: [group(G_ONE, { kind: 'FIXED', fixed: 1_000 }, UNLIMITED)], lines, mappings }));
    expect(result.state).toBe('ON_HOLD');
    expect(result.groups[0]).toMatchObject({ E: 14_000, P: 13_000 });
    expect(result.excludedItems.map((item) => item.treatmentId)).toEqual([T_ULTRA]);
    expect(result.holdReasons).toEqual([{ treatmentId: T_INJECT, code: 'MAPPING_ABSENT' }]);
    expect(result.amounts.expectedInsurancePayout).toBeNull();
  });
});
