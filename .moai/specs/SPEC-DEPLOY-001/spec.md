---
id: SPEC-DEPLOY-001
title: 3개 보험사 MVP Fly.io 배포
version: 1.0.0
status: Planned
created: 2026-03-28
updated: 2026-03-28
author: zuge3
priority: High
issue_number: 0
tags: [deployment, fly.io, postgresql, pgvector, mvp]
lifecycle: spec-first
---

# SPEC-DEPLOY-001: 3개 보험사 MVP Fly.io 배포

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-28 | zuge3 | 최초 작성 |

---

## 1. Environment (환경)

### 1.1 프로젝트 컨텍스트

Bodam은 AI 기반 보험 청구 안내 플랫폼이다. 31개 보험사 중 3개사(현대해상, DB손보, 삼성화재)만으로 MVP를 배포하여 실사용 검증을 수행한다.

### 1.2 기존 인프라

| 구성 요소 | 현재 상태 | 비고 |
|-----------|----------|------|
| Backend | FastAPI (Python 3.13) | Dockerfile 작성 완료 |
| Frontend | Next.js 16 on Vercel | 배포 완료 |
| fly.toml | 작성 완료 | app "bodam", region "sin", shared-cpu-1x, 512MB |
| DB 마이그레이션 | CockroachDB -> PostgreSQL 완료 | commit d13abf9 |
| Alembic 마이그레이션 | 작성 완료 | pgvector extension, insurance tables |
| PDF 데이터 | 3개사 로컬 크롤링 완료 | 총 6,321개 PDF |
| 파이프라인 스크립트 | 작성 완료 | run_ingest_pipeline.sh, ingest_local_pdfs.py, backfill_embeddings.py |
| 임베딩 모델 | BAAI/bge-m3 (1024 dimensions) | 로컬 모델 |
| .env.fly.example | 작성 완료 | PostgreSQL 연결 템플릿 포함 |

### 1.3 도메인 용어

| 용어 | 설명 |
|------|------|
| 인제스트(Ingest) | PDF를 파싱하여 텍스트 청크로 분할 후 DB에 저장하는 과정 |
| 임베딩(Embedding) | 텍스트 청크를 벡터로 변환하여 유사도 검색이 가능하게 하는 과정 |
| pgvector | PostgreSQL 벡터 검색 확장 |
| BAAI/bge-m3 | 1024 차원 다국어 임베딩 모델 (로컬 실행) |
| 파이프라인 | 크롤링 > 인제스트 > 임베딩 순차 처리 워크플로우 |

### 1.4 대상 보험사 데이터

| 보험사 | 디렉토리 | PDF 수 | company_id |
|--------|---------|--------|------------|
| 현대해상 | backend/data/hyundai_marine/ | 526 | hyundai_marine |
| DB손보 | backend/data/db_insurance/ | 2,103 | db_insurance |
| 삼성화재 | backend/data/samsung_fire/ | 3,692 | samsung_fire |
| **합계** | | **6,321** | |

### 1.5 범위 외 (Out of Scope)

- 나머지 28개 보험사 데이터 인제스트
- CI/CD 자동화 파이프라인 구축
- 모니터링 스택(Grafana, Prometheus 등) 설정
- 커스텀 도메인 설정 (bodam.fly.dev 사용)
- Redis/캐시 레이어 설정
- OAuth 소셜 로그인 연동 (MVP에서 제외 가능)
- 부하 테스트 및 성능 최적화

---

## 2. Assumptions (가정)

| ID | 가정 | 근거 | 위험도 |
|----|------|------|--------|
| ASM-01 | Fly.io PostgreSQL에서 pgvector 확장을 설치할 수 있다 | Fly Postgres는 표준 PostgreSQL이므로 확장 설치 가능 | 낮음 |
| ASM-02 | 6,321개 PDF의 인제스트 + 임베딩이 로컬에서 완료 가능하다 | 로컬 BAAI/bge-m3 모델 사용, API 비용 없음 | 중간 |
| ASM-03 | Fly.io 최소 사양(shared-cpu-1x, 512MB)으로 MVP 서빙이 가능하다 | 동시 사용자가 적은 MVP 단계 | 중간 |
| ASM-04 | 3개사 데이터의 DB 크기가 10-20GB 이내이다 | 청크 + 1024차원 임베딩 기준 추정치 | 중간 |
| ASM-05 | 기존 Alembic 마이그레이션이 Fly.io PostgreSQL에서 정상 실행된다 | CockroachDB -> PostgreSQL 마이그레이션 코드 커밋 완료 | 낮음 |
| ASM-06 | Vercel 프론트엔드에서 Fly.io 백엔드로의 CORS 연결이 정상 작동한다 | .env.fly.example에 ALLOWED_ORIGINS 설정 존재 | 낮음 |
| ASM-07 | 임베딩 생성 시간이 로컬 GPU/CPU로 허용 가능한 수준이다 | bge-m3 로컬 실행, 대략 6,321개 PDF 처리 필요 | 높음 |
| ASM-08 | Fly.io PostgreSQL 비용이 월 $3.5-5 수준이다 | 최소 사양 기준 Fly.io 가격표 | 낮음 |

