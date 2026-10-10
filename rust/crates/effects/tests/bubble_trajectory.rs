#[path = "../src/bubble/trajectory.rs"]
mod trajectory;

use trajectory::*;

fn config() -> Config {
    Config {
        start_ticks: 0,
        duration_ticks: 360_000,
        follow: 0.5,
        trail: 24,
        trail_duration_ticks: 46_000,
    }
}

fn points() -> [Point; 3] {
    [
        Point {
            ticks: 0,
            position: [0.1, 0.2],
        },
        Point {
            ticks: 120_000,
            position: [0.8, 0.2],
        },
        Point {
            ticks: 180_000,
            position: [0.8, 0.9],
        },
    ]
}

fn sample(curve: &Trajectory, ticks: i64) -> Frame {
    curve.sample(ticks).unwrap().unwrap()
}

fn near(a: [f64; 2], b: [f64; 2], tolerance: f64) {
    for axis in 0..2 {
        assert!((a[axis] - b[axis]).abs() <= tolerance, "{a:?} != {b:?}");
    }
}

#[test]
fn zero_and_one_follow_have_exact_defined_semantics() {
    let mut settings = config();
    settings.follow = 0.0;
    let fixed = Trajectory::new(settings, &points()).unwrap();
    assert_eq!(sample(&fixed, 300_000).centers, vec![[0.1, 0.2]; 24]);
    settings.follow = 1.0;
    let exact = Trajectory::new(settings, &points()).unwrap();
    near(sample(&exact, 60_000).centers[0], [0.45, 0.2], 1e-15);
    near(sample(&exact, 150_000).centers[0], [0.8, 0.55], 1e-15);
    assert_eq!(sample(&exact, 230_000).centers, vec![[0.8, 0.9]; 24]);
}

#[test]
fn fractional_lags_are_not_quantized_to_output_frames() {
    let mut settings = config();
    settings.follow = 1.0;
    settings.trail = 4;
    settings.trail_duration_ticks = 10;
    let path = [
        Point {
            ticks: 0,
            position: [0.0, 0.5],
        },
        Point {
            ticks: 120_000,
            position: [1.0, 0.5],
        },
    ];
    let curve = Trajectory::new(settings, &path).unwrap();
    let frame = sample(&curve, 6_000);
    for (index, center) in frame.centers.iter().enumerate() {
        near(
            *center,
            [(18_000.0 - 10.0 * index as f64) / 360_000.0, 0.5],
            1e-15,
        );
    }
    assert_ne!(frame.centers[0], frame.centers[1]);
    let initial = sample(&curve, 1);
    assert_eq!(&initial.centers[1..], &[[0.0, 0.5]; 3]);
}

#[test]
fn exact_follow_returns_authored_knot_bits_without_lerp_roundoff() {
    let path = [
        Point {
            ticks: 0,
            position: [2.0, -1.0],
        },
        Point {
            ticks: 12_000,
            position: [0.1, 0.3],
        },
    ];
    let curve = Trajectory::new(
        Config {
            follow: 1.0,
            ..config()
        },
        &path,
    )
    .unwrap();
    assert_ne!((2.0_f64 + (0.1 - 2.0)).to_bits(), 0.1_f64.to_bits());
    for time in [12_000, 58_000] {
        assert_eq!(
            sample(&curve, time).centers[0].map(f64::to_bits),
            path[1].position.map(f64::to_bits)
        );
    }
}

