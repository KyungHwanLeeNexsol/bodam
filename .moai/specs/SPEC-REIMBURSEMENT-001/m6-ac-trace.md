# M6 키오스크 화면 — 수용 기준(AC) 추적표

SPEC-REIMBURSEMENT-001 · 마일스톤 M6 · 작성 2026-11-04 (이어받기 세션이 `feature/SPEC-REIMBURSEMENT-001-m6-kiosk-ui` 작업 트리에서 직접 실행한 결과 기준)

## 읽는 법

- 이 표는 "닫는 AC 50건(plan.md M6)"과, M6에서 닫지 않는 5건(M7 이전 증거 2건, M8 실기기 3건)을 **어느 시험 파일이 그 AC 이름을 가리키는가**로 연결한 대응표다. 표는 `acceptance.md`와 `tests/` 를 읽는 스크립트로 만들었고, 시험 파일의 "AC-017a·e·f" 같은 약식 표기는 풀어서 센다.
- 대응표는 "그 시험이 AC를 다룬다"는 이름 연결이지, 통과 여부를 말하지 않는다. 통과는 아래 "실행 결과"의 실제 실행이 정한다. 시험 이름과 AC 내용이 맞는지 한 건씩 다시 읽어 확인한 것은 아니다(미검증).
- 층: **U** vitest 단위·서버 렌더링·정적 검사 / **I** Playwright, 실제 Chrome, `/api/clinics/**` 를 시험 자료로 **가로채 응답**(실제 서버를 거치지 않음) / **R** Playwright, 시험용 앞단 서버가 **실제 핸들러**를 시험 자료(`TEST_FIXTURE`)로 돌림 / **P** 운영 구성 그대로 빌드한 앱 / **D** 개발 서버(React Strict Mode 켜짐)에서 가로채기 응답.
- I·R·P·D 는 모두 **시험 자료 점검**이다. 운영 자료 검증이나 실기기 검증이 아니다.

## 실행 결과 (2026-11-04, Windows 11, Node 24, 설치된 Chrome, 워커 1개)

| 확인 | 결과 |
|------|------|
| `npx tsc --noEmit` | 종료 0 |
| U `vitest run --coverage` | 161 파일 / 8388 시험 통과. `src/app/kiosk/state/**` 15 파일: 문장 454/454, 분기 441/441, 함수 163/163, 줄 368/368 |
| `next build` | 종료 0 |
| P 운영 구성 | 5 통과 (첫 실행에서 1건 실패 → 시험 쪽 경합 결함이라 시험을 고쳐 다시 5/5) |
| R 실제 핸들러 (세로·가로) | 27 + 27 통과, 12 + 12 건너뜀(`SHOTS=1` 일 때만 도는 사진 시험) |
| I 가로채기 (세로) | 756 통과, 67 건너뜀(사진 66 + 가로 전용 1) |
| I 가로채기 (가로) | 757 통과, 66 건너뜀(사진) |
| D 개발 서버 Strict Mode | 3 통과 |
| 사진 재생성 (`SHOTS=1`) | 156 통과, 사진 156장 (큰 글자 사진 도구 결함을 고친 뒤 실제 핸들러 사진 24장 재촬영) |

실패 0은 위 실행 시점의 값이다. 두 번 나눠 돌렸다: 층별 전체 실행(문구 변경·시험 수정 반영 코드) 뒤에 운영 구성 시험 수정분, Strict Mode 시험, 사진 도구 수정분만 따로 다시 돌렸다.

## AC별 대응

