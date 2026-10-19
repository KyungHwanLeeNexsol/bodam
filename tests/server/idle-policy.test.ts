import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/server/digest';
import type { IdlePolicy } from '../../src/server/domain/entities';
import { DEFAULT_IDLE_THRESHOLDS, IDLE_SCREEN_KINDS, MIN_IDLE_LEAD_SECONDS, readIdlePolicy, saveClinicIdlePolicy } from '../../src/server/idle-policy';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeClinic, makeIdlePolicy } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { newWorld } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 병원별 무조작 정책의 저장과 읽기 (design.md DD-10 표·저장 검증, DD-13 completionHoldSeconds, DD-18 IdlePolicy, DD-19 catalog 응답의 idlePolicy).
// 저장은 병원 관리자(HA)만 한다(DD-17 권한 표: 무조작 정책·completionHoldSeconds 조회·수정은 HA 칸만 O). 병원 소유·소속 확인과 401/403 은 M7 이다.
// 읽기 함수는 저장된 정책이 없으면 DD-10 표의 값을 내고, completionHoldSeconds 는 저장된 값이 없으면 null 이다(기본값은 plan.md §E #12 가 정하기 전까지 없다).
// 이 서비스는 AC 를 혼자 닫지 않는다: AC-015i(M5)와 AC-018a(M4)가 읽는 도메인 쪽 동작이고, 관리자 쓰기 경로의 AC-023d 는 M7 이다.

const DD10_DEFAULTS = {
  INPUT: { warnSeconds: 100, resetSeconds: 120 },
  RESULT: { warnSeconds: 160, resetSeconds: 180 },
  BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 },
  HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 },
  NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 },
};

function setup() {
  const w = newWorld();
  w.repo.saveClinic(makeClinic());
  return w;
}

const input = (overrides: Record<string, unknown> = {}) => ({ screens: { INPUT: { warnSeconds: 90, resetSeconds: 150 } }, completionHoldSeconds: 10, ...overrides });

describe('DD-10 표의 기본값 (저장된 정책이 없는 병원)', () => {
  it('화면 종류의 닫힌 목록은 다섯 개이고 K00_Start·K06_Complete 는 없다', () => {
    expect([...IDLE_SCREEN_KINDS]).toEqual(['INPUT', 'RESULT', 'BASIS_AND_DOCUMENTS', 'HOLD_RESULT', 'NOTICE_PROGRESS_ERROR']);
    expect(MIN_IDLE_LEAD_SECONDS).toBe(20);
  });

  it('저장된 정책이 없으면 DD-10 표의 값을 내고 completionHoldSeconds 는 null 이다', () => {
    const w = setup();
    expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID)).toEqual({ clinicId: TEST_FIXTURE_CLINIC_ID, screens: DD10_DEFAULTS, completionHoldSeconds: null });
    expect(DEFAULT_IDLE_THRESHOLDS).toEqual(DD10_DEFAULTS);
  });

  it('기본값은 저장 검증 규칙(경고 < 초기화, 간격 20초 이상)을 스스로 지킨다', () => {
    for (const kind of IDLE_SCREEN_KINDS) {
      const { warnSeconds, resetSeconds } = DEFAULT_IDLE_THRESHOLDS[kind];
      expect(resetSeconds - warnSeconds).toBeGreaterThanOrEqual(MIN_IDLE_LEAD_SECONDS);
    }
    const w = setup();
    expect(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: DEFAULT_IDLE_THRESHOLDS, completionHoldSeconds: null })).not.toThrow();
  });

  it('읽기는 저장소를 바꾸지 않고, 돌려준 값을 고쳐도 다음 읽기와 기본값 표에 영향이 없다', () => {
    const w = setup();
    const before = snapshotOf(w.repo);
    const first = readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID);
    first.screens.INPUT.warnSeconds = 1;
    first.completionHoldSeconds = 99;
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID).screens.INPUT).toEqual({ warnSeconds: 100, resetSeconds: 120 });
    expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID).completionHoldSeconds).toBeNull();
    expect(DEFAULT_IDLE_THRESHOLDS.INPUT).toEqual({ warnSeconds: 100, resetSeconds: 120 });
  });

  it('없는 병원의 읽기는 NOT_FOUND 이다', () => {
    const w = setup();
    expect(catchDomainError(() => readIdlePolicy(w.repo, 'TEST_FIXTURE_CLINIC_NOPE')).code).toBe('NOT_FOUND');
  });
});

