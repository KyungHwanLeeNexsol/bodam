# SPEC-REIMBURSEMENT-ESTIMATOR-001 — 수용기준 (acceptance.md)

> 이 문서는 검증 기준이다. 요구사항 문장은 spec.md에 있고 여기서 다시 쓰지 않는다. 아래 어느 항목도 아직 실행·렌더링·확인되지 않았다. 모든 항목은 구현 단계에서 처음 판정한다.

## 0. 읽는 법

- 각 수용기준(AC-001~AC-025)은 Given / When / Then 시나리오이며, 같은 시나리오 안의 세부 판정은 `AC-001a`처럼 소문자 접미사로 나눈다. 세부 항목 하나는 plan.md §B의 마일스톤 하나에서만 닫힌다.
- 검증 표시: `unit`, `integration`, `e2e-app`, `render`, `real-device`. 이 다섯 가지는 이 SPEC이 정한 분류이며, 기획서 §14의 세 단계(파일 확인 / 렌더링 확인 / 앱 동작 검증)와의 대응은 spec.md §2 표를 따른다. 단계는 서로 대신하지 않고, 디자인 파일 확인은 어떤 AC의 통과 근거도 되지 않는다.
- 숫자 예시는 기획서 §6.4·§9의 값만 쓴다. 계산에 쓰는 프로필·매핑·서류 규칙·치료 줄은 `TEST_FIXTURE` 출처로 만든 시험 자료이며, 운영 데이터와 다른 저장소·다른 모듈에 둔다. 기획서 예시 치료 4종(X-ray 급여 10,000 / 초음파 비급여 70,000 / 신장분사치료 비급여 40,000 / 물리치료 급여 4,000)은 `DEMO` 출처 자료이고, 시험은 그 금액을 옮긴 `TEST_FIXTURE` 사본을 쓴다. 이하 이 사본을 "예시 4종"이라 한다.
- 표에 값이 적히지 않은 시험 자료 값(원 단위 처리, 공유 한도 시험 등)과 속성 기반 시험의 시행 수·시드는 구현 단계에서 정해 시험 코드에 고정하고 `TEST_FIXTURE`로 표시한다. 그 값은 운영 값의 근거가 아니다.

## 1. 계산 엔진

### AC-001 결정성과 순수성
요구사항: REQ-ENG-001
- **Given** 같은 `EstimateInput`(같은 버전·같은 주입 시각)이 주어지고 **When** 엔진을 여러 번, 그리고 새 프로세스에서 다시 실행하면 **Then** 직렬화한 결과가 바이트 단위로 같다. (`AC-001a`, unit)
- **Given** `src/engine`의 가져오기 그래프가 있고 **When** 가져오기 경계 검사를 실행하면 **Then** React·Next·DB 드라이버·`fetch`·`fs`·네트워크 모듈·생성형 AI SDK가 하나도 없고, 주입 없는 `Date.now`·`Math.random` 호출도 없다. 금지 모듈을 일부러 추가한 음성 시험에서는 검사가 실패한다. (`AC-001b`, unit)
- **Given** 엔진 소스가 있고 **When** 숫자 상수를 정적 검사하면 **Then** 허용 상수(0, basis points 척도 10000, `ROUND_HALF_UP`용 5000) 외의 숫자 상수가 없으며, 시험 자료 프로필의 값을 바꾸면 결과가 그에 맞게 바뀐다. (`AC-001c`, unit)

### AC-002 기획서 계산 예시 재현
요구사항: REQ-ENG-002, REQ-ENG-003
- **Given** 아래 시험 자료 프로필과 예시 4종이 모두 보장 대상으로 매핑되어 있고 **When** 계산하면 **Then** 다음과 같다. 예상 병원 결제액은 모든 행에서 124,000원이다. (`AC-002a`~`AC-002e`, unit)

| 세부 | 시험 자료 프로필 | 예상 보험금 | 보험금 수령 후 예상 본인 부담 | 추가 확인 |
|------|------------------|------------:|-------------------------------:|-----------|
| AC-002a (사례 A) | 한 그룹, `FIXED` 10,000, `PER_VISIT_PAYOUT` 250,000(PAYOUT) | 114,000 | 10,000 | 전체 `ESTIMATED`, `ALL_COVERED_AND_LIMIT_REMAINS` 가정 있음 |
| AC-002b (사례 B) | 한 그룹, `RATE_WITH_FIXED_FLOOR` 10,000 / 2,000bp, `UNLIMITED_DECLARED`(시험용 조항 참조) | 99,200 | 24,800 | D = 24,800 |
| AC-002c (사례 C) | 한 그룹, `SPLIT_RATE_WITH_FIXED_FLOOR` 10,000 / 급여 1,000bp / 비급여 2,000bp, `UNLIMITED_DECLARED` | 100,600 | 23,400 | D = 23,400 |
| AC-002d (사례 D) | 급여 그룹 `CAPPED_RATE_WITH_FIXED_FLOOR` 10,000 / 2,000bp, 일반 비급여 그룹 `CAPPED_RATE_WITH_FIXED_FLOOR` 30,000 / 3,000bp, 두 그룹 모두 `UNLIMITED_DECLARED` | 81,000 (4,000 + 77,000) | 43,000 | 급여 D = 10,000(14,000 아님), 비급여 D = 33,000, 두 공제가 합쳐지지 않음 |
| AC-002e (사례 E) | 한 그룹 `FIXED` 10,000, `UNLIMITED_DECLARED`; 신장분사치료 매핑은 `EXCLUDED`(사유 포함) | 74,000 | 50,000 | 그룹 E = 84,000(제외 40,000 미포함), 전체 `ESTIMATED_WITH_EXCLUSIONS`, 제외 줄 0원과 사유, `ALL_COVERED_AND_LIMIT_REMAINS` 없음 |

