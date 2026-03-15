"""PrecedentService 단위 테스트

SPEC-GUIDANCE-001 Phase G2: 벡터 + 키워드 하이브리드 판례 검색 서비스 TDD.

데이터베이스 세션과 EmbeddingService를 모킹하여
판례 검색 로직을 단위 테스트.
"""

from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock


def _make_fixed_embedding(dim: int = 1536) -> list[float]:
    """테스트용 고정 임베딩 벡터 생성 헬퍼"""
    return [0.1] * dim


def _make_vector_row(
    precedent_id: uuid.UUID | None = None,
    case_number: str = "2023다12345",
    court_name: str = "대법원",
    decision_date=None,
    case_type: str = "보험금청구",
    insurance_type: str | None = "실손의료보험",
    summary: str = "판례 요약 내용입니다.",
    ruling: str = "판결 요지 내용입니다.",
    source_url: str | None = "https://example.com/case/1",
    distance: float = 0.2,
):
    """벡터 검색 결과 행(row) mock 생성 헬퍼"""
    row = MagicMock()
    row.id = precedent_id or uuid.uuid4()
    row.case_number = case_number
    row.court_name = court_name
    row.decision_date = decision_date or date(2023, 6, 15)
    row.case_type = case_type
    row.insurance_type = insurance_type
    row.summary = summary
    row.ruling = ruling
    row.source_url = source_url
    row.distance = distance
    return row


def _make_keyword_row(
    precedent_id: uuid.UUID | None = None,
    case_number: str = "2022다98765",
    court_name: str = "서울고등법원",
    decision_date=None,
    case_type: str = "손해배상",
    insurance_type: str | None = "자동차보험",
    summary: str = "키워드 검색 판례 요약입니다.",
    ruling: str = "키워드 검색 판결 요지입니다.",
    source_url: str | None = "https://example.com/case/2",
):
    """키워드 검색 결과 행(row) mock 생성 헬퍼"""
    row = MagicMock()
    row.id = precedent_id or uuid.uuid4()
    row.case_number = case_number
    row.court_name = court_name
    row.decision_date = decision_date or date(2022, 3, 10)
    row.case_type = case_type
    row.insurance_type = insurance_type
    row.summary = summary
    row.ruling = ruling
    row.source_url = source_url
    return row


def _make_full_row(
    precedent_id: uuid.UUID | None = None,
    case_number: str = "2021다55555",
    court_name: str = "부산고등법원",
    decision_date=None,
    case_type: str = "보험금청구",
    insurance_type: str | None = "생명보험",
    summary: str = "전체 조회 판례 요약입니다.",
    ruling: str = "전체 조회 판결 요지입니다.",
    key_clauses: dict | None = None,
    source_url: str | None = "https://example.com/case/3",
):
    """단건 조회 결과 row mock 생성 헬퍼"""
    row = MagicMock()
    row.id = precedent_id or uuid.uuid4()
    row.case_number = case_number
    row.court_name = court_name
    row.decision_date = decision_date or date(2021, 12, 1)
    row.case_type = case_type
    row.insurance_type = insurance_type
    row.summary = summary
    row.ruling = ruling
    row.key_clauses = key_clauses or {"clause_1": "제1조 보험금 지급 기준"}
    row.source_url = source_url
    return row


