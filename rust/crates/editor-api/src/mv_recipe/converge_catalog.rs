use super::{MAX_BEATS, MAX_SAFE_TICKS};
use serde_json::{Value, json};

fn object(properties: Value) -> Value {
    let suggested: Value = properties
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| (key.clone(), value["suggested"].clone()))
        .collect();
    json!({"type":"object","properties":properties,"additionalProperties":false,"suggested":suggested})
}
pub(in crate::mv_recipe) fn catalog_entry() -> Value {
    let color = json!({"type":"rgba","length":4,"min":0,"max":1,"suggested":[0.3,0.5,0.8,1]});
    let background = json!({"type":"array","minItems":3,"maxItems":3,"items":color,
        "suggested":[[0.01,0.01,0.03,1],[0.03,0.02,0.05,1],[0.01,0.01,0.03,1]]});
    let palette = object(
        json!({"background":background,"shadow":color,"dusk":color,"verm":color,
        "sunset":color,"glow":color,"hi":color,"core":color,
        "shard":object(json!({"body":color,"rim":color,"edge":color})),
        "firefly":object(json!({"body":color,"core":color,"edge":color})),"white":color}),
    );
    let tick = json!({"type":"number","min":0,"max":MAX_SAFE_TICKS,"integer":true,"unit":"song-ticks","suggested":0});
    let manual = object(
        json!({"kind":{"type":"enum","options":["manual"],"suggested":"manual"},
        "songTicks":{"type":"array","minItems":0,"maxItems":MAX_BEATS,"items":tick,"suggested":[0,60000,120000,180000]}}),
    );
    let analysis =
        object(json!({"kind":{"type":"enum","options":["analysis"],"suggested":"analysis"}}));
    json!({"requires":["canvas-worker-2d"],"binding":"scene.settings plus explicit role/span; every field required",
        "parameters":{"seed":{"type":"number","min":0,"max":u32::MAX,"integer":true,"suggested":1},
            "whiteAtTicks":{"type":"number","min":1,"max":MAX_SAFE_TICKS,"integer":true,"unit":"absolute-song-ticks","suggested":240000},
            "beats":{"type":"union","variants":[manual,analysis],"suggested":manual["suggested"]},
            "grain":{"type":"number","min":0,"max":1,"suggested":0.07},"palette":palette},
        "constraints":["whiteAtTicks strictly after songStartTicks+span.startFrame*ticksPerFrame; may exceed span end",
            "manual beats strictly increasing safe nonnegative integer song ticks; empty manual list is explicit synthetic extrapolation",
            "analysis requires the recipe reviewed audio binding; no audio download or new analysis"],
        "clock":"absolute source song time; ref remaps source time; trim maps once to source frame ticks; no wall clock",
        "beats":"first8 at/after shotStart-90ms, then original460ms extrapolation and <whiteAt-50ms filter; pulse exp(-8*since) uses only complete real beat list",
        "seed":"settings.seed wrapping-added to source.seed; zero is real zero, never substituted; original fixed channels and grain seeds900..903 stay fixed",
        "response":"6 logarithmic arms/beat rings/90 inward streaks/9 four-pass threads/34 glass shards/140 fireflies+embers/noisy ember+anamorphic streak/core glow/overlay grain/white-out",
        "coordinates":"1920x1080 design space; Rust outputs output-pixel base CTMs plus ordered native translate/rotate/scale raster operations; grain and white fill are identity screen-space",
        "alpha":"palette alpha multiplies clamped reference gain; source-over/lighter and grain overlay preserve ordered painting",
        "budgets":{"drawingOperations":16,"generatorPrimitives":3756,"scope":"expanded DAG, including repeated references",
            "plan":"3500 paint upper bound plus256 grain work; work*512 RGBA-equivalent pixels plus9 grain tiles; grain scratch2 tiles"},
        "limitations":["no implicit original-song palette or cues","reference finishing is not injected; author recipe.post explicitly",
            "grain is opaque grayscale overlay, not screen grain","no font or image resources required"]})
}
