#!/usr/bin/env python3
"""audit-release-bundle.py — WI-4419. The release bundle's LAST GATE.

Answers ONE question about the thing we are actually about to ship: does it
contain anything that must never leave this machine?

WHY IT SCANS THE ARTIFACT AND NOT THE REPO
------------------------------------------
A source-tree scan would have PASSED on the 0.0.8 cut. The repo was clean; the
leak only came into existence when bin/stage-source-tree.sh tarred the working
tree and swept up 53,225 UNTRACKED files — including 121 agent session
transcripts (.papercusp/pi-sessions/*.jsonl) carrying the operator's home path in
every record. So the gate runs against the built artifact, after the tar, or it
is measuring the wrong object.

WHY IT MUST SCAN CONTENT, NOT JUST PATHS
----------------------------------------
The mac Server bundle leaked the owner's home path in the CONTENT of 7 files and
an email in 1 — with nothing in the filenames and no credentials anywhere. A
path-only scan passes that bundle. Absolute build paths get baked into vendored
trees constantly (.bin shims, sourcemaps, .package-lock.json, compile caches), so
node_modules is exactly where machine identity hides — it is scanned, not skipped.

WHY IDENTITY IS A SET OF LITERALS
---------------------------------
"Personal information" here means THIS BUILD BOX: its unix user, its home path,
its hostname, its git identity. Those are literal strings, resolved at run time,
so a build on anyone's machine scrubs THAT machine. Deliberately NOT a generic
email/name regex: that matches a maintainer address in every vendor package.json,
and a gate that cries wolf on every build is a gate someone switches off.

PERFORMANCE — why this shells out instead of using Python's tarfile
-------------------------------------------------------------------
Streaming the 9GB tar through Python's tarfile took >18 minutes. `zstd -dc | tar
-tf -` over the same bytes takes 23 SECONDS: the cost was ~50x Python interpreter
overhead, not the data. So the hot paths are C (zstd | tar | grep) and Python only
decides. A slow gate gets disabled, which makes it worse than no gate.

Three phases, cheapest first:
  A. PATHS    — `tar -tf` (~25s). Forbidden dirs/files, identity in filenames.
  B. CONTENT  — `tar -xO | grep` (~1-3min). Identity literals + credential values.
  C. ATTRIBUTE— only if B found something: the slow per-file pass, to name the
                offending files. A failing build can afford the minutes; a
                passing one cannot.

Exit 0 clean · 1 findings (build MUST fail) · 2 unscannable (also fatal — an
unscannable bundle is not a clean one). Never prints a secret VALUE.

Usage:  audit-release-bundle.py <path/to/source.tar.zst>
"""
import fnmatch
import os
import pwd
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import zipfile

