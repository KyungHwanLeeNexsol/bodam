---
id: SPEC-OPS-001
type: acceptance
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
author: zuge3
---

# SPEC-OPS-001: 인수 기준 (Acceptance Criteria)

---

## AC-01: FastAPI HTTP 메트릭 노출

```gherkin
Scenario: FastAPI 애플리케이션에서 Prometheus 메트릭 엔드포인트 접근
  Given FastAPI 서버가 실행 중이고
  And PrometheusMiddleware가 활성화되어 있을 때
  When GET /metrics 요청을 보내면
  Then HTTP 200 응답과 함께 text/plain 형식의 Prometheus 메트릭이 반환되어야 하고
  And http_requests_total 카운터가 포함되어야 하고
  And http_request_duration_seconds 히스토그램이 포함되어야 하고
  And http_requests_in_progress 게이지가 포함되어야 한다

Scenario: HTTP 요청 시 메트릭 자동 수집
  Given FastAPI 서버가 실행 중이고
  And PrometheusMiddleware가 활성화되어 있을 때
  When GET /api/v1/health 요청을 3회 보내면
  Then http_requests_total{method="GET", endpoint="/api/v1/health", status_code="200"} 값이 3 이상이어야 하고
  And http_request_duration_seconds_bucket에 관측값이 기록되어야 한다
```

---

## AC-02: Celery worker 메트릭 노출

```gherkin
Scenario: Celery worker에서 Prometheus 메트릭 노출
  Given Celery worker가 실행 중이고
  And 메트릭 HTTP 서버가 포트 9808에서 실행 중일 때
  When GET http://celery-worker:9808/metrics 요청을 보내면
  Then celery_queue_length 메트릭이 포함되어야 하고
  And celery_task_duration_seconds 히스토그램이 포함되어야 하고
  And celery_task_failures_total 카운터가 포함되어야 한다
```

---

## AC-03: Prometheus 스크레이핑 설정

```gherkin
Scenario: Prometheus가 모든 대상 서비스를 스크레이핑
  Given Prometheus 서버가 실행 중이고
  And prometheus.yml 설정이 로드되어 있을 때
  When Prometheus Status > Targets 페이지에 접근하면
  Then fastapi, celery, postgres, redis 4개의 스크레이핑 대상이 표시되어야 하고
  And 각 대상의 상태가 "UP"이어야 한다
```

---

## AC-04: 커스텀 비즈니스 메트릭 수집

```gherkin
Scenario: 채팅 세션 메트릭 수집
  Given FastAPI 서버가 실행 중이고
  And 비즈니스 메트릭이 활성화되어 있을 때
  When 채팅 세션이 생성되면
  Then bodam_chat_sessions_total 카운터가 1 증가해야 한다

Scenario: RAG 쿼리 지연 시간 메트릭 수집
  Given RAG 서비스가 실행 중일 때
  When RAG 쿼리가 실행되면
  Then bodam_rag_query_duration_seconds 히스토그램에 관측값이 기록되어야 한다

Scenario: LLM API 비용 메트릭 수집
  Given LLM 라우터가 실행 중일 때
  When LLM API 호출이 완료되면
  Then bodam_llm_cost_usd_total{model="gemini-2.0-flash"} 카운터가 비용만큼 증가해야 하고
  And bodam_llm_response_duration_seconds{model="gemini-2.0-flash"} 히스토그램에 관측값이 기록되어야 한다
```

---

## AC-05: PostgreSQL 익스포터 메트릭

```gherkin
Scenario: PostgreSQL 메트릭 수집
  Given postgres_exporter가 실행 중이고
  And PostgreSQL 데이터베이스에 연결되어 있을 때
  When Prometheus가 postgres-exporter:9187/metrics를 스크레이핑하면
  Then pg_stat_activity_count (연결 수) 메트릭이 포함되어야 하고
  And pg_stat_database_tup_fetched (트랜잭션 처리율) 메트릭이 포함되어야 한다
```

---

## AC-06: Redis 익스포터 메트릭

