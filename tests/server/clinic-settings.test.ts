import { describe, expect, it, vi } from 'vitest';
import {
  CLINIC_NAME_MAX_LENGTH,
  CONTACT_MAX_LENGTH,
  CONTACT_MIN_DIGITS,
  clinicSettingsDigest,
  readClinicSettingsView,
  saveClinicSettingsChecked,
} from '../../src/server/clinic-settings';
import { canonicalDigest } from '../../src/server/digest';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { changedKeys } from '../fixtures/server/catalog-structure.fixture';
import { makeCatalogVersion, makeClinic } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { newWorld, seedTreatment } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 병원 기본 정보(병원명·상담번호) 설정 서비스 (M7 병원 설정, DD-17 권한 표 "병원 설정" 칸).
// 조건부 저장은 무조작 정책과 같다: 한 트랜잭션 안에서 지문 비교 → 값 검사 → 저장 → 감사 기록. 병원 소속·401/403 은 관리자 라우터의 일이라 tests/api/admin-clinic-settings.test.ts 가 본다.
// 기본 시험 병원 기록의 상담번호는 'TEST_FIXTURE_CONTACT'(전화번호 형식이 아님)라서, 이 파일의 세계는 병원 두 곳을 올바른 상담번호로 새로 만든다.

const OTHER_CLINIC_ID = 'TEST_FIXTURE_CLINIC_2';
const VALID_CONTACT = '02-123-4567';
const A_NAME = 'TEST_FIXTURE 병원 A';
const A_CONTACT = '031-000-1111';

function setup() {
  const w = newWorld();
  w.repo.saveClinic(makeClinic({ name: A_NAME, contact: A_CONTACT }));
  w.repo.saveClinic(makeClinic({ id: OTHER_CLINIC_ID, slug: 'test-fixture-clinic-2', name: 'TEST_FIXTURE 병원 B', contact: '032-222-3333' }));
  return w;
}

type World = ReturnType<typeof setup>;

const digestNow = (w: World, clinicId: string = TEST_FIXTURE_CLINIC_ID): string => readClinicSettingsView(w.repo, clinicId).settingsDigest;
const body = (w: World, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ name: '새 병원', contact: VALID_CONTACT, expectedDigest: digestNow(w), ...overrides });
const save = (w: World, request: unknown, actor = TEST_FIXTURE_HA_1, clinicId: string = TEST_FIXTURE_CLINIC_ID) => saveClinicSettingsChecked(w.deps, actor, clinicId, request);
const settingsAudit = (w: World) => w.repo.listAuditLog().filter((entry) => entry.action === 'CLINIC_SETTINGS_SAVE');

/** 거절된 저장: 코드와 결함 목록이 기대와 같고 저장소 전체(병원·감사 기록 포함)가 그대로다. */
function expectRejected(w: World, request: unknown, code: string, defects: Array<{ code: string; path: string }>): void {
  const before = snapshotOf(w.repo);
  const error = catchDomainError(() => save(w, request));
  expect(error.code).toBe(code);
  expect(error.defects).toEqual(defects);
  expect(snapshotOf(w.repo)).toEqual(before);
  expect(settingsAudit(w)).toEqual([]);
}

