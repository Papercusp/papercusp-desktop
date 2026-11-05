//! Native consumer of tauri-release-kit's exact dual-signed update protocol.
//!
//! The caller supplies CURRENT protected trust and independently extracted candidate
//! bytes/identity. `verify` is pure; `activate_current_update` keeps the protected
//! trust read, durable monotonic floors and install effect in one transaction.

use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

// Shared by the privileged Mac entry point and the maintained native harness.
// No GUI-supplied installer closure receives root authority.
#[cfg(unix)]
#[path = "macos_update_installer.rs"]
pub mod macos_update_installer;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub schema: String,
    pub artifact_sha256: String,
    pub policy_sha256: String,
    pub configuration_sha256: String,
    pub source_revision: String,
    pub version: String,
    pub product: String,
    pub platform: String,
    pub author_ids: Vec<String>,
    pub approver_id: String,
    pub approver_epoch: u64,
    pub signer_id: String,
    pub signer_epoch: u64,
    pub root_epoch: u64,
    pub rollback_counter: u64,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
    pub approval_signature: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedKey {
    pub id: String,
    pub epoch: u64,
    pub principal_id: String,
    pub public_key: String,
    pub revoked: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trust {
    pub root_epoch: u64,
    pub min_rollback_counter: u64,
    pub min_issued_at: u64,
    pub max_metadata_age_ms: u64,
    pub signers: Vec<TrustedKey>,
    pub approvers: Vec<TrustedKey>,
}

/// Read CURRENT trust from the existing administrator policy. Manifest keys,
/// environment overrides and user-owned startup policy cannot supply this state.
/// A channel-only or missing policy refuses update authorization.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn read_current_trust() -> Result<Trust, String> {
    protected_policy::read_current()
}

/// Activation uses CURRENT administrator trust, not an earlier verifier result.
/// All cooperating policy writers and activators lock the protected directory.
/// A crash releases the kernel lock but never lowers the persisted floors.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn activate_current_update<T>(
    envelope: &Envelope,
    candidate: &Candidate<'_>,
    now: u64,
    install: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    protected_policy::activate_in(&protected_policy::current_directory()?, 0, envelope, candidate, now, install)
}

/// Identity comes from the running application and the selected Tauri update;
/// candidate policy/source/authors come only from the downloaded native image.
pub struct DownloadedUpdate<'a> {
    pub artifact: &'a [u8],
    pub manifest: &'a serde_json::Value,
    pub version: &'a str,
    pub product: &'a str,
    pub platform: &'a str,
}

fn prepare_macos_update(download: &DownloadedUpdate<'_>) -> Result<(Envelope, ExtractedInputs), String> {
    let envelope = serde_json::from_value(download.manifest.get("updateAuthorization")
        .ok_or("update has no independent release authorization")?.clone())
        .map_err(|_| "update has invalid independent release authorization")?;
    let inputs = extract_macos_archive_inputs(download.artifact, download.platform)?;
    if inputs.version != download.version || inputs.product != download.product {
        return Err("downloaded Mac update differs from selected version or running product".into());
    }
    Ok((envelope, inputs))
}

#[cfg(target_os = "macos")]
pub fn activate_downloaded_macos_update<T>(
    download: &DownloadedUpdate<'_>,
    install: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let (envelope, inputs) = prepare_macos_update(download)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "update authorization clock is unavailable")?.as_millis()
        .try_into().map_err(|_| "update authorization clock is out of range")?;
    activate_current_update(&envelope, &inputs.candidate(download.artifact), now, install)
}

// Same preparation and transaction, with a test-only protected directory/uid.
#[cfg(all(test, unix))]
pub fn activate_test_macos_update<T>(
    directory: &std::fs::File,
    download: &DownloadedUpdate<'_>,
    now: u64,
    install: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let (envelope, inputs) = prepare_macos_update(download)?;
    activate_test_update(directory, &envelope, &inputs.candidate(download.artifact), now, install)
}

// The owner/path override exists only in the maintained native test harness.
#[cfg(all(test, unix))]
pub fn activate_test_update<T>(
    directory: &std::fs::File,
    envelope: &Envelope,
    candidate: &Candidate<'_>,
    now: u64,
    install: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    use std::os::unix::fs::MetadataExt;
    let owner = directory.metadata().map_err(|e| e.to_string())?.uid();
    protected_policy::activate_in(directory, owner, envelope, candidate, now, install)
}

#[cfg(unix)]
mod protected_policy {
    use super::*;
    use fs2::FileExt;
    use std::fs::{File, Metadata as FileMetadata};
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::MetadataExt;
    use std::sync::atomic::{AtomicU64, Ordering};

    const MAX_BYTES: u64 = 16_384;
    const INVALID: &str = "protected administrator update trust is absent, invalid or unreadable";

    #[derive(Deserialize, Serialize)]
    #[serde(deny_unknown_fields)]
    struct Policy {
        version: u32,
        update_channel: String,
        #[serde(rename = "updateAuthorization")]
        update_authorization: Trust,
    }

    fn trusted(stat: &FileMetadata, owner: u32, directory: bool) -> bool {
        stat.uid() == owner
            && stat.mode() & 0o022 == 0
            && if directory {
                stat.is_dir()
            } else {
                stat.is_file() && stat.nlink() == 1
            }
    }

