import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import type { CheckedResult } from '../../src/engine/numeric';
import { ENGINE_REJECTION_CODES } from '../../src/engine/types';
import type { EngineRejection, EstimateInput, PublishedLine } from '../../src/engine/types';
import { validateEstimateInput } from '../../src/engine/validate';
import { caseInput, CASE_A } from '../fixtures/engine/cases.fixture';
import { makeInput, makeLine } from '../fixtures/engine/lines.fixture';
import { testDigest } from '../fixtures/engine/profiles.fixture';

// R1 외부 검토 수정: treatmentId 가 같은데 내용이 다른 줄은 입력 순서에 따라 결과가 달라지므로
// 첫 줄을 고르지도 합하지도 않고 결정적으로 거절한다 (INPUT_INTEGRITY_VIOLATION).
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.

const LINE_CONFLICT: EngineRejection = { code: 'INPUT_INTEGRITY_VIOLATION', reason: 'CONFLICTING_DUPLICATE_TREATMENT_LINE' };
const BASE_FEE_CONFLICT: EngineRejection = { code: 'INPUT_INTEGRITY_VIOLATION', reason: 'CONFLICTING_DUPLICATE_BASE_FEE_LINE' };
const NUMERIC_INVALID: EngineRejection = { code: 'INVALID_NUMERIC_INPUT', reason: 'LINE_AMOUNT_INVALID' };

const IDS = ['T-A', 'T-B', 'T-C'];

function loose<T>(value: unknown): T {
  return value as T;
}

function withLines(lines: PublishedLine[], baseFeeLines: PublishedLine[] = [], overrides: Partial<EstimateInput> = {}): EstimateInput {
  // makeInput 은 기본 treatmentIds 를 줄에서 계산하므로 형식이 깨진 줄을 넣기 전에 줄을 덮어쓴다.
  return { ...makeInput({ treatmentIds: IDS, ...overrides }), lines, baseFeeLines };
}

