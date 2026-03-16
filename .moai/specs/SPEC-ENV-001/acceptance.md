# SPEC-ENV-001: 수락 기준

## TAG

`SPEC-ENV-001` `env` `configuration` `cleanup`

---

## ACC-01: 중복 backend prod 예시 파일 삭제 (REQ-01)

### Given-When-Then

**Given** `backend/.env.prod.example` 파일이 존재할 때
**When** SPEC-ENV-001 구현이 완료되면
**Then** `backend/.env.prod.example` 파일이 프로젝트에서 삭제되어야 한다

### 검증 방법

- `ls backend/.env.prod.example` 실행 시 "No such file" 반환
- `git status`에서 deleted 상태로 표시
- `git log --oneline -1` 커밋 메시지에 삭제 사유 포함

---

## ACC-02: 죽은 frontend prod 예시 파일 삭제 (REQ-02)

### Given-When-Then

**Given** `frontend/.env.prod.example` 파일이 존재할 때
**When** SPEC-ENV-001 구현이 완료되면
**Then** `frontend/.env.prod.example` 파일이 프로젝트에서 삭제되어야 한다

### 검증 방법

- `ls frontend/.env.prod.example` 실행 시 "No such file" 반환
- `git status`에서 deleted 상태로 표시

---

## ACC-03: 루트 .env.prod.example 완전성 (REQ-03)

### Given-When-Then

**Given** `backend/app/core/config.py`에 40개 이상의 환경변수가 정의되어 있을 때
**When** `.env.prod.example`을 업데이트하면
**Then** config.py의 모든 환경변수가 예시 파일에 포함되어야 한다

### 검증 항목

다음 변수 그룹이 `.env.prod.example`에 포함되어야 한다:

| 변수 그룹 | 변수 목록 | 필수 여부 |
|-----------|-----------|-----------|
| Chat AI | CHAT_MODEL, CHAT_MAX_TOKENS, CHAT_TEMPERATURE, CHAT_HISTORY_LIMIT, CHAT_CONTEXT_TOP_K, CHAT_CONTEXT_THRESHOLD | 필수 |
| 임베딩 | EMBEDDING_MODEL, EMBEDDING_DIMENSIONS | 필수 |
| RAG 청크 | CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS | 필수 |
| LLM 라우팅 | LLM_PRIMARY_MODEL, LLM_FALLBACK_MODEL, LLM_CLASSIFIER_MODEL, LLM_CONFIDENCE_THRESHOLD, LLM_FALLBACK_ON_LOW_CONFIDENCE, LLM_COST_TRACKING_ENABLED | 필수 |
| 크롤러 | CRAWLER_STORAGE_BACKEND, CRAWLER_BASE_DIR, CRAWLER_RATE_LIMIT_SECONDS, CRAWLER_MAX_RETRIES | 필수 |
| Gemini | GEMINI_API_KEY (GOOGLE_API_KEY 대신) | 필수 |

### 검증 방법

```bash
# config.py의 모든 필드명을 대문자로 변환하여 .env.prod.example에 존재하는지 확인
python3 -c "
import re
with open('backend/app/core/config.py') as f:
    fields = re.findall(r'^\s+(\w+):\s+\w+', f.read(), re.MULTILINE)
with open('.env.prod.example') as f:
    env_content = f.read()
missing = [f for f in fields if f.upper() not in env_content and f != 'model_config']
print('Missing:', missing if missing else 'None - All variables present')
"
```

---

## ACC-04: 스테이징 예시 파일 생성 (REQ-04)

### Given-When-Then

**Given** `docker-compose.staging.yml`이 `.env.staging`을 참조하고 있을 때
**When** SPEC-ENV-001 구현이 완료되면
**Then** `.env.staging.example` 파일이 루트에 생성되어야 한다

### 검증 항목

- `.env.staging.example` 파일이 루트 디렉토리에 존재
- `.env.prod.example`과 동일한 변수 세트를 포함
- 스테이징 환경에 적합한 기본값 포함:
  - `DEBUG=true`
  - 스테이징 도메인 플레이스홀더
  - 적절한 로그 레벨 설정
- 파일 상단에 스테이징 환경 설명 주석 포함
- `.env.staging` 생성 명령어 안내 포함

### 검증 방법

```bash
# 파일 존재 확인
test -f .env.staging.example && echo "EXISTS" || echo "MISSING"

# prod와 동일한 변수 세트 확인 (주석 제외 변수명만 비교)
diff <(grep -oP '^\w+=' .env.prod.example | sort) \
     <(grep -oP '^\w+=' .env.staging.example | sort)
```

