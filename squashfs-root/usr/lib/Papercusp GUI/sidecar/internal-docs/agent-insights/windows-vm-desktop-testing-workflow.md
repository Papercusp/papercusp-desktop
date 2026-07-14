# Windows-VM desktop testing — the working recipe and its sharp edges
URL: /internal/docs/agent-insights/windows-vm-desktop-testing-workflow

How to build, install, launch, observe and tear down the Windows desktop app in the local QEMU Windows 11 VM — schtasks launch, bk.log observation, wsl --exec (never `wsl --`), UNC discovery, and the WSL signal boundary.

## What

The Windows desktop lane (plan `windows-desktop-release-readiness-2026-06-11`)
is built and tested entirely on the local QEMU Windows 11 VM. The working
recipe, assembled over \~14 fix iterations on 2026-06-11, with every sharp
edge that cost an hour:

## The recipe

* **Boot the VM**: `~/windows-vm/boot-windows.sh` (detach it — a killed
  parent session takes QEMU down with it; `setsid … & disown` or a
  user-level systemd unit). SSH: `ssh -i ~/.ssh/papercup-vm-win -p 2223
  user@127.0.0.1`. SPICE viewer on `:5931` for pixels.
* **Build**: `papercusp-desktop/bin/build-windows-on-vm.sh` does the whole
  lane — pack (D-006 exclusions live in its tar step) → scp → clean extract →
  `npm install` + `npx tauri build --no-bundle` + **ISCC (Inno Setup 6.5.2+)**
  under vcvars64 → collect → **host-side** `tauri signer sign` (updater `.sig`).
  It builds BOTH roles (Papercusp GUI + Papercusp Server) and packs each with
  Inno (template `src-tauri/windows/inno/papercusp.iss`, output collected to
  `src-tauri/target/windows-vm/bundle/inno/`), NOT Tauri's bundler. **(Changed
  2026-07-06, WI-3172: cut over from Tauri's NSIS bundle to Inno Setup — see
  sharp edge §5 for why.)** Authenticode signing is in-VM via
  `WINDOWS_SIGN_*` / `WINDOWS_CERT_*` env (D-004; unset ⇒ unsigned dev/dogfood
  build); the minisign updater `.sig` is still minted host-side (the private
  key never leaves this box), though the Windows auto-updater itself is PENDING
  REWORK post-Inno-cutover — it expected the NSIS artifact (WI-3172).
* **Install silently**: `Start-Process -FilePath …-setup.exe -ArgumentList /S -Wait`.
* **Launch with logs**: `schtasks /run /tn papercusp-e2e` — an
  *Interactive-only* scheduled task running `papercusp-launch.cmd`, which
  redirects the app's stdout+stderr to `C:\Users\user\papercusp-bk.log`.
  This is the ONLY way to get the GUI app's output on Windows; launching
  over a bare ssh session puts the app in the wrong session (no webview)
  and captures nothing. `papercusp-e2e-direct` launches without the log
  redirect.
* **Observe**: tail `papercusp-bk.log` for the chain
  `pg: listening` → `migrations` → `[serve] listening` → `wrote operator.json`.
  Operator health from inside the VM:
  `Invoke-WebRequest http://127.0.0.1:<port>/api/health`.
* **Reach into the runtime**:
  `wsl -d papercup-runtime --user papercup --exec <cmd>` over ssh. Append
  `| tr -d '\r\0'` host-side — wsl.exe emits UTF-16 (it ignores `WSL_UTF8=1`
  in some paths; the desktop decodes by sniffing, you must too).

## The sharp edges (each one cost real time)

1. **`wsl --exec`, NEVER `wsl --`** — the bare `--` separator re-joins
   everything after it into one string and runs it through the distro's
   default shell, shredding multi-word args. A `bash -c '<multiline
   script>'` arrives re-tokenized and executes garbage. `--exec` preserves
   the argument vector. (Bit the wizard's Install Agent Runtime button via
   pty.rs, found live.)

2. **No Windows console signal crosses the WSL boundary.** The serve child
   on Windows is only the wsl.exe *relay*; `CTRL_BREAK_EVENT` from a
   console-less GUI app reaches nobody, so the old shutdown hard-killed the
   relay and embedded PG needed WAL recovery every boot. Graceful shutdown
   must SIGTERM the **Linux pid** (from the distro-side `operator.json`)
   through `wsl.exe --exec kill -TERM <pid>` (`kill_sidecar` in main.rs does
   this now).

3. **WSLENV `HOME/p` does not survive WSL session init** — passwd re-sets
   HOME after the merge. Serve state lands under `/home/papercup`; the
   Windows side discovers it via `\\wsl.localhost\papercup-runtime\home\papercup`.

