import { describe, expect, it } from 'vitest';
import { checkDocumentRuleSetStructure } from '../../src/engine/documents';
import type { DocumentRuleSetDefect } from '../../src/engine/documents';
import { DOCUMENT_CODE_LINE } from '../../src/engine/types';
import type { DocumentRule, DocumentRuleSet } from '../../src/engine/types';
import {
  NO_CAUSE_LINES_OUTCOME,
  planningExampleRuleSet,
  plainRule,
  ruleSetNoCauseLines,
  ruleSetOf,
  ruleSetTwoInjuryThreeIllness,
  ruleSetZeroInjuryFourIllness,
  rule,
} from '../fixtures/engine/document-rules.fixture';

// M2.A: 서류 규칙 묶음의 구조 검사 (design.md DD-06 "규칙 평가" 9번, REQ-DATA-005, AC-007f).
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 서류 요건이 아니다.

const GOOD: DocumentRule = plainRule('RECEIPT', {}, '시험 사유', 1);

/** 규칙 한 개를 index 1 에 두고 앞뒤로 유효한 규칙을 놓아 경로의 인덱스가 규칙 위치를 따르는지 함께 본다. */
function setWith(entry: unknown): DocumentRuleSet {
  // 봉인하지 않는다: 구조 검사는 해시를 보지 않으며, BigInt 같은 값은 시험용 해시 대역이 직렬화하지 못한다.
  return { ...ruleSetOf([GOOD]), rules: [GOOD, entry as DocumentRule, GOOD] };
}

function check(ruleSet: unknown) {
  return checkDocumentRuleSetStructure(ruleSet);
}

function defectsOf(ruleSet: unknown): DocumentRuleSetDefect[] {
  const result = check(ruleSet);
  return result.ok ? [] : result.defects;
}

function ruleWith(change: Record<string, unknown>): DocumentRule {
  return { ...GOOD, ...change } as unknown as DocumentRule;
}

function whenWith(when: unknown): DocumentRule {
  return ruleWith({ when });
}

describe('유효한 묶음', () => {
  it('정상 규칙 묶음은 ok 이고 when: {} 도 유효하다', () => {
    expect(check(ruleSetOf([GOOD]))).toEqual({ ok: true });
    expect(check(ruleSetOf([whenWith({})]))).toEqual({ ok: true });
  });

  it('닫힌 10종 문서 코드가 모두 유효하다', () => {
    for (const code of Object.keys(DOCUMENT_CODE_LINE)) {
      expect(check(ruleSetOf([ruleWith({ documentCode: code })])), code).toEqual({ ok: true });
    }
  });

  it('when 의 여섯 키가 모두 유효한 값이면 ok 다 (열거 값 전수, 플래그는 true)', () => {
    expect(check(ruleSetOf([whenWith({ cause: 'INJURY', setting: 'OUTPATIENT', insurerType: 'NON_LIFE', imaging: true, biopsy: true, opinionRequired: true })]))).toEqual({ ok: true });
    for (const cause of ['INJURY', 'ILLNESS']) expect(check(ruleSetOf([whenWith({ cause })])), cause).toEqual({ ok: true });
    for (const setting of ['OUTPATIENT', 'INPATIENT']) expect(check(ruleSetOf([whenWith({ setting })])), setting).toEqual({ ok: true });
    for (const insurerType of ['NON_LIFE', 'LIFE', 'MUTUAL_AID']) expect(check(ruleSetOf([whenWith({ insurerType })])), insurerType).toEqual({ ok: true });
  });

  it('규칙이 하나도 없는 rules: [] 는 구조 결함이 아니다 (결정: 게시 검증 목록에 없다)', () => {
    expect(check(ruleSetOf([]))).toEqual({ ok: true });
  });

  it('규칙의 수와 전용 줄의 수는 결함이 아니다: 상해 전용 20줄처럼 많은 규칙도 ok 다', () => {
    const many = Array.from({ length: 40 }, (_unused, index) => plainRule('INITIAL_EXAM_RECORD', { cause: 'INJURY' }, `시험 사유 ${index}`, index));
    expect(check(ruleSetOf(many))).toEqual({ ok: true });
  });

  it('같은 규칙을 거듭 두어도(중복) 구조 결함이 아니다', () => {
    expect(check(ruleSetOf([GOOD, GOOD, GOOD]))).toEqual({ ok: true });
  });

  it('시험 자료 서류 규칙 묶음(기획서 §4 예시와 전용 줄 수 변형 셋)이 모두 구조 검사를 통과한다', () => {
    expect(check(planningExampleRuleSet())).toEqual({ ok: true });
    expect(check(ruleSetTwoInjuryThreeIllness())).toEqual({ ok: true });
    expect(check(ruleSetZeroInjuryFourIllness())).toEqual({ ok: true });
    expect(check(ruleSetNoCauseLines())).toEqual({ ok: true });
    expect(NO_CAUSE_LINES_OUTCOME.common).toHaveLength(9); // 빈 시험 방지: 변형 기대값이 실제로 있다
  });

  it('출처·승인자·내용 해시 같은 머리 정보는 이 검사의 몫이 아니다 (항목 판정 isUsable 이 본다)', () => {
    const noHeader = { ...ruleSetOf([GOOD]), approver: null, policySources: [], contentHash: '' };
    expect(check(noHeader)).toEqual({ ok: true });
  });
});

