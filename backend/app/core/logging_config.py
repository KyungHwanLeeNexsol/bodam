"""구조화 JSON 로깅 설정 모듈 (SPEC-INFRA-002 M5)

structlog 을 사용한 JSON 포맷 구조화 로깅 설정.
- request_id correlation ID 지원
- 민감 데이터 마스킹 (SPEC-SEC-001 연동)
- 환경별 로그 레벨 (staging: DEBUG, production: INFO)
- 로그 로테이션 (100MB, 최대 7개 파일)
"""

from __future__ import annotations

import logging
import logging.handlers
import sys
from typing import Any

import structlog


def _scrub_sensitive_fields(
    logger: Any,
    method: Any,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """structlog 프로세서: 민감 데이터 마스킹

    log_masking 모듈의 mask_event_dict 를 호출.
    모듈이 없는 경우 기본 마스킹 적용.
    """
    try:
        from app.core.log_masking import mask_event_dict

        return mask_event_dict(logger, method, event_dict)
    except ImportError:
        # 민감 필드 기본 마스킹
        sensitive_keys = {"password", "secret_key", "api_key", "access_token", "refresh_token"}
        return {k: "***REDACTED***" if k in sensitive_keys else v for k, v in event_dict.items()}


def setup_structured_logging(log_level: str = "INFO", log_file: str | None = None) -> None:
    """structlog JSON 포맷 로깅 설정

    Args:
        log_level: 로그 레벨 (DEBUG, INFO, WARNING, ERROR)
        log_file: 로그 파일 경로 (None 이면 stdout 만 사용)
    """
    # stdlib logging 핸들러 설정
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]

    if log_file:
        # 로그 로테이션: 100MB, 최대 7개 파일 보관
        rotating_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=100 * 1024 * 1024,  # 100MB
            backupCount=7,
            encoding="utf-8",
        )
        handlers.append(rotating_handler)

    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, log_level.upper(), logging.INFO),
        handlers=handlers,
    )

    # 외부 라이브러리 로그 레벨 조정
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.DEBUG if log_level.upper() == "DEBUG" else logging.WARNING
    )
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)

    # structlog 설정
    structlog.configure(
        processors=[
            # contextvars (request_id 등) 병합
            structlog.contextvars.merge_contextvars,
            # stdlib 로그 레벨 추가
            structlog.processors.add_log_level,
            # ISO 8601 타임스탬프 추가
            structlog.processors.TimeStamper(fmt="iso"),
            # 민감 데이터 마스킹
            _scrub_sensitive_fields,
            # 스택 트레이스 포맷
            structlog.processors.StackInfoRenderer(),
            # 예외 포맷
            structlog.dev.set_exc_info,
            # JSON 렌더링
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_log_level_for_environment(environment: str, debug: bool = False) -> str:
    """환경에 따른 로그 레벨 반환

    Args:
        environment: 실행 환경 (staging, production, development)
        debug: 디버그 모드 여부

    Returns:
        str: 로그 레벨 문자열
    """
    if debug:
        return "DEBUG"
    if environment.lower() == "staging":
        return "DEBUG"
    if environment.lower() == "production":
        return "INFO"
    return "DEBUG"  # 개발 환경 기본값
