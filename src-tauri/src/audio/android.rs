use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::TARGET_SAMPLE_RATE;
use std::sync::OnceLock;

/// Android microphone capture using cpal (AAudio backend).
/// Outputs PCM s16le, 16kHz, mono.
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

    pub fn start(&mut self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err("Already capturing".to_string());
        }

        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        self.is_capturing.store(true, Ordering::SeqCst);
        let is_capturing = self.is_capturing.clone();

        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);

        let worker = std::thread::spawn(move || {
            let result: Result<(), String> = (|| {
                let host = cpal::default_host();
                let device = host
                    .default_input_device()
                    .ok_or("No default input device (microphone)")?;

                let default_config = device
                    .default_input_config()
                    .map_err(|e| format!("default input config: {e}"))?;

                let sample_format = default_config.sample_format();
                let cfg: cpal::StreamConfig = default_config.into();

                let channels = cfg.channels as usize;
                let source_rate = cfg.sample_rate.0;

                let shared_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(32000)));
                let shared_buf_cb = shared_buf.clone();
                let sender_cb = sender.clone();
                let is_capturing_cb = is_capturing.clone();

                let err_fn = move |err| {
                    eprintln!("[Mic/Android] stream error: {err}");
                };

                // Keep chunks reasonably sized for IPC (100ms at 16kHz * 2 bytes = 3200 bytes)
                const FLUSH_BYTES: usize = 3200;

                let stream = match sample_format {
                    cpal::SampleFormat::I16 => device
                        .build_input_stream(
                            &cfg,
                            move |data: &[i16], _| {
                                if !is_capturing_cb.load(Ordering::SeqCst) {
                                    return;
                                }
                                let pcm = convert_i16_to_pcm_s16le(data, channels, source_rate, TARGET_SAMPLE_RATE);
                                if pcm.is_empty() {
                                    return;
                                }
                                if let Ok(mut buf) = shared_buf_cb.lock() {
                                    buf.extend_from_slice(&pcm);
                                    if buf.len() >= FLUSH_BYTES {
                                        let out = std::mem::take(&mut *buf);
                                        let _ = sender_cb.send(out);
                                    }
                                }
                            },
                            err_fn,
                            None,
                        )
                        .map_err(|e| format!("build_input_stream(i16): {e}"))?,
                    cpal::SampleFormat::F32 => device
                        .build_input_stream(
                            &cfg,
                            move |data: &[f32], _| {
                                if !is_capturing_cb.load(Ordering::SeqCst) {
                                    return;
                                }
                                let pcm = convert_f32_to_pcm_s16le(data, channels, source_rate, TARGET_SAMPLE_RATE);
                                if pcm.is_empty() {
                                    return;
                                }
                                if let Ok(mut buf) = shared_buf_cb.lock() {
                                    buf.extend_from_slice(&pcm);
                                    if buf.len() >= FLUSH_BYTES {
                                        let out = std::mem::take(&mut *buf);
                                        let _ = sender_cb.send(out);
                                    }
                                }
                            },
                            err_fn,
                            None,
                        )
                        .map_err(|e| format!("build_input_stream(f32): {e}"))?,
                    other => {
                        return Err(format!("Unsupported sample format on Android mic: {other:?}"));
                    }
                };

                stream.play().map_err(|e| format!("stream.play: {e}"))?;
                let _ = ready_tx.send(Ok(()));

                // Run until stopped.
                while is_capturing.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }

                // Flush remaining buffer.
                if let Ok(mut buf) = shared_buf.lock() {
                    if !buf.is_empty() {
                        let out = std::mem::take(&mut *buf);
                        let _ = sender.send(out);
                    }
                }

                drop(stream);
                Ok(())
            })();

            if let Err(e) = result {
                let _ = ready_tx.send(Err(e));
            }
        });

        self.worker = Some(worker);

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(receiver),
            Ok(Err(e)) => {
                self.is_capturing.store(false, Ordering::SeqCst);
                self.worker.take().map(|h| h.join());
                Err(e)
            }
            Err(e) => {
                self.is_capturing.store(false, Ordering::SeqCst);
                self.worker.take().map(|h| h.join());
                Err(format!("Microphone worker failed to start: {e}"))
            }
        }
    }

    pub fn stop(&mut self) {
        self.is_capturing.store(false, Ordering::SeqCst);
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
    }
}