describe('묶음 자체와 rules 배열의 모양', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['숫자', 7],
    ['문자열', 'x'],
    ['불리언', true],
    ['배열', []],
  ])('묶음이 %s 이면 RULE_SET_NOT_OBJECT 하나다', (_label, ruleSet) => {
    expect(check(ruleSet)).toEqual({ ok: false, defects: [{ code: 'RULE_SET_NOT_OBJECT', path: 'ruleSet' }] });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['객체 {}', {}],
    ['유사 배열', { length: 0 }],
    ['문자열', 'abc'],
    ['숫자', 7],
    ['불리언', true],
  ])('rules 가 %s 이면 RULES_NOT_ARRAY 하나다', (_label, rules) => {
    expect(check({ ...ruleSetOf([GOOD]), rules })).toEqual({ ok: false, defects: [{ code: 'RULES_NOT_ARRAY', path: 'rules' }] });
    expect(check({ id: 'x', version: 'v' })).toEqual({ ok: false, defects: [{ code: 'RULES_NOT_ARRAY', path: 'rules' }] }); // rules 키가 없다
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['숫자', 7],
    ['문자열', 'x'],
    ['불리언', true],
    ['배열', [GOOD]],
  ])('규칙 항목이 %s 이면 그 항목 하나만 RULE_ENTRY_INVALID 이고 더 읽지 않는다 (앞뒤 규칙의 인덱스를 지킨다)', (_label, entry) => {
    expect(check(setWith(entry))).toEqual({ ok: false, defects: [{ code: 'RULE_ENTRY_INVALID', path: 'rules[1]' }] });
  });

  it('희소 배열의 빈 칸은 undefined 항목으로 잡는다', () => {
    const rules = [GOOD, , GOOD] as unknown as DocumentRule[];
    expect(check({ ...ruleSetOf([GOOD]), rules })).toEqual({ ok: false, defects: [{ code: 'RULE_ENTRY_INVALID', path: 'rules[1]' }] });
  });

  it('항목이 여럿 틀리면 인덱스 순서대로 모두 보고한다', () => {
    const rules = [null, GOOD, 7] as unknown as DocumentRule[];
    expect(defectsOf({ ...ruleSetOf([GOOD]), rules })).toEqual([
      { code: 'RULE_ENTRY_INVALID', path: 'rules[0]' },
      { code: 'RULE_ENTRY_INVALID', path: 'rules[2]' },
    ]);
  });
});

describe('documentCode — 닫힌 10종', () => {
  it.each([
    ['목록 밖 값', 'NOT_A_CODE'],
    ['소문자', 'receipt'],
    ['빈 문자열', ''],
    ['줄 키는 코드가 아니다', 'RECEIPT_AND_ITEMIZED'],
    ['Object.prototype 이름', 'constructor'],
    ['__proto__', '__proto__'],
    ['undefined(빠짐)', undefined],
    ['null', null],
    ['숫자', 7],
    ['배열', ['RECEIPT']],
  ])('%s 은 DOCUMENT_CODE_INVALID 이고 경로가 규칙 위치를 따른다', (_label, documentCode) => {
    expect(check(setWith(ruleWith({ documentCode })))).toEqual({ ok: false, defects: [{ code: 'DOCUMENT_CODE_INVALID', path: 'rules[1].documentCode' }] });
  });

  it('documentCode 키 자체가 없는 규칙도 같은 결함이다', () => {
    const { documentCode: _omitted, ...withoutCode } = GOOD;
    expect(defectsOf(setWith(withoutCode))).toEqual([{ code: 'DOCUMENT_CODE_INVALID', path: 'rules[1].documentCode' }]);
  });
});

