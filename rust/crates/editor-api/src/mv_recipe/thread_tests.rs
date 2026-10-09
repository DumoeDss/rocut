use super::{
    Sample,
    clock::{self, Clock},
    geometry,
    hand::Hand,
    model::Thread,
    state::State,
};
use crate::{
    mv_audio::Data,
    mv_image_dimensions::{self, Context},
    programmatic_resources::Resource,
};
use serde_json::{Value, json};
#[path = "thread_public_tests.rs"]
mod public;

fn author() -> Value {
    json!({"hand":"hand","bpm":120,"downbeatIndex0":0,
    "beats":{"kind":"manual","songTicks":[0,60000,120000,180000,240000,300000,360000,420000,480000]}})
}
fn settings() -> Thread {
    serde_json::from_value(author()).unwrap()
}
fn sample(t: f64) -> Sample<'static> {
    Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 480000,
        song_ticks: (t * 120000.0).round() as u64,
        analysis: None,
    }
}
fn resources() -> Vec<Resource> {
    serde_json::from_value(json!([{"id":"hand","kind":"image",
    "mimeType":"image/png","sha256":"a".repeat(64),"byteLength":100,
    "attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))}]))
    .unwrap()
}
fn facts(w: u32, h: u32) -> Context {
    let resources = resources();
    let req = mv_image_dimensions::requests(&resources, &["hand"]).unwrap();
    Context::new(
        &req,
        &[serde_json::from_value(json!({"resource":resources[0],"width":w,"height":h})).unwrap()],
    )
    .unwrap()
}
fn audio(stops: Value) -> Data {
    serde_json::from_value(json!({"schema":"rocut-mv-audio/1","duration":4,"fps":1,
    "provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),"manifestSha256":"b".repeat(64),
    "musicSha256":"c".repeat(64),"envelopesSha256":"d".repeat(64),"review":{"status":"accepted","reference":"thread fixture"}},
    "beats":[0,60000,120000,180000,240000,300000,360000,420000],"downbeats":[0],"stops":stops,
    "channels":{"mix_rms":[0,0,0,0],"low_power":[0,0,0,0],"mid_power":[0,0,0,0],"high_power":[0,0,0,0]},
    "scales":{"mix_rms":0,"low_power":0,"mid_power":0,"high_power":0}})).unwrap()
}

#[test]
fn default_clock_and_arrival_use_original_whole_song_beat_semantics() {
    let a = settings();
    let c = Clock::new(&a, &sample(2.0)).unwrap();
    assert_eq!(c.kick, 2.96);
    assert_eq!(c.arrive, 3.16);
    assert_eq!(c.held, 2.0);
    assert_eq!(c.quantized, 2.0);
    assert_eq!(c.pulse(2.0, 6.0), 1.0);
    assert_eq!(c.down_pulse(2.0, 4.0), 1.0);
    assert_eq!(c.pulse(-0.1, 6.0), 0.0);
    let mut a = a;
    a.downbeat_index0 = 1;
    let c = Clock::new(&a, &sample(2.0)).unwrap();
    assert_eq!(c.down_pulse(2.0, 4.0), 0.0);
    assert_eq!(c.arrive, 3.16);
}
#[test]
fn reviewed_stops_filter_kind_and_overlap_without_sorting_and_empty_override_wins() {
    let data = audio(json!([
        {"start":2.0,"end":2.7,"kind":"stop"},
        {"start":0.2,"end":3.0,"kind":"gap"},
        {"start":1.0,"end":1.5,"kind":"stop"}]));
    data.validate().unwrap();
    let mut s = sample(2.4);
    s.analysis = Some(&data);
    let mut a = settings();
    let c = Clock::new(&a, &s).unwrap();
    assert_eq!(c.kick, 1.5); // last authored event, not chronologically last
    assert!((c.held - 1.5).abs() < 1e-12);
    a.stops = Some(vec![]);
    let c = Clock::new(&a, &s).unwrap();
    assert_eq!(c.kick, 2.96);
    assert_eq!(c.held, 2.4);
    a.stops = Some(vec![[1.0, 2.0], [1.5, 2.5]]);
    assert_eq!(clock::held(2.0, a.stops.as_ref().unwrap()), 0.5);
}
#[test]
fn stop_boundary_and_drawing_quantization_do_not_freeze_full_rate_camera() {
    let mut a = settings();
    a.stops = Some(vec![[1.0, 1.4]]);
    let c1 = Clock::new(&a, &sample(1.1)).unwrap();
    let c2 = Clock::new(&a, &sample(1.3)).unwrap();
    assert_eq!(c1.held, c2.held);
    assert_eq!(c1.quantized, c2.quantized);
    assert_ne!(State::new(&c1).progress, State::new(&c2).progress);
    assert_eq!(clock::held(1.0, &[[1.0, 1.4]]), 1.0);
    assert!((clock::held(1.4, &[[1.0, 1.4]]) - 1.0).abs() < 1e-12);
    assert!((clock::held(1.5, &[[1.0, 1.4]]) - 1.1).abs() < 1e-12);
}
#[test]
fn empty_beats_need_authored_arrival_and_malformed_args_do_not_fabricate_clock() {
    let mut a = author();
    a["beats"]["songTicks"] = json!([]);
    let settings: Thread = serde_json::from_value(a.clone()).unwrap();
    assert!(Clock::new(&settings, &sample(0.0)).is_err());
    a["arriveAt"] = json!(3.5);
    let settings: Thread = serde_json::from_value(a).unwrap();
    assert_eq!(Clock::new(&settings, &sample(0.0)).unwrap().arrive, 3.5);
    for (key, value) in [
        ("stops", Value::Null),
        ("variant", json!("default")),
        ("handH", Value::Null),
    ] {
        let mut a = author();
        a[key] = value;
        assert!(serde_json::from_value::<Thread>(a).is_err());
    }
}
#[test]
fn full_producer_is_seek_order_independent_bounded_and_keeps_original_surfaces() {
    let a = settings();
    let images = facts(960, 1600);
    let first =
        serde_json::to_value(a.produce(&sample(2.0), 1920, 1080, &images).unwrap()).unwrap();
    for t in [3.5, 0.0, 1.1, 4.0, 2.0] {
        let plan = a.produce(&sample(t), 1920, 1080, &images).unwrap();
        let value = serde_json::to_value(&plan).unwrap();
        if t == 2.0 {
            assert_eq!(first, value);
        }
        let commands = value["commands"].as_array().unwrap();
        for (id, size) in [
            ("th-wide", json!([480, 270])),
            ("th-near", json!([960, 540])),
            ("th-scene", json!([1920, 1080])),
        ] {
            assert_eq!(
                commands.iter().find(|v| v["id"] == id).unwrap()["size"],
                size
            );
        }
        assert!(
            plan.validate_surfaces(a.scratch_pixels(Some(&images)).unwrap())
                .is_ok()
        );
        let c = Clock::new(&a, &sample(t)).unwrap();
        let s = State::new(&c);
        let h = Hand::new(&a, &c, &images).unwrap();
        let path = geometry::visible(&a, &c, &s, &h);
        assert!((5..=301).contains(&path.len()));
        assert!(path.iter().flatten().all(|v| v.is_finite()));
    }
}
