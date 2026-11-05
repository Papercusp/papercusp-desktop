//! Root-side Mac installation transaction. Transport/bootstrap is separate: only
//! received bytes enter this module, never a caller-selected source/destination
//! path or executable. Uses APIs available on macOS 10.15.

use super::{DownloadedUpdate, prepare_macos_update, protected_policy, mac_path, scan_macos_archive};
use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::MetadataExt;
use std::sync::atomic::{AtomicU64, Ordering};

const INVALID: &str = "protected Mac installation is unavailable";
const MAX_HEADER: usize = 65_536;
const MAX_ARTIFACT: u64 = 1024 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Header {
    manifest: serde_json::Value,
    version: String,
    product: String,
    platform: String,
}

/// Owning this request prevents a user-writable file from being changed between
/// verification and extraction. The privileged receiver never reopens a path.
pub struct Request {
    header: Header,
    artifact: Vec<u8>,
}

impl Request {
    pub fn capture(download: &DownloadedUpdate<'_>) -> Result<Self, String> {
        let header = Header { manifest: download.manifest.clone(), version: download.version.into(),
            product: download.product.into(), platform: download.platform.into() };
        if download.artifact.len() as u64 > MAX_ARTIFACT
            || serde_json::to_vec(&header).map_err(|e| e.to_string())?.len() > MAX_HEADER {
            return Err("oversized Mac installer request".into());
        }
        destination(&header.product)?;
        Ok(Self { header, artifact: download.artifact.to_vec() })
    }

    /// One request per transport: fixed-width lengths, bounded header, then the
    /// exact artifact. The caller closes its write half before awaiting READY.
    pub fn receive(mut input: impl Read) -> Result<Self, String> {
        let mut lengths = [0u8; 12];
        input.read_exact(&mut lengths).map_err(|_| "truncated Mac installer request")?;
        let header_len = u32::from_be_bytes(lengths[..4].try_into().unwrap()) as usize;
        let artifact_len = u64::from_be_bytes(lengths[4..].try_into().unwrap());
        if header_len == 0 || header_len > MAX_HEADER || artifact_len == 0 || artifact_len > MAX_ARTIFACT {
            return Err("oversized or empty Mac installer request".into());
        }
        let mut bytes = vec![0; header_len];
        input.read_exact(&mut bytes).map_err(|_| "truncated Mac installer header")?;
        let header: Header = serde_json::from_slice(&bytes).map_err(|_| "invalid Mac installer header")?;
        destination(&header.product)?;
        let mut artifact = Vec::new();
        (&mut input).take(artifact_len).read_to_end(&mut artifact).map_err(|_| "unreadable Mac installer artifact")?;
        if artifact.len() as u64 != artifact_len || input.read(&mut [0u8; 1]).map_err(|_| INVALID)? != 0 {
            return Err("truncated or trailing Mac installer artifact".into());
        }
        Ok(Self { header, artifact })
    }

    pub fn send(&self, mut output: impl Write) -> Result<(), String> {
        let header = serde_json::to_vec(&self.header).map_err(|e| e.to_string())?;
        output.write_all(&(header.len() as u32).to_be_bytes())
            .and_then(|_| output.write_all(&(self.artifact.len() as u64).to_be_bytes()))
            .and_then(|_| output.write_all(&header))
            .and_then(|_| output.write_all(&self.artifact)).map_err(|e| e.to_string())
    }

    fn download(&self) -> DownloadedUpdate<'_> {
        DownloadedUpdate { artifact: &self.artifact, manifest: &self.header.manifest,
            version: &self.header.version, product: &self.header.product, platform: &self.header.platform }
    }
}

fn destination(product: &str) -> Result<&'static str, String> {
    match product {
        "com.papercusp.gui" => Ok("Papercusp GUI.app"),
        "com.papercusp.server" => Ok("Papercusp Server.app"),
        "com.papercusp.gui.nightly" => Ok("Papercusp GUI Nightly.app"),
        _ => Err("unsupported protected Mac product".into()),
    }
}

fn directory(parent: &File, name: &CStr, owner: u32) -> Result<File, String> {
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(),
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
    if fd < 0 { return Err(INVALID.into()); }
    let file = unsafe { File::from_raw_fd(fd) };
    trusted_directory(&file, owner)?;
    Ok(file)
}

fn trusted_directory(file: &File, owner: u32) -> Result<(), String> {
    let stat = file.metadata().map_err(|_| INVALID)?;
    if !stat.is_dir() || stat.uid() != owner || stat.mode() & 0o022 != 0 {
        return Err(INVALID.into());
    }
    Ok(())
}

/// The administrator-provisioned applications directory must itself be protected;
/// a writable ancestor would permit replacing an installed enforcement binary.
#[cfg(target_os = "macos")]
pub fn install_current(request: Request, ready: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    if unsafe { libc::geteuid() } != 0 { return Err("Mac installer requires administrator authority".into()); }
    let root = File::open("/").map_err(|_| INVALID)?;
    trusted_directory(&root, 0)?;
    let applications = directory(&root, &CString::new("Applications").unwrap(), 0)?;
    let policy = protected_policy::current_directory()?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "update authorization clock is unavailable")?.as_millis()
        .try_into().map_err(|_| "update authorization clock is out of range")?;
    install_in(&policy, &applications, 0, request, now, ready)
}

