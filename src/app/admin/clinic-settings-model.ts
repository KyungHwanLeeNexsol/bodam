import type { ApiFailure } from './api-types';
import { SETTINGS_COPY as COPY } from './clinic-settings-copy';
import type { ClinicSettingsPutBody, ClinicSettingsView } from './clinic-settings-types';
import type { Api } from './transport';

// 병원 기본 정보 화면의 순수 계산 (SPEC-REIMBURSEMENT-001 M7 병원 설정). React·네트워크·시계를 쓰지 않는다.
// 서버가 권위이다: 여기서 보이는 안내(hint)는 입력을 막지 않는다. 값의 검사(길이·문자·형식)는 서버가 하고, 서버가 거절하면 화면은 그 결함을 문장으로 보인다.
// 입력은 글자 그대로 보낸다: 앞뒤 공백을 떼는 일도 서버가 한다(화면이 값을 몰래 고치지 않는다).

export interface FormState {
  name: string;
  contact: string;
}

// ───────────────────────── 서버 값 ↔ 화면 상태 ─────────────────────────

export const formFromServer = (view: ClinicSettingsView): FormState => ({ name: view.settings.name, contact: view.settings.contact });

/** 화면의 값이 서버에 저장된 값과 다른가(저장할 것이 있는가). 글자 그대로 견준다. */
export const isDirty = (form: FormState, view: ClinicSettingsView): boolean => form.name !== view.settings.name || form.contact !== view.settings.contact;

/** 실제로 보내는 PUT 본문: 입력 + 이 입력이 근거로 삼은 서버 값의 지문(expectedDigest). 지문은 읽은 그대로이고 화면이 만들거나 고치지 않는다. */
export const putBodyOf = (form: FormState, basis: ClinicSettingsView): ClinicSettingsPutBody => ({ name: form.name, contact: form.contact, expectedDigest: basis.settingsDigest });

/**
 * 서버가 지금 가진 값이 이 입력을 저장한 결과와 같은가(응답이 끊긴 저장이 서버에 반영됐는지 다시 읽은 값으로 가린다).
 * 서버는 앞뒤 공백을 떼어 저장하므로 입력도 떼어 견준다.
 */
export const serverMatchesForm = (view: ClinicSettingsView, form: FormState): boolean => view.settings.name === form.name.trim() && view.settings.contact === form.contact.trim();

// ───────────────────────── 응답 모양 확인 ─────────────────────────

const isText = (value: unknown): value is string => typeof value === 'string';

/** 200 응답 본문이 화면이 쓰는 모양인가. 아니면(프록시의 HTML 등) 값으로 쓰지 않는다. */
export function isSettingsView(value: unknown): value is ClinicSettingsView {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Record<string, unknown>;
  const clinic = view['clinic'] as Record<string, unknown> | null | undefined;
  const settings = view['settings'] as Record<string, unknown> | null | undefined;
  return (
    typeof clinic === 'object' &&
    clinic !== null &&
    isText(clinic['id']) &&
    isText(clinic['slug']) &&
    isText(clinic['institutionType']) &&
    typeof settings === 'object' &&
    settings !== null &&
    isText(settings['name']) &&
    isText(settings['contact']) &&
    isText(view['serviceDisplayName']) &&
    (view['catalogVersion'] === null || isText(view['catalogVersion'])) &&
    isText(view['settingsDigest']) &&
    view['settingsDigest'] !== ''
  );
}

// ───────────────────────── 입력 안내 (막지 않는다) ─────────────────────────

/** 병원명 입력 안내. 문제가 없으면 null. 비어 있음만 알리고 나머지(길이·문자)는 서버가 판정한다. */
export const nameHint = (form: FormState): string | null => (form.name.trim() === '' ? COPY.hintNameEmpty : null);

export const contactHint = (form: FormState): string | null => (form.contact.trim() === '' ? COPY.hintContactEmpty : null);

// ───────────────────────── 서버 거절 → 문장 ─────────────────────────

function defectLine(defect: { code: string; path: string }): string {
  if (defect.code === 'FIELD_NOT_EDITABLE') return COPY.failure.notEditable;
  if (defect.path === 'name') return defect.code === 'VALUE_MISSING' ? COPY.failure.nameMissing : COPY.failure.nameInvalid;
  if (defect.path === 'contact') return defect.code === 'VALUE_MISSING' ? COPY.failure.contactMissing : COPY.failure.contactInvalid;
  if (defect.path === 'expectedDigest') return COPY.failure.digestProblem;
  return COPY.failure.other;
}

/** 저장이 "그 사이 다른 곳에서 설정이 바뀌어서" 거절된 응답인가(409 + reason CLINIC_SETTINGS_CHANGED). 이때 서버의 설정은 그대로이고 화면은 자동으로 덮어쓰거나 다시 보내지 않는다. */
export const isSettingsChanged = (result: Api<unknown>): boolean => result.status === 409 && (result.body as ApiFailure).reason === 'CLINIC_SETTINGS_CHANGED';

/** 저장이 서버에서 분명히 거절된 응답(4xx)의 문장. 코드 글자를 보이지 않고, 늘 서버의 설정이 바뀌지 않았다는 말로 끝난다. */
export function saveFailureMessage(result: Api<unknown>): string {
  const failure = result.body as ApiFailure;
  switch (result.status) {
    case 401:
      return COPY.failure.unauthenticated;
    case 403:
      return COPY.failure.forbidden;
    case 404:
      return COPY.failure.notFound;
    case 409:
      return isSettingsChanged(result) ? COPY.failure.settingsChanged : COPY.failure.generic;
    case 400: {
      const lines = [...new Set((failure.defects ?? []).map(defectLine))];
      return lines.length === 0 ? COPY.failure.generic : `${COPY.failure.invalidIntro} ${lines.slice(0, 6).join(' ')} ${COPY.failure.invalidEnd}`;
    }
    default:
      return COPY.failure.generic;
  }
}

/** 응답을 받았지만 결과를 믿을 수 없는 경우(서버 오류): 저장 여부를 단정하지 않고 서버 값을 다시 읽는다. */
export const isOutcomeUnknown = (status: number): boolean => status >= 500;
