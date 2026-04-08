## Goal

Remove the **Clear transcript** control and **Compact mode** feature entirely.

## In scope

- Remove UI buttons:
  - `#btn-clear` (Clear transcript)
  - `#btn-compact` (Compact mode)
- Remove JS behavior:
  - Event listeners and any state/methods for compact mode
  - Keyboard shortcut for compact mode (Ctrl/Cmd + D)
- Remove CSS related to compact mode visuals/hover-reveal title bar.

## Out of scope

- Internal transcript clearing/reset flows (e.g., when starting/stopping sessions) remain unchanged.
- Other controls remain unchanged.

## UX / behavior

- Users can no longer manually clear the transcript from the toolbar.
- App no longer supports compact mode; control bar always uses the normal layout.

## Test plan

- App loads with no console errors.
- No Clear button, no Compact button.
- Ctrl/Cmd + D no longer toggles anything.
- Existing session flows (start/stop/end) still work.

