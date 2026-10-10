//! Pre-copy transport checks. Pure std-only, independently CPU-testable.
pub const MAX_METADATA_CHARS: usize = 128 * 1024;
pub const MAX_BINARY_BYTES: usize = 10 * 4 * 1024 * 1024 + 256 * 1024;
pub const MAX_PLAN_SESSIONS: usize = 8;
pub const MAX_SESSION_BYTES: usize = 64 * 1024 * 1024;
pub fn session_id(value: f64) -> Result<u32, String> {
    if !value.is_finite() || value.fract() != 0.0 || !(1.0..=u32::MAX as f64).contains(&value) {
        return Err("LUT atlas owner ID must be a real positive u32".into());
    }
    Ok(value as u32)
}
pub fn lengths(metadata_chars: usize, binary_bytes: usize) -> Result<(), String> {
    if metadata_chars == 0
        || metadata_chars > MAX_METADATA_CHARS
        || binary_bytes == 0
        || binary_bytes > MAX_BINARY_BYTES
    {
        return Err("LUT atlas transport exceeds fixed admission limits".into());
    }
    Ok(())
}
pub fn range(offset: usize, length: usize, total: usize, expected: usize) -> Result<usize, String> {
    if offset != expected || length == 0 {
        return Err("LUT atlas binary layout must be nonempty/contiguous".into());
    }
    offset
        .checked_add(length)
        .filter(|end| *end <= total)
        .ok_or_else(|| "LUT atlas binary range overflows or exceeds input".into())
}
pub fn row_bytes(length: usize) -> Result<(), String> {
    if length != 1024 {
        Err("LUT atlas native row readback must be exactly 256x1 RGBA".into())
    } else {
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pre_copy_bounds() {
        assert!(lengths(0, 1).is_err());
        assert!(lengths(MAX_METADATA_CHARS + 1, 1).is_err());
        assert!(lengths(1, MAX_BINARY_BYTES + 1).is_err());
        assert!(lengths(MAX_METADATA_CHARS, MAX_BINARY_BYTES).is_ok());
    }
    #[test]
    fn checked_contiguous_binary_layout() {
        assert_eq!(range(0, 4, 7, 0).unwrap(), 4);
        assert_eq!(range(4, 3, 7, 4).unwrap(), 7);
        assert!(range(3, 4, 7, 4).is_err());
        assert!(range(4, 0, 7, 4).is_err());
        assert!(range(usize::MAX, 2, usize::MAX, usize::MAX).is_err());
    }
    #[test]
    fn exact_native_row_binary() {
        assert!(row_bytes(1024).is_ok());
        assert!(row_bytes(1023).is_err());
        assert!(row_bytes(1025).is_err());
    }
    #[test]
    fn owner_id_no_js_integer_coercion() {
        assert_eq!(session_id(1.0).unwrap(), 1);
        for value in [0.0, -1.0, 1.5, f64::NAN, f64::INFINITY, 4294967296.0] {
            assert!(session_id(value).is_err());
        }
    }
}
