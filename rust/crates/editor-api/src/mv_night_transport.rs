//! Platform-neutral pre-copy bounds; no resource or scene policy lives in JS.
pub const MAX_METADATA_CHARS: usize = 256 * 1024;
pub const MAX_ENCODED_BYTES: usize = 128 * 1024 * 1024;
pub const REFLECTION_BYTES: usize = 418 * 235 * 4;
pub const MAX_SESSIONS: usize = 4;
pub const MAX_OWNER_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_GLOBAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const FRAME_RESERVATION: u64 = 1280 * 1024 * 1024;
pub const MAX_FRAME_JSON_BYTES: usize = 16 * 1024 * 1024;
pub fn lengths(metadata: usize, binary: usize) -> Result<(), String> {
    if metadata == 0 || metadata > MAX_METADATA_CHARS || binary == 0 || binary > MAX_ENCODED_BYTES {
        return Err("Night metadata/binary pre-copy bound exceeded".into());
    }
    Ok(())
}
pub fn reflection(length: usize) -> Result<(), String> {
    if length != REFLECTION_BYTES {
        return Err("Night requires exact native 418x235 RGBA readback".into());
    }
    Ok(())
}
pub fn session_id(value: f64) -> Result<u32, String> {
    if !value.is_finite() || value.fract() != 0.0 || value < 1.0 || value > u32::MAX as f64 {
        return Err("Night owner ID must be positive exact u32".into());
    }
    Ok(value as u32)
}
pub fn range(offset: usize, length: usize, total: usize, previous: usize) -> Result<usize, String> {
    let end = offset
        .checked_add(length)
        .ok_or("Night binary range overflow")?;
    if length == 0 || offset != previous || end > total {
        return Err("Night binary layout gap/overlap/out-of-bounds".into());
    }
    Ok(end)
}
pub fn sum(a: u64, b: u64, limit: u64) -> Result<u64, String> {
    a.checked_add(b)
        .filter(|v| *v <= limit)
        .ok_or_else(|| "Night reservation exhausted".into())
}
pub fn font_reservation(instance_bytes: u64, count: usize) -> Result<u64, String> {
    if count == 0 || count > 6 || instance_bytes == 0 || instance_bytes > 96 * 1024 * 1024 {
        return Err("Night logical font instance pre-copy budget exceeded".into());
    }
    instance_bytes
        .checked_mul(3)
        .and_then(|v| v.checked_add(count as u64 * 64 * 1024))
        .ok_or_else(|| "Night per-instance font reservation overflow".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_before_copy() {
        assert!(lengths(0, 1).is_err());
        assert!(lengths(MAX_METADATA_CHARS + 1, 1).is_err());
        assert!(lengths(1, MAX_ENCODED_BYTES + 1).is_err());
        assert!(reflection(REFLECTION_BYTES - 1).is_err());
        assert!(reflection(REFLECTION_BYTES + 1).is_err());
        assert!(reflection(REFLECTION_BYTES).is_ok());
    }
    #[test]
    fn no_js_owner_coercion() {
        for value in [f64::NAN, f64::INFINITY, -1.0, 0.0, 1.2, 4294967296.0] {
            assert!(session_id(value).is_err());
        }
        assert_eq!(session_id(u32::MAX as f64).unwrap(), u32::MAX);
    }
    #[test]
    fn ranges_and_residency_fail_closed() {
        assert_eq!(range(0, 4, 8, 0).unwrap(), 4);
        assert!(range(5, 3, 8, 4).is_err());
        assert!(range(3, 3, 8, 4).is_err());
        assert!(range(usize::MAX, 1, usize::MAX, usize::MAX).is_err());
        assert!(sum(u64::MAX, 1, u64::MAX).is_err());
        assert!(sum(MAX_OWNER_BYTES, 1, MAX_OWNER_BYTES).is_err());
    }
    #[test]
    fn distinct_instances_are_charged_even_when_bytes_are_shared() {
        let one = 13_574_352;
        assert!(font_reservation(one * 3, 3).unwrap() > font_reservation(one, 1).unwrap());
        assert_eq!(
            font_reservation(one * 3, 3).unwrap(),
            one * 9 + 3 * 64 * 1024
        );
        assert!(font_reservation(96 * 1024 * 1024 + 1, 6).is_err());
        assert!(font_reservation(one, 7).is_err());
        assert!(font_reservation(one, 0).is_err());
    }
}
