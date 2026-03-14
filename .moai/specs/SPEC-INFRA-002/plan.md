---
id: SPEC-INFRA-002
document: plan
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
author: zuge3
---

# SPEC-INFRA-002: 프로덕션 인프라 운영 - 구현 계획

---

## 구현 전략

### 전체 접근 방식

SPEC-INFRA-001에서 구축한 Docker Compose 개발 환경을 기반으로, 프로덕션 운영에 필요한 인프라 계층을 점진적으로 추가한다. 각 모듈은 독립적으로 구현 및 테스트 가능하며, 기존 개발 환경에 영향을 주지 않는 방식으로 설계한다.

### 아키텍처 설계 방향

```
bodam/
  docker-compose.yml            # 개발 환경 (기존, 변경 없음)
  docker-compose.staging.yml    # 스테이징 환경 (신규)
  docker-compose.prod.yml       # 프로덕션 환경 (신규)
  .env.staging                  # 스테이징 환경 변수 (신규)
  .env.production               # 프로덕션 환경 변수 (신규)
  scripts/
    backup_db.sh                # DB 백업 스크립트 (신규)
    verify_backup.sh            # 백업 검증 스크립트 (신규)
    deploy_staging.sh           # 스테이징 배포 스크립트 (신규)
    seed_staging.py             # 스테이징 데이터 시딩 (신규)
  backups/                      # 백업 저장 디렉토리 (신규)
  docs/
    disaster-recovery.md        # PITR 복구 가이드 (신규)
  backend/
    app/
      api/v1/
        health.py               # 헬스체크 엔드포인트 (확장)
      core/
        logging.py              # 구조화 로깅 설정 (확장)
        shutdown.py             # Graceful shutdown 핸들러 (신규)
      middleware/
        correlation.py          # Correlation ID 미들웨어 (신규)
      schemas/
        health.py               # 헬스체크 응답 스키마 (신규)
      services/
        health_service.py       # 헬스체크 비즈니스 로직 (신규)
    tests/
      test_health_extended.py   # 헬스체크 확장 테스트 (신규)
      test_logging.py           # 로깅 테스트 (신규)
      test_correlation.py       # Correlation ID 테스트 (신규)
```

---

## 마일스톤

### Milestone 1: 헬스체크 및 준비 상태 엔드포인트 (Priority: High)

**목표**: 프로덕션 준비를 위한 상세 헬스체크 시스템 구현

**태스크:**
- Task 1.1: `HealthCheckSchema` Pydantic 모델 정의 (status, version, timestamp, components)
- Task 1.2: `HealthService` 구현 (DB ping, Redis ping, Celery inspector 상태 확인)
- Task 1.3: `GET /health` 기본 liveness 엔드포인트 확장
- Task 1.4: `GET /health/ready` readiness 엔드포인트 구현
- Task 1.5: `GET /health/live` liveness 프로브 엔드포인트 구현
- Task 1.6: 헬스체크 엔드포인트 단위 테스트 및 통합 테스트

**관련 요구사항**: REQ-INFRA-002-12~16

**위험 요소**:
- Celery 워커 상태 확인이 비동기 환경에서 블로킹될 수 있음
- **대응**: Celery inspector에 timeout 설정 (3초)

---

### Milestone 2: 구조화 로깅 및 Correlation ID (Priority: High)

**목표**: 프로덕션 수준의 구조화된 로그 시스템 구현

**태스크:**
- Task 2.1: structlog JSON 포맷 프로세서 체인 구성
- Task 2.2: 민감 데이터 스크러빙 프로세서 구현 (password, token, 주민번호, 전화번호)
- Task 2.3: `CorrelationIdMiddleware` 구현 (UUID v4 request_id 생성)
- Task 2.4: 환경별 로그 레벨 설정 (staging: DEBUG, production: INFO)
- Task 2.5: 로그 로테이션 설정 (100MB, 최대 7개 파일)
- Task 2.6: 로깅 단위 테스트 (스크러빙, correlation ID 전파 검증)

**관련 요구사항**: REQ-INFRA-002-21~25

**위험 요소**:
- structlog contextvars가 asyncio 환경에서 올바르게 전파되지 않을 수 있음
- **대응**: pytest에서 async context 전파 테스트 추가

---

### Milestone 3: Graceful Shutdown 및 시그널 처리 (Priority: High)

**목표**: 데이터 무결성을 보장하는 안전한 종료 프로세스 구현

**태스크:**
- Task 3.1: FastAPI lifespan shutdown 이벤트 핸들러 구현
- Task 3.2: Celery `task_acks_late=True` 및 graceful shutdown 설정
- Task 3.3: Docker Compose `stop_grace_period: 30s` 및 `stop_signal: SIGTERM` 설정
- Task 3.4: shutdown 시나리오 테스트 (진행 중인 요청 완료 확인)

**관련 요구사항**: REQ-INFRA-002-17~20

**위험 요소**:
- Docker SIGTERM 이후 30초 내에 Celery long-running task가 완료되지 않을 수 있음
- **대응**: Celery soft_time_limit을 25초로 설정하여 graceful period 내 완료 보장

