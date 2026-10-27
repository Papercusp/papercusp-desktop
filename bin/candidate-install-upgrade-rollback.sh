#!/usr/bin/env bash
# Exercise a packaged Linux candidate and its exact rollback on the disposable
# clean-room VM. Compose the maintained vmctl lifecycle with the canonical
# install-and-relaunch verifier; never install packages on the host.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/release-artifacts.sh
source "$HERE/lib/release-artifacts.sh"
# shellcheck source=lib/legacy-client-recovery.sh
source "$HERE/lib/legacy-client-recovery.sh"

VM=clean
CANDIDATE_GUI=""
CANDIDATE_SERVER=""
BASELINE_GUI=""
BASELINE_SERVER=""
EVIDENCE_OUT=""
LEGACY_HOST_UNAVAILABLE=0
# The baseline's own source commit holds the updater key that installed client
# enforces. Default: this desktop repository, where release build SHAs live.
KEY_REPO="${PAPERCUSP_LEGACY_TRUSTED_KEY_REPO:-$(cd "$HERE/.." && pwd)}"
VMCTL="${PAPERCUSP_LINUX_VMCTL:-$(cd "$HERE/../scripts/linux-test-vm" && pwd)/vmctl}"
VERIFIER="${PAPERCUSP_CANDIDATE_INSTALL_VERIFIER:-$HERE/install-and-relaunch-verify.sh}"

usage() {
  cat <<'USAGE'
Usage: candidate-install-upgrade-rollback.sh \
  --candidate-gui PATH --candidate-server PATH \
  --baseline-gui PATH --baseline-server PATH --evidence-out PATH [--vm NAME] \
  [--legacy-host-unavailable]

Build provenance beside each GUI .deb must identify a distinct build SHA;
the matching Server .deb must carry the same SHA and package version. Before
touching the VM, both candidate packages must verify under the updater key the
baseline build trusts (read from the baseline's own source commit in
PAPERCUSP_LEGACY_TRUSTED_KEY_REPO, default this repository). The route resets
only the named disposable Linux test VM, installs the baseline, records the
old client's update-check answer, seeds user data, verifies candidate upgrade,
then verifies rollback to that exact baseline, requiring the user data after
each flip.

--legacy-host-unavailable asserts that the release host baked into the
baseline no longer serves it; an old client that then answers "up to date"
(rather than "could not check") fails the journey instead of being recorded.
USAGE
}

die() { echo "candidate-install-upgrade-rollback: $*" >&2; exit 2; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --candidate-gui) CANDIDATE_GUI="${2:-}"; shift 2 ;;
    --candidate-server) CANDIDATE_SERVER="${2:-}"; shift 2 ;;
    --baseline-gui) BASELINE_GUI="${2:-}"; shift 2 ;;
    --baseline-server) BASELINE_SERVER="${2:-}"; shift 2 ;;
    --evidence-out) EVIDENCE_OUT="${2:-}"; shift 2 ;;
    --vm) VM="${2:-}"; shift 2 ;;
    --legacy-host-unavailable) LEGACY_HOST_UNAVAILABLE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ -n "$CANDIDATE_GUI" && -n "$CANDIDATE_SERVER" && -n "$BASELINE_GUI" \
   && -n "$BASELINE_SERVER" && -n "$EVIDENCE_OUT" ]] || { usage >&2; exit 2; }
[[ "$VM" =~ ^[A-Za-z0-9_-]+$ ]] || die "unsafe VM name: $VM"
[[ -x "$VMCTL" ]] || die "Linux VM controller is not executable: $VMCTL"
[[ -x "$VERIFIER" ]] || die "canonical installer verifier is not executable: $VERIFIER"
for cmd in dpkg-deb flock git node python3 sha256sum stat timeout; do
  command -v "$cmd" >/dev/null 2>&1 || die "missing required local tool: $cmd"
done

for artifact in "$CANDIDATE_GUI" "$CANDIDATE_SERVER" "$BASELINE_GUI" "$BASELINE_SERVER"; do
  [[ -f "$artifact" && "$artifact" == *.deb ]] || die "expected an existing Debian package: $artifact"
done

read_build_field() {
  python3 - "$1" "$2" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
value = data.get(sys.argv[2])
if value is None:
    raise SystemExit(f"build provenance is missing {sys.argv[2]}")
print(str(value).lower() if isinstance(value, bool) else value)
PY
}
package_field() { dpkg-deb -f "$1" "$2"; }

