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
    std::fs::write(db_sql.join("PLACEHOLDER-README.txt"), note)
        .expect("write db-sql placeholder");
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

    // WI-1976 — allow the renderer to invoke the native-shell app commands.
    // The operator SPA loads from a REMOTE http origin (http://127.0.0.1:<port>),
    // and Tauri 2's ACL rejects app-command invoke()s from a non-local origin
    // ("Command X not allowed by ACL") unless a capability grants them. Because
    // the commands are registered via tauri-specta's collect_commands! (not the
    // generate_handler! macro the build script scans), Tauri never generated
    // their allow-<command> permissions — so there was nothing to grant, and the
    // ENTIRE invoke surface was dead from the webview (D-002 focus, WI-1675
    // list_windows push, WI-1882's defer-to-console_launch terminal launch all
    // silently blocked). Registering them here generates
    // `allow-console-launch` / `allow-list-windows-by-title` /
    // `allow-focus-window-by-title` / `allow-window-title-for`, which
    // capabilities/default.json then grants for the whitelisted remote urls.
    // KEEP IN SYNC with the invoke-facing entries in main.rs collect_commands![].
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "console_launch",
                "list_windows_by_title",
                "focus_window_by_title",
                "window_title_for",
                // The dev-bridge eval return channel (debug builds). Without this
                // grant the injected eval JS's invoke() is ACL-rejected from the
                // remote http origin, so every tauri-agent-tools eval/click/dom
                // call times out — the fleet-wide "wedged shell" symptom.
                "__dev_bridge_result",
            ]),
        ),
    )
    .expect("failed to run tauri_build with the app-command manifest (WI-1976)");
}
