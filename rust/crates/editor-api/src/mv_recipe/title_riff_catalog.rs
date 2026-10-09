use serde_json::{Value, json};

fn number(min: f64, max: f64, integer: bool, suggested: f64) -> Value {
    let value = if integer {
        json!(suggested as i64)
    } else {
        json!(suggested)
    };
    json!({"type":"number","min":min,"max":max,"integer":integer,"suggested":value})
}
fn text(max: usize, suggested: &str) -> Value {
    json!({"type":"text","minLength":0,"maxLength":max,"lengthUnit":"unicode-scalars","controlCharacters":false,"suggested":suggested})
}
fn choice(values: &[&str], suggested: &str) -> Value {
    json!({"type":"enum","options":values,"suggested":suggested})
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
fn parameters(outro: bool) -> Value {
    let variant = if outro { "outro" } else { "intro" };
    let manual = object(
        json!({"kind":choice(&["manual"],"manual"),"songTicks":array(number(0.0,2592000000.0,true,0.0),0,21600,json!([0,60000,120000,180000]))}),
    );
    let beats = json!({"type":"union","variants":[manual,object(json!({"kind":choice(&["analysis"],"analysis")}))],"suggested":manual["suggested"]});
    let font = json!({"type":"resource","kind":"font"});
    let image = json!({"type":"resource","kind":"image"});
    let c = if outro {
        [0, 0, 1, 2, 3, 4, 5, -1, -1, 8, 15]
    } else {
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 15]
    };
    let cue_properties: Value = [
        "sun", "hud", "hud2", "zan", "cross", "ko", "split", "neg", "sil", "lock", "exit",
    ]
    .into_iter()
    .zip(c)
    .map(|(key, value)| {
        (
            key.to_string(),
            number(
                if matches!(key, "neg" | "sil") {
                    -1.0
                } else {
                    0.0
                },
                19.0,
                true,
                value as f64,
            ),
        )
    })
    .collect();
    let mut result = json!({
        "variant":choice(&[variant],variant),"beats":beats,"bpm":number(0.01,1000.0,false,120.0),
        "downbeatIndex0":number(0.0,u32::MAX as f64,true,0.0),"credit":text(128,"AUTHOR"),
        "fonts":object(json!({"title":font,"hud":font,"ruby":font,"subtitle":font})),"char":image,"sky":image,
        "glyphs":array(text(32,"残"),2,2,json!(["残","光"])),
        "ruby":{"type":"union","variants":[{"type":"const","value":false},{"type":"array","minItems":2,"maxItems":2,"items":text(32,"ruby")}],"suggested":false},
        "sub":text(128,"AFTERGLOW"),
        "hud":object(json!({"title":text(256,"TITLE"),"when":text(256,"DUSK"),"bpm":text(256,"BPM 120"),"geo":text(256,"35N 139E"),"place":text(256,"CROSSING"),"len":text(256,"03:44")})),
        "cues":object(cue_properties),"exit":{"type":"boolean","suggested":false},"grain":number(0.0,1.0,false,0.07)
    });
    if outro {
        let view = object(
            json!({"zoom":number(0.001,8.0,false,1.0),"x":number(-4.0,4.0,false,0.0),"y":number(-4.0,4.0,false,0.0),"rot":number(-32.0,32.0,false,0.0)}),
        );
        let recap = object(
            json!({"bg":image,"view":view,"h":number(0.001,8.0,false,1.6),"cx":number(-8.0,8.0,false,0.0),"cy":number(-8.0,8.0,false,1.05)}),
        );
        result["recap"] = array(recap.clone(), 1, 32, json!([recap["suggested"]]));
        result["final"] = image;
    }
    result
}
pub(in crate::mv_recipe) fn catalog_entry() -> Value {
    json!({"requires":["canvas-worker-2d","declared-font-resource","declared-image-resource"],
        "binding":"scene.settings with explicit role/span; intro and outro variants require complete authored fields; no song-specific implicit defaults",
        "parameters":{"variant":choice(&["intro","outro"],"intro")},
        "variants":{"intro":{"parameters":parameters(false)},"outro":{"parameters":parameters(true)}},
        "clock":"absolute120000Hz song ticks after the same native ref/sequence traversal; original makeClock beat/bar/phase/pulse and separately extrapolated20visual cues; explicit bpm/downbeatIndex0",
        "fontMetrics":"four explicit font identities; exact1000px glyph ink bounds; current sampled frame whole-string HUD advances and text ink bounds/tracking; no glyph-width approximation or stale HUD metrics",
        "image":"verified decoded dimensions and alpha retained at original resolution; intro sky-cutout/rim masks use character dimensions; all hidden recap/final dependencies required",
        "response":"intro/outro sun, paper, rotated halftones, solo/split/lock monuments, silhouette or recap contact sheets, ring labels/HUD, burst/embers, closing subtitle/credit and exit",
        "constraints":["manual beats strictly increasing0..21600 entries; downbeatIndex0 must refer to an actual beat when nonempty; reviewed analysis binding required for analysis beats",
            "cues use indices0..19; neg/sil may be-1; lock<exit and sil<lock; exit:true must leave positive end-(exitCue+50ms)",
            "intro rejects recap/final; outro requires1..32 complete recap entries and final image; recap.char optional",
            "glyphs exactly2 nonempty strings, each<=32Unicode scalars; ruby false or exactly2 strings; all declared resources and measured identities verified"],
        "budgets":{"drawingOperations":16,"expandedPrimitives":2000,"expandedPathSteps":100000,
            "serializedPlanBytes":super::budget::MAX_PLAN_BYTES,"temporaryPixelCap":67108864,
            "scratch":"two-copy surface allowance, explicitrelease lifetimes, persistent gray payload, grain and blur scratch; verified character dimensions drive mask peak; no downsampling",
            "admission":"pre-decode admission provisional; final whole-source admission uses actual decoded image and mask pixels plus three encoded/plan copies; shared surface side<=4096"},
        "limitations":["native implemented; installation-specific pixel parity/export acceptance is separate, not implied by catalog availability",
            "reference gl.js post is not injected; compose explicit layered recipe.post",
            "original film assets are not bundled; marker-image oracle verifies engine semantics, not the original complete film",
            "exit:false suppresses sun expansion/wash only; glyph exit/lockup fade retain original cue behavior"]})
}
