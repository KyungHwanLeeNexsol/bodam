# SPEC-REIMBURSEMENT-ESTIMATOR-001 — 구현 계획 (plan.md)

> 일정 추정은 쓰지 않는다. 순서와 우선순위만 적는다.
>
> **확인 표시 규칙 (plan 워크플로 규칙):** 모든 확인 표시(NEEDS CLARIFICATION)는 구현 착수 승인(Implementation Kickoff Approval, plan→run 사람 게이트) 전에 풀려야 한다. 이 SPEC 작성이 끝난 시점에 남은 확인 항목은 모두 미해결이며, 구현 착수 승인 게이트에서 소유자에게 제시된다. 확인 표시는 §E.2~§E.5에만 두고, 다른 절에서는 "(§E #n)"으로 가리킨다. §E의 "처음 필요" 마일스톤은 답이 처음 쓰이는 곳을 뜻하며, 그 마일스톤까지 답을 미뤄도 된다는 뜻이 아니다.

## §A 배경

### A.1 근거 문서
- 기획서 `보담_기획설계_v0.2.md`(2026-10-14 수정본), `.moai/project/product.md`, `structure.md`, `tech.md`, `interview.md`, `design-requirements.md`(§5.13이 현재 디자인 상태). 읽은 범위와 사실은 research.md에 있다.
- 기준: HEAD `c1f5d76e6e36d7fc18b3a7fdc6c6d9dbe9d4e5b2`, 디자인 blob `4b4a1587e4361996ec834b5122515051c84cf7e8`.
- 이 SPEC은 단독 SPEC이며 에픽에 속하지 않는다. 앞선 SPEC이 없으므로 `depends_on`이 없다.

### A.2 Tier와 진행 경로
- Tier L(엔진·서버·키오스크·관리자 네 영역, 예상 파일 수가 15개를 넘음). 산출물 5종(spec, plan, acceptance, design, research)과 spec-compact.md, progress.md.
- Tier L이므로 spec-workflow.md의 PR 경로(Route B)를 따른다. 마일스톤이 3개 이상이고 파일이 10개를 넘으므로 run 단계에서 orchestrator가 `manager-lead` 사용 여부를 판단한다(Phase 4).
- 최상위 요구사항 25개(모듈 5개: ENG 5, DATA 5, FLOW 6, API 4, ADM 5), 최상위 수용기준 25개(AC-001~AC-025)로 Tier L 상한(각 25)에 맞추었다. 수용기준 아래에는 문자 접미사 세부 항목이 모두 134개 있으며, 세부 항목 하나는 아래 §B의 마일스톤 하나에서만 닫힌다.

### A.3 이번 SPEC이 하지 않는 것
- 표준 공제·한도 값, 약관 출처, 병원 가격, 서류 요건을 만들거나 추정하지 않는다. 운영 데이터가 승인되기 전까지 모든 계산은 "확인 필요"다(design.md DD-23).
- `design/design.pen`을 바꾸지 않는다. 디자인 후속 항목은 §F에 소유자 전달용으로만 적는다.