- **Given** E = 124,000, `FIXED` 10,000, `PER_VISIT_PAYOUT` 250,000 **When** 계산하면 **Then** P = 114,000이다. (`AC-002f` 고정 공제, unit)
- **Given** 400,000원짜리 `TEST_FIXTURE` 치료 하나와 `FIXED` 10,000, `PER_VISIT_PAYOUT` 250,000 **When** 계산하면 **Then** P = min(390,000, 250,000) = 250,000, 수령 후 부담 150,000이며 240,000이 아니다. (`AC-002g` 한도 순서, unit)
- **Given** 물리치료(4,000)만 고르고 `FIXED` 10,000 **When** 계산하면 **Then** P = 0, 명목 D = 10,000, 실제 적용 D = 4,000, 수령 후 부담 4,000, 전체 상태 `ESTIMATED`이며 0원과 계산 근거가 함께 나온다. (`AC-002h` 작은 비용, unit)
- **Given** X-ray와 물리치료를 같은 그룹 `FIXED` 10,000으로 고르고 **When** 계산하면 **Then** E = 14,000에서 한 번만 공제해 P = 4,000이다(치료마다 공제했다면 0). (`AC-002i` 공제 1회, unit)

### AC-003 규칙 모양의 경계
요구사항: REQ-ENG-002, REQ-DATA-002
- **Given** 비율 공제 규칙에 `rounding`이 없고 **When** 계산하면 **Then** 그 그룹의 줄이 `PROFILE_VALUE_MISSING`으로 보류되고 전체가 `ON_HOLD`다. 기본 처리 방식으로 계산하지 않는다. (`AC-003a`, unit)
- **Given** 원 미만 단수가 생기는 `TEST_FIXTURE` 입력 **When** `TRUNCATE`와 `ROUND_HALF_UP` 규칙으로 각각 계산하면 **Then** 각각 버림과 5000을 더한 뒤 버림으로 처리되고, `SPLIT_RATE_WITH_FIXED_FLOOR`는 두 곱의 합에 한 번만 적용된다. (`AC-003b`, unit)
- **Given** 닫힌 목록 밖의 공제 방식, 또는 `limitBasis = COVERED_COST` **When** 계산하면 **Then** 해당 그룹 줄이 `PROFILE_FORMULA_UNSUPPORTED`로 보류된다. (`AC-003c`, unit)
- **Given** `PER_ACCIDENT`, `ANNUAL`, `COUNT` 한도 **When** 계산하면 **Then** 한도가 적용되고 `assumptions`에 `REMAINING_LIMIT_ASSUMED`가 있다. (`AC-003d`, unit)
- **Given** `UNLIMITED_DECLARED`에 조항 참조가 없고 **When** 계산하면 **Then** 그 그룹의 줄이 `PROFILE_SOURCE_INCOMPLETE`로 보류된다. (`AC-003e`, unit)
- **Given** 같은 공유 한도 풀에 든 두 그룹의 지급 합이 풀 한도를 넘는 `TEST_FIXTURE` **When** 계산하면 **Then** 두 그룹 지급 합계 = 풀 한도(한 번만 적용)이고, 줄어든 금액은 `groupOrder` 순서로 배분되며, 어느 경우에도 풀 한도를 넘거나 두 번 지급되지 않는다. (`AC-003f`, unit)

### AC-004 결과 상태와 0원의 의미
요구사항: REQ-ENG-003, REQ-ENG-004
- **Given** 정상 계산 결과가 0원인 입력(AC-002h) **When** 결과를 만들면 **Then** 예상 보험금 0, 계산 근거에 공제 단계가 있다. (`AC-004a`, unit)
- **Given** 모든 줄이 확인된 제외 **When** 계산하면 **Then** 전체 `ESTIMATED_WITH_EXCLUSIONS`, 예상 보험금 0, 수령 후 부담 = 예상 병원 결제액, 각 줄 0원과 사유가 있다. (`AC-004b`, unit)
- **Given** 보류 줄이 있는 입력 **When** 계산하면 **Then** 예상 보험금과 수령 후 부담이 모두 null이고 예상 병원 결제액은 124,000(예시 4종)이며 어디에도 0이 들어가지 않는다. (`AC-004c`, unit)
- **Given** 사례 D 시험 자료에서 신장분사치료 매핑만 없음 **When** 계산하면 **Then** 신장분사치료 줄은 `MAPPING_ABSENT`로 `ON_HOLD`이고 어느 그룹에도 없으며(`groupKey` 없음), 급여 그룹(X-ray·물리치료, E = 14,000)은 P = 4,000, 일반 비급여 그룹(초음파만, E = 70,000, D = 30,000)은 P = 40,000으로 둘 다 `referenceGroups`에 `isReference: true`로 들어간다. 같은 자료에서 두 그룹을 한 공유 풀로 묶고 다른 그룹 하나를 그룹 단위 보류(`PROFILE_FORMULA_UNSUPPORTED`)로 같은 풀에 넣으면 그 풀의 그룹은 `referenceGroups`에 없다. (`AC-004d`, unit)
- **Given** 상태별 입력 **When** `assumptions`를 확인하면 **Then** 모든 줄 `ESTIMATED`일 때만 `ALL_COVERED_AND_LIMIT_REMAINS`, 제외가 섞이면 `REMAINING_COVERED_AND_LIMIT_REMAINS`, `ON_HOLD`를 포함한 모든 결과에 `PERSONAL_CONTRACT_NOT_CONFIRMED`가 있고, `ON_HOLD`에는 `STANDARD_PROFILE_APPLIED`가 없다. (`AC-004e`, unit)
- **Given** 세 경우 **When** 계산하면 **Then** (1) 공통 기본비용이 없으면 `baseFeeIncluded = NOT_REGISTERED`이고 병원 결제액에 기본비용이 없다; (2) `TEST_FIXTURE` 기본비용이 등록되어 사용 가능한 매핑이 있으면 `INCLUDED`이고 병원 결제액에 그 금액이 더해지며 그 줄도 계산된다; (3) 등록되었으나 매핑이 없으면 `INCLUDED`이고 병원 결제액에 그 금액이 더해지며 그 줄은 `MAPPING_ABSENT`로 보류되어 전체가 `ON_HOLD`다. (`AC-004f`, unit)
- **Given** 계산된 결과 **When** `basis`를 확인하면 **Then** 사용 버전, 프로필 id·버전·출처, 약관 출처 참조, 그룹별 E·명목 D·실제 D·L·P 단계가 있다. (`AC-004g`, unit)

