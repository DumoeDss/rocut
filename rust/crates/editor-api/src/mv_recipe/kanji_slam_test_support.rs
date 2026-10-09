use super::super::{Sample, model::KanjiSlam};
use crate::{mv_font_metrics, mv_image_dimensions, programmatic_resources::Resource};
use serde_json::{Value, json};
pub(super) fn author(variant: &str) -> Value {
    json!({"variant":variant,"beats":{"kind":"manual","songTicks":[0,60000,120000,180000,240000,300000,360000,420000,474600,540000,600000,660000,720000,780000,840000,900000,954600,1020000]},"bpm":120,"downbeatIndex0":2,
        "fonts":{"monument":"monument-font","lyric":"lyric-font","counter":"counter-font"},"fire":variant=="hand","char":"character.png","bg":"sky.png","glyphs":if variant=="night"{vec!["夜"]}else{vec!["救","って","救","って"]},
        "charX":1330,"charY":1100,"charH":1000,"face":[0.745,0.235],"color":[200.0/255.0,55.0/255.0,58.0/255.0,1],"sky":if variant=="night"{"night"}else{"sunset"},"skyGrad":null,
        "rim":[1,179.0/255.0,107.0/255.0,1],"rimOff":[7,2],"rimA":0.75,"haloA":0.55,"voiceDir":-0.62,
        "wind":{"axis":"col","from":0.6,"dir":-1,"amp":20,"freq":1.4,"speed":6.2,"q":12},
        "slots":[{"x":560,"y":545,"s":1.3,"r":-0.035},{"x":640,"y":520,"s":1.42,"r":0.05},{"x":470,"y":600,"s":1.58,"r":0.065},{"x":600,"y":505,"s":1.5,"r":-0.07}],
        "frames":[{"z":1,"dx":0,"dy":0},{"z":1.14,"dx":40,"dy":20},{"z":0.95,"dx":-20,"dy":0},{"z":1.24,"dx":70,"dy":40}],"lines":if variant=="night"{"light"}else{"ink"},"noFlash":false})
}
pub(super) fn settings(variant: &str) -> KanjiSlam {
    serde_json::from_value(author(variant)).unwrap()
}
pub(super) fn sample(time: f64) -> Sample<'static> {
    Sample {
        shot_start_ticks: 480000,
        shot_end_ticks: 960000,
        song_ticks: (time * 120000.0).round() as u64,
        analysis: None,
    }
}
pub(super) fn resources() -> Vec<Resource> {
    let fonts = [
        ("monument-font", "Zen Old Mincho", 900),
        ("lyric-font", "Shippori Mincho B1", 700),
        ("counter-font", "DotGothic16", 400),
    ];
    let mut items:Vec<Value>=fonts.into_iter().map(|(id,family,weight)|json!({"id":id,"kind":"font","mimeType":"font/ttf","byteLength":1,"sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64)),"font":{"family":family,"style":"normal","weight":weight}})).collect();
    for id in ["character.png", "sky.png"] {
        items.push(json!({"id":id,"kind":"image","mimeType":"image/png","byteLength":1,"sha256":"b".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","b".repeat(64))}));
    }
    items
        .into_iter()
        .map(|v| serde_json::from_value(v).unwrap())
        .collect()
}
pub(super) fn facts(
    a: &KanjiSlam,
    s: &Sample<'_>,
) -> (mv_font_metrics::Context, mv_image_dimensions::Context) {
    let resources = resources();
    let mut fonts = Vec::new();
    a.sampled_requests(s, &resources, &mut fonts).unwrap();
    // Structural transport fixtures only; never presented as browser font facts.
    let measured:Vec<_>=fonts.iter().map(|r|serde_json::from_value(json!({"resource":r.resource,"glyphs":[],"advances":[],"bounds":r.bounds.iter().map(|b|json!({"version":b.version,"text":b.text,"fontSizePx":b.font_size_px,"letterSpacingPx":b.letter_spacing_px,"align":b.align,"baseline":b.baseline,"left":0,"right":b.font_size_px*0.55,"ascent":b.font_size_px*0.7,"descent":b.font_size_px*0.06})).collect::<Vec<_>>() })).unwrap()).collect();
    let fonts = mv_font_metrics::Context::new(&fonts, &measured).unwrap();
    let requested = mv_image_dimensions::requests(&resources, &a.images()).unwrap();
    let measured = requested
        .iter()
        .map(|r| {
            serde_json::from_value(json!({"resource":r.resource,"width":192,"height":320})).unwrap()
        })
        .collect::<Vec<_>>();
    let images = mv_image_dimensions::Context::new(&requested, &measured).unwrap();
    (fonts, images)
}
