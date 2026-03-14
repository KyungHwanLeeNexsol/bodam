---
id: SPEC-INFRA-002
document: acceptance
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
author: zuge3
---

# SPEC-INFRA-002: 프로덕션 인프라 운영 - 인수 기준

---

## 모듈 1: 데이터베이스 백업 및 재해 복구

### AC-01: 자동 일일 백업 생성

```gherkin
Scenario: 일일 자동 백업이 정상적으로 생성된다
  Given PostgreSQL 데이터베이스에 보험 약관 데이터와 pgvector 임베딩이 존재한다
  And 백업 스크립트 scripts/backup_db.sh가 존재한다
  When 백업 스크립트가 실행된다
  Then backups/ 디렉토리에 bodam_backup_YYYYMMDD_HHMMSS.sql.gz 형식의 파일이 생성된다
  And 백업 파일이 gzip으로 압축되어 있다
  And 백업 파일에 pgvector 테이블 데이터가 포함되어 있다
```

### AC-02: 백업 파일 형식 준수

```gherkin
Scenario: 백업 파일명이 규정된 형식을 따른다
  Given 백업 스크립트가 실행 가능한 상태이다
  When 백업이 생성된다
  Then 파일명은 bodam_backup_YYYYMMDD_HHMMSS.sql.gz 패턴과 일치한다
  And 파일은 backups/ 디렉토리에 저장된다
```

### AC-03: 30일 롤링 보관 정책

```gherkin
Scenario: 30일 이전 백업이 자동으로 삭제된다
  Given backups/ 디렉토리에 35일 전 생성된 백업 파일이 존재한다
  And backups/ 디렉토리에 25일 전 생성된 백업 파일이 존재한다
  When 백업 스크립트가 실행된다
  Then 35일 전 백업 파일은 삭제된다
  And 25일 전 백업 파일은 유지된다
```

### AC-04: S3 업로드 (선택적)

```gherkin
Scenario: S3 버킷이 설정된 경우 백업이 업로드된다
  Given BACKUP_S3_BUCKET 환경 변수가 설정되어 있다
  And AWS CLI 자격 증명이 구성되어 있다
  When 백업 스크립트가 --upload-s3 옵션과 함께 실행된다
  Then 백업 파일이 S3 버킷의 backups/ 경로에 업로드된다

Scenario: S3 버킷이 설정되지 않은 경우 로컬에만 저장된다
  Given BACKUP_S3_BUCKET 환경 변수가 설정되어 있지 않다
  When 백업 스크립트가 실행된다
  Then 백업 파일은 로컬 backups/ 디렉토리에만 저장된다
  And S3 업로드 관련 오류가 발생하지 않는다
```

### AC-05: 주간 백업 검증

```gherkin
Scenario: 최신 백업의 복원 테스트가 성공한다
  Given backups/ 디렉토리에 최소 1개의 백업 파일이 존재한다
  When 백업 검증 스크립트 scripts/verify_backup.sh가 실행된다
  Then 임시 데이터베이스가 생성된다
  And 최신 백업 파일이 임시 데이터베이스에 복원된다
  And 기본 무결성 검사(테이블 수 확인)가 성공한다
  And 임시 데이터베이스가 삭제된다
```

### AC-06: 백업 실패 경고

```gherkin
Scenario: 백업 실패 시 경고 로그가 기록된다
  Given pg_dump 명령이 실패하도록 구성되어 있다
  When 백업 스크립트가 실행된다
  Then 실패 로그가 기록된다

Scenario: 연속 3회 백업 실패 시 경고 레벨 로그가 출력된다
  Given 백업이 연속 3회 실패한 기록이 있다
  When 백업 상태를 확인하면
  Then WARNING 레벨의 경고 메시지가 로그에 기록된다
```

### AC-07: PITR 복구 가이드 문서

```gherkin
Scenario: 재해 복구 문서가 존재한다
  Given SPEC-INFRA-002가 구현 완료되었다
  When docs/disaster-recovery.md 파일을 확인하면
  Then 백업 복원 절차가 단계별로 문서화되어 있다
  And Point-in-Time Recovery 개념 설명이 포함되어 있다
  And 실제 복구 명령어 예시가 포함되어 있다
```

---

## 모듈 2: 스테이징 환경

### AC-08: 스테이징 Docker Compose 구동

