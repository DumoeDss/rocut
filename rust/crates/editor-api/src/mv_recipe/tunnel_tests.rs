use super::{
    Sample,
    math::*,
    model::{Metrics, Tunnel},
};
fn settings() -> Tunnel {
    serde_json::from_value(serde_json::json!({"fonts":{"mincho800":"m","dot400":"d","heavy900":"h","noto400":"n4","noto800":"n8","noto900":"n9"},"beats":{"kind":"manual","songTicks":[0,60000,120000,180000,240000,300000,360000,420000,480000,540000,600000,660000,720000,780000,840000,900000,960000]},"bpm":120,"downbeatIndex0":0})).unwrap()
}
fn metrics() -> Metrics {
    let mut m = Metrics {
        stacks: Default::default(),
        mincho_800: Default::default(),
        dot_400: Default::default(),
    };
    for ch in "暗闇の果てでまだ遅くないあなたに会光残".chars() {
        m.mincho_800.insert(ch.to_string(), 100.0);
    }
    for ch in super::model::LATIN.join(" · ").chars() {
        m.dot_400.insert(ch.to_string(), 50.0);
    }
    m
}
#[test]
fn travel_is_continuous_before_inside_and_after_shot() {
    assert_eq!(travel(-1.0, 4.0, 3.1, 9.5), -3.1);
    assert!((travel(4.0, 4.0, 3.1, 9.5) - (12.4 + 6.4 * 4.0 / 3.0)).abs() < 1e-12);
    assert!((travel(5.0, 4.0, 3.1, 9.5) - travel(4.0, 4.0, 3.1, 9.5) - 9.5).abs() < 1e-12);
}
#[test]
fn scene_defaults_and_strict_settings() {
    let a = settings();
    assert_eq!(a.words.last().unwrap(), "残光");
    assert_eq!(a.f, 820.0);
    let bad = serde_json::json!({"beats":{"kind":"analysis"},"bpm":120,"downbeatIndex0":0,"genericGeometry":true});
    assert!(serde_json::from_value::<Tunnel>(bad).is_err());
}
#[test]
fn metrics_are_required_not_synthetic_fallback() {
    let a = settings();
    let s = Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 480000,
        song_ticks: 120000,
        analysis: None,
    };
    assert!(
        a.produce(
            &s,
            1920,
            1080,
            &Metrics {
                stacks: Default::default(),
                mincho_800: Default::default(),
                dot_400: Default::default()
            }
        )
        .is_err()
    );
    // Widths without authenticated stacks never cross native admission.
    assert!(a.produce(&s, 1920, 1080, &metrics()).is_err());
}
#[test]
fn post_settles_and_output_is_deterministic() {
    let a = settings();
    let s = Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 480000,
        song_ticks: 480000,
        analysis: None,
    };
    let post = a.post(&s).unwrap();
    assert!((post.bloom - 0.57).abs() < 1e-12);
    assert!((post.zoom_blur - 0.058 * 0.08).abs() < 1e-12);
    assert!(a.produce(&s, 1920, 1080, &metrics()).is_err());
}
#[test]
fn original_css_truncates_after_byte_domain_mix() {
    assert_eq!(
        css(mix(rgb(0x120c22), rgb(0x241634), 0.5), 1.0),
        [27.0 / 255.0, 17.0 / 255.0, 43.0 / 255.0, 1.0]
    );
}

