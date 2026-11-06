//! GNOME owns resident/login lifecycle after the desktop installs its bundle.
//! No Server startup preference, real shortcut or global user file is reset.
#[cfg(target_os = "linux")]
pub fn prepare(resource_root: std::path::PathBuf, user_data: std::path::PathBuf) {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    if !desktop
        .split(':')
        .any(|part| part.eq_ignore_ascii_case("gnome"))
    {
        return;
    }
    std::thread::spawn(move || {
        use fs2::FileExt;
        let install = || -> std::io::Result<()> {
            let state = user_data.join("papercusp");
            std::fs::create_dir_all(&state)?;
            let lock = std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(state.join("workbench-gnome.lock"))?;
            // GUI and Server may start together. The winner performs the full
            // install; the other never races extraction or registration.
            if let Err(error) = lock.try_lock_exclusive() {
                if error.kind() == std::io::ErrorKind::WouldBlock {
                    return Ok(());
                }
                return Err(error);
            }
            let bundled_pui = resource_root.join("sidecar/bin/pui");
            let pui = if bundled_pui.is_file() {
                bundled_pui
            } else {
                std::path::PathBuf::from("/usr/lib/Papercusp Server/sidecar/bin/pui")
            };
            let output = crate::wsl_sidecar_staging::run_bounded_output(
                std::process::Command::new("gjs")
                    .arg("-m")
                    .arg(resource_root.join("resources/workbench-install.js"))
                    .arg("--install")
                    .arg(resource_root.join("resources/workbench@papercusp.ai.shell-extension.zip"))
                    .arg(pui),
                std::time::Duration::from_secs(30),
            )?;
            if !output.status.success() {
                return Err(std::io::Error::other(
                    String::from_utf8_lossy(&output.stderr).into_owned(),
                ));
            }
            eprintln!(
                "[workbench] {}",
                String::from_utf8_lossy(&output.stdout).trim()
            );
            Ok(())
        };
        if let Err(error) = install() {
            eprintln!("[workbench] Native installation unavailable: {error}");
        }
    });
}
