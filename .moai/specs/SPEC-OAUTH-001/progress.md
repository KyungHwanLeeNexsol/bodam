## SPEC-OAUTH-001 Progress

- Started: 2026-03-15
- Phase 1 (Analysis): Complete - Plan approved by user
- Phase 1.5 (Task Decomposition): Complete
- Phase 1.7 (File Scaffolding): Complete - All backend files created
- Phase 2 (TDD Implementation): Complete - Backend OAuth2 infrastructure

### Completed Implementation

**Models & Config (TAG-001~003):**
- User.hashed_password nullable 변경 (ACC-20)
- SocialAccount 모델 생성 (ACC-11, ACC-12)
- Config에 OAuth 환경변수 추가 (ACC-04, ACC-07, ACC-10)
- Alembic 마이그레이션 2개 생성
- OAuth schemas (OAuthUserInfo, OAuthToken, OAuthCallbackResponse, OAuthMergeRequest, SocialAccountResponse)

**Providers (TAG-004~006):**
- OAuthProvider 추상 베이스 클래스
- KakaoOAuthProvider (ACC-01, ACC-02, ACC-03)
- NaverOAuthProvider (ACC-05, ACC-06)
- GoogleOAuthProvider (ACC-08, ACC-09)
- Provider factory (get_provider)

**Service & API (TAG-007~008):**
- OAuthService: state 생성/검증, 사용자 조회/생성, 계정 병합, 소셜 계정 관리, 토큰 암호화
- OAuth API 라우터: authorize, callback, merge, social-accounts list/delete
- AuthService: 소셜 전용 계정 로그인 안내 (ACC-21)
- main.py에 OAuth 라우터 등록
- models/__init__.py에 User, ConsentRecord, SocialAccount 추가

**Tests (88 OAuth tests + 707 total unit tests pass):**
- test_oauth_providers.py (19 tests)
- test_oauth_schemas.py (21 tests)
- test_oauth_service.py (14 tests)
- test_oauth_user_model.py (4 tests)
- test_social_account_model.py (13 tests)
- test_oauth_api.py (14 tests)
- test_auth_social_login.py (3 tests)

**Frontend (Phase 4):**
- SocialLoginButtons.tsx: 카카오(#FEE500), 네이버(#03C75A), 구글(흰색) 소셜 로그인 버튼
- AccountMergeDialog.tsx: 409 충돌 시 비밀번호 확인 다이얼로그
- EmailInputDialog.tsx: 카카오 이메일 미제공 시 이메일 입력 다이얼로그
- callback/[provider]/page.tsx: OAuth 콜백 처리 페이지 (로딩/에러/병합 상태)
- LoginForm.tsx: 소셜 로그인 버튼 구분선 + SocialLoginButtons 추가
- RegisterForm.tsx: 소셜 로그인 버튼 구분선 + SocialLoginButtons 추가
- lib/auth.ts: OAuth API 함수 (oauthCallbackApi, oauthMergeApi 등) 추가
- Frontend tests: 116/116 passing

### Status: Complete

- Phase 2 (Backend): 커밋 e47924e
- Phase 4 (Frontend): 커밋 e8a3b6d, 19e7f36
- Phase 5: .env.example OAuth 변수 추가 완료
- 통합 테스트는 배포 환경 구성 후 진행 (선택)
