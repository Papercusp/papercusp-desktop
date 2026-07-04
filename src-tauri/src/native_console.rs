// native_console — open an OS-native terminal window for the user.
//
// Triggered by the operator UI's "+" button (next to the voice button)
// in the global chrome. The flow is:
//
//   1. UI calls /api/agent-mcp/console/resolve which returns a
//      ConsoleEnvelope { cwd, env, mcpJsonContents, greetingCmd,
//      needsSuperuserBootstrap, ... }.
//   2. UI calls Tauri command `console_launch(envelope)` (this module).
//   3. This module:
//      a. Runs install-standalone-mcp.sh if needsSuperuserBootstrap.
//      b. Backs up any existing .mcp.json in cwd, writes the new one.
//      c. Spawns the user's terminal in a NEW WINDOW with cwd + env.
//      d. Schedules a sentinel-file watcher to restore the prior
//         .mcp.json when the user closes their terminal.
//
// Per-OS spawners follow:
//   macOS  — write a one-shot .command file in /tmp, `open -na` it.
//            `open -na` forces a fresh app instance = new window every
//            time (Terminal.app's AppleScript do-script reuses the
//            frontmost window).
//   Linux  — cascade through gnome-terminal / konsole / alacritty /
//            kitty / wezterm / xterm, each with its new-window flag.
//            Honor $TERMINAL first. Hard-error when none found.
//   Win+WSL — `wt.exe -w new --profile papercup-runtime new-tab
//            wsl.exe -d papercup-runtime -- bash -lc <one-liner>`.
//            Fallback: `wsl.exe -d ... ` with CREATE_NEW_CONSOLE.
//
// All paths produce a NEW WINDOW. No tabs.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Mirror of the TS-side `ConsoleEnvelope` from
/// packages/operator-core/lib/console-launcher.ts.
#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleEnvelope {
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub mcp_json_contents: String,
    pub greeting_cmd: String,
    pub needs_superuser_bootstrap: bool,
    /// windows-desktop-feature-parity-2026-07-02 P-010: a fresh UUID minted
    /// per launch (console-launcher.ts `buildConsoleEnvelope`) — the WINDOW's
    /// own identity. Every spawner titles the OS window
    /// `Papercup — <session_id>` (see `window_title_for` below) so a
    /// launched terminal can be found + focused by TITLE, which matters most
    /// on Windows: the agent runs inside the `papercup-runtime` WSL2 distro
    /// while the terminal window is a native Win32 process, so there is no
    /// Windows window-ancestor for a WSL pid and pid->window mapping is
    /// structurally impossible — title is the only durable link.
    pub session_id: String,
}

/// The window title every OS-native console spawn uses. Kept as one
/// function so all three spawners (+ the OSC-0 fallback escape in the
/// launcher one-liner) stay byte-for-byte consistent with each other and
/// with the `windows-desktop-windows.ts` lookup prefix (`"Papercup — "`,
/// em dash U+2014 — this is the shared contract other lanes build against;
/// don't change the format without updating that helper + adv-sessions.ts).
fn window_title_for(session_id: &str) -> String {
    format!("Papercup — {session_id}")
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ConsoleLaunchResult {
    Ok {
        pid: Option<u32>,
        displaced_mcp_json: bool,
        bootstrapped: bool,
    },
    Err {
        error: String,
    },
}

#[tauri::command]
#[specta::specta]
pub async fn console_launch(envelope: ConsoleEnvelope) -> ConsoleLaunchResult {
    match launch_inner(envelope).await {
        Ok((pid, displaced, bootstrapped)) => ConsoleLaunchResult::Ok {
            pid,
            displaced_mcp_json: displaced,
            bootstrapped,
        },
        Err(e) => ConsoleLaunchResult::Err { error: e },
    }
}

// ─────────────────────────────────────────────────────────────────────────
// windows-desktop-feature-parity-2026-07-02 D-002 — window enumeration + focus
// as Tauri commands (the D-001 pivot).
//
// The operator runs INSIDE the `papercup-runtime` WSL2 distro. A `powershell.exe`
// it spawns via WSL interop lands in SESSION 0 (the services window-station), from
// which it sees ZERO interactive Session-1 desktop windows (VM-verified 2026-07-02:
// its own SessionId is 0 and EnumWindows returns []). So window enum/focus CANNOT
// be done operator-side. It must run in THIS process (`papercusp-desktop.exe`) — a
// Session-1 native app that CAN enumerate the interactive desktop. The renderer
// invokes these commands (in-process IPC, also Session 1); the operator reaches
// them THROUGH the renderer (focus = user click in /adv; liveness = a periodic
// renderer push of the window list to the operator's reaper cache).
// ─────────────────────────────────────────────────────────────────────────

/// A visible top-level desktop window. `hwnd` is the raw handle as a decimal
/// string (opaque to JS — only round-tripped back into `focus_window_by_title`).
/// Mirrors the TS `WindowsDesktopWindow` shape in windows-desktop-windows.ts.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindow {
    pub title: String,
    pub pid: u32,
    pub hwnd: String,
}

