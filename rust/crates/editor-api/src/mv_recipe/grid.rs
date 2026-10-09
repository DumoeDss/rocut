//! Image tiles follow an analytical radial height wave. Source-frame progress
//! resolves the full mesh, including projection and far-to-near face order.
use super::catalog::{
    GENERATOR_PRIMITIVES, NumberRule, OPACITY, PARTICLE_GRID, RECT_ORIGIN, RECT_SIZE,
};
use super::generator_model::Fit;
use super::mesh_model::{MeshFace, MeshImagePlan, MeshVertex};
use super::transitions::random;
use serde::Deserialize;
use serde_json::{Value, json};

const fn rule(min: f64, max: f64, suggested: f64) -> NumberRule {
    NumberRule {
        min,
        max,
        integer: false,
        suggested,
    }
}
const CENTER: NumberRule = rule(0.0, 1.0, 0.5);
const WAVELENGTH: NumberRule = rule(0.05, 2.0, 0.6);
const CYCLES: NumberRule = rule(0.0, 8.0, 2.0);
const LIFT: NumberRule = rule(0.0, 1.0, 0.18);
const TILT: NumberRule = rule(0.0, 60.0, 22.0);
const GAP: NumberRule = rule(0.0, 0.6, 0.08);
const PERSPECTIVE: NumberRule = rule(0.0, 1.0, 0.6);
const SHADING: NumberRule = rule(0.0, 1.0, 0.35);
const SEED_PHASE_KEY: u32 = 0x6d2b_79f5;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grid {
    pub image: String,
    pub rect: [f64; 4],
    pub fit: Fit,
    pub columns: u32,
    pub rows: u32,
    pub center: [f64; 2],
    pub wavelength: f64,
    pub cycles: f64,
    pub lift: f64,
    pub tilt: f64,
    pub gap: f64,
    pub perspective: f64,
    pub shading: f64,
    pub opacity: f64,
}

impl Grid {
    pub fn valid(&self) -> bool {
        PARTICLE_GRID.valid(self.columns)
            && PARTICLE_GRID.valid(self.rows)
            && self.work() <= GENERATOR_PRIMITIVES
            && self.rect[..2].iter().all(|v| RECT_ORIGIN.valid(*v))
            && self.rect[2..].iter().all(|v| RECT_SIZE.valid(*v))
            && self.center.iter().all(|v| CENTER.valid(*v))
            && WAVELENGTH.valid(self.wavelength)
            && CYCLES.valid(self.cycles)
            && LIFT.valid(self.lift)
            && TILT.valid(self.tilt)
            && GAP.valid(self.gap)
            && PERSPECTIVE.valid(self.perspective)
            && SHADING.valid(self.shading)
            && OPACITY.valid(self.opacity)
    }

    pub fn work(&self) -> u32 {
        self.columns.saturating_mul(self.rows).saturating_mul(2)
    }

