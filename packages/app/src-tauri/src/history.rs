//! On-disk run-history folder support. The actual file I/O happens in the webview via the `fs` plugin
//! (it handles binary blobs efficiently); these commands only resolve + AUTHORIZE the folder. The fs
//! plugin denies access to any path not in its scope, so we extend the scope at runtime to the history
//! dir (the app-data default, or a user-chosen folder later) — that's cleaner than a static allowlist
//! for a path the user can change.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

/// The default history folder (`<local-app-data>/history`). Uses LOCAL app data (not roaming): run
/// history can grow to hundreds of MB, which has no business in a roaming profile (it would sync across
/// machines / bloat logins in managed setups). This is also where WebView2 keeps its own data for the
/// app. Creates it and authorizes fs access, returning the absolute path for the webview to use.
#[tauri::command]
pub fn default_history_dir(app: AppHandle) -> Result<String, String> {
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let dir = base.join("history");
    authorize(&app, &dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Authorize (and create) an arbitrary user-chosen history folder — the seam for a future "change
/// folder" setting. Idempotent.
#[tauri::command]
pub fn allow_history_dir(app: AppHandle, dir: String) -> Result<(), String> {
    authorize(&app, &PathBuf::from(dir))
}

/// Whether this is a debug build of the desktop app (`tauri dev` or `tauri build --debug`). The frontend
/// uses it to show the DEV reset panel in a standalone debug build — release builds return false, so the
/// panel never reaches end users.
#[tauri::command]
pub fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}

fn authorize(app: &AppHandle, dir: &PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_directory(dir, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}
