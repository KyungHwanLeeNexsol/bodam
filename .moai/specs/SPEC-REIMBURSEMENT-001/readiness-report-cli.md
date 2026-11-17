# 운영 준비 상태 보고 명령 (DD-23)

> 상태: Draft. 기준은 Draft PR #19 head `96ff93e`(`docs/SPEC-REIMBURSEMENT-001-pilot-readiness`)이고, 이 문서와 코드는 그 위의 별도 브랜치 `feature/SPEC-REIMBURSEMENT-001-readiness-cli`에 있다.
> 범위: 기존 `readReadiness`·`operatingReadinessContext`를 호출하는 읽기 전용 명령 하나. 판정 함수(`src/`)는 한 줄도 바꾸지 않았다.
> 이 명령은 운영 준비가 끝났다는 보고가 아니다. 입력은 빈 메모리 저장소와 기존 합성 시험 자료 둘뿐이고, 어느 쪽도 실제 병원 자료가 아니다.

`pilot-readiness-check.md`는 "준비 상태 판정 함수의 호출처가 시험 밖에 0건"이라고 적었다. 이 명령이 시험 밖의 첫 호출처이며, `tests/tools/`에만 있고 `src/`는 이 명령을 가져오지 않는다.

## 1. 실행 방법

```bash
# 빈 메모리 저장소 / 합성 시험 자료, 사람이 읽는 요약(기본) / JSON
npm run -s readiness:report -- --input empty   --at 2026-11-17
npm run -s readiness:report -- --input fixture --at 2026-11-17
npm run -s readiness:report -- --input empty   --format json --at 2026-11-17
npm run -s readiness:report -- --input fixture --format json --at 2026-11-17

# npm 없이 같은 명령
node --import ./tests/fixtures/engine/ts-resolve-register.mjs tests/tools/readiness-report-main.ts --input fixture --format json --at 2026-11-17
```

`-s`(조용히)를 빼면 npm이 표준 출력에 머리글 두 줄을 먼저 써서 JSON이 깨진다.

| 옵션 | 값 | 설명 |
|---|---|---|
| `--input` | `empty` · `fixture` (필수) | `empty` = 빈 메모리 저장소, `fixture` = 기존 합성 시험 자료(TEST_FIXTURE) 세계. 이 둘뿐이다 |
| `--format` | `text`(기본) · `json` | 사람이 읽는 요약 / DD-23의 S·P·M·D 전체와 병원별 계산·서류 판정 |
| `--at` | `YYYY-MM-DD` | 판정 기준일. 생략하면 실행 시점의 한국 표준시(Asia/Seoul) 날짜(`src/app/clock.ts`의 `systemToday`)를 쓰고, 보고에 `asOfSource: SYSTEM_CLOCK`으로 적는다 |

그 밖의 옵션(파일·JSON 가져오기, 연결 정보, 허용 출처 변경 등)은 없다. 알 수 없는 옵션·위치 인자·중복 옵션·잘못된 값은 모두 사용법 오류(종료 코드 2)다.

## 2. 입력과 평가 기준

- **평가 기준은 하나다.** `operatingReadinessContext(기준일)` 그대로: 규칙과 줄 모두 허용 출처 `OPERATING`만 받고, 해시는 `canonicalDigest`다. 시험 출처(`TEST_FIXTURE`·`DEMO`) 자료는 모두 사용 불가로 나온다. 다른 허용 출처를 고르는 길이 없고, 보고 JSON의 `evaluation.acceptedOrigins`에 실제 사용한 값이 적힌다.
- **입력은 둘이고 출력에서 구분된다.** `input.kind`가 `EMPTY_MEMORY_REPOSITORY` 또는 `SYNTHETIC_TEST_FIXTURE`이며, 둘 다 `input.isOperatingData: false`다. 글 보고의 `입력` 줄에도 같은 구분이 나온다.
- **합성 시험 자료**는 기존 `buildWorld()`(`tests/fixtures/server/estimate-world.fixture.ts`)가 서비스 경로로 만든 세계다: 병원 1곳, 치료 둘과 공통 기본비용 하나의 카탈로그, 4세대(C4)·손해보험사 칸 하나의 프로필, 매핑·서류 규칙 묶음. 전부 `TEST_FIXTURE` 출처다.
- **읽기 전용.** 판정 코드에는 `ReadinessReads`가 정한 읽기 메서드 열 개만 가진 객체를 넘기고, 실행 전후 저장소 전체 상태(`exportState()`)의 `canonicalDigest`를 맞대어 본다. 다르면 보고를 내지 않고 실행 오류(종료 코드 1)로 끝낸다. 두 해시는 보고에도 `readOnlyCheck`로 남는다.