4. **Embedded PG cannot live on DrvFs** (`/mnt/c/...`) — a 0700 data dir is
   impossible without the metadata mount option; PG data goes on ext4 inside
   the distro (D-007). Consequence: `wsl --unregister` deletes the database.

5. **NSIS datablock caps at \~2 GiB → this is WHY the build cut over to Inno
   Setup (WI-3172, 2026-07-06).** The owner-mandated full offline seed (git
   `super.bundle` + pot corestore) puts the payload at \~3.4 GB and makensis
   dies packaging it — "Internal compiler error … error mmapping file … out of
   range" at the signed-32-bit \~2 GiB datablock offset (the corestore alone is
   > 2 GiB, so no slimming rescues NSIS; MSI caps lower, a 7z-SFX combined `.exe`
   > hits the \~2 GB PE-loader limit). **Inno Setup 6.5.2+ builds a single \~4 GB
   > `setup.exe`** — hence the cutover. *NSIS-era history (preserved):* the old
   > `--bundles nsis` lane shipped without `sidecar/code-server` and
   > `sidecar/bin/omp` (D-006) with zlib compression via
   > `tauri.windows.conf.json`, and that in-VM build was deliberately keyless — it
   > exited 1 with "A public key has been found, but no private key" AFTER the
   > bundle finished (the sanctioned outcome; Windows cannot hold an empty env
   > var, so an empty-passphrase key hung tauri-cli on an ssh stdin prompt
   > forever). The current `--no-bundle` Inno lane no longer produces that
   > failure.

6. **Job objects kill `app.restart()`** — an installer-spawned app (NSIS
   "run after install") lives in a job; the relaunched child dies with the
   parent. Post-onboarding restart spawns with
   `CREATE_BREAKAWAY_FROM_JOB` (D-010).

7. **WebView2 maps custom protocols onto `http://<scheme>.localhost`** — the
   raw `papercusp://localhost` form silently no-ops on navigate (D-008).

8. **Stale serve lockfile + Linux pid-reuse** — after `wsl --shutdown` or a
   host reboot, low Linux pids recycle and can defeat a naive pid-alive
   check; serve's lock liveness check matches the owner's cmdline too.

9. **`schtasks` tasks are session-bound**: `Logon Mode: Interactive only` —
   the auto-logged-in console session must exist (it does on this VM).
   `taskkill` without `/F` often cannot close the app (WM\_CLOSE refused);
   use `taskkill /PID <pid>` first to exercise the graceful path, `/T /F`
   for teardown.

10. **Never forward PATH through WSLENV** (`PATH/l`) — the translated
    Windows PATH *replaces* the distro PATH inside the spawned process, so
    `/usr/bin` et al vanish and every distro-binary spawn from serve
    (kopia, locale, git) dies ENOENT — while the same binary works from a
    fresh `wsl --exec` session, which is what makes it maddening to
    diagnose. Forward specific dirs as their own `/p` vars
    (`PAPERCUSP_SIDECAR_BIN`) and compose PATH on the Linux side.

