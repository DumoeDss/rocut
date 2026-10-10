use super::{Freeze, Melt, Panels, Rewind};
use serde_json::{json, Value};
fn number(min: f64, max: f64, suggested: f64) -> Value {
    json!({"type":"number","min":min,"max":max,"suggested":suggested})
}
fn seconds() -> Value {
    json!({"type":"number","min":0,"max":21600,"unit":"absolute-song-seconds"})
}
fn boolean(suggested: bool) -> Value {
    json!({"type":"boolean","suggested":suggested})
}
fn pair(min: f64, max: f64) -> Value {
    json!({"type":"array","minItems":2,"maxItems":2,"items":number(min,max,min)})
}
fn entry(parameters: Value, constraints: Value) -> Value {
    json!({"requires":["canvas-worker-2d"],"binding":"scene.settings; optional controls use original defaults; closed objects","parameters":parameters,"constraints":constraints,"coordinates":"exact1920x1080 native design raster","clock":"Rust mapped integer song ticks; child sample retains signed original transport jitter; root rejects out-of-domain samples instead of clamping","validation":"CPU implementation; native pixels/WASM/export require separate acceptance"})
}
impl Freeze {
    pub fn catalog_entry() -> Value {
        entry(json!({"at":seconds(),"live":boolean(true),"crackAt":seconds(),"crackXY":pair(-8192.0,8192.0),"crackAngle":number(-100.0,100.0,-0.58),"crackSeed":{"type":"number","integer":true,"min":0,"max":u32::MAX,"suggested":23},"desatEnd":seconds(),"desat":number(0.0,1.0,0.88),"push":number(-0.5,4.0,0.025),"jitter":number(0.0,64.0,1.2),"split":number(0.0,512.0,36.0)}),json!(["input is a same-recipe local child node ID","desatEnd or crackAt strictly follows held at sample","crackAt absent disables crack; original seeded growing geometry and split remain native","settings-dependent expanded-work and256KiB producer metadata cap"]))
    }
}
impl Rewind {
    pub fn catalog_entry() -> Value {
        entry(json!({"span":number(0.0,21600.0,3.0),"from":seconds(),"follow":boolean(true),"fps":{"type":"number","integer":true,"min":1,"max":120,"suggested":15},"hold":number(0.0,10.0,0.1),"tail":number(0.0,60.0,0.12),"osd":boolean(true),"osdFont":{"type":"resource-id","resourceKind":"font"}}),json!(["input and preceding-shot follow candidates are derived from this recipe only","complete reviewed whole-song analysis with nonempty real beat grid is mandatory","OSD requires explicit genuine normal400 DotGothic16 physical font and native REW64 measurement; osd:false forbids unused osdFont","quantized tape sampling, tracking tears, native static/chroma/scanlines;4MiB producer metadata cap"]))
    }
}
impl Melt {
    pub fn catalog_entry() -> Value {
        entry(json!({"at":seconds(),"live":boolean(false),"rate":number(-8.0,8.0,0.25),"meltAt":seconds(),"meltEnd":seconds(),"cols":{"type":"number","integer":true,"min":1,"max":480,"suggested":128},"seed":{"type":"number","integer":true,"min":0,"max":u32::MAX,"suggested":5},"depth":number(0.0,8.0,0.95),"drip":number(0.0,8.0,0.42),"drops":{"type":"number","integer":true,"min":0,"max":256,"suggested":46}}),json!(["input is a same-recipe local child node ID","meltEnd strictly after meltAt; live samples at+(t-shotStart)*rate","expanded work uses actual seeded quantized column count, echoes and drops;512KiB producer metadata cap"]))
    }
}
impl Panels {
    pub fn catalog_entry() -> Value {
        let rgba = json!({"type":"rgba","length":4,"min":0,"max":1});
        let tone = json!({"type":"object","additionalProperties":false,"properties":{"c0":rgba,"c1":rgba,"dot":rgba,"sun":{"type":"array","minItems":3,"maxItems":3,"description":"finite design pixels x/y within8192 and radius0..8192 exclusive zero"},"sunColor":rgba,"step":number(8.0,128.0,13.0),"density":number(0.0,2.0,0.95),"dotA":number(0.0,1.0,0.55),"paper":number(0.0,1.0,0.55)}});
        let input = json!({"type":"node-id","scope":"same-recipe"});
        let variant = json!({"type":"object","additionalProperties":false,"properties":{"input":input,"tone":tone,"focus":pair(-16.0,16.0),"focusTo":pair(-16.0,16.0),"zoom":pair(0.01,16.0),"lines":{"type":"enum","options":["focus","speed","none"]},"linesAt":pair(-8192.0,8192.0),"linesR":pair(0.01,8192.0),"lineColor":rgba,"impactColor":rgba,"linesA":number(0.0,1.0,0.8),"linesAngle":number(-100.0,100.0,-std::f64::consts::FRAC_PI_2),"linesN":{"type":"number","integer":true,"min":1,"max":256,"suggested":70}}});
        let mut panel = variant.clone();
        panel["properties"]["alt"] = variant;
        panel["properties"]["punch"] = json!({"type":"object","additionalProperties":false,"properties":{"zoom":number(0.01,16.0,1.32),"focus":pair(-16.0,16.0)}});
        panel["properties"]["disablePunch"] = boolean(false);
        panel["properties"]["dir"] = pair(-16.0, 16.0);
        let mut value=entry(json!({"panels":{"type":"array","minItems":1,"maxItems":4,"items":panel},"collapseAt":seconds(),"hero":{"type":"number","integer":true,"min":0,"max":3,"suggested":0},"gutter":number(0.0,256.0,22.0),"margin":number(0.0,256.0,22.0),"gutterColor":rgba,"keyline":rgba,"keylineA":number(0.0,1.0,0.92),"keylineW":number(0.01,64.0,3.5),"openAt":{"type":"array","items":seconds()},"openDur":number(0.01,10.0,0.36),"order":{"type":"array","description":"exact permutation of panel indices"},"layout":{"type":"array","description":"one bounded strictly convex design-pixel poly plus optional dir per panel"},"collapseDur":number(0.01,10.0,0.2),"collapseZoom":number(0.0,1.0,0.045),"shake":number(0.0,128.0,7.0),"finalInset":number(-256.0,256.0,20.0),"finalFrame":boolean(true)}),json!(["complete reviewed whole-song real beats and explicit source BPM required","input and alt.input refer only to this graph; hidden alternate children still validated/budgeted","no input uses original tone; all normalized RGBA, no arbitrary CSS","Japanese open order, beat punches/alternate camera, original seeded paper and hero collapse; arbitrary original illust/fx/character and focus/speed-line helpers not exposed","single native dot path counts once;32400dot geometry cap and settings-derived metadata reservation with8MiB absolute producer cap"]));
        value["sceneKind"] = json!("panelsNative");
        value["constraints"][3]=json!("Japanese open order, beat punches/alternate camera, original seeded paper, hero collapse and focus/speed line systems; arbitrary original illust/fx/character fields use explicit local graph composition instead");
        value
    }
}
