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
    for (codec, bitrate) in [("avc", 3456000), ("vp9", 3456000)] {
        assert_eq!(
            resolve(&request(codec, "very_high", 640, 360)),
            json!({"bitrate":bitrate})
        );
    }
    let mut r = request("vp9", "very_high", 1920, 1080);
    r["frameRate"] = json!({"numerator":30000,"denominator":1001});
    assert_eq!(resolve(&r), json!({"bitrate":31073000}));
    r["frameRate"] = json!({"numerator":30,"denominator":1});
    assert_eq!(resolve(&r), json!({"bitrate":31104000}));
    r["frameRate"]["numerator"] = json!(60);
    assert_eq!(resolve(&r), json!({"bitrate":62208000}));
    r["frameRate"]["numerator"] = json!(1);
    assert_eq!(resolve(&r), json!({"bitrate":7200000}));
}

#[test]
fn vp9_very_high_420_has_the_full_detail_budget_without_a_size_exception() {
    for (width, height, fps, bitrate) in [
        (192, 128, 24, 295000),
        (192, 128, 30, 369000),
        (640, 360, 24, 2765000),
        (1280, 720, 60, 27648000),
    ] {
        let mut r = request("vp9", "very_high", width, height);
        r["frameRate"]["numerator"] = json!(fps);
        assert_eq!(resolve(&r), json!({"bitrate":bitrate}));
        r["videoChroma"] = json!("420");
        assert_eq!(resolve(&r), json!({"bitrate":bitrate}));
        r["videoChroma"] = json!("444");
        assert_eq!(resolve(&r)["bitrate"], bitrate);
    }
}

#[test]
fn vp9_detail_budget_rounds_exact_rationals_before_float_conversion() {
    for (width, bitrate) in [(1000, 1199000), (1001, 1200000), (1002, 1202000)] {
        let mut r = request("vp9", "very_high", width, 40);
        r["frameRate"] = json!({"numerator":60000,"denominator":1001});
        assert_eq!(resolve(&r), json!({"bitrate":bitrate}));
        r["frameRate"] = json!({"numerator":60000000,"denominator":1001000});
        assert_eq!(resolve(&r), json!({"bitrate":bitrate}));
    }
}

#[test]
fn vp9_detail_budget_rejects_overflow_at_the_exact_rounded_boundary() {
    let mut r = request("vp9", "very_high", 8589934, 1);
    r["frameRate"]["numerator"] = json!(1000);
    assert_eq!(resolve(&r), json!({"bitrate":4294967000_u32}));
    r["width"] = json!(8589935);
    assert_eq!(
        resolve(&r),
        json!({"error":"Export bitrate exceeds the supported numeric range"})
    );
    r["width"] = json!(u32::MAX);
    r["height"] = json!(u32::MAX);
    r["frameRate"] = json!({"numerator":u32::MAX,"denominator":u32::MAX});
    assert_eq!(
        resolve(&r),
        json!({"error":"Export bitrate exceeds the supported numeric range"})
    );
}

#[test]
fn avc_very_high_preserves_its_baseline_and_frame_detail_budgets() {
    for (numerator, denominator, bitrate) in [
        (1, 1, 12000000),
        (24, 1, 24884000),
        (30000, 1001, 31073000),
        (60, 1, 62208000),
    ] {
        let mut r = request("avc", "very_high", 1920, 1080);
        r["frameRate"] = json!({"numerator":numerator,"denominator":denominator});
        assert_eq!(resolve(&r), json!({"bitrate":bitrate}));
    }
}

