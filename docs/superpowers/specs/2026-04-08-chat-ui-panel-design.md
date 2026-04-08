## Goal

Add a **chat-like UI panel** (history + input) to the main overlay, without connecting to any AI backend yet (UI-only placeholder).

## In scope

- Add a chat panel docked **below the transcript area** in the overlay view.
- Chat panel contains:
  - **Message history** (user + assistant bubbles)
  - **Input box** (multiline)
  - **Send button**
- Interaction:
  - **Enter** sends message
  - **Shift+Enter** inserts newline
  - On send: append a user message, then append an assistant placeholder message (e.g. “(UI only) Not connected yet.”)
- State:
  - Keep chat messages **in memory** (reset when app reloads)

## Out of scope

- Any AI/model integration (OpenAI/local/etc.)
- Persisting chat history to disk
- Streaming responses
- Attachments, markdown rendering, message editing, system prompts

## UI/UX design

- **Placement**: bottom dock under transcript; transcript remains scrollable above.
- **Sizing**:
  - Chat panel has a fixed height (e.g. 180–220px) and can be refined later.
  - History area scrolls independently.
- **Visual style**: match current glass/dark theme and existing button/input styling.
- **Accessibility**:
  - Send button has `title` and `aria-label`
  - Input has placeholder text (“Type a message…”)

## Files to change (expected)

- `src/index.html`: add chat panel markup inside overlay view
- `src/styles/main.css`: add chat layout + bubble styles
- `src/js/app.js`: add minimal chat controller (state + handlers)

## Test plan

- App loads with no console errors.
- Type a message → press Enter → message appears in history + placeholder assistant response appears.
- Shift+Enter inserts newline (does not send).
- Send button sends message.
- History scroll works; transcript area remains usable.

