#!/usr/bin/env bash
# cargo-target-root.sh — the ONE answer to "where does Cargo write build output?"
#
# SOURCE this, then call:
#
#   papercusp_cargo_target_root <cargo-project-dir>
#       non-empty CARGO_TARGET_DIR if exported (Cargo honours it first), else
#       what Cargo itself reports for <cargo-project-dir>.
#   papercusp_cargo_metadata_target_dir <cargo-project-dir>
#       what Cargo reports, IGNORING an exported CARGO_TARGET_DIR (for callers
#       that have already handled an explicit override themselves).
#
# Both print an absolute path with no trailing newline, or return non-zero with
# a diagnostic on stderr. Neither ever GUESSES a directory.
#
# WHY THIS EXISTS (WI-10003499; same class as EI-22589688521091797)
# ~/.cargo/config.toml pins one shared `build.target-dir` for the box, and on
# 2026-09-03 (WI-212675) it moved from ~/.cargo-target to /mnt/data/cargo-target.
# Scripts that defaulted with `${CARGO_TARGET_DIR:-$HOME/.cargo-target}` kept
# looking in the OLD place. The build still succeeded — it wrote the .deb to the
# configured target — and the caller then reported "emitted no fresh .deb". Or
# worse, it picked up a stale package that happened to sit at the old path.
# Cargo's own `target_directory` already folds in CARGO_BUILD_TARGET_DIR,
# CARGO_HOME, and every project/user .cargo/config.toml. So ask Cargo, never a
# hard-coded name. test/cargo-target-root.test.js holds the class guard.

papercusp_cargo_metadata_target_dir() {
  local project="${1:-}"
  if [[ -z "$project" ]]; then
    echo "ERROR: papercusp_cargo_metadata_target_dir needs a Cargo project directory" >&2
    return 2
  fi
  # python3, not node (WI-10005239): build managers run these scripts with a
  # minimal PATH (/usr/bin:/bin). Callers add CARGO_HOME/bin for cargo itself,
  # but node lives outside /usr/bin on the build hosts, so a node helper died
  # with exit 127 before Cargo was ever asked. /usr/bin/python3 is present on
  # every Linux build host that sources this file.
  local py
  py="$(command -v python3 || true)"
  if [[ -z "$py" ]]; then
    echo "ERROR: cannot resolve Cargo target directory for $project — python3 not found on PATH ($PATH); refusing to guess a different filesystem" >&2
    return 1
  fi
  "$py" - "$project" <<'PY'
import json, os, subprocess, sys
project = sys.argv[1]
env = dict(os.environ)
# The caller already honored a non-empty explicit override. An exported empty
# value must not hide Cargo's configuration during this read-only resolution.
env.pop('CARGO_TARGET_DIR', None)
try:
    proc = subprocess.run(['cargo', 'metadata', '--no-deps', '--format-version', '1'],
                          cwd=project, env=env, stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or f'cargo metadata exited {proc.returncode}')
    target = json.loads(proc.stdout).get('target_directory')
    if not isinstance(target, str) or not os.path.isabs(target):
        raise RuntimeError('Cargo metadata did not return an absolute target_directory')
    sys.stdout.write(target)
except Exception as error:  # noqa: BLE001 — every failure is a refusal, never a guess
    sys.stderr.write(f'ERROR: cannot resolve Cargo target directory for {project} — refusing to guess a different filesystem: {str(error)[:1200]}\n')
    sys.exit(1)
PY
}

papercusp_cargo_target_root() {
  if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
    printf '%s' "$CARGO_TARGET_DIR"
    return 0
  fi
  papercusp_cargo_metadata_target_dir "${1:-}"
}

# Cargo caches build-script metadata as well as compiled code. Tauri permission
# metadata contains absolute OUT_DIR paths; moving/copying a target directory
# does not invalidate those paths. Rebuild affected current-graph producers
# through Cargo before a consumer proc-macro reads their generated files.
papercusp_prepare_cargo_generated_paths() {
  local project="${1:?Cargo project directory required}" target
  target="$(papercusp_cargo_target_root "$project")" || return $?
  python3 - "$project" "$target" <<'PY'
import json, os, re, subprocess, sys
from pathlib import Path

project = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2])
target = (target if target.is_absolute() else project / target).resolve()
if not target.is_dir():
    sys.exit(0)
try:
    stale = set()
    outputs = set(target.glob('*/build/*/output')) | set(target.glob('*/*/build/*/output'))
    for output in sorted(outputs):
        for line in output.read_text(errors='replace').splitlines():
            payload = line.removeprefix('cargo::metadata=').removeprefix('cargo:metadata=')
            if '=' not in payload:
                continue
            key, value = payload.split('=', 1)
            if not key.endswith(('PERMISSION_FILES_PATH', 'GLOBAL_SCOPE_SCHEMA_PATH')):
                continue
            path = Path(value)
            # Source-owned paths are valid inputs; only generated build output
            # is bound to a Cargo target root.
            if not path.is_absolute() or '/build/' not in value or '/out/' not in value:
                continue
            if path.resolve().is_relative_to(target):
                continue
            match = re.fullmatch(r'([A-Za-z0-9_-]+)-[0-9a-f]{16}', output.parent.name)
            if not match:
                raise RuntimeError('cannot attribute relocated generated metadata to a Cargo package')
            stale.add(match.group(1))
    if not stale:
        sys.exit(0)
    metadata = subprocess.run(
        ['cargo', 'metadata', '--locked', '--offline', '--format-version', '1'],
        cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    if metadata.returncode:
        raise RuntimeError(metadata.stderr or 'Cargo dependency graph unavailable')
    packages = [p for p in json.loads(metadata.stdout)['packages'] if p['name'] in stale]
    if not packages:
        sys.exit(0)  # stale output belongs to a different workspace's graph
    command = ['cargo', 'clean', '--manifest-path', str(project / 'Cargo.toml'),
               '--target-dir', str(target)]
    for package in sorted(packages, key=lambda p: p['id']):
        command.extend(['-p', package['id']])
    cleaned = subprocess.run(command, cwd=project, stdin=subprocess.DEVNULL,
                             capture_output=True, text=True, timeout=120)
    if cleaned.returncode:
        raise RuntimeError(cleaned.stderr or 'Cargo package invalidation failed')
    print(f'cargo-generated-paths: invalidated {len(packages)} current dependency package(s) with relocated output metadata')
except Exception as error:
    sys.stderr.write(f'ERROR: Cargo generated-path preflight failed before compilation: {str(error)[:1200]}\n')
    sys.exit(1)
PY
}
