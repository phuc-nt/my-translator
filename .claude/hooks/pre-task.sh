#!/usr/bin/env bash
# Blueberry Sensei — Pre-task hook
# Reminds Claude to read memory before starting work
echo "[Blueberry Sensei] Reading project memory before task..."
if [ -f ".claude/memory/MEMORY.md" ]; then
  echo "[Blueberry Sensei] MEMORY.md found — Claude should read it now"
fi
