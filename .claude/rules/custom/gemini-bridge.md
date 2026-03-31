# Gemini Bridge Integration

When an agent determines that Gemini would be more effective than Claude for a specific subtask, delegate to the Gemini bridge script.

## When to Use Gemini

Use Gemini via the bridge script for these task types:

- Large codebase analysis (many files, 100K+ tokens of context)
- Bulk documentation summarization
- Simple code generation where speed matters more than reasoning depth
- File content transformation or formatting tasks

## When to Use Claude (default)

Stay with Claude for:

- Complex reasoning and architecture decisions
- Security analysis and vulnerability detection
- Nuanced code review requiring deep understanding
- Multi-step planning and strategy

## How to Call Gemini

From any agent with Bash access:

```bash
# Quick task with Gemini Flash (fast, cheap)
uv run --with google-genai .claude/scripts/gemini_call.py --prompt "task description" --model gemini-2.0-flash

# Complex task with Gemini Pro (deep analysis, 1M context)
uv run --with google-genai .claude/scripts/gemini_call.py --prompt "task description" --model gemini-2.5-pro

# With file context
uv run --with google-genai .claude/scripts/gemini_call.py --prompt "analyze these files" --files src/main.py src/utils.py --model gemini-2.5-pro

# Pipe prompt via stdin
echo "summarize this code" | uv run --with google-genai .claude/scripts/gemini_call.py --files src/**/*.py
```

## Available Models

| Model | Use Case | Context | Speed |
|-------|----------|---------|-------|
| gemini-2.5-pro | Complex analysis, large context | 1M tokens | Medium |
| gemini-2.5-flash | Balanced speed/quality | 1M tokens | Fast |
| gemini-2.0-flash | Quick tasks, simple generation | 1M tokens | Fastest |
| gemini-2.0-flash-lite | Minimal tasks, classification | 1M tokens | Ultra-fast |

## Environment

Requires `GEMINI_API_KEY` environment variable (configured in settings.json env).
