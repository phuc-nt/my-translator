# Conversation Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable conversation sidebar to the overlay, with session lifecycle (New / Start-Stop / End) separated from the existing audio-capture start/stop.

**Architecture:** HTML gains a `#main-area` flex-row wrapper containing `#sidebar` and `#transcript-container`. JS splits the current `stop()` into `_stopCapture()` (pause audio only) and `endSession()` (save + reset). A new `sessionActive` flag controls End-button visibility and read-only mode when viewing saved sessions.

**Tech Stack:** Vanilla JS, HTML, CSS (no new dependencies). Existing Tauri commands `list_transcripts`, `read_transcript`, `save_transcript` — no Rust changes needed.

---

## File Map

| File | Change |
|---|---|
| `src/index.html` | Add `#btn-toggle-sidebar`, `#sidebar` panel, `#btn-end`, wrap transcript in `#main-area` |
| `src/styles/main.css` | Sidebar layout, conversation item styles, end-button style |
| `src/js/app.js` | New state vars, `_stopCapture()`, `endSession()`, `_newConversation()`, `_toggleSidebar()`, `_loadConversationList()`, `_openConversation()`, `_updateEndButton()`, event wiring, init changes |

---

## Task 1: HTML — Add sidebar structure and new buttons

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Add sidebar toggle button to control bar**

In `src/index.html`, add `#btn-toggle-sidebar` as the FIRST button inside `.control-bar` (before `#btn-settings`):

```html
<button id="btn-toggle-sidebar" class="icon-btn" title="Toggle conversations">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
</button>
```

- [ ] **Step 2: Add End Session button to control bar**

Add `#btn-end` immediately after `#btn-tts` (before `.toolbar-group`):

```html
<button id="btn-end" class="end-session-btn" title="End session and save" style="display:none">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
  <span class="btn-label">END</span>
</button>
```

- [ ] **Step 3: Wrap transcript-container in main-area and add sidebar**

Replace the existing `<div id="transcript-container" ...>` with:

```html
<!-- Main Area: sidebar + transcript side by side -->
<div id="main-area">
  <div id="sidebar" class="sidebar hidden">
    <div class="sidebar-header">
      <button id="btn-new-conversation" class="sidebar-new-btn" title="New conversation">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New
      </button>
    </div>
    <div id="conversation-list" class="conversation-list"></div>
  </div>

  <div id="transcript-container" data-tauri-drag-region>
    <div id="transcript-content" data-tauri-drag-region>
      <div class="transcript-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
          opacity="0.4">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        <p>Press ▶ to start translating</p>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Verify HTML structure**

Open `src/index.html` and confirm:
- `#btn-toggle-sidebar` is first button in `.control-bar`
- `#btn-end` appears after `#btn-tts`
- `#main-area` wraps both `#sidebar` and `#transcript-container`
- `.floating-controls` and `#resize-handle` remain OUTSIDE `#main-area` (still direct children of `#overlay-view`)

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat: add sidebar HTML structure and session end button"
```

---

## Task 2: CSS — Sidebar layout and new button styles

**Files:**
- Modify: `src/styles/main.css`

- [ ] **Step 1: Make #overlay-view a flex column (it already is via .view — add main-area flex row)**

Add after the `#transcript-container` styles section in `main.css`:

```css
/* ─── Main Area (sidebar + transcript row) ──────────────── */
#main-area {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
```

Also ensure `#transcript-container` fills remaining width. Find the existing `#transcript-container` rule and add `flex: 1; min-width: 0;` if not present:

```css
#transcript-container {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  position: relative;
}
```

- [ ] **Step 2: Add sidebar styles**

Add after the `#main-area` rule:

```css
/* ─── Sidebar ───────────────────────────────────────────── */
.sidebar {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width var(--transition-normal);
  background: rgba(12, 12, 18, 0.6);
}

.sidebar.hidden {
  width: 0;
  border-right: none;
}

.sidebar-header {
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.sidebar-new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.sidebar-new-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--accent);
}

.conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.conversation-item {
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 11px;
  transition: all var(--transition-fast);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-app-region: no-drag;
}

.conversation-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.conversation-item.active {
  background: var(--bg-active);
  color: var(--text-primary);
}

.conversation-empty {
  padding: 16px 8px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
}

/* Read-only transcript view */
.transcript-readonly {
  padding: 12px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}
```