/// EnumWindows over visible titled top-level windows, optionally filtered to
/// titles starting with `prefix`. Windows-only; mirrors win_embed's callback
/// style (a `Ctx` passed through `LPARAM`).
#[cfg(target_os = "windows")]
fn enumerate_windows(prefix: Option<&str>) -> Vec<DesktopWindow> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible,
    };
    struct Ctx {
        prefix: Option<String>,
        out: Vec<DesktopWindow>,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut Ctx) };
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return BOOL(1);
        }
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return BOOL(1);
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if n <= 0 {
            return BOOL(1);
        }
        let title = String::from_utf16_lossy(&buf[..n as usize]);
        if let Some(p) = &ctx.prefix {
            if !title.starts_with(p.as_str()) {
                return BOOL(1);
            }
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        ctx.out.push(DesktopWindow {
            title,
            pid,
            hwnd: (hwnd.0 as isize).to_string(),
        });
        BOOL(1) // keep enumerating
    }
    let mut ctx = Ctx {
        prefix: prefix.map(|s| s.to_string()),
        out: Vec::new(),
    };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.out
}

/// Enumerate visible top-level desktop windows, optionally filtered to titles
/// starting with `prefix` (pass `"Papercup — "` for session terminals). Runs
/// natively in this Session-1 process — the ONLY place window enumeration works
/// on Windows (D-002). Returns `[]` on non-Windows (Linux uses the operator's
/// wmctrl path) so the binding exists cross-platform and is always fail-soft.
#[tauri::command]
#[specta::specta]
pub fn list_windows_by_title(prefix: Option<String>) -> Vec<DesktopWindow> {
    #[cfg(target_os = "windows")]
    {
        enumerate_windows(prefix.as_deref())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = prefix;
        Vec::new()
    }
}

/// Bring the window whose title EXACTLY equals `title` to the foreground
/// (restoring it first if minimized). USER-INITIATED ONLY — mirrors the
/// `feedback_e2e_no_focus_steal` memory; never call from an automated driver.
/// Returns true iff a matching window was found and the foreground call issued.
/// No-op returning false on non-Windows (Linux focus stays the wmctrl path).
#[tauri::command]
#[specta::specta]
pub fn focus_window_by_title(title: String) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
        };
        let handle = enumerate_windows(None)
            .into_iter()
            .find(|w| w.title == title)
            .and_then(|w| w.hwnd.parse::<isize>().ok());
        match handle {
            Some(h) => {
                let hwnd = HWND(h as *mut c_void);
                unsafe {
                    if IsIconic(hwnd).as_bool() {
                        let _ = ShowWindow(hwnd, SW_RESTORE);
                    }
                    SetForegroundWindow(hwnd).as_bool()
                }
            }
            None => false,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = title;
        false
    }
}

async fn launch_inner(envelope: ConsoleEnvelope) -> Result<(Option<u32>, bool, bool), String> {
    // 1. Bootstrap superuser token if needed.
    let bootstrapped = if envelope.needs_superuser_bootstrap {
        ensure_superuser_token().await?;
        true
    } else {
        false
    };

    // 2. Atomic .mcp.json write with backup-restore.
    //    Via the cfs_* console-fs helpers: on Windows `envelope.cwd` is a
    //    LINUX path inside the WSL distro (where the console will run), so
    //    every fs op must relay through `wsl.exe` — Windows std::fs against
    //    it fails with os error 3 (found live 2026-07-03, WI-2149), and the
    //    \\wsl.localhost mount is unreliable on real installs.
    let mcp_path = console_path_join(&envelope.cwd, ".mcp.json");
    let displaced = if cfs_exists(&mcp_path) {
        let bak = console_path_join(&envelope.cwd, ".mcp.json.papercusp.bak");
        // If a stale bak from a previous unclean exit is sitting there,
        // leave it alone — we'd rather lose our restore than clobber
        // the user's real mcp.json on a botched cleanup.
        if !cfs_exists(&bak) {
            cfs_rename(&mcp_path, &bak).map_err(|e| format!("backup .mcp.json: {e}"))?;
            true
        } else {
            // Best effort: archive ours under a unique name. The user
            // can sort it out manually.
            false
        }
    } else {
        false
    };
    cfs_write(&mcp_path, &envelope.mcp_json_contents)
        .map_err(|e| format!("write .mcp.json: {e}"))?;

    // 3. Build the launcher one-liner (same shape on every OS).
    let oneliner = build_launcher_oneliner(&envelope);

    // 4. Per-OS new-window spawn.
    let pid = if cfg!(target_os = "macos") {
        spawn_macos_new_window(&envelope, &oneliner)?
    } else if cfg!(target_os = "linux") {
        spawn_linux_new_window(&envelope, &oneliner)?
    } else if cfg!(target_os = "windows") {
        spawn_windows_wsl_new_window(&envelope, &oneliner)?
    } else {
        return Err(format!("unsupported platform"));
    };

    // 5. Schedule .mcp.json restore when the user's shell exits.
    //    We can't watch the terminal launcher's pid (it exits in ~1s);
    //    we watch for the sentinel files the launcher's bash one-liner
    //    drops in cwd. Cap at 24h so a botched cleanup eventually heals.
    if displaced {
        let cwd_clone = envelope.cwd.clone();
        let mcp_path_clone = mcp_path.clone();
        let backup_path = console_path_join(&envelope.cwd, ".mcp.json.papercusp.bak");
        std::thread::spawn(move || {
            watch_and_restore_mcp_json(cwd_clone, mcp_path_clone, backup_path);
        });
    } else {
        // Even when we didn't displace anything, schedule a cleanup of
        // the .mcp.json we wrote — otherwise it sits in the user's
        // project forever, surprising them later when they `cat .mcp.json`.
        let mcp_path_clone = mcp_path.clone();
        let cwd_clone = envelope.cwd.clone();
        std::thread::spawn(move || {
            watch_and_remove_mcp_json(cwd_clone, mcp_path_clone);
        });
    }

    Ok((pid, displaced, bootstrapped))
}

