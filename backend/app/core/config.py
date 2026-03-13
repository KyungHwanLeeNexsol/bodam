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

    # 임베딩 모델명 (text-embedding-3-small: 1536차원, 비용 효율적)
    embedding_model: str = "text-embedding-3-small"

    # 임베딩 벡터 차원 수 (pgvector Vector 타입과 일치해야 함)
    embedding_dimensions: int = 1536

    # RAG 청크 분할 설정
    # 청크 최대 토큰 수 (tiktoken 기준)
    chunk_size_tokens: int = 500

    # 청크 간 겹치는 토큰 수 (문맥 연속성 보장)
    chunk_overlap_tokens: int = 100

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """설정 인스턴스를 반환 (캐시 적용으로 재사용)

    의존성 주입을 통해 사용하거나 테스트에서 직접 호출 가능.
    모듈 레벨에서 직접 인스턴스화하지 않음 (환경변수 로딩 시점 문제 방지).
    """
    return Settings()
