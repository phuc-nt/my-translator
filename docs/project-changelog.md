# Changelog

All notable changes to My Translator are documented here.
Each release section is extracted automatically by `.github/workflows/release.yml` and published as the GitHub Release body.

Format: `## v<version> - <YYYY-MM-DD>` followed by content until the next `## v` heading.

---

## v0.7.3 - 2026-06-08

### Changes

- **60db.ai TTS provider added** as a 4th option alongside Edge TTS, Google Chirp 3 HD, and ElevenLabs. WebSocket streaming for low-latency real-time playback. Specializes in Indic languages: Hindi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Marathi, Punjabi, and English.
- **Dynamic voice fetching** — 60db.ai voices (default + user custom/cloned) are fetched from the API and grouped by language in the voice dropdown. Voices load automatically when an API key is entered.
- **Speed, stability, and similarity controls** for fine-tuning 60db.ai voice output (0.5x–2.0x speed, 0–100 stability/similarity).

### Technical

- `src/js/sixtydb-tts.js` (new): WebSocket streaming TTS client. Connect → `create_context` → `send_text` + `flush_context` per synthesis. Context reuse across multiple `speak()` calls. Auto-reconnect (3 attempts, 2s/4s/6s backoff). TTFB instrumentation. Static methods `fetchVoices(apiKey)` and `fetchDefaultVoices()` for dynamic voice population.
- `src-tauri/src/settings.rs`: 5 new fields (`sixtydb_api_key`, `sixtydb_voice_id`, `sixtydb_speed`, `sixtydb_stability`, `sixtydb_similarity`). `#[serde(default)]` handles migration for existing users.
- `src/js/app.js`: 12 insertion points wiring 60db into TTS provider routing — imports, callback loops, key validation, `_getActiveTTS`, `_configureTTS`, `_updateTTSProviderUI`, `_populateSettingsForm`, `_saveSettingsFromForm`, `stop`, `start`, and new `_fetchAndPopulateSixtydbVoices` method.
- `src/index.html`: Provider dropdown option `🇮🇳 60db.ai`, settings panel with API key input, dynamic voice select, speed/stability/similarity sliders.

---

## v0.7.2 - 2026-05-26

### Changes

- **Qwen engine migrated from Omni Plus to LiveTranslate Flash** (`qwen3-livetranslate-flash-realtime`). Server-side VAD replaces the prior RMS-based client VAD; text-only modality; 60+ supported languages via an explicit picker (mirrors mobile v0.4.3). Free preview tier on DashScope international (Singapore region only).
- **Settings reorganized per engine** (mobile parity): only the active engine's API key section is shown. Soniox-only features (Custom Context, Strict language detection, Endpoint delay) hide when engine ≠ Soniox. TTS tab hides when engine is cloud-realtime (OpenAI/Qwen). Engine hints collapsed into a single dynamic line.
- **Qwen single-panel transcript**: Live Flash returns translation only (no source ASR channel), so the dual-panel view is force-collapsed to single when Qwen is active — no more empty source pane with grey provisional noise.
- **Source picker hides "Auto-detect" on Qwen**: Live Flash stalls when source language is "auto" on real mic input. Source language now defaults to English and snaps to a real entry when switching to Qwen.
- **Two-way mode disabled on Qwen** (already disabled on OpenAI). Cloud realtime engines are one-way only.

### Documentation

- Installation guides (macOS + Windows, EN + VI) updated with 3 new engine-specific Settings screenshots (`setting_soniox.png`, `setting_openai.png`, `setting_qwen.png`). EN macOS guide gained the previously VI-only Qwen setup section.

### Technical

- `src-tauri/src/commands/qwen_realtime.rs` rewritten 486 → 264 LOC. URL switched to `qwen3-livetranslate-flash-realtime`. RMS-VAD state, `commit_turn`, `rms_int16` all removed. New session payload requests `modalities=["text"]`, sets `input_audio_transcription.language` + `translation.language`, and disables turn-detection (server handles it). `response.text.text` snapshots emit as provisional; `response.text.done` emits final with dedupe on `response_id`.
- `src/js/qwen-realtime-client.js` rewritten 148 → 90 LOC. Provisional buffer is full snapshot assignment (Live Flash sends `text + stash` every tick, not deltas). `connect({ apiKey, sourceLanguage, targetLanguage })` — output queue and source provisional callback dropped.
- `src/js/qwen-langs.js` (new): 60-entry language list shared shape with mobile's `QWEN_LANGS`. No "auto" option.
- `_updateModeUI` in `src/js/app.js`: per-engine visibility for key sections, Soniox-only blocks, and the TTS tab (with active-tab fallback to Translation).
- `TranscriptUI.provider` converted to getter/setter so changing provider live-strips the `.dual-view` CSS class. `_render()` forces `_renderSingle` when provider='qwen'. `_renderSingle` treats Qwen provisional as a target stream (`seg-translated` class) instead of dim italic.
- Removed `qwen_audio_output` from settings (struct, defaults, JS DEFAULT_SETTINGS). `#[serde(default)]` at struct level handles existing settings.json without migration.

