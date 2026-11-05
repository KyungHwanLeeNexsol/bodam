import { compareCodePoints } from '../engine/validate';
import { appendAudit } from './audit';
import { canonicalDigest } from './digest';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { IdlePolicy, IdleThreshold } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import type { Repository } from './repo/interfaces';
import { isAbsent, isPlainObject } from './validate/shape';

// 병원별 무조작 정책의 저장과 읽기 (SPEC-REIMBURSEMENT-001 M3.D2, design.md DD-10·DD-13·DD-18·DD-19).
//  - 저장은 병원 관리자(HA)만 한다(DD-17 권한 표: 무조작 정책·completionHoldSeconds 는 HA 칸만 O). 병원 소유·소속은 M7 이다.
//  - 읽기 함수는 저장된 정책이 없으면 DD-10 표의 값을 낸다. 화면 종류마다 따로 겹쳐 쓰므로 저장하지 않은 화면 종류는 표의 값이다.
//    completionHoldSeconds 는 저장된 값이 없으면 null 이다(기본값은 plan.md §E #12 가 정하기 전까지 없다).

/**
 * [문서에 없음의 확정] 화면 종류의 닫힌 목록. DD-10 표는 화면을 묶어 적고 키 이름을 정하지 않는다; 키 이름과 묶음은 DD-19 catalog 응답
 * 예시의 `idlePolicy.screens` 를 따른다(입력 단계 / 정상·보장 제외 결과 / 계산 근거·필요 서류 / 보류 결과 / 세대 확인 안내·계산 중·통신 오류).
 * `K00_Start` 와 `K06_Complete` 는 타이머가 없어 담지 않는다.
 */
export const IDLE_SCREEN_KINDS = ['INPUT', 'RESULT', 'BASIS_AND_DOCUMENTS', 'HOLD_RESULT', 'NOTICE_PROGRESS_ERROR'] as const;
export type IdleScreenKind = (typeof IDLE_SCREEN_KINDS)[number];

/** DD-10 표의 기본값(초). 저장된 정책이 없거나 화면 종류를 저장하지 않았을 때 읽기 함수가 낸다. */
export const DEFAULT_IDLE_THRESHOLDS: Readonly<Record<IdleScreenKind, Readonly<IdleThreshold>>> = {
  INPUT: { warnSeconds: 100, resetSeconds: 120 },
  RESULT: { warnSeconds: 160, resetSeconds: 180 },
  BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 },
  HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 },
  NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 },
};

/**
 * 경고와 초기화 사이의 최소 간격(초). DD-10 "저장 검증(잠정, SPEC 결정): 경고 < 초기화, 초기화 − 경고 ≥ 20초"(plan.md §E #16, 소유자 확인 대기).
 * 무조작 정책에만 적용하고 completionHoldSeconds 에는 적용하지 않는다. 값이 바뀌면 이 상수 하나만 바꾼다.
 */
export const MIN_IDLE_LEAD_SECONDS = 20;

/** 읽기 함수의 결과: 닫힌 다섯 화면 종류가 항상 모두 있다. */
export interface ResolvedIdlePolicy {
  clinicId: string;
  screens: Record<IdleScreenKind, IdleThreshold>;
  completionHoldSeconds: number | null;
}

const isSecondsValue = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isHoldSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const isScreenKind = (value: string): value is IdleScreenKind => (IDLE_SCREEN_KINDS as readonly string[]).includes(value);

/** 초 값 하나를 검사한다: 없으면(undefined·null) VALUE_MISSING, 0 이상의 안전 정수가 아니면 VALUE_INVALID. 통과하면 true. */
function checkSeconds(out: Defect[], value: unknown, path: string): value is number {
  if (isAbsent(value)) {
    out.push({ code: 'VALUE_MISSING', path });
    return false;
  }
  if (!isSecondsValue(value)) {
    out.push({ code: 'VALUE_INVALID', path });
    return false;
  }
  return true;
}