function rejectionOf(input: EstimateInput): EngineRejection {
  const result = validateEstimateInput(input);
  if (result.ok) throw new Error('거절을 기대했으나 통과했다');
  return result.rejection;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

const a1 = makeLine('T-A', 10_000);
const b1 = makeLine('T-B', 20_000);
const c1 = makeLine('T-C', 30_000);

describe('충돌하는 중복 치료 줄 — 어느 한 필드라도 다르면 거절하고 순서와 무관하다', () => {
  const variants: Array<[string, Partial<PublishedLine>]> = [
    ['가격 patientAmount', { patientAmount: 11_000 }],
    ['calcClass 가 NEEDS_REVIEW 인 줄', { calcClass: 'NEEDS_REVIEW' }],
    ['허용 출처와 허용되지 않은 출처(TEST_FIXTURE 대 DEMO)', { origin: 'DEMO' }],
    ['treatmentVersionId', { treatmentVersionId: 'T-A-v2' }],
    ['benefitType', { benefitType: 'NON_BENEFIT' }],
    ['coverageFingerprint', { coverageFingerprint: 'TEST_FP_OTHER' }],
    ['displayName', { displayName: '다른 이름' }],
    ['isBaseFee', { isBaseFee: true }],
    ['documentFlags.imaging', { documentFlags: { imaging: true, biopsy: false, opinionRequired: false } }],
    ['documentFlags.biopsy', { documentFlags: { imaging: false, biopsy: true, opinionRequired: false } }],
    ['documentFlags.opinionRequired', { documentFlags: { imaging: false, biopsy: false, opinionRequired: true } }],
  ];

  it.each(variants)('%s 만 다르면 INPUT_INTEGRITY_VIOLATION 이고 두 순서의 결과가 같다', (_name, change) => {
    const other = makeLine('T-A', 10_000, change);
    const forward = validateEstimateInput(withLines([a1, other, b1, c1]));
    const backward = validateEstimateInput(withLines([other, a1, b1, c1]));
    expect(forward).toEqual({ ok: false, rejection: LINE_CONFLICT });
    expect(backward).toEqual(forward);
    expect('value' in forward).toBe(false);
  });

  it.each(variants)('%s: 중복 두 줄이 배열 안 어디에 있어도(떨어져 있거나 양 끝) 결과가 같다', (_name, change) => {
    const other = makeLine('T-A', 10_000, change);
    const results = [
      withLines([a1, b1, c1, other]),
      withLines([other, b1, c1, a1]),
      withLines([b1, a1, c1, other]),
      withLines([b1, other, a1, c1]),
    ].map((input) => validateEstimateInput(input));
    for (const result of results) expect(result).toEqual({ ok: false, rejection: LINE_CONFLICT });
  });

  it('충돌하는 줄은 합하지도 고르지도 않는다: 결과 객체가 없어 병원 결제액이 만들어지지 않는다', () => {
    const result = validateEstimateInput(withLines([a1, makeLine('T-A', 99_000), b1, c1]));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hospitalPayment');
  });

  it('세 줄 중 셋째만 다르면 거절하고, 6가지 순열 모두 결과가 같다', () => {
    const third = makeLine('T-A', 10_000, { origin: 'DEMO' });
    const perms = permutations([a1, structuredClone(a1), third]);
    expect(perms).toHaveLength(6);
    for (const lines of perms) {
      expect(validateEstimateInput(withLines([...lines, b1, c1])), lines.map((l) => l.origin).join()).toEqual({ ok: false, rejection: LINE_CONFLICT });
    }
  });

  it('서로 다른 세 가지 내용(모두 다름)도 6가지 순열 모두 같은 거절이다', () => {
    const lines = [a1, makeLine('T-A', 11_000), makeLine('T-A', 12_000)];
    for (const perm of permutations(lines)) {
      expect(validateEstimateInput(withLines([...perm, b1, c1]))).toEqual({ ok: false, rejection: LINE_CONFLICT });
    }
  });

  it('충돌이 한 치료 ID 가 아니라 다른 ID 에 있어도 찾는다', () => {
    expect(rejectionOf(withLines([a1, b1, makeLine('T-C', 31_000), c1]))).toEqual(LINE_CONFLICT);
  });
});

describe('내용이 완전히 같은 중복 줄은 한 번만 센다 (AC-006c 유지)', () => {
  it('객체 정체성이 달라도, 키 삽입 순서가 달라도 같은 줄이다', () => {
    const reordered: PublishedLine = {
      origin: 'TEST_FIXTURE',
      documentFlags: { opinionRequired: false, biopsy: false, imaging: false },
      isBaseFee: false,
      coverageFingerprint: a1.coverageFingerprint,
      patientAmount: 10_000,
      calcClass: 'GENERAL_BENEFIT',
      benefitType: 'BENEFIT',
      displayName: a1.displayName,
      treatmentVersionId: a1.treatmentVersionId,
      treatmentId: 'T-A',
    };
    const copies = [a1, structuredClone(a1), reordered, { ...a1, documentFlags: { ...a1.documentFlags } }];
    for (const duplicates of permutations(copies).slice(0, 6)) {
      const result = validateEstimateInput(withLines([...duplicates, b1, c1]));
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.hospitalPayment).toBe(60_000);
      expect(result.value.lines.map((l) => l.treatmentId)).toEqual(['T-A', 'T-B', 'T-C']);
    }
  });

  it('공통 기본비용 줄도 같은 내용이면 한 번만 더한다', () => {
    const base = makeLine('B-1', 5_000, { isBaseFee: true });
    const result = validateEstimateInput(withLines([a1, b1, c1], [base, structuredClone(base)]));
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(65_000);
    expect(result.value.baseFeeLines).toHaveLength(1);
  });
});

