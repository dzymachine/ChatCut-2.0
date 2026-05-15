use serde::Serialize;
use std::process::Command;

use crate::error::ChatCutError;

/// Summary info for a single FFmpeg filter, parsed from `ffmpeg -filters`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterInfo {
    pub name: String,
    pub io_type: String,
    pub description: String,
    pub supports_timeline: bool,
    pub supports_slice: bool,
    pub supports_commands: bool,
}

/// Detailed info for a single filter, parsed from `ffmpeg -h filter=<name>`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterDetail {
    pub name: String,
    pub description: String,
    pub parameters: Vec<FilterParamInfo>,
}

/// A parameter of an FFmpeg filter.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterParamInfo {
    pub name: String,
    pub param_type: String,
    pub description: String,
    pub default: Option<String>,
    pub min: Option<String>,
    pub max: Option<String>,
}

/// Probe all available filters by running `ffmpeg -filters`.
pub fn probe_filters() -> Result<Vec<FilterInfo>, ChatCutError> {
    let output = Command::new("ffmpeg")
        .args(["-filters", "-hide_banner"])
        .output()
        .map_err(|e| ChatCutError::InvalidParams(format!("Failed to run ffmpeg: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ChatCutError::InvalidParams(format!(
            "ffmpeg -filters failed: {}",
            stderr.lines().last().unwrap_or("unknown error")
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_filters_output(&stdout))
}

/// Parse the output of `ffmpeg -filters -hide_banner`.
fn parse_filters_output(output: &str) -> Vec<FilterInfo> {
    let mut filters = Vec::new();
    let mut in_list = false;

    for line in output.lines() {
        let trimmed = line.trim();

        // Skip header lines until we see the separator or first filter entry
        if !in_list {
            if trimmed.starts_with("---") || trimmed.starts_with("...") || trimmed.starts_with("T..")
                || trimmed.starts_with(".S.") || trimmed.starts_with("..C")
            {
                // Could be flags legend or first filter
                if trimmed.len() > 3 && !trimmed.contains("Timeline") && !trimmed.contains("Slice") && !trimmed.contains("Command") {
                    in_list = true;
                } else {
                    continue;
                }
            } else {
                continue;
            }
        }

        if !in_list && trimmed.is_empty() {
            continue;
        }

        // Each filter line:  " TSC name           A->A       Description text"
        // Flags are 3 chars starting at column 1, then whitespace, then name, then type, then description
        if trimmed.len() < 4 {
            continue;
        }

        let flags = &trimmed[..3];
        let rest = trimmed[3..].trim();

        // Split rest into: name, io_type, description
        let parts: Vec<&str> = rest.splitn(3, char::is_whitespace).collect();
        if parts.len() < 2 {
            continue;
        }

        let name = parts[0].trim().to_string();
        if name.is_empty() || name.starts_with('-') {
            continue;
        }

        // The remaining text has io_type and description
        let after_name = rest[name.len()..].trim();
        let (io_type, description) = if let Some(pos) = after_name.find(|c: char| c.is_whitespace()) {
            let io = after_name[..pos].trim().to_string();
            let desc = after_name[pos..].trim().to_string();
            (io, desc)
        } else {
            (after_name.to_string(), String::new())
        };

        // Strip trailing period from description
        let description = description.trim_end_matches('.').to_string();

        filters.push(FilterInfo {
            name,
            io_type,
            description,
            supports_timeline: flags.contains('T'),
            supports_slice: flags.contains('S'),
            supports_commands: flags.contains('C'),
        });

        in_list = true;
    }

    filters
}

/// Get detailed parameter info for a specific filter by running `ffmpeg -h filter=<name>`.
pub fn probe_filter_detail(name: &str) -> Result<FilterDetail, ChatCutError> {
    // Reject filter names with shell-unsafe characters
    if name.contains(|c: char| !c.is_alphanumeric() && c != '_') {
        return Err(ChatCutError::InvalidParams(format!(
            "Invalid filter name: {}",
            name
        )));
    }

    let output = Command::new("ffmpeg")
        .args(["-h", &format!("filter={}", name), "-hide_banner"])
        .output()
        .map_err(|e| ChatCutError::InvalidParams(format!("Failed to run ffmpeg: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // FFmpeg outputs help to stdout; "No filter found" goes to stderr
    if stdout.trim().is_empty() || stderr.contains("Unknown filter") || stderr.contains("No such filter") {
        return Err(ChatCutError::InvalidParams(format!(
            "Filter not found: {}",
            name
        )));
    }

    Ok(parse_filter_help(name, &stdout))
}

/// Parse the output of `ffmpeg -h filter=<name>`.
fn parse_filter_help(name: &str, output: &str) -> FilterDetail {
    let mut description = String::new();
    let mut parameters = Vec::new();

    let mut in_options = false;

    for line in output.lines() {
        let trimmed = line.trim();

        // First non-empty line after "Filter <name>" is the description
        if description.is_empty() && !trimmed.is_empty() && !trimmed.starts_with("Filter") {
            description = trimmed.to_string();
            continue;
        }

        // Option lines look like:
        //   param_name        <type>      ..FV....... Description (default value)
        if trimmed.contains("..FV") || trimmed.contains("..FA") || trimmed.contains("..F.") {
            in_options = true;

            // Parse: name <type> flags description
            let parts: Vec<&str> = trimmed.splitn(2, '<').collect();
            if parts.len() < 2 {
                continue;
            }

            let param_name = parts[0].trim().to_string();
            if param_name.is_empty() {
                continue;
            }

            let rest = parts[1];
            let type_end = rest.find('>').unwrap_or(rest.len());
            let param_type = rest[..type_end].to_string();

            // Extract description and default from after the flags
            let after_type = &rest[type_end + 1..];
            let (desc, default_val, min_val, max_val) = parse_param_metadata(after_type);

            parameters.push(FilterParamInfo {
                name: param_name,
                param_type,
                description: desc,
                default: default_val,
                min: min_val,
                max: max_val,
            });
        } else if in_options && trimmed.is_empty() {
            // End of options section
            in_options = false;
        }
    }

    FilterDetail {
        name: name.to_string(),
        description,
        parameters,
    }
}

/// Parse description, default, min, max from the rest of a parameter line.
fn parse_param_metadata(s: &str) -> (String, Option<String>, Option<String>, Option<String>) {
    // After flags like "..FV.......", the rest is "Description text (from X to Y) (default value)"
    let s = s.trim();

    // Strip flags prefix (dots and letters)
    let s = s.trim_start_matches(|c: char| c == '.' || c.is_ascii_uppercase());
    let s = s.trim();

    let mut default_val = None;
    let mut min_val = None;
    let mut max_val = None;
    let mut desc = s.to_string();

    // Extract (default X)
    if let Some(idx) = desc.rfind("(default ") {
        let rest = &desc[idx + 9..];
        if let Some(end) = rest.find(')') {
            default_val = Some(rest[..end].to_string());
            desc = desc[..idx].trim().to_string();
        }
    }

    // Extract (from X to Y)
    if let Some(idx) = desc.find("(from ") {
        let rest = &desc[idx + 6..];
        if let Some(to_idx) = rest.find(" to ") {
            min_val = Some(rest[..to_idx].to_string());
            if let Some(end) = rest[to_idx + 4..].find(')') {
                max_val = Some(rest[to_idx + 4..to_idx + 4 + end].to_string());
            }
            desc = desc[..idx].trim().to_string();
        }
    }

    (desc, default_val, min_val, max_val)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_filters_output() {
        let sample = r#"Filters:
  T.. = Timeline support
  .S. = Slice threading
  ..C = Command support
  A = Audio input/output
  V = Video input/output
  N = Dynamic number and/or type of input/output
  | = Source or sink filter
 ... acompressor       A->A       Audio compressor.
 T.. colorbalance      V->V       Adjust the color balance.
 TSC eq                V->V       Adjust brightness, contrast, gamma, and saturation.
 ... overlay           VV->V      Overlay a video source on top of the input.
"#;

        let filters = parse_filters_output(sample);
        assert_eq!(filters.len(), 4);

        assert_eq!(filters[0].name, "acompressor");
        assert_eq!(filters[0].io_type, "A->A");
        assert!(!filters[0].supports_timeline);

        assert_eq!(filters[1].name, "colorbalance");
        assert!(filters[1].supports_timeline);
        assert!(!filters[1].supports_slice);

        assert_eq!(filters[2].name, "eq");
        assert!(filters[2].supports_timeline);
        assert!(filters[2].supports_slice);
        assert!(filters[2].supports_commands);
    }
}
