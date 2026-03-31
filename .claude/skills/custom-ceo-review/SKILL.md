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
