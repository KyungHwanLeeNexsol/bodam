---
id: SPEC-CRAWLER-002
document: progress
version: 1.0.0
status: completed
created: 2026-03-17
updated: 2026-03-17
author: zuge3
tags: [crawler, insurance, individual-company, playwright]
---

# SPEC-CRAWLER-002: 진행 현황

## 전체 진행률: 100%

| 요구사항 | 상태 | 비고 |
|----------|------|------|
| REQ-01: 보험사 공시실 상품 탐색 | 완료 | GenericLifeCrawler, GenericNonLifeCrawler 구현 |
| REQ-02: 생명보험사 크롤러 (22개) | 완료 | 8개 전용 크롤러 + 10개 YAML Generic + 4개 미지원 문서화 |
| REQ-03: 손해보험사 크롤러 (12개) | 완료 | 12개 YAML Generic 크롤러 |
| REQ-04: 상품 판매 상태 분류 | 완료 | SaleStatus enum, PolicyListing 확장 |
| REQ-05: YAML 설정 | 완료 | 30개 YAML 설정 + Pydantic 검증 |
| REQ-06: 미탐색 14개 생보사 | 완료 | 10개 YAML 생성 + 4개 unsupported 문서화 |
| REQ-07: DB 자동 저장 | 완료 | PolicyIngestor + Alembic migration |

## 테스트 현황

- 단위 테스트: 113개 전체 통과
- 관련 테스트 파일: 12개

## 구현 산출물

- 전용 생명보험사 크롤러: 8개 (samsung, hanwha, kyobo, shinhan, nh, heungkuk, dongyang, mirae)
- 범용 크롤러: GenericLifeCrawler, GenericNonLifeCrawler
- YAML 설정: 30개 파일 (18 생보 + 12 손보)
- DB 마이그레이션: sale_status 컬럼 추가
- 미지원 보고서: config/unsupported_companies.md (4개사)

## 변경 이력

- 2026-03-17: SPEC 문서 작성 (v1.1.0)
- 2026-03-17: 구현 완료 확인 - 기존 코드에 모든 요구사항 이미 구현됨
- 2026-03-17: 레거시 테스트 3건 수정 (Playwright 전환 반영)

## 후속 발견 사항 (2026-03-18)

실제 수집 실행 시 발견된 문제:
- 생명보험사 YAML URL 대부분 404 또는 SPA 오류 (P0 버그 수정 커밋 cbb49d5 참조)
- KLIA 크롤러 3개 PDF만 수집 (SPA 구조 문제)

**전략 변경**: SPEC-CRAWLER-003 (pub.insure.or.kr)으로 생명보험 데이터 수집 전략 변경
