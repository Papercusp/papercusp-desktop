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
SPICE 127.0.0.1:5932.

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

`vmctl install` defaults to the newest
`src-tauri/target/release/bundle/deb/Papercusp_*_amd64.deb`; pass a path to override.

## Querying the VM's embedded Postgres — there is NO working psql in the guest

The packaged app's `sidecar/bin/psql` (and `pg_dump`/`pg_dumpall`/`pg_restore`)
are Debian `pg_wrapper` perl shims copied from the build host — on a clean
system they die with `Can't locate PgCommon.pm`, and the embedded-postgres
native bin is server-only (`initdb`/`pg_ctl`/`postgres`). **`which psql`
succeeding inside the VM does NOT mean psql works.** Query via the bundled
node + `pg` module instead — recipe in the `linux-vm-desktop-testing-workflow`
agent-insight ("Querying the guest's embedded Postgres"); the DSN is in the
guest's `~/.papercusp/embedded-pg.json`.

Tunables via env: `PAPERCUSP_TESTVM_RAM_MB`, `PAPERCUSP_TESTVM_CPUS`,
`PAPERCUSP_TESTVM_DISK`, `PAPERCUSP_TESTVM_HOME`.
