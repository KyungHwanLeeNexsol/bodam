import { describe, expect, it } from 'vitest';
import { deriveDocuments, selectDocumentRuleSet } from '../../src/engine/documents';
import type { DeriveDocumentsInput } from '../../src/engine/documents';
import { estimate } from '../../src/engine/estimate';
import { DOCUMENT_LINE_KEYS } from '../../src/engine/types';
import type { Cause, DocumentLine, DocumentLineKey, DocumentRuleSet, DocumentsResult, LifecycleState } from '../../src/engine/types';
import type { UsabilityContext } from '../../src/engine/usability';
import { CASE_E, caseInput, runEstimate } from '../fixtures/engine/cases.fixture';
import {
  NO_CAUSE_LINES_OUTCOME,
  PLANNING_EXAMPLE_UNKNOWN_CAUSE_OUTCOME,
  TEST_DOCUMENT_RULES_REVIEW_MARK,
  TWO_INJURY_THREE_ILLNESS_OUTCOME,
  ZERO_INJURY_FOUR_ILLNESS_OUTCOME,
  documentInput,
  plainRule,
  planningExampleRuleSet,
  ruleSetNoCauseLines,
  ruleSetOf,
  ruleSetTwoInjuryThreeIllness,
  ruleSetZeroInjuryFourIllness,
  treatmentWith,
} from '../fixtures/engine/document-rules.fixture';
import type { ScopeOutcome } from '../fixtures/engine/document-rules.fixture';
import { T_INJECT, T_PHYSIO, T_ULTRA, T_XRAY, makeBundle, makeInput } from '../fixtures/engine/lines.fixture';
import { TEST_AT, testDigest, testPolicySource } from '../fixtures/engine/profiles.fixture';

// M2.B: deriveDocuments (design.md DD-06). AC-007a, b, c, d, e, h 와 입력 방어.
// AC-007j·k·l 은 documents-when.test.ts, documents-order.test.ts 에 있다.
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 서류 요건이 아니다. 사유 문장은 이 시험을 위해 지어낸 것이다.

type Available = Extract<DocumentsResult, { state: 'AVAILABLE' }>;

const MARK = TEST_DOCUMENT_RULES_REVIEW_MARK;
const CAUSES: Cause[] = ['INJURY', 'ILLNESS', 'UNKNOWN'];
const INSURER_TYPES = ['NON_LIFE', 'LIFE', 'MUTUAL_AID'] as const;
const FLAG_COMBOS = [0, 1, 2, 3, 4, 5, 6, 7].map((bits) => ({
  imaging: (bits & 1) !== 0,
  biopsy: (bits & 2) !== 0,
  opinionRequired: (bits & 4) !== 0,
}));

function available(result: DocumentsResult | null): Available {
  if (result === null || result.state !== 'AVAILABLE') {
    throw new Error(`AVAILABLE 이 아니다: ${JSON.stringify(result)}`);
  }
  return result;
}

function lineOf(result: Available, key: DocumentLineKey): DocumentLine {
  const found = result.lines.find((line) => line.line === key);
  if (found === undefined) {
    throw new Error(`줄이 없다: ${key}`);
  }
  return found;
}

