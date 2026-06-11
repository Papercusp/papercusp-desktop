# VMs (Mac + Windows + Linux test)
URL: /internal/docs/build-system/vms

SSH access, sudo credentials, port maps, disk-sizing notes, the Windows-VM survival kit, and the Linux clean-room test VM.

## Inventory

| VM                                           | Host process                                                                        | SSH port      | Display                                       | Inside-VM repo path                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- | --------------------------------------------- | ------------------------------------------------ |
| **macOS Sonoma** (x86\_64)                   | `qemu-system-x86_64 ... mac_hdd_ng.img`                                             | `2222`        | SPICE on `127.0.0.1:5930`                     | `~/papercupai/papercusp-desktop`                 |
| **Windows 10**                               | `qemu-system-x86_64 ... win10.img`                                                  | `2223`        | (no SPICE configured; consider RDP if needed) | `C:\Users\User\papercupai\papercusp-desktop`     |
| **Linux test** `clean` (Ubuntu 24.04)        | `qemu-system-x86_64 … run/<name>/overlay.qcow2` (via `scripts/linux-test-vm/vmctl`) | `2224`        | SPICE on `127.0.0.1:5932`                     | n/a — installs the packaged `.deb` (no checkout) |
| **Linux fed** `fed-a`/`fed-b` (Ubuntu 24.04) | same golden image, +2nd NIC on `papercusp-fedbr0` (via `bin/vm-federation.sh`)      | `2225`/`2226` | SPICE `127.0.0.1:5933`/`5934`                 | n/a — two-machine federation testing             |

The **Mac** and **Windows** VMs exist only to *produce* their platform's Tauri bundle. The **Linux test** VM is different in kind — it *consumes* the built `.deb`, fresh-installing it on a pristine Ubuntu to validate the shipped artifact (and to act as a separate machine for federation testing). Day-to-day operator dev (`:3055`) and Linux builds still run entirely on the host.

## Linux test VM (clean-room: fresh-install + federation)

Unlike the build VMs, this is a **disposable Ubuntu 24.04 clean-room** for testing the
packaged `.deb` in true isolation — driven by **`papercusp-desktop/scripts/linux-test-vm/vmctl`**,
not a hand-rolled boot script. It exists for (1) **fresh-install testing** the real `.deb` on a
pristine machine, and (2) acting as a **separate machine** for shared-harness / federation testing.
Plan: `linux-test-vm-and-federation-2026-06-04`.

* **Scripts (versioned):** `papercusp-desktop/scripts/linux-test-vm/` — `vmctl`, `boot-vm.sh`,
  `cloud-init/`, `lib/common.sh`.
* **Images (outside the repo, never committed):** `~/papercup-linux-test-vm/` —
  `images/golden.qcow2` + per-instance `run/<name>/overlay.qcow2`. SSH key
  `~/.ssh/papercup-vm-linux` (auto-generated on first `provision`).
* **Base:** Ubuntu 24.04 cloud image + a *minimal X stack* (openbox via getty-autologin +
  `startx`) — deliberately **not** GNOME (which fails to register its session on the qxl GPU) and
  with **no** preinstalled webkit, so `apt install ./Papercusp.deb` pulls the WebKitGTK runtime
  from scratch (a truer fresh install).

```sh
cd papercusp-desktop/scripts/linux-test-vm
./vmctl provision            # one-time: build the golden image (~10–15 min)
./vmctl up clean             # boot a pristine overlay
./vmctl install clean        # scp newest .deb in + apt install (the fresh-install test)
./vmctl verify clean         # assert deps/PG/operator/window + screenshot → PASS/FAIL
./vmctl gui clean            # (run yourself) open a SPICE viewer to click around
./vmctl reset clean          # wipe back to a pristine overlay
./vmctl down clean           # power off
```