describe('저장된 정책 (HA)', () => {
  it('저장한 화면 종류는 저장한 값으로, 저장하지 않은 화면 종류는 DD-10 표의 값으로 읽힌다 (completionHoldSeconds 는 저장한 값)', () => {
    const w = setup();
    saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, input());

    expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID)).toEqual({
      clinicId: TEST_FIXTURE_CLINIC_ID,
      screens: { ...DD10_DEFAULTS, INPUT: { warnSeconds: 90, resetSeconds: 150 } },
      completionHoldSeconds: 10,
    });
    expect(w.repo.getIdlePolicy(TEST_FIXTURE_CLINIC_ID)).toEqual({ clinicId: TEST_FIXTURE_CLINIC_ID, screens: { INPUT: { warnSeconds: 90, resetSeconds: 150 } }, completionHoldSeconds: 10 });
  });

  it('저장은 정책 전체를 바꾼다: 다시 저장할 때 빠진 화면 종류와 completionHoldSeconds 는 기본값으로 돌아간다', () => {
    const w = setup();
    saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, input());
    saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: { RESULT: { warnSeconds: 200, resetSeconds: 300 } }, completionHoldSeconds: null });

    const read = readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID);
    expect(read.screens.INPUT).toEqual(DD10_DEFAULTS.INPUT);
    expect(read.screens.RESULT).toEqual({ warnSeconds: 200, resetSeconds: 300 });
    expect(read.completionHoldSeconds).toBeNull();
  });

  it('빈 화면 목록과 completionHoldSeconds null 은 저장할 수 있다 (읽으면 기본값과 같다)', () => {
    const w = setup();
    saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: {}, completionHoldSeconds: null });
    expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID)).toEqual({ clinicId: TEST_FIXTURE_CLINIC_ID, screens: DD10_DEFAULTS, completionHoldSeconds: null });
  });

  it('정책은 병원마다 따로다 (한 병원의 저장이 다른 병원의 읽기를 바꾸지 않는다)', () => {
    const w = setup();
    w.repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_2', slug: 'test-fixture-clinic-2' }));
    saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, input());
    expect(readIdlePolicy(w.repo, 'TEST_FIXTURE_CLINIC_2')).toEqual({ clinicId: 'TEST_FIXTURE_CLINIC_2', screens: DD10_DEFAULTS, completionHoldSeconds: null });
  });

  it('호출자의 객체와 저장된 기록은 분리된다', () => {
    const w = setup();
    const request = input();
    saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, request);
    request.screens.INPUT.warnSeconds = 1;
    expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID).screens.INPUT.warnSeconds).toBe(90);
  });

  it('저장소에 직접 쓴 알 수 없는 화면 종류는 읽기에서 나오지 않는다 (응답은 닫힌 다섯 종류뿐)', () => {
    const w = setup();
    w.repo.saveIdlePolicy(makeIdlePolicy()); // TEST_FIXTURE_INPUT 은 닫힌 목록 밖의 키
    const read = readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID);
    expect(Object.keys(read.screens).sort()).toEqual([...IDLE_SCREEN_KINDS].sort());
    expect(read.screens).toEqual(DD10_DEFAULTS);
  });

  it('저장된 정책 객체를 돌려주고 감사 기록이 수행자·역할·병원·저장 전후 내용의 정본 해시를 남긴다', () => {
    const w = setup();
    w.clock.set('2026-10-17T06:00:00.000Z');
    const first = saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, input());
    w.clock.set('2026-10-17T07:00:00.000Z');
    const second = saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, input({ completionHoldSeconds: 15 }));

    expect(first).toEqual({ clinicId: TEST_FIXTURE_CLINIC_ID, screens: { INPUT: { warnSeconds: 90, resetSeconds: 150 } }, completionHoldSeconds: 10 });
    expect(second.completionHoldSeconds).toBe(15);
    const audit = w.repo.listAuditLog();
    expect(audit.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        actorId: 'TEST_FIXTURE_HA_1',
        role: 'HA',
        action: 'IDLE_POLICY_SAVE',
        target: `CLINIC/${TEST_FIXTURE_CLINIC_ID}/IDLE_POLICY`,
        beforeVersion: null,
        afterVersion: canonicalDigest(first),
        reason: null,
        at: '2026-10-17T06:00:00.000Z',
      },
      {
        actorId: 'TEST_FIXTURE_HA_1',
        role: 'HA',
        action: 'IDLE_POLICY_SAVE',
        target: `CLINIC/${TEST_FIXTURE_CLINIC_ID}/IDLE_POLICY`,
        beforeVersion: canonicalDigest(first),
        afterVersion: canonicalDigest(second),
        reason: null,
        at: '2026-10-17T07:00:00.000Z',
      },
    ]);
  });
});

