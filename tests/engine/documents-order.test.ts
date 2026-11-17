import { describe, expect, it } from 'vitest';
import { deriveDocuments } from '../../src/engine/documents';
import type { Cause, DocumentLine, DocumentLineKey, DocumentRule, DocumentsResult } from '../../src/engine/types';
import { DOCUMENT_LINE_KEYS } from '../../src/engine/types';
import { documentInput, plainRule, ruleSetOf, treatmentWith } from '../fixtures/engine/document-rules.fixture';

// M2.B: AC-007l 우선순위·동률·순서 독립 (design.md DD-06 "규칙 평가" 6~8번, DD-03 "출력 순서와 순서 독립").
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 서류 요건이 아니다.

type Available = Extract<DocumentsResult, { state: 'AVAILABLE' }>;

/** 고정 시드 순열 시험의 시드와 시행 수. 시험 이름에도 찍어 출력에 기록한다. */
const SHUFFLE_SEED = 20261015;
const SHUFFLE_TRIALS = 200;

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

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

/** 고정 시드 의사 난수(mulberry32). 같은 시드는 같은 순열을 낸다. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = copy[index] as T;
    copy[index] = copy[swap] as T;
    copy[swap] = held;
  }
  return copy;
}

const opinionOf = (rules: DocumentRule[], cause: Cause = 'INJURY') => lineOf(deriveDocuments(documentInput({ cause, ruleSet: ruleSetOf(rules) })), 'MEDICAL_OPINION');

describe('AC-007l (1) priority 가 작은 규칙의 사유가 나온다', () => {
  const r0 = plainRule('MEDICAL_OPINION', {}, '우선순위 0', 0);
  const r1 = plainRule('MEDICAL_OPINION', {}, '우선순위 1', 1);
  const rMax = plainRule('MEDICAL_OPINION', {}, '우선순위 최댓값', Number.MAX_SAFE_INTEGER);

  it('0, 1, Number.MAX_SAFE_INTEGER 가 섞여 있으면 0 이 이긴다 (배열 순서와 무관)', () => {
    for (const order of permutations([r0, r1, rMax])) {
      expect(opinionOf(order).reasons, order.map((entry) => entry.priority).join(',')).toEqual(['우선순위 0']);
    }
  });

  it('0 이 없으면 1, 둘 다 없으면 최댓값이 이긴다', () => {
    expect(opinionOf([rMax, r1]).reasons).toEqual(['우선순위 1']);
    expect(opinionOf([r1, rMax]).reasons).toEqual(['우선순위 1']);
    expect(opinionOf([rMax]).reasons).toEqual(['우선순위 최댓값']);
  });

  it('조건이 맞지 않는 규칙은 우선순위가 높아도 이기지 못한다', () => {
    const wrongCause = plainRule('MEDICAL_OPINION', { cause: 'ILLNESS' }, '질병 규칙', 0);
    expect(opinionOf([wrongCause, r1], 'INJURY').reasons).toEqual(['우선순위 1']);
  });
});

describe('AC-007l (2) 우선순위가 같으면 reason 의 유니코드 코드 포인트 순에서 앞선 사유가 이긴다', () => {
  it('U+FF5E 한 글자와 U+1F600 한 글자: 코드 포인트 순으로는 U+FF5E 가 앞서고, UTF-16 코드 유닛 순(`<`)은 반대다', () => {
    const tilde = String.fromCodePoint(0xff5e);
    const emoji = String.fromCodePoint(0x1f600);
    expect(tilde.codePointAt(0)).toBeLessThan(emoji.codePointAt(0) as number); // 코드 포인트 순
    expect(emoji < tilde).toBe(true); // 단순 `<` 비교는 이모지를 앞세운다: 그대로 쓰면 틀린 승자가 나온다
    const rules = [plainRule('MEDICAL_OPINION', {}, emoji, 3), plainRule('MEDICAL_OPINION', {}, tilde, 3)];
    expect(opinionOf(rules).reasons).toEqual([tilde]);
    expect(opinionOf([...rules].reverse()).reasons).toEqual([tilde]);
  });

  it('ASCII 와 한글: 같은 우선순위에서 사유 문자열이 코드 포인트 순으로 앞선 쪽이 이긴다 (접두 문자열은 짧은 쪽이 앞선다)', () => {
    expect(opinionOf([plainRule('MEDICAL_OPINION', {}, 'b', 1), plainRule('MEDICAL_OPINION', {}, 'a', 1)]).reasons).toEqual(['a']);
    expect(opinionOf([plainRule('MEDICAL_OPINION', {}, '가나', 1), plainRule('MEDICAL_OPINION', {}, '가', 1)]).reasons).toEqual(['가']);
    expect(opinionOf([plainRule('MEDICAL_OPINION', {}, 'Z', 1), plainRule('MEDICAL_OPINION', {}, 'a', 1)]).reasons).toEqual(['Z']); // 대문자가 소문자보다 앞선다
  });

  it('우선순위가 다르면 사유 순서는 보지 않는다 (우선순위가 먼저다)', () => {
    expect(opinionOf([plainRule('MEDICAL_OPINION', {}, 'a', 2), plainRule('MEDICAL_OPINION', {}, 'z', 1)]).reasons).toEqual(['z']);
  });
});

describe('AC-007l (3) 우선순위와 사유가 모두 같으면 어느 규칙이든 같은 출력이다', () => {
  it('같은 줄로 가는 서로 다른 documentCode (RECEIPT, ITEMIZED_STATEMENT) 도 사유·우선순위가 같으면 순서와 관계없이 같은 결과다', () => {
    const a = plainRule('RECEIPT', {}, '같은 사유', 2);
    const b = plainRule('ITEMIZED_STATEMENT', {}, '같은 사유', 2);
    const forward = JSON.stringify(deriveDocuments(documentInput({ ruleSet: ruleSetOf([a, b]) })));
    const reverse = JSON.stringify(deriveDocuments(documentInput({ ruleSet: ruleSetOf([b, a]) })));
    expect(forward).toBe(reverse);
    expect(lineOf(JSON.parse(forward) as DocumentsResult, 'RECEIPT_AND_ITEMIZED').reasons).toEqual(['같은 사유']);
  });

  it('완전히 같은 규칙이 여러 번 있어도 사유는 하나이고 결과가 같다', () => {
    const rule = plainRule('MEDICAL_OPINION', { cause: 'INJURY' }, '복제 규칙', 4);
    const once = JSON.stringify(deriveDocuments(documentInput({ ruleSet: ruleSetOf([rule]) })));
    const thrice = JSON.stringify(deriveDocuments(documentInput({ ruleSet: ruleSetOf([rule, { ...rule, when: { ...rule.when } }, rule]) })));
    expect(thrice).toBe(once);
  });
});

/** 여러 줄·여러 조건을 섞은 규칙 묶음. 같은 줄에 우선순위·사유 동률도 들어 있다. */
function mixedRules(): DocumentRule[] {
  return [
    plainRule('RECEIPT', {}, '영수증', 5),
    plainRule('ITEMIZED_STATEMENT', {}, '내역서', 5),
    plainRule('OUTPATIENT_CONFIRMATION', { setting: 'OUTPATIENT' }, '통원', 4),
    plainRule('ADMISSION_DISCHARGE_CONFIRMATION', { setting: 'INPATIENT' }, '입원(안 맞음)', 1),
    plainRule('INITIAL_EXAM_RECORD', { cause: 'INJURY' }, '초진', 2),
    plainRule('DIAGNOSIS_CERT', { cause: 'ILLNESS' }, '진단 질병', 2),
    plainRule('DIAGNOSIS_CERT', { cause: 'INJURY', insurerType: 'NON_LIFE' }, '진단 상해', 3),
    plainRule('IMAGING_READING', { imaging: true }, '영상', 1),
    plainRule('BIOPSY_RESULT', { biopsy: true }, '조직(표시 없음)', 1),
    plainRule('MEDICAL_OPINION', { insurerType: 'LIFE' }, '생명(안 맞음)', 1),
    plainRule('TREATMENT_CONFIRMATION', { cause: 'INJURY' }, '진료확인 상해', 3),
    plainRule('TREATMENT_CONFIRMATION', { cause: 'ILLNESS' }, '진료확인 질병', 3),
    plainRule('MEDICAL_OPINION', { opinionRequired: true }, '소견 표시', 6),
    plainRule('MEDICAL_OPINION', {}, '소견 기본', 6),
  ];
}

