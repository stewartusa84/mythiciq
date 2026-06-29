//! Low-resource mode: tear down the webview while the app sits in the tray, keeping ONLY the native
//! log watcher alive. The webview (WebView2 / WKWebView) is by far the heaviest part of the process;
//! destroying it returns its memory entirely. Watching/carving lives in [`crate::watch::WatchState`],
//! which is managed on the AppHandle (not the window), so it continues uninterrupted while the UI is
//! unloaded — on restore the window is recreated and re-attaches the watcher (re-scanning the active log
//! recovers anything completed while it was gone; history dedupes).
//!
//! The teardown timer lives HERE (native), not in the webview: a hidden webview throttles its JS timers,
//! so a `setTimeout` would be unreliable. We delay [`UNLOAD_DELAY`] after a hide so an accidental
//! minimize can be restored instantly without paying a webview rebuild.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Grace period after the window is hidden to the tray before the webview is torn down. Long enough to
/// instantly restore an inadvertent minimize, short enough to reclaim memory promptly.
const UNLOAD_DELAY: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct LowResState {
    /// Whether low-resource mode is enabled (mirrors the frontend Settings toggle).
    enabled: AtomicBool,
    /// Bumped on every hide/show transition. A scheduled teardown captures the value at schedule time
    /// and skips if it no longer matches — i.e. the window was shown (or re-hidden) in the meantime.
    generation: AtomicU64,
}

impl LowResState {
    fn set_enabled(&self, v: bool) {
        self.enabled.store(v, Ordering::SeqCst);
    }
    fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }
    /// Mark a hide/show transition, invalidating any in-flight teardown; returns the new token.
    fn bump(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }
    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }
}

/// Frontend → native: turn low-resource mode on/off (mirrors the Settings toggle; pushed on startup and
/// whenever it changes).
#[tauri::command]
pub fn set_low_resource_mode<R: Runtime>(app: AppHandle<R>, enabled: bool) {
    app.state::<LowResState>().set_enabled(enabled);
}

/// Window hidden to the tray (the X → tray; see main.rs). In low-resource mode, schedule a webview
/// teardown after [`UNLOAD_DELAY`] unless the window is shown (or hidden again) first. No-op otherwise.
pub fn schedule_unload<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<LowResState>();
    if !state.enabled() {
        return;
    }
    let token = state.bump();
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(UNLOAD_DELAY);
        let state = app.state::<LowResState>();
        // Disabled mid-wait, or a hide/show happened since → leave the window alone.
        if !state.enabled() || state.generation() != token {
            return;
        }
        let app_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(w) = app_main.get_webview_window("main") {
                let _ = w.destroy();
            }
        });
    });
}

/// Cancel any pending teardown — the window is being shown again.
pub fn cancel_unload<R: Runtime>(app: &AppHandle<R>) {
    app.state::<LowResState>().bump();
}

/// Recreate the main webview after a low-resource teardown, matching the config in tauri.conf.json.
/// Used by the tray "Show" path when the window no longer exists. The fresh frontend re-runs its desktop
/// startup effect (re-attaching the watcher), so carved runs completed while unloaded are recovered.
pub fn recreate_main<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("MythicIQ")
        .inner_size(1440.0, 920.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .build()?;
    Ok(())
}