class TestSearchByVector:
    """PrecedentService.search_by_vector() 테스트"""

    async def test_search_by_vector_returns_results(self):
        """벡터 검색이 올바른 딕셔너리 리스트를 반환해야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        rows = [_make_vector_row(distance=0.15), _make_vector_row(distance=0.25)]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_vector(query="실손 보험금 청구 거절")

        assert isinstance(results, list)
        assert len(results) == 2
        # 딕셔너리 키 검증
        assert "id" in results[0]
        assert "case_number" in results[0]
        assert "court_name" in results[0]
        assert "decision_date" in results[0]
        assert "case_type" in results[0]
        assert "insurance_type" in results[0]
        assert "summary" in results[0]
        assert "ruling" in results[0]
        assert "similarity" in results[0]
        assert "source_url" in results[0]

    async def test_search_by_vector_similarity_calculation(self):
        """similarity가 1 - distance로 올바르게 계산되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        row = _make_vector_row(distance=0.3)

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[row])
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_vector(query="보험금 청구")

        assert len(results) == 1
        assert abs(results[0]["similarity"] - 0.7) < 1e-9

    async def test_search_by_vector_empty_embedding(self):
        """embed_text가 빈 리스트 반환 시 빈 결과를 반환해야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        mock_session = AsyncMock()
        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=[])  # 임베딩 실패

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_vector(query="임베딩 실패 케이스")

        assert results == []
        # session.execute는 호출되지 않아야 함
        mock_session.execute.assert_not_called()

    async def test_search_by_vector_case_type_filter(self):
        """case_type 파라미터가 전달되면 세션 execute가 호출되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_vector(
            query="보험금 청구",
            case_type="보험금청구",
        )

        assert isinstance(results, list)
        mock_session.execute.assert_called_once()

    async def test_search_by_vector_insurance_type_filter(self):
        """insurance_type 파라미터가 전달되면 세션 execute가 호출되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_vector(
            query="실손 보험",
            insurance_type="실손의료보험",
        )

        assert isinstance(results, list)
        mock_session.execute.assert_called_once()


class TestSearchByKeyword:
    """PrecedentService.search_by_keyword() 테스트"""

    async def test_search_by_keyword_returns_results(self):
        """키워드 검색이 올바른 딕셔너리 리스트를 반환해야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        rows = [_make_keyword_row(), _make_keyword_row(case_number="2021다11111")]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_keyword(keyword="보험금")

        assert isinstance(results, list)
        assert len(results) == 2
        assert "id" in results[0]
        assert "case_number" in results[0]

    async def test_search_by_keyword_similarity_is_none(self):
        """키워드 검색 결과의 similarity는 None이어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        row = _make_keyword_row()

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[row])
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_keyword(keyword="청구")

        assert len(results) == 1
        assert results[0]["similarity"] is None

    async def test_search_by_keyword_case_type_filter(self):
        """case_type 필터가 적용된 상태로 세션 execute가 호출되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_keyword(
            keyword="손해배상",
            case_type="손해배상",
        )

        assert isinstance(results, list)
        mock_session.execute.assert_called_once()

    async def test_search_by_keyword_insurance_type_filter(self):
        """insurance_type 필터가 적용된 상태로 세션 execute가 호출되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[])
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_keyword(
            keyword="자동차",
            insurance_type="자동차보험",
        )

        assert isinstance(results, list)
        mock_session.execute.assert_called_once()

    async def test_search_by_keyword_returns_all_fields(self):
        """키워드 검색 결과에 필요한 모든 필드가 포함되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        row = _make_keyword_row()

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=[row])
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.search_by_keyword(keyword="보험")

        required_keys = {
            "id", "case_number", "court_name", "decision_date",
            "case_type", "insurance_type", "summary", "ruling",
            "similarity", "source_url",
        }
        assert required_keys.issubset(results[0].keys())


