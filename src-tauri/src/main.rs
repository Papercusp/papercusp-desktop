// Papercusp desktop shell.
//
// Architecture:
//   1. On startup, find a free localhost port.
//   2. Spawn the Node sidecar (`apps/operator` running as `next start`)
//      with PORT set to that free port.
//   3. Wait for the sidecar to be reachable.
//   4. Open the main window pointing at http://localhost:<port>/.
//   5. On window-close, kill the sidecar.
//
// The same Node sidecar binary is what we'd run in a cloud container —
// no shell-out into platform-specific tooling here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pty;
mod workspaces;

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

/// Minimal RFC 3986 percent-encoding for the path component. Only the
/// reserved + unsafe set; we avoid pulling in a full url crate dep just
/// for this. Used to encode the pglite unix socket dir into the host
/// field of the postgres connection URL.
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
    child: Mutex<Option<Child>>,
    /// Either the embedded-postgres child (preferred) OR the legacy pglite
    /// child, whichever spawned. Single mutex covers both since only one
    /// runs per workspace.
    pglite_child: Mutex<Option<Child>>,
    code_server_child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
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

/// Spawn the bundled embedded-postgres-server (real PG with logical
/// replication). Returns the spawned child; caller is responsible for
/// waiting on the TCP port to come up via wait_for_pg_tcp.
fn spawn_embedded_postgres_server(
    pg_dir: &std::path::Path,
    data_dir: &std::path::Path,
    workspace_home: &std::path::Path,
    port: u16,
    db_sql_dir: &std::path::Path,
) -> std::io::Result<Child> {
    let bin = pg_dir.join("bin").join("embedded-postgres-server.mjs");
    println!(
        "[papercusp-desktop] spawning embedded-postgres-server bin={} port={} data={}",
        bin.display(),
        port,
        data_dir.display()
    );
    std::fs::create_dir_all(data_dir)?;
    let workspace_home_str = workspace_home.to_string_lossy().to_string();
    let mut cmd = Command::new("node");
    cmd.arg(&bin)
        .env("PAPERCUSP_PG_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PAPERCUSP_PG_PORT", port.to_string())
        .env("PAPERCUSP_PG_DB_NAME", "papercusp")
        .env("PAPERCUSP_PG_SQL_DIR", db_sql_dir.to_string_lossy().to_string())
        .env("HOME", &workspace_home_str)
        .env("USERPROFILE", &workspace_home_str)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    cmd.spawn()
}

