---
id: SPEC-REIMBURSEMENT-ESTIMATOR-001
title: "보담 실손보험 예상 부담액 계산기 (키오스크·관리자·결정적 계산 엔진)"
version: "0.1.0"
status: draft
created: 2026-10-14
updated: 2026-10-14
author: Nexsol
priority: P1
phase: "v0.1.0 target"
module: "src/engine, src/server, src/app/kiosk, src/app/admin"
lifecycle: spec-anchored
tags: "reimbursement, kiosk, estimator, deterministic-engine, rule-data, hold-state, korean-indemnity-insurance"
tier: L
---

# SPEC-REIMBURSEMENT-ESTIMATOR-001 — 보담 실손보험 예상 부담액 계산기

## HISTORY

| 버전 | 날짜 | 작성자 | 내용 |
|------|------|--------|------|
| 0.1.0 | 2026-10-14 | Nexsol | 최초 작성. 기준: 저장소 HEAD `c1f5d76`, 디자인 blob `4b4a158…`, 기획서 `보담_기획설계_v0.2.md`(2026-10-14 수정본). 구현·렌더링·실행은 하지 않았다 |
| 0.1.0 (1차 수정) | 2026-10-14 | Nexsol | 계획 감사 1회차(D-01~D-22) 반영. 공개 API 경로에 병원 slug 추가, 판정 기준에 있던 동작을 요구사항 문장으로 올림, 근거 없는 긴급 중지 권한 삭제, 출처 판정을 치료·기본비용 줄까지 확장, 보류 사유 표 보완. 소유자 결정(단일 SPEC 유지, Vitest, 운영 데이터 보류)은 plan.md §A.5 |
| 0.1.0 (2차 수정) | 2026-10-14 | Nexsol | 계획 감사 2회차(N-01~N-08) 반영. 확인 항목 해소 시점을 구현 착수 승인 전으로 통일, 2009.08~09 경계 계약 도움말을 미확정 항목으로 등록하고 가입일로 세대를 정하지 않는다는 조건 추가, 플랫폼 운영자 권한을 기획서 §7 6번의 두 권한으로 축소, 서류 규칙이 없을 때 서류 화면 동작을 기획서 §4에 맞춤 |

## 1. 개요

### 1.1 목적

병원에 설치된 공용 터치스크린 키오스크에서 환자가 가입·로그인 없이 ①실손 세대 ②보험사 형태 ③치료 원인 ④치료를 고르면, 별도 결과 화면에서 예상 병원 결제액 / 예상 보험금 / 보험금 수령 후 예상 본인 부담을 보여 준다(기획서 §1). 금액은 병원이 게시한 치료 가격과 승인된 규칙 데이터를 결정적으로 계산한 값이며, 생성형 AI를 쓰지 않는다. 병원 관리자와 보험 기준 검토 담당자는 별도 PC 관리자 웹에서 가격과 규칙을 다룬다(기획서 §7).

### 1.2 이 SPEC이 만드는 것과 만들지 않는 것

이 SPEC은 스키마·화면·엔진·시험을 정의한다. 표준 공제·한도 값, 약관 출처, 실제 병원 가격, 서류 요건은 아직 없으며, 소유자는 2026-10-14에 이 자료가 들어올 때까지 값을 추정하지 않고 보류하기로 정했다(plan.md §E.1). 승인된 운영 데이터가 들어오기 전까지 모든 계산은 계산 보류("확인 필요")가 되며, 개발과 시험은 `TEST_FIXTURE`로 표시한 별도 자료로 진행한다(design.md DD-04, DD-23).

### 1.3 용어

| 용어 | 뜻 |
|------|----|
| 예상 병원 결제액 | 건강보험 공단 부담분을 뺀, 환자가 오늘 병원에 낼 것으로 예상되는 금액(`amounts.hospitalPayment`, 기호 T) |
| 예상 보험금 | 입력한 조건과 승인된 규칙을 적용한 조건부 예상값(`amounts.expectedInsurancePayout`) |
| 보험금 수령 후 예상 본인 부담 | 예상 병원 결제액 − 예상 보험금. 오늘 병원에서 낼 금액이 아니다(`amounts.expectedOutOfPocketAfterPayout`) |
| 표준 가정 프로필 | 세대·보험사 형태별 공제·한도 가정. 근거 약관과 승인자가 있는 게시 상태일 때만 계산에 쓴다(`StandardAssumptionProfile`) |
| 치료 보장 매핑 | 병원 치료와 프로필의 계산 그룹을 잇는 승인 자료(`TreatmentCoverageMapping`) |
| 줄 | 계산에 들어가는 치료 하나 또는 공통 기본비용 하나 |
| 계산 보류 | 프로필·매핑·줄을 쓸 수 없어 계산하지 않은 상태. 화면 표현은 "확인 필요", 값은 null(`ON_HOLD`) |
| SPEC 결정 | 원문 문서가 정하지 않은 점을 이 SPEC이 정한 것 |
| (잠정) | 이 SPEC이 둔 기본값으로, 소유자 확인이 남은 것(plan.md §E에 등록) |

## 2. 공통 제약

- 같은 입력과 같은 데이터 버전에는 같은 결과와 같은 계산 근거를 낸다(기획서 §1).
- 미확정 표준값은 추정하지 않는다. 다른 세대·보험사 형태의 프로필, 인접 값, 평균, 0원, 전액 보장으로 채우지 않는다(기획서 §4 계산 기준 구분).
- 결과는 "입력으로 확인한 것 / 확인하지 않은 것 / 가정으로 적용한 것 / 계산하지 않는 것"을 섞지 않는다(기획서 §4).
- 키오스크 미리보기와 서버 최종 계산은 같은 엔진 모듈을 쓴다(기획서 §8).
- 병원은 가격·메뉴만 바꿀 수 있고 공제·한도는 바꿀 수 없다(기획서 §7).
- 개발 방식은 TDD, 커버리지 목표 85%, 커밋당 최소 80%다(`quality.yaml`). 시험 러너는 Vitest다(소유자 결정 2026-10-14).
- 검증 단계: 기획서 §14는 검증을 **파일 확인 / 렌더링 확인 / 앱 동작 검증** 세 단계로 나누고 서로 대신하지 않게 한다. 이 SPEC은 수용기준에 다섯 가지 표시를 붙이며, 그 대응은 SPEC이 정한 것이다(SPEC 결정).