```gherkin
Scenario: Redis 메트릭 수집
  Given redis_exporter가 실행 중이고
  And Redis 서버에 연결되어 있을 때
  When Prometheus가 redis-exporter:9121/metrics를 스크레이핑하면
  Then redis_memory_used_bytes 메트릭이 포함되어야 하고
  And redis_connected_clients 메트릭이 포함되어야 한다
```

---

## AC-07: Grafana 데이터 소스 자동 프로비저닝

```gherkin
Scenario: Grafana 시작 시 데이터 소스 자동 등록
  Given Grafana 컨테이너가 시작되고
  And provisioning/datasources/datasources.yml 파일이 마운트되어 있을 때
  When Grafana UI의 Settings > Data Sources에 접근하면
  Then "Prometheus" 데이터 소스가 등록되어 있어야 하고
  And "Loki" 데이터 소스가 등록되어 있어야 하고
  And 각 데이터 소스의 상태가 연결 성공이어야 한다
```

---

## AC-08: 대시보드 프로비저닝

```gherkin
Scenario: 5개 대시보드 자동 프로비저닝
  Given Grafana가 시작되고
  And dashboards/ 디렉토리에 JSON 파일이 마운트되어 있을 때
  When Grafana UI의 Dashboard 목록에 접근하면
  Then "Application Performance" 대시보드가 표시되어야 하고
  And "Infrastructure" 대시보드가 표시되어야 하고
  And "Business Metrics" 대시보드가 표시되어야 하고
  And "Celery Workers" 대시보드가 표시되어야 하고
  And "LLM/RAG Performance" 대시보드가 표시되어야 한다
```

---

## AC-09: Application Performance 대시보드 시간 필터

```gherkin
Scenario: 시간 범위 필터 동작
  Given Application Performance 대시보드가 열려 있을 때
  When 시간 범위를 "Last 1 hour"로 변경하면
  Then 모든 패널이 최근 1시간 데이터만 표시해야 한다

  When 시간 범위를 "Last 24 hours"로 변경하면
  Then 모든 패널이 최근 24시간 데이터만 표시해야 한다
```

---

## AC-10: Grafana 관리자 권한

```gherkin
Scenario: 관리자 계정으로 대시보드 편집
  Given Grafana에 관리자 계정으로 로그인했을 때
  When Application Performance 대시보드에서 편집 버튼을 클릭하면
  Then 패널 편집 UI가 표시되어야 하고
  And PromQL 쿼리를 수정할 수 있어야 한다
```

---

## AC-11: 구조화된 JSON 로깅

```gherkin
Scenario: FastAPI 로그 JSON 형식 출력
  Given FastAPI 서버가 실행 중일 때
  When API 요청이 처리되면
  Then 로그가 JSON 형식으로 출력되어야 하고
  And "event", "level", "timestamp" 필드가 포함되어야 하고
  And "request_id" 필드가 포함되어야 한다
```

---

## AC-12: Promtail 로그 라벨 매핑

```gherkin
Scenario: Promtail이 올바른 라벨로 로그를 Loki에 전송
  Given Promtail이 실행 중이고
  And FastAPI 컨테이너의 로그를 수집 중일 때
  When Grafana Explore에서 Loki 데이터 소스를 선택하고
  And {service="fastapi"} 쿼리를 실행하면
  Then FastAPI 서비스의 로그만 표시되어야 하고
  And 각 로그에 service, environment, log_level 라벨이 포함되어야 한다
```

---

## AC-13: request_id 추적

```gherkin
Scenario: request_id를 통한 요청 추적
  Given FastAPI 서버가 실행 중이고
  And RequestIdMiddleware가 활성화되어 있을 때
  When API 요청을 보내면
  Then 응답 헤더에 X-Request-ID가 포함되어야 하고
  And 해당 request_id로 Loki에서 관련 로그를 검색할 수 있어야 한다
```

---

## AC-14: LogQL 로그 검색

```gherkin
Scenario: 서비스별 로그 검색
  Given Grafana Explore가 열려 있고
  And Loki 데이터 소스가 선택되어 있을 때
  When {service="fastapi"} |= "error" 쿼리를 실행하면
  Then FastAPI 서비스의 에러 로그만 표시되어야 한다

Scenario: request_id별 로그 검색
  Given 특정 request_id 값이 주어졌을 때
  When {service=~".+"} |= "<request_id>" 쿼리를 실행하면
  Then 해당 요청과 관련된 모든 서비스의 로그가 표시되어야 한다
```

