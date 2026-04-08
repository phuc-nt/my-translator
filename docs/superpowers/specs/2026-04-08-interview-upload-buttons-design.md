# Interview mode → Upload CV/JD buttons (UI-only)

## Goal
When Template mode is **Interview**, show upload controls for selecting two files:
- CV (`.pdf` / `.docx`)
- JD (`.pdf` / `.docx`)

This is **UI-only**: selecting a file should **only display the filename** in the chatbox UI; it should not upload or persist anywhere.

## Non-goals
- No upload to analytics/API.
- No file persistence across sessions or app restart.
- No parsing/reading PDF/DOCX content.

## Current context
- Chat input area is `#chat-panel` with `.chat-input-wrap` containing:
  - template dropdown (`#template-dropdown`)
  - `textarea#chat-input`
- Template dropdown items insert `Interview: ` / `Meeting: ` into `#chat-input` via `App._initTemplateDropdown()` in `src/js/app.js`.

## UX requirements
- **Visibility**: Upload controls appear **only** when Interview template is selected.
- **Controls**:
  - `Upload CV` button
  - `Upload JD` button
  - After selection, show a pill like `CV: filename.pdf` or `JD: filename.docx` with an `×` clear action.
- **Accepted files**: `.pdf` and `.docx` only (via file input accept filter; still validate extension in JS).
- **State**: Runtime-only (in-memory). Switching template away from Interview can hide controls; selected filenames can either remain stored or clear—recommended: keep stored but hidden so user can switch back without reselecting (unless requested otherwise).

## Behavior
1. User selects **Interview** template.
2. Show upload UI in the chat input shell (left side).
3. Clicking `Upload CV/JD` opens file picker.
4. After choosing a file:
   - Display the filename pill.
   - Allow clearing via `×`.

## Implementation plan (high level)
- **`src/index.html`**: add upload UI elements inside `.chat-input-wrap` near the template dropdown:
  - two `<button>` triggers
  - two hidden `<input type="file">` (accept `.pdf,.docx`)
  - pill containers for selected filenames + clear buttons
- **`src/styles/main.css`**: style buttons/pills to match the input shell.
- **`src/js/app.js`**:
  - track current template mode (Interview/Meeting)
  - toggle upload UI visibility
  - handle file input change, validate extensions, display filename
  - clear actions

## Manual test plan
- Select Interview:
  - Upload buttons appear.
  - Pick a PDF/DOCX file → filename pill shows.
  - Click `×` → pill clears.
- Select Meeting:
  - Upload UI hides.
- Select Interview again:
  - Upload UI shows again (and if we keep state, previously selected names reappear).

