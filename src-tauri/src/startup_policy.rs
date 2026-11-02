//! Device/OS-user startup choices, available before an operator exists.
//!
//! Reuses the desktop's local settings directory and auto-launch OS adapter.
//! A separate typed file is necessary because workspace/PG preferences cannot
//! be read while the backend is stopped. Never reconcile by enabling login:
//! only an explicit native settings action may change an OS registration.

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static CURRENT_START_TRIGGER: OnceLock<StartTrigger> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartTrigger {
    Manual,
    Login,
    Supervisor,
    Upgrade,
    Repair,
    Unknown,
}

impl StartTrigger {
    pub fn marker(self) -> &'static str {
        match self {
            Self::Manual => "--startup-trigger=manual",
            Self::Login => "--startup-trigger=login",
            Self::Supervisor => "--startup-trigger=supervisor",
            Self::Upgrade => "--startup-trigger=upgrade",
            Self::Repair => "--startup-trigger=repair",
            Self::Unknown => "--startup-trigger=unknown",
        }
    }

    fn from_launch(args: &[String], gui: bool) -> Self {
        let has = |arg: &str| args.iter().any(|value| value == arg);
        if has("--manual-start") { Self::Manual }
        else if has("--upgrade") { Self::Upgrade }
        else if has("--repair") { Self::Repair }
        else if has("--restart") { Self::Unknown }
        else if has("--startup") { Self::Login }
        // A service invocation cannot distinguish boot, user action and an OS
        // restart. Preserve that uncertainty instead of inventing a cause.
        else if gui && !has("--headless-service") { Self::Manual }
        else { Self::Unknown }
    }
}

pub fn current_start_trigger() -> StartTrigger {
    CURRENT_START_TRIGGER.get().copied().unwrap_or(StartTrigger::Unknown)
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub revision: u64,
    pub start_at_login: Option<bool>,
    pub keep_running_after_close: bool,
    pub clean_stop: bool,
}