    fn child(parent: &File, name: &str, directory: bool) -> Result<File, String> {
        let name = std::ffi::CString::new(name).map_err(|_| INVALID)?;
        let flags = libc::O_RDONLY
            | libc::O_CLOEXEC
            | libc::O_NOFOLLOW
            | libc::O_NONBLOCK
            | if directory { libc::O_DIRECTORY } else { 0 };
        // Anchor every component to its validated FD, rejecting symlinks before
        // opening the next component. NONBLOCK also prevents FIFO denial of service.
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(INVALID.into());
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub(super) fn current_directory() -> Result<File, String> {
        // /etc is a symlink on macOS. Walk its fixed physical path instead of
        // relaxing NOFOLLOW or accepting a user/environment-selected location.
        #[cfg(target_os = "linux")]
        let components = ["etc", "papercusp"].as_slice();
        #[cfg(target_os = "macos")]
        let components = ["private", "etc", "papercusp"].as_slice();
        directory_at(File::open("/").map_err(|_| INVALID)?, components, 0)
    }

    fn directory_at(mut directory: File, components: &[&str], owner: u32) -> Result<File, String> {
        for name in components {
            if !trusted(&directory.metadata().map_err(|_| INVALID)?, owner, true) {
                return Err(INVALID.into());
            }
            directory = child(&directory, name, true)?;
        }
        if !trusted(&directory.metadata().map_err(|_| INVALID)?, owner, true) {
            return Err(INVALID.into());
        }
        Ok(directory)
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub(super) fn read_current() -> Result<Trust, String> {
        read_in(&current_directory()?, 0)
    }

    fn stable(a: &FileMetadata, b: &FileMetadata) -> bool {
        (
            a.dev(),
            a.ino(),
            a.uid(),
            a.gid(),
            a.mode(),
            a.nlink(),
            a.len(),
            a.mtime(),
            a.mtime_nsec(),
            a.ctime(),
            a.ctime_nsec(),
        ) == (
            b.dev(),
            b.ino(),
            b.uid(),
            b.gid(),
            b.mode(),
            b.nlink(),
            b.len(),
            b.mtime(),
            b.mtime_nsec(),
            b.ctime(),
            b.ctime_nsec(),
        )
    }

    fn read_in(directory: &File, owner: u32) -> Result<Trust, String> {
        Ok(read_policy_in(directory, owner)?.update_authorization)
    }

    fn read_policy_in(directory: &File, owner: u32) -> Result<Policy, String> {
        if !trusted(&directory.metadata().map_err(|_| INVALID)?, owner, true) {
            return Err(INVALID.into());
        }
        let file = child(directory, "managed-policy.json", false)?;
        let before = file.metadata().map_err(|_| INVALID)?;
        if !trusted(&before, owner, false) || before.len() == 0 || before.len() > MAX_BYTES {
            return Err(INVALID.into());
        }
        let mut bytes = Vec::new();
        (&file)
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| INVALID)?;
        let after = file.metadata().map_err(|_| INVALID)?;
        if bytes.len() as u64 != before.len() || !stable(&before, &after) {
            return Err(INVALID.into());
        }
        let policy: Policy = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        if policy.version != 1
            || !["alpha", "beta", "stable"].contains(&policy.update_channel.as_str())
        {
            return Err(INVALID.into());
        }
        let trust = &policy.update_authorization;
        if [
            trust.root_epoch,
            trust.min_rollback_counter,
            trust.min_issued_at,
            trust.max_metadata_age_ms,
        ]
        .iter()
        .any(|n| *n > MAX_SAFE_INTEGER)
            || trust.max_metadata_age_ms == 0
        {
            return Err(INVALID.into());
        }
        for keys in [&trust.signers, &trust.approvers] {
            if keys.is_empty() || keys.len() > 64 {
                return Err(INVALID.into());
            }
            for k in keys {
                if !label(&k.id)
                    || !label(&k.principal_id)
                    || k.epoch > MAX_SAFE_INTEGER
                    || k.public_key.len() > 4096
                    || key(&k.public_key).is_err()
                {
                    return Err(INVALID.into());
                }
            }
        }
        Ok(policy)
    }

    /// Reuse the protected policy directory as the kernel lock identity across
    /// GUI/Server processes. Open it afresh: closing this descriptor must release
    /// its flock even when the caller retains the original directory descriptor.
    pub(super) fn activate_in<T>(
        directory: &File,
        owner: u32,
        envelope: &Envelope,
        candidate: &Candidate<'_>,
        now: u64,
        install: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let locked = child(directory, ".", true)?;
        if !trusted(&locked.metadata().map_err(|_| INVALID)?, owner, true) {
            return Err(INVALID.into());
        }
        locked.try_lock_exclusive().map_err(|_| "protected update activation is busy or unavailable")?;
        let mut policy = read_policy_in(&locked, owner)?;
        let authorized = verify(&policy.update_authorization, envelope, candidate, now)?;
        let original = serde_json::to_vec(&policy).map_err(|_| INVALID)?;
        policy.update_authorization.min_rollback_counter = policy.update_authorization
            .min_rollback_counter.max(authorized.metadata().rollback_counter);
        policy.update_authorization.min_issued_at = policy.update_authorization
            .min_issued_at.max(authorized.metadata().issued_at);
        let next = serde_json::to_vec(&policy).map_err(|_| INVALID)?;
        if next.len() as u64 > MAX_BYTES {
            return Err(INVALID.into());
        }
        // Catch an administrator edit before replacing it. Administrators must
        // use this same lock to serialize revocation with the install effect.
        if serde_json::to_vec(&read_policy_in(&locked, owner)?).map_err(|_| INVALID)? != original {
            return Err("administrator update trust changed before activation".into());
        }
        if next != original {
            replace_policy(&locked, owner, &next)?;
        }
        // Commit BEFORE install. An install failure conservatively retains the
        // floors so another process cannot reopen an older signed candidate.
        let result = install();
        drop(locked);
        result
    }

    fn replace_policy(directory: &File, owner: u32, bytes: &[u8]) -> Result<(), String> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let previous = child(directory, "managed-policy.json", false)?.metadata().map_err(|_| INVALID)?;
        if !trusted(&previous, owner, false) {
            return Err(INVALID.into());
        }
        let name = std::ffi::CString::new(format!(
            ".managed-policy-{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)
        )).map_err(|_| INVALID)?;
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0o600) };
        if fd < 0 { return Err("cannot durably advance protected update floors".into()); }
        let mut file = unsafe { File::from_raw_fd(fd) };
        let target = std::ffi::CString::new("managed-policy.json").unwrap();
        let result = (|| {
            // Retain administrator-authorized readers (including the existing
            // operator channel reader); do not silently make a 0644 policy 0600.
            let created = file.metadata().map_err(|_| INVALID)?;
            if created.gid() != previous.gid()
                && unsafe { libc::fchown(file.as_raw_fd(), owner, previous.gid()) } != 0 {
                return Err(INVALID.into());
            }
            if unsafe { libc::fchmod(file.as_raw_fd(), previous.mode() & 0o777) } != 0 {
                return Err(INVALID.into());
            }
            if !trusted(&file.metadata().map_err(|_| INVALID)?, owner, false) {
                return Err(INVALID.into());
            }
            file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| INVALID)?;
            if unsafe { libc::renameat(directory.as_raw_fd(), name.as_ptr(), directory.as_raw_fd(), target.as_ptr()) } != 0 {
                return Err("cannot atomically advance protected update floors".into());
            }
            directory.sync_all().map_err(|_| "cannot sync protected update floors")?;
            Ok(())
        })();
        if result.is_err() {
            unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0); }
        }
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::fs::{self, OpenOptions, Permissions};
        use std::os::unix::fs::{symlink, OpenOptionsExt, PermissionsExt};
        use std::sync::atomic::{AtomicU64, Ordering};

        static NEXT: AtomicU64 = AtomicU64::new(0);
        struct Fixture(std::path::PathBuf);
        impl Fixture {
            fn new() -> Self {
                let path = std::env::temp_dir().join(format!(
                    "pc-update-trust-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
                fs::create_dir(&path).unwrap();
                fs::set_permissions(&path, Permissions::from_mode(0o700)).unwrap();
                Self(path)
            }
            fn write(&self, bytes: &[u8]) {
                let path = self.0.join("managed-policy.json");
                fs::write(&path, bytes).unwrap();
                fs::set_permissions(path, Permissions::from_mode(0o600)).unwrap();
            }
            fn read(&self) -> Result<Trust, String> {
                let directory = File::open(&self.0).unwrap();
                // Only tests use their own uid; production has no owner/path override.
                read_in(&directory, directory.metadata().unwrap().uid())
            }
        }
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }

        fn valid() -> serde_json::Value {
            let key = serde_json::json!({"id":"release", "epoch":2, "principalId":"release-principal",
                "publicKey":STANDARD.encode([b"Ed".as_slice(), &[1u8;8], &[2u8;32]].concat()), "revoked":false});
            serde_json::json!({"version":1,"update_channel":"stable","updateAuthorization":{
                "rootEpoch":3,"minRollbackCounter":7,"minIssuedAt":1000,"maxMetadataAgeMs":1500,
                "signers":[key.clone()],"approvers":[key]}})
        }

        #[test]
        fn protected_mac_physical_ancestors_refuse_symlinks_and_writable_directories() {
            let f = Fixture::new();
            fs::create_dir_all(f.0.join("private/etc/papercusp")).unwrap();
            // create_dir_all inherits the runner's umask, which may allow group
            // writes. Establish trusted ancestors explicitly before testing them.
            for path in ["private", "private/etc", "private/etc/papercusp"] {
                fs::set_permissions(f.0.join(path), Permissions::from_mode(0o755)).unwrap();
            }
            let root = || File::open(&f.0).unwrap();
            let owner = root().metadata().unwrap().uid();
            let components = ["private", "etc", "papercusp"];
            directory_at(root(), &components, owner).expect("explicitly protected ancestors");
            for path in ["private", "private/etc", "private/etc/papercusp"] {
                let path = f.0.join(path);
                for mode in [0o775, 0o757, 0o777] {
                    fs::set_permissions(&path, Permissions::from_mode(mode)).unwrap();
                    assert!(directory_at(root(), &components, owner).is_err(),
                        "must refuse writable ancestor {} ({mode:o})", path.display());
                }
                fs::set_permissions(&path, Permissions::from_mode(0o755)).unwrap();
                let target = path.with_extension("actual");
                fs::rename(&path, &target).unwrap();
                symlink(&target, &path).unwrap();
                assert!(directory_at(root(), &components, owner).is_err());
                fs::remove_file(&path).unwrap();
                fs::rename(&target, &path).unwrap();
            }
            assert!(directory_at(root(), &components, owner.wrapping_add(1)).is_err());
        }

        #[test]
        fn protected_policy_reloads_current_revocation_and_floors() {
            let f = Fixture::new();
            let mut p = valid();
            f.write(&serde_json::to_vec(&p).unwrap());
            assert_eq!(f.read().unwrap().min_rollback_counter, 7);
            p["updateAuthorization"]["minRollbackCounter"] = 8.into();
            p["updateAuthorization"]["signers"][0]["revoked"] = true.into();
            f.write(&serde_json::to_vec(&p).unwrap());
            let current = f.read().unwrap();
            assert_eq!(current.min_rollback_counter, 8);
            assert!(current.signers[0].revoked);
        }

        #[test]
        fn protected_policy_refuses_missing_symlink_hardlink_fifo_and_permissions() {
            let f = Fixture::new();
            let path = f.0.join("managed-policy.json");
            assert!(f.read().is_err());
            let bytes = serde_json::to_vec(&valid()).unwrap();
            f.write(&bytes);
            let target = f.0.join("actual");
            fs::rename(&path, &target).unwrap();
            symlink(&target, &path).unwrap();
            assert!(f.read().is_err());
            fs::remove_file(&path).unwrap();
            fs::hard_link(&target, &path).unwrap();
            assert!(f.read().is_err());
            fs::remove_file(&path).unwrap();
            let name = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
            assert!(f.read().is_err());
            fs::remove_file(&path).unwrap();
            f.write(&bytes);
            fs::set_permissions(&path, Permissions::from_mode(0o620)).unwrap();
            assert!(f.read().is_err());
            fs::set_permissions(&path, Permissions::from_mode(0o600)).unwrap();
            fs::set_permissions(&f.0, Permissions::from_mode(0o720)).unwrap();
            assert!(f.read().is_err());
            fs::set_permissions(&f.0, Permissions::from_mode(0o700)).unwrap();
            let fd = File::open(&f.0).unwrap();
            assert!(read_in(&fd, fd.metadata().unwrap().uid() + 1).is_err());
        }

        #[test]
        fn protected_policy_rejects_unbounded_ambiguous_or_incomplete_input() {
            let f = Fixture::new();
            for bytes in [
                vec![],
                vec![b' '; MAX_BYTES as usize + 1],
                b"{}".to_vec(),
                br#"{"version":1,"update_channel":"stable"}"#.to_vec(),
                serde_json::to_vec(&valid())
                    .unwrap()
                    .into_iter()
                    .chain(b"garbage".iter().copied())
                    .collect(),
            ] {
                f.write(&bytes);
                assert!(f.read().is_err());
            }
            let good = serde_json::to_string(&valid()).unwrap();
            f.write(good.replacen('{', "{\"version\":1,", 1).as_bytes());
            assert!(f.read().is_err());
            for field in [
                "rootEpoch",
                "minRollbackCounter",
                "minIssuedAt",
                "maxMetadataAgeMs",
            ] {
                let mut p = valid();
                p["updateAuthorization"][field] = (MAX_SAFE_INTEGER + 1).into();
                f.write(&serde_json::to_vec(&p).unwrap());
                assert!(f.read().is_err());
            }
            for field in ["unknown", "signers", "approvers"] {
                let mut p = valid();
                p["updateAuthorization"][field] = serde_json::json!([]);
                f.write(&serde_json::to_vec(&p).unwrap());
                assert!(f.read().is_err());
            }
            let mut p = valid();
            p["updateAuthorization"]["signers"][0]["publicKey"] = "untrusted".into();
            f.write(&serde_json::to_vec(&p).unwrap());
            assert!(f.read().is_err());
        }

        #[test]
        fn protected_policy_component_open_does_not_follow_directory_symlinks() {
            let f = Fixture::new();
            let fd = File::open(&f.0).unwrap();
            fs::create_dir(f.0.join("real")).unwrap();
            symlink("real", f.0.join("alias")).unwrap();
            assert!(child(&fd, "alias", true).is_err());
            assert!(child(&fd, "real", true).is_ok());
            let file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(f.0.join("file"))
                .unwrap();
            assert!(child(&fd, "file", true).is_err());
            drop(file);
        }
    }
}