/** 원인 모름 결과를 범위별 줄 키 목록과 필요한 줄 목록으로 접는다(고정 9줄 순서 유지). */
function outcomeOf(result: Available): ScopeOutcome {
  const keysWhere = (test: (line: DocumentLine) => boolean) => result.lines.filter(test).map((line) => line.line);
  return {
    common: keysWhere((line) => line.scope === 'COMMON'),
    injuryOnly: keysWhere((line) => line.scope === 'INJURY_ONLY'),
    illnessOnly: keysWhere((line) => line.scope === 'ILLNESS_ONLY'),
    required: keysWhere((line) => line.required),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const derive = (overrides: Partial<DeriveDocumentsInput> = {}) => deriveDocuments(documentInput(overrides));

describe('AC-007a 어떤 입력에서도 9줄이 나오고 RECEIPT_AND_ITEMIZED 줄은 항상 필요하다', () => {
  it('기획서 §4 예시 묶음: 원인 3 × 보험사 형태 3 × 서류 표시 조합 8 = 72가지 모두 9줄 키가 고정 순서로 한 번씩, 영수증 줄은 필요', () => {
    let count = 0;
    for (const cause of CAUSES) {
      for (const insurerType of INSURER_TYPES) {
        for (const flags of FLAG_COMBOS) {
          const result = available(derive({ cause, insurerType, treatments: [treatmentWith(flags)] }));
          const label = `${cause}/${insurerType}/${JSON.stringify(flags)}`;
          expect(result.lines.map((line) => line.line), label).toEqual([...DOCUMENT_LINE_KEYS]);
          expect(lineOf(result, 'RECEIPT_AND_ITEMIZED').required, label).toBe(true);
          expect(result.mode, label).toBe(cause === 'UNKNOWN' ? 'UNKNOWN_CAUSE' : 'SINGLE_CAUSE');
          count += 1;
        }
      }
    }
    expect(count).toBe(72);
  });

  it('규칙이 하나도 없는 유효한 묶음(rules: [])도 9줄이고 영수증 줄만 필요하며 사유가 없다', () => {
    for (const cause of CAUSES) {
      const result = available(derive({ cause, ruleSet: ruleSetOf([]) }));
      expect(result.lines.map((line) => line.line)).toEqual([...DOCUMENT_LINE_KEYS]);
      expect(result.lines.filter((line) => line.required).map((line) => line.line)).toEqual(['RECEIPT_AND_ITEMIZED']);
      expect(result.lines.every((line) => !('reasons' in line)), cause).toBe(true);
    }
  });

  it('치료 목록이 비어 있어도 9줄이 나온다', () => {
    expect(available(derive({ treatments: [] })).lines).toHaveLength(9);
  });
});

describe('AC-007b 단일 원인과 줄마다 하나의 사유', () => {
  const rules = planningExampleRuleSet().rules;
  const reasonOf = (code: string, cause?: string) => {
    const found = rules.find((entry) => entry.documentCode === code && (cause === undefined || entry.when.cause === cause));
    if (found === undefined) throw new Error(`규칙이 없다: ${code}`);
    return found.reason;
  };

  it('원인 INJURY: 초진기록지가 사유와 함께 필요하고 진단서는 필요하지 않다 (SINGLE_CAUSE 줄에는 scope 가 없다)', () => {
    const result = available(derive({ cause: 'INJURY' }));
    expect(lineOf(result, 'INITIAL_EXAM_RECORD')).toEqual({ line: 'INITIAL_EXAM_RECORD', required: true, reasons: [reasonOf('INITIAL_EXAM_RECORD')] });
    expect(lineOf(result, 'DIAGNOSIS_CERT')).toEqual({ line: 'DIAGNOSIS_CERT', required: false });
    expect(result.lines.every((line) => !('scope' in line))).toBe(true);
  });

  it('원인 ILLNESS: 진단서가 (질병 규칙의) 사유와 함께 필요하고 초진기록지는 필요하지 않다', () => {
    const result = available(derive({ cause: 'ILLNESS' }));
    expect(lineOf(result, 'DIAGNOSIS_CERT')).toEqual({ line: 'DIAGNOSIS_CERT', required: true, reasons: [reasonOf('DIAGNOSIS_CERT', 'ILLNESS')] });
    expect(lineOf(result, 'INITIAL_EXAM_RECORD')).toEqual({ line: 'INITIAL_EXAM_RECORD', required: false });
  });

  it('한 줄을 여러 규칙이 요구하면 우선순위가 가장 높은 규칙의 사유 하나만 나온다', () => {
    const set = ruleSetOf([
      plainRule('INITIAL_EXAM_RECORD', { cause: 'INJURY' }, '사유 우선순위 5', 5),
      plainRule('INITIAL_EXAM_RECORD', { cause: 'INJURY' }, '사유 우선순위 2', 2),
      plainRule('INITIAL_EXAM_RECORD', {}, '사유 우선순위 9', 9),
      plainRule('INITIAL_EXAM_RECORD', { cause: 'ILLNESS' }, '사유 우선순위 0 (질병이라 안 맞음)', 0),
    ]);
    expect(lineOf(available(derive({ cause: 'INJURY', ruleSet: set })), 'INITIAL_EXAM_RECORD').reasons).toEqual(['사유 우선순위 2']);
  });

  it('영수증·세부내역서 규칙이 같은 우선순위이면 사유의 코드 포인트 순에서 앞선 하나만 나온다', () => {
    const result = available(derive({ cause: 'INJURY' }));
    // 기획서 예시 묶음의 두 규칙은 우선순위가 같고, 코드 포인트 순에서 "어떤 진료를…"(세부내역서)가 "진료비를…"(영수증)보다 앞선다.
    expect(lineOf(result, 'RECEIPT_AND_ITEMIZED').reasons).toEqual([reasonOf('ITEMIZED_STATEMENT')]);
  });
});

describe('AC-007c 기획서 §4 예시: 원인 UNKNOWN, 표시 없음, 통원 진료', () => {
  const result = available(derive());

  it('mode 는 UNKNOWN_CAUSE 이고 묶음 id·버전·출처를 그대로 싣는다', () => {
    expect(result.state).toBe('AVAILABLE');
    expect(result.mode).toBe('UNKNOWN_CAUSE');
    expect(result.ruleSetId).toBe('TEST_DOCUMENT_RULES_PLANNING_EXAMPLE');
    expect(result.ruleSetVersion).toBe('v1');
    expect(result.origin).toBe('TEST_FIXTURE');
  });

  it('9줄 전체를 줄마다 required·scope·reasons 까지 확인한다: 공통 7 + 초진기록지 상해 전용 + 진단서 질병 전용', () => {
    expect(result.lines).toEqual([
      { line: 'DIAGNOSIS_CERT', required: true, scope: 'ILLNESS_ONLY', reasons: [`시험 문장: 아파서 오셨다면 진단서가 필요해요 ${MARK}`] },
      { line: 'OUTPATIENT_CONFIRMATION', required: true, scope: 'COMMON', reasons: [`시험 문장: 통원 진료라 통원확인서가 필요해요 ${MARK}`] },
      { line: 'TREATMENT_CONFIRMATION', required: true, scope: 'COMMON', reasons: [`시험 문장: 통원 진료라 진료확인서가 필요해요 ${MARK}`] },
      { line: 'RECEIPT_AND_ITEMIZED', required: true, scope: 'COMMON', reasons: [`시험 문장: 어떤 진료를 받았는지 보이는 세부내역서가 필요해요 ${MARK}`] },
      { line: 'INITIAL_EXAM_RECORD', required: true, scope: 'INJURY_ONLY', reasons: [`시험 문장: 다쳐서 오셨다면 초진기록지가 필요해요 ${MARK}`] },
      { line: 'ADMISSION_DISCHARGE_CONFIRMATION', required: false, scope: 'COMMON' },
      { line: 'MEDICAL_OPINION', required: false, scope: 'COMMON' },
      { line: 'IMAGING_READING', required: false, scope: 'COMMON' },
      { line: 'BIOPSY_RESULT', required: false, scope: 'COMMON' },
    ]);
  });

  it('줄 객체의 속성 순서는 line, required, scope, reasons 로 고정이고 없는 속성은 undefined 로도 두지 않는다', () => {
    expect(JSON.stringify(result.lines[0])).toBe(
      `{"line":"DIAGNOSIS_CERT","required":true,"scope":"ILLNESS_ONLY","reasons":["시험 문장: 아파서 오셨다면 진단서가 필요해요 ${MARK}"]}`,
    );
    expect(JSON.stringify(result.lines[5])).toBe('{"line":"ADMISSION_DISCHARGE_CONFIRMATION","required":false,"scope":"COMMON"}');
    for (const line of result.lines) {
      expect(Object.keys(line)).toEqual(Object.keys(line).filter((key) => line[key as keyof DocumentLine] !== undefined));
    }
  });

  it('범위별 줄 수는 공통 7 + 상해 전용 1 + 질병 전용 1 이고 원인은 하나로 정해지지 않는다', () => {
    const outcome = outcomeOf(result);
    expect(outcome.common).toHaveLength(7);
    expect(outcome.injuryOnly).toEqual(['INITIAL_EXAM_RECORD']);
    expect(outcome.illnessOnly).toEqual(['DIAGNOSIS_CERT']);
    expect(outcome).toEqual(PLANNING_EXAMPLE_UNKNOWN_CAUSE_OUTCOME);
  });

  it('7 + 1 + 1 은 이 예시 묶음이 만든 결과일 뿐 상한이 아니다: 상해 규칙 하나를 더하면 공통 6 + 상해 전용 2 가 된다', () => {
    const more = ruleSetOf([...planningExampleRuleSet().rules, plainRule('MEDICAL_OPINION', { cause: 'INJURY' }, '시험 문장: 소견서 추가', 10)]);
    const outcome = outcomeOf(available(derive({ ruleSet: more })));
    expect(outcome.common).toHaveLength(6);
    expect(outcome.injuryOnly).toEqual(['INITIAL_EXAM_RECORD', 'MEDICAL_OPINION']);
    expect(outcome.illnessOnly).toEqual(['DIAGNOSIS_CERT']);
  });
});

describe('AC-007d 사용 가능한 서류 규칙 묶음이 없으면 RULES_UNAVAILABLE', () => {
  const ctx: UsabilityContext = { at: TEST_AT, acceptedOrigins: ['OPERATING', 'TEST_FIXTURE'], digest: testDigest };
  const operatingOnly: UsabilityContext = { ...ctx, acceptedOrigins: ['OPERATING'] };
  const UNAVAILABLE = { state: 'RULES_UNAVAILABLE' };

  /** 호출하는 쪽의 실제 순서: 묶음에서 쓸 수 있는 묶음을 고른 다음 deriveDocuments 에 넘긴다. */
  function viaBundle(documentRuleSet: DocumentRuleSet | null, context: UsabilityContext, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const bundle = makeBundle({ documentRuleSet, status });
    return derive({ ruleSet: selectDocumentRuleSet(bundle, context) });
  }

  it('ruleSet 이 null 이면 보류가 아닌 두 상태(ESTIMATED, ESTIMATED_WITH_EXCLUSIONS) 모두 RULES_UNAVAILABLE 이다', () => {
    for (const overallState of ['ESTIMATED', 'ESTIMATED_WITH_EXCLUSIONS'] as const) {
      expect(derive({ overallState, ruleSet: null }), overallState).toEqual(UNAVAILABLE);
    }
  });

  it('규칙 허용 출처가 OPERATING 뿐인데 TEST_FIXTURE 묶음뿐이면 RULES_UNAVAILABLE 이고, 출처를 허용하면 AVAILABLE 이다', () => {
    const set = planningExampleRuleSet();
    expect(selectDocumentRuleSet(makeBundle({ documentRuleSet: set }), operatingOnly)).toBeNull();
    expect(viaBundle(set, operatingOnly)).toEqual(UNAVAILABLE);
    expect(viaBundle(set, ctx)?.state).toBe('AVAILABLE');
  });

  it('규칙 사용 범위가 없거나(bundle = null) 묶음이 중지이면 RULES_UNAVAILABLE 이다', () => {
    expect(derive({ ruleSet: selectDocumentRuleSet(null, ctx) })).toEqual(UNAVAILABLE);
    expect(viaBundle(planningExampleRuleSet(), ctx, 'SUSPENDED')).toEqual(UNAVAILABLE);
    expect(viaBundle(null, ctx)).toEqual(UNAVAILABLE);
  });

  const states: LifecycleState[] = ['DRAFT', 'REJECTED', 'UNDER_REREVIEW', 'SUSPENDED', 'EXPIRED'];
  it.each(states)('상태 %s 인 서류 규칙 묶음은 RULES_UNAVAILABLE 이다', (state) => {
    expect(viaBundle(ruleSetOf(planningExampleRuleSet().rules, { state }), ctx)).toEqual(UNAVAILABLE);
  });

  it('유효 기간 밖, 약관 출처 누락, 승인자 누락, 내용 해시 불일치도 RULES_UNAVAILABLE 이다', () => {
    const rules = planningExampleRuleSet().rules;
    expect(viaBundle(ruleSetOf(rules, { validity: { from: '2025-01-01', to: '2025-12-31' } }), ctx)).toEqual(UNAVAILABLE);
    expect(viaBundle(ruleSetOf(rules, { policySources: [] }), ctx)).toEqual(UNAVAILABLE);
    expect(viaBundle(ruleSetOf(rules, { policySources: [{ ...testPolicySource('DOC'), verifiedBy: '' }] }), ctx)).toEqual(UNAVAILABLE);
    expect(viaBundle(ruleSetOf(rules, { approver: null }), ctx)).toEqual(UNAVAILABLE);
    expect(viaBundle({ ...planningExampleRuleSet(), rules: rules.slice(1) }, ctx)).toEqual(UNAVAILABLE);
    expect(viaBundle(ruleSetOf(rules, { contentHash: '' }), ctx)).toEqual(UNAVAILABLE);
  });

  it('봉인은 맞지만 구조 결함이 있는 묶음은 RULES_UNAVAILABLE 이다 (고치거나 일부만 쓰지 않는다)', () => {
    const defective = ruleSetOf([plainRule('RECEIPT', {}, '시험 사유', 1), plainRule('MEDICAL_OPINION', { imaging: false } as never, '시험 사유', 1)]);
    expect(viaBundle(defective, ctx)).toEqual(UNAVAILABLE);
  });

  it('deriveDocuments 에 구조가 틀린 묶음을 곧바로 넘겨도 던지지 않고 RULES_UNAVAILABLE 이다 (최후의 안전망)', () => {
    const malformed: unknown[] = [
      undefined,
      7,
      'x',
      [],
      {},
      { rules: 'x' },
      { rules: null },
      { rules: [null] },
      { rules: [{ documentCode: 'RECEIPT', when: {}, reason: 'r', priority: -1 }] },
      { rules: [{ documentCode: 'NOPE', when: {}, reason: 'r', priority: 1 }] },
      { rules: [{ documentCode: 'RECEIPT', when: { imaging: false }, reason: 'r', priority: 1 }] },
      { rules: [{ documentCode: 'RECEIPT', when: { foo: true }, reason: 'r', priority: 1 }] },
      { rules: [{ documentCode: 'RECEIPT', when: {}, reason: '', priority: 1 }] },
    ];
    for (const ruleSet of malformed) {
      expect(derive({ ruleSet: ruleSet as DocumentRuleSet }), JSON.stringify(ruleSet)).toEqual(UNAVAILABLE);
    }
  });

  it('머리 정보(상태·출처·승인자 등)는 deriveDocuments 가 보지 않는다: 구조가 맞으면 AVAILABLE 이며 판정은 호출하는 쪽(selectDocumentRuleSet)의 몫이다 (결정)', () => {
    const draft = ruleSetOf(planningExampleRuleSet().rules, { state: 'DRAFT' });
    expect(derive({ ruleSet: draft })?.state).toBe('AVAILABLE');
  });
});

describe('AC-007e 전체 결과가 ON_HOLD 이면 null', () => {
  const sets: Array<[string, DocumentRuleSet | null]> = [
    ['사용 가능한 묶음', planningExampleRuleSet()],
    ['묶음 없음(null)', null],
    ['구조 결함 묶음', { ...planningExampleRuleSet(), rules: 'x' as never }],
  ];

  it.each(sets)('ON_HOLD 이면 %s 이어도 null 이다', (_label, ruleSet) => {
    for (const cause of CAUSES) {
      expect(derive({ overallState: 'ON_HOLD', cause, ruleSet })).toBeNull();
    }
  });

  it('알 수 없는 상태 값은 보류로 보고 null 이다: 모르는 상태에서는 서류 목록을 보이지 않는다 (결정)', () => {
    for (const overallState of ['', 'estimated', 'ON-HOLD', 'RULES_UNAVAILABLE', undefined, null, 7, {}, []]) {
      expect(derive({ overallState: overallState as never }), String(overallState)).toBeNull();
    }
  });

  it('입력 자체가 객체가 아니면 던지지 않고 null 이다', () => {
    for (const input of [null, undefined, 7, 'x']) {
      expect(deriveDocuments(input as never)).toBeNull();
    }
  });

  describe('실제 estimate() 결과의 state 를 먹인다 (AC-008g 의 documents = null 절반의 증거일 뿐 AC-008g 를 닫지 않는다)', () => {
    // 예시 줄 4개(T_XRAY·T_ULTRA·T_PHYSIO·T_INJECT)에 대응하는 치료 4개. 서류 표시는 없다.
    const exampleTreatments = [T_XRAY, T_ULTRA, T_PHYSIO, T_INJECT].map(() => treatmentWith({}));

    it('정상 계산(ESTIMATED)은 AVAILABLE 이다', () => {
      const result = runEstimate(makeInput());
      expect(result.state).toBe('ESTIMATED');
      expect(derive({ overallState: result.state, treatments: exampleTreatments })?.state).toBe('AVAILABLE');
    });

    it('확인된 제외만 있는 계산(ESTIMATED_WITH_EXCLUSIONS)도 AVAILABLE 이다', () => {
      const result = runEstimate(caseInput({ groups: CASE_E, excluded: [T_XRAY, T_ULTRA, T_PHYSIO, T_INJECT] }));
      expect(result.state).toBe('ESTIMATED_WITH_EXCLUSIONS');
      expect(derive({ overallState: result.state, treatments: exampleTreatments })?.state).toBe('AVAILABLE');
    });

    it('묶음 중지로 ON_HOLD 인 계산은 null 이다', () => {
      const result = runEstimate(makeInput({ bundle: makeBundle({ status: 'SUSPENDED' }) }));
      expect(result.state).toBe('ON_HOLD');
      expect(derive({ overallState: result.state, treatments: exampleTreatments })).toBeNull();
    });

    it('프로필이 없어 ON_HOLD 인 계산도 null 이다', () => {
      const result = runEstimate(makeInput({ bundle: makeBundle({ profiles: [] }) }));
      expect(result.state).toBe('ON_HOLD');
      expect(derive({ overallState: result.state, treatments: exampleTreatments })).toBeNull();
    });

    it('규칙 사용 범위가 없는 계산(bundle = null)도 ON_HOLD 라 null 이다', () => {
      const outcome = estimate(makeInput({ bundle: null }), { digest: testDigest });
      if (!outcome.ok) throw new Error('거절되었다');
      expect(outcome.result.state).toBe('ON_HOLD');
      expect(derive({ overallState: outcome.result.state })).toBeNull();
    });
  });
});

describe('AC-007h 전용 줄 수에 상한이 없고 9줄이 세 범위 가운데 정확히 한 곳에 한 번씩 나온다', () => {
  const variants: Array<[string, DocumentRuleSet, ScopeOutcome, number, number]> = [
    ['상해 전용 2줄 + 질병 전용 3줄', ruleSetTwoInjuryThreeIllness(), TWO_INJURY_THREE_ILLNESS_OUTCOME, 2, 3],
    ['상해 전용 0줄 + 질병 전용 4줄', ruleSetZeroInjuryFourIllness(), ZERO_INJURY_FOUR_ILLNESS_OUTCOME, 0, 4],
    ['상해 전용 0줄 + 질병 전용 0줄', ruleSetNoCauseLines(), NO_CAUSE_LINES_OUTCOME, 0, 0],
  ];

  it.each(variants)('%s: 9줄 키가 정확히 한 번씩, 범위가 규칙 평가와 맞고, 필요한 줄마다 사유가 있다', (_label, ruleSet, expected, injuryCount, illnessCount) => {
    const result = available(derive({ cause: 'UNKNOWN', ruleSet }));
    expect(result.mode).toBe('UNKNOWN_CAUSE');
    expect(result.lines.map((line) => line.line)).toEqual([...DOCUMENT_LINE_KEYS]);
    expect(new Set(result.lines.map((line) => line.line)).size).toBe(9);
    const outcome = outcomeOf(result);
    expect(outcome).toEqual(expected);
    expect(outcome.injuryOnly).toHaveLength(injuryCount);
    expect(outcome.illnessOnly).toHaveLength(illnessCount);
    // 세 범위의 줄 수 합이 9 이다: 빠진 줄도 중복된 줄도 없다
    expect(outcome.common.length + outcome.injuryOnly.length + outcome.illnessOnly.length).toBe(9);
    for (const line of result.lines) {
      expect(line.scope, line.line).toBeDefined();
      if (line.required) {
        expect(line.reasons?.length ?? 0, line.line).toBeGreaterThan(0);
      } else {
        expect(line.reasons, line.line).toBeUndefined();
      }
    }
    expect(lineOf(result, 'RECEIPT_AND_ITEMIZED').required).toBe(true);
    expect(lineOf(result, 'RECEIPT_AND_ITEMIZED').scope).toBe('COMMON');
  });

  /** 한 줄(MEDICAL_OPINION)에 상해 평가와 질병 평가가 서로 다른 규칙을 주는 묶음. */
  function twoCauseSet(injury: [string, number], illness: [string, number]): DocumentRuleSet {
    return ruleSetOf([
      plainRule('MEDICAL_OPINION', { cause: 'INJURY' }, injury[0], injury[1]),
      plainRule('MEDICAL_OPINION', { cause: 'ILLNESS' }, illness[0], illness[1]),
    ]);
  }
  const opinion = (ruleSet: DocumentRuleSet) => lineOf(available(derive({ ruleSet })), 'MEDICAL_OPINION');

  it('COMMON 줄의 두 평가가 다른 사유를 내면 우선순위 순으로 둘 다 가진다 (상해 3 · 질병 5 → 상해, 질병)', () => {
    expect(opinion(twoCauseSet(['상해 사유', 3], ['질병 사유', 5]))).toEqual({ line: 'MEDICAL_OPINION', required: true, scope: 'COMMON', reasons: ['상해 사유', '질병 사유'] });
  });

  it('상해 5 · 질병 3 이면 순서가 뒤집힌다 (질병, 상해)', () => {
    expect(opinion(twoCauseSet(['상해 사유', 5], ['질병 사유', 3])).reasons).toEqual(['질병 사유', '상해 사유']);
  });

  it('우선순위가 같으면 상해 평가의 사유가 먼저다 (규칙 배열 순서와 무관)', () => {
    const set = twoCauseSet(['상해 사유', 4], ['질병 사유', 4]);
    expect(opinion(set).reasons).toEqual(['상해 사유', '질병 사유']);
    expect(opinion({ ...set, rules: [...set.rules].reverse() }).reasons).toEqual(['상해 사유', '질병 사유']);
  });

  it('두 평가의 사유 문장이 같으면 우선순위가 달라도 사유는 하나다 (먼저 오는 쪽의 한 번)', () => {
    expect(opinion(twoCauseSet(['같은 사유', 3], ['같은 사유', 5])).reasons).toEqual(['같은 사유']);
    expect(opinion(twoCauseSet(['같은 사유', 5], ['같은 사유', 3])).reasons).toEqual(['같은 사유']);
    expect(opinion(twoCauseSet(['같은 사유', 4], ['같은 사유', 4])).reasons).toEqual(['같은 사유']);
  });

  it('RECEIPT_AND_ITEMIZED 는 어느 경우에도 필요이고, 한쪽 평가에만 사유가 있으면 그 사유 하나, 어느 쪽에도 없으면 사유가 없다', () => {
    const both = ruleSetOf([plainRule('RECEIPT', { cause: 'INJURY' }, '상해 영수증', 3), plainRule('ITEMIZED_STATEMENT', { cause: 'ILLNESS' }, '질병 세부내역', 5)]);
    expect(lineOf(available(derive({ ruleSet: both })), 'RECEIPT_AND_ITEMIZED')).toEqual({
      line: 'RECEIPT_AND_ITEMIZED',
      required: true,
      scope: 'COMMON',
      reasons: ['상해 영수증', '질병 세부내역'],
    });
    const injuryOnlyReason = ruleSetOf([plainRule('RECEIPT', { cause: 'INJURY' }, '상해 영수증', 3)]);
    expect(lineOf(available(derive({ ruleSet: injuryOnlyReason })), 'RECEIPT_AND_ITEMIZED')).toEqual({
      line: 'RECEIPT_AND_ITEMIZED',
      required: true,
      scope: 'COMMON',
      reasons: ['상해 영수증'],
    });
    expect(lineOf(available(derive({ ruleSet: ruleSetOf([]) })), 'RECEIPT_AND_ITEMIZED')).toEqual({ line: 'RECEIPT_AND_ITEMIZED', required: true, scope: 'COMMON' });
  });

  it('원인을 하나로 고르지 않는다: 원인 모름의 결과에는 단일 원인 결과에 없는 두 전용 범위가 함께 나온다', () => {
    const unknown = outcomeOf(available(derive({ cause: 'UNKNOWN' })));
    expect(unknown.injuryOnly.length).toBeGreaterThan(0);
    expect(unknown.illnessOnly.length).toBeGreaterThan(0);
  });
});

describe('입력 방어와 순수성 (DD-06, 결정 항목)', () => {
  it('깊이 동결한 입력도 던지지 않고 바꾸지 않으며 같은 입력은 거듭 불러도 같은 결과다', () => {
    const input = deepFreeze(documentInput({ treatments: [treatmentWith({ imaging: true }), treatmentWith({})] }));
    const before = JSON.stringify(input);
    const first = deriveDocuments(input);
    expect(JSON.stringify(deriveDocuments(input))).toBe(JSON.stringify(first));
    expect(JSON.stringify(input)).toBe(before);
  });

  it('결과는 입력 묶음의 객체를 공유하지 않는다 (결과 배열을 바꿔도 입력이 변하지 않는다)', () => {
    const input = documentInput();
    const result = available(deriveDocuments(input));
    result.lines[0]?.reasons?.push('끼어든 사유');
    expect(JSON.stringify(input.ruleSet)).toBe(JSON.stringify(planningExampleRuleSet()));
  });

  it('묶음의 id·버전·출처는 받은 값을 그대로 싣는다 (출처 판정은 호출하는 쪽의 몫)', () => {
    const set = ruleSetOf([], { id: 'TEST_DOCUMENT_RULES_ID_X', version: 'v7', origin: 'OPERATING' });
    const result = available(derive({ ruleSet: set }));
    expect([result.ruleSetId, result.ruleSetVersion, result.origin]).toEqual(['TEST_DOCUMENT_RULES_ID_X', 'v7', 'OPERATING']);
  });

  it('잘못된 cause 값은 원인 모름으로 평가한다: 원인을 임의로 고르지 않는다 (결정)', () => {
    const unknown = JSON.stringify(derive({ cause: 'UNKNOWN' }));
    for (const cause of ['injury', '', 'BOTH', undefined, null, 7]) {
      expect(JSON.stringify(derive({ cause: cause as never })), String(cause)).toBe(unknown);
    }
  });

  it('잘못된 treatments(배열 아님, null 요소, 객체 아닌 documentFlags, 불리언이 아닌 표시값)는 던지지 않고 표시를 더하지 않는다 (결정)', () => {
    const flagRules = ruleSetOf([
      plainRule('IMAGING_READING', { imaging: true }, '영상', 1),
      plainRule('BIOPSY_RESULT', { biopsy: true }, '조직', 1),
      plainRule('MEDICAL_OPINION', { opinionRequired: true }, '소견', 1),
    ]);
    const baseline = JSON.stringify(derive({ ruleSet: flagRules, treatments: [] }));
    const bad: unknown[] = [
      undefined,
      null,
      'imaging',
      { length: 1 },
      [null],
      [undefined],
      [7],
      ['x'],
      [[]],
      [{}],
      [{ documentFlags: null }],
      [{ documentFlags: 'imaging' }],
      [{ documentFlags: [] }],
      [{ documentFlags: { imaging: 'true', biopsy: 1, opinionRequired: {} } }],
      [{ documentFlags: { imaging: 'true' } }, null, { documentFlags: { biopsy: 1 } }],
    ];
    for (const treatments of bad) {
      expect(JSON.stringify(derive({ ruleSet: flagRules, treatments: treatments as never })), JSON.stringify(treatments)).toBe(baseline);
    }
    // 잘못된 요소가 섞여 있어도 올바른 요소의 표시는 센다
    const mixed = available(derive({ ruleSet: flagRules, treatments: [null, treatmentWith({ biopsy: true })] as never }));
    expect(lineOf(mixed, 'BIOPSY_RESULT').required).toBe(true);
    expect(lineOf(mixed, 'IMAGING_READING').required).toBe(false);
  });

  it('잘못된 insurerType·clinicSetting 값은 던지지 않고 보험사 형태·진료 환경 조건에 맞지 않는다', () => {
    const conditional = ruleSetOf([
      plainRule('MEDICAL_OPINION', { insurerType: 'LIFE' }, '생명', 1),
      plainRule('IMAGING_READING', { setting: 'OUTPATIENT' }, '통원', 1),
    ]);
    const unconditional = ruleSetOf([]);
    for (const garbage of ['', 'life', 'X', undefined, null, 7]) {
      const withInsurer = available(derive({ ruleSet: conditional, insurerType: garbage as never }));
      const withSetting = available(derive({ ruleSet: conditional, clinicSetting: garbage as never }));
      expect(lineOf(withInsurer, 'MEDICAL_OPINION').required, String(garbage)).toBe(false);
      expect(lineOf(withSetting, 'IMAGING_READING').required, String(garbage)).toBe(false);
    }
    expect(available(derive({ ruleSet: unconditional })).lines.filter((line) => line.required)).toHaveLength(1);
  });

  it('규칙이 없는 입력 결과와 있는 입력 결과는 서로 다른 객체이고 결과 줄은 매번 새로 만든다', () => {
    const a = available(derive());
    const b = available(derive());
    expect(a).not.toBe(b);
    expect(a.lines[0]).not.toBe(b.lines[0]);
    expect(a).toEqual(b);
  });
});
