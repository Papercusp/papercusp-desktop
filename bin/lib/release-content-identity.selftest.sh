#!/usr/bin/env bash
# release-content-identity.selftest.sh — guards the release journal's INPUT.
#
# release-content-identity.js produces the object release-task-journal.ts hashes
# into a stage's inputHash. A receipt is reusable exactly while that hash still
# matches, so every property below is an invalidation rule in disguise:
#
#   1. a platform is REQUIRED and must be known        (no receipt keyed to nothing)
#   2. two platforms never share an identity           (the bug that made only the
#                                                       Linux leg journallable)
#   3. the same inputs always produce the same bytes   (or nothing would ever reuse)
#   4. the toolchain is captured                       (rustc/cargo/node/npm)
#   5. a policy-file change invalidates                (the gate rules changed)
#   6. the BUILDER's own digest is in the policy set   (the rules' definition changed)
#   7. a missing policy file fails CLOSED, by name     (never a silent partial identity)
#
#   bash bin/lib/release-content-identity.selftest.sh   # exit 0 = PASS, 1 = FAIL
#
# Hermetic: a synthetic workspace/desktop fixture under mktemp, no network, no
# real release inputs. It does shell out to rustc/cargo/node/npm for the real
# toolchain strings (that is what the builder captures), and SKIPs if absent.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# Overridable so a falsifiability probe can point this at a MUTATED COPY outside
# the tree, instead of mutating the shared checkout (where git-sync would commit
# the mutant mid-probe). scripts/mutation-probe.sh --file <builder> --test
# 'PAPERCUSP_CONTENT_IDENTITY_BUILDER={} bash …/release-content-identity.selftest.sh'
BUILDER="${PAPERCUSP_CONTENT_IDENTITY_BUILDER:-$HERE/release-content-identity.js}"

command -v node >/dev/null 2>&1 || { echo "SKIP: node unavailable"; exit 0; }
for tool in rustc cargo npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "SKIP: $tool unavailable (the builder captures it)"; exit 0; }
done
[[ -f "$BUILDER" ]] || { echo "✗ builder missing: $BUILDER"; exit 1; }

FAILS=0
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }
good() { echo "  ✓ $*"; }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TMP_ROOT"' EXIT
W="$TMP_ROOT/workspace"
D="$W/papercusp-desktop"

# A synthetic tree carrying exactly the inputs the builder binds.
mkdir -p "$W/node_modules" "$W/content-bundles/workspace-host" "$D/src-tauri" "$D/bin/lib"
SRC_HEX="$(printf 'papercusp-selftest-source' | sha256sum | cut -d' ' -f1)"
printf 'identity=v1-%s\nsource=%s\n' "$SRC_HEX" "$SRC_HEX" \
  > "$W/node_modules/.papercusp-dependency-generation"
printf '{"lockfileVersion":3}\n' > "$W/package-lock.json"
printf '{"lockfileVersion":3,"installed":true}\n' > "$W/node_modules/.package-lock.json"
printf 'bundle: workspace-host\n' > "$W/content-bundles/workspace-host/bundle.yaml"
printf '{"contract":"v1"}\n' > "$D/src-tauri/distribution-contract.json"
printf '{"productName":"papercusp"}\n' > "$D/src-tauri/tauri.conf.json"
printf '# Cargo.lock\nversion = 4\n' > "$D/src-tauri/Cargo.lock"
printf '#!/usr/bin/env bash\n# models\n' > "$D/bin/lib/transformers-models.sh"
printf '#!/usr/bin/env python3\n# scanner\n' > "$D/bin/audit-release-bundle.py"
printf '#!/usr/bin/env bash\n# provenance\n' > "$D/bin/verify-provenance.sh"
printf '// freshness\n' > "$D/bin/check-sidecar-freshness.js"

identity() { # <platform> — prints the identity JSON, or nothing on failure
  node "$BUILDER" "$W" "$D" "$@" 2>/dev/null
}
field() { # <json> <node-expression over `i`>
  node -e 'const i=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2" 2>/dev/null
}

# 0-CONTROL: the fixture must actually BUILD. Every assertion below compares
# identities, and two empty strings compare equal — so without this control a
# broken fixture would make checks 2/3/5 all "pass" while measuring nothing.
LINUX="$(identity linux-x86_64)"
if [[ -z "$LINUX" ]]; then
  echo "  ✗ CONTROL: the fixture produced no identity at all — every comparison below would be vacuous"
  node "$BUILDER" "$W" "$D" linux-x86_64 2>&1 | head -3
  echo "release-content-identity self-test: 1 FAILED"
  exit 1
