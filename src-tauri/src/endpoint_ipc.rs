//! Endpoint IPC client. Connects to the Node sidecar's IPC server
//! (see apps/operator/lib/endpoint-ipc/server.ts) over a Unix domain
//! socket or named pipe and pumps events into per-call Tauri Channels.
//!
//! Lifecycle (when wired into main.rs in a follow-up commit):
//!
//!   1. Sidecar bootstrap reads PAPERCUSP_IPC_READY socket=<path> from
//!      Node's stdout (per PROTOCOL.md).
//!   2. main.rs calls `IpcClient::connect(socket_path)` → state.
//!   3. Webview JS calls `invoke('endpoint_invoke', { tool_name, input, channel })`.
//!   4. Rust writes a REQUEST frame, registers the Channel under a fresh
//!      monotonic id, and the reader-loop fans incoming events into it.
//!   5. Webview drops the Channel or window unloads → consumer's
//!      finally block sends CANCEL.

#![allow(dead_code)] // wired up by main.rs in a follow-up

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::endpoint_ipc_framing::{
    decode_event_bin_payload, encode_frame, FrameDecoder, FrameType,
};

/// One event surfaced to the webview JS. Tagged JSON via Serde.
///
/// The TS shape (apps/operator):
///   { kind: 'event', name: string, data: unknown }
///   | { kind: 'binary', name: string, data: number[] }
///   | { kind: 'done', result: ToolResult }
///   | { kind: 'error', code: string, message: string }
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EndpointEvent {
    /// JSON-valued event (delta, tool_call, suggestion, cost, etc.).
    Event {
        name: String,
        data: serde_json::Value,
    },
    /// Binary event — Uint8Array on the wire, base64 string in JSON
    /// for transport across Tauri's IPC serializer. Frontend hook
    /// decodes back into Uint8Array.
    Binary {
        name: String,
        /// Base64-encoded binary payload.
        data: String,
    },
    /// Tool returned successfully.
    Done { result: serde_json::Value },
    /// Dispatch or handler failed (role gate, quota, timeout, throw).
    Error { code: String, message: String },
}

/// Wire-shape envelopes used to parse server-emitted JSON payloads.

