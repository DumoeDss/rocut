use serde::Serialize;
pub type Color = [f64; 4];
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Style {
    Solid {
        color: Color,
    },
    Linear {
        from: [f64; 2],
        to: [f64; 2],
        stops: Vec<(f64, Color)>,
    },
    Radial {
        from: [f64; 3],
        to: [f64; 3],
        stops: Vec<(f64, Color)>,
    },
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Save,
    Restore,
    Translate {
        offset: [f64; 2],
    },
    Rotate {
        radians: f64,
    },
    Scale {
        factors: [f64; 2],
    },
    Transform {
        matrix: [f64; 6],
    },
    Alpha {
        value: f64,
    },
    Composite {
        value: &'static str,
    },
    Filter {
        blur_px: f64,
    },
    Smoothing {
        quality: &'static str,
    },
    FillStyle {
        style: Style,
    },
    StrokeStyle {
        style: Style,
    },
    LineWidth {
        value: f64,
    },
    LineCap {
        value: &'static str,
    },
    LineJoin {
        value: &'static str,
    },
    BeginPath,
    MoveTo {
        point: [f64; 2],
    },
    LineTo {
        point: [f64; 2],
    },
    BezierCurveTo {
        control1: [f64; 2],
        control2: [f64; 2],
        point: [f64; 2],
    },
    Arc {
        center: [f64; 2],
        radius: f64,
        start: f64,
        end: f64,
    },
    Ellipse {
        center: [f64; 2],
        radii: [f64; 2],
        rotation: f64,
        start: f64,
        end: f64,
    },
    RectPath {
        rect: [f64; 4],
    },
    ClosePath,
    Clip,
    Fill,
    Stroke,
    FillRect {
        rect: [f64; 4],
    },
    Image {
        source: String,
        source_kind: &'static str,
        source_rect: Option<[f64; 4]>,
        destination_rect: [f64; 4],
        intrinsic: bool,
    },
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    Surface {
        id: &'static str,
        size: [u32; 2],
    },
    Release {
        surface: &'static str,
    },
    Native {
        target: &'static str,
        action: Action,
    },
    /// Snapshot the already-drawn scene, not a decoded fallback or self-blit.
    Capture {
        surface: &'static str,
        source_rect: [f64; 4],
        destination_rect: [f64; 4],
    },
    /// Original S.fg copy uses the native main CTM at this exact point.
    Foreground {
        surface: &'static str,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub commands: Vec<Command>,
    pub raster_budget_bytes: u64,
}
pub struct Draw {
    pub commands: Vec<Command>,
    pub target: &'static str,
}
impl Draw {
    pub fn new() -> Self {
        Self {
            commands: vec![],
            target: "main",
        }
    }
    pub fn a(&mut self, action: Action) {
        self.commands.push(Command::Native {
            target: self.target,
            action,
        });
    }
    pub fn surface(&mut self, id: &'static str, size: [u32; 2]) {
        self.commands.push(Command::Surface { id, size });
    }
    pub fn release(&mut self, id: &'static str) {
        self.commands.push(Command::Release { surface: id });
    }
    pub fn fill(&mut self, c: [f64; 3], alpha: f64) {
        self.a(Action::FillStyle {
            style: solid(c, alpha),
        });
    }
    pub fn stroke(&mut self, c: [f64; 3], alpha: f64, width: f64) {
        self.a(Action::StrokeStyle {
            style: solid(c, alpha),
        });
        self.a(Action::LineWidth { value: width });
    }
    pub fn rect(&mut self, rect: [f64; 4]) {
        self.a(Action::FillRect { rect });
    }
    pub fn linear(&mut self, from: [f64; 2], to: [f64; 2], stops: &[(f64, [f64; 3], f64)]) {
        self.a(Action::FillStyle {
            style: Style::Linear {
                from,
                to,
                stops: stops.iter().map(|(k, c, a)| (*k, color(*c, *a))).collect(),
            },
        });
    }
    pub fn radial(&mut self, from: [f64; 3], to: [f64; 3], stops: &[(f64, [f64; 3], f64)]) {
        self.a(Action::FillStyle {
            style: Style::Radial {
                from,
                to,
                stops: stops.iter().map(|(k, c, a)| (*k, color(*c, *a))).collect(),
            },
        });
    }
    pub fn poly(&mut self, p: &[[f64; 2]]) -> bool {
        if p.len() < 3 {
            return false;
        }
        self.a(Action::BeginPath);
        self.a(Action::MoveTo { point: p[0] });
        for point in &p[1..] {
            self.a(Action::LineTo { point: *point });
        }
        self.a(Action::ClosePath);
        true
    }
    pub fn image(&mut self, id: &str, sr: Option<[f64; 4]>, dr: [f64; 4], intrinsic: bool) {
        self.a(Action::Image {
            source: id.into(),
            source_kind: "surface",
            source_rect: sr,
            destination_rect: dr,
            intrinsic,
        });
    }
    pub fn asset(&mut self, id: &str, sr: Option<[f64; 4]>, dr: [f64; 4], intrinsic: bool) {
        self.a(Action::Image {
            source: id.into(),
            source_kind: "asset",
            source_rect: sr,
            destination_rect: dr,
            intrinsic,
        });
    }
    pub fn glow(&mut self, x: f64, y: f64, r: f64, c: [f64; 3], a: f64) {
        self.a(Action::Save);
        self.a(Action::Composite { value: "lighter" });
        self.radial(
            [x, y, 0.0],
            [x, y, r],
            &[(0.0, c, a), (0.25, c, a * 0.45), (1.0, c, 0.0)],
        );
        self.rect([x - r, y - r, 2.0 * r, 2.0 * r]);
        self.a(Action::Restore);
    }
}
pub fn color(c: [f64; 3], alpha: f64) -> Color {
    [
        (c[0].trunc()) / 255.0,
        c[1].trunc() / 255.0,
        c[2].trunc() / 255.0,
        alpha,
    ]
}
pub fn solid(c: [f64; 3], alpha: f64) -> Style {
    Style::Solid {
        color: color(c, alpha),
    }
}
