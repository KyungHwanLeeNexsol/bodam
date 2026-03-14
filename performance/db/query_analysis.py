"""
Database Query Performance Analysis Script

Runs EXPLAIN ANALYZE on the top frequently-used queries in Bodam
and produces a markdown report with execution plans and timing data.

Usage:
    python performance/db/query_analysis.py [--output report.md]

Environment:
    DATABASE_URL: PostgreSQL connection string
    (defaults to postgresql://bodam:password@localhost:5432/bodam_dev)
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]

# Default database URL for local development
DEFAULT_DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://bodam:password@localhost:5432/bodam_dev",
)

# Strip +asyncpg suffix if using SQLAlchemy-style URL
if "+asyncpg" in DEFAULT_DATABASE_URL:
    DEFAULT_DATABASE_URL = DEFAULT_DATABASE_URL.replace("+asyncpg", "")


@dataclass
class QueryInfo:
    """Information about a query to analyze."""

    name: str
    description: str
    sql: str
    params: list[Any] = field(default_factory=list)


@dataclass
class AnalysisResult:
    """Result of EXPLAIN ANALYZE for a single query."""

    query_name: str
    description: str
    sql: str
    execution_plan: list[str]
    execution_time_ms: float
    planning_time_ms: float
    uses_sequential_scan: bool
    uses_index_scan: bool
    error: str | None = None


# Top queries to analyze in the Bodam system
QUERIES_TO_ANALYZE: list[QueryInfo] = [
    QueryInfo(
        name="vector_similarity_search",
        description="Vector similarity search using pgvector <=> operator (HNSW index)",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT id, content, metadata, embedding <=> $1::vector AS distance
            FROM document_chunks
            ORDER BY embedding <=> $1::vector
            LIMIT 5
        """,
        # Use a dummy 1536-dimension zero vector for analysis
        params=["[" + ",".join(["0"] * 1536) + "]"],
    ),
    QueryInfo(
        name="chat_session_lookup_by_user",
        description="Retrieve chat sessions for a specific user (ordered by latest)",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT id, user_id, title, created_at, updated_at
            FROM chat_sessions
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT 20
        """,
        params=["00000000-0000-0000-0000-000000000001"],
    ),
    QueryInfo(
        name="policy_chunk_retrieval",
        description="Retrieve policy document chunks by document ID",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT id, document_id, content, chunk_index, metadata
            FROM document_chunks
            WHERE document_id = $1
            ORDER BY chunk_index
        """,
        params=["00000000-0000-0000-0000-000000000001"],
    ),
    QueryInfo(
        name="auth_token_validation",
        description="User lookup by email for JWT authentication validation",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT id, email, hashed_password, is_active, created_at
            FROM users
            WHERE email = $1
              AND is_active = true
        """,
        params=["test@example.com"],
    ),
    QueryInfo(
        name="session_message_history",
        description="Retrieve message history for a chat session",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT id, session_id, role, content, created_at
            FROM messages
            WHERE session_id = $1
            ORDER BY created_at ASC
        """,
        params=["00000000-0000-0000-0000-000000000001"],
    ),
    QueryInfo(
        name="document_metadata_lookup",
        description="Look up document metadata by source URL",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT id, title, source_url, company_name, policy_type,
                   embedding_status, created_at
            FROM documents
            WHERE company_name = $1
              AND policy_type = $2
            ORDER BY created_at DESC
        """,
        params=["삼성생명", "실손의료비"],
    ),
    QueryInfo(
        name="embedding_status_check",
        description="Check embedding processing status for pending chunks",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT id, document_id, chunk_index, embedding_status
            FROM document_chunks
            WHERE embedding_status = 'pending'
            ORDER BY created_at ASC
            LIMIT 100
        """,
    ),
    QueryInfo(
        name="recent_crawl_runs",
        description="Retrieve recent crawl run history",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT id, company_name, status, started_at, completed_at,
                   pages_crawled, documents_found
            FROM crawl_runs
            ORDER BY started_at DESC
            LIMIT 10
        """,
    ),
    QueryInfo(
        name="session_message_count_aggregate",
        description="Count messages per session for analytics",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT session_id, COUNT(*) as message_count
            FROM messages
            WHERE session_id = $1
            GROUP BY session_id
        """,
        params=["00000000-0000-0000-0000-000000000001"],
    ),
    QueryInfo(
        name="user_active_sessions",
        description="Find active chat sessions for a user in the last 7 days",
        sql="""
            EXPLAIN (ANALYZE, FORMAT TEXT, BUFFERS)
            SELECT cs.id, cs.title, cs.updated_at,
                   COUNT(m.id) as message_count
            FROM chat_sessions cs
            LEFT JOIN messages m ON m.session_id = cs.id
            WHERE cs.user_id = $1
              AND cs.updated_at >= NOW() - INTERVAL '7 days'
            GROUP BY cs.id, cs.title, cs.updated_at
            ORDER BY cs.updated_at DESC
        """,
        params=["00000000-0000-0000-0000-000000000001"],
    ),
]


