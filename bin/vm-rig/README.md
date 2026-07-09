# vm-rig — the tower↔VM federation rig (true kernel + network boundary)

The strongest LOCAL federation proof we have since Hetzner access was lost
(owner 2026-07-03; D-001 of `shared-hive-p2p-release-readiness-2026-07-03`):
the tower's live operator (`:3070`) federating with a **separate OS in a
QEMU/KVM VM** across a real bridge hop. This is the P-059 drill rig, rescued
from hand-rolled `/tmp` scripts (which a VM reboot deletes — exactly how the
original `vmcall.sh` got lost).

## Topology

| End | What | Address |
| --- | --- | --- |
| tower | live operator (`papercup-dev-api.service`, `:3070`) | `172.31.44.1` (host side of `macbr0`) |
| VM | packaged **Papercusp Server.app** on the macOS (Sonoma) QEMU VM | `172.31.44.2`, ssh `aviweiss@172.31.44.2` |

- Bridge: `macbr0` (`172.31.44.1/24`), VM NIC `mactap0`.
- VM boot (usually already up; the mac-VM dogfood lane owns it — coordinate
  before rebooting): `~/macos-vm/OSX-KVM/boot-sonoma-durable.sh`.
- The VM operator's Hono port is **randomized per boot** — never hardcode it;
  `vmcall.sh` auto-discovers it by probing local listeners for `/api/health`.

## Bring-up (fresh agent, from zero)

```bash
# 1. VM up + reachable?
ssh -o ConnectTimeout=5 aviweiss@172.31.44.2 true || echo "VM down — boot-sonoma-durable.sh (coordinate with the mac-VM lane first)"

# 2. deploy the driver (RE-RUN AFTER EVERY VM REBOOT — the VM's /tmp is wiped)
bin/vm-rig/deploy.sh

# 3. side-by-side diagnosis (roster, admittedLogCount, watermarks, swarm log)
bin/vm-rig/diag.sh

# 4. the P-059 acceptance probes
bin/vm-rig/probe-fwd.sh    # tower→VM : PASS = key in VM coord:feed AND VM events:status shows a wake record created before the 600s await window expired
bin/vm-rig/probe-rev.sh    # VM→tower : PASS = key in tower coord:feed AND tower events:status shows a wake record created before the 600s await window expired
```

P-059 SUCCESS = both probes green AND still green after a VM reboot
(reboot → re-run `deploy.sh` → re-run both probes). Read PASS off each
probe's `coord:feed` + `events:status` output, NOT off the await `.out`
outcome line — a headless probe client's own await legitimately reports
dropped/dead-waiter until P-001 (wake-executor inbox-degrade fix) lands;
that's the last delivery hop, not a federation failure.

## Env knobs

| Var | Default | Meaning |
| --- | --- | --- |
| `PCUSP_VM_SSH` | `aviweiss@172.31.44.2` | ssh target for the VM end |
| `PAPERCUSP_HONO_PORT` | `3270` | TOWER operator port (probes'/diag's tower end) — the **bg-host substrate primary**, which actually holds the in-process events/coord state; `:3070` is the request-only cluster tier and gives false-negative probe results (earlier "probe failures" were this, not a federation defect) |
| `PCUSP_PROBE_KEY` | unique per run | event key the probes emit/await |
| `PCUSP_VM_NODE` / `PCUSP_MCP_CALL` | auto | VM-side node binary / mcp-call.mjs path (see `vmcall.sh`) |

## Gotchas (each burned a real drill)

- **VM `/tmp` is wiped on reboot** — always `deploy.sh` after a reboot; a
  `NO_OPERATOR_PORT` from vmcall means the VM app isn't running (start
  Papercusp Server.app in the VM), not a driver bug.
- **ufw on the tower can silently block guest→host** traffic on the bridge
  (the P-059 "post-UFW-fix" history). If reverse-leg traffic dies:
  `sudo ufw allow from 172.31.44.0/24`.
- **Workspace scoping**: author VM-side state under
  `--workspace papercusp-workspace`, NOT `default` — state authored under
  `default` strands work invisible to the papercusp hive (WI-1564 class).
- **Probe/diag await windows must be ≥600s, and tower calls must hit `:3270`
  (bg-host substrate primary), not `:3070`** (request-only cluster tier) —
  a 200s window expired before replication had actually applied, and calls
  against `:3070` were reading a tier that doesn't hold the true in-process
  substrate state. Both looked like federation failures; neither was.
- **VM bridge NIC re-enumeration**: a VM reboot/update can renumber the
  bridged NIC (`en1`→`en2` seen in practice) — the static IP binding does
  NOT follow automatically and must be re-bound with `networksetup` inside
  the VM, or the VM silently drops off `172.31.44.2` and every ssh/probe
  call in this rig times out for a reason that looks like the bridge itself
  is down.
- **Packaged-app updates lose the `PAPERCUSP_DHT_BOOTSTRAP` LaunchAgent env**:
  updating the packaged Papercusp Server.app on the VM can wipe/reset the
  LaunchAgent's environment, dropping `PAPERCUSP_DHT_BOOTSTRAP` — re-verify
  this env var is still set on the VM's LaunchAgent **after every app
  update**, or the VM boots isolated (no bootstrap peer) and every probe
  fails looking like a federation regression.
- The tower end's **code fix / deploy target** is still `:3070` (the GREEN
  release operator) — a fix in the staging tree is NOT live there until
  deployed (`dev:pipeline_position`, force-deploy if the drill needs it).
  This is separate from the `:3270` substrate-primary port the probes/diag
  call by default above — `:3070` is where a *code change* lands; `:3270`
  is which *port* of the running (already-deployed) operator to query.

## Files

| File | Role |
| --- | --- |
| `vmcall.sh` | VM-SIDE driver: port auto-discovery + mcp-call (deployed to VM `/tmp`) |
| `deploy.sh` | push `vmcall.sh` + `scripts/mcp-call.mjs` onto the VM + self-test |
| `probe-fwd.sh` | tower→VM federated-event probe (from `/tmp/p059-e1c.sh`) |
| `probe-rev.sh` | VM→tower federated-event probe (from `/tmp/p059-rev2.sh`) |
| `diag.sh` | tower+VM `dev:dogfood_substrate_status` side-by-side + swarm log (from `/tmp/p059-diag.sh`) |

For the containerized 2-node **matrix** rig see `bin/local-matrix.sh`; for the
fast single-box smokes see `bin/two-instance-*-smoke.sh`.
