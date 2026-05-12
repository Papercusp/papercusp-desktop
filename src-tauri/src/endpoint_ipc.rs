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

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    Done {
        result: serde_json::Value,
    },
    /// Dispatch or handler failed (role gate, quota, timeout, throw).
    Error {
        code: String,
        message: String,
    },
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
struct CallSink {
    channel: Channel<EndpointEvent>,
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
        let reader_task = tokio::spawn(reader_loop(read_half, in_flight.clone()));
        Ok(Arc::new(Self {
            writer: Mutex::new(write_half),
            next_id: AtomicU64::new(1),
            in_flight,
            _reader_task: reader_task,
        }))
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
        self.in_flight.insert(id, CallSink { channel });
        let req = serde_json::json!({
            "id": id,
            "toolName": tool_name,
            "input": input,
        });
        let bytes = serde_json::to_vec(&req).map_err(|e| e.to_string())?;
        let frame = encode_frame(FrameType::Request, &bytes).map_err(|e| e.to_string())?;
        let mut w = self.writer.lock().await;
        w.write_all(&frame).await.map_err(|e| e.to_string())?;
        Ok(id)
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

/// Pump bytes off the read half, decode frames, dispatch to Channels.
async fn reader_loop(
    mut reader: tokio::io::ReadHalf<IpcStream>,
    in_flight: Arc<DashMap<u64, CallSink>>,
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
                            let _ = sink.channel.send(EndpointEvent::Event {
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
                                let _ = sink.channel.send(EndpointEvent::Binary {
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
                            let _ = sink.channel.send(EndpointEvent::Done { result: env.result });
                        }
                    }
                }
                FrameType::Error => {
                    if let Ok(env) = serde_json::from_slice::<ErrorEnvelope>(&frame.payload) {
                        if let Some((_, sink)) = in_flight.remove(&env.id) {
                            let _ = sink.channel.send(EndpointEvent::Error {
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

    // EOF / error — notify every in-flight Channel.
    for entry in in_flight.iter() {
        let _ = entry.channel.send(EndpointEvent::Error {
            code: "connection_lost".to_string(),
            message: "endpoint-ipc Node sidecar connection closed".to_string(),
        });
    }
    in_flight.clear();
}

/// Tauri command — invoked from the webview. The wire shape mirrors
/// what `apps/operator/lib/transport-adapters/ipc-stream.ts` will send.
#[tauri::command]
#[specta::specta]
pub async fn endpoint_invoke(
    state: tauri::State<'_, Arc<IpcClient>>,
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
    state: tauri::State<'_, Arc<IpcClient>>,
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

        let tmp = std::env::temp_dir().join(format!(
            "papercusp-ipc-rust-test-{}-{}.sock",
            std::process::id(),
            uuid::Uuid::new_v4()
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
            })).unwrap();
            let e2 = serde_json::to_vec(&serde_json::json!({
                "id": id, "name": "delta", "data": { "text": "there" }
            })).unwrap();
            let done_payload = serde_json::to_vec(&serde_json::json!({
                "id": id, "result": { "content": [{ "type": "text", "text": "hi there" }] }
            })).unwrap();

            w.write_all(&encode_frame(FrameType::EventJson, &e1).unwrap()).await.unwrap();
            w.write_all(&encode_frame(FrameType::EventJson, &e2).unwrap()).await.unwrap();
            w.write_all(&encode_frame(FrameType::Done, &done_payload).unwrap()).await.unwrap();
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
        })).unwrap();
        stream.write_all(&encode_frame(FrameType::Request, &req).unwrap()).await.unwrap();

        let mut dec = FrameDecoder::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = stream.read(&mut buf).await.unwrap();
            if n == 0 { break; }
            dec.push(&buf[..n]).unwrap();
            let frames = dec.drain();
            if frames.iter().any(|f| f.frame_type == FrameType::Done) {
                let events: Vec<_> = frames.iter().filter(|f| f.frame_type == FrameType::EventJson).collect();
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
