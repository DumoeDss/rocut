use super::*;
use serde_json::{Value, json};
fn input() -> (String, Vec<u8>, Request) {
    let font = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../apps/web/public/motion-text/fonts/yuji-syuku-regular.ttf"),
    )
    .unwrap();
    let face = ttf_parser::Face::parse(&font, 0).unwrap();
    let family = face
        .names()
        .into_iter()
        .find_map(|n| {
            (n.name_id == ttf_parser::name_id::FAMILY)
                .then(|| n.to_string())
                .flatten()
        })
        .unwrap();
    let weight = face.weight().to_number();
    let font_resource: Resource = serde_json::from_value(json!({"id":"font","kind":"font","attachmentKey":format!("programmatic-sha256-{}",hash(&font)),"mimeType":"font/ttf","byteLength":font.len(),"sha256":hash(&font),"font":{"family":family,"style":"normal","weight":weight,"axes":{}}})).unwrap();
    let preset = json!({"style":"noir","layout":"center","enter":"cut","hold":"still","exit":"cut","decor":[],"treat":"none","bg":"none","cam":"none","fx":[],"trans":null});
    let sequence=serde_json::to_vec(&json!({"id":"sequence:test","schemaVersion":1,"revision":1,
        "source":{"format":"plain","text":"X"},"language":"en","duration":120000,"compositionMode":"scene","seed":7,
        "engine":{"id":"jizura","version":motion_text::JIZURA_ENGINE_VERSION,"catalogHash":motion_text::JIZURA_CATALOG_HASH,"plannerVersion":1,"tokenizerVersion":motion_text::MOTION_TEXT_TOKENIZER_VERSION},
        "fonts":[{"id":"main","source":"project","family":family,"style":"normal","weight":weight,"assetId":"font","contentDigest":format!("sha256:{}",hash(&font))}],
        "defaults":{"preset":preset,"fontId":"main","colors":{},"parameters":{}},
        "cues":[{"id":"cue","text":"X","startTime":0,"duration":120000,"interlude":false,"segments":["X"],"overrides":{},"locks":[]}],
        "resolvedPlan":{"version":1,"sequenceRevision":1,"cuts":[{"id":"cut","cueId":"cue","text":"X","startTime":0,"duration":120000,"seed":7,"preset":preset,"parameters":{}}]}
    })).unwrap();
    let sequence_resource:Resource=serde_json::from_value(json!({"id":"sequence","kind":"analysis","attachmentKey":format!("programmatic-sha256-{}",hash(&sequence)),"mimeType":"application/json","byteLength":sequence.len(),"sha256":hash(&sequence)})).unwrap();
    let outer = 3 * crate::mv_recipe::jz::FRAME_BYTES;
    let request = Request {
        sequence: sequence_resource,
        sequence_ticks: 0,
        source_start_ticks: 0,
        source_end_ticks: 120000,
        fonts: vec![Font {
            font_id: "main".into(),
            resource: font_resource,
        }],
        resident_bytes: sequence.len() as u64 * 12
            + font.len() as u64 * 8
            + 64 * 1024 * 1024
            + outer,
        host: Some(crate::mv_recipe::jz::HostReservation {
            recipe_reservation_bytes: outer,
            session_ceiling_bytes: MAX_BYTES - outer,
            max_live_sessions: 1,
            raster_byte_limit: MAX_BYTES,
        }),
    };
    let metadata=serde_json::to_string(&json!({"request":request,"sequence":{"offset":0,"length":sequence.len()},"fonts":[{"font":request.fonts[0],"encoded":{"offset":sequence.len(),"length":font.len()}}]})).unwrap();
    let packet = [sequence, font].concat();
    (metadata, packet, request)
}
#[test]
fn actual_sequence_domain_and_native_frame_lifetime_are_enforced() {
    let (metadata, packet, mut request) = input();
    let mut owner = Owner::new();
    let session = owner
        .prepare_with(&metadata, packet.len(), || Ok(packet.clone()))
        .unwrap();
    assert!(owner.check_text(session, "main", "X").is_err());
    let frame: Value = serde_json::from_str(
        &owner
            .frame(session, &serde_json::to_string(&request).unwrap())
            .unwrap(),
    )
    .unwrap();
    assert!(owner.release(session).is_err());
    owner.check_text(session, "main", "X").unwrap();
    assert!(owner.check_text(session, "not-bound", "X").is_err());
    assert!(
        owner
            .frame(session, &serde_json::to_string(&request).unwrap())
            .is_err()
    );
    owner
        .finish_frame(session, frame["serial"].as_u64().unwrap() as u32)
        .unwrap();
    assert!(owner.check_text(session, "main", "X").is_err());
    request.sequence_ticks = 120000;
    assert!(
        owner
            .frame(session, &serde_json::to_string(&request).unwrap())
            .is_err()
    );
    owner.release(session).unwrap();
    assert!(owner.prepared_json(session).is_err());
    let mut metadata: Value = serde_json::from_str(&metadata).unwrap();
    metadata["request"]["sourceEndTicks"] = json!(120001);
    assert!(
        owner
            .prepare_with(&metadata.to_string(), packet.len(), || Ok(packet.clone()))
            .is_err()
    );
    metadata["request"]["sourceEndTicks"] = json!(120000);
    metadata["fonts"][0]["encoded"]["offset"] = json!(0);
    assert!(
        owner
            .prepare_with(&metadata.to_string(), packet.len(), || Ok(packet))
            .is_err()
    );
}
