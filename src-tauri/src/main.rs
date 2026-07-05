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
// protocol, window management, PTY, workspace HOME isolation, the update
// checker, and the bundled code-server spawn. Everything PG/operator
// process-management moved INTO serve.
//
// The same `serve.mjs` is what we'd run in a cloud container — no shell-out
// into platform-specific tooling here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_role;
mod custom_protocol;
mod dev_bridge;
// Global-hotkey docs-search palette (WI-2648, feature #5): CmdOrCtrl+K opens a
// small always-on-top window loading Pagefind's own default UI against the
// already-built operator-docs search index. Registered on every platform +
// role (unlike env_switch's dev-only backstop) — this is a real feature.
mod docs_search;
// Env-switch plumbing — the desktop-side source of truth + /api routing for the
// cross-platform in-webview EnvSwitcherBar and its native backstop. Replaces the
// retired Linux-only GTK dev-wrapper bar and the chrome-webview experiment.
// Compiled on every platform (list_envs is a registered command); it returns no
// envs in a packaged single-operator build, so it's inert there.
mod endpoint_ipc;
mod endpoint_ipc_framing;
mod env_switch;
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
    code_server_child: Mutex<Option<Child>>,
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

/// Spawn the bundled code-server (vscode-in-the-browser). The
/// @papercupai/vscode-server plugin iframes whatever URL its config
/// resolves to (default http://localhost:8082), so we bind the bundled
/// instance to a free local port, run with auth disabled (loopback-
/// only), and surface the URL via PAPERCUSP_CODE_SERVER_URL so the
/// operator's contributions resolver can use it as the default for
/// `iframeUrlConfigKey: codeServerUrl`.
///
/// Returns (child, url) on success, or None if the bundled binary is
/// missing (e.g. Windows builds, where upstream code-server doesn't
/// ship).
fn spawn_code_server(
    code_server_dir: &std::path::Path,
    workspace_home: &std::path::Path,
    user_data_dir: &std::path::Path,
) -> Option<(Child, String)> {
    let bin = if cfg!(windows) {
        code_server_dir.join("bin").join("code-server.cmd")
    } else {
        code_server_dir.join("bin").join("code-server")
    };
    if !bin.exists() {
        println!(
            "[papercusp-desktop] no bundled code-server at {} — vscode-server plugin will need an external install",
            bin.display()
        );
        return None;
    }
    let port = find_free_port()?;
    let bind = format!("127.0.0.1:{}", port);
    println!(
        "[papercusp-desktop] spawning code-server bin={} bind={}",
        bin.display(),
        bind
    );
    let workspace_home_str = workspace_home.to_string_lossy().to_string();
    let mut cmd = Command::new(&bin);
    cmd.arg("--bind-addr")
        .arg(&bind)
        .arg("--auth")
        .arg("none")
        .arg("--disable-telemetry")
        .arg("--disable-update-check")
        .arg("--user-data-dir")
        .arg(user_data_dir)
        .arg("--extensions-dir")
        .arg(user_data_dir.join("extensions"))
        .env("HOME", &workspace_home_str)
        .env("USERPROFILE", &workspace_home_str)
        .stdin(Stdio::null());
    // Same console-less-packaged-app hazard as serve (WI-1707/WI-1781): in a
    // release build there is NO console, so an inherited stdout/stderr is
    // /dev/null and every code-server diagnostic is lost — leaving a broken
    // vscode-server plugin undebuggable. Tee to a rotated on-disk log in release;
    // keep the inherited `tauri dev` console in debug. Fall back to inherit if the
    // log can't be prepared so logging never blocks code-server from launching.
    if cfg!(debug_assertions) {
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else if let Some((out, err)) = rotating_log_stdio(workspace_home, "code-server.log") {
        cmd.stdout(out).stderr(err);
    } else {
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    }
    isolate_process_group(&mut cmd);
    match cmd.spawn() {
        Ok(child) => Some((child, format!("http://127.0.0.1:{}", port))),
        Err(e) => {
            eprintln!("[papercusp-desktop] failed to spawn code-server: {}", e);
            None
        }
    }
}

fn find_free_port() -> Option<u16> {
    portpicker::pick_unused_port()
}

/// (P-055) Put a child in its own Windows process group so graceful_kill's
/// CTRL_BREAK_EVENT targets that child's group instead of ours (without
/// CREATE_NEW_PROCESS_GROUP the pid isn't a group id and the event would
/// fan out to our whole console group, including this process). No-op on
/// non-Windows.
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
    #[cfg(not(windows))]
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
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
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
        is_windows_pipe
    } else {
        !is_windows_pipe
    }
}

