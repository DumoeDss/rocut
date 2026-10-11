use super::math::{H, W, rgba};
use serde::Serialize;
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Brush {
    Color { value: String },
    Gradient { id: String },
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Source {
    Resource { id: String },
    Surface { id: String },
}
#[derive(Serialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    Save,
    Restore,
    BeginPath,
    ClosePath,
    Arc {
        center: [f64; 2],
        radius: f64,
        start: f64,
        end: f64,
    },
    RoundRect {
        rect: [f64; 4],
        radius: f64,
    },
    StrokeRect {
        rect: [f64; 4],
    },
    QuadraticCurveTo {
        points: [f64; 4],
    },
    BezierCurveTo {
        points: [f64; 6],
    },
    Translate {
        point: [f64; 2],
    },
    Scale {
        point: [f64; 2],
    },
    Rotate {
        angle: f64,
    },
    SetTransform {
        matrix: [f64; 6],
    },
    Alpha {
        value: f64,
    },
    LineWidth {
        value: f64,
    },
    ShadowBlur {
        value: f64,
    },
    Composite {
        value: String,
    },
    Filter {
        value: String,
    },
    ShadowColor {
        value: String,
    },
    LineCap {
        value: String,
    },
    TextAlign {
        value: String,
    },
    TextBaseline {
        value: String,
    },
    LineDash {
        values: Vec<f64>,
    },
    FillStyle {
        brush: Brush,
    },
    StrokeStyle {
        brush: Brush,
    },
    LinearGradient {
        id: String,
        points: [f64; 4],
        stops: Vec<(f64, String)>,
    },
    RadialGradient {
        id: String,
        points: [f64; 6],
        stops: Vec<(f64, String)>,
    },
    Rect {
        rect: [f64; 4],
    },
    FillRect {
        rect: [f64; 4],
    },
    ClearRect {
        rect: [f64; 4],
    },
    MoveTo {
        point: [f64; 2],
    },
    LineTo {
        point: [f64; 2],
    },
    Ellipse {
        center: [f64; 2],
        radii: [f64; 2],
        rotation: f64,
        start: f64,
        end: f64,
    },
    Clip {
        rule: &'static str,
    },
    Fill {
        rule: &'static str,
    },
    Stroke,
    DrawImage {
        image: Source,
        source_rect: Option<[f64; 4]>,
        destination_rect: [f64; 4],
    },
    Font {
        role: &'static str,
        size: f64,
        weight: u16,
    },
    FillText {
        text: String,
        point: [f64; 2],
    },
    PutRgba {
        size: [u32; 2],
        bytes: Vec<u8>,
    },
    PutAlpha {
        size: [u32; 2],
        bytes: Vec<u8>,
    },
}
#[derive(Serialize)]
pub struct Surface {
    pub id: String,
    pub size: [u32; 2],
    pub operations: Vec<Op>,
}
pub struct Canvas {
    pub ops: Vec<Op>,
    prefix: String,
    next: usize,
}
impl Canvas {
    pub fn new(prefix: &str) -> Self {
        Self {
            ops: Vec::new(),
            prefix: prefix.into(),
            next: 0,
        }
    }
    pub fn save(&mut self) {
        self.ops.push(Op::Save)
    }
    pub fn restore(&mut self) {
        self.ops.push(Op::Restore)
    }
    pub fn alpha(&mut self, value: f64) {
        self.ops.push(Op::Alpha { value })
    }
    pub fn composite(&mut self, value: &str) {
        self.ops.push(Op::Composite {
            value: value.into(),
        })
    }
    pub fn filter(&mut self, value: &str) {
        self.ops.push(Op::Filter {
            value: value.into(),
        })
    }
    pub fn fill_color(&mut self, color: &str) {
        self.ops.push(Op::FillStyle {
            brush: Brush::Color {
                value: color.into(),
            },
        })
    }
    pub fn stroke_color(&mut self, color: &str) {
        self.ops.push(Op::StrokeStyle {
            brush: Brush::Color {
                value: color.into(),
            },
        })
    }
    pub fn fill_brush(&mut self, brush: Brush) {
        self.ops.push(Op::FillStyle { brush })
    }
    pub fn stroke_brush(&mut self, brush: Brush) {
        self.ops.push(Op::StrokeStyle { brush })
    }
    pub fn width(&mut self, value: f64) {
        self.ops.push(Op::LineWidth { value })
    }
    pub fn translate(&mut self, x: f64, y: f64) {
        self.ops.push(Op::Translate { point: [x, y] })
    }
    pub fn scale(&mut self, x: f64, y: f64) {
        self.ops.push(Op::Scale { point: [x, y] })
    }
    pub fn rotate(&mut self, angle: f64) {
        self.ops.push(Op::Rotate { angle })
    }
    pub fn begin(&mut self) {
        self.ops.push(Op::BeginPath)
    }
    pub fn close(&mut self) {
        self.ops.push(Op::ClosePath)
    }
    pub fn clip(&mut self, rule: &'static str) {
        self.ops.push(Op::Clip { rule })
    }
    pub fn fill(&mut self) {
        self.ops.push(Op::Fill { rule: "nonzero" })
    }
    pub fn stroke(&mut self) {
        self.ops.push(Op::Stroke)
    }
    pub fn rect(&mut self, rect: [f64; 4]) {
        self.ops.push(Op::Rect { rect })
    }
    pub fn fill_rect(&mut self, rect: [f64; 4]) {
        self.ops.push(Op::FillRect { rect })
    }
    pub fn move_to(&mut self, x: f64, y: f64) {
        self.ops.push(Op::MoveTo { point: [x, y] })
    }
    pub fn line_to(&mut self, x: f64, y: f64) {
        self.ops.push(Op::LineTo { point: [x, y] })
    }
    pub fn ellipse(&mut self, x: f64, y: f64, rx: f64, ry: f64, start: f64, end: f64) {
        self.ops.push(Op::Ellipse {
            center: [x, y],
            radii: [rx, ry],
            rotation: 0.0,
            start,
            end,
        })
    }
    fn id(&mut self) -> String {
        self.next += 1;
        format!("{}-g{}", self.prefix, self.next)
    }
    pub fn linear(&mut self, points: [f64; 4], stops: &[(f64, String)]) -> Brush {
        let id = self.id();
        self.ops.push(Op::LinearGradient {
            id: id.clone(),
            points,
            stops: stops.to_vec(),
        });
        Brush::Gradient { id }
    }
    pub fn radial(&mut self, points: [f64; 6], stops: &[(f64, String)]) -> Brush {
        let id = self.id();
        self.ops.push(Op::RadialGradient {
            id: id.clone(),
            points,
            stops: stops.to_vec(),
        });
        Brush::Gradient { id }
    }
    pub fn image(&mut self, id: &str, source_rect: Option<[f64; 4]>, destination_rect: [f64; 4]) {
        self.ops.push(Op::DrawImage {
            image: Source::Resource { id: id.into() },
            source_rect,
            destination_rect,
        })
    }
    pub fn blit(&mut self, id: &str, source_rect: Option<[f64; 4]>, destination_rect: [f64; 4]) {
        self.ops.push(Op::DrawImage {
            image: Source::Surface { id: id.into() },
            source_rect,
            destination_rect,
        })
    }
    pub fn font(&mut self, role: &'static str, size: f64) {
        self.ops.push(Op::Font {
            role,
            size,
            weight: if role == "mincho800" { 800 } else { 400 },
        })
    }
    pub fn align(&mut self, value: &str) {
        self.ops.push(Op::TextAlign {
            value: value.into(),
        })
    }
    pub fn baseline(&mut self, value: &str) {
        self.ops.push(Op::TextBaseline {
            value: value.into(),
        })
    }
    pub fn text(&mut self, text: &str, x: f64, y: f64) {
        self.ops.push(Op::FillText {
            text: text.into(),
            point: [x, y],
        })
    }
    pub fn shadow(&mut self, color: &str, blur: f64) {
        self.ops.push(Op::ShadowColor {
            value: color.into(),
        });
        self.ops.push(Op::ShadowBlur { value: blur })
    }
    pub fn trace(&mut self, points: &[[f64; 2]]) {
        self.move_to(points[0][0], points[0][1]);
        for p in &points[1..] {
            self.line_to(p[0], p[1]);
        }
        self.close()
    }
    pub fn glow(&mut self, x: f64, y: f64, rx: f64, ry: f64, color: &str, a: f64) {
        if !(a > 0.003) || rx < 0.5 || ry < 0.2 {
            return;
        }
        self.save();
        self.composite("lighter");
        let mut k = a;
        while k > 0.003 {
            self.alpha(k.min(1.0));
            self.blit(
                &format!("glow-{color}"),
                None,
                [x - rx, y - ry, rx * 2.0, ry * 2.0],
            );
            k -= 1.0;
        }
        self.restore()
    }
    pub fn vignette(&mut self, a: f64, inner: f64, col: &str) {
        let g = self.radial(
            [W / 2.0, H * 0.52, H * inner, W / 2.0, H * 0.52, H * 1.05],
            &[
                (0.0, format!("rgba({col},0)")),
                (1.0, format!("rgba({col},{a})")),
            ],
        );
        self.save();
        self.fill_brush(g);
        self.fill_rect([0.0, 0.0, W, H]);
        self.restore()
    }
    pub fn gradient_rect(&mut self, rect: [f64; 4], stops: &[(f64, String)]) {
        let g = self.linear([0.0, rect[1], 0.0, rect[1] + rect[3]], stops);
        self.save();
        self.fill_brush(g);
        self.fill_rect(rect);
        self.restore()
    }
    pub fn glow_surface(color: &str) -> Surface {
        let id = format!("glow-{color}");
        let mut c = Self::new(&id);
        let g = c.radial(
            [64.0, 64.0, 0.0, 64.0, 64.0, 64.0],
            &[
                (0.0, rgba(color, 1.0)),
                (0.18, rgba(color, 0.55)),
                (0.5, rgba(color, 0.14)),
                (1.0, rgba(color, 0.0)),
            ],
        );
        c.fill_brush(g);
        c.fill_rect([0.0, 0.0, 128.0, 128.0]);
        Surface {
            id,
            size: [128, 128],
            operations: c.ops,
        }
    }
}
