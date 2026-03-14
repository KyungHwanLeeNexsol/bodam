---
id: SPEC-OPS-001
version: 1.0.0
status: draft
created: 2026-03-14
updated: 2026-03-14
author: zuge3
priority: high
issue_number: 0
tags: [observability, monitoring, prometheus, grafana, loki, alertmanager]
---

# SPEC-OPS-001: 프로덕션 모니터링 및 가시성 (Production Monitoring & Observability)

---

## Environment (환경)

### 프로젝트 컨텍스트

- **프로젝트**: Bodam (보담) - AI 기반 한국 보험 청구 안내 플랫폼
- **개발 인원**: 1명 (솔로 개발자)
- **현재 상태**: MVP 완료 (8개 SPEC 구현 완료), 프로덕션 런치 준비 단계
- **인프라 기반**: SPEC-INFRA-001 완료 (Docker Compose 기반 로컬 개발 환경)
- **개발 모드**: TDD (quality.yaml 설정)
- **목표**: 프로덕션 환경에서의 안정적 운영을 위한 모니터링 및 가시성 시스템 구축

### 기술 스택 (기존 인프라)

**백엔드:**
- Python 3.13.x, FastAPI 0.135.x, Pydantic 2.12.x
- Celery 5.x (Redis 브로커), structlog 24.x
- SQLAlchemy 2.x (asyncpg), PostgreSQL 18.x + pgvector 0.8.2
- Redis 7.x

**프론트엔드:**
- Next.js 16.1.x, React 19.2.x, TypeScript 5.x

**인프라:**
- Docker + Docker Compose
- GitHub Actions CI/CD

### 모니터링 스택 (신규 도입)

| 기술 | 버전 | 용도 |
|------|------|------|
| **Prometheus** | 2.53.x | 메트릭 수집 및 저장 (time-series database) |
| **Grafana** | 11.x | 대시보드 시각화 및 알림 관리 |
| **Loki** | 3.x | 로그 수집 및 집계 |
| **Promtail** | 3.x | 로그 수집 에이전트 (컨테이너 로그 -> Loki) |
| **AlertManager** | 0.28.x | 알림 라우팅 및 알림 전송 |
| **postgres_exporter** | 0.16.x | PostgreSQL 메트릭 익스포터 |
| **redis_exporter** | 1.x | Redis 메트릭 익스포터 |
| **prometheus_client** | 0.21.x | Python Prometheus 클라이언트 라이브러리 |

---

## Assumptions (가정)

### 기술 가정

- [A1] Docker Compose 환경에서 모든 모니터링 서비스를 함께 운영할 수 있다
- [A2] FastAPI 미들웨어를 통해 Prometheus 메트릭을 HTTP 엔드포인트로 노출할 수 있다
- [A3] Celery worker에서 Prometheus 메트릭을 별도 HTTP 서버를 통해 노출할 수 있다
- [A4] structlog 기반 JSON 로그를 Promtail이 수집하여 Loki로 전송할 수 있다
- [A5] Grafana가 Prometheus와 Loki를 동시에 데이터 소스로 사용할 수 있다
- [A6] postgres_exporter와 redis_exporter가 기존 PostgreSQL 18.x 및 Redis 7.x와 호환된다
- [A7] AlertManager webhook을 통해 Slack 또는 이메일 알림을 전송할 수 있다

### 비즈니스 가정

- [A8] MVP 단계에서는 로컬 Docker Compose 기반 모니터링으로 충분하다 (클라우드 관리형 서비스는 별도 SPEC)
- [A9] 초기에는 Slack webhook 기반 알림으로 시작하며, 추후 PagerDuty 등으로 확장 가능하다
- [A10] 모니터링 데이터 보존 기간은 기본 15일로 설정한다
- [A11] 비즈니스 메트릭 (챗 세션 수, RAG 쿼리 등)은 기존 structlog 기반 로깅을 Prometheus 메트릭으로 확장하여 수집한다

### 위험 가정

