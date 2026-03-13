"""보험 도메인 모델 패키지

모든 SQLAlchemy 모델과 Base를 re-export.
Alembic autogenerate 및 앱 전반에서 편리하게 임포트 가능.
"""

from __future__ import annotations

from app.models.base import Base, TimestampMixin
from app.models.insurance import (
    Coverage,
    InsuranceCategory,
    InsuranceCompany,
    Policy,
    PolicyChunk,
)

__all__ = [
    "Base",
    "TimestampMixin",
    "InsuranceCategory",
    "InsuranceCompany",
    "Policy",
    "Coverage",
    "PolicyChunk",
]
