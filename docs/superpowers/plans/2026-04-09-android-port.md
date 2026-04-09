# MyJavis Android Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port MyJavis to Android (API 29+) using Tauri 2's Android target, adding mic + system audio capture, mobile layout, and Interview AI mode optimized for small screens.

**Architecture:** Single repo with platform guards — `#[cfg(target_os = "android")]` in Rust and `isMobile` flag in JS. Android audio capture lives in `audio/android.rs`; Kotlin bridge (`MediaProjectionActivity.kt` + `MediaProjectionService.kt`) handles system audio via MediaProjection API. JS frontend gets a `mobile.css` layer and platform-aware TTS filtering.

**Tech Stack:** Tauri 2 Android, Rust (cpal for mic, jni crate for MediaProjection bridge), Kotlin (MediaProjection API, Foreground Service), Vanilla JS/CSS

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src-tauri/src/audio/mod.rs` | Modify | Add Android module + re-export |
| `src-tauri/src/audio/android.rs` | Create | Android mic (cpal) + SystemAudioCapture stub |
| `src-tauri/src/commands/audio.rs` | Modify | Add `request_media_projection` command + platform guards |
| `src-tauri/src/lib.rs` | Modify | Platform-aware AudioState init |
| `src-tauri/Cargo.toml` | Modify | Add `jni` (Android target), `tauri-plugin-os` |
| `src-tauri/gen/android/app/src/main/kotlin/com/personal/translator/MediaProjectionActivity.kt` | Create | Permission dialog + token forwarding to Rust |
| `src-tauri/gen/android/app/src/main/kotlin/com/personal/translator/MediaProjectionService.kt` | Create | Foreground service for system audio capture |
| `src-tauri/gen/android/app/src/main/AndroidManifest.xml` | Modify | Add all required permissions |
| `src/styles/mobile.css` | Create | Mobile layout overrides (bottom sheet, touch targets) |
| `src/index.html` | Modify | Link `mobile.css` |
| `src/js/app.js` | Modify | Platform detection, mobile state, `request_media_projection` flow |
| `src/js/settings.js` | Modify | Filter TTS providers by platform |
| `src/js/ui.js` | Modify | Mobile bottom sheet for Interview AI, modal for history |
| `.github/workflows/release.yml` | Modify | Add `build-android` job |

---

## Task 1: Tauri Android Init

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Generated: `src-tauri/gen/android/` (entire directory)

- [ ] **Step 1: Install Android prerequisites**

Ensure Android SDK, NDK (r26+), and Java 17+ are installed. Set env vars:
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/26.1.10909125
```

- [ ] **Step 2: Add Android Rust targets**
```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
```

- [ ] **Step 3: Run tauri android init**
```bash
cd e:/Projects/assistant
npm run tauri android init
```
Expected: creates `src-tauri/gen/android/` with full Gradle project structure including `app/src/main/kotlin/com/personal/translator/MainActivity.kt`.

- [ ] **Step 4: Verify app identifier in generated MainActivity**

Open `src-tauri/gen/android/app/src/main/kotlin/com/personal/translator/MainActivity.kt`. It should contain:
```kotlin
class MainActivity : TauriActivity()
```

- [ ] **Step 5: Fix window config for mobile in tauri.conf.json**

`tauri.conf.json` has `alwaysOnTop: true` which breaks on Android. Add a mobile-safe window config:
```json
// In "app" > "windows" array, the existing entry already applies to desktop only
// Add this key at the top level of "app":
"security": {
  "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ipc://localhost wss: https:; img-src 'self' data:"
}
```
The `alwaysOnTop` and `decorations: false` properties are desktop-only and Tauri ignores them on Android — no change needed.