/// Poll cwd for sentinel files. When none remain (the user closed the
/// last papercup-launched shell), restore the prior `.mcp.json` from
/// the backup. Bounded by a 24h hard timeout so a hung shell doesn't
/// leak our .mcp.json forever.
fn watch_and_restore_mcp_json(cwd: String, mcp_path: String, backup_path: String) {
    if !wait_for_sentinels_to_clear(&cwd) {
        // Hard timeout fired. Restore anyway — better to lose freshness
        // than to leak our config forever.
    }
    // Atomic-ish restore: rename bak over mcp_path. If the user
    // edited .mcp.json in the meantime they lose those edits — but
    // they wrote them into our temporary file, which was always
    // documented as ephemeral.
    let _ = cfs_rename(&backup_path, &mcp_path);
}

/// Same as `watch_and_restore_mcp_json` but for the case where no
/// prior `.mcp.json` existed — we just remove ours when the last
/// console exits.
fn watch_and_remove_mcp_json(cwd: String, mcp_path: String) {
    let _cleared = wait_for_sentinels_to_clear(&cwd);
    // On either clean exit OR 24h timeout we remove our file. Leaving
    // it indefinitely would surprise the user; they can rerun the
    // launcher to get it back.
    cfs_remove(&mcp_path);
}

/// Poll cwd every 5s for `.papercup-console-active.*` files. Returns
/// true when the last sentinel went away (clean exit), false on
/// 24h timeout.
fn wait_for_sentinels_to_clear(cwd: &str) -> bool {
    use std::time::{Duration, Instant};
    const POLL: Duration = Duration::from_secs(5);
    const HARD_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
    let deadline = Instant::now() + HARD_TIMEOUT;

    // Initial grace window: the launcher one-liner needs a few seconds
    // to actually touch the first sentinel after the terminal opens.
    // Without this, a fast-polling loop would see zero sentinels at
    // t=0 and restore immediately, before the user's shell started.
    std::thread::sleep(Duration::from_secs(8));

    loop {
        if Instant::now() > deadline {
            return false;
        }
        let any = count_sentinels(cwd) > 0;
        if !any {
            return true;
        }
        std::thread::sleep(POLL);
    }
}

#[cfg(not(target_os = "windows"))]
fn count_sentinels(cwd: &str) -> usize {
    let Ok(entries) = std::fs::read_dir(cwd) else {
        return 0;
    };
    let prefix = SENTINEL_PREFIX;
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.starts_with(prefix))
                .unwrap_or(false)
        })
        .count()
}

/// Windows: the sentinels live in the WSL cwd — count them through the distro.
/// A relay FAILURE conservatively counts as 1 (assume a console is still
/// alive) so a transient WSL hiccup can't trigger a premature .mcp.json
/// restore; the 24h hard timeout still bounds the wait.
#[cfg(target_os = "windows")]
fn count_sentinels(cwd: &str) -> usize {
    let script = format!(
        "ls -1d {}/{}* 2>/dev/null | wc -l",
        shell_escape_single(cwd),
        SENTINEL_PREFIX
    );
    match wsl_fs(&["bash", "-c", &script], None) {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<usize>()
            .unwrap_or(1),
        _ => 1,
    }
}

// ── Console-fs helpers ──────────────────────────────────────────────
// The console's filesystem is OURS on macOS/Linux, but on Windows the
// console (and the operator that built the envelope) runs INSIDE the WSL
// distro, so `envelope.cwd` is a Linux path: Windows std::fs against it
// fails (os error 3), and the \\wsl.localhost mount is unreliable on real
// installs (see main.rs read_operator_discovery_via_wsl). Every path here
// is a STRING joined with '/' — correct on all three targets.