| 수용기준 표시 (SPEC 정의) | 기획서 §14 단계 |
|---------------------------|------------------|
| `unit` (엔진·상태 기계 자동 시험, 정적 검사 포함) | 앱 동작 검증의 자동 시험 부분 |
| `integration` (API·저장소·구성 자동 시험) | 앱 동작 검증의 자동 시험 부분 |
| `e2e-app` (빌드한 앱을 브라우저에서 자동 조작) | 앱 동작 검증 |
| `render` (빌드한 화면을 그려서 확인) | 렌더링 확인 (디자인 파일이 아니라 구현된 화면) |
| `real-device` (실제 설치 기기) | 앱 동작 검증 (실기기) |

디자인 파일 확인(기획서의 파일 확인 단계)은 어떤 수용기준의 통과 근거도 되지 않는다.

## 3. 요구사항 (GEARS)

표기: 각 요구사항은 한 문장이며 그 문장 자체가 규범이다. 굵은 **When / While / Where**는 GEARS 수식어이고, 수식어가 없는 문장은 상시 요구사항이다. 문장 안의 열거값·코드·표는 design.md의 해당 DD가 정의한다. 요구사항 아래의 "판정 기준"은 같은 문장에 이미 들어 있는 조건을 검사하기 쉽게 다시 적은 것이며 새 동작을 더하지 않는다.

### 3.1 모듈 A — 결정적 계산·서류 엔진

**REQ-ENG-001** (High) — 계산 엔진(`src/engine`)은 UI·데이터베이스·네트워크·파일시스템 모듈을 가져오지 않고 시각과 난수는 주입받은 값만 쓰며, 금액은 원 단위 정수로, 비율은 basis points 정수로(SPEC 결정: 기획서 §6.3은 정수 분수와 basis points를 모두 허용) 다루고, 공제·한도·비율 값을 코드에 두지 않고(허용 상수는 0, basis points 척도 10000, `ROUND_HALF_UP`에 쓰는 그 절반 5000뿐) 표준 가정 프로필에서만 받아 같은 입력과 같은 데이터 버전에 바이트 단위로 같은 결과와 계산 근거를 반환해야 하며, 엔진·서버·키오스크 어디에서도 계산과 보상 설명을 위해 생성형 AI나 외부 모델 API를 호출해서는 안 된다(shall not).
- 근거: DD-02, DD-20 · 수용기준: AC-001, AC-021

**REQ-ENG-002** (High) — 계산 엔진은 기획서 §6.2의 순서대로 줄을 보장 대상·확인된 제외·보류로 먼저 나누고, 프로필이 정한 계산 그룹마다 보장 대상 비용 E를 합산해 그룹당 한 번만 공제 D를 구하되 서로 다른 그룹의 공제를 합치지 않고 확인된 제외 비용 X를 공제 기준에 넣지 않으며, 공제 방식은 닫힌 네 가지(`FIXED`, `RATE_WITH_FIXED_FLOOR`, `SPLIT_RATE_WITH_FIXED_FLOOR`, `CAPPED_RATE_WITH_FIXED_FLOOR`), 한도는 다섯 가지(`PER_VISIT_PAYOUT`, `UNLIMITED_DECLARED`(SPEC 결정), `PER_ACCIDENT`, `ANNUAL`, `COUNT`)만 계산해 `P = min(max(E − D, 0), L)`로 그룹 지급액을 정하고 명목 공제와 실제 적용 공제를 따로 기록하며, 그룹 사이 공유 한도는 한 번만 적용하고, `PER_ACCIDENT`·`ANNUAL`·`COUNT` 한도를 적용하면 `REMAINING_LIMIT_ASSUMED` 가정을 내고, 비율 규칙의 원 단위 처리(`TRUNCATE` | `ROUND_HALF_UP`)가 빠지면 기본값 없이 `PROFILE_VALUE_MISSING`으로, 닫힌 목록 밖의 공제 방식이나 `limitBasis = COVERED_COST`이면 `PROFILE_FORMULA_UNSUPPORTED`로, `UNLIMITED_DECLARED`에 조항 참조가 없으면 `PROFILE_SOURCE_INCOMPLETE`로 그 그룹의 줄을 보류해야 한다.
- 근거: DD-02 · 수용기준: AC-002, AC-003, AC-005

**REQ-ENG-003** (High) — **While** 줄 가운데 하나라도 `ON_HOLD`인 동안, 계산 엔진은 전체 상태를 `ON_HOLD`로 하고 예상 보험금과 보험금 수령 후 예상 본인 부담을 모두 null로, 예상 병원 결제액은 숫자로 반환하되 사용할 수 없는 줄은 어느 그룹에도 넣지 않고(`lines[]`와 `holdReasons[]`에만 기록) 보류 그룹과 한도를 공유하지 않는 `ESTIMATED` 그룹만 참고값(`referenceGroups`)으로 내야 하며, 보류가 없을 때에는 두 값을 정수로 반환해 예상 보험금 + 수령 후 부담 = 예상 병원 결제액, 0 ≤ 예상 보험금 ≤ 예상 병원 결제액이 되게 하고 확인된 제외가 있으면 전체 상태를 `ESTIMATED_WITH_EXCLUSIONS`로 하며, 어느 경우에나 DD-03 가정 코드 규칙(보류 결과에도 `PERSONAL_CONTRACT_NOT_CONFIRMED` 포함)에 따른 가정과 사용 버전·프로필·약관 출처·그룹별 계산 단계를 담은 계산 근거를 함께 내야 한다.
- 판정 기준: 0원은 정상 계산 결과(근거와 함께)나 확인된 제외 줄(사유와 함께)에만 나온다. "선택한 치료가 모두 보장 대상이고 한도가 남아 있다고 가정"(`ALL_COVERED_AND_LIMIT_REMAINS`)은 모든 줄이 `ESTIMATED`일 때만 나온다.
- 근거: DD-03, DD-05 · 수용기준: AC-002, AC-004, AC-005, AC-013