/** 요청을 검사한다. 결함 순서: 화면 종류 이름의 코드 포인트 순(화면마다 경고 → 초기화 → 간격), 그다음 completionHoldSeconds. 키를 쓴 순서와 무관하다. */
function parseRequest(request: unknown): { screens: Partial<Record<IdleScreenKind, IdleThreshold>>; completionHoldSeconds: number | null } | { defects: Defect[] } {
  if (!isPlainObject(request)) {
    return { defects: [{ code: 'VALUE_INVALID', path: '' }] };
  }
  const defects: Defect[] = [];
  const screens: Partial<Record<IdleScreenKind, IdleThreshold>> = {};
  const rawScreens = request.screens;
  if (isAbsent(rawScreens)) {
    defects.push({ code: 'VALUE_MISSING', path: 'screens' });
  } else if (!isPlainObject(rawScreens)) {
    defects.push({ code: 'VALUE_INVALID', path: 'screens' });
  } else {
    for (const key of Object.keys(rawScreens).sort(compareCodePoints)) {
      const path = `screens.${key}`;
      const entry = rawScreens[key];
      if (!isScreenKind(key)) {
        defects.push({ code: 'SCREEN_UNKNOWN', path });
      } else if (!isPlainObject(entry)) {
        defects.push({ code: 'VALUE_INVALID', path });
      } else {
        const warnOk = checkSeconds(defects, entry.warnSeconds, `${path}.warnSeconds`);
        const resetOk = checkSeconds(defects, entry.resetSeconds, `${path}.resetSeconds`);
        if (warnOk && resetOk) {
          if ((entry.resetSeconds as number) - (entry.warnSeconds as number) < MIN_IDLE_LEAD_SECONDS) {
            defects.push({ code: 'LEAD_TIME_TOO_SHORT', path: `${path}.resetSeconds` });
          } else {
            screens[key] = { warnSeconds: entry.warnSeconds as number, resetSeconds: entry.resetSeconds as number };
          }
        }
      }
    }
  }
  const hold = request.completionHoldSeconds;
  if (hold === undefined) {
    defects.push({ code: 'VALUE_MISSING', path: 'completionHoldSeconds' });
  } else if (hold !== null && !isHoldSeconds(hold)) {
    defects.push({ code: 'VALUE_INVALID', path: 'completionHoldSeconds' });
  }
  if (defects.length > 0) {
    return { defects };
  }
  return { screens, completionHoldSeconds: hold as number | null };
}

/** 지문(expectedDigest·policyDigest)의 형식: canonicalDigest 의 출력(소문자 16진수 64글자). */
const DIGEST_FORMAT = /^[0-9a-f]{64}$/;

/**
 * 병원의 무조작 정책 "저장 상태"의 변경 감지용 지문. 병원 id 와 저장소에 실제로 저장된 정책(화면 종류별 값·completionHoldSeconds)을 canonicalDigest 로 해시한다.
 *  - 저장한 적 없음(null) · 저장은 했지만 비어 있음(screens {} 와 completionHoldSeconds null) · 기본값과 같은 값을 직접 저장함 · 직접 설정한 화면 종류의 집합과 값이 모두 서로 다른 지문이다.
 *  - 읽기 결과(기본값으로 채운 값)가 아니라 저장된 상태에서 계산하므로 "기본값을 따름"과 "기본값과 같은 값을 직접 저장함"이 갈린다.
 *  - 변경 감지에만 쓴다: 비밀값도, 미리보기 증명도 아니다(GET 으로 누구나 읽는다). 같은 상태가 되돌아오면(A → B → A) 지문도 같다: 저장 사건이 아니라 상태를 견준다.
 */
export function idlePolicyDigest(clinicId: string, stored: IdlePolicy | null): string {
  return canonicalDigest({ kind: 'IDLE_POLICY_STATE', clinicId, stored: stored === null ? null : { screens: stored.screens, completionHoldSeconds: stored.completionHoldSeconds } });
}

/** 요청 검사 → 저장 → 감사 기록. 호출한 쪽의 트랜잭션 안에서만 부른다. extraDefects 는 요청 검사의 결함 뒤에 붙는다. */
function commitPolicy(deps: ServiceDeps, actor: Actor, clinicId: string, previous: IdlePolicy | null, request: unknown, extraDefects: readonly Defect[]): IdlePolicy {
  const parsed = parseRequest(request);
  const defects = [...('defects' in parsed ? parsed.defects : []), ...extraDefects];
  if ('defects' in parsed || defects.length > 0) {
    throw new DomainError('INVALID_INPUT', '무조작 정책 요청의 형식이 틀렸다', defects);
  }
  const policy: IdlePolicy = { clinicId, screens: parsed.screens as Record<string, IdleThreshold>, completionHoldSeconds: parsed.completionHoldSeconds };
  deps.repo.saveIdlePolicy(policy);
  appendAudit(deps, actor, {
    action: 'IDLE_POLICY_SAVE',
    target: `CLINIC/${clinicId}/IDLE_POLICY`,
    beforeVersion: previous === null ? null : canonicalDigest(previous),
    afterVersion: canonicalDigest(policy),
    reason: null,
  });
  return policy;
}

