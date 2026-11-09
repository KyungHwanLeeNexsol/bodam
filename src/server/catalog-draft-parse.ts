import { isWon } from '../engine/numeric';
import type { BaseFeeEdit, PriceEdit, TreatmentAddition } from './domain/entities';
import type { Defect } from './domain/errors';
import { BENEFIT_TYPES, isNonEmptyString, isOneOf, isPlainObject } from './validate/shape';

// 카탈로그 초안 요청 본문의 형식 검사 (M7 구조 편집: 가격 수정 + 새 치료 + 숨김 + 표시 순서). 순수 함수다: 저장소를 읽지 않고, 던지지 않고, 입력을 바꾸지 않는다.
// 이 파일은 "모양"만 본다. 병원의 현재 게시 치료와 맞는지(없는 치료, 순열 여부, id 충돌)는 catalog-structure.ts 가 저장소를 읽어 본다.
//
// 본문: { priceEdits?, baseFeeEdits?, additions?, deactivations?, order? }. 다섯 키 모두 선택이고, 한 번의 PUT 이 원하는 초안 전체다(덮어쓴다: 빠진 키는 비어 있는 것과 같다). 다른 최상위 키는 UNKNOWN_FIELD 다.
// 기본비용 수정(baseFeeEdits[i])의 키는 { baseFeeId, amount } 둘뿐이다: 코드·급여 구분·이름·출처 같은 보장 판단 필드는 UNKNOWN_FIELD 다. 금액은 치료 가격과 같은 원화 계약(isWon)이다.
// 새 치료(additions[i])의 키는 엄격하다: 아래 열 가지 말고는(calcClass·origin·id·sortOrder·active·clinicId 등) 모두 UNKNOWN_FIELD 다. 서버가 정하는 값을 요청이 정하는 길이 없다.

const PRICE_EDIT_KEYS: readonly string[] = ['treatmentId', 'patientAmount'];
const BASE_FEE_EDIT_KEYS: readonly string[] = ['baseFeeId', 'amount'];
const TOP_LEVEL_KEYS: readonly string[] = ['priceEdits', 'baseFeeEdits', 'additions', 'deactivations', 'reactivations', 'order'];
const ADDITION_KEYS: readonly string[] = ['draftKey', 'displayName', 'description', 'benefitType', 'patientAmount', 'treatmentCode', 'procedureCodes', 'documentFlags', 'amountCondition', 'effectiveDate'];
const DOCUMENT_FLAG_KEYS: readonly string[] = ['imaging', 'biopsy', 'opinionRequired'];
const AMOUNT_CONDITION_KEYS: readonly string[] = ['patientType', 'assumption', 'referenceDate'];

/** 한 초안에 담을 수 있는 새 치료의 수. 이보다 많으면 TOO_MANY_ADDITIONS. */
export const MAX_ADDITIONS = 50;
/** draftKey 의 형식. 치료 id 와 같은 공간에서 쓰이는 이름이므로 안전한 문자만 허용한다. */
export const DRAFT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** YYYY-MM-DD 이면서 달력에 실제로 있는 날짜인지(2026-02-30 은 아니다). 시계·Date 를 쓰지 않는 순수 계산이다. */
export function isCalendarDate(value: unknown): value is string {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const last = month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  return day <= last;
}

/** 요청 본문이 오직 priceEdits 키 하나만 가졌는가(이전 모양). 이때만 "변경 없음"이 옛 코드 NO_PRICE_CHANGE 로 나간다. */
export const isLegacyPriceOnlyBody = (request: unknown): boolean => isPlainObject(request) && Object.keys(request).length === 1 && Object.keys(request)[0] === 'priceEdits';

