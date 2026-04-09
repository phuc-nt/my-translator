# MyJavis Android Port — Design Spec

**Date:** 2026-04-09
**Approach:** Tauri 2 Android (single codebase, platform guards)
**Min SDK:** Android 10 (API 29)

---

## 1. Goals

Port MyJavis to Android using Tauri 2's Android target. Preserve all core features:
- Realtime speech translation via Soniox WebSocket
- Microphone + system audio capture (Android 10+)
- TTS playback: Edge TTS + Google TTS
- Conversation history
- Interview AI mode (LLM suggestions)

Not in scope for this version:
- Overlay / always-on-top window
- ElevenLabs TTS, Web Speech TTS
- MLX local pipeline (Apple Silicon only)

---

## 2. Architecture

Single repo, platform guards in Rust and JS. No monorepo split needed.

```
src-tauri/
├── src/
│   ├── audio/
│   │   ├── mod.rs              — shared: TARGET_SAMPLE_RATE, traits
│   │   ├── microphone.rs       — desktop mic (cpal) — unchanged
│   │   ├── wasapi.rs           — Windows system audio — unchanged
│   │   ├── system_audio.rs     — macOS ScreenCaptureKit — unchanged
│   │   └── android.rs          — NEW: Android mic (cpal/AAudio) + MediaProjection
│   └── commands/
│       └── audio.rs            — platform guards routing to correct impl
└── gen/android/
    └── app/src/main/
        ├── AndroidManifest.xml
        └── kotlin/.../
            ├── MediaProjectionActivity.kt   — NEW
            └── MediaProjectionService.kt    — NEW (Foreground Service)

src/
├── js/
│   ├── app.js          — add platform detection, mobile state adjustments
│   ├── ui.js           — responsive layout for mobile
│   └── settings.js     — filter TTS providers by platform
└── styles/
    ├── main.css        — unchanged
    └── mobile.css      — NEW: mobile-specific overrides
```

**Data flow is unchanged:**
`Android Audio → PCM s16le 16kHz mono → Tauri IPC → JS → Soniox WebSocket → Transcript UI`

---

## 3. Android Audio Pipeline

### 3a. Microphone
`cpal` supports Android via AAudio (API 26+). `audio/android.rs` uses cpal identically to `microphone.rs`. Gated with `#[cfg(target_os = "android")]`.

### 3b. System Audio (MediaProjection)

Three-step flow:

1. JS calls `invoke("request_media_projection")`
2. `MediaProjectionActivity.kt` shows system permission dialog → returns token to Rust via JNI callback
3. Rust receives token, creates `AudioRecord` with `AUDIO_SOURCE_REMOTE_SUBMIX` → resamples to 16kHz mono → emits PCM via Tauri event

**New files:**
- `MediaProjectionActivity.kt` — launches permission dialog, returns result via JNI
- `MediaProjectionService.kt` — Foreground Service required by Android 10+ policy; shows persistent notification while capturing
- `src-tauri/src/audio/android.rs` — JNI bindings, AudioRecord loop, resample to 16kHz s16le

### 3c. Command interface unchanged

JS continues to call `start_capture(source, channel)` and `stop_capture()` — no JS changes needed for audio commands. Platform routing is internal to Rust:

```rust
// commands/audio.rs
#[cfg(target_os = "android")]
use crate::audio::android::start_android_capture;

#[cfg(not(target_os = "android"))]
use crate::audio::microphone::start_desktop_capture;
```

---

## 4. UI/UX Adaptations

### 4a. Platform detection

```js
import { platform } from '@tauri-apps/plugin-os';
const isMobile = (await platform()) === 'android';
```

### 4b. Layout

Desktop: sidebar left + main panel.
Android: single-column, stacked layout.

```
┌─────────────────────┐
│  Header + controls  │  ← compact, 48dp touch targets
├─────────────────────┤
│                     │
│   Transcript area   │  ← full width, scrollable
│                     │
├─────────────────────┤
│  Interview AI panel │  ← collapsible bottom sheet
│  (when active)      │
└─────────────────────┘
```

- Conversation history sidebar → full-screen modal on Android
- Minimum touch target: 48×48dp
- Font size and line-height increased for readability

### 4c. Interview AI on Mobile

Current side panel → collapsible bottom sheet:
- Tap icon to open/close
- Suggestions rendered as vertical card list
- Auto-collapses when user scrolls transcript up

### 4d. Settings

TTS provider list filtered by platform: Android shows only Edge TTS + Google TTS. ElevenLabs and Web Speech entries are hidden (not removed from code — just conditionally rendered).

---

## 5. Permissions & Manifest

### AndroidManifest.xml
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="28" />
```

### Runtime permission flow
- `RECORD_AUDIO` — requested on first Start tap via Tauri permission plugin
- MediaProjection — requested via `MediaProjectionActivity` (separate Activity, not standard permission dialog)

### Foreground Service notification
Required by Android policy when capturing system audio. Notification text:
> "MyJavis — Đang phiên dịch..." [Stop button]

---

## 6. Build & CI

### Local development
```bash
# One-time setup
tauri android init

# Dev on device or emulator
tauri android dev

# Release build (APK or AAB)
tauri android build
```

### build.gradle
```gradle
minSdkVersion = 29   // Android 10
targetSdkVersion = 35
```

### GitHub Actions
Add `build-android` job in `release.yml`, parallel to `build-macos` and `build-windows`.
Requires new secret: `ANDROID_SIGNING_KEY` + `ANDROID_KEY_ALIAS` + `ANDROID_KEY_PASSWORD`.

---

## 7. What Does Not Change

| Component | Status |
|-----------|--------|
| `soniox.js` — WebSocket client | Unchanged |
| `edge-tts.js` + Rust proxy | Unchanged |
| `google-tts.js` | Unchanged |
| `commands/transcript.rs` | Unchanged |
| `settings.rs` | Unchanged |
| `commands/interview.rs` + `services/llm.rs` | Unchanged |
| Transcript file format (.md) | Unchanged |
| Soniox make-before-break reset logic | Unchanged |
