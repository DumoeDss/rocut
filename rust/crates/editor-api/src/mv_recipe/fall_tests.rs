use super::{
    Sample,
    character::Character,
    clock::{self, Clock},
    geometry,
    model::Fall,
};
use crate::{
    mv_audio::Data,
    mv_image_dimensions::{self, Context},
    programmatic_resources::Resource,
};
use serde_json::{Value, json};
#[path = "fall_public_tests.rs"]
mod public;
fn author() -> Value {
    json!({"char":"fall-char","beats":{"kind":"manual","songTicks":[0,60000,120000,180000,240000,300000,360000,420000,480000,540000,600000,660000,720000,780000,840000,900000,960000]}})
}
fn settings() -> Fall {
    serde_json::from_value(author()).unwrap()
}
fn sample(t: f64) -> Sample<'static> {
    Sample {
        shot_start_ticks: 480000,
        shot_end_ticks: 960000,
        song_ticks: (t * 120000.0).round() as u64,
        analysis: None,
    }
}
fn resources() -> Vec<Resource> {
    serde_json::from_value(json!([{"id":"fall-char","kind":"image","mimeType":"image/png","byteLength":100,"sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))}])).unwrap()
}
fn facts(width: u32, height: u32) -> Context {
    let resources = resources();
    let requests = mv_image_dimensions::requests(&resources, &["fall-char"]).unwrap();
    Context::new(
        &requests,
        &[
            serde_json::from_value(json!({"resource":resources[0],"width":width,"height":height}))
                .unwrap(),
        ],
    )
    .unwrap()
}
fn audio(stops: Value) -> Data {
    serde_json::from_value(json!({"schema":"rocut-mv-audio/1","duration":10,"fps":1,
    "provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),"manifestSha256":"b".repeat(64),"musicSha256":"c".repeat(64),"envelopesSha256":"d".repeat(64),"review":{"status":"accepted","reference":"fall fixture"}},
    "beats":[0,60000,120000,180000,240000,300000,360000,420000,480000,540000,600000,660000,720000,780000,840000,900000,960000],"downbeats":[0],"stops":stops,
    "channels":{"mix_rms":vec![0;10],"low_power":vec![0;10],"mid_power":vec![0;10],"high_power":vec![0;10]},"scales":{"mix_rms":0,"low_power":0,"mid_power":0,"high_power":0}})).unwrap()
}
#[test]
fn freeze_and_pulse_empty_arrays_override_globals_independently() {
    let audio = audio(
        json!([{"kind":"gap","start":4.1,"end":7.8},{"kind":"stop","start":5.1,"end":5.7},{"kind":"stop","start":6.3,"end":6.65}]),
    );
    audio.validate().unwrap();
    let mut s = sample(5.67);
    s.analysis = Some(&audio);
    let mut a = settings();
    let c = Clock::new(&a, &s).unwrap();
    assert!((c.held - 5.1).abs() < 1e-12);
    assert!((c.kick - 5.1).abs() < 1e-12);
    assert_eq!(c.pulses, vec![5.7 - 0.04]);
    assert!(c.pulse > 0.9);
    a.pulse = Some(vec![]);
    let c = Clock::new(&a, &s).unwrap();
    assert!(c.pulses.is_empty());
    assert_eq!(c.pulse, 0.0);
    assert!((c.held - 5.1).abs() < 1e-12);
    a.freeze = Some(vec![]);
    let c = Clock::new(&a, &s).unwrap();
    assert_eq!(c.held, 5.67);
    assert_eq!(c.kick, -1e9);
}
#[test]
fn first_freeze_not_last_controls_kick_and_overlap_order_is_preserved() {
    let mut a = settings();
    a.freeze = Some(vec![[6.0, 6.8], [5.0, 5.6], [5.2, 5.8]]);
    let c = Clock::new(&a, &sample(6.7)).unwrap();
    assert_eq!(c.kick, clock::held(6.8, a.freeze.as_ref().unwrap()));
    assert_eq!(c.pulses, vec![6.8 - 0.04]);
    assert!((c.held - 4.8).abs() < 1e-12);
    assert_eq!(clock::held(5.5, &[[5.0, 6.0], [5.2, 5.8]]), 4.7);
}
#[test]
fn freeze_holds_camera_hair_and_distance_but_not_pulse_clock() {
    let mut a = settings();
    a.freeze = Some(vec![[5.0, 5.5]]);
    a.pulse = Some(vec![5.1]);
    let c0 = Clock::new(&a, &sample(5.15)).unwrap();
    let c1 = Clock::new(&a, &sample(5.35)).unwrap();
    assert_eq!(c0.held, c1.held);
    assert_eq!(c0.quantized, c1.quantized);
    assert_eq!(
        serde_json::to_value(c0.camera()).unwrap(),
        serde_json::to_value(c1.camera()).unwrap()
    );
    assert_eq!(c0.distance(a.speed), c1.distance(a.speed));
    assert_ne!(c0.pulse, c1.pulse);
}
#[test]
fn midpoint_integral_keeps_fractional_first_and_last_step_and_is_stateless() {
    let a = settings();
    let early = Clock::new(&a, &sample(4.004166666666666)).unwrap();
    assert_eq!(early.distance(1.0), (early.held - early.start) * 0.85);
    let c = Clock::new(&a, &sample(6.123456)).unwrap();
    let first = c.distance(1.0);
    assert!(first > 1.8);
    assert_eq!(c.distance(0.0), 0.0);
    for t in [7.9, 4.0, 5.0, 6.123456] {
        let d = Clock::new(&a, &sample(t)).unwrap().distance(1.0);
        if t == 6.123456 {
            assert_eq!(first, d);
        }
    }
    assert!(a.sim_work(21600 * 120000).unwrap() > crate::mv_recipe::cloth::MAX_SIMULATION_WORK);
}
#[test]
fn hair_warp_has_body_plus_30_round_height_plus_one_strips() {
    let a = settings();
    let c = Clock::new(&a, &sample(5.123456)).unwrap();
    let h = Character::new(&a, &c, &facts(959, 1599)).unwrap();
    let strips = h.strips(c.quantized, 20.0);
    assert_eq!(strips.len(), 31);
    assert_eq!(strips[0].0, [0.0, 384.0, 959.0, 1215.0]);
    assert_eq!(strips[0].0, strips[0].1);
    for (i, (src, dst)) in strips.iter().skip(1).enumerate() {
        let y0 = (384.0 * i as f64 / 30.0).round();
        let y1 = (384.0 * (i + 1) as f64 / 30.0).round();
        assert_eq!(*src, [0.0, y0, 959.0, y1 - y0 + 1.0]);
        assert_eq!(dst[1..], src[1..]);
    }
    assert!(Character::new(&a, &c, &facts(1, 1)).is_err());
    assert_eq!(
        geometry::ribbon(&h, &c, c.speed(a.speed, c.held)).len(),
        111
    );
}
#[test]
fn native_plan_preserves_all_passes_no_grain_and_nonmonotonic_seek() {
    let a = settings();
    let images = facts(960, 1600);
    let first =
        serde_json::to_value(a.produce(&sample(6.0), 1920, 1080, &images).unwrap()).unwrap();
    for t in [7.9, 4.0, 5.2, 6.0] {
        let plan = a.produce(&sample(t), 1920, 1080, &images).unwrap();
        let value = serde_json::to_value(&plan).unwrap();
        if t == 6.0 {
            assert_eq!(value, first);
        }
        assert!(!value.to_string().contains("\"kind\":\"grain\""));
        let commands = value["commands"].as_array().unwrap();
        let scene = commands.iter().find(|v| v["id"] == "fa-scene").unwrap();
        assert_eq!(scene["size"], json!([1920, 1080]));
        let children = scene["commands"].as_array().unwrap();
        // blurPx is serialized from f64; JSON integer equality rejects 5.0.
        let blurred: Vec<_> = children
            .iter()
            .filter(|v| v["kind"] == "blit" && v["raster"]["blurPx"].as_f64() == Some(5.0))
            .collect();
        assert_eq!(blurred.len(), 62);
        for surface in ["fa-warm", "fa-cold"] {
            assert_eq!(
                blurred.iter().filter(|v| v["surface"] == surface).count(),
                31
            );
        }
        let sprite = commands.iter().find(|v| v["id"] == "fa-streak").unwrap();
        assert_eq!(sprite["size"], json!([64, 512]));
        assert_eq!(sprite["commands"][0]["kind"], "filteredRect");
        assert!(
            plan.validate_surfaces(a.scratch_pixels(Some(&images)).unwrap())
                .is_ok()
        );
    }
}