pub struct Candidate<'a> {
    pub artifact: &'a [u8],
    pub policy: &'a [u8],
    pub configuration: &'a [u8],
    pub source_revision: &'a str,
    pub version: &'a str,
    pub product: &'a str,
    pub platform: &'a str,
    pub author_ids: &'a [String],
}

/// Actual build inputs embedded in a native image, not digests supplied by the
/// update manifest. The build producer must emit these from the same effective
/// inputs it compiles. Extraction alone does not attest that producer or approve
/// installation; `verify` still authenticates the complete artifact and inputs.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtractedInputs {
    schema: String,
    policy: String,
    configuration: String,
    source_revision: String,
    version: String,
    product: String,
    platform: String,
    author_ids: Vec<String>,
}

impl ExtractedInputs {
    pub fn candidate<'a>(&'a self, artifact: &'a [u8]) -> Candidate<'a> {
        Candidate {
            artifact,
            policy: self.policy.as_bytes(),
            configuration: self.configuration.as_bytes(),
            source_revision: &self.source_revision,
            version: &self.version,
            product: &self.product,
            platform: &self.platform,
            author_ids: &self.author_ids,
        }
    }
}

/// Inspect the same .app.tar.gz layout the Mac updater installs, without
/// extracting files or executing the candidate. The signed artifact remains the
/// WHOLE archive. This only selects inputs; it grants no installation authority.
pub fn extract_macos_archive_inputs(artifact: &[u8], platform: &str) -> Result<ExtractedInputs, String> {
    use std::collections::{BTreeMap, HashSet};
    use std::io::Cursor;

    if !matches!(platform, "darwin-x86_64" | "darwin-aarch64") {
        return Err("unsupported Mac archive target".into());
    }
    // First bound physical entries, including metadata hidden by tar's logical
    // iterator. GNU long names/links are used by the bundler. PAX/sparse/device
    // records are not part of this qualified format and must refuse explicitly.
    scan_macos_archive(artifact, true, |_, _, _, _| Ok(()))?;
    let mut root = None;
    let mut explicit = HashSet::new();
    let mut nodes: BTreeMap<String, (String, bool)> = BTreeMap::new();
    let mut info = None;
    scan_macos_archive(artifact, false, |path, header, link, reader| {
        let directory = header.entry_type().is_dir();
        let parts = mac_path(path, directory)?;
        if !parts[0].ends_with(".app") || root.as_ref().is_some_and(|s| s != parts[0]) {
            return Err("Mac archive must contain exactly one app root".into());
        }
        root = Some(parts[0].to_owned());
        if parts.len() == 1 && !directory {
            return Err("Mac archive root is not a directory".into());
        }
        // Mirror updater.rs: discard the FIRST component. Reject aliases and
        // file/link ancestors even if an archive puts the conflicting node last.
        let installed = parts[1..].join("/");
        if !explicit.insert(installed.clone()) {
            return Err("duplicate installed Mac archive path".into());
        }
        for i in 1..parts.len() {
            let prefix = parts[1..=i].join("/");
            let is_directory = i + 1 < parts.len() || directory;
            let key = prefix.to_ascii_lowercase();
            if let Some((prior, prior_directory)) = nodes.get(&key) {
                if prior != &prefix || !prior_directory || !is_directory {
                    return Err("aliased or conflicting installed Mac archive path".into());
                }
            } else {
                nodes.insert(key, (prefix, is_directory));
            }
        }
        if header.entry_type().is_symlink() {
            // No ascending or absolute targets: common Frameworks/Versions/Current
            // links remain usable, while every possible link chain stays inside
            // its app. Descendants of links are rejected by the namespace above.
            mac_path(link.ok_or("missing Mac archive link target")?, false)?;
        }
        if installed == "Contents/Info.plist" {
            if !header.entry_type().is_file() || header.size().map_err(|e| e.to_string())? > 65_536 {
                return Err("invalid or oversized Mac bundle info".into());
            }
            let mut bytes = Vec::new();
            reader.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            info = Some(bytes);
        }
        Ok(())
    })?;
    let info = info.ok_or("Mac archive has no installed bundle info")?;
    // Bound nesting/event amplification before serde constructs the plist.
    let mut depth = 0u32;
    for (n, event) in plist::stream::Reader::new(Cursor::new(&info)).enumerate() {
        use plist::stream::Event;
        if n >= 16_384 { return Err("Mac bundle info has too many events".into()); }
        match event.map_err(|e| e.to_string())? {
            Event::StartArray(_) | Event::StartDictionary(_) => {
                depth += 1;
                if depth > 32 { return Err("Mac bundle info is too deeply nested".into()); }
            }
            Event::EndCollection => { depth = depth.checked_sub(1).ok_or("invalid Mac bundle info")?; }
            _ => {}
        }
    }
    #[derive(Deserialize)]
    struct BundleInfo {
        #[serde(rename = "CFBundleExecutable")]
        executable: String,
        #[serde(rename = "CFBundleIdentifier")]
        identifier: String,
        #[serde(rename = "CFBundleShortVersionString")]
        version: String,
    }
    // Direct deserialization also rejects duplicate identity fields, rather than
    // silently choosing a value from a lossy dictionary conversion.
    let bundle: BundleInfo = plist::from_bytes(&info).map_err(|e| e.to_string())?;
    if mac_path(&bundle.executable, false)?.len() != 1 {
        return Err("invalid Mac bundle executable name".into());
    }
    let selected = format!("Contents/MacOS/{}", bundle.executable);
    let mut binary = None;
    scan_macos_archive(artifact, false, |path, header, _, reader| {
        if mac_path(path, header.entry_type().is_dir())?[1..].join("/") == selected {
            if !header.entry_type().is_file() || header.mode().map_err(|e| e.to_string())? & 0o111 == 0 {
                return Err("Mac bundle executable is not an executable regular file".into());
            }
            let mut bytes = Vec::new();
            reader.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            binary = Some(bytes);
        }
        Ok(())
    })?;
    let binary = binary.ok_or("Mac archive has no installed main executable")?;
    let inputs = extract_binary_inputs(&binary, platform)?;
    if inputs.product != bundle.identifier || inputs.version != bundle.version {
        return Err("Mac bundle info differs from reviewed executable identity".into());
    }
    Ok(inputs)
}

