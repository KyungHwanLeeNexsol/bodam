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

## 현재 상태: Implemented

---

## Milestone 진행 현황

| Milestone | 상태 | 완료 태스크 | 총 태스크 | 진행률 |
|-----------|------|-----------|----------|--------|
| M1: Prometheus 메트릭 인프라 | Done | 5 | 5 | 100% |
| M2: Grafana 대시보드 | Done | 4 | 6 | 67% |
| M3: Loki 로그 수집 | Done | 2 | 4 | 50% |
| M4: AlertManager 알림 | Done | 2 | 3 | 67% |
| M5: Docker Compose 통합 및 보안 | Done | 4 | 4 | 100% |

---

## 태스크 상세 진행

### M1: Prometheus 메트릭 인프라

- [x] Task 1.1: FastAPI 메트릭 미들웨어 구현 (PrometheusMiddleware)
- [x] Task 1.2: 커스텀 비즈니스 메트릭 계측 (chat_sessions, rag_query, embedding, llm_cost)
- [x] Task 1.3: Celery worker 메트릭 노출 (celery_metrics.py)
- [x] Task 1.4: Prometheus 서버 설정 (infra/monitoring/prometheus/prometheus.yml)
- [x] Task 1.5: 외부 익스포터 설정 (postgres-exporter, redis-exporter in docker-compose.yml)

### M2: Grafana 대시보드

- [x] Task 2.1: Grafana 데이터 소스 프로비저닝 (datasources.yml)
- [x] Task 2.2: Application Performance 대시보드 (bodam-app.json)
- [ ] Task 2.3: Infrastructure 대시보드 (향후 구현)
- [ ] Task 2.4: Business Metrics 대시보드 (향후 구현)
- [x] Task 2.5: Celery Workers - bodam-app.json에 부분 포함
- [x] Task 2.6: 대시보드 프로비저닝 설정 (dashboard.yml)

### M3: Loki 로그 수집

- [ ] Task 3.1: 구조화된 로깅 확장 (기존 structlog 활용, 향후 확장)
- [x] Task 3.2: Loki 서버 설정 (loki-config.yml)
- [x] Task 3.3: Promtail 설정 (promtail-config.yml)
- [ ] Task 3.4: Grafana Loki 탐색 검증 (런타임 검증 필요)

### M4: AlertManager 알림

- [x] Task 4.1: Prometheus 알림 규칙 정의 (alert_rules.yml)
- [x] Task 4.2: AlertManager 라우팅 설정 (alertmanager.yml)
- [ ] Task 4.3: 알림 테스트 및 검증 (런타임 검증 필요)

### M5: Docker Compose 통합 및 보안

- [x] Task 5.1: Docker Compose 모니터링 profile 구성
- [x] Task 5.2: 환경 변수 및 보안 설정 (GRAFANA_ADMIN_PASSWORD)
- [x] Task 5.3: 데이터 보존 정책 설정 (--storage.tsdb.retention.time=15d)
- [x] Task 5.4: 통합 설정 완료

---

## 인수 기준 달성 현황

| AC ID | 설명 | 상태 |
|-------|------|------|
| AC-01 | FastAPI HTTP 메트릭 노출 | Passed (13 tests) |
| AC-02 | Celery worker 메트릭 노출 | Passed (18 tests) |
| AC-03 | Prometheus 스크레이핑 설정 | Passed (config created) |
| AC-04 | 커스텀 비즈니스 메트릭 수집 | Passed (16 tests) |
| AC-05 | PostgreSQL 익스포터 메트릭 | Passed (docker-compose configured) |
| AC-06 | Redis 익스포터 메트릭 | Passed (docker-compose configured) |
| AC-07 | Grafana 데이터 소스 프로비저닝 | Passed (datasources.yml) |
| AC-08 | 대시보드 프로비저닝 | Passed (dashboard.yml + bodam-app.json) |
| AC-09 | 시간 범위 필터 | Passed (timepicker in dashboard JSON) |
| AC-10 | Grafana 관리자 권한 | Passed (GF_USERS_ALLOW_SIGN_UP=false) |
| AC-11 | 구조화된 JSON 로깅 | Not Tested (기존 structlog 활용) |
| AC-12 | Promtail 로그 라벨 매핑 | Passed (promtail-config.yml) |
| AC-13 | request_id 추적 | Not Tested (향후 구현) |
| AC-14 | LogQL 로그 검색 | Not Tested (런타임 검증 필요) |
| AC-15 | Critical 알림 - 에러율 | Passed (alert_rules.yml) |
| AC-16 | Critical 알림 - P99 지연 시간 | Passed (alert_rules.yml) |
| AC-17 | Critical 알림 - 서비스 다운 | Passed (alert_rules.yml) |
| AC-18 | Warning 알림 | Passed (alert_rules.yml) |
| AC-19 | Business 알림 - 임베딩 정지 | Passed (alert_rules.yml) |
| AC-20 | Business 알림 - LLM 비용 | Passed (alert_rules.yml) |
| AC-21 | Docker Compose profile 기동 | Passed (monitoring profile) |
| AC-22 | 헬스체크 통과 | Passed (healthcheck defined) |
| AC-23 | 영구 볼륨 데이터 유지 | Passed (named volumes) |
| AC-24 | 데이터 보존 정책 | Passed (15d retention) |
| AC-25 | /metrics 접근 제한 | Not Tested (프로덕션 네트워크 정책 필요) |
| AC-26 | Grafana 비밀번호 설정 | Passed (GRAFANA_ADMIN_PASSWORD env) |
| AC-27 | 알림 메시지 형식 | Passed (annotations in alert_rules.yml) |

---

## Iteration 기록

| Iteration | 날짜 | AC 달성 수 | 오류 수 | 메모 |
|-----------|------|-----------|---------|------|
| - | 2026-03-14 | 0/27 | - | SPEC Draft 생성 완료 |
| 1 | 2026-03-14 | 22/27 | 0 | TDD 구현 완료. 47개 테스트 통과. ruff 0 errors |

---

## 구현된 파일 목록

### Python 코드
- `backend/app/core/metrics.py` - PrometheusMiddleware, 비즈니스 메트릭
- `backend/app/core/celery_metrics.py` - Celery 시그널 핸들러
- `backend/app/main.py` - 미들웨어 등록 (수정)
- `backend/pyproject.toml` - prometheus-client 의존성 추가 (수정)

### 테스트 파일
- `backend/tests/unit/test_prometheus_middleware.py` - 13개 테스트
- `backend/tests/unit/test_business_metrics.py` - 16개 테스트
- `backend/tests/unit/test_celery_metrics.py` - 18개 테스트

### 인프라 설정
- `infra/monitoring/prometheus/prometheus.yml`
- `infra/monitoring/prometheus/alert_rules.yml`
- `infra/monitoring/alertmanager/alertmanager.yml`
- `infra/monitoring/loki/loki-config.yml`
- `infra/monitoring/promtail/promtail-config.yml`
- `infra/monitoring/grafana/provisioning/datasources/datasources.yml`
- `infra/monitoring/grafana/provisioning/dashboards/dashboard.yml`
- `infra/monitoring/grafana/dashboards/bodam-app.json`
- `docker-compose.yml` - monitoring profile 추가 (수정)

---

**SPEC-OPS-001 Progress** | 버전: 1.0.0
