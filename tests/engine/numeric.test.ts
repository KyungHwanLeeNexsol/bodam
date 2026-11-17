import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_WON, MAX_BASIS_POINTS, SAFE_INTEGER_MAX } from '../../src/engine/limits';
import {
  checkedAdd,
  checkedMulBp,
  isBasisPoints,
  isWon,
  sumLineAmounts,
} from '../../src/engine/numeric';

const S = Number.MAX_SAFE_INTEGER;

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.

describe('limits — MAX_AMOUNT_WON 불변 조건 (DD-24)', () => {
  it('MAX_AMOUNT_WON × 10000 은 안전 정수 최댓값 이하다 (정확한 BigInt 비교)', () => {
    expect(BigInt(MAX_AMOUNT_WON) * 10000n <= BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('줄 하나의 가장 큰 곱(비율 10000 × MAX_AMOUNT_WON)과 반올림 덧셈(+ 5000)도 안전 정수다', () => {
    const product = MAX_BASIS_POINTS * MAX_AMOUNT_WON;
    expect(Number.isSafeInteger(product)).toBe(true);
    expect(Number.isSafeInteger(product + 5000)).toBe(true);
  });

  it('MAX_AMOUNT_WON 자신은 양의 안전 정수이고 1,000,000,000원이다 (사용자 수용값, plan.md §E.9)', () => {
    expect(Number.isSafeInteger(MAX_AMOUNT_WON)).toBe(true);
    expect(MAX_AMOUNT_WON).toBe(1_000_000_000);
  });

  it('SAFE_INTEGER_MAX 는 DD-24의 S = 9007199254740991 이다', () => {
    expect(SAFE_INTEGER_MAX).toBe(9007199254740991);
  });

  it('MAX_BASIS_POINTS 는 10000 (100%) 이다', () => {
    expect(MAX_BASIS_POINTS).toBe(10000);
  });
});

describe('isWon — Won 정의 (DD-24)', () => {
  it.each([
    ['0 (하한 경계, 안쪽)', 0],
    ['1', 1],
    ['124000', 124_000],
    ['MAX_AMOUNT_WON − 1 (상한 바로 안쪽)', MAX_AMOUNT_WON - 1],
    ['MAX_AMOUNT_WON (상한 경계, 안쪽)', MAX_AMOUNT_WON],
  ])('유효: %s', (_name, value) => {
    expect(isWon(value)).toBe(true);
  });

  it.each([
    ['MAX_AMOUNT_WON + 1 (상한 바로 바깥)', MAX_AMOUNT_WON + 1],
    ['−1 (하한 바로 바깥)', -1],
    ['−0', -0],
    ['소수 0.5', 0.5],
    ['소수 MAX_AMOUNT_WON + 0.5', MAX_AMOUNT_WON + 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['−Infinity', Number.NEGATIVE_INFINITY],
    ['안전 정수 최댓값 S', Number.MAX_SAFE_INTEGER],
    ['안전하지 않은 정수 2^53', 2 ** 53],
    ['1e21', 1e21],
    ['문자열 "1000"', '1000'],
    ['빈 문자열', ''],
    ['null', null],
    ['undefined', undefined],
    ['불리언 true', true],
    ['bigint 1n', 1n],
    ['빈 배열', []],
    ['객체', {}],
  ])('무효: %s', (_name, value) => {
    expect(isWon(value)).toBe(false);
  });
});

describe('isBasisPoints — BasisPoints 정의 (DD-24)', () => {
  it.each([
    ['0 (하한 경계, 안쪽)', 0],
    ['1', 1],
    ['2000', 2000],
    ['9999 (상한 바로 안쪽)', 9999],
    ['10000 (상한 경계, 안쪽)', 10000],
  ])('유효: %s', (_name, value) => {
    expect(isBasisPoints(value)).toBe(true);
  });

  it.each([
    ['10001 (상한 바로 바깥)', 10001],
    ['−1 (하한 바로 바깥)', -1],
    ['−0', -0],
    ['소수 0.5', 0.5],
    ['소수 9999.5', 9999.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['−Infinity', Number.NEGATIVE_INFINITY],
    ['안전하지 않은 정수 2^53', 2 ** 53],
    ['문자열 "5000"', '5000'],
    ['null', null],
    ['undefined', undefined],
    ['bigint 5000n', 5000n],
  ])('무효: %s', (_name, value) => {
    expect(isBasisPoints(value)).toBe(false);
  });
});

describe('checkedAdd — 정확한 결과가 S 이하일 때만 통과 (DD-24 검사 덧셈)', () => {
  it('경계 쌍: checkedAdd(S − 1, 1) 은 S 로 통과하고 checkedAdd(S, 1) 은 거절한다 (AC-003h 10행, 함수 수준)', () => {
    expect(checkedAdd(S - 1, 1)).toEqual({ ok: true, value: S });
    expect(checkedAdd(S, 1)).toEqual({ ok: false, reason: 'OVERFLOW', step: null });
  });

  it('0 + 0, S + 0, 0 + S 는 통과한다', () => {
    expect(checkedAdd(0, 0)).toEqual({ ok: true, value: 0 });
    expect(checkedAdd(S, 0)).toEqual({ ok: true, value: S });
    expect(checkedAdd(0, S)).toEqual({ ok: true, value: S });
  });

  it('실패 결과는 호출하는 쪽이 준 단계 이름을 싣는다 (ROUND_ADD)', () => {
    expect(checkedAdd(S, 1, 'ROUND_ADD')).toEqual({ ok: false, reason: 'OVERFLOW', step: 'ROUND_ADD' });
  });

  it('반올림 덧셈 경계: 곱 9007199254740000 + 5000 은 S 를 넘고, 9007199254730000 + 5000 은 안전하다 (DD-24 경계표)', () => {
    expect(checkedAdd(9007199254740000, 5000, 'ROUND_ADD')).toEqual({
      ok: false,
      reason: 'OVERFLOW',
      step: 'ROUND_ADD',
    });
    expect(checkedAdd(9007199254730000, 5000, 'ROUND_ADD')).toEqual({ ok: true, value: 9007199254735000 });
  });

  it.each([
    ['−1', -1],
    ['소수 0.5', 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['−0', -0],
    ['안전하지 않은 정수 2^53', 2 ** 53],
    ['문자열 "1"', '1'],
    ['null', null],
    ['undefined', undefined],
  ])('무효 피연산자 %s 는 거절하며 정상 값처럼 통과시키지 않는다', (_name, bad) => {
    const left = checkedAdd(bad as number, 1);
    const right = checkedAdd(1, bad as number);
    expect(left).toEqual({ ok: false, reason: 'INVALID_OPERAND', step: null });
    expect(right).toEqual({ ok: false, reason: 'INVALID_OPERAND', step: null });
  });
});

describe('checkedMulBp — 비율 × 금액, 정확한 결과가 S 이하일 때만 통과 (DD-24 검사 곱셈)', () => {
  it.each([
    // [비율, 정상 최대 금액 E, 첫 초과 E] — DD-24 경계 기준값 표
    [10000, 900719925474, 900719925475],
    [2000, 4503599627370, 4503599627371],
  ])('비율 %i: E = %i 은 통과하고 E = %i 은 RATE_PRODUCT 로 거절한다', (rate, okAmount, overAmount) => {
    expect(checkedMulBp(rate, okAmount, 'RATE_PRODUCT')).toEqual({ ok: true, value: rate * okAmount });
    expect(checkedMulBp(rate, overAmount, 'RATE_PRODUCT')).toEqual({
      ok: false,
      reason: 'OVERFLOW',
      step: 'RATE_PRODUCT',
    });
  });

  it('통과한 곱은 정확한 값이다: 10000 × 900719925474 = 9007199254740000', () => {
    const result = checkedMulBp(10000, 900719925474);
    expect(result).toEqual({ ok: true, value: 9007199254740000 });
  });

  it('비율이 0 이면 금액이 S 여도 곱 0 으로 통과한다 (넘치지 않음)', () => {
    expect(checkedMulBp(0, S)).toEqual({ ok: true, value: 0 });
  });

  it('비율 1 × S 는 통과하고 비율 2 × S 는 거절한다', () => {
    expect(checkedMulBp(1, S)).toEqual({ ok: true, value: S });
    expect(checkedMulBp(2, S)).toEqual({ ok: false, reason: 'OVERFLOW', step: null });
  });

  it('단계 이름을 주지 않으면 step 은 null 이다', () => {
    expect(checkedMulBp(10000, 900719925475)).toEqual({ ok: false, reason: 'OVERFLOW', step: null });
  });

  it.each([
    ['비율 10001 (상한 바로 바깥)', 10001, 1],
    ['비율 −1', -1, 1],
    ['비율 소수 0.5', 0.5, 1],
    ['비율 NaN', Number.NaN, 1],
    ['비율 −0', -0, 1],
    ['금액 −1', 1, -1],
    ['금액 소수 0.5', 1, 0.5],
    ['금액 NaN', 1, Number.NaN],
    ['금액 Infinity', 1, Number.POSITIVE_INFINITY],
    ['금액 −0', 1, -0],
    ['금액 안전하지 않은 정수 2^53', 1, 2 ** 53],
    ['금액 문자열', 1, '1'],
    ['금액 null', 1, null],
  ])('무효 피연산자(%s)는 INVALID_OPERAND 로 거절한다', (_name, rate, amount) => {
    expect(checkedMulBp(rate as number, amount as number)).toEqual({
      ok: false,
      reason: 'INVALID_OPERAND',
      step: null,
    });
  });

  it('고정 시드 격자에서 BigInt 오라클과 모두 일치한다 (부동소수점이 감기거나 정밀도를 잃지 않음)', () => {
    // 고정 시드 선형 합동 생성기. 시험 입력은 결정적이다.
    let seed = 20261015;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed;
    };
    const amounts = [0, 1, 4503599627370, 4503599627371, 900719925474, 900719925475, S - 1, S];
    for (let i = 0; i < 200; i += 1) {
      const rate = next() % 10001;
      const fromList = amounts[next() % amounts.length] as number;
      const fromRandom = (next() * 2097152 + (next() % 2097152)) % (S + 1); // 0 이상 S 이하
      const amount = i % 2 === 0 ? fromList : fromRandom;
      const exact = BigInt(rate) * BigInt(amount);
      const result = checkedMulBp(rate, amount);
      if (exact <= BigInt(S)) {
        expect(result).toEqual({ ok: true, value: Number(exact) });
      } else {
        expect(result.ok).toBe(false);
      }
    }
  });
});

describe('sumLineAmounts — 줄 금액 검사 합산 (예상 병원 결제액 T)', () => {
  it('빈 목록의 합은 0 이다', () => {
    expect(sumLineAmounts([])).toEqual({ ok: true, value: 0 });
  });

  it('예시 4종 합은 124,000 이다 (X-ray 10,000 + 초음파 70,000 + 물리치료 4,000 + 신장분사치료 40,000)', () => {
    expect(sumLineAmounts([10_000, 70_000, 4_000, 40_000])).toEqual({ ok: true, value: 124_000 });
  });

  it('경계 쌍: 합이 S 이면 통과하고 S + 1 이면 HOSPITAL_PAYMENT_SUM 으로 거절한다', () => {
    expect(sumLineAmounts([S - 1, 1])).toEqual({ ok: true, value: S });
    expect(sumLineAmounts([S, 1])).toEqual({ ok: false, reason: 'OVERFLOW', step: 'HOSPITAL_PAYMENT_SUM' });
  });

  it('넘친 뒤 0 이 더해져도 되살아나지 않고, 순서와 관계없이 같은 결과다', () => {
    expect(sumLineAmounts([S, 1, 0])).toEqual({ ok: false, reason: 'OVERFLOW', step: 'HOSPITAL_PAYMENT_SUM' });
    expect(sumLineAmounts([0, 1, S])).toEqual({ ok: false, reason: 'OVERFLOW', step: 'HOSPITAL_PAYMENT_SUM' });
    expect(sumLineAmounts([1, S - 1, 0])).toEqual({ ok: true, value: S });
  });

  it('줄 금액이 MAX_AMOUNT_WON 인 줄을 여러 개 더해도 정확하다 (합계는 MAX_AMOUNT_WON 을 넘을 수 있다)', () => {
    const lines = [MAX_AMOUNT_WON, MAX_AMOUNT_WON, 1];
    expect(sumLineAmounts(lines)).toEqual({ ok: true, value: 2 * MAX_AMOUNT_WON + 1 });
  });

  it('무효 요소는 INVALID_OPERAND 로 거절하고 합에 섞어 쓰지 않는다', () => {
    expect(sumLineAmounts([1, -1])).toEqual({ ok: false, reason: 'INVALID_OPERAND', step: 'HOSPITAL_PAYMENT_SUM' });
    expect(sumLineAmounts([1, Number.NaN])).toEqual({
      ok: false,
      reason: 'INVALID_OPERAND',
      step: 'HOSPITAL_PAYMENT_SUM',
    });
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const lines = [3, 2, 1];
    sumLineAmounts(lines);
    expect(lines).toEqual([3, 2, 1]);
  });
});
