# Sidebar Transcript → Subtitle View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When clicking a saved transcript in the sidebar, automatically switch to Subtitle View and render it like live subtitles (Speaker headers + EN/VI pairs), instead of raw text.

**Architecture:** Reuse existing `TranscriptUI` subtitle renderer. On sidebar open, parse the saved transcript markdown into segment objects and load them into `TranscriptUI`, then force `viewMode: 'subtitle'`.

**Tech Stack:** Vanilla JS + existing `TranscriptUI` (`src/js/ui.js`) + Tauri `invoke('read_transcript')`.

---

## File structure (changes)
- Modify: `E:\Projects\assistant\src\js\app.js` (parse + open transcript via `TranscriptUI`)
- Modify: `E:\Projects\assistant\src\js\ui.js` (add `loadSegments` helper to safely replace buffers and render)

---

### Task 1: Add `TranscriptUI.loadSegments()` helper

**Files:**
- Modify: `E:\Projects\assistant\src\js\ui.js`

- [ ] **Step 1: Add a method to replace internal buffers**

Add a method on `TranscriptUI`:

```js
loadSegments(segments, { replaceSessionLog = true } = {}) {
  this._removeListening();
  this._ensureContent();
  this.segments = Array.isArray(segments) ? segments : [];
  if (replaceSessionLog) this.sessionLog = this.segments.map(s => ({ ...s }));
  this.provisionalText = '';
  this.provisionalSpeaker = null;
  this.provisionalLanguage = null;
  this.currentSpeaker = null;
  this.currentLanguage = null;
  this.lastConfidence = null;
  this._render();
}
```

- [ ] **Step 2: Quick sanity**
  - Ensure it doesn’t throw when `segments` is empty.

---

### Task 2: Parse saved transcript markdown into segments

**Files:**
- Modify: `E:\Projects\assistant\src\js\app.js`

- [ ] **Step 1: Implement a small parser helper**

Add an App method (or local helper) that:
- Strips first YAML frontmatter block (`--- ... ---`)
- Parses lines into segment objects compatible with `TranscriptUI`:

```js
{
  original: "EN text",
  translation: "VI text",
  status: "translated",
  speaker: "1" | "ME" | null,
  language: null,
  confidence: null,
  createdAt: <number>
}
```

Rules:
- Speaker line: `**Speaker X:**` sets current speaker (store `X`)
- EN line: `> ...` is `original`
- VI line: next non-empty non-speaker non-`>` line is `translation`

- [ ] **Step 2: Add graceful fallback**
  - If no segments found, show placeholder message in transcript area.

---

### Task 3: Update `_openConversationReadOnly()` to render Subtitle View

**Files:**
- Modify: `E:\Projects\assistant\src\js\app.js`

- [ ] **Step 1: Force subtitle mode on open**
  - Call `this.transcriptUI.configure({ viewMode: 'subtitle' })`.

- [ ] **Step 2: Replace `textContent = text`**
  - Parse the file → `segments`
  - `this.transcriptUI.clear()` (optional) then `this.transcriptUI.loadSegments(segments, { replaceSessionLog: false })`

- [ ] **Step 3: Verify read-only constraints still hold**
  - `readOnlyMode` stays true and controls update remains correct.

---

### Task 4: Manual test

- [ ] **Step 1: Save a transcript**
  - Record a short session with at least 2 speakers.
  - Stop/End session to create a saved transcript file.

- [ ] **Step 2: Click it in sidebar**
  - Expect: switches to Subtitle View automatically
  - Expect: speaker header + EN/VI prefix lines like live subtitle UI

