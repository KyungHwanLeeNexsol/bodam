---
id: SPEC-INFRA-002
version: 1.1.0
status: completed
created: 2026-03-14
updated: 2026-03-14
author: zuge3
priority: high
issue_number: 0
tags: [infra, production, backup, staging, health-check, logging, operations]
depends_on: [SPEC-INFRA-001]
---

# SPEC-INFRA-002: 프로덕션 인프라 운영

---

## Environment (환경)

### 프로젝트 컨텍스트

- **프로젝트**: Bodam (보담) - AI 기반 한국 보험 청구 안내 플랫폼
- **개발 인원**: 1명 (솔로 개발자)
- **현재 상태**: MVP 구현 완료, 프로덕션 런칭 준비 단계
- **선행 SPEC**: SPEC-INFRA-001 (프로젝트 초기 설정 및 스캐폴딩) 완료
- **개발 모드**: TDD (quality.yaml 설정)

### 기술 스택 (확정)

**백엔드:**
- Python 3.13.x, FastAPI 0.135.x, Pydantic 2.12.x
- SQLAlchemy 2.x (async), Celery 5.x, structlog 24.x

**데이터베이스:**
- PostgreSQL 18.x + pgvector 0.8.2
- Redis 7.x

**인프라:**
- Docker + Docker Compose (SPEC-INFRA-001에서 구성 완료)
- GitHub Actions CI/CD

### 현재 인프라 상태

- `docker-compose.yml`: 4개 서비스 (frontend, backend, postgres, redis) - 개발 환경 전용
- `.github/workflows/test.yml`: 기본 CI 파이프라인 (lint + test)
- `GET /api/v1/health`: 기본 헬스체크 (status + version만 반환)
- 백업 시스템: 미구성
- 스테이징 환경: 미구성
- 로그 관리: 기본 structlog만 설정
- 리소스 제한: 미설정

---

## Assumptions (가정)

### 기술 가정

- [A1] Docker Compose 환경에서 pg_dump를 통한 백업이 안정적으로 수행된다
- [A2] PostgreSQL 18.x의 pg_dump가 pgvector 확장 데이터를 포함한 전체 백업을 지원한다
- [A3] structlog 24.x가 JSON 포맷 로그 출력과 correlation ID 주입을 지원한다
- [A4] Celery 5.x가 SIGTERM 시그널에 대한 graceful shutdown을 지원한다
- [A5] Docker Compose의 `stop_grace_period` 설정이 컨테이너 종료 시 유예 시간을 제공한다

### 비즈니스 가정

- [A6] MVP 단계에서 백업은 로컬 볼륨 + 선택적 S3 업로드로 충분하다
- [A7] 스테이징 환경은 단일 서버에서 Docker Compose로 운영한다
- [A8] 프로덕션 환경에서의 모니터링은 Sentry + CloudWatch로 대체한다 (별도 모니터링 스택 불필요)
- [A9] 일일 백업 + 30일 보관 정책이 초기 프로덕션 운영에 적합하다

### 위험 가정

- [A10] 단일 서버 환경에서 백업 수행 시 일시적 성능 저하가 허용 가능하다
- [A11] 스테이징 데이터베이스에 익명화된 샘플 데이터를 사용하는 것이 개인정보보호법(PIPA) 준수에 충분하다

---

## Requirements (요구사항)

### 모듈 1: 데이터베이스 백업 및 재해 복구

**REQ-INFRA-002-01** (Event-Driven)
WHEN 매일 UTC 17:00 (KST 02:00)이 되면 THEN 시스템은 pg_dump를 사용하여 PostgreSQL 전체 데이터베이스(pgvector 데이터 포함)의 압축 백업을 자동 생성해야 한다.

**REQ-INFRA-002-02** (Ubiquitous)
시스템은 항상 백업 파일을 `backups/` 디렉토리에 `bodam_backup_YYYYMMDD_HHMMSS.sql.gz` 형식으로 저장해야 한다.

**REQ-INFRA-002-03** (Event-Driven)
WHEN 백업이 완료되면 THEN 30일 이전의 백업 파일을 자동으로 삭제하여 롤링 보관 정책을 적용해야 한다.

**REQ-INFRA-002-04** (Conditional)
IF S3 업로드가 설정되어 있다면 (`BACKUP_S3_BUCKET` 환경 변수 존재) THEN 백업 완료 후 S3 버킷으로 백업 파일을 업로드해야 한다.

**REQ-INFRA-002-05** (Event-Driven)
WHEN 매주 일요일 백업이 완료되면 THEN 백업 검증 스크립트가 최신 백업 파일을 임시 데이터베이스에 복원하고 기본 무결성 검사를 수행해야 한다.

**REQ-INFRA-002-06** (Unwanted)
시스템은 백업 실패 시 무시하지 않아야 하며, 실패 로그를 기록하고 연속 3회 실패 시 경고 로그를 출력해야 한다.

