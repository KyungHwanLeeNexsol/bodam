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

/**
 * HA 가 병원의 무조작 정책을 저장한다. 요청 = { screens: 화면 종류별 { warnSeconds, resetSeconds }(일부만 가능), completionHoldSeconds: 양의 정수 | null }.
 * 저장은 정책 전체를 바꾼다(PUT): 요청에 없는 화면 종류는 기본값으로 읽힌다. 순서: 역할 → 병원 존재(NOT_FOUND) → 요청 검사(INVALID_INPUT, 결함 경로 포함) → 쓰기.
 * 거절하면 아무것도 저장하지 않는다.
 */
export function saveClinicIdlePolicy(deps: ServiceDeps, actor: Actor, clinicId: string, request: unknown): IdlePolicy {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    if (deps.repo.getClinic(clinicId) === null) {
      throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
    }
    const parsed = parseRequest(request);
    if ('defects' in parsed) {
      throw new DomainError('INVALID_INPUT', '무조작 정책 요청의 형식이 틀렸다', parsed.defects);
    }
    const previous = deps.repo.getIdlePolicy(clinicId);
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
  const stored = repo.getIdlePolicy(clinicId);
  const screens = {} as Record<IdleScreenKind, IdleThreshold>;
  for (const kind of IDLE_SCREEN_KINDS) {
    const source = stored?.screens[kind] ?? DEFAULT_IDLE_THRESHOLDS[kind];
    screens[kind] = { warnSeconds: source.warnSeconds, resetSeconds: source.resetSeconds };
  }
  return { clinicId, screens, completionHoldSeconds: stored?.completionHoldSeconds ?? null };
}
