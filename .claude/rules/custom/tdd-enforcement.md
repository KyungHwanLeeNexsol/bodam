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
- Commit message format: "test: [what] (RED)" -> "feat: [what] (GREEN)" -> "refactor: [what]"

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