describe('공통 기본비용 줄도 따로 검사한다', () => {
  const base = makeLine('B-1', 5_000, { isBaseFee: true });

  it.each([
    ['가격', { patientAmount: 6_000 }],
    ['출처', { origin: 'DEMO' as const }],
    ['calcClass', { calcClass: 'NEEDS_REVIEW' as const }],
    ['documentFlags', { documentFlags: { imaging: true, biopsy: false, opinionRequired: false } }],
  ])('기본비용 줄 %s 만 다르면 CONFLICTING_DUPLICATE_BASE_FEE_LINE 이고 두 순서가 같다', (_name, change) => {
    const other = makeLine('B-1', 5_000, { isBaseFee: true, ...change });
    const forward = validateEstimateInput(withLines([a1, b1, c1], [base, other]));
    const backward = validateEstimateInput(withLines([a1, b1, c1], [other, base]));
    expect(forward).toEqual({ ok: false, rejection: BASE_FEE_CONFLICT });
    expect(backward).toEqual(forward);
  });

  it('기본비용 줄 세 개 중 셋째만 달라도 6가지 순열이 모두 같다', () => {
    const third = makeLine('B-1', 5_000, { isBaseFee: true, patientAmount: 5_001 });
    for (const perm of permutations([base, structuredClone(base), third])) {
      expect(validateEstimateInput(withLines([a1, b1, c1], perm))).toEqual({ ok: false, rejection: BASE_FEE_CONFLICT });
    }
  });

  it('두 배열이 모두 충돌하면 치료 줄 사유가 이긴다 (순서와 무관)', () => {
    const lineOther = makeLine('T-A', 10_001);
    const baseOther = makeLine('B-1', 5_001, { isBaseFee: true });
    for (const lines of [[a1, lineOther, b1, c1], [lineOther, a1, b1, c1]]) {
      for (const baseFees of [[base, baseOther], [baseOther, base]]) {
        expect(validateEstimateInput(withLines(lines, baseFees))).toEqual({ ok: false, rejection: LINE_CONFLICT });
      }
    }
  });

  it('같은 ID 가 치료 줄과 기본비용 줄에 각각 있는 경우(배열 간)는 이 검사의 대상이 아니다', () => {
    // 서로 다른 배열의 같은 ID 는 비교하지 않는다. 서버 책임(M4)이며 아래 "검사하지 않음" 시험이 현재 동작만 기록한다.
    const shared = makeLine('T-A', 10_000, { isBaseFee: true });
    expect(validateEstimateInput(withLines([a1, b1, c1], [shared])).ok).toBe(true);
  });
});

describe('잘못된 금액과 중복의 관계', () => {
  it('내용이 같은 중복이 둘 다 NaN 이면 충돌이 아니라 INVALID_NUMERIC_INPUT 이다 (NaN 은 같은 값으로 본다)', () => {
    const nanA = makeLine('T-A', Number.NaN);
    const nanB = makeLine('T-A', Number.NaN);
    expect(validateEstimateInput(withLines([nanA, nanB, b1, c1]))).toEqual({ ok: false, rejection: NUMERIC_INVALID });
    expect(validateEstimateInput(withLines([b1, nanB, c1, nanA]))).toEqual({ ok: false, rejection: NUMERIC_INVALID });
  });

  it('한쪽만 무효 금액인 서로 다른 중복 쌍은 INPUT_INTEGRITY_VIOLATION 이다 (두 순서 모두)', () => {
    for (const bad of [Number.NaN, -1, 0.5, MAX_AMOUNT_WON + 1]) {
      const invalid = makeLine('T-A', bad);
      expect(validateEstimateInput(withLines([a1, invalid, b1, c1]))).toEqual({ ok: false, rejection: LINE_CONFLICT });
      expect(validateEstimateInput(withLines([invalid, a1, b1, c1]))).toEqual({ ok: false, rejection: LINE_CONFLICT });
    }
    const baseValid = makeLine('B-1', 5_000, { isBaseFee: true });
    const baseInvalid = makeLine('B-1', -5, { isBaseFee: true });
    expect(validateEstimateInput(withLines([a1, b1, c1], [baseValid, baseInvalid]))).toEqual({ ok: false, rejection: BASE_FEE_CONFLICT });
  });

  it('−0 과 0 은 서로 다른 값으로 본다: 금액 0 인 줄과 −0 인 줄의 중복은 충돌이다', () => {
    expect(validateEstimateInput(withLines([makeLine('T-A', 0), makeLine('T-A', -0), b1, c1]))).toEqual({ ok: false, rejection: LINE_CONFLICT });
    expect(validateEstimateInput(withLines([makeLine('T-A', -0), makeLine('T-A', 0), b1, c1]))).toEqual({ ok: false, rejection: LINE_CONFLICT });
  });

  it('중복되지 않은 무효 금액은 이전과 같이 INVALID_NUMERIC_INPUT 이다', () => {
    expect(validateEstimateInput(withLines([a1, makeLine('T-B', -1), c1]))).toEqual({ ok: false, rejection: NUMERIC_INVALID });
    expect(validateEstimateInput(withLines([a1, b1, c1], [makeLine('B-1', Number.NaN, { isBaseFee: true })]))).toEqual({ ok: false, rejection: NUMERIC_INVALID });
  });
});