**REQ-ENG-004** (High) — **When** 계산 입력을 받으면, 계산 엔진은 세대가 지원 목록(`GEN1_AS`, `GEN2_C1`, `GEN2_5_C2`, `GEN3_C3`, `GEN4_C4`) 밖이면 `UNSUPPORTED_GENERATION`으로, 치료가 하나도 없으면 `NO_TREATMENT_SELECTED`로 계산 없이 거절하고, 같은 치료 ID는 한 번으로 치며, 등록된 공통 기본비용을 자동 포함 줄로 넣어 예상 병원 결제액에 더하고 그 등록 여부를 `baseFeeIncluded`(`INCLUDED` | `NOT_REGISTERED`)로 표시해야 하며, 지원 범위 밖 계약을 스스로 판별하거나 C4로 대신 계산하지 않고 치료 원인을 금액 계산에 쓰지 않아야 한다(shall not).
- 판정 기준: 원인 `INJURY` / `ILLNESS` / `UNKNOWN`의 `result` 블록이 바이트 단위로 같으며, 원인 `UNKNOWN`은 보류 사유가 아니다.
- 근거: DD-01, DD-03 · 수용기준: AC-004, AC-006, AC-014

**REQ-ENG-005** (High) — 서류 산출(DD-06)은 전체 결과가 `ON_HOLD`이면 null을, 사용 가능한 서류 규칙 묶음이 없으면 `RULES_UNAVAILABLE`을 반환하고, 그 밖에는 치료 원인·보험사 형태·선택 치료의 서류 관련 표시·병원 종별(의원 = 외래 전용)로 고정 9줄(영수증·진료비 세부내역서는 한 줄로 묶어 항상 필요)을 산출해 필요한 줄마다 우선순위가 가장 높은 규칙의 사유 하나를 달아야 하며, 원인이 `UNKNOWN`이면 상해와 질병 두 조건으로 각각 평가해 줄마다 `COMMON` / `INJURY_ONLY` / `ILLNESS_ONLY`를 표시하고 원인 하나로 정하지 않아야 한다.
- 근거: DD-06 · 수용기준: AC-007, AC-014

### 3.2 모듈 B — 표준 가정 프로필·치료 보장 매핑·서류 규칙 데이터

**REQ-DATA-001** (High) — 규칙 데이터(표준 가정 프로필, 치료 보장 매핑, 서류 규칙 묶음)는 DD-17의 생명주기와 약관 출처 기록(보험사 원문 식별, 개정일, 조항·페이지, 효력일, 확인자, 확인일)과 작성자·승인자 기록을 갖춰야 하고, 표준 가정 프로필은 (세대, 보험사 형태) 칸마다 독립 엔티티로 저장되어 다른 칸의 프로필·인접 값·평균·0원·전액 보장으로 대신 채워지지 않아야 하며, 보험사 데이터는 NH농협손해보험·NH농협생명·과거 농협공제를 서로 다른 기관으로 저장해야 한다.
- 근거: DD-17, DD-18(SPEC 결정: 프로필은 별도 엔티티) · 수용기준: AC-008, AC-011

**REQ-DATA-002** (High) — **When** 계산이 병원의 규칙 사용 범위·프로필·매핑·서류 규칙 묶음을 쓰려 할 때, 시스템은 게시 상태·허용 출처·유효 기간·약관 출처 완비·승인자 기록·무결성(프로필 내용 해시, 매핑 지문)을 함께 보는 단일 사용 가능 판정(DD-04) 하나로만 사용 여부를 정하고, 병원에 규칙 사용 범위가 없거나 프로필을 쓸 수 없으면 모든 줄을, 매핑을 쓸 수 없으면 그 줄만 DD-03 보류 사유 표의 코드와 판정 순서에 따라 `ON_HOLD`로 처리해야 하며, 매핑 지문이 현재 치료 버전의 보장 판단 필드(`treatmentCode`, `procedureCode(s)`, `benefitType`, `calcClass`)와 맞지 않으면 관리 화면의 상태 전환 여부와 관계없이 `MAPPING_UNDER_REREVIEW`로 판정해야 한다(가격은 지문에 들어가지 않는다).
- 근거: DD-03, DD-04, DD-05, DD-15 · 수용기준: AC-003, AC-008, AC-009

**REQ-DATA-003** (High) — 시스템은 구성별 허용 출처(운영 구성: 규칙 데이터와 줄 모두 `OPERATING`; 시험 구성: 규칙 데이터 `OPERATING`·`TEST_FIXTURE`, 줄 `OPERATING`·`TEST_FIXTURE`·`DEMO`)만 계산에 쓰고 그 밖의 출처를 `PROFILE_DEMO` · `MAPPING_INVALID` · `LINE_ORIGIN_NOT_ACCEPTED`로 보류해야 하며, `DEMO`·`TEST_FIXTURE` 데이터를 운영 카탈로그에 게시하거나 운영 저장소에 승인·게시 상태로 기록해서는 안 되고(shall not), 계산에 쓰인 프로필·매핑·서류 규칙·줄 가운데 하나라도 출처가 `OPERATING`이 아니면 응답의 `origin` 요약과 키오스크 화면의 테스트 데이터 표시가 함께 나타나야 한다.
- 판정 기준: 기획서 §5의 예시 치료 4종은 `DEMO` 출처 자료이므로 운영 구성에서는 계산에 쓰이지 않는다.
- 근거: DD-04 · 수용기준: AC-010

