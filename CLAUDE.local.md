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