// Canonical ASCII paths avoid Unicode normalization/case aliases across Mac
// volumes. Non-ASCII archive paths refuse until their native semantics qualify.
fn mac_path(path: &str, directory: bool) -> Result<Vec<&str>, String> {
    let path = if directory { path.strip_suffix('/').unwrap_or(path) } else { path };
    if path.len() > 4096 || !path.bytes().all(|b| (0x20..=0x7e).contains(&b) && b != b'\\' && b != b':') {
        return Err("unsupported Mac archive path encoding".into());
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.iter().any(|s| s.is_empty() || *s == "." || *s == "..") {
        return Err("noncanonical or escaping Mac archive path".into());
    }
    Ok(parts)
}

fn scan_macos_archive(
    artifact: &[u8], raw: bool,
    inspect: impl FnMut(&str, &tar::Header, Option<&str>, &mut dyn std::io::Read) -> Result<(), String>,
) -> Result<(), String> {
    scan_macos_archive_with_budget(artifact, raw, 2 * 1024 * 1024 * 1024, inspect)
}

fn scan_macos_archive_with_budget(
    artifact: &[u8], raw: bool, max_unpacked: u64,
    mut inspect: impl FnMut(&str, &tar::Header, Option<&str>, &mut dyn std::io::Read) -> Result<(), String>,
) -> Result<(), String> {
    use std::io::{self, Read};
    if artifact.len() as u64 > 1024 * 1024 * 1024 { return Err("Mac archive is too large".into()); }
    let mut decoder = flate2::bufread::GzDecoder::new(artifact).take(max_unpacked + 1);
    {
        let mut archive = tar::Archive::new(&mut decoder);
        for (n, entry) in archive.entries().map_err(|e| e.to_string())?.raw(raw).enumerate() {
            if n >= 65_536 { return Err("Mac archive has too many entries".into()); }
            let mut entry = entry.map_err(|e| e.to_string())?;
            let header = entry.header().clone();
            let kind = header.entry_type();
            let extension = raw && (kind.is_gnu_longname() || kind.is_gnu_longlink());
            let limit = if extension { 4096 } else { 512 * 1024 * 1024 };
            if entry.size() > limit || (!extension && !kind.is_file() && !kind.is_dir() && !kind.is_symlink())
                || header.mode().map_err(|e| e.to_string())? & 0o7000 != 0
                || ((kind.is_dir() || kind.is_symlink()) && entry.size() != 0)
            {
                return Err("unsupported or oversized Mac archive entry".into());
            }
            if !raw {
                let path = entry.path_bytes().into_owned();
                let link = entry.link_name_bytes().map(|s| s.into_owned());
                let path = std::str::from_utf8(&path).map_err(|_| "invalid Mac archive path")?;
                let link = link.as_deref().map(std::str::from_utf8).transpose().map_err(|_| "invalid Mac archive link")?;
                inspect(path, &header, link, &mut entry)?;
            }
            io::copy(&mut entry, &mut io::sink()).map_err(|e| e.to_string())?;
        }
    }
    // Read through the gzip trailer even when tar has reached its zero blocks:
    // enforce total inflation, CRC/truncation, and exactly one gzip member.
    io::copy(&mut decoder, &mut io::sink()).map_err(|e| e.to_string())?;
    if decoder.limit() == 0 || !decoder.into_inner().into_inner().is_empty() {
        return Err("oversized or trailing Mac gzip data".into());
    }
    Ok(())
}

#[cfg(test)]
mod archive_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn candidate_inflation_limit_counts_trailing_tar_padding() {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&[0u8; 4096]).unwrap();
        let archive = encoder.finish().unwrap();
        for raw in [false, true] {
            assert!(scan_macos_archive_with_budget(&archive, raw, 1024, |_, _, _, _| Ok(())).is_err());
            assert!(scan_macos_archive_with_budget(&archive, raw, 4096, |_, _, _, _| Ok(())).is_ok());
        }
        println!("native-mac-inflation: bound includes padding after tar end");
    }
}