# ── PATH rules — the class that actually bit us: a scratch/state dir sweeping in
# wholesale. Cheap, and applied to every member name.
#
# EACH RULE CARRIES ITS OWN TAR GLOBS, and `--tar-excludes` prints them for
# bin/stage-source-tree.sh to consume. That coupling is the point. These rules
# used to exist TWICE — once here as regexes, once in the stager as a hand-kept
# tar --exclude list — and two hand-maintained copies of the same knowledge drift
# by construction: the stager's list is a postmortem log (cargo-target added after
# it blew up 0.0.5, .next after it tripled 0.0.8) and it had never heard of
# .papercusp/, which is how 121 agent transcripts shipped. Now a new rule teaches
# BOTH the thing that excludes it and the thing that catches it if the exclude
# misses. A rule with no globs (identity/credential content) is gate-only.
#
# The globs are GNU tar's --no-anchored dialect, where `*` matches `/`: the `*/X`
# form catches X at ANY depth (packages/operator-core/.papercusp), which the
# top-level allowlist cannot — the junk is nested INSIDE apps/ and packages/,
# and some of it is git-TRACKED (a .gitignore anchoring bug, fixed by su-a1a71).
FORBIDDEN_PATH = [
    ("agent-transcripts", re.compile(r"(^|/)pi-sessions/|(^|/)sessions/.*\.jsonl$"),
     ["pi-sessions"]),
    # `.papercusp` AND its siblings (`.papercusp-tmp`, `.papercusp-workspaces`): a
    # rule anchored on `.papercusp/` alone MISSED packages/operator-core/.papercusp-tmp/
    # — a node compile-cache full of this box's absolute paths, nested inside an
    # allowlisted dir, i.e. exactly the shape of the original leak.
    ("papercusp-state-dir", re.compile(r"(^|/)\.papercusp(-[a-z-]+)?/"),
     [".papercusp", ".papercusp-*"]),
    # Editor swap/backup files. A tracked `.agent-action-registry-plan.md.swp` was
    # sitting in apps/operator/docs — a binary vim swap holding whatever the author
    # last had in the buffer. Never source, never shippable.
    ("editor-swapfile", re.compile(r"(^|/)\.?[^/]*\.(swp|swo|swn)$|(^|/)[^/]*~$"),
     ["*.swp", "*.swo", "*.swn", "*~"]),
    # node-gyp build scaffolding. A compiled native module needs exactly ONE thing
    # at runtime — its addon binary, build/Release/*.node. Everything node-gyp
    # leaves beside it (Makefile, binding.Makefile, config.gypi, *.target.mk, the
    # Release/.deps/*.o.d dependency lists, Release/obj.target/ objects) records
    # this box's ABSOLUTE paths verbatim, and is needed only to RE-build, never to
    # run. That is what failed the 0.0.13 cut: 587 hits on /home/<user> across 22
    # files under node_modules/{ssh2,cpu-features}. The sidecar copy is pruned at
    # assembly (build-desktop-sidecar.sh), but source.tar.zst ships node_modules
    # too — the SAME residue by a second route — so the rule belongs here, where
    # the exclude and the gate that catches a missed exclude stay one rule.
    # Scoped to the scaffolding ONLY: no glob here can match build/Release/*.node.
    ("node-gyp-build-scaffolding",
     re.compile(r"(^|/)build/(Makefile|binding\.Makefile)$"
                r"|(^|/)build/.*\.(mk|gypi)$"
                r"|(^|/)build/Release/(\.deps|obj\.target|obj)/"),
     # BARE globs — print_tar_excludes() adds the `./X` and `*/X` forms itself, and
     # `*` matches `/`, so `*/build/*.mk` also reaches build/deps/**/x.target.mk.
     ["build/Makefile", "build/binding.Makefile", "build/config.gypi",
      "build/*.mk", "build/*.gypi",
      "build/Release/.deps", "build/Release/obj.target", "build/Release/obj"]),
    # ssh2's OPTIONAL native crypto accelerator (sshcrypto.node). Unlike the
    # scaffolding above, THIS is the addon binary — but node-gyp compiles it on
    # this box and the compiler bakes the build-box home path into a .rodata
    # __FILE__ string (/home/<user>/.cache/node-gyp/<ver>/include/node/node_object_wrap.h,
    # from an assert() macro). That is a CONTENT leak: phase B catches it (grep -a
    # over all bytes), but phase C cannot ATTRIBUTE it (the member is binary — NUL in
    # the first 4KB) and the stager's sed scrub cannot REDACT it (source_leakers skips
    # binaries), so exclusion is the only mechanism that reaches it (this failed the
    # 0.0.13 cut AFTER the scaffolding rule above cleared the path scan). Safe to drop:
    # ssh2 wraps `require('.../sshcrypto.node')` in try/catch and falls back to pure-JS
    # crypto when it is absent (node_modules/ssh2/lib/protocol/crypto.js). Scoped to
    # THIS addon BY NAME on purpose — better-sqlite3 / cpu-features addons are
    # needed-and-clean and MUST ship (better-sqlite3 has NO JS fallback), so this is
    # deliberately NOT the build/Release/*.node class the rule above preserves.
    # FOLLOW-UP (durable class fix, not release-blocking): compile native addons with
    # -ffile-prefix-map / a neutral node-gyp cache dir so __FILE__ never captures the
    # box path — that would remove the leak at the source for ALL addons.
    ("ssh2-native-crypto-addon",
     re.compile(r"(^|/)sshcrypto\.node$"),
     ["sshcrypto.node"]),
    ("scratch-or-tmp", re.compile(r"(^|/)(scratch|scratchpad|test-results|\.agent-tmp|\.vitest-tmp|\.tmp|\.tmp-[^/]*|\.pcv-socktest|\.nx|__pycache__|docs\.old\.[0-9]+|\.vite|\.vite-temp)/|(^|/)(junit\.xml|\.modules\.yaml)$"),
     ["scratch", "scratchpad", "test-results", ".agent-tmp", ".vitest-tmp", ".tmp",
      ".tmp-*", ".pcv-socktest", ".nx", "__pycache__", "docs.old.*",
      # Vite's dep-optimizer cache bakes the absolute build path into every dep it
      # pre-bundles; junit.xml carries the build hostname. Both are build output.
      ".vite", ".vite-temp", "junit.xml",
      # pnpm's metadata file. npm never reads it, and it is a map of absolute paths
      # into a store that does not exist on any other machine (WI-4427).
      ".modules.yaml"]),
    ("agent-config", re.compile(r"(^|/)(\.claude|\.harness)/"),
     [".claude", ".harness"]),
    # Internal fleet-coordination artifacts: briefs agents write to each other, and
    # the plan/handoff notes beside them. Nobody we hand a build to needs these, and
    # they are AGENT-AUTHORED CONTINUOUSLY — a new brief naming a box path lands every
    # day. Scrubbing them one by one would make this gate a treadmill that reds every
    # cut; excluding the class ends it. (apps/operator-docs is PARTLY product docs and
    # DOES ship — but not wholesale: its internal build-infra sections are excluded by
    # the "internal-infra-docs" rule below, which is the WI-4723 creds leak. Do not read
    # this rule as blessing the whole operator-docs tree.)
    ("internal-agent-artifacts", re.compile(r"(^|/)(agent-briefs|docs/plans)/"),
     ["agent-briefs", "docs/plans"]),
    # Dev-box ops infra: the systemd unit/timer templates under
    # apps/operator/scripts/systemd/ are for THIS build box's services (kopia
    # backups, the db-backup alerter, the mcp-proxy / inference-gateway units,
    # …). They are never installed by — nor needed to RUN — the shipped Tauri
    # desktop app, and several bake this box's absolute paths
    # (ExecStart=/home/<owner>/.config/kopia/…, WI-4419) that the release audit
    # forbids. EXCLUDE the class (D-004, desktop-v0-0-12): the source-scrub
    # convention is redact-must-ship / EXCLUDE-never-ship, and a dev ops unit is
    # never-ship — excluding it (vs redacting its paths, which would break it as a
    # dev unit) is the root-cause fix and keeps a future unit that names a box path
    # from re-redding the cut.
    ("dev-systemd-units", re.compile(r"(^|/)scripts/systemd/"),
     ["scripts/systemd"]),
    # Test files never ship in — nor are needed to RUN — the product: no runtime
    # code imports a *.test.* / __tests__/ module (verified across apps+libs+
    # packages). They are pure bulk in source.tar.zst, and a handful embed identity
    # literals AS TEST DATA (D-004: carry-surface-provenance-stamp.test.ts asserts
    # on `[owner:Avi]` linting; bash-resource-gate/coord-hook assert the
    # `loginctl terminate-user <user>` literal) that MUST NOT be scrubbed — doing so
    # rewrites the assertion and reds the green gate. So the correct handling is
    # EXCLUDE-from-ship, not redact: the tests keep their literals in the tree (green
    # gate stays green) and simply never reach any shipped bundle (tar, AppImage
    # AppDir, mac .app). Excluding the CLASS (not the 5 current leakers) ends the
    # treadmill — the next test that names an identity can never leak into a cut.
    ("test-files",
     re.compile(r"(^|/)__tests__/|(^|/)[^/]+\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$"),
     ["__tests__",
      "*.test.ts", "*.test.tsx", "*.test.mts", "*.test.cts",
      "*.test.js", "*.test.jsx", "*.test.mjs", "*.test.cjs",
      "*.spec.ts", "*.spec.tsx", "*.spec.mts", "*.spec.cts",
      "*.spec.js", "*.spec.jsx", "*.spec.mjs", "*.spec.cjs"]),
    ("vcs", re.compile(r"(^|/)\.git/"),
     [".git"]),
    ("dotenv", re.compile(r"(^|/)\.env(\.|$)"),
     [".env", ".env.*"]),
    ("shell-rc", re.compile(r"(^|/)\.(bashrc|bash_profile|bash_history|profile|zshrc|zprofile)$"),
     [".bashrc", ".bash_profile", ".bash_history", ".profile", ".zshrc", ".zprofile"]),
    ("credential-file", re.compile(r"(^|/)(\.npmrc|\.netrc|\.git-credentials|\.gitconfig|\.mcp\.json.*)$"),
     [".npmrc", ".netrc", ".git-credentials", ".gitconfig", ".mcp.json", ".mcp.json.*"]),
    ("credential-dir", re.compile(r"(^|/)(\.ssh|\.aws|\.gnupg)/"),
     [".ssh", ".aws", ".gnupg"]),
    ("console-turd", re.compile(r"(^|/)\.papercup-console-active\."),
     [".papercup-console-active.*"]),
    ("next-build-cache", re.compile(r"(^|/)\.next/"),
     [".next"]),
    # Any tool's build cache (storybook, babel, eslint, …). These are generated on
    # THIS box and bake its absolute paths into their artifacts — every one of the
    # 8 `/home/<owner>` hits in the 0.0.8-era bundle came from
    # */node_modules/.cache/storybook/**/manager-bundle.js. Nothing in a .cache/ is
    # needed to RUN the tree (it exists to make the next BUILD faster), so this is
    # a leak class we delete rather than scrub.
    ("build-cache", re.compile(r"(^|/)\.cache/"),
     [".cache"]),
    # Pagefind search-index shards (apps/*/dist/**/pagefind/index/*.pf_index,
    # apps/operator/public/**/pagefind/**, apps/operator-docs/dist/pagefind/**).
    # Pagefind TOKENISES the docs it indexes into these binary shards — the
    # 0.0.9 cut red'd here on `\bAvi\b` ×3, the owner's own git user.name, baked
    # into en_143e775.pf_index because an internal doc names them (WI-4419). The
    # shipping markdown itself was clean; only the generated index carried it, and
    # a .pf_fragment shard would likewise carry the raw home-path of any doc that
    # cites one. Nothing SERVER-side reads these (client docs-search loads them in
    # the browser from the built static output; the docs markdown still renders and
    # search just returns empty until pagefind is re-run) — a generated, regenerable,
    # not-needed-to-RUN artifact that leaks indexed content, i.e. the .cache/ class:
    # we delete it, we do not scrub it. Scoped to the .pf_* extensions so the
    # pagefind NPM TOOL (node_modules/pagefind) and dist package-mains are untouched.
    ("pagefind-search-index", re.compile(r"\.pf_(index|fragment|meta)$"),
     ["*.pf_index", "*.pf_fragment", "*.pf_meta"]),
    # Internal engineering-docs infra sections — must NOT ship in a PUBLIC desktop
    # bundle (su-a1a71 decision 2026-07-13, WI-4419). apps/operator-docs is the
    # "Papercusp Internal" Starlight site (astro.config title), served at
    # /internal/docs: its build-system/** section documents the build-VM SSH/sudo
    # creds + admin commands + port maps, and four agent-insights runbooks document
    # the mac-VM QMP recovery / notarization / e2e pipeline. These shipped in the
    # 0.0.8 bundle carrying the mac VM's ACTUAL sudo password ('aviweiss') and
    # loginwindow password ('avraham') — a real public credential leak (owner is
    # rotating). Per-secret scrubbing is whack-a-mole that re-leaks the instant
    # someone pastes the real ssh target back in; EXCLUDING the internal-infra doc
    # CLASS is the root-cause fix. The SAME content is also inlined into the
    # llms-full.txt / llms-small.txt AGGREGATE bundles (an "llms.txt" concat of the
    # whole docs site) which a section-exclude alone can't clean — so those drop too.
    # Every leaking file lives under one of these shapes across ALL of
    # src/content/docs, dist/, and the served apps/operator/public/internal/docs
    # copy (verified: this set == the entire aviweiss/avraham footprint in shipping
    # paths). build-desktop-sidecar.sh:720's docs-qa copy inherits the exclusion
    # (it copies FROM the already-staged source). (The two vendored
    # node_modules/*/llms-full.txt this also drops — stream-json, stream-chain — are
    # npm `files`-array docs, NOT `exports`/`main` runtime entries, so dropping them
    # breaks nothing.) NONE of these basenames/dirs collide with a vendored RUNTIME
    # entry (checked: no build-system/ dir and no runbook basename in node_modules).
    # NB build-system has BOTH a build-system/ subtree AND a build-system.{html,md}
    # section LANDING page (Astro renders a section index as a sibling file) — the
    # dir glob prunes the subtree, the .html/.md globs catch the landing twin.
    #
    # DURABILITY (0.0.9 cut#3c ARRIVES, su-a1a71 named the residual): a per-file
    # name list is a treadmill — cut#3c's bundle still shipped two creds-FREE mac-VM
    # runbooks the named set had never heard of (copying-artifacts-off-the-mac-vm,
    # macos-ppid-1-is-not-an-orphan-signal — both disclose the mac VM alias
    # papercup-vm-mac + loopback:2222; no passwords, but internal build topology that
    # must not ship). So beyond naming those two, a basename glob `*mac-vm*` catches
    # ANY current-or-future agent-insights runbook about the mac build VM with no new
    # edit each time (it subsumes mac-vm-qmp-recovery / mac-vm-e2e-battery, kept
    # explicit as the known-critical plaintext-password file). We deliberately do NOT
    # blanket `macos-*`: a real PRODUCT doc could legitimately name macOS, so the two
    # known build-infra macos-* runbooks are listed by name, not by prefix.
    ("internal-build-infra-docs",
     re.compile(r"(^|/)build-system(/|\.(html|md)$)"
                r"|(^|/)(mac-vm-qmp-recovery|mac-vm-e2e-battery"
                r"|macos-signing-notarization-runbook"
                r"|macos-ppid-1-is-not-an-orphan-signal"
                r"|copying-artifacts-off-the-mac-vm"
                r"|federation-public-release-known-limitations"
                r"|agent-insights-index)\.(mdx|md|html)$"
                r"|(^|/)[^/]*mac-vm[^/]*\.(mdx|md|html)$"
                r"|(^|/)(llms-full|llms-small)\.txt$"),
     ["build-system", "build-system.html", "build-system.md",
      "mac-vm-qmp-recovery.*", "mac-vm-e2e-battery.*",
      "macos-signing-notarization-runbook.*",
      "macos-ppid-1-is-not-an-orphan-signal.*",
      "copying-artifacts-off-the-mac-vm.*",
      "*mac-vm*.mdx", "*mac-vm*.md", "*mac-vm*.html",
      "federation-public-release-known-limitations.*",
      "agent-insights-index.*",
      "llms-full.txt", "llms-small.txt"]),
    # Astro's content-collection build cache (apps/operator-docs/node_modules/.astro/
    # data-store.json): Astro serialises EVERY doc's rendered content into this store
    # at build time, so it inlines the same build-system creds the docs exclusion
    # above removes — and it is a regenerable build cache (the .cache/.vite class),
    # never read to RUN the tree. Delete, don't scrub. (Nested under node_modules,
    # so the top-level allowlist can't reach it — this rule can.)
    ("astro-build-cache", re.compile(r"(^|/)\.astro/"),
     [".astro"]),
    # Rust/Cargo build target dirs (apps/tui/target, apps/pui-*/target,
    # libs/**/src-tauri/target, …) at ANY depth. A cargo target bakes THIS build
    # box's absolute home path into .rustc_info.json, the *.d dep-files and the
    # release binaries — the 0.0.9 mac leg leaked /Users/<owner> ×8075 out of
    # apps/tui/target/ and this gate red'd the cut (WI-4419). The size-class
    # `./target` in stage-source-tree.sh only anchors the MONO ROOT, so a nested
    # crate target sailed straight through.
    #
    # GLOBS ARE DELIBERATELY EMPTY (gate-only) — the ONE rule in this file that
    # cannot self-emit its own exclude. print_tar_excludes() would turn a `target`
    # glob into `./target` + `*/target`, and `*/target` drops
    # node_modules/weapon-regex/core/target/ — a VENDORED package's RUNTIME entry
    # (its package.json `exports` resolve to ./core/target/js-3/weapon-regex-opt/
    # main.js), silently corrupting the shipped toolchain. So the EXCLUDE is
    # generated node_modules-SAFELY in stage-source-tree.sh (find real cargo targets
    # OUTSIDE any node_modules); THIS rule is the fast path-phase backstop that fires
    # only if that exclude ever misses, and the content identity scan is the ultimate
    # backstop. The regex is likewise node_modules-scoped so weapon-regex's legit
    # target/ (and any nested-node_modules vendored target) never trips it.
    ("cargo-build-target",
     re.compile(r"^(?!.*(?:^|/)node_modules/)(?:.*/)?target/"),
     []),
]

