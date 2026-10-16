import { describe, expect, it } from 'vitest';
import type { TreatmentCoverageMapping } from '../../src/engine/types';
import { validateRuleBundlePublish } from '../../src/server/publish-validate';
import { makeExcludedMapping, makeMapping } from '../fixtures/engine/mappings.fixture';
import { requestOf, resolverOf, validBundleItems } from '../fixtures/server/publish.fixture';
import type { BundleItems } from '../fixtures/server/publish.fixture';
import { setAt, unsetAt } from '../fixtures/server/mutate.fixture';

// 규칙 묶음 게시 검증: 매핑 필드 규칙 (design.md DD-03 "확인된 제외와 줄 상태", AC-011i 첫 번째 항목).
// COVERED ⇒ groupKey 필수·exclusionReason 없음, EXCLUDED ⇒ groupKey 없음·exclusionReason 필수.
// 두 경우 모두 약관 출처 1개 이상과 승인자 기록이 필요하다(머리 검사가 본다). 엔진의 violatesMappingFieldRules 와 같은 판정이다.

const T1 = 'TEST_FIXTURE_TREATMENT_1';

/** 매핑 하나만 바꾼 묶음을 검증한다. 인덱스 0 이 바꾼 매핑이다. */
function checkMapping(mapping: unknown, base: BundleItems = validBundleItems()) {
  const items: BundleItems = { ...base, mappings: [mapping as TreatmentCoverageMapping] };
  return validateRuleBundlePublish(requestOf(items), resolverOf(items));
}

const covered = makeMapping(T1);
const excluded = makeExcludedMapping(T1);

describe('올바른 매핑', () => {
  it('COVERED(groupKey 있음, 사유 없음)는 결함이 없다', () => {
    expect(checkMapping(covered)).toEqual([]);
  });

  it('EXCLUDED(groupKey 없음, 사유 있음)는 결함이 없다', () => {
    expect(checkMapping(excluded)).toEqual([]);
  });

  it('scope 가 빈 배열인 매핑은 어느 칸에도 닿지 않지만 결함이 아니다 [문서에 없음]', () => {
    expect(checkMapping(setAt(covered, ['scope'], []))).toEqual([]);
  });
});

describe('decision (닫힌 두 값)', () => {
  it.each([
    ['소문자', 'covered'],
    ['목록 밖 값', 'NONE'],
    ['빈 문자열', ''],
    ['숫자', 1],
    ['null', null],
    ['불리언', true],
    ['배열', ['COVERED']],
  ])('%s 은 DECISION_INVALID 하나이고 그룹·사유 규칙은 판단하지 않는다', (_name, decision) => {
    expect(checkMapping(setAt(covered, ['decision'], decision))).toEqual([{ code: 'DECISION_INVALID', path: 'bundle.mappings[0].decision' }]);
  });

  it('decision 이 없으면 DECISION_INVALID', () => {
    expect(checkMapping(unsetAt(covered, ['decision']))).toEqual([{ code: 'DECISION_INVALID', path: 'bundle.mappings[0].decision' }]);
  });

  it('decision 이 틀리면 groupKey·exclusionReason 이 어떻든 그 결함 하나다', () => {
    const odd = setAt(setAt(covered, ['decision'], 'MAYBE'), ['exclusionReason'], '사유');
    expect(checkMapping(odd)).toEqual([{ code: 'DECISION_INVALID', path: 'bundle.mappings[0].decision' }]);
  });
});

describe('COVERED 의 필드 규칙', () => {
  it.each([
    ['groupKey 가 없다', () => unsetAt(covered, ['groupKey'])],
    ['groupKey 가 빈 문자열이다', () => setAt(covered, ['groupKey'], '')],
    ['groupKey 가 null 이다', () => setAt(covered, ['groupKey'], null)],
    ['groupKey 가 숫자다', () => setAt(covered, ['groupKey'], 5)],
    ['groupKey 가 배열이다', () => setAt(covered, ['groupKey'], ['TEST_GROUP_BENEFIT'])],
  ])('%s → GROUP_KEY_REQUIRED', (_name, make) => {
    expect(checkMapping(make())).toEqual([{ code: 'GROUP_KEY_REQUIRED', path: 'bundle.mappings[0].groupKey' }]);
  });

  it.each([
    ['사유 문자열', '이건 있으면 안 된다'],
    ['빈 문자열', ''],
    ['null', null],
    ['숫자', 0],
  ])('exclusionReason 이 있으면(%s) EXCLUSION_REASON_FORBIDDEN', (_name, reason) => {
    expect(checkMapping(setAt(covered, ['exclusionReason'], reason))).toEqual([
      { code: 'EXCLUSION_REASON_FORBIDDEN', path: 'bundle.mappings[0].exclusionReason' },
    ]);
  });

  it('둘 다 어기면 groupKey → exclusionReason 순으로 둘 다 보고한다', () => {
    const bad = setAt(unsetAt(covered, ['groupKey']), ['exclusionReason'], '사유');
    expect(checkMapping(bad)).toEqual([
      { code: 'GROUP_KEY_REQUIRED', path: 'bundle.mappings[0].groupKey' },
      { code: 'EXCLUSION_REASON_FORBIDDEN', path: 'bundle.mappings[0].exclusionReason' },
    ]);
  });
});

