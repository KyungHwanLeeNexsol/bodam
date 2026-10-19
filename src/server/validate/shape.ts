import type { BenefitType, CalcClass, Generation, InsurerType, Origin, PolicySourceRef } from '../../engine/types';
import { GENERATIONS } from '../../engine/types';
import type { Defect } from '../domain/errors';

// 게시 검증기가 함께 쓰는 작은 도구: 모양 판정, 닫힌 열거 목록, 결함 쌓기.
// 모든 판정은 unknown 을 받아 던지지 않는다. 입력을 고치거나 바꾸지 않는다.

/** 배열이 아닌 객체(null 제외). 엔진 구조 검사(isEntryObject·isRecord)와 같은 판정이다. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 값이 없다: undefined 또는 null. 이런 값을 0·빈 값·기본값으로 채우지 않고 VALUE_MISSING 으로 알린다. */
export function isAbsent(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

/** 빈 문자열이 아닌 문자열. 공백뿐인 문자열은 "비어 있지 않음"이다 (엔진 isUsable 의 판정과 같다). */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// 닫힌 열거 목록. Record<..., true> 로 적어 엔진 타입에 값이 더해지면 여기가 컴파일 오류가 되게 한다(목록이 어긋나지 않는다).
const ORIGIN_KEYS: Record<Origin, true> = { OPERATING: true, DEMO: true, TEST_FIXTURE: true };
const BENEFIT_TYPE_KEYS: Record<BenefitType, true> = { BENEFIT: true, NON_BENEFIT: true };
const CALC_CLASS_KEYS: Record<CalcClass, true> = { GENERAL_BENEFIT: true, GENERAL_NON_BENEFIT: true, MAJOR_THREE_NON_BENEFIT: true, NEEDS_REVIEW: true };
const INSURER_TYPE_KEYS: Record<InsurerType, true> = { NON_LIFE: true, LIFE: true, MUTUAL_AID: true };
const POLICY_SOURCE_FIELD_KEYS: Record<keyof PolicySourceRef, true> = {
  insurerDocumentId: true,
  revisionDate: true,
  clauseOrPage: true,
  effectiveDate: true,
  verifiedBy: true,
  verifiedAt: true,
};

export const ORIGINS = Object.keys(ORIGIN_KEYS) as Origin[];
export const BENEFIT_TYPES = Object.keys(BENEFIT_TYPE_KEYS) as BenefitType[];
export const CALC_CLASSES = Object.keys(CALC_CLASS_KEYS) as CalcClass[];
export const INSURER_TYPES = Object.keys(INSURER_TYPE_KEYS) as InsurerType[];
export const GENERATION_VALUES: readonly Generation[] = GENERATIONS;
/** 약관 출처의 여섯 항목 (선언 순서가 결함 보고 순서다). */
export const POLICY_SOURCE_FIELDS = Object.keys(POLICY_SOURCE_FIELD_KEYS) as Array<keyof PolicySourceRef>;

/**
 * 같은 키를 가진 위치가 둘 이상이면 그 위치 모두를 오름차순으로 돌려준다 (어느 쪽이 옳은지 고르지 않으므로 배열 순서에 달라지지 않는다).
 * 키가 null 인 위치(형식이 틀려 키를 읽을 수 없는 항목)는 세지 않는다.
 */
export function repeatedPositions(keys: ReadonlyArray<string | null>): number[] {
  const byKey = new Map<string, number[]>();
  keys.forEach((key, position) => {
    if (key === null) {
      return;
    }
    const positions = byKey.get(key);
    if (positions === undefined) {
      byKey.set(key, [position]);
    } else {
      positions.push(position);
    }
  });
  return [...byKey.values()]
    .filter((positions) => positions.length >= 2)
    .flat()
    .sort((a, b) => a - b);
}

export function isOneOf<T extends string>(list: readonly T[]): (value: unknown) => value is T {
  return (value: unknown): value is T => typeof value === 'string' && list.includes(value as T);
}

/**
 * 필수 값 하나를 판정한다. 없으면(undefined·null) VALUE_MISSING, 있는데 valid 가 아니면 VALUE_INVALID 를 쌓는다.
 * 통과하면 true 다.
 */
export function expectValue(out: Defect[], value: unknown, path: string, valid: (value: unknown) => boolean): boolean {
  if (isAbsent(value)) {
    out.push({ code: 'VALUE_MISSING', path });
    return false;
  }
  if (!valid(value)) {
    out.push({ code: 'VALUE_INVALID', path });
    return false;
  }
  return true;
}