# ── CONTENT: real credential VALUES (grep -E, C speed). Not the word "secret".
#
# The phx_/phc_ rules absorb bin/audit-bundle.sh, which was a SEPARATE "privacy
# auditor" release-local.sh already ran on the finished .deb/.dmg — and which
# could never have caught this leak: it greps the EXTRACTED bundle, where
# source.tar.zst is still a single zstd blob. It was structurally blind to the
# 2.7 GB of plaintext inside it. One gate, every leak class, both objects.
CREDENTIAL_ERE = [
    ("anthropic-key", r"\bsk-ant-(api|oat)[0-9]{2}-[A-Za-z0-9_-]{40,}"),
    ("openai-key", r"\bsk-(proj-)?[A-Za-z0-9]{40,}"),
    ("github-token", r"\bgh[pousr]_[A-Za-z0-9]{36,}"),
    # The VALUE must look like an AWS secret (40 chars of the key alphabet), not
    # merely "30+ non-space chars after an =". The loose form matched wrangler's
    # own JavaScript — `aws_secret_access_key === …typeof` — and our OWN
    # secret-scrubber's pattern list: the gate was convicting secret-DETECTION code
    # of being a secret. A gate that cries wolf is a gate that gets an exception
    # added to shut it up, which is the failure it exists to prevent.
    ("aws-secret-key", r"aws_secret_access_key[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9/+]{40}"),
    ("slack-token", r"\bxox[abprs]-[A-Za-z0-9-]{20,}"),
    # PostHog: phx_ is a WRITE-side personal key (the one that must never ship);
    # phc_ is an anonymous-capture project key — see BENIGN for the one we ship.
    ("posthog-personal-key", r"\bphx_[A-Za-z0-9_]{30,}"),
    ("posthog-project-key", r"\bphc_[A-Za-z0-9_]{30,}"),
]

