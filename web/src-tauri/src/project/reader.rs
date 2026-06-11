use crate::error::ChatCutError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

// ─── On-Disk Project File Format ────────────────────────────────────────────

/// The top-level .chatcut file structure stored on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCutProjectFile {
    pub version: u32,
    pub app_version: String,
    pub saved_at: u64,
    pub project: SerializedProject,
}

/// The project data within a .chatcut file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedProject {
    pub id: String,
    pub name: String,
    pub composition: Composition,
    /// v2: the source-asset library. Empty for v1 files.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<SerializedAsset>,
    pub tracks: Vec<SerializedTrack>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// One imported source file (v2 format).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedAsset {
    pub id: String,
    /// Absolute native path. Empty for browser-mode assets.
    #[serde(default)]
    pub path: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
}

/// Composition (canvas) settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Composition {
    pub width: u32,
    pub height: u32,
    /// Fractional — source-matched rates like 59.94 are real since fps is
    /// probed from media (u32 here would fail to parse v2 files).
    pub fps: f64,
    pub duration: f64,
}

/// A track within the project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedTrack {
    pub id: String,
    #[serde(rename = "type")]
    pub track_type: String,
    pub label: String,
    pub clips: Vec<SerializedClip>,
    pub muted: bool,
    pub locked: bool,
    pub visible: bool,
    // Present since track gain/pan/solo landed; defaults keep old files
    // parseable AND prevent write-backs from dropping the fields.
    #[serde(default = "default_volume")]
    pub volume: f64,
    #[serde(default)]
    pub pan: f64,
    #[serde(default)]
    pub solo: bool,
}

fn default_volume() -> f64 {
    1.0
}

/// A clip on the timeline.
///
/// v2 clips carry `asset_id` into the project's assets[]; v1 clips (and clips
/// written by older MCP builds) embed type/path/name directly. All are
/// optional-with-default so BOTH formats parse; resolve via `assets` when the
/// embedded fields are empty.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedClip {
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub asset_id: String,
    #[serde(rename = "type", default, skip_serializing_if = "String::is_empty")]
    pub clip_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub source_file_path: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub source_file_name: String,
    pub source_start: f64,
    pub source_end: f64,
    pub timeline_start: f64,
    #[serde(default)]
    pub link_id: Option<String>,
    #[serde(default)]
    pub effects: Vec<AppliedEffect>,
    #[serde(default)]
    pub transitions: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipe: Option<crate::recipe::Recipe>,
}

impl SerializedClip {
    /// Duration of the clip on the timeline (source_end - source_start).
    pub fn duration(&self) -> f64 {
        self.source_end - self.source_start
    }

    /// End time of this clip on the timeline.
    pub fn timeline_end(&self) -> f64 {
        self.timeline_start + self.duration()
    }
}

/// An applied effect instance on a clip.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedEffect {
    pub id: String,
    pub effect_id: String,
    pub parameters: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub keyframes: Vec<EffectKeyframe>,
    pub enabled: bool,
}

/// A keyframe for effect animation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectKeyframe {
    pub time: f64,
    pub parameter_id: String,
    pub value: f64,
    pub interpolation: String,
}

// ─── Read/Write ─────────────────────────────────────────────────────────────

/// Read and parse a .chatcut project file from disk.
pub fn read_project(path: &Path) -> Result<ChatCutProjectFile, ChatCutError> {
    if !path.exists() {
        return Err(ChatCutError::ProjectNotFound(
            path.to_string_lossy().to_string(),
        ));
    }

    let contents = std::fs::read_to_string(path).map_err(ChatCutError::Io)?;

    let project_file: ChatCutProjectFile =
        serde_json::from_str(&contents).map_err(|e| ChatCutError::ProjectMalformed(e.to_string()))?;

    Ok(project_file)
}

/// Write a project file back to disk.
pub fn write_project(path: &Path, project_file: &ChatCutProjectFile) -> Result<(), ChatCutError> {
    let json = serde_json::to_string_pretty(project_file).map_err(ChatCutError::Json)?;
    std::fs::write(path, json).map_err(ChatCutError::Io)?;
    Ok(())
}
