use super::*;
use serde_json::json;

fn binding() -> Binding {
    serde_json::from_value(json!({
        "resource":{"id":"hand.png","kind":"image",
            "attachmentKey":format!("programmatic-sha256-{}", "a".repeat(64)),
            "mimeType":"image/png","byteLength":100,"sha256":"a".repeat(64)},
        "width":24,"height":24,"flameAt":[12,12,16,6,6,1],"algorithm":ALGORITHM
    }))
    .unwrap()
}

fn budget() -> Budget {
    Budget {
        external_bytes: 24 * 24 * 4 * 3,
        max_bytes: MAX_BYTES,
        max_channel_updates: MAX_UPDATES,
    }
}

fn image(binding: &Binding) -> Vec<u8> {
    let roi = binding.roi().unwrap();
    let mut bytes = Vec::with_capacity(roi.width as usize * roi.height as usize * 4);
    for q in 0..roi.width * roi.height {
        bytes.extend_from_slice(&[30, 60, 90, (q % 256) as u8]);
    }
    bytes
}

fn envelope(binding: &Binding, bytes: &[u8]) -> Vec<u8> {
    let header =
        serde_json::to_vec(&json!({"binding":binding,"roi":binding.roi().unwrap()})).unwrap();
    let mut input = (header.len() as u32).to_le_bytes().to_vec();
    input.extend(header);
    input.extend(bytes);
    input
}

fn mark(binding: &Binding, bytes: &mut [u8], x: u32, y: u32, rgb: [u8; 3]) {
    let roi = binding.roi().unwrap();
    let q = ((y - roi.y) * roi.width + x - roi.x) as usize;
    bytes[q * 4..q * 4 + 3].copy_from_slice(&rgb);
}

fn finish(sessions: &mut Sessions, id: u64, binding: &Binding, chunk: u32) -> PreparedPatch {
    let mut previous = 0;
    loop {
        let progress = sessions.step(id, chunk).unwrap();
        assert!(progress.channel_updates >= previous);
        assert!(progress.channel_updates - previous <= u64::from(chunk) * 3);
        previous = progress.channel_updates;
        if progress.complete {
            break;
        }
    }
    sessions.take(id, binding).unwrap()
}

#[test]
fn default_reference_landmark_has_exact_roi() {
    let mut b = binding();
    b.width = 1024;
    b.height = 1024;
    b.flame_at = [588.0, 632.0, 662.0, 150.0, 235.0, 46.0];
    assert_eq!(
        b.roi().unwrap(),
        Roi {
            x: 432,
            y: 320,
            width: 312,
            height: 483
        }
    );
}

#[test]
fn three_cross_dilations_restore_constant_boundary_and_preserve_alpha() {
    let b = binding();
    let mut pixels = image(&b);
    let original = pixels.clone();
    mark(&b, &mut pixels, 12, 12, [220, 130, 20]);
    let mut sessions = Sessions::default();
    let id = sessions
        .begin(&b, &envelope(&b, &pixels), &budget())
        .unwrap();
    let result = finish(&mut sessions, id, &b, 17);
    // A single seed plus three cardinal dilations has 1+4+8+12=25
    // interior pixels. The analytic Dirichlet solution is the constant RGB.
    assert_eq!(result.channel_updates, 25 * 220 * 3);
    assert_eq!(result.rgba, original);
    assert_eq!(sessions.bytes, 0);
    assert_eq!(sessions.updates, 0);
}

#[test]
fn empty_mask_completes_without_touching_any_byte() {
    let b = binding();
    let pixels = image(&b);
    let mut sessions = Sessions::default();
    let id = sessions
        .begin(&b, &envelope(&b, &pixels), &budget())
        .unwrap();
    let result = sessions.take(id, &b).unwrap();
    assert_eq!(result.channel_updates, 0);
    assert_eq!(result.rgba, pixels);
}

