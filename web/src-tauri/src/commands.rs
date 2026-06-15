use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::shared::extensions::{AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS};

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

    Ok(FileMetadata {
        name: file_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: file_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        extension: extension.clone(),
        is_video: VIDEO_EXTENSIONS.contains(&extension.as_str()),
        is_audio: AUDIO_EXTENSIONS.contains(&extension.as_str()),
    })
}

/// List all media files in a directory
#[tauri::command]
pub fn list_media_files(directory: String) -> Result<Vec<FileMetadata>, String> {
    let dir_path = PathBuf::from(&directory);

    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", directory));
    }

    let media_extensions: Vec<&str> = VIDEO_EXTENSIONS
        .iter()
        .chain(AUDIO_EXTENSIONS)
        .chain(IMAGE_EXTENSIONS)
        .copied()
        .collect();

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

                files.push(FileMetadata {
                    name: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                    path: path.to_string_lossy().to_string(),
                    size_bytes: metadata.len(),
                    extension: ext.clone(),
                    is_video: VIDEO_EXTENSIONS.contains(&ext.as_str()),
                    is_audio: AUDIO_EXTENSIONS.contains(&ext.as_str()),
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

// ─── FFmpeg Filter Catalog Commands ──────────────────────────────────

#[tauri::command]
pub fn list_filter_categories() -> Result<serde_json::Value, String> {
    let cats = crate::ffmpeg::catalog::list_categories().map_err(|e| e.to_string())?;
    serde_json::to_value(cats).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_filters(category: Option<String>, query: Option<String>) -> Result<serde_json::Value, String> {
    let filters = crate::ffmpeg::catalog::list_filters(
        category.as_deref(),
        query.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    serde_json::to_value(filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn describe_filter(filter_name: String) -> Result<serde_json::Value, String> {
    let detail = crate::ffmpeg::catalog::describe_filter(&filter_name).map_err(|e| e.to_string())?;
    serde_json::to_value(detail).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn validate_recipe(recipe: crate::recipe::Recipe) -> Result<serde_json::Value, String> {
    match crate::recipe::validator::validate_recipe_dryrun(&recipe) {
        Ok(filter_string) => Ok(serde_json::json!({
            "valid": true,
            "filterString": filter_string,
        })),
        Err(e) => Ok(serde_json::json!({
            "valid": false,
            "error": e.to_string(),
        })),
    }
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

/// One available .cube LUT file.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LutEntry {
    pub name: String,
    pub path: String,
}

/// List available 3D LUTs: shipped seeds (bundled resources) plus any
/// user-supplied .cube files in <app-data>/luts/.
#[tauri::command]
pub fn list_luts(app_handle: tauri::AppHandle) -> Result<Vec<LutEntry>, String> {
    use tauri::Manager;

    fn scan(dir: std::path::PathBuf, entries: &mut Vec<LutEntry>) {
        if let Ok(read) = std::fs::read_dir(&dir) {
            for e in read.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some("cube") {
                    if let Some(stem) = p.file_stem().and_then(|x| x.to_str()) {
                        entries.push(LutEntry {
                            name: stem.to_string(),
                            path: p.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    let mut entries: Vec<LutEntry> = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        scan(resource_dir.join("luts"), &mut entries);
    }
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        scan(app_data.join("luts"), &mut entries);
    }

    // Dev fallback: in `tauri dev` the resource dir may not include the
    // bundle resources yet — scan the source luts/ dir next to Cargo.toml.
    if entries.is_empty() {
        scan(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("luts"),
            &mut entries,
        );
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries.dedup_by(|a, b| a.name == b.name);
    Ok(entries)
}
