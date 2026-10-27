# Vendored AppImage type-2 runtime (EI-27096956663669253)

`runtime-x86_64` is the ELF stub that `appimagetool` writes at offset 0 of the
signed GUI AppImage. It executes first on every user launch, before any of our
code. It is vendored here and pinned by sha256 in
`bin/lib/appimage-runtime.sh`. Without that pin, `appimagetool` downloads
whatever AppImage/type2-runtime's moving `continuous` tag holds at build time.
That runtime is unreviewed and unrecorded, makes cuts non-reproducible, and
fails the cut if GitHub is unreachable.

| field | value |
|---|---|
| upstream | https://github.com/AppImage/type2-runtime |
| upstream commit | `fedfad5` ("Make dependency builds independent of the temporary directory path", 2026-10-19) |
| release asset | `continuous/runtime-x86_64`, published 2026-10-19T20:37:20Z, 944632 bytes |
| sha256 | `617aa77314d57c8b8e4fae9c3f0b35af7b30d5529cb69e98f64f92510ed98a46` (equals GitHub's asset `digest`) |
| fetched | 2026-10-27 |
| license | MIT (upstream `LICENSE`); statically links squashfuse, zstd and libfuse3 as upstream builds it |

## Why this runtime, not the dated `20251108` release

`20251108` is upstream's only dated release that has an `x86_64` asset. It is
6 commits behind `continuous`. Four of those commits only bump CI actions.
Commit `8f39b89` is a security hardening in `src/runtime/runtime.c`: it creates
extraction directories with mode 0700. Pinning `20251108` would have dropped
that hardening. These are exactly the bytes the 0.0.32 candidate already
embedded, and that candidate passed the real-VM install/upgrade/rollback journey.
The 0.0.32 AppImage prefix differs from this file only in the 16-byte
`.digest_md5` section, which appimagetool fills in. Its squashfs payload starts
at byte 944632.

## Bumping the pin

1. Review the upstream delta, for example
   `https://api.github.com/repos/AppImage/type2-runtime/compare/fedfad5...continuous`.
2. Download the new asset, check it against GitHub's published `digest`, and
   replace `runtime-x86_64`.
3. Update `PAPERCUSP_APPIMAGE_RUNTIME_SHA256` and
   `PAPERCUSP_APPIMAGE_RUNTIME_UPSTREAM` in `bin/lib/appimage-runtime.sh`, and
   update the table above.
4. Run `node --test test/appimage-runtime-pin.test.js test/appimage-runtime-isolation.test.js`.
   Then cut a candidate and re-run the VM journey before publishing.

Never point the build at the `continuous` URL. `build-appimage.sh` refuses a
runtime whose hash does not match the pin, and it refuses an AppImage whose
embedded runtime differs from these bytes.
