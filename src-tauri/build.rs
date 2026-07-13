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
    let db_sql = sidecar.join("db-sql");
    let has_serve = sidecar.join("serve.mjs").exists();
    let has_db_sql_entry = std::fs::read_dir(&db_sql)
        .ok()
        .and_then(|mut entries| entries.next())
        .is_some();
    // Validate every resource glob independently. A partially materialized
    // sidecar can contain serve.mjs while db-sql is absent (the green
    // checkpoint clean-copy shape); the old early return then let
    // tauri_build panic on sidecar/db-sql/*.
    if has_serve && has_db_sql_entry {
        return;
    }
    std::fs::create_dir_all(&db_sql).expect("create sidecar placeholder dirs");
    let note = "Placeholder created by build.rs so the bundle.resources globs match on a\n\
                fresh checkout (EI-160). Dev builds never spawn the sidecar; for a real\n\
                bundle run bin/build-desktop-sidecar.sh, which replaces this directory\n\
                atomically.\n";
    if !has_serve {
        std::fs::write(sidecar.join("PLACEHOLDER-README.txt"), note)
            .expect("write sidecar placeholder");
    }
    if !has_db_sql_entry {
        std::fs::write(db_sql.join("PLACEHOLDER-README.txt"), note)
            .expect("write db-sql placeholder");
    }
    println!(
        "cargo:warning=src-tauri/sidecar/ has no serve.mjs — placeholder created so the \
         build can proceed. Dev is fine (the sidecar is never spawned); DO NOT package \
         this tree without running bin/build-desktop-sidecar.sh first."
    );
}

/// EI-9412: `src-tauri/seed/` is a gitignored, out-of-band-provisioned directory
/// (papercusp-desktop/.gitignore: "Provision the seed out-of-band; git must not
/// carry it.", plan hive-seed-bundle-2026-07-04 / WI-3346). On a fresh or
/// cleaned checkout (e.g. the green-checkpoint test tree, which is reset+cleaned
/// every run and never runs `bin/ensure-release-seed.sh`) it is absent, and
/// `generate_context!`'s `bundle.resources` glob (`seed/**/*`) then panics the
/// WHOLE build — including a plain `cargo test`/`cargo build`, which never goes
/// through the Tauri CLI lifecycle (`beforeBuildCommand`) at all — with "glob
/// pattern seed/**/* path not found or didn't match any files", nothing
/// pointing at the seed-cut script. This is the exact EI-160 failure shape
/// (see `ensure_sidecar_placeholder` above) recurring for a second gitignored
/// resource glob added later without the same guard.
///
/// Dev/test builds never read the seed at runtime unless the offline-restore
/// path is actually exercised, so a placeholder file is enough to compile. A
/// REAL bundle must still run `bin/ensure-release-seed.sh` first — every
/// release script (release-local.sh, mac-vm-build.sh, build-windows-on-vm.sh)
/// already does, and a fresh cut replaces this placeholder tree wholesale.
fn ensure_seed_placeholder(manifest_dir: &Path) {
    let seed = manifest_dir.join("seed");
    if seed.join("manifest.json").exists() {
        return;
    }
    std::fs::create_dir_all(&seed).expect("create seed placeholder dir");
    let note = "Placeholder created by build.rs so the bundle.resources glob matches on a\n\
                fresh/cleaned checkout (EI-9412, mirrors EI-160's sidecar placeholder). Dev\n\
                and test builds never read the seed unless the offline-restore path is\n\
                exercised; for a real bundle run bin/ensure-release-seed.sh (every release\n\
                script already does), which replaces this directory wholesale.\n";
    std::fs::write(seed.join("PLACEHOLDER-README.txt"), note).expect("write seed placeholder");
    println!(
        "cargo:warning=src-tauri/seed/ has no manifest.json — placeholder created so the \
         build can proceed. Dev/test is fine; DO NOT package this tree without running \
         bin/ensure-release-seed.sh first."
    );
}

fn main() {
    // Read this at build-script RUN time, not via env! at compile time. The
    // fleet shares CARGO_TARGET_DIR across the canonical and checkpoint
    // worktrees; a cached build-script binary with a baked canonical path
    // otherwise repairs the wrong checkout and leaves the checkpoint's
    // resource globs missing.
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .expect("Cargo must provide CARGO_MANIFEST_DIR to build.rs");
    ensure_sidecar_placeholder(&manifest_dir);
    ensure_seed_placeholder(&manifest_dir);
    println!("cargo:rerun-if-changed=sidecar/serve.mjs");
    // Build provenance: rebuild main.rs when the build sets a new git sha so
    // `option_env!("PAPERCUSP_BUILD_SHA")` re-bakes (the operator forwards it
    // to /api/health). Without this, cargo's cache would freeze a stale sha.
    println!("cargo:rerun-if-env-changed=PAPERCUSP_BUILD_SHA");
    // Same provenance mechanism for the shipped app VERSION (WI-2644) — see the
    // matching PAPERCUSP_BUILD_VERSION option_env! + comment in main.rs.
    println!("cargo:rerun-if-env-changed=PAPERCUSP_BUILD_VERSION");
    // Same mechanism for the static release host the shipped updater polls
    // (plan desktop-release-hosting-r2-2026-07-12; see baked_release_host() in
    // main.rs). Without this rerun key cargo would cache a main.rs compiled with
    // a STALE (or empty) host and the shipped app would silently poll the wrong
    // address — the same silent-failure class the release-host work exists to fix.
    println!("cargo:rerun-if-env-changed=PAPERCUSP_RELEASE_HOST");

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
            "revert_to",
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
            // WI-3033: onboarding console routed to an external Windows
            // Terminal window (the embedded ConPTY path wedges on inbox WSL)
            "external_console_run",
            // window_title_for is a plain Rust helper, not a #[tauri::command];
            // its grant is an inert orphan kept for continuity (harmless).
            "window_title_for",
            // native terminal toggle
            "native_terminal_status",
            "native_terminal_toggle",
            // webview→shell flag relay (NativeTerminalGate) — registered to keep
            // the WI-2143 ACL-sync guard green; command is in main.rs collect_commands!
            "native_terminal_set_enabled",
            // WI-3388: resizeable/collapsible terminal dock — layout get/set
            // (registered here to keep the WI-2143 ACL-sync guard green; the
            // commands are in collect_commands! in main.rs)
            "terminal_get_layout",
            "terminal_set_layout",
            // endpoint IPC transport (currently no live JS caller, but
            // collect_commands! exposes it, so grant to stay in sync)
            "endpoint_invoke",
            "endpoint_cancel",
            // env switcher
            "list_envs",
            // docs search palette
            "open_docs_search_palette",
            // The dev-bridge eval return channel (debug builds). Without this
            // grant the injected eval JS's invoke() is ACL-rejected from the
            // remote http origin, so every tauri-agent-tools eval/click/dom
            // call times out — the fleet-wide "wedged shell" symptom.
            "__dev_bridge_result",
        ]),
    ))
    .expect("failed to run tauri_build with the app-command manifest (WI-1976)");
}