# Documented false positives, each one traced to a real file. This is NOT a
# parking lot for findings you would rather not deal with: every entry names the
# thing it is silencing, and if you cannot name it, it is not benign — it is
# unclassified, and an unclassified finding fails the build.
BENIGN_ERE = [
    r"AKIAIOSFODNN7EXAMPLE",                        # AWS's own doc placeholder
    r"sk-ant-(api|oat)[0-9]{2}-(test|fake|dummy|example)",
    # @octokit/auth-token/README.md — the docs' own fake tokens
    r"gh[pousr]_(PersonalAccessToken|InstallationUserToServer|InstallallationOrActionToken)",
    # The ONE deliberately-public key every build ships (posthog-public-defaults.ts):
    # anonymous-capture only, cannot read events. Shipping it is the feature.
    # ⚠ ROTATION SYNC (WI-5013 0.0.11 cut red, 2026-07-15): this literal exists in
    # THREE places that must move together — posthog-public-defaults.ts (the shipped
    # value), bin/audit-bundle.sh PUBLIC_PROJECT_KEY, and HERE. The 2026-07 rotation
    # updated the first two and missed this one, redding the next cut on our own
    # public key. When rotating: update all three in the same change.
    r"phc_nm3LSXkJKynGzsGTZfwqUywbrfsryNNNVWrxHy7Kriug",
    # Third-party vendors' OWN public anon keys, compiled into their npm packages:
    # mem0ai/dist/* and lost-pixel/dist/constants.js. Not our secrets, and not ours
    # to rotate. (That these libraries carry live telemetry keys at all is a real
    # product-privacy question — filed separately — but it is not a leak OF OURS,
    # and failing our release build on a vendor's key would teach agents to ignore
    # this gate.)
    r"phc_hgJkUVJFYtmaJqrvf6CYN67TIQ8yhXAkWzUn9AMU4yX",
    r"phc_RDNnzvANh1mNm9JKogF9UunG3Ky02YCxWP9gXScKShk",
]


# Attribution reads whole members into memory to regex them. Phase B has already
# convicted the bundle by this point, so a member too big to attribute costs us a
# file NAME, never a missed leak — the build fails either way.
MAX_ATTRIBUTE_BYTES = 8 * 1024 * 1024


# ── KNOWN SENSITIVE IDENTITIES — the cross-identity blind spot fix (WI-4419).
#
# identity_literals() below resolves ONLY the box RUNNING the build. On a
# multi-box release that is a hole the size of the release: the LINUX leg hunts
# its own 'marsh-office' and is blind to the mac VM's 'aviweiss'; the mac leg
# hunts 'aviweiss' and is blind to 'marsh-office'; a value owned by NEITHER box
# (the mac loginwindow password 'avraham') is hunted by nobody. That blind spot
# is exactly how the 0.0.8 mac bundle shipped the mac VM's sudo password
# ('aviweiss') and login password ('avraham') to the public while every leg's
# per-box audit passed. So these literals are hunted on EVERY build regardless of
# which box runs it — the fixed backstop beneath the per-box scan. All are
# high-entropy by construction (≥7 chars / contain '-'), so they hunt EVERYWHERE
# incl node_modules as plain substrings (never the bare-first-name word-boundary
# path). This is a DENYLIST OF KNOWN LEAKED IDENTITIES — each entry a real value
# that has leaked or would leak cross-box — NOT a generic name regex, so it does
# not cry wolf on a vendor package.json maintainer field.
KNOWN_SENSITIVE_IDENTITIES = {
    "known-sensitive:mac-vm-user": "aviweiss",           # mac VM unix user AND its sudo password
    "known-sensitive:mac-vm-login": "avraham",           # mac VM loginwindow password
    "known-sensitive:linux-build-user": "marsh-office",  # linux build-box unix user
}


# ── STAGING SCRUB (WI-4419 durable; desktop-v0-0-12-release-tri-platform#D-004).
# Dev-infra and agent-authored SOURCE keep re-introducing this box's identity into
# must-ship files — [owner:Avi] provenance comments in prod .ts/.sql, dev systemd
# ExecStart=/home/<user> paths, test fixtures hardcoding the build username. Those
# files cannot be pruned (they ship / run), and a per-file source edit is a
# treadmill that reds the next cut the moment a new tag lands. So bin/stage-source-
# tree.sh redacts these literals in a COPY of each leaking source file at tar time
# (a --transform overlay, streaming — never the working tree, never node_modules).
# The literal→placeholder map lives HERE, next to the identities it neutralises, so
# the stager derives it from --identity-literals and cannot drift (the same ONE-rule
# discipline as --tar-excludes). Keyed by identity KEY (stable across build boxes),
# NOT value. A value with no explicit token falls back to "redacted".
# This does NOT weaken the gate: the gate still fails on any UN-redacted identity in
# the produced bytes — the scrub removes the leak, it does not hide it.
REDACTION_BY_KEY = {
    "build-user-name": "builduser",
    "build-home-path": "/home/builduser",
    "build-hostname": "buildhost",
    "build-git-email": "owner@example.invalid",
    "build-git-name": "owner",
    "known-sensitive:mac-vm-user": "macuser",
    "known-sensitive:mac-vm-login": "maclogin",
    "known-sensitive:linux-build-user": "builduser",
}


def identity_literals():
    """Machine identity as LITERAL strings, resolved from the box doing the build."""
    lits = {}
    try:
        user = pwd.getpwuid(os.getuid()).pw_name
        if user and user not in ("root", "runner", "build", "ubuntu"):
            lits["build-user-name"] = user
    except Exception:
        pass
    home = os.path.expanduser("~")
    if home and home not in ("/root", "/", "/home"):
        lits["build-home-path"] = home
    host = socket.gethostname()
    if host and not host.startswith(("runner", "ci-", "localhost")):
        lits["build-hostname"] = host
    for key, cfg in (("build-git-email", "user.email"), ("build-git-name", "user.name")):
        try:
            v = subprocess.run(["git", "config", "--get", cfg], capture_output=True,
                               text=True, timeout=5).stdout.strip()
            if v:
                lits[key] = v
        except Exception:
            pass
    return lits


def needs_word_boundary(lit):
    """A SHORT literal must match as a whole word or it matches half the bundle.

    The owner's git user.name here is literally "Avi" — the exact thing they asked
    us to keep out of a public build ("my name is avi on this machine"). An earlier
    cut of this gate skipped any literal under 4 chars, which silently made the
    owner's own example the ONE identity it could not catch. Substring-matching
    "Avi" instead would fire on every .avi/AVI/Avicenna in vendored code and get
    the gate switched off, so short literals match case-sensitively on a word
    boundary: \\bAvi\\b hits "Avi Weiss", not "video.avi".
    """
    return len(lit) < 6 and lit.isalnum()


def lit_ere(lit):
    """The ERE this identity literal is searched with (GNU grep supports \\b)."""
    return rf"\b{re.escape(lit)}\b" if needs_word_boundary(lit) else re.escape(lit)


def is_low_entropy(lit):
    """A literal so short/common that VENDOR code hits it by coincidence.

    Same set as needs_word_boundary — a bare first name. \\bAvi\\b is necessary but
    not sufficient: node_modules/natural ships an English POS lexicon in which
    "Avi" is a dictionary entry, and @huggingface/transformers' README credits a
    DIFFERENT REAL PERSON named Avi. Both are word-boundary hits and neither is
    our owner.
    """
    return needs_word_boundary(lit)