describe('reason — 비어 있지 않은 문자열', () => {
  it.each([
    ['빈 문자열', ''],
    ['undefined(빠짐)', undefined],
    ['null', null],
    ['숫자', 7],
    ['배열', ['사유']],
  ])('%s 은 REASON_INVALID 다', (_label, reason) => {
    expect(defectsOf(setWith(ruleWith({ reason })))).toEqual([{ code: 'REASON_INVALID', path: 'rules[1].reason' }]);
  });

  it('reason 키가 없는 규칙도 같은 결함이다', () => {
    const { reason: _omitted, ...withoutReason } = GOOD;
    expect(defectsOf(setWith(withoutReason))).toEqual([{ code: 'REASON_INVALID', path: 'rules[1].reason' }]);
  });

  it('공백만 있는 문자열은 비어 있지 않으므로 이 검사가 거절하지 않는다 (결정: 문서가 말한 조건은 "비어 있지 않음"뿐이다)', () => {
    expect(check(setWith(ruleWith({ reason: ' ' })))).toEqual({ ok: true });
  });
});

describe('priority — 0 이상의 안전 정수', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['Number.MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['-0 (0 과 같은 수)', -0],
  ])('%s 은 유효하다', (_label, priority) => {
    expect(check(setWith(ruleWith({ priority })))).toEqual({ ok: true });
  });

  it.each([
    ['MAX_SAFE_INTEGER + 1', Number.MAX_SAFE_INTEGER + 1],
    ['-1', -1],
    ['소수 0.5', 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['문자열 "1"', '1'],
    ['null', null],
    ['undefined(빠짐)', undefined],
    ['BigInt', 1n],
    ['불리언', true],
  ])('%s 은 PRIORITY_INVALID 다', (_label, priority) => {
    expect(defectsOf(setWith(ruleWith({ priority })))).toEqual([{ code: 'PRIORITY_INVALID', path: 'rules[1].priority' }]);
  });
});

describe('when — 객체이고 알려진 여섯 키만, 값은 열거 안에서', () => {
  it.each([
    ['undefined(빠짐)', undefined],
    ['null', null],
    ['배열', []],
    ['문자열', 'cause'],
    ['숫자', 7],
    ['불리언', true],
  ])('when 이 %s 이면 WHEN_NOT_OBJECT 하나다', (_label, when) => {
    expect(defectsOf(setWith(whenWith(when)))).toEqual([{ code: 'WHEN_NOT_OBJECT', path: 'rules[1].when' }]);
  });

  it('when 키가 없는 규칙도 같은 결함이다', () => {
    const { when: _omitted, ...withoutWhen } = GOOD;
    expect(defectsOf(setWith(withoutWhen))).toEqual([{ code: 'WHEN_NOT_OBJECT', path: 'rules[1].when' }]);
  });

  it('알 수 없는 키는 WHEN_UNKNOWN_KEY 이고 경로에 키가 든다 (대소문자 다른 이름, 철자 다른 이름 포함)', () => {
    for (const key of ['foo', 'Cause', 'imagingg', '', 'constructor']) {
      expect(defectsOf(setWith(whenWith({ [key]: true }))), key).toEqual([{ code: 'WHEN_UNKNOWN_KEY', path: `rules[1].when.${key}` }]);
    }
  });

  it('JSON 에서 온 own 키 __proto__ 도 알 수 없는 키다', () => {
    const parsed: unknown = JSON.parse('{"__proto__": true}');
    expect(defectsOf(setWith(whenWith(parsed)))).toEqual([{ code: 'WHEN_UNKNOWN_KEY', path: 'rules[1].when.__proto__' }]);
  });

  it.each([
    ['cause', 'UNKNOWN'],
    ['cause', 'injury'],
    ['cause', 7],
    ['cause', null],
    ['cause', undefined],
    ['setting', 'ALL'],
    ['setting', 'outpatient'],
    ['setting', null],
    ['insurerType', 'OTHER'],
    ['insurerType', 'life'],
    ['insurerType', 3],
    ['insurerType', null],
  ])('열거 키 %s 의 값 %j 은 WHEN_VALUE_INVALID 다', (key, value) => {
    expect(defectsOf(setWith(whenWith({ [key]: value })))).toEqual([{ code: 'WHEN_VALUE_INVALID', path: `rules[1].when.${key}` }]);
  });

  it.each(['imaging', 'biopsy', 'opinionRequired'])('플래그 %s 은 true 만 유효하다: false·1·"true"·null·undefined 각각 거절', (key) => {
    for (const value of [false, 1, 'true', null, undefined, 0, {}]) {
      expect(defectsOf(setWith(whenWith({ [key]: value }))), `${key}=${String(value)}`).toEqual([{ code: 'WHEN_VALUE_INVALID', path: `rules[1].when.${key}` }]);
    }
    expect(check(setWith(whenWith({ [key]: true })))).toEqual({ ok: true });
  });
});

