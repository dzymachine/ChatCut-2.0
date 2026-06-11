use crate::error::ChatCutError;
use crate::project::{AppliedEffect, ChatCutProjectFile, SerializedClip};
use std::path::Path;

/// Check if the ChatCut app is currently running by looking for a lock file.
pub fn check_app_lock(app_data_dir: &Path) -> Result<(), ChatCutError> {
    let lock_path = app_data_dir.join("chatcut.lock");
    if lock_path.exists() {
        return Err(ChatCutError::AppInstanceLocked);
    }
    Ok(())
}

#[allow(dead_code)]
pub fn add_clip(
    project_file: &mut ChatCutProjectFile,
    source_file_path: String,
    source_file_name: String,
    clip_type: String,
    track_id: Option<String>,
    timeline_start: Option<f64>,
    source_end: f64,
) -> Result<SerializedClip, ChatCutError> {
    let target_track = match &track_id {
        Some(id) => project_file
            .project
            .tracks
            .iter_mut()
            .find(|t| t.id == *id)
            .ok_or_else(|| ChatCutError::InvalidParams(format!("Track not found: {}", id)))?,
        None => project_file
            .project
            .tracks
            .iter_mut()
            .find(|t| t.track_type == "video")
            .ok_or_else(|| {
                ChatCutError::InvalidParams("No video track found in project".to_string())
            })?,
    };

    let clip = SerializedClip {
        id: uuid::Uuid::new_v4().to_string(),
        // Written path-style (legacy clip fields); the TS loader resolves
        // these into the asset library on next open.
        asset_id: String::new(),
        clip_type,
        source_file_path,
        source_file_name,
        source_start: 0.0,
        source_end,
        timeline_start: timeline_start.unwrap_or(0.0),
        link_id: None,
        effects: vec![],
        transitions: vec![],
        recipe: None,
    };

    target_track.clips.push(clip.clone());
    Ok(clip)
}

pub fn remove_clip(
    project_file: &mut ChatCutProjectFile,
    clip_id: &str,
) -> Result<(), ChatCutError> {
    for track in &mut project_file.project.tracks {
        if let Some(pos) = track.clips.iter().position(|c| c.id == clip_id) {
            track.clips.remove(pos);
            return Ok(());
        }
    }
    Err(ChatCutError::InvalidParams(format!(
        "Clip not found: {}",
        clip_id
    )))
}

pub fn trim_clip(
    project_file: &mut ChatCutProjectFile,
    clip_id: &str,
    source_start: Option<f64>,
    source_end: Option<f64>,
) -> Result<(), ChatCutError> {
    let clip = find_clip_mut(project_file, clip_id)?;

    if let Some(start) = source_start {
        let delta = start - clip.source_start;
        clip.source_start = start;
        clip.timeline_start += delta;
    }

    if let Some(end) = source_end {
        clip.source_end = end;
    }

    Ok(())
}

pub fn move_clip(
    project_file: &mut ChatCutProjectFile,
    clip_id: &str,
    timeline_start: f64,
    track_id: Option<&str>,
) -> Result<(), ChatCutError> {
    if let Some(target_track_id) = track_id {
        // Move to a different track: remove from current, add to target
        let mut removed_clip = None;
        for track in &mut project_file.project.tracks {
            if let Some(pos) = track.clips.iter().position(|c| c.id == clip_id) {
                removed_clip = Some(track.clips.remove(pos));
                break;
            }
        }

        let mut clip =
            removed_clip.ok_or_else(|| ChatCutError::InvalidParams(format!("Clip not found: {}", clip_id)))?;
        clip.timeline_start = timeline_start;

        let target = project_file
            .project
            .tracks
            .iter_mut()
            .find(|t| t.id == target_track_id)
            .ok_or_else(|| {
                ChatCutError::InvalidParams(format!("Target track not found: {}", target_track_id))
            })?;
        target.clips.push(clip);
    } else {
        let clip = find_clip_mut(project_file, clip_id)?;
        clip.timeline_start = timeline_start;
    }

    Ok(())
}

pub fn apply_effect(
    project_file: &mut ChatCutProjectFile,
    clip_id: &str,
    effect_id: &str,
    parameters: std::collections::HashMap<String, serde_json::Value>,
) -> Result<AppliedEffect, ChatCutError> {
    let clip = find_clip_mut(project_file, clip_id)?;

    let applied = AppliedEffect {
        id: uuid::Uuid::new_v4().to_string(),
        effect_id: effect_id.to_string(),
        parameters,
        keyframes: vec![],
        enabled: true,
    };

    clip.effects.push(applied.clone());
    Ok(applied)
}

pub fn update_effect_param(
    project_file: &mut ChatCutProjectFile,
    clip_id: &str,
    applied_effect_id: &str,
    parameters: std::collections::HashMap<String, serde_json::Value>,
) -> Result<(), ChatCutError> {
    let clip = find_clip_mut(project_file, clip_id)?;

    let effect = clip
        .effects
        .iter_mut()
        .find(|e| e.id == applied_effect_id)
        .ok_or_else(|| {
            ChatCutError::InvalidParams(format!("Effect not found: {}", applied_effect_id))
        })?;

    for (key, value) in parameters {
        effect.parameters.insert(key, value);
    }

    Ok(())
}

pub fn attach_recipe(
    project_file: &mut ChatCutProjectFile,
    clip_id: &str,
    recipe: crate::recipe::Recipe,
) -> Result<String, ChatCutError> {
    let filter_string = crate::recipe::compile_recipe(&recipe)
        .map_err(|e| ChatCutError::InvalidParams(format!("Recipe compilation failed: {}", e)))?;

    let clip = find_clip_mut(project_file, clip_id)?;
    clip.recipe = Some(recipe);

    Ok(filter_string)
}

fn find_clip_mut<'a>(
    project_file: &'a mut ChatCutProjectFile,
    clip_id: &str,
) -> Result<&'a mut SerializedClip, ChatCutError> {
    for track in &mut project_file.project.tracks {
        if let Some(clip) = track.clips.iter_mut().find(|c| c.id == clip_id) {
            return Ok(clip);
        }
    }
    Err(ChatCutError::InvalidParams(format!(
        "Clip not found: {}",
        clip_id
    )))
}
