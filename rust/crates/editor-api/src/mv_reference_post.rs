//! Controlled original compositor policy. Platform code executes this bounded plan.
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

pub const PROFILE: &str = "tunnel-original-gl-v1";
pub const MAX_ALLOCATION_BYTES: u64 = 512 * 1024 * 1024;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferencePostPlan {
    pub profile: &'static str,
    pub required: bool,
    pub width: u32,
    pub height: u32,
    pub song_ticks: i64,
    pub allocation_bytes: u64,
    pub lut_atlas_required: bool,
    pub targets: Vec<PostTarget>,
    pub passes: Vec<PostPass>,
}
#[derive(Debug, Serialize)]
pub struct PostTarget {
    pub name: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Serialize)]
pub struct PostPass {
    pub shader: &'static str,
    pub target: Option<String>,
    pub uniforms: Map<String, Value>,
    pub textures: BTreeMap<String, String>,
}
fn pass(
    shader: &'static str,
    target: Option<&str>,
    uniforms: Value,
    textures: &[(&str, &str)],
) -> PostPass {
    PostPass {
        shader,
        target: target.map(str::to_owned),
        uniforms: uniforms.as_object().unwrap().clone(),
        textures: textures
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect(),
    }
}
pub fn build_reference_post_plan(
    width: u32,
    height: u32,
    song_ticks: i64,
    ticks_per_second: u64,
    parameters: &Value,
) -> Result<ReferencePostPlan, String> {
    if width < 8 || height < 8 || width > 8192 || height > 8192 {
        return Err("reference post dimensions outside 8..8192".into());
    }
    if song_ticks < 0
        || song_ticks > 9_007_199_254_740_991
        || ticks_per_second == 0
        || ticks_per_second > 1_000_000_000
    {
        return Err("invalid reference post clock".into());
    }
    let mut p = json!({"boil":1.2,"boilFps":12.0,"lutA":0,"lutB":0,"lutBlend":0,"lutMix":0,"exposure":0,"contrast":1,"saturation":1,"lift":[0,0,0],"gain":[1,1,1],"ca":0,"textCa":0,"glitch":0,"zoomBlur":0,"zoomCenter":[0.5,0.5],"bloom":0.35,"bloomThreshold":0.72,"flash":0,"flashColor":[1,1,1],"invert":0,"vignette":0.35,"grain":0.06,"shake":[0,0],"textOpacity":1,"letterbox":0,"fade":0}).as_object().unwrap().clone();
    let input = parameters
        .as_object()
        .ok_or("reference post parameters must be an object")?;
    for key in ["boilSeed", "grainSeed", "glitchSeed"] {
        p.insert(key.into(), json!(0));
    }
    for (key, value) in input {
        let default = p
            .get(key)
            .ok_or_else(|| format!("unknown reference post parameter {key}"))?;
        if let Some(array) = default.as_array() {
            let actual = value.as_array().ok_or("reference post vector required")?;
            if actual.len() != array.len()
                || actual.iter().any(|v| {
                    v.as_f64()
                        .map_or(true, |n| !n.is_finite() || n.abs() > 64.0)
                })
            {
                return Err("invalid reference post vector".into());
            }
        } else if value.as_f64().map_or(true, |n| {
            !n.is_finite() || n.abs() > if key.ends_with("Seed") { 1009.0 } else { 64.0 }
        }) {
            return Err("invalid reference post scalar".into());
        }
        p.insert(key.clone(), value.clone());
    }
    if !input.contains_key("lutB") {
        p.insert("lutB".into(), p["lutA"].clone());
    }
    for key in ["lutA", "lutB"] {
        let n = p[key].as_f64().unwrap();
        if n.fract() != 0.0 || !(0.0..16.0).contains(&n) {
            return Err("LUT row outside 0..15".into());
        }
    }
    for key in [
        "lutBlend",
        "lutMix",
        "glitch",
        "flash",
        "invert",
        "vignette",
        "grain",
        "textOpacity",
        "letterbox",
        "fade",
        "zoomBlur",
    ] {
        let n = p[key].as_f64().unwrap();
        if !(0.0..=1.0).contains(&n) {
            return Err(format!("{key} outside 0..1"));
        }
    }
    for key in [
        "boil",
        "ca",
        "textCa",
        "contrast",
        "saturation",
        "bloom",
        "bloomThreshold",
    ] {
        if p[key].as_f64().unwrap() < 0.0 {
            return Err(format!("negative {key}"));
        }
    }
    let fps = p.remove("boilFps").unwrap().as_f64().unwrap();
    if !(1.0..=64.0).contains(&fps) {
        return Err("boilFps outside 1..64".into());
    }
    let seconds = song_ticks as f64 / ticks_per_second as f64;
    let seed = |rate: f64, modulus: f64| (seconds * rate + 1e-6).floor() % modulus;
    for (key, rate, modulus) in [
        ("boilSeed", fps, 997.0),
        ("glitchSeed", 24.0, 101.0),
        ("grainSeed", 24.0, 1009.0),
    ] {
        if !input.contains_key(key) {
            p.insert(key.into(), json!(seed(rate, modulus)));
        }
        let n = p[key].as_f64().unwrap();
        if n.fract() != 0.0 || n < 0.0 || n >= modulus {
            return Err(format!("invalid {key}"));
        }
    }
    let z = p["zoomCenter"].as_array().unwrap();
    p.insert(
        "zoomCenter".into(),
        json!([z[0], 1.0 - z[1].as_f64().unwrap()]),
    );
    let s = p["shake"].as_array().unwrap();
    p.insert("shake".into(), json!([s[0], -s[1].as_f64().unwrap()]));
    let mut final_u = Map::new();
    for key in [
        "bloom",
        "flash",
        "flashColor",
        "invert",
        "vignette",
        "grain",
        "letterbox",
        "fade",
    ] {
        final_u.insert(key.into(), p.remove(key).unwrap());
    }
    final_u.insert("grainSeed".into(), p.remove("grainSeed").unwrap());
    p.insert("res".into(), json!([width, height]));
    final_u.insert("res".into(), json!([width, height]));
    let threshold = p.remove("bloomThreshold").unwrap();
    let mut targets = vec![PostTarget {
        name: "comp".into(),
        width,
        height,
    }];
    for level in 1..=3 {
        for suffix in ["", "b"] {
            targets.push(PostTarget {
                name: format!("b{level}{suffix}"),
                width: width >> level,
                height: height >> level,
            });
        }
    }
    let pixels: u64 = targets
        .iter()
        .map(|t| t.width as u64 * t.height as u64)
        .sum();
    let allocation_bytes = pixels * 8 + width as u64 * height as u64 * 16 + 256 * 16 * 4;
    if allocation_bytes > MAX_ALLOCATION_BYTES {
        return Err("reference post allocation budget exceeded".into());
    }
    let lut_atlas_required = p["lutMix"].as_f64().unwrap() > 0.0;
    let mut passes = vec![pass(
        "comp",
        Some("comp"),
        Value::Object(p),
        &[
            ("scene", "scene"),
            ("text", "text"),
            ("fg", "fg"),
            ("lut", "lut"),
        ],
    )];
    if final_u["bloom"].as_f64().unwrap() > 0.0 {
        passes.push(pass(
            "bright",
            Some("b1"),
            json!({"thr":threshold}),
            &[("src", "comp")],
        ));
        for level in 1..=3 {
            let a = format!("b{level}");
            let b = format!("b{level}b");
            let w = (width >> level) as f64;
            let h = (height >> level) as f64;
            if level > 1 {
                let prev = format!("b{}", level - 1);
                passes.push(pass(
                    "blur",
                    Some(&a),
                    json!({"dir":[0.5/(width>>(level-1)) as f64,0.5/(height>>(level-1)) as f64]}),
                    &[("src", &prev)],
                ));
            }
            for _ in 0..if level == 1 { 1 } else { 2 } {
                passes.push(pass(
                    "blur",
                    Some(&b),
                    json!({"dir":[1.0/w,0]}),
                    &[("src", &a)],
                ));
                passes.push(pass(
                    "blur",
                    Some(&a),
                    json!({"dir":[0,1.0/h]}),
                    &[("src", &b)],
                ));
            }
        }
    }
    passes.push(pass(
        "final",
        None,
        Value::Object(final_u),
        &[("comp", "comp"), ("b1", "b1"), ("b2", "b2"), ("b3", "b3")],
    ));
    Ok(ReferencePostPlan {
        profile: PROFILE,
        required: true,
        width,
        height,
        song_ticks,
        allocation_bytes,
        lut_atlas_required,
        targets,
        passes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_defaults_and_floor_sized_fifteen_passes() {
        let p = build_reference_post_plan(65, 33, 123456, 120000, &json!({})).unwrap();
        assert_eq!(p.passes.len(), 15);
        assert_eq!(
            p.targets
                .iter()
                .map(|t| (t.width, t.height))
                .collect::<Vec<_>>(),
            vec![
                (65, 33),
                (32, 16),
                (32, 16),
                (16, 8),
                (16, 8),
                (8, 4),
                (8, 4)
            ]
        );
        assert_eq!(
            p.allocation_bytes,
            (65 * 33 + 2 * (32 * 16 + 16 * 8 + 8 * 4)) * 8 + 65 * 33 * 16 + 16384
        );
        let c = &p.passes[0].uniforms;
        assert_eq!(c["boil"], json!(1.2));
        assert_eq!(c["boilSeed"], json!(12.0));
        assert_eq!(c["glitchSeed"], json!(24.0));
        assert!(!p.lut_atlas_required);
        assert_eq!(p.passes[14].uniforms["grainSeed"], json!(24.0));
        assert_eq!(p.passes[4].uniforms["dir"], json!([0.5 / 32.0, 0.5 / 16.0]));
    }
    #[test]
    fn explicit_seeds_coordinate_mapping_and_disabled_bloom() {
        let p=build_reference_post_plan(64,32,9999999,120000,&json!({"bloom":0,"zoomCenter":[0.3,0.2],"shake":[2,3],"lutA":4,"lutMix":0.5,"boilSeed":7,"glitchSeed":8,"grainSeed":9})).unwrap();
        assert_eq!(p.passes.len(), 2);
        assert!(p.lut_atlas_required);
        let c = &p.passes[0].uniforms;
        assert_eq!(c["zoomCenter"], json!([0.3, 0.8]));
        assert_eq!(c["shake"], json!([2, -3.0]));
        assert_eq!(c["lutB"], json!(4));
        assert_eq!(c["boilSeed"], json!(7));
        assert_eq!(p.passes[1].uniforms["grainSeed"], json!(9));
    }
    #[test]
    fn reject_unknown_ranges_clock_dimensions_and_budget() {
        for v in [
            json!({"untrusted":0}),
            json!({"lutA":16}),
            json!({"lutA":0.5}),
            json!({"boilFps":0}),
            json!({"gain":[1,2]}),
            json!({"fade":2}),
            json!({"glitchSeed":101}),
            json!({"bloom":-1}),
            json!({"ca":"1"}),
        ] {
            assert!(build_reference_post_plan(64, 32, 0, 120000, &v).is_err());
        }
        for (w, h, t, r) in [
            (7, 8, 0, 120000),
            (8, 7, 0, 120000),
            (8192, 8192, 0, 120000),
            (64, 32, -1, 120000),
            (64, 32, 0, 0),
            (64, 32, 9007199254740992, 120000),
        ] {
            assert!(build_reference_post_plan(w, h, t, r, &json!({})).is_err());
        }
    }
    #[test]
    fn long_seek_and_fractional_ticks_are_stateless() {
        for ticks in [1, 4999, 5000, 5001, 499999999999i64] {
            let p = build_reference_post_plan(64, 32, ticks, 120000, &json!({})).unwrap();
            let expected = (ticks as f64 / 120000.0 * 24.0 + 1e-6).floor() % 1009.0;
            assert_eq!(p.passes[14].uniforms["grainSeed"], json!(expected));
        }
    }
}
