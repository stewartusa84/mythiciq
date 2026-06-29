// Hide the console window on Windows release builds (keep it in debug for logs).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod history;
mod lowres;
mod tray;
mod watch;

use lowres::LowResState;
use tauri::{Emitter, Manager};
use watch::WatchState;

/// Fully exit the app. The window's X only HIDES to the tray (see the CloseRequested handler below), so
/// the UI needs an explicit way to quit for real — this backs the menu's "Quit MythicIQ" item. Mirrors
/// the tray "Quit" (app.exit bypasses the CloseRequested intercept).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        // Open external URLs (Wowhead links) in the system browser — target="_blank" anchors don't
        // open on their own in a webview; the frontend routes them here via the opener plugin.
        .plugin(tauri_plugin_opener::init())
        // Holds the live tailer + the carved-run byte buffer (drained by `take_carved_run`).
        .manage(WatchState::default())
        // Low-resource mode state (enabled flag + teardown generation token).
        .manage(LowResState::default())
        .invoke_handler(tauri::generate_handler![
            watch::start_watching,
            watch::stop_watching,
            watch::take_carved_run,
            watch::default_log_dir,
            history::default_history_dir,
            history::allow_history_dir,
            history::is_debug_build,
            auth::oauth_capture,
            lowres::set_low_resource_mode,
            quit_app,
        ])
        .setup(|app| {
            tray::build(app.handle())?;
            Ok(())
        })
        // The X minimizes to tray instead of quitting, so the watcher keeps running during a session.
        // Quitting for real is done from the tray menu ("Quit").
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                    // Bracket the tray cycle for the load benchmark (see src/mvp/loadBench.svelte.ts).
                    let _ = window.emit("window-hidden", ());
                    // Low-resource mode: tear the webview down after a short grace period (the watcher
                    // keeps running). The tray "Show" rebuilds it. No-op unless the mode is enabled.
                    lowres::schedule_unload(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the MythicIQ desktop app")
        // Destroying the main window for low-resource mode (or any window close) must NOT quit the app —
        // the tray keeps it alive and watching. Only an explicit app.exit(code) (tray/menu "Quit")
        // carries an exit code; a windows-closed ExitRequested has `code: None` and is suppressed.
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
