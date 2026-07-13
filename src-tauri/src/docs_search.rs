//! docs_search — the global-hotkey docs-search palette (WI-2648, feature #5).
//!
//! A user-configurable global shortcut — **OFF by default** — which, when the
//! user turns it on, opens (or focuses) a small, always-on-top WebviewWindow
//! loading the static `/internal/docs/search-palette.html` page, which wires
//! Pagefind's own default UI widget onto the ALREADY-BUILT + ALREADY-SERVED
//! search index (apps/operator-docs, `pagefind: true`) — no new server route, no
//! custom search code. Cross-platform: `tauri_plugin_global_shortcut` handles the
//! OS registration on macOS/Windows/Linux.
//!
//! OFF BY DEFAULT (owner directive, 2026-07-12). A global shortcut is a
//! SYSTEM-WIDE key grab: while registered, the accelerator is stolen from every
//! other app on the machine, whether or not Papercusp is focused. `CmdOrCtrl+K`
//! is "focus the search box" in Slack, VS Code, every browser — so the old
//! register-on-first-launch behavior silently broke a key the user relies on
//! elsewhere, and did it before they had ever asked for the feature. A grab that
//! broad must be opt-IN. This is enforced STRUCTURALLY, not by a default
//! constant: the shortcut is registered ONLY when a valid preset has been
//! explicitly persisted by a user choice (`current_shortcut() -> Option<String>`,
//! `None` = disabled), so there is no code path on which a fresh install grabs a
//! key. Missing file, malformed file, unknown accelerator, explicit `null` — all
//! land on `None`, i.e. OFF. The user turns it on (and picks the key) from the
//! Server tray's "Docs search shortcut" submenu, whose first item is `Off`.
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

/// The accelerator pre-selected in the tray when the user turns the shortcut ON
/// without having a persisted choice — NOT a default that is ever registered on
/// its own. The palette ships OFF (see the module doc); this constant only names
/// the key the "on" affordance suggests. MUST be a member of `PRESET_SHORTCUTS`.
pub const SUGGESTED_SHORTCUT: &str = "CmdOrCtrl+K";

/// Menu payload for the tray's "Off" item — the disable affordance. Not an
/// accelerator, and deliberately not a member of `PRESET_SHORTCUTS` (it must
/// never be handed to the OS registrar).
pub const SHORTCUT_OFF: &str = "off";

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

/// Serialize the persisted payload. `None` (disabled) persists as an explicit
/// `null`, which is a RECORD OF A CHOICE — distinct on disk from "never chosen",
/// even though both read back as OFF. Pure (no I/O) so it's unit-testable.
fn serialize_shortcut(accel: Option<&str>) -> String {
    serde_json::json!({ "accelerator": accel }).to_string()
}

/// Parse a persisted payload into the accelerator to register, or `None` for
/// DISABLED. `None` is returned for every uncertain input — malformed JSON, a
/// missing key, a non-string value, an explicit `null`, or an accelerator that is
/// not a known preset (e.g. persisted by a build that offered a key this one no
/// longer does). That is the safe direction: the failure mode of guessing wrong
/// here is a system-wide key grab the user never asked for, so anything we cannot
/// positively confirm as an explicit, still-valid user choice means OFF.
/// Pure so it's unit-testable.
fn parse_persisted(txt: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(txt).ok()?;
    let accel = v.get("accelerator")?.as_str()?.to_string();
    PRESET_SHORTCUTS.contains(&accel.as_str()).then_some(accel)
}

fn read_persisted_shortcut() -> Option<String> {
    let txt = std::fs::read_to_string(persisted_shortcut_path()?).ok()?;
    parse_persisted(&txt)
}

