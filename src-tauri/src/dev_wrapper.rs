// Dev wrapper — build switcher + pipeline-status bar
// (desktop-build-switcher-wrapper-2026-06-09).
//
// A NATIVE GTK control bar packed into the main window's `default_vbox`,
// OUTSIDE the switchable SPA builds (D-001): it survives a build switch and
// can never be tree-shaken out of a production SPA bundle — the exact
// failure that motivated the plan (the dev rail vanishing on the :3070
// green build). The embed mirrors native_terminal's VTE surgery (pack into
// the vbox after map+settle); the bar is packed at index 0 so vte_embed's
// "webview = LAST child" invariant is preserved.
//
// Scope guards (D-005):
//   - compiled only under the `dev-wrapper` Cargo feature (default-on for
//     dev-box builds; a REAL production build must pass
//     `--no-default-features` so none of this code ships);
//   - initialized only in dev runs (debug builds) — the packaged app drives
//     its own sidecar on a dynamic port / papercusp:// origin, where the
//     fixed :3070/:3170/:3055 dev-box targets are meaningless;
//   - runtime kill-switch: PAPERCUSP_DEV_WRAPPER=0.
//
// Pieces:
//   - Build switcher (P-003): Prod :3070 (green release) / Staging :3170
//     (staging tree) / Local :3055 (Vite HMR). Click →
//     `WebviewWindow::navigate()` carrying the current SPA route + query
//     across the switch (D-002); dead targets are health-probed and greyed.
//   - Sticky selection (P-004): persisted to
//     ~/.papercusp/desktop-build-target.json and re-applied on launch. A
//     file, not PG, on purpose — the Rust side needs it at window time,
//     before any operator connection (the same discovery-file convention as
//     embedded-pg.json / endpoint-ipc.json; storage-policy bootstrap
//     exception).
//   - Status line (P-005 / D-003): a 30s poll (named, deliberate cadence —
//     matches VersionBadge) of GET /api/dev/git-pipeline (P-010), trying
//     :3070 (the always-up operator) then :3170 (until the endpoint deploys
//     to green), rendering staging/main/deployed shas + the
//     green-checkpoint gate.
//   - Skew line (P-006 / D-006): the loaded SPA origin + its
//     /api/desktop/version sha vs which operator OWNS the IPC socket
//     (endpoint-ipc.json pid → /proc/<pid>/cwd → checkout). endpoint-ipc.json
//     is written unconditionally by EVERY operator boot (last-writer-wins),
//     so the desktop's /api can silently repoint — this makes it visible.
//   - Rail signal (P-007 / D-004): a document-start WebKit user script sets
//     `window.__PAPERCUSP_DEV_WRAPPER__ = true` on every navigation, which
//     flips operator-vite's DevAdminRail runtime gate on whichever build is
//     loaded — production SPA builds included.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

/// (button label, persisted name, port). The three dev-box builds.
const TARGETS: [(&str, &str, u16); 3] = [
    ("prod :3070", "prod", 3070),
    ("staging :3170", "staging", 3170),
    ("local :3055", "local", 3055),
];

/// Status-poll cadence. 30s is deliberate: it matches VersionBadge's
/// /api/desktop/version poll, and the bar is ambient signal, not a console.
const POLL_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Default, Clone)]
struct PortHealth {
    reachable: bool,
    /// sidecarSha from that port's /api/desktop/version (8 hex chars).
    sha: Option<String>,
}

