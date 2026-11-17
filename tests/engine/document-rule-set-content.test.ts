import { describe, expect, it } from 'vitest';
import type { DocumentRule, DocumentRuleSet } from '../../src/engine/types';
import { documentRuleSetContent, documentRuleSetToRuleItem, isUsable } from '../../src/engine/usability';
import type { UsabilityContext } from '../../src/engine/usability';
import { plainRule, rule, ruleSetOf, withValidDocumentHash } from '../fixtures/engine/document-rules.fixture';
import { TEST_AT, testDigest } from '../fixtures/engine/profiles.fixture';

// M2.A: 서류 규칙 묶음 내용 해시의 입력은 rules 를 총순서(documentCode → priority → reason → when 키)로 정렬한 사본이다
// (프로필의 R2 외부 검토 교훈: 해시 입력이 배열 순서에 의존하면 같은 규칙인데 INTEGRITY_MISMATCH 가 난다).
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 서류 요건이 아니다.

const ctx: UsabilityContext = { at: TEST_AT, acceptedOrigins: ['OPERATING', 'TEST_FIXTURE'], digest: testDigest };

// 같은 documentCode 에서 priority·reason·when 이 차례로 순서를 가르도록 만든 네 규칙. 저장 순서는 정렬 순서와 다르다.
const R_RECEIPT = plainRule('RECEIPT', {}, 'B', 2);
const R_ILLNESS = plainRule('DIAGNOSIS_CERT', { cause: 'ILLNESS' }, 'A', 1);
const R_INJURY = plainRule('DIAGNOSIS_CERT', { cause: 'INJURY' }, 'A', 1);
const R_FIRST = plainRule('DIAGNOSIS_CERT', {}, 'A', 0);
const STORED = [R_RECEIPT, R_ILLNESS, R_INJURY, R_FIRST];
/** 오라클: 규칙 네 개를 손으로 정렬한 기대 순서 (DIAGNOSIS_CERT < RECEIPT; 우선순위 0 < 1; 같으면 when 키 ILLNESS < INJURY). */
const SORTED = [R_FIRST, R_ILLNESS, R_INJURY, R_RECEIPT];

const original = ruleSetOf(STORED);
const ORIGINAL_HASH = original.contentHash;

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** 옛 해시를 그대로 둔 채 내용만 바꾼 묶음. 해시를 다시 만들지 않는다. */
function withOldHash(changes: Partial<DocumentRuleSet>): DocumentRuleSet {
  return { ...original, ...changes, contentHash: ORIGINAL_HASH };
}

function usable(ruleSet: DocumentRuleSet) {
  return isUsable(documentRuleSetToRuleItem(ruleSet), ctx);
}

function rulesOf(content: unknown): unknown {
  return (content as { rules: unknown }).rules;
}

describe('기준 묶음 확인 (빈 시험 방지)', () => {
  it('저장 순서는 정렬 순서와 다르고, 해시는 독립적으로 정렬한 내용의 해시와 같다', () => {
    expect(original.rules).toEqual(STORED);
    expect(original.rules).not.toEqual(SORTED);
    // 오라클: 손으로 정렬한 내용의 해시. documentRuleSetContent 를 거치지 않는다.
    expect(ORIGINAL_HASH).toBe(testDigest({ id: original.id, version: original.version, rules: SORTED }));
    expect(usable(original)).toEqual({ usable: true });
  });
});

