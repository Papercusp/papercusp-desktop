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
//     matches VersionBadge) of GET /api/desktop/git-pipeline (P-010), trying
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

/// EI-190: which operator should serve /api for a given content target.
/// :3070 and :3170 are operators themselves; :3055 is the bare Vite HMR
/// server with NO operator of its own — its /api historically proxied to
/// :3070, so the green release operator backs it here too.
pub(crate) fn api_port_for_target(target_port: u16) -> u16 {
    if target_port == 3055 { 3070 } else { target_port }
}

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
    /// When the staging tip was committed (deploy.mainHead.committedAtMs) —
    /// drives the tip-age in the P-009 verdict.
    staging_committed_ms: Option<i64>,
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
    /// Next scheduled fire times (routines.*.nextFireAtMs) — drive the
    /// "when does this catch up" countdowns in the status line.
    git_sync_next_ms: Option<i64>,
    gate_next_ms: Option<i64>,
    deploy_next_ms: Option<i64>,
    /// The operator port /api currently targets (EI-190 — follows the switcher).
    api_port: u16,
    /// Which checkout owns the targeted IPC socket: "release" / "staging-tree" / other.
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

/// EI-296 escape hatch: `PAPERCUSP_DEV_API_TARGET=<port>` pins BOTH the
/// content webview and /api to an arbitrary localhost operator — an isolated
/// test stack or a fault proxy — bypassing the fixed TARGETS allowlist.
/// Runtime-only by design: it is NEVER written to the shared
/// desktop-build-target.json, so a test launch can't repoint peers' (or the
/// owner's) next launch. Ports <1024 are rejected as obviously wrong.
fn env_api_target() -> Option<u16> {
    parse_api_target(std::env::var("PAPERCUSP_DEV_API_TARGET").ok())
}

