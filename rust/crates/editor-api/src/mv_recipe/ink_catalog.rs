use serde_json::{Value, json};
pub(super) fn entry() -> Value {
    json!({"requires":["native-html-canvas-2d","declared-image-resource"],
        "binding":"scene.settings plus explicit role/span; no variants and no bundled artwork",
        "parameters":{
            "char":{"type":"resource","kind":"image"},
            "seed":{"type":"number","integer":true,"min":0,"max":4294967295u64,"required":false,"suggested":7,"fallback":"original seed||7: zero and omission select7; source.seed is not added"},
            "h":{"type":"number","integer":false,"min":1,"max":8192,"required":false,"suggested":880},
            "x":{"type":"number","integer":false,"min":-8192,"max":8192,"required":false,"suggested":960},
            "y":{"type":"number","integer":false,"min":-8192,"max":8192,"required":false,"suggested":992},
            "beats":{"type":"union","variants":[{"type":"object","kind":"manual","songTicks":{"type":"array","minItems":1,"maxItems":21600,"unit":"source ticks at120000Hz","strictlyIncreasing":true}},{"type":"object","kind":"analysis"}],"suggested":{"kind":"manual","songTicks":[0,60000,120000,180000]}},
            "bpm":{"type":"number","integer":false,"min":1,"max":1000,"suggested":120},
            "downbeatIndex0":{"type":"number","integer":true,"min":0,"max":4294967295u64,"suggested":0}
        },
        "clock":"Whole-song12Hz ink growth/breathe; original64-step beat-lurch, continuous whole-song fog and shot-progress camera; no stop/vocal response",
        "response":"Nine authored crozier tendrils and seeded branches, back/front leg helix,21gooey pools, density mottling, original half/quarter bleeds, full-resolution shaded character/warm inner-rim, vignette",
        "constraints":["empty beats reject: original at() has no finite anchor","character dimensions measured from declared image bytes; no implicit reference artwork","all original layers retained; final output scaling only","4096expanded graph limit and67108864pixel-equivalent graph cap unchanged;1MiB plan admission"]})
}
