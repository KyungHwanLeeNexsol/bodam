import { compareCodePoints } from '../engine/validate';
import type { BenefitType, CalcClass } from '../engine/types';
import { canonicalDigest } from './digest';
import type { CommonBaseFee, TreatmentVersion } from './domain/entities';

// 지문 방어 (design.md DD-15)와 재검토 기준의 보장 판단 필드 (DD-16).
//   approvedFingerprint = 해시(치료 코드, 행위 코드 목록, 급여 구분, 계산 분류)
// 매핑은 승인 때 이 값을 저장하고, 계산할 때 현재 게시된 치료 버전의 지문과 다르면 MAPPING_UNDER_REREVIEW 로 보류된다.
// 가격·표시 이름·설명 등은 지문에 들어가지 않는다 (가격만 바뀌면 매핑을 유지하고 새 카탈로그 버전만 게시한다, DD-16).

/**
 * 보장 판단 필드 (DD-16, 닫힌 목록). 치료 버전의 실제 필드 이름이다 (기획서/DD 표기 `procedureCode(s)` = `procedureCodes`).
 * 이 가운데 하나라도 바뀐 치료 버전을 게시하면 그 치료의 APPROVED·PUBLISHED 매핑이 UNDER_REREVIEW 가 된다 (M3.B).
 * 치료 버전에 새 필드를 추가할 때는 설계 단계에서 이 목록에 넣을지 정한다 (DD-16).
 */
export const COVERAGE_JUDGMENT_FIELDS = ['treatmentCode', 'procedureCodes', 'benefitType', 'calcClass'] as const;
export type CoverageJudgmentField = (typeof COVERAGE_JUDGMENT_FIELDS)[number];

/** 지문의 입력. 보장 판단 필드와 같은 네 가지다. */
export interface CoverageFingerprintInput {
  treatmentCode: string;
  procedureCodes: readonly string[];
  benefitType: BenefitType;
  calcClass: CalcClass;
}

// @MX:ANCHOR: [AUTO] 지문 계산의 단일 구현. 매핑 승인(approvedFingerprint 저장)·게시 시 재검토 판정·카탈로그 줄의 coverageFingerprint 가 모두 부른다.
// @MX:REASON: 승인 때와 계산 때의 지문이 한 함수에서 나와야 한다. 구현이 둘이면 같은 치료가 MAPPING_UNDER_REREVIEW 로 잘못 보류되거나 바뀐 치료가 통과한다(DD-15).
/**
 * 보장 판단 필드의 지문. canonicalDigest 로 만든다 (두 번째 해시 구현 없음).
 * 행위 코드는 순서가 의미 없는 목록으로 보고 코드 포인트 순으로 정렬한 사본을 해시한다. 중복은 합치지 않는다.
 * [문서에 없음] DD-15 는 `procedureCode(s)` 의 순서와 중복을 정하지 않았다. 같은 행위 코드 집합을 다른 순서로 입력해
 * 승인된 매핑이 재검토로 떨어지는 일을 막는 쪽을 택했고, 중복은 입력 오류일 수 있으므로 숨기지 않고 지문에 남긴다.
 */
export function coverageFingerprint(input: CoverageFingerprintInput): string {
  return canonicalDigest({
    treatmentCode: input.treatmentCode,
    procedureCodes: [...input.procedureCodes].sort(compareCodePoints),
    benefitType: input.benefitType,
    calcClass: input.calcClass,
  });
}

/** 치료 버전의 현재 지문. 카탈로그 줄의 `coverageFingerprint` 와 매핑의 `approvedFingerprint` 가 이 값과 비교된다. */
export function coverageFingerprintOf(version: TreatmentVersion): string {
  return coverageFingerprint({
    treatmentCode: version.treatmentCode,
    procedureCodes: version.procedureCodes,
    benefitType: version.benefitType,
    calcClass: version.calcClass,
  });
}

// ───────────────────────── 공통 기본비용 ─────────────────────────
// 공통 기본비용도 치료와 같은 보장 판단(매핑)을 거친다 (design.md DD-03, plan.md §E #8). 기본비용에는 행위 코드 목록과 분류가 없으므로
// 지문 입력의 해당 칸을 정해 같은 지문 함수(coverageFingerprint)에 넣는다. 지문 함수는 대상 종류마다 하나다.

/**
 * 공통 기본비용의 보장 판단 필드 (닫힌 목록). [문서에 없음] DD-16 은 치료 버전의 판단 필드만 적는다. 기본비용에는 코드와 급여 구분을 골랐다:
 * 분류(calcClass)는 급여 구분에서 파생되므로(calcClassOfBaseFee) 따로 필드로 두지 않는다. 가격(amount)·표시 이름·출처·병원은 판단 필드가 아니다.
 * 기본비용에 새 필드를 추가할 때는 설계 단계에서 이 목록에 넣을지 정한다.
 */
export const COMMON_BASE_FEE_JUDGMENT_FIELDS = ['code', 'benefitType'] as const;
export type CommonBaseFeeJudgmentField = (typeof COMMON_BASE_FEE_JUDGMENT_FIELDS)[number];

// @MX:NOTE: [AUTO] [문서에 없음] 기본비용의 분류 파생이 사는 유일한 곳. 급여 → GENERAL_BENEFIT, 비급여 → GENERAL_NON_BENEFIT 이고 확인 필요(NEEDS_REVIEW)로 두지 않는다.
/** 기본비용의 계산 분류는 급여 구분에서 정한다. 지문과 엔진 줄(projection.ts)이 모두 이 함수를 쓴다. */
export function calcClassOfBaseFee(benefitType: BenefitType): CalcClass {
  return benefitType === 'BENEFIT' ? 'GENERAL_BENEFIT' : 'GENERAL_NON_BENEFIT';
}

// @MX:ANCHOR: [AUTO] 공통 기본비용 지문의 단일 구현. 매핑 승인·규칙 묶음 게시의 낡음 검사(coverage-target.ts)·재검토 전환·엔진 줄 변환이 모두 부른다.
// @MX:REASON: 승인 때 고정한 지문과 계산 때 줄이 싣는 지문이 한 함수에서 나와야 같은 기본비용이 MAPPING_UNDER_REREVIEW 로 잘못 보류되지 않는다(DD-15). 구현이 둘이면 가격만 바뀐 새 버전이 매핑을 재검토로 떨어뜨릴 수 있다.
/** 기본비용 버전의 현재 지문: (기본비용 코드, 행위 코드 없음, 급여 구분, 파생 분류). 가격·표시 이름·출처·병원·id 는 들어가지 않는다. */
export function coverageFingerprintOfBaseFee(fee: CommonBaseFee): string {
  return coverageFingerprint({
    treatmentCode: fee.code,
    procedureCodes: [],
    benefitType: fee.benefitType,
    calcClass: calcClassOfBaseFee(fee.benefitType),
  });
}