### Caveats

- DashScope keys must be created in **Singapore region**; other regions hit a different endpoint and fail with `WebSocket error` on Start.
- Existing Qwen-Omni users will need to switch source-language picker off "Auto" and may need to re-confirm target language (the auto-snap defaults to Vietnamese if their previous code isn't in the 60-language list).

---

## v0.7.1 - 2026-05-25

### Changes

- **OpenAI Realtime now supports System Audio and Both** alongside Microphone. Server-side turn detection handles non-mic sources fine in practice; the prior mic-only lock has been removed.
- **Voice output (TTS) disabled by default on OpenAI and Qwen Realtime engines** to prevent the speaker → microphone feedback loop on shared devices (especially noticeable when capturing System Audio). Toolbar audio toggle removed for cloud-realtime engines — they now run text-only, matching the mobile app behaviour. Soniox/Local engines retain custom TTS as before.

### Technical

- `openai_audio_output` and `qwen_audio_output` defaults flipped from `true` → `false` in `src-tauri/src/settings.rs`. Both clients always request text-only modality at connect time.
- `_updateModeUI` no longer hides/disables source buttons for OpenAI mode.
- Helper `_toggleOpenAiAudio` and the `#btn-openai-audio` toolbar element removed.

---

## v0.7.0 - 2026-05-24

### New Features

- **Qwen-Omni Realtime translation provider**: added Alibaba DashScope `qwen3.5-omni-plus-realtime` as a fourth engine. Free preview tier, streams translated text + voice, supports the full Soniox language list (not capped at 13 like OpenAI).
- **Engine picker**: third card on the onboarding screen + 🌏 Qwen pill in the toolbar for quick switching.
- **System audio + Both source modes for Qwen**: unlike OpenAI Realtime (mic-only), Qwen runs with system audio capture because turn-taking is client-side RMS-VAD rather than server-side speaker detection.

### Bug Fixes

- **Duplicate tail line on final segment**: `provisionalText` was not cleared after `addTranslation`, leaving a stale copy of the just-finalized text rendered as a pending "..." row beneath it. Affected OpenAI Realtime too; both engines now clear provisional on every `onSegment`.

### Technical

- New Rust module `src-tauri/src/commands/qwen_realtime.rs` (~400 lines): WebSocket bridge to DashScope international endpoint, client-side RMS-VAD turn control (threshold 500 int16, 400ms silence, 2-7s window), single-flight `response_in_flight` guard to avoid `response.create` races, dedup on `last_done_response_id` for `response.text.done` vs `response.audio_transcript.done` collisions.
- New JS module `src/js/qwen-realtime-client.js` mirrors `openai-realtime-client.js` callback shape so app.js wiring stays symmetric.
- Hardened session instructions enforce pronoun consistency and full-translate guarantee (Qwen sometimes returned partial translations without the instruction prefix).
- Settings: added `qwen_api_key`, `qwen_audio_output` (default true).
- Source/target source-final queue (`_pendingSourceFinals`) pairs ASR finals with translation finals when their cadences diverge.

### Caveats

- DashScope international keys must be created at https://bailian.console.alibabacloud.com (Singapore region). China-Mainland keys hit a different endpoint.
- Audio modality requires audio_output=true; muting at the toolbar sends `modalities=["text"]` so DashScope skips audio generation entirely (saves billable seconds).

---

## v0.6.0 - 2026-05-13

### New Features

- **OpenAI Realtime translation provider**: added `gpt-realtime-translate` (May 2026 GA) as a third translation engine alongside Soniox and Local MLX. The model streams translated text **and** translated speech audio over a single WebSocket — no separate TTS step required, and lower end-to-end latency than text-only providers.
- **13 output languages supported**: en, es, pt, fr, de, it, ru, hi, id, vi, ja, ko, zh.
- **Signed + notarized macOS DMG**: builds are now signed with Developer ID and notarized through Apple's notary service — installs without the `xattr` workaround on first launch.

### Bug Fixes

- **Dual-panel routing**: in dual view, the OpenAI source transcript now reliably lands in the left (source) column and the translation in the right column. Previous heuristic-based routing dropped the translation into the source column when whisper transcription lagged behind translation output.
- **Source/target final pairing**: whisper transcription and translation streams finalize at different cadences. A queue now pairs each source final with its matching translation final so the saved transcript stays aligned.

### Caveats

- **Cost**: ~$0.07/min (~$4/hr) — about 34× Soniox at provider list rates (measured on a 5-min Japanese→Vietnamese test against the GA endpoint). Charged to your own OpenAI account; a cost warning is shown in Settings.
- **Two-way mode** and the **custom TTS provider toggle** are unavailable while OpenAI Realtime is selected (audio comes natively from the model).
- **Thai** is not in the supported output set; Thai users should stay on Soniox or Local MLX.
- **Source transcript may pause** during long speaker pauses (e.g. applause breaks) — translation keeps working but the source column can stall. Under investigation.

### Technical

- Added a `rubato`-based 16k → 24k polyphase upsampler in the Rust audio pipeline so the existing 16kHz capture path can feed the model's 24kHz s16le input requirement.
- New Tauri commands: `openai_realtime_start`, `openai_realtime_send_audio`, `openai_realtime_stop` — the WebSocket lives in Rust because browsers can't set the `Authorization` header on WebSocket handshakes.
- New JS modules `openai-realtime-client.js` (mirrors the Soniox client callback shape) and `openai-audio-output-queue.js` (Web Audio API streaming player for the 24kHz output stream).
- Explicit `provider` flag on transcript UI replaces the previous heuristic detection, fixing the dual-panel routing regression.
- Added `scripts/build-notarized.sh` for local notarized builds (reads `APPLE_*` env vars from a gitignored `.env`).

---

## v0.5.3 - 2026-04-10

### Bug Fixes

- **Windows**: Fix app crashing a few seconds after pressing Play. The Application Loopback (ALAC) path introduced in v0.5.2 had an incorrect stream setup that caused an access violation during capture. Reverted to the v0.5.1 legacy WASAPI loopback path, which is known to be stable.

### Known Limitation (reintroduced)

- Windows system audio capture will include the app's own TTS output. In one-way mode, use headphones to avoid feedback. Two-way mode already disables TTS, so no change there. Self-exclusion will be revisited once it can be properly tested on a real Windows machine.

---

## v0.5.2 - 2026-04-09

### New Features

#### Session History Viewer
- New **Sessions** view to browse all saved translation sessions
- Click any session to view full transcript, copy to clipboard
- Access via the clock icon in the overlay toolbar

#### Improved Auto-save
- Sessions now **auto-save on stop** — no manual action needed
- Full session log is preserved (never trimmed like the display buffer)
- Transcripts include metadata: date, time, source/target languages, mode

### Bug Fixes

- **Google TTS**: Clearer error message when API is blocked — tells users to enable "Cloud Text-to-Speech API" in Google Cloud Console
- **Windows**: Fixed WASAPI compile errors for new audio capture implementation

### Technical

- Refactored Windows WASAPI audio capture (ALAC + legacy loopback support)
- Added `list_transcripts` and `read_transcript` Rust commands

---

## v0.5.1 - 2026-03-26

### New Features

- **Two-way translation**: translate conversations between two languages simultaneously — ideal for bilingual meetings (Zoom, Google Meet, MS Teams)
- **Audio source "Both"** (System + Mic): capture both your voice and remote participants for two-way mode
- **Endpoint delay slider**: tune STT latency for faster or more accurate transcription
- **Soniox enhancements**: keepalive, rich context, language ID, confidence scores
- **Strict language restriction** for more reliable target language output

### Notes

- TTS narration is automatically disabled in two-way mode to prevent audio feedback loops

---

## v0.5.0 - 2026-03-21

### New Features

- **All Soniox languages** supported (70+ source languages)
- **Auto-update**: built-in updater, check & install from Settings → About
- **TTS narration**: 3 providers — Edge TTS (free), Google Chirp 3 HD, ElevenLabs
- **About tab**: version info, update controls, links
- **Update UX redesign**: clearer progress, error handling

### Bug Fixes

- Multiple stability fixes across auto-updater, relaunch, and TTS pipeline

---

## v0.4.5 - 2026-03-18

### New Features

- **Google TTS Chirp 3 HD**: near-human quality neural voices
- **Dual Panel view**: source and translation side-by-side, independent scroll
