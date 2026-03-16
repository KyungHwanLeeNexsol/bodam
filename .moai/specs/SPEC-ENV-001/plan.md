# SPEC-ENV-001: 구현 계획

## TAG

`SPEC-ENV-001` `env` `configuration` `cleanup`

---

## 1. 마일스톤

### Primary Goal: 위험 파일 제거 및 프로덕션 예시 정비

**대상 요구사항**: REQ-01, REQ-02, REQ-03

**작업 항목**:

1. `backend/.env.prod.example` 삭제 (REQ-01)
   - `git rm backend/.env.prod.example`
   - 삭제 커밋 생성

2. `frontend/.env.prod.example` 삭제 (REQ-02)
   - `git rm frontend/.env.prod.example`
   - 삭제 커밋에 포함

3. `.env.prod.example` 업데이트 (REQ-03)
   - config.py의 40개 환경변수 전체 반영
   - 섹션별 그룹핑: 필수 인프라, LLM/AI, Chat, 임베딩/RAG, 크롤러, 인증, OAuth, 보안
   - 각 변수에 한글 주석 및 기본값 설명 추가
   - `GEMINI_API_KEY`로 변수명 통일, `GOOGLE_API_KEY` 호환 주석 추가

### Secondary Goal: 스테이징 예시 및 개발 환경 정비

**대상 요구사항**: REQ-04, REQ-05

**작업 항목**:

4. `.env.staging.example` 생성 (REQ-04)
   - `.env.prod.example` 구조 복사
   - 스테이징 적절 기본값 설정 (DEBUG=true, LOG_LEVEL=debug 등)
   - 스테이징 도메인 플레이스홀더 설정
   - 스테이징 특화 주석 추가

5. `backend/.env.example` 업데이트 (REQ-05)
   - 누락된 chat_*, embedding_*, llm_*, crawler_* 변수 추가
   - 기존 섹션 구조와 일관된 포맷 유지
   - 개발 환경에 적합한 기본값 제공

### Final Goal: 문서화 및 참조 주석

**대상 요구사항**: REQ-06, REQ-07

**작업 항목**:

6. docker-compose 파일 주석 추가 (REQ-06)
   - `docker-compose.yml`에 예시 파일 경로 주석
   - `docker-compose.prod.yml`에 예시 파일 경로 주석
   - `docker-compose.staging.yml`에 예시 파일 경로 주석

7. README.md 업데이트 (REQ-07)
   - "Environment Configuration" 섹션 추가
   - 환경별 파일 매핑 테이블
   - 설정 파일 생성 명령어
   - Vercel 관련 안내

---

## 2. 기술적 접근

### 접근 방식

이 작업은 순수 파일 조작(삭제, 생성, 수정) 작업으로, 코드 변경이 없다.

**작업 원칙**:
- config.py를 단일 진실 공급원(Single Source of Truth)으로 사용
- 모든 예시 파일은 config.py의 환경변수 전체를 반영
- 각 환경(dev, staging, prod)에 맞는 기본값을 설정
- 변수 그룹핑은 config.py의 주석 구조를 따름

### 예시 파일 변수 그룹핑 표준

```
# === [필수] 데이터베이스 ===
# === [필수] 캐시 (Redis) ===
# === [필수] 인증 / 보안 ===
# === [필수] LLM API 키 ===
# === [선택] LLM 라우팅 설정 ===
# === [선택] Chat AI 설정 ===
# === [선택] 임베딩 / RAG 설정 ===
# === [선택] 크롤러 설정 ===
# === [선택] 오브젝트 스토리지 ===
# === [선택] Rate Limiting ===
# === [선택] CORS 설정 ===
# === [선택] OAuth2 소셜 로그인 ===
# === [선택] B2B 암호화 ===
# === [선택] 앱 기본 설정 ===
```

### GEMINI_API_KEY 명명 전략

config.py 필드명: `gemini_api_key`
Pydantic 환경변수 매핑: `GEMINI_API_KEY` (대문자 변환)

예시 파일 표기:
```
# Gemini API 키 (config.py: gemini_api_key)
# 참고: 일부 환경에서 GOOGLE_API_KEY로 설정된 경우 config.py에서 별도 매핑 필요
GEMINI_API_KEY=CHANGE_ME_GEMINI_API_KEY
```

---

## 3. 아키텍처 설계 방향

해당 없음. 이 SPEC은 코드 변경이 아닌 설정 파일 정비 작업이다.

---

## 4. 리스크 및 대응

### Risk 1: 기존 서버의 .env.prod 변수명 불일치

**위험**: `.env.prod.example`에서 `GEMINI_API_KEY`로 변경하면 기존 서버의 `.env.prod`에서 `GOOGLE_API_KEY`를 사용하는 경우 혼란 발생 가능
**대응**: config.py 변경은 out of scope이므로, 예시 파일에 두 변수명 모두 주석으로 안내

### Risk 2: backend/.env.prod.example 삭제 후 참조 누락

**위험**: 다른 문서나 스크립트에서 `backend/.env.prod.example`을 참조하는 경우
**대응**: 삭제 전 프로젝트 내 참조 검색 (`grep -r "backend/.env.prod.example"`)

### Risk 3: .env.staging.example의 변수 누락

**위험**: 스테이징에서 필요한 변수를 prod 예시에서 복사하는 과정에서 누락
**대응**: config.py 변수 목록과 1:1 대조 검증

---

## 5. 의존성

- 이 SPEC은 다른 SPEC에 의존하지 않는다.
- config.py 수정이 필요한 경우 별도 SPEC으로 분리한다.
- Git 브랜치 생성 및 커밋은 manager-git 에이전트가 담당한다.
