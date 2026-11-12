//! The Windows reader and WSL writer must not enumerate NTFS through DrvFs.
//! Keep archive production/extraction separate from publication: a successful
//! extractor cannot attest that the producer supplied its entire source tree.

use std::io::{self, Read, Write};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
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
        "--distribution",
        "papercup-runtime",
        "--exec",
        "/bin/sh",
        "-c",
        WSL_READY_SCRIPT,
        "papercusp-wsl-ready",
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
    run_ready_bounded(
        command,
        WSL_STARTUP_TIMEOUT,
        operation_timeout,
        total_timeout,
    )
}

fn run_ready_bounded(
    command: &mut Command,
    startup_timeout: Duration,
    operation_timeout: Duration,
    total_timeout: Duration,
) -> io::Result<ExitStatus> {
    let (mut child, operation_deadline) =
        start_ready(command, startup_timeout, operation_timeout, total_timeout)?;
    // Non-streaming commands have only the control message on stdin.
    drop(child.0.stdin.take());
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= operation_deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "WSL operation timed out after readiness; only the owned child was stopped",
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Return the ready child with its stdin still open AFTER writing the budget.
/// The same handshake governs marker probes and binary archive streaming.
fn start_ready(
    command: &mut Command,
    startup_timeout: Duration,
    operation_timeout: Duration,
    total_timeout: Duration,
) -> io::Result<(OwnedChild, Instant)> {
    let start = Instant::now();
    let total_deadline = start + total_timeout;
    let startup_deadline = (start + startup_timeout).min(total_deadline);
    let mut child = OwnedChild::spawn(
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped()),
    )?;
    let mut stdout = child.0.stdout.take().expect("stdout was piped");
    let (tx, rx) = mpsc::channel();
    // A cold WSL stdout must never block the supervising thread. Read a fixed
    // prefix, not an unbounded line; strip only protocol bytes from normal logs.
    std::thread::Builder::new()
        .name("wsl-readiness".into())
        .spawn(move || {
            let mut prefix = [0; READY_PREFIX.len()];
            let ready = stdout.read_exact(&mut prefix).and_then(|()| {
                if prefix == READY_PREFIX {
                    Ok(Instant::now())
                } else {
                    Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "Invalid WSL readiness prefix (first {} bytes): {:02x?}",
                            prefix.len(),
                            prefix
                        ),
                    ))
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
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "WSL startup timed out before readiness; only the owned child was stopped",
            ));
        }
        match rx.recv_timeout(remaining.min(Duration::from_millis(20))) {
            Ok(Ok(at)) if at <= startup_deadline => break at,
            Ok(Ok(_)) => {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "WSL readiness arrived after the startup deadline",
                ))
            }
            Ok(Err(error)) => {
                return Err(io::Error::new(
                    error.kind(),
                    format!("WSL exited before valid readiness: {error}"),
                ))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(io::Error::other("WSL readiness reader disconnected"))
            }
        }
    };
    let operation_deadline = (ready_at + operation_timeout).min(total_deadline);
    let remaining = operation_deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "WSL operation deadline expired before launch",
        ));
    }
    // The tiny control message precedes binary bytes on this same pipe. No
    // buffered reader may consume beyond its newline on the Linux side.
    let stdin = child.0.stdin.as_mut().expect("stdin was piped");
    writeln!(stdin, "{:.6}s", remaining.as_secs_f64())?;
    Ok((child, operation_deadline))
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
# Producer stdout is this process's binary stdin, not a text relay or DrvFs
# archive read. Pipes may return partial records; assemble the full record.
tar --blocking-factor=2048 --read-full-records -C "$temporary_dir" -xf "$archive"
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

/// An error at ANY spawn/wait boundary must stop our own processes, never
/// terminate the distro (which may still contain a working older operator).
/// Linux keeps the direct child UNREAPED until group cleanup: its reserved PID
/// anchors the process-group identity even when the leader exited first.
struct OwnedChild(Child);

#[cfg(test)]
#[derive(Clone, Copy, Debug)]
struct ChildCleanupDiagnostic {
    pid: u32,
    group_kill_result: i32,
    errno: Option<i32>,
}

#[cfg(test)]
impl std::fmt::Display for ChildCleanupDiagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "pid={} group_kill_result={} errno={:?}",
            self.pid, self.group_kill_result, self.errno
        )
    }
}

#[cfg(test)]
struct ChildCleanupDiagnostics {
    rows: [Option<ChildCleanupDiagnostic>; 8],
    len: usize,
}

#[cfg(test)]
std::thread_local! {
    static CHILD_CLEANUP_DIAGNOSTICS: std::cell::RefCell<ChildCleanupDiagnostics> =
        std::cell::RefCell::new(ChildCleanupDiagnostics { rows: [None; 8], len: 0 });
}

#[cfg(test)]
fn reset_child_cleanup_diagnostics() {
    CHILD_CLEANUP_DIAGNOSTICS.with(|diagnostics| {
        let mut diagnostics = diagnostics.borrow_mut();
        diagnostics.rows = [None; 8];
        diagnostics.len = 0;
    });
}

