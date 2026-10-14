# SPEC-REIMBURSEMENT-ESTIMATOR-001 — 기술 설계 (design.md)

> 이 문서는 spec.md의 요구사항을 만족시키는 설계 결정(DD-01~DD-24)을 정리한다. 아래의 형식 정의는 TypeScript 형태의 스케치이며 최종 코드가 아니다. 이름은 구현 단계에서 바뀔 수 있으나, 상태 코드·보류 사유 코드·오류 코드·열거값은 SPEC 전체에서 같은 문자열을 쓴다. "(잠정)"은 원문 문서가 정하지 않아 이 SPEC이 기본값을 둔 항목이며 plan.md §E에 확인 항목(§E.2~§E.5) 또는 보류 확정 자료(§E.1)로 올라 있다. "SPEC 결정"은 원문 문서가 열어 두었거나 말하지 않은 점을 이 SPEC이 정한 것이다.

## DD-01 치료 원인과 금액 계산의 분리

- `estimate()`는 치료 원인 인자를 받지 않는다. 치료 원인은 `deriveDocuments()`에만 들어간다.
- 원인 값은 `Cause = 'INJURY' | 'ILLNESS' | 'UNKNOWN'`이다. `UNKNOWN`은 명시적인 값이며 null로 대신하지 않는다.
- API 응답의 `result` 블록은 원인 세 값 모두에서 같다. 이 불변 조건은 시험으로 고정한다(AC-006).
- 원인 `UNKNOWN`은 보류 사유가 아니다(기획서 §4 화면 3). 원인은 서류 안내에만 쓰고 금액에는 쓰지 않는다는 현재 MVP 결정은 기획서 111행·123행에 기록되어 있다(plan.md §E #9, 기록된 결정으로 닫음). 앞으로 금액에도 쓸지는 이 결정을 다시 열지 않고 plan.md §F 8번의 후속 SPEC 후보로 둔다.

## DD-02 데이터 기반 계산 엔진

### 공제·한도·원 단위 처리

`src/engine`에는 공제·한도 수치가 없다. 모든 값은 (세대, 보험사 형태)로 찾은 표준 가정 프로필에서 온다.

```ts
type Won = number;          // 원 단위 정수. 이름만으로는 검증이 아니며 범위는 DD-24
type BasisPoints = number;  // 정수, 10000 = 100% (SPEC 결정: 비율은 basis points로만 저장). 범위는 DD-24
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

- `round(x)`는 basis points 곱을 척도 `B = 10000`으로 나누며, `TRUNCATE`는 버림, `ROUND_HALF_UP`은 척도의 절반 `H = 5000`을 더한 뒤 버림이다. 곱은 `비율 × 금액`(`rate × E`, `rateBenefit × G`, `rateNonBenefit × N`)이다. 곱과 덧셈은 `src/engine/numeric.ts`의 검사 연산으로 하며, 어떤 검사 연산을 어떤 순서로 하는지와 정확한 결과가 안전 정수 범위를 넘을 때의 처리는 DD-24의 "계산 단계의 검사 연산 순서" 표가 정한다(공제 방식과 원 단위 처리마다 검사 단계가 다르다).
- 상수 규칙(REQ-ENG-001): 엔진 코드는 보험 업무 값(공제·한도·비율·지급액·횟수)을 리터럴이나 상수로 갖지 않고 표준 가정 프로필에서만 받는다. 인덱스·카운터·반복 한계·배열 길이 같은 일반 구현 상수, basis points 척도 10000과 그 절반 5000(각각 `src/engine/constants.ts`에 이름을 붙여 한 번만 선언), DD-24의 기술 안전 한도(`src/engine/limits.ts`)는 허용한다. 이 규칙은 숫자 몇 개를 허용 목록으로 못 박는 방식이 아니라, 업무 값이 코드에 들어오지 못하게 하는 것이 목적이다(검증 방법은 AC-001c).
- 비율이 있는 규칙에서 `rounding`이 빠지면 계산하지 않고 해당 그룹을 `PROFILE_VALUE_MISSING`으로 보류한다. `SPLIT_RATE_WITH_FIXED_FLOOR`는 두 곱을 더한 뒤 한 번만 처리한다(잠정; 규칙별 원 단위 처리는 plan.md §E.1 보류 자료).
- 위 네 가지 밖의 공제 방식(1세대 상해/질병 통원 공식 등 아직 정해지지 않은 것)은 `PROFILE_FORMULA_UNSUPPORTED`로 보류한다.
- 실제 적용 공제는 `D_applied = min(D, E)`이며, 결과는 `D`(명목)와 `D_applied`를 함께 기록한다(기획서 §6.2).
- 그룹 지급액 `P = min(max(E − D, 0), L)`. L은 `PER_VISIT_PAYOUT`·`PER_ACCIDENT`·`ANNUAL`이면 `amount`, `COUNT`이면 `perUseAmount`, `UNLIMITED_DECLARED`이면 상한 없음이다. `P`는 공유 한도를 적용하기 전의 값이다. 공유 한도 풀이 있으면 풀을 적용한 뒤의 값 `P_pooled`를 따로 내고(아래 "그룹과 공유 한도"), 풀이 없는 그룹은 `P_pooled = P`다.
- 프로필 값의 범위(DD-24)를 벗어난 값은 고치거나 0으로 대신하지 않고 그 그룹을 `PROFILE_VALUE_INVALID`로 보류한다. 값이 없거나 null이면 `PROFILE_VALUE_MISSING`이다. DD-24 "계산 단계의 검사 연산 순서" 표의 단계 가운데 하나라도 정확한 결과가 안전 정수 최댓값 `S`를 넘으면 그 그룹을 `CALC_RANGE_EXCEEDED`로 보류하며, 이때 금액·비율을 줄이거나 잘라서 맞추지 않고 부분 계산값(`D`, `P`)도 내지 않는다.
- `UNLIMITED_DECLARED`(SPEC 결정): 약관이 해당 담보에 지급 한도를 두지 않는다고 확인된 경우를 표현하는 값이다. `policyClauseRef`가 비어 있으면 `PROFILE_SOURCE_INCOMPLETE`로 보류한다. 운영 프로필에 이 값을 쓸지는 plan.md §E #10.
- `PER_ACCIDENT`·`ANNUAL`·`COUNT`는 잔여 한도를 묻지 않으므로 한도가 그대로 남아 있다고 보고 계산하며, 결과에 `REMAINING_LIMIT_ASSUMED` 가정을 낸다.
- `limitBasis = COVERED_COST`(보장 대상 비용 한도)의 계산식은 원문에 없다(기획서 §6.2). 엔진은 이를 계산하지 않고 `PROFILE_FORMULA_UNSUPPORTED`로 보류한다(plan.md §E #6).

### 그룹과 공유 한도

```ts
interface CoverageGroupDef {
  groupKey: string;                 // 프로필 안에서 비어 있지 않고 유일해야 한다(아래 "프로필 구조 검사")
  deduction: DeductionRule;         // 모든 그룹에 필수
  limit: LimitRule;                 // 모든 그룹에 필수
  sharedLimitPoolKey?: string;      // 있으면 같은 프로필의 poolKey 하나를 가리켜야 한다
}
interface SharedLimitPool { poolKey: string; limit: LimitRule }   // poolKey는 비어 있지 않고 프로필 안에서 유일
```

- 보장 여부는 그룹이 아니라 매핑이 나른다(SPEC 결정). `CoverageGroupDef`에는 `coverage`·`exclusionReason` 필드가 없다. 그룹이 정하는 것은 "보장 대상으로 확인된 비용 E에 어떤 공제·한도를 적용하는가"뿐이고, 치료별 보장 여부는 매핑의 `decision`(`COVERED` | `EXCLUDED`)이 유일한 출처다(DD-03 "확인된 제외와 줄 상태"). 제외를 그룹과 매핑 두 곳에서 말할 수 있으면 같은 치료에 대한 두 표현이 어긋날 수 있고 어느 쪽이 이기는지 정하는 규칙이 따로 필요해진다. 한 곳에서만 말하면 그 규칙이 필요 없다. 그래서 `deduction`과 `limit`은 모든 그룹에 필수이고, 없거나 null이면 그 그룹은 `PROFILE_VALUE_MISSING`이다.
- 공제는 그룹당 한 번만 계산한다. 같은 방문의 같은 그룹에 든 치료는 합산 뒤 한 번 공제한다(기획서 §9 공제 중복 방지).
- 치료(줄) 단위 계산 금지(SPEC 결정): 엔진과 그 결과를 쓰는 어떤 소비자도 공제를 치료마다 적용하거나, 그룹의 공제·지급액을 치료에 나누어 배분하거나, 치료별 보험금을 파생해서는 안 된다. `LineResult`에는 금액을 내보내는 필드가 없고(`patientAmount`는 입력 가격의 복사본이다), 확인된 제외 항목의 `payout: 0`은 표시용 상수이지 계산값이 아니다(DD-03). 공제 1회 적용은 AC-002i와 AC-002j가 증명한다.
- 서로 다른 그룹의 공제를 합치지 않는다.
- 확인된 제외 비용 X는 어떤 그룹의 E에도 들어가지 않는다(기획서 §6.4 사례 E). 확인된 제외는 `groupKey` 없는 `EXCLUDED` 매핑에서 나오므로 그룹 조회를 거치지 않는다(DD-03).
- 사용할 수 없는 줄(보류 줄)은 어느 그룹에도 들어가지 않는다. 그 줄의 금액은 어떤 그룹의 E·D·L 계산에도 쓰이지 않고 `lines[]`와 `holdReasons[]`에만 남는다(DD-05).
- 공유 한도 배분(SPEC 제안, 잠정): 풀마다 풀에 속한 그룹을 프로필의 `groupOrder` 순서로 돌며 `remaining = pool.L`에서 시작해 `P_pooled = min(P, remaining)`, `remaining -= P_pooled`로 정한다. 풀 한도가 `UNLIMITED_DECLARED`이면 `P_pooled = P`다. 정수 연산만 쓰므로 반올림도 나머지도 없고 결과는 결정적이다.
  - 불변 조건: `P_pooled ≤ P ≤ E`; 풀마다 `Σ P_pooled = min(Σ P, pool.L)`; 총합은 `groupOrder`와 무관하고 그룹별 몫만 `groupOrder`에 따라 달라진다. `expectedInsurancePayout = Σ P_pooled`다.
  - 이 배분 규칙은 plan.md §E #7에 묶인 SPEC 제안이며 소유자 승인이 아니다. 표시용 몫만 정하고 총합에는 영향이 없다.
  - 풀의 한도 값에 결함이 있으면 그 풀에 속한 그룹만 보류한다(아래 "프로필 구조 검사와 영향 범위"). 풀 배분의 합·차(`Σ P_pooled`, `remaining -= P_pooled`)는 `T`가 검사된 안전 정수이면 넘칠 수 없다(DD-24).

### 프로필 구조 검사와 영향 범위 (SPEC 결정)

`checkProfileStructure(profile)`는 입력만으로 결과가 정해지는 순수 함수이며, 규칙 묶음 게시 검증(DD-18, M3)과 계산(DD-04 호출 순서 5)이 같은 함수를 쓴다. 구조 결함은 아래 다섯 가지다.

| 번호 | 구조 규칙 | 결함 |
|------|-----------|------|
| 1 | 프로필은 그룹을 1개 이상 가진다 | 빈 프로필 |
| 2 | `groupKey`는 비어 있지 않고 프로필 안에서 유일하며, `poolKey`도 같다 | 빈 키, 키 중복 |
| 3 | `sharedLimitPoolKey`가 있으면 존재하는 `poolKey`를 가리킨다. 멤버 그룹이 없는 풀은 허용하며 아무 영향이 없다 | 없는 풀을 가리키는 참조 |
| 4 | `groupOrder`는 모든 `groupKey`를 정확히 한 번씩 담는다 | 빠진 키, 중복 키, 없는 키 |
| 5 | 한 규칙 묶음은 (세대, 보험사 형태) 칸마다 프로필을 하나만 담는다 | 같은 칸에 프로필 둘 이상 (이 규칙은 칸 조회가 보며, 묶음 게시 검증이 거절한다. DD-04 호출 순서 3) |

`groupOrder`는 데이터이므로 순서 독립 규칙(DD-03 "출력 순서와 순서 독립")의 예외다. 그 순서를 바꾼 프로필은 다른 입력이다.

풀의 값 결함은 구조 결함이 아니다. 풀 `limit`으로 허용하는 것은 `PER_VISIT_PAYOUT`·`PER_ACCIDENT`·`ANNUAL`·`COUNT`(모두 `limitBasis = PAYOUT`)와 `UNLIMITED_DECLARED`(`policyClauseRef` 필수, `P_pooled = P`는 기존 동작 그대로)이다. `limitBasis = COVERED_COST`이거나 종류·`limitBasis`가 이 닫힌 목록 밖이면 지원하지 않는 풀이다. 적용한 풀 한도가 `PER_ACCIDENT`·`ANNUAL`·`COUNT`이면 그룹 한도와 같이 `REMAINING_LIMIT_ASSUMED`를 낸다.

계산할 때의 영향 범위:

| 결함 | 보류 코드 | 보류 범위 |
|------|-----------|-----------|
| 구조 결함(위 1~5) | `PROFILE_INVALID` (새 코드 없음) | 모든 줄. 프로필 전체를 믿을 수 없기 때문이다 |
| 풀 한도 값 없음·null | `PROFILE_VALUE_MISSING` | 그 풀을 `sharedLimitPoolKey`로 가리키는 그룹만 |
| 풀 한도 값이 DD-24 범위 밖 | `PROFILE_VALUE_INVALID` | 같음 |
| 풀 한도의 종류·`limitBasis`가 지원 밖(`COVERED_COST` 포함) | `PROFILE_FORMULA_UNSUPPORTED` | 같음 |
| `UNLIMITED_DECLARED` 풀에 조항 참조 없음 | `PROFILE_SOURCE_INCOMPLETE` | 같음 |

- 풀 값 결함은 그 풀의 멤버 그룹만 해당 코드로 보류한다. 풀의 멤버가 아닌 그룹과 다른 풀의 그룹은 영향을 받지 않고 정상 계산한다. 보류 그룹과 한도를 공유하는 그룹은 `referenceGroups`에 넣지 않는다(DD-03의 기존 규칙).
- 한 그룹에 코드가 여럿 해당하면 코드 종류의 우선순위가 먼저다: `PROFILE_SOURCE_INCOMPLETE` → `PROFILE_FORMULA_UNSUPPORTED` → `PROFILE_VALUE_MISSING` → `PROFILE_VALUE_INVALID` → `CALC_RANGE_EXCEEDED`. 같은 종류 안에서는 그 그룹 자신의 `deduction`, `limit`을 먼저 보고 그다음에 풀을 본다.
- 게시 검증(M3, 도메인)은 같은 `checkProfileStructure`를 쓴다. 구조 결함과 풀의 금액이 DD-24 범위 밖인 경우(그룹 값과 같음)는 어긋난 필드 경로와 함께 묶음 게시를 거절하고 아무것도 저장하지 않는다(DD-24, AC-011i). 공식 지원 여부(종류·`limitBasis`·조항 참조)는 게시 거절 사유가 아니라 위 표의 계산 때 보류 사유다.

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
  patientAmount: Won;                 // 환자 예상 결제액. 0 이상 MAX_AMOUNT_WON 이하 정수(DD-24)
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

interface RuleBundleSnapshot {
  id: string;                         // = ruleBundleVersion
  contentHash: string;
  status: 'ACTIVE' | 'SUSPENDED';     // 서버가 요청 시점에 새로 읽은 가용성(캐시하지 않음, DD-14). 바뀌지 않는 묶음 내용과 별개의 값이다
  profiles: StandardAssumptionProfile[]; mappings: TreatmentCoverageMapping[]; documentRuleSet: DocumentRuleSet | null;
}
```

- `bundle.status`는 서버가 채워 넘기는 값이다. 엔진은 이 값을 추정하거나 바꾸지 않고 받은 대로 판정한다. 버전 id와 내용 해시가 같아도 `SUSPENDED`이면 묶음을 쓰지 않는다(`RULE_BUNDLE_SUSPENDED`, 아래 보류 사유 표).

- 공통 기본비용(`CommonBaseFee`, SPEC 결정)은 자동 포함 줄로 계산하며 치료와 같은 매핑 판정을 거친다. 매핑이 없으면 그 줄이 보류된다. 기본비용이 하나라도 등록되어 있으면 `baseFeeIncluded = 'INCLUDED'`(그 줄이 보류되어도 금액은 병원 결제액에 들어간다), 하나도 없으면 `'NOT_REGISTERED'`이고 화면은 기본 진료비 포함 여부를 안내한다(기획서 §5). 기본비용에도 매핑이 필요하다는 결정은 plan.md §E #8.
- 엔진 입력 검증: 세대가 열거값 밖이면 `UNSUPPORTED_GENERATION`, 치료가 없으면 `NO_TREATMENT_SELECTED`, 줄(치료·공통 기본비용)의 금액이 `Won` 범위 밖이거나 예상 병원 결제액 T의 검사 합산이 안전 정수를 넘으면 `INVALID_NUMERIC_INPUT`으로 거절한다(판정 순서는 이 순서이며, 수치 검사의 정의와 처리는 DD-24). 이 셋은 계산 결과가 아니라 거절이다. `INVALID_NUMERIC_INPUT`은 보류 코드가 아니다. 병원 결제액이 믿을 수 있는 숫자여야 하므로 잘못된 줄을 보류로 돌리거나 합계에서 빼지 않는다. 엔진은 지원 범위 밖 계약(노후·유병력자·단체 실손 등)을 판별하지 않는다. 그런 입력이 없고, 가려내는 방법은 미정이다(plan.md §E #11).

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
  // 금액을 내보내는 필드는 patientAmount(입력 가격의 복사본)뿐이다. 줄 단위 지급액은 계산·저장·반환·표시하지 않는다.
}
interface GroupResult {
  groupKey: string; state: GroupState;
  G: Won; N: Won; E: Won;            // 보장 대상 급여·비급여·합계 (ESTIMATED 줄만)
  D: Won | null; D_applied: Won | null; L: Won | 'UNLIMITED' | null;
  P: Won | null;                     // 공유 한도 적용 전 그룹 지급액 = min(max(E − D, 0), L)
  P_pooled: Won | null;              // 공유 한도 풀 적용 후 그룹 지급액(풀이 없으면 P와 같다)
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
  referenceGroups: Array<{ groupKey: string; P: Won; isReference: true }>;  // P = 그 그룹의 P_pooled 값
  assumptions: AssumptionCode[];
  holdReasons: Array<{ treatmentId: string; code: HoldReasonCode }>;
  excludedItems: Array<{ treatmentId: string; amount: Won; reason: string; payout: 0 }>;  // payout은 상수 0
  basis: Basis;
}
```

- 줄 단위 지급액은 없다(SPEC 결정). 근거: 어느 요구사항도 화면도 치료별 보험금을 필요로 하지 않는다. 기획서 §4의 결과는 금액 카드 셋이고(141-156행), 설명 영역은 공제 계산식·한도 초과액·제외 항목이며(181-188행), 확인된 제외 항목에는 "해당 항목 예상 보험금 0원과 제외 사유"를 보인다(166행). `K04_Basis_Calculation`의 치료 표 열은 치료 / 구분 / 환자 결제액 / 보장 대상 여부이고 치료별 보험금 열이 없으며, design-requirements §7 702행은 그룹별 + 전체 계산 결과의 모양을 열린 질문으로 둔다. 따라서 지급액은 `GroupResult`와 전체 합계에서만 나온다.
- `excludedItems[].payout`은 리터럴 상수 `0`이다("확인된 제외 항목의 예상 보험금 0원 표시용 상수, 계산값 아님", 기획서 §4 166행). 화면은 이 값으로 "0원 + 사유"를 보인다.
- `basis`의 `FormulaStep[]`은 그룹마다 E, 명목 D, `D_applied`, L, P, `P_pooled`(풀이 있으면 풀 키)를 기록한다. `expectedInsurancePayout`, `groups[]`, `basis`, 직렬화한 결과는 서로 어긋나지 않아야 한다(AC-004h).

- `hospitalPayment`는 선택한 치료와 등록된 공통 기본비용의 환자 예상 결제액 합이다. 보류 여부와 관계없이 숫자다.
- 보류가 없으면 `expectedInsurancePayout = Σ P_pooled`(공유 한도 적용 뒤 그룹 지급액의 합), `expectedOutOfPocketAfterPayout = hospitalPayment − expectedInsurancePayout`이다. 두 값은 둘 다 null이거나 둘 다 정수다.
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
| `RULE_BUNDLE_SUSPENDED` | 규칙 사용 범위가 가리키는 묶음의 가용성이 `SUSPENDED`다(`bundle.status`, 게시 뒤 중지). 요청이 든 버전과 내용 해시가 같아도 쓰지 않는다 | 모든 줄 |
| `PROFILE_ABSENT` | 해당 (세대, 보험사 형태) 칸에 프로필 기록이 없다 | 모든 줄 |
| `PROFILE_DEMO` | 프로필 출처가 허용 출처 밖이다: `DEMO`(어느 구성에서나), 또는 운영 구성의 `TEST_FIXTURE`. 이름은 `DEMO`이지만 허용되지 않은 모든 비운영 출처를 덮는다 | 모든 줄 |
| `PROFILE_DRAFT` | 프로필 상태가 `DRAFT` | 모든 줄 |
| `PROFILE_UNAPPROVED` | `REVIEW_REQUESTED`, `REJECTED`, 또는 `APPROVED`이나 아직 `PUBLISHED`가 아님 | 모든 줄 |
| `PROFILE_UNDER_REREVIEW` | `UNDER_REREVIEW` | 모든 줄 |
| `PROFILE_INVALID` | `SUPERSEDED`·`EXPIRED`·`SUSPENDED`, 유효 기간 밖, 내용 해시 불일치. 또는 프로필 구조 결함: 빈 프로필, 빈·중복 `groupKey`·`poolKey`, 없는 풀을 가리키는 `sharedLimitPoolKey`, `groupOrder`의 빠진·중복·없는 키, 같은 칸에 프로필 둘 이상(DD-02 "프로필 구조 검사와 영향 범위") | 모든 줄 |
| `PROFILE_SOURCE_INCOMPLETE` | (기록 단위) 약관 출처 6항목 중 누락, 승인자 기록 누락. (그룹 단위) `UNLIMITED_DECLARED`의 조항 참조 누락. 그룹 자신의 한도뿐 아니라 공유 한도 풀의 한도도 해당한다 | 기록 단위: 모든 줄 / 그룹 단위: 그 그룹(풀 한도 결함이면 그 풀의 멤버 그룹) |
| `PROFILE_FORMULA_UNSUPPORTED` | 닫힌 공제 방식 밖, `limitBasis = COVERED_COST`. 공유 한도 풀의 한도가 지원 밖 종류·`limitBasis`(`COVERED_COST` 포함)인 경우도 해당한다 | 그 그룹(풀 한도 결함이면 그 풀의 멤버 그룹) |
| `PROFILE_VALUE_MISSING` | 공제·한도 값, 또는 비율 규칙의 `rounding` 누락(없음·null). 공유 한도 풀의 한도 값 누락도 해당한다 | 그 그룹(풀 한도 결함이면 그 풀의 멤버 그룹) |
| `PROFILE_VALUE_INVALID` | 값이 있으나 DD-24 범위 밖: 금액이 음수·소수·`NaN`·`±Infinity`·문자열·`MAX_AMOUNT_WON` 초과, 비율이 0 미만 또는 10000 초과 등. 공유 한도 풀의 한도 값이 무효이면 그 풀의 멤버 그룹만 보류한다(멤버가 아닌 그룹은 영향이 없다) | 그 그룹(풀 한도 결함이면 그 풀의 멤버 그룹) |
| `CALC_RANGE_EXCEEDED` | 값은 모두 유효하나 DD-24 "계산 단계의 검사 연산 순서" 표의 단계 하나에서 정확한 결과가 안전 정수 최댓값 `S`를 넘음 | 그 그룹 |
| `LINE_ORIGIN_NOT_ACCEPTED` | 치료·공통 기본비용 줄의 출처가 구성의 줄 허용 출처 밖(운영 구성의 `DEMO`·`TEST_FIXTURE`) | 그 줄 |
| `CLASSIFICATION_NEEDS_REVIEW` | 치료 버전의 `calcClass = NEEDS_REVIEW` | 그 줄 |
| `MAPPING_ABSENT` | 이 줄의 `treatmentId`를 가지고 해당 (세대, 보험사 형태) 칸을 범위로 하는 매핑 후보가 하나도 없다(`resolveMapping` 1단계) | 그 줄 |
| `MAPPING_UNREVIEWED` | `DRAFT`·`REVIEW_REQUESTED`, 또는 `APPROVED`이나 미게시 (기획서 §5의 "상담필요"도 여기에 해당) | 그 줄 |
| `MAPPING_REJECTED` | `REJECTED` | 그 줄 |
| `MAPPING_UNDER_REREVIEW` | `UNDER_REREVIEW`, 또는 지문 불일치(DD-15). 지문 불일치는 후보 하나의 사용 가능 판정(`isUsable`)의 마지막 검사에서 나온다 | 그 줄 |
| `MAPPING_INVALID` | `SUPERSEDED`·`EXPIRED`·`SUSPENDED`, 유효 기간 밖, 약관 출처 누락, 승인자 누락, 허용 출처 밖(운영 구성의 `TEST_FIXTURE`, 어느 구성에서나 `DEMO`). 또는 **사용 가능한** 후보가 둘 이상(모호; `COVERED`와 `EXCLUDED`가 섞여도 같다). 또는 사용 가능으로 확정된 매핑이 필드 규칙을 어김(방어, "확인된 제외와 줄 상태"). 출처·승인자 사유는 별도 코드 없이 이 코드에 접어 넣는다(SPEC 결정) | 그 줄 |
| `MAPPING_GROUP_NOT_IN_PROFILE` | 사용 가능한 `COVERED` 매핑의 `groupKey`가 프로필에 정의되지 않음 (특약·담보 값이 프로필에 없는 경우, 기획서 §9 특약 가정 없음). 사용 가능한 `COVERED` 매핑에만 적용하고 줄 단위 검사의 마지막이다. `EXCLUDED` 매핑에는 `groupKey`가 없으므로 적용하지 않는다 | 그 줄 |

- 이 표의 보류 코드는 모두 21개다(스크립트로 센 값). DD-04의 사유→코드 표와 묶음 사유 표, DD-21의 환자용 분류가 같은 이름을 쓰고(DD-21은 21개 전부, DD-04는 항목 사유에서 나오는 코드만), acceptance.md는 이 21개 이름만 쓰며 21개를 모두 쓴다. 이 표 밖의 보류 코드는 없다.
- 치료 원인 `UNKNOWN`은 보류 사유가 아니다.
- **판정 순서**(한 줄에 여러 사유가 겹치면 첫 번째 하나만 기록, 결정적. DD-04의 호출 순서와 같다):
  1. `CLINIC_RULE_SCOPE_ABSENT`: `isBundleUsable(null)`
  2. `RULE_BUNDLE_SUSPENDED`: 규칙 묶음은 있으나 `bundle.status = SUSPENDED`이면 모든 줄이 이 코드를 받고 아래 3~5는 보지 않는다. `isUsable`은 한 번도 부르지 않으며 묶음에 든 항목의 상태·버전·해시는 이 판정에 쓰이지도 바뀌지도 않는다
  3. 프로필 칸 조회와 기록 단위 사유: 칸에 프로필이 없으면 `PROFILE_ABSENT`, 둘 이상이면 `PROFILE_INVALID`(구조 결함). 하나이면 그 프로필의 `isUsable`: 출처 `PROFILE_DEMO` → 상태(`PROFILE_DRAFT` → `PROFILE_UNAPPROVED` → `PROFILE_UNDER_REREVIEW` → `PROFILE_INVALID`) → 유효 기간(`PROFILE_INVALID`) → 출처·승인자(`PROFILE_SOURCE_INCOMPLETE`) → 내용 해시(`PROFILE_INVALID`). 통과하면 프로필 구조 검사(결함이면 `PROFILE_INVALID`, DD-02)
  4. 줄 단위 사유: `LINE_ORIGIN_NOT_ACCEPTED` → `CLASSIFICATION_NEEDS_REVIEW` → 매핑 조회(`resolveMapping`): 후보 없음 `MAPPING_ABSENT` → 후보마다 `isUsable`(출처 → 상태 → 유효 기간 → 약관 출처 → 승인자 → **지문이 마지막**) → 사용 가능한 후보의 개수(둘 이상이면 `MAPPING_INVALID`(모호), 하나이면 확정하고 필드 규칙을 어기면 `MAPPING_INVALID`, 없으면 후보들이 받은 코드(`MAPPING_UNDER_REREVIEW`, `MAPPING_UNREVIEWED`, `MAPPING_REJECTED`, `MAPPING_INVALID`) 가운데 고정 우선순위 하나) → 확정된 `COVERED` 매핑의 `MAPPING_GROUP_NOT_IN_PROFILE`(줄 단위 검사의 마지막). 확정된 `EXCLUDED` 매핑은 그룹을 조회하지 않고 `EXCLUDED_CONFIRMED`다
  5. 그룹 단위 프로필 사유(줄 단위 사유가 없는 줄이 속한 그룹에 대해): `PROFILE_SOURCE_INCOMPLETE`(조항 누락) → `PROFILE_FORMULA_UNSUPPORTED` → `PROFILE_VALUE_MISSING` → `PROFILE_VALUE_INVALID` → `CALC_RANGE_EXCEEDED`. 같은 종류 안에서는 그룹 자신의 `deduction`, `limit`을 먼저, 그 그룹의 공유 한도 풀을 나중에 본다(DD-02). 그룹 단위 보류 그룹의 줄에는 그 코드가 `holdReasons`에 기록된다.

### 확인된 제외와 줄 상태 (SPEC 결정)

매핑의 `decision`이 치료별 보장 여부의 유일한 출처다. 그룹은 보장 여부를 갖지 않고 보장 대상 비용에 대한 공제·한도만 정한다(DD-02). 매핑의 필드 규칙은 다음과 같다.

| `decision` | `groupKey` | `exclusionReason` | `policySourceIds`·승인자 |
|------------|------------|-------------------|--------------------------|
| `COVERED` | 필수(비어 있지 않음) | 없음 | 1개 이상 · 승인자 기록 |
| `EXCLUDED` | **없음** | 필수(비어 있지 않음) | 1개 이상 · 승인자 기록 (`COVERED`와 똑같이) |
| 두 값 밖 | — | — | 게시 거절 |

`EXCLUDED`에 `groupKey`를 두지 않는 이유: 확인된 제외는 어떤 계산 그룹에도 속하지 않고 어떤 `E`에도 들어가지 않는다. 그런 매핑이 `groupKey`를 가지면 어디에서도 읽히지 않는 필드가 되어 `COVERED`용 값과 어긋난 채 남을 위험만 생긴다.

줄 상태는 사용 가능한 매핑이 확정된 뒤 아래 표로 정한다. 줄 출처와 분류 검사는 매핑 조회 앞에 있다(판정 순서 4).

| 조건 | 줄 상태 | 코드·그룹 |
|------|---------|-----------|
| 줄 출처가 허용 밖 | `ON_HOLD` | `LINE_ORIGIN_NOT_ACCEPTED` |
| `calcClass = NEEDS_REVIEW` | `ON_HOLD` | `CLASSIFICATION_NEEDS_REVIEW` |
| 사용 가능한 매핑을 얻지 못함 | `ON_HOLD` | 후보 없음 `MAPPING_ABSENT`, 모호·필드 규칙 어김 `MAPPING_INVALID`, 그 밖에는 우선순위 코드(`resolveMapping`) |
| 사용 가능한 `COVERED` 매핑, `groupKey`가 프로필에 있음 | `ESTIMATED` | 그 그룹의 `E`·`G`·`N`에 들어감 |
| 사용 가능한 `COVERED` 매핑, `groupKey`가 프로필에 없음 | `ON_HOLD` | `MAPPING_GROUP_NOT_IN_PROFILE`. 줄 단위 검사의 마지막이며 사용 가능한 `COVERED` 매핑에만 적용한다 |
| 사용 가능한 `EXCLUDED` 매핑 | `EXCLUDED_CONFIRMED` | 그룹 조회 없음. `excludedItems[]`에 사유와 함께 들어가고 어떤 `E`에도 들어가지 않음 |

- **제외 지름길 없음.** 확인된 제외는 사용 가능한 `EXCLUDED` 매핑으로만 존재한다. `calcClass = NEEDS_REVIEW`, 매핑 없음·미검토·반려·재검토 중·무효, 지문 불일치, 허용 밖 출처, 약관 출처나 승인자 누락은 어느 것도 `EXCLUDED_CONFIRMED`를 만들지 않고 위 표의 보류 코드를 만든다. `decision = EXCLUDED`인 매핑이 사용 불가 상태이면 제외가 아니라 그 상태의 보류 코드를 받는다. "제외일 것이다"라는 추정으로 제외 항목을 만들지 않는다.
- **필드 규칙 방어.** 게시 검증을 통과한 매핑은 필드 규칙을 지키므로 아래는 저장 데이터 결함에서만 생긴다. 사용 가능으로 확정된 매핑이 `COVERED`인데 `groupKey`가 비었거나 `exclusionReason`이 있거나, `EXCLUDED`인데 `groupKey`가 있거나 `exclusionReason`이 비었거나, `decision`이 두 값 밖이면, 그 줄은 `ESTIMATED`도 `EXCLUDED_CONFIRMED`도 되지 않고 `MAPPING_INVALID`로 보류된다(SPEC 결정; 새 코드를 만들지 않는다).
- 게시 검증(M3, 도메인): 위 규칙을 어긴 매핑(`COVERED`에 `groupKey` 없음, `EXCLUDED`에 `groupKey` 있음, `EXCLUDED`에 사유 없음, `COVERED`에 사유 있음, `decision`이 두 값 밖)은 어긋난 필드 경로와 함께 거절하고 아무것도 저장하지 않는다. 같은 규칙 묶음 안에서 매핑 범위의 한 칸에 프로필이 같이 들어 있으면 그 칸의 `COVERED` 매핑의 `groupKey`가 그 프로필에 있어야 하며 없으면 거절한다. 프로필이 없는 칸의 매핑은 허용하고 그 칸은 계산 때 `PROFILE_ABSENT`로 보류된다. 한 묶음은 (세대, 보험사 형태) 칸마다 프로필을 하나, 매핑 id마다 버전을 하나만 담는다. 계산 때의 `MAPPING_GROUP_NOT_IN_PROFILE`은 오래된 데이터에 대한 방어로 남는다.

### 매핑 조회 `resolveMapping` (SPEC 결정)

```ts
function resolveMapping(
  line: PublishedLine,
  bundle: RuleBundleSnapshot,            // isBundleUsable을 통과한 묶음
  cell: { generation: Generation; insurerType: InsurerType },
  ctx: UsabilityContext,                 // DD-04
):
  | { resolved: true; mapping: TreatmentCoverageMapping }
  | { resolved: false; code: 'MAPPING_ABSENT' | 'MAPPING_UNREVIEWED' | 'MAPPING_REJECTED'
                            | 'MAPPING_UNDER_REREVIEW' | 'MAPPING_INVALID' };
```

조회는 다음 순서로 한다. 배열 순서에 기대는 단계는 없다.

1. **후보 범위.** `bundle.mappings`에서 `mapping.treatmentId === line.treatmentId`이고 `(generation, insurerType) ∈ mapping.scope`인 것이 후보다. 치료와 공통 기본비용 줄은 같은 id 공간을 쓰며 id는 겹치지 않는다. 후보가 없으면 `MAPPING_ABSENT`로 끝낸다.
2. **후보별 사용 가능 판정.** 후보마다 DD-04의 `isUsable`을 같은 검사 순서(출처 → 상태 → 유효 기간 → 약관 출처 → 승인자 → 무결성)로 부른다. 무결성은 매핑의 `approvedFingerprint`와 이 줄의 현재 `coverageFingerprint`를 비교하며 가장 마지막 검사다. 지문이 어긋난 후보는 사용 가능하지 않다(사유 `INTEGRITY_MISMATCH` → `MAPPING_UNDER_REREVIEW`).
3. **사용 가능한 후보의 개수.** 사용 가능하다는 것은 지문까지 모든 검사를 통과했다는 뜻이다.
   - 정확히 하나: 그 매핑으로 확정한다. 사용 불가인 다른 후보는 무시한다.
   - 둘 이상: `MAPPING_INVALID`(모호). `decision`이 같아도, `COVERED`와 `EXCLUDED`가 섞여도 같다. "제외가 이긴다"도 "보장이 이긴다"도 없다.
   - 없음: 4단계.
4. **사용 가능한 후보가 없고 후보는 하나 이상일 때.** 후보들이 각각 받은 보류 코드(DD-04 사유→코드 표) 가운데 하나를 배열 순서와 무관한 고정 우선순위로 고른다: `MAPPING_UNDER_REREVIEW` > `MAPPING_UNREVIEWED` > `MAPPING_REJECTED` > `MAPPING_INVALID`. 다음 검토자 동작으로 사용 가능해질 가능성이 가장 가까운 코드가 이긴다는 뜻이며, 이 우선순위는 SPEC 결정이다.
5. 확정된 `COVERED` 매핑에 한해 `groupKey` 단계(`MAPPING_GROUP_NOT_IN_PROFILE`)가 이어진다. 확정된 `EXCLUDED` 매핑은 그룹 조회 없이 `EXCLUDED_CONFIRMED`다.

프로필 칸 조회도 같은 원칙이다. 칸에 프로필이 0개이면 `PROFILE_ABSENT`, 2개 이상이면 `PROFILE_INVALID`(구조 결함, 프로필 전체), 정확히 1개이면 그 프로필의 `isUsable`로 이어진다. 이 조회와 뒤따르는 `isUsable`·`checkProfileStructure`(DD-04 호출 순서 3~5)를 하나로 묶은 함수가 `resolveProfile`이다.

```ts
function resolveProfile(
  bundle: RuleBundleSnapshot,            // isBundleUsable을 통과한 묶음
  cell: { generation: Generation; insurerType: InsurerType },
  ctx: UsabilityContext,                 // DD-04
):
  | { resolved: true; profile: StandardAssumptionProfile }
  | { resolved: false; code: 'PROFILE_ABSENT' | 'PROFILE_DEMO' | 'PROFILE_DRAFT' | 'PROFILE_UNAPPROVED'
                            | 'PROFILE_UNDER_REREVIEW' | 'PROFILE_INVALID' | 'PROFILE_SOURCE_INCOMPLETE' };
```

`estimate()`와 준비 상태 계산(DD-23)이 이 함수를 같이 부른다. 호출 순서와 코드는 DD-04의 호출 순서 3~5와 위 판정 순서 3번 그대로이며 두 번째 구현은 없다.

### 출력 순서와 순서 독립 (SPEC 결정)

엔진 결과는 다음 입력의 배열 순서를 바꿔도 바뀌지 않는다: `bundle.mappings`, `bundle.profiles`, 프로필의 `groups`와 `sharedLimitPools`, 서류 규칙 묶음의 `rules`(우선순위 동률은 배열 위치가 아니라 명시한 키로 깨야 하며 그 키는 DD-06 "규칙 평가" 7번이 정한다: `priority` 오름차순, 같으면 `reason`의 유니코드 코드 포인트 순), 입력의 `lines`·`baseFeeLines`·`treatmentIds`. 예외는 `groupOrder`뿐이며, 이것은 공유 한도 몫을 정하는 데이터다. 엔진은 배열 위치나 `Map` 삽입 순서에 기대지 않는다. 직렬화한 결과의 순서는 다음으로 고정한다.

| 출력 | 순서 |
|------|------|
| `lines[]`, `holdReasons[]`, `excludedItems[]` | `treatmentId` 오름차순(유니코드 코드 포인트 순) |
| `groups[]`, `referenceGroups[]` | 프로필의 `groupOrder` |
| `assumptions[]` | 위 "가정 코드" 표의 행 순서 |
| `basis`의 그룹별 단계 | `groups[]`와 같은 순서 |

그래서 "바이트 단위로 같다"는 말은 같은 의미의 입력이면 배열 순서가 달라도 성립한다(AC-001a, AC-006d, AC-008k).

### 0원의 의미

| 상황 | 값 |
|------|-----|
| 확인되지 않음 (보류) | null, "확인 필요" |
| 통신 실패 | null (전송 상태 `FAILED`) |
| 확인된 제외 | 제외 항목의 `payout` 상수 0 + 제외 사유(계산값이 아님) |
| 수치가 범위 밖 | 0으로 바꾸지 않는다. 줄 금액·병원 결제액 T는 계산 거절(`INVALID_NUMERIC_INPUT`), 프로필 값·계산 범위는 그 그룹 보류(DD-24) |
| 정상 계산 결과가 0 | 0원 + 계산 근거 |
| 치료를 고르지 않음 | 요청 거절 (`NO_TREATMENT_SELECTED`), 0원으로 표시하지 않음 |

## DD-04 단일 사용 가능 판정과 출처

사용 가능 판정은 책임이 다른 두 함수로 나뉜다(SPEC 결정). 묶음 단위 선행 판정(`isBundleUsable`)은 묶음의 가용성만 보고 묶음 안의 항목을 읽지 않는다. 항목 단위 판정(`isUsable`)은 이미 `isBundleUsable`을 통과한 묶음 안의 항목만 보고 묶음의 상태는 보지 않는다.

```ts
// 묶음 단위 선행 판정. 묶음의 가용성만 본다. 묶음 안의 항목은 읽지 않는다.
function isBundleUsable(bundle: RuleBundleSnapshot | null):
  | { usable: true; bundle: RuleBundleSnapshot }
  | { usable: false; reason: 'SCOPE_ABSENT' | 'BUNDLE_SUSPENDED' };    // → CLINIC_RULE_SCOPE_ABSENT / RULE_BUNDLE_SUSPENDED

// 항목 단위 판정. 이미 isBundleUsable을 통과한 묶음 안의 항목에만 부른다. 묶음 상태를 보지 않는다.
function isUsable(item: RuleItem, ctx: UsabilityContext):
  | { usable: true } | { usable: false; reason: ItemUsabilityReason };

interface UsabilityContext {
  at: string;                                  // 판정 기준일 (주입)
  acceptedOrigins: Origin[];                   // 규칙 데이터는 acceptedOrigins.rules (DD-03)
  digest: (content: unknown) => string;        // 내용 해시 함수 (주입, 엔진은 해시 구현을 가져오지 않는다)
}

type ItemUsabilityReason =
  | 'ORIGIN_NOT_ACCEPTED'
  | 'STATE_DRAFT' | 'STATE_UNAPPROVED' | 'STATE_REJECTED' | 'STATE_UNDER_REREVIEW' | 'STATE_INVALID'
  | 'OUTSIDE_VALIDITY' | 'SOURCE_INCOMPLETE' | 'APPROVER_MISSING' | 'INTEGRITY_MISMATCH';   // 묶음 사유는 없다

// 프로필·매핑·서류 규칙 묶음이 공통으로 갖는 머리 정보와 무결성 입력
interface RuleItemHeader {
  state: LifecycleState;                       // DD-17 생명주기 상태
  origin: Origin;
  validity: { from: string; to: string };     // 유효 기간. 형식 세부는 구현이 정한다
  policySources: PolicySourceRef[];            // 약관 출처: 보험사 원문 식별, 개정일, 조항·페이지, 효력일, 확인자, 확인일
  approver: ApproverRecord | null;
}
type RuleItem =
  | (RuleItemHeader & { kind: 'PROFILE' | 'DOCUMENT_RULE_SET'; contentHash: string; content: unknown })   // 무결성: digest(content) === contentHash
  | (RuleItemHeader & { kind: 'MAPPING'; approvedFingerprint: string; currentFingerprint: string });      // 무결성: 두 지문이 같음
```

- `isBundleUsable`/`isUsable`의 한 문장씩: `isBundleUsable`은 규칙 사용 범위가 없는지(`null`)와 묶음이 중지(`SUSPENDED`)인지만 판정하고, `isUsable`은 항목 하나의 출처·상태·유효 기간·약관 출처·승인자·무결성만 판정한다. 매핑의 `currentFingerprint`는 항목 안의 값이 아니라 호출하는 쪽(`resolveMapping`)이 줄의 `coverageFingerprint`에서 채워 넘긴다. `isUsable`은 줄도 묶음도 읽지 않는다.
- `estimate()` 안의 호출 순서(DD-03 판정 순서와 같다):
  1. 입력 검증(`UNSUPPORTED_GENERATION` → `NO_TREATMENT_SELECTED` → `INVALID_NUMERIC_INPUT`, 거절)
  2. `isBundleUsable(input.bundle)`. 사용 불가이면 모든 줄이 그 묶음 코드로 `ON_HOLD`이고 3 이하는 실행하지 않는다. 이때 `isUsable`은 한 번도 부르지 않고 서류는 null이다
  3. 프로필 칸 조회: 0개 `PROFILE_ABSENT`, 2개 이상 `PROFILE_INVALID`(구조 결함), 1개이면 계속 (3~5를 묶은 것이 `resolveProfile`, DD-03)
  4. `isUsable(profile)`
  5. `checkProfileStructure(profile)` (DD-02)
  6. 줄마다: 줄 출처 → `calcClass = NEEDS_REVIEW` → `resolveMapping`(후보마다 `isUsable`, DD-03) → `groupKey` (이 줄 판정을 묶은 함수가 `decideLine`이며 준비 상태 계산이 같은 함수를 부른다, DD-23)
  7. 그룹마다 값 검사(풀 값 포함, DD-02·DD-24). 계산 범위 초과(`CALC_RANGE_EXCEEDED`)를 뺀 값 검사는 저장 자료만으로 정해지며 별도 함수 `checkGroupValues`로 둔다(DD-23이 같은 함수를 부른다)
  8. 산술(DD-24의 검사 연산 순서)
- 서류는 `estimate()`의 일부가 아니다. `deriveDocuments`는 전체가 `ON_HOLD`이면 null을 받고, 그렇지 않으면 사용 가능한 묶음 안에서 `isUsable(documentRuleSet)`이 통과한 서류 규칙 묶음만 받는다. 통과하지 못하면 null을 받아 `RULES_UNAVAILABLE`이 된다. 묶음 중지는 전체가 `ON_HOLD`이므로 서류 규칙 판정에 닿지 않는다.
- 항목의 사용 가능 조건(모두 만족): 출처 ∈ `acceptedOrigins`, `state = PUBLISHED`, `at`이 유효 기간 안, 약관 출처 완비(보험사 원문 식별, 개정일, 조항·페이지, 효력일, 확인자, 확인일), 승인자 기록, 무결성 일치(프로필·서류 규칙은 내용 해시, 매핑은 지문 DD-15). 검사 순서도 이 순서이며(무결성이 마지막), 처음 걸린 사유 하나를 돌려준다. 묶음의 가용성은 이 목록에 없다.
- 상태별 사유: `DRAFT` → `STATE_DRAFT`; `REVIEW_REQUESTED`·`APPROVED`(미게시) → `STATE_UNAPPROVED`; `REJECTED` → `STATE_REJECTED`; `UNDER_REREVIEW` → `STATE_UNDER_REREVIEW`; `SUPERSEDED`·`EXPIRED`·`SUSPENDED` → `STATE_INVALID`.
- 항목 사유 → 보류 코드:

| ItemUsabilityReason | 프로필 | 매핑 | 서류 규칙 묶음 |
|-----------------|--------|------|----------------|
| `ORIGIN_NOT_ACCEPTED` | `PROFILE_DEMO` | `MAPPING_INVALID` | `RULES_UNAVAILABLE` |
| `STATE_DRAFT` | `PROFILE_DRAFT` | `MAPPING_UNREVIEWED` | `RULES_UNAVAILABLE` |
| `STATE_UNAPPROVED` | `PROFILE_UNAPPROVED` | `MAPPING_UNREVIEWED` | `RULES_UNAVAILABLE` |
| `STATE_REJECTED` | `PROFILE_UNAPPROVED` | `MAPPING_REJECTED` | `RULES_UNAVAILABLE` |
| `STATE_UNDER_REREVIEW` | `PROFILE_UNDER_REREVIEW` | `MAPPING_UNDER_REREVIEW` | `RULES_UNAVAILABLE` |
| `STATE_INVALID`, `OUTSIDE_VALIDITY` | `PROFILE_INVALID` | `MAPPING_INVALID` | `RULES_UNAVAILABLE` |
| `SOURCE_INCOMPLETE`, `APPROVER_MISSING` | `PROFILE_SOURCE_INCOMPLETE` | `MAPPING_INVALID` | `RULES_UNAVAILABLE` |
| `INTEGRITY_MISMATCH` | `PROFILE_INVALID` | `MAPPING_UNDER_REREVIEW` | `RULES_UNAVAILABLE` |

- 매핑은 후보가 여럿일 수 있어 위 표의 코드는 후보 하나의 코드다. 줄에 기록되는 코드는 `resolveMapping`이 고른다(DD-03: 사용 가능한 후보 개수 → 고정 우선순위).
- 위 표는 `isUsable`의 사유에서 나오는 보류 코드만 다룬다. DD-03 표의 나머지 보류 코드 여섯(`MAPPING_ABSENT`, `MAPPING_GROUP_NOT_IN_PROFILE`, `CLASSIFICATION_NEEDS_REVIEW`, `PROFILE_FORMULA_UNSUPPORTED`, `PROFILE_VALUE_MISSING`, `PROFILE_VALUE_INVALID`)는 줄·그룹 단계에서 나오며 이 표에 없는 것이 맞다.
- 묶음 사유 → 보류 코드(묶음 단위 선행 판정, `isBundleUsable`):

| 묶음 사유 | 보류 코드 | 범위 |
|-----------|-----------|------|
| `SCOPE_ABSENT` (`bundle = null`) | `CLINIC_RULE_SCOPE_ABSENT` | 모든 줄 |
| `BUNDLE_SUSPENDED` (`bundle.status = SUSPENDED`) | `RULE_BUNDLE_SUSPENDED` | 모든 줄. 전체가 `ON_HOLD`이므로 서류는 null |

- 묶음 단위 선행 판정: 규칙 묶음의 가용성(`RuleBundleSnapshot.status`)은 묶음에 든 항목을 보기 전에 먼저 본다. `SUSPENDED`이면 `BUNDLE_SUSPENDED`이고 보류 코드는 `RULE_BUNDLE_SUSPENDED`다. 이 판정은 항목의 상태를 읽지도 바꾸지도 않으며 항목 판정을 호출하지도 않는다(DD-14, DD-17). 버전 id와 내용 해시가 같아도 사용 가능으로 보지 않는다.
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

- 병원에 규칙 사용 범위가 없거나, 범위가 가리키는 규칙 묶음이 중지(`SUSPENDED`)되었거나, 프로필을 쓸 수 없거나(칸에 기록이 없음·사용 불가·구조 결함 포함, DD-02) 하면 모든 줄이 해당 코드로 `ON_HOLD`다. 묶음 중지는 병원 결제액을 숫자로 둔 채 모든 줄을 `RULE_BUNDLE_SUSPENDED`로 보류하고 서류를 null로 두며, 버전이 같아도 HTTP 200 결과다(DD-14).
- 줄·매핑·분류 사유는 그 줄만 `ON_HOLD`다. 그 줄은 어느 그룹에도 넣지 않는다.
- 그룹 공식이나 값에 문제가 있으면(값 누락·무효·계산 범위 초과 포함, DD-24) 그 그룹의 줄만 `ON_HOLD`이고 그룹 상태도 `ON_HOLD`다.
- 보류가 하나라도 있으면 전체가 `ON_HOLD`이며 예상 보험금과 수령 후 부담은 null이고, 예상 병원 결제액은 그대로 보인다.
- options 엔드포인트는 승인된 프로필이 없다는 이유로 세대나 보험사 형태 카드를 숨기지 않는다. 세대 카드 5장과 보험사 형태 카드 3장은 항상 나온다. 규칙 묶음이 중지(`SUSPENDED`)여도 카드는 5 / 3 / 3(원인 카드 3장 포함) 그대로이며, 중지 사실은 `ruleBundleStatus`로만 알린다(DD-19).

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
  treatments: Array<{ documentFlags: PublishedLine['documentFlags'] }>;   // 선택한 치료 전부(중복 제거 뒤). 확인된 제외 줄도 포함하고 공통 기본비용 줄은 넣지 않는다
  clinicSetting: 'OUTPATIENT_ONLY';
  ruleSet: DocumentRuleSet | null;    // 사용 가능한 규칙 묶음 안에서 isUsable을 통과한 서류 규칙 묶음, 아니면 null (DD-04)
}): DocumentsResult | null;

interface DocumentRule {
  documentCode: DocumentCode;
  when: { cause?: 'INJURY' | 'ILLNESS'; setting?: 'OUTPATIENT' | 'INPATIENT';
          insurerType?: InsurerType; imaging?: true; biopsy?: true; opinionRequired?: true };
  reason: string;     // 한 줄 사유 (환자용 문장)
  priority: number;   // 작을수록 먼저. 0 이상의 안전 정수(아래 "규칙 평가" 9번)
}
type DocumentsResult =
  | { state: 'AVAILABLE'; mode: 'SINGLE_CAUSE' | 'UNKNOWN_CAUSE';
      lines: Array<{ line: DocumentLineKey; required: boolean; scope?: 'COMMON' | 'INJURY_ONLY' | 'ILLNESS_ONLY'; reasons?: string[] }>;   // 사유는 우선순위 순이며 서로 다른 것만 담는다(아래 `COMMON` 줄 규칙)
      ruleSetId: string; ruleSetVersion: string; origin: Origin }
  | { state: 'RULES_UNAVAILABLE' };
```

- 반환: `overallState = ON_HOLD`이면 null; 그렇지 않고 `ruleSet = null`이면 `{ state: 'RULES_UNAVAILABLE' }`; 그 밖에는 `AVAILABLE`.
- 10종 코드를 고정 9줄로 보인다. `RECEIPT_AND_ITEMIZED` 줄은 조건과 무관하게 항상 `required: true`다(기획서 §4). 다른 줄은 그 줄을 이루는 코드에 맞는 규칙이 있을 때 필요다.
- 줄마다 우선순위가 가장 높은 맞는 규칙 하나가 사유를 준다(맞는 규칙의 판정과 우선순위 동률은 아래 "규칙 평가"가 정한다). 필요 없는 줄은 체크 없이 흐리게 보인다. 원인 `UNKNOWN`의 `COMMON` 줄은 두 평가의 사유가 다르면 아래 규칙대로 서로 다른 사유를 모두 가진다.
- 규칙은 데이터이며 프로필과 같은 생명주기·출처·승인을 거친다(DD-17). 기획서 §4의 조건부 매핑 예시는 `TEST_FIXTURE`로만 존재하고 "검증 필요" 표시를 단다. 운영 서류 규칙은 아직 없으며 보류 자료다(plan.md §E.1).
- 결과는 나왔지만 규칙 묶음을 쓸 수 없으면(준비 상태에서는 `documentReady`가 `NOT_READY`일 뿐 `calculationReady`는 그대로, DD-23) 서류 화면은 서류 목록 대신 안내 문구를 보이고, 기획서 §4의 서류 화면 동작 "결과로 돌아가기"·"이용 완료"와 공통 "처음으로"는 그대로 둔다(잠정, plan.md §E #18). 결과 화면의 여섯 동작도 그대로 둔다.
- 원인 `UNKNOWN`: 같은 입력을 `INJURY`와 `ILLNESS`로 각각 평가한다. 두 평가에서 필요 여부가 같은 줄은 `COMMON`, 한쪽에서만 필요하면 `INJURY_ONLY` 또는 `ILLNESS_ONLY`다. 원인을 하나로 고르지 않는다.
- `7 + 1 + 1`은 규칙이 아니라 디자인 예시다(`K07_Documents_Unknown`, 기획서 §4: 공통 7줄 + 초진기록지 + 진단서). 예시 fixture에서는 공통 7줄 + 초진기록지(`INJURY_ONLY`) + 진단서(`ILLNESS_ONLY`)가 나오지만, 실제 줄 수는 평가된 규칙에서 나오며 실제 서류 요건은 아직 확정되지 않았다(보류-06). 상해 전용·질병 전용 줄의 수는 어느 쪽으로도 제한하지 않는다.
- 줄은 세 범위(`COMMON` / `INJURY_ONLY` / `ILLNESS_ONLY`) 가운데 정확히 한 곳에 한 번만 나온다. 고정 9줄 가운데 빠지는 줄도, 두 번 나오는 줄도 없다. 두 평가 모두에서 필요하지 않은 줄은 `COMMON`에 필요 없음으로 둔다.
- `COMMON` 줄의 두 평가가 서로 다른 사유를 내면 결과는 서로 다른 사유를 모두 규칙 우선순위 순으로 유지하고(우선순위가 같으면 상해 평가의 사유가 먼저, SPEC 제안) 화면이 그 사유를 보인다. 두 평가의 사유가 같으면 사유는 하나다. 원인 하나를 가정해 사유를 고르지 않는다.
- 서류 규칙 묶음의 게시 검증은 구조만 본다(REQ-DATA-005): 문서 코드가 닫힌 10종 안에 있는지, 모든 규칙에 `documentCode`·`when`·`reason`·`priority`가 있는지, 고정 9줄의 표시 줄 키를 모두 해석할 수 있는지, 출처·약관 출처·승인자·내용 해시가 있는지, 그리고 `when`이 아래 "규칙 평가"의 계약(알 수 없는 키 없음, 열거 안의 값, 플래그는 `true`만)을 지키고 `priority`가 0 이상의 안전 정수인지(9번). 전용 줄의 개수는 게시 거절 사유가 아니며 규칙 평가 결과를 따른다.
- 공간 처리는 표시의 문제이지 데이터 한도가 아니다. SPEC 제안(최종 선택은 M6, plan.md §E #19의 배치 질문): 줄이 한 화면에 들어가지 않으면 분기별 묶음을 세로로 쌓거나 열을 늘리고, 그래도 들어가지 않으면(가로형, 큰 글자 보기) 큰 글자 보기의 나눔(DD-12)과 같이 "이전 목록 / 다음 목록"으로 나누되 선택·체크·사유를 유지하고 어떤 줄도 빼지 않는다.

### 규칙 평가 (`when` 의미, SPEC 결정)

`when`의 키는 `cause`, `setting`, `insurerType`, `imaging`, `biopsy`, `opinionRequired` 여섯이 전부다. `deriveDocuments`는 순수 함수이며 아래 아홉 가지로 규칙을 평가한다. 같은 입력이면 규칙 배열과 치료 배열의 순서와 관계없이 같은 결과를 낸다(AC-007j·k·l).

1. **규칙 안은 AND, 빠진 키는 와일드카드.** `when`에 적힌 조건이 모두 맞아야 그 규칙이 맞는다. 적히지 않은 키는 제약이 없다. `when: {}`는 어떤 입력에서도 맞는다. `imaging`·`biopsy`·`opinionRequired`는 값 `true`만 쓸 수 있고 "선택한 치료 가운데 그 표시를 가진 치료가 하나 이상 있다"는 뜻이다. `false`나 다른 값은 유효하지 않다(9번).
2. **규칙 사이는 OR.** 한 줄은 그 줄로 가는 규칙(3번) 가운데 하나라도 맞으면 필요하다. `RECEIPT_AND_ITEMIZED`는 규칙과 무관하게 항상 필요하며, 사유는 다른 줄과 같이 맞는 규칙 가운데 우선순위가 가장 높은 규칙의 사유 하나이고(7번) 맞는 규칙이 없으면 사유가 없다. 사유 없이 필요한 줄은 이 줄뿐이다.
3. **규칙 → 줄.** `RECEIPT`와 `ITEMIZED_STATEMENT`는 `RECEIPT_AND_ITEMIZED`로, 나머지 `documentCode`는 같은 이름의 줄로 간다.
4. **플래그 집계.** 선택한 치료(중복 제거 뒤)의 `documentFlags`를 플래그마다 OR로 합친다. 확인된 제외로 판정된 치료도 포함한다. 함수 입력에는 줄 상태가 없고, 제외된 치료에 청구 서류가 필요한지는 SPEC이 추측하지 않으며 서류 규칙 데이터의 몫이기 때문이다(보류-06). 자동으로 더해진 공통 기본비용 줄은 합치지 않는다.
5. **`insurerType`, `setting`.** `insurerType`은 환자가 고른 보험사 형태(세 값)와 같을 때 맞는다. `setting`은 입력 `clinicSetting = 'OUTPATIENT_ONLY'`를 `OUTPATIENT`로 평가한다. `setting: 'INPATIENT'`인 규칙은 이 MVP에서 맞는 일이 없다(입원은 범위 밖). 데이터에는 둘 수 있고 아무 효과가 없다.
6. **`cause`.** `SINGLE_CAUSE`는 환자의 원인으로 한 번 평가한다. `UNKNOWN_CAUSE`는 `INJURY`와 `ILLNESS`로 두 번 평가하며, 이 규칙의 1~5번과 7번이 두 평가 각각에 적용된다. 고정 9줄, 세 범위(`COMMON` / `INJURY_ONLY` / `ILLNESS_ONLY`)에 줄이 한 번씩, `COMMON` 줄의 서로 다른 사유 유지, 우선순위가 같을 때 상해 평가의 사유가 먼저라는 위의 설명은 그대로다.
7. **사유 선택과 동률.** 한 평가에서 한 줄로 가는 맞는 규칙이 여럿이면 `priority`가 작은 규칙의 `reason`이 그 줄의 사유다. `priority`가 같으면 `reason` 문자열의 유니코드 코드 포인트 순에서 앞선 것이 이긴다(UTF-16 코드 유닛 순이 아니다). 우선순위와 사유가 모두 같으면 어느 규칙이든 같은 출력이다. 이 키(우선순위 오름차순, 그다음 사유의 코드 포인트 순)가 DD-03 "출력 순서와 순서 독립"이 서류 규칙의 동률에 대해 DD-06에 맡긴 키다.
8. **순서 독립.** `ruleSet.rules`와 `treatments`의 순서를 바꿔도 결과가 같다. 규칙의 배열 위치로 승자를 가리는 단계가 없다.
9. **게시 검증 추가 항목(REQ-DATA-005, AC-007f).** 위의 구조 검사에 더해 `when`이 객체가 아님, 알 수 없는 키, 열거 밖의 `cause`·`setting`·`insurerType` 값, `true`가 아닌 `imaging`·`biopsy`·`opinionRequired` 값(`false` 포함), 0 이상의 안전 정수가 아닌 `priority`를 거절한다. 어긋난 규칙 경로(예: `rules[3].when.imaging`)를 함께 알리고 아무것도 저장하지 않는다.

## DD-07 화면 상태 기계

### 상태

| 상태 | 디자인 프레임 (이름·ID) | 비고 |
|------|-------------------------|------|
| `K00_Start` | `K00_Start` (u5CZTt) | 환자 데이터 없음, 타이머 없음. 병원명과 서비스 표시명(공통 브랜드 설정, 기본 "보담") |
| `K01_Generation` | `K01_Generation_Empty` (Z3izyJ) / `K01_Generation_Selected` (lYlRt), 가로형 `L_K01_Generation` (xeW3n) | 1/4 |
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

- 화면 방향(세로 1080×1920 / 가로 1920×1080, 임시 검토 크기)과 큰 글자 보기는 같은 상태의 표시 변형이며 별도 상태가 아니다. 둘은 표시 설정이라 복귀 정보에 들어가지 않고(DD-11), 바뀌어도 계산 요청을 보내지 않는다.
- `K04_Result_Hold`의 내용(SPEC 결정): 예상 병원 결제액만 숫자로 보이고, 예상 보험금과 수령 후 부담 자리에는 "확인 필요"를 보인다. 보류 줄은 환자용 사유 분류(DD-21)로 묶어 보이고 내부 코드는 보이지 않는다. 참고 그룹 값은 보이지 않는다. 기획서 §4의 결과 문구 원칙("표준 공제·한도 가정으로 계산한 예상 금액입니다. …")은 계산하지 않았으므로 쓰지 않는다. 공통 안내 가운데 개인 계약 조건 문장 "개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다."만 쓰고, 보류 안내 문구의 최종 표현과 이 문장 선택은 plan.md §E #23, #24의 확인 대상이다. 동작은 "치료 다시 선택 / 보험 조건 수정 / 처음으로 / 이용 완료" 넷이며, 서류 확인과 계산 근거 버튼은 없다. 공통 컴포넌트로 구성하며 새 Pencil 프레임을 요청하지 않는다.
- "다음"은 1-3단계에서 선택이 있을 때만, "예상 부담액 확인"은 치료가 1개 이상일 때만 활성이다.
- "처음으로"(제안, 승인 전, plan.md §E #36. SPEC 해석이며 소유자가 확인한 결정이 아니다). 기획서 §13.2의 "진행 중에는 종료 확인"에서 "진행 중" = 환자 입력이 하나 이상으로 읽는다. 눌린 자리에 따라 둘로 나눈다.
  - 일반 환자 화면(겹침창이 없을 때): 세션에 환자 입력(세대·형태·원인·치료 가운데 하나라도)이 있으면 `ResetConfirm`을 먼저 띄우고(확인 ⇒ 지움 ⇒ `K00_Start`, 취소 ⇒ 그대로), 하나도 없으면 바로 `K00_Start`로 간다.
  - `TimeoutDialog` 안: `ResetConfirm` 없이 바로 지우고 `K00_Start`로 간다. 경고창 자체가 확인 단계이고 초기화 시점은 어차피 다가오므로, 그 위에 두 번째 겹침창을 쌓으면 확인창 밑에서 무조작 초기화 시점이 지나갈 수 있다. 환자 입력이 있어도 같다.
  - 디자인 인계표의 `K04_Result_Dialog_Timeout` 행(셀 `tNbyp`: "처음으로 · 무응답 시 180초에 초기화")은 이 구분과 어긋나지 않는다. 그 셀은 확인창을 말하지 않는다.
- 겹침창 규칙(제안, 승인 전, §E #36과 같은 확인 대상): 겹침창은 동시에 하나만 열린다. `ResetConfirm`이 열린 채 경고 시점이 되면 `ResetConfirm`을 닫고 `TimeoutDialog`를 연다(선택값은 그대로, "계속 사용할게요"는 `ResetConfirm` 아래의 화면으로 돌아간다). `ResetConfirm`을 열어 둔 시간은 초기화 시점을 늦추지 않는다. 환자의 터치는 다른 화면과 같이 무조작 시간을 다시 세게 한다(DD-10).
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
| `K03_Treatments` | "예상 부담액 확인" | 치료 1개 이상 | `Calculating` | 이전 활성 요청이 있으면 먼저 `settleRequest(…, CANCELLED)`로 정리한 뒤, 새 `requestId`를 만들어 `activeRequest`로 기록하고 그 시도의 시간 제한 타이머를 시작(DD-09 "요청 생명주기") |
| `Calculating` | 200, `ESTIMATED` | 활성 `requestId` 일치 | `K04_Result` | `settleRequest(…, SUCCEEDED)`로 활성 요청·시간 제한 타이머·로딩 표시를 풀고 결과 저장 |
| `Calculating` | 200, `ESTIMATED_WITH_EXCLUSIONS` | 활성 `requestId` 일치 | `K04_Result_NotCovered` | 같음(`SUCCEEDED`) |
| `Calculating` | 200, `ON_HOLD` | 활성 `requestId` 일치 | `K04_Result_Hold` | 같음(`SUCCEEDED`) |
| `Calculating` | 4xx(409 포함)·5xx·시간 초과·연결 실패 | 활성 `requestId` 일치 | DD-19 클라이언트 처리 표 | `settleRequest`가 먼저 활성 요청과 타이머를 풀고(409 `VERSION_MISMATCH`, 422 거절 둘, 그 밖의 `FAILED`, 시간 초과 `EXPIRED`) 그다음 표에 따라 화면을 바꾼다. `EXPIRED`는 그 시도의 요청을 취소하므로 뒤늦게 온 결과가 반영되지 않는다 |
| `Calculating` | 응답·오류·시간 초과(어느 종류든) | 활성 `requestId` 불일치(`activeRequest`가 없거나 다른 시도) | (버림) | 없음. 상태·결과·로딩 표시·화면을 건드리지 않음 |
| `Calculating` | 초기화(처음으로·이용 완료·무조작 초기화·새로고침)나 입력 변경 | — | 각 동작의 도착지 | 먼저 `settleRequest(…, CANCELLED)`(DD-09). 그 뒤 그 동작의 전이를 실행 |
| `K04_Result`, `K04_Result_NotCovered` | "보험 청구에 필요한 서류 확인" | 원인 `INJURY`/`ILLNESS` | `K07_Documents` | 복귀 정보(결과 종류) 기록 |
| 〃 | 〃 | 원인 `UNKNOWN` | `K07_Documents_Unknown` | 복귀 정보(결과 종류) 기록 |
| `K04_Result`, `K04_Result_NotCovered` | "계산 근거 보기" | — | `K04_Basis_Calculation` | 복귀 정보(결과 종류) 기록 |
| 결과 3종(`Hold` 포함) | "치료 다시 선택" | — | `K03_Treatments` | 유지 |
| 결과 3종 | "보험 조건 수정" | — | `K01_Generation` | 유지 |
| 일반 환자 화면(겹침창 없음) | "처음으로" | 환자 입력이 있음 | `ResetConfirm` 겹침창 (제안, 승인 전, §E #36) | 유지 |
| 일반 환자 화면(겹침창 없음) | "처음으로" | 환자 입력이 없음 | `K00_Start` | 전체 삭제 |
| `ResetConfirm` | 확인 | — | `K00_Start` | 전체 삭제 |
| `ResetConfirm` | 취소 | — | 직전 화면 | 유지 |
| `ResetConfirm` | 무조작 경고 시점 | — | `TimeoutDialog` (`ResetConfirm`은 닫음. 제안, 승인 전, §E #36) | 유지. 초기화 시점은 `ResetConfirm`을 열어 두었다고 늦춰지지 않음 |
| 결과 3종, 근거, 서류 | "이용 완료" | — | `K06_Complete` | 먼저 전체 삭제 |
| `K04_Basis_Calculation`, `K07_*` | "결과로 돌아가기" | — | 복귀 정보의 결과 종류(`resultVariant`)의 결과 화면. 세로형·가로형 변형과 큰 글자 보기는 복귀 시점의 최신 표시 설정을 따름(DD-11) | 유지 |
| `KXX_Error_Network` | "다시 시도" | — | `Calculating` | 같은 `inputRevision`로 새 `requestId`의 새 요청(이전 시도는 만료된 채로 남아 반영되지 않음) |
| `KXX_Error_Network` | "이용 종료" | — | `K06_Complete` | 먼저 전체 삭제 (잠정, plan.md §E #20) |
| `K06_Complete` | "처음 화면으로" 또는 `completionHoldSeconds` 경과 | — | `K00_Start` | 없음(이미 비어 있음) |
| 환자 데이터 화면 | 무조작 경고 시점 | — | `TimeoutDialog` 겹침창 (겹침창은 동시에 하나만, 위 `ResetConfirm` 행) | 유지 |
| `TimeoutDialog` | "계속 사용할게요" | — | 직전 화면(겹침창 아래의 화면) | 유지, 무조작 시간 다시 시작 |
| `TimeoutDialog` | "처음으로" | 환자 입력이 있든 없든 | `K00_Start` | 전체 삭제. `ResetConfirm` 없이 즉시(제안, 승인 전, §E #36) |
| `TimeoutDialog` | 초기화 시점 | 경고 뒤 연장 없음 | `K00_Start` | 전체 삭제 |
| 모든 상태 | 큰 글자 전환 | — | 같은 상태 | 유지. 표시 설정만 바뀌며 근거·서류 화면에서도 그 화면에 머문다 |
| 모든 상태 | 화면 방향 변경 | — | 같은 상태 | 유지. 표시 변형만 바뀌며 계산 요청을 보내지 않는다 |
| 모든 상태 | 새로고침, 뒤로·앞으로, 페이지 캐시 복원 | — | `K00_Start` | 전체 삭제 |

## DD-08 입력 변경과 파생 데이터 무효화

규칙: 확정된 입력값(세대, 보험사 형태, 치료 원인, 치료 묶음) 가운데 하나라도 다른 값으로 바뀌면 파생 데이터(`EstimateResult`, `Documents`, `BasisView`, `ReturnContext`) 전부를 즉시 지우고 `inputRevision`을 1 올린다. 같은 값을 다시 고르면 아무 일도 없다. 페이지 이동, 이전·다음 이동, 큰 글자 전환, 화면 방향 변경은 입력 변경이 아니다. 표시 설정(큰 글자 보기, 관찰한 화면 방향)은 파생 데이터가 아니다. 바뀌어도 선택·`EstimateResult`·`Documents`·`BasisView`·`ReturnContext`·`inputRevision`·금액은 그대로이고 계산 요청도 보내지 않는다. 새 결과는 "예상 부담액 확인"을 다시 눌러야 나온다. 치료 원인만 바꾼 뒤 다시 확인하면 금액은 같고(DD-01) 서류 목록만 새로 산출된다.

| 동작 | 세대 | 형태 | 원인 | 치료 | 파생 데이터 | ReturnContext | 큰 글자 | 무조작 시간 |
|------|------|------|------|------|-------------|---------------|---------|-------------|
| 세대를 다른 값으로 | 변경 | 유지 | 유지 | 유지 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 형태를 다른 값으로 | 유지 | 변경 | 유지 | 유지 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 원인을 다른 값으로 | 유지 | 유지 | 변경 | 유지 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 치료 추가·해제 | 유지 | 유지 | 유지 | 변경 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 같은 값 다시 선택 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 다시 시작 |
| 목록 페이지 이동, 이전·다음 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 다시 시작 |
| 큰 글자 전환 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 전환 | 다시 시작 |
| 화면 방향 변경 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 유지 | 그대로(터치·키 입력이 아니므로 다시 시작하지 않음) |
| 근거·서류 진입 | 유지 | 유지 | 유지 | 유지 | 유지 | 기록(결과 종류만) | 유지 | 다시 시작 |
| 결과로 돌아가기 | 유지 | 유지 | 유지 | 유지 | 유지 | 사용 후 유지(결과 종류만 복원) | 유지 | 다시 시작 |
| 409 버전 불일치 처리 | 유지 | 유지 | 유지 | 게시 중인 것만 유지 | 삭제 | 삭제 | 유지 | 다시 시작 |
| 처음으로·이용 완료·무조작 초기화·새로고침 | 삭제 | 삭제 | 삭제 | 삭제 | 삭제 | 삭제 | 꺼짐(잠정) | 정지 |

근거·서류 화면 안에서 큰 글자 보기나 화면 방향이 바뀌면 그 화면에 머물고, 바뀐 값은 "결과로 돌아가기" 뒤에도 남는다. "결과로 돌아가기"가 복원하는 것은 결과 종류뿐이다(DD-11). 여기서 표시 설정을 "그대로 유지"한다는 말은 초기화하거나 잃지 않는다는 뜻이며, 진입 때의 값으로 되돌린다는 뜻이 아니다.

## DD-09 세션 보호와 복원 금지

- 세션은 메모리 저장소에만 둔다(기획서 §8). 초기화마다 `sessionId`를 새로 만든다(기획서 §13.2 "세션 식별자 교체").
- 계산 시도마다 새 `requestId`를 만든다(SPEC 결정). 키오스크 안에서만 쓰는 값이며 `crypto.randomUUID()`로 만들고 메모리에만 두며 저장·로그·URL·분석 이벤트에 남기지 않고 서버로도 보내지 않는다(서버는 요청 본문의 다른 필드를 읽지 않는다, REQ-API-002). 키오스크 상태는 `activeRequest: { requestId, sessionId, inputRevision, controller, timeoutHandle } | null`을 가지며, 취소 수단으로 `AbortController`를, 그 시도의 클라이언트 시간 제한(plan.md §E #21)을 재는 타이머 핸들(`timeoutHandle`)을 붙인다(SPEC 결정: 기획서는 "요청 취소"만 요구).
- 보호 규칙: 200 결과, 4xx·5xx 오류, 409, `NO_TREATMENT_SELECTED`·`TREATMENT_NOT_PUBLISHED` 처리, 연결 실패, 클라이언트 시간 초과 등 모든 결말은 `activeRequest !== null`이고 `activeRequest.requestId`가 그 결말의 `requestId`와 같을 때만 반영한다(방어를 겹쳐 `sessionId`와 `inputRevision`이 지금 값과 같은지도 본다). 아니면 상태·결과·로딩 표시·화면을 건드리지 않고 버린다. 이 보호는 `AbortController`와 별개이며 그 위에 더하는 것이다. 취소가 이미 날아온 응답을 막지 못할 수 있기 때문이다.
- `activeRequest`를 null로 하고 `controller`를 취소하는 경우(모두 아래 "요청 생명주기"의 `settleRequest`를 거친다): "처음으로"·"이용 완료"·무조작 초기화·새로고침(새 `sessionId`)으로 초기화할 때, 입력이 바뀔 때(`inputRevision` +1), 요청이 만료될 때(클라이언트 시간 초과 → 전송 상태 `FAILED` → `KXX_Error_Network`이며, 만료된 시도는 나중에 도착해도 반영되지 않는다), 새 시도가 이를 대체할 때("다시 시도"나 새 "예상 부담액 확인"은 새 `requestId`를 만들고 이전 시도를 취소한다).
- 로딩 상태는 활성 요청에만 속한다. 이전 시도의 늦은 결과는 로딩 표시를 끄거나, 오류 화면을 띄우거나, 새 시도의 결과 화면을 여는 일을 할 수 없다.
- 위 보호는 "늦게 오는 이전 시도"를 막는다. 현재 시도가 끝났을 때 그 시도가 남기는 것(활성 요청, 시간 제한 타이머, 로딩 표시, 컨트롤러)을 치우는 규칙은 아래 "요청 생명주기"가 따로 정한다.

### 요청 생명주기 (SPEC 결정)

계산 시도 하나는 정확히 하나의 결말로 끝난다.

| 결말 | 어떤 일 | 화면 처리 |
|------|---------|-----------|
| `SUCCEEDED` | 200 (`ESTIMATED` / `ESTIMATED_WITH_EXCLUSIONS` / `ON_HOLD`) | 결과 3종 (DD-07) |
| `VERSION_MISMATCH` | 409 | 버전 불일치 흐름 (DD-14, DD-19) |
| `REJECTED` | 422 `NO_TREATMENT_SELECTED` / `TREATMENT_NOT_PUBLISHED` | DD-19 클라이언트 처리 표의 해당 행 |
| `FAILED` | 그 밖의 4xx, 5xx, 연결 실패 | `KXX_Error_Network` |
| `EXPIRED` | 클라이언트 시간 제한 도달 (plan.md §E #21) | `KXX_Error_Network` (전송 상태 `FAILED`) |
| `CANCELLED` | 초기화(처음으로·이용 완료·무조작 초기화·새로고침)·입력 변경·새 시도로 대체 | 없음. 호출한 동작이 자기 전이를 실행한다 |

모든 결말은 **함수 하나** `settleRequest(requestId, outcome)`를 거친다. 다른 경로로 `activeRequest`를 null로 하거나 화면을 바꾸거나 로딩 표시를 끄지 않는다.

1. `activeRequest`가 null이거나 `activeRequest.requestId !== requestId`이면 버리고 아무것도 바꾸지 않는다(위 보호 규칙).
2. 아니면 다음을 한 번에 풀고 나서 3으로 간다: `activeRequest = null`, 그 시도의 `timeoutHandle`을 `clearTimeout`으로 치움, 로딩 표시를 끔, 컨트롤러를 버림. 컨트롤러는 `EXPIRED`와 `CANCELLED`에서만 `abort()`한다. 이미 끝난 요청(`SUCCEEDED`·`VERSION_MISMATCH`·`REJECTED`·`FAILED`)은 취소할 것이 없다.
3. 그다음에 결말에 따른 화면 전이(위 표)를 실행한다. 어느 결말도 2를 건너뛰지 않는다.

이어지는 규칙:

- 어떤 결말 뒤에도 그 시도의 시간 제한 타이머가 대기 중으로 남아서는 안 된다. 성공한 시도의 타이머가 나중에 돌아 결과 화면을 `KXX_Error_Network`로 바꾸는 일은 결함이다. 타이머 콜백이 어떤 이유로 뒤늦게 실행되더라도 콜백은 자기 `requestId`가 `activeRequest.requestId`와 같은지 먼저 확인하고 다르면 아무것도 하지 않는다(1단계와 같은 확인).
- 새 시도는 이전 활성 요청이 있으면 `settleRequest(이전 requestId, CANCELLED)`를 먼저 부른 뒤에 새 `activeRequest`와 새 타이머를 만든다. 그래서 대기 중인 요청 타이머는 활성 요청의 것 하나뿐이거나 없다.
- 무조작 타이머(DD-10)는 별개다. `settleRequest`는 무조작 타이머를 시작하지도 멈추지도 않는다.
- 409 `VERSION_MISMATCH`와 422 `TREATMENT_NOT_PUBLISHED`의 후속 조치(catalog·options를 다시 받는 일, DD-14·DD-19)는 요청을 정리한 뒤에 시작하며, 다시 받은 결과는 후속 조치를 시작할 때 잡아 둔 `sessionId`와 `inputRevision`이 지금 값과 같을 때만 반영한다. 그 사이에 초기화나 입력 변경이 있었으면 결과를 버린다(요청 보호와 같은 계열의 보호).
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

- 환자의 터치·키 입력마다(결과·근거·서류 사이 이동 포함) 무조작 시간을 0초부터 다시 센다. 서버 응답과 내부 갱신은 시간을 연장하지 않는다. 무조작 타이머는 계산 요청의 시간 제한 타이머(DD-09)와 별개이며, 요청을 정리(`settleRequest`)해도 무조작 타이머를 다시 시작하거나 멈추지 않는다.
- 경고는 같은 `TimeoutDialog`를 현재 화면 위에 띄우며 남은 시간, "계속 사용할게요", "처음으로"를 보인다. `TimeoutDialog` 안의 "처음으로"는 `ResetConfirm` 없이 바로 지우고 `K00_Start`로 간다(제안, 승인 전, plan.md §E #36. 일반 화면의 "처음으로"는 DD-07). 겹침창은 동시에 하나만 열려, `ResetConfirm`이 열린 채 경고 시점이 되면 `ResetConfirm`을 닫고 `TimeoutDialog`를 연다. "계속 사용할게요"는 반복할 수 있고 누를 때마다 시간을 다시 센다. 배경은 실제 화면 그대로이므로 결과 화면이면 여섯 동작이 모두 남아 있다(디자인 차이 13-2 해결).
- 초기화 도착지는 `K00_Start`다. 결과 화면으로 돌아가지 않고 `K06_Complete`를 거치지 않는다.
- 병원 관리자가 병원별로 바꿀 수 있다(기획서 §7). 저장 검증(잠정, SPEC 결정): 경고 < 초기화, 초기화 − 경고 ≥ 20초. 20초는 기획서 §13.2와 tech.md §5의 기본값 "초기화 20초 전에 경고"에서 왔고, 이를 저장 하한으로 삼은 것은 이 SPEC의 결정이다(plan.md §E #16). 이 하한은 무조작 정책에만 적용하며 `completionHoldSeconds`에는 적용하지 않는다.
- 읽는 길(SPEC 결정): 키오스크는 화면 종류별 경고·초기화 시간과 `completionHoldSeconds`를 `GET /api/clinics/{slug}/catalog` 응답의 `idlePolicy`에서 읽는다(DD-19). 병원이 정책을 저장하지 않았으면 위 표의 값을 쓴다. 저장은 관리자 API(`PUT …/idle-policy`), 읽기 함수와 기본값은 M3의 `IdlePolicy` 저장소다(AC-015i).
- 기획서 §7의 "결과 화면 유지 시간"은 결과 화면류의 경고·초기화 시간으로 해석한다(research.md §5 모순 7, plan.md §E #26).

## DD-11 복귀 정보 (ReturnContext)

```ts
interface ReturnContext { resultVariant: 'NORMAL' | 'NOT_COVERED' }   // 어느 결과로 돌아갈지만 담는다
interface DisplayPrefs { largeText: boolean }                           // 세션 수준 표시 설정
// 화면 방향(세로 1080×1920 / 가로 1920×1080)은 그릴 때 기기·뷰포트에서 읽는 관찰 값이며 저장하지 않는다
```

- 계산 근거·서류 화면에 들어갈 때 `resultVariant`만 기록한다. "결과로 돌아가기"는 `ReturnContext`에서 결과 종류를 복원하고, 세로형(`K04_Result`)·가로형(`L_K04_Result`) 배치와 큰 글자 모드는 복귀 시점의 최신 표시 상태(`DisplayPrefs`와 관찰한 방향)로 그린다. 그래서 근거·서류 화면에서 큰 글자 보기나 화면 방향을 바꾸면 복귀한 뒤에도 그 값이 남는다. 결과·선택은 바뀌지 않는다.
- 표시 설정 변경은 파생 데이터를 지우지 않고 계산 요청을 보내지 않는다(DD-08). 큰 글자 보기는 세션 초기화 때 꺼진다(잠정, DD-12).
- 계산 근거 화면은 (`EstimateResult`, `resultVariant`)의 순수 함수로 그린다. `NOT_COVERED`에서 들어오면 제외 항목과 사유를 보인다. 결과 종류별 전용 근거 프레임을 요청하지 않는다(디자인 차이 13-1을 공통 규칙으로 해결).
- 키오스크는 외부 웹 링크를 열지 않는다. 약관 출처는 근거 상세에 문자로만 보인다.

## DD-12 큰 글자 보기

- 같은 화면, 같은 흐름, 같은 계산이다. 바뀌는 것은 글자 크기, 버튼·터치 영역 크기, 카드·금액 배치뿐이다.
- 공간이 모자라면 기능을 빼지 않고 카드 열 수를 줄이거나 세로로 쌓으며, 목록은 "이전 목록 / 다음 목록"으로 나누고 선택을 유지한다(치료 선택은 한 화면 4개에서 2개로 줄이는 것이 디자인 명세의 예, 기획서 §13.1).
- 전환해도 현재 화면과 입력 상태를 유지한다. 결과 화면의 여섯 동작, 서류 9줄과 체크·사유, 원인 모름 분기, 복귀 규칙을 유지한다.
- 계산 근거·서류 화면에서 전환해도 그 화면에 머물고, 켜거나 끈 값은 "결과로 돌아가기" 뒤에도 남는다(DD-11). 화면 방향 변경도 같다. 서류 목록도 공간이 모자라면 같은 방식으로 나누며 줄을 빼거나 겹치지 않는다(DD-06).
- 초기화하면 꺼진다(잠정, plan.md §E #17).
- 검증은 구현된 화면에서 세로 1080×1920·가로 1920×1080(임시 검토 크기) 모두, 실제 Pretendard(대체 순서 Noto Sans KR → 맑은 고딕 → 시스템 산세리프)로 한다. Pencil 화면의 잘림 결과는 근거가 되지 않는다.
- 디자인 조작 규격(기획서 §13.1, 디자인 기준이며 접근성 인증 아님): 주요 버튼 88, 구현 터치 영역 72 CSS px 이상, 카드 120 이상, 본문 24 이상, 제목 36 이상, 결과 숫자 56 이상, 간격 16 이상. 이 가운데 72 CSS px를 통과·실패 기준으로 쓰는 것은 SPEC 결정이다(plan.md §E #29).
- 글자 대비 기준(design-requirements §2.1, 디자인 기준이며 접근성 인증 아님): 일반 글자 4.5:1 이상, 큰 글자(24 px 이상, 또는 굵게 18.66 px 이상) 3:1 이상, 핵심 안내는 가능하면 4.5:1 이상. 예외는 로고, 정보가 없는 장식, 실제로 비활성인 조작 요소의 글자뿐이다.

## DD-13 이용 완료·처음으로·무조작 초기화

| 동작 | 순서 | `K06_Complete` 경유 |
|------|------|---------------------|
| "이용 완료"(결과·근거·서류) | 전체 삭제 → `K06_Complete` → `completionHoldSeconds` 뒤 자동 또는 "처음 화면으로" → `K00_Start` | 예 |
| "처음으로"(일반 환자 화면, 제안 §E #36) | 환자 입력이 있으면 `ResetConfirm` → 확인, 없으면 바로 → 전체 삭제 → `K00_Start` | 아니요 |
| "처음으로"(`TimeoutDialog` 안, 제안 §E #36) | `ResetConfirm` 없이 즉시 → 전체 삭제 → `K00_Start`. 경고창이 이미 확인 단계이고 겹침창은 동시에 하나만 연다 | 아니요 |
| 무조작 초기화 | 경고 → 연장 없음 → 전체 삭제 → `K00_Start` | 아니요 |
| 통신 오류의 "이용 종료" | 전체 삭제 → `K06_Complete` (잠정) | 예 |

`completionHoldSeconds`는 병원별 설정값(양의 정수)이다. 원문 문서가 길이를 정하지 않았으므로("잠시 후", 기획서 §13.2) 기본값은 열린 확인 항목이다(plan.md §E #12, 구현 착수 승인 전에 정함). 키오스크는 이 값을 catalog 응답의 `idlePolicy.completionHoldSeconds`에서 읽으며(DD-19), 저장된 값이 없어 null이면 자동 복귀 없이 "처음 화면으로" 버튼으로만 `K00_Start`에 간다.

## DD-14 버전

- `CatalogVersion`(병원 단위): 게시된 치료 버전 묶음 + 공통 기본비용. 게시할 때마다 새 버전이며, 가격만 바뀐 게시도 변경 이력과 함께 새 버전이다.
- `RuleBundleVersion`(플랫폼 단위): 게시된 프로필·매핑·서류 규칙 묶음의 바꿀 수 없는 스냅샷. 어느 병원이 어느 묶음을 쓰는지는 플랫폼 운영자가 정하는 `ClinicRuleScope`다. 범위가 없는 병원은 묶음이 없고 모든 계산이 `CLINIC_RULE_SCOPE_ABSENT`로 보류된다.
- 병원의 현재 버전은 그 병원의 최신 `CatalogVersion`과 그 병원 `ClinicRuleScope`가 가리키는 `RuleBundleVersion`이다. catalog와 options 응답은 각각 이 두 값을 담는다(DD-19). 두 버전이 현재 값과 같다는 사실은 그 묶음을 쓸 수 있다는 뜻이 아니다. 사용 가능 여부는 묶음의 가용성이 따로 정한다(아래 "규칙 묶음 가용성과 중지").
- 계산 요청은 클라이언트가 본 `catalogVersion`과 `ruleBundleVersion`을 담는다. 경로의 병원 기준 현재 버전과 다르면 HTTP 409 `VERSION_MISMATCH`, 결과 없음. 본문 형식:

```json
{
  "error": "VERSION_MISMATCH",
  "latest": { "catalogVersion": "<string>", "ruleBundleVersion": "<string|null>",
              "ruleBundleStatus": "<ACTIVE|SUSPENDED|null>" },
  "changes": {
    "priceChanged": true,
    "ruleChanged": false,
    "treatmentsUnpublished": ["<treatmentId>"]
  }
}
```

- 클라이언트는 그 병원의 catalog·options를 다시 받고, 아직 게시된 선택은 유지하고, 내려간 치료는 안내와 함께 빼고, 새 합계를 보인 뒤 환자가 다시 확인하게 한다. 옛 값으로 결과를 확정하지 않는다(기획서 §7). 이 처리는 활성 요청(DD-09)의 409에만 한다. 활성 요청이 아닌 이전 시도의 409는 버린다. 다시 받은 catalog·options는 다시 받기를 시작할 때의 `sessionId`와 `inputRevision`이 지금 값과 같을 때만 반영하고, 그 사이에 초기화나 입력 변경이 있었으면 버린다(DD-09 "요청 생명주기").
- 결과는 실제로 쓴 버전, 묶음 가용성(`ruleBundleStatus`), 프로필 id·버전을 되돌려 준다.

### 규칙 묶음 가용성과 중지 (SPEC 결정)

- 내용과 가용성을 나눈다. `RuleBundleVersion`은 바꿀 수 없다(id, 포함한 항목 버전 목록, 내용 해시, 게시자, 게시일). 사용 가능 여부는 별도의 추가 전용 기록 `RuleBundleStatusEvent { bundleId, status: 'ACTIVE' | 'SUSPENDED', actorId, role, at, reason, previousStatus }`로 남긴다. 게시 트랜잭션이 첫 `ACTIVE` 사건을 함께 쓰고, 현재 상태는 가장 마지막 사건이다.
- 중지는 그 묶음 id에서 끝이다. 다시 활성으로 돌리는 동작은 없다(`ACTIVE` 사건을 다시 쓰려는 시도는 거절). 복구는 새 `RuleBundleVersion`을 게시(이전 버전의 사본이거나 고친 판, 위 복구 규칙)하고 플랫폼 운영자가 영향을 받는 병원마다 규칙 사용 범위를 다시 지정(기존 REQ-ADM-004 권한)하는 것이다. 새 권한도 병원별 긴급 중지도 두지 않는다.
- 중지는 묶음 기록만 바꾼다. 묶음에 든 프로필·매핑·서류 규칙 버전의 상태는 그대로이므로, 같은 버전을 담은 다른 묶음은 영향을 받지 않는다. 개별 항목을 중지하는 동작(DD-17 생명주기의 `PUBLISHED → SUSPENDED`)은 별개의 명시 동작이고 그 항목을 담은 모든 묶음에 영향을 준다. 이 SPEC은 항목 중지를 묶음 중지의 수단으로 쓰지 않는다.
- 계산 요청(`POST …/estimate`) 처리 순서: ① 병원 확인 ② 현재 `ClinicRuleScope`와 묶음 스냅샷, 그리고 묶음 상태를 새로 읽음(상태는 캐시하지 않음) ③ `catalogVersion`·`ruleBundleVersion`(묶음 id)을 병원의 현재 값과 비교해 다르면 409(본문 `latest`에 `ruleBundleStatus` 포함) ④ 같으면 계산. 버전이 같아도 묶음이 `SUSPENDED`이면 HTTP 200 `ON_HOLD`다. 모든 줄이 `RULE_BUNDLE_SUSPENDED`, `hospitalPayment`는 숫자, 보험금은 null, `documents`는 null, `versions.ruleBundleStatus = 'SUSPENDED'`이며 409도 4xx도 아니다. 버전이 같다는 사실은 묶음을 쓸 수 있다는 뜻이 아니다.
- `GET …/insurance/options`: `ruleBundleVersion`은 범위의 묶음 id(중지 중에도 같음), `ruleBundleStatus`는 `ACTIVE` | `SUSPENDED` | null(범위 없음)이다. 카드는 5 / 3 / 3 그대로다(DD-05). 응답에 `Cache-Control: no-store`를 붙여(SPEC 결정) 중지가 다음 요청에서 보이게 한다. `ClinicRuleScope`는 중지로 바뀌지 않고 중지된 묶음을 계속 가리킨다.
- 캐시 계약: 가용성은 계산 요청과 options 요청마다 읽는다. 캐시해도 되는 것은 (id, 내용 해시)로 찾는 바뀌지 않는 묶음 내용뿐이다. 구현이 범위→묶음이나 상태의 캐시를 추가하면 중지 사건 기록과 캐시 무효화를 같은 트랜잭션에서 한다. 이미 키오스크 화면에 나온 결과는 소급해서 바꾸지 않는다(환자 세션은 메모리뿐이다). "예상 부담액 확인"을 다시 누르면 보류가 나온다.
- 영향을 받는 병원 = 현재 `ClinicRuleScope`가 중지된 묶음 id를 가리키는 병원이다. 다른 묶음을 쓰는 병원과 지난 범위 이력은 해당하지 않는다. 중지 API(`POST /api/admin/rule-bundles/{id}/suspend`)는 비어 있지 않은 `reason`을 요구하고(없으면 400 `INVALID_REQUEST`), 검토 담당자만 할 수 있으며(병원 관리자·플랫폼 운영자는 403, 인증이 없으면 401), 응답에 `affectedClinics: [{ clinicId, slug }]`를 담는다. 감사 기록에는 수행자·역할·일시·사유·이전/이후 상태·영향을 받는 병원 수를 남긴다.
- 복구 경로: 검토 담당자가 새 묶음 버전을 게시 → 플랫폼 운영자가 영향을 받는 병원마다 범위를 다시 지정 → 옛 버전을 든 클라이언트는 409 `VERSION_MISMATCH`(`ruleChanged: true`)를 받고 새 버전은 정상 계산한다. 중지부터 재지정까지 영향을 받는 병원은 계산 보류를 보인다.

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
- 규칙 묶음 단위의 가용성(`ACTIVE` | `SUSPENDED`, DD-14)은 위 표의 항목 생명주기와 따로 움직인다. 묶음을 중지해도 묶음에 든 프로필·매핑·서류 규칙 버전의 상태(위 표)는 바뀌지 않으며, 같은 버전을 담은 다른 묶음은 계속 쓸 수 있다. 항목 자체의 `PUBLISHED → SUSPENDED`는 별개의 명시 동작이고 그 항목을 담은 모든 묶음에 영향을 준다. 묶음 중지는 검토 담당자만 한다(권한 표의 "규칙 묶음 게시·중지" 칸).
- 플랫폼 운영자의 병원별 긴급 중지는 이 SPEC에 두지 않는다. 기획서 §7 6번이 플랫폼 운영자에게 준 권한은 관리자 소속·역할 관리와 규칙 사용 범위 지정 둘뿐이고 긴급 중지는 원문에 없다. 계획 감사 1회차 뒤 요구사항에서 뺐으며 그 제거를 승인한 기록은 없다. 개정 4 요청에서 사용자가 이 범위에 넣지 않도록 지시했다(plan.md §A.5, §F 선택 후속 항목). 플랫폼 운영자의 권한은 위 두 가지에서 늘지 않는다.

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
| `StandardAssumptionProfile` | id, version, generation, insurerType, `groups[]`(각 그룹은 `groupKey`, `deduction`, `limit`, 선택 `sharedLimitPoolKey`; 보장 여부 필드 없음), `groupOrder[]`, `sharedLimitPools[]`, 생명주기 상태, origin, 유효 기간, policySourceIds[], 작성자, 승인자, 내용 해시 | (generation, insurerType) 칸마다 버전 계열 하나. 구조 규칙(키 유일·빈 키 없음, 없는 풀 참조 없음, `groupOrder`가 모든 `groupKey`를 한 번씩, 그룹 1개 이상)은 DD-02 "프로필 구조 검사와 영향 범위" |
| `CoverageRuleVersion` | 상품·담보 단위의 공제/한도/기간/횟수/제외/집계 단위, 유효 기간, 상태 | ProductProfile 1:N. 개별 상품 규칙을 담는 자리이며, 이번 계산은 표준 가정 프로필만 쓴다 |
| `CoverageReviewRequest` | id, clinicId, treatmentId, 제안한 보장 분류 정보, 요청자, 요청일, 상태(`REVIEW_REQUESTED` → 결과 `APPROVED`·`REJECTED`), 반려 사유, 결과 매핑 버전 | HA가 생성, RV가 처리 |
| `TreatmentCoverageMapping` | id, version, clinicId, treatmentId, scope[(generation, insurerType)], decision(`COVERED`·`EXCLUDED`), groupKey, exclusionReason, `approvedFingerprint`, 상태, origin, policySourceIds[], 작성자(RV)·승인자, 유효 기간 | Treatment N:N 프로필 칸. 보장 여부의 유일한 출처이며 필드 규칙은 `COVERED` ⇒ `groupKey` 필수·`exclusionReason` 없음, `EXCLUDED` ⇒ `groupKey` 없음·`exclusionReason` 필수, 두 경우 모두 `policySourceIds` 1개 이상과 승인자 기록(DD-03 "확인된 제외와 줄 상태") |
| `DocumentRuleSet` / `DocumentRule` | 묶음 id·버전·상태·origin·출처·승인자·내용 해시 / documentCode, when, reason, priority | 묶음 1:N 규칙 |
| `RuleBundleVersion` | id, 포함한 프로필·매핑·서류 규칙 버전 목록, 내용 해시, 게시자, 게시일 | 바꿀 수 없음. 사용 가능 여부는 이 엔티티에 두지 않고 아래 `RuleBundleStatusEvent`가 따로 갖는다. 한 묶음은 (세대, 보험사 형태) 칸마다 프로필을 하나, 매핑 id마다 버전을 하나만 담으며 게시 검증이 이를 어기면 거절한다(DD-03) |
| `RuleBundleStatusEvent` | bundleId, status(`ACTIVE`·`SUSPENDED`), 수행자(actorId)·역할, 일시, 사유, previousStatus | RuleBundleVersion 1:N, 추가 전용. 게시 트랜잭션이 첫 `ACTIVE` 사건을 함께 기록하고 현재 상태는 마지막 사건이며, 중지(`SUSPENDED`)는 되돌리지 않는다(DD-14) |
| `CatalogVersion` | id, clinicId, 포함한 TreatmentVersion·CommonBaseFee 목록, 게시자, 게시일, 변경 요약 | 바꿀 수 없음 |
| `ClinicRuleScope` | clinicId, ruleBundleVersionId, 지정자(PO), 지정일 | 병원 1:1(현재 값) + 이력. 묶음 중지로 바뀌지 않으며 중지된 묶음을 계속 가리킨다(DD-14) |
| `IdlePolicy` | clinicId, 화면 종류별 경고·초기화 초, `completionHoldSeconds` | 병원 1:1 (structure.md §11의 빈 자리를 채움). 저장된 정책이 없으면 읽기 함수가 DD-10 표의 값을 낸다. 키오스크에는 catalog 응답의 `idlePolicy`로 전달된다(DD-19) |
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
RuleBundleVersion 1 ── N RuleBundleStatusEvent  (추가 전용, 현재 상태 = 마지막 사건)
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
  "baseFeeIncluded": "NOT_REGISTERED",
  "idlePolicy": {
    "screens": {
      "INPUT": { "warnSeconds": 100, "resetSeconds": 120 },
      "RESULT": { "warnSeconds": 160, "resetSeconds": 180 },
      "BASIS_AND_DOCUMENTS": { "warnSeconds": 160, "resetSeconds": 180 },
      "HOLD_RESULT": { "warnSeconds": 160, "resetSeconds": 180 },
      "NOTICE_PROGRESS_ERROR": { "warnSeconds": 100, "resetSeconds": 120 }
    },
    "completionHoldSeconds": null
  }
}
```

표시 필드만 담는다. 검토 상태, 지문, 검토자 같은 보장 검토 내부 정보는 없다. 위 숫자는 기획서 §5 예시 값(X-ray 10,000원)을 쓴 형식 예시다.

- `idlePolicy`(SPEC 결정): 키오스크가 병원별 무조작 정책을 읽는 길이다. 키오스크는 다른 읽기 경로를 두지 않고 이 응답의 값으로 DD-10의 타이머 임계값을 구성한다. 화면 종류 다섯 개는 DD-10 표의 행(입력 단계 / 정상·보장 제외 결과 / 계산 근거·필요 서류 / 보류 결과 / 세대 확인 안내·계산 중·통신 오류)이며 `K00_Start`와 `K06_Complete`는 타이머가 없어 담지 않는다. 위 예시의 초 값은 병원이 정책을 저장하지 않았을 때의 기본값이고 DD-10 표의 값과 같다. 병원이 정책을 저장했으면 저장된 값이 나온다(화면 종류마다 따로, 저장하지 않은 화면 종류는 DD-10 표의 값).
- `completionHoldSeconds`는 저장된 값이 있으면 양의 정수이고 없으면 null이다. 기본값은 plan.md §E #12가 정해질 때까지 없다. null이면 키오스크는 자동 복귀 없이 "처음 화면으로" 버튼으로만 `K00_Start`에 간다(DD-13).
- 이 값들은 화면 동작을 정하는 표시 설정이며 보장 검토 내부 정보가 아니다. 관리자가 정책을 쓰는 경로와 20초 하한 검증은 관리자 API(`GET/PUT …/idle-policy`, 아래)이며 이 응답은 읽기만 한다. 응답에 환자 조건은 들어가지 않는다.

### `GET /api/clinics/{slug}/insurance/options`

```json
{
  "ruleBundleVersion": "<string|null>",
  "ruleBundleStatus": "<ACTIVE|SUSPENDED|null>",
  "generations": [ { "code": "GEN1_AS", "label": "1세대(A·S)", "period": "2009.08.01 이전" } ],
  "insurerTypes": [ { "code": "NON_LIFE", "label": "손해보험사", "help": "손해보험사에서 가입한 실손보험" } ],
  "causes": [ { "code": "INJURY", "label": "다쳐서 왔어요 (상해)", "help": "<string>" } ],
  "guidance": { "generationUnknown": "보험증권이나 보험사 앱에서 가입일을 확인해 주세요. 확인이 어려우면 1544-8069로 문의해 주세요." }
}
```

- 세대 5장, 형태 3장, 원인 3장을 항상 담는다(DD-05). 세대 기간은 기획서 §3의 표를 그대로 쓴다.
- `ruleBundleVersion`은 그 병원 `ClinicRuleScope`의 묶음 id이며(묶음이 중지된 동안에도 같다), 범위가 없으면 null이다. `ruleBundleStatus`는 그 묶음의 가용성(`ACTIVE` | `SUSPENDED`)이고 범위가 없으면 null이다. 매 요청마다 새로 읽는다(DD-14).
- 응답에 `Cache-Control: no-store`를 붙인다(SPEC 결정). 묶음이 중지되면 다음 요청에서 바로 보이게 하기 위해서다. `ClinicRuleScope`는 중지로 바뀌지 않는다.
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
- 서버는 규칙 사용 범위의 묶음과 그 묶음의 상태를 이 요청 안에서 새로 읽고(캐시하지 않음) 버전을 비교한 뒤 계산한다. 순서와 중지된 묶음의 응답(HTTP 200 `ON_HOLD`)은 DD-14에 있다.
- 키오스크가 계산 시도마다 만드는 `requestId`(DD-09)는 요청 본문에 없으며 서버는 이 값을 알지 못한다.
- 요청 본문은 금액·비율 필드를 담지 않으므로(위 규칙) 요청 검증은 아래 "요청 검증의 층"의 구조와 열거값만 본다. 수치 검증은 DD-24에 따라 게시 단계와 계산 단계에서 한다.
- 엔진이 `INVALID_NUMERIC_INPUT`으로 거절하면(저장된 줄 금액이 게시 검증을 통과하고도 범위 밖인 서버 데이터 무결성 결함) 서버는 금액도 내부 상세도 담지 않고 HTTP 500 `INTERNAL_ERROR`를 낸다. 결과 객체도 0도 `NaN`도 만들지 않는다.

#### 요청 검증의 층 (SPEC 결정)

계산 요청의 거절은 층으로 나뉜다. 한 요청에 여러 조건이 겹치면 아래 순서의 앞선 층이 이긴다. 층 구분의 기준은 "요청 본문이 계약의 형식을 지켰는가(400)"와 "형식은 지켰으나 내용이 지원 범위 밖이거나 비었는가(422)"다.

| 층 | 조건 | 응답 |
|----|------|------|
| 0 경로 | slug에 해당하는 병원 없음 | 404 `CLINIC_NOT_FOUND` |
| 1 구조 | 본문이 JSON이 아님. 필수 필드 누락(`catalogVersion`, `ruleBundleVersion`, `generation`, `insurerType`, `cause`, `treatmentIds`. `ruleBundleVersion`은 null 값이 허용되며 키가 없을 때만 누락). JSON 형식이 틀림(`catalogVersion`이 문자열이 아님, `ruleBundleVersion`이 문자열도 null도 아님, `generation`·`insurerType`·`cause`가 문자열이 아님, `treatmentIds`가 배열이 아니거나 문자열이 아닌 요소를 가짐). `insurerType` 또는 `cause`가 열거값 밖의 문자열 | 400 `INVALID_REQUEST` |
| 2 내용 | `generation`이 문자열이지만 다섯 값(`GEN1_AS`, `GEN2_C1`, `GEN2_5_C2`, `GEN3_C3`, `GEN4_C4`) 밖(5세대 등) | 422 `UNSUPPORTED_GENERATION` |
| 2 내용 | `treatmentIds`가 빈 배열 | 422 `NO_TREATMENT_SELECTED` |
| 3 병원 데이터 | 선택한 치료 ID 가운데 그 병원의 현재 게시 카탈로그에 없는 것이 있음(다른 병원의 치료 ID 포함) | 422 `TREATMENT_NOT_PUBLISHED` |

- 층 2의 두 코드는 엔진의 입력 검증 순서(`UNSUPPORTED_GENERATION` → `NO_TREATMENT_SELECTED`, DD-03)와 같다. 서버가 같은 확인을 엔진 호출 전에 하는 것은 요청 거절을 엔진 거절과 같은 코드로 내기 위해서다.
- 층 3과 버전 불일치(409, DD-14)의 선후는 이 구분이 바꾸지 않는다. 요청 본문의 다른 필드(가격·비율·병원 ID 등)는 어느 층에서도 읽거나 검사하지 않는다(REQ-API-002).
- 시험: AC-006f(층 구분과 422 두 코드), AC-021a(공개 오류 표 전체).

성공 응답(보류 포함, HTTP 200). 아래는 `TEST_FIXTURE` 예시 4종(합계 124,000원)으로 보류된 경우의 형식 예시다:

```json
{
  "versions": { "catalogVersion": "<string>", "ruleBundleVersion": "<string>", "ruleBundleStatus": "ACTIVE",
                "profile": { "id": "<string>", "version": "<string>", "origin": "TEST_FIXTURE" } },
  "origin": "TEST_FIXTURE",
  "result": { "state": "ON_HOLD",
              "amounts": { "hospitalPayment": 124000, "baseFeeIncluded": "NOT_REGISTERED",
                           "expectedInsurancePayout": null, "expectedOutOfPocketAfterPayout": null },
              "lines": [
                { "treatmentId": "<신장분사치료 id>", "displayName": "신장분사치료", "benefitType": "NON_BENEFIT",
                  "patientAmount": 40000, "isBaseFee": false, "origin": "TEST_FIXTURE",
                  "state": "ON_HOLD", "holdReason": "MAPPING_ABSENT" },
                "<나머지 LineResult 3개: X-ray, 초음파, 물리치료>"
              ],
              "groups": ["<GroupResult…>"], "referenceGroups": ["<…>"],
              "assumptions": ["PERSONAL_CONTRACT_NOT_CONFIRMED"],
              "holdReasons": [ { "treatmentId": "<신장분사치료 id>", "code": "MAPPING_ABSENT" } ],
              "excludedItems": [], "basis": {} },
  "documents": null
}
```

`versions.ruleBundleStatus`는 계산 때 새로 읽은 묶음 가용성(`ACTIVE` | `SUSPENDED`)이며 규칙 사용 범위가 없으면 `ruleBundleVersion`과 함께 null이다. 묶음이 중지된 경우의 응답은 같은 형식이다: HTTP 200, `versions.ruleBundleStatus = "SUSPENDED"`, `versions.profile`은 null, `result.state = "ON_HOLD"`, 모든 줄 `holdReason = "RULE_BUNDLE_SUSPENDED"`, `hospitalPayment`는 숫자, 보험금 두 값은 null, `documents`는 null이다. 프로필 칸에 기록이 없거나 규칙 사용 범위가 없으면 `versions.profile`은 null이다. 보류 줄에는 `groupKey`가 없다(DD-02). `"<…>"` 문자열은 예시를 줄이기 위한 자리 표시다.

### 오류 표 (SPEC 결정: 상태 번호와 코드)

| HTTP | 코드 | 조건 | 경로 |
|------|------|------|------|
| 400 | `INVALID_REQUEST` | 계산 요청의 구조 오류(본문이 JSON이 아님, 필수 필드 누락, JSON 형식 오류, `insurerType`·`cause`가 열거값 밖의 문자열. 위 "요청 검증의 층" 1층), 관리자 반려에 사유 없음, 규칙 묶음 중지에 사유 없음, 수치 범위 위반(관리자 입력: 가격·기본비용·프로필 값이 DD-24 범위 밖이면 어긋난 필드 경로와 함께 거절하고 아무것도 저장하지 않음), 규칙 묶음 게시의 매핑 필드 규칙·프로필 구조·묶음 교차 검사 위반(DD-03, DD-02. 같은 방식으로 어긋난 필드 경로와 함께 거절하고 아무것도 저장하지 않음) | 공개·관리자 |
| 401 | `UNAUTHENTICATED` | 인증되지 않은 관리자 요청 | 관리자 |
| 403 | `FORBIDDEN` | 역할 권한 밖, 다른 병원 자원 | 관리자 |
| 404 | `CLINIC_NOT_FOUND` | slug에 해당하는 병원 없음 | 공개 |
| 409 | `VERSION_MISMATCH` | 버전 불일치 (DD-14) | 공개 |
| 422 | `UNSUPPORTED_GENERATION` | `generation`이 문자열이지만 세대 열거 밖(5세대 등). 문자열이 아니거나 필드가 없으면 400. C4로 계산하지 않음 | 공개 |
| 422 | `NO_TREATMENT_SELECTED` | `treatmentIds`가 빈 배열(필드가 없거나 배열이 아니면 400) | 공개 |
| 422 | `TREATMENT_NOT_PUBLISHED` | 그 병원 게시 카탈로그에 없는 치료 ID | 공개 |
| 500 | `INTERNAL_ERROR` | 서버 실패. 계산 때 저장된 줄 금액이 범위 밖이거나 병원 결제액 T가 안전 정수가 아닌 데이터 무결성 결함(엔진의 `INVALID_NUMERIC_INPUT` 거절, DD-24)도 여기로 낸다. 금액·스택·필드 내용을 담지 않음 | 공개·관리자 |
| 5xx | — | 그 밖의 서버 실패 | 공개·관리자 |

계산 보류는 HTTP 200이다.

### 키오스크의 응답 처리 (SPEC 결정)

아래 처리는 모두 활성 `requestId`와 일치하는 결말에만 적용한다(DD-09). 활성 요청이 아닌 시도의 응답·오류·시간 초과는 어느 종류든(409와 `NO_TREATMENT_SELECTED`·`TREATMENT_NOT_PUBLISHED` 포함) 상태·결과·로딩 표시·화면을 건드리지 않고 버린다. 일치하는 결말은 모두 `settleRequest`(DD-09 "요청 생명주기")가 활성 요청과 시간 제한 타이머를 먼저 풀고 나서 아래 화면 처리를 한다. 409와 `TREATMENT_NOT_PUBLISHED` 뒤의 catalog·options 다시 받기는 시작할 때의 `sessionId`·`inputRevision`이 지금과 같을 때만 반영한다.

| 응답 (활성 `requestId`와 일치할 때) | 키오스크 처리 |
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
| `POST /api/admin/rule-bundles` | 묶음 게시(첫 `ACTIVE` 가용성 기록을 같은 트랜잭션에 씀) | RV |
| `POST /api/admin/rule-bundles/{id}/suspend` | 묶음 중지: 비어 있지 않은 `reason` 필수(없으면 400 `INVALID_REQUEST`), 응답에 `affectedClinics: [{ clinicId, slug }]`(현재 범위가 이 묶음을 가리키는 병원), 다시 활성으로 돌리는 경로 없음(DD-14) | RV (병원 관리자·플랫폼 운영자 403) |
| `PUT /api/admin/clinics/{clinicId}/rule-scope` | 규칙 사용 범위 지정 | PO |
| `GET/POST /api/admin/memberships` | 소속·역할 | PO |
| `GET /api/admin/audit-log` | 감사 기록 | 권한 표 기준 |

모든 관리자 요청은 인증과 병원 권한 확인을 거친다(REQ-ADM-001).

## DD-20 기술 스택

- 후보: Next.js App Router + TypeScript 단일 앱(기획서 §8; tech.md §1). 엔진은 `src/engine`의 순수 TS 모듈이며, 가져오기 경계 검사로 React·Next·DB 드라이버·`fetch`·`fs`·네트워크 모듈·생성형 AI SDK와 주입 없는 `Date.now`·`Math.random`을 막는다.
- DB, 호스팅, 관리자 인증 공급자는 정해지지 않았다(plan.md §E #1-#3). 지속 저장이 필요한 마일스톤은 저장소 인터페이스와 메모리 구현으로 진행하고, DB 구현은 스택 결정을 기다린다.
- 시험 러너: Vitest(작성 세션의 사용자 지시, 2026-10-14 개정 4 요청에서 유지 지시, plan.md §A.5). 화면 E2E는 e2e-tester가 맡는다.
- 방법론: TDD(`quality.yaml`), 커버리지 85%, 커밋당 80%.

## DD-21 보류 사유의 환자용 분류

| 환자용 분류 (초안, 최종 문구는 plan.md §E #23의 확인 대상) | 내부 코드 |
|-------------------------------------------------------|-----------|
| 표준 가정 자료가 아직 준비되지 않았습니다 | `CLINIC_RULE_SCOPE_ABSENT`, `RULE_BUNDLE_SUSPENDED`, `PROFILE_ABSENT`, `PROFILE_DRAFT`, `PROFILE_DEMO`, `PROFILE_UNAPPROVED`, `PROFILE_INVALID`, `PROFILE_UNDER_REREVIEW`, `PROFILE_SOURCE_INCOMPLETE`, `PROFILE_FORMULA_UNSUPPORTED`, `PROFILE_VALUE_MISSING`, `PROFILE_VALUE_INVALID`, `CALC_RANGE_EXCEEDED` |
| 이 치료의 보장 분류를 검토하고 있습니다 | `MAPPING_ABSENT`, `MAPPING_UNREVIEWED`, `MAPPING_REJECTED`, `MAPPING_INVALID`, `MAPPING_UNDER_REREVIEW`, `MAPPING_GROUP_NOT_IN_PROFILE` |
| 이 치료의 분류 확인이 필요합니다 | `CLASSIFICATION_NEEDS_REVIEW` |
| 이 치료의 가격 자료 확인이 필요합니다 | `LINE_ORIGIN_NOT_ACCEPTED` |

프로필 구조 결함으로 생기는 `PROFILE_INVALID`(DD-02)도 같은 첫 번째 분류에 속한다. 분류 문구는 어느 코드에서 왔는지와 관계없이 같다.

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

운영 준비 상태는 "준비 완료" 하나로 줄일 수 없다. 계산이 실제로 기대는 자료가 네 가지(표준 가정 프로필 칸, 치료별 매핑, 서류 규칙, 규칙 사용 범위와 묶음 상태)여서, 이 SPEC은 그 네 가지를 네 개의 표로 따로 내고 병원마다 서로 독립인 두 조건(`calculationReady`, `documentReady`)을 그 표들에서 유도한다. 요구사항은 REQ-DATA-004, 수용기준은 AC-011c(표 P), AC-011j(표 M), AC-011k(표 D·S), AC-011l(유도 조건)이다.

### 규칙 0: 계산과 같은 판정 (두 번째 구현 없음)

`computeReadiness`는 저장소 스냅샷을 읽기만 하는 순수 함수다. 시각(`at`)과 허용 출처(`acceptedOrigins`)는 주입받으며, 운영 구성에서는 규칙 데이터와 줄 모두 `['OPERATING']`이다(DD-04).

```ts
function computeReadiness(
  snapshot: ReadinessSnapshot,   // 병원(규칙 사용 범위, 현재 카탈로그의 게시 줄·공통 기본비용), 규칙 묶음(내용, 가용성)
  ctx: { at: string; acceptedOrigins: { rules: Origin[]; lines: Origin[] }; digest: (c: unknown) => string },   // 항목 판정의 UsabilityContext는 rules 쪽 허용 출처로 만든다(DD-04)
): ReadinessReport;              // 아래 네 표와 병원별 두 조건. 출력 모양은 구현이 정한다
```

- 준비 상태는 `estimate()`가 쓰는 것과 같은 함수만 부른다: `isBundleUsable`, `isUsable`, `resolveProfile`(안에서 `checkProfileStructure`), `resolveMapping`, 줄 판정 `decideLine`(줄 출처 → 분류 → `resolveMapping` → `groupKey`, DD-04 호출 순서 6), 그룹 값 검사 `checkGroupValues`(호출 순서 7). 상태·출처·유효 기간·해시를 준비 상태 쪽에서 따로 비교하지 않는다. 같은 규칙을 두 곳에 두면 한쪽만 바뀌었을 때 "준비 완료인데 계산은 보류"가 생긴다.
- 표에 나오는 사유는 같은 단계에서 `estimate()`가 낼 보류 코드다. 새 보류 코드는 없다.
- 준비 상태가 보지 않는 것: `CALC_RANGE_EXCEEDED`와 `INVALID_NUMERIC_INPUT`(DD-24)은 저장 자료가 아니라 환자가 고른 금액의 크기에 달려 있으므로 준비 상태의 대상이 아니다.

### 표 P — 프로필 칸

- 키: 칸 = 세대 5종 × 보험사 형태 3종, 15개. 현재 상태는 아래와 같다(운영 프로필이 하나도 없음).

| 세대 \ 보험사 형태 | 손해보험사 | 생명보험사 | 그외 공제 조합 |
|--------------------|-----------|-----------|----------------|
| 1세대(A·S) | NOT_READY | NOT_READY | NOT_READY |
| 2세대(C1) | NOT_READY | NOT_READY | NOT_READY |
| 2.5세대(C2) | NOT_READY | NOT_READY | NOT_READY |
| 3세대(C3) | NOT_READY | NOT_READY | NOT_READY |
| 4세대(C4) | NOT_READY | NOT_READY | NOT_READY |

- 두 가지 보기를 낸다.
  - 플랫폼 보기: 후보 = 그 칸의 프로필을 담은 모든 규칙 묶음. 어느 묶음이 `isBundleUsable`을 통과(`ACTIVE`)하고 그 묶음의 `resolveProfile(묶음, 칸, ctx)`가 프로필을 내면 그 칸은 `READY`다. 즉 운영 출처(`OPERATING`)의 `PUBLISHED` 프로필이 유효 기간 안이고 약관 출처 6항목과 승인자 기록이 완비되고 내용 해시가 맞고 구조 결함이 없으며, 그 프로필을 담은 `ACTIVE` 묶음이 하나 이상 있어야 한다.
  - 병원 보기: 후보 = 그 병원의 규칙 사용 범위가 가리키는 묶음 하나(그 칸의 프로필이 없어도 후보다). 같은 시험이다.
- `NOT_READY`의 사유: 후보마다 코드가 정해진다. 묶음이 사용 불가이면 `RULE_BUNDLE_SUSPENDED`, 아니면 `resolveProfile`의 코드다(칸에 프로필이 없으면 `PROFILE_ABSENT`). 플랫폼 보기에서 후보가 하나도 없으면 `PROFILE_ABSENT`, 병원 보기에서 규칙 사용 범위가 없으면 `CLINIC_RULE_SCOPE_ABSENT`다. 플랫폼 보기에서 후보가 여럿이면 사용 가능해질 가능성이 가까운 코드가 이긴다는 DD-03(`resolveMapping`)의 원칙으로 고정 우선순위를 둔다(SPEC 결정, 보고용이며 계산에는 쓰이지 않는다): `PROFILE_UNDER_REREVIEW` > `PROFILE_UNAPPROVED` > `PROFILE_DRAFT` > `PROFILE_SOURCE_INCOMPLETE` > `PROFILE_INVALID` > `PROFILE_DEMO` > `RULE_BUNDLE_SUSPENDED`. 배열 순서와 무관하다.
- 표 P가 말하는 것은 "이 칸의 사용 가능한 프로필이 있다"(프로필 준비)뿐이다. 이것만으로 어느 병원도 이 칸으로 계산할 수 있다는 뜻이 아니다.

### 표 M — 치료별 매핑

- 키: 병원 × 게시된 줄 × 칸. 게시된 줄은 그 병원의 현재 `CatalogVersion`에 든 치료와 공통 기본비용 전부다(DD-14). 매핑 자료는 그 병원의 규칙 사용 범위가 가리키는 묶음에 든 매핑이며, 범위가 없으면 빈 집합으로 본다. 묶음의 가용성은 여기서 보지 않는다(표 S가 본다).
- `READY`: 줄 판정 `decideLine`이 줄을 쓸 수 있다고 정할 때다. 즉 줄 출처와 분류가 통과하고 `resolveMapping`이 사용 가능한 매핑 하나를 내며, 그 매핑이 사용 가능한 `COVERED`이면 `groupKey`가 칸의 프로필에 있고 그 그룹이 `checkGroupValues`를 통과해야 한다. 사용 가능한 `EXCLUDED` 매핑도 `READY`다. 결과가 확정된 제외로 결정적이기 때문이며 보고에는 `READY (EXCLUDED_CONFIRMED)`로 적는다.
- `NOT_READY`의 사유(줄 단계 보류 코드): `LINE_ORIGIN_NOT_ACCEPTED`, `CLASSIFICATION_NEEDS_REVIEW`, `MAPPING_ABSENT`, `MAPPING_UNREVIEWED`, `MAPPING_REJECTED`, `MAPPING_UNDER_REREVIEW`(지문 불일치 포함), `MAPPING_INVALID`(모호함 포함), `MAPPING_GROUP_NOT_IN_PROFILE`, 그룹 값 결함의 `PROFILE_SOURCE_INCOMPLETE`·`PROFILE_FORMULA_UNSUPPORTED`·`PROFILE_VALUE_MISSING`·`PROFILE_VALUE_INVALID`. 사용 불가 상태의 `EXCLUDED` 매핑은 제외 확인이 아니라 그 상태의 코드다.
- 사용 가능한 `COVERED` 매핑인데 그 칸의 프로필이 해석되지 않으면 그룹을 볼 수 없다. 이 행은 `NOT_READY`이고 사유는 표 P(병원 보기)의 같은 칸 사유다.

### 표 D — 서류 규칙

- 키: 병원. `READY`는 표 S가 `ACTIVE`이고 그 묶음의 서류 규칙 묶음이 `isUsable`(운영 출처, 게시 상태, 유효 기간, 약관 출처, 승인자, 내용 해시)을 통과할 때다.
- `NOT_READY`의 사유는 `RULES_UNAVAILABLE`이고, 세부 사유를 함께 낸다: 묶음 단계(`SCOPE_ABSENT`, `BUNDLE_SUSPENDED`), 묶음에 서류 규칙 묶음이 없음(`SET_ABSENT`), 또는 `ItemUsabilityReason`. 세부 사유는 보고용 표시이고 보류 코드가 아니다.

### 표 S — 규칙 사용 범위와 묶음 상태

- 키: 병원. 값은 `isBundleUsable`의 결과 그대로다: `SCOPE_ABSENT`(→ `CLINIC_RULE_SCOPE_ABSENT`), `BUNDLE_SUSPENDED`(→ `RULE_BUNDLE_SUSPENDED`), `ACTIVE`. `ACTIVE`만 `READY`이고 묶음 id와 버전을 함께 낸다.

### 병원별 두 조건 (합치지 않는다)

```ts
calculationReady[칸] = S == ACTIVE ∧ P(병원 보기)[칸] == READY ∧ 게시된 치료 ≥ 1 ∧ ∀ 줄: M[줄][칸] == READY
documentReady        = S == ACTIVE ∧ D == READY
```

- 두 조건은 서로 영향을 주지 않는다. 한쪽이 `READY`라고 다른 쪽이 `READY`인 것은 아니다.
- `calculationReady[칸]`이 `NOT_READY`이면 사유는 판정 순서의 첫 단계로 보고한다: S의 코드 → P의 코드 → 게시된 치료 없음(`NO_PUBLISHED_TREATMENT`, 보고용 표시이며 보류 코드가 아니다) → 표 M의 `NOT_READY` 줄과 줄별 코드. 게시된 치료가 하나도 없으면(공통 기본비용만 있는 경우 포함) `estimate()`가 거절(`NO_TREATMENT_SELECTED`)하므로 이 칸은 `NOT_READY`다.
- 계산 동치(AC-011l): `calculationReady[칸]`이 `READY`인 것과, 그 병원의 게시된 치료 전부와 공통 기본비용 전부를 입력으로 같은 칸에서 부른 `estimate()`의 전체 상태가 `ON_HOLD`가 아닌 것은 같은 말이다(위 "준비 상태가 보지 않는 것"에 걸리는 입력은 뺀다). `NOT_READY`일 때 사유도 같다. S나 P 단계의 코드는 `estimate()`가 모든 줄에 내는 코드와 같고, 줄 단계의 `NOT_READY` 목록은 `estimate()`의 `holdReasons[]`(줄과 코드)와 같다. 게시된 치료가 하나도 없으면 `estimate()`에 넣을 입력이 없으므로 이 동치는 적용하지 않는다(그 칸은 `NOT_READY`다).
- 서류 안내는 계산 결과가 `ON_HOLD`가 아닐 때만 나온다(DD-04). 그래서 어느 칸에서 서류 안내가 나올 수 있는 가장 엄격한 조건은 `calculationReady[칸] ∧ documentReady`다. 환자가 고른 일부 치료만으로는 `calculationReady[칸]`이 `NOT_READY`여도 계산될 수 있으며, 그 결과는 `estimate()`가 정한다. 준비 상태 보고는 게시된 줄 전체를 기준으로 한다.

### `RULES_UNAVAILABLE`의 위치

`RULES_UNAVAILABLE`은 서류 쪽 상태다. `documentReady`를 `NOT_READY`로 만들 뿐이고 `calculationReady`는 바꾸지 않는다. 실행 중 동작은 그대로다: 계산 결과는 보이고 서류 화면은 안내 문구를 보인다(DD-06, plan.md §E #18). 이것은 오류도 보류도 아니다.

### 보고 문구와 현재 상태

- 어느 문장이나 표도 한 표의 결과만으로 "병원 전체 준비 완료"나 "운영 준비 완료"라고 쓰지 않는다. 특히 표 P가 `READY`인 것을 병원이 준비되었다는 뜻으로 쓰지 않는다. 보고는 (칸별 `calculationReady`, `documentReady`) 짝으로 하고 `NOT_READY`이면 막힌 단계(S, P, M, D)와 그 코드를 함께 적는다.
- 현재 상태(운영 자료 없음): 모든 병원의 S는 `SCOPE_ABSENT`, D는 `RULES_UNAVAILABLE`, 표 M의 모든 줄은 `MAPPING_ABSENT`, 표 P의 15칸(플랫폼 보기)은 `PROFILE_ABSENT`이며 `calculationReady`와 `documentReady`는 모두 `NOT_READY`다.
- 이 SPEC은 스키마·화면·엔진·시험을 만든다. 실제 운영은 준비 자료가 승인될 때까지 보류된다(모든 계산이 "확인 필요").
- 출력 형태는 구현이 정한다(함수 결과와 보고서). 이 SPEC은 준비 상태를 위한 관리자 API나 화면을 요구하지 않으며 DD-17 권한 표와 DD-19 관리자 API 목록에 행을 더하지 않는다.
- 어느 칸·병원에서 먼저 운영을 시작할지, 서류 안내 없이 계산 안내부터 시작해도 되는지는 사업 판단이며 이 SPEC이 정하지 않는다. M8 관문(plan.md §B M8)이 위 짝을 기준으로 확인한다.
- 운영 자료(보류 확정, plan.md §E.1): 소유자가 첨부할 표준값 표, 약관 원문(조항·페이지·개정일·효력일), 병원 가격표와 행위 코드, 보험사·상품별 서류 요건, 보험사 형태가 규칙 선택에 쓰이는 방식(농협 계열의 소속 포함) 등.

## DD-24 수치 검증

타입 별칭(`Won`, `BasisPoints`)은 검증이 아니다. 이 절이 값의 범위, 검사하는 곳, 위반했을 때의 처리를 정한다(REQ-ENG-001·002·004, REQ-DATA-004, REQ-API-004). 게시 검증을 통과한 값은 계산 단계의 처리에 걸리지 않아야 하지만, 엔진은 입력을 믿지 않고 스스로 검사한다.

### 정의

- `Won`: `typeof v === 'number'`이고 `Number.isSafeInteger(v)`이며 `0 ≤ v ≤ MAX_AMOUNT_WON`이고 `-0`이 아닌 값.
- `BasisPoints`: 안전 정수이며 `0 ≤ v ≤ 10000`인 값.
- 문자열, `null`, `undefined`, `NaN`, `±Infinity`, 소수, 음수는 모두 무효다. `Number()`, `parseInt`, 반올림, 기본값 채우기처럼 값을 고쳐 쓰는 변환을 하지 않는다. 무효 값이 `0`, `NaN`, 기본값, 정상처럼 보이는 숫자로 바뀌어 나가는 일은 어느 단계에도 없다.
- `MAX_AMOUNT_WON`은 보험 값이 아닌 기술 안전 한도이며 `src/engine/limits.ts`에 둔다. SPEC 제안값은 `1_000_000_000`(제안, 소유자 승인 아님)이고, 구현자가 M1.1에서 다음 불변 조건 아래 확정한다: `MAX_AMOUNT_WON × 10000 ≤ Number.MAX_SAFE_INTEGER`. 경계 시험은 가져온 상수로 N과 N+1을 쓰므로 상수를 바꿔도 수용기준은 바뀌지 않는다.
- 이 절의 표기(SPEC 표기이며 코드 이름이 아니다): `S = Number.MAX_SAFE_INTEGER = 9007199254740991`, `B = 10000`(basis points 척도), `H = 5000`(`B`의 절반). 코드에서는 `limits.ts`·`constants.ts`의 이름 있는 상수로 쓴다.
- **검사 연산(checked)**: 연산의 *정확한* 정수 결과 `r`이 `0 ≤ r ≤ S`이면 통과하고, `r > S`이면 범위 초과다. 계약은 수학적이다. 부동소수점이 감기거나 정밀도를 잃는 동작에 기대지 않으며, 구현은 `BigInt`나 사전 검사로 정확한 결과를 판정해도 된다. 곱은 `비율 × 금액`이지 `금액 × 10000`이 아니다. 비율은 0~10000이므로 곱의 크기는 비율에 따라 다르다.
- 합계 E, G, N, T는 `MAX_AMOUNT_WON`보다 클 수 있으나 안전 정수여야 한다. `MAX_AMOUNT_WON × 10000 ≤ S`라는 불변 조건은 줄 하나의 금액에 대한 곱이 안전하다는 것만 보장하며, 그룹 합 E에 대한 곱이 안전한지는 보장하지 않는다. 그래서 아래의 단계별 검사가 따로 필요하다.

### 보조 함수와 파일 (제안)

- `src/engine/numeric.ts`: 검사 덧셈(`checkedAdd`), 비율 × 금액 검사 곱셈(`checkedMulBp(rate, amount)`), 줄 금액 합산(`sumLineAmounts`), `isWon`, `isBasisPoints`.
- `src/engine/limits.ts`: `MAX_AMOUNT_WON`.
- `src/engine/constants.ts`: basis points 척도 10000과 그 절반 5000(DD-02).

### 필드별 범위

| 필드 | 형식 | 범위 | 검사하는 곳 |
|------|------|------|-------------|
| 치료 가격(`TreatmentVersion`의 환자 예상 결제액), 공통 기본비용 금액 | `Won` | 0 이상 `MAX_AMOUNT_WON` 이하 | 카탈로그 게시 검증, 계산 때 엔진 입력 검증 |
| 프로필의 `fixed`, `amount`, `perUseAmount`, 공유 한도 풀의 한도 금액 | `Won` | 같음 | 규칙 묶음 게시 검증, 계산 때 그룹 단위 검사 |
| 프로필의 `rate`, `rateBenefit`, `rateNonBenefit` | `BasisPoints` | 0 이상 10000 이하 | 규칙 묶음 게시 검증, 계산 때 그룹 단위 검사 |
| 파생 값 E, G, N, T(= `hospitalPayment`), D, `D_applied`, L, P, `P_pooled`, 각종 합계 | 안전 정수 | 안전 정수 | 연산마다 |
| 요청 본문 | — | 금액·비율 필드를 담지 않는다(REQ-API-002). 요청 검증은 DD-19 "요청 검증의 층"의 구조와 열거값만 보며, 금액·비율 필드가 와도 무시하고 검증하지 않는다 | 요청 검증 |

### 계산 단계의 검사 연산 순서 (SPEC 결정)

그룹은 아래 표에 적힌 검사 단계 가운데 하나라도 정확한 결과가 `S`를 넘으면 `CALC_RANGE_EXCEEDED`로 보류한다. 단계는 표의 순서로 평가하고, 처음 실패한 단계의 이름 하나가 그 그룹의 `trace`에 남는다(진단용이며 환자에게 보이지 않는다. 보류 결과 화면에는 계산 근거가 없다). 공제 방식과 원 단위 처리마다 검사하는 연산이 다르므로 하나의 경계값으로 모든 경우를 대신할 수 없다.

| 공제 방식 | 원 단위 처리 | 검사 단계(순서대로) | 실패 단계 이름 |
|-----------|--------------|---------------------|----------------|
| `FIXED` | — | 없음. 곱이 없다. `E − D`와 `min`·`max` 비교는 넘칠 수 없다 | — |
| `RATE_WITH_FIXED_FLOOR`, `CAPPED_RATE_WITH_FIXED_FLOOR` | `TRUNCATE` | ① `m = rate × E` (그 뒤 `floor(m / B)`) | `RATE_PRODUCT` |
| 같음 | `ROUND_HALF_UP` | ① `m = rate × E` ② `m + H` (그 뒤 `floor((m + H) / B)`) | ①이면 `RATE_PRODUCT`, ②이면 `ROUND_ADD` |
| `SPLIT_RATE_WITH_FIXED_FLOOR` | `TRUNCATE` | ① `p1 = rateBenefit × G` ② `p2 = rateNonBenefit × N` ③ `s = p1 + p2` (그 뒤 `floor(s / B)`) | ①`SPLIT_PRODUCT_BENEFIT` ②`SPLIT_PRODUCT_NON_BENEFIT` ③`SPLIT_SUM` |
| 같음 | `ROUND_HALF_UP` | ①②③ 뒤에 ④ `s + H` (그 뒤 `floor((s + H) / B)`). 반올림은 합에 한 번만 하고 곱마다 하지 않는다 | ①②③은 위와 같고 ④이면 `ROUND_ADD` |

- 나눗셈 `floor(· / B)`는 검사하지 않는다(결과가 피연산자보다 작다). 명목 공제 `D`의 `max`·`min`과 한도 `P`의 `min`·`max`도 비교일 뿐이다.
- 비율이 0이면 그 곱은 0이므로 그 항은 넘치지 않는다. `SPLIT`에서 한쪽 비율이 0이면 그쪽 `G`나 `N`이 아무리 커도 그 곱은 0이다.
- `ROUND_HALF_UP`의 `+ H`는 두 번째 검사 단계다. 곱은 안전해도 덧셈에서 넘칠 수 있으므로 같은 `E`가 `TRUNCATE`에서는 정상이고 `ROUND_HALF_UP`에서는 보류일 수 있다. 경계는 원 단위 처리에 따라 달라진다.
- 한도·지급 단계(`E − D`, `min`, `max`, `Σ P_pooled`, `remaining -= P_pooled`, `T − Σ P_pooled`)는 `T`가 검사된 안전 정수이면 넘칠 수 없다. 모든 `E`·`G`·`N`·`X`·`P`·`P_pooled`는 줄 금액의 부분합이거나 그 이하이고 줄 금액은 0 이상이므로 `T` 이하다. 명목 공제 `D = max(fixed, round(…))`는 `fixed ≤ MAX_AMOUNT_WON`이고 비율이 10000 이하여서 `round(…) ≤ E`(`SPLIT`은 `≤ G + N`)이므로 `S` 이하다. 그래서 `T`를 먼저 검사하고(`INVALID_NUMERIC_INPUT` 거절) 나면 그룹 산술이 실패할 수 있는 곳은 위 표의 비율 단계뿐이다.
- 세 가지 처리는 서로 다르다는 것을 그대로 지킨다. 게시 거절·요청 거절·계산 거절(줄 금액과 `T`)은 결과를 만들지 않는 거절이고, 그룹 보류(`PROFILE_VALUE_INVALID`, `CALC_RANGE_EXCEEDED`)는 병원 결제액을 숫자로 둔 채 그 그룹만 "확인 필요"로 둔다. 줄 금액 합 `T`가 넘치는 것은 그룹 보류가 아니라 계산 거절이다.
- 금액이나 비율을 줄이거나 잘라서(clamp, truncate, rescale) 시험 사례에 맞추지 않는다. 보류 그룹은 `D`, `D_applied`, `P`, `P_pooled`를 null로 내고 부분 계산값을 내지 않으며, 프로필 객체는 바뀌지 않는다. 같은 입력의 다른 그룹은 영향을 받지 않는다.

### 경계 기준값 (S에서 유도, BigInt로 다시 계산한 정확한 값)

아래 값은 `S`에서만 유도되며 `MAX_AMOUNT_WON`에 의존하지 않는다. 문서를 쓰는 시점에 `BigInt`로 다시 계산해 맞춰 본 값이고 앱 시험이 아니다. 시험은 이 값을 오라클로 쓰되 `E`를 줄 금액으로 만들 때 줄 하나가 `MAX_AMOUNT_WON`을 넘지 않게 하며, 줄 수는 가져온 `MAX_AMOUNT_WON`에서 올림으로 계산한다(제안값 `1_000_000_000`이면 `E = 900719925474`는 900줄 × 10억 + 나머지로 901줄이다. 줄 수를 시험에 하드코딩하지 않는다).

| 공제 방식 | 원 단위 처리 | 비율 | 정상 최대 | 첫 초과 | 첫 초과의 실패 단계 |
|-----------|--------------|------|-----------|---------|---------------------|
| `RATE`·`CAPPED` | `TRUNCATE` | 10000 | `E = 900719925474` (`rate × E = 9007199254740000`) | `E = 900719925475` (`9007199254750000`) | `RATE_PRODUCT` |
| 같음 | `TRUNCATE` | 2000 | `E = 4503599627370` (`9007199254740000`) | `E = 4503599627371` (`9007199254742000`) | `RATE_PRODUCT` |
| 같음 | `ROUND_HALF_UP` | 10000 | `E = 900719925473` (곱 `9007199254730000`, `+ H` = `9007199254735000`) | `E = 900719925474`: 곱 `9007199254740000`은 `S` 이하이나 `+ H` = `9007199254745000` > `S` | `ROUND_ADD` |
| 같음 | `ROUND_HALF_UP` | 2000 | `E = 4503599627367` (곱 `9007199254734000`, `+ H` = `9007199254739000`) | `E = 4503599627368`: 곱 `9007199254736000`은 안전하나 `+ H` = `9007199254741000` > `S` | `ROUND_ADD` |
| `SPLIT` | `TRUNCATE` | 10000 / 10000 | `(G, N) = (450359962737, 450359962737)` (`p1 = p2 = 4503599627370000`, `s = 9007199254740000`) | `(450359962737, 450359962738)`: `p1`·`p2`는 각각 안전(`4503599627370000`, `4503599627380000`)이나 `s = 9007199254750000` > `S` | `SPLIT_SUM` |
| `SPLIT` | `ROUND_HALF_UP` | 10000 / 10000 | `(450359962736, 450359962737)` (`s = 9007199254730000`, `s + H = 9007199254735000`) | `(450359962737, 450359962737)`: `s = 9007199254740000`은 `S` 이하이나 `s + H = 9007199254745000` > `S` (같은 쌍이 `TRUNCATE`에서는 정상) | `ROUND_ADD` |
| `SPLIT` | 어느 쪽이든 | `rateBenefit` 10000 | — | `G = 900719925475`, `N = 0`: `p1 = 9007199254750000` > `S` (곱 하나가 넘침) | `SPLIT_PRODUCT_BENEFIT` |
| 줄 금액 합 `T` | — | — | 합이 `S` (`checkedAdd(S − 1, 1)`) | 합이 `S + 1` (`checkedAdd(S, 1)`) | 계산 거절 `INVALID_NUMERIC_INPUT` (보류 아님) |

`RATE`·`CAPPED`의 `TRUNCATE`에서 `E = 4503599627368 … 4503599627370`(비율 2000)과 `E = 900719925474`(비율 10000)는 정상이지만 같은 `E`가 `ROUND_HALF_UP`에서는 `ROUND_ADD`로 보류된다.

### 단계별 처리

세 처리는 일부러 다르다. 게시 단계의 입력은 사람이 고칠 수 있으므로 거절하고 이유를 알리고, 계산 단계의 저장된 줄 금액은 서버 결함이므로 오류로 처리하며, 프로필 값은 그 그룹만 "확인 필요"로 둔다.

| 단계 | 위반 | 처리 | 결과 |
|------|------|------|------|
| 게시·관리자 입력 (카탈로그의 가격·기본비용, 규칙 묶음의 프로필·한도·비율 값) | 범위 밖 | **게시 거절**: 도메인 게시 검증이 거절하고, 관리자 API는 HTTP 400 `INVALID_REQUEST`와 어긋난 필드 경로를 낸다 | 아무것도 저장하지 않고 이전 게시 버전이 그대로 남는다. 경계값 0과 `MAX_AMOUNT_WON`은 허용 |
| 계산 요청 구조 | JSON·필수 필드·JSON 형식 오류, `insurerType`·`cause`의 열거값 밖 문자열(`generation`이 문자열이지만 열거 밖이면 400이 아니라 422 `UNSUPPORTED_GENERATION`, DD-19 "요청 검증의 층") | **요청 거절**: HTTP 400 `INVALID_REQUEST` | 구조만 본다 |
| 계산: 저장된 줄(치료·공통 기본비용) 금액이 무효이거나 T가 안전 정수가 아님 | 게시 검증을 통과한 뒤에는 생길 수 없어야 하는 서버 데이터 무결성 결함 | **계산 거절**: 엔진이 `INVALID_NUMERIC_INPUT`으로 거절(`UNSUPPORTED_GENERATION`처럼 결과가 아니라 거절)하고 API는 HTTP 500 `INTERNAL_ERROR`를 금액과 내부 상세 없이 낸다 | 키오스크는 `FAILED` → `KXX_Error_Network`로 처리한다. 병원 결제액은 믿을 수 있는 숫자여야 하므로 나쁜 줄을 보류로 돌리거나 합계에서 빼지 않는다 |
| 계산: 프로필 그룹 값이 무효 | 범위 밖(없음·null은 `PROFILE_VALUE_MISSING`) | 그 그룹의 줄을 `PROFILE_VALUE_INVALID`로 보류 | 병원 결제액은 숫자, 보험금은 null |
| 계산: "계산 단계의 검사 연산 순서" 표의 단계 하나에서 정확한 결과가 `S`를 넘음 | 범위 초과(값은 모두 유효) | 그 그룹의 줄을 `CALC_RANGE_EXCEEDED`로 보류. 금액·비율을 잘라 맞추지 않고 부분 `D`·`P`도 내지 않음 | 병원 결제액은 숫자, 보험금은 null |

- 어느 단계에서도 무효 값이 `0`, `NaN`, 기본값, 정상처럼 보이는 숫자가 되지 않는다.
- 응답을 직렬화하기 전에 모든 수치 필드에 `NaN`과 `Infinity`가 없음을 단언한다. JSON은 이 값을 `null`로 바꾸므로, 단언이 없으면 오류가 보류처럼 보일 수 있다.
- 거절 판정 순서는 `UNSUPPORTED_GENERATION` → `NO_TREATMENT_SELECTED` → `INVALID_NUMERIC_INPUT`이다(DD-03).
- 새 보류 코드 `PROFILE_VALUE_INVALID`, `CALC_RANGE_EXCEEDED`는 DD-03 표와 판정 순서, DD-21 첫 번째 분류에 들어 있다. 새 오류 코드 `INTERNAL_ERROR`는 DD-19 오류 표에 있다.
- 시험: AC-006h(줄 금액·T 거절, T 경계 쌍은 AC-003h 10행), AC-003g(프로필 값), AC-003h(공제 방식×원 단위 처리별 계산 범위 경계 사례표, T 경계, 잘라 맞추지 않음), AC-008m(공유 한도 풀 값 결함의 영향 범위), AC-011h(도메인 게시 거절), AC-011i(매핑 필드 규칙·프로필 구조·묶음 교차 검사의 도메인 게시 거절), AC-021f(그 거절이 관리자 API의 400과 어긋난 필드 경로가 되는 변환), AC-006i(500), AC-005a(생성된 결과에 `NaN`·비안전 정수 없음), AC-006f·AC-021a(공개 오류 표와 400/422 층 구분).
