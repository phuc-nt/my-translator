# Interview mode → BOT hint message

## Goal
When the user selects Template **Interview** in the chat-template dropdown, the app should inject a one-time hint message into the subtitle timeline:

- Label: `BOT` (yellow, same visual prominence as speaker label tone)
- Text: `You should upload your CV and JD to analytics`

## Non-goals
- No API calls or analytics integration (this is UI-only guidance).
- No persistence across app restarts (hint is per runtime session unless later requested).
- No changes to Soniox connection or audio capture behavior.

## Current context
- Template dropdown is implemented in `src/index.html` and wired in `App._initTemplateDropdown()` in `src/js/app.js`.
- Subtitle timeline chat bubbles are rendered via `TranscriptUI._renderSubtitle()`:
  - Chat segments use `status: 'chat'`
  - Current rendering hardcodes chat bubble as `.subtitle-chat me` and shows `${speaker}:`

## Requirements
### Trigger
- The hint should display **only the first time** the user selects **Interview**.
- After it has been shown once, it should **not show again**, even if the user switches to another template and switches back to Interview.

### Message
- Insert a subtitle chat-like item with:
  - speaker label = `BOT`
  - message text = `You should upload your CV and JD to analytics`

### Visual
- `BOT` label should be **yellow** (same as speaker yellow tone used elsewhere).
- BOT message should align **left** (not like “ME” aligned right).

## Design
### State
Add an App-level flag, e.g. `this._interviewBotHintShown = false`, initialized in the constructor (or as a property set in `init()`).

### Behavior flow
In `App._initTemplateDropdown()`:
- On clicking the `Interview` menu item:
  - Perform normal insertion into `#chat-input` (`Interview: `)
  - If `!this._interviewBotHintShown`:
    - Call `this.transcriptUI.addChatMessage('You should upload your CV and JD to analytics', 'BOT')`
    - Set `this._interviewBotHintShown = true`

### Rendering changes
Update `TranscriptUI._renderSubtitle()` chat bubble rendering:
- Use a class based on speaker:
  - `me` when `speaker === 'ME'`
  - `bot` when `speaker === 'BOT'`
  - default: no extra class
- Update CSS:
  - `.subtitle-chat.bot .subtitle-chat-who` → yellow
  - `.subtitle-chat.bot` alignment left (default)

## Edge cases
- If `transcriptUI` is not ready or missing, fail gracefully (no exception).
- If user selects Interview while in read-only mode, do nothing (optional guard) to avoid polluting historical view.

## Manual test plan
- Start app, ensure subtitle view is active.
- Select **Interview**:
  - `Interview: ` inserted into chat input
  - A BOT message appears once in the subtitle timeline with yellow `BOT:`
- Switch to Meeting, then back to Interview:
  - No additional BOT hint appears
- Restart app:
  - Selecting Interview shows hint again (expected, runtime-only state)

