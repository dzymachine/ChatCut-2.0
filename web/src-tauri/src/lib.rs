mod commands;
mod export;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(export::ExportState::default()))
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
        .run(tauri::generate_context!())
        .expect("error while running ChatCut");
}
