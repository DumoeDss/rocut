use super::*;
fn post(mode: &str, ticks: u64) -> NativePost {
    let a: Road = serde_json::from_value(json!({"bpm":120,"mode":mode})).unwrap();
    resolve(
        &a,
        &Sample {
            song_ticks: ticks,
            shot_start_ticks: 0,
            shot_end_ticks: 1200000,
            analysis: None,
        },
        &[60000, 120000, 180000],
    )
    .unwrap()
}
#[test]
fn tear_is_a_full_native_plan_with_canvas_dawn_not_an_internal_black_fade() {
    let p = post("tear", 75000);
    assert_eq!(p.plan.profile, "road-original-gl-v1");
    assert_eq!(p.plan.allocation_bytes, 60_669_184);
    assert_eq!(p.plan.passes.len(), 15);
    assert!(p.plan.lut_atlas_required);
    assert_eq!(p.plan.passes[0].uniforms["lutA"], json!(0));
    assert_eq!(p.plan.passes[0].uniforms["lutB"], json!(0));
    assert_eq!(p.plan.passes[0].uniforms["lutMix"], json!(0.08));
    assert_eq!(p.plan.passes[14].uniforms["bloom"], json!(0.55));
    assert_eq!(p.plan.passes[14].uniforms["fade"], json!(0));
    assert_eq!(p.dawn.unwrap().stops[4], (0.9, "#ffd9b0"));
    assert_eq!(p.transition.unwrap().duration_seconds, 0.3);
}
#[test]
fn run_uses_original_post_pulse_not_the_scene_tile_decay_or_nearest_future_beat() {
    assert_eq!(post("run", 0).plan.passes[0].uniforms["ca"], json!(0.0));
    assert_eq!(post("run", 60000).plan.passes[0].uniforms["ca"], json!(2.0));
    let p = post("run", 105000);
    assert_eq!(
        p.plan.passes[0].uniforms["ca"],
        json!(2.0 * (-9.0f64 * 0.375).exp())
    );
    assert!(!p.plan.lut_atlas_required);
    assert!(p.dawn.is_none());
    assert!(p.transition.is_none());
    assert_eq!(p.plan.passes[14].uniforms["fade"], json!(0));
    assert_eq!(post("run", 60000).plan.passes[0].uniforms["ca"], json!(2.0));
}