/// Read actual native inputs without running the candidate. Universal Mach-O
/// images are selected by their validated architecture table, never by scanning
/// for a provenance marker. Archive callers must first select the executable.
pub fn extract_binary_inputs(binary: &[u8], platform: &str) -> Result<ExtractedInputs, String> {
    use object::read::macho::{MachOFatFile32, MachOFatFile64};
    match object::FileKind::parse(binary).map_err(|_| "invalid candidate native image")? {
        object::FileKind::MachOFat32 => {
            let fat = MachOFatFile32::parse(binary).map_err(|_| "invalid universal candidate table")?;
            extract_universal_inputs(binary, platform, fat.arches())
        }
        object::FileKind::MachOFat64 => {
            let fat = MachOFatFile64::parse(binary).map_err(|_| "invalid universal candidate table")?;
            extract_universal_inputs(binary, platform, fat.arches())
        }
        _ => extract_thin_binary_inputs(binary, platform),
    }
}

fn extract_universal_inputs<F: object::read::macho::FatArch>(
    binary: &[u8], platform: &str, arches: &[F],
) -> Result<ExtractedInputs, String> {
    use object::macho;
    use object::read::macho::{MachHeader, MachOFile64};
    use std::collections::HashSet;

    // Multiple subtypes of one CPU could let the host select a different
    // executable from the one reviewed. Support only the baseline subtypes.
    if !matches!(platform, "darwin-x86_64" | "darwin-aarch64") || arches.is_empty() || arches.len() > 2 {
        return Err("unsupported universal candidate platform or slice count".into());
    }
    let header_end = 8 + std::mem::size_of_val(arches) as u64;
    let mut ranges = Vec::new();
    let mut cpus = HashSet::new();
    let mut identity = None;
    let mut selected = None;
    for arch in arches {
        let (slice_platform, subtype) = match arch.cputype() {
            macho::CPU_TYPE_X86_64 => ("darwin-x86_64", macho::CPU_SUBTYPE_X86_64_ALL),
            macho::CPU_TYPE_ARM64 => ("darwin-aarch64", macho::CPU_SUBTYPE_ARM64_ALL),
            _ => return Err("unsupported universal candidate architecture".into()),
        };
        let (offset, size) = arch.file_range();
        let end = offset.checked_add(size).ok_or("invalid universal candidate slice range")?;
        let alignment = 1u64.checked_shl(arch.align()).ok_or("invalid universal candidate alignment")?;
        if !cpus.insert(arch.cputype()) || arch.cpusubtype() != subtype || size == 0
            || offset < header_end || end > binary.len() as u64 || offset % alignment != 0
            || ranges.iter().any(|&(start, stop)| offset < stop && start < end)
        {
            return Err("ambiguous or invalid universal candidate slice".into());
        }
        ranges.push((offset, end));
        let bytes = arch.data(binary).map_err(|_| "unreadable universal candidate slice")?;
        let image = MachOFile64::<object::Endianness>::parse(bytes)
            .map_err(|_| "universal candidate slice is not thin Mach-O")?;
        if image.macho_header().cputype(image.endian()) != arch.cputype()
            || image.macho_header().cpusubtype(image.endian()) != subtype
        {
            return Err("universal candidate table differs from native slice".into());
        }
        // Inspect every slice: source, product, version and complete authors
        // must agree across CPUs. Effective policy/config can be target-specific.
        let inputs = extract_thin_binary_inputs(bytes, slice_platform)?;
        let current = (inputs.source_revision.clone(), inputs.product.clone(),
            inputs.version.clone(), inputs.author_ids.clone());
        if identity.as_ref().is_some_and(|expected| expected != &current) {
            return Err("universal candidate slices disagree on reviewed identity".into());
        }
        identity = Some(current);
        if slice_platform == platform { selected = Some(inputs); }
    }
    selected.ok_or_else(|| "universal candidate has no target architecture".into())
}

