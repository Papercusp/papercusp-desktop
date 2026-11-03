//! Native consumer of tauri-release-kit's exact dual-signed update protocol.
//!
//! The caller supplies CURRENT protected trust and independently extracted candidate
//! bytes/identity. This module neither trusts manifest-supplied keys nor persists
//! activation floors. Keep that state transaction outside this pure verifier.

use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedKey {
    pub id: String,
    pub epoch: u64,
    pub principal_id: String,
    pub public_key: String,
    pub revoked: bool,
}

#[derive(Deserialize)]
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
#[cfg(target_os = "linux")]
pub fn read_current_trust() -> Result<Trust, String> {
    protected_policy::read_current()
}

#[cfg(unix)]
mod protected_policy {
    use super::*;
    use std::fs::{File, Metadata as FileMetadata};
    use std::io::Read;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::MetadataExt;

    const MAX_BYTES: u64 = 16_384;
    const INVALID: &str = "protected administrator update trust is absent, invalid or unreadable";

    #[derive(Deserialize)]
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

    #[cfg(target_os = "linux")]
    pub(super) fn read_current() -> Result<Trust, String> {
        let mut directory = File::open("/").map_err(|_| INVALID)?;
        for name in ["etc", "papercusp"] {
            if !trusted(&directory.metadata().map_err(|_| INVALID)?, 0, true) {
                return Err(INVALID.into());
            }
            directory = child(&directory, name, true)?;
        }
        read_in(&directory, 0)
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
        let trust = policy.update_authorization;
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
        Ok(trust)
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

/// Read one bounded provenance section from a thin ELF/Mach-O/PE executable.
/// Archive and universal-image callers must first select the actual native image
/// with a format-aware adapter. Unsupported containers fail closed here.
pub fn extract_binary_inputs(binary: &[u8], platform: &str) -> Result<ExtractedInputs, String> {
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