describe('EXCLUDED 의 필드 규칙', () => {
  it.each([
    ['groupKey 문자열', 'TEST_GROUP_BENEFIT'],
    ['빈 문자열', ''],
    ['null', null],
  ])('groupKey 가 있으면(%s) GROUP_KEY_FORBIDDEN', (_name, groupKey) => {
    expect(checkMapping(setAt(excluded, ['groupKey'], groupKey))).toEqual([{ code: 'GROUP_KEY_FORBIDDEN', path: 'bundle.mappings[0].groupKey' }]);
  });

  it.each([
    ['사유가 없다', () => unsetAt(excluded, ['exclusionReason'])],
    ['사유가 빈 문자열이다', () => setAt(excluded, ['exclusionReason'], '')],
    ['사유가 null 이다', () => setAt(excluded, ['exclusionReason'], null)],
    ['사유가 숫자다', () => setAt(excluded, ['exclusionReason'], 3)],
  ])('%s → EXCLUSION_REASON_REQUIRED', (_name, make) => {
    expect(checkMapping(make())).toEqual([{ code: 'EXCLUSION_REASON_REQUIRED', path: 'bundle.mappings[0].exclusionReason' }]);
  });

  it('둘 다 어기면 groupKey → exclusionReason 순으로 둘 다 보고한다', () => {
    const bad = setAt(unsetAt(excluded, ['exclusionReason']), ['groupKey'], 'TEST_GROUP_BENEFIT');
    expect(checkMapping(bad)).toEqual([
      { code: 'GROUP_KEY_FORBIDDEN', path: 'bundle.mappings[0].groupKey' },
      { code: 'EXCLUSION_REASON_REQUIRED', path: 'bundle.mappings[0].exclusionReason' },
    ]);
  });

  it('공백뿐인 사유는 엔진의 필드 규칙과 같이 "비어 있지 않음"이다 (엔진 판정과 어긋나지 않는다)', () => {
    expect(checkMapping(setAt(excluded, ['exclusionReason'], '   '))).toEqual([]);
  });
});

describe('두 결정 모두 약관 출처 1개 이상과 승인자 기록이 필요하다 (EXCLUDED 도 COVERED 와 똑같이)', () => {
  it.each([
    ['COVERED', covered],
    ['EXCLUDED', excluded],
  ])('%s: 약관 출처가 비면 POLICY_SOURCES_MISSING', (_decision, mapping) => {
    expect(checkMapping(setAt(mapping, ['policySources'], []))).toEqual([{ code: 'POLICY_SOURCES_MISSING', path: 'bundle.mappings[0].policySources' }]);
  });

  it.each([
    ['COVERED', covered],
    ['EXCLUDED', excluded],
  ])('%s: 승인자 기록이 없으면 APPROVER_MISSING', (_decision, mapping) => {
    expect(checkMapping(setAt(mapping, ['approver'], null))).toEqual([{ code: 'APPROVER_MISSING', path: 'bundle.mappings[0].approver' }]);
  });
});

describe('scope (엔진 매핑 조회가 읽는 모양)', () => {
  it.each([
    ['배열이 아니다', null],
    ['배열이 아니다(객체)', {}],
    ['배열이 아니다(문자열)', 'GEN4_C4'],
  ])('scope 가 %s → SCOPE_INVALID', (_name, scope) => {
    expect(checkMapping(setAt(covered, ['scope'], scope))).toEqual([{ code: 'SCOPE_INVALID', path: 'bundle.mappings[0].scope' }]);
  });

  it('scope 항목이 객체가 아니면 그 항목이 SCOPE_INVALID', () => {
    expect(checkMapping(setAt(covered, ['scope'], [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }, null, 5]))).toEqual([
      { code: 'SCOPE_INVALID', path: 'bundle.mappings[0].scope[1]' },
      { code: 'SCOPE_INVALID', path: 'bundle.mappings[0].scope[2]' },
    ]);
  });

  it('generation·insurerType 이 목록 밖이면 그 필드 경로가 붙는다', () => {
    const bad = setAt(covered, ['scope'], [{ generation: 'GEN9', insurerType: 'BANK' }]);
    expect(checkMapping(bad)).toEqual([
      { code: 'SCOPE_INVALID', path: 'bundle.mappings[0].scope[0].generation' },
      { code: 'SCOPE_INVALID', path: 'bundle.mappings[0].scope[0].insurerType' },
    ]);
  });

  it('모든 세대와 보험사 형태 열다섯 칸이 유효한 scope 이다', () => {
    const generations = ['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4'];
    const types = ['NON_LIFE', 'LIFE', 'MUTUAL_AID'];
    const scope = generations.flatMap((generation) => types.map((insurerType) => ({ generation, insurerType })));
    expect(scope).toHaveLength(15);
    expect(checkMapping(setAt(covered, ['scope'], scope))).toEqual([]);
  });
});

describe('매핑 여러 개의 인덱스', () => {
  it('둘째 매핑의 결함은 mappings[1] 로 보고한다', () => {
    const base = validBundleItems();
    const items: BundleItems = { ...base, mappings: [base.mappings[0]!, setAt(excluded, ['id'], 'TEST_FIXTURE_M2') as TreatmentCoverageMapping] };
    const bad: BundleItems = { ...items, mappings: [items.mappings[0]!, unsetAt(items.mappings[1]!, ['exclusionReason'])] };
    expect(validateRuleBundlePublish(requestOf(bad), resolverOf(bad))).toEqual([{ code: 'EXCLUSION_REASON_REQUIRED', path: 'bundle.mappings[1].exclusionReason' }]);
  });
});