describe('결함 순서 — 결정적이다', () => {
  const broken = {
    documentCode: 'NOPE',
    reason: '',
    priority: -1,
    when: { zzz: 1, imaging: false, insurerType: 'X', aaa: 2, cause: 'X' },
  };

  it('한 규칙 안에서는 documentCode → reason → priority → when(알려진 키 고정 순서 → 알 수 없는 키 코드 포인트 순) 이다', () => {
    expect(defectsOf(ruleSetOf([broken as unknown as DocumentRule]))).toEqual([
      { code: 'DOCUMENT_CODE_INVALID', path: 'rules[0].documentCode' },
      { code: 'REASON_INVALID', path: 'rules[0].reason' },
      { code: 'PRIORITY_INVALID', path: 'rules[0].priority' },
      { code: 'WHEN_VALUE_INVALID', path: 'rules[0].when.cause' },
      { code: 'WHEN_VALUE_INVALID', path: 'rules[0].when.insurerType' },
      { code: 'WHEN_VALUE_INVALID', path: 'rules[0].when.imaging' },
      { code: 'WHEN_UNKNOWN_KEY', path: 'rules[0].when.aaa' },
      { code: 'WHEN_UNKNOWN_KEY', path: 'rules[0].when.zzz' },
    ]);
  });

  it('여러 규칙은 배열 순서(인덱스 순)로 이어 붙고, 같은 입력은 거듭 불러도 같다', () => {
    const rules = [broken, GOOD, { ...broken, documentCode: 'RECEIPT', reason: 'ok', priority: 0, when: 'x' }] as unknown as DocumentRule[];
    const ruleSet = ruleSetOf(rules);
    const first = defectsOf(ruleSet);
    expect(first.map((defect) => defect.path.slice(0, 8))).toEqual([...Array(8).fill('rules[0]'), 'rules[2]']);
    expect(first[8]).toEqual({ code: 'WHEN_NOT_OBJECT', path: 'rules[2].when' });
    expect(defectsOf(ruleSet)).toEqual(first);
  });

  it('알 수 없는 키의 보고 순서는 키 삽입 순서에 영향을 받지 않는다', () => {
    const forward = defectsOf(ruleSetOf([whenWith({ bbb: true, aaa: true }) as DocumentRule]));
    const reverse = defectsOf(ruleSetOf([whenWith({ aaa: true, bbb: true }) as DocumentRule]));
    expect(forward).toEqual(reverse);
    expect(forward.map((defect) => defect.path)).toEqual(['rules[0].when.aaa', 'rules[0].when.bbb']);
  });
});

describe('던지지 않고 입력을 바꾸지 않는다', () => {
  it('깊이 동결한 묶음도 던지지 않는다', () => {
    const frozen = ruleSetOf([GOOD, ruleWith({ priority: -1 })]);
    const freeze = (value: unknown): void => {
      if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) freeze(child);
      }
    };
    freeze(frozen);
    const before = JSON.stringify(frozen);
    expect(defectsOf(frozen)).toEqual([{ code: 'PRIORITY_INVALID', path: 'rules[1].priority' }]);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('여러 모양의 엉터리 값을 어떤 것도 던지지 않고 처리한다', () => {
    const junk: unknown[] = [null, undefined, 0, '', [], {}, { rules: [null, undefined, 1, 'a', [], {}, { when: null }] }, { rules: [{ when: { cause: Symbol('x') } }] }];
    for (const value of junk) {
      expect(() => check(value)).not.toThrow();
    }
  });
});

describe('핵심 정의 전수: 규칙 설계 9번이 말한 항목이 각각 거절된다', () => {
  it('한 번에 하나씩 결함을 가진 묶음이 각각 정확히 그 경로로 거절되고, 고치면 통과한다', () => {
    const valid = rule('IMAGING_READING', { imaging: true }, '시험 문장', 3);
    expect(check(ruleSetOf([GOOD, GOOD, GOOD, valid]))).toEqual({ ok: true });
    const defective = ruleSetOf([GOOD, GOOD, GOOD, ruleWith({ ...valid, when: { imaging: false } })]);
    expect(check(defective)).toEqual({ ok: false, defects: [{ code: 'WHEN_VALUE_INVALID', path: 'rules[3].when.imaging' }] });
    const priorityDefective = ruleSetOf([GOOD, GOOD, GOOD, ruleWith({ ...valid, priority: 0.5 })]);
    expect(check(priorityDefective)).toEqual({ ok: false, defects: [{ code: 'PRIORITY_INVALID', path: 'rules[3].priority' }] });
  });
});
