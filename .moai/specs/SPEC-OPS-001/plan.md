---
id: SPEC-OPS-001
type: plan
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
author: zuge3
---

# SPEC-OPS-001: 구현 계획 (Implementation Plan)

---

## 개요

Bodam 플랫폼의 프로덕션 모니터링 및 가시성 시스템을 단계적으로 구축한다. Prometheus 메트릭 수집, Grafana 대시보드 시각화, Loki 로그 집계, AlertManager 알림 규칙을 Docker Compose 환경에 통합한다.

---

## Milestone 1: Prometheus 메트릭 인프라 (Priority: High)

### 목표
FastAPI 및 Celery worker에서 Prometheus 메트릭을 수집하고, 외부 익스포터를 통해 PostgreSQL/Redis 메트릭을 수집한다.

### 태스크

**Task 1.1: FastAPI 메트릭 미들웨어 구현**
- `backend/app/core/metrics.py` 생성
- `prometheus_client` 라이브러리를 사용한 HTTP 메트릭 정의 (Counter, Histogram, Gauge)
- Starlette 미들웨어로 요청/응답 메트릭 자동 수집
- `/metrics` 엔드포인트 추가 (Prometheus 스크레이핑용)
- 관련 요구사항: REQ-OPS-001-01

**Task 1.2: 커스텀 비즈니스 메트릭 계측**
- 채팅 세션 카운터 (bodam_chat_sessions_total)
- RAG 쿼리 지연 시간 히스토그램 (bodam_rag_query_duration_seconds)
- 임베딩 처리량 카운터 (bodam_embedding_processed_total)
- LLM API 비용/응답 시간 메트릭 (bodam_llm_cost_usd_total, bodam_llm_response_duration_seconds)
- 기존 서비스 코드에 메트릭 계측 포인트 추가
- 관련 요구사항: REQ-OPS-001-04

**Task 1.3: Celery worker 메트릭 노출**
- Celery 시그널 핸들러를 통한 태스크 메트릭 수집
- 별도 HTTP 서버 (포트 9808)를 통한 메트릭 노출
- 태스크 큐 깊이, 처리 시간, 실패율 메트릭
- 관련 요구사항: REQ-OPS-001-02

**Task 1.4: Prometheus 서버 설정**
- `infra/monitoring/prometheus/prometheus.yml` 스크레이핑 설정
- FastAPI, Celery, postgres_exporter, redis_exporter 대상 구성
- 15초 스크레이핑 간격 설정
- 관련 요구사항: REQ-OPS-001-03

**Task 1.5: 외부 익스포터 설정**
- postgres_exporter Docker 서비스 설정
- redis_exporter Docker 서비스 설정
- 연결 문자열 및 환경 변수 구성
- 관련 요구사항: REQ-OPS-001-05, REQ-OPS-001-06

### 기술 접근

- `prometheus_client` Python 라이브러리를 사용하여 메트릭 정의
- Starlette `BaseHTTPMiddleware`를 상속한 `PrometheusMiddleware` 클래스 구현
- 메트릭 라벨에 method, endpoint, status_code 포함
- Histogram 버킷은 HTTP 지연 시간 패턴에 맞게 커스터마이징 ([10ms ~ 10s])
- 비즈니스 메트릭은 기존 서비스 레이어에 최소한의 코드로 계측

---

## Milestone 2: Grafana 대시보드 (Priority: High)

### 목표
5개의 프로비저닝 대시보드를 구축하여 애플리케이션 성능, 인프라, 비즈니스, Celery, LLM/RAG 메트릭을 시각화한다.

### 태스크

