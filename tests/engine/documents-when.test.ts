import { describe, expect, it } from 'vitest';
import { deriveDocuments } from '../../src/engine/documents';
import type { DeriveDocumentsInput } from '../../src/engine/documents';
import type { Cause, DocumentCode, DocumentFlags, DocumentLine, DocumentLineKey, DocumentsResult, DocumentWhen, InsurerType } from '../../src/engine/types';
import { documentInput, plainRule, plainTreatment, ruleSetOf, treatmentWith } from '../fixtures/engine/document-rules.fixture';

// M2.B: AC-007j(when 키 의미)와 AC-007k(서류 표시 OR 집계, 치료 배열 순서 독립). design.md DD-06 "규칙 평가" 1~5번.
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 서류 요건이 아니다.

type Available = Extract<DocumentsResult, { state: 'AVAILABLE' }>;

const CAUSES: Cause[] = ['INJURY', 'ILLNESS', 'UNKNOWN'];
const INSURER_TYPES: InsurerType[] = ['NON_LIFE', 'LIFE', 'MUTUAL_AID'];
const FLAG_KEYS = ['imaging', 'biopsy', 'opinionRequired'] as const;
type FlagKey = (typeof FLAG_KEYS)[number];
const FLAG_COMBOS: DocumentFlags[] = [0, 1, 2, 3, 4, 5, 6, 7].map((bits) => ({
  imaging: (bits & 1) !== 0,
  biopsy: (bits & 2) !== 0,
  opinionRequired: (bits & 4) !== 0,
}));

/** 규칙이 없으면 필요하지 않은 줄. 대상 규칙의 사유는 EXTRA 이다. */
const TARGET: DocumentLineKey = 'MEDICAL_OPINION';
const EXTRA = '추가 규칙의 사유';
const BASE_RULE = plainRule('RECEIPT', {}, '기본 영수증 사유', 1);

function available(result: DocumentsResult | null): Available {
  if (result === null || result.state !== 'AVAILABLE') {
    throw new Error(`AVAILABLE 이 아니다: ${JSON.stringify(result)}`);
  }
  return result;
}

function lineOf(result: DocumentsResult | null, key: DocumentLineKey): DocumentLine {
  const found = available(result).lines.find((line) => line.line === key);
  if (found === undefined) {
    throw new Error(`줄이 없다: ${key}`);
  }
  return found;
}

const baselineSet = ruleSetOf([BASE_RULE]);
const withRuleSet = (when: DocumentWhen, code: DocumentCode = 'MEDICAL_OPINION') => ruleSetOf([BASE_RULE, plainRule(code, when, EXTRA, 1)]);

/** 규칙을 더한 결과와 더하지 않은 결과를 같은 입력으로 낸다. */
function pair(when: DocumentWhen, overrides: Partial<DeriveDocumentsInput> = {}) {
  const added = deriveDocuments(documentInput({ ...overrides, ruleSet: withRuleSet(when) }));
  const baseline = deriveDocuments(documentInput({ ...overrides, ruleSet: baselineSet }));
  return { added, baseline };
}

/** 조건이 맞으면 대상 줄이 필요로 바뀌고 사유가 붙는다(결과가 기준과 다르다). */
function expectEffect(when: DocumentWhen, overrides: Partial<DeriveDocumentsInput>, label: string): void {
  const { added, baseline } = pair(when, overrides);
  expect(JSON.stringify(added), label).not.toBe(JSON.stringify(baseline));
  const line = lineOf(added, TARGET);
  expect(line.required, label).toBe(true);
  expect(line.reasons, label).toEqual([EXTRA]);
}

/** 조건이 맞지 않으면 결과가 규칙이 없는 묶음의 결과와 바이트 단위로 같다. */
function expectNoEffect(when: DocumentWhen, overrides: Partial<DeriveDocumentsInput>, label: string): void {
  const { added, baseline } = pair(when, overrides);
  expect(JSON.stringify(added), label).toBe(JSON.stringify(baseline));
}

