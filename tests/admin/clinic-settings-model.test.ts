import { describe, expect, it } from 'vitest';
import { SETTINGS_COPY } from '../../src/app/admin/clinic-settings-copy';
import {
  contactHint,
  formFromServer,
  isDirty,
  isOutcomeUnknown,
  isSettingsChanged,
  isSettingsView,
  nameHint,
  putBodyOf,
  saveFailureMessage,
  serverMatchesForm,
} from '../../src/app/admin/clinic-settings-model';
import type { ClinicSettingsView } from '../../src/app/admin/clinic-settings-types';
import { CLINIC_NAME_MAX_LENGTH, CONTACT_MAX_LENGTH, CONTACT_MIN_DIGITS } from '../../src/server/clinic-settings';

// 병원 기본 정보 화면의 순수 계산 (M7 병원 설정). 서버가 권위이고 화면의 안내는 입력을 막지 않는다. 입력은 글자 그대로 보낸다.

const DIGEST = 'a'.repeat(64);
const view = (overrides: Partial<ClinicSettingsView> = {}): ClinicSettingsView => ({
  clinic: { id: 'CLINIC_1', slug: 'clinic-1', institutionType: 'CLINIC' },
  serviceDisplayName: '보담',
  settings: { name: '서울의원', contact: '02-123-4567' },
  catalogVersion: 'CATALOG_1',
  settingsDigest: DIGEST,
  ...overrides,
});
const api = (status: number, body: unknown) => ({ status, body: body as never });

describe('서버 값 ↔ 화면 상태', () => {
  it('입력 칸은 서버의 병원명·상담번호로 채워진다', () => {
    expect(formFromServer(view())).toEqual({ name: '서울의원', contact: '02-123-4567' });
  });

  it('저장할 것이 있는지는 글자 그대로 견준다: 같으면 아니고, 한 글자라도 다르면(공백 포함) 있다. 예전 값의 앞뒤 공백은 불러오자마자 변경으로 보이지 않는다', () => {
    const base = view();
    expect(isDirty(formFromServer(base), base)).toBe(false);
    expect(isDirty({ name: '서울의원 ', contact: '02-123-4567' }, base)).toBe(true);
    expect(isDirty({ name: '서울의원', contact: '02-123-4568' }, base)).toBe(true);
    const legacy = view({ settings: { name: ' 예전 이름 ', contact: 'TEST_FIXTURE_CONTACT' } });
    expect(isDirty(formFromServer(legacy), legacy)).toBe(false);
  });

  it('저장 본문은 입력 글자 그대로와 입력이 근거로 삼은 서버 값의 지문 세 키뿐이다 (서비스 이름·병원 id·slug·종별·카탈로그 버전은 담지 않는다)', () => {
    const basis = view();
    const body = putBodyOf({ name: '  새 이름  ', contact: ' 031-111-2222 ' }, basis);
    expect(body).toEqual({ name: '  새 이름  ', contact: ' 031-111-2222 ', expectedDigest: DIGEST });
    expect(Object.keys(body).sort()).toEqual(['contact', 'expectedDigest', 'name']);
  });

  it('지문은 입력이 근거로 삼은 값의 것이다: 서버 값이 그 사이 바뀌어도(다른 값을 기준으로 두면) 화면이 새 지문을 만들지 않는다', () => {
    const opened = view();
    const body = putBodyOf({ name: 'x', contact: '02-111-2222' }, opened);
    const refreshedElsewhere = view({ settingsDigest: 'b'.repeat(64) });
    expect(body.expectedDigest).toBe(opened.settingsDigest);
    expect(body.expectedDigest).not.toBe(refreshedElsewhere.settingsDigest);
  });

  it('서버가 지금 가진 값이 입력을 저장한 결과와 같은지는 앞뒤 공백을 떼어 견준다 (서버가 떼어 저장한다)', () => {
    const fresh = view({ settings: { name: '새 이름', contact: '031-111-2222' } });
    expect(serverMatchesForm(fresh, { name: '  새 이름 ', contact: ' 031-111-2222 ' })).toBe(true);
    expect(serverMatchesForm(fresh, { name: '다른 이름', contact: '031-111-2222' })).toBe(false);
    expect(serverMatchesForm(fresh, { name: '새 이름', contact: '031-111-9999' })).toBe(false);
  });
});

