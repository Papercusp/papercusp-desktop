//! Rust mirror of the TS frame codec. Encoder output and decoder behavior must
//! match byte-for-byte.
//!
//! ⚠ The TS source of truth is `libs/generic/ipc-framing/src/index.ts`. It was
//! extracted there (papercusp-systems-abstraction-2026-05-29 P-030);
//! `packages/operator-core/lib/endpoint-ipc/framing.ts` is now only a
//! re-export shim, and the `apps/operator/...` path this comment used to name
//! no longer exists at all. The byte-for-byte contract is pinned by a shared
//! golden-vector test asserted on BOTH sides — see `golden_data_frame_matches_ts`
//! below and its twin in `libs/generic/ipc-framing/src/index.test.ts`.
//!
//! Frame format (per packages/operator-core/lib/endpoint-ipc/PROTOCOL.md):
//!   [4B length BE][1B type][payload (length bytes)]
//!
//! Big-endian for all multi-byte integers. 16 MiB per-frame cap.

#![allow(dead_code)] // wired in by endpoint_ipc.rs once that lands

use bytes::{Buf, BufMut, BytesMut};
use std::collections::VecDeque;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameType {
    Request = 0x01,
    EventJson = 0x02,
    Done = 0x03,
    Error = 0x04,
    EventBin = 0x05,
    Cancel = 0x06,
    /// Client -> Server payload for an in-flight call
    /// (no-http-anywhere-2026-07-28 P-012). Request + Cancel alone make the
    /// channel server-STREAMING: once a call is open the client can only
    /// abandon it, never feed it. Data is what makes it full duplex, so a
    /// long-lived stream (the P-013 WebSocket shim, and the PTY/voice
    /// connections behind P-014) can ride this channel instead of holding a
    /// real socket.
    Data = 0x07,
}

impl FrameType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0x01 => Some(Self::Request),
            0x02 => Some(Self::EventJson),
            0x03 => Some(Self::Done),
            0x04 => Some(Self::Error),
            0x05 => Some(Self::EventBin),
            0x06 => Some(Self::Cancel),
            0x07 => Some(Self::Data),
            _ => None,
        }
    }
}

pub const HEADER_BYTES: usize = 5;
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug)]
pub struct Frame {
    pub frame_type: FrameType,
    pub payload: Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("frame payload too large: {0} bytes (cap {})", MAX_FRAME_BYTES)]
    TooLarge(usize),
    #[error("incoming frame length too large: {0} bytes (cap {})", MAX_FRAME_BYTES)]
    IncomingTooLarge(usize),
    #[error("unknown frame type: 0x{0:02x}")]
    UnknownType(u8),
    #[error("EVENT_BIN payload too short: {0} bytes")]
    EventBinTooShort(usize),
    #[error("EVENT_BIN nameLen={0} exceeds payload ({1} bytes)")]
    EventBinNameLenOverflow(u32, usize),
    #[error("DATA payload too short: {0} bytes")]
    DataTooShort(usize),
}

/// Encode a frame into a freshly-allocated Vec<u8>. Use when you want
/// to write to an `AsyncWrite` in one go.
pub fn encode_frame(frame_type: FrameType, payload: &[u8]) -> Result<Vec<u8>, FrameError> {
    if payload.len() > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge(payload.len()));
    }
    let mut out = Vec::with_capacity(HEADER_BYTES + payload.len());
    out.put_u32(payload.len() as u32);
    out.put_u8(frame_type as u8);
    out.extend_from_slice(payload);
    Ok(out)
}

/// Encode an EVENT_BIN payload. Layout: [8B id BE][4B nameLen BE][name UTF-8][binary].
pub fn encode_event_bin_payload(id: u64, name: &str, binary: &[u8]) -> Vec<u8> {
    let name_bytes = name.as_bytes();
    let mut out = Vec::with_capacity(8 + 4 + name_bytes.len() + binary.len());
    out.put_u64(id);
    out.put_u32(name_bytes.len() as u32);
    out.extend_from_slice(name_bytes);
    out.extend_from_slice(binary);
    out
}

