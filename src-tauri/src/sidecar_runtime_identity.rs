//! Identity of the entire hot runtime, not just serve.mjs. Hash native NTFS
//! directly; enumerating it through WSL/DrvFs reinstates the staging bottleneck.
//! This is a cache key, NOT a substitute for release artifact acceptance.

use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read};
use std::path::Path;

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn frame(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(bytes);
}

pub fn generation(root: &Path) -> io::Result<String> {
    let mut hash = Sha256::new();
    frame(&mut hash, b"papercusp-hot-runtime-v1");
    let mut buffer = vec![0u8; 1024 * 1024];
    walk(root, "", &mut hash, &mut buffer)?;
    Ok(format!("{:x}", hash.finalize()))
}

fn walk(root: &Path, relative: &str, hash: &mut Sha256, buffer: &mut [u8]) -> io::Result<()> {
    let mut names = fs::read_dir(root.join(relative))?
        .map(|entry| {
            entry?
                .file_name()
                .into_string()
                .map_err(|_| invalid("Non-Unicode runtime filename"))
        })
        .collect::<io::Result<Vec<_>>>()?;
    names.sort();
    for name in names {
        // Exactly the cold inputs excluded by the production tar invocation.
        // The completion marker is generated AFTER extraction, not payload.
        if relative.is_empty()
            && matches!(
                name.as_str(),
                "source.tar.zst"
                    | "db-seed.dump"
                    | "db-seed.tar.gz"
                    | ".papercusp-runtime-complete"
            )
        {
            continue;
        }
        let rel = if relative.is_empty() {
            name
        } else {
            format!("{relative}/{name}")
        };
        let file = root.join(&rel);
        let metadata = fs::symlink_metadata(&file)?;
        frame(hash, rel.as_bytes());
        if metadata.is_symlink() {
            frame(hash, b"link");
            let target = fs::read_link(&file)?;
            let target = target
                .to_str()
                .ok_or_else(|| invalid("Non-Unicode runtime symlink"))?;
            #[cfg(windows)]
            let target = target.replace('\\', "/");
            frame(hash, target.as_bytes());
        } else if metadata.is_dir() {
            frame(hash, b"directory");
            walk(root, &rel, hash, buffer)?;
        } else if metadata.is_file() {
            frame(hash, b"file");
            hash.update(metadata.len().to_le_bytes());
            let mut input = fs::File::open(&file)?;
            let before = input.metadata()?;
            if before.len() != metadata.len() || before.modified()? != metadata.modified()? {
                return Err(invalid(format!(
                    "Runtime file changed before hashing: {rel}"
                )));
            }
            let mut bytes = 0u64;
            let mut magic = Vec::with_capacity(4);
            loop {
                let n = input.read(buffer)?;
                if n == 0 {
                    break;
                }
                let remaining = 4 - magic.len();
                magic.extend_from_slice(&buffer[..n.min(remaining)]);
                hash.update(&buffer[..n]);
                bytes += n as u64;
            }
            let after = input.metadata()?;
            let path_after = fs::symlink_metadata(&file)?;
            if bytes != before.len()
                || after.len() != before.len()
                || after.modified()? != before.modified()?
                || !path_after.is_file()
                || path_after.len() != before.len()
                || path_after.modified()? != before.modified()?
            {
                return Err(invalid(format!(
                    "Runtime file changed while hashing: {rel}"
                )));
            }
            // EXTRACT_SCRIPT derives owner execute from these same magic bytes.
            // NTFS's synthesized Unix mode is deliberately not an identity input.
            hash.update([u8::from(magic.starts_with(b"#!") || magic == b"\x7fELF")]);
        } else {
            return Err(invalid(format!("Unsupported runtime entry: {rel}")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "pc-runtime-identity-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            fs::create_dir(&p).unwrap();
            fs::write(p.join("serve.mjs"), "same serve bytes").unwrap();
            fs::write(p.join(".sidecar-build-stamp"), "same stamp bytes").unwrap();
            Self(p)
        }
        fn key(&self) -> String {
            generation(&self.0).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn non_serve_content_and_removals_change_the_cache_key() {
        let f = Fixture::new();
        let clean = f.key();
        assert_eq!(clean.len(), 64);
        fs::write(f.0.join("old-spa.js"), "old").unwrap();
        let dirty = f.key();
        assert_ne!(clean, dirty);
        fs::write(f.0.join("old-spa.js"), "new").unwrap();
        assert_ne!(dirty, f.key());
        fs::remove_file(f.0.join("old-spa.js")).unwrap();
        assert_eq!(clean, f.key());
        fs::create_dir(f.0.join("empty-directory")).unwrap();
        assert_ne!(clean, f.key());
    }

    #[test]
    fn framing_distinguishes_name_content_boundaries() {
        let f = Fixture::new();
        fs::write(f.0.join("ab"), "c").unwrap();
        let a = f.key();
        fs::remove_file(f.0.join("ab")).unwrap();
        fs::write(f.0.join("a"), "bc").unwrap();
        assert_ne!(a, f.key());
    }

    #[test]
    fn excludes_only_root_cold_inputs_and_generated_completion_marker() {
        let f = Fixture::new();
        let a = f.key();
        for name in [
            "source.tar.zst",
            "db-seed.dump",
            "db-seed.tar.gz",
            ".papercusp-runtime-complete",
        ] {
            fs::write(f.0.join(name), "not hot payload").unwrap();
        }
        assert_eq!(a, f.key());
        fs::create_dir(f.0.join("nested")).unwrap();
        let b = f.key();
        fs::write(f.0.join("nested/source.tar.zst"), "hot nested file").unwrap();
        assert_ne!(b, f.key());
    }

    #[test]
    #[cfg(unix)]
    fn hashes_link_target_not_external_data() {
        let f = Fixture::new();
        std::os::unix::fs::symlink("missing-a", f.0.join("link")).unwrap();
        let a = f.key();
        fs::remove_file(f.0.join("link")).unwrap();
        std::os::unix::fs::symlink("missing-b", f.0.join("link")).unwrap();
        assert_ne!(a, f.key());
    }
}
