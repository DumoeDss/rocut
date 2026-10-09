use editor_api::resolve_video_export_json;
use serde_json::{Value, json};

fn request(codec: &str, quality: &str, width: u32, height: u32) -> Value {
    json!({"codec":codec,"quality":quality,"width":width,"height":height,
        "frameRate":{"numerator":30,"denominator":1}})
}

fn resolve(request: &Value) -> Value {
    serde_json::from_str(&resolve_video_export_json(request.to_string())).unwrap()
}

#[test]
fn lower_presets_preserve_existing_bitrates() {
    for (codec, expected) in [
        ("avc", [1800000, 3000000, 6000000]),
        ("vp9", [1080000, 1800000, 3600000]),
    ] {
        for (quality, bitrate) in ["low", "medium", "high"].into_iter().zip(expected) {
            let mut r = request(codec, quality, 1920, 1080);
            assert_eq!(resolve(&r), json!({"bitrate":bitrate}));
            r["frameRate"]["numerator"] = json!(120);
            assert_eq!(resolve(&r), json!({"bitrate":bitrate}));
        }
    }
    for (quality, bitrate) in [("low", 134000), ("medium", 224000), ("high", 447000)] {
        assert_eq!(
            resolve(&request("vp9", quality, 640, 360)),
            json!({"bitrate":bitrate})
        );
    }
}

#[test]
fn very_high_budgets_detail_per_pixel_and_rational_frame_rate() {
    for (codec, bitrate) in [("avc", 3456000), ("vp9", 2074000)] {
        assert_eq!(
            resolve(&request(codec, "very_high", 640, 360)),
            json!({"bitrate":bitrate})
        );
    }
    let mut r = request("vp9", "very_high", 1920, 1080);
    r["frameRate"] = json!({"numerator":30000,"denominator":1001});
    assert_eq!(resolve(&r), json!({"bitrate":18644000}));
    r["frameRate"] = json!({"numerator":30,"denominator":1});
    assert_eq!(resolve(&r), json!({"bitrate":18663000}));
    r["frameRate"]["numerator"] = json!(60);
    assert_eq!(resolve(&r), json!({"bitrate":37325000}));
    r["frameRate"]["numerator"] = json!(1);
    assert_eq!(resolve(&r), json!({"bitrate":7200000}));
}

#[test]
fn rejects_invalid_policy_inputs_instead_of_coercing_them() {
    let base = request("vp9", "very_high", 640, 360);
    for (key, value) in [
        ("width", json!(0)),
        ("width", json!(1.5)),
        ("height", json!(-1)),
        ("quality", json!("maximum")),
        ("codec", json!("av1")),
        ("frameRate", json!({"numerator":0,"denominator":1})),
        ("frameRate", json!({"numerator":30,"denominator":0})),
        ("frameRate", json!({"numerator":7,"denominator":3})),
        ("frameRate", json!({"numerator":240000,"denominator":1})),
        ("bitrate", json!(1000)),
    ] {
        let mut r = base.clone();
        r[key] = value;
        assert!(resolve(&r)["error"].is_string(), "{r}");
    }
    assert!(resolve(&request("avc", "very_high", u32::MAX, u32::MAX))["error"].is_string());
}
