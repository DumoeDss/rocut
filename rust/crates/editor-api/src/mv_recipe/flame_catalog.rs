use serde_json::{Value, json};
fn number(min: f64, max: f64, value: f64) -> Value {
    json!({"type":"number","min":min,"max":max,"integer":false,"suggested":value})
}
pub(super) fn entry() -> Value {
    let seconds = json!({"type":"number","min":0,"max":21600,"unit":"source-audio-seconds","required":false,"suggested":null});
    json!({
        "requires":["native-html-canvas-2d","declared-image-resource","rust-flame-image-preprocessing"],
        "binding":"scene.settings plus explicit role/span; full reference breathe/grow/dark, no bundled artwork",
        "parameters":{
            "mode":{"type":"enum","options":["breathe","grow","dark"],"required":false,"suggested":"breathe"},
            "beats":{"type":"union","variants":[{"type":"object","kind":"manual","songTicks":{"type":"array","maxItems":21600,"unit":"120000Hz whole-song ticks","strictlyIncreasing":true}},{"type":"object","kind":"analysis"}],"suggested":{"kind":"manual","songTicks":[0,60000,120000,180000]}},
            "bpm":number(1.0,1000.0,120.0),"downbeatIndex0":{"type":"number","min":0,"max":4294967295u64,"integer":true,"suggested":0},
            "img":{"type":"resource","kind":"image","required":false,"suggested":"assets/char/flame_hands.png"},
            "face":{"type":"resource","kind":"image","required":false,"suggested":"assets/char/bust_calm.png"},
            "flameAt":{"type":"tuple","required":false,"items":[number(0.0,8192.0,588.0),number(0.0,8192.0,632.0),number(0.0,8192.0,662.0),number(0.0,8192.0,150.0),number(0.0,8192.0,235.0),number(0.0,8192.0,46.0)],"unit":"material pixels [coreX,coreY,baseY,maskRx,maskRy,coreR]"},
            "stops":{"type":"array","required":false,"maxItems":4096,"suggested":[],"items":{"type":"tuple","items":[seconds.clone(),seconds.clone()]},"coordinate":"source-audio-seconds","fallback":"breathe uses global kind=stop overlapping full shot; explicit[] overrides; grow ignores stops; dark explicit stops extinguish, global near-shot stops independently infer ignition"},
            "zoomAt":seconds.clone(),"igniteAt":seconds,
            "zoomTo":{"type":"number","required":false,"min":1,"max":64,"suggested":16},
            "h":{"type":"number","required":false,"min":1,"max":4096,"suggested":1190},
            "faceAt":{"type":"tuple","items":[number(-8192.0,8192.0,430.0),number(-8192.0,8192.0,330.0)],"required":false},
            "facePos":{"type":"tuple","items":[number(-8192.0,8192.0,930.0),number(-8192.0,8192.0,410.0)],"required":false},
            "vocal":{"type":"enum","options":["analysis","zero"],"required":false,"suggested":"analysis","fallback":"breathe requires measured vocal; explicit zero opts out; no generic Signal policy changes"}
        },
        "clock":"whole-song time for camera/light/particles; floor(t*12+1e-6)/12 for tongues/hair; stops never freeze motion; grow beatSteps keeps original64-iteration guard",
        "response":"painted flame RGB inpaint with3mask dilations and220row-major in-place Float32 iterations; three feathered crop edges; five whole-path colour layers; fully lit fingertips; sparks/vocal/zoom white; dark dual heartbeat/multiply/36rounded +1 hair columns and per-draw blur",
        "constraints":["full declaration/decoded dimensions/six flameAt/algorithm own opaque patch identity; no authored pixel facts",
            "actual mask work admitted before float allocation; aggregate100000000channel updates; no downscale or iteration reduction",
            "existing256MiB joint recipe/raster cap; full-image readback, ROI, transport/cache copies and lifetimes charged",
            "1024commands/12000path steps/1MiB plan and copy budget; no fonts",
            "native1920x1080 composition, only final output scaling; original/alt landmark special cases apply only exact logical resource ids"]
    })
}
