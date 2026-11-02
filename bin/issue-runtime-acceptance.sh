#!/usr/bin/env bash
# Run on the canonical ledger host after the exact final package set is graded.
# The output pair travels beside those frozen packages, never inside them.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
[[ $# == 4 ]] || { echo 'usage: bash issue-runtime-acceptance.sh NODE ISSUER_SERVE REQUEST OUTPUT' >&2; exit 2; }
issuer_node="$1"; issuer_serve="$2"; request="$3"; output="$4"
[[ ! -e "$output" && ! -e "$output.sig" ]] || { echo 'eligibility output already exists; use a new edition path' >&2; exit 1; }
"$issuer_node" "$issuer_serve" --issue-runtime-acceptance "$request" "$output"
source "$HERE/lib/inno-spanned-server.sh"
papercusp_sign_release_artifact "$output" || { echo 'eligibility signing refused; unsigned output has no authority' >&2; exit 1; }
pubkey="$(node -e 'process.stdout.write(require(process.argv[1]).plugins.updater.pubkey)' "$HERE/../src-tauri/tauri.conf.json")"
node "$HERE/verify-tauri-signature.mjs" "$pubkey" "$output" "$output.sig" --json
