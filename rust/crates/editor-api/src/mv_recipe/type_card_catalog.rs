use super::rules::*;
use crate::mv_recipe::catalog::NumberRule;
use serde_json::{Value, json};
#[path = "type_card_catalog_flicker.rs"]
mod flicker;
#[path = "type_card_catalog_quiet.rs"]
mod quiet;

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite TypeCard rule");
    value["type"] = json!("number");
    value["unit"] = json!(unit);
    value
}
fn rgba() -> Value {
    json!({"type":"rgba","length":4,"min":0,"max":1,"suggested":[0.8,0.9,1,1]})
}
fn text(max: usize, value: &str) -> Value {
    json!({"type":"text","minLength":1,"maxLength":max,"maxUtf8Bytes":max*4,
        "lengthUnit":"unicode-scalars","controlCharacters":false,"suggested":value})
}
fn font() -> Value {
    json!({"type":"resource","kind":"font"})
}
fn tuple(items: Vec<Value>) -> Value {
    json!({"type":"tuple","items":items})
}
fn point() -> Value {
    tuple(vec![
        number(POSITION, "frame-width"),
        number(POSITION, "frame-height"),
    ])
}
fn rect() -> Value {
    tuple(vec![
        number(POSITION, "frame-width"),
        number(POSITION, "frame-height"),
        number(EXTENT, "frame-width"),
        number(EXTENT, "frame-height"),
    ])
}
fn array(items: Value, min: usize, max: usize, suggested: Value) -> Value {
    json!({"type":"array","minItems":min,"maxItems":max,"items":items,"suggested":suggested})
}
fn enumeration(options: &[&str], suggested: &str) -> Value {
    json!({"type":"enum","options":options,"suggested":suggested})
}
pub(super) fn suggestion(field: &Value) -> Value {
    if field["type"] == "resource" {
        json!("fixture-font")
    } else if field["type"] == "tuple" {
        Value::Array(
            field["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(suggestion)
                .collect(),
        )
    } else {
        field["suggested"].clone()
    }
}
fn object(properties: Value) -> Value {
    let suggested: Value = properties
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), suggestion(v)))
        .collect();
    json!({"type":"object","properties":properties,"additionalProperties":false,"suggested":suggested})
}
fn nullable(value: Value) -> Value {
    json!({"type":"nullable","item":value,"suggested":value["suggested"],"required":true})
}
fn line(label: &str) -> Value {
    object(
        json!({"font":font(),"text":text(MAX_TEXT,label),"position":point(),
        "fontSize":number(SIZE,"frame-height"),"tracking":number(TRACKING,"frame-height"),"color":rgba()}),
    )
}
pub(in crate::mv_recipe) fn catalog_entry() -> Value {
    json!({
        "requires":["canvas-worker-2d","declared-font-resource"],
        "binding":"scene.settings plus role/span; select exactly one mode schema from variants; all its fields required, nullable fields must be explicitly present",
        "parameters":{"mode":enumeration(&["quiet","flicker"],"quiet")},
        "variants":{"quiet":{"parameters":quiet::parameters()},"flicker":{"parameters":flicker::parameters()}},
        "clock":"span-local clamped seconds; ref remaps source time; grain at source song 24Hz and glitch at 15Hz; no wall clock",
        "coordinates":"x/rect width use frame-width; y/rect height and other sizes use frame-height; quiet.gap alone uses base font-size units",
        "fontMetrics":{"mode":"quiet","profile":"100px-center-middle-zero-letter-spacing","fields":["left","right","ascent","descent"],
            "identity":"full declared font resource including digest/style/weight/axes","maxUniqueGlyphs":1024,
            "scope":"all quiet nodes, stable font-ID and Unicode-scalar deduplication, independent of current frame and ref",
            "policy":"runtime verified platform input only, never authored metrics; missing metrics reject quiet evaluation"},
        "response":"quiet optical ink layout/blur/drift/creeping rule/end ticks/subtitle; flicker four beat layouts/CRT collapse/RGB splits/scan erasure/seeded slices and blocks/Morse/white flood/negative",
        "alpha":"authored RGBA alpha multiplies fixed gains: rule .95 and ticks .85, subtitle .42, kickGlow .3, flood stop gains 2/1.3/.5; label/negative/noise/white use authored base alpha",
        "seed":"source.seed wraps into grain seed+4242 and offset channels+1/+2; glitch rng(hash(source15HzIndex,seed+91)); seed zero matches reference",
        "budgets":{"drawingOperations":16,"primitives":"quiet glyphs+3+subtitle scalars; flicker 360 scanlines+108 bands+16 blocks+8+Morse elements/label+negative scalars+max layout RGB scalars; add256 for grain; repeated DAG visits charged",
            "scratch":"4 full-frame buffers plus2 grain tiles; expanded plan work*128 RGBA-equivalent pixels plus9 grain tiles per visit for three-realm clones/serialization; admission estimate, not total RSS hard limit"},
        "limitations":["one scalar per quiet glyph, no implicit kana scale rules or reference text","font coverage remains author responsibility",
            "flicker input analysis requires the recipe's reviewed analysis binding; manual beats are explicit author data, not measured evidence",
            "reference 45ms shot-beat window/start snapping and last-four layout selection, including fewer than four beats",
            "reference cardPost/gl.js finishing is not silently injected; use explicit recipe post",
            "screen grain and white flood can cover transparent background; alpha support is not transparent-codec acceptance"]
    })
}
