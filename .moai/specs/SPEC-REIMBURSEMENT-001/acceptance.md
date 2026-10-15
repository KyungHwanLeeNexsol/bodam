# SPEC-REIMBURSEMENT-001 — 수용기준 (acceptance.md)

> 이 문서는 검증 기준이다. 요구사항 문장과 그 조건표(`REQ-ENG-002 C3`처럼 인용하는 행)는 spec.md에 있고 여기서 다시 쓰지 않는다. 아래 어느 항목도 아직 실행·렌더링·확인되지 않았다. 모든 항목은 구현 단계에서 처음 판정한다.

## 0. 읽는 법

- 각 수용기준(AC-001~AC-025)은 Given / When / Then 시나리오이며, 같은 시나리오 안의 세부 판정은 `AC-001a`처럼 소문자 접미사로 나눈다. 세부 항목 하나는 plan.md §B의 마일스톤 하나에서만 닫히며, 그 마일스톤은 그 항목이 시험하는 코드가 모두 이미 있는 곳이다(앞 마일스톤은 "증거만 내는 AC"로 일부 증거를 낼 수 있다. 재배정 기록은 plan.md §B.1).
- 검증 표시: `unit`, `integration`, `e2e-app`, `render`, `real-device`. 이 다섯 가지는 이 SPEC이 정한 분류이며, 기획서 §14의 세 단계(파일 확인 / 렌더링 확인 / 앱 동작 검증)와의 대응은 spec.md §2 표를 따른다. 단계는 서로 대신하지 않고, 디자인 파일 확인은 어떤 AC의 통과 근거도 되지 않는다.
- 숫자 예시는 기획서 §6.4·§9의 값만 쓴다. 계산에 쓰는 프로필·매핑·서류 규칙·치료 줄은 `TEST_FIXTURE` 출처로 만든 시험 자료이며, 운영 데이터와 다른 저장소·다른 모듈에 둔다. 기획서 예시 치료 4종(X-ray 급여 10,000 / 초음파 비급여 70,000 / 신장분사치료 비급여 40,000 / 물리치료 급여 4,000)은 `DEMO` 출처 자료이고, 시험은 그 금액을 옮긴 `TEST_FIXTURE` 사본을 쓴다. 이하 이 사본을 "예시 4종"이라 한다.
- 표에 값이 적히지 않은 시험 자료 값(원 단위 처리, 공유 한도 시험 등)과 속성 기반 시험의 시행 수·시드는 구현 단계에서 정해 시험 코드에 고정하고 `TEST_FIXTURE`로 표시한다. 그 값은 운영 값의 근거가 아니다.

## 1. 계산 엔진

### AC-001 결정성과 순수성
요구사항: REQ-ENG-001
- **Given** 같은 `EstimateInput`(같은 버전·같은 주입 시각)이 주어지고 **When** 엔진을 여러 번, 그리고 새 프로세스에서 다시 실행하면 **Then** 직렬화한 결과가 바이트 단위로 같다. 같은 의미의 입력에서 배열 순서만 바꿔도 같다(출력 정렬 규칙은 design.md DD-03 "출력 순서와 순서 독립", 순열 시험은 `AC-008k`). (`AC-001a`, unit)
- **Given** `src/engine`의 가져오기 그래프가 있고 **When** 가져오기 경계 검사를 실행하면 **Then** React·Next·DB 드라이버·`fetch`·`fs`·네트워크 모듈·생성형 AI SDK가 하나도 없고, 주입 없는 `Date.now`·`Math.random` 호출도 없다. 금지 모듈을 일부러 추가한 음성 시험에서는 검사가 실패한다. (`AC-001b`, unit)
- (동작, 주 증거) **Given** 입력을 고정하고 **When** `TEST_FIXTURE` 프로필의 숫자 필드(고정 공제, 각 비율, 급여·비급여 비율, 한도 금액, 1회 사용액, 공유 한도 풀의 한도)를 한 번에 하나씩 바꿔 계산하면 **Then** 그룹 지급액 `P`·`P_pooled`와 전체 금액이 시험 안에서 DD-02의 식으로 따로 써 둔 기준 계산(독립 오라클)이 예측한 값과 정확히 같게 바뀌고, 같은 (세대, 보험사 형태) 칸에 서로 다른 `TEST_FIXTURE` 프로필 둘을 쓰면 결과가 다르다.
- (정적 검사, 좁은 범위) **Given** `src/engine` 소스가 있고 **When** AST로 숫자 리터럴을 검사하면 **Then** 보험 업무 값을 뜻하는 이름(`deduct*`, `limit*`, `rate*`, `payout*`, `copay*`, `fixed*`, `floor*`, `cap*`, `ratio*`)의 식별자·속성에 묶이거나 비교되는 숫자 리터럴이 `src/engine/constants.ts`나 `src/engine/limits.ts`에 선언한 이름 있는 상수가 아니면 검사가 실패한다(정확한 규칙은 M1.4에서 구현자가 정하되 이 예를 만족해야 한다). 엔진에 `const deductible = 10000`을 일부러 더한 음성 시험에서는 검사가 실패하고, 인덱스·카운터·반복 한계·배열 길이로 쓴 숫자는 실패하지 않는다. (`AC-001c`, unit — 위 두 항목을 모두 통과해야 닫힌다)

### AC-002 기획서 계산 예시 재현
요구사항: REQ-ENG-002, REQ-ENG-003
- **Given** 아래 시험 자료 프로필과 예시 4종이 모두 보장 대상으로 매핑되어 있고 **When** 계산하면 **Then** 다음과 같다. 예상 병원 결제액은 모든 행에서 124,000원이다. (`AC-002a`~`AC-002e`, unit)

| 세부 | 시험 자료 프로필 | 예상 보험금 | 보험금 수령 후 예상 본인 부담 | 추가 확인 |
|------|------------------|------------:|-------------------------------:|-----------|
| AC-002a (사례 A) | 한 그룹, `FIXED` 10,000, `PER_VISIT_PAYOUT` 250,000(PAYOUT) | 114,000 | 10,000 | 전체 `ESTIMATED`, `ALL_COVERED_AND_LIMIT_REMAINS` 가정 있음 |
| AC-002b (사례 B) | 한 그룹, `RATE_WITH_FIXED_FLOOR` 10,000 / 2,000bp, `UNLIMITED_DECLARED`(시험용 조항 참조) | 99,200 | 24,800 | D = 24,800 |
| AC-002c (사례 C) | 한 그룹, `SPLIT_RATE_WITH_FIXED_FLOOR` 10,000 / 급여 1,000bp / 비급여 2,000bp, `UNLIMITED_DECLARED` | 100,600 | 23,400 | D = 23,400 |
| AC-002d (사례 D) | 급여 그룹 `CAPPED_RATE_WITH_FIXED_FLOOR` 10,000 / 2,000bp, 일반 비급여 그룹 `CAPPED_RATE_WITH_FIXED_FLOOR` 30,000 / 3,000bp, 두 그룹 모두 `UNLIMITED_DECLARED` | 81,000 (4,000 + 77,000) | 43,000 | 급여 D = 10,000(14,000 아님), 비급여 D = 33,000, 두 공제가 합쳐지지 않음 |
| AC-002e (사례 E) | 한 그룹 `FIXED` 10,000, `UNLIMITED_DECLARED`; 신장분사치료 매핑은 `decision = EXCLUDED`(`groupKey` 없음, 사유 포함. 그룹에는 보장 여부 필드가 없다) | 74,000 | 50,000 | 그룹 E = 84,000(제외 40,000 미포함), 전체 `ESTIMATED_WITH_EXCLUSIONS`, 제외 항목의 `payout` 상수 0과 사유, `ALL_COVERED_AND_LIMIT_REMAINS` 없음 |

- **Given** E = 124,000, `FIXED` 10,000, `PER_VISIT_PAYOUT` 250,000 **When** 계산하면 **Then** P = 114,000이다. (`AC-002f` 고정 공제, unit)
- **Given** 400,000원짜리 `TEST_FIXTURE` 치료 하나와 `FIXED` 10,000, `PER_VISIT_PAYOUT` 250,000 **When** 계산하면 **Then** P = min(390,000, 250,000) = 250,000, 수령 후 부담 150,000이며 240,000이 아니다. (`AC-002g` 한도 순서, unit)
- **Given** 물리치료(4,000)만 고르고 `FIXED` 10,000 **When** 계산하면 **Then** P = 0, 명목 D = 10,000, 실제 적용 D = 4,000, 수령 후 부담 4,000, 전체 상태 `ESTIMATED`이며 0원과 계산 근거가 함께 나온다. (`AC-002h` 작은 비용, unit)
- **Given** X-ray와 물리치료를 같은 그룹 `FIXED` 10,000으로 고르고 **When** 계산하면 **Then** E = 14,000에서 한 번만 공제해 P = 4,000이다(치료마다 공제했다면 0). (`AC-002i` 공제 1회, unit)
- **Given** X-ray(10,000)·초음파(70,000)·물리치료(4,000) 셋이 같은 그룹 `FIXED` 10,000, `PER_VISIT_PAYOUT` 250,000에 매핑되어 있고 **When** 계산하면 **Then** 합계 E = 84,000에서 공제가 정확히 한 번만 적용되어 `GroupResult.P` = 74,000이고 `expectedInsurancePayout`도 74,000이다(치료마다 공제했다면 0 + 60,000 + 0 = 60,000). 같은 그룹에 치료가 셋 이상이어도 공제는 그룹 합계에 한 번이다. `LineResult` 형식에는 금액을 내보내는 필드가 `patientAmount` 하나뿐이고 지급액·보험금·공제분 같은 필드가 없으며(키 집합 전체를 고정해 비교하는 형식 수준 시험, `AC-006d`와 같은 방식), 제외 항목의 `payout`은 `excludedItems[]`에만 있다. (`AC-002j` 줄 단위 지급액 없음, unit)

### AC-003 규칙 모양의 경계
요구사항: REQ-ENG-002, REQ-DATA-002
- **Given** 비율 공제 규칙에 `rounding`이 없고 **When** 계산하면 **Then** 그 그룹의 줄이 `PROFILE_VALUE_MISSING`으로 보류되고 전체가 `ON_HOLD`다. 기본 처리 방식으로 계산하지 않는다. (`AC-003a`, unit)
- **Given** 원 미만 단수가 생기는 `TEST_FIXTURE` 입력 **When** `TRUNCATE`와 `ROUND_HALF_UP` 규칙으로 각각 계산하면 **Then** 각각 버림과 5000을 더한 뒤 버림으로 처리되고, `SPLIT_RATE_WITH_FIXED_FLOOR`는 두 곱의 합에 한 번만 적용된다. (`AC-003b`, unit)
- **Given** 닫힌 목록 밖의 공제 방식, 또는 `limitBasis = COVERED_COST` **When** 계산하면 **Then** 해당 그룹 줄이 `PROFILE_FORMULA_UNSUPPORTED`로 보류된다. (`AC-003c`, unit)
- **Given** `PER_ACCIDENT`, `ANNUAL`, `COUNT` 한도 **When** 계산하면 **Then** 한도가 적용되고 `assumptions`에 `REMAINING_LIMIT_ASSUMED`가 있다. (`AC-003d`, unit)
- **Given** `UNLIMITED_DECLARED`에 조항 참조가 없고 **When** 계산하면 **Then** 그 그룹의 줄이 `PROFILE_SOURCE_INCOMPLETE`로 보류된다. (`AC-003e`, unit)
- **Given** 같은 공유 한도 풀에 든 두 그룹의 지급 합이 풀 한도를 넘는 `TEST_FIXTURE` **When** 계산하면 **Then** 두 그룹 지급 합계 = 풀 한도(한 번만 적용)이고, 줄어든 금액은 `groupOrder` 순서로 배분되며(공유 한도 적용 전 `P`와 적용 후 `P_pooled`가 그룹마다 함께 기록된다), 어느 경우에도 풀 한도를 넘거나 두 번 지급되지 않는다. (`AC-003f`, unit)
- **Given** 프로필 값이 음수, 소수, `NaN`, `Infinity`, 문자열이거나 비율이 0 미만 또는 10000 초과이거나 금액이 `MAX_AMOUNT_WON` 초과인 `TEST_FIXTURE` **When** 계산하면 **Then** 그 그룹의 줄이 `PROFILE_VALUE_INVALID`로 보류되고 전체가 `ON_HOLD`이며 병원 결제액은 숫자다. 값이 없거나 null이면 `PROFILE_VALUE_MISSING`이다. 어느 경우에도 무효 값이 0이나 기본값으로 계산되지 않고, 값이 유효한 다른 그룹은 영향을 받지 않는다. 경계값 `MAX_AMOUNT_WON`과 비율 10000, 0은 유효하다. (`AC-003g`, unit)
- **Given** `TEST_FIXTURE` 프로필(고정 공제 `fixed` = 10,000, 한도 `UNLIMITED_DECLARED`(시험용 조항 참조), 공제 방식·원 단위 처리·비율은 아래 표의 행마다)과, 줄 금액이 각각 `MAX_AMOUNT_WON` 이하인 줄들로 만든 보장 대상 합계 E(`SPLIT`은 급여·비급여 몫 G, N) **When** 아래 표의 각 입력을 계산하면 **Then** 표의 기대대로 정상 계산되거나 그 그룹이 `CALC_RANGE_EXCEEDED`로 보류되고 그 그룹의 `trace`에 표의 실패 단계 이름이 남는다. 경계는 공제 방식·원 단위 처리·비율마다 다르다(design.md DD-24 "계산 단계의 검사 연산 순서"). 곱은 `비율 × 금액`이고 `S = Number.MAX_SAFE_INTEGER = 9007199254740991`, `B = 10000`, `H = 5000`이다. 표의 수는 `S`에서만 유도한 정확한 정수(BigInt 재계산)이며 `MAX_AMOUNT_WON`에 의존하지 않는다. 줄 수는 가져온 `MAX_AMOUNT_WON`에서 올림으로 계산하고 시험에 하드코딩하지 않는다. 정상 행의 `D`·`D_applied`·`P`는 시험 안에서 DD-02 식을 `BigInt`로 따로 쓴 독립 오라클이 내는 값과 정확히 같아야 한다. (`AC-003h`, unit)

| 행 | 공제 방식 | 원 단위 | 비율 | 입력 | 기대 |
|----|-----------|---------|------|------|------|
| 1a | `RATE_WITH_FIXED_FLOOR` | `TRUNCATE` | 10000 | E = 900719925474 | 정상. `rate × E` = 9007199254740000 ≤ S. D = 900719925474, D_applied = 900719925474, P = 0 |
| 1b | 같음 | 같음 | 10000 | E = 900719925475 | `CALC_RANGE_EXCEEDED`, 실패 단계 `RATE_PRODUCT`(9007199254750000 > S) |
| 2a | `RATE_WITH_FIXED_FLOOR` | `TRUNCATE` | 2000 | E = 4503599627370 | 정상. 곱 9007199254740000. D = 900719925474, D_applied = 900719925474, P = 3602879701896 |
| 2b | 같음 | 같음 | 2000 | E = 4503599627371 | `CALC_RANGE_EXCEEDED`, `RATE_PRODUCT`(9007199254742000 > S) |
| 3a | `RATE_WITH_FIXED_FLOOR` | `ROUND_HALF_UP` | 10000 | E = 900719925473 | 정상. 곱 9007199254730000, `+ H` = 9007199254735000 ≤ S. D = 900719925473, D_applied = 900719925473, P = 0 |
| 3b | 같음 | 같음 | 10000 | E = 900719925474 | `CALC_RANGE_EXCEEDED`, 실패 단계 `ROUND_ADD`. 곱 9007199254740000은 S 이하(곱셈은 안전)이나 `+ H` = 9007199254745000 > S(반올림 덧셈에서 넘침). 같은 E가 1a에서는 정상이다 |
| 3c | 같음 | 같음 | 10000 | E = 900719925475 | `CALC_RANGE_EXCEEDED`, 실패 단계는 곱이 먼저 넘치므로 `RATE_PRODUCT`(곱 9007199254750000 > S, `ROUND_ADD`가 아님) |
| 4a | `RATE_WITH_FIXED_FLOOR` | `ROUND_HALF_UP` | 2000 | E = 4503599627367 | 정상. 곱 9007199254734000, `+ H` = 9007199254739000. D = 900719925473, D_applied = 900719925473, P = 3602879701894 |
| 4b | 같음 | 같음 | 2000 | E = 4503599627368 | `CALC_RANGE_EXCEEDED`, `ROUND_ADD`. 곱 9007199254736000은 안전하나 `+ H` = 9007199254741000 > S |
| 4c | `RATE_WITH_FIXED_FLOOR` | `TRUNCATE` | 2000 | E = 4503599627368 | 정상(4b와 같은 E). D = 900719925473, P = 3602879701895. E = 4503599627369, 4503599627370도 `TRUNCATE`에서는 정상이다 |
| 5a | `CAPPED_RATE_WITH_FIXED_FLOOR` | `TRUNCATE` | 10000 | E = 900719925474 / E = 900719925475 | 앞은 정상. D = min(E, max(10000, 900719925474)) = 900719925474, P = 0. 뒤는 `CALC_RANGE_EXCEEDED`, `RATE_PRODUCT` |
| 5b | `CAPPED_RATE_WITH_FIXED_FLOOR` | `ROUND_HALF_UP` | 2000 | E = 4503599627367 / E = 4503599627368 | 앞은 정상. D = 900719925473, P = 3602879701894. 뒤는 `CALC_RANGE_EXCEEDED`, `ROUND_ADD` |
| 6a | `SPLIT_RATE_WITH_FIXED_FLOOR` | `TRUNCATE` | 10000 / 10000 | (G, N) = (450359962737, 450359962737) | 정상. p1 = p2 = 4503599627370000, s = 9007199254740000 ≤ S. E = 900719925474, D = 900719925474, D_applied = 900719925474, P = 0 |
| 6b | 같음 | 같음 | 10000 / 10000 | (G, N) = (450359962737, 450359962738) | `CALC_RANGE_EXCEEDED`, 실패 단계 `SPLIT_SUM`. p1 = 4503599627370000과 p2 = 4503599627380000은 각각 안전하나 s = 9007199254750000 > S(곱은 모두 안전하고 합에서 넘침) |
| 7a | `SPLIT_RATE_WITH_FIXED_FLOOR` | `ROUND_HALF_UP` | 10000 / 10000 | (G, N) = (450359962736, 450359962737) | 정상. s = 9007199254730000, `s + H` = 9007199254735000 ≤ S. E = 900719925473, D = 900719925473, P = 0 |
| 7b | 같음 | 같음 | 10000 / 10000 | (G, N) = (450359962737, 450359962737) | `CALC_RANGE_EXCEEDED`, 실패 단계 `ROUND_ADD`. s = 9007199254740000은 S 이하이나 `s + H` = 9007199254745000 > S. 같은 쌍이 6a에서는 정상이다(원 단위 처리가 경계를 바꾼다). 반올림은 합에 한 번만 한다 |
| 8a | `SPLIT_RATE_WITH_FIXED_FLOOR` | `TRUNCATE`, `ROUND_HALF_UP` 각각 | rateBenefit 10000 | G = 900719925475, N = 0 | `CALC_RANGE_EXCEEDED`, `SPLIT_PRODUCT_BENEFIT`(p1 = 9007199254750000 > S, 곱 하나가 넘침) |
| 8b | 같음 | 같음 | rateNonBenefit 10000 | G = 0, N = 900719925475 | `CALC_RANGE_EXCEEDED`, `SPLIT_PRODUCT_NON_BENEFIT`(p2 = 9007199254750000 > S). G = N = 900719925475이면 처음 실패한 `SPLIT_PRODUCT_BENEFIT`가 기록된다 |
| 9a | `RATE_WITH_FIXED_FLOOR` | `TRUNCATE`, `ROUND_HALF_UP` 각각 | 0 | E = 900719925475 | 정상(곱이 0이라 넘치지 않음). D = 10000, D_applied = 10000, P = 900719915475 |
| 9b | `SPLIT_RATE_WITH_FIXED_FLOOR` | `TRUNCATE`, `ROUND_HALF_UP` 각각 | rateBenefit 0, rateNonBenefit 10000 | G = 900719925475, N = 0 | 정상. 두 곱이 0. D = 10000, D_applied = 10000, P = 900719915475 |
| 9c | `FIXED` 10000 | — | — | E = 900719925475 | 정상(곱이 없음). D = 10000, D_applied = 10000, P = 900719915475. 함수 수준: E = S이면 P = S − 10000 = 9007199254730991 (줄로 만들기 어려운 크기이므로 그룹 계산 함수를 직접 부른다) |
| 10 | 줄 금액 합 T | — | — | 함수 수준과 엔진 수준 | 함수 수준: `checkedAdd(S − 1, 1)` = S 통과, `checkedAdd(S, 1)` 거절. 엔진 수준: 줄 금액은 모두 유효하나 합 T > S이면 보류가 아니라 계산 거절 `INVALID_NUMERIC_INPUT`이고 결과 객체도 그룹 결과도 없다(AC-006h). 줄로 만들려면 `ceil((S + 1) / MAX_AMOUNT_WON)`줄이 필요하다(제안값 1_000_000_000이면 9007200줄). 구현이 그 크기의 입력을 감당하지 못하면 `estimate()`가 쓰는 합산 함수(`sumLineAmounts`)를 시험 대역으로 바꿔 넘침을 일으켜 `estimate()`가 보류가 아니라 거절하는지 시험해도 된다. 함수 수준 쌍은 어느 쪽이든 필수다 |