describe('AC-007j (1) 키 cause·setting·insurerType 각각: 조건이 맞을 때만 결과가 달라진다', () => {
  it('cause: INJURY 규칙은 단일 INJURY 에서만, ILLNESS 규칙은 단일 ILLNESS 에서만 효과가 있다', () => {
    expectEffect({ cause: 'INJURY' }, { cause: 'INJURY' }, 'INJURY 규칙, 원인 INJURY');
    expectNoEffect({ cause: 'INJURY' }, { cause: 'ILLNESS' }, 'INJURY 규칙, 원인 ILLNESS');
    expectEffect({ cause: 'ILLNESS' }, { cause: 'ILLNESS' }, 'ILLNESS 규칙, 원인 ILLNESS');
    expectNoEffect({ cause: 'ILLNESS' }, { cause: 'INJURY' }, 'ILLNESS 규칙, 원인 INJURY');
  });

  it('cause: 원인 UNKNOWN 에서는 맞는 쪽의 전용 줄로 나온다 (INJURY 규칙 → INJURY_ONLY, ILLNESS 규칙 → ILLNESS_ONLY)', () => {
    const injury = lineOf(pair({ cause: 'INJURY' }, { cause: 'UNKNOWN' }).added, TARGET);
    expect(injury).toEqual({ line: TARGET, required: true, scope: 'INJURY_ONLY', reasons: [EXTRA] });
    const illness = lineOf(pair({ cause: 'ILLNESS' }, { cause: 'UNKNOWN' }).added, TARGET);
    expect(illness).toEqual({ line: TARGET, required: true, scope: 'ILLNESS_ONLY', reasons: [EXTRA] });
  });

  it('setting: OUTPATIENT 은 통원 전용 입력(OUTPATIENT_ONLY)에서 모든 원인에 맞고, INPATIENT 는 어떤 입력에서도 맞지 않는다', () => {
    for (const cause of CAUSES) {
      for (const insurerType of INSURER_TYPES) {
        expectEffect({ setting: 'OUTPATIENT' }, { cause, insurerType }, `OUTPATIENT/${cause}/${insurerType}`);
        expectNoEffect({ setting: 'INPATIENT' }, { cause, insurerType }, `INPATIENT/${cause}/${insurerType}`);
      }
    }
  });

  it('insurerType: 입력과 같은 값의 규칙만 효과가 있다 (세 값 × 입력 세 값, 원인 세 값)', () => {
    for (const cause of CAUSES) {
      for (const ruleType of INSURER_TYPES) {
        for (const inputType of INSURER_TYPES) {
          const label = `규칙 ${ruleType} / 입력 ${inputType} / ${cause}`;
          if (ruleType === inputType) expectEffect({ insurerType: ruleType }, { cause, insurerType: inputType }, label);
          else expectNoEffect({ insurerType: ruleType }, { cause, insurerType: inputType }, label);
        }
      }
    }
  });
});

describe('AC-007j (3) 두 조건을 가진 규칙은 둘 다 맞을 때만 효과가 있다', () => {
  const MATCH = { cause: 'INJURY', setting: 'OUTPATIENT', insurerType: 'NON_LIFE' } as const;
  const MISMATCH = { cause: 'ILLNESS', setting: 'INPATIENT', insurerType: 'LIFE' } as const;
  // 입력: cause INJURY, 통원 전용, NON_LIFE. MATCH 값은 이 입력과 맞고 MISMATCH 값은 맞지 않는다.
  const keyPairs: Array<['cause' | 'setting' | 'insurerType', 'cause' | 'setting' | 'insurerType']> = [
    ['cause', 'setting'],
    ['cause', 'insurerType'],
    ['setting', 'insurerType'],
  ];
  const input: Partial<DeriveDocumentsInput> = { cause: 'INJURY', insurerType: 'NON_LIFE' };

  it.each(keyPairs)('세 키의 쌍 (%s, %s): 둘 다 맞을 때만 효과, 하나만 맞으면 규칙이 없을 때와 바이트 단위로 같다', (a, b) => {
    expectEffect({ [a]: MATCH[a], [b]: MATCH[b] } as unknown as DocumentWhen, input, `${a}+${b} 둘 다`);
    expectNoEffect({ [a]: MATCH[a], [b]: MISMATCH[b] } as unknown as DocumentWhen, input, `${a} 만 맞음`);
    expectNoEffect({ [a]: MISMATCH[a], [b]: MATCH[b] } as unknown as DocumentWhen, input, `${b} 만 맞음`);
    expectNoEffect({ [a]: MISMATCH[a], [b]: MISMATCH[b] } as unknown as DocumentWhen, input, '둘 다 안 맞음');
  });

  const keyFlagPairs = (['cause', 'setting', 'insurerType'] as const).flatMap((key) => FLAG_KEYS.map((flag): [typeof key, FlagKey] => [key, flag]));
  it.each(keyFlagPairs)('키 %s 와 플래그 %s 의 쌍: 둘 다 맞을 때만 효과가 있다', (key, flag: FlagKey) => {
    const flagged = [treatmentWith({ [flag]: true })];
    const unflagged = [plainTreatment()];
    expectEffect({ [key]: MATCH[key], [flag]: true } as unknown as DocumentWhen, { ...input, treatments: flagged }, '둘 다');
    expectNoEffect({ [key]: MATCH[key], [flag]: true } as unknown as DocumentWhen, { ...input, treatments: unflagged }, '키만 맞음');
    expectNoEffect({ [key]: MISMATCH[key], [flag]: true } as unknown as DocumentWhen, { ...input, treatments: flagged }, '플래그만 맞음');
    expectNoEffect({ [key]: MISMATCH[key], [flag]: true } as unknown as DocumentWhen, { ...input, treatments: unflagged }, '둘 다 안 맞음');
  });

  it('다른 서류 표시를 가진 치료로는 그 표시 규칙이 맞지 않는다 (플래그마다 따로)', () => {
    for (const flag of FLAG_KEYS) {
      for (const other of FLAG_KEYS.filter((key) => key !== flag)) {
        expectNoEffect({ [flag]: true } as unknown as DocumentWhen, { treatments: [treatmentWith({ [other]: true })] }, `${flag} 규칙, ${other} 표시`);
      }
    }
  });
});

