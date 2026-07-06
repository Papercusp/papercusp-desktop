//! docs_search — the global-hotkey docs-search palette (WI-2648, feature #5).
//!
//! A user-configurable global shortcut (default `CmdOrCtrl+K`), registered
//! unconditionally in dev AND packaged builds → opens (or focuses) a small,
//! always-on-top WebviewWindow loading the static
//! `/internal/docs/search-palette.html` page, which wires Pagefind's own default
//! UI widget onto the ALREADY-BUILT + ALREADY-SERVED search index
//! (apps/operator-docs, `pagefind: true`) — no new server route, no custom
//! search code. Cross-platform: `tauri_plugin_global_shortcut` handles the OS
//! registration on macOS/Windows/Linux.
//!
//! Ownership (packaged builds): the **Server** process owns the shortcut +
//! palette, NOT the GUI. The Server is the always-on process (auto-starts at
//! login, stays up when the GUI is closed), so a global docs-search key works
//! "whether or not the GUI is open" — exactly the owner's requirement — and the
//! rebind control lives in the Server's own tray, same-process (main.rs
//! `install_server_tray`). In dev there is a single process, which registers it
//! directly. (`open_palette` resolves the content origin from the main window
//! when there is one, else from the Server's sidecar port — see `resolve_base`.)
//!
//! Rebinding: the chosen accelerator is one of `PRESET_SHORTCUTS` (a native tray
//! menu can't capture arbitrary keystrokes, so we offer a small curated list —
//! enough to dodge a desktop environment that already owns `Cmd+K`). It is
//! persisted to `~/.papercusp/docs-search-shortcut.json` (desktop-local,
//! sidecar-independent, read at Tauri startup before the operator/PG is up —
//! mirroring `env_switch`'s `desktop-build-target.json`; a UI keybinding is the
//! storage-policy file case) and re-registered live on change.
//!
//! Best-effort like env_switch's shortcuts: a shortcut the desktop environment
//! already owns just fails to register (logged, never fatal — the palette is
//! additive, not load-bearing).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// The palette window's label — stable so `get_webview_window` can find + focus
/// an already-open palette instead of spawning a duplicate.
const WINDOW_LABEL: &str = "docs-search-palette";

/// The docs-search palette's default global shortcut. MUST be a member of
/// `PRESET_SHORTCUTS`.
pub const DEFAULT_SHORTCUT: &str = "CmdOrCtrl+K";

/// The curated set of accelerators the tray rebind offers. A native tray menu
/// can't capture an arbitrary keystroke, so we present a small, valid, mutually
/// non-conflicting preset list. Each MUST parse as a tauri global-shortcut
/// accelerator; order = tray menu order. The persisted value is validated
/// against this list, so shrinking it in a future build safely falls back to
/// the default rather than registering an accelerator that's no longer offered.
pub const PRESET_SHORTCUTS: &[&str] = &[
    "CmdOrCtrl+K",
    "CmdOrCtrl+Shift+K",
    "CmdOrCtrl+Shift+Space",
    "CmdOrCtrl+/",
    "Alt+Space",
];

// ---------------------------------------------------------------------------
// Persistence (~/.papercusp/docs-search-shortcut.json)
// ---------------------------------------------------------------------------

fn persisted_shortcut_path() -> Option<PathBuf> {
    // HOME on macOS/Linux, USERPROFILE on native Windows. Only needs to be a
    // stable per-user path (the same process reads it at startup and writes it
    // on rebind) — it need not match the WSL sidecar home on Windows.
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".papercusp/docs-search-shortcut.json"))
}

/// Serialize the persisted payload for `accel`. Pure (no I/O) so it's unit-testable.
fn serialize_shortcut(accel: &str) -> String {
    serde_json::json!({ "accelerator": accel }).to_string()
}

/// Parse a persisted payload, returning the accelerator ONLY if it is a known
/// preset. Malformed JSON, a missing/non-string key, or a non-preset value all
/// yield `None` (→ caller falls back to the default). Pure so it's unit-testable.
fn parse_persisted(txt: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(txt).ok()?;
    let accel = v.get("accelerator")?.as_str()?.to_string();
    PRESET_SHORTCUTS.contains(&accel.as_str()).then_some(accel)
}

fn read_persisted_shortcut() -> Option<String> {
    let txt = std::fs::read_to_string(persisted_shortcut_path()?).ok()?;
    parse_persisted(&txt)
}

fn write_persisted_shortcut(accel: &str) {
    let Some(path) = persisted_shortcut_path() else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = std::fs::write(&path, serialize_shortcut(accel)) {
        eprintln!("[docs-search] could not persist shortcut: {e}");
    }
}

/// The accelerator currently in effect: the persisted choice if valid, else the
/// default.
pub fn current_shortcut() -> String {
    read_persisted_shortcut().unwrap_or_else(|| DEFAULT_SHORTCUT.to_string())
}

// ---------------------------------------------------------------------------
// Palette window
// ---------------------------------------------------------------------------

