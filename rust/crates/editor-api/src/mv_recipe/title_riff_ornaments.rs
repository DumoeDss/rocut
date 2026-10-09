use super::{
    clock::Clock,
    draw::*,
    ease::ease,
    labels::Label,
    math::*,
    model::{Easing, TitleRiff},
    palette::Palette,
    plan::*,
    raster::*,
    state::State,
};
use crate::mv_font_metrics::Context;

pub(super) fn measure(d: &mut Draw, a: &TitleRiff, c: &Clock, s: &State, p: &Palette) {
    let fade = 1.0 - s.exit;
    if fade <= 0.0 {
        return;
    }
    let t = c.time;
    let q = a.cues;
    let x = s.x;
    let y = s.y;
    let gap = s.radius * 1.62;
    let stroke = || source_stroke(solid(rgba(p.hi, 0.32 * fade)), 1.0);
    let hx = ease(seg(t, c.at(q.sun) + 0.05, 0.7), Easing::Out) * 1100.0;
    let mut path = line([x - gap, y], [x - gap - hx, y]);
    path.extend(line([x + gap, y], [x + gap + hx, y]));
    d.path(path, vec![stroke()]);
    let mut path = Vec::new();
    let mut at = gap + 24.0;
    let mut index = 1;
    while at < gap + hx {
        let length = if index % 5 == 0 { 10.0 } else { 4.0 };
        path.extend(line([x - at, y - length], [x - at, y]));
        path.extend(line([x + at, y - length], [x + at, y]));
        at += 24.0;
        index += 1;
    }
    d.path(path, vec![stroke()]);
    let vy = ease(seg(t, c.at(q.hud) + 0.02, 0.7), Easing::Out) * 800.0;
    let mut path = line([x, y - gap], [x, y - gap - vy]);
    path.extend(line([x, y + gap], [x, y + gap + vy]));
    d.path(path, vec![stroke()]);
    let f = ease(seg(t, c.at(q.hud2), 0.8), Easing::Out);
    let mut path = line([-400.0, 132.0], [-400.0 + 2720.0 * f, 132.0]);
    path.extend(line([2320.0, 948.0], [2320.0 - 2720.0 * f, 948.0]));
    d.path(
        path,
        vec![source_stroke(solid(rgba(p.hi, 0.18 * fade)), 1.0)],
    );
}
pub(super) fn crossbuck(d: &mut Draw, a: &TitleRiff, c: &Clock, s: &State, p: &Palette) {
    let t = c.time;
    let start = c.at(a.cues.cross);
    if t < start {
        return;
    }
    let k = ease(seg(t, start, 0.55), Easing::Out);
    let fade = (1.0 - s.exit) * lerp(1.0, 0.5, s.lock);
    let mut flick = 0.0;
    for (i, b) in c.cues.iter().enumerate() {
        if *b > start && t >= *b {
            let x = clamp((t - b) / 0.18) - 1.0;
            flick += (if i % 2 == 1 { 1.0 } else { -1.0 })
                * 0.018
                * (1.0 + 3.0 * x.powi(3) + 2.0 * x * x)
                * (1.0 - s.lock);
        }
    }
    let base = d.operations.clone();
    let radius = s.radius * 1.66;
    let length = 1500.0 * k;
    let half = 23.0;
    let step = 44.0;
    for sign in [1.0, -1.0] {
        for side in [0.0, 1.0] {
            d.operations = base.clone();
            d.operations
                .push(Operation::Translate { offset: [s.x, s.y] });
            d.operations.push(Operation::Rotate {
                radians: sign * (0.7 + flick) + side * std::f64::consts::PI,
            });
            d.clip = Some(Clip {
                transform: IDENTITY,
                operations: d.operations.clone(),
                path: rect_path([radius, -half, length, 2.0 * half]),
            });
            let mut path = Vec::new();
            let mut at = radius - step;
            while at < radius + length {
                path.extend([
                    Step::MoveTo { point: [at, half] },
                    Step::LineTo {
                        point: [at + step * 0.5, half],
                    },
                    Step::LineTo {
                        point: [at + step * 0.5 + 2.0 * half * 0.7, -half],
                    },
                    Step::LineTo {
                        point: [at + 2.0 * half * 0.7, -half],
                    },
                    Step::Close,
                ]);
                at += step;
            }
            d.path(
                path,
                vec![fill(solid(rgba(p.verm, 0.5 * fade)), "source-over")],
            );
            d.rect(
                [radius + 0.75, -half + 0.75, length - 1.5, 2.0 * half - 1.5],
                source_stroke(solid(rgba(p.hi, 0.55 * fade)), 1.5),
            );
            d.clip = None;
        }
    }
    d.operations = base;
}
pub(super) fn rings(
    d: &mut Draw,
    a: &TitleRiff,
    c: &Clock,
    s: &State,
    p: &Palette,
    labels: &[Label],
    metrics: &Context,
) -> Result<(), String> {
    let start = c.at(a.cues.sun);
    let t = c.time;
    let fade = 1.0 - s.exit;
    if t < start || fade <= 0.0 {
        return Ok(());
    }
    let x = s.x;
    let y = s.y;
    let r = s.radius;
    let steps = c
        .cues
        .iter()
        .filter(|b| t >= **b)
        .map(|b| {
            let k = clamp((t - b) / 0.2) - 1.0;
            1.0 + 3.2 * k.powi(3) + 2.2 * k * k
        })
        .sum::<f64>();
    let rotation = steps * TAU / 48.0;
    let draw = |i: f64, delay: f64| ease(seg(t, start + 0.06 * i + delay, 0.55), Easing::Out);
    let half_pi = std::f64::consts::FRAC_PI_2;
    d.path(
        vec![arc(
            x,
            y,
            r * 1.12,
            -half_pi,
            -half_pi + TAU * draw(0.0, 0.0),
            false,
        )],
        vec![source_stroke(solid(rgba(p.hi, 0.55 * fade)), 1.5)],
    );
    let angle = -half_pi - rotation * 0.5 - t * 0.25;
    let end = angle + TAU * 0.83 * draw(1.0, 0.0);
    d.path(
        vec![arc(x, y, r * 1.23, angle, end, false)],
        vec![source_stroke(solid(rgba(p.verm, 0.95 * fade)), 6.0)],
    );
    d.path(
        circle(x + end.cos() * r * 1.23, y + end.sin() * r * 1.23, 5.0),
        vec![fill(solid(rgba(p.hi, fade)), "source-over")],
    );
    let drawn = draw(2.0, 0.25);
    let mut path = Vec::new();
    let mut i = 0;
    while (i as f64) < 120.0 * drawn {
        let angle = rotation + i as f64 / 120.0 * TAU;
        let length = if i % 10 == 0 {
            16.0
        } else if i % 5 == 0 {
            9.0
        } else {
            5.0
        };
        let radius = r * 1.34;
        path.extend(line(
            [x + angle.cos() * radius, y + angle.sin() * radius],
            [
                x + angle.cos() * (radius + length),
                y + angle.sin() * (radius + length),
            ],
        ));
        i += 1;
    }
    d.path(
        path,
        vec![source_stroke(solid(rgba(p.hi, 0.6 * fade)), 1.2)],
    );
    for label in labels.iter().filter(|v| v.layer == 0) {
        super::text::draw(d, label, metrics)?;
    }
    if a.cues.sil >= 0 {
        let k = ease(
            seg(t, c.at(a.cues.sil), c.at(a.cues.lock) - c.at(a.cues.sil)),
            Easing::Io,
        );
        if k > 0.0 {
            d.path(
                vec![arc(x, y, r * 1.5, -half_pi, -half_pi + TAU * k, false)],
                vec![source_stroke(
                    solid(rgba(p.glow, 0.9 * fade * (1.0 - 0.6 * s.lock))),
                    2.5,
                )],
            );
        }
    }
    d.path(
        vec![arc(
            x,
            y,
            r * 2.35,
            -half_pi,
            -half_pi + TAU * draw(4.0, 0.3),
            false,
        )],
        vec![source_stroke(solid(rgba(p.hi, 0.14 * fade)), 1.0)],
    );
    let angle = t * 0.9 + rotation;
    d.path(
        circle(x + angle.cos() * r * 2.35, y + angle.sin() * r * 2.35, 4.0),
        vec![fill(
            solid(rgba(p.glow, 0.8 * fade * draw(4.0, 0.5))),
            "source-over",
        )],
    );
    Ok(())
}
pub(super) fn lockup(
    d: &mut Draw,
    a: &TitleRiff,
    c: &Clock,
    p: &Palette,
    labels: &[Label],
    metrics: &Context,
) -> Result<(), String> {
    for label in labels.iter().filter(|v| v.layer == 2) {
        super::text::draw(d, label, metrics)?;
        if label.size == 28.0 {
            let width = 290.0 * ease(seg(c.time, c.at(a.cues.lock) + 0.2, 0.8), Easing::Out);
            let mut path = line([960.0 - width, 908.0], [960.0 + width, 908.0]);
            path.extend(line([960.0 - width, 902.0], [960.0 - width, 914.0]));
            path.extend(line([960.0 + width, 902.0], [960.0 + width, 914.0]));
            let mut paint = source_stroke(solid(rgba(p.hi, 0.4)), 1.0);
            paint.opacity = 1.0 - ease(seg(c.time, c.at(a.cues.exit), 0.3), Easing::Out);
            d.path(path, vec![paint]);
        }
    }
    Ok(())
}
pub(super) fn hud(
    d: &mut Draw,
    a: &TitleRiff,
    c: &Clock,
    s: &State,
    p: &Palette,
    labels: &[Label],
    metrics: &Context,
) -> Result<(), String> {
    if s.exit >= 1.0 {
        return Ok(());
    }
    for label in labels.iter().filter(|v| v.layer == 3) {
        super::text::draw(d, label, metrics)?;
    }
    let k = ease(seg(c.time, c.at(a.cues.hud), 0.5), Easing::Out) * 18.0;
    let mut path = Vec::new();
    for [x, y, sx, sy] in [
        [56.0, 40.0, 1.0, 1.0],
        [1864.0, 40.0, -1.0, 1.0],
        [56.0, 1040.0, 1.0, -1.0],
        [1864.0, 1040.0, -1.0, -1.0],
    ] {
        path.extend([
            Step::MoveTo {
                point: [x + sx * k, y],
            },
            Step::LineTo { point: [x, y] },
            Step::LineTo {
                point: [x, y + sy * k],
            },
        ]);
    }
    d.path(
        path,
        vec![source_stroke(solid(rgba(p.hi, 0.5 * (1.0 - s.exit))), 1.5)],
    );
    Ok(())
}
