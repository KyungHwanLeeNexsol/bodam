---
id: SPEC-OPS-001
type: progress
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
author: zuge3
---

# SPEC-OPS-001: 진행 상황 추적 (Progress Tracking)

---

## 현재 상태: Draft

---

## Milestone 진행 현황

| Milestone | 상태 | 완료 태스크 | 총 태스크 | 진행률 |
|-----------|------|-----------|----------|--------|
| M1: Prometheus 메트릭 인프라 | Not Started | 0 | 5 | 0% |
| M2: Grafana 대시보드 | Not Started | 0 | 6 | 0% |
| M3: Loki 로그 수집 | Not Started | 0 | 4 | 0% |
| M4: AlertManager 알림 | Not Started | 0 | 3 | 0% |
| M5: Docker Compose 통합 및 보안 | Not Started | 0 | 4 | 0% |

---

## 태스크 상세 진행

### M1: Prometheus 메트릭 인프라

- [ ] Task 1.1: FastAPI 메트릭 미들웨어 구현
- [ ] Task 1.2: 커스텀 비즈니스 메트릭 계측
- [ ] Task 1.3: Celery worker 메트릭 노출
- [ ] Task 1.4: Prometheus 서버 설정
- [ ] Task 1.5: 외부 익스포터 설정

### M2: Grafana 대시보드

- [ ] Task 2.1: Grafana 데이터 소스 프로비저닝
- [ ] Task 2.2: Application Performance 대시보드
- [ ] Task 2.3: Infrastructure 대시보드
- [ ] Task 2.4: Business Metrics 대시보드
- [ ] Task 2.5: Celery Workers 대시보드
- [ ] Task 2.6: LLM/RAG Performance 대시보드

### M3: Loki 로그 수집

- [ ] Task 3.1: 구조화된 로깅 확장
- [ ] Task 3.2: Loki 서버 설정
- [ ] Task 3.3: Promtail 설정
- [ ] Task 3.4: Grafana Loki 탐색 검증

### M4: AlertManager 알림

- [ ] Task 4.1: Prometheus 알림 규칙 정의
- [ ] Task 4.2: AlertManager 라우팅 설정
- [ ] Task 4.3: 알림 테스트 및 검증

### M5: Docker Compose 통합 및 보안

- [ ] Task 5.1: Docker Compose 모니터링 profile 구성
- [ ] Task 5.2: 환경 변수 및 보안 설정
- [ ] Task 5.3: 데이터 보존 정책 설정
- [ ] Task 5.4: 통합 테스트 및 문서화

---

## 인수 기준 달성 현황

| AC ID | 설명 | 상태 |
|-------|------|------|
| AC-01 | FastAPI HTTP 메트릭 노출 | Not Tested |
| AC-02 | Celery worker 메트릭 노출 | Not Tested |
| AC-03 | Prometheus 스크레이핑 설정 | Not Tested |
| AC-04 | 커스텀 비즈니스 메트릭 수집 | Not Tested |
| AC-05 | PostgreSQL 익스포터 메트릭 | Not Tested |
| AC-06 | Redis 익스포터 메트릭 | Not Tested |
| AC-07 | Grafana 데이터 소스 프로비저닝 | Not Tested |
| AC-08 | 대시보드 프로비저닝 | Not Tested |
| AC-09 | 시간 범위 필터 | Not Tested |
| AC-10 | Grafana 관리자 권한 | Not Tested |
| AC-11 | 구조화된 JSON 로깅 | Not Tested |
| AC-12 | Promtail 로그 라벨 매핑 | Not Tested |
| AC-13 | request_id 추적 | Not Tested |
| AC-14 | LogQL 로그 검색 | Not Tested |
| AC-15 | Critical 알림 - 에러율 | Not Tested |
| AC-16 | Critical 알림 - P99 지연 시간 | Not Tested |
| AC-17 | Critical 알림 - 서비스 다운 | Not Tested |
| AC-18 | Warning 알림 | Not Tested |
| AC-19 | Business 알림 - 임베딩 정지 | Not Tested |
| AC-20 | Business 알림 - LLM 비용 | Not Tested |
| AC-21 | Docker Compose profile 기동 | Not Tested |
| AC-22 | 헬스체크 통과 | Not Tested |
| AC-23 | 영구 볼륨 데이터 유지 | Not Tested |
| AC-24 | 데이터 보존 정책 | Not Tested |
| AC-25 | /metrics 접근 제한 | Not Tested |
| AC-26 | Grafana 비밀번호 설정 | Not Tested |
| AC-27 | 알림 메시지 형식 | Not Tested |

---

## Iteration 기록

| Iteration | 날짜 | AC 달성 수 | 오류 수 | 메모 |
|-----------|------|-----------|---------|------|
| - | - | 0/27 | - | SPEC Draft 생성 완료 |

---

**SPEC-OPS-001 Progress** | 버전: 1.0.0
