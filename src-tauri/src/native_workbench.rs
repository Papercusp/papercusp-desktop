//! GNOME owns resident/login lifecycle after the desktop installs its bundle.
//! No Server startup preference, real shortcut or global user file is reset.
#[cfg(target_os = "windows")]
pub fn prepare(
    _app: tauri::AppHandle,
    resource_root: std::path::PathBuf,
    _user_data: std::path::PathBuf,
) {
    std::thread::spawn(move || {
        use std::os::windows::process::CommandExt;
        let local_data = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);
        let pui = [Some(resource_root.join("sidecar/bin/pui.exe")),
            local_data.map(|root| root.join("Papercusp Server/sidecar/bin/pui.exe"))]
            .into_iter().flatten()
            .find(|path| path.is_file());
        let Some(pui) = pui else {
            eprintln!("[workbench] Install Papercusp Server's native Windows PUI to enable desktop panels.");
            return;
        };
        let powershell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let output = crate::wsl_sidecar_staging::run_bounded_output(
            std::process::Command::new(powershell)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW; WPF belongs to the signed-in session.
                .args(["-STA", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(resource_root.join("resources/workbench-windows/workbench.ps1"))
                .args(["-Action", "Install", "-Pui"]).arg(pui),
            std::time::Duration::from_secs(15),
        );
        match output {
            Ok(output) if output.status.success() => {},
            Ok(output) => eprintln!("[workbench] Native installation unavailable: {}", String::from_utf8_lossy(&output.stderr)),
            Err(error) => eprintln!("[workbench] Native installation unavailable: {error}"),
        }
    });
}

#[cfg(target_os = "linux")]
fn login_notice(output: &[u8]) -> Result<Option<&'static str>, serde_json::Error> {
    #[derive(serde::Deserialize)]
    struct Outcome {
        changed: bool,
        #[serde(default, rename = "firstInstall")]
        first_install: bool,
        #[serde(default, rename = "loginRequired")]
        login_required: bool,
    }
    let outcome: Outcome = serde_json::from_slice(output)?;
    Ok(if outcome.changed && outcome.login_required {
        Some(if outcome.first_install {
            "Sign out and back in to enable Workbench's native desktop panels."
        } else {
            "Sign out and back in to finish updating Workbench's native desktop panels."
        })
    } else {
        None
    })
}

#[cfg(target_os = "linux")]
pub fn prepare(
    app: tauri::AppHandle,
    resource_root: std::path::PathBuf,
    user_data: std::path::PathBuf,
) {
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
            let notice = login_notice(&output.stdout).map_err(std::io::Error::other)?;
            if let Some(body) = notice {
                use tauri_plugin_notification::NotificationExt;
                if let Err(error) = app
                    .notification()
                    .builder()
                    .title("Papercusp Workbench")
                    .body(body)
                    .show()
                {
                    eprintln!("[workbench] Login notification unavailable: {error}");
                }
            }
            Ok(())
        };
        if let Err(error) = install() {
            eprintln!("[workbench] Native installation unavailable: {error}");
        }
    });
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::login_notice;

    #[test]
    fn restart_requirement_reaches_the_account_with_install_or_upgrade_context() {
        let install = login_notice(br#"{"changed":true,"firstInstall":true,"loginRequired":true}"#)
            .unwrap()
            .unwrap();
        assert!(install.contains("enable Workbench"));
        let upgrade = login_notice(br#"{"changed":true,"loginRequired":true}"#)
            .unwrap()
            .unwrap();
        assert!(upgrade.contains("finish updating"));
    }

    #[test]
    fn unchanged_or_live_install_does_not_request_an_unnecessary_login() {
        for output in [
            br#"{"changed":false}"#.as_slice(),
            br#"{"changed":true,"loginRequired":false}"#.as_slice(),
        ] {
            assert_eq!(login_notice(output).unwrap(), None);
        }
        assert!(login_notice(b"not an installer result").is_err());
        assert!(login_notice(br#"{"loginRequired":true}"#).is_err());
    }
}