- [ ] **Step 6: Verify dev build boots**
```bash
# Connect Android device via USB (USB debugging enabled) OR start emulator (API 29+)
npm run tauri android dev
```
Expected: App opens on device/emulator showing current desktop UI (unstyled for mobile — that's OK for now).

- [ ] **Step 7: Commit**
```bash
git add src-tauri/gen/android/ src-tauri/Cargo.lock
git commit -m "chore: tauri android init — add Android project scaffold"
```

---

## Task 2: Android Microphone Capture (Rust)

**Files:**
- Create: `src-tauri/src/audio/android.rs`
- Modify: `src-tauri/src/audio/mod.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add jni dependency for Android target in Cargo.toml**

In `src-tauri/Cargo.toml`, add after the Windows dependencies block:
```toml
# Android: JNI for MediaProjection bridge
[target.'cfg(target_os = "android")'.dependencies]
jni = { version = "0.21", default-features = false }
```

- [ ] **Step 2: Create audio/android.rs with MicCapture**

Create `src-tauri/src/audio/android.rs`:
```rust
//! Android audio capture: microphone via cpal, system audio via MediaProjection JNI bridge

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use super::TARGET_SAMPLE_RATE;

// ─── Microphone (cpal / AAudio) ──────────────────────────────────────────────

pub struct MicCapture {
    stream: Mutex<Option<cpal::Stream>>,
}

impl MicCapture {
    pub fn new() -> Self {
        Self { stream: Mutex::new(None) }
    }

    pub fn start(&mut self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No input device available")?;

        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(TARGET_SAMPLE_RATE),
            buffer_size: cpal::BufferSize::Default,
        };

        let (tx, rx) = mpsc::channel::<Vec<u8>>();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    // f32 → s16le
                    let samples: Vec<u8> = data
                        .iter()
                        .flat_map(|&s| {
                            let clamped = s.clamp(-1.0, 1.0);
                            let s16 = (clamped * 32767.0) as i16;
                            s16.to_le_bytes()
                        })
                        .collect();
                    let _ = tx.send(samples);
                },
                |err| eprintln!("[android mic] stream error: {err}"),
                None,
            )
            .map_err(|e| e.to_string())?;

        stream.play().map_err(|e| e.to_string())?;

        let mut guard = self.stream.lock().map_err(|e| e.to_string())?;
        *guard = Some(stream);

        Ok(rx)
    }

    pub fn stop(&mut self) {
        if let Ok(mut guard) = self.stream.lock() {
            guard.take(); // drop → stream stops
        }
    }
}

// ─── System Audio (MediaProjection) ──────────────────────────────────────────

/// Shared channel: Kotlin AudioRecord thread sends PCM here after projection granted
static SYSTEM_TX: Mutex<Option<mpsc::SyncSender<Vec<u8>>>> = Mutex::new(None);

pub struct SystemAudioCapture {
    active: Arc<std::sync::atomic::AtomicBool>,
}