**REQ-DATA-004** (High) — 시스템은 병원 단위 카탈로그 버전(`CatalogVersion`)과 플랫폼 단위 규칙 묶음 버전(`RuleBundleVersion`)을 바꿀 수 없는 버전으로 게시하고, 규칙과 게시 버전을 덮어쓰거나 삭제하지 않으며, 이전 버전 복구는 사본을 새 버전으로 게시하는 방식으로만 하고, 가격만 바뀐 게시도 변경 이력이 남는 새 카탈로그 버전으로 내야 하며, 세대 5종 × 보험사 형태 3종의 운영 준비 상태표를 산출해 승인·게시된 `OPERATING` 프로필과 완비된 약관 출처가 없는 칸을 `NOT_READY`로 표시해야 한다.
- 근거: DD-14, DD-23 · 수용기준: AC-009, AC-011

**REQ-DATA-005** (Medium) — **When** 서류 규칙 묶음의 게시가 요청되면, 시스템은 어떤 (보험사 형태, 치료 표시) 조합에서든 상해 전용 줄이나 질병 전용 줄이 각각 1줄을 넘게 만드는 묶음의 게시를 거절하고 경고를 남겨야 한다(잠정: 원인 모름 서류 화면의 디자인 수용 한계).
- 근거: DD-06 · 수용기준: AC-007

### 3.3 모듈 C — 키오스크 흐름·세션

**REQ-FLOW-001** (High) — 키오스크는 시작 화면에 병원명과 공통 브랜드 설정의 서비스 표시명(기본값 "보담", 병원명과 별도 관리)을 보이고 "시작하기"를 누를 때마다 빈 세션으로 세대 → 보험사 형태 → 치료 원인 → 치료 선택의 네 입력 단계를 진행해야 하며, 세대는 환자가 카드로 직접 고르게 하고 날짜(가입일) 입력을 두지 않아 가입일로 세대를 정하거나 제안하지 않으며, 화면 1의 세대 카드 아래 "가입 시기를 모르실 때" 안내에 기획서 §4의 고정 문구(1544-8069는 문구로만)를 두고, 1-3단계는 고르기 전 "다음"을, 4단계는 치료가 없으면 "예상 부담액 확인"을 비활성으로 두고, "이전"과 목록 페이지 이동에서 선택을 유지하고, 이미 고른 치료의 반복 터치로 수량을 늘리지 않으며, 급여·비급여 합계와 총 예상 결제액을 엔진의 합산 함수로 즉시 갱신하고, 화면 1에서 "확인 방법 보기"를 누르면 계산 요청 없이 세대 확인 안내 화면을 보이며 "보험 선택으로 돌아가기"를 누르면 화면 1로 돌아가야 하고, 공제·한도·특약 질문, 상담 화면, 직원 문의 버튼, "1588" 표시를 두지 않아야 한다.
- 근거: DD-07 · 수용기준: AC-012, AC-023

**REQ-FLOW-002** (High) — **When** 계산 응답을 받으면, 키오스크는 전체 상태에 따라 정상 결과(`K04_Result`)·보장 제외 결과(`K04_Result_NotCovered`)·보류 결과(`K04_Result_Hold`)를 보여야 하고, 정상·보장 제외 결과에는 세 금액 이름, 세 번째 카드 보조 설명, 결과 문구 원칙, 공통 안내를 기획서 §4 문장 그대로 쓰고 예시 계산임을 표시하며 여섯 동작을 모두 두어야 하고, 보류 결과에는 예상 병원 결제액만 숫자로, 나머지 두 금액은 "확인 필요"로, 보류 줄은 환자용 사유 분류(DD-21)로 보이고, 결과 문구 원칙을 쓰지 않고 공통 안내 가운데 개인 계약 조건 문장만 쓰며, 동작은 "치료 다시 선택 / 보험 조건 수정 / 처음으로 / 이용 완료" 넷만 두어야 하고, 보류·통신 오류 화면에서 보험금을 0원으로 표시하거나 내부 코드를 보여서는 안 된다(shall not).
- 근거: DD-07, DD-21, DD-22 · 수용기준: AC-013

**REQ-FLOW-003** (High) — **When** 환자가 확정한 입력값(세대, 보험사 형태, 치료 원인, 치료 묶음) 가운데 하나를 다른 값으로 바꾸면, 키오스크는 계산 결과·서류 목록·계산 근거·복귀 정보를 즉시 지우고 `inputRevision`을 올려 "예상 부담액 확인"을 다시 눌러야 새 결과가 나오게 해야 하며(같은 값 재선택·목록 페이지 이동·이전·다음·큰 글자 전환은 입력 변경이 아니다), 계산이 끝난 결과에서 연 계산 근거는 입력 확인값, "(가정)"을 붙인 프로필 값과 약관 출처, 계산 단계, 보장 제외 결과에서 들어온 경우의 제외 항목과 사유를 보이고, 서류 확인은 원인이 상해·질병이면 `K07_Documents`로, 모름이면 `K07_Documents_Unknown`으로 가고, 서류 규칙을 쓸 수 없는 결과에서는 서류 화면이 서류 목록 대신 안내 문구를 보이되 "결과로 돌아가기"·"이용 완료"를 그대로 두며(잠정), 두 화면의 "결과로 돌아가기"는 진입 때 기록한 결과 종류·화면 방향·큰 글자 상태로 정확히 복귀해야 한다.
- 근거: DD-08, DD-11, DD-22, DD-06 · 수용기준: AC-007, AC-014

**REQ-FLOW-004** (High) — **While** 환자 데이터가 있는 화면에 머무는 동안, 키오스크는 입력 단계 100초 경고·120초 초기화, 정상·보장 제외 결과 160초·180초, 계산 근거·서류 화면 160초·180초(기획서 §13.2의 2026-10-14 임시 결정, 실제 머무는 시간 미관찰), 보류 결과 160초·180초(잠정), 세대 확인 안내·계산 중·통신 오류 100초·120초(잠정)로 같은 TimeoutDialog를 현재 화면 위에 띄워 경고하고 초기화해야 하며, 환자의 터치·키 입력만 무조작 시간을 다시 시작하게 하고, "이용 완료"와 통신 오류 화면의 "이용 종료"(잠정)는 먼저 세션을 지운 뒤 `K06_Complete`를 거쳐 `completionHoldSeconds` 뒤 `K00_Start`로, "처음으로"는 세션에 환자 입력이 하나라도 있으면 ResetConfirm 확인 뒤에 없으면 바로(SPEC 해석: 기획서 §13.2의 "진행 중"), 무조작 초기화는 경고 뒤 연장이 없을 때 각각 `K06_Complete` 없이 `K00_Start`로 보내야 한다.
- 근거: DD-07, DD-10, DD-13 · 수용기준: AC-015