- [ ] **Step 3: Add End Session button style**

Add after the `.tts-action-btn` styles:

```css
/* End Session Button */
.end-session-btn {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 1px;
  min-width: 32px;
  height: 32px;
  padding: 0 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--error);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
  opacity: 0.7;
}

.end-session-btn:hover {
  background: rgba(248, 113, 113, 0.15);
  opacity: 1;
}

.end-session-btn:active {
  transform: scale(0.92);
}
```

- [ ] **Step 4: Verify layout visually**

Run `npm run tauri dev`. Open the app and confirm:
- Control bar still renders correctly (all buttons in one row)
- Main transcript area still fills available space

- [ ] **Step 5: Commit**

```bash
git add src/styles/main.css
git commit -m "feat: add sidebar and end-session button CSS"
```

---

## Task 3: JS — Session state, _stopCapture, and endSession

**Files:**
- Modify: `src/js/app.js`

- [ ] **Step 1: Add new state variables to constructor**

In the `App` constructor (around line 19), add after `this.isCompact = false;`:

```js
this.sessionActive = false;       // true while a conversation is open and not yet ended
this.currentConversationId = null; // ISO timestamp string, set on new conversation
this.sidebarOpen = false;          // sidebar toggle state
this.viewingConversation = false;  // true when viewing a saved (read-only) conversation
```

- [ ] **Step 2: Add _stopCapture() method**

Add a new `_stopCapture()` method after the `_setSource()` section (around line 928). This is the audio-only pause — extracted from the current `stop()`:

```js
async _stopCapture() {
    this.isRunning = false;
    this._updateStartButton();

    try {
        await invoke('stop_capture');
    } catch (err) {
        console.error('Failed to stop audio capture:', err);
    }

    if (this.translationMode === 'local') {
        try {
            await invoke('stop_local_pipeline');
        } catch (err) {
            console.error('Failed to stop local pipeline:', err);
        }
        this.localPipelineReady = false;
        this.transcriptUI.removeStatusMessage();
        this._updateStatus('disconnected');
    } else {
        sonioxClient.disconnect();
    }

    this.transcriptUI.clearProvisional();
    elevenLabsTTS.disconnect();
    edgeTTSRust.disconnect();
    audioPlayer.stop();
}
```

- [ ] **Step 3: Replace stop() with endSession()**

Find the current `async stop()` method (around line 1320) and rename it to `async endSession()`. Then modify the body — remove the auto-save block and replace with the full end-session logic:

```js
async endSession() {
    if (!this.sessionActive && !this.isRunning) return;

    if (this.isRunning) {
        await this._stopCapture();
    }

    // Save transcript
    if (this.transcriptUI.hasSessionContent()) {
        await this._saveTranscriptFile();
        this.transcriptUI.clearSession();
    }

    // Reset session state
    this.sessionStartTime = null;
    this.recordingStartTime = null;
    this.sessionActive = false;
    this.currentConversationId = null;
    this.viewingConversation = false;

    // Reset UI
    this.transcriptUI.clear();
    this.transcriptUI.showPlaceholder();
    document.getElementById('btn-start').disabled = false;
    this._updateEndButton();

    // Refresh sidebar list
    await this._loadConversationList();
}
```

- [ ] **Step 4: Add _newConversation() method**

Add immediately after `endSession()`:

```js
_newConversation() {
    // If currently running, stop capture first (sync-safe: called before start)
    this.sessionActive = true;
    this.currentConversationId = new Date().toISOString();
    this.recordingStartTime = null;
    this.sessionStartTime = null;
    this.viewingConversation = false;
    this.transcriptUI.clear();
    this.transcriptUI.showPlaceholder();
    document.getElementById('btn-start').disabled = false;
    document.querySelectorAll('#conversation-list .conversation-item')
        .forEach(el => el.classList.remove('active'));
    this._updateEndButton();
}
```