---

## ACC-05: 개발 환경 예시 파일 완전성 (REQ-05)

### Given-When-Then

**Given** `backend/.env.example`에 일부 config.py 변수가 누락되어 있을 때
**When** SPEC-ENV-001 구현이 완료되면
**Then** `backend/.env.example`에 config.py의 모든 환경변수가 포함되어야 한다

### 검증 항목

다음 변수가 `backend/.env.example`에 추가되어야 한다:

- `CHAT_MODEL`, `CHAT_MAX_TOKENS`, `CHAT_TEMPERATURE`
- `CHAT_HISTORY_LIMIT`, `CHAT_CONTEXT_TOP_K`, `CHAT_CONTEXT_THRESHOLD`
- `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`
- `CHUNK_SIZE_TOKENS`, `CHUNK_OVERLAP_TOKENS`
- `LLM_CLASSIFIER_MODEL`, `LLM_CONFIDENCE_THRESHOLD`
- `LLM_FALLBACK_ON_LOW_CONFIDENCE`, `LLM_COST_TRACKING_ENABLED`
- `CRAWLER_RATE_LIMIT_SECONDS`, `CRAWLER_MAX_RETRIES`

### 검증 방법

```bash
# 누락 변수 확인
for var in CHAT_MODEL CHAT_MAX_TOKENS CHAT_TEMPERATURE CHAT_HISTORY_LIMIT \
           CHAT_CONTEXT_TOP_K CHAT_CONTEXT_THRESHOLD EMBEDDING_MODEL \
           EMBEDDING_DIMENSIONS CHUNK_SIZE_TOKENS CHUNK_OVERLAP_TOKENS \
           LLM_CLASSIFIER_MODEL LLM_CONFIDENCE_THRESHOLD \
           LLM_FALLBACK_ON_LOW_CONFIDENCE LLM_COST_TRACKING_ENABLED \
           CRAWLER_RATE_LIMIT_SECONDS CRAWLER_MAX_RETRIES; do
  grep -q "^${var}=" backend/.env.example || echo "MISSING: $var"
done
```

---

## ACC-06: docker-compose 참조 주석 (REQ-06)

### Given-When-Then

**Given** docker-compose 파일에 `env_file` 설정이 있을 때
**When** SPEC-ENV-001 구현이 완료되면
**Then** 각 docker-compose 파일의 `env_file` 근처에 해당 예시 파일 경로 주석이 존재해야 한다

### 검증 항목

| 파일 | 예상 주석 |
|------|-----------|
| `docker-compose.yml` | `backend/.env.example`, `frontend/.env.example` 참조 |
| `docker-compose.prod.yml` | `.env.prod.example` 참조 |
| `docker-compose.staging.yml` | `.env.staging.example` 참조 |

### 검증 방법

```bash
grep -l "env.example\|env.prod.example\|env.staging.example" docker-compose*.yml
```

---

## ACC-07: README 환경변수 섹션 (REQ-07)

### Given-When-Then

**Given** 프로젝트 루트에 README.md가 있을 때
**When** SPEC-ENV-001 구현이 완료되면
**Then** README.md에 "Environment Configuration" 또는 동등한 한글 제목의 섹션이 존재해야 한다

### 검증 항목

README.md 환경 설정 섹션에 다음 내용이 포함되어야 한다:

- 환경별 파일 매핑 테이블 (dev, staging, prod)
- 각 예시 파일 경로 및 용도 설명
- `cp` 명령어를 포함한 설정 파일 생성 가이드
- Vercel 프론트엔드 환경변수 관리 안내
- 환경 파일을 git에 커밋하지 않도록 경고

### 검증 방법

```bash
grep -c "환경\|Environment\|env.*설정\|env.*config" README.md
```

---

## Definition of Done

SPEC-ENV-001은 다음 조건을 모두 만족할 때 완료로 판단한다:

1. `backend/.env.prod.example` 삭제됨
2. `frontend/.env.prod.example` 삭제됨
3. `.env.prod.example`에 config.py의 모든 40개 환경변수가 포함됨
4. `.env.staging.example`이 루트에 생성되고 prod와 동일한 변수 세트를 포함함
5. `backend/.env.example`에 누락되었던 17개 변수가 추가됨
6. 3개 docker-compose 파일에 예시 파일 참조 주석이 있음
7. README.md에 환경 설정 섹션이 추가됨
8. 모든 변경사항이 하나의 논리적 커밋으로 기록됨