fn write_persisted_shortcut(accel: Option<&str>) {
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

/// The accelerator currently in effect, or `None` when the global shortcut is
/// DISABLED — which is the state of every fresh install (see the module doc).
///
/// There is deliberately no "fall back to the default accelerator" branch: the
/// ONLY way this returns `Some` is a valid preset the user explicitly chose and
/// we persisted. That is what makes "off by default" structural rather than a
/// constant some future caller can forget to honor.
pub fn current_shortcut() -> Option<String> {
    read_persisted_shortcut()
}

/// Whether the global shortcut is currently enabled (a convenience for callers
/// that only need the boolean — the tray's checkmark, tests, diagnostics).
pub fn is_enabled() -> bool {
    current_shortcut().is_some()
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
        eprintln!(
            "[docs-search] DEBUG toggle check: is_visible={:?} is_focused={:?}",
            existing.is_visible(),
            existing.is_focused()
        );
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
    match builder.build() {
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

/// Register the docs-search global shortcut at startup — ONLY if the user has
/// explicitly enabled one. Call once, on the dev process and the packaged Server
/// process (NOT the packaged GUI; see the module doc).
///
/// On a fresh install `current_shortcut()` is `None` and this registers NOTHING:
/// no OS key grab happens until the user opts in from the tray. Best-effort when
/// enabled: a shortcut the desktop environment already owns just doesn't register
/// (logged, not fatal).
pub fn register_shortcut(app: &tauri::App) {
    let Some(accel) = current_shortcut() else {
        println!("[docs-search] global shortcut disabled (default) — no key registered");
        return;
    };
    match install_shortcut(app.handle(), &accel) {
        Ok(()) => println!("[docs-search] {accel} registered (docs search palette)"),
        Err(e) => eprintln!("[docs-search] {accel} not registered (DE may own it): {e}"),
    }
}

/// Set the palette shortcut: `Some(accel)` binds that preset, `None` DISABLES the
/// shortcut entirely. Unregisters the previous accelerator, registers the new one
/// (if any), and persists the choice. Called from the Server tray's "Docs search
/// shortcut" submenu (whose first item is "Off").
///
/// Unregisters ONLY the previous docs-search accelerator — never
/// `unregister_all()`, which would also drop env_switch's dev backstop
/// shortcuts. Returns `Err` (leaving the persisted value + tray checkmark
/// unchanged) if `new` isn't an offered preset or fails to register.
///
/// Disabling CANNOT fail: releasing a key grab is not an operation the OS can
/// refuse, so the user is never stuck with a shortcut they asked to turn off. The
/// unregister result is intentionally ignored (an accelerator that never
/// registered — because the DE already owned it — is already not grabbed), and
/// `None` is persisted regardless, so the choice survives restart even if the
/// live unregister was a no-op.
pub fn set_shortcut(app: &AppHandle, new: Option<&str>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    if let Some(accel) = new {
        if !PRESET_SHORTCUTS.contains(&accel) {
            return Err(format!("{accel} is not an offered preset"));
        }
    }
    let old = current_shortcut();
    if old.as_deref() == new {
        return Ok(()); // already in that state — no-op
    }
    if let Some(prev) = old.as_deref() {
        let _ = app.global_shortcut().unregister(prev);
    }
    match new {
        Some(accel) => {
            // Register BEFORE persisting: a key the OS refuses must not be
            // recorded as the user's active choice (it would come back as a dead
            // shortcut on every future launch). On failure the previous
            // accelerator is already unregistered, but the persisted value is
            // untouched, so a restart restores the last state that actually worked.
            install_shortcut(app, accel)?;
            write_persisted_shortcut(Some(accel));
            println!("[docs-search] shortcut set {old:?} -> {accel}");
        }
        None => {
            write_persisted_shortcut(None);
            println!("[docs-search] shortcut DISABLED (was {old:?})");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggested_is_a_preset() {
        assert!(
            PRESET_SHORTCUTS.contains(&SUGGESTED_SHORTCUT),
            "SUGGESTED_SHORTCUT must be one of the offered presets"
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
            let txt = serialize_shortcut(Some(accel));
            assert_eq!(
                parse_persisted(&txt).as_deref(),
                Some(*accel),
                "roundtrip failed for {accel}"
            );
        }
    }

    /// THE owner-directed default (2026-07-12): a fresh install grabs NO key.
    /// `parse_persisted` is the only thing that can turn a shortcut on, so every
    /// state a machine can be in BEFORE the user has made a choice must read as
    /// disabled. If this ever goes green while some input yields `Some`, a fresh
    /// install has started stealing a system-wide key again.
    #[test]
    fn disabled_is_the_default_for_every_unchosen_state() {
        let unchosen = [
            "",                                  // empty file
            "not json",                          // corrupt
            "{}",                                // no key
            r#"{"accelerator": null}"#,          // EXPLICITLY disabled by the user
            r#"{"accelerator": 5}"#,             // wrong type
            r#"{"other": "CmdOrCtrl+K"}"#,       // wrong key
            r#"{"accelerator": "CmdOrCtrl+Q"}"#, // an accelerator we do not offer
            r#"{"accelerator": "off"}"#,         // the tray's OFF payload is not an accelerator
        ];
        for txt in unchosen {
            assert_eq!(
                parse_persisted(txt),
                None,
                "must read as DISABLED (no key grab), got a shortcut from: {txt}"
            );
        }
    }

    /// Disabling must round-trip: the user's "off" survives a restart rather than
    /// reverting to a key on next launch.
    #[test]
    fn off_roundtrips_as_disabled() {
        let txt = serialize_shortcut(None);
        assert_eq!(parse_persisted(&txt), None);
        assert!(
            txt.contains("null"),
            "off should persist as an explicit null (a record of the choice), got {txt}"
        );
    }

    /// The tray's OFF payload must never be registrable as an accelerator — if it
    /// leaked into the preset list, "Off" would try to grab a key literally named
    /// "off".
    #[test]
    fn off_sentinel_is_not_a_preset() {
        assert!(!PRESET_SHORTCUTS.contains(&SHORTCUT_OFF));
    }
}