#[derive(Default, Clone)]
struct StatusSnapshot {
    /// Which port answered the pipeline poll (0 = none yet).
    source_port: u16,
    /// staging HEAD (deploy.mainHead — field names predate the staging
    /// rename: mainHead = the integration branch, i.e. staging).
    staging_sha: Option<String>,
    /// The green pin (deploy.ready = the `main` branch).
    main_sha: Option<String>,
    /// What the live :3070 release checkout runs (deploy.deployed).
    deployed_sha: Option<String>,
    /// Commits staging has that main / the deployed ref don't.
    main_behind: Option<i64>,
    deployed_behind: Option<i64>,
    gate_reds: i64,
    gate_stalled: bool,
    gate_last_green_ms: Option<i64>,
    git_sync_status: Option<String>,
    /// Which checkout owns the IPC socket: "release" / "staging-tree" / other.
    ipc_owner: Option<String>,
    health: HashMap<u16, PortHealth>,
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Persistence (~/.papercusp/desktop-build-target.json)
// ---------------------------------------------------------------------------

fn persisted_target_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(std::path::PathBuf::from(home).join(".papercusp/desktop-build-target.json"))
}

/// The persisted target port, or None.
fn read_persisted_target() -> Option<u16> {
    let txt = std::fs::read_to_string(persisted_target_path()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    let port = v.get("port")?.as_u64()? as u16;
    TARGETS.iter().any(|(_, _, p)| *p == port).then_some(port)
}

fn write_persisted_target(name: &str, port: u16) {
    let Some(path) = persisted_target_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let payload = serde_json::json!({ "name": name, "port": port });
    if let Err(e) = std::fs::write(&path, payload.to_string()) {
        eprintln!("[dev-wrapper] could not persist build target: {e}");
    }
}

// ---------------------------------------------------------------------------
// Probes (poll thread — no GTK here)
// ---------------------------------------------------------------------------

fn port_reachable(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn fetch_json(client: &reqwest::blocking::Client, url: &str) -> Option<serde_json::Value> {
    let resp = client.get(url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    // reqwest is built default-features-off (no `json` feature) — parse the
    // body text with the serde_json dep we already carry.
    let body = resp.text().ok()?;
    serde_json::from_str(&body).ok()
}

fn short_sha(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get("deploy")?
        .get(key)?
        .get("shortSha")?
        .as_str()
        .map(|s| s.to_string())
}

/// Resolve which checkout owns the IPC socket: endpoint-ipc.json pid →
/// /proc/<pid>/cwd. Last-writer-wins between the :3070/:3170 operators, so
/// this is the ONLY honest way to know where /api lands (D-006).
fn ipc_owner_checkout() -> Option<String> {
    let home = std::env::var_os("HOME")?;
    let path = std::path::PathBuf::from(home).join(".papercusp/endpoint-ipc.json");
    let txt = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    let pid = v.get("pid")?.as_u64()?;
    match std::fs::read_link(format!("/proc/{pid}/cwd")) {
        Ok(cwd) => Some(ipc_owner_label(&cwd.to_string_lossy())),
        // The writer is gone and no later operator boot re-wrote the file —
        // the desktop's IPC reconnect dials a dead socket and degrades to
        // the HTTP fallback. Observed live (2026-06-09): a staging restart
        // wrote the file, died, and the NEXT staging boot left it stale.
        Err(_) => Some(format!("STALE (writer pid {pid} gone)")),
    }
}

/// Map an operator cwd to a human checkout label.
fn ipc_owner_label(cwd: &str) -> String {
    if cwd.contains("papercup-release") {
        "release".to_string()
    } else if cwd.contains("papercupai-workspace/papercup") {
        "staging-tree".to_string()
    } else {
        cwd.rsplit('/').next().unwrap_or("?").to_string()
    }
}

/// The port the IPC owner serves, for the skew comparison.
fn ipc_owner_port(owner: &str) -> Option<u16> {
    match owner {
        "release" => Some(3070),
        "staging-tree" => Some(3170),
        _ => None,
    }
}

fn gather(client: &reqwest::blocking::Client) -> StatusSnapshot {
    let mut snap = StatusSnapshot::default();

    for (_, _, port) in TARGETS {
        let reachable = port_reachable(port);
        let sha = if reachable {
            fetch_json(client, &format!("http://127.0.0.1:{port}/api/desktop/version"))
                .and_then(|v| v.get("sidecarSha").and_then(|s| s.as_str().map(String::from)))
        } else {
            None
        };
        snap.health.insert(port, PortHealth { reachable, sha });
    }

    // Pipeline snapshot: :3070 is the always-up operator (D-003), but the
    // endpoint only reaches it once the staging→green pipeline deploys it —
    // fall back to :3170 until then.
    for port in [3070u16, 3170] {
        if !snap.health.get(&port).map(|h| h.reachable).unwrap_or(false) {
            continue;
        }
        if let Some(v) = fetch_json(client, &format!("http://127.0.0.1:{port}/api/dev/git-pipeline")) {
            if v.get("gitSync").is_none() {
                continue;
            }
            snap.source_port = port;
            snap.staging_sha = short_sha(&v, "mainHead");
            snap.main_sha = short_sha(&v, "ready");
            snap.deployed_sha = short_sha(&v, "deployed");
            snap.main_behind = v
                .get("deploy")
                .and_then(|d| d.get("readyBehindMain"))
                .and_then(|x| x.as_i64());
            snap.deployed_behind = v
                .get("deploy")
                .and_then(|d| d.get("deployedBehindMain"))
                .and_then(|x| x.as_i64());
            if let Some(g) = v.get("gate") {
                snap.gate_reds = g.get("consecutiveReds").and_then(|x| x.as_i64()).unwrap_or(0);
                snap.gate_stalled = g.get("stalled").and_then(|x| x.as_bool()).unwrap_or(false);
                snap.gate_last_green_ms = g.get("lastGreenAtMs").and_then(|x| x.as_i64());
            }
            snap.git_sync_status = v
                .get("gitSync")
                .and_then(|s| s.get("lastStatus"))
                .and_then(|x| x.as_str().map(String::from));
            break;
        }
    }
    if snap.source_port == 0 {
        snap.error = Some("pipeline status unreachable (:3070 + :3170)".into());
    }

    snap.ipc_owner = ipc_owner_checkout();
    snap
}

// ---------------------------------------------------------------------------
// Text composition (pure — unit-tested below)
// ---------------------------------------------------------------------------

fn fmt_age(now_ms: i64, then_ms: Option<i64>) -> String {
    let Some(t) = then_ms else { return "?".into() };
    let mins = ((now_ms - t).max(0)) / 60_000;
    if mins < 60 {
        format!("{mins}m")
    } else if mins < 48 * 60 {
        format!("{}h{:02}m", mins / 60, mins % 60)
    } else {
        format!("{}d", mins / (24 * 60))
    }
}

fn compose_status(snap: &StatusSnapshot, now_ms: i64) -> String {
    if let Some(e) = &snap.error {
        return format!("⚠ {e}");
    }
    let sha = |s: &Option<String>| s.clone().unwrap_or_else(|| "?".into());
    let behind = |b: Option<i64>| match b {
        Some(0) | None => String::new(),
        Some(n) => format!(" (−{n})"),
    };
    let gate = if snap.gate_reds > 0 {
        format!(
            "gate ✗×{}{}",
            snap.gate_reds,
            if snap.gate_stalled { " STALLED" } else { "" }
        )
    } else {
        format!("gate ✓ {}", fmt_age(now_ms, snap.gate_last_green_ms))
    };
    format!(
        "staging {} · main {}{} · live {}{} · {} · sync {}",
        sha(&snap.staging_sha),
        sha(&snap.main_sha),
        behind(snap.main_behind),
        sha(&snap.deployed_sha),
        behind(snap.deployed_behind),
        gate,
        snap.git_sync_status.clone().unwrap_or_else(|| "?".into()),
    )
}

/// The skew line + whether it warrants the warn style (D-006). `spa_port` is
/// the origin the content webview currently shows.
fn compose_skew(snap: &StatusSnapshot, spa_port: Option<u16>) -> (String, bool) {
    let spa = match spa_port {
        Some(p) => {
            let sha = snap
                .health
                .get(&p)
                .and_then(|h| h.sha.clone())
                .unwrap_or_else(|| "?".into());
            format!("SPA :{p} {sha}")
        }
        None => "SPA ?".to_string(),
    };
    let Some(owner) = &snap.ipc_owner else {
        return (format!("{spa} · API ? (no endpoint-ipc.json)"), true);
    };
    if owner.starts_with("STALE") {
        return (format!("{spa} · API→{owner}"), true);
    }
    let owner_port = ipc_owner_port(owner);
    let api_sha = owner_port
        .and_then(|p| snap.health.get(&p).and_then(|h| h.sha.clone()))
        .unwrap_or_else(|| "?".into());
    let skewed = match (spa_port, owner_port) {
        (Some(s), Some(o)) => s != o && s != 3055,
        _ => false,
    };
    let line = format!(
        "{spa} · API→{owner} {api_sha}{}",
        if skewed { " — SKEW" } else { "" }
    );
    (line, skewed)
}

// ---------------------------------------------------------------------------
// GTK bar (main thread only)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
const BAR_CSS: &str = "
.pc-dev-wrapper { background-color: #14161a; border-bottom: 1px solid #2a2e36; padding: 1px 8px; }
.pc-dev-wrapper button { padding: 0px 8px; min-height: 20px; font-size: 11px; }
.pc-dev-wrapper button.pc-active { background: #2563eb; color: #ffffff; }
.pc-dev-wrapper label { font-family: monospace; font-size: 11px; color: #9aa4b2; }
.pc-dev-wrapper label.pc-warn { color: #f59e0b; }
";

/// Navigate the content webview to a target build, carrying the current SPA
/// route + query (D-002), and persist the choice (P-004).
fn switch_to(window: &tauri::WebviewWindow, name: &str, port: u16) {
    let origin = format!("http://127.0.0.1:{port}");
    let path_q = window
        .url()
        .ok()
        .map(|u| {
            let q = u.query().map(|q| format!("?{q}")).unwrap_or_default();
            format!("{}{}", u.path(), q)
        })
        .unwrap_or_else(|| "/".into());
    let target = format!("{origin}{path_q}");
    match url::Url::parse(&target) {
        Ok(u) => match window.navigate(u) {
            Ok(()) => {
                println!("[dev-wrapper] switched content webview → {target}");
                write_persisted_target(name, port);
            }
            Err(e) => eprintln!("[dev-wrapper] navigate to {target} failed: {e}"),
        },
        Err(e) => eprintln!("[dev-wrapper] bad target url {target}: {e}"),
    }
}

#[cfg(target_os = "linux")]
fn build_bar(
    window: tauri::WebviewWindow,
    vbox: &gtk::Box,
    status: Arc<Mutex<StatusSnapshot>>,
) {
    use gtk::prelude::*;

    // One screen-wide CSS provider for the bar's classes.
    let provider = gtk::CssProvider::new();
    if provider.load_from_data(BAR_CSS.as_bytes()).is_ok() {
        if let Some(screen) = gtk::gdk::Screen::default() {
            gtk::StyleContext::add_provider_for_screen(
                &screen,
                &provider,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }
    }

    let bar = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    bar.style_context().add_class("pc-dev-wrapper");

    let mut buttons: Vec<(gtk::Button, u16)> = Vec::new();
    for (label, name, port) in TARGETS {
        let btn = gtk::Button::with_label(label);
        let win = window.clone();
        btn.connect_clicked(move |_| switch_to(&win, name, port));
        bar.pack_start(&btn, false, false, 0);
        buttons.push((btn, port));
    }

    let status_label = gtk::Label::new(Some("pipeline: …"));
    status_label.set_xalign(0.0);
    status_label.set_ellipsize(gtk::pango::EllipsizeMode::End);
    bar.pack_start(&status_label, true, true, 8);

    let skew_label = gtk::Label::new(None);
    skew_label.set_xalign(1.0);
    bar.pack_end(&skew_label, false, false, 0);

    // Index 0: ABOVE the webview. vte_embed reads the LAST vbox child as the
    // webview, so a top bar never breaks the terminal-embed surgery.
    vbox.pack_start(&bar, false, false, 0);
    vbox.reorder_child(&bar, 0);
    bar.show_all();
    println!("[dev-wrapper] control bar embedded (switcher + pipeline status)");

    // Render tick — cheap label/class updates off the shared snapshot. The
    // 2s cadence keeps the active-button highlight snappy after a switch;
    // the network poll itself runs at POLL_INTERVAL on its own thread.
    glib::timeout_add_seconds_local(2, move || {
        let snap = status.lock().map(|s| s.clone()).unwrap_or_default();
        let spa_port = window.url().ok().and_then(|u| u.port());
        for (btn, port) in &buttons {
            let ctx = btn.style_context();
            if spa_port == Some(*port) {
                ctx.add_class("pc-active");
            } else {
                ctx.remove_class("pc-active");
            }
            let alive = snap
                .health
                .get(port)
                .map(|h| h.reachable)
                // Before the first poll completes, leave everything clickable.
                .unwrap_or(true);
            btn.set_sensitive(alive || spa_port == Some(*port));
        }
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        status_label.set_text(&compose_status(&snap, now_ms));
        let (skew_text, warn) = compose_skew(&snap, spa_port);
        skew_label.set_text(&skew_text);
        let ctx = skew_label.style_context();
        if warn {
            ctx.add_class("pc-warn");
        } else {
            ctx.remove_class("pc-warn");
        }
        glib::ControlFlow::Continue
    });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/// Document-start user script: re-runs on EVERY navigation (build switches
/// included), so whichever SPA build loads sees the wrapper's presence and
/// runtime-enables the dev rail (P-007 / D-004).
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
            None => eprintln!("[dev-wrapper] no user_content_manager — dev-rail signal not installed"),
        }
    });
}

/// Re-apply the persisted build target on launch (P-004) — only when the
/// target is alive, so a stale selection can't boot into a blank webview.
fn apply_persisted_target(window: &tauri::WebviewWindow) {
    let Some(port) = read_persisted_target() else { return };
    if window.url().ok().and_then(|u| u.port()) == Some(port) {
        return;
    }
    if !port_reachable(port) {
        println!("[dev-wrapper] persisted build target :{port} is down — keeping the default");
        return;
    }
    let url = format!("http://127.0.0.1:{port}/");
    if let Ok(u) = url::Url::parse(&url) {
        match window.navigate(u) {
            Ok(()) => println!("[dev-wrapper] restored persisted build target :{port}"),
            Err(e) => eprintln!("[dev-wrapper] could not restore target :{port}: {e}"),
        }
    }
}

/// Initialize the dev wrapper around the main window. Call from setup() on
/// the dev path only (see the scope guards in the module doc).
#[cfg(target_os = "linux")]
pub fn init(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[dev-wrapper] no main window — skipping");
        return;
    };

    install_rail_signal(&window);
    apply_persisted_target(&window);

    let status: Arc<Mutex<StatusSnapshot>> = Arc::new(Mutex::new(StatusSnapshot::default()));
    {
        let cell = status.clone();
        let _ = std::thread::Builder::new()
            .name("pc-dev-wrapper-poll".into())
            .spawn(move || {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(3))
                    .build();
                let Ok(client) = client else { return };
                loop {
                    let snap = gather(&client);
                    if let Ok(mut guard) = cell.lock() {
                        *guard = snap;
                    }
                    std::thread::sleep(POLL_INTERVAL);
                }
            });
    }

    // Embed after map + settle — the native_terminal VTE lesson, with a
    // shorter settle since a plain GtkBox has no native-window realization
    // hazard (the 8-beat wait there is VTE-specific).
    let win = window.clone();
    let res = window.run_on_main_thread(move || {
        let mut settle_beats: u8 = 0;
        let win2 = win.clone();
        glib::timeout_add_local(Duration::from_millis(250), move || {
            let mapped = win2
                .gtk_window()
                .map(|w| gtk::prelude::WidgetExt::is_mapped(&w))
                .unwrap_or(false);
            if !mapped {
                return glib::ControlFlow::Continue;
            }
            settle_beats += 1;
            if settle_beats < 4 {
                return glib::ControlFlow::Continue;
            }
            match win2.default_vbox() {
                Ok(vbox) => build_bar(win2.clone(), &vbox, status.clone()),
                Err(e) => eprintln!("[dev-wrapper] no default vbox — bar not embedded: {e}"),
            }
            glib::ControlFlow::Break
        });
    });
    if let Err(e) = res {
        eprintln!("[dev-wrapper] main-thread hop failed: {e}");
    }
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn snap() -> StatusSnapshot {
        let mut s = StatusSnapshot {
            source_port: 3070,
            staging_sha: Some("aaaa1111".into()),
            main_sha: Some("bbbb2222".into()),
            deployed_sha: Some("bbbb2222".into()),
            main_behind: Some(2),
            deployed_behind: Some(3),
            gate_reds: 0,
            gate_stalled: false,
            gate_last_green_ms: Some(1_000_000),
            git_sync_status: Some("synced".into()),
            ipc_owner: Some("release".into()),
            ..Default::default()
        };
        s.health.insert(
            3070,
            PortHealth { reachable: true, sha: Some("bbbb2222".into()) },
        );
        s.health.insert(
            3170,
            PortHealth { reachable: true, sha: Some("aaaa1111".into()) },
        );
        s
    }

    #[test]
    fn status_line_green_gate() {
        let line = compose_status(&snap(), 1_000_000 + 5 * 60_000);
        assert_eq!(
            line,
            "staging aaaa1111 · main bbbb2222 (−2) · live bbbb2222 (−3) · gate ✓ 5m · sync synced"
        );
    }

    #[test]
    fn status_line_red_gate_stalled() {
        let mut s = snap();
        s.gate_reds = 4;
        s.gate_stalled = true;
        let line = compose_status(&s, 0);
        assert!(line.contains("gate ✗×4 STALLED"), "{line}");
    }

    #[test]
    fn status_line_error() {
        let s = StatusSnapshot { error: Some("boom".into()), ..Default::default() };
        assert_eq!(compose_status(&s, 0), "⚠ boom");
    }

    #[test]
    fn skew_flagged_when_spa_and_ipc_diverge() {
        // SPA on staging, IPC owned by release → skew.
        let (line, warn) = compose_skew(&snap(), Some(3170));
        assert!(warn, "{line}");
        assert!(line.contains("SKEW"), "{line}");
        assert!(line.contains("API→release"), "{line}");
    }

    #[test]
    fn no_skew_when_aligned() {
        let (line, warn) = compose_skew(&snap(), Some(3070));
        assert!(!warn, "{line}");
        assert!(!line.contains("SKEW"), "{line}");
    }

    #[test]
    fn local_vite_spa_is_not_skew() {
        // :3055 has no operator of its own; /api intentionally rides IPC.
        let (_, warn) = compose_skew(&snap(), Some(3055));
        assert!(!warn);
    }

    #[test]
    fn stale_ipc_writer_is_flagged() {
        let mut s = snap();
        s.ipc_owner = Some("STALE (writer pid 2842557 gone)".into());
        let (line, warn) = compose_skew(&s, Some(3070));
        assert!(warn, "{line}");
        assert!(line.contains("API→STALE"), "{line}");
    }

    #[test]
    fn ipc_owner_labels() {
        assert_eq!(
            ipc_owner_label("/home/x/papercupai-workspace/papercup-release/apps/operator"),
            "release"
        );
        assert_eq!(
            ipc_owner_label("/home/x/papercupai-workspace/papercup/apps/operator"),
            "staging-tree"
        );
        assert_eq!(ipc_owner_port("release"), Some(3070));
        assert_eq!(ipc_owner_port("staging-tree"), Some(3170));
    }

    #[test]
    fn age_formatting() {
        assert_eq!(fmt_age(10 * 60_000, Some(0)), "10m");
        assert_eq!(fmt_age(90 * 60_000, Some(0)), "1h30m");
        assert_eq!(fmt_age(0, None), "?");
    }
}
