//! Phase 4 — `papercusp://` custom URI scheme: take the webview off HTTP.
//!
//! Plan: `desktop-ipc-transport-completion-2026-05-20.md` (Phase 4).
//!
//! Phases 1–3 moved the webview's `fetch` / `EventSource` traffic onto the
//! IPC bridge, but the webview still loads its *page + assets* over
//! `http://localhost:<port>/…`. This module closes that last gap: when
//! `PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL=1`, the main window loads
//! `papercusp://localhost/…` and this handler forwards each page/asset
//! request to the operator's own loopback HTTP base, relaying the response.
//! The *webview* then opens zero HTTP connections — the Rust→sidecar hop is
//! an internal loopback, not subject to the browser's per-host pool (the
//! connection-pool bug the plan set out to kill).
//!
//! The operator SPA's own `/api/*` `fetch` + `EventSource` calls do NOT
//! reach this handler: under the new `papercusp://localhost` origin they are
//! still same-origin `/api/*`, so the desktop-ipc polyfill intercepts them
//! and routes them over IPC exactly as before (see
//! `@papercusp/desktop-ipc`'s `desktop-bootstrap.ts`). This handler only
//! ever serves what the browser loads directly: the document and the
//! JS/CSS/font/image chunks — all GETs, all bufferable.
//!
//! DEFAULT-ON (shipped 2026-06-01). The scheme was live-verified end-to-end
//! by driving the running webview via the dev-shell bridge on GL hardware:
//! navigated the top frame onto `papercusp://localhost`, confirmed the SPA
//! rendered (origin `papercusp://localhost`, secure context, `crypto.subtle`)
//! and that the same-origin `/api` round-trips through the desktop-ipc
//! polyfill (200). Rollback is a single env var: set
//! `PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL=0` to point the window back at
//! `http://localhost:<port>` (see `enabled()`).
//!
//! STREAMING CAVEAT: this handler buffers (`reqwest::blocking` + `.bytes()`)
//! and Tauri's URI-scheme responder is itself buffered (`Response<Vec<u8>>`,
//! no streaming API), so SSE under `papercusp://` must ride the IPC polyfill
//! (`sys:http`), not this handler. That holds as long as the desktop-ipc IPC
//! handshake succeeds in the packaged sidecar; if IPC is unavailable the SPA's
//! `/api` falls back to this buffering handler and SSE would not stream.

use tauri::http::{Request, Response};
use tauri::{Manager, UriSchemeContext, UriSchemeResponder, Wry};

use crate::SidecarState;

/// The scheme name. On Windows/Android Tauri maps custom schemes onto
/// `http://papercusp.localhost`; on Linux/macOS it is `papercusp://localhost`.
pub const SCHEME: &str = "papercusp";

/// Whether the window loads `papercusp://localhost` instead of the HTTP base.
///
/// DEFAULT: **Linux only**. The custom scheme exists to dodge WebKitGTK's
/// ~6-connection libsoup pool cap (the connection-pool bug this scheme was
/// built to kill) — a WebKitGTK/Linux problem. macOS `WKWebView` and Windows
/// `WebView2` have no such cap AND the buffered scheme handler renders a BLANK
/// webview there (found live 2026-07-01 on macOS: the operator SPA loads fine
/// over HTTP in Safari + with the scheme off, but never mounts under
/// `papercusp://` in WKWebView). So default the scheme ON only on Linux and let
/// the webview ride plain loopback HTTP on macOS/Windows (WKWebView/WebView2
/// pool many connections fine).
///
/// Explicit override wins on every platform: `PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL=1`
/// forces it on, `=0` forces it off. With NO override the default is
/// **Linux-only ON** — macOS `WKWebView` / Windows `WebView2` render the
/// buffered scheme handler BLANK (found live 2026-07-01 on macOS: the operator
/// SPA mounts fine over plain loopback HTTP but never mounts under
/// `papercusp://`), and neither has the WebKitGTK connection-pool cap the scheme
/// exists to dodge, so they ride HTTP by default. (Before this, the default was
/// ON on every platform — the documented Linux-only intent above was never
/// implemented, which shipped a blank webview in the packaged macOS app.)
pub fn enabled() -> bool {
    match std::env::var("PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL").ok().as_deref() {
        Some("1") => true,
        Some("0") => false,
        _ => cfg!(target_os = "linux"),
    }
}

