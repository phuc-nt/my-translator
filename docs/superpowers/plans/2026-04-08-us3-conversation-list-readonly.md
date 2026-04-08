# US3: Conversation List & Read-Only View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the sidebar with saved transcripts on app init, allow clicking a past conversation to view it read-only in the transcript area, and disable capture controls while in read-only mode.

**Architecture:** `_loadConversationList()` calls the existing `list_transcripts` Tauri command and renders `<li class="conversation-item">` items. Clicking an item calls `_openConversationReadOnly(filename)` which loads the content via `read_transcript` and sets `this.readOnlyMode = true`. A `_updateControlsForMode()` helper disables Start and hides End while read-only. The existing sessions-view (separate full-screen panel) is unchanged — this is an inline sidebar feature.

**Tech Stack:** Vanilla JS (`src/js/app.js`). Tauri `invoke('list_transcripts')` and `invoke('read_transcript', { filename })` already exist and work.

---

## File Map

| File | Change |
|---|---|
| `src/js/app.js` | Add `readOnlyMode` state, `_loadConversationList()`, `_openConversationReadOnly()`, `_updateControlsForMode()`, call init on app start |

---

## Context: Existing APIs

`invoke('list_transcripts')` returns:
```js
[{ filename: "2026-03-27_10-21-05.md", path: "...", created_at: "2026-03-27 10:21:05", size_bytes: 1234 }, ...]
// sorted newest first
```

`invoke('read_transcript', { filename })` returns the raw `.md` string content.

`_parseSessionMeta(session)` already exists (line 1664) — returns `{ date, time }` from `session.created_at`.

---

## Task 1: Add `readOnlyMode` state and `_updateControlsForMode()`

**Files:**
- Modify: `src/js/app.js` — constructor + new method near `_updateEndButtonVisibility`

- [ ] **Step 1: Add `readOnlyMode` to constructor**

After `this.sessionActive = false;` (in constructor), add:

```js
this.readOnlyMode = false;     // true when viewing a past conversation
```

- [ ] **Step 2: Add `_updateControlsForMode()` after `_updateEndButtonVisibility()`**

```js
_updateControlsForMode() {
    const btnStart = document.getElementById('btn-start');
    if (this.readOnlyMode) {
        btnStart.disabled = true;
        btnStart.style.opacity = '0.35';
        btnStart.style.pointerEvents = 'none';
    } else {
        btnStart.disabled = false;
        btnStart.style.opacity = '';
        btnStart.style.pointerEvents = '';
    }
    // #btn-end: in read-only mode always hide it regardless of sessionActive
    const btnEnd = document.getElementById('btn-end');
    btnEnd.style.display = (this.sessionActive && !this.readOnlyMode) ? 'flex' : 'none';
}
```

- [ ] **Step 3: Update `_updateEndButtonVisibility()` to delegate**

Replace the existing `_updateEndButtonVisibility()` body:

```js
_updateEndButtonVisibility() {
    this._updateControlsForMode();
}
```

This ensures End button visibility always goes through the unified mode check.

- [ ] **Step 4: Verify — no visual change**

Run `npm run tauri dev`. App behaves exactly as before.

---

## Task 2: Implement `_loadConversationList()`

**Files:**
- Modify: `src/js/app.js` — add method in the `// ─── Session History` section (near line 1602)

- [ ] **Step 1: Add `_loadConversationList()` method**

Insert after the `_showSessions()` / `_openSession()` block (around line 1663), before `_parseSessionMeta`:

```js
async _loadConversationList() {
    const listEl = document.getElementById('conversation-list');
    if (!listEl) return;

    try {
        const sessions = await invoke('list_transcripts');
        listEl.innerHTML = '';

        sessions.forEach(s => {
            const meta = this._parseSessionMeta(s);
            const li = document.createElement('li');
            li.className = 'conversation-item';
            li.dataset.filename = s.filename;
            li.textContent = `🗨 ${meta.date} ${meta.time}`;
            li.addEventListener('click', () => {
                this._openConversationReadOnly(s.filename);
            });
            listEl.appendChild(li);
        });
    } catch (err) {
        console.error('[Sidebar] Failed to load conversations:', err);
    }
}
```

- [ ] **Step 2: Call `_loadConversationList()` in `init()`**

In `init()`, add after `this._checkForUpdates();` (around line 84):

```js
// Load sidebar conversation list
this._loadConversationList();
```

- [ ] **Step 3: Verify sidebar populates on launch**

Run `npm run tauri dev`:
1. Click `[≡]` to open sidebar
2. If there are saved transcripts: items should appear as `🗨 YYYY-MM-DD HH:MM`
3. If no transcripts: list is empty (no error)

---

## Task 3: Implement `_openConversationReadOnly(filename)`

**Files:**
- Modify: `src/js/app.js` — add method after `_loadConversationList()`

- [ ] **Step 1: Add `_openConversationReadOnly()` method**

