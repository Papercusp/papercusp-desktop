#!/usr/bin/env bash
# P-046 / EI-21492557010868835 — build the exact runtime tools admitted into a
# Linux x64 vm-release sidecar.
#
# This file is sourced by build-desktop-sidecar.sh.  It is deliberately an
# internal build helper, not another release surface: the sidecar builder owns
# when it runs, where its verified outputs are copied, and the final SBOM/Grype
# verdict.  Every network input is both version-pinned and SHA-256 pinned.  The
# two upstream Go release binaries that were still Grype-red are rebuilt from
# their signed release commits with only the fixed dependency versions below.

PAPERCUSP_VM_TRUST_REVISION="2026-08-26-r1"

PAPERCUSP_VM_NODE_VERSION="v24.18.1"
PAPERCUSP_VM_NODE_LINUX_X64_SHA256="d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0"

PAPERCUSP_VM_GO_VERSION="1.26.6"
PAPERCUSP_VM_GO_LINUX_X64_SHA256="708effb774be8237570d0add163225abbdfaf4fca28b2611df167beba4feef89"

PAPERCUSP_VM_GH_VERSION="2.98.0"
PAPERCUSP_VM_GH_COMMIT="a255baf71d13fe5947a4eb7ad521ffd412d64cee"
PAPERCUSP_VM_GH_SOURCE_SHA256="52e8e45fb5f5431dd269966c97bbf398fd5c8f1b6fafdc02af182ce4d7012c43"
PAPERCUSP_VM_GH_X_MOD_VERSION="v0.40.0"
PAPERCUSP_VM_GH_X_NET_VERSION="v0.58.0"
PAPERCUSP_VM_GH_X_TOOLS_VERSION="v0.49.0"

PAPERCUSP_VM_KOPIA_VERSION="0.23.1"
PAPERCUSP_VM_KOPIA_COMMIT="72ec08fd8edb86c67ed27099bf1b955e1f308ffa"
PAPERCUSP_VM_KOPIA_SOURCE_SHA256="5c4267ff00cc09eded390e03b6ff33f59e7df1c8d9230ce001dc509e7cadf8f1"
PAPERCUSP_VM_KOPIA_X_CRYPTO_VERSION="v0.53.0"
PAPERCUSP_VM_KOPIA_X_MOD_VERSION="v0.40.0"
PAPERCUSP_VM_KOPIA_X_NET_VERSION="v0.56.0"
PAPERCUSP_VM_KOPIA_X_TEXT_VERSION="v0.39.0"
PAPERCUSP_VM_KOPIA_GRPC_VERSION="v1.82.1"

PAPERCUSP_VM_POSTGRES_VERSION="18.6"
PAPERCUSP_VM_POSTGRES_SOURCE_SHA256="555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f"
PAPERCUSP_VM_OPENSSL_VERSION="3.5.8"
PAPERCUSP_VM_OPENSSL_SOURCE_SHA256="a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2"

_pc_vm_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

_pc_vm_verify_sha256() {
  local file="$1" expected="$2" label="$3" actual
  actual="$(_pc_vm_sha256 "$file")"
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: $label SHA-256 mismatch" >&2
    echo "       expected: $expected" >&2
    echo "       actual:   $actual" >&2
    echo "       file:     $file" >&2
    return 1
  fi
}

_pc_vm_download() {
  local url="$1" expected="$2" dest="$3" label="$4"
  local partial="${dest}.partial.$$"
  if ! curl -fsSL "$url" -o "$partial"; then
    echo "ERROR: failed to download $label from $url" >&2
    rm -f "$partial"
    return 1
  fi
  if ! _pc_vm_verify_sha256 "$partial" "$expected" "$label"; then
    rm -f "$partial"
    return 1
  fi
  mv "$partial" "$dest"
}

_pc_vm_require_commands() {
  local missing=0 command_name
  for command_name in curl sha256sum tar make gcc g++ perl bison flex file flock patchelf python3 node rg; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      echo "ERROR: vm-release trust toolchain requires '$command_name' on PATH" >&2
      missing=1
    fi
  done
  [[ "$missing" -eq 0 ]]
}

