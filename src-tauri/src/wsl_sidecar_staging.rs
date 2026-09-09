//! The Windows reader and WSL writer must not enumerate NTFS through DrvFs.
//! Keep archive production/extraction separate from publication: a successful
//! extractor cannot attest that the producer supplied its entire source tree.

use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const WSL_STARTUP_TIMEOUT: Duration = Duration::from_secs(120);
const READY_PREFIX: &[u8] = b"papercusp-wsl-ready-v1\n";
// The parent supplies the REMAINING budget after readiness, not before cold
// boot. Until that reply arrives the operation cannot start; EOF fails closed.
pub const WSL_READY_SCRIPT: &str = r#"printf 'papercusp-wsl-ready-v1\n'
IFS= read -r seconds || exit 125
exec /usr/bin/timeout --kill-after=5s "$seconds" "$@"
"#;

/// Linux owns a matching deadline too: killing wsl.exe alone can disconnect
/// its Linux descendants. GNU timeout targets only this extraction process
/// group; it cannot reset the distro or signal another operator.
/// Readiness and operation run in the SAME invocation: a separate prewarm may
/// cool down before the file probe even starts.
pub fn wsl_command() -> Command {
    let mut command = Command::new("wsl.exe");
    command.args([
        "--distribution", "papercup-runtime", "--exec",
        "/bin/sh", "-c", WSL_READY_SCRIPT, "papercusp-wsl-ready",
    ]);
    command
}

/// Startup gets its own bound, but never extends the caller's total deadline.
/// A marker probe allows startup + its unchanged ten-second operation budget;
/// extraction passes only what remains of the shared archive deadline.
pub fn run_wsl_bounded(
    command: &mut Command,
    operation_timeout: Duration,
    total_timeout: Duration,
) -> io::Result<ExitStatus> {
    run_ready_bounded(command, WSL_STARTUP_TIMEOUT, operation_timeout, total_timeout)
}

