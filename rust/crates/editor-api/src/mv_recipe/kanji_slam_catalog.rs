use serde_json::{Value, json};

fn number(min: f64, max: f64, integer: bool, value: f64) -> Value {
    json!({"type":"number","min":min,"max":max,"integer":integer,"suggested":if integer {json!(value as i64)}else{json!(value)}})
}
fn choice(options: &[&str], value: &str) -> Value {
    json!({"type":"enum","options":options,"suggested":value})
}
fn tuple(items: Vec<Value>) -> Value {
    let suggested: Vec<_> = items.iter().map(|v| v["suggested"].clone()).collect();
    json!({"type":"tuple","items":items,"suggested":suggested})
}
fn object(properties: Value) -> Value {
    let suggested: Value = properties
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                if v["type"] == "resource" {
                    json!(format!("fixture-{}", v["kind"].as_str().unwrap()))
                } else {
                    v["suggested"].clone()
                },
            )
        })
        .collect();
    json!({"type":"object","properties":properties,"additionalProperties":false,"suggested":suggested})
}
fn array(items: Value, min: usize, max: usize, suggested: Value) -> Value {
    json!({"type":"array","items":items,"minItems":min,"maxItems":max,"suggested":suggested})
}
fn nullable(value: Value, suggested: Value) -> Value {
    json!({"type":"union","variants":[value,{"type":"const","value":null}],"required":false,"suggested":suggested})
}
fn color(value: [f64; 4]) -> Value {
    json!({"type":"rgba","min":0,"max":1,"length":4,"alpha":1,"suggested":value})
}
fn parameters(variant: &str) -> Value {
    let manual = object(
        json!({"kind":choice(&["manual"],"manual"),"songTicks":array(number(0.0,2592000000.0,true,0.0),0,21600,json!([0,60000,120000,180000]))}),
    );
    let font = json!({"type":"resource","kind":"font"});
    let image = json!({"type":"resource","kind":"image"});
    let slot = object(
        json!({"x":number(-8192.0,8192.0,false,560.0),"y":number(-8192.0,8192.0,false,545.0),"s":number(0.01,8.0,false,1.3),"r":number(-32.0,32.0,false,-0.035)}),
    );
    let frame = object(
        json!({"z":number(0.01,8.0,false,1.0),"dx":number(-8192.0,8192.0,false,0.0),"dy":number(-8192.0,8192.0,false,0.0)}),
    );
    json!({
        "variant":choice(&[variant],variant),
        "beats":{"type":"union","variants":[manual,object(json!({"kind":choice(&["analysis"],"analysis")}))],"suggested":manual["suggested"]},
        "bpm":number(1.0,1000.0,false,120.0),"downbeatIndex0":number(0.0,u32::MAX as f64,true,0.0),
        "fonts":object(json!({"monument":font,"lyric":font,"counter":font})),
        "fire":{"type":"boolean","suggested":variant=="hand"},"char":image,"bg":nullable(image,json!("fixture-image")),
        "glyphs":array(json!({"type":"text","minLength":1,"maxLength":8,"lengthUnit":"unicode-scalars","controlCharacters":false,"suggested":"救"}),1,8,json!(["救","って"])),
        "charX":number(-8192.0,8192.0,false,1330.0),"charY":number(-8192.0,8192.0,false,1100.0),"charH":number(1.0,8192.0,false,1000.0),
        "face":tuple(vec![number(0.0,1.0,false,0.745),number(0.0,1.0,false,0.235)]),
        "color":color([200.0/255.0,55.0/255.0,58.0/255.0,1.0]),
        "sky":choice(&["sunset","night","day"],if variant=="night"{"night"}else{"sunset"}),
        "skyGrad":nullable(array(tuple(vec![number(0.0,1.0,false,0.0),color([1.0;4])]),2,16,json!([[0,[0.3,0.6,1,1]],[1,[1,1,1,1]]])),Value::Null),
        "rim":color([1.0,179.0/255.0,107.0/255.0,1.0]),"rimOff":tuple(vec![number(-128.0,128.0,false,7.0),number(-128.0,128.0,false,2.0)]),
        "rimA":number(0.0,1.0,false,0.75),"haloA":number(0.0,1.0,false,0.55),"voiceDir":nullable(number(-32.0,32.0,false,-0.62),Value::Null),
        "wind":object(json!({"axis":choice(&["col","row"],"col"),"from":number(0.001,0.999,false,0.6),"dir":{"type":"enum","options":[-1,1],"suggested":-1},"amp":number(0.0,128.0,false,20.0),"freq":number(0.0,32.0,false,1.4),"speed":number(-64.0,64.0,false,6.2),"q":number(1.0,120.0,false,12.0)})),
        "slots":array(slot.clone(),1,16,json!([slot["suggested"]])),"frames":array(frame.clone(),1,16,json!([frame["suggested"]])),
        "lines":choice(&["ink","light"],if variant=="night"{"light"}else{"ink"}),"noFlash":{"type":"boolean","suggested":false}
    })
}
pub(super) fn entry() -> Value {
    let variants: Value = ["default", "night", "hand"]
        .into_iter()
        .map(|v| (v.to_string(), json!({"parameters":parameters(v)})))
        .collect();
    json!({
        "requires":["native-html-canvas-2d","declared-font-resource","declared-image-resource"],
        "binding":"scene.settings with explicit role/span; complete authored settings, no project-specific implicit defaults",
        "variants":variants,
        "clock":"same native integer120000Hz graph/ref/sequence clock; original shot beat tolerance45ms and two30fps-frame anticipation; quantized12fps character wind is independent of full-rate camera/fire",
        "fontMetrics":"explicit monument/lyric/counter identities; all authored glyph1500px ink bounds including hidden words; dynamic lyric and counter whole-string bounds from current mapped frame",
        "response":"all original sky, character wind/rim/halo, glyph outline/speckle/smear, lyric/counter, impact rays, fire/noise/heat and scene-side finishing layers",
        "constraints":["1..8 glyph strings, each1..8Unicode scalars, total<=32; all colors opaque normalizedRGBA",
            "beats manual strictly increasing0..21600 entries or reviewed bound analysis; valid downbeat index; final song tick<=2592000000",
            "skyGrad requires2..16 strictly increasing stops only when sky=day and bg absent; otherwise omitted/null",
            "all resources required even on hidden branches; decoded image plus wind padding must fit4096per side"],
        "budgets":{"drawingOperations":16,"expandedPrimitives":4096,"expandedPathSteps":100000,"serializedPlanBytes":4194304,"temporaryPixelCap":67108864,
            "scratch":"40Mi pixel-equivalent leaf envelope rechecked using measured glyph/image facts, ordered surface lifetimes, blur scratch and retained alpha/rect payloads; global recipe cap unchanged"},
        "limitations":["implemented-not-runtime-probed; catalog does not assert full original pixel/export parity or installed acceptance",
            "reference film artwork is not bundled; independent original oracle uses explicit synthetic marker assets",
            "reference gl.js is not injected; additional group/master post must be authored explicitly"]
    })
}
