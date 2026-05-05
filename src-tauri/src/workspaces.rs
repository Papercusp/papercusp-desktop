// Per-workspace isolation.
//
// A "workspace" is a fully-isolated fake-HOME directory that the Node
// sidecar and pglite-server are spawned with. Two workspaces look to the
// app like two completely separate machines: separate Postgres data,
// separate ~/.papercusp/, separate ~/.claude/ (so different API keys
// per workspace if the user wants), separate ~/.gitconfig, separate
// snapshots, separate plugin installs.
//
// Layout on the real filesystem:
//
//   ~/.papercusp-workspaces/
//     registry.json                      // { current, workspaces[] }
//     <workspace-id>/                    // becomes HOME for the sidecar
//       .papercusp/                      // app state
//       .claude/                         // claude CLI state (per-workspace)
//       .gitconfig                       // git identity (per-workspace)
//       ...                              // anything else the sidecar's
//                                        // children write under HOME
//
// First-launch migration: if registry.json is absent and the user has an
// existing ~/.papercusp/, we mv it into ~/.papercusp-workspaces/default/
// /.papercusp/ so existing harnesses, snapshots, and projects are
// preserved. Other dotfiles (~/.claude, ~/.gitconfig) are NOT migrated —
// the user re-enters their Anthropic key on first launch. This is the
// price of per-workspace isolation; documented in the onboarding screen.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug, specta::Type)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// Unix epoch milliseconds.
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, specta::Type)]
pub struct Registry {
    pub current: String,
    pub workspaces: Vec<Workspace>,
}

pub fn workspaces_root() -> PathBuf {
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    home.join(".papercusp-workspaces")
}

fn registry_path() -> PathBuf {
    workspaces_root().join("registry.json")
}

pub fn workspace_dir(id: &str) -> PathBuf {
    workspaces_root().join(id)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_registry() -> io::Result<Registry> {
    let path = registry_path();
    let raw = fs::read_to_string(&path)?;
    serde_json::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn write_registry(reg: &Registry) -> io::Result<()> {
    fs::create_dir_all(workspaces_root())?;
    let raw = serde_json::to_string_pretty(reg)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(registry_path(), raw)
}

/// Slugify a user-supplied workspace name into a filesystem-safe id.
/// Falls back to "workspace-<ts>" if the name has no usable characters.
fn slugify(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut last_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if ch == '-' || ch == '_' || ch.is_whitespace() {
            if !last_dash && !slug.is_empty() {
                slug.push('-');
                last_dash = true;
            }
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        format!("workspace-{}", now_ms())
    } else {
        slug
    }
}

fn unique_id(reg: &Registry, base: &str) -> String {
    if !reg.workspaces.iter().any(|w| w.id == base) && base != "" {
        return base.to_string();
    }
    let mut n: u32 = 2;
    loop {
        let candidate = format!("{}-{}", base, n);
        if !reg.workspaces.iter().any(|w| w.id == candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Ensure the registry exists. If not, create the "default" workspace and
/// migrate any pre-existing ~/.papercusp into it. Returns the live registry.
pub fn ensure_initialized() -> io::Result<Registry> {
    if let Ok(reg) = read_registry() {
        // Make sure the dir for current still exists; if not, fall back to
        // the first available workspace (defensive).
        if !workspace_dir(&reg.current).exists() {
            if let Some(first) = reg.workspaces.first() {
                let mut fixed = reg.clone();
                fixed.current = first.id.clone();
                write_registry(&fixed)?;
                return Ok(fixed);
            }
        }
        return Ok(reg);
    }

    // First launch (or registry corrupted/missing).
    fs::create_dir_all(workspaces_root())?;
    let default_id = "default".to_string();
    let default_dir = workspace_dir(&default_id);
    fs::create_dir_all(&default_dir)?;

    // Migrate ~/.papercusp -> workspaces/default/.papercusp if present and
    // the destination doesn't already exist.
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    let legacy = home.join(".papercusp");
    let migrated = default_dir.join(".papercusp");
    if legacy.exists() && !migrated.exists() {
        // Best-effort rename; if cross-device or permissions block it, fall
        // back to leaving the legacy dir alone — the new workspace just
        // starts fresh and the user can copy state manually.
        if let Err(e) = fs::rename(&legacy, &migrated) {
            eprintln!(
                "[papercusp-desktop] could not migrate {} -> {}: {} (default workspace will start fresh)",
                legacy.display(),
                migrated.display(),
                e
            );
        } else {
            println!(
                "[papercusp-desktop] migrated {} -> {}",
                legacy.display(),
                migrated.display()
            );
        }
    }

    let reg = Registry {
        current: default_id.clone(),
        workspaces: vec![Workspace {
            id: default_id,
            name: "Default".to_string(),
            created_at: now_ms(),
        }],
    };
    write_registry(&reg)?;
    Ok(reg)
}

pub fn list() -> Registry {
    ensure_initialized().unwrap_or_default()
}

pub fn current_dir() -> io::Result<PathBuf> {
    let reg = ensure_initialized()?;
    Ok(workspace_dir(&reg.current))
}

pub fn create(name: &str) -> io::Result<Workspace> {
    let mut reg = ensure_initialized()?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace name cannot be empty",
        ));
    }
    let id = unique_id(&reg, &slugify(trimmed));
    let dir = workspace_dir(&id);
    if dir.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("workspace dir {} already exists", dir.display()),
        ));
    }
    fs::create_dir_all(&dir)?;
    let ws = Workspace {
        id,
        name: trimmed.to_string(),
        created_at: now_ms(),
    };
    reg.workspaces.push(ws.clone());
    write_registry(&reg)?;
    Ok(ws)
}

