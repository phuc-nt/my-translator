# Sidebar transcript → Subtitle View rendering

## Goal
When the user clicks a saved transcript in the sidebar, the main transcript area should **automatically switch to Subtitle View** and render the saved transcript in the same visual style as live subtitle mode:

- Speaker header line (e.g. **SPEAKER 1:**, yellow)
- Two stacked lines per subtitle pair:
  - `EN:` original text
  - `VI:` translated text

## Current behavior
Clicking a transcript in the sidebar triggers `App._openConversationReadOnly(filename)` which:
- sets `readOnlyMode = true`
- loads the transcript text via `invoke('read_transcript', { filename })`
- renders it as plain text using `contentEl.textContent = text`

This bypasses `TranscriptUI` rendering entirely, so it cannot match Subtitle View layout.

## Source of truth (saved transcript format)
Saved transcripts are produced by `TranscriptUI.getFullSessionText()` which emits a markdown-like format:

- YAML frontmatter header
- Repeated entries:
  - `**Speaker N:**` line (optional)
  - `> original text` line (EN)
  - `translation text` line (VI)

## Design
### UX
- **On sidebar transcript click**:
  - Enter read-only mode (existing)
  - **Auto-switch** to Subtitle View
  - Display the transcript using Subtitle View rendering (not raw text)

### Data flow
1. `App._openConversationReadOnly(filename)` loads transcript text.
2. Parse the transcript file into an array of subtitle chunks:
   - `{ speaker: string|null, en: string, vi: string|null }`
3. Clear existing live buffers and replace with parsed content in `TranscriptUI` so `TranscriptUI._renderSubtitle()` can render the correct UI.

### Parsing rules (v1)
- Ignore YAML frontmatter between `---` and the next `---` (first block only).
- Recognize speaker lines:
  - `**Speaker X:**` → set `currentSpeaker = X`
- Recognize EN line:
  - line starting with `> ` → `en = line.slice(2)`
- Recognize VI line:
  - first subsequent non-empty line that is **not** a speaker line and **not** starting with `> ` → `vi = line`
- Create a chunk whenever `en` exists; `vi` may be empty for edge cases.
- Preserve speaker across chunks until changed by a new speaker line.

### Subtitle View switch
- Call `transcriptUI.configure({ viewMode: 'subtitle' })` when opening a transcript from sidebar.

### Read-only constraints
- While in read-only mode, Start/Stop is disabled (already implemented).
- End Session buttons should be hidden (already controlled by `readOnlyMode`).

## Implementation notes
### Files to change
- Modify: `src/js/app.js`
  - Update `_openConversationReadOnly()` to parse and render via `TranscriptUI`
  - Add a small parser helper (local function or App method)
- Modify: `src/js/ui.js`
  - Add a `loadSegments(segments, { replaceSessionLog?: boolean })` method (or similar) to safely set internal buffers and call `_render()`
  - Ensure it works for Subtitle View rendering

### Why not markdown renderer?
Subtitle View is already implemented in `TranscriptUI._renderSubtitle()` and matches the desired layout; parsing into segments keeps rendering consistent and avoids CSS/markdown edge cases.

## Edge cases
- Files that contain no recognizable chunks should show a friendly “No transcript content” message.
- If a chunk has EN but missing VI, render `VI: …` or leave blank (prefer blank in read-only).
- Speaker may be missing for some chunks; treat as no speaker header.

## Manual test plan
- Save a transcript session that contains:
  - Multiple speakers
  - Multiple EN/VI pairs
- Click it in sidebar:
  - UI switches to Subtitle View automatically
  - Speaker headers and EN/VI prefix lines match live view styling
- Verify:
  - Start/Stop disabled in read-only
  - End session buttons hidden in read-only
  - Switching back to a new session restores normal behavior