---

## AC-15: Critical 알림 - 에러율

```gherkin
Scenario: 에러율 5% 초과 시 Critical 알림
  Given AlertManager가 실행 중이고
  And 알림 규칙이 활성화되어 있을 때
  When 5분간 HTTP 에러율이 5%를 초과하면
  Then HighErrorRate Critical 알림이 AlertManager에 전송되어야 하고
  And 알림에 서비스명, 심각도, 설명, 대시보드 링크가 포함되어야 한다
```

---

## AC-16: Critical 알림 - P99 지연 시간

```gherkin
Scenario: P99 지연 시간 3초 초과 시 Critical 알림
  Given AlertManager가 실행 중일 때
  When 5분간 P99 지연 시간이 3초를 초과하면
  Then HighP99Latency Critical 알림이 전송되어야 한다
```

---

## AC-17: Critical 알림 - 서비스 다운

```gherkin
Scenario: 서비스 다운 시 1분 이내 알림
  Given AlertManager가 실행 중이고
  And FastAPI 서비스가 정상 실행 중일 때
  When FastAPI 서비스가 중단되면
  Then 1분 이내에 ServiceDown Critical 알림이 전송되어야 한다
```

---

## AC-18: Warning 알림

```gherkin
Scenario: P95 지연 시간 초과 Warning 알림
  Given AlertManager가 실행 중일 때
  When 5분간 P95 지연 시간이 1초를 초과하면
  Then HighP95Latency Warning 알림이 전송되어야 한다

Scenario: Celery 큐 깊이 초과 Warning 알림
  Given AlertManager가 실행 중일 때
  When Celery 태스크 큐 깊이가 100을 초과하면
  Then HighQueueDepth Warning 알림이 전송되어야 한다
```

---

## AC-19: Business 알림 - 임베딩 파이프라인 정지

```gherkin
Scenario: 임베딩 파이프라인 30분 이상 정지 시 알림
  Given AlertManager가 실행 중이고
  And 임베딩 파이프라인이 정상 동작 중일 때
  When 30분 동안 bodam_embedding_processed_total 증가가 없으면
  Then EmbeddingPipelineStalled Business 알림이 전송되어야 한다
```

---

## AC-20: Business 알림 - LLM API 비용 임계값

```gherkin
Scenario: LLM API 일일 비용이 예산 80%에 도달 시 알림
  Given AlertManager가 실행 중이고
  And 일일 LLM 비용 예산이 $50일 때
  When 24시간 누적 LLM API 비용이 $40에 도달하면
  Then LLMCostApproachingBudget Business 알림이 전송되어야 한다
```

---

## AC-21: Docker Compose 모니터링 profile 기동

```gherkin
Scenario: 모니터링 profile로 전체 스택 기동
  Given Docker Compose 파일에 monitoring profile이 정의되어 있을 때
  When docker compose --profile monitoring up -d 명령을 실행하면
  Then prometheus, grafana, loki, promtail, alertmanager, postgres-exporter, redis-exporter 7개 서비스가 시작되어야 하고
  And 기존 backend, frontend, postgres, redis 서비스도 정상 동작해야 한다

Scenario: 모니터링 없이 핵심 서비스만 기동
  Given Docker Compose 파일에 monitoring profile이 정의되어 있을 때
  When docker compose up -d 명령을 실행하면 (profile 없이)
  Then backend, frontend, postgres, redis 4개 서비스만 시작되어야 하고
  And 모니터링 서비스는 시작되지 않아야 한다
```

---

## AC-22: 모니터링 서비스 헬스체크

```gherkin
Scenario: 모든 모니터링 서비스 헬스체크 통과
  Given 모니터링 profile로 모든 서비스가 시작되었을 때
  When docker compose ps 명령을 실행하면
  Then 모든 모니터링 서비스의 상태가 "healthy"여야 한다
```

---

## AC-23: 영구 볼륨 데이터 유지

