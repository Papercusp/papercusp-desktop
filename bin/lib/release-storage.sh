#!/usr/bin/env bash
# Private GCS release storage. Public visibility belongs to the delivery Worker.
# Reused by desktop, mobile, history, instructions and PUI publishers.

release_storage_init() {
  local config="${PAPERCUSP_RELEASE_STORAGE_ENV:-$HOME/.papercusp/release-storage.env}"
  if [[ -f "$config" ]]; then
    set -a; . "$config"; set +a
  fi
  [[ "${PAPERCUSP_RELEASE_GCS_BUCKET:-}" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || {
    echo 'release-storage: configure PAPERCUSP_RELEASE_GCS_BUCKET in release-storage.env.' >&2; return 1;
  }
  command -v gcloud >/dev/null && command -v python3 >/dev/null || {
    echo 'release-storage: gcloud and python3 are required.' >&2; return 1;
  }
}

release_storage_uri() {
  local key="$1"
  [[ -n "$key" && "$key" != /* && "$key" != *'?'* && "$key" != *'#'* &&
    "$key" != *'['* && "$key" != *']'* && "$key" != *'*'* && "$key" != *'\\'* &&
    "$key" != *$'\n'* && "$key" != *$'\r'* ]] || return 2
  case "/$key/" in */../*|*/./*|*//*) return 2 ;; esac
  printf 'gs://%s/%s\n' "$PAPERCUSP_RELEASE_GCS_BUCKET" "$key"
}

# 44 means provider-confirmed absence. Authentication/transport failures are 1.
release_storage_describe() {
  local key="$1" out="$2" uri err rc
  uri="$(release_storage_uri "$key")" || return $?
  err="$(mktemp)" || return 1
  if gcloud storage objects describe "$uri" --raw --format=json >"$out" 2>"$err"; then
    rm -f "$err"; return 0
  else
    rc=1
    if rg -q 'HTTPError 404\b|not found: 404\.' "$err"; then rc=44; fi
    rm -f "$err"; return "$rc"
  fi
}

release_storage_field() {
  python3 - "$1" "$2" <<'PY'
import json, sys
value = json.load(open(sys.argv[1]))
for field in sys.argv[2].split('.'):
    value = value.get(field) if isinstance(value, dict) else None
if value is not None: print(value)
PY
}

release_storage_sha256() { sha256sum "$1" | cut -d' ' -f1; }

release_storage_get() {
  local key="$1" out="$2" metadata rc generation uri part
  metadata="$(mktemp)" || return 1
  if release_storage_describe "$key" "$metadata"; then :; else
    rc=$?; rm -f "$metadata"; return "$rc"
  fi
  generation="$(release_storage_field "$metadata" generation)"
  [[ "$generation" =~ ^[0-9]+$ ]] || { rm -f "$metadata"; return 1; }
  uri="$(release_storage_uri "$key")" || { rm -f "$metadata"; return 1; }
  part="$(mktemp "${out}.XXXXXX")" || { rm -f "$metadata"; return 1; }
  if gcloud storage cat "$uri#$generation" >"$part" 2>/dev/null &&
    [[ "$(wc -c < "$part" | tr -d ' ')" == "$(release_storage_field "$metadata" size)" ]]; then
    mv -f "$part" "$out"; rc=0
  else rc=1; fi
  rm -f "$part" "$metadata"; return "$rc"
}

release_storage_state() {
  local key="$1" file="$2" metadata rc sha size remote
  metadata="$(mktemp)" || { echo metadata-unavailable; return; }
  if release_storage_describe "$key" "$metadata"; then :; else
    rc=$?; rm -f "$metadata"
    if [[ "$rc" == 44 ]]; then echo absent; else echo metadata-unavailable; fi
    return
  fi
  size="$(wc -c < "$file" | tr -d ' ')"
  if [[ "$(release_storage_field "$metadata" size)" != "$size" ]]; then
    rm -f "$metadata"; echo differs; return
  fi
  sha="$(release_storage_field "$metadata" metadata.sha256)"
  rm -f "$metadata"
  if [[ "$sha" =~ ^[a-f0-9]{64}$ ]]; then
    if [[ "$sha" == "$(release_storage_sha256 "$file")" ]]; then echo identical; else echo differs; fi
    return
  fi
  # Legacy objects need generation-pinned byte comparison, never a size/ETag guess.
  remote="$(mktemp)" || { echo metadata-unavailable; return; }
  if release_storage_get "$key" "$remote"; then
    if cmp -s "$file" "$remote"; then echo identical; else echo differs; fi
  else echo metadata-unavailable; fi
  rm -f "$remote"
}

release_storage_put() {
  local file="$1" key="$2" type="${3:-}" cache="${4:-no-cache, max-age=0}" mode="${5:-mutable}"
  local metadata generation=0 rc uri sha
  local -a headers=()
  [[ "$mode" == immutable || "$mode" == mutable ]] || return 2
  uri="$(release_storage_uri "$key")" || return $?
  metadata="$(mktemp)" || return 1
  if release_storage_describe "$key" "$metadata"; then
    generation="$(release_storage_field "$metadata" generation)"
    if [[ "$mode" == immutable ]]; then
      rm -f "$metadata"
      [[ "$(release_storage_state "$key" "$file")" == identical ]] && return 0
      echo 'release-storage: refusing different or unverified bytes at an immutable key.' >&2; return 1
    fi
  else
    rc=$?
    [[ "$rc" == 44 ]] || { rm -f "$metadata"; echo 'release-storage: remote state unknown; refusing write.' >&2; return 1; }
  fi
  rm -f "$metadata"
  [[ "$generation" =~ ^[0-9]+$ ]] || return 1
  sha="$(release_storage_sha256 "$file")" || return 1
  [[ -z "$type" ]] || headers+=("--content-type=$type")
  # A lost response is reconciled by reading this same key; never retry a write.
  gcloud storage cp "$file" "$uri" "--if-generation-match=$generation" \
    "--custom-metadata=sha256=$sha" "--cache-control=$cache" "${headers[@]}" --quiet >/dev/null 2>&1 || :
  [[ "$(release_storage_state "$key" "$file")" == identical ]] || {
    echo 'release-storage: write did not reconcile to the admitted bytes.' >&2; return 1;
  }
}

release_storage_tree() {
  local dir="${1%/}" prefix="${2%/}" type="${3:-}" file
  [[ -d "$dir" ]] || return 1
  while IFS= read -r -d '' file; do
    release_storage_put "$file" "$prefix/${file#"$dir/"}" "$type" || return 1
  done < <(find "$dir" -type f -print0)
}

release_storage_delete() {
  local key="$1" metadata generation uri rc
  metadata="$(mktemp)" || return 1
  if release_storage_describe "$key" "$metadata"; then :; else
    rc=$?; rm -f "$metadata"; [[ "$rc" == 44 ]]; return $?
  fi
  generation="$(release_storage_field "$metadata" generation)"; rm -f "$metadata"
  [[ "$generation" =~ ^[0-9]+$ ]] || return 1
  uri="$(release_storage_uri "$key")" || return $?
  gcloud storage rm "$uri" "--if-generation-match=$generation" --quiet >/dev/null 2>&1
}
