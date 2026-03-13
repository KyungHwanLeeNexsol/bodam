# Bodam Architecture Overview

## Status

New project - no existing codebase to analyze.

This file will be populated with architecture documentation once the codebase is established.

## Planned Architecture

- **Pattern**: Monorepo (Next.js frontend + FastAPI backend)
- **Communication**: BFF pattern via Next.js API routes proxying to FastAPI
- **Data Flow**: User query -> Next.js -> FastAPI -> RAG pipeline -> LLM -> Streaming response
- **Key Services**: RAG pipeline, Multi-LLM router, Insurance crawler, PDF parser

## Future Codemaps

After initial implementation, run `/moai codemaps` to generate:
- modules.md: Module descriptions and responsibilities
- dependencies.md: Dependency graph
- entry-points.md: API routes and entry points
- data-flow.md: Request lifecycle and state management
