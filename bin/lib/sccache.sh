#!/usr/bin/env bash
# Shared sccache setup (WI-5083, plan desktop-build-speed-2026-07-16#P-004).
#
# Puts a compiler cache in front of every rustc invocation on the LOCAL Linux
# leg (release-local.sh's Linux subshell + build-linux-local.sh) and the
# Darwin VM leg (mac-vm-build.sh), backed by a PERSISTENT on-disk cache — so
# even a from-scratch `tauri build` (a clean checkout, a rotated
# ~/.cargo-target, a freshly-reverted VM snapshot) reuses object code already
# compiled from an earlier build instead of recompiling every crate from
# zero. sccache keys on the PREPROCESSED source + compiler flags, not on the
# mtime/location of the source tree, so it survives across checkouts in a way
# cargo's own incremental cache (keyed to a specific target-dir) cannot.
#
# The Windows leg gets its own PowerShell-native equivalent inline in
# build-windows-on-vm.sh (Ensure-Sccache) — this is a *bash* lib, and sourcing
# it over ssh into a cmd/powershell VM session isn't a thing.
#
# Best-effort THROUGHOUT: sccache absent/uninstallable just means no
# RUSTC_WRAPPER gets exported (identical behavior to before this file
# existed). This must never fail a release build — install/version-probe
# failures are WARN, not fatal. Effectiveness (hit-rate, before/after delta)
# is measured separately — WI-5084.
#
# Usage:
#   source ".../lib/sccache.sh"
#   setup_sccache_env   # exports RUSTC_WRAPPER / SCCACHE_DIR / SCCACHE_CACHE_SIZE
#                        # / CARGO_INCREMENTAL=0 when sccache is available
#
# setup_sccache_env accepts one optional arg: a default SCCACHE_CACHE_SIZE
# (e.g. "10G") — pass a SMALLER cap on a disk-tight build VM than on this
# spacious dev box. SCCACHE_CACHE_SIZE in the caller's env always wins.

# Pinned release (github.com/mozilla/sccache/releases) — bump deliberately;
# re-verify effectiveness after a bump (WI-5084).
SCCACHE_LIB_VERSION="${SCCACHE_LIB_VERSION:-0.16.0}"

setup_sccache_env() {
  local default_cache_size="${1:-30G}"
  local sccache_bin
  sccache_bin="$(command -v sccache || true)"

  if [[ -z "$sccache_bin" && -x "$HOME/.local/bin/sccache" ]]; then
    export PATH="$HOME/.local/bin:$PATH"
    sccache_bin="$HOME/.local/bin/sccache"
  fi

  if [[ -z "$sccache_bin" ]]; then
    echo "==> sccache: not on PATH — installing a static binary into ~/.local/bin (WI-5083, pinned v${SCCACHE_LIB_VERSION})"
    local os target tmp asset
    os="$(uname -s)"
    case "$os" in
      Darwin)
        case "$(uname -m)" in
          arm64|aarch64) target="aarch64-apple-darwin" ;;
          *)              target="x86_64-apple-darwin" ;;
        esac
        ;;
      Linux)
        case "$(uname -m)" in
          aarch64) target="aarch64-unknown-linux-musl" ;;
          x86_64)  target="x86_64-unknown-linux-musl" ;;
          *)       target="" ;;
        esac
        ;;
      *) target="" ;;
    esac
    if [[ -n "$target" ]]; then
      asset="sccache-v${SCCACHE_LIB_VERSION}-${target}.tar.gz"
      tmp="$(mktemp -d)"
      if curl -fsSL "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_LIB_VERSION}/${asset}" \
           -o "$tmp/sccache.tar.gz" 2>/dev/null \
         && tar -xzf "$tmp/sccache.tar.gz" -C "$tmp" 2>/dev/null; then
        local extracted
        extracted="$(find "$tmp" -maxdepth 2 -type f -name sccache | head -1)"
        if [[ -n "$extracted" ]]; then
          mkdir -p "$HOME/.local/bin"
          cp "$extracted" "$HOME/.local/bin/sccache"
          chmod +x "$HOME/.local/bin/sccache"
          export PATH="$HOME/.local/bin:$PATH"
          sccache_bin="$HOME/.local/bin/sccache"
        fi
      fi
      rm -rf "$tmp"
    fi
    if [[ -n "$sccache_bin" ]]; then
      echo "    ✓ sccache installed → $sccache_bin ($("$sccache_bin" --version 2>/dev/null || echo "v${SCCACHE_LIB_VERSION}"))"
    else
      echo "    WARN: could not install sccache (os=$os target=${target:-<unsupported>}) — continuing without RUSTC_WRAPPER; this build will recompile every crate (WI-5083 benefit skipped this run)"
    fi
  fi

  if [[ -n "$sccache_bin" ]]; then
    export RUSTC_WRAPPER="$sccache_bin"
    export SCCACHE_DIR="${SCCACHE_DIR:-$HOME/.cache/sccache}"
    export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-$default_cache_size}"
    # sccache's own cache and cargo's incremental cache both try to skip
    # recompiling the same code, keyed differently — running both splits the
    # hit-rate between two caches instead of maximizing one. Upstream sccache
    # guidance is to disable cargo incremental when RUSTC_WRAPPER=sccache.
    export CARGO_INCREMENTAL=0
    mkdir -p "$SCCACHE_DIR"
    echo "==> sccache: RUSTC_WRAPPER=$RUSTC_WRAPPER SCCACHE_DIR=$SCCACHE_DIR SCCACHE_CACHE_SIZE=$SCCACHE_CACHE_SIZE CARGO_INCREMENTAL=0"
  fi
}
