# Chat Template Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact “Template” dropdown next to the chat textbox that inserts `Interview: ` or `Meeting: ` at the cursor in `#chat-input`.

**Architecture:** Add a small dropdown UI in `src/index.html`, style it in `src/styles/main.css`, and wire events in `src/js/app.js` to toggle the menu and insert text using `selectionStart`/`selectionEnd`.

**Tech Stack:** Vanilla HTML/CSS/JS (Tauri webview UI), existing app scripts and styles.

---

## File structure (changes)
- Modify: `E:\Projects\assistant\src\index.html` (add dropdown markup near `#chat-input`)
- Modify: `E:\Projects\assistant\src\styles\main.css` (pill + menu styles)
- Modify: `E:\Projects\assistant\src\js\app.js` (event handlers + insertion helper)

---

### Task 1: Add dropdown markup beside chat input

**Files:**
- Modify: `E:\Projects\assistant\src\index.html`

- [ ] **Step 1: Locate chat input row**
  - Find `#chat-panel` → `.chat-input-row` containing `textarea#chat-input`.

- [ ] **Step 2: Add dropdown trigger + menu markup**

Add a compact structure like:

```html
<div class="template-dropdown" id="template-dropdown">
  <button type="button" class="template-trigger" id="btn-template" aria-haspopup="menu" aria-expanded="false">
    <span class="template-trigger-label">Template</span>
    <span class="template-caret">▾</span>
  </button>
  <div class="template-menu" id="menu-template" role="menu" aria-hidden="true">
    <button type="button" class="template-item" role="menuitem" data-insert="Interview: ">Interview</button>
    <button type="button" class="template-item" role="menuitem" data-insert="Meeting: ">Meeting</button>
  </div>
</div>
```

Placement: inside the existing `.chat-controls` area (left of `#chat-input`) so it matches the current compact controls row.

- [ ] **Step 3: Save and verify layout**
  - Run the app and confirm the trigger appears next to existing chat controls and does not push the textbox off-screen.

---

### Task 2: Style the pill dropdown and popover menu

**Files:**
- Modify: `E:\Projects\assistant\src\styles\main.css`

- [ ] **Step 1: Add base styles for dropdown container**
  - Ensure `.template-dropdown` is `position: relative; display: inline-flex;` and aligns with other controls.

- [ ] **Step 2: Add trigger pill styling**

Add styles roughly consistent with existing compact controls:

```css
.template-trigger {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}
.template-trigger:hover { background: rgba(0, 0, 0, 0.55); }
.template-trigger[aria-expanded="true"] { border-color: rgba(255, 255, 255, 0.18); }
```

- [ ] **Step 3: Add popover menu styling**

```css
.template-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  min-width: 160px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(10, 12, 18, 0.96);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  display: none;
  z-index: 50;
}
.template-menu.open { display: block; }
.template-item {
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.90);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.template-item:hover { background: rgba(255, 255, 255, 0.08); }
```

- [ ] **Step 4: Visual check**
  - Confirm it looks compact and consistent with existing UI controls (font controls, color dots).

---

### Task 3: Wire dropdown behavior and text insertion

**Files:**
- Modify: `E:\Projects\assistant\src\js\app.js`

- [ ] **Step 1: Find the existing chat input wiring**
  - Locate where `#chat-input` is read and where Enter triggers sending the message.

- [ ] **Step 2: Add a small initializer for the template dropdown**

Implement:
- Toggle menu on trigger click
- Close on outside click
- Close on `Esc`
- Insert `data-insert` string at cursor using `selectionStart`/`selectionEnd`

Suggested insertion helper:

```js
function insertIntoTextarea(textarea, insertText) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + insertText + after;
  const nextPos = start + insertText.length;
  textarea.focus();
  textarea.setSelectionRange(nextPos, nextPos);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
```

- [ ] **Step 3: Implement menu open/close states**
  - Add/remove `.open` on menu and keep `aria-expanded` / `aria-hidden` in sync.

- [ ] **Step 4: Manual behavior checks**
  - Insert at cursor position
  - Replace selection
  - Focus returns to `#chat-input`
  - Outside click closes
  - `Esc` closes

---

### Task 4: Manual test pass (dev)

**Files:**
- No code changes required

- [ ] **Step 1: Run the app**
  - Run: `npm run tauri dev`

- [ ] **Step 2: Verify all required behaviors**
  - Open Template menu and insert Interview/Meeting
  - Verify insertion strings exactly: `Interview: ` and `Meeting: `
  - Verify close behaviors: outside click + `Esc`
  - Verify no regressions: chat input Enter/Shift+Enter works as before

---

### Task 5: Optional polish (only if needed)

**Files:**
- Modify: `E:\Projects\assistant\src\styles\main.css`
- Modify: `E:\Projects\assistant\src\js\app.js`

- [ ] **Step 1: Add keyboard navigation (optional)**
  - If desired: Arrow keys move between items; Enter selects.

- [ ] **Step 2: Add subtle animation (optional)**
  - Small fade/scale transition for menu open.

