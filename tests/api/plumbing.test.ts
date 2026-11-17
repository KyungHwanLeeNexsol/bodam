import { describe, expect, it } from 'vitest';
import { ERROR_STATUS, errorResponse, jsonResponse } from '../../src/server/api/http';
import type { ApiErrorCode } from '../../src/server/api/http';
import { ServerIntegrityError, guarded } from '../../src/server/api/integrity';
import type { ServerIntegrityCode } from '../../src/server/api/integrity';
import { silentLog } from '../../src/server/api/log';
import { CollectingLog } from '../fixtures/server/api-composition.fixture';

// M4.A API 배관: 응답 도우미(no-store, content-type, 오류 본문), 서버 무결성 오류의 500 변환, 로그 출구.
// design.md DD-19 오류 표(공개 경로 행)와 AC-021e(헤더)를 시험한다. 라우트 통합은 catalog.test.ts·options.test.ts 가 맡는다.

const HEADERS = (response: Response) => ({
  cacheControl: response.headers.get('cache-control'),
  contentType: response.headers.get('content-type'),
});

describe('jsonResponse', () => {
  it.each([200, 404, 422, 500])('상태 %i: 본문은 JSON 그대로이고 Cache-Control: no-store, content-type: application/json 이다', async (status) => {
    const response = jsonResponse(status, { a: 1, nested: { b: ['x', null] } });
    expect(response.status).toBe(status);
    expect(HEADERS(response)).toEqual({ cacheControl: 'no-store', contentType: 'application/json' });
    expect(await response.json()).toEqual({ a: 1, nested: { b: ['x', null] } });
  });

  it('한국어 본문도 그대로 JSON 으로 나간다 (이스케이프 없이 읽힌다)', async () => {
    const response = jsonResponse(200, { label: '다쳐서 왔어요 (상해)' });
    expect(await response.text()).toBe('{"label":"다쳐서 왔어요 (상해)"}');
  });
});

describe('errorResponse: DD-19 오류 표의 공개 경로 행', () => {
  const table: Array<[ApiErrorCode, number]> = [
    ['CLINIC_NOT_FOUND', 404],
    ['INVALID_REQUEST', 400],
    ['UNSUPPORTED_GENERATION', 422],
    ['NO_TREATMENT_SELECTED', 422],
    ['TREATMENT_NOT_PUBLISHED', 422],
    ['INTERNAL_ERROR', 500],
  ];

  it.each(table)('%s -> HTTP %i, 본문은 { error: 코드 } 하나뿐이고 no-store 다', async (code, status) => {
    const response = errorResponse(code);
    expect(response.status).toBe(status);
    expect(HEADERS(response)).toEqual({ cacheControl: 'no-store', contentType: 'application/json' });
    expect(await response.json()).toEqual({ error: code });
  });

  it('상태 표에는 표의 여섯 코드만 있다 (409 는 본문 모양이 달라 M4.B 가 따로 만든다)', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual(table.map(([code]) => code).sort());
    expect(Object.values(ERROR_STATUS)).not.toContain(409);
  });
});

describe('guarded: 던져진 것은 모두 500 INTERNAL_ERROR 하나로 바뀐다', () => {
  const INTEGRITY_CODES: ServerIntegrityCode[] = [
    'TREATMENT_VERSION_MISSING',
    'TREATMENT_MISSING',
    'TREATMENT_CLINIC_MISMATCH',
    'BASE_FEE_MISSING',
    'BASE_FEE_CLINIC_MISMATCH',
    'BUNDLE_AVAILABILITY_MISSING',
  ];

  it('정상 응답은 그대로 지나가고 로그는 비어 있다', async () => {
    const log = new CollectingLog();
    const response = await guarded(log, () => jsonResponse(200, { ok: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(log.entries).toEqual([]);
  });

  it('비동기 본문의 정상 응답도 그대로 지나간다', async () => {
    const log = new CollectingLog();
    const response = await guarded(log, async () => errorResponse('CLINIC_NOT_FOUND'));
    expect(response.status).toBe(404);
    expect(log.entries).toEqual([]);
  });

  it.each(INTEGRITY_CODES)('서버 무결성 오류 %s -> 500 { error: INTERNAL_ERROR }, 로그는 사건 이름과 코드뿐이다', async (code) => {
    const log = new CollectingLog();
    const response = await guarded(log, () => {
      throw new ServerIntegrityError(code);
    });
    expect(response.status).toBe(500);
    expect(HEADERS(response)).toEqual({ cacheControl: 'no-store', contentType: 'application/json' });
    expect(await response.json()).toEqual({ error: 'INTERNAL_ERROR' });
    expect(log.entries).toEqual([{ event: 'SERVER_INTEGRITY_ERROR', code }]);
  });

  it('비동기로 거절되는 서버 무결성 오류도 같다', async () => {
    const log = new CollectingLog();
    const response = await guarded(log, () => Promise.reject(new ServerIntegrityError('TREATMENT_MISSING')));
    expect(response.status).toBe(500);
    expect(log.entries).toEqual([{ event: 'SERVER_INTEGRITY_ERROR', code: 'TREATMENT_MISSING' }]);
  });

  it('예기치 못한 오류(일반 Error·문자열·undefined)도 500 이고, 오류 메시지·스택은 응답과 로그에 나가지 않는다', async () => {
    const secret = 'SECRET_PATIENT_TREATMENT_ID_T-777 금액 123456';
    const thrown: unknown[] = [new Error(secret), new TypeError(secret), secret, undefined];
    for (const value of thrown) {
      const log = new CollectingLog();
      const response = await guarded(log, () => {
        throw value;
      });
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({ error: 'INTERNAL_ERROR' });
      expect(text).not.toContain('SECRET');
      expect(log.entries).toEqual([{ event: 'UNEXPECTED_ERROR', code: 'UNEXPECTED' }]);
      expect(JSON.stringify(log.entries)).not.toContain('SECRET');
    }
  });

  it('ServerIntegrityError 의 메시지에는 코드만 있고 id·금액이 따라 나가지 않는다', () => {
    const error = new ServerIntegrityError('TREATMENT_MISSING');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ServerIntegrityError');
    expect(error.code).toBe('TREATMENT_MISSING');
    expect(error.message).toBe('서버 데이터 무결성 결함: TREATMENT_MISSING');
  });
});

describe('로그 출구', () => {
  it('silentLog 는 아무것도 남기지 않는다', () => {
    expect(silentLog.record({ event: 'UNEXPECTED_ERROR', code: 'UNEXPECTED' })).toBeUndefined();
  });

  it('수집기는 항목의 사본을 저장한다 (나중에 고쳐도 기록이 바뀌지 않는다)', () => {
    const log = new CollectingLog();
    const entry = { event: 'SERVER_INTEGRITY_ERROR' as const, code: 'TREATMENT_MISSING' };
    log.record(entry);
    entry.code = 'CHANGED';
    expect(log.entries).toEqual([{ event: 'SERVER_INTEGRITY_ERROR', code: 'TREATMENT_MISSING' }]);
  });
});
