# Secret Rotation Runbook (SPEC-SEC-001 M4)

Bodam 플랫폼 시크릿 로테이션 절차서.
모든 로테이션 작업은 유지보수 창(maintenance window) 내에 수행하고 완료 후 팀에 공지합니다.

---

## 1. JWT_SECRET_KEY 로테이션

**영향 범위**: 로테이션 즉시 모든 기존 로그인 세션 무효화 (사용자 재로그인 필요)

### 사전 준비

1. 로테이션 일정을 사용자에게 공지 (최소 1일 전)
2. 새 시크릿 키 생성:

```bash
openssl rand -hex 32
```

### 로테이션 절차

1. 새 시크릿 키를 시크릿 관리 시스템(AWS Secrets Manager / HashiCorp Vault)에 등록
2. 백엔드 배포 환경변수 `SECRET_KEY` 업데이트
3. 롤링 재배포 수행:

```bash
# Kubernetes 환경
kubectl set env deployment/bodam-api SECRET_KEY=<new_secret>
kubectl rollout status deployment/bodam-api

# Docker Compose 환경
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

4. 신규 토큰 발급 테스트 (`POST /api/v1/auth/login`)
5. 기존 토큰이 401을 반환하는지 확인

### 롤백

이전 `SECRET_KEY` 값으로 동일 절차 반복.

---

## 2. DATABASE_URL 비밀번호 로테이션

**영향 범위**: 로테이션 중 DB 연결 단절 가능 (읽기/쓰기 오류)

### 사전 준비

1. 스테이징 환경에서 먼저 검증
2. DB 백업 확인 (`pg_dump` 또는 RDS 스냅샷)

### 로테이션 절차

1. PostgreSQL에서 새 비밀번호 설정:

```sql
ALTER USER bodam WITH PASSWORD 'NEW_STRONG_PASSWORD';
```

2. 연결 문자열 업데이트:

```
DATABASE_URL=postgresql+asyncpg://bodam:NEW_STRONG_PASSWORD@localhost:5432/bodam
```

3. 환경변수 갱신 후 애플리케이션 재시작
4. 헬스체크 확인 (`GET /api/v1/health`)
5. DB 연결 로그에서 오류 없음 확인

### 롤백

이전 비밀번호로 `ALTER USER` 재실행 후 환경변수 복구.

---

## 3. OPENAI_API_KEY 로테이션

**영향 범위**: 채팅 AI 응답 기능 (로테이션 중 일시 중단 가능)

### 로테이션 절차

1. [OpenAI 대시보드](https://platform.openai.com/api-keys)에서 새 API 키 생성
2. 새 키로 API 호출 테스트:

```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer NEW_API_KEY"
```

3. 환경변수 `OPENAI_API_KEY` 업데이트 및 재배포
4. 채팅 엔드포인트에서 정상 응답 확인 (`POST /api/v1/chat/sessions/{id}/messages`)
5. OpenAI 대시보드에서 구 키 비활성화

### 롤백

구 키가 아직 활성 상태라면 환경변수를 구 키로 복구.

---

## 4. GOOGLE_API_KEY 로테이션

**영향 범위**: Gemini LLM 라우팅 (폴백 GPT-4o로 자동 전환)

### 로테이션 절차

1. [Google AI Studio](https://makersuite.google.com/app/apikey)에서 새 API 키 생성
2. 새 키로 API 호출 테스트:

```bash
curl "https://generativelanguage.googleapis.com/v1/models?key=NEW_API_KEY"
```

3. 환경변수 `GOOGLE_API_KEY` 업데이트 및 재배포
4. Gemini 모델 응답 확인 (로그에서 `gemini-2.0-flash` 호출 확인)
5. Google Cloud Console에서 구 키 비활성화

### 롤백

구 키가 활성 상태라면 환경변수를 구 키로 복구.
Gemini 장애 시 `LLM_PRIMARY_MODEL=gpt-4o`로 전환 가능.

---

## 로테이션 주기 권장사항

| 시크릿 | 권장 주기 | 비고 |
|--------|-----------|------|
| `SECRET_KEY` | 90일 | 보안 사고 발생 시 즉시 |
| `DATABASE_URL` 비밀번호 | 90일 | 퇴사자 발생 시 즉시 |
| `OPENAI_API_KEY` | 180일 | 키 노출 의심 시 즉시 |
| `GOOGLE_API_KEY` | 180일 | 키 노출 의심 시 즉시 |

## 로테이션 완료 체크리스트

- [ ] 새 시크릿 생성 완료
- [ ] 스테이징 환경 검증 완료
- [ ] 프로덕션 배포 완료
- [ ] 기능 동작 확인 완료
- [ ] 구 시크릿 비활성화 완료
- [ ] 팀 공지 완료
- [ ] 로테이션 일지 기록 완료
