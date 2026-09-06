const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Execute the publisher's real public-readback block with a fake HTTPS seam.
function verify({ missing = false, mismatch = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-history-'));
  try {
    const site = path.join(dir, 'site');
    const served = path.join(dir, 'served');
    const temporary = path.join(dir, 'readback');
    const files = ['changes/desktop-v1.2.3-alpha.html', 'changes/desktop-v1.2.3-alpha.json',
      'assets/project-history.js', 'assets/project-history.css', 'assets/vditor/dist/js/lute/lute.min.js'];
    for (const root of [site, served, temporary]) fs.mkdirSync(root, { recursive: true });
    for (const root of [site, served]) for (const relative of files) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), `fixture ${relative}`);
    }
    fs.writeFileSync(path.join(temporary, 'index.html'), '<a href="changes/desktop-v1.2.3-alpha.html">Changes</a>');
    if (missing) fs.unlinkSync(path.join(served, files[1]));
    if (mismatch) fs.writeFileSync(path.join(served, files[2]), 'stale renderer');
    const source = fs.readFileSync(path.join(__dirname, '../bin/publish-release-history.sh'), 'utf8');
    const marker = '# Follow the current release\'s actual link';
    const start = source.lastIndexOf('if [[ "$IS_HOLDING_PAGE" == "0" ]]; then', source.indexOf(marker));
    const end = source.indexOf('\n# Follow one REAL link', start);
    assert.ok(start >= 0 && end > start);
    const script = `set -euo pipefail\nIS_HOLDING_PAGE=0\nBASE=https://example.invalid/unlisted\ncurl() { local url out; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; https:*) url="$1"; shift;; *) shift;; esac; done; cp "$SERVED/\${url#"$BASE"/}" "$out"; }\n${source.slice(start, end)}`;
    return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: {
      ...process.env, SITE_DIR: site, SERVED: served, TMP_PAGE: temporary,
    } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('public History verification follows the served link and compares all required bytes', () => {
  const result = verify();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /served byte-identically/);
});
test('missing History data and stale renderer bytes refuse successful publication', () => {
  assert.notEqual(verify({ missing: true }).status, 0);
  assert.notEqual(verify({ mismatch: true }).status, 0);
});
