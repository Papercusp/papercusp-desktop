// WSL2 onboarding for Windows.
//
// On Windows, papercup runs inside a WSL2 distro because the harness
// stack assumes POSIX (bash scripts, overmind, unix sockets, fs.watch
// semantics). Rather than make users manually `wsl --install`, this
// module drives the install + bootstrap from inside the desktop app.
//
// Lifecycle (state machine, persisted to app-local-data/wsl-state.json):
//
//   NotSupported  ── platform not Windows, or wsl.exe missing.
//   NotInstalled  ── `wsl.exe` not present or `wsl --status` errors.
//                    User clicks Install → we run `wsl --install`,
//                    transition to PendingReboot.
//   PendingReboot ── WSL kernel installed, distro install pending reboot.
//                    Persisted across launches; on next launch we check
//                    if reboot has happened and transition.
//   InstalledNoDistro ── WSL works but no `papercup-runtime` distro.
//                    Run `wsl --import` from the bundled rootfs tarball.
//   PendingBootstrap ── Distro exists, papercup setup hasn't run inside
//                    yet. Run the bootstrap script.
//   Ready         ── Everything's good. Sidecar can spawn into WSL.
//   Error         ── A step failed. Frontend surfaces the message + retry.
//
// All shelling out goes through std::process::Command; output is captured
// and returned to the frontend as structured data (no TTY parsing).
//
// Types + commands always compile so the Specta bindings are stable
// across platforms; the actual implementations are #[cfg]'d to Windows.
// On non-Windows the commands return WslState::NotSupported / errors.

use serde::{Deserialize, Serialize};
use specta::Type;

// Distro name we register via `wsl --import`. Custom name avoids
// colliding with a user's existing Ubuntu distro and lets us cleanly
// uninstall on user request.
#[cfg(target_os = "windows")]
const DISTRO_NAME: &str = "papercup-runtime";

/// Public version of DISTRO_NAME — used by main.rs when constructing
/// `wsl.exe --distribution …` to spawn the sidecar inside the runtime.
#[cfg(target_os = "windows")]
pub const DISTRO_NAME_PUB: &str = DISTRO_NAME;

/// Whether the sidecar is being routed through WSL this session — set once
/// by setup() (from `should_route_via_wsl`) so AppHandle-less call sites
/// (the native pty spawn) can route their commands into the distro too.
static WSL_ROUTE_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_route_active(active: bool) {
    WSL_ROUTE_ACTIVE.store(active, std::sync::atomic::Ordering::Relaxed);
}

pub fn detect_ready_cached() -> bool {
    WSL_ROUTE_ACTIVE.load(std::sync::atomic::Ordering::Relaxed)
}

// Filename of the rootfs tarball shipped as a Tauri resource. Built in
// CI by running our bootstrap script inside an Ubuntu container then
// `tar -czf papercup-runtime.tar.gz /`. See
// `papercusp-desktop/scripts/build-rootfs.sh` (TODO).
#[cfg(target_os = "windows")]
const ROOTFS_FILENAME: &str = "papercup-runtime.tar.gz";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind")]
pub enum WslState {
    /// Not on Windows; nothing to do.
    ///
    /// Note: NO `rename_all = "camelCase"` here. The frontend
    /// (apps/operator/lib/wsl-tauri.ts) and the WslOnboardingGate
    /// component check `state.kind === 'NotSupported' | 'NotInstalled'
    /// | …` in PascalCase. Adding camelCase here makes the gate's
    /// pass-through check fail on Linux — the wizard then shows on
    /// machines that should never see it.
    NotSupported,
    /// `wsl.exe` not on PATH, or `wsl --status` errored.
    NotInstalled,
    /// User has launched the install but reboot hasn't happened yet.
    PendingReboot,
    /// WSL works, but our papercup-runtime distro hasn't been imported.
    InstalledNoDistro,
    /// Distro exists, papercup bootstrap hasn't run.
    PendingBootstrap,
    /// Ready to use.
    Ready,
    /// Something went wrong. `message` carries detail; frontend shows a
    /// retry button.
    Error { message: String },
}

/// Typed error for the install commands. Frontend uses the variant tag
/// to decide whether to re-launch with elevation, retry, or show a
/// generic error.
// Same PascalCase-tag rule as WslState above — the frontend matches
// on `err.kind === 'NeedsElevation' | 'Failed'`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "message")]
pub enum WslOpError {
    /// `wsl --install` returned 740 (ERROR_ELEVATION_REQUIRED). User
    /// must re-launch the app with admin privileges. Message is the
    /// stderr we got back, mostly for diagnostics.
    NeedsElevation(String),
    /// Generic failure — exit code + stderr.
    Failed(String),
}