fn extract_thin_binary_inputs(binary: &[u8], platform: &str) -> Result<ExtractedInputs, String> {
    use object::{Architecture, BinaryFormat, Object, ObjectKind, ObjectSection};

    const MAX_INPUT_BYTES: u64 = 1024 * 1024;
    let image = object::File::parse(binary).map_err(|_| "invalid candidate native image")?;
    let expected = match platform {
        "linux-x86_64" => (BinaryFormat::Elf, Architecture::X86_64),
        "linux-aarch64" => (BinaryFormat::Elf, Architecture::Aarch64),
        "darwin-x86_64" => (BinaryFormat::MachO, Architecture::X86_64),
        "darwin-aarch64" => (BinaryFormat::MachO, Architecture::Aarch64),
        "windows-x86_64" => (BinaryFormat::Pe, Architecture::X86_64),
        _ => return Err("unsupported candidate platform or container".into()),
    };
    if (image.format(), image.architecture()) != expected
        || !image.is_64()
        || !matches!(image.kind(), ObjectKind::Executable | ObjectKind::Dynamic)
    {
        return Err("candidate native image platform differs from update target".into());
    }
    let mut inputs = None;
    for section in image.sections() {
        let name = section.name().map_err(|_| "invalid candidate section name")?;
        // PE image section names have an eight-byte limit.
        if name != ".pcupd" && name != "__pcupd" {
            continue;
        }
        if inputs.is_some() || section.size() == 0 || section.size() > MAX_INPUT_BYTES {
            return Err("missing, ambiguous or oversized candidate build inputs".into());
        }
        let bytes = section.data().map_err(|_| "unreadable candidate build inputs")?;
        if bytes.len() as u64 != section.size() {
            return Err("candidate build inputs are not file-backed bytes".into());
        }
        let value: ExtractedInputs = serde_json::from_slice(bytes)
            .map_err(|_| "invalid candidate build inputs")?;
        if value.schema != "tauri-update-inputs-v2"
            || value.platform != platform
            || !hex(&value.source_revision, 40)
            || ![&value.version, &value.product].iter().all(|s| label(s))
            || !authors(&value.author_ids)
            || ![&value.policy, &value.configuration].iter().all(|text| {
                serde_json::from_str::<serde_json::Value>(text)
                    .map(|v| v.is_object())
                    .unwrap_or(false)
            })
            || serde_json::to_vec(&value).map_err(|_| "unencodable candidate build inputs")? != bytes
        {
            return Err("invalid or noncanonical candidate build inputs".into());
        }
        inputs = Some(value);
    }
    inputs.ok_or_else(|| "candidate native image has no reviewed build inputs".into())
}