#[derive(Debug, Deserialize)]
struct EventJsonEnvelope {
    id: u64,
    name: String,
    data: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct DoneEnvelope {
    id: u64,
    result: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct ErrorEnvelope {
    id: u64,
    error: ErrorPayload,
}

#[derive(Debug, Deserialize)]
struct ErrorPayload {
    code: String,
    message: String,
}

/// Per-call channel handle. The reader-loop fans events into here.
///
/// `events_sent` is the per-call backpressure counter. Tauri 2's
/// `Channel::send()` queues internally with no exposed backpressure —
/// a tool emitting faster than the webview drains would grow Rust
/// process memory until OOM. The 10k cap was promised in the plan as
/// "non-negotiable"; this is the implementation.
///
/// When the cap trips:
///   1. One final ERROR is sent (the consumer-visible terminal).
///   2. `overflowed` flips to true; subsequent sends short-circuit.
///   3. The server-side dispatch keeps running (we can't cancel it
///      from the client mid-stream cheaply), but its emitted events
///      land in the void from the Rust side onward.
///
/// 10k is generous for the steady-state load we expect (token streams
/// at ~30/sec for 5-minute turns = 9k events) but bounded enough that
/// a wedged consumer can't take the desktop down. Tune via telemetry
/// if a real workload approaches the cap.
const PER_CALL_EVENT_CAP: u64 = 10_000;

/// WI-2817: an in-flight call gets NO activity (not even a keep-alive EVENT
/// frame) for this long ⇒ treated as wedged and force-failed with
/// `connection_lost` (the SAME terminal code `reader_loop`'s EOF path already
/// emits, so the existing, already-tested `ipc-fetch.ts` transparent retry
/// handles it with no new client-side logic). 20s comfortably exceeds both a
/// quick sidecar bounce (~120ms) and a cold embedded-PG + migrations boot
/// (~11-13s observed, ~3s with the pre-migrated seed fast path — see
/// WI-2601), so it never trips on a legitimately-slow-but-alive boot.
///
/// WHY THIS EXISTS: `IpcClient::is_alive()` only flips false when the reader
/// loop observes an EOF/read-error on the socket — a connection that stays
/// OPEN but whose peer process is wedged (e.g. mid-restart, between binding
/// its new socket and actually servicing requests) never trips that path.
/// Before this, such a call's `CallSink` just sat in `in_flight` forever:
/// no Done, no Error, no reconnect — exactly the "hangs on bprogress-busy,
/// needs manual relaunch" symptom this fixes.
const IPC_CALL_IDLE_TIMEOUT_MS: u64 = 20_000;
/// How often the per-call watchdog re-checks staleness. Small relative to
/// the timeout so the observed hang is bounded to ~timeout + one interval.
const IPC_WATCHDOG_CHECK_INTERVAL_MS: u64 = 2_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pure decision fn (testable without a socket/watchdog task): has this call
/// gone idle-timed-out? Saturating so a clock oddity never underflows/panics.
fn is_idle_timed_out(last_activity_ms: u64, now_ms: u64, timeout_ms: u64) -> bool {
    now_ms.saturating_sub(last_activity_ms) >= timeout_ms
}

struct CallSink {
    channel: Channel<EndpointEvent>,
    events_sent: AtomicU64,
    overflowed: std::sync::atomic::AtomicBool,
    /// WI-2817: wall-clock ms of the last activity (creation, or any event/
    /// terminal frame) seen for this call — the idle-timeout watchdog's
    /// staleness clock.
    last_activity_ms: AtomicU64,
}

/// Decision returned by `decide_backpressure` — testable in isolation.
#[derive(Debug, PartialEq, Eq)]
pub enum BackpressureDecision {
    /// Forward the event to the channel; under cap.
    Forward,
    /// First overflow event — emit a single backpressure_overflow error,
    /// then drop everything subsequent.
    EmitOverflowAndStop,
    /// Cap already tripped earlier; silently drop.
    Drop,
}

/// Pure decision function — given counter state and the cap, decide
/// what to do with the next event. Atomic state is updated in-place.
/// Extracted from `CallSink::try_send_event` so it can be tested
/// without spinning up a Tauri webview to construct a Channel.
fn decide_backpressure(
    events_sent: &AtomicU64,
    overflowed: &std::sync::atomic::AtomicBool,
    cap: u64,
) -> BackpressureDecision {
    use std::sync::atomic::Ordering;
    if overflowed.load(Ordering::Relaxed) {
        return BackpressureDecision::Drop;
    }
    let n = events_sent.fetch_add(1, Ordering::Relaxed);
    if n >= cap {
        if !overflowed.swap(true, Ordering::Relaxed) {
            BackpressureDecision::EmitOverflowAndStop
        } else {
            BackpressureDecision::Drop
        }
    } else {
        BackpressureDecision::Forward
    }
}

impl CallSink {
    /// Send a non-terminal event with the per-call cap enforced. Returns
    /// true if the event was forwarded; false if it was dropped (cap or
    /// channel error).
    fn try_send_event(&self, event: EndpointEvent) -> bool {
        // WI-2817: ANY inbound frame is activity — resets the idle-timeout clock.
        self.last_activity_ms.store(now_ms(), Ordering::Relaxed);
        match decide_backpressure(&self.events_sent, &self.overflowed, PER_CALL_EVENT_CAP) {
            BackpressureDecision::Forward => self.channel.send(event).is_ok(),
            BackpressureDecision::EmitOverflowAndStop => {
                let _ = self.channel.send(EndpointEvent::Error {
                    code: "backpressure_overflow".to_string(),
                    message: format!(
                        "per-call event cap {} exceeded — server kept emitting but client can't keep up",
                        PER_CALL_EVENT_CAP
                    ),
                });
                false
            }
            BackpressureDecision::Drop => false,
        }
    }

    /// Send a terminal event (Done / Error). Always attempts to forward,
    /// even when overflowed — the consumer needs to know the call ended.
    fn send_terminal(&self, event: EndpointEvent) {
        let _ = self.channel.send(event);
    }
}

/// Cross-platform stream — Unix domain socket OR Windows named pipe.
/// Tokio's `UnixStream` and `NamedPipeClient` share `AsyncRead +
/// AsyncWrite`, but they're separate types — we pick at compile time.
#[cfg(unix)]
type IpcStream = tokio::net::UnixStream;

#[cfg(windows)]
type IpcStream = tokio::net::windows::named_pipe::NamedPipeClient;

#[cfg(unix)]
async fn connect_stream(path: &Path) -> std::io::Result<IpcStream> {
    tokio::net::UnixStream::connect(path).await
}

#[cfg(windows)]
async fn connect_stream(path: &Path) -> std::io::Result<IpcStream> {
    use tokio::net::windows::named_pipe::ClientOptions;
    ClientOptions::new().open(path.as_os_str())
}

/// IPC client. Holds the writer half of the multiplex stream + the
/// in-flight Channel map. Reader runs on a background task.
pub struct IpcClient {
    writer: Mutex<tokio::io::WriteHalf<IpcStream>>,
    next_id: AtomicU64,
    in_flight: Arc<DashMap<u64, CallSink>>,
    /// Cleared once the reader loop sees EOF/error or a write fails — the
    /// connection is dead and `IpcClientHandle` should reconnect.
    alive: Arc<AtomicBool>,
    /// Drop-guard: when this is dropped, the reader task notices and exits.
    _reader_task: tokio::task::JoinHandle<()>,
}

impl IpcClient {
    /// Connect to the IPC server at `socket_path` and spawn the reader
    /// task. Returns once the stream is open; protocol errors mid-call
    /// are surfaced via the per-call Channel as ERROR events.
    pub async fn connect(socket_path: &Path) -> std::io::Result<Arc<Self>> {
        let stream = connect_stream(socket_path).await?;
        let (read_half, write_half) = tokio::io::split(stream);
        let in_flight: Arc<DashMap<u64, CallSink>> = Arc::new(DashMap::new());
        let alive = Arc::new(AtomicBool::new(true));
        let reader_task = tokio::spawn(reader_loop(read_half, in_flight.clone(), alive.clone()));
        Ok(Arc::new(Self {
            writer: Mutex::new(write_half),
            next_id: AtomicU64::new(1),
            in_flight,
            alive,
            _reader_task: reader_task,
        }))
    }

    /// False once the reader loop has seen EOF/error or a write has failed.
    /// The owning `IpcClientHandle` reconnects on the next call.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }

    /// Send a REQUEST and register the Channel for the response stream.
    /// Returns the call id; pass it to `cancel` to abort mid-stream.
    pub async fn invoke(
        &self,
        tool_name: String,
        input: serde_json::Value,
        channel: Channel<EndpointEvent>,
    ) -> Result<u64, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.in_flight.insert(
            id,
            CallSink {
                channel,
                events_sent: AtomicU64::new(0),
                overflowed: std::sync::atomic::AtomicBool::new(false),
                last_activity_ms: AtomicU64::new(now_ms()),
            },
        );
        let req = serde_json::json!({
            "id": id,
            "toolName": tool_name,
            "input": input,
        });
        let bytes = serde_json::to_vec(&req).map_err(|e| e.to_string())?;
        let frame = encode_frame(FrameType::Request, &bytes).map_err(|e| e.to_string())?;
        let mut w = self.writer.lock().await;
        if let Err(e) = w.write_all(&frame).await {
            // Socket gone (e.g. operator restarted) — mark dead so the next
            // call reconnects instead of writing to a broken pipe forever.
            self.alive.store(false, Ordering::Relaxed);
            return Err(e.to_string());
        }
        // WI-2817: arm the idle-timeout watchdog for this call. The reader
        // loop's EOF/error path already handles a connection that visibly
        // DIES; this backstop catches the other case — a connection that
        // stays open but whose peer never responds (most commonly an
        // operator/bg-host restart landing between "accepted the socket" and
        // "actually servicing requests"). If this exact call is still
        // unresolved after IPC_CALL_IDLE_TIMEOUT_MS of total silence, force
        // it to the SAME terminal `connection_lost` the reader loop emits on
        // a real EOF — reusing the existing, already-tested client retry
        // path rather than inventing a new one — and mark the connection
        // dead so the NEXT call reconnects instead of piling onto the same
        // wedged socket.
        {
            let in_flight = self.in_flight.clone();
            let alive = self.alive.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        IPC_WATCHDOG_CHECK_INTERVAL_MS,
                    ))
                    .await;
                    let last_activity = match in_flight.get(&id) {
                        Some(sink) => sink.last_activity_ms.load(Ordering::Relaxed),
                        // Already resolved (Done/Error removed it) — nothing to watch.
                        None => return,
                    };
                    if !is_idle_timed_out(last_activity, now_ms(), IPC_CALL_IDLE_TIMEOUT_MS) {
                        continue;
                    }
                    // Still present AND stale — force-fail it. A concurrent
                    // Done/Error racing this remove is fine: DashMap's
                    // `remove` only fires if the key is STILL present, so at
                    // most one of {reader_loop, this watchdog} wins the race
                    // for a given id.
                    if let Some((_, sink)) = in_flight.remove(&id) {
                        sink.send_terminal(EndpointEvent::Error {
                            code: "connection_lost".to_string(),
                            message: format!(
                                "endpoint-ipc call {id} got no response for over {}s — treating the connection as wedged",
                                IPC_CALL_IDLE_TIMEOUT_MS / 1000
                            ),
                        });
                    }
                    alive.store(false, Ordering::Relaxed);
                    return;
                }
            });
        }
        Ok(id)
    }

    /// Drop every in-flight call registration and return the ids.
    ///
    /// Used on webview page (re)load: the JS context that owned the
    /// Channels is gone, so every further `Channel::send` would eval
    /// `runCallback` against a callback id the new page doesn't have —
    /// the endless "[TAURI] Couldn't find callback id" console flood.
    /// CANCELs for the returned ids must be sent separately (async) so
    /// the server stops streaming work nobody can receive.
    pub fn detach_all(&self) -> Vec<u64> {
        drain_in_flight(&self.in_flight)
    }

    /// Send a CANCEL for an in-flight call. The server aborts the
    /// per-call AbortController and emits a terminal ERROR. Idempotent
    /// — extra CANCELs for an already-terminated id are ignored.
    pub async fn cancel(&self, id: u64) -> Result<(), String> {
        let cancel = serde_json::json!({ "id": id });
        let bytes = serde_json::to_vec(&cancel).map_err(|e| e.to_string())?;
        let frame = encode_frame(FrameType::Cancel, &bytes).map_err(|e| e.to_string())?;
        let mut w = self.writer.lock().await;
        w.write_all(&frame).await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Remove every entry from the in-flight map, returning the call ids.
/// Extracted from `IpcClient::detach_all` so it can be tested without a
/// connected socket.
fn drain_in_flight(in_flight: &DashMap<u64, CallSink>) -> Vec<u64> {
    let ids: Vec<u64> = in_flight.iter().map(|e| *e.key()).collect();
    for id in &ids {
        in_flight.remove(id);
    }
    ids
}

/// Pump bytes off the read half, decode frames, dispatch to Channels.
async fn reader_loop(
    mut reader: tokio::io::ReadHalf<IpcStream>,
    in_flight: Arc<DashMap<u64, CallSink>>,
    alive: Arc<AtomicBool>,
) {
    let mut dec = FrameDecoder::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) => break, // EOF — sidecar closed
            Ok(n) => n,
            Err(_) => break,
        };
        if let Err(e) = dec.push(&buf[..n]) {
            eprintln!("[endpoint_ipc] frame decode error: {e}; closing");
            break;
        }
        for frame in dec.drain() {
            match frame.frame_type {
                FrameType::EventJson => {
                    if let Ok(env) = serde_json::from_slice::<EventJsonEnvelope>(&frame.payload) {
                        if let Some(sink) = in_flight.get(&env.id) {
                            sink.try_send_event(EndpointEvent::Event {
                                name: env.name,
                                data: env.data,
                            });
                        }
                    }
                }
                FrameType::EventBin => {
                    match decode_event_bin_payload(&frame.payload) {
                        Ok(decoded) => {
                            if let Some(sink) = in_flight.get(&decoded.id) {
                                // base64-encode for serde-friendly JSON IPC. Frontend
                                // hook (ipc-stream.ts) atob's back to Uint8Array.
                                use base64::Engine;
                                let b64 = base64::engine::general_purpose::STANDARD
                                    .encode(&decoded.binary);
                                sink.try_send_event(EndpointEvent::Binary {
                                    name: decoded.name,
                                    data: b64,
                                });
                            }
                        }
                        Err(e) => eprintln!("[endpoint_ipc] EVENT_BIN decode error: {e}"),
                    }
                }
                FrameType::Done => {
                    if let Ok(env) = serde_json::from_slice::<DoneEnvelope>(&frame.payload) {
                        if let Some((_, sink)) = in_flight.remove(&env.id) {
                            sink.send_terminal(EndpointEvent::Done { result: env.result });
                        }
                    }
                }
                FrameType::Error => {
                    if let Ok(env) = serde_json::from_slice::<ErrorEnvelope>(&frame.payload) {
                        if let Some((_, sink)) = in_flight.remove(&env.id) {
                            sink.send_terminal(EndpointEvent::Error {
                                code: env.error.code,
                                message: env.error.message,
                            });
                        }
                    }
                }
                FrameType::Request | FrameType::Cancel => {
                    // Server should never send these to the client.
                    eprintln!(
                        "[endpoint_ipc] unexpected server frame type 0x{:02x}",
                        frame.frame_type as u8
                    );
                }
            }
        }
    }

    // EOF / error — mark dead so the handle reconnects, then notify every
    // in-flight Channel.
    alive.store(false, Ordering::Relaxed);
    for entry in in_flight.iter() {
        entry.send_terminal(EndpointEvent::Error {
            code: "connection_lost".to_string(),
            message: "endpoint-ipc Node sidecar connection closed".to_string(),
        });
    }
    in_flight.clear();
}