- 잘라 맞추지 않음(11). 1b 입력(RATE, `TRUNCATE`, 10000, E = 900719925475)과 둘째 그룹(`FIXED` 10,000, E = 84,000, 공유 풀 없음)을 한 프로필에 둔 입력을 계산하면: 첫 그룹만 `CALC_RANGE_EXCEEDED`로 보류되고 그 그룹의 `D`·`D_applied`·`P`·`P_pooled`가 모두 null이며 부분 계산값이 없다. 둘째 그룹은 정상(P = 74,000)이고 `referenceGroups`에 `isReference: true`로 있다. 전체는 `ON_HOLD`이고 보험금 두 값은 null이며 `hospitalPayment`는 두 그룹 줄 금액의 정확한 합 900720009475이다. 프로필 객체는 계산 전후 깊은 비교로 같다(비율 10000이 줄어들지 않음). 같은 E에서 비율만 9999로 낮춘 프로필은 `TRUNCATE`와 `ROUND_HALF_UP` 모두 정상 계산된다: 곱 9006298534824525, D = 900629853482, P = 90071993. 보류된 그룹의 결과가 낮춘 비율로 계산한 값으로 대신 채워지지 않는다. 어느 경우에도 감겨 돌아간 값이나 정밀도를 잃은 값이 결과에 나오지 않는다.
- 처리 구분: 줄 금액 또는 T가 넘치면 계산 거절(`INVALID_NUMERIC_INPUT`), 프로필 값 무효는 `PROFILE_VALUE_INVALID`(AC-003g), 그룹의 비율 곱·합이 넘치면 그 그룹만 `CALC_RANGE_EXCEEDED`, 게시 입력은 거절(AC-011h)이다.

### AC-004 결과 상태와 0원의 의미
요구사항: REQ-ENG-003, REQ-ENG-004
- **Given** 정상 계산 결과가 0원인 입력(AC-002h) **When** 결과를 만들면 **Then** 예상 보험금 0, 계산 근거에 공제 단계가 있다. (`AC-004a`, unit)
- **Given** 모든 줄이 확인된 제외 **When** 계산하면 **Then** 전체 `ESTIMATED_WITH_EXCLUSIONS`, 예상 보험금 0, 수령 후 부담 = 예상 병원 결제액, 각 제외 항목에 상수 `payout` 0과 사유가 있다. (`AC-004b`, unit)
- **Given** 보류 줄이 있는 입력 **When** 계산하면 **Then** 예상 보험금과 수령 후 부담이 모두 null이고 예상 병원 결제액은 124,000(예시 4종)이며 어디에도 0이 들어가지 않는다. (`AC-004c`, unit)
- **Given** 사례 D 시험 자료에서 신장분사치료 매핑만 없음 **When** 계산하면 **Then** 신장분사치료 줄은 `MAPPING_ABSENT`로 `ON_HOLD`이고 어느 그룹에도 없으며(`groupKey` 없음), 급여 그룹(X-ray·물리치료, E = 14,000)은 P = 4,000, 일반 비급여 그룹(초음파만, E = 70,000, D = 30,000)은 P = 40,000으로 둘 다 `referenceGroups`에 `isReference: true`로 들어간다. 같은 자료에서 두 그룹을 한 공유 풀로 묶고 다른 그룹 하나를 그룹 단위 보류(`PROFILE_FORMULA_UNSUPPORTED`)로 같은 풀에 넣으면 그 풀의 그룹은 `referenceGroups`에 없다. (`AC-004d`, unit)
- **Given** 상태별 입력 **When** `assumptions`를 확인하면 **Then** 모든 줄 `ESTIMATED`일 때만 `ALL_COVERED_AND_LIMIT_REMAINS`, 제외가 섞이면 `REMAINING_COVERED_AND_LIMIT_REMAINS`, `ON_HOLD`를 포함한 모든 결과에 `PERSONAL_CONTRACT_NOT_CONFIRMED`가 있고, `ON_HOLD`에는 `STANDARD_PROFILE_APPLIED`가 없다. (`AC-004e`, unit)
- **Given** 세 경우 **When** 계산하면 **Then** (1) 공통 기본비용이 없으면 `baseFeeIncluded = NOT_REGISTERED`이고 병원 결제액에 기본비용이 없다; (2) `TEST_FIXTURE` 기본비용이 등록되어 사용 가능한 매핑이 있으면 `INCLUDED`이고 병원 결제액에 그 금액이 더해지며 그 줄도 계산된다; (3) 등록되었으나 매핑이 없으면 `INCLUDED`이고 병원 결제액에 그 금액이 더해지며 그 줄은 `MAPPING_ABSENT`로 보류되어 전체가 `ON_HOLD`다. (`AC-004f`, unit)
- **Given** 계산된 결과 **When** `basis`를 확인하면 **Then** 사용 버전, 프로필 id·버전·출처, 약관 출처 참조, 그룹별 E·명목 D·실제 D·L·P·`P_pooled`(공유 한도 풀이 있으면 풀 키 포함) 단계가 있다. (`AC-004g`, unit)
- **Given** 공유 한도 풀이 있는 계산 결과(풀 한도가 지급 합보다 작은 `TEST_FIXTURE`) **When** 출력을 서로 비교하면 **Then** `Σ P_pooled` = `expectedInsurancePayout`이고, `hospitalPayment − expectedInsurancePayout` = `expectedOutOfPocketAfterPayout`이며, 풀마다 `Σ P_pooled` = `min(Σ P, 풀 한도)`이고 모든 그룹에서 `P_pooled ≤ P`이다. `basis`, `groups[]`, `amounts`, 직렬화한 결과가 서로 어긋나지 않는다. 프로필의 `groupOrder`를 바꾸면 그룹별 몫은 바뀌지만 `expectedInsurancePayout`은 바뀌지 않는다. (`AC-004h`, unit)

### AC-005 불변 조건 (속성 기반)
요구사항: REQ-ENG-002, REQ-ENG-003
- **Given** 고정 시드로 무작위 생성한 `TEST_FIXTURE` 입력(치료 수·금액·그룹·공제 방식·한도·제외·보류 조합, 시행 수와 시드는 시험 코드에 고정해 출력에 기록) **When** 계산하면 **Then** 모든 시행에서: 0 ≤ 예상 보험금 ≤ 예상 병원 결제액; 보류가 없으면 예상 보험금 + 수령 후 부담 = 예상 병원 결제액; 두 값은 함께 null이거나 함께 정수; 그룹마다 0 ≤ `P_pooled` ≤ P ≤ E; 보류가 없으면 `Σ P_pooled` = 예상 보험금; 공유 풀 지급 합(`Σ P_pooled`) ≤ 풀 한도; 음수 금액 없음; 보류 줄의 금액이 어느 그룹 E에도 없음; 생성된 어떤 결과에도 `NaN`·`Infinity`·안전 정수가 아닌 수가 없음. 생성 범위에는 `AC-003h` 표의 경계 근처 값(정상 최대와 첫 초과, ±1)을 섞어, 그 시행의 결과가 정상 계산이거나 그룹 `CALC_RANGE_EXCEEDED` 보류이고 어느 쪽도 위 불변 조건을 지킨다. (`AC-005a`, unit)

### AC-006 입력 범위와 치료 원인 분리
요구사항: REQ-ENG-004, REQ-API-004
- **Given** 세대 값이 열거 밖(예: 5세대) **When** 엔진에 넣으면 **Then** `UNSUPPORTED_GENERATION`으로 거절되고 4세대 프로필 조회가 일어나지 않는다. (`AC-006a`, unit)
- **Given** 치료 0개 **When** 엔진에 넣으면 **Then** `NO_TREATMENT_SELECTED`로 거절되며 0원 결과가 없다. (`AC-006b`, unit)
- **Given** 같은 치료 ID가 중복된 입력 **When** 계산하면 **Then** 한 번만 계산되어 예시 4종의 병원 결제액이 124,000이다(줄의 내용이 완전히 같을 때. 객체 정체성이나 키 순서가 달라도 같은 줄이다). 같은 치료 ID의 줄이 둘 이상인데 내용이 하나라도 다르면(가격, 버전 ID, 급여 구분, 계산 분류, 지문, 출처, 표시 이름, 서류 표시, `isBaseFee` 중 무엇이든) 어느 줄도 고르거나 합하지 않고 `INPUT_INTEGRITY_VIOLATION`(사유 `CONFLICTING_DUPLICATE_TREATMENT_LINE`, 공통 기본비용 줄은 `CONFLICTING_DUPLICATE_BASE_FEE_LINE`, 둘 다 충돌하면 치료 줄 사유)으로 거절한다. 줄의 순서와 중복 줄의 위치(세 줄 이상이면 모든 순열)를 바꿔도 거절이 같고, `estimate()`는 결과 객체 없이 같은 거절을 낸다. 거절에는 치료 ID·금액·내부 상세가 없다. (`AC-006c`, unit)
- **Given** 원인만 `INJURY` / `ILLNESS` / `UNKNOWN`으로 다른 세 입력 **When** 엔진과 서류 산출을 따로 실행하면 **Then** 엔진 결과가 바이트 단위로 같고(출력 순서 규칙은 design.md DD-03 "출력 순서와 순서 독립"), `estimate()` 형식에 원인 인자가 없다(형식 수준 시험). (`AC-006d`, unit)
- **Given** 계산 가능한 입력에 원인 `UNKNOWN` **When** 계산하면 **Then** 전체 상태가 `ON_HOLD`가 아니고 `holdReasons`가 비어 있다. (`AC-006e`, unit)
- **Given** `generation`이 다섯 값 밖의 문자열(예: 5세대)이거나 `treatmentIds`가 빈 배열인 요청 **When** `POST /api/clinics/{slug}/estimate`를 부르면 **Then** 각각 422 `UNSUPPORTED_GENERATION`, 422 `NO_TREATMENT_SELECTED`다. 400과 422의 층 구분(design.md DD-19 "요청 검증의 층")도 함께 확인한다: 본문이 JSON이 아님, 필수 필드(`catalogVersion`, `ruleBundleVersion`, `generation`, `insurerType`, `cause`, `treatmentIds`) 누락, JSON 형식이 틀림(`generation`·`insurerType`·`cause`가 문자열이 아님, `treatmentIds`가 배열이 아니거나 문자열이 아닌 요소를 가짐), `insurerType`이나 `cause`가 열거 밖의 문자열이면 모두 400 `INVALID_REQUEST`이고 422가 아니다. 반대로 `generation`이 문자열이지만 다섯 값 밖이면 400이 아니라 422 `UNSUPPORTED_GENERATION`이다. 요청 본문의 다른 필드는 어느 층에서도 검사하지 않는다. 층 사이의 순서(400 → 422 → 409 → 422 → 계산)는 겹침 사례로 `AC-021h`~`AC-021m`이 확인한다. 이 항목의 입력은 모두 버전이 현재 값과 같다. (`AC-006f`, integration)
- **Given** 원인만 다른 세 API 요청 **When** 응답을 비교하면 **Then** `result` 블록이 바이트 단위로 같다. (`AC-006g`, integration)
- **Given** 줄(치료·공통 기본비용) 금액이 음수(`-0` 포함), 소수, `NaN`, `Infinity`, `-Infinity`, 문자열, `MAX_AMOUNT_WON` 초과인 입력, 그리고 줄 금액은 모두 유효하나 합 T가 안전 정수 범위를 넘는 입력(경계 쌍 `checkedAdd(S − 1, 1)` 통과 / `checkedAdd(S, 1)` 거절과 줄이 아주 많은 입력의 시험 방법은 `AC-003h` 10행) **When** 엔진에 넣으면 **Then** 모두 `INVALID_NUMERIC_INPUT`으로 거절되고(`UNSUPPORTED_GENERATION`처럼 거절이며 보류가 아니다) 결과 객체가 없으며 0도 `NaN`도 나오지 않는다. 경계값 0과 `MAX_AMOUNT_WON`은 유효하고 `MAX_AMOUNT_WON + 1`은 거절된다(가져온 상수로 시험). 거절 판정 순서는 `UNSUPPORTED_GENERATION`, `NO_TREATMENT_SELECTED`, `INPUT_INTEGRITY_VIOLATION`, `INVALID_NUMERIC_INPUT`이다. 내용이 다른 중복 쌍에 무효 금액이 섞이면 충돌이 먼저(`INPUT_INTEGRITY_VIOLATION`)이고, 내용이 완전히 같은 중복의 무효 금액(예: 둘 다 `NaN`)과 중복되지 않은 무효 금액은 `INVALID_NUMERIC_INPUT`이다(값 비교는 `Object.is` 의미: `NaN`은 같고 `-0`은 `0`과 다르다). 형식이 깨진 줄(null, 비객체, `treatmentId` 없음)은 던지지 않고 `INVALID_NUMERIC_INPUT`으로 거절한다. (`AC-006h`, unit)
- **Given** 저장소에서 게시 검증을 거치지 않고 줄 금액을 무효로 만든 서버 상태(메모리 저장소에 직접 주입) **When** `POST /api/clinics/{slug}/estimate`를 부르면 **Then** HTTP 500 `INTERNAL_ERROR`이고 응답에 금액이 없으며 스택·필드 값·내부 코드 같은 내부 상세가 새지 않는다. (키오스크의 5xx 처리는 `AC-013d`가 이미 다룬다.) 같은 방식으로 같은 `treatmentId`의 줄이 내용이 달라 충돌하는 서버 상태(엔진의 `INPUT_INTEGRITY_VIOLATION`)도 HTTP 500 `INTERNAL_ERROR`이고 금액·치료 ID·내부 상세가 없다 — **M4 · 미구현**(이 API 매핑은 계약 요구사항이며 아직 구현되지 않았다). **M4 · 미구현 (필수 하위 기준):** M1 엔진이 검사하지 않는 서버 책임 네 가지 — (a) 선택한 `treatmentId`에 게시된 줄이 없음, (b) 선택하지 않은 `treatmentId`의 줄이 엔진 입력에 들어감, (c) 같은 `treatmentId`가 `lines`와 `baseFeeLines` 양쪽에 있음, (d) `isBaseFee` 표시가 줄이 든 배열과 어긋남 — 각각에 대해 서버의 줄 조립이 그 입력을 엔진에 넘기지 않는다는 통합 시험이 있어야 한다(위반이 생기면 결과 없이 처리하며 요청 거절인지 500인지는 M4 설계에서 정한다). 이 네 가지는 구현도 시험도 되지 않았고 M1 엔진의 보장이 아니다. (`AC-006i`, integration)

### AC-007 필요 서류 산출
요구사항: REQ-ENG-005, REQ-DATA-005, REQ-FLOW-003
- **Given** 기획서 §4 조건부 매핑 예시를 옮긴 `TEST_FIXTURE` 서류 규칙 묶음("검증 필요" 표시) **When** 서류를 산출하면 **Then** 어떤 입력에서도 9줄이 나오고 `RECEIPT_AND_ITEMIZED` 줄은 항상 필요로 표시된다. (`AC-007a`, unit)
- **Given** 원인 `INJURY`(또는 `ILLNESS`) **When** 산출하면 **Then** 초진기록지(또는 진단서)가 사유와 함께 필요로 표시되고, 한 줄을 여러 규칙이 요구하면 우선순위가 가장 높은 규칙의 사유 하나만 나온다. (`AC-007b`, unit)
- **Given** 기획서 §4 조건부 매핑 예시를 옮긴 `TEST_FIXTURE` 서류 규칙 묶음(예시 규칙 묶음), 원인 `UNKNOWN`, 영상·조직검사·소견 표시가 없는 치료 **When** 산출하면 **Then** 이 예시 규칙 묶음에서는 `COMMON` 7줄, 초진기록지 `INJURY_ONLY`, 진단서 `ILLNESS_ONLY`이며 원인 하나로 정해지지 않는다. 이 7+1+1은 예시 묶음의 결과이지 일반 규칙이나 상한이 아니다(AC-007h). (`AC-007c`, unit)
- **Given** 사용 가능한 서류 규칙 묶음이 없음(규칙 허용 출처가 `OPERATING`뿐인데 `TEST_FIXTURE`만 있는 경우 포함) **When** 결과가 `ON_HOLD`가 아니면 **Then** `documents.state = RULES_UNAVAILABLE`이다. (`AC-007d`, unit)
- **Given** 전체 결과 `ON_HOLD` **When** 서류를 산출하면 **Then** null이다. (`AC-007e`, unit)
- **Given** 규칙을 평가하면 상해 전용 줄이 2줄 이상이거나 질병 전용 줄이 2줄 이상 나오는 서류 규칙 묶음 **When** 게시를 시도하면 **Then** 게시된다(전용 줄의 수는 거절 사유가 아니다). **Given** 닫힌 10종 밖의 문서 코드, `reason`이나 `priority`가 빠진 규칙, 해석할 수 없는 줄 키, 출처·약관 출처·승인자·내용 해시 누락, `when`이 객체가 아님, `when`의 알 수 없는 키, 열거 밖의 `cause`·`setting`·`insurerType` 값, `true`가 아닌 `imaging`·`biopsy`·`opinionRequired` 값(`false`·`1`·문자열 `"true"`·`null` 각각), 0 미만·소수·`NaN`·`Infinity`·`Number.MAX_SAFE_INTEGER` 초과·문자열인 `priority` 가운데 하나라도 있는 묶음 **When** 게시를 시도하면 **Then** 어긋난 규칙 경로(예: `rules[3].when.imaging`, `rules[3].priority`)와 함께 거절되고 아무것도 저장되지 않는다(저장소 전후 비교가 같다). 결함을 모두 고친 묶음은 게시되며 `when: {}`와 `priority` 0, `Number.MAX_SAFE_INTEGER`는 거절 사유가 아니다(design.md DD-06 "규칙 평가" 9번). (`AC-007f`, integration)
- **Given** `RULES_UNAVAILABLE`인 결과와 `ON_HOLD` 결과 **When** 화면을 조작하면 **Then** 전자는 서류 화면에 서류 목록 대신 안내 문구가 보이고 "결과로 돌아가기"·"이용 완료"와 공통 "처음으로"가 그대로 있으며(기획서 §4 서류 화면 구성), 결과 화면의 여섯 동작도 그대로다. 후자는 서류 화면으로 가는 버튼이 없다. (`AC-007g`, e2e-app)
- **Given** 규칙을 평가하면 상해 전용 2줄·질병 전용 3줄이 되는 `TEST_FIXTURE` 서류 규칙(상해 전용 0줄·질병 전용 4줄, 둘 다 0줄인 경우도 함께) **When** 원인 `UNKNOWN`으로 산출하면 **Then** 세 경우 모두 9줄 키가 정확히 한 번씩 나오고 범위 표시(`COMMON` / `INJURY_ONLY` / `ILLNESS_ONLY`)가 규칙 평가와 맞으며, 필요한 줄마다 사유가 있고, 빠진 줄도 중복된 줄도 없다. 두 평가의 사유가 다른 `COMMON` 줄은 서로 다른 사유를 모두 우선순위 순으로 가지고 같으면 하나만 가진다. `RECEIPT_AND_ITEMIZED` 줄은 어느 경우에도 필요이고 원인이 하나로 정해지지 않는다. (`AC-007h`, unit)
- **Given** AC-007h와 같은 경우(상해 전용 2줄·질병 전용 3줄 등) **When** 원인 모름 서류 화면을 세로, 가로, 큰 글자 보기로 그리면 **Then** 모든 줄에 도달할 수 있고(분기별 묶음을 세로로 쌓거나 열을 늘리고, 그래도 들어가지 않으면 "이전 목록 / 다음 목록"으로 나눈다. SPEC 제안이며 최종 선택은 M6), 목록을 나누어도 줄이 빠지거나 페이지를 넘어 반복되지 않고, 체크와 사유가 유지되며, 선택과 결과가 그대로이고, 잘림·겹침·조작 불가가 없다. (`AC-007i`, render + e2e-app)
- **Given** 규칙이 없으면 필요하지 않은 줄(예: `MEDICAL_OPINION`)을 대상으로 하는 `TEST_FIXTURE` 규칙 하나를 더한 서류 규칙 묶음과 그 규칙이 없는 묶음 **When** `when`의 키 `cause`, `setting`, `insurerType` 각각에 대해 입력을 바꿔 산출하면 **Then** (1) 조건이 입력과 맞을 때만 결과가 달라진다: 그 줄이 필요로 바뀌고 그 규칙의 사유가 붙는다(`cause`는 단일 원인에서는 `INJURY`·`ILLNESS` 각각, 원인 `UNKNOWN`에서는 맞는 쪽의 전용 줄로 나온다); (2) 조건이 맞지 않으면 결과가 규칙이 없는 묶음의 결과와 바이트 단위로 같다(`insurerType`은 세 값 각각, `setting: 'OUTPATIENT'`는 맞고 `setting: 'INPATIENT'`는 어떤 입력에서도 맞지 않는다); (3) 두 조건을 가진 규칙(세 키의 모든 쌍, 키 하나와 플래그 하나의 쌍)은 두 조건이 모두 맞을 때만 효과가 있고 하나만 맞으면 규칙이 없을 때와 바이트 단위로 같다; (4) 빠진 키는 제약이 아니다(`{ cause: 'INJURY' }` 규칙은 세 보험사 형태와 모든 플래그 조합에서 같이 맞는다); (5) `when: {}`인 규칙은 원인 세 값 × 보험사 형태 세 값의 모든 입력에서 맞는다. (`AC-007j`, unit — design.md DD-06 "규칙 평가" 1·5·6번)
- **Given** 선택한 치료 셋(중복 없음)과 `imaging`·`biopsy`·`opinionRequired` 가운데 하나를 `true`로 요구하는 규칙(대상 줄은 규칙이 없으면 필요하지 않은 줄) **When** 그 표시를 가진 치료를 첫째·둘째·셋째 자리로 바꿔 가며 치료 배열의 모든 순열(6가지)로 산출하면 **Then** 세 플래그 각각에서: 셋 가운데 하나라도 그 표시를 가지면 자리와 순열에 관계없이 같은 결과이고 그 줄이 사유와 함께 필요하다; 둘 이상이 가져도 결과가 같다(OR); 어느 치료도 그 표시를 갖지 않으면 규칙이 없을 때와 바이트 단위로 같다. 같은 줄로 가는 규칙이 여럿이면 하나라도 맞을 때 필요하다(서로 다른 `documentCode`인 `RECEIPT`·`ITEMIZED_STATEMENT`가 한 줄 `RECEIPT_AND_ITEMIZED`로 가는 경우 포함). `RECEIPT_AND_ITEMIZED` 줄은 맞는 규칙이 있든 없든 필요하고, 규칙이 없을 때 사유가 없으며 사유 없이 필요한 줄은 이 줄뿐이다. 함수는 `treatments`의 모든 요소를 줄 상태와 관계없이 센다(입력 형식에 줄 상태가 없다는 형식 수준 시험). 서버가 확인된 제외 치료까지 선택한 모든 치료를 넘기고 공통 기본비용 줄은 넘기지 않는지는 `AC-019d`가 증명한다. (`AC-007k`, unit — DD-06 "규칙 평가" 1~4번)
- **Given** 같은 줄로 가는 맞는 규칙이 둘 이상인 서류 규칙 묶음 **When** 산출하면 **Then** (1) `priority`가 작은 규칙의 사유가 나온다(0, 1, `Number.MAX_SAFE_INTEGER`가 섞인 경우 포함); (2) `priority`가 같고 사유가 다르면 `reason`의 유니코드 코드 포인트 순에서 앞선 사유가 나오며 UTF-16 코드 유닛 순과 갈리는 쌍(U+FF5E 한 글자와 U+1F600 한 글자)을 포함해 시험한다; (3) `priority`와 사유가 모두 같으면 어느 규칙이든 같은 출력이다; (4) `rules` 배열의 모든 순열(규칙이 6개 이하일 때)과 고정 시드 순열(그보다 많을 때, 시드와 시행 수는 시험 코드에 고정해 출력에 기록)에서, 그리고 선택한 치료 배열의 순열에서 서류 결과가 바이트 단위로 같다; (5) 원인 `UNKNOWN`에서 원인별·보험사 형태별·플래그·`setting`·`when: {}` 규칙을 섞은 묶음에서도 9줄 키가 세 범위 가운데 정확히 한 곳에 한 번씩 나오고, 두 평가의 사유가 다른 `COMMON` 줄은 서로 다른 사유를 우선순위 순으로(우선순위가 같으면 상해 평가의 사유가 먼저) 모두 가지며 사유가 같으면 하나만 가진다(`AC-007h`의 기존 동작 유지). (`AC-007l`, unit — DD-06 "규칙 평가" 6~8번)

