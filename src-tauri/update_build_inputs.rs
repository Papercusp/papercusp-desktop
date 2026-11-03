//! Build-side producer for update_authorization's native input section.
//!
//! Keep this after tauri_build::try_build: its OUT_DIR ACL files are the inputs
//! consumed by Tauri codegen, including plugin manifests and generated grants.
//! This records inputs, not source authorship or permission to activate them.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use tauri_utils::acl::{
    ACL_MANIFESTS_FILE_NAME, ALLOWED_COMMANDS_FILE_NAME, CAPABILITIES_FILE_NAME,
};

const MAX_BYTES: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Inputs {
    schema: &'static str,
    policy: String,
    configuration: String,
    source_revision: String,
    version: String,
    product: String,
    platform: String,
    author_ids: Vec<String>,
}

fn read_json(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(format!(
            "{}: empty or oversized build input",
            path.display()
        ));
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    if !value.is_object() {
        return Err(format!("{}: build input must be an object", path.display()));
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

fn platform(target: &str) -> Result<String, String> {
    let arch = target.split('-').next().unwrap_or("");
    let os = if target.contains("-apple-darwin") {
        "darwin"
    } else if target.contains("-pc-windows-") {
        "windows"
    } else if target.contains("-unknown-linux-") {
        "linux"
    } else {
        return Err("unsupported native update target".into());
    };
    if !matches!(arch, "x86_64" | "aarch64") || (os == "windows" && arch != "x86_64") {
        return Err("unsupported native update architecture".into());
    }
    Ok(format!("{os}-{arch}"))
}

/// Environment entries are the existing compile-time provenance knobs only;
/// callers cannot inject a separate configuration, policy digest or author id.
pub fn emit(
    manifest_dir: &Path,
    out_dir: &Path,
    target: &str,
    overlay: Option<&str>,
    baked: &BTreeMap<String, String>,
) -> Result<(), String> {
    // Match the locked tauri-build/codegen parser and RFC 7396 merge exactly.
    let target_platform = tauri_utils::platform::Target::from_triple(target);
    let (mut effective, paths) =
        tauri_utils::config::parse::read_from(target_platform, manifest_dir)
            .map_err(|e| e.to_string())?;
    for path in paths {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    if let Some(raw) = overlay {
        let patch: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
        json_patch::merge(&mut effective, &patch);
    }
    // Deserialization applies Tauri's actual defaults and package-version
    // resolution, rather than recording only the sparse base JSON file.
    let config: tauri_utils::config::Config =
        serde_json::from_value(effective).map_err(|e| e.to_string())?;
    let version = config
        .version
        .clone()
        .ok_or("effective Tauri version is absent")?;
    if baked
        .get("PAPERCUSP_BUILD_VERSION")
        .is_some_and(|v| v != &version)
    {
        return Err("baked app version differs from effective Tauri version".into());
    }
    // Preserve the exact generated file bytes inside the reviewed policy.
    let allowed = out_dir.join(ALLOWED_COMMANDS_FILE_NAME);
    let policy = serde_json::to_string(&serde_json::json!({
        "aclManifests": read_json(&out_dir.join(ACL_MANIFESTS_FILE_NAME))?,
        "capabilities": read_json(&out_dir.join(CAPABILITIES_FILE_NAME))?,
        "allowedCommands": if allowed.exists() { Some(read_json(&allowed)?) } else { None },
    }))
    .map_err(|e| e.to_string())?;
    let configuration = serde_json::to_string(&serde_json::json!({
        "tauri": &config,
        "nativeBuild": baked,
    }))
    .map_err(|e| e.to_string())?;
    let source_revision = baked
        .get("PAPERCUSP_BUILD_SHA")
        .filter(|s| {
            s.len() == 40
                && s.bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        })
        .cloned()
        .unwrap_or_default();
    let bytes = serde_json::to_vec(&Inputs {
        schema: "tauri-update-inputs-v2",
        policy,
        configuration,
        source_revision,
        version,
        product: config.identifier,
        platform: platform(target)?,
        // The existing provenance does not authenticate all authors. An empty
        // set deliberately fails the native extractor's author check. Do
        // not turn git author text or an environment variable into authority.
        author_ids: Vec::new(),
    })
    .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("effective native update inputs exceed the section size limit".into());
    }
    std::fs::write(out_dir.join("update-build-inputs.json"), &bytes).map_err(|e| e.to_string())?;
    let source = format!(
        "#[used]\n#[cfg_attr(target_os = \"macos\", link_section = \"__DATA,__pcupd\")]\n\
         #[cfg_attr(not(target_os = \"macos\"), link_section = \".pcupd\")]\n\
         pub static PAPERCUSP_UPDATE_BUILD_INPUTS: [u8; {}] = \
         *include_bytes!(concat!(env!(\"OUT_DIR\"), \"/update-build-inputs.json\"));\n",
        bytes.len(),
    );
    std::fs::write(out_dir.join("update-build-inputs.rs"), source).map_err(|e| e.to_string())
}
