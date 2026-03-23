---
name: custom-review-qa
description: >
  Practical code review and QA checklist for Bodam project.
  Supplements moai-foundation-quality TRUST 5 with production-focused
  review and systematic QA testing before deployment.
  Use after implementation, before /moai sync or deployment.
license: Apache-2.0
compatibility: Designed for Claude Code
allowed-tools: Read, Grep, Glob, Bash(npx:*), Bash(npm:*), Bash(uv:*), Bash(cd:*), Bash(git:*)
user-invocable: true
metadata:
  version: "1.0.0"
  category: "workflow"
  status: "active"
  updated: "2026-03-23"
  modularized: "false"
  tags: "code-review, qa, production-check, deployment-gate, bodam"
  author: "custom"
  context: "fork"
  related-skills: "moai-foundation-quality, moai-workflow-testing"

# MoAI Extension: Progressive Disclosure
progressive_disclosure:
  enabled: true
  level1_tokens: 100
  level2_tokens: 4000

# MoAI Extension: Triggers
triggers:
  keywords: ["review", "qa", "code review", "quality check", "pre-deploy", "ship"]
  phases: ["run", "sync"]
  agents: ["manager-quality", "expert-testing"]
---

# Code Review & QA for Bodam

## Purpose

Practical, checklist-driven code review and QA that complements TRUST 5 validation.
TRUST 5 measures quality metrics. This skill catches production issues that metrics miss.

## Part 1: Code Review

### Priority 1 - Production Crash Risks

- [ ] Unhandled null/undefined in React components (check optional chaining)
- [ ] Missing error boundaries in Next.js pages
- [ ] FastAPI endpoints without try/except for external service calls
- [ ] SQLAlchemy queries without proper session handling
- [ ] Missing await on async functions (Python and TypeScript)

### Priority 2 - Bodam-Specific Checks

Frontend (Next.js 16 + React 19):
- [ ] Server/Client Component boundary correct? ('use client' only where needed)
- [ ] Forms use react-hook-form + zod validation?
- [ ] UI components from shadcn/ui used consistently?
- [ ] Images use next/image for optimization?
- [ ] No hardcoded API URLs (use environment variables)?

Backend (FastAPI + Python 3.13):
- [ ] All endpoints have Pydantic v2 request/response models?
- [ ] Database queries use async (asyncpg)?
- [ ] Redis operations have timeout and fallback?
- [ ] AI/LLM calls have retry logic (tenacity)?
- [ ] Alembic migration is reversible (has downgrade)?
- [ ] No secrets in code? (.env.example updated if new vars added)

### Priority 3 - Edge Cases

- [ ] Empty list/array rendering (no blank page)
- [ ] Network failure UX (loading states, error messages)
- [ ] Korean text handling (encoding, length validation)
- [ ] Concurrent request handling (race conditions)

### Priority 4 - Cost & Performance

- [ ] OpenAI/Gemini API calls minimized? (no unnecessary LLM calls)
- [ ] CockroachDB query N+1 problem check
- [ ] Redis cache hit ratio consideration
- [ ] Bundle size impact (no unnecessary imports)

## Part 2: QA Checklist

### Step 1: Automated Checks (Run All)

```bash
# Frontend
cd frontend && npx tsc --noEmit          # Type check
cd frontend && npm run lint               # ESLint
cd frontend && npx vitest run             # Unit tests
cd frontend && npm run build              # Build check

# Backend
cd backend && uv run ruff check app/      # Linting
cd backend && uv run pytest --cov=app     # Tests + coverage
```

### Step 2: Impact Analysis

- List all files changed (git diff --name-only)
- Identify affected routes/pages
- Identify affected API endpoints
- Check if database migration is needed

### Step 3: Manual Verification Scenarios

For each affected route, verify:
- Happy path: Normal user flow works
- Error path: Invalid input shows proper error
- Empty state: No data scenario handled
- Auth: Protected routes redirect unauthenticated users

## Output Format

```
## Review & QA Result: [Feature/PR Name]

### Code Review
- Critical: [must fix before deploy]
- Warning: [should fix, not blocking]
- Good: [well-done areas]

### QA Results
- Frontend: tsc __ | lint __ | test __ | build __
- Backend: ruff __ | pytest __ | coverage __%
- Manual checks: [list of verified scenarios]

### Deploy Decision
- SHIP / HOLD / BLOCK
- Reason: [1 sentence]
```

## Rules

- BLOCK if any Critical issue exists
- BLOCK if any automated check fails
- HOLD if coverage drops below 80%
- This review + TRUST 5 validation = full quality gate
- Run this AFTER moai-foundation-quality, not instead of it
