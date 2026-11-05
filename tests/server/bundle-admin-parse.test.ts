import { describe, expect, it } from 'vitest';
import { parseBundlePreviewBody, parseBundlePublishBody, parseRuleScopeAssignBody } from '../../src/server/bundle-admin-parse';

// 묶음 구성·규칙 사용 범위 지정 본문의 형식 검사. 순수 함수다: 저장소를 읽지 않고, 던지지 않고, 입력을 바꾸지 않는다.
// 모든 단계의 키가 엄격하다(알 수 없는 키는 UNKNOWN_FIELD). 행위자·역할·병원·항목 종류는 본문으로 받지 않는다 — 종류는 서버가 MAPPING 으로 정한다.

const HASH = 'a'.repeat(64);
const defectsOf = (result: { ok: boolean; defects?: unknown }) => (result.ok ? null : result.defects);

describe('parseBundlePreviewBody', () => {
  it('올바른 본문은 기준 묶음 id 와 매핑 참조(종류는 MAPPING 으로 붙는다)를 돌려준다', () => {
    const body = { baseBundleId: 'B1', mappings: [{ id: 'M1', version: 'v1' }, { id: 'M2', version: 'v2' }] };
    expect(parseBundlePreviewBody(body)).toEqual({
      ok: true,
      baseBundleId: 'B1',
      mappings: [
        { kind: 'MAPPING', id: 'M1', version: 'v1' },
        { kind: 'MAPPING', id: 'M2', version: 'v2' },
      ],
    });
  });

  it('입력을 바꾸지 않는다', () => {
    const body = Object.freeze({ baseBundleId: 'B1', mappings: Object.freeze([Object.freeze({ id: 'M1', version: 'v1' })]) });
    expect(parseBundlePreviewBody(body).ok).toBe(true);
  });

  it.each([
    ['객체가 아님(배열)', [], [{ code: 'NOT_OBJECT', path: 'request' }]],
    ['객체가 아님(문자열)', 'x', [{ code: 'NOT_OBJECT', path: 'request' }]],
    ['null', null, [{ code: 'NOT_OBJECT', path: 'request' }]],
    ['모두 없음', {}, [{ code: 'VALUE_MISSING', path: 'baseBundleId' }, { code: 'VALUE_MISSING', path: 'mappings' }]],
    ['빈 기준 묶음 id', { baseBundleId: '', mappings: [{ id: 'M', version: '1' }] }, [{ code: 'VALUE_INVALID', path: 'baseBundleId' }]],
    ['숫자 기준 묶음 id', { baseBundleId: 5, mappings: [{ id: 'M', version: '1' }] }, [{ code: 'VALUE_INVALID', path: 'baseBundleId' }]],
    ['매핑이 배열이 아님', { baseBundleId: 'B', mappings: 'M1' }, [{ code: 'VALUE_INVALID', path: 'mappings' }]],
    ['매핑이 비어 있음', { baseBundleId: 'B', mappings: [] }, [{ code: 'MAPPINGS_EMPTY', path: 'mappings' }]],
    ['매핑 항목이 객체가 아님', { baseBundleId: 'B', mappings: ['M1'] }, [{ code: 'VALUE_INVALID', path: 'mappings[0]' }]],
    ['매핑 id 없음', { baseBundleId: 'B', mappings: [{ version: '1' }] }, [{ code: 'VALUE_MISSING', path: 'mappings[0].id' }]],
    ['매핑 버전이 빈 문자열', { baseBundleId: 'B', mappings: [{ id: 'M', version: '' }] }, [{ code: 'VALUE_INVALID', path: 'mappings[0].version' }]],
    ['종류(kind)를 보냄', { baseBundleId: 'B', mappings: [{ kind: 'PROFILE', id: 'M', version: '1' }] }, [{ code: 'UNKNOWN_FIELD', path: 'mappings[0].kind' }]],
    ['같은 매핑을 두 번', { baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }, { id: 'N', version: '1' }, { id: 'M', version: '1' }] }, [{ code: 'DUPLICATE_MAPPING', path: 'mappings[2]' }]],
    ['알 수 없는 최상위 키', { baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }], actor: 'RV' }, [{ code: 'UNKNOWN_FIELD', path: 'request.actor' }]],
    ['확인값을 미리보기에 보냄', { baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }], publishConfirmation: HASH }, [{ code: 'UNKNOWN_FIELD', path: 'request.publishConfirmation' }]],
  ])('%s → 거절', (_name, body, defects) => {
    expect(defectsOf(parseBundlePreviewBody(body))).toEqual(defects);
  });

  it('같은 id 의 다른 버전은 중복이 아니다', () => {
    expect(parseBundlePreviewBody({ baseBundleId: 'B', mappings: [{ id: 'M', version: '1' }, { id: 'M', version: '2' }] }).ok).toBe(true);
  });
});

