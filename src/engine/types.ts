// 엔진 입력·출력 형식과 상태 코드 (SPEC-REIMBURSEMENT-001 design.md DD-02, DD-03).
// 상태 코드·보류 사유 코드·오류 코드·열거값은 SPEC 전체에서 같은 문자열을 쓴다.
// 순수 형식 모듈이다. 판정·계산 함수는 두지 않는다.

// ───────────────────────── 수치 별칭 ─────────────────────────
// 별칭 자체는 검증이 아니다. 범위 검사는 numeric.ts 의 isWon/isBasisPoints 와 DD-24 가 정한다.

/** 원 단위 정수. 범위: 0 이상 MAX_AMOUNT_WON 이하 (DD-24). */
export type Won = number;
/** 정수, 10000 = 100%. 비율은 basis points 로만 저장한다. 범위: 0 이상 10000 이하 (DD-24). */
export type BasisPoints = number;

// ───────────────────────── 열거값 ─────────────────────────

export const GENERATIONS = ['GEN1_AS', 'GEN2_C1', 'GEN2_5_C2', 'GEN3_C3', 'GEN4_C4'] as const;
export type Generation = (typeof GENERATIONS)[number];

/** 손해보험사 / 생명보험사 / 그외 공제 조합. */
export type InsurerType = 'NON_LIFE' | 'LIFE' | 'MUTUAL_AID';
export type Origin = 'OPERATING' | 'DEMO' | 'TEST_FIXTURE';
/** 급여 / 비급여. */
export type BenefitType = 'BENEFIT' | 'NON_BENEFIT';
export type CalcClass =
  | 'GENERAL_BENEFIT'
  | 'GENERAL_NON_BENEFIT'
  | 'MAJOR_THREE_NON_BENEFIT'
  | 'NEEDS_REVIEW';

/** 규칙 데이터(프로필·매핑·서류 규칙 묶음)의 생명주기 상태 (DD-17). */
export type LifecycleState =
  | 'DRAFT'
  | 'REVIEW_REQUESTED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'UNDER_REREVIEW'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'SUSPENDED';

// ───────────────────────── 공제·한도 규칙 (DD-02) ─────────────────────────

/** 기본값이 없다. 비율 규칙에서 빠지면 그 그룹은 PROFILE_VALUE_MISSING 으로 보류된다. */
export type Rounding = 'TRUNCATE' | 'ROUND_HALF_UP';