describe('읽기: readClinicSettingsView', () => {
  it('바꿀 수 있는 두 값과 읽기 전용 표시(id·slug·종별·현재 카탈로그 버전)와 지문을 낸다. 저장소는 바뀌지 않는다', () => {
    const w = setup();
    const before = snapshotOf(w.repo);
    const view = readClinicSettingsView(w.repo, TEST_FIXTURE_CLINIC_ID);
    expect(Object.keys(view).sort()).toEqual(['catalogVersion', 'clinic', 'settings', 'settingsDigest']);
    expect(view.clinic).toEqual({ id: TEST_FIXTURE_CLINIC_ID, slug: 'test-fixture-clinic-1', institutionType: 'CLINIC' });
    expect(view.settings).toEqual({ name: A_NAME, contact: A_CONTACT });
    expect(view.catalogVersion).toBeNull();
    expect(view.settingsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('현재 카탈로그 버전이 있으면 읽기 전용으로 보인다', () => {
    const w = newWorld();
    const { catalog } = seedTreatment(w.repo);
    expect(readClinicSettingsView(w.repo, TEST_FIXTURE_CLINIC_ID).catalogVersion).toBe(catalog.id);
  });

  it('없는 병원은 NOT_FOUND 다', () => {
    const w = setup();
    expect(catchDomainError(() => readClinicSettingsView(w.repo, 'TEST_FIXTURE_CLINIC_NOPE')).code).toBe('NOT_FOUND');
  });

  it('저장된 예전 형식의 상담번호도 검사 없이 그대로 보인다 (읽기는 값을 검사하지 않는다)', () => {
    const w = newWorld();
    w.repo.saveClinic(makeClinic());
    expect(readClinicSettingsView(w.repo, TEST_FIXTURE_CLINIC_ID).settings.contact).toBe('TEST_FIXTURE_CONTACT');
  });

  it('지문은 병원 id·병원명·상담번호가 바뀔 때만 바뀌고 같은 상태면 늘 같다. slug 를 바꿔도 같다 (카탈로그 버전·slug 는 지문에 없다)', () => {
    const w = setup();
    const base = digestNow(w);
    expect(digestNow(w)).toBe(base);
    expect(digestNow(w, OTHER_CLINIC_ID)).not.toBe(base);
    expect(clinicSettingsDigest(TEST_FIXTURE_CLINIC_ID, { name: 'x', contact: VALID_CONTACT })).not.toBe(clinicSettingsDigest(TEST_FIXTURE_CLINIC_ID, { name: 'y', contact: VALID_CONTACT }));
    expect(clinicSettingsDigest(TEST_FIXTURE_CLINIC_ID, { name: 'x', contact: '02-111-2222' })).not.toBe(clinicSettingsDigest(TEST_FIXTURE_CLINIC_ID, { name: 'x', contact: '02-111-3333' }));
    w.repo.saveClinic({ ...w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, slug: 'renamed-slug' });
    expect(digestNow(w)).toBe(base);
  });
});

describe('저장: saveClinicSettingsChecked', () => {
  it('병원명·상담번호를 앞뒤 공백을 떼어 저장하고, 바뀐 것은 병원 기록과 감사 기록뿐이며, 병원 기록에서도 바뀐 필드는 그 둘뿐이다', () => {
    const w = setup();
    const beforeState = w.repo.exportState();
    const beforeClinic = w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!;
    const returned = save(w, body(w, { name: '  새 병원  ', contact: ' 02-123-4567 ' }));
    const stored = w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!;
    expect(returned).toEqual(stored);
    expect(stored).toEqual({ ...beforeClinic, name: '새 병원', contact: '02-123-4567' });
    expect(changedKeys(beforeState, w.repo.exportState())).toEqual(['auditLog', 'clinics']);
    expect(w.repo.getClinic(OTHER_CLINIC_ID)!.name).toBe('TEST_FIXTURE 병원 B');
  });

  it('성공한 저장은 감사 기록 CLINIC_SETTINGS_SAVE 한 건(수행자·역할·대상·이전/이후 지문·사유 없음)을 남긴다', () => {
    const w = setup();
    save(w, body(w));
    const entries = settingsAudit(w);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: TEST_FIXTURE_HA_1.id,
      role: 'HA',
      action: 'CLINIC_SETTINGS_SAVE',
      target: `CLINIC/${TEST_FIXTURE_CLINIC_ID}/SETTINGS`,
      beforeVersion: canonicalDigest({ name: A_NAME, contact: A_CONTACT }),
      afterVersion: canonicalDigest({ name: '새 병원', contact: VALID_CONTACT }),
      reason: null,
    });
    expect(entries[0]!.beforeVersion).not.toBe(entries[0]!.afterVersion);
  });

  it('값이 현재와 같아도 저장은 성공하고 감사 기록 한 건을 남긴다 (무조작 정책 저장과 같다)', () => {
    const w = setup();
    save(w, { name: A_NAME, contact: A_CONTACT, expectedDigest: digestNow(w) });
    expect(settingsAudit(w)).toHaveLength(1);
    expect(settingsAudit(w)[0]!.beforeVersion).toBe(settingsAudit(w)[0]!.afterVersion);
  });

  it('성공한 저장의 지문은 한 번만 쓸 수 있다: 같은 요청을 다시 보내면 409 이고 감사 기록은 한 건이다', () => {
    const w = setup();
    const request = body(w);
    save(w, request);
    expect(digestNow(w)).not.toBe(request.expectedDigest);
    const error = catchDomainError(() => save(w, request));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(settingsAudit(w)).toHaveLength(1);
  });

  it('저장은 방금 읽은 병원 기록에 두 필드만 덮어쓴다: 화면을 연 뒤 새 카탈로그가 게시돼도 현재 카탈로그 버전 참조가 과거 값으로 돌아가지 않는다 (지문도 그대로라 저장이 막히지 않는다)', () => {
    const w = newWorld();
    const { catalog: first } = seedTreatment(w.repo);
    w.repo.saveClinic({ ...w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, name: A_NAME, contact: A_CONTACT });
    const opened = body(w); // 화면을 연 순간의 지문
    expect(readClinicSettingsView(w.repo, TEST_FIXTURE_CLINIC_ID).catalogVersion).toBe(first.id);

    // 화면을 열어 둔 사이 새 카탈로그가 게시되어 병원의 현재 버전이 바뀐다.
    const second = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_2', baseFeeIds: [] });
    w.repo.putCatalogVersion(second);
    w.repo.saveClinic({ ...w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, currentCatalogVersionId: second.id });

    save(w, opened);
    const stored = w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!;
    expect(stored.currentCatalogVersionId).toBe(second.id);
    expect(stored.name).toBe('새 병원');
    expect(stored.contact).toBe(VALID_CONTACT);
  });

  it('반대 순서: 병원명을 먼저 저장한 뒤 카탈로그가 게시돼도 새 병원명이 그대로다 (게시가 병원 기록을 읽어 쓰므로 이름이 되돌아가지 않는다)', () => {
    const w = newWorld();
    seedTreatment(w.repo);
    w.repo.saveClinic({ ...w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, name: A_NAME, contact: A_CONTACT });
    save(w, body(w));
    const second = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_2', baseFeeIds: [] });
    w.repo.putCatalogVersion(second);
    w.repo.saveClinic({ ...w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, currentCatalogVersionId: second.id });
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)).toMatchObject({ name: '새 병원', contact: VALID_CONTACT, currentCatalogVersionId: second.id });
  });

  it('비교와 저장은 한 트랜잭션이다: 저장 도중(감사 기록 쓰기)에 실패하면 병원 저장도 되돌려진다', () => {
    const w = setup();
    const request = body(w);
    const before = snapshotOf(w.repo);
    const spy = vi.spyOn(w.repo, 'appendAuditLog').mockImplementation(() => {
      throw new Error('감사 기록 쓰기 실패(시험용)');
    });
    expect(() => save(w, request)).toThrow('감사 기록 쓰기 실패');
    spy.mockRestore();
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)).toMatchObject({ name: A_NAME, contact: A_CONTACT });
  });
});

