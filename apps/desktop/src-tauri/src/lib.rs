//! Elyzian Desktop — a thin native shell. The bundled frontend is a first-run
//! "connect" screen; once the operator enters their server address the WebView
//! navigates to the server's hosted Elyzian web app, so the desktop app is a
//! true client with nothing baked in per deployment.
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Elyzian Desktop");
}
