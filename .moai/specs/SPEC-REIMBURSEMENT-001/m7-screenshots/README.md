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