/// Reconnecting wrapper around `IpcClient` — the managed Tauri state.
///
/// `endpoint_invoke` / `endpoint_cancel` go through this so a dropped
/// connection (most commonly the DEV operator being restarted, which
/// changes its socket path) is transparently re-established on the next
/// call, instead of wedging every `/api` fetch onto the hanging HTTP
/// fallback (libsoup's 6-socket pool — the "loading… forever" / "few
/// seconds" bug). The socket path is resolved lazily via `socket_source`
/// on each (re)connect:
///   - prod: a fixed path from the sidecar's `PAPERCUSP_IPC_READY` handshake.
///   - dev:  re-reads `~/.papercusp/endpoint-ipc.json`, so a restarted
///           operator's NEW socket is picked up automatically.
///
/// A failed (re)connect returns an `invoke_failed:`-prefixed error so the
/// webview's `ipc-fetch.ts` treats IPC as unavailable and falls back to
/// HTTP, exactly as before IPC was wired.
pub struct IpcClientHandle {
    client: Mutex<Option<Arc<IpcClient>>>,
    socket_source: Box<dyn Fn() -> Option<PathBuf> + Send + Sync>,
}

impl IpcClientHandle {
    pub fn new(socket_source: impl Fn() -> Option<PathBuf> + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            client: Mutex::new(None),
            socket_source: Box::new(socket_source),
        })
    }

    /// Return a live client, reconnecting if the current one is dead/absent.
    async fn live(&self) -> Result<Arc<IpcClient>, String> {
        let mut guard = self.client.lock().await;
        if let Some(c) = guard.as_ref() {
            if c.is_alive() {
                return Ok(c.clone());
            }
        }
        let path = (self.socket_source)()
            .ok_or_else(|| "invoke_failed: no endpoint-ipc socket available".to_string())?;
        let c = IpcClient::connect(&path)
            .await
            .map_err(|e| format!("invoke_failed: endpoint-ipc connect: {e}"))?;
        *guard = Some(c.clone());
        Ok(c)
    }

    /// Eagerly (re)connect — used to warm the connection at startup.
    pub async fn warm(&self) -> Result<(), String> {
        self.live().await.map(|_| ())
    }

    /// Drop the current connection so the NEXT call re-resolves the socket
    /// via `socket_source` and dials fresh. EI-190: the dev wrapper calls
    /// this when the build switcher changes the selected /api operator — the
    /// OLD operator's socket is usually still healthy, so the `is_alive()`
    /// reconnect path would never fire on its own. In-flight calls are
    /// flushed first, exactly like a page (re)load (the build switch
    /// navigates the webview, so the old page's channels are dead anyway).
    pub fn reset(self: &Arc<Self>) {
        self.flush_for_page_load();
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut guard = this.client.lock().await;
            *guard = None;
        });
    }

    pub async fn invoke(
        &self,
        tool_name: String,
        input: serde_json::Value,
        channel: Channel<EndpointEvent>,
    ) -> Result<u64, String> {
        self.live().await?.invoke(tool_name, input, channel).await
    }

    pub async fn cancel(&self, id: u64) -> Result<(), String> {
        // Only the currently-connected client owns its ids; a cancel after a
        // reconnect targets a call that's already gone, so a missing/replaced
        // client is a no-op success.
        let guard = self.client.lock().await;
        match guard.as_ref() {
            Some(c) => c.cancel(id).await,
            None => Ok(()),
        }
    }

    /// Flush every in-flight call because the webview is (re)loading.
    ///
    /// The old page's JS context owned all the Channels; after a reload the
    /// reader loop would keep fanning server stream frames (sync SSE, log
    /// tails, heartbeats, …) into dead callbacks forever — each send evals
    /// `runCallback(<stale id>)` and floods the console with
    /// "[TAURI] Couldn't find callback id". Detach synchronously (so the new
    /// page's first invoke can't be swept up), then CANCEL server-side in the
    /// background so the operator stops streaming work nobody receives.
    pub fn flush_for_page_load(&self) {
        let client = match self.client.try_lock() {
            Ok(guard) => guard.as_ref().cloned(),
            // The lock is only held across (re)connects and brief
            // invoke/cancel forwarding; a client mid-(re)connect is brand
            // new and owns no stale calls. Skipping is safe either way —
            // worst case the flood resumes until the next reload.
            Err(_) => None,
        };
        let Some(c) = client else { return };
        let ids = c.detach_all();
        if ids.is_empty() {
            return;
        }
        println!(
            "[endpoint_ipc] webview (re)load — cancelled {} stale in-flight call(s)",
            ids.len()
        );
        tauri::async_runtime::spawn(async move {
            for id in ids {
                let _ = c.cancel(id).await;
            }
        });
    }
}