## 2. 규칙 데이터

### AC-008 보류 행렬
요구사항: REQ-DATA-001, REQ-DATA-002, REQ-ENG-002, REQ-ENG-003
- **Given** 예시 4종이 모두 사용 가능하게 매핑되어 있고 프로필만(마지막 행은 규칙 묶음 상태만) 아래 상태로 바꾼 매개변수 시험 **When** 계산하면 **Then** 모든 줄이 해당 코드로 `ON_HOLD`, 예상 보험금·수령 후 부담 null이다. (`AC-008a`, unit)

| 프로필 상태 | 기대 코드 |
|-------------|-----------|
| 기록 없음 | `PROFILE_ABSENT` |
| 출처 `DEMO`, 규칙 허용 출처가 `OPERATING`뿐일 때의 `TEST_FIXTURE` | `PROFILE_DEMO` |
| `DRAFT` | `PROFILE_DRAFT` |
| `REVIEW_REQUESTED`, `REJECTED`, `APPROVED`(미게시) | `PROFILE_UNAPPROVED` |
| `UNDER_REREVIEW` | `PROFILE_UNDER_REREVIEW` |
| `SUPERSEDED`, `EXPIRED`, `SUSPENDED`, 유효 기간 밖, 내용 해시 불일치 | `PROFILE_INVALID` |
| 약관 출처 6항목 중 하나 누락, 승인자 누락 | `PROFILE_SOURCE_INCOMPLETE` |
| 구조 결함(각각 따로 시험): 빈 `groupKey`, 중복 `groupKey`, 빈 `poolKey`, 중복 `poolKey`, 없는 풀을 가리키는 `sharedLimitPoolKey`, `groupOrder`에서 빠진 키, `groupOrder`의 중복 키, `groupOrder`의 없는 키, 그룹이 하나도 없는 빈 프로필 | `PROFILE_INVALID` (모든 줄. 나머지 값은 모두 유효하고 프로필은 그 밖의 검사를 통과한 상태) |
| 같은 (세대, 보험사 형태) 칸에 프로필이 둘 이상(둘 다 다른 면에서는 사용 가능) | `PROFILE_INVALID` (모든 줄. 하나를 골라 쓰지 않는다) |
| (묶음 단위) 규칙 묶음 상태 `SUSPENDED`, 버전·내용 해시·규칙 사용 범위는 그대로, 프로필은 사용 가능 | `RULE_BUNDLE_SUSPENDED` |

- **Given** 내용이 같은 프로필의 `groups`·`sharedLimitPools`를 다른 배열 순서로 저장하고 `contentHash`는 원래 순서에서 한 번 계산한 값을 그대로 둔 입력(그룹 순열 전부 × 풀 순열 전부) **When** 사용 가능 판정과 계산을 하면 **Then** 해시 입력(`profileContent`)이 바이트 단위로 같고 프로필은 사용 가능하며 계산 결과도 같다. 실제 규칙 값(고정 공제, 한도 금액, 그룹의 `sharedLimitPoolKey`, 풀 한도, `groupKey` 이름, 그룹·풀의 추가·삭제)이나 `groupOrder`가 바뀐 프로필이 옛 `contentHash`를 그대로 가지면 `INTEGRITY_MISMATCH` → `PROFILE_INVALID`다(해시를 다시 만들어 맞추지 않는다). `groupOrder`는 정렬하지 않는 의미 있는 데이터다. 중복 `groupKey`·`poolKey`나 배열이 아닌 값 같은 구조 결함은 정렬로 고쳐 쓰지 않고 구조 검사에서 `PROFILE_INVALID`다. (`AC-008a`, unit — 프로필 해시 입력 정규화, 외부 검토 수정 M1.5)

- **Given** 프로필은 사용 가능하고 신장분사치료 매핑만 아래 상태로 바꾼 매개변수 시험 **When** 계산하면 **Then** 그 줄만 해당 코드로 `ON_HOLD`, 나머지 줄은 `ESTIMATED`, 전체 `ON_HOLD`다. (`AC-008b`, unit)

| 매핑 상태 | 기대 코드 |
|-----------|-----------|
| 기록 없음 | `MAPPING_ABSENT` |
| `DRAFT`, `REVIEW_REQUESTED`, `APPROVED`(미게시) | `MAPPING_UNREVIEWED` |
| `REJECTED` | `MAPPING_REJECTED` |
| `UNDER_REREVIEW`, 또는 지문 불일치(후보 하나의 `isUsable` 마지막 검사) | `MAPPING_UNDER_REREVIEW` |
| `SUPERSEDED`, `EXPIRED`, `SUSPENDED`, 유효 기간 밖, 약관 출처 누락, 승인자 누락, 허용 출처 밖(`DEMO`, 운영 허용 출처의 `TEST_FIXTURE`) | `MAPPING_INVALID` |
| **사용 가능한** 매핑이 2개 이상(후보 전체 중 지문까지 통과한 것이 둘 이상. 상세 행렬은 `AC-008h`) | `MAPPING_INVALID` |
| 사용 가능한 `COVERED` 매핑의 `groupKey`가 프로필에 없음 | `MAPPING_GROUP_NOT_IN_PROFILE` |
| `decision = EXCLUDED`인 매핑이 위의 어느 사용 불가 상태(미검토, 반려, 재검토 중, 무효, 지문 불일치, 허용 밖 출처, 약관 출처·승인자 누락) | 제외 확인이 아니라 그 상태의 보류 코드(`EXCLUDED_CONFIRMED`가 되지 않는다. 상세는 `AC-008j`) |

- **Given** 신장분사치료 치료 버전의 `calcClass = NEEDS_REVIEW` **When** 계산하면 **Then** 그 줄이 `CLASSIFICATION_NEEDS_REVIEW`로 보류된다. (`AC-008c`, unit)
- **Given** (2세대(C1), 손해보험사) 칸은 프로필이 없고 (2.5세대(C2), 손해보험사)와 (2세대(C1), 생명보험사) 칸에는 사용 가능한 프로필이 있음 **When** (2세대(C1), 손해보험사)로 계산하면 **Then** `PROFILE_ABSENT`, 값 null이며 다른 칸의 값·평균·0원·전액 보장이 쓰이지 않는다. (`AC-008d`, unit)
- **Given** 한 줄에 둘 이상의 사유가 함께 해당하는 조합(프로필 사유와 매핑 사유, 프로필 구조 결함과 매핑 사유, 줄 출처와 매핑 사유, 분류 확인 필요와 매핑 사유, 매핑 사유와 그룹 단위 `PROFILE_SOURCE_INCOMPLETE` 등) **When** 계산하면 **Then** design.md DD-03의 판정 순서(묶음 → 프로필 칸 조회 → 프로필 `isUsable` → 프로필 구조 → 줄 출처 → 분류 → 매핑 조회 → `groupKey` → 그룹 단위)대로 첫 번째 코드 하나만 기록되며 결과가 실행마다 같다. 한 줄의 매핑 사유 안에서는 후보마다 `isUsable`(출처 → 상태 → 유효 기간 → 약관 출처 → 승인자 → 지문 순)을 거쳐 사용 가능한 후보의 개수로 먼저 가르고, 사용 가능한 후보가 없을 때만 후보들의 코드 가운데 고정 우선순위 하나를 고른다(`AC-008h`, `AC-008i`). 모호성이 지문보다 앞서는 옛 순서는 쓰지 않는다: 지문이 어긋난 후보는 사용 가능한 후보로 세지 않는다. (`AC-008e`, unit)
- **Given** 규칙 묶음이 없는 입력(`bundle = null`, 병원에 규칙 사용 범위가 없음) **When** 계산하면 **Then** 모든 줄이 `CLINIC_RULE_SCOPE_ABSENT`로 보류된다. (`AC-008f`, unit)
- **Given** 게시된 뒤 중지된 규칙 묶음(`bundle.status = SUSPENDED`, 중지 전과 같은 버전 id와 내용 해시, 규칙 사용 범위는 그대로 그 묶음을 가리킴) **When** 계산하면 **Then** 모든 줄이 `RULE_BUNDLE_SUSPENDED`로 `ON_HOLD`이고, 예상 병원 결제액은 숫자, 예상 보험금과 수령 후 부담은 null, 서류는 null이다. 판정 순서는 `CLINIC_RULE_SCOPE_ABSENT`(`bundle = null`)가 먼저, 그다음 `RULE_BUNDLE_SUSPENDED`, 그다음 프로필 사유다(묶음이 중지이고 프로필도 사용 불가이면 `RULE_BUNDLE_SUSPENDED`). 내용이 같은 `ACTIVE` 묶음은 정상 계산된다. 묶음 중지 때 항목 판정(`isUsable`)을 한 번도 부르지 않는다는 점은 `AC-008l`이 증명한다. (`AC-008g`, unit)
- **Given** 프로필은 사용 가능하고 한 줄(신장분사치료)의 매핑 후보 구성만 아래 표처럼 바꾼 매개변수 시험 **When** 계산하면 **Then** 표의 기대와 같다. 후보는 `bundle.mappings` 가운데 `treatmentId`가 이 줄과 같고 `(generation, insurerType)`가 `scope`에 든 것이며, 후보마다 `isUsable`(출처 → 상태 → 유효 기간 → 약관 출처 → 승인자 → 지문)을 거친다. 사용 가능한 후보의 개수는 지문까지 통과한 것만 센다(design.md DD-03 "매핑 조회 `resolveMapping`"). (`AC-008h`, unit)

| 번호 | 후보 구성 | 기대 |
|------|-----------|------|
| 1 | 묶음에 이 `treatmentId`의 매핑이 없음 | `MAPPING_ABSENT` |
| 2 | 이 `treatmentId`의 매핑은 있으나 `scope`에 이 칸이 없음(다른 세대나 다른 보험사 형태만), 또는 다른 `treatmentId`의 매핑만 이 칸에 있음 | `MAPPING_ABSENT`(범위 밖 후보는 후보가 아니다) |
| 3 | 사용 가능한 후보 1개 | 그 매핑으로 확정, 줄 `ESTIMATED`(`COVERED`) |
| 4 | 사용 가능한 후보 1개 + 사용 불가 후보 1개(사용 불가 상태를 하나씩 바꿔 가며: 미검토, 반려, 재검토 중, 무효, 유효 기간 밖, 약관 출처 누락, 승인자 누락, 허용 밖 출처, 지문 불일치) | 사용 가능한 후보로 확정하고 사용 불가 후보의 코드는 줄에 기록되지 않는다 |
| 5 | 사용 가능한 후보 2개, 둘 다 `COVERED`에 `groupKey`도 같음 | `MAPPING_INVALID`(모호) |
| 6 | 사용 가능한 `COVERED` 1개 + 사용 가능한 `EXCLUDED` 1개 | `MAPPING_INVALID`(모호). 보장이 이기지도 제외가 이기지도 않으며 `EXCLUDED_CONFIRMED`도 `ESTIMATED`도 아니다 |
| 7 | 후보 2개 가운데 하나만 지문이 불일치 | 지문 불일치 후보는 사용 가능으로 세지 않으므로 나머지 1개로 확정(모호가 아님) |
| 8 | 후보 2개가 모두 지문 불일치 | 사용 가능한 후보 0개이므로 `MAPPING_UNDER_REREVIEW` |
| 9 | 사용 가능한 후보 3개 이상 | `MAPPING_INVALID` |

- **Given** 사용 가능한 후보가 하나도 없고 서로 다른 보류 코드를 받는 후보가 둘 이상 있는 입력(조합: 지문 불일치(`MAPPING_UNDER_REREVIEW`), 미검토(`MAPPING_UNREVIEWED`), 반려(`MAPPING_REJECTED`), 무효·허용 밖 출처(`MAPPING_INVALID`)의 모든 쌍, 모든 3개 조합, 4개 전부) **When** 계산하면 **Then** 줄의 코드는 배열 순서와 무관한 고정 우선순위 `MAPPING_UNDER_REREVIEW` > `MAPPING_UNREVIEWED` > `MAPPING_REJECTED` > `MAPPING_INVALID` 가운데 후보들이 가진 코드 중 가장 높은 것이다. 같은 코드를 받는 후보가 여럿이어도 그 코드다. 후보 하나가 사용 불가 사유를 여럿 가지면 그 후보의 코드는 `isUsable`의 검사 순서에서 처음 걸린 사유가 정한다. 후보가 5개 이하인 조합은 후보 순서의 모든 순열을, 더 큰 조합은 고정 시드 순열을 시험에 쓰고(시드는 시험 코드에 고정해 출력에 기록) 모든 순열에서 결과가 바이트 단위로 같다. (`AC-008i`, unit)
- **Given** 매핑 하나와 프로필의 조합 **When** 계산하면 **Then** 다음과 같고 보장 여부는 매핑의 `decision`만이 정한다. (`AC-008j`, unit)
  - 사용 가능한 `COVERED` + `groupKey`가 프로필에 있음: 줄 `ESTIMATED`, 그 그룹의 `E`에 들어간다.
  - 사용 가능한 `COVERED` + `groupKey`가 프로필에 없음: 줄 `ON_HOLD`, `MAPPING_GROUP_NOT_IN_PROFILE`.
  - 사용 가능한 `EXCLUDED`(`groupKey` 없음, 사유 있음): 줄 `EXCLUDED_CONFIRMED`이고 `excludedItems[]`에 사유와 상수 `payout` 0으로 들어가며 어떤 그룹의 `E`에도 들어가지 않는다(그 줄을 뺀 입력과 그룹 `E`가 같다). 그룹 조회를 하지 않는다: 프로필의 그룹 키가 무엇이든 결과가 같고 이 줄에 대한 그룹 조회 호출이 없다(호출 감시).
  - 제외 지름길 없음. `decision = EXCLUDED`인 매핑이 미검토(`DRAFT`·`REVIEW_REQUESTED`·`APPROVED` 미게시), 반려, 재검토 중, 무효(`SUPERSEDED`·`EXPIRED`·`SUSPENDED`), 유효 기간 밖, 약관 출처 누락, 승인자 누락, 허용 밖 출처, 지문 불일치 각각의 상태이면 그 상태의 보류 코드를 받고 `EXCLUDED_CONFIRMED`가 아니며 `excludedItems[]`가 비어 있다.
  - `calcClass = NEEDS_REVIEW`: 사용 가능한 `EXCLUDED` 매핑이 있어도, 사용 가능한 `COVERED` 매핑이 있어도 `CLASSIFICATION_NEEDS_REVIEW`이고 `EXCLUDED_CONFIRMED`가 아니다.
  - 필드 규칙 방어: 게시 검증을 거치지 않고 저장소에 직접 넣은 매핑이 사용 가능으로 판정되더라도 `COVERED`에 `groupKey`가 없거나 비어 있음, `COVERED`에 `exclusionReason`이 있음, `EXCLUDED`에 `groupKey`가 있음, `EXCLUDED`에 `exclusionReason`이 없거나 비어 있음, `decision`이 두 값 밖이면 줄은 `MAPPING_INVALID`로 보류되고 `ESTIMATED`도 `EXCLUDED_CONFIRMED`도 아니다.
  - 형식 수준 시험: `CoverageGroupDef`의 키 집합은 `groupKey`, `deduction`, `limit`, `sharedLimitPoolKey`(선택)이며 `coverage`와 `exclusionReason`이 없다(`AC-006d`와 같은 방식).
- **Given** 같은 의미의 입력에서 `bundle.mappings`, `bundle.profiles`, 프로필의 `groups`와 `sharedLimitPools`, 입력의 `lines`·`baseFeeLines`·`treatmentIds`의 배열 순서만 바꾼 입력들(후보가 여러 개인 줄, 공유 한도 풀이 있는 그룹, 보류 줄과 제외 줄이 섞인 입력을 포함) **When** 각각 계산하면 **Then** 직렬화한 `result`가 모든 입력에서 바이트 단위로 같다. 요소가 5개 이하인 배열은 모든 순열을, 더 큰 배열은 고정 시드 순열을 쓴다(시드는 시험 코드에 고정해 출력에 기록). `groupOrder`는 데이터이므로 순열 대상이 아니다(바꾸면 `AC-004h`가 다룬다). 출력 순서도 고정이다: `lines[]`·`holdReasons[]`·`excludedItems[]`는 `treatmentId`의 유니코드 코드 포인트 오름차순(대문자가 소문자보다 앞서고 `"10"`이 `"2"`보다 앞서는 id와 한글 id를 포함해 로케일 정렬과 다른 경우를 시험), `groups[]`·`referenceGroups[]`는 프로필의 `groupOrder`, `assumptions[]`는 design.md DD-03 가정 코드 표의 행 순서다. 배열 위치나 `Map` 삽입 순서에 기대는 코드 경로가 없다. 이 항목은 `estimate()` 결과만 다루며 서류 규칙 `rules`의 순서는 서류 산출 쪽 시험(`AC-007l`)이 우선순위 동률 키 규칙(DD-06 "규칙 평가" 7번)과 함께 맡는다. (`AC-008k`, unit)
- **Given** 사용 불가인 프로필(`DRAFT`)과 사용 불가인 매핑이 든 묶음 **When** `bundle.status = SUSPENDED`로 계산하면 **Then** 모든 줄이 `RULE_BUNDLE_SUSPENDED`이고 `isUsable`의 호출 횟수가 0이며(호출 감시) 프로필 칸 조회·프로필 구조 검사·`resolveMapping`도 호출되지 않고 서류는 null이다. `bundle = null`이면 `CLINIC_RULE_SCOPE_ABSENT`이고 `isUsable` 호출이 0이다. `isBundleUsable`은 묶음 안의 항목을 읽지 않는다(`profiles`·`mappings`·`documentRuleSet`을 읽으면 던지는 접근자를 단 묶음에서도 중지 결과가 나온다). `bundle.status = ACTIVE`이면 호출 순서 기록이 `isBundleUsable` → 프로필 `isUsable` → 프로필 구조 검사 → 줄마다(줄 출처, 분류, `resolveMapping`의 후보별 `isUsable`)의 순서(design.md DD-04 호출 순서)와 같다. 형식 수준 시험: `isUsable`의 매개변수 타입 어디에도 `RuleBundleSnapshot`이나 묶음 상태가 없고, `isBundleUsable`의 매개변수에는 `RuleItem`·프로필·매핑이 없으며, `isUsable`의 사유 목록(`ItemUsabilityReason`)에 묶음 사유가 없다. (`AC-008l`, unit)
- **Given** 프로필 구조 결함(`AC-008a`의 구조 결함 행 전부와 같은 칸의 프로필 2개)과 공유 한도 풀의 값 결함이 든 `TEST_FIXTURE` **When** 계산하면 **Then** 다음과 같다. (`AC-008m`, unit)
  - 구조 결함이 하나라도 있으면 프로필 전체를 믿을 수 없어 모든 줄이 `PROFILE_INVALID`이고 `groups[]`에 `ESTIMATED` 그룹이 없으며 `referenceGroups`가 비어 있다.
  - 풀 `limit`으로 `PER_VISIT_PAYOUT`·`PER_ACCIDENT`·`ANNUAL`·`COUNT`(모두 `limitBasis = PAYOUT`)는 계산되고 풀마다 `Σ P_pooled = min(Σ P, 풀 한도)`이며, `PER_ACCIDENT`·`ANNUAL`·`COUNT`를 적용하면 `REMAINING_LIMIT_ASSUMED`가 있다. 조항 참조가 있는 `UNLIMITED_DECLARED` 풀은 `P_pooled = P`이다. 조항 참조가 없는 `UNLIMITED_DECLARED` 풀은 그 풀의 멤버 그룹이 `PROFILE_SOURCE_INCOMPLETE`다. `limitBasis = COVERED_COST`이거나 닫힌 목록 밖의 종류인 풀은 멤버 그룹이 `PROFILE_FORMULA_UNSUPPORTED`다.
  - 풀의 한도 값이 없거나 null이면 멤버 그룹만 `PROFILE_VALUE_MISSING`이고, 음수·소수·`NaN`·`Infinity`·문자열이거나 `MAX_AMOUNT_WON` 초과이면 멤버 그룹만 `PROFILE_VALUE_INVALID`다. 풀의 멤버가 아닌 그룹과 다른(유효한) 풀의 그룹은 정상 `ESTIMATED`이고 `referenceGroups`에 있으며, 무효 풀의 멤버 그룹은 모두 보류라서 `referenceGroups`에 없다. 전체는 `ON_HOLD`다.
  - 멤버 그룹이 하나도 없는 풀은 결함이 있어도 아무 영향이 없고 그 풀을 뺀 프로필과 결과가 같다.
  - 한 그룹에 코드가 여럿 해당하면 코드 종류 우선순위가 먼저다: 그룹 자신의 값이 무효(`PROFILE_VALUE_INVALID`)이고 풀이 지원 밖 공식(`PROFILE_FORMULA_UNSUPPORTED`)이면 후자이고, 그룹 자신의 값이 없음(`PROFILE_VALUE_MISSING`)이고 풀 값이 무효이면 전자다.

