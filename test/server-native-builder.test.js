const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeDesktopTestScratchDirSync } = require('./test-scratch.cjs');

const recipe = fs.readFileSync(path.resolve(__dirname, '../../infra/images/server/NativeBuilder.Containerfile'), 'utf8');
const preflight = recipe.split('# NATIVE_PREFLIGHT_BEGIN\n')[1].split('# NATIVE_PREFLIGHT_END')[0];

// Execute the actual build preflight with both process probes, without apt or
// downloads. A wrong rootfs must refuse before the first mutating build layer.
function probe(target, distroArch, nodeArch, versions = {}) {
  const script = preflight.replaceAll('/usr/local/bin/node', 'node');
  return spawnSync('bash', ['-euo', 'pipefail', '-c',
    'dpkg() { printf "%s\\n" "$FIXTURE_DISTRO_ARCH"; };\n' +
    'node() { printf "%s\\n" "$FIXTURE_NODE_ARCH"; };\n' + script], {
    encoding: 'utf8',
    env: { ...process.env, TARGETARCH: target, BUILD_NODE_VERSION: '25.9.0',
      RUST_VERSION: '1.97.1', RUSTUP_VERSION: '1.28.2',
      FIXTURE_DISTRO_ARCH: distroArch, FIXTURE_NODE_ARCH: nodeArch, ...versions },
  });
}

test('native builder admits matching ARM64 and AMD64 process/rootfs pairs', () => {
  for (const [arch, nodeArch] of [['arm64', 'arm64'], ['amd64', 'x64']]) {
    const r = probe(arch, arch, nodeArch);
    assert.equal(r.status, 0, r.stderr);
  }
});

test('native builder rejects host bytes, mixed runtime/rootfs and unsupported targets before installation', () => {
  for (const tuple of [['arm64', 'amd64', 'arm64'], ['arm64', 'arm64', 'x64'],
    ['amd64', 'amd64', 'arm64'], ['riscv64', 'riscv64', 'riscv64']]) {
    const r = probe(...tuple);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /architecture differs|requires amd64 or arm64/);
  }
});

test('native builder refuses moving or shell-looking toolchain versions', () => {
  for (const key of ['BUILD_NODE_VERSION', 'RUST_VERSION', 'RUSTUP_VERSION']) {
    for (const value of ['latest', '', '25.9.0; touch /tmp/unwanted']) {
      const r = probe('arm64', 'arm64', 'arm64', { [key]: value });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /require exact versions/);
    }
  }
});

test('native builder checks the full GUI development closure before compilation', () => {
  const script = recipe.split('# NATIVE_GUI_PREFLIGHT_BEGIN\n')[1]
    .split('# NATIVE_GUI_PREFLIGHT_END')[0];
  const run = (missing) => spawnSync('bash', ['-euo', 'pipefail', '-c',
    'pkg-config() { [[ "$1" = --exists && "$2" != "$FIXTURE_MISSING_MODULE" ]]; };\n' + script], {
    encoding: 'utf8', env: { ...process.env, FIXTURE_MISSING_MODULE: missing },
  });
  assert.equal(run('').status, 0);
  for (const module of ['gtk+-3.0', 'webkit2gtk-4.1', 'javascriptcoregtk-4.1',
    'ayatana-appindicator3-0.1', 'librsvg-2.0']) {
    const r = run(module);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /requires GUI development module/);
    assert.ok(r.stderr.includes(module));
  }
});