impl SystemAudioCapture {
    pub fn new() -> Self {
        Self {
            active: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Called by JS after MediaProjection permission is granted.
    /// The Kotlin side calls `on_pcm_data` directly via JNI — this just opens the channel.
    pub fn start(&self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(128);
        let mut guard = SYSTEM_TX.lock().map_err(|e| e.to_string())?;
        *guard = Some(tx);
        self.active.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(rx)
    }

    pub fn stop(&self) {
        self.active.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut guard) = SYSTEM_TX.lock() {
            guard.take();
        }
    }
}

/// Called from Kotlin via JNI when AudioRecord has PCM data.
/// JNI function name must match: Java_com_personal_translator_MediaProjectionService_onPcmData
#[no_mangle]
pub extern "C" fn Java_com_personal_translator_MediaProjectionService_onPcmData(
    env: jni::JNIEnv,
    _class: jni::objects::JClass,
    data: jni::objects::JByteArray,
) {
    if let Ok(bytes) = env.convert_byte_array(data) {
        if let Ok(guard) = SYSTEM_TX.lock() {
            if let Some(tx) = guard.as_ref() {
                let _ = tx.try_send(bytes);
            }
        }
    }
}
```

- [ ] **Step 3: Register Android module in audio/mod.rs**

Edit `src-tauri/src/audio/mod.rs` — add after the `wasapi` block:
```rust
#[cfg(target_os = "android")]
pub mod android;

#[cfg(target_os = "android")]
pub use android::SystemAudioCapture;

#[cfg(target_os = "android")]
pub use android::MicCapture;
```

And wrap the existing `pub mod microphone` with a desktop guard:
```rust
#[cfg(not(target_os = "android"))]
pub mod microphone;
```

- [ ] **Step 4: Verify Rust compiles for Android target**
```bash
cd src-tauri
cargo check --target aarch64-linux-android
```
Expected: compiles without errors. Warnings about unused imports on desktop are OK.

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/audio/android.rs src-tauri/src/audio/mod.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(android): add Android audio module — mic (cpal) + SystemAudioCapture stub"
```

---

## Task 3: MediaProjection Kotlin — Activity & Foreground Service

**Files:**
- Create: `src-tauri/gen/android/app/src/main/kotlin/com/personal/translator/MediaProjectionActivity.kt`
- Create: `src-tauri/gen/android/app/src/main/kotlin/com/personal/translator/MediaProjectionService.kt`

- [ ] **Step 1: Create MediaProjectionActivity.kt**

Create `src-tauri/gen/android/app/src/main/kotlin/com/personal/translator/MediaProjectionActivity.kt`:
```kotlin
package com.personal.translator

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle

/**
 * Transparent one-shot activity that shows the MediaProjection permission dialog.
 * On result, starts MediaProjectionService with the granted token.
 */
class MediaProjectionActivity : Activity() {

    companion object {
        const val REQUEST_CODE = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CODE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            val serviceIntent = Intent(this, MediaProjectionService::class.java).apply {
                putExtra("resultCode", resultCode)
                putExtra("data", data)
            }
            startForegroundService(serviceIntent)
        }
        finish()
    }
}
```

- [ ] **Step 2: Create MediaProjectionService.kt**

Create `src-tauri/gen/android/app/src/main/kotlin/com/personal/translator/MediaProjectionService.kt`:
```kotlin
package com.personal.translator

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.IBinder
import androidx.core.app.NotificationCompat

class MediaProjectionService : Service() {

    companion object {
        private const val CHANNEL_ID = "myjavis_capture"
        private const val NOTIF_ID = 1

        // Called from Rust via JNI — defined in audio/android.rs
        @JvmStatic
        external fun onPcmData(data: ByteArray)
    }

    private var projection: MediaProjection? = null
    private var recorder: AudioRecord? = null
    private var captureThread: Thread? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()
        val stopIntent = Intent(this, MediaProjectionService::class.java).apply {
            action = "STOP"
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MyJavis")
            .setContentText("Đang phiên dịch...")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .addAction(android.R.drawable.ic_media_pause, "Dừng", stopPendingIntent)
            .build()
        startForeground(NOTIF_ID, notification)

        if (intent?.action == "STOP") {
            stopSelf()
            return START_NOT_STICKY
        }

        val resultCode = intent?.getIntExtra("resultCode", -1) ?: return START_NOT_STICKY
        val data = intent.getParcelableExtra<Intent>("data") ?: return START_NOT_STICKY

        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = manager.getMediaProjection(resultCode, data)

        startCapture()
        return START_STICKY
    }

    private fun startCapture() {
        val proj = projection ?: return

        val captureConfig = AudioPlaybackCaptureConfiguration.Builder(proj)
            .addMatchingUsage(android.media.AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(android.media.AudioAttributes.USAGE_GAME)
            .build()

        val audioFormat = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(16000)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build()

        val minBuf = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)

        recorder = AudioRecord.Builder()
            .setAudioPlaybackCaptureConfig(captureConfig)
            .setAudioFormat(audioFormat)
            .setBufferSizeInBytes(minBuf * 4)
            .build()

        recorder?.startRecording()

        captureThread = Thread {
            val buf = ByteArray(minBuf * 2)
            while (!Thread.interrupted()) {
                val read = recorder?.read(buf, 0, buf.size, AudioRecord.READ_BLOCKING) ?: break
                if (read > 0) {
                    onPcmData(buf.copyOf(read))
                }
            }
        }.also { it.start() }
    }

    override fun onDestroy() {
        captureThread?.interrupt()
        recorder?.stop()
        recorder?.release()
        projection?.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "MyJavis Audio Capture",
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
```

- [ ] **Step 3: Register in AndroidManifest.xml (partial — full permissions in Task 6)**

Open `src-tauri/gen/android/app/src/main/AndroidManifest.xml`. Inside `<application>` tag, add:
```xml
<activity
    android:name=".MediaProjectionActivity"
    android:theme="@android:style/Theme.Translucent.NoTitleBar"
    android:exported="false" />

<service
    android:name=".MediaProjectionService"
    android:foregroundServiceType="mediaProjection"
    android:exported="false" />
```

- [ ] **Step 4: Commit**
```bash
git add src-tauri/gen/android/app/src/main/kotlin/com/personal/translator/
git add src-tauri/gen/android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): add MediaProjectionActivity and MediaProjectionService (Kotlin)"
```

---

## Task 4: request_media_projection Rust Command

**Files:**
- Modify: `src-tauri/src/commands/audio.rs`

This command is Android-only. JS calls it before `start_capture("system", ...)`. It launches `MediaProjectionActivity` via JNI, which triggers the system permission dialog. Once the user grants, Kotlin starts the Foreground Service, and PCM flows through `onPcmData` → `SYSTEM_TX` channel.

- [ ] **Step 1: Add request_media_projection command to commands/audio.rs**

At the top of `src-tauri/src/commands/audio.rs`, add the import guard:
```rust
#[cfg(target_os = "android")]
use jni::objects::JObject;
```

Then add at the bottom of `commands/audio.rs`:
```rust
/// Launch MediaProjectionActivity to request system audio permission.
/// Android only — no-op on desktop (should never be called from desktop JS).
#[tauri::command]
pub fn request_media_projection(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::JavaVM;
        // Get the JVM and Activity from Tauri's Android runtime
        let ctx = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("JVM error: {e}"))?;
        let mut env = vm.attach_current_thread().map_err(|e| format!("JNI attach: {e}"))?;

        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

        // Build Intent for MediaProjectionActivity
        let intent_class = env.find_class("android/content/Intent").map_err(|e| e.to_string())?;
        let activity_class = env
            .find_class("com/personal/translator/MediaProjectionActivity")
            .map_err(|e| e.to_string())?;

        let intent = env
            .new_object(
                intent_class,
                "(Landroid/content/Context;Ljava/lang/Class;)V",
                &[(&activity).into(), (&activity_class).into()],
            )
            .map_err(|e| e.to_string())?;

        env.call_method(
            &activity,
            "startActivity",
            "(Landroid/content/Intent;)V",
            &[(&intent).into()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 2: Add ndk-context dependency for Android in Cargo.toml**

In the Android dependencies block in `Cargo.toml`:
```toml
[target.'cfg(target_os = "android")'.dependencies]
jni = { version = "0.21", default-features = false }
ndk-context = "0.1"
```

- [ ] **Step 3: Register command in lib.rs**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` list:
```rust
#[cfg(target_os = "android")]
commands::audio::request_media_projection,
```

Since `tauri::generate_handler!` doesn't accept `#[cfg]` directly inside the macro, wrap it:

Replace the `invoke_handler` block with:
```rust
.invoke_handler({
    #[cfg(not(target_os = "android"))]
    { tauri::generate_handler![
        commands::settings::get_settings,
        commands::settings::save_settings,
        commands::audio::start_capture,
        commands::audio::stop_capture,
        commands::audio::check_permissions,
        commands::transcript::save_transcript,
        commands::transcript::open_transcript_dir,
        commands::transcript::list_transcripts,
        commands::transcript::read_transcript,
        commands::transcript::delete_transcript,
        commands::local_pipeline::start_local_pipeline,
        commands::local_pipeline::send_audio_to_pipeline,
        commands::local_pipeline::stop_local_pipeline,
        commands::local_pipeline::check_mlx_setup,
        commands::local_pipeline::run_mlx_setup,
        commands::edge_tts::edge_tts_speak,
        commands::secrets::interview_set_api_key,
        commands::secrets::interview_clear_api_key,
        commands::secrets::interview_has_api_key,
        commands::secrets::interview_key_status,
        commands::interview::ingest_interview_files,
        commands::interview::save_interview_message,
        commands::interview::suggest_interview_answers,
        get_platform_info,
    ]}
    #[cfg(target_os = "android")]
    { tauri::generate_handler![
        commands::settings::get_settings,
        commands::settings::save_settings,
        commands::audio::start_capture,
        commands::audio::stop_capture,
        commands::audio::check_permissions,
        commands::audio::request_media_projection,
        commands::transcript::save_transcript,
        commands::transcript::open_transcript_dir,
        commands::transcript::list_transcripts,
        commands::transcript::read_transcript,
        commands::transcript::delete_transcript,
        commands::edge_tts::edge_tts_speak,
        commands::secrets::interview_set_api_key,
        commands::secrets::interview_clear_api_key,
        commands::secrets::interview_has_api_key,
        commands::secrets::interview_key_status,
        commands::interview::ingest_interview_files,
        commands::interview::save_interview_message,
        commands::interview::suggest_interview_answers,
        get_platform_info,
    ]}
})
```

Note: `local_pipeline` commands are excluded on Android (MLX is macOS-only).

- [ ] **Step 4: Platform-guard AudioState init in lib.rs**

The current `AudioState` init uses `SystemAudioCapture::new()` and `MicCapture::new()` from desktop modules. With Android, `audio::MicCapture` now resolves to `android::MicCapture`. Update the import in `lib.rs`:

```rust
// Replace the desktop-specific imports at top of lib.rs:
#[cfg(not(target_os = "android"))]
use audio::microphone::MicCapture;

#[cfg(target_os = "android")]
use audio::android::MicCapture;

use audio::SystemAudioCapture; // resolves correctly on all platforms via mod.rs re-exports
```

- [ ] **Step 5: Gate LocalPipelineState on non-Android**

`LocalPipelineState` uses the Python sidecar which doesn't exist on Android. In `lib.rs`:
```rust
#[cfg(not(target_os = "android"))]
use commands::local_pipeline::LocalPipelineState;
```

And wrap the `.manage(LocalPipelineState {...})` line:
```rust
#[cfg(not(target_os = "android"))]
app_builder = app_builder.manage(LocalPipelineState { process: Mutex::new(None) });
```

This requires refactoring the builder chain into a variable. Rewrite the `run()` function body:
```rust
pub fn run() {
    eprintln!("[boot] myjavis starting...");
    let initial_settings = Settings::load();

    #[cfg(not(target_os = "android"))]
    use audio::microphone::MicCapture;
    #[cfg(target_os = "android")]
    use audio::android::MicCapture;

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            eprintln!("[boot] tauri setup...");
            let handle = app.handle().clone();
            let conn = db::open_connection(&handle)
                .map_err(|e| format!("assistant DB init: {e}"))?;
            app.manage(InterviewDb(Mutex::new(conn)));
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .manage(SettingsState(Mutex::new(initial_settings)))
        .manage(AudioState {
            system_audio: Mutex::new(SystemAudioCapture::new()),
            microphone: Mutex::new(MicCapture::new()),
            active_receiver: Mutex::new(None),
        });

    #[cfg(not(target_os = "android"))]
    {
        builder = builder.manage(LocalPipelineState { process: Mutex::new(None) });
    }

    builder
        .invoke_handler(/* ... same as Step 3 ... */)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Verify Rust compiles for Android**
```bash
cd src-tauri
cargo check --target aarch64-linux-android
```
Expected: no errors.

- [ ] **Step 7: Commit**
```bash
git add src-tauri/src/commands/audio.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(android): request_media_projection command + platform-guard lib.rs"
```

---

## Task 5: AndroidManifest — Full Permissions

**Files:**
- Modify: `src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- Modify: `src-tauri/gen/android/app/build.gradle`

- [ ] **Step 1: Add all permissions to AndroidManifest.xml**

Open `src-tauri/gen/android/app/src/main/AndroidManifest.xml`. Before the `<application>` tag, add:
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<uses-permission android:name="android.permission.INTERNET" />
```

- [ ] **Step 2: Set minSdkVersion in build.gradle**

Open `src-tauri/gen/android/app/build.gradle`. Find `defaultConfig` block and set:
```gradle
defaultConfig {
    minSdk = 29
    targetSdk = 35
    // ... existing entries
}
```

- [ ] **Step 3: Commit**
```bash
git add src-tauri/gen/android/app/src/main/AndroidManifest.xml
git add src-tauri/gen/android/app/build.gradle
git commit -m "feat(android): set permissions and minSdk=29 in manifest"
```

---

## Task 6: Mobile CSS Layout

**Files:**
- Create: `src/styles/mobile.css`
- Modify: `src/index.html`

- [ ] **Step 1: Create src/styles/mobile.css**

```css
/* Mobile overrides — loaded on all platforms, activated via JS body class */

body.mobile {
  --mobile-header-h: 56px;
  --mobile-bottom-sheet-h: 260px;
}

/* ─── Layout ─────────────────────────────────────────────────── */

body.mobile #overlay-view {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}

body.mobile #drag-region,
body.mobile .control-bar {
  height: var(--mobile-header-h);
  min-height: var(--mobile-header-h);
  display: flex;
  align-items: center;
  padding: 0 12px;
  /* drag region not needed on mobile */
  -webkit-app-region: no-drag;
}

/* ─── Touch targets ───────────────────────────────────────────── */

body.mobile .icon-btn,
body.mobile button {
  min-width: 48px;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* ─── Transcript area ─────────────────────────────────────────── */

body.mobile #transcript-content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 16px;
  font-size: 17px;
  line-height: 1.6;
}

/* ─── Sidebar → full-screen modal ────────────────────────────── */

body.mobile #sidebar {
  position: fixed;
  inset: 0;
  z-index: 200;
  transform: translateX(-100%);
  transition: transform 0.25s ease;
  width: 100%;
  border-radius: 0;
}

