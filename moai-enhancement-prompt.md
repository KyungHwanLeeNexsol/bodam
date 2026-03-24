# MoAI Enhancement Prompt - gstack + Superpowers 통합

아래 4개의 파일을 순서대로 생성해줘. 기존 MoAI 스킬과 충돌하지 않도록 custom 경로에 생성하며, 기존 moai-workflow-tdd와 moai-foundation-quality를 보강하는 역할이야.

---

## 파일 1: .claude/skills/custom-ceo-review/SKILL.md

```markdown
---
name: custom-ceo-review
description: >
  Feature value filter before SPEC creation. Validates user problem,
  MVP scope, and development ROI from product perspective.
  Use before /moai plan to prevent unnecessary development.
  Do NOT use for existing SPEC modification or implementation tasks.
license: Apache-2.0
compatibility: Designed for Claude Code
allowed-tools: Read, Grep, Glob
user-invocable: true
metadata:
  version: "1.0.0"
  category: "workflow"
  status: "active"
  updated: "2026-03-23"
  modularized: "false"
  tags: "product-review, scoping, mvp, value-validation, pre-spec"
  author: "custom"
  context: "fork"
  related-skills: "moai-workflow-spec, moai-foundation-philosopher"

# MoAI Extension: Progressive Disclosure
progressive_disclosure:
  enabled: true
  level1_tokens: 100
  level2_tokens: 3000

# MoAI Extension: Triggers
triggers:
  keywords: ["ceo-review", "product review", "should we build", "value check", "scoping"]
  phases: ["pre-plan"]
  agents: ["Plan"]
---

# CEO Review - Product Value Filter

## Purpose

This skill acts as a MANDATORY gate before /moai plan (SPEC creation).
Solo developers' time is their most expensive resource. This prevents building features that shouldn't exist.

## When to Invoke

- Before creating any new SPEC
- Before starting any feature that takes more than 2 hours
- When unsure if a feature is worth building

## Review Process

### Step 1: Problem Validation

Answer ALL of the following (skip none):

- What specific user problem does this solve?
- Who experiences this problem? (Be specific - not "users")
- How do they currently work around it?
- What happens if we never build this?

### Step 2: Value Assessment

- Does the core product work without this? (Yes = lower priority)
- Impact on key metrics: user acquisition / retention / revenue?
- Out of 10 target users, how many would actively want this?

### Step 3: MVP Scoping (Solo Developer Lens)

- Simplest possible version that delivers value?
- Can a solo developer ship this in 1-2 days?
- What can be explicitly cut? (List Out of Scope items)
- Any irreversible technical decisions involved?

### Step 4: Bodam-Specific Check

For this insurance AI platform:
- Does this align with the core insurance consultation flow?
- Does it require new API endpoints in FastAPI backend?
- Does it need new UI components in Next.js frontend?
- Database migration needed? (Alembic + CockroachDB impact)
- Does it touch the AI/LLM pipeline? (OpenAI/Gemini cost implications)

## Output Format (Mandatory)

```
## CEO Review: [Feature Name]
- **Problem**: [1 sentence]
- **Target User**: [specific persona]
- **MVP Scope**: [minimum deliverable]
- **Out of Scope**: [explicitly excluded items]
- **Estimated Effort**: [hours for solo dev]
- **Tech Impact**: Frontend / Backend / DB / AI Pipeline
- **Verdict**: GO / HOLD / KILL
- **Reason**: [1 sentence justification]
```

## Rules

- Verdict must be GO before proceeding to /moai plan
- HOLD = needs more information or user feedback
- KILL = not worth building right now
- If HOLD or KILL, suggest what to do instead

## Integration with MoAI Workflow

- This skill runs BEFORE moai-workflow-spec
- On GO verdict, proceed to: /moai plan "[feature description]"
- GO verdict output becomes input context for SPEC creation
- MVP Scope from this review constrains SPEC scope
```

---

## 파일 2: .claude/rules/custom/tdd-enforcement.md

