use super::{
    Sample,
    clock::Clock,
    hand::Hand,
    model::Thread,
    plan::{Command, Plan, Step},
};
use crate::mv_image_dimensions::Context;
const FRAME: u64 = 1920 * 1080;
const TILE: u64 = 480 * 270;
const MAX_PLAN_BYTES: usize = 1024 * 1024;
impl Thread {
    pub(in crate::mv_recipe) fn work(&self) -> u32 {
        1024
    }
    pub(in crate::mv_recipe) fn plan_pixels(&self) -> u64 {
        (MAX_PLAN_BYTES as u64 * 3 + 3) / 4
    }
    pub(in crate::mv_recipe) fn scratch_pixels(
        &self,
        images: Option<&Context>,
    ) -> Result<u64, String> {
        // Published scene + lit + two nebula tiles + wide/near glow buffers.
        let base = 4 * FRAME + 2 * (2 * TILE + TILE + 960 * 540);
        let Some(images) = images else {
            return Ok(base);
        };
        let image = images.image(&self.hand)?;
        if image.width > 4096 || image.height > 4096 {
            return Err("thread hand exceeds 4096px surface bound".into());
        }
        let image_pixels = u64::from(image.width) * u64::from(image.height);
        // Rotation-independent diagonal bounds the projected image at camera1
        // (max zoom1.06). Also cover the replay validator's source-space bound.
        let diagonal = ((image.width as f64).hypot(image.height as f64) * self.hand_h
            / image.height as f64
            * 1.06)
            .ceil();
        if !diagonal.is_finite() || diagonal + 24.0 > 8192.0 {
            return Err("thread projected hand blur exceeds bounded scratch dimensions".into());
        }
        let blur = 2
            * ((image.width as u64 + 24) * (image.height as u64 + 24))
                .max((diagonal as u64 + 24).pow(2));
        let rim_stage = 2 * FRAME + 4 * TILE + 4 * image_pixels;
        let scene_stage = base + 2 * image_pixels + blur;
        // Both scratch glow surfaces coexist while the second blur is emitted.
        let glow_stage = 2 * FRAME
            + 4 * TILE
            + 2 * image_pixels
            + 2 * TILE
            + 4 * 960 * 540
            + 2 * (960 + 18) * (540 + 18);
        Ok(rim_stage.max(scene_stage).max(glow_stage))
    }
    pub(in crate::mv_recipe) fn runtime_ready(
        &self,
        s: &Sample<'_>,
        images: &Context,
    ) -> Result<(), String> {
        let clock = Clock::new(self, s)?;
        Hand::new(self, &clock, images)?;
        self.scratch_pixels(Some(images))?;
        Ok(())
    }
    pub(super) fn verify_plan(&self, p: &Plan, images: &Context) -> Result<(), String> {
        fn work(commands: &[Command]) -> (usize, usize) {
            let (mut count, mut steps) = (0, 0);
            for c in commands {
                count += 1;
                match c {
                    Command::Surface { commands, .. } | Command::AppendSurface { commands, .. } => {
                        let (a, b) = work(commands);
                        count += a;
                        steps += b;
                    }
                    Command::Path { path, .. } => {
                        steps += path
                            .iter()
                            .map(|p| if matches!(p, Step::Rect { .. }) { 5 } else { 1 })
                            .sum::<usize>()
                    }
                    _ => {}
                }
            }
            (count, steps)
        }
        let (commands, steps) = work(&p.commands);
        if commands > 1024 || steps > 12000 {
            return Err("thread exceeds expanded command/path budget".into());
        }
        p.validate_surfaces(self.scratch_pixels(Some(images))?)?;
        if serde_json::to_vec(p).map_err(|e| e.to_string())?.len() > MAX_PLAN_BYTES {
            return Err("thread exceeds 1MiB serialized plan/copy budget".into());
        }
        Ok(())
    }
}