### A.4 먼저 검토할 결정 (바뀔 가능성이 큰 순서)
1. 결과 형식과 상태 코드(DD-03): 세 금액의 null 규칙, 보류 사유 코드 목록과 판정 순서, 보류 줄은 어느 그룹에도 넣지 않는다는 규칙, 가정 코드.
2. 공개 API 경로에 병원 slug를 넣는 결정(DD-19, §E #33)과 409 본문 형식(DD-14).
3. 표준 가정 프로필을 별도 엔티티로 두는 결정과 그룹·공유 한도 모델(DD-02, DD-18), 매핑 작성 주체(DD-17, §E #34).
4. 보류 결과 화면 `K04_Result_Hold`의 구성·문구·동작 네 개(DD-07), 환자용 보류 분류 문구(DD-21).
5. 출처 판정을 치료·기본비용 줄까지 넓힌 규칙과 테스트 데이터 표시 조건(DD-04).
6. 무조작 시간 잠정값과 20초 저장 하한, 큰 글자 보기 초기화(DD-10, DD-12).
7. 그 밖의 기계적 단계(디렉터리 구성, 어댑터, 화면 조립)는 뒤에 둔다.

### A.5 소유자 결정 (2026-10-14, 이 세션에서 소유자가 직접 답함)
1. **SPEC 하나로 유지한다.** 관리자 영역을 따로 떼지 않는다. 원문 근거가 없는 동작(플랫폼 운영자의 병원별 규칙 긴급 중지와 그 표시)은 요구사항에서 뺐고, §F에 선택 후속 항목으로만 남긴다. 판정 기준에 숨어 있던 동작은 모두 요구사항 문장으로 올리거나 지웠다.
2. **시험 러너는 Vitest다.** 확인 항목에서 지웠고 §G와 DD-20에 확정값으로 적었다.
3. **운영 데이터 11항목은 자료가 생길 때까지 보류한다.** 값을 추정하지 않는다. §E.1에 보류 확정 자료로 옮겼다(확인 표시 없음).
4. 나머지 확인 항목은 소유자가 승인하지 않았으므로 §E.2~§E.5에 미해결 확인 항목으로 남긴다. 이 항목들은 구현 착수 승인 게이트에서 소유자에게 제시된다. 이 문서의 어떤 잠정값도 소유자 승인으로 적지 않는다.

## §B 마일스톤

순서: M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8. M2와 M3는 M1 형식에만 기대므로 M1 뒤에 어느 쪽을 먼저 해도 되지만, 기본 순서는 위와 같다. M8은 실제 데이터를 기다리는 관문이며 이 SPEC의 코드 산출물이 아니다.

표기: "닫는 AC"는 그 마일스톤에서 판정을 끝내는 세부 항목이다. "증거만 내는 AC"는 그 마일스톤이 일부 증거(예: 상태 기계의 unit 부분)를 만들고 판정은 뒤 마일스톤에서 끝나는 항목이다. 각 마일스톤 완료 보고는 실행한 명령과 출력 원문을 progress.md §E.2에 남긴다.

검증 명령은 Vitest 기준 예시이며 같은 뜻의 명령으로 바꿀 수 있다.

### M1 엔진 형식·사용 가능 판정·공제·한도·결과 상태 — **첫 구현 단계**

- 우선순위: High
- 필요한 것: 없음(시험 러너 Vitest는 확정). 실제 데이터는 필요 없다. 모든 시험 자료는 `TEST_FIXTURE`다.
- 범위: `src/engine` 순수 TS 모듈, 시험 자료, 가져오기 경계 검사. 최소 `package.json`·`tsconfig.json`·Vitest 설정(Next.js 골격은 M4에서 같은 패키지에 더한다).
- 진입 조건: 구현 착수 승인 통과.
- 종료 조건: 아래 하위 단계가 닫는 AC가 모두 통과하고 엔진 커버리지 85% 이상.

| 하위 단계 | 할 일 | 파일(제안) | 닫는 AC |
|-----------|-------|------------|---------|
| M1.1 형식과 상태 코드 | DD-03의 입력·출력 형식, 열거값, 보류·가정 코드, 엔진 입력 검증(세대 열거, 치료 0개, 중복 제거), 원인 인자 없음 | `src/engine/types.ts`, `src/engine/validate.ts`, `tests/engine/validate.test.ts` | AC-006a, AC-006b, AC-006c, AC-006d, AC-006e |
| M1.2 사용 가능 판정과 보류 행렬 | `isUsable()`와 `UsabilityReason`, 구성별 허용 출처, 규칙 사용 범위 없음, 프로필 칸 조회(대체 금지), 매핑 조회(모호성 포함), 줄 출처, 지문 비교, 판정 순서 | `src/engine/usability.ts`, `src/engine/resolve.ts`, `tests/engine/hold-matrix.test.ts`, `tests/engine/origins.test.ts`, `tests/fixtures/engine/profiles.fixture.ts`, `tests/fixtures/engine/mappings.fixture.ts`, `tests/fixtures/engine/lines.fixture.ts` | AC-008a~f, AC-009b, AC-010a |
| M1.3 그룹·공제·한도·원 단위 계산 | 닫힌 공제 방식 4종, 한도 5종, 공유 한도, 명목·실제 공제, 보류 줄 그룹 제외, 예상 병원 결제액·기본비용, 상태 합성, referenceGroups, assumptions, basis | `src/engine/deduction.ts`, `src/engine/limit.ts`, `src/engine/rounding.ts`, `src/engine/estimate.ts`, `src/engine/sum.ts`, `tests/engine/examples.test.ts`, `tests/engine/rules.test.ts`, `tests/engine/states.test.ts`, `tests/engine/invariants.test.ts` | AC-002a~i, AC-003a~f, AC-004a~g, AC-005a |
| M1.4 결정성과 가져오기 경계 | 반복·새 프로세스 직렬화 비교, 금지 모듈·주입 없는 시계·난수 검사, 허용 상수(0, 10000, 5000) 밖 숫자 상수 검사, 운영 구성의 fixture 미포함 검사 | `tests/engine/determinism.test.ts`, `tests/boundary/engine-imports.test.ts`, `tests/boundary/production-no-fixtures.test.ts` | AC-001a~c, AC-010b |

검증 명령(예시):
```bash
npx vitest run tests/engine tests/boundary
npx vitest run --coverage tests/engine
npx tsc --noEmit
```
남길 근거: RED 단계의 실패 출력(TDD), GREEN 이후 통과 출력, 커버리지 표, 경계 검사 음성 시험의 실패 출력.

### M2 서류 산출 엔진과 시험 자료 서류 규칙

- 우선순위: High
- 범위: `deriveDocuments()`, 고정 9줄(`DocumentLineKey`), 원인 모름 이중 평가, `RULES_UNAVAILABLE`, 보류 시 null.
- 파일(제안): `src/engine/documents.ts`, `tests/engine/documents.test.ts`, `tests/fixtures/engine/document-rules.fixture.ts`(기획서 §4 예시, "검증 필요" 표시).
- 진입: M1 종료. 종료: 닫는 AC 통과.
- 닫는 AC: AC-007a, AC-007b, AC-007c, AC-007d, AC-007e
- 검증 명령: `npx vitest run tests/engine/documents.test.ts --coverage`

### M3 데이터 모델·생명주기·저장소·버전·게시 검증

- 우선순위: High
- 범위: DD-18 엔티티의 형식(`CoverageReviewRequest` 포함), 생명주기 상태 기계(DD-17, `APPROVED`·`PUBLISHED` → `UNDER_REREVIEW`), 저장소 인터페이스와 메모리 구현, 지문 계산(DD-15), 재검토 기준(DD-16), `CatalogVersion`·`RuleBundleVersion` 불변 게시와 복구, 운영 카탈로그의 `DEMO`·`TEST_FIXTURE` 게시 거절, 서류 규칙 묶음 게시 검증(전용 줄 한계), 준비 상태표(DD-23), 보험사 기관 분리.
- 파일(제안): `src/server/domain/*.ts`, `src/server/repo/interfaces.ts`, `src/server/repo/memory/*.ts`, `src/server/lifecycle.ts`, `src/server/fingerprint.ts`, `src/server/versioning.ts`, `src/server/publish-validate.ts`, `src/server/readiness.ts`, `tests/server/*.test.ts`.
- 진입: M1 종료. 종료: 닫는 AC 통과. DB 어댑터는 §E #1의 답(구현 착수 승인 전에 정함)이 가리키는 제품으로 만들며, 이 마일스톤의 종료 조건에는 메모리 구현만 넣는다.
- 닫는 AC: AC-007f, AC-009a, AC-009c, AC-010c, AC-011a, AC-011b, AC-011c, AC-011d
- 검증 명령: `npx vitest run tests/server --coverage`

### M4 서버 API (catalog / options / estimate)

- 우선순위: High
- 범위: Next.js App Router 골격, 세 공개 경로(`/api/clinics/{slug}/catalog`, `/api/clinics/{slug}/insurance/options`, `/api/clinics/{slug}/estimate`, §E #33), 병원별 규칙 사용 범위 해석, 서버 재계산(엔진 공유), 병원 소유 확인, 클라이언트 필드 무시, 409 본문, 오류 표, 응답 버전·`origin` 요약, `Cache-Control: no-store`, 로그에 환자 조건 없음, 바깥 호출 없음.
- 파일(제안): `src/app/api/clinics/[slug]/catalog/route.ts`, `src/app/api/clinics/[slug]/insurance/options/route.ts`, `src/app/api/clinics/[slug]/estimate/route.ts`, `src/server/estimate-service.ts`, `src/server/errors.ts`, `tests/api/*.test.ts`.
- 진입: M1, M3 종료. 종료: 닫는 AC 통과.
- 닫는 AC: AC-006f, AC-006g, AC-010d, AC-016e, AC-018a, AC-018b, AC-019a, AC-019b, AC-019c, AC-020a, AC-021a, AC-021b, AC-021c, AC-021d, AC-021e
- 검증 명령: `npx vitest run tests/api --coverage`, `npx tsc --noEmit`

### M5 키오스크 세션 저장소와 상태 기계 (화면 없이)

- 우선순위: High
- 범위: DD-07 상태와 전이표("처음으로" 입력 유무 규칙 포함), DD-08 무효화 표, DD-09 세션 식별자·요청 표시·취소·늦은 응답 버림, DD-10 무조작 타이머(가짜 시계), DD-11 복귀 정보, DD-13 완료 동선, DD-19 클라이언트 응답 처리 표, 저장소 금지 API 정적 검사, 병원별 무조작 정책 읽기.
- 파일(제안): `src/app/kiosk/state/machine.ts`, `src/app/kiosk/state/session-store.ts`, `src/app/kiosk/state/idle.ts`, `src/app/kiosk/state/request.ts`, `tests/kiosk/state/*.test.ts`.
- 진입: M1 종료(형식), M4의 응답 형식 확정. 종료: 닫는 AC 통과.
- 닫는 AC: AC-012g, AC-014a, AC-014b, AC-014d, AC-015a, AC-015b, AC-015c, AC-015d, AC-015h, AC-015i
- 증거만 내는 AC(unit 부분, M6에서 닫음): AC-012a, AC-012b, AC-012e, AC-012f, AC-012i, AC-014c, AC-014e, AC-014g, AC-015e, AC-015f, AC-015g, AC-015j, AC-016a(정적 검사 부분), AC-016c, AC-020b
- 이 마일스톤이 처음 쓰는 확인 항목: `completionHoldSeconds` 기본값(§E #12), 계산 요청 시간 제한 값(§E #21), "처음으로" 확인 규칙(§E #36). 답은 구현 착수 승인 전에 정해진다. 시험은 이 값들을 주입값으로 다룬다.
- 검증 명령: `npx vitest run tests/kiosk/state --coverage`

### M6 키오스크 화면

- 우선순위: High
- 범위: 시작·네 입력 단계·계산 중·결과 세 종류(보류 결과는 공통 컴포넌트로 구성)·통신 오류·계산 근거·필요 서류(세로·가로·원인 모름)·이용 완료, TimeoutDialog·ResetConfirm, 두 방향(임시 검토 크기) 배치, 큰 글자 보기 반응형, 접근성(포커스·모달), Pretendard와 대체 순서, 글자 대비, 테스트 데이터 표시, 뒤로 가기·페이지 캐시 초기화.
- 파일(제안): `src/app/kiosk/[clinicSlug]/page.tsx`, `src/app/kiosk/components/*.tsx`, `src/app/kiosk/screens/*.tsx`, `src/app/kiosk/styles/*`, `tests/e2e/kiosk/*.spec.ts`(e2e-tester).
- 진입: M4, M5 종료. 종료: 닫는 AC 통과(1080×1920, 1920×1080에서 실행한 E2E와 렌더링 근거).
- 닫는 AC: AC-007g, AC-010e, AC-012a, AC-012b, AC-012c, AC-012d, AC-012e, AC-012f, AC-012h, AC-012i, AC-013a, AC-013b, AC-013c, AC-013d, AC-013e, AC-013f, AC-014c, AC-014e, AC-014f, AC-014g, AC-015e, AC-015f, AC-015g, AC-015j, AC-016a, AC-016b, AC-016c, AC-016d, AC-016f, AC-017a, AC-017b, AC-017c, AC-017d, AC-017e, AC-017f, AC-017g, AC-020b
- 검증 명령(예시): e2e-tester가 정한 E2E 도구로 두 해상도 실행, 결과 스크린숏 보관.

### M7 관리자

- 우선순위: Medium
- 범위: 관리자 인증, 역할·권한 표, 병원 설정·무조작 정책·브랜드, 치료·가격·기본비용 관리와 카탈로그 게시·미리보기, 검토 요청 기록, 검토 담당자 화면(매핑 작성·승인·반려, 프로필·서류 규칙·약관 출처·보험사), 규칙 묶음 게시·중지, 플랫폼 운영자의 규칙 사용 범위 지정, 감사 기록, 병원 격리 시험, 키오스크 기기 설정(별도 인증)과 기기-병원 연결.
- 파일(제안): `src/app/admin/**`, `src/app/api/admin/**`, `src/server/auth/*.ts`, `src/server/permissions.ts`, `tests/admin/*.test.ts`, `tests/e2e/admin/*.spec.ts`.
- 진입: M3, M4 종료. 관리자 인증 공급자(§E #2)와 기기-병원 연결 방식(§E #4)의 답(구현 착수 승인 전에 정함)을 처음 쓰는 마일스톤이다.
- 닫는 AC: AC-022a, AC-022b, AC-022c, AC-023a, AC-023b, AC-023c, AC-023d, AC-023e, AC-024a, AC-024b, AC-024c, AC-025a, AC-025b, AC-025c, AC-025d, AC-025e
- 검증 명령: `npx vitest run tests/admin --coverage`, E2E 관리자 경로.

### M8 운영 준비 자료 입력과 파일럿 (관문, 실제 데이터 필요)

- 우선순위: High(운영 개시 조건), 이 SPEC의 코드 산출물 아님.
- 범위: §E.1 보류 확정 자료의 입력과 승인(표준값 표 기입, 약관 출처 등록, 병원 실제 가격·행위 코드, 매핑 검토, 서류 규칙 검토), 병원별 규칙 사용 범위 지정, 준비 상태표 확인, 실제 설치 기기에서의 파일럿 점검(기획서 §10 5·6단계).
- 진입: §E.1 보류 자료 도착. 기기 규격(§E #5)과 호스팅(§E #3)의 답(구현 착수 승인 전에 정함)을 처음 쓰는 마일스톤이다.
- 닫는 AC: AC-016g, AC-017h, AC-017i(기록 전용)
- 종료 조건(완료 정의 4): 준비 상태표(DD-23)를 출력해, 운영할 칸만 `READY`이고 나머지는 `NOT_READY`로 보고되며, `READY` 칸마다 검토 담당자의 계산 예제-약관 대조 기록이 있다.

## §C 위험과 대응

| ID | 위험 | 대응 |
|----|------|------|
| R-01 | 값이 없는 칸을 채우려는 유혹(인접 값, 평균, 예시값 승격) | 엔진 숫자 상수 검사(AC-001c), 구성별 출처 제한(AC-010), 칸 대체 금지 시험(AC-008d) |
| R-02 | 시험 자료가 운영으로 새어 나감 | 가져오기 경계 검사(AC-010b), 게시 거절(AC-010c), 출처 요약과 표시(AC-010d·e) |
| R-03 | 기술 스택 미확정으로 M3·M7이 막힘 | 저장소 인터페이스와 메모리 구현으로 진행, DB·인증은 어댑터로 나중에 연결 |
| R-04 | 공유 한도 배분·원 단위 처리가 실제 약관과 다를 수 있음 | 잠정 규칙임을 계산 근거에 남기고, 규칙마다 명시하게 해 기본값을 두지 않음 |
| R-05 | 실제 글꼴과 기기에서 잘림 | 구현된 화면의 렌더링(AC-017a·e)과 실기기(AC-017h)로만 판정, Pencil 결과를 근거로 쓰지 않음 |
| R-06 | 늦은 응답·페이지 캐시로 이전 환자 정보 노출 | 세션 표시와 취소, `no-store`, `pageshow` 처리, E2E와 실기기 시험(AC-016) |
| R-07 | 화면 동작 표가 커서 구현과 어긋남 | 상태 기계를 화면과 분리해(M5) 단위 시험으로 고정한 뒤 화면을 붙임(M6) |
| R-08 | 요구사항·수용기준이 Tier L 상한(각 25)에 닿아 있음 | 소유자 결정으로 SPEC 하나를 유지한다(§A.5). 범위를 넓히는 변경은 새 SPEC으로 낸다 |
| R-09 | 서류 규칙이 디자인 수용 한계(전용 줄 각 1줄)를 넘음 | 게시 검증으로 거절(AC-007f), 디자인 변경 요청은 §F |
| R-10 | 웹 UI 완료를 기기 잠금 완료로 오해 | AC-017i에서 기기 잠금을 웹 UI 기준 밖으로 따로 기록 |
| R-11 | 지원 범위 밖 계약(노후·유병력자·단체 실손, 전환 계약 등)의 환자가 다섯 카드 가운데 하나를 고르면 일반 규칙으로 계산됨 | 엔진은 판별하지 않으며 결과 문구 원칙·공통 안내로 개인 계약에 따라 달라질 수 있음을 알린다. 가려내는 방법은 §E #11 |
| R-12 | 2009.08~09 경계 계약 가입자가 가입일만 보고 2세대(C1)를 골라 일반 규칙으로 계산될 수 있음. 기획서 §3은 이 계약에 별도 도움말을 요구하지만 디자인에 프레임이 없다 | 키오스크는 가입일로 세대를 정하거나 제안하지 않는다(날짜 입력이 없음). 도움말 문구·위치는 §E #35, 디자인 후속은 §F 7번 |

## §D MX 태그 계획

| 종류 | 대상 | 이유 |
|------|------|------|
| `@MX:ANCHOR` | `estimate()` 진입점 | 키오스크 미리보기·서버·관리자 미리보기가 모두 부름(호출처 3곳 이상) |
| `@MX:ANCHOR` | `isUsable()` | 프로필·매핑·서류 규칙이 모두 이 판정 하나를 거침 |
| `@MX:ANCHOR` | `deriveDocuments()` | 서버 응답과 서류 화면의 단일 산출원 |
| `@MX:ANCHOR` | 서버 계산 처리기(`estimate-service`) | 공개 계산 API의 유일한 계산 경로 |
| `@MX:ANCHOR` | 키오스크 상태 기계 전이 함수 | 모든 화면 이동이 거침 |
| `@MX:WARN` | 무조작 타이머(시각 주입 경계) | 시계 의존, 서버 응답이 시간을 늘리지 않아야 함 |
| `@MX:WARN` | 계산 요청 모듈(취소, 세션 표시 비교) | 늦은 응답 노출 위험 |
| `@MX:WARN` | 세션 저장소 | 브라우저 저장소 금지 경계 |
| `@MX:WARN` | 운영 구성 진입점(`acceptedOrigins`) | 시험 자료 유입 경계 |
| `@MX:NOTE` | 공제 방식 4종, 허용 상수, 보류 판정 순서, 보류 줄 그룹 제외, 0원 의미, 공유 한도 배분, ReturnContext, 기본비용 포함 규칙 | 업무 규칙 근거(DD 번호) 기록 |
| `@MX:TODO` | RED 단계에서 아직 통과하지 못한 공개 함수 | GREEN에서 제거 |

## §E 확인 항목과 보류 자료

### E.1 보류 확정 자료 (소유자 결정 2026-10-14)

소유자 결정 2026-10-14: 아래 운영 자료는 자료가 생길 때까지 보류한다. **값을 추정하지 않으며 승인 자료가 들어올 때까지 보류한다.** 막는 마일스톤은 모두 M8이다. 그때까지 계산은 "확인 필요"이고 개발·시험은 `TEST_FIXTURE`로 한다.

| 번호 | 자료 | 막는 마일스톤 |
|------|------|---------------|
| 보류-01 | 세대·보험사 형태별 표준 공제·한도 값 표 (소유자 첨부 예정) | M8 |
| 보류-02 | 약관 출처와 첫 보험사·상품·담보 (원문, 조항·페이지, 개정일, 효력일) | M8 |
| 보류-03 | 보험사 형태가 규칙 선택에 쓰이는 방식과 농협 계열의 소속 형태 | M8 |
| 보류-04 | 병원 공식 명칭·로고·종별·실제 치료 목록·가격(전체 수가인지 본인부담인지)·공통 기본비용·행위코드 | M8 |
| 보류-05 | 신장분사치료의 보험분류 | M8 |
| 보류-06 | 보험사·상품·청구 금액 구간별 서류 요건, 소액 청구 시 진단서 생략 여부 | M8 |
| 보류-07 | 1세대 상해/질병 통원 공제 공식 (그때까지 엔진은 `PROFILE_FORMULA_UNSUPPORTED`로 보류) | M8 |
| 보류-08 | 2세대 정률 공제형의 판매 시기·유형별 비율 | M8 |
| 보류-09 | 3세대 기본 담보와 3대 비급여 공제·한도 공식 | M8 |
| 보류-10 | 규칙별 원 단위 처리(버림·반올림)와 선택형Ⅱ 합산 후 1회 처리 여부 (그때까지 기본값 없음) | M8 |
| 보류-11 | 배포 시점의 의료광고 규정 | M8 |

### 확인 항목 읽는 법

- 모든 확인 항목은 구현 착수 승인(plan→run 사람 게이트) 전에 풀려야 한다(이 문서 첫머리의 규칙). 이 SPEC 작성이 끝난 시점에 아래 확인 항목 36개는 **모두 미해결**이며, 구현 착수 승인 게이트에서 소유자에게 제시된다.
- "처음 필요"는 그 답이 처음 쓰이는 마일스톤을 뜻한다. 그 마일스톤까지 답을 미뤄도 된다는 뜻이 아니다.
- "SPEC 기본값"은 소유자가 받아들이면 그대로 쓸 수 있도록 이 SPEC이 적어 둔 값이다. 소유자 승인이 아니다. 기본값이 "없음"인 항목은 소유자가 답을 주거나 명시적으로 보류를 승인해야 한다.

### E.2 기술·기기
1. [NEEDS CLARIFICATION: 데이터베이스 제품] — 처음 필요: M3 DB 어댑터 · SPEC 기본값: 없음 (그 전까지는 메모리 구현으로 진행 가능)
2. [NEEDS CLARIFICATION: 관리자 인증 공급자] — 처음 필요: M7 · SPEC 기본값: 없음
3. [NEEDS CLARIFICATION: 호스팅] — 처음 필요: M8 (파일럿 배포) · SPEC 기본값: 없음
4. [NEEDS CLARIFICATION: 키오스크 기기와 병원의 연결 방식 (기기 식별자 / clinicSlug 경로 / 둘 다)] — 처음 필요: M7 · SPEC 기본값: 키오스크 경로 `/kiosk/{clinicSlug}`만 정함, 기기 식별자 사용 여부는 없음
5. [NEEDS CLARIFICATION: 키오스크 기기 규격·OS·브라우저·통신 환경] — 처음 필요: M8 (실기기 판정) · SPEC 기본값: 없음

### E.3 계산 규칙과 범위
6. [NEEDS CLARIFICATION: 보장 대상 비용 한도(COVERED_COST)의 계산식] — 처음 필요: M1.3 · SPEC 기본값: 보류
7. [NEEDS CLARIFICATION: 공유 한도 감액분의 그룹별 배분 방식] — 처음 필요: M1.3 · SPEC 기본값: `groupOrder` 순서
8. [NEEDS CLARIFICATION: 공통 기본비용도 보장 매핑이 필요하다는 SPEC 결정] — 처음 필요: M1.3 · SPEC 기본값: 필요
9. [NEEDS CLARIFICATION: 상해·질병 구분을 앞으로 금액 계산에도 쓸지] — 처음 필요: M1.1 · SPEC 기본값: 쓰지 않음
10. [NEEDS CLARIFICATION: 한도 없음으로 선언된 담보(UNLIMITED_DECLARED)를 운영 프로필에 쓸지] — 처음 필요: M1.3 · SPEC 기본값: 조항 참조가 있을 때만 허용
11. [NEEDS CLARIFICATION: 지원 범위 밖 계약을 가려내는 방법 (현재 디자인에 없음)] — 처음 필요: M1.1 · SPEC 기본값: 엔진은 판별하지 않고 결과 문구·공통 안내로만 알림(§C R-11)

35번과 36번은 2회차 감사 뒤에 더한 항목이라 번호가 뒤에 온다.

35. [NEEDS CLARIFICATION: 2009.08~09 경계 계약 별도 도움말(문구·표시 위치, 디자인에 프레임 없음)] — 처음 필요: M6 · SPEC 기본값: 없음 (기획서 §3은 별도 도움말을 요구한다. 문구와 위치가 정해질 때까지 기존 프레임은 이 도움말을 담지 않으며, 키오스크는 가입일로 세대를 정하거나 제안하지 않는다, §C R-12)

### E.4 화면·동작
12. [NEEDS CLARIFICATION: completionHoldSeconds 기본값] — 처음 필요: M5 · SPEC 기본값: 없음 (값이 없는 동안 시험은 주입값을 쓴다)
13. [NEEDS CLARIFICATION: 세대 확인 안내·계산 중·통신 오류 화면의 무조작 시간] — 처음 필요: M5 · SPEC 기본값: 100/120초
14. [NEEDS CLARIFICATION: 보류 결과 화면의 무조작 시간] — 처음 필요: M5 · SPEC 기본값: 160/180초
15. [NEEDS CLARIFICATION: 계산 근거·서류 화면의 160/180초 (기획서 2026-10-14 임시 결정, 실제 머무는 시간 미관찰)] — 처음 필요: M5 · SPEC 기본값: 160/180초
16. [NEEDS CLARIFICATION: 무조작 정책 저장 때 경고·초기화 최소 간격 20초를 하한으로 둘지] — 처음 필요: M7 · SPEC 기본값: 20초 하한, 무조작 정책에만 적용
17. [NEEDS CLARIFICATION: 초기화 때 큰 글자 보기를 끌지 유지할지] — 처음 필요: M5 · SPEC 기본값: 끔
18. [NEEDS CLARIFICATION: 서류 규칙을 쓸 수 없을 때 서류 화면 동작] — 처음 필요: M6 · SPEC 기본값: 서류 목록 대신 안내 문구를 보이고 "결과로 돌아가기"·"이용 완료"와 공통 "처음으로"는 그대로 둠(기획서 §4 서류 화면 구성과 같음), 결과 화면의 여섯 동작 유지
19. [NEEDS CLARIFICATION: 서류 규칙의 상해·질병 전용 줄 한계(각 1줄)] — 처음 필요: M3 · SPEC 기본값: 게시 거절
20. [NEEDS CLARIFICATION: 통신 오류 화면 "이용 종료"의 도착지] — 처음 필요: M5 · SPEC 기본값: 지운 뒤 `K06_Complete`
21. [NEEDS CLARIFICATION: 계산 요청 시간 제한 값] — 처음 필요: M5 · SPEC 기본값: 없음 (시간 초과는 `FAILED`로 처리한다는 규칙만 있음)
22. [NEEDS CLARIFICATION: 테스트 데이터 표시 문구] — 처음 필요: M6 · SPEC 기본값: 없음
23. [NEEDS CLARIFICATION: 환자용 보류 분류 문구와 보류 안내 문구의 최종 표현] — 처음 필요: M6 · SPEC 기본값: DD-21 초안
24. [NEEDS CLARIFICATION: 보류 결과 화면에 결과 문구 원칙 대신 개인 계약 조건 문장만 쓰는 결정] — 처음 필요: M6 · SPEC 기본값: DD-07
25. [NEEDS CLARIFICATION: 시작 화면 버튼 문구 ("시작하기" 대 "실손 예상 부담액 확인")] — 처음 필요: M6 · SPEC 기본값: 기획서의 "시작하기"
26. [NEEDS CLARIFICATION: 기획서 §7의 "결과 화면 유지 시간" 뜻] — 처음 필요: M7 · SPEC 기본값: 결과 화면류의 경고·초기화 시간으로 해석
27. [NEEDS CLARIFICATION: 계산 근거 화면의 "디자인 예시입니다" 등 자리 표시 문구를 구현에서 뺄지] — 처음 필요: M6 · SPEC 기본값: 없음
28. [NEEDS CLARIFICATION: 소유자 확인: 저장된 파일의 프레임 ID (design-requirements 87행과 586행의 K01 프레임 ID 불일치)] — 처음 필요: M6 · SPEC 기본값: 프레임 이름 기준, 87행 ID 사용
29. [NEEDS CLARIFICATION: 구현 터치 영역 72 CSS px를 통과·실패 기준으로 쓰는 것] — 처음 필요: M6 · SPEC 기본값: 통과 기준

36. [NEEDS CLARIFICATION: "처음으로" 확인 창을 세션에 환자 입력이 하나라도 있을 때만 띄우는 해석 (기획서 §13.2 "진행 중에는 종료 확인")] — 처음 필요: M5 · SPEC 기본값: 입력이 하나라도 있으면 확인, 없으면 바로 시작 화면

### E.5 운영·조직
30. [NEEDS CLARIFICATION: 규칙 관리 업무 1·2·3·5의 검토 담당자/플랫폼 운영자 분담] — 처음 필요: M7 · SPEC 기본값: DD-17 권한 표(플랫폼 운영자는 기획서 §7 6번의 두 권한만 가짐)
31. [NEEDS CLARIFICATION: 작성자 본인 승인을 금지할지] — 처음 필요: M3 · SPEC 기본값: 허용하되 `selfApproval: true` 기록
32. [NEEDS CLARIFICATION: 1544-8069 운영 주체·상담 시간, 1588 전체 번호] — 처음 필요: M6 · SPEC 기본값: 문구로만 표시, 1588 미표시
33. [NEEDS CLARIFICATION: 공개 API 경로에 병원 slug를 넣는 SPEC 결정 (기획서는 /api/insurance/options, /api/estimate)] — 처음 필요: M4 · SPEC 기본값: `/api/clinics/{slug}/insurance/options`, `/api/clinics/{slug}/estimate`
34. [NEEDS CLARIFICATION: 매핑 작성 주체 (검토 담당자가 작성, 병원 관리자의 검토 요청은 요청 기록만 만듦)] — 처음 필요: M3 · SPEC 기본값: DD-17

합계: 확인 항목 36개, 모두 미해결(§E.2 5개, §E.3 7개, §E.4 19개, §E.5 5개). 이 가운데 SPEC 기본값이 없는 항목은 10개(#1, #2, #3, #4, #5, #12, #21, #22, #27, #35)이고 26개는 SPEC 기본값이 있다. 36개 모두 구현 착수 승인 게이트에서 소유자에게 제시된다. 보류 확정 자료 11건(§E.1)은 소유자가 승인한 보류이며 확인 항목이 아니다.

## §F 소유자에게 넘길 디자인 후속 항목과 선택 후속 항목

Pencil 수정은 소유자 몫이며 MoAI는 `design/design.pen`을 쓰지 않는다. 아래는 작은 후속 항목이며 구현을 막지 않는다.

1. (13-1) `ZZ_HandoffSpec` 행 `ZBdWg`의 문구를 "진입했던 결과 화면으로 복귀(보장 제외·가로형 포함)"로 정정. 결과 종류별 계산 근거 프레임은 요청하지 않는다(구현은 DD-11 공통 규칙).
2. (13-2) `K04_Result_Dialog_Timeout` (YcF5k) 배경 결과에 "보험 청구에 필요한 서류 확인" 버튼을 맞춤. 구현은 실제 화면 위에 TimeoutDialog를 띄우므로 영향 없음.
3. (13-4) 무조작 행(`QUcQ1`~`tNbyp`)에 계산 근거·서류 화면 160/180초를 추가. 새 프레임은 필요 없다.
4. 원인 모름 서류 화면이 전용 줄 2줄 이상을 담아야 하는 규칙이 생기면 그때 배치 변경을 요청(DD-06).
5. 요청하지 않는 것: 큰 글자 전용 프레임, 모달 배경 프레임, 결과 종류별 계산 근거 프레임, 보류 결과 프레임.
6. 선택 후속 항목(요구사항 아님): **플랫폼 운영자 긴급 중지** — 특정 병원의 규칙 묶음을 플랫폼 운영자가 즉시 멈추는 기능. 원문에 근거가 없어 이 SPEC에서 뺐다(소유자 결정 2026-10-14). 필요하면 별도 SPEC으로 낸다. 지금은 검토 담당자의 규칙 묶음 중지(DD-17)와 플랫폼 운영자의 규칙 사용 범위 재지정으로 대신한다.
7. (기획서 §3, product.md 67행) 2009.08~09 경계 계약 별도 도움말: 현재 디자인에는 이 도움말을 담은 프레임이 없다. 문구와 표시 위치(§E #35)가 정해지면 화면 1 또는 세대 확인 안내에 넣을 자리를 소유자가 Pencil에서 정한다. MoAI는 문구를 만들지 않는다.

## §G 기술 결정

| 항목 | 현재 | 결정 시점 |
|------|------|-----------|
| 시험 러너 | **Vitest (소유자 결정 2026-10-14, 확정)** | — |
| 가져오기 경계 검사 도구 | TypeScript 컴파일러 API로 가져오기를 읽는 시험, 또는 린트 규칙 | M1.4 |
| 애플리케이션 프레임워크 | Next.js App Router + TypeScript (후보) | M4 전 |
| 데이터베이스 | 미정 (관계형 DB 후보, §E #1) | M3 DB 어댑터 전 |
| 관리자 인증 공급자 | 미정 (§E #2) | M7 전 |
| 호스팅 | 미정 (§E #3) | M8 |
| E2E 도구 | e2e-tester가 선택 | M6 전 |
| Pretendard 적용 방식 | 기기 설치 또는 웹폰트 (기기 정보 §E #5 필요) | M6 |