describe('거절 판정 순서: UNSUPPORTED_GENERATION → NO_TREATMENT_SELECTED → INPUT_INTEGRITY_VIOLATION → INVALID_NUMERIC_INPUT', () => {
  const conflicting = [a1, makeLine('T-A', 10_001), b1, c1];

  it('거절 코드 목록의 순서가 판정 순서다', () => {
    expect([...ENGINE_REJECTION_CODES]).toEqual([
      'UNSUPPORTED_GENERATION',
      'NO_TREATMENT_SELECTED',
      'INPUT_INTEGRITY_VIOLATION',
      'INVALID_NUMERIC_INPUT',
    ]);
  });

  it('세대가 열거 밖이면 충돌보다 UNSUPPORTED_GENERATION 이 이긴다', () => {
    expect(validateEstimateInput(withLines(conflicting, [], { generation: loose('GEN9') }))).toEqual({ ok: false, rejection: { code: 'UNSUPPORTED_GENERATION' } });
  });

  it('선택한 치료가 없으면 충돌보다 NO_TREATMENT_SELECTED 가 이긴다 (치료 ID 없음, 치료 줄 없음 모두)', () => {
    expect(validateEstimateInput(withLines(conflicting, [], { treatmentIds: [] }))).toEqual({ ok: false, rejection: { code: 'NO_TREATMENT_SELECTED' } });
    const baseConflict = [makeLine('B-1', 1, { isBaseFee: true }), makeLine('B-1', 2, { isBaseFee: true })];
    expect(validateEstimateInput(withLines([], baseConflict))).toEqual({ ok: false, rejection: { code: 'NO_TREATMENT_SELECTED' } });
  });

  it('충돌은 숫자 검사보다 먼저다: 다른 줄의 무효 금액이 있어도 충돌이 이긴다', () => {
    expect(validateEstimateInput(withLines([...conflicting, makeLine('T-D', -1)]))).toEqual({ ok: false, rejection: LINE_CONFLICT });
  });

  it('충돌은 합계 T 의 검사 합산보다 먼저다: 합산 함수를 부르지 않는다', () => {
    let calls = 0;
    const overflowing = (): CheckedResult => {
      calls += 1;
      return { ok: false, reason: 'OVERFLOW', step: 'HOSPITAL_PAYMENT_SUM' };
    };
    expect(validateEstimateInput(withLines(conflicting), overflowing)).toEqual({ ok: false, rejection: LINE_CONFLICT });
    expect(calls).toBe(0);
    // 충돌이 없으면 같은 대역이 합산 단계까지 가고, 합계 넘침은 INVALID_NUMERIC_INPUT 이다.
    expect(validateEstimateInput(withLines([a1, b1, c1]), overflowing)).toEqual({
      ok: false,
      rejection: { code: 'INVALID_NUMERIC_INPUT', reason: 'HOSPITAL_PAYMENT_OVERFLOW' },
    });
    expect(calls).toBe(1);
  });
});

