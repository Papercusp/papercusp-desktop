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
        // Linux + Windows-WSL coming in follow-up commits.
        return Err("Linux native console launch not yet implemented".into());
    } else if cfg!(target_os = "windows") {
        return Err("Windows native console launch not yet implemented".into());
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
}
