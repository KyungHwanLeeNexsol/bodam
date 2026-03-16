"""접근 로그 모델 (SPEC-SEC-001 M2)

HTTP 요청 접근 로그를 DB에 기록.
90일 후 자동 삭제 (PIPA 데이터 보존 정책).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AccessLog(Base):
    """HTTP 요청 접근 로그

    API 요청의 기본 메타데이터를 기록.
    개인정보 최소 수집 원칙: IP는 마지막 옥텟 마스킹 처리.
    """

    __tablename__ = "access_logs"
    __table_args__ = (
        Index("ix_access_logs_created_at", "created_at"),
        Index("ix_access_logs_user_id", "user_id"),
        Index("ix_access_logs_path", "path"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    # 요청 정보
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    query_string: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)

    # 클라이언트 정보 (마스킹 처리)
    ip_masked: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        comment="마지막 옥텟 마스킹된 IP (예: 192.168.1.xxx)",
    )
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 성능 메트릭
    response_time_ms: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="응답 시간 (밀리초)",
    )

    # 사용자 연관 (선택적)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    # 타임스탬프
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.utcnow(),
    )

    def __repr__(self) -> str:
        return (
            f"<AccessLog {self.method} {self.path} {self.status_code} "
            f"at {self.created_at}>"
        )

    @staticmethod
    def mask_ip(ip: str) -> str:
        """IPv4 주소의 마지막 옥텟을 마스킹

        Args:
            ip: 원본 IP 주소

        Returns:
            마스킹된 IP (예: 192.168.1.xxx)
        """
        parts = ip.rsplit(".", 1)
        if len(parts) == 2:
            return f"{parts[0]}.xxx"
        return "xxx"
