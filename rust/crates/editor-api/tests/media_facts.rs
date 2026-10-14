use editor_api::{inspect_media_facts_bytes, validate_media_facts_json};
use serde_json::{Value, json};

fn probe(header: Value, bytes: &[u8]) -> Value {
    let header = serde_json::to_vec(&header).unwrap();
    let mut input = (header.len() as u32).to_le_bytes().to_vec();
    input.extend(header);
    input.extend(bytes);
    serde_json::from_str(&inspect_media_facts_bytes(input)).unwrap()
}
#[test]
fn sampled_rate_is_average_and_source_digest_is_byte_bound() {
    let f = probe(
        json!({"packetCount":100,"averagePacketRate":29.97002997,
        "audio":{"channels":6,"sampleRate":48000}}),
        b"abc",
    );
    assert_eq!(
        f["sha256"],
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        f["frameRate"],
        json!({"numerator":2997003,"denominator":100000,"mode":"average","samples":100,"complete":false})
    );
    assert!(f["audio"].get("layout").is_none());
    assert!(f.get("alpha").is_none());
    assert_ne!(f["sha256"], probe(json!({}), b"abd")["sha256"]);
}
#[test]
fn strict_contract_preserves_false_and_rejects_incomplete_exact_rate() {
    let mut f = probe(json!({}), b"abc");
    f["alpha"] = json!(false);
    assert_eq!(
        serde_json::from_str::<Value>(&validate_media_facts_json(f.to_string())).unwrap()["alpha"],
        false
    );
    f["frameRate"] = json!({"numerator":30000,"denominator":1001,"mode":"constant","samples":100,"complete":false});
    assert_eq!(validate_media_facts_json(f.to_string()), "null");
    f["frameRate"]["complete"] = json!(true);
    assert_ne!(validate_media_facts_json(f.to_string()), "null");
    f["audio"] = json!({"channels":2,"sampleRate":48000,"layout":" "});
    assert_eq!(validate_media_facts_json(f.to_string()), "null");
}
#[test]
fn complete_gif_and_truncation_are_distinguished() {
    // Two complete 1x1 LZW images, NETSCAPE infinite loop, 2cs then 3cs.
    let mut b = b"GIF89a\x01\0\x01\0\x80\0\0\0\0\0\xff\xff\xff".to_vec();
    b.extend(b"\x21\xff\x0bNETSCAPE2.0\x03\x01\0\0\0");
    for delay in [2, 3] {
        b.extend([0x21, 0xf9, 4, 1, delay, 0, 0, 0]);
        b.extend(b"\x2c\0\0\0\0\x01\0\x01\0\0\x02\x02\x44\x01\0");
    }
    b.push(0x3b);
    let f = probe(json!({"mimeType":"image/gif"}), &b);
    assert_eq!(
        f["animation"],
        json!({"frameCount":2,"loopCount":0,"durationTicks":6000})
    );
    assert_eq!(f["alpha"], true);
    b.pop();
    let truncated = probe(json!({"mimeType":"image/gif"}), &b);
    assert!(truncated.get("animation").is_none());
    assert!(truncated.get("alpha").is_none());
}
#[test]
fn invalid_observations_and_unsupported_images_do_not_invent_facts() {
    let f = probe(json!({"mimeType":"image/png"}), b"not-png");
    assert!(f.get("animation").is_none());
    assert!(f.get("alpha").is_none());
    assert!(
        probe(json!({"packetCount":0,"averagePacketRate":30}), b"x")
            .get("frameRate")
            .is_none()
    );
    assert!(probe(json!({"forged":true}), b"x").is_null());
}

fn packet_probe(durations: &[u64], complete: bool) -> Value {
    let mut position = 0_u64;
    let timestamps: Vec<f64> = durations
        .iter()
        .map(|duration| {
            let timestamp = position as f64 / 30000.0;
            position += duration;
            timestamp
        })
        .collect();
    probe(
        json!({"videoPackets":{"timebase":30000,"timestampsSeconds":timestamps,
        "durationsSeconds":durations.iter().map(|n| *n as f64 / 30000.0).collect::<Vec<_>>(),
        "complete":complete}}),
        b"demuxed-source",
    )
}

#[test]
fn full_packet_timings_preserve_fractional_cfr_and_distinguish_vfr() {
    assert_eq!(
        packet_probe(&[1001, 1001, 1001], true)["frameRate"],
        json!({
            "numerator":30000,"denominator":1001,"mode":"constant","samples":3,"complete":true
        })
    );
    let vfr = packet_probe(&[1001, 2002, 1001], true);
    assert_eq!(vfr["frameRate"]["mode"], "variable");
    assert_eq!(vfr["frameRate"]["complete"], true);
    let partial = packet_probe(&[1001, 2002, 1001], false);
    assert_eq!(partial["frameRate"]["mode"], "average");
    assert_eq!(partial["frameRate"]["complete"], false);
}

