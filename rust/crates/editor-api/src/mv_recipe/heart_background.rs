use super::{
    BackgroundFact,
    draw::*,
    plan::{Command, HeartCommand, Operation, Stop, Style, native},
};
pub fn background(
    d: &mut Draw,
    hx: f64,
    hy: f64,
    flash: f64,
    image: Option<&BackgroundFact<'_>>,
    burn: bool,
) {
    if let Some(image) = image {
        let scale = (1920.0 / image.width as f64).max(1080.0 / image.height as f64) * 1.08;
        let w = image.width as f64 * scale;
        let h = image.height as f64 * scale;
        d.commands.push(Command::Native(native::Command::Image {
            image: image.resource.id.clone(),
            source_rect: None,
            destination_rect: [-w / 2.0, -h / 2.0, w, h],
            transform: ID,
            operations: vec![Operation::Translate {
                offset: [960.0, 540.0],
            }],
            clip: None,
            composite: "source-over",
            opacity: 1.0,
            smoothing: true,
            smoothing_quality: "high",
        }));
        let mut paint = fill(
            solid(if burn {
                rgb(42.0, 6.0, 8.0, 1.0)
            } else {
                rgb(26.0, 10.0, 40.0, 1.0)
            }),
            "multiply",
        );
        paint.opacity = 0.6;
        d.rect([0.0, 0.0, 1920.0, 1080.0], paint);
        return;
    }
    let stops = if burn {
        [
            (0.0, rgb(90.0, 26.0, 22.0, 1.0)),
            (0.3, rgb(46.0, 12.0, 16.0, 1.0)),
            (0.65, rgb(20.0, 6.0, 9.0, 1.0)),
            (1.0, rgb(6.0, 2.0, 3.0, 1.0)),
        ]
    } else {
        [
            (0.0, rgb(78.0, 32.0, 89.0, 1.0)),
            (0.3, rgb(43.0, 18.0, 57.0, 1.0)),
            (0.65, rgb(23.0, 10.0, 34.0, 1.0)),
            (1.0, rgb(10.0, 5.0, 18.0, 1.0)),
        ]
    };
    d.rect(
        [0.0, 0.0, 1920.0, 1080.0],
        fill(radial(hx, hy, 1300.0, &stops), "source-over"),
    );
    let mut circles = Vec::new();
    for row in 0..90 {
        let y = (row * 12) as f64;
        let mut x = if row % 2 == 0 { 0.0 } else { 6.0 };
        while x < 1920.0 {
            let dist = ((x - hx) / 1920.0).hypot((y - hy) / 1080.0 * 0.8);
            let radius = smooth(0.3, 0.85, dist) * 0.85 * 12.0 * 0.5;
            if radius > 0.3 {
                circles.push([x, y, radius]);
            }
            x += 12.0;
        }
    }
    d.commands.push(Command::Heart(HeartCommand::Surface {
        id: "heart-halftone",
        size: [1920, 1080],
        commands: vec![Command::Native(native::Command::CircleBatch {
            transform: ID,
            operations: Vec::new(),
            clip: None,
            circles,
            paints: vec![fill(
                solid(if burn {
                    rgb(68.0, 20.0, 26.0, 1.0)
                } else {
                    rgb(67.0, 32.0, 90.0, 1.0)
                }),
                "source-over",
            )],
        })],
    }));
    d.blit(
        "heart-halftone",
        [1920, 1080],
        [0.0, 0.0, 1920.0, 1080.0],
        0.5,
        "source-over",
    );
    d.commands
        .push(Command::Native(native::Command::ReleaseSurface {
            surface: "heart-halftone",
        }));
    let style = Style::Linear {
        from: [0.0, 0.0],
        to: [0.0, 1080.0],
        stops: vec![
            Stop {
                offset: 0.0,
                color: if burn {
                    rgb(255.0, 122.0, 74.0, 0.07)
                } else {
                    rgb(201.0, 138.0, 224.0, 0.07)
                },
            },
            Stop {
                offset: 1.0,
                color: rgb(0.0, 0.0, 0.0, 0.0),
            },
        ],
    };
    d.path(
        vec![
            mv([hx - 90.0, 0.0]),
            ln([hx + 90.0, 0.0]),
            ln([hx + 520.0, 1080.0]),
            ln([hx - 520.0, 1080.0]),
            close(),
        ],
        vec![fill(style, "lighter")],
    );
    if flash > 0.003 {
        d.glow(
            hx,
            hy,
            1500.0,
            if burn {
                rgb(200.0, 55.0, 58.0, 1.0)
            } else {
                DUSK
            },
            0.55 * flash,
        );
    }
}
pub fn dust(d: &mut Draw, t: f64, burn: bool) {
    let seed = if burn { 44.0 } else { 43.0 };
    for i in 0..46 {
        let i = i as f64;
        let fract = |v: f64| v - v.floor();
        let x = fract(
            super::seeded::rnd(i, seed) + t * 0.004 * (1.0 + super::seeded::rnd(i, seed + 3.0)),
        ) * 1920.0;
        let y = fract(super::seeded::rnd(i, seed + 1.0) + (t * 0.3 + i).sin() * 0.01 - t * 0.003)
            * 1080.0;
        let r = 0.8 + 2.2 * super::seeded::rnd(i, seed + 2.0);
        let mut p = fill(
            solid(if burn {
                rgb(255.0, 170.0, 110.0, 0.35)
            } else {
                rgb(255.0, 214.0, 190.0, 0.28)
            }),
            "source-over",
        );
        p.opacity = 0.3 + 0.7 * (t * 0.7 + i).sin().abs();
        d.path(vec![arc([x, y], r, 0.0, std::f64::consts::TAU)], vec![p]);
    }
}
pub fn vignette(d: &mut Draw) {
    let style = Style::Radial {
        from: [960.0, 540.0, 1080.0 * 0.35],
        to: [960.0, 540.0, 1080.0 * 1.05],
        stops: vec![
            Stop {
                offset: 0.0,
                color: rgb(8.0, 4.0, 14.0, 0.0),
            },
            Stop {
                offset: 1.0,
                color: rgb(8.0, 4.0, 14.0, 0.55),
            },
        ],
    };
    d.rect([0.0, 0.0, 1920.0, 1080.0], fill(style, "source-over"));
}
