import type { ProposedCoverageInfo } from './domain/entities';
import type { Defect } from './domain/errors';
import { BENEFIT_TYPES, CALC_CLASSES, isNonEmptyString, isOneOf, isPlainObject } from './validate/shape';

// 검토 요청 본문의 형식 검사 (M7 검토 요청). 순수 함수다: 저장소를 읽지 않고, 던지지 않고, 입력을 바꾸지 않는다.
// 이 파일은 "모양"만 본다. 치료가 병원의 현재 게시 치료인지, 열린 요청이 이미 있는지는 review-request.ts 가 저장소를 읽어 본다.
//
// 본문: { proposed: { benefitType, procedureCodes, calcClass } }. 두 단계 모두 키가 엄격하다: 위 말고는 모두 UNKNOWN_FIELD 다.
// 요청자·병원·치료·상태·매핑 연결처럼 서버가 정하는 값을 본문으로 보낼 길이 없다(치료는 경로, 나머지는 서버가 검증한 신원과 저장소에서 온다).
// 제안한 값은 "제안" 일 뿐이므로 분류 네 가지(NEEDS_REVIEW 포함)를 모두 받는다. 행위 코드는 다듬지 않고 그대로 보존한다.

const TOP_LEVEL_KEYS: readonly string[] = ['proposed'];
const PROPOSED_KEYS: readonly string[] = ['benefitType', 'procedureCodes', 'calcClass'];

const isBenefitType = isOneOf(BENEFIT_TYPES);
const isCalcClass = isOneOf(CALC_CLASSES);

/** 비어 있지 않고 공백(스페이스·탭·줄바꿈)만으로 이루어지지도 않은 문자열인가. 값은 다듬지 않고 그대로 보존한다. */
const isMeaningfulString = (value: unknown): value is string => isNonEmptyString(value) && value.trim() !== '';

/** 값이 없거나(undefined·null) 형식이 틀렸을 때의 결함 코드. */
const missingOrInvalid = (value: unknown): string => (value === undefined || value === null ? 'VALUE_MISSING' : 'VALUE_INVALID');

function rejectUnknownKeys(out: Defect[], entry: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) {
      out.push({ code: 'UNKNOWN_FIELD', path: `${at}.${key}` });
    }
  }
}

export type ReviewRequestParse = { ok: true; proposed: ProposedCoverageInfo } | { ok: false; defects: Defect[] };

/**
 * 검토 요청 본문 `{ proposed: { benefitType, procedureCodes, calcClass } }` 의 형식 검사. 던지지 않는다. 결함은 모두 모아서 돌려준다
 * (최상위 알 수 없는 키 → proposed 알 수 없는 키 → benefitType → procedureCodes → calcClass 순).
 * 행위 코드 목록은 비어 있어도 되고, 항목은 모두 비어 있지 않고 공백뿐이지 않은 문자열이어야 한다.
 */
export function parseReviewRequestBody(body: unknown): ReviewRequestParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  rejectUnknownKeys(defects, body, TOP_LEVEL_KEYS, 'request');

  const proposed = body.proposed;
  if (!isPlainObject(proposed)) {
    defects.push({ code: missingOrInvalid(proposed), path: 'proposed' });
    return { ok: false, defects };
  }
  rejectUnknownKeys(defects, proposed, PROPOSED_KEYS, 'proposed');

  const { benefitType, procedureCodes, calcClass } = proposed;
  if (!isBenefitType(benefitType)) {
    defects.push({ code: missingOrInvalid(benefitType), path: 'proposed.benefitType' });
  }
  let codes: string[] | null = null;
  if (!Array.isArray(procedureCodes)) {
    defects.push({ code: missingOrInvalid(procedureCodes), path: 'proposed.procedureCodes' });
  } else {
    let valid = true;
    for (let index = 0; index < procedureCodes.length; index += 1) {
      if (!isMeaningfulString(procedureCodes[index])) {
        defects.push({ code: 'VALUE_INVALID', path: `proposed.procedureCodes[${index}]` });
        valid = false;
      }
    }
    codes = valid ? [...(procedureCodes as string[])] : null;
  }
  if (!isCalcClass(calcClass)) {
    defects.push({ code: missingOrInvalid(calcClass), path: 'proposed.calcClass' });
  }

  if (defects.length > 0 || codes === null || !isBenefitType(benefitType) || !isCalcClass(calcClass)) {
    return { ok: false, defects };
  }
  return { ok: true, proposed: { benefitType, procedureCodes: codes, calcClass } };
}
