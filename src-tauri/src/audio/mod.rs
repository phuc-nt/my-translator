#[cfg(not(target_os = "android"))]
pub mod microphone;

#[cfg(target_os = "android")]
pub mod android;

#[cfg(target_os = "macos")]
pub mod system_audio;

#[cfg(target_os = "windows")]
pub mod wasapi;

// Re-export MicCapture per platform
#[cfg(not(target_os = "android"))]
pub use microphone::MicCapture;

#[cfg(target_os = "android")]
pub use android::MicCapture;

// Re-export SystemAudioCapture from the correct platform module
#[cfg(target_os = "android")]
pub use android::SystemAudioCapture;

#[cfg(target_os = "macos")]
pub use system_audio::SystemAudioCapture;

#[cfg(target_os = "windows")]
pub use wasapi::SystemAudioCapture;

// Fallback stub for mobile / unsupported targets (Android/iOS/Linux).
#[cfg(not(any(target_os = "android", target_os = "macos", target_os = "windows")))]
pub struct SystemAudioCapture;

#[cfg(not(any(target_os = "android", target_os = "macos", target_os = "windows")))]
impl SystemAudioCapture {
    pub fn new() -> Self {
        Self
    }

    pub fn start(&self) -> Result<std::sync::mpsc::Receiver<Vec<u8>>, String> {
        Err("System audio capture is not supported on this platform.".to_string())
    }

    pub fn stop(&self) {
        // no-op
    }
}

/// Target audio format for Soniox: PCM s16le, 16kHz, mono
pub const TARGET_SAMPLE_RATE: u32 = 16000;
#[allow(dead_code)]
pub const TARGET_CHANNELS: u16 = 1;
