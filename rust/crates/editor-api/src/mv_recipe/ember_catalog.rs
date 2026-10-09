use super::{MAX_BEATS, MAX_CUES, MAX_KEYS, MAX_SAFE_TICKS, MAX_TITLE};
use serde_json::{Value, json};

fn number(min: f64, max: f64, integer: bool, suggested: f64) -> Value {
    let suggested = if integer {
        json!(suggested as u64)
    } else {
        json!(suggested)
    };
    json!({"type":"number","min":min,"max":max,"integer":integer,"suggested":suggested})
}
fn choice(options: &[&str], suggested: &str) -> Value {
    json!({"type":"enum","options":options,"suggested":suggested})
}
fn tick(suggested: u64) -> Value {
    json!({"type":"number","min":0,"max":MAX_SAFE_TICKS,"integer":true,"unit":"absolute-song-ticks","suggested":suggested})
}
fn object(properties: Value) -> Value {
    let suggested: Value = properties
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                if value["type"] == "resource" {
                    json!(format!("fixture-{}", value["kind"].as_str().unwrap()))
                } else {
                    value["suggested"].clone()
                },
            )
        })
        .collect();
    json!({"type":"object","properties":properties,"additionalProperties":false,"suggested":suggested})
}
fn array(items: Value, min: usize, max: usize, suggested: Value) -> Value {
    json!({"type":"array","items":items,"minItems":min,"maxItems":max,"suggested":suggested})
}
fn union(variants: Vec<Value>) -> Value {
    let suggested = variants[0]["suggested"].clone();
    json!({"type":"union","variants":variants,"suggested":suggested})
}
fn beats() -> Value {
    union(vec![
        object(
            json!({"kind":choice(&["manual"],"manual"),"songTicks":array(tick(0),0,MAX_BEATS,json!([0,60000,120000,180000]))}),
        ),
        object(json!({"kind":choice(&["analysis"],"analysis")})),
    ])
}
fn palette() -> Value {
    let color = json!({"type":"rgba","length":4,"min":0,"max":1,"suggested":[0.8,0.45,0.2,1]});
    let background = json!({"type":"rgba","length":4,"min":0,"max":1,"suggested":[0,0,0,1]});
    object(
        json!({"background":background,"aura":color,"dusk":color,"verm":color,"sunset":color,"glow":color,"hi":color,"core":color}),
    )
}
fn hud() -> Value {
    object(json!({"font":{"type":"resource","kind":"font"},
    "title":{"type":"text","minLength":1,"maxLength":MAX_TITLE,"lengthUnit":"unicode-scalars","controlCharacters":false,"suggested":"EMBER"},
    "clock":object(json!({"hour":number(0.0,99.0,true,0.0),"minute":number(0.0,99.0,true,0.0),"fps":number(1.0,120.0,true,30.0)}))}))
}
fn intervals() -> Value {
    array(
        json!({"type":"tuple","items":[tick(0),tick(12000)]}),
        0,
        MAX_CUES,
        json!([]),
    )
}
fn parameters(mode: &str) -> Value {
    let mut common =
        json!({"mode":choice(&[mode],mode),"palette":palette(),"grain":number(0.0,1.0,false,0.07)});
    if mode != "collapse" {
        common["beats"] = beats();
        common["hud"] = hud();
        common["stopsTicks"] = intervals();
    }
    match mode {
        "breathe" => {
            common["flaresTicks"] = intervals();
            common["thumpsTicks"] = array(tick(0), 0, MAX_CUES, json!([]));
        }
        "ignite" => {
            common["blackFrom"] = union(vec![
                object(json!({"kind":choice(&["lastBeat"],"lastBeat")})),
                object(json!({"kind":choice(&["at"],"at"),"songTicks":tick(240000)})),
            ]);
            common["crackAtTicks"] = tick(120000);
            common["ring"] = number(1.0, 1000.0, false, 176.0);
            common["seed"] = number(0.0, f64::from(u32::MAX), true, 5.0);
        }
        _ => {
            common["image"] = json!({"type":"resource","kind":"image"});
            common["focus"] = json!({"type":"tuple","items":[number(-4096.0,4096.0,false,0.0),number(-4096.0,4096.0,false,0.0)]});
            common["endTicks"] = tick(240000);
            let key = object(
                json!({"songTicks":tick(0),"factor":number(0.0,1.0,false,1.0),"easing":choice(&["out","in","io","soft","whip"],"out"),"hit":{"type":"boolean","suggested":false}}),
            );
            let values = json!([{"songTicks":0,"factor":1,"easing":"out","hit":false},{"songTicks":120000,"factor":0.7,"easing":"soft","hit":true},{"songTicks":180000,"factor":0.003,"easing":"in","hit":true}]);
            common["keys"] = union(vec![
                object(
                    json!({"kind":choice(&["manual"],"manual"),"values":array(key,3,MAX_KEYS,values)}),
                ),
                object(json!({"kind":choice(&["analysis"],"analysis"),"beats":beats()})),
            ]);
        }
    }
    common
}
pub(in crate::mv_recipe) fn catalog_entry() -> Value {
    json!({"requires":["canvas-worker-2d"],"binding":"scene.settings plus explicit role/span; select a mode variant; all listed fields required",
        "parameters":{"mode":choice(&["breathe","ignite","collapse"],"breathe")},
        "variants":{"breathe":{"parameters":parameters("breathe")},"ignite":{"parameters":parameters("ignite")},"collapse":{"parameters":parameters("collapse")}},
        "clock":"absolute song seconds after source/ref remap; positive shot start does not rebase breathe fade; all authored cues use 120000Hz song ticks",
        "constraints":["stops and flares require increasing endpoints, may overlap, max32 each; stops are half-open and flare response is max not sum",
            "manual beats strictly increasing, up to4096; empty is explicit460ms visual extrapolation, not measured beat facts",
            "collapse end must follow shot start; manual keys3..64 preserve input order, adjacent times must differ, third time precedes end; no sorting of automatic onset/fallback keys",
            "blackFrom at must follow shot start; lastBeat uses last beat strictly before end-50ms else end-460ms",
            "automatic keys require reviewed strongOnsets reference-onset-residual-p99-v1; missing rejects, analyzed empty permits reference fallback; raw candidates never substitute",
            "all mode dependencies validated across the whole source even while hidden, stopped or black"],
        "audio":"breathe/ignite require reviewed measured envelopes with makeEnv endpoint-clamping; legally absent vocal_rms maps to0, never mix; manual collapse requires no analysis",
        "fontMetrics":"HUD complete prefix advances at22px tracking0, full resource digest/style/weight/axes identity; scalar typing; uppercase macron bars use measured O and prefix widths; lowercase macron only substitutes o",
        "timecode":"explicit clock.hour/minute/fps; minute increases without rollover exactly as reference; no wall-clock input",
        "image":"collapse requires actual verified decoded dimensions; cover and independent clip CTMs are native plans; missing image is an error even at zero iris",
        "coordinates":"1920x1080 design space; ordered native transforms, source screen-space grain, fixed1600x900 shimmer surface with225 explicit4px strip blits",
        "seed":"reference crack seed: settings.seed0 means5; other values used directly; source.seed does not perturb Ember; all helper/grain channels retain reference seeds",
        "budgets":{"drawingOperations":16,"expandedDAG":true,"shimmerScratchPixels":2880000,
            "plan":"paint/vertex work*512 plus9 grain tiles per visit;225 blits counted; duplicate references charged",
            "images":"reserve128MiB verified aggregate decoded images plus3 encoded byte copies in shared temporary admission; independent resource limits also apply"},
        "limitations":["author supplies all palette, HUD text/font/timecode, cues and image; no example-song assets or labels are inferred",
            "reference gl.js recommended post is not injected; use explicit layered recipe.post",
            "manual forward Whip segments must keep iris factor0..1 at cubic extrema; unrenderable combinations reject during admission, never silently clamp or sort"]})
}