## 3. 출력을 읽는 법

개별 표의 상태와 최종 판정은 다른 묶음에 담는다. 표 하나가 READY여도 최종 판정은 아닐 수 있다.

| JSON 위치 | 내용 |
|---|---|
| `platform.tableP` | 표 P 플랫폼 보기: 세대 5 × 보험사 유형 3 = 15칸, 모든 묶음 기준 |
| `clinics[].tables.S / P / M / D` | 개별 표. S 규칙 사용 범위·묶음 상태, P 프로필 15칸(병원 보기), M 치료별 매핑(줄 × 15칸), D 서류 규칙 |
| `clinics[].verdicts.calculationReady` | **최종 판정 1**: 계산 가능 여부. 세대 × 보험사 유형 15칸마다 한 행. NOT_READY이면 `stage`(S·P·TREATMENT·M)와 `code`(M 단계는 줄별 `lines[]`) |
| `clinics[].verdicts.documentReady` | **최종 판정 2**: 서류 안내 가능 여부. 병원마다 한 행. NOT_READY이면 `stage`(S·D)와 `code`, D 단계는 `detail` |
| `tableCounts`, `verdictCounts` | 위 행들의 READY / NOT_READY 개수 (보기 편의이며 새 판정이 아니다) |

계산 가능 여부와 서류 안내 가능 여부를 하나로 합친 키·문구는 없다(JSON 키 목록을 시험이 고정한다). 보고의 막힌 단계와 코드, 세부 사유는 `readReadiness`가 낸 값 그대로다.

## 4. 종료 코드

| 코드 | 뜻 | 표준 출력 | 표준 오류 |
|---|---|---|---|
| 0 | 보고를 만들었다. **내용이 NOT_READY여도 0이다** | 보고 | 비어 있음 |
| 1 | 실행 오류: 보고를 만들지 못했다 (읽기 전용 확인 실패, 저장소가 일관되지 않아 `readReadiness`가 거절 등) | 비어 있음 | `실행 오류: …` |
| 2 | 사용법 오류: 인자가 잘못되었다 | 비어 있음 | `사용법 오류: …` + 사용법 |

`--help`는 사용법을 표준 출력에 쓰고 0이다.

## 5. 출력 예시 (실제 실행 결과, 기준일 2026-11-17)

### 5.1 빈 메모리 저장소, 글

```text
$ npm run -s readiness:report -- --input empty --at 2026-11-17
보담 운영 준비 상태 보고 (DD-23 · 읽기 전용)
기준일        : 2026-11-17 (--at 인자)
평가 기준     : 허용 출처 OPERATING 만 (규칙 OPERATING / 줄 OPERATING). 시험 출처(TEST_FIXTURE·DEMO) 자료는 받지 않는다.
입력          : 빈 메모리 저장소 (병원·묶음·치료가 하나도 없다) [EMPTY_MEMORY_REPOSITORY] — 운영 자료가 아니다. 병원 0곳
읽기 전용 확인: 저장소 지문 실행 전 e0df78402113 · 실행 후 e0df78402113 → 같음

플랫폼 표 P (세대 5 × 보험사 유형 3 = 15칸, 모든 묶음 기준) : READY 0 / NOT_READY 15 — 개별 표이며 병원의 최종 판정이 아니다
  GEN1_AS/NON_LIFE  NOT_READY 코드=PROFILE_ABSENT
  GEN1_AS/LIFE  NOT_READY 코드=PROFILE_ABSENT
  … (같은 형식으로 13줄 더, 15칸 모두 PROFILE_ABSENT)
  GEN4_C4/MUTUAL_AID  NOT_READY 코드=PROFILE_ABSENT

병원 보고: 없음 (입력에 병원이 하나도 없다)

※ 최종 판정 두 가지(계산 가능 여부, 서류 안내 가능 여부)는 서로 독립이며 하나로 합치지 않는다. 개별 표의 상태는 최종 판정이 아니다. 이 보고는 입력 자료에 대한 것이며 실제 병원이나 운영 저장소의 상태가 아니다.
[종료 코드 0]
```

