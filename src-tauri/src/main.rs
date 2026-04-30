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

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, WindowEvent};

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

    let mut cmd = Command::new("node");
    cmd.arg(&bin)
        .env("PGLITE_SOCKET_DIR", socket_dir.to_string_lossy().to_string())
        .env("PGLITE_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PGLITE_DB_SQL_DIR", db_sql_dir.to_string_lossy().to_string())
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
) -> std::io::Result<Child> {
    println!("[papercusp-desktop] spawning sidecar on port {} from {}", port, sidecar_dir.display());

    // Next.js standalone bundle layout: sidecar/apps/operator/server.js
    // is the entry point, and it expects to be invoked with cwd = sidecar/
    // (so __dirname-relative .next paths resolve correctly).
    let server_js = sidecar_dir.join("apps").join("operator").join("server.js");
    let harness_dir = sidecar_dir.join("harness");

    let mut cmd = Command::new("node");
    cmd.arg(&server_js)
        .current_dir(sidecar_dir)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("PAPERCUSP_HARNESS_DIR", harness_dir.to_string_lossy().to_string())
        .env("PAPERCUSP_DESKTOP", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // When pglite is active, point the framework's DB pool at the unix
    // socket. Pool max defaults to 8 (matches non-pglite default); the
    // pglite-socket fork at packages/pglite-server/src/socket-server.js
    // adds per-handler batch stickiness so concurrent parameterized
    // queries no longer corrupt the unnamed prepared statement state.
    if let Some(socket_dir) = pglite_socket_dir {
        let socket_str = socket_dir.to_string_lossy().to_string();
        let app_url = format!("postgres://harness_app@/papercusp?host={}", socket_str);
        let admin_url = format!("postgres://harness_admin@/papercusp?host={}", socket_str);
        cmd.env("PAPERCUSP_USE_PGLITE", "1")
            .env("PAPERCUSP_PGLITE_SOCKET_DIR", &socket_str)
            .env("HARNESS_DATABASE_URL", app_url)
            .env("HARNESS_ADMIN_DATABASE_URL", admin_url);
    }

    cmd.spawn()
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

            // Default-on for production; opt-out with PAPERCUSP_USE_PGLITE=0.
            // Desktop installs don't ship Postgres, so pglite is the only
            // built-in DB. Users with their own Postgres can opt out and
            // set HARNESS_DATABASE_URL themselves.
            let use_pglite = std::env::var("PAPERCUSP_USE_PGLITE")
                .unwrap_or_else(|_| "1".to_string())
                != "0";

            let pglite_socket_dir: Option<std::path::PathBuf> = if use_pglite {
                let pglite_dir = sidecar_dir.join("pglite-server");
                let home_dir = std::env::var("HOME")
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|_| std::path::PathBuf::from("."));
                let socket_dir = home_dir.join(".papercusp").join("pglite-socket");
                let data_dir = home_dir.join(".papercusp").join("pglite-data");

                match spawn_pglite_server(&pglite_dir, &socket_dir, &data_dir) {
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

            let child = match spawn_sidecar(port, &sidecar_dir, pglite_socket_dir.as_deref()) {
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