- [A12] 모니터링 서비스 추가로 인한 시스템 리소스 오버헤드가 MVP 운영에 영향을 주지 않는다
- [A13] Prometheus 스크레이핑 간격 15초가 실시간 모니터링에 충분하다

---

## Requirements (요구사항)

### 모듈 1: Prometheus 메트릭 수집

**REQ-OPS-001-01** (Ubiquitous)
시스템은 항상 FastAPI 애플리케이션에서 다음 HTTP 메트릭을 Prometheus 형식으로 `/metrics` 엔드포인트를 통해 노출해야 한다: 요청 총 수 (request_count), 요청 지연 시간 히스토그램 (request_latency_seconds), 응답 상태 코드별 카운터 (response_status_total), 활성 요청 수 (requests_in_progress).

**REQ-OPS-001-02** (Ubiquitous)
시스템은 항상 Celery worker에서 다음 메트릭을 Prometheus 형식으로 노출해야 한다: 태스크 큐 깊이 (celery_queue_length), 태스크 처리 시간 히스토그램 (celery_task_duration_seconds), 태스크 실패율 카운터 (celery_task_failures_total), 활성 워커 수 (celery_workers_active).

**REQ-OPS-001-03** (Event-Driven)
WHEN Prometheus 서버가 시작되면 THEN 모든 대상 서비스 (FastAPI, Celery, PostgreSQL, Redis)에 대한 스크레이핑 설정이 활성화되어야 한다.

**REQ-OPS-001-04** (Ubiquitous)
시스템은 항상 다음 커스텀 비즈니스 메트릭을 Prometheus 형식으로 수집해야 한다: 채팅 세션 수 (bodam_chat_sessions_total), RAG 쿼리 지연 시간 (bodam_rag_query_duration_seconds), 임베딩 파이프라인 처리량 (bodam_embedding_processed_total), LLM API 호출 비용 (bodam_llm_cost_usd_total), LLM API 응답 시간 (bodam_llm_response_duration_seconds).

**REQ-OPS-001-05** (Event-Driven)
WHEN postgres_exporter가 시작되면 THEN PostgreSQL 연결 수, 트랜잭션 처리율, 캐시 히트율, 테이블 크기 메트릭이 수집되어야 한다.

**REQ-OPS-001-06** (Event-Driven)
WHEN redis_exporter가 시작되면 THEN Redis 메모리 사용량, 연결 수, 명령 처리율, 키 수 메트릭이 수집되어야 한다.

### 모듈 2: Grafana 대시보드

**REQ-OPS-001-07** (Event-Driven)
WHEN Grafana가 시작되면 THEN Prometheus와 Loki가 자동으로 데이터 소스로 등록되어야 한다 (provisioning).

**REQ-OPS-001-08** (Event-Driven)
WHEN Grafana가 시작되면 THEN 다음 5개 대시보드가 자동으로 프로비저닝되어야 한다:
1. **Application Performance**: p50/p95/p99 지연 시간, 에러율, 처리량
2. **Infrastructure**: CPU, 메모리, 디스크 I/O (컨테이너 수준)
3. **Business Metrics**: 활성 사용자, 챗 세션, 보장 조회 수
4. **Celery Workers**: 태스크 큐, 처리 상태, 실패율
5. **LLM/RAG Performance**: 모델별 지연 시간, 토큰 비용, 정확도 메트릭

**REQ-OPS-001-09** (Ubiquitous)
시스템은 항상 Application Performance 대시보드에서 최근 1시간, 6시간, 24시간, 7일 범위의 시간 필터를 제공해야 한다.

**REQ-OPS-001-10** (State-Driven)
IF Grafana에 관리자 계정으로 접속 중이라면 THEN 대시보드 편집 및 알림 규칙 설정이 가능해야 한다.

### 모듈 3: Loki 로그 수집

**REQ-OPS-001-11** (Ubiquitous)
시스템은 항상 FastAPI, Celery worker, Next.js 서비스의 로그를 구조화된 JSON 형식으로 출력해야 한다.