11. **Hard-killing the app orphans the entire WSL backend** — `taskkill
    /T /F` kills the Windows tree (app + wsl.exe relay) but the Linux-side
    node/PG keep running (and keep the redirected log handle open, so the
    next launch's `>` redirect fails and the task silently exits 1).
    Tolerated by design for the operator itself (next launch `--ensure`
    reuses it), but tear down test sessions with a WSL-side
    `kill -TERM <serve-pid>` (clean pg\_ctl stop, removes operator.json),
    not a Windows-side kill.

12. **Watch for peer churn on the shared tree mid-build** — the sidecar
    SPA build snapshots whatever the canonical tree holds; an in-flight
    peer refactor (mid-edit import/export mismatch) fails your build with
    a MISSING\_EXPORT that has nothing to do with your change. Check
    `coord:presence` for the file's owner and just retry once they're
    consistent.

13. **The rootfs bake script re-runs at first boot — every step must be
    idempotent AND prompt-free.** `build-rootfs.sh` ships *itself* as
    `/opt/papercup/bootstrap`; files it created at image-build time
    already exist on the re-run. A bare `gpg --dearmor -o <keyring>`
    hangs FOREVER on an interactive "Overwrite? (y/N)" (wedged the whole
    Windows first-run live — use `gpg --batch --yes`). Symptom: gate
    stuck at "Configuring runtime…", `ps -ef` in the distro shows
    `bash /opt/papercup/bootstrap` + a stuck child.

14. **You can get full DevTools into the packaged app's webview**:
    launch with `set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS= --remote-debugging-port=9222`, then drive CDP from the VM's own
    node (v24 has global WebSocket/fetch): `/json` lists targets;
    `Runtime.evaluate` reads the DOM; `Log.enable` streams console.
    This separates "app broken" from "paint broken" instantly. Do NOT
    add `--disable-gpu`/`--disable-gpu-compositing` — WebView2 creation
    fails outright and the app exits.

15. **Transient white window with a healthy DOM** — observed twice on
    schtasks-launched windows: CDP shows the full DOM but the window
    paints white (WebView2 GPU/compositor init flake under QEMU qxl).
    It self-resolved after the onboarding-finalize restart. If you see
    white, check the DOM via CDP (§14) before assuming the app is dead.

16. **Inbox (pre-Store) WSL's `wsl.exe` wedges FOREVER under a
    pseudoconsole** — the wizard's pty-routed installs/logins sit silent
    with zero output, zero exit, and no distro-side process; the same
    command via plain pipes works instantly. The VM runs inbox WSL
    (`wsl --version` is not even a recognized option there). Full
    diagnosis recipe + the fix set:
    [wsl-inbox-conpty-pty-hang](/internal/docs/agent-insights/wsl-inbox-conpty-pty-hang).
    pty.rs now carries a 20s no-output watchdog that kills the wedge and
    prints a `wsl --update` hint into the pane.

17. **NEVER run `wsl --update` on this VM** — Store WSL (2.7.8) cannot
    create its utility VM under the nested-QEMU profile ("Nested
    virtualization is not supported", `CreateVm/0x800705b4`); every
    distro boot fails until you `wsl --uninstall` to revert to the
    inbox engine (state survives the round trip; verified live
    2026-06-12). The §16 watchdog hint is for real hardware, not here.

18. **Window/tray observation MUST run inside Session 1 — via an interactive
    scheduled task that writes a result FILE the Session-0 ssh reads.** A
    powershell spawned from the WSL operator (or a plain ssh) runs in Session 0
    and `EnumWindows` returns zero interactive windows (D-002). Pattern that
    works (verified P-004 tray / P-008 quit / D-003 focus, 2026-07-04):
    `schtasks /create /tn <t> /tr "powershell -File C:\...\verify.ps1" /sc ONCE
    /st 00:00 /it /rl LIMITED /f` then `/run`; the script does the
    `EnumWindows` P/Invoke (and any `PostMessage WM_CLOSE` / `SetForegroundWindow`)
    **in-session** and `Set-Content`s the result to a txt Session-0 then reads.
    The Server tray app shows only a `com.papercusp.server-siw` single-instance
    window (no user window) — the notification-area icon is not a top-level
    window, so it never appears in `EnumWindows`; verify the tray by
    Server-is-windowless + owns-the-sidecar, not by enumerating the icon.

19. **A `schtasks`-relaunched GUI does not reliably persist a debuggable
    WebView2** — so the CDP path (§14) only works on the *first-boot* GUI or a
    `Start-Process`-launched one. On a *relaunch* via the `papercusp-e2e` task
    (after the GUI was closed), the GUI process spawns/attaches the Server then
    exits, leaving the Server+sidecar up but `:9222` unreachable. This looks
    like the app "not persisting" but is a Session-1 task-tree artifact, NOT a
    product second-launch bug (Start-Process launches persist; single-instance
    PASS\_ALL). For a CDP/button-click E2E, launch the GUI with `Start-Process`
    (or keep the first-boot GUI alive), don't relaunch through the task.

20. **Catch `cfg(windows)` Rust errors LOCALLY in \~40 s — don't spend a
    15-25 min VM build to find a typo (WI-2215).** The desktop's \~68
    `#[cfg(windows)]` / `#[cfg(target_os = "windows")]` regions (main.rs,
    wsl\_setup.rs, native\_console.rs, pty.rs, custom\_protocol.rs,
    endpoint\_ipc.rs, dev\_bridge.rs, native\_terminal.rs) do NOT compile under a
    plain `cargo check` on the Linux box — that target builds the
    `cfg(not(windows))` half, so a Windows-only type/import/borrow error is
    invisible until the VM build. Run `bin/check-windows-cfg.sh` instead
    (\~40 s cold, \~4 s warm). It is `cargo xwin check --target
    x86_64-pc-windows-msvc -p papercusp-desktop`. **Why not a bare
    `cargo check --target x86_64-pc-windows-msvc`:** the graph pulls in `ring`
    (via the TLS stack), whose build SCRIPT compiles C/asm and needs the MSVC
    librarian `lib.exe`; on Linux cargo aborts at `ring` before ever reaching
    our crate (`cc-rs: failed to find tool "lib.exe"`). `cargo-xwin` shims
    clang-cl / llvm-lib / llvm-rc in and downloads the MSVC CRT+SDK (one-time,
    cached under `~/.cache/cargo-xwin`); `check` is metadata-only so no real
    linker is needed. One-time setup (the script prints the exact command for
    any missing piece): `rustup target add x86_64-pc-windows-msvc`,
    `sudo apt-get install -y --no-install-recommends clang lld llvm`,
    `cargo install cargo-xwin`. `build-windows-on-vm.sh` runs it as an opt-out
    pre-flight (`SKIP_WINDOWS_CFG_PRECHECK=1`) and aborts before the VM trip on
    a compile error; it skips gracefully when the toolchain is absent. It is a
    COMPILE check, not a build — a runnable `.exe` is still the VM's job, and
    this is deliberately not in the green-checkpoint suite (needs the SDK).

21. **`papercup-runtime` periodically wedges: `wsl --exec` silently returns
    empty output + exit 1 (sometimes 0), no stderr, no diagnostic** — hit
    live during WI-3080 verification and reproduced again on 2026-07-06
    (EI-8163): even a trivial probe (`wsl -d papercup-runtime --user
    papercup --exec whoami`) came back with zero stdout, empty stderr, exit
    1. **Recovery, verified live**: `wsl --terminate papercup-runtime`
       (exits 0) then immediately retry the same `--exec` call — it succeeds
       on the very next attempt (no boot delay observed). Root cause not
       pinned down (stale `wslhost.exe` session / hung distro init / a WSL2
       utility-VM hiccup are all plausible); treat it as a transient utility-VM
       fault, not a broken distro state — `wsl --terminate` does not lose
       anything persistent inside the distro. **Practical rule**: if your
       first `--exec` probe in a session comes back empty with a nonzero
       exit and no stderr, don't debug the command — `wsl --terminate
       papercup-runtime` and retry once before looking any further.
       `papercusp-desktop/bin/wsl-exec-retry.sh` wraps this pattern (detect
       empty+nonzero on the first attempt, terminate, retry once, surface the
       second attempt's real exit code) for scripted/agent use over ssh.

22. **A compound command inlined into `ssh ... 'wsl -d papercup-runtime --
    bash -lc "..."'` silently mis-parses across FOUR re-splitting layers**
    (EI-9100, 2026-07-10) — distinct from the `--exec`-vs-`--` issue in §1
    (that one is wsl.exe's OWN arg handling; this one is everything
    UPSTREAM of it). The chain is: your local shell → ssh → Windows OpenSSH
    → **cmd.exe** (the default remote shell) → wsl.exe → bash. Any inline
    heredoc, pipe, or nested single-quote breaks at one of these boundaries
    with a confusing, boundary-specific error that never names the real
    cause:
    * heredoc content mis-split by cmd.exe before reaching bash: `cat: '#
      WI-3328...': No such file or directory`
    * a pipe meant for bash intercepted by cmd.exe instead: `'grep' is not
      recognized as an internal or external command`
    * single-quote nesting breaking across the ssh→cmd.exe→wsl→bash
      boundary: `/bin/bash: -c: line 1: unexpected EOF while looking for
      matching ''`
      **The fix is never to inline multi-layer quoting for anything beyond a
      single bare command.** Instead: (1) write a plain script file locally,
      (2) `scp` it to the VM using a **Windows-style** destination path
      (`user@127.0.0.1:C:/Users/User/<file>` — NOT `/mnt/c/Users/User/<file>`,
      which fails with `scp: dest open "/mnt/c/...": No such file or
      directory` because the SSH server's sftp-server is native Windows and
      does not resolve WSL-mount paths as its own root), (3) execute with ONE
      clean invocation and zero further nested quoting: `ssh ... wsl -d
      papercup-runtime --exec bash /mnt/c/Users/User/<script>.sh` (or
      `node ... .mjs`) — note this is where §1's `--exec` (not `--`) still
      applies, one layer downstream of the fix this item is about.

## Where the artifacts live

* VM build dirs: `C:\Users\user\papercup-build-*` (su-44446 = the iteration
  dir; `papercup-build-release` = the clean lane dir).
* Collected host-side: `papercusp-desktop/src-tauri/target/windows-vm/bundle/inno/`
  (was `bundle/nsis/` pre-WI-3172).
* Installed app: `C:\Users\User\AppData\Local\Papercusp\`.
* Boot log: `C:\Users\user\papercusp-bk.log`.

## Why this is the shape it is

D-001..D-010 on `windows-desktop-release-readiness-2026-06-11` carry the
full rationale (build-on-VM, bundle-the-rootfs, NSIS-only, unsigned alpha,
ext4 PG, payload trims, navigate-after-discovery, statics-pre-operator,
breakaway restart).
