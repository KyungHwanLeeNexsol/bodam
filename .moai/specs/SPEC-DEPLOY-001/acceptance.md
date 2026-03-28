---
spec_id: SPEC-DEPLOY-001
title: 3개 보험사 MVP Fly.io 배포 - 수락 기준
version: 1.0.0
created: 2026-03-28
updated: 2026-03-28
author: zuge3
---

# SPEC-DEPLOY-001: 수락 기준 및 테스트 시나리오

---

## Module 1: Fly.io PostgreSQL 셋업

### TC-M1-01: PostgreSQL 인스턴스 생성 확인

```gherkin
Given Fly.io CLI가 인증된 상태에서
When `fly postgres list` 명령을 실행하면
Then "bodam-db" 인스턴스가 목록에 표시되고
And 리전이 "sin"으로 표시된다
```

### TC-M1-02: pgvector 확장 설치 확인

```gherkin
Given bodam-db PostgreSQL에 연결된 상태에서
When `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';` 쿼리를 실행하면
Then "vector" 확장이 결과에 포함되고
And 버전 정보가 표시된다
```

### TC-M1-03: Alembic 마이그레이션 완료 확인

```gherkin
Given DATABASE_URL이 Fly.io PostgreSQL로 설정된 상태에서
When `alembic current` 명령을 실행하면
Then 현재 리비전이 head와 일치한다
```

### TC-M1-04: 필수 테이블 존재 확인

```gherkin
Given bodam-db PostgreSQL에 연결된 상태에서
When 다음 쿼리를 실행하면:
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN ('insurance_companies', 'insurance_products', 'policy_documents', 'policy_chunks');
Then 4개 테이블이 모두 결과에 포함되고
And policy_chunks 테이블에 vector(1024) 타입의 embedding 컬럼이 존재한다
```

### TC-M1-05 (Edge Case): 디스크 용량 확인

```gherkin
Given bodam-db PostgreSQL 인스턴스가 실행 중인 상태에서
When `fly volumes list -a bodam-db` 명령을 실행하면
Then 볼륨 크기가 최소 10GB 이상이고
And 사용률이 80% 미만이다
```

---

## Module 2: 3개사 데이터 인제스트 + 임베딩

### TC-M2-01: 현대해상 인제스트 성공

```gherkin
Given DATABASE_URL이 Fly.io PostgreSQL로 설정되고
And backend/data/hyundai_marine/ 디렉토리에 526개 PDF가 존재하는 상태에서
When `python scripts/ingest_local_pdfs.py --company hyundai_marine --embed` 명령을 실행하면
Then 명령이 성공적으로 완료되고 (exit code 0)
And policy_documents 테이블에 hyundai_marine 레코드가 존재한다
```

### TC-M2-02: DB손보 인제스트 성공

```gherkin
Given 현대해상 인제스트가 완료된 상태에서
When `python scripts/ingest_local_pdfs.py --company db_insurance --embed` 명령을 실행하면
Then 명령이 성공적으로 완료되고 (exit code 0)
And policy_documents 테이블에 db_insurance 레코드가 존재한다
And 기존 hyundai_marine 데이터가 영향받지 않았다
```

### TC-M2-03: 삼성화재 인제스트 성공

```gherkin
Given DB손보 인제스트가 완료된 상태에서
When `python scripts/ingest_local_pdfs.py --company samsung_fire --embed` 명령을 실행하면
Then 명령이 성공적으로 완료되고 (exit code 0)
And policy_documents 테이블에 samsung_fire 레코드가 존재한다
And 기존 hyundai_marine, db_insurance 데이터가 영향받지 않았다
```

### TC-M2-04: 임베딩 완전성 검증

```gherkin
Given 3개 보험사 인제스트가 모두 완료된 상태에서
When 다음 쿼리를 실행하면:
  SELECT COUNT(*) FROM policy_chunks WHERE embedding IS NULL;
Then 결과가 0이다 (NULL 임베딩 없음)
```

### TC-M2-05: 보험사별 데이터 분포 확인

```gherkin
Given 3개 보험사 인제스트가 모두 완료된 상태에서
When 다음 쿼리를 실행하면:
  SELECT ic.name, COUNT(pd.id) as doc_count
  FROM policy_documents pd
  JOIN insurance_companies ic ON pd.company_id = ic.id
  GROUP BY ic.name;
Then 3개 보험사 모두 레코드가 존재하고
And 각 보험사의 문서 수가 0보다 크다
```

### TC-M2-06 (Edge Case): 인제스트 중단 후 재시도

```gherkin
Given 특정 보험사 인제스트가 중간에 실패한 상태에서
When 동일 보험사에 대해 인제스트 명령을 재실행하면
Then 이미 인제스트된 문서는 중복 생성되지 않고
And 나머지 문서가 정상 처리된다
```

### TC-M2-07 (Edge Case): 디스크 용량 모니터링

```gherkin
Given 인제스트가 진행 중인 상태에서
When 디스크 사용량이 80%를 초과하면
Then 인제스트 프로세스가 에러를 보고하고
And 이미 인제스트된 데이터는 보존된다
```

---

## Module 3: 백엔드 Fly.io 배포

### TC-M3-01: 환경 변수 설정 확인

```gherkin
Given Fly.io CLI가 인증된 상태에서
When `fly secrets list --app bodam` 명령을 실행하면
Then 다음 시크릿이 설정되어 있다:
  | SECRET_NAME     |
  | DATABASE_URL    |
  | SECRET_KEY      |
  | GEMINI_API_KEY  |
  | ALLOWED_ORIGINS |
