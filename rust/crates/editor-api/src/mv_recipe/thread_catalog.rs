use serde_json::{Value, json};
fn number(min: f64, max: f64, value: f64) -> Value {
    json!({"type":"number","min":min,"max":max,"integer":false,"suggested":value})
}
fn optional(mut v: Value) -> Value {
    v["required"] = json!(false);
    v
}
fn tuple(x: Value, y: Value) -> Value {
    json!({"type":"tuple","items":[x,y]})
}
pub(super) fn entry() -> Value {
    let time = number(0.0, 21600.0, 0.0);
    let manual = json!({"kind":"manual","songTicks":[0,60000,120000,180000]});
    json!({
        "requires":["native-html-canvas-2d","declared-image-resource"],
        "binding":"scene.settings plus explicit role/span; no variants and no bundled artwork",
        "parameters":{
            "beats":{"type":"union","variants":[{"type":"object","kind":"manual","songTicks":{"type":"array","minItems":0,"maxItems":21600,"unit":"source ticks at 120000Hz","strictlyIncreasing":true}},{"type":"object","kind":"analysis"}],"suggested":manual},
            "bpm":number(1.0,1000.0,120.0),
            "downbeatIndex0":{"type":"number","integer":true,"min":0,"max":4294967295u64,"suggested":0},
            "hand":{"type":"resource","kind":"image"},
            "light":optional(tuple(number(-8192.0,8192.0,1700.0),number(-8192.0,8192.0,250.0))),
            "stops":{"type":"array","required":false,"minItems":0,"maxItems":4096,"items":tuple(time.clone(),time.clone()),"suggested":[],"coordinate":"source-audio-seconds","order":"retained, including overlapping intervals","fallback":"global reviewed stops kind=stop overlapping the full shot; explicit [] overrides global"},
            "kickAt":{"type":"union","required":false,"variants":[time.clone(),{"type":"const","value":null}],"suggested":null},
            "arriveAt":{"type":"union","required":false,"variants":[time,{"type":"const","value":null}],"suggested":null},
            "handRot":optional(number(-32.0,32.0,0.1)),
            "handH":optional(number(1.0,8192.0,1120.0)),
            "handX":optional(number(-8192.0,8192.0,150.0)),
            "handY":optional(number(-8192.0,8192.0,1200.0))
        },
        "clock":"original held-time sum without interval merging; hand/path at12fps, full-rate camera/light/particles; beat pulse samples held quantized song time",
        "response":"violet gradients, seeded tileable nebula, parallax dust, shaded hand and warm rim, growing tapered ribbon with12frayed fibres and two soft glows, tug, motes, light streaks, bokeh and vignette",
        "constraints":["start<end for every stop; source seconds not quantized to frames; preserve input order",
            "empty beat evidence requires explicit arriveAt; default arrival does not fabricate beats",
            "hand dimensions measured from the complete declared resource before a frame ticket, including hidden shots",
            "native1920x1080 scene and original480x270/960x540glow surfaces; output scaling only at final blit",
            "existing67108864pixel-equivalent graph cap unchanged;1024commands/12000path steps/1MiB plan cap; measured image/rim/filter live budget"]
    })
}