/** 가격 수정 목록 `[{ treatmentId, patientAmount }]` 의 형식 검사. 결함은 out 에 쌓는다. 허용하는 키는 정확히 두 개다. */
function parsePriceEditList(out: Defect[], list: unknown[]): PriceEdit[] {
  const edits: PriceEdit[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < list.length; index += 1) {
    const entry: unknown = list[index];
    const at = `priceEdits[${index}]`;
    if (!isPlainObject(entry)) {
      out.push({ code: 'NOT_OBJECT', path: at });
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!PRICE_EDIT_KEYS.includes(key)) {
        out.push({ code: 'UNKNOWN_FIELD', path: `${at}.${key}` });
      }
    }
    const { treatmentId, patientAmount } = entry;
    let valid = true;
    if (!isNonEmptyString(treatmentId)) {
      out.push({ code: treatmentId === undefined ? 'VALUE_MISSING' : 'VALUE_INVALID', path: `${at}.treatmentId` });
      valid = false;
    }
    if (!isWon(patientAmount)) {
      out.push({ code: patientAmount === undefined || patientAmount === null ? 'VALUE_MISSING' : 'VALUE_INVALID', path: `${at}.patientAmount` });
      valid = false;
    }
    if (valid) {
      if (seen.has(treatmentId as string)) {
        out.push({ code: 'DUPLICATE_TREATMENT_ID', path: `${at}.treatmentId` });
      } else {
        seen.add(treatmentId as string);
        edits.push({ treatmentId: treatmentId as string, patientAmount: patientAmount as number });
      }
    }
  }
  return edits;
}

/** 기본비용 수정 목록 `[{ baseFeeId, amount }]` 의 형식 검사. 결함은 out 에 쌓는다. 허용하는 키는 정확히 두 개다. 같은 baseFeeId 가 두 번 나오면 DUPLICATE_BASE_FEE_ID. */
function parseBaseFeeEditList(out: Defect[], list: unknown[]): BaseFeeEdit[] {
  const edits: BaseFeeEdit[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < list.length; index += 1) {
    const entry: unknown = list[index];
    const at = `baseFeeEdits[${index}]`;
    if (!isPlainObject(entry)) {
      out.push({ code: 'NOT_OBJECT', path: at });
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!BASE_FEE_EDIT_KEYS.includes(key)) {
        out.push({ code: 'UNKNOWN_FIELD', path: `${at}.${key}` });
      }
    }
    const { baseFeeId, amount } = entry;
    let valid = true;
    if (!isNonEmptyString(baseFeeId)) {
      out.push({ code: baseFeeId === undefined ? 'VALUE_MISSING' : 'VALUE_INVALID', path: `${at}.baseFeeId` });
      valid = false;
    }
    if (!isWon(amount)) {
      out.push({ code: amount === undefined || amount === null ? 'VALUE_MISSING' : 'VALUE_INVALID', path: `${at}.amount` });
      valid = false;
    }
    if (valid) {
      if (seen.has(baseFeeId as string)) {
        out.push({ code: 'DUPLICATE_BASE_FEE_ID', path: `${at}.baseFeeId` });
      } else {
        seen.add(baseFeeId as string);
        edits.push({ baseFeeId: baseFeeId as string, amount: amount as number });
      }
    }
  }
  return edits;
}

/**
 * 가격 수정 요청 본문 `{ priceEdits: [{ treatmentId, patientAmount }] }` 의 형식 검사(이전 모양). 던지지 않는다.
 * 허용하는 키는 정확히 위 둘뿐이다: 급여 구분·행위 코드·분류·치료 이름·출처 같은 다른 키는 UNKNOWN_FIELD 로 거절한다(가격 수정은 보장 판단을 바꾸지 못한다).
 * 새 모양의 본문(구조 편집 포함)은 parseDraftRequest 가 읽는다.
 */
