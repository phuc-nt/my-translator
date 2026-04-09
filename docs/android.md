## Android build (Tauri)

This project can build an Android APK using Tauri's Android support.

### Prerequisites
- **Java 17**
- **Android SDK** (Android Studio is fine)
- **Android NDK** (CI uses `ndk;26.3.11579264`)
- **Node 20+**
- **Rust** toolchain

Ensure these env vars are set:
- `ANDROID_SDK_ROOT` (or `ANDROID_HOME`)

### Windows note (symlinks)

On Windows, `tauri android build` may fail when it tries to create a symlink for `jniLibs` unless symlinks are allowed.

- Enable **Developer Mode** (recommended), or
- Run the terminal as **Administrator**

### Init (one-time)

```bash
npm ci
npm run tauri android init
```

This generates the Android Gradle project under `src-tauri/gen/android/`.

### Build APK

```bash
npm run tauri android build -- --apk
```

Artifacts are typically written under:
- `src-tauri/gen/android/**/outputs/**/*.apk`

