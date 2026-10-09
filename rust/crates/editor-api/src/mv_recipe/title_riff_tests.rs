use super::{Sample, clock::Clock, fonts, labels, model::*, state::State};
use crate::{mv_recipe::model::Span, programmatic_resources::Resource};
use serde_json::{Value, json};

pub(super) fn author(outro: bool) -> Value {
    let mut value = json!({"variant":if outro { "outro" } else { "intro" },
        "beats":{"kind":"manual","songTicks":(0..81).map(|i|i*60000u64).collect::<Vec<_>>()},
        "bpm":120,"downbeatIndex0":2,"credit":"LOCAL ORACLE",
        "fonts":{"title":"title.ttf","hud":"hud.ttf","ruby":"ruby.ttf","subtitle":"subtitle.ttf"},
        "char":"character.png","sky":"sky.png","glyphs":["残","光"],"ruby":["ざん","こう"],"sub":"afterglow",
        "hud":{"title":"「残光」 ZANKŌ — afterglow","when":"DUSK / 逢魔が時","bpm":"BPM 120 · 4/4","geo":"35°41′N 139°46′E","place":"踏切 No.7 — 上り","len":"03:44"},
        "cues":if outro { json!({"sun":0,"hud":0,"hud2":1,"zan":2,"cross":3,"ko":4,"split":5,"neg":-1,"sil":-1,"lock":8,"exit":15}) }
            else { json!({"sun":0,"hud":1,"hud2":2,"zan":3,"cross":4,"ko":5,"split":6,"neg":7,"sil":8,"lock":12,"exit":15}) },
        "exit":true,"grain":0.07});
    if outro {
        value["recap"] = json!(
            (0..3)
                .map(|i| json!({"bg":if i==1 {"sky.png"} else {"dawn.png"},
            "char":"character.png","view":{"zoom":1,"x":0,"y":0,"rot":0},"h":1.6,"cx":0,"cy":1.05}))
                .collect::<Vec<_>>()
        );
        value["final"] = json!("dawn.png");
    }
    value
}
pub(super) fn model(outro: bool) -> TitleRiff {
    serde_json::from_value(author(outro)).unwrap()
}
pub(super) fn sample(time: f64, outro: bool) -> Sample<'static> {
    let start = if outro { 20.25 } else { 2.25 };
    Sample {
        shot_start_ticks: (start * 120000.0) as u64,
        shot_end_ticks: ((start + 10.0) * 120000.0) as u64,
        song_ticks: (time * 120000.0) as u64,
        analysis: None,
    }
}
pub(super) fn resources() -> Vec<Resource> {
    ["title", "hud", "ruby", "subtitle"].into_iter().map(|name|serde_json::from_value(json!({
        "id":format!("{name}.ttf"),"kind":"font","attachmentKey":format!("programmatic-resources/{}.ttf","a".repeat(64)),
        "mimeType":"font/ttf","byteLength":10,"sha256":"a".repeat(64),
        "font":{"family":name,"weight":400,"style":"normal"}})).unwrap()).collect()
}
#[test]
fn exact_original_clock_retains_phase_downbeat_and_distinct_cue_extrapolation() {
    let a = model(false);
    let c = Clock::new(&a, &sample(9.13, false)).unwrap();
    assert_eq!(c.index, 18);
    assert_eq!(c.beat, 16);
    assert_eq!(c.bar, 4);
    assert_eq!(c.in_bar, 0);
    assert!((c.phase - 0.26).abs() < 1e-12);
    assert!((c.pulse - (-1.17f64).exp()).abs() < 1e-12);
    assert_eq!(c.cues[0], 2.5);
    assert_eq!(c.cues[19], 12.0);
    let mut a = model(false);
    a.beats = Beats::Manual { song_ticks: vec![] };
    a.downbeat_index0 = 0;
    let c = Clock::new(&a, &sample(3.0, false)).unwrap();
    assert_eq!(c.index, -1);
    assert_eq!(c.bar, -1);
    assert_eq!(c.in_bar, 3);
    assert_eq!(c.pulse, 0.0);
    assert!((c.cues[0] - 2.71).abs() < 1e-12);
    assert_eq!(c.phase, 0.0);
}
#[test]
fn native_admission_requires_explicit_complete_cues_clock_and_outro_resources() {
    let span = Span {
        start_frame: 0,
        duration_frames: 300,
    };
    for outro in [false, true] {
        assert!(model(outro).valid(if outro { 2430000 } else { 270000 }, &span, 4000));
        for key in [
            "beats",
            "bpm",
            "downbeatIndex0",
            "fonts",
            "credit",
            "cues",
            "hud",
            "ruby",
            "exit",
        ] {
            let mut value = author(outro);
            value.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<TitleRiff>(value).is_err(),
                "missing {key}"
            );
        }
    }
    let mut a = model(true);
    a.recap = None;
    assert!(!a.valid(2430000, &span, 4000));
    let mut a = model(false);
    a.ruby = Ruby::Disabled(true);
    assert!(!a.valid(270000, &span, 4000));
    let mut a = model(false);
    a.downbeat_index0 = 81;
    assert!(Clock::new(&a, &sample(9.13, false)).is_err());
}
#[test]
fn source_exit_false_preserves_glyph_exit_cue_and_lockup_fade() {
    let mut a = model(false);
    a.exit = false;
    let c = Clock::new(&a, &sample(12.2, false)).unwrap();
    let s = State::new(&a, &c);
    assert_eq!(s.exit, 0.0);
    assert_eq!(a.cues.exit, 15);
    let texts = labels::labels(&a, &c, &s, [1.0; 4], [1.0; 4]);
    assert!(texts.iter().all(|v| v.hud));
}
#[test]
fn outro_recap_has_authored_modulus_but_original_hud_still_divides_by_twelve() {
    let a = model(true);
    let c = Clock::new(&a, &sample(25.13, true)).unwrap();
    let s = State::new(&a, &c);
    let panels = labels::panels(&a, &c, &s);
    assert_eq!(panels.len(), 2);
    assert!(panels.iter().all(|p| p.item < 3));
    let texts = labels::labels(&a, &c, &s, [1.0; 4], [1.0; 4]);
    assert!(texts.iter().any(|v| v.text == "END TITLE · 10/12"));
    assert_eq!(a.images(), vec!["character.png", "dawn.png", "sky.png"]);
}
#[test]
fn every_sample_requests_exact_live_strings_ink_bounds_and_macron_prefixes() {
    let a = model(false);
    let resources = resources();
    let mut requests = Vec::new();
    a.sampled_requests(&sample(9.13, false), &resources, &mut requests)
        .unwrap();
    let title = requests
        .iter()
        .find(|r| r.resource.id == "title.ttf")
        .unwrap();
    assert_eq!(title.bounds.len(), 2);
    let b = &title.bounds[0];
    assert_eq!(b.font_size_px, 1000.0);
    assert_eq!(b.text, "残");
    assert_eq!(b.align, crate::mv_font_metrics::TextAlign::Left);
    assert_eq!(b.baseline, crate::mv_font_metrics::TextBaseline::Alphabetic);
    let hud = requests
        .iter()
        .find(|r| r.resource.id == "hud.ttf")
        .unwrap();
    assert!(
        hud.advances
            .iter()
            .any(|a| a.text == "O" && a.font_size_px == 20.0)
    );
    assert!(hud.advances.iter().any(|a| a.text == "「残光」 ZANK"));
    let sub = requests
        .iter()
        .find(|r| r.resource.id == "subtitle.ttf")
        .unwrap();
    assert!(
        sub.bounds.iter().any(|b| b.text == "afterglow"
            && b.font_size_px == 28.0
            && b.letter_spacing_px >= 14.0)
    );
    let first = serde_json::to_value(&requests).unwrap();
    requests.clear();
    a.sampled_requests(&sample(8.8, false), &resources, &mut requests)
        .unwrap();
    assert_ne!(first, serde_json::to_value(&requests).unwrap());
    requests.clear();
    a.sampled_requests(&sample(9.13, false), &resources, &mut requests)
        .unwrap();
    assert_eq!(first, serde_json::to_value(&requests).unwrap());
    assert!(fonts::static_requests(&a, &resources[..1], &mut Vec::new()).is_ok());
    assert!(
        a.sampled_requests(&sample(9.13, false), &resources[..1], &mut Vec::new())
            .is_err()
    );
}