export function parsePriceEdits(request: unknown): { ok: true; edits: PriceEdit[] } | { ok: false; defects: Defect[] } {
  const defects: Defect[] = [];
  if (!isPlainObject(request)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  for (const key of Object.keys(request)) {
    if (key !== 'priceEdits') {
      defects.push({ code: 'UNKNOWN_FIELD', path: `request.${key}` });
    }
  }
  const list = request.priceEdits;
  if (!Array.isArray(list)) {
    defects.push({ code: list === undefined ? 'VALUE_MISSING' : 'NOT_ARRAY', path: 'priceEdits' });
    return { ok: false, defects };
  }
  const edits = parsePriceEditList(defects, list);
  return defects.length > 0 ? { ok: false, defects } : { ok: true, edits };
}

const isBenefitType = isOneOf(BENEFIT_TYPES);

function rejectUnknownKeys(out: Defect[], entry: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) {
      out.push({ code: 'UNKNOWN_FIELD', path: `${at}.${key}` });
    }
  }
}

/** 값이 없거나(undefined·null) 형식이 틀렸을 때의 결함 코드. */
const missingOrInvalid = (value: unknown): string => (value === undefined || value === null ? 'VALUE_MISSING' : 'VALUE_INVALID');

/** 비어 있지 않고 공백(스페이스·탭·줄바꿈)만으로 이루어지지도 않은 문자열인가. 값은 다듬지 않고 그대로 보존한다. */
const isMeaningfulString = (value: unknown): value is string => isNonEmptyString(value) && value.trim() !== '';

function parseNonEmptyString(out: Defect[], value: unknown, path: string): boolean {
  if (isMeaningfulString(value)) {
    return true;
  }
  out.push({ code: missingOrInvalid(value), path });
  return false;
}

/** documentFlags: 객체이고 세 표시가 모두 엄격한 불리언이다(기본값을 채우지 않는다). 다른 키는 UNKNOWN_FIELD. */
function parseDocumentFlags(out: Defect[], value: unknown, path: string): TreatmentAddition['documentFlags'] | null {
  if (!isPlainObject(value)) {
    out.push({ code: value === undefined || value === null ? 'VALUE_MISSING' : 'VALUE_INVALID', path });
    return null;
  }
  rejectUnknownKeys(out, value, DOCUMENT_FLAG_KEYS, path);
  let valid = true;
  for (const flag of DOCUMENT_FLAG_KEYS) {
    if (typeof value[flag] !== 'boolean') {
      out.push({ code: missingOrInvalid(value[flag]), path: `${path}.${flag}` });
      valid = false;
    }
  }
  return valid ? { imaging: value.imaging as boolean, biopsy: value.biopsy as boolean, opinionRequired: value.opinionRequired as boolean } : null;
}

function parseAmountCondition(out: Defect[], value: unknown, path: string): TreatmentAddition['amountCondition'] | null {
  if (!isPlainObject(value)) {
    out.push({ code: value === undefined || value === null ? 'VALUE_MISSING' : 'VALUE_INVALID', path });
    return null;
  }
  rejectUnknownKeys(out, value, AMOUNT_CONDITION_KEYS, path);
  const patientType = parseNonEmptyString(out, value.patientType, `${path}.patientType`);
  const assumption = parseNonEmptyString(out, value.assumption, `${path}.assumption`);
  const dateOk = isCalendarDate(value.referenceDate);
  if (!dateOk) {
    out.push({ code: missingOrInvalid(value.referenceDate), path: `${path}.referenceDate` });
  }
  return patientType && assumption && dateOk ? { patientType: value.patientType as string, assumption: value.assumption as string, referenceDate: value.referenceDate as string } : null;
}

function parseProcedureCodes(out: Defect[], value: unknown, path: string): string[] | null {
  if (value === undefined || value === null) {
    out.push({ code: 'VALUE_MISSING', path });
    return null;
  }
  if (!Array.isArray(value)) {
    out.push({ code: 'VALUE_INVALID', path });
    return null;
  }
  // 빈 배열은 허용한다(카탈로그 게시 검증과 같다). 항목은 모두 비어 있지 않은 문자열이어야 한다.
  let valid = true;
  for (let index = 0; index < value.length; index += 1) {
    if (!isMeaningfulString(value[index])) {
      out.push({ code: 'VALUE_INVALID', path: `${path}[${index}]` });
      valid = false;
    }
  }
  return valid ? [...(value as string[])] : null;
}

