// EI-22786677202169620: execute the actual Rust converters, including native
// PathBuf::join on Windows. No Tauri boot or running operator is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src-tauri/src/main.rs'), 'utf8');
function fn(name, input = source) {
  // main.rs also mentions function signatures inside test strings. Only a
  // top-level declaration can supply the production converter under test.
  const start = input.search(new RegExp(`^fn ${name}\\(`, 'm'));
  assert.notEqual(start, -1, name);
  const end = input.indexOf('\n}\n', start);
  assert.notEqual(end, -1, name);
  return input.slice(start, end + 3);
}
function constant(name) {
  const start = source.indexOf(`const ${name}:`);
  assert.notEqual(start, -1, name);
  const end = source.indexOf(';\n', start);
  assert.notEqual(end, -1, name);
  return source.slice(start, end + 2);
}
const driver = [
  'use std::{path::Path, process::Command};',
  constant('WSL_NATIVE_RUNTIME_PATHS'), constant('SIDECAR_WSLENV'),
  fn('windows_path_to_wsl'), fn('sidecar_wslenv'), fn('normalize_wsl_runtime_env'),
  String.raw`
#[test]
fn mixed_preload_and_entrypoint_paths_are_posix() {
    for name in ["sidecar-preload.js", "serve.mjs", "bin/node"] {
        let mixed = format!("/home/papercup/runtime\\{}", name.replace('/', "\\"));
        assert_eq!(windows_path_to_wsl(Path::new(&mixed)),
            format!("/home/papercup/runtime/{name}"));
    }
}
#[test]
fn actual_host_pathbuf_join_is_converted() {
    let root = Path::new("/home/First Last/runtime");
    let joined = root.join("bin").join("node");
    #[cfg(windows)]
    assert!(joined.to_string_lossy().contains('\\'), "control must exercise Windows joins");
    assert_eq!(windows_path_to_wsl(&joined), "/home/First Last/runtime/bin/node");
}
#[test]
fn drive_unc_and_posix_controls_are_preserved() {
    for (input, want) in [
        (r"C:\Users\First Last\sidecar", "/mnt/c/Users/First Last/sidecar"),
        (r"\\?\C:\Users\User\sidecar", "/mnt/c/Users/User/sidecar"),
        (r"\\?\UNC\server\share\sidecar", "//server/share/sidecar"),
        ("/home/papercup/runtime", "/home/papercup/runtime"),
    ] { assert_eq!(windows_path_to_wsl(Path::new(input)), want); }
}
#[test]
fn every_untranslated_runtime_env_path_is_normalized() {
    let mut cmd = Command::new("not-executed");
    for name in WSL_NATIVE_RUNTIME_PATHS {
        cmd.env(name, r"/home/First Last/runtime\bin\node");
    }
    cmd.env("PAPERCUSP_SEED_DIR", r"C:\Users\User\seed");
    cmd.env("PAPERCUSP_BUILD_SHA", "abc123");
    normalize_wsl_runtime_env(&mut cmd);
    let vars: std::collections::BTreeMap<_, _> = cmd.get_envs()
        .map(|(k, v)| (k.to_str().unwrap(), v.unwrap().to_str().unwrap())).collect();
    for name in WSL_NATIVE_RUNTIME_PATHS {
        assert_eq!(vars[name], "/home/First Last/runtime/bin/node", "{name}");
        let entry = sidecar_wslenv(true).split(':')
            .find(|e| e.trim().split('/').next() == Some(name)).unwrap().trim().to_owned();
        assert_eq!(entry, name, "already-POSIX env must not be translated");
    }
    assert_eq!(vars["PAPERCUSP_SEED_DIR"], r"C:\Users\User\seed");
    assert_eq!(vars["PAPERCUSP_BUILD_SHA"], "abc123");
    assert!(sidecar_wslenv(true).contains("PAPERCUSP_SEED_DIR/p"));
    assert_eq!(sidecar_wslenv(false), SIDECAR_WSLENV);
}
`,
].join('\n');

function compileAndRun(rust) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-launch-paths-'));
  try {
    const input = path.join(temp, 'paths.rs');
    const binary = path.join(temp, process.platform === 'win32' ? 'paths.exe' : 'paths');
    fs.writeFileSync(input, rust);
    const compile = spawnSync(process.env.RUSTC || 'rustc', [
      '--edition=2021', '--test', input, '-o', binary,
    ], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compile.status, 0, String(compile.error || compile.stderr));
    const result = spawnSync(binary, ['--nocapture'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined);
    return result;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test('production function extraction ignores signature mentions in strings and comments', () => {
  const declaration = 'fn converter() {\n    actual();\n}\n';
  const input = 'let text = "fn converter() { fake(); }";\n// fn converter() { fake(); }\n' + declaration;
  assert.equal(fn('converter', input), declaration);
});

test('actual production converters preserve WSL argv and runtime env paths', () => {
  const r = compileAndRun(driver);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /4 passed; 0 failed; 0 ignored/);
});

test('both original path defects independently fail the executed controls', () => {
  const unchangedPosix = driver.replace("return s.replace('\\\\', \"/\");", 'return s;');
  assert.notEqual(unchangedPosix, driver);
  const argv = compileAndRun(unchangedPosix);
  assert.notEqual(argv.status, 0);
  assert.match(argv.stdout, /mixed_preload_and_entrypoint_paths_are_posix.*FAILED/);
  const unchangedEnv = driver.replace('cmd.envs(normalized);', 'let _ = normalized;');
  assert.notEqual(unchangedEnv, driver);
  const env = compileAndRun(unchangedEnv);
  assert.notEqual(env.status, 0);
  assert.match(env.stdout, /every_untranslated_runtime_env_path_is_normalized.*FAILED/);
});

test('the real spawn wires normalization only for WSL-native runtime paths', () => {
  const spawn = fn('spawn_serve');
  assert.match(spawn, /if via_wsl && runtime_sidecar_dir != sidecar_dir \{\s*normalize_wsl_runtime_env\(&mut cmd\);\s*\}\s*cmd\.spawn\(\)/);
  const command = fn('make_sidecar_command');
  for (const arg of ['sidecar_dir', 'preload', 'server_js']) {
    assert.ok(command.includes(`windows_path_to_wsl(${arg})`));
  }
});
