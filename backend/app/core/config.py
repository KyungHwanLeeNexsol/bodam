# 애플리케이션 설정 모듈
# pydantic-settings를 사용한 환경변수 기반 설정 관리
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 앱 기본 설정
    app_name: str = "Bodam API"
    app_version: str = "0.1.0"
    debug: bool = False

    # 데이터베이스 연결 (필수)
    database_url: str

    # Redis 연결
    redis_url: str = "redis://localhost:6379/0"

    # 보안 키 (필수)
    secret_key: str

    # OpenAI API 설정 (임베딩 생성용)
    # 테스트 환경에서는 빈 문자열로 설정 가능
    openai_api_key: str = ""

    # 임베딩 모델명 (Gemini gemini-embedding-001: 768차원, EmbeddingService가 models/ 접두사 추가)
    embedding_model: str = "gemini-embedding-001"

    # 임베딩 벡터 차원 수 (pgvector Vector 타입과 일치해야 함)
    embedding_dimensions: int = 768

    # RAG 청크 분할 설정
    # 청크 최대 토큰 수 (tiktoken 기준)
    chunk_size_tokens: int = 500

    # 청크 간 겹치는 토큰 수 (문맥 연속성 보장)
    chunk_overlap_tokens: int = 100

    # Gemini API 설정
    gemini_api_key: str = ""

    # LLM 라우팅 설정
    llm_primary_model: str = "gemini-2.0-flash"
    llm_fallback_model: str = "gpt-4o"
    llm_classifier_model: str = "gpt-4o-mini"

    # 품질 설정
    llm_confidence_threshold: float = 0.7
    llm_fallback_on_low_confidence: bool = True

    # 비용 추적
    llm_cost_tracking_enabled: bool = True

    # Chat AI 설정
    # 채팅에 사용할 OpenAI 모델명
    chat_model: str = "gpt-4o-mini"

    # 응답 최대 토큰 수
    chat_max_tokens: int = 1024

    # 응답 다양성 조절 (0.0 ~ 1.0, 낮을수록 일관성 높음)
    chat_temperature: float = 0.3

    # 컨텍스트로 사용할 이전 메시지 수 제한
    chat_history_limit: int = 10

    # RAG 검색 결과 최대 개수
    chat_context_top_k: int = 5

    # RAG 검색 유사도 임계값 (낮을수록 더 많은 결과)
    chat_context_threshold: float = 0.3

    # 크롤러 스토리지 설정
    # 스토리지 백엔드 유형 ('local' 또는 's3')
    crawler_storage_backend: str = "local"

    # 로컬 스토리지 기본 디렉토리
    crawler_base_dir: str = "./data/crawled_pdfs"

    # 크롤러 요청 간 대기 시간 (초, 서버 과부하 방지)
    crawler_rate_limit_seconds: float = 2.0

    # 크롤러 최대 재시도 횟수
    crawler_max_retries: int = 3

    # JWT 액세스 토큰 만료 시간 (분)
    access_token_expire_minutes: int = 30

    # JWT 서명 알고리즘
    jwt_algorithm: str = "HS256"

    # SPEC-SEC-001: Rate Limiting 설정
    # IP 기반 일반 API 제한 (요청/분)
    rate_limit_general: int = 60
    # IP 기반 인증 엔드포인트 제한 (요청/분)
    rate_limit_auth: int = 10
    # 사용자별 일일 채팅 제한 (Free Tier)
    rate_limit_chat_daily: int = 100

    # SPEC-SEC-001: CORS 허용 도메인 (쉼표 구분, 프로덕션용)
    allowed_origins: str = ""

    # SPEC-OAUTH-001: 카카오 OAuth2 설정 (ACC-04)
    kakao_client_id: str = ""
    kakao_client_secret: str = ""
    kakao_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/kakao/callback"

    # SPEC-OAUTH-001: 네이버 OAuth2 설정 (ACC-07)
    naver_client_id: str = ""
    naver_client_secret: str = ""
    naver_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/naver/callback"

    # SPEC-OAUTH-001: 구글 OAuth2 설정 (ACC-10)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/google/callback"

    # SPEC-OAUTH-001: 소셜 토큰 암호화 키 (Fernet 대칭키, ACC-22)
    # @MX:NOTE: Fernet 키는 base64url-encoded 32바이트여야 함. 빈 문자열이면 암호화 비활성화
    social_token_encryption_key: str = ""

    # SPEC-B2B-001: B2B 고객 PII 암호화 키 (Fernet 대칭키, AC-003)
    # @MX:WARN: 이 키를 분실하면 암호화된 고객 PII 복호화 불가 - 반드시 안전하게 보관
    # @MX:REASON: PIPA(개인정보보호법) - 고객 PII 암호화 키 관리 의무
    b2b_encryption_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    """설정 인스턴스를 반환 (캐시 적용으로 재사용)

    의존성 주입을 통해 사용하거나 테스트에서 직접 호출 가능.
    모듈 레벨에서 직접 인스턴스화하지 않음 (환경변수 로딩 시점 문제 방지).
    """
    return Settings()