**REQ-FLOW-005** (High) — 키오스크와 서버는 환자 선택·결과를 키오스크 메모리 세션에만 두고 브라우저 저장소(localStorage·sessionStorage·IndexedDB·Cache Storage·서비스워커, sessionStorage와 Cache Storage 포함은 SPEC 결정)·서버 저장소·로그·URL·분석 이벤트(단계별 익명 집계 제외)에 남겨서는 안 되며(shall not), 초기화 때 진행 중 계산 요청을 취소하고 `sessionId`를 새로 만들어 이전 (`sessionId`, `inputRevision`) 표시의 늦은 응답을 버리고, 뒤로·앞으로 이동·새로고침·페이지 캐시 복원을 빈 세션의 `K00_Start`로 처리하며, 키오스크 문서와 계산 응답을 `Cache-Control: no-store`로 제공하고(SPEC 결정), 키오스크에 관리자 인증 상태·`/admin` 링크·숨은 터치 진입이 없게 해야 한다.
- 근거: DD-09, DD-17 · 수용기준: AC-016, AC-021

**REQ-FLOW-006** (High) — 키오스크는 세로 1080×1920과 가로 1920×1080(임시 검토 크기) 두 방향, 같은 화면·같은 흐름·같은 계산의 반응형 큰 글자 보기(공간이 모자라면 기능을 빼지 않고 목록을 "이전 목록 / 다음 목록"으로 나누며 선택 유지, 전환 때 현재 화면 유지, 초기화 때 꺼짐(잠정)), 터치만으로 끝까지 이용하는 흐름과 보조 키보드 조작(보이는 포커스, 모달 안 포커스 가두기와 닫은 뒤 원래 위치 복귀), Pretendard 글꼴과 대체 순서(Noto Sans KR → 맑은 고딕 → 시스템 산세리프)를 지원하고, 디자인 조작 규격(기획서 §13.1; 이 가운데 구현 터치 영역 72 CSS px 이상은 통과·실패 기준으로 쓰며 이는 SPEC 결정)과 글자 대비 기준(design-requirements §2.1)을 디자인 기준으로 삼으며(접근성 인증이나 실기기 검증을 뜻하지 않음), 환자 화면에 내부 코드·내부 설계 설명·외부 웹 링크·"환자분의 실손은 C1입니다" 같은 확인 사실 표현을 두지 않아야 한다.
- 근거: DD-07, DD-12, DD-22 · 수용기준: AC-017

### 3.4 모듈 D — 서버 API·재계산·버전

**REQ-API-001** (High) — 서버는 `GET /api/clinics/{slug}/catalog`와 `GET /api/clinics/{slug}/insurance/options`(SPEC 결정: 기획서의 `/api/insurance/options`에 병원 slug를 넣음)에서 화면 표시 필드만 반환해야 하며, catalog에는 보장 검토 내부 정보를 넣지 않고, options에는 승인된 프로필 유무와 관계없이 세대 카드 5장·보험사 형태 카드 3장·치료 원인 카드 3장·세대 확인 안내 문구(1544-8069는 문자열)와 그 병원의 현재 `ruleBundleVersion`을 항상 담아야 하고, 없는 slug에는 404 `CLINIC_NOT_FOUND`를 반환해야 한다.
- 근거: DD-19, DD-05 · 수용기준: AC-012, AC-018

**REQ-API-002** (High) — **When** `POST /api/clinics/{slug}/estimate`(SPEC 결정: 기획서의 `/api/estimate`에 병원 slug를 넣음)를 받으면, 서버는 경로의 slug로 병원을 정하고 모든 치료 ID가 그 병원의 현재 게시 카탈로그에 속하는지 확인한 뒤(아니면 422 `TREATMENT_NOT_PUBLISHED`) 그 병원의 게시 가격·공통 기본비용·규칙 묶음으로 키오스크 미리보기와 같은 엔진 모듈로 다시 계산해야 하며, 요청 본문의 가격·비율·병원 ID 같은 다른 필드는 읽지 않아야 한다(shall not).
- 근거: DD-19 · 수용기준: AC-019

**REQ-API-003** (High) — **When** 계산 요청의 `catalogVersion`이나 `ruleBundleVersion`이 그 병원의 현재 버전과 다르면, 서버는 결과 없이 HTTP 409 `VERSION_MISMATCH`와 DD-14의 본문(최신 두 버전, `priceChanged`, `ruleChanged`, `treatmentsUnpublished[]`)을 반환해야 하고, 키오스크는 그 병원의 catalog와 options를 다시 받아 게시 중인 선택만 남기고 내려간 치료는 안내와 함께 빼며 새 합계를 보인 뒤 4단계에서 환자가 다시 확인해야 결과가 나오게 해야 한다.
- 근거: DD-14 · 수용기준: AC-020

