---
name: ck:kanban
description: "Alias launcher for the ClaudeKit plans dashboard. Use for visual plan boards, progress tracking, and quick navigation into plan files."
category: dev-tools
keywords: [kanban, plans, dashboard, progress, timeline]
argument-hint: "[deprecated plans path or flags]"
metadata:
  author: claudekit
  version: "2.0.0"
---

# Plans Dashboard Alias

`/ck:kanban` is now a thin alias for `/ck:plans-kanban`.

It no longer starts the retired standalone `plans-kanban` server. Instead, it opens the ClaudeKit CLI dashboard plans route and lets the CLI own the runtime.

## Usage

```bash
node .claude/skills/plans-kanban/scripts/open-dashboard.cjs
```

Legacy path and server flags are still accepted with warnings and redirected to the CLI dashboard flow.

## Current Behavior

- Opens the plans dashboard route in `ck config ui`
- Starts `ck config ui --port 3456 --no-open` if the dashboard is not already running
- Follows CLI auto-fallback ports (`3456-3460`) when `3456` is busy
- Supports `--stop` for launcher-managed dashboard processes
- Warns instead of failing when deprecated standalone-server flags are used

## Recommended Commands

```bash
ck config ui
ck plan status /absolute/path/to/plan.md
cd /absolute/path/to/plan-dir && ck plan check <phase-id> --start
cd /absolute/path/to/plan-dir && ck plan check <phase-id>
cd /absolute/path/to/plan-dir && ck plan uncheck <phase-id>
```

## Note

For AI agent task orchestration boards that are not plan files, use the dedicated orchestration skills. This alias is now strictly for the plans dashboard.
