# Linux clean-room test VM (`vmctl`)

A disposable Ubuntu 24.04 VM for testing the packaged Papercusp `.deb` in a truly
isolated environment:

1. **Fresh-install testing** — install the real `.deb` on a pristine system and
   verify it installs (deps resolved) and boots from scratch.
2. **Separate-machine testing** — run a second Papercusp instance with its own
   identity for shared-harness / federation testing (Phase 2).

Plan: `linux-test-vm-and-federation-2026-06-04` (operator scope).
Full runbook: `/internal/docs/build-system/vms` ("Linux test VM" section).

## Layout

- **Scripts (this dir, versioned):** `vmctl`, `boot-vm.sh`, `lib/common.sh`,
  `cloud-init/`.
- **Disk images (outside the repo, never committed):** `~/papercup-linux-test-vm/`
  (`images/golden.qcow2`, per-instance `run/<name>/overlay.qcow2`, …).
- **SSH key:** `~/.ssh/papercup-vm-linux` (auto-generated on first `provision`).

Ports (per instance, starting past the Mac/Win build VMs): `clean` → SSH 2224,
SPICE 127.0.0.1:5932; the dedicated updater lane uses `updater` → SSH 2227,
SPICE 127.0.0.1:5935.

## Quick start

```sh
./vmctl provision            # one-time: build the golden image (~10–20 min)
./vmctl up clean             # boot a pristine VM
./vmctl install clean        # scp newest .deb in + apt install (the fresh-install test)
./vmctl verify clean         # assert install / PG / operator / window + screenshot
./vmctl gui clean            # (run yourself) open a SPICE viewer to click around
./vmctl reset clean          # wipe back to a pristine overlay
./vmctl down clean           # power off
```

For scripts that drive the VM, three subcommands give machine-readable answers:

```sh
./vmctl endpoint clean       # ssh_port= / ssh_key= / ssh_host= (the single source for callers)
./vmctl is-running clean     # exit 0 if the instance is up, 1 if not
./vmctl wait-ssh clean 300   # wait up to 300 s for SSH; non-zero on timeout (a hard verdict)
```

An instance name other than `clean`/`fed-a`/`fed-b`/`updater` gets its own
overlay and a free slot from the ad-hoc port pool when it boots (`VM_ADHOC_SLOTS`
defaults to 40). The allocator reserves ports under a lock and checks active
listeners and in-flight claims, so multiple ad-hoc VMs can run when slots are
free. A stopped ad-hoc instance has no assigned ports; after boot, query
`vmctl endpoint <name>` for its current endpoint.

**Big inputs or a big disk** (e.g. restoring production DB dumps in a clean room):
`boot-vm.sh` takes `BOOT_DATA_DISK=/path/data.qcow2` (a 2nd virtio disk, seen in the
guest as `/dev/disk/by-id/virtio-pcdata`) and `BOOT_SHARE_RO=/host/dir:tag` (a
READ-ONLY virtio-9p export; mount it in the guest with
`mount -t 9p -o trans=virtio,version=9p2000.L,ro,msize=524288 tag /mnt/x`). Both pass
through `vmctl up`. You create and delete the data disk yourself; `reset`/`down`
never touch it. Contract: `bin/lib/vm-boot-extra-drives.selftest.sh`.

## Release platform smoke: the Linux leg

The release gate's Linux installed-update proof runs on this VM.
`release_artifacts_run_platform_smoke` (`bin/lib/release-artifacts.sh`) resets
`clean` (or `$PAPERCUSP_LINUX_SMOKE_VM`), boots it, installs the **previous**
release as the running baseline, runs `bin/install-and-relaunch-verify.sh
--platform linux` against the endpoint `vmctl endpoint` prints, and always powers
the VM down. It holds `$TMPDIR/papercusp-linux-smoke-<vm>.lock` and refuses an
instance that is already running, so **it never takes over a VM you booted
yourself**. Pass the previous release's debs as
`PAPERCUSP_LINUX_SMOKE_BASELINE_GUI` + `PAPERCUSP_LINUX_SMOKE_BASELINE_SERVER` (or
`PAPERCUSP_LINUX_SMOKE_BASELINE_DIR`). Full procedure: `RELEASE-RUNBOOK.md` §4.

## Update / Revert E2E: VM only

Destructive updater testing must use the dedicated VM lane; never copy a live
home into `/tmp` and launch it beside the host desktop. Prepare a baseline with:

```sh
PAPERCUSP_E2E_RELEASE_HOST=http://10.0.2.2:8043 \
  ./vmctl updater-e2e /path/to/Papercusp-baseline.AppImage
./vmctl gui updater
```

`updater-e2e` resets only an `updater`/`updater-*` overlay, proves the guest has
a different kernel boot ID, installs the existing desktop `.deb` to provision
WebKit/GTK runtime dependencies, then copies only the AppImage and launches it
with a new empty `HOME`. Override the dependency artifact with
`PAPERCUSP_E2E_RUNTIME_DEB=/path/to/Papercusp.deb` when needed. The flow never
imports host `.papercusp` state, discovery files,
heartbeats, console markers, sockets, or embedded database rows. The command
also verifies that the guest `operator.json` birth identity matches `/proc`
before it allows the test to proceed. Click Update and then Revert only inside
the SPICE guest.

`vmctl install` defaults to the newest
`src-tauri/target/release/bundle/deb/Papercusp_*_amd64.deb`; pass a path to override.

## Querying the VM's embedded Postgres

The app bundles real PostgreSQL client tools at
`/usr/lib/Papercusp GUI/sidecar/bin/` (`psql`, `pg_dump`, `pg_dumpall`,
`pg_restore`) — self-contained, wired to the embedded libpq. `fed.sh <a|b> sql`
uses them automatically; the DSN is in the guest's
`~/.papercusp/embedded-pg.json`. (Installs from builds before 2026-07-07
shipped a broken `pg_wrapper` shim instead — symptom: `Can't locate
PgCommon.pm`. Reinstall a fresh .deb, or see the node+pg fallback in the
`linux-vm-desktop-testing-workflow` agent-insight.)

Tunables via env: `PAPERCUSP_TESTVM_RAM_MB`, `PAPERCUSP_TESTVM_CPUS`,
`PAPERCUSP_TESTVM_DISK`, `PAPERCUSP_TESTVM_HOME`.