**REQ-OPS-001-12** (Event-Driven)
WHEN 애플리케이션 로그가 생성되면 THEN Promtail이 다음 라벨과 함께 Loki로 전송해야 한다: service (서비스명), environment (환경), log_level (로그 수준), request_id (요청 추적 ID).

**REQ-OPS-001-13** (Ubiquitous)
시스템은 항상 각 HTTP 요청에 고유한 request_id를 생성하여 요청의 전체 생애주기를 추적할 수 있어야 한다.

**REQ-OPS-001-14** (State-Driven)
IF Grafana Explore 화면에서 Loki 데이터 소스를 선택하면 THEN LogQL 쿼리를 통해 서비스별, 로그 수준별, request_id별 로그를 검색할 수 있어야 한다.

### 모듈 4: AlertManager 알림 규칙

**REQ-OPS-001-15** (Event-Driven)
WHEN 에러율이 5%를 초과하면 THEN AlertManager가 **Critical** 수준 알림을 전송해야 한다.

**REQ-OPS-001-16** (Event-Driven)
WHEN p99 지연 시간이 3초를 초과하면 THEN AlertManager가 **Critical** 수준 알림을 전송해야 한다.

**REQ-OPS-001-17** (Event-Driven)
WHEN 서비스 (FastAPI, PostgreSQL, Redis)가 다운되면 THEN AlertManager가 **Critical** 수준 알림을 1분 이내에 전송해야 한다.

**REQ-OPS-001-18** (Event-Driven)
WHEN p95 지연 시간이 1초를 초과하면 THEN AlertManager가 **Warning** 수준 알림을 전송해야 한다.

**REQ-OPS-001-19** (Event-Driven)
WHEN 에러율이 1%를 초과하면 THEN AlertManager가 **Warning** 수준 알림을 전송해야 한다.

**REQ-OPS-001-20** (Event-Driven)
WHEN Celery 태스크 큐 깊이가 100을 초과하면 THEN AlertManager가 **Warning** 수준 알림을 전송해야 한다.

**REQ-OPS-001-21** (Event-Driven)
WHEN 임베딩 파이프라인이 30분 이상 처리를 중단하면 THEN AlertManager가 **Business** 수준 알림을 전송해야 한다.

**REQ-OPS-001-22** (Event-Driven)
WHEN LLM API 일일 사용 비용이 예산의 80%에 도달하면 THEN AlertManager가 **Business** 수준 알림을 전송해야 한다.

**REQ-OPS-001-23** (Ubiquitous)
시스템은 항상 AlertManager 알림에 서비스명, 심각도, 설명, 대시보드 링크를 포함해야 한다.

### 모듈 5: Docker Compose 통합

**REQ-OPS-001-24** (Event-Driven)
WHEN `docker compose --profile monitoring up`이 실행되면 THEN Prometheus, Grafana, Loki, Promtail, AlertManager, postgres_exporter, redis_exporter 서비스가 시작되어야 한다.

**REQ-OPS-001-25** (Ubiquitous)
시스템은 항상 모니터링 서비스를 Docker Compose profile (`monitoring`)로 분리하여, 모니터링 없이도 핵심 서비스만 실행할 수 있어야 한다.

**REQ-OPS-001-26** (Event-Driven)
WHEN 모니터링 서비스가 시작되면 THEN 각 서비스에 헬스체크가 정의되어 의존성 순서가 보장되어야 한다.

**REQ-OPS-001-27** (Ubiquitous)
시스템은 항상 모니터링 데이터를 Docker 볼륨에 영구 저장하여 컨테이너 재시작 시에도 데이터가 유지되어야 한다.

### 모듈 6: 보안 및 운영

**REQ-OPS-001-28** (Unwanted)
시스템은 `/metrics` 엔드포인트가 외부 네트워크에서 직접 접근 가능하지 않아야 한다.

**REQ-OPS-001-29** (Ubiquitous)
시스템은 항상 Grafana에 기본 관리자 비밀번호가 아닌 환경 변수로 설정된 비밀번호를 사용해야 한다.

