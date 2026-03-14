---
id: SPEC-AUTH-001
document: plan
version: 1.0.0
---

# SPEC-AUTH-001: 구현 계획 - 사용자 인증 시스템

> TAG: `[SPEC-AUTH-001]`

## 1. 작업 분해 (Task Decomposition)

### Primary Goal - 백엔드 인증 코어

| # | 작업 | 모듈 | 파일 | 유형 |
|---|------|------|------|------|
| T1 | User SQLAlchemy 모델 정의 | M1 | `backend/app/models/user.py` | 신규 |
| T2 | Alembic 마이그레이션: users 테이블 생성 | M1 | `backend/alembic/versions/xxx_create_users.py` | 신규 |
| T3 | Alembic 마이그레이션: ChatSession.user_id FK 변경 | M1 | `backend/alembic/versions/xxx_update_chat_session.py` | 신규 |
| T4 | Pydantic 스키마 (UserCreate, UserResponse, Token) | M2 | `backend/app/schemas/auth.py` | 신규 |
| T5 | 비밀번호 해싱 유틸리티 (bcrypt) | M2 | `backend/app/core/security.py` | 신규 |
| T6 | JWT 토큰 생성/검증 유틸리티 | M2 | `backend/app/core/security.py` | 신규 |
| T7 | AuthService (회원가입, 로그인 비즈니스 로직) | M2 | `backend/app/services/auth_service.py` | 신규 |

### Secondary Goal - 백엔드 API 및 미들웨어

| # | 작업 | 모듈 | 파일 | 유형 |
|---|------|------|------|------|
| T8 | 인증 API 라우터 (register, login, me) | M3 | `backend/app/api/v1/auth.py` | 신규 |
| T9 | get_current_user Dependency | M4 | `backend/app/api/deps.py` | 신규/수정 |
| T10 | 기존 채팅 엔드포인트에 인증 적용 | M4 | `backend/app/api/v1/chat.py` | 수정 |
| T11 | 환경 변수 설정 (SECRET_KEY, TOKEN_EXPIRE) | M2 | `backend/app/core/config.py` | 수정 |

### Final Goal - 프론트엔드 인증 UI

| # | 작업 | 모듈 | 파일 | 유형 |
|---|------|------|------|------|
| T12 | AuthContext Provider 구현 | M5 | `frontend/src/contexts/AuthContext.tsx` | 신규 |
| T13 | 로그인 페이지 (react-hook-form + zod) | M5 | `frontend/src/app/login/page.tsx` | 수정 |
| T14 | 회원가입 페이지 | M5 | `frontend/src/app/register/page.tsx` | 신규 |
| T15 | 보호된 경로 미들웨어 | M5 | `frontend/src/middleware.ts` | 신규/수정 |

---

## 2. 기술 스택 상세

### 2.1 백엔드 의존성 추가

```
# requirements.txt 또는 pyproject.toml에 추가
passlib[bcrypt]>=1.7.0    # 비밀번호 해싱
python-jose[cryptography]>=3.3.0  # JWT 토큰
```

### 2.2 프론트엔드 의존성 추가

```
npm install react-hook-form zod @hookform/resolvers
```

### 2.3 환경 변수

```
SECRET_KEY=<32자 이상 랜덤 문자열>
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

---

## 3. 아키텍처 설계 방향

### 3.1 백엔드 레이어 구조

```
app/
├── models/
│   └── user.py          # User SQLAlchemy 모델
├── schemas/
│   └── auth.py          # Pydantic 요청/응답 스키마
├── core/
│   ├── config.py         # Settings (SECRET_KEY 추가)
│   └── security.py       # 비밀번호 해싱 + JWT 유틸리티
├── services/
│   └── auth_service.py   # 인증 비즈니스 로직
├── api/
│   ├── deps.py           # get_current_user Dependency
│   └── v1/
│       ├── auth.py       # 인증 라우터
│       └── chat.py       # 기존 채팅 (인증 적용)
```

### 3.2 프론트엔드 구조

```
src/
├── contexts/
│   └── AuthContext.tsx    # 인증 상태 관리
├── lib/
│   └── api.ts            # API 클라이언트 (토큰 주입)
├── app/
│   ├── login/page.tsx     # 로그인 페이지
│   ├── register/page.tsx  # 회원가입 페이지
│   └── chat/              # 보호된 경로
├── middleware.ts           # Next.js 미들웨어 (경로 보호)
```

### 3.3 인증 흐름

```
[회원가입]
Client → POST /api/v1/auth/register → AuthService.register()
  → 비밀번호 유효성 검사 → bcrypt 해싱 → DB 저장 → UserResponse 반환

[로그인]
Client → POST /api/v1/auth/login → AuthService.authenticate()
  → 이메일 조회 → bcrypt 검증 → JWT 생성 → Token 반환

[인증된 요청]
Client → GET /api/v1/chat/sessions (Authorization: Bearer <token>)
  → get_current_user Dependency → JWT 검증 → User 반환 → 요청 처리