candidate_prov="$(release_artifacts_find_provenance "$CANDIDATE_GUI")" \
  || die "candidate GUI has no nearby build-provenance.json"
baseline_prov="$(release_artifacts_find_provenance "$BASELINE_GUI")" \
  || die "baseline GUI has no nearby build-provenance.json"
CANDIDATE_SHA="$(read_build_field "$candidate_prov" buildSha)"
BASELINE_SHA="$(read_build_field "$baseline_prov" buildSha)"
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{7,64}$ ]] || die "invalid candidate build SHA: $CANDIDATE_SHA"
[[ "$BASELINE_SHA" =~ ^[0-9a-f]{7,64}$ ]] || die "invalid baseline build SHA: $BASELINE_SHA"
[[ "$CANDIDATE_SHA" != "$BASELINE_SHA" ]] || die "candidate and rollback target have the same build SHA; no identity flip is possible"

CANDIDATE_VERSION="$(package_field "$CANDIDATE_GUI" Version)"
CANDIDATE_SERVER_VERSION="$(package_field "$CANDIDATE_SERVER" Version)"
BASELINE_VERSION="$(package_field "$BASELINE_GUI" Version)"
BASELINE_SERVER_VERSION="$(package_field "$BASELINE_SERVER" Version)"
candidate_gui_package="$(package_field "$CANDIDATE_GUI" Package | tr '[:upper:]' '[:lower:]')"
candidate_server_package="$(package_field "$CANDIDATE_SERVER" Package | tr '[:upper:]' '[:lower:]')"
baseline_gui_package="$(package_field "$BASELINE_GUI" Package | tr '[:upper:]' '[:lower:]')"
baseline_server_package="$(package_field "$BASELINE_SERVER" Package | tr '[:upper:]' '[:lower:]')"
[[ "$candidate_gui_package" == *gui* && "$candidate_gui_package" != *server* ]] || die "candidate GUI artifact does not name the GUI package"
[[ "$candidate_server_package" == *server* ]] || die "candidate Server artifact does not name the Server package"
[[ "$baseline_gui_package" == *gui* && "$baseline_gui_package" != *server* ]] || die "baseline GUI artifact does not name the GUI package"
[[ "$baseline_server_package" == *server* ]] || die "baseline Server artifact does not name the Server package"
[[ "$CANDIDATE_VERSION" == "$CANDIDATE_SERVER_VERSION" ]] || die "candidate GUI/Server versions differ"
[[ "$BASELINE_VERSION" == "$BASELINE_SERVER_VERSION" ]] || die "baseline GUI/Server versions differ"
candidate_server_prov="$(release_artifacts_find_provenance "$CANDIDATE_SERVER")" \
  || die "candidate Server has no nearby build-provenance.json"
baseline_server_prov="$(release_artifacts_find_provenance "$BASELINE_SERVER")" \
  || die "baseline Server has no nearby build-provenance.json"
[[ "$(read_build_field "$candidate_server_prov" buildSha)" == "$CANDIDATE_SHA" ]] \
  || die "candidate Server provenance does not match the GUI build SHA"
[[ "$(read_build_field "$baseline_server_prov" buildSha)" == "$BASELINE_SHA" ]] \
  || die "baseline Server provenance does not match the GUI build SHA"

# An installed client only accepts an update signed by the key IT trusts. A
# candidate signed by any other key strands every old client at manual
# recovery, so prove the signatures under the baseline's key before the VM
# is touched. Never falls back to the candidate's or the working tree's key.
TRUSTED_PUBKEY="$(legacy_client_recovery_trusted_pubkey "$KEY_REPO" "$BASELINE_SHA")" \
  || die "cannot read the updater key baseline $BASELINE_SHA trusts from $KEY_REPO"
signature_rows="$(legacy_client_recovery_verify_signatures "$TRUSTED_PUBKEY" "$CANDIDATE_GUI" "$CANDIDATE_SERVER")" \
  || die "candidate packages do not verify under the updater key baseline $BASELINE_SHA trusts: $signature_rows"