function parseAddition(out: Defect[], entry: unknown, index: number, seenKeys: Set<string>): TreatmentAddition | null {
  const at = `additions[${index}]`;
  if (!isPlainObject(entry)) {
    out.push({ code: 'NOT_OBJECT', path: at });
    return null;
  }
  rejectUnknownKeys(out, entry, ADDITION_KEYS, at);
  let valid = true;
  const { draftKey, displayName, description, benefitType, patientAmount, treatmentCode, effectiveDate } = entry;
  if (typeof draftKey === 'string' && DRAFT_KEY_PATTERN.test(draftKey)) {
    if (seenKeys.has(draftKey)) {
      out.push({ code: 'DUPLICATE_DRAFT_KEY', path: `${at}.draftKey` });
      valid = false;
    }
    seenKeys.add(draftKey);
  } else {
    out.push({ code: missingOrInvalid(draftKey), path: `${at}.draftKey` });
    valid = false;
  }
  // 표시 이름은 공백만으로 이루어지면 안 된다. 값은 입력 그대로 보존한다(다듬지 않는다).
  if (typeof displayName !== 'string' || displayName.trim() === '') {
    out.push({ code: missingOrInvalid(displayName), path: `${at}.displayName` });
    valid = false;
  }
  if (typeof description !== 'string') {
    out.push({ code: missingOrInvalid(description), path: `${at}.description` });
    valid = false;
  }
  if (!isBenefitType(benefitType)) {
    out.push({ code: missingOrInvalid(benefitType), path: `${at}.benefitType` });
    valid = false;
  }
  if (!isWon(patientAmount)) {
    out.push({ code: missingOrInvalid(patientAmount), path: `${at}.patientAmount` });
    valid = false;
  }
  if (!parseNonEmptyString(out, treatmentCode, `${at}.treatmentCode`)) {
    valid = false;
  }
  const procedureCodes = parseProcedureCodes(out, entry.procedureCodes, `${at}.procedureCodes`);
  const documentFlags = parseDocumentFlags(out, entry.documentFlags, `${at}.documentFlags`);
  const amountCondition = parseAmountCondition(out, entry.amountCondition, `${at}.amountCondition`);
  if (!isCalendarDate(effectiveDate)) {
    out.push({ code: missingOrInvalid(effectiveDate), path: `${at}.effectiveDate` });
    valid = false;
  }
  if (!valid || procedureCodes === null || documentFlags === null || amountCondition === null) {
    return null;
  }
  return {
    draftKey: draftKey as string,
    displayName: displayName as string,
    description: description as string,
    benefitType: benefitType as TreatmentAddition['benefitType'],
    patientAmount: patientAmount as number,
    treatmentCode: treatmentCode as string,
    procedureCodes,
    documentFlags,
    amountCondition,
    effectiveDate: effectiveDate as string,
  };
}

/** 형식 검사를 통과한 요청. 아직 병원의 현재 게시 치료와 맞춰 보기 전이다(catalog-structure.ts). */
export interface ParsedDraftRequest {
  priceEdits: PriceEdit[];
  /** 요청에 적힌 순서 그대로(저장 때 코드 포인트 순으로 정렬한다). baseFeeId 중복 없음. 현재 금액과 같은지는 저장소를 읽는 쪽이 본다. */
  baseFeeEdits: BaseFeeEdit[];
  additions: TreatmentAddition[];
  /** 요청에 적힌 순서 그대로(저장 때 코드 포인트 순으로 정렬한다). 중복 없음. */
  deactivations: string[];
  /** 다시 표시할 숨긴 치료 id. 요청에 적힌 순서 그대로(저장 때 코드 포인트 순으로 정렬한다). 중복 없음. 숨긴 치료가 맞는지는 catalog-structure.ts 가 저장소를 읽어 본다. */
  reactivations: string[];
  /** 요청에 적힌 순서 그대로. 키가 없거나 null 이면 null(기본 순서). 중복·순열 여부는 catalog-structure.ts 가 본다. */
  order: string[] | null;
  /** 본문이 priceEdits 키 하나뿐이었는가(이전 모양). */
  legacyPriceOnly: boolean;
}