- [ ] **Step 5: Add _updateEndButton() method**

Add after `_updateStartButton()` (around line 1365):

```js
_updateEndButton() {
    const btn = document.getElementById('btn-end');
    if (btn) btn.style.display = this.sessionActive ? '' : 'none';
}
```

- [ ] **Step 6: Update all callers of stop()**

Find and update each reference to `this.stop()` / `this.stop().then(...)` in `app.js`:

- **btn-start click handler** (around line 199) — change `await this.stop()` → `await this._stopCapture()`:
  ```js
  if (this.isRunning) {
      await this._stopCapture();
  }
  ```

- **Keyboard shortcut** (around line 439) — change `await this.stop()` → `await this._stopCapture()`:
  ```js
  if (this.isRunning) {
      await this._stopCapture();
  }
  ```

- **btn-close handler** (around line 153) — change `await this.stop()` → `await this.endSession()`:
  ```js
  await this.endSession();
  await this.appWindow.close();
  ```

- **`_setSource()`** (around line 917) — change `this.stop().then(...)` → `this._stopCapture().then(...)`:
  ```js
  if (wasRunning) {
      this._stopCapture().then(() => {
          this.currentSource = source;
          this._updateSourceButtons();
          this._showToast(`Switched to ${label}`, 'success');
          this.start();
      });
  }
  ```

- **`_startSonioxMode` error handler** (around line 1056) — change `await this.stop()` → `await this.endSession()`:
  ```js
  } catch (err) {
      console.error('Failed to start audio capture:', err);
      this._showToast(`Audio error: ${err}`, 'error');
      await this.endSession();
  }
  ```

- [ ] **Step 7: Update start() to auto-create session if none active**

In `start()` method (around line 957), add at the very beginning after `const settings = settingsManager.get();`:

```js
// Auto-create a session if none is active
if (!this.sessionActive) {
    this._newConversation();
}
```

- [ ] **Step 8: Manual test — session lifecycle**

Run `npm run tauri dev`. Verify:
1. App starts, no End button visible
2. Press ▶ Start → audio starts, End button appears (auto-created session)
3. Press ■ Stop → audio stops, transcript stays, End button still visible
4. Press ▶ Start → audio resumes same transcript
5. Press End → transcript saved, End button hides, placeholder shown

- [ ] **Step 9: Commit**

```bash
git add src/js/app.js
git commit -m "feat: split stop() into _stopCapture() and endSession(), add session state"
```

---

## Task 4: JS — Sidebar rendering and conversation loading

**Files:**
- Modify: `src/js/app.js`

- [ ] **Step 1: Add _loadConversationList() method**

Add after `endSession()`:

```js
async _loadConversationList() {
    const listEl = document.getElementById('conversation-list');
    if (!listEl) return;
    try {
        const sessions = await invoke('list_transcripts');
        if (sessions.length === 0) {
            listEl.innerHTML = '<div class="conversation-empty">No saved sessions</div>';
            return;
        }
        listEl.innerHTML = sessions.map(s => {
            const parts = (s.created_at || '').split(' ');
            const date = parts[0] || s.filename.replace('.md', '');
            const time = parts[1] ? parts[1].slice(0, 5) : '';
            const label = `${date} ${time}`.trim();
            return `<div class="conversation-item" data-filename="${this._escAttr(s.filename)}" title="${this._escAttr(label)}">${label}</div>`;
        }).join('');
        listEl.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', () => this._openConversation(item.dataset.filename, item));
        });
    } catch (err) {
        listEl.innerHTML = '<div class="conversation-empty">Error loading</div>';
    }
}
```

- [ ] **Step 2: Add _openConversation() method**

Add after `_loadConversationList()`:

