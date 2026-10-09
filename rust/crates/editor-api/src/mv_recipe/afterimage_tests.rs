use super::{Afterimage, catalog, math};
use serde_json::{Value, json};

pub(super) fn settings() -> Value {
    json!({"cutout":{"image":"image","rect":[0.4,0.3,0.2,0.4]},
        "titleFont":"font","glyphs":[{"text":"A","center":[0.25,0.5],"fontSize":0.3}],
        "circle":{"center":[0.5,0.5],"radius":0.2},
        "subtitle":{"font":"font","text":"subtitle","position":[0.5,0.8],"fontSize":0.025,"tracking":0.01,"opacity":0.8},
        "credit":{"font":"font","text":"credit","position":[0.5,0.9],"fontSize":0.025,"tracking":0.005,"opacity":0.78,"color":[0.5,0.7,0.9,1]},
        "color":[0.3,0.8,0.9,1],"fringeColor":[0.1,0.3,0.8,1],"background":[0,0,0,1],
        "grain":0.05,"timeScale":1,"motionScale":1})
}
fn valid(value: Value) -> bool {
    serde_json::from_value::<Afterimage>(value).is_ok_and(|s| s.valid())
}
#[test]
fn every_authored_field_is_required_and_nested_bounds_are_strict() {
    let base = settings();
    assert!(valid(base.clone()));
    for key in base.as_object().unwrap().keys() {
        let mut v = base.clone();
        v.as_object_mut().unwrap().remove(key);
        assert!(!valid(v), "required {key}");
    }
    for (path, value) in [
        ("/glyphs", json!([])),
        ("/glyphs", json!(vec![base["glyphs"][0].clone(); 17])),
        ("/glyphs/0/text", json!("AB")),
        ("/glyphs/0/text", json!("\n")),
        ("/subtitle/text", json!("a\tb")),
        ("/credit/text", json!("a".repeat(257))),
        ("/cutout/rect/2", json!(0)),
        ("/cutout/rect/0", json!(-2.001)),
        ("/circle/radius", json!(2.001)),
        ("/glyphs/0/fontSize", json!(0)),
        ("/subtitle/tracking", json!(0.201)),
        ("/credit/opacity", json!(1.01)),
        ("/credit/color/0", json!(-0.1)),
        ("/grain", json!(-0.1)),
        ("/timeScale", json!(0)),
        ("/motionScale", json!(4.01)),
        ("/titleFont", json!("")),
        ("/cutout/image", json!("a".repeat(241))),
    ] {
        let mut v = base.clone();
        *v.pointer_mut(path).unwrap() = value;
        assert!(!valid(v), "{path}");
    }
    let mut unicode = base.clone();
    unicode["glyphs"][0]["text"] = json!("\u{1f642}");
    unicode["subtitle"]["text"] = json!("\u{1f642}".repeat(256));
    assert!(valid(unicode));
    let mut unknown = base;
    unknown["credit"]["unexpected"] = json!(true);
    assert!(!valid(unknown));
}

#[test]
fn reference_hash_noise_and_complete_grain_tiles_match_javascript_goldens() {
    // Goldens evaluated from reference core/util.js in an isolated Node VM;
    // tile samples use its rng + Uint8ClampedArray, not this implementation.
    assert_eq!(math::hash(&[-1.0, 91.0]), 188551065);
    assert_eq!(math::hash(&[1_000_000.0, 91.0]), 1118278225);
    assert_eq!(math::hash(&[4294967295.0]), 782753503);
    for (x, expected) in [
        (0.0, 0.37119746347889304),
        (0.1265, 0.36332494147933325),
        (3.565, 0.7230587175601126),
    ] {
        assert!((math::noise(x, 91) - expected).abs() < 1e-14);
    }
    for (tile, expected) in [1372860779u32, 1137316289, 2558802254, 1923878407]
        .into_iter()
        .enumerate()
    {
        let g = math::grain(0, tile as u64, 0.05).unwrap();
        assert_eq!(g.gray.len(), 65536);
        assert_eq!(
            g.gray.iter().fold(2166136261u32, |h, b| (h ^ u32::from(*b))
                .wrapping_mul(16777619)),
            expected
        );
    }
    assert_eq!(math::grain(0, 37, 0.05).unwrap().offset, [214, 224]);
    assert!(math::grain(0, 0, 0.0).is_none());
}