describe('documentRuleSetContent — 정렬한 사본', () => {
  it('내용은 id, version, rules 세 필드뿐이다 (머리 정보와 contentHash 는 뺀다)', () => {
    const content = documentRuleSetContent(original) as Record<string, unknown>;
    expect(Object.keys(content).sort()).toEqual(['id', 'rules', 'version']);
    expect(content.id).toBe(original.id);
    expect(content.version).toBe(original.version);
  });

  it('rules 는 documentCode → priority → reason → when 키 순으로 정렬되고 사본이다', () => {
    const rules = rulesOf(documentRuleSetContent(original)) as DocumentRule[];
    expect(rules).toEqual(SORTED);
    expect(rules).not.toBe(original.rules);
    expect(original.rules).toEqual(STORED); // 원본의 순서는 그대로다
    // 항목은 복사하지 않고 같은 객체를 가리킨다 (항목을 바꾸지 않는다)
    expect(rules.every((entry) => original.rules.includes(entry))).toBe(true);
  });

  it('깊이 동결한 입력도 던지지 않고 바꾸지 않는다', () => {
    const frozen = deepFreeze(ruleSetOf(STORED.map((entry) => ({ ...entry, when: { ...entry.when } }))));
    const before = JSON.stringify(frozen);
    const rules = rulesOf(documentRuleSetContent(frozen)) as DocumentRule[];
    expect(rules.map((entry) => entry.documentCode)).toEqual(['DIAGNOSIS_CERT', 'DIAGNOSIS_CERT', 'DIAGNOSIS_CERT', 'RECEIPT']);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('문서 코드는 코드 포인트 순으로 가른다 (영문 대문자 사전순)', () => {
    const codes = ['RECEIPT', 'BIOPSY_RESULT', 'MEDICAL_OPINION', 'IMAGING_READING'] as const;
    const rules = codes.map((code) => plainRule(code, {}, 'x', 1));
    expect((rulesOf(documentRuleSetContent(ruleSetOf(rules))) as DocumentRule[]).map((entry) => entry.documentCode)).toEqual([
      'BIOPSY_RESULT',
      'IMAGING_READING',
      'MEDICAL_OPINION',
      'RECEIPT',
    ]);
  });

  it('priority 는 숫자 오름차순이고 숫자가 아닌 값은 모든 숫자 뒤에 온다 (NaN·문자열·undefined, 숫자끼리는 Infinity 까지 비교된다)', () => {
    const priorities: unknown[] = [Number.MAX_SAFE_INTEGER, 'x', 1, Number.NaN, 0, undefined, Number.POSITIVE_INFINITY, 1];
    const rules = priorities.map((priority, index) => ({ ...plainRule('RECEIPT', {}, `r${index}`, 0), priority }) as unknown as DocumentRule);
    const sorted = rulesOf(documentRuleSetContent(ruleSetOf(rules))) as DocumentRule[];
    // 숫자: 0 → 1(r2) → 1(r7) → MAX → Infinity, 그다음 숫자가 아닌 값 셋은 reason 순(r1 'x', r3 NaN, r5 undefined)
    expect(sorted.map((entry) => (entry.reason))).toEqual(['r4', 'r2', 'r7', 'r0', 'r6', 'r1', 'r3', 'r5']);
  });

  it('priority 가 같으면 reason 의 유니코드 코드 포인트 순이다 (UTF-16 코드 유닛 순과 갈리는 쌍 포함)', () => {
    const tilde = String.fromCodePoint(0xff5e); // U+FF5E 한 글자
    const emoji = String.fromCodePoint(0x1f600); // U+1F600 한 글자 (UTF-16 에서는 서로게이트 쌍)
    // 코드 포인트 순: U+FF5E < U+1F600. 코드 유닛 순이면 D83D(이모지) < FF5E(물결표)라 뒤집힌다.
    expect(tilde < emoji).toBe(false);
    const rules = [plainRule('RECEIPT', {}, emoji, 1), plainRule('RECEIPT', {}, tilde, 1)];
    const sorted = rulesOf(documentRuleSetContent(ruleSetOf(rules))) as DocumentRule[];
    expect(sorted.map((entry) => entry.reason)).toEqual([tilde, emoji]);
  });

  it('documentCode·priority·reason 이 모두 같으면 when 키가 가른다 (키 삽입 순서와 무관한 키)', () => {
    const a = plainRule('RECEIPT', { imaging: true, cause: 'INJURY' }, 'x', 1);
    const b = plainRule('RECEIPT', { cause: 'INJURY', biopsy: true }, 'x', 1);
    const keyOrderSwapped = plainRule('RECEIPT', { cause: 'INJURY', imaging: true }, 'x', 1);
    // when 키: a → "cause=string:INJURY;imaging=boolean:true", b → "biopsy=boolean:true;cause=string:INJURY" (b 가 앞)
    const sorted = rulesOf(documentRuleSetContent(ruleSetOf([a, b]))) as DocumentRule[];
    expect(sorted).toEqual([b, a]);
    expect(rulesOf(documentRuleSetContent(ruleSetOf([keyOrderSwapped, b])))).toEqual([b, keyOrderSwapped]);
  });

  it('when 이 객체가 아니거나 값이 객체여도 던지지 않고 결정적이다 (빈 키, 종류만 쓰는 키)', () => {
    const noWhen = { ...plainRule('RECEIPT', {}, 'x', 1), when: null } as unknown as DocumentRule;
    const nested = { ...plainRule('RECEIPT', {}, 'x', 1), when: { cause: { deep: 1 } } } as unknown as DocumentRule;
    const plain = plainRule('RECEIPT', { cause: 'ILLNESS' }, 'x', 1);
    const run = (rules: DocumentRule[]) => rulesOf(documentRuleSetContent(ruleSetOf(rules))) as DocumentRule[];
    // null when → '' (가장 앞), 객체 값 → 'cause=object:' , 문자열 값 → 'cause=string:ILLNESS'
    expect(run([plain, nested, noWhen])).toEqual([noWhen, nested, plain]);
    expect(run([noWhen, plain, nested])).toEqual([noWhen, nested, plain]);
  });

  it('문자열이 아닌 documentCode·reason 도 던지지 않고 빈 문자열 키로 앞에 둔다 (고치지 않는다)', () => {
    const badCode = { ...plainRule('RECEIPT', {}, 'x', 1), documentCode: 7 } as unknown as DocumentRule;
    const badReason = { ...plainRule('RECEIPT', {}, 'x', 1), reason: null } as unknown as DocumentRule;
    const good = plainRule('RECEIPT', {}, 'x', 1);
    const sorted = rulesOf(documentRuleSetContent(ruleSetOf([good, badCode, badReason]))) as DocumentRule[];
    expect(sorted[0]).toBe(badCode);
    expect(sorted.slice(1)).toEqual([badReason, good]);
    expect(badCode.documentCode).toBe(7);
  });
});

describe('배열 순서에 의존하지 않는 해시 (R2 교훈)', () => {
  it('규칙 네 개의 모든 순열(24가지)이 원래 해시 그대로 사용 가능 판정을 통과한다 (해시를 다시 만들지 않는다)', () => {
    const all = permutations(STORED);
    expect(all).toHaveLength(24);
    for (const order of all) {
      const reordered = withOldHash({ rules: order });
      expect(usable(reordered), order.map((entry) => entry.reason + entry.priority).join(',')).toEqual({ usable: true });
      expect(testDigest(documentRuleSetContent(reordered))).toBe(ORIGINAL_HASH);
    }
  });

  it('같은 규칙을 다시 봉인해도 순서만 다르면 같은 해시다', () => {
    expect(ruleSetOf([...STORED].reverse()).contentHash).toBe(ORIGINAL_HASH);
  });

  it('머리 정보(state, origin, validity, policySources, approver)를 바꿔도 해시 입력은 같다', () => {
    const changed: DocumentRuleSet = { ...original, state: 'DRAFT', origin: 'DEMO', validity: { from: '2000-01-01', to: '2000-01-02' }, policySources: [], approver: null };
    expect(testDigest(documentRuleSetContent(changed))).toBe(ORIGINAL_HASH);
  });
});

describe('실제 내용이 바뀌면 옛 해시와 어긋난다 (INTEGRITY_MISMATCH)', () => {
  const changedRule = (index: number, change: Partial<DocumentRule>): DocumentRule[] => STORED.map((entry, at) => (at === index ? { ...entry, ...change } : entry));
  const cases: Array<[string, DocumentRuleSet]> = [
    ['reason 한 글자', withOldHash({ rules: changedRule(0, { reason: 'B2' }) })],
    ['priority', withOldHash({ rules: changedRule(1, { priority: 3 }) })],
    ['documentCode', withOldHash({ rules: changedRule(2, { documentCode: 'ITEMIZED_STATEMENT' }) })],
    ['when 값', withOldHash({ rules: changedRule(1, { when: { cause: 'INJURY' } }) })],
    ['when 키 추가', withOldHash({ rules: changedRule(3, { when: { imaging: true } }) })],
    ['규칙 추가', withOldHash({ rules: [...STORED, rule('MEDICAL_OPINION', {}, 'x', 1)] })],
    ['규칙 삭제', withOldHash({ rules: STORED.slice(1) })],
    ['규칙 중복 추가', withOldHash({ rules: [...STORED, R_RECEIPT] })],
    ['id', withOldHash({ id: 'TEST_DOCUMENT_RULES_OTHER' })],
    ['version', withOldHash({ version: 'v2' })],
  ];

  it.each(cases)('%s → INTEGRITY_MISMATCH', (_label, changed) => {
    expect(usable(changed)).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  });

  it('다시 봉인하면 다시 사용 가능하다', () => {
    const resealed = withValidDocumentHash(withOldHash({ rules: STORED.slice(1) }));
    expect(usable(resealed)).toEqual({ usable: true });
  });
});

describe('잘못된 모양은 던지지 않고 고치지 않는다', () => {
  const shapes: Array<[string, unknown]> = [
    ['rules = null', null],
    ['rules = undefined', undefined],
    ['rules = 객체', { 0: R_FIRST, length: 1 }],
    ['rules = 문자열', 'abc'],
    ['rules = 숫자', 7],
  ];

  it.each(shapes)('%s: 받은 값 그대로, documentRuleSetContent·documentRuleSetToRuleItem 모두 던지지 않는다', (_label, rules) => {
    const malformed = { ...original, rules } as unknown as DocumentRuleSet;
    expect(rulesOf(documentRuleSetContent(malformed))).toBe(rules);
    const item = documentRuleSetToRuleItem(malformed);
    expect(item.kind).toBe('DOCUMENT_RULE_SET');
    expect(rulesOf((item as { content: unknown }).content)).toBe(rules);
  });

  const entries: Array<[string, unknown]> = [
    ['null 항목', null],
    ['undefined 항목', undefined],
    ['숫자 항목', 7],
    ['문자열 항목', 'x'],
    ['배열 항목', [R_FIRST]],
    ['불리언 항목', true],
  ];

  it.each(entries)('%s: 정렬하지 않고 받은 배열 그대로 둔다 (유효해 보이게 고치지 않는다)', (_label, entry) => {
    const rules = [R_RECEIPT, entry, R_FIRST] as unknown as DocumentRule[];
    const content = documentRuleSetContent({ ...original, rules });
    expect(rulesOf(content)).toBe(rules);
    expect(rules[0]).toBe(R_RECEIPT); // 순서도 그대로
    expect(rules[2]).toBe(R_FIRST);
  });

  it('희소 배열의 빈 칸도 던지지 않는다', () => {
    const rules = [R_RECEIPT, , R_FIRST] as unknown as DocumentRule[];
    expect(rulesOf(documentRuleSetContent({ ...original, rules }))).toBe(rules);
  });

  it('잘못된 모양의 묶음은 봉인이 맞아도 사용 가능 판정을 지나지만 해시가 입력을 고치지 않는다 (구조 검사가 거절한다)', () => {
    const sealed = ruleSetOf([R_RECEIPT, null as unknown as DocumentRule, R_FIRST]);
    expect(usable(sealed)).toEqual({ usable: true });
    expect(sealed.rules[1]).toBeNull();
    // 순서를 바꾸면 해시 입력도 바뀐다: 고치지 않으므로 순서 의존이 남는다 (어차피 구조 검사가 거절한다)
    const swapped = { ...sealed, rules: [R_FIRST, null as unknown as DocumentRule, R_RECEIPT] };
    expect(usable(swapped)).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  });
});

describe('documentRuleSetToRuleItem — RuleItem 으로 펼치기', () => {
  it('kind 는 DOCUMENT_RULE_SET 이고 머리 정보·해시를 그대로, 내용은 documentRuleSetContent 로 채운다', () => {
    const item = documentRuleSetToRuleItem(original);
    expect(item).toEqual({
      kind: 'DOCUMENT_RULE_SET',
      state: original.state,
      origin: original.origin,
      validity: original.validity,
      policySources: original.policySources,
      approver: original.approver,
      contentHash: original.contentHash,
      content: documentRuleSetContent(original),
    });
  });
});
