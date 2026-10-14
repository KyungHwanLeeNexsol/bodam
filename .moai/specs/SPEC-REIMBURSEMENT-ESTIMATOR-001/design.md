# SPEC-REIMBURSEMENT-ESTIMATOR-001 — 기술 설계 (design.md)

> 이 문서는 spec.md의 요구사항을 만족시키는 설계 결정(DD-01~DD-23)을 정리한다. 아래의 형식 정의는 TypeScript 형태의 스케치이며 최종 코드가 아니다. 이름은 구현 단계에서 바뀔 수 있으나, 상태 코드·보류 사유 코드·오류 코드·열거값은 SPEC 전체에서 같은 문자열을 쓴다. "(잠정)"은 원문 문서가 정하지 않아 이 SPEC이 기본값을 둔 항목이며 plan.md §E에 확인 항목(§E.2~§E.5) 또는 보류 확정 자료(§E.1)로 올라 있다. "SPEC 결정"은 원문 문서가 열어 두었거나 말하지 않은 점을 이 SPEC이 정한 것이다.

## DD-01 치료 원인과 금액 계산의 분리

- `estimate()`는 치료 원인 인자를 받지 않는다. 치료 원인은 `deriveDocuments()`에만 들어간다.
- 원인 값은 `Cause = 'INJURY' | 'ILLNESS' | 'UNKNOWN'`이다. `UNKNOWN`은 명시적인 값이며 null로 대신하지 않는다.
- API 응답의 `result` 블록은 원인 세 값 모두에서 같다. 이 불변 조건은 시험으로 고정한다(AC-006).
- 원인 `UNKNOWN`은 보류 사유가 아니다(기획서 §4 화면 3). 원인을 앞으로 금액에도 쓸지는 plan.md §E #9.

## DD-02 데이터 기반 계산 엔진

### 공제·한도·원 단위 처리

`src/engine`에는 공제·한도 수치가 없다. 모든 값은 (세대, 보험사 형태)로 찾은 표준 가정 프로필에서 온다.

```ts
type Won = number;          // 원 단위 정수
type BasisPoints = number;  // 정수, 10000 = 100% (SPEC 결정: 비율은 basis points로만 저장)
type Rounding = 'TRUNCATE' | 'ROUND_HALF_UP';   // 기본값 없음

type DeductionRule =
  | { kind: 'FIXED'; fixed: Won }
  | { kind: 'RATE_WITH_FIXED_FLOOR'; fixed: Won; rate: BasisPoints; rounding: Rounding }
  | { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR'; fixed: Won; rateBenefit: BasisPoints; rateNonBenefit: BasisPoints; rounding: Rounding }
  | { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR'; fixed: Won; rate: BasisPoints; rounding: Rounding };

type LimitBasis = 'PAYOUT' | 'COVERED_COST';
type LimitRule =
  | { kind: 'PER_VISIT_PAYOUT'; amount: Won; limitBasis: LimitBasis }
  | { kind: 'UNLIMITED_DECLARED'; policyClauseRef: string }      // SPEC 결정
  | { kind: 'PER_ACCIDENT' | 'ANNUAL'; amount: Won; limitBasis: LimitBasis }
  | { kind: 'COUNT'; perUseAmount: Won; limitBasis: LimitBasis };
```

공제식(E = 그룹의 보장 대상 비용, G·N = 그룹 안의 급여·비급여 몫):

| DeductionKind | 명목 공제 D | 기획서 근거 |
|---------------|-------------|-------------|
| `FIXED` | `fixed` | §6.3 2세대 전기 고정 공제형 |
| `RATE_WITH_FIXED_FLOOR` | `max(fixed, round(rate × E))` | §6.3 2세대 정률·2세대 후기 표준형 |
| `SPLIT_RATE_WITH_FIXED_FLOOR` | `max(fixed, round(rateBenefit × G + rateNonBenefit × N))` | §6.3 2세대 후기 선택형Ⅱ |
| `CAPPED_RATE_WITH_FIXED_FLOOR` | `min(E, max(fixed, round(rate × E)))` | §6.3 4세대 급여·일반 비급여 |

