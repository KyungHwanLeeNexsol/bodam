import { describe, expect, it } from 'vitest';
import { checkDocumentRuleSetStructure } from '../../src/engine/documents';
import type { DocumentRule, DocumentRuleSet } from '../../src/engine/types';
import { documentRuleSetToRuleItem, isUsable } from '../../src/engine/usability';
import { canonicalDigest } from '../../src/server/digest';
import { validateRuleBundlePublish } from '../../src/server/publish-validate';
import { TEST_AT } from '../fixtures/engine/profiles.fixture';
import { plainRule } from '../fixtures/engine/document-rules.fixture';
import { requestOf, resolverOf, sealedRuleSet } from '../fixtures/server/publish.fixture';
import type { BundleItems } from '../fixtures/server/publish.fixture';

// 규칙 묶음 게시 검증: 서류 규칙 묶음 (AC-007f 의 게시 쪽). 구조·`when` 계약은 엔진 checkDocumentRuleSetStructure 를 그대로 부르고
// 경로에 `bundle.documentRuleSet.` 접두어만 붙인다. 엔진의 구조 표는 다시 시험하지 않는다 — 결함 코드마다 한 건씩 배선과 경로 접두어만 본다.
// 이 파일이 게시 쪽에서만 보는 것: 머리 정보 배선, 봉인(내용 해시), 그리고 거절하지 않는 것(빈 rules, 전용 줄 수 등).

const D = 'bundle.documentRuleSet';

/** 서류 규칙 묶음 하나만 담은 묶음을 검증한다. 규칙 목록은 그대로 봉인한다(구조가 틀려도 봉인은 맞춘다). */
function check(ruleSet: unknown) {
  const items: BundleItems = { profiles: [], mappings: [], documentRuleSet: ruleSet as DocumentRuleSet };
  return validateRuleBundlePublish(requestOf(items), resolverOf(items));
}

const ok = (overrides: Partial<DocumentRule> = {}): DocumentRule => ({ documentCode: 'RECEIPT', when: {}, reason: '시험 사유', priority: 1, ...overrides });
const withRules = (rules: unknown[]): DocumentRuleSet => sealedRuleSet(rules as DocumentRule[]);

describe('서류 규칙 묶음이 없는 묶음', () => {
  it('documentRuleSet = null 이면 서류 규칙 묶음 검사는 건너뛴다', () => {
    expect(validateRuleBundlePublish({ profiles: [], mappings: [], documentRuleSet: null }, resolverOf({ profiles: [], mappings: [], documentRuleSet: null }))).toEqual([]);
  });
});

describe('거절하지 않는 것 (design.md DD-06 "규칙 평가" 9번)', () => {
  it('기획서 예시 규칙 묶음은 결함이 없다', () => {
    expect(check(sealedRuleSet())).toEqual([]);
  });

  it('규칙이 하나도 없는 rules: [] 는 거절 사유가 아니다', () => {
    expect(check(withRules([]))).toEqual([]);
  });

  it('when: {} 와 priority 0, Number.MAX_SAFE_INTEGER 는 허용한다', () => {
    expect(check(withRules([ok({ priority: 0 }), ok({ priority: Number.MAX_SAFE_INTEGER, documentCode: 'ITEMIZED_STATEMENT' })]))).toEqual([]);
  });

  it('상해 전용 줄이 여러 줄 나오는 묶음도 게시된다 (전용 줄의 수는 거절 사유가 아니다)', () => {
    const injuryOnly = (documentCode: DocumentRule['documentCode']): DocumentRule => ok({ documentCode, when: { cause: 'INJURY' } });
    const illnessOnly = (documentCode: DocumentRule['documentCode']): DocumentRule => ok({ documentCode, when: { cause: 'ILLNESS' } });
    const set = withRules([
      injuryOnly('DIAGNOSIS_CERT'),
      injuryOnly('INITIAL_EXAM_RECORD'),
      injuryOnly('MEDICAL_OPINION'),
      illnessOnly('IMAGING_READING'),
      illnessOnly('BIOPSY_RESULT'),
      illnessOnly('TREATMENT_CONFIRMATION'),
    ]);
    expect(check(set)).toEqual([]);
  });

  it('앞뒤에 공백이 붙은 유효한 사유는 허용하고 원문을 바꾸지 않는다', () => {
    const set = withRules([ok({ reason: '  앞뒤 공백 사유  ' })]);
    expect(check(set)).toEqual([]);
    expect(set.rules[0]?.reason).toBe('  앞뒤 공백 사유  ');
  });
});