def is_vendor(name):
    """Third-party code — we did not write it, so our box's identity cannot have
    ORIGINATED in it.

    This is the scoping rule for low-entropy literals ONLY. A high-entropy literal
    (/home/<owner>, the username, the hostname, an email, a credential) is still
    hunted EVERYWHERE including node_modules — those genuinely do leak into vendor
    trees, baked in by a build running on this box, and that is exactly where the
    real 0.0.8 home-path hits were found. What we refuse to do is convict a vendor
    dictionary of containing the owner's first name.

    Our own workspace packages are symlinked under node_modules, but they are also
    present at their real path (libs/, packages/, apps/), where they ARE scanned —
    so nothing we authored escapes the name check by hiding here.
    """
    n = name.lstrip("./")
    return n.startswith("node_modules/") or "/node_modules/" in n


def lit_rx(lit):
    return re.compile(lit_ere(lit))


def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)


def phase_a_paths(bundle, lits):
    """Member names. ~25s for 444k members."""
    r = sh(f"zstd -dc {q(bundle)} | tar -tf -")
    if r.returncode != 0:
        print(f"AUDIT ERROR: cannot list bundle: {r.stderr.strip()[:300]}", file=sys.stderr)
        sys.exit(2)
    names = r.stdout.splitlines()
    hits = []
    for name in names:
        for rule, rx, _globs in FORBIDDEN_PATH:
            if rx.search(name):
                hits.append((rule, name))
                break
        else:
            for rule, lit in lits.items():
                if lit_rx(lit).search(name):
                    hits.append((rule + " (in path)", name))
                    break
    return len(names), hits


def phase_b_content(bundle, lits):
    """Concatenated content through C grep. No filenames — that is phase C's job.

    TWO passes, because the needles have different trustworthiness:
      • BROAD  — credentials + high-entropy identity, over the WHOLE bundle.
                 A hit in node_modules is real: only a build on this box could
                 have put it there.
      • NARROW — low-entropy identity (a bare first name), over OUR SOURCE ONLY.
                 Vendored dictionaries and third-party READMEs are full of common
                 first names that are not our owner.
    """
    rev = {v: k for k, v in lits.items()}
    benign = " ".join(f"-e {q(b)}" for b in BENIGN_ERE)

    def scan(pats, tar_flags=""):
        if not pats:
            return []
        grep = f"grep -aoE {' '.join(f'-e {q(p)}' for p in pats)}"
        cmd = (f"zstd -dc {q(bundle)} | tar {tar_flags} -xOf - | {grep} "
               f"| grep -avE {benign} | sort | uniq -c | sort -rn")
        return [l.strip() for l in sh(cmd).stdout.splitlines() if l.strip()]

    broad = [p for _, p in CREDENTIAL_ERE]
    broad += [lit_ere(v) for v in lits.values() if not is_low_entropy(v)]
    narrow = [lit_ere(v) for v in lits.values() if is_low_entropy(v)]

    # GNU tar --exclude applies to extraction too; * spans '/' by default.
    vendor_excl = "--exclude='./node_modules/*' --exclude='*/node_modules/*'"

    found = []
    for line in scan(broad) + scan(narrow, vendor_excl):
        n, _, val = line.partition(" ")
        val = val.strip()
        rule = rev.get(val)
        if rule is None:
            for name, pat in CREDENTIAL_ERE:
                if re.fullmatch(pat.replace("[[:space:]]", r"\s"), val):
                    rule = name
                    break
        found.append((rule or "credential-or-identity", int(n), val))
    return found