**REQ-API-004** (High) — 서버는 계산 보류를 HTTP 200 결과로 반환하고 오류는 DD-19 오류 표(SPEC 결정: 400 `INVALID_REQUEST`, 401 `UNAUTHENTICATED`·403 `FORBIDDEN`(관리자 경로), 404 `CLINIC_NOT_FOUND`, 409 `VERSION_MISMATCH`, 422 `UNSUPPORTED_GENERATION`·`NO_TREATMENT_SELECTED`·`TREATMENT_NOT_PUBLISHED`, 5xx)로만 반환하며 성공 응답에 계산에 실제로 쓴 버전·프로필 id·버전·`origin` 요약을 담아야 하고, 키오스크는 409를 버전 불일치 흐름으로, `NO_TREATMENT_SELECTED`와 `TREATMENT_NOT_PUBLISHED`를 DD-19 클라이언트 처리 표의 해당 행으로, 그 밖의 4xx와 5xx·시간 초과·연결 실패를 `FAILED`로 보아 통신 오류 화면(`KXX_Error_Network`)으로 처리해야 한다.
- 근거: DD-19, DD-03, DD-07 · 수용기준: AC-006, AC-013, AC-021

### 3.5 모듈 E — 관리자·권한·승인·게시·재검토

**REQ-ADM-001** (High) — **When** 관리자 API 요청을 받으면, 서버는 인증 여부(아니면 401)와 사용자의 역할(병원 관리자, 보험 기준 검토 담당자, 플랫폼 운영자)·병원 소속을 DD-17 권한 표에 따라 확인하고, 권한 밖의 동작이거나 다른 병원의 자원이면 403으로 거절해야 하고, 플랫폼 운영자에게는 병원별 관리자 소속·역할 관리와 규칙 사용 범위 지정(기획서 §7 6번)과 그에 필요한 조회만 허용해야 하며, 여러 역할을 맡은 사용자도 동작마다 해당 역할의 권한만으로 판정해야 한다.
- 근거: DD-17 · 수용기준: AC-022

**REQ-ADM-002** (High) — 병원 관리자에게는 DD-17 권한 표의 병원 관리자 열(자기 병원의 설정·무조작 정책·치료·가격·공통 기본비용·카탈로그 초안·미리보기·게시, 보장 분류 정보의 등록·변경 요청, 검토 요청, 검토 결과·반려 사유 조회)만 허용되어야 하며, 공제·한도·프로필·매핑의 편집, 매핑 승인·반려, "검토 완료" 지정은 화면과 서버 어디에서도 허용되어서는 안 되고(shall not), 관리자 화면은 검토 상태를 읽기 전용으로 보이고 상태 동작은 "검토 요청"뿐이어야 한다.
- 근거: DD-17 · 수용기준: AC-023

**REQ-ADM-003** (High) — **When** 병원 관리자가 검토를 요청하면, 시스템은 병원이 제안한 보장 분류 정보를 담은 검토 요청 기록(`REVIEW_REQUESTED`)을 만들고 보험 기준 검토 담당자만 그 요청으로 매핑 초안(`DRAFT`)을 작성해 승인하거나 사유가 필수인 반려를 기록하게 해야 하며, 보장 판단 필드가 바뀐 치료 버전이 게시되면 승인(`APPROVED`)·게시(`PUBLISHED`) 상태의 매핑을 `UNDER_REREVIEW`로 돌리고, 매핑이 없는 새 치료의 가격 게시는 허용하되 그 줄이 `MAPPING_ABSENT`로 보류되게 해야 한다.
- 근거: DD-16, DD-17 · 수용기준: AC-009, AC-024

**REQ-ADM-004** (Medium) — 시스템은 모든 게시·승인·반려·중지·복구를 수행자·역할·일시·사유·이전/이후 버전과 함께 감사 기록에 남기고, 작성자와 승인자가 같은 승인에 `selfApproval: true`를 기록하며(SPEC 결정), 게시 전 세로·가로 미리보기를 같은 엔진으로 제공하고, 플랫폼 운영자만 병원별 규칙 사용 범위(`ClinicRuleScope`)를 지정하게 하며, 검토 담당자가 프로필 승인에 계산 예제-약관 대조 기록을 첨부할 수 있게 해야 한다.
- 근거: DD-14, DD-17 · 수용기준: AC-025

**REQ-ADM-005** (Medium) — **When** 병원 관리자가 무조작 정책을 저장하면, 시스템은 화면 종류마다 경고 시점 < 초기화 시점이고 둘의 차이가 20초 이상인 값만 저장해야 하며(잠정: 기획서 §13.2의 기본값 "초기화 20초 전에 경고"를 저장 하한으로 삼은 SPEC 결정), `completionHoldSeconds`는 이 하한 없이 양의 정수로 병원별로 저장해야 한다.
- 근거: DD-10, DD-13 · 수용기준: AC-015, AC-023

## 4. 추적표

### 4.1 요구사항 추적

마일스톤 열은 그 요구사항에 연결된 수용기준의 세부 항목을 plan.md §B에서 닫는 마일스톤 전체다(한 수용기준이 여러 요구사항에 연결되면 같은 마일스톤이 여러 행에 나온다). M8 관문은 해당 행에만 따로 적었다.

