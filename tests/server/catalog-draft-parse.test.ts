import { describe, expect, it } from 'vitest';
import { DRAFT_KEY_PATTERN, MAX_ADDITIONS, isCalendarDate, isLegacyPriceOnlyBody, parseDraftRequest } from '../../src/server/catalog-draft-parse';
import { additionBody } from '../fixtures/server/catalog-structure.fixture';

// 초안 요청 본문의 형식 검사 (순수 함수, 저장소 없음). 현재 게시 치료와 맞는지(없는 치료·순열·id 충돌)는 tests/server/catalog-structure.test.ts 가 본다.

const T1 = 'TEST_FIXTURE_TREATMENT_1';
const parse = (body: unknown) => parseDraftRequest(body);
const defectsOf = (body: unknown) => {
  const parsed = parse(body);
  return parsed.ok ? [] : parsed.defects;
};

describe('parseDraftRequest: 올바른 본문', () => {
  it('네 섹션 모두 선택이다: 빈 객체는 빈 섹션들과 같다', () => {
    expect(parse({})).toEqual({ ok: true, request: { priceEdits: [], additions: [], deactivations: [], order: null, legacyPriceOnly: false } });
  });

  it('새 치료는 입력과 같은 값으로 읽히고 입력 객체를 바꾸지 않는다 (배열·객체는 복사본)', () => {
    const body = { additions: [additionBody('NEW_A', { procedureCodes: [] })] };
    const snapshot = JSON.stringify(body);
    const parsed = parse(body);
    expect(parsed.ok && parsed.request.additions[0]).toEqual(body.additions[0]);
    expect(JSON.stringify(body)).toBe(snapshot);
    expect(parsed.ok && parsed.request.additions[0]!.documentFlags).not.toBe(body.additions[0]!.documentFlags);
  });

  it('priceEdits 키 하나뿐인 본문만 이전 모양(legacyPriceOnly)이다', () => {
    const edit = { treatmentId: T1, patientAmount: 1 };
    expect(isLegacyPriceOnlyBody({ priceEdits: [edit] })).toBe(true);
    expect(isLegacyPriceOnlyBody({ priceEdits: [edit], order: null })).toBe(false);
    expect(isLegacyPriceOnlyBody({})).toBe(false);
    expect(isLegacyPriceOnlyBody('x')).toBe(false);
    expect(parse({ priceEdits: [edit] })).toMatchObject({ ok: true, request: { legacyPriceOnly: true } });
  });

  it('order 는 null 이거나 생략하면 기본 순서(null)다', () => {
    expect(parse({ order: null })).toMatchObject({ ok: true, request: { order: null } });
    expect(parse({ order: ['A', 'B'] })).toMatchObject({ ok: true, request: { order: ['A', 'B'] } });
  });

  it('draftKey 는 영문·숫자·밑줄·하이픈 1~40자이다 (40자는 통과, 41자는 거절)', () => {
    expect(DRAFT_KEY_PATTERN.test('a'.repeat(40))).toBe(true);
    expect(parse({ additions: [additionBody('A-b_9')] }).ok).toBe(true);
    expect(parse({ additions: [additionBody('a'.repeat(40))] }).ok).toBe(true);
    for (const bad of ['a'.repeat(41), '', 'a b', 'a/b', 'a:b', '한글', 'a.b']) {
      expect(defectsOf({ additions: [additionBody(bad)] }), JSON.stringify(bad)).toContainEqual({ code: 'VALUE_INVALID', path: 'additions[0].draftKey' });
    }
  });
});

