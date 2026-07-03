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
bin/vm-rig/probe-fwd.sh    # tower→VM : PASS = key in VM coord:feed AND VM events:await fires
bin/vm-rig/probe-rev.sh    # VM→tower : PASS = key in tower coord:feed AND tower events:await fires
```

P-059 SUCCESS = both probes green AND still green after a VM reboot
(reboot → re-run `deploy.sh` → re-run both probes).

## Env knobs

| Var | Default | Meaning |
| --- | --- | --- |
| `PCUSP_VM_SSH` | `aviweiss@172.31.44.2` | ssh target for the VM end |
| `PAPERCUSP_HONO_PORT` | `3070` | TOWER operator port (probes' tower end) |
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
- The tower end talks to `:3070` (the GREEN release operator). A fix in the
  staging tree is NOT live there until deployed — `dev:pipeline_position`,
  force-deploy if the drill needs it.

## Files

| File | Role |
| --- | --- |
| `vmcall.sh` | VM-SIDE driver: port auto-discovery + mcp-call (deployed to VM `/tmp`) |
| `deploy.sh` | push `vmcall.sh` + `scripts/mcp-call.mjs` onto the VM + self-test |
| `probe-fwd.sh` | tower→VM federated-event probe (from `/tmp/p059-e1c.sh`) |
| `probe-rev.sh` | VM→tower federated-event probe (from `/tmp/p059-rev2.sh`) |
| `diag.sh` | tower+VM `hive:status` side-by-side + swarm log (from `/tmp/p059-diag.sh`) |

For the containerized 2-node **matrix** rig see `bin/local-matrix.sh`; for the
fast single-box smokes see `bin/two-instance-*-smoke.sh`.