/// The origin the window is pointed at when `enabled()`.
///
/// WebKitGTK (Linux) and WKWebView (macOS) load registered schemes as raw
/// `papercusp://` URLs; WebView2 (Windows) instead maps them onto
/// `http://<scheme>.localhost` (`useHttpsScheme: false` default) — a raw
/// `papercusp://localhost` navigation there silently no-ops and the window
/// stays on whatever it was showing (found live 2026-06-11, run 8).
#[cfg(not(target_os = "windows"))]
pub const APP_ORIGIN: &str = "papercusp://localhost";
#[cfg(target_os = "windows")]
pub const APP_ORIGIN: &str = "http://papercusp.localhost";

/// Resolve the upstream loopback base this handler forwards to.
///   - Packaged: the spawned sidecar's picked port (`SidecarState.port`).
///   - Dev / no-sidecar: `PAPERCUSP_CUSTOM_PROTOCOL_UPSTREAM` override, else
///     (dev builds only) the dev-nohmr Hono host on :3070.
///   - Packaged with NO sidecar yet (Windows pre-onboarding): None — the
///     handler serves the BUNDLED SPA statics instead (see serve_bundled_spa).
fn upstream_base(app: &tauri::AppHandle) -> Option<String> {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(guard) = state.port.lock() {
            if let Some(port) = *guard {
                return Some(format!("http://127.0.0.1:{}", port));
            }
        }
    }
    if let Ok(upstream) = std::env::var("PAPERCUSP_CUSTOM_PROTOCOL_UPSTREAM") {
        return Some(upstream);
    }
    if cfg!(debug_assertions) {
        return Some("http://127.0.0.1:3070".to_string());
    }
    None
}

/// Serve the webview straight off the bundled SPA dist (sidecar/spa/**) —
/// the pre-operator path. On a clean Windows machine the sidecar can't
/// spawn until WSL onboarding finishes, but the onboarding UI
/// (WslOnboardingGate, mounted in the SPA's __root) needs the SPA rendered
/// to exist. Statics come from disk; /api/* answers 503 so the frontend
/// sees clean fetch failures instead of HTML-shaped JSON. (D-009)
fn serve_bundled_spa(app: &tauri::AppHandle, path: &str) -> Response<Vec<u8>> {
    use tauri::Manager;
    if path.starts_with("/api/") || path == "/api" {
        return error_response(503, "papercusp: operator not running yet (pre-onboarding)");
    }
    let spa_root = match app
        .path()
        .resolve("sidecar/spa", tauri::path::BaseDirectory::Resource)
    {
        Ok(p) => p,
        Err(e) => return error_response(500, &format!("papercusp: no bundled spa: {e}")),
    };
    // Normalize + reject traversal. Windows ALSO treats `\` as a separator
    // and `join` with an absolute/drive path REPLACES the base, so reject
    // those shapes outright, then enforce containment on the canonicalized
    // path (covers symlinks). Bare "/" and unknown extension-less paths
    // (SPA routes) fall back to index.html.
    let rel = path.trim_start_matches('/');
    if rel.split(['/', '\\']).any(|seg| seg == ".." || seg.contains(':'))
        || std::path::Path::new(rel).is_absolute()
    {
        return error_response(400, "papercusp: bad path");
    }
    let spa_root_canon = match std::fs::canonicalize(&spa_root) {
        Ok(p) => p,
        Err(e) => return error_response(500, &format!("papercusp: spa root unreadable: {e}")),
    };
    let mut file = spa_root.join(rel);
    // Nonexistent path = SPA route → index.html; an existing path must
    // canonicalize INSIDE the spa root.
    if rel.is_empty() || !file.is_file() {
        file = spa_root.join("index.html");
    }
    match std::fs::canonicalize(&file) {
        Ok(canon) if canon.starts_with(&spa_root_canon) => {}
        Ok(_) => return error_response(400, "papercusp: bad path"),
        Err(e) => return error_response(404, &format!("papercusp: {e}")),
    }
    let body = match std::fs::read(&file) {
        Ok(b) => b,
        Err(e) => return error_response(404, &format!("papercusp: {e}")),
    };
    let mime = match file.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    Response::builder()
        .status(200)
        .header("content-type", mime)
        .body(body)
        .unwrap_or_else(|_| error_response(500, "papercusp: failed to build static response"))
}