```

### TC-M3-02: 백엔드 배포 성공

```gherkin
Given fly.toml이 올바르게 설정되고
And 모든 환경 변수가 설정된 상태에서
When `fly deploy` 명령을 실행하면
Then 배포가 성공적으로 완료되고 (exit code 0)
And `fly status --app bodam`에서 "running" 상태가 표시된다
```

### TC-M3-03: Health 엔드포인트 정상 응답

```gherkin
Given 백엔드가 Fly.io에 배포된 상태에서
When `curl -s -o /dev/null -w "%{http_code}" https://bodam.fly.dev/api/v1/health` 명령을 실행하면
Then HTTP 상태 코드가 200이다
And 응답 시간이 30초 이내이다
```

### TC-M3-04 (Edge Case): Cold Start 후 응답

```gherkin
Given 백엔드 머신이 auto-stop으로 정지된 상태에서
When 첫 번째 HTTP 요청이 도착하면
Then 머신이 자동 시작되고
And 30초 이내에 200 응답을 반환한다
```

### TC-M3-05: 시크릿 미포함 확인

```gherkin
Given 백엔드 Docker 이미지가 빌드된 상태에서
When 이미지 내부에 .env 파일 존재 여부를 확인하면
Then .env 파일이 존재하지 않고
And SECRET_KEY, GEMINI_API_KEY 등이 이미지에 하드코딩되지 않았다
```

---

## Module 4: 프론트엔드 연동 검증

### TC-M4-01: CORS Preflight 성공

```gherkin
Given 백엔드가 Fly.io에 배포된 상태에서
When 다음 CORS preflight 요청을 보내면:
  curl -X OPTIONS https://bodam.fly.dev/api/v1/health \
    -H "Origin: https://bodam-one.vercel.app" \
    -H "Access-Control-Request-Method: POST"
Then Access-Control-Allow-Origin 헤더에 "https://bodam-one.vercel.app"이 포함되고
And HTTP 상태 코드가 200이다
```

### TC-M4-02: 프론트엔드 API 연동

```gherkin
Given Vercel에 NEXT_PUBLIC_API_URL=https://bodam.fly.dev가 설정되고
And 프론트엔드가 재배포된 상태에서
When 브라우저에서 프론트엔드에 접속하면
Then 페이지가 정상 로딩되고
And 백엔드 API 호출이 성공한다 (네트워크 탭에서 200 확인)
```

### TC-M4-03: 채팅 기능 테스트 - 현대해상

```gherkin
Given 프론트엔드-백엔드 연동이 완료된 상태에서
When 채팅에 "현대해상 자동차보험 보장 내용 알려줘"를 입력하면
Then 스트리밍 응답이 실시간으로 표시되고
And 응답에 현대해상 약관 관련 내용이 포함된다
```

### TC-M4-04: 채팅 기능 테스트 - DB손보

```gherkin
Given 프론트엔드-백엔드 연동이 완료된 상태에서
When 채팅에 "DB손보 실손보험 청구 절차"를 입력하면
Then 스트리밍 응답이 실시간으로 표시되고
And 응답에 DB손보 약관 관련 내용이 포함된다
```

### TC-M4-05: 채팅 기능 테스트 - 삼성화재

```gherkin
Given 프론트엔드-백엔드 연동이 완료된 상태에서
When 채팅에 "삼성화재 화재보험 보상 범위"를 입력하면
Then 스트리밍 응답이 실시간으로 표시되고
And 응답에 삼성화재 약관 관련 내용이 포함된다
```

### TC-M4-06: 에러 응답 형식 확인

```gherkin
Given ENVIRONMENT=production으로 배포된 상태에서
When 존재하지 않는 API 엔드포인트에 요청하면
Then HTTP 404 응답을 반환하고
And 응답 본문에 스택 트레이스가 포함되지 않고
And JSON 형식의 에러 메시지만 반환된다
```

### TC-M4-07 (Edge Case): 네트워크 에러 처리

```gherkin
Given 프론트엔드가 정상 로딩된 상태에서
When 백엔드 서버가 일시적으로 응답하지 않으면
Then 프론트엔드에 사용자 친화적 에러 메시지가 표시되고
And 페이지가 크래시하지 않는다
```

---

## Quality Gates

| 게이트 | 기준 | 검증 방법 |
|--------|------|-----------|
| DB 셋업 완료 | pgvector 설치 + 4개 테이블 생성 | SQL 쿼리 |
| 데이터 무결성 | 3개사 인제스트 완료 + NULL 임베딩 0건 | SQL 쿼리 |
| 백엔드 가용성 | health 200 응답 + 30초 이내 | curl 테스트 |
| 프론트엔드 연동 | CORS 정상 + 채팅 응답 수신 | 브라우저 테스트 |
| 보안 | 시크릿 미노출 + 디버그 정보 비노출 | 에러 응답 검사 |

---

## Definition of Done

- [ ] Fly.io PostgreSQL 인스턴스 생성 및 pgvector 설치 완료
- [ ] Alembic 마이그레이션 성공 (4개 핵심 테이블 존재)
- [ ] 현대해상 데이터 인제스트 + 임베딩 완료 및 검증
- [ ] DB손보 데이터 인제스트 + 임베딩 완료 및 검증
- [ ] 삼성화재 데이터 인제스트 + 임베딩 완료 및 검증
- [ ] NULL 임베딩 0건 확인
- [ ] 백엔드 Fly.io 배포 성공 및 health 200 확인
- [ ] 환경 변수 `fly secrets`로 안전하게 설정
- [ ] Vercel 프론트엔드 API URL 업데이트 및 재배포
- [ ] CORS preflight 정상 작동 확인
- [ ] 3개 보험사 채팅 질의에 대한 RAG 응답 수신 확인
- [ ] 프로덕션 환경에서 디버그 정보 미노출 확인
