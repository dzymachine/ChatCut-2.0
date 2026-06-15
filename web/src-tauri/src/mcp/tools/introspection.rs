use crate::error::ChatCutError;
use crate::project::{ChatCutProjectFile, SerializedClip};
use serde::Serialize;
use std::collections::HashSet;

/// Timeline state summary returned by get_timeline_state.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineState {
    pub composition: CompositionInfo,
    pub tracks: Vec<TrackInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub id: String,
    pub track_type: String,
    pub label: String,
    pub clip_count: usize,
    pub clips: Vec<ClipInfo>,
    pub muted: bool,
    pub locked: bool,
    pub visible: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipInfo {
    pub id: String,
    pub clip_type: String,
    pub source_file_name: String,
    pub source_file_path: String,
    pub source_start: f64,
    pub source_end: f64,
    pub timeline_start: f64,
    pub timeline_end: f64,
    pub duration: f64,
    pub effect_count: usize,
}

/// Media library entry.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEntry {
    pub file_path: String,
    pub file_name: String,
    pub clip_type: String,
}

/// Get the full timeline state from a project file.
///
/// v2 clips reference assets by id (no embedded path/name/type) — resolve
/// those fields through the project's assets[] so the LLM always sees them.
pub fn get_timeline_state(project_file: &ChatCutProjectFile) -> TimelineState {
    let project = &project_file.project;
    let asset_by_id: std::collections::HashMap<&str, &crate::project::SerializedAsset> =
        project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    TimelineState {
        composition: CompositionInfo {
            width: project.composition.width,
            height: project.composition.height,
            fps: project.composition.fps,
            duration: project.composition.duration,
        },
        tracks: project
            .tracks
            .iter()
            .map(|track| TrackInfo {
                id: track.id.clone(),
                track_type: track.track_type.clone(),
                label: track.label.clone(),
                clip_count: track.clips.len(),
                clips: track
                    .clips
                    .iter()
                    .map(|clip| {
                        let asset = asset_by_id.get(clip.asset_id.as_str());
                        let clip_type = if !clip.clip_type.is_empty() {
                            clip.clip_type.clone()
                        } else if track.track_type == "audio" {
                            "audio".to_string()
                        } else {
                            asset.map(|a| a.kind.clone()).unwrap_or_else(|| "video".to_string())
                        };
                        ClipInfo {
                            id: clip.id.clone(),
                            clip_type,
                            source_file_name: if clip.source_file_name.is_empty() {
                                asset.map(|a| a.name.clone()).unwrap_or_default()
                            } else {
                                clip.source_file_name.clone()
                            },
                            source_file_path: if clip.source_file_path.is_empty() {
                                asset.map(|a| a.path.clone()).unwrap_or_default()
                            } else {
                                clip.source_file_path.clone()
                            },
                            source_start: clip.source_start,
                            source_end: clip.source_end,
                            timeline_start: clip.timeline_start,
                            timeline_end: clip.timeline_end(),
                            duration: clip.duration(),
                            effect_count: clip.effects.len(),
                        }
                    })
                    .collect(),
                muted: track.muted,
                locked: track.locked,
                visible: track.visible,
            })
            .collect(),
    }
}

/// Get the media library.
///
/// v2 projects carry an explicit assets[] — return it directly. v1 projects
/// fall back to scanning unique source paths off clips.
pub fn get_media_library(project_file: &ChatCutProjectFile) -> Vec<MediaEntry> {
    if !project_file.project.assets.is_empty() {
        return project_file
            .project
            .assets
            .iter()
            .map(|a| MediaEntry {
                file_path: a.path.clone(),
                file_name: a.name.clone(),
                clip_type: a.kind.clone(),
            })
            .collect();
    }

    let mut seen = HashSet::new();
    let mut entries = Vec::new();

    for track in &project_file.project.tracks {
        for clip in &track.clips {
            if !clip.source_file_path.is_empty() && seen.insert(clip.source_file_path.clone()) {
                entries.push(MediaEntry {
                    file_path: clip.source_file_path.clone(),
                    file_name: clip.source_file_name.clone(),
                    clip_type: clip.clip_type.clone(),
                });
            }
        }
    }

    entries
}

/// Find a clip that overlaps the given time position (in seconds).
pub fn get_clip_at_time(
    project_file: &ChatCutProjectFile,
    time: f64,
) -> Result<Option<ClipAtTimeResult>, ChatCutError> {
    if time < 0.0 {
        return Err(ChatCutError::InvalidParams(
            "Time must be non-negative".to_string(),
        ));
    }

    for track in &project_file.project.tracks {
        for clip in &track.clips {
            if clip.timeline_start <= time && clip.timeline_end() > time {
                return Ok(Some(ClipAtTimeResult {
                    clip: clip.clone(),
                    track_id: track.id.clone(),
                    track_label: track.label.clone(),
                }));
            }
        }
    }

    Ok(None)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipAtTimeResult {
    pub clip: SerializedClip,
    pub track_id: String,
    pub track_label: String,
}