### AC-005 불변 조건 (속성 기반)
요구사항: REQ-ENG-002, REQ-ENG-003
- **Given** 고정 시드로 무작위 생성한 `TEST_FIXTURE` 입력(치료 수·금액·그룹·공제 방식·한도·제외·보류 조합, 시행 수와 시드는 시험 코드에 고정해 출력에 기록) **When** 계산하면 **Then** 모든 시행에서: 0 ≤ 예상 보험금 ≤ 예상 병원 결제액; 보류가 없으면 예상 보험금 + 수령 후 부담 = 예상 병원 결제액; 두 값은 함께 null이거나 함께 정수; 그룹마다 0 ≤ P ≤ E; 공유 풀 지급 합 ≤ 풀 한도; 음수 금액 없음; 보류 줄의 금액이 어느 그룹 E에도 없음. (`AC-005a`, unit)

### AC-006 입력 범위와 치료 원인 분리
요구사항: REQ-ENG-004, REQ-API-004
- **Given** 세대 값이 열거 밖(예: 5세대) **When** 엔진에 넣으면 **Then** `UNSUPPORTED_GENERATION`으로 거절되고 4세대 프로필 조회가 일어나지 않는다. (`AC-006a`, unit)
- **Given** 치료 0개 **When** 엔진에 넣으면 **Then** `NO_TREATMENT_SELECTED`로 거절되며 0원 결과가 없다. (`AC-006b`, unit)
- **Given** 같은 치료 ID가 중복된 입력 **When** 계산하면 **Then** 한 번만 계산되어 예시 4종의 병원 결제액이 124,000이다. (`AC-006c`, unit)
- **Given** 원인만 `INJURY` / `ILLNESS` / `UNKNOWN`으로 다른 세 입력 **When** 엔진과 서류 산출을 따로 실행하면 **Then** 엔진 결과가 바이트 단위로 같고, `estimate()` 형식에 원인 인자가 없다(형식 수준 시험). (`AC-006d`, unit)
- **Given** 계산 가능한 입력에 원인 `UNKNOWN` **When** 계산하면 **Then** 전체 상태가 `ON_HOLD`가 아니고 `holdReasons`가 비어 있다. (`AC-006e`, unit)
- **Given** 5세대 세대 값 또는 치료 0개 **When** `POST /api/clinics/{slug}/estimate`를 부르면 **Then** 각각 422 `UNSUPPORTED_GENERATION`, 422 `NO_TREATMENT_SELECTED`다. (`AC-006f`, integration)
- **Given** 원인만 다른 세 API 요청 **When** 응답을 비교하면 **Then** `result` 블록이 바이트 단위로 같다. (`AC-006g`, integration)

### AC-007 필요 서류 산출
요구사항: REQ-ENG-005, REQ-DATA-005, REQ-FLOW-003
- **Given** 기획서 §4 조건부 매핑 예시를 옮긴 `TEST_FIXTURE` 서류 규칙 묶음("검증 필요" 표시) **When** 서류를 산출하면 **Then** 어떤 입력에서도 9줄이 나오고 `RECEIPT_AND_ITEMIZED` 줄은 항상 필요로 표시된다. (`AC-007a`, unit)
- **Given** 원인 `INJURY`(또는 `ILLNESS`) **When** 산출하면 **Then** 초진기록지(또는 진단서)가 사유와 함께 필요로 표시되고, 한 줄을 여러 규칙이 요구하면 우선순위가 가장 높은 규칙의 사유 하나만 나온다. (`AC-007b`, unit)
- **Given** 원인 `UNKNOWN`, 영상·조직검사·소견 표시가 없는 치료 **When** 산출하면 **Then** `COMMON` 7줄, 초진기록지 `INJURY_ONLY`, 진단서 `ILLNESS_ONLY`이며 원인 하나로 정해지지 않는다. (`AC-007c`, unit)
- **Given** 사용 가능한 서류 규칙 묶음이 없음(규칙 허용 출처가 `OPERATING`뿐인데 `TEST_FIXTURE`만 있는 경우 포함) **When** 결과가 `ON_HOLD`가 아니면 **Then** `documents.state = RULES_UNAVAILABLE`이다. (`AC-007d`, unit)
- **Given** 전체 결과 `ON_HOLD` **When** 서류를 산출하면 **Then** null이다. (`AC-007e`, unit)
- **Given** 상해 전용 줄이나 질병 전용 줄이 2줄 이상 나오는 서류 규칙 묶음 **When** 게시를 시도하면 **Then** 게시가 거절되고 경고가 남는다. (`AC-007f`, integration)
- **Given** `RULES_UNAVAILABLE`인 결과와 `ON_HOLD` 결과 **When** 화면을 조작하면 **Then** 전자는 서류 화면에 서류 목록 대신 안내 문구가 보이고 "결과로 돌아가기"·"이용 완료"와 공통 "처음으로"가 그대로 있으며(기획서 §4 서류 화면 구성), 결과 화면의 여섯 동작도 그대로다. 후자는 서류 화면으로 가는 버튼이 없다. (`AC-007g`, e2e-app)

