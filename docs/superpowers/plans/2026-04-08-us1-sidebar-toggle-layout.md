# US1: Sidebar Toggle & Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable sidebar that slides in/out alongside the transcript area, containing a `+ New` button and a conversation list, without disrupting the existing control bar or transcript display.

**Architecture:** Wrap `#transcript-container` and a new `#sidebar` inside a `#content-area` flex-row container. Toggle sidebar visibility via a `.hidden` class (width: 0). Wire `#btn-toggle-sidebar` in the control bar to flip the class in app.js.

**Tech Stack:** Vanilla JS, HTML, CSS (no external libraries). Tauri 2 desktop overlay — no test runner available; verify by running `npm run tauri dev`.

---

## File Map

| File | Change |
|---|---|
| `src/index.html` | Add `#btn-toggle-sidebar`, `#sidebar`, `#btn-end`, wrap `#transcript-container` in `#content-area` |
| `src/styles/main.css` | Add `#content-area`, `.sidebar`, `.sidebar.hidden`, `.conversation-item`, `#btn-end` styles |
| `src/js/app.js` | Add `sidebarOpen` state, wire `#btn-toggle-sidebar` click, bind `#btn-end` visibility logic |

---

## Task 1: Add `#content-area` wrapper and `#sidebar` to HTML

**Files:**
- Modify: `src/index.html:141-154`

Current structure (lines 140–154):
```html
<!-- Transcript Area -->
<div id="transcript-container" data-tauri-drag-region>
  <div id="transcript-content" data-tauri-drag-region>
    ...
  </div>
</div>
```

- [ ] **Step 1: Replace transcript area with wrapped content area**

Replace the `<!-- Transcript Area -->` block with:

```html
<!-- Content Area: sidebar + transcript side by side -->
<div id="content-area">
  <div id="sidebar" class="sidebar hidden">
    <button id="btn-new-conversation">+ New</button>
    <ul id="conversation-list"></ul>
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

- [ ] **Step 2: Verify HTML structure is correct**

Open `src/index.html`. Confirm:
- `#content-area` is a direct child of `#overlay-view`, between `#drag-region` and `.floating-controls`
- `#sidebar` and `#transcript-container` are both direct children of `#content-area`
- `#transcript-content` and its placeholder are intact inside `#transcript-container`

---

## Task 2: Add `[≡]` toggle button and `[✕ End]` button to control bar

**Files:**
- Modify: `src/index.html:19-137`

- [ ] **Step 1: Add `#btn-toggle-sidebar` as first button in control bar**

In the `.control-bar` div (line 19), add this as the FIRST child (before `#btn-settings`):

```html
<button id="btn-toggle-sidebar" class="icon-btn" title="Toggle sidebar (conversations)">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
</button>
```

- [ ] **Step 2: Add `#btn-end` to control bar before `#btn-close`**

In the `.control-bar` div, add immediately before `#btn-close` (line 131):

```html
<button id="btn-end" class="icon-btn" title="End session — save & close" style="display:none">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
</button>
```

Note: `#btn-end` uses an × icon (same as close) but with the `icon-btn` class and `style="display:none"` by default. It is NOT `close-btn` — no red hover.

- [ ] **Step 3: Verify control bar order in browser**

Run `npm run tauri dev` and confirm button order left-to-right:
`[≡] [⚙] ● Ready  [SYS][MIC][BOTH]  [▶] [TTS]  [clear][copy][folder][clock]  [compact][pin][minimize][✕end][✕close]`

`#btn-end` should be invisible (hidden) at this point.

---

## Task 3: Add CSS for `#content-area` and `.sidebar`

**Files:**
- Modify: `src/styles/main.css` — add after the `#transcript-container` block (~line 414)

- [ ] **Step 1: Add `#content-area` flex-row styles**

Find the comment `/* ─── Transcript Container ─────────────────────────────── */` (around line 407) and add BEFORE the `#transcript-container` rule:

```css
/* ─── Content Area (sidebar + transcript row) ──────────── */
#content-area {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
```

- [ ] **Step 2: Update `#transcript-container` to fill remaining space**

The existing `#transcript-container` rule currently has `flex: 1`. That is still correct — it will fill the remaining width after the sidebar. Confirm the existing rule looks like:

```css
#transcript-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 16px;
}
```

No change needed if it already has `flex: 1`.

- [ ] **Step 3: Add `.sidebar` styles**

Add after the `#content-area` block:

```css
/* ─── Sidebar ───────────────────────────────────────────── */
.sidebar {
  width: 180px;
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: rgba(15, 15, 22, 0.6);
  border-right: 1px solid var(--border-subtle);
  transition: width var(--transition-normal), opacity var(--transition-normal);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px;
}

.sidebar.hidden {
  width: 0;
  padding: 0;
  opacity: 0;
  border-right: none;
  overflow: hidden;
}

#btn-new-conversation {
  width: 100%;
  padding: 7px 10px;
  background: rgba(99, 140, 255, 0.12);
  border: 1px solid rgba(99, 140, 255, 0.25);
  border-radius: var(--radius-sm);
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

#btn-new-conversation:hover {
  background: rgba(99, 140, 255, 0.2);
  border-color: var(--accent);
}

#conversation-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
}

.conversation-item {
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  gap: 6px;
}

.conversation-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.conversation-item.active {
  background: var(--bg-active);
  color: var(--text-primary);
}
```

- [ ] **Step 4: Verify sidebar renders correctly**

Run `npm run tauri dev`. Click the `[≡]` button (not yet wired, but check CSS renders). Open DevTools (right-click → Inspect) and manually toggle the `hidden` class on `#sidebar`:
- With `hidden`: sidebar should be invisible, transcript fills full width
- Without `hidden`: sidebar (~180px) should appear on left, transcript pushed right
- Transition should be smooth

---

## Task 4: Wire sidebar toggle in `app.js`

**Files:**
- Modify: `src/js/app.js`

- [ ] **Step 1: Add `sidebarOpen` state variable to constructor**

In the `constructor()` (after `this.isCompact = false;`, around line 35), add:

```js
this.sidebarOpen = false;
```

- [ ] **Step 2: Add `_toggleSidebar()` method**

Add this method to the `App` class (place it near other UI toggle methods like compact mode, around the `_toggleCompactMode` method if it exists, otherwise at the end before the closing `}`):

```js
_toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('hidden', !this.sidebarOpen);
}
```

- [ ] **Step 3: Wire `#btn-toggle-sidebar` in `_bindEvents()`**

In `_bindEvents()` (after the `btn-settings` listener, around line 118), add:

```js
document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    this._toggleSidebar();
});
```

- [ ] **Step 4: Manually test toggle**

Run `npm run tauri dev`. Click `[≡]`:
- First click: sidebar slides in from left, transcript narrows
- Second click: sidebar collapses, transcript expands back
- Sidebar state is NOT persisted (always starts closed on launch) ✓

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/styles/main.css src/js/app.js
git commit -m "feat: add conversation sidebar toggle (US1 — layout only)"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `[≡]` toggle button at left of control bar → Task 2 Step 1
- [x] Sidebar hidden by default → `.sidebar.hidden` class default in HTML + `sidebarOpen = false`
- [x] Sidebar pushes transcript right (flex-row, not overlay) → Task 3
- [x] Sidebar width ~180px → `.sidebar { width: 180px }`
- [x] Smooth transition → `transition: width var(--transition-normal)`
- [x] `+ New` button at top of sidebar → Task 1 Step 1
- [x] `#conversation-list` → Task 1 Step 1
- [x] `.conversation-item` hover + active states → Task 3 Step 3
- [x] `#btn-end` hidden by default → Task 2 Step 2 (`style="display:none"`)
- [x] `#btn-end` same style as icon buttons → uses `.icon-btn` class

**Placeholder scan:** No TBDs or TODOs found — all steps have exact code.

**Type consistency:** `sidebarOpen` used consistently in `_toggleSidebar()` and constructor. `sidebar.classList.toggle('hidden', !this.sidebarOpen)` correctly maps boolean to class presence.

**Out of scope for this plan** (handled in US2/US3):
- `#btn-new-conversation` click handler (US2)
- `#btn-end` click handler (US2)
- Conversation list population (US3)
- Read-only mode (US3)