def phase_c_attribute(bundle, lits, wanted, per_rule=8):
    """Only on a failing build: name the offending files. Slow, and that is fine.

    Attribution MUST convict with the same regex phase B convicted with (lit_ere)
    — never a raw substring. It used to search for the bare bytes `Avi`, and the
    result was a gate that was RIGHT and USELESS at the same time: the verdict
    counted 10 real `\\bAvi\\b` hits, but the file list blamed 40 innocent vendor
    files (`AVIF` in sharp's image code, `KAviBO` inside a base64 sourcemap) and
    then hit its 200-file scan cap — so not one of the 10 real offenders was ever
    printed. That is the most dangerous state a gate can be in: a red build whose
    evidence is visibly nonsense is what teaches an engineer to reach for an
    exception instead of the leak.

    Counting is therefore per RULE, not one global cap — a noisy rule must never
    be able to starve a quiet one out of the report.
    """
    # (rule, regex, vendor_scoped) — the SAME scoping phase B convicted with, or the
    # diagnosis would name files the verdict never counted (and vice versa).
    needles = [(rule, re.compile(lit_ere(val).encode()), is_low_entropy(val))
               for rule, _n, val in wanted]
    found = {}
    proc = subprocess.Popen(["bash", "-c", f"zstd -dc {q(bundle)} | cat"], stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            for m in tf:
                if not m.isfile() or m.size > MAX_ATTRIBUTE_BYTES:
                    continue
                f = tf.extractfile(m)
                if f is None:
                    continue
                blob = f.read()
                if b"\0" in blob[:4096]:
                    continue
                vendor = is_vendor(m.name)
                for rule, rx, scoped in needles:
                    if scoped and vendor:
                        continue
                    if rx.search(blob):
                        g = found.setdefault(rule, {"n": 0, "files": []})
                        g["n"] += 1
                        if len(g["files"]) < per_rule:
                            g["files"].append(m.name)
    finally:
        proc.stdout.close()
        proc.wait()
    return found


def q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"


def redact(v):
    return f"{v[:8]}…{v[-4:]} (len {len(v)})" if len(v) > 16 else f"{v[:3]}… (len {len(v)})"


def print_tar_excludes():
    """The stager's exclude list, DERIVED from the gate's rules — never re-typed.

    Emits both the `./X` (mono root) and `*/X` (any depth) forms, GNU tar's
    proven idiom in this repo. Nested is the half the top-level allowlist cannot
    do: the junk lives inside apps/ and packages/, and some of it is git-tracked.
    """
    for _rule, _rx, globs in FORBIDDEN_PATH:
        for g in globs:
            print(f"./{g}")
            print(f"*/{g}")
    return 0


def _rule_rx(name):
    """The compiled regex of one FORBIDDEN_PATH rule — the single source of truth
    a non-tar caller (the sidecar prune below) reuses so it can NEVER drift from
    what the release audit itself forbids."""
    for rule, rx, _globs in FORBIDDEN_PATH:
        if rule == name:
            return rx
    print(f"AUDIT ERROR: no FORBIDDEN_PATH rule named {name!r}", file=sys.stderr)
    sys.exit(2)


#: FORBIDDEN_PATH rules the sidecar prune applies. Both are LEAK CLASSES that the
#: tar-exclude path already strips from source.tar.zst but which reach the sidecar
#: by a different route, so both must be re-applied here.
SIDECAR_PRUNE_RULES = ("internal-build-infra-docs", "pagefind-search-index")


def prune_docs(dirs, rules=SIDECAR_PRUNE_RULES):
    """Delete generated leak-classes from an ASSEMBLED (un-staged) docs tree.

    Why this exists: the stager's --tar-excludes only filters source.tar.zst. The
    desktop sidecar's two doc copies (build-desktop-sidecar.sh: rendered
    public/internal/docs, and the source .mdx tree for docs-qa grounding) are
    pulled from the LIVE monorepo tree and bypass that exclude entirely — so the
    in-build audit, which scans source.tar.zst, is structurally blind to them, and
    0.0.9 shipped the mac VM's sudo/login passwords inside the sidecar while every
    leg's source audit passed CLEAN (WI-4419 follow-up). Prune the SAME paths the
    release audit forbids, using the gate's OWN rules as the single source of
    truth — no second list to drift.

    ⚠ WHY `pagefind-search-index` IS IN THAT SET (WI-37620, and it is a REGRESSION
    of a leak this file already documents): this function applied ONLY the
    internal-build-infra-docs rule, so the pagefind shards under the sidecar's
    internal-docs/ shipped unpruned. tar-excludes strips them from source.tar.zst,
    which is exactly the blind spot this function exists to cover — and it was left
    half-covered. The 0.0.14 cut then red'd on the owner's bare git user.name baked
    into internal-docs/pagefind/index/en_7148dd0.pf_index — the SAME literal in the
    SAME artifact class that red'd the 0.0.9 cut. Note the source markdown is clean:
    zero shipping .mdx contains that name standalone, so pruning docs alone could
    never have fixed it — only the generated INDEX carries the indexed word.
    """
    rxs = [_rule_rx(name) for name in rules]

    def _forbidden(rel_path):
        return any(rx.search(rel_path) for rx in rxs)

    for root in dirs:
        if not os.path.isdir(root):
            print(f"    prune-docs: {root} absent — skipping")
            continue
        removed = []
        for dirpath, dirnames, filenames in os.walk(root, topdown=True):
            keep = []
            for d in dirnames:
                rel = os.path.relpath(os.path.join(dirpath, d), root)
                # test dirs WITH a trailing slash so `.../build-system/` hits the
                # rule's `(^|/)build-system/` alternative and the whole subtree goes.
                if _forbidden(rel.replace(os.sep, "/") + "/"):
                    shutil.rmtree(os.path.join(dirpath, d), ignore_errors=True)
                    removed.append(rel + "/")
                else:
                    keep.append(d)
            dirnames[:] = keep
            for fn in filenames:
                rel = os.path.relpath(os.path.join(dirpath, fn), root)
                if _forbidden(rel.replace(os.sep, "/")):
                    os.remove(os.path.join(dirpath, fn))
                    removed.append(rel)
        print(f"    prune-docs: {root} — removed {len(removed)} internal-infra path(s)")
        for r in sorted(removed):
            print(f"        - {r}")
    return 0


# Archives whose CONTENTS are invisible to a byte-level grep: the payload is
# compressed, so a plaintext identity literal inside is simply not present in the
# file's bytes. `grep -a` fixes binary files; only expansion fixes these.
# `.dump` is here because pg_dump's custom format is zlib-compressed internally.
ARCHIVE_SUFFIXES = (
    ".tar.zst", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz", ".tar",
    ".zip", ".jar", ".asar", ".gz", ".zst", ".bz2", ".xz", ".dump",
)


def _iter_archives(dirs):
    """Every archive file under the scanned roots, as absolute paths."""
    for root in dirs:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                low = fn.lower()
                if low.endswith(ARCHIVE_SUFFIXES):
                    yield os.path.join(dirpath, fn)


def _expand_tar_memberwise(path, dest):
    """Read a tar by MEMBER, never by path.

    `tarfile.extractall` MATERIALISES member paths, so one member whose link
    escapes the destination makes the whole call raise — Python >=3.12's default
    `data` filter is right to refuse it. But "I refused to write this member" is
    not "I could not read these bytes", and conflating the two is expensive: a
    vendored security FIXTURE (tar-fs ships test/fixtures/invalid.tar, a tar whose
    links deliberately escape the root) halted the 0.0.14 release at minute 22 of
    a 22-minute cut on an archive whose bytes are perfectly readable (WI-37620).

    Reading members individually needs no path TRUST at all: only regular-file
    payloads are written, under a SANITISED relative path ('/', '.' and '..'
    components dropped), so nothing lands outside dest and no link is ever
    followed — strictly safer than extractall, not a relaxation of it. The
    sanitised path deliberately keeps the member's own name, because the caller
    reports findings as `archive!member` and "some archive is dirty" is not
    actionable. Member NAMES and link targets additionally go into a manifest, so
    an identity literal embedded in a member's PATH is scanned too: coverage
    extractall never had, because the scan greps file CONTENTS and a materialised
    directory name is not content.

    Returns False when a payload genuinely cannot be read — unknown is not absent.
    """
    os.makedirs(dest, exist_ok=True)
    names = []
    with tarfile.open(path) as tf:
        for idx, member in enumerate(tf):
            names.append(member.name)
            if member.linkname:
                names.append(member.linkname)
            if not member.isfile():
                continue
            src = tf.extractfile(member)
            if src is None:
                # A regular file whose payload will not open IS a hole in the scan.
                print(f"    scan-dir: {path}: member {member.name!r} payload unreadable")
                return False
            parts = [p for p in member.name.replace("\\", "/").split("/")
                     if p not in ("", ".", "..")]
            out = os.path.join(dest, *parts) if parts else os.path.join(dest, f"member{idx}")
            # Two members can sanitise to one path ('a/../b' and 'b'); never clobber.
            while os.path.exists(out):
                out = f"{out}.{idx}"
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as fh:
                shutil.copyfileobj(src, fh)
    with open(os.path.join(dest, "__member_names__.txt"), "w",
              encoding="utf-8", errors="replace") as fh:
        fh.write("\n".join(names))
    return True


def _expand_archive(path, dest):
    """Expand ONE archive into dest.

    Returns True when the contents were made available for scanning, False when
    the format could not be opened. A False is NOT treated as 'nothing to see' —
    the caller fails the gate on it, because an archive the scan cannot read is
    exactly the blind spot this pass exists to remove (unknown is not absent).
    """
    os.makedirs(dest, exist_ok=True)
    low = path.lower()
    try:
        if low.endswith(".zip") or low.endswith(".jar") or low.endswith(".asar"):
            with zipfile.ZipFile(path) as zf:
                zf.extractall(dest)  # noqa: S202 — scanned then discarded, never executed
            return True
        if low.endswith(".tar.zst"):
            r = sh(f"zstd -dc {q(path)} | tar -xf - -C {q(dest)}")
            return r.returncode == 0
        if tarfile.is_tarfile(path):
            # Member-wise on purpose — see _expand_tar_memberwise. A hostile member
            # must not be able to halt a release on bytes that are readable.
            return _expand_tar_memberwise(path, dest)
        if low.endswith(".zst"):
            return sh(f"zstd -dc {q(path)} > {q(os.path.join(dest, 'payload'))}").returncode == 0
        if low.endswith(".gz"):
            return sh(f"gzip -dc {q(path)} > {q(os.path.join(dest, 'payload'))}").returncode == 0
        if low.endswith(".bz2"):
            return sh(f"bzip2 -dc {q(path)} > {q(os.path.join(dest, 'payload'))}").returncode == 0
        if low.endswith(".xz"):
            return sh(f"xz -dc {q(path)} > {q(os.path.join(dest, 'payload'))}").returncode == 0
        if low.endswith(".dump"):
            # pg_dump custom format — zlib-compressed internally. pg_restore -f -
            # renders it as SQL text, which is what we need to scan.
            return sh(
                f"pg_restore -f {q(os.path.join(dest, 'payload.sql'))} {q(path)}"
            ).returncode == 0
    except Exception as e:  # noqa: BLE001 — any failure means "could not inspect"
        print(f"    scan-dir: cannot expand {path}: {type(e).__name__}: {e}")
        return False
    return False


#: Compiled native addons. A build-box path inside one is baked in by the COMPILER
#: (an assert()/__FILE__ expansion in .rodata), so it is reachable by neither of the
#: gate's other two remedies: `strip` cannot remove it (verified: `strip
#: --strip-debug` leaves it — it is .rodata, not debug info), and the file cannot be
#: pruned because it is loaded at runtime.
SCRUBBABLE_BINARY_SUFFIXES = (".node", ".so", ".dylib")


def scrub_binaries(dirs):
    """Scrub build-box identity literals out of COMPILED NATIVE ADDONS, in place.

    The gate's remedy line offers two fixes — "prune the leaking file … or scrub the
    value". For a compiled addon only the second is available, which is why this
    exists (WI-37620): the 0.0.14 cut red'd on
    node_modules/ssh2/…/Release/sshcrypto.node carrying the builder's node-gyp
    include path, sitting in .rodata between a __PRETTY_FUNCTION__ and its
    neighbours — i.e. an assert() __FILE__ expansion. Deleting the file happens to
    be safe for THAT package (ssh2 wraps the require in try/catch and falls back to
    JS crypto), but that is a property of ssh2, not of addons, so a delete rule
    would be one un-guarded require away from shipping a broken app. Scrubbing is
    safe for ALL of them and keeps the accelerator.

    Deliberately restricted to compiled addons: a literal in TEXT belongs to a
    source that should be fixed, and silently rewriting source would hide it.

    Byte-length is PRESERVED exactly (placeholder truncated/padded), so every ELF
    offset, section size and relocation stays valid — the bytes changed are an
    assert message, never read for control flow. Literals are applied
    LONGEST-FIRST so '/home/<user>' is scrubbed before the bare '<user>' inside it.
    """
    lits = identity_literals()
    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    pairs = sorted(
        ((v, REDACTION_BY_KEY.get(k, "redacted")) for k, v in lits.items()
         if v and not is_low_entropy(v)),
        key=lambda p: -len(p[0]),
    )
    if not pairs:
        print("    scrub-binaries: no high-entropy literals on this box — nothing to do")
        return 0

    scrubbed = 0
    for root in dirs:
        if not os.path.isdir(root):
            print(f"    scrub-binaries: {root} absent — skipping")
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                if not fn.endswith(SCRUBBABLE_BINARY_SUFFIXES):
                    continue
                p = os.path.join(dirpath, fn)
                try:
                    data = open(p, "rb").read()
                except OSError:
                    continue
                orig = data
                hits = []
                for lit, placeholder in pairs:
                    b = lit.encode()
                    if b not in data:
                        continue
                    rep = placeholder.encode()[:len(b)].ljust(len(b), b"_")
                    hits.append(f"{lit} x{data.count(b)}")
                    data = data.replace(b, rep)
                if data != orig:
                    assert len(data) == len(orig), "scrub must preserve byte length"
                    with open(p, "wb") as fh:
                        fh.write(data)
                    scrubbed += 1
                    print(f"    ✂ scrubbed {os.path.relpath(p, root)}: {', '.join(hits)}")
    print(f"    scrub-binaries: {scrubbed} compiled addon(s) scrubbed")
    return 0


def scan_dir(dirs):
    """Ultimate backstop: identity-scan the ASSEMBLED bytes that actually ship,
    honoring NO path-exclude. If a known-sensitive or build-box identity literal
    is on disk in what ships, FAIL — exclude list or not.

    The existing phase-B scan is meant to be this backstop, but it reads
    source.tar.zst (the staged tree), which is CLEAN, so it never sees the sidecar
    the .app also ships. Pointing the identity scan at the assembled sidecar closes
    exactly the gap the 0.0.9 ARRIVES probe caught, at BUILD time. High-entropy
    literals (home paths, usernames, the known mac-VM creds) are hunted EVERYWHERE
    incl node_modules; a low-entropy bare first name is hunted non-vendor only —
    the same anti-false-positive scoping as phase B/C.
    """
    lits = identity_literals()
    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    high = sorted({v for v in lits.values() if not is_low_entropy(v)})
    low = sorted({v for v in lits.values() if is_low_entropy(v)})
    print("==> identity-scan of assembled tree (honors NO path-exclude — WI-4419)")
    print(f"    high-entropy (all files):  {', '.join(high) or '(none)'}")
    print(f"    low-entropy (non-vendor):  {', '.join(low) or '(none)'}")
    files = set()

    def grep_l(pats, scoped, roots, label=None):
        """P-012: `-a` (treat binary as text), NEVER `-I`.

        This used to pass `-I`, which SKIPS binary files entirely — so the scan
        billed as "the assembled bytes that actually ship" silently never looked
        at a database dump, a corestore, or any compiled artifact, and printed
        "✓ CLEAN". A scan that inspects nothing is indistinguishable from a scan
        that found nothing. phase_b_content already used `-a` for this reason.
        """
        if not pats:
            return
        for root in roots:
            if not os.path.isdir(root):
                print(f"    scan-dir: {root} absent — skipping")
                continue
            cmd = ["grep", "-ralE"]
            if scoped:
                cmd.append("--exclude-dir=node_modules")
            for p in pats:
                cmd += ["-e", lit_ere(p)]
            cmd.append(root)
            r = subprocess.run(cmd, capture_output=True, text=True)
            for line in r.stdout.splitlines():
                if line.strip():
                    hit = line.strip()
                    files.add(f"{label}!{os.path.relpath(hit, root)}" if label else hit)

    grep_l(high, False, dirs)
    grep_l(low, True, dirs)

    # P-012 archive pass: a compressed archive's payload is not present in its own
    # bytes, so no grep — binary-aware or not — can see inside it. Expand, scan the
    # contents, discard. An archive we cannot open is reported and FAILS: the whole
    # point of this pass is that "not inspected" must stop reading as "clean".
    archives = sorted(set(_iter_archives(dirs)))
    uninspectable = []
    if archives:
        print(f"    archives: expanding {len(archives)} archive(s) to scan contents")
        with tempfile.TemporaryDirectory(prefix="papercusp-audit-arch-") as tmp:
            for idx, arc in enumerate(archives):
                dest = os.path.join(tmp, f"a{idx}")
                if not _expand_archive(arc, dest):
                    uninspectable.append(arc)
                    continue
                grep_l(high, False, [dest], label=arc)
                grep_l(low, True, [dest], label=arc)
                shutil.rmtree(dest, ignore_errors=True)

    if uninspectable:
        print(f"\n    ✗ {len(uninspectable)} ARCHIVE(S) COULD NOT BE INSPECTED — "
              f"refusing to report CLEAN on bytes nobody read\n")
        for f in uninspectable[:40]:
            print(f"        {f}")
        print("\n  An archive this gate cannot open is a hole in the identity scan, not a pass.")
        print("  Either teach _expand_archive its format, or stop shipping it.")
        return 1

    if not files:
        print("    ✓ CLEAN — no sensitive/build-box identity in the assembled bundle "
              f"({len(archives)} archive(s) expanded and scanned)")
        return 0
    print(f"\n    ✗ ASSEMBLED BUNDLE CARRIES SENSITIVE IDENTITY — MUST NOT SHIP "
          f"({len(files)} file(s))\n")
    for f in sorted(files)[:40]:
        print(f"        {f}")
    if len(files) > 40:
        print(f"        … and {len(files) - 40:,} more")
    print("\n  This scan IGNORES the path-exclude list BY DESIGN (scan the bytes that ship).")
    print("  Fix the SOURCE: prune the leaking file from the sidecar copy in")
    print("  build-desktop-sidecar.sh, or scrub the value — never add an exclude here.")
    return 1


def print_identity_literals():
    """Emit `value<TAB>redaction<TAB>wordboundary(0/1)` for every identity literal
    the gate hunts — build-box identity + the known cross-box sensitive set — so
    bin/stage-source-tree.sh scrubs EXACTLY what this gate would later fail on, from
    the one source of truth (no second list to drift). LONGEST value first so an
    overlapping pair is applied safely (/home/<user> before the bare <user> inside
    it). A value with no explicit REDACTION_BY_KEY token falls back to 'redacted'."""
    lits = identity_literals()
    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    seen = set()
    for key, val in sorted(lits.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if val in seen:
            continue
        seen.add(val)
        red = REDACTION_BY_KEY.get(key, "redacted")
        wb = "1" if needs_word_boundary(val) else "0"
        print(f"{val}\t{red}\t{wb}")
    return 0


def source_leakers(argv):
    """Print the must-ship SOURCE files (relative to MONO) that carry a build-box /
    known-sensitive identity literal, for the stager to redact-overlay at tar time.

    Same scoping the gate convicts with, so the stager scrubs exactly the set that
    would otherwise red the cut: low-entropy literals (a bare first name) are hunted
    in OUR source only; high-entropy literals everywhere EXCEPT node_modules — a
    vendored high-entropy hit is a delete-exclude class (build caches, handled by
    --tar-excludes), never something we rewrite inside a third-party package. Paths
    matching a FORBIDDEN_PATH rule are skipped: they do not ship, so scrubbing +
    re-adding one would smuggle a non-shipper into the bundle."""
    if not argv:
        print("AUDIT ERROR: --source-leakers needs <MONO> <dir...>", file=sys.stderr)
        return 2
    mono, roots = argv[0], argv[1:]
    lits = identity_literals()
    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    high = sorted({v for v in lits.values() if not is_low_entropy(v)})
    low = sorted({v for v in lits.values() if is_low_entropy(v)})
    forbidden = [rx for _r, rx, _g in FORBIDDEN_PATH]
    # FORBIDDEN_PATH is the gate's PRIVACY exclude set (== --tar-excludes), so a
    # candidate under one of those never ships and is already skipped above. The
    # stager ALSO drops a SIZE/heavy class (bin/stage-source-tree.sh) that is not
    # in FORBIDDEN_PATH — build logs, tsbuildinfo, editor/turbo dirs, the docs-site
    # dist, cargo-target twins, the papercusp-desktop self-reference. A candidate in
    # one of THOSE is a build artifact that will not ship either, so scrubbing +
    # re-adding it would smuggle a non-shipper into the bundle. Mirror that heavy
    # class here (target/.next/.cache/.astro/pagefind are already FORBIDDEN_PATH).
    size_skip = [
        "*.log", "*.tsbuildinfo", "*.DS_Store",
        "*/.turbo/*", "*/.idea/*", "*/.vscode/*",
        "*/operator-docs/dist/*", "operator-docs/dist/*",
        "*cargo-target*", "papercusp-desktop/*", "*/papercusp-desktop/*",
    ]
    leakers = set()

    def hunt(pats):
        if not pats:
            return
        for root in roots:
            if os.path.basename(root.rstrip("/")) == "node_modules":
                continue  # never scrub vendored code
            aroot = os.path.join(mono, root)
            if not os.path.exists(aroot):
                continue
            # `-I` (skip binaries) is DELIBERATE here, unlike in scan_dir: this hunts
            # SOURCE files to hand to the scrubber, and you do not text-scrub a binary.
            # scan_dir audits the bytes that SHIP and must use `-a` (P-012).
            cmd = ["grep", "-rIlE", "--exclude-dir=node_modules"]
            for p in pats:
                cmd += ["-e", lit_ere(p)]
            cmd.append(aroot)
            r = subprocess.run(cmd, capture_output=True, text=True)
            for line in r.stdout.splitlines():
                line = line.strip()
                if not line:
                    continue
                rel = os.path.relpath(line, mono).replace(os.sep, "/")
                if any(rx.search(rel) or rx.search("/" + rel) for rx in forbidden):
                    continue
                if any(fnmatch.fnmatch(rel, g) for g in size_skip):
                    continue
                leakers.add(rel)

    hunt(high)
    hunt(low)
    for rel in sorted(leakers):
        print(rel)
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    if sys.argv[1] == "--tar-excludes":
        return print_tar_excludes()
    if sys.argv[1] == "--identity-literals":
        return print_identity_literals()
    if sys.argv[1] == "--source-leakers":
        return source_leakers(sys.argv[2:])
    if sys.argv[1] == "--prune-docs":
        return prune_docs(sys.argv[2:])
    if sys.argv[1] == "--scrub-binaries":
        return scrub_binaries(sys.argv[2:])
    if sys.argv[1] == "--scan-dir":
        return scan_dir(sys.argv[2:])
    bundle = sys.argv[1]
    if not os.path.isfile(bundle):
        print(f"AUDIT ERROR: no such bundle: {bundle}", file=sys.stderr)
        return 2
    for tool in ("zstd", "tar", "grep"):
        if not shutil.which(tool):
            print(f"AUDIT ERROR: {tool} not on PATH — cannot scan", file=sys.stderr)
            return 2

    lits = identity_literals()
    print(f"==> auditing {os.path.basename(bundle)}")
    print(f"    identity of this build box: {', '.join(sorted(lits)) or '(none resolved)'}")
    # Cross-box blind-spot backstop (WI-4419): hunt the KNOWN leaked identities on
    # EVERY build, not just the ones belonging to the box running this scan.
    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    print(f"    + {len(KNOWN_SENSITIVE_IDENTITIES)} known cross-box sensitive identities "
          f"(hunted on every build regardless of build host)")

    members, path_hits = phase_a_paths(bundle, lits)
    print(f"    [A] paths    — {members:,} members, {len(path_hits):,} finding(s)")

    content_hits = phase_b_content(bundle, lits)
    print(f"    [B] content  — {len(content_hits):,} distinct value(s) matched")

    if not path_hits and not content_hits:
        print("    ✓ CLEAN — no forbidden paths, no build-box identity, no credentials")
        return 0

    print(f"\n    ✗ THIS BUNDLE MUST NOT SHIP\n")

    if path_hits:
        grouped = {}
        for rule, name in path_hits:
            top = "/".join(name.split("/")[:3])
            g = grouped.setdefault((rule, top), {"n": 0, "eg": name})
            g["n"] += 1
        print("  FORBIDDEN PATHS")
        for (rule, top), g in sorted(grouped.items(), key=lambda kv: -kv[1]["n"]):
            print(f"    [{rule}]  {g['n']:,}×  under {top}")
            print(f"        e.g. {g['eg']}")

    if content_hits:
        print("\n  IN FILE CONTENT")
        for rule, n, val in content_hits[:20]:
            shown = val if rule.startswith("build-") else redact(val)
            print(f"    [{rule}]  {n:,}×  {shown}")
        print("\n  attributing to files (slow pass — only runs on a failing build)…")
        attributed = phase_c_attribute(bundle, lits, content_hits)
        for rule, n, _val in content_hits[:20]:
            g = attributed.get(rule)
            if not g:
                # Convicted in phase B but attributable to no file: the value lives in
                # a member over MAX_ATTRIBUTE_BYTES, or in one phase C reads as binary.
                print(f"    [{rule}]  {n:,}× — NOT attributable to a file "
                      f"(member >{MAX_ATTRIBUTE_BYTES // 1024 // 1024}MB, or binary)")
                continue
            print(f"    [{rule}]  {g['n']:,} file(s)")
            for name in g["files"]:
                print(f"        {name}")
            if g["n"] > len(g["files"]):
                print(f"        … and {g['n'] - len(g['files']):,} more")

    print("\n  Fix the SOURCE — the allowlist in bin/stage-source-tree.sh. Do NOT add an")
    print("  exception here to make the build pass: that is the bug this gate exists to catch.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