#[test]
fn threshold_comparisons_and_alpha_match_canvas_reference() {
    for (rgb, expected_updates) in [
        ([170, 130, 20], 0),
        ([171, 51, 20], 0),
        ([171, 52, 20], 25 * 660),
        ([220, 130, 99], 0),
        ([220, 130, 98], 25 * 660),
    ] {
        let b = binding();
        let mut pixels = image(&b);
        mark(&b, &mut pixels, 12, 12, rgb);
        let roi = b.roi().unwrap();
        let q = ((12 - roi.y) * roi.width + 12 - roi.x) as usize;
        pixels[q * 4 + 3] = 0; // The reference deliberately does not gate on alpha.
        let mut sessions = Sessions::default();
        let id = sessions
            .begin(&b, &envelope(&b, &pixels), &budget())
            .unwrap();
        let result = finish(&mut sessions, id, &b, MAX_STEP_PIXELS);
        assert_eq!(result.channel_updates, expected_updates);
        assert_eq!(result.rgba[q * 4 + 3], 0);
        if expected_updates == 0 {
            assert_eq!(result.rgba, pixels);
        }
    }
}

#[test]
fn all_masked_reference_nan_becomes_zero_only_on_interior() {
    let mut b = binding();
    b.width = 5;
    b.height = 5;
    b.flame_at = [2.0, 2.0, 3.0, 5.0, 5.0, 5.0];
    let mut pixels = vec![255; 5 * 5 * 4];
    for q in 0..25 {
        pixels[q * 4 + 3] = 17;
    }
    let mut sessions = Sessions::default();
    let id = sessions
        .begin(&b, &envelope(&b, &pixels), &budget())
        .unwrap();
    let result = finish(&mut sessions, id, &b, 11);
    assert_eq!(result.channel_updates, 9 * 660);
    for y in 0..5 {
        for x in 0..5 {
            let q = y * 5 + x;
            let expected = if x > 0 && x < 4 && y > 0 && y < 4 {
                0
            } else {
                255
            };
            assert_eq!(
                &result.rgba[q * 4..q * 4 + 4],
                &[expected, expected, expected, 17]
            );
        }
    }
}

#[test]
fn chunks_preserve_in_place_float32_order_and_repeat_sampling() {
    let b = binding();
    let roi = b.roi().unwrap();
    let mut pixels = image(&b);
    for y in 0..roi.height {
        for x in 0..roi.width {
            let q = (y * roi.width + x) as usize;
            pixels[q * 4] = (10 + x * 3 + y * 2) as u8;
            pixels[q * 4 + 1] = (20 + x + y * 3) as u8;
        }
    }
    mark(&b, &mut pixels, 12, 12, [240, 150, 10]);
    let input = envelope(&b, &pixels);
    let mut sessions = Sessions::default();
    let first = sessions.begin(&b, &input, &budget()).unwrap();
    let baseline = finish(&mut sessions, first, &b, MAX_STEP_PIXELS).rgba;
    for chunk in [1, 3, 127, MAX_STEP_PIXELS] {
        let id = sessions.begin(&b, &input, &budget()).unwrap();
        assert_eq!(finish(&mut sessions, id, &b, chunk).rgba, baseline);
    }
}

#[test]
fn binding_cannot_be_replaced_at_input_or_publication() {
    let b = binding();
    let input = envelope(&b, &image(&b));
    let mut sessions = Sessions::default();
    let id = sessions.begin(&b, &input, &budget()).unwrap();
    let source = serde_json::to_value(&b).unwrap();
    for (path, value) in [
        ("/resource/id", json!("other.png")),
        ("/resource/kind", json!("video")),
        ("/resource/attachmentKey", json!("other")),
        ("/resource/mimeType", json!("image/jpeg")),
        ("/resource/byteLength", json!(101)),
        ("/resource/sha256", json!("b".repeat(64))),
        ("/width", json!(25)),
        ("/height", json!(25)),
        ("/algorithm", json!("v2")),
    ] {
        let mut changed = source.clone();
        *changed.pointer_mut(path).unwrap() = value;
        let changed: Binding = serde_json::from_value(changed).unwrap();
        assert!(sessions.take(id, &changed).is_err());
        assert!(sessions.begin(&changed, &input, &budget()).is_err());
    }
    for index in 0..6 {
        let mut changed = b.clone();
        changed.flame_at[index] += 0.1;
        assert!(sessions.take(id, &changed).is_err());
        assert!(sessions.begin(&changed, &input, &budget()).is_err());
    }
    assert!(sessions.take(id, &b).is_ok());
}