### AC-009 지문 방어와 재검토 기준
요구사항: REQ-DATA-002, REQ-DATA-004, REQ-ADM-003
- **Given** `APPROVED` 또는 `PUBLISHED` 매핑과 치료 **When** 도메인 서비스로 `treatmentCode`, `procedureCode(s)`, `benefitType`, `calcClass`를 각각 바꾼 치료 버전을 게시하면 **Then** 네 경우 모두 매핑이 `UNDER_REREVIEW`가 된다. (`AC-009a`, integration)
- **Given** 상태 전환 없이 보장 판단 필드만 바뀐 치료 버전(상태 전환 누락을 흉내 냄) **When** 계산하면 **Then** 지문 불일치로 `MAPPING_UNDER_REREVIEW` 보류다. (`AC-009b`, unit)
- **Given** 가격만 바꾼 게시 **When** 게시하고 계산하면 **Then** 새 `CatalogVersion`과 변경 이력이 생기고, 매핑은 `PUBLISHED`로 남으며 그 줄은 새 가격으로 `ESTIMATED`다. (`AC-009c`, integration)

### AC-010 시험 자료와 운영 데이터의 분리
요구사항: REQ-DATA-003
- **Given** 운영 허용 출처(규칙 `OPERATING`, 줄 `OPERATING`) **When** `TEST_FIXTURE` 프로필, `TEST_FIXTURE` 매핑, `DEMO` 치료 줄, `TEST_FIXTURE` 공통 기본비용 줄을 각각 넣어 계산하면 **Then** 각각 `PROFILE_DEMO`(모든 줄), `MAPPING_INVALID`(그 줄), `LINE_ORIGIN_NOT_ACCEPTED`(그 줄), `LINE_ORIGIN_NOT_ACCEPTED`(그 줄)로 보류된다. 시험 허용 출처에서는 같은 자료가 사용 가능하다. (`AC-010a`, unit)
- **Given** 운영 구성 진입점 **When** 가져오기 경계 검사를 돌리면 **Then** fixture 모듈로 가는 경로가 없고, 일부러 추가한 음성 시험에서는 검사가 실패한다. 운영 구성 진입점(`src/server/composition.*`)은 Next.js 골격과 함께 만들어지는 M4에서 처음 생기므로, 이 항목은 M4에서 실제 진입점을 대상으로 닫는다. M1.4는 검사기와 합성(가짜) 진입점에 대한 음성 시험만 증거로 낸다. (`AC-010b`, unit)
- **Given** 운영 구성 **When** `DEMO`·`TEST_FIXTURE` 출처 치료 버전이나 공통 기본비용을 게시하려 하면 **Then** 거절된다. 저장소 시드·이관 스크립트에 `DEMO`·`TEST_FIXTURE` 기록을 `APPROVED`·`PUBLISHED`로 쓰는 경로가 없다. (`AC-010c`, integration)
- **Given** 시험 구성에서 (1) 프로필만, (2) 매핑만, (3) 서류 규칙 묶음만, (4) 치료 줄만 `OPERATING`이 아닌 네 경우 **When** 계산 API를 부르면 **Then** 네 경우 모두 응답 `origin`이 `OPERATING`이 아니다. 모두 `OPERATING`이면 `origin = OPERATING`이다. (`AC-010d`, integration)
- **Given** `origin`이 `OPERATING`이 아닌 응답 **When** 결과 화면을 그리면 **Then** 화면 상단에 테스트 데이터 표시가 보이고, `OPERATING` 응답에서는 보이지 않는다. (`AC-010e`, render)

### AC-011 버전 불변성과 운영 준비 상태
요구사항: REQ-DATA-004, REQ-DATA-001, REQ-DATA-002
- **Given** 게시된 `CatalogVersion`·`RuleBundleVersion` **When** 수정·삭제를 시도하면 **Then** 거절되고, 수정은 새 버전으로만 생긴다. 같은 묶음의 내용 해시는 다시 계산해도 같다. **M3 · 미구현:** 게시·봉인 쪽의 프로필 내용 해시는 엔진의 `profileContent` 함수 하나로 만들어야 하며(두 번째 정규화 구현 금지), 주입하는 해시 함수는 객체 키 삽입 순서에 영향을 받지 않아야 한다. M3는 시험한다: (i) 원래 순서에서 계산한 해시가 `groups`·`sharedLimitPools`를 다른 순서로 저장한 같은 프로필에서도 엔진 검증(`isUsable`)을 통과한다, (ii) 실제 규칙 값이나 `groupOrder`가 바뀌면 옛 해시로는 검증이 실패한다(`AC-008a`의 같은 입력). 정규화 이전 방식으로 만든 해시는 저장 순서가 키 순서가 아니면 검증되지 않으므로 M3는 이전 방식의 해시 자료에 기대지 않는다. (`AC-011a`, integration)
- **Given** 이전 버전 **When** 복구하면 **Then** 새 id의 사본이 게시되고 기존 이력이 그대로 남는다. (`AC-011b`, integration)
- **Given** 운영 데이터가 없는 저장소 **When** 표 P(프로필 칸, design.md DD-23)를 플랫폼 보기와 병원 보기로 산출하면 **Then** 15칸 모두 `NOT_READY`이고 사유는 플랫폼 보기에서 `PROFILE_ABSENT`이며, 병원 보기에서는 규칙 사용 범위가 없으면 `CLINIC_RULE_SCOPE_ABSENT`, 범위는 있으나 묶음에 그 칸의 프로필이 없으면 `PROFILE_ABSENT`다. **Given** 시험 전용 저장소에서 한 칸의 프로필 기록만 아래처럼 하나씩 어긋나게 만들고 나머지는 모두 사용 가능하게 두면 **Then** 그 칸만 `NOT_READY`이고 사유는 같은 입력으로 `estimate()`를 부를 때 그 칸의 모든 줄이 받는 보류 코드와 같다: 출처 `TEST_FIXTURE`(운영 허용 출처에서)·`DEMO`, 상태 `DRAFT`·`REVIEW_REQUESTED`·`REJECTED`·`APPROVED`(미게시)·`UNDER_REREVIEW`·`SUPERSEDED`·`EXPIRED`·`SUSPENDED`, 유효 기간 밖, 약관 출처 6항목 중 하나 누락, 승인자 누락, 내용 해시 불일치, 구조 결함(`AC-008a`의 구조 결함 행), 같은 칸에 프로필 둘, 그 프로필을 담은 묶음이 `SUSPENDED`(`RULE_BUNDLE_SUSPENDED`). 승인·게시·`OPERATING`·출처 완비·구조 정상을 모두 갖추고 `ACTIVE` 묶음에 든 칸만 `READY`이고 다른 칸으로 번지지 않는다. 플랫폼 보기에서 같은 칸에 후보 묶음이 둘 이상이면 하나라도 사용 가능할 때 `READY`이고, 모두 사용 불가이면 DD-23 표 P의 고정 우선순위로 사유 하나가 나오며 후보의 배열 순서에 달라지지 않는다. 표 P가 `READY`여도 병원의 `calculationReady`가 되지 않는다는 점은 `AC-011l`이 다룬다. (`AC-011c`, unit)
- **Given** 보험사 데이터 **When** 저장하면 **Then** NH농협손해보험, NH농협생명, 과거 농협공제가 서로 다른 기관 기록이다. (`AC-011d`, integration)
- **Given** 규칙 묶음 게시와 중지 **When** 묶음을 게시하고 중지하면 **Then** 게시가 `ACTIVE` 가용성 기록을 같은 트랜잭션에 쓰고, 중지가 수행자·역할·일시·사유가 든 `SUSPENDED` 기록을 덧붙이며(앞의 기록은 지우지 않는다), 묶음의 내용 해시와 묶음에 든 프로필·매핑·서류 규칙 항목의 상태는 그대로이고, 같은 항목 버전을 담은 두 번째 묶음은 계속 사용할 수 있으며, 중지한 같은 묶음 id를 다시 활성으로 돌리려는 시도는 거절되고, 사유가 비어 있는 중지는 도메인 서비스가 유형 있는 도메인 오류로 거절하고 기록을 쓰지 않는다. 이 항목은 도메인 서비스와 메모리 저장소만 쓰며 HTTP 경로를 쓰지 않는다. 같은 거절이 관리자 API에서 400 `INVALID_REQUEST`가 되는 것은 `AC-025f`가, 권한 판정은 `AC-022a`가 맡는다(둘 다 M7). (`AC-011e`, integration)
- **Given** 준비 단계는 M3의 도메인 서비스와 메모리 저장소로 하고(관리자 HTTP 경로는 이 시나리오에서 쓰지 않는다) 계산은 공개 계산 API로 하는 시나리오 **When** (1) 묶음을 게시해 병원 A의 규칙 사용 범위로 지정하고 `POST /api/clinics/{slug}/estimate`로 계산하고, (2) 도메인 서비스로 그 묶음을 중지한 뒤 같은 입력과 같은 `catalogVersion`·`ruleBundleVersion`으로 다시 계산하고, (3) 도메인 서비스로 새 묶음 버전을 게시해 병원 A에 다시 지정한 뒤 옛 버전과 새 버전으로 각각 요청하면 **Then** (1)은 `ESTIMATED`, (2)는 409도 이전 결과의 재사용도 아닌 HTTP 200 `ON_HOLD`로 모든 줄이 `RULE_BUNDLE_SUSPENDED`이고 `hospitalPayment`는 숫자이며 `versions.ruleBundleStatus = SUSPENDED`, (3)은 옛 버전 요청이 409(`ruleChanged: true`, `latest.ruleBundleStatus`는 새 묶음의 `ACTIVE`)이고 새 버전 요청은 `ESTIMATED`다. 다른 묶음을 쓰는 병원 B는 전 과정에서 영향이 없다. 같은 시나리오를 관리자 HTTP 경로로 하는 것(게시·중지·재지정 API)은 `AC-025d`와 `AC-025f`(M7)가 맡는다. (`AC-011f`, integration)
- **Given** 병원 A의 규칙 사용 범위가 가리키는 묶음이 중지된 상태 **When** `GET /api/clinics/{slug}/insurance/options`를 부르면 **Then** `ruleBundleVersion`은 범위의 묶음 id이고 `ruleBundleStatus`는 `SUSPENDED`이며, 세대 5장·형태 3장·원인 3장이 그대로 있고, 응답이 `Cache-Control: no-store`이며, 규칙 사용 범위 기록은 바뀌지 않는다. 규칙 사용 범위가 없는 병원은 `ruleBundleVersion`과 `ruleBundleStatus`가 모두 null이다. (`AC-011g`, integration)
- **Given** 범위 밖 값이 든 게시 요청(치료 가격·공통 기본비용이 음수·소수·`NaN`·문자열·`MAX_AMOUNT_WON` 초과인 카탈로그, 프로필의 금액·한도 값이 같은 식으로 무효이거나 비율이 0 미만 또는 10000 초과인 규칙 묶음) **When** 도메인 게시 서비스로 게시하면 **Then** 어긋난 필드 경로와 함께 유형 있는 도메인 오류로 거절되고 아무것도 저장되지 않으며 이전 게시 버전이 그대로 남는다. 경계값 0과 `MAX_AMOUNT_WON`(비율은 0과 10000)은 게시된다. 이 항목은 도메인 서비스와 메모리 저장소만 쓰며 HTTP 경로를 쓰지 않는다. 같은 거절이 관리자 API에서 400 `INVALID_REQUEST`와 어긋난 필드 경로로 나오는 것은 `AC-021f`(M7)가 맡는다. (`AC-011h`, integration)
- **Given** 아래 결함을 하나씩 가진 규칙 묶음 게시 요청(그 밖의 내용은 유효) **When** 도메인 게시 서비스로 게시하면 **Then** 어긋난 필드 경로와 함께 유형 있는 도메인 오류로 거절되고 아무것도 저장되지 않으며(저장소 전후 비교가 같고 규칙 묶음 가용성 기록도 쓰이지 않음) 이전 게시 버전이 그대로 남는다. 결함을 모두 고친 묶음은 게시된다. 이 항목은 도메인 서비스와 메모리 저장소만 쓰며 HTTP 경로를 쓰지 않는다. 관리자 API의 400 `INVALID_REQUEST` 대응은 `AC-021f`(M7)가 맡는다. (`AC-011i`, integration)
  - 매핑 필드 규칙(design.md DD-03 "확인된 제외와 줄 상태"): `decision`이 `COVERED`·`EXCLUDED` 밖의 값, `COVERED`에 `groupKey`가 없거나 비어 있음, `COVERED`에 `exclusionReason`이 있음, `EXCLUDED`에 `groupKey`가 있음, `EXCLUDED`에 `exclusionReason`이 없거나 비어 있음, 두 결정 모두 `policySourceIds`가 비어 있음. `EXCLUDED`도 `COVERED`와 같은 약관 출처·승인자 기록 요건을 지킨다.
  - 프로필 구조(design.md DD-02 "프로필 구조 검사와 영향 범위"): 빈 프로필, 빈·중복 `groupKey`, 빈·중복 `poolKey`, 없는 풀을 가리키는 `sharedLimitPoolKey`, `groupOrder`에서 빠진·중복·없는 키. 멤버가 없는 풀은 거절하지 않는다. 풀의 금액이 DD-24 범위 밖인 경우도 그룹 값과 같이 거절한다. 공식 지원 여부(종류·`limitBasis`·조항 참조)는 게시 거절 사유가 아니라 계산 때의 보류 사유다.
  - 묶음 교차 검사: 매핑 `scope`의 한 칸에 같은 묶음의 프로필이 있는데 그 프로필에 없는 `groupKey`를 가진 `COVERED` 매핑, 같은 (세대, 보험사 형태) 칸에 프로필 둘 이상, 같은 매핑 id의 버전 둘 이상. 같은 묶음에 프로필이 없는 칸을 `scope`로 가진 매핑은 거절하지 않고 게시되며 그 칸의 계산은 `PROFILE_ABSENT`로 보류된다.
- **Given** `ACTIVE` 묶음을 쓰는 병원과 그 병원의 게시된 줄(치료 여럿과 공통 기본비용 하나) **When** 표 M(병원 × 게시된 줄 × 15칸, design.md DD-23)을 산출하면 **Then** (1) 한 줄의 상태를 아래로 하나씩 바꾼 매개변수 시험에서 그 줄 행의 `NOT_READY` 사유가 같은 입력으로 `estimate()`가 그 줄에 내는 보류 코드와 같다: 매핑 없음(`MAPPING_ABSENT`), `scope`에 그 칸이 없는 매핑만 있음(그 칸만 `MAPPING_ABSENT`), 미검토(`MAPPING_UNREVIEWED`), 반려(`MAPPING_REJECTED`), 재검토 중과 지문 불일치(`MAPPING_UNDER_REREVIEW`), 무효·유효 기간 밖·약관 출처 누락·승인자 누락·허용 밖 출처(`MAPPING_INVALID`), 사용 가능한 후보 둘 이상(`COVERED`와 `EXCLUDED`가 섞인 경우 포함, `MAPPING_INVALID`), 필드 규칙을 어긴 저장 매핑(`MAPPING_INVALID`), 사용 가능한 `COVERED`의 `groupKey`가 프로필에 없음(`MAPPING_GROUP_NOT_IN_PROFILE`), 줄 출처가 허용 밖(`LINE_ORIGIN_NOT_ACCEPTED`), `calcClass = NEEDS_REVIEW`(`CLASSIFICATION_NEEDS_REVIEW`), 매핑이 가리키는 그룹의 값 결함(`PROFILE_VALUE_MISSING`·`PROFILE_VALUE_INVALID`·`PROFILE_FORMULA_UNSUPPORTED`·조항 누락 `PROFILE_SOURCE_INCOMPLETE`이며, 공유 한도 풀의 값 결함은 그 풀 멤버 그룹의 줄만); (2) 사용 가능한 `EXCLUDED` 매핑의 줄은 `READY (EXCLUDED_CONFIRMED)`이고, 사용 불가 상태의 `EXCLUDED` 매핑은 `READY`가 아니라 그 상태의 코드다; (3) 사용 가능한 `COVERED` 매핑이어도 그 칸의 프로필이 해석되지 않으면 그 행은 `NOT_READY`이고 사유는 표 P(병원 보기)의 같은 칸 사유다; (4) 줄 하나의 상태가 다른 줄의 행을 바꾸지 않고, 칸마다 독립이며, 결과가 `bundle.mappings`와 카탈로그 줄의 배열 순서에 달라지지 않는다; (5) 규칙 사용 범위가 없는 병원은 줄 출처와 분류가 통과하는 모든 줄이 `MAPPING_ABSENT`다. (`AC-011j`, unit)
- **Given** 병원의 규칙 사용 범위, 묶음 상태, 서류 규칙 묶음 상태를 바꾼 매개변수 시험 **When** 표 S와 표 D(design.md DD-23)를 산출하면 **Then** 표 S는 규칙 사용 범위 없음 `SCOPE_ABSENT`(→ `CLINIC_RULE_SCOPE_ABSENT`), 묶음 `SUSPENDED`(→ `RULE_BUNDLE_SUSPENDED`, 묶음 id·내용 해시·규칙 사용 범위는 그대로), 그 밖에는 `ACTIVE`(묶음 id와 버전이 함께 나옴)이고 `ACTIVE`만 `READY`다. 표 D는 표 S가 `ACTIVE`이고 서류 규칙 묶음이 사용 가능할 때만 `READY`이며, `NOT_READY`일 때 사유는 항상 `RULES_UNAVAILABLE`이고 세부 사유가 함께 나온다: 범위 없음·묶음 중지(묶음 단계), 묶음에 서류 규칙 묶음이 없음, 그리고 `isUsable`의 사유 하나씩(`ORIGIN_NOT_ACCEPTED`(운영 허용 출처에서의 `TEST_FIXTURE`), 상태 여덟 가지(`DRAFT`·`REVIEW_REQUESTED`·`REJECTED`·`APPROVED` 미게시·`UNDER_REREVIEW`·`SUPERSEDED`·`EXPIRED`·`SUSPENDED`), `OUTSIDE_VALIDITY`, `SOURCE_INCOMPLETE`, `APPROVER_MISSING`, `INTEGRITY_MISMATCH`). 같은 입력의 서류 산출과 맞춘다: 서류 규칙 묶음을 쓸 수 없고 계산 결과가 `ON_HOLD`가 아니면 `RULES_UNAVAILABLE`이다(`AC-007d`). 병원마다 독립이어서 한 병원의 묶음 중지가 그 묶음을 쓰지 않는 병원의 행을 바꾸지 않는다. (`AC-011k`, unit)
- **Given** 병원 한 곳의 상태 조합(규칙 사용 범위 없음·`SUSPENDED`·`ACTIVE` × 칸의 프로필 상태(`AC-011c`의 어긋남 목록) × 게시된 줄마다 매핑 상태(`AC-011j`의 목록) × 서류 규칙 묶음 상태(`AC-011k`의 목록)) **When** 병원별 두 조건을 산출하면 **Then** (1) `calculationReady`(15칸)와 `documentReady`가 별개의 값으로 나오고, 어느 출력 문자열에도 두 값을 합친 "준비 완료" 같은 표현이 없다; (2) 표 P(병원 보기)가 그 칸에서 `READY`여도 표 S가 `ACTIVE`가 아니거나 표 M에 `NOT_READY` 줄이 하나라도 있거나 게시된 치료가 없으면 그 칸의 `calculationReady`는 `NOT_READY`다(표 P 하나가 `READY`이면 병원이 준비된 것으로 보고하는 경로가 없다); (3) 동치: 고정 시드로 생성한 상태 조합의 행렬(시드와 시행 수는 시험 코드에 고정해 출력에 기록하고, 금액은 `AC-003h`의 경계에 닿지 않게 한정하며, 게시된 치료가 없는 병원은 `estimate()`에 넣을 입력이 없어 `NOT_READY`만 확인한다)에서 칸마다 `calculationReady`가 `READY`인 것과, 그 병원의 게시된 치료 전부와 공통 기본비용 전부를 입력으로 같은 칸에서 부른 `estimate()`의 전체 상태가 `ON_HOLD`가 아닌 것이 모든 시행에서 같고, `NOT_READY`일 때 사유도 같다(묶음·프로필 단계의 코드는 `estimate()`가 모든 줄에 내는 코드와 같고, 줄 단계의 `NOT_READY` (줄, 코드) 집합은 `estimate()`의 `holdReasons[]`와 같다); (4) 서류 규칙 묶음만 사용 불가(`RULES_UNAVAILABLE`)이면 `documentReady`만 `NOT_READY`가 되고 모든 칸의 `calculationReady`는 그대로다; (5) 운영 데이터가 없는 저장소(병원은 있고 규칙 사용 범위가 없음)에서는 표 S `SCOPE_ABSENT`, 표 D `RULES_UNAVAILABLE`, 표 M의 모든 줄 `MAPPING_ABSENT`, 표 P 15칸 `PROFILE_ABSENT`(플랫폼 보기)이고 두 조건이 모두 `NOT_READY`이며 새 보류 코드가 없다; (6) 호출 감시와 가져오기 검사로 준비 상태 계산이 `isBundleUsable`·`isUsable`·`resolveProfile`·`resolveMapping`·`decideLine`·`checkGroupValues`를 엔진 모듈에서 가져와 부르고 같은 이름의 함수를 따로 정의하지 않음을 확인한다(두 번째 구현 없음). (`AC-011l`, unit)
- **Given** 병원 A의 규칙 사용 범위가 `ACTIVE` 묶음을 가리키고 프로필·매핑이 사용 가능하며, 서버가 묶음 내용을 캐시한 상태(첫 요청이 `ESTIMATED`로 끝나 묶음 내용 조회가 캐시를 채웠다) **When** 그 뒤에 도메인 서비스로 그 묶음에 든 프로필 하나를 `SUSPENDED`로 바꾸고(다른 시험에서는 `UNDER_REREVIEW`로) 같은 입력, 같은 `catalogVersion`·`ruleBundleVersion`으로 다음 요청을 보내면 **Then** 409가 아니라 HTTP 200 `ON_HOLD`이고 그 칸의 모든 줄이 `PROFILE_INVALID`(`SUSPENDED`) 또는 `PROFILE_UNDER_REREVIEW`(`UNDER_REREVIEW`)다(`AC-008a`의 같은 상태 행과 같은 코드). `hospitalPayment`는 숫자, 보험금 두 값과 `documents`는 null, `versions.ruleBundleStatus`는 `ACTIVE`이고 `ruleBundleVersion`·묶음 내용 해시·`catalogVersion`은 바뀌지 않았다. 메모리 저장소의 읽기 호출 감시에서 묶음 내용 조회는 캐시 적중이어도 항목 `state` 조회는 요청마다 일어난다. (`AC-011m`, integration — design.md DD-14 "항목 생명주기 상태와 캐시 계약", SPEC 제안 승인 전)
- **Given** 위와 같이 묶음 내용을 먼저 읽어 캐시한 상태 **When** 그 뒤에 도메인 서비스로 매핑 하나를 `SUSPENDED`로 바꾸고(다른 시험에서는 `UNDER_REREVIEW`로) 다음 요청을 보내면 **Then** 200이고, 그 매핑이 이 칸·치료의 유일한 후보였던 줄만 `MAPPING_INVALID`(`UNDER_REREVIEW`는 `MAPPING_UNDER_REREVIEW`)로 `ON_HOLD`이며 다른 줄은 `ESTIMATED`로 남고 전체 상태는 `ON_HOLD`, 보험금은 null이다(`AC-008b`의 같은 상태 행과 같은 코드, 줄 단위 보류). 같은 칸·치료에 사용 가능한 다른 후보 매핑이 있으면 그 후보로 확정되어 응답이 바뀌지 않는다(`AC-008h`의 후보 구성 행렬). 버전은 바뀌지 않는다. (`AC-011n`, integration)
- **Given** 위와 같이 묶음 내용을 먼저 읽어 캐시한 상태 **When** 그 뒤에 도메인 서비스로 묶음에 든 서류 규칙 묶음을 `SUSPENDED`로 바꾸고(다른 시험에서는 `UNDER_REREVIEW`로) 계산이 가능한 입력으로 다음 요청을 보내면 **Then** 200이고 `result.state`와 금액은 바뀌지 않으며 `documents`는 `{ state: "RULES_UNAVAILABLE" }`다(`AC-007d`와 같은 결과). 계산이 `ON_HOLD`인 입력이면 `documents`는 null이다. 버전은 바뀌지 않는다. (`AC-011o`, integration)
- **Given** 같은 프로필 버전을 담은 두 묶음 X(병원 A가 사용)와 Y(병원 B가 사용)가 모두 `ACTIVE`이고 두 묶음의 내용이 캐시된 상태 **When** (1) 도메인 서비스로 그 프로필 버전을 `SUSPENDED`로 바꾸고 두 병원이 다음 요청을 보내면, (2) 따로 묶음 X만 중지(묶음 중지)하고 병원 B가 요청하면 **Then** (1) 병원 A와 병원 B의 다음 요청이 모두 `PROFILE_INVALID`로 보류된다(같은 항목을 담은 다른 묶음에도 반영된다). (2) 병원 B는 영향이 없어 `ESTIMATED`이고, 묶음 중지가 프로필·매핑·서류 규칙 항목의 `state`를 바꾸지 않음을 저장소 직접 조회로 확인한다(`AC-011e`). 두 경우 모두 두 병원이 가진 버전은 바뀌지 않는다. (`AC-011p`, integration)

