# 성정원통사의원 환자 안내 화면

성정원통사의원 환자용 주소의 첫 화면은 저장소의 보담 시작 화면 `K00_Start` 및 `L_K00_Start`와 같은 `K00StartLayout`, 헤더, 색·글꼴·레이아웃을 사용합니다. 세로·가로 배치와 ‘큰 글자 보기’를 지원합니다. ‘시작하기’를 누르면 ‘내 실손보험 확인 방법’과 ‘진료비·청구 서류 안내’ 중에서 선택할 수 있습니다. 로그인이나 환자 정보 입력은 없으며, 병원 치료 자료가 확인될 때까지 치료 선택·계산·사례별 서류 판정은 제공하지 않습니다.

로컬 확인: 저장소 루트에서 `npm ci`, `npm run build:patient-kiosk`, `python -m http.server 3419 --bind 127.0.0.1 --directory dist-ssr/patient-kiosk`를 실행하고 `http://127.0.0.1:3419/`를 엽니다.

Render: 기존 `bodam-seongjeongwon-patient-kiosk` Static Site를 배포합니다. 게시 경로는 `dist-ssr/patient-kiosk`입니다. 브라우저에는 시작 화면 컴포넌트와 정적 안내만 보내고, 운영·베타 서버, API, 합성 카탈로그, 관리자 화면은 빌드 진입점에서 참조하지 않습니다. 공개 주소에서 익명으로 시작하기 → 안내 메뉴 → 두 안내 링크와 복귀가 되는지 확인합니다. `/beta/enter`·`/admin`·카탈로그 API는 열리지 않아야 합니다.

안내 참고: [생명보험협회 가입 내역 조회](https://cont.insure.or.kr/cont_web/information/information.do), [손해보험협회 보험사 상담 안내](https://consumer.knia.or.kr/consumer/mCenter/ga2.do).

치료 목록·진료비와 적용할 약관이 확인되면, 운영 구성을 연결하고 계산과 서류 안내가 각각 준비된 범위부터 별도로 공개합니다.