#[test]
fn strict_envelope_rejects_missing_extra_fields_bytes_and_invalid_utf8() {
    let b = binding();
    let pixels = image(&b);
    let input = envelope(&b, &pixels);
    let mut sessions = Sessions::default();
    for mut invalid in [
        input[..3].to_vec(),
        input[..input.len() - 1].to_vec(),
        input.clone(),
    ] {
        if invalid.len() == input.len() {
            invalid.push(0);
        }
        assert!(sessions.begin(&b, &invalid, &budget()).is_err());
    }
    for header in [
        b"{\"extra\":1}".to_vec(),
        vec![0xff],
        vec![],
        vec![b' '; 4097],
    ] {
        let mut invalid = (header.len() as u32).to_le_bytes().to_vec();
        invalid.extend(header);
        invalid.extend(&pixels);
        assert!(sessions.begin(&b, &invalid, &budget()).is_err());
    }
    let mut bad_roi = serde_json::to_value(json!({"binding":b,"roi":b.roi().unwrap()})).unwrap();
    bad_roi["roi"]["x"] = json!(1);
    let header = serde_json::to_vec(&bad_roi).unwrap();
    let mut invalid = (header.len() as u32).to_le_bytes().to_vec();
    invalid.extend(header);
    invalid.extend(pixels);
    assert!(sessions.begin(&b, &invalid, &budget()).is_err());
    assert!(sessions.entries.is_empty());
}

#[test]
fn actual_work_and_joint_memory_are_admitted_before_float_diffusion() {
    let b = binding();
    let mut pixels = image(&b);
    mark(&b, &mut pixels, 12, 12, [220, 130, 20]);
    let input = envelope(&b, &pixels);
    let mut sessions = Sessions::default();
    let mut limits = budget();
    limits.max_channel_updates = 25 * 660 - 1;
    assert!(
        sessions
            .begin(&b, &input, &limits)
            .unwrap_err()
            .contains("channel update")
    );
    assert!(sessions.entries.is_empty());
    limits.max_channel_updates = 25 * 660;
    let id = sessions.begin(&b, &input, &limits).unwrap();
    assert!(sessions.begin(&b, &input, &limits).is_err()); // aggregate, not per job
    assert!(sessions.take(id, &b).is_err());
    assert!(sessions.step(id, 0).is_err());
    assert!(sessions.step(id, MAX_STEP_PIXELS + 1).is_err());
    sessions.dispose(id);
    sessions.dispose(id); // idempotent cleanup
    assert!(sessions.step(id, 1).is_err());
    assert_eq!((sessions.bytes, sessions.updates), (0, 0));
    limits.max_bytes = limits.external_bytes + 1;
    assert!(
        sessions
            .begin(&b, &input, &limits)
            .unwrap_err()
            .contains("joint memory")
    );
    limits.max_bytes = MAX_BYTES + 1;
    assert!(sessions.begin(&b, &input, &limits).is_err());
    limits.max_bytes = MAX_BYTES;
    limits.external_bytes = u64::MAX;
    assert!(sessions.begin(&b, &input, &limits).is_err());
}

#[test]
fn output_envelope_roundtrips_identity_and_exact_rgba() {
    let b = binding();
    let pixels = image(&b);
    let mut sessions = Sessions::default();
    let id = sessions
        .begin(&b, &envelope(&b, &pixels), &budget())
        .unwrap();
    let output = sessions.take(id, &b).unwrap().into_envelope().unwrap();
    assert_eq!(
        super::envelope::decode(&b, b.roi().unwrap(), &output).unwrap(),
        pixels
    );
}

#[test]
fn opaque_key_and_public_binary_helpers_keep_one_identity_truth() {
    let b = binding();
    let pixels = image(&b);
    let request = Request::new(b.clone()).unwrap();
    let key = request.patch_key().unwrap();
    assert_eq!(key, serde_json::to_string(&b).unwrap());
    assert_eq!(
        b.decode_rgba(&b.encode_rgba(&pixels).unwrap()).unwrap(),
        pixels
    );
    let mut different = request.clone();
    different.roi.x += 1;
    assert!(different.patch_key().is_err());
    let mut negative = b.clone();
    negative.flame_at[0] = -0.0;
    assert!(Request::new(negative).is_err());
    let mut sessions = Sessions::default();
    let id = sessions
        .begin(&b, &b.encode_rgba(&pixels).unwrap(), &Budget::joint(0))
        .unwrap();
    assert!(sessions.admit_external(MAX_BYTES).is_err());
    sessions.dispose(id);
    assert!(sessions.admit_external(MAX_BYTES).is_ok());
    assert!(sessions.admit_external(MAX_BYTES + 1).is_err());
}
