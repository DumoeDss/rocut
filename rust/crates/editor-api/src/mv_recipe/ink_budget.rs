use super::{
    Sample,
    character::Character,
    clock::Clock,
    model::Ink,
    plan::{Command, Plan, Step},
};
use crate::mv_image_dimensions::Context;
const FRAME: u64 = 1920 * 1080;
const TILE: u64 = 480 * 270;
const MAX_PLAN_BYTES: usize = 1024 * 1024;
impl Ink {
    pub(in crate::mv_recipe) fn work(&self) -> u32 {
        4096
    }
    pub(in crate::mv_recipe) fn plan_pixels(&self) -> u64 {
        (MAX_PLAN_BYTES as u64 * 3 + 3) / 4
    }
    pub(in crate::mv_recipe) fn scratch_pixels(
        &self,
        images: Option<&Context>,
    ) -> Result<u64, String> {
        // Scene + full masks, three noise tiles, simultaneous half/quarter
        // intermediates and padded gooey filter chain. Release remains explicit.
        let base = 8 * FRAME
            + 12 * TILE
            + 4 * (510 + 24) * (300 + 24)
            + 4 * (960 + 42) * (540 + 42)
            + 4 * (480 + 60) * (270 + 60);
        let Some(images) = images else {
            return Ok(base);
        };
        let image = images.image(&self.char)?;
        if image.width > 4096 || image.height > 4096 {
            return Err("Ink character exceeds 4096px scratch dimensions".into());
        }
        let size = u64::from(image.width) * u64::from(image.height);
        let projected = ((image.width as f64).hypot(image.height as f64) * self.h
            / image.height as f64
            * 1.004
            * 1.06)
            .ceil();
        if !projected.is_finite() || projected + 30. > 8192. {
            return Err("Ink projected character blur exceeds bounded scratch dimensions".into());
        }
        let filter = 2
            * ((image.width as u64 + 30) * (image.height as u64 + 30))
                .max((projected as u64 + 30).pow(2));
        base.checked_add(8 * size)
            .and_then(|v| v.checked_add(filter))
            .ok_or_else(|| "Ink scratch budget overflow".into())
    }
    pub(in crate::mv_recipe) fn runtime_ready(
        &self,
        s: &Sample<'_>,
        images: &Context,
    ) -> Result<(), String> {
        Clock::new(self, s)?;
        Character::new(self, images)?;
        self.scratch_pixels(Some(images))?;
        Ok(())
    }
    pub(super) fn verify_plan(&self, p: &Plan, images: &Context) -> Result<(), String> {
        fn work(commands: &[Command]) -> (usize, usize) {
            let (mut count, mut steps) = (0, 0);
            for command in commands {
                count += 1;
                match command {
                    Command::Surface { commands, .. } | Command::AppendSurface { commands, .. } => {
                        let (c, s) = work(commands);
                        count += c;
                        steps += s;
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
        let (count, steps) = work(&p.commands);
        if count > 4096 || steps > 12000 {
            return Err("Ink exceeds bounded expanded command/path work".into());
        }
        p.validate_surfaces(self.scratch_pixels(Some(images))?)?;
        if serde_json::to_vec(p).map_err(|e| e.to_string())?.len() > MAX_PLAN_BYTES {
            return Err("Ink exceeds 1MiB serialized plan/copy budget".into());
        }
        Ok(())
    }
}