impl Policy {
    fn parse(v: &Map<String, Value>) -> io::Result<Self> {
        if v.get("schemaVersion")
            .is_some_and(|x| x.as_u64() != Some(1))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Unsupported startup policy version",
            ));
        }
        // Reject malformed known fields instead of replacing them with defaults.
        for key in ["startAtLogin", "keepRunningAfterClose", "cleanStop"] {
            if v.get(key)
                .is_some_and(|x| !x.is_boolean() && !(key == "startAtLogin" && x.is_null()))
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Invalid startup policy field",
                ));
            }
        }
        if v.get("revision").is_some_and(|x| x.as_u64().is_none()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid startup policy revision",
            ));
        }
        Ok(Self {
            revision: v.get("revision").and_then(Value::as_u64).unwrap_or(0),
            start_at_login: v.get("startAtLogin").and_then(Value::as_bool),
            // Preserve the installed behavior until an explicit choice is made.
            keep_running_after_close: v
                .get("keepRunningAfterClose")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            clean_stop: v.get("cleanStop").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

#[derive(Clone)]
pub struct Store(PathBuf);

impl Store {
    pub fn device() -> io::Result<Self> {
        let home = crate::workspaces::real_home();
        if !home.is_absolute() || !home.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "OS user home is unavailable",
            ));
        }
        // Deliberately ignores PAPERCUSP_HOME (which can name a workspace).
        Ok(Self(home.join(".papercusp").join("startup-policy.json")))
    }

    fn document(&self) -> io::Result<Map<String, Value>> {
        match fs::read(&self.0) {
            Ok(bytes) if bytes.len() <= 131_072 => {
                serde_json::from_slice::<Map<String, Value>>(&bytes).map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidData, "Startup policy is unreadable")
                })
            }
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Startup policy is too large",
            )),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Map::new()),
            Err(e) => Err(e),
        }
    }

    pub fn read(&self) -> io::Result<Policy> {
        Policy::parse(&self.document()?)
    }

    /// Kernel-backed lock releases on process death; no stale lease or PID
    /// reclamation. Read-modify-write is entirely inside the cross-process lock.
    fn update<T>(
        &self,
        edit: impl FnOnce(&mut Map<String, Value>, &Policy) -> io::Result<T>,
    ) -> io::Result<T> {
        self.update_with_effect(edit, || Ok(()))
    }

    fn update_with_effect<T>(
        &self,
        edit: impl FnOnce(&mut Map<String, Value>, &Policy) -> io::Result<T>,
        effect: impl FnOnce() -> io::Result<()>,
    ) -> io::Result<T> {
        let parent = self
            .0
            .parent()
            .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
        fs::create_dir_all(parent)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.0.with_extension("lock"))?;
        lock.lock_exclusive()?;
        let mut doc = self.document()?;
        let original = doc.clone();
        let before = Policy::parse(&doc)?;
        let result = edit(&mut doc, &before)?;
        // The revision, known fields, and future fields commit together.
        if doc != original {
            let next_revision = before.revision.checked_add(1).ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Startup policy revision exhausted",
                )
            })?;
            let mut history = original
                .get("history")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| io::Error::other("System clock is unavailable"))?
                .as_millis() as u64;
            for key in ["startAtLogin", "keepRunningAfterClose", "cleanStop"] {
                if doc.get(key) != original.get(key) {
                    history.push(serde_json::json!({ "field": key, "value": doc.get(key), "revision": next_revision, "at": at, "source": "native-settings" }));
                }
            }
            if history.len() > 100 {
                history.drain(..history.len() - 100);
            }
            doc.insert("history".into(), Value::Array(history));
            doc.insert("schemaVersion".into(), Value::from(1));
            doc.insert("revision".into(), Value::from(next_revision));
            let bytes = serde_json::to_vec_pretty(&doc)?;
            let (tmp, mut file) = loop {
                let tmp = self.0.with_extension(format!(
                    "{}.{}.tmp",
                    std::process::id(),
                    SEQUENCE.fetch_add(1, Ordering::Relaxed)
                ));
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                match options.open(&tmp) {
                    Ok(file) => break (tmp, file),
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(e) => return Err(e),
                }
            };
            let written = file.write_all(&bytes).and_then(|_| file.sync_all());
            drop(file);
            if let Err(e) = written.and_then(|_| fs::rename(&tmp, &self.0)) {
                let _ = fs::remove_file(tmp);
                return Err(e);
            }
            #[cfg(unix)]
            File::open(parent)?.sync_all()?;
        }
        // Intent and OS effects are serialized together: an older enable can
        // never race past a newer disable. RAII unlocks on every error branch.
        effect()?;
        drop(lock);
        Ok(result)
    }

    pub fn set_keep_running(&self, value: bool) -> io::Result<()> {
        self.update(|doc, _| {
            doc.insert("keepRunningAfterClose".into(), Value::Bool(value));
            Ok(())
        })
    }

    pub fn set_clean_stop(&self, value: bool) -> io::Result<()> {
        self.update(|doc, _| {
            doc.insert("cleanStop".into(), Value::Bool(value));
            Ok(())
        })
    }

    pub fn set_login(&self, enabled: bool, os: &impl LoginAdapter) -> io::Result<()> {
        self.update_with_effect(
            |doc, _| {
                // Persist intent before an OS write; a failed/partial OS operation
                // is reported and never becomes an automatic retry on relaunch.
                doc.insert("startAtLogin".into(), Value::Bool(enabled));
                Ok(())
            },
            || {
                os.set_enabled(enabled)?;
                if os.is_enabled()? != enabled {
                    return Err(io::Error::other(
                        "OS startup readback did not match the requested choice",
                    ));
                }
                Ok(())
            },
        )
    }
}

pub trait LoginAdapter {
    fn is_enabled(&self) -> io::Result<bool>;
    fn set_enabled(&self, enabled: bool) -> io::Result<()>;
}

pub struct NativeLogin;

#[cfg(target_os = "linux")]
fn systemctl(args: &[&str]) -> io::Result<std::process::Output> {
    crate::wsl_sidecar_staging::run_bounded_output(
        std::process::Command::new("systemctl")
            .arg("--user")
            .args(args),
        std::time::Duration::from_secs(3),
    )
}