describe('parseDraftRequest: 거절 (코드와 경로)', () => {
  const edit = { treatmentId: T1, patientAmount: 12_000 };
  const cases: Array<[string, unknown, string, string]> = [
    ['본문이 객체가 아님', [1], 'NOT_OBJECT', 'request'],
    ['최상위 알 수 없는 키', { priceEdits: [edit], calcClass: 'GENERAL_BENEFIT' }, 'UNKNOWN_FIELD', 'request.calcClass'],
    ['priceEdits 가 배열이 아님', { priceEdits: {} }, 'NOT_ARRAY', 'priceEdits'],
    ['additions 가 배열이 아님', { additions: {} }, 'NOT_ARRAY', 'additions'],
    ['additions 항목이 객체가 아님', { additions: [1] }, 'NOT_OBJECT', 'additions[0]'],
    ['deactivations 가 배열이 아님', { deactivations: T1 }, 'NOT_ARRAY', 'deactivations'],
    ['deactivations 항목이 문자열이 아님', { deactivations: [1] }, 'VALUE_INVALID', 'deactivations[0]'],
    ['deactivations 항목이 빈 문자열', { deactivations: [''] }, 'VALUE_INVALID', 'deactivations[0]'],
    ['deactivations 중복', { deactivations: [T1, T1] }, 'DUPLICATE_TREATMENT_ID', 'deactivations[1]'],
    ['order 가 배열이 아님', { order: 'A' }, 'NOT_ARRAY', 'order'],
    ['order 항목이 문자열이 아님', { order: ['A', 2] }, 'VALUE_INVALID', 'order[1]'],
    ['order 중복', { order: ['A', 'B', 'A'] }, 'DUPLICATE_ORDER_ENTRY', 'order[2]'],
    // 새 치료 필드
    ['draftKey 없음', { additions: [additionBody('X', { draftKey: undefined })] }, 'VALUE_MISSING', 'additions[0].draftKey'],
    ['draftKey 중복', { additions: [additionBody('X'), additionBody('X')] }, 'DUPLICATE_DRAFT_KEY', 'additions[1].draftKey'],
    ['표시 이름 없음', { additions: [additionBody('X', { displayName: undefined })] }, 'VALUE_MISSING', 'additions[0].displayName'],
    ['표시 이름이 공백뿐', { additions: [additionBody('X', { displayName: '   ' })] }, 'VALUE_INVALID', 'additions[0].displayName'],
    ['설명이 문자열이 아님', { additions: [additionBody('X', { description: 1 })] }, 'VALUE_INVALID', 'additions[0].description'],
    ['급여 구분이 열거 밖', { additions: [additionBody('X', { benefitType: 'MAYBE' })] }, 'VALUE_INVALID', 'additions[0].benefitType'],
    ['가격 음수', { additions: [additionBody('X', { patientAmount: -1 })] }, 'VALUE_INVALID', 'additions[0].patientAmount'],
    ['가격 소수', { additions: [additionBody('X', { patientAmount: 1.5 })] }, 'VALUE_INVALID', 'additions[0].patientAmount'],
    ['가격 없음', { additions: [additionBody('X', { patientAmount: undefined })] }, 'VALUE_MISSING', 'additions[0].patientAmount'],
    ['치료 코드가 빈 문자열', { additions: [additionBody('X', { treatmentCode: '' })] }, 'VALUE_INVALID', 'additions[0].treatmentCode'],
    ['치료 코드가 공백뿐', { additions: [additionBody('X', { treatmentCode: '   ' })] }, 'VALUE_INVALID', 'additions[0].treatmentCode'],
    ['치료 코드가 탭·줄바꿈뿐', { additions: [additionBody('X', { treatmentCode: '\t\n' })] }, 'VALUE_INVALID', 'additions[0].treatmentCode'],
    ['금액 조건의 환자 유형이 공백뿐', { additions: [additionBody('X', { amountCondition: { patientType: '  ', assumption: 'A', referenceDate: '2026-11-01' } })] }, 'VALUE_INVALID', 'additions[0].amountCondition.patientType'],
    ['금액 조건의 환자 유형이 탭·줄바꿈뿐', { additions: [additionBody('X', { amountCondition: { patientType: '\t\r\n', assumption: 'A', referenceDate: '2026-11-01' } })] }, 'VALUE_INVALID', 'additions[0].amountCondition.patientType'],
    ['금액 조건의 가정이 공백뿐', { additions: [additionBody('X', { amountCondition: { patientType: 'P', assumption: ' ', referenceDate: '2026-11-01' } })] }, 'VALUE_INVALID', 'additions[0].amountCondition.assumption'],
    ['금액 조건의 가정이 탭·줄바꿈뿐', { additions: [additionBody('X', { amountCondition: { patientType: 'P', assumption: '\n\t', referenceDate: '2026-11-01' } })] }, 'VALUE_INVALID', 'additions[0].amountCondition.assumption'],
    ['행위 코드가 공백뿐', { additions: [additionBody('X', { procedureCodes: ['A', '   '] })] }, 'VALUE_INVALID', 'additions[0].procedureCodes[1]'],
    ['행위 코드가 탭·줄바꿈뿐', { additions: [additionBody('X', { procedureCodes: ['\t\n'] })] }, 'VALUE_INVALID', 'additions[0].procedureCodes[0]'],
    ['행위 코드 목록 없음', { additions: [additionBody('X', { procedureCodes: undefined })] }, 'VALUE_MISSING', 'additions[0].procedureCodes'],
    ['행위 코드 목록이 배열이 아님', { additions: [additionBody('X', { procedureCodes: 'A' })] }, 'VALUE_INVALID', 'additions[0].procedureCodes'],
    ['행위 코드에 빈 문자열', { additions: [additionBody('X', { procedureCodes: ['A', ''] })] }, 'VALUE_INVALID', 'additions[0].procedureCodes[1]'],
    ['서류 표시 없음', { additions: [additionBody('X', { documentFlags: undefined })] }, 'VALUE_MISSING', 'additions[0].documentFlags'],
    ['서류 표시가 불리언이 아님("true")', { additions: [additionBody('X', { documentFlags: { imaging: 'true', biopsy: false, opinionRequired: false } })] }, 'VALUE_INVALID', 'additions[0].documentFlags.imaging'],
    ['서류 표시 하나 빠짐(기본값을 채우지 않는다)', { additions: [additionBody('X', { documentFlags: { imaging: false, biopsy: false } })] }, 'VALUE_MISSING', 'additions[0].documentFlags.opinionRequired'],
    ['서류 표시의 알 수 없는 키', { additions: [additionBody('X', { documentFlags: { imaging: false, biopsy: false, opinionRequired: false, extra: true } })] }, 'UNKNOWN_FIELD', 'additions[0].documentFlags.extra'],
    ['금액 조건 없음', { additions: [additionBody('X', { amountCondition: undefined })] }, 'VALUE_MISSING', 'additions[0].amountCondition'],
    ['금액 조건의 환자 유형이 비어 있음', { additions: [additionBody('X', { amountCondition: { patientType: '', assumption: 'A', referenceDate: '2026-11-01' } })] }, 'VALUE_INVALID', 'additions[0].amountCondition.patientType'],
    ['금액 조건의 가정이 없음', { additions: [additionBody('X', { amountCondition: { patientType: 'P', referenceDate: '2026-11-01' } })] }, 'VALUE_MISSING', 'additions[0].amountCondition.assumption'],
    ['금액 조건의 기준일이 달력에 없음', { additions: [additionBody('X', { amountCondition: { patientType: 'P', assumption: 'A', referenceDate: '2026-02-30' } })] }, 'VALUE_INVALID', 'additions[0].amountCondition.referenceDate'],
    ['금액 조건의 알 수 없는 키', { additions: [additionBody('X', { amountCondition: { patientType: 'P', assumption: 'A', referenceDate: '2026-11-01', note: 'x' } })] }, 'UNKNOWN_FIELD', 'additions[0].amountCondition.note'],
    ['적용일이 달력에 없음', { additions: [additionBody('X', { effectiveDate: '2026-13-01' })] }, 'VALUE_INVALID', 'additions[0].effectiveDate'],
    ['적용일 없음', { additions: [additionBody('X', { effectiveDate: undefined })] }, 'VALUE_MISSING', 'additions[0].effectiveDate'],
  ];
  it.each(cases)('%s', (_name, body, code, path) => {
    expect(defectsOf(body)).toContainEqual({ code, path });
  });

  it.each(['calcClass', 'origin', 'id', 'sortOrder', 'active', 'clinicId', 'treatmentId', 'approved', 'mapping', 'coverage'])('새 치료의 알 수 없는 키 %s 는 UNKNOWN_FIELD 다 (서버가 정하는 값을 요청이 정하지 못한다)', (key) => {
    expect(defectsOf({ additions: [additionBody('X', { [key]: 'GENERAL_BENEFIT' })] })).toEqual([{ code: 'UNKNOWN_FIELD', path: `additions[0].${key}` }]);
  });

  it('값 앞뒤의 공백은 다듬거나 바꾸지 않고 그대로 보존한다 (공백뿐인 값만 거절한다)', () => {
    const result = parse({ additions: [additionBody('X', { treatmentCode: ' TC ', procedureCodes: [' P '], amountCondition: { patientType: ' 성인 ', assumption: ' 가정 ', referenceDate: '2026-11-01' } })] });
    expect(result.ok).toBe(true);
    const addition = result.ok ? result.request.additions[0]! : null;
    expect(addition?.treatmentCode).toBe(' TC ');
    expect(addition?.procedureCodes).toEqual([' P ']);
    expect(addition?.amountCondition.patientType).toBe(' 성인 ');
    expect(addition?.amountCondition.assumption).toBe(' 가정 ');
  });

  it('새 치료는 최대 50건이다: 50건은 통과, 51건은 TOO_MANY_ADDITIONS', () => {
    const many = (count: number) => ({ additions: Array.from({ length: count }, (_value, index) => additionBody(`K${index}`)) });
    expect(MAX_ADDITIONS).toBe(50);
    expect(parse(many(50)).ok).toBe(true);
    expect(defectsOf(many(51))).toEqual([{ code: 'TOO_MANY_ADDITIONS', path: 'additions' }]);
  });

  it('한 항목의 결함은 모아서 한 번에 알린다 (여러 필드)', () => {
    const defects = defectsOf({ additions: [additionBody('X', { displayName: '', patientAmount: -1, effectiveDate: 'x' })] });
    expect(defects.map((defect) => defect.path)).toEqual(['additions[0].displayName', 'additions[0].patientAmount', 'additions[0].effectiveDate']);
  });
});

describe('isCalendarDate (시계를 쓰지 않는 달력 검사)', () => {
  it.each(['2026-11-04', '2028-02-29', '2000-02-29', '2026-12-31', '2026-01-31', '2026-04-30'])('%s 는 달력에 있다', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each(['2026-02-29', '2100-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-1', '20261104', '2026-11-04T00:00:00Z', '', ' 2026-11-04', 0, null, undefined])(
    '%s 는 달력에 없다',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );
});
