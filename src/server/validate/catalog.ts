import { isWon } from '../../engine/numeric';
import type { Origin } from '../../engine/types';
import type { Defect } from '../domain/errors';
import { BENEFIT_TYPES, CALC_CLASSES, ORIGINS, expectValue, isAbsent, isNonEmptyString, isOneOf, isPlainObject, isString, repeatedPositions } from './shape';

// 카탈로그 게시 검증 (design.md DD-24 "필드별 범위", DD-04 구성별 허용 출처, DD-03 엔진 입력 무결성).
// 순수 함수다: 결함 {code, path} 목록만 돌려준다. 저장·롤백·"저장소 전후 비교가 같다"는 게시 서비스(M3.D)의 몫이다.
// 던지지 않고 입력을 바꾸지 않는다. 입력은 어떤 모양이든 받는다(unknown).

/** 카탈로그 게시 구성. 운영은 ['OPERATING'], 시험은 ['OPERATING','TEST_FIXTURE','DEMO'] (DD-04). */
export interface CatalogPublishConfig {
  readonly acceptedLineOrigins: readonly Origin[];
}

/**
 * 한 병원의 카탈로그에 담을 치료 버전과 공통 기본비용. 두 필드는 엔티티(TreatmentVersion·CommonBaseFee) 배열이어야 하지만,
 * 검증기는 모양이 틀린 입력을 시험할 수 있게 unknown 으로 받는다.
 */
export interface CatalogPublishRequest {
  treatmentVersions: unknown;
  commonBaseFees: unknown;
}

const isBenefitType = isOneOf(BENEFIT_TYPES);
const isCalcClass = isOneOf(CALC_CLASSES);
const isOrigin = isOneOf(ORIGINS);

/** 항목 목록을 읽는다: 배열이 아니면 NOT_ARRAY, 배열이면 항목마다 한 번씩 visit (항목이 객체가 아니면 NOT_OBJECT 이고 읽지 않는다). */
function eachEntry(out: Defect[], list: unknown, path: string, visit: (entry: Record<string, unknown>, at: string, index: number) => void): void {
  if (!Array.isArray(list)) {
    out.push({ code: 'NOT_ARRAY', path });
    return;
  }
  // 인덱스로 돌아 희소 배열의 빈 칸도 undefined 항목으로 잡는다.
  for (let index = 0; index < list.length; index += 1) {
    const entry: unknown = list[index];
    const at = `${path}[${index}]`;
    if (!isPlainObject(entry)) {
      out.push({ code: 'NOT_OBJECT', path: at });
      continue;
    }
    visit(entry, at, index);
  }
}

function checkOrigin(out: Defect[], entry: Record<string, unknown>, at: string, config: CatalogPublishConfig): void {
  // 목록 밖의 값은 허용 출처 판정까지 가지 않는다. 목록 안의 값이 허용 출처 밖이면 운영 구성의 DEMO·TEST_FIXTURE 거절이다 (AC-010c).
  if (expectValue(out, entry.origin, `${at}.origin`, isOrigin) && !config.acceptedLineOrigins.includes(entry.origin as Origin)) {
    out.push({ code: 'ORIGIN_NOT_ACCEPTED', path: `${at}.origin` });
  }
}

function checkProcedureCodes(out: Defect[], value: unknown, path: string): void {
  if (isAbsent(value)) {
    out.push({ code: 'VALUE_MISSING', path });
    return;
  }
  if (!Array.isArray(value)) {
    out.push({ code: 'VALUE_INVALID', path });
    return;
  }
  // 빈 배열은 허용한다 [문서에 없음: DD-03·DD-18 은 행위 코드 목록이 비는 것을 막지 않는다].
  for (let index = 0; index < value.length; index += 1) {
    if (!isNonEmptyString(value[index])) {
      out.push({ code: 'VALUE_INVALID', path: `${path}[${index}]` });
    }
  }
}

/** documentFlags: 객체이고 세 표시가 모두 엄격한 불리언이다. 문자열 "true"·숫자 0/1 은 변환하지 않고 거절한다 (M2.D: 비불리언 표시는 서류 산출을 RULES_UNAVAILABLE 로 만든다). */
function checkDocumentFlags(out: Defect[], value: unknown, path: string): void {
  if (!expectValue(out, value, path, isPlainObject)) {
    return;
  }
  const flags = value as Record<string, unknown>;
  for (const flag of ['imaging', 'biopsy', 'opinionRequired']) {
    expectValue(out, flags[flag], `${path}.${flag}`, (candidate) => typeof candidate === 'boolean');
  }
}

function checkTreatmentVersion(out: Defect[], entry: Record<string, unknown>, at: string, config: CatalogPublishConfig): void {
  expectValue(out, entry.id, `${at}.id`, isNonEmptyString);
  expectValue(out, entry.treatmentId, `${at}.treatmentId`, isNonEmptyString);
  expectValue(out, entry.displayName, `${at}.displayName`, isString);
  expectValue(out, entry.benefitType, `${at}.benefitType`, isBenefitType);
  expectValue(out, entry.patientAmount, `${at}.patientAmount`, isWon);
  expectValue(out, entry.treatmentCode, `${at}.treatmentCode`, isNonEmptyString);
  checkProcedureCodes(out, entry.procedureCodes, `${at}.procedureCodes`);
  expectValue(out, entry.calcClass, `${at}.calcClass`, isCalcClass);
  checkDocumentFlags(out, entry.documentFlags, `${at}.documentFlags`);
  checkOrigin(out, entry, at, config);
}