async def run_explain_analyze(
    conn: Any, query_info: QueryInfo
) -> AnalysisResult:
    """
    Run EXPLAIN ANALYZE for a single query and parse the result.

    Args:
        conn: asyncpg database connection
        query_info: Query information including SQL and parameters

    Returns:
        AnalysisResult with parsed execution plan details
    """
    try:
        rows = await conn.fetch(query_info.sql, *query_info.params)
        plan_lines = [str(row[0]) for row in rows]
        plan_text = "\n".join(plan_lines)

        # Parse timing from EXPLAIN ANALYZE output
        execution_time_ms = 0.0
        planning_time_ms = 0.0
        for line in plan_lines:
            if "Execution Time:" in line:
                try:
                    execution_time_ms = float(line.split(":")[1].strip().split(" ")[0])
                except (ValueError, IndexError):
                    pass
            elif "Planning Time:" in line:
                try:
                    planning_time_ms = float(line.split(":")[1].strip().split(" ")[0])
                except (ValueError, IndexError):
                    pass

        uses_seq_scan = "Seq Scan" in plan_text
        uses_index_scan = "Index Scan" in plan_text or "Index Only Scan" in plan_text

        return AnalysisResult(
            query_name=query_info.name,
            description=query_info.description,
            sql=query_info.sql,
            execution_plan=plan_lines,
            execution_time_ms=execution_time_ms,
            planning_time_ms=planning_time_ms,
            uses_sequential_scan=uses_seq_scan,
            uses_index_scan=uses_index_scan,
        )
    except Exception as e:
        return AnalysisResult(
            query_name=query_info.name,
            description=query_info.description,
            sql=query_info.sql,
            execution_plan=[],
            execution_time_ms=0.0,
            planning_time_ms=0.0,
            uses_sequential_scan=False,
            uses_index_scan=False,
            error=str(e),
        )


def generate_markdown_report(results: list[AnalysisResult]) -> str:
    """
    Generate a markdown report from EXPLAIN ANALYZE results.

    Args:
        results: List of analysis results

    Returns:
        Markdown string with the complete report
    """
    lines: list[str] = [
        "# Database Query Performance Analysis Report",
        "",
        f"Generated: {datetime.now().isoformat()}",
        "",
        "## Summary",
        "",
        "| Query | Execution Time (ms) | Planning Time (ms) | Seq Scan | Index Scan | Status |",
        "|-------|--------------------|--------------------|----------|------------|--------|",
    ]

    for result in results:
        if result.error:
            status = "ERROR"
        elif result.uses_sequential_scan:
            status = "WARNING (Seq Scan)"
        else:
            status = "OK"

        seq_scan = "Yes" if result.uses_sequential_scan else "No"
        idx_scan = "Yes" if result.uses_index_scan else "No"

        lines.append(
            f"| {result.query_name} "
            f"| {result.execution_time_ms:.2f} "
            f"| {result.planning_time_ms:.2f} "
            f"| {seq_scan} "
            f"| {idx_scan} "
            f"| {status} |"
        )

    lines.extend([
        "",
        "## Detailed Execution Plans",
        "",
    ])

    for result in results:
        lines.extend([
            f"### {result.query_name}",
            "",
            f"**Description:** {result.description}",
            "",
        ])

        if result.error:
            lines.extend([
                f"**Error:** {result.error}",
                "",
                "> Note: This query may reference a table that doesn't exist in the",
                "> current schema, or the test parameters may be invalid.",
                "",
            ])
            continue

        lines.extend([
            f"- Execution Time: **{result.execution_time_ms:.2f}ms**",
            f"- Planning Time: **{result.planning_time_ms:.2f}ms**",
            f"- Sequential Scan: {'Yes (NEEDS INDEX)' if result.uses_sequential_scan else 'No'}",
            f"- Index Scan: {'Yes' if result.uses_index_scan else 'No'}",
            "",
            "**Execution Plan:**",
            "",
            "```",
        ])
        lines.extend(result.execution_plan)
        lines.extend([
            "```",
            "",
        ])

    return "\n".join(lines)


async def main(database_url: str, output_path: str | None = None) -> None:
    """
    Main entry point for the query analysis script.

    Args:
        database_url: PostgreSQL connection string
        output_path: Path to write the markdown report (None for stdout)
    """
    if asyncpg is None:
        print(
            "ERROR: asyncpg is not installed. Install with: pip install asyncpg",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Connecting to database: {database_url.split('@')[-1]}")

    try:
        conn = await asyncpg.connect(database_url)
    except Exception as e:
        print(f"ERROR: Failed to connect to database: {e}", file=sys.stderr)
        print(
            "Generating report with placeholder data for offline analysis.",
            file=sys.stderr,
        )
        # Generate placeholder report when DB is not available
        placeholder_results = [
            AnalysisResult(
                query_name=q.name,
                description=q.description,
                sql=q.sql,
                execution_plan=[],
                execution_time_ms=0.0,
                planning_time_ms=0.0,
                uses_sequential_scan=False,
                uses_index_scan=False,
                error="Database not available - run against live database for actual results",
            )
            for q in QUERIES_TO_ANALYZE
        ]
        report = generate_markdown_report(placeholder_results)
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(report)
            print(f"Report written to: {output_path}")
        else:
            print(report)
        return

    try:
        results: list[AnalysisResult] = []
        print(f"Analyzing {len(QUERIES_TO_ANALYZE)} queries...")

        for query_info in QUERIES_TO_ANALYZE:
            print(f"  - {query_info.name}...")
            result = await run_explain_analyze(conn, query_info)
            results.append(result)

        report = generate_markdown_report(results)

        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(report)
            print(f"Report written to: {output_path}")
        else:
            print(report)

    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Analyze database query performance using EXPLAIN ANALYZE"
    )
    parser.add_argument(
        "--database-url",
        default=DEFAULT_DATABASE_URL,
        help="PostgreSQL connection URL",
    )
    parser.add_argument(
        "--output",
        help="Output file path for the markdown report (default: stdout)",
    )
    args = parser.parse_args()

    asyncio.run(main(args.database_url, args.output))