## 2. 규칙 데이터

### AC-008 보류 행렬
요구사항: REQ-DATA-001, REQ-DATA-002
- **Given** 예시 4종이 모두 사용 가능하게 매핑되어 있고 프로필만 아래 상태로 바꾼 매개변수 시험 **When** 계산하면 **Then** 모든 줄이 해당 코드로 `ON_HOLD`, 예상 보험금·수령 후 부담 null이다. (`AC-008a`, unit)

| 프로필 상태 | 기대 코드 |
|-------------|-----------|
| 기록 없음 | `PROFILE_ABSENT` |
| 출처 `DEMO`, 규칙 허용 출처가 `OPERATING`뿐일 때의 `TEST_FIXTURE` | `PROFILE_DEMO` |
| `DRAFT` | `PROFILE_DRAFT` |
| `REVIEW_REQUESTED`, `REJECTED`, `APPROVED`(미게시) | `PROFILE_UNAPPROVED` |
| `UNDER_REREVIEW` | `PROFILE_UNDER_REREVIEW` |
| `SUPERSEDED`, `EXPIRED`, `SUSPENDED`, 유효 기간 밖, 내용 해시 불일치 | `PROFILE_INVALID` |
| 약관 출처 6항목 중 하나 누락, 승인자 누락 | `PROFILE_SOURCE_INCOMPLETE` |

- **Given** 프로필은 사용 가능하고 신장분사치료 매핑만 아래 상태로 바꾼 매개변수 시험 **When** 계산하면 **Then** 그 줄만 해당 코드로 `ON_HOLD`, 나머지 줄은 `ESTIMATED`, 전체 `ON_HOLD`다. (`AC-008b`, unit)

| 매핑 상태 | 기대 코드 |
|-----------|-----------|
| 기록 없음 | `MAPPING_ABSENT` |
| `DRAFT`, `REVIEW_REQUESTED`, `APPROVED`(미게시) | `MAPPING_UNREVIEWED` |
| `REJECTED` | `MAPPING_REJECTED` |
| `UNDER_REREVIEW` | `MAPPING_UNDER_REREVIEW` |
| `SUPERSEDED`, `EXPIRED`, `SUSPENDED`, 유효 기간 밖, 약관 출처 누락, 승인자 누락, 허용 출처 밖(`DEMO`, 운영 허용 출처의 `TEST_FIXTURE`), 사용 가능한 매핑 2개 이상 | `MAPPING_INVALID` |
| 매핑 그룹이 프로필에 없음 | `MAPPING_GROUP_NOT_IN_PROFILE` |

- **Given** 신장분사치료 치료 버전의 `calcClass = NEEDS_REVIEW` **When** 계산하면 **Then** 그 줄이 `CLASSIFICATION_NEEDS_REVIEW`로 보류된다. (`AC-008c`, unit)
- **Given** (2세대(C1), 손해보험사) 칸은 프로필이 없고 (2.5세대(C2), 손해보험사)와 (2세대(C1), 생명보험사) 칸에는 사용 가능한 프로필이 있음 **When** (2세대(C1), 손해보험사)로 계산하면 **Then** `PROFILE_ABSENT`, 값 null이며 다른 칸의 값·평균·0원·전액 보장이 쓰이지 않는다. (`AC-008d`, unit)
- **Given** 한 줄에 둘 이상의 사유가 함께 해당하는 조합(프로필 사유와 매핑 사유, 줄 출처와 매핑 사유, 매핑 사유와 그룹 단위 `PROFILE_SOURCE_INCOMPLETE` 등) **When** 계산하면 **Then** design.md DD-03의 판정 순서대로 첫 번째 코드 하나만 기록되며 결과가 실행마다 같다. (`AC-008e`, unit)
- **Given** 규칙 묶음이 없는 입력(`bundle = null`, 병원에 규칙 사용 범위가 없음) **When** 계산하면 **Then** 모든 줄이 `CLINIC_RULE_SCOPE_ABSENT`로 보류된다. (`AC-008f`, unit)

### AC-009 지문 방어와 재검토 기준
요구사항: REQ-DATA-002, REQ-DATA-004, REQ-ADM-003
- **Given** `APPROVED` 또는 `PUBLISHED` 매핑과 치료 **When** 도메인 서비스로 `treatmentCode`, `procedureCode(s)`, `benefitType`, `calcClass`를 각각 바꾼 치료 버전을 게시하면 **Then** 네 경우 모두 매핑이 `UNDER_REREVIEW`가 된다. (`AC-009a`, integration)
- **Given** 상태 전환 없이 보장 판단 필드만 바뀐 치료 버전(상태 전환 누락을 흉내 냄) **When** 계산하면 **Then** 지문 불일치로 `MAPPING_UNDER_REREVIEW` 보류다. (`AC-009b`, unit)
- **Given** 가격만 바꾼 게시 **When** 게시하고 계산하면 **Then** 새 `CatalogVersion`과 변경 이력이 생기고, 매핑은 `PUBLISHED`로 남으며 그 줄은 새 가격으로 `ESTIMATED`다. (`AC-009c`, integration)