/// Resolve the app's current content origin, mirroring `workspaces_open_window`
/// (main.rs): the MAIN window's live URL when there is one (dev + the GUI
/// process), else the Server process's spawned-sidecar port. The Server has no
/// window, so the sidecar-port fallback is what makes the palette work there.
fn resolve_base(app: &AppHandle) -> Option<String> {
    if let Some(base) = app
        .get_webview_window("main")
        .and_then(|w| w.url().ok())
        .map(|u| {
            let port = u.port().map(|p| format!(":{}", p)).unwrap_or_default();
            format!(
                "{}://{}{}",
                u.scheme(),
                u.host_str().unwrap_or("localhost"),
                port
            )
        })
    {
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
    // Reuse the single palette window across presses. It is created once and
    // then HIDDEN (not destroyed) on close — see the CloseRequested handler
    // below — so a repeat press just re-shows + focuses it. This is the ONLY
    // window the windowless Server ever owns, and destroying it is doubly
    // fatal: (a) the window count drops to 0, firing a window-close
    // ExitRequested that tears the whole Server (operator + embedded PG) down,
    // and (b) it tears down the sole GTK frame clock, which crashed webkit2gtk
    // on GNOME ("GdkWindow unexpectedly destroyed"). Hiding sidesteps both — the
    // app stays alive, the window persists, and the shortcut keeps working after
    // the palette is dismissed (WI-2648, reproduced live on GNOME 2026-07-04:
    // the palette worked exactly once, then "stopped working no matter which key").
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        // WI-3096: TOGGLE, don't blindly re-show. Before this check, a second
        // shortcut press while the palette was already open just re-showed +
        // reloaded it in place — there was no way to dismiss it with the same
        // key that opened it (the ticket's "ctrl+k toggles" UX expectation).
        // Gate on `is_visible()` ALONE, not also `is_focused()`: live-tested
        // (isolated Xvfb+openbox instance, WI-3096) — is_focused() can read
        // false even when the X server confirms the window IS the active,
        // input-focused window (WM_STATE=Normal, IsViewable, and
        // _NET_ACTIVE_WINDOW all agreeing) — Tauri/GTK's focus-tracking on
        // X11 does not reliably reflect real focus in every WM. Requiring it
        // for the toggle meant the second ctrl+k press silently fell through
        // to re-show+reload instead of closing. is_visible() alone is also
        // the more correct UX anyway: a palette the user left open (even if
        // they last interacted with the main window, so the palette itself
        // isn't the X11-focused window) should still close on a repeat press
        // — "toggle" means open/closed, not open/closed-only-if-still-focused.
        if existing.is_visible().unwrap_or(false) {
            let _ = existing.hide();
            return;
        }
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        // Re-shown = a fresh open from the user's point of view — RELOAD so the
        // palette picks up the CURRENT served page. The hidden window otherwise
        // pins whatever HTML existed when it was first created for the app's
        // whole lifetime: the owner ran an app instance from before the 💬
        // "Chat with an agent" CTA landed and could never see it, however many
        // times the shortcut re-opened the (stale) palette (2026-07-05). A
        // reload here is one local fetch of a static page — imperceptible next
        // to the show/focus, and clearing the previous query matches
        // fresh-open semantics anyway.
        let _ = existing.eval("location.reload()");
        return;
    }
    let Some(base) = resolve_base(app) else {
        eprintln!("[docs-search] could not resolve app origin — palette not opened");
        return;
    };
    let url = format!("{base}/internal/docs/search-palette.html");
    // Explicit type: `parsed` is now also `.clone()`d into a second builder
    // below, and `.clone()` on an un-annotated binding leaves `url.parse()`'s
    // target ambiguous (E0282).
    let Ok(parsed) = url.parse::<url::Url>() else {
        eprintln!("[docs-search] bad palette url {url}");
        return;
    };
    // Base builder. The icon is applied below so the palette carries the SAME
    // papercup icon as the app/taskbar (owner ask 2026-07-05) instead of a
    // generic fallback glyph. `default_window_icon()` is the already-decoded
    // bundle icon; `WebviewWindowBuilder::icon()` returns a Result AND consumes
    // the builder (unlike the tray builder's `.icon()` in main.rs, which returns
    // Self), so on the effectively-never error path we log and rebuild an
    // icon-less builder rather than dropping the palette entirely.
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        tauri::WebviewUrl::External(parsed.clone()),
    )
    .title("Search docs")
    .inner_size(640.0, 480.0)
    .min_inner_size(420.0, 320.0)
    .center()
    .always_on_top(true)
    .focused(true)
    .decorations(true)
    .resizable(true);
    if let Some(icon) = app.default_window_icon().cloned() {
        match builder.icon(icon) {
            Ok(b) => builder = b,
            Err(e) => {
                eprintln!("[docs-search] could not set palette icon: {e}");
                builder = tauri::WebviewWindowBuilder::new(
                    app,
                    WINDOW_LABEL,
                    tauri::WebviewUrl::External(parsed),
                )
                .title("Search docs")
                .inner_size(640.0, 480.0)
                .min_inner_size(420.0, 320.0)
                .center()
                .always_on_top(true)
                .focused(true)
                .decorations(true)
                .resizable(true);
            }
        }
    }
    match builder.build()
    {
        Ok(win) => {
            // Bring it to the front — on the Server process (a windowless
            // background app) the WM does not auto-raise the new window.
            let _ = win.set_focus();
            let hide_target = win.clone();
            // WI-3096: click-away dismiss. Guarded by `has_focused_once` so a
            // spurious blur fired during window creation/mapping (some
            // WM/compositor combinations deliver an initial Focused(false)
            // before the window has ever actually been shown to the user)
            // can't hide the palette before it's even been seen — only a
            // REAL loss of focus, after it was genuinely focused at least
            // once, dismisses it.
            let has_focused_once = Arc::new(AtomicBool::new(false));
            win.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Dismiss = HIDE, not close. The palette is the Server's
                    // ONLY window; closing/destroying it would exit the app
                    // (last-window ExitRequested) and tear down the sole GTK
                    // frame clock (a webkit2gtk crash on GNOME). Intercept the
                    // titlebar/Escape close, veto it, and hide instead —
                    // open_palette re-shows this same window on the next
                    // shortcut press (WI-2648).
                    api.prevent_close();
                    let _ = hide_target.hide();
                }
                tauri::WindowEvent::Focused(true) => {
                    has_focused_once.store(true, Ordering::Relaxed);
                }
                tauri::WindowEvent::Focused(false) => {
                    if has_focused_once.load(Ordering::Relaxed) {
                        let _ = hide_target.hide();
                    }
                }
                _ => {}
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

// ---------------------------------------------------------------------------
// Global-shortcut registration + live rebind
// ---------------------------------------------------------------------------

/// Register `accel` as the palette's global shortcut, wiring the same
/// `open_palette` handler used everywhere. Shared by startup registration and
/// live rebind. Best-effort: returns the plugin error string on failure.
fn install_shortcut(app: &AppHandle, accel: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(accel, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                open_palette(&handle);
            }
        })
        .map_err(|e| e.to_string())
}