/// Only this module constructs an authorized result. It remains a snapshot, not
/// permission to install after the caller releases its protected-state transaction.
pub struct AuthorizedUpdate {
    metadata: Metadata,
}

impl AuthorizedUpdate {
    pub fn metadata(&self) -> &Metadata {
        &self.metadata
    }
}

fn label(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 200
        && !value
            .chars()
            .any(|c| c.is_whitespace() || c == '\u{feff}' || c <= '\u{1f}' || c == '\u{7f}')
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn authors(values: &[String]) -> bool {
    !values.is_empty()
        && values.len() <= 64
        && values.iter().all(|s| label(s))
        // Match JavaScript's string ordering, including supplementary Unicode.
        && values.windows(2).all(|pair| {
            pair[0].encode_utf16().cmp(pair[1].encode_utf16()).is_lt()
        })
}

fn decode(value: &str) -> Result<Vec<u8>, String> {
    let compact: String = value
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '\u{feff}')
        .collect();
    let bytes = STANDARD.decode(&compact).map_err(|_| "invalid base64")?;
    if compact.is_empty() || STANDARD.encode(&bytes) != compact {
        return Err("noncanonical base64".into());
    }
    Ok(bytes)
}

fn key(value: &str) -> Result<(PublicKey, Vec<u8>), String> {
    let wrapped = decode(value).ok().and_then(|b| String::from_utf8(b).ok());
    let text = wrapped
        .as_deref()
        .filter(|s| s.to_ascii_lowercase().contains("minisign public key"))
        .unwrap_or(value);
    let line = text
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .last()
        .ok_or("missing public key")?;
    let bytes = decode(line)?;
    let public_key =
        PublicKey::from_base64(&STANDARD.encode(&bytes)).map_err(|_| "invalid public key")?;
    Ok((public_key, bytes))
}