- `round(x)`는 basis points 곱을 10000으로 나누며, `TRUNCATE`는 버림, `ROUND_HALF_UP`은 5000을 더한 뒤 버림이다. 엔진 코드에 허용되는 숫자 상수는 0, 10000, 5000뿐이다(REQ-ENG-001).
- 비율이 있는 규칙에서 `rounding`이 빠지면 계산하지 않고 해당 그룹을 `PROFILE_VALUE_MISSING`으로 보류한다. `SPLIT_RATE_WITH_FIXED_FLOOR`는 두 곱을 더한 뒤 한 번만 처리한다(잠정; 규칙별 원 단위 처리는 plan.md §E.1 보류 자료).
- 위 네 가지 밖의 공제 방식(1세대 상해/질병 통원 공식 등 아직 정해지지 않은 것)은 `PROFILE_FORMULA_UNSUPPORTED`로 보류한다.
- 실제 적용 공제는 `D_applied = min(D, E)`이며, 결과는 `D`(명목)와 `D_applied`를 함께 기록한다(기획서 §6.2).
- 그룹 지급액 `P = min(max(E − D, 0), L)`. L은 `PER_VISIT_PAYOUT`·`PER_ACCIDENT`·`ANNUAL`이면 `amount`, `COUNT`이면 `perUseAmount`, `UNLIMITED_DECLARED`이면 상한 없음이다.
- `UNLIMITED_DECLARED`(SPEC 결정): 약관이 해당 담보에 지급 한도를 두지 않는다고 확인된 경우를 표현하는 값이다. `policyClauseRef`가 비어 있으면 `PROFILE_SOURCE_INCOMPLETE`로 보류한다. 운영 프로필에 이 값을 쓸지는 plan.md §E #10.
- `PER_ACCIDENT`·`ANNUAL`·`COUNT`는 잔여 한도를 묻지 않으므로 한도가 그대로 남아 있다고 보고 계산하며, 결과에 `REMAINING_LIMIT_ASSUMED` 가정을 낸다.
- `limitBasis = COVERED_COST`(보장 대상 비용 한도)의 계산식은 원문에 없다(기획서 §6.2). 엔진은 이를 계산하지 않고 `PROFILE_FORMULA_UNSUPPORTED`로 보류한다(plan.md §E #6).

### 그룹과 공유 한도

```ts
interface CoverageGroupDef {
  groupKey: string;
  coverage: 'COVERED' | 'EXCLUDED'; // EXCLUDED는 확인된 제외(약관 출처 필수)
  exclusionReason?: string;
  deduction?: DeductionRule;        // COVERED일 때 필수
  limit?: LimitRule;                // COVERED일 때 필수
  sharedLimitPoolKey?: string;
}
interface SharedLimitPool { poolKey: string; limit: LimitRule }
```

- 공제는 그룹당 한 번만 계산한다. 같은 방문의 같은 그룹에 든 치료는 합산 뒤 한 번 공제한다(기획서 §9 공제 중복 방지).
- 서로 다른 그룹의 공제를 합치지 않는다.
- 확인된 제외 비용 X는 어떤 그룹의 E에도 들어가지 않는다(기획서 §6.4 사례 E).
- 사용할 수 없는 줄(보류 줄)은 어느 그룹에도 들어가지 않는다. 그 줄의 금액은 어떤 그룹의 E·D·L 계산에도 쓰이지 않고 `lines[]`와 `holdReasons[]`에만 남는다(DD-05).
- 공유 한도: 같은 `poolKey`에 묶인 그룹들의 지급 합계는 `min(sum P, pool L)`로 한 번만 제한한다. 줄어든 금액을 그룹별로 나누어 보여 줄 때는 프로필의 `groupOrder` 순서로 앞 그룹부터 채운다. 이 배분은 표시용 잠정 규칙이다(plan.md §E #7).

## DD-03 형식과 상태 코드

### 입력

```ts
type Generation = 'GEN1_AS' | 'GEN2_C1' | 'GEN2_5_C2' | 'GEN3_C3' | 'GEN4_C4';
type InsurerType = 'NON_LIFE' | 'LIFE' | 'MUTUAL_AID';   // 손해보험사 / 생명보험사 / 그외 공제 조합
type Origin = 'OPERATING' | 'DEMO' | 'TEST_FIXTURE';
type BenefitType = 'BENEFIT' | 'NON_BENEFIT';            // 급여 / 비급여
type CalcClass = 'GENERAL_BENEFIT' | 'GENERAL_NON_BENEFIT' | 'MAJOR_THREE_NON_BENEFIT' | 'NEEDS_REVIEW';

interface PublishedLine {
  treatmentId: string;
  treatmentVersionId: string;
  displayName: string;
  benefitType: BenefitType;
  calcClass: CalcClass;
  patientAmount: Won;                 // 환자 예상 결제액
  coverageFingerprint: string;        // DD-15
  isBaseFee: boolean;                 // 공통 기본비용 여부
  documentFlags: { imaging: boolean; biopsy: boolean; opinionRequired: boolean };
  origin: Origin;
}

interface EstimateInput {
  generation: Generation;
  insurerType: InsurerType;
  treatmentIds: string[];             // 중복 제거 후, 1개 이상
  lines: PublishedLine[];             // 서버가 그 병원의 게시 카탈로그에서 해석한 줄
  baseFeeLines: PublishedLine[];      // 등록된 공통 기본비용 (없으면 빈 배열)
  bundle: RuleBundleSnapshot | null;  // 병원의 규칙 사용 범위가 가리키는 게시 묶음, 범위가 없으면 null
  at: string;                         // 판정 기준일 (주입)
  acceptedOrigins: { rules: Origin[]; lines: Origin[] };  // DD-04
}
```

- 공통 기본비용(`CommonBaseFee`, SPEC 결정)은 자동 포함 줄로 계산하며 치료와 같은 매핑 판정을 거친다. 매핑이 없으면 그 줄이 보류된다. 기본비용이 하나라도 등록되어 있으면 `baseFeeIncluded = 'INCLUDED'`(그 줄이 보류되어도 금액은 병원 결제액에 들어간다), 하나도 없으면 `'NOT_REGISTERED'`이고 화면은 기본 진료비 포함 여부를 안내한다(기획서 §5). 기본비용에도 매핑이 필요하다는 결정은 plan.md §E #8.
- 엔진 입력 검증: 세대가 열거값 밖이면 `UNSUPPORTED_GENERATION`, 치료가 없으면 `NO_TREATMENT_SELECTED`로 거절한다. 이 둘은 계산 결과가 아니라 거절이다. 엔진은 지원 범위 밖 계약(노후·유병력자·단체 실손 등)을 판별하지 않는다. 그런 입력이 없고, 가려내는 방법은 미정이다(plan.md §E #11).

### 출력

```ts
type LineState = 'ESTIMATED' | 'EXCLUDED_CONFIRMED' | 'ON_HOLD';
type GroupState = 'ESTIMATED' | 'ON_HOLD';
type OverallState = 'ESTIMATED' | 'ESTIMATED_WITH_EXCLUSIONS' | 'ON_HOLD';

interface LineResult {
  treatmentId: string; displayName: string; benefitType: BenefitType;
  patientAmount: Won; isBaseFee: boolean; origin: Origin;
  state: LineState;
  groupKey?: string;                 // ON_HOLD 줄에는 없음
  holdReason?: HoldReasonCode;
  exclusionReason?: string;
  linePayout: Won | null;            // EXCLUDED_CONFIRMED이면 0, ON_HOLD이면 null
}
interface GroupResult {
  groupKey: string; state: GroupState;
  G: Won; N: Won; E: Won;            // 보장 대상 급여·비급여·합계 (ESTIMATED 줄만)
  D: Won | null; D_applied: Won | null; L: Won | 'UNLIMITED' | null; P: Won | null;
  holdReason?: HoldReasonCode;       // 그룹 단위 보류일 때
  sharedLimitPoolKey?: string;
  trace: FormulaStep[];
}
interface EstimateResult {
  state: OverallState;
  amounts: {
    hospitalPayment: Won;                         // 항상 숫자 (T)
    baseFeeIncluded: 'INCLUDED' | 'NOT_REGISTERED';
    expectedInsurancePayout: Won | null;          // ON_HOLD일 때만 null
    expectedOutOfPocketAfterPayout: Won | null;   // ON_HOLD일 때만 null
  };
  lines: LineResult[];
  groups: GroupResult[];
  referenceGroups: Array<{ groupKey: string; P: Won; isReference: true }>;
  assumptions: AssumptionCode[];
  holdReasons: Array<{ treatmentId: string; code: HoldReasonCode }>;
  excludedItems: Array<{ treatmentId: string; amount: Won; reason: string }>;
  basis: Basis;
}
```

- `hospitalPayment`는 선택한 치료와 등록된 공통 기본비용의 환자 예상 결제액 합이다. 보류 여부와 관계없이 숫자다.
- 보류가 없으면 `expectedInsurancePayout = sum(P)`(공유 한도 적용 후), `expectedOutOfPocketAfterPayout = hospitalPayment − expectedInsurancePayout`이다. 두 값은 둘 다 null이거나 둘 다 정수다.
- `referenceGroups`는 전체가 `ON_HOLD`일 때만 채운다. `ESTIMATED` 그룹 가운데 그룹 단위 보류 그룹과 공유 한도로 묶이지 않은 그룹만 들어간다. 보류 줄은 어느 그룹에도 없으므로(DD-02) 참고 그룹의 E는 사용 가능한 줄만의 합이다. 참고값은 응답에만 담고 보류 결과 화면에는 보이지 않는다(SPEC 결정; 기획서 §6.1은 "제시할 수 있으나"로 선택 사항).
- 전체 상태: 보류 줄이나 그룹 단위 보류가 하나라도 있으면 `ON_HOLD`; 아니고 `EXCLUDED_CONFIRMED` 줄이 하나라도 있으면 `ESTIMATED_WITH_EXCLUSIONS`(모든 줄이 제외인 경우 포함: 예상 보험금 0, 수령 후 부담 = 병원 결제액); 그 밖에는 `ESTIMATED`.
- `FAILED`는 엔진 출력이 아니라 전송·클라이언트 상태다(research.md §5 모순 2의 처리).

### 가정 코드 (`AssumptionCode`)

| 코드 | 내는 조건 |
|------|-----------|
| `STANDARD_PROFILE_APPLIED` | 프로필을 써서 계산했을 때 (`ON_HOLD`가 아닐 때) |
| `ALL_COVERED_AND_LIMIT_REMAINS` | 모든 줄이 `ESTIMATED`일 때만 |
| `REMAINING_COVERED_AND_LIMIT_REMAINS` | `EXCLUDED_CONFIRMED` 줄이 있고 나머지가 `ESTIMATED`일 때 ("나머지 항목은 보장 대상이고 한도가 남아 있다고 가정", 기획서 §4) |
| `REMAINING_LIMIT_ASSUMED` | `PER_ACCIDENT`·`ANNUAL`·`COUNT` 한도를 적용했을 때 |
| `PERSONAL_CONTRACT_NOT_CONFIRMED` | 결과를 반환할 때마다, `ON_HOLD` 포함 (개인 공제·한도·특약·잔여 한도·면책·부담보를 확인하지 않았다는 전제, 기획서 §4) |

### 보류 사유 코드 (`HoldReasonCode`) — 전체 목록

| 코드 | 조건 | 범위 |
|------|------|------|
| `CLINIC_RULE_SCOPE_ABSENT` | 병원에 규칙 사용 범위(`ClinicRuleScope`)가 없어 규칙 묶음이 없다(`bundle = null`) | 모든 줄 |
| `PROFILE_ABSENT` | 해당 (세대, 보험사 형태) 칸에 프로필 기록이 없다 | 모든 줄 |
| `PROFILE_DEMO` | 프로필 출처가 허용 출처 밖이다: `DEMO`(어느 구성에서나), 또는 운영 구성의 `TEST_FIXTURE`. 이름은 `DEMO`이지만 허용되지 않은 모든 비운영 출처를 덮는다 | 모든 줄 |
| `PROFILE_DRAFT` | 프로필 상태가 `DRAFT` | 모든 줄 |
| `PROFILE_UNAPPROVED` | `REVIEW_REQUESTED`, `REJECTED`, 또는 `APPROVED`이나 아직 `PUBLISHED`가 아님 | 모든 줄 |
| `PROFILE_UNDER_REREVIEW` | `UNDER_REREVIEW` | 모든 줄 |
| `PROFILE_INVALID` | `SUPERSEDED`·`EXPIRED`·`SUSPENDED`, 유효 기간 밖, 내용 해시 불일치 | 모든 줄 |
| `PROFILE_SOURCE_INCOMPLETE` | (기록 단위) 약관 출처 6항목 중 누락, 승인자 기록 누락. (그룹 단위) `UNLIMITED_DECLARED`의 조항 참조 누락 | 기록 단위: 모든 줄 / 그룹 단위: 그 그룹 |
| `PROFILE_FORMULA_UNSUPPORTED` | 닫힌 공제 방식 밖, `limitBasis = COVERED_COST` | 그 그룹 |
| `PROFILE_VALUE_MISSING` | 공제·한도 값, 또는 비율 규칙의 `rounding` 누락 | 그 그룹 |
| `LINE_ORIGIN_NOT_ACCEPTED` | 치료·공통 기본비용 줄의 출처가 구성의 줄 허용 출처 밖(운영 구성의 `DEMO`·`TEST_FIXTURE`) | 그 줄 |
| `CLASSIFICATION_NEEDS_REVIEW` | 치료 버전의 `calcClass = NEEDS_REVIEW` | 그 줄 |
| `MAPPING_ABSENT` | 해당 칸을 범위로 하는 매핑이 없다 | 그 줄 |
| `MAPPING_UNREVIEWED` | `DRAFT`·`REVIEW_REQUESTED`, 또는 `APPROVED`이나 미게시 (기획서 §5의 "상담필요"도 여기에 해당) | 그 줄 |
| `MAPPING_REJECTED` | `REJECTED` | 그 줄 |
| `MAPPING_UNDER_REREVIEW` | `UNDER_REREVIEW`, 또는 지문 불일치(DD-15) | 그 줄 |
| `MAPPING_INVALID` | `SUPERSEDED`·`EXPIRED`·`SUSPENDED`, 유효 기간 밖, 약관 출처 누락, 승인자 누락, 허용 출처 밖(운영 구성의 `TEST_FIXTURE`, 어느 구성에서나 `DEMO`), 사용 가능한 매핑이 둘 이상(모호). 출처·승인자 사유는 별도 코드 없이 이 코드에 접어 넣는다(SPEC 결정) | 그 줄 |
| `MAPPING_GROUP_NOT_IN_PROFILE` | 매핑의 `groupKey`가 프로필에 정의되지 않음 (특약·담보 값이 프로필에 없는 경우, 기획서 §9 특약 가정 없음) | 그 줄 |

- 치료 원인 `UNKNOWN`은 보류 사유가 아니다.
- **판정 순서**(한 줄에 여러 사유가 겹치면 첫 번째 하나만 기록, 결정적):
  1. `CLINIC_RULE_SCOPE_ABSENT`
  2. 프로필 기록 단위 사유: `PROFILE_ABSENT` → `PROFILE_DEMO` → 상태(`PROFILE_DRAFT` → `PROFILE_UNAPPROVED` → `PROFILE_UNDER_REREVIEW` → `PROFILE_INVALID`) → 유효 기간(`PROFILE_INVALID`) → 출처·승인자(`PROFILE_SOURCE_INCOMPLETE`) → 내용 해시(`PROFILE_INVALID`)
  3. 줄 단위 사유: `LINE_ORIGIN_NOT_ACCEPTED` → `CLASSIFICATION_NEEDS_REVIEW` → 매핑 사유(없음 `MAPPING_ABSENT` → 출처 `MAPPING_INVALID` → 상태(`MAPPING_UNREVIEWED` → `MAPPING_REJECTED` → `MAPPING_UNDER_REREVIEW` → `MAPPING_INVALID`) → 유효 기간·출처·승인자 `MAPPING_INVALID` → 모호성 `MAPPING_INVALID` → 지문 `MAPPING_UNDER_REREVIEW`) → `MAPPING_GROUP_NOT_IN_PROFILE`
  4. 그룹 단위 프로필 사유(줄 단위 사유가 없는 줄이 속한 그룹에 대해): `PROFILE_SOURCE_INCOMPLETE`(조항 누락) → `PROFILE_FORMULA_UNSUPPORTED` → `PROFILE_VALUE_MISSING`. 그룹 단위 보류 그룹의 줄에는 그 코드가 `holdReasons`에 기록된다.

### 0원의 의미

| 상황 | 값 |
|------|-----|
| 확인되지 않음 (보류) | null, "확인 필요" |
| 통신 실패 | null (전송 상태 `FAILED`) |
| 확인된 제외 | 그 줄 0원 + 제외 사유 |
| 정상 계산 결과가 0 | 0원 + 계산 근거 |
| 치료를 고르지 않음 | 요청 거절 (`NO_TREATMENT_SELECTED`), 0원으로 표시하지 않음 |

## DD-04 단일 사용 가능 판정과 출처

```ts
type UsabilityReason =
  | 'ORIGIN_NOT_ACCEPTED'
  | 'STATE_DRAFT' | 'STATE_UNAPPROVED' | 'STATE_REJECTED' | 'STATE_UNDER_REREVIEW' | 'STATE_INVALID'
  | 'OUTSIDE_VALIDITY' | 'SOURCE_INCOMPLETE' | 'APPROVER_MISSING' | 'INTEGRITY_MISMATCH';

function isUsable(item: RuleItem, at: string, acceptedOrigins: Origin[]):
  { usable: true } | { usable: false; reason: UsabilityReason };
```

- 사용 가능 조건(모두 만족): 출처 ∈ `acceptedOrigins`, `state = PUBLISHED`, `at`이 유효 기간 안, 약관 출처 완비(보험사 원문 식별, 개정일, 조항·페이지, 효력일, 확인자, 확인일), 승인자 기록, 무결성 일치(프로필·서류 규칙은 내용 해시, 매핑은 지문 DD-15). 검사 순서도 이 순서이며, 처음 걸린 사유 하나를 돌려준다.
- 상태별 사유: `DRAFT` → `STATE_DRAFT`; `REVIEW_REQUESTED`·`APPROVED`(미게시) → `STATE_UNAPPROVED`; `REJECTED` → `STATE_REJECTED`; `UNDER_REREVIEW` → `STATE_UNDER_REREVIEW`; `SUPERSEDED`·`EXPIRED`·`SUSPENDED` → `STATE_INVALID`.
- 사유 → 보류 코드:

| UsabilityReason | 프로필 | 매핑 | 서류 규칙 묶음 |
|-----------------|--------|------|----------------|
| `ORIGIN_NOT_ACCEPTED` | `PROFILE_DEMO` | `MAPPING_INVALID` | `RULES_UNAVAILABLE` |
| `STATE_DRAFT` | `PROFILE_DRAFT` | `MAPPING_UNREVIEWED` | `RULES_UNAVAILABLE` |
| `STATE_UNAPPROVED` | `PROFILE_UNAPPROVED` | `MAPPING_UNREVIEWED` | `RULES_UNAVAILABLE` |
| `STATE_REJECTED` | `PROFILE_UNAPPROVED` | `MAPPING_REJECTED` | `RULES_UNAVAILABLE` |
| `STATE_UNDER_REREVIEW` | `PROFILE_UNDER_REREVIEW` | `MAPPING_UNDER_REREVIEW` | `RULES_UNAVAILABLE` |
| `STATE_INVALID`, `OUTSIDE_VALIDITY` | `PROFILE_INVALID` | `MAPPING_INVALID` | `RULES_UNAVAILABLE` |
| `SOURCE_INCOMPLETE`, `APPROVER_MISSING` | `PROFILE_SOURCE_INCOMPLETE` | `MAPPING_INVALID` | `RULES_UNAVAILABLE` |
| `INTEGRITY_MISMATCH` | `PROFILE_INVALID` | `MAPPING_UNDER_REREVIEW` | `RULES_UNAVAILABLE` |

- 줄(치료·공통 기본비용)은 카탈로그 게시로만 들어오므로 출처만 본다. 출처가 줄 허용 출처 밖이면 `LINE_ORIGIN_NOT_ACCEPTED`다.
- 구성별 허용 출처:

| 구성 | 규칙 데이터(`acceptedOrigins.rules`) | 줄(`acceptedOrigins.lines`) |
|------|-------------------------------------|-----------------------------|
| 운영 (composition root) | `OPERATING` | `OPERATING` |
| 시험 | `OPERATING`, `TEST_FIXTURE` | `OPERATING`, `TEST_FIXTURE`, `DEMO` |

- 기획서 §5의 예시 치료 4종은 `DEMO` 출처 자료로만 둔다. 시험은 그 금액을 옮긴 `TEST_FIXTURE` 사본을 쓴다. `DEMO`·`TEST_FIXTURE` 줄은 운영 카탈로그에 게시할 수 없고(게시 검증이 거절), 시드·이관 스크립트는 이 출처의 기록을 운영 저장소에 `APPROVED`·`PUBLISHED`로 쓰지 않는다.
- CI 가져오기 경계 검사: 운영 구성 진입점에서 fixture 모듈(`**/fixtures/**`, `*.fixture.*`)로 가는 가져오기가 하나라도 있으면 실패한다.
- 출처 표시: 응답의 `origin` 요약은 계산에 쓰인 프로필·매핑·서류 규칙 묶음·줄의 출처 가운데 `OPERATING`이 아닌 것이 하나라도 있으면 그 출처(여럿이면 `TEST_FIXTURE` 우선, 다음 `DEMO`)이고, 모두 `OPERATING`이면 `OPERATING`이다. `origin`이 `OPERATING`이 아니면 키오스크는 화면 상단에 테스트 데이터 표시를 띄운다. 운영 구성에서는 `OPERATING`만 통과하므로 표시가 나타날 수 없다. 표시 문구는 plan.md §E #22.

## DD-05 보류 단위

- 병원에 규칙 사용 범위가 없거나 프로필을 쓸 수 없으면 모든 줄이 해당 코드로 `ON_HOLD`다.
- 줄·매핑·분류 사유는 그 줄만 `ON_HOLD`다. 그 줄은 어느 그룹에도 넣지 않는다.
- 그룹 공식에 문제가 있으면 그 그룹의 줄만 `ON_HOLD`이고 그룹 상태도 `ON_HOLD`다.
- 보류가 하나라도 있으면 전체가 `ON_HOLD`이며 예상 보험금과 수령 후 부담은 null이고, 예상 병원 결제액은 그대로 보인다.
- options 엔드포인트는 승인된 프로필이 없다는 이유로 세대나 보험사 형태 카드를 숨기지 않는다. 세대 카드 5장과 보험사 형태 카드 3장은 항상 나온다.

## DD-06 필요 서류 산출

```ts
type DocumentCode =
  | 'DIAGNOSIS_CERT' | 'OUTPATIENT_CONFIRMATION' | 'TREATMENT_CONFIRMATION'
  | 'RECEIPT' | 'ITEMIZED_STATEMENT' | 'INITIAL_EXAM_RECORD'
  | 'ADMISSION_DISCHARGE_CONFIRMATION' | 'MEDICAL_OPINION' | 'IMAGING_READING' | 'BIOPSY_RESULT';
// 진단서, 통원확인서, 진료확인서, 영수증, 진료비 세부내역서, 초진기록지, 입퇴원확인서, 소견서, 판독지, 조직검사결과지

// 화면에 보이는 고정 9줄. 영수증과 진료비 세부내역서만 한 줄로 묶는다.
type DocumentLineKey =
  | 'DIAGNOSIS_CERT' | 'OUTPATIENT_CONFIRMATION' | 'TREATMENT_CONFIRMATION'
  | 'RECEIPT_AND_ITEMIZED'            // = RECEIPT + ITEMIZED_STATEMENT
  | 'INITIAL_EXAM_RECORD' | 'ADMISSION_DISCHARGE_CONFIRMATION' | 'MEDICAL_OPINION'
  | 'IMAGING_READING' | 'BIOPSY_RESULT';

function deriveDocuments(input: {
  overallState: OverallState;
  cause: Cause; insurerType: InsurerType;
  treatments: Array<{ documentFlags: PublishedLine['documentFlags'] }>;
  clinicSetting: 'OUTPATIENT_ONLY';
  ruleSet: DocumentRuleSet | null;    // isUsable를 통과한 묶음, 없으면 null
}): DocumentsResult | null;

interface DocumentRule {
  documentCode: DocumentCode;
  when: { cause?: 'INJURY' | 'ILLNESS'; setting?: 'OUTPATIENT' | 'INPATIENT';
          insurerType?: InsurerType; imaging?: true; biopsy?: true; opinionRequired?: true };
  reason: string;     // 한 줄 사유 (환자용 문장)
  priority: number;   // 작을수록 먼저
}
type DocumentsResult =
  | { state: 'AVAILABLE'; mode: 'SINGLE_CAUSE' | 'UNKNOWN_CAUSE';
      lines: Array<{ line: DocumentLineKey; required: boolean; scope?: 'COMMON' | 'INJURY_ONLY' | 'ILLNESS_ONLY'; reason?: string }>;
      ruleSetId: string; ruleSetVersion: string; origin: Origin }
  | { state: 'RULES_UNAVAILABLE' };
```

- 반환: `overallState = ON_HOLD`이면 null; 그렇지 않고 `ruleSet = null`이면 `{ state: 'RULES_UNAVAILABLE' }`; 그 밖에는 `AVAILABLE`.
- 10종 코드를 고정 9줄로 보인다. `RECEIPT_AND_ITEMIZED` 줄은 조건과 무관하게 항상 `required: true`다(기획서 §4). 다른 줄은 그 줄을 이루는 코드에 맞는 규칙이 있을 때 필요다.
- 줄마다 우선순위가 가장 높은 맞는 규칙 하나가 사유를 준다. 필요 없는 줄은 체크 없이 흐리게 보인다.
- 규칙은 데이터이며 프로필과 같은 생명주기·출처·승인을 거친다(DD-17). 기획서 §4의 조건부 매핑 예시는 `TEST_FIXTURE`로만 존재하고 "검증 필요" 표시를 단다. 운영 서류 규칙은 아직 없으며 보류 자료다(plan.md §E.1).
- 결과는 나왔지만 규칙 묶음을 쓸 수 없으면 서류 화면은 서류 목록 대신 안내 문구를 보이고, 기획서 §4의 서류 화면 동작 "결과로 돌아가기"·"이용 완료"와 공통 "처음으로"는 그대로 둔다(잠정, plan.md §E #18). 결과 화면의 여섯 동작도 그대로 둔다.
- 원인 `UNKNOWN`: 같은 입력을 `INJURY`와 `ILLNESS`로 각각 평가한다. 두 평가에서 필요 여부가 같은 줄은 `COMMON`, 한쪽에서만 필요하면 `INJURY_ONLY` 또는 `ILLNESS_ONLY`다. 예시 fixture로는 공통 7줄 + 초진기록지(`INJURY_ONLY`) + 진단서(`ILLNESS_ONLY`)가 된다. 원인을 하나로 고르지 않는다.
- 디자인 수용 한계(잠정, plan.md §E #19): 원인 모름 화면은 상해 전용 1줄, 질병 전용 1줄까지만 담는다. 서류 규칙 묶음 게시 검증은 어떤 (보험사 형태, 치료 표시) 조합에서든 전용 줄이 각각 1줄을 넘으면 게시를 거절하고 경고를 남긴다(REQ-DATA-005).

## DD-07 화면 상태 기계

### 상태

| 상태 | 디자인 프레임 (이름·ID) | 비고 |
|------|-------------------------|------|
| `K00_Start` | `K00_Start` (u5CZTt) | 환자 데이터 없음, 타이머 없음. 병원명과 서비스 표시명(공통 브랜드 설정, 기본 "보담") |
| `K01_Generation` | `K01_Generation_Empty` (Z3izyJ) / `K01_Generation_Selected` (lYlRt), 가로형 `L_K01_Generation` (JNcEQ) | 1/4 |
| `K01_Generation_Unknown` | `K01_Generation_Unknown` (p1nNbK) | 안내만, 결과 상태 아님, 계산 요청 없음 |
| `K02_Type` | `K02_Type_Empty` (ghhVb) / `K02_Type_Selected` (eDRoY) | 2/4 |
| `K02b_Cause` | `K02b_Cause_Empty` (QfXL0) / `K02b_Cause_Selected` (FFtQN), 가로형 `L_K02b_Cause` (CpUd6) | 3/4 |
| `K03_Treatments` | `K03_Treatments_*` | 4/4, 페이지 나눔, "이전 목록/다음 목록"은 선택 유지 |
| `Calculating` | `KXX_Loading_Calculating` | 요청 진행 중 |
| `K04_Result` | `K04_Result` (TJoQ2), `L_K04_Result` (n3WXk) | 전체 `ESTIMATED` |
| `K04_Result_NotCovered` | `K04_Result_NotCovered` (XxmHQ) | 전체 `ESTIMATED_WITH_EXCLUSIONS` |
| `K04_Result_Hold` | (프레임 없음, 이 SPEC이 정의) | 전체 `ON_HOLD` |
| `KXX_Error_Network` | `KXX_Error_Network` (bWvFJ) | 전송 `FAILED`, 0원 표시 금지 |
| `K04_Basis_Calculation` | `K04_Basis_Calculation` (GhMYi) | 계산이 끝난 결과에서만 |
| `K07_Documents` / `K07_Documents_Unknown` | `K07_Documents` (F19r1B) / `K07_Documents_Unknown` (J6jAj), `L_K07_Documents` (CL4xk) / `L_K07_Documents_Unknown` (mZDkv) | 계산이 끝난 결과에서만 |
| `K06_Complete` | `K06_Complete` (ilzkX) | 지운 뒤에 열림, 타이머 없음 |
| 겹침창 `TimeoutDialog` | `K04_Result_Dialog_Timeout` (YcF5k) | 현재 화면 위에 띄움 |
| 겹침창 `ResetConfirm` | `K03_Treatments_Dialog_Reset` (r4N0OQ) | 현재 화면 위에 띄움 |

- 화면 방향(세로 1080×1920 / 가로 1920×1080, 임시 검토 크기)과 큰 글자 보기는 같은 상태의 표시 변형이며 별도 상태가 아니다.
- `K04_Result_Hold`의 내용(SPEC 결정): 예상 병원 결제액만 숫자로 보이고, 예상 보험금과 수령 후 부담 자리에는 "확인 필요"를 보인다. 보류 줄은 환자용 사유 분류(DD-21)로 묶어 보이고 내부 코드는 보이지 않는다. 참고 그룹 값은 보이지 않는다. 기획서 §4의 결과 문구 원칙("표준 공제·한도 가정으로 계산한 예상 금액입니다. …")은 계산하지 않았으므로 쓰지 않는다. 공통 안내 가운데 개인 계약 조건 문장 "개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다."만 쓰고, 보류 안내 문구의 최종 표현과 이 문장 선택은 plan.md §E #23, #24의 확인 대상이다. 동작은 "치료 다시 선택 / 보험 조건 수정 / 처음으로 / 이용 완료" 넷이며, 서류 확인과 계산 근거 버튼은 없다. 공통 컴포넌트로 구성하며 새 Pencil 프레임을 요청하지 않는다.
- "다음"은 1-3단계에서 선택이 있을 때만, "예상 부담액 확인"은 치료가 1개 이상일 때만 활성이다.
- "처음으로"(SPEC 해석: 기획서 §13.2의 "진행 중에는 종료 확인"에서 "진행 중" = 환자 입력이 하나 이상, plan.md §E #36): 세션에 환자 입력(세대·형태·원인·치료 가운데 하나라도)이 있으면 `ResetConfirm`을 띄우고, 하나도 없으면 바로 `K00_Start`로 간다.
- 세대는 환자가 카드로 직접 고른다. 어느 화면에도 날짜(가입일) 입력이 없고, 키오스크는 가입일로 세대를 정하거나 특정 카드를 제안·미리 선택하지 않는다. 기획서 §3의 2009.08~09 경계 계약 별도 도움말은 현재 디자인에 프레임이 없으며, 기존 프레임으로 구현된 것으로 보지 않는다(plan.md §E #35).

### 전이표

선택값 효과: 유지 = 변경 없음 / 파생 무효 = DD-08에 따라 결과·서류·근거·복귀 정보 삭제 / 전체 삭제 = 세션 초기화(새 `sessionId`).

| 출발 | 사건 | 조건 | 도착 | 선택값 효과 |
|------|------|------|------|-------------|
| `K00_Start` | "시작하기" | — | `K01_Generation` | 전체 삭제(빈 세션 생성) |
| `K01_Generation` | 세대 카드 선택 | — | `K01_Generation` | 값이 바뀌면 파생 무효 |
| `K01_Generation` | "다음" | 세대 있음 | `K02_Type` | 유지 |
| `K01_Generation` | "확인 방법 보기" | — | `K01_Generation_Unknown` | 유지 |
| `K01_Generation_Unknown` | "보험 선택으로 돌아가기" | — | `K01_Generation` | 유지 |
| `K02_Type` | 형태 카드 선택 | — | `K02_Type` | 값이 바뀌면 파생 무효 |
| `K02_Type` | "다음" | 형태 있음 | `K02b_Cause` | 유지 |
| `K02_Type` | "이전" | — | `K01_Generation` | 유지 |
| `K02b_Cause` | 원인 카드 선택 | — | `K02b_Cause` | 값이 바뀌면 파생 무효 |
| `K02b_Cause` | "다음" | 원인 있음 | `K03_Treatments` | 유지 |
| `K02b_Cause` | "이전" | — | `K02_Type` | 유지 |
| `K03_Treatments` | 치료 카드 터치 | — | `K03_Treatments` | 묶음이 바뀌면 파생 무효 (이미 고른 치료의 반복 터치로 수량이 늘지 않음) |
| `K03_Treatments` | "이전 목록 / 다음 목록" | — | `K03_Treatments` | 유지 |
| `K03_Treatments` | "이전" | — | `K02b_Cause` | 유지 |
| `K03_Treatments` | "예상 부담액 확인" | 치료 1개 이상 | `Calculating` | 요청에 (`sessionId`, `inputRevision`) 표시 |
| `Calculating` | 200, `ESTIMATED` | 표시 일치 | `K04_Result` | 결과 저장 |
| `Calculating` | 200, `ESTIMATED_WITH_EXCLUSIONS` | 표시 일치 | `K04_Result_NotCovered` | 결과 저장 |
| `Calculating` | 200, `ON_HOLD` | 표시 일치 | `K04_Result_Hold` | 결과 저장 |
| `Calculating` | 4xx·5xx·시간 초과·연결 실패 | 표시 일치 | DD-19 클라이언트 처리 표 | 표에 따름 |
| `Calculating` | 아무 응답 | 표시 불일치 | (버림) | 없음 |
| `K04_Result`, `K04_Result_NotCovered` | "보험 청구에 필요한 서류 확인" | 원인 `INJURY`/`ILLNESS` | `K07_Documents` | 복귀 정보 기록 |
| 〃 | 〃 | 원인 `UNKNOWN` | `K07_Documents_Unknown` | 복귀 정보 기록 |
| `K04_Result`, `K04_Result_NotCovered` | "계산 근거 보기" | — | `K04_Basis_Calculation` | 복귀 정보 기록 |
| 결과 3종(`Hold` 포함) | "치료 다시 선택" | — | `K03_Treatments` | 유지 |
| 결과 3종 | "보험 조건 수정" | — | `K01_Generation` | 유지 |
| 모든 환자 화면 | "처음으로" | 환자 입력이 있음 | `ResetConfirm` 겹침창 | 유지 |
| 모든 환자 화면 | "처음으로" | 환자 입력이 없음 | `K00_Start` | 전체 삭제 |
| `ResetConfirm` | 확인 | — | `K00_Start` | 전체 삭제 |
| `ResetConfirm` | 취소 | — | 직전 화면 | 유지 |
| 결과 3종, 근거, 서류 | "이용 완료" | — | `K06_Complete` | 먼저 전체 삭제 |
| `K04_Basis_Calculation`, `K07_*` | "결과로 돌아가기" | — | 복귀 정보의 결과 화면 | 유지 |
| `KXX_Error_Network` | "다시 시도" | — | `Calculating` | 같은 `inputRevision`로 새 요청 |
| `KXX_Error_Network` | "이용 종료" | — | `K06_Complete` | 먼저 전체 삭제 (잠정, plan.md §E #20) |
| `K06_Complete` | "처음 화면으로" 또는 `completionHoldSeconds` 경과 | — | `K00_Start` | 없음(이미 비어 있음) |
| 환자 데이터 화면 | 무조작 경고 시점 | — | `TimeoutDialog` 겹침창 | 유지 |
| `TimeoutDialog` | "계속 사용할게요" | — | 직전 화면 | 유지, 무조작 시간 다시 시작 |
| `TimeoutDialog` | "처음으로" 또는 초기화 시점 | — | `K00_Start` | 전체 삭제 |
| 모든 상태 | 큰 글자 전환 | — | 같은 상태 | 유지 |
| 모든 상태 | 새로고침, 뒤로·앞으로, 페이지 캐시 복원 | — | `K00_Start` | 전체 삭제 |

## DD-08 입력 변경과 파생 데이터 무효화

규칙: 확정된 입력값(세대, 보험사 형태, 치료 원인, 치료 묶음) 가운데 하나라도 다른 값으로 바뀌면 파생 데이터(`EstimateResult`, `Documents`, `BasisView`, `ReturnContext`) 전부를 즉시 지우고 `inputRevision`을 1 올린다. 같은 값을 다시 고르면 아무 일도 없다. 페이지 이동, 이전·다음 이동, 큰 글자 전환은 입력 변경이 아니다. 새 결과는 "예상 부담액 확인"을 다시 눌러야 나온다. 치료 원인만 바꾼 뒤 다시 확인하면 금액은 같고(DD-01) 서류 목록만 새로 산출된다.

| 동작 | 세대 | 형태 | 원인 | 치료 | 파생 데이터 | ReturnContext | 큰 글자 | 무조작 시간 |
|------|------|------|------|------|-------------|---------------|---------|-------------|
| 세대를 다른 값으로 | 변경 | 유지 | 유지 | 유지 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 형태를 다른 값으로 | 유지 | 변경 | 유지 | 유지 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 원인을 다른 값으로 | 유지 | 유지 | 변경 | 유지 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 치료 추가·해제 | 유지 | 유지 | 유지 | 변경 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 같은 값 다시 선택 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 다시 시작 |
| 목록 페이지 이동, 이전·다음 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 다시 시작 |
| 큰 글자 전환 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 전환 | 다시 시작 |
| 근거·서류 진입 | 유지 | 유지 | 유지 | 유지 | 유지 | 기록 | 유지 | 다시 시작 |
| 결과로 돌아가기 | 유지 | 유지 | 유지 | 유지 | 유지 | 사용 후 유지 | 유지 | 다시 시작 |
| 409 버전 불일치 처리 | 유지 | 유지 | 유지 | 게시 중인 것만 유지 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 처음으로·이용 완료·무조작 초기화·새로고침 | 삭제 | 삭제 | 삭제 | 삭제 | 삭제 | 삭제 | 꺼짐(잠정) | 정지 |

## DD-09 세션 보호와 복원 금지

- 세션은 메모리 저장소에만 둔다(기획서 §8). 초기화마다 `sessionId`를 새로 만든다(기획서 §13.2 "세션 식별자 교체").
- 계산 요청마다 (`sessionId`, `inputRevision`)을 로컬에 기록하고, 취소 수단으로 `AbortController`를 붙인다(SPEC 결정: 기획서는 "요청 취소"만 요구). 응답은 두 값이 지금 세션과 같을 때만 반영하고, 다르면 버린다. 초기화는 진행 중 요청을 취소한다.
- 환자 데이터를 localStorage·IndexedDB·서비스워커 캐시(기획서 §8)와 sessionStorage·Cache Storage(SPEC 결정으로 금지 목록에 추가)에 쓰지 않는다. 정적 검사(금지 API 사용 탐지)와 실행 중 저장소 감시 시험으로 확인한다.
- 조건을 URL 쿼리나 분석 이벤트에 넣지 않는다. 분석은 단계별 익명 집계만 둔다(기획서 §8).
- 키오스크는 단계마다 history 항목을 만들지 않는 단일 경로(`/kiosk/{clinicSlug}`)다. 뒤로·앞으로 이동과 `pageshow`의 `persisted = true`(bfcache 복원)는 `K00_Start` 초기화로 처리한다(SPEC 결정: 기획서는 "복원 금지"만 요구). 키오스크 문서와 계산 응답은 `Cache-Control: no-store`로 내려보낸다(SPEC 결정). 새로고침은 빈 세션으로 시작한다.
- 관리자 인증 상태를 키오스크에 남기지 않고, 환자 화면에 `/admin` 링크와 숨은 터치 진입을 두지 않는다(기획서 §8, §13.3).

## DD-10 무조작 정책

| 화면 종류 | 경고 | 초기화 | 근거 |
|-----------|------|--------|------|
| 입력 단계(`K01`~`K03`) | 100초 | 120초 | 기획서 §13.2 (기본 제안값) |
| 정상·보장 제외 결과 | 160초 | 180초 | 기획서 §13.2 (기본 제안값) |
| 계산 근거, 필요 서류(세로·가로·원인 모름) | 160초 | 180초 | 기획서 §13.2 (2026-10-14 임시 결정, 실제 머무는 시간 미관찰; plan.md §E #15) |
| 보류 결과 | 160초 | 180초 | 잠정 (결과 화면으로 봄, plan.md §E #14) |
| 세대 확인 안내, 계산 중, 통신 오류 | 100초 | 120초 | 잠정 (기획서 §13.2가 구현 설계에 맡김, plan.md §E #13) |
| `K00_Start`, `K06_Complete` | 없음 | 없음 | 지울 환자 데이터 없음 |

- 환자의 터치·키 입력마다(결과·근거·서류 사이 이동 포함) 무조작 시간을 0초부터 다시 센다. 서버 응답과 내부 갱신은 시간을 연장하지 않는다.
- 경고는 같은 `TimeoutDialog`를 현재 화면 위에 띄우며 남은 시간, "계속 사용할게요", "처음으로"를 보인다. "계속 사용할게요"는 반복할 수 있고 누를 때마다 시간을 다시 센다. 배경은 실제 화면 그대로이므로 결과 화면이면 여섯 동작이 모두 남아 있다(디자인 차이 13-2 해결).
- 초기화 도착지는 `K00_Start`다. 결과 화면으로 돌아가지 않고 `K06_Complete`를 거치지 않는다.
- 병원 관리자가 병원별로 바꿀 수 있다(기획서 §7). 저장 검증(잠정, SPEC 결정): 경고 < 초기화, 초기화 − 경고 ≥ 20초. 20초는 기획서 §13.2와 tech.md §5의 기본값 "초기화 20초 전에 경고"에서 왔고, 이를 저장 하한으로 삼은 것은 이 SPEC의 결정이다(plan.md §E #16). 이 하한은 무조작 정책에만 적용하며 `completionHoldSeconds`에는 적용하지 않는다.
- 기획서 §7의 "결과 화면 유지 시간"은 결과 화면류의 경고·초기화 시간으로 해석한다(research.md §5 모순 7, plan.md §E #26).

## DD-11 복귀 정보 (ReturnContext)

```ts
interface ReturnContext { resultVariant: 'NORMAL' | 'NOT_COVERED'; orientation: 'PORTRAIT' | 'LANDSCAPE'; largeText: boolean }
```

- 계산 근거·서류 화면에 들어갈 때 기록하고, "결과로 돌아가기"는 이 값 그대로 복원한다. 결과·선택은 바뀌지 않는다.
- 계산 근거 화면은 (`EstimateResult`, `resultVariant`)의 순수 함수로 그린다. `NOT_COVERED`에서 들어오면 제외 항목과 사유를 보인다. 결과 종류별 전용 근거 프레임을 요청하지 않는다(디자인 차이 13-1을 공통 규칙으로 해결).
- 키오스크는 외부 웹 링크를 열지 않는다. 약관 출처는 근거 상세에 문자로만 보인다.

## DD-12 큰 글자 보기

- 같은 화면, 같은 흐름, 같은 계산이다. 바뀌는 것은 글자 크기, 버튼·터치 영역 크기, 카드·금액 배치뿐이다.
- 공간이 모자라면 기능을 빼지 않고 카드 열 수를 줄이거나 세로로 쌓으며, 목록은 "이전 목록 / 다음 목록"으로 나누고 선택을 유지한다(치료 선택은 한 화면 4개에서 2개로 줄이는 것이 디자인 명세의 예, 기획서 §13.1).
- 전환해도 현재 화면과 입력 상태를 유지한다. 결과 화면의 여섯 동작, 서류 9줄과 체크·사유, 원인 모름 분기, 복귀 규칙을 유지한다.
- 초기화하면 꺼진다(잠정, plan.md §E #17).
- 검증은 구현된 화면에서 세로 1080×1920·가로 1920×1080(임시 검토 크기) 모두, 실제 Pretendard(대체 순서 Noto Sans KR → 맑은 고딕 → 시스템 산세리프)로 한다. Pencil 화면의 잘림 결과는 근거가 되지 않는다.
- 디자인 조작 규격(기획서 §13.1, 디자인 기준이며 접근성 인증 아님): 주요 버튼 88, 구현 터치 영역 72 CSS px 이상, 카드 120 이상, 본문 24 이상, 제목 36 이상, 결과 숫자 56 이상, 간격 16 이상. 이 가운데 72 CSS px를 통과·실패 기준으로 쓰는 것은 SPEC 결정이다(plan.md §E #29).
- 글자 대비 기준(design-requirements §2.1, 디자인 기준이며 접근성 인증 아님): 일반 글자 4.5:1 이상, 큰 글자(24 px 이상, 또는 굵게 18.66 px 이상) 3:1 이상, 핵심 안내는 가능하면 4.5:1 이상. 예외는 로고, 정보가 없는 장식, 실제로 비활성인 조작 요소의 글자뿐이다.

## DD-13 이용 완료·처음으로·무조작 초기화

| 동작 | 순서 | `K06_Complete` 경유 |
|------|------|---------------------|
| "이용 완료"(결과·근거·서류) | 전체 삭제 → `K06_Complete` → `completionHoldSeconds` 뒤 자동 또는 "처음 화면으로" → `K00_Start` | 예 |
| "처음으로" | 환자 입력이 있으면 `ResetConfirm` → 확인, 없으면 바로 → 전체 삭제 → `K00_Start` | 아니요 |
| 무조작 초기화 | 경고 → 연장 없음 → 전체 삭제 → `K00_Start` | 아니요 |
| 통신 오류의 "이용 종료" | 전체 삭제 → `K06_Complete` (잠정) | 예 |

`completionHoldSeconds`는 병원별 설정값(양의 정수)이다. 원문 문서가 길이를 정하지 않았으므로("잠시 후", 기획서 §13.2) 기본값은 소유자 확인 항목이다(plan.md §E #12, 구현 착수 승인 전에 정함).

## DD-14 버전

- `CatalogVersion`(병원 단위): 게시된 치료 버전 묶음 + 공통 기본비용. 게시할 때마다 새 버전이며, 가격만 바뀐 게시도 변경 이력과 함께 새 버전이다.
- `RuleBundleVersion`(플랫폼 단위): 게시된 프로필·매핑·서류 규칙 묶음의 바꿀 수 없는 스냅샷. 어느 병원이 어느 묶음을 쓰는지는 플랫폼 운영자가 정하는 `ClinicRuleScope`다. 범위가 없는 병원은 묶음이 없고 모든 계산이 `CLINIC_RULE_SCOPE_ABSENT`로 보류된다.
- 병원의 현재 버전은 그 병원의 최신 `CatalogVersion`과 그 병원 `ClinicRuleScope`가 가리키는 `RuleBundleVersion`이다. catalog와 options 응답은 각각 이 두 값을 담는다(DD-19).
- 계산 요청은 클라이언트가 본 `catalogVersion`과 `ruleBundleVersion`을 담는다. 경로의 병원 기준 현재 버전과 다르면 HTTP 409 `VERSION_MISMATCH`, 결과 없음. 본문 형식:

```json
{
  "error": "VERSION_MISMATCH",
  "latest": { "catalogVersion": "<string>", "ruleBundleVersion": "<string|null>" },
  "changes": {
    "priceChanged": true,
    "ruleChanged": false,
    "treatmentsUnpublished": ["<treatmentId>"]
  }
}
```

- 클라이언트는 그 병원의 catalog·options를 다시 받고, 아직 게시된 선택은 유지하고, 내려간 치료는 안내와 함께 빼고, 새 합계를 보인 뒤 환자가 다시 확인하게 한다. 옛 값으로 결과를 확정하지 않는다(기획서 §7).
- 결과는 실제로 쓴 버전과 프로필 id·버전을 되돌려 준다.

## DD-15 지문 방어

- 매핑은 승인 때 `approvedFingerprint = hash(treatmentCode, procedureCode(s), benefitType, calcClass)`를 저장한다.
- 계산할 때 현재 게시된 치료 버전의 지문과 다르면, 관리 화면에서 상태 전환이 빠졌더라도 그 매핑을 `MAPPING_UNDER_REREVIEW`로 판정해 보류한다.
- 가격은 지문에 들어가지 않는다.

## DD-16 재검토 기준

- 보장 판단 필드(닫힌 목록): `treatmentCode`, `procedureCode(s)`, `benefitType`, `calcClass`. 이 가운데 하나라도 바뀐 치료 버전이 게시되면 그 치료의 `APPROVED`·`PUBLISHED` 매핑이 `UNDER_REREVIEW`가 되고, 다시 승인될 때까지 그 치료는 보류된다(기획서 §7).
- 가격만 바뀌면 매핑을 유지하고 새 `CatalogVersion`을 변경 이력과 함께 게시한다.
- 치료 버전에 새 필드를 추가할 때는 설계 단계에서 보장 판단 필드인지 아닌지를 정한다.
- 새 치료는 매핑 없이도 가격을 게시할 수 있으며, 그 줄만 `MAPPING_ABSENT`로 보류된다.

## DD-17 역할·권한·생명주기

### 역할

병원 관리자(HA), 보험 기준 검토 담당자(RV), 플랫폼 운영자(PO). 한 사람이 여러 역할을 맡아도 권한은 따로 판정한다(기획서 §7). 아래 업무 분담 가운데 기획서 §7 규칙 관리 업무 1·2·3·5의 배정은 이 SPEC의 제안이다(원문은 나누지 않았다, plan.md §E #30).

### 매핑 작성 주체 (SPEC 결정, plan.md §E #34)

- 매핑은 RV가 작성·수정한다.
- HA의 "검토 요청"은 병원이 제안한 보장 분류 정보(급여 구분·행위 코드·치료 분류)를 담은 검토 요청 기록(`CoverageReviewRequest`, 상태 `REVIEW_REQUESTED`)을 만든다.
- RV는 그 요청으로 매핑 초안(`DRAFT`)을 만들고, 검토를 마치면 승인(`APPROVED`)하거나 사유와 함께 반려(`REJECTED`)한다. 요청 기록은 결과와 반려 사유를 담아 닫히며, HA는 이를 읽기 전용으로 본다.
- RV가 작성하고 승인까지 하면 작성자와 승인자가 같으므로 `selfApproval: true`가 기록된다.

### 권한 표

플랫폼 운영자(PO)의 권한은 기획서 §7 규칙 관리 업무 6번 "병원별 관리자 권한과 규칙 사용 범위 관리(플랫폼 운영자)"의 두 가지와, 그 두 가지에 필요한 조회뿐이다. 병원 설정·무조작 정책·치료·가격은 병원 관리자(HA)만 다룬다. 칸의 범위: HA는 자기 병원 자원만, RV는 규칙 데이터 검토에 필요한 범위에서 모든 병원의 치료 정보와 검토 요청을, PO는 모든 병원의 소속·규칙 사용 범위를 다룬다. 표의 O 칸은 위 범위 안에서 허용된다. "자기 병원", "규칙 데이터 관련", "소속·규칙 사용 범위 관련"처럼 범위가 적힌 칸은 그 범위 안의 요청만 허용되고 범위 밖의 요청은 403이다. "—" 칸은 모두 금지(403)다.

| 자원 | 동작 | HA (자기 병원) | RV | PO |
|------|------|:--:|:--:|:--:|
| 병원 설정(병원명·로고·종별·안내문·상담번호·기기 설정) | 조회·수정 | O | — | — |
| 무조작 정책·`completionHoldSeconds` | 조회·수정 | O | — | — |
| 치료·가격·공통 기본비용 | 추가·수정·비활성·순서 변경 | O | — | — |
| 카탈로그 | 초안 저장·미리보기·게시·이력 조회 | O | — | — |
| 치료 정보(게시 치료 버전과 보장 분류 정보) | 조회 | O | O | — |
| 보장 분류 정보(급여 구분·행위코드·치료 분류) | 등록·변경 요청 | O | — | — |
| 검토 요청 기록(`CoverageReviewRequest`) | 생성 | O | — | — |
| 검토 요청 기록 | 상태·결과·반려 사유 조회 | O (읽기 전용) | O | — |
| 매핑 | 작성(`DRAFT`)·수정 | — | O | — |
| 매핑 | 승인·반려(사유 필수) | — | O | — |
| 공제·한도·표준 가정 프로필 | 작성·수정·승인·반려 | — | O | — |
| 보험사·상품·담보·공제형·약관 버전, 약관 출처 | 관리 | — | O | — |
| 서류 규칙 | 작성·승인·반려 | — | O | — |
| 규칙 묶음 | 게시·중지 | — | O | — |
| 규칙 묶음 | 조회 | — | O | O |
| 계산 예제-약관 대조 승인 기록 | 작성 | — | O | — |
| 병원 목록(이름·slug) | 조회 | 자기 병원 | O | O |
| 병원별 규칙 사용 범위(`ClinicRuleScope`) | 지정 | — | — | O |
| 병원별 규칙 사용 범위 | 조회 | 자기 병원 | O | O |
| 관리자 소속·역할(`ClinicMembership`) | 관리·조회 | — | — | O |
| 감사 기록 | 조회 | 자기 병원 | 규칙 데이터 관련 | 소속·규칙 사용 범위 관련 |

- HA에게는 "검토 완료" 버튼이나 선택값을 보이지 않으며, 검토 상태는 읽기 전용이다(기획서 §7).
- 관리자 인증은 키오스크에 남지 않는다. 환자 화면의 숨은 터치로 관리자 기능이 열리지 않는다. 키오스크 기기 설정은 별도 인증을 거친다(기획서 §13.3). 기기와 병원의 연결 방식은 plan.md §E #4.

### 생명주기 (프로필·매핑·서류 규칙 공통)

| 상태 | 들어오는 전이 | 나가는 전이 | 계산 사용 |
|------|---------------|-------------|-----------|
| `DRAFT` | RV 작성 (매핑은 검토 요청 기록에서) | `REVIEW_REQUESTED` | 아니요 |
| `REVIEW_REQUESTED` | 작성자의 검토 제출 | `APPROVED`, `REJECTED` | 아니요 |
| `REJECTED` | RV 반려(사유 필수) | (새 버전 `DRAFT`로만) | 아니요 |
| `APPROVED` | RV 승인 | `PUBLISHED`, `UNDER_REREVIEW` | 아니요 |
| `PUBLISHED` | 규칙 묶음 게시 | `SUSPENDED`, `SUPERSEDED`, `UNDER_REREVIEW`, `EXPIRED` | 예 (DD-04 조건 충족 시) |
| `UNDER_REREVIEW` | (`APPROVED` 또는 `PUBLISHED`에서) 보장 판단 필드 변경, 지문 불일치 | `APPROVED`(재승인), `REJECTED` | 아니요 |
| `SUSPENDED` | RV 중지 | (새 버전으로만) | 아니요 |
| `SUPERSEDED` | 새 버전 게시 | — | 아니요 |
| `EXPIRED` | 유효 기간 종료 | — | 아니요 |

- 규칙은 덮어쓰거나 지우지 않고 새 버전을 낸다. 수정자·일시·사유를 남긴다. 게시 전 미리보기를 제공한다. 복구는 이전 버전의 사본을 새 버전으로 게시하는 방식으로 한다(기획서 §7).
- 작성자와 승인자를 모두 기록한다. 같은 사람의 승인은 처음에는 허용하되 감사 기록에 `selfApproval: true`를 남긴다(SPEC 결정; 금지할지는 plan.md §E #31).
- 플랫폼 운영자의 병원별 긴급 중지는 원문에 근거가 없어 이 SPEC에 두지 않는다(plan.md §F 선택 후속 항목).

## DD-18 데이터 모델

### 엔티티

| 엔티티 | 주요 필드 | 키·관계 |
|--------|-----------|---------|
| `Clinic` | id, slug, 병원명(서비스명과 별도), 기관 종별(`CLINIC` → 외래 전용), 연락처, 현재 `CatalogVersion` | slug 고유 |
| `KioskDevice` | id, clinicId, 방향 설정, 활성 여부 | Clinic 1:N. 기기와 병원의 연결 방식은 미정(plan.md §E #4) |
| `ClinicMembership` | userId, clinicId(PO는 null 가능), role | 사용자 N:N 병원 |
| `Treatment` | id, clinicId, 정렬 순서, 활성 여부 | 치료의 상위 식별자 (structure.md §11의 빈 자리를 채움) |
| `TreatmentVersion` | id, treatmentId, 표시명·설명, `benefitType`, 환자 예상 결제액, 금액 적용 조건(환자 유형·가정·기준일), `treatmentCode`, `procedureCode(s)`, `calcClass`, 서류 관련 표시, `origin`(`OPERATING`·`DEMO`·`TEST_FIXTURE`), 게시 상태, 적용일 | Treatment 1:N. 같은 이름의 급여·비급여 판은 별도 Treatment |
| `CommonBaseFee` | id, clinicId, 표시명, `benefitType`, 금액, 코드, `origin` | 자동 포함 줄(DD-03) |
| `Insurer` | id, 기관 유형, 현재 이름, 과거 이름 별칭, 검증된 연락처 | NH농협손해보험·NH농협생명·과거 농협공제는 각각 별도 행 |
| `ProductProfile` | id, insurerId, 세대, 상품·담보, 판매 기간, 공제형, 가입 한도 옵션 | Insurer 1:N |
| `PolicySource` | id, 보험사 원문 식별(URL 또는 파일), 개정일, 조항·페이지, 효력일, 확인자, 확인일 | 운영 규칙에 필수 |
| `StandardAssumptionProfile` | id, version, generation, insurerType, `groups[]`, `groupOrder[]`, `sharedLimitPools[]`, 생명주기 상태, origin, 유효 기간, policySourceIds[], 작성자, 승인자, 내용 해시 | (generation, insurerType) 칸마다 버전 계열 하나 |
| `CoverageRuleVersion` | 상품·담보 단위의 공제/한도/기간/횟수/제외/집계 단위, 유효 기간, 상태 | ProductProfile 1:N. 개별 상품 규칙을 담는 자리이며, 이번 계산은 표준 가정 프로필만 쓴다 |
| `CoverageReviewRequest` | id, clinicId, treatmentId, 제안한 보장 분류 정보, 요청자, 요청일, 상태(`REVIEW_REQUESTED` → 결과 `APPROVED`·`REJECTED`), 반려 사유, 결과 매핑 버전 | HA가 생성, RV가 처리 |
| `TreatmentCoverageMapping` | id, version, clinicId, treatmentId, scope[(generation, insurerType)], decision(`COVERED`·`EXCLUDED`), groupKey, exclusionReason, `approvedFingerprint`, 상태, origin, policySourceIds[], 작성자(RV)·승인자, 유효 기간 | Treatment N:N 프로필 칸 |
| `DocumentRuleSet` / `DocumentRule` | 묶음 id·버전·상태·origin·출처·승인자·내용 해시 / documentCode, when, reason, priority | 묶음 1:N 규칙 |
| `RuleBundleVersion` | id, 포함한 프로필·매핑·서류 규칙 버전 목록, 내용 해시, 게시자, 게시일 | 바꿀 수 없음 |
| `CatalogVersion` | id, clinicId, 포함한 TreatmentVersion·CommonBaseFee 목록, 게시자, 게시일, 변경 요약 | 바꿀 수 없음 |
| `ClinicRuleScope` | clinicId, ruleBundleVersionId, 지정자(PO), 지정일 | 병원 1:1(현재 값) + 이력 |
| `IdlePolicy` | clinicId, 화면 종류별 경고·초기화 초, `completionHoldSeconds` | 병원 1:1 (structure.md §11의 빈 자리를 채움) |
| `BrandSetting` | 서비스 표시명(기본 "보담") | 플랫폼 1행 |
| `AuditLog` | id, actorId, role, 동작, 대상, 이전·이후 버전, 사유, 일시, `selfApproval` | 모든 관리 동작 |

SPEC 결정: 표준 가정 프로필은 `CoverageRuleVersion`의 한 종류가 아니라 별도 엔티티로 둔다. 이유는 키가 다르고((세대, 보험사 형태) 대 상품·담보), 계산이 직접 참조하는 단위이며, 승인 표(소유자가 첨부할 표준값 표)도 이 단위로 들어오기 때문이다. 생명주기 상태와 `PolicySource` 참조는 `CoverageRuleVersion`과 같게 둔다(기획서 §8의 열린 질문 해결).

### 관계도

```
BrandSetting (1)

Clinic 1 ── N KioskDevice
Clinic 1 ── N Treatment 1 ── N TreatmentVersion
Clinic 1 ── N CommonBaseFee
Clinic 1 ── N CatalogVersion ──> {TreatmentVersion, CommonBaseFee}
Clinic 1 ── 1 IdlePolicy
Clinic 1 ── 0..1 ClinicRuleScope ──> RuleBundleVersion
Clinic 1 ── N CoverageReviewRequest ──> Treatment, ──> (결과) TreatmentCoverageMapping
User  N ── N Clinic   (ClinicMembership, role)

Insurer 1 ── N ProductProfile 1 ── N CoverageRuleVersion ──> PolicySource
StandardAssumptionProfile (generation, insurerType) ──> PolicySource
TreatmentCoverageMapping ──> Treatment, ──> StandardAssumptionProfile.groupKey, ──> PolicySource
DocumentRuleSet 1 ── N DocumentRule ──> PolicySource
RuleBundleVersion ──> {StandardAssumptionProfile, TreatmentCoverageMapping, DocumentRuleSet} 버전들

AuditLog <── 위 모든 관리 변경
```

## DD-19 API

SPEC 결정(plan.md §E #33): 기획서 §8의 예상 API는 `GET /api/insurance/options`, `POST /api/estimate`로 병원 식별이 없다. 규칙 묶음이 병원마다 다르므로(DD-14), 두 경로에 병원 slug를 넣는다. slug는 공개 위치 정보일 뿐이며 권한이 아니다. 서버는 slug로 병원을 정한 뒤에도 모든 치료 ID가 그 병원의 게시 카탈로그에 속하는지 확인한다.

| 기획서 경로 | 이 SPEC의 경로 |
|-------------|----------------|
| `GET /api/clinics/{slug}/catalog` | 같음 |
| `GET /api/insurance/options` | `GET /api/clinics/{slug}/insurance/options` |
| `POST /api/estimate` | `POST /api/clinics/{slug}/estimate` |

### `GET /api/clinics/{slug}/catalog`

```json
{
  "clinic": { "slug": "<string>", "displayName": "<string>", "setting": "OUTPATIENT_ONLY" },
  "serviceDisplayName": "보담",
  "catalogVersion": "<string>",
  "treatments": [
    { "treatmentId": "<string>", "displayName": "X-ray", "description": "<string>",
      "benefitType": "BENEFIT", "patientAmount": 10000, "priceCondition": "<string>", "order": 1 }
  ],
  "baseFees": [],
  "baseFeeIncluded": "NOT_REGISTERED"
}
```

표시 필드만 담는다. 검토 상태, 지문, 검토자 같은 보장 검토 내부 정보는 없다. 위 숫자는 기획서 §5 예시 값(X-ray 10,000원)을 쓴 형식 예시다.

### `GET /api/clinics/{slug}/insurance/options`

```json
{
  "ruleBundleVersion": "<string|null>",
  "generations": [ { "code": "GEN1_AS", "label": "1세대(A·S)", "period": "2009.08.01 이전" } ],
  "insurerTypes": [ { "code": "NON_LIFE", "label": "손해보험사", "help": "손해보험사에서 가입한 실손보험" } ],
  "causes": [ { "code": "INJURY", "label": "다쳐서 왔어요 (상해)", "help": "<string>" } ],
  "guidance": { "generationUnknown": "보험증권이나 보험사 앱에서 가입일을 확인해 주세요. 확인이 어려우면 1544-8069로 문의해 주세요." }
}
```

- 세대 5장, 형태 3장, 원인 3장을 항상 담는다(DD-05). 세대 기간은 기획서 §3의 표를 그대로 쓴다.
- `ruleBundleVersion`은 그 병원 `ClinicRuleScope`의 묶음이며, 범위가 없으면 null이다.
- 1544-8069는 문자열로만 담는다. "1588"은 담지 않는다.

### `POST /api/clinics/{slug}/estimate`

요청:

```json
{ "catalogVersion": "<string>", "ruleBundleVersion": "<string|null>",
  "generation": "GEN2_C1", "insurerType": "NON_LIFE", "cause": "UNKNOWN",
  "treatmentIds": ["<treatmentId>"] }
```

- 서버는 경로의 slug로 병원을 정한다. 요청 본문의 가격·비율·병원 ID 같은 다른 필드는 무시하며 읽지 않는다.
- 모든 치료 ID가 그 병원의 현재 게시 카탈로그에 있는지 확인한다. 하나라도 없으면 422 `TREATMENT_NOT_PUBLISHED`(다른 병원의 치료 ID 포함).
- 서버는 키오스크 미리보기와 같은 엔진 모듈로 다시 계산한다.

성공 응답(보류 포함, HTTP 200). 아래는 `TEST_FIXTURE` 예시 4종(합계 124,000원)으로 보류된 경우의 형식 예시다:

```json
{
  "versions": { "catalogVersion": "<string>", "ruleBundleVersion": "<string>",
                "profile": { "id": "<string>", "version": "<string>", "origin": "TEST_FIXTURE" } },
  "origin": "TEST_FIXTURE",
  "result": { "state": "ON_HOLD",
              "amounts": { "hospitalPayment": 124000, "baseFeeIncluded": "NOT_REGISTERED",
                           "expectedInsurancePayout": null, "expectedOutOfPocketAfterPayout": null },
              "lines": [
                { "treatmentId": "<신장분사치료 id>", "displayName": "신장분사치료", "benefitType": "NON_BENEFIT",
                  "patientAmount": 40000, "isBaseFee": false, "origin": "TEST_FIXTURE",
                  "state": "ON_HOLD", "holdReason": "MAPPING_ABSENT", "linePayout": null },
                "<나머지 LineResult 3개: X-ray, 초음파, 물리치료>"
              ],
              "groups": ["<GroupResult…>"], "referenceGroups": ["<…>"],
              "assumptions": ["PERSONAL_CONTRACT_NOT_CONFIRMED"],
              "holdReasons": [ { "treatmentId": "<신장분사치료 id>", "code": "MAPPING_ABSENT" } ],
              "excludedItems": [], "basis": {} },
  "documents": null
}
```

프로필 칸에 기록이 없거나 규칙 사용 범위가 없으면 `versions.profile`은 null이다. 보류 줄에는 `groupKey`가 없다(DD-02). `"<…>"` 문자열은 예시를 줄이기 위한 자리 표시다.

### 오류 표 (SPEC 결정: 상태 번호와 코드)

| HTTP | 코드 | 조건 | 경로 |
|------|------|------|------|
| 400 | `INVALID_REQUEST` | 형식 오류, 필수 필드 누락, 원인 값 열거 밖, 관리자 반려에 사유 없음 | 공개·관리자 |
| 401 | `UNAUTHENTICATED` | 인증되지 않은 관리자 요청 | 관리자 |
| 403 | `FORBIDDEN` | 역할 권한 밖, 다른 병원 자원 | 관리자 |
| 404 | `CLINIC_NOT_FOUND` | slug에 해당하는 병원 없음 | 공개 |
| 409 | `VERSION_MISMATCH` | 버전 불일치 (DD-14) | 공개 |
| 422 | `UNSUPPORTED_GENERATION` | 세대 열거 밖(5세대 등). C4로 계산하지 않음 | 공개 |
| 422 | `NO_TREATMENT_SELECTED` | 치료 없음 | 공개 |
| 422 | `TREATMENT_NOT_PUBLISHED` | 그 병원 게시 카탈로그에 없는 치료 ID | 공개 |
| 5xx | — | 서버 실패 | 공개·관리자 |

계산 보류는 HTTP 200이다.

### 키오스크의 응답 처리 (SPEC 결정)

| 응답 | 키오스크 처리 |
|------|---------------|
| 200 | 결과 상태에 따라 결과 3종 (DD-07) |
| 409 `VERSION_MISMATCH` | 버전 불일치 흐름(DD-14): 갱신 뒤 `K03_Treatments`에서 다시 확인 |
| 422 `NO_TREATMENT_SELECTED` | `K03_Treatments`로 돌아가 "예상 부담액 확인" 비활성 상태를 보인다 (정상 흐름에서는 버튼이 비활성이라 생기지 않음) |
| 422 `TREATMENT_NOT_PUBLISHED` | 버전 불일치 흐름과 같게 catalog·options를 다시 받고 내려간 치료를 안내와 함께 뺀 뒤 `K03_Treatments` |
| 그 밖의 4xx (400, 404, 422 `UNSUPPORTED_GENERATION`) | 클라이언트·계약 결함으로 보고 `FAILED` → `KXX_Error_Network` |
| 5xx, 시간 초과, 연결 실패 | `FAILED` → `KXX_Error_Network` |

계산 요청의 시간 제한 값은 plan.md §E #21이다.

### 관리자 API (제안)

| 경로 (제안) | 동작 | 역할 |
|-------------|------|------|
| `GET/PUT /api/admin/clinics/{clinicId}/settings` | 병원 설정 | HA |
| `GET/PUT /api/admin/clinics/{clinicId}/idle-policy` | 무조작 정책·이용 완료 대기 | HA |
| `GET/POST /api/admin/clinics/{clinicId}/treatments`, `PATCH …/treatments/{treatmentId}` | 치료 목록·추가·수정(새 초안 버전 생성) | HA |
| `GET/POST /api/admin/clinics/{clinicId}/base-fees` | 공통 기본비용 | HA |
| `POST /api/admin/clinics/{clinicId}/catalog/preview` | 세로·가로 미리보기 계산(같은 엔진) | HA |
| `POST /api/admin/clinics/{clinicId}/catalog/publish`, `GET …/catalog/versions` | 카탈로그 게시·이력 | HA |
| `POST /api/admin/clinics/{clinicId}/treatments/{treatmentId}/review-requests` | 검토 요청 기록 생성 | HA |
| `GET /api/admin/review-queue` | 검토 대기열 | RV |
| `POST /api/admin/review-requests/{requestId}/mappings` | 요청으로 매핑 초안 작성 | RV |
| `POST /api/admin/mappings/{mappingId}/versions/{version}/approve` · `/reject` | 승인·반려(반려 사유 필수) | RV |
| `/api/admin/profiles`, `/api/admin/document-rule-sets`, `/api/admin/policy-sources`, `/api/admin/insurers` | 규칙 데이터 관리 | RV |
| `POST /api/admin/rule-bundles`, `POST /api/admin/rule-bundles/{id}/suspend` | 묶음 게시·중지 | RV |
| `PUT /api/admin/clinics/{clinicId}/rule-scope` | 규칙 사용 범위 지정 | PO |
| `GET/POST /api/admin/memberships` | 소속·역할 | PO |
| `GET /api/admin/audit-log` | 감사 기록 | 권한 표 기준 |

모든 관리자 요청은 인증과 병원 권한 확인을 거친다(REQ-ADM-001).

## DD-20 기술 스택

- 후보: Next.js App Router + TypeScript 단일 앱(기획서 §8; tech.md §1). 엔진은 `src/engine`의 순수 TS 모듈이며, 가져오기 경계 검사로 React·Next·DB 드라이버·`fetch`·`fs`·네트워크 모듈·생성형 AI SDK와 주입 없는 `Date.now`·`Math.random`을 막는다.
- DB, 호스팅, 관리자 인증 공급자는 정해지지 않았다(plan.md §E #1-#3). 지속 저장이 필요한 마일스톤은 저장소 인터페이스와 메모리 구현으로 진행하고, DB 구현은 스택 결정을 기다린다.
- 시험 러너: Vitest(소유자 결정 2026-10-14, plan.md §A.5). 화면 E2E는 e2e-tester가 맡는다.
- 방법론: TDD(`quality.yaml`), 커버리지 85%, 커밋당 80%.

## DD-21 보류 사유의 환자용 분류

| 환자용 분류 (초안, 최종 문구는 plan.md §E #23의 확인 대상) | 내부 코드 |
|-------------------------------------------------------|-----------|
| 표준 가정 자료가 아직 준비되지 않았습니다 | `CLINIC_RULE_SCOPE_ABSENT`, `PROFILE_ABSENT`, `PROFILE_DRAFT`, `PROFILE_DEMO`, `PROFILE_UNAPPROVED`, `PROFILE_INVALID`, `PROFILE_UNDER_REREVIEW`, `PROFILE_SOURCE_INCOMPLETE`, `PROFILE_FORMULA_UNSUPPORTED`, `PROFILE_VALUE_MISSING` |
| 이 치료의 보장 분류를 검토하고 있습니다 | `MAPPING_ABSENT`, `MAPPING_UNREVIEWED`, `MAPPING_REJECTED`, `MAPPING_INVALID`, `MAPPING_UNDER_REREVIEW`, `MAPPING_GROUP_NOT_IN_PROFILE` |
| 이 치료의 분류 확인이 필요합니다 | `CLASSIFICATION_NEEDS_REVIEW` |
| 이 치료의 가격 자료 확인이 필요합니다 | `LINE_ORIGIN_NOT_ACCEPTED` |

환자 화면에는 내부 코드, "N" 같은 기호, 세대별 규칙, 처리 방식 같은 내부 설계 설명을 보이지 않는다(기획서 §9 환자 화면 내부 설명).

## DD-22 결과·계산 근거 화면의 내용

- 결과 화면(정상·보장 제외): 기획서 §4의 고정 문구를 그대로 쓴다. 결과 문구 원칙 "표준 공제·한도 가정으로 계산한 예상 금액입니다. 실제 지급액은 가입 담보와 보험사 심사 결과에 따라 달라집니다. 자세한 계산 과정은 ‘계산 근거 보기’에서 확인하세요.", 공통 안내 문단, 세 번째 카드 보조 설명 "보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다." 표준 가정으로 계산한 값은 예시임을 표시한다(기획서 §4 "예시임을 명시"). 수령 후 부담을 오늘 결제액처럼 쓰지 않는다.
- 계산 근거 화면:
  - 입력으로 확인한 것: 고른 세대·보험사 형태·치료 원인·치료, 병원 게시 가격.
  - 가정으로 적용한 것: 표준 가정 프로필 값에 "(가정)" 표시, 상세에서 약관 출처(보험사·상품·개정일·조항 또는 페이지). "예시 계산" 표시.
  - 계산 과정: 그룹별 E, 명목 공제와 실제 적용 공제, 한도, 지급액, 공유 한도 적용 결과.
  - 제외 항목과 사유(보장 제외 결과에서 들어온 경우).
  - 확인하지 않은 전제: 개인 공제·한도·특약·잔여 한도·면책 기간·부담보를 묻거나 조회하지 않았다는 사실.
- 어느 화면에서도 "환자분의 실손은 C1입니다" 같은 확인 사실 표현을 쓰지 않는다.
- 보류 결과 화면의 문구는 DD-07을 따른다.

## DD-23 운영 준비 상태

준비 상태표(15칸). 칸은 승인·게시된 `OPERATING` 프로필이 있고 약관 출처가 완비되어야 `READY`다.

| 세대 \ 보험사 형태 | 손해보험사 | 생명보험사 | 그외 공제 조합 |
|--------------------|-----------|-----------|----------------|
| 1세대(A·S) | NOT_READY | NOT_READY | NOT_READY |
| 2세대(C1) | NOT_READY | NOT_READY | NOT_READY |
| 2.5세대(C2) | NOT_READY | NOT_READY | NOT_READY |
| 3세대(C3) | NOT_READY | NOT_READY | NOT_READY |
| 4세대(C4) | NOT_READY | NOT_READY | NOT_READY |

- 이와 별도로 치료별 매핑 준비 상태, 서류 규칙 준비 상태, 병원별 규칙 사용 범위 지정 여부를 표로 낸다. SPEC 작성 시점에는 운영 데이터가 하나도 없으므로 모두 `NOT_READY`다.
- 이 SPEC은 스키마·화면·엔진·시험을 만든다. 실제 운영은 준비 데이터가 승인될 때까지 보류된다(모든 계산이 "확인 필요").
- 운영 자료(소유자 결정 2026-10-14로 보류 확정, plan.md §E.1): 소유자가 첨부할 표준값 표, 약관 원문(조항·페이지·개정일·효력일), 병원 가격표와 행위 코드, 보험사·상품별 서류 요건, 보험사 형태가 규칙 선택에 쓰이는 방식(농협 계열의 소속 포함) 등.
