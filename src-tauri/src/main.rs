// Papercusp desktop shell.
//
// Architecture (SP1 C5 — the desktop is an EMBEDDER of `papercusp serve`,
// plan operator-core-headless-serve-2026-06-04 Decision F):
//   1. On startup, find a free localhost port (cold-start hint).
//   2. Spawn the bundled `serve.mjs --ensure` (apps/operator/bin/serve.ts).
//      serve OWNS the operator lifecycle: embedded Postgres (start,
//      migrations, ~/.papercusp/embedded-pg.json), runBootstrap(), the Hono
//      host, and the ~/.papercusp/operator.json discovery file. `--ensure`
//      reuses an already-healthy operator instead of double-booting.
//   3. Poll operator.json until (pid alive + HTTP reachable); read the REAL
//      port from it (reuse may land on a different port than our hint).
//   4. Open the main window pointing at the discovered operator.
//   5. On window-close, SIGTERM the serve child (it stops PG + removes
//      operator.json on the way down).
//
// Rust retains: webview, endpoint-IPC client, the papercusp:// custom
// protocol, window management, PTY, workspace HOME isolation, and the update
// checker. Everything PG/operator process-management moved INTO serve.
// (code-server is retired — owner directive 2026-07-07 — no longer bundled or
// spawned.)
//
// The same `serve.mjs` is what we'd run in a cloud container — no shell-out
// into platform-specific tooling here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_role;
mod custom_protocol;
mod dev_bridge;
// Global-hotkey docs-search palette (WI-2648, feature #5): an opt-in global
// shortcut opens a small always-on-top window loading Pagefind's own default UI
// against the already-built operator-docs search index. OFF BY DEFAULT (owner
// directive 2026-07-12) — a global shortcut is a system-wide key grab, so nothing
// is registered until the user picks a key in the Server tray's "Docs search
// shortcut" submenu (whose first item is "Off").
mod docs_search;
// Env-switch plumbing — the desktop-side source of truth + /api routing for the
// cross-platform in-webview EnvSwitcherBar and its native backstop. Replaces the
// retired Linux-only GTK dev-wrapper bar and the chrome-webview experiment.
// Compiled on every platform (list_envs is a registered command); it returns no
// envs in a packaged single-operator build, so it's inert there.
mod endpoint_ipc;
mod endpoint_ipc_framing;
mod env_switch;
mod fd_limit;
mod native_console;
mod native_terminal;
mod pty;
mod workspaces;
mod wsl_setup;

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// Minimal RFC 3986 percent-encoding for the path component. Only the
/// reserved + unsafe set; we avoid pulling in a full url crate dep just
/// for this. Used to encode the workspace id into the harness URL query.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

struct SidecarState {
    /// The `serve.mjs --ensure` child (SP1 C5). serve owns embedded-PG
    /// in-process, so there is no separate db child anymore. None when
    /// --ensure reused an operator another process owns (we then must NOT
    /// kill it on exit — it isn't ours).
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
    /// Endpoint-IPC socket path resolved from the operator's
    /// `~/.papercusp/endpoint-ipc.json` discovery file (written by
    /// runBootstrap inside serve). None when IPC is disabled or discovery
    /// hadn't completed yet.
    endpoint_ipc_socket: Mutex<Option<String>>,
    /// One-shot guard for the exit teardown (P-051): ExitRequested AND Exit
    /// both fire on a normal quit, and each used to run the full
    /// terminal+sidecar teardown again. `shutdown_children_once` swaps this
    /// to make the teardown idempotent.
    shutdown_done: std::sync::atomic::AtomicBool,
}

fn find_free_port() -> Option<u16> {
    portpicker::pick_unused_port()
}

/// (P-055) Put a child in its own Windows process group so graceful_kill's
/// CTRL_BREAK_EVENT targets that child's group instead of ours (without
/// CREATE_NEW_PROCESS_GROUP the pid isn't a group id and the event would
/// fan out to our whole console group, including this process).
///
/// (EI-8894) On Unix (macOS/Linux) this ALSO puts the child in its own
/// process group (`setpgid(0, 0)` via the stable `process_group(0)` builder
/// — child pid becomes the new group's pgid). Root cause #1 of EI-8894: a
/// hard-killed parent (`launchctl kickstart -k`, `pkill -9`, a crash) skips
/// our own SIGTERM/graceful-shutdown path entirely, and an un-grouped child
/// has no group boundary a sweep can target — only a same-pid kill (which
/// nothing sends) reaches it, so it survives as an orphan holding ports/
/// storage under stale env. A distinct group is a PRECONDITION for any
/// future/external "kill everything this app ever spawned" sweep (`kill
/// -TERM -<pgid>`) to work at all; it does not by itself stop an orphan
/// (see the parent-death self-exit watch in serve.ts for that half).
fn isolate_process_group(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: console children (wsl.exe, node) of this GUI app
        // otherwise get a VISIBLE console window dropped over the webview
        // (found live 2026-06-11: a raw wsl.exe console covered the wizard).
        // The child still owns an (invisible) conhost, so the P-055
        // CTRL_BREAK_EVENT graceful-kill path keeps working.
        cmd.creation_flags(
            windows::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP.0
                | windows::Win32::System::Threading::CREATE_NO_WINDOW.0,
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = cmd;
    }
}

/// Pull the `socketPath` field out of the dev discovery JSON
/// (`~/.papercusp/endpoint-ipc.json`, written by
/// apps/operator/lib/endpoint-ipc-discovery.ts), or `None`. Used as the
/// `IpcClientHandle` socket source in BOTH setup branches (dev points at the
/// externally-run operator; production reads the file serve's runBootstrap
/// writes — SP1 C5), so each reconnect re-reads the file and picks up a
/// restarted operator's new socket.
fn read_dev_ipc_socket(path: &std::path::Path) -> Option<String> {
    let txt = std::fs::read_to_string(path).ok()?;
    parse_endpoint_ipc_socket(&txt)
}

/// Parse + target-validate a `socketPath` out of endpoint-ipc.json text.
/// Shared by the filesystem read (`read_dev_ipc_socket`) and the WSL `cat`
/// read (`read_endpoint_ipc_socket_via_wsl`) so both classify the endpoint
/// identically (Windows accepts `\\.\pipe\` or `tcp://`; others accept a unix
/// socket or `tcp://`).
fn parse_endpoint_ipc_socket(txt: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(txt).ok()?;
    let socket_path = v.get("socketPath")?.as_str()?.trim();
    if endpoint_ipc_socket_path_supported_for_target(socket_path, cfg!(target_os = "windows")) {
        Some(socket_path.to_string())
    } else {
        None
    }
}

fn endpoint_ipc_socket_path_supported_for_target(socket_path: &str, target_windows: bool) -> bool {
    if socket_path.trim().is_empty() {
        return false;
    }
    let is_windows_pipe = is_windows_named_pipe_path(socket_path);
    if target_windows {
        // WI-3395: on Windows the sidecar runs inside WSL2 and reaches the host
        // over loopback TCP, so a `tcp://` endpoint is the real path; a named
        // pipe stays valid for a hypothetical native sidecar. A Unix-socket
        // path is never openable from the Windows host — reject it.
        is_windows_pipe || is_tcp_endpoint(socket_path)
    } else {
        // Non-Windows hosts run the sidecar natively: accept a Unix socket (the
        // usual case) or a `tcp://` loopback endpoint; never a Windows pipe.
        !is_windows_pipe
    }
}

fn is_windows_named_pipe_path(socket_path: &str) -> bool {
    let lower = socket_path.to_ascii_lowercase();
    lower.starts_with("\\\\.\\pipe\\") || lower.starts_with("\\\\?\\pipe\\")
}

/// A `tcp://host:port` endpoint-IPC address (WI-3395). Emitted by the Node
/// server's `parse_endpoint` when the sidecar is told to bind loopback TCP
/// (`PAPERCUSP_IPC_TCP=1` — the WSL2/Windows case). Kept in lockstep with that
/// classifier and `parse_tcp_endpoint` in endpoint_ipc.rs.
fn is_tcp_endpoint(socket_path: &str) -> bool {
    socket_path.trim().to_ascii_lowercase().starts_with("tcp://")
}

/// EI-190: the operator PORT the desktop's /api endpoint-IPC currently
/// targets. Default :3070 (the green release operator — today's implicit
/// behavior made explicit). The dev wrapper's build switcher stores the
/// mapped target here (`env_switch::api_port_for_target`) and resets the
/// IPC client so /api follows the selected build instead of riding
/// whichever operator last rewrote the singleton discovery file.
pub static SELECTED_API_PORT: std::sync::atomic::AtomicU16 =
    std::sync::atomic::AtomicU16::new(3070);

/// Per-port discovery read (EI-190): prefer `endpoint-ipc.<port>.json`
/// (every operator boot publishes it since the per-port change), falling
/// back to the legacy last-writer-wins singleton for an operator that
/// hasn't restarted since the change shipped.
///
/// EI-296: the singleton fallback applies ONLY to the fixed dev-box
/// operators (:3070/:3170) — it is "whichever operator booted last". A
/// CUSTOM target (the PAPERCUSP_DEV_API_TARGET escape hatch, e.g. an
/// isolated test stack or fault proxy) must never silently dial another
/// operator's socket: it either publishes its own per-port file or is
/// reached over HTTP at exactly that port.
fn read_dev_ipc_socket_for_port(papercusp_dir: &std::path::Path, port: u16) -> Option<String> {
    let per_port = read_dev_ipc_socket(&papercusp_dir.join(format!("endpoint-ipc.{port}.json")));
    if per_port.is_some() || !matches!(port, 3070 | 3170) {
        return per_port;
    }
    read_dev_ipc_socket(&papercusp_dir.join("endpoint-ipc.json"))
}

/// Prepend the bundled runtime dir (sidecar `bin/`, which ships `node` + vendored
/// CLIs) to PATH. The packaged desktop app's process PATH has no `node` (a GUI /
/// `.deb` launch inherits a minimal PATH), so a bare `Command::new("node")`
/// resolves against the child PATH and fails with ENOENT on a clean machine.
/// EVERY node-based sidecar spawn (host, embedded-postgres-server,
/// zero-cache-server) must route through this. `dir` is the sidecar root that
/// contains `bin/`.
fn bundled_path_env(dir: &std::path::Path) -> String {
    let bundled_bin = dir.join("bin");
    let path_sep = if cfg!(windows) { ";" } else { ":" };
    let existing_path = std::env::var("PATH").unwrap_or_default();
    format!(
        "{}{}{}",
        bundled_bin.to_string_lossy(),
        path_sep,
        existing_path
    )
}

/// (SP1 C5) The embedded-postgres + zero-cache process management that used
/// to live here moved INTO `serve.mjs` (apps/operator/bin/serve.ts): PG
/// port selection, the orphan-postmaster sweep, the PG wire-protocol ready
/// probe, migrations, and the embedded-pg.json write are all serve's now.
/// The legacy opt-in zero-cache spawn (PAPERCUSP_USE_ZERO_CACHE=1) was
/// removed outright — the SSE path replaced the Zero WS transport on
/// desktop 2026-05-07 and the bundle no longer ships zero-cache-server.

/// Spawn the Node sidecar from inside the bundled sidecar dir. In dev
/// (`tauri dev`), we skip this — the developer runs `npm run dev:papercusp`
/// separately and the webview points at devUrl from tauri.conf.json.
/// On Windows we route the sidecar through WSL so the harness's POSIX
/// assumptions (bash, overmind, unix sockets, fs.watch semantics) work.
/// Returns true once the user has finished the WslOnboardingGate flow
/// (state == Ready). On non-Windows always returns false.
#[cfg(target_os = "windows")]
fn should_route_via_wsl(app: &tauri::AppHandle) -> bool {
    matches!(wsl_setup::detect(app).state, wsl_setup::WslState::Ready)
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn should_route_via_wsl(_app: &tauri::AppHandle) -> bool {
    false
}

/// Translate a Windows path to a WSL-visible path. Pure string
/// manipulation — doesn't shell out to `wslpath`. Handles:
///
///   - Drive letters:        `C:\foo\bar`     → `/mnt/c/foo/bar`
///   - Long-path syntax:     `\\?\C:\foo`     → `/mnt/c/foo`
///   - UNC long-path:        `\\?\UNC\srv\s` → `//srv/s` (rare; passes
///                           through with forward slashes — WSL mounts
///                           UNC paths via 9p, but only when the user
///                           explicitly mounted them; we leave the path
///                           as a forward-slash UNC and let the kernel
///                           ENOENT if unmounted)
///   - Plain UNC:            `\\srv\share`    → `//srv/share`
///   - Already-posix:        `/foo/bar`       → `/foo/bar` (no-op)
///
/// Defined on every platform so the helper is unit-testable from CI
/// regardless of host OS. Used by the Windows-only sidecar-via-WSL
/// path; see `make_sidecar_command`.
/// Auto-grant getUserMedia (microphone/camera) on Linux WebKitGTK.
///
/// WebKitGTK denies media access by default — the webview emits a
/// `permission-request` signal and refuses if nobody listens. That
/// surfaces in JS as `navigator.mediaDevices.getUserMedia()` rejecting
/// with `NotAllowedError`, which the operator's voice/wake-word/
/// elevenlabs paths report as console errors on every page load when
/// the user has `lastMode != 'off'` saved.
///
/// We auto-grant because the Tauri shell is the only consumer of the
/// webview — there is no third-party site asking; permission gating
/// would just trip up our own code.
#[cfg(target_os = "linux")]
fn grant_media_permission<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.with_webview(|webview| {
        use webkit2gtk::glib::ObjectExt;
        use webkit2gtk::WebViewExt;
        let wv: webkit2gtk::WebView = webview.inner();
        wv.connect_permission_request(|_, req| {
            // Allow audio/video media access requests; pass on everything else.
            if req.is::<webkit2gtk::UserMediaPermissionRequest>() {
                use webkit2gtk::PermissionRequestExt;
                req.allow();
            }
            // Returning false means "we didn't handle it"; for media we
            // already called allow() so the request is satisfied either way.
            false
        });
    });
}

/// EI-239: a main-frame load failure (operator briefly down during a reload
/// or full navigation) used to strand the webview on WebKitGTK's raw
/// "Could not connect" page — where even Ctrl+R after recovery is dead, and
/// production builds (no dev-wrapper target buttons) had NO recovery short
/// of restarting the app. Replace it with a bundled retry page that polls
/// the failed URI and navigates back the moment the origin answers.
#[cfg(target_os = "linux")]
fn install_load_failure_recovery<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.with_webview(|webview| {
        use webkit2gtk::WebViewExt;
        let wv: webkit2gtk::WebView = webview.inner();
        wv.connect_load_failed(|wv, _event, failing_uri, error| {
            // Cancellations are NORMAL navigation (a load superseded by a
            // newer one, a download) — intercepting them would break the app.
            if error.matches(webkit2gtk::NetworkError::Cancelled)
                || error.matches(webkit2gtk::PolicyError::FrameLoadInterruptedByPolicyChange)
            {
                return false;
            }
            eprintln!(
                "[papercusp-desktop] main-frame load failed for {failing_uri} ({error}) — showing recovery page"
            );
            // content_uri = the failed URI so the page keeps that security
            // origin: its same-origin health poll dials exactly the origin
            // that died.
            wv.load_alternate_html(&recovery_page_html(failing_uri), failing_uri, Some(failing_uri));
            true
        });
    });
}

fn restore_window_visibility_once<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    reason: &str,
) {
    #[cfg(target_os = "linux")]
    {
        let reason_for_gtk = reason.to_string();
        let window_for_gtk = window.clone();
        if let Err(e) = window.run_on_main_thread(move || {
            use gtk::prelude::*;
            match window_for_gtk.gtk_window() {
                Ok(gtk_window) => {
                    gtk_window.set_skip_taskbar_hint(false);
                    gtk_window.set_skip_pager_hint(false);
                    gtk_window.deiconify();
                    gtk_window.present();
                }
                Err(e) => {
                    eprintln!(
                        "[papercusp-desktop] window restore ({reason_for_gtk}): gtk_window failed: {e}"
                    );
                }
            }
        }) {
            eprintln!(
                "[papercusp-desktop] window restore ({reason}): main-thread GTK restore failed: {e}"
            );
        }
    }

    if let Err(e) = window.unminimize() {
        eprintln!("[papercusp-desktop] window restore ({reason}): unminimize failed: {e}");
    }
    if let Err(e) = window.show() {
        eprintln!("[papercusp-desktop] window restore ({reason}): show failed: {e}");
    }
    if let Err(e) = window.set_focus() {
        eprintln!("[papercusp-desktop] window restore ({reason}): set_focus failed: {e}");
    }
}

fn restore_window_visibility<R: tauri::Runtime + 'static>(
    window: &tauri::WebviewWindow<R>,
    reason: &'static str,
) {
    restore_window_visibility_once(window, reason);

    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        for delay_ms in [250_u64, 1_000, 2_500] {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            restore_window_visibility_once(&window, reason);
        }
    });
}