```

---

## 4. ChatSession 마이그레이션 전략

### 4.1 단계적 마이그레이션

**1단계**: `users` 테이블 생성 (T2)

**2단계**: `ChatSession.user_id` 변경 (T3)
- 기존 TEXT 컬럼을 UUID로 타입 변경
- `users.id`에 대한 FK 추가
- **nullable 유지** (기존 데이터 호환성)
- 기존 TEXT 값이 유효한 UUID가 아닌 경우 NULL로 설정

### 4.2 하위 호환성

- 기존 `ChatSession` 데이터는 `user_id=NULL`로 유지
- 인증 미들웨어는 기존 채팅 엔드포인트에 선택적으로 적용 가능 (optional dependency)
- 인증된 사용자: 자신의 세션만 조회
- 미인증 사용자: MVP에서는 접근 차단 (401 반환)

### 4.3 마이그레이션 롤백 계획

- Alembic `downgrade` 명령으로 FK 제거 및 TEXT 타입 복원 가능
- 데이터 손실 없이 롤백 가능하도록 설계

---

## 5. 리스크 분석

| 리스크 | 영향도 | 발생 확률 | 대응 방안 |
|--------|--------|-----------|-----------|
| passlib/bcrypt Python 3.13 호환성 문제 | 높음 | 낮음 | bcrypt 패키지 직접 사용으로 대체 가능 |
| ChatSession 마이그레이션 시 데이터 손실 | 높음 | 낮음 | nullable FK + 트랜잭션 기반 마이그레이션 |
| JWT 시크릿 키 노출 | 높음 | 낮음 | 환경 변수 사용, .env 파일 .gitignore 등록 |
| 프론트엔드 localStorage XSS 취약점 | 중간 | 중간 | MVP에서는 localStorage, Phase 2에서 httpOnly 쿠키로 전환 |
| 기존 채팅 API 사용자 영향 | 중간 | 높음 | 점진적 인증 적용, 명확한 에러 메시지 제공 |

---

## 6. 파일 생성/수정 목록

### 신규 파일

| 파일 경로 | 설명 |
|-----------|------|
| `backend/app/models/user.py` | User SQLAlchemy 모델 |
| `backend/alembic/versions/xxx_create_users.py` | users 테이블 마이그레이션 |
| `backend/alembic/versions/xxx_update_chat_session_user_id.py` | ChatSession FK 마이그레이션 |
| `backend/app/schemas/auth.py` | 인증 관련 Pydantic 스키마 |
| `backend/app/core/security.py` | 비밀번호 해싱 + JWT 유틸리티 |
| `backend/app/services/auth_service.py` | 인증 서비스 로직 |
| `backend/app/api/v1/auth.py` | 인증 API 라우터 |
| `frontend/src/contexts/AuthContext.tsx` | 인증 컨텍스트 Provider |
| `frontend/src/app/register/page.tsx` | 회원가입 페이지 |

### 수정 파일

| 파일 경로 | 변경 내용 |
|-----------|-----------|
| `backend/app/core/config.py` | SECRET_KEY, TOKEN_EXPIRE 설정 추가 |
| `backend/app/api/deps.py` | get_current_user Dependency 추가 |
| `backend/app/api/v1/chat.py` | 인증 Dependency 적용 |
| `backend/app/models/__init__.py` | User 모델 import 추가 |
| `backend/requirements.txt` (또는 pyproject.toml) | passlib, python-jose 추가 |
| `frontend/src/app/login/page.tsx` | 플레이스홀더를 실제 로그인 폼으로 교체 |
| `frontend/src/middleware.ts` | 보호된 경로 설정 |
| `frontend/src/lib/api.ts` | 인증 토큰 자동 주입 |
| `frontend/package.json` | react-hook-form, zod, @hookform/resolvers 추가 |

---

## 7. 테스트 전략

### 7.1 백엔드 테스트

- **단위 테스트**: 비밀번호 해싱, JWT 생성/검증, 비밀번호 정책 검증
- **통합 테스트**: 회원가입/로그인 API, 인증 미들웨어, 채팅 세션 격리
- **커버리지 목표**: 85% 이상

### 7.2 프론트엔드 테스트

- **컴포넌트 테스트**: 로그인/회원가입 폼 렌더링 및 유효성 검사
- **통합 테스트**: AuthContext 상태 변화, 보호된 경로 리다이렉트
- **커버리지 목표**: 80% 이상

---

## 8. 의존성 관계

```
T1 (User 모델) → T2 (users 마이그레이션) → T3 (ChatSession FK)
T1 → T4 (Pydantic 스키마)
T5, T6 (보안 유틸리티) → T7 (AuthService)
T4, T7 → T8 (API 라우터)
T6 → T9 (get_current_user)
T9 → T10 (채팅 인증 적용)
T11 (환경 변수) → T5, T6

T12 (AuthContext) → T13 (로그인), T14 (회원가입), T15 (경로 보호)
```
