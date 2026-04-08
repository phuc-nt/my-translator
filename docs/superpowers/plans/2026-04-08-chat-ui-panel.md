# Chat UI Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat-like UI panel (history + input) to the overlay view, UI-only (no AI backend yet).

**Architecture:** Add chat panel markup below the transcript area; implement a minimal in-memory message store + handlers in `src/js/app.js` to append user messages and an assistant placeholder response; style bubbles and layout in `src/styles/main.css`.

**Tech Stack:** Vanilla HTML/CSS/JS in Tauri frontend (`src/index.html`, `src/styles/main.css`, `src/js/app.js`).

---

### Task 1: Add chat panel markup to overlay

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Add chat panel container inside overlay view**
  - Place it inside `#content-area` (next to sidebar+transcript) as a bottom-docked panel under the transcript area.
  - Use these IDs/classes (so JS/CSS can target them):
    - `#chat-panel`
    - `#chat-messages`
    - `#chat-input`
    - `#btn-chat-send`

---

### Task 2: Add chat styling (layout + bubbles)

**Files:**
- Modify: `src/styles/main.css`

- [ ] **Step 1: Add chat layout**
  - Chat panel fixed height (start with ~200px)
  - Messages scroll inside `#chat-messages`
  - Input row with textarea + send button
- [ ] **Step 2: Add bubble styles**
  - `.chat-message.user` right-aligned accent-ish
  - `.chat-message.assistant` left-aligned glass-ish

---

### Task 3: Add chat controller (UI-only)

**Files:**
- Modify: `src/js/app.js`

- [ ] **Step 1: Add in-memory message array to `App`**
  - `this.chatMessages = []`
- [ ] **Step 2: Bind handlers on init**
  - Send button click
  - Textarea keydown: Enter sends, Shift+Enter newline
- [ ] **Step 3: Implement render + append**
  - `_renderChatMessages()` to render bubbles into `#chat-messages`
  - `_sendChatMessage()`:
    - reads textarea
    - pushes `{ role: 'user', text, ts }`
    - pushes `{ role: 'assistant', text: '(UI only) Not connected yet.', ts }`
    - clears textarea, re-render, scroll to bottom

---

### Task 4: Manual verification

- [ ] **Step 1: Run dev and verify**
  - Type message → Enter sends
  - Shift+Enter newline
  - Send button works
  - No console errors