```gherkin
Scenario: 컨테이너 재시작 시 모니터링 데이터 유지
  Given Prometheus에 10분 이상의 메트릭 데이터가 수집된 상태에서
  When docker compose --profile monitoring down && docker compose --profile monitoring up -d 명령으로 재시작하면
  Then Prometheus에 이전 메트릭 데이터가 보존되어야 하고
  And Grafana 대시보드 설정이 유지되어야 한다
```

---

## AC-24: 데이터 보존 정책

```gherkin
Scenario: Prometheus 15일 데이터 보존
  Given Prometheus가 --storage.tsdb.retention.time=15d 옵션으로 실행 중일 때
  When 15일이 경과한 메트릭 데이터가 있으면
  Then 해당 데이터는 자동으로 삭제되어야 한다
```

---

## AC-25: /metrics 엔드포인트 접근 제한

```gherkin
Scenario: 외부 네트워크에서 /metrics 접근 차단
  Given FastAPI 서버가 Docker 네트워크 내에서 실행 중일 때
  When Docker 내부 네트워크에서 GET /metrics 요청을 보내면
  Then HTTP 200 응답이 반환되어야 하고

  When Docker 외부에서 직접 GET http://backend:8000/metrics 요청을 보내면
  Then 접근이 제한되어야 한다 (Docker 네트워크 격리)
```

---

## AC-26: Grafana 관리자 비밀번호 설정

```gherkin
Scenario: 환경 변수를 통한 Grafana 비밀번호 설정
  Given GRAFANA_ADMIN_PASSWORD 환경 변수가 설정되어 있을 때
  When Grafana 컨테이너가 시작되면
  Then 기본 비밀번호 "admin" 대신 환경 변수에 설정된 비밀번호로 로그인할 수 있어야 한다
```

---

## AC-27: 알림 메시지 형식

```gherkin
Scenario: AlertManager 알림 메시지에 필수 정보 포함
  Given AlertManager에서 알림이 발생했을 때
  Then 알림 메시지에 다음 정보가 포함되어야 한다:
  And 서비스명 (예: "fastapi")
  And 심각도 (예: "critical", "warning", "business")
  And 설명 (예: "에러율이 5%를 초과했습니다")
  And Grafana 대시보드 링크
```

---

## Quality Gate 기준

| 항목 | 기준 |
|------|------|
| **메트릭 수집** | FastAPI, Celery, PostgreSQL, Redis 4개 서비스 메트릭 수집 확인 |
| **대시보드** | 5개 대시보드 프로비저닝 및 데이터 표시 확인 |
| **로그 수집** | FastAPI, Celery 로그가 Loki에 저장되고 Grafana에서 검색 가능 |
| **알림** | Critical/Warning/Business 3단계 알림 규칙 발화 검증 |
| **Docker 통합** | `docker compose --profile monitoring up` 명령으로 전체 스택 기동 성공 |
| **보안** | Grafana 비밀번호 환경 변수 설정, /metrics 내부 네트워크 제한 |

---

## Definition of Done

- [ ] `prometheus_client` 라이브러리를 사용한 FastAPI 메트릭 미들웨어 구현 완료
- [ ] Celery worker 메트릭 노출 구현 완료
- [ ] 커스텀 비즈니스 메트릭 (채팅, RAG, LLM) 계측 완료
- [ ] Prometheus 서버 및 스크레이핑 설정 완료
- [ ] postgres_exporter, redis_exporter 설정 완료
- [ ] Grafana 데이터 소스 프로비저닝 (Prometheus + Loki) 완료
- [ ] 5개 Grafana 대시보드 JSON 정의 및 프로비저닝 완료
- [ ] structlog JSON 로깅 + request_id 미들웨어 구현 완료
- [ ] Loki 서버 + Promtail 로그 수집 설정 완료
- [ ] AlertManager 알림 규칙 (Critical/Warning/Business) 정의 완료
- [ ] Docker Compose monitoring profile 통합 완료
- [ ] 보안 설정 (Grafana 비밀번호, /metrics 접근 제한) 적용 완료
- [ ] 전체 스택 통합 테스트 통과

---

**SPEC-OPS-001 Acceptance** | 버전: 1.0.0
