//! Native Windows fixture for the exact production process/transport module.
//! It never publishes a runtime marker or starts/stops an application. Pass a
//! fresh, explicitly diagnostic Linux directory, not runtime-sidecars/<hash>.
#[path = "../../src-tauri/src/wsl_sidecar_staging.rs"]
mod staging;

use std::process::Command;
use std::time::{Duration, Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || !args[2].starts_with("/tmp/papercusp-staging-diagnostic-") {
        return Err("Expected source directory and /tmp/papercusp-staging-diagnostic-* target".into());
    }
    let source = std::path::Path::new(&args[1]);
    if !source.join("serve.mjs").is_file() || !source.join("sidecar-preload.js").is_file() {
        return Err("Source is not a sidecar".into());
    }
    let mut probe = staging::wsl_command(Duration::from_secs(10));
    probe.args(["/usr/bin/test", "!", "-e", &args[2]]);
    if !staging::run_bounded(&mut probe, Duration::from_secs(10))?.success() {
        return Err("Diagnostic target already exists; inspect it instead of rerunning".into());
    }
    let mut producer = Command::new("tar.exe");
    let archive = staging::TemporaryArchive::create(std::env::temp_dir()
        .join(format!("papercusp-diagnostic-{}.tar", std::process::id())))?;
    let archive_windows = archive.path().to_string_lossy().replace('\\', "/");
    if archive_windows.as_bytes().get(1) != Some(&b':') {
        return Err("Native fixture requires a drive-letter temp path".into());
    }
    let archive_wsl = format!("/mnt/{}{}", &archive_windows[..1].to_lowercase(), &archive_windows[2..]);
    producer.arg("-C").arg(source).args(staging::ARCHIVE_ARGS)
        .arg("-cf").arg(archive.path()).arg(".");
    let mut consumer = staging::wsl_command(Duration::from_secs(1_200));
    consumer.args(["/bin/bash", "-c"])
        .arg(staging::EXTRACT_SCRIPT).arg("diagnostic-extract").arg(&archive_wsl).arg(&args[2]);
    let start = Instant::now();
    staging::stage_archive(&mut producer, &mut consumer, Duration::from_secs(1_200))?;
    println!("NATIVE_ARCHIVE_PASS elapsed_ms={} acceptance=false published=false",
        start.elapsed().as_millis());
    Ok(())
}
