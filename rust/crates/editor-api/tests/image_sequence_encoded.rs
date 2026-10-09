use editor_api::validate_image_sequence_image_bytes;
use serde_json::{Value, json};

// Real 2x2 solid-red static outputs from installed FFmpeg 6.0 (png, mjpeg,
// libwebp lossy, libwebp lossless). Native tests require no codec/browser process.
const PNG: &str = "89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a7300000009704859730000000100000001004f25c4d60000001049444154789c63f8cbc000440c100a001fae03f5f6182a590000000049454e44ae426082";
// 224 bytes, SHA-256 bca1f76b2441cd9454bd198886bc8efb554ed4284cf56af20cf1e02732b68227.
const JPEG: &str = concat!(
    "ffd8ffe000104a46494600010200000100010000fffe000f4c61766336302e33",
    "2e31303000ffdb00430008040404040405050505050506060606060606060606",
    "06060607070708080807070706060707080808080909090808080809090a0a0a",
    "0c0c0b0b0e0e0e111114ffc4004c000101000000000000000000000000000000",
    "0601010100000000000000000000000000000607100100000000000000000000",
    "000000000000110100000000000000000000000000000000ffc0001108000200",
    "0203012200021100031100ffda000c03010002110311003f008b00517f7fffd9",
);
const WEBP: &str = "524946463c000000574542505650382030000000d001009d012a0200020002003425a00274ba01f80003b000fef0e8f7ff20b96175c8d7ff203fe407fc80fff8f2000000";
const WEBPL: &str = "524946461c000000574542505650384c0f0000002f014000000710f58ffe0722a2ff0100";

fn hex(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|s| u8::from_str_radix(std::str::from_utf8(s).unwrap(), 16).unwrap())
        .collect()
}
fn envelope(body: &[u8], mime: &str, width: u32, height: u32) -> Vec<u8> {
    let header = json!({"mimeType":mime,"width":width,"height":height}).to_string();
    let mut bytes = (header.len() as u32).to_le_bytes().to_vec();
    bytes.extend(header.as_bytes());
    bytes.extend(body);
    bytes
}
fn check(body: &[u8], mime: &str, width: u32, height: u32) -> Value {
    serde_json::from_str(&validate_image_sequence_image_bytes(envelope(
        body, mime, width, height,
    )))
    .unwrap()
}
fn rejected(body: &[u8], mime: &str, width: u32, height: u32) {
    let response = check(body, mime, width, height);
    assert!(
        response["error"].is_string(),
        "Unexpected admission: {response}"
    );
}
fn crc(bytes: &[u8]) -> u32 {
    let mut value = u32::MAX;
    for byte in bytes {
        value ^= u32::from(*byte);
        for _ in 0..8 {
            value = (value >> 1) ^ (0xedb88320u32.wrapping_mul(value & 1));
        }
    }
    !value
}
fn png_chunk(name: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut result = (body.len() as u32).to_be_bytes().to_vec();
    result.extend(name);
    result.extend(body);
    let checksum = crc(&result[4..]);
    result.extend(checksum.to_be_bytes());
    result
}
fn png_geometry(width: u32, height: u32) -> Vec<u8> {
    let original = hex(PNG);
    let mut header = original[16..29].to_vec();
    header[..4].copy_from_slice(&width.to_be_bytes());
    header[4..8].copy_from_slice(&height.to_be_bytes());
    let mut result = original[..8].to_vec();
    result.extend(png_chunk(b"IHDR", &header));
    result.extend(&original[33..]);
    result
}
fn riff(chunks: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
    let mut result = b"RIFF\0\0\0\0WEBP".to_vec();
    for (name, bytes) in chunks {
        result.extend(*name);
        result.extend((bytes.len() as u32).to_le_bytes());
        result.extend(bytes);
        if bytes.len() % 2 != 0 {
            result.push(0);
        }
    }
    let len = result.len() as u32 - 8;
    result[4..8].copy_from_slice(&len.to_le_bytes());
    result
}
fn vp8x(width: u32, height: u32, flags: u8) -> Vec<u8> {
    let mut bytes = vec![flags, 0, 0, 0];
    bytes.extend(&(width - 1).to_le_bytes()[..3]);
    bytes.extend(&(height - 1).to_le_bytes()[..3]);
    bytes
}
fn jpeg_segment(kind: u8, data: &[u8]) -> Vec<u8> {
    let mut result = vec![0xff, kind];
    result.extend((data.len() as u16 + 2).to_be_bytes());
    result.extend(data);
    result
}
fn jpeg_sof(kind: u8, width: u16, height: u16) -> Vec<u8> {
    let mut data = vec![8];
    data.extend(height.to_be_bytes());
    data.extend(width.to_be_bytes());
    data.extend([1, 1, 0x11, 0]);
    jpeg_segment(kind, &data)
}
fn jpeg_scan(progressive: bool) -> Vec<u8> {
    jpeg_segment(0xda, &[1, 1, 0, 0, if progressive { 0 } else { 63 }, 0])
}
fn jpeg_geometry(width: u16, height: u16) -> Vec<u8> {
    let mut result = vec![0xff, 0xd8];
    result.extend(jpeg_sof(0xc0, width, height));
    result.extend(jpeg_scan(false));
    result.extend([0x11, 0xff, 0, 0x22, 0xff, 0xd0, 0x33, 0xff, 0xd9]);
    result
}

