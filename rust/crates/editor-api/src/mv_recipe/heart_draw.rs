use super::plan::{
    Command, HeartCommand, Operation, Paint, PaintKind, Quadratic, Step, Stop, Style, native,
};
pub type Color = crate::mv_recipe::model::Color;
pub const ID: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
pub const HI: Color = [1.0, 227.0 / 255.0, 176.0 / 255.0, 1.0];
pub const HOT: Color = [1.0, 246.0 / 255.0, 228.0 / 255.0, 1.0];
pub const GLOW: Color = [1.0, 165.0 / 255.0, 82.0 / 255.0, 1.0];
pub const DUSK: Color = [122.0 / 255.0, 35.0 / 255.0, 80.0 / 255.0, 1.0];
pub fn rgb(r: f64, g: f64, b: f64, a: f64) -> Color {
    [r / 255.0, g / 255.0, b / 255.0, a]
}
pub fn alpha(mut c: Color, a: f64) -> Color {
    c[3] = (a * c[3]).clamp(0.0, 1.0);
    c
}
pub fn solid(c: Color) -> Style {
    Style::Solid { color: c }
}
pub fn radial(x: f64, y: f64, r: f64, stops: &[(f64, Color)]) -> Style {
    Style::Radial {
        from: [x, y, 0.0],
        to: [x, y, r],
        stops: stops
            .iter()
            .map(|(offset, color)| Stop {
                offset: *offset,
                color: *color,
            })
            .collect(),
    }
}
pub fn fill(style: Style, composite: &'static str) -> Paint {
    Paint {
        style,
        composite,
        opacity: 1.0,
        kind: PaintKind::Fill,
    }
}
pub fn stroke(
    c: Color,
    width: f64,
    composite: &'static str,
    cap: &'static str,
    join: &'static str,
) -> Paint {
    Paint {
        style: solid(c),
        composite,
        opacity: 1.0,
        kind: PaintKind::Stroke { width, cap, join },
    }
}
pub fn mv(p: [f64; 2]) -> Step {
    Step::Native(native::Step::MoveTo { point: p })
}
pub fn ln(p: [f64; 2]) -> Step {
    Step::Native(native::Step::LineTo { point: p })
}
pub fn close() -> Step {
    Step::Native(native::Step::Close)
}
pub fn arc(p: [f64; 2], r: f64, start: f64, end: f64) -> Step {
    Step::Native(native::Step::Arc {
        center: p,
        radius: r,
        start,
        end,
        anticlockwise: false,
    })
}
pub fn quad(control: [f64; 2], point: [f64; 2]) -> Step {
    Step::Quadratic(Quadratic::QuadraticCurveTo { control, point })
}
pub struct Draw {
    pub commands: Vec<Command>,
    pub operations: Vec<Operation>,
}
impl Draw {
    /// Command position is monotonic in one frame. Distinct layer stems avoid
    /// collision with the static body/background surface names.
    pub fn surface_id(&self, stem: &str) -> String {
        format!("{stem}-{}", self.commands.len())
    }
    pub fn blit_owned(
        &mut self,
        surface: &str,
        size: [u32; 2],
        rect: [f64; 4],
        opacity: f64,
        composite: &'static str,
    ) {
        self.commands.push(Command::Heart(HeartCommand::OwnedBlit {
            surface: surface.to_owned(),
            source_rect: [0.0, 0.0, size[0] as f64, size[1] as f64],
            destination_rect: rect,
            transform: ID,
            operations: self.operations.clone(),
            composite,
            opacity,
            clip: None,
            raster: None,
        }));
    }
    pub fn new() -> Self {
        Self {
            commands: Vec::new(),
            operations: Vec::new(),
        }
    }
    pub fn path(&mut self, path: Vec<Step>, paints: Vec<Paint>) {
        self.commands.push(Command::Heart(HeartCommand::Path {
            transform: ID,
            operations: self.operations.clone(),
            clip: None,
            path,
            paints,
        }));
    }
    pub fn rect(&mut self, rect: [f64; 4], paint: Paint) {
        self.commands.push(Command::Native(native::Command::Rect {
            transform: ID,
            operations: self.operations.clone(),
            clip: None,
            rect,
            paint,
        }));
    }
    pub fn glow(&mut self, x: f64, y: f64, r: f64, c: Color, a: f64) {
        self.rect(
            [x - r, y - r, 2.0 * r, 2.0 * r],
            fill(
                radial(
                    x,
                    y,
                    r,
                    &[
                        (0.0, alpha(c, a)),
                        (0.25, alpha(c, a * 0.45)),
                        (1.0, alpha(c, 0.0)),
                    ],
                ),
                "lighter",
            ),
        );
    }
    pub fn ring(&mut self, x: f64, y: f64, r: f64, width: f64, c: Color, a: f64) {
        if a <= 0.004 || r <= 0.0 {
            return;
        }
        self.path(
            vec![arc([x, y], r, 0.0, std::f64::consts::TAU)],
            vec![stroke(alpha(c, a), width, "lighter", "butt", "miter")],
        );
    }
    pub fn sparkle(&mut self, x: f64, y: f64, r: f64, a: f64, rot: f64, halo: bool) {
        self.sparkle_color(x, y, r, a, HOT, rot, halo);
    }
    pub fn sparkle_color(
        &mut self,
        x: f64,
        y: f64,
        r: f64,
        a: f64,
        color: Color,
        rot: f64,
        halo: bool,
    ) {
        if a <= 0.004 || r <= 0.6 {
            return;
        }
        let saved = self.operations.clone();
        self.operations
            .push(Operation::Translate { offset: [x, y] });
        self.operations.push(Operation::Rotate { radians: rot });
        if halo {
            self.rect(
                [-r * 0.5, -r * 0.5, r, r],
                fill(
                    radial(
                        0.0,
                        0.0,
                        r * 0.5,
                        &[(0.0, alpha(color, a * 0.8)), (1.0, alpha(color, 0.0))],
                    ),
                    "lighter",
                ),
            );
        }
        let k = r * 0.07;
        let rv = r * 0.72;
        self.path(
            vec![
                mv([0.0, -rv]),
                quad([k, -k], [r, 0.0]),
                quad([k, k], [0.0, rv]),
                quad([-k, k], [-r, 0.0]),
                quad([-k, -k], [0.0, -rv]),
            ],
            vec![fill(solid(alpha(color, a)), "lighter")],
        );
        self.operations = saved;
    }
    pub fn blit(
        &mut self,
        surface: &'static str,
        size: [u32; 2],
        rect: [f64; 4],
        opacity: f64,
        composite: &'static str,
    ) {
        self.commands.push(Command::Native(native::Command::Blit {
            surface,
            source_rect: [0.0, 0.0, size[0] as f64, size[1] as f64],
            destination_rect: rect,
            transform: ID,
            operations: self.operations.clone(),
            composite,
            opacity,
            clip: None,
            raster: None,
        }));
    }
    pub fn rays(&mut self, x: f64, y: f64, a: f64, t: f64) {
        self.rays_color(x, y, a, t, GLOW);
    }
    pub fn rays_color(&mut self, x: f64, y: f64, a: f64, t: f64, color: Color) {
        for i in 0..22 {
            let i = i as f64;
            let angle =
                i / 22.0 * std::f64::consts::TAU + super::seeded::rnds(i, 5.0) * 0.2 + t * 0.02;
            let width = 0.02 + 0.05 * super::seeded::rnd(i, 6.0);
            let al =
                a * (0.3 + 0.7 * super::seeded::rnd(i, 7.0)) * (0.6 + 0.4 * (t * 0.8 + i).sin());
            self.path(
                vec![
                    mv([x, y]),
                    arc([x, y], 1500.0, angle - width, angle + width),
                    close(),
                ],
                vec![fill(
                    radial(
                        x,
                        y,
                        1500.0,
                        &[(0.0, alpha(color, al)), (1.0, alpha(color, 0.0))],
                    ),
                    "lighter",
                )],
            );
        }
    }
    pub fn tongues(&mut self, x: f64, y: f64, size: f64, tq: f64, seed: f64, a: f64, n: usize) {
        if a <= 0.01 || size < 2.0 {
            return;
        }
        for k in 0..n {
            let k = k as f64;
            let fx = x + super::seeded::rnds(k, seed) * size * 0.4;
            let fh = size
                * (0.55 + 0.6 * super::seeded::rnd(k, seed + 1.0))
                * (0.7 + 0.3 * (tq * 23.0 + k * 2.1 + seed).sin());
            let fw = fh * 0.24;
            let sway = (tq * 9.0 + k + seed).sin() * fw * 0.9;
            let style = Style::Linear {
                from: [fx, y],
                to: [fx, y - fh],
                stops: vec![
                    Stop {
                        offset: 0.0,
                        color: rgb(255.0, 224.0, 160.0, a),
                    },
                    Stop {
                        offset: 0.35,
                        color: rgb(255.0, 122.0, 42.0, a * 0.75),
                    },
                    Stop {
                        offset: 1.0,
                        color: rgb(200.0, 55.0, 58.0, 0.0),
                    },
                ],
            };
            self.path(
                vec![
                    mv([fx - fw, y]),
                    quad([fx - fw * 0.9, y - fh * 0.55], [fx + sway, y - fh]),
                    quad([fx + fw * 0.9, y - fh * 0.55], [fx + fw, y]),
                    close(),
                ],
                vec![fill(style, "lighter")],
            );
        }
    }
}
pub fn inv(a: f64, b: f64, t: f64) -> f64 {
    ((t - a) / (b - a)).clamp(0.0, 1.0)
}
pub fn decay(t: f64, k: f64) -> f64 {
    if t < 0.0 { 0.0 } else { (-t * k).exp() }
}
pub fn burst(t: f64, k: f64) -> f64 {
    if t <= 0.0 { 0.0 } else { 1.0 - (-t / k).exp() }
}
pub fn smooth(a: f64, b: f64, t: f64) -> f64 {
    let k = inv(a, b, t);
    k * k * (3.0 - 2.0 * k)
}
pub fn out_cubic(x: f64) -> f64 {
    1.0 - (1.0 - x).powi(3)
}
