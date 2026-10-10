use super::*;
use serde_json::{Value, json};
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 == 1 { 0xedb88320 } else { 0 };
        }
    }
    !crc
}
fn tiny_png(width: u32, height: u32) -> Vec<u8> {
    // Real RGBA8 PNG: uncompressed zlib/deflate rows, checksummed chunks.
    // CPU tests do not claim a native Canvas decode/pixel gate.
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8; 4], body: &[u8]| {
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        let mut crc_bytes = kind.to_vec();
        crc_bytes.extend_from_slice(body);
        out.extend_from_slice(&crc_bytes);
        out.extend_from_slice(&crc32(&crc_bytes).to_be_bytes());
    };
    let mut ihdr = width.to_be_bytes().to_vec();
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(b"IHDR", &ihdr);
    let mut rows = vec![];
    for _ in 0..height {
        rows.push(0);
        rows.extend(std::iter::repeat_n(255, width as usize * 4));
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks = rows.chunks(65535);
    let block_count = blocks.len();
    for (index, block) in blocks.enumerate() {
        zlib.push(if index + 1 == block_count { 1 } else { 0 });
        let length = block.len() as u16;
        zlib.extend_from_slice(&length.to_le_bytes());
        zlib.extend_from_slice(&(!length).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for value in rows {
        a = (a + value as u32) % 65521;
        b = (b + a) % 65521;
    }
    zlib.extend_from_slice(&((b << 16) | a).to_be_bytes());
    chunk(b"IDAT", &zlib);
    chunk(b"IEND", &[]);
    out
}
fn replace_encoded(metadata: &Value, encoded: &[u8]) -> Value {
    let mut out = metadata.clone();
    let sha = hash(encoded);
    out["source"]["sha256"] = json!(sha);
    out["source"]["attachmentKey"] = json!(format!("programmatic-sha256-{sha}"));
    out["source"]["byteLength"] = json!(encoded.len());
    out["binding"]["source"] = out["source"].clone();
    out["encodedLayout"]["source"]["length"] = json!(encoded.len());
    out
}
fn input(ceiling: u64) -> (Value, Vec<u8>, Vec<u8>) {
    let encoded = tiny_png(20, 20);
    let rgba = vec![255; 20 * 20 * 4];
    let sha = hash(&encoded);
    let resource = json!({"id":"heart","kind":"image","mimeType":"image/png","byteLength":encoded.len(),"sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}")});
    let binding = json!({"source":resource,"decodedWidth":20,"decodedHeight":20,"decodedRgbaSha256":hash(&rgba),"decoder":DECODER,"algorithm":"heart-components-v1"});
    (
        json!({"source":resource,"binding":binding,"ceilingBytes":ceiling,"encodedLayout":{"source":{"offset":0,"length":encoded.len()}},"decodedLayout":{"source":{"offset":0,"length":rgba.len()}}}),
        encoded,
        rgba,
    )
}
fn frame(heart: &str) -> String {
    json!({"scene":{"kind":"heartShatter","settings":{"heart":heart}},"shotStartTicks":0,"shotEndTicks":600000,"songTicks":128040,"beats":[0,60000,120000,180000,240000,300000,360000,420000,480000,540000,600000],"bpm":120}).to_string()
}
fn diagnostics(owner: &Owner) -> Value {
    serde_json::from_str(&owner.diagnostic_json().unwrap()).unwrap()
}
#[test]
fn actual_owner_identity_binary_budget_replacement_and_cancellation() {
    // One test is intentional: process-global budgets are audited serially.
    let mut owner = Owner::new().unwrap();
    let baseline = diagnostics(&owner);
    let (metadata, encoded, rgba) = input(64 * 1024 * 1024);
    let prepared: PrepareInput = serde_json::from_value(metadata.clone()).unwrap();
    let discovery =
        heart::Session::discover(prepared.binding.clone(), &rgba, 64 * 1024 * 1024).unwrap();
    let mut replaced_rgba = rgba.clone();
    replaced_rgba[0] ^= 1;
    assert!(
        discovery.finish(&replaced_rgba, 64 * 1024 * 1024).is_err(),
        "Opaque discovery must reject replaced source pixels"
    );
    assert_eq!(
        super::metadata(&prepared, encoded.len(), rgba.len()).unwrap(),
        2 * (encoded.len() + rgba.len()) as u64 + 64 * 1024,
        "The private immutable packet and inbound WASM copy must both be reserved"
    );
    let a = owner
        .prepare(&metadata.to_string(), &encoded, &rgba)
        .unwrap();
    let b = owner
        .prepare(&metadata.to_string(), &encoded, &rgba)
        .unwrap();
    assert_ne!(a, b);
    let manifest: Value = serde_json::from_str(&owner.manifest_json(a).unwrap()).unwrap();
    let plan: Value = serde_json::from_str(&owner.frame_json(a, &frame("heart")).unwrap()).unwrap();
    assert_eq!(manifest["identity"], plan["identity"]);
    assert_ne!(
        manifest["identity"]["sessionId"],
        serde_json::from_str::<Value>(&owner.manifest_json(b).unwrap()).unwrap()["identity"]["sessionId"]
    );
    assert_eq!(owner.image_bytes(a, 0).unwrap(), rgba);
    assert!(manifest["images"][0]["image"]["binding"].is_object());
    assert!(manifest["images"][0].get("rgba").is_none());
    assert_eq!(manifest["images"][0]["byteLength"], rgba.len());
    assert_eq!(
        manifest["identity"]["imagesManifestSha256"],
        hash(
            json(&owner.entries.get(&a).unwrap().images)
                .unwrap()
                .as_bytes()
        )
    );
    // Unknown fact fields cannot be authored into frame or preparation JSON.
    let mut forged: Value = serde_json::from_str(&frame("heart")).unwrap();
    forged["binding"] = metadata["binding"].clone();
    assert!(owner.frame_json(a, &forged.to_string()).is_err());
    assert!(owner.manifest_json(a).is_err());
    assert!(owner.manifest_json(b).is_ok());
    assert_eq!(diagnostics(&owner)["reservedBytes"], 64 * 1024 * 1024);
    // Cancelling one capability does not clear another owner's session.
    let mut other = Owner::new().unwrap();
    let c = other
        .prepare(&metadata.to_string(), &encoded, &rgba)
        .unwrap();
    let other_manifest: Value = serde_json::from_str(&other.manifest_json(c).unwrap()).unwrap();
    assert_ne!(
        manifest["identity"]["ownerId"],
        other_manifest["identity"]["ownerId"]
    );
    assert!(owner.cancel(b).unwrap());
    assert!(!owner.cancel(b).unwrap());
    assert!(other.manifest_json(c).is_ok());
    assert_eq!(diagnostics(&owner)["reservedBytes"], 0);
    // Every failed prepare returns its own temporary reservation symmetrically.
    let before = diagnostics(&owner);
    let mut changed = encoded.clone();
    changed[0] ^= 1;
    assert!(
        owner
            .prepare(&metadata.to_string(), &changed, &rgba)
            .is_err()
    );
    let mut changed = rgba.clone();
    changed[3] = 0;
    assert!(
        owner
            .prepare(&metadata.to_string(), &encoded, &changed)
            .is_err()
    );
    for (path, value) in [
        ("decoder", json!("caller-decoder")),
        ("algorithm", json!("caller-components")),
        ("decodedWidth", json!(21)),
        ("decodedRgbaSha256", json!("ab".repeat(32))),
    ] {
        let mut malformed = metadata.clone();
        malformed["binding"][path] = value;
        assert!(
            owner
                .prepare(&malformed.to_string(), &encoded, &rgba)
                .is_err()
        );
    }
    let mut malformed = metadata.clone();
    malformed["source"]["id"] = json!("replacement");
    assert!(
        owner
            .prepare(&malformed.to_string(), &encoded, &rgba)
            .is_err()
    );
    let mut malformed = metadata.clone();
    malformed["encodedLayout"]["source"]["offset"] = json!(1);
    assert!(
        owner
            .prepare(&malformed.to_string(), &encoded, &rgba)
            .is_err()
    );
    let mut trailing = encoded.clone();
    trailing.push(0);
    assert!(
        owner
            .prepare(&metadata.to_string(), &trailing, &rgba)
            .is_err()
    );
    let mut malformed = metadata.clone();
    malformed["session"] = json!(c);
    assert!(
        owner
            .prepare(&malformed.to_string(), &encoded, &rgba)
            .is_err()
    );
    assert_eq!(before, diagnostics(&owner));
    for bytes in [b"not a PNG".to_vec(), tiny_png(21, 20)] {
        let malformed = replace_encoded(&metadata, &bytes);
        assert!(
            owner
                .prepare(&malformed.to_string(), &bytes, &rgba)
                .is_err()
        );
    }
    let mut malformed = metadata.clone();
    malformed["source"]["mimeType"] = json!("image/jpeg");
    malformed["binding"]["source"] = malformed["source"].clone();
    assert!(
        owner
            .prepare(&malformed.to_string(), &encoded, &rgba)
            .is_err()
    );
    let mut bad_crc = encoded.clone();
    bad_crc[29] ^= 1;
    assert!(
        owner
            .prepare(
                &replace_encoded(&metadata, &bad_crc).to_string(),
                &bad_crc,
                &rgba
            )
            .is_err()
    );
    assert_eq!(before, diagnostics(&owner));
    // Length/capability/preallocation failures never invoke the binary copier.
    let mut copied = false;
    let tiny = input(1024).0;
    assert!(
        owner
            .prepare_with::<Vec<u8>, Vec<u8>>(&tiny.to_string(), encoded.len(), rgba.len(), || {
                copied = true;
                Ok((encoded.clone(), rgba.clone()))
            })
            .is_err()
    );
    assert!(!copied);
    assert!(
        owner
            .prepare_with::<Vec<u8>, Vec<u8>>(&metadata.to_string(), usize::MAX, rgba.len(), || {
                copied = true;
                Ok((vec![], vec![]))
            })
            .is_err()
    );
    assert!(!copied);
    assert!(
        owner
            .prepare_with::<Vec<u8>, Vec<u8>>(
                &metadata.to_string(),
                encoded.len(),
                rgba.len(),
                || Err("native copy failed".into())
            )
            .is_err()
    );
    assert_eq!(before, diagnostics(&owner));
    // A panic in a private platform copier also drops the RAII reservation.
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = owner.prepare_with::<Vec<u8>, Vec<u8>>(
            &metadata.to_string(),
            encoded.len(),
            rgba.len(),
            || panic!("private copy failure"),
        );
    }));
    assert!(panic.is_err());
    assert_eq!(before, diagnostics(&owner));
    let d = owner
        .prepare(&metadata.to_string(), &encoded, &rgba)
        .unwrap();
    assert!(d > b);
    assert!(owner.frame_json(d, &frame("different")).is_err());
    assert!(owner.manifest_json(d).is_err());
    assert!(other.manifest_json(c).is_ok());
    // Cross-owner attempts cannot extract a session that this object never created.
    assert!(owner.image_bytes(c, 0).is_err());
    assert!(other.manifest_json(c).is_ok());
    other.dispose().unwrap();
    other.dispose().unwrap();
    assert!(
        other
            .prepare(&metadata.to_string(), &encoded, &rgba)
            .is_err()
    );
    let after = diagnostics(&owner);
    assert_eq!(
        after["globalReservedBytes"],
        baseline["globalReservedBytes"]
    );
    assert_eq!(after["globalSessions"], baseline["globalSessions"]);
    let mut handles = vec![];
    for _ in 0..MAX_OWNER_SESSIONS {
        handles.push(
            owner
                .prepare(&metadata.to_string(), &encoded, &rgba)
                .unwrap(),
        );
    }
    assert!(
        owner
            .prepare(&metadata.to_string(), &encoded, &rgba)
            .is_err()
    );
    assert_eq!(diagnostics(&owner)["sessions"], MAX_OWNER_SESSIONS);
    for handle in handles {
        assert!(owner.cancel(handle).unwrap());
    }
    let handle = owner
        .prepare(&metadata.to_string(), &encoded, &rgba)
        .unwrap();
    let once = owner
        .prepare(&metadata.to_string(), &encoded, &rgba)
        .unwrap();
    owner.image_bytes(once, 0).unwrap();
    let mut duplicated = false;
    assert!(
        owner
            .with_image_bytes(once, 0, |_| {
                duplicated = true;
                Ok(())
            })
            .is_err()
    );
    assert!(!duplicated);
    assert!(owner.manifest_json(once).is_err());
    owner.entries.get_mut(&handle).unwrap().images[0]
        .image
        .width += 1;
    assert!(owner.image_bytes(handle, 0).is_err());
    assert!(owner.manifest_json(handle).is_err());
    // Drop (without explicit dispose) releases owner count and reservations.
    let before_drop = diagnostics(&owner);
    {
        let mut temporary = Owner::new().unwrap();
        temporary
            .prepare(&metadata.to_string(), &encoded, &rgba)
            .unwrap();
    }
    assert_eq!(before_drop, diagnostics(&owner));
    let mut owners = vec![];
    for _ in 1..MAX_OWNERS {
        owners.push(Owner::new().unwrap());
    }
    assert!(Owner::new().is_err());
    drop(owners);
    // Ordinary source dimensions are retained exactly; no resizing/fallback.
    for (width, height) in [(1024u32, 1024u32), (1920, 1080)] {
        let large_encoded = tiny_png(width, height);
        let large_rgba = vec![255; width as usize * height as usize * 4];
        let mut large = replace_encoded(&metadata, &large_encoded);
        large["ceilingBytes"] = json!(MAX_OWNER_BYTES);
        large["binding"]["decodedWidth"] = json!(width);
        large["binding"]["decodedHeight"] = json!(height);
        large["binding"]["decodedRgbaSha256"] = json!(hash(&large_rgba));
        large["decodedLayout"]["source"]["length"] = json!(large_rgba.len());
        let id = owner
            .prepare(&large.to_string(), &large_encoded, &large_rgba)
            .unwrap();
        let manifest: Value = serde_json::from_str(&owner.manifest_json(id).unwrap()).unwrap();
        assert_eq!(manifest["images"].as_array().unwrap().len(), 1);
        assert_eq!(manifest["images"][0]["image"]["width"], width);
        assert_eq!(manifest["images"][0]["image"]["height"], height);
        owner.cancel(id).unwrap();
        assert_eq!(
            diagnostics(&owner)["globalReservedBytes"],
            baseline["globalReservedBytes"]
        );
    }
    // Missing character fails at the production dispatch and revokes the lease.
    let (metadata, encoded, rgba) = input(64 * 1024 * 1024);
    let id = owner
        .prepare(&metadata.to_string(), &encoded, &rgba)
        .unwrap();
    let mut gather: Value = serde_json::from_str(&frame("heart")).unwrap();
    gather["scene"] =
        json!({"kind":"heartGather", "settings":{"heart":"heart", "char":"character"}});
    assert!(
        owner
            .frame_json(id, &gather.to_string())
            .unwrap_err()
            .contains("admitted character")
    );
    assert!(!owner.cancel(id).unwrap());

    let mut character = metadata["binding"].clone();
    character.as_object_mut().unwrap().remove("algorithm");
    character["source"]["id"] = json!("character");
    let mut source_binding = metadata["binding"].clone();
    source_binding.as_object_mut().unwrap().remove("algorithm");
    let sky = json!({"source":metadata["source"], "binding":source_binding,
        "character":character, "settings":{"bg":"heart","char":"character"},
        "ceilingBytes":1024,
        "encodedLayout":{"source":{"offset":0,"length":encoded.len()},"character":{"offset":encoded.len(),"length":encoded.len()}},
        "decodedLayout":{"source":{"offset":0,"length":rgba.len()},"character":{"offset":rgba.len(),"length":rgba.len()}}});
    let copied = std::cell::Cell::new(false);
    assert!(
        owner
            .prepare_sky_with(&sky.to_string(), encoded.len() * 2, rgba.len() * 2, || {
                copied.set(true);
                Ok((Vec::<u8>::new(), Vec::<u8>::new()))
            })
            .is_err()
    );
    assert!(!copied.get());
    owner.dispose().unwrap();
}

