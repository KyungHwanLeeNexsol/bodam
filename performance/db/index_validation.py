"""
Database Index Validation Script

Verifies that all expected indexes exist and are being used effectively.
Reports unused indexes and missing critical indexes.

Usage:
    python performance/db/index_validation.py [--output report.md]

Environment:
    DATABASE_URL: PostgreSQL connection string
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import Any

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]

DEFAULT_DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://bodam:password@localhost:5432/bodam_dev",
)

if "+asyncpg" in DEFAULT_DATABASE_URL:
    DEFAULT_DATABASE_URL = DEFAULT_DATABASE_URL.replace("+asyncpg", "")


@dataclass
class ExpectedIndex:
    """Definition of an expected database index."""

    table_name: str
    index_name: str
    columns: list[str]
    index_type: str = "btree"
    is_critical: bool = True
    description: str = ""


@dataclass
class IndexStatus:
    """Status of a single index."""

    table_name: str
    index_name: str
    exists: bool
    index_type: str = ""
    index_size: str = ""
    idx_scan: int = 0
    idx_tup_read: int = 0
    idx_tup_fetch: int = 0
    is_unused: bool = False
    description: str = ""


# Expected indexes that must exist for optimal performance
EXPECTED_INDEXES: list[ExpectedIndex] = [
    # Users table
    ExpectedIndex(
        table_name="users",
        index_name="ix_users_email",
        columns=["email"],
        description="Email lookup for authentication (critical path)",
    ),
    ExpectedIndex(
        table_name="users",
        index_name="ix_users_id",
        columns=["id"],
        description="Primary key index",
    ),
    # Chat sessions table
    ExpectedIndex(
        table_name="chat_sessions",
        index_name="ix_chat_sessions_user_id",
        columns=["user_id"],
        description="Session lookup by user (required for listing sessions)",
    ),
    ExpectedIndex(
        table_name="chat_sessions",
        index_name="ix_chat_sessions_updated_at",
        columns=["updated_at"],
        is_critical=False,
        description="Session ordering by last activity",
    ),
    # Messages table
    ExpectedIndex(
        table_name="messages",
        index_name="ix_messages_session_id",
        columns=["session_id"],
        description="Message lookup by session (critical for chat history)",
    ),
    # Document chunks table (most critical for RAG performance)
    ExpectedIndex(
        table_name="document_chunks",
        index_name="ix_document_chunks_document_id",
        columns=["document_id"],
        description="Chunk lookup by document",
    ),
    ExpectedIndex(
        table_name="document_chunks",
        index_name="ix_document_chunks_embedding_status",
        columns=["embedding_status"],
        is_critical=False,
        description="Filter chunks by embedding processing status",
    ),
    # pgvector HNSW index (critical for vector search performance)
    ExpectedIndex(
        table_name="document_chunks",
        index_name="idx_document_chunks_embedding_hnsw",
        columns=["embedding"],
        index_type="hnsw",
        description="HNSW vector similarity search index (p99 < 200ms requirement)",
    ),
    # Documents table
    ExpectedIndex(
        table_name="documents",
        index_name="ix_documents_company_name",
        columns=["company_name"],
        is_critical=False,
        description="Filter documents by insurance company",
    ),
    # Crawl runs table
    ExpectedIndex(
        table_name="crawl_runs",
        index_name="ix_crawl_runs_started_at",
        columns=["started_at"],
        is_critical=False,
        description="Order crawl runs by start time",
    ),
]


async def check_index_exists(conn: Any, index_name: str) -> bool:
    """
    Check if an index exists in the database.

    Args:
        conn: asyncpg database connection
        index_name: Name of the index to check

    Returns:
        True if the index exists
    """
    result = await conn.fetchval(
        """
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE indexname = $1
        )
        """,
        index_name,
    )
    return bool(result)


async def get_index_stats(conn: Any, index_name: str) -> dict[str, Any]:
    """
    Get usage statistics for an index from pg_stat_user_indexes.

    Args:
        conn: asyncpg database connection
        index_name: Name of the index

    Returns:
        Dictionary with index statistics
    """
    row = await conn.fetchrow(
        """
        SELECT
            s.relname AS table_name,
            s.indexrelname AS index_name,
            s.idx_scan,
            s.idx_tup_read,
            s.idx_tup_fetch,
            pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
            ix.indexdef
        FROM pg_stat_user_indexes s
        JOIN pg_indexes ix ON ix.indexname = s.indexrelname
        WHERE s.indexrelname = $1
        """,
        index_name,
    )
    if row is None:
        return {}
    return dict(row)


async def get_all_table_indexes(conn: Any, table_name: str) -> list[dict[str, Any]]:
    """
    Get all indexes for a specific table.

    Args:
        conn: asyncpg database connection
        table_name: Name of the table

    Returns:
        List of index information dictionaries
    """
    rows = await conn.fetch(
        """
        SELECT
            i.relname AS index_name,
            ix.indisunique AS is_unique,
            ix.indisprimary AS is_primary,
            am.amname AS index_type,
            array_to_string(
                array_agg(a.attname ORDER BY k.n),
                ','
            ) AS columns,
            pg_size_pretty(pg_relation_size(i.oid)) AS index_size
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_am am ON i.relam = am.oid
        JOIN pg_attribute a ON a.attrelid = t.oid
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
            ON a.attnum = k.attnum
        WHERE t.relname = $1
          AND t.relkind = 'r'
        GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname, i.oid
        ORDER BY i.relname
        """,
        table_name,
    )
    return [dict(row) for row in rows]


async def validate_indexes(conn: Any) -> tuple[list[IndexStatus], list[str]]:
    """
    Validate all expected indexes and return their status.

    Args:
        conn: asyncpg database connection

    Returns:
        Tuple of (index_statuses, missing_critical_indexes)
    """
    statuses: list[IndexStatus] = []
    missing_critical: list[str] = []

    for expected in EXPECTED_INDEXES:
        exists = await check_index_exists(conn, expected.index_name)

        if not exists:
            status = IndexStatus(
                table_name=expected.table_name,
                index_name=expected.index_name,
                exists=False,
                description=expected.description,
            )
            statuses.append(status)
            if expected.is_critical:
                missing_critical.append(
                    f"{expected.table_name}.{expected.index_name}"
                )
        else:
            stats = await get_index_stats(conn, expected.index_name)
            idx_scan = stats.get("idx_scan", 0) or 0
            status = IndexStatus(
                table_name=expected.table_name,
                index_name=expected.index_name,
                exists=True,
                index_type=(
                stats.get("indexdef", "").split(" USING ")[-1].split("(")[0]
                if "USING" in stats.get("indexdef", "")
                else ""
            ),
                index_size=stats.get("index_size", "N/A"),
                idx_scan=idx_scan,
                idx_tup_read=stats.get("idx_tup_read", 0) or 0,
                idx_tup_fetch=stats.get("idx_tup_fetch", 0) or 0,
                is_unused=idx_scan == 0,
                description=expected.description,
            )
            statuses.append(status)

    return statuses, missing_critical


def generate_markdown_report(
    statuses: list[IndexStatus],
    missing_critical: list[str],
    all_indexes: dict[str, list[dict[str, Any]]],
) -> str:
    """
    Generate a markdown report from index validation results.

    Args:
        statuses: List of IndexStatus objects
        missing_critical: List of missing critical index names
        all_indexes: All indexes keyed by table name

    Returns:
        Markdown report string
    """
    existing = [s for s in statuses if s.exists]
    missing = [s for s in statuses if not s.exists]
    unused = [s for s in existing if s.is_unused]

    lines: list[str] = [
        "# Database Index Validation Report",
        "",
        f"Generated: {datetime.now().isoformat()}",
        "",
        "## Summary",
        "",
        f"- Total expected indexes: **{len(statuses)}**",
        f"- Existing indexes: **{len(existing)}**",
        f"- Missing indexes: **{len(missing)}**",
        f"- Unused indexes (0 scans): **{len(unused)}**",
        f"- Missing critical indexes: **{len(missing_critical)}**",
        "",
    ]

    if missing_critical:
        lines.extend([
            "## CRITICAL: Missing Indexes",
            "",
            "> These indexes are required for optimal performance and must be created.",
            "",
        ])
        for idx_name in missing_critical:
            lines.append(f"- `{idx_name}`")
        lines.append("")

    lines.extend([
        "## Expected Index Status",
        "",
        "| Table | Index | Exists | Type | Size | Scans | Status |",
        "|-------|-------|--------|------|------|-------|--------|",
    ])

    for status in statuses:
        exists_icon = "Yes" if status.exists else "**MISSING**"
        if not status.exists:
            row_status = "MISSING (CRITICAL)" if any(
                e.index_name == status.index_name and e.is_critical
                for e in EXPECTED_INDEXES
            ) else "MISSING"
        elif status.is_unused:
            row_status = "EXISTS (unused)"
        else:
            row_status = "OK"

        lines.append(
            f"| {status.table_name} "
            f"| {status.index_name} "
            f"| {exists_icon} "
            f"| {status.index_type} "
            f"| {status.index_size} "
            f"| {status.idx_scan} "
            f"| {row_status} |"
        )

    if unused:
        lines.extend([
            "",
            "## Unused Indexes",
            "",
            "These indexes have 0 scans and may be candidates for removal:",
            "",
        ])
        for status in unused:
            lines.append(
                f"- `{status.table_name}.{status.index_name}` - {status.description}"
            )

    lines.extend([
        "",
        "## All Discovered Indexes by Table",
        "",
    ])

    for table_name, indexes in all_indexes.items():
        lines.extend([
            f"### {table_name}",
            "",
            "| Index Name | Type | Columns | Size | Unique | Primary |",
            "|-----------|------|---------|------|--------|---------|",
        ])
        for idx in indexes:
            lines.append(
                f"| {idx.get('index_name', '')} "
                f"| {idx.get('index_type', '')} "
                f"| {idx.get('columns', '')} "
                f"| {idx.get('index_size', '')} "
                f"| {'Yes' if idx.get('is_unique') else 'No'} "
                f"| {'Yes' if idx.get('is_primary') else 'No'} |"
            )
        lines.append("")

    return "\n".join(lines)


async def main(database_url: str, output_path: str | None = None) -> None:
    """
    Main entry point for the index validation script.

    Args:
        database_url: PostgreSQL connection string
        output_path: Path to write the markdown report
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
        # Generate placeholder report
        placeholder_statuses = [
            IndexStatus(
                table_name=exp.table_name,
                index_name=exp.index_name,
                exists=False,
                description="Database not available - run against live database",
            )
            for exp in EXPECTED_INDEXES
        ]
        report = generate_markdown_report(
            placeholder_statuses,
            [f"{exp.table_name}.{exp.index_name}" for exp in EXPECTED_INDEXES if exp.is_critical],
            {},
        )
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(report)
            print(f"Placeholder report written to: {output_path}")
        else:
            print(report)
        return

    try:
        print("Validating indexes...")
        statuses, missing_critical = await validate_indexes(conn)

        # Gather all indexes for relevant tables
        table_names = list({exp.table_name for exp in EXPECTED_INDEXES})
        all_indexes: dict[str, list[dict[str, Any]]] = {}
        for table_name in table_names:
            all_indexes[table_name] = await get_all_table_indexes(conn, table_name)

        report = generate_markdown_report(statuses, missing_critical, all_indexes)

        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(report)
            print(f"Report written to: {output_path}")
        else:
            print(report)

        if missing_critical:
            print(
                f"\nWARNING: {len(missing_critical)} critical index(es) are missing!",
                file=sys.stderr,
            )
            sys.exit(1)

    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Validate database indexes and report missing or unused indexes"
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
