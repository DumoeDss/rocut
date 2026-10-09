use super::{Sample, clock::Clock, draw::Draw, math, model::Converge, plan::Command};
use serde_json::{Value, json};

pub(super) fn author() -> Value {
    super::catalog_entry()["parameters"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), v["suggested"].clone()))
        .collect()
}
fn sample(ticks: u64) -> Sample<'static> {
    Sample {
        shot_start_ticks: 0,
        song_ticks: ticks,
        width: 1920.0,
        height: 1080.0,
        seed: 0,
        analysis: None,
    }
}

#[test]
fn rng_and_noise_match_captured_original_util_js_including_zero_and_large_seeds() {
    // Captured by executing the reference engine/core/util.js in Node, not this implementation.
    for (seed, random, noise) in [
        (0.0, 0.7445164013188332, 0.3382345217937567),
        (7.0, 0.9503517313860357, -0.9389089547996337),
        (4294967295.0, 0.2483578617684543, 0.14960077417164247),
    ] {
        assert_eq!(math::rnd(33.0, seed), random);
        assert!((math::noise(17.123, seed) - noise).abs() < 1e-15);
    }
}

#[test]
fn four_overlay_tiles_use_original_rng_and_uint8_clamp_not_truncation() {
    let captured = [
        [119, 187, 30, 218, 100, 157, 133, 221],
        [202, 205, 92, 185, 171, 162, 145, 158],
        [207, 84, 162, 102, 133, 35, 99, 101],
        [52, 94, 213, 154, 57, 78, 115, 105],
    ];
    for (q, bytes) in captured.iter().enumerate() {
        let mut d = Draw {
            commands: Vec::new(),
            width: 384.0,
            height: 216.0,
        };
        super::grain::draw(&mut d, q as f64 / 24.0, 0.07);
        let Command::Grain {
            transform,
            rect,
            size,
            gray,
            opacity,
        } = &d.commands[0]
        else {
            panic!("grain command")
        };
        assert_eq!(&gray[..8], bytes);
        assert_eq!(gray.len(), 65_536);
        assert_eq!(*size, [256, 256]);
        assert_eq!(*opacity, 0.07);
        assert_eq!(&transform[..4], &[1.0, 0.0, 0.0, 1.0]);
        assert_eq!(&rect[2..], &[384.0, 216.0]);
        assert_eq!(rect[0], -transform[4]);
        assert_eq!(rect[1], -transform[5]);
    }
}

#[test]
fn selected_beat_extrapolation_does_not_leak_into_the_real_pulse_clock() {
    let mut settings = author();
    settings["beats"] = json!({"kind":"manual","songTicks":[0,120000,229200,240000,300000]});
    settings["whiteAtTicks"] = json!(480000);
    let model: Converge = serde_json::from_value(settings.clone()).unwrap();
    let mut s = sample(330000);
    s.shot_start_ticks = 240000;
    let c = Clock::new(&model, &s).unwrap();
    let expected = [1.91, 2.0, 2.5, 2.96, 3.42, 3.88];
    assert_eq!(c.beats.len(), expected.len());
    for (got, expected) in c.beats.iter().zip(expected) {
        assert!((got - expected).abs() < 1e-12);
    }
    assert!((c.pulse - 0.1353352832366127).abs() < 1e-15);
    settings["beats"]["songTicks"] = json!([]);
    settings["whiteAtTicks"] = json!(720000);
    let empty: Converge = serde_json::from_value(settings).unwrap();
    let c = Clock::new(&empty, &s).unwrap();
    assert_eq!(c.beats.len(), 8);
    assert!((c.beats[0] - 2.41).abs() < 1e-12);
    assert!((c.beats[7] - 5.63).abs() < 1e-12);
    assert_eq!(c.pulse, 0.0);
}

#[test]
fn complete_plan_preserves_paint_order_and_conservative_work_bound() {
    let model: Converge = serde_json::from_value(author()).unwrap();
    for ticks in [0, 60000, 120000, 210000, 239999, 240000, 280000] {
        let plan = model.plan(&sample(ticks)).unwrap();
        let paints: usize = plan
            .commands
            .iter()
            .map(|cmd| match cmd {
                Command::Path { paints, .. } => paints.len(),
                Command::Rect { .. } => 1,
                Command::Grain { .. } => 256,
            })
            .sum();
        assert!(paints <= model.work() as usize, "{ticks}: {paints}");
        let Command::Rect { paint, .. } = &plan.commands[0] else {
            panic!("background")
        };
        assert_eq!(paint.composite, "source-over");
        for arm in &plan.commands[3..9] {
            let Command::Path { path, paints, .. } = arm else {
                panic!("arm")
            };
            assert_eq!(path.len(), 71);
            assert_eq!(paints.len(), 2);
            assert!(paints.iter().all(|p| p.composite == "lighter"));
        }
        let grain = plan
            .commands
            .iter()
            .position(|c| matches!(c, Command::Grain { .. }))
            .unwrap();
        if ticks >= 240000 {
            assert!(grain < plan.commands.len() - 1);
            let Command::Rect {
                transform, paint, ..
            } = plan.commands.last().unwrap()
            else {
                panic!("white fill")
            };
            assert_eq!(*transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
            assert_eq!(paint.opacity, 1.0);
            assert_eq!(paint.composite, "source-over");
        }
    }
}

#[test]
fn zero_seed_is_real_and_source_seed_addition_wraps_without_changing_fixed_channels() {
    let mut settings = author();
    settings["seed"] = json!(0);
    let zero: Converge = serde_json::from_value(settings.clone()).unwrap();
    assert_eq!(Clock::new(&zero, &sample(0)).unwrap().seed, 0.0);
    settings["seed"] = json!(u32::MAX);
    let max: Converge = serde_json::from_value(settings).unwrap();
    let mut s = sample(0);
    s.seed = 1;
    assert_eq!(Clock::new(&max, &s).unwrap().seed, 0.0);
}

#[test]
fn shard_raster_transport_preserves_original_native_transform_parameters_and_order() {
    use super::plan::Operation;
    let mut settings = author();
    settings["seed"] = json!(7);
    settings["whiteAtTicks"] = json!(1890000);
    settings["beats"]["songTicks"] = json!([
        1410000, 1464000, 1530000, 1596000, 1662000, 1728000, 1794000, 1860000, 1926000, 1992000,
        2058000
    ]);
    let model: Converge = serde_json::from_value(settings).unwrap();
    let mut s = sample(1710000);
    s.shot_start_ticks = 1470000;
    let plan = model.plan(&s).unwrap();
    // Original browser trace: frame120, shard23, paints2657..2659. Flattening
    // this transform changed55 pixels, although local paths and paint matched.
    let Command::Path {
        transform,
        operations,
        ..
    } = &plan.commands[2629]
    else {
        panic!("shard")
    };
    assert_eq!(*transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    let [
        Operation::Translate { offset },
        Operation::Rotate { radians },
        Operation::Scale { factors },
    ] = operations.as_slice()
    else {
        panic!("preserve translate/rotate/scale; never premultiply")
    };
    assert_eq!(*radians, 53.18851893348619);
    assert_eq!(factors[0], 1.0);
    assert!((factors[1] - 0.9196420199716677).abs() < 1e-14);
    assert!((offset[0] - 1255.737720344645).abs() < 1e-10);
    assert!((offset[1] - 609.1266573800598).abs() < 1e-10);
}
