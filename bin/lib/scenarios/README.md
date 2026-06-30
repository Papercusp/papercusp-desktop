# Federation live-matrix scenarios — author contract (Brief 13)

`bin/deb-hetzner-matrix.sh` is the **consolidated** live federation regression
runner (federation-release-hardening Brief 13). The Hetzner project is capped at
**2 concurrent servers (PERMANENT, owner-confirmed)**, so we do **not** run six
separate provision→teardown rigs (6 serialized = hours + 6× redundant setup).
Instead the matrix provisions **2 frames ONCE** (a=owner, b=member), publishes +
joins one hive, peers the swarm, then runs every contributed scenario in sequence
and prints a PASS/FAIL matrix — one shared live run for all of briefs 3-8.

You (a scenario author) contribute **one file**: `bin/lib/scenarios/<id>.sh`.

## The contract

Your file defines a function and registers it at source time:

```bash
# bin/lib/scenarios/b3-revocation.sh
scn_revocation_kcut() {
  # ... your scenario, using the rig_*/fed_* primitives ...
  # return 0 = PASS, non-zero = FAIL. Echo ONE result line to stdout.
  echo "revoked member B correctly stopped receiving + cannot decrypt post-boundary"
}
matrix_register revocation_kcut 90 "revocation + epoch K-cut" scn_revocation_kcut
#                ^id            ^order ^label                  ^fn
```

`matrix_register <id> <order> <label> <fn>` — call it at the **top level** of your
file. The matrix sources every `bin/lib/scenarios/*.sh`, sorts by `<order>`, and
calls each `<fn>` in turn, in the current shell.

### Inputs your `scn_*` can rely on (set before ANY scenario runs)

| global | meaning |
|---|---|
| `RIG_FRAMES=(a b)` | frame `a` = **OWNER**, frame `b` = **MEMBER** (2-frame run) |
| `FRAME_IP[a]` / `FRAME_IP[b]` | public IPs |
| `FED_PG[a/b]` / `FED_SC[a/b]` | embedded-PG + sidecar ports |
| `FRAME_MEMBER_SLUG[a/b]` | each frame's joined hive member slug |
| `RIG_HIVE_ID` / `RIG_HIVE_PUBKEY` / `RIG_HIVE_LINK` | the published hive |
| `MATRIX_RUN_ID` | unique-per-run tag — **suffix your ids with it** |

The hive is already published (owner from-repo), all frames joined, and the swarm
`peer_connected` a↔b **before** your scenario runs. You start from a healthy,
federating 2-node hive.

### Primitives (sourced: `federation-asserts.sh` + `deb-hetzner-rig.sh`)

- **content:** `rig_write_content <inst> <slug> <fid> [title] [status]` ·
  `rig_read_content <inst> <fid>` → `"<slug>|<origin>"` · `rig_read_roster <inst>`
- **positive asserts:** `fed_hive_merge_probe <src> <dst> <src_slug> <fid> [tries]`
  → `"1 <slug>"`/`"0"` · `fed_plan_part_merge_assert <src> <dst> <slug> [tries]` →
  `1`/`0` · `fed_coord_merge_probe <src> <dst> <src_slug> <tag> [tries]` → `1`/`0`
- **negative asserts:** `rig_assert_absent <inst> <fid> [tries]` → `1` (correctly
  absent) / `0` (leaked) · `rig_assert_row_absent <inst> "<table> WHERE <pred>" [tries]`
  → `1`/`0`
- **SSH driver:** `rig_driver_run <inst> -- <cmd…>` (root) · `rig_pcusp_run <inst>`
  (pcusp user, stdin script) · `drv_exec <inst>` (root, stdin) · `drv_psql <inst> <sql>`
- **lifecycle:** `rig_kill_sidecar <inst>` (offline, keep pgdata) ·
  `rig_restart_sidecar <inst>` (relaunch) · `rig_wait_frame_ready <inst>`
  (re-discover `FED_PG`/`FED_SC` after a restart)

### Rules (MUST)

1. **Do NOT provision or tear down VMs.** The matrix owns the lifecycle.
2. **Be self-bounding.** Use the bounded `fed_*`/`rig_assert_*` helpers (they cap
   their own polling). Never an unbounded `while true`/poll — scenarios run
   **in-process**, so a hang wedges the whole matrix.
3. **`return`, never `exit`.** An `exit` kills the matrix run (the EXIT-trap still
   tears down servers=0, but you lose the rest of the matrix).
4. **Leave the frames HEALTHY for the next scenario** — UNLESS you are a
   terminal/destructive scenario (revocation/ban), which registers with order ≥90 to
   run **last**. If you restart a sidecar, `rig_restart_sidecar` it back +
   `rig_wait_frame_ready` before returning.
5. **Unique ids per run.** Suffix feature_ids/msg_ids with `$MATRIX_RUN_ID` so
   scenarios don't alias each other.
6. **Write under the real workspace.** Prefer `rig_write_content` (it already does
   `COALESCE((SELECT workspace_id FROM hive_members LIMIT 1),'default')` — a bare
   INSERT defaulting to `'default'` never drains, D-050).

### Order convention (the `<order>` arg)

- **10–40** — non-destructive content/comms (content, plan-part, coord, concurrent,
  coord control-plane). Leave frames healthy.
- **50–70** — disruptive-but-restorative (reconnect/offline-catchup, restart
  durability). MUST restore healthy.
- **90+** — **terminal/destructive** (revocation/ban k-cut). Runs LAST; may leave the
  member unable to receive.

### Hand-off + self-check

- Either drop your `bin/lib/scenarios/<id>.sh` file in the tree (the matrix
  auto-sources it) **or** send the function text to **su-8b360** and I'll wire it.
- `bin/deb-hetzner-matrix.sh --list` prints the registered scenarios **without
  provisioning** — confirm yours registered.
- `bash -n bin/lib/scenarios/<id>.sh` syntax-checks your file.

See **`00-base.sh`** for three working reference scenarios (content / plan-part /
coord, A↔B) you can copy.