/// Async URI-scheme handler. Forwards the request to the loopback base on a
/// worker thread (blocking HTTP client) and responds when it returns, so the
/// webview's UI thread is never blocked.
pub fn handle(ctx: UriSchemeContext<'_, Wry>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || {
        responder.respond(forward(&app, request));
    });
}

fn forward(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // papercusp://localhost/<path>?<query>  →  <base>/<path>?<query>
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");
    let Some(base) = upstream_base(app) else {
        let path = request.uri().path().to_string();
        return serve_bundled_spa(app, &path);
    };
    let target = format!("{}{}", base, path_and_query);

    let client = match reqwest::blocking::Client::builder()
        // The webview always reloads from the sidecar; never cache stale assets.
        .timeout(std::time::Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => return error_response(502, &format!("papercusp: client init failed: {e}")),
    };

    let debug = std::env::var("PAPERCUSP_CUSTOM_PROTOCOL_DEBUG").ok().as_deref() == Some("1");
    if debug {
        eprintln!("[custom_protocol] {} {} → {}", request.method().as_str(), path_and_query, target);
    }

    let method = reqwest::Method::from_bytes(request.method().as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);
    let mut req = client.request(method, &target);

    // Forward request headers verbatim, except:
    //   - `host`: reqwest derives it from the target.
    //   - `accept-encoding`: drop it so the upstream replies uncompressed —
    //     this client doesn't decode, and re-buffering a compressed body
    //     while relaying its `content-encoding` is a footgun. Loopback has
    //     no bandwidth cost, so plain is simplest + correct.
    for (k, v) in request.headers() {
        let name = k.as_str();
        if name.eq_ignore_ascii_case("host") || name.eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        req = req.header(name, v.as_bytes());
    }

    if !request.body().is_empty() {
        req = req.body(request.body().clone());
    }

    match req.send() {
        Ok(up) => {
            let status = up.status().as_u16();
            let headers = up.headers().clone();
            let body = up.bytes().map(|b| b.to_vec()).unwrap_or_default();
            if debug {
                eprintln!("[custom_protocol]   ← {} {} ({} bytes)", status, path_and_query, body.len());
            }

            let mut builder = Response::builder().status(status);
            for (k, v) in headers.iter() {
                // Strip hop-by-hop + length/encoding framing headers — the
                // body is fully buffered, so Tauri sets the correct length;
                // a forwarded `content-length`/`transfer-encoding` would lie.
                let lname = k.as_str().to_ascii_lowercase();
                if matches!(
                    lname.as_str(),
                    "content-length" | "transfer-encoding" | "connection" | "keep-alive"
                ) {
                    continue;
                }
                builder = builder.header(k.as_str(), v.as_bytes());
            }
            builder
                .body(body)
                .unwrap_or_else(|_| error_response(500, "papercusp: failed to build response"))
        }
        Err(e) => error_response(502, &format!("papercusp: upstream error: {e}")),
    }
}

fn error_response(status: u16, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .expect("static error response always builds")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_response_sets_status_and_plaintext_body() {
        let r = error_response(404, "nope");
        assert_eq!(r.status().as_u16(), 404);
        assert_eq!(
            r.headers().get("content-type").unwrap().to_str().unwrap(),
            "text/plain; charset=utf-8",
        );
        assert_eq!(String::from_utf8_lossy(r.body()), "nope");
    }

    #[test]
    fn error_response_carries_arbitrary_status_and_message() {
        let r = error_response(502, "papercusp: upstream error: boom");
        assert_eq!(r.status().as_u16(), 502);
        assert_eq!(
            String::from_utf8_lossy(r.body()),
            "papercusp: upstream error: boom",
        );
    }
}
