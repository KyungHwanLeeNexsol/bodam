---
spec_id: SPEC-DEPLOY-001
title: 3개 보험사 MVP Fly.io 배포 - 구현 계획
version: 1.0.0
created: 2026-03-28
updated: 2026-03-28
author: zuge3
---

# SPEC-DEPLOY-001: 구현 계획

## 의존성 순서

```
M1 (PostgreSQL 셋업) → M2 (데이터 인제스트) → M3 (백엔드 배포) → M4 (프론트엔드 연동)
```

모든 모듈은 순차적 의존 관계를 가진다. 병렬 실행 불가.

---

## Module 1: Fly.io PostgreSQL 셋업

### 태스크 분해

| 태스크 | 설명 | 명령어/도구 |
|--------|------|-------------|
| M1-T1 | Fly.io PostgreSQL 클러스터 생성 | `fly postgres create --name bodam-db --region sin --vm-size shared-cpu-1x --volume-size 10` |
| M1-T2 | 앱에 DB 연결 (attach) | `fly postgres attach bodam-db --app bodam` |
| M1-T3 | pgvector 확장 설치 | `fly postgres connect -a bodam-db` 후 `CREATE EXTENSION IF NOT EXISTS vector;` |
| M1-T4 | Alembic 마이그레이션 실행 | `fly ssh console -a bodam` 또는 로컬에서 DATABASE_URL로 직접 실행 |
| M1-T5 | 테이블 생성 검증 | SQL 쿼리로 insurance_companies, insurance_products, policy_documents, policy_chunks 확인 |

### 기술 세부사항

- Fly Postgres는 관리형이 아닌 self-managed PostgreSQL이므로, pgvector 설치를 직접 해야 할 수 있다
- `fly postgres connect`로 psql 세션 접속 후 확장 설치
- Alembic은 로컬에서 DATABASE_URL을 Fly.io 프록시(`fly proxy 5432 -a bodam-db`)로 설정하여 실행 가능
- 디스크 크기는 10GB로 시작, 필요 시 `fly volumes extend`로 확장

### 예상 비용

| 항목 | 사양 | 월 비용 |
|------|------|---------|
| Postgres VM | shared-cpu-1x, 256MB | ~$1.94 |
| 디스크 | 10GB | ~$1.50 |
| **소계** | | **~$3.44** |

---

## Module 2: 3개사 데이터 인제스트 + 임베딩

### 태스크 분해

| 태스크 | 설명 | 명령어/도구 |
|--------|------|-------------|
| M2-T1 | Fly.io DB 프록시 설정 | `fly proxy 5432 -a bodam-db` (로컬에서 원격 DB 접근) |
| M2-T2 | DATABASE_URL 환경변수 설정 | `postgresql+asyncpg://user:pass@localhost:5432/bodam` |
| M2-T3 | 현대해상 인제스트 + 임베딩 | `python scripts/ingest_local_pdfs.py --company hyundai_marine --embed` |
| M2-T4 | 현대해상 검증 | SQL 쿼리로 레코드 수, NULL 임베딩 확인 |
| M2-T5 | DB손보 인제스트 + 임베딩 | `python scripts/ingest_local_pdfs.py --company db_insurance --embed` |
| M2-T6 | DB손보 검증 | SQL 쿼리로 레코드 수, NULL 임베딩 확인 |
| M2-T7 | 삼성화재 인제스트 + 임베딩 | `python scripts/ingest_local_pdfs.py --company samsung_fire --embed` |
| M2-T8 | 삼성화재 검증 | SQL 쿼리로 레코드 수, NULL 임베딩 확인 |
| M2-T9 | 전체 데이터 무결성 검증 | 전체 레코드 수, NULL 임베딩 0건, 보험사별 분포 확인 |

### 기술 세부사항

- **인제스트 방식**: 로컬에서 Fly.io DB로 직접 인제스트 (fly proxy 활용)
- **임베딩 모델**: BAAI/bge-m3 (1024 차원, 로컬 실행)
- **처리 순서**: PDF 수 오름차순 (현대해상 526 -> DB손보 2,103 -> 삼성화재 3,692)
- **실패 복구**: 보험사별 독립 처리이므로 실패 시 해당 보험사만 재실행
- **크롤링 스킵**: 이미 로컬에 PDF가 있으므로 `--skip-crawl` 불필요 (ingest_local_pdfs.py 직접 사용)

### 예상 데이터 크기

| 보험사 | PDF 수 | 예상 청크 수 | 예상 DB 크기 |
|--------|--------|-------------|-------------|
| 현대해상 | 526 | ~15,000 | ~1-2GB |
| DB손보 | 2,103 | ~60,000 | ~4-6GB |
| 삼성화재 | 3,692 | ~110,000 | ~7-10GB |
| **합계** | **6,321** | **~185,000** | **~12-18GB** |

> 주의: 10GB 디스크로 시작 시 부족할 수 있다. M2-T4 검증 후 디스크 사용량 확인 필요.

### 임베딩 처리 시간 추정

- BAAI/bge-m3 로컬 실행 (CPU): 청크당 ~0.5-1초
- 185,000 청크 x 0.75초 = ~38시간 (CPU 기준)
- GPU 사용 시: ~4-8시간
- 배치 처리로 최적화 가능

---

