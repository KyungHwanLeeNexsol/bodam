import { compareCodePoints } from '../engine/validate';
import { appendAudit } from './audit';
import { canonicalDigest } from './digest';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { Clinic } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import type { Repository } from './repo/interfaces';
import { isAbsent, isPlainObject } from './validate/shape';

// 병원 기본 정보(병원명·상담번호) 설정 (SPEC-REIMBURSEMENT-001 M7 병원 설정, design.md DD-17 권한 표 "병원 설정" 칸 · DD-19 `GET/PUT /api/admin/clinics/{clinicId}/settings`).
//  - 병원 관리자(HA)만 자기 병원에서 한다. 병원 소속 확인과 401/403 은 관리자 라우터가 한다.
//  - 바꿀 수 있는 것은 병원명(name)과 상담번호(contact) 둘뿐이다. 서비스 표시명 "보담"은 병원명과 별도이고 이 모듈 어디에도 쓰기 길이 없다.
//    병원 id·slug·종별·현재 카탈로그 버전은 요청으로 바꿀 수 없다: 요청에 적으면 조용히 무시하지 않고 거절한다(FIELD_NOT_EDITABLE).
//  - 저장은 무조작 정책(idle-policy.ts)과 같은 조건부 저장이다: 한 트랜잭션 안에서 지문 비교 → 값 검사 → 저장 → 감사 기록.

/**
 * [문서에 없음] 아래 한도는 소유자 확인 전의 잠정 값이다(PR 본문의 열린 결정). 값이 바뀌면 이 상수 하나만 바꾼다.
 *  - 병원명: 앞뒤 공백을 뗀 뒤 1~40자(코드 포인트), 눈에 보이지 않는 문자(제어·서식·한글 채움 등, INVISIBLE_CHARACTER) 없음. 키오스크는 공백뿐인 병원명을 거절하므로(parse.ts isLabel) 비어 있는 이름은 서버에서 먼저 막는다.
 *  - 상담번호: 앞뒤 공백을 뗀 뒤 숫자·`-`·`(`·`)`·`+`·공백만, 숫자 4개 이상, 20자 이내. 비어 있으면 거절한다.
 */
export const CLINIC_NAME_MAX_LENGTH = 40;
export const CONTACT_MAX_LENGTH = 20;
export const CONTACT_MIN_DIGITS = 4;
const CONTACT_CHARSET = /^[0-9()+\- ]+$/;
/**
 * 병원명에 들어갈 수 없는 문자: 눈에 보이지 않거나 비어 보여서 "겉보기에 빈 이름"을 만들 수 있는 것들.
 * 제어(Cc: 줄바꿈·탭 포함) · 서식(Cf: 폭 없는 공백·단어 결합자·방향 제어·BOM) · 짝 없는 서로게이트(Cs) · 줄/문단 구분자(Zl·Zp) · 한글 채움 문자와 점자 빈칸.
 * 키오스크 화면은 빈 이름을 trim() 만으로 가리는데(src/app/kiosk/runtime/parse.ts isLabel) 위 문자는 trim() 이 떼지 못해 그대로 통과하기 때문이다.
 * 단어 결합자(ZWJ)가 든 이모지 조합과 방향 제어가 필요한 문자 체계의 이름도 함께 거절하는 것은 잠정 한도의 대가다.
 */
const INVISIBLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u115f\u1160\u3164\uffa0\u2800]/u;

/** 요청이 받는 키. 이 밖의 키는 모두 거절한다. */
const REQUEST_KEYS: readonly string[] = ['name', 'contact', 'expectedDigest'];
/** 바꿀 수 없다고 알려 주는 키(다른 이름의 같은 뜻 포함). 알 수 없는 다른 키는 KEY_UNKNOWN 이다. */
const PROTECTED_KEYS: readonly string[] = ['id', 'clinicId', 'slug', 'institutionType', 'currentCatalogVersionId', 'catalogVersion', 'serviceDisplayName', 'serviceName'];

/** 지문(expectedDigest·settingsDigest)의 형식: canonicalDigest 의 출력(소문자 16진수 64글자). */
const DIGEST_FORMAT = /^[0-9a-f]{64}$/;

