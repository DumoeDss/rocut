//! Original glass.js Heart shatter. Production provider/registry integration pending.
#[path = "heart_motion.rs"]
mod motion;
#[path = "heart_plan.rs"]
mod plan;
#[path = "heart_sprites.rs"]
mod sprites;
use motion::shards;
use shards::{components, fracture};
#[path = "heart_admission.rs"]
mod admission;
#[path = "heart_background.rs"]
mod background;
#[path = "heart_budget.rs"]
mod budget;
#[path = "heart_cracks.rs"]
mod cracks;
#[path = "heart_draw.rs"]
mod draw;
#[path = "heart_embers.rs"]
mod embers;
#[path = "heart_glitter.rs"]
mod glitter;
#[path = "heart_layers.rs"]
mod layers;
#[path = "heart_producer.rs"]
mod producer;
#[path = "converge_math.rs"]
mod seeded;
#[cfg(test)]
#[path = "heart_tests.rs"]
mod tests;
#[path = "heart_clock.rs"]
mod timing;
use crate::programmatic_resources::Resource;
pub use admission::Admission as PreparationAdmission;
pub use plan::prepared::{Binding, PreparedImage};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeartShatter {
    pub heart: String,
    #[serde(default)]
    pub bg: Option<String>,
    #[serde(default = "default_break_beat")]
    pub break_beat: u32,
    #[serde(default)]
    pub break_at: Option<f64>,
    #[serde(default = "default_x")]
    pub x: f64,
    #[serde(default = "default_y")]
    pub y: f64,
}
fn default_break_beat() -> u32 {
    2
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeartBurn {
    pub heart: String,
    #[serde(default)]
    pub bg: Option<String>,
    #[serde(default = "default_burn_beat")]
    pub break_beat: u32,
    #[serde(default)]
    pub break_at: Option<f64>,
    #[serde(default = "default_x")]
    pub x: f64,
    #[serde(default = "default_y")]
    pub y: f64,
}
fn default_burn_beat() -> u32 {
    1
}
fn default_x() -> f64 {
    960.0
}
fn default_y() -> f64 {
    470.0
}
pub struct BackgroundFact<'a> {
    pub resource: &'a Resource,
    pub width: u32,
    pub height: u32,
}
pub struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub song_ticks: u64,
    pub beats: &'a [u64],
    pub bpm: f64,
    pub resources: &'a [Resource],
    pub background: Option<BackgroundFact<'a>>,
}
pub struct Session {
    binding: Binding,
    body: components::Prepared,
    glass: shards::Glass,
    body_image: PreparedImage,
    chip_images: Vec<PreparedImage>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub commands: Vec<plan::Command>,
    pub raster_budget_bytes: u64,
}
impl Session {
    /// Provider may reserve the source readback/native backing before decoding.
    /// The remaining allowance is specifically for component/body/chip allocation.
    pub fn preparation_admission(
        binding: &Binding,
        max_bytes: usize,
    ) -> Result<PreparationAdmission, String> {
        admission::inspect(binding, max_bytes)
    }
    /// Encoded source bytes must already have been hash-admitted by the resource owner.
    pub fn prepare(binding: Binding, rgba: &[u8], max_bytes: usize) -> Result<Self, String> {
        // Reserve all phases and external owners before the first large allocation.
        let component_budget = admission::reserve(&binding, rgba.len(), max_bytes)?;
        binding.validate_source(rgba)?;
        let body = components::prepare(
            binding.decoded_width as usize,
            binding.decoded_height as usize,
            rgba,
            component_budget,
        )
        .map_err(|e| format!("Heart component preparation: {e:?}"))?;
        let glass = shards::build(&body, 10_000_000)
            .map_err(|e| format!("Heart fracture preparation: {e:?}"))?;
        let body_image = binding.image(
            plan::prepared::Part::Body,
            binding.decoded_width,
            binding.decoded_height,
            &body.body_rgba,
        )?;
        let chip_images = body
            .chips
            .iter()
            .map(|c| {
                binding.image(
                    plan::prepared::Part::Chip {
                        label: c.label as u32,
                    },
                    c.width as u32,
                    c.height as u32,
                    &c.rgba,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            binding,
            body,
            glass,
            body_image,
            chip_images,
        })
    }
    pub fn images(&self) -> Vec<(&PreparedImage, &[u8])> {
        let mut out = vec![(&self.body_image, self.body.body_rgba.as_slice())];
        out.extend(
            self.chip_images
                .iter()
                .zip(&self.body.chips)
                .map(|(i, c)| (i, c.rgba.as_slice())),
        );
        out
    }
    pub fn frame(&self, a: &HeartShatter, s: &Sample<'_>) -> Result<Plan, String> {
        producer::frame(self, a, s)
    }
    pub fn burn_frame(&self, a: &HeartBurn, s: &Sample<'_>) -> Result<Plan, String> {
        let a = HeartShatter {
            heart: a.heart.clone(),
            bg: a.bg.clone(),
            break_beat: a.break_beat,
            break_at: a.break_at,
            x: a.x,
            y: a.y,
        };
        producer::break_frame(self, &a, s, true)
    }
}
