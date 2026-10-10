//! Original skyBuild night and ground rasters expressed as executable native commands.
use super::{
    draw::*,
    plan::{native, Command as Heart, HeartCommand, Stop, Style},
    sky_geometry, sky_night_data,
    sky_plan::{self, Command, SkyCommand},
};
pub fn night(data: &sky_night_data::Night, color: Color) -> Command {
    let mut d = Draw::new();
    d.rect(
        [0.0, 0.0, 2200.0, 1360.0],
        fill(
            Style::Linear {
                from: [0.0, 0.0],
                to: [0.0, 1360.0],
                stops: vec![
                    Stop { offset: 0.0, color },
                    Stop {
                        offset: 0.55,
                        color: rgb(11.0, 20.0, 48.0, 1.0),
                    },
                    Stop {
                        offset: 0.8,
                        color: rgb(26.0, 30.0, 69.0, 1.0),
                    },
                    Stop {
                        offset: 0.9,
                        color: rgb(58.0, 29.0, 74.0, 1.0),
                    },
                    Stop {
                        offset: 1.0,
                        color: rgb(106.0, 38.0, 68.0, 1.0),
                    },
                ],
            },
            "source-over",
        ),
    );
    for q in &data.clouds {
        let [x, y] = q.position;
        let r = q.radius;
        d.rect(
            [x - r, y - r, 2.0 * r, 2.0 * r],
            fill(
                radial(
                    x,
                    y,
                    r,
                    &[(0.0, q.color), (1.0, rgb(90.0, 100.0, 200.0, 0.0))],
                ),
                "lighter",
            ),
        );
    }
    for q in &data.dust {
        d.rect(
            [q.position[0], q.position[1], 1.3, 1.3],
            fill(solid(q.color), "lighter"),
        );
    }
    let mut commands = sky_plan::heart(d.commands);
    let mut path = Vec::with_capacity(51);
    for k in 0..=50 {
        let u = k as f64 / 50.0;
        let b = sky_night_data::curve(u);
        let o = 45.0 * super::rebirth_draw::fbm(u * 7.0, 3.0);
        let p = [b[0] + o * 0.55, b[1] + o * 0.83];
        path.push(if k == 0 { mv(p) } else { ln(p) });
    }
    commands.push(Command::Sky(SkyCommand::FilteredPath {
        transform: ID,
        operations: Vec::new(),
        path,
        paints: vec![stroke(
            rgb(4.0, 6.0, 16.0, 0.5),
            26.0,
            "source-over",
            "butt",
            "miter",
        )],
        blur_px: 10.0,
    }));
    let mut d = Draw::new();
    for q in &data.stars {
        d.path(
            vec![arc(q.position, q.radius, 0.0, std::f64::consts::TAU)],
            vec![fill(solid(q.color), "source-over")],
        );
    }
    commands.extend(sky_plan::heart(d.commands));
    Command::Sky(SkyCommand::Surface {
        id: "sky-night",
        size: [2200, 1360],
        commands,
    })
}
pub fn ground() -> Command {
    let mut d = Draw::new();
    let mut path = vec![mv([0.0, sky_geometry::ground(0.0)])];
    for x in (0..=2200).step_by(6) {
        path.push(ln([x as f64, sky_geometry::ground(x as f64)]));
    }
    path.extend([ln([2200.0, 1560.0]), ln([0.0, 1560.0]), close()]);
    d.path(
        path,
        vec![
            fill(solid(rgb(7.0, 5.0, 13.0, 1.0)), "source-over"),
            stroke(
                rgb(130.0, 110.0, 170.0, 0.45),
                1.4,
                "source-over",
                "butt",
                "miter",
            ),
        ],
    );
    for x in (0..=2200).step_by(3) {
        let x = x as f64;
        if super::seeded::rnd(x, 3.0) > 0.42 {
            continue;
        }
        let h = 3.0 + 15.0 * super::seeded::rnd(x, 4.0).powi(2);
        let lean = super::seeded::rnds(x, 5.0) * 6.0;
        let y = sky_geometry::ground(x) + 2.0;
        d.path(
            vec![
                mv([x - 1.6, y]),
                quad([x + lean * 0.3, y - h * 0.6], [x + lean, y - h]),
                quad([x + lean * 0.3 + 0.8, y - h * 0.5], [x + 1.6, y]),
            ],
            vec![fill(solid(rgb(7.0, 5.0, 13.0, 1.0)), "source-over")],
        );
    }
    let px = 390.0;
    let top = 700.0;
    d.path(
        vec![
            mv([px - 7.0, sky_geometry::ground(px) + 4.0]),
            ln([px - 4.0, top]),
            ln([px + 4.0, top]),
            ln([px + 7.0, sky_geometry::ground(px) + 4.0]),
        ],
        vec![fill(solid(rgb(7.0, 5.0, 13.0, 1.0)), "source-over")],
    );
    d.rect(
        [px - 52.0, top + 26.0, 104.0, 7.0],
        fill(solid(rgb(7.0, 5.0, 13.0, 1.0)), "source-over"),
    );
    d.rect(
        [px - 36.0, top + 58.0, 72.0, 6.0],
        fill(solid(rgb(7.0, 5.0, 13.0, 1.0)), "source-over"),
    );
    for [x0, y0, x1, y1, sag] in [
        [px - 48.0, top + 29.0, 2200.0, 390.0, 110.0],
        [px + 48.0, top + 29.0, 2200.0, 440.0, 120.0],
        [px - 32.0, top + 61.0, 2200.0, 520.0, 100.0],
        [px - 48.0, top + 29.0, -20.0, 840.0, 40.0],
        [px + 48.0, top + 29.0, -20.0, 880.0, 50.0],
    ] {
        d.path(
            vec![
                mv([x0, y0]),
                quad([(x0 + x1) / 2.0, y0.max(y1) + sag], [x1, y1]),
            ],
            vec![stroke(
                rgb(7.0, 5.0, 13.0, 1.0),
                1.6,
                "source-over",
                "butt",
                "miter",
            )],
        );
    }
    Command::Heart(Heart::Heart(HeartCommand::Surface {
        id: "sky-ground",
        size: [2200, 1560],
        commands: d.commands,
    }))
}
pub fn texture(id: &str, width: u32, height: u32) -> Command {
    let scale = (2200.0 / width as f64).max(1360.0 / height as f64);
    let w = width as f64 * scale;
    let h = height as f64 * scale;
    Command::Heart(Heart::Heart(HeartCommand::Surface {
        id: "sky-texture",
        size: [2200, 1360],
        commands: vec![Heart::Native(native::Command::Image {
            image: id.into(),
            source_rect: None,
            destination_rect: [(2200.0 - w) / 2.0, (1360.0 - h) / 2.0, w, h],
            transform: ID,
            operations: Vec::new(),
            clip: None,
            composite: "source-over",
            opacity: 1.0,
            smoothing: true,
            smoothing_quality: "low",
        })],
    }))
}