#[test]
fn real_static_png_jpeg_vp8_and_vp8l_are_admitted_with_bound_dimensions() {
    assert_eq!(hex(JPEG).len(), 224);
    for (encoded, mime) in [
        (PNG, "image/png"),
        (JPEG, "image/jpeg"),
        (WEBP, "image/webp"),
        (WEBPL, "image/webp"),
    ] {
        assert_eq!(
            check(&hex(encoded), mime, 2, 2),
            json!({"width":2,"height":2,"decodedBytes":16})
        );
        rejected(&hex(encoded), mime, 2, 1);
        rejected(&hex(encoded), mime, 0, 2);
    }
    let vp8 = hex(WEBP)[20..].to_vec();
    let extended = riff(&[(b"VP8X", vp8x(2, 2, 0)), (b"VP8 ", vp8)]);
    assert_eq!(
        check(&extended, "image/webp", 2, 2),
        json!({"width":2,"height":2,"decodedBytes":16})
    );
}

#[test]
fn huge_encoded_geometry_cannot_hide_behind_a_small_manifest_or_resize() {
    rejected(&png_geometry(8192, 8192), "image/png", 2, 1);
    rejected(&png_geometry(8192, 8192), "image/png", 8192, 8192);
    rejected(&png_geometry(u32::MAX, u32::MAX), "image/png", 2, 1);
    rejected(&jpeg_geometry(8192, 8192), "image/jpeg", 2, 1);
    let mut large = hex(WEBP)[20..].to_vec();
    large[6..8].copy_from_slice(&8192u16.to_le_bytes());
    large[8..10].copy_from_slice(&8192u16.to_le_bytes());
    rejected(&riff(&[(b"VP8 ", large)]), "image/webp", 2, 1);
    let mut lossless = hex(WEBPL)[20..35].to_vec();
    let bits = 8191u32 | (8191u32 << 14);
    lossless[1..5].copy_from_slice(&bits.to_le_bytes());
    rejected(&riff(&[(b"VP8L", lossless)]), "image/webp", 2, 1);
    // No decoded raster is ever allocated: this <100-byte header claims 128MiB.
    let boundary = check(&png_geometry(8192, 4096), "image/png", 8192, 4096);
    assert_eq!(boundary["decodedBytes"], 134217728);
}

