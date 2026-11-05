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

    /// Standalone frame reader: fixed-width lengths, bounded header and exact
    /// artifact followed by EOF. Duplex sessions use the explicit REQUEST_END.
    pub fn receive(mut input: impl Read) -> Result<Self, String> {
        let request = Self::receive_frame(&mut input)?;
        if input.read(&mut [0u8; 1]).map_err(|_| INVALID)? != 0 {
            return Err("trailing Mac installer artifact".into());
        }
        Ok(request)
    }

    fn receive_frame(mut input: impl Read) -> Result<Self, String> {
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
        if artifact.len() as u64 != artifact_len {
            return Err("truncated Mac installer artifact".into());
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

const REQUEST_END: &[u8; 8] = b"PCREQ01\n";
const READY: &[u8; 8] = b"PCRDY01\n";
const COMMIT: &[u8; 8] = b"PCCMT01\n";
const ABORT: &[u8; 8] = b"PCABT01\n";
const DONE: &[u8; 8] = b"PCDON01\n";
const FAILED: &[u8; 8] = b"PCERR01\n";

fn control(input: &mut impl Read, expected: &[u8; 8]) -> Result<(), String> {
    let mut bytes = [0; 8];
    input.read_exact(&mut bytes).map_err(|_| "Mac installer connection closed or timed out")?;
    if &bytes != expected { return Err("Mac installer refused or returned an invalid handshake".into()); }
    Ok(())
}

fn send_control(output: &mut impl Write, frame: &[u8; 8]) -> Result<(), String> {
    output.write_all(frame).and_then(|_| output.flush()).map_err(|_| "Mac installer connection closed or timed out".into())
}

/// The only callback runs WITHOUT administrator authority in the GUI, after the
/// helper has unpacked and authorized CURRENT trust under its activation lock.
/// No caller-supplied command, executable path or destination crosses the pipe.
pub fn transact(
    transport: &mut (impl Read + Write), request: Request,
    quiesce: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    request.send(&mut *transport)?;
    send_control(transport, REQUEST_END)?;
    control(transport, READY)?;
    if let Err(error) = quiesce() {
        let _ = send_control(transport, ABORT);
        return Err(error);
    }
    send_control(transport, COMMIT)?;
    control(transport, DONE)
}

/// One transaction per elevated process. The root-side transaction owns the
/// bytes and the lock through READY, COMMIT and the atomic product exchange.
pub fn serve(
    transport: &mut (impl Read + Write),
    install: impl FnOnce(Request, &mut dyn FnMut() -> Result<(), String>) -> Result<(), String>,
) -> Result<(), String> {
    let result = (|| {
        let request = Request::receive_frame(&mut *transport)?;
        control(transport, REQUEST_END)?;
        install(request, &mut || {
            send_control(transport, READY)?;
            control(transport, COMMIT)
        })
    })();
    let sent = send_control(transport, if result.is_ok() { DONE } else { FAILED });
    result.and(sent)
}

/// Fixed root-owned executable, provisioned by the administrator's signed
/// installer. Never elevate current_exe(), an app resource or a temporary file.
#[cfg(target_os = "macos")]
const HELPER: &str = "/Library/PrivilegedHelperTools/com.papercusp.update-installer";

#[cfg(any(target_os = "macos", test))]
fn helper_at(root: &File, owner: u32) -> Result<File, String> {
    trusted_directory(root, owner)?;
    let library = directory(root, &CString::new("Library").unwrap(), owner)?;
    let helpers = directory(&library, &CString::new("PrivilegedHelperTools").unwrap(), owner)?;
    let name = CString::new("com.papercusp.update-installer").unwrap();
    let fd = unsafe { libc::openat(helpers.as_raw_fd(), name.as_ptr(),
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC) };
    if fd < 0 { return Err("administrator Mac update helper is not installed".into()); }
    let file = unsafe { File::from_raw_fd(fd) };
    let stat = file.metadata().map_err(|_| INVALID)?;
    if !stat.is_file() || stat.uid() != owner || stat.nlink() != 1
        || stat.mode() & 0o022 != 0 || stat.mode() & 0o111 != 0o111 {
        return Err("administrator Mac update helper is not protected".into());
    }
    Ok(file)
}

/// Authorization Services is available on the supported macOS 10.15 floor.
/// Elevation is limited to the already protected helper; a missing helper is a
/// refusal, with the sidecar still running. Installation is a packaging duty.
#[cfg(target_os = "macos")]
pub fn install_privileged(
    download: &DownloadedUpdate<'_>, quiesce: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    use security_framework::authorization::{Authorization, AuthorizationItemSetBuilder, Flags};
    let request = Request::capture(download)?;
    let root = File::open("/").map_err(|_| INVALID)?;
    let _helper = helper_at(&root, 0)?;
    let rights = AuthorizationItemSetBuilder::new().add_right("system.privilege.admin")
        .map_err(|e| e.to_string())?.build();
    let authorization = Authorization::new(Some(rights), None,
        Flags::INTERACTION_ALLOWED | Flags::EXTEND_RIGHTS | Flags::PREAUTHORIZE)
        .map_err(|e| format!("Mac update administrator authorization failed: {e}"))?;
    let pipe = authorization.execute_with_privileges_piped(HELPER, std::iter::empty::<&str>(), Flags::DEFAULTS)
        .map_err(|e| format!("Mac update helper could not start: {e}"))?;
    let mut transport = TimedPipe::new(pipe.try_clone().map_err(|_| INVALID)?, pipe, std::time::Duration::from_secs(300))?;
    transact(&mut transport, request, quiesce)
}

/// Poll plus NONBLOCK bounds both directions, including a helper or GUI that
/// disappears halfway through a frame. No read may retain the root lock forever.
#[cfg(any(target_os = "macos", test))]
pub struct TimedPipe { input: File, output: File, deadline: std::time::Instant }

#[cfg(any(target_os = "macos", test))]
impl TimedPipe {
    pub fn new(input: File, output: File, budget: std::time::Duration) -> Result<Self, String> {
        for file in [&input, &output] {
            let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
                return Err("Mac update pipe cannot be bounded".into());
            }
        }
        Ok(Self { input, output, deadline: std::time::Instant::now() + budget })
    }

    fn wait(&self, file: &File, events: libc::c_short) -> std::io::Result<()> {
        loop {
            let left = self.deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() { return Err(std::io::ErrorKind::TimedOut.into()); }
            let mut fd = libc::pollfd { fd: file.as_raw_fd(), events, revents: 0 };
            let status = unsafe { libc::poll(&mut fd, 1, left.as_millis().max(1).min(i32::MAX as u128) as i32) };
            if status > 0 { return Ok(()); }
            if status == 0 { return Err(std::io::ErrorKind::TimedOut.into()); }
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::Interrupted { return Err(error); }
        }
    }
}

#[cfg(any(target_os = "macos", test))]
impl Read for TimedPipe {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        if bytes.is_empty() { return Ok(0); }
        loop {
            self.wait(&self.input, libc::POLLIN)?;
            match self.input.read(bytes) {
                Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted) => continue,
                result => return result,
            }
        }
    }
}

