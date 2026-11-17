import { describe, expect, it } from 'vitest';
import { parseMappingDraftBody, parseReviewRequestRefBody, parseReviewRejectBody } from '../../src/server/mapping-review-parse';

// 매핑 검토 요청 본문의 형식 검사 (M7 매핑 검토). 순수 함수다: 던지지 않고, 입력을 바꾸지 않는다. 키는 엄격하다(알 수 없는 키 = UNKNOWN_FIELD).
// 매핑 내용의 id·버전·치료·출처(origin)·상태·작성자는 서버가 정한다: 본문으로 보낼 길이 없다.

const SOURCE = { insurerDocumentId: 'TEST_FIXTURE_DOC', revisionDate: '2026-01-01', clauseOrPage: 'TEST_FIXTURE_P1', effectiveDate: '2026-01-01', verifiedBy: 'TEST_FIXTURE_V', verifiedAt: '2026-01-02' };

const mapping = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }],
  decision: 'COVERED',
  groupKey: 'TEST_FIXTURE_GROUP',
  validity: { from: '2026-01-01', to: '2026-12-31' },
  policySources: [{ ...SOURCE }],
  ...overrides,
});
const body = (overrides: Record<string, unknown> = {}): unknown => ({ mapping: mapping(overrides) });

/** 키를 뺀 사본. */
function without(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

const defectsOf = (value: unknown) => {
  const result = parseMappingDraftBody(value);
  if (result.ok) throw new Error('거절되어야 한다');
  return result.defects;
};

describe('parseMappingDraftBody: 정상', () => {
  it('COVERED: 입력을 그대로 돌려준다 (사본이다)', () => {
    const input = body();
    const result = parseMappingDraftBody(input);
    expect(result).toEqual({
      ok: true,
      input: { scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }], decision: 'COVERED', groupKey: 'TEST_FIXTURE_GROUP', validity: { from: '2026-01-01', to: '2026-12-31' }, policySources: [SOURCE] },
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.input.scope).not.toBe((input as { mapping: { scope: unknown } }).mapping.scope);
  });

  it('EXCLUDED: groupKey 없이 제외 사유', () => {
    const result = parseMappingDraftBody({ mapping: without(mapping({ decision: 'EXCLUDED', exclusionReason: 'TEST_FIXTURE 제외' }), 'groupKey') });
    expect(result).toMatchObject({ ok: true, input: { decision: 'EXCLUDED', exclusionReason: 'TEST_FIXTURE 제외' } });
    if (result.ok) expect('groupKey' in result.input).toBe(false);
  });

  it('치료를 명시할 수 있고, 시작일과 종료일이 같아도 된다', () => {
    expect(parseMappingDraftBody(body({ treatmentId: 'TEST_FIXTURE_TREATMENT_1', validity: { from: '2026-05-05', to: '2026-05-05' } }))).toMatchObject({ ok: true, input: { treatmentId: 'TEST_FIXTURE_TREATMENT_1' } });
  });

  it('범위가 둘 이상이어도 된다', () => {
    const scope = [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE' }, { generation: 'GEN4_C4', insurerType: 'LIFE' }];
    expect(parseMappingDraftBody(body({ scope }))).toMatchObject({ ok: true, input: { scope } });
  });
});

describe('parseMappingDraftBody: 거절', () => {
  it.each([
    ['객체가 아님', 'x', [{ code: 'NOT_OBJECT', path: 'request' }]],
    ['null', null, [{ code: 'NOT_OBJECT', path: 'request' }]],
    ['배열', [], [{ code: 'NOT_OBJECT', path: 'request' }]],
    ['mapping 없음', {}, [{ code: 'VALUE_MISSING', path: 'mapping' }]],
    ['mapping 이 객체가 아님', { mapping: 'x' }, [{ code: 'VALUE_INVALID', path: 'mapping' }]],
    ['최상위 알 수 없는 키', { mapping: mapping(), origin: 'OPERATING' }, [{ code: 'UNKNOWN_FIELD', path: 'request.origin' }]],
  ])('%s', (_name, value, expected) => {
    expect(defectsOf(value)).toEqual(expected);
  });

  it.each([
    ['origin', 'OPERATING'],
    ['id', 'X'],
    ['version', '2'],
    ['state', 'APPROVED'],
    ['approver', {}],
    ['approvedFingerprint', 'x'],
    ['authorId', 'x'],
    ['clinicId', 'x'],
    ['role', 'RV'],
  ])('서버가 정하는 값(%s)을 본문으로 보낼 수 없다: UNKNOWN_FIELD', (key, value) => {
    expect(defectsOf(body({ [key]: value }))).toEqual([{ code: 'UNKNOWN_FIELD', path: `mapping.${key}` }]);
  });

  it.each([
    ['decision 없음', without(mapping(), 'decision'), [{ code: 'DECISION_INVALID', path: 'mapping.decision' }]],
    ['decision 열거 밖', mapping({ decision: 'MAYBE' }), [{ code: 'DECISION_INVALID', path: 'mapping.decision' }]],
    ['COVERED 인데 groupKey 없음', without(mapping(), 'groupKey'), [{ code: 'GROUP_KEY_REQUIRED', path: 'mapping.groupKey' }]],
    ['COVERED 인데 groupKey 빈 문자열', mapping({ groupKey: '' }), [{ code: 'GROUP_KEY_REQUIRED', path: 'mapping.groupKey' }]],
    ['COVERED 인데 제외 사유', mapping({ exclusionReason: 'x' }), [{ code: 'EXCLUSION_REASON_FORBIDDEN', path: 'mapping.exclusionReason' }]],
    ['EXCLUDED 인데 사유 없음', without(mapping({ decision: 'EXCLUDED' }), 'groupKey'), [{ code: 'EXCLUSION_REASON_REQUIRED', path: 'mapping.exclusionReason' }]],
    ['EXCLUDED 인데 groupKey 있음', mapping({ decision: 'EXCLUDED', exclusionReason: 'x' }), [{ code: 'GROUP_KEY_FORBIDDEN', path: 'mapping.groupKey' }]],
  ])('판정 규칙: %s', (_name, mappingValue, expected) => {
    expect(defectsOf({ mapping: mappingValue })).toEqual(expected);
  });

  it.each([
    ['scope 없음', without(mapping(), 'scope'), [{ code: 'SCOPE_INVALID', path: 'mapping.scope' }]],
    ['scope 가 배열 아님', mapping({ scope: 'x' }), [{ code: 'SCOPE_INVALID', path: 'mapping.scope' }]],
    ['scope 비어 있음', mapping({ scope: [] }), [{ code: 'SCOPE_EMPTY', path: 'mapping.scope' }]],
    ['scope 항목이 객체 아님', mapping({ scope: ['x'] }), [{ code: 'SCOPE_INVALID', path: 'mapping.scope[0]' }]],
    ['세대 열거 밖', mapping({ scope: [{ generation: 'GEN9', insurerType: 'NON_LIFE' }] }), [{ code: 'SCOPE_INVALID', path: 'mapping.scope[0].generation' }]],
    ['보험사 형태 열거 밖', mapping({ scope: [{ generation: 'GEN4_C4', insurerType: 'BANK' }] }), [{ code: 'SCOPE_INVALID', path: 'mapping.scope[0].insurerType' }]],
    ['scope 항목의 알 수 없는 키', mapping({ scope: [{ generation: 'GEN4_C4', insurerType: 'NON_LIFE', extra: 1 }] }), [{ code: 'UNKNOWN_FIELD', path: 'mapping.scope[0].extra' }]],
  ])('범위: %s', (_name, mappingValue, expected) => {
    expect(defectsOf({ mapping: mappingValue })).toEqual(expected);
  });

  it.each([
    ['validity 없음', without(mapping(), 'validity'), [{ code: 'VALUE_MISSING', path: 'mapping.validity' }]],
    ['validity 가 객체 아님', mapping({ validity: '2026' }), [{ code: 'VALUE_INVALID', path: 'mapping.validity' }]],
    ['from 없음', mapping({ validity: { to: '2026-12-31' } }), [{ code: 'DATE_INVALID', path: 'mapping.validity.from' }]],
    ['to 가 달력에 없는 날짜', mapping({ validity: { from: '2026-01-01', to: '2026-02-30' } }), [{ code: 'DATE_INVALID', path: 'mapping.validity.to' }]],
    ['형식이 다른 날짜', mapping({ validity: { from: '2026/01/01', to: '2026-12-31' } }), [{ code: 'DATE_INVALID', path: 'mapping.validity.from' }]],
    ['시작일이 종료일보다 늦음', mapping({ validity: { from: '2026-12-31', to: '2026-01-01' } }), [{ code: 'VALIDITY_RANGE_INVALID', path: 'mapping.validity' }]],
    ['validity 의 알 수 없는 키', mapping({ validity: { from: '2026-01-01', to: '2026-12-31', until: 'x' } }), [{ code: 'UNKNOWN_FIELD', path: 'mapping.validity.until' }]],
  ])('유효 기간: %s', (_name, mappingValue, expected) => {
    expect(defectsOf({ mapping: mappingValue })).toEqual(expected);
  });

  it.each([
    ['policySources 없음', without(mapping(), 'policySources'), [{ code: 'POLICY_SOURCES_MISSING', path: 'mapping.policySources' }]],
    ['policySources 비어 있음', mapping({ policySources: [] }), [{ code: 'POLICY_SOURCES_MISSING', path: 'mapping.policySources' }]],
    ['policySources 가 배열 아님', mapping({ policySources: {} }), [{ code: 'POLICY_SOURCES_MISSING', path: 'mapping.policySources' }]],
    ['항목이 객체 아님', mapping({ policySources: ['x'] }), [{ code: 'POLICY_SOURCE_INCOMPLETE', path: 'mapping.policySources[0]' }]],
    ['항목의 한 칸이 빔', mapping({ policySources: [{ ...SOURCE, clauseOrPage: '' }] }), [{ code: 'POLICY_SOURCE_INCOMPLETE', path: 'mapping.policySources[0].clauseOrPage' }]],
    ['항목의 한 칸이 문자열 아님', mapping({ policySources: [{ ...SOURCE, verifiedAt: 5 }] }), [{ code: 'POLICY_SOURCE_INCOMPLETE', path: 'mapping.policySources[0].verifiedAt' }]],
    ['항목의 칸이 없음', mapping({ policySources: [{ ...SOURCE }, without({ ...SOURCE }, 'verifiedBy')] }), [{ code: 'POLICY_SOURCE_INCOMPLETE', path: 'mapping.policySources[1].verifiedBy' }]],
    ['항목의 알 수 없는 키', mapping({ policySources: [{ ...SOURCE, note: 'x' }] }), [{ code: 'UNKNOWN_FIELD', path: 'mapping.policySources[0].note' }]],
  ])('약관 출처: %s', (_name, mappingValue, expected) => {
    expect(defectsOf({ mapping: mappingValue })).toEqual(expected);
  });

  it.each([
    ['빈 문자열', ''],
    ['문자열 아님', 5],
    ['null', null],
  ])('treatmentId 가 %s 이면 VALUE_INVALID', (_name, value) => {
    expect(defectsOf(body({ treatmentId: value }))).toEqual([{ code: 'VALUE_INVALID', path: 'mapping.treatmentId' }]);
  });

  it('결함은 모두 모아 정해진 순서(알 수 없는 키 → treatmentId → 판정 규칙 → 범위 → 유효 기간 → 약관 출처)로 낸다', () => {
    const defects = defectsOf({
      extra: 1,
      mapping: { zzz: 1, treatmentId: '', decision: 'COVERED', scope: [], validity: { from: 'x', to: 'y' }, policySources: [] },
    });
    expect(defects.map((defect) => defect.path)).toEqual(['request.extra', 'mapping.zzz', 'mapping.treatmentId', 'mapping.groupKey', 'mapping.scope', 'mapping.validity.from', 'mapping.validity.to', 'mapping.policySources']);
  });

  it('던지지 않고 입력을 바꾸지 않는다', () => {
    const value = body({ validity: { from: 'x', to: 'y' }, scope: [] });
    const snapshot = JSON.stringify(value);
    parseMappingDraftBody(value);
    expect(JSON.stringify(value)).toBe(snapshot);
    for (const odd of [undefined, 5, true, Symbol.iterator as unknown]) {
      expect(parseMappingDraftBody(odd)).toMatchObject({ ok: false });
    }
  });
});

describe('parseReviewRequestRefBody (제출 · 승인)', () => {
  it('{ reviewRequestId } 하나만 받는다', () => {
    expect(parseReviewRequestRefBody({ reviewRequestId: 'R1' })).toEqual({ ok: true, reviewRequestId: 'R1' });
  });

  it.each([
    ['객체 아님', 'x', [{ code: 'NOT_OBJECT', path: 'request' }]],
    ['없음', {}, [{ code: 'VALUE_MISSING', path: 'reviewRequestId' }]],
    ['null', { reviewRequestId: null }, [{ code: 'VALUE_MISSING', path: 'reviewRequestId' }]],
    ['빈 문자열', { reviewRequestId: '' }, [{ code: 'VALUE_INVALID', path: 'reviewRequestId' }]],
    ['문자열 아님', { reviewRequestId: 5 }, [{ code: 'VALUE_INVALID', path: 'reviewRequestId' }]],
    ['알 수 없는 키', { reviewRequestId: 'R1', reason: 'x' }, [{ code: 'UNKNOWN_FIELD', path: 'request.reason' }]],
    ['위조 시도', { reviewRequestId: 'R1', role: 'RV', clinicId: 'C', actor: 'x' }, [{ code: 'UNKNOWN_FIELD', path: 'request.role' }, { code: 'UNKNOWN_FIELD', path: 'request.clinicId' }, { code: 'UNKNOWN_FIELD', path: 'request.actor' }]],
  ])('%s', (_name, value, expected) => {
    expect(parseReviewRequestRefBody(value)).toEqual({ ok: false, defects: expected });
  });
});

describe('parseReviewRejectBody (반려)', () => {
  it('{ reviewRequestId, reason } 을 받고 사유는 다듬지 않고 그대로 보존한다', () => {
    expect(parseReviewRejectBody({ reviewRequestId: 'R1', reason: '  사유 있음  ' })).toEqual({ ok: true, reviewRequestId: 'R1', reason: '  사유 있음  ' });
  });

  it.each([
    ['사유 없음', { reviewRequestId: 'R1' }, [{ code: 'VALUE_MISSING', path: 'reason' }]],
    ['빈 사유', { reviewRequestId: 'R1', reason: '' }, [{ code: 'EMPTY', path: 'reason' }]],
    ['공백뿐인 사유', { reviewRequestId: 'R1', reason: ' \n\t ' }, [{ code: 'EMPTY', path: 'reason' }]],
    ['문자열 아닌 사유', { reviewRequestId: 'R1', reason: 5 }, [{ code: 'VALUE_INVALID', path: 'reason' }]],
    ['요청 id 없음', { reason: 'x' }, [{ code: 'VALUE_MISSING', path: 'reviewRequestId' }]],
    ['알 수 없는 키', { reviewRequestId: 'R1', reason: 'x', status: 'REJECTED' }, [{ code: 'UNKNOWN_FIELD', path: 'request.status' }]],
    ['객체 아님', null, [{ code: 'NOT_OBJECT', path: 'request' }]],
  ])('%s', (_name, value, expected) => {
    expect(parseReviewRejectBody(value)).toEqual({ ok: false, defects: expected });
  });
});
