use serde_json::{Value, json};
fn number(min: f64, max: f64, suggested: f64) -> Value {
    json!({"type":"number","min":min,"max":max,"integer":false,"suggested":suggested})
}
fn optional(mut v: Value) -> Value {
    v["required"] = json!(false);
    v
}
pub(super) fn entry() -> Value {
    let time = number(0.0, 21600.0, 0.0);
    json!({
        "requires":["native-html-canvas-2d","declared-image-resource"],
        "binding":"scene.settings plus explicit role/span; complete original scene, no variants/bundled artwork",
        "parameters":{
            "beats":{"type":"union","variants":[{"type":"object","kind":"manual","songTicks":{"type":"array","minItems":0,"maxItems":21600,"unit":"source ticks at120000Hz","strictlyIncreasing":true}},{"type":"object","kind":"analysis"}],"suggested":{"kind":"manual","songTicks":[0,60000,120000,180000]}},
            "char":{"type":"resource","kind":"image"},
            "freeze":{"type":"array","required":false,"minItems":0,"maxItems":4096,"items":{"type":"tuple","items":[time.clone(),time.clone()]},"suggested":[],"coordinate":"source-audio-seconds","fallback":"global reviewed overlapping kind=stop; [] explicitly overrides; order/overlap retained"},
            "pulse":{"type":"array","required":false,"minItems":0,"maxItems":64,"items":time,"suggested":[],"coordinate":"source-audio-seconds","fallback":"first selected freeze end minus0.04; [] suppresses default"},
            "vp":optional(json!({"type":"tuple","items":[number(-8192.0,8192.0,1040.0),number(-8192.0,8192.0,84.0)]})),
            "speed":optional(number(0.0,8.0,1.0)),"h":optional(number(1.0,8192.0,940.0))
        },
        "clock":"original interval-sum held time; held camera/distance/beat;12fps hair/ribbon; full-rate dawn pulses/rings; first freeze sets held kick",
        "response":"abyss and quarter-size soft cone, dawn square/rings,176depth streaks,40stretched bokeh,31-call lit character hairWarp and four per-strip rim passes, tapered9-fibre ribbon,60foreground motes,7filtered streaks and vignette; no grain",
        "constraints":["fixed1/120 midpoint integration preserves repeated binary64 addition and fractional last step; no temporal cache",
            "image facts required before any frame ticket, including hidden shots; max4096 dimensions and nonzero rounded hair split",
            "native1920x1080 scene; final-only output scaling;64x512 streak sprite uses direct filtered fillRect",
            "1024commands/12000path steps/1MiB plan; existing67108864pixel-unit and80000000expanded simulation caps unchanged"]
    })
}