---

## 3. Requirements (요구사항)

### Module 1: Fly.io PostgreSQL 셋업 (REQ-M1)

**REQ-M1-01** (Ubiquitous)
시스템은 **항상** Fly.io PostgreSQL 인스턴스를 sin(싱가포르) 리전에 최소 사양으로 생성해야 한다.

- 사양: 1 shared CPU, 256MB RAM, 10GB 디스크 (또는 최소 요금제)
- 리전: sin (싱가포르, 백엔드 앱과 동일 리전)

**REQ-M1-02** (Event-Driven)
**WHEN** PostgreSQL 인스턴스가 생성되면 **THEN** pgvector 확장을 설치해야 한다.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**REQ-M1-03** (Event-Driven)
**WHEN** pgvector 확장이 설치되면 **THEN** Alembic 마이그레이션을 실행하여 모든 테이블을 생성해야 한다.

```bash
alembic upgrade head
```

**REQ-M1-04** (Event-Driven)
**WHEN** 마이그레이션이 완료되면 **THEN** 다음 테이블이 정상 생성되었는지 검증해야 한다.

- insurance_companies
- insurance_products
- policy_documents
- policy_chunks (vector(1024) 컬럼 포함)

---

### Module 2: 3개사 데이터 인제스트 + 임베딩 (REQ-M2)

**REQ-M2-01** (Event-Driven)
**WHEN** PostgreSQL 셋업이 완료되면(REQ-M1 완료) **THEN** 보험사별 순차적으로 인제스트 파이프라인을 실행해야 한다.

- 처리 순서: 현대해상 -> DB손보 -> 삼성화재 (PDF 수 오름차순)
- 각 보험사 처리: ingest_local_pdfs.py --company {company_id} --embed

**REQ-M2-02** (Ubiquitous)
시스템은 **항상** BAAI/bge-m3 모델로 1024 차원 임베딩을 생성해야 한다.

- 임베딩 모델: BAAI/bge-m3
- 차원: 1024
- Gemini API 임베딩 사용 금지

**REQ-M2-03** (Event-Driven)
**WHEN** 각 보험사 인제스트가 완료되면 **THEN** 데이터 무결성을 검증해야 한다.

- policy_documents 레코드 수 확인
- policy_chunks 레코드 수 확인
- 임베딩이 NULL인 청크가 없는지 확인
- 보험사별 예상 PDF 수와 실제 인제스트 수 비교

**REQ-M2-04** (Unwanted)
시스템은 한 보험사의 인제스트 실패가 다른 보험사의 데이터에 영향을 미치게 **하지 않아야 한다**.

- 각 보험사는 독립적으로 처리
- 실패 시 해당 보험사만 재시도

**REQ-M2-05** (State-Driven)
**IF** 임베딩 생성이 메모리 부족으로 실패하면 **THEN** 배치 크기를 줄여 재시도해야 한다.

---

### Module 3: 백엔드 Fly.io 배포 (REQ-M3)

**REQ-M3-01** (Event-Driven)
**WHEN** 데이터 인제스트가 완료되면(REQ-M2 완료) **THEN** fly.toml 설정을 검토하고 필요시 업데이트해야 한다.

- 현재 설정: shared-cpu-1x, 512MB, sin 리전
- health check 경로: /api/v1/health

**REQ-M3-02** (Event-Driven)
**WHEN** 배포 준비가 완료되면 **THEN** Fly.io 환경 변수를 설정해야 한다.

