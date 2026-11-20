# 성정원통사의원 환자 안내 화면

치료 목록과 실제 금액 자료가 없는 동안 사용할 수 있는 환자 안내 키오스크입니다. 첫 화면에서 ‘내 실손보험 확인하기’와 ‘진료비·청구 서류 안내’를 선택할 수 있습니다. 보험 가입 확인은 본인 휴대전화에서, 진료비와 서류 발급 확인은 실제 창구에서 하도록 안내합니다. 화면에서는 환자 정보 입력, 진료비·보험금 계산, 사례별 필수 서류 판정을 받지 않습니다.

로컬 확인: 저장소 루트에서 `python -m http.server 3419 --bind 127.0.0.1 --directory patient-kiosk/public` 실행 후 `http://127.0.0.1:3419/`를 엽니다.

Render: `deploy/seongjeongwon-patient-kiosk` 브랜치의 `render.yaml`로 **별도 Static Site**를 생성합니다. 게시 경로는 `patient-kiosk/public`이며 HTML과 CSS만 들어갑니다. 기존 `bodam-kiosk-beta` 서비스는 유지합니다. Render가 표시한 실제 주소에서 익명으로 첫 화면 → 두 메뉴 → 처음 화면으로 돌아오는 흐름과 `/beta/enter`, `/admin`, `/api/clinics/seongjeongwon/catalog`의 차단을 확인하고 병원 키오스크 시작 주소로 등록합니다.

안내 참고: [생명보험협회 가입 내역 조회](https://cont.insure.or.kr/cont_web/information/information.do), [손해보험협회 보험사 상담 안내](https://consumer.knia.or.kr/consumer/mCenter/ga2.do).

치료 목록·진료비와 적용할 약관이 확인되면, 운영 구성을 연결하고 계산과 서류 안내가 각각 준비된 범위부터 별도로 공개합니다.