describe('순서와 권한: 역할 → 병원 존재 → 지문 → 값', () => {
  it('병원 관리자(HA)가 아니면 ROLE_NOT_PERMITTED 이고 아무것도 바뀌지 않는다 (PO·RV)', () => {
    const w = setup();
    const before = snapshotOf(w.repo);
    for (const actor of [TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR]) {
      expect(catchDomainError(() => save(w, body(w), actor)).code).toBe('ROLE_NOT_PERMITTED');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('없는 병원은 지문이 틀려도 NOT_FOUND 가 먼저다. 역할이 틀리면 그것이 더 먼저다', () => {
    const w = setup();
    expect(catchDomainError(() => save(w, { name: 'x', contact: VALID_CONTACT, expectedDigest: 'abc' }, TEST_FIXTURE_HA_1, 'TEST_FIXTURE_CLINIC_NOPE')).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => save(w, { expectedDigest: 'abc' }, TEST_FIXTURE_PO_1, 'TEST_FIXTURE_CLINIC_NOPE')).code).toBe('ROLE_NOT_PERMITTED');
  });

  it('지문 비교가 값 검사보다 먼저다: 낡은 지문과 틀린 값이 함께 오면 409, 현재 지문과 틀린 값이면 400 이다. 둘 다 아무것도 바꾸지 않는다', () => {
    const w = setup();
    const stale = digestNow(w);
    save(w, body(w, { name: '앞선 저장' }));
    const settingsAuditCount = settingsAudit(w).length;
    const before = snapshotOf(w.repo);
    const conflict = catchDomainError(() => save(w, { name: '', contact: 'abc', expectedDigest: stale }));
    expect(conflict.code).toBe('STATE_CONFLICT');
    expect(conflict.defects).toEqual([{ code: 'CLINIC_SETTINGS_CHANGED', path: 'expectedDigest' }]);
    const invalid = catchDomainError(() => save(w, { name: '', contact: 'abc', expectedDigest: digestNow(w) }));
    expect(invalid.code).toBe('INVALID_INPUT');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(settingsAudit(w)).toHaveLength(settingsAuditCount);
  });
});

describe('동시 저장 방어: 두 창', () => {
  it('두 창이 같은 설정을 읽고 먼저 저장한 창이 이기면, 나중 창의 낡은 저장은 409 이고 앞선 저장·감사 기록은 그대로다. 자동 재시도·덮어쓰기는 없다', () => {
    const w = setup();
    const opened = digestNow(w); // 두 창이 같은 지문을 읽는다
    save(w, { name: '창 1 의 이름', contact: '02-111-1111', expectedDigest: opened });
    const after1 = snapshotOf(w.repo);
    const error = catchDomainError(() => save(w, { name: '창 2 의 이름', contact: '02-222-2222', expectedDigest: opened }));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toEqual([{ code: 'CLINIC_SETTINGS_CHANGED', path: 'expectedDigest' }]);
    expect(snapshotOf(w.repo)).toEqual(after1);
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)).toMatchObject({ name: '창 1 의 이름', contact: '02-111-1111' });
    expect(settingsAudit(w)).toHaveLength(1);
    // 새로 읽은 지문으로 다시 보내야 저장된다.
    save(w, { name: '창 2 의 이름', contact: '02-222-2222', expectedDigest: digestNow(w) });
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!.name).toBe('창 2 의 이름');
    expect(settingsAudit(w)).toHaveLength(2);
  });

  it('다른 병원의 지문으로는 저장할 수 없다 (병원 id 가 지문에 들어 있다)', () => {
    const w = setup();
    expectRejected(w, body(w, { expectedDigest: digestNow(w, OTHER_CLINIC_ID) }), 'STATE_CONFLICT', [{ code: 'CLINIC_SETTINGS_CHANGED', path: 'expectedDigest' }]);
  });

  it('지문이 없으면 VALUE_MISSING, 형식이 틀리면 VALUE_INVALID (경로 expectedDigest)이고 비교하지 않는다', () => {
    const w = setup();
    const { expectedDigest: _omitted, ...withoutDigest } = body(w);
    expectRejected(w, withoutDigest, 'INVALID_INPUT', [{ code: 'VALUE_MISSING', path: 'expectedDigest' }]);
    expectRejected(w, body(w, { expectedDigest: null }), 'INVALID_INPUT', [{ code: 'VALUE_MISSING', path: 'expectedDigest' }]);
    for (const bad of ['abc', digestNow(w).toUpperCase(), digestNow(w).slice(1), 42, {}]) {
      expectRejected(w, body(w, { expectedDigest: bad }), 'INVALID_INPUT', [{ code: 'VALUE_INVALID', path: 'expectedDigest' }]);
    }
  });
});

