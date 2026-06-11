# Verifying a build
URL: /internal/docs/build-system/verification

How to smoke-test each platform end-to-end before declaring the artifact good to ship.

## Pre-flight check (any platform)

Re-run the auditor on every artifact:

```sh
papercusp-desktop/bin/audit-bundle.sh \
  papercupai-workspace/papercup/papercusp-desktop/src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb \
  /home/marsh-office/Papercusp_0.0.1_x86_64.dmg \
  /home/marsh-office/Papercusp_0.0.1_x64_en-US.msi \
  /home/marsh-office/Papercusp_0.0.1_x64-setup.exe
```

Or click **Audit prod bundles for PostHog leaks** in `/admin`. Should print `OK: 4/4`. If any FAIL, **stop** — the artifact must not ship.

***

## Linux .deb verification

### 1. Install + launch

```sh
sudo dpkg -i papercupai-workspace/papercup/papercusp-desktop/src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb
papercusp
```

Or click **Install + launch Linux .deb** in `/admin`.

Expected: a brief bootstrap page, then the window navigates to the operator UI within \~5–15s (a first boot pays `initdb` + migrations inside `serve.mjs`, so allow longer). Title bar "Papercusp". If it stays stuck on the bootstrap page, the sidecar never reached the preflight-ready state → check the serve logs.

### 2. Verify no discovery files leaked

```sh
sudo useradd -m papercusp-verify
sudo -u papercusp-verify ls -la ~papercusp-verify/.papercusp/ 2>&1
```

Expected: `No such file or directory`. The bundle never created the file.

### 3. Flag bootstrap silent

```sh
curl -s http://127.0.0.1:3055/api/flags/bootstrap | jq
```

Wait — the prod binary doesn't serve on `:3055`. The sidecar (`node serve.mjs`) picks a free port, which it records in `~/.papercusp/operator.json` (the authoritative source). Read it from there, or grep the listener.

```sh
PROD_PORT=$(jq -r .port ~/.papercusp/operator.json)
# Fallback if operator.json isn't present:
# PROD_PORT=$(ss -tnlp | awk '/serve\.mjs|node/{split($4,a,":"); print a[2]}' | sort -u | grep -v 3055 | head -1)
curl -s http://127.0.0.1:${PROD_PORT}/api/flags/bootstrap | jq
```

Expected (the V1 ship defaults — `papercusp-snapshots` is `true` by design, every other flag `false`):

```json
{
  "flags": {
    "papercusp-snapshots": true,
    "papercusp-cloudflare-publish": false,
    "papercusp-oracle": false,
    "papercusp-rust-port-ui": false,
    "papercusp-harness-phases": false,
    "papercusp-design": false,
    "papercusp-testing": false,
    "papercusp-inbox-durable-escalations": false,
    "papercusp-improvement-auto-implement": false,
    "papercusp-video-channels": false,
    "papercusp-voice-channels": false,
    "papercusp-the-hive": false
  },
  "evaluatedAt": 1234567890,
  "source": "defaults"
}
```

`source` must be `"defaults"` (the only other values are `"posthog"` and `"override"`). A `"posthog"` source on a clean install means PostHog config leaked in. The flag *values* must match `FLAG_DEFAULTS` in `libs/flags/src/types.ts` (snapshots on; everything else off). (`papercusp-templates` / `papercusp-marketplace` were retired — distribution lives in the ungated Cupboard.)

### 4. No outbound PostHog traffic

```sh
sudo ss -tnp | grep -E "flags.papercuspai|posthog"
```

Expected: empty.

### 5. Embedded PG discovery

```sh
cat ~/.papercusp/embedded-pg.json
cat ~/.papercusp/operator.json
```

Expected: JSON with a non-5432 port (both files written by `serve.mjs`). **Confirms the desktop spawned its own embedded PG, didn't talk to native `:5432`.**

### 6. Feature data loads

In the app, navigate to **Harness → sheets**. The Feature Queue panel should populate with features (not empty). No errors in the DevTools console.

### 7. Closed-flag routes really 404

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:${PROD_PORT}/design
```

Expected: `404`. The V1 contract requires `notFound()` to return real HTTP 404, not a 200-page-with-404-content.

### 8. Cleanup

```sh
sudo dpkg -r papercusp
sudo userdel -r papercusp-verify
```

***

## macOS .dmg verification

### 1. Install

```sh
ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1
```

In the Mac VM:

```sh
scp -i ~/.ssh/papercup-vm-mac -P 2222 \
  /home/marsh-office/Papercusp_0.0.1_x86_64.dmg \
  aviweiss@127.0.0.1:~