## 3. 키오스크 흐름·세션

### AC-012 입력 흐름
요구사항: REQ-FLOW-001, REQ-API-001
- **Given** 키오스크 **When** 시작부터 치료 선택까지 진행하면 **Then** 시작 화면에 병원명과 서비스 표시명 "보담"이 보이고 이전 금액·선택이 없으며, "시작하기"는 언제나 빈 세션으로 화면 1을 열고, 단계 표시가 1/4 실손보험 · 2/4 보험사 형태 · 3/4 치료 원인 · 4/4 치료 선택 순서다. (`AC-012a`, unit + e2e-app)
- **Given** 1-3단계 **When** 아무것도 고르지 않으면 **Then** "다음"이 비활성이고, 4단계에서 치료가 0개면 "예상 부담액 확인"이 비활성이다. (`AC-012b`, unit + e2e-app)
- **Given** 모든 키오스크 화면 **When** 화면 문구와 버튼을 전수 검사하면 **Then** 공제 유형·외래 한도·특약 질문, 상담 화면, "직원에게 문의" 버튼이 없고, "접수 직원에게 문의해 주세요"는 버튼 모양이 아닌 문장이며, "1588"이 없다. (`AC-012c`, e2e-app)
- **Given** 화면 1 **When** "확인 방법 보기"를 누르면 **Then** 세대 확인 안내 화면이 열리고 "보험 세대가 특정되지 않으면 정확한 안내가 어렵습니다" 문장과 가입일 확인 방법, 1544-8069 문의 안내가 링크나 전화 연결 없이 문자로 보이며, 계산 요청이 하나도 나가지 않고, "보험 선택으로 돌아가기"를 누르면 화면 1로 돌아온다. (`AC-012d`, e2e-app)
- **Given** 치료 목록이 두 페이지 이상 **When** 다음 목록으로 넘겼다 돌아오면 **Then** 선택이 유지되고, 이미 고른 카드를 거듭 눌러도 수량이 늘지 않는다. (`AC-012e`, unit + e2e-app)
- **Given** 예시 4종 시험 자료 카탈로그 **When** 네 개를 모두 고르면 **Then** 하단에 선택 4개, 급여 14,000 · 비급여 110,000 · 총 예상 결제액 124,000이 즉시 보인다. (`AC-012f`, unit + e2e-app)
- **Given** 2-4단계 **When** "이전"으로 돌아가면 **Then** 앞서 고른 값이 남아 있다. (`AC-012g`, unit)
- **Given** 화면 1 **When** 세대 카드 아래를 확인하면 **Then** "가입 시기를 모르실 때" 안내에 "보험증권이나 보험사 앱에서 가입일을 확인해 주세요. 확인이 어려우면 1544-8069로 문의해 주세요." 문구가 링크나 전화 연결 없이 문자로 있고, "확인 방법 보기" 버튼이 있다. (`AC-012h`, e2e-app)
- **Given** 모든 키오스크 화면과 키오스크 상태 기계 **When** 입력 요소와 상태 전이를 검사하면 **Then** 날짜(가입일) 입력 요소가 없고, 어떤 경로에서도 가입일로 세대를 정하거나 특정 세대 카드를 제안·미리 선택하지 않는다. (`AC-012i`, unit + e2e-app)

### AC-013 결과·보류·오류 화면
요구사항: REQ-FLOW-002, REQ-ENG-003, REQ-API-004
- **Given** 사례 A 시험 자료 **When** 결과 화면을 그리면 **Then** 세 카드가 예상 병원 결제액 124,000 / 예상 보험금 114,000 / 보험금 수령 후 예상 본인 부담 10,000 순서이고, 세 번째 카드 보조 설명이 "보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다."이며, 결과 문구 원칙("표준 공제·한도 가정으로 계산한 예상 금액입니다. …")과 공통 안내가 기획서 §4 문장 그대로이고, 예시 계산임이 표시된다. (`AC-013a`, render + e2e-app)
- **Given** 사례 E 시험 자료 **When** 보장 제외 결과를 그리면 **Then** 124,000 / 74,000 / 50,000, 제외 항목과 사유가 있고, "선택한 치료가 모두 보장 대상" 문장은 없으며 나머지 항목 기준의 가정 문장이 있다. (`AC-013b`, render + e2e-app)
- **Given** 보류 결과 **When** 화면을 그리면 **Then** 예상 병원 결제액만 숫자이고 나머지 두 카드는 "확인 필요"이며 "0원"이 없다. 보류 줄은 환자용 분류 문구로 묶여 보이고 내부 코드(`PROFILE_`·`MAPPING_`·`LINE_` 등)와 참고 그룹 값이 없다. "표준 공제·한도 가정으로 계산한 예상 금액입니다" 문장이 없고, 개인 계약 조건 문장("개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.")은 있다. 동작은 정확히 "치료 다시 선택 / 보험 조건 수정 / 처음으로 / 이용 완료" 네 개이고 서류 확인·계산 근거 버튼이 없다. (`AC-013c`, render + e2e-app)
- **Given** 계산 요청에 대해 (1) 5xx, 시간 초과, 연결 실패 (2) 400 `INVALID_REQUEST`, 404 `CLINIC_NOT_FOUND`, 422 `UNSUPPORTED_GENERATION` (3) 422 `NO_TREATMENT_SELECTED` (4) 422 `TREATMENT_NOT_PUBLISHED` 응답을 흉내 내면 **Then** (1)·(2)는 통신 오류 화면에 "다시 시도"와 "이용 종료", "계속 안 되면 접수 직원에게 문의해 주세요" 문장이 있고 금액 0원이 없으며 "다시 시도"가 새 요청을 보낸다; (3)은 `K03_Treatments`로 돌아가 확인 버튼이 비활성이다; (4)는 `K03_Treatments` 안에서 catalog·options를 다시 받고 둘 다 도착한 뒤 한 단계로 내려간 치료를 안내와 함께 뺀다(`AC-020b`~`AC-020i`). (`AC-013d`, e2e-app)
- **Given** 정상 결과, 보장 제외 결과, 가로형 결과, 큰 글자 보기 **When** 동작 버튼을 세면 **Then** 각각 "보험 청구에 필요한 서류 확인", "계산 근거 보기", "치료 다시 선택", "보험 조건 수정", "처음으로", "이용 완료" 여섯 개가 모두 있다. (`AC-013e`, e2e-app)
- **Given** 모든 결과·근거 화면 **When** 문구를 검사하면 **Then** "환자분의 실손은" 같은 확인 사실 표현과 "오늘 … 만 내면 됩니다" 같은 표현이 없다. (`AC-013f`, e2e-app)

### AC-014 입력 변경 무효화, 계산 근거, 복귀
요구사항: REQ-FLOW-003, REQ-ENG-004, REQ-ENG-005
- **Given** 결과가 나온 세션 **When** "보험 조건 수정"으로 가서 세대를 다른 값으로 바꾸면 **Then** 결과·서류·근거·복귀 정보가 지워지고 `inputRevision`이 1 오르며, "예상 부담액 확인"을 다시 누르기 전에는 결과 화면에 갈 수 없다. (`AC-014a`, unit)
- **Given** 결과가 나온 세션 **When** 치료를 하나 더 고르거나 빼면 **Then** AC-014a와 같이 파생 데이터가 지워진다. (`AC-014b`, unit)
- **Given** 결과가 나온 세션 **When** 원인을 상해에서 질병으로 바꾸고 다시 확인하면 **Then** 금액 블록은 바이트 단위로 같고 서류 목록은 새로 산출되어 필요 줄이 바뀐다. (`AC-014c`, unit + e2e-app)
- **Given** 결과가 나온 세션 **When** 같은 값을 다시 고르거나, 목록 페이지를 넘기거나, 큰 글자를 켜고 끄면 **Then** 결과가 그대로 남는다. (`AC-014d`, unit)
- **Given** 정상 결과(세로), 보장 제외 결과, 가로형 결과, 큰 글자 보기를 켠 결과 **When** 각각에서 계산 근거와 서류 화면에 들어갔다가 "결과로 돌아가기"를 누르면 **Then** 들어온 결과 종류(정상·보장 제외)로 돌아오고 선택·결과·금액이 그대로이며, 화면 방향과 큰 글자 상태는 복귀 시점의 최신 값을 따른다(들어올 때 기록한 값으로 되돌리지 않는다). 정상 결과로 고정되지 않는다. (`AC-014e`, unit + e2e-app)
- **Given** 정상 결과와 보장 제외 결과 **When** 계산 근거를 열면 **Then** 입력 확인값, "(가정)"을 붙인 프로필 값, 약관 출처, 계산 단계가 보이고, 보장 제외 결과에서 들어온 경우 제외 항목과 사유가 함께 보인다. (`AC-014f`, e2e-app)
- **Given** 계산이 끝난 결과 세 종류(세로 정상·보장 제외, 가로 정상) **When** 서류 확인을 누르면 **Then** 원인 상해·질병은 `K07_Documents`, 모름은 `K07_Documents_Unknown`으로 가며 들어온 결과 종류와 무관하다. (`AC-014g`, unit + e2e-app)
- **Given** 결과가 나온 세션 **When** 계산 근거 화면과 각 서류 화면(`K07_Documents`, `K07_Documents_Unknown`, 가로형 포함)에서 큰 글자 보기를 켰다가 다시 끈 뒤 "결과로 돌아가기"를 누르면 **Then** 전환해도 그 화면에 머물고, 복귀한 결과 화면에 바꾼 설정이 남아 있으며, 결과 종류는 들어온 종류이고, 선택·결과·금액·`inputRevision`이 그대로이며, 계산 요청이 하나도 나가지 않는다. (`AC-014h`, unit + e2e-app — 상태 기계 증거는 M5, 닫는 곳은 M6)
- **Given** 가로 화면에서 정상(또는 보장 제외) 결과를 보다가 계산 근거 화면이나 서류 화면으로 들어간 세션 **When** 그 화면에서 화면 방향을 세로로 바꾸고(반대 방향도 같게) "결과로 돌아가기"를 누르면 **Then** 들어온 결과 종류의 세로형 화면이 나오고, 선택·결과·금액·`inputRevision`이 그대로이며, 방향을 바꾸는 동안 계산 요청이 하나도 나가지 않는다. (`AC-014i`, unit + e2e-app — 상태 기계 증거는 M5, 닫는 곳은 M6)