#[test]
fn linear_ramp_matches_independent_closed_form() {
    let settings = Config {
        trail: 1,
        ..config()
    };
    let path = [
        Point {
            ticks: 0,
            position: [0.0, 1.0],
        },
        Point {
            ticks: 120_000,
            position: [1.0, 0.0],
        },
    ];
    let curve = Trajectory::new(settings, &path).unwrap();
    let lambda = 60.0 * std::f64::consts::LN_2;
    for ticks in [1, 37, 4_000, 60_000, 120_000] {
        let seconds = ticks as f64 / 120_000.0;
        let x = seconds - (1.0 - (-lambda * seconds).exp()) / lambda;
        near(sample(&curve, ticks).centers[0], [x, 1.0 - x], 1e-15);
    }
    let at_one = 1.0 - (1.0 - (-lambda).exp()) / lambda;
    let expected = 1.0 + (at_one - 1.0) * (-lambda * 0.25).exp();
    near(
        sample(&curve, 150_000).centers[0],
        [expected, 1.0 - expected],
        1e-15,
    );
}

// Independent small-step RK4 integrates the ODE; it does not reuse segment
// response, lag evaluation, or the closed-form update in the implementation.
fn rk4(seconds: f64, follow: f64) -> [f64; 2] {
    let target = |t: f64| {
        if t <= 1.0 {
            [0.1 + 0.7 * t, 0.2]
        } else if t <= 1.5 {
            [0.8, 0.2 + 1.4 * (t - 1.0)]
        } else {
            [0.8, 0.9]
        }
    };
    let lambda = -60.0 * (1.0 - follow).ln();
    let steps = (seconds * 10_000.0).round() as usize;
    let dt = seconds / steps as f64;
    let slope = |t: f64, h: [f64; 2]| [0, 1].map(|axis| lambda * (target(t)[axis] - h[axis]));
    let mut h = [0.1, 0.2];
    for index in 0..steps {
        let t = index as f64 * dt;
        let a = slope(t, h);
        let b = slope(t + dt / 2.0, [0, 1].map(|i| h[i] + dt / 2.0 * a[i]));
        let c = slope(t + dt / 2.0, [0, 1].map(|i| h[i] + dt / 2.0 * b[i]));
        let d = slope(t + dt, [0, 1].map(|i| h[i] + dt * c[i]));
        h = [0, 1].map(|i| h[i] + dt / 6.0 * (a[i] + 2.0 * b[i] + 2.0 * c[i] + d[i]));
    }
    h
}

#[test]
fn turning_and_stopped_paths_match_independent_integrator() {
    for follow in [0.05, 0.5, 0.9] {
        let curve = Trajectory::new(
            Config {
                follow,
                trail: 1,
                ..config()
            },
            &points(),
        )
        .unwrap();
        for ticks in [60_000, 120_000, 150_000, 180_000, 240_000] {
            near(
                sample(&curve, ticks).centers[0],
                rk4(ticks as f64 / 120_000.0, follow),
                1e-11,
            );
        }
    }
}

#[test]
fn output_is_order_independent_and_large_starts_keep_fractional_lag() {
    let settings = config();
    let curve = Trajectory::new(settings, &points()).unwrap();
    let epoch = MAX_SAFE_TICKS - settings.duration_ticks;
    let shifted = Trajectory::new(
        Config {
            start_ticks: epoch,
            ..settings
        },
        &points(),
    )
    .unwrap();
    let times = [0, 4_004, 18_731, 120_000, 180_000, 240_000, 359_999];
    let expected: Vec<_> = times.iter().map(|t| sample(&curve, *t)).collect();
    for index in [6, 1, 4, 0, 5, 2, 3, 6, 0] {
        assert_eq!(sample(&curve, times[index]), expected[index]);
        assert_eq!(
            sample(&shifted, epoch as i64 + times[index]),
            expected[index]
        );
    }
}

#[test]
fn activity_is_half_open_and_invalid_sample_ticks_are_rejected() {
    let curve = Trajectory::new(
        Config {
            start_ticks: 1_000,
            ..config()
        },
        &points(),
    )
    .unwrap();
    assert_eq!(curve.sample(-1).unwrap(), None);
    assert_eq!(curve.sample(999).unwrap(), None);
    assert!(curve.sample(1_000).unwrap().is_some());
    assert!(curve.sample(360_999).unwrap().is_some());
    assert_eq!(curve.sample(361_000).unwrap(), None);
    assert_eq!(curve.sample(i64::MIN), Err(Error::InvalidSampleTime));
    assert_eq!(
        curve.sample(MAX_SAFE_TICKS as i64 + 1),
        Err(Error::InvalidSampleTime)
    );
}

