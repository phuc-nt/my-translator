use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::mpsc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::TARGET_SAMPLE_RATE;

/// Microphone capture using cpal.
/// Captures from the default input device and converts to PCM s16le 16kHz mono.
pub struct MicCapture {
    is_capturing: Arc<AtomicBool>,
    /// We store the stream here to keep it alive.
    /// cpal::Stream is !Send, so can't move to another thread.
    /// Using Box<dyn StreamTrait> to erase the concrete type.
    _stream: Option<cpal::Stream>,
}

// SAFETY: MicCapture is only accessed through Mutex in AudioState,
// so concurrent access is properly synchronized. The cpal::Stream
// is created and dropped on the same thread (main thread via Tauri command).
unsafe impl Send for MicCapture {}

impl MicCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
            _stream: None,
        }
    }

    /// Start capturing from the microphone.
    /// Returns a receiver that yields PCM s16le 16kHz mono audio chunks.
    pub fn start(&mut self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err("Already capturing".to_string());
        }

        let host = cpal::default_host();

        // List available input devices for debugging
        let input_devices: Vec<String> = host.input_devices()
            .map(|devs| devs.filter_map(|d| d.name().ok()).collect())
            .unwrap_or_default();
        println!("[Mic] Available input devices: {:?}", input_devices);

        if input_devices.is_empty() {
            return Err("No microphone found. Connect an external microphone or headset.".to_string());
        }

        let device = host
            .default_input_device()
            .ok_or("No default microphone found. Connect an external microphone or headset.")?;

        println!("[Mic] Device: {:?}", device.name().unwrap_or_default());

        // Try default config first, fallback to supported configs
        let default_config = device.default_input_config()
            .or_else(|e| {
                println!("[Mic] default_input_config failed: {}, trying supported configs", e);
                // Fallback: find a supported config
                let mut configs = device.supported_input_configs()
                    .map_err(|e2| format!("No supported input configs: {}", e2))?;
                // Prefer F32, then I16
                configs
                    .find(|c| c.sample_format() == cpal::SampleFormat::F32)
                    .or_else(|| {
                        device.supported_input_configs().ok()
                            .and_then(|mut c| c.next())
                    })
                    .map(|c| {
                        // Pick sample rate: prefer 48kHz, else max
                        let rate = if c.min_sample_rate().0 <= 48000 && c.max_sample_rate().0 >= 48000 {
                            cpal::SampleRate(48000)
                        } else {
                            c.max_sample_rate()
                        };
                        c.with_sample_rate(rate)
                    })
                    .ok_or_else(|| format!("No suitable input config found (original: {})", e))
            })
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        println!("[Mic] Config: rate={}, channels={}, format={:?}",
            default_config.sample_rate().0,
            default_config.channels(),
            default_config.sample_format());

        let source_sample_rate = default_config.sample_rate().0;
        let source_channels = default_config.channels() as usize;

        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        self.is_capturing.store(true, Ordering::SeqCst);
        let is_capturing = self.is_capturing.clone();

        // Build the input config targeting our desired format
        let stream_config = cpal::StreamConfig {
            channels: default_config.channels(),
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let target_rate = TARGET_SAMPLE_RATE;
        let err_fn = |err| eprintln!("Microphone input error: {}", err);

        let stream = match default_config.sample_format() {
            cpal::SampleFormat::F32 => {
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if !is_capturing.load(Ordering::SeqCst) {
                            return;
                        }
                        let pcm = convert_f32_to_pcm_s16le(
                            data,
                            source_channels,
                            source_sample_rate,
                            target_rate,
                        );
                        if !pcm.is_empty() {
                            let _ = sender.send(pcm);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let is_capturing = self.is_capturing.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if !is_capturing.load(Ordering::SeqCst) {
                            return;
                        }
                        let pcm = convert_i16_to_pcm_s16le(
                            data,
                            source_channels,
                            source_sample_rate,
                            target_rate,
                        );
                        if !pcm.is_empty() {
                            let _ = sender.send(pcm);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            format => {
                return Err(format!("Unsupported sample format: {:?}", format));
            }
        }
        .map_err(|e| format!("Failed to build input stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start mic stream: {}", e))?;

        // Store stream to keep it alive
        self._stream = Some(stream);

        Ok(receiver)
    }

    pub fn stop(&mut self) {
        self.is_capturing.store(false, Ordering::SeqCst);
        // Drop the stream to stop capturing
        self._stream = None;
    }

    #[allow(dead_code)]
    pub fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::SeqCst)
    }
}

impl Default for MicCapture {
    fn default() -> Self {
        Self::new()
    }
}


/// Convert f32 audio to PCM s16le, with mono mixdown and resampling
fn convert_f32_to_pcm_s16le(
    data: &[f32],
    channels: usize,
    source_rate: u32,
    target_rate: u32,
) -> Vec<u8> {
    // Step 1: Mix to mono
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    // Step 2: Resample if needed
    let resampled = if source_rate != target_rate {
        simple_resample(&mono, source_rate, target_rate)
    } else {
        mono
    };

    // Step 3: Convert to s16le bytes
    resampled
        .iter()
        .flat_map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            let s16 = (clamped * 32767.0) as i16;
            s16.to_le_bytes()
        })
        .collect()
}

/// Convert i16 audio to PCM s16le, with mono mixdown and resampling
fn convert_i16_to_pcm_s16le(
    data: &[i16],
    channels: usize,
    source_rate: u32,
    target_rate: u32,
) -> Vec<u8> {
    // Step 1: Mix to mono and convert to f32
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| {
                let sum: f32 = frame.iter().map(|&s| s as f32).sum();
                sum / (channels as f32 * 32768.0)
            })
            .collect()
    } else {
        data.iter().map(|&s| s as f32 / 32768.0).collect()
    };

    // Step 2: Resample if needed
    let resampled = if source_rate != target_rate {
        simple_resample(&mono, source_rate, target_rate)
    } else {
        mono
    };

    // Step 3: Convert to s16le bytes
    resampled
        .iter()
        .flat_map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            let s16 = (clamped * 32767.0) as i16;
            s16.to_le_bytes()
        })
        .collect()
}

/// Simple linear interpolation resampler
/// Good enough for speech (not for music production)
fn simple_resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = i as f64 * ratio;
        let src_idx = src_pos as usize;
        let frac = src_pos - src_idx as f64;

        if src_idx + 1 < samples.len() {
            // Linear interpolation between two adjacent samples
            let s = samples[src_idx] as f64 * (1.0 - frac) + samples[src_idx + 1] as f64 * frac;
            output.push(s as f32);
        } else if src_idx < samples.len() {
            output.push(samples[src_idx]);
        }
    }

    output
}