describe('응답 모양 확인: isSettingsView', () => {
  it('쓸 수 있는 모양(카탈로그 버전은 글자 또는 null)을 받아들인다', () => {
    expect(isSettingsView(view())).toBe(true);
    expect(isSettingsView(view({ catalogVersion: null }))).toBe(true);
  });

  it('모양이 다르면(HTML·null·키 없음·글자가 아닌 값·빈 지문) 값으로 쓰지 않는다', () => {
    const base = view() as unknown as Record<string, unknown>;
    expect(isSettingsView('<html>')).toBe(false);
    expect(isSettingsView(null)).toBe(false);
    expect(isSettingsView({})).toBe(false);
    for (const key of ['clinic', 'serviceDisplayName', 'settings', 'settingsDigest']) {
      const { [key]: _removed, ...rest } = base;
      expect(isSettingsView(rest), key).toBe(false);
    }
    expect(isSettingsView({ ...base, settingsDigest: '' })).toBe(false);
    expect(isSettingsView({ ...base, settings: { name: 1, contact: 'x' } })).toBe(false);
    expect(isSettingsView({ ...base, settings: { name: 'x', contact: null } })).toBe(false);
    expect(isSettingsView({ ...base, catalogVersion: 3 })).toBe(false);
    expect(isSettingsView({ ...base, clinic: { id: 'x', slug: 'y' } })).toBe(false);
  });
});

describe('입력 안내 (막지 않는다)', () => {
  it('비어 있거나 공백뿐이면 알린다. 길이·문자 형식은 서버가 판정하므로 화면은 말하지 않는다', () => {
    expect(nameHint({ name: '', contact: 'x' })).toBe(SETTINGS_COPY.hintNameEmpty);
    expect(nameHint({ name: '   ', contact: 'x' })).toBe(SETTINGS_COPY.hintNameEmpty);
    expect(nameHint({ name: '가'.repeat(CLINIC_NAME_MAX_LENGTH + 5), contact: 'x' })).toBeNull();
    expect(contactHint({ name: 'x', contact: '' })).toBe(SETTINGS_COPY.hintContactEmpty);
    expect(contactHint({ name: 'x', contact: ' ' })).toBe(SETTINGS_COPY.hintContactEmpty);
    expect(contactHint({ name: 'x', contact: 'abc' })).toBeNull();
  });
});

