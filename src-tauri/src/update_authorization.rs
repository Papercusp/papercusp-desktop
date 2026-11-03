//! Native consumer of tauri-release-kit's exact dual-signed update protocol.
//!
//! The caller supplies CURRENT protected trust and independently extracted candidate
//! bytes/identity. This module neither trusts manifest-supplied keys nor persists
//! activation floors. Keep that state transaction outside this pure verifier.

use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub schema: String,
    pub artifact_sha256: String,
    pub policy_sha256: String,
    pub configuration_sha256: String,
    pub source_revision: String,
    pub version: String,
    pub product: String,
    pub platform: String,
    pub author_id: String,
    pub approver_id: String,
    pub approver_epoch: u64,
    pub signer_id: String,
    pub signer_epoch: u64,
    pub root_epoch: u64,
    pub rollback_counter: u64,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
    pub approval_signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedKey {
    pub id: String,
    pub epoch: u64,
    pub principal_id: String,
    pub public_key: String,
    pub revoked: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trust {
    pub root_epoch: u64,
    pub min_rollback_counter: u64,
    pub min_issued_at: u64,
    pub max_metadata_age_ms: u64,
    pub signers: Vec<TrustedKey>,
    pub approvers: Vec<TrustedKey>,
}

pub struct Candidate<'a> {
    pub artifact: &'a [u8],
    pub policy: &'a [u8],
    pub configuration: &'a [u8],
    pub source_revision: &'a str,
    pub version: &'a str,
    pub product: &'a str,
    pub platform: &'a str,
    pub author_id: &'a str,
}

/// Only this module constructs an authorized result. It remains a snapshot, not
/// permission to install after the caller releases its protected-state transaction.
pub struct AuthorizedUpdate {
    metadata: Metadata,
}

impl AuthorizedUpdate {
    pub fn metadata(&self) -> &Metadata {
        &self.metadata
    }
}

fn label(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 200
        && !value.chars().any(|c| c.is_whitespace() || c == '\u{feff}' || c <= '\u{1f}' || c == '\u{7f}')
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn decode(value: &str) -> Result<Vec<u8>, String> {
    let compact: String = value.chars().filter(|c| !c.is_whitespace() && *c != '\u{feff}').collect();
    let bytes = STANDARD.decode(&compact).map_err(|_| "invalid base64")?;
    if compact.is_empty() || STANDARD.encode(&bytes) != compact {
        return Err("noncanonical base64".into());
    }
    Ok(bytes)
}

fn key(value: &str) -> Result<(PublicKey, Vec<u8>), String> {
    let wrapped = decode(value).ok().and_then(|b| String::from_utf8(b).ok());
    let text = wrapped.as_deref().filter(|s| s.to_ascii_lowercase().contains("minisign public key")).unwrap_or(value);
    let line = text.lines().map(str::trim).filter(|s| !s.is_empty()).last().ok_or("missing public key")?;
    let bytes = decode(line)?;
    let public_key = PublicKey::from_base64(&STANDARD.encode(&bytes)).map_err(|_| "invalid public key")?;
    Ok((public_key, bytes))
}

fn signature(value: &str) -> Result<Signature, String> {
    if value.is_empty() || value.len() > 4096 {
        return Err("invalid authorization signature size".into());
    }
    let text = String::from_utf8(decode(value)?).map_err(|_| "invalid signature text")?;
    if text.trim_end().lines().count() != 4 {
        return Err("complete minisign authorization signature required".into());
    }
    Signature::decode(text.trim_end()).map_err(|_| "invalid minisign authorization signature".into())
}

fn select<'a>(keys: &'a [TrustedKey], id: &str, epoch: u64) -> Result<&'a TrustedKey, String> {
    let mut matches = keys.iter().filter(|k| k.id == id && k.epoch == epoch);
    let selected = matches.next().ok_or("unknown signer or approver epoch")?;
    if matches.next().is_some() || selected.revoked || !label(&selected.principal_id) {
        return Err("revoked, ambiguous or invalid signer/approver".into());
    }
    Ok(selected)
}

