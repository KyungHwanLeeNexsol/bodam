import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import type { CheckedResult } from '../../src/engine/numeric';
import { GENERATIONS } from '../../src/engine/types';
import type { EstimateInput, PublishedLine } from '../../src/engine/types';
import { compareCodePoints, isGeneration, validateEstimateInput } from '../../src/engine/validate';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.
// 금액은 기획서 §5 예시 치료 4종을 옮긴 시험 사본(합계 124,000)이다.

function line(treatmentId: string, patientAmount: number, overrides: Partial<PublishedLine> = {}): PublishedLine {
  return {
    treatmentId,
    treatmentVersionId: `${treatmentId}-v1`,
    displayName: `치료 ${treatmentId}`,
    benefitType: 'BENEFIT',
    calcClass: 'GENERAL_BENEFIT',
    patientAmount,
    coverageFingerprint: `fp-${treatmentId}`,
    isBaseFee: false,
    documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
    origin: 'TEST_FIXTURE',
    ...overrides,
  };
}

const xray = line('T-XRAY', 10_000);
const ultrasound = line('T-ULTRA', 70_000, { benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT' });
const physio = line('T-PHYSIO', 4_000);
const injection = line('T-INJECT', 40_000, { benefitType: 'NON_BENEFIT', calcClass: 'MAJOR_THREE_NON_BENEFIT' });

function input(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    generation: 'GEN4_C4',
    insurerType: 'NON_LIFE',
    treatmentIds: ['T-XRAY', 'T-ULTRA', 'T-PHYSIO', 'T-INJECT'],
    lines: [xray, ultrasound, physio, injection],
    baseFeeLines: [],
    bundle: null,
    at: '2026-10-15',
    acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] },
    ...overrides,
  };
}

/** 열거 밖·무효 값을 형식 검사를 거치지 않고 넣기 위한 변환. 엔진은 JS 호출자도 믿지 않는다. */
function loose<T>(value: unknown): T {
  return value as T;
}

describe('isGeneration — 세대 열거 (DD-03)', () => {
  it.each(GENERATIONS.map((generation) => [generation]))('열거값 %s 는 유효하다', (generation) => {
    expect(isGeneration(generation)).toBe(true);
  });

  it.each([
    ['5세대 문자열 GEN5_C5', 'GEN5_C5'],
    ['소문자 gen1_as', 'gen1_as'],
    ['앞 공백이 있는 값', ' GEN1_AS'],
    ['빈 문자열', ''],
    ['숫자 4', 4],
    ['null', null],
    ['undefined', undefined],
    ['객체', {}],
  ])('열거 밖: %s', (_name, value) => {
    expect(isGeneration(value)).toBe(false);
  });
});

describe('compareCodePoints — 유니코드 코드 포인트 순 (DD-03 출력 순서)', () => {
  it('같은 문자열은 0, 앞선 쪽은 음수, 뒤선 쪽은 양수다', () => {
    expect(compareCodePoints('A', 'A')).toBe(0);
    expect(compareCodePoints('A', 'B')).toBeLessThan(0);
    expect(compareCodePoints('B', 'A')).toBeGreaterThan(0);
    expect(compareCodePoints('A', 'AB')).toBeLessThan(0);
    expect(compareCodePoints('AB', 'A')).toBeGreaterThan(0);
    expect(compareCodePoints('', 'A')).toBeLessThan(0);
    expect(compareCodePoints('', '')).toBe(0);
  });

  it('BMP 문자(U+FF5E)가 보충 문자(U+1F600)보다 앞선다 (UTF-16 코드 단위 순서와 다르다)', () => {
    const bmp = '～';
    const astral = '\u{1F600}';
    expect(compareCodePoints(bmp, astral)).toBeLessThan(0);
    expect(compareCodePoints(astral, bmp)).toBeGreaterThan(0);
    // 기본 sort() 는 UTF-16 코드 단위로 비교하므로 순서가 뒤집힌다.
    expect([bmp, astral].sort()).toEqual([astral, bmp]);
  });
});