fn signature(value: &str) -> Result<Signature, String> {
    if value.is_empty() || value.len() > 4096 {
        return Err("invalid authorization signature size".into());
    }
    let text = String::from_utf8(decode(value)?).map_err(|_| "invalid signature text")?;
    if text.trim_end().lines().count() != 4 {
        return Err("complete minisign authorization signature required".into());
    }
    Signature::decode(text.trim_end())
        .map_err(|_| "invalid minisign authorization signature".into())
}

fn select<'a>(keys: &'a [TrustedKey], id: &str, epoch: u64) -> Result<&'a TrustedKey, String> {
    let mut matches = keys.iter().filter(|k| k.id == id && k.epoch == epoch);
    let selected = matches.next().ok_or("unknown signer or approver epoch")?;
    if matches.next().is_some() || selected.revoked || !label(&selected.principal_id) {
        return Err("revoked, ambiguous or invalid signer/approver".into());
    }
    Ok(selected)
}

pub fn verify(
    trust: &Trust,
    envelope: &Envelope,
    candidate: &Candidate<'_>,
    now: u64,
) -> Result<AuthorizedUpdate, String> {
    if envelope.payload.len() > 16_384 {
        return Err("update authorization payload is too large".into());
    }
    let m: Metadata = serde_json::from_str(&envelope.payload)
        .map_err(|_| "invalid update authorization metadata")?;
    if m.schema != "tauri-update-authorization-v2"
        || ![
            &m.artifact_sha256,
            &m.policy_sha256,
            &m.configuration_sha256,
        ]
        .iter()
        .all(|s| hex(s, 64))
        || !hex(&m.source_revision, 40)
        || ![
            &m.version,
            &m.product,
            &m.platform,
            &m.approver_id,
            &m.signer_id,
        ]
        .iter()
        .all(|s| label(s))
        || !authors(&m.author_ids)
        || [
            m.approver_epoch,
            m.signer_epoch,
            m.root_epoch,
            m.rollback_counter,
            m.issued_at,
            m.expires_at,
        ]
        .iter()
        .any(|n| *n > MAX_SAFE_INTEGER)
        || m.expires_at <= m.issued_at
        || serde_json::to_string(&m).map_err(|_| "unencodable update metadata")? != envelope.payload
    {
        return Err("invalid or noncanonical update authorization metadata".into());
    }
    for (field, actual, expected) in [
        (
            "artifactSha256",
            format!("{:x}", Sha256::digest(candidate.artifact)),
            m.artifact_sha256.as_str(),
        ),
        (
            "policySha256",
            format!("{:x}", Sha256::digest(candidate.policy)),
            m.policy_sha256.as_str(),
        ),
        (
            "configurationSha256",
            format!("{:x}", Sha256::digest(candidate.configuration)),
            m.configuration_sha256.as_str(),
        ),
    ] {
        if actual != expected {
            return Err(format!("candidate {field} differs from reviewed update"));
        }
    }
    for (field, actual, expected) in [
        (
            "sourceRevision",
            candidate.source_revision,
            m.source_revision.as_str(),
        ),
        ("version", candidate.version, m.version.as_str()),
        ("product", candidate.product, m.product.as_str()),
        ("platform", candidate.platform, m.platform.as_str()),
    ] {
        if actual != expected {
            return Err(format!("candidate {field} differs from reviewed update"));
        }
    }
    if !authors(candidate.author_ids) || candidate.author_ids != m.author_ids {
        return Err("candidate authorIds differs from reviewed update".into());
    }
    if [
        now,
        trust.root_epoch,
        trust.min_rollback_counter,
        trust.min_issued_at,
        trust.max_metadata_age_ms,
    ]
    .iter()
    .any(|n| *n > MAX_SAFE_INTEGER)
        || trust.max_metadata_age_ms == 0
        || trust.signers.len() > 64
        || trust.approvers.len() > 64
    {
        return Err("invalid protected update trust state".into());
    }
    if m.root_epoch != trust.root_epoch {
        return Err("update trust root epoch is not current".into());
    }
    if m.rollback_counter < trust.min_rollback_counter {
        return Err("update rollback counter is below the installed floor".into());
    }
    if m.issued_at < trust.min_issued_at
        || m.issued_at > now
        || m.expires_at <= now
        || now - m.issued_at > trust.max_metadata_age_ms
    {
        return Err("update metadata is stale, expired or from the future".into());
    }
    let signer = select(&trust.signers, &m.signer_id, m.signer_epoch)?;
    let approver = select(&trust.approvers, &m.approver_id, m.approver_epoch)?;
    let (signer_key, signer_bytes) = key(&signer.public_key)?;
    let (approver_key, approver_bytes) = key(&approver.public_key)?;
    if m.author_ids.contains(&approver.principal_id)
        || approver.principal_id == signer.principal_id
        || signer_bytes[10..] == approver_bytes[10..]
    {
        return Err("update approval is not independent of its author and release signer".into());
    }
    signer_key
        .verify(
            envelope.payload.as_bytes(),
            &signature(&envelope.signature)?,
            true,
        )
        .map_err(|_| "invalid update release signature")?;
    approver_key
        .verify(
            envelope.payload.as_bytes(),
            &signature(&envelope.approval_signature)?,
            true,
        )
        .map_err(|_| "invalid update approval signature")?;
    Ok(AuthorizedUpdate { metadata: m })
}
