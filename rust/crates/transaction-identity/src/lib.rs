use bridge::export;
use sha2::{Digest, Sha256};

const PREFIX: &str = "oc-txn:v1:sha256:";

/// Compact the exact tagged canonical-operation encoding, not plain JSON.
/// Existing compact or unknown fingerprints are opaque and never rehashed.
/// The caller preserves receipts and only persists this on a normal commit.
#[export]
pub fn normalize_operation_fingerprint(fingerprint: String) -> String {
    if !fingerprint.starts_with("[\"array\",") {
        return fingerprint;
    }
    let mut hash = Sha256::new();
    hash.update(PREFIX.as_bytes());
    hash.update([0]);
    hash.update(fingerprint.as_bytes());
    format!("{PREFIX}{:x}", hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_and_idempotent_for_large_unicode_operations() {
        let canonical = format!("[\"array\",[\"{}\"]]", "字幕🎬".repeat(300_000));
        let compact = normalize_operation_fingerprint(canonical.clone());
        assert_eq!(compact.len(), PREFIX.len() + 64);
        assert_eq!(normalize_operation_fingerprint(compact.clone()), compact);
        assert_ne!(normalize_operation_fingerprint(format!("{canonical} ")), compact);
    }

    #[test]
    fn unknown_formats_stay_opaque() {
        for value in ["", "oc-txn:v2:sha256:future", "oc-txn:v1:sha256:bad", "[]"] {
            assert_eq!(normalize_operation_fingerprint(value.to_owned()), value);
        }
    }
}
