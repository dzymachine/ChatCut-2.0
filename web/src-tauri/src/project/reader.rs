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
    pub tracks: Vec<SerializedTrack>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Composition (canvas) settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Composition {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
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
}

/// A clip on the timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedClip {
    pub id: String,
    #[serde(rename = "type")]
    pub clip_type: String,
    pub source_file_path: String,
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
