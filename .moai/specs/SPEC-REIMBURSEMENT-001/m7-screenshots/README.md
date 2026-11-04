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