class TestHybridSearch:
    """PrecedentService.hybrid_search() 테스트"""

    async def test_hybrid_search_returns_results(self):
        """하이브리드 검색이 결과를 반환해야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        fixed_id = uuid.uuid4()
        vector_rows = [_make_vector_row(precedent_id=fixed_id, distance=0.2)]
        keyword_rows = [_make_keyword_row()]

        call_count = 0

        async def mock_execute(stmt):
            nonlocal call_count
            call_count += 1
            mock_result = MagicMock()
            if call_count == 1:
                mock_result.all = MagicMock(return_value=vector_rows)
            else:
                mock_result.all = MagicMock(return_value=keyword_rows)
            return mock_result

        mock_session = AsyncMock()
        mock_session.execute = mock_execute

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.hybrid_search(query="실손 보험금 청구 거절")

        assert isinstance(results, list)
        assert len(results) >= 1

    async def test_hybrid_search_has_relevance_score(self):
        """하이브리드 검색 결과에 relevance_score가 포함되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        fixed_id = uuid.uuid4()
        vector_rows = [_make_vector_row(precedent_id=fixed_id, distance=0.2)]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=vector_rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.hybrid_search(query="보험금 청구")

        assert len(results) >= 1
        assert "relevance_score" in results[0]

    async def test_hybrid_search_sorted_by_relevance_score(self):
        """하이브리드 검색 결과가 relevance_score 내림차순으로 정렬되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        id1 = uuid.uuid4()
        id2 = uuid.uuid4()
        vector_rows = [
            _make_vector_row(precedent_id=id1, distance=0.1),  # 높은 유사도
            _make_vector_row(precedent_id=id2, distance=0.4),  # 낮은 유사도
        ]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=vector_rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.hybrid_search(
            query="보험금 청구",
            top_k=5,
        )

        scores = [r["relevance_score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    async def test_hybrid_search_top_k_limit(self):
        """하이브리드 검색 결과가 top_k 이하로 제한되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        # top_k*2 + 1 개의 결과 생성
        vector_rows = [_make_vector_row(distance=0.1 + i * 0.05) for i in range(7)]

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all = MagicMock(return_value=vector_rows)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.hybrid_search(query="보험금", top_k=3)

        assert len(results) <= 3

    async def test_hybrid_search_merges_duplicate_ids(self):
        """동일 ID 결과가 가중 합산으로 병합되어야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        shared_id = uuid.uuid4()
        # 벡터 결과와 키워드 결과에 동일한 ID가 포함됨
        vector_rows = [_make_vector_row(precedent_id=shared_id, distance=0.2)]
        keyword_rows = [_make_keyword_row(precedent_id=shared_id)]

        call_count = 0

        async def mock_execute(stmt):
            nonlocal call_count
            call_count += 1
            mock_result = MagicMock()
            if call_count == 1:
                mock_result.all = MagicMock(return_value=vector_rows)
            else:
                mock_result.all = MagicMock(return_value=keyword_rows)
            return mock_result

        mock_session = AsyncMock()
        mock_session.execute = mock_execute

        mock_emb = AsyncMock()
        mock_emb.embed_text = AsyncMock(return_value=_make_fixed_embedding())

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        results = await service.hybrid_search(
            query="보험금 청구",
            top_k=5,
        )

        # 동일 ID는 하나의 결과로 병합되어야 함
        result_ids = [r["id"] for r in results]
        assert result_ids.count(shared_id) == 1


class TestGetById:
    """PrecedentService.get_by_id() 테스트"""

    async def test_get_by_id_returns_precedent(self):
        """ID로 판례를 조회하면 딕셔너리를 반환해야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        pid = uuid.uuid4()
        row = _make_full_row(precedent_id=pid)

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=row)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        result = await service.get_by_id(pid)

        assert result is not None
        assert result["id"] == pid
        assert "key_clauses" in result
        assert "case_number" in result

    async def test_get_by_id_returns_none_when_not_found(self):
        """존재하지 않는 ID 조회 시 None을 반환해야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        result = await service.get_by_id(uuid.uuid4())

        assert result is None


class TestGetByCaseNumber:
    """PrecedentService.get_by_case_number() 테스트"""

    async def test_get_by_case_number_returns_precedent(self):
        """판례 번호로 조회하면 딕셔너리를 반환해야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        row = _make_full_row(case_number="2023다99999")

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=row)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        result = await service.get_by_case_number("2023다99999")

        assert result is not None
        assert result["case_number"] == "2023다99999"
        assert "key_clauses" in result

    async def test_get_by_case_number_returns_none_when_not_found(self):
        """존재하지 않는 판례 번호 조회 시 None을 반환해야 함"""
        from app.services.guidance.precedent_service import PrecedentService

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_emb = AsyncMock()

        service = PrecedentService(session=mock_session, embedding_service=mock_emb)
        result = await service.get_by_case_number("존재하지않는번호")

        assert result is None


class TestExtractKeywords:
    """PrecedentService._extract_keywords() 테스트"""

    def _make_service(self):
        """테스트용 서비스 인스턴스 생성 (세션/임베딩 불필요)"""
        from app.services.guidance.precedent_service import PrecedentService

        return PrecedentService(
            session=AsyncMock(),
            embedding_service=AsyncMock(),
        )

    def test_extract_keywords_basic(self):
        """기본 키워드 추출: 불용어 제거, 2자 이상, 길이순 내림차순"""
        service = self._make_service()
        keywords = service._extract_keywords("실손의료보험 가입자 보험금 지급 거절")

        assert isinstance(keywords, list)
        # 불용어("보험", "보험금")는 제거되어야 함
        assert "보험금" not in keywords
        assert "보험" not in keywords
        # 2자 이상 단어 포함
        assert "실손의료보험" in keywords
        # 길이순 내림차순 정렬
        lengths = [len(kw) for kw in keywords]
        assert lengths == sorted(lengths, reverse=True)

    def test_extract_keywords_empty_query(self):
        """빈 쿼리 입력 시 빈 리스트를 반환해야 함"""
        service = self._make_service()
        keywords = service._extract_keywords("")

        assert keywords == []

    def test_extract_keywords_stopwords_only(self):
        """불용어만 있을 경우 빈 리스트를 반환해야 함"""
        service = self._make_service()
        keywords = service._extract_keywords("보험 청구 분쟁 그 이 저")

        assert keywords == []

    def test_extract_keywords_min_length_two(self):
        """2자 미만 단어는 제외되어야 함"""
        service = self._make_service()
        # 1자 단어들 포함 쿼리 (불용어 아닌 것들)
        keywords = service._extract_keywords("대 법원 판결문 검토")

        # 1자 단어 "대"는 제외
        assert "대" not in keywords
        # 2자 이상 단어만 포함
        for kw in keywords:
            assert len(kw) >= 2


