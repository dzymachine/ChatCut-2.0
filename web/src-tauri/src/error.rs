use thiserror::Error;

#[derive(Debug, Error)]
pub enum ChatCutError {
    #[error("Project file not found: {0}")]
    ProjectNotFound(String),

    #[error("Project file is malformed: {0}")]
    ProjectMalformed(String),

    #[error("ChatCut app is currently open — mutations from external MCP clients are not yet supported in v1")]
    AppInstanceLocked,

    #[error("Invalid parameters: {0}")]
    InvalidParams(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
