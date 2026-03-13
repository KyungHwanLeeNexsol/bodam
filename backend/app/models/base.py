"""SQLAlchemy 기본 모델 및 타임스탬프 믹스인 (TAG-001)

모든 보험 도메인 모델이 상속할 Base와 TimestampMixin을 정의.
"""

from __future__ import annotations

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """프로젝트 전체에서 사용하는 SQLAlchemy Declarative Base"""

    pass


class TimestampMixin:
    """created_at, updated_at 타임스탬프 컬럼을 제공하는 믹스인

    모든 시간은 DB 서버 기준 UTC로 저장.
    updated_at은 레코드 변경 시 자동 갱신.
    """

    # 레코드 생성 시각 (서버 기본값: 현재 UTC 시각)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # 레코드 최종 수정 시각 (서버 기본값: 현재 UTC, 변경 시 자동 갱신)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