**REQ-OPS-001-30** (State-Driven)
IF Prometheus 데이터 보존 기간이 15일을 초과하면 THEN 오래된 데이터는 자동으로 삭제되어야 한다.

---

## Specifications (세부 사양)

### S1: FastAPI 메트릭 미들웨어

```python
# backend/app/core/metrics.py
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.middleware.base import BaseHTTPMiddleware

# HTTP 메트릭
REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status_code"]
)
REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency",
    ["method", "endpoint"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)
REQUESTS_IN_PROGRESS = Gauge(
    "http_requests_in_progress",
    "Number of HTTP requests in progress",
    ["method", "endpoint"]
)

# 비즈니스 메트릭
CHAT_SESSIONS = Counter("bodam_chat_sessions_total", "Total chat sessions created")
RAG_QUERY_DURATION = Histogram(
    "bodam_rag_query_duration_seconds",
    "RAG query latency",
    buckets=[0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0]
)
EMBEDDING_PROCESSED = Counter("bodam_embedding_processed_total", "Total embeddings processed")
LLM_COST = Counter("bodam_llm_cost_usd_total", "Total LLM API cost in USD", ["model"])
LLM_RESPONSE_DURATION = Histogram(
    "bodam_llm_response_duration_seconds",
    "LLM API response time",
    ["model"],
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
)
```

### S2: Prometheus 스크레이핑 설정

```yaml
# infra/monitoring/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "/etc/prometheus/alert_rules.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

scrape_configs:
  - job_name: "fastapi"
    static_configs:
      - targets: ["backend:8000"]
    metrics_path: "/metrics"

  - job_name: "celery"
    static_configs:
      - targets: ["celery-worker:9808"]

  - job_name: "postgres"
    static_configs:
      - targets: ["postgres-exporter:9187"]

  - job_name: "redis"
    static_configs:
      - targets: ["redis-exporter:9121"]

  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
```

### S3: AlertManager 알림 규칙

```yaml
# infra/monitoring/prometheus/alert_rules.yml
groups:
  - name: critical_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "에러율 5% 초과"
          description: "{{ $labels.instance }}에서 에러율이 {{ $value | humanizePercentage }}입니다."
          dashboard: "http://grafana:3001/d/app-performance"

      - alert: HighP99Latency
        expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 3
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "P99 지연 시간 3초 초과"

      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "서비스 다운: {{ $labels.job }}"

  - name: warning_alerts
    rules:
      - alert: HighP95Latency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning

      - alert: ModerateErrorRate
        expr: rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: warning

      - alert: HighQueueDepth
        expr: celery_queue_length > 100
        for: 5m
        labels:
          severity: warning

  - name: business_alerts
    rules:
      - alert: EmbeddingPipelineStalled
        expr: rate(bodam_embedding_processed_total[30m]) == 0
        for: 30m
        labels:
          severity: business

      - alert: LLMCostApproachingBudget
        expr: sum(increase(bodam_llm_cost_usd_total[24h])) > 50 * 0.8
        for: 10m
        labels:
          severity: business
```

### S4: Docker Compose 모니터링 서비스

