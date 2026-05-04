use crate::mcp::ChatCutMcpServer;
use rmcp::transport::streamable_http_server::{StreamableHttpService, StreamableHttpServerConfig};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::stdio;
use rmcp::ServiceExt;
use std::path::PathBuf;
use std::sync::Arc;

/// Run the MCP server in stdio mode (for `chatcut --mcp`).
/// Blocks until the client disconnects.
pub async fn run_stdio(
    project_path: Option<PathBuf>,
    app_data_dir: PathBuf,
) -> anyhow::Result<()> {
    tracing::info!("Starting MCP server in stdio mode");

    let server = ChatCutMcpServer::new(project_path, app_data_dir);
    let service = server.serve(stdio()).await?;
    service.waiting().await?;

    Ok(())
}

/// Spawn the MCP HTTP server on 127.0.0.1:7331.
pub async fn spawn_http(
    project_path: Option<PathBuf>,
    app_data_dir: PathBuf,
) -> anyhow::Result<()> {
    tracing::info!("Starting MCP HTTP server on 127.0.0.1:7331");

    let pp = project_path.clone();
    let add = app_data_dir.clone();

    let config = StreamableHttpServerConfig::default();
    let service = StreamableHttpService::new(
        move || Ok(ChatCutMcpServer::new(pp.clone(), add.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );

    let router = axum::Router::new().nest_service("/mcp", service);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:7331").await?;
    tracing::info!("MCP HTTP server listening on 127.0.0.1:7331");
    axum::serve(listener, router).await?;

    Ok(())
}