body.mobile #sidebar.open {
  transform: translateX(0);
}

/* ─── Interview AI → bottom sheet ────────────────────────────── */

body.mobile #suggestions-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--mobile-bottom-sheet-h);
  z-index: 100;
  border-radius: 16px 16px 0 0;
  transform: translateY(100%);
  transition: transform 0.3s ease;
  overflow-y: auto;
  padding: 16px;
  background: var(--bg-secondary, #1e1e1e);
  border-top: 1px solid var(--border-color, #333);
}

body.mobile #suggestions-panel.open {
  transform: translateY(0);
}

/* drag handle for bottom sheet */
body.mobile #suggestions-panel::before {
  content: '';
  display: block;
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-color, #555);
  margin: 0 auto 12px;
}

/* ─── Right panel toggle button (mobile) ─────────────────────── */

body.mobile #btn-toggle-right-panel {
  position: fixed;
  bottom: calc(var(--mobile-bottom-sheet-h) + 12px);
  right: 16px;
  z-index: 101;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--accent-color, #4a9eff);
  color: white;
  border: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  display: none; /* shown only when interview mode active */
}

body.mobile.interview-active #btn-toggle-right-panel {
  display: flex;
}
```

- [ ] **Step 2: Link mobile.css in index.html**

In `src/index.html`, after the `main.css` link:
```html
<link rel="stylesheet" href="styles/mobile.css" />
```

- [ ] **Step 3: Commit**
```bash
git add src/styles/mobile.css src/index.html
git commit -m "feat(android): add mobile.css layout — bottom sheet, full-screen modal, touch targets"
```

---

## Task 7: JS Platform Detection & TTS Filter

**Files:**
- Modify: `src/js/app.js`
- Modify: `src/js/settings.js`

- [ ] **Step 1: Add isMobile detection in _checkPlatformSupport (app.js)**

In `app.js`, find `_checkPlatformSupport()` at line ~123. Replace the method:
```js
async _checkPlatformSupport() {
    try {
        const arch = await invoke('get_platform_info');
        const info = JSON.parse(arch);
        this.isAppleSilicon = (info.os === 'macos' && info.arch === 'aarch64');
        this.isMobile = (info.os === 'android');
    } catch {
        this.isAppleSilicon = false;
        this.isMobile = false;
    }

    if (!this.isAppleSilicon) {
        const select = document.getElementById('select-translation-mode');
        const localOption = select?.querySelector('option[value="local"]');
        if (localOption) localOption.remove();
        const settings = settingsManager.get();
        if (settings.translation_mode === 'local') {
            settings.translation_mode = 'soniox';
            settingsManager.save(settings);
        }
    }

    if (this.isMobile) {
        document.body.classList.add('mobile');
        this._applyMobileDefaults();
    }
}

