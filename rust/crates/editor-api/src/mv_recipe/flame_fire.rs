use super::{draw::*, math::*, plan::*, raster::glow};

fn tongue(path: &mut Vec<Step>, x: f64, y: f64, h: f64, w: f64, lean: f64, t: f64, seed: f64) {
    let mut left = Vec::with_capacity(19);
    let mut right = Vec::with_capacity(19);
    for i in 0..=18 {
        let s = i as f64 / 18.0;
        let sw = s.powf(1.6);
        let cx = x
            + lean * h * s.powf(1.4)
            + h * 0.13 * sw * (t * 7.3 + seed * 2.1 - s * 3.4).sin()
            + h * 0.05 * sw * (t * 12.9 + seed * 5.0 - s * 6.5).sin();
        let profile = (std::f64::consts::PI * s.powf(0.5)).sin().powf(1.25)
            * (1.0 + 0.09 * (s * 13.0 - t * 9.0 + seed * 3.0).sin());
        left.push([cx - w * profile, y - h * s]);
        right.push([cx + w * profile, y - h * s]);
    }
    path.push(Step::MoveTo { point: left[0] });
    path.extend(left.into_iter().map(|point| Step::LineTo { point }));
    path.extend(right.into_iter().rev().map(|point| Step::LineTo { point }));
    path.push(Step::Close);
}

pub(super) fn draw(
    d: &mut Draw,
    x: f64,
    y: f64,
    size: f64,
    intensity: f64,
    tq: f64,
    gain: f64,
) -> f64 {
    if intensity <= 0.003 {
        return 0.0;
    }
    let fl = 1.0 + 0.08 * noise(tq * 6.0, 3.0) + 0.05 * noise(tq * 13.0, 7.0);
    let h = size * (0.14 + 0.86 * intensity.powf(0.85)) * fl;
    let w = h * (0.26 + 0.24 * (1.0 - clamp(intensity)));
    let ia = intensity.clamp(0.0, 2.0).powf(0.8);
    glow(
        d,
        x,
        y - h * 0.4,
        h * 3.2,
        rgb(255, 74, 32, 1.0),
        0.16 * ia * gain,
    );
    glow(
        d,
        x,
        y - h * 0.32,
        h * 1.1,
        rgb(255, 179, 92, 1.0),
        0.2 * ia * gain,
    );
    if intensity < 0.6 {
        let b = 1.0 - intensity / 0.6;
        d.rect(
            [x - w * 1.4, y - h * 0.15 - w * 1.4, w * 2.8, w * 2.8],
            fill(
                radial(
                    x,
                    y - h * 0.15,
                    w * 1.3,
                    &[
                        (0.0, rgb(159, 192, 255, 0.9 * b)),
                        (0.55, rgb(58, 107, 216, 0.55 * b)),
                        (1.0, rgb(58, 107, 216, 0.0)),
                    ],
                ),
                "lighter",
            ),
        );
    }
    if intensity > 0.25 {
        for j in 0..3 {
            let jf = j as f64;
            let phase = tq * (1.3 + 0.3 * jf) + jf / 3.0;
            let k = fract(phase);
            let seed = phase.floor();
            let wx = x + signed3(seed, jf, 61.0) * w * 0.9 + (k * 5.0 + jf).sin() * w * 0.3;
            let wy = y - h * (0.88 + 0.8 * k);
            let ws = h * 0.2 * (1.0 - k) * clamp((intensity - 0.25) * 2.0);
            if ws < 1.0 {
                continue;
            }
            for (col, lift, hk, wk) in [
                (rgb(255, 122, 46, 1.0), 0.0, 1.0, 0.3),
                (rgb(255, 210, 122, 1.0), 0.05, 0.55, 0.15),
            ] {
                let mut p = vec![];
                tongue(
                    &mut p,
                    wx,
                    wy - ws * lift,
                    ws * hk,
                    ws * wk,
                    0.0,
                    tq,
                    20.0 + jf,
                );
                let mut paint = fill(solid(col), "source-over");
                paint.opacity = 1.0 - k * 0.6;
                d.path(p, vec![paint]);
            }
        }
    }
    let tongues = [
        (0.0, 1.0, 1.0, 0.0, 0.0, 0.0),
        (
            -0.5,
            0.56 + 0.16 * noise(tq * 5.0, 11.0),
            0.5,
            -0.3,
            1.0,
            0.1,
        ),
        (
            0.52,
            0.5 + 0.18 * noise(tq * 5.5, 12.0),
            0.46,
            0.34,
            2.0,
            0.12,
        ),
        (
            -0.22,
            0.78 + 0.14 * noise(tq * 4.0, 13.0),
            0.4,
            -0.1,
            3.0,
            0.04,
        ),
        (
            0.26,
            0.7 + 0.14 * noise(tq * 4.5, 14.0),
            0.36,
            0.14,
            4.0,
            0.05,
        ),
    ];
    for (col, k, lift) in [
        (rgb(224, 69, 44, 1.0), 1.0, 0.0),
        (rgb(255, 122, 46, 1.0), 0.8, 0.05),
        (rgb(255, 180, 69, 1.0), 0.6, 0.1),
        (rgb(255, 230, 166, 1.0), 0.4, 0.14),
        (rgb(255, 253, 245, 1.0), 0.22, 0.17),
    ] {
        let mut path = vec![];
        for (dx, th, tw, lean, sd, bl) in tongues {
            if k < 0.5 && sd > 2.0 {
                continue;
            }
            tongue(
                &mut path,
                x + dx * w * k,
                y - (lift + bl * k) * h,
                h * th * f64::powf(k, 0.9),
                w * tw * k,
                lean,
                tq,
                sd,
            );
        }
        // All tongues in one layer are ONE path and ONE fill, as in Canvas.
        d.path(path, vec![fill(solid(col), "source-over")]);
    }
    h
}

pub(super) fn sparks(d: &mut Draw, x: f64, y: f64, age: f64, scale: f64) {
    for i in 0..34 {
        let i = i as f64;
        let life = 0.45 + 0.7 * rnd(i, 9.0);
        if age > life {
            continue;
        }
        let angle = -std::f64::consts::PI / 2.0 + rnds(i, 10.0) * 1.25;
        let speed = (380.0 + 820.0 * rnd(i, 11.0)) * scale;
        let pos = |t: f64| {
            let f = (1.0 - (-3.2 * t).exp()) / 3.2;
            [
                x + angle.cos() * speed * f,
                y + angle.sin() * speed * f - 60.0 * scale * t * t,
            ]
        };
        let k = age / life;
        let color = if k < 0.4 {
            rgb(255, 241, 200, 0.95 * (1.0 - k))
        } else {
            rgb(255, 165, 82, 0.95 * (1.0 - k))
        };
        d.path(
            line(pos((age - 0.035).max(0.0)), pos(age)),
            vec![stroke(
                solid(color),
                (1.2 + 1.6 * rnd(i, 12.0)) * scale * (1.0 - 0.5 * k),
                "round",
                "miter",
            )],
        );
    }
}