describe('validateEstimateInput — 정상 입력', () => {
  it('유효한 입력은 통과하고 예상 병원 결제액 T 는 124,000 이다', () => {
    const result = validateEstimateInput(input());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.generation).toBe('GEN4_C4');
    expect(result.value.hospitalPayment).toBe(124_000);
    expect(result.value.lines).toHaveLength(4);
  });

  it('다섯 세대 값 모두 통과한다', () => {
    for (const generation of GENERATIONS) {
      expect(validateEstimateInput(input({ generation })).ok).toBe(true);
    }
  });

  it('공통 기본비용 줄의 금액도 T 에 더한다', () => {
    const baseFee = line('B-BASE', 5_000, { isBaseFee: true });
    const result = validateEstimateInput(input({ baseFeeLines: [baseFee] }));
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(129_000);
    expect(result.value.baseFeeLines).toEqual([baseFee]);
  });

  it('줄 합계는 MAX_AMOUNT_WON 을 넘을 수 있다 (줄 하나가 상한 이하이면 된다)', () => {
    const big = ['A', 'B', 'C'].map((id) => line(id, MAX_AMOUNT_WON));
    const result = validateEstimateInput(input({ treatmentIds: ['A', 'B', 'C'], lines: big }));
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(3 * MAX_AMOUNT_WON);
  });

  it('입력의 bundle 은 읽지 않는다 (null 이어도 통과)', () => {
    expect(validateEstimateInput(input({ bundle: null })).ok).toBe(true);
  });

  it('입력을 바꾸지 않는다 (깊게 동결한 입력도 통과)', () => {
    const frozen = input();
    for (const l of frozen.lines) Object.freeze(l.documentFlags);
    for (const l of frozen.lines) Object.freeze(l);
    Object.freeze(frozen.lines);
    Object.freeze(frozen.treatmentIds);
    Object.freeze(frozen.baseFeeLines);
    Object.freeze(frozen);
    expect(validateEstimateInput(frozen).ok).toBe(true);
  });
});

describe('validateEstimateInput — 세대 열거 (AC-006a 거절 부분, 증거만; 닫는 곳 M1.2)', () => {
  it.each([
    ['5세대 문자열', 'GEN5_C5'],
    ['빈 문자열', ''],
    ['소문자', 'gen4_c4'],
    ['숫자', 5],
    ['null', null],
    ['undefined', undefined],
  ])('세대가 열거 밖(%s)이면 UNSUPPORTED_GENERATION 으로 거절한다', (_name, generation) => {
    const result = validateEstimateInput(input({ generation: loose(generation) }));
    expect(result).toEqual({ ok: false, rejection: { code: 'UNSUPPORTED_GENERATION' } });
  });

  it('거절 결과에는 값(value)도 병원 결제액도 없다', () => {
    const result = validateEstimateInput(input({ generation: loose('GEN5_C5') }));
    expect('value' in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hospitalPayment');
  });
});

describe('validateEstimateInput — 치료 0개 (AC-006b)', () => {
  it('treatmentIds 가 빈 배열이면 NO_TREATMENT_SELECTED 로 거절하고 0원 결과가 없다', () => {
    const result = validateEstimateInput(input({ treatmentIds: [] }));
    expect(result).toEqual({ ok: false, rejection: { code: 'NO_TREATMENT_SELECTED' } });
    expect('value' in result).toBe(false);
  });

  it('줄이 넘어와 있어도 선택한 치료 ID 가 없으면 거절한다', () => {
    const result = validateEstimateInput(input({ treatmentIds: [] }));
    expect(result.ok).toBe(false);
  });

  it('treatmentIds 가 배열이 아니면(null·undefined) 선택된 치료가 없는 것으로 거절한다', () => {
    expect(validateEstimateInput(input({ treatmentIds: loose(null) }))).toEqual({
      ok: false,
      rejection: { code: 'NO_TREATMENT_SELECTED' },
    });
    expect(validateEstimateInput(input({ treatmentIds: loose(undefined) }))).toEqual({
      ok: false,
      rejection: { code: 'NO_TREATMENT_SELECTED' },
    });
  });

  it('경계 쌍: 치료 1개는 통과하고 0개는 거절한다', () => {
    expect(validateEstimateInput(input({ treatmentIds: ['T-XRAY'], lines: [xray] })).ok).toBe(true);
    expect(validateEstimateInput(input({ treatmentIds: [], lines: [xray] })).ok).toBe(false);
  });
});

describe('validateEstimateInput — 중복 제거 (AC-006c)', () => {
  it('같은 치료 ID 가 중복돼도 한 번만 계산되어 병원 결제액이 124,000 이다', () => {
    const result = validateEstimateInput(
      input({
        treatmentIds: ['T-XRAY', 'T-ULTRA', 'T-PHYSIO', 'T-INJECT', 'T-XRAY', 'T-ULTRA'],
        lines: [xray, ultrasound, physio, injection, xray, ultrasound],
      }),
    );
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(124_000);
    expect(result.value.treatmentIds).toEqual(['T-INJECT', 'T-PHYSIO', 'T-ULTRA', 'T-XRAY']);
    expect(result.value.lines).toHaveLength(4);
  });

  it('치료 ID 만 중복되고 줄은 하나씩이어도 결제액은 같다', () => {
    const result = validateEstimateInput(
      input({ treatmentIds: ['T-XRAY', 'T-XRAY', 'T-ULTRA', 'T-PHYSIO', 'T-INJECT', 'T-INJECT'] }),
    );
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(124_000);
    expect(result.value.treatmentIds).toHaveLength(4);
  });

  it('같은 치료 ID 만 반복해 넣어도 치료 0개가 아니다 (한 개로 센다)', () => {
    const result = validateEstimateInput(input({ treatmentIds: ['T-XRAY', 'T-XRAY'], lines: [xray, xray] }));
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.treatmentIds).toEqual(['T-XRAY']);
    expect(result.value.hospitalPayment).toBe(10_000);
  });

  it('공통 기본비용 줄이 중복돼도 한 번만 더한다', () => {
    const baseFee = line('B-BASE', 5_000, { isBaseFee: true });
    const result = validateEstimateInput(input({ baseFeeLines: [baseFee, baseFee] }));
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(129_000);
    expect(result.value.baseFeeLines).toHaveLength(1);
  });
});

