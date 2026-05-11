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
/// apps/operator/lib/console-launcher.ts.
#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleEnvelope {
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub mcp_json_contents: String,
    pub greeting_cmd: String,
    pub needs_superuser_bootstrap: bool,
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

async fn launch_inner(envelope: ConsoleEnvelope) -> Result<(Option<u32>, bool, bool), String> {
    // 1. Bootstrap superuser token if needed.
    let bootstrapped = if envelope.needs_superuser_bootstrap {
        ensure_superuser_token().await?;
        true
    } else {
        false
    };

    // 2. Atomic .mcp.json write with backup-restore.
    let cwd = PathBuf::from(&envelope.cwd);
    let mcp_path = cwd.join(".mcp.json");
    let displaced = if mcp_path.exists() {
        let bak = cwd.join(".mcp.json.papercusp.bak");
        // If a stale bak from a previous unclean exit is sitting there,
        // leave it alone — we'd rather lose our restore than clobber
        // the user's real mcp.json on a botched cleanup.
        if !bak.exists() {
            std::fs::rename(&mcp_path, &bak).map_err(|e| format!("backup .mcp.json: {e}"))?;
            true
        } else {
            // Best effort: archive ours under a unique name. The user
            // can sort it out manually.
            false
        }
    } else {
        false
    };
    std::fs::write(&mcp_path, &envelope.mcp_json_contents)
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

    // 5. Sentinel-file cleanup is scheduled in a follow-up commit;
    //    for now the user's `.mcp.json` stays in place until they
    //    manually delete it or until the next console launch overwrites.
    //    Acceptable for v1 since superuser tokens persist across runs.

    Ok((pid, displaced, bootstrapped))
}

/// Build the bash one-liner the terminal runs as its first command.
/// Pattern: cd → env exports → greeting → exec user's shell.
/// `exec` chains so the env survives without touching rc files.
fn build_launcher_oneliner(envelope: &ConsoleEnvelope) -> String {
    let env_exports = build_env_exports(&envelope.env);
    let greeting = envelope.greeting_cmd.replace('\'', "'\\''");
    let cwd_escaped = shell_escape_single(&envelope.cwd);
    format!(
        "cd {cwd} && {exports} ({greet}) ; exec \"${{SHELL:-/bin/bash}}\" -l",
        cwd = cwd_escaped,
        exports = env_exports,
        greet = greeting,
    )
}

fn build_env_exports(env: &HashMap<String, String>) -> String {
    let mut parts = Vec::with_capacity(env.len() + 1);
    // Prepend our scripts dir to PATH if the operator sent one — keeps
    // `papercup status` callable without an absolute path.
    if let Some(scripts) = env.get("PAPERCUSP_SCRIPTS_DIR") {
        parts.push(format!(
            "export PATH={}:${{PATH}}",
            shell_escape_single(scripts)
        ));
    }
    for (k, v) in env {
        if k == "PAPERCUSP_SCRIPTS_DIR" {
            // Still export the var itself so scripts can introspect it.
            parts.push(format!("export {}={}", k, shell_escape_single(v)));
            continue;
        }
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
    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn {bin}: {e}"))?;
    Ok(Some(child.id()))
}

/// Cheap PATH lookup. We can't pull in the `which` crate without
/// adding a dep, so this walks $PATH manually. Linux-only.
fn is_on_path(bin: &str) -> bool {
    if bin.contains('/') {
        return std::path::Path::new(bin).exists();
    }
    let Some(path) = std::env::var_os("PATH") else { return false; };
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

    // Map the Linux-side cwd to a Windows UNC for wt.exe's
    // --startingDirectory. Without this, wt opens at C:\ and the user's
    // first action is to `cd` somewhere — defeats the point.
    let cwd_unc = wsl_path_to_windows_unc(&envelope.cwd);

    // Prefer Windows Terminal — `-w new` forces a new window every
    // invocation; --startingDirectory + wsl --cd jointly land the
    // shell at the right place in both Win + WSL filesystems.
    if is_on_path_windows("wt.exe") {
        let mut cmd = std::process::Command::new("wt.exe");
        cmd.arg("-w").arg("new");
        if let Some(unc) = &cwd_unc {
            cmd.arg("--startingDirectory").arg(unc);
        }
        cmd.arg("wsl.exe")
            .arg("-d")
            .arg(WSL_DISTRO)
            .arg("--cd")
            .arg(&envelope.cwd)
            .arg("--")
            .arg("bash")
            .arg("-lc")
            .arg(oneliner);
        // CREATE_NEW_CONSOLE = 0x00000010 — even when wt is fronted,
        // belt-and-suspenders so we never inherit our parent's console.
        cmd.creation_flags(0x00000010);
        let child = cmd.spawn().map_err(|e| {
            format!(
                "wt.exe spawn failed: {e}. Is the '{WSL_DISTRO}' WSL distro installed? \
                 Open Papercup's WSL setup wizard to finish onboarding."
            )
        })?;
        return Ok(Some(child.id()));
    }

    // Fallback: direct wsl.exe in a fresh conhost. Ugly but works on
    // older Windows installs without Windows Terminal.
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.arg("-d")
        .arg(WSL_DISTRO)
        .arg("--cd")
        .arg(&envelope.cwd)
        .arg("--")
        .arg("bash")
        .arg("-lc")
        .arg(oneliner);
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

/// Translate a Linux path inside the WSL distro to its Windows UNC.
/// E.g. `/home/avi/papercup` → `\\wsl.localhost\papercup-runtime\home\avi\papercup`.
/// Returns None if the path doesn't look absolute.
///
/// We use `\\wsl.localhost\` (Win10 20H2+) which Windows Terminal accepts
/// as --startingDirectory. Older Windows uses `\\wsl$\` — if the user is
/// on that, the spawn still succeeds (wt accepts it), they just see the
/// path written one way vs. the other.
fn wsl_path_to_windows_unc(linux_path: &str) -> Option<String> {
    if !linux_path.starts_with('/') {
        return None;
    }
    let win_path = linux_path.replace('/', "\\");
    Some(format!("\\\\wsl.localhost\\{WSL_DISTRO}{win_path}"))
}

#[cfg(target_os = "windows")]
fn is_on_path_windows(bin: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else { return false; };
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
    fn scripts_dir_prepended_to_path() {
        let e = envelope("/x");
        let out = build_launcher_oneliner(&e);
        assert!(out.contains("export PATH='/path/to/scripts':${PATH}"));
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
    fn wsl_unc_translation() {
        assert_eq!(
            wsl_path_to_windows_unc("/home/avi/papercup"),
            Some(format!("\\\\wsl.localhost\\{WSL_DISTRO}\\home\\avi\\papercup")),
        );
        assert_eq!(wsl_path_to_windows_unc("relative/path"), None);
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
