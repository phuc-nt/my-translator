# Design Spec: Conversation Sidebar & Session Lifecycle

**Date:** 2026-04-08
**Status:** Approved

---

## Overview

Redesign the MyJavis overlay UI to support multiple conversations via a toggleable sidebar. Each conversation maps to one session. The start/stop button controls audio capture only; a new "End" button handles session termination and file saving.

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  [≡] [⚙] ● Ready  [SYS][MIC][BOTH]  [▶] [TTS] [✕]│  ← control bar
├──────────┬──────────────────────────────────────────┤
│ SIDEBAR  │                                          │
│ ──────── │         Transcript area                  │
│ + New    │         (unchanged)                      │
│          │                                          │
│ 🗨 Conv1  │                                          │
│ 🗨 Conv2  │                                          │
│ ...      │                                          │
└──────────┴──────────────────────────────────────────┘
```

- `[≡]` toggle button added to left of control bar — hides/shows sidebar
- Sidebar is **hidden by default**, slides in when toggled
- Sidebar **pushes transcript area right** (window layout reflows, not overlay)
- Sidebar width: ~180px
- Transcript area: unchanged (continuous text, not bubbles)

---

## Sidebar

### Structure
- `+ New` button at the top — creates a new conversation
- Conversation list below, each item shows: name (auto-generated as `YYYY-MM-DD HH:MM`) + icon
- Active conversation is highlighted
- Clicking an old conversation loads its saved transcript (read-only view); Start and End buttons are disabled in this mode

### Behavior
- Sidebar state (open/closed) is not persisted — always starts closed
- Conversation list is populated from existing saved transcripts via `list_transcripts` Tauri command on app init

---

## Session Lifecycle

Two distinct concepts are separated:

### Listening State (existing button, changed behavior)
- `[▶ Start]` — starts audio capture and Soniox streaming, transcript accumulates
- `[■ Stop]` — pauses audio capture; session remains active, transcript is preserved
- Start/Stop can be toggled multiple times within one session
- Does **not** save file, does **not** end session

### Session Lifecycle (new)
- A session begins when the user clicks `+ New` in the sidebar
- `[✕ End]` button — ends the active session: stops capture, closes Soniox, saves transcript file, adds conversation to sidebar list
- `[✕ End]` is only visible when `sessionActive === true`

### User Flow
1. Click `+ New` → new conversation created, transcript area cleared, session active (not yet capturing)
2. Click `[▶ Start]` → begin listening
3. Click `[■ Stop]` → pause listening (session still active, transcript preserved)
4. Click `[▶ Start]` → resume listening in same session
5. Click `[✕ End]` → save file, conversation appears in sidebar list, session ends

---

## Technical Changes

### `src/index.html`
- Add `[≡]` button to left of control bar
- Add `#sidebar` panel (before `#transcript-content`): contains `#btn-new-conversation` and `#conversation-list`
- Add `#btn-end` to control bar (after TTS button)
- `#overlay-view` inner layout: `flex-direction: row` with sidebar + transcript as siblings

### `src/styles/main.css`
- `#overlay-view` content area: `display: flex; flex-direction: row`
- `.sidebar`: `width: 180px; flex-shrink: 0; overflow-y: auto; transition: width`
- `.sidebar.hidden`: `width: 0; overflow: hidden`
- `.conversation-item`: hover + active highlight states
- `#btn-end`: same style as existing icon buttons, hidden by default

### `src/js/app.js`
- New state vars:
  - `sessionActive` (bool) — true when a conversation has been started but not ended
  - `currentConversationId` (string|null) — timestamp-based ID of active conversation
- Rename/refactor existing stop logic:
  - `_stopCapture()` — stops audio only (current stop behavior minus save/reset)
  - `_endSession()` — calls `_stopCapture()`, saves transcript via `save_transcript`, resets transcript UI, sets `sessionActive = false`, refreshes conversation list
- `btn-start` behavior: only works when `sessionActive === true`; if no session, clicking Start auto-creates one (same as clicking `+ New` then `▶`)
- `btn-end` visibility: toggled based on `sessionActive`
- `btn-new-conversation`: creates new session, clears transcript area, sets `sessionActive = true`
- On init: call `list_transcripts` to populate sidebar

### Rust/Tauri
No changes needed. `save_transcript`, `list_transcripts`, and `read_transcript` commands already exist.

---

## Out of Scope
- Renaming conversations (name stays as auto-generated datetime)
- Deleting conversations
- Searching conversations
- Any changes to Soniox/TTS/audio pipeline behavior