```gherkin
Scenario: 스테이징 환경이 정상적으로 시작된다
  Given docker-compose.staging.yml 파일이 존재한다
  And .env.staging 파일이 올바르게 구성되어 있다
  When docker compose -f docker-compose.staging.yml up -d가 실행된다
  Then frontend, backend, postgres, redis, celery_worker 서비스가 시작된다
  And 모든 서비스의 헬스체크가 통과한다
```

### AC-09: 환경별 설정 분리

```gherkin
Scenario: 환경별 설정 파일이 분리되어 있다
  Given 프로젝트 루트 디렉토리에서 파일 목록을 확인한다
  When 환경 설정 파일을 검사하면
  Then .env.staging 파일이 존재하고 스테이징 전용 설정을 포함한다
  And .env.production 파일이 존재하고 프로덕션 전용 설정을 포함한다
  And .env.example 파일이 존재하고 모든 필수 환경 변수가 문서화되어 있다
  And 비밀 값이 플레이스홀더로 표시되어 있다
```

### AC-10: 스테이징 데이터 시딩

```gherkin
Scenario: 익명화된 샘플 데이터가 스테이징에 삽입된다
  Given 스테이징 PostgreSQL 데이터베이스가 빈 상태로 실행 중이다
  And Alembic 마이그레이션이 완료되었다
  When scripts/seed_staging.py가 실행된다
  Then 익명화된 보험 약관 샘플 데이터가 삽입된다
  And 테스트 사용자 계정이 생성된다
  And 샘플 벡터 임베딩 데이터가 삽입된다
  And 실제 개인정보는 포함되지 않는다
```

### AC-11: 스테이징 배포 스크립트

```gherkin
Scenario: 스테이징 배포가 순차적으로 수행된다
  Given docker-compose.staging.yml 기반 환경이 구성되어 있다
  When scripts/deploy_staging.sh가 실행된다
  Then Docker 이미지가 빌드된다
  And 데이터베이스 마이그레이션이 실행된다
  And 서비스가 재시작된다
  And 배포 후 헬스체크가 통과한다
```

---

## 모듈 3: 헬스체크 및 준비 상태 엔드포인트

### AC-12: 기본 liveness 엔드포인트

```gherkin
Scenario: GET /health가 항상 200을 반환한다
  Given FastAPI 서버가 실행 중이다
  When GET /health 요청을 전송한다
  Then HTTP 200 상태 코드가 반환된다
  And 응답 JSON에 status 필드가 "healthy"이다
  And 응답 JSON에 version 필드가 포함되어 있다
```

### AC-13: Readiness 엔드포인트 (정상)

```gherkin
Scenario: 모든 컴포넌트가 정상일 때 GET /health/ready가 200을 반환한다
  Given PostgreSQL이 정상 연결 상태이다
  And Redis가 정상 연결 상태이다
  And Celery 워커가 활성 상태이다
  When GET /health/ready 요청을 전송한다
  Then HTTP 200 상태 코드가 반환된다
  And 응답 JSON의 status가 "healthy"이다
  And components.database.status가 "healthy"이다
  And components.redis.status가 "healthy"이다
  And components.celery.status가 "healthy"이다
  And 각 컴포넌트에 latency_ms 값이 포함되어 있다
```

### AC-14: Readiness 엔드포인트 (장애)

```gherkin
Scenario: 컴포넌트 장애 시 GET /health/ready가 503을 반환한다
  Given PostgreSQL 연결이 불가능한 상태이다
  And Redis는 정상 연결 상태이다
  When GET /health/ready 요청을 전송한다
  Then HTTP 503 상태 코드가 반환된다
  And 응답 JSON의 status가 "unhealthy"이다
  And components.database.status가 "unhealthy"이다
  And components.redis.status가 "healthy"이다
```

### AC-15: Liveness 프로브 엔드포인트

```gherkin
Scenario: GET /health/live가 항상 200을 반환한다
  Given FastAPI 서버가 실행 중이다
  When GET /health/live 요청을 전송한다
  Then HTTP 200 상태 코드가 반환된다
  And 응답 JSON에 status가 "alive"이다
```

### AC-16: 헬스체크 응답 형식

```gherkin
Scenario: 헬스체크 응답이 구조화된 JSON 형식을 따른다
  Given FastAPI 서버가 실행 중이다
  When GET /health/ready 요청을 전송한다
  Then 응답 JSON에 status 필드가 존재한다
  And 응답 JSON에 version 필드가 존재한다
  And 응답 JSON에 timestamp 필드가 ISO 8601 형식으로 존재한다
  And 응답 JSON에 environment 필드가 존재한다
  And 응답 JSON에 components 객체가 존재한다
```

