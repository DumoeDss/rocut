//! Full reference vortex. All clocks, randomness, geometry and paints are native;
//! the Canvas adapter only replays the ordered raster transport.
#[path = "converge_catalog.rs"]
mod catalog;
#[path = "converge_clock.rs"]
mod clock;
#[path = "converge_draw.rs"]
mod draw;
#[path = "converge_grain.rs"]
mod grain;
#[path = "converge_lights.rs"]
mod lights;
#[path = "converge_math.rs"]
mod math;
#[path = "converge_model.rs"]
mod model;
#[path = "converge_particles.rs"]
mod particles;
#[path = "converge_plan.rs"]
mod plan;
#[cfg(test)]
#[path = "converge_recipe_tests.rs"]
mod recipe_tests;
#[path = "converge_shards.rs"]
mod shards;
#[cfg(test)]
#[path = "converge_tests.rs"]
mod tests;
#[path = "converge_threads.rs"]
mod threads;
#[path = "converge_transform.rs"]
mod transform;
#[path = "converge_validate.rs"]
mod validate;
#[path = "converge_vortex.rs"]
mod vortex;
pub(super) use catalog::catalog_entry;
pub use model::Converge;
pub use plan::Plan;
pub(super) use plan::{Paint, PaintKind, Stop, Style};
pub(super) use transform::{Matrix, Operation};
pub(super) const MAX_BEATS: usize = 4096;
pub(super) const MAX_SAFE_TICKS: u64 = 9_007_199_254_740_991;

pub(super) struct Sample<'a> {
    pub shot_start_ticks: u64,
    pub song_ticks: u64,
    pub width: f64,
    pub height: f64,
    pub seed: u32,
    pub analysis: Option<&'a crate::mv_audio::Data>,
}
impl Converge {
    pub(super) fn plan(&self, sample: &Sample<'_>) -> Result<Plan, String> {
        let c = clock::Clock::new(self, sample)?;
        let mut d = draw::Draw {
            commands: Vec::new(),
            width: sample.width,
            height: sample.height,
        };
        let p = &self.palette;
        vortex::background(&mut d, &c, p);
        vortex::rings_and_streaks(&mut d, &c, p);
        threads::draw(&mut d, &c, p);
        shards::draw(&mut d, &c, p);
        particles::draw(&mut d, &c, p);
        let core = lights::ember(&mut d, &c, p);
        grain::draw(&mut d, c.t, self.grain);
        lights::white(&mut d, &c, p, core);
        Ok(Plan {
            commands: d.commands,
        })
    }
}
