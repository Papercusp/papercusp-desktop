//! env_switch — desktop-side env-target plumbing for the cross-platform
//! in-webview `EnvSwitcherBar` and its native backstop.
//!
//! This REPLACES two retired implementations: the Linux-only native GTK "dev
//! wrapper" bar (desktop-build-switcher-wrapper-2026-06-09) and the
//! chrome-webview experiment (persistent-env-bar-chrome-webview, which hit an
//! X11 `set_bounds` wall). The VISIBLE bar is now the single in-webview
//! `EnvSwitcherBar` (apps/operator-vite) on every platform; this module is:
//!
//!  - `list_envs` (command) — the AUTHORITATIVE env set + reachability, probed
//!    in Rust. The bar reads THIS, not a routable `/api` fetch, so a misrouted
//!    `/api` (Trap 5) or a bad target build can NEVER make it self-hide. Dev-only
//!    (a packaged single-operator build has nothing to switch → returns `[]`).
//!  - `retarget_for_url` (on_page_load) — point `/api` at whatever env the
//!    webview navigated to + persist it, so the bar's `window.location` switch,
//!    the native backstop, and manual reloads all retarget `/api` with NO bar in
//!    the loop (this is the wiring the GTK bar's `switch_to` used to own).
//!  - `apply_persisted_target` (startup) — restore the last env + pin `/api`.
//!  - `navigate_to_env` — used by the native menu + global-shortcut backstop
//!    (the unkillable escape hatch if a target build white-screens).
//!  - `install_rail_signal` (Linux) — the document-start
//!    `__PAPERCUSP_DEV_WRAPPER__` user-script that flips operator-vite's
//!    DevAdminRail runtime gate.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

/// (display label, persisted name, port, hover tooltip). The dev-box builds.
/// `dev :3270` is the session's OWN working-tree operator; `prod :3070` the
/// deployed green-`main` release; `staging :3170` the integration tree; `local
/// :3055` the bare Vite HMR SPA (its `/api` proxies to the :3070 release).
const TARGETS: [(&str, &str, u16, &str); 4] = [
    (
        "dev",
        "dev",
        3270,
        "Dev operator (:3270) — this desktop session's OWN working-tree build, spawned with the dev shell and restarted by nothing else. /api also targets :3270. The default target.",
    ),
    (
        "prod",
        "prod",
        3070,
        "Production operator (:3070) — the deployed green-`main` release build (what the release pipeline auto-ships). /api targets :3070.",
    ),
    (
        "staging",
        "staging",
        3170,
        "Staging operator (:3170) — the shared integration-tree build (latest `staging`, ahead of the green release). /api targets :3170.",
    ),
    (
        "local",
        "local",
        3055,
        "Local Vite SPA (:3055) — the hot-reloading dev frontend with no operator of its own; its /api proxies to the :3070 release operator.",
    ),
];

/// One env button the in-webview bar renders. Serialized camelCase for JS.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    pub id: String,
    pub label: String,
    pub port: u16,
    pub origin: String,
    pub tooltip: String,
    pub reachable: bool,
    pub is_self: bool,
}

/// EI-190: which operator serves `/api` for a given content target. :3055 (the
/// bare Vite SPA) has no operator of its own; its `/api` proxies to the :3070
/// release, so the green release operator backs it here too.
pub(crate) fn api_port_for_target(target_port: u16) -> u16 {
    if target_port == 3055 {
        3070
    } else {
        target_port
    }
}

// ---------------------------------------------------------------------------
// Persistence (~/.papercusp/desktop-build-target.json)
// ---------------------------------------------------------------------------

fn persisted_target_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(std::path::PathBuf::from(home).join(".papercusp/desktop-build-target.json"))
}