describe('값 검사: 병원명', () => {
  const bad = (w: World, name: unknown) => expectRejected(w, body(w, { name }), 'INVALID_INPUT', [{ code: 'VALUE_INVALID', path: 'name' }]);

  it('비어 있거나 공백뿐인 병원명은 거절된다 (키오스크가 공백뿐인 이름을 거절하므로 서버가 먼저 막는다)', () => {
    const w = setup();
    for (const name of ['', '   ', '\t', '\n', '　']) bad(w, name);
  });

  it('문자열이 아닌 값은 거절된다', () => {
    const w = setup();
    for (const name of [123, true, {}, [], ['병원']]) bad(w, name);
  });

  it('제어 문자가 들어 있으면 거절된다', () => {
    const w = setup();
    for (const name of ['병\n원', '병\u0000원', '병\t원', '병\u007f원']) bad(w, name);
  });

  it('눈에 보이지 않거나 비어 보이는 문자는 거절된다: 폭 없는 공백·단어 결합자·방향 제어·한글 채움 문자·점자 빈칸·줄/문단 구분자·짝 없는 서로게이트 (키오스크 isLabel 은 trim 만 본다)', () => {
    const w = setup();
    const invisibles = ['\u200b', '\u2060', '\ufeff', '\u200d', '\u202e', '\u2066', '\u3164', '\u115f', '\u1160', '\uffa0', '\u2800', '\u2028', '\u2029', '\ud800', '\udc00', '병\u200b원', '병\u202e원', '병\u2028원', '병\ud800원'];
    for (const name of invisibles) bad(w, name);
    // 보이는 글자가 함께 있어도 눈에 보이지 않는 문자가 하나라도 섞이면 거절한다. 보이는 일반 이름은 그대로 저장된다.
    save(w, body(w, { name: '서울 365 의원 (본점)' }));
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!.name).toBe('서울 365 의원 (본점)');
  });

  it(`길이는 앞뒤 공백을 뗀 뒤 코드 포인트로 센다: ${CLINIC_NAME_MAX_LENGTH}자는 저장되고 ${CLINIC_NAME_MAX_LENGTH + 1}자는 거절된다`, () => {
    const w = setup();
    bad(w, '가'.repeat(CLINIC_NAME_MAX_LENGTH + 1));
    bad(w, '😀'.repeat(CLINIC_NAME_MAX_LENGTH + 1));
    save(w, body(w, { name: '가'.repeat(CLINIC_NAME_MAX_LENGTH) }));
    save(w, body(w, { name: `  ${'😀'.repeat(CLINIC_NAME_MAX_LENGTH)}  ` }));
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!.name).toBe('😀'.repeat(CLINIC_NAME_MAX_LENGTH));
  });

  it('병원명이 없으면(키 없음·null) VALUE_MISSING 이다', () => {
    const w = setup();
    const { name: _omitted, ...withoutName } = body(w);
    expectRejected(w, withoutName, 'INVALID_INPUT', [{ code: 'VALUE_MISSING', path: 'name' }]);
    expectRejected(w, body(w, { name: null }), 'INVALID_INPUT', [{ code: 'VALUE_MISSING', path: 'name' }]);
  });
});