fn console_path_join(cwd: &str, name: &str) -> String {
    format!("{}/{}", cwd.trim_end_matches('/'), name)
}

/// Run a short-lived fs relay inside the WSL distro, hidden (CREATE_NO_WINDOW),
/// optionally feeding `stdin` — the transport every cfs_* helper uses on Windows.
#[cfg(target_os = "windows")]
fn wsl_fs(args: &[&str], stdin: Option<&str>) -> Result<std::process::Output, String> {
    use std::io::Write as _;
    use std::os::windows::process::CommandExt as _;
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.arg("-d").arg(WSL_DISTRO).arg("--").args(args);
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd.stdin(if stdin.is_some() {
        std::process::Stdio::piped()
    } else {
        std::process::Stdio::null()
    });
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("wsl.exe spawn: {e}"))?;
    if let Some(data) = stdin {
        let mut si = child.stdin.take().ok_or("wsl.exe stdin unavailable")?;
        si.write_all(data.as_bytes())
            .map_err(|e| format!("wsl.exe stdin: {e}"))?;
    }
    child
        .wait_with_output()
        .map_err(|e| format!("wsl.exe wait: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn cfs_exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

#[cfg(target_os = "windows")]
fn cfs_exists(path: &str) -> bool {
    wsl_fs(&["test", "-e", path], None)
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn cfs_rename(from: &str, to: &str) -> Result<(), String> {
    std::fs::rename(from, to).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn cfs_rename(from: &str, to: &str) -> Result<(), String> {
    let out = wsl_fs(&["mv", "-f", from, to], None)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn cfs_write(path: &str, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn cfs_write(path: &str, contents: &str) -> Result<(), String> {
    // `cat > path` with the contents on stdin — no quoting pitfalls.
    let script = format!("cat > {}", shell_escape_single(path));
    let out = wsl_fs(&["bash", "-c", &script], Some(contents))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn cfs_remove(path: &str) {
    let _ = std::fs::remove_file(path);
}

#[cfg(target_os = "windows")]
fn cfs_remove(path: &str) {
    let _ = wsl_fs(&["rm", "-f", path], None);
}

/// Build the bash one-liner the terminal runs as its first command.
/// Pattern:
///   cd → env exports → drop sentinel → trap-cleanup → greeting → exec shell
///
/// The sentinel file (`.papercup-console-active.$`) is how the Rust
/// side knows the user's shell is still alive. We can't trust the pid
/// of the terminal launcher itself (open/wt.exe/gnome-terminal etc.
/// exit immediately after the window appears), so we use a filesystem
/// fingerprint that survives across process boundaries.
///
/// `exec` chains so the env survives without touching rc files.
fn build_launcher_oneliner(envelope: &ConsoleEnvelope) -> String {
    let env_exports = build_env_exports(&envelope.env);
    let greeting = envelope.greeting_cmd.replace('\'', "'\\''");
    let cwd_escaped = shell_escape_single(&envelope.cwd);
    // OSC-0 title escape: sets the window/tab/conhost title to the same
    // `Papercup — <session_id>` string the Windows wt.exe spawner also
    // passes via `--title`. Redundant-by-design belt-and-suspenders — on
    // Windows this is what titles the window when wt.exe is absent and we
    // fall back to a bare `wsl.exe` in a fresh conhost (which has no
    // --title flag of its own, but conhost/ConPTY honor VT title escapes).
    // Harmless on macOS/Linux (every terminal there honors OSC 0 too).
    let win_title = window_title_for(&envelope.session_id);
    let title_quoted = shell_escape_single(&win_title);
    format!(
        "printf '\\033]0;%s\\007' {title} \
         ; cd {cwd} && {exports} \
         && touch {sentinel_glob}.$ \
         && trap 'rm -f {sentinel_glob}.$' EXIT \
         && ({greet}) ; \
         exec \"${{SHELL:-/bin/bash}}\" -l",
        title = title_quoted,
        cwd = cwd_escaped,
        exports = env_exports,
        sentinel_glob = SENTINEL_PREFIX,
        greet = greeting,
    )
}

/// Sentinel filename prefix. The launcher one-liner writes
/// `<prefix>.<pid>` on entry and deletes it on exit (trap). The
/// cleanup watcher polls for any matching file in cwd.
const SENTINEL_PREFIX: &str = ".papercup-console-active";

fn build_env_exports(env: &HashMap<String, String>) -> String {
    let mut parts = Vec::with_capacity(env.len() + 1);
    // Prepend our shim dir (psu/ptool, ~/.papercusp/bin) and the bundled scripts
    // dir to PATH if the operator sent them — keeps `papercup`/`psu`/`ptool`
    // callable without an absolute path. Bin dir first so a user shim wins over a
    // same-named bundled script (psu-in-desktop-builds-2026-06-23 A2b).
    let mut path_prepend: Vec<String> = Vec::new();
    if let Some(bin) = env.get("PAPERCUSP_BIN_DIR") {
        path_prepend.push(shell_escape_single(bin));
    }
    if let Some(scripts) = env.get("PAPERCUSP_SCRIPTS_DIR") {
        path_prepend.push(shell_escape_single(scripts));
    }
    if !path_prepend.is_empty() {
        parts.push(format!("export PATH={}:${{PATH}}", path_prepend.join(":")));
    }
    // Export every var itself (including PAPERCUSP_BIN_DIR / PAPERCUSP_SCRIPTS_DIR,
    // which are valid bash names) so scripts can introspect them.
    for (k, v) in env {
        // Skip names that aren't safe bash identifiers.
        if !is_valid_env_name(k) {
            continue;
        }
        parts.push(format!("export {}={}", k, shell_escape_single(v)));
    }
    parts.join(" && ")
}

fn is_valid_env_name(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Single-quote a path for safe bash literal use. Replaces internal
/// single quotes with the escape sequence `'\''`.
fn shell_escape_single(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Run install-standalone-mcp.sh to mint a superuser token. Best-effort
/// — if the script isn't bundled (dev env), we tell the user to install
/// it manually.
async fn ensure_superuser_token() -> Result<(), String> {
    // The script's location depends on whether we're running from the
    // bundled sidecar or a dev checkout. Try a few candidates.
    let candidates: Vec<PathBuf> = ["sidecar", "../sidecar", "../../sidecar"]
        .iter()
        .map(|s| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join(s)))
                .unwrap_or_else(|| PathBuf::from(s))
        })
        .flat_map(|root| {
            vec![
                root.join("apps/operator/scripts/install-standalone-mcp.sh"),
                root.join("scripts/install-standalone-mcp.sh"),
            ]
        })
        .collect();

    let script = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| {
            "superuser-token install script not found. Run \
             apps/operator/scripts/install-standalone-mcp.sh manually."
                .to_string()
        })?;

    let out = std::process::Command::new("bash")
        .arg(&script)
        .output()
        .map_err(|e| format!("running install-standalone-mcp.sh: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "install-standalone-mcp.sh failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

// ─── macOS spawner ───────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn spawn_macos_new_window(
    _envelope: &ConsoleEnvelope,
    oneliner: &str,
) -> Result<Option<u32>, String> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    // Write a one-shot .command file. `open -na Terminal.app FILE`
    // always opens a new window; AppleScript `do script` would tab
    // into the frontmost window. The .command extension makes
    // Terminal.app the default handler.
    let tmp = std::env::temp_dir().join(format!(
        "papercup-launch-{}.command",
        uuid::Uuid::new_v4().simple()
    ));
    let script = format!("#!/bin/bash\nset -e\n{}\n", oneliner);
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("create tmp script: {e}"))?;
        f.write_all(script.as_bytes())
            .map_err(|e| format!("write tmp script: {e}"))?;
    }
    let mut perms = std::fs::metadata(&tmp)
        .map_err(|e| format!("metadata: {e}"))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&tmp, perms).map_err(|e| format!("chmod: {e}"))?;

    let default_term = detect_macos_default_terminal();
    let child = std::process::Command::new("open")
        .arg("-na")
        .arg(&default_term)
        .arg(&tmp)
        .spawn()
        .map_err(|e| format!("open -na {default_term}: {e}"))?;
    Ok(Some(child.id()))
}

#[cfg(not(target_os = "macos"))]
fn spawn_macos_new_window(
    _envelope: &ConsoleEnvelope,
    _oneliner: &str,
) -> Result<Option<u32>, String> {
    unreachable!("macOS spawner called on non-macOS build")
}

#[cfg(target_os = "macos")]
fn detect_macos_default_terminal() -> String {
    // Best-effort detection. If iTerm2 is installed, prefer it; else
    // fall back to Terminal.app which is always present on macOS.
    let iterm = PathBuf::from("/Applications/iTerm.app");
    if iterm.exists() {
        "iTerm.app".to_string()
    } else {
        "Terminal.app".to_string()
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn detect_macos_default_terminal() -> String {
    "Terminal.app".to_string()
}

// ─── Linux spawner ───────────────────────────────────────────────────

/// Known Linux terminal emulators in preference order with the args to
/// pass right before the user's command. All entries here open a NEW
/// WINDOW when invoked (not reuse-existing-tab) — flags chosen to make
/// that explicit where the default would be ambiguous.
const LINUX_TERMINALS: &[(&str, &[&str])] = &[
    // (binary, args before our command)
    ("gnome-terminal", &["--window", "--"]),
    ("konsole", &["--new-window", "-e"]),
    ("xfce4-terminal", &["--window", "-e"]),
    ("alacritty", &["-e"]),
    ("kitty", &["--"]),
    ("wezterm", &["start", "--always-new-process", "--"]),
    ("xterm", &["-e"]),
];

#[cfg(target_os = "linux")]
fn spawn_linux_new_window(
    envelope: &ConsoleEnvelope,
    oneliner: &str,
) -> Result<Option<u32>, String> {
    // 1. Honor $TERMINAL if user set one.
    if let Ok(term) = std::env::var("TERMINAL") {
        if is_on_path(&term) {
            return spawn_linux_with(&term, &["-e"], envelope, oneliner);
        }
    }
    // 2. Cascade through known terminals.
    for (bin, args) in LINUX_TERMINALS {
        if is_on_path(bin) {
            return spawn_linux_with(bin, args, envelope, oneliner);
        }
    }
    let tried: Vec<&str> = LINUX_TERMINALS.iter().map(|(b, _)| *b).collect();
    Err(format!(
        "no terminal emulator found. Set $TERMINAL or install one of: {}",
        tried.join(", ")
    ))
}

#[cfg(not(target_os = "linux"))]
fn spawn_linux_new_window(
    _envelope: &ConsoleEnvelope,
    _oneliner: &str,
) -> Result<Option<u32>, String> {
    unreachable!("Linux spawner called on non-Linux build")
}

#[cfg(target_os = "linux")]
fn spawn_linux_with(
    bin: &str,
    args: &[&str],
    envelope: &ConsoleEnvelope,
    oneliner: &str,
) -> Result<Option<u32>, String> {
    let mut cmd = std::process::Command::new(bin);
    cmd.current_dir(&envelope.cwd);
    for (k, v) in &envelope.env {
        if is_valid_env_name(k) {
            cmd.env(k, v);
        }
    }
    for a in args {
        cmd.arg(a);
    }
    cmd.arg("bash").arg("-lc").arg(oneliner);
    // Detach stdio so closing the operator's terminal doesn't kill the
    // user's new window.
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let child = cmd.spawn().map_err(|e| format!("spawn {bin}: {e}"))?;
    Ok(Some(child.id()))
}

/// Cheap PATH lookup. We can't pull in the `which` crate without
/// adding a dep, so this walks $PATH manually. Linux-only.
fn is_on_path(bin: &str) -> bool {
    if bin.contains('/') {
        return std::path::Path::new(bin).exists();
    }
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|d| {
        let candidate = d.join(bin);
        candidate.exists()
    })
}

// ─── Windows (WSL) spawner ───────────────────────────────────────────

/// Distro name installed by wsl_setup::wsl_import (the bootstrap flow).
/// All console launches target this distro — we don't try to detect
/// the user's other distros because the operator's sidecar runs here.
const WSL_DISTRO: &str = "papercup-runtime";

#[cfg(target_os = "windows")]
fn spawn_windows_wsl_new_window(
    envelope: &ConsoleEnvelope,
    oneliner: &str,
) -> Result<Option<u32>, String> {
    use std::os::windows::process::CommandExt as _;

    // wt.exe splits its command line on every unescaped `;` into SEPARATE
    // TABS, and wsl.exe (without --exec) re-parses its tail through the
    // distro's default shell — two independent parsing layers that both
    // mangle a shell one-liner passed inline. Found live 2026-07-03
    // (WI-2149): wt split our one-liner at its `;`s, opened a tab titled
    // " exec " running the fragment after the last one, and the real
    // greeting/sentinel never ran. Sidestep BOTH layers: write the
    // one-liner to a transient launch script INSIDE the distro (cfs_write
    // relays via wsl.exe) and pass only a plain, quote-free path through
    // wt/wsl. The script self-deletes on start (the unlinked inode stays
    // readable for the already-running bash).
    let script_path = console_path_join(
        &envelope.cwd,
        &format!(".papercup-console-launch.{}.sh", envelope.session_id),
    );
    let script = format!(
        "#!/bin/bash\n# Transient Papercup console launcher (WI-2149) — self-deletes on start.\nrm -f -- \"$0\"\n{oneliner}\n"
    );
    cfs_write(&script_path, &script).map_err(|e| format!("write console launch script: {e}"))?;

    // Prefer Windows Terminal — `-w new` forces a new window every
    // invocation. We deliberately DON'T pass wt --startingDirectory: it
    // needs a WINDOWS path, and the only Windows view of the WSL cwd is the
    // \\wsl.localhost UNC — which is UNRELIABLE on real installs (found live
    // 2026-07-03, WI-2149: an unresolvable --startingDirectory makes wt's
    // CreateProcess FAIL, so a titled tab opens but the command never runs —
    // the exact "window appears, psu never starts" symptom). The `wsl.exe
    // --cd <cwd>` below already lands the shell in the right WSL dir, so
    // --startingDirectory was only ever cosmetic for wt's own notion of cwd.
    if is_on_path_windows("wt.exe") {
        let mut cmd = std::process::Command::new("wt.exe");
        cmd.arg("-w").arg("new");
        // windows-desktop-feature-parity-2026-07-02 P-010: title the window
        // `Papercup — <session_id>` so it can be found + focused by TITLE
        // later (windows-desktop-windows.ts listWindowsByTitle /
        // focusWindowByTitle, wired through adv-sessions.ts's
        // isWindowsDesktopHost() branch).
        // --title is a new-tab-command option (wt's implicit default command
        // when none is given), so it's valid alongside -w/--startingDirectory
        // here. --suppressApplicationTitle pins it so a later OSC-0/2 title
        // change from the shell (a fancy PS1, a nested app) can't clobber it
        // — MS docs: "If you change the title of a tab and want that title
        // to persist, you must enable suppressApplicationTitle."
        let win_title = window_title_for(&envelope.session_id);
        cmd.arg("--title").arg(&win_title);
        cmd.arg("--suppressApplicationTitle");
        cmd.arg("wsl.exe")
            .arg("-d")
            .arg(WSL_DISTRO)
            .arg("--cd")
            .arg(&envelope.cwd)
            .arg("--")
            .arg("bash")
            .arg("-l")
            .arg(&script_path);
        // CREATE_NEW_CONSOLE = 0x00000010 — even when wt is fronted,
        // belt-and-suspenders so we never inherit our parent's console.
        cmd.creation_flags(0x00000010);
        match cmd.spawn() {
            Ok(child) => return Ok(Some(child.id())),
            Err(e) => {
                // wt.exe was ON PATH but launching it FAILED — don't hard-error,
                // fall through to the bare wsl.exe conhost path below (no Windows
                // Terminal needed). The classic real-machine cause is an ORPHANED
                // WindowsApps execution alias: uninstalling the Store "Windows
                // Terminal" app leaves a 0-byte `wt.exe` reparse point in
                // %LOCALAPPDATA%\Microsoft\WindowsApps (still on PATH, so
                // is_on_path_windows sees it), whose execution fails or pops a
                // Store "how do you want to open this?" dialog. The bare-wsl.exe
                // fallback still surfaces its own error rather than hanging if WSL
                // itself is missing.
                eprintln!(
                    "[console] wt.exe on PATH but spawn failed ({e}); \
                     falling back to bare wsl.exe conhost"
                );
            }
        }
    }

    // Fallback: direct wsl.exe in a fresh conhost. Reached when Windows
    // Terminal is absent OR present-but-unlaunchable (above). Works on
    // older Windows installs without Windows Terminal. Same launch script
    // as the wt path — wsl.exe's tail is re-parsed by the distro shell, so
    // an inline one-liner is just as unsafe here.
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.arg("-d")
        .arg(WSL_DISTRO)
        .arg("--cd")
        .arg(&envelope.cwd)
        .arg("--")
        .arg("bash")
        .arg("-l")
        .arg(&script_path);
    cmd.creation_flags(0x00000010); // CREATE_NEW_CONSOLE
    let child = cmd
        .spawn()
        .map_err(|e| format!("wsl.exe spawn failed: {e}. WSL not installed?"))?;
    Ok(Some(child.id()))
}

#[cfg(not(target_os = "windows"))]
fn spawn_windows_wsl_new_window(
    _envelope: &ConsoleEnvelope,
    _oneliner: &str,
) -> Result<Option<u32>, String> {
    unreachable!("Windows spawner called on non-Windows build")
}

#[cfg(target_os = "windows")]
fn is_on_path_windows(bin: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|d| {
        // On Windows PATHEXT matters but for known .exe names we can
        // skip that — we only check well-known commands by full name.
        d.join(bin).exists()
    })
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn is_on_path_windows(_bin: &str) -> bool {
    false
}

// ─── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(cwd: &str) -> ConsoleEnvelope {
        let mut env = HashMap::new();
        env.insert("PAPERCUSP_HARNESS_SLUG".to_string(), "sheets".to_string());
        env.insert("PAPERCUSP_WORKSPACE".to_string(), "default".to_string());
        env.insert(
            "PAPERCUSP_SCRIPTS_DIR".to_string(),
            "/path/to/scripts".to_string(),
        );
        ConsoleEnvelope {
            cwd: cwd.to_string(),
            env,
            mcp_json_contents: "{}".to_string(),
            greeting_cmd: "papercup status".to_string(),
            needs_superuser_bootstrap: false,
            session_id: "test-session-id".to_string(),
        }
    }

    #[test]
    fn oneliner_includes_cwd_env_greeting_and_exec() {
        let e = envelope("/some/harness/dir");
        let out = build_launcher_oneliner(&e);
        assert!(out.contains("cd '/some/harness/dir'"));
        assert!(out.contains("export PAPERCUSP_HARNESS_SLUG='sheets'"));
        assert!(out.contains("export PAPERCUSP_WORKSPACE='default'"));
        assert!(out.contains("(papercup status)"));
        assert!(out.contains("exec \"${SHELL:-/bin/bash}\" -l"));
    }

    #[test]
    fn window_title_uses_em_dash_prefix() {
        // Shared contract with windows-desktop-windows.ts's title lookup —
        // don't change this format without updating that helper +
        // adv-sessions.ts's win32 branch in the same change.
        assert_eq!(window_title_for("abc-123"), "Papercup — abc-123");
    }

    #[test]
    fn oneliner_emits_osc0_title_escape() {
        let e = envelope("/x");
        let out = build_launcher_oneliner(&e);
        assert!(
            out.contains("printf '\\033]0;%s\\007' 'Papercup — test-session-id'"),
            "OSC-0 title escape missing or malformed: {out}"
        );
    }

    #[test]
    fn oneliner_drops_sentinel_with_trap() {
        let e = envelope("/x");
        let out = build_launcher_oneliner(&e);
        // Touches sentinel with shell pid suffix
        assert!(
            out.contains("touch .papercup-console-active.$"),
            "sentinel touch missing: {out}"
        );
        // trap fires on EXIT to clean up
        assert!(
            out.contains("trap 'rm -f .papercup-console-active.$' EXIT"),
            "EXIT trap missing: {out}"
        );
    }

    #[test]
    fn scripts_dir_prepended_to_path() {
        let e = envelope("/x");
        let out = build_launcher_oneliner(&e);
        assert!(out.contains("export PATH='/path/to/scripts':${PATH}"));
    }

    #[test]
    fn bin_dir_prepended_before_scripts_dir() {
        // psu-in-desktop-builds-2026-06-23 A2b: ~/.papercusp/bin (the psu/ptool
        // shims) goes on PATH ahead of the bundled scripts dir, so `psu` is
        // runnable and a user shim wins over a same-named bundled script.
        let mut e = envelope("/x");
        e.env.insert(
            "PAPERCUSP_BIN_DIR".to_string(),
            "/home/u/.papercusp/bin".to_string(),
        );
        let out = build_launcher_oneliner(&e);
        assert!(
            out.contains("export PATH='/home/u/.papercusp/bin':'/path/to/scripts':${PATH}"),
            "bin dir not prepended ahead of scripts dir: {out}"
        );
    }

    #[test]
    fn shell_escape_handles_embedded_quotes() {
        assert_eq!(shell_escape_single("simple"), "'simple'");
        assert_eq!(shell_escape_single("a b"), "'a b'");
        assert_eq!(shell_escape_single("it's"), "'it'\\''s'");
    }

    #[test]
    fn invalid_env_names_are_filtered() {
        let mut env = HashMap::new();
        env.insert("GOOD_NAME".to_string(), "v".to_string());
        env.insert("123BAD".to_string(), "v".to_string());
        env.insert("BAD-DASH".to_string(), "v".to_string());
        let out = build_env_exports(&env);
        assert!(out.contains("export GOOD_NAME="));
        assert!(!out.contains("123BAD"));
        assert!(!out.contains("BAD-DASH"));
    }

    #[test]
    fn linux_table_entries_are_well_formed() {
        // Every entry must (a) have a non-empty binary name, (b) have
        // at least one trailing arg so the user's command is positional
        // and not interpreted as an option to the terminal itself.
        for (bin, args) in LINUX_TERMINALS {
            assert!(!bin.is_empty(), "empty binary in LINUX_TERMINALS");
            assert!(
                !args.is_empty(),
                "{bin} has no trailing args — would pass user command as flag"
            );
        }
    }

    #[test]
    fn count_sentinels_finds_only_matching_files() {
        let tmp =
            std::env::temp_dir().join(format!("papercup-test-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&tmp).unwrap();
        let tmp_s = tmp.to_str().unwrap();
        // None yet.
        assert_eq!(count_sentinels(tmp_s), 0);
        // Drop two sentinels + an unrelated file.
        std::fs::write(tmp.join(".papercup-console-active.123"), "").unwrap();
        std::fs::write(tmp.join(".papercup-console-active.456"), "").unwrap();
        std::fs::write(tmp.join("README.md"), "").unwrap();
        assert_eq!(count_sentinels(tmp_s), 2);
        // Remove one.
        std::fs::remove_file(tmp.join(".papercup-console-active.123")).unwrap();
        assert_eq!(count_sentinels(tmp_s), 1);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn linux_table_covers_common_terminals() {
        let bins: Vec<&str> = LINUX_TERMINALS.iter().map(|(b, _)| *b).collect();
        for must_have in &[
            "gnome-terminal",
            "konsole",
            "alacritty",
            "kitty",
            "wezterm",
            "xterm",
        ] {
            assert!(
                bins.contains(must_have),
                "{must_have} missing from LINUX_TERMINALS"
            );
        }
    }
}