필수 환경 변수:
- DATABASE_URL: Fly.io 내부 PostgreSQL 연결 문자열
- SECRET_KEY: JWT 서명 키
- GEMINI_API_KEY: Gemini 2.0 Flash API 키
- ALLOWED_ORIGINS: Vercel 프론트엔드 도메인
- EMBEDDING_MODEL: BAAI/bge-m3 (참고용, 서빙 시 임베딩은 쿼리 시 생성)
- ENVIRONMENT: production
- CHAT_MODEL: gemini-2.0-flash

**REQ-M3-03** (Event-Driven)
**WHEN** 환경 변수가 설정되면 **THEN** `fly deploy` 명령으로 백엔드를 배포해야 한다.

**REQ-M3-04** (Event-Driven)
**WHEN** 배포가 완료되면 **THEN** health 엔드포인트가 정상 응답하는지 검증해야 한다.

```bash
curl https://bodam.fly.dev/api/v1/health
```

- 예상 응답: HTTP 200
- 타임아웃: 30초 이내

**REQ-M3-05** (Unwanted)
시스템은 .env 파일이나 시크릿 키를 Docker 이미지에 포함**하지 않아야 한다**.

- 모든 시크릿은 `fly secrets set`으로 관리

---

### Module 4: 프론트엔드 연동 검증 (REQ-M4)

**REQ-M4-01** (Event-Driven)
**WHEN** 백엔드 배포가 완료되면(REQ-M3 완료) **THEN** CORS 설정을 확인해야 한다.

- ALLOWED_ORIGINS에 Vercel 프론트엔드 도메인 포함 확인
- OPTIONS preflight 요청 정상 응답 확인

**REQ-M4-02** (Event-Driven)
**WHEN** CORS 설정이 확인되면 **THEN** Vercel 프론트엔드의 API 엔드포인트를 Fly.io 백엔드로 설정해야 한다.

- 프론트엔드 환경 변수: NEXT_PUBLIC_API_URL=https://bodam.fly.dev

**REQ-M4-03** (Event-Driven)
**WHEN** 프론트엔드-백엔드 연동이 완료되면 **THEN** 채팅 기능을 실제 데이터로 테스트해야 한다.

테스트 시나리오:
- 3개 보험사에 대한 보험 상품 질의
- RAG 기반 응답에 실제 약관 내용이 포함되는지 확인
- 스트리밍 응답이 정상 작동하는지 확인

**REQ-M4-04** (Unwanted)
시스템은 프론트엔드에서 백엔드 내부 에러 상세(스택 트레이스 등)를 노출**하지 않아야 한다**.

- ENVIRONMENT=production에서 디버그 정보 비노출

---

## 4. Acceptance Criteria (수락 기준)

| ID | 기준 | 검증 방법 |
|----|------|-----------|
| ACC-01 | Fly.io PostgreSQL 인스턴스가 sin 리전에 생성되었다 | `fly postgres list`로 확인 |
| ACC-02 | pgvector 확장이 설치되었다 | `SELECT * FROM pg_extension WHERE extname = 'vector';` |
| ACC-03 | Alembic 마이그레이션이 성공적으로 실행되었다 | `alembic current`로 head 확인 |
| ACC-04 | 현대해상 데이터가 정상 인제스트되었다 | policy_documents에서 company='hyundai_marine' 레코드 확인 |
| ACC-05 | DB손보 데이터가 정상 인제스트되었다 | policy_documents에서 company='db_insurance' 레코드 확인 |
| ACC-06 | 삼성화재 데이터가 정상 인제스트되었다 | policy_documents에서 company='samsung_fire' 레코드 확인 |
| ACC-07 | 모든 policy_chunks에 임베딩이 존재한다 | `SELECT COUNT(*) FROM policy_chunks WHERE embedding IS NULL;` 결과 0 |
| ACC-08 | 백엔드 health 엔드포인트가 200을 반환한다 | `curl -s -o /dev/null -w "%{http_code}" https://bodam.fly.dev/api/v1/health` |
| ACC-09 | 프론트엔드에서 백엔드 API 호출이 성공한다 | Vercel 배포된 프론트엔드에서 채팅 테스트 |
| ACC-10 | 채팅 응답에 실제 약관 데이터가 포함된다 | 3개 보험사 관련 질문에 RAG 응답 확인 |
| ACC-11 | 스트리밍 응답이 정상 작동한다 | 프론트엔드에서 실시간 텍스트 스트리밍 확인 |
| ACC-12 | 프로덕션 환경에서 디버그 정보가 노출되지 않는다 | 의도적 에러 요청 시 스택 트레이스 미포함 확인 |
