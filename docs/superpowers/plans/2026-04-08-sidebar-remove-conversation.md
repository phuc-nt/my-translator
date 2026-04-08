# Sidebar Remove Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a red hover “×” button to sidebar conversation items that deletes the saved transcript file.

**Architecture:** Frontend renders each conversation list item as label + remove button; remove button calls a new Tauri command `delete_transcript` which deletes the transcript file inside the transcripts directory with path traversal protection.

**Tech Stack:** Tauri (Rust commands), vanilla JS frontend (`src/js/app.js`), CSS (`src/styles/main.css`).

---

### Task 1: Add delete transcript backend command

**Files:**
- Modify: `src-tauri/src/commands/transcript.rs`
- Modify: `src-tauri/src/commands/mod.rs` (if needed for module export)
- Modify: `src-tauri/src/lib.rs` (add command to invoke handler)

- [ ] **Step 1: Locate transcript directory resolver used by existing transcript commands**
- [ ] **Step 2: Implement `#[tauri::command] fn delete_transcript(filename: String) -> Result<(), String>`**
  - Validate `filename`:
    - must not contain `/` or `\\`
    - must not contain `..`
    - optionally require `.md` suffix
  - Resolve full path within the transcripts directory and delete the file
  - If file missing: return `Ok(())`
- [ ] **Step 3: Register the command in `tauri::generate_handler![]`**
- [ ] **Step 4: Build Rust side**

Run:
```bash
cd "E:\Projects\assistant\src-tauri" ; cargo build
```
Expected: succeeds.

---

### Task 2: Add remove button to sidebar list items (JS)

**Files:**
- Modify: `src/js/app.js`

- [ ] **Step 1: Update `_loadConversationList()` to render label + remove button**
  - Replace `li.textContent = ...` with:
    - a `span.conversation-label` (keeps ellipsis)
    - a `button.btn-remove-conversation` with text `×`
  - Keep `li.dataset.filename = s.filename`
  - Keep existing click on `li` to open read-only
- [ ] **Step 2: Wire remove button click**
  - `e.stopPropagation()`
  - `if (!confirm(...)) return;`
  - `await invoke('delete_transcript', { filename })`
  - `await this._loadConversationList()`
  - If the deleted one is currently active in read-only:
    - call `this._createNewSession()` (safe reset) and close sidebar optional

---

### Task 3: Add hover-only red “×” button styles (CSS)

**Files:**
- Modify: `src/styles/main.css`

- [ ] **Step 1: Make `.conversation-item` support right-aligned button**
  - Ensure it remains `display:flex`
  - Label uses `flex: 1; min-width: 0;` for ellipsis
- [ ] **Step 2: Add `.btn-remove-conversation`**
  - hidden by default: `opacity:0; pointer-events:none;`
  - visible on hover: `.conversation-item:hover .btn-remove-conversation { opacity:1; pointer-events:auto; }`
  - red hover background + red text

---

### Task 4: Manual verification

- [ ] **Step 1: Run the app and verify UI behavior**

Run:
```bash
cd "E:\Projects\assistant\src-tauri" ; cargo run
```

- [ ] **Step 2: Verify delete works**
  - Create 2+ transcripts so list has items
  - Hover item: × appears
  - Click item: opens read-only
  - Click ×: confirm, transcript disappears from list, file removed

