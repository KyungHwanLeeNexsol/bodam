import { describe, expect, it } from 'vitest';
import { benefitLabel, formatPeriod, guidanceLines, splitGenerationLabel } from '../../../src/app/kiosk/view/input-view';

// 입력 단계 카드의 표시 변환 (BRIEF D9): 응답의 값을 카드 모양으로 나눌 뿐이고 새 사실을 만들지 않는다.

describe('splitGenerationLabel', () => {
  it('괄호 안을 코드 칩으로, 앞을 이름으로 나눈다', () => {
    expect(splitGenerationLabel('2세대(C1)')).toEqual({ name: '2세대', badge: 'C1' });
    expect(splitGenerationLabel('1세대(A·S)')).toEqual({ name: '1세대', badge: 'A·S' });
    expect(splitGenerationLabel('2.5세대(C2)')).toEqual({ name: '2.5세대', badge: 'C2' });
    expect(splitGenerationLabel(' 3세대 (C3) ')).toEqual({ name: '3세대', badge: 'C3' });
  });

  it('괄호가 없거나 모양이 다르면 label 전체가 이름이고 칩이 없다', () => {
    expect(splitGenerationLabel('새 세대')).toEqual({ name: '새 세대', badge: null });
    expect(splitGenerationLabel('(C1)')).toEqual({ name: '(C1)', badge: null });
    expect(splitGenerationLabel('5세대()')).toEqual({ name: '5세대()', badge: null });
  });
});

describe('formatPeriod', () => {
  it('"이전"으로 끝나는 기간에만 "가입기간 "을 붙이고 물결 앞뒤를 띄운다', () => {
    expect(formatPeriod('2009.08.01 이전')).toBe('가입기간 2009.08.01 이전');
    expect(formatPeriod('2009.08.01~2015.09.01 이전')).toBe('가입기간 2009.08.01 ~ 2015.09.01 이전');
    expect(formatPeriod('2015.09.01 ~ 2017.04.01 이전')).toBe('가입기간 2015.09.01 ~ 2017.04.01 이전');
  });

  it('계약을 가리키는 문장은 그대로 둔다', () => {
    expect(formatPeriod('2021.07.01부터의 4세대 계약')).toBe('2021.07.01부터의 4세대 계약');
  });
});

describe('benefitLabel', () => {
  it('급여와 비급여', () => {
    expect(benefitLabel('BENEFIT')).toBe('급여');
    expect(benefitLabel('NON_BENEFIT')).toBe('비급여');
  });
});

describe('guidanceLines', () => {
  it('문장 끝(마침표 뒤 공백)에서 줄을 나누고 문장은 고치지 않는다', () => {
    expect(guidanceLines('보험증권을 확인해 주세요. 앱에서도 볼 수 있습니다.')).toEqual(['보험증권을 확인해 주세요.', '앱에서도 볼 수 있습니다.']);
    expect(guidanceLines('한 문장')).toEqual(['한 문장']);
    expect(guidanceLines('1544-8069로 문의해 주세요.')).toEqual(['1544-8069로 문의해 주세요.']);
  });

  it('빈 문자열은 줄이 없다', () => {
    expect(guidanceLines('')).toEqual([]);
    expect(guidanceLines('   ')).toEqual([]);
  });
});