describe('값 검사: 상담번호', () => {
  const bad = (w: World, contact: unknown) => expectRejected(w, body(w, { contact }), 'INVALID_INPUT', [{ code: 'VALUE_INVALID', path: 'contact' }]);

  it('비어 있거나 공백뿐이면 거절된다', () => {
    const w = setup();
    for (const contact of ['', '   ']) bad(w, contact);
  });

  it('숫자·`-`·`(`·`)`·`+`·공백 밖의 문자(글자·점·슬래시·개행)가 있으면 거절된다', () => {
    const w = setup();
    for (const contact of ['abc', '02-abc-4567', '02.123.4567', '02/123/4567', '02-123-4567\n02', '＋82-2-123-4567', '02-123-4567 ext']) bad(w, contact);
  });

  it(`숫자가 ${CONTACT_MIN_DIGITS}개 미만이면 거절되고 ${CONTACT_MIN_DIGITS}개면 저장된다`, () => {
    const w = setup();
    for (const contact of ['123', '12-3', '(+) -  ']) bad(w, contact);
    save(w, body(w, { contact: '12-34' }));
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!.contact).toBe('12-34');
  });

  it(`길이는 앞뒤 공백을 뗀 뒤 ${CONTACT_MAX_LENGTH}자까지다`, () => {
    const w = setup();
    bad(w, '1'.repeat(CONTACT_MAX_LENGTH + 1));
    save(w, body(w, { contact: ` ${'1'.repeat(CONTACT_MAX_LENGTH)} ` }));
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!.contact).toBe('1'.repeat(CONTACT_MAX_LENGTH));
  });

  it('문자열이 아닌 값은 거절되고, 없으면(키 없음·null) VALUE_MISSING 이다', () => {
    const w = setup();
    for (const contact of [1234567, true, {}, []]) bad(w, contact);
    const { contact: _omitted, ...withoutContact } = body(w);
    expectRejected(w, withoutContact, 'INVALID_INPUT', [{ code: 'VALUE_MISSING', path: 'contact' }]);
    expectRejected(w, body(w, { contact: null }), 'INVALID_INPUT', [{ code: 'VALUE_MISSING', path: 'contact' }]);
  });

  it('흔한 국내 번호 형식은 저장된다', () => {
    const w = setup();
    for (const contact of ['1588-1234', '(02) 123-4567', '+82 2-123-4567', '031-123-4567', '070 1234 5678']) {
      save(w, body(w, { contact }));
      expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!.contact).toBe(contact);
    }
  });
});