fn real_fonts() -> (
    Vec<crate::programmatic_resources::Resource>,
    std::collections::BTreeMap<String, Vec<u8>>,
) {
    use crate::programmatic_resources::Resource;
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    let root = std::env::var_os("ROCUT_TUNNEL_TEST_FONTS")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../apps/web/public/motion-text/fonts")
        });
    let mut bodies = BTreeMap::new();
    let mut resources = Vec::<Resource>::new();
    for (id, family, weight, file, variable) in [
        (
            "m",
            "Shippori Mincho B1",
            800,
            "shippori-mincho-b1-extrabold.ttf",
            false,
        ),
        ("d", "DotGothic16", 400, "dot-gothic-16-regular.ttf", false),
        (
            "h",
            "Zen Old Mincho",
            900,
            "zen-old-mincho-black.ttf",
            false,
        ),
        (
            "n4",
            "Noto Serif JP",
            400,
            "noto-serif-jp-variable.ttf",
            true,
        ),
        (
            "n8",
            "Noto Serif JP",
            800,
            "noto-serif-jp-variable.ttf",
            true,
        ),
        (
            "n9",
            "Noto Serif JP",
            900,
            "noto-serif-jp-variable.ttf",
            true,
        ),
    ] {
        let body = std::fs::read(root.join(file)).expect("real Tunnel test font bytes required");
        let hash = format!("{:x}", Sha256::digest(&body));
        let mut font = serde_json::json!({"family":family,"style":"normal","weight":weight});
        if variable {
            font["axes"] = serde_json::json!({"wght":weight});
        }
        resources.push(serde_json::from_value(serde_json::json!({"id":id,"kind":"font","attachmentKey":format!("programmatic-sha256-{hash}"),"mimeType":"font/ttf","byteLength":body.len(),"sha256":hash,"font":font})).unwrap());
        bodies.insert(id.to_string(), body);
    }
    (resources, bodies)
}
#[test]
fn real_font_admission_preserves_o_macron_and_binds_complete_native_receipts() {
    let (resources, mut bodies) = real_fonts();
    let a = settings();
    let admission = a.admit_fonts(&resources, &bodies).unwrap();
    let dot = &admission.stacks["dot400"];
    assert_eq!(dot.routes["Ō"], "n4");
    assert_eq!(dot.routes["A"], "d");
    let mut wrong_axis = resources.clone();
    let mut descriptor = serde_json::to_value(&wrong_axis[3]).unwrap();
    descriptor["font"]["axes"]["wght"] = serde_json::json!(900);
    wrong_axis[3] = serde_json::from_value(descriptor).unwrap();
    assert!(a.admit_fonts(&wrong_axis, &bodies).is_err());
    let mut wrong_family = resources.clone();
    let mut descriptor = serde_json::to_value(&wrong_family[1]).unwrap();
    descriptor["font"]["family"] = serde_json::json!("Noto Serif JP");
    wrong_family[1] = serde_json::from_value(descriptor).unwrap();
    assert!(a.admit_fonts(&wrong_family, &bodies).is_err());
    assert_ne!(dot.aliases[0], dot.aliases[1]);
    let requests = admission.metric_requests();
    assert_eq!(requests.len(), 3);
    // Deliberately synthetic numbers test receipt binding only, not pixels.
    let mut receipts: Vec<super::Measurement> = requests
        .into_iter()
        .map(|r| super::Measurement {
            font_stack: r.font_stack,
            font_size: r.font_size,
            advances: r.characters.into_iter().map(|ch| (ch, 100.0)).collect(),
        })
        .collect();
    let metrics = admission.bind_metrics(&receipts).unwrap();
    let sample = Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 480000,
        song_ticks: 480000,
        analysis: None,
    };
    let plan = a.produce(&sample, 1920, 1080, &metrics).unwrap();
    let encoded = serde_json::to_string(&plan).unwrap();
    assert!(encoded.contains("stackText"));
    assert!(encoded.contains("ZANKŌ — AFTERGLOW"));
    assert!(!encoded.contains("\"font\":\""));
    assert_eq!(
        encoded,
        serde_json::to_string(&a.produce(&sample, 1920, 1080, &metrics).unwrap()).unwrap()
    );
    receipts[0].font_stack.resources.swap(0, 1);
    assert!(admission.bind_metrics(&receipts).is_err());
    receipts[0].font_stack.resources.swap(0, 1);
    let missing = receipts[0].advances.keys().next().unwrap().clone();
    receipts[0].advances.remove(&missing);
    assert!(admission.bind_metrics(&receipts).is_err());
    bodies.get_mut("d").unwrap()[0] ^= 1;
    assert!(a.admit_fonts(&resources, &bodies).is_err());
}

