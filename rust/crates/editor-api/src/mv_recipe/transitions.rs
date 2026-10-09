//! Parameterized A/B geometry adapted from vocaloid-style-mv-pipeline trans.js,
//! commit 13b380dab077d4c8ea956825c9693c720e0c2b91 (MIT, NikusonP 2026).
//! Full license: packages/editor-classic/NOTICE. No authored expressions here.
use super::catalog::{PEEL_CURL, PEEL_PERSPECTIVE, PEEL_SEGMENTS, PEEL_SHADING};
use super::transition_model::*;
use super::validate::{color, range};

pub fn out_expo(p: f64) -> f64 {
    if p >= 1.0 {
        1.0
    } else {
        1.0 - 2.0f64.powf(-10.0 * p.max(0.0))
    }
}
pub fn in_expo(p: f64) -> f64 {
    if p <= 0.0 {
        0.0
    } else {
        2.0f64.powf(10.0 * p.min(1.0) - 10.0)
    }
}
pub fn random(seed: u32, key: u32) -> f64 {
    let n = seed ^ key.wrapping_mul(374_761_393);
    let n = (n ^ (n >> 13)).wrapping_mul(1_274_126_177);
    f64::from(n ^ (n >> 16)) / 4_294_967_296.0
}
pub fn transformed(cx: f64, cy: f64, x: f64, y: f64, rotation: f64, scale: f64) -> [f64; 6] {
    let a = rotation.cos() * scale;
    let b = rotation.sin() * scale;
    [a, b, -b, a, x - a * cx + b * cy, y - b * cx - a * cy]
}
fn edge_valid(edge: &Option<Edge>) -> bool {
    edge.as_ref()
        .is_none_or(|e| color(&e.color) && range(e.width, 0.0001, 0.1))
}
fn center_valid(center: &[f64; 2]) -> bool {
    center.iter().all(|v| range(*v, 0.0, 1.0))
}
fn image(
    input: Input,
    transform: [f64; 6],
    clip: Option<Clip>,
    replace: bool,
    opacity: f64,
) -> DrawCommand {
    DrawCommand::Image {
        input,
        opacity,
        transform,
        clip,
        replace,
        blend: Blend::SourceOver,
    }
}
fn stroke(edge: &Edge, path: Clip, opacity: f64, short: f64) -> DrawCommand {
    DrawCommand::Stroke {
        color: edge.color,
        opacity,
        width: edge.width * short,
        path,
        role: edge.role,
        transform: IDENTITY,
    }
}

