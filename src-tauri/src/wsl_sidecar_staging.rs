//! The Windows reader and WSL writer must not enumerate NTFS through DrvFs.
//! Keep archive production/extraction separate from publication: a successful
//! extractor cannot attest that the producer supplied its entire source tree.

use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus};
use std::time::{Duration, Instant};

/// Linux owns a matching deadline too: killing wsl.exe alone can disconnect
/// its Linux descendants. GNU timeout targets only this extraction process
/// group; it cannot reset the distro or signal another operator.
pub fn wsl_command(timeout: Duration) -> Command {
    let mut command = Command::new("wsl.exe");
    command.args([
        "--distribution", "papercup-runtime", "--exec",
        "/usr/bin/timeout", "--kill-after=5s",
    ]).arg(format!("{:.3}s", timeout.as_secs_f64().max(0.001)));
    command
}

pub const ARCHIVE_ARGS: &[&str] = &[
    "--exclude=./source.tar.zst",
    "--exclude=./db-seed.dump",
    "--exclude=./db-seed.tar.gz",
];

pub const EXTRACT_SCRIPT: &str = r#"set -euo pipefail
archive=$1
temporary_dir=$2
rm -rf -- "$temporary_dir"
mkdir -p -- "$temporary_dir"
tar -C "$temporary_dir" -xf "$archive"
test -f "$temporary_dir/serve.mjs"
test -f "$temporary_dir/sidecar-preload.js"
# NTFS archives have no Linux executable metadata. Restore the owner execute
# bit only for ELF binaries and shebang scripts, not arbitrary data files.
# Node is already required/installed before WslState::Ready permits staging.
node - "$temporary_dir" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const magic = Buffer.alloc(4);
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { visit(file); continue; }
    if (!entry.isFile()) continue;
    const fd = fs.openSync(file, 'r');
    let n;
    try { n = fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    if ((n >= 2 && magic[0] === 35 && magic[1] === 33) ||
        (n === 4 && magic[0] === 127 && magic[1] === 69 &&
         magic[2] === 76 && magic[3] === 70)) {
      fs.chmodSync(file, fs.statSync(file).mode | 0o100);
    }
  }
}
visit(process.argv[2]);
NODE
"#;

// Called ONLY after both archive processes have exited successfully.
pub const PUBLISH_SCRIPT: &str = r#"set -euo pipefail
temporary_dir=$1
runtime_dir=$2
test -f "$temporary_dir/serve.mjs"
test -f "$temporary_dir/sidecar-preload.js"
touch "$temporary_dir/.papercusp-runtime-complete"
if test -f "$runtime_dir/.papercusp-runtime-complete"; then
  rm -rf -- "$temporary_dir"
elif test -e "$runtime_dir"; then
  echo "Refusing to publish over an incomplete runtime generation" >&2
  exit 1
else
  mv -- "$temporary_dir" "$runtime_dir"
fi
"#;

/// An error at ANY spawn/wait boundary must reap only our own child, never
/// terminate the distro (which may still contain a working older operator).
struct OwnedChild(Child);

impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Reserve a new native archive pathname. Never overwrite someone else's temp
/// file, and remove our large archive on every success/error return.
pub struct TemporaryArchive(PathBuf);
impl TemporaryArchive {
    pub fn create(path: PathBuf) -> io::Result<Self> {
        std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
        Ok(Self(path))
    }
    pub fn path(&self) -> &Path { &self.0 }
}
impl Drop for TemporaryArchive {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

pub fn run_bounded(command: &mut Command, timeout: Duration) -> io::Result<ExitStatus> {
    let mut child = OwnedChild(command.spawn()?);
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.0.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "WSL staging command timed out; only the owned child was stopped",
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Native tar enumerates NTFS into one local file, then WSL reads that file
/// sequentially. Native→WSL stdin was measured at ~2 MB/s on the real guest,
/// insufficient for the shipped multi-GB models. Do not use a text/binary
/// interop pipe, reintroduce per-file DrvFs reads, or increase the deadline.
pub fn stage_archive<F>(
    producer: &mut Command,
    make_consumer: F,
    timeout: Duration,
) -> io::Result<()>
where
    F: FnOnce(Duration) -> Command,
{
    let start = Instant::now();
    eprintln!("[wsl-staging] archive producer starting");
    let status = run_bounded(producer, timeout)?;
    if !status.success() {
        return Err(io::Error::other(format!("archive producer exited with {status}")));
    }
    let remaining = timeout.saturating_sub(start.elapsed());
    eprintln!("[wsl-staging] archive producer complete elapsed_ms={} remaining_ms={}",
        start.elapsed().as_millis(), remaining.as_millis());
    if remaining.is_zero() {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "Windows sidecar archive deadline expired; no distro reset",
        ));
    }
    // Construct the Linux deadline NOW, not before archive creation. Otherwise
    // killing wsl.exe at the shared deadline leaves its extractor alive for the
    // entire producer duration beyond that deadline.
    let mut consumer = make_consumer(remaining);
    eprintln!("[wsl-staging] WSL archive extractor starting");
    let status = run_bounded(&mut consumer, timeout.saturating_sub(start.elapsed()))?;
    if !status.success() {
        return Err(io::Error::other(format!("WSL archive extractor exited with {status}")));
    }
    eprintln!("[wsl-staging] WSL archive extractor complete elapsed_ms={}",
        start.elapsed().as_millis());
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "wsl-staging-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(root.join("source")).unwrap();
            fs::write(root.join("source/serve.mjs"), [0, 255, 13, 10, 128, 42]).unwrap();
            fs::write(root.join("source/sidecar-preload.js"), b"preload").unwrap();
            for name in ["source.tar.zst", "db-seed.dump", "db-seed.tar.gz"] {
                fs::write(root.join("source").join(name), b"not a hot runtime input").unwrap();
            }
            Self(root)
        }
        fn producer(&self) -> Command {
            let mut c = Command::new("tar");
            c.arg("-C").arg(self.0.join("source")).args(ARCHIVE_ARGS)
                .arg("-cf").arg(self.0.join("archive.tar")).arg(".");
            c
        }
        fn consumer(&self) -> Command {
            let mut c = Command::new("bash");
            c.args(["-c", EXTRACT_SCRIPT, "extract"])
                .arg(self.0.join("archive.tar")).arg(self.0.join("stage"));
            c
        }
        fn publish(&self) -> ExitStatus {
            let mut c = Command::new("bash");
            c.args(["-c", PUBLISH_SCRIPT, "publish"])
                .arg(self.0.join("stage")).arg(self.0.join("runtime"));
            run_bounded(&mut c, Duration::from_secs(5)).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn binary_archive_and_exclusions_publish_only_after_both_succeed() {
        let f = Fixture::new();
        fs::write(f.0.join("source/file with spaces"), [255, 0, 128]).unwrap();
        std::os::unix::fs::symlink("serve.mjs", f.0.join("source/link")).unwrap();
        stage_archive(&mut f.producer(), |_| f.consumer(), Duration::from_secs(5)).unwrap();
        assert!(!f.0.join("runtime").exists());
        assert!(!f.0.join("stage/.papercusp-runtime-complete").exists());
        assert!(f.publish().success());
        assert!(f.0.join("runtime/.papercusp-runtime-complete").is_file());
        for file in ["serve.mjs", "sidecar-preload.js", "file with spaces"] {
            assert_eq!(fs::read(f.0.join("source").join(file)).unwrap(),
                fs::read(f.0.join("runtime").join(file)).unwrap());
        }
        assert_eq!(fs::read_link(f.0.join("runtime/link")).unwrap(), PathBuf::from("serve.mjs"));
        for file in ["source.tar.zst", "db-seed.dump", "db-seed.tar.gz"] {
            assert!(!f.0.join("runtime").join(file).exists());
        }
    }

    #[test]
    fn producer_failure_after_valid_archive_does_not_publish() {
        let f = Fixture::new();
        let mut c = Command::new("bash");
        c.args(["-c", "tar -C \"$1\" -cf \"$2\" .; exit 19", "producer"])
            .arg(f.0.join("source")).arg(f.0.join("archive.tar"));
        let err = stage_archive(&mut c, |_| panic!("consumer must not be constructed"), Duration::from_secs(5)).unwrap_err();
        assert!(err.to_string().contains("archive producer"));
        assert!(!f.0.join("stage").exists(), "extractor must not start on failed production");
        assert!(!f.0.join("runtime").exists());
        assert!(!f.0.join("stage/.papercusp-runtime-complete").exists());
    }

    #[test]
    fn corrupt_archive_is_rejected_by_real_extractor() {
        let f = Fixture::new();
        fs::write(f.0.join("archive.tar"), b"this is not a tar archive").unwrap();
        let mut c = Command::new("true");
        assert!(stage_archive(&mut c, |_| f.consumer(), Duration::from_secs(5)).is_err());
        assert!(!f.0.join("runtime").exists());
    }

    #[test]
    fn missing_required_runtime_file_is_not_published() {
        let f = Fixture::new();
        fs::remove_file(f.0.join("source/serve.mjs")).unwrap();
        assert!(stage_archive(&mut f.producer(), |_| f.consumer(), Duration::from_secs(5)).is_err());
        assert!(!f.publish().success());
        assert!(!f.0.join("runtime").exists());
    }

    #[test]
    fn timeout_stops_only_owned_children_and_reaps_them() {
        let f = Fixture::new();
        let mut unrelated = OwnedChild(Command::new("sleep").arg("20").spawn().unwrap());
        let pid_file = f.0.join("producer.pid");
        let mut c = Command::new("bash");
        c.args(["-c", "echo $$ > \"$1\"; exec sleep 20", "producer"]).arg(&pid_file);
        let start = Instant::now();
        assert_eq!(stage_archive(&mut c, |_| panic!("consumer must not be constructed"), Duration::from_millis(300))
            .unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(3));
        assert!(unrelated.0.try_wait().unwrap().is_none());
        let pid = fs::read_to_string(pid_file).unwrap();
        assert!(!PathBuf::from(format!("/proc/{}", pid.trim())).exists());
        assert!(!f.0.join("runtime").exists());
    }

    #[test]
    fn failed_consumer_spawn_returns_error_without_publishing() {
        let mut c = Command::new("true");
        let start = Instant::now();
        assert_eq!(stage_archive(&mut c, |_| Command::new("/nonexistent-staging-extractor"), Duration::from_secs(5))
            .unwrap_err().kind(), io::ErrorKind::NotFound);
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn bounded_command_timeout_does_not_signal_other_children() {
        let mut unrelated = OwnedChild(Command::new("sleep").arg("20").spawn().unwrap());
        let mut c = Command::new("sleep");
        c.arg("20");
        assert_eq!(run_bounded(&mut c, Duration::from_millis(50))
            .unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(unrelated.0.try_wait().unwrap().is_none());
    }

    #[test]
    fn an_existing_incomplete_generation_is_not_treated_as_complete() {
        let f = Fixture::new();
        stage_archive(&mut f.producer(), |_| f.consumer(), Duration::from_secs(5)).unwrap();
        fs::create_dir(f.0.join("runtime")).unwrap();
        assert!(!f.publish().success());
        assert!(!f.0.join("runtime/.papercusp-runtime-complete").exists());
    }

    #[test]
    fn native_archive_modes_restore_only_elf_and_shebang_execution() {
        use std::os::unix::fs::PermissionsExt;
        let f = Fixture::new();
        for (name, bytes) in [("elf", b"\x7fELFxxx".as_slice()),
            ("script", b"#!/bin/sh\nexit 0".as_slice()), ("data", b"ordinary data".as_slice())] {
            let file = f.0.join("source").join(name);
            fs::write(&file, bytes).unwrap();
            fs::set_permissions(file, fs::Permissions::from_mode(0o644)).unwrap();
        }
        stage_archive(&mut f.producer(), |_| f.consumer(), Duration::from_secs(5)).unwrap();
        for name in ["elf", "script"] {
            assert_ne!(fs::metadata(f.0.join("stage").join(name)).unwrap().permissions().mode() & 0o100, 0);
        }
        assert_eq!(fs::metadata(f.0.join("stage/data")).unwrap().permissions().mode() & 0o111, 0);
    }

    #[test]
    fn archive_custody_refuses_existing_file_and_cleans_up_own_file() {
        let f = Fixture::new();
        let path = f.0.join("owned.tar");
        let archive = TemporaryArchive::create(path.clone()).unwrap();
        assert!(TemporaryArchive::create(path.clone()).is_err());
        assert_eq!(archive.path(), path);
        fs::write(&path, b"archive").unwrap();
        drop(archive);
        assert!(!path.exists());
    }

    #[test]
    fn wsl_timeout_is_anchored_inside_linux_not_only_the_client() {
        let c = wsl_command(Duration::from_secs(12));
        let args: Vec<_> = c.get_args().map(|a| a.to_str().unwrap()).collect();
        assert_eq!(args, ["--distribution", "papercup-runtime", "--exec",
            "/usr/bin/timeout", "--kill-after=5s", "12.000s"]);
        let short = wsl_command(Duration::from_millis(125));
        assert_eq!(short.get_args().last().unwrap(), "0.125s");
    }

    #[test]
    fn linux_consumer_is_constructed_after_producer_with_only_remaining_budget() {
        let f = Fixture::new();
        let mut producer = Command::new("bash");
        producer.args(["-c", "sleep 0.05; tar -C \"$1\" -cf \"$2\" .", "producer"])
            .arg(f.0.join("source")).arg(f.0.join("archive.tar"));
        let budget = Duration::from_secs(5);
        stage_archive(&mut producer, |remaining| {
            assert!(f.0.join("archive.tar").is_file(), "producer must have run first");
            assert!(remaining <= budget - Duration::from_millis(50),
                "Linux must not receive the producer's already-spent budget");
            assert!(!remaining.is_zero());
            let linux = wsl_command(remaining);
            let seconds = linux.get_args().last().unwrap().to_str().unwrap()
                .trim_end_matches('s').parse::<f64>().unwrap();
            assert!(seconds <= remaining.as_secs_f64() + 0.001);
            f.consumer()
        }, budget).unwrap();
        assert!(!f.0.join("runtime").exists(), "diagnostic extraction is not publication");
    }
}
