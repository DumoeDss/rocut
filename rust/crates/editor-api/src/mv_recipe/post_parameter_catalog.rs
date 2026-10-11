//! Presentation schemas for the original finishing effects. Admission remains
//! Effect::valid; focused parity tests keep this public metadata exact.
use serde_json::{Value, json};

fn number(min: f64, max: f64) -> Value {
    json!({"type":"number","min":min,"max":max,"required":true})
}

fn integer(min: u32, max: u32) -> Value {
    json!({"type":"number","integer":true,"min":min,"max":max,"required":true})
}

fn tuple(items: Vec<Value>) -> Value {
    json!({"type":"tuple","items":items,"required":true})
}

pub(super) fn effects() -> Value {
    let amount = number(0.0, 1.0);
    let fps = integer(1, 120);
    let center = tuple(vec![number(0.0, 1.0); 2]);
    // Palette colors are opaque RGBA, not arbitrary RGBA. A tuple expresses
    // the alpha==1 constraint without leaving it in prose-only metadata.
    let opaque_color = tuple(vec![
        number(0.0, 1.0),
        number(0.0, 1.0),
        number(0.0, 1.0),
        number(1.0, 1.0),
    ]);
    json!({
        "grade":{"parameters":{
            "exposure":number(-8.0,8.0),"contrast":number(0.0,4.0),
            "saturation":number(0.0,4.0),"lift":tuple(vec![number(-1.0,1.0);3]),
            "gain":tuple(vec![number(0.0,4.0);3])}},
        "palette":{"parameters":{
            "colors":{"type":"array","minItems":2,"maxItems":16,"items":opaque_color,"required":true},
            "mix":amount}},
        "vignette":{"parameters":{"amount":amount}},
        "grain":{"parameters":{"amount":amount,"fps":fps}},
        "lineBoil":{"parameters":{"amount":number(0.0,32.0),"cellSize":number(4.0,256.0),"fps":fps}},
        "glitch":{"parameters":{"amount":amount,"bands":integer(2,256),"fps":fps}},
        "chromaticAberration":{"parameters":{"amount":number(0.0,64.0),"center":center}},
        "zoomBlur":{"parameters":{"amount":amount,"center":center}},
        "bloom":{"parameters":{"amount":number(0.0,4.0),"threshold":number(0.0,1.0),
            "radius":number(1.0,64.0),"alpha":{"type":"enum","options":["preserve","expand"],"required":true}}}
    })
}

#[cfg(test)]
#[path = "post_catalog_tests.rs"]
mod tests;
