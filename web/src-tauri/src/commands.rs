use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// Metadata about a media file on disk
#[derive(Debug, Serialize, Deserialize)]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub extension: String,
    pub is_video: bool,
    pub is_audio: bool,
}

/// Get metadata for a file at the given path
#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;

    let extension = file_path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    let video_extensions = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "flv", "wmv"];
    let audio_extensions = ["mp3", "wav", "aac", "flac", "ogg", "m4a", "wma"];

    Ok(FileMetadata {
        name: file_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: file_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        extension: extension.clone(),
        is_video: video_extensions.contains(&extension.as_str()),
        is_audio: audio_extensions.contains(&extension.as_str()),
    })
}

/// List all media files in a directory
#[tauri::command]
pub fn list_media_files(directory: String) -> Result<Vec<FileMetadata>, String> {
    let dir_path = PathBuf::from(&directory);

    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", directory));
    }

    let media_extensions = [
        "mp4", "mov", "avi", "mkv", "webm", "m4v", "flv", "wmv", "mp3", "wav", "aac", "flac",
        "ogg", "m4a", "wma", "png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp",
    ];

    let mut files = Vec::new();

    let entries = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_file() {
            let ext = path
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();

            if media_extensions.contains(&ext.as_str()) {
                let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                let video_extensions = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "flv", "wmv"];
                let audio_extensions = ["mp3", "wav", "aac", "flac", "ogg", "m4a", "wma"];

                files.push(FileMetadata {
                    name: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                    path: path.to_string_lossy().to_string(),
                    size_bytes: metadata.len(),
                    extension: ext.clone(),
                    is_video: video_extensions.contains(&ext.as_str()),
                    is_audio: audio_extensions.contains(&ext.as_str()),
                });
            }
        }
    }

    Ok(files)
}

/// Get the app data directory path
#[tauri::command]
pub fn get_app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Check if FFmpeg is available on the system
#[tauri::command]
pub fn check_ffmpeg() -> Result<String, String> {
    let output = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map_err(|_| "FFmpeg not found. Please install FFmpeg to enable video export.".to_string())?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout);
        let first_line = version.lines().next().unwrap_or("FFmpeg found");
        Ok(first_line.to_string())
    } else {
        Err("FFmpeg found but returned an error.".to_string())
    }
}
