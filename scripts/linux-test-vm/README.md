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

## Update / Revert E2E: VM only

Destructive updater testing must use the dedicated VM lane; never copy a live
home into `/tmp` and launch it beside the host desktop. Prepare a baseline with:

```sh
PAPERCUSP_E2E_RELEASE_HOST=http://10.0.2.2:8043 \
  ./vmctl updater-e2e /path/to/Papercusp-baseline.AppImage
./vmctl gui updater
```

`updater-e2e` resets only an `updater`/`updater-*` overlay, proves the guest has
a different kernel boot ID, copies only the AppImage, and launches with a new
empty `HOME`. It never imports host `.papercusp` state, discovery files,
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