```js
async _openConversationReadOnly(filename) {
    // Mark read-only mode
    this.readOnlyMode = true;
    this._updateControlsForMode();

    // Highlight active item in sidebar
    document.querySelectorAll('#conversation-list .conversation-item').forEach(el => {
        el.classList.toggle('active', el.dataset.filename === filename);
    });

    // Load and display transcript content
    const contentEl = document.getElementById('transcript-content');
    if (contentEl) contentEl.textContent = 'Loading...';

    try {
        const text = await invoke('read_transcript', { filename });
        if (contentEl) {
            contentEl.textContent = text;
        }
    } catch (err) {
        if (contentEl) contentEl.textContent = `Error loading: ${err}`;
    }
}
```

- [ ] **Step 2: Verify clicking a past conversation shows it**

Run `npm run tauri dev`:
1. Open sidebar `[≡]`
2. Click a conversation item
3. Transcript area shows the raw `.md` content
4. `[▶ Start]` is greyed out / disabled
5. `[✕ End]` is hidden

---

## Task 4: Exit read-only mode on `_createNewSession()`

**Files:**
- Modify: `src/js/app.js` — `_createNewSession()` method

When the user clicks `+ New`, they exit read-only mode and start a fresh session.

- [ ] **Step 1: Update `_createNewSession()` to clear read-only mode**

Find `_createNewSession()` and add `readOnlyMode` reset at the top:

```js
_createNewSession() {
    this.readOnlyMode = false;
    this.sessionActive = true;
    this.sessionStartTime = null;
    this.recordingStartTime = null;
    this._updateControlsForMode();

    this.transcriptUI.clear();
    this.transcriptUI.showPlaceholder();

    // Deselect all sidebar items
    document.querySelectorAll('#conversation-list .conversation-item').forEach(el => {
        el.classList.remove('active');
    });
}
```

Note: `_updateEndButtonVisibility()` call is replaced by `_updateControlsForMode()` which handles both Start and End buttons.

- [ ] **Step 2: Also clear read-only in `_endSession()`**

Find `_endSession()` and add `this.readOnlyMode = false;` alongside the other resets:

```js
async _endSession() {
    await this._stopCapture();

    if (this.transcriptUI.hasSessionContent()) {
        await this._saveTranscriptFile();
        this.transcriptUI.clearSession();
    }

    this.sessionStartTime = null;
    this.recordingStartTime = null;
    this.sessionActive = false;
    this.readOnlyMode = false;
    this._updateControlsForMode();

    this.transcriptUI.clear();
    this.transcriptUI.showPlaceholder();

    if (typeof this._loadConversationList === 'function') {
        await this._loadConversationList();
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/js/app.js
git commit -m "feat: sidebar conversation list + read-only view (US3)"
```

- [ ] **Step 4: Full integration test**

Run `npm run tauri dev` and verify:

1. **Sidebar populates:** Launch → open `[≡]` → past conversations listed as `🗨 YYYY-MM-DD HH:MM`
2. **Read-only view:** Click a past conversation → transcript shows content → Start disabled → End hidden
3. **Exit read-only:** Click `+ New` → Start re-enabled → End button appears → transcript cleared
4. **Full session flow:** `+ New` → `[▶]` → speak → `[■]` → `[▶]` → `[✕ End]` → new item appears at top of sidebar
5. **Auto-session on Start:** Restart → click `[▶]` directly → End button appears (session auto-created)

---

## Self-Review Checklist

**Spec coverage:**
- [x] `list_transcripts` on app init → Task 2 Step 2
- [x] Sidebar items show `🗨 YYYY-MM-DD HH:MM` → Task 2 Step 1
- [x] Sorted newest first → Rust command already returns newest first
- [x] Clicking item loads content (read-only) → Task 3
- [x] Active item highlighted → Task 3 Step 1 (`classList.toggle('active', ...)`)
- [x] Start disabled in read-only → `_updateControlsForMode()` Task 1
- [x] End hidden in read-only → `_updateControlsForMode()` Task 1
- [x] Exit read-only on `+ New` → Task 4 Step 1
- [x] Exit read-only on `_endSession()` → Task 4 Step 2
- [x] Sidebar refreshes after End → `_loadConversationList()` in `_endSession()` (guard already in US2)

**Placeholder scan:** None found. All code is complete.

**Type consistency:**
- `readOnlyMode` (bool) — consistent across constructor, `_openConversationReadOnly`, `_createNewSession`, `_endSession`, `_updateControlsForMode`
- `_updateControlsForMode()` replaces `_updateEndButtonVisibility()` as the unified control state updater — `_updateEndButtonVisibility()` now delegates to it, so any existing callers still work
- `_loadConversationList()` — matches the guarded call in `_endSession()` from US2

**One note:** `_createNewSession()` originally called `this._updateEndButtonVisibility()`. The updated version in Task 4 calls `this._updateControlsForMode()` directly instead. This is consistent since `_updateEndButtonVisibility()` delegates to `_updateControlsForMode()` anyway — both work.
