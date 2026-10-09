use crate::mv_recipe::catalog::NumberRule;
pub(super) use crate::mv_recipe::catalog::OPACITY;
use serde_json::{Value, json};

const fn rule(min: f64, max: f64, suggested: f64) -> NumberRule {
    NumberRule {
        min,
        max,
        suggested,
        integer: false,
    }
}
pub(super) const POSITION: NumberRule = rule(-2.0, 3.0, 0.5);
pub(super) const EXTENT: NumberRule = rule(0.001, 4.0, 0.3);
pub(super) const SIZE: NumberRule = rule(0.001, 2.0, 0.2);
pub(super) const TRACKING: NumberRule = rule(-0.1, 0.2, 0.005);
pub(super) const TIME_SCALE: NumberRule = rule(0.1, 4.0, 1.0);
pub(super) const MOTION_SCALE: NumberRule = rule(0.0, 4.0, 1.0);
pub(super) const MAX_TITLE: usize = 16;
pub(super) const MAX_TEXT: usize = 256;

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite afterimage rule");
    value["type"] = json!("number");
    value["unit"] = json!(unit);
    value
}
fn tuple(items: Vec<Value>) -> Value {
    json!({"type":"tuple","items":items})
}
fn position() -> Value {
    tuple(vec![
        number(POSITION, "frame-width"),
        number(POSITION, "frame-height"),
    ])
}
fn text(max: usize, suggested: &str) -> Value {
    json!({"type":"text","minLength":1,"maxLength":max,"maxUtf8Bytes":max*4,
        "lengthUnit":"unicode-scalars","controlCharacters":false,"suggested":suggested})
}
fn rgba(suggested: [f64; 4]) -> Value {
    json!({"type":"rgba","min":0,"max":1,"length":4,"suggested":suggested})
}
fn object(properties: Value) -> Value {
    let suggested: Value = properties
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| {
            let suggestion = if value["type"] == "tuple" {
                Value::Array(
                    value["items"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v["suggested"].clone())
                        .collect(),
                )
            } else if value["type"] == "resource" {
                json!(format!("fixture-{}", value["kind"].as_str().unwrap()))
            } else {
                value["suggested"].clone()
            };
            (key.clone(), suggestion)
        })
        .collect();
    json!({"type":"object","properties":properties,"additionalProperties":false,"suggested":suggested})
}
fn line(credit: bool) -> Value {
    let mut fields = json!({"font":{"type":"resource","kind":"font"},
        "text":text(MAX_TEXT, if credit {"CREDITS"} else {"AFTERIMAGE"}),"position":position(),
        "fontSize":number(SIZE,"frame-height"),"tracking":number(TRACKING,"frame-height"),
        "opacity":number(OPACITY,"ratio")});
    if credit {
        fields["color"] = rgba([0.7, 0.8, 0.9, 1.0]);
    }
    object(fields)
}
pub(in crate::mv_recipe) fn catalog_entry() -> Value {
    let glyph = object(
        json!({"text":text(1,"A"),"center":position(),"fontSize":number(SIZE,"frame-height")}),
    );
    json!({
        "requires":["canvas-worker-2d","declared-image-resource","declared-font-resource"],
        "binding":"scene.settings plus scene.role and scene.span; all nested fields required",
        "clock":"span-relative seconds; timeScale multiplies elapsed and span duration; ref remaps all source time, including grain",
        "parameters":{
            "cutout":object(json!({"image":{"type":"resource","kind":"image"},"rect":tuple(vec![number(POSITION,"frame-width"),number(POSITION,"frame-height"),number(EXTENT,"frame-width"),number(EXTENT,"frame-height")])})),
            "titleFont":{"type":"resource","kind":"font"},
            "glyphs":{"type":"array","minItems":1,"maxItems":MAX_TITLE,"items":glyph,"suggested":[glyph["suggested"]]},
            "circle":object(json!({"center":position(),"radius":number(SIZE,"frame-height")})),
            "subtitle":line(false),"credit":line(true),
            "color":rgba([0.3,0.9,0.9,1.0]),"fringeColor":rgba([0.1,0.3,0.9,1.0]),"background":rgba([0.0,0.0,0.0,1.0]),
            "grain":number(OPACITY,"overlay-alpha"),"timeScale":number(TIME_SCALE,"ratio"),"motionScale":number(MOTION_SCALE,"ratio")
        },
        "layout":{"x":"frame-width","yAndSizes":"frame-height","cutout":"destination-out explicit rect; author preserves source aspect ratio",
            "glyphs":"actual ink-box center measured at 1000px, left/alphabetic; one Unicode scalar each",
            "text":"single-line center/middle with Canvas letterSpacing; declared font metadata controls family/style/weight"},
        "raster":"white circle minus cutout, then white title/subtitle; sharp tint; independent half/quarter/eighth-resolution blur; additive fringe/sharp/mid/soft/halo; grain overlay then credit",
        "response":"fixed cubic-bezier(.16,1,.3,1) rise, exponential decay, seeded smooth noise, 1.55s blink, tail fade, diffusion and credit fade; motionScale changes only drift/rotation/scale increment",
        "seed":"source.seed wraps into noise seed+91, grain seeds+900..903 and offset channels+1/+2; seed zero reproduces reference seeds",
        "budgets":{"drawingOperations":8,"primitives":"7 + title glyphs + subtitle scalars + credit scalars + 256 if grain>0; charged per expanded DAG visit",
            "scratch":"4 full-frame RGBA surfaces (or exact rounded tiny-raster bound) + 2 256x256 grain tiles transient; plus 9 256x256 RGBA-equivalent grain payload tiles per expanded DAG visit for host/iframe/Worker clones and serialization; existing 64M-pixel admission cap applies, not a total-process RSS hard limit"},
        "limitations":["no implicit words, fonts, colors or placement","glyph coverage is author's responsibility",
            "small rasters clamp each dimension to at least 1 pixel; integer dimensions floor division",
            "fixed 256x256 grain tile; not audio-reactive; not an input-scene post filter"]
    })
}
