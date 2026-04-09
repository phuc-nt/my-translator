mod audio;
mod commands;
mod db;
mod secrets;
mod services;
mod settings;

use audio::MicCapture;
use audio::SystemAudioCapture;
use commands::audio::AudioState;
use commands::local_pipeline::LocalPipelineState;
use settings::{Settings, SettingsState};
use db::InterviewDb;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn get_platform_info() -> String {
    format!(
        r#"{{"os":"{}","arch":"{}","version":"0.3.0"}}"#,
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    eprintln!("[boot] myjavis starting...");
    // Load settings from disk (or defaults)
    let initial_settings = Settings::load();

    tauri::Builder::default()
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
        })
        .manage(LocalPipelineState {
            process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