```js
async _openConversation(filename, itemEl) {
    if (this.isRunning) {
        this._showToast('Stop recording before viewing saved sessions', 'info');
        return;
    }

    // Highlight selected item
    document.querySelectorAll('#conversation-list .conversation-item')
        .forEach(el => el.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');

    // Enter read-only mode
    this.viewingConversation = true;
    this.sessionActive = false;
    this._updateEndButton();
    document.getElementById('btn-start').disabled = true;

    // Show loading state
    const contentEl = document.getElementById('transcript-content');
    contentEl.innerHTML = '<div class="transcript-readonly">Loading...</div>';

    try {
        const text = await invoke('read_transcript', { filename });
        contentEl.innerHTML = `<div class="transcript-readonly">${this._escHtml(text)}</div>`;
    } catch (err) {
        contentEl.innerHTML = `<div class="transcript-readonly">Error: ${this._escHtml(String(err))}</div>`;
        this._showToast('Failed to load session: ' + err, 'error');
    }
}

_escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
```

- [ ] **Step 3: Add _toggleSidebar() method**

Add after `_openConversation()`:

```js
_toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('btn-toggle-sidebar');
    sidebar.classList.toggle('hidden', !this.sidebarOpen);
    btn.classList.toggle('active', this.sidebarOpen);
    if (this.sidebarOpen) {
        this._loadConversationList();
    }
}
```

- [ ] **Step 4: Manual test — sidebar list**

Run `npm run tauri dev`. Verify:
1. Click `≡` toggle → sidebar slides open showing list of sessions
2. Click a session → transcript content area shows that session's text
3. Start button is disabled while viewing session
4. Click `≡` again → sidebar closes

- [ ] **Step 5: Commit**

```bash
git add src/js/app.js
git commit -m "feat: add sidebar conversation list, open/view saved session"
```

---

## Task 5: JS — Wire events and init

**Files:**
- Modify: `src/js/app.js`

- [ ] **Step 1: Wire btn-toggle-sidebar in _bindEvents()**

In `_bindEvents()`, add after the sessions button handler (around line 125):

```js
document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    this._toggleSidebar();
});
```

- [ ] **Step 2: Wire btn-new-conversation in _bindEvents()**

Add after the sidebar toggle handler:

```js
document.getElementById('btn-new-conversation').addEventListener('click', () => {
    if (this.isRunning) {
        this._showToast('Stop recording before starting a new session', 'info');
        return;
    }
    this._newConversation();
});
```

- [ ] **Step 3: Wire btn-end in _bindEvents()**

Add after btn-new-conversation handler:

```js
document.getElementById('btn-end').addEventListener('click', async () => {
    await this.endSession();
});
```

- [ ] **Step 4: Initialize End button visibility in init()**

In `init()`, after `this._applySettings(settingsManager.get())` (around line 50), add:

```js
this._updateEndButton();
```

- [ ] **Step 5: Manual test — full flow end to end**

Run `npm run tauri dev`. Test full user flow:
1. Click `≡` → sidebar opens (empty or with old sessions)
2. Click `+ New` in sidebar → new conversation created, transcript clears
3. Click ▶ → recording starts, End button visible
4. Speak some words → transcript appears
5. Click ■ → recording pauses, transcript stays
6. Click ▶ again → recording resumes, transcript continues
7. Click End → file saved, sidebar refreshes showing new entry, transcript clears
8. Click new entry in sidebar → read-only view of saved transcript
9. Click `+ New` → exits read-only, ▶ enabled again
10. Switching source (SYS/MIC/BOTH) during recording → does NOT end session

- [ ] **Step 6: Commit**

```bash
git add src/js/app.js
git commit -m "feat: wire sidebar events and init, complete conversation sidebar feature"
```

---

## Summary of Changes

| Area | What changed |
|---|---|
| `index.html` | Added `#btn-toggle-sidebar`, `#btn-end`, `#sidebar` panel, `#main-area` wrapper |
| `main.css` | Sidebar width-transition layout, conversation item styles, end-button style, read-only transcript style |
| `app.js` (state) | `sessionActive`, `currentConversationId`, `sidebarOpen`, `viewingConversation` |
| `app.js` (methods) | `_stopCapture()`, `endSession()`, `_newConversation()`, `_updateEndButton()`, `_loadConversationList()`, `_openConversation()`, `_toggleSidebar()`, `_escHtml()` |
| `app.js` (callers) | btn-start → `_stopCapture()`, close → `endSession()`, `_setSource` → `_stopCapture()`, `start()` auto-creates session |