export type DraftParse = { ok: true; request: ParsedDraftRequest } | { ok: false; defects: Defect[] };

function parseStringList(out: Defect[], value: unknown, name: string, duplicateCode: string | null): string[] {
  if (!Array.isArray(value)) {
    out.push({ code: 'NOT_ARRAY', path: name });
    return [];
  }
  const list: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (!isNonEmptyString(entry)) {
      out.push({ code: missingOrInvalid(entry), path: `${name}[${index}]` });
      continue;
    }
    if (duplicateCode !== null && seen.has(entry)) {
      out.push({ code: duplicateCode, path: `${name}[${index}]` });
      continue;
    }
    seen.add(entry);
    list.push(entry);
  }
  return list;
}

/**
 * 초안 요청 본문 `{ priceEdits?, baseFeeEdits?, additions?, deactivations?, order? }` 의 형식 검사. 던지지 않는다. 결함은 모두 모아서 돌려준다.
 * 키가 없는 섹션은 비어 있는 것과 같다. 최상위의 다른 키는 UNKNOWN_FIELD(path `request.<키>`). 새 치료는 최대 MAX_ADDITIONS 건(TOO_MANY_ADDITIONS).
 * order 는 배열이거나 null/생략(기본 순서)이다. order 가 배열이면 항목 중복(DUPLICATE_ORDER_ENTRY)만 여기서 걸러 낸다. 순열 여부는 현재 게시 치료가 있어야 알 수 있다.
 */
export function parseDraftRequest(request: unknown): DraftParse {
  if (!isPlainObject(request)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const defects: Defect[] = [];
  for (const key of Object.keys(request)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      defects.push({ code: 'UNKNOWN_FIELD', path: `request.${key}` });
    }
  }

  let priceEdits: PriceEdit[] = [];
  if (request.priceEdits !== undefined) {
    if (Array.isArray(request.priceEdits)) {
      priceEdits = parsePriceEditList(defects, request.priceEdits);
    } else {
      defects.push({ code: 'NOT_ARRAY', path: 'priceEdits' });
    }
  }

  let baseFeeEdits: BaseFeeEdit[] = [];
  if (request.baseFeeEdits !== undefined) {
    if (Array.isArray(request.baseFeeEdits)) {
      baseFeeEdits = parseBaseFeeEditList(defects, request.baseFeeEdits);
    } else {
      defects.push({ code: 'NOT_ARRAY', path: 'baseFeeEdits' });
    }
  }

  const additions: TreatmentAddition[] = [];
  if (request.additions !== undefined) {
    if (!Array.isArray(request.additions)) {
      defects.push({ code: 'NOT_ARRAY', path: 'additions' });
    } else if (request.additions.length > MAX_ADDITIONS) {
      defects.push({ code: 'TOO_MANY_ADDITIONS', path: 'additions' });
    } else {
      const seenKeys = new Set<string>();
      for (let index = 0; index < request.additions.length; index += 1) {
        const parsed = parseAddition(defects, request.additions[index], index, seenKeys);
        if (parsed !== null) {
          additions.push(parsed);
        }
      }
    }
  }

  const deactivations = request.deactivations === undefined ? [] : parseStringList(defects, request.deactivations, 'deactivations', 'DUPLICATE_TREATMENT_ID');
  const reactivations = request.reactivations === undefined ? [] : parseStringList(defects, request.reactivations, 'reactivations', 'DUPLICATE_TREATMENT_ID');

  let order: string[] | null = null;
  if (request.order !== undefined && request.order !== null) {
    order = parseStringList(defects, request.order, 'order', 'DUPLICATE_ORDER_ENTRY');
  }

  if (defects.length > 0) {
    return { ok: false, defects };
  }
  return { ok: true, request: { priceEdits, baseFeeEdits, additions, deactivations, reactivations, order, legacyPriceOnly: isLegacyPriceOnlyBody(request) } };
}