/** 관리자 화면이 읽는 병원 설정 보기. 서비스 표시명은 공개 catalog 의 상수를 쓰는 라우터가 붙인다. */
export interface ClinicSettingsView {
  /** 읽기 전용 표시: 요청으로 바꿀 수 없다. */
  clinic: { id: string; slug: string; institutionType: string };
  /** 바꿀 수 있는 두 값. */
  settings: { name: string; contact: string };
  /** 읽기 전용 표시: 병원의 현재 카탈로그 버전. 게시한 적이 없으면 null. */
  catalogVersion: string | null;
  /** 읽은 순간의 설정 상태 지문. 저장(PUT)이 expectedDigest 로 되돌려 보낸다. */
  settingsDigest: string;
}

/**
 * 병원 설정 상태의 변경 감지용 지문: 병원 id 와 병원명·상담번호만 해시한다.
 *  - 카탈로그 버전·slug·종별은 넣지 않는다: 화면을 연 사이에 새 카탈로그가 게시돼도 병원명·상담번호가 그대로면 지문은 그대로라 저장이 막히지 않는다(그 사이 게시된 버전 참조는 저장이 건드리지 않는다).
 *  - 변경 감지에만 쓴다: 비밀값도, 미리보기 증명도 아니다(GET 으로 누구나 읽는다). 같은 상태가 되돌아오면(A → B → A) 지문도 같다.
 */
export function clinicSettingsDigest(clinicId: string, settings: { name: string; contact: string }): string {
  return canonicalDigest({ kind: 'CLINIC_SETTINGS_STATE', clinicId, name: settings.name, contact: settings.contact });
}

/** 병원 설정을 읽는다. 저장소를 바꾸지 않는다. 없는 병원은 NOT_FOUND. 저장된 값은 검사하지 않고 그대로 보인다(예전 형식의 상담번호도 그대로). */
export function readClinicSettingsView(repo: Pick<Repository, 'getClinic'>, clinicId: string): ClinicSettingsView {
  const clinic = repo.getClinic(clinicId);
  if (clinic === null) {
    throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
  }
  return {
    clinic: { id: clinic.id, slug: clinic.slug, institutionType: clinic.institutionType },
    settings: { name: clinic.name, contact: clinic.contact },
    catalogVersion: clinic.currentCatalogVersionId,
    settingsDigest: clinicSettingsDigest(clinic.id, clinic),
  };
}

/** 병원명 하나를 검사한다. 통과하면 앞뒤 공백을 뗀 값을 돌려준다. */
function checkName(out: Defect[], value: unknown): string | null {
  if (isAbsent(value)) {
    out.push({ code: 'VALUE_MISSING', path: 'name' });
    return null;
  }
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '' || Array.from(trimmed).length > CLINIC_NAME_MAX_LENGTH || INVISIBLE_CHARACTER.test(trimmed)) {
    out.push({ code: 'VALUE_INVALID', path: 'name' });
    return null;
  }
  return trimmed;
}

/** 상담번호 하나를 검사한다. 통과하면 앞뒤 공백을 뗀 값을 돌려준다. */
function checkContact(out: Defect[], value: unknown): string | null {
  if (isAbsent(value)) {
    out.push({ code: 'VALUE_MISSING', path: 'contact' });
    return null;
  }
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '' || trimmed.length > CONTACT_MAX_LENGTH || !CONTACT_CHARSET.test(trimmed) || trimmed.replace(/\D/g, '').length < CONTACT_MIN_DIGITS) {
    out.push({ code: 'VALUE_INVALID', path: 'contact' });
    return null;
  }
  return trimmed;
}

/**
 * 요청을 검사한다. 결함 순서: 병원명 → 상담번호 → 지문(호출한 쪽이 먼저 모은 digestDefects) → 받지 않는 키(코드 포인트 순). 요청의 키를 쓴 순서와 무관하다.
 * 결함이 하나라도 있으면 INVALID_INPUT 으로 모아 던진다. 통과하면 앞뒤 공백을 뗀 두 값을 돌려준다.
 */
function parseRequest(request: unknown, digestDefects: readonly Defect[]): { name: string; contact: string } {
  if (!isPlainObject(request)) {
    throw new DomainError('INVALID_INPUT', '병원 설정 요청의 형식이 틀렸다', [{ code: 'VALUE_INVALID', path: '' }]);
  }
  const defects: Defect[] = [];
  const name = checkName(defects, request.name);
  const contact = checkContact(defects, request.contact);
  defects.push(...digestDefects);
  for (const key of Object.keys(request).sort(compareCodePoints)) {
    if (!REQUEST_KEYS.includes(key)) {
      defects.push({ code: PROTECTED_KEYS.includes(key) ? 'FIELD_NOT_EDITABLE' : 'KEY_UNKNOWN', path: key });
    }
  }
  if (defects.length > 0 || name === null || contact === null) {
    throw new DomainError('INVALID_INPUT', '병원 설정 요청의 형식이 틀렸다', defects);
  }
  return { name, contact };
}

