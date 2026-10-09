use super::{
    draw::*,
    math::*,
    model::Palette,
    plan::{Operation, Step},
};

type Point = [f64; 3];
struct Crack {
    points: Vec<Point>,
    length: f64,
    start: f64,
    width: f64,
}
fn range(rng: &mut Rng, a: f64, b: f64) -> f64 {
    a + (b - a) * rng.next()
}
fn along(points: &[Point], distance: f64) -> Option<[f64; 2]> {
    points.windows(2).find(|p| p[1][2] >= distance).map(|p| {
        let fraction = (distance - p[0][2]) / (p[1][2] - p[0][2]);
        [
            lerp(p[0][0], p[1][0], fraction),
            lerp(p[0][1], p[1][1], fraction),
        ]
    })
}
fn make(seed: f64, radius: f64) -> Vec<Crack> {
    let mut rng = Rng::new(seed);
    let mut lines = Vec::new();
    let mut radials = Vec::new();
    for i in 0..17 {
        let angle = i as f64 / 17.0 * TAU + range(&mut rng, -0.2, 0.2);
        let length = if rng.next() < 0.3 {
            range(&mut rng, 180.0, 380.0)
        } else {
            range(&mut rng, 420.0, 1150.0)
        };
        let (mut x, mut y, mut distance) = (angle.cos() * radius, angle.sin() * radius, 0.0);
        let mut points = vec![[x, y, 0.0]];
        while distance < length {
            let step = range(&mut rng, 50.0, 140.0);
            let heading = angle + range(&mut rng, -0.13, 0.13);
            x += heading.cos() * step;
            y += heading.sin() * step;
            distance += step;
            points.push([x, y, distance]);
        }
        radials.push(points.clone());
        lines.push(Crack {
            points: points.clone(),
            length: distance,
            start: 0.0,
            width: range(&mut rng, 1.0, 2.2),
        });
        for _ in 0..2 {
            if rng.next() >= 0.55 {
                continue;
            }
            let start = range(&mut rng, 0.2, 0.8) * distance;
            let Some(p) = along(&points, start) else {
                continue;
            };
            let sign = if rng.next() < 0.5 { -1.0 } else { 1.0 };
            let heading = angle + sign * range(&mut rng, 0.45, 1.0);
            let length = range(&mut rng, 40.0, 190.0);
            let x = p[0] + (heading + range(&mut rng, -0.2, 0.2)).cos() * length;
            let y = p[1] + (heading + range(&mut rng, -0.2, 0.2)).sin() * length;
            lines.push(Crack {
                points: vec![
                    [p[0], p[1], 0.0],
                    [
                        p[0] + heading.cos() * length * 0.55,
                        p[1] + heading.sin() * length * 0.55,
                        length * 0.55,
                    ],
                    [x, y, length],
                ],
                length,
                start,
                width: range(&mut rng, 0.6, 1.2),
            });
        }
    }
    // JavaScript constructs the entire three-item array before iterating it.
    let rings = [
        range(&mut rng, 130.0, 200.0),
        range(&mut rng, 330.0, 460.0),
        range(&mut rng, 620.0, 760.0),
    ];
    for ring in rings {
        for i in 0..17 {
            if rng.next() < 0.45 {
                continue;
            }
            let a = along(&radials[i], ring * range(&mut rng, 0.92, 1.08));
            let b = along(&radials[(i + 1) % 17], ring * range(&mut rng, 0.92, 1.08));
            let (Some(a), Some(b)) = (a, b) else { continue };
            let mx = (a[0] + b[0]) / 2.0;
            let my = (a[1] + b[1]) / 2.0;
            let k = range(&mut rng, 0.97, 1.06);
            let length1 = (mx * k - a[0]).hypot(my * k - a[1]);
            let length = length1 + (b[0] - mx * k).hypot(b[1] - my * k);
            lines.push(Crack {
                points: vec![
                    [a[0], a[1], 0.0],
                    [mx * k, my * k, length1],
                    [b[0], b[1], length],
                ],
                length,
                start: ring * 1.05,
                width: range(&mut rng, 0.6, 1.3),
            });
        }
    }
    lines
}
pub(super) fn draw(d: &mut Draw, seed: f64, radius: f64, front: f64, alpha: f64, p: &Palette) {
    if front <= 0.0 {
        return;
    }
    let lines = make(seed, radius);
    let mut tips = Vec::new();
    let depth = d.operations.len();
    d.operations.push(Operation::Translate {
        offset: [960.0, 540.0],
    });
    for (color, width, gain) in [
        (p.sunset, 5.5, 0.2),
        (p.glow, 2.2, 0.42),
        (p.core, 0.9, 0.95),
    ] {
        for ln in &lines {
            let visible = front - ln.start;
            if visible <= 0.0 {
                continue;
            }
            let mut end = [ln.points[0][0], ln.points[0][1]];
            let mut path = vec![Step::MoveTo { point: end }];
            for pair in ln.points.windows(2) {
                let [a, b] = pair else { unreachable!() };
                if b[2] <= visible {
                    end = [b[0], b[1]];
                    path.push(Step::LineTo { point: end });
                    continue;
                }
                let fraction = (visible - a[2]) / (b[2] - a[2]);
                end = [lerp(a[0], b[0], fraction), lerp(a[1], b[1], fraction)];
                path.push(Step::LineTo { point: end });
                break;
            }
            d.path(
                path,
                vec![stroke(
                    solid(rgba(color, gain * alpha)),
                    ln.width * width,
                    "round",
                    "round",
                )],
            );
            if width == 0.9 && visible < ln.length {
                tips.push(end)
            }
        }
    }
    for [x, y] in tips {
        d.glow(
            x,
            y,
            7.0,
            &[(0.0, rgba(p.core, 0.7)), (1.0, rgba(p.glow, 0.0))],
            "lighter",
        );
    }
    d.operations.truncate(depth);
}