/// The persisted target port (only if it's one of the known TARGETS), or None.
fn read_persisted_target() -> Option<u16> {
    let txt = std::fs::read_to_string(persisted_target_path()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    let port = v.get("port")?.as_u64()? as u16;
    TARGETS.iter().any(|(_, _, p, _)| *p == port).then_some(port)
}

fn write_persisted_target(name: &str, port: u16) {
    let Some(path) = persisted_target_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let payload = serde_json::json!({ "name": name, "port": port });
    if let Err(e) = std::fs::write(&path, payload.to_string()) {
        eprintln!("[env-switch] could not persist build target: {e}");
    }
}

/// EI-296 escape hatch: `PAPERCUSP_DEV_API_TARGET=<port>` pins BOTH the content
/// webview and `/api` to an arbitrary localhost operator — an isolated test
/// stack or a fault proxy — bypassing the fixed TARGETS allowlist. Runtime-only:
/// it is NEVER persisted, so a test launch can't repoint the next launch. Ports
/// <1024 are rejected as obviously wrong.
fn env_api_target() -> Option<u16> {
    parse_api_target(std::env::var("PAPERCUSP_DEV_API_TARGET").ok())
}

fn parse_api_target(raw: Option<String>) -> Option<u16> {
    raw?.trim().parse::<u16>().ok().filter(|p| *p >= 1024)
}

// ---------------------------------------------------------------------------
// Probes + /api routing
// ---------------------------------------------------------------------------

fn port_reachable(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Point `/api` at `target_port`'s operator (EI-190) + drop the live IPC
/// connection so the next call dials the selected operator's socket.
fn retarget_api(app: &tauri::AppHandle, target_port: u16) {
    let api_port = api_port_for_target(target_port);
    crate::SELECTED_API_PORT.store(api_port, Ordering::Relaxed);
    if let Some(ipc) = app.try_state::<Arc<crate::endpoint_ipc::IpcClientHandle>>() {
        ipc.reset();
        println!("[env-switch] /api target → :{api_port} (IPC re-dial)");
    } else {
        println!("[env-switch] /api target → :{api_port} (no IPC handle managed — HTTP only)");
    }
}

/// on_page_load(Started): if the webview navigated to a known env port, point
/// `/api` there + persist it. This is what makes the in-webview bar's
/// `window.location` switch (and the native backstop, and a manual reload)
/// follow through to `/api` — with NO bar in the loop. A
/// `PAPERCUSP_DEV_API_TARGET` pin (EI-296) is never overridden or persisted.
pub fn retarget_for_url(app: &tauri::AppHandle, url: &url::Url) {
    if env_api_target().is_some() {
        return;
    }
    let Some(port) = url.port() else { return };
    let Some((_, name, _, _)) = TARGETS.iter().find(|(_, _, p, _)| *p == port) else {
        return;
    };
    retarget_api(app, port);
    write_persisted_target(name, port);
}

// ---------------------------------------------------------------------------
// Commands + navigation
// ---------------------------------------------------------------------------

/// The canonical env set the in-webview `EnvSwitcherBar` renders — the
/// AUTHORITATIVE source. The bar reads THIS (never a routable `/api` fetch), so
/// it can't self-hide on a `/api` routing glitch. Dev-only: a packaged
/// single-operator build has nothing to switch, so it returns `[]` (the bar then
/// hides, correctly). Reachability is probed here because Rust can reach the
/// sibling operators a webview can't (CORS).
#[tauri::command]
#[specta::specta]
pub fn list_envs(window: tauri::WebviewWindow) -> Vec<EnvInfo> {
    if !cfg!(debug_assertions) {
        return Vec::new();
    }
    let cur = window.url().ok().and_then(|u| u.port());
    TARGETS
        .iter()
        .map(|(label, name, port, tooltip)| EnvInfo {
            id: (*name).to_string(),
            label: (*label).to_string(),
            port: *port,
            origin: format!("http://127.0.0.1:{port}"),
            tooltip: (*tooltip).to_string(),
            reachable: port_reachable(*port),
            is_self: cur == Some(*port),
        })
        .collect()
}

/// Navigate the content webview to an env by port, carrying the current SPA
/// route + query (matches the old `switch_to`). Used by the native menu +
/// global-shortcut backstop; `/api` retargets via on_page_load →
/// `retarget_for_url`, so this is just the navigation.
pub fn navigate_to_env(window: &tauri::WebviewWindow, port: u16) {
    let path_q = window
        .url()
        .ok()
        .map(|u| {
            let q = u.query().map(|q| format!("?{q}")).unwrap_or_default();
            format!("{}{}", u.path(), q)
        })
        .unwrap_or_else(|| "/".into());
    let target = format!("http://127.0.0.1:{port}{path_q}");
    match url::Url::parse(&target) {
        Ok(u) => {
            if let Err(e) = window.navigate(u) {
                eprintln!("[env-switch] backstop navigate to {target} failed: {e}");
            } else {
                println!("[env-switch] backstop switched content webview → {target}");
            }
        }
        Err(e) => eprintln!("[env-switch] bad backstop url {target}: {e}"),
    }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/// Re-apply the persisted build target on launch (P-004) — only when it's
/// alive, so a stale selection can't boot into a blank webview. Either way,
/// point `/api` at the EFFECTIVE build (EI-190): the persisted target when
/// restored, else the default the webview actually shows.
pub fn apply_persisted_target(window: &tauri::WebviewWindow) {
    let app = window.app_handle();
    // EI-296: an explicit env target outranks the persisted selection. `/api`
    // is pinned even when the content navigation fails (the target may be a
    // fault proxy deliberately down mid-test); nothing is persisted.
    if let Some(port) = env_api_target() {
        if !port_reachable(port) {
            eprintln!("[env-switch] PAPERCUSP_DEV_API_TARGET :{port} is not reachable — pinning /api anyway, keeping default content");
        } else {
            let url = format!("http://127.0.0.1:{port}/");
            match url::Url::parse(&url)
                .map_err(|e| e.to_string())
                .and_then(|u| window.navigate(u).map_err(|e| e.to_string()))
            {
                Ok(()) => println!("[env-switch] PAPERCUSP_DEV_API_TARGET :{port} — content + /api pinned (not persisted)"),
                Err(e) => eprintln!("[env-switch] PAPERCUSP_DEV_API_TARGET :{port} navigate failed: {e}"),
            }
        }
        retarget_api(app, port);
        return;
    }
    let effective = 'restore: {
        let Some(port) = read_persisted_target() else { break 'restore 3070 };
        if window.url().ok().and_then(|u| u.port()) == Some(port) {
            break 'restore port;
        }
        if !port_reachable(port) {
            println!("[env-switch] persisted build target :{port} is down — keeping the default");
            break 'restore 3070;
        }
        let url = format!("http://127.0.0.1:{port}/");
        match url::Url::parse(&url)
            .map_err(|e| e.to_string())
            .and_then(|u| window.navigate(u).map_err(|e| e.to_string()))
        {
            Ok(()) => {
                println!("[env-switch] restored persisted build target :{port}");
                port
            }
            Err(e) => {
                eprintln!("[env-switch] could not restore target :{port}: {e}");
                3070
            }
        }
    };
    retarget_api(app, effective);
}

/// Document-start user script that sets `window.__PAPERCUSP_DEV_WRAPPER__ =
/// true` on every navigation, flipping operator-vite's DevAdminRail runtime gate
/// on whichever build is loaded (production SPA builds included). WebKitGTK-only;
/// a no-op elsewhere (the rail's other gate, `MODE !== 'production'`, covers the
/// dev shells on every platform).
#[cfg(target_os = "linux")]
fn install_rail_signal(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use webkit2gtk::{UserContentManagerExt, WebViewExt};
        let wv: webkit2gtk::WebView = webview.inner();
        match wv.user_content_manager() {
            Some(ucm) => {
                let script = webkit2gtk::UserScript::new(
                    "window.__PAPERCUSP_DEV_WRAPPER__ = true;",
                    webkit2gtk::UserContentInjectedFrames::TopFrame,
                    webkit2gtk::UserScriptInjectionTime::Start,
                    &[],
                    &[],
                );
                ucm.add_script(&script);
            }
            None => eprintln!("[env-switch] no user_content_manager — dev-rail signal not installed"),
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn install_rail_signal(_window: &tauri::WebviewWindow) {}

/// Startup hook (called from setup's dev path): install the dev-rail signal +
/// restore the persisted env target. Compiled on every platform; the caller
/// only runs it in dev.
pub fn init(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[env-switch] no main window — skipping startup");
        return;
    };
    install_rail_signal(&window);
    apply_persisted_target(&window);
}

/// The unkillable escape hatch: a native app menu ("Env") with one accelerated
/// item per target. Native chrome — it survives a content build that
/// white-screens (the in-webview bar can't paint then, but this still switches
/// you out). Discoverable (the user can SEE + click it) AND keyboard-driven
/// (CmdOrCtrl+Shift+1..4). No global-shortcut plugin / ACL needed; menu
/// accelerators fire while the app is focused, which is exactly when you're
/// staring at a broken build. Dev-only (called from setup's dev path).
pub fn install_backstop(app: &tauri::App) {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let mut sb = SubmenuBuilder::new(app, "Env");
    let mut built_any = false;
    for (idx, (label, _name, port, tooltip)) in TARGETS.iter().enumerate() {
        match MenuItemBuilder::with_id(format!("env:{port}"), format!("{label} :{port}"))
            .accelerator(format!("CmdOrCtrl+Shift+{}", idx + 1))
            .build(app)
        {
            Ok(item) => {
                let _ = tooltip; // tooltips aren't surfaced on menu items; kept on the bar
                sb = sb.item(&item);
                built_any = true;
            }
            Err(e) => eprintln!("[env-switch] backstop menu item :{port} failed: {e}"),
        }
    }
    if !built_any {
        return;
    }
    let menu = match sb.build().and_then(|submenu| MenuBuilder::new(app).item(&submenu).build()) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[env-switch] backstop menu build failed: {e}");
            return;
        }
    };
    if let Err(e) = app.set_menu(menu) {
        eprintln!("[env-switch] backstop set_menu failed: {e}");
        return;
    }
    app.on_menu_event(move |app_handle, event| {
        let Some(port) = event
            .id()
            .as_ref()
            .strip_prefix("env:")
            .and_then(|s| s.parse::<u16>().ok())
        else {
            return;
        };
        if let Some(window) = app_handle.get_webview_window("main") {
            navigate_to_env(&window, port);
        }
    });
    println!("[env-switch] native env backstop menu installed (Env → CmdOrCtrl+Shift+1..4)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_port_mapping() {
        assert_eq!(api_port_for_target(3070), 3070);
        assert_eq!(api_port_for_target(3170), 3170);
        assert_eq!(api_port_for_target(3270), 3270);
        // :3055 (bare Vite) has no operator — /api proxies to the :3070 release.
        assert_eq!(api_port_for_target(3055), 3070);
    }

    #[test]
    fn parse_api_target_rejects_low_ports() {
        assert_eq!(parse_api_target(Some("3170".into())), Some(3170));
        assert_eq!(parse_api_target(Some("  3070 ".into())), Some(3070));
        assert_eq!(parse_api_target(Some("80".into())), None);
        assert_eq!(parse_api_target(None), None);
    }
}
