pub mod tools;
pub mod transport;

use crate::project::{read_project, write_project, ChatCutProjectFile};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{ServerCapabilities, ServerInfo};
use rmcp::{tool, tool_handler, tool_router, ServerHandler};
use schemars::JsonSchema;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

// ─── Parameter Structs ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ClipAtTimeParams {
    /// Time position in seconds to query.
    pub time: f64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RemoveClipParams {
    /// ID of the clip to remove.
    pub clip_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TrimClipParams {
    /// ID of the clip to trim.
    pub clip_id: String,
    /// New source start time in seconds.
    pub source_start: Option<f64>,
    /// New source end time in seconds.
    pub source_end: Option<f64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MoveClipParams {
    /// ID of the clip to move.
    pub clip_id: String,
    /// New start time on the timeline in seconds.
    pub timeline_start: f64,
    /// Target track ID (optional — stays on current track if omitted).
    pub track_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ApplyEffectParams {
    /// ID of the clip.
    pub clip_id: String,
    /// Effect identifier from the registry (e.g. "gaussian_blur", "brightness").
    pub effect_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateEffectParams {
    /// ID of the clip.
    pub clip_id: String,
    /// ID of the applied effect instance.
    pub applied_effect_id: String,
    /// Parameter name.
    pub param_name: String,
    /// New parameter value.
    pub param_value: f64,
}

// ─── Server ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct ChatCutMcpServer {
    project_path: Option<PathBuf>,
    app_data_dir: PathBuf,
    tool_router: ToolRouter<Self>,
}

impl ChatCutMcpServer {
    pub fn new(project_path: Option<PathBuf>, app_data_dir: PathBuf) -> Self {
        Self {
            project_path,
            app_data_dir,
            tool_router: Self::tool_router(),
        }
    }

    fn load_project(&self) -> Result<ChatCutProjectFile, String> {
        let path = self
            .project_path
            .as_ref()
            .ok_or_else(|| {
                "No project file specified. Pass --project <path> to specify one.".to_string()
            })?;
        read_project(path).map_err(|e| e.to_string())
    }

    fn check_write_allowed(&self) -> Result<(), String> {
        tools::mutation::check_app_lock(&self.app_data_dir).map_err(|e| e.to_string())
    }

    fn save_project(&self, project_file: &ChatCutProjectFile) -> Result<(), String> {
        let path = self
            .project_path
            .as_ref()
            .ok_or_else(|| "No project file specified".to_string())?;
        write_project(path, project_file).map_err(|e| e.to_string())
    }
}

// ─── Tool Definitions ──────────────────────────────────────────────────────────

#[tool_router]
impl ChatCutMcpServer {
    #[tool(description = "Get the full timeline state including all tracks, clips, and composition settings.")]
    fn get_timeline_state(&self) -> String {
        match self.load_project() {
            Ok(pf) => {
                let state = tools::introspection::get_timeline_state(&pf);
                serde_json::to_string_pretty(&state).unwrap_or_else(|e| format!("Error: {}", e))
            }
            Err(e) => format!("Error: {}", e),
        }
    }

    #[tool(description = "Get all imported media files available for use on the timeline.")]
    fn get_media_library(&self) -> String {
        match self.load_project() {
            Ok(pf) => {
                let lib = tools::introspection::get_media_library(&pf);
                serde_json::to_string_pretty(&lib).unwrap_or_else(|e| format!("Error: {}", e))
            }
            Err(e) => format!("Error: {}", e),
        }
    }

    #[tool(description = "Get the clip at a specific playhead time position.")]
    fn get_clip_at_time(
        &self,
        Parameters(params): Parameters<ClipAtTimeParams>,
    ) -> String {
        match self.load_project() {
            Ok(pf) => match tools::introspection::get_clip_at_time(&pf, params.time) {
                Ok(Some(result)) => serde_json::to_string_pretty(&result)
                    .unwrap_or_else(|e| format!("Error: {}", e)),
                Ok(None) => "null".to_string(),
                Err(e) => format!("Error: {}", e),
            },
            Err(e) => format!("Error: {}", e),
        }
    }

    #[tool(description = "Get the currently selected clip. Returns null when called from external MCP (no selection context).")]
    fn get_selected_clip(&self) -> String {
        "null".to_string()
    }

    #[tool(description = "Remove a clip from the timeline by its ID.")]
    fn remove_clip(&self, Parameters(params): Parameters<RemoveClipParams>) -> String {
        if let Err(e) = self.check_write_allowed() {
            return format!("Error: {}", e);
        }
        match self.load_project() {
            Ok(mut pf) => match tools::mutation::remove_clip(&mut pf, &params.clip_id) {
                Ok(()) => match self.save_project(&pf) {
                    Ok(()) => format!("Removed clip {}", params.clip_id),
                    Err(e) => format!("Error saving: {}", e),
                },
                Err(e) => format!("Error: {}", e),
            },
            Err(e) => format!("Error: {}", e),
        }
    }

    #[tool(description = "Trim a clip's source start or end point.")]
    fn trim_clip(&self, Parameters(params): Parameters<TrimClipParams>) -> String {
        if let Err(e) = self.check_write_allowed() {
            return format!("Error: {}", e);
        }
        match self.load_project() {
            Ok(mut pf) => {
                match tools::mutation::trim_clip(
                    &mut pf,
                    &params.clip_id,
                    params.source_start,
                    params.source_end,
                ) {
                    Ok(()) => match self.save_project(&pf) {
                        Ok(()) => format!("Trimmed clip {}", params.clip_id),
                        Err(e) => format!("Error saving: {}", e),
                    },
                    Err(e) => format!("Error: {}", e),
                }
            }
            Err(e) => format!("Error: {}", e),
        }
    }

    #[tool(description = "Move a clip to a new position on the timeline.")]
    fn move_clip(&self, Parameters(params): Parameters<MoveClipParams>) -> String {
        if let Err(e) = self.check_write_allowed() {
            return format!("Error: {}", e);
        }
        match self.load_project() {
            Ok(mut pf) => {
                match tools::mutation::move_clip(
                    &mut pf,
                    &params.clip_id,
                    params.timeline_start,
                    params.track_id.as_deref(),
                ) {
                    Ok(()) => match self.save_project(&pf) {
                        Ok(()) => format!("Moved clip {} to {}s", params.clip_id, params.timeline_start),
                        Err(e) => format!("Error saving: {}", e),
                    },
                    Err(e) => format!("Error: {}", e),
                }
            }
            Err(e) => format!("Error: {}", e),
        }
    }

    #[tool(description = "Apply a visual or audio effect to a clip.")]
    fn apply_effect(&self, Parameters(params): Parameters<ApplyEffectParams>) -> String {
        if let Err(e) = self.check_write_allowed() {
            return format!("Error: {}", e);
        }
        match self.load_project() {
            Ok(mut pf) => {
                let effect_params = HashMap::new();
                match tools::mutation::apply_effect(
                    &mut pf,
                    &params.clip_id,
                    &params.effect_id,
                    effect_params,
                ) {
                    Ok(applied) => match self.save_project(&pf) {
                        Ok(()) => serde_json::to_string_pretty(&applied)
                            .unwrap_or_else(|e| format!("Error: {}", e)),
                        Err(e) => format!("Error saving: {}", e),
                    },
                    Err(e) => format!("Error: {}", e),
                }
            }
            Err(e) => format!("Error: {}", e),
        }
    }

    #[tool(description = "Update a parameter on an already-applied effect.")]
    fn update_effect_param(
        &self,
        Parameters(params): Parameters<UpdateEffectParams>,
    ) -> String {
        if let Err(e) = self.check_write_allowed() {
            return format!("Error: {}", e);
        }
        match self.load_project() {
            Ok(mut pf) => {
                let mut effect_params = HashMap::new();
                effect_params
                    .insert(params.param_name.clone(), serde_json::json!(params.param_value));
                match tools::mutation::update_effect_param(
                    &mut pf,
                    &params.clip_id,
                    &params.applied_effect_id,
                    effect_params,
                ) {
                    Ok(()) => match self.save_project(&pf) {
                        Ok(()) => format!(
                            "Updated {} on effect {}",
                            params.param_name, params.applied_effect_id
                        ),
                        Err(e) => format!("Error saving: {}", e),
                    },
                    Err(e) => format!("Error: {}", e),
                }
            }
            Err(e) => format!("Error: {}", e),
        }
    }
}

// ─── ServerHandler Trait ───────────────────────────────────────────────────────

#[tool_handler]
impl ServerHandler for ChatCutMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(rmcp::model::Implementation::new("chatcut", env!("CARGO_PKG_VERSION")))
            .with_instructions("ChatCut video editor MCP server. Operates on saved .chatcut project files.")
    }
}