---

## 모듈 4: Graceful Shutdown 및 시그널 처리

### AC-17: FastAPI Graceful Shutdown

```gherkin
Scenario: FastAPI가 SIGTERM 수신 시 진행 중인 요청을 완료한다
  Given FastAPI 서버가 실행 중이다
  And 처리 중인 HTTP 요청이 존재한다
  When SIGTERM 시그널이 전송된다
  Then 진행 중인 요청은 정상적으로 응답을 반환한다
  And 새로운 요청은 수신하지 않는다
  And 서버가 정상적으로 종료된다
```

### AC-18: Celery Worker Graceful Shutdown

```gherkin
Scenario: Celery 워커가 SIGTERM 수신 시 현재 태스크를 완료한다
  Given Celery 워커가 실행 중이다
  And 처리 중인 태스크가 존재한다
  When SIGTERM 시그널이 전송된다
  Then 현재 처리 중인 태스크가 완료된다
  And 새로운 태스크를 수신하지 않는다
  And 워커가 정상적으로 종료된다
```

### AC-19: Docker Stop Grace Period

```gherkin
Scenario: Docker 컨테이너가 30초 유예 기간을 갖는다
  Given docker-compose.prod.yml에 stop_grace_period가 30s로 설정되어 있다
  When docker compose stop 명령이 실행된다
  Then 각 컨테이너에 SIGTERM이 전송된다
  And 30초 동안 정상 종료를 대기한다
  And 30초 후에도 종료되지 않으면 SIGKILL이 전송된다
```

### AC-20: 데이터 무결성 보장

```gherkin
Scenario: Graceful shutdown 중 데이터 손실이 발생하지 않는다
  Given 데이터베이스 트랜잭션이 진행 중이다
  When 서비스가 SIGTERM을 수신한다
  Then 진행 중인 트랜잭션이 커밋 또는 롤백으로 완료된다
  And 불완전한 트랜잭션이 데이터베이스에 남지 않는다
```

---

## 모듈 5: 로그 관리

### AC-21: JSON 구조화 로그

```gherkin
Scenario: 모든 로그가 JSON 형식으로 출력된다
  Given structlog가 JSON 렌더러로 구성되어 있다
  When API 요청이 처리된다
  Then 로그 출력이 유효한 JSON 형식이다
  And 각 로그 엔트리에 level, timestamp, event 필드가 포함되어 있다
```

### AC-22: Correlation ID 주입

```gherkin
Scenario: 요청마다 고유한 request_id가 생성된다
  Given CorrelationIdMiddleware가 활성화되어 있다
  When HTTP 요청이 수신된다
  Then UUID v4 형식의 request_id가 생성된다
  And 해당 요청의 모든 로그에 request_id가 포함된다
  And HTTP 응답 헤더에 X-Request-ID가 포함된다

Scenario: 클라이언트가 X-Request-ID를 제공하면 재사용된다
  Given CorrelationIdMiddleware가 활성화되어 있다
  When X-Request-ID: "custom-123" 헤더와 함께 HTTP 요청이 수신된다
  Then request_id가 "custom-123"으로 설정된다
  And 해당 요청의 모든 로그에 request_id가 "custom-123"으로 포함된다
```

### AC-23: 환경별 로그 레벨

```gherkin
Scenario: 스테이징 환경에서 DEBUG 로그가 출력된다
  Given ENVIRONMENT가 staging으로 설정되어 있다
  When 로깅 시스템이 초기화된다
  Then 로그 레벨이 DEBUG로 설정된다

Scenario: 프로덕션 환경에서 INFO 로그가 출력된다
  Given ENVIRONMENT가 production으로 설정되어 있다
  When 로깅 시스템이 초기화된다
  Then 로그 레벨이 INFO로 설정된다
  And DEBUG 레벨 로그는 출력되지 않는다
```

### AC-24: 민감 데이터 스크러빙

```gherkin
Scenario: 비밀번호가 로그에서 마스킹된다
  Given 로그 메시지에 password 필드가 포함되어 있다
  When 로그가 기록된다
  Then password 값이 "***REDACTED***"로 대체된다

Scenario: 주민등록번호가 로그에서 마스킹된다
  Given 로그 메시지에 주민등록번호 패턴 (123456-1234567)이 포함되어 있다
  When 로그가 기록된다
  Then 주민등록번호가 "******-*******"로 대체된다

Scenario: API 키가 로그에서 마스킹된다
  Given 로그 메시지에 api_key 필드가 포함되어 있다
  When 로그가 기록된다
  Then api_key 값이 "***REDACTED***"로 대체된다
```

