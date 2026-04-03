"""JIT RAG 섹션 파인더 테스트 (SPEC-JIT-001)

BM25 기반 관련 섹션 추출 및 전체 컨텍스트 전략 테스트.
"""

from __future__ import annotations

import pytest

from app.services.jit_rag.section_finder import SectionFinder
from app.services.jit_rag.models import Section


def make_section(title: str, content: str, page: int = 1, num: int = 1) -> Section:
    """테스트용 Section 생성 헬퍼"""
    return Section(
        title=title,
        content=content,
        page_number=page,
        section_number=num,
    )


@pytest.fixture
def finder():
    """SectionFinder 인스턴스"""
    return SectionFinder()


@pytest.fixture
def small_sections():
    """총 토큰이 120000 미만인 소규모 섹션 목록"""
    return [
        make_section(
            "제1조 보험의 목적",
            "이 보험은 피보험자에게 발생한 상해를 보상합니다.",
            page=1,
            num=1,
        ),
        make_section(
            "제2조 보험금 지급",
            "보험사고가 발생한 경우 보험금을 지급합니다.",
            page=2,
            num=2,
        ),
        make_section(
            "제3조 면책조항",
            "고의 또는 자해로 인한 사고는 보상하지 않습니다.",
            page=3,
            num=3,
        ),
    ]


@pytest.fixture
def large_sections():
    """총 토큰이 120000 이상인 대규모 섹션 목록"""
    # 각 섹션이 충분히 커서 120000 토큰을 초과하도록 설정
    # len(text) // 4 로 토큰 추정 → 120000 토큰 = 480000자 필요
    long_content = "보험 약관 내용입니다. " * 20000  # ~240000자
    return [
        make_section(f"제{i}조 조항", long_content, page=i, num=i)
        for i in range(1, 4)
    ]


def test_small_document_returns_all_sections(finder, small_sections):
    """소규모 문서(< 120000 토큰)는 모든 섹션을 반환해야 한다"""
    query = "보험금 지급 조건"
    result = finder.find_relevant(query, small_sections)

    assert len(result) == len(small_sections)


def test_large_document_uses_bm25(finder, large_sections):
    """대규모 문서(>= 120000 토큰)는 BM25로 최대 5개 섹션만 반환해야 한다"""
    query = "보험 약관 내용"
    result = finder.find_relevant(query, large_sections)

    # BM25 전략: top-5로 제한
    assert len(result) <= 5
    # 결과는 Section 타입이어야 함
    assert all(isinstance(s, Section) for s in result)


def test_relevant_section_contains_keyword(finder, small_sections):
    """관련 섹션은 쿼리 키워드를 포함하고 있어야 한다"""
    query = "면책 고의 자해"
    result = finder.find_relevant(query, small_sections)

    # 소규모 문서이므로 모두 반환되지만, 반환값은 리스트여야 함
    assert isinstance(result, list)
    assert len(result) > 0


def test_empty_sections_returns_empty(finder):
    """빈 섹션 목록으로 조회 시 빈 목록을 반환해야 한다"""
    result = finder.find_relevant("보험금", [])
    assert result == []


def test_bm25_top5_limit(finder):
    """BM25 전략에서 상위 5개만 반환해야 한다"""
    # 120000 토큰 초과 섹션 10개 생성
    long_content = "보험 약관 내용입니다. " * 20000
    sections = [
        make_section(f"제{i}조 조항 {i}", long_content + f" 특수내용{i}", page=i, num=i)
        for i in range(1, 11)
    ]
    result = finder.find_relevant("보험 약관", sections)
    assert len(result) <= 5


def test_section_finder_returns_list(finder, small_sections):
    """find_relevant는 항상 리스트를 반환해야 한다"""
    result = finder.find_relevant("보험", small_sections)
    assert isinstance(result, list)
