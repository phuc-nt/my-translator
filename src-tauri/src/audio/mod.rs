pub mod microphone;

#[cfg(target_os = "macos")]
pub mod system_audio;

#[cfg(target_os = "windows")]
pub mod wasapi;

// Re-export SystemAudioCapture from the correct platform module
#[cfg(target_os = "macos")]
pub use system_audio::SystemAudioCapture;

#[cfg(target_os = "windows")]
pub use wasapi::SystemAudioCapture;

/// Target audio format for Soniox: PCM s16le, 16kHz, mono
pub const TARGET_SAMPLE_RATE: u32 = 16000;
#[allow(dead_code)]
pub const TARGET_CHANNELS: u16 = 1;