## Module 3: 백엔드 Fly.io 배포

### 태스크 분해

| 태스크 | 설명 | 명령어/도구 |
|--------|------|-------------|
| M3-T1 | fly.toml 검토 및 필요 시 수정 | 현재 설정 확인: shared-cpu-1x, 512MB, health check |
| M3-T2 | Fly.io 환경 변수 설정 | `fly secrets set DATABASE_URL=... SECRET_KEY=... GEMINI_API_KEY=...` |
| M3-T3 | 백엔드 배포 | `fly deploy` |
| M3-T4 | 배포 상태 확인 | `fly status --app bodam` |
| M3-T5 | Health 엔드포인트 검증 | `curl https://bodam.fly.dev/api/v1/health` |
| M3-T6 | 로그 모니터링 | `fly logs --app bodam` |

### 기술 세부사항

- **Dockerfile**: backend/Dockerfile (Python 3.13-slim, uv, uvicorn)
- **빌드 컨텍스트**: fly.toml의 `[build]` 섹션에서 `dockerfile = 'backend/Dockerfile'` 지정
- **환경 변수 관리**: `fly secrets set`으로 개별 설정, `.env` 파일 절대 커밋 금지
- **auto_stop_machines**: "stop"으로 설정되어 트래픽 없으면 자동 정지 (비용 절감)
- **auto_start_machines**: true로 설정되어 요청 시 자동 시작

### 예상 비용

| 항목 | 사양 | 월 비용 |
|------|------|---------|
| Backend VM | shared-cpu-1x, 512MB (auto-stop) | ~$0-3.50 (사용량 기반) |
| **소계** | | **~$0-3.50** |

---

## Module 4: 프론트엔드 연동 검증

### 태스크 분해

| 태스크 | 설명 | 도구 |
|--------|------|------|
| M4-T1 | CORS 설정 확인 | `fly secrets` 또는 환경변수에서 ALLOWED_ORIGINS 확인 |
| M4-T2 | Vercel 환경 변수 업데이트 | Vercel 대시보드에서 NEXT_PUBLIC_API_URL 설정 |
| M4-T3 | 프론트엔드 재배포 | Vercel 자동 배포 또는 수동 트리거 |
| M4-T4 | CORS preflight 테스트 | `curl -X OPTIONS` 으로 확인 |
| M4-T5 | 채팅 기능 E2E 테스트 | 브라우저에서 3개 보험사 질의 테스트 |
| M4-T6 | 스트리밍 응답 확인 | 실시간 텍스트 출력 확인 |
| M4-T7 | 에러 응답 형식 확인 | 의도적 잘못된 요청으로 에러 형식 검증 |

### 기술 세부사항

- **CORS**: ALLOWED_ORIGINS에 `https://bodam-one.vercel.app` 포함
- **API URL**: 프론트엔드 환경 변수로 `https://bodam.fly.dev` 설정
- **스트리밍**: Vercel AI SDK의 useChat hook으로 SSE 스트리밍
- **에러 처리**: ENVIRONMENT=production에서 스택 트레이스 비노출 확인

---

## 기술 스택 요약

| 카테고리 | 기술 | 버전/사양 |
|----------|------|-----------|
| Backend | FastAPI + uvicorn | Python 3.13 |
| Frontend | Next.js + Vercel | 16.1.6 |
| Database | PostgreSQL + pgvector | Fly.io Postgres |
| Embedding | BAAI/bge-m3 | 1024 차원 |
| LLM | Gemini 2.0 Flash | 채팅 응답 생성 |
| Infra | Fly.io (backend), Vercel (frontend) | sin 리전 |

---

## 리스크 분석

| 리스크 | 심각도 | 영향 | 대응 방안 |
|--------|--------|------|-----------|
| DB 디스크 부족 (10GB로 시작, 12-18GB 예상) | 높음 | 인제스트 중단 | 사전에 20GB로 볼륨 생성 또는 인제스트 중 모니터링 후 `fly volumes extend` |
| 임베딩 생성 시간 과다 (CPU 38시간 추정) | 높음 | 배포 일정 지연 | GPU 사용 또는 배치 크기 최적화, 보험사 단위 분할 처리 |
| Fly.io PostgreSQL에서 pgvector 미지원 | 중간 | DB 셋업 실패 | Neon PostgreSQL로 대체 (기존 SPEC-INFRA-003 참조) |
| 메모리 부족으로 인제스트 실패 | 중간 | 특정 보험사 인제스트 중단 | 배치 크기 축소, 메모리 모니터링 |
| Fly.io auto-stop 후 첫 요청 지연 (cold start) | 낮음 | UX 저하 | MVP에서는 허용, 추후 min_machines_running=1 설정 |
| CORS 설정 오류 | 낮음 | 프론트엔드 연동 실패 | ALLOWED_ORIGINS 값 재확인 |

---

## 예상 총 비용 (월간)

| 항목 | 월 비용 |
|------|---------|
| Fly.io Postgres (shared-cpu-1x, 10-20GB) | ~$3.44-5.00 |
| Fly.io Backend (shared-cpu-1x, 512MB, auto-stop) | ~$0-3.50 |
| Vercel Frontend (Free tier) | $0 |
| Gemini API (MVP 사용량) | ~$1-5 |
| **합계** | **~$4.44-13.50/월** |
