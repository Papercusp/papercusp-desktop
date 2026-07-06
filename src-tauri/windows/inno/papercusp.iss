; Papercusp Windows installer — Inno Setup template (WI-3172).
;
; WHY INNO, NOT NSIS/MSI/7z-SFX: the owner-mandated FULL offline seed
; (git super.bundle + hive corestore) puts the Windows payload at ~3.4 GB —
; and makensis dies packaging it with "Internal compiler error #12345:
; error mmapping file ... out of range" at a ~2 GiB offset (signed-32-bit
; datablock limit; both roles failed at ~1.97 GiB on 2026-07-06). The
; corestore ALONE exceeds 2 GiB, so no sidecar slimming can rescue NSIS.
; MSI/WiX caps lower (~2 GB CAB). A 7z-SFX combined .exe hits the Windows
; ~2 GB PE-loader limit. Inno Setup 6.5.2+ removed its 2 GB limit: a single
; setup.exe is supported to ~4 GB, and DiskSpanning covers anything beyond.
;
; LAYOUT PARITY with the retired NSIS bundle (verified by 7z-listing a
; placeholder NSIS installer): papercusp-desktop.exe (UNrenamed — hooks.nsh
; and shortcut icons reference it) + sidecar/ + resources/ + seed/ at the
; install root, per-user under %LOCALAPPDATA%\<productName>. The app resolves
; resources relative to the exe dir (BaseDirectory::Resource), e.g.
; custom_protocol.rs "sidecar/spa", wsl_setup.rs "resources/<rootfs>".
;
; INVOCATION (bin/build-windows-on-vm.sh passes all defines):
;   ISCC /DAppId=com.papercusp.server "/DAppName=Papercusp Server" \
;        /DAppVersion=<ver> /DBuildRoot=<...>\src-tauri /O<outdir> papercusp.iss
;
; Auto-updater note: Tauri's Windows updater expected the NSIS artifact; the
; Inno cutover leaves Windows on manual updates until the updater rework
; (tracked on WI-3172) — the host still minisigns the installer (.sig).

#ifndef AppId
  #error Pass /DAppId=com.papercusp.gui|com.papercusp.server
#endif
#ifndef AppName
  #error Pass /DAppName="Papercusp GUI"|"Papercusp Server"
#endif
#ifndef AppVersion
  #error Pass /DAppVersion=<tauri.conf.json version>
#endif
#ifndef BuildRoot
  #error Pass /DBuildRoot=<abs path to src-tauri>
#endif

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Papercusp
AppPublisherURL=https://papercuspai.com
DefaultDirName={localappdata}\{#AppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename={#AppName}_{#AppVersion}_x64-setup
; Per-file compression (SolidCompression=no): the seed (encrypted corestore +
; git bundles) and the WSL rootfs tar.gz are incompressible — stored raw
; (fast compile, ~0 size cost). The sidecar (node, embedded PG, SPA)
; compresses ~3:1 under lzma2.
Compression=lzma2
SolidCompression=no
LZMAUseSeparateProcess=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\papercusp-desktop.exe
UninstallDisplayName={#AppName}
SetupIconFile={#BuildRoot}\icons\icon.ico
WizardStyle=modern

[Files]
Source: "{#BuildRoot}\target\release\papercusp-desktop.exe"; DestDir: "{app}"
Source: "{#BuildRoot}\sidecar\*"; DestDir: "{app}\sidecar"; Flags: recursesubdirs createallsubdirs
Source: "{#BuildRoot}\resources\*"; DestDir: "{app}\resources"; Flags: recursesubdirs createallsubdirs nocompression
Source: "{#BuildRoot}\seed\*"; DestDir: "{app}\seed"; Flags: recursesubdirs createallsubdirs nocompression

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\papercusp-desktop.exe"
; Parity with windows/hooks.nsh NSIS_HOOK_POSTINSTALL (WI-2197): the guided
; tutorial shortcut targets wsl.exe directly (needs the app run once so the
; papercup-runtime distro is registered — same precondition as NSIS-era).
; Inno removes it on uninstall automatically (no PREUNINSTALL hook needed).
Name: "{autoprograms}\Papercusp Tutorial & Setup"; Filename: "{sys}\wsl.exe"; Parameters: "-d papercup-runtime --cd ~ -- bash -l -c ""papercusp tutorial"""; IconFilename: "{app}\papercusp-desktop.exe"; Comment: "Open the guided Papercusp tutorial and setup"