impl Transition {
    pub fn valid(&self) -> bool {
        match self {
            Self::Bend { .. } => super::transition_bend::valid(self),
            Self::Cut | Self::Xfade | Self::Black | Self::Push { .. } | Self::Zoom => true,
            Self::Flash { color: c } => color(c),
            Self::Wipe { angle, edge } => {
                range(*angle, -std::f64::consts::PI, std::f64::consts::PI) && edge_valid(edge)
            }
            Self::Iris { center, edge } => center_valid(center) && edge_valid(edge),
            Self::IrisClose { center } => center_valid(center),
            Self::Slices { count } => *count >= 2 && *count <= 32,
            Self::Peel {
                curl,
                segments,
                shading,
                perspective,
                ..
            } => {
                PEEL_CURL.valid(*curl)
                    && PEEL_SEGMENTS.valid(*segments)
                    && PEEL_SHADING.valid(*shading)
                    && PEEL_PERSPECTIVE.valid(*perspective)
            }
            Self::Ink { blobs, .. } => *blobs >= 1 && *blobs <= 32,
            Self::Shatter {
                center,
                columns,
                rows,
                edge,
                ..
            } => {
                center_valid(center)
                    && *columns >= 1
                    && *columns <= 20
                    && *rows >= 1
                    && *rows <= 20
                    && columns * rows <= 60
                    && edge_valid(edge)
            }
            Self::Barrier {
                pivot,
                colors,
                width,
                stripes,
                ..
            } => {
                range(pivot[0], -1.0, 0.0)
                    && range(pivot[1], 0.0, 1.0)
                    && colors.iter().all(color)
                    && range(*width, 0.001, 0.1)
                    && *stripes >= 2
                    && *stripes <= 64
            }
        }
    }
    pub fn work(&self) -> u32 {
        match self {
            Self::Bend { .. } => 4,
            Self::Shatter {
                columns,
                rows,
                edge,
                ..
            } => 1 + columns * rows * 2 * if edge.is_some() { 2 } else { 1 },
            Self::Barrier { stripes, .. } => 2 + stripes,
            Self::Ink { blobs, .. } => 2 + blobs,
            Self::Slices { count } => 1 + count,
            Self::Peel { segments, .. } => 2 + segments * 2,
            _ => 3,
        }
    }
    pub fn plan(&self, p: f64, w: f64, h: f64, seed: u32) -> Vec<DrawCommand> {
        let short = w.min(h);
        match self {
            Self::Cut => vec![DrawCommand::image(Input::To)],
            Self::Xfade => vec![
                image(Input::From, IDENTITY, None, false, 1.0 - p),
                DrawCommand::Image {
                    input: Input::To,
                    opacity: p,
                    transform: IDENTITY,
                    clip: None,
                    replace: false,
                    blend: Blend::Lighter,
                },
            ],
            Self::Flash { .. } | Self::Black => {
                let color = match self {
                    Self::Flash { color } => *color,
                    _ => [0.0, 0.0, 0.0, 1.0],
                };
                let opacity = if p < 0.5 {
                    (p * 2.0).powi(2)
                } else {
                    ((1.0 - p) * 2.0).powi(2)
                };
                vec![
                    DrawCommand::image(if p < 0.5 { Input::From } else { Input::To }),
                    DrawCommand::Tint { color, opacity },
                ]
            }
            Self::Iris { center, .. } | Self::IrisClose { center } => {
                let x = center[0] * w;
                let y = center[1] * h;
                let closing = matches!(self, Self::IrisClose { .. });
                let radius = x.max(w - x).hypot(y.max(h - y)) * if closing { 1.0 - p } else { p };
                let (base, top) = if closing {
                    (Input::To, Input::From)
                } else {
                    (Input::From, Input::To)
                };
                let mut ops = vec![
                    DrawCommand::image(base),
                    image(
                        top,
                        IDENTITY,
                        Some(Clip::Circle { x, y, radius }),
                        true,
                        1.0,
                    ),
                ];
                if let Self::Iris {
                    edge: Some(edge), ..
                } = self
                {
                    ops.push(stroke(edge, Clip::Circle { x, y, radius }, 1.0 - p, short));
                }
                ops
            }
            Self::Wipe { angle, edge } => {
                let extent = angle.cos().abs() * w / 2.0 + angle.sin().abs() * h / 2.0;
                let d = w.hypot(h);
                let x = -extent + 2.0 * extent * p;
                let point = |a: f64, b: f64| {
                    [
                        w / 2.0 + a * angle.cos() - b * angle.sin(),
                        h / 2.0 + a * angle.sin() + b * angle.cos(),
                    ]
                };
                let mask = Clip::Polygons {
                    points: vec![vec![point(-d, -d), point(x, -d), point(x, d), point(-d, d)]],
                };
                let mut ops = vec![
                    DrawCommand::image(Input::From),
                    image(Input::To, IDENTITY, Some(mask), true, 1.0),
                ];
                if let Some(edge) = edge {
                    let ew = edge.width * short;
                    ops.push(DrawCommand::Fill {
                        role: edge.role,
                        color: edge.color,
                        opacity: 1.0,
                        path: Clip::Polygons {
                            points: vec![vec![
                                point(x - ew, -d),
                                point(x, -d),
                                point(x, d),
                                point(x - ew, d),
                            ]],
                        },
                    });
                }
                ops
            }
            Self::Push { direction } => {
                let (dx, dy) = match direction {
                    Direction::Left => (-1.0, 0.0),
                    Direction::Right => (1.0, 0.0),
                    Direction::Up => (0.0, -1.0),
                    Direction::Down => (0.0, 1.0),
                };
                vec![
                    image(
                        Input::From,
                        [1.0, 0.0, 0.0, 1.0, dx * p * w, dy * p * h],
                        None,
                        false,
                        1.0,
                    ),
                    image(
                        Input::To,
                        [1.0, 0.0, 0.0, 1.0, dx * (p - 1.0) * w, dy * (p - 1.0) * h],
                        None,
                        false,
                        1.0,
                    ),
                ]
            }
            Self::Slices { count } => {
                let mut ops = vec![DrawCommand::image(Input::From)];
                for i in 0..*count {
                    let y = f64::from(i) * h / f64::from(*count);
                    let bh = h / f64::from(*count);
                    let d = (p * 1.6 - f64::from(i) / f64::from(*count) * 0.6).clamp(0.0, 1.0);
                    let off = (1.0 - out_expo(d)) * w * if i % 2 == 1 { 1.0 } else { -1.0 };
                    ops.push(image(
                        Input::To,
                        [1.0, 0.0, 0.0, 1.0, off, 0.0],
                        Some(Clip::Rect {
                            x: 0.0,
                            y,
                            width: w,
                            height: bh,
                        }),
                        true,
                        1.0,
                    ));
                }
                ops
            }
            Self::Zoom => {
                let a = in_expo((p * 1.3).clamp(0.0, 1.0));
                let b = out_expo((p * 1.3 - 0.3).clamp(0.0, 1.0));
                vec![
                    image(
                        Input::From,
                        transformed(w / 2.0, h / 2.0, w / 2.0, h / 2.0, 0.0, 1.0 + a * 3.0),
                        None,
                        false,
                        1.0 - a,
                    ),
                    image(
                        Input::To,
                        transformed(w / 2.0, h / 2.0, w / 2.0, h / 2.0, 0.0, 0.4 + 0.6 * b),
                        None,
                        false,
                        b,
                    ),
                ]
            }
            Self::Ink { seed: s, blobs } => {
                let seed = seed ^ s;
                let mut polygons = Vec::new();
                for i in 0..*blobs {
                    let x = random(seed, i * 4 + 1) * w;
                    let y = random(seed, i * 4 + 2) * h;
                    // One guaranteed covering blob avoids a last-frame snap due
                    // to random holes; all blobs still have organic boundaries.
                    let cover = x.max(w - x).hypot(y.max(h - y)) / 0.65;
                    let r = p
                        * cover
                        * if i == 0 {
                            1.0
                        } else {
                            0.3 + random(seed, i * 4 + 3) * 0.7
                        };
                    polygons.push(
                        (0..24)
                            .map(|j| {
                                let a = f64::from(j) / 24.0 * std::f64::consts::TAU;
                                let rr = r * (0.85 + 0.15 * (a * 5.0 + f64::from(i)).sin());
                                [x + a.cos() * rr, y + a.sin() * rr]
                            })
                            .collect(),
                    );
                }
                vec![
                    DrawCommand::image(Input::From),
                    image(
                        Input::To,
                        IDENTITY,
                        Some(Clip::Polygons { points: polygons }),
                        true,
                        1.0,
                    ),
                ]
            }
            Self::Shatter { .. } => super::transition_shatter::plan(self, p, w, h, seed),
            Self::Peel { .. } => super::transition_peel::plan(self, p, w, h),
            Self::Bend { .. } => super::transition_bend::plan(self, p, w, h),
            Self::Barrier {
                pivot,
                colors,
                width,
                stripes,
                role,
            } => {
                let angle = -std::f64::consts::FRAC_PI_2 + p * std::f64::consts::PI;
                let x = pivot[0] * w;
                let y = pivot[1] * h;
                let d = w.hypot(h) * 3.0;
                let point = |a: f64, b: f64| {
                    [
                        x + a * angle.cos() - b * angle.sin(),
                        y + a * angle.sin() + b * angle.cos(),
                    ]
                };
                // Reveal the half-plane above the arm. The full sweep covers
                // portrait and landscape frames, unlike the fixed horizon cut.
                let mask = Clip::Polygons {
                    points: vec![vec![
                        point(-d, 0.0),
                        point(d, 0.0),
                        point(d, -d),
                        point(-d, -d),
                    ]],
                };
                let mut ops = vec![
                    DrawCommand::image(Input::From),
                    image(Input::To, IDENTITY, Some(mask), true, 1.0),
                ];
                let bw = width * short / 2.0;
                for i in 0..*stripes {
                    let a = f64::from(i) * d / f64::from(*stripes);
                    let b = f64::from(i + 1) * d / f64::from(*stripes);
                    ops.push(DrawCommand::Fill {
                        role: *role,
                        color: colors[(i % 2) as usize],
                        opacity: 1.0,
                        path: Clip::Polygons {
                            points: vec![vec![
                                point(a, -bw),
                                point(b, -bw),
                                point(b, bw),
                                point(a, bw),
                            ]],
                        },
                    });
                }
                ops
            }
        }
    }
}
