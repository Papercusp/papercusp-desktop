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
    pglite_child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
}

fn find_free_port() -> Option<u16> {
    portpicker::pick_unused_port()
}

/// Spawn the bundled pglite-server. Returns the socket dir path on success.
/// pglite-server listens on a unix socket at `<socket_dir>/.s.PGSQL.5432`.
fn spawn_pglite_server(
    pglite_dir: &std::path::Path,
    socket_dir: &std::path::Path,
    data_dir: &std::path::Path,
    workspace_home: &std::path::Path,
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
    workspace_home: &std::path::Path,
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

    // Disable Node 22+'s experimental Web Storage API. Without this,
    // globalThis.localStorage is a partial stub that's truthy but
    // missing methods, which makes any module using
    // `if (localStorage) localStorage.getItem(...)` throw
    // `TypeError: b.getItem is not a function` at module load. The
    // operator's @rocicorp/zero client trips this during SSR; the
    // resulting unhandledRejection takes out the catch-all module and
    // every Hono-mounted /api/* endpoint 404s.
    //
    // Must be passed as a CLI arg, not NODE_OPTIONS — the flag isn't on
    // Node's NODE_OPTIONS allowlist and the runtime errors out on boot
    // with "--no-experimental-webstorage is not allowed in NODE_OPTIONS".
    let mut cmd = Command::new("node");
    cmd.arg("--no-experimental-webstorage")
        .arg(&server_js)
        .current_dir(sidecar_dir)
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

    // When pglite is active, point the framework's DB pool at the unix
    // socket. Pool max defaults to 8 (matches non-pglite default); the
    // pglite-socket fork at packages/pglite-server/src/socket-server.js
    // adds per-handler batch stickiness so concurrent parameterized
    // queries no longer corrupt the unnamed prepared statement state.
    if let Some(socket_dir) = pglite_socket_dir {
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
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    available: bool,
    current_version: String,
    new_version: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
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
fn workspaces_list() -> workspaces::Registry {
    workspaces::list()
}

#[tauri::command]
fn workspaces_create(name: String) -> Result<workspaces::Workspace, String> {
    workspaces::create(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspaces_rename(id: String, name: String) -> Result<(), String> {
    workspaces::rename(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspaces_delete(id: String) -> Result<(), String> {
    workspaces::delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
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
        port: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            workspaces_list,
            workspaces_create,
            workspaces_rename,
            workspaces_delete,
            workspaces_switch,
            app_version,
            check_for_update,
            install_update,
        ])
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

            // Default-on for production; opt-out with PAPERCUSP_USE_PGLITE=0.
            // Desktop installs don't ship Postgres, so pglite is the only
            // built-in DB. Users with their own Postgres can opt out and
            // set HARNESS_DATABASE_URL themselves.
            let use_pglite = std::env::var("PAPERCUSP_USE_PGLITE")
                .unwrap_or_else(|_| "1".to_string())
                != "0";

            let pglite_socket_dir: Option<std::path::PathBuf> = if use_pglite {
                let pglite_dir = sidecar_dir.join("pglite-server");
                // Workspace-scoped socket + data dirs. Each workspace gets
                // its own Postgres data tree, so two workspaces never share
                // schemas, rows, or replication slots.
                let socket_dir = workspace_home.join(".papercusp").join("pglite-socket");
                let data_dir = workspace_home.join(".papercusp").join("pglite-data");

                match spawn_pglite_server(&pglite_dir, &socket_dir, &data_dir, &workspace_home) {
                    Ok(c) => {
                        let state: tauri::State<SidecarState> = app.state();
                        *state.pglite_child.lock().unwrap() = Some(c);
                        if !wait_for_pglite_socket(&socket_dir, Duration::from_secs(60)) {
                            eprintln!("[papercusp-desktop] pglite-server socket did not appear in 60s — first-boot DDL may have failed; continuing without DB so preflight is reachable");
                        }
                        println!(
                            "[papercusp-desktop] pglite-server ready (socket={})",
                            socket_dir.display()
                        );
                        Some(socket_dir)
                    }
                    Err(e) => {
                        eprintln!(
                            "[papercusp-desktop] failed to spawn pglite-server: {}; \
                             sidecar will use HARNESS_DATABASE_URL from env",
                            e
                        );
                        None
                    }
                }
            } else {
                println!("[papercusp-desktop] PAPERCUSP_USE_PGLITE=0 — skipping pglite-server");
                None
            };

            let child = match spawn_sidecar(port, &sidecar_dir, pglite_socket_dir.as_deref(), &workspace_home) {
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
                let _ = window.eval(&format!(
                    "window.__papercuspBase = '{}'; window.dispatchEvent(new CustomEvent('papercusp:base'));",
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
}

fn main() {
    run();
}