fn install_in(
    policy: &File, applications: &File, owner: u32, request: Request, now: u64,
    ready: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    trusted_directory(applications, owner)?;
    let target = CString::new(destination(&request.header.product)?).unwrap();
    // Auto-update replaces an existing protected product, never arbitrary files
    // or an alias selected by the archive's outer .app name.
    let installed = directory(applications, &target, owner)?;
    let download = request.download();
    let (envelope, inputs) = prepare_macos_update(&download)?;
    protected_policy::activate_in(policy, owner, &envelope, &inputs.candidate(download.artifact), now, || {
        let stage = Stage::new(applications, owner)?;
        stage.extract(download.artifact, owner)?;
        // Floors are durable, all unpacking has succeeded, and CURRENT trust is
        // still locked. Only now may the GUI quiesce its sidecar and send COMMIT.
        ready()?;
        let current = directory(applications, &target, owner)?.metadata().map_err(|_| INVALID)?;
        let prior = installed.metadata().map_err(|_| INVALID)?;
        if (current.dev(), current.ino()) != (prior.dev(), prior.ino()) {
            return Err("installed Mac product changed before activation".into());
        }
        exchange(&stage.file, &CString::new("candidate.app").unwrap(), applications, &target)?;
        applications.sync_all().map_err(|_| "cannot sync installed Mac product")?;
        stage.file.sync_all().map_err(|_| "cannot sync previous Mac product")?;
        Ok(())
    })
}

// The override is confined to the maintained native fixture, never the helper.
#[cfg(test)]
pub fn install_test(
    policy: &File, applications: &File, request: Request, now: u64,
    ready: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    install_in(policy, applications, policy.metadata().map_err(|_| INVALID)?.uid(), request, now, ready)
}

struct Stage<'a> { parent: &'a File, name: CString, file: File }

impl<'a> Stage<'a> {
    fn new(parent: &'a File, owner: u32) -> Result<Self, String> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let name = CString::new(format!(".papercusp-update-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))).unwrap();
        if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 { return Err(INVALID.into()); }
        let file = directory(parent, &name, owner)?;
        let stage = Self { parent, name, file };
        stage.ensure_directory(&["candidate.app"], owner)?;
        Ok(stage)
    }

    fn ensure_directory(&self, parts: &[&str], owner: u32) -> Result<File, String> {
        let mut parent = self.file.try_clone().map_err(|_| INVALID)?;
        for part in parts {
            let name = CString::new(*part).map_err(|_| INVALID)?;
            if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o755) } != 0
                && std::io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) { return Err(INVALID.into()); }
            parent.sync_all().map_err(|_| INVALID)?;
            parent = directory(&parent, &name, owner)?;
        }
        Ok(parent)
    }

    fn extract(&self, artifact: &[u8], owner: u32) -> Result<(), String> {
        scan_macos_archive(artifact, false, |path, header, link, reader| {
            let kind = header.entry_type();
            let parts = mac_path(path, kind.is_dir())?;
            let mut installed = vec!["candidate.app"];
            installed.extend_from_slice(&parts[1..]);
            let mode = header.mode().map_err(|_| INVALID)?;
            if !kind.is_symlink() && (mode & 0o022 != 0 || mode & 0o400 == 0) {
                return Err("Mac candidate contains unprotected files".into());
            }
            if kind.is_dir() {
                let file = self.ensure_directory(&installed, owner)?;
                file.sync_all().map_err(|_| INVALID)?;
            } else {
                let parent = self.ensure_directory(&installed[..installed.len()-1], owner)?;
                let name = CString::new(*installed.last().unwrap()).map_err(|_| INVALID)?;
                if kind.is_symlink() {
                    let link = CString::new(link.ok_or(INVALID)?).map_err(|_| INVALID)?;
                    if unsafe { libc::symlinkat(link.as_ptr(), parent.as_raw_fd(), name.as_ptr()) } != 0 { return Err(INVALID.into()); }
                } else {
                    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(),
                        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0o600) };
                    if fd < 0 { return Err(INVALID.into()); }
                    let mut file = unsafe { File::from_raw_fd(fd) };
                    std::io::copy(reader, &mut file).map_err(|_| INVALID)?;
                    if unsafe { libc::fchmod(file.as_raw_fd(), mode & 0o777) } != 0 { return Err(INVALID.into()); }
                    file.sync_all().map_err(|_| INVALID)?;
                }
                parent.sync_all().map_err(|_| INVALID)?;
            }
            Ok(())
        })?;
        self.file.sync_all().map_err(|_| INVALID.into())
    }
}

fn exchange(a: &File, from: &CStr, b: &File, to: &CStr) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = unsafe { libc::renameatx_np(a.as_raw_fd(), from.as_ptr(), b.as_raw_fd(), to.as_ptr(), libc::RENAME_SWAP) };
    #[cfg(target_os = "linux")]
    let status = unsafe { libc::renameat2(a.as_raw_fd(), from.as_ptr(), b.as_raw_fd(), to.as_ptr(), libc::RENAME_EXCHANGE) };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let status = -1;
    if status != 0 { return Err("cannot atomically exchange protected Mac product".into()); }
    Ok(())
}

// Only the fresh private stage is removed. Never walk an installed product via
// a caller pathname; symlinks are unlinked, not followed, even during cleanup.
fn remove_stage(parent: &File, name: &CStr) {
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(),
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
    if fd < 0 { return; }
    let file = unsafe { File::from_raw_fd(fd) };
    let stream = unsafe { libc::fdopendir(libc::dup(file.as_raw_fd())) };
    if stream.is_null() { return; }
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() { break; }
        let child = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
        if child.to_bytes() == b"." || child.to_bytes() == b".." { continue; }
        remove_stage(&file, child);
        unsafe { libc::unlinkat(file.as_raw_fd(), child.as_ptr(), 0); }
    }
    unsafe { libc::closedir(stream); libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR); }
}

impl Drop for Stage<'_> {
    fn drop(&mut self) { remove_stage(self.parent, &self.name); }
}
