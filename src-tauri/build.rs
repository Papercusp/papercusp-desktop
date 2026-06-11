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
    tauri_build::build()
}
