# M7 첫 기능 화면 사진 (2026-11-04)

`npm run preview:kiosk` 를 빌드부터 실제로 띄워 실제 Chrome 으로 한 번 끝까지 쓴 화면이다(요청 가로채기 없음, 실제 HTTP). 모든 병원 이름·가격·치료는 시험 자료(`TEST_FIXTURE`)이고, 맨 위 노란 띠(시험 데이터 안내)는 시험 앞단이 고정한 것이다. **육안 검토용**이며 시험 통과의 증거가 아니다(시험 결과는 `../progress.md` 의 "M7 첫 기능").

| 파일 | 내용 |
|------|------|
| `preview-1-login` | 시험 로그인 화면(시험 앞단에만 있다. 운영 구성에는 없다) |
| `preview-2-forbidden-rv` | 검토 담당자(RV)로 로그인해 병원 1 의 가격 관리 화면을 열면 권한 없음 안내(API 는 403) |
| `preview-3-prices-before` | 병원 1 관리자(HA): 기존 가격 확인 |
| `preview-4-draft-saved` | 치료 1 을 13,000원으로 고쳐 초안 저장(키오스크 가격은 아직 그대로) |
| `preview-5-preview-compare` | 미리보기: 현재 게시본과 초안 적용 시 계산을 같은 엔진으로 나란히(병원 결제액 15,000 → 18,000원) |
| `preview-6-published` | 게시 직후: 새 카탈로그 버전, 게시 이력 |
| `preview-kiosk-1-before` | 수정 전 키오스크 계산 결과(15,000원) |
| `preview-kiosk-2-draft-saved` | 초안 저장 뒤 키오스크 계산 결과(여전히 15,000원) |
| `preview-kiosk-3-after-publish` | 게시 뒤 키오스크 계산 결과(18,000원) |
| `preview-7-production-unavailable` | 운영 구성 그대로(앞단 없음): 인증 공급자가 연결되지 않아 관리자 문서는 200 이지만 모든 관리자 API 가 401, 화면은 안내만 보인다 |

- `preview-run-log.txt` 는 위 흐름을 실행한 스크립트의 확인 기록이다.
- 직접 열어 본 사진: `preview-5-preview-compare`, `preview-1-login`, `preview-2-forbidden-rv`, `preview-7-production-unavailable`, `preview-kiosk-1-before`. 나머지는 자동 단정(`tests/e2e/admin/price-flow.admin.spec.ts`)만 거쳤다.
- 로그인 화면 사진에는 고정 띠 위에 얇은 여백이 보인다(이후 `.band` 의 바깥 여백을 0 으로 고쳤고 사진은 다시 찍지 않았다).

# M7 치료 추가·숨김·순서 변경 화면 사진 (2026-11-04)

`npm run preview:kiosk:run`(빌드 후)으로 띄운 로컬 서버를 실제 Chrome 으로 한 번 끝까지 쓴 화면이다(요청 가로채기 없음, 실제 HTTP). 치료·병원·가격은 모두 시험 자료(`TEST_FIXTURE`)이고 맨 위 노란 띠는 시험 앞단이 고정한 것이다. **육안 검토용**이며 시험 통과의 증거가 아니다. 새 치료 "직접 확인용 새 치료"는 확인하려고 입력한 값이다. 자동 시험은 `tests/e2e/admin/catalog-structure.admin-catalog.spec.ts`(프로젝트 `admin-catalog`)다.

| 파일 | 내용 |
|------|------|
| `catalog-1-admin-before` | 병원 1 관리자(HA): 고치기 전 치료 목록(순서 1·2) |
| `catalog-2-edited-unsaved` | 새 치료를 더하고, 치료 B 를 숨기고, 새 치료를 위로 올린 화면(아직 저장 전) |
| `catalog-3-draft-saved` | 초안 저장 뒤. 키오스크 목록·가격·순서는 그대로다 |
| `catalog-4-preview` | 미리보기: 추가·숨김 변경 내역, 현재 게시본 / 초안 적용 후 목록. 새 치료는 "계산 보류 · 예상 보험금: 확인 필요" |
| `catalog-5-published` | 게시 직후: 새 카탈로그 버전, 새 목록·순서, 게시 이력(추가 1건 · 숨김 1건) |
| `catalog-kiosk-1-treatment-list` | 게시 뒤 키오스크 치료 선택: 새 치료가 맨 위, 숨긴 치료는 없다 |
| `catalog-kiosk-2-new-treatment-hold` | 새 치료만 골라 계산: "산출 보류", 예상 보험금·본인 부담은 숫자 없이 "확인 필요"(38,000원은 병원 창구 결제액이며 보험금이 아니다) |

