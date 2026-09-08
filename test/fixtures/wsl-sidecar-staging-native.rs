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
    let mut probe = Command::new("wsl.exe");
    probe.args(["-d", "papercup-runtime", "--exec", "/usr/bin/test", "!", "-e", &args[2]]);
    if !staging::run_bounded(&mut probe, Duration::from_secs(10))?.success() {
        return Err("Diagnostic target already exists; inspect it instead of rerunning".into());
    }
    let mut producer = Command::new("tar.exe");
    producer.arg("-C").arg(source).args(staging::ARCHIVE_ARGS);
    let mut consumer = Command::new("wsl.exe");
    consumer.args(["-d", "papercup-runtime", "--exec", "/bin/bash", "-c"])
        .arg(staging::EXTRACT_SCRIPT).arg("diagnostic-extract").arg(&args[2]);
    let start = Instant::now();
    staging::stream_archive(&mut producer, &mut consumer, Duration::from_secs(1_200))?;
    println!("NATIVE_STREAM_PASS elapsed_ms={} acceptance=false published=false",
        start.elapsed().as_millis());
    Ok(())
}