export type DeductionRule =
  | { kind: 'FIXED'; fixed: Won }
  | { kind: 'RATE_WITH_FIXED_FLOOR'; fixed: Won; rate: BasisPoints; rounding: Rounding }
  | {
      kind: 'SPLIT_RATE_WITH_FIXED_FLOOR';
      fixed: Won;
      rateBenefit: BasisPoints;
      rateNonBenefit: BasisPoints;
      rounding: Rounding;
    }
  | { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR'; fixed: Won; rate: BasisPoints; rounding: Rounding };

export type LimitBasis = 'PAYOUT' | 'COVERED_COST';

export type LimitRule =
  | { kind: 'PER_VISIT_PAYOUT'; amount: Won; limitBasis: LimitBasis }
  | { kind: 'UNLIMITED_DECLARED'; policyClauseRef: string }
  | { kind: 'PER_ACCIDENT' | 'ANNUAL'; amount: Won; limitBasis: LimitBasis }
  | { kind: 'COUNT'; perUseAmount: Won; limitBasis: LimitBasis };

export interface CoverageGroupDef {
  /** 프로필 안에서 비어 있지 않고 유일해야 한다. */
  groupKey: string;
  /** 모든 그룹에 필수. 보장 여부는 그룹이 아니라 매핑의 decision 이 나른다. */
  deduction: DeductionRule;
  /** 모든 그룹에 필수. */
  limit: LimitRule;
  /** 있으면 같은 프로필의 poolKey 하나를 가리켜야 한다. */
  sharedLimitPoolKey?: string;
}

export interface SharedLimitPool {
  poolKey: string;
  limit: LimitRule;
}

// ───────────────────────── 규칙 데이터 (엔진이 읽는 부분) ─────────────────────────
// DB 엔티티 필드(작성자, 병원 id 등)는 M3 가 정한다. 여기에는 엔진 판정에 필요한 필드만 둔다.

/** 약관 출처: 보험사 원문 식별, 개정일, 조항·페이지, 효력일, 확인자, 확인일 (DD-04). */
export interface PolicySourceRef {
  insurerDocumentId: string;
  revisionDate: string;
  clauseOrPage: string;
  effectiveDate: string;
  verifiedBy: string;
  verifiedAt: string;
}

/** 승인자 기록. 세부 필드는 M3 생명주기 구현이 정한다. */
export interface ApproverRecord {
  approverId: string;
  approvedAt: string;
}

/** 프로필·매핑·서류 규칙 묶음이 공통으로 갖는 머리 정보 (DD-04). */
export interface RuleItemHeader {
  /** 계산 요청마다 새로 읽은 현재 생명주기 상태 (DD-14). */
  state: LifecycleState;
  origin: Origin;
  /** 유효 기간. 날짜 형식 세부는 구현이 정한다. */
  validity: { from: string; to: string };
  policySources: PolicySourceRef[];
  approver: ApproverRecord | null;
}

export interface StandardAssumptionProfile extends RuleItemHeader {
  id: string;
  version: string;
  generation: Generation;
  insurerType: InsurerType;
  groups: CoverageGroupDef[];
  /** 모든 groupKey 를 정확히 한 번씩 담는다. 공유 한도 몫을 정하는 데이터다. */
  groupOrder: string[];
  sharedLimitPools: SharedLimitPool[];
  contentHash: string;
}

export interface TreatmentCoverageMapping extends RuleItemHeader {
  id: string;
  version: string;
  treatmentId: string;
  scope: Array<{ generation: Generation; insurerType: InsurerType }>;
  /** 보장 여부의 유일한 출처. */
  decision: 'COVERED' | 'EXCLUDED';
  /** COVERED 면 필수, EXCLUDED 면 없음. */
  groupKey?: string;
  /** EXCLUDED 면 필수, COVERED 면 없음. */
  exclusionReason?: string;
  approvedFingerprint: string;
}

export type DocumentCode =
  | 'DIAGNOSIS_CERT'
  | 'OUTPATIENT_CONFIRMATION'
  | 'TREATMENT_CONFIRMATION'
  | 'RECEIPT'
  | 'ITEMIZED_STATEMENT'
  | 'INITIAL_EXAM_RECORD'
  | 'ADMISSION_DISCHARGE_CONFIRMATION'
  | 'MEDICAL_OPINION'
  | 'IMAGING_READING'
  | 'BIOPSY_RESULT';

export interface DocumentRule {
  documentCode: DocumentCode;
  when: {
    cause?: 'INJURY' | 'ILLNESS';
    setting?: 'OUTPATIENT' | 'INPATIENT';
    insurerType?: InsurerType;
    imaging?: true;
    biopsy?: true;
    opinionRequired?: true;
  };
  /** 한 줄 사유 (환자용 문장). */
  reason: string;
  /** 작을수록 먼저. 0 이상의 안전 정수. */
  priority: number;
}

export interface DocumentRuleSet extends RuleItemHeader {
  id: string;
  version: string;
  rules: DocumentRule[];
  contentHash: string;
}

// ───────────────────────── 입력 (DD-03) ─────────────────────────

export interface PublishedLine {
  treatmentId: string;
  treatmentVersionId: string;
  displayName: string;
  benefitType: BenefitType;
  calcClass: CalcClass;
  /** 환자 예상 결제액. 0 이상 MAX_AMOUNT_WON 이하 정수 (DD-24). */
  patientAmount: Won;
  coverageFingerprint: string;
  /** 공통 기본비용 여부. */
  isBaseFee: boolean;
  documentFlags: { imaging: boolean; biopsy: boolean; opinionRequired: boolean };
  origin: Origin;
}

export interface RuleBundleSnapshot {
  /** = ruleBundleVersion */
  id: string;
  contentHash: string;
  /** 서버가 요청 시점에 새로 읽은 가용성(캐시하지 않음). 엔진은 값을 추정하거나 바꾸지 않는다. */
  status: 'ACTIVE' | 'SUSPENDED';
  profiles: StandardAssumptionProfile[];
  mappings: TreatmentCoverageMapping[];
  documentRuleSet: DocumentRuleSet | null;
}

/**
 * estimate() 의 입력. 치료 원인(상해·질병) 인자가 없다 — 원인은 deriveDocuments() 에만 들어간다 (DD-01).
 * 요청 본문의 금액·비율 필드도 없다. 줄은 서버가 그 병원의 게시 카탈로그에서 해석해 넘긴다.
 */
export interface EstimateInput {
  generation: Generation;
  insurerType: InsurerType;
  /** 선택한 치료 ID. 중복은 엔진이 한 번으로 친다. 1개 이상이어야 한다. */
  treatmentIds: string[];
  lines: PublishedLine[];
  /** 등록된 공통 기본비용. 없으면 빈 배열. */
  baseFeeLines: PublishedLine[];
  /** 병원의 규칙 사용 범위가 가리키는 게시 묶음. 범위가 없으면 null. */
  bundle: RuleBundleSnapshot | null;
  /** 판정 기준일 (주입). */
  at: string;
  acceptedOrigins: { rules: Origin[]; lines: Origin[] };
}

// ───────────────────────── 코드 ─────────────────────────

/** 보류 사유 코드 — DD-03 표의 전체 21개. 이 목록 밖의 보류 코드는 없다. */
export const HOLD_REASON_CODES = [
  'CLINIC_RULE_SCOPE_ABSENT',
  'RULE_BUNDLE_SUSPENDED',
  'PROFILE_ABSENT',
  'PROFILE_DEMO',
  'PROFILE_DRAFT',
  'PROFILE_UNAPPROVED',
  'PROFILE_UNDER_REREVIEW',
  'PROFILE_INVALID',
  'PROFILE_SOURCE_INCOMPLETE',
  'PROFILE_FORMULA_UNSUPPORTED',
  'PROFILE_VALUE_MISSING',
  'PROFILE_VALUE_INVALID',
  'CALC_RANGE_EXCEEDED',
  'LINE_ORIGIN_NOT_ACCEPTED',
  'CLASSIFICATION_NEEDS_REVIEW',
  'MAPPING_ABSENT',
  'MAPPING_UNREVIEWED',
  'MAPPING_REJECTED',
  'MAPPING_UNDER_REREVIEW',
  'MAPPING_INVALID',
  'MAPPING_GROUP_NOT_IN_PROFILE',
] as const;
export type HoldReasonCode = (typeof HOLD_REASON_CODES)[number];

/** 가정 코드. 배열 순서는 DD-03 "가정 코드" 표의 행 순서이며 출력 순서 규칙이 된다. */
export const ASSUMPTION_CODES = [
  'STANDARD_PROFILE_APPLIED',
  'ALL_COVERED_AND_LIMIT_REMAINS',
  'REMAINING_COVERED_AND_LIMIT_REMAINS',
  'REMAINING_LIMIT_ASSUMED',
  'PERSONAL_CONTRACT_NOT_CONFIRMED',
] as const;
export type AssumptionCode = (typeof ASSUMPTION_CODES)[number];

/**
 * 엔진 입력 거절 코드. 계산 결과가 아니라 거절이며 보류 코드가 아니다.
 * 배열 순서가 판정 순서다: 세대 → 치료 없음 → 수치 (DD-03, DD-24).
 */
export const ENGINE_REJECTION_CODES = [
  'UNSUPPORTED_GENERATION',
  'NO_TREATMENT_SELECTED',
  'INVALID_NUMERIC_INPUT',
] as const;
export type EngineRejectionCode = (typeof ENGINE_REJECTION_CODES)[number];

/**
 * INVALID_NUMERIC_INPUT 의 진단용 사유. 환자·API 응답에는 싣지 않는다(금액·내부 상세 없음, AC-006i).
 * LINE_AMOUNT_INVALID: 줄 금액이 Won 이 아님. HOSPITAL_PAYMENT_OVERFLOW: 줄 금액은 모두 유효하나 합 T 가 안전 정수를 넘음.
 */
export type InvalidNumericReason = 'LINE_AMOUNT_INVALID' | 'HOSPITAL_PAYMENT_OVERFLOW';

export type EngineRejection =
  | { code: 'UNSUPPORTED_GENERATION' }
  | { code: 'NO_TREATMENT_SELECTED' }
  | { code: 'INVALID_NUMERIC_INPUT'; reason: InvalidNumericReason };

// ───────────────────────── 출력 (DD-03) ─────────────────────────

export type LineState = 'ESTIMATED' | 'EXCLUDED_CONFIRMED' | 'ON_HOLD';
export type GroupState = 'ESTIMATED' | 'ON_HOLD';
export type OverallState = 'ESTIMATED' | 'ESTIMATED_WITH_EXCLUSIONS' | 'ON_HOLD';

/**
 * 줄 결과. 금액을 내보내는 필드는 patientAmount(입력 가격의 복사본)뿐이다.
 * 줄 단위 지급액은 계산·저장·반환·표시하지 않는다 (DD-02 치료 단위 계산 금지).
 */
export interface LineResult {
  treatmentId: string;
  displayName: string;
  benefitType: BenefitType;
  patientAmount: Won;
  isBaseFee: boolean;
  origin: Origin;
  state: LineState;
  /** ON_HOLD 줄에는 없다. */
  groupKey?: string;
  holdReason?: HoldReasonCode;
  exclusionReason?: string;
}

/** 수치 검사 연산의 실패 단계 이름 (DD-24). numeric.ts 의 CheckedStep 과 같은 문자열이다. */
export type FailedStepName =
  | 'RATE_PRODUCT'
  | 'ROUND_ADD'
  | 'SPLIT_PRODUCT_BENEFIT'
  | 'SPLIT_PRODUCT_NON_BENEFIT'
  | 'SPLIT_SUM';

/** 그룹 한 개의 계산 단계 기록. 세부 모양은 M1.3 이 확정한다. */
export interface FormulaStep {
  groupKey: string;
  E: Won;
  D: Won | null;
  D_applied: Won | null;
  L: Won | 'UNLIMITED' | null;
  P: Won | null;
  P_pooled: Won | null;
  /** 공유 한도 풀이 있으면 풀 키. */
  poolKey?: string;
  /** CALC_RANGE_EXCEEDED 로 보류된 그룹의 처음 실패한 검사 단계. 진단용이며 환자에게 보이지 않는다. */
  failedStep?: FailedStepName;
}

export interface GroupResult {
  groupKey: string;
  state: GroupState;
  /** 보장 대상 급여·비급여·합계 (ESTIMATED 줄만). */
  G: Won;
  N: Won;
  E: Won;
  D: Won | null;
  D_applied: Won | null;
  L: Won | 'UNLIMITED' | null;
  /** 공유 한도 적용 전 그룹 지급액 = min(max(E − D, 0), L). */
  P: Won | null;
  /** 공유 한도 풀 적용 후 그룹 지급액. 풀이 없으면 P 와 같다. */
  P_pooled: Won | null;
  /** 그룹 단위 보류일 때. */
  holdReason?: HoldReasonCode;
  sharedLimitPoolKey?: string;
  trace: FormulaStep[];
}

/**
 * 계산 근거 (AC-004g). 사용한 규칙 묶음 버전, 프로필 id·버전·출처·약관 출처 참조, 그룹별 단계.
 * 카탈로그 버전은 엔진 입력에 없으므로 서버(M4)가 응답에 따로 싣는다.
 * 프로필을 쓰지 못한 결과(묶음·프로필 단계 보류)에서는 profile 이 null 이고 steps 가 비어 있다.
 */
export interface Basis {
  ruleBundleId: string | null;
  profile: { id: string; version: string; origin: Origin; policySources: PolicySourceRef[] } | null;
  steps: FormulaStep[];
}

export interface EstimateResult {
  state: OverallState;
  amounts: {
    /** 항상 숫자 (T). */
    hospitalPayment: Won;
    baseFeeIncluded: 'INCLUDED' | 'NOT_REGISTERED';
    /** ON_HOLD 일 때만 null. */
    expectedInsurancePayout: Won | null;
    /** ON_HOLD 일 때만 null. */
    expectedOutOfPocketAfterPayout: Won | null;
  };
  lines: LineResult[];
  groups: GroupResult[];
  /** P = 그 그룹의 P_pooled 값. 전체가 ON_HOLD 일 때만 채운다. */
  referenceGroups: Array<{ groupKey: string; P: Won; isReference: true }>;
  assumptions: AssumptionCode[];
  holdReasons: Array<{ treatmentId: string; code: HoldReasonCode }>;
  /** payout 은 확인된 제외 항목의 "0원" 표시용 상수이며 계산값이 아니다. */
  excludedItems: Array<{ treatmentId: string; amount: Won; reason: string; payout: 0 }>;
  basis: Basis;
}