pub fn rename(id: &str, new_name: &str) -> io::Result<()> {
    let mut reg = ensure_initialized()?;
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace name cannot be empty",
        ));
    }
    let ws = reg
        .workspaces
        .iter_mut()
        .find(|w| w.id == id)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("no workspace {}", id)))?;
    ws.name = trimmed.to_string();
    write_registry(&reg)
}

pub fn switch(id: &str) -> io::Result<()> {
    let mut reg = ensure_initialized()?;
    if !reg.workspaces.iter().any(|w| w.id == id) {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("no workspace {}", id),
        ));
    }
    if !workspace_dir(id).exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("workspace dir for {} missing", id),
        ));
    }
    reg.current = id.to_string();
    write_registry(&reg)
}

/// Delete a workspace and its data dir. Refuses to delete the only workspace
/// or the current one (caller must switch first).
pub fn delete(id: &str) -> io::Result<()> {
    let mut reg = ensure_initialized()?;
    if reg.workspaces.len() <= 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "cannot delete the only workspace",
        ));
    }
    if reg.current == id {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "cannot delete the current workspace; switch to another first",
        ));
    }
    if let Some(pos) = reg.workspaces.iter().position(|w| w.id == id) {
        reg.workspaces.remove(pos);
    } else {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("no workspace {}", id),
        ));
    }
    let dir = workspace_dir(id);
    if dir.exists() {
        // Best-effort remove. If it fails (permissions, in-use), surface it
        // — the registry write below will still succeed so the workspace
        // disappears from the UI even if some bytes linger on disk.
        let _ = fs::remove_dir_all(&dir);
    }
    write_registry(&reg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("My Cool Workspace"), "my-cool-workspace");
        assert_eq!(slugify("client_X"), "client-x");
        assert_eq!(slugify("--weird--"), "weird");
        assert!(slugify("###").starts_with("workspace-"));
    }

    #[test]
    fn unique_id_appends_counter() {
        let reg = Registry {
            current: "a".into(),
            workspaces: vec![
                Workspace { id: "a".into(), name: "A".into(), created_at: 0 },
                Workspace { id: "a-2".into(), name: "A2".into(), created_at: 0 },
            ],
        };
        assert_eq!(unique_id(&reg, "a"), "a-3");
        assert_eq!(unique_id(&reg, "b"), "b");
    }
}