/// The bundled offline-recovery page (EI-239). Self-contained inline
/// HTML+JS: polls the failed URI once a second (any HTTP response counts —
/// an error status still proves the origin is back) and navigates to it on
/// recovery; a manual "Retry now" button covers schemes where fetch can't
/// poll. The URI is embedded as a JSON string literal, with `<` further
/// escaped to `<`: JSON alone leaves `</script>` intact inside the
/// literal, which would still terminate the script element.
#[cfg(target_os = "linux")]
fn recovery_page_html(failing_uri: &str) -> String {
    let uri_js = serde_json::to_string(failing_uri)
        .unwrap_or_else(|_| "\"/\"".to_string())
        .replace('<', "\\u003c");
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>Papercusp — reconnecting</title><style>
  html,body{{height:100%;margin:0;background:#101216;color:#d6dae2;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}}
  .wrap{{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px}}
  h1{{font-size:17px;font-weight:600;margin:0}}
  p{{margin:0;color:#8a92a3;max-width:46ch}}
  button{{margin-top:6px;padding:7px 18px;border-radius:8px;border:1px solid #3a4254;background:#1a1f29;color:#d6dae2;font:inherit;cursor:pointer}}
  button:hover{{background:#232a38}}
  .dot{{width:9px;height:9px;border-radius:50%;background:#e0b54a;animation:b 1.2s ease-in-out infinite}}
  @keyframes b{{50%{{opacity:.25}}}}
</style></head><body><div class="wrap">
  <div class="dot"></div>
  <h1>Papercusp lost its operator process</h1>
  <p>The window will reconnect automatically as soon as the operator is back. Nothing is lost — this page is polling for it.</p>
  <button onclick="location.replace(TARGET)">Retry now</button>
  <script>
    const TARGET = {uri_js};
    async function poll() {{
      try {{
        await fetch(TARGET, {{ method: 'HEAD', cache: 'no-store' }});
        location.replace(TARGET);
      }} catch (_e) {{
        setTimeout(poll, 1000);
      }}
    }}
    poll();
  </script>
</div></body></html>"#
    )
}

// Only compiled where it is actually used: the production callers live in the
// `#[cfg(target_os = "windows")]` block of make_sidecar_command, and the unit
// tests below exercise it on every platform. Without this gate a non-test Linux
// build (the dev-box default `cargo check`) sees zero callers → dead_code warn.
#[cfg(any(target_os = "windows", test))]
fn windows_path_to_wsl(path: &std::path::Path) -> String {
    let s = path.to_string_lossy().to_string();
    // Already a posix-style path? Leave it alone.
    if s.starts_with('/') && !s.starts_with("//") {
        return s;
    }

    // Strip the long-path prefix (`\\?\` or `\\?\UNC\`). Beyond
    // ~260-char paths, Windows APIs use this prefix — it shows up in
    // resource resolution sometimes.
    let rest = if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        // \\?\UNC\server\share\... — re-form as a regular UNC path so
        // the rest of the function handles it.
        format!(r"\\{}", stripped)
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        s
    };

    // Plain UNC path (`\\server\share\...`)? Translate to forward
    // slashes; WSL doesn't have a built-in mount for these, but the
    // forward-slash form is what wsl.exe interprets identically when
    // a 9p mount happens to exist.
    if rest.starts_with(r"\\") {
        return rest.replace('\\', "/");
    }

    let normalized = rest.replace('\\', "/");

    // Drive-letter prefix: `C:/foo` → `/mnt/c/foo`.
    if let Some((drive, after)) = normalized.split_once(':') {
        if drive.len() == 1
            && drive
                .chars()
                .next()
                .map(|c| c.is_ascii_alphabetic())
                .unwrap_or(false)
        {
            let drive_lower = drive.to_lowercase();
            // Ensure the rest starts with `/` (handles `C:foo` weirdly
            // by keeping it relative, though that's not a valid
            // Windows resource path in our context).
            let after = if after.starts_with('/') {
                after.to_string()
            } else {
                format!("/{}", after)
            };
            return format!("/mnt/{}{}", drive_lower, after);
        }
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::windows_path_to_wsl;
    use std::path::PathBuf;

    fn t(input: &str, expected: &str) {
        let got = windows_path_to_wsl(&PathBuf::from(input));
        assert_eq!(got, expected, "input={:?}", input);
    }

    /// The sidecar runs INSIDE WSL2 on Windows, so a var set with `Command::env`
    /// reaches it ONLY if it is also named in WSLENV. A var that is set but not
    /// listed is dropped SILENTLY — no error, no log, Windows only, at runtime.
    ///
    /// That is how Windows auto-update shipped dead: PAPERCUSP_RELEASE_HOST was
    /// baked into the .exe and set via `.env(...)`, but never crossed into WSL, so
    /// `releaseHostBase()` read undefined, the manifest route answered
    /// `cannot_check`, and the updater rendered that as "you're on the latest" —
    /// permanently. The bake was real; the value never arrived where it was used.
    ///
    /// This test pins the vars whose ABSENCE is silent-but-fatal. It is the only
    /// thing standing between the two lists (`.env(...)` and WSLENV) and the next
    /// silent divergence.
    #[test]
    fn wslenv_forwards_every_var_the_sidecar_reads() {
        let wslenv = super::SIDECAR_WSLENV;
        // Split on ':' and strip any '/p' (path-translation) suffix, so a var is
        // matched as a NAME — never as a substring of a longer var, which would
        // let PAPERCUSP_RELEASE_HOST_FOO satisfy a check for PAPERCUSP_RELEASE_HOST.
        let names: Vec<&str> = wslenv
            .split(':')
            .map(|e| e.trim())
            .map(|e| e.split('/').next().unwrap_or(e))
            .filter(|e| !e.is_empty())
            .collect();

        for required in [
            // THE ONE THIS TEST EXISTS FOR: the sidecar's releaseHostBase() reads
            // process.env.PAPERCUSP_RELEASE_HOST. Without this, auto-update is dead
            // on Windows and reports success while being dead.
            "PAPERCUSP_RELEASE_HOST",
            // Endpoint-IPC: WI-3395 — PAPERCUSP_IPC_ENABLE not crossing is why the
            // IPC server never even STARTED inside WSL2 under packaged production.
            "PAPERCUSP_IPC_ENABLE",
            "PAPERCUSP_IPC_TCP",
            // The sidecar cannot serve or find itself without these.
            "PAPERCUSP_HONO_PORT",
            "PAPERCUSP_BIND_HOST",
            "PAPERCUSP_SIDECAR_BIN",
            "PAPERCUSP_SERVE_UI",
        ] {
            assert!(
                names.contains(&required),
                "{required} is NOT in WSLENV — on Windows the sidecar runs inside WSL2, so this \
                 var will be set by Command::env and then silently dropped at the boundary. \
                 It will look fine on Linux and Mac and be dead on Windows. WSLENV = {wslenv}"
            );
        }
    }

    /// EI-239: the recovery page embeds the failed URI as a JSON string
    /// literal — quoting in the URL must not escape the script context.
    #[cfg(target_os = "linux")]
    #[test]
    fn recovery_page_embeds_uri_safely() {
        let html = super::recovery_page_html("http://127.0.0.1:3170/adv?ws=x");
        assert!(html.contains(r#"const TARGET = "http://127.0.0.1:3170/adv?ws=x";"#));
        assert!(html.contains("Retry now"));

        let hostile = super::recovery_page_html(r#"http://x/"</script><script>alert(1)"#);
        // The quote is JSON-escaped and `<` is unicode-escaped, so neither a
        // raw </script> nor a raw <script> from the URI survives in the HTML.
        assert!(!hostile.contains("</script><script>alert"));
        assert!(hostile.contains(r#"\""#));
        assert!(hostile.contains(r"</script"));
    }

    #[test]
    fn drive_letter() {
        t(r"C:\foo\bar", "/mnt/c/foo/bar");
        t(r"D:\Users\me\Desktop", "/mnt/d/Users/me/Desktop");
        t(r"c:\lower", "/mnt/c/lower");
    }

    #[test]
    fn long_path_prefix() {
        t(r"\\?\C:\very\long\path", "/mnt/c/very/long/path");
        t(r"\\?\D:\foo", "/mnt/d/foo");
    }

    #[test]
    fn unc_long_path_prefix() {
        // \\?\UNC\server\share\path → //server/share/path
        t(r"\\?\UNC\srv\share\file", "//srv/share/file");
    }

    #[test]
    fn plain_unc() {
        t(r"\\server\share\foo", "//server/share/foo");
    }

    #[test]
    fn already_posix_passthrough() {
        // Forward-slash absolute paths aren't transformed (they may be
        // legitimate Linux paths in the WSL distro).
        t("/home/papercup", "/home/papercup");
    }

    #[test]
    fn forward_slash_drive_letter() {
        // `C:/foo` is an alternate Windows form; treat it the same as
        // backslash form.
        t("C:/foo/bar", "/mnt/c/foo/bar");
    }

    #[test]
    fn mixed_separators() {
        t(r"C:\foo/bar\baz", "/mnt/c/foo/bar/baz");
    }

    /// P-009: the single-instance lock keys on the app IDENTIFIER, so the two
    /// bundles' identifiers MUST stay distinct — otherwise both bundles would
    /// share ONE lock and a GUI + a Server would evict each other instead of
    /// coexisting (the GUI attaching to the sidecar-owning Server). This is the
    /// load-bearing invariant behind per-bundle-identity single-instance.
    #[test]
    fn bundle_ids_are_distinct_for_per_bundle_single_instance() {
        assert_ne!(
            super::SERVER_BUNDLE_ID,
            super::GUI_BUNDLE_ID,
            "GUI and Server bundle ids must differ or their single-instance locks collapse"
        );
        // And each identifier maps to the role on_second_instance() expects.
        use crate::app_role::{detect, Role};
        assert_eq!(detect(super::SERVER_BUNDLE_ID), Role::Server);
        assert_eq!(detect(super::GUI_BUNDLE_ID), Role::Gui);
    }

    #[test]
    fn spaces_in_username_preserved() {
        // WI-792 P-004 / alpha P-010g (spaces-in-username path-translation edge):
        // a Windows username with spaces must survive translation INTACT. The
        // translated path is passed to wsl.exe as a SINGLE argv element by
        // make_sidecar_command (`.args([…, &cwd_wsl, …])`, NOT a shell string),
        // so an embedded space does not split the argument — the only requirement
        // is that translation leave the space untouched. This guards that.
        t(
            r"C:\Users\First Last\AppData\Local\Papercusp",
            "/mnt/c/Users/First Last/AppData/Local/Papercusp",
        );
        t(
            r"C:\Users\Ada Lovelace\.papercusp",
            "/mnt/c/Users/Ada Lovelace/.papercusp",
        );
        // mixed separators + spaces together
        t(
            r"C:\Users\Jane Doe/work\repo",
            "/mnt/c/Users/Jane Doe/work/repo",
        );
    }
}

#[cfg(test)]
mod serve_log_tests {
    // WI-1707: the packaged app has no console, so the sidecar's stdout/stderr
    // must land in a rotated <home>/.papercusp/logs/serve.log. This guards both
    // that the log is created AND that each spawn shifts the ring correctly
    // (live log → .1 → .2), so history survives a crash-respawn.
    #[cfg(target_os = "linux")]
    #[test]
    fn serve_log_creates_and_rotates() {
        use std::fs;
        let home = std::env::temp_dir().join(format!("pcusp-serve-log-{}", std::process::id()));
        let logs = home.join(".papercusp").join("logs");
        let _ = fs::remove_dir_all(&home);

        // First spawn: creates a fresh logs/serve.log.
        assert!(
            super::rotating_log_stdio(&home, "serve.log").is_some(),
            "log setup should succeed"
        );
        // (drop closes the returned Stdio file handles.)
        assert!(logs.join("serve.log").exists());
        // Tag the live log so we can prove rotation moves THIS file next time.
        fs::write(logs.join("serve.log"), b"gen-A").unwrap();

        // Second spawn: serve.log(gen-A) → serve.log.1, fresh serve.log.
        assert!(super::rotating_log_stdio(&home, "serve.log").is_some());
        assert!(logs.join("serve.log").exists());
        assert_eq!(fs::read(logs.join("serve.log.1")).unwrap(), b"gen-A");
        fs::write(logs.join("serve.log"), b"gen-B").unwrap();

        // Third spawn: .1(gen-A) → .2, serve.log(gen-B) → .1.
        assert!(super::rotating_log_stdio(&home, "serve.log").is_some());
        assert_eq!(fs::read(logs.join("serve.log.1")).unwrap(), b"gen-B");
        assert_eq!(fs::read(logs.join("serve.log.2")).unwrap(), b"gen-A");

        let _ = fs::remove_dir_all(&home);
    }

    // WI-1781: rotating_log_stdio is basename-keyed — a second logfile routed
    // through the SAME helper must rotate independently of serve.log (no
    // cross-contamination between distinct log basenames).
    #[cfg(target_os = "linux")]
    #[test]
    fn rotating_log_stdio_isolates_basenames() {
        use std::fs;
        let home = std::env::temp_dir().join(format!("pcusp-aux-log-{}", std::process::id()));
        let logs = home.join(".papercusp").join("logs");
        let _ = fs::remove_dir_all(&home);

        // serve.log gets one generation…
        assert!(super::rotating_log_stdio(&home, "serve.log").is_some());
        fs::write(logs.join("serve.log"), b"serve-A").unwrap();
        // …and a second logfile its own, created fresh alongside it.
        assert!(super::rotating_log_stdio(&home, "aux.log").is_some());
        assert!(logs.join("aux.log").exists());
        fs::write(logs.join("aux.log"), b"aux-A").unwrap();

        // Rotating aux.log must NOT touch serve.log's live file or ring.
        assert!(super::rotating_log_stdio(&home, "aux.log").is_some());
        assert_eq!(fs::read(logs.join("aux.log.1")).unwrap(), b"aux-A");
        assert!(
            !logs.join("serve.log.1").exists(),
            "serve.log ring untouched by aux.log rotation"
        );
        assert_eq!(fs::read(logs.join("serve.log")).unwrap(), b"serve-A");

        let _ = fs::remove_dir_all(&home);
    }

    // WI-1803: the app's OWN process (not just its child sidecars) has fd 1/2 at
    // /dev/null under a console-less packaged launch, so this binary's own boot/
    // navigation eprintln!s — the ones that pin down the WI-1802 blank page —
    // were lost. redirect_own_stdio dup2's a rotated on-disk log over stdout AND
    // stderr. Prove the redirect actually routes BOTH raw fds to gui.log (we
    // write to the raw fds, not println!, because libtest intercepts
    // println!/eprintln! via a thread-local sink BEFORE they reach fd 1/2), then
    // RESTORE the harness's real stdio so its own output isn't clobbered.
    #[cfg(target_os = "linux")]
    #[test]
    fn redirect_own_stdio_captures_process_fds() {
        use std::fs;
        let home = std::env::temp_dir().join(format!("pcusp-gui-log-{}", std::process::id()));
        let logs = home.join(".papercusp").join("logs");
        let _ = fs::remove_dir_all(&home);

        // Save the real stdout/stderr so we can put them back after the swap.
        let saved_out = unsafe { libc::dup(libc::STDOUT_FILENO) };
        let saved_err = unsafe { libc::dup(libc::STDERR_FILENO) };
        assert!(saved_out >= 0 && saved_err >= 0, "dup of real stdio failed");

        super::redirect_own_stdio(&home, "gui.log");
        let out_msg = b"[[MARK-STDOUT-1803]]\n";
        let err_msg = b"[[MARK-STDERR-1803]]\n";
        unsafe {
            libc::write(
                libc::STDOUT_FILENO,
                out_msg.as_ptr() as *const libc::c_void,
                out_msg.len(),
            );
            libc::write(
                libc::STDERR_FILENO,
                err_msg.as_ptr() as *const libc::c_void,
                err_msg.len(),
            );
            // Restore the harness's real stdio and drop the saved copies.
            libc::dup2(saved_out, libc::STDOUT_FILENO);
            libc::dup2(saved_err, libc::STDERR_FILENO);
            libc::close(saved_out);
            libc::close(saved_err);
        }

        let contents = fs::read_to_string(logs.join("gui.log")).unwrap();
        assert!(
            contents.contains("[[MARK-STDOUT-1803]]"),
            "stdout not redirected to gui.log: {contents:?}"
        );
        assert!(
            contents.contains("[[MARK-STDERR-1803]]"),
            "stderr not redirected to gui.log: {contents:?}"
        );

        let _ = fs::remove_dir_all(&home);
    }
}

// WI-1802: the packaged macOS webview dials the operator over PLAINTEXT http on
// the 127.0.0.1 loopback LITERAL (serve binds 127.0.0.1 only; finish_boot forces
// the literal over `localhost` because WebKitGTK may resolve `localhost` to ::1).
// macOS ATS blocks plaintext http by default, and a `localhost`-HOSTNAME
// exception does NOT cover the 127.0.0.1 IP literal — so ATS silently blocked
// every operator request and the GUI rendered a blank white page on packaged Mac
// builds (Linux/webkit2gtk has no ATS, so it only bit the Mac app). The fix is
// the loopback ATS exception `NSAllowsLocalNetworking` in Info.plist. Guard it so
// the key can't be dropped back out (re-blanking the Mac app) without failing CI.
#[cfg(test)]
mod macos_ats_tests {
    const INFO_PLIST: &str = include_str!("../Info.plist");

    #[test]
    fn info_plist_grants_loopback_ats_exception() {
        assert!(
            INFO_PLIST.contains("NSAppTransportSecurity"),
            "Info.plist must declare an ATS policy dict"
        );
        assert!(
            INFO_PLIST.contains("NSAllowsLocalNetworking"),
            "Info.plist must set NSAllowsLocalNetworking so macOS ATS permits the \
             http://127.0.0.1:<port> operator loopback the webview dials — without \
             it the packaged Mac GUI blanks (WI-1802)"
        );
    }
}

#[cfg(test)]
mod discovery_tests {
    use std::time::Duration;

    use super::{
        next_operator_port, operator_boot_timeout, parse_operator_discovery, OperatorDiscovery,
    };

    #[test]
    fn wsl_cold_boot_budget_covers_database_recovery() {
        assert_eq!(operator_boot_timeout(true), Duration::from_secs(600));
        assert_eq!(operator_boot_timeout(false), Duration::from_secs(120));
    }

    #[test]
    fn parses_valid_payload() {
        let d = parse_operator_discovery(r#"{"port":3070,"pid":1234}"#).unwrap();
        assert_eq!(d.port, 3070);
        assert_eq!(d.pid, 1234);
    }

    #[test]
    fn tolerates_extra_fields() {
        assert!(
            parse_operator_discovery(r#"{"port":1,"pid":2,"startedAt":"2026-06-10"}"#).is_some()
        );
    }

    #[test]
    fn rejects_zero_port_or_pid() {
        // A half-written discovery file must read as "not ready", never as
        // a connect target.
        assert!(parse_operator_discovery(r#"{"port":0,"pid":12}"#).is_none());
        assert!(parse_operator_discovery(r#"{"port":3070,"pid":0}"#).is_none());
    }

    #[test]
    fn rejects_garbage_and_missing_fields() {
        assert!(parse_operator_discovery("not json").is_none());
        assert!(parse_operator_discovery("{}").is_none());
        assert!(parse_operator_discovery(r#"{"port":3070}"#).is_none());
        assert!(parse_operator_discovery(r#"{"pid":3070}"#).is_none());
    }

    // WI-3282 fix direction 1: cmdline verification guards a recycled pid in a
    // stale operator.json from false-positively reading as "our live operator".
    use super::cmdline_looks_like_serve;

    #[test]
    fn cmdline_check_matches_serve_mjs_and_ts() {
        assert!(cmdline_looks_like_serve("node /opt/papercusp/sidecar/serve.mjs --ensure"));
        assert!(cmdline_looks_like_serve(
            "/usr/bin/tsx apps/operator/bin/serve.ts --ensure"
        ));
        // /proc/<pid>/cmdline is NUL-joined; callers replace NUL with a space
        // before calling this, so a space-joined argv must still match.
        assert!(cmdline_looks_like_serve("node serve.mjs --ensure"));
    }

    #[test]
    fn cmdline_check_rejects_a_recycled_pid_owned_by_something_else() {
        // The exact class this guards: the OS reassigns a stale operator.json's
        // pid to an unrelated process (a shell, `cat`, another app) — bare
        // pid-aliveness would wrongly call this "our operator".
        assert!(!cmdline_looks_like_serve("/bin/bash -c sleep 100"));
        assert!(!cmdline_looks_like_serve("cat /home/user/.papercusp/operator.json"));
        assert!(!cmdline_looks_like_serve(""));
    }

    #[test]
    fn cmdline_check_is_case_insensitive() {
        assert!(cmdline_looks_like_serve("NODE SERVE.MJS --ensure"));
    }

    // WI-1869: the operator watcher's re-navigate decision. These run on Linux
    // CI, where the macOS/Windows dynamic-port restart path they guard can never
    // be exercised — the exact blind spot that let strand-on-restart ship.
    #[test]
    fn watcher_follows_a_port_change() {
        // Server restart moved the operator :21385 -> :21927 (the live repro).
        let latest = OperatorDiscovery {
            port: 21927,
            pid: 50461,
        };
        assert_eq!(next_operator_port(21385, Some(&latest)), Some(21927));
    }

    #[test]
    fn watcher_ignores_same_port() {
        // A same-port bounce (dev box: fixed :3070) is NOT a move — don't churn.
        let latest = OperatorDiscovery {
            port: 3070,
            pid: 999,
        };
        assert_eq!(next_operator_port(3070, Some(&latest)), None);
    }

    #[test]
    fn watcher_holds_when_discovery_absent() {
        // operator.json gone / half-written (parse -> None): stay put, don't
        // navigate to nowhere; wait for the next tick to see a valid operator.
        assert_eq!(next_operator_port(3070, None), None);
    }

    // WI-2667: the watcher's Server-respawn decision. Same Linux-CI blind-spot
    // rationale as the port-follow tests above — the macOS respawn path that
    // recovers a dead packaged Server can't run here, so guard the pure decision.
    use super::{decide_server_supervision, ServerSupervisionAction as A};

    // A live Server just resets the dead counter.
    // (Args: process_alive, server_shell_alive, in_boot_grace, dead_count,
    // dead_threshold, respawns_in_window, max_respawns, already_gave_up.)
    #[test]
    fn supervision_healthy_when_process_alive() {
        assert_eq!(
            decide_server_supervision(true, false, false, 0, 10, 0, 5, false),
            A::Healthy
        );
        // …even if it was flapping a moment ago (dead_count carried in).
        assert_eq!(
            decide_server_supervision(true, false, false, 7, 10, 0, 5, false),
            A::Healthy
        );
    }

    // A dead Server inside its post-respawn boot grace must NOT be respawned
    // again (double-respawn during boot is the thing the grace prevents).
    #[test]
    fn supervision_waits_during_boot_grace() {
        assert_eq!(
            decide_server_supervision(false, false, true, 99, 10, 0, 5, false),
            A::Wait
        );
    }

    // Dead but not yet past the debounce → wait (a normal restart briefly looks
    // dead as the pid rolls over; don't respawn on a transient gap).
    #[test]
    fn supervision_waits_below_debounce_threshold() {
        assert_eq!(
            decide_server_supervision(false, false, false, 9, 10, 0, 5, false),
            A::Wait
        );
    }

    // Dead past the debounce, under the respawn cap → respawn. This is the core
    // WI-2667 recovery: SIGTERM force-exit left the Server gone, bring it back.
    #[test]
    fn supervision_respawns_when_dead_past_threshold() {
        assert_eq!(
            decide_server_supervision(false, false, false, 10, 10, 0, 5, false),
            A::Respawn
        );
        assert_eq!(
            decide_server_supervision(false, false, false, 10, 10, 4, 5, false),
            A::Respawn
        );
    }

    // Respawned too many times in the window → give up (a Server that truly
    // can't boot must not hot-loop `open -b` forever).
    #[test]
    fn supervision_gives_up_at_respawn_cap() {
        assert_eq!(
            decide_server_supervision(false, false, false, 10, 10, 5, 5, false),
            A::GiveUp
        );
    }

    // WI-3270 (b): give-up is a BACKOFF, not a terminal latch — the old
    // latch-until-app-restart is exactly what left the VM dead until a manual
    // Server restart.
    #[test]
    fn supervision_gives_up_then_recovers() {
        // While the respawn window is still saturated, a latched give-up holds
        // (and never re-notifies — GiveUp only fires on the transition).
        assert_eq!(
            decide_server_supervision(false, false, false, 999, 10, 5, 5, true),
            A::Wait
        );
        // Window drained → retry (the slow-retry tier; the caller clears the latch).
        assert_eq!(
            decide_server_supervision(false, false, false, 999, 10, 0, 5, true),
            A::Respawn
        );
        // The Server coming back while latched reads Healthy (caller clears latch).
        assert_eq!(
            decide_server_supervision(true, false, false, 0, 10, 0, 5, true),
            A::Healthy
        );
    }

    // WI-3270 (c): operator dead but the Server SHELL is alive (fresh
    // heartbeat) — launching the bundle is a guaranteed single-instance no-op,
    // so the watcher must defer and never burn a respawn-cap slot, no matter
    // how long the operator has been dead or how saturated the window is.
    #[test]
    fn supervision_defers_to_live_shell_instead_of_burning_the_cap() {
        assert_eq!(
            decide_server_supervision(false, true, false, 999, 10, 0, 5, false),
            A::DeferToShell
        );
        assert_eq!(
            decide_server_supervision(false, true, false, 999, 10, 5, 5, false),
            A::DeferToShell
        );
        // A latched give-up defers too (the shell may still recover it).
        assert_eq!(
            decide_server_supervision(false, true, false, 999, 10, 5, 5, true),
            A::DeferToShell
        );
        // A live operator process wins over the shell signal.
        assert_eq!(
            decide_server_supervision(true, true, false, 0, 10, 0, 5, false),
            A::Healthy
        );
    }

    // WI-3270 (c): the shell-heartbeat freshness rule + JSON round-trip guard
    // the defer-to-shell signal (the live write/read sides need two processes,
    // which Linux CI can't exercise — same blind-spot rationale as above).
    use super::{shell_heartbeat_fresh, ServerShellHeartbeat};

    #[test]
    fn shell_heartbeat_freshness_boundary() {
        let max = Duration::from_secs(10);
        assert!(shell_heartbeat_fresh(100, 100, max));
        assert!(shell_heartbeat_fresh(100, 110, max)); // exactly max age: fresh
        assert!(!shell_heartbeat_fresh(100, 111, max)); // past it: stale
        assert!(shell_heartbeat_fresh(110, 100, max)); // future ts (clock skew): fresh
    }

    #[test]
    fn shell_heartbeat_json_round_trip() {
        let hb = ServerShellHeartbeat {
            pid: 4242,
            ts: 1_720_000_000,
        };
        let body = serde_json::to_string(&hb).unwrap();
        let back: ServerShellHeartbeat = serde_json::from_str(&body).unwrap();
        assert_eq!(back.pid, 4242);
        assert_eq!(back.ts, 1_720_000_000);
    }

    // WI-2667 (defect-2 gap): the SERVER-side serve respawn decision. This is the
    // path the live Mac-VM E2E proved was missing — the operator died, the shell
    // lived, and nothing (GUI `open -b` no-ops on the live single instance) brought
    // it back. Same Linux-CI blind-spot rationale: the macOS respawn can't run here.
    use super::{decide_serve_respawn, serve_unreachable_respawn_ready, ServeRespawnAction as R};

    // Child still running, operator not yet up, debounce not armed (normal boot)
    // → nothing to do. (Args: child_exited, shutting_down, operator_reachable,
    // unreachable_respawn_ready, respawns_in_window, max_respawns.)
    #[test]
    fn serve_respawn_healthy_when_child_running() {
        assert_eq!(
            decide_serve_respawn(false, false, false, false, 0, 5),
            R::Healthy
        );
    }

    // Operator reachable is GROUND TRUTH → healthy no matter the Child state.
    // Covers the Decision-C case (child exited because `--ensure` reused a foreign
    // operator that is serving) → do NOT double-spawn.
    #[test]
    fn serve_respawn_healthy_when_operator_reachable_despite_exit() {
        assert_eq!(
            decide_serve_respawn(true, false, true, false, 0, 5),
            R::Healthy
        );
        // reachable wins even if the unreachable path were somehow armed.
        assert_eq!(
            decide_serve_respawn(true, false, true, true, 0, 5),
            R::Healthy
        );
    }

    // The core WI-2667 recovery: operator child exited, no operator reachable,
    // under the cap → respawn serve in-process (the case the Mac-VM E2E showed
    // dead). A fully-exited child respawns immediately, debounce or not.
    #[test]
    fn serve_respawn_when_child_exited_and_unreachable() {
        assert_eq!(
            decide_serve_respawn(true, false, false, false, 0, 5),
            R::Respawn
        );
        assert_eq!(
            decide_serve_respawn(true, false, false, false, 4, 5),
            R::Respawn
        );
    }

    // Shutting down / self-updating → never resurrect the child we killed on
    // purpose — and that wins even past the respawn cap and with the Windows
    // path armed.
    #[test]
    fn serve_respawn_suppressed_when_shutting_down() {
        assert_eq!(
            decide_serve_respawn(true, true, false, false, 0, 5),
            R::Suppressed
        );
        assert_eq!(
            decide_serve_respawn(true, true, false, false, 9, 5),
            R::Suppressed
        );
        assert_eq!(
            decide_serve_respawn(false, true, false, true, 0, 5),
            R::Suppressed
        );
    }

    // Respawned too many times in the window (crash-loop) → give up until restart.
    #[test]
    fn serve_respawn_gives_up_at_cap() {
        assert_eq!(
            decide_serve_respawn(true, false, false, false, 5, 5),
            R::GiveUp
        );
    }

    // WI-3170 (Windows/WSL child-liveness blind spot): the stored serve `Child` is
    // the wsl.exe WRAPPER, which OUTLIVES the dead WSL-internal node operator — so
    // `child_exited` stays false even though the operator is durably gone. Once the
    // operator has been UNREACHABLE past the debounce (unreachable_respawn_ready),
    // respawn REGARDLESS of child_exited. The OLD decider returned Healthy here, so
    // the dead operator was NEVER respawned (VM forensics: down ~11 min).
    #[test]
    fn serve_respawn_when_operator_unreachable_past_debounce_despite_live_wrapper_child() {
        // Wrapper Child alive (child_exited=false), operator unreachable past the
        // debounce, under the cap → respawn (the exact bug case).
        assert_eq!(
            decide_serve_respawn(false, false, false, true, 0, 5),
            R::Respawn
        );
        assert_eq!(
            decide_serve_respawn(false, false, false, true, 4, 5),
            R::Respawn
        );
        // The crash-loop cap still applies to this path.
        assert_eq!(
            decide_serve_respawn(false, false, false, true, 5, 5),
            R::GiveUp
        );
        // But BEFORE the debounce arms (normal boot: serve alive, operator still
        // coming up) we must NOT respawn — that would double-spawn a competing serve.
        assert_eq!(
            decide_serve_respawn(false, false, false, false, 0, 5),
            R::Healthy
        );
    }

    #[test]
    fn serve_unreachable_respawn_ready_stays_disarmed_before_first_successful_boot() {
        let debounce = Duration::from_secs(15);
        assert!(!serve_unreachable_respawn_ready(
            true, false, None, debounce
        ));
        assert!(!serve_unreachable_respawn_ready(
            true,
            false,
            Some(Duration::from_secs(30)),
            debounce
        ));
    }

    #[test]
    fn serve_unreachable_respawn_ready_arms_only_after_continuous_debounce_on_wsl() {
        let debounce = Duration::from_secs(15);
        assert!(!serve_unreachable_respawn_ready(true, true, None, debounce));
        assert!(!serve_unreachable_respawn_ready(
            true,
            true,
            Some(Duration::from_secs(14)),
            debounce
        ));
        assert!(serve_unreachable_respawn_ready(
            true,
            true,
            Some(Duration::from_secs(15)),
            debounce
        ));
        assert!(serve_unreachable_respawn_ready(
            true,
            true,
            Some(Duration::from_secs(16)),
            debounce
        ));
    }

    #[test]
    fn serve_unreachable_respawn_ready_never_arms_off_wsl() {
        assert!(!serve_unreachable_respawn_ready(
            false,
            true,
            Some(Duration::from_secs(60)),
            Duration::from_secs(15)
        ));
    }

    // WI-1878 / P-005: the operator-dead notification body must name WHICH
    // supervisor gave up and the exact attempt/window numbers, so a user (or a
    // later triager reading a bug report) can tell the two give-up paths apart.
    #[test]
    fn operator_dead_notification_body_names_reason_and_counts() {
        let body =
            super::operator_dead_notification_body("serve.mjs in-process respawn cap hit", 5, 300);
        assert!(body.contains("serve.mjs in-process respawn cap hit"));
        assert!(body.contains('5'));
        assert!(body.contains("300"));
        // WI-3270: give-up now keeps retrying in the background — the user-facing
        // text must say so (the old "restart the app to recover" implied a wedge).
        assert!(body.contains("Retries continue"));
    }
}

// WI-2902: readiness must be HTTP-RESPONSIVE, not just TCP-connectable — a
// first-boot operator binds its port ~20s before its starved event loop can
// answer, and gating on TCP-accept re-pointed the webview at a server that then
// failed every SPA chunk fetch (the fatal "Importing a module script failed"
// card). These pin operator_http_ready's contract: a server that COMPLETES an
// HTTP round-trip reads ready; a refused/absent one does not.
#[cfg(test)]
mod http_ready_tests {
    use super::operator_http_ready;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn ready_when_operator_answers_http() {
        // A listener that completes ONE HTTP round-trip stands in for a
        // responsive operator whose event loop is serving requests.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
        let port = listener.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            if let Ok((mut sock, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf); // drain the request; content irrelevant
                let _ = sock.write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\ncontent-type: application/json\r\n\r\nok",
                );
                let _ = sock.flush();
            }
        });
        assert!(
            operator_http_ready(port),
            "a server that answers an HTTP request must read as ready",
        );
        let _ = h.join();
    }

    #[test]
    fn not_ready_when_nothing_listens() {
        // A port with nothing listening → connection refused → NOT ready, fast
        // (never a hang): bind to reserve an ephemeral port, then drop it.
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
            l.local_addr().unwrap().port()
        };
        assert!(
            !operator_http_ready(port),
            "a refused connection must read as NOT ready",
        );
    }
}

#[cfg(test)]
mod helper_tests {
    use super::{
        bundled_path_env, endpoint_ipc_socket_path_supported_for_target, find_endpoint_ipc_socket,
        is_tcp_endpoint, read_dev_ipc_socket, read_dev_ipc_socket_for_port, url_encode,
    };

    // ── url_encode (RFC 3986 component encoding) ────────────────────────────

    #[test]
    fn url_encode_passes_unreserved_through() {
        assert_eq!(url_encode("abcXYZ019.-_~"), "abcXYZ019.-_~");
        assert_eq!(url_encode(""), "");
    }

    #[test]
    fn url_encode_escapes_reserved_with_uppercase_hex() {
        assert_eq!(url_encode("a b"), "a%20b");
        assert_eq!(url_encode("ws/id?x=1&y=2"), "ws%2Fid%3Fx%3D1%26y%3D2");
        assert_eq!(url_encode("a:b#c"), "a%3Ab%23c");
        assert_eq!(url_encode("100%"), "100%25");
    }

    #[test]
    fn url_encode_encodes_utf8_per_byte() {
        // 'é' = 0xC3 0xA9 in UTF-8 — each byte percent-encoded.
        assert_eq!(url_encode("é"), "%C3%A9");
        assert_eq!(url_encode("日"), "%E6%97%A5");
    }

    // ── bundled PATH assembly ───────────────────────────────────────────────

    #[test]
    fn bundled_path_env_prepends_the_sidecar_bin_dir() {
        let dir = std::path::Path::new("/opt/papercusp/sidecar");
        let path = bundled_path_env(dir);
        let sep = if cfg!(windows) { ";" } else { ":" };
        let expected_prefix = format!("{}{}", dir.join("bin").to_string_lossy(), sep);
        assert!(
            path.starts_with(&expected_prefix),
            "PATH must start with the bundled bin dir: {path}"
        );
    }

    // ── endpoint-ipc discovery file parsing ─────────────────────────────────

    /// Fresh temp dir per test — same pattern as the endpoint_ipc
    /// synthetic-server test (no tempfile dev-dep in this crate).
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "papercusp-desktop-test-{tag}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_dev_ipc_socket_parses_socket_path() {
        let dir = temp_dir("ipc-sock");
        let file = dir.join("endpoint-ipc.json");
        std::fs::write(
            &file,
            r#"{"socketPath":"/tmp/papercusp/ipc.sock","pid":42}"#,
        )
        .unwrap();
        assert_eq!(
            read_dev_ipc_socket(&file),
            Some("/tmp/papercusp/ipc.sock".to_string())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn endpoint_ipc_socket_path_support_is_platform_aware() {
        assert!(endpoint_ipc_socket_path_supported_for_target(
            "/tmp/papercusp/ipc.sock",
            false
        ));
        assert!(!endpoint_ipc_socket_path_supported_for_target(
            "/tmp/papercusp/ipc.sock",
            true
        ));
        assert!(endpoint_ipc_socket_path_supported_for_target(
            "\\\\.\\pipe\\papercusp-12345",
            true
        ));
        assert!(!endpoint_ipc_socket_path_supported_for_target(
            "\\\\.\\pipe\\papercusp-12345",
            false
        ));
        assert!(!endpoint_ipc_socket_path_supported_for_target("", false));
    }

    #[test]
    fn endpoint_ipc_tcp_endpoint_accepted_on_windows_alongside_pipe() {
        // WI-3395: the WSL2 sidecar reports a `tcp://` loopback endpoint; the
        // Windows host guard must accept it (a Unix socket it can't reach).
        assert!(endpoint_ipc_socket_path_supported_for_target(
            "tcp://127.0.0.1:35745",
            true
        ));
        // A named pipe is still accepted on Windows (native-sidecar path).
        assert!(endpoint_ipc_socket_path_supported_for_target(
            "\\\\.\\pipe\\papercusp-1",
            true
        ));
        // A Unix socket is still rejected on Windows.
        assert!(!endpoint_ipc_socket_path_supported_for_target(
            "/tmp/x.sock",
            true
        ));
        // A `tcp://` endpoint is reachable on a non-Windows host too.
        assert!(endpoint_ipc_socket_path_supported_for_target(
            "tcp://127.0.0.1:35745",
            false
        ));
        // The classifier itself: scheme-only, trimmed + case-insensitive.
        assert!(is_tcp_endpoint("tcp://127.0.0.1:0"));
        assert!(is_tcp_endpoint("  TCP://127.0.0.1:0 "));
        assert!(!is_tcp_endpoint("/tmp/x.sock"));
        assert!(!is_tcp_endpoint("\\\\.\\pipe\\papercusp-1"));
    }

    #[test]
    fn read_dev_ipc_socket_parses_tcp_endpoint() {
        let dir = temp_dir("ipc-tcp");
        let file = dir.join("endpoint-ipc.json");
        std::fs::write(&file, r#"{"socketPath":"tcp://127.0.0.1:35745","pid":42}"#).unwrap();
        assert_eq!(
            read_dev_ipc_socket(&file),
            Some("tcp://127.0.0.1:35745".to_string())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_endpoint_ipc_socket_reads_workspace_home_when_not_via_wsl() {
        // WI-3395: the non-WSL path (mac/linux, and the Windows fallback) resolves
        // the socket from workspace_home/.papercusp/endpoint-ipc.json. The WSL
        // read is Windows-only + needs a live distro, so it isn't unit-covered
        // here; this guards the shared filesystem path + the join.
        let dir = temp_dir("ipc-find");
        std::fs::create_dir_all(dir.join(".papercusp")).unwrap();
        std::fs::write(
            dir.join(".papercusp/endpoint-ipc.json"),
            r#"{"socketPath":"tcp://127.0.0.1:40001","pid":7}"#,
        )
        .unwrap();
        assert_eq!(
            find_endpoint_ipc_socket(&dir, false),
            Some("tcp://127.0.0.1:40001".to_string())
        );
        // Missing file → None (client falls back to HTTP, no panic).
        let empty = temp_dir("ipc-find-empty");
        assert_eq!(find_endpoint_ipc_socket(&empty, false), None);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&empty);
    }

    #[test]
    fn read_dev_ipc_socket_rejects_missing_or_malformed() {
        let dir = temp_dir("ipc-bad");
        // Missing file.
        assert_eq!(read_dev_ipc_socket(&dir.join("nope.json")), None);
        // Malformed JSON (half-written discovery file).
        let truncated = dir.join("truncated.json");
        std::fs::write(&truncated, r#"{"socketPath":"/tmp/x"#).unwrap();
        assert_eq!(read_dev_ipc_socket(&truncated), None);
        // Missing key.
        let nokey = dir.join("nokey.json");
        std::fs::write(&nokey, r#"{"pid":42}"#).unwrap();
        assert_eq!(read_dev_ipc_socket(&nokey), None);
        // Wrong type.
        let wrongtype = dir.join("wrongtype.json");
        std::fs::write(&wrongtype, r#"{"socketPath":42}"#).unwrap();
        assert_eq!(read_dev_ipc_socket(&wrongtype), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn per_port_discovery_prefers_the_port_file_then_falls_back() {
        let dir = temp_dir("ipc-port");
        std::fs::write(
            dir.join("endpoint-ipc.3170.json"),
            r#"{"socketPath":"/tmp/staging.sock"}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("endpoint-ipc.json"),
            r#"{"socketPath":"/tmp/legacy.sock"}"#,
        )
        .unwrap();
        // Port with its own file → the per-port socket (EI-190).
        assert_eq!(
            read_dev_ipc_socket_for_port(&dir, 3170),
            Some("/tmp/staging.sock".to_string())
        );
        // Port without one → the legacy singleton.
        assert_eq!(
            read_dev_ipc_socket_for_port(&dir, 3070),
            Some("/tmp/legacy.sock".to_string())
        );
        // EI-296: a CUSTOM port (escape-hatch target) must NOT inherit the
        // singleton — that would silently dial another operator's socket.
        assert_eq!(read_dev_ipc_socket_for_port(&dir, 3271), None);
        // …but a custom port WITH its own per-port file is honored.
        std::fs::write(
            dir.join("endpoint-ipc.3271.json"),
            r#"{"socketPath":"/tmp/iso.sock"}"#,
        )
        .unwrap();
        assert_eq!(
            read_dev_ipc_socket_for_port(&dir, 3271),
            Some("/tmp/iso.sock".to_string())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn per_port_discovery_returns_none_when_nothing_published() {
        let dir = temp_dir("ipc-empty");
        assert_eq!(read_dev_ipc_socket_for_port(&dir, 3070), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod macos_bundle_tests {
    use serde_json::Value;
    use std::{fs, path::PathBuf};

    fn src_tauri_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn tauri_config_points_macos_bundle_at_info_and_entitlements() {
        let config_path = src_tauri_dir().join("tauri.conf.json");
        let config: Value =
            serde_json::from_str(&fs::read_to_string(config_path).expect("read tauri.conf.json"))
                .expect("parse tauri.conf.json");
        let mac = &config["bundle"]["macOS"];
        assert_eq!(mac["entitlements"], "entitlements.plist");
        assert_eq!(mac["infoPlist"], "Info.plist");
    }

    #[test]
    fn info_plist_declares_microphone_usage_description() {
        let plist =
            fs::read_to_string(src_tauri_dir().join("Info.plist")).expect("read Info.plist");
        assert!(plist.contains("NSMicrophoneUsageDescription"));
        assert!(plist.contains("voice mode"));
    }

    #[test]
    fn entitlements_enable_macos_audio_input() {
        let plist = fs::read_to_string(src_tauri_dir().join("entitlements.plist"))
            .expect("read entitlements");
        assert!(plist.contains("com.apple.security.device.audio-input"));
        assert!(plist.contains("<true/>"));
    }
}

/// Build the Command that actually runs the sidecar. On Windows with
/// WSL Ready we wrap node in `wsl.exe --distribution papercup-runtime
/// --cd <wsl-cwd> --exec node …`. Otherwise we run node natively.
///
/// Caller still chains `.env(...)` calls; for the WSL path those env
/// vars are forwarded to the Linux side via the `WSLENV` env-var list
/// convention (set automatically here).
fn make_sidecar_command(
    via_wsl: bool,
    sidecar_dir: &std::path::Path,
    preload: &std::path::Path,
    server_js: &std::path::Path,
) -> Command {
    if via_wsl {
        #[cfg(target_os = "windows")]
        {
            let cwd_wsl = windows_path_to_wsl(sidecar_dir);
            let preload_wsl = windows_path_to_wsl(preload);
            let server_js_wsl = windows_path_to_wsl(server_js);
            let mut cmd = Command::new("wsl.exe");
            cmd.env("WSL_UTF8", "1").args([
                "--distribution",
                wsl_setup::DISTRO_NAME_PUB,
                "--cd",
                &cwd_wsl,
                "--exec",
                "node",
                "--require",
                &preload_wsl,
                &server_js_wsl,
            ]);
            isolate_process_group(&mut cmd);
            return cmd;
        }
        #[cfg(not(target_os = "windows"))]
        {
            // unreachable in practice — should_route_via_wsl returns
            // false on non-Windows. Fall through to native.
        }
    }
    let mut cmd = Command::new("node");
    cmd.arg("--require")
        .arg(preload)
        .arg(server_js)
        .current_dir(sidecar_dir);
    isolate_process_group(&mut cmd);
    cmd
}

/// Minimal operator.json discovery (SP1 C5). Written atomically by `serve`
/// once the host is listening; removed on its clean shutdown. Mirrors the
/// `OperatorDiscovery` interface in apps/operator/bin/serve.ts.
#[derive(Debug, Clone)]
struct OperatorDiscovery {
    port: u16,
    pid: u32,
}

/// Parse the operator.json discovery payload, or None. Factored from the
/// file read so the validation (port/pid present and nonzero) is unit-tested.
fn parse_operator_discovery(txt: &str) -> Option<OperatorDiscovery> {
    let v: serde_json::Value = serde_json::from_str(txt).ok()?;
    let port = v.get("port")?.as_u64()? as u16;
    let pid = v.get("pid")?.as_u64()? as u32;
    if port == 0 || pid == 0 {
        return None;
    }
    Some(OperatorDiscovery { port, pid })
}

/// Parse `<home>/.papercusp/operator.json`, or None.
fn read_operator_discovery(workspace_home: &std::path::Path) -> Option<OperatorDiscovery> {
    let path = workspace_home.join(".papercusp/operator.json");
    let txt = std::fs::read_to_string(path).ok()?;
    parse_operator_discovery(&txt)
}

/// The live operator port straight from `$HOME/.papercusp/operator.json` — the
/// self-heal source for `custom_protocol::upstream_base` when `SidecarState.port`
/// was never latched (WI-3282). `serve` writes this file when it starts listening
/// and removes it on clean shutdown, so a present file with a nonzero port means a
/// live operator. Reading it per `/api` miss (only when the latched port is None)
/// makes the webview→operator proxy resilient to a boot-discovery / watcher latch
/// miss instead of dead-ending the whole app on a permanent 503.
///
/// HOME-based (matches env_switch's persisted_target_path): on Linux/mac the
/// operator's workspace HOME is the user's `$HOME`, where it writes the file. This
/// is a fallback only — on Windows (operator.json lives inside WSL) it returns
/// None, i.e. no worse than the pre-fix behaviour.
pub(crate) fn operator_discovery_port_from_home() -> Option<u16> {
    let home = std::env::var_os("HOME")?;
    read_operator_discovery(std::path::Path::new(&home)).map(|d| d.port)
}

/// Spawn a short-lived Windows helper (a per-poll `wsl.exe` read) WITHOUT
/// dropping a visible console window over the webview — same rationale as
/// isolate_process_group, but these reads are fire-and-forget so they don't
/// need the process group.
#[cfg(target_os = "windows")]
fn no_console_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);
}

/// operator.json path INSIDE the WSL distro. The sidecar runs as the distro
/// user `papercup` (HOME=/home/papercup — WSLENV HOME/p forwarding does not
/// survive WSL session init), so serve writes discovery here, not under the
/// forwarded /mnt/c home.
#[cfg(target_os = "windows")]
const WSL_OPERATOR_JSON: &str = "/home/papercup/.papercusp/operator.json";

/// Read operator.json the ROBUST way when the sidecar runs inside WSL: shell
/// into the distro and `cat` the file. The `\\wsl.localhost` UNC share we used
/// to read through is UNRELIABLE — observed live 2026-07-03 on the Windows VM,
/// `Test-Path` returned False for every `\\wsl.localhost\<distro>\…` path WHILE
/// the distro was running and `wsl.exe -e cat` read the same file fine. When the
/// UNC read fails, wait_for_operator burns its full 120s timeout despite a
/// healthy operator, and the webview strands on the frontendDist :3070 error
/// page — the app never shows its UI. This uses the exact mechanism
/// discovery_pid_alive already relies on, so it works whenever the distro is up.
#[cfg(target_os = "windows")]
fn read_operator_discovery_via_wsl() -> Option<OperatorDiscovery> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args([
        "--distribution",
        wsl_setup::DISTRO_NAME_PUB,
        "-e",
        "cat",
        WSL_OPERATOR_JSON,
    ]);
    no_console_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_operator_discovery(&String::from_utf8_lossy(&out.stdout))
}

/// Probe whether the WSL distro's exec layer is WEDGED — i.e. `wsl.exe --exec`
/// no longer returns even for a trivial command. A relentless serve respawn
/// storm (each respawn is a `wsl.exe --exec node`) can drive the WSL2 interop
/// into this state, after which EVERY exec (including the respawn itself)
/// produces a dead child and the operator can never recover — the exact outage
/// that on the VM required a manual `wsl --terminate` (WI-3360, 2026-07-08:
/// `wsl -d papercup-runtime -- echo` returned empty until a terminate). Returns
/// true when a trivial `wsl.exe -e true` cannot exit 0 within `timeout`. std has
/// no Command timeout, so we spawn + poll try_wait + kill on the deadline.
#[cfg(target_os = "windows")]
fn distro_exec_wedged(timeout: Duration) -> bool {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--distribution", wsl_setup::DISTRO_NAME_PUB, "-e", "true"]);
    no_console_window(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return true, // can't even spawn wsl.exe → treat as wedged
    };
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return !status.success(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return true; // never returned in time → wedged
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return true,
        }
    }
}

/// Reset a wedged WSL distro so the next serve respawn boots into a fresh VM.
/// `wsl.exe --terminate <distro>` stops the distro (it cold-boots on the next
/// exec) WITHOUT unregistering it — no data loss. This is the single action
/// that clears the interop wedge (WI-3360). Returns true on a clean exit.
#[cfg(target_os = "windows")]
fn terminate_distro() -> bool {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--terminate", wsl_setup::DISTRO_NAME_PUB]);
    no_console_window(&mut cmd);
    matches!(cmd.status(), Ok(s) if s.success())
}

/// Unified operator discovery shared by BOTH the initial boot wait and the
/// long-lived watcher, so the two can never drift. When routed via WSL
/// (Windows), read through `wsl.exe` (the UNC share is unreliable — see
/// read_operator_discovery_via_wsl); otherwise read the local filesystem path.
/// Routing the WATCHER through this (it previously read only the Windows-side
/// workspace_home, which never holds the WSL operator.json) is what lets it
/// follow an operator restart on the VM instead of being permanently blind.
fn find_operator_discovery(
    workspace_home: &std::path::Path,
    via_wsl: bool,
) -> Option<OperatorDiscovery> {
    #[cfg(target_os = "windows")]
    if via_wsl {
        if let Some(d) = read_operator_discovery_via_wsl() {
            return Some(d);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = via_wsl;
    read_operator_discovery(workspace_home)
}

/// The endpoint-IPC discovery file INSIDE the WSL distro. Mirrors
/// `WSL_OPERATOR_JSON`: the sidecar (running in WSL2) writes it to its
/// WSL-native `$HOME/.papercusp`, NOT the Windows-side workspace_home the
/// client reads — see `find_endpoint_ipc_socket` (WI-3395).
#[cfg(target_os = "windows")]
const WSL_ENDPOINT_IPC_JSON: &str = "/home/papercup/.papercusp/endpoint-ipc.json";

/// Read the endpoint-IPC `socketPath` from INSIDE the WSL distro via `wsl.exe
/// -e cat`, exactly like `read_operator_discovery_via_wsl` (the `\\wsl$` UNC
/// share is unreliable — see that fn). WI-3395: the WSL2 sidecar binds a
/// `tcp://127.0.0.1:<port>` endpoint and records it in its WSL-native
/// `~/.papercusp/endpoint-ipc.json`; the Windows host reaches that port via
/// WSL2 localhost-forwarding (same mechanism as the operator HTTP port).
#[cfg(target_os = "windows")]
fn read_endpoint_ipc_socket_via_wsl() -> Option<String> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args([
        "--distribution",
        wsl_setup::DISTRO_NAME_PUB,
        "-e",
        "cat",
        WSL_ENDPOINT_IPC_JSON,
    ]);
    no_console_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_endpoint_ipc_socket(&String::from_utf8_lossy(&out.stdout))
}

/// Unified endpoint-IPC socket discovery — mirrors `find_operator_discovery`.
/// On Windows routed via WSL, read the discovery JSON from INSIDE the distro
/// (the sidecar's WSL-native `~/.papercusp`, cross-filesystem from the Windows
/// workspace_home), else read the local `workspace_home/.papercusp` path
/// (mac/linux, plus the non-WSL Windows fallback). WI-3395: without the WSL
/// read, the Windows client never finds the file the WSL2 sidecar wrote and
/// `/api` strands on the capped HTTP fallback.
fn find_endpoint_ipc_socket(workspace_home: &std::path::Path, via_wsl: bool) -> Option<String> {
    #[cfg(target_os = "windows")]
    if via_wsl {
        if let Some(s) = read_endpoint_ipc_socket_via_wsl() {
            return Some(s);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = via_wsl;
    read_dev_ipc_socket(&workspace_home.join(".papercusp/endpoint-ipc.json"))
}

/// WI-1869: given the operator port the webview is CURRENTLY pointed at and the
/// latest operator.json discovery, decide whether to re-navigate — and to which
/// port. Returns Some(new_port) iff a discovery is present and names a DIFFERENT
/// port than the applied one (i.e. a Server restart / sidecar crash-respawn
/// moved the operator). Pure, so it is unit-tested on Linux CI — the macOS/
/// Windows dynamic-port path that this guards can never be exercised there,
/// which is exactly the blind spot that let the strand-on-restart bug ship.
fn next_operator_port(applied_port: u16, latest: Option<&OperatorDiscovery>) -> Option<u16> {
    match latest {
        Some(d) if d.port != applied_port => Some(d.port),
        _ => None,
    }
}

/// WI-2667: what the operator watcher should DO about Server liveness this tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServerSupervisionAction {
    /// The Server process is alive — reset the dead counter, nothing to do.
    Healthy,
    /// Dead, but still inside the debounce window or a post-respawn boot grace —
    /// keep waiting (a normal restart briefly looks dead as the pid rolls over).
    Wait,
    /// Operator dead but the Server SHELL is provably alive (fresh heartbeat) —
    /// a bundle launch would single-instance no-op, so never launch (and never
    /// burn a respawn-cap slot on it); the shell's own serve supervisor is the
    /// one that can act (WI-3270).
    DeferToShell,
    /// Dead past the debounce and under the respawn cap — relaunch the Server.
    Respawn,
    /// Respawned too many times in the window (crash-loop) — back off and
    /// notify. Recoverable (WI-3270): once the respawn window drains the
    /// decision returns to Respawn, so a wedged Server keeps getting slow
    /// retries instead of requiring a manual app restart.
    GiveUp,
}

/// Pure liveness decision for the operator watcher (WI-2667 — packaged operator
/// dies on SIGTERM and nothing brings it back). Extracted + unit-tested (Cargo)
/// for the SAME reason `next_operator_port` is: the macOS/Windows respawn path
/// can't be exercised on Linux CI, and that blind spot is exactly what let the
/// original strand-on-restart bug ship. Keeping the branching pure means every
/// arm (debounce, boot grace, crash-loop cap, latched give-up) has a guard.
///
/// `dead_count` is the tick's accumulated consecutive-dead count (already
/// incremented for this tick when dead & not in grace). `open -b` on the
/// single-instance Server is a no-op when it's actually alive, so a spurious
/// Respawn is harmless — but the debounce + cap keep it from thrashing.
/// `server_shell_alive` is the WI-3270 heartbeat signal: the Server SHELL
/// process is provably up, so a bundle launch can only single-instance no-op.
fn decide_server_supervision(
    process_alive: bool,
    server_shell_alive: bool,
    in_boot_grace: bool,
    dead_count: u32,
    dead_threshold: u32,
    respawns_in_window: usize,
    max_respawns: usize,
    already_gave_up: bool,
) -> ServerSupervisionAction {
    if process_alive {
        // Alive also RECOVERS a latched give-up (WI-3270): something (a manual
        // launch, the shell's own serve supervisor) brought the Server back —
        // the caller clears the latch and re-arms auto-respawn.
        return ServerSupervisionAction::Healthy;
    }
    if server_shell_alive {
        // WI-3270 (c): operator dead but the Server shell is alive — launching
        // the bundle is a guaranteed single-instance no-op, so never burn a
        // respawn-cap slot on it (that burn is how the watcher gave up on the
        // Windows VM while the shell held the single-instance lock throughout).
        return ServerSupervisionAction::DeferToShell;
    }
    if in_boot_grace || dead_count < dead_threshold {
        return ServerSupervisionAction::Wait;
    }
    if respawns_in_window >= max_respawns {
        // WI-3270 (b): give-up is a BACKOFF, not a terminal latch — notify once
        // (GiveUp), then hold (Wait) only while the respawn window is still
        // saturated. respawn_times drains on the window, after which the branch
        // below resumes Respawn (a slow retry tier), so recovery never requires
        // a manual app restart.
        return if already_gave_up {
            ServerSupervisionAction::Wait
        } else {
            ServerSupervisionAction::GiveUp
        };
    }
    ServerSupervisionAction::Respawn
}

/// WI-2667 (defect-2 gap): what the SERVER role should do about its OWN
/// serve.mjs operator child. The GUI-side `open -b` supervisor
/// (`decide_server_supervision`) can only revive a FULLY-exited Server bundle —
/// it no-ops on the still-alive single-instance shell. So when the operator
/// child dies but this Server shell survives (exactly what defect-1's
/// force-exit produces, and any operator crash), only the Server itself can
/// bring the operator back — and it must, else the app is cleanly dead with no
/// recovery (confirmed live on the Mac VM 2026-07-04: 100s, zero auto-recovery).
/// Pure for the same Linux-CI blind-spot reason as `decide_server_supervision`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServeRespawnAction {
    /// Operator reachable (ground truth), or the child is still running and the
    /// operator has not yet been unreachable long enough to count as dead —
    /// nothing to do. (Reachable-despite-child-exit covers the Decision-C
    /// `--ensure` foreign-operator reuse case.)
    Healthy,
    /// App is quitting or self-updating — never resurrect the child we just
    /// killed on purpose.
    Suppressed,
    /// Child exited and no operator is reachable — respawn serve in-process.
    Respawn,
    /// Respawned too many times in the window (crash-loop) — stop until restart.
    GiveUp,
}

/// Pure respawn decision for the Server-side serve supervisor (WI-2667, WI-3170).
///   * `child_exited` — the stored serve `Child` has reaped (`try_wait` → Some).
///     UNRELIABLE on Windows: `spawn_serve` stores the wsl.exe WRAPPER as the
///     `Child`, and the wrapper can OUTLIVE the dead WSL-internal node operator,
///     so `child_exited` stays false while the operator is durably gone (WI-3170).
///   * `shutting_down` — `SidecarState.shutdown_done` (normal quit) or an
///     in-flight self-update; suppresses respawn so we don't fight the teardown.
///   * `operator_reachable` — an operator answers discovery+TCP right now. This is
///     the GROUND-TRUTH liveness signal: if it answers we are healthy no matter
///     what the (possibly-wrapper) `Child` says. Also covers the Decision-C reuse
///     case (child exited because `--ensure` handed off to a foreign operator).
///   * `unreachable_respawn_ready` — the operator has been continuously UNREACHABLE
///     past the supervisor's debounce AND had come up at least once this session
///     (so a slow cold boot never trips it). This closes the Windows/WSL blind
///     spot: respawn a durably-dead operator even when the wrapper `Child` is
///     still alive (`child_exited` == false).
fn decide_serve_respawn(
    child_exited: bool,
    shutting_down: bool,
    operator_reachable: bool,
    unreachable_respawn_ready: bool,
    respawns_in_window: usize,
    max_respawns: usize,
) -> ServeRespawnAction {
    if shutting_down {
        return ServeRespawnAction::Suppressed;
    }
    // Operator answering discovery+health is ground truth — healthy regardless of
    // the stored `Child` (on Windows it is the wsl.exe wrapper, which lies).
    if operator_reachable {
        return ServeRespawnAction::Healthy;
    }
    // Operator is UNREACHABLE. Respawn if the child fully exited (Linux/mac:
    // definitive death) OR it has been unreachable past the debounce (Windows/WSL:
    // wrapper `Child` alive but inner node dead). Otherwise it is still coming up
    // — wait (the `unreachable_respawn_ready` arming keeps us off a normal boot).
    if child_exited || unreachable_respawn_ready {
        if respawns_in_window >= max_respawns {
            return ServeRespawnAction::GiveUp;
        }
        return ServeRespawnAction::Respawn;
    }
    ServeRespawnAction::Healthy
}

/// Pure arming gate for WI-3170's Windows/WSL wrapper blind spot. This computes
/// the `unreachable_respawn_ready` input to `decide_serve_respawn` from the
/// stateful supervisor loop's latches, keeping the cold-boot/double-spawn guard
/// testable without a live WSL VM.
fn serve_unreachable_respawn_ready(
    via_wsl: bool,
    ever_reachable: bool,
    unreachable_elapsed: Option<Duration>,
    debounce: Duration,
) -> bool {
    via_wsl
        && ever_reachable
        && unreachable_elapsed
            .map(|elapsed| elapsed >= debounce)
            .unwrap_or(false)
}

/// WI-3270 (a): probe the operator from INSIDE the WSL distro. On Windows,
/// `operator_http_ready` crosses the Windows→WSL localhost port-forward, which
/// flakes INDEPENDENTLY of operator health (observed live 2026-07-06: operator
/// + PG fully healthy inside the distro while every Windows-side probe of
/// 127.0.0.1:<port> failed). Treating such a flake as operator death made the
/// serve supervisor kill a healthy serve+PG, exhaust both respawn caps, and
/// take the whole distro down — so before declaring death, re-ask from inside.
/// Same acceptance rule as `operator_http_ready`: ANY completed HTTP response
/// proves the event loop is serving (curl exit 0; deliberately no `-f`, a 4xx
/// still proves liveness).
fn operator_http_ready_in_distro(port: u16) -> bool {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("wsl.exe");
        cmd.args([
            "--distribution",
            wsl_setup::DISTRO_NAME_PUB,
            "--exec",
            "curl",
            "-s",
            "-o",
            "/dev/null",
            "-m",
            "2",
            &format!("http://127.0.0.1:{}/api/health", port),
        ]);
        no_console_window(&mut cmd);
        cmd.status().map(|s| s.success()).unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = port;
        false
    }
}

/// WI-3270 (c): the Server SHELL's liveness beacon. The watcher's
/// `launch_bundle` can NEVER revive an operator while the Server shell is
/// still alive — single-instance dedupes the launch into a guaranteed no-op —
/// yet `decide_server_supervision` keyed only on the OPERATOR pid, so every
/// such no-op burned a respawn-cap slot until the watcher gave up (observed
/// live on the Windows VM; macOS `open -b` has the same burn). The Server's
/// serve supervisor refreshes this file every tick; a FRESH heartbeat tells
/// the watcher "shell alive — defer to its in-process serve supervisor"
/// instead of launching.
const SERVER_SHELL_HEARTBEAT_MAX_AGE: Duration = Duration::from_secs(10);

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ServerShellHeartbeat {
    pid: u32,
    ts: u64,
}

fn server_shell_heartbeat_path(workspace_home: &std::path::Path) -> std::path::PathBuf {
    workspace_home.join(".papercusp/server-shell-heartbeat.json")
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Written by the Server's serve supervisor each tick (~1.5s). Best-effort: a
/// failed write only degrades the watcher back to the old (cap-burning)
/// behavior — it must never take the supervisor down.
fn write_server_shell_heartbeat(workspace_home: &std::path::Path) {
    let path = server_shell_heartbeat_path(workspace_home);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let hb = ServerShellHeartbeat {
        pid: std::process::id(),
        ts: unix_now_secs(),
    };
    if let Ok(body) = serde_json::to_string(&hb) {
        let _ = std::fs::write(&path, body);
    }
}

/// Pure freshness rule (unit-tested): a heartbeat no older than the max age
/// proves the shell alive. Clock skew that puts `ts` in the future still
/// counts as fresh (saturating); a stale or missing one does not.
fn shell_heartbeat_fresh(ts: u64, now: u64, max_age: Duration) -> bool {
    now.saturating_sub(ts) <= max_age.as_secs()
}

/// Watcher read side: does a fresh heartbeat say the Server shell is up?
fn server_shell_alive(workspace_home: &std::path::Path) -> bool {
    let Ok(body) = std::fs::read_to_string(server_shell_heartbeat_path(workspace_home)) else {
        return false;
    };
    let Ok(hb) = serde_json::from_str::<ServerShellHeartbeat>(&body) else {
        return false;
    };
    shell_heartbeat_fresh(hb.ts, unix_now_secs(), SERVER_SHELL_HEARTBEAT_MAX_AGE)
}

/// Point the main window at the operator on `port`: compute the app origin
/// (the custom-protocol origin when it's on — Linux default; otherwise the HTTP
/// loopback base), navigate-or-reload the webview there, and (re-)inject
/// window.__papercuspBase so the SPA/bootstrap dials the right operator.
/// `reinject_ticks` re-evals the base injection every 300ms so a page (re)load
/// racing this thread still receives the port. Shared by the initial attach
/// (finish_boot) AND the operator watcher (WI-1869) so both stay in lockstep.
fn point_window_at_operator<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    port: u16,
    reinject_ticks: u32,
) {
    // Use 127.0.0.1, not localhost: WebKitGTK may resolve `localhost` to ::1
    // while the sidecar binds IPv4 loopback, which fails the bootstrap fetch.
    let base = format!("http://127.0.0.1:{}", port);
    // With the custom protocol on (Linux default) the SPA loads off the
    // `papercusp://localhost` origin; with it off (macOS/Windows) it's the HTTP
    // base — which on those platforms embeds the dynamic port, so a restart's
    // new port means a genuinely different app origin to navigate to.
    let app_base = if custom_protocol::enabled() {
        custom_protocol::APP_ORIGIN.to_string()
    } else {
        base.clone()
    };
    // __PAPERCUSP_TAURI__ tells PiPanel to use the native pty path. The page may
    // (re)load around this thread's timing, dropping __papercuspBase, so re-eval
    // on a short timer — web/index.html's tick() polls it, so a late set lands.
    let inject = format!(
        "window.__papercuspBase = '{}'; window.__papercuspAppBase = '{}'; window.__PAPERCUSP_TAURI__ = {{ kind: 'native' }}; window.dispatchEvent(new CustomEvent('papercusp:base'));",
        base, app_base
    );
    // Already on the app origin (custom-protocol statics session) → reload so
    // the SPA boots fresh against the live operator instead of sitting on dead
    // 503'd /api fetches; anywhere else (custom protocol off, or a stale HTTP
    // port after a restart) → navigate to the current origin.
    let already_on_app = window
        .url()
        .ok()
        .map(|u| u.as_str().starts_with(&app_base))
        .unwrap_or(false);
    if already_on_app {
        let _ = window.eval("location.reload()");
    } else {
        match app_base.parse() {
            Ok(parsed) => {
                if let Err(e) = window.navigate(parsed) {
                    eprintln!("[papercusp-desktop] navigate to {} failed: {}", app_base, e);
                }
            }
            Err(e) => eprintln!(
                "[papercusp-desktop] app base {} did not parse: {}",
                app_base, e
            ),
        }
    }
    for _ in 0..reinject_ticks {
        let _ = window.eval(&inject);
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
}

/// Payload for the `operator-dead` webview event (WI-1878 / critical-process-
/// supervisor-2026-07-04 P-005). Emitted once per operator-dead EPISODE: since
/// WI-3270 made give-up recoverable (respawns resume when the cap window
/// drains), GiveUp can recur across retry cycles — the callers gate this
/// notify on a once-per-episode flag that resets on recovery, so it still
/// never floods the webview. `reason` distinguishes which supervisor gave up,
/// since the two watchers cover different roles (GUI-side Server-bundle
/// respawn vs. the Server's own in-process serve.mjs child respawn).
#[derive(Debug, serde::Serialize, Clone)]
struct OperatorDeadPayload {
    reason: String,
    respawns: usize,
    window_secs: u64,
}

/// Pure text builder for the `operator-dead` OS notification body — split out
/// from `notify_operator_dead` so it's unit-testable without a live
/// `AppHandle` (same Linux-CI-testability rationale as `decide_server_supervision`
/// / `decide_serve_respawn`: the side-effecting emit/notification calls can't
/// run in CI, but the content they build can be verified).
fn operator_dead_notification_body(reason: &str, respawns: usize, window_secs: u64) -> String {
    format!(
        "Auto-restart backing off after {respawns} failed attempts in {window_secs}s ({reason}). \
         Retries continue in the background; restart the app to recover immediately."
    )
}

/// WI-1878 / P-005: surface a LOUD "operator dead" state once auto-respawn
/// gives up — the part of WI-1878's ask ("at minimum surface a loud
/// 'operator dead' state") that the WI-2667 respawn/backoff/give-up machinery
/// didn't yet cover (it only logged to stderr, invisible to a GUI user with
/// no terminal). Emits a webview event (for an in-app persistent banner) AND
/// raises a native OS notification, so the user finds out even if the window
/// is backgrounded/minimized. Best-effort: a notification failure is logged,
/// never fatal — the app is already in a degraded state, we must not panic
/// trying to report it.
fn notify_operator_dead(
    app_handle: &tauri::AppHandle,
    reason: &str,
    respawns: usize,
    window_secs: u64,
) {
    let _ = app_handle.emit(
        "operator-dead",
        OperatorDeadPayload {
            reason: reason.to_string(),
            respawns,
            window_secs,
        },
    );
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app_handle
        .notification()
        .builder()
        .title("Papercusp operator stopped responding")
        .body(operator_dead_notification_body(
            reason,
            respawns,
            window_secs,
        ))
        .show()
    {
        eprintln!("[papercusp-desktop] operator-dead notification failed: {e}");
    }
}

/// WI-1869: follow the operator across restarts. finish_boot reads operator.json
/// exactly once at attach; on macOS/Windows the operator takes a NEW dynamic
/// port on every Server restart / sidecar crash-respawn, so a one-shot discovery
/// strands the webview on the dead port forever (macOS has no load-failure
/// recovery at all, and the Linux EI-239 recovery only polls the same dead URI,
/// which never returns after a port change). This polls operator.json ~every
/// 1.5s and, when it names a LIVE operator on a different port than the one the
/// webview is on, re-navigates there — the cross-platform generalization of
/// EI-239 to dynamic-port moves. Runs for the life of the app on a daemon thread.
fn spawn_operator_watcher(
    app_handle: tauri::AppHandle,
    workspace_home: std::path::PathBuf,
    via_wsl: bool,
    initial_port: u16,
) {
    // WI-2667 respawn tuning. Tick is 1.5s, so:
    //   * ~15s of continuous unreachability before a respawn (tolerates a normal
    //     restart whose pid briefly rolls over — and single-instance makes a
    //     spurious `open -b` a no-op anyway);
    //   * a fresh Server gets 30s to boot before we count it dead again;
    //   * ≤5 respawns per 5-min window, else latch off (a Server that truly
    //     cannot boot must not hot-loop `open -b`).
    const DEAD_THRESHOLD_TICKS: u32 = 10;
    const POST_RESPAWN_GRACE: Duration = Duration::from_secs(30);
    const RESPAWN_WINDOW: Duration = Duration::from_secs(300);
    const MAX_RESPAWNS_PER_WINDOW: usize = 5;

    std::thread::spawn(move || {
        let mut applied_port = initial_port;
        // WI-2667 supervision state.
        let mut consecutive_dead: u32 = 0;
        let mut grace_until: Option<Instant> = None;
        let mut respawn_times: Vec<Instant> = Vec::new();
        let mut gave_up = false;
        // WI-3270 transition latches: defer-to-shell logging (once per streak)
        // and the operator-dead notification (once per dead episode — give-up
        // can now recur across retry cycles, the user shouldn't be re-notified
        // every ~5 minutes).
        let mut deferred_to_shell = false;
        let mut dead_notified = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let latest = find_operator_discovery(&workspace_home, via_wsl);

            // --- WI-1869: follow the operator's port across restarts (unchanged) ---
            if let Some(new_port) = next_operator_port(applied_port, latest.as_ref()) {
                // Guard against a STALE operator.json whose port was reused by an
                // unrelated process: only follow a discovery whose pid is alive.
                // WI-3282: pid-alive alone is NOT enough — a just-respawned operator
                // can write operator.json the instant it starts listening, before its
                // event loop is actually servicing requests (the exact WI-2902 starved
                // -boot window `wait_for_operator` already guards on initial boot via
                // operator_http_ready). Without the same bar here, a crash-respawn
                // mid-session could re-navigate the webview to a port that then hangs
                // every request for the ~20-50s starved window — indistinguishable from
                // the original "stuck onboarding" bug, just triggered by a later restart
                // instead of first boot. Require BOTH signals, exactly like the boot path.
                let pid_alive = latest
                    .as_ref()
                    .map(|d| discovery_pid_alive(d.pid, via_wsl))
                    .unwrap_or(false);
                if pid_alive && operator_http_ready(new_port) {
                    println!(
                        "[papercusp-desktop] operator moved :{} -> :{} — re-navigating the webview (WI-1869)",
                        applied_port, new_port
                    );
                    if let Some(window) = app_handle.get_webview_window("main") {
                        point_window_at_operator(&window, new_port, 10);
                        {
                            let state: tauri::State<SidecarState> = app_handle.state();
                            *state.port.lock().unwrap() = Some(new_port);
                        }
                        applied_port = new_port;
                    }
                }
            }

            // --- WI-2667: detect a DEAD Server and respawn it ---
            // `open -b` can only revive an EXITED Server (single-instance dedupes
            // a launch while it's alive), so the trigger is pid-liveness, which is
            // precisely the post-force-exit world (SIGTERM → force-exit → pid gone
            // → respawn → launchd-free crash recovery for the desktop GUI case).
            let now = Instant::now();
            let in_boot_grace = grace_until.map(|u| now < u).unwrap_or(false);
            let process_alive = latest
                .as_ref()
                .map(|d| discovery_pid_alive(d.pid, via_wsl))
                .unwrap_or(false);
            // Only count a tick as "dead" when it is dead AND we're not inside a
            // post-respawn boot grace (so a booting Server isn't double-respawned).
            let dead_count = if !process_alive && !in_boot_grace {
                consecutive_dead + 1
            } else {
                consecutive_dead
            };
            respawn_times.retain(|t| now.duration_since(*t) < RESPAWN_WINDOW);
            // WI-3270 (c): a fresh Server-shell heartbeat means a bundle launch
            // can only single-instance no-op — read it before deciding.
            let shell_alive = server_shell_alive(&workspace_home);
            match decide_server_supervision(
                process_alive,
                shell_alive,
                in_boot_grace,
                dead_count,
                DEAD_THRESHOLD_TICKS,
                respawn_times.len(),
                MAX_RESPAWNS_PER_WINDOW,
                gave_up,
            ) {
                ServerSupervisionAction::Healthy => {
                    consecutive_dead = 0;
                    deferred_to_shell = false;
                    dead_notified = false;
                    if gave_up {
                        eprintln!(
                            "[papercusp-desktop] Papercusp Server is back after a respawn give-up — \
                             re-arming auto-respawn (WI-3270)"
                        );
                        gave_up = false;
                    }
                }
                ServerSupervisionAction::Wait => {
                    consecutive_dead = dead_count;
                    deferred_to_shell = false;
                }
                ServerSupervisionAction::DeferToShell => {
                    consecutive_dead = dead_count;
                    if !deferred_to_shell {
                        eprintln!(
                            "[papercusp-desktop] operator process dead but the Papercusp Server \
                             shell is alive (fresh heartbeat) — a bundle launch would \
                             single-instance no-op, deferring to the Server's own serve supervisor \
                             instead of burning respawn attempts (WI-3270)"
                        );
                        deferred_to_shell = true;
                    }
                }
                ServerSupervisionAction::Respawn => {
                    if gave_up {
                        eprintln!(
                            "[papercusp-desktop] respawn window drained — retrying the Server \
                             respawn after an earlier give-up (WI-3270)"
                        );
                        gave_up = false;
                    }
                    deferred_to_shell = false;
                    // WI-3686: on Linux there is NO separately-installed "Papercusp
                    // Server" bundle to gtk-launch — a single .deb/.AppImage ships
                    // ONE process, and on Linux that process self-hosts its own
                    // operator sidecar (ensure_server_running/spawn_self_hosted_
                    // sidecar) under spawn_serve_supervisor's OWN in-process
                    // respawn-with-backoff (WI-1878). This watcher's job here was
                    // written for the Windows/macOS two-bundle model, where a dead
                    // Server process genuinely needs a sibling bundle re-launched.
                    // On Linux, `gtk-launch com.papercusp.server.desktop` always
                    // fails (no such .desktop entry — no GUI-only install ships
                    // one) and this branch would otherwise hot-loop it up to the
                    // respawn cap every ~15s of unreachability, forever, on any
                    // GUI-only Linux install. The self-hosted child already has its
                    // own supervisor; nothing more to do here but log once per
                    // respawn-cycle and let that supervisor do the actual revival.
                    #[cfg(target_os = "linux")]
                    {
                        eprintln!(
                            "[papercusp-desktop] Papercusp Server unreachable ~{}s — Linux single-bundle \
                             install has no separate Server bundle to relaunch; the self-hosted operator's \
                             own supervisor (spawn_serve_supervisor) owns its respawn (WI-3686)",
                            (dead_count as u64) * 1500 / 1000
                        );
                    }
                    #[cfg(not(target_os = "linux"))]
                    {
                        eprintln!(
                            "[papercusp-desktop] Papercusp Server unreachable ~{}s — respawning the Server bundle (WI-2667)",
                            (dead_count as u64) * 1500 / 1000
                        );
                        if let Err(e) = launch_bundle(SERVER_BUNDLE_ID, "Papercusp Server") {
                            eprintln!("[papercusp-desktop] Server respawn failed: {e}");
                        }
                    }
                    respawn_times.push(now);
                    consecutive_dead = 0;
                    grace_until = Some(now + POST_RESPAWN_GRACE);
                }
                ServerSupervisionAction::GiveUp => {
                    deferred_to_shell = false;
                    eprintln!(
                        "[papercusp-desktop] Papercusp Server respawn cap hit ({} in {}s) — the Server \
                         keeps dying; backing off until the respawn window drains (WI-2667 / WI-3270)",
                        MAX_RESPAWNS_PER_WINDOW,
                        RESPAWN_WINDOW.as_secs()
                    );
                    if !dead_notified {
                        notify_operator_dead(
                            &app_handle,
                            "Server bundle respawn cap hit",
                            MAX_RESPAWNS_PER_WINDOW,
                            RESPAWN_WINDOW.as_secs(),
                        );
                        dead_notified = true;
                    }
                    gave_up = true;
                }
            }
        }
    });
}

/// WI-3282 fix direction 1: does a process cmdline look like OUR serve
/// process (`serve.mjs` / `serve.ts`), not some unrelated process that
/// happens to have been assigned a recycled pid? Mirrors serve.ts's own
/// `acquireColdStartLock` `ownerIsServe` guard (apps/operator/bin/serve.ts) —
/// a bare "does /proc/<pid> exist" check is defeated by pid reuse, which is
/// near-certain after enough process churn (this desktop already hit the
/// identical class on the WSL cold-start lock, per that function's docs).
/// Pure + unit-tested; `None` (cmdline unreadable — e.g. a flaky WSL UNC
/// read) means "couldn't check" and the caller should fail OPEN (trust bare
/// pid-aliveness) rather than wrongly declare a live operator dead.
fn cmdline_looks_like_serve(cmdline: &str) -> bool {
    let lower = cmdline.to_ascii_lowercase();
    lower.contains("serve.mjs") || lower.contains("serve.ts")
}

/// Best-effort cmdline read for a LOCAL (non-WSL) pid: `/proc/<pid>/cmdline`
/// on Linux (NUL-separated argv, joined with spaces so the substring check
/// above matches regardless of arg boundaries), `ps` elsewhere. `None` when
/// unreadable (process gone mid-read, permission denied, non-Linux `ps`
/// failure) — callers must treat that as "unknown", not "not serve".
fn local_process_cmdline(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string(format!("/proc/{}/cmdline", pid))
            .ok()
            .map(|s| s.replace('\0', " "))
    }
    #[cfg(not(target_os = "linux"))]
    {
        Command::new("ps")
            .args(["-o", "command=", "-p", &pid.to_string()])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
    }
}

/// Liveness probe for a discovery-file pid (signal-0 equivalent: /proc on
/// Linux, `kill -0` elsewhere), STRENGTHENED (WI-3282) with a cmdline check
/// so a stale operator.json's pid can't false-positive after the OS recycles
/// it onto an unrelated process — the same class of bug serve.ts's
/// `acquireColdStartLock` already guards against on the lock file. Only
/// tightens the answer (alive-but-not-serve → false); when the cmdline can't
/// be read at all, falls back to the bare pid-alive answer so a flaky
/// WSL UNC read (documented on `read_operator_discovery_via_wsl`) can't
/// wrongly declare a genuinely-live operator dead.
///
/// `via_wsl`: the pid is a LINUX pid inside the papercup-runtime distro —
/// probe its /proc entry through wsl.exe (`kill` doesn't exist on Windows,
/// and a Windows pid check would be meaningless for it).
fn discovery_pid_alive(pid: u32, via_wsl: bool) -> bool {
    if via_wsl {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("wsl.exe");
            cmd.args([
                "--distribution",
                wsl_setup::DISTRO_NAME_PUB,
                "-e",
                "test",
                "-d",
                &format!("/proc/{}", pid),
            ]);
            no_console_window(&mut cmd);
            if !cmd.status().map(|s| s.success()).unwrap_or(false) {
                return false;
            }
            // Best-effort cmdline check via the same wsl.exe route; a failed
            // read (UNC flakiness, distro busy) falls back to "alive" per the
            // fail-open contract above.
            let mut cat_cmd = Command::new("wsl.exe");
            cat_cmd.args([
                "--distribution",
                wsl_setup::DISTRO_NAME_PUB,
                "-e",
                "cat",
                &format!("/proc/{}/cmdline", pid),
            ]);
            no_console_window(&mut cat_cmd);
            return match cat_cmd.output() {
                Ok(out) if out.status.success() => {
                    cmdline_looks_like_serve(&String::from_utf8_lossy(&out.stdout).replace('\0', " "))
                }
                _ => true,
            };
        }
    }
    #[cfg(target_os = "linux")]
    {
        if !std::path::Path::new(&format!("/proc/{}", pid)).exists() {
            return false;
        }
        match local_process_cmdline(pid) {
            Some(cmdline) => cmdline_looks_like_serve(&cmdline),
            None => true, // couldn't read (raced exit, perms) — fail open
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        if !Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return false;
        }
        match local_process_cmdline(pid) {
            Some(cmdline) => cmdline_looks_like_serve(&cmdline),
            None => true, // couldn't read (raced exit, perms) — fail open
        }
    }
}

/// Whether the operator at `port` can actually SERVE requests — not merely
/// ACCEPT a TCP connection.
///
/// WI-2902: on a fresh first boot the operator BINDS its HTTP port ~20s before
/// its event loop stops being starved by the heavy synchronous boot work
/// (embedded-PG seed extract + initdb / post-seed migrations, swarm peer
/// connect). During that window a `TcpStream::connect` succeeds but every HTTP
/// request HANGS. Declaring the operator "ready" on mere TCP-connectability made
/// `finish_boot` set `SidecarState.port` (which flips the `papercusp://` scheme
/// handler from serving the bundled SPA off DISK to FORWARDING every asset/route
/// chunk to the still-starving operator) and re-point the webview at it — so the
/// SPA's dynamic-import chunks fetched a server that couldn't answer, and the
/// desktop dead-ended on the fatal "This view hit an error / Importing a module
/// script failed" card (measured live: port bound ~36s, first HTTP response
/// ~46s, fully responsive ~55s).
///
/// A short-timeout HTTP probe returns true only once the event loop is actually
/// servicing requests (ANY completed HTTP response — even a 4xx — proves it; a
/// starved loop times out instead), which my measurements show coincides with
/// reliable static-chunk serving. Until then the window keeps serving the
/// bundled SPA from disk over `papercusp://` (`serve_bundled_spa`), so first
/// boot shows the onboarding UI, never a chunk-load card. Accepting any response
/// (not requiring 200) means a genuinely-up operator can never be falsely held
/// "not ready" into the 120s boot-timeout by a non-2xx health route. The probe
/// dials `127.0.0.1:port` exactly like the old TCP check, so it carries the same
/// loopback/WSL reachability assumptions — no platform regression.
fn operator_http_ready(port: u16) -> bool {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(2000))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(format!("http://127.0.0.1:{}/api/health", port))
        .send()
        .is_ok()
}

/// P-013 (desktop-build-hardening-tri-platform-2026-07-11): the post-update
/// self-check verdict. On launch the GUI asks the operator it attached to for
/// its `/api/health` sha and compares it against THIS build's OWN compile-time
/// sha (`option_env!("PAPERCUSP_BUILD_SHA")` — the on-disk artifact's own
/// identity, the same value `emit-build-provenance.sh` records as `buildSha`,
/// NOT "the latest release"). A mismatch means the running operator is NOT the
/// one this installed build shipped — the EI-9002 silent no-op update, where a
/// stale operator survived (e.g. inside WSL) and was adopted instead of
/// replaced. D-002: keying off the installed build's OWN sha makes this the SAME
/// invariant that both forward-install AND rollback verify against — a
/// deliberate downgrade to tag T PASSES when `/api/health` reports T's sha.
#[derive(Debug, PartialEq, Eq)]
enum UpdateSelfCheck {
    /// Both shas known and equal — the running operator matches this build.
    Match,
    /// Both shas known and different — a stale/foreign operator (EI-9002).
    Mismatch { baked: String, running: String },
    /// One side unknown — a dev build with no baked sha, or `/api/health` gave
    /// no sha (e.g. a Windows→WSL forward flake, WI-3270). We only ASSERT when we
    /// can actually compare, so a missing side never raises a false mismatch.
    Skipped,
}

/// Pure comparison — cargo-testable without a live operator. An empty string is
/// treated as "unknown" (both `option_env!` and a missing JSON field surface as
/// empty here); surrounding whitespace is ignored.
fn evaluate_update_self_check(baked_sha: &str, running_sha: &str) -> UpdateSelfCheck {
    let baked = baked_sha.trim();
    let running = running_sha.trim();
    if baked.is_empty() || running.is_empty() {
        return UpdateSelfCheck::Skipped;
    }
    if baked == running {
        UpdateSelfCheck::Match
    } else {
        UpdateSelfCheck::Mismatch {
            baked: baked.to_string(),
            running: running.to_string(),
        }
    }
}

/// Fetch the operator's self-reported build sha from `/api/health` (best-effort;
/// None on any transport/parse failure — the self-check then Skips rather than
/// false-alarming). Mirrors `operator_http_ready`'s short-timeout blocking client.
fn fetch_operator_health_sha(port: u16) -> Option<String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(2000))
        .build()
        .ok()?;
    let body = client
        .get(format!("http://127.0.0.1:{}/api/health", port))
        .send()
        .ok()?
        .text()
        .ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    v.get("sha")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// The static release host this build's operator polls for updates
/// (plan desktop-release-hosting-r2-2026-07-12; WI-4389/WI-3875).
///
/// Precedence: a RUNTIME `PAPERCUSP_RELEASE_HOST` wins (so a test build can be
/// aimed at a staging host with no recompile), else the COMPILE-TIME bake that
/// release-local.sh exports. Empty string when neither is set — the operator
/// treats that as "no release host" and falls back to the legacy GitHub
/// discovery path, which is exactly today's behavior, so an un-baked dev build
/// is unaffected.
fn baked_release_host() -> String {
    std::env::var("PAPERCUSP_RELEASE_HOST")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| option_env!("PAPERCUSP_RELEASE_HOST").unwrap_or("").to_string())
}

/// P-013: run the post-update self-check and, on a genuine mismatch, surface it
/// to the SPA (a `papercusp:update-mismatch` event + `window.__papercuspUpdateMismatch`)
/// and the console. Match/Skipped just log. Best-effort and non-fatal — a health
/// hiccup must never block boot, so callers run this OFF the finish_boot thread.
fn run_update_self_check<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, port: u16) {
    let baked = option_env!("PAPERCUSP_BUILD_SHA").unwrap_or("");
    let running = fetch_operator_health_sha(port).unwrap_or_default();
    match evaluate_update_self_check(baked, &running) {
        UpdateSelfCheck::Match => {
            println!(
                "[papercusp-desktop] post-update self-check: OK (operator sha {} matches this build)",
                running
            );
        }
        UpdateSelfCheck::Skipped => {
            println!(
                "[papercusp-desktop] post-update self-check: skipped (baked='{}' running='{}')",
                baked, running
            );
        }
        UpdateSelfCheck::Mismatch { baked, running } => {
            eprintln!(
                "[papercusp-desktop] post-update self-check MISMATCH: this build is {} but the running operator reports {} — the update did not replace the running operator (EI-9002). The app is talking to a STALE operator; restarting Papercusp Server is needed.",
                baked, running
            );
            let payload = serde_json::json!({ "expected": baked, "running": running });
            let inject = format!(
                "window.__papercuspUpdateMismatch = {}; window.dispatchEvent(new CustomEvent('papercusp:update-mismatch', {{ detail: window.__papercuspUpdateMismatch }}));",
                serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string())
            );
            // Re-eval for a bit — the SPA may still be mid-handoff when this fires
            // (same rationale as the boot-error inject in finish_boot).
            for _ in 0..20 {
                let _ = window.eval(&inject);
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
}

#[cfg(test)]
mod post_update_self_check_tests {
    use super::{evaluate_update_self_check, UpdateSelfCheck};

    #[test]
    fn matching_shas_pass() {
        assert_eq!(
            evaluate_update_self_check("3cfe4e2-2537dc8", "3cfe4e2-2537dc8"),
            UpdateSelfCheck::Match
        );
    }

    #[test]
    fn differing_shas_are_a_mismatch_carrying_both() {
        // EI-9002: this build is new, the adopted operator is stale.
        assert_eq!(
            evaluate_update_self_check("newbuild-abc", "staleop-xyz"),
            UpdateSelfCheck::Mismatch {
                baked: "newbuild-abc".to_string(),
                running: "staleop-xyz".to_string(),
            }
        );
    }

    #[test]
    fn dev_build_with_no_baked_sha_skips() {
        // option_env!("PAPERCUSP_BUILD_SHA") is unset in a dev build → empty →
        // never a false mismatch alarm.
        assert_eq!(evaluate_update_self_check("", "3cfe4e2"), UpdateSelfCheck::Skipped);
    }

    #[test]
    fn unreadable_health_sha_skips() {
        // /api/health gave no sha (e.g. a Windows→WSL forward flake, WI-3270).
        assert_eq!(evaluate_update_self_check("3cfe4e2", ""), UpdateSelfCheck::Skipped);
    }

    #[test]
    fn surrounding_whitespace_is_ignored() {
        assert_eq!(
            evaluate_update_self_check("  3cfe4e2  ", "3cfe4e2\n"),
            UpdateSelfCheck::Match
        );
    }

    #[test]
    fn rollback_to_older_tag_passes_d002() {
        // D-002 non-negotiable acceptance: a deliberate downgrade installs the
        // OLDER build, whose baked sha == the operator it (re)launches → the
        // self-check must PASS, not false-alarm on "not the latest".
        let older = "0.0.6-rollbacksha";
        assert_eq!(evaluate_update_self_check(older, older), UpdateSelfCheck::Match);
    }
}

/// Cold WSL boots can include distro startup, embedded-PG crash recovery, and
/// migration replay. The measured Windows repro took 5m51s, so the WSL path
/// needs a generous hard ceiling instead of the generic 120s desktop budget.
/// This remains a bounded wait: a genuinely dead sidecar still fails fast in
/// `wait_for_operator` and a hung one surfaces after ten minutes.
fn operator_boot_timeout(via_wsl: bool) -> Duration {
    Duration::from_secs(if via_wsl { 600 } else { 120 })
}

/// Poll operator.json until it names a live, reachable operator (pid alive +
/// HTTP-responsive — see `operator_http_ready`, NOT mere TCP-accept), the serve
/// child dies, or the timeout lapses. This is the embedder's whole boot wait:
/// serve owns PG startup + migrations + host boot internally, so first boot
/// (initdb + full migration replay) can legitimately take a while.
///
/// (P-053) Runs on the finish_boot worker thread — NEVER on the Tauri
/// setup/main thread, where this poll used to freeze the unpainted window
/// for up to ten minutes on a cold WSL boot (macOS uses the 120s budget).
fn wait_for_operator(
    app_handle: &tauri::AppHandle,
    workspace_home: &std::path::Path,
    via_wsl: bool,
    timeout: Duration,
) -> Result<OperatorDiscovery, String> {
    // Discovery goes through find_operator_discovery: on Windows the sidecar
    // runs inside WSL and writes operator.json under the distro user's
    // /home/papercup, which the GUI reads via `wsl.exe cat` (the
    // `\\wsl.localhost` UNC share is unreliable — see
    // read_operator_discovery_via_wsl).
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Some(d) = find_operator_discovery(workspace_home, via_wsl) {
            // Readiness = HTTP-responsive, not just TCP-connectable. The port
            // binds ~20s before the starved-event-loop operator can serve its
            // own SPA chunks; gating on TCP-accept re-pointed the webview at a
            // server that then failed every chunk fetch → the fatal card
            // (WI-2902, see operator_http_ready).
            if discovery_pid_alive(d.pid, via_wsl) && operator_http_ready(d.port) {
                return Ok(d);
            }
        }
        // Fail fast when serve died with an error — no point burning the
        // full timeout polling for a discovery file that will never appear.
        // A SUCCESS exit is different: `serve --ensure` exits 0 after
        // reusing an already-running operator (Decision C), so keep polling
        // for that operator's discovery file.
        {
            let state: tauri::State<SidecarState> = app_handle.state();
            let mut guard = state.child.lock().unwrap();
            if let Some(child) = guard.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    if !status.success() {
                        return Err(format!(
                            "the operator process (serve.mjs) exited with {} before becoming \
                             ready — check the serve boot logs above",
                            status
                        ));
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    let discovery_path = if via_wsl {
        "/home/papercup/.papercusp/operator.json".to_string()
    } else {
        workspace_home
            .join(".papercusp/operator.json")
            .display()
            .to_string()
    };
    Err(format!(
        "operator did not become ready within {}s (no live operator.json at {}). \
         Embedded-PG initdb/migrations are the usual first-boot suspects — check the serve logs.",
        timeout.as_secs(),
        discovery_path
    ))
}

/// Everything that used to run synchronously in setup() after spawning serve
/// (P-053): wait for discovery, record the port, wire endpoint-IPC, and feed
/// the bootstrap page its base — or a visible failure state. Runs on a worker
/// thread so the main thread reaches the event loop immediately and the
/// window paints the bootstrap page while serve boots.
fn finish_boot(app_handle: tauri::AppHandle, workspace_home: std::path::PathBuf, via_wsl: bool) {
    let discovery = match wait_for_operator(
        &app_handle,
        &workspace_home,
        via_wsl,
        operator_boot_timeout(via_wsl),
    ) {
        Ok(d) => d,
        Err(reason) => {
            // WI-2749 part 1a: during Windows WSL onboarding the operator
            // legitimately isn't up yet — WSL install + rootfs import +
            // `/opt/papercup/bootstrap` + PG initdb/migrations routinely exceed
            // this bounded wait, and the Server's post-onboarding finalize restart
            // brings the operator up shortly after. Injecting the scary terminal
            // boot-error OVER the onboarding gate mid-flow is a FALSE ALARM, so
            // suppress it while WSL is not yet Ready: the gate UI owns onboarding
            // progress + errors, and finish_boot re-runs after the finalize
            // restart (when WSL is Ready) to surface any genuine operator failure.
            #[cfg(target_os = "windows")]
            if !matches!(
                wsl_setup::detect(&app_handle).state,
                wsl_setup::WslState::Ready
            ) {
                println!(
                    "[papercusp-desktop] operator not up within the cold-boot budget but WSL onboarding is still in progress — not a boot failure; deferring to the onboarding gate + the post-onboarding restart ({})",
                    reason
                );
                return;
            }
            // WI-3381 (owner directive 2026-07-08 — "make this work on all
            // platforms"): the bundled self/release operator failed to boot.
            // Before surfacing a dead-end boot error, fall back to the safest
            // reachable env (prod :3070 → staging :3170) so the user lands on the
            // deployed release instead of a stranded error page. Only fires when a
            // fallback env is actually up — a plain single-operator install where
            // nothing else runs shows the boot-error page exactly as before.
            // finish_boot is the shared packaged mac/win/linux boot path, so this
            // covers every platform. point_window_at_operator points BOTH content
            // and the /api base at the fallback (same mechanism as the success
            // path); on_page_load → retarget_for_url then pins /api to match.
            if let Some(fallback_port) = env_switch::reachable_fallback_env() {
                eprintln!(
                    "[papercusp-desktop] self/release operator did not boot ({}) — falling back to the safest reachable env :{}",
                    reason, fallback_port
                );
                if let Some(window) = app_handle.get_webview_window("main") {
                    #[cfg(target_os = "linux")]
                    {
                        grant_media_permission(&window);
                        install_load_failure_recovery(&window);
                    }
                    point_window_at_operator(&window, fallback_port, 30);
                    restore_window_visibility(&window, "fallback-env");
                }
                return;
            }
            eprintln!("[papercusp-desktop] FATAL: {}", reason);
            // Surface the failure ON the bootstrap page — web/index.html
            // renders window.__papercuspBootError as a terminal error
            // state instead of spinning forever. Re-eval for a while:
            // the page may still be mid-load when this fires (same
            // re-eval rationale as the success inject below).
            if let Some(window) = app_handle.get_webview_window("main") {
                let inject = format!(
                        "window.__papercuspBootError = {}; window.dispatchEvent(new CustomEvent('papercusp:boot-error'));",
                        serde_json::to_string(&reason)
                            .unwrap_or_else(|_| "\"operator boot failed\"".to_string())
                    );
                for _ in 0..20 {
                    let _ = window.eval(&inject);
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
            return;
        }
    };
    // The REAL port comes from discovery — `serve --ensure` may have reused
    // an already-running operator on a different port than our cold-start
    // hint.
    let port = discovery.port;
    {
        let state: tauri::State<SidecarState> = app_handle.state();
        *state.port.lock().unwrap() = Some(port);
    }
    println!(
        "[papercusp-desktop] operator ready on :{} (pid {})",
        port, discovery.pid
    );

    // Endpoint-IPC: runBootstrap inside serve starts the IPC server and
    // writes ~/.papercusp/endpoint-ipc.json (the discovery file also covers
    // the --ensure reuse case, where there is no fresh child stdout to
    // parse). Manage a reconnecting handle whose socket source re-reads the
    // file — same pattern as the dev branch — and warm it in the background.
    // If the socket never appears, /api falls back to HTTP (ipcFetch
    // polyfill).
    let ipc_enabled = std::env::var("PAPERCUSP_DESKTOP_IPC").ok().as_deref() != Some("0");
    if ipc_enabled {
        // WI-3395: on Windows the sidecar runs in WSL2 and writes
        // endpoint-ipc.json to its WSL-native ~/.papercusp — a DIFFERENT
        // filesystem from `workspace_home`. `find_endpoint_ipc_socket` reads it
        // from inside the distro when routed via WSL (else the local path), so
        // the client actually finds the `tcp://` endpoint instead of stranding
        // /api on the capped HTTP fallback.
        let disc_home = workspace_home.clone();
        let handle = endpoint_ipc::IpcClientHandle::new(move || {
            find_endpoint_ipc_socket(&disc_home, via_wsl).map(std::path::PathBuf::from)
        });
        app_handle.manage(handle.clone());
        let ipc_app_handle = app_handle.clone();
        let warm_home = workspace_home.clone();
        tauri::async_runtime::spawn(async move {
            for _ in 0..120 {
                if handle.warm().await.is_ok() {
                    println!("[papercusp-desktop] endpoint-ipc client connected (discovery file)");
                    if let Some(path) = find_endpoint_ipc_socket(&warm_home, via_wsl) {
                        let state: tauri::State<SidecarState> = ipc_app_handle.state();
                        *state.endpoint_ipc_socket.lock().unwrap() = Some(path);
                    }
                    return;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            eprintln!(
                "[papercusp-desktop] endpoint-ipc: no socket after 60s — /api stays on HTTP this session"
            );
        });
    }

    // Tell the bootstrap page where the sidecar is. The JS in web/index.html
    // will poll /api/desktop/preflight on that base, render any
    // missing-prereq UI, then navigate when ready.
    if let Some(window) = app_handle.get_webview_window("main") {
        // WebKitGTK denies getUserMedia by default; auto-grant so voice /
        // wake-word / elevenlabs work in the shipped build the same way they
        // do in browsers.
        #[cfg(target_os = "linux")]
        grant_media_permission(&window);
        // EI-239: same-port bounce recovery (Linux-only — the operator port is
        // fixed on the dev box). Dynamic-port restarts are handled cross-platform
        // by the operator watcher installed below (WI-1869).
        #[cfg(target_os = "linux")]
        install_load_failure_recovery(&window);
        // Point the webview at the freshly-discovered operator: navigate/reload
        // to the app origin + inject window.__papercuspBase (see the helper).
        // Packaged builds load the conf's frontendDist URL (:3070) as the INITIAL
        // document — nothing serves it on a user machine — and setup() already
        // moved us to the app origin's bundled statics; this re-points at the
        // now-live operator. reinject_ticks=30 covers a page (re)load racing this
        // thread during the bootstrap→SPA handoff.
        point_window_at_operator(&window, port, 30);
        restore_window_visibility(&window, "operator-ready");
        // P-013: verify the operator we just attached to is the one THIS build
        // shipped (its /api/health sha == our baked sha) — catching the EI-9002
        // silent no-op update where a stale operator was adopted. Off-thread so a
        // mismatch's re-eval surfacing loop never delays the operator watcher below.
        let window_sc = window.clone();
        std::thread::spawn(move || run_update_self_check(&window_sc, port));
    }

    // WI-1869: after the one-shot attach above, KEEP following the operator.
    // finish_boot reads operator.json exactly once; on macOS/Windows the operator
    // takes a NEW dynamic port on every Server restart / sidecar crash-respawn,
    // which would otherwise strand the webview on the dead port forever (macOS
    // has no load-failure recovery, and the Linux one polls the same dead URI).
    // The watcher re-navigates to the current operator whenever its port changes.
    spawn_operator_watcher(app_handle.clone(), workspace_home.clone(), via_wsl, port);
}

// ===========================================================================
// Two-bundle split: GUI (attach) + Server (own the sidecar). See app_role.rs.
// ===========================================================================

/// Bundle identifiers — MUST match the two tauri configs (tauri.conf.json →
/// GUI, tauri.server.conf.json → Server). On Linux (single self-hosted
/// bundle — WI-2902/WI-3686) neither the watcher's respawn arm nor
/// ensure_server_running ever calls launch_bundle with this id in non-test
/// builds, so it's allowed dead there; it's still referenced by the
/// cross-platform unit tests below.
#[cfg_attr(target_os = "linux", allow(dead_code))]
const SERVER_BUNDLE_ID: &str = "com.papercusp.server";
const GUI_BUNDLE_ID: &str = "com.papercusp.gui";

/// P-009 single-instance callback — fires IN THE PRIMARY instance when a second
/// instance of the SAME bundle is launched (the single-instance plugin closes
/// the duplicate before it boots). Per-bundle by construction: the OS lock keys
/// on the app identifier, so this only ever fires for a same-bundle collision
/// (GUI↔GUI or Server↔Server), never GUI↔Server.
///   * GUI    — raise/unminimize/focus the existing window (the standard
///     "you already have Papercusp open" UX; the duplicate just vanishes).
///   * Server — windowless (tray only); nothing to focus. Rejecting the
///     duplicate is the whole point — one Server owns the sidecar + its ports.
///     Just log, so a double-launch is diagnosable.
/// Only wired in release builds (see run()), so it's dead code in dev.
#[cfg_attr(debug_assertions, allow(dead_code))]
fn on_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let role = app_role::detect(&app.config().identifier);
    println!(
        "[papercusp-{}] single-instance: rejected a duplicate launch (args={args:?} cwd={cwd})",
        role.label()
    );
    if role.is_gui() {
        if let Some(window) = app.get_webview_window("main") {
            restore_window_visibility(&window, "second-instance");
        }
    }
}

/// GUI role setup: never spawn a sidecar. Point the window at the app origin
/// (bundled statics / booting shell) immediately, then — off the main thread —
/// ensure a Papercusp Server is running (auto-launch its bundle if not) and
/// attach the window to its operator via the shared discovery file. `child`
/// stays None, so quit never tears the Server down (shutdown_children_once →
/// kill_sidecar is a no-op).
fn gui_setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // The GUI reads the discovery file the Server wrote; on Windows the sidecar
    // lives inside WSL, so mirror the same routing to find the right path.
    let via_wsl = should_route_via_wsl(&app.handle());
    wsl_setup::set_route_active(via_wsl);

    // WI-2648: the docs-search palette shortcut is owned by the always-on
    // SERVER process (registered next to install_server_tray), NOT the GUI —
    // so the global key works whether or not the GUI window is open, and the
    // tray rebind control lives in the same process that owns the shortcut.
    // (The in-webview `open_docs_search_palette` command still works from here.)

    // onboarding_origin_enabled(), not enabled(): on Windows the pre-operator
    // navigate to the bundled-SPA origin is what renders the WslOnboardingGate
    // (enabled() is Linux-only; post-operator the window still moves to the real
    // HTTP port via point_window_at_operator so SSE streams natively). WI-2734.
    if custom_protocol::onboarding_origin_enabled() {
        if let Some(window) = app.get_webview_window("main") {
            restore_window_visibility(&window, "gui-setup");
            match custom_protocol::APP_ORIGIN.parse() {
                Ok(u) => {
                    if let Err(e) = window.navigate(u) {
                        eprintln!("[papercusp-gui] app-origin navigate failed: {e}");
                    }
                }
                Err(e) => eprintln!("[papercusp-gui] APP_ORIGIN did not parse: {e}"),
            }
        }
    }

    let app_handle = app.handle().clone();
    let workspace_home = workspaces::shared_sidecar_home();
    std::thread::spawn(move || {
        ensure_server_running(&app_handle, &workspace_home, via_wsl);
        // finish_boot polls operator.json (up to 120s — covers a cold Server
        // boot), wires endpoint-IPC, and navigates the window to the operator.
        finish_boot(app_handle, workspace_home, via_wsl);
    });
    Ok(())
}

/// If no operator is reachable, launch the sibling "Papercusp Server" bundle.
/// Does not block on full readiness — finish_boot's poll handles the boot wait.
fn ensure_server_running(
    app_handle: &tauri::AppHandle,
    workspace_home: &std::path::Path,
    via_wsl: bool,
) {
    if wait_for_operator(app_handle, workspace_home, via_wsl, Duration::from_secs(2)).is_ok() {
        println!("[papercusp-gui] a Papercusp Server is already running — attaching");
        return;
    }
    // On Linux the app ships as ONE self-contained bundle (a single .deb /
    // .AppImage). There is no separately-installed "Papercusp Server" bundle to
    // gtk-launch — the Windows/macOS two-bundle split has no clean Linux
    // packaging analog (two debs collide on /usr/bin/papercusp-desktop + the
    // shared icons, and a `gtk-launch com.papercusp.server.desktop` can't resolve
    // the productName-named "Papercusp Server.desktop" entry anyway). So on Linux
    // the GUI process spawns + OWNS the operator sidecar itself, exactly like the
    // Server role does — making a single `apt install` fully functional on a fresh
    // machine. If a separate Server IS running it was already reached above, so
    // this only fires when nothing is up. The child goes into SidecarState so the
    // normal GUI quit path (kill_sidecar) tears embedded-PG + the operator down
    // cleanly. (WI-2902, 2026-07-05.)
    #[cfg(target_os = "linux")]
    {
        println!(
            "[papercusp-gui] no Server reachable — self-hosting the operator sidecar (single-bundle Linux)"
        );
        if let Err(e) = spawn_self_hosted_sidecar(app_handle, workspace_home, via_wsl) {
            eprintln!(
                "[papercusp-gui] could not self-host the operator sidecar ({e}); \
                 will keep polling in case it comes up another way"
            );
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        println!("[papercusp-gui] no Server reachable — launching the Papercusp Server bundle");
        if let Err(e) = launch_bundle(SERVER_BUNDLE_ID, "Papercusp Server") {
            eprintln!(
                "[papercusp-gui] could not launch Papercusp Server ({e}); \
                 will keep polling in case it comes up another way"
            );
        }
    }
}

/// Linux single-bundle self-host: spawn + OWN the operator sidecar from the GUI
/// process. Mirrors the Server-role boot in run()'s setup (embedded-PG + the Hono
/// operator, all inside `serve.mjs --ensure`) MINUS the tray — so a
/// single `apt install ./papercusp.deb` (or the AppImage) is fully self-contained
/// on a fresh machine, with no separately installed "Papercusp Server" bundle
/// required. The `serve.mjs` child is stored in `SidecarState.child` so the
/// ordinary GUI quit path (`kill_sidecar`) shuts embedded-PG + the operator down
/// gracefully instead of orphaning postgres.
///
/// WI-1878: this path used to skip the respawn supervisor entirely — a dead
/// serve.mjs child here (SIGTERM, crash) stayed down until the user manually
/// quit + reopened the whole app, because nothing else owns or watches this
/// child on single-bundle Linux. Now shares `spawn_serve_supervisor` with the
/// Server-role boot path, so a killed operator child gets the same
/// respawn-with-backoff + crash-loop cap here too.
#[cfg(target_os = "linux")]
fn spawn_self_hosted_sidecar(
    app_handle: &tauri::AppHandle,
    workspace_home: &std::path::Path,
    via_wsl: bool,
) -> std::io::Result<()> {
    // First-launch ~/.papercusp migration + per-workspace credential homes
    // (same call the Server role makes before spawning serve).
    if let Err(e) = workspaces::ensure_initialized() {
        eprintln!(
            "[papercusp-gui] workspace registry init failed: {e} (continuing with shared home)"
        );
    }
    let sidecar_dir = app_handle
        .path()
        .resolve("sidecar", tauri::path::BaseDirectory::Resource)
        .unwrap_or_else(|_| std::path::PathBuf::from("./sidecar"));
    let shared_state_dir = workspaces::shared_data_dir();
    if let Err(e) = std::fs::create_dir_all(&shared_state_dir) {
        eprintln!(
            "[papercusp-gui] could not create shared state dir {}: {e}",
            shared_state_dir.display()
        );
    }
    let port = find_free_port().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AddrNotAvailable,
            "no free port available for the operator",
        )
    })?;
    let pg_port_hint = portpicker::pick_unused_port().unwrap_or(15432);

    // (EI-8894/WI-3633 leg 2) Same boot-time orphan sweep as the Server-role
    // path (bring_up_sidecar) — this self-hosted-on-Linux path bypasses that
    // function entirely, so it needs its own call right before spawn_serve.
    sweep_stale_operator_orphan(workspace_home, via_wsl);
    let child = spawn_serve(
        via_wsl,
        port,
        &sidecar_dir,
        pg_port_hint,
        &shared_state_dir,
        workspace_home,
    )?;

    if let Some(state) = app_handle.try_state::<SidecarState>() {
        *state.child.lock().unwrap() = Some(child);
        *state.port.lock().unwrap() = Some(port);
        // WI-1878: this self-hosted child otherwise has no supervisor — wire
        // it into the same respawn-with-backoff loop the Server role uses.
        spawn_serve_supervisor(
            app_handle.clone(),
            via_wsl,
            port,
            sidecar_dir,
            pg_port_hint,
            shared_state_dir,
            workspace_home.to_path_buf(),
        );
    } else {
        // Managed state missing (should never happen — it's registered on the
        // builder in run()). Leak the handle so the process survives: std's
        // Child::drop does NOT kill the process, but being explicit documents it.
        std::mem::forget(child);
    }
    Ok(())
}

/// Cross-platform "launch the sibling app bundle by identity".
///   * macOS  — `open -b <bundle-id>`: LaunchServices resolves the installed
///     .app regardless of where it lives. Solid + used as the primary path.
///   * Linux  — `gtk-launch <bundle-id>.desktop` (the freedesktop way to start
///     an installed app by its desktop-entry id), best-effort.
///   * Windows — NOT yet wired: both bundles ship the SAME binary name
///     (`papercusp-desktop`), so a sibling-exe launch can't tell them apart —
///     it needs the per-bundle install path (registry / Start-menu). Until then
///     the GUI surfaces "start the Server" rather than mis-launching itself.
///     (Tracked as the Windows-launch follow-up.)
fn launch_bundle(bundle_id: &str, product_name: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let _ = product_name;
        Command::new("open").arg("-b").arg(bundle_id).spawn()?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = product_name;
        // The deb/appimage desktop-entry id follows the bundle identifier.
        Command::new("gtk-launch")
            .arg(format!("{bundle_id}.desktop"))
            .spawn()?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let _ = bundle_id;
        // Both bundles ship the SAME binary name (papercusp-desktop.exe) but NSIS
        // installs each to its own per-product dir:
        //   %LOCALAPPDATA%\<ProductName>\papercusp-desktop.exe
        // (verified live: "Papercusp GUI" / "Papercusp Server"). Resolve the
        // sibling by product name and spawn it DETACHED with
        // CREATE_BREAKAWAY_FROM_JOB so it outlives us even when we were started by
        // the installer's run-after-install (which lives in a job object that
        // kills its whole tree — D-010). (2026-07-02 parity fix: previously
        // unimplemented, so the GUI could not auto-launch the Server and the
        // Server tray's "Open Papercusp" could not launch the GUI.)
        use std::os::windows::process::CommandExt;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let local = std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "LOCALAPPDATA unset")
            })?;
        let exe = local.join(product_name).join("papercusp-desktop.exe");
        if !exe.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("'{product_name}' not installed at {}", exe.display()),
            ));
        }
        std::process::Command::new(&exe)
            .creation_flags(CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS)
            .spawn()
            .or_else(|_| std::process::Command::new(&exe).spawn())?;
        Ok(())
    }
}

/// Menu-id prefix for the tray's docs-search-shortcut preset items
/// (`docs-shortcut::<accelerator>`), so the menu-event handler can tell a rebind
/// click from the open/quit items and recover the chosen accelerator.
const DOCS_SHORTCUT_MENU_PREFIX: &str = "docs-shortcut::";

/// The "Docs search shortcut" submenu: an "Off" item followed by one checkable
/// item per preset, with the live state (docs_search::current_shortcut) checked.
/// Rebuilt after each change so the checkmark tracks the selection.
///
/// "Off" is FIRST and is checked on a fresh install — the shortcut ships disabled
/// (owner directive 2026-07-12), so this submenu is also the only place the OS key
/// grab is ever turned ON.
fn build_docs_shortcut_submenu(
    app: &tauri::AppHandle,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    use tauri::menu::{CheckMenuItem, IsMenuItem, Submenu};
    let current = docs_search::current_shortcut();
    let mut items: Vec<CheckMenuItem<tauri::Wry>> = Vec::new();
    items.push(CheckMenuItem::with_id(
        app,
        format!("{DOCS_SHORTCUT_MENU_PREFIX}{}", docs_search::SHORTCUT_OFF),
        "Off (no global shortcut)",
        true,
        current.is_none(),
        None::<&str>,
    )?);
    for accel in docs_search::PRESET_SHORTCUTS {
        items.push(CheckMenuItem::with_id(
            app,
            format!("{DOCS_SHORTCUT_MENU_PREFIX}{accel}"),
            *accel,
            true,
            current.as_deref() == Some(*accel),
            None::<&str>,
        )?);
    }
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|i| i as &dyn IsMenuItem<tauri::Wry>)
        .collect();
    Submenu::with_items(app, "Docs search shortcut", true, &refs)
}

/// Server-role state for the WI-4404 background update poller: the newest
/// version the poller has found available, if any. `None` once installed/
/// consumed. Read by `build_server_tray_menu` to decide whether to show the
/// "Install Update" item; written by `spawn_server_update_poller`.
struct ServerUpdateState {
    pending_version: std::sync::Mutex<Option<String>>,
}

/// Build the full Server tray menu: Open · [Install Update vX ·] Docs search
/// shortcut ▸ · — · Quit. Factored out so the menu-event handler can rebuild
/// it after a rebind, or after the background poller finds/consumes an
/// update (WI-4404).
fn build_server_tray_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let open = MenuItem::with_id(app, "open-gui", "Open Papercusp", true, None::<&str>)?;
    // WI-3382 (owner 2026-07-08): launch the `papercusp tutorial` CLI utility in a
    // native terminal — the tray twin of the "Papercusp Tutorial & setup" icon.
    let tutorial = MenuItem::with_id(app, "open-tutorial", "Open Tutorial", true, None::<&str>)?;
    let shortcut = build_docs_shortcut_submenu(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(
        app,
        "quit-server",
        "Quit Papercusp Server",
        true,
        None::<&str>,
    )?;

    // WI-4404: the Server has no webview, so it has no UpdateChip — this is
    // its ONLY update surface. Mirrors the GUI's own stated design ("nothing
    // installs on its own — every install path is behind a confirm",
    // UpdateChip.tsx): the poller only ever offers the item; a click IS the
    // confirm gesture, same as the GUI's confirm+click.
    let pending: Option<String> = app
        .try_state::<ServerUpdateState>()
        .and_then(|s| s.pending_version.lock().ok().and_then(|g| g.clone()));
    if let Some(version) = pending {
        let install = MenuItem::with_id(
            app,
            "install-update",
            format!("Install Update (v{version})…"),
            true,
            None::<&str>,
        )?;
        let sep2 = PredefinedMenuItem::separator(app)?;
        return Menu::with_items(
            app,
            &[&open, &install, &sep2, &tutorial, &shortcut, &sep, &quit],
        );
    }
    Menu::with_items(app, &[&open, &tutorial, &shortcut, &sep, &quit])
}

/// The spec the tray "Open Tutorial" runs on Linux/Windows: the `papercusp
/// tutorial` CLI (opens the "Tutorial & Setup" shell on the Tutorial tab) in a
/// native terminal. `papercusp` is a global CLI on PATH (a login shell resolves
/// it), so no absolute path is needed. cwd defaults to $HOME; "." keeps it
/// cwd-agnostic where HOME is unset (papercusp tutorial ignores cwd).
#[cfg(not(target_os = "macos"))]
fn tutorial_console_spec() -> native_console::ExternalConsoleSpec {
    let cwd = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    native_console::ExternalConsoleSpec {
        command: "papercusp".to_string(),
        args: vec!["tutorial".to_string()],
        cwd,
        env: std::collections::HashMap::new(),
        title: "Papercusp Tutorial".to_string(),
    }
}

/// Open the `papercusp tutorial` CLI utility in a NEW native terminal window —
/// the tray "Open Tutorial" action (WI-3382, owner directive 2026-07-08). Reuses
/// the same external-terminal launcher the onboarding tutorial uses
/// (`native_console::external_console_run`) on Linux/Windows; on macOS that command
/// is unsupported (the onboarding UX there is an embedded pane), so drive
/// Terminal.app directly.
fn launch_tutorial_console() {
    #[cfg(target_os = "macos")]
    {
        // external_console_run is Linux/Windows-only — open Terminal.app instead.
        if let Err(e) = std::process::Command::new("osascript")
            .arg("-e")
            .arg("tell application \"Terminal\" to do script \"papercusp tutorial\"")
            .arg("-e")
            .arg("tell application \"Terminal\" to activate")
            .spawn()
        {
            eprintln!("[papercusp-server] could not launch tutorial (macOS): {e}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Linux: a real native terminal via the bundled-ghostty / $TERMINAL cascade.
        // Windows: a Windows Terminal window running the command inside WSL
        // (TODO(windows): confirm the WSL cwd for the one-liner on a packaged build).
        let spec = tutorial_console_spec();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = native_console::external_console_run(spec).await {
                eprintln!("[papercusp-server] could not launch tutorial: {e}");
            }
        });
    }
}

#[cfg(all(test, not(target_os = "macos")))]
mod tutorial_console_spec_tests {
    #[test]
    fn spec_launches_papercusp_tutorial_in_a_titled_window() {
        let spec = super::tutorial_console_spec();
        assert_eq!(spec.command, "papercusp");
        assert_eq!(spec.args, vec!["tutorial".to_string()]);
        assert_eq!(spec.title, "Papercusp Tutorial");
    }
}

/// Build the Server's tray/menubar icon (the windowless backend's only surface):
/// open the GUI, change the docs-search shortcut, or quit (which tears the
/// sidecar down via ExitRequested).
fn install_server_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::tray::TrayIconBuilder;

    let menu = build_server_tray_menu(app.handle())?;

    let mut builder = TrayIconBuilder::with_id("papercusp-server")
        .tooltip("Papercusp Server")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if id == "open-gui" {
                if let Err(e) = launch_bundle(GUI_BUNDLE_ID, "Papercusp GUI") {
                    eprintln!("[papercusp-server] could not launch GUI: {e}");
                }
            } else if id == "open-tutorial" {
                launch_tutorial_console();
            } else if id == "quit-server" {
                app.exit(0);
            } else if id == "install-update" {
                // WI-4404: this click IS the confirm gesture (the Server has no
                // webview to run UpdateChip's confirm dialog in) — go straight to
                // install_update, exactly what the GUI does after its own confirm.
                // install_update ends in app.restart() on success, so nothing after
                // that point runs; on failure it returns an Err we just log (the
                // pending-version tray item stays up so the next poll tick or a
                // retry click can try again).
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    println!("[papercusp-server] update install requested via tray");
                    if let Err(e) = install_update(app2.clone()).await {
                        eprintln!("[papercusp-server] tray-triggered update install failed: {e}");
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app2
                            .notification()
                            .builder()
                            .title("Papercusp Server update failed")
                            .body(format!("{e} — open the tray menu to retry."))
                            .show();
                    }
                });
            } else if let Some(payload) = id.strip_prefix(DOCS_SHORTCUT_MENU_PREFIX) {
                // Set the docs-search global shortcut live, then rebuild the tray
                // menu so the checkmark tracks the new selection. The "Off" item
                // carries the SHORTCUT_OFF payload → None → disable entirely.
                let choice = (payload != docs_search::SHORTCUT_OFF).then_some(payload);
                match docs_search::set_shortcut(app, choice) {
                    Ok(()) => match build_server_tray_menu(app) {
                        Ok(menu) => {
                            if let Some(tray) = app.tray_by_id("papercusp-server") {
                                let _ = tray.set_menu(Some(menu));
                            }
                        }
                        Err(e) => {
                            eprintln!("[papercusp-server] tray menu rebuild failed: {e}")
                        }
                    },
                    Err(e) => {
                        eprintln!("[papercusp-server] docs-search set to {payload} failed: {e}")
                    }
                }
            }
        });
    // Reuse the bundle icon (the Server config still ships icons even with no
    // window). If absent, some platforms still render a default tray glyph.
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// Register the Server bundle to launch at login (idempotent).
fn enable_login_autostart(app: &tauri::App) {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    match mgr.is_enabled() {
        Ok(true) => println!("[papercusp-server] login auto-start already enabled"),
        Ok(false) => match mgr.enable() {
            Ok(()) => println!("[papercusp-server] login auto-start enabled"),
            Err(e) => eprintln!("[papercusp-server] could not enable auto-start: {e}"),
        },
        Err(e) => eprintln!("[papercusp-server] auto-start state unknown: {e}"),
    }
}

/// Prepare rotated stdout+stderr sinks for the sidecar under
/// `<workspace_home>/.papercusp/logs/serve.log` (WI-1707).
///
/// A packaged desktop app is launched with NO controlling console — Finder /
/// `launchd` / a login-item on macOS, an Explorer / login GUI launch on Windows
/// — so the parent process's stdout/stderr are already `/dev/null`. An
/// *inherited* sidecar stdio therefore drops every serve boot / embedded-PG /
/// migration diagnostic on the floor, leaving a wedged install unbootstrappable
/// to debug (the exact gap this fixes). Point them at an on-disk log instead.
///
/// Rotation is per-spawn (each Server-app launch / crash-respawn): `<basename>`
/// → `<basename>.1` → … → `<basename>.5`, dropping the oldest, so history survives
/// a respawn without unbounded growth. Returns two `Stdio` handles onto the SAME
/// fresh file (stdout + a `try_clone`d stderr), or `None` if the log can't be
/// prepared — the caller then falls back to inherit so logging never blocks the
/// child from launching.
///
/// `basename` is the log file name (e.g. `serve.log`) so every
/// console-less child sidecar can route to its own rotated on-disk log via one
/// shared helper rather than each re-implementing the rotation (WI-1707/WI-1781).
/// Rotate `<workspace_home>/.papercusp/logs/<basename>` (…→`.5`, dropping the
/// oldest) and open a FRESH appendable file for it, returning the open handle.
///
/// The shared core of both console-less-stdio sinks: the CHILD-sidecar path
/// (`rotating_log_stdio`, which wraps this in a `(Stdio, Stdio)` pair) and the
/// OWN-process path (`redirect_own_stdio`, which `dup2`s this file's fd over
/// 1/2). Returns `None` if the log dir / file can't be prepared so every caller
/// can fall back without blocking boot.
fn rotate_and_open_log(workspace_home: &std::path::Path, basename: &str) -> Option<std::fs::File> {
    let logs_dir = workspace_home.join(".papercusp").join("logs");
    std::fs::create_dir_all(&logs_dir).ok()?;
    let base = logs_dir.join(basename);
    const KEEP: u32 = 5;
    let rotated = |n: u32| logs_dir.join(format!("{basename}.{n}"));
    // Drop the oldest, shift each older file up one, then the live log → .1.
    let _ = std::fs::remove_file(rotated(KEEP));
    for n in (1..KEEP).rev() {
        let _ = std::fs::rename(rotated(n), rotated(n + 1));
    }
    let _ = std::fs::rename(&base, rotated(1));
    // append: `base` was just rotated away so this creates a fresh file; append
    // (not truncate) is the safe choice if the rename above ever no-ops.
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&base)
        .ok()
}

fn rotating_log_stdio(workspace_home: &std::path::Path, basename: &str) -> Option<(Stdio, Stdio)> {
    let file = rotate_and_open_log(workspace_home, basename)?;
    let file2 = file.try_clone().ok()?;
    Some((Stdio::from(file), Stdio::from(file2)))
}

/// Redirect THIS process's OWN stdout+stderr (fd 1 & 2) to a rotated on-disk log
/// `<workspace_home>/.papercusp/logs/<basename>` — the own-process analogue of
/// `rotating_log_stdio` (WI-1803).
///
/// WI-1707 pointed the CHILD sidecar's (serve) stdio at on-disk
/// logs, but the desktop app's OWN process is ALSO launched with no controlling
/// console (Finder / `launchd` / a login item on macOS), so its inherited fd
/// 1/2 are `/dev/null`. Every `println!` / `eprintln!` in THIS binary — the
/// GUI's `gui_setup` + `finish_boot` navigate/boot diagnostics, the Server's
/// sidecar-spawn errors — was therefore dropped on the floor, leaving a
/// blank-page GUI (WI-1802) undebuggable on a shipped Mac build. `dup2` the
/// rotated log's fd over 1 & 2 so those diagnostics land on disk, exactly like
/// a shell `exec >log 2>&1`.
///
/// Best-effort: any failure (no HOME, open error) leaves stdio untouched and
/// never blocks boot. This is the Unix (`dup2`) variant; the packaged Windows
/// GUI/Server bundles have the SAME console-less gap and get an equivalent
/// `SetStdHandle` variant below (WI-2749 — the missing Windows boot log made the
/// post-onboarding sidecar-spawn failure undebuggable on a shipped build).
/// Caller gates this to release builds so `tauri dev` keeps its inherited
/// terminal console.
///
/// Only WIRED IN release builds (the call site is `cfg(not(debug_assertions))`),
/// so a debug non-test build sees it unused — silence dead_code for exactly that
/// config; the `serve_log_tests` unit test exercises it under `cfg(test)`.
#[cfg(unix)]
#[cfg_attr(all(debug_assertions, not(test)), allow(dead_code))]
fn redirect_own_stdio(workspace_home: &std::path::Path, basename: &str) {
    use std::io::Write;
    use std::os::unix::io::AsRawFd;
    let Some(file) = rotate_and_open_log(workspace_home, basename) else {
        return;
    };
    // Flush anything Rust buffered against the old fds first (stdout is
    // block-buffered when 1 isn't a tty), so no stray bytes race the swap.
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    let fd = file.as_raw_fd();
    // SAFETY: `fd` is a valid open descriptor. `dup2` atomically points fd 1 & 2
    // at the log's open file description; Rust's `stdout()`/`stderr()` keep
    // writing to fd 1/2 (now the log). We `mem::forget` the `File` so its open
    // description outlives this fn — 1/2 must stay valid for the whole process,
    // just as an `exec >log 2>&1` redirect persists after the shell returns.
    unsafe {
        libc::dup2(fd, libc::STDOUT_FILENO);
        libc::dup2(fd, libc::STDERR_FILENO);
    }
    std::mem::forget(file);
}

/// Windows analogue of the Unix `redirect_own_stdio` above (WI-2749). Both
/// packaged bundles ship `windows_subsystem = "windows"` and are launched from
/// Explorer / the NSIS run-after-install checkbox / Task Scheduler with NO
/// console, so `GetStdHandle(STD_OUTPUT/ERROR)` is null and every `println!` /
/// `eprintln!` in this binary — the GUI boot-navigate diagnostics, the Server's
/// sidecar-spawn + WSL-route errors, the post-onboarding finalize/respawn
/// trace — is dropped on the floor, leaving Windows first-run failures (the
/// operator that never spawns after onboarding) undebuggable on a shipped
/// build. Point the process's std OUTPUT/ERROR handles at the rotated log via
/// `SetStdHandle`; Rust's Windows stdio resolves the handle through
/// `GetStdHandle` on every write, so its output now lands on disk — the
/// analogue of the Unix `dup2` swap.
///
/// Best-effort: any failure (no HOME, open error) leaves stdio untouched and
/// never blocks boot.
#[cfg(windows)]
#[cfg_attr(all(debug_assertions, not(test)), allow(dead_code))]
fn redirect_own_stdio(workspace_home: &std::path::Path, basename: &str) {
    use std::io::Write;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Console::{SetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE};
    let Some(file) = rotate_and_open_log(workspace_home, basename) else {
        return;
    };
    // Flush anything Rust buffered against the old handles before the swap.
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    let handle = HANDLE(file.as_raw_handle() as _);
    // SAFETY: `handle` is a valid open file handle. `SetStdHandle` points the
    // process's std OUTPUT/ERROR handles at the log's open file description;
    // Rust resolves the handle via `GetStdHandle` per write, so subsequent
    // `println!`/`eprintln!` land there. We `mem::forget` the `File` so its
    // handle outlives this fn — the std handles must stay valid for the whole
    // process (mirrors the Unix `mem::forget` + shell `exec >log 2>&1`
    // persistence).
    unsafe {
        let _ = SetStdHandle(STD_OUTPUT_HANDLE, handle);
        let _ = SetStdHandle(STD_ERROR_HANDLE, handle);
    }
    std::mem::forget(file);
}

/// Spawn the bundled `serve.mjs --ensure` (SP1 C5). serve owns embedded-PG +
/// the Hono host + the discovery files; this fn just assembles the desktop
/// environment for it:
///   - bundled PATH (node + vendored CLIs), workspace-HOME isolation
///   - the SPA/docs roots (desktop serves the UI: PAPERCUSP_SERVE_UI=1)
///   - PG knobs (picked port, shared data dir, bundled migrations dir)
///   - the cold-start port hint (PAPERCUSP_HONO_PORT)
/// stdout/stderr: in a dev build they're inherited (the developer's `tauri dev`
/// console); in a release (packaged) build — which has NO console — they're
/// redirected to a rotated <home>/.papercusp/logs/serve.log so boot / PG /
/// migration diagnostics survive on disk (WI-1707; see rotating_log_stdio). The
/// endpoint-IPC handshake is NOT parsed from stdout anymore; the discovery file
/// (~/.papercusp/endpoint-ipc.json) is the one channel that also covers the
/// --ensure reuse case, so redirecting stdout is safe.
#[allow(clippy::too_many_arguments)]
/// Spawn the operator sidecar (`papercusp serve`) and wire its respawn
/// supervisor + off-thread boot-wait. Callable from EITHER the Server-role
/// setup fast path (WSL already Ready / non-Windows) OR the Windows
/// deferred-boot watcher once WSL flips Ready — the watcher calls this
/// IN-PROCESS instead of breakaway-restarting a second instance.
///
/// WI-3407: the old deferred path spawned a fresh instance (via
/// `wsl_finalize_ready`) to re-run setup with WSL now Ready. That second
/// instance raced the STILL-ALIVE deferred Server for the per-bundle
/// single-instance lock, lost (`on_second_instance` rejected it), and left the
/// persisted finalize flag latched so no retry ever fired — every pristine
/// first boot wedged with an empty serve.log + the GUI's 120s operator FATAL.
/// This process is already the singleton lock holder, so it just spawns the
/// sidecar itself. Nothing here touches the Tauri main thread (only a process
/// spawn + `app.state()` + thread spawns), so it is safe off the watcher thread.
/// The WSL-independent tray / global shortcut / login-autostart are installed by
/// server setup BEFORE the WSL gate, so this path owns only the sidecar.
fn bring_up_sidecar(
    app: &tauri::AppHandle,
    via_wsl: bool,
    port: u16,
    sidecar_dir: std::path::PathBuf,
    pg_port_hint: u16,
    shared_state_dir: std::path::PathBuf,
    workspace_home: std::path::PathBuf,
) {
    // (EI-8894/WI-3633 leg 2) Boot-time orphan sweep — belt-and-suspenders
    // alongside the parent-death self-exit watch (serve.ts), which only
    // self-terminates a sidecar that is ITSELF still alive and polling its
    // own ppid. This catches anything that watch missed (an older build, a
    // crash before it installed) by checking the ONE pid THIS workspace's
    // operator.json actually names, right before we spawn our own fresh one.
    sweep_stale_operator_orphan(&workspace_home, via_wsl);
    let serve_child = match spawn_serve(
        via_wsl,
        port,
        &sidecar_dir,
        pg_port_hint,
        &shared_state_dir,
        &workspace_home,
    ) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[papercusp-desktop] failed to spawn serve: {}", e);
            return;
        }
    };

    let state: tauri::State<SidecarState> = app.state();
    *state.child.lock().unwrap() = Some(serve_child);

    // WI-2667/WI-3170/WI-3270 (respawn-with-backoff), shared with the Linux
    // GUI self-host path (spawn_self_hosted_sidecar).
    spawn_serve_supervisor(
        app.clone(),
        via_wsl,
        port,
        sidecar_dir.clone(),
        pg_port_hint,
        shared_state_dir.clone(),
        workspace_home.clone(),
    );

    // finish_boot waits for operator readiness + wires endpoint-IPC OFF-thread
    // (P-053): the setup thread / watcher must never block on the ~120s
    // first-boot initdb + migration replay.
    let app_handle = app.clone();
    let workspace_home_bg = workspace_home;
    std::thread::spawn(move || finish_boot(app_handle, workspace_home_bg, via_wsl));
}

/// Env vars forwarded across the Windows→WSL boundary to the sidecar.
///
/// WHY THIS IS A NAMED CONSTANT AND NOT AN INLINE STRING. On Windows the sidecar
/// runs INSIDE WSL2, so `Command::env(...)` alone does not reach it: a var must
/// ALSO be named here or the Linux side never sees it. That makes this list and
/// the `.env(...)` calls in `spawn_serve` two lists that must agree, with nothing
/// enforcing it — and a var set but not listed is dropped SILENTLY, on Windows
/// only, at runtime.
///
/// That is exactly how Windows auto-update shipped dead. `PAPERCUSP_RELEASE_HOST`
/// was baked into the .exe (the byte-gate proved it), set via `.env(...)` below,
/// and then never crossed into WSL — so the sidecar's `releaseHostBase()` read
/// undefined, `/api/updates/manifest` answered `cannot_check`, and the updater
/// rendered that as "you're on the latest". Forever. The bake was real and the
/// gate was honest; the value simply never arrived at the process that uses it.
/// PACKED IS NOT DELIVERED.
///
/// So: if you add a `.env(...)` to `spawn_serve` that the SIDECAR reads, add it
/// here too. `wslenv_forwards_every_var_the_sidecar_reads` pins the ones we know
/// are load-bearing.
const SIDECAR_WSLENV: &str = "PORT:HOSTNAME:NODE_ENV:PAPERCUSP_BUILD_SHA:PAPERCUSP_BUILD_VERSION:PAPERCUSP_HARNESS_DIR/p:PAPERCUSP_TEMPLATES_DIR/p:PAPERCUSP_RUBRICS_DIR/p:\
     PAPERCUSP_DESKTOP:PAPERCUSP_SHARED_OPERATOR:PAPERCUSP_OPERATOR_BASE:HOME/p:USERPROFILE/p:\
     PAPERCUSP_USE_EMBEDDED_PG:PAPERCUSP_PG_PORT:PAPERCUSP_PG_DATA_DIR:\
     PAPERCUSP_PG_SQL_DIR/p:PAPERCUSP_PG_SEED_PATH/p:PAPERCUSP_IDENTITY_DIR/p:PAPERCUSP_ANNOUNCE_IDENTITY_CACHE/p:\
     PAPERCUSP_HONO_PORT:PAPERCUSP_BIND_HOST:\
     PAPERCUSP_SERVE_UI:PAPERCUSP_DBOS_ENABLE:PAPERCUSP_DBOS_ROUTINES:\
     PAPERCUSP_DBOS_ORCHESTRATOR:PAPERCUSP_PROVISION_ENV_OPERATORS:\
     HARNESS_DATABASE_URL:HARNESS_ADMIN_DATABASE_URL:\
     PAPERCUSP_SPA_DIST/p:PAPERCUSP_DOCS_ROOT/p:\
     PAPERCUSP_PROMPTS_DIR/p:PAPERCUSP_SEED_DIR/p:PAPERCUSP_SIDECAR_BIN/p:\
     PAPERCUSP_SOURCE_ARCHIVE/p:PAPERCUSP_DEV_SOURCE_DIR:\
     PAPERCUSP_IPC_ENABLE:PAPERCUSP_IPC_TCP:\
     PAPERCUSP_RELEASE_HOST";

fn spawn_serve(
    via_wsl: bool,
    port_hint: u16,
    sidecar_dir: &std::path::Path,
    pg_port_hint: u16,
    shared_state_dir: &std::path::Path,
    workspace_home: &std::path::Path,
) -> std::io::Result<Child> {
    println!(
        "[papercusp-desktop] spawning serve --ensure (port hint {}) from {}",
        port_hint,
        sidecar_dir.display()
    );

    let server_js = sidecar_dir.join("serve.mjs");
    let spa_dist = sidecar_dir.join("spa");
    let docs_root = sidecar_dir.join("internal-docs");
    let harness_dir = sidecar_dir.join("harness");
    // First-party app-templates bundled at sidecar/templates (build-desktop-sidecar.sh);
    // template-store.ts resolves them via PAPERCUSP_TEMPLATES_DIR (dev falls back to the
    // in-repo templates/ dir). local-first-party-template-bundling-2026-07-07.
    let templates_dir = sidecar_dir.join("templates");
    // First-party rubrics bundled at sidecar/rubrics — same design, for the rubric
    // store's bundled layer (dev falls back to the in-repo rubrics/ dir).
    // local-first-party-rubric-bundling-2026-07-07.
    let rubrics_dir = sidecar_dir.join("rubrics");
    let prompts_dir = sidecar_dir.join("prompts");
    let db_sql_dir = sidecar_dir.join("db-sql");
    // Installer-bundled hive seed (plan hive-seed-bundle-2026-07-04). Optional:
    // only carries a manifest.json when a release cut a real seed into
    // src-tauri/seed/ (tauri.conf bundles `seed/**/*`; a dev build ships only the
    // placeholder README). restore-hive-seed's resolveSeedDir manifest-checks it,
    // so pointing at a manifest-less dir is safe → unchanged cold join. The TS
    // side ALSO autodetects this dir from a sibling resource env, so this explicit
    // pass is belt-and-suspenders, not the sole channel.
    //
    // The seed is a SIBLING of the sidecar dir, not inside it: tauri.conf bundles
    // `seed/**` and `sidecar/**` as sibling resources, so both the packaged
    // layouts (Linux .deb `usr/lib/<Product>/seed`, macOS `Contents/Resources/
    // seed`) AND the dev layout (`src-tauri/seed` next to `src-tauri/sidecar`)
    // hold it at `<parent-of-sidecar>/seed`. The previous `sidecar_dir.join(
    // "seed")` pointed INSIDE the sidecar where nothing is bundled, and
    // resolveSeedDir dead-ended on it → every packaged install silently
    // cold-joined (full network re-clone) with its multi-GB seed unused (first
    // seeded Linux .deb E2E, WI-2902 2026-07-05).
    let seed_dir = sidecar_dir
        .parent()
        .map(|p| p.join("seed"))
        .unwrap_or_else(|| sidecar_dir.join("seed"));
    // Pre-migrated PGDATA seed (first-boot fast path). Optional: only present when
    // the bundle was built with PAPERCUSP_BUILD_PG_SEED=1 (the default). serve/
    // embedded-postgres-server existsSync-checks it and falls back to initdb +
    // full migration replay when absent, so pointing at a missing path is safe.
    let db_seed_path = sidecar_dir.join("db-seed.tar.gz");
    // PG data CANNOT live on DrvFs (/mnt/c) when the sidecar runs in WSL:
    // postmaster hard-requires a 0700/0750 data dir and DrvFs without the
    // metadata mount option can't hold one (found live 2026-06-11:
    // `FATAL: data directory ... has invalid permission`). Fsync-heavy PG
    // I/O over 9P would also crawl. Route it to the distro's ext4 under the
    // baked default user instead — forwarded WITHOUT /p translation (it is
    // already a Linux path). Consequence (documented in SHIPPING.md):
    // unregistering the distro deletes the database.
    let pg_data_dir: std::path::PathBuf = if via_wsl {
        std::path::PathBuf::from("/home/papercup/.papercusp/embedded-pg-data")
    } else {
        shared_state_dir.join("embedded-pg-data")
    };
    // WI-3308: writable extract target for the bundled dev/local runnable source
    // tree (sidecar/source.tar.zst — the "all-5-buttons" dogfood bundle). Distro-
    // local on WSL for the SAME reason as PGDATA above (node_modules native bins +
    // .bin symlinks can't live faithfully on DrvFs /mnt/c); shared across
    // workspaces on native (it's code, not per-workspace data). serve extracts the
    // archive here on first boot then sets PAPERCUSP_DEV_SOURCE_ROOT, which the
    // env-operator launcher's defaultDetectSourceRoot prefers.
    let dev_source_dir: std::path::PathBuf = if via_wsl {
        std::path::PathBuf::from("/home/papercup/.papercusp/dev-source")
    } else {
        shared_state_dir.join("dev-source")
    };

    // Per-workspace isolation: override HOME so serve (and any child process
    // it spawns — claude CLI, git, pi, etc.) sees a workspace-scoped home.
    // ~/.papercusp/ (operator.json, embedded-pg.json, endpoint-ipc.json,
    // superuser-token) all resolve into <workspace_home>/. See workspaces.rs.
    let workspace_home_str = workspace_home.to_string_lossy().to_string();
    let new_path = bundled_path_env(sidecar_dir);

    let preload = sidecar_dir.join("sidecar-preload.js");
    let mut cmd = make_sidecar_command(via_wsl, sidecar_dir, &preload, &server_js);
    cmd.arg("--ensure");
    // When routed via WSL, env vars must be listed in WSLENV to cross the
    // Windows→Linux boundary. The `/p` flag translates Windows paths.
    //
    // PATH is deliberately NOT forwarded: `PATH/l` used to be first in this
    // list, and the translated Windows PATH *replaced* the distro PATH inside
    // serve — /usr/bin et al vanished, so every distro-binary spawn from the
    // operator (kopia, locale, git) died ENOENT while the same binaries
    // worked from a fresh `wsl --exec` session (found live 2026-06-11,
    // P-010a). The bundled sidecar bin dir crosses as its own
    // PAPERCUSP_SIDECAR_BIN/p instead; serve prepends it to the DISTRO PATH
    // (see serve.ts main()). Bare `node` in make_sidecar_command still
    // resolves — the rootfs bakes node into /usr/local for exactly that
    // no-shell lookup (P-004).
    if via_wsl {
        cmd.env("WSLENV", SIDECAR_WSLENV);
        // WI-3395: the sidecar runs INSIDE WSL2 (process.platform==='linux'),
        // where defaultSocketPath() would otherwise create a UNIX socket the
        // Windows-native webview host can't open (and can't create a `\\.\pipe\`
        // named pipe either) → endpoint-IPC silently disabled → `/api` falls
        // back to the capped WebView2 HTTP stack (fact
        // `windows-ipc-bypass-off-wsl2`). Tell the sidecar to bind a loopback
        // TCP port instead (`tcp://127.0.0.1:0`; the resolved port is reported
        // in endpoint-ipc.json), which WSL2 forwards from 127.0.0.1 to the host
        // — the same path the operator HTTP port rides. It can't be
        // self-detected from inside WSL2, so the launcher must set it.
        //
        // The two IPC vars are ALSO added to WSLENV above: `PAPERCUSP_IPC_ENABLE`
        // (set unconditionally below) previously did NOT cross the WSL boundary,
        // so under the packaged `NODE_ENV=production` the enable gate
        // (host-bootstrap.ts) was false inside WSL2 and the IPC server never
        // even STARTED on Windows — the deeper reason the bypass was off.
        cmd.env("PAPERCUSP_IPC_TCP", "1");
    }
    cmd.env("PATH", &new_path)
        // The bundled bin dir, as its own var: on the WSL route it crosses
        // via WSLENV /p and serve prepends it to the distro PATH; on native
        // platforms the PATH above already carries it (harmless duplicate).
        .env(
            "PAPERCUSP_SIDECAR_BIN",
            sidecar_dir.join("bin").to_string_lossy().to_string(),
        )
        // serve reads PAPERCUSP_HONO_PORT (cold-start hint; reuse may differ).
        .env("PAPERCUSP_HONO_PORT", port_hint.to_string())
        .env("PAPERCUSP_BIND_HOST", "127.0.0.1")
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        // Build provenance: baked at compile time via option_env! when the
        // build exports PAPERCUSP_BUILD_SHA (e.g. bin/mac-vm-build.sh), then
        // forwarded so the operator's /api/health self-reports the git sha it
        // was built from (build-info.ts). Empty string when unset → build-info
        // falls back to git rev-parse (null in a packaged, .git-less app). This
        // makes "what commit is this build?" answerable on any shipped build.
        .env(
            "PAPERCUSP_BUILD_SHA",
            option_env!("PAPERCUSP_BUILD_SHA").unwrap_or(""),
        )
        // Same provenance mechanism, for the shipped app VERSION (WI-2644): the
        // bundled sidecar has no npm_package_version in its env (serve.mjs isn't
        // invoked by npm), so build-info.ts silently fell back to '0.0.0' on every
        // real desktop build. release-local.sh / build-windows-on-vm.sh export
        // PAPERCUSP_BUILD_VERSION (from tauri.conf.json's version) before
        // cargo build/tauri build; empty string when unset → build-info falls back
        // to npm_package_version, then '0.0.0'.
        .env(
            "PAPERCUSP_BUILD_VERSION",
            option_env!("PAPERCUSP_BUILD_VERSION").unwrap_or(""),
        )
        // AUTO-UPDATE: where the shipped app looks for releases (WI-4389,
        // plan desktop-release-hosting-r2-2026-07-12 D-001..D-003).
        //
        // Releases are LOCAL-only [owner:Avi 2026-07-08] — never published to
        // GitHub — so the operator's /api/updates/manifest has nothing to
        // discover unless it is pointed at the static release host. Without
        // this, an installed app polls, gets a 204, and the Tauri updater reads
        // that as "you are up to date" — FOREVER, silently. Baking it into the
        // shipped env is what makes auto-update work at all on a real install
        // (the WI-3875 gap: "real Linux installs need this baked into the
        // shipping operator env").
        //
        // ⚠ This value is PERMANENT (D-003). An installed app polls
        // <host>/latest.json at this baked address forever; changing it strands
        // every existing install on a URL that no longer answers — and it fails
        // SILENTLY, because a failed check is indistinguishable from "no update"
        // to the updater. Only the MANIFEST location is pinned here: the artifact
        // URLs live inside latest.json and can move per release.
        //
        // A runtime env var still wins, so a test build can be pointed at a
        // staging host without a recompile; otherwise the compile-time bake
        // (release-local.sh exports it; build.rs has the matching
        // rerun-if-env-changed so cargo can't freeze a stale value) applies.
        .env("PAPERCUSP_RELEASE_HOST", baked_release_host())
        // The desktop webview consumes the SPA — keep the UI mounted (serve
        // alone defaults it OFF for headless use; Decision E).
        .env("PAPERCUSP_SERVE_UI", "1")
        .env(
            "PAPERCUSP_HARNESS_DIR",
            harness_dir.to_string_lossy().to_string(),
        )
        .env(
            "PAPERCUSP_TEMPLATES_DIR",
            templates_dir.to_string_lossy().to_string(),
        )
        .env(
            "PAPERCUSP_RUBRICS_DIR",
            rubrics_dir.to_string_lossy().to_string(),
        )
        .env("PAPERCUSP_DESKTOP", "1")
        // Autonomous loop (packaged-build fix): the DBOS routines engine +
        // orchestrator must be ON in the shipped sidecar — without these the
        // operator boots normally but schedules NO work (the loop is silently
        // off; only the dev `.env.local` set them). Placement is still gated to
        // STARTED hives, so a fresh install with no started hive runs the loop
        // but places nothing.
        .env("PAPERCUSP_DBOS_ENABLE", "1")
        .env("PAPERCUSP_DBOS_ROUTINES", "1")
        .env("PAPERCUSP_DBOS_ORCHESTRATOR", "1")
        // Env-switcher provisioning (packaged-build fix, WI-3284 — same
        // silently-off class as the DBOS trio above): the install-time
        // env-operator launcher (host-bootstrap.ts, P-017/D-006) is gated on
        // this + PAPERCUSP_DESKTOP=1, and NOTHING ever exported it — so no
        // shipped build provisioned the dev/prod/staging env operators and
        // the EnvSwitcherBar rendered every env permanently greyed
        // (owner-reported on the mac build 2026-07-06; owner directive: the
        // envs SHOULD all run on user builds). The launcher is idempotent +
        // graceful (skips already-served ports / missing source tree or
        // toolchain) and every spawned sibling is request-only (EI-126
        // single-writer), so arming it on every desktop sidecar spawn is safe.
        .env("PAPERCUSP_PROVISION_ENV_OPERATORS", "1")
        // Phase E (P-051): shared-operator model — per-spawn HOME comes from
        // each job's workspace, set operator-side.
        .env("PAPERCUSP_SHARED_OPERATOR", "1")
        // Descendants that need the operator's HTTP API (run.sh pg-status
        // helpers etc.) use this; the port is dynamic so env is the channel.
        .env(
            "PAPERCUSP_OPERATOR_BASE",
            format!("http://localhost:{}", port_hint),
        )
        // Hono host serves the Vite SPA + Starlight docs from these roots —
        // passed explicitly because a bundled file's __dirname is the sidecar
        // root (see host-spa.ts / host-docs.ts root-resolution comments).
        .env("PAPERCUSP_SPA_DIST", spa_dist.to_string_lossy().to_string())
        .env(
            "PAPERCUSP_DOCS_ROOT",
            docs_root.to_string_lossy().to_string(),
        )
        // Persona/tools prompt root — explicit because the cwd heuristics in
        // prompt-assembly.ts misfire in the sidecar layout: sidecar/apps/
        // operator/prompts exists (desktop-install playbook only) and would
        // shadow the full sidecar/prompts copy (see promptsDir()).
        .env(
            "PAPERCUSP_PROMPTS_DIR",
            prompts_dir.to_string_lossy().to_string(),
        )
        // PG knobs (SP1 C5: PG ownership moved into serve). The port is
        // freshly picked per spawn so two desktops on one host don't collide;
        // data lives in the SHARED state dir (one RLS-scoped PG for all
        // workspaces, D-006), migrations ship at sidecar/db-sql.
        .env("PAPERCUSP_PG_PORT", pg_port_hint.to_string())
        .env(
            "PAPERCUSP_PG_DATA_DIR",
            pg_data_dir.to_string_lossy().to_string(),
        )
        .env(
            "PAPERCUSP_PG_SQL_DIR",
            db_sql_dir.to_string_lossy().to_string(),
        )
        // Installer-bundled hive seed dir (first-boot seed-then-delta-join fast
        // path). Safe to set when only the placeholder is present — the operator
        // manifest-checks it (resolveSeedDir) and cold-joins if there's no seed.
        .env("PAPERCUSP_SEED_DIR", seed_dir.to_string_lossy().to_string())
        // Pre-migrated seed archive (first-boot fast path). Safe to set even when
        // the file is absent — serve existsSync-checks it and falls back to initdb.
        .env(
            "PAPERCUSP_PG_SEED_PATH",
            db_seed_path.to_string_lossy().to_string(),
        )
        // WI-3308: the bundled dev/local runnable source tree + its writable
        // extract target. Safe to set unconditionally (like PG_SEED_PATH above) —
        // serve's extractDevSourceTree existsSync-checks the archive and no-ops
        // when a build shipped without PAPERCUSP_STAGE_SOURCE=1 (no source.tar.zst),
        // so dev/local stay skipped 'no-source-tree' exactly as before.
        .env(
            "PAPERCUSP_SOURCE_ARCHIVE",
            sidecar_dir
                .join("source.tar.zst")
                .to_string_lossy()
                .to_string(),
        )
        .env(
            "PAPERCUSP_DEV_SOURCE_DIR",
            dev_source_dir.to_string_lossy().to_string(),
        )
        .env(
            "PAPERCUSP_IDENTITY_DIR",
            shared_state_dir
                .join(".papercusp")
                .join("identity")
                .to_string_lossy()
                .to_string(),
        )
        .env(
            "PAPERCUSP_ANNOUNCE_IDENTITY_CACHE",
            shared_state_dir
                .join(".papercusp")
                .join("local-announce-identity.json")
                .to_string_lossy()
                .to_string(),
        )
        // The workspace registry lives ABOVE the per-workspace isolation
        // boundary; HOME below is remapped, so pass the real root explicitly
        // (workspace-registry.ts would otherwise resolve a nested registry).
        .env(
            "PAPERCUSP_WORKSPACES_ROOT",
            workspaces::workspaces_root().to_string_lossy().to_string(),
        )
        .env("HOME", &workspace_home_str)
        .env("USERPROFILE", &workspace_home_str); // Windows

    // PAPERCUSP_USE_EMBEDDED_PG passthrough: default ON (serve's default).
    // =0 attaches external PG via HARNESS_*_DATABASE_URL from our env, which
    // Command inherits by default.
    if let Ok(v) = std::env::var("PAPERCUSP_USE_EMBEDDED_PG") {
        cmd.env("PAPERCUSP_USE_EMBEDDED_PG", v);
    }

    // Endpoint IPC opt-in (default ON — it dodges WebKitGTK's ~6-connection
    // libsoup cap for the webview's SSE/fetch traffic). runBootstrap inside
    // serve starts the IPC server and writes endpoint-ipc.json; we read the
    // file rather than parse stdout, so stdout can stay inherited.
    let ipc_enabled = std::env::var("PAPERCUSP_DESKTOP_IPC").ok().as_deref() != Some("0");
    if ipc_enabled {
        cmd.env("PAPERCUSP_IPC_ENABLE", "1");
    }
    // Dev build: keep the inherited console (the `tauri dev` terminal). Release
    // (packaged) build: no console exists, so an inherited stdout/stderr is
    // /dev/null and every serve diagnostic is lost — tee to a rotated on-disk log
    // instead (WI-1707). If the log can't be prepared, fall back to inherit so
    // logging setup never blocks the sidecar from launching.
    if cfg!(debug_assertions) {
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else if let Some((out, err)) = rotating_log_stdio(workspace_home, "serve.log") {
        cmd.stdout(out).stderr(err);
    } else {
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    }

    cmd.spawn()
}

/// Spawn the background thread that supervises + respawns a `serve.mjs`
/// child we OWN, with a debounced-unreachable check + crash-loop cap.
///
/// WI-1878: this used to live inline in the Server-role boot path only —
/// which meant the Linux single-bundle self-host path (`spawn_self_hosted_sidecar`,
/// used by `npm run dev` / a plain `apt install` with no separate "Papercusp
/// Server" bundle running) span up `serve.mjs` with NO supervision at all: a
/// SIGTERM'd or crashed operator child stayed dead until the user manually
/// quit + reopened the whole app. Extracted so BOTH sidecar-owning boot paths
/// (Server role, and the Linux GUI self-host) get the same respawn-with-backoff
/// behavior — see decide_serve_respawn's doc for the state machine itself.
///
/// WI-2667 (defect-2 gap fix): supervise our OWN serve.mjs child. The
/// GUI-side watcher's `open -b` CANNOT revive an operator that died
/// while this Server shell is still alive (single-instance dedupes the
/// launch → no-op), and nothing else reaps/restarts it — proved live on
/// the Mac VM 2026-07-04 (SIGTERM the operator → 100s, zero recovery, an
/// unreaped zombie). So the Server watches its child: `try_wait` REAPS
/// the zombie AND detects the exit, and we respawn serve in-process
/// (covers the headless-Server-no-GUI case too). Guards: `shutdown_done`
/// (normal quit / self-update — don't fight the teardown), an
/// operator-reachability check (don't double-spawn when `--ensure`
/// reused a foreign operator, Decision C), and a crash-loop cap.
fn spawn_serve_supervisor(
    app_handle: tauri::AppHandle,
    via_wsl: bool,
    port: u16,
    sidecar_dir: std::path::PathBuf,
    pg_port_hint: u16,
    shared_state_dir: std::path::PathBuf,
    workspace_home: std::path::PathBuf,
) {
    const RESPAWN_WINDOW: Duration = Duration::from_secs(300);
    const MAX_RESPAWNS_PER_WINDOW: usize = 5;
    // WI-3170: how long the operator must be CONTINUOUSLY unreachable
    // (while our serve `Child` still looks alive — on Windows the Child
    // is the wsl.exe WRAPPER, which outlives a dead inner node) before
    // we respawn it. Only armed AFTER the operator has come up once this
    // session (see `ever_reachable`), so a slow cold boot (serve.mjs
    // alive, initdb + migration replay not yet serving) never trips it
    // and double-spawns a competing serve.
    const SERVE_UNREACHABLE_DEBOUNCE: Duration = Duration::from_secs(15);
    let sup_handle = app_handle;
    let sup_via_wsl = via_wsl;
    let sup_port = port;
    let sup_pg_hint = pg_port_hint;
    let sup_sidecar = sidecar_dir;
    let sup_shared = shared_state_dir;
    let sup_home = workspace_home;
    std::thread::spawn(move || {
        let mut respawn_times: Vec<Instant> = Vec::new();
        // WI-3170: start of the current continuous-unreachable streak
        // (None while reachable), and whether the operator has EVER been
        // reachable this session — the latter arms the child-alive
        // respawn path only post-boot so a slow cold boot can't trip it.
        let mut unreachable_since: Option<Instant> = None;
        let mut ever_reachable = false;
        // WI-3270 transition latches: the Windows→WSL forward reading
        // degraded (operator healthy INSIDE the distro, unreachable from
        // outside) and the give-up notification (once per dead episode).
        let mut forward_degraded = false;
        let mut gave_up_notified = false;
        // WI-3360: whether we've already `wsl --terminate`d a WEDGED distro this
        // outage — one reset per dead episode (cleared when the operator
        // recovers) so we never terminate-loop a distro that stays down for a
        // reason a reset can't fix.
        #[cfg(target_os = "windows")]
        let mut distro_reset_done = false;
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            // WI-3270 (c): refresh the shell-liveness beacon so the
            // bundle watcher can tell "shell alive, operator dead —
            // defer" from "shell gone — relaunch the bundle".
            write_server_shell_heartbeat(&sup_home);
            let state: tauri::State<SidecarState> = sup_handle.state();
            let shutting_down = state
                .shutdown_done
                .load(std::sync::atomic::Ordering::SeqCst);
            // Detect + REAP an exited serve child (drops the lock before
            // the reachability probe, which also locks state.child).
            let child_exited = {
                let mut guard = state.child.lock().unwrap();
                match guard.as_mut() {
                    Some(c) => matches!(c.try_wait(), Ok(Some(_))),
                    // No child we own → treat as exited; the
                    // reachability guard below still gates the respawn.
                    None => true,
                }
            };
            let outer_reachable = wait_for_operator(
                &sup_handle,
                &sup_home,
                sup_via_wsl,
                Duration::from_millis(600),
            )
            .is_ok();
            // WI-3270 (a): on Windows the probe above crosses the
            // Windows→WSL localhost forward, which flakes independently
            // of operator health. Killing a healthy serve+PG over a
            // forward flake is the WI-3270 false alarm (it exhausted
            // both respawn caps and took the whole distro down), so
            // before treating "unreachable from outside" as death,
            // re-ask from INSIDE the distro: inner-healthy means the
            // FORWARD is degraded, not the operator.
            let inner_reachable = if !outer_reachable && sup_via_wsl {
                find_operator_discovery(&sup_home, sup_via_wsl)
                    .map(|d| operator_http_ready_in_distro(d.port))
                    .unwrap_or(false)
            } else {
                false
            };
            let operator_reachable = outer_reachable || inner_reachable;
            // Transition-only forward-degraded logging (WI-3270 (d)).
            if inner_reachable {
                if !forward_degraded {
                    eprintln!(
                        "[papercusp-desktop] operator HEALTHY inside the distro but \
                         unreachable from Windows — localhost forward degraded, NOT a \
                         dead operator; suppressing respawn until the forward recovers \
                         (WI-3270)"
                    );
                    forward_degraded = true;
                }
            } else if forward_degraded {
                if outer_reachable {
                    eprintln!(
                        "[papercusp-desktop] Windows→WSL localhost forward recovered \
                         (WI-3270)"
                    );
                } else {
                    eprintln!(
                        "[papercusp-desktop] operator no longer answers inside the \
                         distro either — treating as a real operator death, not a \
                         forward flake (WI-3270)"
                    );
                }
                forward_degraded = false;
            }
            let now = Instant::now();
            respawn_times.retain(|t| now.duration_since(*t) < RESPAWN_WINDOW);
            // WI-3170: track the continuous-unreachable streak. The
            // child-alive-but-unreachable respawn path (the Windows/WSL
            // wrapper blind spot) only arms once the operator has served
            // at least once this session, so a slow cold first boot can
            // never double-spawn a competing serve.
            if operator_reachable {
                unreachable_since = None;
                ever_reachable = true;
                gave_up_notified = false;
                // WI-3360: recovery = a fresh outage budget; a FUTURE wedge
                // earns another one-shot `wsl --terminate`.
                #[cfg(target_os = "windows")]
                {
                    distro_reset_done = false;
                }
            } else if unreachable_since.is_none() {
                unreachable_since = Some(now);
                // WI-3270 (d): say WHY the operator reads unreachable,
                // once per streak — a missing discovery, a dead pid, and
                // a hung HTTP probe are different failures, and the VM
                // forensics burned hours re-deriving which one it was.
                match find_operator_discovery(&sup_home, sup_via_wsl) {
                    None => eprintln!(
                        "[papercusp-desktop] operator unreachable: no operator.json \
                         discovery readable (WI-3270)"
                    ),
                    Some(d) => {
                        let pid_alive = discovery_pid_alive(d.pid, sup_via_wsl);
                        eprintln!(
                            "[papercusp-desktop] operator unreachable: discovery pid {} \
                             on :{} — pid_alive={}, HTTP probe failed (WI-3270)",
                            d.pid, d.port, pid_alive
                        );
                    }
                }
            }
            // Gate to the WSL routing (Windows): that is the ONLY place
            // the stored `Child` is a WRAPPER (wsl.exe) that can outlive
            // the inner operator, making child_exited unreliable. On
            // Linux/mac the child IS the operator process, so child_exited
            // is ground truth and we keep the exact existing behavior —
            // this path never arms there (WI-3170, surgical scope).
            let unreachable_respawn_ready = serve_unreachable_respawn_ready(
                sup_via_wsl,
                ever_reachable,
                unreachable_since.map(|t| now.duration_since(t)),
                SERVE_UNREACHABLE_DEBOUNCE,
            );
            match decide_serve_respawn(
                child_exited,
                shutting_down,
                operator_reachable,
                unreachable_respawn_ready,
                respawn_times.len(),
                MAX_RESPAWNS_PER_WINDOW,
            ) {
                ServeRespawnAction::Healthy => {}
                ServeRespawnAction::Suppressed => return,
                ServeRespawnAction::GiveUp => {
                    // WI-3270 (b): do NOT exit the supervisor thread —
                    // a cap hit is a backoff, not a terminal state (the
                    // old `return` here is why the VM outage needed a
                    // manual app restart). respawn_times drains on the
                    // window, after which decide_serve_respawn resumes
                    // Respawn — a slow retry tier; on Windows the
                    // respawn re-boots a dead distro, so this heals the
                    // whole observed outage class.
                    if !gave_up_notified {
                        eprintln!(
                            "[papercusp-desktop] serve.mjs respawn cap hit ({} in {}s) — \
                             backing off; will retry once the respawn window drains \
                             (WI-2667 / WI-3270)",
                            MAX_RESPAWNS_PER_WINDOW,
                            RESPAWN_WINDOW.as_secs()
                        );
                        notify_operator_dead(
                            &sup_handle,
                            "serve.mjs in-process respawn cap hit",
                            MAX_RESPAWNS_PER_WINDOW,
                            RESPAWN_WINDOW.as_secs(),
                        );
                        gave_up_notified = true;
                    }
                    // WI-3360: a cap hit on Windows can mean the WSL distro's
                    // exec layer is WEDGED — the respawn storm drove the WSL2
                    // interop into a state where every `wsl.exe --exec` returns
                    // a dead child, so re-spawning serve into it can NEVER
                    // recover (the operator stays down until a MANUAL
                    // `wsl --terminate`, which no end user will know to run —
                    // the exact VM brick observed 2026-07-08). If a trivial
                    // exec confirms the wedge, terminate the distro (it
                    // cold-boots on the next exec, no data loss) and clear the
                    // respawn window so the VERY NEXT tick respawns serve into a
                    // FRESH distro. One-shot per outage (distro_reset_done).
                    #[cfg(target_os = "windows")]
                    if sup_via_wsl && !distro_reset_done {
                        if distro_exec_wedged(Duration::from_secs(6)) {
                            eprintln!(
                                "[papercusp-desktop] WSL distro exec WEDGED after respawn cap — \
                                 `wsl --terminate {}` to reset it, then respawning serve into the \
                                 fresh distro (WI-3360)",
                                wsl_setup::DISTRO_NAME_PUB
                            );
                            if terminate_distro() {
                                respawn_times.clear();
                                unreachable_since = None;
                                gave_up_notified = false;
                                distro_reset_done = true;
                            } else {
                                eprintln!(
                                    "[papercusp-desktop] `wsl --terminate` failed — will retry \
                                     next cap window (WI-3360)"
                                );
                            }
                        } else {
                            // Distro exec is fine; the crash has some other
                            // cause. Don't terminate a healthy distro (that
                            // would needlessly kill a working PG); mark done so
                            // we don't re-probe every tick this outage.
                            distro_reset_done = true;
                        }
                    }
                }
                ServeRespawnAction::Respawn => {
                    eprintln!(
                        "[papercusp-desktop] operator unreachable and not recovering \
                         (serve child_exited={child_exited}) — respawning serve.mjs \
                         in-process (WI-2667 / WI-3170 Windows wrapper blind spot)"
                    );
                    match spawn_serve(
                        sup_via_wsl,
                        sup_port,
                        &sup_sidecar,
                        sup_pg_hint,
                        &sup_shared,
                        &sup_home,
                    ) {
                        Ok(c) => {
                            *state.child.lock().unwrap() = Some(c);
                            respawn_times.push(now);
                            // Restart the unreachable streak so the fresh
                            // child gets a full debounce to come up before
                            // we would respawn again (WI-3170).
                            unreachable_since = None;
                        }
                        Err(e) => {
                            eprintln!("[papercusp-desktop] serve.mjs respawn failed: {e}");
                        }
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Workspace tauri commands
//
// Exposed to the operator UI via `invoke('plugin:...')` — see
// apps/operator/lib/workspaces-tauri.ts for the typed wrapper. Switching
// kills the running sidecar + embedded-postgres-server and restarts the entire app, which
// is the cleanest way to swap a fake-HOME under a process tree mid-flight.
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(serde::Serialize, specta::Type)]
struct UpdateInfo {
    available: bool,
    current_version: String,
    new_version: Option<String>,
    notes: Option<String>,
    /// The update check could not actually be performed — the release host was
    /// unreachable, throttled, or never configured. DISTINCT from `available:
    /// false`, which means "checked, and you are current".
    ///
    /// The Tauri updater protocol has no slot for this: a 204 means "no update",
    /// and the plugin hands back `Ok(None)` whether we compared versions or
    /// never got an answer at all. So an unreachable host reads to the user as
    /// "you are up to date" — silently, forever, and indistinguishable from
    /// success. That is the worst failure mode an updater can have, and it is
    /// exactly how a 0.0.8 with no release host baked in would present: eternally
    /// current, never updating, saying nothing.
    check_failed: bool,
    /// Why the check could not be performed (`no_token` / `fetch_failed` /
    /// `no_candidate` / `manifest_unconfigured`), when the sidecar reports one.
    check_reason: Option<String>,
}

/// Ask the sidecar whether its 204 meant "up to date" or "could not check".
///
/// The sidecar has known the difference since WI-3697 and says so in
/// `X-Update-Check: up_to_date | cannot_check` (+ `X-Update-Reason`) — but the
/// updater plugin parses no headers on a 204, so nothing had ever read them and
/// the distinction died at the wire. Re-ask the same loopback endpoint and read
/// them, so a failed check can be surfaced AS a failed check.
///
/// Loopback + only on the no-update path, so the extra request is cheap. Any
/// failure to probe leaves the verdict unchanged rather than inventing one.
async fn probe_update_check_status(endpoint: String) -> Option<(String, Option<String>)> {
    tokio::task::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .ok()?;
        let res = client.get(&endpoint).send().ok()?;
        let check = res.headers().get("x-update-check")?.to_str().ok()?.to_string();
        let reason = res
            .headers()
            .get("x-update-reason")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        Some((check, reason))
    })
    .await
    .ok()
    .flatten()
}

/// Is the running bundle the "Papercusp Server" product (vs "Papercusp GUI")?
/// Resolved from the bundle's `productName` — the same signal the release
/// pipeline uses to name Server-vs-GUI artifacts (WI-3696), so it stays in
/// lockstep with what `resolve_update_endpoint`/`resolve_rollback_endpoint`
/// actually request from the manifest route. (Deliberately NOT
/// `app_role::detect`, which keys off the bundle *identifier* for a related
/// but distinct purpose — who owns/spawns the sidecar.) WI-4404: this used to
/// be duplicated inline at both call sites; centralized so a future product-
/// name convention change only needs one edit.
fn is_server_product(app: &AppHandle) -> bool {
    app.config()
        .product_name
        .as_deref()
        .map(|n| n.to_ascii_lowercase().contains("server"))
        .unwrap_or(false)
}

/// Build the per-call updater endpoint targeted at the operator sidecar.
///
/// We don't hardcode a single static URL in `tauri.conf.json` because:
///   1. The operator picks a free port at boot — known only at runtime.
///   2. We want the operator's PG-backed `setup_wizard_state.update_channel`
///      to drive which channel's release is served, without baking the
///      channel into compile-time config.
///
/// (P-052) `tauri.conf.json` therefore ships NO static `endpoints` entry:
/// the old baked URL (`https://127.0.0.1:3055/...`) could never work — TLS
/// against a plain-HTTP port the packaged sidecar doesn't even use — so
/// every plugin-driven background check failed. The conf keeps
/// `dangerousInsecureTransportProtocol: true` so the loopback-http URL built
/// here passes the updater's release-build https validation (loopback-only,
/// no transport exposure).
///
/// The operator route at `/api/updates/manifest` handles channel
/// resolution: query-param wins, then stored preference, then 'stable'.
/// Tauri substitutes `{{target}}`, `{{arch}}`, and `{{current_version}}`
/// when it issues the GET.
fn resolve_update_endpoint(app: &AppHandle) -> Result<String, String> {
    let port: u16 = if cfg!(debug_assertions) {
        // Dev: no sidecar process to read a port from — follow the operator
        // the desktop currently targets (devUrl is :3070; the dev wrapper's
        // build switcher retargets SELECTED_API_PORT per selected build,
        // EI-190). The old hardcoded 3055 pointed at Vite, which doesn't
        // serve /api/updates/manifest at all (P-052).
        SELECTED_API_PORT.load(std::sync::atomic::Ordering::Relaxed)
    } else {
        let state: tauri::State<SidecarState> = app.state();
        let guard = state.port.lock().map_err(|e| e.to_string())?;
        guard.ok_or_else(|| {
            "sidecar port not yet known; try again after boot completes".to_string()
        })?
    };
    // GUI and Server are two products built from this same codebase
    // (tauri.server.conf.json overlays productName) — release assets are
    // product-named, so the manifest route scopes asset matching by this
    // param (desktop-auto-update-operational-2026-07-09 P-003). Without
    // it the route could hand the GUI a Server installer or vice versa.
    let product = if is_server_product(app) {
        "server"
    } else {
        "gui"
    };
    Ok(format!(
        "http://127.0.0.1:{}/api/updates/manifest?target={{{{target}}}}&arch={{{{arch}}}}&current_version={{{{current_version}}}}&product={}",
        port, product
    ))
}

#[tauri::command]
#[specta::specta]
async fn check_for_update(app: AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;
    let endpoint = resolve_update_endpoint(&app)?;
    let url = url::Url::parse(&endpoint).map_err(|e| e.to_string())?;
    let current = env!("CARGO_PKG_VERSION").to_string();
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            current_version: current,
            new_version: Some(update.version.clone()),
            notes: update.body.clone(),
            check_failed: false,
            check_reason: None,
        }),
        // `Ok(None)` is the ambiguous one: a 204 that may mean "you are current"
        // OR "we never reached the release host". Ask the sidecar which it was
        // instead of assuming the happy one.
        Ok(None) => {
            let (check_failed, check_reason) = match probe_update_check_status(endpoint).await {
                Some((check, reason)) if check == "cannot_check" => (true, reason),
                _ => (false, None),
            };
            Ok(UpdateInfo {
                available: false,
                current_version: current,
                new_version: None,
                notes: None,
                check_failed,
                check_reason,
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
#[specta::specta]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    // Linux: the plugin's only install path is an AppImage self-swap. On a
    // .deb install (no APPIMAGE env) the swap fails mid-flight with an opaque
    // rename/permission error — fail EARLY with the sentinel the UpdateChip
    // fallback matches (it opens the releases page instead).
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() {
        return Err(
            "no_compatible_assets: this Linux install is not an AppImage — auto-swap unavailable"
                .to_string(),
        );
    }
    let endpoint = resolve_update_endpoint(&app)?;
    let url = url::Url::parse(&endpoint).map_err(|e| e.to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;

    // EI-9002 (P-007 linux E2E, 2026-07-10): the update bytes stream through
    // the sidecar's OWN /api/updates proxy — the download URL captured by
    // `updater.check()` points at it. Killing the sidecar BEFORE the download
    // destroys that endpoint mid-fetch (host log: GET 200 → ConnectionResetError),
    // the update silently no-ops, and the old version keeps running. So tear the
    // sidecar down in `on_download_finish` — AFTER the payload is fully on hand,
    // BEFORE the binary swap (children must not outlive the parent across the
    // swap). WI-2667 still holds: flag `shutdown_done` FIRST so the Server-side
    // serve supervisor does NOT respawn the operator we're about to swap out
    // from under (the app restarts immediately after the install).
    let teardown_app = app.clone();
    update
        .download_and_install(
            |_chunk, _total| {},
            move || {
                {
                    let state: tauri::State<SidecarState> = teardown_app.state();
                    state
                        .shutdown_done
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                }
                kill_sidecar(&teardown_app);
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // tauri-plugin-process is in scope so we can restart cleanly.
    app.restart();
}

/// WI-4404: the Server product has NO webview, so `check_for_update` /
/// `install_update` — normally invoked only from UpdateChip.tsx / StepAutoUpdate.tsx
/// via the JS `invoke()` bridge — had NO caller at all for it. Confirmed via
/// exhaustive grep: before this, `check_for_update` was referenced only at its own
/// `#[tauri::command]` decl and in `generate_handler!`. The Server manifest gap
/// (`latest-server.json`, fixed earlier this item) was necessary but not sufficient:
/// answering a poll that never happens fixes nothing on its own.
///
/// This spawns the poll loop that makes the Server actually check. It deliberately
/// does NOT auto-install: the GUI's OWN documented design is "nothing installs on
/// its own — every install path is behind a confirm" (UpdateChip.tsx). An unattended
/// silent restart of the backend `psu` and every agent session are attached to is a
/// materially bigger footgun than a stale binary, and no plan/doc states an intent
/// to auto-restart the Server unattended — so this poller surfaces the result (tray
/// item + native notification) and leaves the actual install/restart behind the
/// tray's "Install Update" click (the Server's only available confirm gesture, since
/// it has no window to run a webview confirm dialog in). A human — or an agent
/// driving the tray via capability:terminal/OS automation — triggers the swap
/// explicitly, exactly as the GUI's confirm+click already does.
///
/// Runs only when `is_server_product` (the caller gates it further by only calling
/// this from the Server-only half of `setup()`, but the check is repeated here too
/// so this fn is safe to call unconditionally from anywhere in the future).
/// Interval + startup grace are env-overridable for tests/local iteration; errors
/// (most commonly "sidecar port not yet known" very early in boot) are logged and
/// retried next tick — this must never panic the Server's setup thread.
fn spawn_server_update_poller(app: &tauri::App) {
    let handle = app.handle().clone();
    if !is_server_product(&handle) {
        return;
    }
    handle.manage(ServerUpdateState {
        pending_version: std::sync::Mutex::new(None),
    });

    let grace_secs: u64 = std::env::var("PAPERCUSP_SERVER_UPDATE_POLL_GRACE_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5 * 60); // 5m: let boot settle before the first check.
    let interval_secs: u64 = std::env::var("PAPERCUSP_SERVER_UPDATE_POLL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(6 * 60 * 60); // 6h: matches typical desktop-app update cadence.

    tauri::async_runtime::spawn(async move {
        println!(
            "[papercusp-server] update poller starting — grace={grace_secs}s interval={interval_secs}s"
        );
        tokio::time::sleep(Duration::from_secs(grace_secs)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
        loop {
            ticker.tick().await;
            // Skip a re-poll while a version is already pending install — no point
            // re-checking until the operator either installs it or a NEWER one ships;
            // the manifest would just keep answering the same candidate.
            let already_pending = handle
                .try_state::<ServerUpdateState>()
                .and_then(|s| s.pending_version.lock().ok().map(|g| g.is_some()))
                .unwrap_or(false);
            if already_pending {
                continue;
            }
            match check_for_update(handle.clone()).await {
                Ok(info) if info.available => {
                    let version = info.new_version.clone().unwrap_or_default();
                    println!("[papercusp-server] update available: v{version}");
                    if let Some(state) = handle.try_state::<ServerUpdateState>() {
                        if let Ok(mut guard) = state.pending_version.lock() {
                            *guard = Some(version.clone());
                        }
                    }
                    if let Ok(menu) = build_server_tray_menu(&handle) {
                        if let Some(tray) = handle.tray_by_id("papercusp-server") {
                            let _ = tray.set_menu(Some(menu));
                        }
                    }
                    use tauri_plugin_notification::NotificationExt;
                    let _ = handle
                        .notification()
                        .builder()
                        .title("Papercusp Server update available")
                        .body(format!(
                            "v{version} is ready — open the tray menu to install."
                        ))
                        .show();
                }
                Ok(_) => { /* up to date — nothing to do this tick */ }
                Err(e) => {
                    eprintln!("[papercusp-server] update check failed (will retry next tick): {e}");
                }
            }
        }
    });
}

/// Build the per-call rollback endpoint for a SPECIFIC release `tag`, targeted at
/// the operator sidecar's `/api/updates/rollback` route (desktop-update-center-and-
/// release-tooling P-5 Unit A). Mirrors `resolve_update_endpoint`'s port + product
/// resolution but points at the rollback route and pins the requested `tag`. It
/// deliberately passes NO `current_version` — a rollback resolves an explicit tag,
/// not "is there something newer than me". `{{target}}` / `{{arch}}` are left as
/// updater placeholders (the plugin substitutes the running platform, exactly as it
/// does for `resolve_update_endpoint`); the literal `tag` / `product` params pass
/// through untouched. Duplicating the small port/product block (rather than sharing
/// it) keeps this new path from being able to regress `install_update`'s lifeline.
fn resolve_rollback_endpoint(app: &AppHandle, tag: &str) -> Result<String, String> {
    let port: u16 = if cfg!(debug_assertions) {
        SELECTED_API_PORT.load(std::sync::atomic::Ordering::Relaxed)
    } else {
        let state: tauri::State<SidecarState> = app.state();
        let guard = state.port.lock().map_err(|e| e.to_string())?;
        guard.ok_or_else(|| {
            "sidecar port not yet known; try again after boot completes".to_string()
        })?
    };
    let product = if is_server_product(app) {
        "server"
    } else {
        "gui"
    };
    let encoded_tag: String = url::form_urlencoded::byte_serialize(tag.as_bytes()).collect();
    Ok(format!(
        "http://127.0.0.1:{}/api/updates/rollback?tag={}&target={{{{target}}}}&arch={{{{arch}}}}&product={}",
        port, encoded_tag, product
    ))
}

/// Roll the desktop app BACK to an older, already-released `tag` — the Update
/// Center "Revert" action (desktop-update-center-and-release-tooling P-4). It is the
/// deliberate-downgrade sibling of `install_update`: the SAME download → plugin
/// minisign-verify (against the updater pubkey baked into `tauri.conf.json`) →
/// sidecar-safe teardown → atomic swap → relaunch path, but pointed at
/// `/api/updates/rollback?tag=…` and with the updater's default "remote must be
/// NEWER" gate overridden so an OLDER target is accepted (`version_comparator`).
///
/// The rollback route (P-5 Unit A) already bounds the tag to the caller's channel
/// window, so a stable user can't land on an alpha build; here we only need to tell
/// the plugin to install exactly the release the route resolved. The post-update
/// self-check (P-013, `run_update_self_check`) keys off the INSTALLED build's OWN
/// baked `PAPERCUSP_BUILD_SHA`, so after the downgrade the running operator's sha
/// matches the now-current (older) build — a rollback does not false-alarm (D-002).
#[tauri::command]
#[specta::specta]
async fn revert_to(app: AppHandle, tag: String) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let tag = tag.trim().to_string();
    if tag.is_empty() {
        return Err("revert_to: a target release tag is required".to_string());
    }
    // Same Linux constraint as install_update: only an AppImage install can
    // self-swap; on a .deb the swap fails mid-flight, so fail early with the
    // sentinel the UpdateChip fallback matches.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() {
        return Err(
            "no_compatible_assets: this Linux install is not an AppImage — auto-swap unavailable"
                .to_string(),
        );
    }
    let endpoint = resolve_rollback_endpoint(&app, &tag)?;
    let url = url::Url::parse(&endpoint).map_err(|e| e.to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        // Accept the resolved release regardless of version ordering. The default
        // comparator is `release > current`, which would refuse a downgrade; the
        // user explicitly asked to revert to THIS tag, and the route already
        // channel-gated it, so honor it.
        .version_comparator(|_current, _release| true)
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("rollback target {tag} is not installable"))?;

    // Identical sidecar-safe teardown to install_update (EI-9002 / WI-2667): the
    // update bytes stream through the sidecar's OWN /api/updates proxy, so tear the
    // sidecar down in on_download_finish — AFTER the payload is fully on hand,
    // BEFORE the binary swap — and flag `shutdown_done` FIRST so the Server-side
    // serve supervisor does NOT respawn the operator we're about to swap out.
    let teardown_app = app.clone();
    update
        .download_and_install(
            |_chunk, _total| {},
            move || {
                {
                    let state: tauri::State<SidecarState> = teardown_app.state();
                    state
                        .shutdown_done
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                }
                kill_sidecar(&teardown_app);
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // tauri-plugin-process is in scope so we can restart cleanly.
    app.restart();
}

#[tauri::command]
#[specta::specta]
fn workspaces_list() -> workspaces::Registry {
    workspaces::list()
}

#[tauri::command]
#[specta::specta]
fn workspaces_create(name: String) -> Result<workspaces::Workspace, String> {
    workspaces::create(&name).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn workspaces_rename(id: String, name: String) -> Result<(), String> {
    workspaces::rename(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn workspaces_delete(id: String) -> Result<(), String> {
    workspaces::delete(&id).map_err(|e| e.to_string())
}

/// Switch the *registry default* workspace (Phase E, P-050).
///
/// Pre-Phase-E this killed the sidecar + per-workspace PG and `app.restart()`'d
/// — the only way to swap a per-process fake-HOME. Now ONE shared sidecar
/// serves every workspace and scoping is per-request (`?ws=` / the workspace
/// header → ALS → RLS GUC), so a switch is just a per-WINDOW navigation that
/// the frontend performs (`switchWorkspace` → navigate to `/harness?ws=<id>`).
/// This command only persists `registry.current` so a fresh launch / the first
/// window defaults to it. It NO LONGER restarts — other windows are untouched
/// (P-031).
#[tauri::command]
#[specta::specta]
fn workspaces_switch(id: String) -> Result<(), String> {
    workspaces::switch(&id).map_err(|e| e.to_string())
}

/// Open an ADDITIONAL window pinned to a workspace (Phase E, P-053).
///
/// The one shared sidecar serves it; the window self-identifies via `?ws=<id>`
/// in its URL, so `getBrowserWorkspaceId()` + the header/`?ws=` stamping scope
/// every request — and the RLS `app.workspace_id` GUC — to this workspace. The
/// window is labeled `ws-<id>` so it matches the `ws-*` capability pattern that
/// grants IPC (see capabilities/default.json); re-opening focuses the existing
/// one.
#[tauri::command]
#[specta::specta]
fn workspaces_open_window(app: AppHandle, id: String) -> Result<(), String> {
    if !workspaces::workspace_dir(&id).exists() {
        return Err(format!("no workspace dir for {}", id));
    }
    let label = format!("ws-{}", id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(());
    }
    // Resolve the app origin from the MAIN window's current URL — the source of
    // truth for "where the app is served" — so this works in BOTH dev (webview
    // → external devUrl :3055/:3070; no sidecar spawned, SidecarState.port is
    // None) and release (→ the spawned sidecar's free port). Fall back to the
    // sidecar port only if the main window's URL is somehow unreadable.
    let base = app
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
        .or_else(|| {
            let state: tauri::State<SidecarState> = app.state();
            let guard = state.port.lock().ok()?;
            (*guard).map(|p| format!("http://localhost:{}", p))
        })
        .ok_or_else(|| {
            "could not resolve app origin (no main window URL, no sidecar port)".to_string()
        })?;
    let url = format!("{}/harness?ws={}", base, url_encode(&id));
    let parsed = url
        .parse()
        .map_err(|e| format!("bad window url {}: {}", url, e))?;
    let win =
        tauri::WebviewWindowBuilder::new(&app, label.clone(), tauri::WebviewUrl::External(parsed))
            .title(format!("Papercusp — {}", id))
            .inner_size(1280.0, 800.0)
            .build()
            .map_err(|e| e.to_string())?;
    // Hand the new window the sidecar base + native PTY mode, exactly like the
    // main window's setup() injection (main.rs ~1463). getBrowserWorkspaceId()
    // reads ?ws= from the URL, so the workspace is known even before this runs.
    let _ = win.eval(&format!(
        "window.__papercuspBase = '{base}'; window.__papercuspAppBase = '{base}'; window.__PAPERCUSP_TAURI__ = {{ kind: 'native' }}; window.dispatchEvent(new CustomEvent('papercusp:base'));"
    ));
    #[cfg(target_os = "linux")]
    grant_media_permission(&win);
    #[cfg(target_os = "linux")]
    install_load_failure_recovery(&win);
    Ok(())
}

/// Raise a native OS notification (planning-attention-importance D-007).
/// Invoked from the webview's DesktopAttentionNotifier on `attention.notify`
/// SSE events (escalation / smoke-fail / plan-review / needs-human≥high).
/// The webview already shows an in-app toast, so a failure here is non-fatal
/// — it's returned as a string and the caller swallows it.
#[tauri::command]
#[specta::specta]
fn show_attention_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Native sibling terminal (native-terminal-desktop-2026-06-06)
//
// The desktop terminal is a fully NATIVE terminal, not xterm.js. On X11 we
// launch a borderless GPU-native Ghostty window hosting the chat dock
// (`pui chat` — operator chat | brain, P-013 / D-011) and
// pin it adjacent to the GUI window so the pair reads as one app. The glue is
// visual only — the terminal coordinates with the GUI through the substrate.
// See src/native_terminal.rs for the strategy + geometry + x11rb glue.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, specta::Type)]
struct NativeTerminalStatus {
    /// One of glued-ghostty-x11 / new-window / embedded-* / disabled.
    strategy: String,
    running: bool,
}

#[tauri::command]
#[specta::specta]
fn native_terminal_status(
    nt: tauri::State<native_terminal::NativeTerminal>,
) -> NativeTerminalStatus {
    NativeTerminalStatus {
        strategy: nt.strategy.label().to_string(),
        running: nt.is_running(),
    }
}

/// Show/hide the native sibling terminal. Returns the new running state.
#[tauri::command]
#[specta::specta]
fn native_terminal_toggle(app: AppHandle) -> Result<bool, String> {
    let running = {
        let nt = app.state::<native_terminal::NativeTerminal>();
        nt.is_running()
    };
    if running {
        app.state::<native_terminal::NativeTerminal>().shutdown();
        Ok(false)
    } else {
        start_native_terminal(&app);
        Ok(true)
    }
}

/// WI-3388 — the terminal's current user layout (divider width fraction +
/// collapsed/rail state). Read on mount by the web UI's `<TerminalDivider>`
/// so it renders the persisted position instead of flashing a default.
#[tauri::command]
#[specta::specta]
fn terminal_get_layout(
    nt: tauri::State<native_terminal::NativeTerminal>,
) -> native_terminal::TerminalLayout {
    nt.get_layout()
}

/// WI-3388 — set the terminal's layout (either field optional — pass just
/// `collapsed` for the rail toggle, or just `fraction` for a divider drag),
/// persist it, and apply it LIVE to whichever backend is running. A no-op
/// apply (persisted only) for NewWindow/Disabled — there's no native surface
/// to resize.
#[tauri::command]
#[specta::specta]
fn terminal_set_layout(
    app: AppHandle,
    fraction: Option<f32>,
    collapsed: Option<bool>,
) -> Result<native_terminal::TerminalLayout, String> {
    let nt = app.state::<native_terminal::NativeTerminal>();
    let resolved = nt.set_layout(fraction, collapsed);
    apply_terminal_layout_live(&app, resolved);
    Ok(resolved)
}

/// Apply `layout` to whichever backend is currently running. The X11 glued
/// path reads `NativeTerminal`'s shared layout state directly off its own
/// glue-loop thread (no action needed here beyond the `set_layout` write
/// above); the embedded views (one window, a native widget/view resized in
/// place) need an explicit re-layout call on their own main thread, using
/// the handle each embed stashed at attach time.
fn apply_terminal_layout_live(app: &AppHandle, layout: native_terminal::TerminalLayout) {
    let nt = app.state::<native_terminal::NativeTerminal>();
    match nt.strategy {
        #[cfg(target_os = "linux")]
        native_terminal::TerminalStrategy::EmbeddedView(native_terminal::EmbedBackend::Vte) => {
            let Some((paned_ptr, side)) = nt.vte_paned() else {
                return;
            };
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            let _ = window.run_on_main_thread(move || {
                native_terminal::vte_embed::apply_layout(paned_ptr, side, layout);
            });
        }
        #[cfg(target_os = "macos")]
        native_terminal::TerminalStrategy::EmbeddedView(native_terminal::EmbedBackend::SwiftTerm) => {
            let Some((ns_window, term)) = nt.swiftterm_handle() else {
                return;
            };
            let cfg = nt.config.clone();
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            let _ = window.run_on_main_thread(move || {
                if let Err(e) = native_terminal::swiftterm_embed::set_layout(
                    ns_window as *mut std::ffi::c_void,
                    term,
                    layout.fraction,
                    cfg.min_px,
                    cfg.max_px,
                    layout.collapsed,
                ) {
                    eprintln!("[papercusp-desktop] native-terminal: set_layout failed: {e}");
                }
            });
        }
        #[cfg(target_os = "windows")]
        native_terminal::TerminalStrategy::EmbeddedView(native_terminal::EmbedBackend::ConPty) => {
            let Some((parent, term, webview)) = nt.win_handles() else {
                return;
            };
            let cfg = nt.config.clone();
            std::thread::spawn(move || {
                let webview_hwnd = if webview == 0 { None } else { Some(webview) };
                if let Err(e) = native_terminal::win_embed::set_layout(
                    parent as *mut std::ffi::c_void,
                    term,
                    webview_hwnd,
                    layout.fraction,
                    cfg.min_px,
                    cfg.max_px,
                    layout.collapsed,
                ) {
                    eprintln!("[papercusp-desktop] native-terminal: set_layout failed: {e}");
                }
            });
        }
        // GluedGhosttyX11: the glue-loop thread reads the shared layout
        // state every tick (~150ms) and applies it itself — nothing to do
        // here. NewWindow/Disabled/unbuilt EmbeddedView: no native surface.
        _ => {}
    }
}

/// Make the bundled chat-dock binaries (`pui`, `zellij`) discoverable + point
/// `pui` at the bundled companion plugin, so the dock (`pui chat` = zellij + the
/// pui-companion plugin) works from a PACKAGED app. Every dock launcher — the
/// Linux glued/new-window `ghostty -e pui chat` AND the macOS SwiftTerm embed —
/// spawns its child inheriting THIS process's env, so we prepend the bundled
/// `sidecar/bin` to PATH and set PUI_COMPANION_WASM here. The sidecar dir is
/// resolved via Tauri's CROSS-PLATFORM Resource resolver (the mac `.app`
/// Contents/Resources layout and the Linux `.deb`/AppImage layout differ), so it
/// works on every target. Idempotent (run-once) + a no-op in a dev/unbundled
/// layout where the files aren't found. (linux-chat-dock-parity-2026-06-27 —
/// macOS previously did this in swiftterm_embed::prepare_dock_env, which never
/// ran on Linux, so the Linux dock stayed a blank pane even once the binaries shipped.)
fn prepare_dock_env(app: &AppHandle) {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let Ok(sidecar) = app
            .path()
            .resolve("sidecar", tauri::path::BaseDirectory::Resource)
        else {
            return;
        };
        let bin = sidecar.join("bin");
        if bin.is_dir() {
            let cur = std::env::var("PATH").unwrap_or_default();
            // PATH is `;`-separated on Windows — a `:` here would fuse our dir to
            // the first existing entry and silently discard BOTH.
            let sep = if cfg!(windows) { ';' } else { ':' };
            std::env::set_var("PATH", format!("{}{sep}{}", bin.display(), cur));
            // WI-4448: on Windows the dock runs INSIDE the papercup-runtime WSL
            // distro, which never sees this (Windows) PATH — build-rootfs.sh sets
            // `appendWindowsPath=false`. So the launcher needs the bundled bin dir
            // as a value it can PATH-translate (`windows_path_to_wsl`), not just as
            // an entry in our own PATH. Exported on every platform: it is plain
            // provenance for where the dock binaries came from.
            std::env::set_var("PAPERCUSP_DOCK_BIN", &bin);
        }
        if std::env::var_os("PUI_COMPANION_WASM").is_none() {
            let wasm = sidecar.join("pui-companion.wasm");
            if wasm.is_file() {
                std::env::set_var("PUI_COMPANION_WASM", wasm);
            }
        }
    });
}

/// Launch the native terminal per the resolved strategy. Shared by setup() and
/// the toggle command. For the glued path, the X11 window is resolved + first-
/// glued on a background thread so this never blocks.
fn start_native_terminal(app: &AppHandle) {
    use native_terminal::TerminalStrategy;
    // Ensure the bundled dock binaries (pui/zellij) are on PATH + PUI_COMPANION_WASM
    // is set BEFORE any launcher spawns `pui chat` — cross-platform (was mac-only,
    // so the Linux dock never found them). Idempotent; no-op in dev/unbundled.
    prepare_dock_env(app);
    let strategy = app.state::<native_terminal::NativeTerminal>().strategy;
    match strategy {
        TerminalStrategy::GluedGhosttyX11 => {
            if let Err(e) = app
                .state::<native_terminal::NativeTerminal>()
                .launch_glued()
            {
                eprintln!("[papercusp-desktop] native-terminal launch_glued failed: {e}");
                return;
            }
            // Drive the steady glue loop off-thread. It owns one persistent X11
            // connection and re-pins the sibling to our GUI window's true
            // geometry every ~150ms until shutdown — robust to whichever window
            // events GTK does/doesn't emit (programmatic/WM moves don't reliably
            // surface as Moved, and outer_position lags). See run_glue_loop.
            let handle = app.clone();
            std::thread::spawn(move || {
                handle
                    .state::<native_terminal::NativeTerminal>()
                    .run_glue_loop();
            });
        }
        TerminalStrategy::NewWindow => {
            if let Err(e) = app
                .state::<native_terminal::NativeTerminal>()
                .launch_new_window()
            {
                eprintln!("[papercusp-desktop] native-terminal launch_new_window failed: {e}");
            }
        }
        // D-009: the Linux embedded VTE view — a real terminal widget packed
        // beside the webview in OUR window's GTK tree (one window; Wayland-safe;
        // the GtkPaned handle is the draggable split). Must run on the GTK main
        // thread. Falls back to NewWindow if the surgery fails.
        #[cfg(target_os = "linux")]
        TerminalStrategy::EmbeddedView(native_terminal::EmbedBackend::Vte) => {
            let Some(window) = app.get_webview_window("main") else {
                eprintln!("[papercusp-desktop] native-terminal: no main window for the VTE embed");
                return;
            };
            let handle = app.clone();
            let win = window.clone();
            let res = window.run_on_main_thread(move || {
                // Defer the GTK surgery until the window is fully realized +
                // mapped: creating/re-parenting native-windowed widgets
                // mid-realization wedges VTE's internal geometry (it latches a
                // boot-time inset and computes its grid against it forever —
                // root-caused live: the same surgery a beat after map renders
                // perfectly). Poll until mapped, give the layout one more
                // settle beat, then embed.
                use webkit2gtk::glib;
                let mut settle_beats: u8 = 0;
                glib::timeout_add_local(std::time::Duration::from_millis(250), move || {
                    let mapped = win
                        .gtk_window()
                        .map(|w| gtk::prelude::WidgetExt::is_mapped(&w))
                        .unwrap_or(false);
                    if !mapped {
                        return glib::ControlFlow::Continue;
                    }
                    settle_beats += 1;
                    // ~2s after first map. Shorter settles (500ms) still hit
                    // the mid-realization wedge — verified empirically; wry's
                    // own post-map bootstrap (webview sizing + bounds passes)
                    // has to finish before the tree is safe to cut.
                    if settle_beats < 8 {
                        return glib::ControlFlow::Continue;
                    }
                    let spec = native_terminal::GhosttySpec::dock();
                    let cfg = native_terminal::GlueConfig::from_env();
                    // WI-3388: seed the embed with the PERSISTED fraction
                    // (not the env-configured default) so a relaunch opens
                    // at the user's last divider position.
                    let layout = handle
                        .state::<native_terminal::NativeTerminal>()
                        .get_layout();
                    let embedded = match (win.gtk_window(), win.default_vbox()) {
                        (Ok(gtk_win), Ok(vbox)) => native_terminal::vte_embed::embed_into_window(
                            &gtk_win,
                            &vbox,
                            &spec.command,
                            cfg.side,
                            layout.fraction,
                            &spec.background,
                        ),
                        _ => Err("no gtk window / default vbox".to_string()),
                    };
                    match embedded {
                        Ok(paned_ptr) => {
                            println!("[papercusp-desktop] native-terminal: VTE view embedded");
                            let nt = handle.state::<native_terminal::NativeTerminal>();
                            nt.set_vte_paned(paned_ptr, cfg.side);
                            if layout.collapsed {
                                native_terminal::vte_embed::apply_layout(paned_ptr, cfg.side, layout);
                            }
                        }
                        Err(e) => {
                            eprintln!(
                                "[papercusp-desktop] native-terminal VTE embed failed: {e} — falling back to new-window"
                            );
                            let _ = handle
                                .state::<native_terminal::NativeTerminal>()
                                .launch_new_window();
                        }
                    }
                    glib::ControlFlow::Break
                });
            });
            if let Err(e) = res {
                eprintln!(
                    "[papercusp-desktop] native-terminal: VTE embed main-thread hop failed: {e}"
                );
            }
        }
        // D-009: the macOS embedded SwiftTerm view — a real native terminal
        // attached inside OUR window's content view via the dlopen'd
        // macos-term-shim (terminal left, webview shrunk right — P-014). Must
        // run on the AppKit main thread. Falls back to NewWindow on failure.
        #[cfg(target_os = "macos")]
        TerminalStrategy::EmbeddedView(native_terminal::EmbedBackend::SwiftTerm) => {
            let Some(window) = app.get_webview_window("main") else {
                eprintln!(
                    "[papercusp-desktop] native-terminal: no main window for the SwiftTerm embed"
                );
                return;
            };
            let handle = app.clone();
            let win = window.clone();
            // Same lesson as the Linux VTE embed: surgery mid-realization is
            // hazardous — and here the WKWebView mounts AFTER setup(), at full
            // bounds, covering an early-attached terminal. Defer ~2s off-thread,
            // then hop to the AppKit main thread for the attach.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(2000));
                let win2 = win.clone();
                let res = win.run_on_main_thread(move || {
                    let spec = native_terminal::GhosttySpec::dock();
                    let cfg = native_terminal::GlueConfig::from_env();
                    let layout = handle
                        .state::<native_terminal::NativeTerminal>()
                        .get_layout();
                    let ns_addr: Option<usize> = win2.ns_window().ok().map(|p| p as usize);
                    let embedded = match ns_addr {
                        Some(ns_addr) => native_terminal::swiftterm_embed::embed_into_window(
                            ns_addr as *mut std::ffi::c_void,
                            &spec.command,
                            layout.fraction,
                            cfg.min_px,
                            cfg.max_px,
                        ),
                        None => Err("no ns_window".to_string()),
                    };
                    match embedded {
                        Ok(term_handle) => {
                            println!("[papercusp-desktop] native-terminal: SwiftTerm view embedded");
                            let nt = handle.state::<native_terminal::NativeTerminal>();
                            let ns_addr = ns_addr.unwrap_or(0);
                            nt.set_swiftterm_handle(ns_addr, term_handle);
                            if layout.collapsed {
                                let _ = native_terminal::swiftterm_embed::set_layout(
                                    ns_addr as *mut std::ffi::c_void,
                                    term_handle,
                                    layout.fraction,
                                    cfg.min_px,
                                    cfg.max_px,
                                    true,
                                );
                            }
                        }
                        Err(e) => {
                            eprintln!(
                                "[papercusp-desktop] native-terminal SwiftTerm embed failed: {e} — falling back to new-window"
                            );
                            let _ = handle
                                .state::<native_terminal::NativeTerminal>()
                                .launch_new_window();
                        }
                    }
                });
                if let Err(e) = res {
                    eprintln!(
                        "[papercusp-desktop] native-terminal: SwiftTerm embed main-thread hop failed: {e}"
                    );
                }
            });
        }
        // D-009: the Windows glued-child-HWND terminal — a real ConPTY-backed
        // console window reparented INTO the Tauri window (left band), with
        // the WebView2 child shrunk right. Win32 calls are cross-thread-safe,
        // so the (window-poll-blocking) embed runs on a worker thread.
        #[cfg(target_os = "windows")]
        TerminalStrategy::EmbeddedView(native_terminal::EmbedBackend::ConPty) => {
            let Some(window) = app.get_webview_window("main") else {
                eprintln!(
                    "[papercusp-desktop] native-terminal: no main window for the ConPTY embed"
                );
                return;
            };
            let Ok(hwnd) = window.hwnd() else {
                eprintln!("[papercusp-desktop] native-terminal: no hwnd for the ConPTY embed");
                return;
            };
            let handle = app.clone();
            // Raw pointers aren't Send — carry the HWND across the thread as
            // usize and rebuild it inside.
            let hwnd_addr = hwnd.0 as usize;
            std::thread::spawn(move || {
                // Same lesson as the Linux VTE embed: let the window finish
                // realizing + the WebView2 child mount before cutting the tree.
                std::thread::sleep(std::time::Duration::from_millis(2000));
                let spec = native_terminal::GhosttySpec::dock();
                let cfg = native_terminal::GlueConfig::from_env();
                let layout = handle
                    .state::<native_terminal::NativeTerminal>()
                    .get_layout();
                match native_terminal::win_embed::embed_into_window(
                    hwnd_addr as *mut std::ffi::c_void,
                    &spec.command,
                    layout.fraction,
                    cfg.min_px,
                    cfg.max_px,
                ) {
                    Ok(handles) => {
                        println!(
                            "[papercusp-desktop] native-terminal: ConPTY console embedded (pid={})",
                            handles.pid
                        );
                        let nt = handle.state::<native_terminal::NativeTerminal>();
                        nt.set_win_handles(hwnd_addr as isize, handles.term_hwnd, handles.webview_hwnd);
                        if layout.collapsed {
                            let _ = native_terminal::win_embed::set_layout(
                                hwnd_addr as *mut std::ffi::c_void,
                                handles.term_hwnd,
                                handles.webview_hwnd,
                                layout.fraction,
                                cfg.min_px,
                                cfg.max_px,
                                true,
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[papercusp-desktop] native-terminal ConPTY embed failed: {e} — falling back to new-window"
                        );
                        let _ = handle
                            .state::<native_terminal::NativeTerminal>()
                            .launch_new_window();
                    }
                }
            });
        }
        // Remaining embedded views (a backend on the wrong OS) are downgraded
        // to NewWindow until they land; Disabled = no display / opted out.
        TerminalStrategy::EmbeddedView(_) | TerminalStrategy::Disabled => {}
    }
}

/// Resolve the terminal strategy, manage the `NativeTerminal`, launch it for
/// the main window, and register the move/resize/focus glue hook. Runs in both
/// dev and prod so the terminal is present whenever the desktop is.
fn init_native_terminal(app: &tauri::App) {
    let strategy = native_terminal::resolve_strategy_from_env();
    println!(
        "[papercusp-desktop] native-terminal strategy: {}",
        strategy.label()
    );
    let nt = native_terminal::NativeTerminal::new(strategy);
    // WI-3388: load any persisted divider width/collapsed state (a no-op
    // default on first run) before the terminal launches, so the very first
    // embed/glue-loop tick already has the user's last layout instead of
    // flashing the default fraction. Best-effort — an unresolvable config
    // dir just means layout won't survive relaunch this session.
    match app.path().app_config_dir() {
        Ok(dir) => nt.init_layout_persistence(dir.join("terminal-layout.json")),
        Err(e) => eprintln!(
            "[papercusp-desktop] native-terminal: no app_config_dir ({e}) — layout won't persist"
        ),
    }
    app.manage(nt);

    // The main window must exist before we launch (the glue resolves it by pid).
    if app.get_webview_window("main").is_none() {
        return;
    }

    // The glue loop (run_glue_loop) owns the move/resize tracking, so there's no
    // per-window-event hook to register here.
    start_native_terminal(app.handle());
}

/// A hardware GL render node (`/dev/dri/renderD*`) — its ABSENCE means software
/// rendering (llvmpipe) or a GPU with no render capability (QXL / virtio in a VM,
/// or headless), where WebKitGTK's DMA-BUF renderer wedges Xorg. A missing
/// `/dev/dri` directory ⇒ no render node.
#[cfg(target_os = "linux")]
fn linux_has_dri_render_node() -> bool {
    std::fs::read_dir("/dev/dri")
        .map(|rd| {
            rd.flatten()
                .any(|e| e.file_name().to_str().is_some_and(|n| n.starts_with("renderD")))
        })
        .unwrap_or(false)
}

/// Whether to force `WEBKIT_DISABLE_DMABUF_RENDERER=1`. The DMA-BUF renderer
/// misbehaves in two Linux GPU situations: the NVIDIA proprietary driver
/// (stale-tile artifacts) and software rendering with no hardware render node
/// (X-server wedge / black screen on a VM — WI-3282). Pure so it's unit-tested.
fn should_disable_dmabuf(nvidia_present: bool, software_render: bool) -> bool {
    nvidia_present || software_render
}

#[cfg(test)]
mod dmabuf_render_tests {
    use super::should_disable_dmabuf;

    #[test]
    fn disables_on_nvidia_or_software_render() {
        // NVIDIA proprietary driver → stale-tile artifacts → disable.
        assert!(should_disable_dmabuf(true, false));
        // Software render / no hardware render node (VM, llvmpipe) → X wedge → disable.
        assert!(should_disable_dmabuf(false, true));
        // Both → disable.
        assert!(should_disable_dmabuf(true, true));
        // A real hardware GL render node and no NVIDIA → keep the fast DMA-BUF path.
        assert!(!should_disable_dmabuf(false, false));
    }
}

pub fn run() {
    // Before anything opens an fd or spawns a child: lift THIS process's fd soft
    // limit off the 256 macOS hands a GUI app. rlimits inherit across fork/exec,
    // so one call here also covers every NON-node child (gateway sidecar,
    // embedded PG, the `claude` CLI).
    //
    // Latent hardening, NOT a fix for an observed crash — WI-4369 was originally
    // filed claiming an impending operator EMFILE, and that was wrong: node
    // raises its OWN RLIMIT_NOFILE at startup (to 1048575), so the operator
    // sidecar was never bounded by 256. See fd_limit.rs for the full correction
    // and the two traps the implementation dodges.
    fd_limit::raise_fd_limit();

    // WebKitGTK's DMA-BUF renderer misbehaves on two Linux GPU situations, so we
    // force it off (before any webview exists — an explicit user value always
    // wins) when either applies:
    //   (a) the NVIDIA proprietary driver — stale-tile artifacts (ghost fragments
    //       of other surfaces composited into the webview; webkit#262607,
    //       tauri#9394/#14924; dev box, webkit2gtk 2.52 + driver 580); and
    //   (b) SOFTWARE rendering with no hardware GL render node (llvmpipe, or a QXL
    //       / virtio GPU in a VM, or headless) — there the DMA-BUF path drove Xorg
    //       to 93% and WEDGED the X server (black, frozen, uninteractable) even
    //       after killing every app process (WI-3282, owner's clean Linux VM). The
    //       absence of /dev/dri/renderD* is the software-render signal.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
        let software_render = !linux_has_dri_render_node();
        if should_disable_dmabuf(nvidia, software_render) {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            // On a genuinely GPU-less box also drop accelerated compositing — there
            // is no hardware accel to lose and it forecloses the rest of the
            // GL-compositing X-wedge class. NOT done on the NVIDIA path (a real GPU
            // is present — disabling compositing there would be a perf regression),
            // and LIBGL_ALWAYS_SOFTWARE is deliberately NOT forced (a no-op under
            // llvmpipe, and it would cripple a real GPU).
            if software_render
                && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none()
            {
                std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            }
        }
    }

    let state = SidecarState {
        child: Mutex::new(None),
        port: Mutex::new(None),
        endpoint_ipc_socket: Mutex::new(None),
        shutdown_done: std::sync::atomic::AtomicBool::new(false),
    };

    // tauri-specta Builder — collects every #[specta::specta] command
    // and emits a typed `bindings.ts` for the frontend on each debug
    // build. The frontend imports typed wrappers from `@/bindings`
    // instead of stringly-typed `invoke('cmd', ...)`.
    let specta_builder =
        tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
            workspaces_list,
            workspaces_create,
            workspaces_rename,
            workspaces_delete,
            workspaces_switch,
            workspaces_open_window,
            show_attention_notification,
            app_version,
            check_for_update,
            install_update,
            revert_to,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_history,
            pty::pty_is_alive,
            wsl_setup::wsl_status,
            wsl_setup::wsl_install,
            wsl_setup::wsl_relaunch_elevated,
            wsl_setup::wsl_import,
            wsl_setup::wsl_bootstrap,
            wsl_setup::wsl_finalize_ready,
            wsl_setup::wsl_uninstall,
            native_console::console_launch,
            native_console::list_windows_by_title,
            native_console::focus_window_by_title,
            native_console::external_console_run,
            native_terminal_status,
            native_terminal_toggle,
            terminal_get_layout,
            terminal_set_layout,
            endpoint_ipc::endpoint_invoke,
            endpoint_ipc::endpoint_cancel,
            dev_bridge::__dev_bridge_result,
            env_switch::list_envs,
            docs_search::open_docs_search_palette,
        ]);

    // Export to the operator app — that's where the desktop UI lives
    // (Tauri loads localhost:3055 served by apps/operator). Frontend
    // imports as `import { commands } from '@/lib/tauri-bindings'`.
    #[cfg(debug_assertions)]
    specta_builder
        .export(
            specta_typescript::Typescript::default(),
            "../../papercup/apps/operator/lib/tauri-bindings.ts",
        )
        .ok();

    // P-009 single-instance guard — MUST be the FIRST plugin so a duplicate
    // launch is rejected before any sidecar/window init runs. The plugin keys
    // its OS lock on the app IDENTIFIER, which is distinct per bundle
    // (com.papercusp.gui vs com.papercusp.server) → PER-BUNDLE-IDENTITY: two
    // GUIs (or two Servers) collide — the second is closed and routed to
    // on_second_instance() in the primary — while a GUI and a Server coexist.
    // Release-only so agent-e2e can still run a second `npm run dev` shell;
    // PAPERCUSP_DISABLE_SINGLE_INSTANCE=1 force-disables it in a packaged build.
    // See app_role.rs + the two-bundle split above.
    let base = tauri::Builder::default();
    #[cfg(not(debug_assertions))]
    let base = if std::env::var_os("PAPERCUSP_DISABLE_SINGLE_INSTANCE").is_some() {
        base
    } else {
        base.plugin(tauri_plugin_single_instance::init(on_second_instance))
    };

    let builder = base
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // Invisible env-switch escape hatch (env_switch::register_backstop_shortcuts):
        // OS-level shortcuts registered from Rust, no menu bar. Inert until the
        // dev-path registers shortcuts, so a packaged build carries nothing.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Login auto-start for the Server role (enabled only in server_setup).
        // Cross-platform: macOS LaunchAgent, Windows HKCU Run, Linux XDG
        // autostart. Registered on both roles (shared Builder) but only the
        // Server ever calls .enable(), so the GUI carries an inert plugin.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    // MCP bridge for AI coding agents — debug builds only. Lets Claude
    // Code / Cursor connect via @hypothesi/tauri-mcp-server and inspect
    // the running app (IPC, window state, JS eval). Bound to localhost
    // only — the bridge exposes webview_execute_js, so a 0.0.0.0 bind
    // would let anyone on the LAN drive the dev app.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(
        tauri_plugin_mcp_bridge::Builder::new()
            .bind_address("127.0.0.1")
            .build(),
    );

    // Phase 4 — `papercusp://` custom protocol (DEFAULT-ON, shipped
    // 2026-06-01). Register the async scheme handler so the window loads
    // `papercusp://localhost/…` (forwarded to the loopback sidecar) and opens
    // zero HTTP connections from the webview. Set
    // PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL=0 to roll back to the HTTP origin.
    // See custom_protocol.rs + the navigate hook in setup().
    // Register on every platform that serves the bundled-SPA origin — Linux
    // (steady-state) AND Windows (pre-operator onboarding gate). Gating this on
    // enabled() (Linux-only) is what left the handler unregistered on Windows,
    // stranding first-run on the dead :3070 frontendDist (WI-2734).
    let builder = if custom_protocol::onboarding_origin_enabled() {
        builder.register_asynchronous_uri_scheme_protocol(
            custom_protocol::SCHEME,
            custom_protocol::handle,
        )
    } else {
        builder
    };

    builder
        .invoke_handler(specta_builder.invoke_handler())
        .manage(state)
        // A page (re)load (Ctrl+R, Vite full-reload, navigation) destroys the
        // JS context that owns every in-flight endpoint-IPC Channel, but the
        // Rust-side registrations survive — the reader loop would keep
        // fanning server stream frames into dead callbacks forever, flooding
        // the console with "[TAURI] Couldn't find callback id" warnings.
        // Flush at Started, before the new page registers any calls.
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(handle) =
                    webview.try_state::<std::sync::Arc<endpoint_ipc::IpcClientHandle>>()
                {
                    handle.flush_for_page_load();
                }
                // Make /api follow whatever env the webview navigated to — the
                // in-webview bar's window.location switch + the native backstop +
                // a manual reload all land here, so /api retargets with NO bar in
                // the loop (replaces the GTK bar's switch_to retarget).
                env_switch::retarget_for_url(webview.app_handle(), payload.url());
            }
        })
        .setup(|app| {
            let role = app_role::detect(&app.config().identifier);
            // WI-1803: BEFORE any boot diagnostic prints, route THIS process's
            // own stdout/stderr to a rotated on-disk log in packaged (release)
            // builds — a Finder/launchd/login-item launch has no console, so
            // fd 1/2 are /dev/null and every eprintln! below (incl. the GUI
            // navigate/boot failure that blanks the page — WI-1802) would
            // otherwise vanish. Role-scoped basename so the GUI and Server
            // processes don't interleave into one file, and distinct from the
            // serve.mjs child's serve.log. Dev keeps its inherited terminal.
            #[cfg(all(not(debug_assertions), any(unix, windows)))]
            {
                let basename = if role.is_gui() { "gui.log" } else { "server-app.log" };
                redirect_own_stdio(&workspaces::shared_sidecar_home(), basename);
            }
            // Now that there IS a log, report the fd-limit raise that ran at the
            // top of run() — before this, a packaged build's fd 1/2 are /dev/null.
            fd_limit::report();
            println!(
                "[papercusp-desktop] role={} (identifier {})",
                role.label(),
                app.config().identifier
            );
            let is_dev = cfg!(debug_assertions);

            // Demo-pipeline version gate (demo-pipeline-version-gate-2026-07-13):
            // write THIS running app's real version to a well-known file so the
            // capture pipeline can assert it is filming the current build, not a
            // stale installed binary (draft 4 filmed a July-4 0.0.2 binary while
            // the repo was already 0.0.9). Best-effort — a self-report failure
            // must never crash the app. Only the GUI/dev process writes it (the
            // windowless Server would otherwise race the same file); the GUI is
            // what the demo films.
            if is_dev || role.is_gui() {
                let ver_path = workspaces::shared_sidecar_home()
                    .join(".papercusp")
                    .join("desktop-app-version.json");
                let started_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let report = serde_json::json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "pid": std::process::id(),
                    "startedAtMs": started_ms,
                    "display": std::env::var("DISPLAY").unwrap_or_default(),
                    "role": role.label(),
                    "isDev": is_dev,
                });
                if let Some(parent) = ver_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::write(
                    &ver_path,
                    serde_json::to_vec_pretty(&report).unwrap_or_else(|_| b"{}".to_vec()),
                ) {
                    Ok(_) => println!(
                        "[papercusp-desktop] version self-report v{} pid {} -> {}",
                        env!("CARGO_PKG_VERSION"),
                        std::process::id(),
                        ver_path.display()
                    ),
                    Err(e) => eprintln!(
                        "[papercusp-desktop] failed to write version self-report to {}: {e}",
                        ver_path.display()
                    ),
                }
            }

            // Native sibling terminal — resolve strategy + launch the glued
            // (X11) / native terminal and register the glue hook. It's glued to
            // a window, so only the GUI (and dev) has one; the windowless Server
            // skips it. Visual-only; coordinates via the substrate.
            if is_dev || role.is_gui() {
                init_native_terminal(app);
            }

            if is_dev {
                // In dev mode we trust the developer (or beforeDevCommand's
                // dev-operator-ifneeded.sh) to run the operator dev stack
                // externally; the webview points at devUrl from
                // tauri.conf.json (:3070, the Hono host).
                println!("[papercusp-desktop] dev mode — skipping sidecar spawn (expecting devUrl :3070 to be served externally)");

                // tauri-agent-tools dev bridge — debug-only, localhost-only,
                // token-authenticated. Writes /tmp/tauri-dev-bridge-<pid>.token
                // for the CLI to auto-discover.
                match dev_bridge::start_bridge(app.handle()) {
                    Ok((port, _log_buffer, _sidecar_registry)) => {
                        println!("[papercusp-desktop] dev bridge listening on 127.0.0.1:{port}");
                    }
                    Err(e) => {
                        eprintln!("[papercusp-desktop] failed to start dev bridge: {e}");
                    }
                }

                // Devtools auto-open is OPT-IN via PAPERCUSP_AUTO_DEVTOOLS=1.
                // It used to fire unconditionally in debug, but WebKitGTK opens
                // the Web Inspector ATTACHED — it splits/takes over the main
                // window — so every dev launch shoved an inspector pane into
                // the owner's face, and when webview paint was degraded the
                // inspector chrome was ALL the user saw ("all it says is web
                // inspector", 2026-07-05, WI-2817 fallout). Agents inspect via
                // the dev bridge (tauri-agent-tools) or Ctrl+Shift+I; neither
                // needs the auto-pop.
                if let Some(window) = app.get_webview_window("main") {
                    restore_window_visibility(&window, "dev-setup");
                    // `open_devtools` is compiled out in release unless the
                    // tauri `devtools` feature is on (and we don't want
                    // devtools popping in a shipped/release build anyway).
                    #[cfg(debug_assertions)]
                    if std::env::var_os("PAPERCUSP_AUTO_DEVTOOLS").is_some_and(|v| v == "1") {
                        window.open_devtools();
                    }
                    // WebKitGTK denies getUserMedia by default; auto-grant
                    // so the operator's voice/wake-word/elevenlabs paths
                    // work without surfacing NotAllowedError on every load.
                    #[cfg(target_os = "linux")]
                    grant_media_permission(&window);
                    #[cfg(target_os = "linux")]
                    install_load_failure_recovery(&window);
                }

                // DEV endpoint-IPC: we don't spawn the sidecar in dev, so
                // there's no stdout PAPERCUSP_IPC_READY handshake. The
                // externally-run operator publishes its socket path to
                // ~/.papercusp/endpoint-ipc.json instead. Manage a reconnecting
                // handle whose socket source RE-READS that file on every
                // (re)connect — so the webview's /api fetch + EventSource ride
                // IPC (escaping libsoup's 6-socket pool), AND a restarted
                // operator's new socket is picked up automatically instead of
                // wedging onto the hanging HTTP fallback. Graceful HTTP
                // fallback while the operator is down.
                #[cfg(debug_assertions)]
                if let Some(home) = std::env::var_os("HOME") {
                    let papercusp_dir = std::path::PathBuf::from(home).join(".papercusp");
                    // EI-190: resolve the socket for the SELECTED operator
                    // (the dev wrapper's build switcher), re-read on every
                    // (re)connect — so /api deliberately follows the chosen
                    // build instead of the singleton's restart-order accident.
                    let dir_src = papercusp_dir.clone();
                    let handle = endpoint_ipc::IpcClientHandle::new(move || {
                        let port =
                            SELECTED_API_PORT.load(std::sync::atomic::Ordering::Relaxed);
                        read_dev_ipc_socket_for_port(&dir_src, port)
                            .map(std::path::PathBuf::from)
                    });
                    app.manage(handle.clone());
                    // Warm in the background — the operator may boot after the
                    // webview; first /api call would reconnect anyway.
                    tauri::async_runtime::spawn(async move {
                        for _ in 0..120 {
                            if handle.warm().await.is_ok() {
                                println!("[papercusp-desktop] dev endpoint-ipc connected (reconnecting)");
                                return;
                            }
                            tokio::time::sleep(Duration::from_millis(500)).await;
                        }
                        eprintln!("[papercusp-desktop] dev endpoint-ipc: no socket after 60s — /api on HTTP until operator is up");
                    });
                }

                // Env-switch startup (env_switch::init): install the dev-rail
                // signal + restore the persisted env target. AFTER the
                // endpoint-IPC manage above — it retargets /api to the persisted
                // build (EI-190), which needs the managed handle to reset.
                // Dev-only by design: the packaged app drives its own sidecar on
                // a dynamic port / papercusp:// origin where the fixed
                // :3070/:3170/:3055 targets are meaningless. The VISIBLE bar is
                // the in-webview EnvSwitcherBar (fed by the list_envs command);
                // the native menu + global-shortcut backstop (install_backstop)
                // is the unkillable escape hatch.
                env_switch::init(app);
                // Invisible escape hatch: CmdOrCtrl+Alt+1..4 switch envs even
                // when the loaded build's own bar + IPC are dead. No menu bar.
                env_switch::register_backstop_shortcuts(app);
                // WI-2648: CmdOrCtrl+K opens the docs-search palette. Real
                // feature (not a dev-only escape hatch) — also registered in
                // gui_setup() for packaged builds.
                docs_search::register_shortcut(app);

                return Ok(());
            }

            // Packaged builds split into two bundles (one binary, two roles).
            // GUI: attach to a running Server (auto-launch it if needed); it
            // never spawns or owns a sidecar, so quit never tears the backend
            // down. Server: fall through to the sidecar-owning boot below.
            if role.is_gui() {
                return gui_setup(app);
            }

            // ===== Server role: spawn + OWN the operator sidecar. =====
            // Invariant (WI-3170 P-003 / WI-2902 co-install footgun): ONLY the
            // Server role reaches here — the GUI role returned via gui_setup() above
            // and never spawns/owns an operator. Assert it so a future refactor that
            // lets a GUI fall through (spawning a competing operator that fights the
            // Server over PG/ports) fails loudly instead of silently double-owning
            // the operator. A plain assert! (one enum match at boot) so it holds in
            // release too — structurally it can never fire (the GUI returned above).
            assert!(
                role.owns_operator(),
                "only the Server role may spawn/own the operator (got role={})",
                role.label()
            );
            // (EI-8894/WI-3633 leg 2) Boot-time orphan sweep runs later, inside
            // bring_up_sidecar (right before spawn_serve) — that's the single
            // choke point both this fast path AND the Windows deferred-WSL
            // watcher path funnel through, and it's where workspace_home/
            // via_wsl are actually in scope. See sweep_stale_operator_orphan.
            // Production: spawn the sidecar.
            let port = match find_free_port() {
                Some(p) => p,
                None => {
                    eprintln!("[papercusp-desktop] no free port available");
                    return Ok(());
                }
            };

            let sidecar_dir = app
                .path()
                .resolve("sidecar", tauri::path::BaseDirectory::Resource)
                .unwrap_or_else(|_| std::path::PathBuf::from("./sidecar"));

            // Phase E (P-050 / D-008): ONE shared sidecar serves every
            // workspace. It runs under the real user HOME (`shared_sidecar_home`
            // — where ~/.claude / ~/.gitconfig live); per-workspace credential
            // isolation moves to each spawned CHILD's HOME (P-051, set
            // operator-side from the job's workspace). The embedded-PG data
            // lives in a SHARED dir (`shared_data_dir`), NOT under any one
            // workspace, because the DB is a single RLS-scoped instance for all
            // workspaces (D-006). `ensure_initialized()` still runs the
            // first-launch ~/.papercusp migration + provisions each per-workspace
            // dir's credentials, so the per-spawn HOME flip has populated
            // credential homes to point at.
            if let Err(e) = workspaces::ensure_initialized() {
                eprintln!("[papercusp-desktop] workspace registry init failed: {} (continuing with shared home)", e);
            }
            let workspace_home = workspaces::shared_sidecar_home();
            let shared_state_dir = workspaces::shared_data_dir();
            if let Err(e) = std::fs::create_dir_all(&shared_state_dir) {
                eprintln!("[papercusp-desktop] could not create shared state dir {}: {}", shared_state_dir.display(), e);
            }
            println!(
                "[papercusp-desktop] shared sidecar home: {} | shared state dir: {}",
                workspace_home.display(),
                shared_state_dir.display()
            );

            // PG (SP1 C5): embedded Postgres is OWNED BY SERVE now — port
            // selection, the orphan-postmaster sweep, the wire-protocol ready
            // probe, migrations, and the embedded-pg.json write all happen
            // inside serve.mjs. We only pick a fresh TCP port hint per spawn
            // so two desktops on one host don't collide (`serve --ensure`
            // makes same-HOME double-launches converge on ONE operator
            // instead of double-booting PG on one data dir).
            // PAPERCUSP_USE_EMBEDDED_PG=0 (external PG via the inherited
            // HARNESS_*_DATABASE_URL env) passes through inside spawn_serve.
            let pg_port_hint = portpicker::pick_unused_port().unwrap_or(15432);

            // On Windows the harness needs POSIX, so we route the sidecar
            // through `wsl.exe --distribution papercup-runtime` once the
            // user has finished the WslOnboardingGate. Until then we
            // skip the sidecar spawn — the gate covers the whole UI so
            // there's no app to talk to anyway. The frontend can later
            // call a respawn-sidecar command (TODO) once WSL transitions
            // to Ready, or we just rely on a manual app restart.
            let via_wsl = should_route_via_wsl(&app.handle());
            // Publish for AppHandle-less call sites (native pty routes its
            // commands through wsl.exe when the sidecar does).
            wsl_setup::set_route_active(via_wsl);

            // Point the window at the custom-protocol origin IMMEDIATELY —
            // never show the conf's frontendDist URL (:3070), which nothing
            // serves on a user machine: it renders a connection-refused page
            // for the whole 60-90s boot, and its own Refresh button reloads
            // the dead URL, stranding the user there permanently (reported
            // live 2026-06-11). Pre-discovery the handler serves the BUNDLED
            // SPA statics (D-009: renders WslOnboardingGate / a booting
            // shell); once serve is discovered, finish_boot reloads the
            // document against the live proxy.
            // onboarding_origin_enabled(), not enabled() — see the GUI-role
            // navigate above: Windows renders the WslOnboardingGate off this
            // pre-operator origin; the buffered scheme is NOT the steady-state
            // origin there (that stays the real HTTP port for SSE). WI-2734.
            if custom_protocol::onboarding_origin_enabled() {
                if let Some(window) = app.get_webview_window("main") {
                    restore_window_visibility(&window, "server-setup");
                    match custom_protocol::APP_ORIGIN.parse() {
                        Ok(u) => {
                            if let Err(e) = window.navigate(u) {
                                eprintln!("[papercusp-desktop] app-origin navigate failed: {e}");
                            }
                        }
                        Err(e) => {
                            eprintln!("[papercusp-desktop] APP_ORIGIN did not parse: {e}")
                        }
                    }
                }
            }

            // WSL-INDEPENDENT server setup — install NOW, before the WSL gate,
            // so the Windows deferred-boot path (pristine first run, WSL not yet
            // Ready) gets the tray + global shortcut + login-autostart WITHOUT a
            // restart. The old code ran these only in the post-WSL tail and
            // reached that tail via a breakaway restart, which raced the
            // single-instance lock and wedged (WI-3407). None depend on WSL or
            // the sidecar.
            // WI-2648: the always-on Server owns the docs-search palette global
            // shortcut (CmdOrCtrl+K by default) — so it works whether or not the
            // GUI is open, and the tray's rebind control is same-process.
            docs_search::register_shortcut(app);
            // The backend has no window, so the tray both keeps the app alive and
            // gives the user a place to open the GUI, change the docs-search
            // shortcut, or quit; auto-start means psu works right after login.
            if let Err(e) = install_server_tray(app) {
                eprintln!("[papercusp-desktop] tray install failed: {e}");
            }
            enable_login_autostart(app);
            // WI-4404: the Server has no webview, so nothing ever called
            // check_for_update for it — this is what actually makes it poll.
            // See spawn_server_update_poller's doc comment for why it stops at
            // "surface via the tray", not "auto-install".
            spawn_server_update_poller(app);

            #[cfg(target_os = "windows")]
            {
                let status = wsl_setup::detect(&app.handle());
                if !matches!(status.state, wsl_setup::WslState::Ready) {
                    println!(
                        "[papercusp-desktop] WSL not Ready — deferring sidecar spawn until onboarding finishes (detect: {:?})",
                        status
                    );
                    // Reload-proof finalize watcher: watch from the SHELL (not
                    // the reloadable gate page) — when detect() flips Ready,
                    // spawn the sidecar IN-PROCESS. This process is already the
                    // live singleton Server (holds the single-instance lock), so
                    // it just does its deferred job. The OLD path breakaway-
                    // restarted a 2nd instance (wsl_finalize_ready) to re-run
                    // setup with WSL Ready; that instance lost the single-instance
                    // race to this still-alive one and left the sidecar unspawned
                    // forever — every pristine first boot wedged (WI-3407).
                    let watcher_handle = app.handle().clone();
                    std::thread::spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_secs(10));
                        let status = wsl_setup::detect(&watcher_handle);
                        if matches!(status.state, wsl_setup::WslState::Ready) {
                            println!(
                                "[papercusp-desktop] WSL became Ready post-boot — spawning the sidecar in-process (no restart, WI-3407)"
                            );
                            // WI-3407 (serve-spawn leg): `via_wsl` was computed at
                            // STARTUP (~line 5017) when WSL was InstalledNoDistro, so
                            // it is FALSE here. Reusing that stale value launches
                            // serve.mjs with the WINDOWS `node` from the
                            // `\\?\C:\...\sidecar` cwd, where Node's CJS resolver
                            // realpathSync-EISDIRs on the bare `C:` drive ref → serve
                            // crash-loops → operator FATAL@120s (run C, 2026-07-09).
                            // We only reach this branch BECAUSE WSL is now Ready
                            // (`status` above), which is exactly should_route_via_wsl's
                            // Ready predicate, so routing via WSL is unconditionally
                            // correct — override to true and re-publish the route flag
                            // for AppHandle-less callers (native pty) before spawning.
                            let via_wsl = true;
                            wsl_setup::set_route_active(via_wsl);
                            // WI-3044: WSL is usable now — refresh the Windows
                            // `psu` launcher + PATH off-thread (shells to powershell).
                            std::thread::spawn(wsl_setup::ensure_windows_cli_shims);
                            bring_up_sidecar(
                                &watcher_handle,
                                via_wsl,
                                port,
                                sidecar_dir,
                                pg_port_hint,
                                shared_state_dir,
                                workspace_home,
                            );
                            return;
                        }
                    });
                    return Ok(());
                }
                // WI-3044: WSL is Ready — refresh the Windows-side `psu`
                // launcher + user PATH so a bare `psu` works from any
                // cmd/PowerShell window. Off-thread: it shells out to
                // powershell.exe and must never hold up boot.
                std::thread::spawn(wsl_setup::ensure_windows_cli_shims);
            }
            // Spawn + wire the operator sidecar. Fast path (WSL already Ready /
            // non-Windows) runs it inline here; the Windows deferred watcher above
            // calls the SAME helper in-process once WSL flips Ready — no restart,
            // no second instance (WI-3407). Tray / shortcut / autostart already ran.
            bring_up_sidecar(
                app.handle(),
                via_wsl,
                port,
                sidecar_dir,
                pg_port_hint,
                shared_state_dir,
                workspace_home,
            );

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            // App-level exit is the ONE teardown trigger. A per-window
            // CloseRequested arm used to sit here too — that killed the
            // shared operator whenever ANY window closed (including a
            // secondary `ws-<id>` workspace window, stranding every other
            // window), and on the plain quit path it ran the teardown again
            // when ExitRequested/Exit followed (P-051). Closing the last
            // window ends the event loop, so ExitRequested → Exit still
            // covers the single-window quit.
            // Safety net for the windowless Server: a window-close-triggered
            // ExitRequested has `code == None`. The Server is kept alive by its
            // TRAY, not a window — its only transient window is the docs-search
            // palette — so vetoing that exit stops the palette's dismissal from
            // tearing the whole Server (operator + embedded PG) down (WI-2648).
            // An explicit tray "Quit" calls app.exit(0) → `code == Some(0)` →
            // falls through to a real teardown. The GUI role keeps the old
            // behavior (closing its window quits it; it owns no operator).
            RunEvent::ExitRequested { code, api, .. } => {
                let is_server = matches!(
                    app_role::detect(&app_handle.config().identifier),
                    app_role::Role::Server
                );
                if code.is_none() && is_server {
                    api.prevent_exit();
                } else {
                    shutdown_children_once(app_handle);
                }
            }
            RunEvent::Exit => {
                shutdown_children_once(app_handle);
            }
            _ => {}
        });
}

// (SP1 C5) sweep_orphan_postgres moved to serve.ts (sweepOrphanPostgres) —
// PG lifecycle ownership lives in `papercusp serve` now, so the orphan
// sweep runs there, right before startEmbeddedPostgresServer.

/// Send SIGTERM to a Child, wait up to `grace_ms` for it to exit, then
/// SIGKILL if still alive. Returns once the child has actually reaped.
///
/// Why not just `Child::kill()`? On Unix that's SIGKILL, which gives the
/// process zero chance to clean up its own children. The embedded-postgres
/// Node wrapper spawns a real postgres binary as a grandchild — SIGKILLing
/// the wrapper orphans the postgres process to PID 1 (init). Diagnostic
/// 2026-05-06 found postgres PIDs persisting across desktop restarts that
/// way, eventually colliding with the new instance's data dir lock.
///
/// SIGTERM lets the Node wrapper run its own SIGTERM handler, which in
/// turn `pg_ctl stop`s its postgres child cleanly. Same logic applies to
/// zero-cache (which manages a change-streamer child).
fn graceful_kill(child: &mut Child, label: &str, grace_ms: u64) {
    let pid = child.id();
    println!(
        "[papercusp-desktop] terminating {} pid={} (soft signal, grace {}ms)",
        label, pid, grace_ms
    );
    // Send SIGTERM via /bin/kill — avoids pulling in a new Rust dep
    // for one syscall. `Command::kill()` from std would send SIGKILL.
    #[cfg(unix)]
    {
        // (EI-8894/WI-3633 leg 1) TERM the whole PROCESS GROUP, not just this
        // pid. `isolate_process_group` (process_group(0)) made this child's
        // pgid == its own pid at spawn, so `-<pid>` (negative = group form of
        // kill(2)) reaches this child AND any grandchildren it forked that
        // never called setsid/setpgid to leave the group (e.g. embedded PG's
        // postmaster) — not just the direct child. Node's own SIGTERM handler
        // still runs identically (it's still the same signal, same target
        // process, just delivered via the group form); this only widens the
        // blast radius to siblings-in-group that a plain per-pid TERM missed.
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(format!("-{pid}"))
            .status();
    }
    #[cfg(windows)]
    {
        // (P-055) CTRL_BREAK_EVENT instead of an immediate TerminateProcess:
        // Node surfaces it as SIGBREAK, so serve.mjs's shutdown handler runs
        // and embedded PG gets a clean `pg_ctl stop`. The children are
        // spawned with CREATE_NEW_PROCESS_GROUP (isolate_process_group) so
        // the event targets exactly that child's group, not ours. Honest
        // limit (not runtime-verified on Windows): the event only reaches
        // processes sharing a console with us, so from a console-less GUI
        // launch it may reach nobody — then the grace below lapses and the
        // TerminateProcess fallback fires, which is the old behavior.
        use windows::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT};
        if unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid) }.is_err() {
            eprintln!(
                "[papercusp-desktop] {} pid={}: CTRL_BREAK_EVENT not deliverable — relying on the hard-kill fallback",
                label, pid
            );
        }
    }
    // Poll for exit up to grace_ms.
    let deadline = Instant::now() + Duration::from_millis(grace_ms);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_status)) => return,
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    // Grace expired — escalate to a hard kill (SIGKILL / TerminateProcess).
    println!(
        "[papercusp-desktop] {} pid={} still alive after grace, hard kill",
        label, pid
    );
    #[cfg(unix)]
    {
        // Same group-vs-pid widening as the TERM stage above: a grandchild
        // that outlived the soft signal (or joined the group after it) still
        // needs to go down here, not just the direct child `child.kill()`
        // below reaches.
        let _ = Command::new("kill")
            .arg("-KILL")
            .arg(format!("-{pid}"))
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Kill the native sibling terminal (if any) on shutdown. `try_state` so it's
/// a no-op when the terminal was never managed (headless / opted out).
fn shutdown_native_terminal(app_handle: &tauri::AppHandle) {
    if let Some(nt) = app_handle.try_state::<native_terminal::NativeTerminal>() {
        nt.shutdown();
    }
}

/// The four outcomes `sweep_stale_operator_orphan` can reach, factored out as
/// a PURE decision (no OS calls) so it's unit-testable without a live process
/// table / network. `sweep_stale_operator_orphan` is the thin OS-facing
/// wrapper that gathers the three inputs and acts on the verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OrphanSweepDecision {
    /// No operator.json — first boot ever, or a previous instance shut down
    /// cleanly and removed it. Nothing to sweep.
    NothingRecorded,
    /// operator.json named a pid, but it's already gone at the OS level.
    /// Nothing to kill; the fresh spawn below will overwrite the stale file.
    AlreadyDead,
    /// The pid is alive AND HTTP-responsive — this IS the healthy
    /// `serve --ensure` "Decision C" reuse case (SP1 C5): a still-running,
    /// currently-serving operator from either this boot or a still-alive
    /// prior one. Must NEVER be touched.
    HealthyReuse,
    /// The pid is alive but NOT HTTP-responsive — a genuinely wedged/zombie
    /// leftover (the actual WI-3633 bug case): its own parent-death watch
    /// either never installed (older build) or never ran (crashed before
    /// install), so it never self-terminated on reparenting. Sweep it.
    StaleKill,
}

fn decide_orphan_sweep(
    discovery: Option<&OperatorDiscovery>,
    pid_alive: bool,
    http_ready: bool,
) -> OrphanSweepDecision {
    if discovery.is_none() {
        return OrphanSweepDecision::NothingRecorded;
    }
    if !pid_alive {
        return OrphanSweepDecision::AlreadyDead;
    }
    if http_ready {
        return OrphanSweepDecision::HealthyReuse;
    }
    OrphanSweepDecision::StaleKill
}

/// (EI-8894/WI-3633 leg 2) Boot-time orphan sweep for the workspace's tracked
/// operator, run once right before we spawn our own fresh sidecar. Belt-and-
/// suspenders alongside the parent-death self-exit watch in serve.ts (which
/// only self-terminates a sidecar that is itself still alive and polling its
/// own ppid): this catches the case that watch missed — a wedged/zombie
/// leftover from a hard-killed prior Server (`launchctl kickstart -k`,
/// `pkill -9`, a crash) that skipped both our own SIGTERM path AND (an older
/// build, or a crash before the watch installed) its own self-exit watch —
/// so a relaunch doesn't leave it running invisibly forever alongside the new
/// one, fighting over the port / embedded-PG data-dir lock / stale env.
///
/// Deliberately does NOT do a broad process-table scan for any `serve.mjs`.
/// Live macOS verification (2026-07-09, papercup-vm-mac) found MULTIPLE
/// legitimately-running `serve.mjs` processes at once — the tracked operator
/// PLUS a per-env `env-sidecars/staging/serve.mjs` — and BOTH correctly show
/// PPID==1, because on macOS a launchd/login-item-launched process (this
/// Server app itself, and by extension any child that outlives its original
/// spawning instance) NORMALLY reparents to launchd; PPID==1 is NOT itself an
/// orphan signal on this platform the way it would be under a shell/systemd.
/// A blind "PPID==1 + serve.mjs" match would have KILLED a live, in-use,
/// currently-reused operator (`serve --ensure`'s "Decision C" reuse — SP1
/// C5), a real regression this live check caught before it shipped. Scoping
/// to exactly the ONE pid `operator.json` names — the SAME discovery record
/// `wait_for_operator`/Decision-C reuse already trust — and requiring it to
/// FAIL an HTTP health probe (`operator_http_ready`, the same one
/// `wait_for_operator` uses) before touching it, makes this sweep structurally
/// unable to ever kill a healthy, in-use operator: `decide_orphan_sweep`
/// only reaches `StaleKill` when the pid is alive but NOT serving.
fn sweep_stale_operator_orphan(workspace_home: &std::path::Path, via_wsl: bool) {
    let discovery = find_operator_discovery(workspace_home, via_wsl);
    let pid_alive = discovery
        .as_ref()
        .is_some_and(|d| discovery_pid_alive(d.pid, via_wsl));
    let http_ready = discovery.as_ref().is_some_and(|d| operator_http_ready(d.port));
    match decide_orphan_sweep(discovery.as_ref(), pid_alive, http_ready) {
        OrphanSweepDecision::NothingRecorded | OrphanSweepDecision::AlreadyDead => {}
        OrphanSweepDecision::HealthyReuse => {
            println!(
                "[papercusp-server] boot orphan sweep: operator.json pid={} is alive + HTTP-responsive — healthy reuse, leaving it running",
                discovery.as_ref().map(|d| d.pid).unwrap_or(0)
            );
        }
        OrphanSweepDecision::StaleKill => {
            let d = discovery.expect("StaleKill only reached with Some(discovery)");
            println!(
                "[papercusp-server] boot orphan sweep: operator.json pid={} port={} is alive but NOT HTTP-responsive — stale orphan, killing its process group",
                d.pid, d.port
            );
            #[cfg(unix)]
            {
                let _ = Command::new("kill")
                    .arg("-TERM")
                    .arg(format!("-{}", d.pid))
                    .status();
                let deadline = Instant::now() + Duration::from_millis(3000);
                while Instant::now() < deadline && discovery_pid_alive(d.pid, via_wsl) {
                    std::thread::sleep(Duration::from_millis(150));
                }
                let _ = Command::new("kill")
                    .arg("-KILL")
                    .arg(format!("-{}", d.pid))
                    .status();
            }
            #[cfg(not(unix))]
            {
                // Windows: the tracked pid may be the WSL-side Linux pid, which
                // has no POSIX process-group kill available from here. Out of
                // scope for this Unix-focused leg (WI-3633 is macOS-scoped);
                // the existing wsl_graceful_stop_serve / TerminateProcess paths
                // still run on the NEXT owned-child teardown either way.
                let _ = d;
            }
        }
    }
}

#[cfg(test)]
mod orphan_sweep_decision_tests {
    use super::{decide_orphan_sweep, OperatorDiscovery, OrphanSweepDecision};

    fn disc() -> OperatorDiscovery {
        OperatorDiscovery { port: 3070, pid: 4242 }
    }

    #[test]
    fn no_discovery_file_is_nothing_recorded() {
        assert_eq!(
            decide_orphan_sweep(None, false, false),
            OrphanSweepDecision::NothingRecorded
        );
        // pid_alive/http_ready are meaningless without a discovery record —
        // NothingRecorded wins regardless of what they'd say.
        assert_eq!(
            decide_orphan_sweep(None, true, true),
            OrphanSweepDecision::NothingRecorded
        );
    }

    #[test]
    fn dead_pid_is_already_dead_never_killed() {
        let d = disc();
        assert_eq!(
            decide_orphan_sweep(Some(&d), false, false),
            OrphanSweepDecision::AlreadyDead
        );
        // Even a (nonsensical) http_ready:true with a dead pid stays AlreadyDead
        // — pid liveness gates before the HTTP check ever matters.
        assert_eq!(
            decide_orphan_sweep(Some(&d), false, true),
            OrphanSweepDecision::AlreadyDead
        );
    }

    #[test]
    fn alive_and_responsive_is_healthy_reuse_never_killed() {
        // The exact "Decision C" live-reuse case live macOS verification
        // found — MUST NOT be swept.
        let d = disc();
        assert_eq!(
            decide_orphan_sweep(Some(&d), true, true),
            OrphanSweepDecision::HealthyReuse
        );
    }

    #[test]
    fn alive_but_unresponsive_is_the_only_kill_case() {
        let d = disc();
        assert_eq!(
            decide_orphan_sweep(Some(&d), true, false),
            OrphanSweepDecision::StaleKill
        );
    }
}

/// Take ownership of the sidecar Child (if any) and kill it.
///
/// This is a function rather than inline so the temporary MutexGuard from
/// `state.child.lock()` is dropped before the borrow of `state` ends —
/// inlining triggered borrow-checker E0597 in Rust 2021 because the guard
/// outlived the local `state` binding.
///
/// (SP1 C5) The serve child owns embedded-PG in-process: SIGTERM triggers
/// serve's own shutdown handler (close host → remove operator.json →
/// pg.stop() → release cold-start lock), so it gets a longer grace than the
/// old bare sidecar before the SIGKILL fallback. When `serve --ensure`
/// REUSED a foreign operator, `state.child` holds the (already-exited)
/// ensure process — killing it is a no-op and the reused operator keeps
/// running, which is the intended singleton semantics (Decision C).
///
/// Each stage uses graceful_kill (SIGTERM with grace, then SIGKILL) so Node
/// intermediates can reap their own grandchildren — see graceful_kill's doc
/// comment for why this matters.
fn kill_sidecar(app_handle: &tauri::AppHandle) {
    let state: tauri::State<SidecarState> = app_handle.state();
    let maybe_child = state.child.lock().unwrap().take();
    if let Some(mut child) = maybe_child {
        // WSL-routed serve: the Child is only the wsl.exe RELAY. No Windows
        // console signal reaches the Linux-side node (CTRL_BREAK needs a
        // shared console; a GUI launch has none), so graceful_kill's soft
        // stage always lapsed into TerminateProcess on the relay — serve
        // never ran its shutdown handler and embedded PG was left needing
        // WAL recovery every boot (observed live 2026-06-11, P-010e).
        // Instead, SIGTERM the Linux pid (from the distro-side
        // operator.json) through wsl.exe itself. Only when we OWN a live
        // relay — an already-exited child means `--ensure` reused a foreign
        // operator that must keep running (Decision C).
        #[cfg(target_os = "windows")]
        let wsl_stopped = matches!(child.try_wait(), Ok(None))
            && wsl_setup::detect_ready_cached()
            && wsl_graceful_stop_serve(8000);
        #[cfg(not(target_os = "windows"))]
        let wsl_stopped = false;
        if wsl_stopped {
            // serve is down (host closed, operator.json removed, pg_ctl
            // stopped); the relay exits by itself — give it a beat, then
            // make sure it's reaped.
            let deadline = Instant::now() + Duration::from_millis(2000);
            while Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                    Err(_) => break,
                }
            }
            let _ = child.kill();
            let _ = child.wait();
            println!("[papercusp-desktop] serve stopped cleanly inside WSL (pg_ctl stop ran)");
        } else {
            graceful_kill(&mut child, "serve (operator + embedded-PG)", 8000);
        }
    }
}

/// Soft-stop the WSL-side serve: read its LINUX pid from the distro-side
/// operator.json, SIGTERM it inside the distro, and wait up to `grace_ms`
/// for the pid to vanish (serve's SIGTERM handler closes the host, removes
/// operator.json, `pg_ctl stop`s embedded PG and releases the cold-start
/// lock). Returns true only when the pid is confirmed gone — any failure
/// falls back to the caller's relay-kill path.
#[cfg(target_os = "windows")]
fn wsl_graceful_stop_serve(grace_ms: u64) -> bool {
    // Read the distro-side operator.json via `wsl.exe cat` — the same robust
    // path find_operator_discovery uses. (Was read via the \\wsl.localhost UNC
    // share, which is unreliable on the VM, so this graceful-stop silently
    // failed and always fell back to the caller's relay-kill.)
    let Some(d) = read_operator_discovery_via_wsl() else {
        return false;
    };
    println!(
        "[papercusp-desktop] terminating serve inside WSL (linux pid={}, SIGTERM, grace {grace_ms}ms)",
        d.pid
    );
    let sent = Command::new("wsl.exe")
        .args([
            "--distribution",
            wsl_setup::DISTRO_NAME_PUB,
            "--exec",
            "kill",
            "-TERM",
            &d.pid.to_string(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !sent {
        return false;
    }
    let deadline = Instant::now() + Duration::from_millis(grace_ms);
    while Instant::now() < deadline {
        if !discovery_pid_alive(d.pid, true) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    eprintln!(
        "[papercusp-desktop] serve (linux pid={}) still alive after grace — falling back to relay kill",
        d.pid
    );
    false
}

/// Run the exit teardown (native terminal + sidecar children) exactly once.
/// ExitRequested and Exit both arrive on a normal quit; the AtomicBool in
/// SidecarState gates every invocation after the first (P-051).
/// `install_update` still calls kill_sidecar directly — its children must
/// die before the binary swap — and the subsequent restart's Exit event
/// funnels through here for the terminal teardown.
fn shutdown_children_once(app_handle: &tauri::AppHandle) {
    let state: tauri::State<SidecarState> = app_handle.state();
    if state
        .shutdown_done
        .swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    shutdown_native_terminal(app_handle);
    kill_sidecar(app_handle);
}

fn main() {
    run();
}
