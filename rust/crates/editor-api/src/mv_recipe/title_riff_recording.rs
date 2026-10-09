//! Compatibility with the tested Chromium Canvas2D reference recording policy.
//!
//! Its default 32 MiB image-pin limit is NOT a resource/admission budget or a
//! cross-browser guarantee. A record flush rebuilds every saved paint matrix
//! from the original (double) state. The native renderer splits the original
//! main canvas into surfaces, so its own allocations/releases cannot reproduce
//! that boundary. Track only the original main canvas's source versions here.
//! Alpha-zero image draws still pin; repeated unchanged sources pin only once.
use std::collections::HashMap;

use super::plan::Operation;

pub(super) const REFERENCE_PIN_LIMIT_BYTES: u64 = 32 * 1024 * 1024;
pub(super) const DESIGN_SIZE: [u32; 2] = [1920, 1080];

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum Source {
    Surface(&'static str),
    Resource(String),
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct Version {
    source: Source,
    generation: u64,
}

#[derive(Clone)]
struct Scope {
    // Never put CopyTransform in this list: after another flush the reference
    // recomputes from unrounded JS state, not a previously copied paint matrix.
    original: Vec<Operation>,
    copied_prefix: Option<usize>,
}

pub(super) struct Recording {
    pinned: HashMap<Version, u64>,
    bytes: u64,
    scopes: Vec<Scope>,
}

impl Recording {
    pub fn new() -> Self {
        Self {
            pinned: HashMap::new(),
            bytes: 0,
            scopes: vec![Scope {
                original: Vec::new(),
                copied_prefix: None,
            }],
        }
    }

    fn pin(&mut self, version: Version, size: [u32; 2]) -> Result<(), String> {
        let bytes = u64::from(size[0])
            .checked_mul(u64::from(size[1]))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or("titleRiff reference image byte count overflow")?;
        if let Some(previous) = self.pinned.get(&version) {
            if *previous != bytes {
                return Err("titleRiff reference image version changed backing size".into());
            }
            return Ok(());
        }
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .ok_or("titleRiff reference pinned byte count overflow")?;
        self.pinned.insert(version, bytes);
        Ok(())
    }

    /// Call after the corresponding original drawImage, including opacity zero.
    pub fn surface(
        &mut self,
        id: &'static str,
        generation: u64,
        size: [u32; 2],
    ) -> Result<(), String> {
        self.pin(
            Version {
                source: Source::Surface(id),
                generation,
            },
            size,
        )
    }

    pub fn resource(&mut self, id: &str, size: [u32; 2]) -> Result<(), String> {
        self.pin(
            Version {
                source: Source::Resource(id.into()),
                generation: 0,
            },
            size,
        )
    }

    /// A real reference GetOrCreatePaintCanvas boundary (draw, save or restore).
    /// restore checks BEFORE popping, so all saved ancestors are reconstructed.
    pub fn access(&mut self) {
        if self.bytes <= REFERENCE_PIN_LIMIT_BYTES {
            return;
        }
        self.pinned.clear();
        self.bytes = 0;
        for scope in &mut self.scopes {
            scope.copied_prefix = Some(scope.original.len());
        }
    }

    pub fn save(&mut self, local: &[Operation]) {
        self.access();
        let mut scope = self.scopes.last().expect("root recording scope").clone();
        scope.original.extend_from_slice(local);
        self.scopes.push(scope);
    }

    /// monument saves the camera then sets an absolute identity transform.
    pub fn save_identity(&mut self) {
        self.access();
        self.scopes.push(Scope {
            original: Vec::new(),
            copied_prefix: None,
        });
    }

    pub fn transform(&mut self, operation: Operation) {
        self.access();
        self.scopes
            .last_mut()
            .expect("root recording scope")
            .original
            .push(operation);
    }

    pub fn restore(&mut self) {
        self.access();
        assert!(
            self.scopes.len() > 1,
            "unbalanced titleRiff recording restore"
        );
        self.scopes.pop();
    }

    pub fn operations(&self) -> Vec<Operation> {
        let scope = self.scopes.last().expect("root recording scope");
        let mut operations = scope.original.clone();
        if let Some(prefix) = scope.copied_prefix.filter(|prefix| *prefix > 0) {
            // Only the nearest reconstructed ancestor is copied. Keeping an
            // earlier copy as well would round the original JS state twice.
            operations.insert(prefix, Operation::CopyTransform);
        }
        operations
    }
}

#[cfg(test)]
#[path = "title_riff_recording_tests.rs"]
mod tests;
