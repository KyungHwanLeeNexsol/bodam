# 구조화된 로깅 설정 모듈
import logging
import sys


def setup_logging(debug: bool = False) -> None:
    """애플리케이션 로깅을 설정

    Args:
        debug: True이면 DEBUG 레벨, 아니면 INFO 레벨로 설정
    """
    log_level = logging.DEBUG if debug else logging.INFO

    # 기본 포맷: 타임스탬프, 로거명, 레벨, 메시지
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    logging.basicConfig(
        level=log_level,
        format=log_format,
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    # 외부 라이브러리 로그 레벨 조정 (너무 많은 로그 방지)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.DEBUG if debug else logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