fi
good "CONTROL: fixture builds a linux-x86_64 identity ($(printf '%s' "$LINUX" | wc -c) bytes)"

# 1) a platform is REQUIRED, and must be one the repo actually ships.
node "$BUILDER" "$W" "$D" >/dev/null 2>&1 \
  && bad "an ABSENT platform was accepted — that receipt would be keyed to nothing" \
  || good "absent platform refused"
node "$BUILDER" "$W" "$D" solaris-sparc >/dev/null 2>&1 \
  && bad "an UNKNOWN platform was accepted" \
  || good "unknown platform refused"

# 2) two platforms must never share an identity. This is the regression that
#    kept receipts Linux-only: the builder used to hardcode platform.
ARM="$(identity linux-aarch64)"
WIN="$(identity windows-x86_64)"
if [[ -z "$ARM" || -z "$WIN" ]]; then
  bad "CONTROL: a non-Linux platform produced no identity — check 2 measured nothing"
elif [[ "$LINUX" == "$ARM" || "$LINUX" == "$WIN" || "$ARM" == "$WIN" ]]; then
  bad "two platforms produced the SAME identity — their receipts would collide"
else
  good "linux-x86_64 / linux-aarch64 / windows-x86_64 identities are all distinct"
fi

# 3) determinism — unchanged inputs must reuse, so the bytes must be stable.
AGAIN="$(identity linux-x86_64)"
[[ "$LINUX" == "$AGAIN" ]] \
  && good "identical inputs produce identical bytes (reuse is reachable)" \
  || bad "the identity is UNSTABLE across two calls — nothing would ever reuse"

# 4) the toolchain is captured, non-empty, per field.
for f in rustc cargo node npm; do
  v="$(field "$LINUX" "i.toolchain.$f")"
  [[ -n "$v" && "$v" != "undefined" ]] \
    && good "toolchain.$f captured ($v)" \
    || bad "toolchain.$f is missing — a toolchain change would not invalidate a receipt"
done

# 5) a policy-file change must invalidate. Same platform, one gate rewritten.
printf '{"contract":"v1","changed":true}\n' > "$D/src-tauri/distribution-contract.json"
CHANGED="$(identity linux-x86_64)"
if [[ -z "$CHANGED" ]]; then
  bad "CONTROL: the identity failed to build after a policy edit — check 5 measured nothing"
elif [[ "$CHANGED" == "$LINUX" ]]; then
  bad "a policy-file change did NOT change the identity — stale receipts would survive a rule change"
else
  good "a policy-file change invalidates the identity"
fi
printf '{"contract":"v1"}\n' > "$D/src-tauri/distribution-contract.json"

# 6) the builder's OWN digest is in the policy set. Without it, changing what an
#    identity MEANS leaves every receipt minted under the old meaning reusable.
BUILDER_SHA="$(sha256sum "$BUILDER" | cut -d' ' -f1)"
RECORDED="$(field "$LINUX" 'i.policy.files.identityBuilder')"
[[ "$RECORDED" == "$BUILDER_SHA" ]] \
  && good "policy.files.identityBuilder is the builder's real sha256" \
  || bad "policy.files.identityBuilder is '$RECORDED', expected $BUILDER_SHA"

# 7) a missing policy input fails CLOSED and NAMES what is missing — a partial
#    identity would hash cleanly and silently widen what counts as reusable.
mv "$D/bin/verify-provenance.sh" "$D/bin/verify-provenance.sh.hidden"
ERR="$(node "$BUILDER" "$W" "$D" linux-x86_64 2>&1 >/dev/null)"
RC=$?
mv "$D/bin/verify-provenance.sh.hidden" "$D/bin/verify-provenance.sh"
if [[ "$RC" -eq 0 ]]; then
  bad "a MISSING policy file still produced an identity — the gate set is not actually bound"
elif [[ "$ERR" != *provenanceVerifier* ]]; then
  bad "the failure did not name the missing input (got: $ERR)"
else
  good "a missing policy file fails closed and names provenanceVerifier"
fi

# 8) the schema version must be the one the journal's receipts were minted under.
SCHEMA="$(field "$LINUX" 'i.schemaVersion')"
[[ "$SCHEMA" == "3" ]] \
  && good "schemaVersion is 3" \
  || bad "schemaVersion is '$SCHEMA', expected 3 — bump it deliberately when the shape changes"

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "release-content-identity self-test: ALL PASS"
  exit 0
else
  echo "release-content-identity self-test: $FAILS FAILED"
  exit 1
fi