describe('거절 객체에는 치료 ID·금액·내부 상세가 없다 (AC-006i와 같은 진단 전용 방침)', () => {
  it('코드와 사유 두 키뿐이고 직렬화에 치료 ID·금액·줄 내용이 없다', () => {
    const secret = makeLine('T-SECRET-ID', 987_654, { displayName: '비밀 이름' });
    const other = makeLine('T-SECRET-ID', 987_655, { displayName: '비밀 이름' });
    const result = validateEstimateInput(withLines([secret, other, b1, c1], [], { treatmentIds: ['T-SECRET-ID', 'T-B', 'T-C'] }));
    if (result.ok) throw new Error('unreachable');
    expect(Object.keys(result.rejection).sort()).toEqual(['code', 'reason']);
    expect('value' in result).toBe(false);
    const text = JSON.stringify(result);
    for (const leaked of ['T-SECRET-ID', '987654', '987655', '비밀', 'treatmentId', 'patientAmount', 'hospitalPayment']) {
      expect(text, leaked).not.toContain(leaked);
    }
  });
});

describe('입력을 바꾸지 않고, 형식이 깨진 줄에도 던지지 않는다', () => {
  it('충돌 거절과 정상 통과 모두 입력 배열과 줄 객체를 바꾸지 않는다 (깊게 동결한 입력)', () => {
    const freeze = (input: EstimateInput): EstimateInput => {
      for (const l of [...input.lines, ...input.baseFeeLines]) {
        Object.freeze(l.documentFlags);
        Object.freeze(l);
      }
      Object.freeze(input.lines);
      Object.freeze(input.baseFeeLines);
      Object.freeze(input.treatmentIds);
      return Object.freeze(input);
    };
    const conflict = freeze(withLines([a1, makeLine('T-A', 10_001), b1, c1].map((l) => structuredClone(l))));
    const snapshot = structuredClone(conflict);
    expect(validateEstimateInput(conflict).ok).toBe(false);
    expect(conflict).toEqual(snapshot);

    const fine = freeze(withLines([a1, structuredClone(a1), b1, c1].map((l) => structuredClone(l))));
    const fineSnapshot = structuredClone(fine);
    expect(validateEstimateInput(fine).ok).toBe(true);
    expect(fine).toEqual(fineSnapshot);
  });

  it.each([
    ['null 항목', null],
    ['숫자 항목', 7],
    ['문자열 항목', 'T-A'],
    ['빈 객체', {}],
    ['treatmentId 없는 객체', { patientAmount: 1_000 }],
    ['treatmentId 가 문자열이 아닌 객체', { treatmentId: 5, patientAmount: 1_000 }],
  ])('형식이 깨진 줄(%s)은 던지지 않고 고쳐 쓰지도 않으며 INVALID_NUMERIC_INPUT 으로 거절한다', (_name, broken) => {
    const input = withLines([a1, b1, loose<PublishedLine>(broken), c1]);
    expect(() => validateEstimateInput(input)).not.toThrow();
    expect(validateEstimateInput(input)).toEqual({ ok: false, rejection: NUMERIC_INVALID });
    const baseInput = withLines([a1, b1, c1], [loose<PublishedLine>(broken)]);
    expect(validateEstimateInput(baseInput)).toEqual({ ok: false, rejection: NUMERIC_INVALID });
  });

  it('형식이 깨진 줄이 섞여 있어도 충돌 판정은 형식이 맞는 줄끼리 하고 순서와 무관하다', () => {
    const conflicting = [a1, makeLine('T-A', 10_001)];
    for (const perm of permutations([...conflicting, loose<PublishedLine>(null), b1, c1])) {
      expect(validateEstimateInput(withLines(perm))).toEqual({ ok: false, rejection: LINE_CONFLICT });
    }
  });

  it('documentFlags 가 없거나 객체가 아닌 줄끼리 비교해도 던지지 않는다', () => {
    const noFlags = loose<PublishedLine>({ ...a1, documentFlags: undefined });
    const nullFlags = loose<PublishedLine>({ ...a1, documentFlags: null });
    expect(() => validateEstimateInput(withLines([noFlags, nullFlags, b1, c1]))).not.toThrow();
    // 있는 것과 없는 것은 같은 줄이 아니다.
    expect(validateEstimateInput(withLines([a1, noFlags, b1, c1]))).toEqual({ ok: false, rejection: LINE_CONFLICT });
    expect(validateEstimateInput(withLines([noFlags, a1, b1, c1]))).toEqual({ ok: false, rejection: LINE_CONFLICT });
    // 둘 다 없으면 같은 줄이다(값을 만들어 채우지 않는다).
    expect(validateEstimateInput(withLines([noFlags, structuredClone(noFlags), b1, c1])).ok).toBe(true);
  });
});