---

### Milestone 4: 데이터베이스 백업 및 재해 복구 (Priority: High)

**목표**: 자동화된 백업 시스템 및 복구 절차 구축

**태스크:**
- Task 4.1: `scripts/backup_db.sh` 백업 스크립트 작성 (pg_dump + gzip)
- Task 4.2: 30일 롤링 삭제 로직 구현
- Task 4.3: S3 업로드 옵션 구현 (AWS CLI 기반)
- Task 4.4: `scripts/verify_backup.sh` 백업 검증 스크립트 작성
- Task 4.5: cron 스케줄 설정 가이드 작성
- Task 4.6: `docs/disaster-recovery.md` PITR 복구 가이드 작성
- Task 4.7: 백업 실패 시 경고 로그 메커니즘 구현

**관련 요구사항**: REQ-INFRA-002-01~07

**위험 요소**:
- pgvector 데이터가 pg_dump에서 누락될 수 있음
- **대응**: 백업 검증 시 vector 테이블 존재 및 행 수 확인

---

### Milestone 5: 스테이징 환경 (Priority: Medium)

**목표**: 프로덕션과 유사한 스테이징 환경 구축

**태스크:**
- Task 5.1: `docker-compose.staging.yml` 작성
- Task 5.2: `.env.staging` 및 `.env.production` 템플릿 작성
- Task 5.3: `scripts/seed_staging.py` 샘플 데이터 시딩 스크립트 작성
- Task 5.4: `scripts/deploy_staging.sh` 배포 스크립트 작성
- Task 5.5: `Dockerfile.prod` 프로덕션용 Docker 이미지 작성 (backend, frontend)

**관련 요구사항**: REQ-INFRA-002-08~11

**위험 요소**:
- 개발용 docker-compose.yml과 스테이징 설정 간 불일치
- **대응**: extends 또는 override 파일 활용으로 설정 중복 최소화

---

### Milestone 6: 리소스 제한 및 쿼터 (Priority: Medium)

**목표**: 프로덕션 환경의 리소스 사용량 제어

**태스크:**
- Task 6.1: `docker-compose.prod.yml` 작성 (리소스 제한 포함)
- Task 6.2: PostgreSQL 튜닝 파라미터 설정 (max_connections, shared_buffers 등)
- Task 6.3: Redis maxmemory 및 eviction 정책 설정
- Task 6.4: Celery concurrency 및 prefetch 설정

**관련 요구사항**: REQ-INFRA-002-26~30

**위험 요소**:
- 리소스 제한이 너무 빡빡하면 OOM 발생 가능
- **대응**: 스테이징에서 부하 테스트 후 프로덕션 적용

---

## 기술 접근

### 백업 전략

- **방식**: pg_dump (logical backup) + gzip 압축
- **스케줄**: 매일 KST 02:00 (트래픽 최소 시간대)
- **보관**: 30일 롤링 (로컬) + 선택적 S3 업로드
- **검증**: 매주 일요일 자동 복원 테스트
- **복구**: PITR 문서화 (WAL 기반은 향후 고려)

### 헬스체크 전략

- **3-tier 구조**: liveness (기본) / readiness (컴포넌트) / live (오케스트레이션)
- **타임아웃**: 각 컴포넌트 확인에 3초 타임아웃
- **캐싱**: readiness 결과를 5초간 캐싱하여 과도한 DB ping 방지

### 로깅 전략

- **포맷**: JSON (structlog)
- **Correlation**: UUID v4 request_id, 요청 헤더 X-Request-ID 지원
- **스크러빙**: 정규식 기반 민감 데이터 마스킹
- **로테이션**: 100MB 파일 크기, 최대 7개 보관

---

## 의존성

### 외부 의존성

| 패키지 | 용도 | 현재 설치 여부 |
|--------|------|-------------|
| structlog | 구조화 로깅 | 설치됨 (tech.md 기준 24.x) |
| celery | 비동기 태스크 | 설치됨 (tech.md 기준 5.x) |
| redis | 캐시/브로커 | 설치됨 (tech.md 기준 7.x) |
| asyncpg | PostgreSQL async 드라이버 | 설치됨 |
| boto3 | S3 업로드 (선택적) | 미설치 (필요 시 추가) |

### 내부 의존성

- SPEC-INFRA-001: Docker Compose 기본 구성, GitHub Actions CI
- SPEC-AUTH-001: JWT 토큰 스크러빙 대상

---

## 구현 순서 권장

1. **Milestone 1** (헬스체크) -> 프로덕션 배포 전 필수
2. **Milestone 2** (로깅) -> 운영 가시성 확보
3. **Milestone 3** (Graceful Shutdown) -> 데이터 무결성 보장
4. **Milestone 4** (백업) -> 데이터 보호
5. **Milestone 5** (스테이징) -> 배포 전 검증 환경
6. **Milestone 6** (리소스 제한) -> 안정적 운영

---

**SPEC-INFRA-002 Plan** | 상태: Draft | 작성일: 2026-03-14