#[cfg(test)]
fn record_child_cleanup_diagnostic(diagnostic: ChildCleanupDiagnostic) {
    CHILD_CLEANUP_DIAGNOSTICS.with(|diagnostics| {
        let mut diagnostics = diagnostics.borrow_mut();
        if diagnostics.len < diagnostics.rows.len() {
            let index = diagnostics.len;
            diagnostics.rows[index] = Some(diagnostic);
            diagnostics.len += 1;
        }
    });
}

#[cfg(test)]
fn take_child_cleanup_diagnostics() -> Vec<ChildCleanupDiagnostic> {
    CHILD_CLEANUP_DIAGNOSTICS.with(|diagnostics| {
        let mut diagnostics = diagnostics.borrow_mut();
        let rows = diagnostics.rows[..diagnostics.len]
            .iter()
            .flatten()
            .copied()
            .collect();
        diagnostics.rows = [None; 8];
        diagnostics.len = 0;
        rows
    })
}

impl OwnedChild {
    fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        command.spawn().map(Self)
    }

    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::process::ExitStatusExt;
            // Linux siginfo_t is 128 bytes, aligned for its pointer union.
            // waitid(P_PID, ..., WEXITED|WNOHANG|WNOWAIT) observes the exit
            // without releasing the child identity as Child::try_wait does.
            unsafe extern "C" {
                fn waitid(kind: i32, id: u32, info: *mut std::ffi::c_void, options: i32) -> i32;
            }
            let mut info = [0usize; 128 / std::mem::size_of::<usize>()];
            let result = unsafe { waitid(1, self.0.id(), info.as_mut_ptr().cast(), 4 | 1 | 0x0100_0000) };
            if result == -1 {
                return Err(io::Error::last_os_error());
            }
            // The first three ints are signo, errno, code; the payload union
            // starts after their pointer-aligned padding. SIGCHLD's payload
            // is pid, uid, status. No libc crate is needed by the native
            // standalone fixture that imports this production module.
            let fields = unsafe { std::slice::from_raw_parts(info.as_ptr().cast::<i32>(), 32) };
            if fields[0] == 0 {
                return Ok(None);
            }
            let payload = if std::mem::size_of::<usize>() == 8 { 4 } else { 3 };
            let status = fields[payload + 2];
            let raw = match fields[2] {
                1 => status << 8,   // CLD_EXITED
                2 => status,        // CLD_KILLED
                3 => status | 0x80, // CLD_DUMPED
                code => return Err(io::Error::other(format!("unexpected child exit code {code}"))),
            };
            Ok(Some(ExitStatus::from_raw(raw)))
        }
        #[cfg(not(target_os = "linux"))]
        self.0.try_wait()
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        #[cfg(target_os = "linux")]
        {
            unsafe extern "C" { fn kill(pid: i32, signal: i32) -> i32; }
            // Only spawn() creates these groups; try_wait() never reaps their
            // leader. Signal before wait(), so no recycled PID/PGID can match.
            let group_kill_result = unsafe { kill(-(self.0.id() as i32), 9) };
            #[cfg(test)]
            record_child_cleanup_diagnostic(ChildCleanupDiagnostic {
                pid: self.0.id(),
                group_kill_result,
                errno: if group_kill_result == -1 {
                    io::Error::last_os_error().raw_os_error()
                } else {
                    None
                },
            });
            let _ = group_kill_result;
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn run_bounded(command: &mut Command, timeout: Duration) -> io::Result<ExitStatus> {
    let mut child = OwnedChild::spawn(command)?;
    wait_bounded(&mut child, timeout)
}

/// Capture a small capability receipt while draining both pipes concurrently.
/// Reuse the owned-child deadline so a settings service cannot stall a launch.
pub fn run_bounded_output(command: &mut Command, timeout: Duration) -> io::Result<Output> {
    let mut child = OwnedChild::spawn(command.stdout(Stdio::piped()).stderr(Stdio::piped()))?;
    let stdout = child.0.stdout.take().expect("piped stdout");
    let stderr = child.0.stderr.take().expect("piped stderr");
    let deadline = Instant::now() + timeout;
    let (tx, rx) = mpsc::channel();
    for (is_stdout, pipe) in [
        (true, Box::new(stdout) as Box<dyn Read + Send>),
        (false, Box::new(stderr) as Box<dyn Read + Send>),
    ] {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = pipe.take(16_385).read_to_end(&mut bytes).and_then(|_| {
                if bytes.len() > 16_384 {
                    Err(io::Error::new(io::ErrorKind::InvalidData, "capability receipt exceeds 16 KiB"))
                } else { Ok(bytes) }
            });
            let _ = tx.send((is_stdout, result));
        });
    }
    drop(tx);
    let status = wait_bounded(&mut child, timeout)?;
    let mut output = Output { status, stdout: Vec::new(), stderr: Vec::new() };
    for _ in 0..2 {
        let (is_stdout, bytes) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|e| io::Error::new(io::ErrorKind::TimedOut, format!("capability output did not close: {e}")))?;
        if is_stdout { output.stdout = bytes?; } else { output.stderr = bytes?; }
    }
    Ok(output)
}

fn wait_bounded(child: &mut OwnedChild, timeout: Duration) -> io::Result<ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
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

