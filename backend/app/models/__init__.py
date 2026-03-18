"""도메인 모델 패키지

모든 SQLAlchemy 모델과 Base를 re-export.
Alembic autogenerate 및 앱 전반에서 편리하게 임포트 가능.
"""

from __future__ import annotations

from app.models.access_log import AccessLog
from app.models.base import Base, TimestampMixin
from app.models.case_precedent import CasePrecedent
from app.models.chat import ChatMessage, ChatSession, MessageRole
from app.models.crawler import CrawlResult, CrawlResultStatus, CrawlRun, CrawlStatus
from app.models.insurance import (
    Coverage,
    InsuranceCategory,
    InsuranceCompany,
    Policy,
    PolicyChunk,
)
from app.models.pdf import (
    PdfAnalysisMessage,
    PdfAnalysisSession,
    PdfMessageRole,
    PdfSessionStatus,
    PdfUpload,
    PdfUploadStatus,
)
from app.models.pipeline import PipelineRun, PipelineStatus, PipelineTriggerType
from app.models.social_account import SocialAccount
from app.models.user import ConsentRecord, User, UserRole

__all__ = [
    "Base",
    "TimestampMixin",
    "AccessLog",
    "InsuranceCategory",
    "InsuranceCompany",
    "Policy",
    "Coverage",
    "PolicyChunk",
    "ChatSession",
    "ChatMessage",
    "MessageRole",
    "CrawlStatus",
    "CrawlResultStatus",
    "CrawlRun",
    "CrawlResult",
    "PdfUpload",
    "PdfUploadStatus",
    "PdfAnalysisSession",
    "PdfSessionStatus",
    "PdfAnalysisMessage",
    "PdfMessageRole",
    "User",
    "UserRole",
    "ConsentRecord",
    "SocialAccount",
    "CasePrecedent",
    "PipelineRun",
    "PipelineStatus",
    "PipelineTriggerType",
]
