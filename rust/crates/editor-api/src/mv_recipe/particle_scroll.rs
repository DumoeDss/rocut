//! A source-frame-driven frontier turns the scanned part of an image into
//! seeded image fragments. The unscanned part stays at its original UVs.
use super::catalog::{
    GENERATOR_PRIMITIVES, NumberRule, OPACITY, PARTICLE_GRID, RECT_ORIGIN, RECT_SIZE, SCATTER, SPIN,
};
use super::generator_model::Fit;
use super::transitions::random;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const BAND: NumberRule = NumberRule {
    min: 0.01,
    max: 1.0,
    integer: false,
    suggested: 0.25,
};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScrollDirection {
    LeftToRight,
    RightToLeft,
    TopToBottom,
    BottomToTop,
}

impl ScrollDirection {
    fn horizontal(self) -> bool {
        matches!(self, Self::LeftToRight | Self::RightToLeft)
    }

    fn reverse(self) -> bool {
        matches!(self, Self::RightToLeft | Self::BottomToTop)
    }

    /// Map an increasing scan interval to a normalized fitted-image UV box.
    fn uv(self, low: f64, high: f64) -> Option<[f64; 4]> {
        let low = low.clamp(0.0, 1.0);
        let high = high.clamp(0.0, 1.0);
        if high <= low {
            return None;
        }
        let origin = if self.reverse() { 1.0 - high } else { low };
        Some(if self.horizontal() {
            [origin, 0.0, high - low, 1.0]
        } else {
            [0.0, origin, 1.0, high - low]
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParticleScroll {
    pub image: String,
    pub columns: u32,
    pub rows: u32,
    pub rect: [f64; 4],
    pub fit: Fit,
    pub band: f64,
    pub scatter: f64,
    pub spin: f64,
    pub opacity: f64,
    pub direction: ScrollDirection,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticleScrollPlan {
    pub image: String,
    pub rect: [f64; 4],
    pub fit: Fit,
    pub opacity: f64,
    pub full_image: bool,
    pub frontier: f64,
    pub intact_uv: Option<[f64; 4]>,
    pub particle_clip_uv: Option<[f64; 4]>,
    pub particles: Vec<ScrollParticle>,
}

#[derive(Serialize)]
pub struct ScrollParticle {
    pub cell: [u32; 2],
    pub uv: [f64; 4],
    pub offset: [f64; 2],
    pub scale: f64,
    pub rotation: f64,
    pub opacity: f64,
}

impl ParticleScroll {
    pub fn valid(&self) -> bool {
        PARTICLE_GRID.valid(self.columns)
            && PARTICLE_GRID.valid(self.rows)
            && self.work() <= GENERATOR_PRIMITIVES
            && self.rect[..2].iter().all(|v| RECT_ORIGIN.valid(*v))
            && self.rect[2..].iter().all(|v| RECT_SIZE.valid(*v))
            && BAND.valid(self.band)
            && SCATTER.valid(self.scatter)
            && SPIN.valid(self.spin)
            && OPACITY.valid(self.opacity)
    }

    pub fn work(&self) -> u32 {
        // Include the intact-image draw, even at a frame where it is empty.
        self.columns.saturating_mul(self.rows).saturating_add(1)
    }

    pub fn plan(&self, progress: f64, seed: u32, width: f64, height: f64) -> ParticleScrollPlan {
        let p = progress.clamp(0.0, 1.0);
        let frontier = (1.0 + self.band) * p;
        let rect = [
            self.rect[0] * width,
            self.rect[1] * height,
            self.rect[2] * width,
            self.rect[3] * height,
        ];
        let active = p > 0.0 && p < 1.0;
        let mut particles = Vec::new();
        if active && self.opacity > 0.0 {
            for row in 0..self.rows {
                for column in 0..self.columns {
                    let mut uv = [
                        f64::from(column) / f64::from(self.columns),
                        f64::from(row) / f64::from(self.rows),
                        1.0 / f64::from(self.columns),
                        1.0 / f64::from(self.rows),
                    ];
                    let axis = usize::from(!self.direction.horizontal());
                    let origin = uv[axis];
                    let end = origin + uv[axis + 2];
                    let (scan_low, scan_high) = if self.direction.reverse() {
                        (1.0 - end, 1.0 - origin)
                    } else {
                        (origin, end)
                    };
                    let low = scan_low.max(frontier - self.band).max(0.0);
                    let high = scan_high.min(frontier).min(1.0);
                    if high <= low {
                        continue;
                    }
                    uv[axis] = if self.direction.reverse() {
                        1.0 - high
                    } else {
                        low
                    };
                    uv[axis + 2] = high - low;
                    let age = ((frontier - (low + high) * 0.5) / self.band).clamp(0.0, 1.0);
                    let key = (row * self.columns + column) * 3;
                    let distance = self.scatter * (0.25 + random(seed, key) * 0.75) * age.powi(2);
                    let sideways =
                        self.scatter * (random(seed, key + 1) * 2.0 - 1.0) * age.powi(2) * 0.5;
                    let signed_distance = if self.direction.reverse() {
                        distance
                    } else {
                        -distance
                    };
                    let offset = if self.direction.horizontal() {
                        [signed_distance * rect[2], sideways * rect[3]]
                    } else {
                        [sideways * rect[2], signed_distance * rect[3]]
                    };
                    particles.push(ScrollParticle {
                        cell: [column, row],
                        uv,
                        offset,
                        scale: 1.0 - 0.6 * age,
                        rotation: (random(seed, key + 2) * 2.0 - 1.0)
                            * self.spin
                            * std::f64::consts::TAU
                            * age,
                        opacity: self.opacity * (1.0 - age).powi(2),
                    });
                }
            }
        }
        ParticleScrollPlan {
            image: self.image.clone(),
            rect,
            fit: self.fit,
            opacity: self.opacity,
            full_image: p <= 0.0,
            frontier,
            intact_uv: active.then(|| self.direction.uv(frontier, 1.0)).flatten(),
            // The raster clip prevents rotated or scattered pieces from covering
            // the intact side. UVs use the fitted image, including cover crop.
            particle_clip_uv: active.then(|| self.direction.uv(0.0, frontier)).flatten(),
            particles,
        }
    }
}

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite static rule");
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
        "requires":["canvas-worker-2d","declared-image-resource"],
        "binding":"scene.settings plus scene.role, scene.span and scene.easing",
        "clock":"explicit source-frame span -> eased progress; ref remaps source time",
        "parameters":{
            "image":{"type":"resource","kind":"image"},
            "columns":number(PARTICLE_GRID,"cells"),
            "rows":number(PARTICLE_GRID,"cells"),
            "rect":{"type":"tuple","items":[number(RECT_ORIGIN,"frame-width"),number(RECT_ORIGIN,"frame-height"),number(RECT_SIZE,"frame-width"),number(RECT_SIZE,"frame-height")]},
            "fit":{"type":"enum","options":[Fit::Contain,Fit::Cover,Fit::Stretch],"suggested":"contain"},
            "band":number(BAND,"fitted-image-scan-axis"),
            "scatter":number(SCATTER,"rect-size"),
            "spin":number(SPIN,"turns"),
            "opacity":number(OPACITY,"ratio"),
            "direction":{"type":"enum","options":[ScrollDirection::LeftToRight,ScrollDirection::RightToLeft,ScrollDirection::TopToBottom,ScrollDirection::BottomToTop],"suggested":"left-to-right"}
        },
        "constraints":["columns * rows + 1 charged to expanded primitive budget","every listed parameter is required"],
        "endpoints":"progress 0 is the complete fitted image; progress 1 is transparent; reverse ref reconstructs the same frames",
        "frontier":"scan coordinate s follows direction; frontier=(1+band)*progress; intact s>=frontier; particles intersect frontier-band<=s<frontier; particles cannot cover the intact side",
        "limitations":["one declared image, not arbitrary lower compositor content","analytical textured fragments, not a physics simulation","UV scan geometry follows the fitted image; contain letterbox stays transparent; cover scans the cropped image"]
    })
}
