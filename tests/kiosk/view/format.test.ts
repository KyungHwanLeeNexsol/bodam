import { describe, expect, it } from 'vitest';
import { AMOUNT_UNKNOWN_LABEL, formatWon, formatWonOrCheck } from '../../../src/app/kiosk/view/format';

// 금액 표시 (BRIEF D9): 천 단위 쉼표와 "원", 값이 없으면 "확인 필요"이고 결코 0원이 아니다.

describe('formatWon', () => {
  it.each([
    [0, '0원'],
    [999, '999원'],
    [1_000, '1,000원'],
    [14_000, '14,000원'],
    [124_000, '124,000원'],
    [1_234_567, '1,234,567원'],
    [Number.MAX_SAFE_INTEGER, '9,007,199,254,740,991원'],
  ])('%i → %s', (amount, text) => {
    expect(formatWon(amount)).toBe(text);
  });

  it.each([-1, 0.5, 1.25, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])('금액이 아닌 값 %s 은 몰래 고치지 않고 예외다', (amount) => {
    expect(() => formatWon(amount)).toThrow(RangeError);
  });
});

describe('formatWonOrCheck', () => {
  it('값이 없으면(null) "확인 필요"이고 0원이 아니다', () => {
    expect(formatWonOrCheck(null)).toBe('확인 필요');
    expect(formatWonOrCheck(null)).toBe(AMOUNT_UNKNOWN_LABEL);
    expect(formatWonOrCheck(null)).not.toContain('0원');
  });

  it('진짜 0 은 0원으로 쓴다 (null 과 구별한다)', () => {
    expect(formatWonOrCheck(0)).toBe('0원');
    expect(formatWonOrCheck(124_000)).toBe('124,000원');
  });
});