# Resolve the endpoint before starting the VM. A reset clean-room VM rotates its
# host key, so the verifier receives the release route's explicit transport policy.
endpoint="$(bash "$VMCTL" endpoint "$VM")" || die "cannot read the $VM VM endpoint"
SSH_PORT="$(sed -n 's/^ssh_port=//p' <<<"$endpoint" | head -1)"
SSH_KEY="$(sed -n 's/^ssh_key=//p' <<<"$endpoint" | head -1)"
SSH_HOST="$(sed -n 's/^ssh_host=//p' <<<"$endpoint" | head -1)"
[[ "$SSH_PORT" =~ ^[0-9]+$ && -n "$SSH_KEY" && -n "$SSH_HOST" ]] || die "malformed VM endpoint: $endpoint"
[[ -r "$SSH_KEY" ]] || die "Linux install credential is unreadable: $SSH_KEY"
key_mode="$(stat -c '%a' "$SSH_KEY")"
(( (8#$key_mode & 077) == 0 )) || die "Linux install credential must not be group/world accessible (mode $key_mode): $SSH_KEY"

lock_file="${TMPDIR:-/tmp}/papercusp-linux-smoke-$VM.lock"
exec {lock_fd}>"$lock_file" || die "cannot open VM lock: $lock_file"
flock -n "$lock_fd" || die "another candidate install/upgrade route holds $lock_file"
if bash "$VMCTL" is-running "$VM" >/dev/null 2>&1; then
  die "VM '$VM' is already running; it belongs to another lane and will not be reset"
else
  vm_running_status=$?
  [[ "$vm_running_status" -eq 1 ]] || die "could not prove VM '$VM' is stopped (vmctl is-running exit $vm_running_status)"
fi

mkdir -p "$(dirname "$EVIDENCE_OUT")"
RUN_DIR="$(mktemp -d "$EVIDENCE_OUT.diagnostics.XXXXXX")"
printf '%s\n' "$signature_rows" >"$RUN_DIR/signatures.tsv"
printf '%s' "$TRUSTED_PUBKEY" >"$RUN_DIR/trusted-pubkey"
: >"$RUN_DIR/user-data-checks.tsv"
VM_STARTED=0
PHASE=vm-start
# On failure, capture the guest's package and service state BEFORE the VM is
# powered down: the verifier keeps only 400 bytes of relaunch output, and the
# guest journal that names the cause dies with the disposable VM. Bounded, and
# never allowed to mask the original failure.
collect_guest_diagnostics() {
  timeout --kill-after=10 "${PAPERCUSP_CANDIDATE_DIAG_TIMEOUT:-90}" \
    bash "$VMCTL" ssh "$VM" 'bash -s' >"$RUN_DIR/guest-diagnostics.log" 2>&1 <<'DIAG'
echo "## PAPERCUSP_GUEST_DIAGNOSTICS $(date -u +%FT%TZ)"
echo "## packages"; dpkg-query -W -f='${Package} ${Version} ${db:Status-Abbrev}\n' 'papercusp-*' 2>&1
echo "## systemctl --user status"; systemctl --user status papercusp-server.service --no-pager -l 2>&1 | head -80
echo "## user journal"; journalctl --user -u papercusp-server.service -b --no-pager -o short-iso 2>&1 | tail -400
echo "## system journal (user unit)"; sudo -n journalctl _SYSTEMD_USER_UNIT=papercusp-server.service -b --no-pager -o short-iso 2>&1 | tail -400
echo "## papercusp home"; ls -la "$HOME/.papercusp" 2>&1 | head -80
for f in "$HOME"/.papercusp/logs/*.log "$HOME/papercusp-relaunch.log"; do
  [[ -f "$f" ]] || continue; echo "## tail $f"; tail -n 120 "$f" 2>&1
done
DIAG
}
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$VM_STARTED" == 1 ]]; then
    collect_guest_diagnostics \
      || echo "candidate-install-upgrade-rollback: WARNING — guest diagnostics incomplete (see $RUN_DIR/guest-diagnostics.log)" >&2
  fi
  if [[ "$VM_STARTED" == 1 ]]; then
    if ! timeout --kill-after=30 "${PAPERCUSP_CANDIDATE_VM_DOWN_TIMEOUT:-180}" bash "$VMCTL" down "$VM"; then
      echo "candidate-install-upgrade-rollback: WARNING — failed to power down $VM" >&2
      [[ "$status" -ne 0 ]] || status=1
    fi
  fi
  if [[ "$status" -eq 0 ]]; then
    rm -rf -- "$RUN_DIR"
  else
    # Preserve the exact child stdout/stderr even when the verifier fails before
    # emitting JSON. Temporary cleanup must not erase the cause of a slow run.
    python3 - "$RUN_DIR/failure.json" "$status" "$PHASE" "$VM" "$CANDIDATE_SHA" "$BASELINE_SHA" <<'PY'
import datetime, json, pathlib, sys
out, status, phase, vm, candidate, baseline = sys.argv[1:]
pathlib.Path(out).write_text(json.dumps({
    "schemaVersion": 1, "kind": "candidate-install-upgrade-rollback-evidence",
    "verdict": "FAIL", "exitCode": int(status), "phase": phase, "vm": vm,
    "candidateBuildSha": candidate, "baselineBuildSha": baseline,
    "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}, indent=2) + "\n")
PY
    echo "candidate-install-upgrade-rollback: failed phase=$PHASE exit=$status; diagnostics=$RUN_DIR" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

echo "candidate-install-upgrade-rollback: resetting disposable Linux VM '$VM'"
VM_STARTED=1
timeout --kill-after=30 "${PAPERCUSP_CANDIDATE_VM_RESET_TIMEOUT:-180}" bash "$VMCTL" reset "$VM"
timeout --kill-after=30 "${PAPERCUSP_CANDIDATE_VM_UP_TIMEOUT:-300}" bash "$VMCTL" up "$VM"
timeout --kill-after=30 "$(( ${PAPERCUSP_CANDIDATE_VM_SSH_TIMEOUT:-300} + 30 ))" \
  bash "$VMCTL" wait-ssh "$VM" "${PAPERCUSP_CANDIDATE_VM_SSH_TIMEOUT:-300}"

echo "candidate-install-upgrade-rollback: installing exact rollback baseline $BASELINE_SHA"
PHASE=baseline-install
timeout --kill-after=30 "${PAPERCUSP_CANDIDATE_INSTALL_TIMEOUT:-2400}" bash "$VMCTL" install "$VM" "$BASELINE_SERVER"
timeout --kill-after=30 "${PAPERCUSP_CANDIDATE_INSTALL_TIMEOUT:-2400}" bash "$VMCTL" install "$VM" "$BASELINE_GUI"
baseline_script="$(release_artifacts_linux_smoke_baseline_start_script \
  | sed "s/BASELINE_BUDGET/${PAPERCUSP_CANDIDATE_BASELINE_START_TIMEOUT:-900}/g")"
printf '%s\n' "$baseline_script" \
  | timeout --kill-after=30 "$(( ${PAPERCUSP_CANDIDATE_BASELINE_START_TIMEOUT:-900} + 360 ))" \
      bash "$VMCTL" ssh "$VM" 'bash -s'

# Run one guest script (stdin) and print its output. The caller decides from
# the reported line, never from the guest's exit status alone.
guest() {
  timeout --kill-after=30 "${PAPERCUSP_CANDIDATE_GUEST_PROBE_TIMEOUT:-300}" \
    bash "$VMCTL" ssh "$VM" 'bash -s'
}

# The OLD client, before anything replaces it: what does its updater tell the
# user when the release host baked into it no longer serves it?
PHASE=old-client-update-check
probe_status=0
probe_output="$(legacy_client_recovery_update_probe_script "$BASELINE_VERSION" | guest)" || probe_status=$?
printf '%s\n' "$probe_output" >"$RUN_DIR/old-client-update-check.out"
UPDATE_VERDICT="$(legacy_client_recovery_update_verdict "$probe_output")" || true
case "$UPDATE_VERDICT" in
  not-silent) ;;
  missing-report)
    echo "candidate-install-upgrade-rollback: the old client's update check reported nothing for both products (guest exit $probe_status): $probe_output" >&2
    exit 1 ;;
  *)
    if [[ "$LEGACY_HOST_UNAVAILABLE" == 1 ]]; then
      echo "candidate-install-upgrade-rollback: old client update check: $UPDATE_VERDICT while its release host is asserted unavailable: $probe_output" >&2
      exit 1
    fi
    echo "candidate-install-upgrade-rollback: WARNING — old client update check: $UPDATE_VERDICT (recorded; its release host was not asserted unavailable)" >&2 ;;
esac

# User data both flips must keep: seeded on the old client, checked after each.
PHASE=user-data-seed
NONCE="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
seed_status=0
seed_output="$(legacy_client_recovery_seed_script "$NONCE" | guest)" || seed_status=$?
SEED_LINE="$(grep -E '^PAPERCUSP_USER_DATA_SEEDED ' <<<"$seed_output" | tail -1 || true)"
[[ "$SEED_LINE" == "PAPERCUSP_USER_DATA_SEEDED nonce=$NONCE "* ]] || {
  echo "candidate-install-upgrade-rollback: user data could not be seeded on the old client (guest exit $seed_status): $seed_output" >&2
  exit 1
}
printf '%s\n' "$SEED_LINE" >"$RUN_DIR/user-data-seed.line"

check_user_data() {
  local leg="$1" output status=0 line verdict
  PHASE="user-data-$leg"
  output="$(legacy_client_recovery_check_script "$NONCE" "$leg" | guest)" || status=$?
  line="$(grep -E '^PAPERCUSP_USER_DATA_CHECK ' <<<"$output" | tail -1 || true)"
  verdict="$(legacy_client_recovery_data_verdict "$SEED_LINE" "$line")" || true
  printf '%s\t%s\t%s\n' "$leg" "$verdict" "$line" >>"$RUN_DIR/user-data-checks.tsv"
  if [[ "$verdict" != preserved ]]; then
    echo "candidate-install-upgrade-rollback: user data not preserved after $leg: $verdict (guest exit $status): ${line:-$output}" >&2
    return 1
  fi
}

# run_leg <name> <gui> <server> <sha> <version> [extra verifier args...]
run_leg() {
  local name="$1"
  local gui="$2" server="$3" sha="$4" version="$5"
  shift 5
  local output="$RUN_DIR/$name.json"
  local stderr_output="$RUN_DIR/$name.stderr.log" verifier_status=0
  PHASE="$name"
  echo "candidate-install-upgrade-rollback: running $name verifier for $sha (install timeout ${PAPERCUSP_CANDIDATE_INSTALL_TIMEOUT:-2400}s)"
  if "$VERIFIER" \
    --platform linux --artifact "$gui" --server-artifact "$server" \
    --expected-sha "$sha" --expected-version "$version" \
    --install-timeout "${PAPERCUSP_CANDIDATE_INSTALL_TIMEOUT:-2400}" \
    --ssh-port "$SSH_PORT" --ssh-key "$SSH_KEY" --ssh-host "$SSH_HOST" \
    --ssh-option StrictHostKeyChecking=no \
    --ssh-option UserKnownHostsFile=/dev/null \
    --scp-option StrictHostKeyChecking=no \
    --scp-option UserKnownHostsFile=/dev/null "$@" --json >"$output" 2>"$stderr_output"; then
    :
  else
    verifier_status=$?
    cat "$stderr_output" >&2
    cat "$output" >&2
    echo "candidate-install-upgrade-rollback: $name verifier exited $verifier_status" >&2
    return "$verifier_status"
  fi
  python3 - "$output" "$sha" "$version" <<'PY'
import json, pathlib, sys
result = json.loads(pathlib.Path(sys.argv[1]).read_text())
expected_sha, expected_version = sys.argv[2:]
checks = {
    "ok": result.get("ok") is True,
    "flipped": result.get("flipped") is True,
    "portHeld": result.get("portHeld") is True,
    "shaAfter": result.get("shaAfter") == expected_sha,
    "versionAfter": result.get("versionAfter") == expected_version,
}
failed = [name for name, passed in checks.items() if not passed]
if failed:
    print(f"verifier receipt failed {failed}: {json.dumps(result, sort_keys=True)}", file=sys.stderr)
    raise SystemExit(1)
PY
}

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
run_leg candidate-upgrade "$CANDIDATE_GUI" "$CANDIDATE_SERVER" "$CANDIDATE_SHA" "$CANDIDATE_VERSION"
check_user_data candidate-upgrade
# The rollback reinstalls an OLDER package over the candidate; only this leg
# opts the verifier into a downgrade, so a mis-versioned upgrade still fails.
run_leg exact-baseline-rollback "$BASELINE_GUI" "$BASELINE_SERVER" "$BASELINE_SHA" "$BASELINE_VERSION" --allow-downgrade
check_user_data exact-baseline-rollback

# Emit evidence only after both flips pass and the VM powers down cleanly.
PHASE=vm-shutdown
timeout --kill-after=30 "${PAPERCUSP_CANDIDATE_VM_DOWN_TIMEOUT:-180}" bash "$VMCTL" down "$VM"
VM_STARTED=0
PHASE=evidence
mkdir -p "$(dirname "$EVIDENCE_OUT")"
python3 - "$EVIDENCE_OUT" "$started_at" "$VM" "$SSH_HOST" "$SSH_PORT" \
  "$CANDIDATE_GUI" "$CANDIDATE_SERVER" "$CANDIDATE_SHA" "$CANDIDATE_VERSION" \
  "$BASELINE_GUI" "$BASELINE_SERVER" "$BASELINE_SHA" "$BASELINE_VERSION" \
  "$RUN_DIR/candidate-upgrade.json" "$RUN_DIR/exact-baseline-rollback.json" \
  "$RUN_DIR" "$UPDATE_VERDICT" "$LEGACY_HOST_UNAVAILABLE" "$NONCE" <<'PY'
import datetime, hashlib, json, os, pathlib, sys
(out, started, vm, host, port, candidate_gui, candidate_server, candidate_sha,
 candidate_version, baseline_gui, baseline_server, baseline_sha, baseline_version,
 candidate_result, rollback_result, run_dir, update_verdict, host_unavailable,
 nonce) = sys.argv[1:]
run = pathlib.Path(run_dir)
def artifact(path):
    p = pathlib.Path(path).resolve()
    data = p.read_bytes()
    return {"path": str(p), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
def read_json(path):
    return json.loads(pathlib.Path(path).read_text())
def fields(line):
    return dict(part.split("=", 1) for part in line.split()[1:] if "=" in part)
def signature(row):
    name, exit_code, raw = row.split("\t", 2)
    try:
        verdict = json.loads(raw)
    except ValueError:
        verdict = {"valid": False, "error": raw}
    return {"artifact": name, "valid": verdict.get("valid") is True,
            "keyId": verdict.get("keyId"), "exitCode": int(exit_code)}
def report(line):
    row = fields(line)
    status = row.get("status", "")
    return {"product": row.get("product"), "status": int(status) if status.isdigit() else status,
            "check": row.get("check"), "reason": row.get("reason")}
def data_check(row):
    phase, verdict, line = row.split("\t", 2)
    return {"phase": phase, "verdict": verdict, "line": line}
lines = lambda name: [l for l in (run / name).read_text().splitlines() if l.strip()]
legacy = {
    "baselineSourceSha": baseline_sha,
    "trustedKeySha256": hashlib.sha256((run / "trusted-pubkey").read_bytes()).hexdigest(),
    "signatures": [signature(row) for row in lines("signatures.tsv")],
    "updateCheck": {
        "verdict": update_verdict,
        "hostUnavailableAsserted": host_unavailable == "1",
        "reports": [report(l) for l in lines("old-client-update-check.out")
                    if l.startswith("PAPERCUSP_LEGACY_UPDATE_CHECK ")],
    },
    "userData": {
        "nonce": nonce,
        "seed": lines("user-data-seed.line")[0],
        "checks": [data_check(row) for row in lines("user-data-checks.tsv")],
    },
}
doc = {
    "schemaVersion": 2,
    "kind": "candidate-install-upgrade-rollback-evidence",
    "verdict": "PASS",
    "platform": "linux",
    "vm": vm,
    "target": {"sshHost": host, "sshPort": int(port)},
    "candidate": {
        "buildSha": candidate_sha, "version": candidate_version,
        "gui": artifact(candidate_gui), "server": artifact(candidate_server),
        "upgrade": read_json(candidate_result),
    },
    "rollbackTarget": {
        "buildSha": baseline_sha, "version": baseline_version,
        "gui": artifact(baseline_gui), "server": artifact(baseline_server),
        "rollback": read_json(rollback_result),
    },
    "legacyClient": legacy,
    "window": {
        "startedAt": started,
        "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    },
}
target = pathlib.Path(out)
target.parent.mkdir(parents=True, exist_ok=True)
tmp = target.with_name(target.name + f".tmp.{os.getpid()}")
tmp.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
tmp.replace(target)
PY
echo "candidate-install-upgrade-rollback: PASS; receipt=$EVIDENCE_OUT"
