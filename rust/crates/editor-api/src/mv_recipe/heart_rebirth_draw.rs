//! Original shared gather/sun drawing helpers. No JS scene fallback.
use super::{
    Session,
    draw::*,
    plan::{Command, HeartCommand, Operation, Stop, Style},
    shards::Shard,
};
pub const FF: Color = [221.0 / 255.0, 1.0, 122.0 / 255.0, 1.0];
pub const FF_CORE: Color = [246.0 / 255.0, 1.0, 224.0 / 255.0, 1.0];
pub fn in_out_sine(p: f64) -> f64 {
    -((std::f64::consts::PI * p).cos() - 1.0) / 2.0
}
pub fn out_expo(p: f64) -> f64 {
    if p == 1.0 {
        1.0
    } else {
        1.0 - 2.0f64.powf(-10.0 * p)
    }
}
pub fn out_back(p: f64, s: f64) -> f64 {
    1.0 + (s + 1.0) * (p - 1.0).powi(3) + s * (p - 1.0).powi(2)
}
pub fn pulse(beats: &[f64], t: f64, k: f64) -> f64 {
    let n = beats.partition_point(|b| *b <= t);
    let age = if n == 0 { 1e9 } else { t - beats[n - 1] };
    (-k * age).exp()
}
pub fn vgrad(d: &mut Draw, stops: &[(f64, Color)], opacity: f64) {
    let style = Style::Linear {
        from: [0.0, 0.0],
        to: [0.0, 1080.0],
        stops: stops
            .iter()
            .map(|(offset, color)| Stop {
                offset: *offset,
                color: *color,
            })
            .collect(),
    };
    let mut p = fill(style, "source-over");
    p.opacity = opacity;
    d.rect([0.0, 0.0, 1920.0, 1080.0], p);
}
pub fn vignette(d: &mut Draw, a: f64, c: Color) {
    let style = Style::Radial {
        from: [960.0, 540.0, 378.0],
        to: [960.0, 540.0, 1134.0],
        stops: vec![
            Stop {
                offset: 0.0,
                color: alpha(c, 0.0),
            },
            Stop {
                offset: 1.0,
                color: alpha(c, a),
            },
        ],
    };
    d.rect([0.0, 0.0, 1920.0, 1080.0], fill(style, "source-over"));
}
pub fn trail(d: &mut Draw, p: &[[f64; 2]], c: Color, w: f64, a: f64, core: Color) {
    if p.len() < 2 || a <= 0.004 {
        return;
    }
    let n = p.len() - 1;
    for k in 1..=n {
        let f = k as f64 / n as f64;
        d.path(
            vec![mv(p[k - 1]), ln(p[k])],
            vec![stroke(
                alpha(c, a * f * f),
                w * (0.25 + 0.75 * f),
                "lighter",
                "round",
                "miter",
            )],
        );
    }
    let mut path = vec![mv(p[n / 2])];
    path.extend(p[n / 2 + 1..].iter().copied().map(ln));
    d.path(
        path,
        vec![stroke(
            alpha(core, a * 0.8),
            (w * 0.22).max(1.0),
            "lighter",
            "round",
            "miter",
        )],
    );
}
pub fn piece(
    d: &mut Draw,
    session: &Session,
    s: &Shard,
    variant: super::sprites::Variant,
    position: [f64; 2],
    spin: f64,
    flip: f64,
    scale: f64,
    a: f64,
    composite: &'static str,
) -> Result<(), String> {
    if a <= 0.004 {
        return Ok(());
    }
    let body = [
        session.body.display_size[0] as u32,
        session.body.display_size[1] as u32,
    ];
    let spr = super::sprites::shard(&session.glass.fracture.cells[s.cell].polygon, body, variant)
        .map_err(str::to_owned)?;
    let id = d.surface_id("heart-piece");
    d.commands.push(Command::Heart(HeartCommand::OwnedSurface {
        id: id.clone(),
        size: spr.size,
        commands: spr.commands,
    }));
    let saved = d.operations.clone();
    d.operations.push(Operation::Translate { offset: position });
    d.operations.push(Operation::Rotate { radians: s.axis });
    d.operations.push(Operation::Scale {
        factors: super::motion::flip_scale(flip, scale),
    });
    d.operations.push(Operation::Rotate {
        radians: spin - s.axis,
    });
    d.blit_owned(
        &id,
        spr.size,
        [
            spr.origin[0] - s.pivot[0],
            spr.origin[1] - s.pivot[1],
            spr.size[0] as f64,
            spr.size[1] as f64,
        ],
        a.min(1.0),
        composite,
    );
    d.operations = saved;
    d.commands
        .push(Command::Heart(HeartCommand::OwnedReleaseSurface {
            surface: id,
        }));
    Ok(())
}
pub fn dust(d: &mut Draw, t: f64, n: usize, seed: f64, color: Color) {
    for i in 0..n {
        let i = i as f64;
        let x = (super::seeded::rnd(i, seed)
            + t * 0.004 * (1.0 + super::seeded::rnd(i, seed + 3.0)))
        .rem_euclid(1.0)
            * 1920.0;
        let y = (super::seeded::rnd(i, seed + 1.0) + (t * 0.3 + i).sin() * 0.01 - t * 0.003)
            .rem_euclid(1.0)
            * 1080.0;
        let r = 0.8 + 2.2 * super::seeded::rnd(i, seed + 2.0);
        let a = 0.3 + 0.7 * (t * 0.7 + i).sin().abs();
        let mut p = fill(solid(color), "source-over");
        p.opacity = a;
        d.path(vec![arc([x, y], r, 0.0, std::f64::consts::TAU)], vec![p]);
    }
}
pub fn fbm(x: f64, seed: f64) -> f64 {
    let mut sum = 0.0;
    let mut a = 0.5;
    let mut f = 1.0;
    for o in 0..3 {
        sum += a * super::seeded::noise(x * f, seed + o as f64 * 17.0);
        a *= 0.5;
        f *= 2.0;
    }
    sum
}
pub fn fireflies(d: &mut Draw, t: f64) {
    for i in 0..30 {
        let i = i as f64;
        let x = super::seeded::rnd(i, 27.0) * 1920.0 + fbm(t * 0.25 + i, 27.0) * 160.0;
        let y = 378.0
            + (1080.0 - 378.0) * super::seeded::rnd(i, 28.0)
            + fbm(t * 0.22 + i * 1.7, 32.0) * 90.0;
        let blink = (t * (0.9 + super::seeded::rnd(i, 29.0)) + i * 2.3)
            .sin()
            .clamp(0.0, 1.0)
            .powi(3)
            * 0.7;
        if blink < 0.02 {
            continue;
        }
        let r = 2.2 * (0.7 + super::seeded::rnd(i, 30.0) * 0.8) * 7.0;
        d.rect(
            [x - r, y - r, r * 2.0, r * 2.0],
            fill(
                radial(
                    x,
                    y,
                    r,
                    &[
                        (0.0, alpha(FF_CORE, blink)),
                        (0.2, alpha(FF, blink * 0.7)),
                        (1.0, alpha(FF, 0.0)),
                    ],
                ),
                "lighter",
            ),
        );
    }
}
pub fn sun_rays(
    d: &mut Draw,
    x: f64,
    y: f64,
    n: usize,
    r0: f64,
    len: f64,
    c: Color,
    a: f64,
    rot: f64,
    seed: f64,
) {
    if a <= 0.004 || len <= 1.0 {
        return;
    }
    let saved = d.operations.clone();
    d.operations.push(Operation::Translate { offset: [x, y] });
    d.operations.push(Operation::Rotate { radians: rot });
    let mut path = Vec::new();
    for i in 0..n {
        let fi = i as f64;
        let an = fi / n as f64 * std::f64::consts::TAU;
        let l = r0
            + len * if i % 2 == 1 { 0.5 } else { 1.0 } * (0.8 + 0.4 * super::seeded::rnd(fi, seed));
        let w = if i % 2 == 1 { 0.008 } else { 0.016 }
            * (0.8 + 0.4 * super::seeded::rnd(fi, seed + 1.0));
        path.extend([
            mv([(an - w).cos() * r0, (an - w).sin() * r0]),
            ln([an.cos() * l, an.sin() * l]),
            ln([(an + w).cos() * r0, (an + w).sin() * r0]),
        ]);
    }
    let style = Style::Radial {
        from: [0.0, 0.0, r0],
        to: [0.0, 0.0, r0 + len],
        stops: vec![
            Stop {
                offset: 0.0,
                color: alpha(c, a),
            },
            Stop {
                offset: 0.3,
                color: alpha(c, a * 0.4),
            },
            Stop {
                offset: 1.0,
                color: alpha(c, 0.0),
            },
        ],
    };
    d.path(path, vec![fill(style, "lighter")]);
    d.operations = saved;
}
pub fn rays(
    d: &mut Draw,
    position: [f64; 2],
    n: usize,
    len: f64,
    c: Color,
    a: f64,
    t: f64,
    seed: f64,
) {
    let [x, y] = position;
    for i in 0..n {
        let i = i as f64;
        let an =
            i / n as f64 * std::f64::consts::TAU + super::seeded::rnds(i, seed) * 0.2 + t * 0.02;
        let w = 0.02 + 0.05 * super::seeded::rnd(i, seed + 1.0);
        let al =
            a * (0.3 + 0.7 * super::seeded::rnd(i, seed + 2.0)) * (0.6 + 0.4 * (t * 0.8 + i).sin());
        d.path(
            vec![mv([x, y]), arc([x, y], len, an - w, an + w), close()],
            vec![fill(
                radial(x, y, len, &[(0.0, alpha(c, al)), (1.0, alpha(c, 0.0))]),
                "lighter",
            )],
        );
    }
}