_applyMobileDefaults() {
    // Default to microphone on Android (system audio requires explicit permission request)
    const settings = settingsManager.get();
    if (settings.audio_source === 'system') {
        settings.audio_source = 'microphone';
        settingsManager.save(settings);
    }
    // Hide source options not relevant to Android
    const systemOption = document.querySelector('#select-audio-source option[value="system"]');
    if (systemOption) systemOption.textContent = 'System Audio (requires permission)';
}
```

- [ ] **Step 2: Filter TTS providers in settings.js**

In `src/js/settings.js`, find where TTS provider `<select>` is populated (search for `tts_provider`). Add a filter after the settings load:

In the `_notify()` method or wherever TTS UI is rendered, add:
```js
_filterTtsProviders() {
    // Detect platform from body class (set by app.js)
    const isMobile = document.body.classList.contains('mobile');
    if (!isMobile) return;

    const providerSelect = document.getElementById('select-tts-provider');
    if (!providerSelect) return;

    ['elevenlabs', 'web-speech'].forEach(val => {
        const opt = providerSelect.querySelector(`option[value="${val}"]`);
        if (opt) opt.remove();
    });

    // If current selection was removed, fallback to edge
    if (!providerSelect.value || !providerSelect.querySelector(`option[value="${providerSelect.value}"]`)) {
        providerSelect.value = 'edge';
    }
}
```

Call `this._filterTtsProviders()` at the end of the `load()` method in `SettingsManager`.

- [ ] **Step 3: Add request_media_projection flow in app.js**

Find `_startCapture` or the start flow in `app.js`. Before calling `start_capture` with source `"system"`, add the Android MediaProjection flow:

```js
async _ensureSystemAudioPermission() {
    if (!this.isMobile) return true;
    try {
        await invoke('request_media_projection');
        // Give Kotlin Activity time to complete the permission dialog
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
    } catch (err) {
        console.error('[android] request_media_projection failed:', err);
        return false;
    }
}
```

In the start capture flow, before `invoke('start_capture', { source, channel })` when source is `"system"`:
```js
if (source === 'system') {
    const ok = await this._ensureSystemAudioPermission();
    if (!ok) {
        this._setStatus('Không thể lấy quyền system audio');
        return;
    }
}
```

- [ ] **Step 4: Manual test — platform detection**

Run `npm run tauri android dev`. Open devtools (if available on emulator) or add a `console.log(this.isMobile)` temporarily. Verify `document.body` has class `mobile` on Android, does not on desktop.

- [ ] **Step 5: Commit**
```bash
git add src/js/app.js src/js/settings.js
git commit -m "feat(android): platform detection, mobile defaults, TTS provider filter"
```

---

## Task 8: Mobile UI — Bottom Sheet & Modal History

**Files:**
- Modify: `src/js/ui.js`
- Modify: `src/js/app.js`

- [ ] **Step 1: Add bottom sheet toggle button to index.html**

In `src/index.html`, add a floating button for the Interview AI panel toggle (inside `#overlay-view`):
```html
<button id="btn-toggle-right-panel" class="icon-btn" title="Toggle suggestions">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
</button>
```

