mod commands;
mod error;
mod export;
mod mcp;
mod project;
mod shared;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("chatcut=info".parse().unwrap()),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();

    // --mcp mode: run as a standalone MCP server (stdio), no GUI
    if args.iter().any(|a| a == "--mcp") {
        let project_path = args
            .iter()
            .position(|a| a == "--project")
            .and_then(|i| args.get(i + 1))
            .map(std::path::PathBuf::from);

        let app_data_dir = dirs_next::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("com.chatcut.app");

        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(async {
            if let Err(e) = mcp::transport::run_stdio(project_path, app_data_dir).await {
                eprintln!("MCP server error: {}", e);
                std::process::exit(1);
            }
        });
        return;
    }

    // Normal Tauri app
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(export::ExportState::default()))
        .setup(|app| {
            use tauri::Manager;

            let app_data_dir = app.path().app_data_dir().unwrap_or_default();
            std::fs::create_dir_all(&app_data_dir).ok();

            // Lock file signals the app is running (blocks external MCP mutations)
            let lock_path = app_data_dir.join("chatcut.lock");
            std::fs::write(&lock_path, format!("{}", std::process::id())).ok();

            // Spawn MCP HTTP server in background
            let data_dir = app_data_dir.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = mcp::transport::spawn_http(None, data_dir).await {
                    tracing::error!("MCP HTTP server failed: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_file_metadata,
            commands::list_media_files,
            commands::get_app_data_dir,
            commands::check_ffmpeg,
            export::export_video,
            export::get_export_progress,
            export::cancel_export,
            export::probe_media,
        ])
        .build(tauri::generate_context!())
        .expect("error while building ChatCut")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                use tauri::Manager;
                if let Ok(dir) = app_handle.path().app_data_dir() {
                    std::fs::remove_file(dir.join("chatcut.lock")).ok();
                }
            }
        });
}