#[test]
fn extreme_finite_follow_values_and_short_segments_remain_finite() {
    let path = [
        Point {
            ticks: 0,
            position: [-1.0, 2.0],
        },
        Point {
            ticks: 1,
            position: [2.0, -1.0],
        },
        Point {
            ticks: 2,
            position: [-1.0, 2.0],
        },
    ];
    for follow in [f64::from_bits(1), 1e-12, 1e-6, 0.5, 1.0_f64.next_down()] {
        let curve = Trajectory::new(Config { follow, ..config() }, &path).unwrap();
        for tick in [0, 1, 2, 10, 1000, 359999] {
            let frame = sample(&curve, tick);
            assert!(
                frame
                    .centers
                    .iter()
                    .flatten()
                    .all(|v| v.is_finite() && *v >= -1.000000000001 && *v <= 2.000000000001)
            );
        }
    }
}

#[test]
fn maximum_schedule_is_bounded_by_384_segment_visits() {
    let path: Vec<_> = (0..16)
        .map(|i| Point {
            ticks: i * 1000,
            position: [i as f64 / 15.0, (i % 2) as f64],
        })
        .collect();
    let curve = Trajectory::new(config(), &path).unwrap();
    let frame = sample(&curve, 359_999);
    assert_eq!(frame.centers.len(), 24);
    assert_eq!(frame.segment_visits, 384);
    let single = Trajectory::new(
        config(),
        &[Point {
            ticks: 0,
            position: [0.5, 0.5],
        }],
    )
    .unwrap();
    assert_eq!(sample(&single, 359_999).centers, vec![[0.5, 0.5]; 24]);
}

#[test]
fn malformed_schedules_cannot_enter_the_evaluator() {
    let reject = |cfg, pts: &[Point], error| {
        assert!(matches!(Trajectory::new(cfg, pts), Err(e) if e == error))
    };
    reject(
        Config {
            start_ticks: MAX_SAFE_TICKS,
            ..config()
        },
        &points(),
        Error::InvalidActivity,
    );
    reject(
        Config {
            duration_ticks: 999,
            ..config()
        },
        &points(),
        Error::InvalidActivity,
    );
    reject(
        Config {
            follow: f64::NAN,
            ..config()
        },
        &points(),
        Error::InvalidFollow,
    );
    reject(
        Config {
            follow: 1.01,
            ..config()
        },
        &points(),
        Error::InvalidFollow,
    );
    reject(
        Config {
            trail: 25,
            ..config()
        },
        &points(),
        Error::InvalidTrail,
    );
    reject(
        Config {
            trail: 0,
            ..config()
        },
        &points(),
        Error::InvalidTrail,
    );
    reject(
        Config {
            trail_duration_ticks: 120001,
            ..config()
        },
        &points(),
        Error::InvalidTrail,
    );
    reject(config(), &[], Error::InvalidPointCount);
    reject(config(), &[points()[0]; 17], Error::InvalidPointCount);
    reject(config(), &points()[1..], Error::InvalidPointTime);
    reject(config(), &[points()[0]; 2], Error::InvalidPointTime);
    reject(
        config(),
        &[
            points()[0],
            Point {
                ticks: 360001,
                position: [0.5; 2],
            },
        ],
        Error::InvalidPointTime,
    );
    reject(
        config(),
        &[Point {
            ticks: 0,
            position: [f64::INFINITY, 0.5],
        }],
        Error::InvalidPosition,
    );
    reject(
        config(),
        &[Point {
            ticks: 0,
            position: [-1.01, 0.5],
        }],
        Error::InvalidPosition,
    );
}