/// Native tar enumerates NTFS and writes DIRECTLY to the ready WSL child's
/// stdin handle. No user-space copy thread, text relay or temporary archive.
/// Own both Commands: a retained producer Command also retains its configured
/// writer handle, preventing EOF even after the producer exits.
pub fn stage_archive(
    mut producer: Command,
    mut consumer: Command,
    timeout: Duration,
) -> io::Result<()> {
    let start = Instant::now();
    eprintln!("[wsl-staging] awaiting WSL archive extractor readiness");
    let remaining = timeout.saturating_sub(start.elapsed());
    let (mut consumer_child, deadline) =
        start_ready(&mut consumer, WSL_STARTUP_TIMEOUT, remaining, remaining)?;
    let ready_at = Instant::now();
    let writer = consumer_child
        .0
        .stdin
        .take()
        .expect("ready stdin was piped");
    producer.stdin(Stdio::null()).stdout(Stdio::from(writer));
    let mut producer_child = OwnedChild::spawn(&mut producer)?;
    drop(producer); // Close the parent's configured writer, not only the child's.
    let producer_started_at = Instant::now();
    eprintln!(
        "[wsl-staging] binary archive stream starting elapsed_ms={}",
        start.elapsed().as_millis()
    );
    let (mut producer_done, mut consumer_done) = (false, false);
    let result = (|| {
        loop {
            for (child, done, label) in [
                (
                    &mut producer_child,
                    &mut producer_done,
                    "archive producer",
                ),
                (
                    &mut consumer_child,
                    &mut consumer_done,
                    "WSL archive extractor",
                ),
            ] {
                if !*done {
                    if let Some(status) = child.try_wait()? {
                        eprintln!(
                            "[wsl-staging] {label} exited with {status} elapsed_ms={}",
                            start.elapsed().as_millis()
                        );
                        if !status.success() {
                            // GNU timeout may beat the parent watchdog to this
                            // observation. Keep both deadline paths classifiable.
                            let kind = if label == "WSL archive extractor" && status.code() == Some(124)
                            {
                                io::ErrorKind::TimedOut
                            } else {
                                io::ErrorKind::Other
                            };
                            return Err(io::Error::new(
                                kind,
                                format!("{label} exited with {status}"),
                            ));
                        }
                        *done = true;
                    }
                }
            }
            if producer_done && consumer_done {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Windows sidecar stream deadline expired; only owned children were stopped",
                ));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    })();
    // Include reaping in the evidence: returning a timeout alone cannot tell
    // a late watchdog from a slow owned-child cleanup. Keep the same cleanup
    // order and deadline; these measurements do not grant any extra time.
    let supervision_ended_at = Instant::now();
    drop(producer_child);
    let producer_reaped_at = Instant::now();
    drop(consumer_child);
    let consumer_reaped_at = Instant::now();
    result.map_err(|error: io::Error| {
        io::Error::new(error.kind(), format!(
            "{error}; ready_ms={} producer_spawn_ms={} supervision_ms={} producer_cleanup_ms={} consumer_cleanup_ms={} total_ms={}",
            ready_at.duration_since(start).as_millis(),
            producer_started_at.duration_since(ready_at).as_millis(),
            supervision_ended_at.duration_since(producer_started_at).as_millis(),
            producer_reaped_at.duration_since(supervision_ended_at).as_millis(),
            consumer_reaped_at.duration_since(producer_reaped_at).as_millis(),
            consumer_reaped_at.duration_since(start).as_millis(),
        ))
    })
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
                "wsl-staging-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
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
            c.arg("-C")
                .arg(self.0.join("source"))
                .args(ARCHIVE_ARGS)
                .args(["-b", "2048", "-cf", "-", "."]);
            c
        }
        fn consumer(&self) -> Command {
            let mut c = Command::new("bash");
            c.args([
                "-c",
                WSL_READY_SCRIPT,
                "ready",
                "/bin/bash",
                "-c",
                EXTRACT_SCRIPT,
                "extract",
            ])
            .arg("-")
            .arg(self.0.join("stage"));
            c
        }
        fn publish(&self) -> ExitStatus {
            let mut c = Command::new("bash");
            c.args(["-c", PUBLISH_SCRIPT, "publish"])
                .arg(self.0.join("stage"))
                .arg(self.0.join("runtime"));
            run_bounded(&mut c, Duration::from_secs(5)).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn binary_archive_and_exclusions_publish_only_after_both_succeed() {
        let f = Fixture::new();
        fs::write(f.0.join("source/file with spaces"), [255, 0, 128]).unwrap();
        std::os::unix::fs::symlink("serve.mjs", f.0.join("source/link")).unwrap();
        stage_archive(f.producer(), f.consumer(), Duration::from_secs(5)).unwrap();
        assert!(!f.0.join("runtime").exists());
        assert!(!f.0.join("stage/.papercusp-runtime-complete").exists());
        assert!(f.publish().success());
        assert!(f.0.join("runtime/.papercusp-runtime-complete").is_file());
        for file in ["serve.mjs", "sidecar-preload.js", "file with spaces"] {
            assert_eq!(
                fs::read(f.0.join("source").join(file)).unwrap(),
                fs::read(f.0.join("runtime").join(file)).unwrap()
            );
        }
        assert_eq!(
            fs::read_link(f.0.join("runtime/link")).unwrap(),
            PathBuf::from("serve.mjs")
        );
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
            stage_archive(f.producer(), f.consumer(), Duration::from_secs(5)).unwrap();
            assert_eq!(
                fs::read(f.0.join("stage/partial record.bin")).unwrap(),
                bytes
            );
            assert!(!f.0.join("stage/.papercusp-runtime-complete").exists());
        }
    }

    #[test]
    fn producer_failure_after_valid_archive_does_not_publish() {
        let f = Fixture::new();
        let mut c = Command::new("bash");
        c.args(["-c", "tar -C \"$1\" -cf - .; exit 19", "producer"])
            .arg(f.0.join("source"));
        let err = stage_archive(c, f.consumer(), Duration::from_secs(5)).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::Other, "{err:?}");
        assert!(err.to_string().contains("archive producer"), "{err:?}");
        assert!(err.to_string().contains("19"), "{err:?}");
        assert!(!f.0.join("runtime").exists());
        assert!(!f.0.join("stage/.papercusp-runtime-complete").exists());
    }

    #[cfg(target_os = "linux")]
    #[derive(Debug)]
    struct ProcessIdentity {
        pid: u32,
        comm: String,
        state: char,
        ppid: u32,
        pgid: u32,
        sid: u32,
    }

    #[cfg(target_os = "linux")]
    impl std::fmt::Display for ProcessIdentity {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(
                f,
                "pid={} comm={} state={} ppid={} pgid={} sid={}",
                self.pid, self.comm, self.state, self.ppid, self.pgid, self.sid
            )
        }
    }

    #[cfg(target_os = "linux")]
    #[derive(Debug)]
    struct ProcessSample {
        elapsed_ms: u128,
        identity: ProcessIdentity,
    }

    #[cfg(target_os = "linux")]
    impl std::fmt::Display for ProcessSample {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "{}ms {}", self.elapsed_ms, self.identity)
        }
    }

    #[cfg(target_os = "linux")]
    fn process_identity_from_stat(pid: &str, stat: &str) -> Option<ProcessIdentity> {
        let (prefix, rest) = stat.rsplit_once(") ")?;
        let comm = prefix.split_once('(')?.1.to_string();
        let pid = pid.trim().parse().ok()?;
        let mut fields = rest.split_whitespace();
        Some(ProcessIdentity {
            pid,
            comm,
            state: fields.next()?.chars().next()?,
            ppid: fields.next()?.parse().ok()?,
            pgid: fields.next()?.parse().ok()?,
            sid: fields.next()?.parse().ok()?,
        })
    }

    #[cfg(target_os = "linux")]
    fn process_identity(pid: &str) -> Option<ProcessIdentity> {
        let stat = fs::read_to_string(format!("/proc/{}/stat", pid.trim())).ok()?;
        process_identity_from_stat(pid, &stat)
    }

    #[cfg(target_os = "linux")]
    fn process_is_running(pid: &str) -> bool {
        // A killed grandchild may briefly be a zombie awaiting its own parent;
        // it cannot execute or retain a pipe. Do not mistake that for a live leak.
        fs::read_to_string(format!("/proc/{}/stat", pid.trim()))
            .ok()
            .and_then(|stat| stat.rsplit_once(") ").map(|(_, rest)| rest.starts_with('Z')))
            == Some(false)
    }

    #[cfg(target_os = "linux")]
    fn observe_stopped(pid: &str) -> bool {
        // SIGKILL prevents further user code immediately, but /proc may still
        // show a runnable task until the kernel finishes delivering it.
        let deadline = Instant::now() + Duration::from_secs(1);
        while process_is_running(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        !process_is_running(pid)
    }

    #[cfg(target_os = "linux")]
    fn observe_stopped_with_trace(pid: &str) -> (bool, Vec<ProcessSample>) {
        let started = Instant::now();
        let deadline = started + Duration::from_secs(1);
        let mut samples = Vec::new();
        let mut last_sample_ms = None;
        loop {
            match process_identity(pid) {
                None => return (true, samples),
                Some(identity) if identity.state == 'Z' => return (true, samples),
                Some(identity) => {
                    let elapsed_ms = started.elapsed().as_millis();
                    if last_sample_ms.map_or(true, |last| elapsed_ms.saturating_sub(last) >= 50) {
                        samples.push(ProcessSample { elapsed_ms, identity });
                        last_sample_ms = Some(elapsed_ms);
                    }
                }
            }
            if Instant::now() >= deadline {
                return (false, samples);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn producer_failure_stops_extractor_descendants_before_return() {
        let f = Fixture::new();
        let mut unrelated = Command::new("sleep").arg("20").spawn().unwrap();
        reset_child_cleanup_diagnostics();
        let mut consumer = Command::new("bash");
        consumer.args(["-c", WSL_READY_SCRIPT, "ready", "/bin/bash", "-c",
            "bash -c 'echo $$ > \"$1/descendant.pid\"; while ! test -f \"$1/release\"; do sleep 0.01; done; touch \"$1/escaped\"' descendant \"$1\" & wait",
            "extractor"]).arg(&f.0);
        let mut producer = Command::new("bash");
        producer.args(["-c", "while ! test -f \"$1/descendant.pid\"; do sleep 0.01; done; pid=$(cat \"$1/descendant.pid\"); cat \"/proc/$pid/stat\" > \"$1/descendant.pre-cleanup.stat\"; exit 19", "producer"])
            .arg(&f.0);
        let error = stage_archive(producer, consumer, Duration::from_secs(3)).unwrap_err();
        let pid = fs::read_to_string(f.0.join("descendant.pid")).unwrap();
        let pre_cleanup = fs::read_to_string(f.0.join("descendant.pre-cleanup.stat"))
            .ok()
            .and_then(|stat| process_identity_from_stat(&pid, &stat));
        let (stopped, process_samples) = observe_stopped_with_trace(&pid);
        let cleanup_diagnostics = take_child_cleanup_diagnostics();
        let pre_cleanup = pre_cleanup
            .map(|identity| identity.to_string())
            .unwrap_or_else(|| "unavailable".to_string());
        let cleanup_diagnostics = cleanup_diagnostics
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        let process_samples = process_samples
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        let unrelated_survived = unrelated.try_wait().unwrap().is_none();
        // Release the fixture even on the deliberately failing pre-fix run:
        // the regression itself must not strand the process it detects.
        fs::write(f.0.join("release"), b"").unwrap();
        observe_stopped(&pid);
        let _ = unrelated.kill();
        let _ = unrelated.wait();
        assert!(error.to_string().contains("archive producer"), "{error}");
        assert!(unrelated_survived, "cleanup signalled an unrelated process");
        assert!(
            stopped,
            "extractor descendant {pid} survived stage_archive failure; pre_cleanup={pre_cleanup}; child_cleanups=[{cleanup_diagnostics}]; post_cleanup_samples=[{process_samples}]"
        );
        assert!(!f.0.join("escaped").exists(), "extractor mutated files after return");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn exited_leader_remains_anchored_until_descendant_cleanup() {
        let f = Fixture::new();
        let mut command = Command::new("bash");
        command.args(["-c",
            "bash -c 'echo $$ > \"$1/descendant.pid\"; while ! test -f \"$1/release\"; do sleep 0.01; done' descendant \"$1\" & while ! test -f \"$1/descendant.pid\"; do sleep 0.01; done; exit 19",
            "leader"]).arg(&f.0);
        let mut child = OwnedChild::spawn(&mut command).unwrap();
        let leader = child.0.id();
        let status = wait_bounded(&mut child, Duration::from_secs(3)).unwrap();
        let descendant = fs::read_to_string(f.0.join("descendant.pid")).unwrap();
        let still_anchored = PathBuf::from(format!("/proc/{leader}")).exists();
        let descendant_started = process_is_running(&descendant);
        // Repeated observation must preserve the exit code AND its identity.
        let repeated_status = child.try_wait().unwrap().unwrap();
        drop(child);
        let stopped = observe_stopped(&descendant);
        fs::write(f.0.join("release"), b"").unwrap();
        observe_stopped(&descendant);
        assert_eq!(status.code(), Some(19));
        assert_eq!(repeated_status.code(), Some(19));
        assert!(still_anchored, "polling reaped the process-group identity");
        assert!(descendant_started, "fixture did not start a real descendant");
        assert!(stopped, "exited leader left its descendant running");
        assert!(!PathBuf::from(format!("/proc/{leader}")).exists(), "direct child was not reaped");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn bounded_command_preserves_signal_exit_status() {
        use std::os::unix::process::ExitStatusExt;
        let mut command = Command::new("bash");
        command.args(["-c", "kill -TERM $$"]);
        let status = run_bounded(&mut command, Duration::from_secs(3)).unwrap();
        assert_eq!(status.signal(), Some(15));
        assert_eq!(status.code(), None);
    }

    #[test]
    fn corrupt_archive_is_rejected_by_real_extractor() {
        let f = Fixture::new();
        let mut c = Command::new("printf");
        c.arg("this is not a tar archive");
        assert!(stage_archive(c, f.consumer(), Duration::from_secs(5)).is_err());
        assert!(!f.0.join("runtime").exists());
    }

    #[test]
    fn missing_required_runtime_file_is_not_published() {
        let f = Fixture::new();
        fs::remove_file(f.0.join("source/serve.mjs")).unwrap();
        assert!(stage_archive(f.producer(), f.consumer(), Duration::from_secs(5)).is_err());
        assert!(!f.publish().success());
        assert!(!f.0.join("runtime").exists());
    }

    #[test]
    fn timeout_stops_only_owned_children_and_reaps_them() {
        let f = Fixture::new();
        let mut unrelated = OwnedChild::spawn(Command::new("sleep").arg("20")).unwrap();
        let pid_file = f.0.join("producer.pid");
        let mut c = Command::new("bash");
        c.args(["-c", "echo $$ > \"$1\"; exec sleep 20", "producer"])
            .arg(&pid_file);
        let start = Instant::now();
        let error = stage_archive(c, f.consumer(), Duration::from_millis(300)).unwrap_err();
        let elapsed = start.elapsed();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut, "{error}");
        assert!(elapsed < Duration::from_secs(3), "elapsed={elapsed:?}; {error}");
        let diagnostic = error.to_string();
        for field in ["ready_ms", "producer_spawn_ms", "supervision_ms",
            "producer_cleanup_ms", "consumer_cleanup_ms", "total_ms"] {
            let value = diagnostic.split_once(&format!("{field}="))
                .unwrap_or_else(|| panic!("missing {field}: {diagnostic}"))
                .1.split_whitespace().next().unwrap();
            assert!(value.parse::<u128>().is_ok(), "invalid {field}: {diagnostic}");
        }
        assert!(unrelated.try_wait().unwrap().is_none());
        let pid = fs::read_to_string(pid_file).unwrap();
        assert!(!PathBuf::from(format!("/proc/{}", pid.trim())).exists());
        assert!(!f.0.join("runtime").exists());
    }

    #[test]
    fn failed_consumer_spawn_returns_error_without_publishing() {
        let c = Command::new("true");
        let start = Instant::now();
        assert_eq!(
            stage_archive(
                c,
                Command::new("/nonexistent-staging-extractor"),
                Duration::from_secs(5)
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::NotFound
        );
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn failed_producer_spawn_reaps_the_ready_consumer() {
        let f = Fixture::new();
        let mut consumer = Command::new("bash");
        consumer.args(["-c",
            "echo $$ > \"$1\"; printf 'papercusp-wsl-ready-v1\\n'; IFS= read -r seconds; exec sleep 20",
            "consumer"]).arg(f.0.join("consumer.pid"));
        assert_eq!(
            stage_archive(
                Command::new("/nonexistent-staging-producer"),
                consumer,
                Duration::from_secs(5)
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::NotFound
        );
        let pid = fs::read_to_string(f.0.join("consumer.pid")).unwrap();
        assert!(!PathBuf::from(format!("/proc/{}", pid.trim())).exists());
    }

    #[test]
    fn invalid_consumer_readiness_never_starts_producer() {
        let f = Fixture::new();
        let mut producer = Command::new("touch");
        producer.arg(f.0.join("producer-started"));
        let err =
            stage_archive(producer, Command::new("true"), Duration::from_secs(3)).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
        assert!(!f.0.join("producer-started").exists());
    }

    #[test]
    fn successful_consumer_cannot_hide_later_producer_failure() {
        let mut producer = Command::new("bash");
        producer.args(["-c", "sleep 0.1; exit 19"]);
        let consumer = delayed_ready("0", &["/bin/true"]);
        let err = stage_archive(producer, consumer, Duration::from_secs(3)).unwrap_err();
        // Preserve the actual kind/message if startup, wait or deadline errors
        // prevent observing the intended exit. A bare predicate hid that evidence.
        assert_eq!(err.kind(), io::ErrorKind::Other, "{err:?}");
        assert!(err.to_string().contains("archive producer"), "{err:?}");
        assert!(err.to_string().contains("19"), "{err:?}");
    }

    #[test]
    fn consumer_failure_reaps_owned_producer_not_unrelated_process() {
        let f = Fixture::new();
        let mut unrelated = OwnedChild::spawn(Command::new("sleep").arg("20")).unwrap();
        let mut producer = Command::new("bash");
        producer
            .args(["-c", "echo $$ > \"$1\"; exec sleep 20", "producer"])
            .arg(f.0.join("producer.pid"));
        let mut consumer = Command::new("bash");
        consumer
            .args([
                "-c",
                WSL_READY_SCRIPT,
                "ready",
                "/bin/bash",
                "-c",
                "while ! test -f \"$1\"; do sleep 0.01; done; exit 23",
                "consumer",
            ])
            .arg(f.0.join("producer.pid"));
        let error = stage_archive(producer, consumer, Duration::from_secs(3)).unwrap_err();
        assert!(error.to_string().contains("WSL archive extractor"), "{error:?}");
        let pid = fs::read_to_string(f.0.join("producer.pid")).unwrap();
        assert!(!PathBuf::from(format!("/proc/{}", pid.trim())).exists());
        assert!(unrelated.try_wait().unwrap().is_none());
    }

    #[test]
    fn one_successful_child_cannot_hide_the_other_timing_out() {
        for producer_stalls in [true, false] {
            let mut producer = Command::new(if producer_stalls { "sleep" } else { "true" });
            if producer_stalls {
                producer.arg("20");
            }
            let consumer = if producer_stalls {
                delayed_ready("0", &["/bin/true"])
            } else {
                delayed_ready("0", &["/bin/sleep", "20"])
            };
            let error = stage_archive(producer, consumer, Duration::from_millis(300)).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::TimedOut, "producer_stalls={producer_stalls}: {error:?}");
        }
    }

    #[test]
    fn streamed_archive_handles_fragmented_binary_pipe_reads() {
        let f = Fixture::new();
        let mut producer = Command::new("bash");
        producer.args(["-o", "pipefail", "-c",
            "tar -C \"$1\" -cf - . | node -e 'process.stdin.on(\"data\", b => { for (let i=0; i<b.length; i+=17) process.stdout.write(b.subarray(i,i+17)); });'",
            "producer"]).arg(f.0.join("source"));
        stage_archive(producer, f.consumer(), Duration::from_secs(5)).unwrap();
        assert_eq!(
            fs::read(f.0.join("stage/serve.mjs")).unwrap(),
            [0, 255, 13, 10, 128, 42]
        );
        assert!(!f.0.join("stage/.papercusp-runtime-complete").exists());
    }

    #[test]
    fn bounded_command_timeout_does_not_signal_other_children() {
        let mut unrelated = OwnedChild::spawn(Command::new("sleep").arg("20")).unwrap();
        let mut c = Command::new("sleep");
        c.arg("20");
        assert_eq!(
            run_bounded(&mut c, Duration::from_millis(50))
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
        assert!(unrelated.try_wait().unwrap().is_none());
    }

    #[test]
    fn an_existing_incomplete_generation_is_not_treated_as_complete() {
        let f = Fixture::new();
        stage_archive(f.producer(), f.consumer(), Duration::from_secs(5)).unwrap();
        fs::create_dir(f.0.join("runtime")).unwrap();
        assert!(!f.publish().success());
        assert!(!f.0.join("runtime/.papercusp-runtime-complete").exists());
    }

    #[test]
    fn native_archive_modes_restore_only_elf_and_shebang_execution() {
        use std::os::unix::fs::PermissionsExt;
        let f = Fixture::new();
        for (name, bytes) in [
            ("elf", b"\x7fELFxxx".as_slice()),
            ("script", b"#!/bin/sh\nexit 0".as_slice()),
            ("data", b"ordinary data".as_slice()),
            ("windows.exe", b"MZ\x90\0".as_slice()),
            ("windows.bat", b"@echo off".as_slice()),
        ] {
            let file = f.0.join("source").join(name);
            fs::write(&file, bytes).unwrap();
            // Match native tar's synthetic executable metadata, not a
            // Linux-only fixture whose data files already have correct bits.
            fs::set_permissions(file, fs::Permissions::from_mode(0o755)).unwrap();
        }
        stage_archive(f.producer(), f.consumer(), Duration::from_secs(5)).unwrap();
        for name in ["elf", "script"] {
            assert_eq!(
                fs::metadata(f.0.join("stage").join(name))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o111,
                0o100
            );
        }
        for name in ["data", "windows.exe", "windows.bat"] {
            assert_eq!(
                fs::metadata(f.0.join("stage").join(name))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o111,
                0
            );
        }
    }

    #[test]
    fn parent_writer_is_closed_so_consumer_observes_eof() {
        let f = Fixture::new();
        let mut producer = Command::new("printf");
        producer.arg("binary\\000\\377\\015\\012");
        let mut consumer = Command::new("bash");
        consumer
            .args([
                "-c",
                WSL_READY_SCRIPT,
                "ready",
                "/bin/bash",
                "-c",
                "cat > \"$1\"",
                "consume",
            ])
            .arg(f.0.join("pipe-output"));
        stage_archive(producer, consumer, Duration::from_secs(3)).unwrap();
        assert_eq!(
            fs::read(f.0.join("pipe-output")).unwrap(),
            b"binary\0\xff\r\n"
        );
    }

    #[test]
    fn wsl_timeout_is_anchored_inside_linux_not_only_the_client() {
        let c = wsl_command();
        let args: Vec<_> = c.get_args().map(|a| a.to_str().unwrap()).collect();
        assert_eq!(
            args,
            [
                "--distribution",
                "papercup-runtime",
                "--exec",
                "/bin/sh",
                "-c",
                WSL_READY_SCRIPT,
                "papercusp-wsl-ready"
            ]
        );
        assert!(WSL_READY_SCRIPT.contains("/usr/bin/timeout --kill-after=5s"));
    }

    #[test]
    fn producer_starts_only_after_readiness_and_remaining_budget_reply() {
        let f = Fixture::new();
        let mut producer = Command::new("bash");
        producer
            .args([
                "-c",
                "test -f \"$1/ready\" || exit 19; tar -C \"$1/source\" -cf - .",
                "producer",
            ])
            .arg(&f.0);
        let mut consumer = Command::new("bash");
        consumer.args(["-c",
            "sleep 0.3; touch \"$1/ready\"; printf 'papercusp-wsl-ready-v1\\n'; IFS= read -r seconds; printf '%s' \"$seconds\" > \"$1/budget\"; cat > \"$1/received.tar\"",
            "consumer"]).arg(&f.0);
        let budget = Duration::from_secs(5);
        stage_archive(producer, consumer, budget).unwrap();
        let seconds = fs::read_to_string(f.0.join("budget"))
            .unwrap()
            .trim_end_matches('s')
            .parse::<f64>()
            .unwrap();
        assert!(
            seconds > 0.0 && seconds <= 4.7,
            "startup spent budget: {seconds}"
        );
        assert!(fs::metadata(f.0.join("received.tar")).unwrap().len() > 0);
        assert!(
            !f.0.join("runtime").exists(),
            "diagnostic extraction is not publication"
        );
    }

    fn delayed_ready(delay: &str, args: &[&str]) -> Command {
        let mut command = Command::new("bash");
        command
            .args([
                "-c",
                "sleep \"$1\"; shift; exec /bin/sh -c \"$@\"",
                "boot",
                delay,
                WSL_READY_SCRIPT,
                "ready",
            ])
            .args(args);
        command
    }

    #[test]
    fn cold_start_does_not_spend_the_operation_budget() {
        let mut command = delayed_ready("3", &["/bin/true"]);
        let start = Instant::now();
        let status = run_ready_bounded(
            &mut command,
            Duration::from_secs(10),
            Duration::from_secs(2),
            Duration::from_secs(12),
        )
        .unwrap();
        assert!(status.success());
        assert!(
            start.elapsed() >= Duration::from_secs(3),
            "startup must actually exceed the operation budget"
        );
    }

    #[test]
    fn readiness_preserves_the_real_operation_exit_code() {
        let mut command = delayed_ready("0", &["/bin/sh", "-c", "exit 19"]);
        let status = run_ready_bounded(
            &mut command,
            Duration::from_secs(3),
            Duration::from_secs(1),
            Duration::from_secs(4),
        )
        .unwrap();
        assert_eq!(
            status.code(),
            Some(19),
            "a missing cache is not a startup failure"
        );
    }

    #[test]
    fn zero_exit_without_readiness_is_not_a_success() {
        let mut command = Command::new("true");
        assert_eq!(
            run_ready_bounded(
                &mut command,
                Duration::from_secs(3),
                Duration::from_secs(1),
                Duration::from_secs(4)
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::UnexpectedEof
        );
    }

    #[test]
    fn invalid_readiness_is_not_an_operation_result() {
        let mut command = Command::new("bash");
        command.args(["-c", "printf 'not-a-readiness-marker\\n'"]);
        assert_eq!(
            run_ready_bounded(
                &mut command,
                Duration::from_secs(3),
                Duration::from_secs(1),
                Duration::from_secs(4)
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn startup_timeout_reaps_only_the_owned_process() {
        let f = Fixture::new();
        let mut unrelated = OwnedChild::spawn(Command::new("sleep").arg("20")).unwrap();
        let mut command = Command::new("bash");
        command
            .args(["-c", "echo $$ > \"$1\"; exec sleep 20", "startup"])
            .arg(f.0.join("startup.pid"));
        let error = run_ready_bounded(
            &mut command,
            Duration::from_millis(300),
            Duration::from_secs(3),
            Duration::from_secs(4),
        )
        .unwrap_err();
        assert!(error.to_string().contains("before readiness"), "{error:?}");
        let pid = fs::read_to_string(f.0.join("startup.pid")).unwrap();
        assert!(!PathBuf::from(format!("/proc/{}", pid.trim())).exists());
        assert!(unrelated.try_wait().unwrap().is_none());
    }

    #[test]
    fn execution_timeout_begins_after_readiness() {
        let mut command = delayed_ready("0", &["/bin/sleep", "20"]);
        let result = run_ready_bounded(
            &mut command,
            Duration::from_secs(10),
            Duration::from_secs(1),
            Duration::from_secs(12),
        );
        match result {
            // The real Linux timeout may beat the parent watchdog to the exit.
            Ok(status) => assert_eq!(status.code(), Some(124)),
            Err(error) => assert!(error.to_string().contains("after readiness"), "{error:?}"),
        }
    }

    #[test]
    fn readiness_cannot_extend_the_archive_total_deadline() {
        let mut command = delayed_ready("0", &["/bin/sleep", "20"]);
        let start = Instant::now();
        let result = run_ready_bounded(
            &mut command,
            Duration::from_secs(20),
            Duration::from_secs(20),
            Duration::from_secs(3),
        );
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
        assert!(run_ready_bounded(
            &mut command,
            Duration::from_secs(10),
            Duration::from_secs(20),
            Duration::from_secs(10)
        )
        .unwrap()
        .success());
        let seconds = fs::read_to_string(f.0.join("budget"))
            .unwrap()
            .trim_end_matches('s')
            .parse::<f64>()
            .unwrap();
        assert!(
            seconds > 0.0 && seconds <= 9.7,
            "Linux received {seconds}s; startup must not be added back to its deadline"
        );
    }

    #[test]
    fn missing_parent_budget_never_starts_linux_operation() {
        let f = Fixture::new();
        let mut command = Command::new("bash");
        command
            .args(["-c", WSL_READY_SCRIPT, "ready", "/usr/bin/touch"])
            .arg(f.0.join("must-not-run"))
            .stdin(Stdio::null())
            .stdout(Stdio::null());
        assert_eq!(
            run_bounded(&mut command, Duration::from_secs(5))
                .unwrap()
                .code(),
            Some(125)
        );
        assert!(!f.0.join("must-not-run").exists());
    }
}
    #[cfg(unix)]
    #[test]
    fn bounded_output_drains_both_pipes_and_refuses_oversized_receipts() {
        let mut command = Command::new("sh");
        command.args(["-c", "printf 'receipt'; printf 'diagnostic' >&2"]);
        let output = run_bounded_output(&mut command, Duration::from_secs(2)).unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"receipt");
        assert_eq!(output.stderr, b"diagnostic");
        let mut oversized = Command::new("sh");
        oversized.args(["-c", "head -c 20000 /dev/zero"]);
        assert_eq!(run_bounded_output(&mut oversized, Duration::from_secs(2)).unwrap_err().kind(), io::ErrorKind::InvalidData);
    }

    #[cfg(unix)]
    #[test]
    fn bounded_output_stops_an_owned_hung_capability_probe() {
        let mut command = Command::new("sh");
        command.args(["-c", "exec sleep 10"]);
        let start = Instant::now();
        assert_eq!(run_bounded_output(&mut command, Duration::from_millis(50)).unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(2));
    }