### AC-010 시험 자료와 운영 데이터의 분리
요구사항: REQ-DATA-003
- **Given** 운영 허용 출처(규칙 `OPERATING`, 줄 `OPERATING`) **When** `TEST_FIXTURE` 프로필, `TEST_FIXTURE` 매핑, `DEMO` 치료 줄, `TEST_FIXTURE` 공통 기본비용 줄을 각각 넣어 계산하면 **Then** 각각 `PROFILE_DEMO`(모든 줄), `MAPPING_INVALID`(그 줄), `LINE_ORIGIN_NOT_ACCEPTED`(그 줄), `LINE_ORIGIN_NOT_ACCEPTED`(그 줄)로 보류된다. 시험 허용 출처에서는 같은 자료가 사용 가능하다. (`AC-010a`, unit)
- **Given** 운영 구성 진입점 **When** 가져오기 경계 검사를 돌리면 **Then** fixture 모듈로 가는 경로가 없고, 일부러 추가한 음성 시험에서는 검사가 실패한다. (`AC-010b`, unit)
- **Given** 운영 구성 **When** `DEMO`·`TEST_FIXTURE` 출처 치료 버전이나 공통 기본비용을 게시하려 하면 **Then** 거절된다. 저장소 시드·이관 스크립트에 `DEMO`·`TEST_FIXTURE` 기록을 `APPROVED`·`PUBLISHED`로 쓰는 경로가 없다. (`AC-010c`, integration)
- **Given** 시험 구성에서 (1) 프로필만, (2) 매핑만, (3) 서류 규칙 묶음만, (4) 치료 줄만 `OPERATING`이 아닌 네 경우 **When** 계산 API를 부르면 **Then** 네 경우 모두 응답 `origin`이 `OPERATING`이 아니다. 모두 `OPERATING`이면 `origin = OPERATING`이다. (`AC-010d`, integration)
- **Given** `origin`이 `OPERATING`이 아닌 응답 **When** 결과 화면을 그리면 **Then** 화면 상단에 테스트 데이터 표시가 보이고, `OPERATING` 응답에서는 보이지 않는다. (`AC-010e`, render)

### AC-011 버전 불변성과 운영 준비 상태
요구사항: REQ-DATA-004, REQ-DATA-001
- **Given** 게시된 `CatalogVersion`·`RuleBundleVersion` **When** 수정·삭제를 시도하면 **Then** 거절되고, 수정은 새 버전으로만 생긴다. 같은 묶음의 내용 해시는 다시 계산해도 같다. (`AC-011a`, integration)
- **Given** 이전 버전 **When** 복구하면 **Then** 새 id의 사본이 게시되고 기존 이력이 그대로 남는다. (`AC-011b`, integration)
- **Given** 운영 데이터가 없는 저장소 **When** 준비 상태표를 산출하면 **Then** 15칸 모두 `NOT_READY`다. 시험 전용 저장소에 상태만 다른 기록을 넣어 보면, 승인·게시·`OPERATING`·출처 완비를 모두 갖춘 칸만 `READY`가 된다. (`AC-011c`, unit)
- **Given** 보험사 데이터 **When** 저장하면 **Then** NH농협손해보험, NH농협생명, 과거 농협공제가 서로 다른 기관 기록이다. (`AC-011d`, integration)

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
- **Given** 계산 요청에 대해 (1) 5xx, 시간 초과, 연결 실패 (2) 400 `INVALID_REQUEST`, 404 `CLINIC_NOT_FOUND`, 422 `UNSUPPORTED_GENERATION` (3) 422 `NO_TREATMENT_SELECTED` (4) 422 `TREATMENT_NOT_PUBLISHED` 응답을 흉내 내면 **Then** (1)·(2)는 통신 오류 화면에 "다시 시도"와 "이용 종료", "계속 안 되면 접수 직원에게 문의해 주세요" 문장이 있고 금액 0원이 없으며 "다시 시도"가 새 요청을 보낸다; (3)은 `K03_Treatments`로 돌아가 확인 버튼이 비활성이다; (4)는 catalog·options를 다시 받아 내려간 치료를 안내와 함께 뺀 뒤 `K03_Treatments`다. (`AC-013d`, e2e-app)
- **Given** 정상 결과, 보장 제외 결과, 가로형 결과, 큰 글자 보기 **When** 동작 버튼을 세면 **Then** 각각 "보험 청구에 필요한 서류 확인", "계산 근거 보기", "치료 다시 선택", "보험 조건 수정", "처음으로", "이용 완료" 여섯 개가 모두 있다. (`AC-013e`, e2e-app)
- **Given** 모든 결과·근거 화면 **When** 문구를 검사하면 **Then** "환자분의 실손은" 같은 확인 사실 표현과 "오늘 … 만 내면 됩니다" 같은 표현이 없다. (`AC-013f`, e2e-app)

### AC-014 입력 변경 무효화, 계산 근거, 복귀
요구사항: REQ-FLOW-003, REQ-ENG-004, REQ-ENG-005
- **Given** 결과가 나온 세션 **When** "보험 조건 수정"으로 가서 세대를 다른 값으로 바꾸면 **Then** 결과·서류·근거·복귀 정보가 지워지고 `inputRevision`이 1 오르며, "예상 부담액 확인"을 다시 누르기 전에는 결과 화면에 갈 수 없다. (`AC-014a`, unit)
- **Given** 결과가 나온 세션 **When** 치료를 하나 더 고르거나 빼면 **Then** AC-014a와 같이 파생 데이터가 지워진다. (`AC-014b`, unit)
- **Given** 결과가 나온 세션 **When** 원인을 상해에서 질병으로 바꾸고 다시 확인하면 **Then** 금액 블록은 바이트 단위로 같고 서류 목록은 새로 산출되어 필요 줄이 바뀐다. (`AC-014c`, unit + e2e-app)
- **Given** 결과가 나온 세션 **When** 같은 값을 다시 고르거나, 목록 페이지를 넘기거나, 큰 글자를 켜고 끄면 **Then** 결과가 그대로 남는다. (`AC-014d`, unit)
- **Given** 정상 결과(세로), 보장 제외 결과, 가로형 결과, 큰 글자 보기를 켠 결과 **When** 각각에서 계산 근거와 서류 화면에 들어갔다가 "결과로 돌아가기"를 누르면 **Then** 들어오기 전과 같은 결과 종류·방향·큰 글자 상태·선택·금액으로 돌아온다. 정상 결과로 고정되지 않는다. (`AC-014e`, unit + e2e-app)
- **Given** 정상 결과와 보장 제외 결과 **When** 계산 근거를 열면 **Then** 입력 확인값, "(가정)"을 붙인 프로필 값, 약관 출처, 계산 단계가 보이고, 보장 제외 결과에서 들어온 경우 제외 항목과 사유가 함께 보인다. (`AC-014f`, e2e-app)
- **Given** 계산이 끝난 결과 세 종류(세로 정상·보장 제외, 가로 정상) **When** 서류 확인을 누르면 **Then** 원인 상해·질병은 `K07_Documents`, 모름은 `K07_Documents_Unknown`으로 가며 들어온 결과 종류와 무관하다. (`AC-014g`, unit + e2e-app)

