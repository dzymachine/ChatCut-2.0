use std::process::Command;

use crate::error::ChatCutError;
use super::compile_recipe;
use super::Recipe;

/// Validate a recipe by compiling it and running an FFmpeg dry-run.
///
/// Uses `ffmpeg -f lavfi -i nullsrc=s=320x240:d=0.1 -vf <filters> -f null -t 0.1 -`
/// to check whether the filter string is accepted by the installed FFmpeg.
pub fn validate_recipe_dryrun(recipe: &Recipe) -> Result<String, ChatCutError> {
    let filter_string = compile_recipe(recipe)
        .map_err(|e| ChatCutError::InvalidParams(format!("Recipe compilation failed: {}", e)))?;

    if filter_string.is_empty() {
        return Err(ChatCutError::InvalidParams("Recipe compiles to an empty filter chain".to_string()));
    }

    let output = Command::new("ffmpeg")
        .args([
            "-f", "lavfi",
            "-i", "nullsrc=s=320x240:d=0.1",
            "-vf", &filter_string,
            "-f", "null",
            "-t", "0.1",
            "-",
        ])
        .output()
        .map_err(|e| ChatCutError::InvalidParams(format!("Failed to run ffmpeg: {}", e)))?;

    if output.status.success() {
        Ok(filter_string)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(ChatCutError::InvalidParams(format!(
            "FFmpeg rejected filter chain \"{}\": {}",
            filter_string,
            stderr.lines().last().unwrap_or("unknown error")
        )))
    }
}