fn run_ready_bounded(
    command: &mut Command,
    startup_timeout: Duration,
    operation_timeout: Duration,
    total_timeout: Duration,
) -> io::Result<ExitStatus> {
    let start = Instant::now();
    let total_deadline = start + total_timeout;
    let startup_deadline = (start + startup_timeout).min(total_deadline);
    let mut child = OwnedChild(command.stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()?);
    let mut stdout = child.0.stdout.take().expect("stdout was piped");
    let (tx, rx) = mpsc::channel();
    // A cold WSL stdout must never block the supervising thread. Read a fixed
    // prefix, not an unbounded line; strip only protocol bytes from normal logs.
    std::thread::Builder::new().name("wsl-readiness".into()).spawn(move || {
        let mut prefix = [0; READY_PREFIX.len()];
        let ready = stdout.read_exact(&mut prefix).and_then(|()| {
            if prefix == READY_PREFIX {
                Ok(Instant::now())
            } else {
                Err(io::Error::new(io::ErrorKind::InvalidData,
                    format!("Invalid WSL readiness prefix (first {} bytes): {:02x?}",
                        prefix.len(), prefix)))
            }
        });
        let valid = ready.is_ok();
        let _ = tx.send(ready);
        if valid {
            let _ = io::copy(&mut stdout, &mut io::stdout());
        }
    })?;
    let ready_at = loop {
        let remaining = startup_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(io::ErrorKind::TimedOut,
                "WSL startup timed out before readiness; only the owned child was stopped"));
        }
        match rx.recv_timeout(remaining.min(Duration::from_millis(20))) {
            Ok(Ok(at)) if at <= startup_deadline => break at,
            Ok(Ok(_)) => return Err(io::Error::new(io::ErrorKind::TimedOut,
                "WSL readiness arrived after the startup deadline")),
            Ok(Err(error)) => return Err(io::Error::new(error.kind(),
                format!("WSL exited before valid readiness: {error}"))),
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(io::Error::other(
                "WSL readiness reader disconnected")),
        }
    };
    let operation_deadline = (ready_at + operation_timeout).min(total_deadline);
    let remaining = operation_deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(io::Error::new(io::ErrorKind::TimedOut,
            "WSL operation deadline expired before launch"));
    }
    // Tiny control message only, never the binary archive. The Linux timer is
    // armed AFTER startup, with the shared deadline's actual remaining budget.
    let mut stdin = child.0.stdin.take().expect("stdin was piped");
    writeln!(stdin, "{:.6}s", remaining.as_secs_f64())?;
    drop(stdin);
    loop {
        if let Some(status) = child.0.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= operation_deadline {
            return Err(io::Error::new(io::ErrorKind::TimedOut,
                "WSL operation timed out after readiness; only the owned child was stopped"));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
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
# One DrvFs file still pays a crossing per read. GNU tar's default 10 KiB
# records made the native 306 MB control take 57 s; 1 MiB records took 13 s
# with identical hashes (default/large/default). This changes reads only,
# not the archive format, payload, publication rules or total deadline.
tar --blocking-factor=2048 -C "$temporary_dir" -xf "$archive"
test -f "$temporary_dir/serve.mjs"
test -f "$temporary_dir/sidecar-preload.js"
# NTFS archives synthesize execute bits (including for PE/BAT files). Discard
# those bits, then grant only owner execute for ELF binaries/shebang scripts.
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
    const executable = (n >= 2 && magic[0] === 35 && magic[1] === 33) ||
        (n === 4 && magic[0] === 127 && magic[1] === 69 &&
         magic[2] === 76 && magic[3] === 70);
    const mode = fs.statSync(file).mode;
    const normalized = (mode & ~0o111) | (executable ? 0o100 : 0);
    if (normalized !== mode) fs.chmodSync(file, normalized);
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
    let remaining = timeout.saturating_sub(start.elapsed());
    let status = run_wsl_bounded(&mut consumer, remaining, remaining)?;
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
            c.args(["-c", WSL_READY_SCRIPT, "ready", "/bin/bash", "-c", EXTRACT_SCRIPT, "extract"])
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
    fn large_reads_accept_small_archives_and_partial_final_records() {
        assert!(EXTRACT_SCRIPT.contains("tar --blocking-factor=2048 "));
        for length in [17usize, 1_048_576 + 777] {
            let f = Fixture::new();
            let bytes: Vec<u8> = (0..length).map(|n| (n % 251) as u8).collect();
            fs::write(f.0.join("source/partial record.bin"), &bytes).unwrap();
            stage_archive(&mut f.producer(), |_| f.consumer(), Duration::from_secs(5)).unwrap();
            assert_eq!(fs::read(f.0.join("stage/partial record.bin")).unwrap(), bytes);
            assert!(!f.0.join("stage/.papercusp-runtime-complete").exists());
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
            ("script", b"#!/bin/sh\nexit 0".as_slice()), ("data", b"ordinary data".as_slice()),
            ("windows.exe", b"MZ\x90\0".as_slice()), ("windows.bat", b"@echo off".as_slice())] {
            let file = f.0.join("source").join(name);
            fs::write(&file, bytes).unwrap();
            // Match native tar's synthetic executable metadata, not a
            // Linux-only fixture whose data files already have correct bits.
            fs::set_permissions(file, fs::Permissions::from_mode(0o755)).unwrap();
        }
        stage_archive(&mut f.producer(), |_| f.consumer(), Duration::from_secs(5)).unwrap();
        for name in ["elf", "script"] {
            assert_eq!(fs::metadata(f.0.join("stage").join(name)).unwrap().permissions().mode() & 0o111, 0o100);
        }
        for name in ["data", "windows.exe", "windows.bat"] {
            assert_eq!(fs::metadata(f.0.join("stage").join(name)).unwrap().permissions().mode() & 0o111, 0);
        }
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
        let c = wsl_command();
        let args: Vec<_> = c.get_args().map(|a| a.to_str().unwrap()).collect();
        assert_eq!(args, ["--distribution", "papercup-runtime", "--exec",
            "/bin/sh", "-c", WSL_READY_SCRIPT, "papercusp-wsl-ready"]);
        assert!(WSL_READY_SCRIPT.contains("/usr/bin/timeout --kill-after=5s"));
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
            f.consumer()
        }, budget).unwrap();
        assert!(!f.0.join("runtime").exists(), "diagnostic extraction is not publication");
    }

    fn delayed_ready(delay: &str, args: &[&str]) -> Command {
        let mut command = Command::new("bash");
        command.args(["-c", "sleep \"$1\"; shift; exec /bin/sh -c \"$@\"", "boot", delay,
            WSL_READY_SCRIPT, "ready"]).args(args);
        command
    }

    #[test]
    fn cold_start_does_not_spend_the_operation_budget() {
        let mut command = delayed_ready("3", &["/bin/true"]);
        let start = Instant::now();
        let status = run_ready_bounded(&mut command, Duration::from_secs(10),
            Duration::from_secs(2), Duration::from_secs(12)).unwrap();
        assert!(status.success());
        assert!(start.elapsed() >= Duration::from_secs(3),
            "startup must actually exceed the operation budget");
    }

    #[test]
    fn readiness_preserves_the_real_operation_exit_code() {
        let mut command = delayed_ready("0", &["/bin/sh", "-c", "exit 19"]);
        let status = run_ready_bounded(&mut command, Duration::from_secs(3),
            Duration::from_secs(1), Duration::from_secs(4)).unwrap();
        assert_eq!(status.code(), Some(19), "a missing cache is not a startup failure");
    }

    #[test]
    fn zero_exit_without_readiness_is_not_a_success() {
        let mut command = Command::new("true");
        assert_eq!(run_ready_bounded(&mut command, Duration::from_secs(3),
            Duration::from_secs(1), Duration::from_secs(4)).unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn invalid_readiness_is_not_an_operation_result() {
        let mut command = Command::new("bash");
        command.args(["-c", "printf 'not-a-readiness-marker\\n'"]);
        assert_eq!(run_ready_bounded(&mut command, Duration::from_secs(3),
            Duration::from_secs(1), Duration::from_secs(4)).unwrap_err().kind(),
            io::ErrorKind::InvalidData);
    }

    #[test]
    fn startup_timeout_reaps_only_the_owned_process() {
        let f = Fixture::new();
        let mut unrelated = OwnedChild(Command::new("sleep").arg("20").spawn().unwrap());
        let mut command = Command::new("bash");
        command.args(["-c", "echo $$ > \"$1\"; exec sleep 20", "startup"])
            .arg(f.0.join("startup.pid"));
        let error = run_ready_bounded(&mut command, Duration::from_millis(300),
            Duration::from_secs(3), Duration::from_secs(4)).unwrap_err();
        assert!(error.to_string().contains("before readiness"));
        let pid = fs::read_to_string(f.0.join("startup.pid")).unwrap();
        assert!(!PathBuf::from(format!("/proc/{}", pid.trim())).exists());
        assert!(unrelated.0.try_wait().unwrap().is_none());
    }

    #[test]
    fn execution_timeout_begins_after_readiness() {
        let mut command = delayed_ready("0", &["/bin/sleep", "20"]);
        let result = run_ready_bounded(&mut command, Duration::from_secs(10),
            Duration::from_secs(1), Duration::from_secs(12));
        match result {
            // The real Linux timeout may beat the parent watchdog to the exit.
            Ok(status) => assert_eq!(status.code(), Some(124)),
            Err(error) => assert!(error.to_string().contains("after readiness")),
        }
    }

    #[test]
    fn readiness_cannot_extend_the_archive_total_deadline() {
        let mut command = delayed_ready("0", &["/bin/sleep", "20"]);
        let start = Instant::now();
        let result = run_ready_bounded(&mut command, Duration::from_secs(20),
            Duration::from_secs(20), Duration::from_secs(3));
        match result {
            Ok(status) => assert_eq!(status.code(), Some(124)),
            Err(error) => assert_eq!(error.kind(), io::ErrorKind::TimedOut),
        }
        assert!(start.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn linux_budget_reply_subtracts_startup_from_total() {
        let f = Fixture::new();
        let mut command = Command::new("bash");
        command.args(["-c",
            "sleep 0.3; printf 'papercusp-wsl-ready-v1\\n'; IFS= read -r seconds; printf '%s' \"$seconds\" > \"$1\"",
            "record-budget"]).arg(f.0.join("budget"));
        assert!(run_ready_bounded(&mut command, Duration::from_secs(10),
            Duration::from_secs(20), Duration::from_secs(10)).unwrap().success());
        let seconds = fs::read_to_string(f.0.join("budget")).unwrap()
            .trim_end_matches('s').parse::<f64>().unwrap();
        assert!(seconds > 0.0 && seconds <= 9.7,
            "Linux received {seconds}s; startup must not be added back to its deadline");
    }

    #[test]
    fn missing_parent_budget_never_starts_linux_operation() {
        let f = Fixture::new();
        let mut command = Command::new("bash");
        command.args(["-c", WSL_READY_SCRIPT, "ready", "/usr/bin/touch"])
            .arg(f.0.join("must-not-run"))
            .stdin(Stdio::null()).stdout(Stdio::null());
        assert_eq!(run_bounded(&mut command, Duration::from_secs(5)).unwrap().code(), Some(125));
        assert!(!f.0.join("must-not-run").exists());
    }
}