### AC-015 무조작 시간과 이용 완료 동선
요구사항: REQ-FLOW-004, REQ-ADM-005
- **Given** 가짜 시계 **When** 입력 단계에서 조작이 없으면 **Then** 100초에 TimeoutDialog, 120초에 초기화되어 `K00_Start`로 간다. (`AC-015a`, unit)
- **Given** 가짜 시계 **When** 정상·보장 제외 결과, 계산 근거, 서류(세로·가로·원인 모름; 기획서의 2026-10-14 임시 결정 값), 보류 결과(잠정 값)에서 조작이 없으면 **Then** 160초 경고, 180초 초기화 후 `K00_Start`이며 결과 화면으로 돌아가지 않고 `K06_Complete`를 거치지 않는다. (`AC-015b`, unit)
- **Given** 가짜 시계 **When** 세대 확인 안내, 계산 중, 통신 오류에서 조작이 없으면 **Then** 100초 경고, 120초 초기화다(잠정 값). (`AC-015c`, unit)
- **Given** 경고 전 **When** 환자가 터치하거나 결과·근거·서류 사이를 오가면 **Then** 무조작 시간이 0초부터 다시 시작하고, 서버 응답이 도착하는 것만으로는 다시 시작하지 않는다. (`AC-015d`, unit)
- **Given** TimeoutDialog **When** "계속 사용할게요"를 여러 번 누르면 **Then** 누를 때마다 시간이 다시 시작하고, "처음으로"를 누르면 초기화되어 `K00_Start`로 간다. (`AC-015e`, unit + e2e-app)
- **Given** 결과·근거·서류 화면 **When** "이용 완료"를 누르면 **Then** `K06_Complete`가 그려지기 전에 세션 저장소가 비어 있고, `K06_Complete`에 이전 선택·금액이 없으며, `completionHoldSeconds` 뒤 또는 "처음 화면으로"로 `K00_Start`에 간다. 통신 오류 화면의 "이용 종료"도 같은 순서다(잠정). (`AC-015f`, unit + e2e-app)
- **Given** 환자 입력이 하나 이상 있는 세션 **When** "처음으로"를 누르면 **Then** ResetConfirm이 뜨고, 확인하면 지운 뒤 `K06_Complete` 없이 `K00_Start`로, 취소하면 그대로 남는다. (`AC-015g`, unit + e2e-app)
- **Given** `K00_Start`, `K06_Complete` **When** 오래 두면 **Then** 무조작 타이머가 동작하지 않는다. (`AC-015h`, unit)
- **Given** 병원별 무조작 정책을 바꾼 설정 **When** 키오스크가 읽으면 **Then** 바뀐 값으로 동작한다. (`AC-015i`, integration)
- **Given** 환자 입력이 하나도 없는 화면 1 **When** "처음으로"를 누르면 **Then** ResetConfirm 없이 바로 `K00_Start`로 간다. (`AC-015j`, unit + e2e-app)

### AC-016 세션 보호, 늦은 응답, 복원 금지
요구사항: REQ-FLOW-005
- **Given** 저장소 감시를 건 브라우저 **When** 시작부터 이용 완료까지 진행하면 **Then** localStorage·sessionStorage·IndexedDB·Cache Storage에 쓰기가 없고 서비스워커 등록이 없다. 키오스크 코드의 금지 API 정적 검사도 통과한다. (`AC-016a`, e2e-app + unit)
- **Given** 같은 흐름 **When** URL과 분석 이벤트를 기록하면 **Then** URL에 세대·형태·원인·치료가 없고, 분석 이벤트는 단계 수준 익명 필드만 담는다. (`AC-016b`, e2e-app)
- **Given** 지연된 계산 응답 **When** 응답 전에 초기화하고 다음 환자가 시작한 뒤 응답이 도착하면 **Then** 요청이 취소되었거나, 도착하더라도 (`sessionId`, `inputRevision`) 불일치로 버려져 새 세션 화면이 바뀌지 않는다. (`AC-016c`, unit + e2e-app)
- **Given** 결과를 본 뒤 **When** 뒤로·앞으로 이동, 새로고침, 페이지 캐시 복원(`pageshow` persisted)을 하면 **Then** `K00_Start` 빈 세션이며 이전 결과가 보이지 않는다. (`AC-016d`, e2e-app)
- **Given** 계산 요청 처리 **When** 서버 저장소와 로그를 검사하면 **Then** 환자 선택·결과가 저장되지 않고 로그에 세대·형태·원인·치료 ID가 없다. (`AC-016e`, integration)
- **Given** 키오스크 화면 **When** 관리자 경로 링크·쿠키·토큰을 찾고 빠른 연속 터치를 시도하면 **Then** `/admin` 링크가 없고, 관리자 인증 정보가 없으며, 숨은 터치로 관리자 기능이 열리지 않는다. (`AC-016f`, e2e-app)
- **Given** 실제 설치 기기의 브라우저 **When** 뒤로 가기·페이지 캐시·재실행을 시험하면 **Then** 이전 환자 결과가 복원되지 않는다. (`AC-016g`, real-device)

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
- **Given** 게시 카탈로그 **When** `GET /api/clinics/{slug}/catalog`를 부르면 **Then** 표시 필드만 있고 검토 상태·지문·검토자 같은 키가 없다. 없는 slug는 404 `CLINIC_NOT_FOUND`다. (`AC-018a`, integration)
- **Given** 승인된 프로필이 하나도 없는 병원 A와, 서로 다른 규칙 묶음을 쓰는 병원 B **When** 각 병원의 `GET /api/clinics/{slug}/insurance/options`를 부르면 **Then** 두 응답 모두 세대 5장, 형태 3장, 원인 3장, 안내 문구(1544-8069는 문자열)가 있고 "1588"은 없으며, `ruleBundleVersion`은 각 병원의 규칙 사용 범위 값(범위가 없으면 null)이다. 없는 slug는 404다. (`AC-018b`, integration)