    pub fn plan(&self, progress: f64, seed: u32, width: f64, height: f64) -> MeshImagePlan {
        let p = progress.clamp(0.0, 1.0);
        let rect = [
            self.rect[0] * width,
            self.rect[1] * height,
            self.rect[2] * width,
            self.rect[3] * height,
        ];
        let full_image = p <= 0.0 || p >= 1.0;
        let mut faces = Vec::new();
        if !full_image && self.opacity > 0.0 {
            let envelope = (std::f64::consts::PI * p).sin();
            let short_side = rect[2].min(rect[3]);
            let camera_distance = rect[2].max(rect[3]) * 2.0;
            let tile = [
                rect[2] / f64::from(self.columns),
                rect[3] / f64::from(self.rows),
            ];
            let optical_center = [rect[0] + rect[2] * 0.5, rect[1] + rect[3] * 0.5];
            let wave_center = [
                rect[0] + rect[2] * self.center[0],
                rect[1] + rect[3] * self.center[1],
            ];
            let seed_phase = random(seed, SEED_PHASE_KEY) * std::f64::consts::TAU;
            for row in 0..self.rows {
                for column in 0..self.columns {
                    let tile_center = [
                        rect[0] + (f64::from(column) + 0.5) * tile[0],
                        rect[1] + (f64::from(row) + 0.5) * tile[1],
                    ];
                    let delta = [
                        tile_center[0] - wave_center[0],
                        tile_center[1] - wave_center[1],
                    ];
                    let distance = delta[0].hypot(delta[1]);
                    let radial = if distance > 0.0 {
                        [delta[0] / distance, delta[1] / distance]
                    } else {
                        [0.0, 0.0]
                    };
                    let phase = std::f64::consts::TAU
                        * (distance / short_side / self.wavelength - self.cycles * p)
                        + seed_phase;
                    let depth = self.lift * short_side * envelope * phase.sin();
                    let angle = self.tilt.to_radians() * envelope * phase.cos();
                    let (sin_x, cos_x) = (angle * radial[1]).sin_cos();
                    let (sin_y, cos_y) = (-angle * radial[0]).sin_cos();
                    let shrink = 1.0 - self.gap * envelope;
                    let vertices = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
                        .into_iter()
                        .map(|corner| {
                            let local = [
                                (corner[0] - 0.5) * tile[0] * shrink,
                                (corner[1] - 0.5) * tile[1] * shrink,
                            ];
                            // Y then X rotation preserves each tile as a rigid quad.
                            let rotated = [
                                local[0] * cos_y,
                                local[1] * cos_x + local[0] * sin_y * sin_x,
                                local[1] * sin_x - local[0] * sin_y * cos_x,
                            ];
                            let z = depth + rotated[2];
                            // z <= shortSide + halfDiagonal < 2*longSide for all
                            // validated controls, so the perspective divisor is positive.
                            let w = 1.0 - self.perspective * z / camera_distance;
                            MeshVertex {
                                position: [
                                    optical_center[0]
                                        + (tile_center[0] + rotated[0] - optical_center[0]) / w,
                                    optical_center[1]
                                        + (tile_center[1] + rotated[1] - optical_center[1]) / w,
                                ],
                                uv: [
                                    (rect[0] + (f64::from(column) + corner[0]) * tile[0]) / width,
                                    (rect[1] + (f64::from(row) + corner[1]) * tile[1]) / height,
                                ],
                                w,
                            }
                        })
                        .collect();
                    faces.push(MeshFace {
                        vertices,
                        brightness: 1.0 - self.shading * (1.0 - cos_x * cos_y),
                        opacity: self.opacity,
                        depth,
                        color_offset: None,
                    });
                }
            }
            // Stable sorting retains authored row-major order for depth ties.
            faces.sort_by(|a, b| a.depth.partial_cmp(&b.depth).expect("finite Grid depth"));
        }
        MeshImagePlan {
            image: self.image.clone(),
            rect,
            fit: self.fit,
            opacity: self.opacity,
            full_image,
            faces,
        }
    }
}

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite Grid rule");
    if rule.integer {
        value["min"] = json!(rule.min as i64);
        value["max"] = json!(rule.max as i64);
        value["suggested"] = json!(rule.suggested as i64);
    }
    value["type"] = json!("number");
    value["unit"] = json!(unit);
    value
}

pub(super) fn catalog_entry() -> Value {
    json!({
        "requires":["worker-webgl2","declared-image-resource"],
        "binding":"scene.settings plus scene.role, scene.span and scene.easing",
        "clock":"explicit source-frame span -> eased progress; ref remaps source time; no accumulated simulation",
        "parameters":{
            "image":{"type":"resource","kind":"image"},
            "rect":{"type":"tuple","items":[number(RECT_ORIGIN,"frame-width"),number(RECT_ORIGIN,"frame-height"),number(RECT_SIZE,"frame-width"),number(RECT_SIZE,"frame-height")]},
            "fit":{"type":"enum","options":[Fit::Contain,Fit::Cover,Fit::Stretch],"suggested":"contain"},
            "columns":number(PARTICLE_GRID,"tiles"),"rows":number(PARTICLE_GRID,"tiles"),
            "center":{"type":"tuple","items":[number(CENTER,"rect-width"),number(CENTER,"rect-height")]},
            "wavelength":number(WAVELENGTH,"rect-short-side"),
            "cycles":number(CYCLES,"wave-cycles-per-span"),
            "lift":number(LIFT,"rect-short-side"),"tilt":number(TILT,"degrees"),
            "gap":number(GAP,"tile-side-ratio"),
            "perspective":number(PERSPECTIVE,"ratio"),"shading":number(SHADING,"ratio"),
            "opacity":number(OPACITY,"ratio")
        },
        "constraints":["columns * rows * 2 triangles charged to expanded primitive budget","four additional raster surfaces","every listed parameter is required"],
        "endpoints":"progress 0 and 1 are the complete fitted image; intermediate height, tilt and gap use sin(pi*progress)",
        "geometry":"rigid textured quads; radial wave in rect pixels; camera distance 2*rect long side; perspective center is rect center; positive clipW; stable far-to-near depth order",
        "seed":"source.seed selects one global radial-wave phase; cell order and source UVs are seed-independent",
        "opacity":"fullImage uses plan opacity; mesh faces contain final opacity and are not multiplied by plan opacity again",
        "limitations":["one declared image fitted into a frame-sized source canvas, not lower compositor content","off-frame source UVs are transparent","analytical wave tiles, not a physics simulation"]
    })
}