fn parse_api_target(raw: Option<String>) -> Option<u16> {
    raw?.trim().parse::<u16>().ok().filter(|p| *p >= 1024)
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

/// Resolve which checkout owns the IPC socket /api targets: the per-port
/// discovery file (EI-190; singleton fallback for a not-yet-restarted
/// operator) → pid → /proc/<pid>/cwd.
fn ipc_owner_checkout(api_port: u16) -> Option<String> {
    let home = std::env::var_os("HOME")?;
    let dir = std::path::PathBuf::from(home).join(".papercusp");
    let per_port = dir.join(format!("endpoint-ipc.{api_port}.json"));
    let path = if per_port.exists() { per_port } else { dir.join("endpoint-ipc.json") };
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
    let mut snap = StatusSnapshot {
        api_port: crate::SELECTED_API_PORT.load(std::sync::atomic::Ordering::Relaxed),
        ..StatusSnapshot::default()
    };

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
        if let Some(v) = fetch_json(client, &format!("http://127.0.0.1:{port}/api/desktop/git-pipeline")) {
            if v.get("gitSync").is_none() {
                continue;
            }
            snap.source_port = port;
            snap.staging_sha = short_sha(&v, "mainHead");
            snap.staging_committed_ms = v
                .get("deploy")
                .and_then(|d| d.get("mainHead"))
                .and_then(|m| m.get("committedAtMs"))
                .and_then(|x| x.as_i64());
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
            if let Some(r) = v.get("routines") {
                let next = |name: &str| {
                    r.get(name)
                        .and_then(|x| x.get("nextFireAtMs"))
                        .and_then(|x| x.as_i64())
                };
                snap.git_sync_next_ms = next("gitSync");
                snap.gate_next_ms = next("greenCheckpoint");
                snap.deploy_next_ms = next("releaseTrigger");
            }
            break;
        }
    }
    if snap.source_port == 0 {
        snap.error = Some("pipeline status unreachable (:3070 + :3170)".into());
    }

    snap.ipc_owner = ipc_owner_checkout(snap.api_port);
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

/// Future countdown for a scheduled fire time — "in 4m" / "in 1h05m";
/// "due now" once the time has passed (the routine fires on its next tick).
fn fmt_in(now_ms: i64, then_ms: Option<i64>) -> String {
    let Some(t) = then_ms else { return "?".into() };
    if t <= now_ms {
        return "due now".into();
    }
    let mins = (t - now_ms) / 60_000;
    if mins < 1 {
        "in <1m".into()
    } else if mins < 60 {
        format!("in {mins}m")
    } else {
        format!("in {}h{:02}m", mins / 60, mins % 60)
    }
}

/// P-009 — the "where's my change" verdict: where the staging TIP stands in
/// the promote→deploy pipeline. Box-level by design: on this dev box the
/// staging tip IS "your latest work" (git-sync sweeps every agent's edits
/// into it within minutes), so tip-promoted/tip-deployed answers the
/// question without per-author sha attribution.
///   - `main_behind`  = commits staging has that the green `main` pin lacks
///     (0 → the tip has been PROMOTED by green-checkpoint);
///   - `deployed_behind` = commits staging has that the live :3070 checkout
///     lacks (0 → the tip is DEPLOYED).
fn change_verdict(snap: &StatusSnapshot) -> String {
    match (snap.main_behind, snap.deployed_behind) {
        (Some(0), Some(0)) => "live on :3070 ✓".into(),
        (Some(0), _) => "promoted ✓, deploy pending".into(),
        (Some(_), _) if snap.gate_stalled => "awaiting green — gate STALLED".into(),
        (Some(_), _) if snap.gate_reds > 0 => {
            format!("awaiting green (gate red ×{})", snap.gate_reds)
        }
        (Some(_), _) => "awaiting promotion".into(),
        _ => "?".into(),
    }
}

/// Plain-text twin of `compose_status_markup` (the rendered one). Kept as the
/// readable content spec — the `markup_matches_plain_text_content` test pins
/// the two together, so edit BOTH when changing the line.
#[cfg_attr(not(test), allow(dead_code))]
fn compose_status(snap: &StatusSnapshot, now_ms: i64) -> String {
    if let Some(e) = &snap.error {
        return format!("⚠ {e}");
    }
    let sha = |s: &Option<String>| s.clone().unwrap_or_else(|| "?".into());
    // Per-branch standing: an EXPLICIT at-tip mark (a bare sha used to mean
    // "current" only by omission), or commits-behind plus when the next
    // catch-up attempt runs (the gate promotes main; the release deploys live).
    let standing = |b: Option<i64>, next_label: &str, next_ms: Option<i64>| match b {
        Some(0) => " ✓ latest".to_string(),
        Some(n) => format!(" −{n} ({} {})", next_label, fmt_in(now_ms, next_ms)),
        None => String::new(),
    };
    let gate = if snap.gate_reds > 0 {
        format!(
            "gate ✗×{}{} (retry {})",
            snap.gate_reds,
            if snap.gate_stalled { " STALLED" } else { "" },
            fmt_in(now_ms, snap.gate_next_ms),
        )
    } else {
        // "ago" — a bare duration here kept being misread as a countdown.
        format!("gate ✓ {} ago", fmt_age(now_ms, snap.gate_last_green_ms))
    };
    // The verdict leads: the status label ellipsizes at the RIGHT on narrow
    // windows, and "is my change live" is the one segment that must never
    // truncate away (the trailing sync state is the least-load-bearing).
    let tip_age = snap
        .staging_committed_ms
        .map(|t| format!("({})", fmt_age(now_ms, Some(t))))
        .unwrap_or_default();
    // Healthy sync states collapse to a compact "✓ <countdown>"; anything
    // else keeps the status word in full.
    let sync = match snap.git_sync_status.as_deref() {
        Some("synced") | Some("nothing") => {
            format!("sync ✓ {}", fmt_in(now_ms, snap.git_sync_next_ms))
        }
        other => format!(
            "sync {}, next {}",
            other.unwrap_or("?"),
            fmt_in(now_ms, snap.git_sync_next_ms)
        ),
    };
    // sync precedes gate: the line ellipsizes at the right, and "when is the
    // next sync" must survive truncation (a red gate still shows in the
    // leading verdict).
    format!(
        "tip{}: {} · staging {} · main {}{} · live {}{} · {} · {}",
        tip_age,
        change_verdict(snap),
        sha(&snap.staging_sha),
        sha(&snap.main_sha),
        standing(snap.main_behind, "gate", snap.gate_next_ms),
        sha(&snap.deployed_sha),
        standing(snap.deployed_behind, "deploy", snap.deploy_next_ms),
        sync,
        gate,
    )
}

/// The /api line + whether it warrants the warn style. Since EI-190 the api
/// target FOLLOWS the switcher (`snap.api_port`), so the classic
/// staging-SPA/green-API skew can no longer happen by accident — the warn
/// states left are: no discovery file, a STALE (dead-writer) file, the
/// singleton fallback resolving a DIFFERENT operator than selected, and an
/// SPA/api divergence that should be impossible (guard).
// Frost palette for the status-line markup (same values as BAR_CSS / the
// SPA's semantic tokens).
const C_DIM: &str = "#b9d4e8"; // --fg-dim: segment labels
const C_MUTE: &str = "#7f9bb4"; // --fg-mute: countdowns / ages
const C_SEP: &str = "#4a6076"; // separators
const C_SHA: &str = "#7dd3fc"; // --accent-strong: shas
const C_GOOD: &str = "#34d399"; // --good
const C_WARN: &str = "#fbbf24"; // --warn
const C_BAD: &str = "#f87171"; // --bad

/// Pango-escape the entities that matter inside markup text.
fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn span(color: &str, text: &str) -> String {
    format!("<span foreground=\"{color}\">{text}</span>")
}

fn span_b(color: &str, text: &str) -> String {
    format!("<span foreground=\"{color}\" weight=\"bold\">{text}</span>")
}

/// The Pango-markup twin of `compose_status` — identical text content
/// (guarded by the strip test below), with semantic color per segment:
/// green = current/good, amber = behind/waiting, red = failing, sky = shas,
/// muted = countdowns. This is what the bar label actually renders.
fn compose_status_markup(snap: &StatusSnapshot, now_ms: i64) -> String {
    if let Some(e) = &snap.error {
        return span_b(C_BAD, &esc(&format!("⚠ {e}")));
    }
    let sha = |s: &Option<String>| span(C_SHA, &esc(&s.clone().unwrap_or_else(|| "?".into())));
    let standing = |b: Option<i64>, label: &str, next: Option<i64>| match b {
        Some(0) => format!(" {}", span_b(C_GOOD, "✓ latest")),
        Some(n) => format!(
            " {} {}",
            span_b(C_WARN, &format!("−{n}")),
            span(C_MUTE, &format!("({} {})", label, fmt_in(now_ms, next))),
        ),
        None => String::new(),
    };
    let verdict = change_verdict(snap);
    let verdict_color = if verdict.starts_with("live on") {
        C_GOOD
    } else if verdict.contains("gate red") || verdict.contains("STALLED") {
        C_BAD
    } else if verdict == "?" {
        C_MUTE
    } else {
        C_WARN
    };
    let gate = if snap.gate_reds > 0 {
        format!(
            "{} {}",
            span_b(
                C_BAD,
                &format!(
                    "gate ✗×{}{}",
                    snap.gate_reds,
                    if snap.gate_stalled { " STALLED" } else { "" }
                ),
            ),
            span(C_MUTE, &format!("(retry {})", fmt_in(now_ms, snap.gate_next_ms))),
        )
    } else {
        format!(
            "{} {}",
            span(C_GOOD, "gate ✓"),
            span(C_MUTE, &format!("{} ago", fmt_age(now_ms, snap.gate_last_green_ms))),
        )
    };
    let tip_age = snap
        .staging_committed_ms
        .map(|t| span(C_MUTE, &format!("({})", fmt_age(now_ms, Some(t)))))
        .unwrap_or_default();
    let parts = [
        format!(
            "{}{}{} {}",
            span(C_DIM, "tip"),
            tip_age,
            span(C_DIM, ":"),
            span_b(verdict_color, &esc(&verdict)),
        ),
        format!("{} {}", span(C_DIM, "staging"), sha(&snap.staging_sha)),
        format!(
            "{} {}{}",
            span(C_DIM, "main"),
            sha(&snap.main_sha),
            standing(snap.main_behind, "gate", snap.gate_next_ms),
        ),
        format!(
            "{} {}{}",
            span(C_DIM, "live"),
            sha(&snap.deployed_sha),
            standing(snap.deployed_behind, "deploy", snap.deploy_next_ms),
        ),
        match snap.git_sync_status.as_deref() {
            Some("synced") | Some("nothing") => format!(
                "{}{}",
                span(C_GOOD, "sync ✓"),
                span(C_MUTE, &format!(" {}", fmt_in(now_ms, snap.git_sync_next_ms))),
            ),
            other => format!(
                "{} {}{}",
                span(C_DIM, "sync"),
                span_b(C_BAD, &esc(other.unwrap_or("?"))),
                span(C_MUTE, &format!(", next {}", fmt_in(now_ms, snap.git_sync_next_ms))),
            ),
        },
        gate,
    ];
    parts.join(&span(C_SEP, " · "))
}

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
    let api = snap.api_port;
    let Some(owner) = &snap.ipc_owner else {
        return (format!("{spa} · API :{api} ? (no discovery file)"), true);
    };
    if owner.starts_with("STALE") {
        return (format!("{spa} · API :{api}→{owner}"), true);
    }
    let owner_port = ipc_owner_port(owner);
    let api_sha = snap
        .health
        .get(&api)
        .and_then(|h| h.sha.clone())
        .unwrap_or_else(|| "?".into());
    // The singleton fallback can hand us the WRONG operator's socket when
    // the selected one hasn't restarted since per-port files shipped.
    let fallback_mismatch = owner_port.map(|p| p != api).unwrap_or(false);
    // Should be impossible (switch_to sets both) — guard regardless.
    let diverged = spa_port.map(|p| api_port_for_target(p) != api).unwrap_or(false);
    let warn = fallback_mismatch || diverged;
    // Aligned + same build: one origin, one sha — don't say it twice. The
    // duplicated form ate ~200px of bar width and crowded out the status
    // line's sync segment.
    if !warn {
        if let Some(p) = spa_port {
            let spa_sha = snap.health.get(&p).and_then(|h| h.sha.clone());
            if p == api && spa_sha.as_deref() == Some(api_sha.as_str()) {
                return (format!("SPA+API :{api} {owner} {api_sha}"), false);
            }
        }
    }
    let line = format!(
        "{spa} · API :{api} {owner} {api_sha}{}",
        if fallback_mismatch {
            " — WRONG OPERATOR (singleton fallback)"
        } else if diverged {
            " — SPA/API DIVERGED"
        } else {
            ""
        }
    );
    (line, warn)
}

