use std::sync::mpsc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

use super::TARGET_SAMPLE_RATE;

#[cfg(windows)]
use windows::Win32::Media::Audio::{
    IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, eCapture, eConsole,
};
#[cfg(windows)]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// Microphone capture using cpal.
/// Captures from the default input device and converts to PCM s16le 16kHz mono.
pub struct MicCapture {
    is_capturing: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl MicCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
            worker: None,
        }
    }

    /// Start capturing from the microphone.
    /// Returns a receiver that yields PCM s16le 16kHz mono audio chunks.
    pub fn start(&mut self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err("Already capturing".to_string());
        }

        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        self.is_capturing.store(true, Ordering::SeqCst);
        let is_capturing = self.is_capturing.clone();

        // Handshake channel so we can return errors from the worker thread.
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);

        let worker = std::thread::spawn(move || {
            let result: Result<(), String> = (|| {
                #[cfg(windows)]
                {
                    unsafe {
                        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

                        println!("[Mic] Starting WASAPI microphone capture...");

                        let enumerator: IMMDeviceEnumerator = CoCreateInstance(
                            &MMDeviceEnumerator,
                            None,
                            CLSCTX_ALL,
                        )
                        .map_err(|e| format!("Failed to create device enumerator: {}", e))?;

                        let device = enumerator
                            .GetDefaultAudioEndpoint(eCapture, eConsole)
                            .map_err(|e| format!("Failed to get default capture endpoint: {}", e))?;

                        let audio_client: IAudioClient = device
                            .Activate(CLSCTX_ALL, None)
                            .map_err(|e| format!("Failed to activate audio client: {}", e))?;

                        let mix_format_ptr = audio_client
                            .GetMixFormat()
                            .map_err(|e| format!("GetMixFormat failed: {}", e))?;
                        let mix_format = &*mix_format_ptr;

                        let source_rate = mix_format.nSamplesPerSec;
                        let source_channels = mix_format.nChannels as u32;
                        let bits_per_sample = mix_format.wBitsPerSample;

                        println!(
                            "[Mic] Mix format: rate={}, channels={}, bits={}",
                            source_rate, source_channels, bits_per_sample
                        );

                        println!("[Mic] Initializing audio client...");
                        audio_client
                            .Initialize(
                                AUDCLNT_SHAREMODE_SHARED,
                                0,
                                10_000_000, // 1 second buffer in 100ns units
                                0,
                                mix_format_ptr,
                                None,
                            )
                            .map_err(|e| format!("AudioClient Initialize failed: {}", e))?;
                        println!("[Mic] Audio client initialized.");

                        let capture_client: IAudioCaptureClient = audio_client
                            .GetService()
                            .map_err(|e| format!("Failed to get capture client: {}", e))?;

                        println!("[Mic] Starting audio client...");
                        audio_client
                            .Start()
                            .map_err(|e| format!("Failed to start audio client: {}", e))?;
                        println!("[Mic] Audio client started.");

                        // Signal readiness only after capture starts.
                        let _ = ready_tx.send(Ok(()));

                        while is_capturing.load(Ordering::SeqCst) {
                            std::thread::sleep(std::time::Duration::from_millis(10));

                            let packet_size = match capture_client.GetNextPacketSize() {
                                Ok(size) => size,
                                Err(_) => continue,
                            };
                            if packet_size == 0 {
                                continue;
                            }

                            let mut buffer_ptr = std::ptr::null_mut();
                            let mut num_frames = 0u32;
                            let mut flags = 0u32;

                            if capture_client
                                .GetBuffer(
                                    &mut buffer_ptr,
                                    &mut num_frames,
                                    &mut flags,
                                    None,
                                    None,
                                )
                                .is_err()
                            {
                                continue;
                            }

                            if num_frames > 0 && !buffer_ptr.is_null() {
                                let is_silent =
                                    (flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) != 0;
                                if !is_silent {
                                    let pcm = convert_wasapi_mic_to_pcm_s16_16k(
                                        buffer_ptr,
                                        num_frames,
                                        source_rate,
                                        source_channels,
                                        bits_per_sample,
                                    );
                                    if !pcm.is_empty() {
                                        let _ = sender.send(pcm);
                                    }
                                }
                            }

                            let _ = capture_client.ReleaseBuffer(num_frames);
                        }

                        let _ = audio_client.Stop();
                        CoUninitialize();

                        Ok(())
                    }
                }

                #[cfg(not(windows))]
                {
                    let _ = ready_tx.send(Err("Microphone capture not implemented on this OS".to_string()));
                    Err("Microphone capture not implemented on this OS".to_string())
                }
            })();

            // If we failed before signalling readiness, propagate the error once.
            if let Err(e) = result {
                let _ = ready_tx.send(Err(e));
            }
        });

        self.worker = Some(worker);

        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                self.is_capturing.store(false, Ordering::SeqCst);
                self.worker.take().map(|h| h.join());
                return Err(e);
            }
            Err(e) => {
                self.is_capturing.store(false, Ordering::SeqCst);
                self.worker.take().map(|h| h.join());
                return Err(format!("Microphone worker failed to start: {}", e));
            }
        }

        Ok(receiver)
    }

    pub fn stop(&mut self) {
        self.is_capturing.store(false, Ordering::SeqCst);
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
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
#[cfg(not(windows))]
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
#[cfg(not(windows))]
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

#[cfg(windows)]
unsafe fn convert_wasapi_mic_to_pcm_s16_16k(
    buffer_ptr: *mut u8,
    num_frames: u32,
    source_rate: u32,
    source_channels: u32,
    bits_per_sample: u16,
) -> Vec<u8> {
    let frame_count = num_frames as usize;
    let channels = source_channels.max(1) as usize;

    // Mix to mono as f32
    let mono_f32: Vec<f32> = match bits_per_sample {
        16 => {
            let ptr = buffer_ptr as *const i16;
            let samples = std::slice::from_raw_parts(ptr, frame_count * channels);
            samples
                .chunks(channels)
                .map(|frame| {
                    let sum: f32 = frame.iter().map(|&s| s as f32).sum();
                    sum / (channels as f32 * 32768.0)
                })
                .collect()
        }
        32 => {
            let ptr = buffer_ptr as *const f32;
            let samples = std::slice::from_raw_parts(ptr, frame_count * channels);
            samples
                .chunks(channels)
                .map(|frame| frame.iter().copied().sum::<f32>() / channels as f32)
                .collect()
        }
        _ => return Vec::new(),
    };

    let resampled = if source_rate != TARGET_SAMPLE_RATE {
        simple_resample(&mono_f32, source_rate, TARGET_SAMPLE_RATE)
    } else {
        mono_f32
    };

    resampled
        .iter()
        .flat_map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            let s16 = (clamped * 32767.0) as i16;
            s16.to_le_bytes()
        })
        .collect()
}
