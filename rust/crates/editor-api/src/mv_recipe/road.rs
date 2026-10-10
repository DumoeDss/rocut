//! Faithful native-primitive Road producer; scene registration belongs to root.
#[path = "road_budget.rs"]
mod budget;
#[path = "road_camera.rs"]
mod camera;
#[path = "road_drop.rs"]
mod drop;
#[path = "road_impact.rs"]
mod impact;
#[path = "road_math.rs"]
mod math;
#[path = "road_model.rs"]
pub mod model;
#[path = "road_plan.rs"]
pub mod plan;
#[path = "road_run.rs"]
mod run;
#[path = "road_run_particles.rs"]
mod run_particles;
#[path = "road_runner.rs"]
mod runner;
#[path = "road_tear.rs"]
mod tear;
#[cfg(test)]
#[path = "road_tests.rs"]
mod tests;
#[path = "road_tiles.rs"]
mod tiles;
#[path = "road_timing.rs"]
mod timing;
#[path = "road_world.rs"]
mod world;
use crate::programmatic_resources::Resource;
/// Actual byte-admitting native decoder constructs this, never author JSON.
pub struct ImageFact {
    pub resource: Resource,
    pub width: u32,
    pub height: u32,
}
pub struct Session {
    args: model::Args,
    resources: Vec<Resource>,
    character: Option<ImageFact>,
    limit: u64,
}
impl Session {
    pub fn prepare(
        args: model::Args,
        resources: Vec<Resource>,
        character: Option<ImageFact>,
        max_bytes: usize,
    ) -> Result<Self, String> {
        if let Some(issue) = crate::programmatic_resources::validate(&resources).first() {
            return Err(issue.message.clone());
        }
        match &args.mode {
            model::Mode::Run => {
                let id = args
                    .char
                    .as_deref()
                    .ok_or("Road run requires explicit admitted character art")?;
                let f = character
                    .as_ref()
                    .ok_or("Road requires native character dimensions")?;
                if f.resource.kind != "image"
                    || f.resource.id != id
                    || resources.iter().find(|r| r.id == id) != Some(&f.resource)
                {
                    return Err("Road character descriptor mismatch".into());
                }
                crate::image_sequence::decoded_image_bytes(f.width, f.height)?;
            }
            model::Mode::Tear => {
                if character.is_some() || args.char.is_some() {
                    return Err("Road tear has no character resource".into());
                }
            }
        }
        let s = Self {
            args,
            resources,
            character,
            limit: (max_bytes as u64).min(256 * 1024 * 1024),
        };
        budget::base(&s)?;
        Ok(s)
    }
    pub fn frame(&self, sample: &model::Sample<'_>) -> Result<plan::Plan, String> {
        model::validate(&self.args, sample)?;
        if sample.resources != self.resources {
            return Err("Road source descriptor changed".into());
        }
        let mut d = plan::Draw::new();
        d.a(plan::Action::Save);
        d.fill([3.0, 2.0, 7.0], 1.0);
        d.rect([0.0, 0.0, 1920.0, 1080.0]);
        match &self.args.mode {
            model::Mode::Tear => tear::draw(&mut d, &self.args, sample),
            model::Mode::Run => {
                let f = self
                    .character
                    .as_ref()
                    .ok_or("Road character is not admitted")?;
                run::draw(
                    &mut d,
                    &self.args,
                    sample,
                    &f.resource.id,
                    [f.width, f.height],
                );
            }
        }
        d.a(plan::Action::Restore);
        let mut p = plan::Plan {
            commands: d.commands,
            raster_budget_bytes: 0,
        };
        p.raster_budget_bytes = budget::frame(&p, self)?;
        Ok(p)
    }
}