// ---------------------------------------------------------------------------
// GTK bar (main thread only)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
// Frost-aligned bar chrome (the hex values mirror the SPA's semantic tokens —
// GTK has no var() system, so they're pinned here): navy surface, sky
// hairline, 13px text, flat sky-filled active switcher button.
const BAR_CSS: &str = "
.pc-dev-wrapper { background-color: #081123; border-bottom: 1px solid rgba(125,211,252,0.30); padding: 4px 10px; }
.pc-dev-wrapper button { padding: 1px 10px; min-height: 24px; font-size: 12px; background-image: none; background-color: #0d1829; color: #b9d4e8; border: 1px solid rgba(125,211,252,0.22); border-radius: 4px; }
.pc-dev-wrapper button:hover { background-color: #143049; color: #e7f7ff; }
.pc-dev-wrapper button.pc-active { background-color: #0ea5e9; color: #051827; font-weight: bold; border-color: #38bdf8; }
.pc-dev-wrapper button:disabled { color: #56708a; }
.pc-dev-wrapper label { font-family: monospace; font-size: 13px; color: #b9d4e8; }
.pc-dev-wrapper label.pc-warn { color: #fbbf24; }
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
                retarget_api(window, port);
            }
            Err(e) => eprintln!("[dev-wrapper] navigate to {target} failed: {e}"),
        },
        Err(e) => eprintln!("[dev-wrapper] bad target url {target}: {e}"),
    }
}

/// EI-190: make /api follow the switcher. Stores the mapped operator port
/// and drops the live IPC connection so the next call dials the selected
/// operator's socket (per-port discovery file).
fn retarget_api(window: &tauri::WebviewWindow, target_port: u16) {
    use tauri::Manager;
    let api_port = api_port_for_target(target_port);
    crate::SELECTED_API_PORT.store(api_port, std::sync::atomic::Ordering::Relaxed);
    if let Some(ipc) = window
        .app_handle()
        .try_state::<std::sync::Arc<crate::endpoint_ipc::IpcClientHandle>>()
    {
        ipc.reset();
        println!("[dev-wrapper] /api target → :{api_port} (IPC re-dial)");
    } else {
        println!("[dev-wrapper] /api target → :{api_port} (no IPC handle managed — HTTP only)");
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
        status_label.set_markup(&compose_status_markup(&snap, now_ms));
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
/// Either way, point /api at the EFFECTIVE build (EI-190): the persisted
/// target when restored, else the default the webview actually shows.
fn apply_persisted_target(window: &tauri::WebviewWindow) {
    // EI-296: an explicit env target outranks the persisted selection. /api is
    // pinned even when the content navigation fails (the target may be a
    // fault proxy that is deliberately down mid-test); nothing is persisted.
    if let Some(port) = env_api_target() {
        if !port_reachable(port) {
            eprintln!("[dev-wrapper] PAPERCUSP_DEV_API_TARGET :{port} is not reachable — pinning /api anyway, keeping default content");
        } else {
            let url = format!("http://127.0.0.1:{port}/");
            match url::Url::parse(&url)
                .map_err(|e| e.to_string())
                .and_then(|u| window.navigate(u).map_err(|e| e.to_string()))
            {
                Ok(()) => println!("[dev-wrapper] PAPERCUSP_DEV_API_TARGET :{port} — content + /api pinned (not persisted)"),
                Err(e) => eprintln!("[dev-wrapper] PAPERCUSP_DEV_API_TARGET :{port} navigate failed: {e}"),
            }
        }
        retarget_api(window, port);
        return;
    }
    let effective = 'restore: {
        let Some(port) = read_persisted_target() else { break 'restore 3070 };
        if window.url().ok().and_then(|u| u.port()) == Some(port) {
            break 'restore port;
        }
        if !port_reachable(port) {
            println!("[dev-wrapper] persisted build target :{port} is down — keeping the default");
            break 'restore 3070;
        }
        let url = format!("http://127.0.0.1:{port}/");
        match url::Url::parse(&url).map_err(|e| e.to_string()).and_then(|u| {
            window.navigate(u).map_err(|e| e.to_string())
        }) {
            Ok(()) => {
                println!("[dev-wrapper] restored persisted build target :{port}");
                port
            }
            Err(e) => {
                eprintln!("[dev-wrapper] could not restore target :{port}: {e}");
                3070
            }
        }
    };
    retarget_api(window, effective);
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
            staging_committed_ms: Some(1_000_000),
            main_sha: Some("bbbb2222".into()),
            deployed_sha: Some("bbbb2222".into()),
            main_behind: Some(2),
            deployed_behind: Some(3),
            gate_reds: 0,
            gate_stalled: false,
            gate_last_green_ms: Some(1_000_000),
            git_sync_status: Some("synced".into()),
            // now in the line tests = 1_000_000 + 5m → gate in 10m,
            // deploy in 5m, sync in 2m.
            git_sync_next_ms: Some(1_000_000 + 7 * 60_000),
            gate_next_ms: Some(1_000_000 + 15 * 60_000),
            deploy_next_ms: Some(1_000_000 + 10 * 60_000),
            api_port: 3070,
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
            "tip(5m): awaiting promotion · staging aaaa1111 · main bbbb2222 −2 (gate in 10m) · live bbbb2222 −3 (deploy in 5m) · sync ✓ in 2m · gate ✓ 5m ago"
        );
    }

    #[test]
    fn status_line_all_current_marks_latest_explicitly() {
        let mut s = snap();
        s.main_behind = Some(0);
        s.deployed_behind = Some(0);
        let line = compose_status(&s, 1_000_000 + 5 * 60_000);
        assert_eq!(
            line,
            "tip(5m): live on :3070 ✓ · staging aaaa1111 · main bbbb2222 ✓ latest · live bbbb2222 ✓ latest · sync ✓ in 2m · gate ✓ 5m ago"
        );
    }

    #[test]
    fn status_line_red_gate_shows_retry_countdown() {
        let mut s = snap();
        s.gate_reds = 2;
        let line = compose_status(&s, 1_000_000 + 5 * 60_000);
        assert!(line.contains("gate ✗×2 (retry in 10m)"), "{line}");
    }

    /// Strip Pango tags + unescape — the markup line must carry EXACTLY the
    /// plain line's text, or the two composers have drifted.
    fn strip_markup(s: &str) -> String {
        let mut out = String::new();
        let mut in_tag = false;
        for c in s.chars() {
            match c {
                '<' => in_tag = true,
                '>' => in_tag = false,
                _ if !in_tag => out.push(c),
                _ => {}
            }
        }
        out.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    }

    #[test]
    fn markup_matches_plain_text_content() {
        let now = 1_000_000 + 5 * 60_000;
        // behind state
        let s = snap();
        assert_eq!(strip_markup(&compose_status_markup(&s, now)), compose_status(&s, now));
        // all-current state
        let mut cur = snap();
        cur.main_behind = Some(0);
        cur.deployed_behind = Some(0);
        assert_eq!(strip_markup(&compose_status_markup(&cur, now)), compose_status(&cur, now));
        // red gate
        let mut red = snap();
        red.gate_reds = 2;
        assert_eq!(strip_markup(&compose_status_markup(&red, now)), compose_status(&red, now));
        // error (with markup-significant chars escaped)
        let err = StatusSnapshot { error: Some("a<b&c".into()), ..Default::default() };
        assert_eq!(strip_markup(&compose_status_markup(&err, now)), compose_status(&err, now));
        // unhealthy sync keeps the status word in both forms
        let mut conflict = snap();
        conflict.git_sync_status = Some("conflict".into());
        let plain = compose_status(&conflict, now);
        assert!(plain.contains("sync conflict, next in 2m"), "{plain}");
        assert_eq!(strip_markup(&compose_status_markup(&conflict, now)), plain);
    }

    #[test]
    fn markup_colors_key_segments() {
        let now = 1_000_000 + 5 * 60_000;
        let line = compose_status_markup(&snap(), now);
        // behind counts are bold amber; shas sky; verdict amber.
        assert!(line.contains("<span foreground=\"#fbbf24\" weight=\"bold\">−2</span>"), "{line}");
        assert!(line.contains("<span foreground=\"#7dd3fc\">aaaa1111</span>"), "{line}");
        assert!(line.contains("<span foreground=\"#fbbf24\" weight=\"bold\">awaiting promotion</span>"), "{line}");
        let mut cur = snap();
        cur.main_behind = Some(0);
        cur.deployed_behind = Some(0);
        let line = compose_status_markup(&cur, now);
        assert!(line.contains("<span foreground=\"#34d399\" weight=\"bold\">✓ latest</span>"), "{line}");
        assert!(line.contains("<span foreground=\"#34d399\" weight=\"bold\">live on :3070 ✓</span>"), "{line}");
    }

    #[test]
    fn countdown_formatting() {
        assert_eq!(fmt_in(0, Some(4 * 60_000)), "in 4m");
        assert_eq!(fmt_in(0, Some(65 * 60_000)), "in 1h05m");
        assert_eq!(fmt_in(0, Some(30_000)), "in <1m");
        assert_eq!(fmt_in(60_000, Some(60_000)), "due now");
        assert_eq!(fmt_in(60_000, Some(0)), "due now");
        assert_eq!(fmt_in(0, None), "?");
    }

    #[test]
    fn change_verdict_states() {
        let mut s = snap();
        // Tip not yet promoted, gate green → awaiting promotion (P-009).
        assert_eq!(change_verdict(&s), "awaiting promotion");
        // Gate red blocks promotion — say so, with the streak.
        s.gate_reds = 2;
        assert_eq!(change_verdict(&s), "awaiting green (gate red ×2)");
        s.gate_stalled = true;
        assert_eq!(change_verdict(&s), "awaiting green — gate STALLED");
        // Promoted but the release-trigger hasn't deployed yet.
        s.gate_reds = 0;
        s.gate_stalled = false;
        s.main_behind = Some(0);
        assert_eq!(change_verdict(&s), "promoted ✓, deploy pending");
        // Fully caught up.
        s.deployed_behind = Some(0);
        assert_eq!(change_verdict(&s), "live on :3070 ✓");
        // No data → no claim.
        s.main_behind = None;
        assert_eq!(change_verdict(&s), "?");
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
    fn divergence_guard_fires_when_api_did_not_follow_spa() {
        // SPA on staging but api_port still 3070 — switch_to sets both, so
        // this state should be impossible; the guard surfaces it loudly.
        let (line, warn) = compose_skew(&snap(), Some(3170));
        assert!(warn, "{line}");
        assert!(line.contains("DIVERGED"), "{line}");
    }

    #[test]
    fn parse_api_target_accepts_custom_ports_and_rejects_junk() {
        // EI-296: arbitrary localhost operator ports are allowed (the whole
        // point — iso stacks / fault proxies live outside TARGETS) …
        assert_eq!(parse_api_target(Some("3271".into())), Some(3271));
        assert_eq!(parse_api_target(Some(" 18080 ".into())), Some(18080));
        // … but unset / empty / non-numeric / privileged-port values are not.
        assert_eq!(parse_api_target(None), None);
        assert_eq!(parse_api_target(Some(String::new())), None);
        assert_eq!(parse_api_target(Some("staging".into())), None);
        assert_eq!(parse_api_target(Some("80".into())), None);
    }

    #[test]
    fn wrong_operator_flagged_when_singleton_fallback_resolves_other_port() {
        // /api targets :3170 but the discovery resolution handed us the
        // RELEASE operator (per-port file missing → singleton fallback).
        let mut s = snap();
        s.api_port = 3170;
        let (line, warn) = compose_skew(&s, Some(3170));
        assert!(warn, "{line}");
        assert!(line.contains("WRONG OPERATOR"), "{line}");
    }

    #[test]
    fn api_follows_switcher_aligned_staging() {
        let mut s = snap();
        s.api_port = 3170;
        s.ipc_owner = Some("staging-tree".into());
        let (line, warn) = compose_skew(&s, Some(3170));
        assert!(!warn, "{line}");
        assert!(line.contains("API :3170 staging-tree"), "{line}");
    }

    #[test]
    fn no_skew_when_aligned() {
        let (line, warn) = compose_skew(&snap(), Some(3070));
        assert!(!warn, "{line}");
        assert!(line.contains("API :3070 release"), "{line}");
    }

    #[test]
    fn local_vite_spa_is_not_skew() {
        // :3055 has no operator of its own; /api maps to the :3070 operator.
        let (_, warn) = compose_skew(&snap(), Some(3055));
        assert!(!warn);
    }

    #[test]
    fn api_port_mapping() {
        assert_eq!(api_port_for_target(3070), 3070);
        assert_eq!(api_port_for_target(3170), 3170);
        assert_eq!(api_port_for_target(3055), 3070); // vite has no operator
    }

    #[test]
    fn stale_ipc_writer_is_flagged() {
        let mut s = snap();
        s.ipc_owner = Some("STALE (writer pid 2842557 gone)".into());
        let (line, warn) = compose_skew(&s, Some(3070));
        assert!(warn, "{line}");
        assert!(line.contains("API :3070→STALE"), "{line}");
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
