"""
Unit tests for database query analysis scripts.

RED phase: These tests define the expected behavior of the query analysis
and index validation scripts.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

PERF_DB_DIR = Path(__file__).parent.parent.parent.parent / "performance" / "db"


class TestQueryAnalysisScript:
    """Tests for performance/db/query_analysis.py."""

    def test_query_analysis_script_exists(self) -> None:
        """query_analysis.py 파일이 존재해야 한다."""
        script_path = PERF_DB_DIR / "query_analysis.py"
        assert script_path.exists(), f"query_analysis.py not found at {script_path}"

    def test_query_analysis_has_required_queries(self) -> None:
        """query_analysis.py는 분석할 주요 쿼리를 정의해야 한다."""
        script_path = PERF_DB_DIR / "query_analysis.py"
        content = script_path.read_text(encoding="utf-8")
        # 핵심 쿼리 패턴이 포함되어야 한다
        assert "vector" in content.lower() or "embedding" in content.lower(), (
            "Vector/embedding query must be present"
        )
        assert "chat" in content.lower() or "session" in content.lower(), (
            "Chat session query must be present"
        )
        assert "user" in content.lower(), "User query must be present"

    def test_query_analysis_produces_markdown_output(self) -> None:
        """query_analysis.py는 마크다운 형식의 출력을 생성해야 한다."""
        script_path = PERF_DB_DIR / "query_analysis.py"
        content = script_path.read_text(encoding="utf-8")
        # 마크다운 헤더나 테이블이 포함된 출력을 생성해야 한다
        assert "markdown" in content.lower() or "## " in content or "# " in content, (
            "Script must produce markdown output"
        )

    def test_query_analysis_has_explain_analyze(self) -> None:
        """query_analysis.py는 EXPLAIN ANALYZE를 사용해야 한다."""
        script_path = PERF_DB_DIR / "query_analysis.py"
        content = script_path.read_text(encoding="utf-8")
        assert "EXPLAIN" in content.upper(), (
            "Script must use EXPLAIN ANALYZE for query analysis"
        )

    def test_query_analysis_has_main_function(self) -> None:
        """query_analysis.py는 main 함수 또는 실행 진입점을 가져야 한다."""
        script_path = PERF_DB_DIR / "query_analysis.py"
        content = script_path.read_text(encoding="utf-8")
        assert "async def main" in content or 'if __name__ == "__main__"' in content, (
            "Script must have a main function or entry point"
        )

    def test_query_analysis_has_type_hints(self) -> None:
        """query_analysis.py는 타입 힌트를 사용해야 한다."""
        script_path = PERF_DB_DIR / "query_analysis.py"
        content = script_path.read_text(encoding="utf-8")
        # 타입 힌트의 증거: -> 또는 : str, : int, : list 등
        assert "->" in content or ": str" in content or ": list" in content, (
            "Script must use type hints"
        )

    def test_query_analysis_syntax_valid(self) -> None:
        """query_analysis.py는 유효한 Python 문법이어야 한다."""
        script_path = PERF_DB_DIR / "query_analysis.py"
        result = subprocess.run(
            [sys.executable, "-m", "py_compile", str(script_path)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            f"Syntax error in query_analysis.py: {result.stderr}"
        )


class TestIndexValidationScript:
    """Tests for performance/db/index_validation.py."""

    def test_index_validation_script_exists(self) -> None:
        """index_validation.py 파일이 존재해야 한다."""
        script_path = PERF_DB_DIR / "index_validation.py"
        assert script_path.exists(), (
            f"index_validation.py not found at {script_path}"
        )

    def test_index_validation_checks_expected_indexes(self) -> None:
        """index_validation.py는 예상되는 인덱스 목록을 검사해야 한다."""
        script_path = PERF_DB_DIR / "index_validation.py"
        content = script_path.read_text(encoding="utf-8")
        # users, chat_sessions, document_chunks 테이블 인덱스를 검증해야 한다
        assert "users" in content.lower() or "user" in content.lower(), (
            "Must check users table indexes"
        )
        assert "chunk" in content.lower() or "document" in content.lower(), (
            "Must check document_chunks table indexes"
        )

    def test_index_validation_detects_missing_indexes(self) -> None:
        """index_validation.py는 누락된 인덱스를 감지할 수 있어야 한다."""
        script_path = PERF_DB_DIR / "index_validation.py"
        content = script_path.read_text(encoding="utf-8")
        # 누락된 인덱스를 감지하는 로직이 있어야 한다
        assert "missing" in content.lower() or "not found" in content.lower() or (
            "EXPECTED_INDEXES" in content
        ), "Script must have logic to detect missing indexes"

    def test_index_validation_checks_index_usage(self) -> None:
        """index_validation.py는 인덱스 사용 통계를 확인해야 한다."""
        script_path = PERF_DB_DIR / "index_validation.py"
        content = script_path.read_text(encoding="utf-8")
        # pg_stat_user_indexes 또는 pg_indexes를 조회해야 한다
        assert (
            "pg_stat_user_indexes" in content
            or "pg_indexes" in content
            or "information_schema" in content.lower()
        ), "Script must query index usage statistics"

    def test_index_validation_has_type_hints(self) -> None:
        """index_validation.py는 타입 힌트를 사용해야 한다."""
        script_path = PERF_DB_DIR / "index_validation.py"
        content = script_path.read_text(encoding="utf-8")
        assert "->" in content or ": str" in content or ": list" in content, (
            "Script must use type hints"
        )

    def test_index_validation_syntax_valid(self) -> None:
        """index_validation.py는 유효한 Python 문법이어야 한다."""
        script_path = PERF_DB_DIR / "index_validation.py"
        result = subprocess.run(
            [sys.executable, "-m", "py_compile", str(script_path)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            f"Syntax error in index_validation.py: {result.stderr}"
        )


class TestSLOBaseline:
    """Tests for performance/slo/baselines.json structure."""

    def test_baselines_json_exists(self) -> None:
        """baselines.json 파일이 존재해야 한다."""
        baselines_path = (
            Path(__file__).parent.parent.parent.parent / "performance" / "slo" / "baselines.json"
        )
        assert baselines_path.exists(), f"baselines.json not found at {baselines_path}"

    def test_baselines_json_valid_structure(self) -> None:
        """baselines.json은 올바른 JSON 구조를 가져야 한다."""
        baselines_path = (
            Path(__file__).parent.parent.parent.parent / "performance" / "slo" / "baselines.json"
        )
        with baselines_path.open() as f:
            data = json.load(f)

        # 필수 섹션 확인
        assert "api" in data, "baselines.json must have 'api' section"
        assert "vector_search" in data, (
            "baselines.json must have 'vector_search' section"
        )

    def test_baselines_json_api_has_percentiles(self) -> None:
        """baselines.json api 섹션은 p50, p95, p99 필드를 가져야 한다."""
        baselines_path = (
            Path(__file__).parent.parent.parent.parent / "performance" / "slo" / "baselines.json"
        )
        with baselines_path.open() as f:
            data = json.load(f)

        api = data["api"]
        assert "p50_ms" in api, "api section must have p50_ms"
        assert "p95_ms" in api, "api section must have p95_ms"
        assert "p99_ms" in api, "api section must have p99_ms"

    def test_baselines_json_vector_search_has_percentiles(self) -> None:
        """baselines.json vector_search 섹션은 p99 필드를 가져야 한다."""
        baselines_path = (
            Path(__file__).parent.parent.parent.parent / "performance" / "slo" / "baselines.json"
        )
        with baselines_path.open() as f:
            data = json.load(f)

        vector = data["vector_search"]
        assert "p99_ms" in vector, "vector_search section must have p99_ms"


class TestK6ScriptStructure:
    """Tests for k6 JavaScript script structure (syntax validation)."""

    K6_DIR = Path(__file__).parent.parent.parent.parent / "performance" / "k6"

    def test_baseline_scenario_exists(self) -> None:
        """baseline.js 파일이 존재해야 한다."""
        assert (self.K6_DIR / "scenarios" / "baseline.js").exists()

    def test_stress_scenario_exists(self) -> None:
        """stress.js 파일이 존재해야 한다."""
        assert (self.K6_DIR / "scenarios" / "stress.js").exists()

    def test_spike_scenario_exists(self) -> None:
        """spike.js 파일이 존재해야 한다."""
        assert (self.K6_DIR / "scenarios" / "spike.js").exists()

    def test_soak_scenario_exists(self) -> None:
        """soak.js 파일이 존재해야 한다."""
        assert (self.K6_DIR / "scenarios" / "soak.js").exists()

    def test_helpers_js_exists(self) -> None:
        """lib/helpers.js 파일이 존재해야 한다."""
        assert (self.K6_DIR / "lib" / "helpers.js").exists()

    def test_reporters_js_exists(self) -> None:
        """lib/reporters.js 파일이 존재해야 한다."""
        assert (self.K6_DIR / "lib" / "reporters.js").exists()

    def test_baseline_has_vus_config(self) -> None:
        """baseline.js는 VU 설정을 포함해야 한다."""
        content = (self.K6_DIR / "scenarios" / "baseline.js").read_text(encoding="utf-8")
        assert "vus" in content.lower() or "target" in content.lower(), (
            "baseline.js must define VU configuration"
        )

    def test_baseline_has_thresholds(self) -> None:
        """baseline.js는 SLO threshold를 포함해야 한다."""
        content = (self.K6_DIR / "scenarios" / "baseline.js").read_text(encoding="utf-8")
        assert "thresholds" in content, "baseline.js must define thresholds"

    def test_stress_has_ramp_up(self) -> None:
        """stress.js는 점진적 부하 증가 설정을 포함해야 한다."""
        content = (self.K6_DIR / "scenarios" / "stress.js").read_text(encoding="utf-8")
        assert "target" in content and "duration" in content.lower(), (
            "stress.js must define ramp-up configuration"
        )

    def test_spike_has_burst_config(self) -> None:
        """spike.js는 급격한 부하 증가 설정을 포함해야 한다."""
        content = (self.K6_DIR / "scenarios" / "spike.js").read_text(encoding="utf-8")
        assert "200" in content or "spike" in content.lower(), (
            "spike.js must define spike (200 VU) configuration"
        )

    def test_soak_has_duration(self) -> None:
        """soak.js는 30분 지속 시간 설정을 포함해야 한다."""
        content = (self.K6_DIR / "scenarios" / "soak.js").read_text(encoding="utf-8")
        # The soak test must clearly reference a 30-minute total duration
        # Can be "30m" directly, "30 minutes" in comments, or 1800 seconds
        has_duration = (
            "30m" in content
            or "1800" in content
            or "30 minutes" in content.lower()
        )
        assert has_duration, (
            "soak.js must define 30-minute soak duration (30m, 1800, or '30 minutes')"
        )

    def test_helpers_has_authenticate_function(self) -> None:
        """helpers.js는 authenticate 함수를 포함해야 한다."""
        content = (self.K6_DIR / "lib" / "helpers.js").read_text(encoding="utf-8")
        assert "authenticate" in content, (
            "helpers.js must have authenticate() function"
        )

    def test_helpers_has_base_url(self) -> None:
        """helpers.js는 BASE_URL 환경 변수를 사용해야 한다."""
        content = (self.K6_DIR / "lib" / "helpers.js").read_text(encoding="utf-8")
        assert "BASE_URL" in content, (
            "helpers.js must use BASE_URL environment variable"
        )

    def test_helpers_has_chat_functions(self) -> None:
        """helpers.js는 채팅 세션 관련 함수를 포함해야 한다."""
        content = (self.K6_DIR / "lib" / "helpers.js").read_text(encoding="utf-8")
        assert "createChatSession" in content or "chat" in content.lower(), (
            "helpers.js must have chat session functions"
        )
