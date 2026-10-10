//! Bounded binary packet transport, separate from authored source JSON.
use crate::programmatic_resources::Resource;
use serde::Deserialize;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
pub(crate) const MAX_FONT_BYTES: usize = 64 * 1024 * 1024;
const MAX_LAYOUT_BYTES: usize = 32768;
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;

pub fn tunnel_frame_transport_error_json(error: String) -> String {
    serde_json::json!({"error": error}).to_string()
}

/// The WASM transport calls this before copying a borrowed JS typed array.
/// Length admission does not authenticate fonts or grant a measured-font token.
pub fn validate_tunnel_frame_transport_lengths(
    input_bytes: usize,
    layout_bytes: usize,
    font_bytes: usize,
) -> Result<(), String> {
    if input_bytes > MAX_REQUEST_BYTES {
        return Err("Tunnel native request JSON exceeds 16MiB".into());
    }
    if font_bytes > MAX_FONT_BYTES || layout_bytes > MAX_LAYOUT_BYTES {
        return Err("Tunnel font packet exceeds native budget".into());
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Limits {
    max_bytes: usize,
    max_resources: usize,
    max_layout_bytes: usize,
}
pub(crate) fn limits() -> Limits {
    Limits {
        max_bytes: MAX_FONT_BYTES,
        max_resources: 64,
        max_layout_bytes: MAX_LAYOUT_BYTES,
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Range {
    id: String,
    offset: usize,
    length: usize,
}
pub(crate) fn packet<'a>(
    layout: &str,
    bytes: &'a [u8],
    requested: &[Resource],
) -> Result<BTreeMap<String, &'a [u8]>, String> {
    if bytes.len() > MAX_FONT_BYTES || layout.len() > MAX_LAYOUT_BYTES {
        return Err("Tunnel font packet exceeds native budget".into());
    }
    let ranges: Vec<Range> = serde_json::from_str(layout).map_err(|e| e.to_string())?;
    if ranges.len() != requested.len() || ranges.len() > 64 {
        return Err("Tunnel font packet requires exact requested IDs".into());
    }
    let expected: BTreeMap<_, _> = requested.iter().map(|r| (r.id.as_str(), r)).collect();
    if expected.len() != requested.len() {
        return Err("Tunnel duplicate requested font ID".into());
    }
    let mut seen = BTreeSet::new();
    let mut spans = Vec::new();
    let mut result = BTreeMap::new();
    for range in ranges {
        let resource = expected
            .get(range.id.as_str())
            .ok_or("Tunnel extra font packet ID")?;
        let end = range
            .offset
            .checked_add(range.length)
            .ok_or("Tunnel font packet offset overflow")?;
        if !seen.insert(range.id.clone())
            || resource.kind != "font"
            || range.length == 0
            || range.length as u64 != resource.byte_length()
            || end > bytes.len()
        {
            return Err("Tunnel font packet duplicate ID, length or bounds mismatch".into());
        }
        spans.push((range.offset, end));
        result.insert(range.id, &bytes[range.offset..end]);
    }
    // Sorting physical byte ranges does not reorder any declared font stack.
    spans.sort_unstable();
    let mut cursor = 0;
    for (start, end) in spans {
        if start != cursor {
            return Err("Tunnel font packet overlaps or contains unowned bytes".into());
        }
        cursor = end;
    }
    if cursor != bytes.len() {
        return Err("Tunnel font packet has trailing unowned bytes".into());
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_rejects_over_limit_before_binary_copy_without_granting_font_admission() {
        assert!(
            validate_tunnel_frame_transport_lengths(
                MAX_REQUEST_BYTES,
                MAX_LAYOUT_BYTES,
                MAX_FONT_BYTES
            )
            .is_ok()
        );
        for lengths in [
            (MAX_REQUEST_BYTES + 1, 0, 0),
            (0, MAX_LAYOUT_BYTES + 1, 0),
            (0, 0, MAX_FONT_BYTES + 1),
            (0, 0, usize::MAX),
        ] {
            assert!(
                validate_tunnel_frame_transport_lengths(lengths.0, lengths.1, lengths.2).is_err()
            );
        }
        assert!(packet("[]", &[1], &[]).is_err());
    }
    fn resource(id: &str) -> Resource {
        serde_json::from_value(serde_json::json!({"id":id,"kind":"font","attachmentKey":"test","mimeType":"font/ttf","byteLength":2,"sha256":"00".repeat(32),"font":{"family":"test","style":"normal","weight":400}})).unwrap()
    }
    #[test]
    fn exact_packet_rejects_overlap_bounds_missing_extra_duplicate_and_trailing() {
        let resources = [resource("a"), resource("b")];
        let bytes = [1, 2, 3, 4];
        assert!(
            packet(
                r#"[{"id":"a","offset":0,"length":2},{"id":"b","offset":2,"length":2}]"#,
                &bytes,
                &resources
            )
            .is_ok()
        );
        for layout in [
            r#"[{"id":"a","offset":0,"length":2},{"id":"b","offset":1,"length":2}]"#,
            r#"[{"id":"a","offset":0,"length":2},{"id":"b","offset":4,"length":2}]"#,
            r#"[{"id":"a","offset":0,"length":2}]"#,
            r#"[{"id":"a","offset":0,"length":2},{"id":"extra","offset":2,"length":2}]"#,
            r#"[{"id":"a","offset":0,"length":2},{"id":"a","offset":2,"length":2}]"#,
        ] {
            assert!(packet(layout, &bytes, &resources).is_err());
        }
        assert!(
            packet(
                r#"[{"id":"a","offset":0,"length":2},{"id":"b","offset":2,"length":2}]"#,
                &[1, 2, 3, 4, 5],
                &resources
            )
            .is_err()
        );
    }
}
