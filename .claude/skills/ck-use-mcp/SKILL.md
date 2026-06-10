---
name: ck:use-mcp
description: "Execute MCP server tools with intelligent discovery and filtering. Use for MCP integrations, tool execution, capability discovery."
category: dev-tools
keywords: [MCP, tools, execute, discovery]
argument-hint: "[task]"
metadata:
  author: claudekit
  version: "1.0.0"
---

# MCP Tool Execution

Execute MCP operations via **Gemini CLI** to preserve context budget.

## Execution Steps

1. **Execute task via Gemini CLI** (using stdin pipe for MCP support):
   ```bash
   # IMPORTANT: Use stdin piping for MCP tasks (historically more reliable for MCP server init)
   # Read model from .claude/.ck.json: gemini.model (default: gemini-3-flash-preview)
   echo "$ARGUMENTS. Return JSON only per GEMINI.md instructions." | gemini -y -m <gemini.model>
   ```

2. **Fallback to mcp-manager subagent** (if Gemini CLI unavailable):
   - Use `mcp-manager` subagent to discover and execute tools
   - If the subagent got issues with the scripts of `ck:mcp-management` skill, use `ck:mcp-builder` skill to fix them
   - **DO NOT** create ANY new scripts
   - The subagent can only use MCP tools if any to achieve this task
   - If the subagent can't find any suitable tools, just report it back to the main agent to move on to the next step

## Important Notes

- **MUST use stdin piping for MCP tasks** — historically more reliable for MCP server initialization
- Use `-y` flag to auto-approve tool execution
- **GEMINI.md auto-loaded**: Gemini CLI automatically loads `GEMINI.md` from project root, enforcing JSON-only response format
- **Parseable output**: Responses are structured JSON: `{"server":"name","tool":"name","success":true,"result":<data>,"error":null}`
- **Error handling**: Check gemini exit code — if non-zero or output contains `GaxiosError`/`RESOURCE_EXHAUSTED`/`MODEL_CAPACITY_EXHAUSTED`/`PERMISSION_DENIED`/`UNAUTHENTICATED`, fall back to mcp-manager subagent

## Anti-Pattern for MCP Tasks

```bash
# AVOID for MCP tasks - historically reported MCP init issues in headless mode
gemini -y -m <gemini.model> --prompt "..."

# Use stdin piping instead for MCP tool execution
echo "..." | gemini -y -m <gemini.model>
```

**Note**: `--prompt` is fine for non-MCP tasks (research, analysis). Only MCP tool execution requires stdin piping.
