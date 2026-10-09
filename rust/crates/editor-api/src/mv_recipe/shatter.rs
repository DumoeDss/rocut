use super::catalog::{GENERATOR_PRIMITIVES, NumberRule, OPACITY, RECT_ORIGIN, RECT_SIZE};
use super::generator_model::Fit;
use super::mesh_model::{MeshFace, MeshImagePlan, MeshVertex};
use super::transitions::random;
use serde::Deserialize;
use serde_json::{Value, json};
use std::f64::consts::TAU;

#[path = "shatter_geometry.rs"]
mod geometry;

const fn rule(min: f64, max: f64, suggested: f64) -> NumberRule {
    NumberRule {
        min,
        max,
        integer: false,
        suggested,
    }
}
const FRAGMENTS: NumberRule = NumberRule {
    min: 4.0,
    max: 512.0,
    integer: true,
    suggested: 48.0,
};
const CENTER: NumberRule = rule(0.0, 1.0, 0.5);
const SPREAD: NumberRule = rule(0.0, 2.0, 0.75);
const SPIN: NumberRule = rule(0.0, TAU, 2.4);
const GRAVITY: NumberRule = rule(0.0, 2.0, 0.4);
const DEPTH: NumberRule = rule(0.0, 1.0, 0.35);
const PERSPECTIVE: NumberRule = rule(0.0, 0.8, 0.6);
const REFRACTION: NumberRule = rule(0.0, 0.08, 0.025);
const SHADING: NumberRule = rule(0.0, 1.0, 0.45);
const SHADOW: NumberRule = rule(0.0, 1.0, 0.3);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shatter {
    pub image: String,
    pub rect: [f64; 4],
    pub fit: Fit,
    pub fragments: u32,
    pub center: [f64; 2],
    pub spread: f64,
    pub spin: f64,
    pub gravity: f64,
    pub depth: f64,
    pub perspective: f64,
    pub refraction: f64,
    pub shading: f64,
    pub shadow: f64,
    pub opacity: f64,
}

impl Shatter {
    pub fn valid(&self) -> bool {
        FRAGMENTS.valid(self.fragments)
            && self.work() <= GENERATOR_PRIMITIVES
            && self.rect[..2].iter().all(|v| RECT_ORIGIN.valid(*v))
            && self.rect[2..].iter().all(|v| RECT_SIZE.valid(*v))
            && self.center.iter().all(|v| CENTER.valid(*v))
            && SPREAD.valid(self.spread)
            && SPIN.valid(self.spin)
            && GRAVITY.valid(self.gravity)
            && DEPTH.valid(self.depth)
            && PERSPECTIVE.valid(self.perspective)
            && REFRACTION.valid(self.refraction)
            && SHADING.valid(self.shading)
            && SHADOW.valid(self.shadow)
            && OPACITY.valid(self.opacity)
    }

