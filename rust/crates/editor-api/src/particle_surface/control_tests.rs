use super::*;
use control::{ControlKnot, ControlMode, PreparedControl, SurfaceControl};

fn control(mode: ControlMode) -> SurfaceControl {
    SurfaceControl {
        mode,
        start_ticks: 120_000,
        duration_ticks: 120_000,
        knots: vec![
            ControlKnot {
                time_ticks: 120_000,
                position: [1.0, 0.0, 0.0],
            },
            ControlKnot {
                time_ticks: 240_000,
                position: [1.0, 0.0, 0.0],
            },
        ],
        restoring_force: 4.0,
        damping: 2.0,
        radius: 10.0,
        strength: 8.0,
        axis: if matches!(mode, ControlMode::Vortex) {
            Some([0.0, 0.0, 2.0])
        } else {
            None
        },
    }
}

fn request(time: u64, control: Option<SurfaceControl>, count: u32) -> SurfaceSampleRequest {
    SurfaceSampleRequest {
        triangles: vec![SurfaceTriangle {
            position: [[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            normal: None,
            uv: Some([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]),
            color: Some([[0.2, 0.3, 0.4, 1.0]; 3]),
            primitive_index: 7,
            material_index: Some(2),
        }],
        count,
        seed: 99,
        motion: Some(motion::SurfaceMotion {
            version: 1,
            time_ticks: time,
            scatter_start_ticks: 0,
            scatter_duration_ticks: 1,
            hold_duration_ticks: 0,
            return_duration_ticks: 1,
            scatter_distance: 0.0,
            drift_amplitude: 0.0,
            drift_frequency: 0.0,
            size: 2.0,
            size_variance: 0.5,
            control,
        }),
    }
}

#[test]
fn particle_control_first_step_is_dynamic_not_instantaneous_target_displacement() {
    let spring = control(ControlMode::Spring);
    let dt = 1.0 / 120.0;
    let expected = 8.0 * 0.9 * dt * dt;
    let offset = PreparedControl::new(&spring, 121_000, 1)
        .unwrap()
        .offset([0.0; 3])
        .unwrap();
    assert!((offset[0] - expected).abs() < 1e-15);
    assert_eq!(offset[1], 0.0);
    assert_eq!(offset[2], 0.0);
    let tiny = PreparedControl::new(&spring, 120_001, 1)
        .unwrap()
        .offset([0.0; 3])
        .unwrap();
    assert!((tiny[0] - 8.0 * 0.9 / 120_000.0_f64.powi(2)).abs() < 1e-20);
    let vortex = control(ControlMode::Vortex);
    let offset = PreparedControl::new(&vortex, 121_000, 1)
        .unwrap()
        .offset([0.0; 3])
        .unwrap();
    assert_eq!(offset[0], 0.0);
    assert!((offset[1] - expected).abs() < 1e-15);
    let mut reversed = vortex.clone();
    reversed.axis = Some([0.0, 0.0, -1.0]);
    let opposite = PreparedControl::new(&reversed, 121_000, 1)
        .unwrap()
        .offset([0.0; 3])
        .unwrap();
    assert_eq!(offset[1], -opposite[1]);
}

#[test]
fn particle_control_knots_interpolate_and_restoring_damping_change_replayed_response() {
    let mut spring = control(ControlMode::Spring);
    spring.knots[1].position = [3.0, 0.0, 0.0];
    let prepared = PreparedControl::new(&spring, 180_000, 1).unwrap();
    assert_eq!(prepared.center(120_000), [1.0, 0.0, 0.0]);
    assert_eq!(prepared.center(180_000), [2.0, 0.0, 0.0]);
    assert_eq!(prepared.center(240_000), [3.0, 0.0, 0.0]);
    let constrained = prepared.offset([0.0; 3]).unwrap()[0];
    let mut free = spring.clone();
    free.restoring_force = 0.0;
    free.damping = 0.0;
    assert!(
        PreparedControl::new(&free, 180_000, 1)
            .unwrap()
            .offset([0.0; 3])
            .unwrap()[0]
            > constrained
    );
    let mut restored = free.clone();
    restored.restoring_force = 100.0;
    assert!(
        PreparedControl::new(&restored, 180_000, 1)
            .unwrap()
            .offset([0.0; 3])
            .unwrap()[0]
            < constrained
    );
    let mut damped = free;
    damped.damping = 20.0;
    assert!(
        PreparedControl::new(&damped, 180_000, 1)
            .unwrap()
            .offset([0.0; 3])
            .unwrap()[0]
            < constrained
    );
}

#[test]
fn particle_control_zero_force_endpoints_and_outside_preserve_exact_baseline_bytes() {
    for time in [
        0,
        119_999,
        120_000,
        240_000,
        240_001,
        motion::MAX_TIME_TICKS,
    ] {
        for mode in [ControlMode::Spring, ControlMode::Vortex] {
            let plain = sample_surface(&request(time, None, 8)).unwrap();
            let controlled = sample_surface(&request(time, Some(control(mode)), 8)).unwrap();
            assert_eq!(
                serde_json::to_vec(&plain).unwrap(),
                serde_json::to_vec(&controlled).unwrap()
            );
        }
    }
    let mut zero = control(ControlMode::Spring);
    zero.strength = 0.0;
    assert_eq!(
        sample_surface(&request(180_000, Some(zero), 8)).unwrap(),
        sample_surface(&request(180_000, None, 8)).unwrap()
    );
    let prepared = control(ControlMode::Spring);
    let near_end = PreparedControl::new(&prepared, 239_999, 1)
        .unwrap()
        .offset([0.0; 3])
        .unwrap();
    assert!(near_end[0].abs() < 1e-8);
    let signed = [-0.0, 0.0, -0.0];
    let motion = request(240_000, Some(prepared), 1).motion.unwrap();
    let moved = motion::PreparedMotion::new(&motion, 1)
        .unwrap()
        .apply(signed, 99, 0)
        .unwrap()
        .0;
    for axis in 0..3 {
        assert_eq!(moved[axis].to_bits(), signed[axis].to_bits());
    }
}

#[test]
fn particle_control_preserves_sampling_seed_prefix_and_seeks_without_history() {
    let baseline = sample_surface(&request(180_000, None, 9)).unwrap();
    let expected =
        sample_surface(&request(180_000, Some(control(ControlMode::Spring)), 9)).unwrap();
    for (a, b) in baseline.samples.iter().zip(&expected.samples) {
        let mut b = b.clone();
        b.motion_position = a.motion_position;
        assert_eq!(a, &b); // Includes size, normal, UV, RGBA, triangle and barycentrics.
    }
    for time in [230_000, 120_001, 180_000, 240_000, 150_000, 180_000] {
        let result = sample_surface(&request(time, Some(control(ControlMode::Spring)), 9)).unwrap();
        if time == 180_000 {
            assert_eq!(result, expected);
        }
    }
    assert_eq!(
        sample_surface(&request(180_000, Some(control(ControlMode::Spring)), 3))
            .unwrap()
            .samples,
        expected.samples[..3]
    );
}

#[test]
fn particle_control_admission_is_full_window_bounded_even_outside_or_zero_force() {
    let mut source = control(ControlMode::Spring);
    source.duration_ticks = 12_000_000;
    source.knots[1].time_ticks = 12_120_000;
    for time in [0, 120_001, 12_120_000] {
        assert!(PreparedControl::new(&source, time, 166).is_ok());
        assert_eq!(
            PreparedControl::new(&source, time, 167).err().unwrap().path,
            "motion.control.durationTicks"
        );
    }
    source.strength = 0.0;
    assert!(PreparedControl::new(&source, 0, 167).is_err());
    source.duration_ticks = 12_000_001;
    assert!(PreparedControl::new(&source, 0, 1).is_err());
    let mut source = control(ControlMode::Spring);
    source.knots[1].time_ticks = source.knots[0].time_ticks;
    assert!(PreparedControl::new(&source, 0, 1).is_err());
    source = control(ControlMode::Spring);
    source.knots[0].time_ticks += 1;
    assert_eq!(
        PreparedControl::new(&source, 0, 1).err().unwrap().path,
        "motion.control.knots"
    );
    source = control(ControlMode::Spring);
    source.radius = f64::NAN;
    assert_eq!(
        PreparedControl::new(&source, 0, 1).err().unwrap().code,
        SurfaceErrorCode::NonFinite
    );
    source = control(ControlMode::Vortex);
    source.axis = Some([0.0; 3]);
    assert_eq!(
        PreparedControl::new(&source, 0, 1).err().unwrap().path,
        "motion.control.axis"
    );
    source = control(ControlMode::Spring);
    source.axis = Some([0.0, 0.0, 1.0]);
    assert!(PreparedControl::new(&source, 0, 1).is_err());
}

#[test]
fn particle_control_json_bridge_rejects_null_unknown_and_oversized_knots_without_fallback() {
    let valid =
        serde_json::to_value(request(150_000, Some(control(ControlMode::Spring)), 1)).unwrap();
    assert!(sample_surface_json(&valid.to_string()).is_ok());
    for field in ["control", "control.extra", "control.axis", "control.knots"] {
        let mut input = valid.clone();
        match field {
            "control" => input["motion"]["control"] = serde_json::Value::Null,
            "control.extra" => input["motion"]["control"]["extra"] = 1.into(),
            "control.axis" => input["motion"]["control"]["axis"] = serde_json::Value::Null,
            _ => {
                input["motion"]["control"]["knots"] = serde_json::to_value(vec![
                    ControlKnot {
                        time_ticks: 0,
                        position: [0.0; 3]
                    };
                    129
                ])
                .unwrap()
            }
        }
        assert_eq!(
            sample_surface_json(&input.to_string()).unwrap_err().code,
            SurfaceErrorCode::InvalidJson
        );
    }
}

#[test]
fn particle_control_saturation_remains_finite_and_radius_bounded() {
    let mut source = control(ControlMode::Spring);
    source.strength = 1000.0;
    source.radius = 1.0;
    source.knots[0].position = [0.5, 0.0, 0.0];
    source.knots[1].position = [-0.5, 0.0, 0.0];
    source.restoring_force = 0.0;
    source.damping = 0.0;
    for time in [121_000, 150_000, 180_000, 210_000, 239_999] {
        let offset = PreparedControl::new(&source, time, 1)
            .unwrap()
            .offset([0.0; 3])
            .unwrap();
        assert!(offset.iter().all(|v| v.is_finite()));
        assert!(offset[0].hypot(offset[1]).hypot(offset[2]) <= 1.0);
    }
}