### 5.2 합성 시험 자료(TEST_FIXTURE)를 운영 기준으로 평가, 글

개별 표 S는 READY인데 최종 판정은 모두 NOT_READY다. 표 S는 "묶음이 쓸 수 있는 상태(ACTIVE)인가"만 보고, 출처는 표 P·M·D가 막는다.

```text
$ npm run -s readiness:report -- --input fixture --at 2026-11-17
보담 운영 준비 상태 보고 (DD-23 · 읽기 전용)
기준일        : 2026-11-17 (--at 인자)
평가 기준     : 허용 출처 OPERATING 만 (규칙 OPERATING / 줄 OPERATING). 시험 출처(TEST_FIXTURE·DEMO) 자료는 받지 않는다.
입력          : 기존 합성 시험 자료 세계 (TEST_FIXTURE 출처의 병원 1곳과 게시 자료) [SYNTHETIC_TEST_FIXTURE] — 운영 자료가 아니다. 병원 1곳
읽기 전용 확인: 저장소 지문 실행 전 318f7187fbc2 · 실행 후 318f7187fbc2 → 같음

플랫폼 표 P (세대 5 × 보험사 유형 3 = 15칸, 모든 묶음 기준) : READY 0 / NOT_READY 15 — 개별 표이며 병원의 최종 판정이 아니다
  GEN1_AS/NON_LIFE  NOT_READY 코드=PROFILE_ABSENT
  … (11줄 PROFILE_ABSENT)
  GEN4_C4/NON_LIFE  NOT_READY 코드=PROFILE_DEMO
  GEN4_C4/LIFE  NOT_READY 코드=PROFILE_ABSENT
  GEN4_C4/MUTUAL_AID  NOT_READY 코드=PROFILE_ABSENT

병원 TEST_FIXTURE_CLINIC_1 (test-fixture-clinic-1)
  [개별 표] 표마다 따로 본 상태다. 최종 판정이 아니다.
    표 S 규칙 사용 범위·묶음 상태 : READY ACTIVE 묶음=TEST_FIXTURE_BUNDLE_1
    표 P 프로필 칸(병원 보기)     : READY 0 / NOT_READY 15 (세대 5 × 보험사 유형 3 = 15칸)
    표 M 치료별 매핑              : 행 45개 — READY 0 / NOT_READY 45 — NOT_READY 코드: LINE_ORIGIN_NOT_ACCEPTED ×45
    표 D 서류 규칙                : NOT_READY 코드=RULES_UNAVAILABLE 세부=ORIGIN_NOT_ACCEPTED
  [최종 판정 1] 계산 가능 여부 — 세대 × 보험사 유형 15칸 : READY 0 / NOT_READY 15
    GEN1_AS/NON_LIFE  NOT_READY 막힌 단계=P 코드=PROFILE_ABSENT
    … (11줄 같은 형식)
    GEN4_C4/NON_LIFE  NOT_READY 막힌 단계=P 코드=PROFILE_DEMO
    GEN4_C4/LIFE  NOT_READY 막힌 단계=P 코드=PROFILE_ABSENT
    GEN4_C4/MUTUAL_AID  NOT_READY 막힌 단계=P 코드=PROFILE_ABSENT
  [최종 판정 2] 서류 안내 가능 여부 — 병원 단위 : NOT_READY 막힌 단계=D 코드=RULES_UNAVAILABLE 세부=ORIGIN_NOT_ACCEPTED

※ 최종 판정 두 가지(계산 가능 여부, 서류 안내 가능 여부)는 서로 독립이며 하나로 합치지 않는다. 개별 표의 상태는 최종 판정이 아니다. 이 보고는 입력 자료에 대한 것이며 실제 병원이나 운영 저장소의 상태가 아니다.
[종료 코드 0]
```