describe('validateEstimateInput — 출력 순서 고정과 순서 독립 (DD-03)', () => {
  it('결과의 치료 ID·줄은 코드 포인트 순이다', () => {
    const result = validateEstimateInput(
      input({
        treatmentIds: ['\u{1F600}', '～', 'B', 'A'],
        lines: [line('\u{1F600}', 1), line('～', 2), line('B', 3), line('A', 4)],
      }),
    );
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.treatmentIds).toEqual(['A', 'B', '～', '\u{1F600}']);
    expect(result.value.lines.map((l) => l.treatmentId)).toEqual(['A', 'B', '～', '\u{1F600}']);
  });

  it('치료 ID·줄·기본비용 배열 순서를 바꿔도 결과가 같다', () => {
    const baseA = line('B-1', 100, { isBaseFee: true });
    const baseB = line('B-2', 200, { isBaseFee: true });
    const ordered = input({ baseFeeLines: [baseA, baseB] });
    const shuffled = input({
      treatmentIds: ['T-INJECT', 'T-XRAY', 'T-PHYSIO', 'T-ULTRA'],
      lines: [injection, xray, physio, ultrasound],
      baseFeeLines: [baseB, baseA],
    });
    expect(validateEstimateInput(shuffled)).toEqual(validateEstimateInput(ordered));
  });
});

describe('validateEstimateInput — 줄 금액 범위 (AC-006h, DD-24)', () => {
  it('경계 쌍: 0 과 MAX_AMOUNT_WON 은 유효하고 MAX_AMOUNT_WON + 1 은 거절된다 (가져온 상수로 시험)', () => {
    const at = (amount: number) => validateEstimateInput(input({ treatmentIds: ['X'], lines: [line('X', amount)] }));
    expect(at(0).ok).toBe(true);
    expect(at(MAX_AMOUNT_WON).ok).toBe(true);
    expect(at(MAX_AMOUNT_WON + 1)).toEqual({
      ok: false,
      rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'LINE_AMOUNT_INVALID' },
    });
  });

  it.each([
    ['음수 −1', -1],
    ['−0', -0],
    ['소수 0.5', 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['−Infinity', Number.NEGATIVE_INFINITY],
    ['문자열 "1000"', '1000'],
    ['null', null],
    ['undefined', undefined],
    ['bigint 1000n', 1000n],
    ['안전하지 않은 정수 2^53', 2 ** 53],
  ])('치료 줄 금액이 %s 이면 INVALID_NUMERIC_INPUT 으로 거절하고 결과가 없다', (_name, amount) => {
    const bad = line('T-BAD', loose<number>(amount));
    const result = validateEstimateInput(input({ lines: [xray, bad], treatmentIds: ['T-XRAY', 'T-BAD'] }));
    expect(result).toEqual({
      ok: false,
      rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'LINE_AMOUNT_INVALID' },
    });
    expect('value' in result).toBe(false);
  });

  it('공통 기본비용 줄의 금액이 무효여도 거절한다', () => {
    const badBase = line('B-BAD', -5, { isBaseFee: true });
    const result = validateEstimateInput(input({ baseFeeLines: [badBase] }));
    expect(result).toEqual({
      ok: false,
      rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'LINE_AMOUNT_INVALID' },
    });
  });

  it('나쁜 줄을 보류로 돌리거나 합계에서 빼지 않는다: 유효한 줄이 많아도 하나가 무효이면 전체 거절이다', () => {
    const bad = line('T-BAD', Number.NaN);
    const result = validateEstimateInput(
      input({ lines: [xray, ultrasound, physio, injection, bad], treatmentIds: ['T-XRAY', 'T-ULTRA', 'T-PHYSIO', 'T-INJECT', 'T-BAD'] }),
    );
    expect(result.ok).toBe(false);
  });

  it('중복으로 걸러질 줄의 금액이 무효여도 조용히 버리지 않고 거절한다 (치료 줄·기본비용 줄 모두)', () => {
    const rejected = {
      ok: false,
      rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'LINE_AMOUNT_INVALID' },
    };
    const duplicateBad = line('T-XRAY', Number.NaN);
    expect(
      validateEstimateInput(input({ lines: [xray, duplicateBad, ultrasound, physio, injection] })),
    ).toEqual(rejected);

    const baseFee = line('B-BASE', 5_000, { isBaseFee: true });
    const baseFeeBad = line('B-BASE', -1, { isBaseFee: true });
    expect(validateEstimateInput(input({ baseFeeLines: [baseFee, baseFeeBad] }))).toEqual(rejected);
  });

  it('입력의 줄 객체를 고쳐 쓰지 않는다 (무효 금액이 0 으로 바뀌지 않음)', () => {
    const bad = line('T-BAD', -1);
    validateEstimateInput(input({ lines: [bad], treatmentIds: ['T-BAD'] }));
    expect(bad.patientAmount).toBe(-1);
  });
});

