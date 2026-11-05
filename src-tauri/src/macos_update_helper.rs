//! Administrator-installed, fixed-purpose updater. No Tauri/webview or caller
//! executable is run under elevation. The signed installer provisions this at
//! /Library/PrivilegedHelperTools/com.papercusp.update-installer as root:wheel 0755.

#[cfg(target_os = "macos")]
mod update_authorization;

#[cfg(target_os = "macos")]
fn main() {
    use std::{fs::File, os::fd::FromRawFd, time::Duration};
    use update_authorization::macos_update_installer::{install_current, provision_current, serve, TimedPipe};
    let result = (|| -> Result<(), String> {
        if unsafe { libc::geteuid() } != 0 {
            return Err("Mac update helper requires administrator authority".into());
        }
        let args: Vec<_> = std::env::args_os().skip(1).collect();
        if args.as_slice() == ["--provision"] { return provision_current(); }
        if !args.is_empty() {
            return Err("Mac update helper requires administrator authority and accepts no arguments".into());
        }
        let input = unsafe { libc::dup(0) };
        if input < 0 { return Err("Mac update helper has no input pipe".into()); }
        let input = unsafe { File::from_raw_fd(input) };
        let output = unsafe { libc::dup(1) };
        if output < 0 { return Err("Mac update helper has no output pipe".into()); }
        let output = unsafe { File::from_raw_fd(output) };
        let mut pipe = TimedPipe::new(input, output, Duration::from_secs(300))?;
        serve(&mut pipe, |request, ready| install_current(request, ready))
    })();
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("the protected Mac update helper is available only on macOS");
    std::process::exit(1);
}