#[derive(Debug)]
pub struct DecodedEventBin {
    pub id: u64,
    pub name: String,
    pub binary: Vec<u8>,
}

pub fn decode_event_bin_payload(payload: &[u8]) -> Result<DecodedEventBin, FrameError> {
    if payload.len() < 12 {
        return Err(FrameError::EventBinTooShort(payload.len()));
    }
    let mut cursor = &payload[..];
    let id = cursor.get_u64();
    let name_len = cursor.get_u32();
    if 12 + name_len as usize > payload.len() {
        return Err(FrameError::EventBinNameLenOverflow(name_len, payload.len()));
    }
    let (name_bytes, rest) = cursor.split_at(name_len as usize);
    let name = String::from_utf8_lossy(name_bytes).into_owned();
    Ok(DecodedEventBin {
        id,
        name,
        binary: rest.to_vec(),
    })
}

/// Encode a DATA payload. Layout: [8B id BE][payload].
///
/// Deliberately thinner than EVENT_BIN: that frame is self-describing because
/// the server multiplexes *named* events onto one call, whereas DATA is an
/// opaque byte run for an ALREADY-open call, so `id` is the only routing key
/// needed. No length prefix on the tail either — the frame header's own length
/// already bounds it, and duplicating that would create two sources of truth
/// that can disagree.
pub fn encode_data_payload(id: u64, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + payload.len());
    out.put_u64(id);
    out.extend_from_slice(payload);
    out
}

#[derive(Debug)]
pub struct DecodedData {
    pub id: u64,
    pub payload: Vec<u8>,
}

pub fn decode_data_payload(payload: &[u8]) -> Result<DecodedData, FrameError> {
    if payload.len() < 8 {
        return Err(FrameError::DataTooShort(payload.len()));
    }
    let mut cursor = &payload[..];
    let id = cursor.get_u64();
    Ok(DecodedData {
        id,
        // A zero-byte tail is legal and meaningful — it is how a sender signals
        // "end of stream, no bytes" without tearing the call down.
        payload: cursor.to_vec(),
    })
}

