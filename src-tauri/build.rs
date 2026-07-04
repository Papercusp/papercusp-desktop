use std::path::Path;

/// EI-160 (point 2): `src-tauri/sidecar/` is a gitignored ~2.2GB artifact
/// (bin/build-desktop-sidecar.sh). On a fresh or cleaned checkout it is
/// absent, and `generate_context!`'s `bundle.resources` globs
/// (`sidecar/**/*` + `sidecar/db-sql/*`) then fail the WHOLE build —
/// cargo build / tauri dev / tauri build alike — with a cryptic
/// "path not found or didn't match any files", nothing pointing at the
/// sidecar build script.
///
/// Dev builds never spawn the sidecar (main.rs skips it under
/// debug_assertions), so a placeholder file per glob is enough to compile.
/// A REAL bundle must still run bin/build-desktop-sidecar.sh first — the
/// packaging path (bin/release-local.sh) already does, and its atomic
/// `mv -T` publish replaces this placeholder tree wholesale (P-056).
fn ensure_sidecar_placeholder(manifest_dir: &Path) {
    let sidecar = manifest_dir.join("sidecar");
    if sidecar.join("serve.mjs").exists() {
        return;
    }
    let db_sql = sidecar.join("db-sql");
    std::fs::create_dir_all(&db_sql).expect("create sidecar placeholder dirs");
    let note = "Placeholder created by build.rs so the bundle.resources globs match on a\n\
                fresh checkout (EI-160). Dev builds never spawn the sidecar; for a real\n\
                bundle run bin/build-desktop-sidecar.sh, which replaces this directory\n\
                atomically.\n";
    std::fs::write(sidecar.join("PLACEHOLDER-README.txt"), note)
        .expect("write sidecar placeholder");
    std::fs::write(db_sql.join("PLACEHOLDER-README.txt"), note).expect("write db-sql placeholder");
    println!(
        "cargo:warning=src-tauri/sidecar/ has no serve.mjs — placeholder created so the \
         build can proceed. Dev is fine (the sidecar is never spawned); DO NOT package \
         this tree without running bin/build-desktop-sidecar.sh first."
    );
}

fn main() {
    ensure_sidecar_placeholder(Path::new(env!("CARGO_MANIFEST_DIR")));
    println!("cargo:rerun-if-changed=sidecar/serve.mjs");
    // Build provenance: rebuild main.rs when the build sets a new git sha so
    // `option_env!("PAPERCUSP_BUILD_SHA")` re-bakes (the operator forwards it
    // to /api/health). Without this, cargo's cache would freeze a stale sha.
    println!("cargo:rerun-if-env-changed=PAPERCUSP_BUILD_SHA");

    // WI-1976 / WI-2143 — allow the renderer to invoke the native-shell app commands.
    // The operator SPA loads from a REMOTE http origin (http://127.0.0.1:<port>),
    // and Tauri 2's ACL rejects app-command invoke()s from a non-local origin
    // ("<cmd> not allowed. Command not found") unless a capability grants them.
    // Because the commands are registered via tauri-specta's collect_commands!
    // (not the generate_handler! macro the build script scans), Tauri never
    // generates their allow-<command> permissions on its own — so there is
    // nothing for capabilities/default.json to grant, and every un-listed
    // command is silently dead from the webview.
    //
    // WI-1976 listed only console_launch / list_windows_by_title /
    // focus_window_by_title / __dev_bridge_result — added reactively as each
    // feature broke. That left the REST of collect_commands! (workspaces_*,
    // app_version/check_for_update/install_update, pty_*, wsl_*,
    // native_terminal_*, endpoint_ipc::*, env_switch::list_envs,
    // show_attention_notification) ACL-dead — surfacing as the recurring
    // "workspaces_list not allowed. Command not found" toast (WI-2143) and a
    // whole class of silently-broken desktop commands (version chip never
    // resolves, terminals/WSL/env-switch invoke()s rejected).
    //
    // This list MUST mirror main.rs `collect_commands![]` (module prefix
    // stripped): every specta-collected command needs its allow-<command>
    // permission generated here AND granted in capabilities/default.json.
    // The drift that caused WI-2143 is now guarded by a CI test —
    // packages/operator-core/lib/desktop-acl-command-sync.test.ts fails if
    // collect_commands!, this list, and the capability grants diverge. When you
    // add/remove a collect_commands! entry, update THIS list + the capability
    // in the same change (the test tells you exactly what drifted).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            // workspaces (WorkspaceSwitcher / HarnessWorkspacesButton)
            "workspaces_list",
            "workspaces_create",
            "workspaces_rename",
            "workspaces_delete",
            "workspaces_switch",
            "workspaces_open_window",
            // attention / update chip
            "show_attention_notification",
            "app_version",
            "check_for_update",
            "install_update",
            // pty (desktop terminals)
            "pty_spawn",
            "pty_write",
            "pty_resize",
            "pty_kill",
            "pty_history",
            "pty_is_alive",
            // WSL setup wizard
            "wsl_status",
            "wsl_install",
            "wsl_relaunch_elevated",
            "wsl_import",
            "wsl_bootstrap",
            "wsl_finalize_ready",
            "wsl_uninstall",
            // native console / window control (WI-1976 originals)
            "console_launch",
            "list_windows_by_title",
            "focus_window_by_title",
            // window_title_for is a plain Rust helper, not a #[tauri::command];
            // its grant is an inert orphan kept for continuity (harmless).
            "window_title_for",
            // native terminal toggle
            "native_terminal_status",
            "native_terminal_toggle",
            // endpoint IPC transport (currently no live JS caller, but
            // collect_commands! exposes it, so grant to stay in sync)
            "endpoint_invoke",
            "endpoint_cancel",
            // env switcher
            "list_envs",
            // The dev-bridge eval return channel (debug builds). Without this
            // grant the injected eval JS's invoke() is ACL-rejected from the
            // remote http origin, so every tauri-agent-tools eval/click/dom
            // call times out — the fleet-wide "wedged shell" symptom.
            "__dev_bridge_result",
        ]),
    ))
    .expect("failed to run tauri_build with the app-command manifest (WI-1976)");
}