describe('parseBundlePublishBody', () => {
  const ok = { baseBundleId: 'B1', mappings: [{ id: 'M1', version: 'v1' }], publishConfirmation: HASH };

  it('올바른 본문은 확인값을 더해 돌려준다', () => {
    expect(parseBundlePublishBody(ok)).toEqual({ ok: true, baseBundleId: 'B1', mappings: [{ kind: 'MAPPING', id: 'M1', version: 'v1' }], publishConfirmation: HASH });
  });

  it.each([
    ['확인값 없음', { ...ok, publishConfirmation: undefined }, [{ code: 'VALUE_MISSING', path: 'publishConfirmation' }]],
    ['확인값 null', { ...ok, publishConfirmation: null }, [{ code: 'VALUE_MISSING', path: 'publishConfirmation' }]],
    ['확인값 모양이 아님', { ...ok, publishConfirmation: 'abc' }, [{ code: 'VALUE_INVALID', path: 'publishConfirmation' }]],
    ['확인값 대문자 16진수', { ...ok, publishConfirmation: 'A'.repeat(64) }, [{ code: 'VALUE_INVALID', path: 'publishConfirmation' }]],
    ['확인값이 숫자', { ...ok, publishConfirmation: 1 }, [{ code: 'VALUE_INVALID', path: 'publishConfirmation' }]],
    ['알 수 없는 키', { ...ok, role: 'RV' }, [{ code: 'UNKNOWN_FIELD', path: 'request.role' }]],
    ['매핑 형식 결함과 확인값 결함을 함께 보고', { baseBundleId: 'B', mappings: [], publishConfirmation: 'x' }, [{ code: 'MAPPINGS_EMPTY', path: 'mappings' }, { code: 'VALUE_INVALID', path: 'publishConfirmation' }]],
  ])('%s → 거절', (_name, body, defects) => {
    expect(defectsOf(parseBundlePublishBody(body))).toEqual(defects);
  });
});

describe('parseRuleScopeAssignBody', () => {
  it('expectedCurrentBundleId 는 문자열이거나 null("범위가 없다고 보았다")이다', () => {
    expect(parseRuleScopeAssignBody({ ruleBundleVersionId: 'B2', expectedCurrentBundleId: 'B1' })).toEqual({ ok: true, ruleBundleVersionId: 'B2', expectedCurrentBundleId: 'B1' });
    expect(parseRuleScopeAssignBody({ ruleBundleVersionId: 'B2', expectedCurrentBundleId: null })).toEqual({ ok: true, ruleBundleVersionId: 'B2', expectedCurrentBundleId: null });
  });

  it.each([
    ['객체가 아님', [], [{ code: 'NOT_OBJECT', path: 'request' }]],
    ['둘 다 없음', {}, [{ code: 'VALUE_MISSING', path: 'ruleBundleVersionId' }, { code: 'VALUE_MISSING', path: 'expectedCurrentBundleId' }]],
    ['expectedCurrentBundleId 키가 없음(null 과 다르다)', { ruleBundleVersionId: 'B2' }, [{ code: 'VALUE_MISSING', path: 'expectedCurrentBundleId' }]],
    ['빈 묶음 id', { ruleBundleVersionId: '', expectedCurrentBundleId: null }, [{ code: 'VALUE_INVALID', path: 'ruleBundleVersionId' }]],
    ['묶음 id 가 숫자', { ruleBundleVersionId: 3, expectedCurrentBundleId: null }, [{ code: 'VALUE_INVALID', path: 'ruleBundleVersionId' }]],
    ['expected 가 빈 문자열', { ruleBundleVersionId: 'B2', expectedCurrentBundleId: '' }, [{ code: 'VALUE_INVALID', path: 'expectedCurrentBundleId' }]],
    ['expected 가 숫자', { ruleBundleVersionId: 'B2', expectedCurrentBundleId: 7 }, [{ code: 'VALUE_INVALID', path: 'expectedCurrentBundleId' }]],
    ['병원 id 를 본문에 보냄', { ruleBundleVersionId: 'B2', expectedCurrentBundleId: null, clinicId: 'C1' }, [{ code: 'UNKNOWN_FIELD', path: 'request.clinicId' }]],
    ['행위자를 본문에 보냄', { ruleBundleVersionId: 'B2', expectedCurrentBundleId: null, actor: 'PO' }, [{ code: 'UNKNOWN_FIELD', path: 'request.actor' }]],
  ])('%s → 거절', (_name, body, defects) => {
    expect(defectsOf(parseRuleScopeAssignBody(body))).toEqual(defects);
  });
});