### AC-015 무조작 시간과 이용 완료 동선
요구사항: REQ-FLOW-004, REQ-ADM-005
- **Given** 가짜 시계 **When** 입력 단계에서 조작이 없으면 **Then** 100초에 TimeoutDialog, 120초에 초기화되어 `K00_Start`로 간다. (`AC-015a`, unit)
- **Given** 가짜 시계 **When** 정상·보장 제외 결과, 계산 근거, 서류(세로·가로·원인 모름; 기획서의 2026-10-14 임시 결정 값), 보류 결과(잠정 값)에서 조작이 없으면 **Then** 160초 경고, 180초 초기화 후 `K00_Start`이며 결과 화면으로 돌아가지 않고 `K06_Complete`를 거치지 않는다. (`AC-015b`, unit)
- **Given** 가짜 시계 **When** 세대 확인 안내, 계산 중, 통신 오류에서 조작이 없으면 **Then** 100초 경고, 120초 초기화다(잠정 값). (`AC-015c`, unit)
- **Given** 경고 전 **When** 환자가 터치하거나 결과·근거·서류 사이를 오가면 **Then** 무조작 시간이 0초부터 다시 시작하고, 서버 응답이 도착하는 것만으로는 다시 시작하지 않는다. (`AC-015d`, unit)
- **Given** TimeoutDialog(환자 입력이 있는 세션과 없는 세션 모두) **When** "계속 사용할게요"를 여러 번 누르면 **Then** 누를 때마다 시간이 다시 시작하고 직전 화면(겹침창 아래의 화면)으로 돌아온다. **When** 같은 TimeoutDialog에서 "처음으로"를 누르면 **Then** ResetConfirm이 뜨지 않고(겹침창 열림 기록에 `ResetConfirm`이 없다) 바로 세션이 지워져 새 `sessionId`로 `K00_Start`가 열리며 `K06_Complete`를 거치지 않는다. 일반 화면의 "처음으로"는 입력이 있으면 ResetConfirm이 먼저 뜬다는 것(`AC-015g`)과 짝으로 시험한다. 이 구분은 제안 · 소유자 수용(2026-10-15, plan.md §E #36)이다. (`AC-015e`, unit + e2e-app)
- **Given** 결과·근거·서류 화면 **When** "이용 완료"를 누르면 **Then** `K06_Complete`가 그려지기 전에 세션 저장소가 비어 있고, `K06_Complete`에 이전 선택·금액이 없으며, `completionHoldSeconds` 뒤 또는 "처음 화면으로"로 `K00_Start`에 간다. 통신 오류 화면의 "이용 종료"도 같은 순서다(잠정). (`AC-015f`, unit + e2e-app)
- **Given** 환자 입력이 하나 이상 있는 세션의 일반 환자 화면(TimeoutDialog가 열려 있지 않음) **When** "처음으로"를 누르면 **Then** ResetConfirm이 먼저 뜨고, 확인하면 지운 뒤 `K06_Complete` 없이 `K00_Start`로, 취소하면 선택·결과·화면이 그대로 남는다. 같은 세션에서 TimeoutDialog 안의 "처음으로"는 ResetConfirm을 거치지 않는다는 것(`AC-015e`)과 짝으로 시험한다(제안, plan.md §E #36). (`AC-015g`, unit + e2e-app)
- **Given** `K00_Start`, `K06_Complete` **When** 오래 두면 **Then** 무조작 타이머가 동작하지 않는다. (`AC-015h`, unit)
- **Given** 도메인 서비스와 메모리 저장소로 병원 A의 무조작 정책(화면 종류별 경고·초기화 초, 예: 입력 단계 90/110)을 바꾸고 병원 B는 정책을 저장하지 않은 상태 **When** 키오스크 상태 기계가 각 병원의 `GET /api/clinics/{slug}/catalog` 응답의 `idlePolicy`(design.md DD-19)로 타이머 임계값을 구성하고 가짜 시계로 입력 단계에서 조작하지 않으면 **Then** 병원 A는 바뀐 값(경고 90초·초기화 110초)에서, 정책을 바꾸지 않은 다른 화면 종류는 DD-10 표의 값에서, 정책이 없는 병원 B는 DD-10 표의 값(100/120초 등)에서 TimeoutDialog와 초기화가 일어난다. `completionHoldSeconds`는 저장된 값이 있을 때만 그 값이고 없으면 null이어서 자동 복귀 시간이 없다. 정책을 저장하는 관리자 API와 20초 하한 검증(400)은 `AC-023d`(M7)가 맡으며 이 항목은 관리자 HTTP 경로를 쓰지 않는다. (`AC-015i`, integration)
- **Given** 환자 입력이 하나도 없는 일반 화면 1 **When** "처음으로"를 누르면 **Then** ResetConfirm 없이 바로 `K00_Start`로 간다. (`AC-015j`, unit + e2e-app)
- **Given** 가짜 시계와 환자 입력이 있는 일반 화면 **When** "처음으로"로 ResetConfirm을 연 채 손대지 않고 경고 시점에 이르면 **Then** ResetConfirm이 닫히고 TimeoutDialog가 열리며(두 겹침창이 동시에 열려 있는 순간이 없다) 선택값과 화면은 그대로이고, 초기화 시점은 ResetConfirm을 열려고 마지막으로 누른 터치에서 정책 시간만큼 지난 때로 ResetConfirm이 없을 때와 같다(ResetConfirm을 열어 둔 시간이 초기화를 늦추지 않는다). 그 TimeoutDialog에서 "계속 사용할게요"를 누르면 ResetConfirm이 아니라 그 아래 화면으로 돌아온다. TimeoutDialog가 열려 있는 동안 ResetConfirm을 여는 입력은 없다. 환자의 터치(ResetConfirm의 버튼 포함)는 무조작 시간을 다시 세게 한다(`AC-015d`). (`AC-015k`, unit + e2e-app — 제안, plan.md §E #36의 겹침창 규칙)
- **Given** 가짜 시계와 모킹한 `fetch`, 환자 입력이 있는 세션에서 `Calculating` 위에 `ResetConfirm`이 열려 있다(제안 · 소유자 수용 2026-10-15, §E #36) **When** 활성 요청의 결말이 (1) 200 `ESTIMATED`·`ESTIMATED_WITH_EXCLUSIONS`·`ON_HOLD` (2) 409 (3) 그 밖의 오류(422 두 종, 그 밖의 4xx, 5xx, 연결 실패) (4) 요청 시간 제한 도달로, 환자가 "취소"를 누르기 전에 도착하는 순서와 누른 뒤에 도착하는 순서 두 가지로 오면 **Then** 두 순서 모두 환자가 보는 끝 화면이 같다: 결말에 따른 화면(결과 3종 가운데 해당, 갱신이 `RUNNING`인 `K03_Treatments`, `K03_Treatments`(`NO_TREATMENT_SELECTED`는 버튼 비활성, `TREATMENT_NOT_PUBLISHED`는 갱신 `RUNNING`) 또는 `KXX_Error_Network`, `KXX_Error_Network`)이며 `Calculating`이 아니다. 결말이 `ResetConfirm`이 열려 있는 동안 도착한 순서에서는 도착한 순간 밑 화면 상태가 이미 바뀌어 있고 `ResetConfirm`은 열린 채 그대로이며(자동으로 닫히거나 확인되지 않는다), 취소 뒤 그 화면이 드러난다. 서버 결말은 무조작 남은 시간을 바꾸지 않고(환자의 취소 터치만 다시 센다, `AC-015d`와 같은 방식으로 비교), 선택·`inputRevision`·`sessionId`가 취소 전후로 같다. (`AC-015l`, unit + e2e-app — design.md DD-07 "겹침창이 열려 있는 동안 도착하는 요청 결말" 규칙 1·2·4)
- **Given** 같은 구성에서 `ResetConfirm`이 열려 있거나 `TimeoutDialog`가 열려 있다 **When** 환자가 `ResetConfirm`에서 확인을 누르거나 `TimeoutDialog` 안의 "처음으로"를 누른 뒤에 활성이었던 요청의 200, 409, 그 밖의 오류, 시간 초과가 차례로 도착하면 **Then** 어느 것도 반영되지 않는다: 새 `sessionId`의 `K00_Start`가 그대로이고, 세션 저장소가 비어 있으며, `K06_Complete`를 거치지 않았고, 로딩 표시와 대기 타이머가 새 세션에 남지 않으며, 409·`TREATMENT_NOT_PUBLISHED`의 catalog·options 다시 받기도 시작되지 않는다. 반대 순서(결말이 먼저 반영된 뒤 확인이나 "처음으로")에서는 반영됐던 결과가 세션 삭제와 함께 지워지고 끝 상태가 같은 `K00_Start`다. 모킹한 `AbortController.abort()`가 아무 일도 하지 않게 해도 같다(취소가 아니라 `activeRequest` 해제와 `sessionId` 불일치로 막힌다). (`AC-015m`, unit + e2e-app — 규칙 3)
- **Given** 가짜 시계와 `Calculating`(무조작 경고 100초, 초기화 120초 잠정 값) 위에 열린 `TimeoutDialog` **When** (1) 초기화 시점 전에 활성 요청의 200이 도착하고 환자가 더 조작하지 않아 초기화 시점이 되면, (2) 초기화 시점이 지난 뒤에 활성이었던 요청의 결말이 도착하면 **Then** (1) 응답은 밑 화면을 결과 화면으로 바꾸지만 `TimeoutDialog`는 열린 채 남고 초기화 시점은 응답이 오기 전에 정해진 시각 그대로이며(응답이 연장하지 않는다. SPEC 제안, 승인 전) 그 시각에 `K00_Start`로 가서 반영됐던 결과가 지워진다; (2) 이미 `K00_Start`이므로 결말은 버려지고 새 세션은 바뀌지 않는다. 두 경우 모두 서버 결말이 무조작 타이머를 다시 시작하지 않는다(남은 시간 비교). (`AC-015n`, unit + e2e-app — 규칙 3·4)
- **Given** `Calculating` 위에 `TimeoutDialog`가 열려 있다 **When** 활성 요청의 200 세 종, 409, 그 밖의 오류가 "계속 사용할게요"보다 먼저 도착하는 경우와 나중에 도착하는 경우 **Then** 두 경우 모두 환자가 보는 끝 화면이 결말에 따른 화면이다. 먼저 도착한 경우 "계속 사용할게요"를 누르면 `Calculating`이 아니라 이미 반영된 화면이 보이고, 나중에 도착한 경우 "계속 사용할게요" 뒤 `Calculating`에서 정상으로 반영된다. "계속 사용할게요"는 무조작 시간을 다시 시작하고 그때 화면 종류의 임계값(결과 화면이면 160/180초)을 쓴다. 응답만으로는 무조작 시간이 다시 시작하지 않는다. (`AC-015o`, unit + e2e-app — 규칙 1·2·4)
- **Given** 요청 시간 제한을 주입값으로 쓰는 키오스크 상태 기계(plan.md §E #21은 열려 있고 값은 주입값이다) **When** (1) 제한을 `Calculating`의 무조작 경고 시간보다 작게 주입하고 `ResetConfirm`이 열린 동안 요청이 만료되거나, (2) 제한을 경고 시간 이상으로 주입해 `TimeoutDialog`가 열린 동안 요청이 만료되면 **Then** `settleRequest(EXPIRED)`가 활성 요청·시간 제한 타이머·로딩 표시를 풀고 컨트롤러를 `abort()`하며 밑 화면이 `KXX_Error_Network`가 되고 겹침창은 열린 채 그대로다. 겹침창을 닫으면(취소 또는 "계속 사용할게요") 환자는 `Calculating`이 아니라 `KXX_Error_Network`("다시 시도"·"이용 종료")를 본다. 만료 뒤 늦게 도착한 응답은 버려지고 만료 자체는 무조작 시간을 다시 시작하지 않는다. 제한을 경고 시간보다 작게 주입하고 환자 조작이 없는 구성에서는 `TimeoutDialog`가 열리기 전에 만료가 일어나 (2)의 상황이 생기지 않음도 확인한다(SPEC 제안, 승인 전: 제한과 경고 시간의 관계). (`AC-015p`, unit + e2e-app — 규칙 5)

### AC-016 세션 보호, 늦은 응답, 복원 금지
요구사항: REQ-FLOW-005
- **Given** 저장소 감시를 건 브라우저 **When** 시작부터 이용 완료까지 진행하면 **Then** localStorage·sessionStorage·IndexedDB·Cache Storage에 쓰기가 없고 서비스워커 등록이 없다. 키오스크 코드의 금지 API 정적 검사도 통과한다. (`AC-016a`, e2e-app + unit)
- **Given** 같은 흐름 **When** URL과 분석 이벤트를 기록하면 **Then** URL에 세대·형태·원인·치료가 없고, 분석 이벤트는 단계 수준 익명 필드만 담는다. (`AC-016b`, e2e-app)
- **Given** 지연된 계산 응답 **When** 응답 전에 초기화하고 다음 환자가 시작한 뒤 응답이 도착하면 **Then** 요청이 취소되었거나, 도착하더라도 활성 요청의 `requestId`와 일치하지 않아(`sessionId`·`inputRevision`도 다르다) 버려져 새 세션 화면이 바뀌지 않는다. (`AC-016c`, unit + e2e-app)
- **Given** 결과를 본 뒤 **When** 뒤로·앞으로 이동, 새로고침, 페이지 캐시 복원(`pageshow` persisted)을 하면 **Then** `K00_Start` 빈 세션이며 이전 결과가 보이지 않는다. (`AC-016d`, e2e-app)
- **Given** 계산 요청 처리 **When** 서버 저장소와 로그를 검사하면 **Then** 환자 선택·결과가 저장되지 않고 로그에 세대·형태·원인·치료 ID가 없다. (`AC-016e`, integration)
- **Given** 키오스크 화면 **When** 관리자 경로 링크·쿠키·토큰을 찾고 빠른 연속 터치를 시도하면 **Then** `/admin` 링크가 없고, 관리자 인증 정보가 없으며, 숨은 터치로 관리자 기능이 열리지 않는다. 관리자 인증과 `/admin` 경로가 생긴 뒤에야 "없다"가 의미를 가지므로, M6는 키오스크 화면에 링크와 숨은 터치 진입이 없다는 증거만 내고 이 항목은 관리자가 만들어진 M7에서 관리자 로그인 뒤의 키오스크 접속까지 포함해 닫는다. (`AC-016f`, e2e-app)
- **Given** 실제 설치 기기의 브라우저 **When** 뒤로 가기·페이지 캐시·재실행을 시험하면 **Then** 이전 환자 결과가 복원되지 않는다. (`AC-016g`, real-device)
- **Given** 가짜 시계와 모킹한 `fetch` **When** 요청 A가 시간 초과로 `FAILED`(`KXX_Error_Network`)가 된 뒤 같은 `sessionId`·`inputRevision`으로 "다시 시도"(요청 B)를 보내고, B가 진행 중인 동안 A의 늦은 성공 응답, 늦은 4xx·5xx 응답, 늦은 409, 늦은 시간 초과 콜백이 차례로 도착하면 **Then** B의 상태·결과·로딩 표시가 바뀌지 않고 A의 어느 결과도 반영되지 않으며, 그 뒤 B의 정상 응답만 반영된다. (`AC-016h`, unit)
- **Given** 활성 요청이 있는 세션 **When** (1) "처음으로"(확인 포함), "이용 완료", 무조작 초기화, 새 환자 세션(새 `sessionId`)으로 초기화하거나 (2) 입력을 바꾸거나 (3) 요청이 만료되거나 (4) 새 시도로 교체된 뒤 이전 시도의 성공·오류·409·시간 초과가 늦게 도착하면 **Then** 어느 경우에도 그 늦은 결과는 반영되지 않고 상태·결과·로딩 표시·화면이 그대로이다. 모킹한 `AbortController.abort()`가 일부러 아무 일도 하지 않게 해 둔 경우에도 같다(취소 없이 `requestId` 보호만으로 막힌다). (`AC-016i`, unit)
- **Given** 가짜 시계(Vitest `vi.useFakeTimers()`)와 모킹한 `fetch`, 무조작 경고 시간보다 작게 주입한 요청 시간 제한을 쓰는 키오스크 상태 기계 **When** 계산 요청 하나를 아래 결말 각각으로 끝내면 **Then** 끝낸 직후(화면 전이가 일어난 뒤) 모든 결말에서: (1) `activeRequest`가 null이다(새 시도로 교체한 경우는 이전 시도 기준이며 교체 직후 `activeRequest`는 새 시도의 것 하나뿐이다); (2) 그 시도의 시간 제한 타이머가 대기 중으로 남아 있지 않다: 요청을 시작하기 직전의 대기 타이머 수를 `vi.getTimerCount()`로 재어 두면 요청 중에는 정확히 1개 늘고 끝낸 직후에는 시작 전 값으로 돌아온다(무조작 타이머는 별개라 그대로이며 교체한 경우는 새 시도의 1개가 남는다); (3) 로딩 표시가 꺼져 있다(교체한 경우는 새 시도의 로딩 표시만 켜져 있다); (4) 컨트롤러는 시간 초과와 취소 계열(초기화·입력 변경·교체)에서만 `abort()`되었고 이미 끝난 요청(200·409·422·그 밖의 4xx·5xx·연결 실패)의 컨트롤러는 `abort()`되지 않았다. 결말: 200 `ESTIMATED`·`ESTIMATED_WITH_EXCLUSIONS`·`ON_HOLD`, 409, 422 `NO_TREATMENT_SELECTED`, 422 `TREATMENT_NOT_PUBLISHED`, 400·404·422 `UNSUPPORTED_GENERATION`, 5xx, 연결 실패, 클라이언트 시간 초과, 대기 중 초기화(처음으로·이용 완료·무조작 초기화), 대기 중 입력 변경, 새 시도로 교체. 이어서 (5) 시계를 요청 시간 제한 이상으로 보내도 화면과 상태가 끝낸 직후와 같고, 특히 성공한 뒤 결과 화면이 `KXX_Error_Network`로 바뀌지 않는다; (6) 정리 전에 잡아 둔 그 시도의 타이머 콜백을 직접 호출하거나 같은 시도의 `settleRequest(requestId, …)`를 다시 호출해도 아무것도 바뀌지 않고, 새 시도 B가 시작된 뒤 이전 시도 A의 늦은 추가 호출(A의 타이머 콜백, A의 늦은 응답·오류, `settleRequest(A의 requestId, …)` 직접 호출)이 와도 B의 대기 타이머(`vi.getTimerCount()`가 B의 1개 그대로이고 B의 타이머 핸들이 살아 있어 시계를 보내면 B의 만료가 제때 일어난다), B의 로딩 표시(켜진 채), 화면(`Calculating`), `activeRequest`(B의 `requestId`)가 바뀌지 않는다; (7) 호출 감시로 `settleRequest`는 한 시도에 여러 번 불릴 수 있음(늦은 응답·늦은 오류·타이머 콜백이 같은 `requestId`로 다시 부름)을 허용하되, 그 시도의 유효한 결말 처리(활성 요청 해제·타이머 정리·로딩 끔·컨트롤러 처리와 결과 반영)는 첫 유효 호출에서 정확히 한 번만 일어나고 정리가 화면 전이보다 먼저 일어난 호출 순서가 기록되며, 같은 시도의 이후 호출은 모두 DD-09 1단계에서 끝나 호출 전후의 상태 스냅샷(`activeRequest`, 대기 타이머 수, 로딩 표시, 화면, 저장된 결과, 컨트롤러의 `abort()` 호출 수, 무조작 남은 시간)이 같다; 정적 검사로 `settleRequest` 밖에서 `activeRequest`를 null로 하거나 요청 결말에 따라 화면을 바꾸는 경로가 없다; (8) 409와 422 `TREATMENT_NOT_PUBLISHED` 뒤의 catalog·options 다시 받기가 끝나기 전에 초기화하거나 입력을 바꾸면 다시 받은 결과가 반영되지 않는다(시작할 때의 `sessionId`·`inputRevision`이 지금과 다르다. 갱신 쪽의 세부는 `AC-020g`가 맡는다); (9) 요청 정리 전후로 남은 무조작 시간이 같다(요청 정리는 무조작 타이머를 다시 시작하지도 멈추지도 않는다. `AC-015d`와 같은 방식). 늦게 오는 이전 시도의 결과는 `AC-016h`·`AC-016i`가, 끝난 시도가 남기는 것의 정리는 이 항목이 맡으며 둘은 서로 모순되지 않는다. (`AC-016j`, unit — design.md DD-09 "요청 생명주기")
- **Given** 계산 시도마다 `requestId`를 만드는 발급기를 알려진 표지 값(예: `RID-TEST-0001`, `RID-TEST-0002`)을 내는 것으로 바꿔 끼운 키오스크 요청 모듈과, 호출 기록을 남기는 `fetch`·XHR 감시 장치(요청 가로채기. 도구는 정하지 않는다) **When** 첫 시도, 시간 초과 뒤 "다시 시도", 409 뒤 재확인, 그 밖의 오류 뒤 재시도까지 계산 요청 여러 건을 보내면 **Then** (1) 대조군: 요청이 진행 중일 때 표지 값이 메모리의 `activeRequest.requestId`에 있다(메모리에 두는 것은 허용되며, 이 확인이 아래 '없음'이 빈 검사가 아님을 보인다); (2) 모든 계산 요청의 본문 전체 문자열, 모든 요청 헤더(이름과 값), 요청 URL의 경로·쿼리·해시 어디에도 표지 값이 없고, 이름에 `requestid`가 든 키·헤더(`requestId`, `request-id`, `x-request-id` 등. 대소문자와 구분자 무시)가 없다; (3) 요청 본문은 design.md DD-19 요청 형식의 여섯 필드(`catalogVersion`, `ruleBundleVersion`, `generation`, `insurerType`, `cause`, `treatmentIds`)만 담는다. 이 항목의 `requestId`는 키오스크의 계산 시도 식별자이며, 관리자 쪽 검토 요청 기록(`CoverageReviewRequest`)의 id(관리자 API 경로의 `{reviewRequestId}`)와 다른 식별자다. 후자는 이 항목의 검사 대상이 아니고 둘을 같은 값이나 같은 필드로 쓰지 않는다. (`AC-016k`, unit — design.md DD-09, DD-19)
- **Given** 같은 표지 발급기와, 클라이언트 로그(console 대용품·오류 보고 어댑터)를 받는 로그 수집 장치, 분석 이벤트를 받는 수집 장치 **When** 정상 결과, 오류, 시간 초과, 409, 초기화를 포함한 같은 시나리오를 진행하면 **Then** 로그 항목과 분석 이벤트 어디에도 표지 값과 `requestId` 키가 없고, 분석 이벤트는 단계 수준 익명 필드만 담는다(`AC-016b`와 같은 기준). 대조군: 수집 장치가 실제로 로그와 이벤트를 받았음을 개수로 확인한다(빈 수집 장치로 통과하지 않는다). (`AC-016l`, unit — 클라이언트 쪽 로그와 분석)
- **Given** 빌드한 앱을 실제 브라우저에서 실행하고, 시험 구성에서 발급기를 표지 값으로 바꾸고, localStorage·sessionStorage·IndexedDB(모든 데이터베이스)·쿠키(`document.cookie`와 브라우저 쿠키 저장소)·Cache Storage·서비스워커 등록 목록의 전체 덤프를 흐름 전후에 뜸 **When** 시작부터 결과, 오류, 초기화까지 진행하며 계산 요청이 여러 건 오가게 하면 **Then** 전후 덤프가 같고(`AC-016a`의 쓰기 없음과 함께 본다) 덤프 어디에도 표지 값이 없다. 실제 발급기 구성(`crypto.randomUUID`)에서도 같은 흐름 뒤 덤프에 UUID 형식 문자열이 새로 생기지 않는다. 이 항목은 `activeRequest`가 메모리에 값을 들고 있는 것을 허용한다. (`AC-016m`, e2e-app — 브라우저 영속 저장소)
- **Given** 서버 시험 구성(메모리 저장소와 서버 로그 수집 장치, 서버 쪽 메모리 캐시·맵·모듈 수준 상태를 덤프할 수 있음)과, 키오스크가 만든 표지 `requestId`를 (a) 보내지 않은 정상 계산 요청, (b) 일부러 본문·헤더(`x-request-id`)·쿼리에 실어 보낸 요청 **When** 계산 요청 여러 건을 보내면 **Then** 저장소(데이터베이스·저장소 구현) 덤프의 전후 비교가 같고(`AC-016e`의 환자 선택·결과 없음과 함께 본다), 서버 메모리 저장소(캐시·맵, 이 값을 키로 쓰는 어떤 구조든)와 서버 로그에 표지 값이 없다. (b)의 응답은 (a)와 같고(서버는 이 값을 읽지 않는다, REQ-API-002) 표지 값은 어느 곳에도 남지 않는다. (`AC-016n`, integration — 서버 쪽 저장소·메모리·로그)
- **Given** 갱신 시도마다 `refreshId`를 만드는 발급기와 계산 시도의 `requestId` 발급기를 각각 알려진 표지 값(예: `RFR-TEST-0001`, `RID-TEST-0001`)을 내는 것으로 바꿔 끼운 키오스크 상태 기계, 호출 기록을 남기는 `fetch` 감시 장치, 클라이언트 로그 수집 장치, 분석 이벤트 수집 장치 **When** 409 뒤 갱신 성공, 갱신 실패 뒤 인라인 재시도, 초기화까지 진행하면 **Then** (1) 대조군: 갱신 중 표지 값이 메모리의 `activeRefresh.refreshId`에 있고 계산 `requestId` 표지 값과 다른 값이다; (2) catalog·options 두 GET의 URL(경로·쿼리·해시)·헤더·본문 어디에도 `refreshId` 표지 값도 계산 `requestId` 표지 값도 없다; (3) 로그 항목과 분석 이벤트에 `refreshId` 표지 값이 없고 `refreshId`·`requestId` 키가 없다(수집 장치가 실제로 받았음을 개수로 확인); (4) 정적 검사로 `refreshId`가 저장소 쓰기 API(`AC-016a`의 금지 목록)에 닿지 않는다; (5) 같은 시나리오에서 `AC-016k`·`AC-016l`의 계산 `requestId` 비노출 검사가 그대로 통과한다(그 규칙은 바뀌지 않았다). `refreshId`는 관리자 `{reviewRequestId}`와도 다른 식별자다. (`AC-016o`, unit — design.md DD-09 "자료 갱신 생명주기" 규칙 4, `refreshId`를 메모리에만 두는 결정은 SPEC 제안 승인 전)

### AC-017 표시·접근성·글꼴
요구사항: REQ-FLOW-006
- **Given** 빌드한 앱 **When** 세로 1080×1920과 가로 1920×1080(임시 검토 크기)에서 모든 화면(가로형 서류 화면 포함)을 그리면 **Then** 버튼·금액·경고 문구가 잘리거나 겹치거나 화면 밖으로 나가지 않는다. (`AC-017a`, render)
- **Given** 큰 글자 보기를 켠 상태 **When** 두 방향(임시 검토 크기)에서 시작부터 이용 완료까지 진행하면 **Then** 일반 모드와 금액·선택·기능이 같고(결과 여섯 동작, 서류 9줄과 체크·사유, 원인 모름 분기, 복귀 규칙), 공간이 모자란 목록은 페이지로 나뉘며 선택이 유지되고, 전환해도 현재 화면이 유지되며, 잘림·겹침·조작 불가가 없다. 초기화 뒤에는 큰 글자 보기가 꺼져 있다(잠정). (`AC-017b`, render + e2e-app)
- **Given** 터치만 쓰는 환경(키보드·마우스 호버 없음) **When** 전체 흐름을 진행하면 **Then** 끝까지 완료된다. (`AC-017c`, e2e-app)
- **Given** 물리 키보드 **When** Tab·방향키로 이동하고 Space·Enter로 고르고 Enter로 확인하면 **Then** 모든 조작이 가능하고, 포커스 표시가 모든 조작 요소에서 색상만이 아닌 방식으로 보이며, 모달이 열리면 포커스가 모달 안에 갇히고 닫으면 연 위치로 돌아간다. (`AC-017d`, e2e-app)
- **Given** 빌드한 화면 **When** 브라우저에서 글꼴을 확인하면 **Then** Pretendard가 실제로 적용되고, 웹폰트 로딩을 막으면 Noto Sans KR → 맑은 고딕 → 시스템 산세리프 순으로 대체되며, 잘림과 줄바꿈은 적용된 그 글꼴로 확인한다. Pencil 화면의 결과는 근거가 아니다. (`AC-017e`, render)
- **Given** 모든 환자 화면 **When** 요소를 검사하면 **Then** 내부 코드, "N" 같은 기호, 내부 설계 설명, 외부 웹 링크가 없고, 주요 터치 영역이 72 CSS px 이상이다(통과 기준으로 쓰는 것은 SPEC 결정). (`AC-017f`, e2e-app)
- **Given** 빌드한 화면 **When** 글자와 바로 뒤 배경의 대비를 재면 **Then** 일반 글자 4.5:1 이상, 큰 글자(24 px 이상, 또는 굵게 18.66 px 이상) 3:1 이상이고, 핵심 안내가 4.5:1에 못 미치면 그 목록을 보고한다. 예외는 로고, 정보가 없는 장식, 실제로 비활성인 조작 요소뿐이다. 이 결과는 디자인 기준의 확인이며 접근성 인증이 아니다. (`AC-017g`, render)
- **Given** 실제 설치 기기 **When** 같은 화면을 띄우면 **Then** Pretendard 적용과 잘림 없음이 실기기에서도 같다. (`AC-017h`, real-device)
- **Given** 실제 설치 기기 **When** 고령자·시력이 낮은 사용자·휠체어 사용자 관점으로 터치 정확도·가독성·도달 범위를 확인하면 **Then** 관찰 결과를 기록한다. 이 항목은 판정 없는 기록 전용이다. 기기 잠금·자동 실행은 웹 UI 수용기준이 아니며 별도로 기록한다. (`AC-017i`, real-device)

## 4. 서버 API

### AC-018 카탈로그와 옵션
요구사항: REQ-API-001
- **Given** 게시 카탈로그 **When** `GET /api/clinics/{slug}/catalog`를 부르면 **Then** 표시 필드만 있고 검토 상태·지문·검토자 같은 키가 없다. 응답에 `idlePolicy` 키가 있어 화면 종류별 경고·초기화 초와 `completionHoldSeconds`를 담는다(저장된 정책이 없는 병원은 DD-10 표의 값, `completionHoldSeconds`는 저장된 값이 없으면 null이며, 이 값들은 표시 설정이고 보장 검토 내부 정보가 아니다). 없는 slug는 404 `CLINIC_NOT_FOUND`다. (`AC-018a`, integration)
- **Given** 승인된 프로필이 하나도 없는 병원 A와, 서로 다른 규칙 묶음을 쓰는 병원 B **When** 각 병원의 `GET /api/clinics/{slug}/insurance/options`를 부르면 **Then** 두 응답 모두 세대 5장, 형태 3장, 원인 3장, 안내 문구(1544-8069는 문자열)가 있고 "1588"은 없으며, `ruleBundleVersion`과 `ruleBundleStatus`(`ACTIVE` | `SUSPENDED`)는 각 병원의 규칙 사용 범위가 가리키는 묶음의 값(범위가 없으면 둘 다 null)이고 응답은 `Cache-Control: no-store`다. 없는 slug는 404다. (`AC-018b`, integration)

### AC-019 서버 재계산과 병원 소유 확인
요구사항: REQ-API-002
- **Given** 요청 본문에 가격·비율·병원 ID를 바꾼 필드를 덧붙임 **When** 계산을 요청하면 **Then** 결과가 서버 게시 데이터로 계산한 값과 같고, 그 필드를 읽는 코드 경로가 없다(필드 접근 감시). (`AC-019a`, integration)
- **Given** `catalogVersion`·`ruleBundleVersion`이 병원 A의 현재 값과 같은 `POST /api/clinics/{병원 A slug}/estimate`에 병원 B의 치료 ID, 또는 병원 A의 비활성·미게시 치료 ID **When** 요청하면 **Then** 422 `TREATMENT_NOT_PUBLISHED`다. 옛 버전이 겹친 경우는 409가 먼저이며 `AC-021k`가 정한다. (`AC-019b`, integration)
- **Given** 같은 데이터 **When** 키오스크 미리보기 합계와 서버 계산을 비교하면 **Then** 두 경로가 같은 엔진 모듈을 가져오고(모듈 동일성 시험) 병원 결제액이 같다. 키오스크의 합계 코드는 M5·M6에서 만들어지므로 M4는 서버 쪽 모듈 동일성만 증거로 내고 이 항목은 키오스크 화면이 만들어진 M6에서 닫는다. (`AC-019c`, unit + integration)
- **Given** 선택한 치료 가운데 하나가 사용 가능한 `EXCLUDED` 매핑으로 확인된 제외가 되어 전체가 `ESTIMATED_WITH_EXCLUSIONS`인 요청 **When** `POST /api/clinics/{slug}/estimate`를 부르면 **Then** (a) 그 제외된 치료만 `imaging` 표시를 갖고 서류 규칙 묶음에 `imaging`을 요구하는 규칙이 있으면 `documents`에서 그 서류 줄이 필요하다(제외된 치료의 표시도 센다); (b) 공통 기본비용 줄만 `imaging` 표시를 갖는 요청에서는 그 줄이 필요하지 않다(공통 기본비용 줄의 표시는 합치지 않는다); (c) 같은 선택을 `treatmentIds`의 순서만 바꿔 요청하면 `documents`가 바이트 단위로 같다. 전체가 `ON_HOLD`이면 `documents`는 null이다. (`AC-019d`, integration — design.md DD-06 "규칙 평가" 4번의 서버 쪽 증거)

### AC-020 버전 불일치
요구사항: REQ-API-003, REQ-FLOW-001
- **Given** 병원 A의 옛 `catalogVersion` 또는 옛 `ruleBundleVersion`을 담았고 그 밖의 점에서는 유효한 요청(구조, 지원 세대, 비어 있지 않은 `treatmentIds`가 DD-19 "요청 검증의 층" 0~2를 통과함) **When** `POST /api/clinics/{병원 A slug}/estimate`를 요청하면 **Then** 409이고 본문이 DD-14 형식(`error: VERSION_MISMATCH`, 병원 A 기준 `latest` 두 버전과 `latest.ruleBundleStatus`, `changes.priceChanged`, `changes.ruleChanged`, `changes.treatmentsUnpublished[]`)이며 결과가 없다. 두 버전이 현재 값과 모두 같은데 묶음이 중지된 요청은 409가 아니라 200 `ON_HOLD`다(AC-011f). (`AC-020a`, integration)
- **Given** 활성 요청의 409 또는 422 `TREATMENT_NOT_PUBLISHED`를 받은 키오스크 **When** 처리하면 **Then** `K03_Treatments` 안에서(새 화면 없이) 그 병원의 catalog·options를 다시 받고, 둘 다 도착한 뒤 한 단계로 게시 중인 선택은 유지하고, 내려간 치료는 안내와 함께 빼고, 새 합계를 보이고, "예상 부담액 확인"을 활성화해 4단계에서 환자가 다시 확인해야 결과가 나온다. 옛 값으로 결과 화면이 열리지 않는다. 활성 요청이 아닌 이전 시도(만료되었거나 새 시도로 교체됨)의 409는 무시되어 상태·화면이 바뀌지 않는다. 갱신 계약의 세부(진행 중 계산 차단, 한 단계 반영, 실패와 재시도, 늦은 결과, 경합, 겹침창)는 `AC-020c`~`AC-020i`가 맡는다. (`AC-020b`, unit + e2e-app)
- **Given** 가짜 시계와 모킹한 `fetch`(catalog·options 응답을 보류해 둔다), 활성 요청의 409(다른 시험에서는 422 `TREATMENT_NOT_PUBLISHED`)로 자료 갱신이 `RUNNING`인 `K03_Treatments` **When** 갱신이 끝나기 전(한쪽만 도착한 때 포함)에 "예상 부담액 확인" 사건과 `KXX_Error_Network`의 "다시 시도" 사건을 상태 기계에 강제로 보내면 **Then** (1) 상태 기계가 내는 확인 버튼 활성 값은 false다(치료가 여러 개 있어도); (2) 두 사건 모두 거절되어 `Calculating`으로 가지 않고 계산 엔드포인트로 가는 `fetch` 호출이 0건이다(호출 감시); (3) 갱신이 성공해 한 단계로 반영되기 전까지 (1)·(2)가 유지된다. (`AC-020c`, unit — design.md DD-09 "자료 갱신 생명주기" 규칙 1)
- **Given** 같은 구성에서 선택 `[X, Y, Z]`, 새 catalog에서 Y가 내려가고 가격이 바뀌고 새 options의 버전도 바뀐 상태 **When** (1) catalog만 도착하거나 (2) options만 도착하거나 (3) 둘 다 도착하면 **Then** (1)·(2)는 아무것도 반영되지 않는다: 선택, 합계, 보관 중인 catalog·options 자료와 두 버전, 확인 버튼 상태, 화면이 모두 갱신 전과 같다. (3)은 상태 변경이 한 번이다(상태 구독자 호출 1회, 반쯤 반영된 중간 스냅샷이 없다): ① 선택 `[X, Z]`와 Y의 제거 안내 ② 엔진 합산 함수로 낸 새 합계 ③ catalog·options 자료와 두 버전의 교체 ④ `refreshState = NONE`과 로딩 표시 끔 ⑤ 확인 버튼 활성. 선택이 모두 빠진 경우 버튼은 기존 규칙대로 비활성이고, 선택이 하나라도 제거되면 `inputRevision`이 한 번 오르며 제거가 없으면 그대로다. 무조작 남은 시간은 바뀌지 않는다(`AC-015d`와 같은 방식). (`AC-020d`, unit — 규칙 2)
- **Given** 같은 구성 **When** (1) catalog 성공·options 실패, (2) catalog 실패·options 성공, (3) 둘 다 도착하지 않은 채 갱신의 시간 제한(주입값, §E #21은 열려 있다)에 도달하고, 실패 종류는 연결 실패·5xx·그 밖의 4xx를 모두 돌리면 **Then** 모든 경우 도착한 쪽도 쓰이지 않아 선택·합계·보관 자료·두 버전이 갱신 전 그대로이고, 계산 엔드포인트 `fetch`가 0건이며, 확인 버튼은 비활성, `refreshState = FAILED`, 화면은 `K03_Treatments`에 머물며 인라인 안내와 인라인 "다시 시도"가 보이고(`KXX_Error_Network`로 가지 않는다. 제안, 승인 전), 나머지 한쪽의 늦은 응답은 버려진다. 인라인 "다시 시도"를 누르면 계산 요청 없이 새 `refreshId`로 catalog·options 갱신이 먼저 시작되고, 확인 버튼은 둘 다 성공해 한 단계로 반영될 때까지 비활성이며, 재시도도 실패하면 다시 `FAILED`다. 성공한 뒤에야 버튼이 활성이 되고 환자가 "예상 부담액 확인"을 눌러야 계산 요청이 나가며 그 요청은 새 버전을 담는다. (`AC-020e`, unit — 규칙 3, 시간 제한은 SPEC 제안)
- **Given** 갱신 A가 시간 제한으로 끝나(`FAILED`) 인라인 "다시 시도"로 갱신 B가 `RUNNING`인 상태 **When** B가 진행 중일 때 A의 늦은 성공, A의 늦은 실패, A의 시간 제한 타이머 콜백, `settleRefresh(A의 refreshId, …)` 직접 호출이 차례로 오면 **Then** B의 결과, 확인 버튼 상태(비활성), 로딩 표시(켜짐), 화면, 보관 자료, B의 대기 타이머(`vi.getTimerCount()`가 B의 1개 그대로)가 모두 바뀌지 않고 B의 정상 완료만 반영된다. 같은 갱신 B의 `settleRefresh`를 여러 번 불러도(성공 직후의 늦은 실패, 실패 직후의 늦은 성공) 첫 유효 호출만 정리와 결과 반영을 하고 이후 호출은 호출 전후의 상태 스냅샷(`refreshState`, 대기 타이머 수, 로딩 표시, 화면, 보관 자료, 컨트롤러의 `abort()` 호출 수, 무조작 남은 시간)이 같다. `refreshId`는 계산 `requestId`·관리자 `{reviewRequestId}`와 다른 식별자다. (`AC-020f`, unit — 규칙 4)
- **Given** 갱신이 `RUNNING`인 `K03_Treatments` **When** (1) `ResetConfirm`의 확인(또는 `TimeoutDialog` 안의 "처음으로") 뒤에 성공·실패·시간 제한 결과가 도착하거나, (2) 무조작 초기화 시점이 지난 뒤에 결과가 도착하거나, (3) 입력 변경 사건(잠금을 거치지 않고 상태 기계에 직접 넣은 치료 추가·해제, 이전 단계 선택 변경)이 먼저 일어난 뒤 성공 결과가 도착하면 **Then** (1)·(2)는 결과가 반영되지 않는다: 새 `sessionId`의 `K00_Start`가 그대로이고, 세션 저장소가 비어 있으며, `refreshState = NONE`이고, 로딩 표시와 대기 타이머가 새 세션에 남지 않고, `K06_Complete`를 거치지 않는다(반대 순서로 결과가 먼저 반영된 뒤 확인하면 반영된 내용이 세션 삭제와 함께 지워져 끝 상태가 같다). 모킹한 `AbortController.abort()`가 아무 일도 하지 않게 해도 같다. (3)은 성공 결과가 반영되지 않아 자료·선택·합계가 그대로이고 `refreshState = FAILED`, 확인 버튼 비활성, 인라인 안내와 "다시 시도"가 보인다(제안, 승인 전). 화면에서는 갱신 중 치료 카드와 "이전"이 비활성이라 (3)의 입력이 만들어지지 않는다(`AC-020i`). (`AC-020g`, unit — 규칙 5)
- **Given** 가짜 시계, 갱신이 `RUNNING`인 `K03_Treatments` 위에 `ResetConfirm`(다른 시험에서는 `TimeoutDialog`)이 열려 있다 **When** 갱신 결과(성공, 실패, 시간 제한)가 겹침창이 열려 있는 동안 도착하거나 아직 도착하지 않은 채 겹침창을 닫으면 **Then** design.md DD-07 표 2대로다: 도착한 순간 밑 화면에 곧바로 반영되고(성공은 한 단계 반영과 확인 버튼 활성, 실패·시간 제한은 인라인 안내와 비활성 버튼) 겹침창은 열린 채 그대로이며, 취소 또는 "계속 사용할게요" 뒤 환자는 갱신 전 상태가 아니라 최신 갱신 상태를 본다. 아직 진행 중이면 닫은 뒤에도 확인 버튼은 비활성이다. 확정된 초기화(확인, `TimeoutDialog`의 "처음으로", 무조작 초기화) 뒤의 결과는 반영되지 않는다. 갱신의 시작·결과·실패는 무조작 남은 시간을 바꾸지 않고(`AC-015d`와 같은 방식), 열린 `TimeoutDialog`의 초기화 시점은 결과가 와도 그대로다(제안, 승인 전). (`AC-020h`, unit + e2e-app — 규칙 6)
- **Given** 빌드한 앱의 `K03_Treatments`에서 409(또는 422 `TREATMENT_NOT_PUBLISHED`) 뒤 갱신이 일어난다 **When** 갱신 중, 성공 뒤, 실패 뒤를 각각 관찰하면 **Then** 새 프레임이나 새 입력 단계 없이 같은 화면 안에서: 갱신 중에는 "예상 부담액 확인"이 비활성으로 보이고 인라인 진행 표시가 있으며 치료 카드와 "이전"이 비활성이고 "처음으로"·목록 페이지 이동·큰 글자 전환은 동작한다; 성공 뒤에는 내려간 치료의 기존 안내, 새 합계, 활성 버튼이 보이고; 실패 뒤에는 인라인 안내와 "다시 시도"가 보이고 확인 버튼은 비활성이며 0원이나 내부 코드가 보이지 않는다. 두 방향과 큰 글자 보기에서 잘림이 없다(`AC-017a`·`AC-017b`와 같은 방식). (`AC-020i`, e2e-app — 인라인 표시와 안내 문구는 SPEC 제안, 승인 전)

### AC-021 오류 분류와 실행 중 제약
요구사항: REQ-API-004, REQ-ENG-001, REQ-FLOW-005
- **Given** design.md DD-19 오류 표의 공개 경로 조건(400 `INVALID_REQUEST`의 구조 오류 각 경우, 404 `CLINIC_NOT_FOUND`, 409 `VERSION_MISMATCH`, 422 `UNSUPPORTED_GENERATION`·`NO_TREATMENT_SELECTED`·`TREATMENT_NOT_PUBLISHED`, 500 `INTERNAL_ERROR`) **When** 공개 경로로 요청하면 **Then** 표의 HTTP 상태와 코드가 정확히 나오고 400과 422의 층 구분(DD-19 "요청 검증의 층", `AC-006f`와 같은 입력)이 지켜지고, 거절 조건이 겹칠 때의 순서는 `AC-021h`~`AC-021m`이 확인한다. 엔진이 `INVALID_NUMERIC_INPUT`으로 거절한 경우(`AC-006i`)는 금액과 내부 상세 없이 500이다. 관리자 경로의 401·403, 관리자 입력의 수치 범위 위반과 사유 없는 중지의 400은 관리자 API가 있는 M7의 `AC-021f`가 맡는다. (`AC-021a`, integration)
- **Given** 보류가 되는 입력 **When** 요청하면 **Then** HTTP 200이고 `result.state = ON_HOLD`다. (`AC-021b`, integration)
- **Given** 성공 응답 **When** 확인하면 **Then** `versions`(카탈로그·규칙 묶음과 그 `ruleBundleStatus`·프로필 id·버전)와 `origin`이 있다. (`AC-021c`, integration)
- **Given** 의존성 목록과 `src/` 전체(엔진·서버·키오스크·관리자)의 가져오기 그래프 **When** 검사하면 **Then** 생성형 AI·모델 SDK가 없고, 계산 경로에서 저장소 외 바깥 네트워크 호출이 없다(네트워크 감시). 코드를 마지막으로 더하는 마일스톤(M7)에서 `src/` 전체를 한 번에 검사해 닫으며, M4(서버)와 M6(키오스크)는 그때까지 만들어진 범위의 같은 검사를 증거로 낸다. (`AC-021d`, unit + integration)
- **Given** 계산 응답과 options 응답 **When** 헤더를 확인하면 **Then** `Cache-Control: no-store`다. (`AC-021e`, integration)
- **Given** 관리자 API 요청 **When** 인증 없이 요청하고, 권한 밖의 역할로 요청하고, 가격·기본비용·프로필의 값이 DD-24 범위 밖인 게시를 요청하고, 규칙 묶음 게시에서 매핑 필드 규칙·프로필 구조·묶음 교차 검사를 어기고(`AC-011h`, `AC-011i`와 같은 입력), 사유 없이 규칙 묶음 중지를 요청하면 **Then** 각각 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 400 `INVALID_REQUEST`다. 수치·게시 검증 위반의 400 본문에는 어긋난 필드 경로가 있고 아무것도 저장되지 않는다. 도메인 서비스의 거절(`AC-011e`, `AC-011h`, `AC-011i`)이 관리자 API에서 400이 되는 변환을 이 항목이 맡는다. (`AC-021f`, integration)
- **Given** 키오스크 문서(`/kiosk/{clinicSlug}`) **When** 응답 헤더를 확인하면 **Then** `Cache-Control: no-store`다. 키오스크 화면이 만들어진 M6에서 닫는다. 계산 응답과 options 응답의 헤더는 `AC-021e`(M4)가 맡는다. (`AC-021g`, integration)
- **Given** 병원 A의 옛 `catalogVersion`(또는 옛 `ruleBundleVersion`)을 담고 `cause`가 열거 밖의 문자열인 요청, 그 밖의 필드는 형식에 맞음(겹침 (a)) **When** `POST /api/clinics/{병원 A slug}/estimate`를 부르면 **Then** 400 `INVALID_REQUEST`이고 409가 아니다. 결과가 없고 응답 본문에 `latest`·`changes`가 없으며, 저장소 호출 감시에서 병원 확인(slug 조회)을 뺀 병원 A의 규칙 사용 범위·묶음 상태·항목 상태·카탈로그 읽기가 일어나지 않는다(구조 검증이 버전 비교보다 앞선다). `generation`이 열거 밖이거나 `treatmentIds`가 빈 배열인 요청에 `cause`까지 열거 밖이면 422가 아니라 400이다(층 1이 층 2보다 앞선다). (`AC-021h`, integration — design.md DD-19 "요청 검증의 층" 1층 대 3층)
- **Given** 병원 A의 옛 `catalogVersion`(또는 옛 `ruleBundleVersion`)을 담고 `generation`이 문자열이지만 다섯 값 밖(예: 5세대)인 요청, 그 밖의 필드는 유효함(겹침 (b)) **When** 같은 경로를 부르면 **Then** 422 `UNSUPPORTED_GENERATION`이고 409가 아니다. 결과가 없고 본문에 `latest`·`changes`가 없으며 층 3의 읽기(규칙 사용 범위·묶음 상태·항목 상태)가 일어나지 않는다. (`AC-021i`, integration — 2층 대 3층)
- **Given** 병원 A의 옛 `catalogVersion`(또는 옛 `ruleBundleVersion`)을 담고 `treatmentIds`가 빈 배열인 요청, 그 밖의 필드는 유효함(겹침 (c)) **When** 같은 경로를 부르면 **Then** 422 `NO_TREATMENT_SELECTED`이고 409가 아니다. 결과가 없고 본문에 `latest`·`changes`가 없으며 층 3의 읽기가 일어나지 않는다. `generation`도 열거 밖이면 `UNSUPPORTED_GENERATION`이 먼저다(DD-03 순서). (`AC-021j`, integration — 2층 대 3층)
- **Given** 병원 A가 치료 X·Y를 담은 카탈로그 v1을 게시했고 이어서 Y를 내려 v2를 게시한 상태, 그리고 v1(`catalogVersion`)과 `treatmentIds` `[X, Y]`를 담은 유효한 요청(겹침 (d)) **When** 같은 경로를 부르면 **Then** 422가 아니라 409이고 결과가 없다. 본문은 `error: VERSION_MISMATCH`, `latest.catalogVersion = v2`와 현재 `latest.ruleBundleVersion`·`latest.ruleBundleStatus`, 실제 차이에 맞는 `changes.priceChanged`·`changes.ruleChanged`, 그리고 `changes.treatmentsUnpublished = [Y]`다(X는 없다. 요청에 적힌 순서, 중복 없음). 같은 요청에 병원 B의 치료 ID Z를 더하면 `treatmentsUnpublished = [Y, Z]`다. 요청의 ID가 모두 v2에서도 게시 중이면 `treatmentsUnpublished = []`이고 여전히 409다. 이 배열의 내용 규정은 SPEC 제안(승인 전, design.md DD-14)이다. (`AC-021k`, integration — 3층 대 4층)
- **Given** 두 버전이 병원 A의 현재 값과 같은 요청에 (1) 병원 A의 비활성·미게시 치료 ID, (2) 병원 B의 치료 ID, (3) 어느 병원에도 없는 ID가 하나씩 든 경우(겹침 (e)) **When** 같은 경로를 부르면 **Then** 각각 422 `TREATMENT_NOT_PUBLISHED`이고 결과와 `documents`가 없으며 응답에 다른 병원의 치료 이름·가격이 없다. 같은 요청에서 두 버전 가운데 하나만 옛 값으로 바꾸면 응답이 `AC-021k`의 409로 바뀐다(3층이 4층보다 앞선다). (`AC-021l`, integration — 4층)
- **Given** 두 버전이 병원 A의 현재 값과 같고 병원 A의 규칙 사용 범위가 가리키는 묶음이 도메인 서비스로 중지된 상태(겹침 (f)) **When** 게시 중인 치료 ID로 같은 경로를 부르면 **Then** 409도 4xx도 아닌 HTTP 200 `ON_HOLD`다: `versions.ruleBundleStatus = "SUSPENDED"`, `versions.profile`은 null, 모든 줄이 `holdReason = RULE_BUNDLE_SUSPENDED`, `amounts.hospitalPayment`는 숫자(게시 가격의 합), `expectedInsurancePayout`·`expectedOutOfPocketAfterPayout`는 null, `documents`는 null이다. 같은 상태에서 (1) 요청에 미게시 치료 ID를 더하면 422 `TREATMENT_NOT_PUBLISHED`이고(4층이 계산보다 앞서므로 보류 결과가 아니다), (2) 옛 버전을 담으면 409이며 `latest.ruleBundleStatus = "SUSPENDED"`다(3층). (`AC-021m`, integration — 5층, `AC-011f`의 (2)와 같은 결과)

## 5. 관리자

### AC-022 역할과 병원 격리
요구사항: REQ-ADM-001
- **Given** design.md DD-17 권한 표(검토 요청 기록 생성은 HA, 매핑 작성·승인·반려는 RV, 플랫폼 운영자는 관리자 소속·역할 관리와 규칙 사용 범위 지정 두 권한과 그에 필요한 조회만 가짐) **When** 역할 × 자원 × 동작의 모든 칸을 매개변수 시험하면 **Then** 표의 O 칸과 범위가 적힌 칸("자기 병원" 등)은 그 범위 안의 요청이 성공하고 범위 밖의 요청은 403이며, "—" 칸은 403, 인증 없는 요청은 401이고, 플랫폼 운영자의 병원 설정·무조작 정책·치료·가격 수정 시도는 403이다. 규칙 묶음 중지(`POST /api/admin/rule-bundles/{id}/suspend`)는 검토 담당자만 성공하고 병원 관리자와 플랫폼 운영자는 403이다. (`AC-022a`, integration)
- **Given** 병원 A 관리자 **When** 병원 B의 가격·설정을 읽거나 바꾸려 하면 **Then** 403이고 목록 응답에 B 데이터가 섞이지 않는다. (`AC-022b`, integration)
- **Given** 여러 역할을 맡은 사용자 **When** 동작하면 **Then** 동작마다 해당 역할 권한으로만 판정된다. (`AC-022c`, integration)

### AC-023 병원 관리자의 한계와 설정
요구사항: REQ-ADM-002, REQ-ADM-005, REQ-FLOW-001
- **Given** 병원 관리자 **When** 프로필·공제·한도·매핑 수정, 매핑 승인·반려, "검토 완료" 지정을 API로 시도하면 **Then** 모두 403이다. (`AC-023a`, integration)
- **Given** 병원 관리자 화면 **When** 그리면 **Then** 검토 상태는 읽기 전용이고 상태 동작은 "검토 요청"뿐이며 "검토 완료" 버튼·선택값이 없다. (`AC-023b`, render)
- **Given** 병원 관리자 **When** 보장 분류 정보를 등록·변경 요청하고 검토를 요청하면 **Then** 새 초안 치료 버전과 `REVIEW_REQUESTED` 검토 요청 기록이 생긴다. (`AC-023c`, integration)
- **Given** 무조작 정책 저장 **When** 경고 ≥ 초기화, 또는 차이 < 20초(잠정 하한)인 값을 보내면 **Then** 400 `INVALID_REQUEST`로 거절되고, 조건을 만족하는 값은 화면 종류별로 저장된다. `completionHoldSeconds`는 20초 하한 없이 양의 정수면 저장된다. (`AC-023d`, integration)
- **Given** 브랜드 설정 **When** 처음 읽으면 **Then** 서비스 표시명이 "보담"이고 병원명은 별도 필드다. (`AC-023e`, integration)

### AC-024 검토 요청·매핑 작성·승인·반려
요구사항: REQ-ADM-003
- **Given** 병원 관리자의 검토 요청 **When** 검토 담당자가 그 요청으로 매핑 초안을 만들어 승인하고 규칙 묶음을 게시하면 **Then** 요청 기록은 `REVIEW_REQUESTED`에서 결과 `APPROVED`로 닫히고, 매핑은 `DRAFT` → `REVIEW_REQUESTED` → `APPROVED` → `PUBLISHED`로 바뀌어 계산에 쓰이며, 작성자와 승인자가 같으면 `selfApproval: true`가 기록된다. (`AC-024a`, integration)
- **Given** 검토 담당자 **When** 사유 없이 반려하면 **Then** 400 `INVALID_REQUEST`이고, 사유를 넣으면 요청 기록과 매핑이 `REJECTED`가 되어 병원 관리자가 사유를 볼 수 있다. (`AC-024b`, integration)
- **Given** 새 치료 **When** 매핑 없이 가격을 게시하면 **Then** 게시는 되고, 그 줄만 `MAPPING_ABSENT`로 보류되며 다른 줄은 영향이 없다. (`AC-024c`, integration)

### AC-025 게시 이력·감사 기록·미리보기·규칙 사용 범위
요구사항: REQ-ADM-004
- **Given** 게시·승인·반려·중지·복구 **When** 각각 실행하면 **Then** 감사 기록에 수행자·역할·일시·사유·이전/이후 버전이 남는다(규칙 묶음 중지는 이전/이후 상태와 영향을 받는 병원 수도 남는다). (`AC-025a`, integration)
- **Given** 작성자와 승인자가 같은 승인과 다른 승인 **When** 기록하면 **Then** 각각 `selfApproval: true`, `false`다. (`AC-025b`, integration)
- **Given** 같은 데이터 **When** 관리자 미리보기(세로·가로)와 서버 계산을 비교하면 **Then** 결과가 같다(같은 엔진). (`AC-025c`, integration)
- **Given** 플랫폼 운영자 **When** 병원 A의 규칙 사용 범위를 묶음 X로 지정하면 **Then** 병원 A의 options·계산이 묶음 X를 쓰고, 지정 전에는 병원 A의 계산이 `CLINIC_RULE_SCOPE_ABSENT`로 보류되며, 다른 역할의 지정 시도는 403이다. (`AC-025d`, integration)
- **Given** 프로필 승인 **When** 계산 예제-약관 대조 기록을 첨부하면 **Then** 승인 기록과 함께 저장되고 조회된다. (`AC-025e`, integration)
- **Given** 병원 A·B가 현재 규칙 묶음 X를, 병원 C가 묶음 Y를 쓰고, 병원 D는 예전에 X를 썼으나 지금은 Y를 쓰는 상태 **When** 묶음 X의 중지를 요청하면 **Then** 검토 담당자만 성공하고(병원 관리자와 플랫폼 운영자는 403, 인증 없음은 401), 사유가 비어 있으면 400 `INVALID_REQUEST`이며, 응답의 `affectedClinics`는 현재 범위가 X를 가리키는 병원 A·B(`clinicId`, `slug`)와 정확히 같고(병원 C와 D, 지난 범위 이력은 없다), 감사 기록이 남으며, 플랫폼 운영자가 병원 하나의 규칙 묶음을 즉시 멈추는 병원별 긴급 중지 엔드포인트는 없다. (`AC-025f`, integration)

## 6. 경계 사례 모음

| 사례 | 기대 | 관련 AC |
|------|------|---------|
| 치료 0개로 확인 버튼 | 버튼 비활성, API 직접 호출 시 422, 0원 없음 | AC-006b, AC-006f, AC-012b |
| 공제가 비용보다 큼 | P = 0, 음수 없음, 명목·실제 공제 분리 | AC-002h |
| 한도에서 공제를 빼는 잘못된 계산 | 240,000이 아니라 250,000 | AC-002g |
| 같은 그룹 치료 셋 이상 | 공제는 그룹 합계에 한 번, 줄 단위 지급액 없음 | AC-002i, AC-002j |
| 공유 한도 뒤 합계 | `Σ P_pooled` = 예상 보험금, 순서를 바꿔도 총합 동일 | AC-003f, AC-004h |
| 수치가 범위 밖 | 0·`NaN`으로 고치지 않음: 줄 금액·합계는 거절, 프로필 값·계산 범위는 그룹 보류, 게시는 거절(관리자 API는 400) | AC-006h, AC-003g, AC-003h, AC-011h, AC-006i, AC-021f |
| 계산 요청 본문의 구조 오류와 열거 밖 값 | JSON·필수 필드·JSON 형식 오류와 `insurerType`·`cause`의 열거 밖 값은 400 `INVALID_REQUEST`, `generation`이 문자열이지만 다섯 값 밖이면 422 `UNSUPPORTED_GENERATION`, 빈 `treatmentIds`는 422 `NO_TREATMENT_SELECTED` | AC-006f, AC-021a |
| 관리자 요청의 인증·권한·검증 오류 | 인증 없음 401, 권한 밖 403, 수치·게시 검증 위반과 사유 없는 중지 400(어긋난 필드 경로). 도메인 서비스의 거절과 HTTP 변환은 따로 증명 | AC-021f, AC-011e, AC-011h, AC-011i |
| 병원별 무조작 정책 | catalog 응답의 `idlePolicy`로 키오스크 임계값이 바뀐다. 정책이 없는 병원은 DD-10 표의 값 | AC-015i, AC-018a, AC-023d |
| 곱셈은 안전하나 반올림 덧셈에서 초과 | 같은 E가 `TRUNCATE`에서는 정상, `ROUND_HALF_UP`에서는 그 그룹만 `CALC_RANGE_EXCEEDED`(공제 방식·원 단위 처리·비율마다 경계가 다름, 금액·비율을 잘라 맞추지 않음) | AC-003h |
| 모든 항목 제외 | 예상 보험금 0, 부담 = 병원 결제액, 상태 `ESTIMATED_WITH_EXCLUSIONS` | AC-004b |
| 매핑 없는 줄 | 어느 그룹에도 없음, 참고 그룹은 나머지 줄로만 | AC-004d |
| 매핑 2개 이상이 동시에 사용 가능(`COVERED`+`EXCLUDED` 포함) | `MAPPING_INVALID`. 사용 가능은 지문까지 통과한 것만 센다. 사용 가능한 후보가 없으면 고정 우선순위 코드. 배열 순서와 무관 | AC-008b, AC-008h, AC-008i, AC-008k |
| 확인된 제외 | 사용 가능한 `EXCLUDED` 매핑으로만 존재. 분류 확인 필요·사용 불가 매핑은 제외가 아니라 보류 | AC-008j, AC-002e, AC-011i |
| 묶음 중지인데 프로필·매핑도 사용 불가 | `RULE_BUNDLE_SUSPENDED`, 항목 판정 호출 0회 | AC-008g, AC-008l |
| 프로필 구조 결함·같은 칸의 프로필 둘 이상 | 모든 줄 `PROFILE_INVALID`. 공유 한도 풀 값 결함은 그 풀의 멤버 그룹만 보류 | AC-008a, AC-008m, AC-011i |
| 병원에 규칙 사용 범위 없음 | 모든 줄 `CLINIC_RULE_SCOPE_ABSENT` | AC-008f, AC-025d |
| 원인 모름 | 금액 동일, 서류만 분기 | AC-006d, AC-007c |
| 세대 모름 | 계산 요청 없음, 결과 상태 아님 | AC-012d |
| 가입일로 세대 추정 | 날짜 입력 없음, 세대를 정하거나 제안하지 않음 | AC-012i |
| 계산 중 초기화 | 요청 취소, 늦은 응답 버림 | AC-016c, AC-016i |
| 시간 초과 뒤 재시도 중 이전 시도의 늦은 결과 | 새 시도의 상태·결과·화면 불변, 이전 결과 무시 | AC-016h |
| 계산 중 가격 변경 | 409, 옛 값 확정 금지 | AC-020 |
| 서류 규칙 없음 | `RULES_UNAVAILABLE`, 결과 동작 유지 | AC-007d, AC-007g |
| 결과 보류 | 서류·근거 진입 없음, 결과 문구 원칙 없음 | AC-007e, AC-013c |
| 운영 구성에 시험 자료 유입 | 해당 보류 코드, 빌드 검사 실패 | AC-010a, AC-010b |
| 입력 없이 "처음으로" | 확인 없이 `K00_Start` | AC-015j |
| TimeoutDialog 안의 "처음으로" | ResetConfirm 없이 즉시 `K00_Start`(제안 · 소유자 수용 2026-10-15, §E #36). 일반 화면에서 입력이 있을 때는 ResetConfirm | AC-015e, AC-015g |
| ResetConfirm이 열린 채 경고 시점 도달 | ResetConfirm을 닫고 TimeoutDialog를 연다. 초기화 시점은 늦춰지지 않는다 | AC-015k |
| 응답 헤더 `Cache-Control: no-store` | 계산 응답·options 응답은 M4, 키오스크 문서는 M6에서 각각 확인 | AC-021e, AC-021g |
| 요청이 끝난 뒤 남은 시간 제한 타이머 | 활성 요청과 타이머를 먼저 풀고 화면을 바꾼다. 성공한 결과 화면이 통신 오류 화면으로 바뀌지 않는다 | AC-016j |
| 같은 시도에 `settleRequest`가 여러 번 불림 | 첫 유효 호출만 정리와 결과 반영을 하고, 이후의 호출과 새 시도가 시작된 뒤의 늦은 호출은 새 시도의 타이머·로딩 표시·화면을 바꾸지 않는다 | AC-016j |
| 계산 요청의 거절 조건이 겹침 | 구조(400) → 지원 세대·빈 치료(422) → 현재 버전 비교(409, 내려간 치료는 `treatmentsUnpublished[]`) → 현재 카탈로그 기준 치료 ID(422) → 계산(중지된 묶음은 200 `ON_HOLD`) | AC-021h, AC-021i, AC-021j, AC-021k, AC-021l, AC-021m |
| 409·422 뒤 자료 갱신(catalog·options 다시 받기) | `K03_Treatments` 안에서 진행하며 갱신 중 확인 버튼 비활성·강제 계산 거절, 두 응답을 한 단계로 반영, 실패하면 아무것도 쓰지 않고 재시도는 갱신이 먼저, 이전 갱신의 늦은 결과 무시, 초기화·입력 변경 뒤 결과 버림, 겹침창이 열린 동안 도착하면 밑 화면에 반영 | AC-020b, AC-020c, AC-020d, AC-020e, AC-020f, AC-020g, AC-020h, AC-020i, AC-016o |
| 키오스크의 계산 시도 `requestId` | 요청 본문·헤더·URL, 로그, 분석 이벤트, 브라우저 저장소, 서버 저장소·메모리 어디에도 없다. 키오스크 메모리의 `activeRequest`만 허용 | AC-016k, AC-016l, AC-016m, AC-016n |
| `ResetConfirm`·`TimeoutDialog`가 열린 동안 응답·오류·요청 만료가 도착 | 밑 화면에 곧바로 반영하고 닫으면 최신 화면이 보인다. 초기화가 확정된 뒤의 결말은 버려지고, 서버 결말은 무조작 시간을 다시 세지 않는다 | AC-015l, AC-015m, AC-015n, AC-015o, AC-015p |
| 묶음 내용을 캐시한 뒤 항목을 중지·재검토로 바꿈 | 다음 요청부터 반영(200, 기존 보류 코드 또는 `RULES_UNAVAILABLE`, 버전 불변). 같은 항목을 담은 다른 묶음에도 반영된다 | AC-011m, AC-011n, AC-011o, AC-011p |
| 프로필 칸 하나만 `READY` | 병원 준비 완료가 아니다. `calculationReady`는 묶음 상태와 모든 줄의 매핑까지 본다 | AC-011c, AC-011l |
| 서류 규칙만 사용 불가 | `documentReady`만 `NOT_READY`, `calculationReady`는 그대로 | AC-011k, AC-011l |
| 서류 규칙 `when`의 조건 하나만 맞음 | 규칙이 없을 때와 같은 결과 | AC-007j |
| 같은 줄로 가는 서류 규칙의 우선순위 동률 | 사유 문자열의 코드 포인트 순. 규칙 배열 순서와 무관 | AC-007l |
| 같은 버전인데 규칙 묶음이 중지됨 | 409가 아니라 200 `ON_HOLD`(`RULE_BUNDLE_SUSPENDED`), 병원 결제액은 숫자 | AC-008g, AC-011f |
| 묶음 중지, 같은 항목을 담은 다른 묶음 | 다른 묶음은 계속 사용 가능, 항목 상태 불변, 재활성화 거절 | AC-011e |
| 원인 모름에서 전용 줄이 여럿 | 게시되고 9줄이 한 번씩 나옴, 화면은 반응형·이전/다음 목록 | AC-007f, AC-007h, AC-007i |
| 근거·서류 화면에서 큰 글자·방향을 바꾼 뒤 복귀 | 결과 종류는 진입한 것, 방향·큰 글자는 최신 값, 계산 요청 없음 | AC-014e, AC-014h, AC-014i |

## 7. 품질 게이트

| 게이트 | 기준 | 검증 단계 |
|--------|------|-----------|
| 엔진 커버리지 | `src/engine` 85% 이상(줄), 분기 커버리지도 함께 보고 | unit |
| 전체 커버리지 | 85% 이상, 커밋당 80% 이상(`quality.yaml`) | unit + integration |
| 형식·린트 | 타입 오류 0, 린트 오류 0 | 정적 검사 |
| 가져오기 경계 | 엔진 순수성(AC-001b), 운영 구성의 fixture 미포함(AC-010b), AI SDK 없음(AC-021d) | unit |
| 결정성 | AC-001a, AC-006d, AC-006g, AC-007l, AC-008k(배열 순서 독립) | unit + integration |
| 시험 피라미드 | 엔진·상태 기계 단위 시험이 가장 많고, API는 통합 시험, 화면 흐름은 E2E로 핵심 경로만 | — |
| TRUST 5 | Tested·Readable·Unified·Secured(입력 검증, 병원 소유 확인, 권한)·Trackable(Conventional Commits) | sync-auditor |
| 검증 단계 구분 | 보고서는 실행한 것 / 문서로 확인한 것 / 확인하지 않은 것을 나누고, 디자인 파일 확인을 렌더링·앱 실행으로 대신하지 않는다 | 보고서 검토 |

## 8. 완료 정의 (Definition of Done)

1. M1~M7이 닫는 `unit`·`integration`·`e2e-app` 세부 항목(AC-001~AC-025 가운데 plan.md §B가 M1~M7에 배정한 것)이 모두 통과하고, 실행한 명령과 출력이 progress.md §E.2에 남아 있다. 관리자 API가 있는 M7이 `AC-016f`·`AC-021d`·`AC-021f`를, 키오스크 화면이 있는 M6이 `AC-019c`·`AC-021g`를 닫는 것처럼 각 항목은 시험 대상 코드가 이미 있는 마일스톤에서 닫힌다(plan.md §B.1).
2. `render` 세부 항목(AC-007i의 렌더 부분, AC-010e, AC-013a·b·c의 렌더 부분, AC-017a·b·e·g, AC-023b)은 빌드한 화면을 두 방향(임시 검토 크기)으로 그린 근거와 함께 판정되어 있다.
3. AC-017(a~g)은 M6에서 판정되어 있고, `real-device` 세부 항목(AC-016g, AC-017h, AC-017i)은 M8 파일럿에서 기기가 정해진 뒤 판정·기록하며, 그 전에는 "미검증"으로 기록되어 있고 통과로 보고되지 않는다.
4. 운영 준비 상태 보고(DD-23의 네 표와 병원·칸별 `calculationReady`·`documentReady` 짝)가 생성되고, 운영 데이터가 없는 칸과 병원은 `NOT_READY`로 막힌 단계와 함께 보고된다. 한 표의 `READY`만으로 병원이나 운영이 준비되었다고 보고하지 않는다. 실제 운영 개시는 M8 관문을 통과한 병원·칸에 한하며, 어느 병원·칸부터 시작할지와 서류 안내 없이 계산 안내부터 시작할지는 이 SPEC이 정하지 않는 사업 판단이다.
5. plan.md §E의 열린 확인 항목(확인 표시가 붙은 행)이 구현 착수 승인 전에 모두 풀려 있다(plan.md 첫머리의 규칙). 이 SPEC 작성이 끝난 시점에는 확인 항목 36개 가운데 33개가 열려 있고 3개(#9, #25, #28)는 기록·확인된 근거로 닫혀 있다(소유자 승인이 아니다). 열린 33개는 구현 착수 승인 게이트를 막으며 그 게이트에서 소유자에게 제시된다. §E.1의 보류 확정 자료는 M8에서 자료가 들어온 칸만 운영에 쓴다.