`install` defaults to the newest `src-tauri/target/release/bundle/deb/Papercusp_*_amd64.deb`
(pass a path to override). `verify` checks: package installs, binary `ldd`-resolves, app process
up, embedded Postgres running, operator responds **on its dynamic port** (parsed from the app
log — *not* a fixed `:3070`), and captures a window screenshot via the qemu monitor
(`screendump`). Artifacts land in `run/<name>/verify/`. Tunables: `PAPERCUSP_TESTVM_RAM_MB`,
`PAPERCUSP_TESTVM_CPUS`, `PAPERCUSP_TESTVM_DISK`, `PAPERCUSP_TESTVM_HOME`.

**It earns its keep.** The first fresh-install run caught that the shipped `.deb` had **no
database** on a clean machine: `spawn_embedded_postgres_server` / `spawn_zero_cache_server`
(`src-tauri/src/main.rs`) used a bare `Command::new("node")` while the packaged process PATH has
no `node` — fixed by routing them through the bundled-node PATH like `spawn_sidecar` does. The
dev box hides this because it always has `node` on PATH, which is exactly why a clean VM is
necessary. (Plan decision D-009.)

### Two-machine federation (Phase 2)

The same VMs double as **separate machines** for cross-machine federation testing —
proving the packaged `.deb` federates (a write on one machine lands in the other's PG)
over a real OS + real network hop, not just loopback. Driven by
**`papercusp-desktop/bin/vm-federation.sh`**, which reuses the one-box smokes'
assertion core (`bin/lib/federation-asserts.sh`, D-003) over an SSH driver.

```sh
cd papercusp-desktop
bin/vm-federation.sh --vms=2 --dht=testnet --net=bridge   # primary: fed-a ↔ fed-b
bin/vm-federation.sh --vms=1                               # host instance ↔ fed-a VM
bin/vm-federation.sh --vms=2 --net=socket                 # rootless (no sudo) fallback
bin/vm-federation.sh --vms=2 --no-reset --skip-install    # fast iteration (reuse overlays)
```

* **Network (D-016):** every fed VM keeps its slirp NIC (internet/SSH/SPICE) and gets a
  **second** NIC on host bridge `papercusp-fedbr0` (`10.77.0.0/24`, host `10.77.0.1`) with a
  static guest IP — no dnsmasq/NAT. The host runs a `hyperdht/testnet` advertised on the
  bridge IP; both VMs set `PAPERCUSP_DHT_BOOTSTRAP` to it → deterministic discovery over a
  real hop. `--net=socket` is a rootless dual-NIC fallback (qemu socket L2, exactly two VMs).
* **Identities:** `papercupai` / `aviynw` via per-instance `GH_TOKEN` (resolved by
  `gh-token.ts`); `gh` + `postgresql-client` are apt-installed in each VM as driver prereqs.
* **Up-front `.deb` gate (P-011):** a static grep of the packaged `serve.mjs` (the sidecar
  boot entry; `host.mjs` is retired) asserts it carries `PAPERCUSP_DHT_BOOTSTRAP` support +
  `[swarm]` logs (landed 2026-06-02), failing fast on an older `.deb` that would silently use
  the public DHT.

**Status (verified 2026-06-07, unattended runs on a current `.deb`):** the harness proves
everything up to the holepunch boundary in **both modes** — `--vms=2` *and* `--vms=1` reach
fresh-install, clean embedded-PG boot on a fresh `initdb`, write-free share
(`state:"booted"` both sides), and **cross-machine swarm-join** (both identities announcing
on the same topic + DHT). Neither reaches the bidirectional merge, and the boundary is now
fully classified: hyperdht **holepunch does not complete between any two endpoints on ONE
physical host** — VM↔VM *and* host↔VM both sit at `conns=0` in raw-hyperswarm tests (same
topic, same bridge-advertised bootstrap, working UDP both directions), so neither the
single-NIC+NAT candidate nor the host's no-NAT network position rescues it (plan D-017/D-018).
`--dht=public` (P-012) is **INCONCLUSIVE** by same-host NAT hairpin, per the plan's D-004
best-effort caveat — though both peers do announce on the real public DHT through slirp.

The full bidirectional-merge acceptance needs **truly separate machines** — and that gate
was **discharged on Hetzner (2026-06-08, plan D-019)**: the Tier-3 p2p-perf suite on two
separate Hetzner cpx31 VMs over the public DHT got `peer_connected` on both peers,
cross-region append→visible p95 = 950.5 ms, and a real NAT holepunch
(`punches=1 relaySuccess=0`) — positively confirming the single-host `conns=0` wall is a
topology artifact (no second physical box needed; the cloud-deployment layer provides the
separate machines on-demand). It was further confirmed **cross-region** (ash↔hil, D-020:
append→visible p95 = 1115.5 ms over real transcontinental WAN) and — via
`bin/deb-hetzner-federation.sh` — for the **shipped `.deb` itself** (D-021: two Hetzner VMs,
the `.deb`'s headless sidecar, `peer_connected` + bidirectional `origin=remote` merge over the
public DHT). The finding, the clean-machine traps the harness flushed out (slirp-subnet,
embedded-PG boot race, the sidecar port-grep race, embedded-pg-refuses-root, and the bundled
`pgvector` needing the 24.04 toolchain), and the Hetzner discharge are in the agent-insight
[VM federation harness](/internal/docs/agent-insights/vm-federation-separate-machine-proof).

## SSH commands

```sh
# Mac
ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1
# Windows
ssh -i ~/.ssh/papercup-vm-win -p 2223 User@127.0.0.1
```

Inside the Mac VM, `sudo` password is `aviweiss`. Windows VM has no sudo concept; `User` has admin rights.

## Booting them

### Mac VM

```sh
cd ~/macos-vm/OSX-KVM
nohup bash boot-sonoma.sh > /tmp/macvm-boot.log 2>&1 &
```

Or click **Start macOS VM** in `/admin` (idempotent — exits 0 if already running). \~60–120s to SSH-ready.

To view the desktop: `remote-viewer spice://127.0.0.1:5930`.

### Windows VM

```sh
cd ~/win10-vm
nohup bash boot.sh > /tmp/win-boot.log 2>&1 &
```

\~90s to SSH-ready.

## Resource specs (current; tunable in the boot scripts)

|         | macOS VM                                   | Windows VM                      |
| ------- | ------------------------------------------ | ------------------------------- |
| RAM     | 16 GB                                      | 16 GB (was 8 GB pre-2026-05-12) |
| vCPUs   | 16                                         | 16                              |
| Disk    | 120 GB qcow2 (grown from 80 on 2026-05-13) | 80 GB qcow2                     |
| Cache   | writeback                                  | writeback                       |
| Net     | e1000                                      | e1000                           |
| Storage | AHCI                                       | AHCI                            |

## Disk discipline

Tauri builds are huge. A clean Mac build typically consumes:

* \~5 GB Rust target dir (`papercusp-desktop/src-tauri/target/release/`)
* \~3 GB npm cache (`~/Library/Caches/`)
* \~1.5 GB built node\_modules
* \~500 MB intermediate `.dmg` staging
* \~10 GB Xcode CoreSimulator runtimes (if you build iOS at all)

**Pre-build check** the user reflexively runs: `df -h /` on each VM. If `<10 GB` free, clean up before kicking off a build — mid-build ENOSPC is a hard failure and leaves a broken-half state.

The macOS VM has been on the verge of full multiple times. Safe deletes when desperate:

```sh
# iOS simulator runtimes (recreatable in Xcode → Settings → Platforms)
rm -rf ~/Library/Developer/CoreSimulator/Devices/*    # device instances only
# spm cache
rm -rf ~/Library/Developer/Xcode/DerivedData/SourcePackages/
# Rust target (forces clean rebuild but reclaims ~3-5 GB)
rm -rf ~/papercupai/papercusp-desktop/src-tauri/target
```

The Linux host (\~40-50 GB free typical) doesn't hit ENOSPC during builds but the Rust target dir there does grow to \~5 GB.

## Node version pinning

Both VMs run **nvm + Node 22** for the build-time `npm install` + `tauri build`. (This is separate from the *bundled* runtime that ships inside the artifact — `bin/build-desktop-sidecar.sh` vendors Node **v24** into `sidecar/bin/node`.) Node 20 hangs / errors during `npm install`.

```sh
# In either VM:
nvm install 22       # one-time
nvm use 22           # every shell
```

The `build-mac-prod` and `build-windows-prod` `/admin` commands source `nvm` and pin Node 22 explicitly. If you SSH in manually, don't forget `nvm use 22`.

## npm `--legacy-peer-deps` is required

The workspace's peer-dep tree has unresolvable conflicts that make `npm install` hang **silently with 0% CPU** in modern npm. **Always pass `--legacy-peer-deps`** for installs done in the build context. The /admin scripts do this; if you do manual installs in either VM, you must too.

## Mac VM environment quirks

* **Bundled-Node PATH**: GUI-launched apps on macOS inherit `$PATH = /usr/bin:/bin` — Homebrew Node, nvm Node, brew-installed `pg_dump` / `libpq` are all invisible. `main.rs:bundled_path_env()` builds a `PATH` with the shipped `sidecar/bin/` (node/omp/gh) prepended, and every node-based spawn (the `serve.mjs` sidecar + `code-server`) runs through it. **If you add a new spawn**, route it through the same helper.
* **Gatekeeper**: the DMG is unsigned. First launch will be blocked. The install-mac-dmg `/admin` command strips quarantine via `xattr -dr com.apple.quarantine /Applications/Papercusp.app`. If launching by hand, you'll need to do this too.

## Windows VM crashes routinely

The Windows VM crashed **6+ times during a single build session** (2026-05-13). Symptoms: SSH hangs indefinitely, `qemu-system-x86_64` process disappears, `/tmp/win-boot.log` last line is a kernel power error.

**Recovery procedure** (this happens often enough it's worth automating; for now do it manually):

```sh
# Verify dead
ps -ef | grep -v grep | grep "qemu.*win10\|qemu.*windows"   # → should be empty

# Restart
cd ~/win10-vm && nohup bash boot.sh > /tmp/win-boot.log 2>&1 &

# Wait ~90s
sleep 90 && ssh -i ~/.ssh/papercup-vm-win -p 2223 User@127.0.0.1 'echo ok'

# Re-run the build (it'll resume from incremental Rust cache if not corrupted)
```

The Rust target dir in the Windows VM survives crashes — it's qcow2 + AHCI writeback so a few seconds of write-back data may be lost, but cargo's atomic incremental graph handles this gracefully.

If a build was mid-`tauri build` when the VM crashed, you may need to delete and recreate `C:\Users\User\papercusp-desktop\src-tauri\binaries\embedded-postgres-server-x86_64-pc-windows-msvc.exe` — `tauri-bundler` doesn't always recover cleanly from in-place sidecar binary writes when the process disappears mid-write. Symptom: `failed to remove symlink ... os error 5`.

## Why builds don't run in containers

The Tauri team's MSI tooling (`wix`) requires Windows, and Apple's code-signing tooling requires macOS. We don't currently sign builds (the audit pipeline assumes unsigned binaries) but the Mac build does need to be a Darwin host for `cargo` to cross-compile to `x86_64-apple-darwin`. So the VMs aren't replaceable by Linux containers without a substantial cross-compile setup.

## Build cancellation

The `/admin` build commands run via `bash -lic`. Closing the SSE stream (Stop button or browser close) sends `SIGTERM` to the whole process group — which cleanly terminates the local `npm` and `tauri build` invocations on the host, but the SSH-driven Mac/Windows builds **continue running inside the VM** even after SIGTERM kills the SSH client. To actually cancel a Mac/Windows build mid-flight, SSH in separately and `pkill -f "tauri build\|cargo"`.
