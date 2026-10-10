use super::{
    draw::*,
    plan::{Command, HeartCommand, Stop, Style, native},
};
pub fn halftone(d: &mut Draw, x: f64, y: f64, opacity: f64, composite: &'static str) {
    let mut circles = Vec::new();
    for row in 0..90 {
        let py = row as f64 * 12.0;
        let mut px = if row % 2 == 0 { 0.0 } else { 6.0 };
        while px < 1920.0 {
            let dist = ((px - x) / 1920.0).hypot((py - y) / 1080.0 * 0.8);
            let r = smooth(0.3, 0.85, dist) * 0.85 * 6.0;
            if r > 0.3 {
                circles.push([px, py, r]);
            }
            px += 12.0;
        }
    }
    let id = d.surface_id("heart-halftone");
    d.commands.push(Command::Heart(HeartCommand::OwnedSurface {
        id: id.clone(),
        size: [1920, 1080],
        commands: vec![Command::Native(native::Command::CircleBatch {
            transform: ID,
            operations: Vec::new(),
            clip: None,
            circles,
            paints: vec![fill(solid(rgb(46.0, 16.0, 32.0, 1.0)), "source-over")],
        })],
    }));
    d.blit_owned(
        &id,
        [1920, 1080],
        [0.0, 0.0, 1920.0, 1080.0],
        opacity,
        composite,
    );
    d.commands
        .push(Command::Heart(HeartCommand::OwnedReleaseSurface {
            surface: id,
        }));
}
pub fn background(d: &mut Draw, x: f64, y: f64, flood: f64) {
    d.rect(
        [0.0, 0.0, 1920.0, 1080.0],
        fill(
            radial(
                x,
                y,
                1300.0,
                &[
                    (0.0, rgb(58.0, 16.0, 32.0, 1.0)),
                    (0.3, rgb(31.0, 10.0, 20.0, 1.0)),
                    (0.65, rgb(14.0, 5.0, 10.0, 1.0)),
                    (1.0, rgb(5.0, 2.0, 4.0, 1.0)),
                ],
            ),
            "source-over",
        ),
    );
    halftone(d, x, y, 0.5, "source-over");
    let style = Style::Linear {
        from: [0.0, 0.0],
        to: [0.0, 1080.0],
        stops: vec![
            Stop {
                offset: 0.0,
                color: rgb(201.0, 138.0, 224.0, 0.07),
            },
            Stop {
                offset: 1.0,
                color: [0.0; 4],
            },
        ],
    };
    d.path(
        vec![
            mv([x - 90.0, 0.0]),
            ln([x + 90.0, 0.0]),
            ln([x + 520.0, 1080.0]),
            ln([x - 520.0, 1080.0]),
            close(),
        ],
        vec![fill(style, "lighter")],
    );
    if flood > 0.003 {
        let mut p = fill(
            radial(
                x,
                y,
                1650.0,
                &[
                    (0.0, HI),
                    (0.1, GLOW),
                    (0.22, rgb(240.0, 102.0, 58.0, 1.0)),
                    (0.4, rgb(200.0, 55.0, 58.0, 1.0)),
                    (0.62, DUSK),
                    (0.85, rgb(58.0, 23.0, 69.0, 1.0)),
                    (1.0, rgb(20.0, 11.0, 30.0, 1.0)),
                ],
            ),
            "source-over",
        );
        p.opacity = flood;
        d.rect([0.0, 0.0, 1920.0, 1080.0], p);
        halftone(d, x, y, 0.3 * flood, "multiply");
    }
}
pub fn core(
    d: &mut Draw,
    position: [f64; 2],
    rs: f64,
    t: f64,
    tau: f64,
    gather: f64,
    born: bool,
    born_k: f64,
    flood: f64,
    pulse: f64,
) {
    let [x, y] = position;
    if born {
        let br = 1.0 + 0.06 * pulse;
        super::rebirth_draw::rays(
            d,
            position,
            26,
            1700.0,
            GLOW,
            0.1 * flood + 0.05 * pulse,
            t,
            13.0,
        );
        super::rebirth_draw::sun_rays(
            d,
            x,
            y,
            40,
            rs * 1.3,
            980.0 * born_k * br,
            HI,
            0.42 * flood,
            t * 0.04,
            21.0,
        );
        d.glow(x, y, rs * 4.2 * born_k, GLOW, 0.5);
        d.glow(x, y, rs * 1.9 * born_k, HI, 0.45);
        let saved = d.operations.clone();
        d.operations
            .push(super::plan::Operation::Translate { offset: position });
        d.operations.push(super::plan::Operation::Scale {
            factors: [1.0, 0.022],
        });
        d.glow(0.0, 0.0, 1500.0 * born_k, HI, 0.55);
        d.operations = saved;
        d.ring(x, y, rs * 1.2 * born_k * br, 2.2, HI, 0.9 * flood);
        d.ring(
            x,
            y,
            rs * (1.55 + 0.1 * pulse) * born_k,
            1.2,
            HI,
            0.45 * flood,
        );
        d.path(
            vec![arc(position, rs * born_k, 0.0, std::f64::consts::TAU)],
            vec![fill(solid(rgb(255.0, 243.0, 218.0, 1.0)), "source-over")],
        );
        let k = (tau / 0.9).clamp(0.0, 1.0);
        d.ring(
            x,
            y,
            rs + 1400.0 * out_cubic(k),
            14.0 * (1.0 - k) + 1.0,
            HOT,
            0.8 * (1.0 - k).powf(1.4),
        );
        let k = ((tau - 0.08) / 0.8).clamp(0.0, 1.0);
        d.ring(x, y, rs + 700.0 * out_cubic(k), 4.0, HI, 0.5 * (1.0 - k));
    } else {
        d.glow(
            x,
            y,
            80.0 + 300.0 * gather,
            rgb(240.0, 102.0, 58.0, 1.0),
            0.2 + 0.5 * gather,
        );
        d.glow(x, y, 16.0 + 70.0 * gather, HOT, 0.3 + 0.7 * gather * gather);
        let saved = d.operations.clone();
        d.operations
            .push(super::plan::Operation::Translate { offset: position });
        for arm in 0..4 {
            let mut p = Vec::new();
            for k in 0..=40 {
                let f = k as f64 / 40.0;
                let r = 40.0 + 560.0 * f * (1.0 - 0.5 * gather);
                let an = arm as f64 * std::f64::consts::TAU / 4.0 + t * 2.2 + f * 3.4;
                let xy = [an.cos() * r, an.sin() * r * 0.82];
                p.push(if k == 0 { mv(xy) } else { ln(xy) });
            }
            d.path(
                p,
                vec![stroke(
                    alpha(GLOW, 0.1 + 0.2 * gather),
                    2.0 + 3.0 * gather,
                    "lighter",
                    "round",
                    "miter",
                )],
            );
        }
        d.operations = saved;
        if gather > 0.6 {
            let k = inv(0.6, 1.0, gather);
            d.sparkle(x, y, 80.0 + 360.0 * k * k, 0.9 * k, 0.3, true);
        }
    }
}