test('factory pgvector validation admits target ELF and refuses missing, empty or host inputs', () => {
  const scratch = makeDesktopTestScratchDirSync('native-pgvector-');
  const lib = path.join(scratch, 'lib');
  const extension = path.join(scratch, 'extension');
  fs.mkdirSync(lib);
  fs.mkdirSync(extension);
  const script = recipe.split('# NATIVE_PGVECTOR_PREFLIGHT_BEGIN\n')[1]
    .split('# NATIVE_PGVECTOR_PREFLIGHT_END')[0]
    .replaceAll('/usr/lib/postgresql/18/lib', lib)
    .replaceAll('/usr/share/postgresql/18/extension', extension);
  const files = [path.join(lib, 'vector.so'), path.join(extension, 'vector.control'),
    path.join(extension, 'vector--0.8.2.sql')];
  const reset = () => files.forEach(file => fs.writeFileSync(file, 'fixture'));
  const run = (arch, machine) => spawnSync('bash', ['-euo', 'pipefail', '-c',
    'file() { printf "%s\\n" "$FIXTURE_ELF"; };\n' + script], {
    encoding: 'utf8', env: { ...process.env, TARGETARCH: arch, FIXTURE_ELF: machine },
  });
  try {
    for (const [arch, machine] of [['arm64', 'ELF 64-bit LSB shared object, ARM aarch64'],
      ['amd64', 'ELF 64-bit LSB shared object, x86-64']]) {
      reset();
      assert.equal(run(arch, machine).status, 0);
      for (const file of files) {
        for (const state of ['missing', 'empty']) {
          reset();
          if (state === 'missing') fs.unlinkSync(file); else fs.writeFileSync(file, '');
          const r = run(arch, machine);
          assert.equal(r.status, 2, `${file} ${state}: ${r.stderr}`);
          assert.match(r.stderr, /requires PostgreSQL 18 pgvector library, control and SQL/);
        }
      }
      reset();
      const r = run(arch, arch === 'arm64' ? 'ELF x86-64' : 'ELF ARM aarch64');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /pgvector architecture differs/);
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('factory Git adapter distinguishes stale ENOMEM at EOF from real stream errors', { skip: process.platform !== 'linux' }, () => {
  const scratch = makeDesktopTestScratchDirSync('native-git-eof-');
  try {
    const compat = recipe.split("<<'GIT_EOF_SOURCE'\n")[1].split('\nGIT_EOF_SOURCE')[0];
    const compile = (name, source, shared) => {
      const file = path.join(scratch, name);
      const r = spawnSync('gcc', [...(shared ? ['-shared', '-fPIC'] : []), '-Wall', '-Wextra', '-Werror', '-x', 'c', '-', '-o', file, '-ldl'], { input: source, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr || r.error?.message);
      return file;
    };
    const adapter = compile('compat.so', compat, true);
    const injected = compile('stale-errno.so', `
#define _GNU_SOURCE
#include <stdio.h>
#include <dlfcn.h>
#include <errno.h>
ssize_t getdelim(char **p, size_t *n, int d, FILE *f) {
  ssize_t (*next)(char **,size_t *,int,FILE *)=dlsym(RTLD_NEXT,"getdelim");
  ssize_t r=next(p,n,d,f);
  if(r<0 && feof(f) && !ferror(f)) errno=ENOMEM;
  return r;
}`, true);
    const executable = compile('probe', `
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
static ssize_t failed_read(void *cookie, char *buf, size_t n) {
  (void)buf; (void)n; errno=*(int *)cookie; return -1;
}
int main(int argc, char **argv) {
  (void)argc; char *line=NULL; size_t n=0; int failure=0;
  FILE *f;
  if(strcmp(argv[1],"eof")==0) {
    f=fmemopen("okay\\n",5,"r");
    if(getdelim(&line,&n,'\\n',f)!=5 || memcmp(line,"okay\\n",5)) return 2;
  } else {
    failure=strcmp(argv[1],"enomem")==0 ? ENOMEM : EIO;
    cookie_io_functions_t io={.read=failed_read};
    f=fopencookie(&failure,"r",io);
  }
  errno=0;
  ssize_t r=getdelim(&line,&n,'\\n',f); int e=errno;
  printf("%ld %d %d %d\\n",(long)r,e,!!feof(f),!!ferror(f));
  free(line); fclose(f); return 0;
}`, false);
    const run = (mode, libraries) => {
      const r = spawnSync(executable, [mode], { encoding: 'utf8', env: { ...process.env, LD_PRELOAD: libraries.join(':') } });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim().split(' ').map(Number);
    };
    assert.deepEqual(run('eof', [injected]), [-1, 12, 1, 0], 'positive control reproduces false ENOMEM');
    assert.deepEqual(run('eof', [adapter, injected]), [-1, 0, 1, 0]);
    for (const [mode, errno] of [['enomem', 12], ['eio', 5]]) {
      assert.deepEqual(run(mode, [adapter, injected]), [-1, errno, 0, 1], 'actual failures must remain errors');
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