#[cfg(target_os = "linux")]
impl LoginAdapter for NativeLogin {
    fn is_enabled(&self) -> io::Result<bool> {
        let output = systemctl(&["is-enabled", "papercusp-server.service"])?;
        match String::from_utf8_lossy(&output.stdout).trim() {
            "enabled" | "enabled-runtime" => Ok(true),
            "disabled" | "masked" | "masked-runtime" => Ok(false),
            _ => Err(io::Error::other(
                "User service registration could not be measured",
            )),
        }
    }
    fn set_enabled(&self, enabled: bool) -> io::Result<()> {
        // A per-user mask is needed to override a package-global enable link.
        let commands: &[&str] = if enabled {
            &["unmask", "enable"]
        } else {
            &["mask"]
        };
        for action in commands {
            if !systemctl(&[action, "papercusp-server.service"])?
                .status
                .success()
            {
                return Err(io::Error::other(
                    "Could not change this user's Server startup registration",
                ));
            }
        }
        Ok(())
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn server_autolaunch() -> io::Result<auto_launch::AutoLaunch> {
    let mut builder = auto_launch::AutoLaunchBuilder::new();
    builder
        .set_app_name("Papercusp Server")
        .set_args(&["--startup"]);
    #[cfg(target_os = "windows")]
    let exe = {
        let root = std::env::var_os("LOCALAPPDATA")
            .ok_or_else(|| io::Error::from(io::ErrorKind::PermissionDenied))?;
        PathBuf::from(root)
            .join("Papercusp Server")
            .join("papercusp-desktop.exe")
    };
    #[cfg(target_os = "macos")]
    let exe = {
        let current = std::env::current_exe()?;
        let bundle = current
            .ancestors()
            .find(|p| p.extension().is_some_and(|e| e == "app"))
            .ok_or_else(|| io::Error::other("Installed Server bundle could not be resolved"))?;
        builder.set_use_launch_agent(true);
        bundle
            .parent()
            .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?
            .join("Papercusp Server.app/Contents/MacOS/papercusp-server")
    };
    if !exe.is_file() {
        return Err(io::Error::other(
            "Papercusp Server must be installed before changing sign-in startup",
        ));
    }
    // auto-launch's Windows adapter writes the value without quoting the path.
    #[cfg(target_os = "windows")]
    let path = format!("\"{}\"", exe.display());
    #[cfg(target_os = "macos")]
    let path = exe.to_string_lossy().into_owned();
    builder
        .set_app_path(&path)
        .build()
        .map_err(|_| io::Error::other("Server login adapter unavailable"))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl LoginAdapter for NativeLogin {
    fn is_enabled(&self) -> io::Result<bool> {
        let enabled = server_autolaunch()?
            .is_enabled()
            .map_err(|_| io::Error::other("OS startup registration could not be measured"))?;
        #[cfg(target_os = "macos")]
        if enabled {
            // The adapter checks only plist existence. launchctl's OS disable
            // override is independent and must not be reported as enabled.
            let domain = format!("gui/{}", unsafe { libc::geteuid() });
            let output = crate::wsl_sidecar_staging::run_bounded_output(
                std::process::Command::new("launchctl").args(["print-disabled", &domain]),
                std::time::Duration::from_secs(3),
            )?;
            if !output.status.success() {
                return Err(io::Error::other("Login domain is unavailable"));
            }
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Some((label, value)) = line.trim().split_once(" => ") {
                    if label == "\"Papercusp Server\""
                        && value.trim_end_matches(';').trim() == "true"
                    {
                        return Ok(false);
                    }
                }
            }
        }
        Ok(enabled)
    }
    fn set_enabled(&self, enabled: bool) -> io::Result<()> {
        let os = server_autolaunch()?;
        if self.is_enabled()? == enabled {
            return Ok(());
        }
        if !enabled && !os.is_enabled().map_err(io::Error::other)? {
            return Ok(());
        }
        (if enabled { os.enable() } else { os.disable() })
            .map_err(|_| io::Error::other("OS startup registration change failed"))?;
        #[cfg(target_os = "macos")]
        if enabled {
            let key = format!("gui/{}/Papercusp Server", unsafe { libc::geteuid() });
            if !crate::wsl_sidecar_staging::run_bounded_output(
                std::process::Command::new("launchctl").args(["enable", &key]),
                std::time::Duration::from_secs(3),
            )?
            .status
            .success()
            {
                return Err(io::Error::other("OS login override could not be changed"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub policy: Policy,
    pub login_enabled: Option<bool>,
    pub login_error: Option<String>,
    pub boot_enabled: Option<bool>,
    pub boot_installed: Option<bool>,
    pub boot_mechanism: String,
    pub boot_handoff: String,
}

/// Registration and enabled state are independent. Inaccessible OS state must
/// remain unknown; a present plist/task alone does not prove enabled/running.
#[derive(Debug, PartialEq, Eq)]
struct BootRegistration {
    installed: Option<bool>,
    enabled: Option<bool>,
}

#[cfg(target_os = "macos")]
fn boot_registration() -> BootRegistration {
    let path = PathBuf::from("/Library/LaunchDaemons/com.papercusp.server.plist");
    match fs::metadata(&path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return BootRegistration {
                installed: Some(false),
                enabled: Some(false),
            }
        }
        Err(_) => {
            return BootRegistration {
                installed: None,
                enabled: None,
            }
        }
        Ok(_) => {}
    }
    let output = crate::wsl_sidecar_staging::run_bounded_output(
        std::process::Command::new("launchctl").args(["print-disabled", "system"]),
        std::time::Duration::from_secs(3),
    );
    let disabled = output.ok().filter(|o| o.status.success()).and_then(|o| {
        String::from_utf8_lossy(&o.stdout).lines().find_map(|line| {
            let (key, value) = line.trim().split_once(" => ")?;
            if key != "\"com.papercusp.server\"" {
                return None;
            }
            match value.trim_end_matches(';').trim() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            }
        })
    });
    let enabled = if disabled == Some(true) {
        Some(false)
    } else {
        crate::wsl_sidecar_staging::run_bounded_output(
            std::process::Command::new("launchctl").args(["print", "system/com.papercusp.server"]),
            std::time::Duration::from_secs(3),
        )
        .ok()
        .filter(|o| o.status.success())
        .map(|_| true)
    };
    BootRegistration {
        installed: Some(true),
        enabled,
    }
}

#[cfg(target_os = "windows")]
fn boot_registration() -> BootRegistration {
    // Read-only inspection. Services/tasks may require elevation; do not turn
    // AccessDenied or an incomplete census into "not installed".
    let script = r#"$ErrorActionPreference='Stop'
$services=@(Get-CimInstance Win32_Service | Where-Object { $_.Name -like '*Papercusp*' -and $_.PathName -like '*Papercusp*' })
$tasks=@(Get-ScheduledTask | Where-Object { ($_.Actions | Where-Object { $_.Execute -like '*Papercusp*' }).Count -gt 0 -and ($_.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' }).Count -gt 0 })
$boot=@($services | Where-Object { $_.StartMode -eq 'Auto' })
$enabledTasks=@($tasks | Where-Object { $_.Settings.Enabled })
@{installed=($services.Count -gt 0 -or $tasks.Count -gt 0);enabled=($boot.Count -gt 0 -or $enabledTasks.Count -gt 0)} | ConvertTo-Json -Compress
"#;
    let output = crate::wsl_sidecar_staging::run_bounded_output(
        std::process::Command::new("powershell.exe").args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ]),
        std::time::Duration::from_secs(5),
    );
    let result = output
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| serde_json::from_slice::<Value>(&o.stdout).ok());
    BootRegistration {
        installed: result.as_ref().and_then(|v| v["installed"].as_bool()),
        enabled: result.as_ref().and_then(|v| v["enabled"].as_bool()),
    }
}

pub fn status() -> io::Result<Status> {
    let policy = Store::device()?.read()?;
    let login = NativeLogin.is_enabled();
    let login_enabled = login.as_ref().ok().copied();
    let login_error = login
        .err()
        .map(|_| "Sign-in registration is unavailable; check the OS startup settings.".into());
    #[cfg(target_os = "linux")]
    let (boot_enabled, boot_installed, boot_mechanism, boot_handoff) = {
        let uid = unsafe { libc::geteuid() }.to_string();
        let linger = crate::wsl_sidecar_staging::run_bounded_output(
            std::process::Command::new("loginctl").args([
                "show-user",
                &uid,
                "--property=Linger",
                "--value",
            ]),
            std::time::Duration::from_secs(3),
        );
        let linger =
            linger
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| match String::from_utf8_lossy(&o.stdout).trim() {
                    "yes" => Some(true),
                    "no" => Some(false),
                    _ => None,
                });
        let installed = systemctl(&[
            "show",
            "papercusp-server.service",
            "--property=LoadState",
            "--value",
        ])
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| match String::from_utf8_lossy(&o.stdout).trim() {
            "loaded" | "masked" => Some(true),
            "not-found" => Some(false),
            _ => None,
        });
        (match (login_enabled, linger) { (Some(false), _) | (_, Some(false)) => Some(false), (Some(true), Some(true)) => Some(true), _ => None }, installed,
         "systemd user service and account linger", "For boot without sign-in, an administrator can run papercusp-server-enable-boot-start for your account. Disabling sign-in startup also blocks this user service at boot.")
    };
    #[cfg(target_os = "macos")]
    let (boot_enabled, boot_installed, boot_mechanism, boot_handoff) = {
        let b = boot_registration();
        (b.enabled, b.installed, "launchd system/com.papercusp.server", "An administrator must inspect or change the installed com.papercusp.server LaunchDaemon with launchctl. Sign-in settings do not disable a machine service.")
    };
    #[cfg(target_os = "windows")]
    let (boot_enabled, boot_installed, boot_mechanism, boot_handoff) = {
        let b = boot_registration();
        (b.enabled, b.installed, "Windows Services and Task Scheduler", "An administrator must inspect Papercusp boot services or tasks in Services and Task Scheduler. Sign-in settings do not disable a machine service.")
    };
    Ok(Status {
        policy,
        login_enabled,
        login_error,
        boot_enabled,
        boot_installed,
        boot_mechanism: boot_mechanism.into(),
        boot_handoff: boot_handoff.into(),
    })
}

/// Missing/corrupt policy never permits a supervisor to resurrect cleanly
/// stopped work. Required native settings/recovery remain reachable.
pub fn automatic_start_allowed() -> bool {
    Store::device()
        .and_then(|s| s.read())
        .is_ok_and(|p| !p.clean_stop)
}

pub fn clean_stop_requested() -> bool {
    Store::device()
        .and_then(|s| s.read())
        .is_ok_and(|p| p.clean_stop)
}

/// --startup belongs to OS registration. --manual-start is an explicit user
/// service launch; ordinary Server launches stay conservative because older
/// registrations have no marker. Preference/repair/restart never clears stop.
pub fn apply_launch_intent(store: &Store, args: &[String], gui: bool) -> io::Result<()> {
    let automatic = args
        .iter()
        .any(|s| matches!(s.as_str(), "--startup" | "--headless-service"));
    let explicit = args.iter().any(|s| s == "--manual-start");
    let restore = args
        .iter()
        .any(|s| matches!(s.as_str(), "--restart" | "--upgrade" | "--repair"));
    if explicit || (gui && !automatic && !restore) {
        store.set_clean_stop(false)?;
    }
    Ok(())
}

pub fn apply_current_launch(gui: bool) -> io::Result<()> {
    let mut args: Vec<String> = std::env::args().collect();
    if std::env::var_os("PAPERCUSP_NATIVE_POLICY_RESTART").is_some() {
        args.push("--restart".into());
        std::env::remove_var("PAPERCUSP_NATIVE_POLICY_RESTART");
    }
    // A dev verifier shares the OS identity but is not a user relaunch.
    // Explicit --manual-start remains testable in a disposable OS account.
    let gui = gui && !cfg!(debug_assertions);
    let _ = CURRENT_START_TRIGGER.set(StartTrigger::from_launch(&args, gui));
    apply_launch_intent(&Store::device()?, &args, gui)
}

#[tauri::command]
#[specta::specta]
pub fn startup_policy_status() -> Result<Status, String> {
    status().map_err(|_| "Native startup policy could not be read".into())
}

#[tauri::command]
#[specta::specta]
pub fn startup_policy_set_login(enabled: bool) -> Result<Status, String> {
    Store::device()
        .and_then(|s| s.set_login(enabled, &NativeLogin))
        .map_err(|e| e.to_string())?;
    startup_policy_status()
}

#[tauri::command]
#[specta::specta]
pub fn startup_policy_set_keep_running(enabled: bool) -> Result<Status, String> {
    Store::device()
        .and_then(|s| s.set_keep_running(enabled))
        .map_err(|_| "Native startup choice could not be saved".to_string())?;
    startup_policy_status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn launch_provenance_preserves_explicit_causes_and_service_uncertainty() {
        for (args, gui, expected) in [
            (vec!["--manual-start", "--headless-service"], false, StartTrigger::Manual),
            (vec!["--startup"], false, StartTrigger::Login),
            (vec!["--upgrade", "--startup"], false, StartTrigger::Upgrade),
            (vec!["--repair"], true, StartTrigger::Repair),
            (vec!["--restart", "--startup"], true, StartTrigger::Unknown),
            (vec!["--headless-service"], false, StartTrigger::Unknown),
            (vec![], false, StartTrigger::Unknown),
            (vec![], true, StartTrigger::Manual),
        ] {
            let args = args.into_iter().map(String::from).collect::<Vec<_>>();
            assert_eq!(StartTrigger::from_launch(&args, gui), expected);
        }
        assert_eq!(StartTrigger::Supervisor.marker(), "--startup-trigger=supervisor");
        assert_eq!(StartTrigger::Unknown.marker(), "--startup-trigger=unknown");
    }

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "papercusp-startup-policy-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn store(&self) -> Store {
            Store(self.0.join("startup-policy.json"))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn preserves_opt_out_through_relaunch_and_upgrade() {
        let f = Fixture::new();
        let s = f.store();
        s.update(|v, _| {
            v.insert("startAtLogin".into(), Value::Bool(false));
            v.insert("futureConsent".into(), serde_json::json!({"network":false}));
            Ok(())
        })
        .unwrap();
        s.set_keep_running(false).unwrap();
        let restarted = f.store();
        assert_eq!(restarted.read().unwrap().start_at_login, Some(false));
        assert_eq!(
            restarted.document().unwrap()["futureConsent"]["network"],
            false
        );
    }

    #[test]
    fn clean_stop_is_durable_and_preferences_do_not_resume_it() {
        let f = Fixture::new();
        let s = f.store();
        s.set_clean_stop(true).unwrap();
        s.set_keep_running(true).unwrap();
        assert!(f.store().read().unwrap().clean_stop);
        s.set_clean_stop(false).unwrap();
        assert!(!s.read().unwrap().clean_stop);
    }

    #[test]
    fn only_manual_launch_clears_clean_stop_not_upgrade_or_login() {
        let f = Fixture::new();
        let s = f.store();
        for (args, gui) in [
            (vec!["--startup"], false),
            (vec!["--headless-service"], false),
            (vec![], false),
            (vec!["--upgrade"], true),
            (vec!["--repair"], true),
            (vec!["--restart"], true),
        ] {
            s.set_clean_stop(true).unwrap();
            apply_launch_intent(
                &s,
                &args.into_iter().map(String::from).collect::<Vec<_>>(),
                gui,
            )
            .unwrap();
            assert!(s.read().unwrap().clean_stop);
        }
        for (args, gui) in [
            (vec![], true),
            (vec!["--manual-start", "--headless-service"], false),
        ] {
            s.set_clean_stop(true).unwrap();
            apply_launch_intent(
                &s,
                &args.into_iter().map(String::from).collect::<Vec<_>>(),
                gui,
            )
            .unwrap();
            assert!(!s.read().unwrap().clean_stop);
        }
    }

    #[test]
    fn concurrent_preserving_updates_are_serialized() {
        let f = Fixture::new();
        let s = Arc::new(f.store());
        let jobs: Vec<_> = (0..16)
            .map(|i| {
                let s = s.clone();
                std::thread::spawn(move || {
                    s.update(|v, _| {
                        v.insert(format!("future-{i}"), Value::Bool(true));
                        Ok(())
                    })
                    .unwrap()
                })
            })
            .collect();
        for job in jobs {
            job.join().unwrap();
        }
        assert_eq!(s.read().unwrap().revision, 16);
        for i in 0..16 {
            assert_eq!(s.document().unwrap()[&format!("future-{i}")], true);
        }
    }

    #[test]
    fn malformed_or_newer_policy_is_not_overwritten() {
        let f = Fixture::new();
        let s = f.store();
        for raw in [
            "{",
            "[]",
            "{\"schemaVersion\":2}",
            "{\"schemaVersion\":\"1\"}",
            "{\"cleanStop\":\"false\"}",
            "{\"revision\":-1}",
            "{\"revision\":18446744073709551615}",
        ] {
            fs::write(&s.0, raw).unwrap();
            assert!(s.set_keep_running(true).is_err());
            assert_eq!(fs::read_to_string(&s.0).unwrap(), raw);
        }
    }

    #[test]
    fn missing_policy_keeps_login_unselected_and_does_not_create_registration() {
        let f = Fixture::new();
        let p = f.store().read().unwrap();
        assert_eq!(p.start_at_login, None);
        assert!(p.keep_running_after_close);
        assert!(!p.clean_stop);
        assert!(!f.store().0.exists());
    }

    #[test]
    fn failed_os_write_keeps_intent_without_claiming_os_success() {
        struct Fails;
        impl LoginAdapter for Fails {
            fn is_enabled(&self) -> io::Result<bool> {
                Ok(true)
            }
            fn set_enabled(&self, _: bool) -> io::Result<()> {
                Err(io::Error::from(io::ErrorKind::PermissionDenied))
            }
        }
        let f = Fixture::new();
        let s = f.store();
        assert!(s.set_login(false, &Fails).is_err());
        assert_eq!(f.store().read().unwrap().start_at_login, Some(false));
    }

    #[test]
    fn os_readback_mismatch_is_not_success() {
        struct Refuses;
        impl LoginAdapter for Refuses {
            fn is_enabled(&self) -> io::Result<bool> {
                Ok(false)
            }
            fn set_enabled(&self, _: bool) -> io::Result<()> {
                Ok(())
            }
        }
        let f = Fixture::new();
        assert!(f.store().set_login(true, &Refuses).is_err());
        assert_eq!(f.store().read().unwrap().start_at_login, Some(true));
    }

    #[test]
    fn newer_disable_waits_for_earlier_os_enable_and_wins() {
        use std::sync::{mpsc, Mutex};
        struct SlowOs {
            value: Mutex<bool>,
            entered: mpsc::Sender<()>,
            resume: Mutex<mpsc::Receiver<()>>,
        }
        impl LoginAdapter for SlowOs {
            fn is_enabled(&self) -> io::Result<bool> {
                Ok(*self.value.lock().unwrap())
            }
            fn set_enabled(&self, v: bool) -> io::Result<()> {
                if v {
                    self.entered.send(()).unwrap();
                    self.resume.lock().unwrap().recv().unwrap();
                }
                *self.value.lock().unwrap() = v;
                Ok(())
            }
        }
        let f = Fixture::new();
        let s = Arc::new(f.store());
        let (entered, entered_rx) = mpsc::channel();
        let (resume_tx, resume) = mpsc::channel();
        let os = Arc::new(SlowOs {
            value: Mutex::new(false),
            entered,
            resume: Mutex::new(resume),
        });
        let a = {
            let s = s.clone();
            let os = os.clone();
            std::thread::spawn(move || s.set_login(true, os.as_ref()).unwrap())
        };
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let (done, done_rx) = mpsc::channel();
        let b = {
            let s = s.clone();
            let os = os.clone();
            std::thread::spawn(move || {
                s.set_login(false, os.as_ref()).unwrap();
                done.send(()).unwrap();
            })
        };
        assert!(done_rx
            .recv_timeout(std::time::Duration::from_millis(50))
            .is_err());
        resume_tx.send(()).unwrap();
        a.join().unwrap();
        b.join().unwrap();
        assert!(!os.is_enabled().unwrap());
        assert_eq!(s.read().unwrap().start_at_login, Some(false));
        assert_eq!(s.read().unwrap().revision, 2);
    }

    #[test]
    fn history_is_bounded_and_contains_only_choice_metadata() {
        let f = Fixture::new();
        let s = f.store();
        for i in 0..110 {
            s.set_keep_running(i % 2 == 0).unwrap();
        }
        let doc = s.document().unwrap();
        let rows = doc["history"].as_array().unwrap();
        assert_eq!(rows.len(), 100);
        for row in rows {
            let fields: std::collections::BTreeSet<_> = row
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(
                fields,
                ["field", "value", "revision", "at", "source"]
                    .into_iter()
                    .collect()
            );
            assert!(row["value"].is_boolean());
        }
    }
}