#[test]
fn invalid_packet_evidence_does_not_claim_exact_rate() {
    for packets in [
        json!({"timebase":30000,"timestampsSeconds":[0,0],"durationsSeconds":[0.04,0.04],"complete":true}),
        json!({"timebase":30000,"timestampsSeconds":[0,0.1],"durationsSeconds":[0.04,0.04],"complete":true}),
        json!({"timebase":30000,"timestampsSeconds":[0],"durationsSeconds":[0],"complete":true}),
        json!({"timebase":0,"timestampsSeconds":[0],"durationsSeconds":[1],"complete":true}),
        json!({"timebase":30000,"timestampsSeconds":vec![0;257],"durationsSeconds":vec![1;257],"complete":true}),
    ] {
        assert!(
            probe(json!({"videoPackets":packets}), b"source")
                .get("frameRate")
                .is_none()
        );
    }
}

#[test]
fn gif_without_transparency_preserves_false_and_requires_exact_termination() {
    let mut bytes = b"GIF87a\x01\0\x01\0\x80\0\0\0\0\0\xff\xff\xff\x2c\0\0\0\0\x01\0\x01\0\0\x02\x02\x44\x01\0\x3b".to_vec();
    let facts = probe(json!({"mimeType":"image/gif"}), &bytes);
    assert_eq!(facts["alpha"], false);
    assert_eq!(facts["animation"]["frameCount"], 1);
    assert_eq!(facts["animation"]["durationTicks"], 0);
    assert!(facts["animation"].get("loopCount").is_none());
    bytes.push(0);
    assert!(
        probe(json!({"mimeType":"image/gif"}), &bytes)
            .get("animation")
            .is_none()
    );
}

#[test]
fn malformed_envelope_and_audio_layout_are_rejected() {
    assert_eq!(inspect_media_facts_bytes(vec![255; 4]), "null");
    assert_eq!(inspect_media_facts_bytes(vec![0; 4]), "null");
    assert!(
        probe(
            json!({"audio":{"channels":2,"sampleRate":48000,"layout":"stereo\n"}}),
            b"x"
        )
        .is_null()
    );
    let facts = probe(
        json!({"audio":{"channels":2,"sampleRate":48000,"layout":"stereo"}}),
        b"x",
    );
    assert_eq!(facts["audio"]["layout"], "stereo");
}

#[test]
fn real_static_container_fixtures_report_opaque_and_single_frame_only_when_complete() {
    // Same 2x2 encoded fixtures used by the container-admission tests.
    let fixtures = [
        (
            "image/png",
            "89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a7300000009704859730000000100000001004f25c4d60000001049444154789c63f8cbc000440c100a001fae03f5f6182a590000000049454e44ae426082",
        ),
        (
            "image/webp",
            "524946463c000000574542505650382030000000d001009d012a0200020002003425a00274ba01f80003b000fef0e8f7ff20b96175c8d7ff203fe407fc80fff8f2000000",
        ),
        (
            "image/webp",
            "524946461c000000574542505650384c0f0000002f014000000710f58ffe0722a2ff0100",
        ),
        (
            "image/jpeg",
            concat!(
                "ffd8ffe000104a46494600010200000100010000fffe000f4c61766336302e33",
                "2e31303000ffdb00430008040404040405050505050506060606060606060606",
                "06060607070708080807070706060707080808080909090808080809090a0a0a",
                "0c0c0b0b0e0e0e111114ffc4004c000101000000000000000000000000000000",
                "0601010100000000000000000000000000000607100100000000000000000000",
                "000000000000110100000000000000000000000000000000ffc0001108000200",
                "0203012200021100031100ffda000c03010002110311003f008b00517f7fffd9"
            ),
        ),
    ];
    for (mime, hex) in fixtures {
        let mut bytes: Vec<u8> = hex
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        let facts = probe(json!({"mimeType":mime}), &bytes);
        assert_eq!(facts["animation"]["frameCount"], 1, "{mime}");
        assert_eq!(facts["alpha"], false, "{mime}");
        assert!(facts.get("frameRate").is_none());
        bytes.pop();
        let truncated = probe(json!({"mimeType":mime}), &bytes);
        assert!(truncated.get("animation").is_none(), "{mime}");
        assert!(truncated.get("alpha").is_none(), "{mime}");
    }
}
