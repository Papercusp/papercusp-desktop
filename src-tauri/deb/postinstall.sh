#!/bin/sh
# Linux install parity with the macOS app (linux-chat-dock-parity-2026-06-27 +
# psu-on-path). Provisions the two things the mac install gives that the Linux
# .deb didn't:
#   (1) the `psu` / `ptool` launchers on the SYSTEM PATH so they work in ANY
#       terminal right after install (the mac app writes these per-user via
#       installPapercuspFiles; that path didn't run on Linux → `psu: command not
#       found`), and
#   (2) ghostty — the chat dock's host terminal: a maintainer-PPA package,
#       impractical to bundle (~108 shared-lib deps), so we install it on first
#       install.
# Everything is guarded so it can NEVER fail the package install.
set -e

# Only on a real install/upgrade configure.
[ "$1" = "configure" ] || exit 0

SC=/usr/lib/Papercusp/sidecar

# ── (1) psu / ptool → /usr/bin (immediate, deterministic) ───────────────────
# Thin wrappers that exec the BUNDLED node + launcher (so they work even with no
# Node on the user's PATH — same rationale as the mac per-user shim). Written only
# when the bundled launcher + node are actually present.
for tool in psu ptool; do
  launcher="$SC/scripts/$tool.mjs"
  if [ -f "$launcher" ] && [ -x "$SC/bin/node" ]; then
    cat > "/usr/bin/$tool" <<WRAP
#!/usr/bin/env bash
# papercusp $tool launcher — managed by the Papercusp .deb (postinst). Do not edit.
exec "$SC/bin/node" "$launcher" "\$@"
WRAP
    chmod 755 "/usr/bin/$tool"
  fi
done

# ── (1b) `papercusp` dispatcher + the Papercusp Tutorial & Setup desktop icon ─
# (agent-first-onboarding-2026-07-03 P-014.) `papercusp setup` (alias `onboard`)
# runs the terminal concierge; `papercusp tutorial` re-opens the guided tutorial on
# an already-onboarded machine. The third .desktop entry sits beside the two
# Tauri-bundled icons (Papercusp Server + Papercusp GUI) and opens the same
# command in the user's terminal. Guarded like everything else — never fails
# the install.
if [ -f "$SC/scripts/onboard.mjs" ] && [ -x "$SC/bin/node" ]; then
  cat > /usr/bin/papercusp <<WRAP
#!/usr/bin/env bash
# papercusp CLI dispatcher — managed by the Papercusp .deb (postinst). Do not edit.
cmd="\${1:-}"
case "\$cmd" in
  setup)    shift; exec "$SC/bin/node" "$SC/scripts/onboard.mjs" --tab=setup "\$@" ;;
  tutorial) shift; exec "$SC/bin/node" "$SC/scripts/onboard.mjs" --tutorial "\$@" ;;
  onboard)  shift; exec "$SC/bin/node" "$SC/scripts/onboard.mjs" "\$@" ;;
  *) echo "usage: papercusp <setup|tutorial>"; echo "  setup     open the Tutorial & Setup shell on the Setup tab"; echo "  tutorial  open the Tutorial & Setup shell on the Tutorial tab"; exit 2 ;;
esac
WRAP
  chmod 755 /usr/bin/papercusp

  # Third icon: reuse the app icon the Tauri bundle installed (papercusp-desktop
  # is the shared binary/icon name for both bundles). Terminal=true → the DE
  # opens its default terminal emulator running the concierge.
  if [ -d /usr/share/applications ]; then
    cat > /usr/share/applications/papercusp-tutorial.desktop <<'DESK'
[Desktop Entry]
Type=Application
Name=Papercusp Tutorial & Setup
Comment=Open the guided Papercusp tutorial and setup (tabs for both)
Exec=/usr/bin/papercusp tutorial
Icon=papercusp-desktop
Terminal=true
Categories=Development;
DESK
    command -v update-desktop-database >/dev/null 2>&1 && \
      update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
  fi
fi

# ── (2) ghostty — deferred, best-effort ─────────────────────────────────────
# A postinst CANNOT call apt directly (dpkg holds the apt lock for THIS
# transaction → deadlock), so defer the PPA-add + install to a detached worker
# that waits for the lock to free. Best-effort; never blocks or fails the install.
if ! command -v ghostty >/dev/null 2>&1; then
  setsid sh -c '
    i=0
    while [ "$i" -lt 90 ]; do
      command -v fuser >/dev/null 2>&1 || break
      fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
      i=$((i + 1)); sleep 2
    done
    export DEBIAN_FRONTEND=noninteractive
    command -v add-apt-repository >/dev/null 2>&1 || \
      apt-get install -y software-properties-common >/dev/null 2>&1 || true
    add-apt-repository -y ppa:mkasberg/ghostty-ubuntu >/dev/null 2>&1 || true
    apt-get update -y >/dev/null 2>&1 || true
    apt-get install -y ghostty >/dev/null 2>&1 || true
  ' </dev/null >/dev/null 2>&1 &
fi

exit 0