- `catalog-run-log.txt` 는 위 흐름과 권한·거절 확인(22개 항목)의 실행 기록이다.
- 직접 열어 본 사진: `catalog-4-preview`, `catalog-5-published`, `catalog-kiosk-1-treatment-list`, `catalog-kiosk-2-new-treatment-hold`. 나머지는 스크립트 단정만 거쳤다.

# M7 보장 검토 요청 화면 사진 (2026-11-05)

병원 관리자(HA)가 게시된 치료에 검토를 요청하고, 검토 담당자(RV, 플랫폼 단위 소속)가 읽기 전용 대기열에서 확인하는 흐름이다. 자동 시험 `tests/e2e/admin/review-request.admin-review.spec.ts`(프로젝트 `admin-review`, 요청 가로채기 없음, 실제 HTTP)가 찍은 사진이고, 병원·치료·요청자는 모두 시험 자료(`TEST_FIXTURE`)다. **육안 검토용**이며 시험 통과의 증거가 아니다. 화면 문구는 소유자 확인 전의 임시 문구이고, 요청은 제안 기록일 뿐이라 치료 목록·분류·키오스크 계산을 바꾸지 않는다(시험이 전후 비교로 본다).

| 파일 | 내용 |
|------|------|
| `review-1-ha-list-before` | 병원 1 관리자(HA): 게시된 치료 둘, 둘 다 "요청 없음", 보낸 요청 없음 |
| `review-2-ha-form-filled` | 치료 A 의 검토 요청 입력칸: 급여 구분·행위 코드는 지금 값으로 시작하고 보험 계산 분류는 직접 골라야 한다(고르지 않으면 보내지 않는다) |
| `review-3-ha-request-sent` | 보낸 직후: "검토 요청됨 (대기 중)", 같은 치료의 요청 단추는 꺼짐, 보낸 요청 표에 제안한 값. 치료 목록의 값(급여)은 그대로다 |
| `review-4-rv-queue` | 검토 담당자: 병원·치료·요청자·상태, 현재 게시값과 병원이 제안한 값을 위아래로(달라지는 칸은 배경과 굵기). 승인·반려·매핑 단추가 없다 |
| `review-5-queue-forbidden-ha` | 병원 관리자가 대기열을 열면 "검토 담당자만 볼 수 있습니다"(API 는 403) |
| `review-6-requests-forbidden-rv` | 검토 담당자가 병원 1 의 검토 요청 화면을 열면 권한 없음 안내(API 는 403) |
| `review-7-ha-conflict-message` | 입력해 둔 사이에 같은 치료에 다른 세션이 먼저 요청을 보낸 경우(409): 요청이 만들어지지 않았다는 안내, 입력은 그대로, 목록 상태는 서버와 맞춰짐 |

- `review-run-log.txt` 는 이 기능의 확인 명령(tsc·api/server/boundary/admin 단위 시험·빌드·브라우저 시험 네 프로젝트)을 마지막 수정 뒤에 다시 실행한 출력과 종료 코드다. 전체 단위 시험의 실패 2건(`request-static`, 이 작업 폴더의 CRLF 줄바꿈 때문)은 이 단계와 무관하며 기록에 설명이 있다. 마지막 수정: 숨긴 치료의 요청은 대기열에 남되 "현재 게시값"이 "현재 게시 목록에 없음"으로 보인다(`current` 가 null).
- 직접 열어 본 사진: `review-2` ~ `review-7`. `review-1` 은 자동 단정(목록 두 줄이 "요청 없음", 보낸 요청 없음)만 거쳤다.
- 이 사진들은 시험 앞단의 고정 시계(2026-10-16 18:00)와 시험 계정으로 만들어졌다. 운영 인증·실제 병원 자료·매핑 작성/승인·규칙 묶음 게시는 이 단계에 없고 이 사진에도 없다.
