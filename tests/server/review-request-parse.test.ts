import { describe, expect, it } from 'vitest';
import { CALC_CLASSES, BENEFIT_TYPES } from '../../src/server/validate/shape';
import { parseReviewRequestBody } from '../../src/server/review-request-parse';

// 검토 요청 본문의 형식 검사 (순수 함수, 저장소 없음). 치료가 병원의 현재 게시 치료인지·중복 요청인지는 tests/server/review-request-submit.test.ts 가 본다.
// 본문: { proposed: { benefitType, procedureCodes, calcClass } }. 키는 엄격하고 세 필드 모두 필수다.

const GOOD = () => ({ proposed: { benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A'], calcClass: 'GENERAL_BENEFIT' } });
const defectsOf = (body: unknown) => {
  const parsed = parseReviewRequestBody(body);
  return parsed.ok ? [] : parsed.defects;
};
/** 올바른 본문에서 proposed 의 한 필드를 바꾼(undefined 면 키를 뺀) 본문. */
function withProposed(overrides: Record<string, unknown>): Record<string, unknown> {
  const proposed: Record<string, unknown> = { ...GOOD().proposed, ...overrides };
  for (const [key, value] of Object.entries(proposed)) {
    if (value === undefined) delete proposed[key];
  }
  return { proposed };
}

describe('parseReviewRequestBody: 올바른 본문', () => {
  it('세 필드를 입력 그대로 읽는다', () => {
    expect(parseReviewRequestBody(GOOD())).toEqual({ ok: true, proposed: GOOD().proposed });
  });

  it.each(CALC_CLASSES)('분류 %s 는 모두 받는다 (NEEDS_REVIEW 포함)', (calcClass) => {
    expect(parseReviewRequestBody(withProposed({ calcClass }))).toMatchObject({ ok: true, proposed: { calcClass } });
  });

  it.each(BENEFIT_TYPES)('급여 구분 %s 를 받는다', (benefitType) => {
    expect(parseReviewRequestBody(withProposed({ benefitType }))).toMatchObject({ ok: true, proposed: { benefitType } });
  });

  it('행위 코드 목록은 비어 있어도 된다', () => {
    expect(parseReviewRequestBody(withProposed({ procedureCodes: [] }))).toMatchObject({ ok: true, proposed: { procedureCodes: [] } });
  });

  it('행위 코드는 다듬거나 바꾸지 않고 그대로 보존한다 (앞뒤 공백·중복·순서 포함)', () => {
    const codes = [' A ', 'B', 'B', '한글 코드', 'a b'];
    const parsed = parseReviewRequestBody(withProposed({ procedureCodes: codes }));
    expect(parsed).toMatchObject({ ok: true, proposed: { procedureCodes: codes } });
  });

  it('입력 객체를 바꾸지 않고 결과의 배열은 복사본이다', () => {
    const body = GOOD();
    const snapshot = JSON.stringify(body);
    const parsed = parseReviewRequestBody(body);
    expect(JSON.stringify(body)).toBe(snapshot);
    expect(parsed.ok && parsed.proposed.procedureCodes).not.toBe(body.proposed.procedureCodes);
  });
});

describe('parseReviewRequestBody: 거절 (결함 코드와 경로)', () => {
  it.each([[null], [undefined], [[]], ['x'], [7], [true]])('본문이 객체가 아니면 NOT_OBJECT request: %j', (body) => {
    expect(defectsOf(body)).toEqual([{ code: 'NOT_OBJECT', path: 'request' }]);
  });

  it('proposed 가 없거나 null 이면 VALUE_MISSING proposed', () => {
    expect(defectsOf({})).toEqual([{ code: 'VALUE_MISSING', path: 'proposed' }]);
    expect(defectsOf({ proposed: null })).toEqual([{ code: 'VALUE_MISSING', path: 'proposed' }]);
  });

  it.each([[[]], ['x'], [7], [true]])('proposed 가 객체가 아니면 VALUE_INVALID proposed: %j', (proposed) => {
    expect(defectsOf({ proposed })).toEqual([{ code: 'VALUE_INVALID', path: 'proposed' }]);
  });

  it('최상위의 알 수 없는 키는 UNKNOWN_FIELD request.<키> (요청자·병원·상태 같은 서버가 정하는 값을 본문으로 보낼 길이 없다)', () => {
    for (const key of ['requestedBy', 'clinicId', 'treatmentId', 'status', 'id', 'rejectionReason', 'draftMappingRef']) {
      expect(defectsOf({ ...GOOD(), [key]: 'x' })).toEqual([{ code: 'UNKNOWN_FIELD', path: `request.${key}` }]);
    }
  });

  it('proposed 안의 알 수 없는 키는 UNKNOWN_FIELD proposed.<키>', () => {
    for (const key of ['treatmentCode', 'patientAmount', 'origin', 'active', 'documentFlags', 'displayName']) {
      expect(defectsOf(withProposed({ [key]: 'x' }))).toEqual([{ code: 'UNKNOWN_FIELD', path: `proposed.${key}` }]);
    }
  });

  it('두 단계의 알 수 없는 키는 함께 알린다 (최상위 먼저)', () => {
    expect(defectsOf({ ...withProposed({ extra: 1 }), other: 2 })).toEqual([
      { code: 'UNKNOWN_FIELD', path: 'request.other' },
      { code: 'UNKNOWN_FIELD', path: 'proposed.extra' },
    ]);
  });

  it.each(['benefitType', 'procedureCodes', 'calcClass'])('필수 필드 %s 가 없으면 VALUE_MISSING, null 이어도 VALUE_MISSING', (field) => {
    expect(defectsOf(withProposed({ [field]: undefined }))).toEqual([{ code: 'VALUE_MISSING', path: `proposed.${field}` }]);
    expect(defectsOf(withProposed({ [field]: null }))).toEqual([{ code: 'VALUE_MISSING', path: `proposed.${field}` }]);
  });

  it.each([['BENEFITS'], ['benefit'], [''], [1], [true], [[]], [{}]])('급여 구분 %j 는 VALUE_INVALID', (benefitType) => {
    expect(defectsOf(withProposed({ benefitType }))).toEqual([{ code: 'VALUE_INVALID', path: 'proposed.benefitType' }]);
  });

  it.each([['general_benefit'], ['GENERAL'], [''], [0], [false], [['NEEDS_REVIEW']], [{}]])('분류 %j 는 VALUE_INVALID', (calcClass) => {
    expect(defectsOf(withProposed({ calcClass }))).toEqual([{ code: 'VALUE_INVALID', path: 'proposed.calcClass' }]);
  });

  it.each([['A'], [{}], [7], [true]])('행위 코드가 배열이 아니면 VALUE_INVALID proposed.procedureCodes: %j', (procedureCodes) => {
    expect(defectsOf(withProposed({ procedureCodes }))).toEqual([{ code: 'VALUE_INVALID', path: 'proposed.procedureCodes' }]);
  });

  it('행위 코드 항목이 빈 문자열·공백뿐(스페이스·탭·줄바꿈)·문자열이 아닌 값이면 그 항목 경로로 VALUE_INVALID', () => {
    const bad = ['', ' ', '   ', '\t', '\n', ' \t\r\n ', '　' /* 전각 공백(공백 문자) */, null, 5, {}, ['A'], true];
    for (const item of bad) {
      expect(defectsOf(withProposed({ procedureCodes: ['OK', item] })), JSON.stringify(item)).toEqual([{ code: 'VALUE_INVALID', path: 'proposed.procedureCodes[1]' }]);
    }
  });

  it('여러 항목이 틀리면 항목마다 알린다', () => {
    expect(defectsOf(withProposed({ procedureCodes: ['', 'OK', '  ', 3] }))).toEqual([
      { code: 'VALUE_INVALID', path: 'proposed.procedureCodes[0]' },
      { code: 'VALUE_INVALID', path: 'proposed.procedureCodes[2]' },
      { code: 'VALUE_INVALID', path: 'proposed.procedureCodes[3]' },
    ]);
  });

  it('결함은 모두 모아 선언 순서(benefitType → procedureCodes → calcClass)로 낸다', () => {
    expect(defectsOf({ proposed: { benefitType: 'X', procedureCodes: 'Y' } })).toEqual([
      { code: 'VALUE_INVALID', path: 'proposed.benefitType' },
      { code: 'VALUE_INVALID', path: 'proposed.procedureCodes' },
      { code: 'VALUE_MISSING', path: 'proposed.calcClass' },
    ]);
  });

  it('던지지 않는다: 이상한 입력(순환 아님, 프로토타입 키 포함)에도 결과 값을 돌려준다', () => {
    const odd = JSON.parse('{"proposed":{"benefitType":"BENEFIT","procedureCodes":[],"calcClass":"NEEDS_REVIEW","__proto__":{"x":1}}}') as unknown;
    expect(defectsOf(odd)).toEqual([{ code: 'UNKNOWN_FIELD', path: 'proposed.__proto__' }]);
  });
});