pub fn verify(trust: &Trust, envelope: &Envelope, candidate: &Candidate<'_>, now: u64) -> Result<AuthorizedUpdate, String> {
    if envelope.payload.len() > 16_384 {
        return Err("update authorization payload is too large".into());
    }
    let m: Metadata = serde_json::from_str(&envelope.payload).map_err(|_| "invalid update authorization metadata")?;
    if m.schema != "tauri-update-authorization-v1"
        || ![&m.artifact_sha256, &m.policy_sha256, &m.configuration_sha256].iter().all(|s| hex(s, 64))
        || !hex(&m.source_revision, 40)
        || ![&m.version, &m.product, &m.platform, &m.author_id, &m.approver_id, &m.signer_id].iter().all(|s| label(s))
        || [m.approver_epoch, m.signer_epoch, m.root_epoch, m.rollback_counter, m.issued_at, m.expires_at].iter().any(|n| *n > MAX_SAFE_INTEGER)
        || m.expires_at <= m.issued_at
        || serde_json::to_string(&m).map_err(|_| "unencodable update metadata")? != envelope.payload
    {
        return Err("invalid or noncanonical update authorization metadata".into());
    }
    for (field, actual, expected) in [
        ("artifactSha256", format!("{:x}", Sha256::digest(candidate.artifact)), m.artifact_sha256.as_str()),
        ("policySha256", format!("{:x}", Sha256::digest(candidate.policy)), m.policy_sha256.as_str()),
        ("configurationSha256", format!("{:x}", Sha256::digest(candidate.configuration)), m.configuration_sha256.as_str()),
    ] {
        if actual != expected {
            return Err(format!("candidate {field} differs from reviewed update"));
        }
    }
    for (field, actual, expected) in [
        ("sourceRevision", candidate.source_revision, m.source_revision.as_str()),
        ("version", candidate.version, m.version.as_str()),
        ("product", candidate.product, m.product.as_str()),
        ("platform", candidate.platform, m.platform.as_str()),
        ("authorId", candidate.author_id, m.author_id.as_str()),
    ] {
        if actual != expected {
            return Err(format!("candidate {field} differs from reviewed update"));
        }
    }
    if [now, trust.root_epoch, trust.min_rollback_counter, trust.min_issued_at, trust.max_metadata_age_ms].iter().any(|n| *n > MAX_SAFE_INTEGER)
        || trust.max_metadata_age_ms == 0 || trust.signers.len() > 64 || trust.approvers.len() > 64
    {
        return Err("invalid protected update trust state".into());
    }
    if m.root_epoch != trust.root_epoch {
        return Err("update trust root epoch is not current".into());
    }
    if m.rollback_counter < trust.min_rollback_counter {
        return Err("update rollback counter is below the installed floor".into());
    }
    if m.issued_at < trust.min_issued_at || m.issued_at > now || m.expires_at <= now || now - m.issued_at > trust.max_metadata_age_ms {
        return Err("update metadata is stale, expired or from the future".into());
    }
    let signer = select(&trust.signers, &m.signer_id, m.signer_epoch)?;
    let approver = select(&trust.approvers, &m.approver_id, m.approver_epoch)?;
    let (signer_key, signer_bytes) = key(&signer.public_key)?;
    let (approver_key, approver_bytes) = key(&approver.public_key)?;
    if approver.principal_id == m.author_id || approver.principal_id == signer.principal_id || signer_bytes[10..] == approver_bytes[10..] {
        return Err("update approval is not independent of its author and release signer".into());
    }
    signer_key.verify(envelope.payload.as_bytes(), &signature(&envelope.signature)?, true).map_err(|_| "invalid update release signature")?;
    approver_key.verify(envelope.payload.as_bytes(), &signature(&envelope.approval_signature)?, true).map_err(|_| "invalid update approval signature")?;
    Ok(AuthorizedUpdate { metadata: m })
}