impl WslOpError {
    #[cfg(target_os = "windows")]
    fn from_exit(label: &str, code: Option<i32>, stderr: String) -> Self {
        // Win32 ERROR_ELEVATION_REQUIRED = 740. wsl.exe forwards this
        // when a sub-step (DISM, optional component install) needs
        // elevation we don't have.
        if code == Some(740) {
            return WslOpError::NeedsElevation(format!("{}: {}", label, stderr));
        }
        WslOpError::Failed(format!(
            "{} exit={} stderr={}",
            label,
            code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()),
            stderr
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WslStatus {
    pub state: WslState,
    /// `true` if `wsl.exe` exists on PATH at all (regardless of version
    /// / install state).
    pub wsl_exe_available: bool,
    /// Listed via `wsl --list --quiet`. Empty before WSL is installed.
    pub distros: Vec<String>,
    /// Default WSL version (1 or 2). 0 if unknown.
    pub default_version: u8,
}

impl WslStatus {
    fn unsupported() -> Self {
        Self {
            state: WslState::NotSupported,
            wsl_exe_available: false,
            distros: vec![],
            default_version: 0,
        }
    }
}

/// Parse the default WSL major version out of `wsl --status` output.
///
/// The "Default Version: 2" label is locale-dependent, so no English text is
/// matched: this takes the LAST line whose value — the segment after the
/// final `:`, or the whole line when there is no `:` — trims to a bare
/// integer. Distro names (`Ubuntu-18.04`), kernel versions (`5.15.133.1-1`)
/// and WSL build versions (`2.0.9.0`) never parse as a bare integer, so they
/// can't shadow the version line. (The previous implementation took the
/// FIRST ASCII digit anywhere in the output, so a digit-bearing
/// `Default Distribution:` line above the version line — e.g. Ubuntu-18.04 —
/// made it report version 1.)
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn parse_default_version(status_output: &str) -> u8 {
    status_output
        .lines()
        .filter_map(|line| {
            line.rsplit(':')
                .next()
                .unwrap_or(line)
                .trim()
                .parse::<u8>()
                .ok()
        })
        .next_back()
        .unwrap_or(0)
}

/// Decode wsl.exe's own output (--list, --status, error messages).
///
/// The Store/MSI WSL honors `WSL_UTF8=1`; the INBOX (Windows-feature) WSL
/// ignores it and emits UTF-16-LE to pipes. Found live 2026-06-11: on an
/// inbox-WSL Win11, `--list --quiet` decoded via from_utf8_lossy yields
/// `"U\0b\0u\0n\0t\0u\0…"`, so the distro name never matches and detect()
/// reports InstalledNoDistro forever. Sniff the encoding instead of
/// trusting the env var: real UTF-16-LE ASCII text has a NUL high byte at
/// every odd index; UTF-8 output never contains NULs.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn decode_wsl_output(raw: &[u8]) -> String {
    let looks_utf16 = raw.len() >= 2
        && (raw.starts_with(&[0xFF, 0xFE]) || raw.iter().skip(1).step_by(2).any(|&b| b == 0));
    if looks_utf16 {
        let units: Vec<u16> = raw
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let s = String::from_utf16_lossy(&units);
        s.strip_prefix('\u{FEFF}').unwrap_or(&s).to_string()
    } else {
        String::from_utf8_lossy(raw).into_owned()
    }
}

#[cfg(test)]
mod decode_tests {
    use super::decode_wsl_output;

    #[test]
    fn utf16le_list_output_decodes() {
        // "Ubuntu\r\npapercup-runtime\r\n" as UTF-16-LE, as inbox WSL emits.
        let text = "Ubuntu\r\npapercup-runtime\r\n";
        let raw: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let decoded = decode_wsl_output(&raw);
        let names: Vec<&str> = decoded
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        assert_eq!(names, vec!["Ubuntu", "papercup-runtime"]);
    }

    #[test]
    fn utf16le_with_bom_decodes() {
        let text = "\u{FEFF}Default Version: 2\r\n";
        let raw: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_wsl_output(&raw), "Default Version: 2\r\n");
    }

    #[test]
    fn utf8_output_passes_through() {
        assert_eq!(
            decode_wsl_output(b"Ubuntu\npapercup-runtime\n"),
            "Ubuntu\npapercup-runtime\n"
        );
        assert_eq!(decode_wsl_output(b""), "");
    }
}

// ─── Windows implementation ─────────────────────────────────────────

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    #[derive(Debug, Clone, Serialize, Deserialize, Default)]
    struct PersistedState {
        install_kicked_off: bool,
        bootstrapped: bool,
    }

    fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        // SHARED across the GUI + Server bundles. wsl-state.json carries the
        // `bootstrapped` flag; the headless Server OWNS the sidecar and reads it,
        // but onboarding is driven in the GUI. app_local_data_dir() is PER-BUNDLE
        // (identifiers com.papercusp.gui vs com.papercusp.server), so each bundle
        // got its OWN file — the Server never saw the GUI's onboarding and sat at
        // PendingBootstrap forever, never spawning the sidecar. Windows-only:
        // mac/linux have no WSL onboarding, so the split-state bug was never
        // exercised there. Store it in the shared data dir both bundles resolve
        // identically. (2026-07-02 Windows GUI/Server-split parity fix.)
        let _ = app;
        let dir = crate::workspaces::shared_data_dir();
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
        Ok(dir.join("wsl-state.json"))
    }

    fn load_state(app: &tauri::AppHandle) -> PersistedState {
        state_path(app)
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_state(app: &tauri::AppHandle, st: &PersistedState) -> Result<(), String> {
        let p = state_path(app)?;
        let s = serde_json::to_string_pretty(st).map_err(|e| e.to_string())?;
        std::fs::write(&p, s).map_err(|e| format!("write {}: {}", p.display(), e))?;
        Ok(())
    }

    pub fn distro_install_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        use tauri::Manager;
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("app_local_data_dir: {}", e))?
            .join("wsl-distro");
        std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
        Ok(dir)
    }

    fn wsl_command() -> Command {
        let mut c = Command::new("wsl.exe");
        // wsl.exe by default emits UTF-16-LE; force UTF-8 so we can
        // parse its output without a transcode layer.
        c.env("WSL_UTF8", "1");
        c
    }

    fn wsl_exe_on_path() -> bool {
        Command::new("where")
            .arg("wsl.exe")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn list_distros() -> Vec<String> {
        let out = wsl_command()
            .args(["--list", "--quiet"])
            .output()
            .ok()
            .filter(|o| o.status.success());
        let Some(out) = out else { return vec![] };
        super::decode_wsl_output(&out.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    }

    fn read_default_version() -> u8 {
        let out = wsl_command()
            .args(["--status"])
            .output()
            .ok()
            .filter(|o| o.status.success());
        let Some(out) = out else { return 0 };
        super::parse_default_version(&super::decode_wsl_output(&out.stdout))
    }

    pub(crate) fn detect(app: &tauri::AppHandle) -> WslStatus {
        let exe = wsl_exe_on_path();
        if !exe {
            return WslStatus {
                state: WslState::NotInstalled,
                wsl_exe_available: false,
                distros: vec![],
                default_version: 0,
            };
        }

        let distros = list_distros();
        let default_version = read_default_version();
        let persisted = load_state(app);

        if persisted.install_kicked_off && distros.is_empty() {
            return WslStatus {
                state: WslState::PendingReboot,
                wsl_exe_available: true,
                distros,
                default_version,
            };
        }

        if !distros.iter().any(|d| d == DISTRO_NAME) {
            return WslStatus {
                state: WslState::InstalledNoDistro,
                wsl_exe_available: true,
                distros,
                default_version,
            };
        }

        if !persisted.bootstrapped {
            return WslStatus {
                state: WslState::PendingBootstrap,
                wsl_exe_available: true,
                distros,
                default_version,
            };
        }

        WslStatus {
            state: WslState::Ready,
            wsl_exe_available: true,
            distros,
            default_version,
        }
    }

    /// Kick off `wsl --install --no-launch --no-distribution`. Requires
    /// admin — on `ERROR_ELEVATION_REQUIRED` (exit 740) we return
    /// `WslOpError::NeedsElevation` so the frontend can offer a
    /// one-click "re-launch as admin" instead of a raw error.
    pub fn install(app: &tauri::AppHandle) -> Result<(), WslOpError> {
        let out = wsl_command()
            .args(["--install", "--no-launch", "--no-distribution"])
            .output()
            .map_err(|e| WslOpError::Failed(format!("spawn wsl --install: {}", e)))?;
        if !out.status.success() {
            let stderr = super::decode_wsl_output(&out.stderr);
            return Err(WslOpError::from_exit(
                "wsl --install",
                out.status.code(),
                stderr,
            ));
        }
        let mut st = load_state(app);
        st.install_kicked_off = true;
        save_state(app, &st).map_err(WslOpError::Failed)?;
        Ok(())
    }

    fn ensure_wsl2_default() {
        let _ = wsl_command().args(["--set-default-version", "2"]).output();
    }

    pub fn import_rootfs(app: &tauri::AppHandle, tarball: &PathBuf) -> Result<(), String> {
        let install_dir = distro_install_dir(app)?;
        if !tarball.exists() {
            return Err(format!("rootfs tarball not found: {}", tarball.display()));
        }
        ensure_wsl2_default();
        let out = wsl_command()
            .args([
                "--import",
                DISTRO_NAME,
                install_dir
                    .to_str()
                    .ok_or_else(|| "install_dir not utf8".to_string())?,
                tarball
                    .to_str()
                    .ok_or_else(|| "tarball path not utf8".to_string())?,
                "--version",
                "2",
            ])
            .output()
            .map_err(|e| format!("spawn wsl --import: {}", e))?;
        if !out.status.success() {
            let code = out.status.code().unwrap_or(-1);
            let stderr = super::decode_wsl_output(&out.stderr);
            return Err(format!("wsl --import exit={} stderr={}", code, stderr));
        }
        Ok(())
    }

    pub fn run_bootstrap(app: &tauri::AppHandle) -> Result<String, String> {
        // --user root: the rootfs bakes /etc/wsl.conf default=papercup, so a
        // bare `wsl -d` runs as that user — and bootstrap writes /etc/* and
        // apt-installs, which die with Permission denied as non-root
        // (found live 2026-06-11: "/opt/papercup/bootstrap: line 16:
        // /etc/wsl.conf: Permission denied").
        let out = wsl_command()
            .args([
                "--distribution",
                DISTRO_NAME,
                "--user",
                "root",
                "--",
                "/opt/papercup/bootstrap",
            ])
            .output()
            .map_err(|e| format!("spawn wsl bootstrap: {}", e))?;
        let stdout = super::decode_wsl_output(&out.stdout);
        let stderr = super::decode_wsl_output(&out.stderr);
        if !out.status.success() {
            let code = out.status.code().unwrap_or(-1);
            return Err(format!(
                "bootstrap exit={}\n--- stdout ---\n{}\n--- stderr ---\n{}",
                code, stdout, stderr
            ));
        }
        let mut st = load_state(app);
        st.bootstrapped = true;
        save_state(app, &st)?;
        Ok(format!("{}\n{}", stdout, stderr))
    }

    pub fn uninstall(app: &tauri::AppHandle) -> Result<(), String> {
        let _ = wsl_command().args(["--unregister", DISTRO_NAME]).output();
        let p = state_path(app)?;
        let _ = std::fs::remove_file(p);
        Ok(())
    }
}

// ─── Programmatic detect (used by main.rs to gate sidecar routing) ──

pub fn detect(_app: &tauri::AppHandle) -> WslStatus {
    #[cfg(target_os = "windows")]
    {
        return imp::detect(_app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        WslStatus::unsupported()
    }
}

// ─── Tauri command surface (always compiles) ────────────────────────

#[tauri::command]
#[specta::specta]
pub fn wsl_status(app: tauri::AppHandle) -> WslStatus {
    detect(&app)
}

#[tauri::command]
#[specta::specta]
pub fn wsl_install(_app: tauri::AppHandle) -> Result<(), WslOpError> {
    #[cfg(target_os = "windows")]
    {
        return imp::install(&_app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err(WslOpError::Failed(
            "wsl_install: only supported on Windows".to_string(),
        ))
    }
}

/// Re-launch the desktop app with admin elevation via PowerShell's
/// `Start-Process -Verb RunAs`. The current process exits as soon as
/// the elevated child is spawned. The user sees the UAC prompt,
/// approves, and the app reopens with admin rights — `wsl --install`
/// will then succeed.
#[tauri::command]
#[specta::specta]
pub fn wsl_relaunch_elevated(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let exe = std::env::current_exe().map_err(|e| format!("current_exe: {}", e))?;
        let exe_str = exe
            .to_str()
            .ok_or_else(|| "exe path not utf8".to_string())?;
        // PowerShell `Start-Process -Verb RunAs` triggers the UAC prompt.
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &format!("Start-Process -FilePath \"{}\" -Verb RunAs", exe_str),
            ])
            .spawn()
            .map_err(|e| format!("spawn powershell: {}", e))?;
        // Exit so the elevated child takes over.
        _app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("wsl_relaunch_elevated: only supported on Windows".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn wsl_import(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        // The conf's `resources: ["resources/*"]` glob PRESERVES the
        // directory, so the tarball installs at <resource-root>/resources/…
        // — resolving the bare filename pointed one level too high (found
        // live 2026-06-11, run 10: "rootfs tarball not found"). Try the
        // real layout first, keep the bare name as a fallback for any
        // future flat layout.
        let tarball = _app
            .path()
            .resolve(
                format!("resources/{}", ROOTFS_FILENAME),
                tauri::path::BaseDirectory::Resource,
            )
            .ok()
            .filter(|p| p.exists())
            .or_else(|| {
                _app.path()
                    .resolve(ROOTFS_FILENAME, tauri::path::BaseDirectory::Resource)
                    .ok()
            })
            .ok_or_else(|| "resolve rootfs: no resource dir".to_string())?;
        return imp::import_rootfs(&_app, &tarball);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("wsl_import: only supported on Windows".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn wsl_bootstrap(_app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return imp::run_bootstrap(&_app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("wsl_bootstrap: only supported on Windows".to_string())
    }
}

/// Restart the desktop app after WSL onboarding completes. The
/// sidecar spawn in setup() short-circuits while WSL state isn't
/// Ready, so a clean restart picks up the now-Ready state and routes
/// the sidecar through `wsl.exe`. Frontend calls this immediately
/// after `wsl_bootstrap` succeeds and a follow-up `wsl_status` returns
/// Ready.
///
/// Windows: do NOT use `app.restart()` directly — when the app was
/// launched inside a job object (the NSIS installer's "run app" checkbox,
/// Task Scheduler, some corporate launchers), the job kills the relaunched
/// child the moment this process exits, leaving the user on a dead app
/// (found live 2026-06-11, runs 11/13: onboarding completed but the
/// restarted instance vanished). Spawn the new instance with
/// CREATE_BREAKAWAY_FROM_JOB first; fall back to a plain spawn, then to
/// app.restart().
#[tauri::command]
#[specta::specta]
pub fn wsl_finalize_ready(app: tauri::AppHandle) -> Result<(), String> {
    // Idempotency guard: the finalize can be requested by BOTH the gate (on
    // its observed PendingBootstrap→Ready transition) and the Rust-side
    // deferred-boot watcher in main.rs (the reload-proof safety net) —
    // whichever fires first wins, the other becomes a no-op instead of
    // spawning a second instance.
    static FINALIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if FINALIZED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        if let Ok(exe) = std::env::current_exe() {
            let spawned = std::process::Command::new(&exe)
                .creation_flags(CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP)
                .spawn()
                .or_else(|_| {
                    // Job may not permit breakaway — a plain spawn still
                    // survives parent exit unless the job kills by tree.
                    std::process::Command::new(&exe).spawn()
                });
            if spawned.is_ok() {
                app.exit(0);
                return Ok(());
            }
        }
    }
    app.restart();
}

#[tauri::command]
#[specta::specta]
pub fn wsl_uninstall(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return imp::uninstall(&_app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("wsl_uninstall: only supported on Windows".to_string())
    }
}

// ─── Tests ──────────────────────────────────────────────────────────
//
// Everything inside `mod imp` shells out to wsl.exe, so what's unit-
// testable cross-platform is the pure surface: the serde wire shapes
// the frontend matches on (apps/operator/lib/tauri-bindings.ts checks
// `state.kind === 'NotSupported' | …` and `err.kind ===
// 'NeedsElevation' | 'Failed'` — see the PascalCase-tag comments on
// WslState/WslOpError above), plus the 740-elevation mapping (Windows-
// only, gated below).
//
// Deliberately NOT covered here (each would need a non-test refactor):
//
// * `imp::list_distros` — the wsl.exe output parsing is inlined in the
//   same function that spawns the process. To unit test it you'd
//   extract a pure `parse_distro_list(stdout: &str) -> Vec<String>`
//   helper (outside the cfg(windows) gate so it tests on Linux) and
//   have the shelling wrapper call it. `read_default_version` HAD the
//   same shape plus a real bug (first-digit-anywhere scan misread a
//   digit-bearing distro name like "Ubuntu-18.04" as version 1); its
//   parsing is now the extracted `parse_default_version`, tested below.
//   The UTF-16LE pitfall itself is avoided at the source:
//   `wsl_command()` sets WSL_UTF8=1.
// * `detect()` / persisted-state transitions — they take a
//   `tauri::AppHandle`, which can't be constructed in unit tests
//   without enabling tauri's "test" feature (`tauri::test::mock_app`)
//   as a dev-dependency.
// * `imp::PersistedState` round-trip — private to the cfg(windows)
//   `imp` module; only testable from a test module inside it (Windows-
//   only, unverifiable from this Linux box), so skipped.

#[cfg(test)]
mod tests {
    use super::*;

    fn to_json<T: Serialize>(v: &T) -> serde_json::Value {
        serde_json::to_value(v).expect("serialize")
    }

    // ── parse_default_version (extracted from imp::read_default_version) ──

    #[test]
    fn parse_default_version_reads_the_version_line_not_the_first_digit() {
        // Regression: a digit-bearing distro name sits ABOVE the version
        // line in `wsl --status` output; the old first-digit-anywhere scan
        // reported version 1 here.
        let out = "Default Distribution: Ubuntu-18.04\nDefault Version: 2\n";
        assert_eq!(parse_default_version(out), 2);
    }

    #[test]
    fn parse_default_version_is_locale_tolerant() {
        // No English label text is matched — only the bare-integer value
        // shape after the last colon.
        let out = "Distribution par défaut : Ubuntu\nVersion par défaut : 2\n";
        assert_eq!(parse_default_version(out), 2);
    }

    #[test]
    fn parse_default_version_ignores_dotted_version_noise() {
        let out = "WSL version: 2.0.9.0\nKernel version: 5.15.133.1-1\nDefault Version: 1\n";
        assert_eq!(parse_default_version(out), 1);
    }

    #[test]
    fn parse_default_version_returns_zero_when_no_version_line() {
        assert_eq!(parse_default_version(""), 0);
        assert_eq!(parse_default_version("Default Distribution: Ubuntu\n"), 0);
    }

    // ── WslState wire shape ─────────────────────────────────────────

    #[test]
    fn wsl_state_kind_tag_is_pascal_case() {
        // The WslOnboardingGate matches these exact strings; a stray
        // `rename_all = "camelCase"` would make the gate's pass-through
        // check fail on Linux (see the comment on WslState).
        let cases: [(WslState, &str); 6] = [
            (WslState::NotSupported, "NotSupported"),
            (WslState::NotInstalled, "NotInstalled"),
            (WslState::PendingReboot, "PendingReboot"),
            (WslState::InstalledNoDistro, "InstalledNoDistro"),
            (WslState::PendingBootstrap, "PendingBootstrap"),
            (WslState::Ready, "Ready"),
        ];
        for (state, kind) in cases {
            assert_eq!(to_json(&state), serde_json::json!({ "kind": kind }));
        }
    }

    #[test]
    fn wsl_state_error_inlines_message_next_to_kind() {
        let j = to_json(&WslState::Error {
            message: "bootstrap exit=1".into(),
        });
        assert_eq!(
            j,
            serde_json::json!({ "kind": "Error", "message": "bootstrap exit=1" })
        );
    }

    #[test]
    fn wsl_state_rejects_camel_case_kind() {
        // PascalCase deserializes; camelCase must NOT silently work —
        // it would mask a frontend/backend tag-casing drift.
        assert!(serde_json::from_str::<WslState>(r#"{"kind":"NotSupported"}"#).is_ok());
        assert!(serde_json::from_str::<WslState>(r#"{"kind":"notSupported"}"#).is_err());
    }

    #[test]
    fn wsl_state_round_trips_through_json() {
        let states = [
            WslState::NotSupported,
            WslState::NotInstalled,
            WslState::PendingReboot,
            WslState::InstalledNoDistro,
            WslState::PendingBootstrap,
            WslState::Ready,
            WslState::Error {
                message: "boom".into(),
            },
        ];
        for state in states {
            let j = to_json(&state);
            let back: WslState = serde_json::from_value(j.clone()).expect("deserialize");
            assert_eq!(to_json(&back), j, "round-trip changed {:?}", state);
        }
    }

    // ── WslOpError wire shape ───────────────────────────────────────

    #[test]
    fn wsl_op_error_uses_kind_plus_message_layout() {
        // tag = "kind", content = "message" — the frontend reads
        // `err.kind` to decide elevate-vs-retry and `err.message` for
        // diagnostics.
        let j = to_json(&WslOpError::NeedsElevation("wsl --install: denied".into()));
        assert_eq!(
            j,
            serde_json::json!({ "kind": "NeedsElevation", "message": "wsl --install: denied" })
        );
        let j = to_json(&WslOpError::Failed("wsl --install exit=1 stderr=".into()));
        assert_eq!(
            j,
            serde_json::json!({ "kind": "Failed", "message": "wsl --install exit=1 stderr=" })
        );
    }

    #[test]
    fn wsl_op_error_round_trips_through_json() {
        let back: WslOpError =
            serde_json::from_str(r#"{"kind":"NeedsElevation","message":"m"}"#).expect("de");
        assert!(matches!(back, WslOpError::NeedsElevation(ref m) if m == "m"));
        let back: WslOpError =
            serde_json::from_str(r#"{"kind":"Failed","message":"f"}"#).expect("de");
        assert!(matches!(back, WslOpError::Failed(ref m) if m == "f"));
    }

    // ── WslStatus wire shape ────────────────────────────────────────

    #[test]
    fn wsl_status_serializes_camel_case_fields() {
        let st = WslStatus {
            state: WslState::Ready,
            wsl_exe_available: true,
            distros: vec!["papercup-runtime".into()],
            default_version: 2,
        };
        assert_eq!(
            to_json(&st),
            serde_json::json!({
                "state": { "kind": "Ready" },
                "wslExeAvailable": true,
                "distros": ["papercup-runtime"],
                "defaultVersion": 2,
            })
        );
    }

    #[test]
    fn wsl_status_unsupported_is_the_non_windows_shape() {
        // This is what `detect()` returns on every non-Windows platform
        // — the gate must see NotSupported and pass straight through.
        let st = WslStatus::unsupported();
        assert!(matches!(st.state, WslState::NotSupported));
        assert!(!st.wsl_exe_available);
        assert!(st.distros.is_empty());
        assert_eq!(st.default_version, 0);
    }

    #[test]
    fn wsl_status_round_trips_through_json() {
        let j = to_json(&WslStatus::unsupported());
        let back: WslStatus = serde_json::from_value(j.clone()).expect("deserialize");
        assert_eq!(to_json(&back), j);
    }
}

// Windows-only pure logic: the exit-code → error-variant mapping.
// `WslOpError::from_exit` is cfg(windows), so these can't run on the
// Linux dev box (they're compiled out here and execute on a Windows
// `cargo test`); the cross-platform suite above stays runnable
// everywhere.
#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use super::*;

    #[test]
    fn from_exit_maps_740_to_needs_elevation() {
        // Win32 ERROR_ELEVATION_REQUIRED — frontend offers "re-launch
        // as admin" instead of a raw error.
        match WslOpError::from_exit("wsl --install", Some(740), "access denied".into()) {
            WslOpError::NeedsElevation(msg) => {
                assert_eq!(msg, "wsl --install: access denied");
            }
            other => panic!("expected NeedsElevation, got {:?}", other),
        }
    }

    #[test]
    fn from_exit_other_codes_map_to_failed() {
        match WslOpError::from_exit("wsl --import", Some(1), "boom".into()) {
            WslOpError::Failed(msg) => {
                assert!(msg.contains("wsl --import"), "label missing: {}", msg);
                assert!(msg.contains("exit=1"), "exit code missing: {}", msg);
                assert!(msg.contains("stderr=boom"), "stderr missing: {}", msg);
            }
            other => panic!("expected Failed, got {:?}", other),
        }
    }

    #[test]
    fn from_exit_without_code_formats_unknown_exit() {
        // No exit code (process killed) → "exit=?", never a panic.
        match WslOpError::from_exit("wsl --install", None, String::new()) {
            WslOpError::Failed(msg) => assert!(msg.contains("exit=?"), "got: {}", msg),
            other => panic!("expected Failed, got {:?}", other),
        }
    }
}