**REQ-INFRA-002-07** (Ubiquitous)
시스템은 항상 Point-in-Time Recovery (PITR) 절차를 문서화된 복구 가이드(`docs/disaster-recovery.md`)로 제공해야 한다.

### 모듈 2: 스테이징 환경

**REQ-INFRA-002-08** (Event-Driven)
WHEN `docker compose -f docker-compose.staging.yml up`이 실행되면 THEN 프로덕션과 동일한 서비스 구성(frontend, backend, postgres, redis)이 스테이징 설정으로 시작되어야 한다.

**REQ-INFRA-002-09** (Ubiquitous)
시스템은 항상 환경별 설정 파일(`.env.staging`, `.env.production`)을 분리하여 관리해야 한다.

**REQ-INFRA-002-10** (Event-Driven)
WHEN 스테이징 환경이 초기화되면 THEN 익명화된 샘플 데이터 시딩 스크립트(`scripts/seed_staging.py`)가 테스트용 보험 약관, 사용자, 임베딩 데이터를 삽입해야 한다.

**REQ-INFRA-002-11** (Event-Driven)
WHEN 스테이징 배포 스크립트(`scripts/deploy_staging.sh`)가 실행되면 THEN 이미지 빌드, 데이터베이스 마이그레이션, 서비스 재시작이 순차적으로 수행되어야 한다.

### 모듈 3: 헬스체크 및 준비 상태 엔드포인트

**REQ-INFRA-002-12** (Ubiquitous)
시스템은 항상 `GET /health` 엔드포인트를 통해 기본 활성 상태(liveness)를 반환해야 한다.

**REQ-INFRA-002-13** (Event-Driven)
WHEN `GET /health/ready` 요청이 수신되면 THEN 시스템은 PostgreSQL 연결, Redis 연결, Celery 워커 상태를 확인하고 구조화된 JSON으로 각 컴포넌트 상태를 반환해야 한다.

**REQ-INFRA-002-14** (Conditional)
IF 하나 이상의 컴포넌트(DB, Redis, Celery)가 비정상이라면 THEN `GET /health/ready`는 HTTP 503 상태 코드와 함께 실패한 컴포넌트 정보를 반환해야 한다.

**REQ-INFRA-002-15** (Ubiquitous)
시스템은 항상 `GET /health/live` 엔드포인트를 통해 컨테이너 오케스트레이션용 liveness 프로브 응답을 반환해야 한다.

**REQ-INFRA-002-16** (Ubiquitous)
시스템은 항상 헬스체크 응답에 `status`, `version`, `timestamp`, `components` 필드를 포함하는 구조화된 JSON 형식을 사용해야 한다.

### 모듈 4: Graceful Shutdown 및 시그널 처리

**REQ-INFRA-002-17** (Event-Driven)
WHEN FastAPI 서버가 SIGTERM을 수신하면 THEN 진행 중인 요청을 완료한 후 새로운 요청 수신을 중단하고 종료해야 한다.

**REQ-INFRA-002-18** (Event-Driven)
WHEN Celery 워커가 SIGTERM을 수신하면 THEN 현재 실행 중인 태스크를 완료한 후 새로운 태스크 수신을 중단하고 종료해야 한다.

**REQ-INFRA-002-19** (Ubiquitous)
시스템은 항상 Docker 컨테이너의 `stop_grace_period`를 30초로 설정하여 graceful shutdown을 위한 충분한 시간을 제공해야 한다.

**REQ-INFRA-002-20** (Unwanted)
시스템은 graceful shutdown 중에 데이터 손실이나 불완전한 트랜잭션이 발생하지 않아야 한다.

### 모듈 5: 로그 관리

**REQ-INFRA-002-21** (Ubiquitous)
시스템은 항상 structlog를 사용하여 JSON 형식의 구조화된 로그를 출력해야 하며, 각 로그 엔트리에 `request_id`와 `trace_id` correlation ID를 포함해야 한다.

**REQ-INFRA-002-22** (Event-Driven)
WHEN HTTP 요청이 수신되면 THEN FastAPI 미들웨어가 고유한 `request_id`(UUID v4)를 생성하여 요청 수명 주기 전체에 걸쳐 로그에 포함해야 한다.

**REQ-INFRA-002-23** (Conditional)
IF 환경이 스테이징이라면 THEN 로그 레벨은 DEBUG이어야 하고, IF 환경이 프로덕션이라면 THEN 로그 레벨은 INFO이어야 한다.

**REQ-INFRA-002-24** (Ubiquitous)
시스템은 항상 로그에서 비밀번호, API 키, JWT 토큰, 개인정보(주민등록번호, 전화번호) 등 민감 데이터를 스크러빙(마스킹)해야 한다.

