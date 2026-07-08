mod audio;
mod commands;
mod settings;

use audio::microphone::MicCapture;
use audio::SystemAudioCapture;
use commands::audio::AudioState;
use commands::local_pipeline::LocalPipelineState;
use commands::local_tts::LocalTtsState;
use commands::openai_realtime::OpenAiState;
use commands::qwen_realtime::QwenState;
use settings::{Settings, SettingsState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

// Set once the frontend has flushed the session (or the exit deadline elapsed),
// so the ExitRequested handler stops preventing exit and the app can quit.
static EXIT_ALLOWED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn get_platform_info() -> String {
    format!(
        r#"{{"os":"{}","arch":"{}","version":"0.3.0"}}"#,
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

// Called by the frontend after it has flushed the session on exit. Force-exits
// the process; the flag keeps a subsequent ExitRequested from being prevented.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    EXIT_ALLOWED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load settings from disk (or defaults)
    let initial_settings = Settings::load();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            // Dev builds (compiled with the `devtools` feature): auto-open the WebView
            // inspector so JS/console errors are visible. Never compiled into release.
            #[cfg(feature = "devtools")]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    win.open_devtools();
                }
            }
            Ok(())
        })
        .manage(SettingsState(Mutex::new(initial_settings)))
        .manage(AudioState {
            system_audio: Mutex::new(SystemAudioCapture::new()),
            microphone: Mutex::new(MicCapture::new()),
            active_receiver: Mutex::new(None),
        })
        .manage(LocalPipelineState {
            process: Mutex::new(None),
        })
        .manage(LocalTtsState::default())
        .manage(OpenAiState::default())
        .manage(QwenState::default())
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::audio::start_capture,
            commands::audio::stop_capture,
            commands::audio::check_permissions,
            commands::transcript::save_transcript,
            commands::transcript::open_transcript_dir,
            commands::transcript::list_transcripts,
            commands::transcript::read_transcript,
            commands::session_store::save_session,
            commands::session_store::list_sessions,
            commands::session_store::read_session,
            commands::session_store::read_legacy_session,
            commands::session_store::delete_session,
            commands::session_store::update_session_title,
            commands::session_store::export_session_srt,
            commands::session_store::export_session_txt,
            commands::session_store::search_sessions,
            commands::local_pipeline::start_local_pipeline,
            commands::local_pipeline::send_audio_to_pipeline,
            commands::local_pipeline::stop_local_pipeline,
            commands::local_pipeline::check_mlx_setup,
            commands::local_pipeline::run_mlx_setup,
            commands::edge_tts::edge_tts_speak,
            commands::microsoft_tts::microsoft_list_voices,
            commands::google_free_tts::google_free_tts_speak,
            commands::tiktok_tts::tiktok_tts_speak,
            commands::local_tts::local_tts_speak,
            commands::local_tts::local_tts_list_models,
            commands::local_tts::local_tts_models_dir_path,
            commands::local_tts::local_tts_download_model,
            commands::local_tts::local_tts_delete_model,
            commands::openai_realtime::openai_realtime_start,
            commands::openai_realtime::openai_realtime_send_audio,
            commands::openai_realtime::openai_realtime_stop,
            commands::qwen_realtime::qwen_realtime_start,
            commands::qwen_realtime::qwen_realtime_send_audio,
            commands::qwen_realtime::qwen_realtime_stop,
            get_platform_info,
            exit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Cmd+Q and Dock → Quit fire app-level ExitRequested (not the
            // window's onCloseRequested). Prevent the first exit, ask the
            // frontend to flush the session, and force-exit after a deadline so
            // a hung flush can never make the app unquittable.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !EXIT_ALLOWED.load(Ordering::SeqCst) {
                    use tauri::{Emitter, Manager};
                    api.prevent_exit();
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.emit("app-exit-requested", ());
                    }
                    let handle = app_handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        EXIT_ALLOWED.store(true, Ordering::SeqCst);
                        handle.exit(0);
                    });
                }
            }
        });
}
