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
        audit-release-bundle.py --scan-dir <assembled-tree>...
        audit-release-bundle.py --scan-artifact <finished-installer>...
"""
import fnmatch
import functools
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
    # Owner's GitHub handle. Added from a MEASURED leak, not prophylactically
    # (EI-20108164746219771): it occurs 10x inside the shipped seed corestore,
    # alongside two github_user_id values. It is owned by no box's `whoami`, so
    # identity_literals() — which resolves only the building machine — could never
    # have produced it; it is precisely the cross-identity class this denylist is
    # the backstop for. len 6, so needs_word_boundary() is False and it is hunted
    # EVERYWHERE as a plain substring, which is what we want for a handle.
    "known-sensitive:owner-github-handle": "aviynw",
}


# Product strings that LEGITIMATELY embed a denylisted identity literal and must
# ship (WI-38233, 2026-08-12). Both were MEASURED as the only non-incidental uses
# in the 0.0.16 bundle, not assumed — the two incidental ones found in the same
# sweep (a UI placeholder "aviynw10", a test workspace name in a prose string)
# were fixed at SOURCE instead of being listed here, which is the default and
# should stay the default.
#
#   • papercusp-cupboard.aviynw.workers.dev — the Cupboard worker host. The handle
#     is the Cloudflare ACCOUNT SUBDOMAIN, so it is in a hostname the shipped app
#     must resolve and connect to: it is on the wire for every user no matter what
#     these bytes say. Scrubbing it does not hide the handle, it only breaks the
#     client. Removing it for real means moving the worker to a custom domain —
#     infrastructure, not a release fix.
#   • ["aviynw","papercupai"] — CANONICAL_HIVE_TEAM_ALLOWLIST, the real hive-invite
#     team allowlist. Scrubbing it breaks hive invites outright.
#
# This is an ACCEPTANCE, not an exclude, and it is COUNTED rather than matched: a
# file is accepted only when EVERY occurrence of the literal sits inside one of
# these strings. One unexplained occurrence and the file still FAILS — so a new
# leak of the bare handle still reds the gate, including inside these very files.
# Both quoting styles are listed because only the minified bundle is measured
# above; an unminified build emits the source form.
AUTHORISED_PRODUCT_STRINGS = (
    "papercusp-cupboard.aviynw.workers.dev",
    '["aviynw","papercupai"]',
    "['aviynw', 'papercupai']",
)


def _count_occurrences(path, needle):
    """Exact byte-count of `needle` in `path`.

    Used only for the AUTHORISED strings, which are long exact literals.
    Fails CLOSED: an unreadable path returns -1, which can never satisfy the
    "every occurrence is authorised" equality, so the file keeps FAILING rather
    than being quietly accepted on bytes nobody read.
    """
    try:
        with open(path, "rb") as fh:
            return fh.read().count(needle.encode("utf-8", "surrogateescape"))
    except Exception:
        return -1


def _count_literal(path, lit):
    """Occurrences of an IDENTITY LITERAL, counted exactly as the scan MATCHES it.

    This must mirror grep_l()'s asymmetry or the arithmetic below compares two
    different things. Measured on the 0.0.16 serve.mjs: the low-entropy literal
    (the owner's 3-letter git user.name) occurs 15x as a plain substring — inside
    ordinary English words such as "Available" — and ZERO times as the
    word-boundary match the scan actually uses. Counting it as a substring left 15
    phantom "unaccounted" occurrences and wrongly kept a clean file failing, which
    made the acceptance unreachable for any real bundle.

    Fails CLOSED: any error returns -1.
    """
    flag = "-oIE" if is_low_entropy(lit) else "-aoE"
    try:
        r = subprocess.run(["grep", flag, lit_ere(lit), path],
                           capture_output=True, text=True)
        if r.returncode not in (0, 1):
            return -1
        return sum(1 for ln in r.stdout.splitlines() if ln)
    except Exception:
        return -1


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
    # Explicit rather than relying on the "redacted" fallback: the fallback maps
    # EVERY unlisted key to the same token, so two different leaked identities would
    # scrub to identical bytes and become indistinguishable in the staged tree.
    "known-sensitive:owner-github-handle": "ownerhandle",
}


# ── The owner's NAME when git can no longer supply it ────────────────────────
# DELIBERATELY the same variable the TS site gate reads
# (apps/operator/lib/release/release-content-scrub.ts, OWNER_NAME_ENV): two gates
# guarding one release must not need two different answers to the same question.
# Read at run time and never stored — writing the owner's name into a source file
# so we can search for it would BE the leak, committed to git forever.
OWNER_NAME_ENV = "PAPERCUSP_RELEASE_OWNER_NAME"

# The owner's EMAIL, same contract as the name. Needed because — unlike the TS scrub,
# which catches any address by SHAPE via IDENTITY_PATTERNS — this audit has no shape rule
# for email: `build-git-email` is its ONLY email detection. So dropping an automation
# address below without offering this would silently zero out the email class entirely.
OWNER_EMAIL_ENV = "PAPERCUSP_RELEASE_OWNER_EMAIL"

# Git identities belonging to AUTOMATION rather than to a person. Mirrors
# AUTOMATION_NAME_RE in release-content-scrub.ts — keep the two in step.
AUTOMATION_NAME_RE = re.compile(
    r"(^|[-_ ])(agent|bot|ci|runner|automation|service|actions|daemon|noreply)([-_ ]|$)|\[bot\]",
    re.I,
)


def looks_like_automation_identity(value):
    """True when a git identity is a machine's, not a person's."""
    return bool(AUTOMATION_NAME_RE.search(value.strip()))


# An ADDRESS needs its own test, and finding that out cost a wrong fix: AUTOMATION_NAME_RE
# anchors on [-_ ] boundaries, but in a `<user>@users.noreply.github.com` form the
# separators are DOTS, so `noreply` never matched and the address sailed through unchanged.
# (The first attempt at this fix shipped that regex, and the scan still exited 1.)
#
# Deliberately NOT solved by adding `.`/`@` to that name regex: widening it would start
# eating real people (`alice.service@…` would match `service` between a dot and an at-sign)
# and a false DROP on the email class is a silent loss of coverage — the failure direction
# this whole item is about. So: a targeted test for the actual conventions automation
# addresses use, leaving human-name matching untouched.
AUTOMATION_EMAIL_RE = re.compile(
    r"(^|[-_.+])(no-?reply|bot|ci|build|actions|automation|daemon|jenkins|dependabot|renovate)([-_.+]|@)"
    r"|\bnoreply\b"
    r"|users\.noreply\.github\.com$"
    r"|\[bot\]",
    re.I,
)


def looks_like_automation_email(value):
    """True when an address belongs to automation rather than to the human owner.

    A bot's public noreply address is not a private identity: it is in every commit on the
    public repo by construction, so redacting it protects nobody while guaranteeing a
    permanent false positive wherever the project legitimately hardcodes it.
    """
    return bool(AUTOMATION_EMAIL_RE.search(value.strip()))


def explicit_owner_values(env_var):
    """The owner literals ASSERTED for this run, parsed from one env var. ONE rule.

    SEPARATOR IS COMMA/SEMICOLON ONLY — deliberately NOT whitespace. A first draft split on
    \\s too and tore "Jane Doe" into "Jane" + "Doe", which is wrong twice: it never hunts
    the full name, and it injects a bare surname as its own low-entropy literal that then
    matches innocent words across the bundle. Names contain spaces; addresses do not, so
    nothing is lost by dropping whitespace as a separator.
    """
    raw = os.environ.get(env_var, "")
    return list(dict.fromkeys(v.strip() for v in re.split(r"[,;]", raw) if v.strip()))


def has_owner_name_literal(lits):
    """Can this literal set actually detect the owner's NAME?

    The name is the one identity class with NO SHAPE to fall back on. A home path or
    an email is still caught structurally even when no literal knows it; a bare first
    name is only ever a literal. So when this is false the scan cannot see the name at
    all, and a CLEAN verdict degrades to "I looked for nothing" while still reading as
    proof. Callers that SHIP must fail closed on false.

    ⚠ REQUIRES THE **EXPLICIT** VALUE, and deliberately ignores anything git supplied.
    An earlier version of this fix accepted a git-derived name so long as it did not match
    looks_like_automation_identity(). That is a DENYLIST, and a denylist fails OPEN for
    every identity nobody thought of — which stopped being hypothetical within the hour:
    this box's user.name changed from one automation identity to a differently-spelled one
    ("…-agent" → "…-buildbox"), the pattern list did not carry the new token, the bot read
    as a person, and this function returned True again while the scan hunted a machine's
    name. The same defect, one level up, with the fix already in place.

    git config names the COMMITTER. On an automated box that is by construction not the
    owner, and no pattern list can reliably separate the two. So the gate stops guessing:
    the owner identity must be ASSERTED by whoever runs the release. The heuristic is still
    worth keeping — it stops a bot's name being hunted uselessly and keeps redaction honest
    — but it is a convenience, never the thing a CLEAN verdict is allowed to rest on.
    """
    return bool(explicit_owner_values(OWNER_NAME_ENV))


def _owner_values(lits, base):
    """Every non-empty literal for one owner class — `base`, `base-2`, `base-3`, ...

    The owner side is PLURAL because a person is: measured on this repo's own history,
    three distinct non-automation addresses match the owner's name pattern. A single-value
    argument would let one invocation hunt one of them and still print an unqualified
    CLEAN — certifying the class while leaving the rest unhunted, which is the very shape
    of defect this file is being hardened against. The alternative (re-run the audit once
    per address) is an unenforceable process convention, and the next person will not know
    to follow it. Put it in the data model instead.
    """
    out = []
    for k, v in lits.items():
        if k == base or k.startswith(base + "-"):
            v = str(v).strip()
            if v:
                out.append(v)
    return out


def redaction_key(key):
    """REDACTION_BY_KEY lookup key, with the plural `-2`, `-3` suffix normalised off.

    All of one owner's addresses share a single placeholder ON PURPOSE — they are one
    identity, and the fallback's warning about distinct identities collapsing to the same
    token does not apply within a class.
    """
    return re.sub(r"-\d+$", "", key)


def identity_coverage_gaps(lits):
    """Identity classes a CLEAN verdict from this run does NOT cover.

    A pass must never claim more than it checked. The NAME class is fail-closed at both
    entry points, so reaching CLEAN proves the name was hunted. The EMAIL class is not:
    this audit has no shape-based email rule (unlike the TS scrub's IDENTITY_PATTERNS),
    so if no email literal resolves, email coverage is simply ZERO and every downstream
    reader still sees an unqualified "✓ CLEAN".

    That silence is the exact mechanism of EI-20583328178472869 — the verdict outliving
    the evidence it was based on. This file already argues the case for coverage of FILES
    ("a scan that inspects nothing is indistinguishable from a scan that found nothing");
    it had simply never applied it to the CLASSES. Call it out IN the verdict.

    Returns a list of human-readable gaps; empty means the verdict is unqualified.
    """
    gaps = []
    # Counts ASSERTED addresses only, for the same reason has_owner_name_literal does: a
    # git-derived address identifies the committer, and on this box that has twice been an
    # automation. Counting it would inflate the coverage claim with a value nobody vouched.
    emails = explicit_owner_values(OWNER_EMAIL_ENV)
    if not emails:
        gaps.append(
            f"EMAIL not covered — no owner-email literal resolved "
            f"(git user.email is unset or an automation address). "
            f"Set {OWNER_EMAIL_ENV} to hunt it (accepts a comma-separated list)."
        )
    else:
        # State the COUNT, not just "covered". A person can have several addresses, and
        # "email: covered" over one of three reads as a full pass to anyone downstream.
        gaps.append(
            f"EMAIL covered for {len(emails)} address(es) — a CLEAN result says nothing "
            f"about any owner address NOT supplied via {OWNER_EMAIL_ENV}."
        )
    return gaps


def print_coverage_gaps(gaps, indent="    "):
    """Print coverage caveats beside a CLEAN verdict, or nothing when there are none."""
    for g in gaps:
        print(f"{indent}⚠ PARTIAL COVERAGE: {g}")


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
            if not v:
                continue
            # EI-20583328178472869: `user.name` became the git-sync bot, so this gate
            # spent every build hunting a bot's name — useless — while the owner's real
            # name went unhunted and the bundle still printed CLEAN. Recording the bot
            # would ALSO leave has_owner_name_literal() true, so the blindness would stay
            # invisible. Dropping it makes the gap loud, and main() fails closed on it.
            if key == "build-git-name" and looks_like_automation_identity(v):
                continue
            # The EMAIL class, same rule, and it fails the OPPOSITE way — which is how it
            # was found. This box's user.email is the git-sync bot's noreply address, and
            # that exact string is ALSO a hardcoded public constant in the project's own
            # source (run-git-sync.ts's committer identity), which vite bundles into
            # apps/operator-vite/dist. So the "private box identity" oracle collided with a
            # deliberate public constant and the gate could never pass: a permanent FALSE
            # POSITIVE, where the name class was a permanent FALSE NEGATIVE. One cause —
            # the box's git identity repointed at shared automation — two opposite failures.
            #
            # Redacting a bot's public noreply address protects nobody: it is in every
            # commit on the public repo by construction. Do NOT "fix" this by allowlisting
            # the address or by excluding the dist directory it happened to surface in —
            # the constant lives in SOURCE and will reappear in any other build output.
            if key == "build-git-email" and looks_like_automation_email(v):
                continue
            lits[key] = v
        except Exception:
            pass
    # Explicit answers outrank whatever the box guesses (CI, a container, or a box whose
    # git identity an automation has taken over). Read at run time, never stored.
    # BOTH accept a LIST. A person has more than one address, and often more than one
    # spelling of their name; a single-value argument silently covers the first and
    # certifies the class anyway.
    #
    for env_var, base in ((OWNER_NAME_ENV, "build-git-name"), (OWNER_EMAIL_ENV, "build-git-email")):
        values = explicit_owner_values(env_var)
        if not values:
            continue
        # Explicit answers REPLACE the box's guess for that class rather than adding to it
        # — otherwise a stale git identity would linger beside the supplied truth.
        for k in [k for k in lits if k == base or k.startswith(base + "-")]:
            del lits[k]
        for i, v in enumerate(dict.fromkeys(values)):  # de-dup, order preserved
            lits[base if i == 0 else f"{base}-{i + 1}"] = v.strip()
    return lits


def needs_word_boundary(lit):
    """A SHORT literal must match as a whole word or it matches half the bundle.

    The owner's git user.name here is literally "Avi" — the exact thing they asked
    us to keep out of a public build ("my name is avi on this machine"). An earlier
    cut of this gate skipped any literal under 4 chars, which silently made the
    owner's own example the ONE identity it could not catch. Substring-matching
    "Avi" instead would fire on every .avi/AVI/Avicenna in vendored code and get
    the gate switched off, so short literals match on a word boundary:
    \\bAvi\\b hits "Avi Weiss", not "video.avi".
    """
    return len(lit) < 6 and lit.isalnum()


def case_fold_ere(pat):
    """Make an ERE case-insensitive by folding each letter into a class: a → [aA].

    WHY A CHARACTER CLASS AND NOT A FLAG. This one pattern is consumed by four
    engines that do NOT share a case-insensitivity switch: GNU grep (-E), Python
    re.compile (str AND bytes), and — through --identity-literals — the `sed -E`
    scrub in bin/stage-source-tree.sh, which also has to run under BSD sed on the
    mac release VM, where `s///I` is not portable. A folded class is the one form
    every ERE dialect agrees on, so the scrub and the gate cannot disagree about
    case the way they previously disagreed about it silently.

    Apply to an ALREADY re.escape()d pattern: escape() leaves alphanumerics alone
    and only introduces non-alpha metacharacters, so folding letters afterwards
    cannot corrupt an escape sequence.
    """
    return "".join(f"[{c.lower()}{c.upper()}]" if c.isalpha() else c for c in pat)


def lit_ere(lit):
    """The ERE this identity literal is searched with (GNU grep supports \\b).

    CASE-INSENSITIVE — and it must be, which cost us a shipped leak to learn
    (EI-20589264759185712). The owner's name reached the PUBLISHED 0.0.17 Linux
    deb in lowercase, inside a SQL comment ("Surfaced for avi:"), while this gate
    read the bundle CLEAN: it was hunting \\bAvi\\b, and `avi` is not `Avi`.

    Because this ONE rule feeds all three legs — the gate's own scan, the
    --source-leakers set (WHICH files the stager scrubs) and the --identity-literals
    sed map (WHAT it replaces) — case-sensitivity failed all three at once and in
    the same direction: the file was never nominated for scrubbing, so nothing
    redacted it, so the gate found nothing to fail on. Three independent-looking
    proofs, one blind spot.

    The 'it would cry wolf on vendored .avi/AVI' worry that justified case-sensitivity
    is handled by a DIFFERENT mechanism that already exists: is_low_entropy() scopes
    a bare first name to OUR source via is_vendor(), so node_modules is out of scope
    before case ever matters. Measured over the real non-vendor corpus at the time of
    the fix: 69 files gained, 54 of them carrying genuine identity (test fixtures with
    `username: 'avi'`, `--account avi-storewolf`, the box hostname `avi-dev`), and the
    only non-identity hits were prose ABOUT this tradeoff and this gate's own tests.
    """
    body = case_fold_ere(re.escape(lit))
    return rf"\b{body}\b" if needs_word_boundary(lit) else body


def _literal_in_file(path, lit):
    """Is this ONE literal in this ONE file, with the scan's binary/text asymmetry?

    Used to decide whether a seed-corestore hit carries anything BEYOND the
    owner-authorised machine label. Fails CLOSED: a path we cannot read returns
    True, so "could not prove absence" keeps the file failing rather than
    quietly accepting it.
    """
    if not os.path.isfile(path):
        return True
    flag = "-qIE" if is_low_entropy(lit) else "-aqE"
    try:
        return subprocess.run(["grep", flag, lit_ere(lit), path],
                              capture_output=True).returncode == 0
    except Exception:
        return True


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
    n = name.lstrip("./").replace("\\", "/")
    return (
        n.startswith("node_modules/")
        or "/node_modules/" in n
        # Vditor is copied into the built SPA outside node_modules. Its checked-in
        # distribution contains the AVI media-extension token, which is upstream
        # vocabulary rather than this box owner's name. Keep high-entropy hunting
        # enabled there; only the bare-name pass inherits vendor scoping.
        or "/spa/vditor/" in "/" + n
    )


_FINGERPRINTED_DIST_ASSET_RE = re.compile(
    r"^(?P<stem>.+)-(?P<fingerprint>[A-Za-z0-9_-]{8})(?P<ext>\.[^/]+)$"
)


def semantic_path_for_low_entropy(name):
    """Remove only an opaque Vite/Rollup fingerprint before matching a short name.

    A three-letter owner name has too little entropy to convict inside an opaque
    content hash.  The real 2026-08-20 collision was
    ``dist/assets/factor-aVI-w_hC.js``: ``aVI`` is a whole ERE word because the
    hash contains punctuation, but it is not a semantic filename component.

    Scope this narrowly to generated ``dist/assets`` names with the measured
    eight-character fingerprint shape.  The semantic stem remains searchable, so
    ``dist/assets/Avi-abcdefgh.js`` still fails while the hash-only collision does
    not.  Paths outside that generated-asset shape remain byte-for-byte unchanged.
    """
    normalized = name.replace("\\", "/")
    if "/dist/assets/" not in "/" + normalized or "/" not in normalized:
        return name
    parent, base = normalized.rsplit("/", 1)
    match = _FINGERPRINTED_DIST_ASSET_RE.fullmatch(base)
    if not match:
        return name
    return f"{parent}/{match.group('stem')}{match.group('ext')}"


@functools.lru_cache(maxsize=512)
def lit_rx(lit):
    """Memoised: phase A now calls this per MEMBER (~248k on source.tar.zst) for
    every literal and every header field, so recompiling the pattern each time is
    the difference between a header pass that costs seconds and one that costs
    minutes. `lit_ere` is a pure function of `lit`, so caching cannot go stale."""
    return re.compile(lit_ere(lit))


_OPAQUE_ASSET_REFERENCE_RE = re.compile(
    rb"[A-Za-z0-9_.-]+-(?P<fingerprint>[A-Za-z0-9_-]{8})\.js"
)
_MEDIA_EXTENSION_NEIGHBOURS = (b'"mp4"', b'"webm"', b'"mov"', b'"wmv"')


def low_entropy_match_is_benign(name, data, match):
    """True only for a proven non-identity use of a short owner-name token.

    A case-folded ``Avi`` correctly catches authored ``avi`` identity, but also
    collides with the AVI media format and with an opaque eight-character Vite
    fingerprint. Classify OCCURRENCES, never whole generated files: the same JS
    file can carry a harmless codec token and a real authored identity.

    ``data`` is bytes so this helper is shared by tar streaming, assembled-tree
    scans, and the copy-point scrubber. Every exception below is structural and
    narrow; ordinary ``@avi`` / prose / identifiers remain release-blocking.
    """
    if is_vendor(name):
        return True

    start, end = match.span()
    token = data[start:end].lower()

    # A Vite import/reference such as factor-aVI-w_hC.js: ignore the owner token
    # only when it lies wholly inside the opaque eight-character fingerprint.
    window_start = max(0, start - 160)
    window_end = min(len(data), end + 160)
    window = data[window_start:window_end]
    for asset in _OPAQUE_ASSET_REFERENCE_RE.finditer(window):
        fp_start = window_start + asset.start("fingerprint")
        fp_end = window_start + asset.end("fingerprint")
        if fp_start <= start and end <= fp_end:
            return True

    if token != b"avi":
        return False

    # FFmpeg/AviSynth source-name regex embedded in the Markdown editor bundle.
    prefix = data[max(0, start - 1):min(len(data), end + 18)].lower()
    if prefix.startswith(b"/avi(?:file)?source"):
        return True

    # Quoted AVI in an actual media-extension table. Requiring two neighbouring
    # video formats avoids treating an arbitrary identity string "avi" as safe.
    quoted = (
        start > 0 and end < len(data)
        and data[start - 1:start] in (b'"', b"'")
        and data[end:end + 1] == data[start - 1:start]
    )
    if quoted:
        local = data[max(0, start - 120):min(len(data), end + 120)].lower()
        if sum(neighbour in local for neighbour in _MEDIA_EXTENSION_NEIGHBOURS) >= 2:
            return True
    return False


def unexplained_low_entropy_matches(name, data, literals):
    """Return (literal, match) rows not covered by the narrow benign classifier."""
    out = []
    for lit in literals:
        rx = re.compile(lit_ere(lit).encode())
        for match in rx.finditer(data):
            if not low_entropy_match_is_benign(name, data, match):
                out.append((lit, match))
    return out


def file_has_unexplained_low_entropy(path, display_name, literals):
    """Mirror grep's low-entropy text-only rule for one candidate file."""
    try:
        data = open(path, "rb").read()
    except OSError:
        return True  # fail closed: unreadable cannot be certified benign
    if b"\0" in data:
        return False  # the low-entropy pass deliberately skips binary bytes
    return bool(unexplained_low_entropy_matches(display_name, data, literals))


def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)


def phase_a_paths(bundle, lits):
    """Member HEADERS — names, link targets, and ownership names.

    Not just names (WI-39462). This used to be `tar -tf -`, which prints member
    paths and nothing else, and phase B greps member CONTENT. A SYMLINK member
    falls between the two: its target string lives in the header's `linkname`
    field, it has zero payload bytes, and its own path is innocuous. So the owner's
    home path, committed as a tracked symlink target, was invisible to BOTH phases
    and this audit printed `✓ CLEAN` exit 0 on a bundle carrying it.

    Measured with a paired control: the SAME literal moved into a member's content
    failed correctly (exit 1, attributed), which is what makes this a header blind
    spot rather than a weak literal set. `stage-source-tree.sh` runs this mode as
    source.tar.zst's independent audit, so this was the gap that let 0.0.17 ship.

    Streaming `tarfile` over a `zstd -dc` pipe reads every header field in ONE pass
    — no second decompression — and covers ownership/pax names here too, matching
    what `_expand_tar_stream` records for the --scan-dir path.
    """
    proc = subprocess.Popen(["zstd", "-dc", bundle],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    n = 0
    hits = []
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            for member in tf:
                n += 1
                name = member.name
                for rule, rx, _globs in FORBIDDEN_PATH:
                    if rx.search(name):
                        hits.append((rule, name))
                        break
                else:
                    # Every header string that can carry an identity, with the
                    # field named in the finding so it is actionable: "in path"
                    # sends you looking at a filename, which is the wrong fix when
                    # the value is really a link target or a uid name.
                    # Search each header FIELD by its own value.  Prefixing the
                    # path onto uname/gname/link values made a path collision look
                    # like four independent header findings and defeated the
                    # low-entropy path rule below.
                    fields = [("path", name, name)]
                    if member.linkname:
                        fields.append(("link target", member.linkname,
                                       f"{name} -> {member.linkname}"))
                    if member.uname:
                        fields.append(("uid name", member.uname,
                                       f"{name} [uname={member.uname}]"))
                    if member.gname:
                        fields.append(("gid name", member.gname,
                                       f"{name} [gname={member.gname}]"))
                    for k, v in (member.pax_headers or {}).items():
                        fields.append(("pax header", f"{k}={v}",
                                       f"{name} [{k}={v}]"))
                    for rule, lit in lits.items():
                        for where, searchable, display in fields:
                            candidate = searchable
                            if where == "path" and is_low_entropy(lit):
                                candidate = semantic_path_for_low_entropy(searchable)
                            if lit_rx(lit).search(candidate):
                                hits.append((f"{rule} (in {where})", display))
                                break
                        else:
                            continue
                        break
    except tarfile.TarError as exc:
        proc.kill(); proc.wait()
        print(f"AUDIT ERROR: cannot list bundle: {exc}", file=sys.stderr)
        sys.exit(2)
    finally:
        if proc.stdout:
            proc.stdout.close()
    rc = proc.wait()
    if rc != 0:
        err = proc.stderr.read().decode("utf-8", "replace").strip() if proc.stderr else ""
        print(f"AUDIT ERROR: cannot list bundle: zstd exited {rc}: {err[:300]}",
              file=sys.stderr)
        sys.exit(2)
    return n, hits


def phase_b_content(bundle, lits):
    """Concatenated content through C grep. No filenames — that is phase C's job.

    TWO passes, because the needles have different trustworthiness:
      • BROAD  — credentials + high-entropy identity, over the WHOLE bundle.
                 A hit in node_modules is real: only a build on this box could
                 have put it there.
      • NARROW — low-entropy identity (a bare first name), over OUR TEXT SOURCE
                 ONLY. Vendored dictionaries and binary/compressed bytes are full
                 of chance three-letter matches that are not our owner.
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
    found = []
    for line in scan(broad):
        n, _, val = line.partition(" ")
        val = val.strip()
        rule = rev.get(val)
        if rule is None:
            for name, pat in CREDENTIAL_ERE:
                if re.fullmatch(pat.replace("[[:space:]]", r"\s"), val):
                    rule = name
                    break
        found.append((rule or "credential-or-identity", int(n), val))
    found.extend(phase_b_low_entropy_text(bundle, lits))
    return sorted(found, key=lambda row: (-row[1], row[0], row[2]))


def phase_b_low_entropy_text(bundle, lits):
    """Count short identity literals member-by-member, excluding binary files.

    The former narrow pass concatenated every non-vendor tar member and forced
    ``grep -a``.  That contradicted ``scan_dir`` and ``source_leakers``, which both
    deliberately use grep's binary-skip behavior for a three-letter name.  On the
    real source archive, random binary bytes produced four case variants of the
    owner name and made a clean build permanently red.

    Stream each member once, preserving cross-chunk matches.  Counts are committed
    only after the whole member proves NUL-free; if a later chunk reveals binary
    content, every provisional chance match from that member is discarded.  This
    keeps the fail-closed text coverage without treating compressed bytes as prose.
    """
    needles = [
        (rule, lit, re.compile(lit_ere(lit).encode()))
        for rule, lit in lits.items()
        if is_low_entropy(lit)
    ]
    if not needles:
        return []

    # Keep enough history/future bytes for low_entropy_match_is_benign() to
    # classify a match that straddles a 1 MiB chunk boundary. ``processed_start``
    # de-duplicates the overlapping windows by absolute match start.
    context = 192
    counts = {}
    proc = subprocess.Popen(["zstd", "-dc", bundle],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            for member in tf:
                if not member.isfile() or is_vendor(member.name):
                    continue
                fh = tf.extractfile(member)
                if fh is None:
                    continue
                local = {}
                tail = b""
                total_read = 0
                processed_start = 0
                binary = False
                while True:
                    chunk = fh.read(1024 * 1024)
                    if not chunk:
                        break
                    if b"\0" in chunk:
                        binary = True
                    if binary:
                        continue
                    data = tail + chunk
                    data_start = total_read - len(tail)
                    total_read += len(chunk)
                    safe_start = data_start + max(0, len(data) - context)
                    for rule, lit, rx in needles:
                        n = 0
                        for match in rx.finditer(data):
                            absolute_start = data_start + match.start()
                            if absolute_start < processed_start or absolute_start >= safe_start:
                                continue
                            if low_entropy_match_is_benign(member.name, data, match):
                                continue
                            n += 1
                        if n:
                            local[(rule, lit)] = local.get((rule, lit), 0) + n
                    processed_start = max(processed_start, safe_start)
                    tail = data[-(context * 2):]
                if not binary and tail:
                    data_start = total_read - len(tail)
                    for rule, lit, rx in needles:
                        n = 0
                        for match in rx.finditer(tail):
                            if data_start + match.start() < processed_start:
                                continue
                            if low_entropy_match_is_benign(member.name, tail, match):
                                continue
                            n += 1
                        if n:
                            local[(rule, lit)] = local.get((rule, lit), 0) + n
                if not binary:
                    for key, n in local.items():
                        counts[key] = counts.get(key, 0) + n
    except tarfile.TarError as exc:
        proc.kill()
        proc.wait()
        raise RuntimeError(f"cannot scan low-entropy tar members: {exc}") from exc
    finally:
        if proc.stdout:
            proc.stdout.close()
    rc = proc.wait()
    if rc != 0:
        err = proc.stderr.read().decode("utf-8", "replace").strip() if proc.stderr else ""
        raise RuntimeError(f"cannot scan low-entropy tar members: zstd exited {rc}: {err[:300]}")
    return [(rule, n, lit) for (rule, lit), n in counts.items()]


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
                    matches = list(rx.finditer(blob))
                    if scoped:
                        matches = [match for match in matches
                                   if not low_entropy_match_is_benign(
                                       m.name, blob, match)]
                    if matches:
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
# `.deb` is here because of a MEASURED false CLEAN, not on principle (EI-20108164746219771):
# the 0.0.15 SERVER .deb greps 0 on its raw bytes and 3 once decompressed. Without
# this entry the file is never handed to the expander at all, so the leak was
# reported as a pass — the exact "not inspected reads as clean" failure the archive
# pass exists to remove, reintroduced by an omission in the suffix list rather than
# by a gap in the machinery.
ARCHIVE_SUFFIXES = (
    ".tar.zst", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz", ".tar",
    ".zip", ".jar", ".asar", ".gz", ".zst", ".bz2", ".xz", ".dump",
    ".deb",
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


#: An expanded archive is treated as an OS ROOTFS when it has `usr/` plus at least
#: one other top-level system directory. Deliberately conservative — requiring the
#: PAIR keeps a source tree that merely happens to contain a `usr/` fixture from
#: being waved through, and everything here is still subject to the high-entropy
#: pass, which is what actually catches a leaked path/email/hostname.
SYSTEM_IMAGE_MARKERS = ("etc", "bin", "sbin", "lib", "var", "root")


def _looks_like_system_image(root):
    """Is this expanded archive an OS rootfs (a WSL/container image) rather than ours?"""
    try:
        top = {e.name for e in os.scandir(root) if e.is_dir()}
    except OSError:
        return False
    return "usr" in top and bool(top & set(SYSTEM_IMAGE_MARKERS))


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

    THE MANIFEST MUST CARRY OWNERSHIP, NOT JUST PATHS (WI-39458, MEASURED).
    `tar` stamps the BUILDING USER's name into every member's uid/gid NAME fields
    (`uname`/`gname`) unless told otherwise, and those fields are metadata: they
    are not any member's payload and not any member's path, so neither the
    content grep nor the name manifest could ever see them. Measured 2026-08-16
    on a PGDATA-shaped fixture whose contents were clean: this gate expanded the
    archive (`1 archive(s) expanded and scanned` — NOT a suffix-list miss) and
    printed `✓ CLEAN` exit 0, while `tar -tv` showed the build-box username on
    every member. The paired control — the SAME archive shape with the SAME
    literal moved into a member's CONTENT — failed correctly, which is what makes
    this a blind spot in the manifest rather than a weak literal set.

    It bites COMPRESSED tars specifically. In a plain `.tar` the header bytes are
    on disk in the clear, so the raw `grep -a` pass already reads them; gzip/zstd
    /xz hide them, and those are exactly the tars that ship (`db-seed.tar.gz`,
    `papercup-runtime.tar.gz`). The real leak this caught was `db-seed.tar.gz`,
    now also fixed at source in embedded-postgres-server/bin/build-seed.mjs —
    both halves are kept deliberately, because a source fix protects the archives
    we build and this one protects every archive we merely SHIP.

    ⚠ EVERY tar-like format MUST reach this function, or its metadata coverage is
    a fiction for whatever format skipped it. `.tar.zst` did skip it until
    WI-39462: `_expand_archive` matched a `.tar.zst` suffix branch BEFORE the
    `tarfile.is_tarfile()` branch that routes here, and expanded it with a shell
    `tar -xf`, which writes NO manifest at all. That silently exempted the single
    largest artifact we ship — `source.tar.zst`, the whole source tree — from
    linkname, member-name AND uname/gname scanning, so the ownership fix above
    never actually covered it. Measured on identical tar bytes: `.tar` produced a
    manifest carrying the leak, `.tar.zst` produced none. Route by CONTENT
    (is it a tar?), never by how it happens to be compressed.

    Returns False when a payload genuinely cannot be read — unknown is not absent.
    """
    with tarfile.open(path) as tf:
        return _expand_tar_stream(tf, dest, label=path)


def _expand_tar_stream(tf, dest, label="<tar>"):
    """The memberwise core of `_expand_tar_memberwise`, over an OPEN tarfile.

    Split out so a compression `tarfile` cannot open natively (zstd) can be piped
    in as a stream and get BYTE-IDENTICAL treatment — one scanner, no drift. It is
    written to work under `mode='r|'` (non-seekable) as well as random access:
    members are visited once, in order, and `extractfile` is called only on the
    member currently being iterated, which is the one case streaming mode supports.
    """
    os.makedirs(dest, exist_ok=True)
    names = []
    for idx, member in enumerate(tf):
        names.append(member.name)
        if member.linkname:
            names.append(member.linkname)
        # Ownership NAMES (see the docstring). Numeric uid/gid are deliberately
        # NOT recorded: an integer cannot carry an identity literal, and
        # emitting them would only add noise to a manifest that is grepped.
        if member.uname:
            names.append(member.uname)
        if member.gname:
            names.append(member.gname)
        # PAX headers are free-form key/value metadata (`tar --xattrs`, ACLs,
        # SCHILY.* records). Same argument as uname/gname: metadata, greppable
        # by nothing else, and a natural landing spot for a build path.
        for k, v in (member.pax_headers or {}).items():
            names.append(f"{k}={v}")
        if not member.isfile():
            continue
        src = tf.extractfile(member)
        if src is None:
            # A regular file whose payload will not open IS a hole in the scan.
            print(f"    scan-dir: {label}: member {member.name!r} payload unreadable")
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
            # `tarfile` has no zstd codec, which is why this used to be a shell
            # `zstd -dc | tar -xf -`. That shelled-out form had TWO defects, both
            # measured (WI-39462), and both produced a false CLEAN rather than an
            # error — so neither was ever visible in a build log:
            #
            #  1. It bypassed _expand_tar_memberwise entirely, so NO
            #     __member_names__.txt was written. Linknames, member names and
            #     uname/gname all went unscanned for `source.tar.zst` — the whole
            #     shipped source tree, and the largest artifact we produce. A
            #     symlink whose TARGET is the owner's home path has no content
            #     bytes and an innocuous name, so it was invisible to every phase.
            #  2. sh() runs shell=True against /bin/sh (dash — no pipefail), so the
            #     pipeline reported only `tar`'s status. A failing `zstd` feeding an
            #     empty stream to a `tar` that exits 0 returned True having
            #     extracted NOTHING. Identical to the hole the .deb branch below
            #     documents and guards; this branch never got the same treatment.
            #
            # Streaming the pipe into tarfile(mode='r|') fixes both at once: the
            # SAME memberwise reader handles it (no drift, no format exemption),
            # and zstd's own exit status is checked explicitly instead of being
            # swallowed by a pipeline. Route by CONTENT, not by compression.
            proc = subprocess.Popen(
                ["zstd", "-dc", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
                    ok = _expand_tar_stream(tf, dest, label=path)
            except tarfile.TarError as exc:
                proc.kill()
                proc.wait()
                print(f"    scan-dir: cannot expand {path}: {exc}")
                return False
            finally:
                if proc.stdout:
                    proc.stdout.close()
            rc = proc.wait()
            if rc != 0:
                err = (proc.stderr.read().decode("utf-8", "replace").strip()
                       if proc.stderr else "")
                print(f"    scan-dir: cannot expand {path}: zstd exited {rc}: {err[:200]}")
                return False
            return ok
        if low.endswith(".deb"):
            # A .deb is an `ar` archive whose payload is a NESTED data.tar.{zst,xz,gz}.
            # Extracting the ar members would leave that nested tarball unexpanded, and
            # this pass does NOT recurse — so the naive fix would re-create the very
            # false CLEAN it was written to remove. `dpkg-deb --fsys-tarfile` streams
            # the payload as a plain tar whatever the inner compression, collapsing
            # both layers in one hop.
            #
            # executable=/bin/bash + pipefail is LOAD-BEARING, not style: sh() runs
            # shell=True against /bin/sh (dash here), which has no pipefail, so a
            # pipeline reports only the LAST command's status. Without this, a box
            # with no dpkg-deb would fail the first stage, hand tar an empty stream,
            # and — if tar exited 0 — return True having extracted NOTHING. That is a
            # false CLEAN produced by the repair itself, so the check must be exact.
            if not shutil.which("dpkg-deb"):
                print(f"    scan-dir: cannot expand {path}: dpkg-deb not on PATH "
                      f"(a .deb this gate cannot open is a hole, not a pass)")
                return False
            r = sh(f"set -o pipefail; dpkg-deb --fsys-tarfile {q(path)} "
                   f"| tar -xf - -C {q(dest)}", executable="/bin/bash")
            if r.returncode != 0:
                print(f"    scan-dir: cannot expand {path}: "
                      f"dpkg-deb/tar exited {r.returncode}: {r.stderr.strip()[:200]}")
                return False
            # The control archive carries maintainer/packager fields — a natural
            # landing spot for a build-box identity, and invisible in the fsys payload.
            ctrl = os.path.join(dest, "__control__")
            os.makedirs(ctrl, exist_ok=True)
            rc = sh(f"set -o pipefail; dpkg-deb --ctrl-tarfile {q(path)} "
                    f"| tar -xf - -C {q(ctrl)}", executable="/bin/bash")
            if rc.returncode != 0:
                # The payload IS readable, so this is not the uninspectable case —
                # but say so rather than let a silently-skipped control archive read
                # as scanned.
                print(f"    scan-dir: {os.path.basename(path)}: payload expanded, "
                      f"control archive unreadable (exit {rc.returncode}) — "
                      f"maintainer fields NOT scanned")
            return True
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


def _high_entropy_pairs():
    """(literal, placeholder) pairs, LONGEST FIRST so '/home/<user>' is scrubbed
    before the bare '<user>' nested inside it. Low-entropy literals are excluded:
    a bare first name matches by chance in compiled bytes (WI-37553)."""
    lits = identity_literals()
    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    return sorted(
        ((v, REDACTION_BY_KEY.get(redaction_key(k), "redacted")) for k, v in lits.items()
         if v and not is_low_entropy(v)),
        key=lambda p: -len(p[0]),
    )


def _identity_pairs():
    """All identity/redaction pairs, longest first and de-duplicated by literal."""
    lits = identity_literals()
    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    seen = set()
    pairs = []
    for key, value in sorted(lits.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if not value or value in seen:
            continue
        seen.add(value)
        pairs.append((value, REDACTION_BY_KEY.get(redaction_key(key), "redacted")))
    return pairs


def _scrub_one(p, pairs):
    """Length-preserving identity scrub of ONE file, in place. Returns the hit
    list ([] when nothing matched, so the caller can stay quiet).

    Shared by --scrub-binaries and --scrub-app-binary so the two can never drift
    on the byte-length invariant, which is the property that makes this safe:
    every ELF/Mach-O offset, section size and relocation stays valid because the
    placeholder is truncated/padded to the literal's exact length.
    """
    try:
        data = open(p, "rb").read()
    except OSError:
        return []
    orig = data
    hits = []
    for lit, placeholder in pairs:
        b = lit.encode()
        if b not in data:
            continue
        rep = placeholder.encode()[:len(b)].ljust(len(b), b"_")
        hits.append(f"{lit} x{data.count(b)}")
        data = data.replace(b, rep)
    if not hits or data == orig:
        return []
    assert len(data) == len(orig), "scrub must preserve byte length"
    # Write a NEW inode and rename over it, never in place: the sidecar copier
    # hardlinks where the FS supports it, and an in-place write would reach
    # through every link.
    tmp_p = p + ".scrub.tmp"
    with open(tmp_p, "wb") as fh:
        fh.write(data)
    shutil.copymode(p, tmp_p)
    os.replace(tmp_p, p)
    return hits


#: Text file suffixes the sidecar doc scrub rewrites. Deliberately a SUFFIX
#: allowlist and not "anything grep calls text": the sidecar tree also holds
#: compiled addons and seed bundles, and those belong to --scrub-binaries, whose
#: byte-length invariant this function does NOT honor.
SCRUBBABLE_TEXT_SUFFIXES = (
    ".md", ".mdx", ".html", ".htm", ".txt", ".json",
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".sql", ".sh", ".py",
    ".yml", ".yaml", ".toml", ".xml", ".css", ".scss", ".rs",
)


def scrub_text(paths):
    """Redact build-box identity from explicitly selected SHIPPING TEXT.

    WHY THIS EXISTS — the gap between --prune-docs and --scan-dir:
    prune_docs() deletes by PATH (FORBIDDEN_PATH rules), while scan_dir() fails by
    CONTENT (identity needles). Those are different predicates, so a doc whose path
    is not internal-build-infra but whose TEXT quotes this box's home path passes the
    prune and then reds the gate. Measured on the 0.0.16 cut: 65 assembled files —
    28 source .mdx plus their rendered .md/.html twins — carried the build-home-path
    and the mac VM logins while every path rule passed clean.

    WHY SCRUB RATHER THAN PRUNE OR EDIT THE SOURCE: these docs SHIP on purpose (the
    app serves internal-docs via bin/host-docs.ts, and the .mdx source grounds
    docs-qa), so pruning removes a real feature. And per the STAGING SCRUB doctrine
    above, a per-file source edit is a treadmill — agents author new insight docs
    continuously and each new absolute path reds the next cut. Redacting a COPY at
    build time is the same remedy bin/stage-source-tree.sh already applies to
    source.tar.zst; this closes the sidecar half of that blind spot, which is
    precisely the route WI-4419 documents as bypassing the staged-source audit.

    Unlike _scrub_one() this does NOT preserve byte length: nothing here is linked
    or offset-addressed, and padding a placeholder out to the literal's width with
    underscores would corrupt readable prose for no benefit.

    High- and low-entropy literals are rewritten with the SAME case-folded regex the
    gate hunts. Low-entropy occurrences first pass through
    low_entropy_match_is_benign(), shared with every scan path, so AVI media tokens
    and opaque Vite fingerprints survive while authored ``avi`` identity does not.
    Explicit file arguments are accepted for stage-source-tree's already-proven text
    leakers; directory walks remain suffix-scoped and prune node_modules.
    """
    pairs = _identity_pairs()
    if not pairs:
        print("    scrub-text: no identity resolved — nothing to scrub")
        return 0

    def scrub_one(p, display_name):
        try:
            data = open(p, "rb").read()
        except OSError:
            return []
        if b"\0" in data:
            return []
        orig = data
        hits = []
        for lit, placeholder in pairs:
            rx = re.compile(lit_ere(lit).encode())
            low = is_low_entropy(lit)
            replaced = 0

            def replacement(match):
                nonlocal replaced
                if low and low_entropy_match_is_benign(display_name, data, match):
                    return match.group(0)
                replaced += 1
                return placeholder.encode()

            data = rx.sub(replacement, data)
            if replaced:
                hits.append(f"{lit} x{replaced}")
        if not hits or data == orig:
            return []
        # New inode + rename, never an in-place write: callers may hand us a
        # hardlinked sidecar/staging copy whose source of truth must stay untouched.
        tmp_p = p + ".scrub.tmp"
        with open(tmp_p, "wb") as fh:
            fh.write(data)
        shutil.copymode(p, tmp_p)
        os.replace(tmp_p, p)
        return hits

    total_files = 0
    for root in paths:
        if not os.path.exists(root):
            print(f"    scrub-text: {root} absent — skipping")
            continue
        scrubbed = []
        if os.path.isfile(root):
            hits = scrub_one(root, os.path.basename(root))
            if hits:
                scrubbed.append((os.path.basename(root), hits))
        else:
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d != "node_modules"]
                for fn in filenames:
                    if not fn.endswith(SCRUBBABLE_TEXT_SUFFIXES):
                        continue
                    p = os.path.join(dirpath, fn)
                    rel = os.path.relpath(p, root)
                    hits = scrub_one(p, rel)
                    if hits:
                        scrubbed.append((rel, hits))
        total_files += len(scrubbed)
        print(f"    scrub-text: {root} — scrubbed {len(scrubbed)} file(s)")
        for rel, hits in sorted(scrubbed):
            print(f"        ✂ {rel}: {', '.join(hits)}")
    print(f"    scrub-text: {total_files} file(s) rewritten")
    return 0


def scrub_app_binary(paths):
    """Scrub build-box identity out of explicitly named packaged executables.

    This is deliberately separate from --scrub-binaries: that flag walks a TREE
    selecting compiled addons by SCRUBBABLE_BINARY_SUFFIXES, while this flag takes
    explicit FILE paths and can never sweep a directory. Callers that must sanitize
    an extension-less executable (for example, a packaged Windows .exe or another
    release artifact) use this narrow form.

    Byte length is preserved exactly because the executable may already be linked;
    changing its size would invalidate offsets, sections, and relocations.
    """
    pairs = _high_entropy_pairs()
    if not pairs:
        print("    scrub-app-binary: no high-entropy literals on this box — nothing to do")
        return 0
    scrubbed = 0
    for p in paths:
        if not os.path.isfile(p):
            print(f"    scrub-app-binary: {p} absent — skipping")
            continue
        hits = _scrub_one(p, pairs)
        if hits:
            scrubbed += 1
            print(f"    ✂ scrubbed {os.path.basename(p)}: {', '.join(hits)}")
    print(f"    scrub-app-binary: {scrubbed} executable(s) scrubbed")
    return 0


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
    pairs = _high_entropy_pairs()
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
                hits = _scrub_one(p, pairs)
                if hits:
                    scrubbed += 1
                    print(f"    ✂ scrubbed {os.path.relpath(p, root)}: {', '.join(hits)}")
    print(f"    scrub-binaries: {scrubbed} compiled addon(s) scrubbed")
    return 0


def _scan_coverage(dirs):
    """Count what a `grep -r` pass over `dirs` will ACTUALLY read.

    Deliberately mirrors grep's own recursion rules rather than estimating
    optimistically: `grep -r` does not descend into a symlinked DIRECTORY and does
    not follow a symlinked FILE found during recursion, and `os.walk(...,
    followlinks=False)` matches that exactly. So this is the scan's real coverage
    — the number that makes a CLEAN falsifiable — not an upper bound on it.

    A SYMLINK'S TARGET IS ITSELF IDENTITY-BEARING CONTENT (WI-39462). A symlink has
    no payload — the target string lives in the directory entry — so `grep -r`
    never reads it and no working-tree scan we own could ever see it. That is not
    hypothetical: the owner's absolute home path sat COMMITTED in this repo as two
    tracked symlink blobs (mode 120000) and shipped inside every release's
    source.tar.zst, while every scan reported CLEAN. Naming the symlink in a ⚠
    coverage line (which this function already did) is NOT enough — the leaking
    path was printed in that very warning and the gate still exited 0.

    So targets are returned for SCANNING, not just for reporting, and files are
    included alongside directories: a symlinked FILE is skipped by grep for exactly
    the same reason and carries a target string just the same.

    Returns (regular_file_count, [symlinked dirs skipped], [(path, target) links]).
    """
    n_files = 0
    symlinked_dirs = []
    links = []

    def _record(p):
        try:
            links.append((p, os.readlink(p)))
        except OSError:
            # A link we cannot read is a hole, not a pass — surface it as such
            # rather than dropping it silently.
            links.append((p, "<unreadable link target>"))

    for root in dirs:
        # The scan roots THEMSELVES can be symlinks (a build stages its BuildRoot
        # out of links), and os.walk reports nothing about the root's own nature.
        if os.path.islink(root):
            _record(root)
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            for d in dirnames:
                p = os.path.join(dirpath, d)
                if os.path.islink(p):
                    symlinked_dirs.append(p)
                    _record(p)
            for f in filenames:
                p = os.path.join(dirpath, f)
                if os.path.islink(p):
                    _record(p)
                else:
                    n_files += 1
    return n_files, symlinked_dirs, links


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
    # ── THE PASS PATH MUST PROVE IT DID WORK (EI-20097383942651504) ────────────
    # This gate used to print "✓ CLEAN" and exit 0 for a directory that DOES NOT
    # EXIST: every root was skipped, no bytes were read, `files` stayed empty, and
    # empty read as clean. A release gate wired to a typo'd, renamed or unset-var
    # path is then a rubber stamp that can never fail — the most dangerous shape a
    # check can have, because its output is identical to a real pass. Found by
    # fat-fingering an unset shell variable into a scan path during the 0.0.14 cut.
    #
    # Same family as the `-I` hole this scan already closed (grep_l's docstring:
    # "A scan that inspects nothing is indistinguishable from a scan that found
    # nothing") — that fix taught the scan to READ binaries but left it free to
    # read NOTHING AT ALL. "Found no problems" and "looked at nothing" must not be
    # the same exit code, so coverage is asserted here and REPORTED on success.
    if not dirs:
        print("AUDIT ERROR: --scan-dir needs at least one directory", file=sys.stderr)
        return 2
    missing = [d for d in dirs if not os.path.isdir(d)]
    if missing:
        print(f"\n    ✗ SCAN TARGET MISSING — refusing to report CLEAN on a "
              f"directory that does not exist ({len(missing)} of {len(dirs)})\n",
              file=sys.stderr)
        for d in missing:
            print(f"        {d}", file=sys.stderr)
        print("\n  A gate pointed at a path that isn't there scans nothing and would "
              "'pass' forever.\n  Fix the caller's path (an unset shell variable "
              "expands to an empty argument).", file=sys.stderr)
        return 2

    lits = identity_literals()

    # ── THE QUERY SET MUST BE PROVEN TOO, NOT JUST THE CORPUS ──────────────────
    # This function already refuses to call CLEAN on a missing directory, on 0 files,
    # and on bytes nobody read — three hard-won guards, all asserting that the scan
    # READ everything. None of them asserts that it KNEW WHAT TO LOOK FOR.
    #
    # That is the gap EI-20583328178472869 fell through: git `user.name` became the
    # git-sync bot, so the owner's bare first name silently left `low` below, and this
    # backstop then read every byte, matched nothing, and reported CLEAN — passing all
    # three coverage guards on the way. Full corpus coverage, empty query.
    #
    # The name is the ONLY literal with no shape to fall back on (a home path or an
    # address is still caught structurally), so its absence cannot be recovered
    # downstream. Same principle as grep_l's "a scan that inspects nothing is
    # indistinguishable from a scan that found nothing" — applied to the NEEDLES.
    #
    # NOTE this runs BEFORE the KNOWN_SENSITIVE_IDENTITIES merge on purpose: that
    # denylist carries a github handle and VM logins but NO name entry, so merging
    # first would make a blind scan look equipped.
    if not has_owner_name_literal(lits):
        print("\n    ✗ REFUSING TO CERTIFY — no owner-name literal resolved, so this\n"
              "      backstop cannot hunt the owner's name and CLEAN would be meaningless.\n"
              f"      Fix: export {OWNER_NAME_ENV}='<the owner's name>' for this build.\n",
              file=sys.stderr)
        return 2

    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    high = sorted({v for v in lits.values() if not is_low_entropy(v)})
    low = sorted({v for v in lits.values() if is_low_entropy(v)})
    print("==> identity-scan of assembled tree (honors NO path-exclude — WI-4419)")
    print(f"    high-entropy (all files):  {', '.join(high) or '(none)'}")
    print(f"    low-entropy (non-vendor):  {', '.join(low) or '(none)'}")

    covered, symlinked_dirs, links = _scan_coverage(dirs)
    print(f"    coverage: {covered:,} file(s) reachable by the scan")

    # Symlink TARGETS, scanned as content (WI-39462). Collected before the ⚠ below
    # so that a link which is both untraversable AND leaking is reported as a
    # FINDING, not merely as a coverage caveat.
    link_hits = []
    if links:
        print(f"    symlinks: reading {len(links):,} link target(s) "
              f"(a target string is content no grep can reach)")
        for p, target in links:
            for rule, lit in lits.items():
                # Low-entropy literals (a bare first name) are NOT hunted here: a
                # path component legitimately matching a common first name would
                # red the gate on nothing, the same anti-false-positive scoping the
                # content passes use. A home path / user / host in a target is
                # high-entropy and unambiguous.
                if is_low_entropy(lit):
                    continue
                if lit_rx(lit).search(target):
                    link_hits.append((rule, p, target))
                    break

    if symlinked_dirs:
        # `grep -r` does not descend into a symlinked directory, so these ship but
        # are NOT scanned. Naming them keeps the blind spot visible instead of
        # letting it hide inside a CLEAN.
        print(f"    ⚠ {len(symlinked_dirs)} symlinked director(ies) are NOT traversed "
              f"by this scan (grep -r does not follow them):")
        for d in symlinked_dirs[:10]:
            print(f"        {d}")
        if len(symlinked_dirs) > 10:
            print(f"        … and {len(symlinked_dirs) - 10:,} more")
    if covered == 0:
        print(f"\n    ✗ SCAN READ NOTHING — refusing to report CLEAN on 0 files\n",
              file=sys.stderr)
        for d in dirs:
            print(f"        {d}", file=sys.stderr)
        print("\n  The director(ies) exist but hold no regular files the scan can "
              "read.\n  A directory of SYMLINKS scans as empty for exactly this "
              "reason — point the gate\n  at the assembled tree, not at a staging "
              "dir of links.", file=sys.stderr)
        return 2

    files = set()

    def grep_l(pats, scoped, roots, label=None, binary=True):
        """P-012: `-a` (treat binary as text), NEVER `-I` — for HIGH-entropy literals.

        This used to pass `-I` for everything, which SKIPS binary files entirely — so
        the scan billed as "the assembled bytes that actually ship" silently never
        looked at a database dump, a corestore, or any compiled artifact, and printed
        "✓ CLEAN". A scan that inspects nothing is indistinguishable from a scan
        that found nothing. phase_b_content already used `-a` for this reason.

        ⚠ BUT `-a` IS WRONG FOR A LOW-ENTROPY LITERAL (`binary=False`), and applying
        it to one made the gate cry wolf at scale (WI-37553). A bare first name is
        ~3 characters; word-boundary-matched across GIGABYTES of compiled and
        compressed bytes it matches CONSTANTLY by chance, and such a hit carries no
        information. Measured on the 0.0.14 AppDir: 9 of 16 "leaks" were noise —
        glibc's own `libm.so.6` matched; the GitHub CLI matched a Go symbol in
        `mimetype/internal/magic` naming the AVI VIDEO FORMAT; and the seed's git
        bundles matched random bytes inside zlib-compressed packfile data while
        containing ZERO plaintext author lines. That noise very nearly cost days of
        work removing a real feature to fix nothing.

        The asymmetry is the point, and it costs the gate NO power: a high-entropy
        literal (home path, username, email, hostname) stays hunted EVERYWHERE
        including binaries, because such a string cannot appear by chance. Only the
        low-entropy name is restricted to TEXT, where a word-boundary match is
        actually evidence. This is the P-012 fix kept intact, not walked back.
        """
        if not pats:
            return
        for root in roots:
            if not os.path.isdir(root):
                print(f"    scan-dir: {root} absent — skipping")
                continue
            cmd = ["grep", "-ralE" if binary else "-rlIE"]
            if scoped:
                cmd.append("--exclude-dir=node_modules")
            for p in pats:
                cmd += ["-e", lit_ere(p)]
            cmd.append(root)
            r = subprocess.run(cmd, capture_output=True, text=True)
            for line in r.stdout.splitlines():
                if line.strip():
                    hit = line.strip()
                    if not binary:
                        display_name = os.path.relpath(hit, root)
                        if not file_has_unexplained_low_entropy(
                                hit, display_name, pats):
                            continue
                    files.add(f"{label}!{os.path.relpath(hit, root)}" if label else hit)

    grep_l(high, False, dirs)
    grep_l(low, True, dirs, binary=False)

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
                # A SYSTEM IMAGE (an OS rootfs tarball, e.g. the WSL runtime) is
                # vendor content end to end, so a bare first name inside it is never
                # evidence — it is some upstream author's. Measured on the 0.0.14
                # AppDir: the only low-entropy hit in papercup-runtime.tar.gz was
                # `asm/vmx.h` line 21, the Linux kernel header crediting KVM's
                # co-creator, who happens to share the owner's first name. That is
                # the same class the gate already excludes node_modules for.
                # HIGH-entropy literals are STILL hunted here (see the call above):
                # a real build path, email or hostname baked into a rootfs is a
                # genuine leak and must still fail.
                # ⚠ Detected per-archive rather than by excluding directory NAMES:
                # `--exclude-dir` matches a BASENAME, so excluding `lib`/`include`
                # would also blind the scan inside our OWN source.tar.zst.
                if _looks_like_system_image(dest):
                    print(f"    archives: {os.path.basename(arc)} is an OS image — "
                          f"low-entropy (bare-name) pass skipped as vendor; "
                          f"high-entropy pass still applied")
                else:
                    grep_l(low, True, [dest], label=arc, binary=False)
                shutil.rmtree(dest, ignore_errors=True)

    if uninspectable:
        print(f"\n    ✗ {len(uninspectable)} ARCHIVE(S) COULD NOT BE INSPECTED — "
              f"refusing to report CLEAN on bytes nobody read\n")
        for f in uninspectable[:40]:
            print(f"        {f}")
        print("\n  An archive this gate cannot open is a hole in the identity scan, not a pass.")
        print("  Either teach _expand_archive its format, or stop shipping it.")
        return 1

    # ── Owner-authorised seed content (WI-37553, [owner 2026-08-10]) ───────────
    # The seed corestore IS the pot's own hive log, and this alpha ships the pot
    # READABLE by explicit owner decision (the same call as WI-3232's
    # epoch-keys.json). TWO different things put the build box's machine label in
    # there and only ONE of them is content — the distinction is the whole reason
    # this is an acceptance and not an exclude:
    #   • 000011.log — a `presence` row inside a hypercore BLOCK:
    #     "machine_label":"<hostname>-<user>". That is signed log content; the
    #     merkle tree covers those bytes, so editing them breaks
    #     content-addressing outright. Owner ruled: "Ship it — it's the pot's
    #     content."
    #   • *.sst — RocksDB TABLE PROPERTIES (`host.identity`, sitting beside
    #     `creating.db.identity` / `data.size` / `filter.policy`). NOT hypercore
    #     data and NOT content-addressed: RocksDB stamps the creating machine's
    #     hostname into every SST it writes. This one SHOULD be stripped at
    #     source (DBOptions::db_host_id = ""), but rocksdb-native exposes no such
    #     option today — tracked separately, and it is why the owner's "strip it
    #     if that is possible" resolves to "not yet" rather than "never".
    # Accepts ONLY those two literals, ONLY under a seed corestore path, and
    # NEVER inside an archive member (which we cannot re-read to prove the
    # negative). Every other identity literal still hard-fails there — a home
    # path, git email or git name in the seed is a real leak and is NOT covered
    # by the owner's ruling. Measured on the 0.0.14 seed those three are at ZERO,
    # so this keeps genuine power instead of blanket-excluding the directory,
    # which is what the "never add an exclude" rule below exists to prevent.
    seed_ok = {lits[k] for k in ("build-hostname", "build-user-name") if k in lits}
    accepted = []
    if files and seed_ok:
        others = [p for p in (high + low) if p not in seed_ok]
        kept = set()
        for f in sorted(files):
            norm = f.replace(os.sep, "/")
            if "!" in f or "/seed/corestore/" not in norm:
                kept.add(f)
                continue
            unauth = [p for p in others if _literal_in_file(f, p)]
            if unauth:
                print(f"    seed: {os.path.basename(f)} carries NON-authorised "
                      f"identity ({', '.join(unauth)}) — still FAILING")
                kept.add(f)
            else:
                accepted.append(f)
        files = kept
    if accepted:
        print(f"\n    ⚠ ACCEPTED {len(accepted)} seed-corestore file(s) carrying the "
              f"build-box machine label — owner-authorised; the pot ships READABLE.")
        for f in accepted[:10]:
            print(f"        {f}")
        print("      Hypercore block content cannot be edited without breaking "
              "content-addressing;\n      the *.sst copies are RocksDB host.identity "
              "table properties (strippable only at source).\n"
              "      Any OTHER identity literal here would still have failed.")

    # ── Authorised product strings (WI-38233) ─────────────────────────────────
    # See AUTHORISED_PRODUCT_STRINGS for WHY each entry ships. The rule here is
    # arithmetic, not pattern-matching: count every occurrence of each identity
    # literal in the file, count how many of those occurrences are inside an
    # authorised string, and accept ONLY on equality. Anything unaccounted for
    # keeps the file failing. Never applied inside an archive member ("!"), whose
    # bytes we cannot re-read to prove the negative.
    authorised = []
    if files:
        kept = set()
        for f in sorted(files):
            if "!" in f:
                kept.add(f)
                continue
            unexplained = []
            for lit in (high + low):
                n = _count_literal(f, lit)
                if n == 0:
                    continue
                if n < 0:
                    unexplained.append(f"{lit} (unreadable)")
                    continue
                covered = 0
                for ok_str in AUTHORISED_PRODUCT_STRINGS:
                    if lit in ok_str:
                        c = _count_occurrences(f, ok_str)
                        if c > 0:
                            covered += c * ok_str.count(lit)
                if covered != n:
                    unexplained.append(f"{lit} x{n - covered} unaccounted")
            if unexplained:
                kept.add(f)
            else:
                authorised.append(f)
        files = kept
    if authorised:
        print(f"\n    ⚠ ACCEPTED {len(authorised)} file(s) whose ONLY identity hits are "
              f"authorised product strings (WI-38233):")
        for f in authorised[:10]:
            print(f"        {os.path.basename(f)}")
        print("      Every occurrence was counted and matched to an authorised string;\n"
              "      one unaccounted occurrence would still have FAILED the file.")

    # Symlink-target findings are reported SEPARATELY and are deliberately NOT run
    # through the seed / authorised-product-string acceptance passes above: both
    # re-READ the offending file to prove the negative by counting occurrences, and
    # a symlink has no content to re-read. Accepting one on a content argument would
    # be accepting it on evidence that does not exist.
    if link_hits:
        print(f"\n    ✗ SYMLINK TARGET(S) CARRY SENSITIVE IDENTITY — MUST NOT SHIP "
              f"({len(link_hits)} link(s))\n")
        for rule, p, target in link_hits[:40]:
            print(f"        [{rule}]  {p} -> {target}")
        if len(link_hits) > 40:
            print(f"        … and {len(link_hits) - 40:,} more")
        print("\n  A symlink's TARGET is committed content: the git blob of a mode-120000")
        print("  entry IS the target string, so an absolute path here ships the build")
        print("  box's layout. `grep -r` never reads a symlink, which is why this could")
        print("  sit in the tree unnoticed — do not 'fix' it by re-hiding it from the scan.")
        print("  Fix the SOURCE: make the link repo-relative, or stop tracking it.")

    if not files and not link_hits:
        print("    ✓ CLEAN — no sensitive/build-box identity in the assembled bundle "
              f"({covered:,} file(s), {len(links):,} link target(s), "
              f"{len(archives)} archive(s) expanded and scanned)")
        print_coverage_gaps(identity_coverage_gaps(lits))
        return 0
    if files:
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


#: The FINISHED artifacts we publish — installer CONTAINERS, not tree members.
#:
#: ⚠ DELIBERATELY NOT MERGED INTO ARCHIVE_SUFFIXES, and that separation is the
#: whole design (WI-39458). `_iter_archives` walks the WHOLE scanned tree, so
#: teaching it `.exe` would hand it every vendored Windows helper binary in
#: node_modules and every .NET assembly — none of which any expander can open —
#: and each would then become "uninspectable", i.e. a RED on every cut. That
#: converts a false PASS into a permanent false FAILURE, which is not a fix.
#:
#: A container is instead named EXPLICITLY by the caller, one artifact at a
#: time, so the fail-closed rule below applies to the handful of files we are
#: about to publish and to nothing else.
ARTIFACT_SUFFIXES = (".exe", ".msi", ".dmg", ".appimage", ".zip", ".bin",
                     ".deb", ".tar.gz", ".tar.zst", ".app.tar.gz")

#: An expansion that "succeeded" while recovering almost nothing is the SAME
#: false-clean this entrypoint exists to remove, one level deeper — and it is
#: not hypothetical. Pointed at an Inno Setup PE, `7z` misdetects the stub as
#: gzip, exits 0, and recovers ~49KB of a 4.5MB installer. Scanning that 1%
#: and reporting CLEAN would be strictly worse than not scanning at all,
#: because the verdict reads as evidence. So coverage is ASSERTED, not assumed:
#: a container must yield a plausible fraction of its own size or it is
#: uninspectable. Installers are compressed, so a real expansion is normally
#: LARGER than the container and this floor has generous headroom.
ARTIFACT_MIN_EXPANSION_RATIO = 0.10


def _tree_bytes(root):
    """Total bytes of regular files under `root` (symlinks not followed)."""
    total = 0
    for dirpath, _dirnames, filenames in os.walk(root, followlinks=False):
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            if os.path.islink(p):
                continue
            try:
                total += os.path.getsize(p)
            except OSError:
                pass
    return total


def _expand_installer(path, dest):
    """Expand ONE finished installer container. Returns (ok, method).

    The tool LADDER is ordered by specificity, because a generic extractor that
    merely exits 0 is the failure mode here, not a missing extractor:

      • `.exe` → innoextract FIRST. This project's Windows installer is Inno
        Setup 6 (build-windows-cross.sh packs it with ISCC under wine and emits
        `bundle/inno/`), and the Server role DISK-SPANS into a `setup.exe` stub
        plus `-setup-N.bin` slices. innoextract given the stub follows those
        sibling slices itself, which is the only way the ~2.2GB payload is ever
        actually read. 7z is tried after it, for a genuine NSIS installer.
      • `.AppImage` → its embedded runtime's `--appimage-extract` first. The
        AppImages this project emits use zstd-compressed SquashFS, which the
        host's 7z can identify but cannot extract. The runtime is the producer's
        own format reader and this mode extracts without launching AppRun.
      • `.dmg` → 7z first; libdmg-hfsplus fallback for DMGs produced by this
        repo's mac cross-builder. 7z can decode their outer UDIF but reports
        Data Error on some valid HFS+ members; the producer's hfsplus reader
        can extract those same members from the raw partition.
      • `.msi` / `.bin` → 7z, whose MSI/Udf handlers cover them.
      • anything `_expand_archive` already knows (.zip/.tar.*/.deb) → that, so
        the two entrypoints cannot drift in how they read a format they share.

    Returns ok=False when nothing could open it. The CALLER fails closed on that
    — an installer this gate cannot open is a hole in the identity scan, not a
    pass, exactly as for a tree archive.
    """
    os.makedirs(dest, exist_ok=True)
    low = path.lower()

    if low.endswith(".exe"):
        if shutil.which("innoextract"):
            # --extract-unknown keeps files innoextract cannot classify rather
            # than dropping them: an unclassified blob still has to be scanned.
            r = sh(f"innoextract -e -s --output-dir {q(dest)} {q(path)}")
            if r.returncode == 0 and _tree_bytes(dest) > 0:
                return True, "innoextract"
        if shutil.which("7z"):
            r = sh(f"7z x -y -bd -o{q(dest)} -tnsis {q(path)}")
            if r.returncode == 0 and _tree_bytes(dest) > 0:
                return True, "7z -tnsis"
            # Generic last rung: a self-extracting `.exe` is commonly a zip/7z/cab
            # with a PE stub glued in front, and 7z identifies those by content.
            # It is safe to try LAST precisely because the caller's expansion-ratio
            # floor catches 7z's known failure mode here — misdetecting an Inno PE
            # as gzip and "succeeding" with a ~49KB fragment of a 4.5MB installer.
            r = sh(f"7z x -y -bd -o{q(dest)} {q(path)}")
            if r.returncode == 0 and _tree_bytes(dest) > 0:
                return True, "7z"
        return False, "none"

    if low.endswith(".appimage"):
        if os.access(path, os.X_OK):
            # `--appimage-extract` is handled by the embedded AppImage runtime;
            # it does NOT execute the packaged AppRun. Run inside `dest` because
            # the runtime always writes a fixed `squashfs-root/` sibling. Silence
            # its one-line-per-member stdout — scan_dir below is the auditable
            # coverage report, and a 15k-file member list only obscures failures.
            r = subprocess.run(
                [path, "--appimage-extract"],
                cwd=dest,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            extracted = os.path.join(dest, "squashfs-root")
            if r.returncode == 0 and _tree_bytes(extracted) > 0:
                return True, "AppImage runtime"
            detail = (r.stderr or "").strip().replace("\n", " ")[:200]
            print(f"    scan-artifact: AppImage runtime extraction failed for {path}: "
                  f"exit {r.returncode}{f': {detail}' if detail else ''}")
        else:
            print(f"    scan-artifact: {path} is not executable; "
                  "cannot invoke its AppImage extraction runtime")
        # Keep 7z as a compatibility fallback for older gzip/xz AppImages it can
        # genuinely expand. The caller's ratio floor rejects its known partial
        # extraction shapes, so a false zero cannot become a clean verdict.
        if shutil.which("7z"):
            r = sh(f"7z x -y -bd -o{q(dest)} {q(path)}")
            if r.returncode == 0 and _tree_bytes(dest) > 0:
                return True, "7z"
        return False, "AppImage runtime+7z"

    if low.endswith(".dmg"):
        if not shutil.which("7z"):
            print(f"    scan-artifact: cannot expand {path}: 7z not on PATH "
                  f"(a container this gate cannot open is a hole, not a pass)")
            return False, "none"
        r = sh(f"7z x -y -bd -o{q(dest)} {q(path)}")
        if r.returncode == 0 and _tree_bytes(dest) > 0:
            return True, "7z"

        # EI-21026285649061558 — libdmg-hfsplus parity with the PRODUCER.
        # build-mac-cross.sh creates these DMGs as:
        #   raw HFS+ image → hfsplus addall → `dmg` UDIF compression.
        # The host 7z can list the final DMG and inflate its outer partition,
        # but its nested HFS reader reports Data Error on valid large/sparse
        # members (measured on the 0.0.18 GUI+Server DMGs). Accepting its partial
        # tree would certify bytes nobody read. Instead, force 7z to decode ONLY
        # the outer DMG layer (`-tDmg`), then hand the raw HFS+ partition to the
        # exact tool family that wrote it. The same PAPERCUSP_MAC_CROSS_TOOLS
        # seam/default as build-mac-cross.sh prevents a parallel tool locator.
        mac_tools = os.environ.get(
            "PAPERCUSP_MAC_CROSS_TOOLS",
            os.path.join(os.path.expanduser("~"), ".papercusp", "mac-cross-tools"),
        )
        hfsplus = os.path.join(mac_tools, "hfsplus")
        outer = dest + ".dmg-outer"
        shutil.rmtree(dest, ignore_errors=True)
        shutil.rmtree(outer, ignore_errors=True)
        os.makedirs(dest, exist_ok=True)
        os.makedirs(outer, exist_ok=True)
        try:
            if not os.access(hfsplus, os.X_OK):
                print(f"    scan-artifact: 7z could not fully extract {path}, and "
                      f"libdmg-hfsplus reader is missing/not executable at {hfsplus}")
                return False, "7z+libdmg-hfsplus"
            r = sh(f"7z x -y -bd -tDmg -o{q(outer)} {q(path)}")
            raw_parts = []
            if r.returncode == 0:
                for dirpath, _dirnames, filenames in os.walk(outer):
                    for filename in filenames:
                        candidate = os.path.join(dirpath, filename)
                        if os.path.isfile(candidate) and os.path.getsize(candidate) > 0:
                            raw_parts.append(candidate)
            if len(raw_parts) != 1:
                print(f"    scan-artifact: outer DMG decode yielded {len(raw_parts)} "
                      f"nonempty raw partitions for {path}; expected exactly one")
                return False, "7z -tDmg+libdmg-hfsplus"
            r = subprocess.run(
                [hfsplus, raw_parts[0], "extractall"],
                cwd=dest,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            if r.returncode == 0 and _tree_bytes(dest) > 0:
                return True, "7z -tDmg + libdmg-hfsplus"
            detail = (r.stderr or "").strip().replace("\n", " ")[:200]
            print(f"    scan-artifact: libdmg-hfsplus extraction failed for {path}: "
                  f"exit {r.returncode}{f': {detail}' if detail else ''}")
            return False, "7z -tDmg+libdmg-hfsplus"
        finally:
            # The raw partition is larger than both the DMG and extracted tree;
            # it is only an intermediate reader seam and must not double the
            # audit's disk footprint while scan_dir walks the real payload.
            shutil.rmtree(outer, ignore_errors=True)

    if low.endswith((".msi", ".bin")):
        if not shutil.which("7z"):
            print(f"    scan-artifact: cannot expand {path}: 7z not on PATH "
                  f"(a container this gate cannot open is a hole, not a pass)")
            return False, "none"
        r = sh(f"7z x -y -bd -o{q(dest)} {q(path)}")
        if r.returncode == 0 and _tree_bytes(dest) > 0:
            return True, "7z"
        return False, "7z"

    # Shared formats go through the ONE expander both entrypoints use.
    if not _expand_archive(path, dest):
        return False, "archive-pass"

    # ── A WRAPPER IS NOT THE PAYLOAD (WI-39458) ──────────────────────────────
    # The published Windows Server artifact is a `.zip` whose three members are
    # an Inno Setup STUB (`…-setup.exe`, ~4.5MB) plus its DiskSpan slices
    # (`…-setup-1.bin` ~2.0GB, `…-setup-2.bin` ~140MB). Expanding the zip alone
    # therefore "succeeds", passes the size-ratio check comfortably (~2.2GB out
    # of a 2.2GB container), and leaves ~100% of the real payload sitting in two
    # blobs that the scan can only grep as opaque bytes. That is the SAME false
    # clean this entrypoint exists to remove, one level down — and it is the
    # exact artifact this item was filed on, so failing to recurse here would
    # ship a fix that does not fix the reported case.
    #
    # ⚠ RECURSION IS DELIBERATELY NARROW — an installer STUB, not every `.exe`.
    # The expanded payload legitimately contains program executables we bundle
    # (node.exe, gh.exe). Blanket-recursing on `.exe` would hand those to an
    # expander that cannot open them, mark them uninspectable, and red every
    # cut — re-creating, inside this entrypoint, precisely the regression that
    # keeps `.exe` out of ARCHIVE_SUFFIXES. So only a file that names itself a
    # setup stub is treated as a container.
    #
    # SNAPSHOT FIRST: the loop writes new directories INTO `dest`, and walking a
    # tree while extending it can descend into what the loop just produced — an
    # inner installer that itself contains a stub would then recurse without
    # bound. Collect, then expand.
    stubs = []
    for dirpath, _dirnames, filenames in os.walk(dest, followlinks=False):
        for fn in filenames:
            if _looks_like_installer_stub(fn):
                stubs.append((dirpath, fn))
    for dirpath, fn in stubs:
        stub = os.path.join(dirpath, fn)
        inner = os.path.join(dest, f"__inner__{fn}")
        ok, how = _expand_installer(stub, inner)
        if not ok:
            print(f"    scan-artifact: {os.path.basename(path)} wraps installer "
                  f"{fn!r}, which could NOT be expanded (tried: {how}) — "
                  f"its payload is a hole, not a pass")
            return False, f"archive-pass+{how}"
        print(f"    scan-artifact: {os.path.basename(path)} wraps {fn!r} — "
              f"expanded its payload via {how}")
    return True, "archive-pass"


#: A file that NAMES ITSELF an installer stub. Kept as its own predicate so the
#: narrowness above is testable and cannot quietly widen into "every .exe".
def _looks_like_installer_stub(name):
    low = name.lower()
    if low.endswith((".msi", ".dmg", ".appimage")):
        return True
    # Tauri/Inno emit `<Product>_<version>_<arch>-setup.exe`; the DiskSpan
    # slices beside it are `-setup-N.bin` and are pulled in BY the stub, so they
    # must NOT be expanded independently (innoextract needs the stub to find
    # them, and 7z on a raw slice recovers a misdetected fragment).
    return low.endswith("-setup.exe") or low.endswith("setup.exe")


def scan_artifact(paths):
    """Identity-scan FINISHED installer artifacts — the bytes we actually publish.

    WHY THIS EXISTS SEPARATELY FROM --scan-dir (WI-39458, measured):
    `--scan-dir` scans an assembled TREE and expands the archives it finds inside
    it. Handed a finished installer it therefore does the one thing this gate is
    written to prevent — it greps the container as opaque bytes, expands ZERO
    archives, and reports a POSITIVE clean. Measured 2026-08-16 on the published
    0.0.17 `Papercusp Server_..._x64-setup.zip` (2,240,463,722 B): the gate printed
    "✓ CLEAN … 3 file(s), 0 archive(s) expanded and scanned" and exited 0, while the
    installer's own payload carried the build-box username. ~100% of the shipped
    bytes were never read. The paired control — the same artifact EXTRACTED, then
    `--scan-dir`'d — exits 1 DIRTY. The same bytes cannot be both, so the CLEAN
    verdicts were false.

    Note the AppImage behaved CORRECTLY in that same measurement (7z failed on it,
    coverage was 0, and the gate REFUSED with exit 2). The machinery was never the
    problem; nothing was routing installers INTO it.

    The contract here is fail-closed on three separate ways of learning nothing:
    a container that cannot be opened, one that opens but yields no files, and one
    that opens but recovers an implausible fraction of itself. Once expanded, the
    tree is handed to `scan_dir` — the same literal set, coverage assertion, nested
    archive pass and acceptances — so there is no second scanner to drift.
    """
    if not paths:
        print("AUDIT ERROR: --scan-artifact needs at least one artifact", file=sys.stderr)
        return 2
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        print(f"\n    ✗ ARTIFACT MISSING — refusing to report CLEAN on a file that "
              f"does not exist ({len(missing)} of {len(paths)})\n", file=sys.stderr)
        for p in missing:
            print(f"        {p}", file=sys.stderr)
        print("\n  A gate pointed at a path that isn't there scans nothing and would "
              "'pass' forever.\n  Fix the caller's path (an unset shell variable "
              "expands to an empty argument).", file=sys.stderr)
        return 2

    unknown = [p for p in paths if not p.lower().endswith(ARTIFACT_SUFFIXES)]
    if unknown:
        # Not a silent skip: an artifact shape this entrypoint has never been
        # taught is precisely the thing that must not sail through as clean.
        print(f"\n    ✗ UNRECOGNISED ARTIFACT TYPE — refusing to certify "
              f"({len(unknown)} of {len(paths)})\n", file=sys.stderr)
        for p in unknown:
            print(f"        {p}", file=sys.stderr)
        print("\n  Teach ARTIFACT_SUFFIXES + _expand_installer this container, or "
              "stop publishing it.", file=sys.stderr)
        return 2

    print("==> identity-scan of FINISHED artifacts (the published bytes — WI-39458)")
    with tempfile.TemporaryDirectory(prefix="papercusp-audit-artifact-") as tmp:
        dests = []
        uninspectable = []
        for idx, art in enumerate(paths):
            dest = os.path.join(tmp, f"art{idx}")
            size = os.path.getsize(art)
            ok, method = _expand_installer(art, dest)
            got = _tree_bytes(dest) if ok else 0
            ratio = (got / size) if size else 0.0
            if not ok or got == 0:
                uninspectable.append((art, f"could not expand (tried: {method})"))
                continue
            if ratio < ARTIFACT_MIN_EXPANSION_RATIO:
                uninspectable.append((
                    art,
                    f"expanded via {method} but recovered only {got:,} of {size:,} B "
                    f"({ratio:.1%}) — below the {ARTIFACT_MIN_EXPANSION_RATIO:.0%} floor",
                ))
                continue
            print(f"    {os.path.basename(art)}: expanded via {method} — "
                  f"{got:,} B from a {size:,} B container ({ratio:.0%})")
            dests.append(dest)

        if uninspectable:
            print(f"\n    ✗ {len(uninspectable)} ARTIFACT(S) COULD NOT BE INSPECTED — "
                  f"refusing to report CLEAN on bytes nobody read\n", file=sys.stderr)
            for f, why in uninspectable[:40]:
                print(f"        {f}\n            {why}", file=sys.stderr)
            print("\n  An archive this gate cannot open is a hole in the identity scan, "
                  "not a pass.", file=sys.stderr)
            print("  Either teach _expand_installer its format, or stop shipping it.",
                  file=sys.stderr)
            return 2

        return scan_dir(dests)


def print_identity_literals():
    """Emit `value<TAB>redaction<TAB>wordboundary(0/1)<TAB>sed_ere` for every identity
    literal the gate hunts — build-box identity + the known cross-box sensitive set — so
    bin/stage-source-tree.sh scrubs EXACTLY what this gate would later fail on, from
    the one source of truth (no second list to drift). LONGEST value first so an
    overlapping pair is applied safely (/home/<user> before the bare <user> inside
    it). A value with no explicit REDACTION_BY_KEY token falls back to 'redacted'.

    COLUMN 4 (sed_ere) is the ready-to-use `sed -E` pattern — lit_ere() with the
    delimiter escaped — and it exists so the scrub inherits this gate's CASE rule
    instead of re-deriving it. The stager used to rebuild the pattern itself from
    column 1, which is how the scrub stayed case-SENSITIVE after the gate stopped
    being (EI-20589264759185712): two hand-kept derivations of "the same" rule, and
    the quiet one wins. Columns 1-3 stay for compatibility; a stager that reads only
    them still works, it is just the older, case-sensitive behaviour.
    """
    lits = identity_literals()
    lits.update(KNOWN_SENSITIVE_IDENTITIES)
    seen = set()
    for key, val in sorted(lits.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if val in seen:
            continue
        seen.add(val)
        red = REDACTION_BY_KEY.get(redaction_key(key), "redacted")
        wb = "1" if needs_word_boundary(val) else "0"
        # `/` is the stager's s/// delimiter; escape it so a home path cannot end
        # the substitution early. Every other metacharacter is already re.escape()d.
        sed_ere = lit_ere(val).replace("/", r"\/")
        print(f"{val}\t{red}\t{wb}\t{sed_ere}")
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

    def hunt(pats, low_entropy=False):
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
                if low_entropy and not file_has_unexplained_low_entropy(
                        line, rel, pats):
                    continue
                leakers.add(rel)

    hunt(high)
    hunt(low, low_entropy=True)
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
    if sys.argv[1] == "--scrub-text":
        return scrub_text(sys.argv[2:])
    if sys.argv[1] == "--scrub-app-binary":
        return scrub_app_binary(sys.argv[2:])
    if sys.argv[1] == "--scan-dir":
        return scan_dir(sys.argv[2:])
    if sys.argv[1] == "--scan-artifact":
        return scan_artifact(sys.argv[2:])
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

    # FAIL CLOSED when the owner's NAME cannot be resolved (EI-20583328178472869).
    #
    # This audit's whole value is that a CLEAN verdict is EVIDENCE. Without a name
    # literal it cannot hunt the one identity class with no shape to fall back on, so
    # "✓ CLEAN" degrades to "I looked for nothing" while still reading as proof to the
    # human and to the publish script's `|| exit`. That is strictly worse than no gate:
    # it turns an unverified bundle into an apparently-verified one.
    #
    # The KNOWN_SENSITIVE_IDENTITIES denylist below does NOT cover this: it carries the
    # owner's github handle and some VM logins, but no name entry — so with git blind,
    # nothing whatsoever hunts the bare first name that `needs_word_boundary` exists for.
    #
    # Exit 2 (cannot check), never 1 (found leaks): a caller must be able to tell a blind
    # gate from a clean one.
    if not has_owner_name_literal(lits):
        print(
            "    ✗ REFUSING TO CERTIFY — no owner-name literal resolved, so this scan\n"
            "      cannot detect the owner's name in the bundle and a CLEAN verdict would\n"
            "      be meaningless.\n"
            f"      Cause: `git config user.name` is unset or belongs to an automation.\n"
            f"      Fix:   export {OWNER_NAME_ENV}='<the owner's name>' for this build.",
            file=sys.stderr,
        )
        return 2
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
        print_coverage_gaps(identity_coverage_gaps(lits))
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