#[test]
fn packet_ranges_reject_gap_overlap_trailing_and_overflow() {
    for json in [
        json!({"source":{"offset":0,"length":2},"background":{"offset":1,"length":2}}),
        json!({"source":{"offset":0,"length":2},"background":{"offset":3,"length":1}}),
        json!({"source":{"offset":0,"length":2},"background":{"offset":2,"length":0}}),
        json!({"source":{"offset":0,"length":2},"background":{"offset":2,"length":usize::MAX}}),
    ] {
        let layout: Layout = serde_json::from_value(json).unwrap();
        assert!(layout.split(&[0; 4], true).is_err());
    }
    let layout: Layout = serde_json::from_value(
        json!({"source":{"offset":0,"length":2},"background":{"offset":2,"length":2}}),
    )
    .unwrap();
    let (source, bg) = layout.split(&[1, 2, 3, 4], true).unwrap();
    assert_eq!(source, &[1, 2]);
    assert_eq!(bg.unwrap(), &[3, 4]);
    assert!(layout.split(&[0; 5], true).is_err());
    assert!(layout.split(&[0; 4], false).is_err());
    let layout: Layout = serde_json::from_value(json!({"source":{"offset":0,"length":2},
        "background":{"offset":2,"length":2}, "character":{"offset":4,"length":2}}))
    .unwrap();
    let packet = [1, 2, 3, 4, 5, 6];
    let (source, bg) = layout.split(&packet, true).unwrap();
    assert_eq!(source, &[1, 2]);
    assert_eq!(bg.unwrap(), &[3, 4]);
    assert_eq!(character_bytes(&layout, &packet).unwrap().unwrap(), &[5, 6]);
    assert!(layout.validate(7, true).is_err());
}
