use super::{Sample, draw::*, motion::Timing};
pub fn finish(d: &mut Draw, t: f64, timing: &Timing, win: f64, s: &Sample<'_>) {
    let beats: Vec<f64> = s.beats.iter().map(|v| *v as f64 / 120000.0).collect();
    let count = beats.partition_point(|v| *v <= t);
    let idx = count as i32 - 1;
    let down = if idx >= 0 && (idx - s.downbeat_index).rem_euclid(4) == 0 {
        (-5.0 * (t - beats[idx as usize])).exp()
    } else {
        0.0
    };
    let flare = (-(t - timing.start).max(0.0) * 3.0).exp() * 0.5
        + (-(t - timing.push).abs() * 5.0).exp() * 0.3
        + 0.2 * down;
    for (xy, r, c, a) in [
        (
            [
                -80.0 + 60.0 * super::math::fbm1(t * 0.2, 1.0),
                180.0 + 120.0 * super::math::fbm1(t * 0.17, 2.0),
            ],
            620.0,
            [240.0, 140.0, 90.0],
            0.26,
        ),
        (
            [1980.0, 860.0 + 90.0 * super::math::fbm1(t * 0.15, 3.0)],
            700.0,
            [201.0, 141.0, 134.0],
            0.22,
        ),
        (
            [1250.0 + 200.0 * super::math::fbm1(t * 0.1, 4.0), -140.0],
            520.0,
            [255.0, 200.0, 150.0],
            0.12,
        ),
    ] {
        let al = a * (0.45 + 0.55 * win) * (0.8 + flare);
        let [x, y] = xy;
        d.rect(
            [x - r, y - r, r * 2.0, r * 2.0],
            fill(
                radial(
                    [x, y, 0.0],
                    [x, y, r],
                    &[
                        (0.0, color(c[0], c[1], c[2], al)),
                        (0.45, color(c[0], c[1], c[2], al * 0.4)),
                        (1.0, color(c[0], c[1], c[2], 0.0)),
                    ],
                ),
                "screen",
            ),
        );
    }
    for i in 0..46 {
        let i = i as f64;
        let x = (super::math::rnd(&[i, 451.0]) + t * 0.004 * (1.0 + super::math::rnd(&[i, 454.0])))
            .rem_euclid(1.0)
            * 1920.0;
        let y = (super::math::rnd(&[i, 452.0]) + (t * 0.3 + i).sin() * 0.01 - t * 0.003)
            .rem_euclid(1.0)
            * 1080.0;
        let r = 0.8 + 2.2 * super::math::rnd(&[i, 453.0]);
        let mut p = fill(
            solid(color(255.0, 228.0, 190.0, 0.35 * (0.4 + 0.6 * win))),
            "source-over",
        );
        p.opacity = 0.3 + 0.7 * (t * 0.7 + i).sin().abs();
        d.path(vec![arc([x, y], r)], vec![p]);
    }
    for i in 0..9 {
        let i = i as f64;
        let x = (super::math::rnd(&[i, 61.0]) + t * 0.006 * (1.0 + super::math::rnd(&[i, 62.0])))
            .rem_euclid(1.0)
            * 2120.0
            - 100.0;
        let y = super::math::rnd(&[i, 63.0]) * 1080.0 + (t * 0.4 + i).sin() * 20.0;
        let r = 18.0 + 40.0 * super::math::rnd(&[i, 64.0]);
        let a = (0.035 + 0.05 * super::math::rnd(&[i, 65.0]))
            * (0.5 + 0.5 * win)
            * (0.6 + 0.4 * (t * 0.8 + i * 2.0).sin());
        d.rect(
            [x - r, y - r, r * 2.0, r * 2.0],
            fill(
                radial(
                    [x, y, r * 0.55],
                    [x, y, r],
                    &[
                        (0.0, color(255.0, 225.0, 190.0, a)),
                        (0.85, color(255.0, 225.0, 190.0, a * 1.4)),
                        (1.0, color(255.0, 225.0, 190.0, 0.0)),
                    ],
                ),
                "lighter",
            ),
        );
    }
    d.rect(
        [0.0, 0.0, 1920.0, 1080.0],
        fill(
            radial(
                [960.0, 540.0, 1080.0 * 0.28],
                [960.0, 540.0, 1080.0 * 1.02],
                &[
                    (0.0, color(18.0, 12.0, 10.0, 0.0)),
                    (1.0, color(12.0, 8.0, 7.0, 0.72 - 0.12 * win)),
                ],
            ),
            "source-over",
        ),
    );
}
