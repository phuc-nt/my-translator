Implemented Meeting mode suggestions (F1+F2+F3).

## Files changed
- `src/js/app.js` — ungated suggestions for Meeting, wired `appMode` to backend, Meeting `suggestion_kind` labels, renamed `_scheduleInterviewSuggestions` → `_scheduleSuggestions`, mode-aware empty state/title, clear panel on mode switch
- `src/index.html` — suggestions title id + empty-state placeholder element
- `src/styles/main.css` — empty-state + suggestion kind label styles
- `src/styles/mobile.css` — FAB visibility for both Interview and Meeting (`suggestions-active`)

## Acceptance criteria
- **AC-F1:** `_isSuggestionsMode()` shows/docks the suggestions panel in Meeting; speaker-final handler + brainstorm button enabled in both modes
- **AC-F2:** `_runInterviewSuggestions` passes `appMode` from Rust-persisted settings (`settingsManager.get().app_mode`); speaker-final → brainstorm → `_scheduleSuggestions` fires in Meeting
- **AC-F3:** Meeting chips render type labels (Talking Point / Clarifying Question / Action Item) via `_prependSuggestionKindLabel`; Interview chips unchanged (no label for `answer`)
- **AC-F4:** `#interview-uploads` remains gated to Interview only in `_setTemplateMode`
- **AC-F5:** `_clearSuggestionsPanel()` runs when switching Interview ↔ Meeting
- **AC-F6:** `_applySettings` still calls `_setTemplateMode(savedMode)` on load so panel state follows persisted `app_mode`
- **AC-F7:** Interview-only paths preserved: chat input, CV/JD ingest, `save_interview_message`, interview settings keys

## Manual verification
Code review + `node --check src/js/app.js`. Recommended manual pass: set Mode=Meeting in Settings, confirm suggestions rail appears (CV/JD hidden), switch Interview↔Meeting and confirm chips clear + placeholder text updates, trigger brainstorm on a final transcript line and confirm Meeting chips show kind labels with valid LLM config.

No Rust/backend files changed.
