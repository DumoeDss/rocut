use super::{
    Sample,
    character::Character,
    clock::Clock,
    model::Fall,
    plan::{Command, Plan, Step},
};
use crate::mv_image_dimensions::Context;
const FRAME: u64 = 1920 * 1080;
const TILE: u64 = 480 * 270;
const HALF: u64 = 960 * 540;
const PLAN_BYTES: usize = 1024 * 1024;
impl Fall {
    pub(in crate::mv_recipe) fn work(&self) -> u32 {
        1024
    }
    pub(in crate::mv_recipe) fn plan_pixels(&self) -> u64 {
        (PLAN_BYTES as u64 * 3 + 3) / 4
    }
    /// Integral runs from source shot start, with a fractional final step. One
    /// spare iteration conservatively covers binary64 repeated-addition drift.
    pub(in crate::mv_recipe) fn sim_work(&self, duration_ticks: u64) -> Option<u64> {
        duration_ticks
            .div_ceil(1000)
            .checked_add(1)?
            .checked_mul(64)?
            .checked_add(3 * 4096 + 64)
    }
    pub(in crate::mv_recipe) fn scratch_pixels(
        &self,
        images: Option<&Context>,
    ) -> Result<u64, String> {
        let known = 4 * FRAME + 4 * TILE + 2 * HALF + 2 * 64 * 512;
        let Some(images) = images else {
            return Ok(known);
        };
        let image = images.image(&self.image)?;
        if image.width > 4096 || image.height > 4096 || image.height < 3 {
            return Err(
                "fall character needs dimensions1..4096 and nonzero rounded hair split".into(),
            );
        }
        let pixels = u64::from(image.width) * u64::from(image.height);
        let hair = 12.0 + 7.0 * (self.speed * 3.75);
        let diagonal = ((image.width as f64 + 2.8 * hair).hypot(image.height as f64) * self.h
            / image.height as f64
            * 1.07)
            .ceil();
        if !diagonal.is_finite() || diagonal + 30.0 > 8192.0 {
            return Err("fall projected character blur exceeds scratch dimensions".into());
        }
        let blur = 2
            * ((u64::from(image.width) + 30) * (u64::from(image.height) + 30))
                .max((diagonal as u64 + 30).pow(2));
        let character_stage = (4 * FRAME + 2 * TILE).max(2 * FRAME + 2 * TILE + 6 * pixels);
        let glow_stage = 2 * FRAME
            + 4 * pixels
            + 4 * TILE
            + 2 * 64 * 512
            + 4 * HALF
            + 2 * (960 + 18) * (540 + 18);
        let scene_stage = known + 4 * pixels + blur;
        let sprite_stage = 2 * FRAME + 2 * TILE + 4 * pixels + 2 * 64 * 512 + 85120;
        Ok(character_stage
            .max(glow_stage)
            .max(scene_stage)
            .max(sprite_stage))
    }
    pub(in crate::mv_recipe) fn runtime_ready(
        &self,
        s: &Sample<'_>,
        images: &Context,
    ) -> Result<(), String> {
        let clock = Clock::new(self, s)?;
        Character::new(self, &clock, images)?;
        self.scratch_pixels(Some(images))?;
        if self
            .sim_work(s.shot_end_ticks - s.shot_start_ticks)
            .is_none_or(|v| v > crate::mv_recipe::cloth::MAX_SIMULATION_WORK)
        {
            return Err("fall exceeds expanded simulation work budget".into());
        }
        Ok(())
    }
    pub(super) fn verify_plan(&self, plan: &Plan, images: &Context) -> Result<(), String> {
        fn counts(commands: &[Command]) -> (usize, usize) {
            let (mut n, mut p) = (0, 0);
            for c in commands {
                n += 1;
                match c {
                    Command::Surface { commands, .. } | Command::AppendSurface { commands, .. } => {
                        let (a, b) = counts(commands);
                        n += a;
                        p += b;
                    }
                    Command::Path { path, .. } => {
                        p += path
                            .iter()
                            .map(|v| if matches!(v, Step::Rect { .. }) { 5 } else { 1 })
                            .sum::<usize>()
                    }
                    _ => {}
                }
            }
            (n, p)
        }
        let (n, p) = counts(&plan.commands);
        if n > 1024 || p > 12000 {
            return Err("fall exceeds command/path budget".into());
        }
        if serde_json::to_vec(plan).map_err(|e| e.to_string())?.len() > PLAN_BYTES {
            return Err("fall exceeds1MiB serialized plan budget".into());
        }
        plan.validate_surfaces(self.scratch_pixels(Some(images))?)?;
        Ok(())
    }
}