- [ ] **Step 2: Wire bottom sheet toggle in app.js**

In `app.js` `_bindEvents()`, add:
```js
document.getElementById('btn-toggle-right-panel')?.addEventListener('click', () => {
    this._toggleMobileSuggestionsSheet();
});
```

Add the toggle method:
```js
_toggleMobileSuggestionsSheet() {
    const panel = document.getElementById('suggestions-panel');
    if (!panel) return;
    panel.classList.toggle('open');
}
```

- [ ] **Step 3: Auto-collapse bottom sheet on transcript scroll**

In `app.js`, after `transcriptUI` is initialized:
```js
if (this.isMobile) {
    document.getElementById('transcript-content')?.addEventListener('scroll', () => {
        const panel = document.getElementById('suggestions-panel');
        panel?.classList.remove('open');
    });
}
```

- [ ] **Step 4: Make sidebar full-screen modal on mobile**

The existing sidebar toggle in `app.js` calls something like `sidebar.classList.toggle('open')`. The CSS in Task 6 already handles the visual — verify the toggle still works by checking that `_toggleSidebar()` in `app.js` adds/removes the `open` class on `#sidebar`.

If the existing sidebar toggle uses a different mechanism (e.g. width transition), it needs to be adapted. Search for `sidebarOpen` in `app.js` and verify the class toggle logic reaches the `#sidebar` element.

