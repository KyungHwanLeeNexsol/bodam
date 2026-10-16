import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';

// 게시 검증기 (SPEC-REIMBURSEMENT-001 M3.C). 카탈로그 게시와 규칙 묶음 게시가 저장하기 전에 부르는 순수 검증 함수들이다.
//   validateCatalogPublish     — 치료 가격·공통 기본비용 범위, 닫힌 열거, 허용 출처(AC-010c), 중복 (AC-011h)
//   validateRuleBundlePublish  — 묶음 항목 형식, 머리·봉인, 매핑 필드 규칙, 프로필 구조·값 범위, 서류 규칙, 교차 검사 (AC-011h·AC-011i·AC-007f)
//   assertNoDefects            — 결함이 있으면 PUBLISH_VALIDATION_FAILED 로 던진다
// 검증기는 저장소·시계·전역 상태를 모른다. 결함 {code, path} 를 고정된 순서로 돌려주고, 던지지 않으며, 입력을 바꾸지 않는다.
// 저장하지 않는다는 보장("저장소 전후 비교가 같다", 이전 버전 유지)은 이 검증기를 부르는 게시 서비스가 트랜잭션으로 낸다(M3.D).
//
// 결함 코드 (code) — 이 검증기가 정한 것:
//   형식    NOT_OBJECT · NOT_ARRAY · VALUE_MISSING(없음·null) · VALUE_INVALID(범위·열거·형식 밖) · REF_UNRESOLVABLE
//   카탈로그  ORIGIN_NOT_ACCEPTED · DUPLICATE_TREATMENT_ID · DUPLICATE_ID
//   머리     POLICY_SOURCES_MISSING · POLICY_SOURCE_INCOMPLETE · APPROVER_MISSING · APPROVER_INCOMPLETE · INTEGRITY_MISMATCH · FINGERPRINT_MISSING
//   매핑     DECISION_INVALID · GROUP_KEY_REQUIRED · GROUP_KEY_FORBIDDEN · EXCLUSION_REASON_REQUIRED · EXCLUSION_REASON_FORBIDDEN · SCOPE_INVALID
//   교차     MAPPING_GROUP_NOT_IN_PROFILE · CELL_PROFILE_DUPLICATE · MAPPING_ID_DUPLICATE
//   엔진 구조 검사가 정한 코드는 그대로 전달한다: 프로필(EMPTY_PROFILE, GROUP_ENTRY_INVALID, EMPTY_GROUP_KEY, DUPLICATE_GROUP_KEY, POOLS_NOT_ARRAY,
//   POOL_ENTRY_INVALID, EMPTY_POOL_KEY, DUPLICATE_POOL_KEY, UNKNOWN_POOL_REFERENCE, GROUP_ORDER_MISSING_KEY·DUPLICATE_KEY·UNKNOWN_KEY),
//   서류 규칙 묶음(RULES_NOT_ARRAY, RULE_ENTRY_INVALID, DOCUMENT_CODE_INVALID, REASON_INVALID, PRIORITY_INVALID, WHEN_NOT_OBJECT,
//   WHEN_UNKNOWN_KEY, WHEN_VALUE_INVALID).
// 결함 경로 (path): 카탈로그는 `treatmentVersions[2].patientAmount` · `commonBaseFees[0].amount`, 규칙 묶음은 `bundle.` 로 시작한다
//   (`bundle.profiles[2].groups[0].deduction.rate`, `bundle.mappings[0].groupKey`, `bundle.documentRuleSet.rules[3].when.imaging`).

export { validateCatalogPublish } from './validate/catalog';
export type { CatalogPublishConfig, CatalogPublishRequest } from './validate/catalog';
export { validateRuleBundlePublish } from './validate/bundle';
export type { BundleItemResolver, RuleBundlePublishRequest } from './validate/bundle-form';
export type { Defect } from './domain/errors';

/** 이 검증기가 정한 결함 코드의 닫힌 목록 (엔진 구조 검사가 정한 코드는 포함하지 않는다). */
export const PUBLISH_DEFECT_CODES = [
  'NOT_OBJECT',
  'NOT_ARRAY',
  'VALUE_MISSING',
  'VALUE_INVALID',
  'REF_UNRESOLVABLE',
  'ORIGIN_NOT_ACCEPTED',
  'DUPLICATE_TREATMENT_ID',
  'DUPLICATE_ID',
  'POLICY_SOURCES_MISSING',
  'POLICY_SOURCE_INCOMPLETE',
  'APPROVER_MISSING',
  'APPROVER_INCOMPLETE',
  'INTEGRITY_MISMATCH',
  'FINGERPRINT_MISSING',
  'DECISION_INVALID',
  'GROUP_KEY_REQUIRED',
  'GROUP_KEY_FORBIDDEN',
  'EXCLUSION_REASON_REQUIRED',
  'EXCLUSION_REASON_FORBIDDEN',
  'SCOPE_INVALID',
  'MAPPING_GROUP_NOT_IN_PROFILE',
  'CELL_PROFILE_DUPLICATE',
  'MAPPING_ID_DUPLICATE',
] as const;

/**
 * 결함이 하나라도 있으면 PUBLISH_VALIDATION_FAILED 를 던진다. 결함 목록은 검증기가 정한 순서 그대로 오류에 담긴다
 * (호출자 배열과는 분리된다). 게시 서비스는 트랜잭션 안에서 이 함수를 부르므로 던져지면 쓰기 전체가 되돌려진다.
 */
export function assertNoDefects(defects: readonly Defect[]): void {
  const [first] = defects;
  if (first !== undefined) {
    throw new DomainError('PUBLISH_VALIDATION_FAILED', `게시 검증 실패: 결함 ${defects.length}건 (첫 결함 ${first.code} @ ${first.path})`, defects);
  }
}
