# 보담 가격 게시 → 키오스크 계산 검증

운영과 분리된 데모입니다. 기존 보담의 관리자 UI와 키오스크 UI를 같은 합성 치료 저장소에 연결합니다. 가격과 기본비용은 시험 자료이며 실제 병원 진료비나 보험금 안내에 쓰지 않습니다.

## 별도 Render 주소

`deploy/admin-kiosk-demo` 브랜치의 Blueprint는 **시험용 웹 서비스 하나**를 만듭니다. 기존 성정원통사의원 주소와 기존 비공개 베타는 연결하지 않습니다. Render가 발급한 새 HTTPS 주소의 첫 화면에서 바로 시작할 수 있습니다. **4세대(C4) → 손해보험사 → 원인 모름 → 물리치료**를 선택하면 **17,000원 / 16,000원 / 1,000원**이 나옵니다. 서버 시작 시 초안·미리보기·게시를 실제 서비스 경로로 완료해 이 기준을 복원합니다. 시연판에서만 이름을 ‘보담의원’, ‘물리치료’, ‘근골격계 초음파 검사’로 표시합니다. 이름과 짧은 ‘시연용’ 표시 외에 저장소 출처나 계산 규칙은 바뀌지 않습니다.

같은 주소의 `/demo/login`은 시험 관리자 전용입니다. Render 서비스 환경 설정이 생성한 `BODAM_DEMO_ADMIN_TOKEN`을 승인된 실사용자만 확인하여 입력합니다. 세션 쿠키는 HTTPS 전용이며 쓰기 요청은 동일한 HTTPS 출처만 받습니다. 주소나 메시지에 이 코드를 넣지 마세요.

새로 게시한 값은 서버가 실행되는 동안만 유지됩니다. 서버가 재시작되면 관리자는 다시 로그인하고 금액은 위 시험 기준으로 초기화됩니다. 운영 인증이나 영속 저장소가 필요한 배포에는 쓰지 않습니다.

## 로컬

저장소 루트에서 `npm ci` 후, 같은 터미널에서 아래를 실행합니다. 코드는 시연마다 새로 생성하며 서버가 로그에 기록하지 않습니다.

```sh
export BODAM_DEMO_ADMIN_TOKEN="$(node --input-type=module -e "import {randomBytes} from 'node:crypto'; process.stdout.write(randomBytes(32).toString('base64url'))")"
printf '%s' "$BODAM_DEMO_ADMIN_TOKEN" # 본인 시험 브라우저의 로그인 칸에 복사할 때만
npm run demo:admin-kiosk
```

Windows PowerShell:

```powershell
$env:BODAM_DEMO_ADMIN_TOKEN = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
Set-Clipboard -Value $env:BODAM_DEMO_ADMIN_TOKEN
npm run demo:admin-kiosk
```

종료 후 환경 변수와 클립보드에서 코드를 지우세요.

1. [검증 메뉴](http://127.0.0.1:3419/) → 시험 관리자 → 코드 붙여넣기. `시험 치료 A`를 **10,000원 → 12,000원**으로 수정해 초안 저장합니다.
2. 키오스크에서 **4세대(C4) → 손해보험사 → 원인 모름 → 시험 치료 A 1개**를 고릅니다. 초안만 저장한 때는 시험 기본비용 5,000원을 포함해 **병원 결제액 15,000원**입니다.
3. 관리자에서 미리보기 계산 → 게시. 키오스크를 새로 열고 같은 선택을 하면 병원 결제액 **17,000원**, 예상 보험금 **16,000원**, 보험금 반영 후 부담액 **1,000원**이 나옵니다.
4. 새 치료 추가·초안 저장·미리보기·게시도 가능합니다. 새 치료는 보장 분류 미검토로 등록되므로 병원비는 보여도 보험금은 산출 보류입니다. 단순 게시가 보장 승인으로 바뀌지 않습니다.

명령 검증: `npm run build` 후 `npm run demo:admin-kiosk:check`. Chromium이 있는 경우 `npm run demo:admin-kiosk:check -- --browser`로 관리자와 키오스크 클릭 흐름까지 확인할 수 있습니다(`BODAM_DEMO_CHROMIUM_PATH`로 시스템 Chromium 실행 파일 지정 가능).

로컬 시험 앱은 `127.0.0.1`에만 바인딩합니다. 브라우저를 새로 열어도 같은 서버에서 게시 값이 유지되지만, 서버를 끄면 메모리의 세션과 등록 내용은 초기화됩니다. `npm run demo:admin-kiosk:check -- --hosted`는 Render 설정을 모의해 시작 금액과 세션 응답을 확인합니다.
