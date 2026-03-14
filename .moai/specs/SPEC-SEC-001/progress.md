---
id: SPEC-SEC-001
document: progress
version: 1.0.0
status: draft
created: 2026-03-14
updated: 2026-03-14
author: zuge3
tags: [security, compliance, rate-limiting, PIPA, OWASP]
---

# SPEC-SEC-001: 진행 상황 추적 (Progress Tracking)

## 전체 진행률

| 마일스톤 | 상태 | 진행률 | 비고 |
|---|---|---|---|
| M1: API Rate Limiting | Not Started | 0% | Primary Goal |
| M2: PIPA Compliance | Not Started | 0% | Primary Goal |
| M3: API Security Hardening | Not Started | 0% | Secondary Goal |
| M4: Secret Management | Not Started | 0% | Secondary Goal |
| M5: Security Audit | Not Started | 0% | Final Goal |

## 마일스톤별 상세 진행

### M1: API Rate Limiting

- [ ] Rate Limiting Middleware 구현 (`backend/app/core/rate_limit.py`)
- [ ] Redis Sliding Window 알고리즘 구현
- [ ] IP 추출 로직 (X-Forwarded-For 지원)
- [ ] 엔드포인트 그룹별 제한 설정
- [ ] 응답 헤더 주입 (X-RateLimit-*)
- [ ] 429 응답 + Retry-After 헤더
- [ ] 사용자별 일일 채팅 제한 (Free Tier 100/일)
- [ ] 설정 외부화 (환경변수)
- [ ] 단위 테스트 작성
- [ ] 통합 테스트 작성

### M2: PIPA Compliance

- [ ] `DELETE /api/v1/users/me` 엔드포인트 구현
- [ ] 비밀번호 재인증 로직
- [ ] Cascade Delete 구현/검증
- [ ] `GET /api/v1/users/me/data` 엔드포인트 구현
- [ ] 데이터 내보내기 JSON 직렬화
- [ ] Celery Beat 데이터 정리 태스크 구현
- [ ] 채팅 이력 1년 보존 정책
- [ ] 시스템 로그 90일 보존 정책
- [ ] ConsentRecord 모델 생성
- [ ] 회원가입 동의 수집 연동
- [ ] 단위 테스트 작성
- [ ] 통합 테스트 작성

### M3: API Security Hardening

- [ ] SecurityHeadersMiddleware 구현
- [ ] CORS 정책 환경변수 기반 설정
- [ ] SQL Injection 방지 코드 감사
- [ ] 로그 마스킹 프로세서 구현
- [ ] XSS 방지 입력 sanitization
- [ ] 단위 테스트 작성
- [ ] 통합 테스트 작성

### M4: Secret Management

- [ ] 백엔드 `.env.example` 정비
- [ ] 프론트엔드 `.env.example` 정비
- [ ] 하드코딩 자격 증명 스캔
- [ ] 시크릿 로테이션 문서 작성

### M5: Security Audit

- [ ] OWASP Top 10 체크리스트 문서화
- [ ] GitHub Actions 보안 스캔 워크플로우
- [ ] pip-audit CI/CD 통합
- [ ] npm audit CI/CD 통합
- [ ] 인증 우회 테스트 케이스 작성
- [ ] 인가 경계 테스트 케이스 작성
- [ ] 전체 보안 감사 실행 및 결과 문서화

## 변경 이력

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-03-14 | 초기 progress 문서 생성 | zuge3 |