/**
 * HA 가 병원의 무조작 정책을 **조건 없이** 저장한다(시드·서비스 시험용 안쪽 길). 관리자 API 는 이 함수를 부르지 않고 saveClinicIdlePolicyChecked 를 부른다.
 * 요청 = { screens: 화면 종류별 { warnSeconds, resetSeconds }(일부만 가능), completionHoldSeconds: 양의 정수 | null }.
 * 저장은 정책 전체를 바꾼다(PUT): 요청에 없는 화면 종류는 기본값으로 읽힌다. 순서: 역할 → 병원 존재(NOT_FOUND) → 요청 검사(INVALID_INPUT, 결함 경로 포함) → 쓰기.
 * 거절하면 아무것도 저장하지 않는다.
 */
export function saveClinicIdlePolicy(deps: ServiceDeps, actor: Actor, clinicId: string, request: unknown): IdlePolicy {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    if (deps.repo.getClinic(clinicId) === null) {
      throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
    }
    return commitPolicy(deps, actor, clinicId, deps.repo.getIdlePolicy(clinicId), request, []);
  });
}

// @MX:ANCHOR: [AUTO] HA 의 무조작 정책 저장 관리자 경로(PUT idle-policy)의 단일 진입점. 관리자 API 와 시험이 부른다.
// @MX:REASON: 지문 비교와 저장이 한 트랜잭션이어야 한다. 갈라지면 두 관리자 창이 같은 정책을 읽고 나서 서로의 설정을 모르게 덮어쓴다(PUT 은 전체 교체다).
/**
 * HA 가 화면이 읽은 상태를 근거로 무조작 정책을 저장한다(조건부 저장). 요청 = saveClinicIdlePolicy 의 요청 + expectedDigest(GET 이 알린 policyDigest).
 * 순서(한 트랜잭션): 역할 → 병원 존재(NOT_FOUND) → 지문 형식(없음 VALUE_MISSING · 형식 틀림 VALUE_INVALID, 경로 expectedDigest; 요청 검사의 결함과 함께 INVALID_INPUT 으로 모아 낸다)
 *   → 현재 지문 비교(다르면 STATE_CONFLICT IDLE_POLICY_CHANGED, 아무것도 쓰지 않는다) → 기존 값 검사(INVALID_INPUT) → 정책 저장 → 감사 기록.
 * 지문이 맞아야 값 검사로 가므로, 낡은 지문과 틀린 값이 함께 오면 409 가 먼저다. 지문이 없거나 형식이 틀리면 비교하지 않고 400 이다.
 * 이것은 같은 저장소 트랜잭션 안의 비교다. 실제 DB 의 동시성(격리 수준·잠금)은 이 함수가 보장하지 않으며 검증하지 않았다.
 */
export function saveClinicIdlePolicyChecked(deps: ServiceDeps, actor: Actor, clinicId: string, request: unknown): IdlePolicy {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    if (deps.repo.getClinic(clinicId) === null) {
      throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
    }
    const previous = deps.repo.getIdlePolicy(clinicId);
    const digestDefects: Defect[] = [];
    // 요청이 객체가 아니면 요청 검사가 VALUE_INVALID(경로 '') 로 거절한다: 지문 이야기는 하지 않는다.
    if (isPlainObject(request)) {
      const expected = request.expectedDigest;
      if (isAbsent(expected)) {
        digestDefects.push({ code: 'VALUE_MISSING', path: 'expectedDigest' });
      } else if (typeof expected !== 'string' || !DIGEST_FORMAT.test(expected)) {
        digestDefects.push({ code: 'VALUE_INVALID', path: 'expectedDigest' });
      } else if (expected !== idlePolicyDigest(clinicId, previous)) {
        throw new DomainError('STATE_CONFLICT', `병원 '${clinicId}' 의 무조작 정책이 화면이 읽은 뒤 바뀌었다`, [{ code: 'IDLE_POLICY_CHANGED', path: 'expectedDigest' }]);
      }
    }
    return commitPolicy(deps, actor, clinicId, previous, request, digestDefects);
  });
}