| REQ ID | 기획서 § | product/structure/tech § | design-requirements 행 / Pencil 프레임 | AC ID | 마일스톤 |
|--------|----------|--------------------------|----------------------------------------|-------|----------|
| REQ-ENG-001 | §1, §6.3, §8, §12 원칙 10 | tech.md §2, §3; structure.md §4 | — | AC-001, AC-021 | M1.4, M4 |
| REQ-ENG-002 | §6.2, §6.3, §6.4, §9(고정 공제·한도 순서·작은 비용·공제 중복·반올림·제외 항목) | tech.md §3, §8; structure.md §4 | §3 행 17 / `K04_Basis_Calculation` (GhMYi) | AC-002, AC-003, AC-005 | M1.3 |
| REQ-ENG-003 | §4 결과 상태별 표시·가정 문구, §6.1, §9 공통 불변 조건 | product.md §5; tech.md §3 | §3 행 4·5·6·20 / `K04_Result` (TJoQ2), `K04_Result_NotCovered` (XxmHQ) | AC-002, AC-004, AC-005, AC-013 | M1.3, M6 |
| REQ-ENG-004 | §3, §4 화면 3, §5 공통 기본비용, §9 지원 범위·치료 원인 모름 | product.md §4·§7; structure.md §4 | §3 행 2·16 / `K02b_Cause_Empty` (QfXL0), `K02b_Cause_Selected` (FFtQN) | AC-004, AC-006, AC-014 | M1.1, M1.3, M4, M5, M6 |
| REQ-ENG-005 | §4 필요 서류 안내 화면, §9 필요 서류 안내·치료 원인 모름 | product.md §4; tech.md §8 | §3 행 18·18a / `K07_Documents` (F19r1B), `K07_Documents_Unknown` (J6jAj) | AC-007, AC-014 | M2, M3, M5, M6 |
| REQ-DATA-001 | §4 계산 기준 구분, §7, §8 | product.md §5.4; structure.md §5·§6 | §3 행 17·20 | AC-008, AC-011 | M1.2, M3 |
| REQ-DATA-002 | §4 계산 기준 구분, §6.1, §7 변경 종류별 재검토 기준, §9 표준 프로필 상태·치료 매핑 상태·특약 가정 없음 | product.md §5.4; structure.md §4·§7 | §3 행 14·20 | AC-003, AC-008, AC-009 | M1.2, M1.3, M3 |
| REQ-DATA-003 | §5, §8, §9 초안 규칙, §10 2단계 | structure.md §4·§5; tech.md §1 | §5.13.3 13-3 / `K04_Basis_Calculation` (GhMYi) | AC-010 | M1.2, M1.4, M3, M4, M6 |
| REQ-DATA-004 | §7, §8, §11 | structure.md §5; tech.md §4 | `A04_Admin_PublishPreview` | AC-009, AC-011 | M1.2, M3, M8(준비 상태 관문) |
| REQ-DATA-005 | §4 필요 서류 안내 화면 | product.md §4 | §3 행 18 / `K07_Documents_Unknown` (J6jAj), `L_K07_Documents_Unknown` (mZDkv) | AC-007 | M2, M3, M6 |
| REQ-FLOW-001 | §1, §4 시작 화면·화면 1-4, §8 브랜드, §9 키오스크 동선·목록 페이지·세대 모름·치료 원인 선택·상담 진입 없음 | product.md §4 | §3 행 16·19 / `K00_Start` (u5CZTt), `K01_Generation_Empty` (Z3izyJ), `K01_Generation_Selected` (lYlRt), `K01_Generation_Unknown` (p1nNbK), `K02_Type_Empty` (ghhVb), `K02_Type_Selected` (eDRoY), `K02b_Cause_Empty` (QfXL0), `K02b_Cause_Selected` (FFtQN), `K03_Treatments_*` | AC-012, AC-023 | M5, M6, M7 |
| REQ-FLOW-002 | §4 결과 화면·결과 상태별 표시·결과 문구 원칙, §6.1, §9 세 금액 구분·확인 불가와 보장 제외·통신 오류 | product.md §5 | §3 행 4·5·6·12·19·20 / `K04_Result` (TJoQ2), `K04_Result_NotCovered` (XxmHQ), `L_K04_Result` (n3WXk), `KXX_Error_Network` (bWvFJ) | AC-013 | M6 |
| REQ-FLOW-003 | §4 결과 화면·설명 영역·필요 서류 안내 화면, §9 서류 안내 복귀·계산 근거 복귀·서류 안내 원인 분기 | structure.md §8 | §3 행 18a·22 / `K04_Basis_Calculation` (GhMYi), `K07_Documents` (F19r1B), `K07_Documents_Unknown` (J6jAj), `L_K07_Documents` (CL4xk), `L_K07_Documents_Unknown` (mZDkv) | AC-007, AC-014 | M2, M3, M5, M6 |
| REQ-FLOW-004 | §13.2, §9 이용 완료 동선·무조작 초기화 | tech.md §5; structure.md §8 | §3 행 7·21 / `K06_Complete` (ilzkX), `K04_Result_Dialog_Timeout` (YcF5k), `K03_Treatments_Dialog_Reset` (r4N0OQ) | AC-015 | M5, M6 |
| REQ-FLOW-005 | §8, §13.2, §13.3, §9 늦은 계산 응답·재시작·뒤로가기 | tech.md §5; structure.md §2·§8 | — | AC-016, AC-021 | M4, M6, M8 |
| REQ-FLOW-006 | §13.1, §9 기기 표시·터치 이용·보조 키보드 조작·큰 글자 모드·환자 화면 내부 설명 | tech.md §6, §8.1; structure.md §10 | §2, §2.1, §3 행 9·23 / `KioskHeader` (nacd2) 토글 `MkKly` | AC-017 | M6, M8 |
| REQ-API-001 | §8 예상 API, §4 화면 1·2 | structure.md §3 | §3 행 16 | AC-012, AC-018 | M4, M5, M6 |
| REQ-API-002 | §8, §9 가격 변조 | structure.md §3; tech.md §4 | — | AC-019 | M4 |
| REQ-API-003 | §7 마지막 문단, §9 버전 변경 | tech.md §4; structure.md §3 | `A04_Admin_PublishPreview` | AC-020 | M4, M6 |
| REQ-API-004 | §6.1, §8, §9 지원 범위·통신 오류, §13.3 | structure.md §3 | `KXX_Error_Network` (bWvFJ) | AC-006, AC-013, AC-021 | M1.1, M4, M6 |
| REQ-ADM-001 | §7, §9 병원 격리 | structure.md §7 | — | AC-022 | M7 |
| REQ-ADM-002 | §7, §9 승인 권한 분리 | product.md §5.2; structure.md §7 | §3 행 3·13 / `A03_Admin_TreatmentEdit` (ECPf6), `A02_Admin_TreatmentList` | AC-023 | M7 |
| REQ-ADM-003 | §5, §7 변경 종류별 재검토 기준 | structure.md §7 | §3 행 14 / `A03_Admin_TreatmentEdit` (ECPf6) | AC-009, AC-024 | M1.2, M3, M7 |
| REQ-ADM-004 | §7 | structure.md §5 | `A04_Admin_PublishPreview` | AC-025 | M7 |
| REQ-ADM-005 | §7 병원 관리자 6, §13.2 | tech.md §5 | `A01_Admin_HospitalSettings` (HHJq7) | AC-015, AC-023 | M5, M6, M7 |