function checkCommonBaseFee(out: Defect[], entry: Record<string, unknown>, at: string, config: CatalogPublishConfig): void {
  expectValue(out, entry.id, `${at}.id`, isNonEmptyString);
  expectValue(out, entry.baseFeeId, `${at}.baseFeeId`, isNonEmptyString);
  expectValue(out, entry.clinicId, `${at}.clinicId`, isNonEmptyString);
  expectValue(out, entry.displayName, `${at}.displayName`, isString);
  expectValue(out, entry.benefitType, `${at}.benefitType`, isBenefitType);
  expectValue(out, entry.amount, `${at}.amount`, isWon);
  expectValue(out, entry.code, `${at}.code`, isString);
  checkOrigin(out, entry, at, config);
}

/**
 * 같은 값을 가진 항목이 둘 이상이면 그 항목 모두를 보고한다(어느 쪽이 옳은지 고르지 않는다). 형식이 틀린 항목과
 * 비어 있거나 문자열이 아닌 값은 중복으로 세지 않는다(그 결함은 항목 검사가 이미 냈다). 항목 순서대로 보고한다.
 */
function reportDuplicates(out: Defect[], list: unknown, container: string, field: string, code: string): void {
  if (!Array.isArray(list)) {
    return;
  }
  const keys: Array<string | null> = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry: unknown = list[index];
    const value = isPlainObject(entry) ? entry[field] : undefined;
    keys.push(isNonEmptyString(value) ? value : null);
  }
  for (const index of repeatedPositions(keys)) {
    out.push({ code, path: `${container}[${index}].${field}` });
  }
}

// @MX:ANCHOR: [AUTO] 카탈로그 게시 검증. 카탈로그 게시 서비스(M3.D)와 관리자 API 의 400 변환(M7, AC-021f)과 시험이 같은 함수를 부른다.
// @MX:REASON: 가격·기본비용 범위와 허용 출처 거절의 단일 구현이어야 게시 거절과 계산 때의 INVALID_NUMERIC_INPUT·LINE_ORIGIN_NOT_ACCEPTED 가 어긋나지 않는다(DD-24).
/**
 * 카탈로그 게시 요청의 결함을 모두 모아 고정된 순서로 돌려준다 (결함이 없으면 빈 배열):
 *   1) 치료 버전 목록: 목록 모양 → 항목 순서대로(항목 모양, 그 안에서는 id → treatmentId → displayName → benefitType →
 *      patientAmount → treatmentCode → procedureCodes → calcClass → documentFlags → origin → 허용 출처)
 *   2) 공통 기본비용 목록: 같은 방식 (id → baseFeeId → clinicId → displayName → benefitType → amount → code → origin → 허용 출처)
 *   3) 중복: 치료 버전의 treatmentId → 치료 버전의 id → 공통 기본비용의 id → 공통 기본비용의 baseFeeId (엔진이 INPUT_INTEGRITY_VIOLATION 으로 거절할 입력을 막는다)
 * 금액은 엔진의 isWon(0 이상 MAX_AMOUNT_WON 이하 안전 정수, -0 제외)을 그대로 부른다. 값을 고치거나 채우지 않는다.
 * 병원 소유(기본비용의 clinicId 가 이 카탈로그의 병원인지)는 서비스가 확인한다: 이 함수는 병원 id 를 받지 않는다.
 */
export function validateCatalogPublish(request: unknown, config: CatalogPublishConfig): Defect[] {
  const out: Defect[] = [];
  if (!isPlainObject(request)) {
    return [{ code: 'NOT_OBJECT', path: 'catalog' }];
  }
  eachEntry(out, request.treatmentVersions, 'treatmentVersions', (entry, at) => checkTreatmentVersion(out, entry, at, config));
  eachEntry(out, request.commonBaseFees, 'commonBaseFees', (entry, at) => checkCommonBaseFee(out, entry, at, config));
  reportDuplicates(out, request.treatmentVersions, 'treatmentVersions', 'treatmentId', 'DUPLICATE_TREATMENT_ID');
  reportDuplicates(out, request.treatmentVersions, 'treatmentVersions', 'id', 'DUPLICATE_ID');
  reportDuplicates(out, request.commonBaseFees, 'commonBaseFees', 'id', 'DUPLICATE_ID');
  // 같은 기본비용의 두 버전이 한 카탈로그에 든 것도 결함이다(엔진 입력에서 같은 줄 id 가 둘이 된다). 치료의 treatmentId 중복과 같은 성격이다.
  reportDuplicates(out, request.commonBaseFees, 'commonBaseFees', 'baseFeeId', 'DUPLICATE_BASE_FEE_ID');
  return out;
}