#[test]
fn explicit_quantizer_remains_authoritative_with_the_full_detail_budget() {
    for quantizer in [0, 32, 63] {
        let mut r = request("vp9", "very_high", 192, 128);
        r["frameRate"]["numerator"] = json!(24);
        r["format"] = json!("webm");
        r["videoQuantizer"] = json!(quantizer);
        for chroma in ["420", "444"] {
            r["videoChroma"] = json!(chroma);
            let plan = resolve(&r);
            assert_eq!(plan["kind"], "vp9Quantizer");
            assert_eq!(plan["quantizer"], quantizer);
            assert_eq!(plan["bitrate"], 295000);
            assert_eq!(plan["nativeConfig"]["bitrate"], 295000);
            assert_eq!(plan["nativeConfig"]["bitrateMode"], "quantizer");
            assert_eq!(plan["keyFrameIntervalFrames"], 48);
        }
    }
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

#[test]
fn explicit_420_preserves_default_bitrates_and_response_shape() {
    for codec in ["avc", "vp9"] {
        for quality in ["low", "medium", "high", "very_high"] {
            let mut r = request(codec, quality, 192, 128);
            let expected = resolve(&r);
            r["videoChroma"] = json!("420");
            assert_eq!(resolve(&r), expected);
            assert_eq!(resolve(&r).as_object().unwrap().len(), 1);
        }
    }
    assert_eq!(
        resolve(&request("vp9", "very_high", 192, 128)),
        json!({"bitrate":369000})
    );
}

#[test]
fn vp9_444_uses_explicit_profile_and_full_detail_budget() {
    let mut r = request("vp9", "very_high", 192, 128);
    r["videoChroma"] = json!("444");
    assert_eq!(
        resolve(&r),
        json!({"bitrate":369000,"fullCodecString":"vp09.01.11.08.03.01.13.01.01"})
    );
    r["frameRate"] = json!({"numerator":30000,"denominator":1001});
    assert_eq!(resolve(&r)["bitrate"], json!(369000));
    r["width"] = json!(1920);
    r["height"] = json!(1080);
    assert_eq!(
        resolve(&r),
        json!({"bitrate":31073000,"fullCodecString":"vp09.01.50.08.03.01.13.01.01"})
    );
    r["frameRate"] = json!({"numerator":30,"denominator":1});
    assert_eq!(resolve(&r)["bitrate"], json!(31104000));
    r["frameRate"]["numerator"] = json!(1);
    assert_eq!(resolve(&r)["bitrate"], json!(7200000));
}

#[test]
fn selecting_444_does_not_promote_quality() {
    for (quality, bitrate) in [("low", 134000), ("medium", 224000), ("high", 447000)] {
        let mut r = request("vp9", quality, 640, 360);
        r["videoChroma"] = json!("444");
        assert_eq!(
            resolve(&r),
            json!({"bitrate":bitrate,"fullCodecString":"vp09.01.21.08.03.01.13.01.01"})
        );
    }
}

#[test]
fn chroma_requires_an_exact_supported_string_and_vp9() {
    for invalid in [
        json!(null),
        json!(444),
        json!(true),
        json!(false),
        json!([]),
        json!(["444"]),
        json!({}),
        json!({"444":null}),
        json!({"420":null}),
        json!("422"),
        json!(" 444"),
        json!(""),
    ] {
        let mut r = request("vp9", "very_high", 192, 128);
        r["videoChroma"] = invalid;
        assert!(resolve(&r)["error"].is_string(), "{r}");
    }
    let mut r = request("avc", "very_high", 192, 128);
    r["videoChroma"] = json!("444");
    assert_eq!(
        resolve(&r),
        json!({"error":"4:4:4 export requires the VP9 codec"})
    );
}

#[test]
fn vp9_444_rejects_unsupported_levels_instead_of_using_the_highest() {
    for (width, height, fps, quality) in [
        (16833, 1, 1, "low"),
        (1, 16833, 1, "low"),
        (8192, 4353, 1, "low"),
        (8192, 4352, 150, "low"),
        (8192, 4352, 30, "very_high"),
    ] {
        let mut r = request("vp9", quality, width, height);
        r["videoChroma"] = json!("444");
        r["frameRate"]["numerator"] = json!(fps);
        assert_eq!(
            resolve(&r),
            json!({"error":"4:4:4 export exceeds supported VP9 input level limits"}),
            "{r}"
        );
    }
}

#[test]
fn explicit_quantizer_has_a_native_plan_without_quality_promotion() {
    for quantizer in [0, 32, 63] {
        let mut r = request("vp9", "low", 96, 64);
        r["format"] = json!("webm");
        r["videoQuantizer"] = json!(quantizer);
        let plan = resolve(&r);
        assert_eq!(plan["kind"], "vp9Quantizer");
        assert_eq!(plan["quantizer"], quantizer);
        assert_eq!(
            plan["bitrate"],
            resolve(&request("vp9", "low", 96, 64))["bitrate"]
        );
        assert_eq!(plan["keyFrameIntervalFrames"], 60);
        assert_eq!(plan["nativeConfig"]["alpha"], "discard");
        assert_eq!(plan["nativeConfig"]["bitrateMode"], "quantizer");
        assert_eq!(
            plan["nativeConfig"]["codec"],
            "vp09.00.10.08.01.01.13.01.01"
        );
        r["videoChroma"] = json!("444");
        assert_eq!(
            resolve(&r)["nativeConfig"]["codec"],
            "vp09.01.10.08.03.01.13.01.01"
        );
        r["frameRate"] = json!({"numerator":30000,"denominator":1001});
        assert_eq!(resolve(&r)["keyFrameIntervalFrames"], 60);
    }
}

#[test]
fn quantizer_rejects_null_coercion_and_wrong_container_without_fallback() {
    let mut base = request("vp9", "very_high", 96, 64);
    base["format"] = json!("webm");
    for invalid in [
        json!(null),
        json!(-1),
        json!(64),
        json!(256),
        json!(0.0),
        json!(0.5),
        json!("0"),
        json!(true),
        json!([]),
        json!({"0":null}),
    ] {
        let mut r = base.clone();
        r["videoQuantizer"] = invalid;
        assert!(resolve(&r)["error"].is_string(), "{r}");
    }
    base["videoQuantizer"] = json!(0);
    for (codec, format) in [
        ("avc", json!("webm")),
        ("vp9", json!("mp4")),
        ("vp9", json!(null)),
    ] {
        let mut r = base.clone();
        r["codec"] = json!(codec);
        r["format"] = format;
        assert!(resolve(&r)["error"].is_string(), "{r}");
    }
    let mut absent = base.clone();
    absent.as_object_mut().unwrap().remove("format");
    assert!(resolve(&absent)["error"].is_string());
    absent.as_object_mut().unwrap().remove("videoQuantizer");
    assert_eq!(
        resolve(&absent),
        resolve(&request("vp9", "very_high", 96, 64))
    );
}
