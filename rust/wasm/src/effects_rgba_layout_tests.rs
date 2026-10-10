use super::{RgbaUploadLayout, encode_upload_channels};

#[test]
fn exact_unpadded_rgba_lengths_and_row_sizes() {
    for (width, height) in [(1, 1), (93, 62), (192, 128), (3840, 2160)] {
        let bytes = u64::from(width) * u64::from(height) * 4;
        let layout = RgbaUploadLayout::new(width, height, bytes).unwrap();
        assert_eq!(layout.row_bytes, width * 4);
        assert!(RgbaUploadLayout::new(width, height, bytes - 1).is_err());
        assert!(RgbaUploadLayout::new(width, height, bytes + 1).is_err());
    }
    // Padded readback storage cannot be submitted as tight RGBA input.
    assert!(RgbaUploadLayout::new(93, 62, 512 * 62).is_err());
}

#[test]
fn zero_dimensions_row_overflow_and_wrong_lengths_fail_before_copy() {
    for (width, height, bytes) in [
        (0, 1, 0),
        (1, 0, 0),
        (0, 0, 0),
        (u32::MAX, 1, u64::MAX),
        (u32::MAX / 4 + 1, 1, 0),
        (1, 1, u64::MAX),
    ] {
        assert!(RgbaUploadLayout::new(width, height, bytes).is_err());
    }
    // The multiplication is widened; no 32-bit byte-count wrap is accepted.
    let width = u32::MAX / 4;
    let expected = u64::from(width) * 4 * u64::from(u32::MAX);
    assert!(RgbaUploadLayout::new(width, u32::MAX, expected).is_ok());
    assert!(RgbaUploadLayout::new(width, u32::MAX, expected & u64::from(u32::MAX)).is_err());
}

#[test]
fn bgra_upload_is_only_channel_transport_preserving_alpha_and_poison_rgb() {
    let original = [134, 1, 32, 96, 50, 150, 250, 0, 255, 2, 17, 255];
    let mut rgba = original;
    encode_upload_channels(&mut rgba, false);
    assert_eq!(rgba, original);
    let mut bgra = original;
    encode_upload_channels(&mut bgra, true);
    assert_eq!(bgra, [32, 1, 134, 96, 250, 150, 50, 0, 17, 2, 255, 255]);
    encode_upload_channels(&mut bgra, true);
    assert_eq!(bgra, original);
}