    /// For n Voronoi cells in a rectangle, Euler plus vertex degree >= 3
    /// gives Vi + Vb <= 2n + 2. With Vb >= 4, fan triangles
    /// T = 2Vi + Vb - 2 <= 4n - 2. Shadow plus color costs < 8n.
    pub fn work(&self) -> u32 {
        self.fragments.saturating_mul(8)
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
        if !self.valid()
            || !progress.is_finite()
            || !width.is_finite()
            || !height.is_finite()
            || !(1.0..=4096.0).contains(&width)
            || !(1.0..=4096.0).contains(&height)
        {
            return plan;
        }
        let p = progress.clamp(0.0, 1.0);
        if p == 0.0 {
            plan.full_image = true;
            return plan;
        }
        if self.opacity == 0.0 {
            return plan;
        }
        let rect = plan.rect;
        let short = rect[2].min(rect[3]);
        let optical = [rect[0] + rect[2] * 0.5, rect[1] + rect[3] * 0.5];
        let burst = [
            rect[0] + rect[2] * self.center[0],
            rect[1] + rect[3] * self.center[1],
        ];
        let camera = 4.0 * rect[2].max(rect[3]);
        let mut colors = Vec::with_capacity(self.fragments as usize);
        let mut shadows = Vec::with_capacity(self.fragments as usize);
        for cell in geometry::cells(rect, self.fragments, seed) {
            let key = 0x1357_0000 + cell.key * 8;
            let center = cell.vertices.iter().fold([0.0, 0.0], |sum, v| {
                [
                    sum[0] + v[0] / cell.vertices.len() as f64,
                    sum[1] + v[1] / cell.vertices.len() as f64,
                ]
            });
            let delta = [center[0] - burst[0], center[1] - burst[1]];
            let direction = if delta == [0.0, 0.0] {
                TAU * random(seed, key)
            } else {
                delta[1].atan2(delta[0]) + 0.7 * random(seed, key) - 0.35
            };
            let distance = self.spread * short * p * (0.5 + 0.5 * random(seed, key + 1));
            let translation = [
                distance * direction.cos(),
                distance * direction.sin() + self.gravity * short * p * p,
            ];
            let depth = self.depth * short * p * (0.25 + 0.75 * random(seed, key + 2));
            let angles =
                [3, 4, 5].map(|offset| self.spin * p * (2.0 * random(seed, key + offset) - 1.0));
            let normal = geometry::rotate([0.0, 0.0, 1.0], angles);
            let mut vertices = Vec::with_capacity(cell.vertices.len());
            let mut shadow_vertices = Vec::with_capacity(cell.vertices.len());
            for source in cell.vertices {
                let local = [source[0] - center[0], source[1] - center[1], 0.0];
                let rotated = geometry::rotate(local, angles);
                let world = if self.spin == 0.0 {
                    [source[0] + translation[0], source[1] + translation[1]]
                } else {
                    [
                        center[0] + rotated[0] + translation[0],
                        center[1] + rotated[1] + translation[1],
                    ]
                };
                let z = depth + rotated[2];
                // center lies inside the convex cell, so |local| <= rect diagonal.
                // z <= (1 + sqrt(2))*long; camera=4*long and perspective<=.8
                // prove w >= .517 without clipping or changing the rigid geometry.
                let w = 1.0 - self.perspective * z / camera;
                let position = if w == 1.0 {
                    world
                } else {
                    [
                        optical[0] + (world[0] - optical[0]) / w,
                        optical[1] + (world[1] - optical[1]) / w,
                    ]
                };
                let uv = [source[0] / width, source[1] / height];
                vertices.push(MeshVertex { position, uv, w });
                if self.shadow > 0.0 {
                    shadow_vertices.push(MeshVertex {
                        position: [world[0] + 0.35 * z, world[1] + 0.45 * z],
                        uv,
                        w: 1.0,
                    });
                }
            }
            if self.shadow > 0.0 {
                shadows.push(MeshFace {
                    vertices: shadow_vertices,
                    brightness: 0.0,
                    opacity: self.shadow * self.opacity * p,
                    depth: 0.0,
                    color_offset: None,
                });
            }
            colors.push(MeshFace {
                vertices,
                brightness: 1.0 - self.shading * (1.0 - normal[2].abs()),
                opacity: self.opacity,
                depth,
                color_offset: (self.refraction > 0.0).then_some([
                    normal[0] * self.refraction * short * p / width,
                    normal[1] * self.refraction * short * p / height,
                ]),
            });
        }
        colors.sort_by(|a, b| a.depth.total_cmp(&b.depth));
        plan.faces = shadows;
        plan.faces.extend(colors);
        plan
    }
}

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite Shatter rule");
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
        "clock":"explicit source-frame span -> eased progress; analytic burst and gravity; ref remaps source time",
        "parameters":{
            "image":{"type":"resource","kind":"image"},
            "rect":{"type":"tuple","items":[number(RECT_ORIGIN,"frame-width"),number(RECT_ORIGIN,"frame-height"),number(RECT_SIZE,"frame-width"),number(RECT_SIZE,"frame-height")]},
            "fit":{"type":"enum","options":[Fit::Contain,Fit::Cover,Fit::Stretch],"suggested":"contain"},
            "fragments":number(FRAGMENTS,"voronoi-cells"),
            "center":{"type":"tuple","items":[number(CENTER,"rect-width"),number(CENTER,"rect-height")]},
            "spread":number(SPREAD,"rect-short-side"),"spin":number(SPIN,"radians"),
            "gravity":number(GRAVITY,"rect-short-side"),"depth":number(DEPTH,"rect-short-side"),
            "perspective":number(PERSPECTIVE,"ratio"),"refraction":number(REFRACTION,"rect-short-side"),
            "shading":number(SHADING,"ratio"),"shadow":number(SHADOW,"ratio"),"opacity":number(OPACITY,"ratio")
        },
        "constraints":["8 * fragments charged per expanded occurrence, including shadow; maximum 4096 primitives","four additional raster surfaces","every listed parameter is required"],
        "endpoints":"progress 0 is the complete fitted image; progress 1 retains scattered, rotated and fallen fragments, never an automatic return or fade",
        "geometry":"seeded Voronoi convex cells with shared topology-key vertices; source UVs cover the fitted image once; rigid Rx/Ry/Rz about each polygon's vertex mean; radial seeded burst and gravity*progress^2; stable far-to-near colors after all shadows",
        "projection":"camera distance 4*rect long side; centered on authored rect; positive z approaches camera; w >= 1-.8*(1+sqrt(2))/4 > .517",
        "shading":"1-shading*(1-abs(rotatedNormal.z)); no backface culling",
        "refraction":"rotatedNormal.xy*refraction*rectShortSide*progress / canvasDimensions offsets RGB only; source UV alpha remains unchanged; transparent shifted samples fall back to source RGB",
        "shadow":"black source-alpha projection onto z=0 at world.xy+[.35,.45]*z; opacity=shadow*opacity*progress; all shadows precede color faces",
        "opacity":"fullImage uses plan opacity; each face carries final opacity, without a second plan multiplication",
        "limitations":["one declared image, not lower compositor content or another scene","source-frame analytic rigid motion, not physics","scene shatter is distinct from the existing two-scene shatter transition","off-frame source UVs are transparent"]
    })
}
