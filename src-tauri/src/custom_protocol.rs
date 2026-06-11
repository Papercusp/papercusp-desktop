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
/// DEFAULT ON (Phase 4 shipped 2026-06-01, after the scheme was live-verified
/// end-to-end via the dev-shell bridge on GL hardware: off-HTTP origin, SPA
/// render in a secure context, polyfilled same-origin `/api`). Rollback is a
/// one-liner for the user: set `PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL=0` to point
/// the window back at `http://localhost:<port>`.
pub fn enabled() -> bool {
    std::env::var("PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL").ok().as_deref() != Some("0")
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
///     the dev-nohmr Hono host on :3070 (what `npm run dev` serves).
fn upstream_base(app: &tauri::AppHandle) -> String {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(guard) = state.port.lock() {
            if let Some(port) = *guard {
                return format!("http://127.0.0.1:{}", port);
            }
        }
    }
    std::env::var("PAPERCUSP_CUSTOM_PROTOCOL_UPSTREAM")
        .unwrap_or_else(|_| "http://127.0.0.1:3070".to_string())
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
    let base = upstream_base(app);
    // papercusp://localhost/<path>?<query>  →  <base>/<path>?<query>
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");
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
