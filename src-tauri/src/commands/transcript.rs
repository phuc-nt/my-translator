use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use chrono::Local;
use serde::Serialize;

/// Get the transcript directory path
fn transcript_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("transcripts");

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create transcript dir: {}", e))?;
    Ok(dir)
}

/// Save a complete transcript session to a timestamped file
/// Called when user clicks "Clear", stops recording, or closes app
#[tauri::command]
pub fn save_transcript(app: AppHandle, content: String) -> Result<String, String> {
    let dir = transcript_dir(&app)?;
    let now = Local::now();
    let filename = format!("{}.md", now.format("%Y-%m-%d_%H-%M-%S"));
    let filepath = dir.join(&filename);

    fs::write(&filepath, content)
        .map_err(|e| format!("Failed to save transcript: {}", e))?;

    Ok(filepath.to_string_lossy().to_string())
}

/// Open the transcript directory in the system file manager
/// macOS: Finder, Windows: Explorer
#[tauri::command]
pub fn open_transcript_dir(app: AppHandle) -> Result<(), String> {
    let dir = transcript_dir(&app)?;

    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";

    std::process::Command::new(cmd)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Failed to open transcript dir: {}", e))?;
    Ok(())
}

#[derive(Serialize)]
pub struct TranscriptEntry {
    filename: String,
    path: String,
    created_at: String,
    size_bytes: u64,
}

/// List all saved transcript sessions, newest first
#[tauri::command]
pub fn list_transcripts(app: AppHandle) -> Result<Vec<TranscriptEntry>, String> {
    let dir = transcript_dir(&app)?;

    let mut entries: Vec<TranscriptEntry> = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read transcript dir: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let filename = entry.file_name().to_string_lossy().to_string();
            if !filename.ends_with(".md") {
                return None;
            }
            let path = entry.path().to_string_lossy().to_string();
            let size_bytes = entry.metadata().ok()?.len();
            // Parse created_at from filename: YYYY-MM-DD_HH-MM-SS.md
            let _created_at = filename
                .strip_suffix(".md")
                .unwrap_or(&filename)
                .replace('_', " ")
                .replace('-', ":")
                // Fix date separator: first two colons are date separators
                // Transform "2026:03:27 10:21:05" → "2026-03-27 10:21:05"
                .to_string();
            // More accurate: split on space, fix date part
            let created_at = {
                let base = filename.strip_suffix(".md").unwrap_or(&filename);
                // base = "2026-03-27_10-21-05"
                let parts: Vec<&str> = base.splitn(2, '_').collect();
                if parts.len() == 2 {
                    let time_part = parts[1].replace('-', ":");
                    format!("{} {}", parts[0], time_part)
                } else {
                    base.to_string()
                }
            };
            Some(TranscriptEntry {
                filename,
                path,
                created_at,
                size_bytes,
            })
        })
        .collect();

    // Sort by filename descending (newest first — filenames are timestamps)
    entries.sort_by(|a, b| b.filename.cmp(&a.filename));

    Ok(entries)
}

/// Read the content of a saved transcript file
#[tauri::command]
pub fn read_transcript(app: AppHandle, filename: String) -> Result<String, String> {
    // Sanitize: no path traversal
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid filename".to_string());
    }
    let dir = transcript_dir(&app)?;
    let filepath = dir.join(&filename);
    fs::read_to_string(&filepath)
        .map_err(|e| format!("Failed to read transcript: {}", e))
}

/// Delete a saved transcript file
#[tauri::command]
pub fn delete_transcript(app: AppHandle, filename: String) -> Result<(), String> {
    // Sanitize: no path traversal, and require transcript files only
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid filename".to_string());
    }
    if !filename.ends_with(".md") {
        return Err("Invalid filename".to_string());
    }

    let dir = transcript_dir(&app)?;
    let filepath = dir.join(&filename);

    match fs::remove_file(&filepath) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete transcript: {}", e)),
    }
}