### AC-019 서버 재계산과 병원 소유 확인
요구사항: REQ-API-002
- **Given** 요청 본문에 가격·비율·병원 ID를 바꾼 필드를 덧붙임 **When** 계산을 요청하면 **Then** 결과가 서버 게시 데이터로 계산한 값과 같고, 그 필드를 읽는 코드 경로가 없다(필드 접근 감시). (`AC-019a`, integration)
- **Given** `POST /api/clinics/{병원 A slug}/estimate`에 병원 B의 치료 ID, 또는 병원 A의 비활성·미게시 치료 ID **When** 요청하면 **Then** 422 `TREATMENT_NOT_PUBLISHED`다. (`AC-019b`, integration)
- **Given** 같은 데이터 **When** 키오스크 미리보기 합계와 서버 계산을 비교하면 **Then** 두 경로가 같은 엔진 모듈을 가져오고(모듈 동일성 시험) 병원 결제액이 같다. (`AC-019c`, unit + integration)

### AC-020 버전 불일치
요구사항: REQ-API-003
- **Given** 병원 A의 옛 `catalogVersion` 또는 옛 `ruleBundleVersion` **When** `POST /api/clinics/{병원 A slug}/estimate`를 요청하면 **Then** 409이고 본문이 DD-14 형식(`error: VERSION_MISMATCH`, 병원 A 기준 `latest` 두 버전, `changes.priceChanged`, `changes.ruleChanged`, `changes.treatmentsUnpublished[]`)이며 결과가 없다. (`AC-020a`, integration)
- **Given** 409를 받은 키오스크 **When** 처리하면 **Then** 그 병원의 catalog·options를 다시 받고, 게시 중인 선택은 유지하고, 내려간 치료는 안내와 함께 빼고, 새 합계를 보인 뒤 4단계에서 환자가 다시 확인해야 결과가 나온다. 옛 값으로 결과 화면이 열리지 않는다. (`AC-020b`, unit + e2e-app)

### AC-021 오류 분류와 실행 중 제약
요구사항: REQ-API-004, REQ-ENG-001, REQ-FLOW-005
- **Given** design.md DD-19 오류 표의 각 조건(관리자 경로의 401·403 포함) **When** 요청하면 **Then** 표의 HTTP 상태와 코드가 정확히 나온다. (`AC-021a`, integration)
- **Given** 보류가 되는 입력 **When** 요청하면 **Then** HTTP 200이고 `result.state = ON_HOLD`다. (`AC-021b`, integration)
- **Given** 성공 응답 **When** 확인하면 **Then** `versions`(카탈로그·규칙 묶음·프로필 id·버전)와 `origin`이 있다. (`AC-021c`, integration)
- **Given** 의존성 목록과 서버·키오스크의 가져오기 그래프 **When** 검사하면 **Then** 생성형 AI·모델 SDK가 없고, 계산 경로에서 저장소 외 바깥 네트워크 호출이 없다(네트워크 감시). (`AC-021d`, unit + integration)
- **Given** 키오스크 문서와 계산 응답 **When** 헤더를 확인하면 **Then** `Cache-Control: no-store`다. (`AC-021e`, integration)

## 5. 관리자

### AC-022 역할과 병원 격리
요구사항: REQ-ADM-001
- **Given** design.md DD-17 권한 표(검토 요청 기록 생성은 HA, 매핑 작성·승인·반려는 RV, 플랫폼 운영자는 관리자 소속·역할 관리와 규칙 사용 범위 지정 두 권한과 그에 필요한 조회만 가짐) **When** 역할 × 자원 × 동작의 모든 칸을 매개변수 시험하면 **Then** 표의 O 칸과 범위가 적힌 칸("자기 병원" 등)은 그 범위 안의 요청이 성공하고 범위 밖의 요청은 403이며, "—" 칸은 403, 인증 없는 요청은 401이고, 플랫폼 운영자의 병원 설정·무조작 정책·치료·가격 수정 시도는 403이다. (`AC-022a`, integration)
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
- **Given** 게시·승인·반려·중지·복구 **When** 각각 실행하면 **Then** 감사 기록에 수행자·역할·일시·사유·이전/이후 버전이 남는다. (`AC-025a`, integration)
- **Given** 작성자와 승인자가 같은 승인과 다른 승인 **When** 기록하면 **Then** 각각 `selfApproval: true`, `false`다. (`AC-025b`, integration)
- **Given** 같은 데이터 **When** 관리자 미리보기(세로·가로)와 서버 계산을 비교하면 **Then** 결과가 같다(같은 엔진). (`AC-025c`, integration)
- **Given** 플랫폼 운영자 **When** 병원 A의 규칙 사용 범위를 묶음 X로 지정하면 **Then** 병원 A의 options·계산이 묶음 X를 쓰고, 지정 전에는 병원 A의 계산이 `CLINIC_RULE_SCOPE_ABSENT`로 보류되며, 다른 역할의 지정 시도는 403이다. (`AC-025d`, integration)
- **Given** 프로필 승인 **When** 계산 예제-약관 대조 기록을 첨부하면 **Then** 승인 기록과 함께 저장되고 조회된다. (`AC-025e`, integration)

