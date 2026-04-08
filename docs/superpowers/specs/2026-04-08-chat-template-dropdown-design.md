# Chat template dropdown (Interview/Meeting)

## Goal
Add a compact dropdown next to the chat textbox that lets the user quickly insert a conversation “template” prefix into the chat input.

Success is when selecting an item inserts the correct prefix at the cursor, keeps focus in the textbox, and the dropdown visually matches the existing compact control styling.

## Non-goals
- No changes to transcript diarization (“Speaker …”) UI.
- No persistence across sessions (selection does not need to be saved).
- No prompt-engineering / pipeline behavior changes (this is UI-only insertion).

## Current context
- The chat input lives in `src/index.html` within `#chat-panel` → `.chat-input-row`, with the textbox `textarea#chat-input`.
- Existing compact controls (font size buttons and color dots) sit to the left of `#chat-input`, inside `.chat-controls`.

## UX requirements
- **Placement**: Inline, left of `textarea#chat-input`, alongside existing chat controls.
- **Trigger**: A pill-style button labeled **Template** with a caret.
- **Menu items**:
  - Interview
  - Meeting
- **Insertion strings (approved)**:
  - Interview inserts `Interview: ` (trailing space included)
  - Meeting inserts `Meeting: ` (trailing space included)
- **Insertion behavior**:
  - Insert at the current cursor position in `#chat-input`.
  - If text is selected, replace the selection with the inserted string.
  - After insertion, focus remains in `#chat-input` and the cursor is placed after the inserted text.
- **Open/close behavior**:
  - Click trigger toggles menu.
  - Clicking outside closes menu.
  - Pressing `Esc` closes menu.

## Accessibility / interaction notes
- Trigger should be a `<button>` for keyboard focusability.
- Menu items should be `<button>`s (or clickable elements with proper roles) and support click activation.
- Basic ARIA is recommended (e.g. `aria-expanded` on trigger) but keep implementation lightweight and consistent with the project’s current patterns.

## Styling requirements
- Visual style should align with current UI: small, compact, translucent controls on dark background.
- Pill button should have hover/active states consistent with other controls in the chat row.
- Menu should be a small popover aligned to the trigger, with subtle border and shadow.

## Implementation plan (high level)
- **`src/index.html`**: Add markup for the template trigger + menu near existing `.chat-controls` / `#chat-input`.
- **`src/js/app.js` or `src/js/ui.js`**: Add event handlers:
  - Toggle menu open/closed
  - Close on outside click / `Esc`
  - Insert text into `#chat-input` on item click using `selectionStart`/`selectionEnd`
- **`src/styles/main.css`**: Add CSS for:
  - Trigger pill button
  - Menu container
  - Menu items (hover/active)

## Edge cases
- If `#chat-input` is missing (unexpected), handlers should fail gracefully (no exceptions).
- If the menu is open and the user clicks the trigger again, it should close.
- Menu should not block typing; after selecting an item, focus should return to input immediately.

## Test plan (manual)
- Open app, locate chat input row.
- Click **Template**:
  - Menu opens; items visible.
- Select **Interview**:
  - `Interview: ` is inserted at cursor position.
  - Focus stays in `#chat-input`; typing continues after the inserted text.
- Select **Meeting**:
  - `Meeting: ` is inserted at cursor position.
- With selected text in `#chat-input`, choose an item:
  - Selection is replaced by the inserted prefix.
- Click outside when menu is open:
  - Menu closes.
- Press `Esc` when menu is open:
  - Menu closes.