| AC | 요지 (acceptance.md) | 선언된 층 | 이 저장소의 시험 (층: 파일) | 구분 |
|----|----------------------|-----------|------------------------------|------|
| AC-007g | 전자는 서류 화면에 서류 목록 대신 안내 문구가 보이고 "결과로 돌아가기"·"이용 완료"와 공통 "처음으로"가 그대로 있으며(기획서 §4 서류 화면 구성), 결과 화면의 여섯 동작도 그대로다. 후자 | e2e-app | U: sheet-screens.test.tsx, sheet-boundary.test.ts, documents-view.test.ts<br>I: sheets.intercept.spec.ts<br>R: sheets.real.spec.ts | 시험 있음 |
| AC-007i | 모든 줄에 도달할 수 있고(분기별 묶음을 세로로 쌓거나 열을 늘리고, 그래도 들어가지 않으면 "이전 목록 / 다음 목록"으로 나눈다. SPEC 제안이며 최종 선택은 M6), 목록을 나누어도 줄이 빠 | render + e2e-app | U: sheet-handlers.test.tsx, sheet-screens.test.tsx, documents-view.test.ts<br>I: sheets-overlays.intercept.spec.ts, sheets.intercept.spec.ts<br>R: sheets.real.spec.ts | 시험 있음 |
| AC-010e | 화면 상단에 테스트 데이터 표시가 보이고, `OPERATING` 응답에서는 보이지 않는다. | render | U: result-screens.test.tsx, sheet-screens.test.tsx, basis-view.test.ts, documents-view.test.ts, result-view.test.ts<br>I: results.intercept.spec.ts, sheets.intercept.spec.ts<br>R: results.real.spec.ts, sheets.real.spec.ts | 시험 있음 |
| AC-012a | 시작 화면에 병원명과 서비스 표시명 "보담"이 보이고 이전 금액·선택이 없으며, "시작하기"는 언제나 빈 세션으로 화면 1을 열고, 단계 표시가 1/4 실손보험 · 2/4 보험사 형태 · 3/4 치 | unit + e2e-app | U: input-handlers.test.tsx, input-screens.test.tsx, display-and-selectors.test.ts, machine-transitions.test.ts, start-session.test.ts<br>I: input.intercept.spec.ts, start.intercept.spec.ts<br>R: input.real.spec.ts | 시험 있음 |
| AC-012b | "다음"이 비활성이고, 4단계에서 치료가 0개면 "예상 부담액 확인"이 비활성이다. | unit + e2e-app | U: input-handlers.test.tsx, input-screens.test.tsx, display-and-selectors.test.ts, machine-transitions.test.ts<br>I: input.intercept.spec.ts, treatments.intercept.spec.ts<br>R: input.real.spec.ts | 시험 있음 |
| AC-012c | 공제 유형·외래 한도·특약 질문, 상담 화면, "직원에게 문의" 버튼이 없고, "접수 직원에게 문의해 주세요"는 버튼 모양이 아닌 문장이며, "1588"이 없다. | e2e-app | U: input-handlers.test.tsx, input-screens.test.tsx<br>I: input.intercept.spec.ts, policy.intercept.spec.ts | 시험 있음 |
| AC-012d | 세대 확인 안내 화면이 열리고 "보험 세대가 특정되지 않으면 정확한 안내가 어렵습니다" 문장과 가입일 확인 방법, 1544-8069 문의 안내가 링크나 전화 연결 없이 문자로 보이며, 계산 요청이 | e2e-app | U: input-handlers.test.tsx, input-screens.test.tsx<br>I: input.intercept.spec.ts | 시험 있음 |
| AC-012e | 선택이 유지되고, 이미 고른 카드를 거듭 눌러도 수량이 늘지 않는다. | unit + e2e-app | U: input-handlers.test.tsx, input-screens.test.tsx, display-and-selectors.test.ts, machine-transitions.test.ts<br>I: treatments.intercept.spec.ts | 시험 있음 |
| AC-012f | 하단에 선택 4개, 급여 14,000 · 비급여 110,000 · 총 예상 결제액 124,000이 즉시 보인다. | unit + e2e-app | U: clinic.fixture.ts, input-handlers.test.tsx, input-screens.test.tsx, display-and-selectors.test.ts<br>I: treatments.intercept.spec.ts<br>R: input.real.spec.ts | 시험 있음 |
| AC-012h | "가입 시기를 모르실 때" 안내에 "보험증권이나 보험사 앱에서 가입일을 확인해 주세요. 확인이 어려우면 1544-8069로 문의해 주세요." 문구가 링크나 전화 연결 없이 문자로 있고, "확인 방법 | e2e-app | U: input-handlers.test.tsx, input-screens.test.tsx<br>I: input.intercept.spec.ts<br>R: input.real.spec.ts | 시험 있음 |
| AC-012i | 날짜(가입일) 입력 요소가 없고, 어떤 경로에서도 가입일로 세대를 정하거나 특정 세대 카드를 제안·미리 선택하지 않는다. | unit + e2e-app | U: input-handlers.test.tsx, input-screens.test.tsx, display-and-selectors.test.ts, machine-transitions.test.ts<br>I: input.intercept.spec.ts, policy.intercept.spec.ts | 시험 있음 |
| AC-013a | 세 카드가 예상 병원 결제액 124,000 / 예상 보험금 114,000 / 보험금 수령 후 예상 본인 부담 10,000 순서이고, 세 번째 카드 보조 설명이 "보험금을 받은 뒤 남는 예상 부담액이 | render + e2e-app | U: result-screens.test.tsx, result-real-handler.test.tsx, result-view.test.ts<br>I: policy.intercept.spec.ts, results.intercept.spec.ts<br>R: results.real.spec.ts | 시험 있음 |
| AC-013b | 124,000 / 74,000 / 50,000, 제외 항목과 사유가 있고, "선택한 치료가 모두 보장 대상" 문장은 없으며 나머지 항목 기준의 가정 문장이 있다. | render + e2e-app | U: result-screens.test.tsx, result-real-handler.test.tsx, result-view.test.ts<br>I: policy.intercept.spec.ts, results.intercept.spec.ts | 시험 있음 |
| AC-013c | 예상 병원 결제액만 숫자이고 나머지 두 카드는 "확인 필요"이며 "0원"이 없다. 보류 줄은 환자용 분류 문구로 묶여 보이고 내부 코드(`PROFILE_`·`MAPPING_`·`LINE_` 등)와 | render + e2e-app | U: result-handlers.test.tsx, result-screens.test.tsx, result-boundary.test.ts, hold-reasons.test.ts, result-real-handler.test.tsx, result-view.test.ts<br>I: policy.intercept.spec.ts, results.intercept.spec.ts<br>R: results.real.spec.ts | 시험 있음 |
| AC-013d | HTTP 500 `INTERNAL_ERROR`이고 응답에 금액이 없으며 스택·필드 값·내부 코드 같은 내부 상세가 새지 않는다. (키오스크의 5xx 처리는 `AC-013d`가 이미 다룬다.) 같은 | 가 이미 다룬다. | U: result-screens.test.tsx, request-lifecycle.test.ts, request-settle.test.ts<br>I: results.intercept.spec.ts | 시험 있음 |
| AC-013e | 각각 "보험 청구에 필요한 서류 확인", "계산 근거 보기", "치료 다시 선택", "보험 조건 수정", "처음으로", "이용 완료" 여섯 개가 모두 있다. | e2e-app | U: result-handlers.test.tsx, result-screens.test.tsx, result-view.test.ts<br>I: policy.intercept.spec.ts, results.intercept.spec.ts | 시험 있음 |
| AC-013f | "환자분의 실손은" 같은 확인 사실 표현과 "오늘 … 만 내면 됩니다" 같은 표현이 없다. | e2e-app | U: result-screens.test.tsx, sheet-screens.test.tsx, sheet-boundary.test.ts, basis-view.test.ts<br>I: policy.intercept.spec.ts, results.intercept.spec.ts, sheets.intercept.spec.ts<br>R: sheets.real.spec.ts | 시험 있음 |
| AC-014c | 금액 블록은 바이트 단위로 같고 서류 목록은 새로 산출되어 필요 줄이 바뀐다. | unit + e2e-app | U: sheet-screens.test.tsx, idle-timers.test.ts, documents-view.test.ts<br>I: results.intercept.spec.ts, sheets.intercept.spec.ts<br>R: sheets.real.spec.ts | 시험 있음 |
| AC-014e | 들어온 결과 종류(정상·보장 제외)로 돌아오고 선택·결과·금액이 그대로이며, 화면 방향과 큰 글자 상태는 복귀 시점의 최신 값을 따른다(들어올 때 기록한 값으로 되돌리지 않는다). 정상 결과로 고정 | unit + e2e-app | U: sheet-handlers.test.tsx, display-and-selectors.test.ts, invalidation.test.ts, machine-transitions.test.ts<br>I: results.intercept.spec.ts, sheets.intercept.spec.ts | 시험 있음 |
| AC-014f | 입력 확인값, "(가정)"을 붙인 프로필 값, 약관 출처, 계산 단계가 보이고, 보장 제외 결과에서 들어온 경우 제외 항목과 사유가 함께 보인다. | e2e-app | U: sheet-screens.test.tsx, basis-view.test.ts<br>I: sheets.intercept.spec.ts<br>R: sheets.real.spec.ts | 시험 있음 |
| AC-014g | 원인 상해·질병은 `K07_Documents`, 모름은 `K07_Documents_Unknown`으로 가며 들어온 결과 종류와 무관하다. | unit + e2e-app | U: result-handlers.test.tsx, sheet-handlers.test.tsx, machine-transitions.test.ts, documents-view.test.ts<br>I: results.intercept.spec.ts, sheets.intercept.spec.ts<br>R: sheets.real.spec.ts | 시험 있음 |
| AC-014h | 전환해도 그 화면에 머물고, 복귀한 결과 화면에 바꾼 설정이 남아 있으며, 결과 종류는 들어온 종류이고, 선택·결과·금액·`inputRevision`이 그대로이며, 계산 요청이 하나도 나가지 않는다 | unit + e2e-app — 상태 기계 증거는 M5, 닫는 곳은 M6 | U: sheet-handlers.test.tsx, display-and-selectors.test.ts, machine-transitions.test.ts<br>I: results.intercept.spec.ts, sheets.intercept.spec.ts | 시험 있음 |
| AC-014i | 들어온 결과 종류의 세로형 화면이 나오고, 선택·결과·금액·`inputRevision`이 그대로이며, 방향을 바꾸는 동안 계산 요청이 하나도 나가지 않는다. | unit + e2e-app — 상태 기계 증거는 M5, 닫는 곳은 M6 | U: sheet-handlers.test.tsx, display-and-selectors.test.ts, machine-transitions.test.ts<br>I: results.intercept.spec.ts, sheets.intercept.spec.ts | 시험 있음 |
| AC-015e | 누를 때마다 시간이 다시 시작하고 직전 화면(겹침창 아래의 화면)으로 돌아온다. **When** 같은 TimeoutDialog에서 "처음으로"를 누르면 **Then** ResetConfirm이 뜨지 | - | U: home-and-overlays.test.ts, idle-timers.test.ts<br>I: overlays.intercept.spec.ts | 시험 있음 |
| AC-015f | `K06_Complete`가 그려지기 전에 세션 저장소가 비어 있고, `K06_Complete`에 이전 선택·금액이 없으며, `completionHoldSeconds` 뒤 또는 "처음 화면으로"로 | unit + e2e-app | U: sheet-handlers.test.tsx, sheet-screens.test.tsx, idle-timers.test.ts, machine-transitions.test.ts, sheet-boundary.test.ts, complete-view.test.ts<br>I: results.intercept.spec.ts, sheets.intercept.spec.ts<br>R: sheets.real.spec.ts | 시험 있음 |
| AC-015g | 누를 때마다 시간이 다시 시작하고 직전 화면(겹침창 아래의 화면)으로 돌아온다. **When** 같은 TimeoutDialog에서 "처음으로"를 누르면 **Then** ResetConfirm이 뜨지 | - | U: home-and-overlays.test.ts, idle-timers.test.ts<br>I: input.intercept.spec.ts, overlays.intercept.spec.ts, results.intercept.spec.ts, sheets.intercept.spec.ts | 시험 있음 |
| AC-015j | ResetConfirm 없이 바로 `K00_Start`로 간다. | unit + e2e-app | U: home-and-overlays.test.ts, idle-timers.test.ts<br>I: input.intercept.spec.ts, overlays.intercept.spec.ts, results.intercept.spec.ts, sheets.intercept.spec.ts | 시험 있음 |
| AC-015k | ResetConfirm이 닫히고 TimeoutDialog가 열리며(두 겹침창이 동시에 열려 있는 순간이 없다) 선택값과 화면은 그대로이고, 초기화 시점은 ResetConfirm을 열려고 마지막으로 | - | U: home-and-overlays.test.ts, idle-expiry-controller.test.ts, idle-expiry.test.ts, idle-timers.test.ts<br>I: overlays.intercept.spec.ts, sheets.intercept.spec.ts | 시험 있음 |
| AC-015l | 두 순서 모두 환자가 보는 끝 화면이 같다: 결말에 따른 화면(결과 3종 가운데 해당, 갱신이 `RUNNING`인 `K03_Treatments`, `K03_Treatments`(`NO_TREATME | 와 같은 방식으로 비교 | U: results.ts, result-handlers.test.tsx, result-screens.test.tsx, idle-timers.test.ts, request-overlays.test.ts<br>I: overlays.intercept.spec.ts, results-overlays.intercept.spec.ts, results.intercept.spec.ts | 시험 있음 |
| AC-015m | 어느 것도 반영되지 않는다: 새 `sessionId`의 `K00_Start`가 그대로이고, 세션 저장소가 비어 있으며, `K06_Complete`를 거치지 않았고, 로딩 표시와 대기 타이머가 새 세 | unit + e2e-app — 규칙 3 | U: request-overlays.test.ts<br>I: results-overlays.intercept.spec.ts | 시험 있음 |
| AC-015n | (1) 응답은 밑 화면을 결과 화면으로 바꾸지만 `TimeoutDialog`는 열린 채 남고 초기화 시점은 응답이 오기 전에 정해진 시각 그대로이며(응답이 연장하지 않는다. SPEC 제안, 승인 전 | unit + e2e-app — 규칙 3·4 | U: request-overlays.test.ts<br>I: results-overlays.intercept.spec.ts | 시험 있음 |
| AC-015o | 두 경우 모두 환자가 보는 끝 화면이 결말에 따른 화면이다. 먼저 도착한 경우 "계속 사용할게요"를 누르면 `Calculating`이 아니라 이미 반영된 화면이 보이고, 나중에 도착한 경우 "계속 | unit + e2e-app — 규칙 1·2·4 | U: request-overlays.test.ts<br>I: results-overlays.intercept.spec.ts | 시험 있음 |
| AC-015p | `settleRequest(EXPIRED)`가 활성 요청·시간 제한 타이머·로딩 표시를 풀고 컨트롤러를 `abort()`하며 밑 화면이 `KXX_Error_Network`가 되고 겹침창은 열린 채 | unit + e2e-app — 규칙 5 | U: request-overlays.test.ts<br>I: results-overlays.intercept.spec.ts | 시험 있음 |
| AC-016a | localStorage·sessionStorage·IndexedDB·Cache Storage에 쓰기가 없고 서비스워커 등록이 없다. 키오스크 코드의 금지 API 정적 검사도 통과한다. | e2e-app + unit | U: exposure.ts, storage.ts, purity.test.ts, request-static.test.ts, kiosk-rules.ts, kiosk-tree.test.ts<br>I: exposure.intercept.spec.ts, results.intercept.spec.ts, sheets.intercept.spec.ts, start.intercept.spec.ts, storage.intercept.spec.ts | 시험 있음 |
| AC-016b | URL에 세대·형태·원인·치료가 없고, 분석 이벤트는 단계 수준 익명 필드만 담는다. | e2e-app | U: exposure.ts, kiosk-rules.ts, kiosk-tree.test.ts<br>I: exposure.intercept.spec.ts, lifecycle.intercept.spec.ts, results.intercept.spec.ts | 시험 있음 |
| AC-016c | 요청이 취소되었거나, 도착하더라도 활성 요청의 `requestId`와 일치하지 않아(`sessionId`·`inputRevision`도 다르다) 버려져 새 세션 화면이 바뀌지 않는다. | unit + e2e-app | U: request-lifecycle.test.ts<br>I: lifecycle.intercept.spec.ts, results.intercept.spec.ts | 시험 있음 |
| AC-016d | `K00_Start` 빈 세션이며 이전 결과가 보이지 않는다. | e2e-app | I: lifecycle.intercept.spec.ts, session.intercept.spec.ts | 시험 있음 |
| AC-016m | 전후 덤프가 같고 | 의 쓰기 없음과 함께 본다 | U: exposure.ts, ids.ts, storage.ts<br>I: exposure.intercept.spec.ts, results.intercept.spec.ts, sheets.intercept.spec.ts, storage.intercept.spec.ts<br>R: exposure.real.spec.ts | 시험 있음 |
| AC-017a | 버튼·금액·경고 문구가 잘리거나 겹치거나 화면 밖으로 나가지 않는다. | render | U: input.ts<br>I: layout.intercept.spec.ts, refresh.intercept.spec.ts, typography.intercept.spec.ts | 시험 있음 |
| AC-017b | 일반 모드와 금액·선택·기능이 같고(결과 여섯 동작, 서류 9줄과 체크·사유, 원인 모름 분기, 복귀 규칙), 공간이 모자란 목록은 페이지로 나뉘며 선택이 유지되고, 전환해도 현재 화면이 유지되며, | render + e2e-app | U: input.ts<br>I: flows.intercept.spec.ts, input.intercept.spec.ts, layout.intercept.spec.ts, refresh.intercept.spec.ts, treatments.intercept.spec.ts | 시험 있음 |
| AC-017c | 끝까지 완료된다. | e2e-app | I: flows.intercept.spec.ts | 시험 있음 |
| AC-017d | 모든 조작이 가능하고, 포커스 표시가 모든 조작 요소에서 색상만이 아닌 방식으로 보이며, 모달이 열리면 포커스가 모달 안에 갇히고 닫으면 연 위치로 돌아간다. | e2e-app | I: flows.intercept.spec.ts, input.intercept.spec.ts, modals.intercept.spec.ts, scroll.intercept.spec.ts | 시험 있음 |
| AC-017e | Pretendard가 실제로 적용되고, 웹폰트 로딩을 막으면 Noto Sans KR → 맑은 고딕 → 시스템 산세리프 순으로 대체되며, 잘림과 줄바꿈은 적용된 그 글꼴로 확인한다. Pencil 화면 | render | I: typography.intercept.spec.ts | 시험 있음 |
| AC-017f | 내부 코드, "N" 같은 기호, 내부 설계 설명, 외부 웹 링크가 없고, 주요 터치 영역이 72 CSS px 이상이다(통과 기준으로 쓰는 것은 SPEC 결정). | e2e-app | U: input.ts<br>I: layout.intercept.spec.ts, policy.intercept.spec.ts, typography.intercept.spec.ts | 시험 있음 |
| AC-017g | 일반 글자 4.5:1 이상, 큰 글자(24 px 이상, 또는 굵게 18.66 px 이상) 3:1 이상이고, 핵심 안내가 4.5:1에 못 미치면 그 목록을 보고한다. 예외는 로고, 정보가 없는 장식, | render | U: contrast.ts<br>I: contrast.intercept.spec.ts | 시험 있음 |
| AC-019c | 두 경로가 같은 엔진 모듈을 가져오고(모듈 동일성 시험) 병원 결제액이 같다. 키오스크의 합계 코드는 M5·M6에서 만들어지므로 M4는 서버 쪽 모듈 동일성만 증거로 내고 이 항목은 키오스크 화면이 | unit + integration | U: engine-module-identity.test.ts, input-screens.test.tsx, result-boundary.test.ts, result-real-handler.test.tsx, result-view.test.ts<br>I: results.intercept.spec.ts, treatments.intercept.spec.ts<br>R: input.real.spec.ts, results.real.spec.ts | 시험 있음 |
| AC-020b | (1)·(2)는 통신 오류 화면에 "다시 시도"와 "이용 종료", "계속 안 되면 접수 직원에게 문의해 주세요" 문장이 있고 금액 0원이 없으며 "다시 시도"가 새 요청을 보낸다; (3)은 `K03 | ~`AC-020i` | U: input-screens.test.tsx, refresh-integration.test.ts, refresh-lifecycle.test.ts, request-integration.test.ts<br>I: refresh.intercept.spec.ts | 시험 있음 |
| AC-020h | design.md DD-07 표 2대로다: 도착한 순간 밑 화면에 곧바로 반영되고(성공은 한 단계 반영과 확인 버튼 활성, 실패·시간 제한은 인라인 안내와 비활성 버튼) 겹침창은 열린 채 그대로이며 | 와 같은 방식 | U: refresh-overlays.test.ts<br>I: refresh.intercept.spec.ts | 시험 있음 |
| AC-020i | (1)·(2)는 통신 오류 화면에 "다시 시도"와 "이용 종료", "계속 안 되면 접수 직원에게 문의해 주세요" 문장이 있고 금액 0원이 없으며 "다시 시도"가 새 요청을 보낸다; (3)은 `K03 | ~`AC-020i` | U: contrast.ts, input-handlers.test.tsx<br>I: layout.intercept.spec.ts, refresh.intercept.spec.ts | 시험 있음 |
| AC-021g | `Cache-Control: no-store`다. 키오스크 화면이 만들어진 M6에서 닫는다. 계산 응답과 options 응답의 헤더는 `AC-021e`(M4)가 맡는다. | (M4 | U: kiosk-tree.test.ts<br>I: lifecycle.intercept.spec.ts<br>P: not-found.production.spec.ts | 시험 있음 |
| AC-016f | `/admin` 링크가 없고, 관리자 인증 정보가 없으며, 숨은 터치로 관리자 기능이 열리지 않는다. 관리자 인증과 `/admin` 경로가 생긴 뒤에야 "없다"가 의미를 가지므로, M6는 키오스크 | e2e-app | U: default-transport.test.ts<br>I: policy.intercept.spec.ts | M7 이전 증거만(닫지 않음) |
| AC-021d | 생성형 AI·모델 SDK가 없고, 계산 경로에서 저장소 외 바깥 네트워크 호출이 없다(네트워크 감시). 코드를 마지막으로 더하는 마일스톤(M7)에서 `src/` 전체를 한 번에 검사해 닫으며, M4 | unit + integration | U: engine-module-identity.test.ts, estimate-surface.test.ts, kiosk-dependencies.test.ts | M7 이전 증거만(닫지 않음) |
| AC-016g | 이전 환자 결과가 복원되지 않는다. | real-device | - | M8 실기기(M6에서 검증하지 않음) |
| AC-017h | Pretendard 적용과 잘림 없음이 실기기에서도 같다. | real-device | - | M8 실기기(M6에서 검증하지 않음) |
| AC-017i | 관찰 결과를 기록한다. 이 항목은 판정 없는 기록 전용이다. 기기 잠금·자동 실행은 웹 UI 수용기준이 아니며 별도로 기록한다. | real-device | - | M8 실기기(M6에서 검증하지 않음) |

닫는 AC 50건: 시험 있음 50, 시험 표기 없음 0. 별도: M7 이전 증거만 2건, M8 3건.

## 층 빈틈과 닫지 못한 것 (통과로 적지 않는다)

- **AC-007g, AC-013b**: R 층이 없다. 실제 핸들러 세계(`tests/e2e/harness/world.ts`)가 서류 규칙 없음(`RULES_UNAVAILABLE`)과 일부 보장 제외(`ESTIMATED_WITH_EXCLUSIONS`)를 만들 수 없다. U·I 에서만 본다.
- **AC-016b**: 분석 이벤트 내용은 시험할 수 없다. 화면 배선이 이벤트를 내보내지 않는다(없음은 정적 검사와 네트워크·콘솔·DOM·저장소 검사에 기댄다).
- **AC-016f, AC-021d**: M7 이전 증거로만 기록했다. 관리자 인증과 `/admin` 경로가 생긴 뒤에야 의미가 있다. **닫지 않았다.**
- **AC-016g, AC-017h, AC-017i**: M8 실기기 항목이다. **M6에서 검증하지 않았다.**
- 시험 자료만으로 운영 자료·실기기 기준은 완료 처리하지 않았다. 운영 저장소는 비어 있고 모든 병원 slug 는 404 이다.
- 통신 오류·409·422·시간 초과·늦은 응답은 I 층(가로채기)에서만 만들었다. 실제 HTTP 응답으로 만든 것이 아니다. 실제 HTTP 왕복(R, P)은 정상·보류·404 와 응답 헤더에 한정된다.
