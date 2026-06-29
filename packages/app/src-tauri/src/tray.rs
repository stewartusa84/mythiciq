//! System-tray icon + menu. Because MythicIQ is a log-watching companion, closing the window should
//! NOT quit — it hides to the tray and keeps tailing the log (see the CloseRequested handler in
//! main.rs). The tray gives a way back: left-click (or "Show MythicIQ") restores the window, and
//! "Quit" is the only thing that actually exits.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show MythicIQ", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("a default window icon is bundled").clone())
        .tooltip("MythicIQ — watching for runs")
        .menu(&menu)
        .show_menu_on_left_click(false) // left-click shows the window; right-click opens the menu
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Restore + focus the main window (from the tray). Cancels any pending low-resource teardown; if the
/// webview was already torn down (low-resource mode), rebuilds it instead of showing.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    crate::lowres::cancel_unload(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        // Bracket the tray cycle for the load benchmark (see src/mvp/loadBench.svelte.ts).
        let _ = w.emit("window-shown", ());
    } else {
        // Webview unloaded by low-resource mode — recreate it. The fresh frontend re-attaches the
        // watcher and re-imports any runs completed while it was gone.
        let _ = crate::lowres::recreate_main(app);
    }
}