describe('AC-007j (4) 빠진 키는 제약이 아니다', () => {
  it('{ cause: INJURY } 규칙은 세 보험사 형태와 서류 표시 조합 8가지 모두에서 같이 맞는다', () => {
    for (const insurerType of INSURER_TYPES) {
      for (const flags of FLAG_COMBOS) {
        expectEffect({ cause: 'INJURY' }, { cause: 'INJURY', insurerType, treatments: [treatmentWith(flags)] }, `${insurerType}/${JSON.stringify(flags)}`);
      }
    }
  });

  it('{ insurerType } 만 있는 규칙은 원인과 서류 표시에 관계없이 맞는다', () => {
    for (const cause of CAUSES) {
      for (const flags of FLAG_COMBOS) {
        expectEffect({ insurerType: 'LIFE' }, { cause, insurerType: 'LIFE', treatments: [treatmentWith(flags)] }, `${cause}/${JSON.stringify(flags)}`);
      }
    }
  });
});

describe('AC-007j (5) when: {} 인 규칙은 모든 입력에서 맞는다', () => {
  it('원인 세 값 × 보험사 형태 세 값 × 서류 표시 조합 8가지의 72가지 입력 모두', () => {
    let count = 0;
    for (const cause of CAUSES) {
      for (const insurerType of INSURER_TYPES) {
        for (const flags of FLAG_COMBOS) {
          const added = deriveDocuments(documentInput({ cause, insurerType, treatments: [treatmentWith(flags)], ruleSet: withRuleSet({}) }));
          const line = lineOf(added, TARGET);
          expect(line.required, `${cause}/${insurerType}`).toBe(true);
          expect(line.reasons).toEqual([EXTRA]);
          expect(line.scope, `${cause}/${insurerType}`).toBe(cause === 'UNKNOWN' ? 'COMMON' : undefined);
          count += 1;
        }
      }
    }
    expect(count).toBe(72);
  });
});

// ───────────────────────── AC-007k ─────────────────────────