#[test]
fn faithful_multiscale_response_matches_reference_not_a_generic_blur() {
    let s: Afterimage = serde_json::from_value(settings()).unwrap();
    // Reference intro.js bezier and afterDraw equation, duration 4 seconds.
    for (t, soft, credit) in [
        (0.055, 0.38237582295135886, 0.0),
        (0.11, 0.44240584116197623, 0.0),
        (0.22, 0.4377337912262477, 0.0),
        (1.0, 0.29179086992213443, 0.17332760912235512),
        (1.55, 0.17856233268183788, 0.78),
        (2.0, 0.1976887554555053, 0.78),
        (3.5, 0.023378176501013963, 0.26948337219377033),
    ] {
        let p = s.plan(t, 4.0, 0, 0, 1920.0, 1080.0);
        assert!((p.layers[3].opacity - soft).abs() < 1e-12, "time {t}");
        assert!((p.credit.opacity - credit).abs() < 1e-12, "credit {t}");
    }
    let p = s.plan(1.0, 4.0, 0, 0, 1920.0, 1080.0);
    assert_eq!(
        p.rasters.iter().map(|r| r.size).collect::<Vec<_>>(),
        [[1920, 1080], [960, 540], [480, 270], [240, 135], [480, 270]]
    );
    assert_eq!(
        p.rasters.iter().map(|r| r.blur).collect::<Vec<_>>(),
        [0.0, 3.0, 6.0, 5.0, 4.0]
    );
    assert_eq!(
        p.rasters.iter().map(|r| r.source).collect::<Vec<_>>(),
        ["mask", "sharp", "sharp", "sharp", "mask"]
    );
    assert_eq!(
        p.layers.iter().map(|l| l.raster).collect::<Vec<_>>(),
        ["fringe", "sharp", "mid", "soft", "halo"]
    );
    assert_eq!(p.layers[0].rect, [-10.0, -6.0, 1940.0, 1092.0]);
    assert_eq!(p.layers[4].rect, [-14.0, -9.0, 1948.0, 1098.0]);
    assert_eq!(p.mask.glyphs[0].center, [480.0, 540.0]);
    assert_eq!(p.mask.glyphs[0].font_size, 324.0);
    assert_eq!(p.mask.subtitle.tracking, 10.8);
    assert!(s.plan(0.0, 4.0, 0, 0, 1920.0, 1080.0).layers.is_empty());
    let end = s.plan(4.0, 4.0, 0, 0, 1920.0, 1080.0);
    assert!(end.layers.is_empty());
    assert_eq!(end.credit.opacity, 0.0);
}

#[test]
fn explicit_scales_seed_resolution_and_random_access_remain_deterministic() {
    let mut s: Afterimage = serde_json::from_value(settings()).unwrap();
    let original = serde_json::to_value(s.plan(1.0, 4.0, 24, 0, 1920.0, 1080.0)).unwrap();
    let _ = s.plan(3.0, 4.0, 72, 0, 1920.0, 1080.0);
    assert_eq!(
        original,
        serde_json::to_value(s.plan(1.0, 4.0, 24, 0, 1920.0, 1080.0)).unwrap()
    );
    assert_ne!(
        original,
        serde_json::to_value(s.plan(1.0, 4.0, 24, 1, 1920.0, 1080.0)).unwrap()
    );
    s.time_scale = 2.0;
    assert_eq!(
        original,
        serde_json::to_value(s.plan(0.5, 2.0, 24, 0, 1920.0, 1080.0)).unwrap()
    );
    s.motion_scale = 0.0;
    assert_eq!(
        s.plan(0.5, 2.0, 24, 0, 1920.0, 1080.0).transform,
        [1.0, 0.0, -0.0, 1.0, 0.0, 0.0]
    );
    let p = s.plan(0.5, 2.0, 24, 0, 960.0, 540.0);
    assert_eq!(p.rasters[2].blur, 3.0);
    assert_eq!(p.layers[0].rect, [-5.0, -3.0, 970.0, 546.0]);
    assert_eq!(s.plan(0.5, 2.0, 24, 0, 1.0, 1.0).rasters[3].size, [1, 1]);
}

#[test]
fn catalog_exposes_nested_authoring_rules_and_no_implicit_content() {
    let c = catalog::catalog_entry();
    assert_eq!(
        c["parameters"]["glyphs"]["items"]["properties"]["text"]["maxLength"],
        1
    );
    assert_eq!(c["parameters"]["glyphs"]["maxItems"], 16);
    assert_eq!(
        c["parameters"]["credit"]["properties"]["text"]["maxUtf8Bytes"],
        1024
    );
    assert_eq!(c["parameters"]["cutout"]["additionalProperties"], false);
}