describe('구조·when 계약 — 엔진 checkDocumentRuleSetStructure 의 결함 코드마다 한 건 (배선과 경로 접두어)', () => {
  const cases: Array<[string, string, unknown[]]> = [
    ['RULE_ENTRY_INVALID', 'rules[1]', [ok(), null]],
    ['DOCUMENT_CODE_INVALID', 'rules[0].documentCode', [ok({ documentCode: 'XRAY_REPORT' as never })]],
    ['REASON_INVALID', 'rules[0].reason', [ok({ reason: '' })]],
    ['PRIORITY_INVALID', 'rules[0].priority', [ok({ priority: -1 })]],
    ['WHEN_NOT_OBJECT', 'rules[2].when', [ok(), ok(), ok({ when: null as never })]],
    ['WHEN_UNKNOWN_KEY', 'rules[0].when.region', [ok({ when: { region: 'KR' } as never })]],
    ['WHEN_VALUE_INVALID', 'rules[0].when.imaging', [ok({ when: { imaging: false } as never })]],
  ];

  it.each(cases)('%s → %s 경로로 보고하고 엔진 판정과 같다', (code, relativePath, rules) => {
    const ruleSet = withRules(rules);
    const engine = checkDocumentRuleSetStructure(ruleSet);
    expect(engine.ok).toBe(false);
    const engineDefects = engine.ok ? [] : engine.defects;
    expect(check(ruleSet)).toEqual(engineDefects.map((defect) => ({ code: defect.code, path: `${D}.${defect.path}` })));
    expect(check(ruleSet)).toContainEqual({ code, path: `${D}.${relativePath}` });
  });

  it('rules 가 배열이 아니면 RULES_NOT_ARRAY 하나', () => {
    for (const garbage of [null, {}, 'x', 5]) {
      expect(check(sealedRuleSet(garbage as never))).toEqual([{ code: 'RULES_NOT_ARRAY', path: `${D}.rules` }]);
    }
  });

  it.each([
    ['공백', ' '],
    ['탭', '\t'],
    ['줄바꿈', '\n'],
    ['CRLF', '\r\n'],
    ['NBSP', ' '],
    ['표의 공백(U+3000)', '　'],
    ['섞인 공백', ' \t\n　'],
  ])('공백뿐인 reason(%s)은 빈 문자열과 같은 REASON_INVALID 이다', (_name, reason) => {
    expect(check(withRules([ok(), ok({ reason })]))).toEqual([{ code: 'REASON_INVALID', path: `${D}.rules[1].reason` }]);
  });

  it.each([
    ['0 미만', -1],
    ['소수', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['안전 정수 초과', Number.MAX_SAFE_INTEGER + 1],
    ['문자열', '5'],
  ])('priority %s → PRIORITY_INVALID', (_name, priority) => {
    expect(check(withRules([ok({ priority: priority as never })]))).toEqual([{ code: 'PRIORITY_INVALID', path: `${D}.rules[0].priority` }]);
  });

  it('플래그 키는 true 만 유효하다: false · 1 · "true" · null 각각 WHEN_VALUE_INVALID', () => {
    for (const bad of [false, 1, 'true', null]) {
      expect(check(withRules([ok({ when: { biopsy: bad } as never })]))).toEqual([{ code: 'WHEN_VALUE_INVALID', path: `${D}.rules[0].when.biopsy` }]);
    }
  });

  it('여러 규칙의 결함은 규칙 순서대로 한 번에 모두 보고한다', () => {
    const set = withRules([ok({ priority: -5 }), ok(), ok({ reason: ' ', documentCode: 'NOPE' as never })]);
    expect(check(set).map((defect) => defect.path)).toEqual([`${D}.rules[0].priority`, `${D}.rules[2].documentCode`, `${D}.rules[2].reason`]);
  });
});

describe('머리 정보 배선 (서류 규칙 묶음)', () => {
  it('약관 출처가 비면 POLICY_SOURCES_MISSING', () => {
    expect(check({ ...sealedRuleSet(), policySources: [] })).toEqual([{ code: 'POLICY_SOURCES_MISSING', path: `${D}.policySources` }]);
  });

  it('승인자 기록이 없으면 APPROVER_MISSING', () => {
    expect(check({ ...sealedRuleSet(), approver: null })).toEqual([{ code: 'APPROVER_MISSING', path: `${D}.approver` }]);
  });

  it('origin 이 목록 밖이면 VALUE_INVALID', () => {
    expect(check({ ...sealedRuleSet(), origin: 'PROD' })).toEqual([{ code: 'VALUE_INVALID', path: `${D}.origin` }]);
  });
});

describe('봉인 (AC-011a 의 서류 규칙 묶음 쪽)', () => {
  const ctx = { at: TEST_AT, acceptedOrigins: ['TEST_FIXTURE'] as const, digest: canonicalDigest };
  const engineIntegrity = (ruleSet: DocumentRuleSet): 'OK' | 'MISMATCH' => {
    const verdict = isUsable(documentRuleSetToRuleItem(ruleSet), ctx);
    return verdict.usable || verdict.reason !== 'INTEGRITY_MISMATCH' ? 'OK' : 'MISMATCH';
  };
  const publishIntegrity = (ruleSet: DocumentRuleSet): 'OK' | 'MISMATCH' => (check(ruleSet).some((defect) => defect.code === 'INTEGRITY_MISMATCH') ? 'MISMATCH' : 'OK');

  const sealed = sealedRuleSet();

  it('원래 순서의 해시는 rules 를 다른 순서로 저장한 같은 묶음에서도 통과한다 (규칙의 위치는 의미가 없다)', () => {
    const shuffled: DocumentRuleSet = { ...sealed, rules: [...sealed.rules].reverse() };
    expect(shuffled.contentHash).toBe(sealed.contentHash);
    expect(check(shuffled)).toEqual([]);
    expect(engineIntegrity(shuffled)).toBe('OK');
  });

  it('실제 규칙 내용이 바뀌면 옛 해시로는 실패한다', () => {
    const first = sealed.rules[0] as DocumentRule;
    const changed: Array<[string, DocumentRuleSet]> = [
      ['사유 문구', { ...sealed, rules: [{ ...first, reason: `${first.reason}!` }, ...sealed.rules.slice(1)] }],
      ['우선순위', { ...sealed, rules: [{ ...first, priority: first.priority + 1 }, ...sealed.rules.slice(1)] }],
      ['조건', { ...sealed, rules: [{ ...first, when: { cause: 'INJURY' } }, ...sealed.rules.slice(1)] }],
      ['규칙 삭제', { ...sealed, rules: sealed.rules.slice(1) }],
      ['규칙 추가', { ...sealed, rules: [...sealed.rules, plainRule('RECEIPT', {}, '추가', 9)] }],
      ['버전', { ...sealed, version: 'v2' }],
    ];
    for (const [, tampered] of changed) {
      expect(publishIntegrity(tampered)).toBe('MISMATCH');
      expect(engineIntegrity(tampered)).toBe('MISMATCH');
      expect(check(tampered)).toContainEqual({ code: 'INTEGRITY_MISMATCH', path: `${D}.contentHash` });
    }
  });

  it('머리 정보는 해시 입력이 아니므로 승인자·출처·상태가 달라도 봉인은 유지된다', () => {
    const header: DocumentRuleSet = { ...sealed, state: 'DRAFT', origin: 'DEMO', validity: { from: '2001-01-01', to: '2001-12-31' } };
    expect(check(header)).toEqual([]);
  });

  it('구조가 틀린 규칙도 고쳐 쓰지 않고 그대로 봉인한 값과 비교한다 (구조 결함과 봉인 결함이 따로 나온다)', () => {
    const broken = withRules([ok(), null]);
    expect(check(broken)).toEqual([{ code: 'RULE_ENTRY_INVALID', path: `${D}.rules[1]` }]);
    expect(check({ ...broken, contentHash: 'TEST_FIXTURE_X' })).toEqual([
      { code: 'INTEGRITY_MISMATCH', path: `${D}.contentHash` },
      { code: 'RULE_ENTRY_INVALID', path: `${D}.rules[1]` },
    ]);
  });
});