**REQ-INFRA-002-25** (Event-Driven)
WHEN 로그 파일 크기가 100MB에 도달하면 THEN 로그 로테이션을 수행하고 최대 7개 파일을 보관해야 한다.

### 모듈 6: 리소스 제한 및 쿼터

**REQ-INFRA-002-26** (Ubiquitous)
시스템은 항상 `docker-compose.prod.yml`에 각 서비스의 CPU 및 메모리 리소스 제한을 설정해야 한다.

**REQ-INFRA-002-27** (Ubiquitous)
시스템은 항상 프로덕션 PostgreSQL의 `max_connections`를 100으로 설정해야 한다.

**REQ-INFRA-002-28** (Ubiquitous)
시스템은 항상 프로덕션 Redis의 `maxmemory`를 256MB로, `maxmemory-policy`를 `allkeys-lru`로 설정해야 한다.

**REQ-INFRA-002-29** (Ubiquitous)
시스템은 항상 Celery 워커의 동시성(concurrency)을 4로 설정하고, prefetch multiplier를 1로 설정해야 한다.

**REQ-INFRA-002-30** (Conditional)
IF 프로덕션 환경이라면 THEN 다음 리소스 제한을 적용해야 한다:
- backend: CPU 1.0, Memory 1GB
- frontend: CPU 0.5, Memory 512MB
- postgres: CPU 1.0, Memory 2GB
- redis: CPU 0.5, Memory 512MB
- celery_worker: CPU 1.0, Memory 1GB

---

## Specifications (세부 사양)

### S1: 백업 시스템 구성

**백업 스크립트 (`scripts/backup_db.sh`):**
```bash
#!/bin/bash
# 자동 데이터베이스 백업 스크립트
# 사용법: ./scripts/backup_db.sh [--upload-s3]

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="bodam_backup_${TIMESTAMP}.sql.gz"

# pg_dump with compression
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"

# 30일 롤링 삭제
find "${BACKUP_DIR}" -name "bodam_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

# S3 업로드 (선택적)
if [ -n "${BACKUP_S3_BUCKET}" ] && [ "$1" = "--upload-s3" ]; then
  aws s3 cp "${BACKUP_DIR}/${BACKUP_FILE}" "s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_FILE}"
fi
```

**백업 검증 스크립트 (`scripts/verify_backup.sh`):**
```bash
#!/bin/bash
# 최신 백업 파일 복원 테스트
LATEST_BACKUP=$(ls -t backups/bodam_backup_*.sql.gz | head -1)
VERIFY_DB="bodam_verify_$(date +%s)"

# 임시 데이터베이스 생성 및 복원
docker compose exec -T postgres createdb -U "${POSTGRES_USER}" "${VERIFY_DB}"
gunzip -c "${LATEST_BACKUP}" | docker compose exec -T postgres psql -U "${POSTGRES_USER}" "${VERIFY_DB}"

# 기본 무결성 검사
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${VERIFY_DB}" \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"

# 임시 데이터베이스 삭제
docker compose exec -T postgres dropdb -U "${POSTGRES_USER}" "${VERIFY_DB}"
```

**cron 스케줄 (호스트 또는 Docker cron):**
```cron
# 매일 KST 02:00 (UTC 17:00) 자동 백업
0 17 * * * /path/to/scripts/backup_db.sh >> /var/log/bodam_backup.log 2>&1

# 매주 일요일 KST 03:00 (UTC 18:00) 백업 검증
0 18 * * 0 /path/to/scripts/verify_backup.sh >> /var/log/bodam_verify.log 2>&1
```

### S2: 스테이징 환경 구성

**`docker-compose.staging.yml`:**
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_DB: bodam_staging
      POSTGRES_USER: bodam
      POSTGRES_PASSWORD: ${STAGING_DB_PASSWORD}
    volumes:
      - staging_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bodam"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.prod
    env_file: .env.staging
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    stop_grace_period: 30s

  celery_worker:
    build:
      context: ./backend
      dockerfile: Dockerfile.prod
    command: celery -A app.workers.celery_app worker --loglevel=info --concurrency=4 --prefetch-multiplier=1
    env_file: .env.staging
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    stop_grace_period: 30s

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    env_file: .env.staging
    depends_on:
      - backend

volumes:
  staging_postgres_data:
