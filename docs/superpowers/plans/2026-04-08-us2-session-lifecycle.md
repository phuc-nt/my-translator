# US2: Session Lifecycle — New / Pause / End — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate Start/Stop (audio-only pause/resume) from End (save + reset), and add a `+ New` button that begins a new session — so users can pause and resume listening without losing their transcript.

**Architecture:** Extract a `_stopCapture()` method (audio-only) from the existing `stop()`. The Start/Stop button now calls `_stopCapture()` instead of `stop()`. A new `_endSession()` handles saving and resetting. `_createNewSession()` initialises the session state and is wired to `#btn-new-conversation`. The existing `stop()` is kept only for the window-close path and delegates to `_endSession()`. `sessionActive` flag gates visibility of `#btn-end` and guards the Start button.

**Tech Stack:** Vanilla JS (`src/js/app.js`). No framework. Tauri `invoke('save_transcript')` already exists. No Rust changes needed.

---

## File Map

| File | Change |
|---|---|
| `src/js/app.js` | Add `sessionActive` state, extract `_stopCapture()`, add `_endSession()`, `_createNewSession()`, `_updateEndButtonVisibility()`, update `btn-start` handler, wire `btn-end` and `btn-new-conversation` |

---

## Current Behaviour (for reference)

- `stop()` (line 1326): stops audio + Soniox + TTS, saves transcript, clears session, resets `sessionStartTime`
- `start()` (line 963): sets `sessionStartTime` on first call, starts Soniox + audio
- `btn-start` click (line 201): `isRunning` ? `stop()` : `start()`
- `btn-close` click (line 159): `stop()` then `appWindow.close()`

---

## Task 1: Add `sessionActive` state and `_updateEndButtonVisibility()`

**Files:**
- Modify: `src/js/app.js:35-36` (constructor)
- Modify: `src/js/app.js` (add helper method near `_updateStartButton`)

- [ ] **Step 1: Add `sessionActive` to constructor**

In the constructor, after `this.sidebarOpen = false;` (added by US1), add:

```js
this.sessionActive = false;    // true between _createNewSession() and _endSession()
```

- [ ] **Step 2: Add `_updateEndButtonVisibility()` helper method**

Place this immediately after `_updateStartButton()` (around line 1379):

```js
_updateEndButtonVisibility() {
    const btn = document.getElementById('btn-end');
    btn.style.display = this.sessionActive ? 'flex' : 'none';
}
```

- [ ] **Step 3: Verify — no visual change yet**

Run `npm run tauri dev`. App should behave exactly as before. `#btn-end` still hidden (sessionActive defaults false).

---

## Task 2: Extract `_stopCapture()` from `stop()`

**Files:**
- Modify: `src/js/app.js:1326-1369`

The current `stop()` (lines 1326–1369) does: stop audio + disconnect Soniox/local + clearProvisional + stop TTS + **save** + **clearSession** + **reset sessionStartTime**.

The new `_stopCapture()` does only the first part (audio + disconnect + provisional + TTS). No save, no clear, no reset.

- [ ] **Step 1: Add `_stopCapture()` before `stop()`**

Insert this method immediately before `async stop()` (line 1326):

```js
async _stopCapture() {
    if (!this.isRunning) return;
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

- [ ] **Step 2: Simplify `stop()` to delegate to `_stopCapture()` + save**

Replace the entire body of `async stop()` with:

```js
async stop() {
    await this._stopCapture();

    // Auto-save on stop — use full sessionLog (not trimmed display buffer)
    if (this.transcriptUI.hasSessionContent()) {
        await this._saveTranscriptFile();
        this.transcriptUI.clearSession();
    }

    // Reset session tracking
    this.sessionStartTime = null;
}
```

- [ ] **Step 3: Verify `stop()` path still works (close button)**

Run `npm run tauri dev`. Start → speak → click `✕ Close`. Transcript file should still be saved in `AppData/transcripts/`. Check with `btn-open-transcripts` folder button.

---

## Task 3: Implement `_endSession()`

**Files:**
- Modify: `src/js/app.js` — add method after `stop()`

- [ ] **Step 1: Add `_endSession()` method**

Insert after `async stop()` (after the closing `}` of stop, before `_updateStartButton`):

```js
async _endSession() {
    // Stop audio if currently running
    await this._stopCapture();

    // Save transcript if there's content
    if (this.transcriptUI.hasSessionContent()) {
        await this._saveTranscriptFile();
        this.transcriptUI.clearSession();
    }

    // Reset session state
    this.sessionStartTime = null;
    this.recordingStartTime = null;
    this.sessionActive = false;
    this._updateEndButtonVisibility();

    // Clear the transcript display
    this.transcriptUI.clear();
    this.transcriptUI.showPlaceholder();

    // Refresh sidebar conversation list
    await this._loadConversationList();
}
```

- [ ] **Step 2: Verify method is syntactically correct**

Run `npm run tauri dev`. No JS errors in console on startup.

---

## Task 4: Implement `_createNewSession()` and wire `#btn-new-conversation`

**Files:**
- Modify: `src/js/app.js` — add method + event binding

- [ ] **Step 1: Add `_createNewSession()` method**

Insert after `_endSession()`:

```js
_createNewSession() {
    this.sessionActive = true;
    this.sessionStartTime = null;   // Will be set on first start()
    this.recordingStartTime = null;
    this._updateEndButtonVisibility();

    // Clear transcript for the new session
    this.transcriptUI.clear();
    this.transcriptUI.showPlaceholder();
}
```

- [ ] **Step 2: Wire `#btn-new-conversation` in `_bindEvents()`**