### AC-25: 로그 로테이션

```gherkin
Scenario: 로그 파일이 100MB 초과 시 로테이션된다
  Given 로그 파일 크기가 100MB에 도달했다
  When 새로운 로그가 기록된다
  Then 기존 로그 파일이 로테이션되어 새 파일로 전환된다
  And 로테이션된 파일을 포함하여 최대 7개 파일이 보관된다
```

---

## 모듈 6: 리소스 제한 및 쿼터

### AC-26: Docker 리소스 제한 설정

```gherkin
Scenario: docker-compose.prod.yml에 리소스 제한이 설정되어 있다
  Given docker-compose.prod.yml 파일이 존재한다
  When 파일 내용을 검사한다
  Then backend 서비스에 CPU 1.0, Memory 1GB 제한이 설정되어 있다
  And frontend 서비스에 CPU 0.5, Memory 512MB 제한이 설정되어 있다
  And postgres 서비스에 CPU 1.0, Memory 2GB 제한이 설정되어 있다
  And redis 서비스에 CPU 0.5, Memory 512MB 제한이 설정되어 있다
  And celery_worker 서비스에 CPU 1.0, Memory 1GB 제한이 설정되어 있다
```

### AC-27: PostgreSQL 연결 제한

```gherkin
Scenario: PostgreSQL max_connections가 100으로 설정된다
  Given docker-compose.prod.yml의 postgres 서비스가 실행 중이다
  When PostgreSQL 설정을 조회한다
  Then max_connections 값이 100이다
```

### AC-28: Redis 메모리 정책

```gherkin
Scenario: Redis maxmemory와 eviction 정책이 설정된다
  Given docker-compose.prod.yml의 redis 서비스가 실행 중이다
  When Redis 설정을 조회한다
  Then maxmemory가 256MB로 설정되어 있다
  And maxmemory-policy가 allkeys-lru로 설정되어 있다
```

### AC-29: Celery 워커 동시성 설정

```gherkin
Scenario: Celery 워커 동시성이 프로덕션 값으로 설정된다
  Given Celery 워커가 프로덕션 설정으로 시작된다
  When 워커 설정을 확인한다
  Then concurrency가 4로 설정되어 있다
  And prefetch-multiplier가 1로 설정되어 있다
```

### AC-30: 서비스별 리소스 예약

```gherkin
Scenario: 각 서비스에 최소 리소스 예약이 설정된다
  Given docker-compose.prod.yml 파일이 존재한다
  When deploy.resources.reservations를 확인한다
  Then backend에 CPU 0.5, Memory 512MB 예약이 설정되어 있다
  And postgres에 CPU 0.5, Memory 1GB 예약이 설정되어 있다
  And celery_worker에 CPU 0.5, Memory 512MB 예약이 설정되어 있다
```

---

## Quality Gate 기준

### Definition of Done

- [ ] 모든 인수 기준(AC-01 ~ AC-30)이 충족됨
- [ ] 신규 코드에 대한 단위 테스트 작성 완료 (85% 이상 커버리지)
- [ ] 기존 테스트 회귀 없음 (모든 기존 테스트 통과)
- [ ] Ruff lint 오류 없음
- [ ] 헬스체크 엔드포인트 통합 테스트 통과
- [ ] 백업/복원 스크립트 수동 검증 완료
- [ ] docs/disaster-recovery.md 작성 완료
- [ ] docker-compose.staging.yml 및 docker-compose.prod.yml 구동 확인

### 검증 방법

| 검증 대상 | 방법 | 도구 |
|----------|------|------|
| 헬스체크 엔드포인트 | 통합 테스트 | pytest + httpx AsyncClient |
| 로깅/스크러빙 | 단위 테스트 | pytest + structlog testing |
| Correlation ID | 통합 테스트 | pytest + httpx (헤더 검증) |
| 백업 스크립트 | 수동 실행 테스트 | bash + Docker |
| 리소스 제한 | Docker Compose 검증 | docker compose config |
| Graceful Shutdown | 수동 시그널 테스트 | docker compose stop + 로그 확인 |

---

**SPEC-INFRA-002 Acceptance** | 상태: Draft | 작성일: 2026-03-14