- [ ] **Step 5: Add interview-active body class**

When Interview mode is active on mobile, `body.mobile.interview-active` shows the floating toggle button (via CSS). In `app.js`, where Interview mode is activated/deactivated, add:
```js
// When activating interview mode:
if (this.isMobile) document.body.classList.add('interview-active');

// When deactivating:
if (this.isMobile) document.body.classList.remove('interview-active');
```

- [ ] **Step 6: Manual test on device**

Run `npm run tauri android dev`. Verify:
- Body has class `mobile`
- Sidebar opens as full-screen overlay
- Interview AI floating button appears when Interview mode is active
- Tapping the button slides up the bottom sheet
- Scrolling transcript auto-collapses the sheet

- [ ] **Step 7: Commit**
```bash
git add src/js/app.js src/js/ui.js src/index.html
git commit -m "feat(android): mobile bottom sheet for Interview AI, full-screen modal sidebar"
```

---

## Task 9: CI — Android Build Job

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add build-android job to release.yml**

Open `.github/workflows/release.yml`. After the `build-windows` job, add:
```yaml
  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Java 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install Android NDK
        run: |
          sdkmanager "ndk;26.1.10909125"
          echo "NDK_HOME=$ANDROID_SDK_ROOT/ndk/26.1.10909125" >> $GITHUB_ENV

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi,x86_64-linux-android

      - name: Rust cache
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install dependencies
        run: npm install

      - name: Build Android APK
        env:
          ANDROID_SIGNING_KEY: ${{ secrets.ANDROID_SIGNING_KEY }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
          ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: npm run tauri android build -- --apk

      - name: Upload Android artifact
        uses: actions/upload-artifact@v4
        with:
          name: android-apk
          path: src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk

      - name: Upload APK to Release
        uses: softprops/action-gh-release@v2
        with:
          files: src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk
```