describe('AC-007l (4) 규칙 배열·치료 배열의 순서를 바꿔도 서류 결과가 바이트 단위로 같다', () => {
  it('규칙 6개: 모든 순열(720가지)이 원인 세 값 모두에서 같은 결과다', () => {
    const six = mixedRules().slice(0, 6);
    expect(permutations(six)).toHaveLength(720);
    for (const cause of ['INJURY', 'ILLNESS', 'UNKNOWN'] as Cause[]) {
      const results = new Set(permutations(six).map((order) => JSON.stringify(deriveDocuments(documentInput({ cause, ruleSet: ruleSetOf(order) })))));
      expect(results.size, cause).toBe(1);
    }
  });

  it(`규칙 ${mixedRules().length}개: 고정 시드 ${SHUFFLE_SEED}, 시행 ${SHUFFLE_TRIALS}회 섞어도 결과가 같다`, () => {
    // 시드와 시행 수를 출력에 기록한다 (테스트 이름과 이 한 줄)
    console.info(`AC-007l 고정 시드 순열: seed=${SHUFFLE_SEED} trials=${SHUFFLE_TRIALS}`);
    const rules = mixedRules();
    const random = seededRandom(SHUFFLE_SEED);
    const flags = [treatmentWith({ imaging: true })];
    for (const cause of ['INJURY', 'ILLNESS', 'UNKNOWN'] as Cause[]) {
      const expected = JSON.stringify(deriveDocuments(documentInput({ cause, treatments: flags, ruleSet: ruleSetOf(rules) })));
      for (let trial = 0; trial < SHUFFLE_TRIALS; trial += 1) {
        const order = shuffled(rules, random);
        expect(JSON.stringify(deriveDocuments(documentInput({ cause, treatments: flags, ruleSet: ruleSetOf(order) }))), `${cause} seed=${SHUFFLE_SEED} trial=${trial}`).toBe(expected);
      }
    }
  });

  it('섞기 시험이 빈 시험이 아니다: 같은 시드는 같은 순열을 내고, 시행 중 원래 순서와 다른 순열이 실제로 나온다', () => {
    const rules = mixedRules();
    const a = seededRandom(SHUFFLE_SEED);
    const b = seededRandom(SHUFFLE_SEED);
    expect(shuffled(rules, a)).toEqual(shuffled(rules, b));
    const random = seededRandom(SHUFFLE_SEED);
    const different = Array.from({ length: SHUFFLE_TRIALS }, () => shuffled(rules, random)).filter((order) => order.some((entry, index) => entry !== rules[index]));
    expect(different.length).toBeGreaterThan(SHUFFLE_TRIALS / 2);
  });

  it('선택한 치료 4개의 모든 순열(24가지)이 같은 결과다 (서로 다른 표시를 가진 치료)', () => {
    const treatments = [treatmentWith({ imaging: true }), treatmentWith({ biopsy: true }), treatmentWith({}), treatmentWith({ opinionRequired: true })];
    const orders = permutations(treatments);
    expect(orders).toHaveLength(24);
    for (const cause of ['INJURY', 'UNKNOWN'] as Cause[]) {
      const results = new Set(orders.map((order) => JSON.stringify(deriveDocuments(documentInput({ cause, treatments: order, ruleSet: ruleSetOf(mixedRules()) })))));
      expect(results.size, cause).toBe(1);
    }
  });
});