describe('validateEstimateInput — 병원 결제액 T 의 검사 합산 (AC-006h, AC-003h 10행 엔진 수준)', () => {
  // 줄 금액이 모두 유효한데 합이 안전 정수를 넘는 입력은 ceil((S + 1) / MAX_AMOUNT_WON) 줄이 필요하다(9007200줄).
  // 실제 크기의 입력 대신 acceptance.md AC-003h 10행이 허용하는 방법으로 합산 함수를 시험 대역으로 바꾼다.
  it('합산이 넘치면 보류가 아니라 INVALID_NUMERIC_INPUT(HOSPITAL_PAYMENT_OVERFLOW)으로 거절한다', () => {
    const overflowing = (): CheckedResult => ({ ok: false, reason: 'OVERFLOW', step: 'HOSPITAL_PAYMENT_SUM' });
    const result = validateEstimateInput(input(), overflowing);
    expect(result).toEqual({
      ok: false,
      rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'HOSPITAL_PAYMENT_OVERFLOW' },
    });
    expect('value' in result).toBe(false);
  });

  it('합산 함수가 무효 피연산자를 알리면 줄 금액 무효로 거절한다 (사전 검사를 뚫고 온 경우의 방어)', () => {
    const invalid = (): CheckedResult => ({ ok: false, reason: 'INVALID_OPERAND', step: 'HOSPITAL_PAYMENT_SUM' });
    expect(validateEstimateInput(input(), invalid)).toEqual({
      ok: false,
      rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'LINE_AMOUNT_INVALID' },
    });
  });

  it('합산 함수에는 중복을 제거한 치료 줄과 기본비용 줄의 금액만 코드 포인트 순으로 넘긴다', () => {
    let received: readonly number[] = [];
    const spy = (amounts: readonly number[]): CheckedResult => {
      received = [...amounts];
      return { ok: true, value: 777 };
    };
    const baseFee = line('B-BASE', 5_000, { isBaseFee: true });
    const result = validateEstimateInput(input({ baseFeeLines: [baseFee], lines: [xray, xray, ultrasound, physio, injection] }), spy);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(777);
    expect(received).toEqual([40_000, 4_000, 70_000, 10_000, 5_000]);
  });

  it('실제 합산 함수의 경계 쌍은 numeric.test.ts 가 증명한다: sumLineAmounts([S−1, 1]) 통과, ([S, 1]) 거절', () => {
    // 이 항목은 연결 확인용이다: 기본 합산 함수로도 정상 입력이 124,000 이다.
    const result = validateEstimateInput(input());
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(124_000);
  });
});

describe('validateEstimateInput — 거절 판정 순서 (UNSUPPORTED_GENERATION → NO_TREATMENT_SELECTED → INVALID_NUMERIC_INPUT)', () => {
  const badLine = line('T-BAD', -1);

  it('세 가지가 모두 해당하면 UNSUPPORTED_GENERATION 이 이긴다', () => {
    const result = validateEstimateInput(
      input({ generation: loose('GEN9'), treatmentIds: [], lines: [badLine] }),
    );
    expect(result).toEqual({ ok: false, rejection: { code: 'UNSUPPORTED_GENERATION' } });
  });

  it('세대가 유효하면 NO_TREATMENT_SELECTED 가 INVALID_NUMERIC_INPUT 보다 먼저다', () => {
    const result = validateEstimateInput(input({ treatmentIds: [], lines: [badLine] }));
    expect(result).toEqual({ ok: false, rejection: { code: 'NO_TREATMENT_SELECTED' } });
  });

  it('앞의 둘이 통과해야 비로소 INVALID_NUMERIC_INPUT 이 나온다', () => {
    const result = validateEstimateInput(input({ treatmentIds: ['T-BAD'], lines: [badLine] }));
    expect(result).toEqual({
      ok: false,
      rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'LINE_AMOUNT_INVALID' },
    });
  });
});