fn is_windows_named_pipe_path(socket_path: &str) -> bool {
    let lower = socket_path.to_ascii_lowercase();
    lower.starts_with("\\\\.\\pipe\\") || lower.starts_with("\\\\?\\pipe\\")
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

    // WI-1781: a second console-less sidecar (code-server) routes through the SAME
    // helper with a DIFFERENT basename. Its ring must rotate independently of
    // serve.log (no cross-contamination between the two sidecars' logs).
    #[cfg(target_os = "linux")]
    #[test]
    fn rotating_log_stdio_isolates_basenames() {
        use std::fs;
        let home = std::env::temp_dir().join(format!("pcusp-cs-log-{}", std::process::id()));
        let logs = home.join(".papercusp").join("logs");
        let _ = fs::remove_dir_all(&home);

        // serve.log gets one generation…
        assert!(super::rotating_log_stdio(&home, "serve.log").is_some());
        fs::write(logs.join("serve.log"), b"serve-A").unwrap();
        // …and code-server.log its own, created fresh alongside it.
        assert!(super::rotating_log_stdio(&home, "code-server.log").is_some());
        assert!(logs.join("code-server.log").exists());
        fs::write(logs.join("code-server.log"), b"cs-A").unwrap();

        // Rotating code-server.log must NOT touch serve.log's live file or ring.
        assert!(super::rotating_log_stdio(&home, "code-server.log").is_some());
        assert_eq!(fs::read(logs.join("code-server.log.1")).unwrap(), b"cs-A");
        assert!(
            !logs.join("serve.log.1").exists(),
            "serve.log ring untouched by code-server rotation"
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
    use super::{next_operator_port, parse_operator_discovery, OperatorDiscovery};

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
    #[test]
    fn supervision_healthy_when_process_alive() {
        assert_eq!(
            decide_server_supervision(true, false, 0, 10, 0, 5, false),
            A::Healthy
        );
        // …even if it was flapping a moment ago (dead_count carried in).
        assert_eq!(
            decide_server_supervision(true, false, 7, 10, 0, 5, false),
            A::Healthy
        );
    }

    // A dead Server inside its post-respawn boot grace must NOT be respawned
    // again (double-respawn during boot is the thing the grace prevents).
    #[test]
    fn supervision_waits_during_boot_grace() {
        assert_eq!(
            decide_server_supervision(false, true, 99, 10, 0, 5, false),
            A::Wait
        );
    }

    // Dead but not yet past the debounce → wait (a normal restart briefly looks
    // dead as the pid rolls over; don't respawn on a transient gap).
    #[test]
    fn supervision_waits_below_debounce_threshold() {
        assert_eq!(
            decide_server_supervision(false, false, 9, 10, 0, 5, false),
            A::Wait
        );
    }

    // Dead past the debounce, under the respawn cap → respawn. This is the core
    // WI-2667 recovery: SIGTERM force-exit left the Server gone, bring it back.
    #[test]
    fn supervision_respawns_when_dead_past_threshold() {
        assert_eq!(
            decide_server_supervision(false, false, 10, 10, 0, 5, false),
            A::Respawn
        );
        assert_eq!(
            decide_server_supervision(false, false, 10, 10, 4, 5, false),
            A::Respawn
        );
    }

    // Respawned too many times in the window → give up (a Server that truly
    // can't boot must not hot-loop `open -b` forever).
    #[test]
    fn supervision_gives_up_at_respawn_cap() {
        assert_eq!(
            decide_server_supervision(false, false, 10, 10, 5, 5, false),
            A::GiveUp
        );
    }

    // Once given up, the decision latches to Wait until the app restarts —
    // never Respawn/GiveUp again.
    #[test]
    fn supervision_latches_after_give_up() {
        assert_eq!(
            decide_server_supervision(false, false, 999, 10, 0, 5, true),
            A::Wait
        );
        // A live process while latched-off is still just Wait (no work to do).
        assert_eq!(
            decide_server_supervision(true, false, 0, 10, 0, 5, true),
            A::Wait
        );
    }

    // WI-2667 (defect-2 gap): the SERVER-side serve respawn decision. This is the
    // path the live Mac-VM E2E proved was missing — the operator died, the shell
    // lived, and nothing (GUI `open -b` no-ops on the live single instance) brought
    // it back. Same Linux-CI blind-spot rationale: the macOS respawn can't run here.
    use super::{decide_serve_respawn, ServeRespawnAction as R};

    // Child still running → nothing to do.
    #[test]
    fn serve_respawn_healthy_when_child_running() {
        assert_eq!(decide_serve_respawn(false, false, false, 0, 5), R::Healthy);
    }

    // Child exited but an operator is reachable anyway (`--ensure` reused a
    // foreign operator, Decision C) → do NOT double-spawn.
    #[test]
    fn serve_respawn_healthy_when_operator_reachable_despite_exit() {
        assert_eq!(decide_serve_respawn(true, false, true, 0, 5), R::Healthy);
    }

    // The core WI-2667 recovery: operator child exited, no operator reachable,
    // under the cap → respawn serve in-process (the case the VM E2E showed dead).
    #[test]
    fn serve_respawn_when_child_exited_and_unreachable() {
        assert_eq!(decide_serve_respawn(true, false, false, 0, 5), R::Respawn);
        assert_eq!(decide_serve_respawn(true, false, false, 4, 5), R::Respawn);
    }

    // Shutting down / self-updating → never resurrect the child we killed on
    // purpose — and that wins even past the respawn cap.
    #[test]
    fn serve_respawn_suppressed_when_shutting_down() {
        assert_eq!(decide_serve_respawn(true, true, false, 0, 5), R::Suppressed);
        assert_eq!(decide_serve_respawn(true, true, false, 9, 5), R::Suppressed);
    }

    // Respawned too many times in the window (crash-loop) → give up until restart.
    #[test]
    fn serve_respawn_gives_up_at_cap() {
        assert_eq!(decide_serve_respawn(true, false, false, 5, 5), R::GiveUp);
    }

    // WI-1878 / P-005: the operator-dead notification body must name WHICH
    // supervisor gave up and the exact attempt/window numbers, so a user (or a
    // later triager reading a bug report) can tell the two give-up paths apart.
    #[test]
    fn operator_dead_notification_body_names_reason_and_counts() {
        let body = super::operator_dead_notification_body("serve.mjs in-process respawn cap hit", 5, 300);
        assert!(body.contains("serve.mjs in-process respawn cap hit"));
        assert!(body.contains('5'));
        assert!(body.contains("300"));
    }
}

#[cfg(test)]
mod helper_tests {
    use super::{
        bundled_path_env, endpoint_ipc_socket_path_supported_for_target, read_dev_ipc_socket,
        read_dev_ipc_socket_for_port, url_encode,
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
    /// Dead past the debounce and under the respawn cap — relaunch the Server.
    Respawn,
    /// Respawned too many times in the window (crash-loop) — latch off and leave
    /// it to a manual restart rather than hot-looping `open -b` forever.
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
fn decide_server_supervision(
    process_alive: bool,
    in_boot_grace: bool,
    dead_count: u32,
    dead_threshold: u32,
    respawns_in_window: usize,
    max_respawns: usize,
    already_gave_up: bool,
) -> ServerSupervisionAction {
    if already_gave_up {
        // Latched: once we give up we stop respawning until the app restarts.
        return ServerSupervisionAction::Wait;
    }
    if process_alive {
        return ServerSupervisionAction::Healthy;
    }
    if in_boot_grace || dead_count < dead_threshold {
        return ServerSupervisionAction::Wait;
    }
    if respawns_in_window >= max_respawns {
        return ServerSupervisionAction::GiveUp;
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
    /// Child still running, or an operator is reachable anyway (a foreign
    /// operator `--ensure` reused — Decision C) — nothing to do.
    Healthy,
    /// App is quitting or self-updating — never resurrect the child we just
    /// killed on purpose.
    Suppressed,
    /// Child exited and no operator is reachable — respawn serve in-process.
    Respawn,
    /// Respawned too many times in the window (crash-loop) — stop until restart.
    GiveUp,
}

/// Pure respawn decision for the Server-side serve supervisor (WI-2667).
///   * `child_exited` — the stored serve `Child` has reaped (`try_wait` → Some).
///   * `shutting_down` — `SidecarState.shutdown_done` (normal quit) or an
///     in-flight self-update; suppresses respawn so we don't fight the teardown.
///   * `operator_reachable` — an operator answers discovery+TCP right now; guards
///     the Decision-C reuse case (child exited because `--ensure` handed off to a
///     foreign operator that is serving) so we never double-spawn.
fn decide_serve_respawn(
    child_exited: bool,
    shutting_down: bool,
    operator_reachable: bool,
    respawns_in_window: usize,
    max_respawns: usize,
) -> ServeRespawnAction {
    if shutting_down {
        return ServeRespawnAction::Suppressed;
    }
    if !child_exited || operator_reachable {
        return ServeRespawnAction::Healthy;
    }
    if respawns_in_window >= max_respawns {
        return ServeRespawnAction::GiveUp;
    }
    ServeRespawnAction::Respawn
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
/// supervisor-2026-07-04 P-005). Emitted exactly once per give-up latch (both
/// `decide_server_supervision` and `decide_serve_respawn` only return GiveUp
/// once — `already_gave_up`/`return` after — so this never floods the
/// webview). `reason` distinguishes which supervisor gave up, since the two
/// watchers cover different roles (GUI-side Server-bundle respawn vs. the
/// Server's own in-process serve.mjs child respawn).
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
        "Auto-restart gave up after {respawns} attempts in {window_secs}s ({reason}). Restart the app to recover."
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
fn notify_operator_dead(app_handle: &tauri::AppHandle, reason: &str, respawns: usize, window_secs: u64) {
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
        .body(operator_dead_notification_body(reason, respawns, window_secs))
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
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let latest = find_operator_discovery(&workspace_home, via_wsl);

            // --- WI-1869: follow the operator's port across restarts (unchanged) ---
            if let Some(new_port) = next_operator_port(applied_port, latest.as_ref()) {
                // Guard against a STALE operator.json whose port was reused by an
                // unrelated process: only follow a discovery whose pid is alive.
                let pid_alive = latest
                    .as_ref()
                    .map(|d| discovery_pid_alive(d.pid, via_wsl))
                    .unwrap_or(false);
                if pid_alive {
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
            match decide_server_supervision(
                process_alive,
                in_boot_grace,
                dead_count,
                DEAD_THRESHOLD_TICKS,
                respawn_times.len(),
                MAX_RESPAWNS_PER_WINDOW,
                gave_up,
            ) {
                ServerSupervisionAction::Healthy => consecutive_dead = 0,
                ServerSupervisionAction::Wait => consecutive_dead = dead_count,
                ServerSupervisionAction::Respawn => {
                    eprintln!(
                        "[papercusp-desktop] Papercusp Server unreachable ~{}s — respawning the Server bundle (WI-2667)",
                        (dead_count as u64) * 1500 / 1000
                    );
                    if let Err(e) = launch_bundle(SERVER_BUNDLE_ID, "Papercusp Server") {
                        eprintln!("[papercusp-desktop] Server respawn failed: {e}");
                    }
                    respawn_times.push(now);
                    consecutive_dead = 0;
                    grace_until = Some(now + POST_RESPAWN_GRACE);
                }
                ServerSupervisionAction::GiveUp => {
                    eprintln!(
                        "[papercusp-desktop] Papercusp Server respawn cap hit ({} in {}s) — the Server \
                         keeps dying; giving up auto-respawn until the app is restarted (WI-2667)",
                        MAX_RESPAWNS_PER_WINDOW,
                        RESPAWN_WINDOW.as_secs()
                    );
                    notify_operator_dead(
                        &app_handle,
                        "Server bundle respawn cap hit",
                        MAX_RESPAWNS_PER_WINDOW,
                        RESPAWN_WINDOW.as_secs(),
                    );
                    gave_up = true;
                }
            }
        }
    });
}

/// Liveness probe for a discovery-file pid (signal-0 equivalent: /proc on
/// Linux, `kill -0` elsewhere). Guards against a STALE operator.json whose
/// port has since been reused by an unrelated process.
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
            return cmd.status().map(|s| s.success()).unwrap_or(false);
        }
    }
    #[cfg(target_os = "linux")]
    {
        std::path::Path::new(&format!("/proc/{}", pid)).exists()
    }
    #[cfg(not(target_os = "linux"))]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

/// Poll operator.json until it names a live, reachable operator (pid alive +
/// TCP accept), the serve child dies, or the timeout lapses. This is the
/// embedder's whole boot wait: serve owns PG startup + migrations + host
/// boot internally, so first boot (initdb + full migration replay) can
/// legitimately take a while.
///
/// (P-053) Runs on the finish_boot worker thread — NEVER on the Tauri
/// setup/main thread, where this poll used to freeze the unpainted window
/// for up to 120s (macOS unresponsive-app watchdog risk).
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
            if discovery_pid_alive(d.pid, via_wsl)
                && std::net::TcpStream::connect(format!("127.0.0.1:{}", d.port)).is_ok()
            {
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
    Err(format!(
        "operator did not become ready within {}s (no live operator.json under {}/.papercusp). \
         Embedded-PG initdb/migrations are the usual first-boot suspects — check the serve logs.",
        timeout.as_secs(),
        workspace_home.display()
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
        Duration::from_secs(120),
    ) {
        Ok(d) => d,
        Err(reason) => {
            // WI-2749 part 1a: during Windows WSL onboarding the operator
            // legitimately isn't up yet — WSL install + rootfs import +
            // `/opt/papercup/bootstrap` + PG initdb/migrations routinely exceed
            // this 120s wait, and the Server's post-onboarding finalize restart
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
                    "[papercusp-desktop] operator not up within 120s but WSL onboarding is still in progress — not a boot failure; deferring to the onboarding gate + the post-onboarding restart ({})",
                    reason
                );
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
        let disc = workspace_home.join(".papercusp/endpoint-ipc.json");
        let disc_src = disc.clone();
        let handle = endpoint_ipc::IpcClientHandle::new(move || {
            read_dev_ipc_socket(&disc_src).map(std::path::PathBuf::from)
        });
        app_handle.manage(handle.clone());
        let ipc_app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            for _ in 0..120 {
                if handle.warm().await.is_ok() {
                    println!("[papercusp-desktop] endpoint-ipc client connected (discovery file)");
                    if let Some(path) = read_dev_ipc_socket(&disc) {
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
/// GUI, tauri.server.conf.json → Server).
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
/// operator + code-server, all inside `serve.mjs --ensure`) MINUS the tray + the
/// respawn supervisor — so a single `apt install ./papercusp.deb` (or the
/// AppImage) is fully self-contained on a fresh machine, with no separately
/// installed "Papercusp Server" bundle required. The `serve.mjs` child is stored
/// in `SidecarState.child` so the ordinary GUI quit path (`kill_sidecar`) shuts
/// embedded-PG + the operator down gracefully instead of orphaning postgres.
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

    // Bundled code-server for the vscode-server iframe — optional + None-safe
    // (mirrors the Server-role boot). A missing binary just disables that panel.
    let code_server_url: Option<String> = {
        let cs_dir = sidecar_dir.join("code-server");
        let user_data_dir = shared_state_dir.join("code-server");
        let _ = std::fs::create_dir_all(&user_data_dir);
        match spawn_code_server(&cs_dir, workspace_home, &user_data_dir) {
            Some((child, url)) => {
                if let Some(state) = app_handle.try_state::<SidecarState>() {
                    *state.code_server_child.lock().unwrap() = Some(child);
                }
                println!("[papercusp-gui] code-server ready at {url}");
                Some(url)
            }
            None => None,
        }
    };

    let child = spawn_serve(
        via_wsl,
        port,
        &sidecar_dir,
        pg_port_hint,
        &shared_state_dir,
        workspace_home,
        code_server_url.as_deref(),
    )?;

    if let Some(state) = app_handle.try_state::<SidecarState>() {
        *state.child.lock().unwrap() = Some(child);
        *state.port.lock().unwrap() = Some(port);
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

/// The "Docs search shortcut" submenu: one checkable item per preset, the
/// active accelerator (docs_search::current_shortcut) checked. Rebuilt after
/// each rebind so the checkmark tracks the live selection.
fn build_docs_shortcut_submenu(
    app: &tauri::AppHandle,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    use tauri::menu::{CheckMenuItem, IsMenuItem, Submenu};
    let current = docs_search::current_shortcut();
    let items: Vec<CheckMenuItem<tauri::Wry>> = docs_search::PRESET_SHORTCUTS
        .iter()
        .map(|accel| {
            CheckMenuItem::with_id(
                app,
                format!("{DOCS_SHORTCUT_MENU_PREFIX}{accel}"),
                *accel,
                true,
                current.as_str() == *accel,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|i| i as &dyn IsMenuItem<tauri::Wry>)
        .collect();
    Submenu::with_items(app, "Docs search shortcut", true, &refs)
}

/// Build the full Server tray menu: Open · Docs search shortcut ▸ · — · Quit.
/// Factored out so the menu-event handler can rebuild it after a rebind.
fn build_server_tray_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let open = MenuItem::with_id(app, "open-gui", "Open Papercusp", true, None::<&str>)?;
    let shortcut = build_docs_shortcut_submenu(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(
        app,
        "quit-server",
        "Quit Papercusp Server",
        true,
        None::<&str>,
    )?;
    Menu::with_items(app, &[&open, &shortcut, &sep, &quit])
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
            } else if id == "quit-server" {
                app.exit(0);
            } else if let Some(accel) = id.strip_prefix(DOCS_SHORTCUT_MENU_PREFIX) {
                // Rebind the docs-search global shortcut live, then rebuild the
                // tray menu so the checkmark tracks the new selection.
                match docs_search::rebind_shortcut(app, accel) {
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
                        eprintln!("[papercusp-server] docs-search rebind to {accel} failed: {e}")
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
/// `basename` is the log file name (e.g. `serve.log`, `code-server.log`) so every
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
/// WI-1707 pointed the CHILD sidecars' (serve / code-server) stdio at on-disk
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
fn spawn_serve(
    via_wsl: bool,
    port_hint: u16,
    sidecar_dir: &std::path::Path,
    pg_port_hint: u16,
    shared_state_dir: &std::path::Path,
    workspace_home: &std::path::Path,
    code_server_url: Option<&str>,
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
        cmd.env(
            "WSLENV",
            "PORT:HOSTNAME:NODE_ENV:PAPERCUSP_BUILD_SHA:PAPERCUSP_BUILD_VERSION:PAPERCUSP_HARNESS_DIR/p:\
             PAPERCUSP_DESKTOP:PAPERCUSP_SHARED_OPERATOR:PAPERCUSP_OPERATOR_BASE:HOME/p:USERPROFILE/p:\
             PAPERCUSP_USE_EMBEDDED_PG:PAPERCUSP_PG_PORT:PAPERCUSP_PG_DATA_DIR:\
             PAPERCUSP_PG_SQL_DIR/p:PAPERCUSP_PG_SEED_PATH/p:PAPERCUSP_IDENTITY_DIR/p:PAPERCUSP_ANNOUNCE_IDENTITY_CACHE/p:\
             PAPERCUSP_HONO_PORT:PAPERCUSP_BIND_HOST:\
             PAPERCUSP_SERVE_UI:PAPERCUSP_DBOS_ENABLE:PAPERCUSP_DBOS_ROUTINES:\
             PAPERCUSP_DBOS_ORCHESTRATOR:HARNESS_DATABASE_URL:HARNESS_ADMIN_DATABASE_URL:\
             PAPERCUSP_CODE_SERVER_URL:PAPERCUSP_SPA_DIST/p:PAPERCUSP_DOCS_ROOT/p:\
             PAPERCUSP_PROMPTS_DIR/p:PAPERCUSP_SEED_DIR/p:PAPERCUSP_SIDECAR_BIN/p",
        );
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
        // The desktop webview consumes the SPA — keep the UI mounted (serve
        // alone defaults it OFF for headless use; Decision E).
        .env("PAPERCUSP_SERVE_UI", "1")
        .env(
            "PAPERCUSP_HARNESS_DIR",
            harness_dir.to_string_lossy().to_string(),
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
        .env(
            "PAPERCUSP_SEED_DIR",
            seed_dir.to_string_lossy().to_string(),
        )
        // Pre-migrated seed archive (first-boot fast path). Safe to set even when
        // the file is absent — serve existsSync-checks it and falls back to initdb.
        .env(
            "PAPERCUSP_PG_SEED_PATH",
            db_seed_path.to_string_lossy().to_string(),
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

    // Surface the bundled code-server URL so the operator's contributions
    // resolver can use it as the iframe default for @papercupai/vscode-server.
    if let Some(url) = code_server_url {
        cmd.env("PAPERCUSP_CODE_SERVER_URL", url);
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
    Ok(format!(
        "http://127.0.0.1:{}/api/updates/manifest?target={{{{target}}}}&arch={{{{arch}}}}&current_version={{{{current_version}}}}",
        port
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
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            current_version: current,
            new_version: None,
            notes: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
#[specta::specta]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
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

    // Kill children before the binary swap so they don't outlive the parent.
    // WI-2667: flag teardown FIRST so the Server-side serve supervisor sees
    // `shutdown_done` and does NOT respawn the operator we're about to swap out
    // from under (the app restarts immediately after the install).
    {
        let state: tauri::State<SidecarState> = app.state();
        state
            .shutdown_done
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
    kill_sidecar(&app);

    update
        .download_and_install(|_chunk, _total| {}, || {})
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
            std::env::set_var("PATH", format!("{}:{}", bin.display(), cur));
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
                    let embedded = match (win.gtk_window(), win.default_vbox()) {
                        (Ok(gtk_win), Ok(vbox)) => native_terminal::vte_embed::embed_into_window(
                            &gtk_win,
                            &vbox,
                            &spec.command,
                            cfg.side,
                            cfg.fraction,
                            &spec.background,
                        ),
                        _ => Err("no gtk window / default vbox".to_string()),
                    };
                    match embedded {
                        Ok(()) => println!("[papercusp-desktop] native-terminal: VTE view embedded"),
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
                    let embedded = match win2.ns_window() {
                        Ok(ns) => native_terminal::swiftterm_embed::embed_into_window(
                            ns as *mut std::ffi::c_void,
                            &spec.command,
                            cfg.fraction,
                            cfg.min_px,
                            cfg.max_px,
                        ),
                        Err(e) => Err(format!("no ns_window: {e}")),
                    };
                    match embedded {
                        Ok(()) => {
                            println!("[papercusp-desktop] native-terminal: SwiftTerm view embedded")
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
                match native_terminal::win_embed::embed_into_window(
                    hwnd_addr as *mut std::ffi::c_void,
                    &spec.command,
                    cfg.fraction,
                    cfg.min_px,
                    cfg.max_px,
                ) {
                    Ok(pid) => println!(
                        "[papercusp-desktop] native-terminal: ConPTY console embedded (pid={pid})"
                    ),
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
    app.manage(native_terminal::NativeTerminal::new(strategy));

    // The main window must exist before we launch (the glue resolves it by pid).
    if app.get_webview_window("main").is_none() {
        return;
    }

    // The glue loop (run_glue_loop) owns the move/resize tracking, so there's no
    // per-window-event hook to register here.
    start_native_terminal(app.handle());
}

pub fn run() {
    // WebKitGTK's DMA-BUF renderer produces stale-tile artifacts on the NVIDIA
    // proprietary driver (ghost fragments of other surfaces composited into the
    // webview — webkit#262607, tauri#9394/#14924; seen live on the dev box with
    // webkit2gtk 2.52 + driver 580). Must be set before any webview exists; an
    // explicit user value wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let state = SidecarState {
        child: Mutex::new(None),
        code_server_child: Mutex::new(None),
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
            println!(
                "[papercusp-desktop] role={} (identifier {})",
                role.label(),
                app.config().identifier
            );
            let is_dev = cfg!(debug_assertions);

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
            // operator-side from the job's workspace). The embedded-PG +
            // code-server data live in a SHARED dir (`shared_data_dir`), NOT
            // under any one workspace, because the DB is a single RLS-scoped
            // instance for all workspaces (D-006). `ensure_initialized()` still
            // runs the first-launch ~/.papercusp migration + provisions each
            // per-workspace dir's credentials, so the per-spawn HOME flip has
            // populated credential homes to point at.
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

            // Spawn the bundled code-server so the @papercupai/vscode-server
            // plugin's iframe has something to point at without the user
            // having to install code-server separately. URL is surfaced to
            // the sidecar via PAPERCUSP_CODE_SERVER_URL.
            let code_server_url: Option<String> = {
                let cs_dir = sidecar_dir.join("code-server");
                let user_data_dir = shared_state_dir.join("code-server");
                let _ = std::fs::create_dir_all(&user_data_dir);
                match spawn_code_server(&cs_dir, &workspace_home, &user_data_dir) {
                    Some((child, url)) => {
                        let state: tauri::State<SidecarState> = app.state();
                        *state.code_server_child.lock().unwrap() = Some(child);
                        println!("[papercusp-desktop] code-server ready at {}", url);
                        Some(url)
                    }
                    None => None,
                }
            };

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

            #[cfg(target_os = "windows")]
            {
                let status = wsl_setup::detect(&app.handle());
                if !matches!(status.state, wsl_setup::WslState::Ready) {
                    println!(
                        "[papercusp-desktop] WSL not Ready — deferring sidecar spawn until onboarding finishes (detect: {:?})",
                        status
                    );
                    // Reload-proof finalize watcher: the gate requests the
                    // post-onboarding restart only when ITS page observed the
                    // PendingBootstrap→Ready transition — a ref that any
                    // document reload wipes (the sync-connectivity recovery
                    // reload landed mid-bootstrap on the first strict clean
                    // pass and stranded the user on a Ready-but-no-sidecar
                    // app, found live 2026-06-11). Watch from the SHELL
                    // instead: when detect() flips Ready, run the same
                    // finalize (breakaway restart). wsl_finalize_ready's
                    // atomic guard makes gate+watcher double-fire safe.
                    let watcher_handle = app.handle().clone();
                    std::thread::spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_secs(10));
                        let status = wsl_setup::detect(&watcher_handle);
                        if matches!(status.state, wsl_setup::WslState::Ready) {
                            println!(
                                "[papercusp-desktop] WSL became Ready post-boot — restarting to spawn the sidecar"
                            );
                            let _ = wsl_setup::wsl_finalize_ready(watcher_handle.clone());
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
            let serve_child = match spawn_serve(
                via_wsl,
                port,
                &sidecar_dir,
                pg_port_hint,
                &shared_state_dir,
                &workspace_home,
                code_server_url.as_deref(),
            ) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[papercusp-desktop] failed to spawn serve: {}", e);
                    return Ok(());
                }
            };

            let state: tauri::State<SidecarState> = app.state();
            *state.child.lock().unwrap() = Some(serve_child);

            // WI-2667 (defect-2 gap fix): supervise our OWN serve.mjs child. The
            // GUI-side watcher's `open -b` CANNOT revive an operator that died
            // while this Server shell is still alive (single-instance dedupes the
            // launch → no-op), and nothing else reaps/restarts it — proved live on
            // the Mac VM 2026-07-04 (SIGTERM the operator → 100s, zero recovery, an
            // unreaped zombie). So the Server watches its child: `try_wait` REAPS
            // the zombie AND detects the exit, and we respawn serve in-process
            // (covers the headless-Server-no-GUI case too). Guards: `shutdown_done`
            // (normal quit / self-update — don't fight the teardown), an
            // operator-reachability check (don't double-spawn when `--ensure`
            // reused a foreign operator, Decision C), and a crash-loop cap.
            {
                const RESPAWN_WINDOW: Duration = Duration::from_secs(300);
                const MAX_RESPAWNS_PER_WINDOW: usize = 5;
                let sup_handle = app.handle().clone();
                let sup_via_wsl = via_wsl;
                let sup_port = port;
                let sup_pg_hint = pg_port_hint;
                let sup_sidecar = sidecar_dir.clone();
                let sup_shared = shared_state_dir.clone();
                let sup_home = workspace_home.clone();
                let sup_code_url = code_server_url.clone();
                std::thread::spawn(move || {
                    let mut respawn_times: Vec<Instant> = Vec::new();
                    loop {
                        std::thread::sleep(Duration::from_millis(1500));
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
                        let operator_reachable = wait_for_operator(
                            &sup_handle,
                            &sup_home,
                            sup_via_wsl,
                            Duration::from_millis(600),
                        )
                        .is_ok();
                        let now = Instant::now();
                        respawn_times.retain(|t| now.duration_since(*t) < RESPAWN_WINDOW);
                        match decide_serve_respawn(
                            child_exited,
                            shutting_down,
                            operator_reachable,
                            respawn_times.len(),
                            MAX_RESPAWNS_PER_WINDOW,
                        ) {
                            ServeRespawnAction::Healthy => {}
                            ServeRespawnAction::Suppressed => return,
                            ServeRespawnAction::GiveUp => {
                                eprintln!(
                                    "[papercusp-desktop] serve.mjs respawn cap hit ({} in {}s) — the \
                                     operator keeps dying; giving up in-process respawn until the app \
                                     restarts (WI-2667)",
                                    MAX_RESPAWNS_PER_WINDOW,
                                    RESPAWN_WINDOW.as_secs()
                                );
                                notify_operator_dead(
                                    &sup_handle,
                                    "serve.mjs in-process respawn cap hit",
                                    MAX_RESPAWNS_PER_WINDOW,
                                    RESPAWN_WINDOW.as_secs(),
                                );
                                return;
                            }
                            ServeRespawnAction::Respawn => {
                                eprintln!(
                                    "[papercusp-desktop] serve.mjs (operator) exited and no operator \
                                     is reachable — respawning it in-process (WI-2667)"
                                );
                                match spawn_serve(
                                    sup_via_wsl,
                                    sup_port,
                                    &sup_sidecar,
                                    sup_pg_hint,
                                    &sup_shared,
                                    &sup_home,
                                    sup_code_url.as_deref(),
                                ) {
                                    Ok(c) => {
                                        *state.child.lock().unwrap() = Some(c);
                                        respawn_times.push(now);
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[papercusp-desktop] serve.mjs respawn failed: {e}"
                                        );
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // WI-2648: the always-on Server owns the docs-search palette global
            // shortcut (CmdOrCtrl+K by default) — so it works whether or not the
            // GUI is open, and the tray's rebind control (below) is same-process.
            docs_search::register_shortcut(app);

            // Server role: tray/menubar presence + login auto-start. The
            // backend has no window, so the tray both keeps the app alive and
            // gives the user a place to open the GUI, change the docs-search
            // shortcut, or quit; auto-start means psu works right after login
            // without opening anything.
            if let Err(e) = install_server_tray(app) {
                eprintln!("[papercusp-desktop] tray install failed: {e}");
            }
            enable_login_autostart(app);

            // (P-053) setup() must NOT block on operator readiness — it runs
            // on the main thread before the event loop starts, so the old
            // 120s discovery poll here froze the still-unpainted window for
            // the whole first boot (initdb + full migration replay) and
            // risked the macOS unresponsive-app watchdog. finish_boot waits,
            // wires endpoint-IPC, and feeds the bootstrap page its base — or
            // a visible failure state — off-thread.
            let app_handle = app.handle().clone();
            let workspace_home_bg = workspace_home.clone();
            std::thread::spawn(move || finish_boot(app_handle, workspace_home_bg, via_wsl));

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
/// zero-cache (which manages a change-streamer child) and code-server.
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
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
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
    let maybe_cs = state.code_server_child.lock().unwrap().take();
    if let Some(mut child) = maybe_cs {
        graceful_kill(&mut child, "code-server", 2000);
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
