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

mod custom_protocol;
mod dev_bridge;
mod endpoint_ipc;
mod endpoint_ipc_framing;
mod native_console;
mod native_terminal;
mod pty;
mod workspaces;
mod wsl_setup;

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

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
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
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
    v.get("socketPath")?.as_str().map(|s| s.to_string())
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
    format!("{}{}{}", bundled_bin.to_string_lossy(), path_sep, existing_path)
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
        use webkit2gtk::WebViewExt;
        use webkit2gtk::glib::ObjectExt;
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
        if drive.len() == 1 && drive.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) {
            let drive_lower = drive.to_lowercase();
            // Ensure the rest starts with `/` (handles `C:foo` weirdly
            // by keeping it relative, though that's not a valid
            // Windows resource path in our context).
            let after = if after.starts_with('/') { after.to_string() } else { format!("/{}", after) };
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
            cmd.env("WSL_UTF8", "1")
                .args([
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

/// Parse `<home>/.papercusp/operator.json`, or None.
fn read_operator_discovery(workspace_home: &std::path::Path) -> Option<OperatorDiscovery> {
    let path = workspace_home.join(".papercusp/operator.json");
    let txt = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    let port = v.get("port")?.as_u64()? as u16;
    let pid = v.get("pid")?.as_u64()? as u32;
    if port == 0 || pid == 0 {
        return None;
    }
    Some(OperatorDiscovery { port, pid })
}

/// Liveness probe for a discovery-file pid (signal-0 equivalent: /proc on
/// Linux, `kill -0` elsewhere). Guards against a STALE operator.json whose
/// port has since been reused by an unrelated process.
fn discovery_pid_alive(pid: u32) -> bool {
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
/// TCP accept), or time out. This is the embedder's whole boot wait: serve
/// owns PG startup + migrations + host boot internally, so first boot
/// (initdb + full migration replay) can legitimately take a while.
fn wait_for_operator(
    workspace_home: &std::path::Path,
    timeout: Duration,
) -> Option<OperatorDiscovery> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Some(d) = read_operator_discovery(workspace_home) {
            if discovery_pid_alive(d.pid)
                && std::net::TcpStream::connect(format!("127.0.0.1:{}", d.port)).is_ok()
            {
                return Some(d);
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    None
}

/// Spawn the bundled `serve.mjs --ensure` (SP1 C5). serve owns embedded-PG +
/// the Hono host + the discovery files; this fn just assembles the desktop
/// environment for it:
///   - bundled PATH (node + vendored CLIs), workspace-HOME isolation
///   - the SPA/docs roots (desktop serves the UI: PAPERCUSP_SERVE_UI=1)
///   - PG knobs (picked port, shared data dir, bundled migrations dir)
///   - the cold-start port hint (PAPERCUSP_HONO_PORT)
/// stdout/stderr are inherited — boot progress + the smoke-harness grep
/// lines land in the desktop log. The endpoint-IPC handshake is NOT parsed
/// from stdout anymore; the discovery file (~/.papercusp/endpoint-ipc.json)
/// is the one channel that also covers the --ensure reuse case.
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
    let pg_data_dir = shared_state_dir.join("embedded-pg-data");

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
    if via_wsl {
        cmd.env(
            "WSLENV",
            "PATH/l:PORT:HOSTNAME:NODE_ENV:PAPERCUSP_HARNESS_DIR/p:\
             PAPERCUSP_DESKTOP:PAPERCUSP_SHARED_OPERATOR:PAPERCUSP_OPERATOR_BASE:HOME/p:USERPROFILE/p:\
             PAPERCUSP_USE_EMBEDDED_PG:PAPERCUSP_PG_PORT:PAPERCUSP_PG_DATA_DIR/p:\
             PAPERCUSP_PG_SQL_DIR/p:PAPERCUSP_HONO_PORT:PAPERCUSP_BIND_HOST:\
             PAPERCUSP_SERVE_UI:HARNESS_DATABASE_URL:HARNESS_ADMIN_DATABASE_URL:\
             PAPERCUSP_CODE_SERVER_URL:PAPERCUSP_SPA_DIST/p:PAPERCUSP_DOCS_ROOT/p:\
             PAPERCUSP_PROMPTS_DIR/p",
        );
    }
    cmd.env("PATH", &new_path)
        // serve reads PAPERCUSP_HONO_PORT (cold-start hint; reuse may differ).
        .env("PAPERCUSP_HONO_PORT", port_hint.to_string())
        .env("PAPERCUSP_BIND_HOST", "127.0.0.1")
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        // The desktop webview consumes the SPA — keep the UI mounted (serve
        // alone defaults it OFF for headless use; Decision E).
        .env("PAPERCUSP_SERVE_UI", "1")
        .env("PAPERCUSP_HARNESS_DIR", harness_dir.to_string_lossy().to_string())
        .env("PAPERCUSP_DESKTOP", "1")
        // Phase E (P-051): shared-operator model — per-spawn HOME comes from
        // each job's workspace, set operator-side.
        .env("PAPERCUSP_SHARED_OPERATOR", "1")
        // Descendants that need the operator's HTTP API (run.sh pg-status
        // helpers etc.) use this; the port is dynamic so env is the channel.
        .env("PAPERCUSP_OPERATOR_BASE", format!("http://localhost:{}", port_hint))
        // Hono host serves the Vite SPA + Starlight docs from these roots —
        // passed explicitly because a bundled file's __dirname is the sidecar
        // root (see host-spa.ts / host-docs.ts root-resolution comments).
        .env("PAPERCUSP_SPA_DIST", spa_dist.to_string_lossy().to_string())
        .env("PAPERCUSP_DOCS_ROOT", docs_root.to_string_lossy().to_string())
        // Persona/tools prompt root — explicit because the cwd heuristics in
        // prompt-assembly.ts misfire in the sidecar layout: sidecar/apps/
        // operator/prompts exists (desktop-install playbook only) and would
        // shadow the full sidecar/prompts copy (see promptsDir()).
        .env("PAPERCUSP_PROMPTS_DIR", prompts_dir.to_string_lossy().to_string())
        // PG knobs (SP1 C5: PG ownership moved into serve). The port is
        // freshly picked per spawn so two desktops on one host don't collide;
        // data lives in the SHARED state dir (one RLS-scoped PG for all
        // workspaces, D-006), migrations ship at sidecar/db-sql.
        .env("PAPERCUSP_PG_PORT", pg_port_hint.to_string())
        .env("PAPERCUSP_PG_DATA_DIR", pg_data_dir.to_string_lossy().to_string())
        .env("PAPERCUSP_PG_SQL_DIR", db_sql_dir.to_string_lossy().to_string())
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
    cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());

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
/// The operator route at `/api/updates/manifest` handles channel
/// resolution: query-param wins, then stored preference, then 'stable'.
/// Tauri substitutes `{{target}}`, `{{arch}}`, and `{{current_version}}`
/// when it issues the GET.
fn resolve_update_endpoint(app: &AppHandle) -> Result<String, String> {
    let port: u16 = if cfg!(debug_assertions) {
        // Dev: webview points at devUrl in tauri.conf.json (localhost:3055).
        // No sidecar process to read a port from.
        3055
    } else {
        let state: tauri::State<SidecarState> = app.state();
        let guard = state.port.lock().map_err(|e| e.to_string())?;
        guard
            .ok_or_else(|| "sidecar port not yet known; try again after boot completes".to_string())?
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
            format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or("localhost"), port)
        })
        .or_else(|| {
            let state: tauri::State<SidecarState> = app.state();
            let guard = state.port.lock().ok()?;
            (*guard).map(|p| format!("http://localhost:{}", p))
        })
        .ok_or_else(|| "could not resolve app origin (no main window URL, no sidecar port)".to_string())?;
    let url = format!("{}/harness?ws={}", base, url_encode(&id));
    let parsed = url
        .parse()
        .map_err(|e| format!("bad window url {}: {}", url, e))?;
    let win = tauri::WebviewWindowBuilder::new(&app, label.clone(), tauri::WebviewUrl::External(parsed))
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

/// Launch the native terminal per the resolved strategy. Shared by setup() and
/// the toggle command. For the glued path, the X11 window is resolved + first-
/// glued on a background thread so this never blocks.
fn start_native_terminal(app: &AppHandle) {
    use native_terminal::TerminalStrategy;
    let strategy = app.state::<native_terminal::NativeTerminal>().strategy;
    match strategy {
        TerminalStrategy::GluedGhosttyX11 => {
            if let Err(e) = app.state::<native_terminal::NativeTerminal>().launch_glued() {
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
                eprintln!("[papercusp-desktop] native-terminal: VTE embed main-thread hop failed: {e}");
            }
        }
        // D-009: the macOS embedded SwiftTerm view — a real native terminal
        // attached inside OUR window's content view via the dlopen'd
        // macos-term-shim (terminal left, webview shrunk right — P-014). Must
        // run on the AppKit main thread. Falls back to NewWindow on failure.
        #[cfg(target_os = "macos")]
        TerminalStrategy::EmbeddedView(native_terminal::EmbedBackend::SwiftTerm) => {
            let Some(window) = app.get_webview_window("main") else {
                eprintln!("[papercusp-desktop] native-terminal: no main window for the SwiftTerm embed");
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
                eprintln!("[papercusp-desktop] native-terminal: no main window for the ConPTY embed");
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
    let state = SidecarState {
        child: Mutex::new(None),
        code_server_child: Mutex::new(None),
        port: Mutex::new(None),
        endpoint_ipc_socket: Mutex::new(None),
    };

    // tauri-specta Builder — collects every #[specta::specta] command
    // and emits a typed `bindings.ts` for the frontend on each debug
    // build. The frontend imports typed wrappers from `@/bindings`
    // instead of stringly-typed `invoke('cmd', ...)`.
    let specta_builder = tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
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
            native_terminal_status,
            native_terminal_toggle,
            endpoint_ipc::endpoint_invoke,
            endpoint_ipc::endpoint_cancel,
            dev_bridge::__dev_bridge_result,
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

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

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
    let builder = if custom_protocol::enabled() {
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
            }
        })
        .setup(|app| {
            let is_dev = cfg!(debug_assertions);

            // Native sibling terminal — resolve strategy + launch the glued
            // (X11) / native terminal and register the glue hook, in both dev
            // and prod. Visual-only; the terminal coordinates via the substrate.
            init_native_terminal(app);

            if is_dev {
                // In dev mode we trust the developer to run the Next.js dev
                // server themselves on :3055 (devUrl in tauri.conf.json).
                println!("[papercusp-desktop] dev mode — skipping sidecar spawn (expecting :3055 to be served externally)");

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

                // Auto-open devtools so the developer can debug the
                // operator UI without hunting for keyboard shortcuts.
                // webkit2gtk on Linux doesn't always wire Ctrl+Shift+I
                // through reliably; opening from Rust is foolproof.
                if let Some(window) = app.get_webview_window("main") {
                    // Auto-open devtools only in debug — `open_devtools` is
                    // compiled out in release unless the tauri `devtools`
                    // feature is on (and we don't want devtools popping in a
                    // shipped/release build anyway).
                    #[cfg(debug_assertions)]
                    window.open_devtools();
                    // WebKitGTK denies getUserMedia by default; auto-grant
                    // so the operator's voice/wake-word/elevenlabs paths
                    // work without surfacing NotAllowedError on every load.
                    #[cfg(target_os = "linux")]
                    grant_media_permission(&window);
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
                    let disc = std::path::PathBuf::from(home).join(".papercusp/endpoint-ipc.json");
                    let disc_src = disc.clone();
                    let handle = endpoint_ipc::IpcClientHandle::new(move || {
                        read_dev_ipc_socket(&disc_src).map(std::path::PathBuf::from)
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

                return Ok(());
            }

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
            #[cfg(target_os = "windows")]
            {
                let need_wsl = !matches!(
                    wsl_setup::detect(&app.handle()).state,
                    wsl_setup::WslState::Ready
                );
                if need_wsl {
                    println!(
                        "[papercusp-desktop] WSL not Ready — deferring sidecar spawn until onboarding finishes"
                    );
                    return Ok(());
                }
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

            // Wait for serve's operator.json discovery (pid alive + TCP
            // accept). Generous timeout: a FIRST boot pays initdb + the full
            // migration replay inside serve before the host listens.
            let discovery = match wait_for_operator(&workspace_home, Duration::from_secs(120)) {
                Some(d) => d,
                None => {
                    eprintln!(
                        "[papercusp-desktop] FATAL: operator did not become ready within 120s \
                         (no live operator.json under {}/.papercusp). Check the serve logs above — \
                         embedded-PG initdb/migrations are the usual first-boot suspects.",
                        workspace_home.display()
                    );
                    return Ok(());
                }
            };
            // The REAL port comes from discovery — `serve --ensure` may have
            // reused an already-running operator on a different port than our
            // cold-start hint.
            let port = discovery.port;
            *state.port.lock().unwrap() = Some(port);
            println!(
                "[papercusp-desktop] operator ready on :{} (pid {})",
                port, discovery.pid
            );

            // Endpoint-IPC: runBootstrap inside serve starts the IPC server
            // and writes ~/.papercusp/endpoint-ipc.json (the discovery file
            // also covers the --ensure reuse case, where there is no fresh
            // child stdout to parse). Manage a reconnecting handle whose
            // socket source re-reads the file — same pattern as the dev
            // branch — and warm it in the background. If the socket never
            // appears, /api falls back to HTTP (ipcFetch polyfill).
            let ipc_enabled =
                std::env::var("PAPERCUSP_DESKTOP_IPC").ok().as_deref() != Some("0");
            if ipc_enabled {
                let disc = workspace_home.join(".papercusp/endpoint-ipc.json");
                let disc_src = disc.clone();
                let handle = endpoint_ipc::IpcClientHandle::new(move || {
                    read_dev_ipc_socket(&disc_src).map(std::path::PathBuf::from)
                });
                app.manage(handle.clone());
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    for _ in 0..120 {
                        if handle.warm().await.is_ok() {
                            println!("[papercusp-desktop] endpoint-ipc client connected (discovery file)");
                            if let Some(path) = read_dev_ipc_socket(&disc) {
                                let state: tauri::State<SidecarState> = app_handle.state();
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

            // Tell the bootstrap page where the sidecar is. The JS in
            // web/index.html will poll /api/desktop/preflight on that base,
            // render any missing-prereq UI, then navigate when ready.
            if let Some(window) = app.get_webview_window("main") {
                // Use 127.0.0.1, not localhost: WebKitGTK may resolve
                // `localhost` to ::1 while the sidecar binds IPv4 loopback,
                // which fails the bootstrap's preflight fetch.
                let base = format!("http://127.0.0.1:{}", port);
                // Phase 4: the bootstrap polls preflight over `base` (HTTP —
                // it's a transient pre-app page) but navigates the real app to
                // `app_base`. With the custom protocol on (default), that's
                // `papercusp://localhost`, so the operator SPA loads off HTTP;
                // with PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL=0 it's the HTTP `base`.
                let app_base = if custom_protocol::enabled() {
                    custom_protocol::APP_ORIGIN.to_string()
                } else {
                    base.clone()
                };
                // WebKitGTK denies getUserMedia by default; auto-grant
                // so voice / wake-word / elevenlabs work in the shipped
                // build the same way they do in browsers.
                #[cfg(target_os = "linux")]
                grant_media_permission(&window);
                // __PAPERCUSP_TAURI__ tells PiPanel to use the native pty
                // path (Tauri invoke + events) instead of the operator's
                // HTTP+WS bridge. See apps/operator/lib/pty-tauri.ts and
                // apps/operator/app/harness/PiPanel.tsx.
                //
                // setup() runs before the bootstrap page (frontendDist=../web)
                // has finished loading, so a single eval can land on a document
                // that the page-load then replaces, dropping __papercuspBase —
                // the bootstrap then polls for a port that never arrives. Re-eval
                // on a short timer so whichever document is live when the page is
                // ready receives the port. (web/index.html's tick() polls
                // window.__papercuspBase, so a late set is picked up.)
                let inject = format!(
                    "window.__papercuspBase = '{}'; window.__papercuspAppBase = '{}'; window.__PAPERCUSP_TAURI__ = {{ kind: 'native' }}; window.dispatchEvent(new CustomEvent('papercusp:base'));",
                    base, app_base
                );
                let win = window.clone();
                std::thread::spawn(move || {
                    for _ in 0..30 {
                        let _ = win.eval(&inject);
                        std::thread::sleep(std::time::Duration::from_millis(300));
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                shutdown_native_terminal(app_handle);
                kill_sidecar(app_handle);
            }
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { .. },
                ..
            } => {
                shutdown_native_terminal(app_handle);
                kill_sidecar(app_handle);
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
        "[papercusp-desktop] terminating {} pid={} (SIGTERM, grace {}ms)",
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
    #[cfg(not(unix))]
    {
        // On Windows there's no SIGTERM; std's kill() (which calls
        // TerminateProcess) is already abrupt, so just use it.
        let _ = child.kill();
        let _ = child.wait();
        return;
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
    // Grace expired — escalate to SIGKILL.
    println!(
        "[papercusp-desktop] {} pid={} still alive after grace, SIGKILL",
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
        graceful_kill(&mut child, "serve (operator + embedded-PG)", 8000);
    }
    let maybe_cs = state.code_server_child.lock().unwrap().take();
    if let Some(mut child) = maybe_cs {
        graceful_kill(&mut child, "code-server", 2000);
    }
}

fn main() {
    run();
}