```markdown
---
paths: "frontend/**/*.ts,frontend/**/*.tsx,backend/**/*.py"
---

# TDD Enforcement Rules (Superpowers-Inspired)

These rules supplement moai-workflow-tdd with strict enforcement.
moai-workflow-tdd provides the methodology. These rules provide the discipline.

## Iron Laws (HARD Rules)

### Law 1: No Implementation Without Failing Test
- Writing implementation code before a failing test exists is PROHIBITED
- If implementation code is written first, REVERT it and start with a test
- This applies to ALL code: components, API endpoints, utility functions, hooks

### Law 2: Test Must Fail for the Right Reason
- A new test must fail because the feature doesn't exist yet
- If it fails due to syntax error or import error, fix that first
- If the test passes immediately, the test is meaningless - rewrite it

### Law 3: Minimal GREEN
- GREEN phase allows ONLY the minimum code to pass the test
- No "while I'm here" additions
- No future-proofing
- No "this will be needed later" code

### Law 4: Commit Per Cycle
- Each RED-GREEN-REFACTOR cycle gets its own commit
- Commit message format: "test: [what] (RED)" → "feat: [what] (GREEN)" → "refactor: [what]"

## Red Flags - Immediate Stop and Restart

If ANY of these occur, stop current work and restart from RED:
1. Implementation code exists without a corresponding test
2. A test was written to match already-written code (post-hoc testing)
3. GREEN phase code exceeds what the test requires
4. Test passes on first run without prior RED confirmation

## Bodam Project Test Commands

Frontend (Next.js 16 + Vitest):
- Run tests: cd frontend && npx vitest run
- Watch mode: cd frontend && npx vitest
- Single file: cd frontend && npx vitest run [file]
- Coverage: cd frontend && npx vitest run --coverage

Backend (FastAPI + pytest):
- Run tests: cd backend && uv run pytest
- Single file: cd backend && uv run pytest tests/[file]
- Coverage: cd backend && uv run pytest --cov=app
- Async tests: Uses pytest-asyncio with asyncio_mode = "auto"

## Test File Locations

Frontend:
- Test directory: frontend/__tests__/
- Convention: *.test.ts or *.test.tsx
- Libraries: @testing-library/react, @testing-library/user-event, vitest, jsdom

Backend:
- Test directory: backend/tests/
- Convention: test_*.py
- Libraries: pytest, pytest-asyncio, httpx (for API tests), fakeredis, moto[s3]

## Integration with Existing MoAI TDD

- These rules ADD enforcement to moai-workflow-tdd, not replace it
- moai-workflow-tdd provides the methodology
- These rules provide the discipline and bodam-specific commands
- TRUST 5 quality gates still apply after TDD cycles
```

---

## 파일 3: .claude/skills/custom-review-qa/SKILL.md

```markdown
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
```

---

## 파일 4: CLAUDE.local.md (기존 내용이 있으면 뒤에 추가)

```markdown
# Custom Workflow Enhancement (gstack + Superpowers Integration)

## Enhanced Development Pipeline

The standard MoAI pipeline (Plan -> Run -> Sync) is enhanced with:

### Pre-Plan Gate: CEO Review
- BEFORE running /moai plan, invoke custom-ceo-review skill
- Only proceed to SPEC creation on GO verdict
- This prevents wasting time on low-value features
- Solo developer's time is the most expensive resource

### Enhanced Run Phase: TDD Enforcement
- During /moai run (implementation), enforce strict TDD rules
- See .claude/rules/custom/tdd-enforcement.md for Iron Laws
- These supplement moai-workflow-tdd with hard enforcement
- Each RED-GREEN-REFACTOR cycle gets its own commit

### Pre-Sync Gate: Code Review + QA
- BEFORE running /moai sync, invoke custom-review-qa skill
- Automated checks (tsc, lint, test, build, ruff, pytest) must all pass
- Code review checklist must show no Critical issues
- This supplements TRUST 5 with practical production checks

## Revised Pipeline

```
[CEO Review] -> GO? -> [/moai plan] -> [/moai run + TDD Iron Laws] -> [Review & QA] -> SHIP? -> [/moai sync]
     | KILL/HOLD                                                           | BLOCK/HOLD
   Stop & rethink                                                       Fix & re-review
```

## Bodam Project Quick Commands

```
# Full pipeline for new feature
/custom-ceo-review "[feature description]"
# If GO:
/moai plan "[feature description]"
/moai run SPEC-XXX
/custom-review-qa
# If SHIP:
/moai sync SPEC-XXX
```
```

---

## 실행 지시

1. 위 4개 파일을 순서대로 생성해줘
2. .claude/skills/custom-ceo-review/ 디렉토리가 없으면 생성
3. .claude/rules/custom/ 디렉토리가 없으면 생성
4. .claude/skills/custom-review-qa/ 디렉토리가 없으면 생성
5. CLAUDE.local.md는 기존 내용이 있으면 뒤에 추가, 없으면 새로 생성
6. 모든 파일 생성 후 tree 명령으로 생성된 파일 구조를 확인
7. 각 스킬이 MoAI에서 정상 인식되는지 확인 (YAML frontmatter 유효성)

기존 MoAI 스킬(.claude/skills/moai-*)은 절대 수정하지 마. 새 파일만 추가하는 거야.
