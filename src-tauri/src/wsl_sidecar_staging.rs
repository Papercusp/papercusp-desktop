//! The Windows reader and WSL writer must not enumerate NTFS through DrvFs.
//! Keep archive production/extraction separate from publication: a successful
//! extractor cannot attest that the producer supplied its entire source tree.

use std::io;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

pub const ARCHIVE_ARGS: &[&str] = &[
    "--exclude=./source.tar.zst",
    "--exclude=./db-seed.dump",
    "--exclude=./db-seed.tar.gz",
    "-cf",
    "-",
    ".",
];

pub const EXTRACT_SCRIPT: &str = r#"set -euo pipefail
temporary_dir=$1
rm -rf -- "$temporary_dir"
mkdir -p -- "$temporary_dir"
tar -C "$temporary_dir" -xf -
test -f "$temporary_dir/serve.mjs"
test -f "$temporary_dir/sidecar-preload.js"
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

/// Connect OS pipe handles directly. A PowerShell text pipeline would corrupt
/// binary archive bytes. Inherit stderr so native errors reach server-app.log.
pub fn stream_archive(
    producer: &mut Command,
    consumer: &mut Command,
    timeout: Duration,
) -> io::Result<()> {
    let mut producer = OwnedChild(producer.stdin(Stdio::null()).stdout(Stdio::piped()).spawn()?);
    let pipe = producer.0.stdout.take().expect("piped archive stdout");
    let mut consumer = OwnedChild(consumer.stdin(Stdio::from(pipe)).spawn()?);
    let deadline = Instant::now() + timeout;
    let mut producer_done = false;
    let mut consumer_done = false;
    loop {
        for (child, done, label) in [
            (&mut producer.0, &mut producer_done, "archive producer"),
            (&mut consumer.0, &mut consumer_done, "WSL archive extractor"),
        ] {
            if !*done {
                if let Some(status) = child.try_wait()? {
                    if !status.success() {
                        return Err(io::Error::other(format!("{label} exited with {status}")));
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
                "Windows sidecar stream timed out; only the owned copy children were stopped",
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
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
            c.arg("-C").arg(self.0.join("source")).args(ARCHIVE_ARGS);
            c
        }
        fn consumer(&self) -> Command {
            let mut c = Command::new("bash");
            c.args(["-c", EXTRACT_SCRIPT, "extract"]).arg(self.0.join("stage"));
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
        stream_archive(&mut f.producer(), &mut f.consumer(), Duration::from_secs(5)).unwrap();
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
        c.args(["-c", "tar -C \"$1\" -cf - .; exit 19", "producer"])
            .arg(f.0.join("source"));
        let err = stream_archive(&mut c, &mut f.consumer(), Duration::from_secs(5)).unwrap_err();
        assert!(err.to_string().contains("archive producer"));
        assert!(!f.0.join("runtime").exists());
        assert!(!f.0.join("stage/.papercusp-runtime-complete").exists());
    }

    #[test]
    fn corrupt_archive_is_rejected_by_real_extractor() {
        let f = Fixture::new();
        let mut c = Command::new("printf");
        c.arg("this is not a tar archive");
        assert!(stream_archive(&mut c, &mut f.consumer(), Duration::from_secs(5)).is_err());
        assert!(!f.0.join("runtime").exists());
    }

    #[test]
    fn missing_required_runtime_file_is_not_published() {
        let f = Fixture::new();
        fs::remove_file(f.0.join("source/serve.mjs")).unwrap();
        assert!(stream_archive(&mut f.producer(), &mut f.consumer(), Duration::from_secs(5)).is_err());
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
        let mut sink = Command::new("cat");
        sink.stdout(Stdio::null());
        let start = Instant::now();
        assert_eq!(stream_archive(&mut c, &mut sink, Duration::from_millis(300))
            .unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(3));
        assert!(unrelated.0.try_wait().unwrap().is_none());
        let pid = fs::read_to_string(pid_file).unwrap();
        assert!(!PathBuf::from(format!("/proc/{}", pid.trim())).exists());
        assert!(!f.0.join("runtime").exists());
    }

    #[test]
    fn failed_consumer_spawn_reaps_producer() {
        let mut c = Command::new("sleep");
        c.arg("20");
        let mut sink = Command::new("/nonexistent-staging-extractor");
        let start = Instant::now();
        assert_eq!(stream_archive(&mut c, &mut sink, Duration::from_secs(5))
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
        stream_archive(&mut f.producer(), &mut f.consumer(), Duration::from_secs(5)).unwrap();
        fs::create_dir(f.0.join("runtime")).unwrap();
        assert!(!f.publish().success());
        assert!(!f.0.join("runtime/.papercusp-runtime-complete").exists());
    }
}