```

**환경 변수 파일 구조:**
- `.env.staging`: 스테이징 환경 변수 (DEBUG=false, LOG_LEVEL=DEBUG)
- `.env.production`: 프로덕션 환경 변수 (DEBUG=false, LOG_LEVEL=INFO)
- `.env.example`: 필수 환경 변수 문서화 (비밀 값은 플레이스홀더)

### S3: 헬스체크 엔드포인트 구조

**응답 스키마:**
```json
{
  "status": "healthy | degraded | unhealthy",
  "version": "0.1.0",
  "timestamp": "2026-03-14T02:00:00Z",
  "environment": "production | staging | development",
  "components": {
    "database": {
      "status": "healthy | unhealthy",
      "latency_ms": 5.2,
      "details": "PostgreSQL 18.x connected"
    },
    "redis": {
      "status": "healthy | unhealthy",
      "latency_ms": 1.1,
      "details": "Redis 7.x connected"
    },
    "celery": {
      "status": "healthy | unhealthy",
      "active_workers": 4,
      "details": "4 workers active"
    }
  }
}
```

**엔드포인트 매핑:**

| 엔드포인트 | 용도 | 컴포넌트 확인 | 실패 시 HTTP 코드 |
|-----------|------|-------------|-----------------|
| `GET /health` | 기본 liveness | 없음 (항상 200) | N/A |
| `GET /health/live` | 컨테이너 liveness 프로브 | 없음 (항상 200) | N/A |
| `GET /health/ready` | 준비 상태 확인 | DB, Redis, Celery | 503 |

### S4: Graceful Shutdown 구성

**FastAPI shutdown handler:**
```python
# app/core/shutdown.py
import signal
import asyncio
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    # 시작
    yield
    # 종료: in-flight 요청 대기
    await asyncio.sleep(1)  # 진행 중인 요청 완료 대기
```

**Celery worker 설정:**
```python
# Celery worker graceful shutdown 설정
app.conf.update(
    worker_max_tasks_per_child=1000,
    worker_prefetch_multiplier=1,
    task_acks_late=True,  # 태스크 완료 후 ACK
)
```

**Docker Compose 설정:**
```yaml
services:
  backend:
    stop_grace_period: 30s
    stop_signal: SIGTERM
  celery_worker:
    stop_grace_period: 30s
    stop_signal: SIGTERM
```

### S5: 구조화된 로깅 구성

**structlog 설정 (`app/core/logging.py`):**
```python
import structlog
import uuid

def setup_logging(log_level: str = "INFO"):
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            _scrub_sensitive_data,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level)
        ),
    )
```

**민감 데이터 스크러빙 패턴:**
- `password`, `secret`, `token`, `api_key` -> `***REDACTED***`
- 주민등록번호 패턴 (`\d{6}-\d{7}`) -> `******-*******`
- 전화번호 패턴 (`\d{3}-\d{4}-\d{4}`) -> `***-****-****`

**Correlation ID 미들웨어:**
```python
# app/middleware/correlation.py
from starlette.middleware.base import BaseHTTPMiddleware
import uuid
import structlog

class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        structlog.contextvars.bind_contextvars(request_id=request_id)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
```

### S6: 프로덕션 리소스 제한 (`docker-compose.prod.yml`)

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
    stop_grace_period: 30s

  frontend:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M

  postgres:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 1G
    command: >
      postgres
        -c max_connections=100
        -c shared_buffers=512MB
        -c effective_cache_size=1536MB
        -c work_mem=4MB

  redis:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

  celery_worker:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

---

## Traceability (추적성)

| 요구사항 ID | 모듈 | plan.md 참조 | acceptance.md 참조 |
|------------|------|-------------|-------------------|
| REQ-INFRA-002-01~07 | M1: 백업/복구 | Milestone 1 | AC-01~07 |
| REQ-INFRA-002-08~11 | M2: 스테이징 | Milestone 2 | AC-08~11 |
| REQ-INFRA-002-12~16 | M3: 헬스체크 | Milestone 3 | AC-12~16 |
| REQ-INFRA-002-17~20 | M4: Graceful Shutdown | Milestone 4 | AC-17~20 |
| REQ-INFRA-002-21~25 | M5: 로그 관리 | Milestone 5 | AC-21~25 |
| REQ-INFRA-002-26~30 | M6: 리소스 제한 | Milestone 6 | AC-26~30 |

---

## Implementation Notes

### 구현 완료 요약 (2026-03-14)
TDD RED-GREEN-REFACTOR 방법론으로 구현 완료. 21개 테스트 통과, ruff 0 오류.

### 신규 모듈
- `backend/app/api/v1/health.py`: 3-tier 헬스체크 (/health, /health/ready, /health/live)
- `backend/app/core/shutdown.py`: ShutdownHandler (30초 grace period)
- `backend/app/core/request_id_middleware.py`: X-Request-ID 미들웨어
- `backend/app/core/logging_config.py`: structlog JSON 설정 + 로그 로테이션
- `scripts/backup/backup_postgres.sh`: pg_dump 자동 백업 (30일 보존)
- `docker-compose.staging.yml`, `docker-compose.prod.yml`: 환경별 오버라이드

### 테스트 커버리지
- 단위 테스트: 21개 통과
- 헬스체크, graceful shutdown, Request ID 미들웨어 검증

---

**SPEC-INFRA-002** | 상태: Completed | 우선순위: High
