use super::{model::Ease, post_automation::MAX_KEYS};
use serde_json::{Value, json};

pub fn finishing() -> Value {
    let amount = json!({"type":"number","min":0,"max":1,"required":true});
    json!({
        "availability":"implemented-not-runtime-probed",
        "binding":"post[].effects; role or composite stage",
        "alpha":"color finishing preserves input coverage; lightLeak explicitly selects preserve or expand; black fade is not opacity fade",
        "precision":"straight-alpha encoded sRGB; float within one color group, RGBA8 between surfaces; not reference RGBA16F parity",
        "order":"authored order, never automatically reordered or inserted",
        "effects":{
            "lightLeak":{
                "parameters":{"amount":amount,"alpha":{"type":"enum","values":["preserve","expand"],"required":true},
                    "speed":{"type":"number","min":0,"max":8,"required":false,"default":1},
                    "seedOffset":{"type":"integer","min":0,"max":4294967295u32,"required":false,"default":0}},
                "reference":"meta.js seq overlay lightLeak plus util.js hash/rnds/noise1; not gl.js or a complete seq/memory scene",
                "math":"two ordered moving radial screen gradients, reference warm orange and pink stops",
                "clock":"(songStartSeconds rounded to ticks + outer trimmed source frame time) * speed; child ref/drawingFps do not remap it",
                "seed":"source.seed wrapping_add(seedOffset); reference comparisons must pass this explicit seed",
                "alpha":"expand matches Canvas screen source-over coverage; preserve screens opaque straight RGB then restores exact input alpha",
                "workingSet":"additional reusable RGBA8-equivalent scratch: preserve 2, expand 1; existing 256MiB recipe raster budget unchanged; not a Canvas/RSS hard limit",
                "limitations":"static speed/seedOffset; amount supports existing frame curves and reviewed audio response; no implicit LUT or external timeline processing"},
            "invert":{"parameters":{"amount":amount},"math":"amount + (1 - 2 * amount) * rgb"},
            "flash":{"parameters":{"amount":amount,"color":{"type":"rgb","length":3,"min":0,"max":1,"required":true}},
                "math":"(1 - amount) * rgb + amount * color; not screen/additive blend"},
            "fade":{"parameters":{"amount":amount},"math":"(1 - amount) * rgb; alpha unchanged"},
            "letterbox":{"parameters":{"amount":amount,"heightFraction":{"type":"number","min":0,"max":0.5,"required":true,"unit":"per-side fraction of output height"}},
                "math":"blacken existing coverage outside pixel-center bounds; heightFraction * amount per side",
                "reference":"0.1203 heightFraction matches the reference constant, not exact 2.39:1"},
            "quantizationDither":{"parameters":{"amount":amount},
                "math":"static common-RGB integer-hash noise; amount / 255 total span before color-group quantization",
                "clock":"source.seed and integer pixel only; no frame sampling",
                "limitations":"not Bayer color reduction or frame grain; place after fractional color operations in the same color group; not reference float-hash pixel parity"}
        },
        "automation":{
            "version":1,"binding":"post[].automation",
            "shape":"{effect: zero-based index, keyframes: [{frame, value, easing}]}",
            "targets":"amount-bearing effects only; no grade/palette; at most one curve per effect",
            "maxCurves":8,"maxKeyframes":MAX_KEYS,
            "frames":"strictly increasing integer source frames in [0,durationFrames]; duration endpoint allowed",
            "values":"finite, within the target effect amount bounds",
            "clock":"outer source frame after clip trim; child ref and drawingFps do not remap it",
            "interpolation":"easing of departing key; hold before first and after last; one key is a constant",
            "order":"curve replaces static amount -> audio delta -> clamp -> finishing lowering",
            "easings":[Ease::Linear,Ease::InOutSine,Ease::InOutCubic,Ease::InExpo,Ease::OutExpo,Ease::InOutExpo,Ease::InQuad,Ease::OutQuad]
        }
    })
}