#[cfg(any(target_os = "macos", test))]
impl Write for TimedPipe {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.is_empty() { return Ok(0); }
        loop {
            self.wait(&self.output, libc::POLLOUT)?;
            match self.output.write(bytes) {
                Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted) => continue,
                result => return result,
            }
        }
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
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
                    if unsafe { libc::fchmod(file.as_raw_fd(), (mode & 0o777) as libc::mode_t) } != 0 { return Err(INVALID.into()); }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, Permissions};
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::os::unix::net::UnixStream;
    use std::os::fd::IntoRawFd;
    use std::time::Duration;

    #[test]
    fn candidate_fixed_helper_and_stalled_pipe_refuse() {
        let path = std::env::temp_dir().join(format!("pc-fixed-helper-{}",std::process::id()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, Permissions::from_mode(0o700)).unwrap();
        let root = File::open(&path).unwrap();
        let owner = root.metadata().unwrap().uid();
        let library = path.join("Library");
        let helpers = library.join("PrivilegedHelperTools");
        let helper = helpers.join("com.papercusp.update-installer");
        fs::create_dir(&library).unwrap();fs::create_dir(&helpers).unwrap();
        for directory in [&library,&helpers] {fs::set_permissions(directory,Permissions::from_mode(0o755)).unwrap();}
        assert!(helper_at(&root,owner).is_err());
        fs::write(&helper,b"protected helper fixture").unwrap();
        fs::set_permissions(&helper,Permissions::from_mode(0o755)).unwrap();
        assert!(helper_at(&root,owner).is_ok());
        for file in [&helper,&helpers,&library,&path] {
            let original=fs::metadata(file).unwrap().permissions();
            fs::set_permissions(file,Permissions::from_mode(0o775)).unwrap();
            assert!(helper_at(&root,owner).is_err(),"writable helper or ancestor");
            fs::set_permissions(file,original).unwrap();
        }
        fs::set_permissions(&helper,Permissions::from_mode(0o644)).unwrap();
        assert!(helper_at(&root,owner).is_err());
        fs::set_permissions(&helper,Permissions::from_mode(0o755)).unwrap();
        let alias=path.join("alias");fs::hard_link(&helper,&alias).unwrap();
        assert!(helper_at(&root,owner).is_err());fs::remove_file(&alias).unwrap();
        fs::rename(&helper,&alias).unwrap();symlink(&alias,&helper).unwrap();
        assert!(helper_at(&root,owner).is_err());
        fs::remove_file(&helper).unwrap();fs::rename(&alias,&helper).unwrap();
        fs::rename(&helpers,&alias).unwrap();symlink(&alias,&helpers).unwrap();
        assert!(helper_at(&root,owner).is_err());
        fs::remove_file(&helpers).unwrap();fs::rename(&alias,&helpers).unwrap();
        assert!(helper_at(&root,owner).is_ok());
        fs::remove_dir_all(&path).unwrap();

        let (stream,_stalled_peer)=UnixStream::pair().unwrap();
        let file=unsafe {File::from_raw_fd(stream.into_raw_fd())};
        let mut pipe=TimedPipe::new(file.try_clone().unwrap(),file,Duration::from_millis(50)).unwrap();
        assert_eq!(pipe.read(&mut [0;8]).unwrap_err().kind(),std::io::ErrorKind::TimedOut);
        let (stream,_stalled_peer)=UnixStream::pair().unwrap();
        let file=unsafe {File::from_raw_fd(stream.into_raw_fd())};
        let mut pipe=TimedPipe::new(file.try_clone().unwrap(),file,Duration::from_millis(50)).unwrap();
        assert_eq!(pipe.write_all(&vec![0;1024*1024]).unwrap_err().kind(),std::io::ErrorKind::TimedOut);
        println!("native-mac-helper: fixed protected executable and bounded stalled pipe");
    }
}