_pc_vm_cache_valid() {
  local root="$1"
  [[ -f "$root/manifest.json" \
     && -x "$root/bin/node" \
     && -x "$root/bin/gh" \
     && -x "$root/bin/kopia" \
     && -x "$root/postgresql/bin/postgres" \
     && -x "$root/postgresql/bin/initdb" \
     && -x "$root/postgresql/bin/pg_ctl" \
     && -f "$root/postgresql/lib/pgcrypto.so" \
     && -f "$root/postgresql/lib/libcrypto.so.3" \
     && -f "$root/postgresql/lib/libssl.so.3" ]] || return 1

  [[ "$("$root/bin/node" --version 2>/dev/null)" == "$PAPERCUSP_VM_NODE_VERSION" ]] || return 1
  "$root/bin/gh" --version 2>/dev/null | head -1 | grep -Fq "gh version ${PAPERCUSP_VM_GH_VERSION}-papercusp.1" || return 1
  "$root/bin/kopia" --version 2>/dev/null | head -1 | grep -Fq "${PAPERCUSP_VM_KOPIA_VERSION}-papercusp.1" || return 1
  [[ "$("$root/postgresql/bin/postgres" --version 2>/dev/null)" == "postgres (PostgreSQL) $PAPERCUSP_VM_POSTGRES_VERSION" ]] || return 1

  python3 - "$root/manifest.json" "$PAPERCUSP_VM_TRUST_REVISION" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)
if manifest.get("revision") != sys.argv[2]:
    raise SystemExit(1)
PY
}

_pc_vm_assert_module() {
  local go_bin="$1" binary="$2" module="$3" version="$4"
  if ! "$go_bin" version -m "$binary" \
      | awk -F '\t' -v module="$module" -v version="$version" \
          '$2 == "dep" && $3 == module && $4 == version { found=1 } END { exit found ? 0 : 1 }'; then
    echo "ERROR: $(basename "$binary") does not embed $module@$version" >&2
    return 1
  fi
}

_pc_vm_build_go_tools() {
  local work="$1" output="$2" go_bin="$3"
  local gh_src="$work/gh-src" kopia_src="$work/kopia-src"
  mkdir -p "$gh_src" "$kopia_src" "$output/bin"

  _pc_vm_download \
    "https://codeload.github.com/cli/cli/tar.gz/$PAPERCUSP_VM_GH_COMMIT" \
    "$PAPERCUSP_VM_GH_SOURCE_SHA256" "$work/gh-source.tar.gz" "GitHub CLI source"
  tar -xzf "$work/gh-source.tar.gz" -C "$gh_src" --strip-components=1
  (
    cd "$gh_src"
    export GOTOOLCHAIN=local
    export GOWORK=off
    export GOPATH="$work/gopath-gh"
    export GOMODCACHE="$work/gomodcache-gh"
    "$go_bin" mod edit -toolchain=none
    "$go_bin" get \
      "golang.org/x/mod@$PAPERCUSP_VM_GH_X_MOD_VERSION" \
      "golang.org/x/net@$PAPERCUSP_VM_GH_X_NET_VERSION" \
      "golang.org/x/tools@$PAPERCUSP_VM_GH_X_TOOLS_VERSION"
    CGO_ENABLED=0 "$go_bin" build -trimpath -buildvcs=false \
      -ldflags "-buildid= -X github.com/cli/cli/v2/internal/build.Version=${PAPERCUSP_VM_GH_VERSION}-papercusp.1 -X github.com/cli/cli/v2/internal/build.Date=2026-08-20" \
      -o "$output/bin/gh" ./cmd/gh
  )
  "$output/bin/gh" --version | head -1 | grep -Fq "gh version ${PAPERCUSP_VM_GH_VERSION}-papercusp.1"
  _pc_vm_assert_module "$go_bin" "$output/bin/gh" golang.org/x/mod "$PAPERCUSP_VM_GH_X_MOD_VERSION"

  _pc_vm_download \
    "https://codeload.github.com/kopia/kopia/tar.gz/$PAPERCUSP_VM_KOPIA_COMMIT" \
    "$PAPERCUSP_VM_KOPIA_SOURCE_SHA256" "$work/kopia-source.tar.gz" "Kopia source"
  tar -xzf "$work/kopia-source.tar.gz" -C "$kopia_src" --strip-components=1
  (
    cd "$kopia_src"
    export GOTOOLCHAIN=local
    export GOWORK=off
    export GOPATH="$work/gopath-kopia"
    export GOMODCACHE="$work/gomodcache-kopia"
    "$go_bin" mod edit -toolchain=none
    "$go_bin" get \
      "golang.org/x/crypto@$PAPERCUSP_VM_KOPIA_X_CRYPTO_VERSION" \
      "golang.org/x/mod@$PAPERCUSP_VM_KOPIA_X_MOD_VERSION" \
      "golang.org/x/net@$PAPERCUSP_VM_KOPIA_X_NET_VERSION" \
      "golang.org/x/text@$PAPERCUSP_VM_KOPIA_X_TEXT_VERSION" \
      "google.golang.org/grpc@$PAPERCUSP_VM_KOPIA_GRPC_VERSION"
    CGO_ENABLED=0 "$go_bin" build -trimpath -buildvcs=false -tags nohtmlui \
      -ldflags "-buildid= -X github.com/kopia/kopia/repo.BuildVersion=${PAPERCUSP_VM_KOPIA_VERSION}-papercusp.1 -X github.com/kopia/kopia/repo.BuildInfo=$PAPERCUSP_VM_KOPIA_COMMIT -X github.com/kopia/kopia/repo.BuildGitHubRepo=kopia/kopia" \
      -o "$output/bin/kopia" github.com/kopia/kopia
  )
  "$output/bin/kopia" --version | head -1 | grep -Fq "${PAPERCUSP_VM_KOPIA_VERSION}-papercusp.1"
  "$output/bin/kopia" snapshot create --help >/dev/null
  _pc_vm_assert_module "$go_bin" "$output/bin/kopia" golang.org/x/crypto "$PAPERCUSP_VM_KOPIA_X_CRYPTO_VERSION"
  _pc_vm_assert_module "$go_bin" "$output/bin/kopia" golang.org/x/mod "$PAPERCUSP_VM_KOPIA_X_MOD_VERSION"
  _pc_vm_assert_module "$go_bin" "$output/bin/kopia" golang.org/x/net "$PAPERCUSP_VM_KOPIA_X_NET_VERSION"
  _pc_vm_assert_module "$go_bin" "$output/bin/kopia" golang.org/x/text "$PAPERCUSP_VM_KOPIA_X_TEXT_VERSION"
  _pc_vm_assert_module "$go_bin" "$output/bin/kopia" google.golang.org/grpc "$PAPERCUSP_VM_KOPIA_GRPC_VERSION"
}

