# 보담 가격 게시 → 키오스크 계산 검증

운영과 분리된 로컬 데모입니다. 기존 보담의 관리자 UI와 키오스크 UI를 같은 합성 치료 저장소에 연결합니다. 가격과 기본비용은 시험 자료이며 실제 병원 진료비나 보험금 안내에 쓰지 않습니다.

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

시험 앱은 `127.0.0.1`에만 바인딩하며 외부 배포용이 아닙니다. 브라우저를 새로 열어도 같은 서버에서 게시 값이 유지되지만, 서버를 끄면 메모리의 세션과 등록 내용은 초기화됩니다. 운영 인증, 실데이터, 영속 저장소와 연결하지 않습니다.