const FLAG_TARGET: Record<FlagKey, DocumentLineKey> = { imaging: 'IMAGING_READING', biopsy: 'BIOPSY_RESULT', opinionRequired: 'MEDICAL_OPINION' };
const FLAG_RULE_CODE: Record<FlagKey, DocumentCode> = { imaging: 'IMAGING_READING', biopsy: 'BIOPSY_RESULT', opinionRequired: 'MEDICAL_OPINION' };

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe('AC-007k 선택한 치료의 서류 표시는 OR 로 집계하고 치료 배열 순서와 무관하다', () => {
  it.each(FLAG_KEYS)('%s: 치료 셋 가운데 하나만 표시를 가질 때 6가지 순열 모두 같은 결과이고 그 줄이 사유와 함께 필요하다', (flag) => {
    const set = ruleSetOf([BASE_RULE, plainRule(FLAG_RULE_CODE[flag], { [flag]: true } as unknown as DocumentWhen, `${flag} 사유`, 1)]);
    const flagged = treatmentWith({ [flag]: true });
    const orders = permutations([flagged, plainTreatment(), plainTreatment()]);
    expect(orders).toHaveLength(6);
    const results = orders.map((treatments) => JSON.stringify(deriveDocuments(documentInput({ treatments, ruleSet: set }))));
    expect(new Set(results).size).toBe(1);
    const line = lineOf(deriveDocuments(documentInput({ treatments: orders[0] ?? [], ruleSet: set })), FLAG_TARGET[flag]);
    expect(line).toMatchObject({ required: true, reasons: [`${flag} 사유`] });
  });

  it.each(FLAG_KEYS)('%s: 둘 이상이 표시를 가져도 결과가 같다 (OR)', (flag) => {
    const set = ruleSetOf([BASE_RULE, plainRule(FLAG_RULE_CODE[flag], { [flag]: true } as unknown as DocumentWhen, `${flag} 사유`, 1)]);
    const one = JSON.stringify(deriveDocuments(documentInput({ treatments: [treatmentWith({ [flag]: true }), plainTreatment(), plainTreatment()], ruleSet: set })));
    const two = permutations([treatmentWith({ [flag]: true }), treatmentWith({ [flag]: true }), plainTreatment()]).map((treatments) => JSON.stringify(deriveDocuments(documentInput({ treatments, ruleSet: set }))));
    const three = JSON.stringify(deriveDocuments(documentInput({ treatments: [1, 2, 3].map(() => treatmentWith({ [flag]: true })), ruleSet: set })));
    expect(new Set([one, three, ...two]).size).toBe(1);
  });

  it.each(FLAG_KEYS)('%s: 어느 치료도 표시를 갖지 않으면 규칙이 없을 때와 바이트 단위로 같다', (flag) => {
    const set = ruleSetOf([BASE_RULE, plainRule(FLAG_RULE_CODE[flag], { [flag]: true } as unknown as DocumentWhen, `${flag} 사유`, 1)]);
    for (const treatments of permutations([plainTreatment(), plainTreatment(), plainTreatment()])) {
      expect(JSON.stringify(deriveDocuments(documentInput({ treatments, ruleSet: set })))).toBe(JSON.stringify(deriveDocuments(documentInput({ treatments, ruleSet: baselineSet }))));
    }
  });

  it('여러 표시를 한 치료가 모두 가지거나 서로 다른 치료가 나눠 가져도 결과가 같다 (플래그마다 OR)', () => {
    const set = ruleSetOf([
      BASE_RULE,
      plainRule('IMAGING_READING', { imaging: true }, '영상', 1),
      plainRule('BIOPSY_RESULT', { biopsy: true }, '조직', 1),
      plainRule('MEDICAL_OPINION', { opinionRequired: true }, '소견', 1),
    ]);
    const all = JSON.stringify(deriveDocuments(documentInput({ treatments: [treatmentWith({ imaging: true, biopsy: true, opinionRequired: true })], ruleSet: set })));
    const split = deriveDocuments(documentInput({ treatments: [treatmentWith({ opinionRequired: true }), treatmentWith({ imaging: true }), treatmentWith({ biopsy: true })], ruleSet: set }));
    expect(JSON.stringify(split)).toBe(all);
    expect(available(split).lines.filter((line) => line.required).map((line) => line.line)).toEqual(['RECEIPT_AND_ITEMIZED', 'MEDICAL_OPINION', 'IMAGING_READING', 'BIOPSY_RESULT']);
  });

  it('같은 줄로 가는 규칙이 여럿이면 하나라도 맞을 때 필요하다 (서로 다른 표시의 규칙 둘)', () => {
    const set = ruleSetOf([
      BASE_RULE,
      plainRule('MEDICAL_OPINION', { imaging: true }, '영상 때문에', 1),
      plainRule('MEDICAL_OPINION', { biopsy: true }, '조직 때문에', 1),
    ]);
    const run = (flags: Partial<DocumentFlags>) => lineOf(deriveDocuments(documentInput({ treatments: [treatmentWith(flags)], ruleSet: set })), 'MEDICAL_OPINION');
    expect(run({})).toEqual({ line: 'MEDICAL_OPINION', required: false, scope: 'COMMON' });
    expect(run({ imaging: true })).toMatchObject({ required: true, reasons: ['영상 때문에'] });
    expect(run({ biopsy: true })).toMatchObject({ required: true, reasons: ['조직 때문에'] });
    expect(run({ imaging: true, biopsy: true })).toMatchObject({ required: true, reasons: ['영상 때문에'] }); // 우선순위 같음 → 사유 코드 포인트 순
  });

  it('RECEIPT 코드 규칙과 ITEMIZED_STATEMENT 코드 규칙은 같은 RECEIPT_AND_ITEMIZED 줄로 간다: 어느 쪽이 맞아도 줄은 필요이고 사유가 붙는다', () => {
    const set = ruleSetOf([plainRule('RECEIPT', { imaging: true }, '영상이면 영수증 사유', 1), plainRule('ITEMIZED_STATEMENT', { biopsy: true }, '조직이면 세부내역 사유', 1)]);
    const run = (flags: Partial<DocumentFlags>) => lineOf(deriveDocuments(documentInput({ treatments: [treatmentWith(flags)], ruleSet: set })), 'RECEIPT_AND_ITEMIZED');
    expect(run({})).toEqual({ line: 'RECEIPT_AND_ITEMIZED', required: true, scope: 'COMMON' });
    expect(run({ imaging: true })).toEqual({ line: 'RECEIPT_AND_ITEMIZED', required: true, scope: 'COMMON', reasons: ['영상이면 영수증 사유'] });
    expect(run({ biopsy: true })).toEqual({ line: 'RECEIPT_AND_ITEMIZED', required: true, scope: 'COMMON', reasons: ['조직이면 세부내역 사유'] });
    expect(run({ imaging: true, biopsy: true }).reasons).toEqual(['영상이면 영수증 사유']); // 코드 포인트 순에서 "영" 이 "조" 보다 앞선다
  });

  it('치료 요소는 documentFlags 만 가진다: 줄 상태 같은 필드는 입력 형식에 없다 (형식 수준 시험)', () => {
    const element: DeriveDocumentsInput['treatments'][number] = { documentFlags: { imaging: false, biopsy: false, opinionRequired: false } };
    const keysOfElement: Array<keyof typeof element> = ['documentFlags'];
    expect(keysOfElement).toEqual(['documentFlags']);
    const withLineState: DeriveDocumentsInput['treatments'] = [
      // @ts-expect-error 줄 상태(확인된 제외 여부 등)는 입력 형식에 없다
      { documentFlags: element.documentFlags, state: 'EXCLUDED' },
    ];
    expect(withLineState).toHaveLength(1);
  });

  it('치료 배열의 모든 요소를 센다: 마지막 열 번째 요소만 표시를 가져도 규칙이 맞고, 중복된 치료는 결과를 바꾸지 않는다', () => {
    const set = ruleSetOf([BASE_RULE, plainRule('BIOPSY_RESULT', { biopsy: true }, '조직', 1)]);
    const many = [...Array.from({ length: 9 }, () => plainTreatment()), treatmentWith({ biopsy: true })];
    expect(lineOf(deriveDocuments(documentInput({ treatments: many, ruleSet: set })), 'BIOPSY_RESULT').required).toBe(true);
    const once = JSON.stringify(deriveDocuments(documentInput({ treatments: [treatmentWith({ biopsy: true })], ruleSet: set })));
    const dup = JSON.stringify(deriveDocuments(documentInput({ treatments: [treatmentWith({ biopsy: true }), treatmentWith({ biopsy: true })], ruleSet: set })));
    expect(dup).toBe(once);
  });

  it('치료 요소가 확인된 제외 줄이었는지는 알 수 없고 알 필요도 없다: 표시가 있으면 센다 (제외 여부 필드 자체가 없다)', () => {
    const set = ruleSetOf([BASE_RULE, plainRule('IMAGING_READING', { imaging: true }, '영상', 1)]);
    expect(lineOf(deriveDocuments(documentInput({ treatments: [treatmentWith({ imaging: true })], ruleSet: set })), 'IMAGING_READING').required).toBe(true);
  });
});