describe('AC-007l (5) 원인 UNKNOWN 의 혼합 묶음: 9줄이 한 범위에 한 번씩, COMMON 사유는 우선순위 순', () => {
  const result = available(deriveDocuments(documentInput({ cause: 'UNKNOWN', insurerType: 'NON_LIFE', treatments: [treatmentWith({ imaging: true })], ruleSet: ruleSetOf(mixedRules()) })));

  it('9줄 키가 고정 순서로 정확히 한 번씩 나오고 각 줄은 세 범위 가운데 하나에 있다', () => {
    expect(result.lines.map((line) => line.line)).toEqual([...DOCUMENT_LINE_KEYS]);
    for (const line of result.lines) {
      expect(['COMMON', 'INJURY_ONLY', 'ILLNESS_ONLY'], line.line).toContain(line.scope);
    }
  });

  it('원인별 규칙: 초진기록지는 상해 전용, 진단서는 상해 평가(보험사 형태 규칙)와 질병 평가가 모두 필요라 COMMON 이고 사유가 우선순위 순으로 둘이다', () => {
    expect(lineOf(result, 'INITIAL_EXAM_RECORD')).toEqual({ line: 'INITIAL_EXAM_RECORD', required: true, scope: 'INJURY_ONLY', reasons: ['초진'] });
    // 질병 평가: 진단 질병(2), 상해 평가: 진단 상해(3, 손해보험 규칙) → 우선순위 순
    expect(lineOf(result, 'DIAGNOSIS_CERT')).toEqual({ line: 'DIAGNOSIS_CERT', required: true, scope: 'COMMON', reasons: ['진단 질병', '진단 상해'] });
  });

  it('우선순위가 같은 COMMON 줄은 상해 평가의 사유가 먼저다', () => {
    expect(lineOf(result, 'TREATMENT_CONFIRMATION')).toEqual({ line: 'TREATMENT_CONFIRMATION', required: true, scope: 'COMMON', reasons: ['진료확인 상해', '진료확인 질병'] });
  });

  it('보험사 형태·표시·진료 환경 규칙: 맞는 규칙만 줄을 필요로 만든다 (입원, 생명보험, 조직검사 표시 없음은 맞지 않는다)', () => {
    expect(lineOf(result, 'IMAGING_READING')).toEqual({ line: 'IMAGING_READING', required: true, scope: 'COMMON', reasons: ['영상'] });
    expect(lineOf(result, 'OUTPATIENT_CONFIRMATION')).toMatchObject({ required: true, scope: 'COMMON', reasons: ['통원'] });
    expect(lineOf(result, 'ADMISSION_DISCHARGE_CONFIRMATION')).toEqual({ line: 'ADMISSION_DISCHARGE_CONFIRMATION', required: false, scope: 'COMMON' });
    expect(lineOf(result, 'BIOPSY_RESULT')).toEqual({ line: 'BIOPSY_RESULT', required: false, scope: 'COMMON' });
  });

  it('when: {} 규칙은 두 평가 모두에 맞고, 같은 우선순위의 소견 두 규칙은 사유 코드 포인트 순에서 앞선 사유 하나로 모인다', () => {
    // 소견: 표시 없음 → '소견 기본'(6)만 맞다. 두 평가의 사유가 같으므로 하나.
    expect(lineOf(result, 'MEDICAL_OPINION')).toEqual({ line: 'MEDICAL_OPINION', required: true, scope: 'COMMON', reasons: ['소견 기본'] });
    expect(lineOf(result, 'RECEIPT_AND_ITEMIZED')).toEqual({ line: 'RECEIPT_AND_ITEMIZED', required: true, scope: 'COMMON', reasons: ['내역서'] }); // 영수증/내역서 동률 → "내" < "영"
  });

  it('우선순위가 달라도 사유 문장이 같으면 COMMON 사유는 하나로 모인다', () => {
    const set = ruleSetOf([plainRule('MEDICAL_OPINION', { cause: 'INJURY' }, '같은 문장', 1), plainRule('MEDICAL_OPINION', { cause: 'ILLNESS' }, '같은 문장', 9)]);
    expect(lineOf(deriveDocuments(documentInput({ ruleSet: set })), 'MEDICAL_OPINION').reasons).toEqual(['같은 문장']);
  });
});
