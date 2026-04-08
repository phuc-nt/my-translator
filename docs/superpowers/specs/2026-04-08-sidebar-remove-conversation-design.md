## Goal

Add a **red “×” remove button** on each sidebar conversation list item (visible on hover) that **deletes** the saved transcript from disk.

## In scope

- Sidebar list items (`#conversation-list .conversation-item`) show a small remove button on hover.
- Clicking the item still opens the conversation in read-only mode.
- Clicking the remove button:
  - does **not** trigger item open/selection
  - asks for confirmation
  - deletes the transcript file via a Tauri command
  - refreshes the conversation list
  - if the deleted conversation is currently open in read-only, exit read-only and return to a new/empty session view (safe state).

## Out of scope

- “Undo” for deletes.
- Bulk delete.
- Trash/recycle bin integration.
- Renaming conversations.

## UX / UI design

- **Visibility**: remove button is hidden by default; becomes visible on `.conversation-item:hover`.
- **Placement**: right-aligned within the row, after the label.
- **Style**: small square button, red tint on hover, matches existing settings “remove row” patterns.
- **Accessibility**:
  - `title="Delete conversation"`
  - `aria-label="Delete conversation"`
  - keep keyboard navigation unchanged (optional follow-up: add `tabindex` and key handlers).

## Data flow / implementation sketch

- UI builds each `<li>` as:
  - `<span class="conversation-label">…</span>`
  - `<button class="btn-remove-conversation">×</button>`
- Remove button handler calls `invoke('delete_transcript', { filename })`.
- Rust side adds `delete_transcript(filename)` command:
  - validates filename is a simple transcript filename (no path traversal)
  - resolves it inside the transcripts directory
  - deletes the file
  - returns `Ok(())` or a descriptive error.

## Error handling

- If delete fails: show toast with the error string, keep list unchanged.
- If the file is already missing: treat as success and refresh list.

## Test plan

- Create 2+ conversations (so list has items).
- Hover an item: confirm “×” appears and does not shift layout badly.
- Click item label: opens read-only as before.
- Click “×” then cancel: nothing deleted.
- Click “×” then confirm: item disappears after refresh; file no longer exists.
- If the open read-only conversation is deleted: app exits read-only mode and shows placeholder/new session state.

