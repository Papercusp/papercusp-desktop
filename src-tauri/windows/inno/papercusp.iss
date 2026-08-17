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
;
; P-012 (desktop-build-speed): the ISCC pack is the slowest leg of a Windows cut
; (~40 min), and every default cut now runs it TWICE — one pack per role (GUI +
; Server) since WI-5600 restored gui+server as the Windows default. This is an
; ALPHA: installer download size does not matter, build latency does. So use the
; FAST lzma2 variant + multi-threaded packing (CompressionThreads=auto = one per
; core). Trades a larger installer for a much faster pack; the GUI stays under
; Inno's ~4 GB single-file ceiling (the Server already DiskSpans regardless).
; (Before/after wall-clock is MEASURED on the next real VM cut — this box has no
; ISCC; the directives themselves are standard Inno 6 and reversible.)
Compression=lzma2/fast
SolidCompression=no
LZMAUseSeparateProcess=yes
CompressionThreads=auto
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; All-5-buttons source bundle (WI-3306/WI-3308): when stage-source-tree.sh has
; staged the runnable dev/local source tree (sidecar\source.tar.zst, ~2.2 GB
; zstd, PAPERCUSP_STAGE_SOURCE=1 builds), the Server payload exceeds Inno's
; ~4 GB single-exe max — span it: a small setup.exe + setup-*.bin slices.
; Installing then needs the .bin files NEXT TO the exe (build-windows-on-vm.sh
; collects every file from the output dir, so they travel together). Detected
; at compile time from the staged file itself — no new /D define to plumb.
; SINGLE-FILE OVERRIDE (owner-directed 2026-07-08): pass ISCC /DSingleFile
; (build-windows-on-vm.sh does so when PAPERCUSP_SINGLE_FILE=1) to FORCE one
; setup.exe even with the 2.2 GB source tree present — better UX than
; setup.exe + .bin slices, for hosting OFF GitHub (whose release assets cap at
; 2 GiB). Default (no define) stays spanned so the standard GitHub flow works.
#if !Defined(SingleFile) && AppId == "com.papercusp.server" && FileExists(AddBackslash(BuildRoot) + "sidecar\source.tar.zst")
DiskSpanning=yes
DiskSliceSize=2100000000
#endif
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\papercusp-desktop.exe
UninstallDisplayName={#AppName}
SetupIconFile={#BuildRoot}\icons\icon.ico
WizardStyle=modern

[Files]
; ignoreversion (EI/WI-3285, found live 2026-07-07): papercusp-desktop.exe carries
; PE version info, and Inno's default [Files] behavior SKIPS copying a versioned
; file when the destination's embedded version is >= the source's — a "don't
; downgrade a shared DLL" safety feature. AppVersion (tauri.conf.json) does not
; bump on every iteration build, so two consecutive installs at the same "0.0.2"
; silently left the OLD exe in place while sidecar/*, resources/*, seed/* (no PE
; version info, always overwritten) updated fine. Symptom: a fresh install/rebuild
; behaves like the code never changed (stale WSLENV list, stale env-operator
; provisioning, etc.) with zero installer error — Setup reports success either way.
; `ignoreversion` makes the exe follow the same unconditional-overwrite semantics
; as every other file in this installer.
Source: "{#BuildRoot}\target\release\papercusp-desktop.exe"; DestDir: "{app}"; Flags: ignoreversion
; source.tar.zst is excluded here: Server-only (see below) — sweeping it into
; the GUI bundle too would put the GUI installer itself past the ~4 GB max.
Source: "{#BuildRoot}\sidecar\*"; DestDir: "{app}\sidecar"; Excludes: "source.tar.zst"; Flags: recursesubdirs createallsubdirs
Source: "{#BuildRoot}\resources\*"; DestDir: "{app}\resources"; Flags: recursesubdirs createallsubdirs nocompression
; SEED IS SERVER-BUNDLE-ONLY (WI-3234). On Windows the GUI role NEVER restores a
; seed: main.rs ensure_server_running() either ATTACHES to a running Papercusp
; Server or launch_bundle()s it — only the SERVER role owns the seed-restoring
; sidecar (self-hosting is Linux-single-bundle only). Shipping the ~2.1 GB seed
; in BOTH bundles is pure dead weight AND made two installs need ~6.9 GB, which
; overran the disk mid-GUI-install (1.78 GB free) → the GUI files never landed →
; its Start-Menu shortcut pointed at a missing exe → "GUI doesn't launch". Guard
; the seed to the Server bundle so the GUI installer is ~0.5 GB (exe+sidecar).
#if AppId == "com.papercusp.server"
Source: "{#BuildRoot}\seed\*"; DestDir: "{app}\seed"; Flags: recursesubdirs createallsubdirs nocompression
; Bundled env sidecars (WI-3285; pinned contract, plan
; env-switcher-packaged-all-platforms-2026-07-06): the packaged env switcher
; spawns <sidecarDir>\env-sidecars\<envId>\serve.mjs for the non-primary env
; buttons (V1 ships exactly one: staging; prod falls back to the primary's own
; serve.mjs in the launcher). Server-bundle-only — the GUI never runs an
; operator. Staged by build-windows-on-vm.sh OUTSIDE sidecar\ in the build tree
; (sidecar\ is atomically REPLACED by every sidecar publish, which would wipe
; anything staged inside it) and mapped under {app}\sidecar here so runtime
; discovery (dirname(PAPERCUSP_SIDECAR_BIN)/env-sidecars) finds it.
Source: "{#BuildRoot}\env-sidecars\*"; DestDir: "{app}\sidecar\env-sidecars"; Flags: recursesubdirs createallsubdirs
; Runnable dev/local source tree (WI-3306/WI-3308, all-5-buttons dogfood
; bundle): ONE zstd archive; serve extracts it on first boot to the distro's
; ext4 (dev-source-extract.ts) and the env-operator launcher runs the
; dev(:3270)/local(:3055) buttons from that tree. Server-only (the GUI runs no
; operator) + stored raw (zstd is incompressible under lzma2 — same treatment
; as seed/resources). Absent on a build without PAPERCUSP_STAGE_SOURCE=1 →
; entry skipped, dev/local stay 'no-source-tree' exactly as before.
Source: "{#BuildRoot}\sidecar\source.tar.zst"; DestDir: "{app}\sidecar"; Flags: nocompression skipifsourcedoesntexist
#endif

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\papercusp-desktop.exe"
; Parity with windows/hooks.nsh NSIS_HOOK_POSTINSTALL (WI-2197): the guided
; tutorial shortcut targets wsl.exe directly (needs the app run once so the
; papercup-runtime distro is registered — same precondition as NSIS-era).
; Inno removes it on uninstall automatically (no PREUNINSTALL hook needed).
Name: "{autoprograms}\Papercusp Tutorial & Setup"; Filename: "{sys}\wsl.exe"; Parameters: "-d papercup-runtime --cd ~ -- bash -l -c ""papercusp tutorial"""; IconFilename: "{app}\papercusp-desktop.exe"; Comment: "Open the guided Papercusp tutorial and setup"

; Auto-update relaunch (desktop-auto-update-operational-2026-07-09): tauri-plugin-
; updater types every .exe as NSIS and always passes /UPDATE on its command line.
; Inno ignores unknown switches, but we can READ the raw tail — so when this
; installer was launched BY the updater (silently, via the app's
; installerArgs /VERYSILENT in tauri.conf.json > plugins.updater.windows),
; relaunch the app at the end of the install. A manual first-install (no
; /UPDATE on the tail) is unaffected.
[Run]
Filename: "{app}\papercusp-desktop.exe"; Flags: nowait; Check: IsUpdaterLaunch

[Code]
const
  LegacyUninstallRoot =
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\';
  { auto-launch (via tauri-plugin-autostart) writes login auto-start HERE. }
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  StartupApprovedRunKey =
    'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run';
  SharedWslDistro = 'papercup-runtime';

function UninstallTargetExists(const UninstallString: String): Boolean;
var
  Target: String;
  Candidate: String;
  QuotePos: Integer;
  I: Integer;
begin
  Result := False;
  Target := Trim(UninstallString);
  if Target = '' then
    Exit;

  { UninstallString is normally a quoted path followed by arguments. }
  if Copy(Target, 1, 1) = '"' then
  begin
    Delete(Target, 1, 1);
    QuotePos := Pos('"', Target);
    if QuotePos > 0 then
      Delete(Target, QuotePos, Length(Target) - QuotePos + 1)
    else
      Target := '';
    Result := (Target <> '') and FileExists(Target);
    Exit;
  end;

  { Unquoted: the executable path may ITSELF contain spaces. Every real
    Papercusp path does ("Papercusp GUI", "Papercusp Server"), and the
    NSIS-era scheme these legacy keys come from writes UninstallString
    unquoted — so truncating at the first space judges a LIVE uninstaller
    missing and deletes a real install's entry, stranding an install that can
    then never be removed. That is precisely the harm this guard exists to
    prevent (EI-19481728463683227), so FAIL SAFE: the target counts as
    present if the whole string, or ANY space-delimited prefix of it, is an
    existing file; only when none of them exists is the entry a genuine
    ghost. FileExists is False for directories, so a prefix that merely names
    a folder never rescues a real ghost. }
  if FileExists(Target) then
  begin
    Result := True;
    Exit;
  end;
  for I := 1 to Length(Target) do
  begin
    if Target[I] = ' ' then
    begin
      Candidate := Copy(Target, 1, I - 1);
      if (Candidate <> '') and FileExists(Candidate) then
      begin
        Result := True;
        Exit;
      end;
    end;
  end;
end;

procedure ReapLegacyUninstallEntry(const LegacyName: String);
var
  LegacyKey: String;
  UninstallString: String;
begin
  LegacyKey := LegacyUninstallRoot + LegacyName;
  { Only remove an old bare-name key when it has an uninstall command and
    that command's executable is genuinely gone. A live entry from another
    install must never be deleted just because its display name is old. }
  if RegKeyExists(HKCU, LegacyKey) and
     RegQueryStringValue(HKCU, LegacyKey, 'UninstallString', UninstallString) and
     (not UninstallTargetExists(UninstallString)) then
    RegDeleteKeyIncludingSubkeys(HKCU, LegacyKey);
end;

procedure ReapLegacyUninstallEntries;
begin
  ReapLegacyUninstallEntry('Papercusp GUI');
  ReapLegacyUninstallEntry('Papercusp Server');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    ReapLegacyUninstallEntries;
end;

function IsUpdaterLaunch(): Boolean;
begin
  Result := Pos('/UPDATE', UpperCase(GetCmdTail())) > 0;
end;