describe('값 검사: 받지 않는 키와 결함 순서', () => {
  const PROTECTED = ['id', 'clinicId', 'slug', 'institutionType', 'currentCatalogVersionId', 'catalogVersion', 'serviceDisplayName', 'serviceName'];

  it('바꿀 수 없는 필드(병원 id·slug·종별·현재 카탈로그 버전·서비스 표시명)를 적으면 조용히 무시하지 않고 FIELD_NOT_EDITABLE 로 거절한다. 병원 기록은 그대로다', () => {
    const w = setup();
    for (const key of PROTECTED) {
      expectRejected(w, body(w, { [key]: 'x' }), 'INVALID_INPUT', [{ code: 'FIELD_NOT_EDITABLE', path: key }]);
    }
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)).toMatchObject({ slug: 'test-fixture-clinic-1', institutionType: 'CLINIC', currentCatalogVersionId: null });
  });

  it('그 밖의 알 수 없는 키는 KEY_UNKNOWN 이고, __proto__ 도 객체 원형을 오염시키지 않고 거절된다', () => {
    const w = setup();
    expectRejected(w, body(w, { phone: '1' }), 'INVALID_INPUT', [{ code: 'KEY_UNKNOWN', path: 'phone' }]);
    const polluted = JSON.parse(`{"name":"새 병원","contact":"${VALID_CONTACT}","expectedDigest":"${digestNow(w)}","__proto__":{"polluted":true}}`) as unknown;
    expectRejected(w, polluted, 'INVALID_INPUT', [{ code: 'KEY_UNKNOWN', path: '__proto__' }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('객체가 아닌 요청은 VALUE_INVALID(경로 빈 문자열) 하나로 거절된다', () => {
    const w = setup();
    for (const request of [null, undefined, 'x', 5, [], [body(w)]]) {
      expectRejected(w, request, 'INVALID_INPUT', [{ code: 'VALUE_INVALID', path: '' }]);
    }
  });

  it('결함 순서는 병원명 → 상담번호 → 지문 → 받지 않는 키(코드 포인트 순)이고 요청의 키 순서와 무관하다', () => {
    const w = setup();
    const expected = [
      { code: 'VALUE_INVALID', path: 'name' },
      { code: 'VALUE_INVALID', path: 'contact' },
      { code: 'VALUE_INVALID', path: 'expectedDigest' },
      { code: 'FIELD_NOT_EDITABLE', path: 'id' },
      { code: 'FIELD_NOT_EDITABLE', path: 'slug' },
      { code: 'KEY_UNKNOWN', path: 'zzz' },
    ];
    expectRejected(w, { zzz: 1, slug: 'x', expectedDigest: 'bad', contact: 'abc', name: '', id: 'y' }, 'INVALID_INPUT', expected);
    expectRejected(w, { id: 'y', name: '', contact: 'abc', expectedDigest: 'bad', slug: 'x', zzz: 1 }, 'INVALID_INPUT', expected);
  });

  it('한 필드만 틀리면 그 필드의 결함만 나온다 (다른 필드의 결함이 따라붙지 않는다)', () => {
    const w = setup();
    expectRejected(w, body(w, { contact: '12' }), 'INVALID_INPUT', [{ code: 'VALUE_INVALID', path: 'contact' }]);
  });
});