## 6. 경계 사례 모음

| 사례 | 기대 | 관련 AC |
|------|------|---------|
| 치료 0개로 확인 버튼 | 버튼 비활성, API 직접 호출 시 422, 0원 없음 | AC-006b, AC-006f, AC-012b |
| 공제가 비용보다 큼 | P = 0, 음수 없음, 명목·실제 공제 분리 | AC-002h |
| 한도에서 공제를 빼는 잘못된 계산 | 240,000이 아니라 250,000 | AC-002g |
| 모든 항목 제외 | 예상 보험금 0, 부담 = 병원 결제액, 상태 `ESTIMATED_WITH_EXCLUSIONS` | AC-004b |
| 매핑 없는 줄 | 어느 그룹에도 없음, 참고 그룹은 나머지 줄로만 | AC-004d |
| 매핑 2개가 동시에 사용 가능 | `MAPPING_INVALID` | AC-008b |
| 병원에 규칙 사용 범위 없음 | 모든 줄 `CLINIC_RULE_SCOPE_ABSENT` | AC-008f, AC-025d |
| 원인 모름 | 금액 동일, 서류만 분기 | AC-006d, AC-007c |
| 세대 모름 | 계산 요청 없음, 결과 상태 아님 | AC-012d |
| 가입일로 세대 추정 | 날짜 입력 없음, 세대를 정하거나 제안하지 않음 | AC-012i |
| 계산 중 초기화 | 요청 취소, 늦은 응답 버림 | AC-016c |
| 계산 중 가격 변경 | 409, 옛 값 확정 금지 | AC-020 |
| 서류 규칙 없음 | `RULES_UNAVAILABLE`, 결과 동작 유지 | AC-007d, AC-007g |
| 결과 보류 | 서류·근거 진입 없음, 결과 문구 원칙 없음 | AC-007e, AC-013c |
| 운영 구성에 시험 자료 유입 | 해당 보류 코드, 빌드 검사 실패 | AC-010a, AC-010b |
| 입력 없이 "처음으로" | 확인 없이 `K00_Start` | AC-015j |

## 7. 품질 게이트

| 게이트 | 기준 | 검증 단계 |
|--------|------|-----------|
| 엔진 커버리지 | `src/engine` 85% 이상(줄), 분기 커버리지도 함께 보고 | unit |
| 전체 커버리지 | 85% 이상, 커밋당 80% 이상(`quality.yaml`) | unit + integration |
| 형식·린트 | 타입 오류 0, 린트 오류 0 | 정적 검사 |
| 가져오기 경계 | 엔진 순수성(AC-001b), 운영 구성의 fixture 미포함(AC-010b), AI SDK 없음(AC-021d) | unit |
| 결정성 | AC-001a, AC-006d, AC-006g | unit + integration |
| 시험 피라미드 | 엔진·상태 기계 단위 시험이 가장 많고, API는 통합 시험, 화면 흐름은 E2E로 핵심 경로만 | — |
| TRUST 5 | Tested·Readable·Unified·Secured(입력 검증, 병원 소유 확인, 권한)·Trackable(Conventional Commits) | sync-auditor |
| 검증 단계 구분 | 보고서는 실행한 것 / 문서로 확인한 것 / 확인하지 않은 것을 나누고, 디자인 파일 확인을 렌더링·앱 실행으로 대신하지 않는다 | 보고서 검토 |

## 8. 완료 정의 (Definition of Done)

1. M1~M7이 닫는 `unit`·`integration`·`e2e-app` 세부 항목(AC-001~AC-025 가운데 plan.md §B가 M1~M7에 배정한 것)이 모두 통과하고, 실행한 명령과 출력이 progress.md §E.2에 남아 있다.
2. `render` 세부 항목(AC-010e, AC-013a·b·c의 렌더 부분, AC-017a·b·e·g, AC-023b)은 빌드한 화면을 두 방향(임시 검토 크기)으로 그린 근거와 함께 판정되어 있다.
3. AC-017(a~g)은 M6에서 판정되어 있고, `real-device` 세부 항목(AC-016g, AC-017h, AC-017i)은 M8 파일럿에서 기기가 정해진 뒤 판정·기록하며, 그 전에는 "미검증"으로 기록되어 있고 통과로 보고되지 않는다.
4. 운영 준비 상태표(DD-23)가 생성되고, 운영 데이터가 없는 칸은 `NOT_READY`로 보고된다. 실제 운영 개시는 M8 관문을 통과한 칸에 한한다.
5. plan.md §E의 확인 항목이 구현 착수 승인 전에 모두 풀려 있다(plan.md 첫머리의 규칙). 이 SPEC 작성이 끝난 시점에는 모두 미해결이며, 구현 착수 승인 게이트에서 소유자에게 제시된다. §E.1의 보류 확정 자료는 M8에서 자료가 들어온 칸만 운영에 쓴다.