### 5.3 합성 시험 자료, JSON (배열은 앞쪽 행만 남기고 `…`로 줄임, 전체는 25,820바이트)

```json
{
  "schema": "bodam.readiness-report.v1",
  "asOf": "2026-11-17",
  "asOfSource": "ARGUMENT",
  "evaluation": { "acceptedOrigins": { "rules": ["OPERATING"], "lines": ["OPERATING"] }, "digest": "canonicalDigest" },
  "input": { "kind": "SYNTHETIC_TEST_FIXTURE", "description": "기존 합성 시험 자료 세계 (TEST_FIXTURE 출처의 병원 1곳과 게시 자료)", "isOperatingData": false },
  "readOnlyCheck": { "digestBefore": "318f7187fbc2…", "digestAfter": "318f7187fbc2…", "unchanged": true },
  "platform": {
    "tableP": [
      { "cell": { "generation": "GEN1_AS", "insurerType": "NON_LIFE" }, "status": "NOT_READY", "code": "PROFILE_ABSENT" },
      "… 15칸 …",
      { "cell": { "generation": "GEN4_C4", "insurerType": "NON_LIFE" }, "status": "NOT_READY", "code": "PROFILE_DEMO" }
    ],
    "tableCounts": { "READY": 0, "NOT_READY": 15 }
  },
  "clinics": [
    {
      "clinicId": "TEST_FIXTURE_CLINIC_1",
      "slug": "test-fixture-clinic-1",
      "tables": {
        "S": { "status": "READY", "value": "ACTIVE", "bundleId": "TEST_FIXTURE_BUNDLE_1", "contentHash": "2da1f38e…" },
        "P": [ { "cell": { "generation": "GEN4_C4", "insurerType": "NON_LIFE" }, "status": "NOT_READY", "code": "PROFILE_DEMO" }, "… 15칸 …" ],
        "M": [ { "treatmentId": "TEST_FIXTURE_BASE_FEE_A", "isBaseFee": true, "cell": { "generation": "GEN1_AS", "insurerType": "NON_LIFE" }, "status": "NOT_READY", "code": "LINE_ORIGIN_NOT_ACCEPTED" }, "… 45행 …" ],
        "D": { "status": "NOT_READY", "code": "RULES_UNAVAILABLE", "detail": "ORIGIN_NOT_ACCEPTED" }
      },
      "tableCounts": { "S": { "READY": 1, "NOT_READY": 0 }, "P": { "READY": 0, "NOT_READY": 15 }, "M": { "READY": 0, "NOT_READY": 45 }, "D": { "READY": 0, "NOT_READY": 1 } },
      "verdicts": {
        "calculationReady": [ { "cell": { "generation": "GEN4_C4", "insurerType": "NON_LIFE" }, "status": "NOT_READY", "stage": "P", "code": "PROFILE_DEMO" }, "… 15칸 …" ],
        "documentReady": { "status": "NOT_READY", "stage": "D", "code": "RULES_UNAVAILABLE", "detail": "ORIGIN_NOT_ACCEPTED" }
      },
      "verdictCounts": { "calculationReady": { "READY": 0, "NOT_READY": 15 }, "documentReady": { "READY": 0, "NOT_READY": 1 } }
    }
  ],
  "note": "최종 판정 두 가지(계산 가능 여부, 서류 안내 가능 여부)는 서로 독립이며 하나로 합치지 않는다. …"
}
```

위 발췌의 줄바꿈과 `…`는 읽기 쉽게 한 것이다. 실제 출력은 `JSON.stringify(view, null, 2)` 그대로이고, 빈 저장소의 JSON은 `clinics: []`에 플랫폼 15칸이 모두 `PROFILE_ABSENT`다(3,816바이트).

### 5.4 사용법 오류