- [ ] **Step 2: Add Android signing secrets note**

The following secrets must be added in GitHub repo Settings → Secrets:
- `ANDROID_SIGNING_KEY` — base64-encoded `.jks` keystore file
- `ANDROID_KEY_ALIAS` — key alias in the keystore
- `ANDROID_KEY_PASSWORD` — key password

Generate keystore locally:
```bash
keytool -genkey -v -keystore myjavis-release.jks \
  -alias myjavis -keyalg RSA -keysize 2048 -validity 10000
# Then encode:
base64 -i myjavis-release.jks | pbcopy   # macOS
```

- [ ] **Step 3: Commit**
```bash
git add .github/workflows/release.yml
git commit -m "ci: add build-android job to release workflow"
```

---

## Self-Review

### Spec Coverage Check

| Spec requirement | Covered by |
|-----------------|-----------|
| Tauri 2 Android target | Task 1 |
| Android microphone (cpal) | Task 2 |
| System audio via MediaProjection (API 29+) | Tasks 3–4 |
| No overlay / regular app | CSS handles, no special task needed |
| Edge TTS + Google TTS only | Task 7 (filter) |
| Interview AI mode on mobile | Task 8 |
| Mobile layout — bottom sheet, modal | Tasks 6, 8 |
| AndroidManifest permissions + minSdk=29 | Task 5 |
| GitHub Actions Android build | Task 9 |
| Foreground Service notification | Task 3 |

### Placeholder Check
- No TBDs or TODOs found.
- All code blocks are complete.

### Type Consistency Check
- `SystemAudioCapture` — defined in `audio/android.rs`, re-exported in `mod.rs`, used in `AudioState`. Consistent.
- `MicCapture` — same pattern. Consistent.
- `request_media_projection` — registered in `lib.rs` Android handler, called from `app.js` via `invoke('request_media_projection')`. Consistent.
- `SYSTEM_TX` static in `android.rs` is the bridge between `SystemAudioCapture::start()` and `onPcmData` JNI callback. Consistent.
- `isMobile` flag set in `_checkPlatformSupport`, used in `_applyMobileDefaults`, `_ensureSystemAudioPermission`, `_toggleMobileSuggestionsSheet`, transcript scroll listener. Consistent.