impl Default for MicCapture {
    fn default() -> Self {
        Self::new()
    }
}

fn convert_f32_to_pcm_s16le(data: &[f32], channels: usize, source_rate: u32, target_rate: u32) -> Vec<u8> {
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    };
    let resampled = if source_rate != target_rate {
        simple_resample(&mono, source_rate, target_rate)
    } else {
        mono
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

fn convert_i16_to_pcm_s16le(data: &[i16], channels: usize, source_rate: u32, target_rate: u32) -> Vec<u8> {
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| frame.iter().map(|&x| x as f32 / 32768.0).sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.iter().map(|&x| x as f32 / 32768.0).collect()
    };
    let resampled = if source_rate != target_rate {
        simple_resample(&mono, source_rate, target_rate)
    } else {
        mono
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

fn simple_resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() || from_rate == 0 || to_rate == 0 {
        return Vec::new();
    }
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = to_rate as f32 / from_rate as f32;
    let out_len = (samples.len() as f32 * ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_pos = i as f32 / ratio;
        let idx = src_pos.floor() as usize;
        let frac = src_pos - idx as f32;

        let a = *samples.get(idx).unwrap_or(&0.0);
        let b = *samples.get(idx + 1).unwrap_or(&a);
        out.push(a + (b - a) * frac);
    }
    out
}

// === Android System Audio (MediaProjection) ===

static SYSTEM_TX: OnceLock<mpsc::Sender<Vec<u8>>> = OnceLock::new();

pub struct SystemAudioCapture;

impl SystemAudioCapture {
    pub fn new() -> Self {
        Self
    }

    /// Returns a receiver that will get PCM s16le 16kHz mono frames from the Kotlin service.
    pub fn start(&self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let _ = SYSTEM_TX.set(tx);
        Ok(rx)
    }

    pub fn stop(&self) {
        // Best-effort stop on Android; also clears our sender so JNI drops data.
        let _ = stop_media_projection_service();
        // There's no stable way to "unset" OnceLock; dropping the service is what matters.
    }
}

pub fn request_media_projection() -> Result<(), String> {
    android_call_static_with_activity(
        "com/personal/translator/MediaProjectionActivity",
        "request",
        "(Landroid/app/Activity;)V",
    )
}

pub fn stop_media_projection_service() -> Result<(), String> {
    android_call_static_with_activity(
        "com/personal/translator/MediaProjectionService",
        "stop",
        "(Landroid/app/Activity;)V",
    )
}

#[cfg(target_os = "android")]
fn android_call_static_with_activity(
    class_path: &str,
    method: &str,
    sig: &str,
) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use jni::JavaVM;

    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm() as *mut jni::sys::JavaVM) }
        .map_err(|e| format!("Android VM: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("Android attach thread: {e}"))?;

    let activity = unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };
    let activity_global = env
        .new_global_ref(activity)
        .map_err(|e| format!("Android global ref: {e}"))?;

    let cls = env
        .find_class(class_path)
        .map_err(|e| format!("find_class({class_path}): {e}"))?;
    env.call_static_method(
        cls,
        method,
        sig,
        &[JValue::Object(activity_global.as_obj())],
    )
    .map_err(|e| format!("call_static_method({method}): {e}"))?;

    Ok(())
}

/// Called from Kotlin `MediaProjectionService` to push PCM bytes into Rust.
///
/// Signature must match: `com.personal.translator.MediaProjectionService.onPcmData(byte[], int)`
#[no_mangle]
pub extern "system" fn Java_com_personal_translator_MediaProjectionService_onPcmData(
    env: jni::JNIEnv,
    _class: jni::objects::JClass,
    data: jni::sys::jbyteArray,
    len: jni::sys::jint,
) {
    let Some(tx) = SYSTEM_TX.get() else {
        return;
    };
    if len <= 0 {
        return;
    }

    use jni::objects::JByteArray;

    let byte_len = len as usize;
    let arr = unsafe { JByteArray::from_raw(data) };
    let Ok(mut bytes) = env.convert_byte_array(arr) else {
        return;
    };

    // Kotlin always passes a scratch buffer; we only want the valid prefix.
    if bytes.len() > byte_len {
        bytes.truncate(byte_len);
    }

    let _ = tx.send(bytes);
}