/// Register the docs-search global shortcut (the persisted accelerator, or the
/// default). Call once at startup — on the dev process and the packaged Server
/// process (NOT the packaged GUI; see the module doc). Best-effort: a shortcut
/// the desktop environment already owns just doesn't register (logged, not fatal).
pub fn register_shortcut(app: &tauri::App) {
    let accel = current_shortcut();
    match install_shortcut(app.handle(), &accel) {
        Ok(()) => println!("[docs-search] {accel} registered (docs search palette)"),
        Err(e) => eprintln!("[docs-search] {accel} not registered (DE may own it): {e}"),
    }
}

/// Live-rebind the palette shortcut to `new_accel`: unregister the previous
/// accelerator, register the new one, and persist the choice. Called from the
/// Server tray's "Docs search shortcut" submenu.
///
/// Unregisters ONLY the previous docs-search accelerator — never
/// `unregister_all()`, which would also drop env_switch's dev backstop
/// shortcuts. Returns `Err` (leaving the persisted value + tray checkmark
/// unchanged) if `new_accel` isn't an offered preset or fails to register.
pub fn rebind_shortcut(app: &AppHandle, new_accel: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    if !PRESET_SHORTCUTS.contains(&new_accel) {
        return Err(format!("{new_accel} is not an offered preset"));
    }
    let old = current_shortcut();
    if old == new_accel {
        return Ok(()); // already active — no-op
    }
    let _ = app.global_shortcut().unregister(old.as_str());
    install_shortcut(app, new_accel)?;
    write_persisted_shortcut(new_accel);
    println!("[docs-search] shortcut rebound {old} -> {new_accel}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_a_preset() {
        assert!(
            PRESET_SHORTCUTS.contains(&DEFAULT_SHORTCUT),
            "DEFAULT_SHORTCUT must be one of the offered presets"
        );
    }

    #[test]
    fn presets_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for s in PRESET_SHORTCUTS {
            assert!(seen.insert(*s), "duplicate preset {s}");
        }
    }

    #[test]
    fn serialize_parse_roundtrip_for_each_preset() {
        for accel in PRESET_SHORTCUTS {
            let txt = serialize_shortcut(accel);
            assert_eq!(
                parse_persisted(&txt).as_deref(),
                Some(*accel),
                "roundtrip failed for {accel}"
            );
        }
    }

    #[test]
    fn parse_rejects_non_preset_accelerator() {
        // Well-formed JSON, but an accelerator we don't offer → None (fall back
        // to default rather than register a stale/unknown accelerator).
        let txt = serialize_shortcut("CmdOrCtrl+Q");
        assert_eq!(parse_persisted(&txt), None);
    }

    #[test]
    fn parse_rejects_malformed_or_missing() {
        assert_eq!(parse_persisted("not json"), None);
        assert_eq!(parse_persisted("{}"), None);
        assert_eq!(parse_persisted(r#"{"accelerator": 5}"#), None);
        assert_eq!(parse_persisted(r#"{"other": "CmdOrCtrl+K"}"#), None);
    }
}