/// Poll localhost:<port> until a TCP connect succeeds or timeout.
fn wait_for_pg_tcp(port: u16, timeout: Duration) -> bool {
    use std::net::TcpStream;
    let start = Instant::now();
    let addr = format!("127.0.0.1:{}", port);
    while start.elapsed() < timeout {
        if let Ok(s) = TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(500),
        ) {
            drop(s);
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

/// Spawn the bundled pglite-server. Returns the socket dir path on success.
/// pglite-server listens on a unix socket at `<socket_dir>/.s.PGSQL.5432`.
fn spawn_pglite_server(
    pglite_dir: &std::path::Path,
    socket_dir: &std::path::Path,
    data_dir: &std::path::Path,
    workspace_home: &std::path::Path,
    admin_port: Option<u16>,
) -> std::io::Result<Child> {
    let bin = pglite_dir.join("bin").join("pglite-server.mjs");
    println!(
        "[papercusp-desktop] spawning pglite-server bin={} socket={} data={}",
        bin.display(),
        socket_dir.display(),
        data_dir.display()
    );

    std::fs::create_dir_all(socket_dir)?;
    std::fs::create_dir_all(data_dir)?;

    // Point pglite-server at the bundled framework DDL so it bootstraps the
    // schema on first boot (idempotent — re-runs check for harness_shared
    // schema and skip if present).
    let db_sql_dir = pglite_dir.parent()
        .map(|p| p.join("db-sql"))
        .unwrap_or_else(|| std::path::PathBuf::from("./db-sql"));

    let workspace_home_str = workspace_home.to_string_lossy().to_string();

    let mut cmd = Command::new("node");
    cmd.arg(&bin)
        .env("PGLITE_SOCKET_DIR", socket_dir.to_string_lossy().to_string())
        .env("PGLITE_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PGLITE_DB_SQL_DIR", db_sql_dir.to_string_lossy().to_string())
        .env("HOME", &workspace_home_str)
        .env("USERPROFILE", &workspace_home_str)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    // Snapshot capture path: pglite-server exposes pgDump via a localhost
    // HTTP admin endpoint so the operator/CLI doesn't need a system pg_dump
    // binary. See @papercusp/export-state pglite-admin-client.ts.
    if let Some(port) = admin_port {
        cmd.env("PGLITE_ADMIN_PORT", port.to_string());
    }

    cmd.spawn()
}

fn wait_for_pglite_socket(socket_dir: &std::path::Path, timeout: Duration) -> bool {
    let start = Instant::now();
    let socket_path = socket_dir.join(".s.PGSQL.5432");
    while start.elapsed() < timeout {
        if socket_path.exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// Spawn the Node sidecar from inside the bundled sidecar dir. In dev
/// (`tauri dev`), we skip this — the developer runs `npm run dev:papercusp`
/// separately and the webview points at devUrl from tauri.conf.json.
fn spawn_sidecar(
    port: u16,
    sidecar_dir: &std::path::Path,
    pglite_socket_dir: Option<&std::path::Path>,
    // TCP port of the embedded-postgres-server (preferred path).
    pg_tcp_port: Option<u16>,
    workspace_home: &std::path::Path,
    code_server_url: Option<&str>,
    pglite_admin_port: Option<u16>,
) -> std::io::Result<Child> {
    println!("[papercusp-desktop] spawning sidecar on port {} from {}", port, sidecar_dir.display());

    // Next.js standalone bundle layout: sidecar/apps/operator/server.js
    // is the entry point, and it expects to be invoked with cwd = sidecar/
    // (so __dirname-relative .next paths resolve correctly).
    let server_js = sidecar_dir.join("apps").join("operator").join("server.js");
    let harness_dir = sidecar_dir.join("harness");

    // Per-workspace isolation: override HOME so the sidecar (and any child
    // process it spawns — claude CLI, git, pi, etc.) sees a workspace-scoped
    // home directory. ~/.papercusp/, ~/.claude/, ~/.gitconfig and so on all
    // resolve into <workspace_home>/, giving each workspace genuine
    // "fresh-machine" semantics. See workspaces.rs for the layout.
    let workspace_home_str = workspace_home.to_string_lossy().to_string();

    // Strip Node 22+'s partial localStorage stub via a --require preload
    // (see bin/sidecar-preload.js for full reasoning). We can't use the
    // --no-experimental-webstorage flag because Node 20 errors with
    // "bad option" and Node 22+ disallows it in NODE_OPTIONS. A JS
    // preload that does `delete globalThis.localStorage` is portable.
    // Prepend the bundled `bin/` dir (omp + any other vendored CLIs) to
    // PATH so child processes the sidecar spawns — Pi terminals, git,
    // claude — find them without the user having to install them
    // separately. The user's PATH is appended after, so system installs
    // still take precedence if they're earlier on PATH... actually no:
    // we *prepend*, so bundled binaries win. That's intentional: the
    // user gets the version we tested against.
    let bundled_bin = sidecar_dir.join("bin");
    let path_sep = if cfg!(windows) { ";" } else { ":" };
    let existing_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{}{}{}", bundled_bin.to_string_lossy(), path_sep, existing_path);

    let preload = sidecar_dir.join("sidecar-preload.js");
    let mut cmd = Command::new("node");
    cmd.arg("--require")
        .arg(&preload)
        .arg(&server_js)
        .current_dir(sidecar_dir)
        .env("PATH", &new_path)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("PAPERCUSP_HARNESS_DIR", harness_dir.to_string_lossy().to_string())
        .env("PAPERCUSP_DESKTOP", "1")
        .env("HOME", &workspace_home_str)
        .env("USERPROFILE", &workspace_home_str) // Windows
        // Inherit stdio so sidecar errors land in the Tauri parent's
        // stdout/stderr (visible via `papercusp-desktop > log 2>&1` or
        // Console.app on mac). The previous `Stdio::piped()` collected
        // sidecar output into kernel pipe buffers that nothing ever read,
        // which (a) hid every server-side error and (b) deadlocked the
        // sidecar once the buffer filled (~64KB) because writes started
        // blocking. The forwarding-thread alternative is more code and
        // didn't buy us anything; inherit is the simplest correct choice.
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    // Preferred path: real PG via embedded-postgres-server on a TCP port.
    // wal_level=logical is set on the postmaster, so Zero / pgoutput
    // consumers can subscribe — fixing the original reason we couldn't
    // run streamed Zero on the desktop.
    if let Some(pg_port) = pg_tcp_port {
        let app_url = format!(
            "postgresql://harness_app:harness_app_pwd@127.0.0.1:{}/papercusp",
            pg_port
        );
        let admin_url = format!(
            "postgresql://harness_admin:harness_admin_pwd@127.0.0.1:{}/papercusp",
            pg_port
        );
        cmd.env("PAPERCUSP_USE_EMBEDDED_PG", "1")
            .env("PAPERCUSP_PG_PORT", pg_port.to_string())
            .env("HARNESS_DATABASE_URL", &app_url)
            .env("HARNESS_ADMIN_DATABASE_URL", &admin_url);
    }
    // Legacy fallback: pglite-server unix socket (pre-2026-05-05).
    // Only consulted when embedded-postgres-server didn't spawn.
    else if let Some(socket_dir) = pglite_socket_dir {
        let socket_str = socket_dir.to_string_lossy().to_string();
        // URL-encode the socket dir and put it where the URL's host
        // would normally go. This is the postgres-js convention for unix
        // socket connections: anything that decodes to a path starting
        // with `/` is treated as a socket directory, not a TCP host.
        //
        // We can't use either of the more conventional forms:
        //   - `postgres://user@/db?host=/sock` is rejected by Node's
        //     `new URL()` parser (ERR_INVALID_URL) and the operator's
        //     bundled chunks call new URL() on the connection string at
        //     module init, taking out every /api endpoint.
        //   - `postgres://user@localhost/db?host=/sock` parses fine but
        //     postgres-js treats `host=` as a runtime config parameter
        //     and sends it to the server as `SET host = '/sock'`,
        //     which postgres rejects with `unrecognized configuration
        //     parameter "host"` (code 42704).
        // The percent-encoded host form sidesteps both.
        //
        // Passwords are required because pglite-server creates roles
        // with LOGIN PASSWORD '<role>_pwd' (postgres wire protocol
        // honors rolcanlogin even though pglite is single-user). They
        // match the defaults in libs/db/src/connection.ts.
        let socket_enc = url_encode(&socket_str);
        let app_url = format!(
            "postgres://harness_app:harness_app_pwd@{}/papercusp",
            socket_enc
        );
        let admin_url = format!(
            "postgres://harness_admin:harness_admin_pwd@{}/papercusp",
            socket_enc
        );
        cmd.env("PAPERCUSP_USE_PGLITE", "1")
            .env("PAPERCUSP_PGLITE_SOCKET_DIR", &socket_str)
            .env("HARNESS_DATABASE_URL", app_url)
            .env("HARNESS_ADMIN_DATABASE_URL", admin_url);
    }

    // Surface the bundled code-server URL so the operator's contributions
    // resolver can use it as the iframe default for the @papercupai/
    // vscode-server plugin — see app/api/_hono/plugins.ts and
    // app/api/plugins/[slug]/contributions/route.ts.
    if let Some(url) = code_server_url {
        cmd.env("PAPERCUSP_CODE_SERVER_URL", url);
    }

    // Snapshot capture path: when pglite-server is running with an admin
    // port, surface its URL so @papercusp/export-state's pgDump uses
    // pglite-tools (WASM pg_dump) instead of shelling to the system binary.
    if let Some(port) = pglite_admin_port {
        cmd.env("PGLITE_ADMIN_URL", format!("http://127.0.0.1:{}", port));
    }

    cmd.spawn()
}

// ---------------------------------------------------------------------------
// Workspace tauri commands
//
// Exposed to the operator UI via `invoke('plugin:...')` — see
// apps/operator/lib/workspaces-tauri.ts for the typed wrapper. Switching
// kills the running sidecar+pglite-server and restarts the entire app, which
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

#[tauri::command]
#[specta::specta]
async fn check_for_update(app: AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = env!("CARGO_PKG_VERSION").to_string();
    match app.updater().map_err(|e| e.to_string())?.check().await {
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
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
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

#[tauri::command]
#[specta::specta]
fn workspaces_switch(app: AppHandle, id: String) -> Result<(), String> {
    workspaces::switch(&id).map_err(|e| e.to_string())?;
    // Kill children before restart so they don't outlive the process.
    kill_sidecar(&app);
    app.restart();
}

fn wait_for_sidecar(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

pub fn run() {
    let state = SidecarState {
        child: Mutex::new(None),
        pglite_child: Mutex::new(None),
        code_server_child: Mutex::new(None),
        port: Mutex::new(None),
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
            app_version,
            check_for_update,
            install_update,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_history,
            pty::pty_is_alive,
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

    builder
        .invoke_handler(specta_builder.invoke_handler())
        .manage(state)
        .setup(|app| {
            let is_dev = cfg!(debug_assertions);

            if is_dev {
                // In dev mode we trust the developer to run the Next.js dev
                // server themselves on :3055 (devUrl in tauri.conf.json).
                println!("[papercusp-desktop] dev mode — skipping sidecar spawn (expecting :3055 to be served externally)");
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

            // Resolve the active workspace's fake-HOME dir. First-launch
            // migration of any pre-existing ~/.papercusp happens here.
            let workspace_home = match workspaces::current_dir() {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[papercusp-desktop] workspace init failed: {} — falling back to legacy ~/.papercusp", e);
                    std::env::var("HOME")
                        .map(std::path::PathBuf::from)
                        .unwrap_or_else(|_| std::path::PathBuf::from("."))
                }
            };
            if let Err(e) = std::fs::create_dir_all(&workspace_home) {
                eprintln!("[papercusp-desktop] could not create workspace home {}: {}", workspace_home.display(), e);
            }
            println!("[papercusp-desktop] active workspace home: {}", workspace_home.display());

            // DB spawn order:
            //   1. Try embedded-postgres-server (real PG, has logical
            //      replication for Zero) — default ON, opt-out via
            //      PAPERCUSP_USE_EMBEDDED_PG=0.
            //   2. If that's disabled or fails, try pglite-server (legacy).
            //   3. If both disabled, sidecar uses HARNESS_DATABASE_URL from
            //      the user's env.
            //
            // Only one DB runs per workspace; whichever spawned wins the
            // SidecarState.pglite_child slot (single-mutex on purpose).
            let use_embedded_pg = std::env::var("PAPERCUSP_USE_EMBEDDED_PG")
                .unwrap_or_else(|_| "1".to_string())
                != "0";

            let mut pglite_admin_port: Option<u16> = None;
            let mut pg_tcp_port: Option<u16> = None;
            let mut pglite_socket_dir: Option<std::path::PathBuf> = None;

            if use_embedded_pg {
                let pg_dir = sidecar_dir.join("embedded-postgres-server");
                let data_dir = workspace_home.join(".papercusp").join("embedded-pg-data");
                // Workspace-scoped TCP port. We pick once per spawn rather
                // than reusing a fixed port so two desktops on the same
                // host don't collide. The sidecar reads PAPERCUSP_PG_PORT
                // from its env to know where to connect.
                let port = portpicker::pick_unused_port()
                    .unwrap_or(15432);
                let db_sql_dir = sidecar_dir.join("db-sql");
                match spawn_embedded_postgres_server(&pg_dir, &data_dir, &workspace_home, port, &db_sql_dir) {
                    Ok(c) => {
                        let state: tauri::State<SidecarState> = app.state();
                        *state.pglite_child.lock().unwrap() = Some(c);
                        if wait_for_pg_tcp(port, Duration::from_secs(60)) {
                            println!("[papercusp-desktop] embedded-postgres-server ready on 127.0.0.1:{}", port);
                            pg_tcp_port = Some(port);
                        } else {
                            eprintln!("[papercusp-desktop] embedded-postgres-server did not accept TCP in 60s — initdb may have failed; falling through to pglite");
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[papercusp-desktop] failed to spawn embedded-postgres-server: {}; falling through to pglite",
                            e
                        );
                    }
                }
            } else {
                println!("[papercusp-desktop] PAPERCUSP_USE_EMBEDDED_PG=0 — skipping embedded-postgres-server");
            }

            // pglite fallback — only fired if embedded-postgres didn't come
            // up. Same env-flag layering as before for legacy compat.
            if pg_tcp_port.is_none() {
                let use_pglite = std::env::var("PAPERCUSP_USE_PGLITE")
                    .unwrap_or_else(|_| "1".to_string())
                    != "0";
                if use_pglite {
                    let pglite_dir = sidecar_dir.join("pglite-server");
                    let socket_dir = workspace_home.join(".papercusp").join("pglite-socket");
                    let data_dir = workspace_home.join(".papercusp").join("pglite-data");
                    let admin_port = portpicker::pick_unused_port();
                    pglite_admin_port = admin_port;
                    match spawn_pglite_server(&pglite_dir, &socket_dir, &data_dir, &workspace_home, admin_port) {
                        Ok(c) => {
                            let state: tauri::State<SidecarState> = app.state();
                            *state.pglite_child.lock().unwrap() = Some(c);
                            if !wait_for_pglite_socket(&socket_dir, Duration::from_secs(60)) {
                                eprintln!("[papercusp-desktop] pglite-server socket did not appear in 60s — first-boot DDL may have failed; continuing without DB so preflight is reachable");
                            }
                            println!(
                                "[papercusp-desktop] pglite-server ready (socket={}, admin={:?})",
                                socket_dir.display(),
                                admin_port,
                            );
                            pglite_socket_dir = Some(socket_dir);
                        }
                        Err(e) => {
                            eprintln!(
                                "[papercusp-desktop] failed to spawn pglite-server: {}; \
                                 sidecar will use HARNESS_DATABASE_URL from env",
                                e
                            );
                        }
                    }
                } else {
                    println!("[papercusp-desktop] PAPERCUSP_USE_PGLITE=0 — skipping pglite-server");
                }
            }

            // Spawn the bundled code-server so the @papercupai/vscode-server
            // plugin's iframe has something to point at without the user
            // having to install code-server separately. URL is surfaced to
            // the sidecar via PAPERCUSP_CODE_SERVER_URL.
            let code_server_url: Option<String> = {
                let cs_dir = sidecar_dir.join("code-server");
                let user_data_dir = workspace_home.join(".papercusp").join("code-server");
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

            let child = match spawn_sidecar(port, &sidecar_dir, pglite_socket_dir.as_deref(), pg_tcp_port, &workspace_home, code_server_url.as_deref(), pglite_admin_port) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[papercusp-desktop] failed to spawn sidecar: {}", e);
                    return Ok(());
                }
            };

            let state: tauri::State<SidecarState> = app.state();
            *state.child.lock().unwrap() = Some(child);
            *state.port.lock().unwrap() = Some(port);

            // Wait for the sidecar to start accepting connections (up to 30s).
            if !wait_for_sidecar(port, Duration::from_secs(30)) {
                eprintln!("[papercusp-desktop] sidecar did not start within 30s");
                return Ok(());
            }
            println!("[papercusp-desktop] sidecar ready on :{}", port);

            // Tell the bootstrap page where the sidecar is. The JS in
            // web/index.html will poll /api/desktop/preflight on that base,
            // render any missing-prereq UI, then navigate when ready.
            if let Some(window) = app.get_webview_window("main") {
                let base = format!("http://localhost:{}", port);
                // __PAPERCUSP_TAURI__ tells PiPanel to use the native pty
                // path (Tauri invoke + events) instead of the operator's
                // HTTP+WS bridge. See apps/operator/lib/pty-tauri.ts and
                // apps/operator/app/harness/PiPanel.tsx.
                let _ = window.eval(&format!(
                    "window.__papercuspBase = '{}'; window.__PAPERCUSP_TAURI__ = {{ kind: 'native' }}; window.dispatchEvent(new CustomEvent('papercusp:base'));",
                    base
                ));
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                kill_sidecar(app_handle);
            }
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { .. },
                ..
            } => {
                kill_sidecar(app_handle);
            }
            _ => {}
        });
}

/// Take ownership of the sidecar Child (if any) and kill it.
///
/// This is a function rather than inline so the temporary MutexGuard from
/// `state.child.lock()` is dropped before the borrow of `state` ends —
/// inlining triggered borrow-checker E0597 in Rust 2021 because the guard
/// outlived the local `state` binding.
fn kill_sidecar(app_handle: &tauri::AppHandle) {
    let state: tauri::State<SidecarState> = app_handle.state();
    let maybe_child = state.child.lock().unwrap().take();
    if let Some(mut child) = maybe_child {
        println!("[papercusp-desktop] killing sidecar pid={}", child.id());
        let _ = child.kill();
        let _ = child.wait();
    }
    let maybe_pglite = state.pglite_child.lock().unwrap().take();
    if let Some(mut child) = maybe_pglite {
        println!("[papercusp-desktop] killing pglite-server pid={}", child.id());
        let _ = child.kill();
        let _ = child.wait();
    }
    let maybe_cs = state.code_server_child.lock().unwrap().take();
    if let Some(mut child) = maybe_cs {
        println!("[papercusp-desktop] killing code-server pid={}", child.id());
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn main() {
    run();
}