#[test]
fn png_requires_valid_ihdr_crc_complete_chunks_and_static_single_image() {
    let original = hex(PNG);
    for end in [0, 7, 8, 12, 20, 32, original.len() - 1] {
        rejected(&original[..end], "image/png", 2, 2);
    }
    let mut bad = original.clone();
    bad[16] ^= 1;
    rejected(&bad, "image/png", 2, 2);
    let mut bad = original.clone();
    bad[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
    rejected(&bad, "image/png", 2, 2);
    let mut duplicate = original[..33].to_vec();
    duplicate.extend(&original[8..]);
    rejected(&duplicate, "image/png", 2, 2);
    for kind in [b"acTL", b"fcTL", b"fdAT"] {
        let mut animation = original[..33].to_vec();
        animation.extend(png_chunk(kind, &[0; 8]));
        animation.extend(&original[33..]);
        rejected(&animation, "image/png", 2, 2);
    }
    let mut trailing = original.clone();
    trailing.push(0);
    rejected(&trailing, "image/png", 2, 2);
    let mut no_data = original[..33].to_vec();
    no_data.extend(png_chunk(b"IEND", &[]));
    rejected(&no_data, "image/png", 2, 2);
    let mut order = original[..8].to_vec();
    order.extend(png_chunk(b"tEXt", b"x"));
    order.extend(&original[8..]);
    rejected(&order, "image/png", 2, 2);
}

#[test]
fn jpeg_handles_progressive_multiscans_stuffing_restarts_and_marker_fills_without_decoding() {
    assert_eq!(
        check(&jpeg_geometry(2, 2), "image/jpeg", 2, 2)["decodedBytes"],
        16
    );
    let mut multi = vec![0xff, 0xd8];
    multi.extend(jpeg_sof(0xc2, 2, 2));
    multi.extend(jpeg_scan(true));
    multi.extend([0x11, 0xff, 0, 0x22, 0xff, 0xd0, 0x33]);
    multi.extend(jpeg_segment(0xc4, &[0]));
    multi.push(0xff); // legal marker fill before next SOS.
    multi.extend(jpeg_segment(0xda, &[1, 1, 0, 1, 63, 0]));
    multi.extend([0x11, 0xff, 0, 0x22, 0xff, 0xd9]);
    assert_eq!(
        check(&multi, "image/jpeg", 2, 2),
        json!({"width":2,"height":2,"decodedBytes":16})
    );
    for end in [0, 1, 2, multi.len() - 1] {
        rejected(&multi[..end], "image/jpeg", 2, 2);
    }
    let mut no_sof = vec![0xff, 0xd8];
    no_sof.extend(jpeg_scan(false));
    no_sof.extend([0x11, 0xff, 0xd9]);
    rejected(&no_sof, "image/jpeg", 2, 2);
    let mut duplicate = vec![0xff, 0xd8];
    duplicate.extend(jpeg_sof(0xc0, 2, 2));
    duplicate.extend(jpeg_sof(0xc0, 8, 8));
    duplicate.extend(jpeg_scan(false));
    duplicate.extend([0x11, 0xff, 0xd9]);
    rejected(&duplicate, "image/jpeg", 2, 2);
    for marker in [0xc3, 0xc5, 0xc9, 0xcc, 0xdc, 0xde, 0xdf] {
        let mut unsupported = vec![0xff, 0xd8];
        unsupported.extend(jpeg_segment(marker, &[0]));
        unsupported.extend(&hex(JPEG)[2..]);
        rejected(&unsupported, "image/jpeg", 2, 2);
    }
    let mut truncated = hex(JPEG);
    truncated[4..6].copy_from_slice(&u16::MAX.to_be_bytes());
    rejected(&truncated, "image/jpeg", 2, 2);
    let mut invalid = hex(JPEG);
    invalid[4..6].copy_from_slice(&1u16.to_be_bytes());
    rejected(&invalid, "image/jpeg", 2, 2);
}

#[test]
fn webp_requires_exact_riff_sizes_one_matching_bitstream_and_no_animation() {
    let original = hex(WEBP);
    let bitstream = original[20..].to_vec();
    for end in [0, 4, 11, 12, 20, original.len() - 1] {
        rejected(&original[..end], "image/webp", 2, 2);
    }
    let mut size = original.clone();
    size[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
    rejected(&size, "image/webp", 2, 2);
    let mut size = original.clone();
    size[16..20].copy_from_slice(&u32::MAX.to_le_bytes());
    rejected(&size, "image/webp", 2, 2);
    rejected(
        &riff(&[(b"VP8X", vp8x(1, 1, 0)), (b"VP8 ", bitstream.clone())]),
        "image/webp",
        1,
        1,
    );
    rejected(
        &riff(&[(b"VP8X", vp8x(2, 2, 2)), (b"VP8 ", bitstream.clone())]),
        "image/webp",
        2,
        2,
    );
    rejected(
        &riff(&[
            (b"VP8X", vp8x(2, 2, 0)),
            (b"VP8X", vp8x(2, 2, 0)),
            (b"VP8 ", bitstream.clone()),
        ]),
        "image/webp",
        2,
        2,
    );
    rejected(
        &riff(&[(b"VP8 ", bitstream.clone()), (b"VP8 ", bitstream.clone())]),
        "image/webp",
        2,
        2,
    );
    for kind in [b"ANIM", b"ANMF"] {
        rejected(
            &riff(&[(kind, vec![0; 16]), (b"VP8 ", bitstream.clone())]),
            "image/webp",
            2,
            2,
        );
    }
    let mut padding = hex(WEBPL);
    *padding.last_mut().unwrap() = 1;
    rejected(&padding, "image/webp", 2, 2);
    let mut version = hex(WEBPL)[20..35].to_vec();
    version[4] |= 0x20;
    rejected(&riff(&[(b"VP8L", version)]), "image/webp", 2, 2);
    rejected(&riff(&[(b"VP8X", vp8x(2, 2, 0))]), "image/webp", 2, 2);
    rejected(
        &riff(&[(b"VP8L", hex(WEBPL)[20..35].to_vec()), (b"VP8 ", bitstream)]),
        "image/webp",
        2,
        2,
    );
}

#[test]
fn binary_envelope_rejects_oversize_invalid_headers_and_mime_confusion() {
    for input in [vec![], vec![255; 4], vec![0; 4], vec![0; 1029]] {
        let result: Value =
            serde_json::from_str(&validate_image_sequence_image_bytes(input)).unwrap();
        assert!(result["error"].is_string());
    }
    rejected(&hex(PNG), "image/jpeg", 2, 2);
    rejected(&hex(PNG), "image/svg+xml", 2, 2);
    rejected(&vec![0; 16 * 1024 * 1024 + 1], "image/png", 2, 2);
    rejected(&[], "image/png", 2, 2);
}
