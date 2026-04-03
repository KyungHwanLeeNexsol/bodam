"""JIT RAG 데이터 모델 (SPEC-JIT-001)

JIT 문서 처리에 사용되는 Pydantic v2 모델 정의.
Redis 직렬화 및 API 응답 스키마로 사용.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Section(BaseModel):
    """약관 섹션 데이터

    PDF 또는 HTML에서 추출된 하나의 약관 조항/섹션.
    """

    # 섹션 제목 (예: "제1조 보험의 목적")
    title: str = Field(default="")
    # 섹션 본문 내용
    content: str = Field(default="")
    # 원본 문서의 페이지 번호 (1부터 시작)
    page_number: int = Field(default=1)
    # 문서 내 섹션 순서 번호 (1부터 시작)
    section_number: int = Field(default=1)


class DocumentData(BaseModel):
    """JIT 문서 데이터

    Redis에 저장되는 세션별 문서 데이터.
    약관 문서의 메타데이터와 추출된 섹션 목록을 포함.
    """

    # 보험 상품명 (예: "삼성화재 운전자보험")
    product_name: str = Field(default="")
    # 문서 원본 URL
    source_url: str = Field(default="")
    # 소스 타입: "pdf" 또는 "html"
    source_type: str = Field(default="pdf")
    # 추출된 섹션 목록
    sections: list[Section] = Field(default_factory=list)
    # 추출 시각 (ISO 8601 형식)
    extracted_at: str = Field(default="")
    # 총 페이지 수
    page_count: int = Field(default=0)