describe('서버 거절 → 문장', () => {
  const NOTHING = '저장되지 않았고 서버의 설정은 그대로입니다. 입력한 값은 화면에 남아 있습니다.';
  const invalid = (defects: Array<{ code: string; path: string }>) => saveFailureMessage(api(400, { error: 'INVALID_REQUEST', defects }));

  it('409 CLINIC_SETTINGS_CHANGED 는 다른 곳에서 바뀌었다는 안내이고, 다른 409 는 일반 문장이다', () => {
    const changed = api(409, { error: 'CONFLICT', reason: 'CLINIC_SETTINGS_CHANGED' });
    expect(isSettingsChanged(changed)).toBe(true);
    expect(saveFailureMessage(changed)).toBe(SETTINGS_COPY.failure.settingsChanged);
    expect(saveFailureMessage(changed)).toContain('아무것도 저장하지 않았고');
    expect(saveFailureMessage(changed)).toContain('서버 값 다시 읽기');
    const other = api(409, { error: 'CONFLICT', reason: 'IDLE_POLICY_CHANGED' });
    expect(isSettingsChanged(other)).toBe(false);
    expect(isSettingsChanged(api(400, { error: 'INVALID_REQUEST', reason: 'CLINIC_SETTINGS_CHANGED' }))).toBe(false);
    expect(saveFailureMessage(other)).toBe(SETTINGS_COPY.failure.generic);
  });

  it('401·403·404 와 그 밖의 상태는 각자의 문장이고 늘 서버의 설정이 바뀌지 않았다는 말이 들어 있다', () => {
    for (const status of [401, 403, 404, 405, 418]) {
      const text = saveFailureMessage(api(status, { error: 'X' }));
      expect(text, String(status)).toContain(NOTHING);
    }
    expect(saveFailureMessage(api(401, {}))).toBe(SETTINGS_COPY.failure.unauthenticated);
    expect(saveFailureMessage(api(403, {}))).toBe(SETTINGS_COPY.failure.forbidden);
    expect(saveFailureMessage(api(404, {}))).toBe(SETTINGS_COPY.failure.notFound);
  });

  it('400 의 결함은 문장으로 바뀌고 코드·경로 글자가 화면에 나오지 않으며, 같은 문장은 한 번만 나온다', () => {
    const text = invalid([
      { code: 'VALUE_INVALID', path: 'name' },
      { code: 'VALUE_INVALID', path: 'contact' },
      { code: 'FIELD_NOT_EDITABLE', path: 'slug' },
      { code: 'FIELD_NOT_EDITABLE', path: 'id' },
      { code: 'VALUE_INVALID', path: 'expectedDigest' },
    ]);
    expect(text).toContain(SETTINGS_COPY.failure.nameInvalid);
    expect(text).toContain(SETTINGS_COPY.failure.contactInvalid);
    expect(text).toContain(SETTINGS_COPY.failure.digestProblem);
    expect(text.split(SETTINGS_COPY.failure.notEditable)).toHaveLength(2); // 두 결함이 같은 문장이라 한 번
    expect(text.endsWith(NOTHING)).toBe(true);
    for (const raw of ['VALUE_INVALID', 'FIELD_NOT_EDITABLE', 'expectedDigest', 'slug']) expect(text).not.toContain(raw);
  });

  it('값이 없다는 결함은 "비어 있습니다" 문장이다. 결함이 없거나 모르는 경로는 일반 문장이다', () => {
    expect(invalid([{ code: 'VALUE_MISSING', path: 'name' }])).toContain(SETTINGS_COPY.failure.nameMissing);
    expect(invalid([{ code: 'VALUE_MISSING', path: 'contact' }])).toContain(SETTINGS_COPY.failure.contactMissing);
    expect(invalid([{ code: 'KEY_UNKNOWN', path: 'logo' }])).toContain(SETTINGS_COPY.failure.other);
    expect(saveFailureMessage(api(400, { error: 'INVALID_REQUEST' }))).toBe(SETTINGS_COPY.failure.generic);
  });

  it('서버 오류(5xx)는 결과를 믿을 수 없는 경우이고 4xx 는 아니다', () => {
    expect(isOutcomeUnknown(500)).toBe(true);
    expect(isOutcomeUnknown(503)).toBe(true);
    expect(isOutcomeUnknown(409)).toBe(false);
    expect(isOutcomeUnknown(400)).toBe(false);
  });
});

describe('문구가 말하는 한도는 서버 상수와 같다 (한쪽만 바뀌면 여기서 잡는다)', () => {
  it(`병원명 ${CLINIC_NAME_MAX_LENGTH}자, 상담번호 ${CONTACT_MAX_LENGTH}자·숫자 ${CONTACT_MIN_DIGITS}개`, () => {
    expect(SETTINGS_COPY.nameHelp).toContain(`1~${CLINIC_NAME_MAX_LENGTH}자`);
    expect(SETTINGS_COPY.failure.nameInvalid).toContain(`1~${CLINIC_NAME_MAX_LENGTH}자`);
    expect(SETTINGS_COPY.contactHelp).toContain(`숫자 ${CONTACT_MIN_DIGITS}개 이상`);
    expect(SETTINGS_COPY.contactHelp).toContain(`${CONTACT_MAX_LENGTH}자 이내`);
    expect(SETTINGS_COPY.failure.contactInvalid).toContain(`숫자가 ${CONTACT_MIN_DIGITS}개 이상`);
    expect(SETTINGS_COPY.failure.contactInvalid).toContain(`${CONTACT_MAX_LENGTH}자 이내`);
  });

  it('서비스 이름과 병원 식별 정보는 바꿀 수 없다고 알리고, 상담번호는 키오스크에 표시되지 않는다고 알린다', () => {
    expect(SETTINGS_COPY.serviceNote).toContain('바꿀 수 없습니다');
    expect(SETTINGS_COPY.note).toContain('바꿀 수 없습니다');
    expect(SETTINGS_COPY.applyNote).toContain('키오스크에는 표시되지 않습니다');
    expect(SETTINGS_COPY.applyNote).toContain('새로 열 때');
  });
});
