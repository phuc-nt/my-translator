## Goal

Remove the **Sessions** feature (separate Sessions view) because users can browse and open saved sessions via the sidebar conversation list.

## In scope

- Remove the **Sessions button** from the control bar.
- Remove the **Sessions view markup** (`#sessions-view`) and its navigation elements.
- Remove JS handlers and view toggling for Sessions.
- Remove Sessions-specific CSS.

## Out of scope

- Removing transcript persistence (saving files) — keep as-is.
- Removing sidebar conversation list — keep as-is.

## UX / behavior

- There is no longer a dedicated Sessions screen.
- “Saved sessions” are accessed only through the sidebar list.

## Test plan

- App loads without console errors.
- Control bar no longer shows the Sessions icon.
- Sidebar conversation list still loads and opens a transcript read-only.
- Settings view still works (open/close).

