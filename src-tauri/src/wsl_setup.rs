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

// Filename of the rootfs tarball shipped as a Tauri resource. Built in
// CI by running our bootstrap script inside an Ubuntu container then
// `tar -czf papercup-runtime.tar.gz /`. See
// `papercusp-desktop/scripts/build-rootfs.sh` (TODO).
#[cfg(target_os = "windows")]
const ROOTFS_FILENAME: &str = "papercup-runtime.tar.gz";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WslState {
    /// Not on Windows; nothing to do.
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
        use tauri::Manager;
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("app_local_data_dir: {}", e))?;
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
        String::from_utf8_lossy(&out.stdout)
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
        let text = String::from_utf8_lossy(&out.stdout);
        // The "Default Version: 2" line is locale-dependent; the digit
        // is the only ASCII digit in the output → robust enough.
        text.chars()
            .find_map(|c| c.to_digit(10))
            .map(|d| d as u8)
            .unwrap_or(0)
    }

    pub fn detect(app: &tauri::AppHandle) -> WslStatus {
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
    /// admin — caller is expected to have invoked us with elevation.
    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        let out = wsl_command()
            .args(["--install", "--no-launch", "--no-distribution"])
            .output()
            .map_err(|e| format!("spawn wsl --install: {}", e))?;
        if !out.status.success() {
            let code = out.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            return Err(format!("wsl --install exit={} stderr={}", code, stderr));
        }
        let mut st = load_state(app);
        st.install_kicked_off = true;
        save_state(app, &st)?;
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
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            return Err(format!("wsl --import exit={} stderr={}", code, stderr));
        }
        Ok(())
    }

    pub fn run_bootstrap(app: &tauri::AppHandle) -> Result<String, String> {
        let out = wsl_command()
            .args([
                "--distribution",
                DISTRO_NAME,
                "--",
                "/opt/papercup/bootstrap",
            ])
            .output()
            .map_err(|e| format!("spawn wsl bootstrap: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
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

// ─── Tauri command surface (always compiles) ────────────────────────

#[tauri::command]
#[specta::specta]
pub fn wsl_status(_app: tauri::AppHandle) -> WslStatus {
    #[cfg(target_os = "windows")]
    {
        return imp::detect(&_app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        WslStatus::unsupported()
    }
}

#[tauri::command]
#[specta::specta]
pub fn wsl_install(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return imp::install(&_app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("wsl_install: only supported on Windows".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn wsl_import(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        let tarball = _app
            .path()
            .resolve(ROOTFS_FILENAME, tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("resolve rootfs: {}", e))?;
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