describe('estimate() 는 새 거절을 기존 거절 경로로 그대로 내보낸다', () => {
  it('충돌하는 입력은 {ok:false, rejection} 이고 결과 객체가 없다', () => {
    const input = caseInput({ groups: CASE_A, lines: [a1, makeLine('T-A', 10_001), b1, c1] });
    const outcome = estimate(input, { digest: testDigest });
    expect(outcome).toEqual({ ok: false, rejection: LINE_CONFLICT });
    expect('result' in outcome).toBe(false);
  });

  it('같은 입력의 순서만 바꿔도 같은 거절이고, 내용이 같은 중복은 계속 계산된다', () => {
    const conflicting = caseInput({ groups: CASE_A, lines: [makeLine('T-A', 10_001), a1, b1, c1] });
    expect(estimate(conflicting, { digest: testDigest })).toEqual({ ok: false, rejection: LINE_CONFLICT });
    const identical = caseInput({ groups: CASE_A, lines: [a1, structuredClone(a1), b1, c1] });
    const outcome = estimate(identical, { digest: testDigest });
    expect(outcome.ok).toBe(true);
  });
});

describe('M1 엔진은 검사하지 않음(서버 책임, M4) — 현재 동작의 기록일 뿐 보장이 아니다', () => {
  // 구현 안 됨 — M4 필수 검증: (a) 선택했는데 줄이 없는 ID, (b) 선택하지 않았는데 줄이 있는 ID,
  // (c) 같은 ID 가 치료 줄과 기본비용 줄에 모두 있는 경우, (d) isBaseFee 표시가 들어 있는 배열과 어긋남.
  // 아래 시험은 엔진이 지금 이 네 경우를 거절하지 않는다는 사실만 기록한다. 이 입력들이 안전하다는 뜻이 아니다.
  it('(a) 선택한 치료 ID 에 줄이 없어도 거절하지 않는다', () => {
    expect(validateEstimateInput(withLines([a1, b1], [], { treatmentIds: ['T-A', 'T-B', 'T-MISSING'] })).ok).toBe(true);
  });

  it('(b) 선택하지 않은 줄이 있어도 거절하지 않고 합계에 넣는다', () => {
    const result = validateEstimateInput(withLines([a1, b1, c1], [], { treatmentIds: ['T-A'] }));
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(60_000);
  });

  it('(c) 같은 ID 가 치료 줄과 기본비용 줄 양쪽에 있어도 거절하지 않고 두 번 센다', () => {
    const result = validateEstimateInput(withLines([a1, b1, c1], [makeLine('T-A', 10_000, { isBaseFee: true })]));
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.hospitalPayment).toBe(70_000);
  });

  it('(d) isBaseFee 표시가 들어 있는 배열과 어긋나도 거절하지 않는다', () => {
    const flaggedBaseFeeInLines = makeLine('T-A', 10_000, { isBaseFee: true });
    const unflaggedInBaseFee = makeLine('B-1', 5_000, { isBaseFee: false });
    expect(validateEstimateInput(withLines([flaggedBaseFeeInLines, b1, c1], [unflaggedInBaseFee])).ok).toBe(true);
  });
});