#[test]
fn public_binary_frame_three_phase_admission_and_node_binding() {
    use serde_json::{Value, json};
    let (resources, bodies) = real_fonts();
    let mut input = json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":1920,"height":1080,"frameRate":{"numerator":30,"denominator":1},"durationFrames":120,"seed":0,"resources":resources,
        "recipe":{"version":1,"root":"tunnel","songStartSeconds":0,"outputRoles":["graphics"],"post":[],"nodes":[{"id":"tunnel","scene":{"kind":"tunnel","role":"graphics","span":{"startFrame":0,"durationFrames":120},"settings":{"fonts":{"mincho800":"m","dot400":"d","heavy900":"h","noto400":"n4","noto800":"n8","noto900":"n9"},"beats":{"kind":"manual","songTicks":[0,60000,120000,180000,240000,300000,360000,420000,480000]},"bpm":120,"downbeatIndex0":0}}}]}},"clipStart":0,"clipDuration":1,"trimStart":468000,"timelineTime":0});
    let first: Value =
        serde_json::from_str(&crate::resolve_programmatic_frame_json(input.to_string())).unwrap();
    assert!(first.get("error").is_none(), "{first}");
    assert!(first["frame"].get("recipePlan").is_none());
    let requested = first["frame"]["tunnelFontByteRequests"].as_array().unwrap();
    assert_eq!(requested.len(), 6);
    let mut packed = Vec::new();
    let mut ranges = Vec::new();
    for request in requested {
        let id = request["id"].as_str().unwrap();
        let body = &bodies[id];
        ranges.push(json!({"id":id,"offset":packed.len(),"length":body.len()}));
        packed.extend_from_slice(body);
    }
    let layout = serde_json::to_string(&ranges).unwrap();
    let resolve = |v: &Value, bytes: &[u8]| -> Value {
        serde_json::from_str(&crate::resolve_programmatic_frame_tunnel_bytes(
            v.to_string(),
            layout.clone(),
            bytes,
        ))
        .unwrap()
    };
    let discovered = resolve(&input, &packed);
    assert!(discovered.get("error").is_none(), "{discovered}");
    let metric_requests = discovered["frame"]["tunnelFontMetricRequests"]
        .as_array()
        .unwrap();
    assert_eq!(metric_requests.len(), 3);
    assert_eq!(metric_requests[0]["fontStack"]["role"], "mincho800");
    assert_eq!(metric_requests[1]["fontStack"]["routes"]["Ō"], "n4");
    let measured:Vec<_>=metric_requests.iter().map(|r|json!({"nodeId":r["nodeId"],"fontStack":r["fontStack"],"fontSize":r["fontSize"],"advances":r["characters"].as_array().unwrap().iter().map(|ch|(ch.as_str().unwrap().to_owned(),json!(100.0))).collect::<serde_json::Map<_,_>>()})).collect();
    input["tunnelFontMeasurements"] = json!(measured);
    let evaluated = resolve(&input, &packed);
    assert!(evaluated.get("error").is_none(), "{evaluated}");
    assert_eq!(evaluated["frame"]["recipePlan"]["root"]["kind"], "tunnel");
    assert!(
        evaluated["frame"]["recipePlan"]["root"]
            .get("native_post")
            .is_none()
    );
    assert_eq!(
        evaluated["frame"]["recipePlan"]["root"]["nativePost"]["songTicks"],
        468000
    );
    assert_eq!(
        evaluated["frame"]["recipePlan"]["root"]["nativePost"]["required"],
        true
    );
    assert_eq!(
        evaluated["frame"]["tunnelFontStacks"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert!(evaluated["frame"].get("tunnelFontMetricRequests").is_none());
    let mut wrong = input.clone();
    wrong["tunnelFontMeasurements"][0]["nodeId"] = json!("other");
    assert!(resolve(&wrong, &packed).get("error").is_some());
    let mut authored = input.clone();
    authored["source"]["tunnelFontMeasurements"] = authored["tunnelFontMeasurements"].clone();
    assert!(resolve(&authored, &packed).get("error").is_some());
    assert!(
        serde_json::from_str::<Value>(&crate::resolve_programmatic_frame_json(input.to_string()))
            .unwrap()
            .get("error")
            .is_some()
    );
    packed[0] ^= 1;
    assert!(resolve(&input, &packed).get("error").is_some());
}