In `_bindEvents()`, after the `btn-toggle-sidebar` listener (added by US1), add:

```js
// New conversation
document.getElementById('btn-new-conversation').addEventListener('click', () => {
    this._createNewSession();
});
```

- [ ] **Step 3: Verify `+ New` clears transcript and shows End button**

Run `npm run tauri dev`:
1. Click `[≡]` to open sidebar
2. Click `+ New`
3. Transcript should clear to placeholder
4. `[✕ End]` button should appear in control bar

---

## Task 5: Update `btn-start` to use `_stopCapture()` and auto-create session

**Files:**
- Modify: `src/js/app.js:201-221`

Current `btn-start` handler calls `stop()` (full stop with save). It should now:
- On Stop → call `_stopCapture()` (audio only, preserve transcript + session)
- On Start → auto-create session if none active, then `start()`

- [ ] **Step 1: Replace `btn-start` click handler**

Find the existing handler (around line 201):
```js
document.getElementById('btn-start').addEventListener('click', async () => {
    if (this.isStarting) return; // Prevent re-entry
    try {
        if (this.isRunning) {
            await this.stop();
        } else {
            this.isStarting = true;
            await this.start();
        }
    } catch (err) {
        console.error('[App] Start/Stop error:', err);
        this._showToast(`Error: ${err}`, 'error');
        this.isRunning = false;
        this._updateStartButton();
        this._updateStatus('error');
        this.transcriptUI.clear();
        this.transcriptUI.showPlaceholder();
    } finally {
        this.isStarting = false;
    }
});
```

Replace with:

```js
document.getElementById('btn-start').addEventListener('click', async () => {
    if (this.isStarting) return; // Prevent re-entry
    try {
        if (this.isRunning) {
            await this._stopCapture();
        } else {
            this.isStarting = true;
            if (!this.sessionActive) {
                this._createNewSession();
            }
            await this.start();
        }
    } catch (err) {
        console.error('[App] Start/Stop error:', err);
        this._showToast(`Error: ${err}`, 'error');
        this.isRunning = false;
        this._updateStartButton();
        this._updateStatus('error');
        this.transcriptUI.clear();
        this.transcriptUI.showPlaceholder();
    } finally {
        this.isStarting = false;
    }
});
```

- [ ] **Step 2: Verify pause/resume works**

Run `npm run tauri dev`:
1. Click `[▶]` → listening starts
2. Speak something → transcript shows
3. Click `[■]` → audio pauses, **transcript stays visible**, End button visible
4. Click `[▶]` → listening resumes, transcript accumulates
5. Click `[✕ End]` (not yet wired) — skip for now

- [ ] **Step 3: Verify auto-create session on Start from idle**

Restart app. Click `[▶]` without clicking `+ New`:
- `#btn-end` should appear automatically (session was auto-created)
- Transcript should accumulate normally

---

## Task 6: Wire `#btn-end` → `_endSession()`

**Files:**
- Modify: `src/js/app.js` `_bindEvents()`

- [ ] **Step 1: Add `btn-end` click handler in `_bindEvents()`**

After the `btn-new-conversation` listener (added in Task 4), add:

```js
// End session — save + reset
document.getElementById('btn-end').addEventListener('click', async () => {
    await this._endSession();
});
```

- [ ] **Step 2: Commit**

```bash
git add src/js/app.js
git commit -m "feat: session lifecycle — New/Pause/End (US2)"
```

- [ ] **Step 3: Full flow manual test**

Run `npm run tauri dev` and verify:
1. Open sidebar `[≡]` → click `+ New` → End button appears, transcript cleared
2. Click `[▶]` → audio starts
3. Speak → transcript accumulates
4. Click `[■]` → audio pauses, **transcript preserved**, session still active (End button visible)
5. Click `[▶]` → resumes, transcript continues
6. Click `[✕ End]` → audio stops, transcript saved, UI clears, End button hidden
7. Re-open `AppData/transcripts/` folder → new `.md` file exists
8. Restart app → `[▶]` without `+ New` → auto-creates session, End button appears

---

## Self-Review Checklist

**Spec coverage:**
- [x] `sessionActive` flag → Task 1
- [x] `_stopCapture()` — audio only, no save — → Task 2
- [x] `_endSession()` — save + reset + refresh → Task 3
- [x] `_createNewSession()` → Task 4
- [x] `#btn-new-conversation` click → `_createNewSession()` → Task 4
- [x] `btn-start` Stop → `_stopCapture()` (not `stop()`) → Task 5
- [x] `btn-start` Start from idle → auto-create session → Task 5
- [x] `#btn-end` wired → `_endSession()` → Task 6
- [x] `#btn-end` visible only when `sessionActive` → `_updateEndButtonVisibility()` Task 1 + called in `_createNewSession()`, `_endSession()`
- [x] Close button path preserved → `stop()` still saves (Task 2)
- [x] `_loadConversationList()` called in `_endSession()` → stub call (US3 implements the function; this call will be a no-op until US3 adds the method — add guard below)

**Stub guard for `_loadConversationList()`:** Since US3 hasn't been implemented yet, add a guard in `_endSession()`:

```js
// Refresh sidebar conversation list
if (typeof this._loadConversationList === 'function') {
    await this._loadConversationList();
}
```

Replace the plain call `await this._loadConversationList();` in Task 3 Step 1 with the guarded version above.

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:**
- `sessionActive` (bool) used in `_createNewSession`, `_endSession`, `_updateEndButtonVisibility`, `btn-start` handler — consistent.
- `_stopCapture()` called from `_endSession()`, `stop()`, `btn-start` — consistent.
- `_loadConversationList()` — guarded call until US3.
