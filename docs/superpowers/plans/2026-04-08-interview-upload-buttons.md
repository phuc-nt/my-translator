# Interview Upload Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Template mode is **Interview**, show `Upload CV` and `Upload JD` controls in the chat input shell; selecting a `.pdf/.docx` shows a filename pill with a clear (`×`) action. UI-only; no upload/persist.

**Architecture:** Add upload UI elements inside `.chat-input-wrap` in `src/index.html`. Add minimal CSS for buttons/pills in `src/styles/main.css`. Wire behavior in `src/js/app.js` by tracking current template and toggling visibility; use hidden file inputs for OS picker; validate extensions; update DOM state.

**Tech Stack:** Vanilla HTML/CSS/JS.

---

## File structure (changes)
- Modify: `E:\Projects\assistant\src\index.html`
- Modify: `E:\Projects\assistant\src\styles\main.css`
- Modify: `E:\Projects\assistant\src\js\app.js`

---

### Task 1: Add upload markup to chat input shell

**Files:**
- Modify: `E:\Projects\assistant\src\index.html`

- [ ] **Step 1: Add container inside `.chat-input-wrap`**

Add a block (initially hidden) before the textarea:

```html
<div id="interview-uploads" class="interview-uploads" style="display:none">
  <button type="button" class="upload-btn" id="btn-upload-cv">Upload CV</button>
  <button type="button" class="upload-btn" id="btn-upload-jd">Upload JD</button>

  <input id="file-upload-cv" type="file" accept=".pdf,.docx" style="display:none" />
  <input id="file-upload-jd" type="file" accept=".pdf,.docx" style="display:none" />

  <div class="upload-pill" id="pill-cv" style="display:none">
    <span class="upload-pill-label" id="pill-cv-label">CV:</span>
    <span class="upload-pill-name" id="pill-cv-name"></span>
    <button type="button" class="upload-pill-clear" id="pill-cv-clear" aria-label="Clear CV">×</button>
  </div>

  <div class="upload-pill" id="pill-jd" style="display:none">
    <span class="upload-pill-label" id="pill-jd-label">JD:</span>
    <span class="upload-pill-name" id="pill-jd-name"></span>
    <button type="button" class="upload-pill-clear" id="pill-jd-clear" aria-label="Clear JD">×</button>
  </div>
</div>
```

- [ ] **Step 2: Save and ensure layout doesn’t break**

---

### Task 2: Style buttons/pills to match input shell

**Files:**
- Modify: `E:\Projects\assistant\src\styles\main.css`

- [ ] **Step 1: Add CSS for `.interview-uploads`**

```css
.interview-uploads {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.interview-uploads .upload-btn {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(0,0,0,0.22);
  color: rgba(255,255,255,0.9);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.interview-uploads .upload-btn:hover {
  background: rgba(0,0,0,0.30);
}
.upload-pill {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.9);
  font-size: 12px;
  max-width: 220px;
}
.upload-pill-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}
.upload-pill-clear {
  border: 0;
  background: transparent;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.upload-pill-clear:hover { color: rgba(255,255,255,0.95); }
```

---

### Task 3: Wire template mode + file selection logic

**Files:**
- Modify: `E:\Projects\assistant\src\js\app.js`

- [ ] **Step 1: Track current template**
  - Add `this.currentTemplate = null` and keep it updated inside `_initTemplateDropdown()` when a template item is selected.

- [ ] **Step 2: Add initializer `_initInterviewUploads()`**
  - Bind click handlers:
    - `btn-upload-cv` → trigger `file-upload-cv.click()`
    - `btn-upload-jd` → trigger `file-upload-jd.click()`
  - Bind change handlers to set pill name if file extension is `.pdf/.docx`, otherwise show toast error.
  - Bind clear buttons to reset input + hide pill.

- [ ] **Step 3: Toggle visibility**
  - Add `_setTemplateMode(mode)` that:
    - shows `#interview-uploads` when mode === `'Interview'`
    - hides otherwise

---

### Task 4: Manual test
- [ ] Select Interview → upload UI appears
- [ ] Pick PDF/DOCX for CV/JD → pill shows filename
- [ ] Clear → pill disappears
- [ ] Select Meeting → upload UI hides

