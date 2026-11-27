'use strict';

const fs = require('node:fs');
const path = require('node:path');

function historicalSource(dir) {
  for (const [file, body] of Object.entries({
    'packages/operator-core/lib/agent-tools/testing/run.ts': 'export default {};\n',
    'apps/operator/bin/bundle-host-common.sh': '# historical helper\n',
    'apps/operator/bin/serve.ts': 'console.log("historical host");\n',
    'apps/operator/bin/ascii-escape-bundle.mjs': '// fixture syntax check\n',
    'scripts/npm-install-safe.mjs': '// fixture cache lease\n',
    'packages/plugin-loader/package.json': '{"dependencies":{}}\n',
    'packages/plugin-loader/src/daemon/supervisor.ts': 'export default {};\n',
  })) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
}

module.exports = { historicalSource };