class TestMergeResults:
    """PrecedentService._merge_results() 테스트"""

    def _make_service(self):
        """테스트용 서비스 인스턴스 생성"""
        from app.services.guidance.precedent_service import PrecedentService

        return PrecedentService(
            session=AsyncMock(),
            embedding_service=AsyncMock(),
        )

    def test_merge_results_empty(self):
        """빈 결과 병합 시 빈 리스트를 반환해야 함"""
        service = self._make_service()
        result = service._merge_results(
            vector_results=[],
            keyword_results=[],
            vector_weight=0.7,
            keyword_weight=0.3,
        )

        assert result == []

    def test_merge_results_vector_only(self):
        """벡터 결과만 있을 때 벡터 가중치만 적용되어야 함"""
        service = self._make_service()
        vid = uuid.uuid4()
        vector_results = [
            {
                "id": vid,
                "case_number": "2023다11111",
                "court_name": "대법원",
                "decision_date": date(2023, 1, 1),
                "case_type": "보험금청구",
                "insurance_type": "실손의료보험",
                "summary": "요약",
                "ruling": "요지",
                "similarity": 0.8,
                "source_url": None,
            }
        ]

        result = service._merge_results(
            vector_results=vector_results,
            keyword_results=[],
            vector_weight=0.7,
            keyword_weight=0.3,
        )

        assert len(result) == 1
        assert result[0]["id"] == vid
        # relevance_score = similarity(0.8) * vector_weight(0.7) = 0.56
        assert abs(result[0]["relevance_score"] - 0.56) < 1e-9

    def test_merge_results_keyword_only(self):
        """키워드 결과만 있을 때 키워드 가중치만 적용되어야 함"""
        service = self._make_service()
        kid = uuid.uuid4()
        keyword_results = [
            {
                "id": kid,
                "case_number": "2022다22222",
                "court_name": "서울고등법원",
                "decision_date": date(2022, 6, 1),
                "case_type": "손해배상",
                "insurance_type": None,
                "summary": "요약",
                "ruling": "요지",
                "similarity": None,
                "source_url": None,
            }
        ]

        result = service._merge_results(
            vector_results=[],
            keyword_results=keyword_results,
            vector_weight=0.7,
            keyword_weight=0.3,
        )

        assert len(result) == 1
        assert result[0]["id"] == kid
        # relevance_score = keyword_weight(0.3)
        assert abs(result[0]["relevance_score"] - 0.3) < 1e-9

    def test_merge_results_duplicate_id_weighted_sum(self):
        """동일 ID가 벡터+키워드 모두에 있을 때 가중 합산되어야 함"""
        service = self._make_service()
        shared_id = uuid.uuid4()

        vector_results = [
            {
                "id": shared_id,
                "case_number": "2023다33333",
                "court_name": "대법원",
                "decision_date": date(2023, 3, 15),
                "case_type": "보험금청구",
                "insurance_type": "실손의료보험",
                "summary": "요약",
                "ruling": "요지",
                "similarity": 0.9,
                "source_url": None,
            }
        ]
        keyword_results = [
            {
                "id": shared_id,
                "case_number": "2023다33333",
                "court_name": "대법원",
                "decision_date": date(2023, 3, 15),
                "case_type": "보험금청구",
                "insurance_type": "실손의료보험",
                "summary": "요약",
                "ruling": "요지",
                "similarity": None,
                "source_url": None,
            }
        ]

        result = service._merge_results(
            vector_results=vector_results,
            keyword_results=keyword_results,
            vector_weight=0.7,
            keyword_weight=0.3,
        )

        # 하나의 결과로 병합
        assert len(result) == 1
        assert result[0]["id"] == shared_id
        # relevance_score = 0.9 * 0.7 + 0.3 = 0.63 + 0.3 = 0.93
        assert abs(result[0]["relevance_score"] - 0.93) < 1e-9
        # keyword_match가 True로 설정되어야 함
        assert result[0]["keyword_match"] is True