**Task 2.1: Grafana 데이터 소스 프로비저닝**
- `infra/monitoring/grafana/provisioning/datasources/datasources.yml` 생성
- Prometheus 데이터 소스 (http://prometheus:9090)
- Loki 데이터 소스 (http://loki:3100)
- 관련 요구사항: REQ-OPS-001-07

**Task 2.2: Application Performance 대시보드**
- p50/p95/p99 지연 시간 패널 (Histogram 기반)
- 에러율 게이지 (5xx 응답 비율)
- 초당 요청 처리량 (RPS) 그래프
- 엔드포인트별 지연 시간 Top-N 테이블
- 시간 범위 필터 (1h, 6h, 24h, 7d)
- 관련 요구사항: REQ-OPS-001-08 (대시보드 1), REQ-OPS-001-09

**Task 2.3: Infrastructure 대시보드**
- 컨테이너별 CPU 사용률
- 컨테이너별 메모리 사용량
- PostgreSQL 연결 수 및 캐시 히트율
- Redis 메모리 사용량 및 명령 처리율
- 관련 요구사항: REQ-OPS-001-08 (대시보드 2)

**Task 2.4: Business Metrics 대시보드**
- 채팅 세션 트렌드 (시간대별)
- RAG 쿼리 지연 시간 분포
- 임베딩 파이프라인 처리량
- LLM API 비용 누적 그래프 (모델별)
- 관련 요구사항: REQ-OPS-001-08 (대시보드 3)

**Task 2.5: Celery Workers 대시보드**
- 태스크 큐 깊이 게이지
- 태스크 처리 시간 히스토그램
- 태스크 성공/실패 비율
- 활성 워커 수
- 관련 요구사항: REQ-OPS-001-08 (대시보드 4)

**Task 2.6: LLM/RAG Performance 대시보드**
- 모델별 응답 시간 비교
- 토큰 사용량 및 비용 트렌드
- RAG 검색 정확도 메트릭
- 쿼리 유형별 성능 분석
- 관련 요구사항: REQ-OPS-001-08 (대시보드 5)

### 기술 접근

- Grafana JSON 모델을 사용한 대시보드 정의
- Provisioning YAML 파일을 통한 자동 배포
- PromQL 쿼리를 사용한 Prometheus 데이터 시각화
- 변수 (Variables)를 사용한 동적 필터링

---

## Milestone 3: Loki 로그 수집 (Priority: Medium)

### 목표
FastAPI, Celery, Next.js의 구조화된 JSON 로그를 Loki에 수집하고 Grafana에서 검색 가능하게 한다.

### 태스크

**Task 3.1: 구조화된 로깅 확장**
- structlog JSON 렌더러 설정 확인 및 강화
- request_id 컨텍스트 전파 미들웨어 구현
- 로그 레벨 표준화 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- 관련 요구사항: REQ-OPS-001-11, REQ-OPS-001-13

**Task 3.2: Loki 서버 설정**
- `infra/monitoring/loki/loki-config.yml` 생성
- 로컬 스토리지 구성 (filesystem)
- 데이터 보존 정책 설정 (15일)
- 관련 요구사항: REQ-OPS-001-14

**Task 3.3: Promtail 설정**
- `infra/monitoring/promtail/promtail-config.yml` 생성
- Docker 컨테이너 로그 자동 수집 설정
- 라벨 매핑: service, environment, log_level, request_id
- JSON 파서를 통한 구조화된 로그 필드 추출
- 관련 요구사항: REQ-OPS-001-12

**Task 3.4: Grafana Loki 탐색 검증**
- LogQL 쿼리 예제 문서화
- 서비스별 로그 필터링 검증
- request_id 기반 분산 추적 검증
- 관련 요구사항: REQ-OPS-001-14

### 기술 접근

- Promtail의 Docker 소켓 마운트를 통한 컨테이너 로그 수집
- JSON 파이프라인 스테이지를 통한 라벨 추출
- structlog의 `contextvars` 프로세서를 통한 request_id 전파

---

## Milestone 4: AlertManager 알림 (Priority: Medium)

### 목표
Critical/Warning/Business 3단계 알림 규칙을 구성하고 Slack webhook으로 알림을 전송한다.

### 태스크

**Task 4.1: Prometheus 알림 규칙 정의**
- `infra/monitoring/prometheus/alert_rules.yml` 생성
- Critical 규칙: HighErrorRate, HighP99Latency, ServiceDown
- Warning 규칙: HighP95Latency, ModerateErrorRate, HighQueueDepth
- Business 규칙: EmbeddingPipelineStalled, LLMCostApproachingBudget
- 관련 요구사항: REQ-OPS-001-15~22

**Task 4.2: AlertManager 라우팅 설정**
- `infra/monitoring/alertmanager/alertmanager.yml` 생성
- 심각도별 알림 라우팅 (critical -> immediate, warning -> 5min grouping, business -> 15min grouping)
- Slack webhook 수신자 설정
- 알림 템플릿 (서비스명, 심각도, 설명, 대시보드 링크 포함)
- 관련 요구사항: REQ-OPS-001-23

**Task 4.3: 알림 테스트 및 검증**
- 알림 규칙 구문 검증 (promtool)
- 테스트 시나리오를 통한 알림 발화 검증
- 알림 억제 (inhibition) 규칙 검증

### 기술 접근

- PromQL 기반 알림 표현식
- AlertManager의 route tree를 통한 심각도별 라우팅
- group_by, group_wait, group_interval을 통한 알림 노이즈 감소

---

## Milestone 5: Docker Compose 통합 및 보안 (Priority: High)

### 목표
모든 모니터링 서비스를 Docker Compose profile로 통합하고 보안 설정을 적용한다.

### 태스크

**Task 5.1: Docker Compose 모니터링 profile 구성**
- `monitoring` profile에 7개 서비스 추가 (prometheus, grafana, loki, promtail, alertmanager, postgres-exporter, redis-exporter)
- 서비스 간 의존성 및 헬스체크 설정
- 영구 볼륨 (prometheus_data, grafana_data, loki_data) 설정
- 관련 요구사항: REQ-OPS-001-24~27

**Task 5.2: 환경 변수 및 보안 설정**
- `.env.example`에 모니터링 관련 환경 변수 추가
- Grafana 관리자 비밀번호 환경 변수 처리
- `/metrics` 엔드포인트 내부 네트워크 제한
- 관련 요구사항: REQ-OPS-001-28~29

**Task 5.3: 데이터 보존 정책 설정**
- Prometheus 15일 데이터 보존 (`--storage.tsdb.retention.time=15d`)
- Loki 15일 로그 보존
- 관련 요구사항: REQ-OPS-001-30

**Task 5.4: 통합 테스트 및 문서화**
- 전체 스택 기동 테스트 (`docker compose --profile monitoring up`)
- 각 서비스 헬스체크 검증
- 모니터링 사용 가이드 문서 작성

---

## 리스크 및 대응 계획

| 리스크 | 영향 | 대응 방안 |
|--------|------|----------|
| 모니터링 서비스의 리소스 과다 사용 | 핵심 서비스 성능 저하 | Docker resource limits 설정, Prometheus 스크레이핑 간격 조정 |
| Promtail Docker 소켓 접근 불가 (Windows 환경) | 로그 수집 실패 | 볼륨 마운트 방식의 로그 파일 수집으로 대체 |
| Grafana 대시보드 JSON 호환성 | 대시보드 로드 실패 | Grafana 버전 고정 및 대시보드 검증 테스트 |
| AlertManager webhook 연결 실패 | 알림 미전송 | 로컬 로그 기반 폴백 알림 + 주기적 연결 검증 |

---

## 아키텍처 설계 방향

```
                    ┌─────────────┐
                    │   Grafana   │ :3001
                    │  Dashboard  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───┐ ┌─────▼──────┐
        │ Prometheus │ │  Loki │ │AlertManager│
        │   :9090    │ │ :3100 │ │   :9093    │
        └──────┬─────┘ └───▲───┘ └────────────┘
               │           │
    ┌──────────┼───────────┼──────────┐
    │          │           │          │
┌───▼───┐ ┌───▼───┐ ┌─────▼────┐ ┌───▼──────┐
│FastAPI│ │Celery │ │ Promtail │ │Exporters │
│/metrics│ │:9808  │ │(로그수집)│ │PG/Redis  │
└───────┘ └───────┘ └──────────┘ └──────────┘
```

---

## 의존성

| 의존 SPEC | 관계 | 설명 |
|----------|------|------|
| SPEC-INFRA-001 | 선행 | Docker Compose 인프라 기반 |
| SPEC-LLM-001 | 참조 | LLM 메트릭 계측 포인트 |
| SPEC-EMBED-001 | 참조 | 임베딩 파이프라인 메트릭 계측 포인트 |
| SPEC-CHAT-001 | 참조 | 채팅 세션 메트릭 계측 포인트 |

---

**SPEC-OPS-001 Plan** | 버전: 1.0.0