```text
$ npm run -s readiness:report -- --input empty --json-file data.json
사용법 오류: 알 수 없는 옵션: '--json-file'
사용법: npm run -s readiness:report -- --input <empty|fixture> [--format <text|json>] [--at <YYYY-MM-DD>]
  …
[종료 코드 2, 표준 출력 비어 있음]
```

## 6. 검증 기록

모두 이 브랜치 작업 폴더(Windows 11, Node v24.22.1)에서 실행했다. 원본 출력은 `.moai/state/verify/readiness-cli/`(저장소에는 올리지 않는 폴더)에 남겼다.

| 확인한 것 | 명령 | 결과 |
|---|---|---|
| 판정 함수 불변 | `git diff HEAD --stat -- src` | 출력 없음 (`src/` 변경 0줄) |
| 타입 검사 | `npm run -s typecheck` | 종료 코드 0, 출력 없음 |
| 준비 상태·경계·도구 시험 | `npx vitest run tests/server/readiness tests/boundary tests/tools` | `Test Files 25 passed (25)` · `Tests 970 passed (970)` |
| 새 도구 시험만 | `npx vitest run tests/tools` | `Tests 52 passed (52)` |
| 전체 시험 | `npx vitest run` | `Test Files 1 failed \| 209 passed (210)` · `Tests 2 failed \| 10121 passed (10123)` — 실패 2건은 아래 §7 |
| 실제 명령, 두 입력 × 두 형식 | 위 §1의 네 명령 | 모두 종료 코드 0, 표준 오류 0바이트 (표준 출력: 빈 저장소 글 1,805 · JSON 3,816, 합성 자료 글 3,615 · JSON 25,820바이트). `node --import …` 직접 실행과 npm 실행의 출력이 바이트까지 같다 |
| 실제 명령, 사용법 오류 | `--json-file`, `--input` 없음 | 종료 코드 2, 표준 출력 0바이트 |
| 시험이 살아 있는가 (변이) | 명령 소스 12곳을 하나씩 망가뜨리고 `tests/tools` 실행 | 12곳 모두 시험이 실패. 처음에는 하나(막힌 단계 표기 삭제)가, 독립 검토 뒤에는 둘(읽기 전용 대리 객체 제거, 기본 날짜를 UTC로)이 통과해 시험을 보강한 뒤 12/12 |

새 도구 시험이 확인하는 것: 빈 저장소(병원 보고 비어 있음, 15칸 PROFILE_ABSENT) · 합성 자료를 운영 기준으로 평가하면 계산 15칸과 서류 판정이 모두 NOT_READY · 표 S는 READY인데 최종 판정은 NOT_READY(개별 표와 최종 판정의 구분) · 같은 자료를 시험 출처까지 받는 구성으로 읽으면 한 칸이 READY(NOT_READY의 원인이 출처임을 보임) · 보고가 `readReadiness` 결과와 같음 · JSON 키 목록 고정(합친 키 없음)과 합친 완료 문구 없음 · 실행 전후 저장소 상태·해시 동일, 판정 코드에 닿는 속성이 읽기 메서드 열 개뿐, 실행 중 저장소가 바뀌면 종료 코드 1 · 종료 코드 0·1·2 · 새 프로세스로 실행한 출력이 프로세스 안의 출력과 바이트까지 같음 · 명령 소스에 파일·네트워크·자식 프로세스·환경 변수·패키지·동적 가져오기가 없고 `src/`가 이 명령을 가져오지 않음.

## 7. 한계와 아직 확인하지 않은 것