```yaml
# docker-compose.yml (monitoring profile 추가)
services:
  prometheus:
    image: prom/prometheus:v2.53.0
    profiles: ["monitoring"]
    ports: ["9090:9090"]
    volumes:
      - ./infra/monitoring/prometheus:/etc/prometheus
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=15d"
    depends_on:
      backend:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:9090/-/healthy"]
      interval: 10s
      timeout: 5s
      retries: 3

  grafana:
    image: grafana/grafana:11.0.0
    profiles: ["monitoring"]
    ports: ["3001:3000"]
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:-bodam_grafana_admin}
      GF_USERS_ALLOW_SIGN_UP: "false"
    volumes:
      - ./infra/monitoring/grafana/provisioning:/etc/grafana/provisioning
      - ./infra/monitoring/grafana/dashboards:/var/lib/grafana/dashboards
      - grafana_data:/var/lib/grafana
    depends_on:
      prometheus:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  loki:
    image: grafana/loki:3.0.0
    profiles: ["monitoring"]
    ports: ["3100:3100"]
    volumes:
      - ./infra/monitoring/loki/loki-config.yml:/etc/loki/local-config.yaml
      - loki_data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3100/ready"]
      interval: 10s
      timeout: 5s
      retries: 3

  promtail:
    image: grafana/promtail:3.0.0
    profiles: ["monitoring"]
    volumes:
      - ./infra/monitoring/promtail/promtail-config.yml:/etc/promtail/config.yml
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: -config.file=/etc/promtail/config.yml
    depends_on:
      loki:
        condition: service_healthy

  alertmanager:
    image: prom/alertmanager:v0.28.0
    profiles: ["monitoring"]
    ports: ["9093:9093"]
    volumes:
      - ./infra/monitoring/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:9093/-/healthy"]
      interval: 10s
      timeout: 5s
      retries: 3

  postgres-exporter:
    image: quay.io/prometheuscommunity/postgres-exporter:v0.16.0
    profiles: ["monitoring"]
    environment:
      DATA_SOURCE_NAME: "postgresql://bodam:${POSTGRES_PASSWORD:-bodam_dev_password}@postgres:5432/bodam?sslmode=disable"
    depends_on:
      postgres:
        condition: service_healthy

  redis-exporter:
    image: oliver006/redis_exporter:latest
    profiles: ["monitoring"]
    environment:
      REDIS_ADDR: "redis://redis:6379"
    depends_on:
      redis:
        condition: service_healthy

volumes:
  prometheus_data:
  grafana_data:
  loki_data:
```

### S5: Grafana 프로비저닝 구조

```
infra/monitoring/
  prometheus/
    prometheus.yml           # 스크레이핑 설정
    alert_rules.yml          # 알림 규칙
  grafana/
    provisioning/
      datasources/
        datasources.yml      # Prometheus + Loki 데이터 소스
      dashboards/
        dashboards.yml       # 대시보드 프로비저닝 설정
    dashboards/
      app-performance.json   # 애플리케이션 성능 대시보드
      infrastructure.json    # 인프라 대시보드
      business-metrics.json  # 비즈니스 메트릭 대시보드
      celery-workers.json    # Celery 워커 대시보드
      llm-rag.json           # LLM/RAG 성능 대시보드
  loki/
    loki-config.yml          # Loki 서버 설정
  promtail/
    promtail-config.yml      # Promtail 로그 수집 설정
  alertmanager/
    alertmanager.yml         # AlertManager 라우팅 설정
```

### S6: 구조화된 로깅 설정

```python
# backend/app/core/logging.py (확장)
import structlog
import uuid

def configure_logging():
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
    )

# request_id 미들웨어
class RequestIdMiddleware:
    async def __call__(self, request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            service="fastapi",
            environment=settings.ENVIRONMENT,
        )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
```

---

## Traceability (추적성)

| 요구사항 ID | 모듈 | plan.md 참조 | acceptance.md 참조 |
|------------|------|-------------|-------------------|
| REQ-OPS-001-01~06 | M1: Prometheus 메트릭 | Milestone 1 | AC-01~06 |
| REQ-OPS-001-07~10 | M2: Grafana 대시보드 | Milestone 2 | AC-07~10 |
| REQ-OPS-001-11~14 | M3: Loki 로그 수집 | Milestone 3 | AC-11~14 |
| REQ-OPS-001-15~23 | M4: AlertManager 알림 | Milestone 4 | AC-15~20 |
| REQ-OPS-001-24~27 | M5: Docker Compose 통합 | Milestone 5 | AC-21~24 |
| REQ-OPS-001-28~30 | M6: 보안 및 운영 | Milestone 5 | AC-25~27 |

---

**SPEC-OPS-001** | 상태: Draft | 우선순위: High
