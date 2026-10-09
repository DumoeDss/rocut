//! Image-bearing regular hexagons with source-frame-driven rigid motion.
use super::catalog::{GENERATOR_PRIMITIVES, NumberRule, OPACITY, RECT_ORIGIN, RECT_SIZE};
use super::generator_model::Fit;
use super::mesh_model::{MeshFace, MeshImagePlan, MeshVertex};
use super::transitions::random;
use serde::Deserialize;
use serde_json::{Value, json};
use std::f64::consts::{PI, TAU};

const SIZE: NumberRule = NumberRule {
    min: 0.02,
    max: 0.5,
    integer: false,
    suggested: 0.12,
};
const LIFT: NumberRule = NumberRule {
    min: 0.0,
    max: 1.0,
    integer: false,
    suggested: 0.22,
};
const TILT: NumberRule = NumberRule {
    min: 0.0,
    max: 1.2,
    integer: false,
    suggested: 0.4,
};
const GAP: NumberRule = NumberRule {
    min: 0.0,
    max: 0.75,
    integer: false,
    suggested: 0.12,
};
const CYCLES: NumberRule = NumberRule {
    min: 0.0,
    max: 8.0,
    integer: false,
    suggested: 1.0,
};
const PERSPECTIVE: NumberRule = NumberRule {
    min: 0.0,
    max: 0.8,
    integer: false,
    suggested: 0.5,
};
const SHADING: NumberRule = NumberRule {
    min: 0.0,
    max: 1.0,
    integer: false,
    suggested: 0.5,
};
const CORNERS: [[i32; 2]; 6] = [[1, 1], [0, 2], [-1, 1], [-1, -1], [0, -2], [1, -1]];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HexFloat {
    pub image: String,
    pub rect: [f64; 4],
    pub fit: Fit,
    pub size: f64,
    pub lift: f64,
    pub tilt: f64,
    pub gap: f64,
    pub cycles: f64,
    pub perspective: f64,
    pub shading: f64,
    pub opacity: f64,
}

struct Grid {
    rect: [f64; 4],
    short: f64,
    radius: f64,
    half_width: f64,
    rows: u32,
    even_columns: u32,
    odd_columns: u32,
    count: u32,
}

impl HexFloat {
    pub fn valid(&self) -> bool {
        self.rect[..2].iter().all(|v| RECT_ORIGIN.valid(*v))
            && self.rect[2..].iter().all(|v| RECT_SIZE.valid(*v))
            && SIZE.valid(self.size)
            && LIFT.valid(self.lift)
            && TILT.valid(self.tilt)
            && GAP.valid(self.gap)
            && CYCLES.valid(self.cycles)
            && PERSPECTIVE.valid(self.perspective)
            && SHADING.valid(self.shading)
            && OPACITY.valid(self.opacity)
    }

    /// Bounds precede all per-cell iteration and allocation, including at endpoints.
    fn grid(&self, width: f64, height: f64) -> Option<Grid> {
        if !self.valid()
            || !width.is_finite()
            || !height.is_finite()
            || !(1.0..=4096.0).contains(&width)
            || !(1.0..=4096.0).contains(&height)
        {
            return None;
        }
        let rect = [
            self.rect[0] * width,
            self.rect[1] * height,
            self.rect[2] * width,
            self.rect[3] * height,
        ];
        if !rect.iter().all(|v| v.is_finite()) || rect[2] <= 0.0 || rect[3] <= 0.0 {
            return None;
        }
        let short = rect[2].min(rect[3]);
        let radius = self.size * short;
        let half_width = 3.0_f64.sqrt() * 0.5 * radius;
        if radius <= 0.0 || !half_width.is_finite() || half_width <= 0.0 {
            return None;
        }
        // Odd rows include the left tangent hex; outer corners keep their UVs.
        let rows = ((rect[3] / radius + 1.0) / 1.5).floor() + 1.0;
        let even_columns = (rect[2] / (2.0 * half_width) + 0.5).floor() + 1.0;
        let odd_columns = (rect[2] / (2.0 * half_width)).floor() + 2.0;
        let count = (rows / 2.0).ceil() * even_columns + (rows / 2.0).floor() * odd_columns;
        if !count.is_finite() || count <= 0.0 || count > f64::from(GENERATOR_PRIMITIVES / 4) {
            return None;
        }
        Some(Grid {
            rect,
            short,
            radius,
            half_width,
            rows: rows as u32,
            even_columns: even_columns as u32,
            odd_columns: odd_columns as u32,
            count: count as u32,
        })
    }

    /// Six convex vertices form four fan triangles; repeated DAG inputs pay again.
    pub fn work(&self, width: f64, height: f64) -> u32 {
        self.grid(width, height)
            .map_or(u32::MAX, |grid| grid.count * 4)
    }