/// Tauri command — invoked from the webview. The wire shape mirrors
/// what `apps/operator/lib/transport-adapters/ipc-stream.ts` sends.
#[tauri::command]
#[specta::specta]
pub async fn endpoint_invoke(
    state: tauri::State<'_, Arc<IpcClientHandle>>,
    tool_name: String,
    input: serde_json::Value,
    channel: Channel<EndpointEvent>,
) -> Result<u64, String> {
    state.invoke(tool_name, input, channel).await
}

/// Tauri command — cancel an in-flight call.
#[tauri::command]
#[specta::specta]
pub async fn endpoint_cancel(
    state: tauri::State<'_, Arc<IpcClientHandle>>,
    call_id: u64,
) -> Result<(), String> {
    state.cancel(call_id).await
}

/// Wait for the sidecar to print `PAPERCUSP_IPC_READY socket=<path>` on
/// stdout and return the resolved path. Use this in main.rs after
/// spawning the sidecar with piped stdout (separately — main.rs is on
/// std::process today; the switch to piped output is its own commit).
pub fn parse_ipc_ready_line(line: &str) -> Option<&str> {
    line.strip_prefix("PAPERCUSP_IPC_READY socket=")
        .map(|s| s.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn backpressure_forwards_under_cap() {
        let sent = AtomicU64::new(0);
        let overflowed = AtomicBool::new(false);
        for _ in 0..10 {
            assert_eq!(
                decide_backpressure(&sent, &overflowed, 10_000),
                BackpressureDecision::Forward,
            );
        }
        assert_eq!(sent.load(Ordering::Relaxed), 10);
        assert!(!overflowed.load(Ordering::Relaxed));
    }

    #[test]
    fn backpressure_emits_overflow_exactly_once_at_cap() {
        let sent = AtomicU64::new(9_999);
        let overflowed = AtomicBool::new(false);
        // 10_000th send is the last allowed; 10_001th trips the cap.
        assert_eq!(
            decide_backpressure(&sent, &overflowed, 10_000),
            BackpressureDecision::Forward,
        );
        assert_eq!(
            decide_backpressure(&sent, &overflowed, 10_000),
            BackpressureDecision::EmitOverflowAndStop,
        );
        assert!(overflowed.load(Ordering::Relaxed));
        // Subsequent sends drop silently.
        for _ in 0..5 {
            assert_eq!(
                decide_backpressure(&sent, &overflowed, 10_000),
                BackpressureDecision::Drop,
            );
        }
    }

    #[test]
    fn backpressure_pre_overflowed_state_drops_immediately() {
        let sent = AtomicU64::new(50_000);
        let overflowed = AtomicBool::new(true);
        for _ in 0..3 {
            assert_eq!(
                decide_backpressure(&sent, &overflowed, 10_000),
                BackpressureDecision::Drop,
            );
        }
    }

    // WI-2817: the idle-timeout watchdog's pure staleness decision.
    #[test]
    fn idle_timeout_not_yet_stale_under_the_threshold() {
        assert!(!is_idle_timed_out(1_000, 1_000 + 19_999, 20_000));
    }

    #[test]
    fn idle_timeout_stale_exactly_at_the_threshold() {
        // >= is intentional: a call that has had ZERO activity for exactly
        // the timeout is treated as wedged, not given one more grace tick.
        assert!(is_idle_timed_out(1_000, 1_000 + 20_000, 20_000));
    }

    #[test]
    fn idle_timeout_stale_well_past_the_threshold() {
        assert!(is_idle_timed_out(1_000, 1_000 + 60_000, 20_000));
    }

    #[test]
    fn idle_timeout_saturates_instead_of_panicking_on_a_clock_oddity() {
        // now < last_activity (a clock adjustment, or a racy read) must never
        // underflow/panic — saturating_sub floors at 0, which is never >= a
        // positive timeout.
        assert!(!is_idle_timed_out(50_000, 1_000, 20_000));
    }

    #[test]
    fn drain_in_flight_empties_map_and_returns_ids() {
        let map: DashMap<u64, CallSink> = DashMap::new();
        for id in [3u64, 7, 11] {
            map.insert(
                id,
                CallSink {
                    channel: Channel::new(|_| Ok(())),
                    events_sent: AtomicU64::new(0),
                    overflowed: AtomicBool::new(false),
                    last_activity_ms: AtomicU64::new(now_ms()),
                },
            );
        }
        let mut ids = drain_in_flight(&map);
        ids.sort_unstable();
        assert_eq!(ids, vec![3, 7, 11]);
        assert!(map.is_empty());
        // Idempotent on an empty map.
        assert!(drain_in_flight(&map).is_empty());
    }

    #[test]
    fn per_call_cap_constant_matches_plan() {
        // Plan said 10_000 per-call. Don't let a refactor silently
        // halve it without a deliberate decision.
        assert_eq!(PER_CALL_EVENT_CAP, 10_000);
    }

    #[test]
    fn parses_ready_line_with_unix_path() {
        let line = "PAPERCUSP_IPC_READY socket=/home/u/.papercusp/sockets/12345.sock\n";
        assert_eq!(
            parse_ipc_ready_line(line),
            Some("/home/u/.papercusp/sockets/12345.sock")
        );
    }

    #[test]
    fn parses_ready_line_with_windows_pipe() {
        let line = "PAPERCUSP_IPC_READY socket=\\\\.\\pipe\\papercusp-12345\n";
        assert_eq!(
            parse_ipc_ready_line(line),
            Some("\\\\.\\pipe\\papercusp-12345"),
        );
    }

    #[test]
    fn rejects_non_ready_lines() {
        assert_eq!(parse_ipc_ready_line("some other log\n"), None);
        assert_eq!(parse_ipc_ready_line(""), None);
        // The prefix match is exact — leading whitespace / partial prefixes
        // are NOT the handshake line.
        assert_eq!(parse_ipc_ready_line(" PAPERCUSP_IPC_READY socket=/x"), None);
        assert_eq!(parse_ipc_ready_line("PAPERCUSP_IPC_READY"), None);
    }

    #[test]
    fn ready_line_tolerates_crlf_and_no_newline() {
        assert_eq!(
            parse_ipc_ready_line("PAPERCUSP_IPC_READY socket=/tmp/a.sock\r\n"),
            Some("/tmp/a.sock")
        );
        assert_eq!(
            parse_ipc_ready_line("PAPERCUSP_IPC_READY socket=/tmp/a.sock"),
            Some("/tmp/a.sock")
        );
    }

    // ── EndpointEvent wire shape ────────────────────────────────────────────
    //
    // The webview hook (ipc-stream.ts) switches on `kind` and reads these
    // exact field names — a serde rename would silently break the frontend.

    #[test]
    fn endpoint_event_serializes_with_snake_case_kind_tags() {
        let event = EndpointEvent::Event {
            name: "delta".into(),
            data: serde_json::json!({ "text": "hi" }),
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({ "kind": "event", "name": "delta", "data": { "text": "hi" } })
        );

        let binary = EndpointEvent::Binary {
            name: "audio".into(),
            data: "AQID".into(),
        };
        assert_eq!(
            serde_json::to_value(&binary).unwrap(),
            serde_json::json!({ "kind": "binary", "name": "audio", "data": "AQID" })
        );

        let done = EndpointEvent::Done {
            result: serde_json::json!({ "ok": true }),
        };
        assert_eq!(
            serde_json::to_value(&done).unwrap(),
            serde_json::json!({ "kind": "done", "result": { "ok": true } })
        );

        let error = EndpointEvent::Error {
            code: "quota".into(),
            message: "over".into(),
        };
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({ "kind": "error", "code": "quota", "message": "over" })
        );
    }

    #[test]
    fn endpoint_event_round_trips_through_serde() {
        let original = EndpointEvent::Error {
            code: "c".into(),
            message: "m".into(),
        };
        let json = serde_json::to_string(&original).unwrap();
        let back: EndpointEvent = serde_json::from_str(&json).unwrap();
        match back {
            EndpointEvent::Error { code, message } => {
                assert_eq!(code, "c");
                assert_eq!(message, "m");
            }
            other => panic!("round-trip changed variant: {other:?}"),
        }
    }

    // ── Server envelope parsing ─────────────────────────────────────────────

    #[test]
    fn event_json_envelope_parses_server_payload() {
        let env: EventJsonEnvelope =
            serde_json::from_slice(br#"{"id":7,"name":"delta","data":{"text":"hi"}}"#).unwrap();
        assert_eq!(env.id, 7);
        assert_eq!(env.name, "delta");
        assert_eq!(env.data, serde_json::json!({ "text": "hi" }));
    }

    #[test]
    fn done_and_error_envelopes_parse_server_payloads() {
        let done: DoneEnvelope =
            serde_json::from_slice(br#"{"id":3,"result":{"content":[]}}"#).unwrap();
        assert_eq!(done.id, 3);
        assert_eq!(done.result, serde_json::json!({ "content": [] }));

        let err: ErrorEnvelope =
            serde_json::from_slice(br#"{"id":9,"error":{"code":"role_gate","message":"denied"}}"#)
                .unwrap();
        assert_eq!(err.id, 9);
        assert_eq!(err.error.code, "role_gate");
        assert_eq!(err.error.message, "denied");
    }

    #[test]
    fn envelopes_reject_malformed_payloads() {
        // Missing id — the reader loop must skip these, never panic.
        assert!(
            serde_json::from_slice::<EventJsonEnvelope>(br#"{"name":"delta","data":1}"#).is_err()
        );
        // id of the wrong JSON type.
        assert!(serde_json::from_slice::<EventJsonEnvelope>(
            br#"{"id":"7","name":"delta","data":1}"#
        )
        .is_err());
        // Error envelope with a flat (non-nested) error shape.
        assert!(
            serde_json::from_slice::<ErrorEnvelope>(br#"{"id":1,"code":"x","message":"y"}"#)
                .is_err()
        );
        // Outright garbage.
        assert!(serde_json::from_slice::<DoneEnvelope>(b"not json").is_err());
        assert!(serde_json::from_slice::<DoneEnvelope>(b"").is_err());
    }

    // ── CallSink send paths (capturing Channel, no webview needed) ──────────

    /// A CallSink whose Channel captures every serialized body it forwards.
    fn capturing_sink() -> (CallSink, Arc<std::sync::Mutex<Vec<String>>>) {
        let captured: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(vec![]));
        let sink_captured = captured.clone();
        let channel = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
            if let tauri::ipc::InvokeResponseBody::Json(s) = body {
                sink_captured.lock().unwrap().push(s);
            }
            Ok(())
        });
        (
            CallSink {
                channel,
                events_sent: AtomicU64::new(0),
                overflowed: AtomicBool::new(false),
                last_activity_ms: AtomicU64::new(now_ms()),
            },
            captured,
        )
    }

    #[test]
    fn call_sink_forwards_events_under_cap() {
        let (sink, captured) = capturing_sink();
        for i in 0..3 {
            assert!(sink.try_send_event(EndpointEvent::Event {
                name: format!("e{i}"),
                data: serde_json::Value::Null,
            }));
        }
        let bodies = captured.lock().unwrap();
        assert_eq!(bodies.len(), 3);
        assert!(bodies[0].contains("\"e0\""));
        assert!(bodies[2].contains("\"e2\""));
    }

    #[test]
    fn call_sink_emits_one_overflow_error_then_drops_but_terminal_still_lands() {
        let (sink, captured) = capturing_sink();
        // Pre-position the counter one below the cap so the test doesn't
        // loop 10k sends: the next send is the last allowed one.
        sink.events_sent
            .store(PER_CALL_EVENT_CAP - 1, Ordering::Relaxed);

        let ev = || EndpointEvent::Event {
            name: "delta".into(),
            data: serde_json::Value::Null,
        };
        assert!(sink.try_send_event(ev()), "last under-cap event forwards");
        // Cap trip: returns false but emits exactly ONE backpressure error.
        assert!(!sink.try_send_event(ev()));
        // Everything after is dropped silently — no further bodies.
        assert!(!sink.try_send_event(ev()));
        assert!(!sink.try_send_event(ev()));

        {
            let bodies = captured.lock().unwrap();
            assert_eq!(
                bodies.len(),
                2,
                "one event + one overflow error, nothing more"
            );
            assert!(
                bodies[1].contains("backpressure_overflow"),
                "got: {}",
                bodies[1]
            );
        }

        // Terminal events bypass the cap — the consumer must learn the call ended.
        sink.send_terminal(EndpointEvent::Done {
            result: serde_json::Value::Null,
        });
        let bodies = captured.lock().unwrap();
        assert_eq!(bodies.len(), 3);
        assert!(bodies[2].contains("\"done\""));
    }

    /// End-to-end-ish: spin up a Node-server-equivalent on a Unix socket
    /// IN-PROCESS in Rust (no actual Node), have the client connect,
    /// invoke a "tool", and assert the events received. Validates that
    /// the framing is byte-identical to what the TS server emits.
    #[cfg(unix)]
    #[tokio::test]
    async fn end_to_end_against_synthetic_server() {
        use std::time::Duration;
        use tokio::net::UnixListener;

        // Keep the socket path short: unix sockets cap at SUN_LEN (~104
        // bytes on macOS), and darwin's temp_dir() is a long
        // /var/folders/... path — the old verbose name + full uuid blew
        // the cap and UnixListener::bind failed only on macOS. /tmp is
        // valid on every unix (a symlink to /private/tmp on darwin).
        let tmp = std::path::PathBuf::from(format!(
            "/tmp/pcipc-{}-{}.sock",
            std::process::id(),
            &uuid::Uuid::new_v4().simple().to_string()[..8]
        ));
        let _ = std::fs::remove_file(&tmp);

        let listener = UnixListener::bind(&tmp).unwrap();
        let server_path = tmp.clone();

        // Synthetic server: accept one connection, read a REQUEST,
        // emit 2 EVENT_JSON + 1 DONE.
        let server_task = tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let (mut r, mut w) = tokio::io::split(sock);
            let mut buf = [0u8; 4096];
            let n = r.read(&mut buf).await.unwrap();
            let mut dec = FrameDecoder::new();
            dec.push(&buf[..n]).unwrap();
            let req = dec.drain().pop().unwrap();
            assert_eq!(req.frame_type, FrameType::Request);
            let parsed: serde_json::Value = serde_json::from_slice(&req.payload).unwrap();
            let id = parsed["id"].as_u64().unwrap();

            let e1 = serde_json::to_vec(&serde_json::json!({
                "id": id, "name": "delta", "data": { "text": "hi" }
            }))
            .unwrap();
            let e2 = serde_json::to_vec(&serde_json::json!({
                "id": id, "name": "delta", "data": { "text": "there" }
            }))
            .unwrap();
            let done_payload = serde_json::to_vec(&serde_json::json!({
                "id": id, "result": { "content": [{ "type": "text", "text": "hi there" }] }
            }))
            .unwrap();

            w.write_all(&encode_frame(FrameType::EventJson, &e1).unwrap())
                .await
                .unwrap();
            w.write_all(&encode_frame(FrameType::EventJson, &e2).unwrap())
                .await
                .unwrap();
            w.write_all(&encode_frame(FrameType::Done, &done_payload).unwrap())
                .await
                .unwrap();
            // Hold the socket open briefly so the client has time to read.
            tokio::time::sleep(Duration::from_millis(50)).await;
        });

        // Wait for server to bind.
        tokio::time::sleep(Duration::from_millis(20)).await;

        // We can't easily use the real IpcClient::invoke here because it
        // requires a Tauri AppHandle to allocate a Channel<T>. So we test
        // the framing/reader-loop in isolation — invoke writes a REQUEST,
        // we read the wire bytes back.
        let mut stream = tokio::net::UnixStream::connect(&server_path).await.unwrap();
        let req = serde_json::to_vec(&serde_json::json!({
            "id": 1u64, "toolName": "synth", "input": {}
        }))
        .unwrap();
        stream
            .write_all(&encode_frame(FrameType::Request, &req).unwrap())
            .await
            .unwrap();

        let mut dec = FrameDecoder::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = stream.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            dec.push(&buf[..n]).unwrap();
            let frames = dec.drain();
            if frames.iter().any(|f| f.frame_type == FrameType::Done) {
                let events: Vec<_> = frames
                    .iter()
                    .filter(|f| f.frame_type == FrameType::EventJson)
                    .collect();
                assert_eq!(events.len(), 2);
                let p0: serde_json::Value = serde_json::from_slice(&events[0].payload).unwrap();
                assert_eq!(p0["data"]["text"], "hi");
                let p1: serde_json::Value = serde_json::from_slice(&events[1].payload).unwrap();
                assert_eq!(p1["data"]["text"], "there");
                break;
            }
        }

        let _ = server_task.await;
        let _ = std::fs::remove_file(&server_path);
    }
}