/// Streaming decoder. Push bytes via `push`; drain ready frames via `drain`.
/// On `FrameError`, caller should close the underlying socket.
#[derive(Debug, Default)]
pub struct FrameDecoder {
    buf: BytesMut,
    ready: VecDeque<Frame>,
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), FrameError> {
        self.buf.extend_from_slice(chunk);
        loop {
            if self.buf.len() < HEADER_BYTES {
                break;
            }
            // Peek without consuming so we can return cleanly on partial frames.
            let len =
                u32::from_be_bytes([self.buf[0], self.buf[1], self.buf[2], self.buf[3]]) as usize;
            if len > MAX_FRAME_BYTES {
                return Err(FrameError::IncomingTooLarge(len));
            }
            let total = HEADER_BYTES + len;
            if self.buf.len() < total {
                break;
            }
            // Now we have a full frame — advance.
            let _ = self.buf.split_to(4); // length
            let type_byte = self.buf.get_u8();
            let frame_type =
                FrameType::from_u8(type_byte).ok_or(FrameError::UnknownType(type_byte))?;
            let payload = self.buf.split_to(len).to_vec();
            self.ready.push_back(Frame {
                frame_type,
                payload,
            });
        }
        Ok(())
    }

    pub fn drain(&mut self) -> Vec<Frame> {
        self.ready.drain(..).collect()
    }

    pub fn buffered_bytes(&self) -> usize {
        self.buf.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_frame_writes_len_be_type_payload() {
        let f = encode_frame(FrameType::Request, b"hello").unwrap();
        assert_eq!(f.len(), HEADER_BYTES + 5);
        assert_eq!(&f[0..4], &[0, 0, 0, 5]);
        assert_eq!(f[4], FrameType::Request as u8);
        assert_eq!(&f[5..], b"hello");
    }

    #[test]
    fn encode_frame_rejects_oversized() {
        let huge = vec![0u8; MAX_FRAME_BYTES + 1];
        assert!(matches!(
            encode_frame(FrameType::EventBin, &huge),
            Err(FrameError::TooLarge(_)),
        ));
    }

    #[test]
    fn encode_frame_zero_length() {
        let f = encode_frame(FrameType::Cancel, b"").unwrap();
        assert_eq!(f.len(), HEADER_BYTES);
        assert_eq!(&f[0..4], &[0, 0, 0, 0]);
        assert_eq!(f[4], FrameType::Cancel as u8);
    }

    #[test]
    fn event_bin_payload_round_trip() {
        let payload = encode_event_bin_payload(
            123_456_789_012_345u64,
            "image_chunk",
            &[0xde, 0xad, 0xbe, 0xef],
        );
        let decoded = decode_event_bin_payload(&payload).unwrap();
        assert_eq!(decoded.id, 123_456_789_012_345u64);
        assert_eq!(decoded.name, "image_chunk");
        assert_eq!(decoded.binary, vec![0xde, 0xad, 0xbe, 0xef]);
    }

    #[test]
    fn event_bin_truncated_payload() {
        let bad = vec![1u8, 2, 3];
        assert!(matches!(
            decode_event_bin_payload(&bad),
            Err(FrameError::EventBinTooShort(_)),
        ));
    }

    #[test]
    fn event_bin_namelen_overflow() {
        let mut bad = Vec::with_capacity(16);
        bad.put_u64(1u64);
        bad.put_u32(999u32); // claim name is 999 bytes
        bad.extend_from_slice(b"name"); // but only 4 bytes follow
        assert!(matches!(
            decode_event_bin_payload(&bad),
            Err(FrameError::EventBinNameLenOverflow(999, _)),
        ));
    }

    #[test]
    fn event_bin_empty_binary_tail() {
        let payload = encode_event_bin_payload(1, "pulse", &[]);
        let decoded = decode_event_bin_payload(&payload).unwrap();
        assert!(decoded.binary.is_empty());
    }

    #[test]
    fn decoder_single_frame_in_one_chunk() {
        let mut dec = FrameDecoder::new();
        let frame = encode_frame(FrameType::Done, b"{\"id\":1}").unwrap();
        dec.push(&frame).unwrap();
        let out = dec.drain();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].frame_type, FrameType::Done);
        assert_eq!(out[0].payload, b"{\"id\":1}".to_vec());
    }

    #[test]
    fn decoder_multiple_frames_in_one_chunk() {
        let mut dec = FrameDecoder::new();
        let f1 = encode_frame(FrameType::EventJson, b"{\"id\":1}").unwrap();
        let f2 = encode_frame(FrameType::EventJson, b"{\"id\":1}").unwrap();
        let f3 = encode_frame(FrameType::Done, b"{\"id\":1}").unwrap();
        let mut combined = Vec::new();
        combined.extend_from_slice(&f1);
        combined.extend_from_slice(&f2);
        combined.extend_from_slice(&f3);
        dec.push(&combined).unwrap();
        let out = dec.drain();
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].frame_type, FrameType::EventJson);
        assert_eq!(out[1].frame_type, FrameType::EventJson);
        assert_eq!(out[2].frame_type, FrameType::Done);
    }

    #[test]
    fn decoder_handles_byte_by_byte_chunks() {
        let mut dec = FrameDecoder::new();
        let payload_str = format!(r#"{{"id":42,"name":"big","data":"{}"}}"#, "x".repeat(500));
        let frame = encode_frame(FrameType::EventJson, payload_str.as_bytes()).unwrap();
        for byte in frame.iter() {
            dec.push(&[*byte]).unwrap();
        }
        let out = dec.drain();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].frame_type, FrameType::EventJson);
        assert_eq!(out[0].payload, payload_str.into_bytes());
    }

    #[test]
    fn decoder_buffers_partial_frame() {
        let mut dec = FrameDecoder::new();
        let frame = encode_frame(FrameType::EventJson, b"{\"id\":1}").unwrap();
        dec.push(&frame[..3]).unwrap();
        assert_eq!(dec.drain().len(), 0);
        assert_eq!(dec.buffered_bytes(), 3);
        dec.push(&frame[3..]).unwrap();
        let out = dec.drain();
        assert_eq!(out.len(), 1);
        assert_eq!(dec.buffered_bytes(), 0);
    }

    #[test]
    fn decoder_rejects_unknown_frame_type() {
        let mut dec = FrameDecoder::new();
        // length=0, type=0x99
        let bad = vec![0u8, 0, 0, 0, 0x99];
        assert!(matches!(dec.push(&bad), Err(FrameError::UnknownType(0x99)),));
    }

    #[test]
    fn decoder_rejects_oversized_length_in_header() {
        let mut dec = FrameDecoder::new();
        let mut bad = Vec::with_capacity(HEADER_BYTES);
        bad.put_u32((MAX_FRAME_BYTES + 1) as u32);
        bad.put_u8(FrameType::Request as u8);
        assert!(matches!(
            dec.push(&bad),
            Err(FrameError::IncomingTooLarge(_)),
        ));
    }

    #[test]
    fn drain_returns_only_newly_ready_frames() {
        let mut dec = FrameDecoder::new();
        dec.push(&encode_frame(FrameType::Cancel, b"{\"id\":1}").unwrap())
            .unwrap();
        assert_eq!(dec.drain().len(), 1);
        assert_eq!(dec.drain().len(), 0);
    }

    // ---- DATA (0x07) — no-http-anywhere-2026-07-28 P-012 ----
    //
    // The plan's binding requirement is that this frame is "mirrored
    // byte-for-byte" with the TS codec. GOLDEN_DATA_FRAME is the shared
    // fixture: libs/generic/ipc-framing/src/index.test.ts asserts the SAME
    // bytes. If either encoder changes, both suites fail together — which is
    // the point. A round-trip test alone cannot catch a mirrored-but-wrong
    // layout, because each side would happily agree with itself.
    const GOLDEN_DATA_FRAME: &[u8] = &[
        0x00, 0x00, 0x00, 0x0a, // length = 10 (8B id + 2B payload)
        0x07, // type = Data
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, // id = 1 (u64 BE)
        0xaa, 0xbb, // payload
    ];

    #[test]
    fn golden_data_frame_matches_ts() {
        let frame = encode_frame(FrameType::Data, &encode_data_payload(1, &[0xaa, 0xbb])).unwrap();
        assert_eq!(frame.as_slice(), GOLDEN_DATA_FRAME);
    }

    #[test]
    fn data_payload_round_trips() {
        let p = encode_data_payload(0xdead_beef, &[1, 2, 3]);
        let d = decode_data_payload(&p).unwrap();
        assert_eq!(d.id, 0xdead_beef);
        assert_eq!(d.payload, vec![1, 2, 3]);
    }

    #[test]
    fn data_payload_preserves_a_full_u64_id() {
        let big = 0xffff_ffff_ffff_fffe_u64;
        let d = decode_data_payload(&encode_data_payload(big, &[])).unwrap();
        assert_eq!(d.id, big);
    }

    #[test]
    fn data_payload_accepts_a_zero_byte_tail() {
        // End-of-stream without tearing the call down — legal, not malformed.
        let p = encode_data_payload(7, &[]);
        assert_eq!(p.len(), 8);
        let d = decode_data_payload(&p).unwrap();
        assert_eq!(d.id, 7);
        assert!(d.payload.is_empty());
    }

    #[test]
    fn data_payload_rejects_too_short_for_an_id() {
        assert!(matches!(
            decode_data_payload(&[0u8; 7]),
            Err(FrameError::DataTooShort(7))
        ));
    }

    #[test]
    fn data_decodes_through_the_streaming_decoder() {
        let mut dec = FrameDecoder::new();
        dec.push(&encode_frame(FrameType::Data, &encode_data_payload(9, &[0xff])).unwrap())
            .unwrap();
        let out = dec.drain();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].frame_type, FrameType::Data);
        assert_eq!(decode_data_payload(&out[0].payload).unwrap().id, 9);
    }

    #[test]
    fn data_tag_is_recognised_by_from_u8() {
        assert_eq!(FrameType::from_u8(0x07), Some(FrameType::Data));
        // 0x08 is still unassigned — guards against a silent tag collision if
        // someone adds a frame type without checking what is already taken.
        assert_eq!(FrameType::from_u8(0x08), None);
    }
}