// @MX:ANCHOR: [AUTO] HA 의 병원 설정 저장 관리자 경로(PUT settings)의 단일 진입점. 관리자 API 와 시험이 부른다.
// @MX:REASON: 지문 비교·병원 기록 읽기·저장·감사 기록이 한 트랜잭션이어야 한다. 갈라지면 두 관리자 창이 서로의 설정을 모르게 덮어쓰고, 낡은 병원 기록으로 저장하면 그 사이 게시된 카탈로그 버전 참조가 과거 값으로 돌아간다.
/**
 * HA 가 화면이 읽은 상태를 근거로 병원명·상담번호를 저장한다(조건부 저장). 요청 = { name, contact, expectedDigest(GET 이 알린 settingsDigest) } 세 키뿐이다.
 * 순서(한 트랜잭션): 역할 → 병원 존재(NOT_FOUND) → 지문 형식(없음 VALUE_MISSING · 형식 틀림 VALUE_INVALID, 경로 expectedDigest; 값 검사의 결함과 함께 INVALID_INPUT 으로 모아 낸다)
 *   → 현재 지문 비교(다르면 STATE_CONFLICT CLINIC_SETTINGS_CHANGED, 아무것도 쓰지 않는다) → 값 검사(INVALID_INPUT) → 병원 저장 → 감사 기록.
 * 지문이 맞아야 값 검사로 가므로, 낡은 지문과 틀린 값이 함께 오면 409 가 먼저다. 지문이 없거나 형식이 틀리면 비교하지 않고 400 이다.
 * 저장은 같은 트랜잭션 안에서 방금 읽은 병원 기록에 두 필드만 덮어쓴다(`{ ...현재 기록, name, contact }`). 요청이나 화면이 읽은 값으로 병원 기록을 새로 만들지 않으므로
 * 화면을 연 사이 게시된 새 카탈로그의 currentCatalogVersionId 가 과거 값으로 돌아가지 않는다. 충돌 시 자동 재시도도 덮어쓰기도 없다.
 * 값이 현재와 같은 저장도 성공하고 감사 기록을 남긴다(무조작 정책 저장과 같다).
 * 이것은 같은 저장소 트랜잭션 안의 비교다. 실제 DB 의 동시성(격리 수준·잠금)은 이 함수가 보장하지 않으며 검증하지 않았다.
 */
export function saveClinicSettingsChecked(deps: ServiceDeps, actor: Actor, clinicId: string, request: unknown): Clinic {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    const current = deps.repo.getClinic(clinicId);
    if (current === null) {
      throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
    }
    const digestDefects: Defect[] = [];
    // 요청이 객체가 아니면 요청 검사가 VALUE_INVALID(경로 '') 로 거절한다: 지문 이야기는 하지 않는다.
    if (isPlainObject(request)) {
      const expected = request.expectedDigest;
      if (isAbsent(expected)) {
        digestDefects.push({ code: 'VALUE_MISSING', path: 'expectedDigest' });
      } else if (typeof expected !== 'string' || !DIGEST_FORMAT.test(expected)) {
        digestDefects.push({ code: 'VALUE_INVALID', path: 'expectedDigest' });
      } else if (expected !== clinicSettingsDigest(clinicId, current)) {
        throw new DomainError('STATE_CONFLICT', `병원 '${clinicId}' 의 설정이 화면이 읽은 뒤 바뀌었다`, [{ code: 'CLINIC_SETTINGS_CHANGED', path: 'expectedDigest' }]);
      }
    }
    const { name, contact } = parseRequest(request, digestDefects);
    const saved: Clinic = { ...current, name, contact };
    deps.repo.saveClinic(saved);
    appendAudit(deps, actor, {
      action: 'CLINIC_SETTINGS_SAVE',
      target: `CLINIC/${clinicId}/SETTINGS`,
      beforeVersion: canonicalDigest({ name: current.name, contact: current.contact }),
      afterVersion: canonicalDigest({ name: saved.name, contact: saved.contact }),
      reason: null,
    });
    return saved;
  });
}
