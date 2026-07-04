//! docs_search — the global-hotkey docs-search palette (WI-2648, feature #5).
//!
//! `CmdOrCtrl+K`, registered unconditionally (dev AND packaged builds — unlike
//! env_switch's dev-only escape hatch, this is a real user-facing feature) →
//! opens (or focuses) a small, always-on-top WebviewWindow loading the static
//! `/internal/docs/search-palette.html` page, which wires Pagefind's own
//! default UI widget onto the ALREADY-BUILT + ALREADY-SERVED search index
//! (apps/operator-docs, `pagefind: true`) — no new server route, no custom
//! search code. Cross-platform: `tauri_plugin_global_shortcut` handles the OS
//! registration on macOS/Windows/Linux.
//!
//! Best-effort like env_switch's shortcuts: a shortcut the desktop environment
//! already owns just fails to register (logged, never fatal — the palette is
//! additive, not load-bearing).

use tauri::{AppHandle, Manager};

/// The palette window's label — stable so `get_webview_window` can find + focus
/// an already-open palette instead of spawning a duplicate.
const WINDOW_LABEL: &str = "docs-search-palette";

/// Resolve the app's current content origin, mirroring `workspaces_open_window`
/// (main.rs): the MAIN window's live URL in BOTH dev (external :3055/:3070 devUrl)
/// and release (the spawned sidecar's dynamic port), falling back to the
/// sidecar-port state if the main window's URL is somehow unreadable.
fn resolve_base(app: &AppHandle) -> Option<String> {
    if let Some(base) = app.get_webview_window("main").and_then(|w| w.url().ok()).map(|u| {
        let port = u.port().map(|p| format!(":{}", p)).unwrap_or_default();
        format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or("localhost"), port)
    }) {
        return Some(base);
    }
    let state: tauri::State<crate::SidecarState> = app.state();
    let guard = state.port.lock().ok()?;
    (*guard).map(|p| format!("http://localhost:{}", p))
}

/// Open the docs-search palette, or focus it if already open. Exposed as a
/// Tauri command too (`#[tauri::command]` below) so a future in-webview menu
/// item / button can trigger the identical path the global shortcut uses.
pub fn open_palette(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.set_focus();
        return;
    }
    let Some(base) = resolve_base(app) else {
        eprintln!("[docs-search] could not resolve app origin — palette not opened");
        return;
    };
    let url = format!("{base}/internal/docs/search-palette.html");
    let Ok(parsed) = url.parse() else {
        eprintln!("[docs-search] bad palette url {url}");
        return;
    };
    match tauri::WebviewWindowBuilder::new(app, WINDOW_LABEL, tauri::WebviewUrl::External(parsed))
        .title("Search docs")
        .inner_size(640.0, 480.0)
        .min_inner_size(420.0, 320.0)
        .center()
        .always_on_top(true)
        .decorations(true)
        .resizable(true)
        .build()
    {
        Ok(win) => {
            // Losing focus closes the palette — it's a transient quick-search
            // popup, not a persistent window (mirrors how CmdOrCtrl+K palettes
            // behave in VSCode/Slack/Linear).
            let close_on_blur = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = close_on_blur.close();
                }
            });
        }
        Err(e) => eprintln!("[docs-search] failed to open palette window: {e}"),
    }
}

/// Tauri command form — for an in-webview trigger (menu item, button), not just
/// the global shortcut.
#[tauri::command]
#[specta::specta]
pub fn open_docs_search_palette(app: AppHandle) {
    open_palette(&app);
}

/// Register the `CmdOrCtrl+K` global shortcut. Call once at startup, on BOTH
/// the dev and packaged/GUI paths (unlike `env_switch::register_backstop_shortcuts`,
/// this is a real feature, not a dev-only escape hatch). Best-effort: a shortcut
/// the desktop environment already owns just doesn't register (logged, not fatal).
pub fn register_shortcut(app: &tauri::App) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let gs = app.global_shortcut();
    let handle = app.handle().clone();
    let res = gs.on_shortcut("CmdOrCtrl+K", move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            open_palette(&handle);
        }
    });
    match res {
        Ok(()) => println!("[docs-search] CmdOrCtrl+K registered (docs search palette)"),
        Err(e) => eprintln!("[docs-search] CmdOrCtrl+K not registered (DE may own it): {e}"),
    }
}