- **전체 시험의 실패 2건은 이 변경과 무관하다.** `tests/kiosk/state/request-static.test.ts`의 두 시험이 `machine.ts` 줄을 `…},?$` 정규식으로 맞추는데, 이 PC의 작업 폴더는 줄바꿈이 CRLF(`core.autocrlf=true`)라 줄 끝의 `\r` 때문에 맞지 않는다. 손대지 않은 PR #18 작업 폴더(`bodam-wt-m7-settings`, `src`가 같다)에서도 같은 2건이 같은 이유로 실패하는 것을 확인했다. 고치지 않았다(범위 밖).
- **종료 코드 1은 실제 새 프로세스에서 만들지 못했다.** 실행 오류를 일으킬 입력 선택지가 일부러 없기 때문이다(읽기 전용 확인 실패와 깨진 저장소는 프로세스 안에서 저장소를 바꿔 끼워 확인했다). 새 프로세스로는 0과 2만 확인했다.
- **Windows 11에서만 실행했다.** Linux·macOS, 다른 Node 버전은 확인하지 않았다.
- **입력이 합성 자료 하나뿐이다.** 합성 세계에서는 계산 가능 여부의 막힌 단계가 전부 P다. S·M·TREATMENT·D 단계의 글 표기는 스냅샷 단위 시험으로만 확인했고, 실제 명령 출력 예시에는 나오지 않는다.
- **운영 자료가 없는 상태 자체는 바뀌지 않았다.** 이 명령은 운영 저장소를 읽지 못한다(읽는 길을 일부러 만들지 않았다). `pilot-readiness-check.md`가 적은 관리자 입력 경로 공백·운영 연결 부재는 그대로다.
- `--at`을 생략하면 한국 표준시 날짜를 쓴다. 날짜에 따라 합성 자료의 유효 기간 판정이 달라질 수 있으므로 비교할 때는 `--at`을 적는다.
- `npm run`을 `-s` 없이 쓰면 npm이 표준 출력에 머리글을 먼저 써서 JSON이 파싱되지 않는다. 사용법과 이 문서가 `-s`를 안내할 뿐 막지는 않는다.
- 실행 중 저장소가 바뀌었는지는 `readReadiness`가 정상 종료했을 때만 확인한다. 도중에 던지면 저장소 변경 여부와 무관하게 실행 오류(1)로만 보고한다(보고는 어느 쪽이든 나오지 않는다).

## 7.1 독립 검토

쓰기 가능한 에이전트(`manager-develop`)는 이 PC에서 git 설정 오류로 시작이 거절된 기록이 있어(`reference_tool_payload_unicode_escapes` 메모) 구현은 직접 했고, 읽기 전용 `Explore` 에이전트에게 코드와 요구 목록만 주고(제 결론은 주지 않고) 결함을 찾게 했다.

- Blocker·Major 없음. 시도했으나 결함을 찾지 못한 범주: 허용 출처·가져오기·저장소·네트워크 접근 경로, 합친 완료 신호와 막힌 단계 은폐, 종료 코드 의미와 표준 출력 오염, 읽기 전용 확인과 대리 객체 연결, 인자 해석 경계값(약 15개 입력을 실제로 실행).
- 반영한 지적: ① 기본 기준일이 서버 시간대(로컬)여서 UTC 서버에서는 한국 00~09시에 하루 전 날짜로 판정됨 → `src/app/clock.ts`의 `systemToday`(한국 표준시)를 쓰도록 바꿈 ② "출처 때문이다"를 보이는 시험이 두 읽기의 날짜를 다르게 썼음 → 같은 날짜로 ③ "쓰기 메서드에 닿지 않는다" 시험이 대리 객체가 있든 없든 통과하는 구조였음 → 대리 객체 자체의 속성을 직접 검사하고 대리 객체를 빼면 실패하게 ④ 항상 참인 종료 코드 비교 시험 삭제 ⑥ 플랫폼 표 P 줄에 "개별 표이며 병원의 최종 판정이 아니다" 표기 추가.
- 반영하지 않은 지적: ⑤ `-s` 없이 실행했을 때 npm 머리글 문제(npm 동작이며 위 한계에 기록), ⑦ `evaluation.digest`가 고정 문자열 `canonicalDigest`(운영 구성이 정하는 값과 같고 보고용 표시일 뿐).

## 8. 하지 않은 일

인증·DB·배포·실제 병원 데이터 입력·환자 화면(키오스크) 변경, 판정 함수와 `src/` 전체의 변경, 임의 JSON 가져오기, 운영 저장소 연결, 허용 출처를 바꾸는 옵션, 시험 자료의 변경.