hdiutil attach ~/Papercusp_0.0.1_x86_64.dmg
cp -R "/Volumes/Papercusp/Papercusp.app" /Applications/
hdiutil detach "/Volumes/Papercusp"
xattr -dr com.apple.quarantine /Applications/Papercusp.app
```

Or click **Install + launch Mac .dmg** in `/admin`.

### 2. Verify no discovery files leaked

```sh
find /Applications/Papercusp.app -name "posthog*.json" 2>&1
```

Expected: empty.

### 3. Launch (view via SPICE)

On the Linux host:

```sh
remote-viewer spice://127.0.0.1:5930 &
```

In the Mac VM:

```sh
open /Applications/Papercusp.app
```

Same window-loads check as Linux.

### 4. Flag bootstrap test

Inside the Mac VM, find the operator port (`ss -tnp` doesn't exist; use `lsof -iTCP -sTCP:LISTEN -P`) and curl `/api/flags/bootstrap`. Same expected JSON.

### 5. Verify no `.papercusp/` was created

```sh
ls -la ~/.papercusp/ 2>&1
```

Expected: file should NOT exist (running the app under the test user should not have created posthog.json).

### 6. Cleanup

```sh
rm -rf /Applications/Papercusp.app
```

***

## Windows .msi verification

### 1. Install

```sh
scp -i ~/.ssh/papercup-vm-win -P 2223 \
  /home/marsh-office/Papercusp_0.0.1_x64_en-US.msi \
  User@127.0.0.1:.

ssh -i ~/.ssh/papercup-vm-win -p 2223 User@127.0.0.1 \
  "msiexec /i C:\\Users\\User\\Papercusp_0.0.1_x64_en-US.msi /quiet"
```

Or click **Install + launch Windows .msi** in `/admin`. Wait \~30s. Installs to `C:\Program Files\Papercusp\`.

### 2. Verify no discovery files leaked

```sh
ssh -i ~/.ssh/papercup-vm-win -p 2223 User@127.0.0.1 \
  'powershell "Get-ChildItem -Recurse -Path C:\\Program Files\\Papercusp -Filter posthog*.json"'
```

Expected: empty.

### 3. Launch

```sh
ssh -i ~/.ssh/papercup-vm-win -p 2223 User@127.0.0.1 \
  'powershell "Start-Process \"C:\\Program Files\\Papercusp\\Papercusp.exe\""'
```

(No SPICE configured on the Windows VM by default; verify via `tasklist | findstr Papercusp` to confirm running.)

### 4. Flag bootstrap test

In Windows PowerShell, curl `http://127.0.0.1:<port>/api/flags/bootstrap`. Same expected JSON.

### 5. Verify no `.papercusp/` directory

```sh
ssh -i ~/.ssh/papercup-vm-win -p 2223 User@127.0.0.1 \
  'powershell "Test-Path C:\\Users\\User\\.papercusp\\posthog.json"'
```

Expected: `False`.

### 6. Uninstall

```sh
ssh -i ~/.ssh/papercup-vm-win -p 2223 User@127.0.0.1 \
  "wmic product where name='Papercusp' call uninstall /nointeractive"
```

Or via Settings → Apps → Papercusp → Uninstall.

***

## FAIL criteria (any platform)

| Symptom                                                                              | Means                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| A real PostHog key (`phx_…` / `phc_…`) found by `audit-bundle.sh` inside the install | Secret leaked into bundle — **must** rebuild                                   |
| `/api/flags/bootstrap` returns `source: "posthog"` on a clean install                | PostHog config (env var or discovery file) made it through — leak              |
| Any flag other than `papercusp-snapshots` returns `true`                             | Default ship-state violated — leak                                             |
| `ss -tnp` shows connection to `flags.papercuspai.com`                                | App phoning home in clean-install state — leak                                 |
| Window stuck on the bootstrap page (never navigates off `web/index.html`)            | The sidecar never became ready — check the preflight handshake / serve logs    |
| `embedded-pg.json` / `operator.json` missing, or app connects to `:5432`             | Embedded PG didn't bootstrap (`serve.mjs` owns this)                           |
| Sheets harness shows 0 features when the API returns features                        | Feature loading broken                                                         |
| Window shows the **dev** server's app (URL has `:3055`)                              | The webview pointed at the dev server instead of the bundled sidecar — rebuild |

***

## A self-contained checklist

Copy this and run top to bottom:

```sh
# 1. Auditor pass
papercusp-desktop/bin/audit-bundle.sh \
  papercupai-workspace/papercup/papercusp-desktop/src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb \
  /home/marsh-office/Papercusp_0.0.1_x86_64.dmg \
  /home/marsh-office/Papercusp_0.0.1_x64_en-US.msi \
  /home/marsh-office/Papercusp_0.0.1_x64-setup.exe

# 2. Linux install + launch + smoke
sudo dpkg -i papercupai-workspace/papercup/papercusp-desktop/src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb
setsid /usr/bin/papercusp >/dev/null 2>&1 < /dev/null &
sleep 15
PORT=$(jq -r .port ~/.papercusp/operator.json)
echo "operator port: $PORT"
curl -s "http://127.0.0.1:${PORT}/api/flags/bootstrap" | jq .source       # → "defaults"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:${PORT}/design"  # → 404
sudo ss -tnp | grep -E "flags.papercuspai|posthog" || echo "no posthog traffic ✓"

# 3. Cleanup
pkill -KILL papercusp
sudo dpkg -r papercusp
```

When every line is green, the artifact is ship-ready for that platform.
