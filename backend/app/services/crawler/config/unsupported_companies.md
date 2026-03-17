# 미지원 보험사 목록 (SPEC-CRAWLER-002 REQ-06)

크롤링이 불가능하거나 접근이 제한된 보험사 목록.
사이트 구조 파악 불가, 로그인 필요, 또는 API 기반 접근이 필요한 경우.

---

## 처브라이프 (Chubb Life Korea)

- **코드**: chubb-life
- **사이트**: https://www.chubblife.co.kr
- **사유**: 약관 공시 페이지가 로그인 후 접근 가능하거나 API 기반으로 추정됨. 셀렉터 검증 불가.
- **상태**: 검토 필요

---

## 카카오페이생명 (KakaoPay Life)

- **코드**: kakaopay-life
- **사이트**: https://life.kakaopay.com
- **사유**: 카카오페이 앱 기반 인터넷 전용 보험사. 웹 약관 공시 페이지가 React SPA로 구성되어 있어 Playwright가 필요하나 내부 API 엔드포인트 파악 불가.
- **상태**: 검토 필요 (API 역공학 분석 필요)

---

## 오렌지라이프 (Orange Life - 신한라이프 흡수합병)

- **코드**: orange-life
- **사이트**: 신한라이프(shinhanlife.co.kr)로 합병됨
- **사유**: 2021년 신한라이프에 흡수합병. 별도 크롤러 불필요. shinhan_life.yaml 사용.
- **상태**: 합병으로 별도 크롤러 불필요

---

## 한국생명보험 (Korea Life Insurance)

- **코드**: korea-life
- **사유**: 공식 운영 사이트 URL 확인 불가. 한국생명보험협회(klia.or.kr) 산하 여러 소규모 보험사 중 하나로 추정되나 독립 사이트 미확인.
- **상태**: 검토 필요 (사이트 URL 확인 후 YAML 추가 예정)

---

## 업데이트 이력

- 2026-03-17: 초기 목록 작성 (SPEC-CRAWLER-002 v1.1.0)