_pc_vm_patch_elf_rpaths() {
  local prefix="$1" elf
  while IFS= read -r elf; do
    file -b "$elf" | grep -q '^ELF' || continue
    case "$elf" in
      "$prefix"/bin/*) patchelf --set-rpath '$ORIGIN/../lib' "$elf" ;;
      "$prefix"/lib/*) patchelf --set-rpath '$ORIGIN' "$elf" ;;
    esac
  done < <(find "$prefix/bin" "$prefix/lib" -type f)
}

_pc_vm_prune_postgres_build_residue() {
  local prefix="$1" binary base
  for binary in "$prefix/bin/"*; do
    [[ -e "$binary" ]] || continue
    base="$(basename "$binary")"
    case "$base" in
      postgres|initdb|pg_ctl|psql|pg_dump|pg_dumpall|pg_restore) ;;
      *) rm -f "$binary" ;;
    esac
  done
  rm -rf \
    "$prefix/include" \
    "$prefix/lib/cmake" \
    "$prefix/lib/pgxs" \
    "$prefix/lib/pkgconfig" \
    "$prefix/lib/postgresql/pgxs" \
    "$prefix/share/doc" \
    "$prefix/share/man"
  find "$prefix/lib" -maxdepth 1 -type f \( -name '*.a' -o -name '*.la' \) -delete
}

_pc_vm_probe_postgres() {
  local prefix="$1" work="$2" probe_port data_dir socket_dir started=0 output
  if [[ "$(id -u)" -eq 0 ]]; then
    echo "ERROR: vm-release PostgreSQL source probe refuses to run as root" >&2
    echo "       Run the release builder as its ordinary non-root build identity." >&2
    return 1
  fi
  probe_port="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
  data_dir="$work/postgres-probe-data"
  socket_dir="$work/postgres-probe-socket"
  mkdir -p "$socket_dir"
  "$prefix/bin/initdb" -D "$data_dir" --username=postgres --auth=trust \
    --locale=C --lc-messages=C --encoding=UTF8 >"$work/postgres-initdb.log"
  _pc_vm_stop_probe() {
    if [[ "$started" -eq 1 ]]; then
      "$prefix/bin/pg_ctl" -D "$data_dir" -m fast -w stop >/dev/null 2>&1 || true
    fi
  }
  trap _pc_vm_stop_probe RETURN
  "$prefix/bin/pg_ctl" -D "$data_dir" \
    -o "-k $socket_dir -p $probe_port -c listen_addresses=''" -w start \
    >"$work/postgres-start.log"
  started=1
  output="$("$prefix/bin/psql" -h "$socket_dir" -p "$probe_port" -U postgres \
    -d postgres -v ON_ERROR_STOP=1 -Atc \
    "CREATE EXTENSION pgcrypto; SELECT extversion FROM pg_extension WHERE extname='pgcrypto'; SELECT length(gen_random_bytes(16));")"
  grep -Fq '1.4' <<<"$output"
  grep -Fq '16' <<<"$output"
  "$prefix/bin/pg_ctl" -D "$data_dir" -m fast -w stop >/dev/null
  started=0
  trap - RETURN
}

_pc_vm_sanitize_postgres_config_info() {
  local source_root="$1"
  python3 - "$source_root/src/common/config_info.c" \
    "$PAPERCUSP_VM_POSTGRES_VERSION" "$PAPERCUSP_VM_OPENSSL_VERSION" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
postgres_version = sys.argv[2]
openssl_version = sys.argv[3]
source = path.read_text(encoding="utf-8")
replacements = {
    "pstrdup(CONFIGURE_ARGS)": (
        f'pstrdup("--prefix=/opt/papercusp-postgresql-{postgres_version} '
        f'--with-ssl=openssl (Papercusp vm-release pinned source build)")'
    ),
    "pstrdup(VAL_CPPFLAGS)": (
        f'pstrdup("OpenSSL {openssl_version} headers (checksum-pinned source)")'
    ),
    "pstrdup(VAL_CFLAGS)": (
        'pstrdup("-O2 -ffile-prefix-map=<build>=/usr/src/papercusp-vm-release")'
    ),
    "pstrdup(VAL_CFLAGS_SL)": 'pstrdup("-fPIC")',
    "pstrdup(VAL_LDFLAGS)": (
        'pstrdup("-Wl,-rpath,$ORIGIN/../lib (relocatable vendored OpenSSL)")'
    ),
    "pstrdup(VAL_LDFLAGS_EX)": 'pstrdup("relocatable executable")',
    "pstrdup(VAL_LDFLAGS_SL)": 'pstrdup("relocatable shared library")',
}
for old, new in replacements.items():
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"expected one {old!r} in {path}, found {count}")
    source = source.replace(old, new)
path.write_text(source, encoding="utf-8")
PY
}

_pc_vm_build_postgres() {
  local work="$1" output="$2"
  local openssl_src="$work/openssl-src" postgres_src="$work/postgresql-src"
  local stage="$work/postgresql-stage"
  local install_prefix="/opt/papercusp-postgresql-$PAPERCUSP_VM_POSTGRES_VERSION"
  local prefix="$stage$install_prefix"
  mkdir -p "$openssl_src" "$postgres_src" "$stage"

  _pc_vm_download \
    "https://www.openssl.org/source/openssl-${PAPERCUSP_VM_OPENSSL_VERSION}.tar.gz" \
    "$PAPERCUSP_VM_OPENSSL_SOURCE_SHA256" "$work/openssl-source.tar.gz" "OpenSSL source"
  tar -xzf "$work/openssl-source.tar.gz" -C "$openssl_src" --strip-components=1
  (
    cd "$openssl_src"
    ./Configure linux-x86_64 --prefix="$install_prefix" \
      --openssldir="$install_prefix/ssl" --libdir=lib shared no-docs no-tests \
      >"$work/openssl-configure.log" 2>&1
    make -j"${PAPERCUSP_VM_BUILD_JOBS:-4}" >"$work/openssl-make.log" 2>&1
    make DESTDIR="$stage" install_sw >"$work/openssl-install.log" 2>&1
  )

  _pc_vm_download \
    "https://ftp.postgresql.org/pub/source/v${PAPERCUSP_VM_POSTGRES_VERSION}/postgresql-${PAPERCUSP_VM_POSTGRES_VERSION}.tar.bz2" \
    "$PAPERCUSP_VM_POSTGRES_SOURCE_SHA256" "$work/postgresql-source.tar.bz2" "PostgreSQL source"
  tar -xjf "$work/postgresql-source.tar.bz2" -C "$postgres_src" --strip-components=1
  (
    cd "$postgres_src"
    CPPFLAGS="-I$prefix/include" \
    LDFLAGS="-L$prefix/lib" \
    CFLAGS="-O2 -ffile-prefix-map=$work=/usr/src/papercusp-vm-release" \
      ./configure --prefix="$install_prefix" --with-ssl=openssl \
        --without-readline --without-zlib --without-icu --without-ldap \
        --without-libxml --without-libxslt --without-lz4 --without-zstd \
        >"$work/postgresql-configure.log" 2>&1
    # PostgreSQL exposes its build flags through pg_config()/config_info.c and
    # otherwise compiles our random temporary SDK paths into the postmaster.
    # Keep the useful configuration facts while replacing only those diagnostic
    # strings with stable, non-identifying equivalents before compilation.
    _pc_vm_sanitize_postgres_config_info "$postgres_src"
    make -j"${PAPERCUSP_VM_BUILD_JOBS:-4}" >"$work/postgresql-make.log" 2>&1
    make DESTDIR="$stage" install >"$work/postgresql-install.log" 2>&1
    make -C contrib/pgcrypto -j"${PAPERCUSP_VM_BUILD_JOBS:-4}" \
      >"$work/pgcrypto-make.log" 2>&1
    make -C contrib/pgcrypto DESTDIR="$stage" install \
      >"$work/pgcrypto-install.log" 2>&1
  )

  _pc_vm_patch_elf_rpaths "$prefix"
  _pc_vm_prune_postgres_build_residue "$prefix"
  [[ "$("$prefix/bin/postgres" --version)" == "postgres (PostgreSQL) $PAPERCUSP_VM_POSTGRES_VERSION" ]]
  [[ -f "$prefix/lib/pgcrypto.so" && -f "$prefix/share/extension/pgcrypto.control" ]]
  ldd "$prefix/bin/postgres" | grep -F 'libssl.so.3 =>' | grep -Fq "$prefix"
  ldd "$prefix/lib/pgcrypto.so" | grep -F 'libcrypto.so.3 =>' | grep -Fq "$prefix"
  _pc_vm_probe_postgres "$prefix" "$work"

  mkdir -p "$output"
  cp -a "$prefix/." "$output/"
}

_pc_vm_write_manifest() {
  local root="$1"
  python3 - "$root" <<PY
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])

def digest(relative):
    value = hashlib.sha256()
    with (root / relative).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

manifest = {
    "schemaVersion": 1,
    "revision": "$PAPERCUSP_VM_TRUST_REVISION",
    "platform": "linux-x64",
    "node": {
        "version": "$PAPERCUSP_VM_NODE_VERSION",
        "archiveSha256": "$PAPERCUSP_VM_NODE_LINUX_X64_SHA256",
        "binarySha256": digest("bin/node"),
    },
    "go": {
        "version": "$PAPERCUSP_VM_GO_VERSION",
        "archiveSha256": "$PAPERCUSP_VM_GO_LINUX_X64_SHA256",
    },
    "githubCli": {
        "version": "$PAPERCUSP_VM_GH_VERSION-papercusp.1",
        "commit": "$PAPERCUSP_VM_GH_COMMIT",
        "sourceSha256": "$PAPERCUSP_VM_GH_SOURCE_SHA256",
        "binarySha256": digest("bin/gh"),
        "moduleOverrides": {
            "golang.org/x/mod": "$PAPERCUSP_VM_GH_X_MOD_VERSION",
            "golang.org/x/net": "$PAPERCUSP_VM_GH_X_NET_VERSION",
            "golang.org/x/tools": "$PAPERCUSP_VM_GH_X_TOOLS_VERSION",
        },
    },
    "kopia": {
        "version": "$PAPERCUSP_VM_KOPIA_VERSION-papercusp.1",
        "commit": "$PAPERCUSP_VM_KOPIA_COMMIT",
        "sourceSha256": "$PAPERCUSP_VM_KOPIA_SOURCE_SHA256",
        "binarySha256": digest("bin/kopia"),
        "moduleOverrides": {
            "golang.org/x/crypto": "$PAPERCUSP_VM_KOPIA_X_CRYPTO_VERSION",
            "golang.org/x/mod": "$PAPERCUSP_VM_KOPIA_X_MOD_VERSION",
            "golang.org/x/net": "$PAPERCUSP_VM_KOPIA_X_NET_VERSION",
            "golang.org/x/text": "$PAPERCUSP_VM_KOPIA_X_TEXT_VERSION",
            "google.golang.org/grpc": "$PAPERCUSP_VM_KOPIA_GRPC_VERSION",
        },
    },
    "postgresql": {
        "version": "$PAPERCUSP_VM_POSTGRES_VERSION",
        "sourceSha256": "$PAPERCUSP_VM_POSTGRES_SOURCE_SHA256",
        "opensslVersion": "$PAPERCUSP_VM_OPENSSL_VERSION",
        "opensslSourceSha256": "$PAPERCUSP_VM_OPENSSL_SOURCE_SHA256",
        "postgresBinarySha256": digest("postgresql/bin/postgres"),
    },
}
tmp = root / "manifest.json.tmp"
tmp.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
tmp.replace(root / "manifest.json")
PY
}

papercusp_prepare_vm_release_trust_toolchain() {
  local cache_base="$1" target_os="$2" target_arch="$3"
  local final_root="$cache_base/$PAPERCUSP_VM_TRUST_REVISION-linux-x64"
  local work output go_archive go_bin leak

  if [[ "$target_os" != "linux" || "$target_arch" != "x64" ]]; then
    echo "ERROR: vm-release's pinned trust toolchain currently supports only linux-x64" >&2
    echo "       requested: ${target_os}-${target_arch}; refusing to fall back to stale ambient binaries" >&2
    return 1
  fi
  _pc_vm_require_commands
  mkdir -p "$cache_base"

  # A second sidecar output path may build concurrently.  Serialize only this
  # shared cache; the main builder's own lock protects its assembled tree.
  exec 7>"$cache_base/.build.lock"
  flock -w 3600 7
  if _pc_vm_cache_valid "$final_root"; then
    export PAPERCUSP_VM_RELEASE_TRUST_ROOT="$final_root"
    echo "  ✓ vm-release trust toolchain cached at $final_root"
    flock -u 7
    exec 7>&-
    return 0
  fi
  if [[ -e "$final_root" ]]; then
    mv "$final_root" "$final_root.invalid.$(date -u +%Y%m%dT%H%M%SZ).$$"
  fi

  work="$(mktemp -d /tmp/papercusp-vm-release-trust.XXXXXX)"
  output="$work/output"
  mkdir -p "$output/bin"

  _pc_vm_download \
    "https://go.dev/dl/go${PAPERCUSP_VM_GO_VERSION}.linux-amd64.tar.gz" \
    "$PAPERCUSP_VM_GO_LINUX_X64_SHA256" "$work/go.tar.gz" "Go toolchain"
  tar -xzf "$work/go.tar.gz" -C "$work"
  go_bin="$work/go/bin/go"
  [[ "$("$go_bin" version)" == "go version go${PAPERCUSP_VM_GO_VERSION} linux/amd64" ]]

  _pc_vm_download \
    "https://nodejs.org/dist/${PAPERCUSP_VM_NODE_VERSION}/node-${PAPERCUSP_VM_NODE_VERSION}-linux-x64.tar.xz" \
    "$PAPERCUSP_VM_NODE_LINUX_X64_SHA256" "$work/node.tar.xz" "Node.js runtime"
  tar -xJf "$work/node.tar.xz" -C "$output/bin" --strip-components=2 \
    "node-${PAPERCUSP_VM_NODE_VERSION}-linux-x64/bin/node"
  chmod 755 "$output/bin/node"
  [[ "$("$output/bin/node" --version)" == "$PAPERCUSP_VM_NODE_VERSION" ]]

  _pc_vm_build_go_tools "$work" "$output" "$go_bin"
  _pc_vm_build_postgres "$work" "$output/postgresql"
  _pc_vm_write_manifest "$output"

  # A random build path in shipped bytes defeats deterministic rebuilds and can
  # leak a caller identity.  Fail before caching if any such path survived.
  leak="$(rg -a -l -F "$work" "$output" 2>/dev/null | head -1 || true)"
  if [[ -n "$leak" ]]; then
    echo "ERROR: vm-release trust output embeds its temporary build path: $leak" >&2
    return 1
  fi

  mv "$output" "$final_root"
  export PAPERCUSP_VM_RELEASE_TRUST_ROOT="$final_root"
  echo "  ✓ built pinned vm-release trust toolchain at $final_root"
  flock -u 7
  exec 7>&-
}