describe('저장 검증 (거절하면 아무것도 저장하지 않는다)', () => {
  it.each([TEST_FIXTURE_RV_AUTHOR, TEST_FIXTURE_PO_1])('HA 가 아닌 역할 %o 는 저장할 수 없다 (ROLE_NOT_PERMITTED, 저장소 전후 비교가 같다)', (actor) => {
    const w = setup();
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => saveClinicIdlePolicy(w.deps, actor, TEST_FIXTURE_CLINIC_ID, input())).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('없는 병원은 NOT_FOUND 이다', () => {
    const w = setup();
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, 'TEST_FIXTURE_CLINIC_NOPE', input())).code).toBe('NOT_FOUND');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  const gapCases: ReadonlyArray<[string, number, number, boolean]> = [
    ['간격 20초는 저장할 수 있다', 100, 120, true],
    ['간격이 더 크면 저장할 수 있다', 10, 300, true],
    ['경고 0초도 정수이므로 저장할 수 있다 (초기화가 20초 이상이면)', 0, 20, true],
    ['간격 19초는 거절된다', 100, 119, false],
    ['간격 1초는 거절된다', 100, 101, false],
    ['경고와 초기화가 같으면 거절된다', 120, 120, false],
    ['초기화가 경고보다 앞서면 거절된다', 120, 100, false],
  ];
  it.each(gapCases)('%s (경고 %i · 초기화 %i)', (_name, warnSeconds, resetSeconds, accepted) => {
    const w = setup();
    const before = snapshotOf(w.repo);
    const attempt = () => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: { RESULT: { warnSeconds, resetSeconds } }, completionHoldSeconds: null });
    if (accepted) {
      expect(attempt).not.toThrow();
      expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID).screens.RESULT).toEqual({ warnSeconds, resetSeconds });
    } else {
      const error = catchDomainError(attempt);
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.defects).toEqual([{ code: 'LEAD_TIME_TOO_SHORT', path: 'screens.RESULT.resetSeconds' }]);
      expect(snapshotOf(w.repo)).toEqual(before);
    }
  });

  const numberCases: ReadonlyArray<[string, unknown, string]> = [
    ['음수', -1, 'VALUE_INVALID'],
    ['소수', 100.5, 'VALUE_INVALID'],
    ['NaN', Number.NaN, 'VALUE_INVALID'],
    ['Infinity', Number.POSITIVE_INFINITY, 'VALUE_INVALID'],
    ['안전 정수 밖', Number.MAX_SAFE_INTEGER + 1, 'VALUE_INVALID'],
    ['문자열', '100', 'VALUE_INVALID'],
    ['불리언', true, 'VALUE_INVALID'],
    ['null', null, 'VALUE_MISSING'],
    ['없음', undefined, 'VALUE_MISSING'],
  ];
  for (const field of ['warnSeconds', 'resetSeconds'] as const) {
    it.each(numberCases)(`${field} 가 %s 이면 거절된다`, (_name, value, code) => {
      const w = setup();
      const before = snapshotOf(w.repo);
      const entry = { warnSeconds: 100, resetSeconds: 200, [field]: value };
      const error = catchDomainError(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: { INPUT: entry }, completionHoldSeconds: null }));
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.defects).toEqual([{ code, path: `screens.INPUT.${field}` }]);
      expect(snapshotOf(w.repo)).toEqual(before);
    });
  }

  it.each([
    ['알 수 없는 화면 종류(시작 화면)', { K00_Start: { warnSeconds: 100, resetSeconds: 200 } }, 'SCREEN_UNKNOWN', 'screens.K00_Start'],
    ['알 수 없는 화면 종류(소문자)', { input: { warnSeconds: 100, resetSeconds: 200 } }, 'SCREEN_UNKNOWN', 'screens.input'],
    ['화면 항목이 null', { INPUT: null }, 'VALUE_INVALID', 'screens.INPUT'],
    ['화면 항목이 배열', { INPUT: [100, 200] }, 'VALUE_INVALID', 'screens.INPUT'],
    ['화면 항목이 숫자', { INPUT: 100 }, 'VALUE_INVALID', 'screens.INPUT'],
  ])('화면 목록 오류: %s', (_name, screens, code, path) => {
    const w = setup();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens, completionHoldSeconds: null }));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toEqual([{ code, path }]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it.each([
    ['없음', undefined, 'VALUE_MISSING'],
    ['null', null, 'VALUE_MISSING'],
    ['배열', [], 'VALUE_INVALID'],
    ['문자열', 'INPUT', 'VALUE_INVALID'],
    ['숫자', 3, 'VALUE_INVALID'],
  ])('화면 목록(screens) 자체가 %s 이면 거절된다', (_name, screens, code) => {
    const w = setup();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens, completionHoldSeconds: null }));
    expect(error.defects).toEqual([{ code, path: 'screens' }]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it.each([null, undefined, 'x', 7, []])('요청 자체가 객체가 아니면(%j) 거절된다 (경로 빈 문자열)', (request) => {
    const w = setup();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, request));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toEqual([{ code: 'VALUE_INVALID', path: '' }]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  const holdCases: ReadonlyArray<[string, unknown, boolean, string?]> = [
    ['null(자동 복귀 없음)', null, true],
    ['1초 (20초 하한은 completionHoldSeconds 에 적용하지 않는다)', 1, true],
    ['10초', 10, true],
    ['큰 안전 정수', 1_000_000, true],
    ['0', 0, false, 'VALUE_INVALID'],
    ['음수', -5, false, 'VALUE_INVALID'],
    ['소수', 1.5, false, 'VALUE_INVALID'],
    ['NaN', Number.NaN, false, 'VALUE_INVALID'],
    ['Infinity', Number.POSITIVE_INFINITY, false, 'VALUE_INVALID'],
    ['문자열', '10', false, 'VALUE_INVALID'],
    ['불리언', false, false, 'VALUE_INVALID'],
    ['빠짐(undefined)', undefined, false, 'VALUE_MISSING'],
  ];
  it.each(holdCases)('completionHoldSeconds 가 %s', (_name, value, accepted, code) => {
    const w = setup();
    const before = snapshotOf(w.repo);
    const attempt = () => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: {}, completionHoldSeconds: value });
    if (accepted) {
      expect(attempt).not.toThrow();
      expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID).completionHoldSeconds).toBe(value);
    } else {
      const error = catchDomainError(attempt);
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.defects).toEqual([{ code, path: 'completionHoldSeconds' }]);
      expect(snapshotOf(w.repo)).toEqual(before);
    }
  });

  it('여러 결함은 한꺼번에, 화면 종류 이름의 코드 포인트 순 → completionHoldSeconds 순으로 알리고 객체 키를 쓴 순서에 달라지지 않는다', () => {
    const w = setup();
    const bad = { warnSeconds: -1, resetSeconds: 'x' };
    const forward = { screens: { RESULT: bad, INPUT: bad, ZZZ: bad }, completionHoldSeconds: 0 };
    const reverse = { screens: { ZZZ: bad, INPUT: bad, RESULT: bad }, completionHoldSeconds: 0 };
    const expected = [
      { code: 'VALUE_INVALID', path: 'screens.INPUT.warnSeconds' },
      { code: 'VALUE_INVALID', path: 'screens.INPUT.resetSeconds' },
      { code: 'VALUE_INVALID', path: 'screens.RESULT.warnSeconds' },
      { code: 'VALUE_INVALID', path: 'screens.RESULT.resetSeconds' },
      { code: 'SCREEN_UNKNOWN', path: 'screens.ZZZ' },
      { code: 'VALUE_INVALID', path: 'completionHoldSeconds' },
    ];
    expect(catchDomainError(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, forward)).defects).toEqual(expected);
    expect(catchDomainError(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, reverse)).defects).toEqual(expected);
  });

  it('거절은 이미 저장된 정책을 그대로 둔다 (읽기 결과가 거절 전과 같다)', () => {
    const w = setup();
    saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, input());
    const stored: IdlePolicy | null = w.repo.getIdlePolicy(TEST_FIXTURE_CLINIC_ID);
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, { screens: { INPUT: { warnSeconds: 5, resetSeconds: 6 } }, completionHoldSeconds: 3 })).code).toBe('INVALID_INPUT');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getIdlePolicy(TEST_FIXTURE_CLINIC_ID)).toEqual(stored);
  });

  it('감사 기록 id 가 이미 쓰였으면 저장 전체가 되돌려진다', () => {
    const w = setup();
    saveClinicIdlePolicy(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, input());
    const taken = w.repo.listAuditLog()[0]!.id;
    const before = snapshotOf(w.repo);
    const deps = { ...w.deps, ids: { next: (prefix: string) => (prefix === 'AUDIT' ? taken : w.ids.next(prefix)) } };
    expect(catchDomainError(() => saveClinicIdlePolicy(deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, input({ completionHoldSeconds: 99 }))).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(readIdlePolicy(w.repo, TEST_FIXTURE_CLINIC_ID).completionHoldSeconds).toBe(10);
  });
});