    pub fn plan(&self, progress: f64, seed: u32, width: f64, height: f64) -> MeshImagePlan {
        let mut plan = MeshImagePlan {
            image: self.image.clone(),
            rect: [
                self.rect[0] * width,
                self.rect[1] * height,
                self.rect[2] * width,
                self.rect[3] * height,
            ],
            fit: self.fit,
            opacity: self.opacity,
            full_image: false,
            faces: Vec::new(),
        };
        let Some(grid) = self.grid(width, height) else {
            return plan;
        };
        let p = progress.clamp(0.0, 1.0);
        if p <= 0.0 || p >= 1.0 {
            plan.full_image = true;
            return plan;
        }
        if self.opacity == 0.0 || !p.is_finite() {
            return plan;
        }
        let envelope = (PI * p).sin().powi(2);
        let phase = TAU * self.cycles * p;
        let scale = 1.0 - self.gap * envelope;
        plan.faces.reserve(grid.count as usize);
        for row in 0..grid.rows {
            let odd = row % 2;
            let columns = if odd == 0 {
                grid.even_columns
            } else {
                grid.odd_columns
            };
            for column_index in 0..columns {
                let column = column_index as i32 - odd as i32;
                let key = plan.faces.len() as u32 * 3;
                let wave = 0.5 + 0.5 * (phase + TAU * random(seed, key)).sin();
                let depth = grid.short * self.lift * envelope * (0.25 + 0.75 * wave);
                let ax = self.tilt * envelope * (phase + TAU * random(seed, key + 1)).sin();
                let ay = self.tilt * envelope * (phase + TAU * random(seed, key + 2)).cos();
                let (sx, cx) = ax.sin_cos();
                let (sy, cy) = ay.sin_cos();
                let normal = [sy * cx, -sx, cy * cx];
                let dot = ((-0.35 * normal[0] - 0.45 * normal[1] + normal[2]) / 1.325_f64.sqrt())
                    .clamp(0.0, 1.0);
                let brightness = 1.0 - 0.75 * self.shading * envelope * (1.0 - dot);
                let center = [
                    grid.rect[0] + grid.rect[2] * 0.5,
                    grid.rect[1] + grid.rect[3] * 0.5,
                ];
                let vertices = CORNERS
                    .iter()
                    .map(|corner| {
                        // Shared source vertices use exactly the same lattice arithmetic.
                        let source = [
                            grid.rect[0]
                                + grid.half_width * f64::from(2 * column + odd as i32 + corner[0]),
                            grid.rect[1]
                                + (grid.radius * 0.5) * f64::from(3 * row as i32 + corner[1]),
                        ];
                        let local = [
                            grid.half_width * f64::from(corner[0]),
                            grid.radius * 0.5 * f64::from(corner[1]),
                        ];
                        let x = local[0] * scale;
                        let y = local[1] * scale;
                        // Rx followed by Ry; keep position equal to source when neutral.
                        let rotated_x = x * cy + y * sx * sy;
                        let rotated_y = y * cx;
                        let z = depth - x * sy + y * sx * cy;
                        let world = [
                            source[0] + (rotated_x - local[0]),
                            source[1] + (rotated_y - local[1]),
                        ];
                        let w = 1.0 - self.perspective * (z / grid.short) * 0.25;
                        let position = if w == 1.0 {
                            world
                        } else {
                            [
                                center[0] + (world[0] - center[0]) / w,
                                center[1] + (world[1] - center[1]) / w,
                            ]
                        };
                        MeshVertex {
                            position,
                            uv: [source[0] / width, source[1] / height],
                            w,
                        }
                    })
                    .collect();
                plan.faces.push(MeshFace {
                    vertices,
                    brightness,
                    opacity: self.opacity,
                    depth,
                    color_offset: None,
                });
            }
        }
        // Positive z approaches the camera. Stable ties keep lattice row order.
        plan.faces.sort_by(|a, b| a.depth.total_cmp(&b.depth));
        plan
    }
}

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite static rule");
    value["type"] = json!("number");
    value["unit"] = json!(unit);
    value
}

pub(super) fn catalog_entry() -> Value {
    json!({
        "requires":["worker-webgl2","declared-image-resource"],
        "binding":"scene.settings plus scene.role, scene.span and scene.easing",
        "clock":"explicit source-frame span -> eased progress; stateless seeded phases; ref remaps source time",
        "parameters":{
            "image":{"type":"resource","kind":"image"},
            "rect":{"type":"tuple","items":[number(RECT_ORIGIN,"frame-width"),number(RECT_ORIGIN,"frame-height"),number(RECT_SIZE,"frame-width"),number(RECT_SIZE,"frame-height")]},
            "fit":{"type":"enum","options":[Fit::Contain,Fit::Cover,Fit::Stretch],"suggested":"contain"},
            "size":number(SIZE,"rect-short-side-radius"),
            "lift":number(LIFT,"rect-short-side-depth"),
            "tilt":number(TILT,"radians"),
            "gap":number(GAP,"tile-radius-ratio"),
            "cycles":number(CYCLES,"cycles-per-span"),
            "perspective":number(PERSPECTIVE,"ratio"),
            "shading":number(SHADING,"ratio"),
            "opacity":number(OPACITY,"ratio")
        },
        "constraints":["4 triangles per hex including transparent perimeter cells; dimensions and every expanded DAG occurrence count toward 4096 primitives","four extra surfaces charged to raster budget","every listed parameter is required"],
        "layout":{"polygon":"regular pointy-top hexagon","radius":"size * min(rectWidthPixels,rectHeightPixels)","centerSpacing":["sqrt(3) * radius","1.5 * radius"],"oddRowOffset":"sqrt(3) * radius / 2","uv":"undeformed vertex / full source canvas dimensions"},
        "motion":"envelope=sin(pi*progress)^2; seeded sine phases control per-hex lift and two tilt axes; gap shrinks the polygon without changing source UVs",
        "projection":"w=1-perspective*z/(4*rectShortSide); projection centered on authored rect; positive z is near; faces sorted far to near",
        "alpha":"source alpha preserved; face opacity applies once; fullImage uses plan opacity",
        "endpoints":"progress 0 and 1 are the complete fitted image; intermediate neutral controls still use a continuous hex mesh",
        "limitations":["one declared image, not arbitrary lower compositor content","analytical rigid hexagons, not a physics simulation","large aspect ratios or small sizes can exceed the primitive budget","explicit error when Worker WebGL2 is unavailable"]
    })
}