역방향 확인: AC-001~AC-025 각각의 "요구사항" 줄(acceptance.md)은 위 표의 AC 열과 연결이 일치한다.

### 4.2 디자인 대응

프레임 이름이 기준이며, ID는 design-requirements §3(현재 상태 표)의 값이다. 원문 문서 안에서 ID가 어긋나는 경우는 research.md §5 #8에 적었다.

| 프레임 (이름·ID) | 이 SPEC의 대응 |
|------------------|----------------|
| `K00_Start` (u5CZTt) | 시작 상태(DD-07), REQ-FLOW-001 |
| `K01_Generation_Empty` (Z3izyJ), `K01_Generation_Selected` (lYlRt), `L_K01_Generation` (JNcEQ) | 1단계, REQ-FLOW-001 |
| `K01_Generation_Unknown` (p1nNbK) | 세대 확인 안내(결과 상태 아님), REQ-FLOW-001 |
| `K02_Type_Empty` (ghhVb), `K02_Type_Selected` (eDRoY) | 2단계, REQ-FLOW-001 |
| `K02b_Cause_Empty` (QfXL0), `K02b_Cause_Selected` (FFtQN), `L_K02b_Cause` (CpUd6) | 3단계, REQ-FLOW-001, REQ-ENG-004 |
| `K03_Treatments_*`, `K03_Treatments_Dialog_Reset` (r4N0OQ) | 4단계, ResetConfirm, REQ-FLOW-001, REQ-FLOW-004 |
| `KXX_Loading_Calculating` | 계산 중 상태, REQ-FLOW-004 |
| `K04_Result` (TJoQ2), `L_K04_Result` (n3WXk) | 정상 결과, REQ-FLOW-002 |
| `K04_Result_NotCovered` (XxmHQ) | 보장 제외 결과, REQ-FLOW-002 |
| (프레임 없음) `K04_Result_Hold` | 공통 컴포넌트로 구성하는 보류 결과(DD-07), REQ-FLOW-002 |
| `K04_Result_Dialog_Timeout` (YcF5k) | TimeoutDialog를 현재 화면 위에 띄움(DD-10), REQ-FLOW-004 |
| `K04_Basis_Calculation` (GhMYi) | 계산 근거, REQ-FLOW-003, DD-22 |
| `K07_Documents` (F19r1B), `K07_Documents_Unknown` (J6jAj), `L_K07_Documents` (CL4xk), `L_K07_Documents_Unknown` (mZDkv) | 필요 서류, REQ-ENG-005, REQ-FLOW-003 |
| `K06_Complete` (ilzkX) | 이용 완료, REQ-FLOW-004 |
| `KXX_Error_Network` (bWvFJ) | 통신 오류, REQ-API-004 |
| `KioskHeader` (nacd2) 토글 `MkKly` | 큰 글자 보기, REQ-FLOW-006 |
| `A01_Admin_HospitalSettings` (HHJq7), `A02_Admin_TreatmentList`, `A03_Admin_TreatmentEdit` (ECPf6), `A04_Admin_PublishPreview` | 관리자, REQ-ADM-002~005 |

| 디자인 차이 (design-requirements §5.13.3) | 해결하는 요구사항 |
|-------------------------------------------|-------------------|
| 13-1 계산 근거 복귀가 `K04_Result`로 고정 | REQ-FLOW-003 (ReturnContext, DD-11) |
| 13-2 시간 초과 배경 결과에 서류 확인 버튼 없음 | REQ-FLOW-004 (TimeoutDialog를 실제 화면 위에 띄움, DD-10), REQ-FLOW-002 |
| 13-3 "표준값" 표현 | REQ-DATA-003 (운영 외 출처 표시, DD-04) |
| 13-4 계산 근거·서류 화면의 무조작 행 누락 | REQ-FLOW-004 (DD-10) |

## 5. 제외 범위 (Exclusions)

이 SPEC에서 만들지 않는 항목이다. 아래 항목은 계산하지도, 화면에 기능처럼 보이게 하지도 않는다.

### Out of Scope — 지원하지 않는 보험 세대와 계산

- 5세대 실손, 중증/비중증 분기, 특약1/2, 건강보험 본인부담률 연동 계산과 그에 딸린 데이터·시험
- 입원, 처방조제, 복수 병원, 여러 날짜, 다수 실손 비례보상
- 노후·유병력자·단체 실손, 산재·자동차보험 병행
- 지원 범위 밖 계약을 일반 개인 실손 규칙이나 C4 규칙으로 대신 계산하는 것, 그리고 그런 계약을 가려내는 화면(가려내는 방법은 미정, plan.md §E #11)

### Out of Scope — 환자 개인정보와 청구

- 환자 가입·로그인, 이름·주민번호·보험증권·진단서 업로드
- 보험 자동 조회, 청구 대행
- 환자 개인의 공제·한도·특약·잔여 한도를 묻거나 조회하는 기능

### Out of Scope — 키오스크 부가 기능

- 오프라인 계산, 프린터, 전화 연결, 직원 호출, 결과 QR 전송
- 예약, 접수, 결제
- 상담 화면과 직원 문의 버튼
- 보험사 이름 목록·검색

### Out of Scope — 런타임 생성형 AI

- 계산, 보상 설명, 문구 생성 등 실행 중 어떤 목적의 생성형 AI·LLM 호출

### Out of Scope — 이 SPEC 문서 작업 자체와 기기 설정

- 앱 구현, 배포, 기기 잠금·자동 실행 설정
- `design/design.pen`의 변경 (디자인 후속 요청은 plan.md §F에 소유자 전달용으로만 적는다)
- 표준 공제·한도 값, 약관 출처, 병원 가격, 서류 요건의 작성·추정
- 플랫폼 운영자의 병원별 규칙 긴급 중지 (원문 근거 없음, plan.md §F의 선택 후속 항목)