/**
 * 병원의 무조작 정책을 읽는다(catalog 응답 `idlePolicy` 의 원천, DD-19). 저장된 정책이 있으면 저장한 화면 종류는 저장한 값으로, 나머지는 DD-10 표의 값으로
 * 채운 다섯 화면 종류 전부를 돌려주고, 없으면 표의 값 그대로다. completionHoldSeconds 는 저장된 값이 없으면 null.
 * 저장소에 직접 쓰여 닫힌 목록 밖의 키가 남아 있어도 결과에는 싣지 않는다. 없는 병원은 NOT_FOUND. 저장소를 바꾸지 않고 항상 새 사본을 돌려준다.
 */
export function readIdlePolicy(repo: Pick<Repository, 'getClinic' | 'getIdlePolicy'>, clinicId: string): ResolvedIdlePolicy {
  if (repo.getClinic(clinicId) === null) {
    throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
  }
  return resolveStored(clinicId, repo.getIdlePolicy(clinicId));
}

/** 저장된 정책(없으면 null)을 다섯 화면 종류가 모두 있는 읽기 결과로 채운다. readIdlePolicy 와 관리자 보기가 같은 계산을 쓴다. */
function resolveStored(clinicId: string, stored: IdlePolicy | null): ResolvedIdlePolicy {
  const screens = {} as Record<IdleScreenKind, IdleThreshold>;
  for (const kind of IDLE_SCREEN_KINDS) {
    const source = stored?.screens[kind] ?? DEFAULT_IDLE_THRESHOLDS[kind];
    screens[kind] = { warnSeconds: source.warnSeconds, resetSeconds: source.resetSeconds };
  }
  return { clinicId, screens, completionHoldSeconds: stored?.completionHoldSeconds ?? null };
}

/**
 * 관리자 화면이 읽는 보기: 읽기 결과(catalog 응답 `idlePolicy` 와 같은 값)에 더해, 어느 화면 종류가 병원이 직접 저장한 값인지(customizedScreens)와
 * 저장하지 않은 화면 종류가 따르는 기본값(defaults)·간격 하한(minLeadSeconds)을 알린다.
 * 저장(PUT)은 정책 전체를 바꾸고 생략한 화면 종류는 기본값으로 돌아가므로, 화면이 일부만 고쳐도 다른 설정을 잃지 않으려면 어느 종류가 직접 저장된 값인지 알아야 한다.
 * 저장소에 직접 쓰여 닫힌 목록 밖의 키가 남아 있어도 싣지 않는다. 저장소를 바꾸지 않고 항상 새 사본을 돌려준다. 없는 병원은 NOT_FOUND.
 */
export interface IdlePolicyAdminView extends ResolvedIdlePolicy {
  /** 병원이 직접 저장한 화면 종류(닫힌 목록 순서). 나머지는 기본값을 따른다. */
  customizedScreens: IdleScreenKind[];
  defaults: Record<IdleScreenKind, IdleThreshold>;
  minLeadSeconds: number;
  /** 읽은 순간의 저장 상태 지문(idlePolicyDigest). 저장(PUT)이 expectedDigest 로 되돌려 보낸다. */
  policyDigest: string;
}

export function readIdlePolicyAdminView(repo: Pick<Repository, 'getClinic' | 'getIdlePolicy'>, clinicId: string): IdlePolicyAdminView {
  if (repo.getClinic(clinicId) === null) {
    throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
  }
  const stored = repo.getIdlePolicy(clinicId);
  const defaults = {} as Record<IdleScreenKind, IdleThreshold>;
  for (const kind of IDLE_SCREEN_KINDS) {
    defaults[kind] = { warnSeconds: DEFAULT_IDLE_THRESHOLDS[kind].warnSeconds, resetSeconds: DEFAULT_IDLE_THRESHOLDS[kind].resetSeconds };
  }
  return {
    ...resolveStored(clinicId, stored),
    customizedScreens: IDLE_SCREEN_KINDS.filter((kind) => stored !== null && stored.screens[kind] !== undefined),
    defaults,
    minLeadSeconds: MIN_IDLE_LEAD_SECONDS,
    policyDigest: idlePolicyDigest(clinicId, stored),
  };
}
